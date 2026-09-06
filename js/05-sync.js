/* ===========================================================
 * 模块: 05-sync.js
 * 功能: Pending审批轮询/Member守护/备份/JSON上传下载/doSyncUpload/doSyncDownload/日志/导入导出配置
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js, 03-vehicles.js, 04-export.js
 * 源范围: demo.html L4131-L5652
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
async function syncPendingToFeishu(user){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg,true))return;
  try{
    // V5.4: 注册申请上传飞书时含哈希密码（组长审批后需同步给组员）
    // 密码已在本地注册时哈希化（salt$hash格式），同步到飞书安全无明文泄露风险
    // V10.4.0 问题5.2: 增加source来源标识——组长端据此区分本端申请(人工审批)
    // 与跨端申请(React版APK等,静默自动处理),见pullPendingFromFeishu
    const pendingData={type:'pending_registration',source:'tcg-cordova',appVersion:'v'+APP_VERSION,user:{id:user.id,name:user.name,phone:user.phone,password:user.password,role:user.role,status:user.status,created:user.created},timestamp:new Date().toISOString()};
    const jsonStr=JSON.stringify(pendingData,null,2);
    const blob=new Blob([jsonStr],{type:'application/json'});
    const token=await getFeishuToken(cfg,2);
    await httpUploadFile({token,fileName:`pending_reg_${user.phone}.json`,folderToken:await getDataSubFolderToken(token,cfg.pendingSub),blob});
    console.log('注册申请已同步到飞书:',`pending_reg_${user.phone}.json`);
    showToast('注册申请已推送，请等待组长审核');
  }catch(err){
    console.error('Sync pending to Feishu failed:',err);
    // V5.7: 失败时清缓存自动重试一次(文件夹token失效自愈)
    try{
      const token=await getFeishuToken(cfg,1);
      invalidateDataFolderCache();
      const pendingData={type:'pending_registration',source:'tcg-cordova',appVersion:'v'+APP_VERSION,user:{id:user.id,name:user.name,phone:user.phone,password:user.password,role:user.role,status:user.status,created:user.created},timestamp:new Date().toISOString()};
      const blob=new Blob([JSON.stringify(pendingData,null,2)],{type:'application/json'});
      await httpUploadFile({token,fileName:`pending_reg_${user.phone}.json`,folderToken:await getDataSubFolderToken(token,cfg.pendingSub),blob});
      showToast('注册申请已推送(重试成功)，请等待组长审核');
      return;
    }catch(e2){/* 重试仍失败,走提示 */}
    showToast('申请推送失败('+err.message+')，请检查网络后重试');
  }
}

/**
 * V5.7: 注册后激活守望——组员端轮询云端审批结果
 * 机制: 组长端拉取申请进入pending态,组长手动通过后回推approved_users.json。
 *       组员注册后本函数每12秒拉一次云端用户表(最多10次/2分钟),检测到自己
 *       status=active时本地激活并提示可登录——把"审批通过"的闭环终点做到
 *       组员可感知,而不是等用户盲试登录。
 * V10.8.0: 回退V10.7.0自动通过,恢复人工审批;守望机制不变(仍检测active态)。
 * 容错: 任一轮网络失败静默跳过;超时未激活则保持pending,登录时doLogin仍会
 *       现场拉取一次审批状态兜底(V5.3.1闭环),不额外打扰用户。
 */
let _regWatchTimer=null;
function watchRegistrationActivation(user){
  if(_regWatchTimer)clearInterval(_regWatchTimer);
  let attempts=0;
  _regWatchTimer=setInterval(async()=>{
    attempts++;
    const local=USERS.find(u=>u.phone===user.phone);
    if(!local||local.status==='active'){ // 已激活(云端拉取或其他路径)
      clearInterval(_regWatchTimer);_regWatchTimer=null;
      if(local&&local.status==='active'){
        showToast('✅ 您的账号已激活，请登录');
      }
      return;
    }
    if(attempts>10){ // 2分钟守望窗口
      clearInterval(_regWatchTimer);_regWatchTimer=null;
      return;
    }
    try{
      const approved=await pullApprovedStatusFromFeishu(user);
      if(approved){
        clearInterval(_regWatchTimer);_regWatchTimer=null;
        showToast('✅ 您的账号已激活，请登录');
      }
    }catch(e){console.debug("[PendingPoll]轮询请求网络抖动跳过(下轮重试):",e&&e.message||String(e))}
  },12000);
}

/* ===================== 组员注册申请拉取 · A3四刀切(V10.13) =====================
 * 原 pullPendingFromFeishu 165行单函数(网络IO+业务规则+持久化+渲染 4职责混合,P1-4)
 * 拆为四个单一职责函数, pullPendingFromFeishu 退化为编排薄壳:
 *   ① fetchPendingFromCloud  网络IO: 双位置列目录→下载→解析→载荷校验
 *   ② applyApprovalRules     业务规则: 跨网络默认通过(即消费即删)/本端人工审批/已拒绝保留
 *   ③ writePendingsToStorage 持久化: 有变更才saveUsers落盘
 *   ④ refreshMemberUI        渲染+通知: 组员列表/徽标/Toast/系统通知/同步日志
 * 行为归并说明(自愈重试分支与主分支原有3处漂移, 统一按主分支语义):
 *   - 自愈分支原仅列"注册申请"子目录 → 统一为双位置兼容读取(与主分支一致);
 *   - 自愈分支原本端pending申请处理后就删云端文件 → 统一为保留(由组长审批动作
 *     approveMember触发删除);规则幂等,云端残留不会重复计数;
 *   - 自愈分支跨网络申请修改USERS但未计数→cnt=0时saveUsers/云端回推被整体跳过
 *     的潜在丢档 → 统一计数(crossSilentCount),落盘/回推不再丢失。
 * 不变量: pullPendingFromFeishu(silent) 签名/返回值(新拉取数量) 100%兼容。 */

/**
 * fetch超时signal兼容垫片 - V10.15.10
 * 根因: 部分环境(测试沙箱jsdom/旧WebView polyfill)中AbortController与fetch
 * 来自不同realm,signal传入fetch即抛
 * "RequestInit: Expected signal to be an instance of AbortSignal"——
 * V10.9.0引入的AbortController超时在此类环境反而导致下载链路全断。
 * 策略: ①无AbortController环境直接裸fetch(仅失去超时保护);
 *       ②带signal首试,signal兼容性TypeError时去signal重试一次
 *        (仅匹配AbortSignal字样,真网络TypeError照常抛出,GET幂等安全)。
 * @param {string} url 请求地址
 * @param {object} [opts] fetch选项(不得自带signal)
 * @param {number} [timeoutMs] 超时毫秒,默认60s
 * @returns {Promise<Response>} fetch响应
 */
async function fetchSignalSafe(url,opts,timeoutMs){
  opts=opts||{};
  if(typeof AbortController!=='function')return fetch(url,opts);
  const ctrl=new AbortController();
  const tid=setTimeout(function(){ctrl.abort();},timeoutMs||60000);
  try{
    const res=await fetch(url,Object.assign({},opts,{signal:ctrl.signal}));
    clearTimeout(tid);return res;
  }catch(e){
    clearTimeout(tid);
    if(e&&e.name==='AbortError')throw e; // 超时照常抛,由调用方语义处理
    // 注意: 不能用 instanceof TypeError——跨realm错误对象(jsdom/undici混跑)
    // 的原型链不同,instanceof恒false; e.name为字符串属性,跨realm可靠
    if(e&&e.name==='TypeError'&&/AbortSignal/i.test(String(e.message||''))){
      console.warn('[fetch] signal跨realm不兼容,去signal重试:',url.slice(0,80));
      return fetch(url,opts); // 降级: 失去超时保护但保住功能
    }
    throw e;
  }
}

/**
 * ① 网络IO: 收集全部注册申请文件并下载解析(无业务规则/无渲染)
 * 读取位置: ①"APP数据备份/注册申请"(V5.7新位置) ②"APP数据备份"根(V5.3-V5.6旧位置)
 * 兼容性: 组员手机上仍运行旧版APP时,申请文件上传在旧位置,新版组长APP同样能收到
 * @param {object} cfg 飞书配置(getFeishuCfg产物)
 * @param {object} [opts] {retryToken:boolean} 自愈重试场景: token获取带重试标记(缓存失效)
 * @returns {Promise<Array>} 合法申请载荷数组(仅 type==='pending_registration'&&user)
 */
async function fetchPendingFromCloud(cfg,opts){
  const token=await getFeishuToken(cfg,opts&&opts.retryToken?1:0);
  // 收集新旧两个位置的全部申请文件(按文件名去重,新位置优先)
  let pendingFiles=[];
  try{
    const newSub=await getDataSubFolderToken(token,cfg.pendingSub);
    pendingFiles.push(...(await feishuListFiles(token,newSub)||[]));
  }catch(e){console.warn('新位置(注册申请)读取跳过:',e.message);}
  try{
    const dataRoot=await getDataFolderToken(token);
    const rootFiles=(await feishuListFiles(token,dataRoot)||[]);
    pendingFiles.push(...rootFiles);
  }catch(e){console.warn('旧位置(数据区根)读取跳过:',e.message);}
  const seen=new Set();
  pendingFiles=pendingFiles.filter(f=>{
    if(!f.name||!f.name.startsWith('pending_reg_')||!f.name.endsWith('.json'))return false;
    if(seen.has(f.name))return false;
    seen.add(f.name);
    return true;
  });
  const payloads=[];
  for(const file of pendingFiles){
    try{
      // 原生HTTP下载文本(V10.9.0: timeout 60秒防止弱网挂起)
      let dlText;
      if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
        dlText=await new Promise((resolve,reject)=>{
          window.cordova.plugin.http.sendRequest(`https://open.feishu.cn/open-apis/drive/v1/files/${file.token}/download`,{method:'GET',headers:{Authorization:'Bearer '+token},timeout:60},res=>resolve(res.data),err=>reject(new Error(String(err.error||'下载失败'))));
        });
      }else{
        // 原生fetch下载文本(V10.9.0超时60s防弱网挂起;V10.15.10改用signal兼容垫片)
        const r=await fetchSignalSafe(`https://open.feishu.cn/open-apis/drive/v1/files/${file.token}/download`,{headers:{Authorization:'Bearer '+token}},60000);
        dlText=await r.text();
      }
      const pendingData=JSON.parse(dlText);
      if(pendingData.type==='pending_registration'&&pendingData.user)payloads.push(pendingData);
    }catch(e){continue;}
  }
  return payloads;
}

/**
 * ② 业务规则: 逐条裁决申请并就地更新USERS(不落盘/不渲染)
 * V10.6.0 问题2根因: 跨网络组员申请"不显示+默认通过"——
 *   判定: 载荷无source标识或source非本端('tcg-cordova')即为跨网络申请。
 *   ①默认通过: 以active+crossPlatform+hidden标记upsert进USERS(hidden使全部UI不可见,
 *     但仍随approved_users.json同步,保持跨端登录闭环);
 *   ②不显示: 不弹Toast、不推通知、不写同步日志UI、不进组员列表;
 *   ③即消费即删: 处理完立即删除云端申请文件,杜绝重复消费与目录堆积。
 * V10.6.0(回退): 本端申请恢复人工审批——进入pending态由组长手动通过/拒绝;
 *   云端申请文件保留,由组长审批动作(approveMember)触发删除;已拒绝账号不自动复活。
 * @param {Array} pendings fetchPendingFromCloud产出的合法载荷数组
 * @returns {Promise<{newCount:number,crossSilentCount:number,changed:boolean}>}
 */
async function applyApprovalRules(pendings){
  let newCount=0;
  // V10.6.0 问题2: 跨网络组员申请计数(完全隐形: 不显示+默认通过+云端文件即消费即删)
  let crossSilentCount=0;
  for(const pendingData of pendings||[]){
    try{
      const isCrossPlatform=pendingData.source!=='tcg-cordova';
      const existingUser=USERS.find(u=>u.phone===pendingData.user.phone);
      if(isCrossPlatform){
        const u=pendingData.user;
        u.crossPlatform=true;
        u.hidden=true;
        u.status='active'; // 默认通过
        if(!existingUser){
          State.addUser(u);
          crossSilentCount++;
        }else if(existingUser.status!=='active'||!existingUser.crossPlatform||!existingUser.hidden){
          existingUser.status='active';
          existingUser.crossPlatform=true;
          existingUser.hidden=true;
          crossSilentCount++;
        }
        // 即消费即删: 清理云端申请文件(幂等,失败不影响主流程)
        try{await deletePendingFileFromFeishu(u.phone);}catch(e){console.warn("[ApprovalCleanup]云端pending申请文件删除失败(下轮重试): phone=%s err=%s stack=%s",u.phone,e.message,e.stack)}
      }else{
        const u=pendingData.user;
        if(!existingUser){
          u.status='pending'; // 人工审批
          State.addUser(u);
          newCount++;
        }else if(existingUser.status==='pending'){
          // 已在待审列表,不重复计数
        }else if(existingUser.status==='rejected'){
          // 组长曾明确拒绝过的账号: 保留拒绝状态,不自动复活
          console.log('[组员管理] 已拒绝账号的新申请保留拒绝状态:',pendingData.user.phone);
        }
      }
    }catch(e){continue;}
  }
  return {newCount,crossSilentCount,changed:(newCount>0||crossSilentCount>0)};
}

