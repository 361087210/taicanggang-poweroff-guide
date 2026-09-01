/* ===========================================================
 * 模块: 07-cache.js
 * 功能: 缓存管理器/组员管理/审批/成员增删/改密/开关/校验工具/safeAsync/showToast/通知/版本更新
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js, 03-vehicles.js, 04-export.js, 05-sync.js, 06-media.js
 * 源范围: demo.html L6377-L7009
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
async function openCacheManager(){
  openModal('modal-cache');
  refreshCacheList();
}

/** 渲染单条缓存项(复选框+文件名+大小+时间) */
function _cacheItemHtml(kind,item){
  const key=kind+'|'+item.name;
  const on=cacheSel.has(key);
  const icon=kind==='video'
    ?'<svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" class="w-4 h-4 flex-shrink-0"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>'
    :'<svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" class="w-4 h-4 flex-shrink-0"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/></svg>';
  const timeStr=item.ts?new Date(item.ts).toLocaleDateString('zh-CN'):'';
  // V10.4.0 问题2: 播放过的视频带「已播放」徽标(索引meta.played),
  // 未播放缓存不带——清理缓存时可据此区分"看过/未看过"
  const playedBadge=(kind==='video'&&item.meta&&item.meta.played)
    ?'<span class="flex-shrink-0 text-xs text-green-600 bg-green-50 border border-green-200 rounded-full px-2 py-0.5">已播放</span>'
    :'';
  // V10.3 问题2: data-cache-key支撑原地选中态更新;onclick参数做js转义
  // (文件名含引号/反斜杠时旧版拼接会语法报错→该行永远选不上)
  const jsName=String(item.name).replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/"/g,'&quot;');
  return `
  <div class="flex items-center gap-2 py-2 px-2 bg-gray-50 rounded-lg cursor-pointer active:bg-gray-100" data-cache-key="${esc(key)}" onclick="toggleCacheSel('${kind}','${jsName}')">
    <div class="chk ${on?'on':''}"></div>
    ${icon}
    <div class="flex-1 min-w-0">
      <div class="text-xs text-gray-800 truncate">${esc(item.name)}</div>
      <div class="text-xs text-gray-400">${cacheSizeText(item.size)}${timeStr?' · '+timeStr:''}</div>
    </div>
    ${playedBadge}
  </div>`;
}

/**
 * 扫描并渲染缓存管理列表(视频+文档两区)
 * V10.3 问题2: 先等待文件插件就绪再扫描,冷启动场景不再恒空
 */
async function refreshCacheList(){
  const vl=document.getElementById('cache-video-list');
  const dl=document.getElementById('cache-doc-list');
  const totalEl=document.getElementById('cache-total-size');
  if(!vl||!dl)return;
  vl.innerHTML='<div class="text-xs text-gray-400 text-center py-3">扫描中...</div>';
  dl.innerHTML='';
  await _waitCordovaFileReady();
  const [videos,docs]=await Promise.all([cacheList(CACHE_DIR_VIDEOS),cacheList(CACHE_DIR_DOCS)]);
  // 清掉已不存在文件的选中态(防索引漂移)
  const validKeys=new Set([...videos.map(x=>'video|'+x.name),...docs.map(x=>'doc|'+x.name)]);
  [...cacheSel].forEach(k=>{if(!validKeys.has(k))cacheSel.delete(k);});
  const vc=document.getElementById('cache-video-count'),dc=document.getElementById('cache-doc-count');
  if(vc)vc.textContent=videos.length?`(${videos.length}个)`:'';
  if(dc)dc.textContent=docs.length?`(${docs.length}个)`:'';
  vl.innerHTML=videos.length?videos.map(x=>_cacheItemHtml('video',x)).join('')
    :'<div class="text-xs text-gray-400 text-center py-3">暂无缓存视频<br>播放过的教学视频会自动缓存到本地</div>';
  dl.innerHTML=docs.length?docs.map(x=>_cacheItemHtml('doc',x)).join('')
    :'<div class="text-xs text-gray-400 text-center py-3">暂无导出文档<br>导出的Word/PDF/Excel等文档会自动保存到本地</div>';
  const total=videos.concat(docs).reduce((s,f)=>s+f.size,0);
  if(totalEl)totalEl.textContent=total>0?`共 ${cacheSizeText(total)} · 视频${videos.length}个 文档${docs.length}个`:'暂无缓存内容';
  _updateDelBtn();
}

