/**
 * ============================================================
 * test_v110_audit.js - V11.3 审计与操作留痕 专项回归测试
 * ============================================================
 * 目标: 验证 js/16-audit.js(审计模块)的
 *       本地留痕 / 删除告警节流 / Bitable 上报 / 有界环形缓冲 行为。
 *
 * 测试策略(审计模块为 IIFE, 以整文件注入 vm 沙箱, 而非 extractNamedBlock):
 *   - 提供 window/localStorage/state/APP_VERSION/FeishuAPI 桩 + 可控时钟
 *   - 通过 window.Audit.track/readLocal/clearLocal 交互验证
 *
 * 覆盖矩阵:
 *  S1-S2 模块表面: window.Audit 暴露 track/init/readLocal/clearLocal; init 幂等
 *  A1-A2 本地留痕: 已登录取 state.currentUser; 未登录匿名/guest 兜底
 *  A3    有界环形: MAX_LOCAL=500, 超量裁剪保留最新
 *  N1    删除告警: 配置就绪 + chatId → sendGroupMessage 调用
 *  N2    删除节流: 5s 内二次删除仅告警一次
 *  N3    删除降级: 未配置飞书 → 不告警
 *  P1-P2 Bitable 上报: 配置 bitableAppToken → bitableCreateRecord; 未配置不触达
 *  C1    清理: clearLocal 清空本地日志
 *
 * 运行: node tests/test_v110_audit.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createLocalStorage } = require('./e2e_harness');

const ROOT = path.join(__dirname, '..');
const auditSrc = fs.readFileSync(path.join(ROOT, 'js/16-audit.js'), 'utf8');

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

/**
 * 构造审计模块沙箱
 * @param {Object} opts
 *   - now: 初始时钟值(ms); 受控, 用于测试节流
 *   - state: 全局 state 对象(可传 null 模拟未登录, 或省略模拟未加载)
 *   - feishu: {ready, cfg, sendGroupMessage, bitableCreateRecord} 飞书桩
 * @returns {Object} {w, run, clock, feishu}
 */
function makeAuditSandbox(opts) {
  opts = opts || {};
  const localStorage = createLocalStorage();
  const stubs = {
    sendGroupMessage: [],
    bitableCreateRecord: [],
  };
  // 受控时钟: 模块内 Date.now() 用 sandbox.Date 覆盖
  let nowMs = (opts.now !== undefined) ? opts.now : 1000000;
  const clock = {
    get: () => nowMs,
    set: (x) => { nowMs = x; },
    advance: (ms) => { nowMs += ms; },
  };

  const sandbox = {
    console,
    localStorage,
    JSON, Array, Object, String, Number, Boolean, RegExp, Error, Promise, Set, Map,
    // 委托给真实 Date 的关键方法, 新实例基于当前受控时间
    Date: new Proxy(Date, {
      apply(target, thisArg, args) {
        // Date() 无new调用 → 当前时间字符串
        return target(nowMs);
      },
      construct(target, args) {
        if (args.length === 0) return new target(nowMs);
        return new target(...args);
      },
      get(target, prop) {
        if (prop === 'now') return () => nowMs;
        return target[prop];
      },
      set() { return true; },
    }),
    setTimeout, clearTimeout,
    state: undefined,
    window: null,
    APP_VERSION: '10.15.3',
    FeishuAPI: null,
  };
  sandbox.window = sandbox;

  // 状态注入
  if (opts.hasOwnProperty('state')) sandbox.state = opts.state;

  // 飞书桩注入
  const feishu = {
    ready: (opts.feishu && opts.feishu.ready) || false,
    cfg: (opts.feishu && opts.feishu.cfg) || {},
    isConfigReady() { return this.ready; },
    getConfig() { return this.cfg; },
    sendGroupMessage(chatId, content) { stubs.sendGroupMessage.push({ chatId, content }); return Promise.resolve({}); },
    bitableCreateRecord(appToken, tableId, fields) { stubs.bitableCreateRecord.push({ appToken, tableId, fields }); return Promise.resolve({ record: {} }); },
  };
  if (opts.feishu) {
    if (opts.feishu.hasOwnProperty('ready')) feishu.ready = opts.feishu.ready;
    if (opts.feishu.cfg) feishu.cfg = opts.feishu.cfg;
  }
  sandbox.FeishuAPI = feishu;

  const ctx = vm.createContext(sandbox);
  vm.runInContext(auditSrc, ctx, { filename: 'js/16-audit.js' });
  return {
    sandbox, clock, stubs, feishu,
    run: expr => vm.runInContext(expr, ctx, { filename: 'v110_audit_eval.js' }),
    Audit: sandbox.window.Audit,
  };
}

