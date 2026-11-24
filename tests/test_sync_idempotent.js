/**
 * ============================================================
 * test_sync_idempotent.js — 同步幂等：数据没变就不产生提交
 * ============================================================
 * 背景（真实成本）：工作流改为 PAT 直推 main 后每 15 分钟跑一轮。原实现每次都用
 *   `new Date()` 写 meta.syncedAt / generatedAt，即使飞书数据一字未改也会产生
 *   diff —— 每轮一个空提交，并连带 CI / CodeQL×3 / Secret Scan / Pages 全量重跑。
 *
 * 本套件钉住三件事：
 *   I1 连续两次同步（源数据不变）：五份产物（含 meta.json）逐字节相同，syncedAt 原地不动；
 *   I2 日志必须明确说明"数据无变化" —— 巡检信号留在 Actions 运行历史，不落盘
 *      （落盘就必然每轮改一个字段，幂等立刻失效）；
 *   I3 源数据真的变了：syncedAt 前进且产物变化 —— 幂等不能把真实变更吃掉。
 *
 * 全部用**本地模式**（`--source-dir`）跑真实 CLI，不依赖飞书凭证。
 *
 * 运行: node tests/test_sync_idempotent.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync_web_data.js');
const DATA_FILES = [
  'vehicle_sync_data.json',
  'approved_users.web.json',
  'feedback_data.json',
  'data_update_notice.json',
  'meta.json'
];

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const tmpDirs = [];
function dir(prefix) {
  const d = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-idem-')), prefix);
  fs.mkdirSync(d, { recursive: true });
  tmpDirs.push(d);
  return d;
}

/* 与 test_v10255 同款：文件描述符接管 stdio，避免本沙箱管道 EBUSY */
function runCli(args) {
  const base = path.join(os.tmpdir(), 'tcg-idem-' + process.pid + '-' + Math.random().toString(36).slice(2));
  const outF = base + '.out', errF = base + '.err';
  const ofd = fs.openSync(outF, 'w'), efd = fs.openSync(errF, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, [SCRIPT].concat(args), {
      cwd: ROOT,
      stdio: ['ignore', ofd, efd],
      env: Object.assign({}, process.env, { FEISHU_APP_ID: '', FEISHU_APP_SECRET: '', TCG_LOCAL_SOURCE_DIR: '' })
    });
  } finally { fs.closeSync(ofd); fs.closeSync(efd); }
  const stdout = fs.readFileSync(outF, 'utf8');
  const stderr = fs.readFileSync(errF, 'utf8');
  fs.unlinkSync(outF); fs.unlinkSync(errF);
  return { status: r.status, stdout, stderr, all: stdout + '\n' + stderr };
}

function writeSource(src, n) {
  const vehicles = [];
  for (let i = 1; i <= n; i++) vehicles.push({ id: i, display: '幂等测试车' + i });
  fs.writeFileSync(path.join(src, 'vehicle_sync_data.json'), JSON.stringify(
    { vehicles, timestamp: '2026-01-01T00:00:00.000Z', version: 'idem-test', vehicleCount: n }, null, 2));
  fs.writeFileSync(path.join(src, 'approved_users.json'), JSON.stringify(
    { users: [{ id: 'u1', name: '组长', role: 'leader' }] }, null, 2));
  fs.writeFileSync(path.join(src, 'feedback_data.json'), JSON.stringify(
    { items: [{ id: 'f1', content: '测试反馈' }] }, null, 2));
}

