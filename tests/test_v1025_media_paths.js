/* ===========================================================
 * 测试: test_v1025_media_paths.js
 * -----------------------------------------------------------
 * 背景: 用户需求「图片/视频按车型名称分文件夹存放, GitHub 与飞书一致,
 *   保证媒体与车型准确对应、避免数据错乱(断电教学视频张冠李戴有现场安全隐患)」。
 *   V10.25.0 为此建立单一真源模块 js/00-media-paths.js。
 *
 * 覆盖:
 *   R1 常量契约(顶层目录名不得改名 / 共享目录 / 长度上限)
 *   R2 sanitizeName 清洗规则(与 00-bootstrap.js#_sanitizeFeishuFileName 同规则)
 *      + 新增第 4 参 fallback 语义(不传=时间戳兜底; 传 ''=允许返回空串)
 *   R3 folderNameForVehicle 三级退化 —— 重点回归: "vehicle_<id> 退化分支曾被
 *      sanitizeName 的时间戳兜底架空成死代码" 的缺陷
 *   R4 photoRelPath / videoRelPath 三段/两段组装
 *   R5 parseMediaPath 三代路径兼容(三段/两段/一段)
 *   R6 candidateRelPaths 候选顺序(新式优先)
 *   R7 listMediaFiles / indexMediaFiles 子目录递归枚举(真实 fs)
 *   R8 resolveLocalFile 存在性优先回退(真实 fs)
 *   R9 接线: demo.html 已登记且在 00-bootstrap.js 之前加载
 *
 * 运行: node tests/test_v1025_media_paths.js
 * =========================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const MP = require(path.join(ROOT, 'js', '00-media-paths.js'));

let pass = 0;
let fail = 0;
const failures = [];

function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log('  [PASS] ' + name);
  } else {
    fail++;
    failures.push(name);
    console.log('  [FAIL] ' + name + (extra ? ('  → ' + extra) : ''));
  }
}

function section(t) {
  console.log('\n========== ' + t + ' ==========');
}

/* ---------------- R1 常量契约 ---------------- */
section('R1 常量契约');
check('PHOTO_TOP = vehicle_images(契约目录不得改名)', MP.PHOTO_TOP === 'vehicle_images', MP.PHOTO_TOP);
check('VIDEO_TOP = vehicle_videos(契约目录不得改名)', MP.VIDEO_TOP === 'vehicle_videos', MP.VIDEO_TOP);
check('SHARED_FOLDER = _共享(多车型共用资产)', MP.SHARED_FOLDER === '_共享', MP.SHARED_FOLDER);
check('MAX_FOLDER_LEN 为正整数', Number.isInteger(MP.MAX_FOLDER_LEN) && MP.MAX_FOLDER_LEN > 0, String(MP.MAX_FOLDER_LEN));

/* ---------------- R2 sanitizeName ---------------- */
section('R2 sanitizeName 清洗规则');
check('路径保留字 → 下划线',
  MP.sanitizeName('a/b\\c:d*e?f"g<h>i|j') === 'a_b_c_d_e_f_g_h_i_j',
  MP.sanitizeName('a/b\\c:d*e?f"g<h>i|j'));
check('空白折叠为单下划线',
  MP.sanitizeName('长安  深蓝') === '长安_深蓝', MP.sanitizeName('长安  深蓝'));
check('连续下划线折叠',
  MP.sanitizeName('a___b') === 'a_b', MP.sanitizeName('a___b'));
check('去除 emoji',
  MP.sanitizeName('比亚迪🚗海豚') === '比亚迪海豚', MP.sanitizeName('比亚迪🚗海豚'));
check('去除控制字符', MP.sanitizeName('a\u0000b\u001fc') === 'abc', JSON.stringify(MP.sanitizeName('a\u0000b\u001fc')));
check('首尾下划线/点/空白被裁剪',
  MP.sanitizeName('  _比亚迪_  ') === '比亚迪', MP.sanitizeName('  _比亚迪_  '));
check('普通名称原样返回', MP.sanitizeName('长安深蓝(G318)') === '长安深蓝(G318)', MP.sanitizeName('长安深蓝(G318)'));

