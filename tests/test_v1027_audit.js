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
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

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
try {
  execFileSync(process.execPath, ['scripts/audit_media_consistency.js'], { cwd: ROOT, stdio: 'pipe' });
  check('A3a 巡检对已提交 manifest 运行通过(exit 0)', true);
} catch (e) {
  check('A3a 巡检运行通过(exit 0)', false, (e.stderr || e.stdout || e.message || '').toString().slice(0, 300));
}

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
  let exitOk = true;
  try {
    execFileSync(process.execPath, ['scripts/audit_media_consistency.js', '--manifest', tmp], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    exitOk = false;
    out = (e.stdout || '').toString() + (e.stderr || '').toString();
  }
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