function hashFile(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function hashAll(out) {
  const h = {};
  DATA_FILES.forEach(f => { h[f] = hashFile(path.join(out, f)); });
  return h;
}
function readMeta(out) {
  try { return JSON.parse(fs.readFileSync(path.join(out, 'meta.json'), 'utf8')); }
  catch (e) { return null; }
}
function cleanup() { tmpDirs.forEach(d => { try { fs.rmSync(path.dirname(d), { recursive: true, force: true }); } catch (e) {} }); }

try {
  const src = dir('src');
  const out = dir('out');
  writeSource(src, 3);

  /* ---------------------------------------------------------------- */
  section('I1/I2 连续两次同步（源数据不变）: 产物逐字节不变, syncedAt 不动');
  const r1 = runCli(['--source-dir', src, '--out', out]);
  check('I1a 首轮同步退出码 0', r1.status === 0, 'status=' + r1.status + ' stderr=' + r1.stderr.slice(0, 200));
  const meta1 = readMeta(out);
  check('I1b meta.json 含 syncedAt / generatedAt',
    !!(meta1 && meta1.syncedAt && meta1.generatedAt), JSON.stringify(meta1));
  const h1 = hashAll(out);

  // 等待一个毫秒以上, 确保如果实现仍然"每轮取当前时间", 这里一定能捕捉到差异
  const waitUntil = Date.now() + 15;
  while (Date.now() < waitUntil) { /* busy wait 25ms 级 */ }

  const r2 = runCli(['--source-dir', src, '--out', out]);
  check('I1c 第二轮同步退出码 0', r2.status === 0, 'status=' + r2.status);
  const meta2 = readMeta(out);
  const h2 = hashAll(out);

  check('I1d 五份产物逐字节不变（含 meta.json）',
    DATA_FILES.every(f => h1[f] === h2[f]),
    DATA_FILES.filter(f => h1[f] !== h2[f]).join(',') || '(none)');
  check('I1e meta.syncedAt 原地不动（不因巡检而前进）', meta2 && meta2.syncedAt === meta1.syncedAt,
    (meta1 && meta1.syncedAt) + ' -> ' + (meta2 && meta2.syncedAt));
  check('I1f meta.generatedAt 同步不动', meta2 && meta2.generatedAt === meta1.generatedAt);
  check('I2a meta.json 不得引入每轮必变的字段（checkedAt 之类）',
    !(meta2 && 'checkedAt' in meta2), JSON.stringify(meta2));
  check('I2b 输出明确说明"数据无变化"', /数据无变化/.test(r2.stdout), r2.stdout.slice(0, 200));

  /* ---------------------------------------------------------------- */
  section('I3 源数据真的变化: syncedAt 必须前进, 产物必须变化');
  writeSource(src, 4);
  const r3 = runCli(['--source-dir', src, '--out', out]);
  check('I3a 第三轮同步退出码 0', r3.status === 0, 'status=' + r3.status + ' stderr=' + r3.stderr.slice(0, 200));
  const meta3 = readMeta(out);
  const h3 = hashAll(out);
  check('I3b syncedAt 前进', !!(meta3 && meta3.syncedAt > meta2.syncedAt),
    (meta2 && meta2.syncedAt) + ' -> ' + (meta3 && meta3.syncedAt));
  check('I3c vehicle_sync_data.json 变化', h3['vehicle_sync_data.json'] !== h2['vehicle_sync_data.json']);
  check('I3d 车型数 3 -> 4', !!(meta3 && meta3.counts && meta3.counts.vehicles === 4),
    JSON.stringify(meta3 && meta3.counts));
  check('I3e 输出回到"已生成"分支', /已生成 web-data\/ 镜像/.test(r3.stdout), r3.stdout.slice(0, 200));

  /* ---------------------------------------------------------------- */
  section('I4 幂等不能绕过 P0 脱敏与 U+FFFD 守卫');
  const scriptSrc = fs.readFileSync(SCRIPT, 'utf8');
  check('I4a writeJson 内仍保留 U+FFFD 拒绝写盘',
    /U\+FFFD/.test(scriptSrc) && /拒绝写盘/.test(scriptSrc));
  check('I4b 幂等比较发生在写盘之前(读到旧文件 -> 相同则 return false)',
    /if \(prevText === text\) return false;/.test(scriptSrc));
} catch (e) {
  fail++;
  failures.push('异常: ' + e.message);
  console.log('  [FAIL] 异常: ' + e.stack);
} finally {
  cleanup();
}

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
if (fail) { console.log('失败项: ' + failures.join(' | ')); process.exit(1); }
console.log('全部通过 OK');