const fbDefault = MP.sanitizeName('');
check('默认兜底(不传第4参): 空串 → file_<timestamp> 非空',
  /^file_[0-9a-z]+$/.test(fbDefault), fbDefault);
const fbEmpty = MP.sanitizeName('', 40, false, '');
check('显式 fallback=\'\': 空串 → 空串(目录名场景)', fbEmpty === '', JSON.stringify(fbEmpty));
check('fallback=自定义值生效', MP.sanitizeName('', 40, false, 'X') === 'X');
check('fallback 仅在清洗后为空时生效(非空输入不受影响)',
  MP.sanitizeName('海豚', 40, false, '') === '海豚');
check('截断(不保留扩展名)到 maxLen',
  MP.sanitizeName('一二三四五六七八九十', 5, false, '') === '一二三四五',
  MP.sanitizeName('一二三四五六七八九十', 5, false, ''));
check('截断(保留扩展名)保留 ≤6 字符扩展名',
  MP.sanitizeName('中'.repeat(60) + '.jpeg', 20, true) .endsWith('.jpeg'),
  MP.sanitizeName('中'.repeat(60) + '.jpeg', 20, true));

/* ---------------- R3 folderNameForVehicle(缺陷回归) ---------------- */
section('R3 folderNameForVehicle 三级退化(缺陷回归)');
check('优先 display',
  MP.folderNameForVehicle({ id: 1, display: '比亚迪海豚', series: '海豚', brand: '比亚迪' }) === '比亚迪海豚');
check('无 display → series',
  MP.folderNameForVehicle({ id: 1, series: '海豚', brand: '比亚迪' }) === '海豚');
check('无 display/series → brand',
  MP.folderNameForVehicle({ id: 1, brand: '比亚迪' }) === '比亚迪');
check('★全无名称 → vehicle_<id>(此分支曾被时间戳兜底架空成死代码)',
  MP.folderNameForVehicle({ id: 30 }) === 'vehicle_30',
  MP.folderNameForVehicle({ id: 30 }));
check('★名称仅为 emoji/保留字 → 仍退化到 vehicle_<id>(不是 file_<timestamp>)',
  MP.folderNameForVehicle({ id: 77, display: '🚗🚗' }) === 'vehicle_77',
  MP.folderNameForVehicle({ id: 77, display: '🚗🚗' }));
check('★空对象 → vehicle_unknown(非随机 file_*)',
  MP.folderNameForVehicle({}) === 'vehicle_unknown', MP.folderNameForVehicle({}));
check('★null/undefined → vehicle_unknown',
  MP.folderNameForVehicle(null) === 'vehicle_unknown' && MP.folderNameForVehicle(undefined) === 'vehicle_unknown');
check('超长显示名被截断到 MAX_FOLDER_LEN 以内且非空',
  (function () {
    const n = MP.folderNameForVehicle({ id: 9, display: '超'.repeat(80) });
    return n.length > 0 && n.length <= MP.MAX_FOLDER_LEN;
  })());
check('id 为 0 也可退化(未用真值判断)',
  MP.folderNameForVehicle({ id: 0 }) === 'vehicle_0', MP.folderNameForVehicle({ id: 0 }));
