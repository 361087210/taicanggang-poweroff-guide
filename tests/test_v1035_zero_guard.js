/**
 * ============================================================================
 * tests/test_v1035_zero_guard.js — 三道「零条熔断」门禁的常驻回归测试
 * ============================================================================
 * 事故背景(P0):
 *   82 车数据曾被 cron 静默清成 0 并推上 main。根因是同步链某环取不到
 *   vehicle_sync_data.json 时**降级为空数组**而不是报错, 于是"0 车"被当作
 *   合法结果一路写穿到 vehicles_data.js 与 web-data/, cron 不跑测试,
 *   deploy-pages.yml 独立触发且不看 CI 结果 -> 坏数据先上线。
 *
 * 三道守卫(本测试要钉死的对象, 逻辑本身不在此文件维护):
 *   守卫1 scripts/gen_vehicles_data.js  : 镜像 0 车 + 本地已有 N 车 -> exit 1「拒绝覆盖」
 *   守卫2 scripts/sync_web_data.js      : 新镜像 0 车 + 已有产物 N 车 -> exit 1「拒绝写入」
 *   守卫3 scripts/audit_media_consistency.js : manifest.stats.vehicleCount===0 -> C6 fail exit 1
 *
 * 为什么要"变异自证"(S8):
 *   只断言"守卫存在时 exit≠0"是不够的——若将来有人把守卫删掉, 而测试恰好
 *   因为别的原因(fixture 报错、脚本崩了)也 exit≠0, 测试照样是绿的, 门禁就
 *   变成摆设。故 S8 把守卫条件替换成 `if (false)`, 确认红灯**随之消失**
 *   (exit 变 0), 以此证明红灯确实由守卫产生, 测试对守卫的存亡敏感。
 *
 * 隔离方式:
 *   三个脚本的 ROOT 都是 `path.resolve(__dirname, '..')`, 与 cwd 无关。
 *   故每个用例在 os.tmpdir() 里现造一个**最小仓库副本**(scripts/ 下放脚本副本),
 *   ROOT 即指向临时目录 —— 绝不碰真实仓库的 vehicles_data.js / web-data/。
 *
 * 子进程 stdio 说明(重要):
 *   某些沙箱下, 已运行的 node 再 spawn 子 node 且用**管道**接管 stdio 会 EBUSY
 *   失败(本仓 test_v57_cross_network.js 的"[环境缺失] 跳过"先例即源于此)。
 *   本测试改为用**文件描述符**接管子进程 stdout/stderr —— 既规避了管道 EBUSY,
 *   又能完整拿到退出码与输出, 因此在沙箱里也能真跑, 不需跳过。
 *   若连 spawn 本身都不可用(status=null 且带 error), 仍按先例打印
 *   "[环境缺失] 跳过"并 exit 0: 那是"环境不具备执行条件", 不是测试失败。
 *
 * 运行: node tests/test_v1035_zero_guard.js   (已并入 test:all)
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tmpDirs = [];

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ------------------------------------------------------------------ *
 * 子进程执行器: 用文件描述符接管 stdio(规避管道 EBUSY), 捕获退出码+输出
 * ------------------------------------------------------------------ */
function runNode(script, args, opts) {
  opts = opts || {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-'));
  tmpDirs.push(d);
  const fo = path.join(d, 'o.txt');
  const fe = path.join(d, 'e.txt');
  const fdo = fs.openSync(fo, 'w');
  const fde = fs.openSync(fe, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, [script].concat(args || []), {
      cwd: opts.cwd || ROOT,
      stdio: ['ignore', fdo, fde],
      env: opts.env || process.env,
      timeout: 120000
    });
  } catch (e) {
    r = { status: null, error: e };
  }
  try { fs.closeSync(fdo); } catch (e) {}
  try { fs.closeSync(fde); } catch (e) {}
  const out = fs.readFileSync(fo, 'utf8');
  const err = fs.readFileSync(fe, 'utf8');
  return { status: r.status, error: r.error || null, out: out, err: err, all: out + err };
}

/** 环境自检: 本进程能否 spawn 子 node(不能则整套件跳过, exit 0) */
function canSpawnNode() {
  const r = runNode('-e', ['0']);
  return !(r.error && r.status === null);
}

/* ------------------------------------------------------------------ *
 * fixture 构建
 * ------------------------------------------------------------------ */
