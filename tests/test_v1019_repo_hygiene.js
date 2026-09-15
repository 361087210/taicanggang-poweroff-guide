/* ============================================================
 * V10.19.1 仓库卫生门禁: 测试产物不得入库 + 测试不得依赖 gitignore 状态
 * 运行: node tests/test_v1019_repo_hygiene.js
 *
 * 背景(Bug 3):
 *   tests/v1010_e2e_results.json / v1010_solutions_results.json /
 *   v1011_mirror_sync_results.json 由三个测试**写入**, 但被 git 跟踪, 且全仓
 *   无人读取(docs/TEST_MATRIX.md 只把它们列为"历史结果产物")。每次跑测试
 *   都产生 diff 污染, 淹没有意义的代码改动。
 *
 * 背景(Bug 2 的常驻守卫):
 *   team-lead 报称存在一条"CI-011"测试, 依赖"存在未跟踪文件"来触发, 一旦
 *   .gitignore 增加规则就会误失败。我在本工作区**未能定位**该测试(详见
 *   给 code-auditor 的求证消息)。因此这里不猜测它的实现, 而是把**它想守的
 *   那条性质**抽出来做成常驻断言:
 *       任何测试都不得依赖 git 的工作区状态(未跟踪文件 / gitignore 规则)。
 *   这样无论 CI-011 是否存在、以及将来是否新增类似测试, 加 .gitignore 规则
 *   都不会再弄挂测试。H2b 用**变异**验证: 临时往 .gitignore 追加规则,
 *   三个产物生产测试必须仍然通过。
 * =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if(cond){ pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }

/** 在 ROOT 下跑 git, 返回 stdout; 仓库不可用返回 null */
function git(args){
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch (e) {
    return null;
  }
}
function runNode(rel){
  try {
    execFileSync('node', [rel], { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return 0;
  } catch (e) {
    return 1;
  }
}

const KNOWN_ARTIFACTS = [
  'tests/v1010_e2e_results.json',
  'tests/v1010_solutions_results.json',
  'tests/v1011_mirror_sync_results.json'
];

/* ===== S1 git 环境可用性 ===== */
section('S0 前置: git 环境');
const trackedRaw = git(['ls-files']);
check('S0a 当前处于可用的 git 仓库(否则本套件的 git 断言全部失去意义)', trackedRaw !== null, 'git ls-files 失败');
const tracked = (trackedRaw || '').split('\n').filter(Boolean);

/* ===== S1 测试产物不得入库 ===== */
section('S1 测试产物不得被 git 跟踪');
const stillTracked = KNOWN_ARTIFACTS.filter(f => tracked.indexOf(f) >= 0);
check('S1a 三个已知 results.json 产物均已从 git 移除', stillTracked.length === 0, stillTracked.join(', '));
const anyTrackedResults = tracked.filter(f => /^tests\/.*_results\.json$/.test(f));
check('S1b git 中不存在任何 tests/*_results.json', anyTrackedResults.length === 0, anyTrackedResults.join(', '));

/* ===== S2 .gitignore 必须覆盖产物模式 ===== */
section('S2 .gitignore 覆盖测试产物(防再次入库)');
const giPath = path.join(ROOT, '.gitignore');
check('S2a .gitignore 存在', fs.existsSync(giPath));
const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
check('S2b 含测试产物忽略规则', /tests\/\*_results\.json|tests\/\*\.json/.test(gi), '(未找到忽略规则)');

// 用 git check-ignore 实测: 新建的产物路径必须被判为忽略
if(trackedRaw !== null){
  const probe = 'tests/_hygiene_probe_results.json';
  const probeAbs = path.join(ROOT, probe);
  fs.writeFileSync(probeAbs, '{}', 'utf8');
  try {
    let ignored = false;
    try {
      execFileSync('git', ['check-ignore', '-q', probe], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
      ignored = true; // exit 0 => 被忽略
    } catch (e) { ignored = false; }
    check('S2c git check-ignore 实测: 新建 tests/*_results.json 被忽略', ignored, '路径=' + probe);
  } finally {
    try { fs.unlinkSync(probeAbs); } catch (e) { /* ignore */ }
  }
} else {
  check('S2c git check-ignore 实测', false, 'git 不可用');
}

/* ===== S3 移除产物不得打挂生产者测试 ===== */
section('S3 移除入库后, 三个生产者测试仍然通过');
const producers = [
  ['tests/test_v1010_sync_e2e.js', 'tests/v1010_e2e_results.json'],
  ['tests/test_v1010_solutions_comparison.js', 'tests/v1010_solutions_results.json'],
  ['tests/test_v1011_mirror_sync.js', 'tests/v1011_mirror_sync_results.json']
];
for(const [testRel, artifact] of producers){
  if(!fs.existsSync(path.join(ROOT, testRel))){ check('S3 ' + testRel + ' 存在', false, '文件缺失'); continue; }
  const code = runNode(testRel);
  check('S3a ' + testRel + ' 退出码 0', code === 0, 'exit=' + code);
  check('S3b ' + artifact + ' 仍会在本地生成(产物能力未被破坏)', fs.existsSync(path.join(ROOT, artifact)), '未生成');
}

/* ============================================================
 * S4 Bug2 精神的常驻守卫: 测试不得依赖 git 工作区状态
 * ============================================================ */
section('S4 测试不得依赖 git 工作区状态(防 .gitignore 改动弄挂测试)');
const testFiles = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => /^test_.*\.js$/.test(f) && f !== 'test_v1019_repo_hygiene.js').sort();
const GIT_STATE_RE = /git\s+status|git\s+ls-files|check-ignore|\buntracked\b|未跟踪|porcelain/;
const offenders = [];
let scanned = 0;
for(const f of testFiles){
  const text = fs.readFileSync(path.join(ROOT, 'tests', f), 'utf8');
  scanned++;
  if(GIT_STATE_RE.test(text)) offenders.push(f);
}
console.log('  扫描 tests/ 共 ' + scanned + ' 个测试文件');
check('S4a 无测试依赖 git 工作区状态(未跟踪文件 / gitignore 规则)', offenders.length === 0, offenders.join(', '));
check('S4b 扫描器确实扫过测试目录(防空目录假通过)', scanned > 0, 'scanned=' + scanned);

/* S4c 变异验证: 临时往 .gitignore 追加一条规则, 生产者测试必须仍然通过。
 * 只改 .gitignore(纯文本), 且 try/finally 保证还原, 并验证还原成功。 */
if(trackedRaw !== null && fs.existsSync(giPath)){
  const original = fs.readFileSync(giPath, 'utf8');
  const marker = '# === TEMP: 卫生门禁变异测试 ===\n';
  let restored = false;
  try {
    fs.writeFileSync(giPath, original + '\n' + marker + 'tests/*_probe_mutation.json\n*.hygiene-mutation\n', 'utf8');
    const codes = producers.map(([t]) => runNode(t));
    const allOk = codes.every(c => c === 0);
    check('S4c .gitignore 追加规则后, 生产者测试仍全部通过(不依赖 gitignore 状态)', allOk, 'exit codes=' + codes.join(','));
  } finally {
    fs.writeFileSync(giPath, original, 'utf8');
    restored = fs.readFileSync(giPath, 'utf8') === original;
  }
  check('S4d 变异后 .gitignore 已完整还原(不污染工作树)', restored, '还原失败, 请检查 .gitignore');
} else {
  check('S4c .gitignore 变异验证', false, 'git 或 .gitignore 不可用');
}

console.log('\n=========================================');
console.log('结果: 通过 ' + pass + ' / 失败 ' + fail);
if(fail){ console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('=========================================');
process.exit(fail ? 1 : 0);
