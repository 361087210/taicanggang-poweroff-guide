/**
 * V10.24 自助注销账号 · 安全加固回归测试
 * 运行: node tests/test_v1038_account_cancel.js  (需 jsdom? 否——纯 vm 沙箱)
 *
 * 背景(需求来源 / 任务②):
 *   审计发现账号生命周期缺失"自助注销"闭环 —— 用户只能"退出登录"(账号仍保留在
 *   成员列表), 无法删除自己的账号; demo.html 也无对应入口。本次补齐:
 *     1) demo.html 设置卡片新增「注销账号」入口(onclick="cancelAccount()")
 *     2) js/02-auth.js 新增顶层 async function cancelAccount()
 *     3) 权限边界: 组长账号不可自助注销(审批链唯一源头, 否则无人可审批组员)
 *     4) 删除走 State.removeUser —— 全项目唯一的合法 USERS 删除入口
 *        (不可在业务层裸写 USERS.splice/push, 见 test_v1013_a3 A13 计数)
 *     5) 云端传播复用 pushApprovedUsersToFeishu(带 1 次 1500ms 重试 + 失败告警文案)
 *     6) 收尾复用 doLogout() 清会话回登录页, 并用最终结果 toast 覆盖"已退出登录"
 *
 * 覆盖维度:
 *   A. 静态源码检查: 入口接线 / 守卫字面串 / 删除入口收敛 / 云端推送形态 / 收尾顺序
 *   B. 运行时行为(vm 真机源码沙箱): 未登录 / 组长拒绝 / 组员注销成功(含重试分支) / 记录缺失
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = '.';
const _h = require('./e2e_harness');
const src = _h.loadCombinedSource();

const SRC_AUTH = fs.readFileSync(path.join(REPO, 'js/02-auth.js'), 'utf8');
const SRC_HTML = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');

const PASSED = [], FAILED = [];
function check(name, cond, detail = '') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');

// 提取 cancelAccount 的**代码**(剔除注释, 避免注释里的描述干扰断言)
const cancelBlock = _h.extractNamedBlock(src, 'cancelAccount');
const cancelCode = cancelBlock.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

check('A1 demo.html 存在注销入口(onclick="cancelAccount()")', SRC_HTML.includes('onclick="cancelAccount()"'));
check('A2 demo.html 注销入口可见文案为「注销账号」', SRC_HTML.includes('>注销账号</span>'));
check('A3 02-auth.js 定义顶层 async function cancelAccount', /async\s+function\s+cancelAccount\s*\(/.test(SRC_AUTH));
check('A4 未登录守卫(请先登录)存在', /if\s*\(\s*!state\.currentUser\s*\)/.test(cancelCode) && cancelCode.includes('请先登录'));
check('A5 组长不可自助注销(守卫字面串, 安全边界)', cancelCode.includes('组长账号不可自助注销'));
check('A6 二次确认弹窗 showConfirm 且标题为「注销账号」', /showConfirm\(\s*'注销账号'/.test(cancelCode));

// 写入点收敛: 必须走 State.removeUser, 不得裸写 USERS.splice/push
check('A7 删除经 State.removeUser(唯一合法 USERS 删除入口)', /State\.removeUser\s*\(/.test(cancelCode));
check('A8 业务层未裸写 USERS.splice / USERS.push(遵守 A13 收敛门禁)',
  !/USERS\.splice/.test(cancelCode) && !/USERS\.push/.test(cancelCode));
check('A9 记录缺失时降级提示(注销失败: 未找到当前账号记录)', cancelCode.includes('注销失败'));

// 云端传播形态(对齐 test_v103_fixes A20 正则): 首次推送 + 失败重试 1 次
check('A10 云端推送段形态 pushApprovedUsersToFeishu(); + if(!pushed)',
  /pushed\s*=\s*await\s+pushApprovedUsersToFeishu\(\)\s*;/.test(cancelCode) && /if\s*\(\s*!pushed\s*\)/.test(cancelCode));
check('A11 失败重试带 1500ms 退避(setTimeout(r,1500))', /setTimeout\(\s*r\s*,\s*1500\s*\)/.test(cancelCode));
check('A12 云端失败告警文案「云端同步失败」保留', cancelCode.includes('云端同步失败'));

// 收尾顺序: doLogout() 先清会话, 其后再用结果 toast 覆盖"已退出登录"
check('A13 收尾调用 doLogout() 且在其后覆盖结果 toast',
  /doLogout\(\)\s*;\s*\n\s*showToast\(\s*doneMsg\s*\)/.test(cancelCode));
check('A14 复用 hapticFeedback / saveUsers 保持与 deleteMember 同构',
  cancelCode.includes('hapticFeedback()') && /saveUsers\(\s*USERS\s*\)/.test(cancelCode));

/* ============================================================
 * B. 运行时行为(vm 真机源码沙箱)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

/** 最小 DOM 探针: getElementById 惰性造元素(doLogout 清空 login-phone/login-pass 需要 .value) */
function makeDom() {
  const els = {};
  const mkEl = () => ({ textContent: '', value: '', style: {}, classList: { add() {}, remove() {} } });
  const document = {
    getElementById: id => (els[id] = els[id] || mkEl()),
    createElement: () => mkEl(),
    querySelector: () => null,
    body: { appendChild() {}, removeChild() {} },
  };
  return { els, document };
}