const ONE_VEHICLE = { id: 1, brandId: 1, brand: '测试品牌', series: '测试系', config: '测试配置', display: '测试车型', photoPaths: [], videoPaths: [] };

function mktmp(tag) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zg-' + tag + '-'));
  tmpDirs.push(d);
  return d;
}
function writeJson(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
}

/**
 * 守卫1 fixture: 最小仓库副本(ROOT=tmp), 镜像 0 车 + 本地已有 1 车。
 * @param {string} scriptSrc - 写入 tmp/scripts/gen_vehicles_data.js 的源码(可传变异体)
 */
function fixtureGen(scriptSrc) {
  const d = mktmp('gen');
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(d, 'scripts', 'gen_vehicles_data.js'), scriptSrc, 'utf8');
  writeJson(path.join(d, 'web-data', 'vehicle_sync_data.json'), { vehicles: [], timestamp: new Date().toISOString(), version: 'fixture' });
  fs.writeFileSync(path.join(d, 'vehicles_data.js'),
    '// fixture: 1 车\nwindow.VEHICLES = ' + JSON.stringify([ONE_VEHICLE], null, 2) + ';\n', 'utf8');
  return d;
}

/** 守卫2 fixture: 源目录(新镜像) + 输出目录(已有产物) */
function fixtureSync(outVehicles, srcVehicles) {
  const d = mktmp('sync');
  const src = path.join(d, 'src');
  const out = path.join(d, 'out');
  writeJson(path.join(src, 'vehicle_sync_data.json'), { vehicles: srcVehicles, timestamp: new Date().toISOString(), version: 'fixture' });
  writeJson(path.join(src, 'approved_users.json'), { users: [] });
  writeJson(path.join(src, 'feedback_data.json'), { items: [] });
  writeJson(path.join(out, 'vehicle_sync_data.json'), { vehicles: outVehicles, timestamp: new Date().toISOString(), version: 'old' });
  return { dir: d, src: src, out: out };
}

/**
 * 守卫3 fixture: 最小仓库副本(ROOT=tmp), manifest + vehicles_data.js + 镜像三者
 * 完全自洽, 唯一变量是 stats.vehicleCount —— 确保 exit≠0 **只可能**来自 C6。
 */
function fixtureAudit(vehicleCount, scriptSrc, genSrc) {
  const d = mktmp('audit');
  fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(d, 'vehicle_images'), { recursive: true });
  fs.mkdirSync(path.join(d, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(d, 'scripts', 'audit_media_consistency.js'), scriptSrc, 'utf8');
  fs.writeFileSync(path.join(d, 'scripts', 'gen_vehicles_data.js'), genSrc, 'utf8');
  const vehicles = vehicleCount === 0 ? [] : [ONE_VEHICLE];
  fs.writeFileSync(path.join(d, 'vehicles_data.js'),
    '// fixture\nwindow.VEHICLES = ' + JSON.stringify(vehicles, null, 2) + ';\n', 'utf8');
  writeJson(path.join(d, 'web-data', 'vehicle_sync_data.json'), { vehicles: vehicles });
  writeJson(path.join(d, 'docs', 'manifest.json'), {
    stats: { vehicleCount: vehicleCount, photoCount: 0, videoCount: 0 },
    vehicles: vehicles.map(v => ({ id: v.id, photos: [], videos: [] })),
    assets: {}
  });
  return d;
}

/** 把源码里的守卫条件替换成 `if (false)`(变异体); 返回 null 表示锚点未命中 */
function mutateGuard(src, anchor) {
  if (src.indexOf(anchor) === -1) return null;
  return src.split(anchor).join('if (false) {');
}

/* ================================================================== */
section('S0 环境自检: 本进程能否 spawn 子 node');
if (!canSpawnNode()) {
  console.log('[环境缺失] 跳过零条熔断门禁测试');
  console.log('  本套件需能 spawn 子 node 进程(沙箱限制下可能 EBUSY)。');
  console.log('  不具备条件视为"本环境不具备执行条件", 非测试失败, 退出码 0。CI 里会真跑。');
  process.exit(0);
}
check('S0a 可 spawn 子 node(具备执行条件, 后续断言为真跑结果)', true);

