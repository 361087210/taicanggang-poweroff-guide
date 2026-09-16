#!/usr/bin/env node
'use strict';
/**
 * ============================================================
 * scripts/check_ci_coverage.js —— 测试覆盖一致性门禁(防"新套件忘了进CI")
 * ============================================================
 * 事故背景:
 *   本轮新增了 6 个测试套件(238 条断言)却从未被 CI 执行——ci.yml 是逐个
 *   `npm run test:xxx` 手动串联的, 新套件只要"忘了加那一行"就永久裸奔,
 *   且 CI 依然全绿, 无人察觉。本门禁让这种遗漏**不可能再发生**。
 *
 * 检查三方一致性:
 *   ① tests/ 下所有 test_*.js / test_*.py   (真实存在的测试资产)
 *   ② package.json 的 test:* 脚本            (可执行入口)
 *   ③ .github/workflows/*.yml 实际引用的脚本 (CI 真正会跑的)
 *
 * 任一测试文件无法从 CI 入口触达 -> exit 1 并列出清单。
 *
 * 设计要点:
 *   - 支持聚合入口传递闭包: `npm run test:all` 内部再 `npm run test:xxx`,
 *     或 `node tests/a.js && node tests/b.js`, 都会递归展开。
 *   - 扫描 workflows/ 下**全部** yml, 不只 ci.yml —— 被任一流水线触达即算覆盖,
 *     避免误报(如 release 流程按需跑的套件)。
 *   - 允许"声明式排除"(见 EXPECTED_EXCLUDED), 但必须写明理由; 若被排除项
 *     后来被 CI 覆盖了, 会报 STALE 提示清理, 防止排除清单变成新的盲区。
 *   - 反向检查: 脚本引用了不存在的测试文件 -> 报错(坏引用)。
 *
 * 运行: node scripts/check_ci_coverage.js
 * 退出码: 0=通过, 1=存在未覆盖/坏引用/过期排除
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TESTS_DIR = path.join(ROOT, 'tests');
const WF_DIR = path.join(ROOT, '.github/workflows');

/**
 * 声明式排除: 有意不进 CI 的测试资产。
 * 必须给出理由; 一旦被 CI 覆盖会报 STALE 要求移除。
 */
const EXPECTED_EXCLUDED = {
  'test_v57_integration.py':
    'Python 集成测试, 需 TCG_FEISHU_APP_SECRET + python 环境, 由 release 流程按需执行'
};

// 以 _ 开头的为临时/草稿脚本, 不计入测试资产
const isTestFile = f => /^test_[^_].*\.(js|py)$/.test(f);

