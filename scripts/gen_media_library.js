#!/usr/bin/env node
/**
 * ===========================================================
 * scripts/gen_media_library.js —— 生成「资源库」索引 (docs/media_library.json)
 * ===========================================================
 * 为什么需要: 车型照片/视频散在 `vehicle_images/<车型目录>/`、`_共享/`、`_未归类/`
 *   与 GitHub Release(视频) 四处, 之前只有 `audit:media` 的 stdout 能看出问题,
 *   人(组长/运营)在 App 里看不到"哪台车缺图、哪些是共享图、哪些文件没人引用"。
 *
 * 产物: 扁平、去重(共享文件只出现一次)、可被 PWA 直接拉取的索引。status:
 *   ok       —— 在该车型自己的目录里
 *   shared   —— 命中 `_共享/<文件名>`(多车型共用)
 *   unfiled  —— 命中 `_未归类/<文件名>`(有文件但没归到车型目录)
 *   remote   —— 视频在 Release/CDN 有映射(本地无文件)
 *   missing  —— 全树找不到(需补拍/补传)
 *   orphan   —— 只在 `_未归类/` 里、且没有任何车型引用(单独列表)
 *
 * 路径规则**不在这里重写**: 一律走 js/00-media-paths.js(单一真源, UMD 可 require)。
 * 幂等: `--check` 模式下内容漂移即 exit 1(供 CI 门禁).
 *
 * 运行: node scripts/gen_media_library.js [--check]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const MP = require('../js/00-media-paths.js');

const ROOT = path.resolve(__dirname, '..');
/* 输出到仓库根: Pages 的 _publish 白名单只收根文件与 css/js/vendor/vehicle_images/web-data,
 * docs/ 不在其中(实测线上 docs/media_library.json 是 404)。 */
const OUT = path.join(ROOT, 'media_library.json');

