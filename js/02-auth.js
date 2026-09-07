/* ===========================================================
 * 模块: 02-auth.js
 * 功能: doLogin/restoreSession/doRegister/doForgotPassword/doLogout/isLeader/canEdit/updateMyInfo
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js
 * 源范围: demo.html L1947-L2123
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
async function doLogin(){
  const phone=document.getElementById('login-phone').value.trim();
  const pass=document.getElementById('login-pass').value.trim();
  if(!phone||!pass){showToast('请输入手机号和密码');return;}
  if(!/^\d{11}$/.test(phone)){showToast('请输入11位手机号');return;}
  let user=USERS.find(u=>u.phone===phone);
  // V5.7: 本地无此账号时,自动从飞书云端拉取用户表(组长审批过的组员在新设备/
  // 换手机登录场景,本地还没有该账号),拉取后重新查找——跨设备登录闭环
  if(!user){
    showToast('正在从云端核对账号...');
    await pullApprovedStatusFromFeishu({phone:phone},true);
    user=USERS.find(u=>u.phone===phone);
    if(!user){showToast('账号不存在，请先注册');return;}
  }
  // V5.4: 密码哈希验证，兼容明文旧密码（首次登录时自动迁移）
  let passOk = false;
  if (user.password && user.password.includes('$')) {
    passOk = await verifyPassword(pass, user.password);
  } else {
    // 兼容明文旧密码：首次登录时自动升级为哈希
    if (user.password === pass) {
      const salt = genSalt();
      user.password = await hashPassword(pass, salt);
      saveUsers(USERS);
      passOk = true;
    }
  }
  if (!passOk) {
    // V10.15.12: 本地旧哈希验证失败→拉云端最新名单重试一次——
    // 设备A改密已推云端(pw_ts新),设备B本地还是旧哈希,输入新密码时
    // 必须先同步云端再验证,否则新密码在旧设备上永远"密码错误"(V10.15.11修复缺口)
    try{
      await pullApprovedStatusFromFeishu({phone:phone},true);
      user=USERS.find(u=>u.phone===phone);
      if(user&&user.password&&user.password.includes('$')){
        passOk=await verifyPassword(pass,user.password);
      }
    }catch(e){console.warn('云端密码重试失败:',e.message);}
  }
  if (!passOk) { showToast('密码错误'); return; }
  // V5.3.1跨设备审批闭环修复: 待审核用户登录时先从飞书拉取最新审批结果,
  // 组长在另一台设备/另一网络已通过时,组员本机立即放行,不再被本地旧状态永久拦截
  if(user.status==='pending'){
    const approved=await pullApprovedStatusFromFeishu(user);
    if(!approved){showToast('您的账号正在审核中，请等待组长审核');return;}
  }
  if(user.status==='rejected'){showToast('您的注册申请未通过审核');return;}
  state.currentUser=user;
  // V5.7: 登录成功即清空导航历史栈,登录前的注册/忘记密码页不再可返回
  navReset();
  // V10.16.2 安全加固: 持久化会话带 HMAC 签名, 防止篡改 uid 冒充他人
  const sessionTs=Date.now();
  const sessionSig=await signSession(user.id, user.phone, sessionTs, user.password);
  localStorage.setItem('tcg_session',JSON.stringify({uid:user.id,phone:user.phone,ts:sessionTs,sig:sessionSig}));
  showScreen('screen-vehicles');
  renderBrandTags();
  showToast('登录成功');
  updateMyInfo();
  ensureNotifyPermission();
  // V10.15.6 账号级字段选项云同步: 登录成功即静默拉取云端选项覆盖本地(跨设备共享),
  // 无数据/网络失败静默保持本地, 组长端改过的选项组员与新设备登录后即可用。
  if(typeof syncFieldOptionsFromCloud==='function'){syncFieldOptionsFromCloud();}
  if(user.role==='admin'){
    pullPendingFromFeishu().then(()=>{renderMemberList();});
    // V5.3.1: 启动60秒静默轮询,跨网络/跨设备实时接收新注册申请
    startPendingPolling();
    // V10.7.0问题1已回退: 不再自动通过历史pending用户,恢复人工审批
  }else{
    // V10.3 问题3/5.1: 组员登录即启动账号存活守卫——被删账号最多60秒内
    // 收到通知并强制退出,登录瞬间也会即时核查一次
    startMemberGuardPolling();
    // V10.3 问题5.2: 组员登录后静默检查云端是否有新数据(红点提示)
    checkCloudDataUpdate(true);
  }
  updateMembersBadge(); // V10.1 问题3修复: 登录后立即刷新组员管理红点(本地缓存的待审核申请)
}

/**
 * 自动恢复登录会话 - App启动时调用
 * 从localStorage读取上次登录的会话,验证用户仍存在且状态正常
 * @returns {boolean} 是否成功恢复会话
 */
