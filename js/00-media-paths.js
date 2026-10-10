/* ===========================================================
 * 模块: 00-media-paths.js —  媒体路径约定「单一真源」(V10.25.0)
 * -----------------------------------------------------------
 * 用户需求: 图片/视频按「车型名称」分文件夹存放, GitHub 与飞书一致,
 *   保证媒体与车型准确对应, 杜绝数据错乱(断电教学视频张冠李戴有现场安全隐患)。
 *
 * 为什么需要本模块:
 *   改造前 vehicle_images/ 是「扁平大杂烩」—— 同一目录下同时存在三代命名
 *   (image1.jpeg / user_v30_p3_671f6a37.jpeg / 比亚迪元(元PRO)_p1_f17d44b3.jpeg),
 *   没有任何机器可读的「车型 → 文件」归属约定, 只能靠 vehicles_data.js 的
 *   photoPaths 反查, 极易漂移。本模块把约定收敛为代码级单一真源:
 *     浏览器端(js/05-sync.js 上传写回、js/06-media.js、js/04-export.js)
 *     与 Node 脚本端(gen_media_mapping / audit_media_consistency /
 *     sync_photos_to_repo / sync_videos_to_release / 存量迁移脚本)
 *   共用同一份实现。
 *
 * 约定(不可随意更改; 更改须同步 docs/codebase/STRUCTURE.md):
 *   1. 顶层契约目录名保持不变: vehicle_images/ 、 vehicle_videos/
 *      (STRUCTURE.md「运行时契约目录(不得改名/移动)」——
 *       只在其【内部】按车型名建子目录, 顶层名不动以保住 4 条既有链路:
 *       Pages 部署路径 / APK www 路径 / .traeignore / CI 触发路径)
 *   2. 布局: <顶层目录>/<车型目录>/<文件名>
 *         车型目录 = sanitizeName(车型显示名)     例: 长安深蓝(G318)
 *   3. 多车型共用资产(如「通用断电视频」) → <顶层目录>/_共享/
 *   4. 文件名沿用既有约定(与 js/05-sync.js 上传侧一致):
 *         照片 <车型显示名>_p<N>_<hash>.jpeg
 *         视频 <车型显示名>_v<N>_<hash>.mp4
 *   5. 向后兼容: 解析层必须同时认三种历史形态
 *         三段 <top>/<folder>/<file> 、 两段 <top>/<file> 、 一段 <file>
 *
 * 双端加载(UMD):
 *   - 浏览器: <script defer src="js/00-media-paths.js"> → window.TCG_MEDIA_PATHS
 *   - Node  : const MP = require('./js/00-media-paths.js')
 * =========================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('fs'), require('path'));
  } else {
    root.TCG_MEDIA_PATHS = factory(null, null);
  }
})(typeof self !== 'undefined' ? self : this, function (fs, path) {
  'use strict';

  /* ---------- 常量(约定本体) ---------- */
  var PHOTO_TOP = 'vehicle_images';   // 照片顶层契约目录(不得改名)
  var VIDEO_TOP = 'vehicle_videos';   // 视频顶层契约目录(不得改名)
  var SHARED_FOLDER = '_共享';        // 多车型共用资产子目录
  var MAX_FOLDER_LEN = 40;            // 子目录名长度上限(飞书/Windows 双端留足余量)

  /**
   * 名称清洗 —— 与 js/00-bootstrap.js#_sanitizeFeishuFileName 同一正则规则
   * (去控制字符 → 路径保留字→_ → 去 emoji → 折叠空白/下划线 → 去首尾 → 截断)
   * @param {string} name
   * @param {number} [maxLen=150]
   * @param {boolean} [keepExt=false] 截断时是否保留扩展名(bootstrap 文件名场景需保留)
   * @param {string} [fallback] 清洗后为空时的兜底值; 不传=时间戳兜底(bootstrap 行为),
   *        传 ''=允许返回空串(目录名场景: 调用方自行决定退化策略, 避免出现
   *        无意义的 file_<timestamp> 目录名)
   */
  function sanitizeName(name, maxLen, keepExt, fallback) {
    var limit = maxLen || 150;
    var s = String(name == null ? '' : name)
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^[.\s_]+|[.\s_]+$/g, '');
    if (!s) s = (fallback === undefined ? ('file_' + Date.now().toString(36)) : fallback);
    if (s.length > limit) {
      if (keepExt) {
        var dot = s.lastIndexOf('.');
        var ext = (dot > 0 && s.length - dot <= 6) ? s.slice(dot) : '';
        s = s.slice(0, limit - ext.length) + ext;
      } else {
        s = s.slice(0, limit);
      }
      s = s.replace(/^[.\s_]+|[.\s_]+$/g, '') || s;
    }
    return s;
  }

  /** 车型对象 → 子目录名(优先显示名; 退化到车系/品牌; 再退化到 vehicle_<id>) */
  function folderNameForVehicle(v) {
    var base = (v && (v.display || v.series || v.brand)) || '';
    // 传 fallback='' 关闭时间戳兜底: 清洗后为空说明本源无有效名称,
    // 此时才应走可预测的 vehicle_<id> 退化(而非 file_<timestamp> 随机目录)
    var name = sanitizeName(base, MAX_FOLDER_LEN, false, '');
    if (!name) name = (v && v.id != null) ? ('vehicle_' + v.id) : 'vehicle_unknown';
    return name;
  }

  /** 组装照片/视频的相对路径(三段式; folder 为空则退化为两段式) */
  function photoRelPath(folder, fileName) {
    return folder ? (PHOTO_TOP + '/' + folder + '/' + fileName) : (PHOTO_TOP + '/' + fileName);
  }
  function videoRelPath(folder, fileName) {
    return folder ? (VIDEO_TOP + '/' + folder + '/' + fileName) : (VIDEO_TOP + '/' + fileName);
  }

  /** 解析任意历史形态的媒体路径 */
  function parseMediaPath(p) {
    var raw = String(p == null ? '' : p).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
    var parts = raw ? raw.split('/') : [];
    var fileName = parts.length ? parts[parts.length - 1] : '';
    var top = '', folder = '';
    if (parts.length >= 3) {
      top = parts[parts.length - 3];
      folder = parts[parts.length - 2];
    } else if (parts.length === 2) {
      top = parts[0];
    }
    return {
      raw: raw,
      parts: parts,
      top: top,
      folder: folder,
      fileName: fileName,
      isShared: folder === SHARED_FOLDER,
      isNested: !!folder,
      isTopOnly: parts.length === 2
    };
  }

  /**
   * 该引用可能的相对路径候选(新式三段在前, 旧式依次兜底)
   * 供脚本做「存在性优先」的磁盘定位。
   */
  function candidateRelPaths(topDir, fileName, folder) {
    var out = [];
    if (folder) out.push(topDir + '/' + folder + '/' + fileName);
    out.push(topDir + '/' + fileName);
    if (topDir !== fileName) out.push(fileName);
    return out;
  }

  /* ---------- 以下为 Node 端专用(浏览器端 fs 为 null, 调用即返回空) ---------- */

  /** 递归列出某顶层媒体目录下全部文件 → [{fileName, relPath, folder}] */
  function listMediaFiles(rootDir, topDir) {
    if (!fs) return [];
    var base = path.join(rootDir, topDir);
    var out = [];
    (function walk(dir, rel) {
      var ents;
      try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (var i = 0; i < ents.length; i++) {
        var e = ents[i];
        var childRel = rel ? (rel + '/' + e.name) : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), childRel);
        else out.push({ fileName: e.name, relPath: topDir + '/' + childRel, folder: rel ? rel.split('/')[0] : '' });
      }
    })(base, '');
    return out;
  }

  /** 递归索引: fileName → [relPath...](同一文件名可能分布在多个目录) */
  function indexMediaFiles(rootDir, topDir) {
    var map = {};
    listMediaFiles(rootDir, topDir).forEach(function (f) {
      (map[f.fileName] || (map[f.fileName] = [])).push(f.relPath);
    });
    return map;
  }

  /** 按引用路径在磁盘定位真实文件(存在性优先), 找不到返回 '' */
  function resolveLocalFile(rootDir, topDir, p) {
    if (!fs) return '';
    var parsed = parseMediaPath(p);
    var cands = candidateRelPaths(topDir, parsed.fileName, parsed.folder);
    for (var i = 0; i < cands.length; i++) {
      var abs = path.join(rootDir, cands[i]);
      try { if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs; } catch (e) { /* ignore */ }
    }
    return '';
  }

  return {
    PHOTO_TOP: PHOTO_TOP,
    VIDEO_TOP: VIDEO_TOP,
    SHARED_FOLDER: SHARED_FOLDER,
    MAX_FOLDER_LEN: MAX_FOLDER_LEN,
    sanitizeName: sanitizeName,
    folderNameForVehicle: folderNameForVehicle,
    photoRelPath: photoRelPath,
    videoRelPath: videoRelPath,
    parseMediaPath: parseMediaPath,
    candidateRelPaths: candidateRelPaths,
    listMediaFiles: listMediaFiles,
    indexMediaFiles: indexMediaFiles,
    resolveLocalFile: resolveLocalFile
  };
});
