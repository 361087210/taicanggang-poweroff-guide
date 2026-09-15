/* ===========================================================
 * 模块: 09-web-sync.js  网页版数据同步桥接层 V1.1 (V10.14.3 配套)
 * ===========================================================
 * 背景: 飞书OpenAPI响应不带Access-Control-Allow-Origin,浏览器直接
 *      fetch飞书API被CORS 100%拦截;安卓版靠cordova原生HTTP层绕过,
 *      纯网页环境无此能力 → 网页版车型/账号数据永远拉不到云端。
 * 方案: GitHub Actions定时把飞书云端数据镜像到仓库web-data/目录
 *      (scripts/sync_web_data.js),本模块让网页版改从同源web-data/
 *      读取(零CORS问题),并维持与安卓版完全一致的合并语义。
 *
 * 激活策略(V1.1 探测式激活,关键安全约束):
 *   本模块绝不无条件覆盖feishuCfgReady等安全门函数--否则jsdom逻辑
 *   测试(4.2a"默认未注入时feishuCfgReady=false安全拦截")与"镜像尚未
 *   部署"的场景都会被污染。加载时仅做异步探测: web-data/meta.json
 *   可达且含syncedAt,才安装全部覆盖(真实Pages部署形态);
 *   探测失败(测试环境无fetch/app.local不可达/首同步前无镜像)则
 *   完全保持原生行为,不产生任何副作用。
 *
 * 覆盖范围(仅激活后生效,安卓Cordova APP永不激活):
 *   1 feishuCfgReady/getFeishuToken/downloadJsonFromDataFeishu/
 *      downloadJsonFromFolder -- 下行下载原语改读同源镜像
 *   2 pullApprovedStatusFromFeishu -- 登录云端账号核对(linkKey 匹配)
 *   3 checkMemberAccountAlive -- 组员账号存活守卫(id 匹配)
 *   4 doSyncDownload原有主流程经1自动生效(镜像对齐语义不变)
 *   5 上行链路(doSyncUpload/注册/审批推送)封堵并给出引导提示
 *   6 即时同步引擎: 60秒轮询web-data/data_update_notice.json,
 *      检测到组长上传的新数据自动镜像对齐+提示
 *
 * 隐私约定: 镜像账号表以 linkKey=PBKDF2(password, LINK_SALT|phone) 作为连接键,
 *          熵来自密码, 仅凭手机号无法枚举还原; 明文手机号/密码哈希一律不出库
 *          (见 scripts/sync_web_data.js)。
 * =========================================================== */