/**
 * 切换缓存项选中态
 * V10.3 问题2: 原地更新复选框,不再整列表重渲染——旧版每次点选都重建全部DOM,
 * 列表滚动位置归零+视觉闪烁,长列表多点选时体验像"没点上",真机上误判为删除失效
 */
function toggleCacheSel(kind,name){
  const key=kind+'|'+name;
  cacheSel.has(key)?cacheSel.delete(key):cacheSel.add(key);
  const on=cacheSel.has(key);
  // 原地更新本行复选框样式(data-cache-key由渲染时标记)
  document.querySelectorAll('#modal-cache [data-cache-key]').forEach(row=>{
    if(row.getAttribute('data-cache-key')===key){
      const chk=row.querySelector('.chk');
      if(chk)chk.classList.toggle('on',on);
    }
  });
  _updateDelBtn();
}

/** 更新"删除选中/保存到本地"按钮状态 */
function _updateDelBtn(){
  const btn=document.getElementById('btn-del-cache');
  if(btn){btn.disabled=cacheSel.size===0;btn.textContent=`删除选中(${cacheSel.size})`;}
  // V10.5.0 问题1: 保存到本地按钮与删除按钮同步启用/禁用
  const saveBtn=document.getElementById('btn-save-cache');
  if(saveBtn){saveBtn.disabled=cacheSel.size===0;saveBtn.textContent=`保存到本地(${cacheSel.size})`;}
}

/** 删除选中的缓存项(带确认+反馈) */
function deleteSelectedCache(){
  if(!cacheSel.size)return;
  const n=cacheSel.size;
  showConfirm('删除缓存',`确定删除选中的 ${n} 项缓存？删除后视频需重新加载。`,async()=>{
    hapticFeedback();
    const videoNames=[...cacheSel].filter(k=>k.startsWith('video|')).map(k=>k.slice(6));
    const docNames=[...cacheSel].filter(k=>k.startsWith('doc|')).map(k=>k.slice(4));
    const [dv,dd]=await Promise.all([
      videoNames.length?cacheDeleteFiles(CACHE_DIR_VIDEOS,videoNames):Promise.resolve(0),
      docNames.length?cacheDeleteFiles(CACHE_DIR_DOCS,docNames):Promise.resolve(0)
    ]);
    cacheSel.clear();
    await refreshCacheList();
    _refreshCacheHint();
    showToast(`✅ 已删除 ${dv+dd} 项缓存`);
  });
}

/** 全部清空(双确认防误触) */
function clearAllCache(){
  showConfirm('清空全部缓存','确定清空所有已缓存视频和已导出文档？此操作不可恢复。',async()=>{
    hapticFeedback();
    const videos=await cacheList(CACHE_DIR_VIDEOS);
    const docs=await cacheList(CACHE_DIR_DOCS);
    const [dv,dd]=await Promise.all([
      cacheDeleteFiles(CACHE_DIR_VIDEOS,videos.map(x=>x.name)),
      cacheDeleteFiles(CACHE_DIR_DOCS,docs.map(x=>x.name))
    ]);
    cacheSel.clear();
    await refreshCacheList();
    _refreshCacheHint();
    showToast(`✅ 已清空 ${dv+dd} 项缓存`);
  });
}

/** 刷新「我的」页缓存入口的大小提示 */
function _refreshCacheHint(){
  const hint=document.getElementById('cache-size-hint');
  if(!hint)return;
  cacheTotalSize().then(total=>{
    hint.textContent=total>0?`已缓存 ${cacheSizeText(total)}`:'视频缓存与导出文档';
  }).catch(()=>{});
}

async function addMember(){
  const name=document.getElementById('mem-name').value.trim();
  const phone=document.getElementById('mem-phone').value.trim();
  const pass=document.getElementById('mem-pass').value.trim();
  if(!name||!phone||!pass){showToast('请填写完整信息');return;}
  if(!/^\d{11}$/.test(phone)){showToast('请输入11位手机号');return;}
  if(pass.length<6){showToast('密码至少6位');return;}
  if(USERS.find(u=>u.phone===phone)){showToast('该手机号已注册');return;}
  // V5.4: 密码哈希化存储
  const salt = genSalt();
  const hashedPass = await hashPassword(pass, salt);
  State.addUser({id:Date.now(),name,phone,password:hashedPass,role:'user',status:'active',created:new Date().toLocaleDateString()}); // A3状态守卫
  saveUsers(USERS);
  document.getElementById('mem-name').value='';
  document.getElementById('mem-phone').value='';
  document.getElementById('mem-pass').value='';
  renderMemberList();
  showToast('组员创建成功');
}