/**
 * ③ 持久化: 有变更才把USERS整体序列化落盘(无渲染职责)
 * @param {object} result applyApprovalRules产出
 * @returns {boolean} 是否发生了落盘
 */
function writePendingsToStorage(result){
  if(!result||!result.changed)return false;
  saveUsers(USERS);
  return true;
}

/**
 * ④ 渲染+通知: 组员列表/红点徽标刷新与Toast/系统通知/同步日志(无IO职责)
 * @param {object} result applyApprovalRules产出
 * @param {boolean} silent 静默模式(轮询): 仅Toast+同步日志,不推系统通知
 * @param {boolean} selfHeal 自愈重试路径: 沿用原自愈文案(仅Toast)
 * @returns {boolean} 是否发生了渲染
 */
function refreshMemberUI(result,silent,selfHeal){
  if(!result||!result.changed)return false;
  renderMemberList();
  updateMembersBadge();
  if(result.newCount>0){
    // V10.6.0(回退): 本端申请进入待审列表,组长手动审批
    if(selfHeal){
      showToast(`📥 收到${result.newCount}条新注册申请，请审核`);
    }else if(silent){
      showToast(`📥 收到${result.newCount}条新的组员注册申请`);
      addSyncLog(`轮询发现${result.newCount}条新注册申请`,'blue');
    }else{
      showToast(`从飞书拉取${result.newCount}条待审核注册`);
      leaderNotify('新注册待审批', `收到${result.newCount}条新注册申请，请尽快处理`);
      addSyncLog(`从飞书拉取${result.newCount}条待审核注册`,'blue');
    }
  }
  if(result.crossSilentCount>0){
    // V10.6.0 问题2: 跨网络申请完全隐形——不弹Toast/不推通知/不写同步日志UI,
    // 仅console留痕供开发排查(需求原文"应用端不显示跨网络组员的申请")
    console.log('[组员管理] 跨网络申请已默认通过(不显示):',result.crossSilentCount,'条');
    // V10.6.0: 跨网络自动通过后回推云端用户表(去抖5秒)
    _debouncePushApprovedUsers();
  }
  return true;
}

/**
 * 从飞书拉取待审核注册(编排薄壳) - V5.7双位置兼容读取
 * 流程: ①fetchPendingFromCloud(IO) → ②applyApprovalRules(规则)
 *      → ③writePendingsToStorage(持久化) → ④refreshMemberUI(渲染+通知)
 * 失败自愈: 缓存失效场景一次性重试(invalidateDataFolderCache + token重试标记)
 * @param {boolean} silent - 静默模式(轮询时不弹Toast)
 * @returns {Promise<number>} 新拉取的待审核数量
 */
async function pullPendingFromFeishu(silent){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return 0;
  try{
    const result=await applyApprovalRules(await fetchPendingFromCloud(cfg));
    writePendingsToStorage(result);
    refreshMemberUI(result,silent);
    return result.newCount+result.crossSilentCount;
  }catch(err){
    console.error('Pull pending from Feishu failed:',err);
    // V5.7: 一次性自愈重试(缓存失效场景)
    try{
      invalidateDataFolderCache();
      const result2=await applyApprovalRules(await fetchPendingFromCloud(cfg,{retryToken:true}));
      writePendingsToStorage(result2);
      refreshMemberUI(result2,silent,true);
      return result2.newCount+result2.crossSilentCount;
    }catch(e2){return 0;}
  }
}

/**
 * 审批通过后删除云端申请文件 - V5.7新增
 * 避免同一申请被多台组长设备重复处理,也保持云端"注册申请"目录干净
 */
async function deletePendingFileFromFeishu(phone){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return;
  try{
    const token=await getFeishuToken(cfg);
    const fileName=`pending_reg_${phone}.json`;
    // 双位置清理(新子目录+旧数据区根)
    const locations=[];
    try{locations.push(await getDataSubFolderToken(token,cfg.pendingSub));}catch(e){console.debug("[PullPending]新pending子目录token读取失败(回退旧位置):",e.message)}
    try{locations.push(await getDataFolderToken(token));}catch(e){console.debug("[PullPending]根目录token读取失败(仅旧位置链路可用):",e.message)}
    for(const loc of locations){
      const olds=(await feishuListFiles(token,loc)||[]).filter(f=>f.name===fileName);
      for(const f of olds){
        await httpFetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
      }
    }
  }catch(err){console.warn('云端申请文件清理跳过:',err.message);}
}

/**
 * V10.6.0: 去抖回推云端用户表
 * 跨网络组员申请自动通过后需回推approved_users.json(跨端登录闭环);
 * 可能一秒内连续命中多次,直接逐条pushApprovedUsersToFeishu会产生N次全量上传。
 * 去抖5秒: 窗口期内多次触发只执行最后一次,网络开销归一。
 * 失败静默(下轮轮询的自动通过路径会再次触发),不阻塞审批主流程。
 */
let _pushApprovedTimer=null;
function _debouncePushApprovedUsers(){
  if(!isLeader())return; // 仅组长端有权回推云端权威用户表
  if(_pushApprovedTimer)clearTimeout(_pushApprovedTimer);
  _pushApprovedTimer=setTimeout(()=>{
    _pushApprovedTimer=null;
    pushApprovedUsersToFeishu().catch(err=>{
      console.warn('[组员管理] 自动通过后回推云端用户表失败(下轮重试):',err&&err.message);
    });
  },5000);
}

/**
 * V10.7.0问题1已回退: 此函数已禁用——不再自动通过历史pending用户。
 * V10.6.0策略: 本端申请保持pending态等待组长人工审批。
 * 保留空函数体避免旧引用报错(如有遗漏的调用点)。
 */
function autoApproveLegacyPendingUsers(){
  return; // V10.8.0: 回退为空操作
}

/**
 * 上传审批结果到飞书 - V5.7数据分仓版
 * 存放位置: "APP数据备份/审批结果/approved_users.json"
 * V5.7说明: 恢复同步密码哈希(salt$hash格式,SHA-256不可逆,与本地存储完全同级安全,
 *           云端不含任何明文密码)。V5.6曾完全剔除密码字段,导致组员在换手机/新设备
 *           登录时本地无账号无哈希,永远"账号不存在"——跨设备闭环被切断。
 * @returns {Promise<boolean>}
 */
async function pushApprovedUsersToFeishu(){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return false;
  try{
    const token=await getFeishuToken(cfg);
    // V5.7: 含哈希密码(salt$hash不可逆,云端无明文),支撑组员新设备登录闭环
    const payload={type:'approved_users',version:'v'+APP_VERSION,timestamp:new Date().toISOString(),users:USERS.map(u=>({id:u.id,name:u.name,phone:u.phone,password:u.password||'',role:u.role,status:u.status,created:u.created}))};
    await uploadJsonToDataFeishu(token,'approved_users.json',JSON.stringify(payload),cfg.approvedSub);
    // 迁移清理: 删除旧位置(数据区根)同名文件,防止读到陈旧审批结果
    try{
      const dataRoot=await getDataFolderToken(token);
      const olds=(await feishuListFiles(token,dataRoot)||[]).filter(f=>f.type==='file'&&f.name==='approved_users.json');
      for(const f of olds){
        await httpFetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
      }
    }catch(e){console.warn('旧位置审批文件清理跳过:',e.message);}
    addSyncLog('审批结果已同步到飞书(审批结果/)','green');
    return true;
  }catch(err){
    console.error('Push approved users failed:',err);
    addSyncLog('审批结果同步失败: '+err.message,'red');
    return false;
  }
}

/**
 * 从云端拉取审批结果并合并到本地用户表 - V5.7增强
 * 同时服务于两个场景:
 *   1) pending组员登录时检查自己是否已被组长通过(原V5.3.1逻辑)
 *   2) 全量合并云端用户(新设备登录发现账号/多设备状态同步)
 * @param {Object} [userParam] - 指定用户(登录时state.currentUser尚未赋值)
 * @param {boolean} [fullMerge] - true=全量合并云端用户到本地(新设备登录用)
 * @returns {Promise<boolean>} 指定用户是否已被批准(fullMerge时返回是否拉取成功)
 */
async function pullApprovedStatusFromFeishu(userParam,fullMerge){
  const who=userParam||state.currentUser;
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg)||( !who&&!fullMerge))return false;
  try{
    const token=await getFeishuToken(cfg);
    // V5.7: 优先读新位置(审批结果/),回退旧位置(数据区根)
    let data=null;
    try{
      data=await downloadJsonFromDataFeishu(token,'approved_users.json',cfg.approvedSub);
    }catch(e){console.warn('新位置(审批结果)读取失败,回退旧位置:',e.message);}
    if(!data){
      try{data=await downloadJsonFromDataFeishu(token,'approved_users.json');}catch(e){console.debug('[ApprovalPull]旧位置(根)approved_users.json不存在(首次运行正常):',e.message)}
    }
    if(!data||!data.users)return false;
    let me=null;
    for(const cu of data.users){
      if(!cu||!cu.phone)continue;
      const local=USERS.find(u=>u.phone===cu.phone);
      if(!local){
        // V5.7: 云端有而本地无(新设备/其他组长审批过)→合并入库,支撑跨设备登录
        if(cu.status==='active'||cu.status==='pending'||cu.status==='rejected'){
          State.addUser(cu); // A3状态守卫
        }
      }else{
        // 本地已有: 云端状态更新时同步(仅状态与审批信息,密码以本地为准避免覆盖)
        if(local.status!==cu.status&&cu.status==='active'){
          local.status='active';
        }
      }
      if(who&&cu.phone===who.phone)me=cu;
    }
    saveUsers(USERS);
    if(fullMerge)return true;
    if(me&&me.status==='active'){
      const local=USERS.find(u=>u.phone===me.phone);
      if(local&&local.status!=='active'){
        local.status='active';
        saveUsers(USERS);
        showToast('🎉 您的注册申请已被组长通过,现已可正常使用');
        return true;
      }
      return local&&local.status==='active';
    }
    return false;
  }catch(err){return false;}
}

/**
 * 组长注册申请轮询器 - V5.3新增 / V5.7增强
 * 1) 登录成功后每60秒静默拉取一次,跨网络/跨设备也能及时收到申请
 * 2) V5.7: App从后台切回前台(resume)时立即拉取一次——组长切回APP即可秒收申请,
 *    不必等待最长60秒的轮询窗口(两台手机跨网络场景实测痛感最明显的等待)
 */
let pendingPollTimer=null;
function startPendingPolling(){
  if(pendingPollTimer)clearInterval(pendingPollTimer);
  pendingPollTimer=setInterval(()=>{
    if(state.currentUser&&state.currentUser.role==='admin'&&state.currentUser.status==='active'){
      pullPendingFromFeishu(true);
    }
  },60000);
  // V5.7: 前台切回立即拉取(去抖:10秒内重复resume不重复拉)
  if(!window.__tcgResumeBound){
    window.__tcgResumeBound=true;
    document.addEventListener('resume',()=>{
      if(state.currentUser&&state.currentUser.role==='admin'&&state.currentUser.status==='active'){
        const now=Date.now();
        if(now-(window.__tcgLastPullTs||0)>10000){
          window.__tcgLastPullTs=now;
          pullPendingFromFeishu(true);
        }
      }
    });
  }
}
function stopPendingPolling(){if(pendingPollTimer){clearInterval(pendingPollTimer);pendingPollTimer=null;}}