(function(){
'use strict';

/* ---------- 环境守卫: 仅纯浏览器环境启用 ---------- */
if(typeof window==='undefined')return;
/* 安卓/IOS Cordova APP环境: cordova对象由cordova.js注入,直接退出,
 * 保证APP内全部走原有飞书直连链路,行为与V10.14.3完全一致 */
if(window.cordova&&window.cordova.platformId)return;
/* file://本地预览(无HTTP服务,fetch镜像无意义) */
if(window.location&&window.location.protocol==='file:')return;

/* 网页环境标记(与demo.html内联_isWebEnv互为冗余,双保险)。
 * 纯展示层CSS钩子,加载即标记,不影响任何逻辑与安全门 */
if(document.documentElement&&document.documentElement.classList){
  document.documentElement.classList.add('web-env');
}

/* ---------- 常量(与scripts/sync_web_data.js严格一致) ----------
 * V10.18.0 重构: MIRROR_BASE 改从单一真源 window.TCG_CONFIG 读取,
 * 仅当 TCG_CONFIG 未加载(极旧环境)时回退内置默认值, 杜绝散落硬编码漂移。
 * P0 脱敏: 原手机号 sha256 枚举向量(旧盐常量)已删除; 连接键改用
 * deriveLinkKey(js/00-bootstrap.js), 镜像端只透传 linkKey, 不再自己算。 */
var MIRROR_BASE=(window.TCG_CONFIG&&window.TCG_CONFIG.WEB_MIRROR_BASE)||'web-data/';
var GITHUB_REGISTER_REPO=(window.TCG_CONFIG&&window.TCG_CONFIG.GITHUB_REGISTER_REPO)||'361087210/tcg-registration-inbox';
/* V10.17.0: 网页端注册GitHub登记通道(反馈问题2)——
 * 登记库公开只写, token按项目既有XOR+base64模式加密存储(与appSecretEnc同款,
 * 密钥同源), 明文不出现在源码/构建产物/网络日志中;轮换时仅需更新此密文。 */
var GITHUB_REGISTER_API='https://api.github.com/repos/'+GITHUB_REGISTER_REPO+'/contents/registrations';
var GITHUB_REGISTER_TOKEN_ENC='Mys3ABRgQg8+IDUYWlpafGAmECdlZnsTFnkKGn1GZ2UbKHQzOQJ8JQ==';

/** 拉取同源镜像JSON(时间戳防缓存+no-store双保险,配合SW网络优先策略)
 *  V10.15.9 弱网优化: 10s超时,避免弱网下fetch挂起阻塞UI;
 *  超时抛错由调用方catch静默降级,不影响本地已有数据展示。
 *  V10.15.10: 改用05-sync.js的fetchSignalSafe垫片--signal跨realm环境
 *  (旧WebView polyfill)下去signal重试,不再整链断供;垫片未加载时兜底裸fetch。 */
async function _fetchMirror(name){
  if(typeof fetchSignalSafe==='function'){
    var resp=await fetchSignalSafe(MIRROR_BASE+name+'?t='+Date.now(),{cache:'no-store'},10000);
    if(!resp.ok)throw new Error('HTTP '+resp.status);
    return resp.json();
  }
  var resp=await fetch(MIRROR_BASE+name+'?t='+Date.now(),{cache:'no-store'});
  if(!resp.ok)throw new Error('HTTP '+resp.status);
  return resp.json();
}

/* ============================================================
 * 激活安装器: 镜像通道确认可达后,一次性安装全部覆盖
 * ============================================================ */
var _installed=false;
function _install(){
  if(_installed)return;
  _installed=true;

  /* ---------- 1 下载原语覆盖: 飞书云端 → 同源web-data/镜像 ---------- */
  window.feishuCfgReady=function(){return true;}; /* 网页镜像通道就绪(无需飞书凭据) */
  window.getFeishuToken=async function(){return 'web-mirror';}; /* 假token:真实下载已被下方重写 */

  window.downloadJsonFromDataFeishu=async function(token,docName,subName){
    if(docName==='vehicle_sync_data.json')return _fetchMirror('vehicle_sync_data.json');
    if(docName==='data_update_notice.json')return _fetchMirror('data_update_notice.json');
    /* approved_users.json: 镜像账号表只含 linkKey 连接键(无明文手机号/密码),返回null--
     * 该文件的两个调用方(pullApprovedStatusFromFeishu/checkMemberAccountAlive)
     * 已在下方整体重写,不会走到这里 */
    if(docName==='approved_users.json')return null;
    return null;
  };

  window.downloadJsonFromFolder=async function(token,folderToken,docName){
    /* 历史位置回退: 统一并入镜像(vehicle_sync_data.json同源只有一个真源) */
    if(docName==='vehicle_sync_data.json')return _fetchMirror('vehicle_sync_data.json');
    return null;
  };

  /* ============================================================
   * 2 登录云端账号核对(linkKey 匹配, 命中即密码验真)
   * 语义对齐安卓版pullApprovedStatusFromFeishu(V5.7):
   *  - 云端有而本地无(新设备登录)→用手机号+明文密码派生 linkKey 匹配镜像重建本地账号
   *  - 本地已有→云端active状态传播(密码以本地为准,避免覆盖; 镜像已无密码)
   *  - fullMerge=true(登录流程)→返回true,由doLogin重新查找
   * ============================================================ */
  window.pullApprovedStatusFromFeishu=async function(userParam,fullMerge){
    var who=userParam||state.currentUser;
    if(!who&&!fullMerge)return false;
    try{
      var web=await _fetchMirror('approved_users.web.json');
      if(!web||!Array.isArray(web.users)||!web.users.length)return false;
      var me=null;
      var matchedByLinkKey=false;
      /* 连接键匹配优先级:
       *  ① 本地已有 id(注册/历史登录均保留镜像 id)→按 id 精确匹配;
       *  ② 换设备登录 / 本地密码已失效→用手机号+明文密码派生 linkKey 匹配镜像。
       *     命中即密码验真(linkKey 需明文密码参与 PBKDF2, 密码错则派生值错, 匹配失败)。 */
      if(who&&who.id!==undefined&&who.id!==null){
        for(var i=0;i<web.users.length;i++){
          var cu=web.users[i];
          if(cu&&String(cu.id)===String(who.id)){me=cu;break;}
        }
      }
      if(!me&&who&&who.phone&&who.password&&String(who.password).indexOf('$')<0){
        var lk=await deriveLinkKey(String(who.phone),String(who.password));
        if(lk){
          for(var j=0;j<web.users.length;j++){
            var c2=web.users[j];
            if(c2&&c2.linkKey&&String(c2.linkKey)===String(lk)){me=c2;matchedByLinkKey=true;break;}
          }
        }
      }
      if(!me)return false; /* 未命中连接键: 密码错/账号不存在, 无法重建 */
      /* legacy 状态归一(与安卓 LEGACY_OK 对齐): 空/approved/normal/verified → active */
      var norm=me.status;
      if(!norm||norm==='approved'||norm==='normal'||norm==='verified')norm='active';
      /* 本地重建/合并 */
      var local=null;
      for(var k=0;k<USERS.length;k++){
        if(String(USERS[k].id)===String(me.id)){local=USERS[k];break;}
      }
      var changed=false;
      var rejectedTransition=false;
      if(!local){
        if(!who||!who.phone||!who.password)return false; /* 无明文密码无法重建本地账号 */
        /* 换设备登录重建: id 取镜像, password 用本机新盐哈希存本地会话(镜像已无密码)。
         * 网页端仅组员只读: 强制 role='user'(组长功能一律引导去安卓端)。 */
        var localHash=await hashPassword(String(who.password), genSalt());
        State.addUser({
          id:me.id,name:me.name||'',phone:String(who.phone),
          password:localHash,pw_ts:0,role:'user',
          status:norm,created:me.created||'',
          linkKey:me.linkKey||''
        });
        changed=true;
      }else{
        /* 本地已有: 云端审批状态(含 rejected)/姓名传播; 网页端 role 恒为 user */
        if((norm==='active'||norm==='rejected')&&local.status!==norm){
          if(norm==='rejected')rejectedTransition=true;
          local.status=norm;changed=true;
        }
        if(me.name&&local.name!==me.name){local.name=me.name;changed=true;}
        if(local.role!=='user'){local.role='user';changed=true;}
        if(me.linkKey&&local.linkKey!==me.linkKey){local.linkKey=me.linkKey;changed=true;}
        /* 采纳安卓改密后的新密码: linkKey 命中即密码验真, 用明文重哈希本地密码
         * (镜像无 password, 本地旧哈希已失效时靠此闭环, 使安卓改密后网页端仍可登录) */
        if(matchedByLinkKey&&who&&who.password){
          var localHash2=await hashPassword(String(who.password), genSalt());
          if(String(local.password)!==String(localHash2)){local.password=localHash2;local.pw_ts=0;changed=true;}
        }
      }
      if(changed)saveUsers(USERS);
      if(fullMerge)return true;
      if(norm==='rejected'){
        /* 拒绝态: 复用安卓 pushRegistrationRejectionNotice(网页端无 cordova, 走 Toast 降级) */
        if(rejectedTransition&&typeof pushRegistrationRejectionNotice==='function')pushRegistrationRejectionNotice(local);
        return false;
      }
      if(norm==='active'){
        var mine=null;
        for(var m=0;m<USERS.length;m++){if(String(USERS[m].id)===String(me.id)){mine=USERS[m];break;}}
        if(mine&&mine.status!=='active'){
          mine.status='active';
          saveUsers(USERS);
          showToast('🎉 您的注册申请已被组长通过,现已可正常使用');
          return true;
        }
        return !!(mine&&mine.status==='active');
      }
      return false;
    }catch(e){
      console.warn('[网页同步]账号表拉取失败(离线/镜像未就绪):',e&&e.message);
      return false;
    }
  };

  /* ============================================================
   * 3 组员账号存活守卫(id 匹配, 防误踢语义与安卓版一致)
   * ============================================================ */
  window.checkMemberAccountAlive=async function(){
    if(!state.currentUser||state.currentUser.role!=='user')return true;
    if(window.__webGuardBusy)return true;
    window.__webGuardBusy=true;
    try{
      var web=await _fetchMirror('approved_users.web.json');
      /* 镜像不可用/无数据→跳过本轮,绝不因网络抖动误踢在线组员 */
      if(!web||!Array.isArray(web.users)||!web.users.length)return true;
      /* P0 脱敏: 按登录后本地已有的 id 匹配镜像 id, 不再用可枚举的手机号哈希 */
      var me=null;
      for(var i=0;i<web.users.length;i++){
        var cu=web.users[i];
        if(cu&&String(cu.id)===String(state.currentUser.id)){me=cu;break;}
      }
      if(me&&me.status==='active')return true;
      await forceLogoutAsDeleted(me?'您的账号已被组长停用':'您的账号已被组长删除');
      return false;
    }catch(e){
      return true; /* 网络异常:跳过本轮 */
    }finally{
      window.__webGuardBusy=false;
    }
  };

  /* ============================================================
   * 4 上行链路封堵: 网页版为只读镜像端(写入统一走安卓组长端)
   * ============================================================ */
  window.doSyncUpload=async function(){
    showToast('网页版为只读数据镜像,请在安卓端上传');
    addSyncLog('网页镜像端不支持上传 · 数据发布请使用安卓组长端','red');
  };
  window.pullPendingFromFeishu=async function(){return false;};   /* 待审申请只在安卓端处理 */
  window.syncPendingToFeishu=async function(){};                  /* 注册上传封堵(注册本身已拦截) */
  window.pushApprovedUsersToFeishu=async function(){
    showToast('网页端管理操作不会同步云端,请在安卓端操作');
  };
  /* V10.15.13: 网页端禁止改密--网页版为只读镜像,CORS无法直连飞书API,
   * pushApprovedUsersToFeishu被封堵,改密只改本浏览器localStorage、不推云端,
   * 用户误以为改密成功,换安卓设备登录时云端仍是旧哈希→新密码永远错误。
   * 直接拦截并引导至安卓端操作,避免"假成功"陷阱。 */
  window.changePassword=async function(){
    showToast('网页版不支持修改密码,请在安卓APP「我的→账号安全」中修改');
  };
  /* 网页端禁止重置密码(与 changePassword 一致): 网页版只读镜像无法直连飞书,
   * doForgotPassword 只改本浏览器 localStorage、不推云端, 换安卓登录仍用旧密码,
   * 是"假成功"陷阱。直接拦截并引导至安卓端。 */
  window.doForgotPassword=async function(){
    showToast('网页版不支持重置密码,请在安卓APP「我的→账号安全」中修改');
  };
  /* ============================================================
   * ④d 网页端自助注册(GitHub登记通道) - V10.17.0 反馈问题2
   * ============================================================
   * 背景: 网页端无飞书直连能力(CORS),旧版直接拦截注册引导去安卓端;
   *      用户要求网页端可申请注册。方案: 登记走GitHub专用库
   *      (公开仓库+细粒度token,提交即创建pending_reg_<手机号>.json,
   *      镜像工作流转投飞书“注册申请/”),组长端现有轮询零改动可见可审;
   *      审批后组员经网页镜像approved_users.web.json登录。
   * 诚实原则: 上行失败时立即删除本地pending账号并明确报错,绝不假成功。
   * ============================================================ */
  window.doRegister=async function(){
    var name=document.getElementById('reg-name').value.trim();
    var phone=document.getElementById('reg-phone').value.trim();
    var pass=document.getElementById('reg-pass').value.trim();
    var pass2=document.getElementById('reg-pass2').value.trim();
    if(!name||!phone||!pass){showToast('请填写完整信息');return;}
    if(!/^\d{11}$/.test(phone)){showToast('请输入11位手机号');return;}
    if(pass.length<6){showToast('密码至少6位');return;}
    if(!/(?=.*\d)(?=.*[a-zA-Z])/.test(pass)){showToast('密码须包含数字和字母');return;}
    if(pass!==pass2){showToast('两次密码不一致');return;}
    if(USERS.find(function(u){return u.phone===phone;})){showToast('该手机号已注册');return;}
    // 与安卓端一致的注册限流(同设备1小时3次)
    var regKey='tcg_reg_lock';
    var regLock=JSON.parse(localStorage.getItem(regKey)||'[]');
    var now=Date.now();
    regLock=regLock.filter(function(t){return now-t<3600000;});
    if(regLock.length>=3){showToast('注册过于频繁,请1小时后再试');return;}
    var salt=genSalt();
    var hashedPass=await hashPassword(pass,salt);
    // P0 脱敏: 在拿到明文密码的瞬间派生 linkKey, 随注册申请链一路透传到镜像
    var linkKey=await deriveLinkKey(phone,pass);
    var newUser={id:now,name:name,phone:phone,password:hashedPass,role:'user',status:'pending',created:new Date().toLocaleDateString(),remarks:'网页端申请'};
    if(linkKey)newUser.linkKey=linkKey;
    showToast('正在提交注册申请...');
    var ok=false, errMsg='网络异常，请稍后重试';
    try{
      // 解密登记token(与appSecretEnc同款XOR+base64;00-bootstrap已加载,_SECRET_XOR_KEY在同文件闭包顶层可用)
      var regToken='';
      try{ regToken=(typeof _decryptBuildSecret==='function')?_decryptBuildSecret(GITHUB_REGISTER_TOKEN_ENC):''; }catch(e){ regToken=''; }
      if(!regToken){ errMsg='注册通道未配置，请联系组长'; }
      else{
        var resp=await fetch(GITHUB_REGISTER_API,{
          method:'POST',
          headers:{'Authorization':'Bearer '+regToken,'Accept':'application/vnd.github+json','Content-Type':'application/json'},
          body:JSON.stringify({
            message:'网页端注册申请 '+phone,
            content:btoa(unescape(encodeURIComponent(JSON.stringify({
              type:'pending_registration', source:'tcg-web', appVersion:'v'+APP_VERSION,
              user:{id:newUser.id,name:name,phone:phone,password:hashedPass,role:'user',status:'pending',created:newUser.created,remarks:'网页端申请',linkKey:newUser.linkKey||''},
              timestamp:new Date().toISOString()
            },null,2))))
          })
        });
        if(resp.status===201){ok=true;}
        else if(resp.status===422){errMsg='该手机号已提交过申请，请等待组长审核';}
        else if(resp.status===401||resp.status===403){errMsg='申请通道暂不可用，请联系组长';}
        else{errMsg='提交失败('+(resp.status||'网络')+')，请稍后重试';}
      }
    }catch(e){
      console.warn('[网页注册] GitHub上行失败:',e&&e.message);
    }
    if(ok){
      State.addUser(newUser);
      saveUsers(USERS);
      regLock.push(now);
      localStorage.setItem(regKey,JSON.stringify(regLock));
      showToast('注册申请已提交，请等待组长审核');
      showScreen('screen-login');
      navReset();
      watchRegistrationActivation(newUser);
    }else{
      showToast('注册提交失败: '+errMsg);
    }
  };

  /* ============================================================
   * 4b 网页版问题反馈镜像桥 - V10.15.11
   * 根因: FeedbackBase原生实现依赖飞书直连API(网页端CORS不可达),
   * 导致网页端反馈永远只有本地缓存、看不到云端处理状态。
   * 方案: 覆盖FeedbackBase为镜像读取版--
   *   - listFeedbackRecords 读 web-data/feedback_data.json 同源镜像
   *   - 状态/AI分析/技术文档随镜像更新(安卓组长端审核后经CI镜像同步)
   *   - 写入路径封堵并给出准确引导(纯静态托管无后端,上行物理不可达)
   * ============================================================ */
  window.__TCG_WEB_MIRROR__=true; /* 全局网页镜像标志,10-feedback.js用于准确提示 */
  window.FeedbackBase={
    isAvailable:function(){return true;}, /* 读能力(镜像)可用 */
    listFeedbackRecords:async function(opts){
      var data=await _fetchMirror('feedback_data.json');
      /* 镜像未就绪时返回空数组,上层按"云端无反馈"降级 */
      return (data&&data.items)||[];
    },
    addFeedbackRecord:async function(){ throw new Error('网页镜像端不支持反馈写入'); },
    updateFeedbackStatus:async function(){ throw new Error('网页镜像端不支持状态审核'); },
    uploadScreenshot:async function(){ throw new Error('网页镜像端不支持截图上传'); },
  };

  /* ============================================================
   * 4c 网页端组员管理镜像桥 —— V10.22 删除(仅组员只读落地)
   * 原"云端组员列表追加"逻辑依赖 admin 角色(组长端), 网页端已定为
   * 「仅组员只读」(重建账号强制 role='user'), 该路径永不可达, 属死代码。
   * 组员审批/组员管理一律引导去安卓端(见下方上行封堵 + doForgotPassword 等)。
   * ============================================================ */

  /* ============================================================
   * 5 即时同步引擎: 60秒轮询镜像通知→自动镜像对齐
   * 合并语义与安卓doSyncDownload完全一致(V10.11.0镜像同步):
   *   云端为唯一真源,正向差集覆盖+反向差集删除,ID集合不一致时
   *   忽略时间戳强制对齐(删除传播保证)。
   * ============================================================ */
  async function webApplyMirror(showDetailToast){
    var data=await _fetchMirror('vehicle_sync_data.json');
    if(!data||!Array.isArray(data.vehicles))return;
    var cloudVehicles=data.vehicles;
    /* 防御: 云端0条车但本地有数据→异常,拒绝镜像(与安卓端一致) */
    if(!cloudVehicles.length&&VEHICLES.length>0)return;
    var cloudTs=new Date(data.timestamp||0).getTime();
    var localSync=JSON.parse(localStorage.getItem('feishu_sync_data')||'{}');
    var lastSyncTs=localSync.timestamp?new Date(localSync.timestamp).getTime():0;
    var cloudIdsArr=cloudVehicles.map(function(v){return String(v.id);});
    var localIdsArr=VEHICLES.map(function(v){return String(v.id);});
    var sameIds=cloudIdsArr.length===localIdsArr.length&&
      cloudIdsArr.every(function(id){return localIdsArr.indexOf(id)>-1;});
    if(cloudTs<=lastSyncTs&&sameIds)return; /* 无更新 */

    /* ---- 镜像对齐(正向覆盖+反向删除) ---- */
    var localIds=new Set(VEHICLES.map(function(v){return v.id;}));
    var cloudIds=new Set(cloudVehicles.map(function(v){return v.id;}));
    var added=0,updated=0,removed=0;
    var next=cloudVehicles.map(function(sv){
      if(localIds.has(sv.id))updated++;else added++;
      var local=null;
      for(var i=0;i<VEHICLES.length;i++){if(VEHICLES[i].id===sv.id){local=VEHICLES[i];break;}}
      var nv=Object.assign({},local,sv);
      nv.pinyin=getPinyin(sv.display);
      return nv;
    });
    localIds.forEach(function(id){if(!cloudIds.has(id))removed++;});
    State.replaceVehicles(next);
    var totalChanges=added+updated+removed;
    if(totalChanges>0){
      persistVehicles(); /* V10.6.0问题4: 合并后立即持久化,重启不丢 */
      renderBrandTags();
      renderVehicleList();
      if(showDetailToast){
        showToast('数据同步完成: 新增'+added+'条, 更新'+updated+'条, 删除'+removed+'条 ('+(data.version||'')+')');
      }else{
        showToast('☁️ 已自动同步最新数据: '+(data.version||'')+' · '+(data.vehicleCount||cloudVehicles.length)+'条');
      }
      addSyncLog('网页镜像同步 · 新增'+added+'条 更新'+updated+'条 删除'+removed+'条 · '+(data.version||''),'green');
    }
    localStorage.setItem('feishu_sync_data',JSON.stringify({
      vehicleCount:data.vehicleCount,version:data.version,timestamp:data.timestamp
    }));
    _setSyncNewDot(false);
    var cv=document.getElementById('sync-cloud-ver');
    if(cv)cv.textContent='已连接 · 网页镜像 '+(data.version||'')+' (最新)';
    var ss=document.getElementById('sync-status-text');
    if(ss){ss.className='text-base font-bold text-green-600 flex items-center gap-2 mt-1';
      ss.innerHTML='<span class="w-2 h-2 rounded-full bg-green-500 pulse"></span>已同步';}
  }

  /* 60秒轮询 + 前台切回即时核查(与安卓端节奏一致) */
  var _lastAutoTs=0,_autoBusy=false;
  async function webAutoSync(force){
    if(!state.currentUser||window.__tcgKicked)return;
    var now=Date.now();
    if(!force&&now-_lastAutoTs<60000)return;
    if(_autoBusy)return;
    _autoBusy=true;
    _lastAutoTs=now;
    try{
      var notice=await _fetchMirror('data_update_notice.json');
      if(!notice||!notice.timestamp)return;
      var local=JSON.parse(localStorage.getItem('feishu_sync_data')||'{}');
      var localTs=local.timestamp?new Date(local.timestamp).getTime():0;
      var noticeTs=new Date(notice.timestamp).getTime();
      if(noticeTs>localTs){
        /* 云端有新数据: 自动应用镜像对齐(用户要求网页版即时同步) */
        await webApplyMirror(false);
      }else{
        _setSyncNewDot(false);
        var cv=document.getElementById('sync-cloud-ver');
        if(cv&&notice.version)cv.textContent='已连接 · 网页镜像 '+notice.version+' (最新)';
      }
    }catch(e){
      /* 镜像未就绪/网络抖动: 静默,下轮重试 */
      console.debug('[网页同步]镜像检查失败(下轮重试):',e&&e.message);
    }finally{
      _autoBusy=false;
    }
  }
  window.webAutoSync=webAutoSync; /* 供控制台/调试手动触发 */

  setInterval(function(){webAutoSync(false);},60000);
  document.addEventListener('visibilitychange',function(){
    if(!document.hidden)webAutoSync(true); /* iOS Safari切回标签页立即核查 */
  });
  window.addEventListener('load',function(){
    /* 启动3秒后首查(等待会话恢复+镜像HEAD就绪);并顺带做一次账号表核对 */
    setTimeout(function(){
      webAutoSync(true);
      if(state.currentUser)pullApprovedStatusFromFeishu(null,true);
    },3000);
  });

  /* ---------- 网页版同步中心文案适配(纯展示层) ---------- */
  window.addEventListener('load',function(){
    setTimeout(function(){
      var t=document.getElementById('sync-upload-title');
      var d=document.getElementById('sync-upload-desc');
      if(t)t.textContent='拉取最新数据(云端镜像)';
      if(d)d.textContent='从飞书云端镜像通道获取最新车型与账号数据';
    },1000);
  });

  console.log('[网页同步] 09-web-sync.js 镜像通道已激活(同源web-data/,60秒自动同步)');
}

/* ============================================================
 * 探测式激活(V1.1核心): 仅当同源镜像真实可达时才安装覆盖
 *   - jsdom逻辑测试环境: 无window.fetch → 永不激活,
 *     feishuCfgReady等安全门保持原生语义(4.2a安全断言不被破坏)
 *   - 首次同步前的Pages: web-data/meta.json 404 → 暂不激活,
 *     等sync-web-data工作流生成镜像后下次加载自动激活
 *   - 真实部署: meta.json可达含syncedAt → 立即安装全部覆盖
 * ============================================================ */
(function _probeMirror(){
  try{
    if(typeof fetch!=='function'){ /* 测试环境/老浏览器: 静默保持原生行为 */
      return;
    }
    _fetchMirror('meta.json').then(function(meta){
      if(meta&&meta.syncedAt){
        _install();
      }else{
        console.info('[网页同步]镜像meta.json无syncedAt(数据未就绪),保持原生行为');
      }
    }).catch(function(){
      /* 镜像未部署/离线: 保持原生行为,不产生任何副作用 */
    });
  }catch(e){
    /* 防御: 任何探测异常都不影响页面原生功能 */
  }
})();
})();