// V5.8.1: 手动刷新注册申请
/**
 * V5.8.2 刷新注册申请——增加错误恢复机制
 * 方案4步骤三：检查审核请求返回的状态码,失败时提供恢复路径
 * @returns {Promise<void>}
 */
async function refreshPending(){
  const btn=document.getElementById('btn-refresh-pending');
  if(btn){btn.disabled=true;btn.lastChild.textContent=' 拉取中...';}
  try{
    const cnt=await pullPendingFromFeishu(false);
    renderMemberList();
    if(cnt>0){showToast(`收到${cnt}条新申请`);}
    else{showToast('暂无新申请');}
  }catch(e){
    // V5.8.2: 按错误类型分类处理(方案4步骤三)
    const msg=e.message||'';
    if(msg.includes('token')||msg.includes('auth')){
      showToast('飞书授权过期,请重新配置');
    }else if(msg.includes('network')||msg.includes('timeout')){
      showToast('网络超时,请检查网络后重试');
    }else{
      showToast('拉取失败: '+msg);
    }
  }finally{
    if(btn){btn.disabled=false;btn.lastChild.textContent=' 刷新申请';}
  }
}

/**
 * V5.8.2 通过审核——增加权限验证+错误处理+JSDoc
 * 方案4步骤一：检查权限配置(组长才能审核)
 * 方案4步骤三：处理审核请求返回的状态码
 * @param {string} id - 用户ID
 * @returns {void}
 */
function approveMember(id){
  // V10.0修复: 权限验证——组长角色为'admin'(非'leader'),旧版检查role!=='leader'
  // 导致组长永远无法通过审核(条件恒为true,始终return),是问题3的直接根因
  if(!state.currentUser||!isLeader()){
    showToast('权限不足: 仅组长可审核注册申请');
    return;
  }
  const u=USERS.find(x=>x.id===id);
  if(!u){showToast('用户不存在');return;}
  showConfirm('通过审核',`确认通过「${u.name}(${u.phone})」的注册申请？`,async()=>{
    try{
      hapticFeedback(); // V10.1: 触觉反馈,操作即时可感知
      u.status='active';saveUsers(USERS);renderMemberList();
      showToast(`✅ 已通过「${u.name}」的注册申请`);
      updateMembersBadge(); // V10.1: 审批后立即刷新红点
      await pushApprovedUsersToFeishu().catch(err=>{
        console.error('[审核] 推送审批结果失败:',err);
        showToast('已通过,但云端同步失败,稍后自动重试');
      });
      deletePendingFileFromFeishu(u.phone).catch(err=>{
        console.warn('[审核] 删除云端申请文件失败:',err.message);
      });
    }catch(err){
      console.error('[审核] 审批流程异常:',err);
      showToast('审批操作异常,请重试');
    }
  });
}

/**
 * V5.8.2 拒绝审核——增加权限验证+错误处理+JSDoc
 * @param {string} id - 用户ID
 * @returns {void}
 */
function rejectMember(id){
  // V10.0修复: 权限验证使用isLeader()(role==='admin'),旧版role!=='leader'恒为true
  if(!state.currentUser||!isLeader()){
    showToast('权限不足: 仅组长可审核注册申请');
    return;
  }
  showConfirm('拒绝注册',`确定拒绝「${USERS.find(x=>x.id===id)?.name||'该组员'}」的注册申请？`,async()=>{
    const idx=USERS.findIndex(u=>u.id===id);
    if(idx>-1){
      hapticFeedback(); // V10.1: 触觉反馈,操作即时可感知
      USERS[idx].status='rejected';saveUsers(USERS);renderMemberList();
      showToast(`已拒绝「${USERS[idx].name}」的注册申请`);
      updateMembersBadge(); // V10.1: 拒绝后立即刷新红点
      pushApprovedUsersToFeishu().catch(err=>{
        console.error('[审核] 推送拒绝结果失败:',err);
      });
      // V5.7: 拒绝同样清理云端申请文件
      deletePendingFileFromFeishu(USERS[idx].phone).catch(err=>{
        console.warn('[审核] 删除云端申请文件失败:',err.message);
      });
    }
  });
}