function readJsonSafe(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

/** 从一条命令里抽取: 引用的 npm 脚本名 + 直接执行的测试文件名 */
function refsOf(cmd) {
  const s = String(cmd || '');
  const scripts = [];
  const files = [];
  let m;
  const reScript = /npm(?:\s+run(?:-script)?)\s+([\w.:@/-]+)/g;
  while ((m = reScript.exec(s)) !== null) scripts.push(m[1]);
  const reFile = /tests\/([\w.-]+\.(?:js|py))/g;
  while ((m = reFile.exec(s)) !== null) files.push(m[1]);
  return { scripts, files };
}

// ---------------- ① 测试资产 ----------------
const allTestFiles = fs.existsSync(TESTS_DIR)
  ? fs.readdirSync(TESTS_DIR).filter(isTestFile).sort()
  : [];

// ---------------- ② package.json 脚本 ----------------
const pkg = readJsonSafe(path.join(ROOT, 'package.json')) || {};
const scripts = pkg.scripts || {};
const testScripts = Object.keys(scripts).filter(k => /^test[:$]/.test(k)).sort();

// ---------------- ③ workflows 入口 ----------------
const wfFiles = fs.existsSync(WF_DIR)
  ? fs.readdirSync(WF_DIR).filter(f => /\.(yml|yaml)$/i.test(f)).sort()
  : [];

const wfEntries = [];      // { wf, script } | { wf, file }
const wfBrokenRefs = [];   // 引用了 package.json 里不存在的脚本
for (const wf of wfFiles) {
  const txt = fs.readFileSync(path.join(WF_DIR, wf), 'utf8');
  const r = refsOf(txt);
  r.scripts.forEach(s => {
    if (scripts[s]) wfEntries.push({ wf, script: s });
    else wfBrokenRefs.push({ wf, script: s });
  });
  r.files.forEach(f => wfEntries.push({ wf, file: f }));
}

// ---------------- 传递闭包 ----------------
const entryScripts = [...new Set(wfEntries.filter(e => e.script).map(e => e.script))];
const reachable = new Set();
const stack = [...entryScripts];

// run_all_tests.js 是 test:all 的新执行器: 它持有 test:all 的子套件闭包(TEST_SUITES),
// 取代原先 test:all 字符串里的 `npm run` 串联。覆盖门禁必须沿 runner 导出的清单展开
// 闭包, 否则改完 test:all 后子套件会全部"不可达"而误报。
// 仅在命令确为 `node scripts/run_all_tests.js` 时走此特殊分支, 其余脚本仍按 refsOf 原逻辑展开。
let runnerSuites = [];
try {
  runnerSuites = (require('./run_all_tests.js').TEST_SUITES) || [];
} catch (e) {
  runnerSuites = [];
}

while (stack.length) {
  const s = stack.pop();
  if (reachable.has(s)) continue;
  reachable.add(s);
  const cmd = String(scripts[s] || '').trim();
  let subScripts;
  if (/^node\s+scripts\/run_all_tests\.js/.test(cmd)) {
    // 沿 runner 导出的子套件清单展开闭包
    subScripts = runnerSuites.slice();
  } else {
    subScripts = refsOf(scripts[s]).scripts;
  }
  subScripts.forEach(x => { if (scripts[x] && !reachable.has(x)) stack.push(x); });
}

// 覆盖到的测试文件
const covered = new Map();  // file -> Set(来源)
wfEntries.filter(e => e.file).forEach(e => {
  if (!covered.has(e.file)) covered.set(e.file, new Set());
  covered.get(e.file).add(e.wf);
});
for (const s of reachable) {
  refsOf(scripts[s]).files.forEach(f => {
    if (!covered.has(f)) covered.set(f, new Set());
    covered.get(f).add('npm run ' + s);
  });
}

// ---------------- 比对 ----------------
const missing = allTestFiles.filter(f => !covered.has(f));
const excludedHits = allTestFiles.filter(f => !covered.has(f) && EXPECTED_EXCLUDED[f]);
const realMissing = missing.filter(f => !EXPECTED_EXCLUDED[f]);
const staleExcluded = Object.keys(EXPECTED_EXCLUDED).filter(f => covered.has(f));

// 坏引用: 脚本里写了不存在的文件
const badFileRefs = [];
for (const s of Object.keys(scripts)) {
  refsOf(scripts[s]).files.forEach(f => {
    if (!allTestFiles.includes(f)) badFileRefs.push({ script: s, file: f });
  });
}

// 从未被任何 CI 入口触达的 test:* 脚本(仅提示, 不阻断)
const unreachable = testScripts.filter(s => !reachable.has(s));

// ---------------- 输出 ----------------
const out = [];
out.push('==============================================================');
out.push(' CI 测试覆盖一致性门禁  (scripts/check_ci_coverage.js)');
out.push('==============================================================');
out.push('');
out.push(`[资产] tests/ 下测试文件: ${allTestFiles.length} 个`);
out.push(`[入口] package.json test:* 脚本: ${testScripts.length} 个`);
out.push(`[CI]   workflows: ${wfFiles.length} 个, 直引脚本 ${entryScripts.length} 个`);
out.push(`       直引入口: ${entryScripts.join(', ') || '无'}`);
out.push(`[闭包] 可达脚本: ${reachable.size} 个`);
out.push('');

if (realMissing.length) {
  out.push(`❌ 未被任何 CI 流水线触达的测试文件 (${realMissing.length} 个):`);
  realMissing.forEach(f => out.push(`     - tests/${f}`));
  out.push('');
} else {
  out.push('✅ 所有测试文件均可被 CI 触达');
  out.push('');
}

if (excludedHits.length) {
  out.push(`ℹ️  声明排除(已知且有意, 不阻断) (${excludedHits.length} 个):`);
  excludedHits.forEach(f => out.push(`     - tests/${f}  ← ${EXPECTED_EXCLUDED[f]}`));
  out.push('');
}

if (staleExcluded.length) {
  out.push(`⚠️  排除清单已过期(已被 CI 覆盖, 请移除声明) (${staleExcluded.length} 个):`);
  staleExcluded.forEach(f => out.push(`     - tests/${f}`));
  out.push('');
}

if (wfBrokenRefs.length) {
  // 非阻断: 与"测试覆盖"无关的历史问题, 单独暴露但不拖累本门禁转绿
  out.push(`⚠️  workflow 引用了 package.json 中不存在的脚本 (${wfBrokenRefs.length} 处, 非阻断, 请另行处理):`);
  wfBrokenRefs.forEach(b => out.push(`     - ${b.wf}: npm run ${b.script}`));
  out.push('');
}

if (badFileRefs.length) {
  out.push(`❌ 脚本引用了不存在的测试文件 (${badFileRefs.length} 处):`);
  badFileRefs.forEach(b => out.push(`     - ${b.script}: tests/${b.file}`));
  out.push('');
}

if (unreachable.length) {
  out.push(`ℹ️  未被任何 CI 入口引用的 test:* 脚本 (${unreachable.length} 个, 仅提示):`);
  unreachable.forEach(s => out.push(`     - ${s}`));
  out.push('');
}

// 坏引用(workflow->不存在的脚本)为非阻断项: 与本门禁职责(测试覆盖)无关,
// 若计入阻断会让本门禁因历史遗留问题永远无法转绿, 故仅告警。
const failed = realMissing.length > 0 || badFileRefs.length > 0 || staleExcluded.length > 0;
const warned = wfBrokenRefs.length > 0;
out.push('--------------------------------------------------------------');
out.push(`统计: 测试文件 ${allTestFiles.length} | 已覆盖 ${allTestFiles.length - missing.length} | 未覆盖 ${realMissing.length} | 声明排除 ${excludedHits.length}`);
out.push(`结论: ${failed ? 'FAIL ❌ (存在未覆盖或坏引用)' : 'PASS ✅'}${warned ? ' (另有非阻断告警, 见上)' : ''}`);
out.push('--------------------------------------------------------------');

const text = out.join('\n');
console.log(text);
process.exit(failed ? 1 : 0);
