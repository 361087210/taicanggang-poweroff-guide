/**
 * V10.20.0 组长重置组员密码 · 安全加固回归测试
 * 运行: node tests/test_v1035_reset_member_pass.js  (需 jsdom)
 *
 * 背景(需求来源):
 *   旧实现 resetMemberPass 把组员密码**写死重置为 '123456'**(全组同口令),
 *   且 toast 直接回显明文口令 —— 任何人凭默认口令即可冒充组员登录,
 *   是权限体系里最脆弱的一环。本次加固:
 *     1) 12 位高熵随机一次性口令(去歧义字符集)  —— 需 CSPRNG + 拒绝采样
 *     2) 口令仅经弹窗展示一次, 不落 toast / 日志
 *     3) linkKey 用**同一新口令**重算(否则组员网页端登录失败)
 *     4) 保留既有的函数层组长守卫 + 禁重置组长账号(安全边界不可回退)
 *
 * 覆盖维度:
 *   A. 静态源码检查: 原语/字符集/调用点/钉死字面串/DOM 弹层
 *   B. 运行时行为(vm 真机源码沙箱): 随机性/降级/重置链路/守卫/口令展示
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = '.';
const _h = require('./e2e_harness');
const src = _h.loadCombinedSource();

const SRC_BOOT = fs.readFileSync(path.join(REPO, 'js/00-bootstrap.js'), 'utf8');
const SRC_CACHE = fs.readFileSync(path.join(REPO, 'js/07-cache.js'), 'utf8');
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

check('A1 00-bootstrap.js 定义 generateRandomPassword', /function\s+generateRandomPassword\s*\(/.test(SRC_BOOT));

// 字符集: 取实现内的字面量, 断言不含易混淆字符 0 O o 1 l I i
const charsetMatch = /const\s+CHARSET\s*=\s*'([^']+)'/.exec(SRC_BOOT);
const CHARSET = charsetMatch ? charsetMatch[1] : '';
check('A2 口令字符集不含易混淆字符(0/O/o/1/l/I/i)', CHARSET.length > 0 && !/[0Oo1lIi]/.test(CHARSET), `charset=${CHARSET}`);

check('A3 随机源为 CSPRNG(crypto.getRandomValues)', /crypto\.getRandomValues\s*\(/.test(SRC_BOOT));
check('A4 拒绝采样消除取模偏差(LIMIT=floor(256/N)*N)', /Math\.floor\(\s*256\s*\/\s*N\s*\)\s*\*\s*N/.test(SRC_BOOT));
check('A5 CSPRNG 不可用时降级 Math.random(仍远优于固定口令)', /Math\.random\s*\(\s*\)\s*\*\s*256/.test(SRC_BOOT));

// 只审 resetMemberPass 的**代码**(剔除注释, 注释里会提到历史缺陷 '123456')
const resetBlock = _h.extractNamedBlock(src, 'resetMemberPass');
const resetCode = resetBlock.replace(/\/\/[^\n]*/g, '');
check('A6 resetMemberPass 代码中不再写死固定口令 123456', resetCode.length > 0 && !/123456/.test(resetCode));
check('A7 resetMemberPass 改用 generateRandomPassword(12)', /const\s+newPass\s*=\s*generateRandomPassword\(12\)/.test(SRC_CACHE));
check('A8 toast 不回显口令明文(无 "密码为"/口令插值)', !/showToast\(\s*`[^`]*\$\{newPass\}/.test(SRC_CACHE) && !SRC_CACHE.includes('密码为'));
check('A9 linkKey 用同一新口令重算(deriveLinkKey(u.phone,newPass))', /deriveLinkKey\(u\.phone,\s*newPass\)/.test(SRC_CACHE));

// 安全边界回归: 三个被既有测试钉死(V10.15.11 / V5.4)的字面串必须原样保留
check('A10 保留函数层组长守卫字面串(仅组长可重置组员密码)', SRC_CACHE.includes('仅组长可重置组员密码'));
check('A11 保留禁重置组长账号字面串(不可重置组长账号密码)', SRC_CACHE.includes('不可重置组长账号密码'));
check('A12 保留云端推送链路 pushApprovedUsersToFeishu();', SRC_CACHE.includes('pushApprovedUsersToFeishu();'));

check('A13 新增一次性口令弹层 modal-reset-pass', SRC_HTML.includes('id="modal-reset-pass"'));
check('A14 弹层含口令展示位与提示位', SRC_HTML.includes('id="reset-pass-value"') && SRC_HTML.includes('id="reset-pass-tip"'));
check('A15 弹层按钮接线 copyResetPassword/closeResetPasswordModal',
  SRC_HTML.includes('copyResetPassword()') && SRC_HTML.includes('closeResetPasswordModal()'));