/**
 * ===================== V10.3 问题3/5.1: 组员账号存活守卫 =====================
 * 需求: 组长删除组员账号后,组员端必须立刻收到通知并退出应用。
 * 背景: 旧版deleteMember仅在组长本机删除并推送approved_users.json到飞书,
 *       组员端登录会话(tcg_session)与本地用户表(tcg_users)毫不知情,
 *       组员可无限期继续使用已删除的账号——账号生命周期出现"幽灵态"。
 * 方案: 组员登录后启动60秒轮询+resume即时核查,从飞书拉取云端权威用户表,
 *       发现①账号不在表中(被删除)或②status≠active(被停用)时,
 *       弹通知(本地通知插件可用时发系统通知)+清会话+强制退回登录页。
 * 防误判: 仅在云端用户表成功拉取且结构合法时判定;网络失败/云端无数据时
 *         跳过本轮,绝不因网络抖动误踢在线组员。
 */
let memberGuardTimer=null;
let memberGuardBusy=false;

/**
 * 拉取云端用户表并核查当前组员账号是否仍存活
 * @returns {Promise<boolean>} true=账号存活/本轮跳过; false=已判定账号被删并触发强制退出
 */
async function checkMemberAccountAlive(){
  if(!state.currentUser||state.currentUser.role!=='user')return true;
  if(memberGuardBusy)return true; // 上一轮未完成,跳过(防重入叠发请求)
  memberGuardBusy=true;
  try{
    const cfg=getFeishuCfg();
    if(!feishuCfgReady(cfg))return true; // 未配置同步:跳过(不误踢离线环境)
    const token=await getFeishuToken(cfg);
    // 优先新位置(审批结果/),回退旧位置(数据区根)——与pullApprovedStatusFromFeishu一致
    let data=null;
    try{data=await downloadJsonFromDataFeishu(token,'approved_users.json',cfg.approvedSub);}catch(e){console.debug('[ApprovalPull]新位置(审批结果/)approved_users.json不存在(回退旧位置):',e.message)}
    if(!data){
      try{data=await downloadJsonFromDataFeishu(token,'approved_users.json');}catch(e){console.debug('[ApprovalPull]旧位置approved_users.json也不存在(首次运行正常):',e.message)}
    }
    // 云端无有效用户表→本轮跳过,不能作为"账号已删"的证据
    if(!data||!Array.isArray(data.users)||!data.users.length)return true;
    const me=data.users.find(u=>u&&u.phone===state.currentUser.phone);
    if(me&&me.status==='active')return true; // 账号存活
    // ---- 账号已被组长删除或停用:判定成立,强制退出 ----
    const reason=me?'您的账号已被组长停用':'您的账号已被组长删除';
    await forceLogoutAsDeleted(reason);
    return false;
  }catch(err){
    console.warn('[组员守卫] 核查失败(下轮重试):',err&&err.message);
    return true; // 网络异常:跳过本轮
  }finally{
    memberGuardBusy=false;
  }
}

/**
 * 账号被删/停用后的强制退出:通知→清理→回登录页
 * @param {string} reason - 展示给用户的原因文案
 */
async function forceLogoutAsDeleted(reason){
  // 防重复触发(轮询与resume可能同秒命中)
  if(window.__tcgKicked)return;
  window.__tcgKicked=true;
  stopMemberGuardPolling();
  stopPendingPolling();
  // 清会话+本地账号记录,下次启动restoreSession直接失败回登录页
  localStorage.removeItem('tcg_session');
  // A3状态守卫: 删除走State API(按手机号)
  if(State.removeUser(state.currentUser.phone)){saveUsers(USERS);}
  // 系统级通知(应用在前台时插件会以内嵌横幅弹出,后台时走系统通知栏)
  leaderNotify('账号已删除',reason+',应用已退出,如需使用请联系组长重新开通。');
  state.currentUser=null;
  navReset();
  // 关闭全部弹层再回登录页,避免残留遮罩
  document.querySelectorAll('.modal-overlay.show').forEach(m=>m.classList.remove('show'));
  showScreen('screen-login');
  showToast(reason+',已退出应用');
}

/**
 * 启动组员账号存活守卫(登录成功/会话恢复时由组员角色触发)
 * 60秒周期轮询 + resume前台即时核查(与组长申请轮询同节奏)
 */
function startMemberGuardPolling(){
  if(memberGuardTimer)clearInterval(memberGuardTimer);
  memberGuardTimer=setInterval(()=>{
    if(!state.currentUser||state.currentUser.role!=='user'||window.__tcgKicked){
      stopMemberGuardPolling();
      return;
    }
    checkMemberAccountAlive();
  },60000);
  // resume即时核查(复用去抖窗口,10秒内重复resume不重复核查)
  if(!window.__tcgMemberResumeBound){
    window.__tcgMemberResumeBound=true;
    document.addEventListener('resume',()=>{
      if(state.currentUser&&state.currentUser.role==='user'&&!window.__tcgKicked){
        const now=Date.now();
        if(now-(window.__tcgMemberGuardTs||0)>10000){
          window.__tcgMemberGuardTs=now;
          checkMemberAccountAlive();
        }
      }
    });
  }
  // 启动即查一次(登录瞬间就校验,被删账号立即拦截)
  checkMemberAccountAlive();
}
function stopMemberGuardPolling(){if(memberGuardTimer){clearInterval(memberGuardTimer);memberGuardTimer=null;}}

async function doBackup(){
  const dest=document.querySelector('input[name="backup-dest"]:checked');
  const target=dest?dest.value:'local';
  const backupData={version:'v'+APP_VERSION,timestamp:new Date().toISOString(),vehicleCount:VEHICLES.length,vehicles:VEHICLES,users:USERS};
  const jsonStr=JSON.stringify(backupData,null,2);
  const blob=new Blob([jsonStr],{type:'application/json'});
  const filename=`vehicle_backup_${new Date().toISOString().slice(0,10)}.json`;
  if(target==='local'){
    /* V10.6.0 问题3根因修复: 本地备份不再调起分享控件
     * 根因: 旧版本地备份走shareFile()——该函数职责是"分享到第三方",
     * 必然调起系统分享面板,与"本地备份=仅保存在本地对应文件夹"语义冲突。
     * 修复: 改走saveBlobToLocalFolder()直写「下载/太仓港断电指导」目录,
     * 全程无分享面板;保存成功提示具体目录,失败明确报错。 */
    showToast('正在保存备份到本地...');
    const saved=await saveBlobToLocalFolder(blob,filename);
    if(saved){
      showToast(`✅ 本地备份完成：${saved.label}/${filename}`);
      addBackupHistory('local',filename,VEHICLES.length,blob.size);
      addSyncLog(`本地备份完成 · ${VEHICLES.length}条 · ${saved.label}/`,'green');
    }else{
      showToast('本地备份失败：无法写入本地存储目录');
      addSyncLog('本地备份失败 · 无法写入本地存储目录','red');
    }
  }else if(target==='feishu'){
    const cfg=getFeishuCfg();
    if(!feishuCfgReady(cfg,true))return;
    showToast('正在上传备份到飞书...');
    try{
      // V5.7: 备份属用户操作数据,上传至"APP数据备份/备份文件"子文件夹,与项目产物彻底分离
      const token=await getFeishuToken(cfg);
      await httpUploadFile({token,fileName:filename,folderToken:await getDataSubFolderToken(token,cfg.backupSub),blob});
      showToast('飞书备份完成(已存入 APP数据备份/备份文件)');
      addBackupHistory('feishu',filename,VEHICLES.length,blob.size);
      addSyncLog(`飞书备份完成 · ${VEHICLES.length}条 · ${filename}`,'green');
    }catch(err){
      // V5.7: 缓存失效自愈重试一次
      try{
        const token=await getFeishuToken(cfg,1);
        invalidateDataFolderCache();
        await httpUploadFile({token,fileName:filename,folderToken:await getDataSubFolderToken(token,cfg.backupSub),blob});
        showToast('飞书备份完成(已存入 APP数据备份/备份文件)');
        addBackupHistory('feishu',filename,VEHICLES.length,blob.size);
        addSyncLog(`飞书备份完成 · ${VEHICLES.length}条 · ${filename}`,'green');
        return;
      }catch(e2){/* 重试仍失败 */}
      showToast('飞书备份失败: '+err.message);
      addSyncLog('飞书备份失败: '+err.message,'red');
    }
  }
}

// ===================== SYNC =====================
function loadFeishuConfig(){
  /* V10.14.1 修复【组员端"飞书配置不完整"误报】: 配置解析改走 getFeishuCfg() 统一出口。
   * 根因: 此处直读 localStorage——组员端本地从未保存过 feishu_config,appSecret 恒取
   * DEFAULT_FEISHU_CONFIG 空串 → cfgReady 恒 false → 三色横幅误报"未注入同步凭据";
   * getFeishuCfg() 优先消费构建期注入秘钥的闭包缓存(_INJECTED_SECRETS_CACHE),
   * 组员零配置场景仍返回完整可用配置(与 syncPendingToFeishu 等8处既有出口对齐)。 */
  const cfg=getFeishuCfg();
  // 安全+UX保留: Secret 输入框仅回显用户手动保存值(注入秘钥只在闭包内存中供同步
  // 链路使用,不落DOM可读值);interval 为用户偏好(数字类型不参与秘钥解析),保留回显
  const saved=JSON.parse(localStorage.getItem('feishu_config')||'{}');
  const a=document.getElementById('feishu-appid');if(a)a.value=cfg.appId||'';
  const s=document.getElementById('feishu-secret');if(s)s.value=saved.appSecret||'';
  const f=document.getElementById('feishu-folder');if(f)f.value=cfg.folder||'';
  const iv=document.getElementById('feishu-interval');if(iv)iv.value=saved.interval||cfg.interval||30;
  const st=document.getElementById('feishu-status');
  // --- V10.14.0 修复C【组员零配置横幅】: 按角色+配置就绪度显横幅 ---
  const banner = document.getElementById('feishu-role-banner');
  const isMemberNow = state.currentUser && state.currentUser.role !== 'admin';
  const cfgReady = !!(cfg.appId && cfg.appSecret);
  // 横幅与输入框样式(零配置提示)
  if(banner){
    banner.classList.remove('hidden');
    if(isMemberNow){
      if(cfgReady){
        banner.className = 'mb-3 rounded-xl px-3 py-2.5 text-xs leading-relaxed border border-green-200 bg-green-50 text-green-700';
        banner.innerHTML = '<span class="font-semibold">✅ 组员账号：云端配置已内置，无需手动填写</span><br>安装包已加密注入飞书同步凭据，可直接从「数据同步」页面拉取组长发布的最新车辆手册。<span class="text-green-600">若同步失败请更新至最新官方安装包。</span>';
      }else{
        banner.className = 'mb-3 rounded-xl px-3 py-2.5 text-xs leading-relaxed border border-amber-200 bg-amber-50 text-amber-700';
        banner.innerHTML = '<span class="font-semibold">⚠️ 组员账号：当前安装包未注入同步凭据</span><br>请前往<span class="font-medium">Release 下载官方签名安装包</span>重新安装（无需注册新账号）。未签名开发构建/手动安装的调试 APK 不含云端凭据，将无法拉取云端车辆数据。';
      }
    }else{
      // 组长/未登录: 仍然显示一段简短说明,不打扰
      banner.className = 'mb-3 rounded-xl px-3 py-2.5 text-xs leading-relaxed border border-blue-200 bg-blue-50 text-blue-700';
      banner.innerHTML = '<span class="font-semibold">🛠 组长管理员设置区：</span>此处可切换飞书应用（自建租户场景）。普通组员无需修改本页任何内容，安装包已内置默认同步凭据。';
    }
  }
  // 组员端：AppSecret/Token输入框改为只读(视觉+交互不可编辑),保存按钮隐藏
  const inputs = [a, s, f];
  const saveBtn = document.querySelector('button[onclick="saveFeishuConfig()"]');
  inputs.forEach(inp => {
    if(!inp) return;
    if(isMemberNow){ inp.setAttribute('readonly','readonly'); inp.classList.add('bg-gray-100','cursor-not-allowed'); inp.classList.remove('focus:border-blue-500'); }
    else{ inp.removeAttribute('readonly'); inp.classList.remove('bg-gray-100','cursor-not-allowed'); inp.classList.add('focus:border-blue-500'); }
  });
  if(iv){
    if(isMemberNow){ iv.setAttribute('disabled','disabled'); iv.classList.add('bg-gray-100','cursor-not-allowed'); }
    else{ iv.removeAttribute('disabled'); iv.classList.remove('bg-gray-100','cursor-not-allowed'); }
  }
  if(saveBtn){
    if(isMemberNow){ saveBtn.classList.add('hidden'); }
    else{ saveBtn.classList.remove('hidden'); }
  }
  if(st)st.textContent=cfg.appId?'飞书账号已配置 ✓':'未配置飞书账号';
  const cv=document.getElementById('sync-cloud-ver');
  if(cv)cv.textContent=cfg.appId?'已连接 · v'+APP_VERSION:'未连接';
}