// =============================================================
section('S: 模块表面 (S1-S2)');
// =============================================================
{
  const sb = makeAuditSandbox({});
  const A = sb.Audit;
  check('S1 window.Audit 暴露 track', !!A && typeof A.track === 'function');
  check('S1 window.Audit 暴露 init', !!A && typeof A.init === 'function');
  check('S1 window.Audit 暴露 readLocal', !!A && typeof A.readLocal === 'function');
  check('S1 window.Audit 暴露 clearLocal', !!A && typeof A.clearLocal === 'function');
  // init 幂等
  sb.run('Audit.init(); Audit.init();');
  check('S2 init 幂等(重复调用不抛错)', true);
}

// =============================================================
section('A: 本地留痕 (A1-A3)');
// =============================================================
{
  // A1: 已登录 → 取 state.currentUser
  const sb = makeAuditSandbox({ state: { currentUser: { phone: '13800000000', role: 'leader' } } });
  const entry = sb.Audit.track('vehicle.create', 'vehicle', 42, { brand: '上汽', display: '荣威' });
  const log = sb.Audit.readLocal();
  check('A1 track 返回 entry', !!entry && entry.action === 'vehicle.create');
  check('A1 本地写入 audit_log', Array.isArray(log) && log.length === 1);
  check('A1 entry 取当前用户手机号', entry.actor === '13800000000');
  check('A1 entry 角色为 leader', entry.role === 'leader');
  check('A1 entry 含 appVersion', entry.appVersion === '10.15.3');
  check('A1 entry 含 entityType/entityId', entry.entityType === 'vehicle' && entry.entityId === '42');
  check('A1 entry 详情被保留', entry.detail && entry.detail.brand === '上汽');
}
{
  // A2: 未登录(state.currentUser=null) → 匿名/guest 兜底
  const sb = makeAuditSandbox({ state: { currentUser: null } });
  const entry = sb.Audit.track('vehicle.update', 'vehicle', 7, { k: 'v' });
  check('A2 未登录 actor 兜底 anonymous', entry.actor === 'anonymous');
  check('A2 未登录 role 兜底 guest', entry.role === 'guest');
}
{
  // A3: 有界环形 500
  const sb = makeAuditSandbox({ state: { currentUser: null } });
  for (let i = 0; i < 505; i++) sb.Audit.track('vehicle.update', 'vehicle', i, { i });
  const log = sb.Audit.readLocal();
  check('A3 本地日志长度被裁剪至 500', Array.isArray(log) && log.length === 500);
  check('A3 保留最新一条(id=504)', log[log.length - 1].entityId === '504');
  check('A3 丢弃最早一条(id=0)', log[0].entityId !== '0');
}

