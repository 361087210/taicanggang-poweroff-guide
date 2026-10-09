/**
 * V10.24 账号注销墓碑 · 防「删除后复活」回归测试
 * 运行: node tests/test_v1039_tombstone.js  (纯 vm 沙箱, 无外部依赖)
 *
 * 背景(任务② 账号生命周期审计):
 *   缺陷: 账号被「自助注销 / 组长删除 / 强制下线」后, 飞书云端 approved_users.json
 *   仍可能是旧快照; 下一次同步(安卓 pullApprovedStatusFromFeishu / 网页镜像同名函数)
 *   见到「云端有 本地无」就把已删账号 State.addUser 重新入库 —— 即「删除后复活」。
 *
 *   修复(端到端墓碑链路):
 *     1) js/00-bootstrap.js   独立存储键 tcg_deleted_users + 6 个墓碑 API
 *     2) js/01-state.js       State.removeUser(唯一合法删除收口)落墓碑
 *     3) js/05-sync.js        上行 payload 增 deleted 名单; 下行先 mergeCloudTombstones
 *                             + 复活点 isPhoneTombstoned 拦截
 *     4) js/09-web-sync.js    网页镜像复活点同源拦截
 *     5) js/02-auth.js / js/07-cache.js / js/09-web-sync.js  三处「重新注册」清墓碑
 *
 * 覆盖维度:
 *   A. 静态源码检查: 存储层 / 上行 / 下行 / 网页镜像 / 三处清墓碑 / A13 收敛门禁未被破坏
 *   B. 运行时行为(vm 真机源码沙箱): 墓碑单元行为 / removeUser 落墓碑 / 命中墓碑不复活
 *      / 对照组正常复活 / 云端名单跨设备传播 / 上行 payload 含 deleted
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = '.';
const _h = require('./e2e_harness');
const src = _h.loadCombinedSource();

const JS_DIR = path.join(REPO, 'js');
const read = f => fs.readFileSync(path.join(REPO, f), 'utf8');
const SRC_BOOT = read('js/00-bootstrap.js');
const SRC_STATE = read('js/01-state.js');
const SRC_SYNC = read('js/05-sync.js');
const SRC_WEB = read('js/09-web-sync.js');
const SRC_AUTH = read('js/02-auth.js');
const SRC_CACHE = read('js/07-cache.js');

/** 全部 js/*.js 按自然排序拼接(与 test_v1013_a3 同口径, 含注释的纯子串计数) */
const allJs = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort()
  .map(f => fs.readFileSync(path.join(JS_DIR, f), 'utf8')).join('\n');
const countOf = re => (allJs.match(re) || []).length;

const PASSED = [], FAILED = [];
function check(name, cond, detail = '') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');

// A1~A2: 墓碑存储层(00-bootstrap.js) 6 API + 独立存储键
const TOMB_API = ['loadTombstones', 'saveTombstones', 'TOMBSTONES',
  'isPhoneTombstoned', 'recordTombstone', 'mergeCloudTombstones', 'clearTombstone'];
check('A1 00-bootstrap.js 定义完整墓碑存储层(7 符号)',
  TOMB_API.every(n => SRC_BOOT.indexOf(' ' + n + '(') >= 0 || SRC_BOOT.indexOf(n + '=') >= 0 || SRC_BOOT.indexOf(n + ' ') >= 0),
  TOMB_API.filter(n => SRC_BOOT.indexOf(n) < 0).join(',') || 'all-present');
check('A2 墓碑使用独立存储键 tcg_deleted_users(与 tcg_users 同层)',
  SRC_BOOT.includes("'tcg_deleted_users'") && SRC_BOOT.includes("'tcg_users'"));
check('A3 存储层位于 USER SYSTEM 块内、USERS 初始化之后',
  SRC_BOOT.indexOf('USER SYSTEM') < SRC_BOOT.indexOf('tcg_deleted_users')
  && SRC_BOOT.indexOf('let USERS=loadUsers()') < SRC_BOOT.indexOf('TOMBSTONES=loadTombstones()'));

// A4: 删除唯一收口(01-state.js)落墓碑
check('A4 01-state.js removeUser 落墓碑(recordTombstone)',
  /recordTombstone\(\s*phone\s*,\s*\{\s*src:\s*'state'\s*\}\s*\)/.test(SRC_STATE));
check('A5 removeUser 落墓碑带 V10.24 溯源标记',
  /V10\.24/.test(SRC_STATE) && /recordTombstone/.test(SRC_STATE));