check('A16 展示/关闭函数对缺失元素静默降级(if(val) 守卫, 兼容真机旧页/沙箱)',
  /function\s+showResetPasswordModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*val\s*\)/.test(SRC_CACHE) &&
  /function\s+closeResetPasswordModal\s*\([^)]*\)\s*\{[\s\S]*?if\s*\(\s*val\s*\)/.test(SRC_CACHE));

/* ============================================================
 * B. 运行时行为(vm 真机源码沙箱)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

/** 造一个最小 DOM 探针: 记录弹窗文本 + openModal/closeModal 调用 */
function makeDom() {
  const els = {};
  const calls = { opened: [], closed: [] };
  const mkEl = () => ({ textContent: '', value: '', style: {}, select() {}, appendChild() {}, removeChild() {} });
  const document = {
    getElementById: id => (els[id] = els[id] || mkEl()),
    createElement: () => mkEl(),
    body: { appendChild() {}, removeChild() {} },
    execCommand: () => true,
  };
  return { els, calls, document };
}

/**
 * 构造 vm 沙箱, 注入真机源码中按名提取的真实实现 + 依赖桩
 * @param {Object} o - {cryptoObj, dom, toasts, users, currentUser}
 */
function makeSandbox(o) {
  o = o || {};
  const toasts = o.toasts || [];
  const dom = o.dom || makeDom();
  const store = _h.createLocalStorage();
  const sandbox = {
    console, JSON, Math, Date, Promise, Set, Map, RegExp, Error,
    String, Number, Boolean, Array, Object, Uint8Array, ArrayBuffer,
    TextEncoder, TextDecoder, setTimeout, clearTimeout,
    localStorage: store,
    document: dom.document,
    navigator: {},
    crypto: o.cryptoObj === undefined ? require('crypto').webcrypto : o.cryptoObj,
    // UI / 业务桩
    showToast: m => toasts.push(String(m)),
    openModal: id => dom.calls.opened.push(id),
    closeModal: id => dom.calls.closed.push(id),
    saveUsers: () => {},
    pullApprovedStatusFromFeishu: async () => {},
    pushApprovedUsersToFeishu: () => {},
    isLeader: () => !!o.isLeader,
  };
  sandbox.window = sandbox;
  sandbox.TCG_CONFIG = { LINK_SALT: 'tcg-link-2026' };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  // 原语链(依赖序): SHA256 兜底 → PBKDF2 → 哈希/盐/随机口令/校验 → linkKey
  const blocks = [
    '_digestSha256Hex', '_pbkdf2Hex', 'hashPassword', 'genSalt',
    'generateRandomPassword', 'verifyPassword', 'deriveLinkKey',
    'resetMemberPass', 'showResetPasswordModal', 'copyResetPassword', '_fallbackCopy', 'closeResetPasswordModal',
  ];
  for (const name of blocks) {
    vm.runInContext(_h.extractNamedBlock(src, name), ctx, { filename: name + '.js' });
  }
  return { ctx, dom, toasts, store, run: e => vm.runInContext(e, ctx, { filename: 'eval.js' }) };
}

const CHARSET_RE = new RegExp('^[' + CHARSET + ']+$');

/* ---------- B1. 随机口令原语 ---------- */
console.log('\n-- B1. generateRandomPassword --');
const sb = makeSandbox({});
const p1 = sb.run('generateRandomPassword(12)');
const p2 = sb.run('generateRandomPassword(12)');
const pDef = sb.run('generateRandomPassword()');
check('B1-1 长度为 12', p1.length === 12 && p2.length === 12, `len=${p1.length}`);
check('B1-2 仅由去歧义字符集组成', CHARSET_RE.test(p1) && CHARSET_RE.test(p2), p1);
check('B1-3 两次生成不同(高熵, 非固定口令)', p1 !== p2, `${p1} / ${p2}`);
check('B1-4 默认长度(无参)为 12', pDef.length === 12, `len=${pDef.length}`);
// 无 crypto 环境(降级 Math.random 分支)仍须产出合法口令
const sbNoCrypto = makeSandbox({ cryptoObj: undefined });
sbNoCrypto.run('delete this.crypto;');
const pFb = sbNoCrypto.run('generateRandomPassword(12)');
check('B1-5 CSPRNG 缺失时降级仍产出合法 12 位口令', pFb.length === 12 && CHARSET_RE.test(pFb), pFb);

