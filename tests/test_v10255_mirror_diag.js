/**
 * ============================================================
 * test_v10255_mirror_diag.js — web-data 镜像同步"失败必须可诊断"回归
 * ============================================================
 * 背景（真实故障）：`.github/workflows/sync-web-data.yml` 从 2026-11-09 起
 *   连续 49/50 次失败，产物停在 11-09 的镜像上两周无人发现 —— 因为两道熔断
 *   （0 车 / 车数回退）只打普通日志，既不产生 Actions 错误注解，也不通知任何人。
 *
 * 本套件钉住三件事：
 *   D1 熔断必须以 `::error::` 注解失败（Actions 会把 run 标红并高亮原因）；
 *   D2 熔断必须自解释：打出「本次取到的源文件 / 本次车数 / 已有镜像 syncedAt+车数」
 *      与 `--force` 处置提示 —— 没有这些，日志里只有一句"拒绝写入"，无法判断
 *      是"取不到文件"还是"取到了陈旧副本"；
 *   D3 熔断不得覆盖已有产物；`--force` 才是放行开关（放行后允许 0 车落盘）。
 *
 * 全部用**本地模式**（`--source-dir`）跑真实 CLI，不依赖飞书凭证。
 *
 * 运行: node tests/test_v10255_mirror_diag.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync_web_data.js');
const scriptSrc = fs.readFileSync(SCRIPT, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* 子进程执行器：用文件描述符接管 stdout/stderr（管道在本沙箱可能 EBUSY），
 * 临时目录用完即删，不在仓库里落任何文件。 */
function runCli(args) {
  const base = path.join(os.tmpdir(), 'tcg-mirror-' + process.pid + '-' + Math.random().toString(36).slice(2));
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

function mkTmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'tcg-mirror-dir-')); }
function writeVehicles(dir, n) {
  const vehicles = [];
  for (let i = 0; i < n; i++) vehicles.push({ id: i + 1, display: '测试车型' + (i + 1) });
  const payload = { vehicles: vehicles, timestamp: '2026-01-01T00:00:00.000Z', version: 'local-test', vehicleCount: n };
  fs.writeFileSync(path.join(dir, 'vehicle_sync_data.json'), JSON.stringify(payload, null, 2));
  return payload;
}
function readMirror(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, 'vehicle_sync_data.json'), 'utf8')); }
  catch (e) { return null; }
}
function cleanup() { tmpDirs.forEach(d => { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }); }
const tmpDirs = [];
function dir(prefix) { const d = path.join(mkTmp(), prefix); fs.mkdirSync(d, { recursive: true }); tmpDirs.push(path.dirname(d)); return d; }

/* ------------------------------------------------------------------ */
section('D0 前置：脚本存在 / 已接线 / 注解与诊断字段在源码里');
check('D0a scripts/sync_web_data.js 存在', fs.existsSync(SCRIPT));
check('D0b 源码含 Actions 错误注解 ::error::', /::error::/.test(scriptSrc));
check('D0c 源码记录实际取到的源文件(LAST_FOUND)', /LAST_FOUND/.test(scriptSrc));
check('D0d 源码打印源文件 token/修改时间(诊断三元组)',
  /本次取到的源文件/.test(scriptSrc) && /修改时间/.test(scriptSrc) && /已有镜像/.test(scriptSrc));

try {
  /* ---------------------------------------------------------------- */
  section('D1 车数回退熔断（源 1 车 vs 已有 2 车）: 必须红 + 带注解 + 自解释');
  const outD1 = dir('out'), srcD1 = dir('src');
  writeVehicles(outD1, 2);           // 已有产物 2 车
  writeVehicles(srcD1, 1);           // 本次只拉到 1 车（疑似陈旧副本）
  const r1 = runCli(['--source-dir', srcD1, '--out', outD1]);
  check('D1a 退出码非 0', r1.status === 1, 'status=' + r1.status);
  check('D1b stderr 含 ::error::[mirror] 注解(行首)', /^::error::\[mirror\]/m.test(r1.stderr), r1.stderr.slice(0, 300));
  check('D1c 结论文案含"新镜像 1 车 < 已有产物 2 车"', /新镜像 1 车 < 已有产物 2 车/.test(r1.stderr), r1.stderr.slice(0, 300));
  check('D1d 诊断块含"诊断:"与"本次取到的源文件"', /诊断:/.test(r1.stderr) && /本次取到的源文件/.test(r1.stderr));
  check('D1e 诊断块含"已有镜像"与 syncedAt/车数', /已有镜像: 2 车/.test(r1.stderr), r1.stderr.slice(0, 400));
  check('D1f 给出 --force 处置提示', /--force/.test(r1.stderr));
  const m1 = readMirror(outD1);
  check('D1g 熔断不覆盖已有产物(仍 2 车)', m1 && (m1.vehicles || []).length === 2, JSON.stringify(m1 && (m1.vehicles || []).length));

  /* ---------------------------------------------------------------- */
  section('D2 零车熔断（源取不到文件 vs 已有 2 车）');
  const outD2 = dir('out'), srcD2 = dir('src');   // src 目录故意留空 → 0 车
  writeVehicles(outD2, 2);
  const r2 = runCli(['--source-dir', srcD2, '--out', outD2]);
  check('D2a 退出码非 0', r2.status === 1, 'status=' + r2.status);
  check('D2b stderr 含 ::error:: 注解', /^::error::\[mirror\]/m.test(r2.stderr));
  check('D2c 结论文案点名"新镜像 0 车"', /新镜像 0 车但已有产物 2 车/.test(r2.stderr), r2.stderr.slice(0, 300));
  check('D2d 诊断块含"未找到 vehicle_sync_data.json"', /未找到 vehicle_sync_data.json/.test(r2.stderr), r2.stderr.slice(0, 400));
  const m2 = readMirror(outD2);
  check('D2e 熔断不覆盖已有产物(仍 2 车)', m2 && (m2.vehicles || []).length === 2);

  /* ---------------------------------------------------------------- */
  section('D3 正常放行（源 3 车 > 已有 2 车）: 必须绿并落盘');
  const outD3 = dir('out'), srcD3 = dir('src');
  writeVehicles(outD3, 2);
  writeVehicles(srcD3, 3);
  const r3 = runCli(['--source-dir', srcD3, '--out', outD3]);
  check('D3a 退出码 0', r3.status === 0, 'status=' + r3.status + ' :: ' + r3.all.slice(-300));
  const m3 = readMirror(outD3);
  check('D3b 镜像已更新为 3 车', m3 && (m3.vehicles || []).length === 3, JSON.stringify(m3 && (m3.vehicles || []).length));
  check('D3c 未误打错误注解', !/^::error::/m.test(r3.stderr));

  /* ---------------------------------------------------------------- */
  section('D4 --force 是唯一放行开关（允许 0 车落盘）');
  const outD4 = dir('out'), srcD4 = dir('src');
  writeVehicles(outD4, 2);
  const r4 = runCli(['--source-dir', srcD4, '--out', outD4, '--force']);
  check('D4a --force 下 0 车退出码 0', r4.status === 0, 'status=' + r4.status + ' :: ' + r4.all.slice(-300));
  const m4 = readMirror(outD4);
  check('D4b --force 后镜像为 0 车(确认是人工放行, 不是静默)', m4 && (m4.vehicles || []).length === 0);
} catch (e) {
  check('D 用例执行未抛异常', false, e.message + '\n' + (e.stack || ''));
} finally {
  cleanup();
}

console.log('\n==============================================================');
console.log('镜像同步失败可诊断性测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