const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const isFile = (p) => { try { return fs.statSync(path.join(ROOT, p)).isFile(); } catch (e) { return false; } };
const sizeOf = (p) => { try { return fs.statSync(path.join(ROOT, p)).size; } catch (e) { return 0; } };
const humanSize = (n) => {
  if (!Number.isFinite(n) || n <= 0) return '';
  const u = ['B', 'KB', 'MB', 'GB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + u[i];
};

/**
 * 改名失配检测（纯函数，供单测）
 * @param {Array<{id:number,display:string,folder:string,fileName:string,declared:string}>} refs
 *        已在"自己目录"找不到的照片引用
 * @param {Map<string, Set<string>>} filesByFolder 目录 → 文件名集合
 * @param {string[]} reserved 系统保留目录（_共享/_未归类）
 * @returns {Array<Object>}
 */
function detectRenamedRefs(refs, filesByFolder, reserved) {
  const out = [];
  (refs || []).forEach(r => {
    for (const [fd, names] of filesByFolder || []) {
      if (fd === r.folder || (reserved || []).indexOf(fd) >= 0) continue;
      if (names.has(r.fileName)) {
        out.push({ id: r.id, display: r.display, fileName: r.fileName,
          declared: r.declared, foundAt: MP.PHOTO_TOP + '/' + fd + '/' + r.fileName, foundFolder: fd });
        return;
      }
    }
  });
  return out;
}

/**
 * 读取本地图片像素尺寸(纯 Node, 只读文件头; 不引第三方依赖)
 * 支持 PNG(IHDR) 与 JPEG(SOFn)。读不到返回 null。
 * 为什么需要: 现场反馈"照片太模糊" —— 根因是**源图分辨率**低(多数 433×606),
 *   在 2x/3x DPR 手机上被放大显示。编码再无损也救不回来, 只能把"低清"标出来推动补拍。
 */
function imageSize(absPath) {
  try {
    const fd = fs.openSync(absPath, 'r');
    const head = Buffer.alloc(4096);
    const n = fs.readSync(fd, head, 0, 4096, 0);
    fs.closeSync(fd);
    const b = head.subarray(0, n);
    if (b.length > 24 && b[0] === 0x89 && b.toString('ascii', 1, 4) === 'PNG') {
      return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
    }
    if (b[0] === 0xFF && b[1] === 0xD8) {
      let i = 2;
      while (i < b.length - 9) {
        if (b[i] !== 0xFF) { i++; continue; }
        const marker = b[i + 1];
        const len = b.readUInt16BE(i + 2);
        if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
    return null;
  } catch (e) { return null; }
}

/* 清晰度阈值: 手机端 2x DPR 下, 照片宽度建议 >= 900px; 视频高度建议 >= 720 */
const MIN_PHOTO_WIDTH = 900;
const MIN_VIDEO_HEIGHT = 720;

function main() {
  const manifest = readJson('docs/vehicle_media_manifest.json');
  let releaseMap = {};
  try { releaseMap = readJson('docs/media_release_map.json').map || {}; } catch (e) { /* 可选 */ }

  /** 照片候选路径(按优先级: 车型目录 → _共享 → _未归类 → 顶层) */
  const photoCandidates = (folder, fileName) => ([
    ['ok', `${MP.PHOTO_TOP}/${folder}/${fileName}`],
    ['shared', `${MP.PHOTO_TOP}/${MP.SHARED_FOLDER}/${fileName}`],
    ['unfiled', `${MP.PHOTO_TOP}/${MP.ORPHAN_FOLDER}/${fileName}`],
    ['ok', `${MP.PHOTO_TOP}/${fileName}`]
  ]);

  const byPath = new Map();
  /* 车型维度计数（V10.26.5）: 资源库要能回答"这台车有几张图/缺几张"，
   *   仅靠 assets 不行 —— 共享文件被去重后，单车型视角就丢了。 */
  const perVehicle = new Map();
  const bump = (v, kind, status) => {
    let s = perVehicle.get(v.id);
    if (!s) { s = { id: v.id, display: v.display, folder: MP.folderNameForVehicle(v), photos: 0, videos: 0, missing: 0 }; perVehicle.set(v.id, s); }
    if (kind === 'photo') s.photos++; else s.videos++;
    if (status === 'missing') s.missing++;
  };
  const upsert = (relPath, kind, status, vehicle) => {
    let a = byPath.get(relPath);
    if (!a) {
      a = { path: relPath, kind, kindLabel: kind === 'photo' ? '照片' : '视频', status,
        size: 0, sizeText: '', sha256: '', vehicles: [], vehicleText: '' };
      if (status === 'missing') a.missingFor = [];
      byPath.set(relPath, a);
    }
    /* 同一文件被多台车引用时, 状态以"更接近车型目录"者为准(ok > shared > unfiled > missing) */
    const rank = { ok: 0, shared: 1, unfiled: 2, remote: 3, missing: 4 };
    if (rank[status] < rank[a.status]) a.status = status;
    a.vehicles.push({ id: vehicle.id, display: vehicle.display });
    return a;
  };

  (manifest.vehicles || []).forEach(v => {
    const folder = MP.folderNameForVehicle(v);
    const veh = { id: v.id, display: v.display, folder: folder };

    (v.photos || []).forEach(p => {
      const hit = photoCandidates(folder, p.fileName).find(([, rel]) => isFile(rel));
      const status = hit ? hit[0] : 'missing';
      const rel = hit ? hit[1] : `${MP.PHOTO_TOP}/${folder}/${p.fileName}`;
      const a = upsert(rel, 'photo', status, veh);
      bump(veh, 'photo', status);
      if (status === 'missing' && a.missingFor) a.missingFor.push(veh);
      if (p.sha256 && !a.sha256) a.sha256 = p.sha256;
    });

    (v.videos || []).forEach(p => {
      const local = `${MP.VIDEO_TOP}/${folder}/${p.fileName}`;
      const cdn = releaseMap[p.fileName] || '';
      if (isFile(local)) { const a = upsert(local, 'video', 'ok', veh); bump(veh, 'video', 'ok'); if (p.sha256 && !a.sha256) a.sha256 = p.sha256; }
      else if (cdn) { const a = upsert(cdn, 'video', 'remote', veh); bump(veh, 'video', 'remote'); if (p.sha256 && !a.sha256) a.sha256 = p.sha256; }
      else { const a = upsert(local, 'video', 'missing', veh); bump(veh, 'video', 'missing'); if (a.missingFor) a.missingFor.push(veh); }
    });
  });

  const assets = Array.from(byPath.values());
  assets.forEach(a => {
    a.vehicles.sort((x, y) => x.id - y.id);
    const uniq = []; const seen = new Set();
    a.vehicles.forEach(x => { if (!seen.has(x.id)) { seen.add(x.id); uniq.push(x); } });
    a.vehicles = uniq;
    a.vehicleText = uniq.length > 1 ? (uniq[0].display + ' 等 ' + uniq.length + ' 台') : (uniq[0] ? uniq[0].display : '');
    if (a.status !== 'missing') delete a.missingFor;
    if (a.status === 'remote') { a.sizeText = '云端'; return; }
    a.size = sizeOf(a.path);
    a.sizeText = humanSize(a.size);
    if (a.kind === 'photo') {
      const dim = imageSize(path.join(ROOT, a.path));
      if (dim) {
        a.width = dim.width; a.height = dim.height;
        a.lowRes = dim.width < MIN_PHOTO_WIDTH;
        if (a.lowRes) a.resText = dim.width + '×' + dim.height;
      }
    }
  });

  /* 排序: 缺失优先(最需要动作) → 未归类 → 共享 → 正常 → 远程 */
  const order = { missing: 0, unfiled: 1, shared: 2, ok: 3, remote: 4 };
  assets.sort((a, b) => (order[a.status] - order[b.status]) || a.path.localeCompare(b.path, 'zh'));

  /* 孤儿: `_未归类/` 中没有被任何车型引用的文件 */
  const referencedNames = new Set(assets.map(a => path.basename(a.path)));
  /* indexMediaFiles 返回 { fileName: [relPath...] }, 这里摊平成 [_未归类/ 下的 relPath] */
  const orphanFolderPrefix = `${MP.PHOTO_TOP}/${MP.ORPHAN_FOLDER}/`;
  const unfiledAll = MP.listMediaFiles(ROOT, MP.PHOTO_TOP)
    .filter(f => f.relPath.indexOf(orphanFolderPrefix) === 0)
    .map(f => ({ fileName: f.fileName, relPath: f.relPath }));
  const orphans = unfiledAll
    .filter(f => !referencedNames.has(f.fileName))
    .map(f => {
      const size = sizeOf(f.relPath);
      return { path: f.relPath, kind: 'photo', kindLabel: '照片', status: 'orphan',
        size, sizeText: humanSize(size), sha256: '', vehicles: [], vehicleText: '未归类(无车型引用)' };
    })
    .sort((a, b) => a.path.localeCompare(b.path, 'zh'));

  /* ---------- 车型 ↔ 资源 双向关联（V10.26.5） ----------
   * 需求: 任意一方变更后，另一方必须能看出"对不上"。
   *   ① 车型删了/改名了 → 它的旧目录变成"无主目录"（此前隐形，只能靠归属门禁 CI 报）
   *   ② 车型改名后引用还写旧目录 → "改名失配"（文件在别的车型目录里找到了）
   *   ③ 新增车型没有素材 → 必须出现在"无素材车型"里（此前资源库根本看不到这台车）
   */
  const vehicleFolderMap = new Map();   // folder -> vehicle
  (manifest.vehicles || []).forEach(v => vehicleFolderMap.set(MP.folderNameForVehicle(v), v));

  const filesByFolder = new Map();      // folder -> Set(fileName)
  MP.listMediaFiles(ROOT, MP.PHOTO_TOP).forEach(f => {
    const parts = f.relPath.split('/');   // vehicle_images/<folder>/<...>/<file>
    const folder = parts.length >= 4 ? parts[1] : '';
    if (!folder) return;
    if (!filesByFolder.has(folder)) filesByFolder.set(folder, new Set());
    filesByFolder.get(folder).add(f.fileName);
  });

  /* 无主目录: 有文件、但不是任何车型目录 */
  const reserved = [MP.SHARED_FOLDER, MP.ORPHAN_FOLDER];
  const unownedFolders = Array.from(filesByFolder.keys())
    .filter(fd => !reserved.includes(fd) && !vehicleFolderMap.has(fd))
    .sort()
    .map(fd => ({ folder: fd, files: filesByFolder.get(fd).size }));

  /* 改名失配: 引用在自己的目录找不到, 但同名文件出现在**别的车型目录**里 */
  const refs = [];
  (manifest.vehicles || []).forEach(v => {
    const folder = MP.folderNameForVehicle(v);
    (v.photos || []).forEach(p => {
      const own = `${MP.PHOTO_TOP}/${folder}/${p.fileName}`;
      if (isFile(own)) return;   // 自己目录有 → 不是改名问题
      refs.push({ id: v.id, display: v.display, folder: folder, fileName: p.fileName, declared: own });
    });
  });
  const renamedRefs = detectRenamedRefs(refs, filesByFolder, reserved);

  /* 车型汇总（含 0 素材） */
  const vehiclesSummary = (manifest.vehicles || []).map(v => {
    const s = perVehicle.get(v.id) || { id: v.id, display: v.display,
      folder: MP.folderNameForVehicle(v), photos: 0, videos: 0, missing: 0 };
    return Object.assign({}, s, { noMedia: (s.photos + s.videos) === 0 });
  });
  const vehiclesWithoutMedia = vehiclesSummary.filter(v => v.noMedia);

  /* 统计口径 = assets + orphans(与前端 statsOf 完全一致: 台账里一共有多少条) */
  const allItems = assets.concat(orphans);
  const cnt = (s) => allItems.filter(a => a.status === s).length;
  const stats = {
    total: allItems.length,
    photos: allItems.filter(a => a.kind === 'photo').length,
    videos: allItems.filter(a => a.kind === 'video').length,
    ok: cnt('ok'),
    shared: cnt('shared'),
    unfiled: cnt('unfiled'),
    remote: cnt('remote'),
    missing: cnt('missing'),
    missingVehicles: assets.reduce((n, a) => n + ((a.missingFor || []).length ? 1 : 0), 0),
    orphans: orphans.length,
    fingerprinted: allItems.filter(a => a.sha256).length,
    vehicles: (manifest.vehicles || []).length,
    vehiclesWithoutMedia: vehiclesWithoutMedia.length,
    unownedFolders: unownedFolders.length,
    renamedRefs: renamedRefs.length,
    lowRes: allItems.filter(a => a.lowRes).length
  };

  const out = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    note: '由 scripts/gen_media_library.js 生成, 勿手改。missing=全树无同名文件; shared=命中 _共享/; unfiled=命中 _未归类/; remote=视频在 Release/CDN',
    stats,
    assets,
    orphans,
    vehicles: vehiclesSummary,
    vehiclesWithoutMedia,
    unownedFolders,
    renamedRefs
  };

  if (process.argv.includes('--check')) {
    let prev = null;
    try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 缺文件视为漂移 */ }
    const strip = (o) => JSON.stringify(Object.assign({}, o, { generatedAt: '' }));
    if (!prev || strip(prev) !== strip(out)) {
      console.error('[media-library] 索引与仓库不一致: 请运行 node scripts/gen_media_library.js 并提交产物');
      process.exit(1);
    }
    console.log('[media-library] 索引与仓库一致 ✓');
    return;
  }

  /* 幂等: 内容(除 generatedAt)没变就不写盘。
   *   否则 cron 每 15 分钟刷一次 generatedAt -> 空提交 -> 连带全量 CI/CodeQL/Pages。 */
  let prev = null;
  try { prev = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch (e) { /* 首次生成 */ }
  if (prev && JSON.stringify(Object.assign({}, prev, { generatedAt: '' }))
            === JSON.stringify(Object.assign({}, out, { generatedAt: '' }))) {
    console.log('[media-library] 内容无变化, 跳过写盘 ✓');
    return;
  }
  fs.writeFileSync(OUT, JSON.stringify(out, null, 0), 'utf8');
  console.log('[media-library] 已生成 media_library.json');
  console.log(`  资产 ${stats.total} = 照片 ${stats.photos} + 视频 ${stats.videos}` +
    ` | 正常 ${stats.ok} · 共享 ${stats.shared} · 未归类引用 ${stats.unfiled} · 远程 ${stats.remote} · 缺失 ${stats.missing}` +
    ` | 缺失涉及 ${stats.missingVehicles} 台 | 孤儿 ${stats.orphans} | 有指纹 ${stats.fingerprinted}/${stats.total}`);
  console.log(`  清晰度: 低清素材 ${stats.lowRes} 项(阈值: 照片宽 <${MIN_PHOTO_WIDTH}px)`);
  console.log(`  车型↔资源: ${stats.vehicles} 台车型 · 无素材 ${stats.vehiclesWithoutMedia} 台` +
    ` · 无主目录 ${stats.unownedFolders} 个 · 改名失配 ${stats.renamedRefs} 条`);
}

if (require.main === module) main();

module.exports = { detectRenamedRefs };