/* ---------- B2. 重置链路(组长重置组员) ---------- */
(async () => {
  try {
    console.log('\n-- B2. resetMemberPass 重置链路 --');
    const toasts = [];
    const sb2 = makeSandbox({ toasts, isLeader: true });
    sb2.run(`
      this.USERS = [{ id:'u1', name:'组员乙', phone:'13911112222', role:'user', password:'oldhash', pw_ts:1, linkKey:'oldkey' }];
      this.state = { currentUser: { id:'leader1', name:'组长甲', phone:'13800000000', role:'admin' } };
    `);
    await sb2.run('resetMemberPass("u1")');

    const u = sb2.run('USERS.find(x=>x.id==="u1")');
    const shown = sb2.dom.els['reset-pass-value'] ? sb2.dom.els['reset-pass-value'].textContent : '';
    check('B2-1 密码字段被更新且不再是原值', u.password !== 'oldhash' && !!u.password, String(u.password).slice(0, 24));
    check('B2-2 展示的口令为合法 12 位去歧义字符', shown.length === 12 && CHARSET_RE.test(shown), shown);
    check('B2-3 存储的是新口令的哈希(非明文)', !String(u.password).includes(shown) && /^(pbkdf2\$|[0-9a-f]{16}\$)/.test(String(u.password)));
    check('B2-4 pw_ts 被更新(供组员端拉取仲裁)', u.pw_ts > 1);
    check('B2-5 linkKey 与新口令一致(网页端可登录)',
      typeof u.linkKey === 'string' && u.linkKey.length === 64 && u.linkKey !== 'oldkey');
    const verified = await sb2.run('verifyPassword(' + JSON.stringify(shown) + ', USERS.find(x=>x.id==="u1").password)');
    check('B2-6 verifyPassword(展示口令) 校验通过', verified === true);
    const lkOk = await sb2.run('deriveLinkKey("13911112222",' + JSON.stringify(shown) + ').then(k=>k===USERS.find(x=>x.id==="u1").linkKey)');
    check('B2-7 linkKey 确由展示口令派生(端到端一致)', lkOk === true);
    check('B2-8 toast 已发出且不含口令明文',
      toasts.some(t => t.indexOf('组员乙') >= 0) && !toasts.some(t => shown && t.indexOf(shown) >= 0), toasts.join(' | '));
    check('B2-9 弹层已打开(modal-reset-pass)', sb2.dom.calls.opened.includes('modal-reset-pass'));

    // 关闭即清空(强化"仅显示一次"语义)
    sb2.run('closeResetPasswordModal()');
    const after = sb2.dom.els['reset-pass-value'].textContent;
    check('B2-10 关闭后口令被清空为 "-"', after === '-' && sb2.dom.calls.closed.includes('modal-reset-pass'), after);

    /* ---------- B3. 安全边界(不可回退) ---------- */
    console.log('\n-- B3. 安全边界 --');
    // 组员绕过 UI 直接调用 → 函数层守卫拦截, 密码不变
    const t3 = [];
    const sb3 = makeSandbox({ toasts: t3, isLeader: false });
    sb3.run(`
      this.USERS = [{ id:'u2', name:'组员丙', phone:'13700000000', role:'user', password:'keep', pw_ts:5 }];
      this.state = { currentUser: { id:'u2', name:'组员丙', phone:'13700000000', role:'user' } };
    `);
    await sb3.run('resetMemberPass("u2")');
    check('B3-1 非组长调用被拦截(密码不被篡改)',
      sb3.run('USERS.find(x=>x.id==="u2").password') === 'keep' && t3.includes('仅组长可重置组员密码'));
    // 组长账号自身 → 拒绝重置
    const t4 = [];
    const sb4 = makeSandbox({ toasts: t4, isLeader: true });
    sb4.run(`
      this.USERS = [{ id:'a1', name:'组长甲', phone:'13800000000', role:'admin', password:'adminkeep', pw_ts:9 }];
      this.state = { currentUser: { id:'a1', name:'组长甲', phone:'13800000000', role:'admin' } };
    `);
    await sb4.run('resetMemberPass("a1")');
    check('B3-2 拒绝重置组长账号(密码不被篡改)',
      sb4.run('USERS.find(x=>x.id==="a1").password') === 'adminkeep' && t4.includes('不可重置组长账号密码'));
    check('B3-3 拒绝时口令弹层不被打开', sb4.dom.calls.opened.length === 0);
  } catch (e) {
    check('B2/B3 运行时异常(整体)', false, e && e.stack ? e.stack.split('\n')[0] : String(e));
  }

  /* ---------- 汇总 ---------- */
  console.log('\n============================================');
  console.log(`PASSED: ${PASSED.length}  FAILED: ${FAILED.length}`);
  if (FAILED.length) { console.log('失败项:\n - ' + FAILED.join('\n - ')); process.exit(1); }
  console.log('全部通过 ✅');
  process.exit(0);
})();
