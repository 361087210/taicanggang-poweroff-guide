/**
 * ============================================================
 * test_v10257_media_library.js — 资源库(照片/视频台账)回归
 * ============================================================
 * 覆盖:
 *   M1 模块可加载且导出纯函数(无 DOM 环境下不炸)
 *   M2 filterAssets: 状态筛选 / 类型筛选 / 关键字(车型名·文件名) / 组合
 *   M3 statsOf: 由 assets+orphans 现算(不信任索引里的 stats)
 *   M4 humanSize / missingListText(补拍清单可直接发给运营)
 *   M5 索引契约: docs/media_library.json 字段完整、stats 与实算一致、无 U+FFFD
 *   M6 接线: demo.html 屏幕容器 + 脚本 + 两个入口; goBack 映射; sw.js 预缓存
 *   M7 生成器幂等: node scripts/gen_media_library.js --check 退出码 0
 *
 * 运行: node tests/test_v10257_media_library.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------------- M1 加载模块（无 document，只有 window 桩） ---------------- */
const MOD = path.join(ROOT, 'js', '13-media-library.js');
let ML = null;
try {
  const sandbox = { window: {}, console: console, fetch: function(){ return Promise.reject(new Error('no net')); } };
  sandbox.window.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(src('js/13-media-library.js'), sandbox, { filename: MOD });
  ML = sandbox.window.MediaLibrary;
} catch (e) {
  check('M1a 模块可在无 DOM 环境加载', false, e.message);
}

section('M1 模块导出');
check('M1a 模块可在无 DOM 环境加载', !!ML, ML ? '' : 'window.MediaLibrary 未生成');
check('M1b 导出 4 个纯函数', !!(ML && ML.filterAssets && ML.statsOf && ML.humanSize && ML.missingListText));

/* ---------------- 夹具 ---------------- */
const A = [
  { path: 'vehicle_images/A/image1.jpeg', kind: 'photo', kindLabel: '照片', status: 'ok', vehicleText: '比亚迪海豚', vehicles: [{ id: 1, display: '比亚迪海豚' }] },
  { path: 'vehicle_images/_共享/image2.jpeg', kind: 'photo', kindLabel: '照片', status: 'shared', vehicleText: '比亚迪海豚 等 2 台', vehicles: [{ id: 1 }, { id: 2 }] },
  { path: 'vehicle_images/B/image3.jpeg', kind: 'photo', kindLabel: '照片', status: 'missing', vehicleText: '长安深蓝', vehicles: [{ id: 3, display: '长安深蓝' }], missingFor: [{ id: 3, display: '长安深蓝' }] },
  { path: 'tcgv_abcdef.mp4', kind: 'video', kindLabel: '视频', status: 'remote', vehicleText: '上汽名爵', vehicles: [{ id: 4, display: '上汽名爵' }] }
];
const O = [{ path: 'vehicle_images/_未归类/image99.jpeg', kind: 'photo', kindLabel: '照片', status: 'orphan', vehicleText: '未归类(无车型引用)', vehicles: [] }];