function saveFeishuConfig(){
  // V10.14.0 修复C-深度防御: 组员账号禁止写入飞书配置(即使前端被调试验证绕过)
  // 组员写入会污染localStorage,使getFeishuCfg的pick()优先取错值并遮蔽注入秘钥缓存
  if(state.currentUser && state.currentUser.role!=='admin'){
    showToast('组员账号无需手动配置飞书同步，已内置官方凭据');
    return;
  }
  const appId=document.getElementById('feishu-appid').value.trim();
  const appSecret=document.getElementById('feishu-secret').value.trim();
  const folder=document.getElementById('feishu-folder').value.trim();
  const interval=parseInt(document.getElementById('feishu-interval').value)||30;
  if(!appId||!appSecret){showToast('请填写飞书 App ID 和 App Secret');return;}
  // V10.14.0 修复C: 写入_writer='admin'标记,getFeishuCfg在成员端识别此配置是可信的
  const cfg={appId,appSecret,folder,interval,updatedAt:new Date().toISOString(),_writer:'admin'};
  localStorage.setItem('feishu_config',JSON.stringify(cfg));
  const st=document.getElementById('feishu-status');
  if(st)st.textContent='飞书账号已配置 ✓';
  const cv=document.getElementById('sync-cloud-ver');
  if(cv)cv.textContent='已连接 · v'+APP_VERSION;
  showToast('飞书配置已保存');
  addSyncLog('飞书账号配置已更新','blue');
}

/**
 * 获取飞书Token - 支持自动重试 + 原生HTTP(V5.3)
 * @param {Object} cfg - 飞书配置
 * @param {number} retries - 重试次数
 * @returns {Promise<string>} tenant_access_token
 */
async function getFeishuToken(cfg,retries){
  retries=retries||2;
  let lastErr;
  for(let i=0;i<=retries;i++){
    try{
      const data=await httpFetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:{app_id:cfg.appId,app_secret:cfg.appSecret}
      });
      if(data.tenant_access_token)return data.tenant_access_token;
      lastErr=new Error('飞书认证失败: '+(data.msg||''));
    }catch(e){
      lastErr=e;
      console.warn('飞书Token获取失败,重试'+(i+1)+'/'+(retries+1)+':',e.message);
      if(i<retries)await new Promise(r=>setTimeout(r,1000*(i+1)));
    }
  }
  throw lastErr;
}

/**
 * 上传JSON到飞书指定文件夹 - 底层通用函数(V5.3)
 * @param {string} token - tenant_access_token
 * @param {string} folderToken - 目标文件夹token
 * @param {string} docName - 文件名
 * @param {string} jsonStr - JSON字符串
 */
async function uploadJsonToFolder(token,folderToken,docName,jsonStr){
  // 清理云端旧文件(同名)
  try{
    const olds=(await feishuListFiles(token,folderToken)||[]).filter(f=>f.name===docName);
    for(const f of olds){
      await httpFetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
    }
  }catch(e){console.warn('清理云端旧文件跳过',e);}
  // 上传新文件,支持重试
  let lastErr;
  for(let attempt=0;attempt<3;attempt++){
    try{
      const blob=new Blob([jsonStr],{type:'application/json'});
      const upData=await httpUploadFile({token,fileName:docName,folderToken,blob});
      if(upData.code!==0&&upData.code!==undefined)throw new Error(upData.msg||'上传失败');
      return true;
    }catch(e){
      lastErr=e;
      console.warn('上传失败,重试'+(attempt+1)+'/3:',e.message);
      if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));
    }
  }
  throw lastErr;
}

/**
 * 从飞书指定文件夹下载JSON - 底层通用函数(V5.3)
 * @param {string} token - tenant_access_token
 * @param {string} folderToken - 目标文件夹token
 * @param {string} docName - 文件名
 */
async function downloadJsonFromFolder(token,folderToken,docName){
  const files=await feishuListFiles(token,folderToken);
  if(!files)throw new Error('获取文件列表失败');
  // V5.3.2防御性修复: 产物区可能存在同名多档(历史同步缺陷遗留),
  // 飞书列表接口不保证返回顺序, find取首个会不确定地命中旧档;
  // 改为取 modified_time 最新一份, 与"保留最新"的清理约定一致
  const matches=files.filter(f=>f.name===docName);
  if(!matches.length)return null;
  const target=matches.reduce((a,b)=>((parseInt(b.modified_time||0,10)||0)>(parseInt(a.modified_time||0,10)||0)?b:a));
  // 统一的健壮JSON解析: 兼容 原生插件自动解析对象 / 字符串(含UTF-8 BOM) / ArrayBuffer(二进制流按UTF-8解码)
  // 修复: 中文JSON经原生HTTP下载后字符串错乱/解析失败被误报为"云端无数据"
  const robustParse=(raw)=>{
    if(raw==null)return null;
    if(typeof raw==='object'&&!(raw instanceof ArrayBuffer)&&!(raw instanceof Uint8Array))return raw;
    let text=raw;
    if(raw instanceof ArrayBuffer||raw instanceof Uint8Array)text=new TextDecoder('utf-8').decode(raw);
    if(typeof text!=='string')return null;
    if(text.charCodeAt(0)===0xFEFF)text=text.slice(1);// 去BOM
    text=text.replace(/^\uFEFF/,'').trim();
    if(!text)return null;
    return JSON.parse(text);
  };
  // 原生HTTP下载
  // V10.9.0: 增加timeout:120秒——视频分离上传后JSON虽已轻量化,但弱网下仍需防无限挂起
  if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
    return await new Promise((resolve,reject)=>{
      window.cordova.plugin.http.sendRequest(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`,{method:'GET',headers:{Authorization:'Bearer '+token},responseType:'text',timeout:120},res=>{
        try{resolve(robustParse(res.data));}catch(e){reject(new Error('数据解析失败(编码异常): '+e.message));}
      },err=>{
        const msg=String(err.error||'下载失败');
        reject(new Error(msg.includes('timeout')||msg.includes('timed out')?'数据下载超时(120s),请检查网络后重试':msg));
      });
    });
  }
  // V10.9.0: fetch路径增加AbortController超时——浏览器fetch默认无超时,弱网下可能永久挂起
  // V10.15.10: 改用fetchSignalSafe垫片(signal跨realm兼容,超时语义不变)
  try{
    const dlRes=await fetchSignalSafe(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`,{headers:{Authorization:'Bearer '+token}},120000);
    if(!dlRes.ok)throw new Error('下载HTTP '+dlRes.status);
    const dlText=await dlRes.text();
    return robustParse(dlText);
  }catch(e){
    if(e.name==='AbortError')throw new Error('数据下载超时(120s),请检查网络后重试');
    throw e;
  }
}

/**
 * 上传JSON到"APP数据备份"指定分类子文件夹 - V5.7数据分仓
 * @param {string} token - tenant_access_token
 * @param {string} docName - 文件名
 * @param {string} jsonStr - JSON字符串
 * @param {string} [subName] - 分类子文件夹名(注册申请/审批结果/同步数据/备份文件),空=数据区根
 * @returns {Promise<boolean>} 是否成功
 */
async function uploadJsonToDataFeishu(token,docName,jsonStr,subName){
  let folderToken=subName?await getDataSubFolderToken(token,subName):await getDataFolderToken(token);
  if(!folderToken)throw new Error('数据文件夹不可用');
  try{
    return await uploadJsonToFolder(token,folderToken,docName,jsonStr);
  }catch(e){
    // V5.7自愈: 缓存token失效(换应用/文件夹重建)时清缓存重试一次
    console.warn('上传失败,失效缓存重试:',e.message);
    invalidateDataFolderCache();
    folderToken=subName?await getDataSubFolderToken(token,subName):await getDataFolderToken(token,true);
    if(!folderToken)throw new Error('数据文件夹不可用');
    return await uploadJsonToFolder(token,folderToken,docName,jsonStr);
  }
}

/**
 * 从"APP数据备份"指定分类子文件夹下载JSON - V5.7数据分仓
 * @param {string} token - tenant_access_token
 * @param {string} docName - 文件名
 * @param {string} [subName] - 分类子文件夹名,空=数据区根
 * @returns {Promise<Object|null>} 解析后JSON,未找到返回null
 */
async function downloadJsonFromDataFeishu(token,docName,subName){
  let folderToken=subName?await getDataSubFolderToken(token,subName):await getDataFolderToken(token);
  if(!folderToken)throw new Error('数据文件夹不可用');
  try{
    return await downloadJsonFromFolder(token,folderToken,docName);
  }catch(e){
    console.warn('下载失败,失效缓存重试:',e.message);
    invalidateDataFolderCache();
    folderToken=subName?await getDataSubFolderToken(token,subName):await getDataFolderToken(token,true);
    if(!folderToken)throw new Error('数据文件夹不可用');
    return await downloadJsonFromFolder(token,folderToken,docName);
  }
}

/* ===================== V10.15.6 账号级字段选项云同步 =====================
 * 遗留风险#3(V10.15.5): 字段选项(断电位置/钥匙处理方式/断电步骤)用户增删改
 * 仅持久化到 localStorage['tcg_field_options'], 换机/重装后不共享。
 * 方案: 走飞书「偏好设置」子目录 field_options.json, 组长端增删改后自动上传,
 *       组长/组员登录或拉取数据时下载覆盖本地——账号级共享, 跨设备闭环。
 * 权限: 仅组长(admin)上传; 全员可下载(只读,组员端本就不展示编辑入口)。
 * 文件: {type:'field_options', appVersion, updatedBy, updatedAt,
 *        options:{position[],keyframe[],keycontainer[],step[]}} (快照式全量)。 */
const FIELD_OPTION_CLOUD_FILE='field_options.json';

/**
 * 上传字段选项到飞书「偏好设置」子目录(V10.15.6)
 * 仅组长且已登录、字段选项已初始化时上传; 失败静默(数据保留本地,下次改动重试)。
 * @returns {Promise<boolean>} 是否成功
 */
async function uploadFieldOptionsToFeishu(){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return false;
  // 仅组长上传; state未初始化(未登录)视为不可上传
  if(typeof state==='undefined'||!state.currentUser||state.currentUser.role!=='admin')return false;
  if(typeof FIELD_OPTIONS==='undefined'||!FIELD_OPTIONS)return false; // 尚未初始化
  try{
    const token=await getFeishuToken(cfg,2);
    const payload={
      type:'field_options',
      appVersion:'v'+APP_VERSION,
      updatedBy:(state.currentUser&&state.currentUser.name)||'组长',
      updatedAt:new Date().toISOString(),
      options:JSON.parse(JSON.stringify(FIELD_OPTIONS))
    };
    await uploadJsonToDataFeishu(token,FIELD_OPTION_CLOUD_FILE,JSON.stringify(payload,null,2),cfg.prefSub);
    console.log('[字段选项云同步] 已上传:',cfg.prefSub+'/'+FIELD_OPTION_CLOUD_FILE);
    return true;
  }catch(err){
    console.warn('[字段选项云同步] 上传失败(保留本地):',err&&err.message);
    return false;
  }
}

/**
 * 下载字段选项(飞书「偏好设置」子目录, V10.15.6)
 * 未找到/格式非法返回 null; 网络失败返回 null(不抛异常, 静默降级)。
 * @returns {Promise<Object|null>} options:{position[],keyframe[],keycontainer[],step[]} 或 null
 */
async function downloadFieldOptionsFromFeishu(){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return null;
  try{
    const token=await getFeishuToken(cfg,2);
    const data=await downloadJsonFromDataFeishu(token,FIELD_OPTION_CLOUD_FILE,cfg.prefSub);
    if(!data||data.type!=='field_options'||!data.options||typeof data.options!=='object')return null;
    return data.options;
  }catch(err){
    console.debug('[字段选项云同步] 云端无数据/拉取失败:',err&&err.message);
    return null;
  }
}

/**
 * 从云端拉取字段选项并应用到本地(V10.15.6)
 * 登录/会话恢复/同步拉取共用: 成功则覆盖本地自定义层(账号级共享), 无数据则静默保持现状。
 * @returns {Promise<boolean>} 是否成功应用
 */
async function syncFieldOptionsFromCloud(){
  const opts=await downloadFieldOptionsFromFeishu();
  if(opts&&typeof applyCloudFieldOptions==='function'){
    applyCloudFieldOptions(opts);
    console.log('[字段选项云同步] 已应用云端字段选项');
    return true;
  }
  return false;
}

/**
 * 上传JSON到飞书(项目根目录,兼容旧调用) - 增强版: 支持重试和旧文件清理
 * @param {Object} cfg - 飞书配置
 * @param {string} docName - 文件名
 * @param {string} jsonStr - JSON字符串
 * @returns {Promise<boolean>} 是否成功
 */
async function uploadJsonToFeishu(cfg,docName,jsonStr){
  const token=await getFeishuToken(cfg,2);
  return uploadJsonToFolder(token,cfg.folder,docName,jsonStr);
}

/**
 * 从飞书下载JSON(项目根目录,兼容旧调用) - 增强版: 支持重试
 * @param {Object} cfg - 飞书配置
 * @param {string} docName - 文件名
 * @returns {Promise<Object|null>} 解析后的JSON对象
 */
async function downloadJsonFromFeishu(cfg,docName){
  const token=await getFeishuToken(cfg,2);
  let lastErr;
  for(let attempt=0;attempt<3;attempt++){
    try{
      return await downloadJsonFromFolder(token,cfg.folder,docName);
    }catch(e){
      lastErr=e;
      console.warn('下载失败,重试'+(attempt+1)+'/3:',e.message);
      if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));
    }
  }
  throw lastErr;
}

