/**
 * ============================================================
 * test_vehicle_data_integrity.js — 车辆数据编码完整性测试(P1)
 * ============================================================
 * 事故背景(2026-09-17 排查, 此前从未被报告):
 *   vehicles_data.js 有 4 行含 U+FFFD(替换符)——源数据在**飞书表内容侧**即损坏:
 *     ① 比亚迪唐ATTO-8      "锁??车门"     -> "锁住车门"
 *     ② 吉利极氪(001/X/7X)  "2.??认断电..." -> "2.确认断电无误"  (残留 3×EF BF BD)
 *     ③ 奇瑞捷途(T2 I-DM)   "奇瑞??途JETOUR" -> "奇瑞捷途JETOUR"  (2×EF BF BD)
 *     ④ 比亚迪海豹(SEAL-5-DM-I) "10号??手" -> "10号扳手"
 *
 *   为什么本套件存在:
 *   损坏源头不可逆(双重编码), 只能按上下文人工确定正确字符。故修复落在
 *   scripts/gen_vehicles_data.js 的 KNOWN_CORRUPTIONS 校正表——生成期归一。
 *   本套件锁死三件事, 防止回归:
 *     ① 产物 vehicles_data.js 无 U+FFFD
 *     ② 生成器存在校正/残留告警防护逻辑(不是靠手改产物)
 *     ③ 跑一次生成器不回归(幂等)
 *
 * 为什么"再跑一次生成器"是关键断言:
 *   vehicles_data.js 是生成产物, 手改会被下次生成覆盖。只有断言"生成器
 *   幂等且产出仍无 U+FFFD", 才能证明修复**持久**, 而非一次性涂抹。
 *
 * 运行: node tests/test_vehicle_data_integrity.js
 * 要求: 先红后绿——修复前(4 处损坏 + 无校正逻辑)红, 加校正表并重生成后绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/** 统计字符串中 U+FFFD 个数 */
const countUFFFD = s => (String(s).match(/\uFFFD/g) || []).length;

const VEHICLES = path.join(ROOT, 'vehicles_data.js');
const GEN = path.join(ROOT, 'scripts', 'gen_vehicles_data.js');

/* ---------- I1 产物: vehicles_data.js 无替换符 ---------- */
section('I1 产物完整性: vehicles_data.js 无 U+FFFD');
const before = fs.existsSync(VEHICLES) ? fs.readFileSync(VEHICLES, 'utf8') : '';
check('I1a vehicles_data.js 存在', fs.existsSync(VEHICLES));
check('I1b vehicles_data.js 无任何 U+FFFD', countUFFFD(before) === 0, '实际 ' + countUFFFD(before) + ' 个');

/* 4 处曾损坏的具体文案, 逐一断言已恢复为正确字符(防"抹掉替换符但内容仍错") */
const EXPECTED_FIXES = [
  { name: 'I1c 比亚迪唐ATTO-8 锁住车门',        needle: '锁住车门，再次拉动车门确保关闭' },
  { name: 'I1d 吉利极氪 确认断电无误',          needle: '确认断电无误后放置于车内中控台' },
  { name: 'I1e 奇瑞捷途JETOUR_T2_I_DM 视频名',  needle: 'vehicle_videos/奇瑞捷途JETOUR_T2_I_DM.mp4' },
  { name: 'I1f 比亚迪海豹 10号扳手',            needle: '10号扳手逆时针旋转拧松电池负极螺丝' },
];
EXPECTED_FIXES.forEach(({ name, needle }) => {
  check(name, before.includes(needle));
});

/* ---------- I2 生成器: 存在校正/防护逻辑 ---------- */
section('I2 生成器持久化: 校正与防护逻辑存在');
const gen = fs.existsSync(GEN) ? fs.readFileSync(GEN, 'utf8') : '';
check('I2a 生成器存在已知损坏校正表(KNOWN_CORRUPTIONS)', /KNOWN_CORRUPTIONS/.test(gen));
check('I2b 生成器实现校正函数(applyCorrections/correctVehicle)',
  /applyCorrections/.test(gen) && /correctVehicle/.test(gen));
check('I2c 读镜像后即施加校正(loadMirrorVehicles 内调用 correctVehicle)',
  /loadMirrorVehicles[\s\S]{0,900}correctVehicle/.test(gen));
check('I2d 校正后残留 U+FFFD 会告警(不静默放行)',
  /residual/.test(gen) && /校正后仍残留/.test(gen));
