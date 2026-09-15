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

console.log('\n==============================================================');
console.log('巡检脚本测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