/* ================================================================== */
section('S1 静态: 三道守卫源码锚点 + 接线(package.json / test:all)');
const SRC_GEN = fs.readFileSync(path.join(ROOT, 'scripts', 'gen_vehicles_data.js'), 'utf8');
const SRC_SYNC = fs.readFileSync(path.join(ROOT, 'scripts', 'sync_web_data.js'), 'utf8');
const SRC_AUDIT = fs.readFileSync(path.join(ROOT, 'scripts', 'audit_media_consistency.js'), 'utf8');
const ANCHOR_GEN = 'if (mirrorVehicles.length === 0 && existing.length > 0 && !process.argv.includes(\'--force\')) {';
const ANCHOR_SYNC = 'if ((vehicle.vehicles || []).length === 0 && prevCount > 0 && !process.argv.includes(\'--force\')) {';
const ANCHOR_AUDIT = 'if (!manifest.stats || manifest.stats.vehicleCount === 0) {';

check('S1a 守卫1 源码含零条熔断条件', SRC_GEN.indexOf(ANCHOR_GEN) >= 0);
check('S1b 守卫1 熔断文案含「拒绝覆盖」', SRC_GEN.indexOf('拒绝覆盖') >= 0);
check('S1c 守卫2 源码含零条熔断条件', SRC_SYNC.indexOf(ANCHOR_SYNC) >= 0);
check('S1d 守卫2 熔断文案含「拒绝写入」', SRC_SYNC.indexOf('拒绝写入') >= 0);
check('S1e 守卫3 源码含零条熔断条件', SRC_AUDIT.indexOf(ANCHOR_AUDIT) >= 0);
check('S1f 守卫3 熔断文案含「C6 零条熔断」', SRC_AUDIT.indexOf('C6 零条熔断') >= 0);
/* ★守卫3 不设 --force 逃生口是**刻意设计**(与前两道不对称), 见 audit_media_consistency.js
 * C6 处注释: 前两道的 --force 留给"飞书侧确实已清空、人工确认要清零"的操作口子;
 * 而审计层的职责是如实报告"0 车 = 异常", 若同一开关能一并绕过最后一道, 纵深防御就退化。
 * 故此处把"没有 force 逃生口"也钉死: 将来有人为求对称而给审计加静音开关时, 本断言转红。 */
check('S1i ★守卫3 不提供 --force 逃生口(不对称是刻意设计, 加静音开关会转红)',
  SRC_AUDIT.indexOf("process.argv.includes('--force')") === -1);
const pkgTxt = fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8');
check('S1g package.json 接线 test:zero-guard', /"test:zero-guard"\s*:/.test(pkgTxt));
const runnerTxt = fs.readFileSync(path.join(ROOT, 'scripts', 'run_all_tests.js'), 'utf8');
check('S1h run_all_tests.js 的 TEST_SUITES 含 test:zero-guard(CI 可达)', /'test:zero-guard'/.test(runnerTxt));

/* ================================================================== */
section('S2 ★守卫1: 镜像 0 车 + 本地已有 1 车 → exit≠0 且拒绝覆盖、原文件未被改写');
{
  const d = fixtureGen(SRC_GEN);
  const outFile = path.join(d, 'vehicles_data.js');
  const before = fs.readFileSync(outFile, 'utf8');
  const r = runNode(path.join(d, 'scripts', 'gen_vehicles_data.js'), []);
  const after = fs.readFileSync(outFile, 'utf8');
  check('S2a exit≠0(零条熔断生效)', r.status !== 0 && r.status !== null, 'status=' + r.status + ' err=' + (r.error && r.error.code) + ' out=' + r.all.slice(0, 300));
  check('S2b 输出含「拒绝覆盖」', /拒绝覆盖/.test(r.all), r.all.slice(0, 300));
  check('S2c 输出点名 gen_vehicles_data', /gen_vehicles_data/.test(r.all), r.all.slice(0, 300));
  check('S2d vehicles_data.js 内容**未被改写**(82 车被清库即此路径)', before === after, 'len ' + before.length + ' -> ' + after.length);
}

