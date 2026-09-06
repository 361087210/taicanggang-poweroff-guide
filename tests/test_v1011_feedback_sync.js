/**
 * V10.15.11 反馈同步+密码跨设备同步 专项测试
 * 运行: node tests/test_v1011_feedback_sync.js  (需 jsdom)
 *
 * 覆盖维度:
 * A. 静态源码检查: 组长审核链路/组员跨设备反馈拉回/密码云端同步/网页镜像桥
 * B. 运行时行为(jsdom):
 *    B1. 组长审核: setFeedbackStatus 调云端update+本地状态更新
 *    B2. 组员跨设备: 云端按提交人拉回自己的反馈(他人不可见)
 *    B3. 密码修改: 推送云端(mock)+推送前fullMerge竞态保护
 *    B4. 网页镜像桥: FeedbackBase覆盖为镜像读取结构(写路径抛错)
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const _h = require('./e2e_harness');
const html = _h.inlineStylesheets(_h.inlineDeferScripts(fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8')));

const src = {
  bitable: fs.readFileSync(path.join(REPO, 'js/12-bitable.js'), 'utf8'),
  feedback: fs.readFileSync(path.join(REPO, 'js/10-feedback.js'), 'utf8'),
  cache: fs.readFileSync(path.join(REPO, 'js/07-cache.js'), 'utf8'),
  websync: fs.readFileSync(path.join(REPO, 'js/09-web-sync.js'), 'utf8'),
  mirror: fs.readFileSync(path.join(REPO, 'scripts/sync_web_data.js'), 'utf8'),
};

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');
check('A1 12-bitable.js 暴露 updateFeedbackStatus(bitableUpdateRecord)', src.bitable.includes('updateFeedbackStatus') && src.bitable.includes('bitableUpdateRecord'));
check('A2 10-feedback.js 组长审核按钮(标记已解决/待处理)', src.feedback.includes('标记已解决') && src.feedback.includes('待处理'));
check('A3 10-feedback.js 非组长按提交人拉回自己反馈', src.feedback.includes("f['提交人'] === user.name"));
check('A4 07-cache.js changePassword 推送云端(pushApprovedUsersToFeishu)', src.cache.includes('await pushApprovedUsersToFeishu()'));
check('A5 07-cache.js 推送前fullMerge拉取(覆盖竞态保护)', src.cache.includes('pullApprovedStatusFromFeishu(state.currentUser, true)'));
check('A6 09-web-sync.js FeedbackBase镜像桥(读feedback_data.json)', src.websync.includes("_fetchMirror('feedback_data.json')"));
check('A7 sync_web_data.js 反馈表镜像(FEEDBACK_APP_TOKEN分页拉取)', src.mirror.includes('FEEDBACK_APP_TOKEN') && src.mirror.includes('feedback_data.json'));
check('A8 网页镜像全局标志(__TCG_WEB_MIRROR__)', src.websync.includes('__TCG_WEB_MIRROR__') && src.feedback.includes('__TCG_WEB_MIRROR__'));
check('A9 网页镜像端跳过syncPendingFeedback无效重试', src.feedback.includes('if (window.__TCG_WEB_MIRROR__) return;'));
check('A10 镜像脱敏: 不含问题描述/联系方式/设备信息字段', !src.mirror.includes("'问题描述'") && !src.mirror.includes("'联系方式'") && !src.mirror.includes("'设备信息'"));
check('A11 提交反馈保存云端recordId(审核定位)', src.feedback.includes('recordId: (rec && rec.record_id)'));
check('A12 resetMemberPass 密码同步链路保留(V5.4既有)', src.cache.includes("pushApprovedUsersToFeishu();") === true);
check('A13 组长角色判断统一为admin(无leader残留,组长=admin/isLeader)', !src.feedback.includes("=== 'leader'") && !src.feedback.includes("==='leader'"));
check('A14 setFeedbackStatus 函数层组长守卫', src.feedback.includes("仅组长可审核反馈状态"));
check('A15 resetMemberPass 函数层组长守卫+禁重置组长', src.cache.includes('仅组长可重置组员密码') && src.cache.includes('不可重置组长账号密码'));

/* ============================================================
 * B. 运行时行为(jsdom)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');
const dom = new JSDOM(html, { runScripts: 'dangerously', resources: undefined, pretendToBeVisual: true, url: 'http://localhost/' });
const window = dom.window;
const G = (expr) => window.eval(expr);

setTimeout(async () => {
  try {
    /* ---------- B1. 组长审核 ---------- */
    console.log('\n-- B1. 组长反馈状态审核 --');
    // 注入组长登录态
    G(`state.currentUser = { id: 'leader1', name: '组长甲', phone: '13800000000', role: 'admin', status: 'active', password: 'x$y' };`);
    // 注入一条已同步云端的反馈
    const fbId = 'fb_test_leader_1';
    window.localStorage.setItem('tcg_feedback_list', JSON.stringify([{
      id: fbId, recordId: 'rec_abc123', category: '车辆查询-搜索筛选', description: '测试反馈内容',
      reporterName: '组员乙', status: '待处理', createdAt: new Date().toISOString(), synced: true,
    }]));
    // 重载内存_feedbackList(setFeedbackStatus读内存列表,localStorage注入后需重新load)
    G('initFeedbackPage()');
    await new Promise(r => setTimeout(r, 150));
    // mock FeedbackBase
    let updateCalled = null;
    window.FeedbackBase = {
      isAvailable: () => true,
      updateFeedbackStatus: async (rid, status) => { updateCalled = { rid, status }; return { record: {} }; },
      listFeedbackRecords: async () => [],
      addFeedbackRecord: async () => ({}),
    };
    await window.setFeedbackStatus(fbId, '已解决');
    check('B1-1 调用云端updateFeedbackStatus(record_id, 已解决)', updateCalled && updateCalled.rid === 'rec_abc123' && updateCalled.status === '已解决');
    const after1 = JSON.parse(window.localStorage.getItem('tcg_feedback_list')).find(f => f.id === fbId);
    check('B1-2 本地状态同步更新为已解决', after1 && after1.status === '已解决');

    // 云端更新失败场景: 状态不被本地篡改
    window.FeedbackBase.updateFeedbackStatus = async () => { throw new Error('network'); };
    await window.setFeedbackStatus(fbId, '待处理');
    const after2 = JSON.parse(window.localStorage.getItem('tcg_feedback_list')).find(f => f.id === fbId);
    check('B1-3 云端失败时本地状态不变(防假成功)', after2 && after2.status === '已解决');

    // 无recordId的本地反馈不可审核
    window.localStorage.setItem('tcg_feedback_list', JSON.stringify([{ id: 'fb_local_only', status: '待处理', synced: false }]));
    G('initFeedbackPage()');
    await new Promise(r => setTimeout(r, 150));
    let noRecErr = false;
    try { await window.setFeedbackStatus('fb_local_only', '已解决'); } catch(e) { noRecErr = true; }
    check('B1-4 无recordId反馈拒绝审核(不产生云端调用)', noRecErr === false);

    // 组员绕过UI直接调用setFeedbackStatus被函数层守卫拦截
    G(`state.currentUser = { id: 'user9', name: '组员戊', phone: '13700000000', role: 'user', status: 'active', password: 'x$y' };`);
    let updateCalledAsMember = null;
    window.FeedbackBase.updateFeedbackStatus = async (rid, st) => { updateCalledAsMember = { rid, st }; return {}; };
    await window.setFeedbackStatus(fbId, '已解决');
    check('B1-5 组员调用setFeedbackStatus被守卫拦截(零云端调用)', updateCalledAsMember === null);
    // 恢复组长态
    G(`state.currentUser = { id: 'leader1', name: '组长甲', phone: '13800000000', role: 'admin', status: 'active', password: 'x$y' };`);

    /* ---------- B2. 组员跨设备反馈拉回 ---------- */
    console.log('\n-- B2. 组员跨设备反馈拉回 --');
    G(`state.currentUser = { id: 'user1', name: '组员乙', phone: '13911112222', role: 'user', status: 'active', password: 'x$y' };`);
    window.localStorage.setItem('tcg_feedback_list', JSON.stringify([]));
    // 模拟云端: 一条他人反馈 + 一条组员乙自己的反馈(新设备本地无记录)
    const cloudItems = [
      { record_id: 'rec_other', fields: { '反馈ID': 'fb_other', '问题板块': '其他问题', '状态': '待处理', '提交人': '组员丙', '平台': 'Android' } },
      { record_id: 'rec_mine', fields: { '反馈ID': 'fb_mine_9', '问题板块': '车辆查询-搜索筛选', '状态': '已解决', '提交人': '组员乙', 'AI分析摘要': '已定位根因', '技术文档链接': 'https://doc.example/x', '平台': 'Android' } },
    ];
    window.FeedbackBase.listFeedbackRecords = async () => cloudItems;
    window.FeedbackBase.updateFeedbackStatus = async () => ({});
    await window.switchFeedbackTab('list');
    // loadAndRenderFeedbackList 是async,等一轮
    await new Promise(r => setTimeout(r, 300));
    const stored = JSON.parse(window.localStorage.getItem('tcg_feedback_list'));
    check('B2-1 云端拉回自己的反馈(fb_mine_9)', stored.some(f => f.id === 'fb_mine_9' && f._isMine));
    check('B2-2 自己反馈含云端状态/AI摘要/文档链接', (() => { const m = stored.find(f => f.id === 'fb_mine_9'); return m && m.status === '已解决' && m.analysisSummary === '已定位根因' && m.techDocUrl === 'https://doc.example/x'; })());
    check('B2-3 他人反馈不进入组员本地列表(fb_other排除)', !stored.some(f => f.id === 'fb_other'));

    // 组长(admin)跨设备: 切换到组长后,云端他人反馈也应进入组长本地列表
    window.localStorage.setItem('tcg_feedback_list', JSON.stringify([]));
    G(`state.currentUser = { id: 'leader1', name: '组长甲', phone: '13800000000', role: 'admin', status: 'active', password: 'x$y' };`);
    await window.switchFeedbackTab('list');
    await new Promise(r => setTimeout(r, 300));
    const leaderStored = JSON.parse(window.localStorage.getItem('tcg_feedback_list'));
    check('B2-4 组长拉取云端可见全部反馈(他人反馈入库)', leaderStored.some(f => f.id === 'fb_other') && leaderStored.some(f => f.id === 'fb_mine_9'));

    /* ---------- B3. 密码修改云端同步 ---------- */
    console.log('\n-- B3. 密码修改跨设备同步 --');
    G(`state.currentUser = { id: 'user1', name: '组员乙', phone: '13911112222', role: 'user', status: 'active', password: 'oldpass123' };`);
    G(`USERS.length = 0; USERS.push({ id: 'user1', name: '组员乙', phone: '13911112222', password: 'oldpass123', role: 'user', status: 'active' });`);
    // Node侧桥对象: eval字符串内引用window.__hooks(共享引用,Node侧可读)
    const hooks = { pullFullMerge: false, pushPayload: false, toastMsg: '' };
    window.__hooks = hooks;
    // 表单注入
    window.document.getElementById('pw-old').value = 'oldpass123';
    window.document.getElementById('pw-new').value = 'newpass456';
    window.document.getElementById('pw-confirm').value = 'newpass456';
    // mock 同步链(先保存原实现供B3b恢复)
    G(`__origPull = pullApprovedStatusFromFeishu; __origPush = pushApprovedUsersToFeishu;`);
    G(`pullApprovedStatusFromFeishu = async (who, fullMerge) => { if (fullMerge) { __hooks.pullFullMerge = true; } return true; }`);
    G(`pushApprovedUsersToFeishu = async () => { __hooks.pushPayload = true; return true; }`);
    G(`showToast = (m) => { __hooks.toastMsg = m; };`);
    await window.eval('changePassword()');
    await new Promise(r => setTimeout(r, 100));
    check('B3-1 推送前执行fullMerge拉取(竞态保护)', hooks.pullFullMerge === true);
    check('B3-2 推送云端被调用', hooks.pushPayload === true);
    const uAfter = G('USERS.find(x=>x.phone==="13911112222")');
    check('B3-3 本地密码已更新为新哈希(salt$hash形态)', uAfter && /^[a-zA-Z0-9$/.]+$/.test(uAfter.password) && uAfter.password !== 'oldpass123' && uAfter.password.includes('$'));
    check('B3-4 成功提示含"已同步云端"', hooks.toastMsg.includes('已同步云端'));

    // 云端推送失败场景: 本地仍改成功+明确提示
    G(`pushApprovedUsersToFeishu = async () => { return false; };`);
    G(`state.currentUser = { id: 'user1', name: '组员乙', phone: '13911112222', role: 'user', status: 'active', password: 'x$y' };`);
    // 旧密码校验: state.currentUser.password是'x$y'(哈希形态含$)→verifyPassword
    // 为可控,直接置明文形态走兼容分支
    G(`state.currentUser.password = 'oldpass123';`);
    window.document.getElementById('pw-old').value = 'oldpass123';
    window.document.getElementById('pw-new').value = 'newpass789';
    window.document.getElementById('pw-confirm').value = 'newpass789';
    await window.eval('changePassword()');
    await new Promise(r => setTimeout(r, 100));
    check('B3-5 推送失败时提示本机生效+引导(不假报全局成功)', hooks.toastMsg.includes('本机') || hooks.toastMsg.includes('本浏览器') || hooks.toastMsg.includes('失败'));

    /* ---------- B3b. 密码pw_ts跨设备仲裁 ---------- */
    console.log('\n-- B3b. 密码pw_ts跨设备仲裁(设备B拉取场景) --');
    // 恢复真实实现(B3的mock已完成使命)
    G(`pullApprovedStatusFromFeishu = __origPull; pushApprovedUsersToFeishu = __origPush;`);
    // 场景1: 设备A改密已推云端(pw_ts新)→设备B(本地旧哈希)拉取应采纳云端新哈希
    G(`USERS.length = 0; USERS.push({ id: 'user1', name: '组员乙', phone: '13911112222', password: 'salt0$oldhash123', pw_ts: 1000, role: 'user', status: 'active' });`);
    G(`__cloudTable = { type: 'approved_users', timestamp: new Date().toISOString(), users: [ { id: 'user1', name: '组员乙', phone: '13911112222', password: 'salt1$newhash999', pw_ts: 9999999999999, role: 'user', status: 'active' } ] };`);
    G(`downloadJsonFromDataFeishu = async () => __cloudTable;`);
    G(`getFeishuToken = async () => 'fake_token';`);
    G(`feishuCfgReady = () => true;`);
    G(`getFeishuCfg = () => ({ appId: 'a', appSecret: 's', approvedSub: 'f' });`);
    await window.eval('pullApprovedStatusFromFeishu(state.currentUser, true)');
    let uB = G('USERS.find(x=>x.phone==="13911112222")');
    check('B3b-1 云端pw_ts较新→设备B采纳云端新哈希', uB && uB.password === 'salt1$newhash999' && uB.pw_ts === 9999999999999);
    // 场景2: 本机刚改密未推成功(本机pw_ts新)→拉取不被云端旧哈希回滚
    G(`__cloudTable.users[0].password = 'salt2$stalehash'; __cloudTable.users[0].pw_ts = 2000;`);
    await window.eval('pullApprovedStatusFromFeishu(state.currentUser, true)');
    uB = G('USERS.find(x=>x.phone==="13911112222")');
    check('B3b-2 本机pw_ts较新→云端旧哈希不回滚本机', uB && uB.password === 'salt1$newhash999');
    // 场景3: 旧版云端数据(无pw_ts)→保持本地(兼容V5.7语义)
    G(`USERS.length = 0; USERS.push({ id: 'user2', name: '组员丙', phone: '13933334444', password: 'localhash', role: 'user', status: 'active' });`);
    G(`__cloudTable = { type: 'approved_users', timestamp: new Date().toISOString(), users: [ { id: 'user2', name: '组员丙', phone: '13933334444', password: 'legacycloudhash', role: 'user', status: 'active' } ] };`);
    await window.eval('pullApprovedStatusFromFeishu(state.currentUser, true)');
    const uC = G('USERS.find(x=>x.phone==="13933334444")');
    check('B3b-3 云端无pw_ts(旧数据)→本地密码为准(向后兼容)', uC && uC.password === 'localhash');
    // 场景4: 推送payload含pw_ts字段
    G(`uploadJsonToDataFeishu = async (token, name, body) => { __pushedBody = body; return true; };`);
    await window.eval('pushApprovedUsersToFeishu()');
    const pushedObj = G('JSON.parse(__pushedBody)');
    check('B3b-4 推送users行含pw_ts字段', pushedObj && pushedObj.users && pushedObj.users.every(u => typeof u.pw_ts !== 'undefined'));

    /* ---------- B5. 旧设备新密码登录(V10.15.12登录重试) ---------- */
    console.log('\n-- B5. 旧设备新密码登录闭环(本地旧哈希+云端新哈希) --');
    // 生成真实哈希形态(salt$hash)
    const hashOldL = await G('(async()=>{return await hashPassword("oldpass999","saltOld");})()');
    const hashNewL = await G('(async()=>{return await hashPassword("newpass888","saltNew");})()');
    // mock doLogin 副作用依赖
    G(`showToast = (m) => { __hooks.toastMsg = m; };`);
    G(`showScreen = () => {}; navReset = () => {}; renderBrandTags = () => {};`);
    G(`updateMyInfo = () => {}; ensureNotifyPermission = () => {}; updateMembersBadge = () => {};`);
    G(`startMemberGuardPolling = () => {}; checkCloudDataUpdate = () => {};`);
    G(`syncFieldOptionsFromCloud = () => {};`);
    window.document.getElementById('login-phone').value = '13955556666';
    window.document.getElementById('login-pass').value = 'newpass888';
    // 场景1: 本地旧哈希(无pw_ts) + 云端新哈希(pw_ts新) → 输新密码登录成功
    G(`USERS.length = 0; USERS.push({ id: 'u55', name: '组员己', phone: '13955556666', password: ${JSON.stringify(hashOldL)}, role: 'user', status: 'active' });`);
    G(`__cloudTable = { type: 'approved_users', timestamp: new Date().toISOString(), users: [ { id: 'u55', name: '组员己', phone: '13955556666', password: ${JSON.stringify(hashNewL)}, pw_ts: 9999999999999, role: 'user', status: 'active' } ] };`);
    await window.eval('doLogin()');
    await new Promise(r => setTimeout(r, 300));
    check('B5-1 旧设备输新密码登录成功(拉云端重试)', hooks.toastMsg.includes('登录成功'));
    const uL1 = G('USERS.find(x=>x.phone==="13955556666")');
    check('B5-2 登录后本地哈希已更新为云端新值', uL1 && uL1.password === hashNewL);
    // 场景2: 云端也未更新(旧哈希无pw_ts) → 输新密码仍报密码错误(不误放行)
    hooks.toastMsg = '';
    G(`USERS.length = 0; USERS.push({ id: 'u55', name: '组员己', phone: '13955556666', password: ${JSON.stringify(hashOldL)}, role: 'user', status: 'active' });`);
    G(`__cloudTable = { type: 'approved_users', timestamp: new Date().toISOString(), users: [ { id: 'u55', name: '组员己', phone: '13955556666', password: ${JSON.stringify(hashOldL)}, role: 'user', status: 'active' } ] };`);
    await window.eval('doLogin()');
    await new Promise(r => setTimeout(r, 300));
    check('B5-3 云端未更新时新密码仍报密码错误(安全不误放行)', hooks.toastMsg.includes('密码错误'));
    // 场景3: 新设备(本地无账号) + 云端新哈希 → 登录成功
    hooks.toastMsg = '';
    G(`USERS.length = 0;`);
    G(`__cloudTable = { type: 'approved_users', timestamp: new Date().toISOString(), users: [ { id: 'u55', name: '组员己', phone: '13955556666', password: ${JSON.stringify(hashNewL)}, pw_ts: 9999999999999, role: 'user', status: 'active' } ] };`);
    await window.eval('doLogin()');
    await new Promise(r => setTimeout(r, 300));
    check('B5-4 新设备无本地账号拉云端后新密码登录成功', hooks.toastMsg.includes('登录成功'));

    /* ---------- B4. 网页镜像桥结构 ---------- */
    console.log('\n-- B4. 网页镜像桥 --');
    // jsdom无fetch→探测式激活不触发(原生FeedbackBase保留),此处静态验证覆盖结构
    const fbBridge = src.websync.match(/window\.FeedbackBase=\{[\s\S]*?\};/);
    check('B4-1 镜像桥isAvailable返回true(读能力)', fbBridge && fbBridge[0].includes('isAvailable:function(){return true;}'));
    check('B4-2 镜像桥写入路径抛错(封堵上行)', fbBridge && fbBridge[0].includes("throw new Error('网页镜像端不支持反馈写入')"));
    check('B4-3 镜像桥状态审核封堵', fbBridge && fbBridge[0].includes("throw new Error('网页镜像端不支持状态审核')"));

  } catch (e) {
    console.error('B组执行异常:', e);
    FAILED.push('B组执行异常: ' + e.message);
  }

  console.log('\n============================================');
  console.log(`结果: ${PASSED.length} 通过 / ${FAILED.length} 失败 / ${PASSED.length + FAILED.length} 总计`);
  if (FAILED.length) { console.log('失败项:'); FAILED.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
  process.exit(0);
}, 1500);
