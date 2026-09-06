/**
 * ============================================================
 * test_v110_bitable_data_access.js - V11.0 Bitable 数据访问分层 专项回归测试
 * ============================================================
 * 目标: 验证 feishu-api.js 中新增的 DATA_ACCESS 分层(dataReadAll/dataWrite)
 *       的 路由/兜底/降级/双写/重试队列 行为, 且 BITABLE_TABLE_NAMES 收敛正确。
 *
 * 测试策略(Mock 服务端不支持 Bitable 端点, 故不跑完整 API 路径):
 *   参照 test_v1015_member_sync_gate.js 的 extractNamedBlock 模式 —— 直接从
 *   真实 feishu-api.js 源码提取 DEFAULTS/getConfig/log/_readLocalJSON/
 *   dataReadAll/dataWrite/BITABLE_TABLE_NAMES/DATA_ACCESS 等块注入 vm 沙箱,
 *   Bitable 同步原语(sync*Bitable)以桩函数提供, 精确控制成功/失败/超时,
 *   从而验证 dataAccess 的路由与降级逻辑, 而非网络交互。
 *
 * 覆盖矩阵:
 *  K1-K3 源码级: BITABLE_TABLE_NAMES 收敛正确 + DATA_ACCESS 结构完整
 *  A1  未配置 bitableAppToken → dataReadAll 走 JSON 兜底(不请求 Bitable)
 *  A2  配置 bitableAppToken + Bitable 成功(有增量) → 返回本地全集(优先)
 *  A3  配置 bitableAppToken + Bitable 失败 → 降级 JSON 兜底
 *  A4  配置 bitableAppToken + Bitable 无增量(added+updated=0) → 视为无效, 降级 JSON
 *  A5  配置 bitableAppToken + Bitable 超时 → 超时降级 JSON 兜底
 *  W1  dataWrite 车辆 + Bitable ok + 窗口内 → 返回 true + 双写 vehicles_data_js_mirror
 *  W2  dataWrite 用户 + Bitable ok + 窗口内 → 返回 true + 双写 approved_users
 *  W3  dataWrite 车辆 + Bitable ok + 超窗口旧记录 → 返回 true + 不双写 JSON
 *  W4  dataWrite 车辆 + Bitable fail + 窗口内 → 返回 false + 双写 JSON + 入重试队列
 *  W5  dataWrite 重试队列上限 100(超量截断, 保留最新)
 *
 * 运行: node tests/test_v110_bitable_data_access.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { extractNamedBlock } = require('./e2e_harness');

const ROOT = path.join(__dirname, '..');
const apiSrc = fs.readFileSync(path.join(ROOT, 'feishu-api.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name); }
}
function section(title) {
  console.log('\n==============================================================');
  console.log(title);
  console.log('==============================================================');
}

// 需要注入的真实源码块(依赖序)
const API_BLOCKS = [
  'DEFAULTS', 'getConfig', 'log', '_readLocalJSON',
  'BITABLE_TABLE_NAMES', 'dataReadAll', 'dataWrite', 'DATA_ACCESS',
];

// feishu-api.js 模块级内部状态(getConfig 等引用 _cfg, 需一并注入)
const API_PROLOGUE = 'let _cfg = null; let _token = null; let _tokenExpiry = 0;';

function safeBlock(name) {
  try { return extractNamedBlock(apiSrc, name); } catch (_) { return null; }
}

/**
 * 构造 DATA_ACCESS 测试沙箱
 * @param {Object} opts
 *   - cfg: {bitableAppToken?} 预置的 feishu_config
 *   - vehicles / users: 沙箱内的本地全集
 *   - fromBitable: syncUsersFromBitable/syncVehiclesFromBitable 返回或抛错
 *   - toBitable: syncUsersToBitable/syncVehiclesToBitable reject 时抛错, 否则成功
 * 桩函数按调用类型(type)分流注入。
 */
function makeDataSandbox(opts) {
  opts = opts || {};
  // 调用计数器: 记录 Bitable 同步原语是否被触达
  const calls = { vehicleFrom: 0, userFrom: 0, vehicleTo: 0, userTo: 0 };
  const sandbox = {
    console,
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
      clear() { this._m.clear(); },
    },
    setTimeout, clearTimeout, Promise, JSON, Object, Array, Date, Set, Map, RegExp, Error,
    DEFAULTS: undefined, // 由 API_BLOCKS 注入真实值覆盖
    VEHICLES: opts.vehicles || [],
    USERS: opts.users || [],
    window: null,
    // ---- Bitable 同步原语桩(按 type 分流, 计数) ----
    syncVehiclesFromBitable: async () => { calls.vehicleFrom++; return opts.fromBitable || { added: 0, updated: 0 }; },
    syncUsersFromBitable: async () => { calls.userFrom++; return opts.fromBitable || { added: 0, updated: 0 }; },
    syncVehiclesToBitable: async () => { calls.vehicleTo++; if (opts.toBitableReject) throw new Error('Bitable 写入失败(桩)'); return {}; },
    syncUsersToBitable: async () => { calls.userTo++; if (opts.toBitableReject) throw new Error('Bitable 写入失败(桩)'); return {}; },
  };
  sandbox.window = sandbox;
  if (opts.cfg) {
    sandbox.localStorage.setItem('feishu_config', JSON.stringify(opts.cfg));
  }
  const ctx = vm.createContext(sandbox);
  vm.runInContext(API_PROLOGUE, ctx, { filename: 'feishu-api#prologue.js' });
  for (const n of API_BLOCKS) {
    const block = extractNamedBlock(apiSrc, n);
    vm.runInContext(block, ctx, { filename: 'feishu-api#' + n + '.js' });
  }
  return {
    sandbox, ctx, calls,
    run: expr => vm.runInContext(expr, ctx, { filename: 'v110_eval.js' }),
    _dump: () => sandbox.localStorage._dump(),
  };
}