async function restoreSession(){
  try{
    const sessionStr=localStorage.getItem('tcg_session');
    if(!sessionStr)return false;
    const session=JSON.parse(sessionStr);
    if(!session||!session.uid)return false;
    // 验证会话未过期(7天有效期)
    const sessionAge=Date.now()-(session.ts||0);
    if(sessionAge>7*24*60*60*1000){
      localStorage.removeItem('tcg_session');
      return false;
    }
    const user=USERS.find(u=>u.id===session.uid);
    if(!user||user.status!=='active'){
      localStorage.removeItem('tcg_session');
      return false;
    }
    // V10.16.2 安全加固: 验证会话签名, 防止篡改 uid 冒充他人
    if(session.sig){
      const sigOk=await verifySessionSig(session.uid, session.phone, session.ts, session.sig, user.password);
      if(!sigOk){
        localStorage.removeItem('tcg_session');
        return false;
      }
    }else{
      // 旧版会话无签名(升级兼容): 重新生成带签名的会话
      const newSig=await signSession(user.id, user.phone, session.ts, user.password);
      localStorage.setItem('tcg_session',JSON.stringify({...session,sig:newSig}));
    }
    state.currentUser=user;
    return true;
  }catch(e){
    console.error('恢复会话失败:',e);
    localStorage.removeItem('tcg_session');
    return false;
  }
}

async function doRegister(){
  const name=document.getElementById('reg-name').value.trim();
  const phone=document.getElementById('reg-phone').value.trim();
  const pass=document.getElementById('reg-pass').value.trim();
  const pass2=document.getElementById('reg-pass2').value.trim();
  if(!name||!phone||!pass){showToast('请填写完整信息');return;}
  if(!/^\d{11}$/.test(phone)){showToast('请输入11位手机号');return;}
  if(pass.length<6){showToast('密码至少6位');return;}
  if(pass!==pass2){showToast('两次密码不一致');return;}
  if(USERS.find(u=>u.phone===phone)){showToast('该手机号已注册');return;}
  // V5.4: 密码哈希化存储
  const salt = genSalt();
  const hashedPass = await hashPassword(pass, salt);
  // V10.16.1 安全加固: 首个注册用户自动为 admin(组长先注册), 其余为待审组员
  const isFirstUser = USERS.length === 0;
  const newUser={id:Date.now(),name,phone,password:hashedPass,role:isFirstUser?'admin':'user',status:isFirstUser?'active':'pending',created:new Date().toLocaleDateString()};
  State.addUser(newUser); // A3状态守卫: 入列走State API(落盘仍由下一行saveUsers控制)
  saveUsers(USERS);
  if(isFirstUser){showToast('首个账号注册成功，已自动设为组长');}else{
    /* V10.7.0问题1已回退: 恢复人工审批文案
     * V10.7.0曾改为"自动通过后即可登录",现回退至V10.6.0策略:
     * 组员注册后进入待审状态,需组长在组员管理页面手动通过。 */
    showToast('注册成功，请等待组长审核后登录');
    syncPendingToFeishu(newUser);
    watchRegistrationActivation(newUser);
  }
  showScreen('screen-login');
  // V5.7: 注册完成回到登录页后清空历史栈,返回键不再退回注册表单
  navReset();
}

async function doForgotPassword(){
  const name=document.getElementById('forgot-name').value.trim();
  const phone=document.getElementById('forgot-phone').value.trim();
  const pass=document.getElementById('forgot-pass').value.trim();
  const pass2=document.getElementById('forgot-pass2').value.trim();
  // V10.16.1 安全加固: 密码重置需姓名+手机号双重校验, 防止仅凭手机号即可任意改密
  if(!name||!phone||!pass){showToast('请填写完整信息');return;}
  if(!/^\d{11}$/.test(phone)){showToast('请输入11位手机号');return;}
  if(pass.length<6){showToast('密码至少6位');return;}
  if(pass!==pass2){showToast('两次密码不一致');return;}
  const user=USERS.find(u=>u.phone===phone&&u.name===name);
  if(!user){showToast('姓名与手机号不匹配，请联系组长');return;}
  // V5.4: 新密码哈希化存储
  const salt = genSalt();
  user.password = await hashPassword(pass, salt);
  saveUsers(USERS);
  showToast('密码重置成功');
  showScreen('screen-login');
  // V5.7: 重置完成回到登录页后清空历史栈
  navReset();
}

/**
 * 退出登录 - 清除持久化会话,确保下次需重新登录
 */
function doLogout(){
  // V5.3.1: 退出时停止轮询器,避免登出后仍以旧身份拉取申请
  stopPendingPolling();
  // V10.3 问题3/5.1: 同步停止组员账号守卫轮询
  stopMemberGuardPolling();
  window.__tcgKicked=false; // 重置踢出标记,允许后续正常登录流程
  localStorage.removeItem('tcg_session');
  state.currentUser=null;
  showScreen('screen-login');
  // V5.7: 登出后立即清空历史栈,返回键不再退回已登录的主界面(安全隐患修复)
  navReset();
  showToast('已退出登录');
  document.getElementById('login-phone').value='';
  document.getElementById('login-pass').value='';
}

function isLeader(){return state.currentUser&&state.currentUser.role==='admin';}
function canEdit(){return isLeader();}

function updateMyInfo(){
  if(!state.currentUser)return;
  const card=document.querySelector('#screen-my .user-card');
  if(card){
    const avatar=card.querySelector('.user-avatar');
    const name=card.querySelector('.user-name');
    const role=card.querySelector('.user-role');
    if(avatar)avatar.textContent=state.currentUser.name.charAt(0);
    if(name)name.textContent=state.currentUser.name;
    if(role)role.textContent=state.currentUser.role==='admin'?'组长':'组员';
  }
}

// ===================== VEHICLE LIST =====================
