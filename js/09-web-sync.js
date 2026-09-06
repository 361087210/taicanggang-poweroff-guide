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
 *   本模块绝不无条件覆盖feishuCfgReady等安全门函数——否则jsdom逻辑
 *   测试(4.2a"默认未注入时feishuCfgReady=false安全拦截")与"镜像尚未
 *   部署"的场景都会被污染。加载时仅做异步探测: web-data/meta.json
 *   可达且含syncedAt,才安装全部覆盖(真实Pages部署形态);
 *   探测失败(测试环境无fetch/app.local不可达/首同步前无镜像)则
 *   完全保持原生行为,不产生任何副作用。
 *
 * 覆盖范围(仅激活后生效,安卓Cordova APP永不激活):
 *   ① feishuCfgReady/getFeishuToken/downloadJsonFromDataFeishu/
 *      downloadJsonFromFolder —— 下行下载原语改读同源镜像
 *   ② pullApprovedStatusFromFeishu —— 登录云端账号核对(手机号哈希匹配)
 *   ③ checkMemberAccountAlive —— 组员账号存活守卫(哈希匹配)
 *   ④ doSyncDownload原有主流程经①自动生效(镜像对齐语义不变)
 *   ⑤ 上行链路(doSyncUpload/注册/审批推送)封堵并给出引导提示
 *   ⑥ 即时同步引擎: 60秒轮询web-data/data_update_notice.json,
 *      检测到组长上传的新数据自动镜像对齐+提示
 *
 * 隐私约定: 镜像表手机号已脱敏为sha256(SALT+phone),
 *          SALT必须与scripts/sync_web_data.js保持一致。
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

/* ---------- 常量(与scripts/sync_web_data.js严格一致) ---------- */
var WEB_SYNC_SALT='tcg-web-2026';
var MIRROR_BASE='web-data/';

/* ---------- 基础工具 ---------- */
async function _sha256Hex(s){
  // V10.15.9: 优先用00-bootstrap.js的_digestSha256Hex(含纯JS兜底),
  // 保证非HTTPS/旧WebView下手机号哈希匹配仍能执行
  var data=new TextEncoder().encode(String(s));
  if(typeof _digestSha256Hex==='function')return _digestSha256Hex(data);
  if(!(window.crypto&&window.crypto.subtle))throw new Error('WebCrypto不可用(需HTTPS环境)');
  var buf=await window.crypto.subtle.digest('SHA-256',data);
  var arr=new Uint8Array(buf),out='';
  for(var i=0;i<arr.length;i++)out+=('0'+arr[i].toString(16)).slice(-2);
  return out;
}