/**
 * 下载同步数据(带位置迁移兼容) - V5.7数据分仓版
 * 读取优先级: ①"APP数据备份/同步数据"(V5.7新位置) ②"APP数据备份"根(V5.3.4-5.6)
 *           ③项目根目录(V5.3.3及更早历史位置)
 * 任何年代的云端数据都能读到,升级用户无感迁移
 * @param {Object} cfg - 飞书配置
 * @returns {Promise<Object|null>} 同步数据JSON,各处均无返回null
 */
async function downloadSyncDataMigrated(cfg){
  const token=await getFeishuToken(cfg,2);
  let lastErr;
  for(let attempt=0;attempt<3;attempt++){
    try{
      let data=null;
      try{
        data=await downloadJsonFromDataFeishu(token,'vehicle_sync_data.json',cfg.syncSub);
      }catch(e){console.warn('新位置(同步数据/)读取失败,回退:',e.message);}
      if(!data){
        try{data=await downloadJsonFromDataFeishu(token,'vehicle_sync_data.json');}catch(e){console.debug('[SyncDownload]旧位置vehicle_sync_data.json不存在(回退):',e.message)}
      }
      if(!data)data=await downloadJsonFromFolder(token,cfg.folder,'vehicle_sync_data.json');
      return data;
    }catch(e){
      lastErr=e;
      console.warn('同步数据下载失败,重试'+(attempt+1)+'/3:',e.message);
      if(attempt<2)await new Promise(r=>setTimeout(r,1500*(attempt+1)));
    }
  }
  throw lastErr;
}

/* ===================== V10.6.0 问题4: 车辆照片分离上传 =====================
 * 根因: 组长本地新增车辆时,现场拍摄的照片以base64 dataURL存于photoPaths。
 *   旧版doSyncUpload把整个VEHICLES(含数MB/张的base64)直接JSON化上传——
 *   ①单张照片2-5MB,两三张即让JSON膨胀到10MB+,飞书上传超时/失败,
 *     表现为"新增数据无法同步到飞书";
 *   ②即使侥幸传成功,组员拉取的JSON也巨大无比,下载解析缓慢易断。
 * 方案: 上传前把dataURL照片分离——降采样归一为JPEG→单独上传至云端
 *   "APP数据备份/vehicle_images"目录→photoPaths原位替换为云端相对路径
 *   (与内置数据同构)→JSON只含轻量路径。组员拉取后走既有
 *   imgFromFeishuCloud展示链,照片自然可见,数据闭环。
 * 幂等: 文件名=车辆id+序号+内容哈希,重复上传命中云端同名文件即跳过,
 *   不产生冗余副本;本地photoPaths同步替换并持久化,二次上传零流量。 */

/** djb2字符串哈希(文件名去重标识,非安全用途) */
function _strHashDjb2(str){
  let h=5381;
  for(let i=0;i<str.length;i++){h=((h<<5)+h+str.charCodeAt(i))>>>0;}
  return h;
}

/**
 * 照片上传前归一化: 任意格式dataURL→长边≤maxEdge的JPEG dataURL
 * 统一JPEG既控制体积(原图2-5MB→约150-300KB),又规避飞书对webp的兼容问题
 * @param {string} dataUrl - 原始照片dataURL
 * @param {number} [maxEdge=1280] - 长边像素上限
 * @returns {Promise<string>} JPEG dataURL,失败时原样返回
 */
async function _normalizePhotoForUpload(dataUrl,maxEdge){
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=dataUrl;});
    const limit=maxEdge||1280;
    const scale=Math.min(limit/Math.max(img.width,1),limit/Math.max(img.height,1),1);
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(img.width*scale));
    c.height=Math.max(1,Math.round(img.height*scale));
    c.getContext('2d').drawImage(img,0,0,c.width,c.height);
    return c.toDataURL('image/jpeg',0.85);
  }catch(e){
    console.warn('[同步]照片归一化失败,原样上传:',e.message||e);
    return dataUrl;
  }
}

/**
 * 分离上传全部车辆中的base64照片至飞书vehicle_images目录
 * 上传成功的照片其photoPaths原位替换为'vehicle_images/文件名'(与内置数据同构)
 * @param {string} token - tenant_access_token
 * @param {Array} vehicles - 车辆数组(原地修改photoPaths)
 * @returns {Promise<{replaced:number,failed:number,skipped:number}>} 统计
 */