/**
 * 构造 vm 沙箱: 注入真机源码中按名提取的真实实现 + 依赖桩。
 * 关键点:
 *  - State 为 const 对象、USERS 为 let、state 为 let —— 均在 vm 上下文的
 *    全局词法/对象环境里, 通过 this.X 赋值即可被注入的真实函数读到。
 *  - setTimeout 用"立即执行"版, 使 1500ms 重试分支确定性、秒级完成。
 * @param {Object} o - {pushResults?:boolean[], dom?}
 */
function makeSandbox(o) {
  o = o || {};
  const toasts = [];
  const dom = o.dom || makeDom();
  const store = _h.createLocalStorage();
  const seq = (o.pushResults || [true]).slice();
  let pushIdx = 0, pushCalls = 0, saveUsersCalls = 0, hapticCalls = 0;
  let confirmTitle = null, confirmMsg = null, confirmPromise = null;

  const sandbox = {
    console, JSON, Math, Date, Promise, Set, Map, RegExp, Error,
    String, Number, Boolean, Array, Object,
    // 立即执行定时器: 让退避重试分支可控且不拖慢测试
    setTimeout: fn => { fn(); return 0; },
    clearTimeout: () => {},
    localStorage: store,
    document: dom.document,
    navigator: {},
    // UI / 业务桩
    showToast: m => toasts.push(String(m)),
    showConfirm: (title, msg, cb) => {
      confirmTitle = title; confirmMsg = msg;
      confirmPromise = Promise.resolve().then(() => (cb && cb()));
    },
    hapticFeedback: () => { hapticCalls++; },
    saveUsers: () => { saveUsersCalls++; },
    // 无依赖(不注入 05-sync.js): 以 stubs 替代 doLogout 的轮询/导航依赖
    stopPendingPolling: () => {},
    stopMemberGuardPolling: () => {},
    showScreen: () => {},
    navReset: () => {},
    pushApprovedUsersToFeishu: async () => {
      const r = seq[Math.min(pushIdx, seq.length - 1)];
      pushIdx++; pushCalls++;
      return r;
    },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  // 依赖序: State(删除入口) → isLeader(权限判定) → doLogout(收尾) → cancelAccount(被测)
  for (const name of ['State', 'isLeader', 'doLogout', 'cancelAccount']) {
    vm.runInContext(_h.extractNamedBlock(src, name), ctx, { filename: name + '.js' });
  }
  return {
    ctx, dom, toasts, store,
    run: e => vm.runInContext(e, ctx, { filename: 'eval.js' }),
    getConfirm: () => ({ title: confirmTitle, msg: confirmMsg }),
    awaitConfirm: () => confirmPromise,
    stats: () => ({ pushCalls, saveUsersCalls, hapticCalls }),
  };
}

(async () => {
  try {
    /* ---------- B0. 未登录 ---------- */
    console.log('\n-- B0. 未登录 --');
    const sb0 = makeSandbox({});
    sb0.run('this.USERS = []; this.state = { currentUser: null };');
    await sb0.run('cancelAccount()');
    check('B0-1 未登录提示「请先登录」', sb0.toasts.includes('请先登录'), sb0.toasts.join(' | '));
    check('B0-2 未登录不弹二次确认', sb0.getConfirm().title === null);

    /* ---------- B1. 组长拒绝 ---------- */
    console.log('\n-- B1. 组长账号不可自助注销 --');
    const sb1 = makeSandbox({});
    sb1.run(`
      this.USERS = [{ id:'a1', name:'组长甲', phone:'13800000000', role:'admin' }];
      this.state = { currentUser: { id:'a1', name:'组长甲', phone:'13800000000', role:'admin' } };
    `);
    await sb1.run('cancelAccount()');
    check('B1-1 组长注销被拒(提示转让组长身份)',
      sb1.toasts.some(t => t.includes('组长账号不可自助注销')), sb1.toasts.join(' | '));
    check('B1-2 组长账号仍保留(未被删除)', sb1.run('USERS.length') === 1 && sb1.run('USERS[0].phone') === '13800000000');
    check('B1-3 组长注销不弹二次确认', sb1.getConfirm().title === null);

    /* ---------- B2. 组员注销成功(云端首推即成功) ---------- */
    console.log('\n-- B2. 组员注销成功(云端同步成功) ----------');
    const sb2 = makeSandbox({ pushResults: [true] });
    sb2.store.setItem('tcg_session', '{"phone":"13911112222"}');
    sb2.run(`
      this.USERS = [
        { id:'u1', name:'组员乙', phone:'13911112222', role:'user' },
        { id:'u2', name:'组员丙', phone:'13933334444', role:'user' }
      ];
      this.state = { currentUser: { id:'u1', name:'组员乙', phone:'13911112222', role:'user' } };
    `);
    check('B2-0 二次确认前账号未被删除', sb2.run('USERS.length') === 2);
    await sb2.run('cancelAccount()');
    const c2 = sb2.getConfirm();
    check('B2-1 弹出「注销账号」二次确认且含姓名', c2.title === '注销账号' && !!c2.msg && c2.msg.includes('组员乙'));
    await sb2.awaitConfirm();
    const s2 = sb2.stats();
    check('B2-2 本人账号已从 USERS 移除(仅剩 1 人)',
      sb2.run('USERS.length') === 1 && sb2.run('USERS.some(u=>u.phone==="13911112222")') === false);
    check('B2-3 其他组员不受影响', sb2.run('USERS[0].phone') === '13933334444');
    check('B2-4 云端推送被调用 1 次(首推成功, 不重试)', s2.pushCalls === 1, `pushCalls=${s2.pushCalls}`);
    check('B2-5 saveUsers/hapticFeedback 各被调用', s2.saveUsersCalls === 1 && s2.hapticCalls === 1);
    check('B2-6 doLogout 已清会话(state.currentUser=null)', sb2.run('state.currentUser') === null);
    check('B2-7 本地会话键 tcg_session 已清除', sb2.store.getItem('tcg_session') === null);
    check('B2-8 最终 toast 为注销结果(覆盖「已退出登录」)',
      sb2.toasts[sb2.toasts.length - 1] === '账号已注销, 云端已同步', sb2.toasts.join(' | '));
    check('B2-9 提示链顺序正确(同步中 → 已退出登录 → 结果)',
      sb2.toasts[0] === '正在同步注销到飞书云端...' && sb2.toasts.includes('已退出登录'));

    /* ---------- B3. 组员注销成功(首推失败 → 重试成功) ---------- */
    console.log('\n-- B3. 云端首推失败 → 退避重试成功 ----------');
    const sb3 = makeSandbox({ pushResults: [false, true] });
    sb3.run(`
      this.USERS = [{ id:'u3', name:'组员丁', phone:'13700000000', role:'user' }];
      this.state = { currentUser: { id:'u3', name:'组员丁', phone:'13700000000', role:'user' } };
    `);
    await sb3.run('cancelAccount()');
    await sb3.awaitConfirm();
    const s3 = sb3.stats();
    check('B3-1 重试路径: 云端推送被调用 2 次', s3.pushCalls === 2, `pushCalls=${s3.pushCalls}`);
    check('B3-2 重试成功后提示「账号已注销, 云端已同步」',
      sb3.toasts[sb3.toasts.length - 1] === '账号已注销, 云端已同步', sb3.toasts.join(' | '));
    check('B3-3 账号已删除', sb3.run('USERS.length') === 0);

    /* ---------- B4. 组员注销 · 云端两次均失败(本地已删 + 告警) ---------- */
    console.log('\n-- B4. 云端两次均失败(本地已注销 + 失败告警) ----------');
    const sb4 = makeSandbox({ pushResults: [false, false] });
    sb4.run(`
      this.USERS = [{ id:'u4', name:'组员戊', phone:'13600000000', role:'user' }];
      this.state = { currentUser: { id:'u4', name:'组员戊', phone:'13600000000', role:'user' } };
    `);
    await sb4.run('cancelAccount()');
    await sb4.awaitConfirm();
    const last4 = sb4.toasts[sb4.toasts.length - 1];
    check('B4-1 云端两次尝试', sb4.stats().pushCalls === 2, `pushCalls=${sb4.stats().pushCalls}`);
    check('B4-2 本地账号仍被删除(注销语义以本地为准)', sb4.run('USERS.length') === 0);
    check('B4-3 最终 toast 含「云端同步失败」告警', typeof last4 === 'string' && last4.includes('云端同步失败'), String(last4));
    check('B4-4 失败分支仍清会话(不留半登录态)', sb4.run('state.currentUser') === null);

    /* ---------- B5. 记录缺失(本账号不在 USERS) ---------- */
    console.log('\n-- B5. 记录缺失降级 ----------');
    const sb5 = makeSandbox({ pushResults: [true] });
    sb5.run(`
      this.USERS = [{ id:'u9', name:'其他组员', phone:'13500000000', role:'user' }];
      this.state = { currentUser: { id:'uX', name:'幽灵账号', phone:'13988887777', role:'user' } };
    `);
    await sb5.run('cancelAccount()');
    await sb5.awaitConfirm();
    check('B5-1 记录缺失时提示注销失败', sb5.toasts.some(t => t.indexOf('注销失败') >= 0), sb5.toasts.join(' | '));
    check('B5-2 记录缺失时不触发云端推送', sb5.stats().pushCalls === 0);
    check('B5-3 记录缺失时不登出(保留当前会话待重试)',
      sb5.run('state.currentUser && state.currentUser.phone') === '13988887777');
    check('B5-4 无关账号未被误删', sb5.run('USERS.length') === 1);
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
