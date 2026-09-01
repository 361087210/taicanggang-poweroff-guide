/**
 * V5.7 第三轮: 双设备跨网络注册审批链路 (issue 5 真机模拟)
 * 手机A(组员,网络1) 注册 → 飞书云端 → 手机B(组长,网络2) 收到申请 → 审批 → 云端同步
 * 两台"设备"各自独立 localStorage 会话, fetch 透传真实网络(Node22原生fetch)
 */
const fs = require('fs');
const { JSDOM } = require('jsdom');

const REPO = '.';
const _h = require('./e2e_harness'); // A2拆分兼容: js/*.js defer 内联回原时序 + css/app.css 内联回原文
const html = _h.inlineStylesheets(_h.inlineDeferScripts(fs.readFileSync(`${REPO}/demo.html`, 'utf8')));
const PASSED = [], FAILED = [];
const check = (n, c, d='') => { (c?PASSED:FAILED).push(n); console.log(`  [${c?'PASS':'FAIL'}] ${n}${d?' | '+d:''}`); };

function makePhone(name) {
  const store = {};
  const dom = new JSDOM(html, {
    runScripts: 'dangerously', url: 'https://app.local/', pretendToBeVisual: true,
    beforeParse(w) {
      const { webcrypto } = require('crypto');
      try { Object.defineProperty(w, 'crypto', { value: webcrypto, configurable: true, writable: true }); } catch(_){}
      Object.defineProperty(w, 'localStorage', { configurable: true,
        getItem: k => (k in store ? store[k] : null),
        setItem: (k,v) => { store[k]=String(v); },
        removeItem: k => { delete store[k]; }, clear: () => {} });
      // fetch 透传真实网络 —— 本轮就是测真实云端
      // jsdom的FormData/Blob与Node undici不兼容, 需转换为原生类型(等价于真机WebView行为)
      w.fetch = async (url, opts={}) => {
        let body = opts.body;
        if (body && typeof body.entries === 'function' && typeof FormData !== 'undefined' && !(body instanceof FormData)) {
          const fd = new FormData();
          for (const [k, v] of body.entries()) {
            if (v && typeof v.arrayBuffer === 'function') {
              const buf = Buffer.from(await v.arrayBuffer());
              fd.append(k, new Blob([buf], { type: v.type || 'application/octet-stream' }), v.name || k);
            } else fd.append(k, v);
          }
          body = fd;
        }
        return fetch(url, { ...opts, body });
      };
      w.__name = name;
    },
  });
  return { dom, w: dom.window, store, name };
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  console.log('='.repeat(62));
  console.log('真机模拟: 两台手机 + 真实飞书云端');
  console.log('='.repeat(62));

  // ---------- 手机B: 组长先登录(激活轮询前提) ----------
  const leader = makePhone('组长手机B');
  await sleep(600);
  check('0.1 组长手机页面加载完成', typeof leader.w.eval('goBack') === 'function');

  // 组长侧先拉取一次(建立文件夹缓存)
  try { await leader.w.eval(`(async()=>{ try{ await pullPendingFromFeishu(false);}catch(e){} return 'done' })()`); } catch(_){}
  // 组长账号: APP出厂自带admin(LEADER_PHONE), 校验其存在即可(无需注入)
  // 注: jsdom原生localStorage优先, 必须经页面自身读取
  const leaderUsersRaw = leader.w.eval("localStorage.getItem('tcg_users')") || '[]';
  const leaderUsers = JSON.parse(leaderUsersRaw);
  const leaderAcct = leaderUsers.find(u=>u.role==='admin'&&u.status==='active');
  check('0.2 组长账号就绪(出厂admin/active)', !!leaderAcct, leaderAcct ? leaderAcct.phone : 'missing');

  // ---------- 手机A: 组员注册(跨网络场景) ----------
  console.log();
  console.log('--- 手机A(组员): 提交注册申请 ---');
  const member = makePhone('组员手机A');
  await sleep(600);
  const memberPhone = '1390000' + String(Date.now()).slice(-4);
  const regResult = await member.w.eval(`(async function(){
    try{
      // 模拟注册表单提交路径: registerUser 核心逻辑(带哈希)
      const users = JSON.parse(localStorage.getItem('tcg_users')||'[]');
      const pwd = await hashPassword('Test@12345');
      const u = {id:'m'+Date.now(), name:'跨网络组员', phone:'${memberPhone}', password:pwd, role:'member', status:'pending', created:new Date().toISOString()};
      users.push(u); localStorage.setItem('tcg_users', JSON.stringify(users));
      await syncPendingToFeishu(u);
      return {ok:true, status:u.status};
    }catch(e){ return {ok:false, err:e.message}; }
  })()`);
  check('1.1 组员注册(本地持久化pending)', regResult && regResult.ok === true, JSON.stringify(regResult));
  await sleep(800);

  // ---------- 云端验证: 申请文件真实存在 ----------
  console.log();
  console.log('--- 云端(飞书): 申请文件落盘验证 ---');
  // V5.7.1 安全规范: Secret 不落库, 从环境变量读取 (见 tests/README.md)
  const APP_SECRET = process.env.TCG_FEISHU_APP_SECRET || '';
  if (!APP_SECRET) {
    console.error('[环境缺失] 请先设置环境变量 TCG_FEISHU_APP_SECRET (飞书应用Secret):');
    console.error('  export TCG_FEISHU_APP_SECRET=<你的Secret>');
    process.exit(1);
  }
  const cfg = { app_id: 'cli_aa0ce4fd91f85be8', app_secret: APP_SECRET };
  const tokRes = await (await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify(cfg) })).json();
  const token = tokRes.tenant_access_token;
  check('2.1 云端token获取', !!token);

  // 定位注册申请子文件夹
  const rootLs = await (await fetch('https://open.feishu.cn/open-apis/drive/v1/files?folder_token=nodcnGA95g93RhIUSdCeTkhKlQc&page_size=200', {headers:{Authorization:`Bearer ${token}`}})).json();
  const dataRoot = (rootLs.data.files||[]).find(f=>f.name==='APP数据备份');
  const dataLs = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${dataRoot.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
  const regFolder = (dataLs.data.files||[]).find(f=>f.name==='注册申请');
  check('2.2 云端注册申请文件夹存在', !!regFolder);
  const regLs = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${regFolder.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
  const cloudFile = (regLs.data.files||[]).find(f=>f.name===`pending_reg_${memberPhone}.json`);
  check('2.3 组员申请已真实上传云端(跨网络)', !!cloudFile, cloudFile ? cloudFile.name : 'not found');

  // ---------- 手机B: 组长拉取(模拟切回APP或轮询到达) ----------
  console.log();
  console.log('--- 手机B(组长): 拉取云端申请 ---');
  const pulled = await leader.w.eval(`(async()=>{ try{ return await pullPendingFromFeishu(false); }catch(e){ return 'ERR:'+e.message; } })()`);
  check('3.1 组长拉取到新申请(数量)', pulled === 1, `pulled=${pulled}`);
  const leaderUsersAfter = JSON.parse(leader.w.eval("localStorage.getItem('tcg_users')") || '[]');
  const found = leaderUsersAfter.find(u=>u.phone===memberPhone);
  check('3.2 组长用户表出现该组员(pending)', !!found && found.status === 'pending');
  check('3.3 组员密码哈希已随申请同步(无明文)', !!found && /\$/.test(found.password) && found.password !== 'Test@12345');

  // ---------- 组长审批 → 云端同步审批结果 ----------
  console.log();
  console.log('--- 手机B(组长): 审批通过并同步云端 ---');
  const approveRes = await leader.w.eval(`(async()=>{
    try{
      const u = USERS.find(x=>x.phone==='${memberPhone}');
      if(!u) return {ok:false, err:'user not found locally'};
      u.status='active';
      saveUsers(USERS);
      const ok = await pushApprovedUsersToFeishu();
      return {ok:ok===true};
    }catch(e){ return {ok:false, err:e.message}; }
  })()`);
  check('4.1 组长审批+审批结果同步云端(pushApprovedUsersToFeishu)', approveRes && approveRes.ok === true, JSON.stringify(approveRes));
  await sleep(800);

  // 云端审批结果文件验证 (V5.7信封格式 {type:'approved_users',users:[...]})
  const appLs = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${dataRoot.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
  const approvedFolder = (appLs.data.files||[]).find(f=>f.name==='审批结果');
  let cloudApprovedOk = false, approvedRaw = null;
  if (approvedFolder) {
    const filesLs = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${approvedFolder.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
    const af = (filesLs.data.files||[]).find(f=>f.name==='approved_users.json');
    if (af) {
      approvedRaw = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${af.token}/download`, {headers:{Authorization:`Bearer ${token}`}})).json();
      const userList = Array.isArray(approvedRaw) ? approvedRaw : (approvedRaw.users || []);
      const cu = userList.find(u=>u.phone===memberPhone);
      cloudApprovedOk = !!cu && cu.status === 'active';
    }
  }
  check('4.2 云端审批结果文件含该组员(active)', cloudApprovedOk);

  // ---------- 手机C: 组员换新设备登录, 自动发现云端账号 ----------
  console.log();
  console.log('--- 手机C(组员新设备): 登录时自动发现云端账号 ---');
  const memberNew = makePhone('组员新手机C');
  await sleep(600);
  const loginRes = await memberNew.w.eval(`(async()=>{
    try{
      // doLogin 核心路径: 本地无账号 → 云端拉取 → 找到
      let users = JSON.parse(localStorage.getItem('tcg_users')||'[]');
      let user = users.find(u=>u.phone==='${memberPhone}');
      if(!user){
        await pullApprovedStatusFromFeishu({phone:'${memberPhone}'}, true);
        users = JSON.parse(localStorage.getItem('tcg_users')||'[]');
        user = users.find(u=>u.phone==='${memberPhone}');
      }
      return user ? {ok:true, status:user.status} : {ok:false};
    }catch(e){ return {ok:false, err:e.message}; }
  })()`);
  check('5.1 新设备登录自动发现云端账号', loginRes && loginRes.ok === true, JSON.stringify(loginRes));
  check('5.2 新设备同步到active状态(审批已通过)', loginRes && loginRes.status === 'active');

  // ---------- 清理云端测试数据 ----------
  console.log();
  console.log('--- 清理云端测试痕迹 ---');
  const regLs2 = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${regFolder.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
  let cleaned = 0;
  for (const f of (regLs2.data.files||[])) {
    if (f.name === `pending_reg_${memberPhone}.json`) {
      const r = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`, {method:'DELETE', headers:{Authorization:`Bearer ${token}`}});
      if (r.status === 200) cleaned++;
    }
  }
  check('6.1 云端测试申请文件清理', cleaned >= 1, `${cleaned} deleted`);
  // approved_users.json 恢复(移除测试成员)
  if (approvedFolder) {
    const filesLs2 = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${approvedFolder.token}&page_size=200`, {headers:{Authorization:`Bearer ${token}`}})).json();
    const af = (filesLs2.data.files||[]).find(f=>f.name==='approved_users.json');
    if (af && approvedRaw && !Array.isArray(approvedRaw) && Array.isArray(approvedRaw.users)) {
      const cleanedUsers = approvedRaw.users.filter(u=>u.phone!==memberPhone);
      const envelope = {type:approvedRaw.type||'approved_users', version:approvedRaw.version||'v5.7.0', timestamp:new Date().toISOString(), users:cleanedUsers};
      const body = JSON.stringify(envelope, null, 2);
      const boundary = 'testb' + Date.now();
      const parts = [
        `--${boundary}\r\nContent-Disposition: form-data; name="file_name"\r\n\r\napproved_users.json\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="parent_type"\r\n\r\nexplorer\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="parent_node"\r\n\r\n${approvedFolder.token}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="size"\r\n\r\n${Buffer.byteLength(body)}\r\n`,
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="approved_users.json"\r\nContent-Type: application/json\r\n\r\n`,
      ];
      const payload = Buffer.concat([...parts.map(p=>Buffer.from(p)), Buffer.from(body), Buffer.from(`\r\n--${boundary}--\r\n`)]);
      const up = await (await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
        method:'POST', headers:{Authorization:`Bearer ${token}`, 'Content-Type':`multipart/form-data; boundary=${boundary}`}, body: payload})).json();
      check('6.2 审批结果文件恢复(移除测试成员)', up.code === 0);
      // 删除旧的同名文件(上传会生成新文件)
      const del = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${af.token}?type=file`, {method:'DELETE', headers:{Authorization:`Bearer ${token}`}});
      check('6.3 审批结果旧文件删除(防重复)', del.status === 200);
    }
  }

  console.log();
  console.log('='.repeat(62));
  console.log(`结果: ${PASSED.length} 通过 / ${FAILED.length} 失败`);
  if (FAILED.length) { console.log('失败项:', FAILED); process.exit(1); }
  console.log('跨网络双设备链路全部通过 ✓ (issue 5 闭环)');
  process.exit(0);
})().catch(e => { console.error('崩溃:', e); process.exit(1); });