async function syncUploadVehiclePhotos(token,vehicles){
  const stat={replaced:0,failed:0,skipped:0};
  // 预检: 是否存在待上传的base64照片(无则零开销直通)
  const pending=[];
  vehicles.forEach(v=>{
    (v.photoPaths||[]).forEach((p,i)=>{
      if(/^data:image\//i.test(p))pending.push({v,i});
    });
  });
  if(!pending.length)return stat;
  const folder=await getDataSubFolderToken(token,'vehicle_images');
  if(!folder)throw new Error('vehicle_images目录不可用');
  // 云端已有文件清单(幂等判定: 同名即已上传过,跳过)
  let cloudNames=new Set();
  try{
    (await feishuListFiles(token,folder)||[]).filter(f=>f.type==='file').forEach(f=>cloudNames.add(f.name));
  }catch(e){console.warn('[SyncUpload]vehicle_images云端列表API失败(全部降级为重传,幂等兜底):',e.message,e.stack)}
  for(const {v,i} of pending){
    const raw=v.photoPaths[i];
    try{
      const norm=await _normalizePhotoForUpload(raw,1280);
      const mm=/^data:image\/(png|jpe?g|webp);base64,(.*)$/.exec(norm);
      if(!mm){stat.failed++;continue;}
      const hash=_strHashDjb2(mm[2]).toString(16);
      const fileName=`user_v${v.id}_p${i+1}_${hash}.jpeg`;
      if(cloudNames.has(fileName)){
        stat.skipped++; // 云端已有同内容照片,仅替换本地路径
      }else{
        const u8=_b64ToU8(mm[2]);
        const blob=new Blob([u8],{type:'image/jpeg'});
        // V10.10.0: 智能路由(小文件upload_all/超限自动分片),文件名先清洗
        const up=await httpUploadFileSmart({token,fileName:_sanitizeFeishuFileName(fileName),folderToken:folder,blob});
        if(up&&up.code!==0&&up.code!==undefined){throw new Error(up.msg||'照片上传失败');}
        cloudNames.add(fileName);
      }
      v.photoPaths[i]='vehicle_images/'+fileName;
      stat.replaced++;
    }catch(e){
      stat.failed++;
      console.warn('[同步]照片上传失败(保留本地base64,下轮重试):',e.message||e);
    }
  }
  console.log(`[同步]照片分离上传完成: 替换${stat.replaced} 跳过${stat.skipped} 失败${stat.failed}`);
  return stat;
}

/**
 * V10.9.0 问题1: 车辆视频分离上传——与照片分离上传同构
 * 根因: V10.6.0仅分离了照片(base64→云端路径),视频仍以data:video/;base64,留在videoPaths。
 *   单段现场拍摄视频base64编码后常达10-50MB,JSON膨胀至数十MB——
 *   ①飞书upload_all虽能传(V10.8.0 multipart修复),但生成的JSON文件巨大,
 *     组员端download接口下载超时/内存溢出,表现为"收到通知但拉取失败";
 *   ②即使侥幸下载成功,JSON.parse在移动端WebView内存受限下直接OOM崩溃。
 * 方案: 上传前把data:video base64分离——直接转Blob→单独上传至云端
 *   "APP数据备份/vehicle_videos"目录→videoPaths原位替换为云端相对路径
 *   (与内置数据同构)→JSON只含轻量路径。组员拉取后走既有视频展示链。
 * 幂等: 文件名=车辆id+序号+内容哈希,重复上传命中云端同名文件即跳过,
 *   不产生冗余副本;本地videoPaths同步替换并持久化,二次上传零流量。
 * @param {string} token - tenant_access_token
 * @param {Array} vehicles - 车辆数组(原地修改videoPaths)
 * @returns {Promise<{replaced:number,failed:number,skipped:number}>} 统计
 */
async function syncUploadVehicleVideos(token,vehicles){
  const stat={replaced:0,failed:0,skipped:0};
  // 预检: 是否存在待上传的base64视频(无则零开销直通)
  const pending=[];
  vehicles.forEach(v=>{
    (v.videoPaths||[]).forEach((p,i)=>{
      if(/^data:video\//i.test(p))pending.push({v,i});
    });
  });
  if(!pending.length)return stat;
  // V10.9.0: vehicle_videos目录(与vehicle_images并列,数据分仓)
  const folder=await getDataSubFolderToken(token,'vehicle_videos');
  if(!folder)throw new Error('vehicle_videos目录不可用');
  // 云端已有文件清单(幂等判定: 同名即已上传过,跳过)
  let cloudNames=new Set();
  try{
    (await feishuListFiles(token,folder)||[]).filter(f=>f.type==='file').forEach(f=>cloudNames.add(f.name));
  }catch(e){console.warn('[SyncUpload]vehicle_videos云端列表API失败(全部降级为重传,幂等兜底):',e.message,e.stack)}
  for(const {v,i} of pending){
    const raw=v.videoPaths[i];
    try{
      // data:video/mp4;base64,XXXX → 提取MIME和base64数据
      const mm=/^data:video\/([a-z0-9]+);base64,(.*)$/i.exec(raw);
      if(!mm){stat.failed++;continue;}
      const mime=mm[1].toLowerCase();
      const b64=mm[2];
      const hash=_strHashDjb2(b64).toString(16);
      // 文件名: user_v{id}_v{序号}_{hash}.mp4(统一mp4扩展名,飞书按MIME识别)
      const fileName=`user_v${v.id}_v${i+1}_${hash}.mp4`;
      if(cloudNames.has(fileName)){
        stat.skipped++; // 云端已有同内容视频,仅替换本地路径
      }else{
        const u8=_b64ToU8(b64);
        const blob=new Blob([u8],{type:'video/'+mime});
        /* V10.10.0 根因修复: >16MB视频走飞书官方分片上传三件套。
         * 旧版一律upload_all→>20MB必败(1061043)→base64滞留→整条同步管线中断。 */
        if(blob.size>FEISHU_MULTIPART_THRESHOLD){
          showToast(`大视频分片上传中(${(blob.size/1048576).toFixed(0)}MB)...`);
        }
        const up=await httpUploadFileSmart({token,fileName:_sanitizeFeishuFileName(fileName),folderToken:folder,blob,
          onProgress:(done,total)=>{if(total>1)showToast(`视频分片上传 ${done}/${total}...`);}});
        if(up&&up.code!==0&&up.code!==undefined){throw new Error(up.msg||'视频上传失败');}
        cloudNames.add(fileName);
      }
      v.videoPaths[i]='vehicle_videos/'+fileName;
      stat.replaced++;
    }catch(e){
      stat.failed++;
      console.warn('[同步]视频上传失败(保留本地base64,下轮重试):',e.message||e);
    }
  }
  console.log(`[同步]视频分离上传完成: 替换${stat.replaced} 跳过${stat.skipped} 失败${stat.failed}`);
  return stat;
}

/**
 * V10.7.0问题2+V10.9.0问题1: 同步上传核心管线(手动上传按钮/保存后自动触发共用)
 * 管线八步: ①取token ②照片分离上传(降采样→vehicle_images→路径原位替换)
 *   ②b.视频分离上传(base64→vehicle_videos→路径原位替换)  [V10.9.0新增]
 *   ③本地持久化对齐 ④车型JSON上传(同步数据/) ⑤历史旧档迁移清理
 *   ⑥数据更新通知落云(组员端轻量感知通道) ⑦本地同步水位更新
 * 抽取动机: 旧版doSyncUpload把全部逻辑内联在确认框回调里,自动同步机制(问题2)
 *   需要复用同一管线,复制粘贴会产生两份漂移风险——重构为单一事实源。
 * @returns {Promise<{ok:boolean,vehicles:number,photos:number,version:string,msg?:string}>}
 */
async function _syncUploadPipeline(){
  /* V10.14.1 修复【上传管线配置出口统一】: 原直读 localStorage 绕过注入秘钥闭包缓存,
   * 组长端未在设置页手动保存过配置时(依赖构建注入凭据)被 feishuCfgReady 恒拦截,
   * "飞书配置不完整"→数据无法上云。改走 getFeishuCfg() 统一出口(含全部子目录字段
   * syncSub/pendingSub/approvedSub/backupSub,V10.10.0 根因修复②语义保留)。 */
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg,true))return {ok:false,msg:'飞书配置不完整: 请在设置中填写 App Secret'}; // V5.3.4: appId+appSecret双查
  const token=await getFeishuToken(cfg,2);
  /* V10.6.0 问题4: 照片分离上传——先把现场拍照(base64)单独传至
   * vehicle_images目录并替换为云端路径,再写JSON。
   * 旧版把数MB级base64直接塞进JSON导致上传必败,此为"新增数据
   * 无法同步到飞书"的直接根因。 */
  const photoStat=await syncUploadVehiclePhotos(token,VEHICLES);
  /* V10.9.0 问题1: 视频分离上传——与照片同构,把base64视频单独传至
   * vehicle_videos目录并替换为云端路径,再写JSON。
   * 根因: 视频base64(10-50MB)留在JSON中导致组员端下载超时/OOM失败。 */
  const videoStat=await syncUploadVehicleVideos(token,VEHICLES);
  if(photoStat.replaced>0||videoStat.replaced>0){
    persistVehicles(); // 本地路径与云端对齐后立即持久化,重启不回退
    renderVehicleList();
  }
  const syncData={
    version:'v'+APP_VERSION,
    timestamp:new Date().toISOString(),
    uploadedBy:state.currentUser?state.currentUser.name:'unknown',
    vehicleCount:VEHICLES.length,
    // V10.6.0: 补齐size/brandId字段——旧版漏传导致同步后车辆尺寸/品牌索引丢失
    vehicles:VEHICLES.map(v=>({id:v.id,brandId:v.brandId,brand:v.brand,series:v.series,config:v.config,display:v.display,size:v.size||'',powerType:v.powerType,position:v.position,steps:v.steps,keyFrame:v.keyFrame,keyContainer:v.keyContainer,remarks:v.remarks,photos:v.photos,photoPaths:v.photoPaths,photoSections:v.photoSections,photoLabels:v.photoLabels,keyPhotoRemark:v.keyPhotoRemark,videos:v.videos,videoPaths:v.videoPaths}))
  };
  /* V10.10.0 守卫: JSON体积预检——媒体分离后JSON应<1MB;若仍>16MB说明
   * 有base64媒体分离失败滞留,直接诊断性失败,避免把巨大JSON推上云端
   * 导致组员端下载超时(旧版静默上传→组员必败的隐性故障链)。 */
  const _jsonStr=JSON.stringify(syncData);
  const _pendingMedia=VEHICLES.reduce((n,v)=>n+((v.photoPaths||[]).filter(p=>/^data:/i.test(p)).length)+((v.videoPaths||[]).filter(p=>/^data:/i.test(p)).length),0);
  if(_jsonStr.length>FEISHU_MULTIPART_THRESHOLD){
    const msg=`同步数据异常过大(${(_jsonStr.length/1048576).toFixed(1)}MB,残留媒体${_pendingMedia}项),请检查媒体上传失败项后重试`;
    addSyncLog('[同步]'+msg,'red');
    // V10.10.0: 诊断性失败也携带媒体失败计数,调用方可定位具体失败项
    return {ok:false,msg,photoFailed:photoStat.failed,videoFailed:videoStat.failed,pendingMedia:_pendingMedia};
  }
  // V5.7: 同步数据统一存入"APP数据备份/同步数据"子文件夹(数据分仓),
  // 项目根目录与数据区根目录均不再存放,历史旧档同步清理
  // (token已在函数顶部获取,照片分离上传与数据上传共用同一会话)
  await uploadJsonToDataFeishu(token,'vehicle_sync_data.json',_jsonStr,cfg.syncSub);
  // 迁移清理: 删除数据区根/项目根目录历史同名旧档,防止多份数据漂移导致读到旧数据
  try{
    const dataRoot=await getDataFolderToken(token);
    const dataOlds=(await feishuListFiles(token,dataRoot)||[]).filter(f=>f.type==='file'&&f.name==='vehicle_sync_data.json');
    for(const f of dataOlds){
      await httpFetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
    }
  }catch(e){console.warn('数据区旧档清理跳过:',e.message);}
  try{
    const rootOlds=(await feishuListFiles(token,cfg.folder)||[]).filter(f=>f.type==='file'&&f.name==='vehicle_sync_data.json');
    for(const f of rootOlds){
      await httpFetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`,{method:'DELETE',headers:{Authorization:'Bearer '+token}});
    }
  }catch(e){console.warn('历史根目录旧档清理跳过:',e.message);}
  /* V10.7.0 问题2: 数据更新通知落云——上传成功后写轻量notice文件(数百字节),
   * 组员端60秒轻轮询只下载该文件即可感知"组长已更新数据",不必拉取数MB级
   * 全量车型JSON。这是"上传成功后飞书同步通知组员账号更新数据"的云端通道;
   * 写入失败仅降级组员感知速度(红点5分钟节流全量比对仍在),不影响数据本体。 */
  try{
    const notice={type:'data_update_notice',version:syncData.version,timestamp:syncData.timestamp,vehicleCount:syncData.vehicleCount,uploadedBy:syncData.uploadedBy,photoCount:photoStat.replaced,videoCount:videoStat.replaced};
    await uploadJsonToDataFeishu(token,'data_update_notice.json',JSON.stringify(notice),cfg.syncSub);
  }catch(e){console.warn('[同步]数据更新通知写入失败(组员感知退化为全量比对):',e.message);}
  localStorage.setItem('feishu_sync_data',JSON.stringify({vehicleCount:syncData.vehicleCount,version:syncData.version,timestamp:syncData.timestamp}));
  /* V10.10.0: 返回媒体失败计数——调用方(手动按钮/自动同步)可据此提示
   * "部分媒体未上云,下轮自动重试",不再静默吞掉部分失败。 */
  return {ok:true,vehicles:VEHICLES.length,photos:photoStat.replaced,videos:videoStat.replaced,
    photoFailed:photoStat.failed,videoFailed:videoStat.failed,pendingMedia:_pendingMedia,version:syncData.version};
}

function doSyncUpload(){
  if(!canEdit()){showToast('组员无上传权限，请使用"从飞书获取数据"');return;}
  showConfirm('确认上传','上传将覆盖飞书云端现有数据，请先确认已备份。',async()=>{
    showToast('正在连接飞书...');
    try{
      const r=await _syncUploadPipeline();
      if(!r.ok)throw new Error(r.msg||'同步失败');
      // V10.6.0+V10.9.0: 提示含照片/视频上传统计,组长可感知分离上传结果
      const mediaParts=[];
      if(r.photos>0)mediaParts.push(`照片${r.photos}张`);
      if(r.videos>0)mediaParts.push(`视频${r.videos}段`);
      const mediaStr=mediaParts.length?'，'+mediaParts.join(''):'';
      showToast(`数据已同步至飞书，共${r.vehicles}条车型数据${mediaStr}`);
      addSyncLog(`上传同步完成 · ${r.vehicles}条车型数据${mediaStr} · 飞书`,'green');
      // V10.3 问题5.2: 上传成功即消化红点提示(本地即云端最新版)
      _setSyncNewDot(false);
      const cv=document.getElementById('sync-cloud-ver');
      if(cv)cv.textContent='已连接 · v'+APP_VERSION+' (最新)';
      const ss=document.getElementById('sync-status-text');
      if(ss){ss.className='text-base font-bold text-green-600 flex items-center gap-2 mt-1';ss.innerHTML='<span class="w-2 h-2 rounded-full bg-green-500 pulse"></span>已同步';}
    }catch(err){
      showToast('同步失败: '+err.message);
      addSyncLog('同步失败: '+err.message,'red');
    }
  });
}

/**
 * V10.7.0 问题2: 新数据自动同步机制(核心新增)
 * 需求原文: "检测到应用端新数据上传，新数据的照片视频按照现有的方案进行处理和
 * 匹配后上传到飞书。上传成功后飞书同步通知组员账号更新数据。"
 * 触发: 组长在车型编辑页保存(新增/编辑,含现场拍照/视频)后调度;
 *   8秒防抖窗口内多次保存合并为一次全量管线执行,管线运行中不重入。
 * 检测: 扫描全部车辆中尚未上云的base64媒体(data:image://data:video:前缀),
 *   检出才真正执行——纯文字编辑不惊动云端。
 * 管线: 复用_syncUploadPipeline(照片降采样归一→vehicle_images分离上传→路径
 *   匹配替换→车型JSON上传→通知文件落云),与手动上传完全同构零分叉。
 * 权限: 仅组长;飞书未配置时静默跳过(不打扰组员端保存)。
 * 失败: 明确toast告知且数据保留本地,下次保存或手动上传自动重试。
 */
let _autoSyncBusy=false;
let _autoSyncTimer=null;
const AUTO_SYNC_DEBOUNCE_MS=8000;

/** 检测本地尚未上云的base64媒体(照片走分离上传,视频按现有方案随JSON) */
function detectPendingLocalMedia(){
  const stat={photos:0,videos:0};
  VEHICLES.forEach(v=>{
    (v.photoPaths||[]).forEach(p=>{if(/^data:image\//i.test(p))stat.photos++;});
    (v.videoPaths||[]).forEach(p=>{if(/^data:video\//i.test(p))stat.videos++;});
  });
  return stat;
}

/** 保存车型后调度自动同步(防抖合并) */
function scheduleAutoSyncAfterSave(){
  if(!canEdit())return;                        // 组员端无上传权限,不触发
  if(!feishuCfgReady(getFeishuCfg()))return;   // 飞书未配置: 静默跳过
  if(_autoSyncBusy)return;                     // 管线执行中: 本轮不叠加
  if(_autoSyncTimer)clearTimeout(_autoSyncTimer);
  _autoSyncTimer=setTimeout(_runAutoSyncAfterSave,AUTO_SYNC_DEBOUNCE_MS);
}

/** 自动同步执行体(由防抖定时器触发) */
async function _runAutoSyncAfterSave(){
  _autoSyncTimer=null;
  if(_autoSyncBusy||!canEdit())return;
  const pending=detectPendingLocalMedia();
  if(!pending.photos&&!pending.videos)return;  // 无待上云媒体: 纯文字编辑,不惊动云端
  _autoSyncBusy=true;
  try{
    showToast(`检测到新增照片/视频共${pending.photos+pending.videos}项，正在自动同步到飞书...`);
    addSyncLog(`检测到本地新数据(${pending.photos}照片/${pending.videos}视频)，自动同步开始`,'blue');
    const r=await _syncUploadPipeline();
    if(!r.ok)throw new Error(r.msg||'自动同步失败');
    showToast(`✅ 新数据已自动同步飞书(${r.vehicles}条${r.photos>0?'，照片'+r.photos+'张':''})，已通知组员更新`);
    addSyncLog(`新数据自动同步完成 · ${r.vehicles}条 · 照片${r.photos}张 · 已通知组员更新`,'green');
    _setSyncNewDot(false);
    const cv=document.getElementById('sync-cloud-ver');
    if(cv)cv.textContent='已连接 · v'+APP_VERSION+' (最新)';
  }catch(err){
    console.warn('[自动同步]失败(数据保留本地,下次保存/手动上传重试):',err.message);
    showToast('自动同步失败: '+err.message+'（数据已保留本地）');
    addSyncLog('新数据自动同步失败 · '+err.message+' · 数据保留本地','red');
  }finally{
    _autoSyncBusy=false;
  }
}

/**
 * 【为什么采用 timestamp + ID集合差集 双通道镜像决策】
 *  单看 timestamp>lastSyncTs 在 3 类真机场景会漏掉镜像:
 *   ①同秒操作: 组长 14:00:03 上传,同时(秒级内)删除一台车+修改一台车,
 *     组员 14:00:05 首次拉取, lastSyncTs=0,正常同步; 但组员 14:00:04 已拉过(ts=0→3),
 *     下一轮 lastSyncTs=3,云端 ts=3,不触发同步,删除永远传播不到。
 *   ②时钟回拨: 组长 Android 设备时区漂移/连接NTP后时钟跳回 5s,
 *     新上传 timestamp 小于 lastSyncTs, 单 timestamp 判新会漏掉。
 *   ③新安装组员: 新安装的手机 VEHICLES 是空/默认内置,lastSyncTs=Date.now()(初始化时刻),
 *     但云端的「真实唯一ID全集」才是Ground Truth。
 *  V10.14.0 修复B: 在 timestamp> 之外 **OR** 增加 cloudIds 与 localIds
 *  全量 ID 字符串集合比较,只要 ID 集合不一样就强制镜像(added/updated/removed三计数)。
 *  ⚠️ 仍保留「云端为空 & 本地非空」熔断: 若组长上传中断导致云端 vehicle_sync_data.json=[]
 *  时跳过镜像,防止误清空组员本地已有数据。
 * @returns {Promise<{ok:boolean,msg?:string,added:number,updated:number,removed:number,skipped?:boolean}>}
 */
async function doSyncDownload(){
  /* V10.14.1 修复【组员拉取被配置门禁误拦】: 原直读 localStorage——组员端本地无
   * 保存配置时 appSecret 恒空,feishuCfgReady 拦截"飞书配置不完整",云端数据永远
   * 拉不下来(本次"组长组员数据无法同步"主根因)。改走 getFeishuCfg()(syncSub 等
   * 全部子目录字段随统一出口返回,V10.10.0 根因修复②语义保留)。 */
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg,true))return; // V5.3.4: appId+appSecret双查,缺失即引导填写(诊断根因1)
  showToast('正在从飞书获取数据...');
  try{
    const syncData=await downloadSyncDataMigrated(cfg); // V5.3.4: 新旧位置自动迁移读取(诊断根因6)
    if(syncData&&syncData.vehicles){
      /* V10.11.0 镜像同步(根因修复): 云端为唯一真源,拉取后本地与云端
       * 完全对齐——新增/更新/删除全量传播,保证组长组员车型数量一致。
       * 旧版只做正向合并(云端新增追加/同ID覆盖),反向差集(云端已删除的
       * 车型)永久滞留组员本地——下方localIds旧版声明后从未使用,即
       * "删除同步从未实现"的历史遗留证据。 */
      const cloudVehicles=syncData.vehicles;
      if(!cloudVehicles.length&&VEHICLES.length>0){
        /* 防御: 云端0条车但本地有数据,视为异常(正常组长库至少含内置
         * 车型,不可能为空),拒绝镜像防误清空本地 */
        showToast('云端同步数据为0条,已跳过合并以保护本地数据');
        addSyncLog('从飞书拉取异常 · 云端车辆数为0,拒绝镜像同步','red');
      }else{
        const cloudTs=new Date(syncData.timestamp||0).getTime();
        const localSyncTs=JSON.parse(localStorage.getItem('feishu_sync_data')||'{}');
        const lastSyncTs=localSyncTs.timestamp?new Date(localSyncTs.timestamp).getTime():0;
        /* V10.14.0 修复B【镜像同步双通道比对兜底】
         * 旧版仅 cloudTs>lastSyncTs 触发镜像,存在两处漏同步:
         *   ①组长手机/云端时钟回拨,云端timestamp小于本地已记录时间→永远跳过
         *   ②组长秒级连续两次上传(同一秒timestamp),删除传播无法被timestamp捕捉
         *   ③极端: 两台组长手机交替上传,ID集合不同但时间戳接近
         * 修复: 保留timestamp快路径(绝大多数流量优化场景),但增加
         *   ID集合不一致性检测——本地车辆ID集合与云端ID集合不相等时,
         *   忽略timestamp强制执行镜像对齐(删除传播必须保证)。
         *   判定复杂度O(n):只比ID集合不等(不计完全相同顺序),不产生额外流量开销。 */
        const cloudIdsArr = (cloudVehicles||[]).map(v => String(v.id));
        const localIdsArr = VEHICLES.map(v => String(v.id));
        const sameIds = cloudIdsArr.length === localIdsArr.length &&
          cloudIdsArr.every(id => localIdsArr.includes(id));
        const needMirror = (cloudTs > lastSyncTs) || !sameIds;
        if(needMirror){
          /* 云端有更新: 执行完整镜像对齐(仅在有更新时执行,避免云端无
           * 变化时误删组员本地导入的备份数据) */
          const localIds=new Set(VEHICLES.map(v=>v.id));
          const cloudIds=new Set(cloudVehicles.map(v=>v.id));
          let addedCount=0,updatedCount=0,removedCount=0;
          // 正向差集: 云端权威字段覆盖,保留本地扩展字段
          const nextVehicles=cloudVehicles.map(sv=>{
            if(localIds.has(sv.id))updatedCount++;else addedCount++;
            const local=VEHICLES.find(x=>x.id===sv.id);
            const nv=Object.assign({},local,sv);
            nv.pinyin=getPinyin(sv.display);
            return nv;
          });
          // 反向差集: 本地存在但云端已删除 → 移除(删除传播核心)
          localIds.forEach(id=>{if(!cloudIds.has(id))removedCount++;});
          // 原地替换: VEHICLES为const引用,persistVehicles/渲染闭包均持此引用
          // A3状态守卫: 走State.replaceVehicles(语义同旧length=0+push)
          State.replaceVehicles(nextVehicles);
          const totalChanges=addedCount+updatedCount+removedCount;
          // V10.6.0 问题4: 拉取合并后立即持久化——组员端重启后仍保有最新数据
          if(totalChanges>0)persistVehicles();
          if(totalChanges>0){
            showToast(`数据同步完成: 新增${addedCount}条, 更新${updatedCount}条, 删除${removedCount}条 (${syncData.version||''})`);
            addSyncLog(`从飞书拉取完成 · 新增${addedCount}条 更新${updatedCount}条 删除${removedCount}条 · ${syncData.version||''}`,'green');
          }else{
            showToast(`数据已是最新 (${syncData.version||''})`);
            addSyncLog(`从飞书拉取完成 · 数据已是最新 · ${syncData.vehicleCount}条`,'green');
          }
        }else{
          showToast(`数据已是最新 (${syncData.version||''})`);
          addSyncLog(`从飞书拉取完成 · 数据已是最新 · ${syncData.vehicleCount}条`,'green');
        }
        localStorage.setItem('feishu_sync_data',JSON.stringify({vehicleCount:syncData.vehicleCount,version:syncData.version,timestamp:syncData.timestamp}));
        const ss=document.getElementById('sync-status-text');
        if(ss){ss.className='text-base font-bold text-green-600 flex items-center gap-2 mt-1';ss.innerHTML='<span class="w-2 h-2 rounded-full bg-green-500 pulse"></span>已同步';}
        const cv=document.getElementById('sync-cloud-ver');
        if(cv)cv.textContent='已连接 · '+(syncData.version||'v'+APP_VERSION)+' (最新)';
        // V10.3 问题5.2: 拉取成功即消化红点提示(本地已与云端对齐)
        _setSyncNewDot(false);
        renderBrandTags();
        renderVehicleList();
      }
    }else{
      showToast('飞书云端暂无同步数据，请等待组长上传');
      addSyncLog('从飞书拉取失败 · 云端无数据','red');
    }
    // V10.15.6 账号级字段选项云同步: 车辆镜像完成后顺带拉取云端选项, 保证
    // 组长增删改的断电位置/钥匙/步骤选项跨设备一致; 无数据/网络失败静默保持本地。
    if(typeof syncFieldOptionsFromCloud==='function'){syncFieldOptionsFromCloud();}
  }catch(err){
    showToast('从飞书获取数据失败: '+err.message);
    addSyncLog('从飞书拉取失败 · '+err.message,'red');
  }
}

function addSyncLog(msg,color){
  let logs=JSON.parse(localStorage.getItem('sync_logs')||'[]');
  logs.unshift({msg,color:color||'gray',time:new Date().toLocaleString('zh-CN')});
  logs=logs.slice(0,20);
  localStorage.setItem('sync_logs',JSON.stringify(logs));
  renderSyncLog();
}

/**
 * ===================== V10.3 问题5.2: 云端新数据红点通知 =====================
 * 需求: 组员端(及组长端)在云端有新数据时,通过红点/提示条感知并引导拉取。
 * 方案: 静默下载云端vehicle_sync_data.json的元数据,对比本地feishu_sync_data
 *       的timestamp——云端更新→数据中心/侧边菜单"数据同步"入口亮红点+
 *       同步中心顶部琥珀色提示条;拉取成功后红点自动消化。
 * 节流: 5分钟内不重复联网核查(登录/进数据页/进同步中心/resume多入口共用)。
 * 容错: 任一步失败静默跳过,红点状态保持原样——提示功能绝不阻塞主流程。
 */
let _cloudCheckBusy=false;
let _cloudCheckLastTs=0;
const CLOUD_CHECK_THROTTLE_MS=5*60*1000;

/**
 * 设置/清除"云端新数据"红点(全部入口+提示条联动)
 * @param {boolean} on - true=亮红点; false=清除
 */
function _setSyncNewDot(on){
  ['sync-new-dot','sync-new-dot-side'].forEach(id=>{
    const el=document.getElementById(id);
    if(el)el.classList.toggle('hidden',!on);
  });
  const hint=document.getElementById('sync-new-hint');
  if(hint)hint.classList.toggle('hidden',!on);
}

/**
 * 静默检查云端是否有新数据
 * @param {boolean} [force] - true=忽略节流立即检查(登录场景)
 * @returns {Promise<void>}
 */
async function checkCloudDataUpdate(force){
  if(!state.currentUser)return; // 未登录不检查
  const now=Date.now();
  if(!force&&now-_cloudCheckLastTs<CLOUD_CHECK_THROTTLE_MS)return; // 节流
  if(_cloudCheckBusy)return;
  _cloudCheckBusy=true;
  _cloudCheckLastTs=now;
  try{
    /* V10.14.1 修复【云端更新感知静默失效】: 原直读 localStorage——组员端本地无
     * 保存配置时恒被 feishuCfgReady 静默拦截,60秒轻量通知轮询形同虚设(红点永不
     * 亮)。改走 getFeishuCfg() 统一出口(syncSub 随之正确解析,V10.10.0 语义保留)。 */
    const cfg=getFeishuCfg();
    if(!feishuCfgReady(cfg))return; // 未配置同步:跳过
    /* V10.7.0 问题2: 组员端轻量感知通道——优先读云端"数据更新通知"文件
     * (data_update_notice.json,数百字节)。组长端上传成功后写入该文件,
     * 组员60秒轮询命中即感知"组长已更新数据",无需下载数MB级全量车型JSON。
     * 通知时间戳>本地水位→亮红点并直接返回;通知<=水位→同样直接返回(流量双省);
     * 通知文件不存在(老版本组长端上传/通知写入失败)→回退原全量比对逻辑,兼容完整。 */
    const local=JSON.parse(localStorage.getItem('feishu_sync_data')||'{}');
    const localTs=local.timestamp?new Date(local.timestamp).getTime():0;
    try{
      const noticeToken=await getFeishuToken(cfg,2);
      const notice=await downloadJsonFromDataFeishu(noticeToken,'data_update_notice.json',cfg.syncSub);
      if(notice&&notice.type==='data_update_notice'&&notice.timestamp){
        const noticeTs=new Date(notice.timestamp).getTime();
        if(noticeTs>localTs){
          _setSyncNewDot(true);
          const hint=document.getElementById('sync-new-hint-text');
          if(hint)hint.textContent='云端有新数据('+(notice.version||'新版本')+' · '+(notice.vehicleCount||'?')+'条，'+(notice.uploadedBy||'组长')+'已上传)，请拉取获取最新版本';
          const cv1=document.getElementById('sync-cloud-ver');
          if(cv1&&notice.version)cv1.textContent='有新数据 · '+notice.version;
          console.log('[同步] 通过更新通知感知到新数据:',notice.version,notice.timestamp);
        }else{
          _setSyncNewDot(false);
          const cv2=document.getElementById('sync-cloud-ver');
          if(cv2&&notice.version)cv2.textContent='已连接 · '+notice.version+' (最新)';
        }
        return; // 轻量通道已裁决: 不再下载全量JSON
      }
    }catch(e){console.warn('[同步] 更新通知读取失败,回退全量比对:',e&&e.message);}
    // 回退路径: 通知文件不可用(老版本组长上传的数据),维持原全量比对逻辑
    const syncData=await downloadSyncDataMigrated(cfg);
    if(!syncData||!syncData.timestamp)return; // 云端无数据:跳过
    const cloudTs=new Date(syncData.timestamp).getTime();
    const local2=JSON.parse(localStorage.getItem('feishu_sync_data')||'{}');
    const localTs2=local2.timestamp?new Date(local2.timestamp).getTime():0;
    const hasNew=cloudTs>localTs2;
    _setSyncNewDot(hasNew);
    // 顺带刷新同步中心的云端版本显示(拉取失败不改动)
    const cv=document.getElementById('sync-cloud-ver');
    if(cv&&syncData.version)cv.textContent=hasNew?'有新数据 · '+(syncData.version||''):'已连接 · '+(syncData.version||'')+(cloudTs<=localTs2?' (最新)':'');
    if(hasNew){
      const hint=document.getElementById('sync-new-hint-text');
      if(hint)hint.textContent='云端有新数据('+(syncData.version||'新版本')+' · '+(syncData.vehicleCount||'?')+'条),请拉取获取最新版本';
      console.log('[同步] 检测到云端新数据:',syncData.version,syncData.timestamp);
    }
  }catch(err){
    console.warn('[同步] 云端新数据检查失败(跳过):',err&&err.message);
  }finally{
    _cloudCheckBusy=false;
  }
}

function addBackupHistory(type,filename,count,size){
  let history=JSON.parse(localStorage.getItem('backup_history')||'[]');
  history.unshift({type,filename,count,size,time:new Date().toLocaleString('zh-CN')});
  history=history.slice(0,10);
  localStorage.setItem('backup_history',JSON.stringify(history));
  renderBackupHistory();
}

function renderBackupHistory(){
  const c=document.getElementById('backup-history');
  if(!c)return;
  let history=JSON.parse(localStorage.getItem('backup_history')||'[]');
  if(history.length===0){c.innerHTML='';return;}
  const sizeText=(s)=>s>=1048576?(s/1048576).toFixed(1)+'MB':s>=1024?(s/1024).toFixed(0)+'KB':s+'B';
  const typeText=(t)=>t==='local'?'本地':'飞书云';
  c.innerHTML='<div class="text-xs font-medium text-gray-500 mb-1.5">备份记录</div>'+
    history.map(h=>'<div class="flex items-center justify-between py-1.5 px-2 rounded-lg bg-gray-50 mb-1">'+
    '<div class="flex items-center gap-2">'+
    '<span class="text-xs '+(h.type==='local'?'text-blue-600':'text-green-600')+' font-medium">'+typeText(h.type)+'</span>'+
    '<span class="text-xs text-gray-400">'+h.count+'条</span>'+
    '<span class="text-xs text-gray-400">'+sizeText(h.size)+'</span></div>'+
    '<span class="text-xs text-gray-300">'+h.time+'</span></div>').join('');
}

/**
 * 导出同步配置 - V5.8对齐安装包命名方案
 * 对齐点: ①文件名 cloud_sync_config.json(APK同名,便于两端互认)
 *         ②payload顶层增加exportedAt字段 ③toast文案"导出配置已下载"
 * 保留: 车辆数据随行导出(本项目自V5.3以来的配置+数据一体备份习惯,向后兼容)
 */
async function exportSyncConfig(){
  /* V10.14.1 修复【导出配置值残缺】: 原直读 localStorage——组员端导出的 appId/folder
   * 可能为空或历史脏值。改走 getFeishuCfg()(导出 payload 本就不含 Secret,无泄密面);
   * interval 为用户偏好数字,保留 localStorage 回显语义。 */
  const cfg=getFeishuCfg();
  const saved=JSON.parse(localStorage.getItem('feishu_config')||'{}');
  const exportData={
    type:'sync_config_backup',
    exportedAt:new Date().toISOString(),
    version:'v'+APP_VERSION,
    timestamp:new Date().toISOString(),
    feishuConfig:{appId:cfg.appId,folder:cfg.folder,interval:saved.interval||cfg.interval},
    vehicleCount:VEHICLES.length,
    vehicles:VEHICLES.map(v=>({id:v.id,brand:v.brand,series:v.series,config:v.config,display:v.display,powerType:v.powerType,position:v.position,steps:v.steps,keyFrame:v.keyFrame,keyContainer:v.keyContainer,remarks:v.remarks,photos:v.photos,photoPaths:v.photoPaths,photoSections:v.photoSections,photoLabels:v.photoLabels,keyPhotoRemark:v.keyPhotoRemark,videos:v.videos,videoPaths:v.videoPaths}))
  };
  const blob=new Blob([JSON.stringify(exportData,null,2)],{type:'application/json'});
  // 对齐APK: 固定文件名 cloud_sync_config.json(两端互认),不传分享标题(回退文件名)
  const filename='cloud_sync_config.json';
  await shareFile(blob,filename,'application/json');
  showToast('导出配置已下载');
  addSyncLog(`配置导出完成 · ${VEHICLES.length}条 · ${filename}`,'blue');
}

/**
 * V10.9.1 问题3: 组员端导入备份——触发文件选择器
 * 权限: 组长/组员均可使用(本地数据恢复,不涉及上云,无需编辑权限)
 */
function triggerImportBackup(){
  const input=document.getElementById('import-backup-input');
  if(input){input.value='';input.click();}
}

/**
 * V10.9.1 问题3: 处理备份文件导入
 * 兼容格式:
 *   ① sync_config_backup(标准导出格式,含type/vehicles/version)
 *   ② vehicle_poweroff_backup(旧版备份格式)
 *   ③ 裸车辆数组(兜底兼容)
 * 策略: 智能合并——同ID覆盖,新增追加,导入前二次确认(防止误操作覆盖本地数据)
 * @param {HTMLInputElement} inputEl - 文件选择input元素
 */
async function handleImportBackup(inputEl){
  const file=inputEl.files&&inputEl.files[0];
  if(!file){return;}
  if(file.size>50*1024*1024){showToast('备份文件过大(>50MB),请检查文件');return;}
  showToast('正在读取备份文件...');
  try{
    const text=await new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=e=>resolve(e.target.result);
      reader.onerror=()=>reject(new Error('文件读取失败'));
      reader.readAsText(file);
    });
    let data;
    try{data=JSON.parse(text);}catch(e){throw new Error('文件格式错误,不是有效的JSON');}
    
    // 兼容多种格式,提取车辆数组
    let vehicles=null;
    let sourceType='未知格式';
    if(data&&data.type==='sync_config_backup'&&Array.isArray(data.vehicles)){
      vehicles=data.vehicles;
      sourceType='标准备份('+(data.version||'v?')+')';
    }else if(data&&data.type==='vehicle_poweroff_backup'&&Array.isArray(data.vehicles)){
      vehicles=data.vehicles;
      sourceType='旧版备份';
    }else if(Array.isArray(data)&&data.length>0&&data[0].id!==undefined){
      vehicles=data;
      sourceType='裸数组格式';
    }
    
    if(!vehicles||!vehicles.length){throw new Error('备份文件中没有车辆数据');}
    
    // 统计导入信息
    const localIds=new Set(VEHICLES.map(v=>v.id));
    let newCount=0,updateCount=0;
    vehicles.forEach(v=>{
      if(localIds.has(v.id))updateCount++;
      else newCount++;
    });
    
    // 二次确认: 使用showConfirm+confirmCancelCallback的标准Promise封装
    const msg=`将导入 ${vehicles.length} 条车辆数据\n来源: ${sourceType}\n新增: ${newCount} 条\n覆盖: ${updateCount} 条\n\n导入后本地数据将被合并,是否继续?`;
    const ok=await new Promise(resolve=>{
      showConfirm('导入备份确认',msg,()=>resolve(true));
      confirmCancelCallback=()=>resolve(false);
    });
    if(!ok){showToast('已取消导入');inputEl.value='';return;}
    
    // 执行合并
    let added=0,updated=0;
    vehicles.forEach(sv=>{
      const v=VEHICLES.find(x=>x.id===sv.id);
      if(v){
        // 已存在: 覆盖更新
        v.display=sv.display;v.brand=sv.brand;v.series=sv.series;v.config=sv.config;
        v.powerType=sv.powerType;v.position=sv.position;v.steps=sv.steps;
        v.keyFrame=sv.keyFrame;v.keyContainer=sv.keyContainer;v.remarks=sv.remarks;
        v.photoPaths=sv.photoPaths||[];v.photos=sv.photos||0;
        v.photoSections=sv.photoSections;v.photoLabels=sv.photoLabels;v.keyPhotoRemark=sv.keyPhotoRemark;
        v.videoPaths=sv.videoPaths||[];v.videos=sv.videos||0;
        if(sv.size!==undefined)v.size=sv.size;
        if(sv.brandId!==undefined)v.brandId=sv.brandId;
        v.pinyin=getPinyin(sv.display);
        updated++;
      }else{
        // 新增: 构造完整车辆对象
        const nv={
          id:sv.id,display:sv.display,brand:sv.brand,series:sv.series,
          config:sv.config,powerType:sv.powerType,position:sv.position,
          steps:sv.steps,keyFrame:sv.keyFrame,keyContainer:sv.keyContainer,
          remarks:sv.remarks,photoPaths:sv.photoPaths||[],photos:sv.photos||0,
          photoSections:sv.photoSections,photoLabels:sv.photoLabels,keyPhotoRemark:sv.keyPhotoRemark,
          videoPaths:sv.videoPaths||[],videos:sv.videos||0
        };
        if(sv.size!==undefined)nv.size=sv.size;
        if(sv.brandId!==undefined)nv.brandId=sv.brandId;
        nv.pinyin=getPinyin(sv.display);
        State.pushVehicle(nv); // A3状态守卫: 追加预构建对象(持久化由下方统一persistVehicles一次)
        added++;
      }
    });
    
    // 保存到本地
    persistVehicles();
    // 刷新界面
    if(typeof renderVehicleList==='function')renderVehicleList();
    if(typeof refreshVehicleCount==='function')refreshVehicleCount();
    
    const result=`导入完成 · 新增${added}条 · 覆盖${updated}条`;
    showToast(result);
    addSyncLog(`备份导入完成 · 来源:${sourceType} · 新增${added}条 · 覆盖${updated}条`,'green');
  }catch(e){
    showToast('导入失败: '+e.message);
    addSyncLog('备份导入失败: '+e.message,'red');
  }finally{
    inputEl.value='';
  }
}

function renderSyncLog(){
  const c=document.getElementById('sync-log-list');
  if(!c)return;
  let logs=JSON.parse(localStorage.getItem('sync_logs')||'[]');
  if(logs.length===0){
    c.innerHTML='<div class="text-center py-8"><div class="text-gray-300 text-sm">暂无同步记录</div><div class="text-xs text-gray-400 mt-1">首次使用，无同步日志</div></div>';
    return;
  }
  const colorMap={green:'bg-green-500',blue:'bg-blue-500',red:'bg-red-500',gray:'bg-gray-300'};
  c.innerHTML=logs.map(l=>`
    <div class="flex items-start gap-3"><div class="w-2 h-2 rounded-full ${colorMap[l.color]||'bg-gray-300'} mt-1.5 flex-shrink-0"></div><div class="flex-1"><div class="text-xs text-gray-800">${l.msg}</div><div class="text-xs text-gray-400 mt-0.5">${l.time}</div></div></div>
  `).join('');
}

// ===================== PHOTO VIEWER =====================
/**
 * 图片加载失败兜底 - V5.3防御性编程
 * 数据引用经启动清洗已无死链,此函数防御运行时文件损坏/被系统清理等极端场景
 * @param {HTMLImageElement} img - 加载失败的img元素
 */