/** 拉取同源镜像JSON(时间戳防缓存+no-store双保险,配合SW网络优先策略)
 *  V10.15.9 弱网优化: 10s超时,避免弱网下fetch挂起阻塞UI;
 *  超时抛错由调用方catch静默降级,不影响本地已有数据展示。
 *  V10.15.10: 改用05-sync.js的fetchSignalSafe垫片——signal跨realm环境
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

  /* ---------- ① 下载原语覆盖: 飞书云端 → 同源web-data/镜像 ---------- */
  window.feishuCfgReady=function(){return true;}; /* 网页镜像通道就绪(无需飞书凭据) */
  window.getFeishuToken=async function(){return 'web-mirror';}; /* 假token:真实下载已被下方重写 */

  window.downloadJsonFromDataFeishu=async function(token,docName,subName){
    if(docName==='vehicle_sync_data.json')return _fetchMirror('vehicle_sync_data.json');
    if(docName==='data_update_notice.json')return _fetchMirror('data_update_notice.json');
    /* approved_users.json: 镜像表手机号已哈希无法还原,返回null——
     * 该文件的两个调用方(pullApprovedStatusFromFeishu/checkMemberAccountAlive)
     * 已在下方②③整体重写,不会走到这里 */
    if(docName==='approved_users.json')return null;
    return null;
  };

  window.downloadJsonFromFolder=async function(token,folderToken,docName){
    /* 历史位置回退: 统一并入镜像(vehicle_sync_data.json同源只有一个真源) */
    if(docName==='vehicle_sync_data.json')return _fetchMirror('vehicle_sync_data.json');
    return null;
  };

  /* ============================================================
   * ② 登录云端账号核对(手机号sha256匹配还原)
   * 语义对齐安卓版pullApprovedStatusFromFeishu(V5.7):
   *  - 云端有而本地无(新设备登录)→以登录输入的真实手机号重建本地账号
   *  - 本地已有→云端active状态传播(密码以本地为准,避免覆盖)
   *  - fullMerge=true(登录流程)→返回true,由doLogin重新查找
   * ============================================================ */
  window.pullApprovedStatusFromFeishu=async function(userParam,fullMerge){
    var who=userParam||state.currentUser;
    if(!who&&!fullMerge)return false;
    try{
      var web=await _fetchMirror('approved_users.web.json');
      if(!web||!Array.isArray(web.users)||!web.users.length)return false;
      /* 预计算: 登录者手机号哈希 + 本地全部手机号哈希索引 */
      var whoH=(who&&who.phone)?await _sha256Hex(WEB_SYNC_SALT+String(who.phone)):null;
      var localH={};
      for(var i=0;i<USERS.length;i++){
        var u=USERS[i];
        if(u&&u.phone&&localH[u.phone]===undefined){
          localH[u.phone]=await _sha256Hex(WEB_SYNC_SALT+String(u.phone));
        }
      }
      var changed=false,me=null;
      for(var k=0;k<web.users.length;k++){
        var cu=web.users[k];
        if(!cu||!cu.phoneH)continue;
        /* 哈希匹配本地账号 */
        var local=null;
        for(var j=0;j<USERS.length;j++){
          var lu=USERS[j];
          if(lu&&lu.phone&&localH[lu.phone]===cu.phoneH){local=lu;break;}
        }
        if(!local){
          if(whoH&&whoH===cu.phoneH){
            /* 新设备登录: 用登录输入的真实手机号重建本地账号(密码取云端哈希) */
            State.addUser({
              id:cu.id,name:cu.name||'',phone:String(who.phone),
              password:cu.password||'',role:cu.role||'user',
              status:cu.status||'pending',created:cu.created||''
            });
            changed=true;
          }
        }else{
          /* 本地已有: 云端审批状态/姓名/角色传播(密码以本地为准) */
          if(cu.status==='active'&&local.status!=='active'){local.status='active';changed=true;}
          if(cu.name&&local.name!==cu.name){local.name=cu.name;changed=true;}
          if(cu.role&&(local.role||'user')!==cu.role){local.role=cu.role;changed=true;}
        }
        if(whoH&&whoH===cu.phoneH)me=cu;
      }
      if(changed)saveUsers(USERS);
      if(fullMerge)return true;
      if(me&&me.status==='active'){
        var mine=null;
        for(var m=0;m<USERS.length;m++){if(USERS[m].phone===String(who.phone)){mine=USERS[m];break;}}
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
   * ③ 组员账号存活守卫(哈希匹配,防误踢语义与安卓版一致)
   * ============================================================ */
  window.checkMemberAccountAlive=async function(){
    if(!state.currentUser||state.currentUser.role!=='user')return true;
    if(window.__webGuardBusy)return true;
    window.__webGuardBusy=true;
    try{
      var web=await _fetchMirror('approved_users.web.json');
      /* 镜像不可用/无数据→跳过本轮,绝不因网络抖动误踢在线组员 */
      if(!web||!Array.isArray(web.users)||!web.users.length)return true;
      var myH=await _sha256Hex(WEB_SYNC_SALT+String(state.currentUser.phone));
      var me=null;
      for(var i=0;i<web.users.length;i++){
        var cu=web.users[i];
        if(cu&&cu.phoneH===myH){me=cu;break;}
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
   * ④ 上行链路封堵: 网页版为只读镜像端(写入统一走安卓组长端)
   * ============================================================ */
  window.doSyncUpload=async function(){
    showToast('网页版为只读数据镜像，请在安卓端上传');
    addSyncLog('网页镜像端不支持上传 · 数据发布请使用安卓组长端','red');
  };
  window.pullPendingFromFeishu=async function(){return false;};   /* 待审申请只在安卓端处理 */
  window.syncPendingToFeishu=async function(){};                  /* 注册上传封堵(注册本身已拦截) */
  window.pushApprovedUsersToFeishu=async function(){
    showToast('网页端管理操作不会同步云端，请在安卓端操作');
  };
  window.doRegister=async function(){
    /* 网页注册→待审→上传飞书(CORS拦截)→组长永远看不到申请→账号卡死待审。
     * 直接引导走安卓端添加,避免"假注册成功"的体验陷阱 */
    showToast('网页版暂不支持自助注册，请联系组长在安卓端添加账号');
  };

  /* ============================================================
   * ⑤ 即时同步引擎: 60秒轮询镜像通知→自动镜像对齐
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
