/**
 * ============================================================
 * test_v1016_self_learning.js - V10.16.0 AI自主进化·阶段1 测试
 * ============================================================
 * 覆盖矩阵:
 *  A组 静态结构: 排序自学习函数/照片手势引擎/智能高清回退/视频预取/
 *      DOM徽标与背景关闭/UI样式(touch-action)/埋点接入
 *  B组 排序自学习行为: 频次记录递增/无记录保持原序/频次降序重排/
 *      同频回退id序/上限200裁剪/不污染VEHICLES原始序/损坏JSON容错
 *  C组 照片手势引擎: 锚点缩放数学/越界钳制/拖拽后click抑制/
 *      背景点击关闭(图片点击不关闭)/state同步
 *  D组 版本一致性: 三源对齐 V10.16.0
 *
 * 运行: node tests/test_v1016_self_learning.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCombinedSource, extractNamedBlock } = require('./e2e_harness');

const ROOT = path.join(__dirname, '..');
const src = loadCombinedSource();
const html = fs.readFileSync(path.join(ROOT, 'demo.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
const configXml = fs.readFileSync(path.join(ROOT, 'config.xml'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name); }
}
function section(title) {
  console.log('\n==============================================================');
  console.log(title);
  console.log('==============================================================');
}

// ---------- 沙箱: localStorage + DOM mock ----------
function makeSandbox(extra) {
  const removedClasses = [];
  const fakeViewer = { id: 'photo-viewer', style: {}, classList: { remove(c) { removedClasses.push(c); }, add(c) { }, contains: () => false } };
  const fakeImg = { id: 'photo-viewer-img', style: {}, offsetWidth: 400, offsetHeight: 600, naturalWidth: 433, naturalHeight: 606, src: '' };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
    document: {
      getElementById(id) {
        if (id === 'photo-viewer') return fakeViewer;
        if (id === 'photo-viewer-img') return fakeImg;
        return null; // photo-zoom-badge等缺省→函数须自带判空
      },
    },
    window: null, // 稍后指向自身
    __viewer: fakeViewer, __img: fakeImg, // 供C组事件模拟引用
    VEHICLES: [], BRANDS: [],
    state: { searchQuery: '', brandFilter: 'all', photoZoom: 1 },
  };
  sandbox.window = sandbox;
  sandbox.innerWidth = 400; sandbox.innerHeight = 800;
  Object.assign(sandbox, extra || {});
  const ctx = vm.createContext(sandbox);
  return { sandbox, ctx, removedClasses, fakeImg, fakeViewer, run: expr => vm.runInContext(expr, ctx, { filename: 'v1016_eval.js' }) };
}
function inject(ctx, names) {
  for (const n of names) vm.runInContext(extractNamedBlock(src, n), ctx, { filename: 'v1016#' + n + '.js' });
}

const SORT_FUNCS = ['VEHICLE_VIEW_KEY', '_loadViewCounts', 'recordVehicleView', 'filterVehicles'];
const GESTURE_FUNCS = ['_pv', '_g', '_pvApply', '_pvReset', '_pvClampPan', '_pvZoomTo', '_pinchDist', 'cycleZoom', 'photoViewerBgClick', 'closePhotoViewer'];

(function main() {

// =============================================================
section('A组: 静态结构(排序自学习/手势引擎/高清回退/视频预取)');
// =============================================================
check('A1 recordVehicleView 频次埋点函数存在', /function recordVehicleView\(id\)\{/.test(src));
check('A2 filterVehicles 内联频次读取并降序重排(纯函数自包含)', /JSON\.parse\(localStorage\.getItem\('vehicle_view_counts'\)/.test(src) && /cm\[b\.id\]\|\|0\)-\(cm\[a\.id\]\|\|0/.test(src));
check('A3 手势引擎核心函数齐全(锚点缩放/钳制/绑定)', /function _pvZoomTo\(s,ax,ay\)\{/.test(src) && /function _pvClampPan\(\)\{/.test(src) && /function _pvBindGestures\(\)\{/.test(src));
check('A4 photoViewerBgClick 背景关闭函数存在', /function photoViewerBgClick\(e\)\{/.test(src));
check('A5 _tryHdUpgrade 智能高清回退函数存在', /function _tryHdUpgrade\(img,fileName\)\{/.test(src));
check('A6 prefetchVehicleVideo 视频预取函数存在', /function prefetchVehicleVideo\(\)\{/.test(src));
check('A7 _fetchFeishuImageBlobUrl 云端取图助手存在', /function _fetchFeishuImageBlobUrl\(fileName\)\{/.test(src));
check('A8 详情页埋点接入(openVehicleDetail)', /recordVehicleView\(id\);/.test(src) && /prefetchVehicleVideo\(\);/.test(src));
check('A9 最近查看持久化(tcg_recent_vehicles读写)', /tcg_recent_vehicles/.test(src));
check('A10 demo.html 缩放倍数徽标DOM存在', /id="photo-zoom-badge"/.test(html));
check('A11 demo.html 背景关闭绑定存在', /id="photo-viewer" onclick="photoViewerBgClick\(event\)"/.test(html));
check('A12 css 放行自研手势(touch-action:none)', /touch-action:none/.test(css));

// =============================================================
section('B组: 排序自学习行为(感知→频次→重排)');
// =============================================================
{
  const sb = makeSandbox({ VEHICLES: [
    { id: 1, display: '车A', pinyin: 'chea', series: 'S1', brand: '品牌X', brandId: 'bx', position: 'P1' },
    { id: 2, display: '车B', pinyin: 'cheb', series: 'S2', brand: '品牌X', brandId: 'bx', position: 'P2' },
    { id: 3, display: '车C', pinyin: 'chec', series: 'S3', brand: '品牌Y', brandId: 'by', position: 'P3' },
  ] });
  inject(sb.ctx, SORT_FUNCS);

  check('B1 首次查看记录n=1', sb.run('recordVehicleView(3); JSON.parse(localStorage.getItem("vehicle_view_counts"))["3"].n') === 1);
  check('B2 重复查看n递增(3次→3)', sb.run('recordVehicleView(3); recordVehicleView(3); JSON.parse(localStorage.getItem("vehicle_view_counts"))["3"].n') === 3);
  // B3: 临时清空频次存储验证"零记录=原始序",验证后恢复(供B4继续用id3记录)
  const saved = sb.sandbox.localStorage.getItem('vehicle_view_counts');
  sb.sandbox.localStorage.removeItem('vehicle_view_counts');
  check('B3 无任何记录时列表保持原始id序', sb.run('filterVehicles("","all").map(v=>v.id).join()') === '1,2,3');
  sb.sandbox.localStorage.setItem('vehicle_view_counts', saved);
  check('B4 有记录时按频次降序重排(id3频次3→首位)', sb.run('recordVehicleView(1); filterVehicles("","all").map(v=>v.id).join()') === '3,1,2');
  // B5: 清空后仅给1、2各记一次→同频按id序,无记录的3殿后
  sb.sandbox.localStorage.removeItem('vehicle_view_counts');
  check('B5 同频次回退id序(1与2各看1次→1在前)', sb.run('recordVehicleView(1); recordVehicleView(2); filterVehicles("","all").map(v=>v.id).join()') === '1,2,3');
  check('B6 重排不污染VEHICLES原始序', sb.run('filterVehicles("","all"); VEHICLES.map(v=>v.id).join()') === '1,2,3');
  check('B7 品牌过滤后仍按频次重排(品牌X内id3频次最高但属品牌Y→排除)', sb.run('filterVehicles("","bx").map(v=>v.id).join()') === '1,2');
  check('B8 损坏JSON容错(不抛错,回退原始序)', (() => { sb.sandbox.localStorage.setItem('vehicle_view_counts', '{bad json'); try { return sb.run('filterVehicles("","all").map(v=>v.id).join()') === '1,2,3'; } catch (e) { return false; } })());

  // 上限200裁剪
  const sb2 = makeSandbox({ VEHICLES: [] });
  inject(sb2.ctx, SORT_FUNCS);
  check('B9 记录上限200(201条时低频被裁剪)', sb2.run(`
    let survived=true;
    try{
      for(let i=1;i<=201;i++){ recordVehicleView('id'+i); }
      const keys=Object.keys(JSON.parse(localStorage.getItem("vehicle_view_counts")));
      survived = keys.length<=200;
    }catch(e){ survived=false; }
    survived`) === true);
}

// =============================================================
section('C组: 照片手势引擎(锚点缩放/钳制/拖拽抑制/背景关闭)');
// =============================================================
{
  const sb = makeSandbox({});
  inject(sb.ctx, GESTURE_FUNCS);

  // C1 锚点缩放: 屏幕400x800,图片400x600。从1x缩放到2x,锚点(300,400)
  // cx=200,cy=300 → tx += (300-200)*(1-2/1) = -100
  sb.run('_pvReset()');
  sb.run('_pvZoomTo(2, 300, 400)');
  check('C1 锚点缩放数学正确(scale=2, tx=-100)', sb.run('_pv.scale') === 2 && sb.run('_pv.tx') === -100);

  // C2 越界钳制: 图片400x600放大2x=800x1200,屏幕400x800
  // maxX=(800-400)/2=200, maxY=(1200-800)/2=200
  sb.run('_pvReset(); _pv.scale=2; _pv.tx=999; _pv.ty=-999; _pvClampPan()');
  check('C2 平移越界钳制(tx=±200封顶)', sb.run('_pv.tx') === 200 && sb.run('_pv.ty') === -200);

  // C3 拖拽后click抑制
  sb.run('_pvReset()');
  sb.run('_g.suppressClick=true; cycleZoom()');
  check('C3 拖拽后click被抑制(不触发缩放切换,仍为1x)', sb.run('_pv.scale') === 1 && sb.run('_g.suppressClick') === false);

  // C4 单击在点击位置放大到2.5x
  sb.run('_pvReset(); _g.tapX=300; _g.tapY=400; cycleZoom()');
  check('C4 单击触发2.5x放大', sb.run('_pv.scale') === 2.5);

  // C5 再次单击还原1x(平移归零)
  sb.run('cycleZoom()');
  check('C5 再次单击还原1x(平移归零)', sb.run('_pv.scale') === 1 && sb.run('_pv.tx') === 0 && sb.run('_pv.ty') === 0);

  // C6 背景点击触发关闭
  sb.removedClasses.length = 0;
  sb.run('photoViewerBgClick({target:__viewer})');
  check('C6 背景点击触发关闭(移除show)', sb.removedClasses.includes('show'));

  // C7 图片点击不误关闭
  sb.removedClasses.length = 0;
  sb.run('photoViewerBgClick({target:__img})');
  check('C7 图片点击不误关闭', !sb.removedClasses.includes('show'));

  // C8 state.photoZoom与手势引擎同步
  sb.run('_pvReset(); _g.tapX=300; _g.tapY=400; cycleZoom()');
  check('C8 state.photoZoom与手势引擎同步', sb.sandbox.state.photoZoom === 2.5);
}

// =============================================================
section('D组: 版本一致性(三源对齐 V10.16.7)');
check('D1 version.json = 10.16.7', versionJson.version === '10.16.7');
check('D2 config.xml version = 10.16.7', /version="10\.16\.7"/.test(configXml));
check('D3 APP_VERSION = 10.16.7', /APP_VERSION='10\.16\.7'/.test(src));

// =============================================================
section('结果');
// =============================================================
console.log(`${pass} 通过 / ${fail} 失败`);
if (fail > 0) {
  console.log('失败项:');
  failures.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
}
console.log('V10.16.0 AI自主进化·阶段1 测试全部通过 ✓');

})();