// =============================================================
section('N: 删除告警 + 节流 (N1-N3)');
// =============================================================
{
  // N1: 配置就绪 + chatId → sendGroupMessage 一次
  const sb = makeAuditSandbox({
    state: { currentUser: { phone: '13800000000', role: 'leader' } },
    feishu: { ready: true, cfg: { chatId: 'oc_test', bitableAppToken: 'bitable_t' } },
  });
  sb.Audit.track('vehicle.delete', 'vehicle', 5, { brand: '上汽', display: '荣威' });
  check('N1 删除触达 sendGroupMessage', sb.stubs.sendGroupMessage.length === 1);
  check('N1 告警文案含操作人', !!sb.stubs.sendGroupMessage[0] && sb.stubs.sendGroupMessage[0].content.indexOf('13800000000') > -1);
  check('N1 告警文案含删除对象', !!sb.stubs.sendGroupMessage[0] && sb.stubs.sendGroupMessage[0].content.indexOf('车辆') > -1);
}
{
  // N2: 节流 5s → 5s 内二次删除仅告警一次
  const sb = makeAuditSandbox({
    state: { currentUser: { phone: 'p1', role: 'member' } },
    feishu: { ready: true, cfg: { chatId: 'oc_throttle' } },
  });
  const t0 = sb.clock.get();
  sb.Audit.track('vehicle.delete', 'vehicle', 1, {});
  sb.clock.advance(1000); // +1s < 5s
  sb.Audit.track('vehicle.delete', 'vehicle', 2, {});
  check('N2 5s 内第二次删除不重复告警', sb.stubs.sendGroupMessage.length === 1);
  sb.clock.advance(5100); // 累计 6.1s > 5s
  sb.Audit.track('vehicle.delete', 'vehicle', 3, {});
  check('N2 超过 5s 后再次告警', sb.stubs.sendGroupMessage.length === 2);
  check('N2 节流窗口重置(ts 置为新告警时间)', (sb.stubs.sendGroupMessage[1] && sb.stubs.sendGroupMessage[1].content) != null);
}
{
  // N3: 未配置就绪 → 不告警
  const sb = makeAuditSandbox({
    state: { currentUser: { phone: 'p2', role: 'member' } },
    feishu: { ready: false, cfg: { chatId: 'oc_x' } },
  });
  sb.Audit.track('user.delete', 'user', '13900000000', { name: '张三' });
  check('N3 未配置就绪 → 不告警', sb.stubs.sendGroupMessage.length === 0);
}

// =============================================================
section('P: Bitable 上报 (P1-P2)');
// =============================================================
{
  // P1: 配置 bitableAppToken → bitableCreateRecord
  const sb = makeAuditSandbox({
    state: { currentUser: { phone: 'p3', role: 'leader' } },
    feishu: { ready: true, cfg: { chatId: 'oc_p', bitableAppToken: 'bitable_p', auditTableId: 'tblAuditTest' } },
  });
  sb.Audit.track('vehicle.create', 'vehicle', 88, { brand: '上汽' });
  check('P1 上报触达 bitableCreateRecord', sb.stubs.bitableCreateRecord.length === 1);
  const rec = sb.stubs.bitableCreateRecord[0];
  check('P1 使用审计表 ID', rec.tableId === 'tblAuditTest');
  check('P1 字段含时间/操作/操作人', !!rec.fields['时间'] && !!rec.fields['操作'] && !!rec.fields['操作人']);
  check('P1 字段含对象/角色/版本', !!rec.fields['对象类型'] && !!rec.fields['对象ID'] && !!rec.fields['角色'] && !!rec.fields['版本']);
}
{
  // P2: 未配置 bitableAppToken → 不触达
  const sb = makeAuditSandbox({
    state: { currentUser: { phone: 'p4', role: 'member' } },
    feishu: { ready: true, cfg: { chatId: 'oc_p2' } },
  });
  sb.Audit.track('vehicle.update', 'vehicle', 9, { k: 'v' });
  check('P2 未配置 bitableAppToken → 不触达上报', sb.stubs.bitableCreateRecord.length === 0);
}

// =============================================================
section('C: 本地清理 (C1)');
// =============================================================
{
  const sb = makeAuditSandbox({ state: { currentUser: { phone: 'p5', role: 'member' } } });
  sb.Audit.track('vehicle.update', 'vehicle', 1, {});
  check('C1 清理前存在日志', sb.Audit.readLocal().length === 1);
  sb.Audit.clearLocal();
  check('C1 clearLocal 清空本地日志', sb.Audit.readLocal().length === 0);
}

// =============================================================
console.log('\n==============================================================');
console.log(`V11.3 审计模块专项测试汇总: PASS=${pass}  FAIL=${fail}`);
console.log('==============================================================');
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(f => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('✅ 全部通过 V11.3 审计专项 (' + pass + ' 项)');
}

process.exit(fail > 0 ? 1 : 0);