/* 只在**可执行代码**里查编码转换(剔除注释, 否则文档里提到这些词会误报) */
const genCode = gen.split(/\r?\n/).filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
check('I2e 生成器可执行代码无 latin1/binary 等会吞字符的编码转换',
  !/latin1|['"]binary['"]|decodeURIComponent/.test(genCode));

/* 校正表本身: 表项结构完整且不含未定义替换符 */
const tableOk = (() => {
  try {
    const mod = require(GEN);
    const t = mod.KNOWN_CORRUPTIONS;
    if (!Array.isArray(t) || t.length < 4) return false;
    return t.every(e => e && typeof e.broken === 'string' && typeof e.fixed === 'string'
      && e.broken.includes('\uFFFD') && !e.fixed.includes('\uFFFD') && e.fixed.length > 0);
  } catch (e) { return false; }
})();
check('I2f 校正表结构完整(≥4 条, broken 含替换符, fixed 不含)', tableOk);

/* 生成器被 require 时不得有写文件副作用(否则 audit 复用校正表会误触发生成) */
const AUDIT = path.join(ROOT, 'scripts', 'audit_media_consistency.js');
const audit = fs.existsSync(AUDIT) ? fs.readFileSync(AUDIT, 'utf8') : '';
check('I2g 生成器 main() 受 require.main 守卫(require 无副作用)', /require\.main\s*===\s*module/.test(gen));
/* audit C5 必须复用同一校正表归一镜像, 否则"已校正产物 vs 未校正镜像"会假漂移
 * (真实案例: 奇瑞捷途JETOUR_T2_I_DM.mp4 触发 C5 视频名集合漂移) */
check('I2h audit 巡检 C5 复用校正表归一镜像(P1 防假漂移)',
  audit.includes("require('./gen_vehicles_data.js')") && /correctVehicle/.test(audit));

/* ---------- I3 幂等: 再跑生成器不回归 ---------- */
section('I3 幂等: 重新生成不回归 U+FFFD');
let rerunOk = false, rerunErr = '';
try {
  execFileSync(process.execPath, [GEN], { cwd: ROOT, stdio: 'pipe' });
  const after = fs.readFileSync(VEHICLES, 'utf8');
  const n = countUFFFD(after);
  rerunOk = (n === 0);
  check('I3a 重新运行生成器后 vehicles_data.js 仍无 U+FFFD', n === 0, '实际 ' + n + ' 个');
  EXPECTED_FIXES.forEach(({ name, needle }) => {
    check(name.replace(/^I1/, 'I3') + '(重生成后)', after.includes(needle));
  });
} catch (e) {
  rerunErr = (e.stderr || e.stdout || e.message || '').toString().slice(0, 300);
  check('I3a 重新运行生成器后 vehicles_data.js 仍无 U+FFFD', false, rerunErr);
}

/* ---------- I4 镜像源: 记录损坏仍在飞书侧(需人工修) ---------- */
section('I4 源头如实记录: 镜像仍含损坏(需用户在飞书表手工修正)');
const mirror = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
if (fs.existsSync(mirror)) {
  const mc = countUFFFD(fs.readFileSync(mirror, 'utf8'));
  // 这**不是**失败断言: 源侧损坏未修是已知事实(飞书表内容问题, 脚本无法根治)。
  // 此处仅观测并在计数归零时提示校正表可清理, 避免排除清单变成盲区。
  if (mc === 0) {
    console.log('  [INFO] 镜像 web-data/vehicle_sync_data.json 已无 U+FFFD——');
    console.log('         说明飞书表已修正, 可考虑清理 gen_vehicles_data.js 的 KNOWN_CORRUPTIONS(需保留至确认稳定)。');
  } else {
    console.log('  [INFO] 镜像 web-data/vehicle_sync_data.json 仍有 ' + mc + ' 个 U+FFFD(飞书表内容侧, 待用户手工修正)。');
    console.log('         生成器校正表已兜住这 4 处; 若出现校正表未收录的新损坏, 生成器会 [WARN] 提示。');
  }
} else {
  console.log('  [INFO] 未找到 web-data/vehicle_sync_data.json, 跳过镜像观测。');
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(60));
console.log('车辆数据编码完整性测试汇总: ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(60));
if (fail) {
  console.log('失败项:');
  failures.forEach(f => console.log('  - ' + f));
  console.log('❌ 存在失败');
  process.exit(1);
}
console.log('✅ 全部通过');
