/**
 * test_v1034_two_end_gate.js — 「两端错配」门禁的变异测试(M1–M6 + 反假阳性)
 * =============================================================================
 * 为什么用**临时 git 仓库**: 门禁要判"tag 与 main 的版本差", 直接在本仓造 tag/改
 * version.json 会污染真实仓库与 CI 历史。故每个用例在 os.tmpdir() 里**现造一个小仓库**,
 * 用 `--repo` 指向它, 完全隔离、可重复、无副作用。
 *
 * 用例(每条都断言"退出码 + 判定 + 是否点名文件"):
 *   M1  改 js/** 且不动版本        → **FAIL(1)** 且点名该文件   (原 bug 复现: 未发布堆积)
 *   M2  只改 web-data/**           → **PASS(0)**                (★反假阳性: 镜像不该触发)
 *   M3  只改 index.html            → **PASS(0)**                (★反假阳性: 仅网页文件不该触发)
 *   M4  改 js/** + bump 无 tag     → **WARN(0)**                (发布窗口内瞬态, 不阻断)
 *   M5  M4 之上补 tag              → **PASS(0)**
 *   M6  仓库无 tag                 → **exit 2**(跳过, 防浅克隆误报)
 *   M7  ref≠main 时同样堆积        → **WARN(0)**(降级, 不因特性分支变红)
 *   M8  还原到干净态               → **PASS(0)**
 * 没有 M2/M3, 将来路径白名单被写宽了也没人发现 —— 所以它们必须有。
 *
 * 运行: node tests/test_v1034_two_end_gate.js   (已并入 test:all)
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const GATE = path.join(ROOT, 'scripts', 'check_two_end_sync.js');
const tmpDirs = [];

let pass = 0, fail = 0;
const failures = [];
function check(n, c, e) {
  if (c) { pass++; console.log('  [PASS] ' + n); }
  else { fail++; failures.push(n); console.log('  [FAIL] ' + n + (e !== undefined ? '  -> ' + e : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

function sh(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'twg-'));
  tmpDirs.push(dir);
  sh(dir, ['init', '-q']);
  sh(dir, ['config', 'user.email', 't@t.t']);
  sh(dir, ['config', 'user.name', 't']);
  sh(dir, ['checkout', '-q', '-b', 'main']);
  fs.mkdirSync(path.join(dir, 'js'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'web-data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'js', 'app.js'), 'var a=1;\n');
  fs.writeFileSync(path.join(dir, 'web-data', 'mirror.json'), '{"v":1}\n');
  fs.writeFileSync(path.join(dir, 'index.html'), '<html>web only</html>\n');
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: '1.0.0', versionCode: 10000 }, null, 2) + '\n');
  sh(dir, ['add', '-A']);
  sh(dir, ['commit', '-q', '-m', 'init']);
  return dir;
}
function commit(dir, msg) { sh(dir, ['add', '-A']); sh(dir, ['commit', '-q', '-m', msg]); }
function bump(dir, v) {
  fs.writeFileSync(path.join(dir, 'version.json'), JSON.stringify({ version: v, versionCode: 10000 }, null, 2) + '\n');
}

/** 跑门禁, 返回 {code, out, json} */
function runGate(dir, extra) {
  const args = [GATE, '--repo', dir, '--json'].concat(extra || []);
  const r = spawnSync(process.execPath, args, { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = out.match(/__RESULT__(\{.*\})/);
  let json = null;
  try { json = m ? JSON.parse(m[1]) : null; } catch (e) { json = null; }
  return { code: r.status, out: out, json: json };
}

section('M0 基线: 干净仓库(有 tag, 无共享改动) → PASS(0)');
const base = mkRepo();
sh(base, ['tag', 'v1.0.0']);
{
  const r = runGate(base, ['--ref', 'main']);
  check('M0 exit=0', r.code === 0, 'code=' + r.code + ' out=' + r.out.slice(0, 300));
  check('M0 判定 PASS 且无共享改动', r.json && r.json.level === 'PASS' && r.json.changedFiles.length === 0, JSON.stringify(r.json));
}

section('M1 ★原 bug 复现: 改 js/** 不动版本 → FAIL(1) 且点名文件');
{
  fs.writeFileSync(path.join(base, 'js', 'app.js'), 'var a=2; // 改了共享代码\n');
  commit(base, 'change js without bump');
  const r = runGate(base, ['--ref', 'main']);
  check('M1 exit=1', r.code === 1, 'code=' + r.code);
  check('M1 判定 FAIL', r.json && r.json.level === 'FAIL', JSON.stringify(r.json));
  check('M1 **点名了改动文件 js/app.js**', r.json && r.json.changedFiles.indexOf('js/app.js') >= 0, JSON.stringify(r.json && r.json.changedFiles));
  check('M1 输出含"已进主干但未发布"解释与三步自解释文案',
    r.out.indexOf('已进主干但未发布') >= 0 && r.out.indexOf('当前未阻断') >= 0 && r.out.indexOf('第 2 次发布') >= 0 && r.out.indexOf('现在该做什么') >= 0);
  check('M1 FAIL 用 GitHub **::error::** 注解(WARN 才用 ::warning::, 红/黄不混)', r.out.indexOf('::error::') >= 0);
}

section('M2 ★反假阳性: 只改 web-data/** → PASS(0)');
{
  const d = mkRepo(); sh(d, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(d, 'web-data', 'mirror.json'), '{"v":2}\n');
  commit(d, 'mirror only');
  const r = runGate(d, ['--ref', 'main']);
  check('M2 exit=0(**镜像不该触发**)', r.code === 0, 'code=' + r.code + ' out=' + r.out.slice(0, 200));
  check('M2 判定 PASS 且 changedFiles 为空', r.json && r.json.level === 'PASS' && r.json.changedFiles.length === 0, JSON.stringify(r.json));
}

section('M3 ★反假阳性: 只改 index.html → PASS(0)');
{
  const d = mkRepo(); sh(d, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(d, 'index.html'), '<html>changed</html>\n');
  commit(d, 'index only');
  const r = runGate(d, ['--ref', 'main']);
  check('M3 exit=0(**仅网页文件不该触发**)', r.code === 0, 'code=' + r.code + ' out=' + r.out.slice(0, 200));
  check('M3 判定 PASS 且 changedFiles 为空', r.json && r.json.level === 'PASS' && r.json.changedFiles.length === 0, JSON.stringify(r.json));
}

section('M4 改 js/** + bump 但未打 tag → WARN(0)(发布瞬态, 不阻断)');
{
  const d = mkRepo(); sh(d, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(d, 'js', 'app.js'), 'var a=3;\n');
  bump(d, '1.0.1');
  commit(d, 'bump 1.0.1 no tag');
  const r = runGate(d, ['--ref', 'main']);
  check('M4 exit=0(WARN 不阻断)', r.code === 0, 'code=' + r.code);
  check('M4 判定 WARN', r.json && r.json.level === 'WARN', JSON.stringify(r.json));
  check('M4 mainVer≠tagVer(1.0.1 vs 1.0.0)', r.json && r.json.mainVer === '1.0.1' && r.json.tagVer === '1.0.0', JSON.stringify(r.json));
}

section('M5 M4 之上补 tag → PASS(0)');
{
  const d = mkRepo(); sh(d, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(d, 'js', 'app.js'), 'var a=4;\n');
  bump(d, '1.0.1');
  commit(d, 'bump 1.0.1');
  sh(d, ['tag', 'v1.0.1']);
  const r = runGate(d, ['--ref', 'main']);
  check('M5 exit=0(打了 tag 即 PASS)', r.code === 0, 'code=' + r.code + ' out=' + r.out.slice(0, 200));
  check('M5 判定 PASS', r.json && r.json.level === 'PASS', JSON.stringify(r.json));
}

section('M6 仓库无 tag → exit 2(跳过, 防浅克隆误报)');
{
  const d = mkRepo();
  const r = runGate(d, ['--ref', 'main']);
  check('M6 exit=2', r.code === 2, 'code=' + r.code + ' out=' + r.out.slice(0, 200));
  check('M6 原因=no_tag_found', r.json && String(r.json.reason).indexOf('no_tag_found') === 0, JSON.stringify(r.json));
}

section('M7 ref≠main 时同样堆积 → WARN(0)(降级, 不因特性分支变红)');
{
  const d = mkRepo(); sh(d, ['tag', 'v1.0.0']);
  fs.writeFileSync(path.join(d, 'js', 'app.js'), 'var a=5;\n');
  commit(d, 'change js on feature');
  const r = runGate(d);   /* 不传 --ref → 实际 ref=main? 本仓默认分支已设为 main, 故改用 --ref 模拟特性分支 */
  const r2 = runGate(d, ['--ref', 'feat/x']);
  check('M7 exit=0(降级不阻断)', r2.code === 0, 'code=' + r2.code);
  check('M7 判定 WARN 且 reason 含"降级"', r2.json && r2.json.level === 'WARN' && String(r2.json.reason).indexOf('降级') >= 0, JSON.stringify(r2.json));
  check('M7 默认 ref 下(main)此仓库本应 FAIL(证明降级是真降级)', r.code === 1, 'code=' + r.code);
}

section('M8 还原到干净态 → PASS(0)');
{
  /* M1 在原仓库留下的未发布改动**已被门禁抓到**; 这里把它还原(tag 内容)再提交 →
   * 共享代码与 tag 一致 ⇒ 应当放过(PASS)。这才是"绿"的那一半。 */
  sh(base, ['checkout', 'v1.0.0', '--', 'js/app.js']);
  commit(base, 'revert shared change back to tag content');
  const r = runGate(base, ['--ref', 'main']);
  check('M8 exit=0(还原后放过)', r.code === 0, 'code=' + r.code + ' out=' + r.out.slice(0, 200));
  check('M8 判定 PASS', r.json && r.json.level === 'PASS', JSON.stringify(r.json));
}

/* 清理临时仓库 */
try {
  for (const d of tmpDirs) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  }
} catch (e) {}

console.log('\n' + '='.repeat(62));
console.log('两端错配门禁变异测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
console.log('全部通过 OK');
