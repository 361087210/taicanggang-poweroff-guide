/**
 * ============================================================
 * test_v1030_validate_web_assets.js — validate_web_assets appSecret 校验测试
 * ============================================================
 * Bug: scripts/validate_web_assets.js 第 85 行的 DEFAULT_FEISHU_CONFIG 块提取
 *      正则 `/const DEFAULT_FEISHU_CONFIG\s*=\s*\{([\s\S]*?)\n\};?\n/` 未处理
 *      CRLF 行尾(仓库为 \r\n), `\n\};?\n` 匹配不到 `\r\n};\r\n`, 导致非贪婪
 *      `[\s\S]*?` 过度延伸到 getFeishuCfg() 内部, 捕获到合法的
 *      `appSecret: savedSecret || pick('appSecret',...)` 行 → 被
 *      `/^\s*appSecret\s*:/m` 命中 → DEFAULT_HAS_NO_SECRET_LINE 恒 false →
 *      校验恒走 fail 分支(误报"未找到 appSecret 合规形态", exit 1)。
 *
 * 期望: 修复后 validate_web_assets.js 对干净源码运行通过(exit 0, 无 FAIL)。
 *
 * 运行: node tests/test_v1030_validate_web_assets.js
 * 要求: 先红后绿——修复前 exit 1(红), 修复后 exit 0(绿)。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const scriptPath = path.join(ROOT, 'scripts', 'validate_web_assets.js');

section('静态');
check('validate_web_assets.js 存在', fs.existsSync(scriptPath));
const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';
check('块提取正则处理 CRLF(含 \\s*\\n 吸收 \\r)', script.includes('\\s*\\n'));

section('动态: 对干净源码运行通过');
try {
  const r = execFileSync(process.execPath, ['scripts/validate_web_assets.js'], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  check('validate_web_assets.js 运行通过(exit 0, 无 FAIL)', !/\[FAIL\]/.test(r), (r.split('\n').filter(l => /FAIL/.test(l)).join(' | ')).slice(0, 200));
} catch (e) {
  const out = (e.stdout || '') + (e.stderr || '');
  check('validate_web_assets.js 运行通过(exit 0, 无 FAIL)', false, (out.split('\n').filter(l => /FAIL/.test(l)).join(' | ')).slice(0, 200));
}

console.log('\n==============================================================');
console.log('validate_web_assets 校验测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