function deleteMember(id){
  // V10.1: 纵深防御——删除组员同样校验组长权限(旧版仅靠入口隐藏,绕过入口即无防护)
  if(!state.currentUser||!isLeader()){
    showToast('权限不足: 仅组长可删除组员账号');
    return;
  }
  const target=USERS.find(u=>u.id===id);
  // V10.3 问题3: 禁止误删组长账号(组长间互删会破坏审批链)
  if(!target||target.role==='admin'){
    showToast('仅可删除组员账号');
    return;
  }
  showConfirm('删除组员',`确定删除组员「${target.name}」的账号？删除后对方端将在1分钟内收到通知并强制退出。`,async()=>{
    // A3状态守卫: 删除走State API(按手机号,与按id查找等价——phone唯一); 其余流程不变
    if(State.removeUser(target.phone)){
      hapticFeedback(); // V10.1: 触觉反馈,操作即时可感知
      saveUsers(USERS);renderMemberList();
      updateMembersBadge(); // V10.1: 删除后立即刷新红点
      // V10.3 问题3/5.1: 删除必须可靠同步到飞书云端——云端用户表是组员端
      // 存活守卫的判定依据,推送失败组员端就永远不会收到"被删"通知
      showToast('正在同步删除到飞书云端...');
      let pushed=await pushApprovedUsersToFeishu();
      if(!pushed){
        // 一次重试(网络抖动容错),再失败则明确告警
        await new Promise(r=>setTimeout(r,1500));
        pushed=await pushApprovedUsersToFeishu();
      }
      if(pushed){
        showToast(`已删除「${target.name}」,对方端将在1分钟内被强制退出`);
      }else{
        showToast('⚠️ 账号已在本地删除,但云端同步失败,对方端暂无法收到通知,请检查网络后重试同步');
      }
    }
  });
}

async function resetMemberPass(id){
  const u=USERS.find(x=>x.id===id);
  if(u){
    // V5.4: 重置密码时哈希化存储
    const salt = genSalt();
    u.password = await hashPassword('123456', salt);
    saveUsers(USERS);
    showToast(`已重置${u.name}的密码为123456`);pushApprovedUsersToFeishu();
  }
}

// ===================== PASSWORD =====================
async function changePassword(){
  const o=document.getElementById('pw-old').value.trim();
  const n=document.getElementById('pw-new').value.trim();
  const c=document.getElementById('pw-confirm').value.trim();
  if(!o||!n||!c){showToast('请填写所有字段');return;}
  if(n.length<6){showToast('新密码至少6位');return;}
  if(n!==c){showToast('两次输入的新密码不一致');return;}
  if(!state.currentUser){showToast('请先登录');return;}
  // V5.4: 验证原密码（兼容明文旧密码和哈希新密码）
  let oldOk = false;
  if (state.currentUser.password && state.currentUser.password.includes('$')) {
    oldOk = await verifyPassword(o, state.currentUser.password);
  } else {
    oldOk = (state.currentUser.password === o);
  }
  if (!oldOk) { showToast('原密码错误'); return; }
  const salt = genSalt();
  const hashedNew = await hashPassword(n, salt);
  state.currentUser.password = hashedNew;
  const u=USERS.find(x=>x.id===state.currentUser.id);
  if(u){u.password=hashedNew;saveUsers(USERS);}
  localStorage.setItem('tcg_session',JSON.stringify({uid:state.currentUser.id,phone:state.currentUser.phone,ts:Date.now()}));
  showToast('密码修改成功');
  showScreen('screen-my');
}

// ===================== TOGGLE =====================
function toggleSwitch(el){el.classList.toggle('on');}

// ===================== V5.8.2 输入验证与错误边界(方案5代码优化) =====================
/**
 * 验证字符串输入——防止注入和脏数据
 * @param {*} val - 待验证值
 * @param {number} [maxLen=200] - 最大长度
 * @returns {string} 清理后的字符串
 */