/* ================================================================== */
section('S3 守卫1 反向: 加 --force 应放行(不因零条熔断退 1)');
{
  const d = fixtureGen(SRC_GEN);
  const outFile = path.join(d, 'vehicles_data.js');
  const before = fs.readFileSync(outFile, 'utf8');
  const r = runNode(path.join(d, 'scripts', 'gen_vehicles_data.js'), ['--force']);
  const after = fs.readFileSync(outFile, 'utf8');
  check('S3a --force 时 exit=0', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 300));
  check('S3b --force 时不再打印「拒绝覆盖」', !/拒绝覆盖/.test(r.all), r.all.slice(0, 300));
  check('S3c --force 确实写了盘(证明 S2 的"未改写"是守卫拦的, 而非脚本没走到写盘)', before !== after && /window\.VEHICLES = \[\];/.test(after), after.slice(0, 120));
}

/* ================================================================== */
section('S4 ★守卫2: 新镜像 0 车 + 已有产物 1 车 → exit≠0 且拒绝写入、原产物未被覆盖');
{
  const f = fixtureSync([ONE_VEHICLE], []);
  const outFile = path.join(f.out, 'vehicle_sync_data.json');
  const before = fs.readFileSync(outFile, 'utf8');
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out]);
  const after = fs.readFileSync(outFile, 'utf8');
  check('S4a exit≠0(零条熔断生效)', r.status !== 0 && r.status !== null, 'status=' + r.status + ' err=' + (r.error && r.error.code) + ' out=' + r.all.slice(0, 300));
  check('S4b 输出含「拒绝写入」', /拒绝写入/.test(r.all), r.all.slice(0, 400));
  check('S4c 已有产物未被覆盖(仍为 1 车)', before === after, 'len ' + before.length + ' -> ' + after.length);
}

/* ================================================================== */
section('S5 守卫2 反向: --force 放行 + 反假阳性(新镜像有车时不得误拦)');
{
  const f = fixtureSync([ONE_VEHICLE], []);
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out, '--force']);
  check('S5a --force 时 exit=0', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 300));
  check('S5b --force 时不再打印「拒绝写入」', !/拒绝写入/.test(r.all), r.all.slice(0, 300));
  const wrote = JSON.parse(fs.readFileSync(path.join(f.out, 'vehicle_sync_data.json'), 'utf8'));
  check('S5c --force 确实写了盘(0 车), 证明 S4 的"未覆盖"是守卫拦的', Array.isArray(wrote.vehicles) && wrote.vehicles.length === 0, JSON.stringify(wrote).slice(0, 120));
}
{
  // 反假阳性: 新镜像 1 车 + 已有产物 1 车 → 不得拦截(否则正常同步会被熔断卡死)
  const f = fixtureSync([ONE_VEHICLE], [ONE_VEHICLE]);
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out]);
  check('S5d ★反假阳性: 新镜像有车时 exit=0(不得误拦正常同步)', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 300));
  const wrote = JSON.parse(fs.readFileSync(path.join(f.out, 'vehicle_sync_data.json'), 'utf8'));
  check('S5e 反假阳性: 产物已正常更新为 1 车', wrote.vehicles.length === 1, JSON.stringify(wrote).slice(0, 120));
}

/* ================================================================== */
section('S6 ★守卫3: manifest.stats.vehicleCount=0 → exit≠0 且输出含 C6 零条熔断');
{
  const d = fixtureAudit(0, SRC_AUDIT, SRC_GEN);
  const r = runNode(path.join(d, 'scripts', 'audit_media_consistency.js'), ['--manifest', 'docs/manifest.json'], { cwd: d });
  check('S6a exit≠0(零条熔断生效)', r.status !== 0 && r.status !== null, 'status=' + r.status + ' err=' + (r.error && r.error.code) + ' out=' + r.all.slice(0, 400));
  check('S6b 输出含「C6 零条熔断」', /C6 零条熔断/.test(r.all), r.all.slice(0, 400));
  check('S6c ★唯一失败项就是 C6(fixture 自洽, 无 C1/C2/C3/C5 干扰)',
    (r.all.match(/\[FAIL\]/g) || []).length === 1, 'FAIL 数=' + (r.all.match(/\[FAIL\]/g) || []).length + ' out=' + r.all.slice(0, 400));
}

