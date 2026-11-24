/**
 * ============================================================
 * test_v10267_error_reporting.js — 全局错误捕获与诊断回归 (V10.26.7)
 * ============================================================
 * 行业标准缺口: 本项目此前没有任何全局错误捕获, 现场白屏只能等用户反馈。
 * 本套件钉住:
 *   E1 模块可在无 DOM 环境加载, 导出 install/capture/drain/buildPayload/sanitize/pushCapped
 *   E2 sanitize 掩码手机号/邮箱/身份证（落盘前就去 PII）
 *   E3 pushCapped 环形缓冲: 新的在前、超长截断
 *   E4 buildPayload 字段完整、超长截断、带版本号
 *   E5 capture → drain 端到端: 本地缓冲落盘且已脱敏
 *   E6 install 幂等且同时挂 error / unhandledrejection
 *   E7 自动上报限流常量（1 小时 1 条）
 *   E8 接线: demo.html 尽早加载、sw 预缓存、我的页有「复制诊断信息」
 *
 * 运行: node tests/test_v10267_error_reporting.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------- 沙箱: window + localStorage + 极简 navigator ---------- */
const store = {};
const localStorage = {
  getItem: (k) => (k in store ? store[k] : null),
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; }
};
const listeners = {};
const sandbox = {
  console,
  localStorage,
  navigator: { userAgent: 'TestAgent/1.0' },
  APP_VERSION: '10.26.7',
  screen: { width: 430, height: 932 },
  setTimeout, clearTimeout, Promise,
  document: { createElement: () => ({ style: {}, select() {} }), body: { appendChild() {}, removeChild() {} }, execCommand: () => true }
};
sandbox.window = sandbox;
sandbox.addEventListener = (ev, fn) => { listeners[ev] = fn; };
vm.createContext(sandbox);
vm.runInContext(src('js/17-error-report.js'), sandbox, { filename: 'js/17-error-report.js' });
const R = sandbox.TCGErrorReport;

section('E1 模块可用性');
check('E1a 挂到 window.TCGErrorReport', !!R);
['install', 'capture', 'drain', 'buildPayload', 'sanitize', 'pushCapped'].forEach(fn => {
  check('E1 ' + fn + ' 是函数', typeof R[fn] === 'function');
});

section('E2 PII 掩码');
check('E2a 手机号掩码', R.sanitize('用户 13812345678 出错') === '用户 <phone> 出错', R.sanitize('用户 13812345678 出错'));
check('E2b 邮箱掩码', R.sanitize('mail a.b@c.com 失败') === 'mail <email> 失败');
check('E2c 身份证掩码', R.sanitize('身份证 110101199001011234').indexOf('<id>') >= 0);
check('E2d 超长截断到 600 字符', R.sanitize('x'.repeat(2000)).length === 600);

section('E3 环形缓冲');
const capped = R.pushCapped([1, 2, 3], 0, 3);
check('E3a 新的在前', JSON.stringify(capped) === JSON.stringify([0, 1, 2]), JSON.stringify(capped));
check('E3b 超出上限截断', capped.length === 3 && R.MAX === 20);

section('E4 buildPayload');
const p = R.buildPayload({ msg: 'boom 13800001111', src: 'js/a.js', line: 12, col: 3, stack: 'S'.repeat(2000) });
check('E4a 必填字段齐全', !!p.ts && p.msg && p.src === 'js/a.js' && p.line === 12 && p.col === 3);
check('E4b 带 appVersion 与平台', p.appVersion === '10.26.7' && p.platform.indexOf('TestAgent') >= 0);
check('E4c 堆栈截断', p.stack.length <= 600);
check('E4d msg 已脱敏', p.msg.indexOf('13800001111') < 0 && p.msg.indexOf('<phone>') >= 0);

section('E5 capture → drain 端到端');
R.capture({ msg: 'Err 13999998888', src: 'js/x.js', line: 1 });
const got = R.drain();
check('E5a 已落本地缓冲', got.length === 1);
check('E5b 落盘内容已脱敏', JSON.stringify(got).indexOf('13999998888') < 0);
check('E5c 清空可用', (R.clear(), R.drain().length === 0));

section('E6 install 行为');
check('E6a 加载即自动安装', sandbox.__tcgErrInstalled === true);
check('E6b 已挂 error 监听', typeof listeners['error'] === 'function');
check('E6c 已挂 unhandledrejection 监听', typeof listeners['unhandledrejection'] === 'function');
check('E6d 重复 install 幂等（返回 false）', R.install() === false);

section('E7 上报限流');
check('E7a 限流窗口 = 1 小时', R.SUBMIT_INTERVAL_MS === 3600000);

section('E8 接线');
const demo = src('demo.html');
check('E8a demo.html 加载了错误模块', demo.indexOf('js/17-error-report.js') >= 0);
const idxErr = demo.indexOf('js/17-error-report.js');
const idxBoot = demo.indexOf('js/00-bootstrap.js');
check('E8b 早于 00-bootstrap 加载（才能覆盖启动期异常）', idxErr >= 0 && idxBoot > idxErr, 'err@' + idxErr + ' boot@' + idxBoot);
check('E8c sw.js 预缓存该模块', src('sw.js').indexOf("'./js/17-error-report.js'") >= 0);
check('E8d 我的页有「复制诊断信息」入口', demo.indexOf('copyDiagnostics()') >= 0 && demo.indexOf('复制诊断信息') >= 0);

console.log('\n==============================================================');
console.log('错误捕获回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