if (ML) {
  section('M2 filterAssets');
  check('M2a all 返回全部', ML.filterAssets(A, 'all', '').length === 4);
  check('M2b missing 只留缺失', ML.filterAssets(A, 'missing', '').length === 1 && ML.filterAssets(A, 'missing', '')[0].path.includes('image3'));
  check('M2c shared 只留共享', ML.filterAssets(A.concat(O), 'shared', '').length === 1);
  check('M2d remote 只留云端视频', ML.filterAssets(A, 'remote', '')[0].kind === 'video');
  check('M2e orphan 只留孤儿', ML.filterAssets(A.concat(O), 'orphan', '').length === 1);
  check('M2f photo/video 按类型收窄', ML.filterAssets(A, 'photo', '').length === 3 && ML.filterAssets(A, 'video', '').length === 1);
  check('M2g 关键字命中车型名', ML.filterAssets(A, 'all', '深蓝').length === 1);
  check('M2h 关键字命中文件名', ML.filterAssets(A, 'all', 'image2').length === 1);
  check('M2i 关键字大小写不敏感', ML.filterAssets(A, 'all', 'IMAGE2').length === 1);
  check('M2j 类型 + 关键字组合', ML.filterAssets(A, 'photo', '名爵').length === 0);
  check('M2k 空输入不炸', ML.filterAssets(null, 'all', '') .length === 0 && ML.filterAssets(undefined, 'missing', '').length === 0);

  section('M3 statsOf');
  const st = ML.statsOf(A, O);
  check('M3a total 含 orphans', st.total === 5, JSON.stringify(st));
  check('M3b 照片/视频计数', st.photos === 4 && st.videos === 1, JSON.stringify(st));
  check('M3c 各状态计数正确', st.ok === 1 && st.shared === 1 && st.missing === 1 && st.remote === 1 && st.orphan === 1, JSON.stringify(st));

  section('M4 humanSize / missingListText');
  check('M4a humanSize 0 空串', ML.humanSize(0) === '');
  check('M4b humanSize KB', ML.humanSize(1024) === '1.0KB', ML.humanSize(1024));
  check('M4c humanSize MB', ML.humanSize(1048576) === '1.0MB', ML.humanSize(1048576));
  const txt = ML.missingListText(A);
  const lines = txt.split('\n');
  check('M4d 首行为表头(车型/类型/文件)', /^车型\t类型\t文件$/.test(lines[0]), lines[0]);
  check('M4e 只含缺失项且带车型名', lines.length === 2 && lines[1].indexOf('长安深蓝') >= 0 && lines[1].indexOf('image3.jpeg') >= 0, lines[1]);
}

/* ---------------- M5 索引契约 ---------------- */
section('M5 media_library.json(仓库根) 契约');
let idx = null;
try { idx = JSON.parse(src('media_library.json')); } catch (e) { check('M5a 索引可解析', false, e.message); }
check('M5a 索引可解析', !!idx);
if (idx) {
  check('M5b schemaVersion=1', idx.schemaVersion === 1);
  check('M5c assets/orphans 均为数组', Array.isArray(idx.assets) && Array.isArray(idx.orphans));
  check('M5d 每个资产字段完整', idx.assets.every(a => a.path && a.kind && a.status && Array.isArray(a.vehicles)),
    JSON.stringify(idx.assets.find(a => !(a.path && a.kind && a.status)) || null));
  check('M5e 缺失资产带 missingFor', idx.assets.filter(a => a.status === 'missing').every(a => Array.isArray(a.missingFor) && a.missingFor.length));
  check('M5f 孤儿状态恒为 orphan', idx.orphans.every(a => a.status === 'orphan'));
  if (ML) {
    const recomputed = ML.statsOf(idx.assets, idx.orphans);
    check('M5g 文件里的 stats 与实算一致 missing', idx.stats.missing === recomputed.missing, idx.stats.missing + ' vs ' + recomputed.missing);
    check('M5h 文件里的 stats 与实算一致 total', idx.stats.total === recomputed.total, idx.stats.total + ' vs ' + recomputed.total);
    check('M5i 缺失数与 audit:media 口径一致(63)', recomputed.missing === 63, String(recomputed.missing));
  }
  check('M5j 索引无 U+FFFD', src('media_library.json').indexOf('\uFFFD') < 0);
}

/* ---------------- M6 接线 ---------------- */
section('M6 接线(demo.html / goBack / sw.js)');
const demo = src('demo.html');
check('M6a 屏幕容器存在', demo.indexOf('id="screen-media-library"') > 0);
check('M6b 脚本已加载', demo.indexOf('js/13-media-library.js') > 0);
check('M6c 我的页入口存在', demo.indexOf('id="menu-media-library"') > 0);
check('M6d 侧滑菜单入口存在', demo.indexOf('id="side-menu-media-library"') > 0);
check('M6e 返回键映射到 screen-my', /screen-media-library'\)\{[^}]*screen-my/.test(src('js/01-state.js').replace(/\s+/g, '')) ||
  src('js/01-state.js').indexOf("screen==='screen-media-library'") > 0);
check('M6f sw.js 预缓存新模块', src('sw.js').indexOf("'./js/13-media-library.js'") > 0);
check('M6g 索引文件随仓库发布(非 gitignore)', !fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('media_library'));

/* ---------------- M7 生成器幂等 ---------------- */
section('M7 生成器幂等(--check)');
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'gen_media_library.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
check('M7a --check 退出码 0(索引与仓库一致)', r.status === 0, (r.stdout || '') + (r.stderr || ''));

console.log('\n==============================================================');
console.log('资源库回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