(async function main() {

// =============================================================
section('K: 源码级 表名收敛 + DATA_ACCESS 结构 (K1-K3)');
// =============================================================
{
  const bTables = safeBlock('BITABLE_TABLE_NAMES');
  const bDef = safeBlock('DEFAULTS');
  check('K1 BITABLE_TABLE_NAMES 块可提取', !!bTables);
  check('K1 BITABLE_TABLE_NAMES 正确解析 DEFAULTS.bitableTables', !!bTables && /DEFAULTS\.bitableTables/.test(bTables));
  check('K2 DEFAULTS.bitableTables 收敛为双表常量', !!bDef && /VEHICLES:\s*'tbl Vehicles'/.test(bDef) && /USERS:\s*'tbl Users'/.test(bDef));
  check('K2 DEFAULTS 含 jsonMirrorDays 窗口常量', !!bDef && /jsonMirrorDays:\s*30/.test(bDef));
  const bDA = safeBlock('DATA_ACCESS');
  check('K3 DATA_ACCESS 块可提取且导出 readAll/write/TABLE_NAMES', !!bDA && /readAll:\s*dataReadAll/.test(bDA) && /write:\s*dataWrite/.test(bDA) && /TABLE_NAMES:\s*BITABLE_TABLE_NAMES/.test(bDA));
}

// 验证沙箱内 BITABLE_TABLE_NAMES / DATA_ACCESS 运行时值
{
  const sb = makeDataSandbox({ cfg: {} });
  const names = sb.run('BITABLE_TABLE_NAMES');
  check('K1-RUNTIME BITABLE_TABLE_NAMES = {VEHICLES,USERS} 双表', !!names && names.VEHICLES === 'tbl Vehicles' && names.USERS === 'tbl Users');
  const da = sb.run('DATA_ACCESS');
  check('K3-RUNTIME DATA_ACCESS 含 readAll/write/TABLE_NAMES', !!da && typeof da.readAll === 'function' && typeof da.write === 'function' && da.TABLE_NAMES === names);
}

// =============================================================
section('A: 读路径 dataReadAll 路由/兜底/降级 (A1-A5)');
// =============================================================
{
  // A1: 未配置 bitableAppToken → 直接走 JSON 兜底, 不触达 Bitable
  const localVeh = [{ id: 1, display: '本地车A' }, { id: 2, display: '本地车B' }];
  const sb = makeDataSandbox({ cfg: {}, vehicles: localVeh });
  const r = await sb.run('dataReadAll("vehicles")');
  check('A1 未配置 bitableAppToken 返回本地 JSON 全集', Array.isArray(r) && r.length === 2 && r[0].id === 1);
  check('A1 未配置 bitableAppToken 未触达 Bitable 同步原语', sb.calls.vehicleFrom === 0 && sb.calls.userFrom === 0);
}
{
  // A2: 配置 token + Bitable 有增量 → 返回本地全集(优先)
  const localVeh = [{ id: 1, display: '车A' }, { id: 2, display: '车B' }];
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_A2' }, vehicles: localVeh, fromBitable: { added: 2, updated: 0 } });
  const r = await sb.run('dataReadAll("vehicles")');
  check('A2 Bitable 有增量 → 返回本地全集', Array.isArray(r) && r.length === 2 && r[1].id === 2);
}
{
  // A3: 配置 token + Bitable 抛错 → 降级 JSON 兜底
  const localVeh = [{ id: 9, display: '兜底车' }];
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_A3' }, vehicles: localVeh, fromBitable: new Error('网络失败(桩)') });
  const r = await sb.run('dataReadAll("vehicles")');
  check('A3 Bitable 抛错 → 降级返回 JSON 兜底', Array.isArray(r) && r.length === 1 && r[0].id === 9);
}
{
  // A4: 配置 token + Bitable 无增量(added+updated=0) → 视为无效, 降级 JSON
  const localVeh = [{ id: 7, display: '无增量车' }];
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_A4' }, vehicles: localVeh, fromBitable: { added: 0, updated: 0 } });
  const r = await sb.run('dataReadAll("vehicles")');
  check('A4 Bitable 无增量(0+0) → 视为无效, 降级 JSON', Array.isArray(r) && r.length === 1 && r[0].id === 7);
}
{
  // A5: 配置 token + Bitable 慢响应 → 超时降级 JSON(用 50ms 短超时)
  const localVeh = [{ id: 12, display: '超时车' }];
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_A5' }, vehicles: localVeh, fromBitable: (() => { const p = new Promise(res => setTimeout(() => res({ added: 1, updated: 0 }), 500)); return p; })() });
  const r = await sb.run('dataReadAll("vehicles", { bitableTimeoutMs: 50 })');
  check('A5 Bitable 超时(50ms) → 降级 JSON 兜底', Array.isArray(r) && r.length === 1 && r[0].id === 12);
}

// =============================================================
section('W: 写路径 dataWrite 双写/重试 (W1-W5)');
// =============================================================
{
  // W1: 车辆 + Bitable ok + 窗口内 → true + 双写 vehicles_data_js_mirror
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_W1' } });
  const payload = { id: 101, display: '新车', updatedAt: Date.now() };
  const ok = await sb.run('dataWrite("vehicles", ' + JSON.stringify(payload) + ')');
  const mirror = JSON.parse(sb.sandbox.localStorage.getItem('vehicles_data_js_mirror') || '[]');
  check('W1 Bitable ok → 返回 true', ok === true);
  check('W1 窗口内车辆双写至 vehicles_data_js_mirror', Array.isArray(mirror) && mirror.length === 1 && mirror[0].id === 101);
}
{
  // W2: 用户 + Bitable ok + 窗口内 → true + 双写 approved_users
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_W2' } });
  const payload = { id: 'u_302', name: '测试用户', updatedAt: Date.now() };
  const ok = await sb.run('dataWrite("users", ' + JSON.stringify(payload) + ')');
  const mirror = JSON.parse(sb.sandbox.localStorage.getItem('approved_users') || '[]');
  check('W2 用户 Bitable ok → 返回 true', ok === true);
  check('W2 窗口内用户双写至 approved_users', Array.isArray(mirror) && mirror.length === 1 && mirror[0].id === 'u_302');
}
{
  // W3: 车辆 + Bitable ok + 超窗口旧记录(updatedAt 已过期) → true + 不双写 JSON
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_W3' } });
  const oldTs = Date.now() - (31 * 86400000); // 31 天前, 超出 30 天窗口
  const payload = { id: 555, display: '旧车', updatedAt: oldTs };
  const ok = await sb.run('dataWrite("vehicles", ' + JSON.stringify(payload) + ')');
  const mirror = JSON.parse(sb.sandbox.localStorage.getItem('vehicles_data_js_mirror') || '[]');
  check('W3 超窗口旧记录 → 返回 true(Bitable 仍写)', ok === true);
  check('W3 超窗口旧记录不双写 JSON', Array.isArray(mirror) && mirror.length === 0);
}
{
  // W4: 车辆 + Bitable fail + 窗口内 → false + 双写 JSON + 入重试队列
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_W4' }, toBitableReject: true });
  const payload = { id: 777, display: '失败车', updatedAt: Date.now() };
  const ok = await sb.run('dataWrite("vehicles", ' + JSON.stringify(payload) + ')');
  const mirror = JSON.parse(sb.sandbox.localStorage.getItem('vehicles_data_js_mirror') || '[]');
  const q = JSON.parse(sb.sandbox.localStorage.getItem('bitable_retry_queue') || '[]');
  check('W4 Bitable fail → 返回 false', ok === false);
  check('W4 Bitable fail 仍双写 JSON 作为本地兜底', Array.isArray(mirror) && mirror.length === 1 && mirror[0].id === 777);
  check('W4 Bitable fail 入重试队列', Array.isArray(q) && q.length === 1 && q[0].type === 'vehicles' && q[0].payload.id === 777);
}
{
  // W5: 重试队列上限 100(超出截断, 保留最新 100 条)
  const sb = makeDataSandbox({ cfg: { bitableAppToken: 'bitable_W5' }, toBitableReject: true });
  // 预置 100 条旧记录
  const pre = [];
  for (let i = 0; i < 100; i++) pre.push({ type: 'vehicles', payload: { id: i }, ts: 1000 + i });
  sb.sandbox.localStorage.setItem('bitable_retry_queue', JSON.stringify(pre));
  const payload = { id: 999, display: '超量', updatedAt: Date.now() };
  await sb.run('dataWrite("vehicles", ' + JSON.stringify(payload) + ')');
  const q = JSON.parse(sb.sandbox.localStorage.getItem('bitable_retry_queue') || '[]');
  check('W5 重试队列长度 ≤ 100', Array.isArray(q) && q.length <= 100);
  check('W5 队列保留最新一条(id=999)', Array.isArray(q) && q[q.length - 1].payload.id === 999);
}

// =============================================================
console.log('\n==============================================================');
console.log(`V11.0 Bitable 数据访问分层专项测试汇总: PASS=${pass}  FAIL=${fail}`);
console.log('==============================================================');
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(f => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('✅ 全部通过 V11.0 专项 (' + pass + ' 项)');
}

})().catch(e => { console.error('运行时错误:', e); process.exit(1); });