// A6: 上行 payload 含 deleted 名单
check('A6 05-sync.js push payload 含 deleted 名单(来源 TOMBSTONES)',
  /deleted:\s*\(\s*typeof\s+TOMBSTONES\s*!==\s*'undefined'/.test(SRC_SYNC)
  && /TOMBSTONES\.map\(\s*t\s*=>\s*t\.phone\s*\)/.test(SRC_SYNC));

// A7: 下行先合并云端删除名单, 再在复活点拦截
check('A7 05-sync.js pull 先 mergeCloudTombstones(data.deleted)',
  /mergeCloudTombstones\(\s*data\.deleted\s*\)/.test(SRC_SYNC));
const pullIdx = SRC_SYNC.indexOf('async function pullApprovedStatusFromFeishu');
const mergeIdx = SRC_SYNC.indexOf('mergeCloudTombstones(data.deleted)', pullIdx);
const gateIdx = SRC_SYNC.indexOf("isPhoneTombstoned(cu.phone)", pullIdx);
const addUserIdx = SRC_SYNC.indexOf("State.addUser(Object.assign({}, cu", pullIdx);
check('A8 05-sync.js 复活拦截顺序正确: merge < isPhoneTombstoned < State.addUser',
  pullIdx >= 0 && mergeIdx > pullIdx && gateIdx > mergeIdx && addUserIdx > gateIdx,
  `pull=${pullIdx} merge=${mergeIdx} gate=${gateIdx} addUser=${addUserIdx}`);

// A9: 网页镜像复活点同源拦截(且在重建密码/入库之前)
const webFn = SRC_WEB.slice(SRC_WEB.indexOf('window.pullApprovedStatusFromFeishu'));
const webGate = webFn.indexOf('isPhoneTombstoned(who&&who.phone))return false;');
const webRebuild = webFn.indexOf('var localHash=await hashPassword');
check('A9 09-web-sync.js 网页镜像复活点拦截(先于本地重建)',
  webGate >= 0 && webGate < webRebuild, `gate=${webGate} rebuild=${webRebuild}`);

// A10: 三处「重新注册」清墓碑
check('A10 02-auth.js doRegister 清墓碑', /clearTombstone\(\s*phone\s*\)/.test(SRC_AUTH));
check('A11 07-cache.js addMember 清墓碑', /clearTombstone\(\s*phone\s*\)/.test(SRC_CACHE));
const webClear = SRC_WEB.indexOf('clearTombstone(phone)');
check('A12 09-web-sync.js 网页重注册清墓碑', webClear >= 0);

// A13: 写入点收敛门禁未被破坏(纯子串计数, 与 test_v1013_a3 A13 同口径)
const pushN = countOf(/USERS\.push/g), spliceN = countOf(/USERS\.splice/g);
check('A13 全仓 USERS.push 计数===1(未被墓碑改动破坏)', pushN === 1, `count=${pushN}`);
check('A14 全仓 USERS.splice 计数===1(未被墓碑改动破坏)', spliceN === 1, `count=${spliceN}`);
// A15: 墓碑标识符不得含 USERS.push/USERS.splice 子串(防御性)
check('A15 墓碑标识符未引入 USERS.push/USERS.splice 子串',
  !/TOMBSTONES\.push/.test('USERS.push') && !/TOMBSTONES/.test('USERS.splice'));

/* ============================================================
 * B. 运行时行为(vm 真机源码沙箱)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

/**
 * 构造沙箱: 注入真机源码中按名提取的墓碑存储层 + State + 同步函数, 其余为桩。
 * 关键点:
 *  - TOMBSTONES 为 let 全局词法绑定, 函数跨脚本可读写;
 *  - USERS / state 以 sandbox 属性注入(符号解析命中上下文全局);
 *  - 飞书 I/O 全桩化, 使行为确定性、无网络。
 */
function makeSandbox() {
  const store = _h.createLocalStorage();
  const calls = { saveUsers: 0, push: 0 };
  const sandbox = {
    console, JSON, Math, Date, Promise, Set, Map, RegExp, Error,
    String, Number, Boolean, Array, Object,
    setTimeout: fn => { fn(); return 0; }, clearTimeout: () => {},
    localStorage: store,
    navigator: {},
    APP_VERSION: '10.24',
    // —— 业务桩 ——
    showToast: () => {},
    saveUsers: () => { calls.saveUsers++; },
    addSyncLog: () => {},
    pushRegistrationRejectionNotice: () => {},
    // —— 飞书桩 ——
    getFeishuCfg: () => ({ approvedSub: 'sub' }),
    feishuCfgReady: () => true,
    getFeishuToken: async () => 'tok',
    downloadJsonFromDataFeishu: async () => sandbox.__cloudData,
    uploadJsonToDataFeishu: async (t, name, json) => { sandbox.__uploaded = json; calls.push++; },
    getDataFolderToken: async () => null,
    feishuListFiles: async () => [],
    httpFetch: async () => { throw new Error('no-op'); },
    // runtime vars
    USERS: [],
    state: { currentUser: null },
    __cloudData: null,
    __uploaded: null,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  // 依赖序注入: 存储层(load→save→TOMBSTONES→...) → State → 同步函数
  for (const name of ['loadTombstones', 'saveTombstones', 'TOMBSTONES',
    'isPhoneTombstoned', 'recordTombstone', 'mergeCloudTombstones', 'clearTombstone',
    'State', 'pullApprovedStatusFromFeishu', 'pushApprovedUsersToFeishu']) {
    vm.runInContext(_h.extractNamedBlock(src, name), ctx, { filename: name + '.js' });
  }
  return {
    sb: sandbox, store, calls, ctx,
    run: e => vm.runInContext(e, ctx, { filename: 'eval.js' }),
  };
}

(async () => {
  try {
    /* ---------- B0. 墓碑存储层单元行为 ---------- */
    console.log('\n-- B0. 墓碑存储层单元行为 --');
    const b0 = makeSandbox();
    check('B0-1 初始无墓碑', b0.run('isPhoneTombstoned("13800000000")') === false);
    check('B0-2 recordTombstone 返回 true 并命中', b0.run('recordTombstone("13800000000")') === true
      && b0.run('isPhoneTombstoned("13800000000")') === true);
    check('B0-3 recordTombstone 幂等(重复返回 false)',
      b0.run('recordTombstone("13800000000")') === false && b0.run('TOMBSTONES.length') === 1);
    check('B0-4 墓碑已持久化到 tcg_deleted_users',
      typeof b0.store.getItem('tcg_deleted_users') === 'string'
      && b0.store.getItem('tcg_deleted_users').includes('13800000000'));
    check('B0-5 mergeCloudTombstones 并入云端名单',
      b0.run('mergeCloudTombstones(["13700000000","13600000000"])') === true
      && b0.run('isPhoneTombstoned("13700000000")') === true
      && b0.run('isPhoneTombstoned("13600000000")') === true);
    check('B0-6 mergeCloudTombstones 全为已有 → false',
      b0.run('mergeCloudTombstones(["13700000000"])') === false);
    check('B0-7 mergeCloudTombstones(非数组) → false 安全',
      b0.run('mergeCloudTombstones(null)') === false && b0.run('mergeCloudTombstones(undefined)') === false);
    check('B0-8 clearTombstone 命中清除并返回 true',
      b0.run('clearTombstone("13800000000")') === true
      && b0.run('isPhoneTombstoned("13800000000")') === false);
    check('B0-9 clearTombstone 未命中返回 false', b0.run('clearTombstone("13800000000")') === false);
    check('B0-10 clearTombstone 同步持久化',
      b0.store.getItem('tcg_deleted_users').indexOf('13800000000') < 0);
    check('B0-11 loadTombstones 复读一致', (() => {
      const b0b = makeSandbox();
      b0b.store.setItem('tcg_deleted_users', JSON.stringify([{ phone: '13500000000', at: 1 }]));
      b0b.run('TOMBSTONES=loadTombstones()');
      return b0b.run('isPhoneTombstoned("13500000000")') === true;
    })());

    /* ---------- B1. State.removeUser 落墓碑 ---------- */
    console.log('\n-- B1. State.removeUser 落墓碑(删除收口) --');
    const b1 = makeSandbox();
    b1.run('this.USERS=[{id:"u1",name:"甲",phone:"13911112222",role:"user"},{id:"u2",name:"乙",phone:"13933334444",role:"user"}];');
    check('B1-1 removeUser 命中返回 true 且仅删 1 人',
      b1.run('State.removeUser("13911112222")') === true && b1.run('USERS.length') === 1);
    check('B1-2 被删手机号已落墓碑', b1.run('isPhoneTombstoned("13911112222")') === true);
    check('B1-3 未涉及账号无墓碑', b1.run('isPhoneTombstoned("13933334444")') === false);
    check('B1-4 removeUser 记录不存在 → false 且不落墓碑',
      b1.run('State.removeUser("13900000000")') === false && b1.run('isPhoneTombstoned("13900000000")') === false);

    /* ---------- B2. 安卓同步: 命中墓碑 → 拒绝复活 ---------- */
    console.log('\n-- B2. pullApprovedStatusFromFeishu 命中墓碑不复活 --');
    const b2 = makeSandbox();
    b2.run('this.USERS=[];this.state={currentUser:null};');
    b2.run('recordTombstone("13800000000")');
    b2.sb.__cloudData = { users: [{ phone: '13800000000', name: '已删账号', status: 'active', password: 'salt$h' }] };
    await b2.run('pullApprovedStatusFromFeishu(null,true)');
    check('B2-1 云端旧快照中的已删账号未复活(USERS 仍为空)', b2.run('USERS.length') === 0);
    check('B2-2 未误删/未误加其他数据', b2.run('USERS.filter(u=>u.phone==="13800000000").length') === 0);

    /* ---------- B3. 对照: 无墓碑 → 正常复活 ---------- */
    console.log('\n-- B3. 对照: 无墓碑时正常合并(证明拦截精确) --');
    const b3 = makeSandbox();
    b3.run('this.USERS=[];this.state={currentUser:null};');
    b3.sb.__cloudData = { users: [{ phone: '13800000000', name: '正常账号', status: 'active', password: 'salt$h' }] };
    await b3.run('pullApprovedStatusFromFeishu(null,true)');
    check('B3-1 无墓碑 → 云端账号正常入库', b3.run('USERS.length') === 1 && b3.run('USERS[0].phone') === '13800000000');
    check('B3-2 入库状态归一为 active', b3.run('USERS[0].status') === 'active');
    check('B3-3 入库即落盘(saveUsers 被调用)', b3.calls.saveUsers >= 1);

    /* ---------- B4. 云端删除名单跨设备传播 ---------- */
    console.log('\n-- B4. 云端 deleted 名单传播(跨设备) --');
    const b4 = makeSandbox();
    b4.run('this.USERS=[];this.state={currentUser:null};');
    b4.sb.__cloudData = {
      users: [{ phone: '13700000000', name: '别处已删', status: 'active', password: 'salt$h' }],
      deleted: ['13700000000'],
    };
    await b4.run('pullApprovedStatusFromFeishu(null,true)');
    check('B4-1 云端 deleted 名单并入本地墓碑', b4.run('isPhoneTombstoned("13700000000")') === true);
    check('B4-2 同表内已删账号被拦截不复活', b4.run('USERS.length') === 0);

    /* ---------- B5. 上行 payload 含 deleted 名单 ---------- */
    console.log('\n-- B5. pushApprovedUsersToFeishu payload 含 deleted --');
    const b5 = makeSandbox();
    b5.run('this.USERS=[{id:"u1",name:"甲",phone:"13911112222",role:"user",status:"active"}];');
    b5.run('recordTombstone("13800000000");recordTombstone("13700000000")');
    b5.sb.__cloudData = { users: [{ phone: '13911112222', name: '甲', status: 'active' }] };
    const ok5 = await b5.run('pushApprovedUsersToFeishu()');
    check('B5-1 push 返回 true', ok5 === true);
    let payload = null;
    try { payload = JSON.parse(b5.sb.__uploaded); } catch (e) { }
    check('B5-2 上行 payload.deleted 为墓碑手机号数组',
      payload && Array.isArray(payload.deleted)
      && payload.deleted.indexOf('13800000000') >= 0
      && payload.deleted.indexOf('13700000000') >= 0,
      payload ? JSON.stringify(payload.deleted) : 'no-payload');
    check('B5-3 上行 payload 仍含 users 表(未破坏既有语义)',
      payload && Array.isArray(payload.users) && payload.users.length === 1 && payload.users[0].phone === '13911112222');
  } catch (e) {
    check('B 组运行时异常(整体)', false, e && e.stack ? e.stack.split('\n')[0] : String(e));
  }

  /* ---------- 汇总 ---------- */
  console.log('\n============================================');
  console.log(`PASSED: ${PASSED.length}  FAILED: ${FAILED.length}`);
  if (FAILED.length) { console.log('失败项:\n - ' + FAILED.join('\n - ')); process.exit(1); }
  console.log('全部通过 ✅');
  process.exit(0);
})();
