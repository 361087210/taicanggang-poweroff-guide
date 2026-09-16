/**
 * ============================================================
 * test_nav_login_guard.js — V10.19.3: 未登录导航守卫(注册页"返回泄漏"修复)
 * ============================================================
 * 缺陷(用户报): 在注册页按返回(硬件返回键/浏览器返回)后, 落在应用主界面,
 *   并且「我的」页显示硬编码的"组长" → 观感为"自动进入组长已登录界面"。
 * 定性(已核验): **display-only** —— 该路径 state.currentUser===null, isLeader()/canEdit()
 *   均为 false, 不具备任何组长能力; "组长"两字来自 demo.html 的静态占位文本。
 * 根因:
 *   R1 js/08-main.js handleHardwareBack() 缺 screen-register/screen-forgot 分支 → 落 goBack()
 *   R2 js/01-state.js goBack() 无登录守卫, 空栈兜底固定回 screen-vehicles(主界面)
 *   R3 demo.html 用户卡硬编码"组长"; updateMyInfo() 在无用户时直接 return → 残留占位
 *   R4 js/01-state.js showScreen() 未拦"已登录进登录族"(纵深防御)
 * 本测试要求: 先红后绿。修复前 B1/B2/B3/B4/B7 与 S1 必红; 修复后全绿。
 * 运行: node tests/test_nav_login_guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { loadCombinedSource, extractNamedBlock } = require('./e2e_harness');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(n, c, e){ if(c){ pass++; console.log('  [PASS] ' + n); } else { fail++; failures.push(n); console.log('  [FAIL] ' + n + (e !== undefined ? '  -> ' + e : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const SRC = loadCombinedSource();
const demoHtml = src('demo.html');
const stateJs = src('js/01-state.js');
const mainJs = src('js/08-main.js');
const authJs = src('js/02-auth.js');

/* ---------------- S1 静态: 修复点是否就位(修复前必红) ---------------- */
section('S1 修复点存在(静态)');
check('R1 handleHardwareBack 含 screen-register + screen-forgot 分支',
  /state\.screen==='screen-register'/.test(mainJs) && /state\.screen==='screen-forgot'/.test(mainJs));
check('R2 goBack 含"无登录用户"守卫(不得兜底到应用内页)',
  /!state\.currentUser[\s\S]{0,160}screen-login/.test(stateJs));
check('R4 showScreen 含"已登录禁入登录族"守卫',
  /state\.currentUser[\s\S]{0,120}LOGIN_FAMILY_SCREENS\.includes\(id\)/.test(stateJs));
check('R3 demo.html 用户卡不再硬编码"组长"',
  !/user-name[^>]*>\s*组长/.test(demoHtml) && !/user-role[^>]*>\s*组长/.test(demoHtml));
check('R3 demo.html 用户卡改用中性占位(未登录)',
  /user-name[^>]*>\s*未登录/.test(demoHtml));

/* ---------------- 行为级: jsdom + 真实函数提取 ---------------- */
const NAMES = ['state', 'navHistory', 'navPush', 'navPop', 'navReset', 'navRemove', 'navTop',
  'MAIN_TAB_SCREENS', 'LOGIN_FAMILY_SCREENS', '_activateScreen', 'showScreen', 'goBack',
  'isLeader', 'canEdit', 'updateMyInfo', 'handleHardwareBack', 'doubleBackExit'];

function buildSandbox(currentUser){
  const dom = new JSDOM(demoHtml, { url: 'https://tcg.test/demo.html' });
  const win = dom.window;
  const sb = { console, document: win.document, window: win, navigator: win.navigator, setTimeout, clearTimeout };
  sb.lastBackPressTs = 0; // 真实声明所在文件不提取, 以沙箱属性提供(非 strict 下可读写)
  const noop = function(){};
  Object.assign(sb, {
    showToast: noop, renderVehicleList: noop, renderDataList: noop, renderMemberList: noop,
    renderBrandTags: noop, renderSyncLog: noop, loadFeishuConfig: noop, checkCloudDataUpdate: noop,
    _refreshCacheHint: noop, startPendingPolling: noop, stopPendingPolling: noop,
    stopMemberGuardPolling: noop, closePhotoViewer: noop, closeVideoPlayer: noop, closeModal: noop,
    pullPendingFromFeishu: function(){ return Promise.resolve(); }
  });
  vm.createContext(sb);
  NAMES.forEach(function(n){ vm.runInContext(extractNamedBlock(SRC, n), sb, { filename: n + '.js' }); });
  vm.runInContext('state.currentUser=' + (currentUser ? JSON.stringify(currentUser) : 'null') +
    "; navHistory=[]; state.screen='screen-register';", sb);
  return { sb: sb, win: win, run: function(e){ return vm.runInContext(e, sb); } };
}
const LEADER = { id: 'leader1', name: '组长甲', phone: '13800000000', role: 'admin', status: 'active' };

section('S2 原 bug 精确复现(核心断言: 必须落在 screen-login)');
{
  const h = buildSandbox(null);
  h.run('handleHardwareBack()');
  const cur = h.run('state.screen');
  check('B1 无用户 + 注册页按返回 → screen-login', cur === 'screen-login', 'state.screen=' + cur);
  check('B2 且不得落在任何应用内页', ['screen-vehicles', 'screen-data', 'screen-my'].indexOf(cur) < 0, 'state.screen=' + cur);
}

section('S3 空栈兜底专项(结构性不变量: 无用户不得进应用内页)');
{
  const h = buildSandbox(null);
  h.run('navHistory=[]; goBack();');
  check('B3 无用户 + 空栈 goBack → screen-login', h.run('state.screen') === 'screen-login', 'state.screen=' + h.run('state.screen'));
}
{
  const h = buildSandbox(null);
  h.run("navHistory=['screen-my']; goBack();");
  check('B4 无用户 + 栈内残留已登录页 → 仍不得进入应用内页', h.run('state.screen') === 'screen-login', 'state.screen=' + h.run('state.screen'));
}

section('S4 已登录行为不回归');
{
  const h = buildSandbox(LEADER);
  h.run("navHistory=['screen-my']; state.screen='screen-detail'; goBack();");
  check('B5 已登录用户 goBack 仍正常回退(不误伤)', h.run('state.screen') === 'screen-my', 'state.screen=' + h.run('state.screen'));
}
{
  const h = buildSandbox(LEADER);
  h.run("showScreen('screen-register')");
  check('B6 已登录用户 showScreen(注册页) 被拒(R4)', h.run('state.screen') !== 'screen-register', 'state.screen=' + h.run('state.screen'));
}

section('S5 R3 行为级: 未登录时不得显示具体身份');
{
  const h = buildSandbox(null);
  h.run('updateMyInfo()');
  const nameEl = h.win.document.querySelector('#screen-my .user-name');
  const roleEl = h.win.document.querySelector('#screen-my .user-role');
  const nameTxt = nameEl ? nameEl.textContent.trim() : '';
  const roleTxt = roleEl ? roleEl.textContent.trim() : '';
  check('B7 未登录时用户卡不显示"组长"', nameTxt !== '组长' && roleTxt !== '组长', 'name=' + nameTxt + ' / role=' + roleTxt);
}

section('S6 接线门禁(本测试必须可达)');
const pkg = JSON.parse(src('package.json'));
check('package.json 有 test:nav-guard', !!pkg.scripts['test:nav-guard']);
check('test:all 含 test:nav-guard', String(pkg.scripts['test:all'] || '').indexOf('test:nav-guard') >= 0);

console.log('\n==============================================================');
console.log('未登录导航守卫测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