check('返回结果不含路径分隔符/保留字',
  !/[\\/:*?"<>|]/.test(MP.folderNameForVehicle({ id: 5, display: 'a/b:c*d' })));

/* ---------------- R4 photoRelPath / videoRelPath ---------------- */
section('R4 相对路径组装');
check('照片三段式',
  MP.photoRelPath('比亚迪海豚', '比亚迪海豚_p1_ab12cd34.jpeg') === 'vehicle_images/比亚迪海豚/比亚迪海豚_p1_ab12cd34.jpeg');
check('照片两段式(folder 为空)',
  MP.photoRelPath('', 'x.jpeg') === 'vehicle_images/x.jpeg');
check('视频三段式',
  MP.videoRelPath('比亚迪海豚', '比亚迪海豚_v1_ab12cd34.mp4') === 'vehicle_videos/比亚迪海豚/比亚迪海豚_v1_ab12cd34.mp4');
check('视频两段式', MP.videoRelPath(null, 'x.mp4') === 'vehicle_videos/x.mp4');
check('共享资产三段式(_共享)',
  MP.photoRelPath(MP.SHARED_FOLDER, '通用断电视频_p1_00.jpeg') === 'vehicle_images/_共享/通用断电视频_p1_00.jpeg');

/* ---------------- R5 parseMediaPath ---------------- */
section('R5 parseMediaPath 三代兼容');
const p3 = MP.parseMediaPath('vehicle_images/比亚迪海豚/比亚迪海豚_p1_ab.jpeg');
check('三段: top/folder/fileName 正确',
  p3.top === 'vehicle_images' && p3.folder === '比亚迪海豚' && p3.fileName === '比亚迪海豚_p1_ab.jpeg',
  JSON.stringify(p3));
check('三段: isNested=true / isTopOnly=false', p3.isNested === true && p3.isTopOnly === false);
const p2 = MP.parseMediaPath('vehicle_images/image1.jpeg');
check('两段(旧式): top=vehicle_images, folder 空, fileName 正确',
  p2.top === 'vehicle_images' && p2.folder === '' && p2.fileName === 'image1.jpeg', JSON.stringify(p2));
check('两段: isTopOnly=true / isNested=false', p2.isTopOnly === true && p2.isNested === false);
const p1 = MP.parseMediaPath('image1.jpeg');
check('一段: 仅 fileName, top 空',
  p1.top === '' && p1.folder === '' && p1.fileName === 'image1.jpeg', JSON.stringify(p1));
check('反斜杠归一化为正斜杠',
  MP.parseMediaPath('vehicle_images\\比亚迪海豚\\a.jpeg').folder === '比亚迪海豚');
check('首尾斜杠被裁剪',
  MP.parseMediaPath('/vehicle_images/比亚迪海豚/a.jpeg/').raw === 'vehicle_images/比亚迪海豚/a.jpeg');
check('空/空值 → fileName 为空串',
  MP.parseMediaPath('').fileName === '' && MP.parseMediaPath(null).fileName === '');
check('_共享 识别为 isShared',
  MP.parseMediaPath('vehicle_images/_共享/通用断电视频.mp4').isShared === true);
check('普通车型目录 isShared=false',
  MP.parseMediaPath('vehicle_images/比亚迪海豚/a.jpeg').isShared === false);

/* ---------------- R6 candidateRelPaths ---------------- */
section('R6 candidateRelPaths 候选顺序');
const c3 = MP.candidateRelPaths('vehicle_images', 'a.jpeg', '比亚迪海豚');
check('带 folder: 三段在前, 两段兜底, 裸文件名最后',
  c3[0] === 'vehicle_images/比亚迪海豚/a.jpeg' &&
  c3[1] === 'vehicle_images/a.jpeg' &&
  c3[2] === 'a.jpeg',
  JSON.stringify(c3));
const c2 = MP.candidateRelPaths('vehicle_images', 'a.jpeg', '');
check('无 folder: 仅两段 + 裸文件名', c2.length === 2 && c2[0] === 'vehicle_images/a.jpeg', JSON.stringify(c2));

/* ---------------- R7 listMediaFiles / indexMediaFiles(真实 fs) ---------------- */
section('R7 子目录递归枚举(真实 fs)');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-media-'));
try {
  fs.mkdirSync(path.join(tmp, 'vehicle_images', '比亚迪海豚'), { recursive: true });
  fs.mkdirSync(path.join(tmp, 'vehicle_images', '_共享'), { recursive: true });
  fs.writeFileSync(path.join(tmp, 'vehicle_images', '比亚迪海豚', '比亚迪海豚_p1_ab.jpeg'), 'x');
  fs.writeFileSync(path.join(tmp, 'vehicle_images', '_共享', '通用断电视频_p1_cd.jpeg'), 'x');
  fs.writeFileSync(path.join(tmp, 'vehicle_images', 'image1.jpeg'), 'x'); // 旧式扁平, 兼容
  fs.mkdirSync(path.join(tmp, 'vehicle_videos'), { recursive: true });

  const files = MP.listMediaFiles(tmp, 'vehicle_images').sort((a, b) => a.relPath.localeCompare(b.relPath));
  check('listMediaFiles 递归到 3 个文件', files.length === 3, String(files.length) + ' → ' + JSON.stringify(files.map(f => f.relPath)));
  const nested = files.find(f => f.fileName === '比亚迪海豚_p1_ab.jpeg');
  check('子目录文件 relPath 带车型目录', !!nested && nested.relPath === 'vehicle_images/比亚迪海豚/比亚迪海豚_p1_ab.jpeg', nested && nested.relPath);
  check('子目录文件 folder = 车型目录名', !!nested && nested.folder === '比亚迪海豚', nested && nested.folder);
  const shared = files.find(f => f.fileName === '通用断电视频_p1_cd.jpeg');
  check('_共享 目录被识别', !!shared && shared.folder === '_共享', shared && shared.folder);
  const flat = files.find(f => f.fileName === 'image1.jpeg');
  check('旧式扁平文件 folder 为空', !!flat && flat.folder === '', flat && flat.folder);

  const idx = MP.indexMediaFiles(tmp, 'vehicle_images');
  check('indexMediaFiles 索引到 3 个键', Object.keys(idx).length === 3);
  check('索引值 relPath 为新式三段', idx['比亚迪海豚_p1_ab.jpeg'][0] === 'vehicle_images/比亚迪海豚/比亚迪海豚_p1_ab.jpeg');
  check('不存在的顶层目录 → 空数组(不抛异常)', MP.listMediaFiles(tmp, 'no_such_dir').length === 0);

  /* ---------------- R8 resolveLocalFile ---------------- */
  section('R8 resolveLocalFile 存在性优先');
  const rNested = MP.resolveLocalFile(tmp, 'vehicle_images', 'vehicle_images/比亚迪海豚/比亚迪海豚_p1_ab.jpeg');
  check('三段引用命中磁盘真实文件',
    rNested === path.join(tmp, 'vehicle_images', '比亚迪海豚', '比亚迪海豚_p1_ab.jpeg'), rNested);
  const rFallback = MP.resolveLocalFile(tmp, 'vehicle_images', 'vehicle_images/image1.jpeg');
  check('旧式两段引用命中扁平文件',
    rFallback === path.join(tmp, 'vehicle_images', 'image1.jpeg'), rFallback);
  check('磁盘不存在 → 返回空串',
    MP.resolveLocalFile(tmp, 'vehicle_images', 'vehicle_images/不存在的车型/a.jpeg') === '');
  check('只给裸文件名也能命中(兼容)',
    MP.resolveLocalFile(tmp, 'vehicle_images', 'image1.jpeg') === path.join(tmp, 'vehicle_images', 'image1.jpeg'));
} finally {
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* ignore */ }
}

/* ---------------- R9 接线 ---------------- */
section('R9 接线: demo.html 已登记且加载顺序正确');
const html = src('demo.html');
check('demo.html 引入 js/00-media-paths.js',
  html.includes('<script defer src="js/00-media-paths.js"></script>'));
const iMedia = html.indexOf('js/00-media-paths.js');
const iBootstrap = html.indexOf('js/00-bootstrap.js');
const iSync = html.indexOf('js/05-sync.js');
check('00-media-paths 早于 00-bootstrap(先于其 sanitize 用法)',
  iMedia > 0 && iBootstrap > 0 && iMedia < iBootstrap, iMedia + ' vs ' + iBootstrap);
check('00-media-paths 早于 05-sync(上传写回使用方)',
  iMedia > 0 && iSync > 0 && iMedia < iSync);
check('挂载到 window.TCG_MEDIA_PATHS(浏览器端 UMD 全局名)',
  /root\.TCG_MEDIA_PATHS\s*=/.test(src('js/00-media-paths.js')));

/* ---------------- 汇总 ---------------- */
console.log('\n=================================================');
console.log('  test_v1025_media_paths: ' + pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('  失败项:');
  failures.forEach(f => console.log('    - ' + f));
}
console.log('=================================================');
process.exit(fail ? 1 : 0);