/* ================================================================== */
section('S7 守卫3 反假阳性: vehicleCount=1 且全链自洽 → exit=0, 不得误报 C6');
{
  const d = fixtureAudit(1, SRC_AUDIT, SRC_GEN);
  const r = runNode(path.join(d, 'scripts', 'audit_media_consistency.js'), ['--manifest', 'docs/manifest.json'], { cwd: d });
  check('S7a exit=0', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
  check('S7b 输出不含 C6', !/C6/.test(r.all), r.all.slice(0, 400));
}

/* ================================================================== */
section('S8 ★变异自证: 摘掉守卫后红灯必须消失(证明红灯由守卫产生, 而非 fixture 自身报错)');
{
  const mutGen = mutateGuard(SRC_GEN, ANCHOR_GEN);
  check('S8a 守卫1 变异锚点命中(锚点变了请同步更新本测试)', mutGen !== null);
  if (mutGen !== null) {
    const d = fixtureGen(mutGen);
    const r = runNode(path.join(d, 'scripts', 'gen_vehicles_data.js'), []);
    check('S8b 守卫1 摘除后 exit=0(红灯消失 ⇒ 测试对守卫存亡敏感)', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 300));
    check('S8c 守卫1 摘除后不再打印「拒绝覆盖」', !/拒绝覆盖/.test(r.all), r.all.slice(0, 300));
  }
}
{
  const mutSync = mutateGuard(SRC_SYNC, ANCHOR_SYNC);
  check('S8d 守卫2 变异锚点命中(锚点变了请同步更新本测试)', mutSync !== null);
  if (mutSync !== null) {
    const d = mktmp('msync');
    fs.mkdirSync(path.join(d, 'scripts'), { recursive: true });
    const p = path.join(d, 'scripts', 'sync_web_data.js');
    fs.writeFileSync(p, mutSync, 'utf8');
    const f = fixtureSync([ONE_VEHICLE], []);
    const r = runNode(p, ['--source-dir', f.src, '--out', f.out]);
    check('S8e 守卫2 摘除后 exit=0(红灯消失 ⇒ 测试对守卫存亡敏感)', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 300));
    check('S8f 守卫2 摘除后不再打印「拒绝写入」', !/拒绝写入/.test(r.all), r.all.slice(0, 300));
  }
}
{
  const mutAudit = mutateGuard(SRC_AUDIT, ANCHOR_AUDIT);
  check('S8g 守卫3 变异锚点命中(锚点变了请同步更新本测试)', mutAudit !== null);
  if (mutAudit !== null) {
    const d = fixtureAudit(0, mutAudit, SRC_GEN);
    const r = runNode(path.join(d, 'scripts', 'audit_media_consistency.js'), ['--manifest', 'docs/manifest.json'], { cwd: d });
    check('S8h 守卫3 摘除后 exit=0(红灯消失 ⇒ 测试对守卫存亡敏感)', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
    check('S8i 守卫3 摘除后不再打印 C6', !/C6/.test(r.all), r.all.slice(0, 400));
  }
}

/* ================================================================== */
/* S9 ★守卫4: 车型数回退熔断(2026-10-06 补)
 * 事故: 飞书 APP数据备份/同步数据/ 里同名 vehicle_sync_data.json 有两份且内容不同
 *   (副本1: 98,347B / 100 车 / 2026-10-03; 副本2: 77,765B / 82 车 / 2026-09-06)。
 *   feishuFindFile 原按 API 返回顺序取第一份 → 取错就让线上 100 车静默回退到 82 车,
 *   而"0 条熔断"阈值是 0, 拦不住 82。故补"不得回退"这一道。 */
const manyVehicles = n => Array.from({ length: n }, (_, i) =>
  Object.assign({}, ONE_VEHICLE, { id: i + 1, display: '测试车型' + (i + 1) }));
section('S9 ★守卫4: 新镜像 82 车 < 已有产物 100 车 → exit≠0 且拒绝写入、原产物未被覆盖');
{
  const f = fixtureSync(manyVehicles(100), manyVehicles(82));
  const outFile = path.join(f.out, 'vehicle_sync_data.json');
  const before = fs.readFileSync(outFile, 'utf8');
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out]);
  const after = fs.readFileSync(outFile, 'utf8');
  check('S9a exit≠0(回退熔断生效)', r.status !== 0 && r.status !== null, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
  check('S9b 输出含「拒绝写入」且指出 82 < 100', /拒绝写入/.test(r.all) && /82\s*车\s*<\s*已有产物\s*100\s*车/.test(r.all), r.all.slice(0, 400));
  check('S9c 提示指向"同名重复文件"这一真实诱因', /同名重复的 vehicle_sync_data\.json/.test(r.all), r.all.slice(0, 400));
  check('S9d 已有产物未被覆盖(仍为 100 车)', before === after, 'len ' + before.length + ' -> ' + after.length);
}
section('S10 守卫4 反向: --force 放行 + 反假阳性(增车/平量不得误拦)');
{
  const f = fixtureSync(manyVehicles(100), manyVehicles(82));
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out, '--force']);
  check('S10a --force 时 exit=0(组长确实下架车型的合法路径)', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
  const wrote = JSON.parse(fs.readFileSync(path.join(f.out, 'vehicle_sync_data.json'), 'utf8'));
  check('S10b --force 确实写了盘(0 车), 证明 S9 的"未覆盖"是守卫拦的', Array.isArray(wrote.vehicles) && wrote.vehicles.length === 82, JSON.stringify(wrote).slice(0, 120));
}
{
  const f = fixtureSync(manyVehicles(100), manyVehicles(100));
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out]);
  check('S10c ★反假阳性: 平量(100→100) exit=0', r.status === 0, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
}
{
  const f = fixtureSync(manyVehicles(100), manyVehicles(101));
  const r = runNode(path.join(ROOT, 'scripts', 'sync_web_data.js'), ['--source-dir', f.src, '--out', f.out]);
  check('S10d ★反假阳性: 增车(100→101) exit=0, 且产物已更新为 101(不得卡死正常同步)', r.status === 0 &&
    JSON.parse(fs.readFileSync(path.join(f.out, 'vehicle_sync_data.json'), 'utf8')).vehicles.length === 101, 'status=' + r.status + ' out=' + r.all.slice(0, 400));
}