function sanitizeStr(val,maxLen){
  maxLen=maxLen||200;
  if(typeof val!=='string')return'';
  return val.replace(/[<>"'&]/g,'').slice(0,maxLen);
}

/**
 * 验证手机号格式
 * @param {string} phone - 手机号
 * @returns {boolean} 是否合法
 */
function isValidPhone(phone){
  return/^1[3-9]\d{9}$/.test(phone||'');
}

/**
 * 安全执行异步函数——错误边界包装器
 * @param {Function} fn - 异步函数
 * @param {string} [context] - 错误上下文描述
 * @returns {Promise<*>}
 */
async function safeAsync(fn,context){
  try{
    return await fn();
  }catch(err){
    console.error(`[错误边界:${context||'unknown'}]`,err);
    showToast('操作异常: '+(err.message||'未知错误'));
    return null;
  }
}

/**
 * 防抖函数——性能优化(方案5步骤三)
 * @param {Function} fn - 目标函数
 * @param {number} [delay=300] - 延迟毫秒
 * @returns {Function} 防抖后的函数
 */
function debounce(fn,delay){
  delay=delay||300;
  let timer=null;
  return function(){
    const args=arguments,ctx=this;
    clearTimeout(timer);
    timer=setTimeout(()=>fn.apply(ctx,args),delay);
  };
}

// ===================== TOAST =====================
function showToast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer=setTimeout(()=>t.classList.remove('show'),1500);
}

/* ===== V5.3.6 通知与安装工具 ===== */
function ensureNotifyPermission(cb) {
    if (!window.cordova || !cordova.plugins || !cordova.plugins.notification || !cordova.plugins.notification.local) {
        if (cb) cb(false);
        return;
    }
    cordova.plugins.notification.local.hasPermission(function (granted) {
        if (granted) { if (cb) cb(true); }
        else {
            cordova.plugins.notification.local.requestPermission(function (g) {
                if (cb) cb(g);
            });
        }
    });
}
function leaderNotify(title, text) {
    if (!window.cordova || !cordova.plugins || !cordova.plugins.notification || !cordova.plugins.notification.local) {
        showToast(text);
        return;
    }
    cordova.plugins.notification.local.schedule({
        id: 10001,
        title: title || '审批提醒',
        text: text,
        foreground: true,
        vibrate: true,
        sound: true,
        priority: 2,
        channel: 'leader_approval',
        channelName: '组长审批提醒',
        channelDescription: '新成员注册待审批通知',
        lockscreen: true
    });
}
function downloadAndInstallApk() {
    if (!window.cordova || !cordova.plugin || !cordova.plugin.http) {
        showToast('浏览器环境不支持应用内安装，将跳转浏览器下载');
        setTimeout(downloadApkDirect, 800);
        return;
    }
    var btn = document.getElementById('btn-install-apk');
    if (btn) { btn.disabled = true; btn.textContent = '正在下载…(约15MB)'; }
    showToast('开始下载更新包…');
    // V5.7.1: 旧版硬编码 v5.3.6 资产名, 版本一升即断链; 改为动态解析 version.json 直链
    var url = (typeof resolveApkUrl === 'function' && resolveApkUrl(latestUpdateInfo)) ||
               'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v5.7/tcg_poweroff_v5.7.0.apk';
    var filePath = (cordova.file.externalCacheDirectory || cordova.file.cacheDirectory) + 'tcg_update.apk';
    cordova.plugin.http.downloadFile(url, {}, {}, filePath, function(entry) {
        showToast('下载完成，准备安装…');
        if (btn) { btn.textContent = '正在安装…'; }
        var absPath = entry.filePath || filePath;
        if (absPath.indexOf('file://') === 0) absPath = absPath.substring(7);
        if (window.cordova && cordova.plugins && cordova.plugins.fileOpener2) {
            cordova.plugins.fileOpener2.open(absPath, 'application/vnd.android.package-archive', {
                error: function(e) {
                    console.error('安装失败', e);
                    showToast('安装器调用失败，请使用浏览器下载');
                    if (btn) { btn.disabled = false; btn.textContent = '应用内下载并安装'; }
                    setTimeout(downloadApkDirect, 500);
                },
                success: function() {
                    showToast('已唤起系统安装器');
                    if (btn) { btn.disabled = false; btn.textContent = '应用内下载并安装'; }
                }
            });
        } else {
            showToast('缺少安装插件，跳转浏览器下载');
            if (btn) { btn.disabled = false; btn.textContent = '应用内下载并安装'; }
            downloadApkDirect();
        }
    }, function(response) {
        console.error('下载失败', response);
        showToast('下载失败(' + (response.status || '??') + ')，切换浏览器下载');
        if (btn) { btn.disabled = false; btn.textContent = '应用内下载并安装'; }
        setTimeout(downloadApkDirect, 500);
    });
}
/* ===== V5.3.6 通知与安装工具结束 ===== */


// ===================== CHECK UPDATE =====================
let latestUpdateInfo=null;

function versionNewer(a,b){
  const pa=String(a).replace(/[^0-9.].*$/,'').split('.').map(n=>parseInt(n)||0);
  const pb=String(b).replace(/[^0-9.].*$/,'').split('.').map(n=>parseInt(n)||0);
  for(let i=0;i<Math.max(pa.length,pb.length);i++){
    const x=pa[i]||0,y=pb[i]||0;
    if(x>y)return true;
    if(x<y)return false;
  }
  return false;
}

/**
 * 获取最新版本信息 - 多源全量探测,返回版本号最高的一条
 * 为什么不逐源首个成功即返回: CDN(如jsDelivr)可能缓存过期version.json,
 * 首个成功源若为旧缓存会误判"已是最新",用户将永远收不到新版本推送;
 * 全部探测后取最高版本,任一源为最新即可触发更新提示
 * @returns {Promise<Object|null>} 版本号最高的version.json内容
 */
async function fetchUpdateInfo(){
  let best=null;
  const consider=(data)=>{
    if(data&&data.version&&(!best||versionNewer(data.version,best.version)))best=data;
  };
  /**
   * 带超时的httpFetch包装 - V5.3统一走原生HTTP通道
   * 为什么: 真机WebView直连fetch虽CDN源带CORS头,但弱网下无超时会无限挂起;
   * 统一httpFetch保证APP环境走原生网络栈,行为与飞书请求一致,便于排查。
   */
  const fetchWithTimeout=async(url)=>{
    return Promise.race([
      httpFetch(url,{method:'GET'}),
      new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),8000))
    ]);
  };
  for(const url of UPDATE_SOURCES){
    try{
      const data=await fetchWithTimeout(url+'?t='+Date.now());
      consider(typeof data==='object'?data:null);
    }catch(e){/* try next source */}
  }
  try{
    const j=await fetchWithTimeout(UPDATE_API_SOURCE+'&t='+Date.now());
    if(j&&j.content){
      const bin=atob(String(j.content).replace(/\s/g,''));
      const bytes=new Uint8Array(bin.length);
      for(let k=0;k<bin.length;k++)bytes[k]=bin.charCodeAt(k);
      const data=JSON.parse(new TextDecoder('utf-8').decode(bytes));
      consider(data);
    }
  }catch(e){/* github api source failed */}
  try{
    const cfg=DEFAULT_FEISHU_CONFIG;
    if(cfg.appId){
      const data=await downloadJsonFromFeishu(cfg,'version.json');
      consider(data);
    }
  }catch(e){/* feishu fallback failed */}
  return best;
}

