/**
 * ============================================================
 * test_crypto_capability_ux.js — 提交组A: 设备加密能力自检 + 迁移失败两因区分
 * ============================================================
 * 背景(team-lead 裁定的独立根因):
 *   hashPassword 在 crypto.subtle 不可用时**静默降级 SHA-256**(App 仍能登录),
 *   故"能登录"不能证明加密能力可用; 而 deriveLinkKey 无兜底, 不可用时返回 null
 *   → linkKey 迁移静默失败, 用户升级到 10.19.2 也可能修不好且屏幕无提示。
 * 覆盖:
 *   A1 00-bootstrap.js 提供 probeCryptoCapability(探测 crypto.subtle + PBKDF2)
 *   A2 关于页(11-about.js)显示"安全升级所需加密能力: 可用/不可用"并异步填充
 *   A3 demo.html 有 #security-hint 提示容器
 *   A4 02-auth.js 两因**分开**提示(不再静默): ①设备不支持 ②回传云端失败
 *   A5 ①的指引=换较新手机/联系组长; ②的指引=检查网络 + **重试入口**
 *   A6 行为级(jsdom+vm): 两因渲染出**不同**文案; ②含重试按钮, ①不含
 * 运行: node tests/test_crypto_capability_ux.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(n, c, e){ if(c){ pass++; console.log('  [PASS] ' + n); } else { fail++; failures.push(n); console.log('  [FAIL] ' + n + (e !== undefined ? '  -> ' + e : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const boot = src('js/00-bootstrap.js');
const about = src('js/11-about.js');
const auth = src('js/02-auth.js');
const demo = src('demo.html');
const pkg = JSON.parse(src('package.json'));

section('A1 加密能力探测原语(00-bootstrap.js)');
check('定义 probeCryptoCapability', /async\s+function\s+probeCryptoCapability\s*\(/.test(boot));
check('探测 crypto.subtle 可用性', /probeCryptoCapability[\s\S]{0,300}crypto\.subtle/.test(boot));
check('探测用 _pbkdf2Hex 实际派生(非仅存在性判断)', /probeCryptoCapability[\s\S]{0,400}_pbkdf2Hex\s*\(/.test(boot));

section('A2 关于页显示加密能力(11-about.js)');
check('有"运行环境自检"卡片', about.indexOf('运行环境自检') >= 0);
check('有加密能力展示位 about-crypto-cap', about.indexOf('about-crypto-cap') >= 0);
check('渲染后调用 probeCryptoCapability 异步填充', /probeCryptoCapability\s*\(\s*\)/.test(about));
check('结果文案含 可用 / 不可用 两态', about.indexOf("'可用'") >= 0 && about.indexOf("'不可用'") >= 0);
check('不可用时给出指引(换较新手机/联系组长)', /不可用[\s\S]{0,400}(较新的手机|联系组长)/.test(about));

section('A3 提示容器(demo.html)');
check('存在 #security-hint', demo.indexOf('id="security-hint"') >= 0);

section('A4 两因分开提示(02-auth.js, 不再静默)');
check('定义 _showCryptoUnavailableHint(原因①: 设备不支持)', /function\s+_showCryptoUnavailableHint\s*\(/.test(auth));
check('定义 _showLinkKeySyncFailedHint(原因②: 回传失败)', /function\s+_showLinkKeySyncFailedHint\s*\(/.test(auth));
check('doLogin 缺 linkKey 分支: deriveLinkKey 返回空 → 调设备不支持提示',
  /if\s*\(\s*lk\s*\)[\s\S]{0,600}?else\s*\{[\s\S]{0,200}_showCryptoUnavailableHint\s*\(/.test(auth));
check('doLogin 回推 catch 内 → 调回传失败提示(替代旧的仅 console.warn)',
  /catch\s*\(e\)\s*\{[\s\S]{0,160}_showLinkKeySyncFailedHint\s*\(/.test(auth));
check('旧的"仅 console.warn 后即结束"的静默形态已消除',
  !/catch\s*\(e\)\s*\{\s*console\.warn\('\[linkKey\]回推失败:',e\.message\);\s*\}/.test(auth));

section('A5 两因指引不同 + 重试入口');
check('①指引含"较新的手机"或"联系组长"', /_showCryptoUnavailableHint[\s\S]{0,300}(较新的手机|联系组长)/.test(auth));
check('②指引含"检查网络"', /_showLinkKeySyncFailedHint[\s\S]{0,300}检查网络/.test(auth));
check('②带重试入口(按钮 onclick=retryLinkKeySync)', /retryLinkKeySync\(\)/.test(auth));
check('定义重试函数 retryLinkKeySync', /window\.retryLinkKeySync\s*=\s*async\s+function/.test(auth));

section('A6 行为级(jsdom + vm): 两因渲染出不同文案');
try {
  const { JSDOM } = require('jsdom');
  const { extractNamedBlock } = require('./e2e_harness');
  const dom = new JSDOM(demo, { url: 'https://tcg.test/demo.html' });
  const win = dom.window;
  const toasts = [];
  const blocks = ['_securityHintEl', '_renderSecurityHint', '_showCryptoUnavailableHint', '_showLinkKeySyncFailedHint']
    .map(n => extractNamedBlock(auth, n)).join('\n');
  const sb = { document: win.document, window: win, showToast: function(t){ toasts.push(String(t)); } };
  vm.createContext(sb);
  vm.runInContext(blocks, sb, { filename: 'security-hints.js' });

  // 原因①
  sb._showCryptoUnavailableHint();
  const el = win.document.getElementById('security-hint');
  const html1 = el ? el.innerHTML : '';
  check('A6a ①渲染后 #security-hint 可见', !!el && !el.classList.contains('hidden'));
  check('A6b ①文案=设备不支持加密能力', html1.indexOf('不支持所需加密能力') >= 0, html1.slice(0, 70));
  check('A6c ①不含重试按钮(重试对"设备不支持"无意义)', html1.indexOf('retryLinkKeySync') < 0);

  // 原因②
  sb._showLinkKeySyncFailedHint();
  const html2 = el ? el.innerHTML : '';
  check('A6d ②文案=回传云端失败', html2.indexOf('回传云端失败') >= 0, html2.slice(0, 70));
  check('A6e ②含重试按钮(retryLinkKeySync)', html2.indexOf('retryLinkKeySync') >= 0);
  check('A6f 两因文案不同(未合成一句"升级失败")', html1 !== html2);
  check('A6g 两因分别触发了独立 toast', toasts.length >= 2 && toasts[0] !== toasts[1]);
} catch (e) {
  check('A6 行为级 harness 可运行', false, e.message);
}

section('A7 接线门禁(本测试必须可达)');
check('package.json 有 test:crypto-capability', !!pkg.scripts['test:crypto-capability']);
check('test:all 含 test:crypto-capability', String(pkg.scripts['test:all'] || '').indexOf('test:crypto-capability') >= 0);

console.log('\n==============================================================');
console.log('提交组A 加密能力自检+两因区分 测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