/* ================================================================== */
/* S11 ★同名取最新: feishuFindFile 必须按 modified_time 取最大者, 而非 API 返回顺序
 *  这是治因的一道 —— 即便云端同时存在 100 车与 82 车两份同名文件, 也必须稳定拿到新的。 */
section('S11 ★同名多份取最新(治因: 稳定拿到 100 车那份)');
const syncSrcNow = fs.readFileSync(path.join(ROOT, 'scripts', 'sync_web_data.js'), 'utf8');
check('S11a 静态: 存在 pickNewestByName 且 feishuFindFile 内使用它',
  /function\s+pickNewestByName/.test(syncSrcNow) && /const hit = pickNewestByName\(cands\)/.test(syncSrcNow));
// 判定前先剥掉块注释与行注释 —— 否则"注释里提到旧写法"会造成假红(本断言实际踩过一次)
const syncCodeOnly = syncSrcNow.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
check('S11b 静态: 已不存在按返回顺序取首份的 hit = f; break;(剥注释后判定)',
  !/hit\s*=\s*f;\s*break;/.test(syncCodeOnly));
{
  let fn = null;
  try { fn = require(path.join(ROOT, 'scripts', 'sync_web_data.js')).pickNewestByName; } catch (e) { fn = null; }
  check('S11c 模块可 require 且导出 pickNewestByName(require 不触发 main)', typeof fn === 'function');
  if (typeof fn === 'function') {
    const oldCopy = { name: 'vehicle_sync_data.json', token: 'OLD', modified_time: 1790694110 };   // 2026-09-29(82 车那份)
    const newCopy = { name: 'vehicle_sync_data.json', token: 'NEW', modified_time: 1791039554 };   // 2026-10-03(100 车那份)
    check('S11d 顺序为 [旧, 新] 时取新', fn([oldCopy, newCopy]).token === 'NEW');
    check('S11e ★顺序颠倒为 [新, 旧] 时仍取新(顺序无关是实现要点)', fn([newCopy, oldCopy]).token === 'NEW');
    check('S11f 缺 modified_time 的条目排最后(不会因缺字段被误认为最新)',
      fn([{ token: 'NO_TS' }, oldCopy]).token === 'OLD');
    check('S11g 空列表返回 null(不抛异常)', fn([]) === null && fn(null) === null);
    check('S11h 不修改入参数组(纯函数)', (() => {
      const arr = [oldCopy, newCopy];
      fn(arr);
      return arr[0].token === 'OLD' && arr[1].token === 'NEW';
    })());
  }
}

/* 清理临时目录(仅 tmpdir, 绝不触碰仓库文件) */
try {
  for (const d of tmpDirs) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {} }
} catch (e) {}

console.log('\n' + '='.repeat(62));
console.log('零条熔断门禁测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
console.log('全部通过 OK');