async function checkUpdate(silent){
  const verEl=document.getElementById('update-current-ver');
  if(verEl)verEl.textContent='当前版本 V'+APP_VERSION;
  if(!silent)showToast('正在检查更新...');
  const info=await fetchUpdateInfo();
  if(!info){
    if(!silent)showToast('检查更新失败，请检查网络后重试');
    return;
  }
  latestUpdateInfo=info;
  if(!versionNewer(info.version,APP_VERSION)){
    if(!silent)showToast('已是最新版本 V'+APP_VERSION);
    return;
  }
  const skipped=localStorage.getItem('update_skipped_ver');
  if(silent&&skipped===String(info.version))return;
  document.getElementById('update-title').textContent='发现新版本 '+(info.versionName||('V'+info.version));
  document.getElementById('update-meta').textContent='发布日期：'+(info.date||'')+' · 当前版本 V'+APP_VERSION;
  const clEl=document.getElementById('update-changelog');
  const items=Array.isArray(info.changelog)?info.changelog:[];
  clEl.innerHTML=items.map(c=>'<div class="flex items-start gap-2"><span class="text-blue-500 mt-0.5">•</span><span>'+esc(c)+'</span></div>').join('')||'<div class="flex items-start gap-2"><span class="text-blue-500 mt-0.5">•</span><span>性能优化与问题修复</span></div>';
  document.getElementById('update-size').textContent=info.apkSize?('安装包大小：'+info.apkSize+' · 直链下载已就绪'):'直链下载已就绪';
  openModal('modal-update');
}

