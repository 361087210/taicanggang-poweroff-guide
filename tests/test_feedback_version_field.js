/**
 * ============================================================
 * test_feedback_version_field.js — F0-a: 反馈「APP版本」字段取值修复
 * ============================================================
 * 缺陷: js/10-feedback.js 提交反馈时用 `'V' + (window.APP_VERSION || 'unknown')`
 *   构造 Bitable 的「APP版本」字段。但 APP_VERSION 是 js/00-bootstrap.js 的
 *   **顶层 `const`**(全局词法绑定, 不挂到 window 对象) → `window.APP_VERSION`
 *   恒为 undefined → 该字段**永远写入 'Vunknown'**。
 *   同文件 `:281` 的 `appVersion: APP_VERSION || 'unknown'` 是**正确参照**(裸名)。
 *
 * 断言 (F0-a):
 *   F1 js/10-feedback.js 源码不含 `window.APP_VERSION`
 *   F2 全仓 js/*.js 与 demo.html 不含 `window.APP_VERSION`(防其它地方复发)
 *   F3 「APP版本」字段由**裸** APP_VERSION 构造(与 :281 同款)
 *   F4 交叉真源: 00-bootstrap.js 的 `const APP_VERSION` === version.json.version
 *   F5 正确参照写法 `appVersion: APP_VERSION || 'unknown'` 仍在(防被误删)
 *
 * 运行: node tests/test_feedback_version_field.js
 * 要求: 先红后绿——修复前应失败(红), 修复后全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if(cond){ pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }

const feedbackJs = src('js/10-feedback.js');

/* ---------- F1: 目标文件不得再用 window.APP_VERSION ---------- */
section('F1 js/10-feedback.js 不含 window.APP_VERSION');
check('F1a 10-feedback.js 无 window.APP_VERSION(顶层 const 不是 window 属性)',
  !/window\s*\.\s*APP_VERSION/.test(feedbackJs));

/* ---------- F2: 全仓 js/ 与 demo.html 扫描(防复发) ---------- */
section('F2 全仓扫描: js/*.js 与 demo.html 不含 window.APP_VERSION');
const jsDir = path.join(ROOT, 'js');
const jsFiles = fs.existsSync(jsDir) ? fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort() : [];
const offenders = [];
for(const f of jsFiles){
  const t = src(path.join('js', f));
  if(/window\s*\.\s*APP_VERSION/.test(t)) offenders.push('js/' + f);
}
if(fs.existsSync(path.join(ROOT, 'demo.html'))){
  if(/window\s*\.\s*APP_VERSION/.test(src('demo.html'))) offenders.push('demo.html');
}
check('F2a 扫描器确实扫过 js/ 目录(防目录为空假通过)', jsFiles.length > 0, 'jsFiles=' + jsFiles.length);
check('F2b 全仓无 window.APP_VERSION 残留', offenders.length === 0, offenders.join(', '));

/* ---------- F3: 「APP版本」由裸 APP_VERSION 构造 ---------- */
section("F3 「APP版本」字段由裸 APP_VERSION 构造(与 :281 同款)");
check("F3a 'APP版本' 键存在", /['"]APP版本['"]\s*:/.test(feedbackJs));
check("F3b 'APP版本' 取值为 'V' + 裸 APP_VERSION(可选括号/兜底)",
  /['"]APP版本['"]\s*:\s*['"]V['"]\s*\+\s*\(*\s*APP_VERSION\b/.test(feedbackJs));

/* ---------- F4: 交叉真源校验 ---------- */
section('F4 交叉真源: 00-bootstrap APP_VERSION === version.json.version');
const bootM = src('js/00-bootstrap.js').match(/const\s+APP_VERSION\s*=\s*'([^']+)'/);
const verVer = String(JSON.parse(src('version.json')).version);
check('F4a 00-bootstrap 定义 const APP_VERSION', !!bootM, bootM && bootM[1]);
check('F4b APP_VERSION === version.json.version', !!bootM && bootM[1] === verVer,
  'bootstrap=' + (bootM && bootM[1]) + ' version.json=' + verVer);

/* ---------- F5: 正确参照写法仍在(防被误删) ---------- */
section('F5 正确参照写法仍在(裸名, 防被误改回)');
check('F5a appVersion: APP_VERSION || \'unknown\' 仍在(裸名参照)',
  /appVersion\s*:\s*APP_VERSION\s*\|\|/.test(feedbackJs));

console.log('\n==============================================================');
console.log('F0-a 反馈版本字段测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
