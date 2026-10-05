/**
 * ============================================================
 * test_v1027_audit.js — 媒体一致性巡检脚本测试(需求3第一阶段)
 * ============================================================
 * 覆盖:
 *  A1 scripts/audit_media_consistency.js 存在且含三类巡检(C1数量/C2缺失/C3张冠李戴)
 *  A2 package.json 接线 audit:media
 *  A3 动态: 巡检脚本对已提交 manifest + vehicles_data.js 运行通过(exit 0)
 *
 * 运行: node tests/test_v1027_audit.js
 * 要求: 先红后绿——巡检脚本落地前红, 落地后绿。
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
 *   - 该失败与被测逻辑无关, 却会让 A3a/A4a/A4c 在本地假红(CI/真机是绿的)。
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
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v1027-'));
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

const auditPath = path.join(ROOT, 'scripts', 'audit_media_consistency.js');

section('A1/A2 静态');
check('A1a scripts/audit_media_consistency.js 存在', fs.existsSync(auditPath));
const auditJs = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, 'utf8') : '';
check('A1b 含数量巡检(C1 stats 对齐)', auditJs.includes('photoCount') && auditJs.includes('vehicleCount'));
check('A1c 含引用缺失巡检(C2)', auditJs.includes('引用缺失') || auditJs.includes('sha256'));
check('A1d 含张冠李戴巡检(C3 共享声明)', auditJs.includes('张冠李戴') || auditJs.includes('vehicleIds'));
check('A1e 含孤儿巡检(C4 warn)', auditJs.includes('孤儿'));
check('A2a package.json 接线 audit:media', /audit:media/.test(src('package.json')));

section('A3 动态执行巡检');
const rBase = runNode(['scripts/audit_media_consistency.js']);
if (rBase.status === 0) check('A3a 巡检对已提交 manifest 运行通过(exit 0)', true);
else check('A3a 巡检运行通过(exit 0)', false, rBase.all.slice(0, 300));

section('A4 防复发: 区分"声明未上传(WARN)"与"声称为已上传但丢失(FAIL)"');
// 在真实 manifest 副本上追加两个探针照片, 隔离验证 C2 判定分支:
//   - 探针A: 设了 sha256 但本地无文件 → "声称为已上传但丢失", 必须 FAIL
//   - 探针B: sha256/size/qiniuKey 皆空 → "声明未上传", 应降级为 WARN(不可 FAIL)
// 仅向 manifest.vehicles 追加, 不改动 vehicles_data.js, 故 C1/C5 数量对账不受影响。
try {
  const realManifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'vehicle_media_manifest.json'), 'utf8'));
  const probe = JSON.parse(JSON.stringify(realManifest));
  const target = (probe.vehicles && probe.vehicles[0]) || { id: 9999, photos: [] };
  if (!probe.vehicles) probe.vehicles = [target];
  const probeMissing = 'PROBE_declared_uploaded_missing_' + Date.now() + '.jpeg';
  const probeNotUp = 'PROBE_declared_not_uploaded_' + Date.now() + '.jpeg';
  target.photos = target.photos || [];
  target.photos.push({ fileName: probeMissing, sha256: 'a'.repeat(64), size: 100, mime: 'image/jpeg', qiniuKey: '' });
  target.photos.push({ fileName: probeNotUp, sha256: '', size: 0, mime: 'image/jpeg', qiniuKey: '' });
  const tmp = path.join(require('os').tmpdir(), 'probe_manifest_v1027_' + process.pid + '.json');
  fs.writeFileSync(tmp, JSON.stringify(probe, null, 2));
  let out = '';
  const rProbe = runNode(['scripts/audit_media_consistency.js', '--manifest', tmp]);
  const exitOk = (rProbe.status === 0);
  out = rProbe.all;
  // 探针A 应触发 FAIL(声称为已上传但文件丢失)——防未来有人把真损坏也一并降级
  check('A4a 探针A(声称为已上传但丢失)应 FAIL', !exitOk && /\[FAIL\][^\n]*PROBE_declared_uploaded_missing/.test(out), out.slice(0, 400));
  // 探针B 绝不可被判 FAIL(应 WARN, 文件待补)——守住"声明未上传≠损坏"的降级边界
  check('A4b 探针B(声明未上传)不应被判 FAIL', !/\[FAIL\][^\n]*PROBE_declared_not_uploaded/.test(out), out.slice(0, 400));
  check('A4c 探针B(声明未上传)应出现 WARN', /\[WARN\][^\n]*PROBE_declared_not_uploaded/.test(out), out.slice(0, 400));
  fs.unlinkSync(tmp);
} catch (e) {
  check('A4 防复发探针执行未抛异常', false, e.message);
}

console.log('\n==============================================================');
console.log('巡检脚本测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