function openExternal(url){
  try{
    if(window.cordova&&cordova.InAppBrowser){
      cordova.InAppBrowser.open(url,'_system');
    }else{
      window.open(url,'_blank');
    }
  }catch(e){window.open(url,'_blank');}
}

/**
 * 解析当前版本的安装包直链(V5.3.3)
 * 为什么字段三级回退: 旧版version.json只有apkUrl(且V5.3断链), 新版由CI回写downloadUrl;
 * 兜底规则保证任何历史版本的version.json都能解出可用地址
 * @returns {string|null} 可直接下载的APK直链
 */
function resolveApkUrl(info){
  if(!info)return null;
  // 1) 新字段: CI按实际Release资产回写的直链
  if(info.downloadUrl&&/^https:\/\//.test(info.downloadUrl))return info.downloadUrl;
  // 2) 兼容旧字段apkUrl: 过滤掉已知断链(V5.3大写tag, 资产实际不存在)
  if(info.apkUrl&&/^https:\/\//.test(info.apkUrl)&&!info.apkUrl.includes('/download/V5.3/'))return info.apkUrl;
  // 3) 按tag命名规则推导(与CI产物命名约定一致: taicanggang-V{ver}-b{build}.apk)
  if(info.version){
    const b=info.buildNumber?('b'+info.buildNumber):'';
    return `https://github.com/${GITHUB_REPO}/releases/download/v${info.version}/taicanggang-V${info.version}${b?('-'+b):''}.apk`;
  }
  return null;
}

/**
 * 直链下载安装包 - V5.3.3主下载通道
 * 为什么走系统浏览器而非应用内下载: APK直链经系统浏览器触发Android原生下载管理器,
 * 无需APP申请存储权限, 下载完成通知栏直接点击安装(要求"未知来源"授权一次);
 * 应用内cordova-plugin-file下载路径在部分国产ROM上因分区存储策略失败率高
 */
function downloadApkDirect(){
  const url=resolveApkUrl(latestUpdateInfo);
  if(!url){showToast('下载地址无效,请使用飞书云盘下载');return;}
  openExternal(url);
  addSyncLog('用户触发直链下载: '+url,'blue');
  showToast('已开始下载,请在通知栏查看进度');
}

/**
 * 兼容旧入口(V5.3.2及以前版本界面调用) - 统一并入直链通道
 */
function downloadUpdate(){
  downloadApkDirect();
}

function downloadFromFeishu(){
  const folder=(latestUpdateInfo&&latestUpdateInfo.feishuFolder)||('https://feishu.cn/drive/folder/'+(DEFAULT_FEISHU_CONFIG.folder||''));
  if(!folder||folder.endsWith('/')){showToast('飞书云盘地址无效');return;}
  openExternal(folder);
  const vn=(latestUpdateInfo&&latestUpdateInfo.versionName)||('V'+APP_VERSION);
  showToast('已打开飞书云盘，请下载「太仓港断电指导'+vn+'.apk」');
}

function openUpdatePage(){
  openExternal((latestUpdateInfo&&latestUpdateInfo.pageUrl)||('https://github.com/'+GITHUB_REPO+'/releases'));
}

function skipUpdate(){
  if(latestUpdateInfo)localStorage.setItem('update_skipped_ver',String(latestUpdateInfo.version));
  closeModal('modal-update');
  showToast('已跳过该版本，可随时手动检查');
}

// ===================== HARDWARE BACK (V5.3) =====================
/**
 * Android硬件返回键统一路由 - V5.3核心修复(问题3)
 * 为什么需要: Cordova默认行为是history.back(),与本APP自研导航栈(navHistory)脱节,
 * 真机上按返回键会直接退出APP或无响应,与页面上的返回按钮行为不一致。
 * 统一路由优先级: 全屏查看器 → 弹层 → 登录页(不退出) → 子页面返回 → 主Tab双击退出
 */
let lastBackPressTs=0;
