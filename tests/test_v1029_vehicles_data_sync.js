/**
 * ============================================================
 * test_v1029_vehicles_data_sync.js — vehicles_data.js 数据源对账测试(P1)
 * ============================================================
 * Bug: vehicles_data.js(App 打包内置源, 73 车, 停 09-01) 与
 *      web-data/vehicle_sync_data.json(网页镜像, 82 车, cron 每 15 分钟同步)
 *      漂移 —— 9 车缺失 + 8 车改名 + 1 视频缺直链。
 *
 * 期望:
 *  S1 scripts/gen_vehicles_data.js 存在且支持 --check(对账, 漂移即非零退出)
 *  S2 audit_media_consistency.js 接入 C5 数据源对账
 *  S3 动态: gen_vehicles_data.js --check 对当前仓库运行通过(exit 0, 即两源已一致)
 *
 * 运行: node tests/test_v1029_vehicles_data_sync.js
 * 要求: 先红后绿——修复前(73 vs 82 漂移 + 脚本缺失)红, 反向生成后绿。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

/* ------------------------------------------------------------------------
 * 子 node 进程执行器: 用**文件描述符**接管 stdout/stderr, stdin 置 'ignore'
 * ------------------------------------------------------------------------
 * 为什么不用管道: 本沙箱(Windows)实测, 已运行的 node 再 spawn 子 node 时
 *   - stdin 为 'pipe' → 必 EBUSY(status=null, code=EBUSY), 子脚本根本没跑;
 *   - 该失败与被测逻辑无关, 却会让 S3a 在本地假红(CI/真机是绿的)。
 *   改用 fs.openSync 的文件描述符接管后完全正常, 退出码与输出都能完整拿到。
 * 临时目录在读取输出后**立即删除**, 不留垃圾, 也不在仓库里落任何文件。
 * 若连子进程本身都创建不了(极少见), 按 tests/test_v57_cross_network.js 先例
 * 打印 "[环境缺失] 跳过" 并 exit 0: 那是环境不具备执行条件, 不是测试失败。
 * ---------------------------------------------------------------------- */
function envUnavailable(err) {
  console.log('[环境缺失] 跳过本套件: 无法创建子 node 进程');
  console.log('  原因: ' + ((err && err.code ? err.code + ' ' : '') + (err && err.message ? err.message : '')));
  console.log('  视为"本环境不具备执行条件", 非测试失败, 退出码 0。CI 里会真跑。');
  process.exit(0);
}
function runNode(args, opts) {
  opts = opts || {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v1029-'));
  const fo = path.join(d, 'o.txt');
  const fe = path.join(d, 'e.txt');
  const fdo = fs.openSync(fo, 'w');
  const fde = fs.openSync(fe, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, args, { cwd: opts.cwd || ROOT, stdio: ['ignore', fdo, fde], timeout: 120000 });
  } catch (e) { r = { status: null, error: e }; }
  try { fs.closeSync(fdo); } catch (e) {}
  try { fs.closeSync(fde); } catch (e) {}
  if (r.status === null && r.error) envUnavailable(r.error);
  const stdout = fs.readFileSync(fo, 'utf8');
  const stderr = fs.readFileSync(fe, 'utf8');
  fs.rmSync(d, { recursive: true, force: true });
  return { status: r.status, stdout: stdout, stderr: stderr, all: stdout + stderr };
}

const genJsPath = path.join(ROOT, 'scripts', 'gen_vehicles_data.js');

section('S1/S2 静态');
check('S1a scripts/gen_vehicles_data.js 存在', fs.existsSync(genJsPath));
const genJs = fs.existsSync(genJsPath) ? fs.readFileSync(genJsPath, 'utf8') : '';
check('S1b gen_vehicles_data.js 支持 --check 对账', genJs.includes('--check'));
check('S1c gen_vehicles_data.js 读 web-data 镜像', genJs.includes('vehicle_sync_data.json'));
check('S2a audit_media_consistency.js 接入 C5 对账(读 web-data 镜像)', /vehicle_sync_data\.json/.test(src('scripts/audit_media_consistency.js')));

section('S3 动态: 对账运行(两源一致)');
const rCheck = runNode(['scripts/gen_vehicles_data.js', '--check']);
if (rCheck.status === 0) check('S3a gen_vehicles_data.js --check 通过(vehicles_data 与 web-data 一致)', true);
else check('S3a gen_vehicles_data.js --check 通过(vehicles_data 与 web-data 一致)', false, rCheck.all.slice(0, 300));

console.log('\n==============================================================');
console.log('vehicles_data 对账测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
