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
    check('M5i 缺失数与索引 stats 一致且非零', recomputed.missing === idx.stats.missing && recomputed.missing > 0, String(recomputed.missing));
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

/* ---------------- M8 云端实测 / 上传 / 删除 (V10.26.0 新增) ---------------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));

function cloudSandbox(overrides){
  const els = {};
  function mk(id){
    const el = {
      id: id, innerHTML: '', value: '', style: {},
      classList: { add(){}, remove(){} },
      addEventListener(){},
      querySelectorAll(){ return []; },
      getAttribute(){ return null; },
      click(){},
      appendChild(){}
    };
    if(id === 'ml-pick-vehicle'){
      el.buttons = [{ getAttribute(){ return '1'; }, onclick: null }];
      el.querySelectorAll = function(){ return el.buttons; };
    }
    return el;
  }
  const doc = {
    getElementById(id){ return els[id] || (els[id] = mk(id)); },
    createElement(){ return mk('tmp'); },
    querySelector(){ return null; },
    querySelectorAll(){ return []; },
    body: { appendChild(){} }
  };
  const tree = {
    DATA: [{ type:'folder', name:'vehicle_images', token:'IMG' }, { type:'folder', name:'vehicle_videos', token:'VID' }],
    IMG:  [{ type:'folder', name:'比亚迪秦PLUS', token:'IMGA' }, { type:'folder', name:'_共享', token:'IMGS' }, { type:'file', name:'stray.jpeg', token:'f0', size:9 }],
    IMGA: [{ type:'file', name:'比亚迪秦PLUS_p1_a.jpeg', token:'f1', size:100 }],
    IMGS: [{ type:'file', name:'shared.jpeg', token:'f2', size:20 }],
    VID:  []
  };
  const ledger = {
    schemaVersion: 1,
    generatedAt: '2026-11-23T00:00:00Z',
    stats: {},
    assets: [
      { path:'vehicle_images/比亚迪秦PLUS/比亚迪秦PLUS_p1_a.jpeg', kind:'photo', kindLabel:'照片', status:'ok', vehicleText:'比亚迪秦PLUS', vehicles:[{ id:1, display:'比亚迪秦PLUS' }] },
      { path:'vehicle_images/比亚迪秦PLUS/missing.jpeg', kind:'photo', kindLabel:'照片', status:'missing', vehicleText:'比亚迪秦PLUS', vehicles:[{ id:1, display:'比亚迪秦PLUS' }], missingFor:[{ id:1, display:'比亚迪秦PLUS' }] }
    ],
    orphans: []
  };
  const ctx = {
    window: {}, document: doc, console: console,
    URL: { createObjectURL: () => 'blob:cloud' },
    setTimeout, clearTimeout, fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(ledger)) })
  };
  vm.createContext(ctx);
  ctx.window.VEHICLES = [{ id:1, display:'比亚迪秦PLUS',
    photoPaths:['vehicle_images/比亚迪秦PLUS/比亚迪秦PLUS_p1_a.jpeg','vehicle_images/比亚迪秦PLUS/missing.jpeg'],
    videoPaths: [] }];
  ctx.VEHICLES = ctx.window.VEHICLES;
  ctx.window.FeishuAPI = ctx.FeishuAPI = {
    getTenantToken: async () => 'tok',
    driveDeleteFile: async () => { ctx._deleted = (ctx._deleted || 0) + 1; }
  };
  ctx.getDataFolderToken = async () => 'DATA';
  ctx.feishuListFiles = async (t, folderToken) => tree[folderToken] || [];
  ctx._feishuListCache = {};
  ctx.httpFetch = async () => ({ data: { token: 'NEWFOLDER' } });
  ctx.httpUploadFileSmart = async () => ({ code: 0 });
  ctx.feishuDownloadFile = async () => ({ type: 'image/jpeg' });
  ctx.TCG_MEDIA_PATHS = {
    folderNameForVehicle: v => v.display,
    photoRelPath: (f, n) => 'vehicle_images/' + f + '/' + n,
    videoRelPath: (f, n) => 'vehicle_videos/' + f + '/' + n
  };
  ctx.canEdit = () => true;
  ctx.showToast = () => {};
  ctx.showConfirm = (t, m, cb) => cb();
  ctx.State = { updateVehicle(id, patch){ Object.assign(ctx.window.VEHICLES.find(v => v.id === id), patch); } };
  if (overrides) Object.assign(ctx, overrides);
  vm.runInContext(src('js/13-media-library.js'), ctx, { filename: MOD });
  return { ctx, els };
}

(async function(){
  const env = cloudSandbox();
  const M = env.ctx.window.MediaLibrary;
  const html = () => env.els['screen-media-library'].innerHTML;

  section('M8 云端实测');
  M.open();
  await sleep(30);
  check('M8a 台账可离线渲染', html().indexOf('资源库') >= 0 && html().indexOf('缺失') >= 0, html().slice(0, 80));

  await M.checkCloud();
  await sleep(20);
  check('M8b 云端存在标记', html().indexOf('云端✓') >= 0);
  check('M8c 云端缺失标记', html().indexOf('云端✗') >= 0);
  check('M8d 无台账文件计数', /无台账 2/.test(html()), html().match(/无台账 \d+/));
  check('M8e 孤儿并入列表', html().indexOf('stray.jpeg') >= 0);

  section('M8 上传 / 删除');
  M.uploadFlow();
  const pick = env.els['ml-pick-vehicle'];
  check('M8f 车型选择弹层', !!pick && pick.innerHTML.indexOf('比亚迪秦PLUS') >= 0);
  env.els['ml-upload-input'] = { value: '', click(){} };
  pick.buttons[0].onclick();
  await M.onUploadFiles([{ name: 'new.jpg', type: 'image/jpeg', size: 2048 }]);
  await sleep(20);
  const v = env.ctx.window.VEHICLES[0];
  check('M8g 上传后回写引用', v.photoPaths.length === 3 && /_p3_/.test(v.photoPaths[2]), JSON.stringify(v.photoPaths));
  check('M8h 上传后台账即时可见', html().indexOf('_p3_') >= 0);

  try { M.deleteCloud('vehicle_images/车型不存在/stray.jpeg'); } catch(e){}
  M.deleteCloud('vehicle_images/stray.jpeg');
  await sleep(30);
  /* V10.28.0: 删除改为软删除(移入回收站), 不再直接调云端删除接口 */
  check('M8i 删除只入回收站、不删云端文件', !env.ctx._deleted && M.isTrashed('vehicle_images/stray.jpeg'),
    'deleted=' + env.ctx._deleted + ' trashed=' + M.isTrashed('vehicle_images/stray.jpeg'));
  check('M8j 删除后列表移除', html().indexOf('stray.jpeg') < 0);
  check('M8k 无台账计数递减', /无台账 1/.test(html()), html().match(/无台账 \d+/));

  M.preview('vehicle_images/_共享/shared.jpeg');
  await M.loadCloudPreview('vehicle_images/_共享/shared.jpeg');
  check('M8l 云端加载预览', env.els['ml-preview-body'].innerHTML.indexOf('blob:cloud') >= 0);

  /* ---------------- M9 索引加载兜底 (V10.26.0 修复: App 内加载失败) ---------------- */
  section('M9 索引加载兜底(fetch → XHR → 线上)');
  const IDX = {
    schemaVersion: 1, generatedAt: '2026-11-23T00:00:00Z', stats: {},
    assets: [{ path: 'vehicle_images/测试车/x.jpeg', kind: 'photo', kindLabel: '照片', status: 'ok', vehicleText: '测试车', vehicles: [] }],
    orphans: []
  };
  function XhrOk(data){
    return function(){
      const self = this;
      this.open = function(){};
      this.send = function(){ self.status = 200; self.responseText = JSON.stringify(data); setTimeout(function(){ self.onload && self.onload(); }, 0); };
    };
  }
  function XhrStatus(code){
    return function(){
      const self = this;
      this.open = function(){};
      this.send = function(){ self.status = code; self.responseText = ''; setTimeout(function(){ self.onload && self.onload(); }, 0); };
    };
  }
  function XhrNetErr(){
    return function(){
      const self = this;
      this.open = function(){};
      this.send = function(){ setTimeout(function(){ self.onerror && self.onerror(); }, 0); };
    };
  }
  const badJsonFetch = async () => ({ ok: true, json: async () => ({ assets: null }) });

  async function openWith(overrides){
    const e = cloudSandbox(overrides);
    e.ctx.window.MediaLibrary.open();
    await sleep(30);
    return e.els['screen-media-library'].innerHTML;
  }

  const h9a = await openWith({ fetch: async () => ({ ok: true, json: async () => IDX }) });
  check('M9a fetch 可用时直接渲染', h9a.indexOf('x.jpeg') >= 0);

  const h9b = await openWith({
    fetch: async () => ({ ok: false, status: 404 }),
    XMLHttpRequest: XhrOk(IDX)
  });
  check('M9b fetch 404 → XHR 兜底成功(file/app 协议)', h9b.indexOf('x.jpeg') >= 0);

  const h9c = await openWith({
    fetch: async () => { throw new Error('Failed to fetch'); },
    XMLHttpRequest: XhrStatus(500),
    httpFetch: async () => IDX
  });
  check('M9c fetch+XHR 均失败 → 线上索引兜底', h9c.indexOf('x.jpeg') >= 0);

  const h9d = await openWith({
    fetch: async () => { throw new Error('Failed to fetch'); },
    XMLHttpRequest: XhrNetErr(),
    httpFetch: () => { throw new Error('offline'); }
  });
  check('M9d 全部失败给出可定位错误', h9d.indexOf('资源索引加载失败') >= 0 && h9d.indexOf('offline') >= 0, h9d.slice(0, 120));

  const h9e = await openWith({
    fetch: async (url) => String(url).indexOf('https://') === 0
      ? { ok: true, json: async () => IDX }
      : { ok: false, status: 404 },
    XMLHttpRequest: undefined,
    httpFetch: undefined
  });
  check('M9e 无 XHR/httpFetch 时仍可经 fetch 拉线上索引', h9e.indexOf('x.jpeg') >= 0);

  const h9f = await openWith({
    fetch: badJsonFetch,
    XMLHttpRequest: XhrOk({ assets: null }),
    httpFetch: async () => ({ assets: null })
  });
  check('M9f 索引格式异常可提示', h9f.indexOf('索引格式异常') >= 0, h9f.slice(0, 120));

  section('M9 索引随 App 打包');
  const androidWf = src('.github/workflows/android-release.yml');
  const iosWf = src('.github/workflows/ios-release.yml');
  check('M9g Android 打包拷入索引', androidWf.indexOf('cp media_library.json tcg_app/www/') >= 0 &&
    androidWf.indexOf('test -s tcg_app/www/media_library.json') >= 0);
  check('M9h iOS 打包拷入索引', iosWf.indexOf('cp media_library.json tcg_app/www/') >= 0 &&
    iosWf.indexOf('test -s tcg_app/www/media_library.json') >= 0);

  /* ---------------- M10 分页渲染 ---------------- */
  section('M10 分页渲染(50 条/页)');
  const many = {
    schemaVersion: 1, generatedAt: '2026-11-23T00:00:00Z',
    assets: Array.from({ length: 120 }, (_, i) => ({
      path: 'vehicle_images/A/f' + i + '.jpeg', kind: 'photo', kindLabel: '照片',
      status: 'ok', vehicleText: 'A', vehicles: []
    })),
    orphans: []
  };
  const envP = cloudSandbox({ fetch: async () => ({ ok: true, json: async () => many }) });
  /* 纯分页用例: 清空车型引用, 避免实时引用并集影响总条数 */
  envP.ctx.window.VEHICLES = [];
  envP.ctx.VEHICLES = [];
  const MP = envP.ctx.window.MediaLibrary;
  const H = () => envP.els['screen-media-library'].innerHTML;
  const rowCount = () => (H().match(/data-ml-key=/g) || []).length;
  MP.open();
  await sleep(30);
  check('M10a 首页只渲染 50 行', rowCount() === 50, 'rows=' + rowCount());
  check('M10b 页码与总数', H().indexOf('共 120 项') >= 0 && H().indexOf('第 1/3 页') >= 0 && H().indexOf('1 / 3') >= 0);
  MP.setPage(2);
  check('M10c 末页余数 20 行', rowCount() === 20 && H().indexOf('3 / 3') >= 0, 'rows=' + rowCount());
  MP.setPage(99);
  check('M10d 越界钳制在末页', H().indexOf('3 / 3') >= 0);
  MP.setFilter('missing');
  check('M10e 筛选后回到第 1 页且无分页条', H().indexOf('共 0 项') >= 0 && H().indexOf('id="ml-pager"') < 0);
  MP.setFilter('all');
  MP.setPage(1);
  /* ---------------- M11 车型 ↔ 资源库双向联动 ---------------- */
  section('M11 车型 ↔ 资源库双向联动(纯函数)');
  const LV = [
    { id: 1, display: 'A', photoPaths: ['vehicle_images/A/x1.jpeg', 'vehicle_images/A/miss.jpeg', 'vehicle_images/_共享/s.jpeg'], videoPaths: [] },
    { id: 2, display: 'B', photoPaths: ['vehicle_images/_共享/s.jpeg'], videoPaths: ['vehicle_videos/B/v1.mp4'] },
    { id: 3, display: 'C', photoPaths: [], videoPaths: [] }
  ];
  const live = MP.liveAssetsOf(LV);
  check('M11a 实时引用覆盖照片/视频', live.length === 4 && live.some(a => a.kind === 'video'), JSON.stringify(live.map(a => a.path)));
  const shared = live.find(a => a.path.indexOf('/_共享/') >= 0);
  check('M11b 同一路径多车共享合并为一行', !!shared && shared.vehicles.length === 2 && shared.vehicleText === 'A、B', shared && shared.vehicleText);
  check('M11c 新引用默认标"新增"', live.every(a => a.status === 'new'));
  check('M11d 新增筛选项可命中', MP.filterAssets(live, 'new', '').length === live.length);

  const statics = [
    { path: 'vehicle_images/A/x1.jpeg', status: 'ok', vehicles: [{ id: 1, display: 'A' }], vehicleText: 'A' },
    { path: 'vehicle_images/A/gone.jpeg', status: 'ok', vehicles: [{ id: 1, display: 'A' }], vehicleText: 'A' },
    { path: 'vehicle_images/A/miss.jpeg', status: 'missing', vehicles: [{ id: 1, display: 'A' }], vehicleText: 'A', missingFor: [{ id: 1 }] },
    { path: 'vehicle_images/_未归类/o.jpeg', status: 'orphan', vehicles: [], vehicleText: '未归类' }
  ];
  const merged = MP.mergeAssets(statics, live);
  check('M11e 合并保留静态行且不重复', merged.filter(a => a.path === 'vehicle_images/A/x1.jpeg').length === 1 &&
    merged.find(a => a.path === 'vehicle_images/A/x1.jpeg').status === 'ok');
  check('M11f 车型不再引用的静态行被剔除', !merged.some(a => a.path === 'vehicle_images/A/gone.jpeg'));
  check('M11g 仍缺失的行保留', merged.some(a => a.path === 'vehicle_images/A/miss.jpeg'));
  check('M11h 孤儿行不受引用裁剪影响', merged.some(a => a.path === 'vehicle_images/_未归类/o.jpeg'));
  check('M11i 索引未收录的新引用补进来', merged.some(a => a.path === 'vehicle_videos/B/v1.mp4' && a.status === 'new'));
  check('M11j 合并后行数正确', merged.length === 5, 'len=' + merged.length);

  section('M12 车型计数随媒体变更');
  const p12 = MP.mediaPatchOf({ id: 1, photos: 99, videos: 99, photoPaths: ['a', 'b'], videoPaths: ['v'] });
  check('M12a photos/videos 由路径现算(不沿用陈旧计数)', p12.photos === 2 && p12.videos === 1, JSON.stringify(p12));
  check('M12b 路径原样回写', p12.photoPaths.length === 2 && p12.videoPaths[0] === 'v');
  const empty12 = MP.mediaPatchOf({});
  check('M12c 空车型安全', empty12.photos === 0 && empty12.videos === 0 &&
    Array.isArray(empty12.photoPaths) && Array.isArray(empty12.videoPaths));
  const p12d = MP.mediaPatchOf({ photoPaths: ['p1', 'p2'], photoSections: ['key'], photoLabels: ['钥匙'] });
  check('M12d 新增照片补齐板块/标签(与路径等长)', p12d.photoSections.length === 2 &&
    p12d.photoSections[0] === 'key' && p12d.photoSections[1] === 'exterior' &&
    p12d.photoLabels.length === 2 && p12d.photoLabels[1] === '', JSON.stringify(p12d));
  const p12e = MP.mediaPatchOf({ photoPaths: ['p1'], photoSections: ['key', 'position'], photoLabels: ['钥匙', '断电'] });
  check('M12e 删除照片后元数据截断到等长', p12e.photoSections.length === 1 && p12e.photoSections[0] === 'key' &&
    p12e.photoLabels.length === 1 && p12e.photoLabels[0] === '钥匙');

  section('M13 资源库删文件 ↔ 车型照片板块/标签同步剔除');
  const v13 = { id: 9, photoPaths: ['a', 'b', 'c'], photoSections: ['exterior', 'key', 'position'], photoLabels: ['车头', '钥匙', '断电'] };
  const linked13 = MP.unlinkPathOf(v13, 'b');
  check('M13a 命中引用返回 true 并移除路径', linked13 === true && v13.photoPaths.join(',') === 'a,c', v13.photoPaths.join(','));
  check('M13b 板块随下标同步剔除(不前移错位)', v13.photoSections.join(',') === 'exterior,position', v13.photoSections.join(','));
  check('M13c 标签随下标同步剔除', v13.photoLabels.join(',') === '车头,断电', v13.photoLabels.join(','));
  const patch13 = MP.mediaPatchOf(v13);
  check('M13d 计数与路径一致', patch13.photos === 2 && patch13.photoSections.length === 2 && patch13.photoLabels.length === 2);
  check('M13e 未命中引用返回 false 且不改数据', MP.unlinkPathOf(v13, 'zzz') === false && v13.photoPaths.length === 2);
  check('M13f 空车型/非法路径安全', MP.unlinkPathOf(null, 'a') === false && MP.unlinkPathOf({}, null) === false);
  const v13v = { id: 10, videoPaths: ['v1', 'v2'], photoPaths: [] };
  check('M13g 视频引用同样可解除', MP.unlinkPathOf(v13v, 'v1') === true && v13v.videoPaths.join(',') === 'v2');

  finish();
})().catch(function(e){
  check('M8 云端用例执行', false, e && e.message);
  finish();
});

function finish(){
  console.log('\n==============================================================');
  console.log('资源库回归汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
}
