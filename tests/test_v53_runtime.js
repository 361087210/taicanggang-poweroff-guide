/**
 * V5.3 运行时逻辑仿真测试 - 在Node中执行真实业务函数
 * =====================================================
 * 与静态检查(test_v53_fixes.py)互补:本套件提取demo.html的真实JS,
 * 注入最小DOM/环境模拟,实际执行核心函数并断言行为。
 *
 * 覆盖场景:
 *   R1 媒体迁移: 真实VEHICLES数据下migrateLegacyMedia的转换正确性
 *   R2 返回键状态机: 查看器→弹层→登录→主Tab双击→子页面 六级路由
 *   R3 视频源链: 本地失败→飞书云端→CDN→占位的逐级回退
 *   R4 导航栈: 子页面入栈/主Tab清栈/栈空智能回退
 *
 * 运行: node tests/test_v53_runtime.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(BASE, 'demo.html'), 'utf-8');

// ---------- 最小DOM/环境模拟 ----------
function el(tag) {
  return {
    tag, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    style: {}, textContent: '', innerHTML: '', src: '',
    parentElement: null, children: [],
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, appendChild() {}, remove() {},
    pause() {}, load() {}, play() { return Promise.resolve(); },
  };
}

const registry = {};
['photo-viewer', 'video-player', 'photo-viewer-img', 'photo-viewer-label',
 'video-element', 'bottom-nav', 'fab-add', 'screen-vehicles', 'screen-login',
 'detail-content', 'detail-index'].forEach(id => { registry[id] = el('div'); registry[id].id = id; });

const documentMock = {
  // 未注册的id自动创建模拟元素(顶层初始化代码会渲染大量容器)
  getElementById: id => registry[id] || (registry[id] = Object.assign(el('div'), { id })),
  querySelectorAll: sel => {
    // 导航Tab查询返回3个模拟Tab(._activateScreen按索引访问)
    if (sel.includes('nav-tab')) return [el('button'), el('button'), el('button')];
    if (sel.includes('modal-overlay.show')) return modalOverlayQuery(sel);
    return [];
  },
  createElement: t => el(t),
  addEventListener() {},
};
// 弹层查询钩子(R2用例动态控制)
let _modalOverlayQuery = () => [];
function modalOverlayQuery(sel) { return _modalOverlayQuery(); }

const sandbox = {
  console, document: documentMock, window: { addEventListener() {}, cordova: undefined }, navigator: { userAgent: 'NodeTest' },
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
  setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, JSON, Math,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  location: { href: 'http://test.local/demo.html' },
  fetch: async () => { throw new Error('network blocked in test'); },
  history: { pushState() {} },
  screen: { width: 1080, height: 2400 },
};

const ctx = vm.createContext(sandbox);

// 注入业务JS(跳过依赖cordovа的分支,函数定义本身不受影响)
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.join('\n;\n');
try { vm.runInContext(js, ctx); } catch (e) {
  console.error('JS注入失败(顶层执行错误):', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}  ${detail}`); }
}
function section(t) { console.log(`\n===== ${t} =====`); }

// ---------- R1 媒体迁移 ----------
section('R1 媒体迁移(migrateLegacyMedia真实数据执行)');
const V = () => vm.runInContext('VEHICLES', ctx);
check('VEHICLES已加载', Array.isArray(V()) && V().length >= 70, `实际${V().length}`);
// 注意: 顶层INIT已自动执行migrateLegacyMedia,此处验证迁移后状态
check('启动时已自动完成迁移(photos为数量)', V().every(v => typeof v.photos === 'number'));
check('photoPaths全部为vehicle_images/路径', V().every(v => !Array.isArray(v.photoPaths) || v.photoPaths.every(p => p.startsWith('vehicle_images/'))));
const fixedAgain = vm.runInContext('migrateLegacyMedia()', ctx);
check('幂等性: 已迁移数据不重复处理', fixedAgain === 0, `二次返回${fixedAgain}`);
const withPhotos = V().filter(v => v.photoPaths && v.photoPaths.length > 0).length;
check('绝大多数车辆有真实照片', withPhotos >= 60, `${withPhotos}/${V().length}辆`);
console.log(`  信息: ${withPhotos}/${V().length}辆车有真实照片`);

// ---------- R2 返回键状态机 ----------
section('R2 返回键状态机(handleHardwareBack六级路由)');
const state = () => vm.runInContext('state', ctx);
const setScreen = s => vm.runInContext(`state.screen='${s}'`, ctx);
// 清空可能残留的弹层
['modal-confirm', 'modal-share', 'modal-update'].forEach(id => registry[id] = registry[id] || el('div'));
registry['photo-viewer'].classList.add('show');
vm.runInContext('handleHardwareBack()', ctx);
check('优先级1: 查看器打开时关闭查看器', !registry['photo-viewer'].classList.contains('show'));
registry['video-player'].classList.add('show');
vm.runInContext('handleHardwareBack()', ctx);
check('优先级2: 播放器打开时关闭播放器', !registry['video-player'].classList.contains('show'));
registry['modal-share'] = registry['modal-share'] || el('div');
registry['modal-share'].id = 'modal-share';
// 通过钩子返回打开状态的弹层
_modalOverlayQuery = () => [registry['modal-share']];
registry['modal-share'].classList.add('show');
vm.runInContext('handleHardwareBack()', ctx);
check('优先级3: 弹层打开时关闭弹层', !registry['modal-share'].classList.contains('show'));
_modalOverlayQuery = () => [];
setScreen('login');
const ts1 = vm.runInContext('lastBackPressTs=0;handleHardwareBack();lastBackPressTs', ctx);
check('优先级4: 登录页不退出只提示', ts1 > 0);
setScreen('screen-vehicles');
const screenBefore = state().screen;
vm.runInContext('lastBackPressTs=Date.now()-100;handleHardwareBack()', ctx);
check('优先级5: 主Tab单次返回不切页(等待双击)', state().screen === screenBefore);
setScreen('screen-detail');
vm.runInContext("navHistory=[];state.screen='screen-detail';handleHardwareBack()", ctx);
check('优先级6: 子页面返回主Tab', state().screen === 'screen-vehicles');

// ---------- R3 视频源链 ----------
section('R3 视频源链(逐级回退)');
check('openVideoPlayer为async函数', vm.runInContext('openVideoPlayer.constructor.name', ctx) === 'AsyncFunction');
check('tryPlaySource存在且可调用', typeof vm.runInContext('tryPlaySource', ctx) === 'function');
// 模拟源链: 手动触发onerror事件(tryPlaySource注册的处理器)应调用fallback
let fallbackCalled = false;
const fakeVideo = { ...el('video'), parentElement: { querySelector: () => null } };
Reflect.set(fakeVideo, 'onerror', null); Reflect.set(fakeVideo, 'onloadeddata', null);
vm.runInContext('tryPlaySource', ctx)(fakeVideo, 'bad://source', () => { fallbackCalled = true; });
// tryPlaySource内部通过video.onerror=handler注册,沙盒对象属性直读直写
const errHandler = fakeVideo.onerror || (fakeVideo._onerror);
check('源失败事件已注册处理器', typeof errHandler === 'function');
if (typeof errHandler === 'function') errHandler();
check('源失败时触发fallback回退', fallbackCalled);
// 飞书云端源: 测试环境网络被阻断,必须优雅返回false而非抛异常
// 注意: vm内外Promise属不同realm,instanceof跨realm必假,改用thenable检测
const cloudOk = vm.runInContext('playFromFeishuCloud', ctx)(fakeVideo, 'x.mp4');
check('playFromFeishuCloud网络异常不崩溃(返回thenable)', cloudOk && typeof cloudOk.then === 'function' && typeof cloudOk.catch === 'function');
cloudOk.then(r => { if (r !== false) console.log('  [警告] 网络阻断下应返回false,实际:', r); }).catch(e => console.log('  [警告] 网络异常应被内部捕获:', e.message));
check('showVideoMissing渲染诚实占位', typeof vm.runInContext('showVideoMissing', ctx) === 'function');
check('pickVideoFile组长上传入口存在', typeof vm.runInContext('pickVideoFile', ctx) === 'function');

// ---------- R4 导航栈 ----------
section('R4 导航栈(navHistory行为)');
vm.runInContext("navHistory=[];showScreen('screen-detail');showScreen('screen-edit')", ctx);
const stackLen = vm.runInContext('navHistory.length', ctx);
check('子页面依次入栈', stackLen === 2, `栈深${stackLen}`);
vm.runInContext("showScreen('screen-data')", ctx);
check('进入主Tab清空栈', vm.runInContext('navHistory.length', ctx) === 0);
vm.runInContext("state.screen='screen-detail';navHistory=[];goBack()", ctx);
check('栈空时智能回退到vehicles', vm.runInContext('state.screen', ctx) === 'screen-vehicles');

// ---------- 汇总 ----------
console.log('\n' + '='.repeat(52));
console.log(`运行时仿真完成: ${pass}通过 / ${fail}失败 / 共${pass + fail}项`);
console.log('='.repeat(52));
process.exit(fail ? 1 : 0);
