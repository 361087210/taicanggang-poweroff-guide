/* ===========================================================
 * 模块: 08-main.js
 * 功能: 硬件返回/migrateLegacyMedia/deviceready入口/顶层side-effects
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js, 03-vehicles.js, 04-export.js, 05-sync.js, 06-media.js, 07-cache.js
 * 源范围: demo.html L7010-L7172
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
function handleHardwareBack(){
  // 0. V10.4.0 问题5.1: 视频处于全屏态 → 先退出全屏(不全屏态关播放器)
  // 根因: 部分ROM在全屏态下backbutton事件被WebView全屏层拦截或不派发,
  // 显式优先处理全屏退出,保证"全屏→按返回→退全屏→再按返回→关播放器"的
  // 标准交互链路;退全屏放在最前,不与弹层/播放器逻辑耦合
  const fsEl=document.fullscreenElement||document.webkitFullscreenElement;
  if(fsEl){
    if(document.exitFullscreen){const p=document.exitFullscreen();if(p&&p.catch)p.catch(()=>{});}
    else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
    return;
  }
  // 1. 照片查看器打开 → 关闭查看器
  const pv=document.getElementById('photo-viewer');
  if(pv&&pv.classList.contains('show')){closePhotoViewer();return;}
  // 2. 视频播放器打开 → 关闭播放器
  const vp=document.getElementById('video-player');
  if(vp&&vp.classList.contains('show')){closeVideoPlayer();return;}
  // 3. 任一弹层打开 → 关闭最上层弹层(按DOM顺序取最后一个)
  const openModals=Array.from(document.querySelectorAll('.modal-overlay.show'));
  if(openModals.length>0){closeModal(openModals[openModals.length-1].id);return;}
  // 4. 登录页 → 不响应(避免误触退出,双击才退)
  // V5.7修复: 旧版判断state.screen==='login'永不成立(实际值为'screen-login',带前缀),
  // 导致登录页按返回键错误地走goBack弹栈,跳回注册/忘记密码页而非退出确认
  if(state.screen==='screen-login'){doubleBackExit();return;}
  // 5. 主Tab页面 → 双击退出
  if(['screen-vehicles','screen-data','screen-my'].includes(state.screen)){
    doubleBackExit();return;
  }
  // 6. 子页面 → 正常返回上一步
  goBack();
}

/**
 * 双击退出确认 - 2秒内再按一次才退出
 * 为什么不用原生dialog: WebView内confirm在部分ROM上样式异常且阻塞JS线程
 */
function doubleBackExit(){
  const now=Date.now();
  if(now-lastBackPressTs<2000){
    if(navigator.app&&navigator.app.exitApp)navigator.app.exitApp();
  }else{
    lastBackPressTs=now;
    showToast('再按一次返回键退出应用');
  }
}

// 注册硬件返回键(APP环境)与网页回退键(浏览器预览环境)
document.addEventListener('deviceready',()=>{
  document.addEventListener('backbutton',e=>{
    e.preventDefault();
    handleHardwareBack();
  },false);
},false);
window.addEventListener('popstate',()=>{
  // 浏览器预览: 物理返回同样走统一路由,避免导航栈错乱
  if(!window.cordova)handleHardwareBack();
  history.pushState(null,'',location.href);
});
history.pushState(null,'',location.href);

// ===================== MEDIA MIGRATION (V5.3) =====================
/**
 * 旧版媒体数据迁移 - V5.3核心修复(问题1照片根源)
 * 为什么需要: vehicles_data.js由提取脚本生成,photos字段是旧格式字符串数组
 * (如['images/image1.jpeg']),而UI层期望photoPaths路径数组;且数组与数字比较
 * (v.photos>0)恒为false,导致详情页"车辆照片"区块整个不渲染。
 * 另外旧引用的images/目录在打包时实际名为vehicle_images/,需同步修正目录名。
 * 幂等设计: 已迁移数据不会重复处理,每次启动安全执行。
 * @returns {number} 本次迁移修复的车辆数
 */
function migrateLegacyMedia(){
  let fixed=0;
  VEHICLES.forEach(v=>{
    if(Array.isArray(v.photos)&&v.photos.length&&!(v.photoPaths&&v.photoPaths.length)){
      v.photoPaths=v.photos
        .filter(p=>typeof p==='string')
        .map(p=>p.replace(/^images?\//,'vehicle_images/'));
      fixed++;
    }
    // 统一photos/videos字段为数量语义(UI层用v.photos>0判断)
    if(Array.isArray(v.photoPaths))v.photos=v.photoPaths.length;
    if(Array.isArray(v.videoPaths))v.videos=v.videoPaths.length;
  });
  if(fixed>0)console.log('[媒体迁移] '+fixed+'辆车的照片路径已修正为vehicle_images/');
  return fixed;
}

// ===================== INIT =====================
// V5.4: 启动时自动迁移明文密码为哈希（幂等，已哈希的不重复处理）
hashUserPasswords().then(()=>{});
/* V10.6.0 问题4: 启动时序——先恢复IndexedDB持久化快照,再迁移/渲染。
 * 旧版直接同步渲染内置数据,用户新增车辆重启即消失;
 * 现异步恢复快照完成后再走原初始化链(首启无快照时毫秒级直通,行为与旧版一致)。 */
(async()=>{
await loadPersistedVehicles();
// 启动时检查是否有已保存的登录会话,实现免重复登录
migrateLegacyMedia();
if(restoreSession()){
  // 已有有效会话,直接进入主界面
  showScreen('screen-vehicles');
  updateMyInfo();
  // V10.15.6 账号级字段选项云同步: 会话恢复同样静默拉取云端选项(跨设备共享)
  if(typeof syncFieldOptionsFromCloud==='function'){syncFieldOptionsFromCloud();}
  if(state.currentUser&&state.currentUser.role==='admin'){
    pullPendingFromFeishu().then(()=>{renderMemberList();});
    // V5.3.1: 会话恢复同样启动轮询,重启APP后跨网络审批通知不中断
    startPendingPolling();
    // V10.7.0问题1已回退: 不再自动通过历史pending用户,恢复人工审批
  }else if(state.currentUser){
    // V10.3 问题3/5.1: 组员会话恢复同样启动账号存活守卫,被删账号重启APP后立即拦截
    startMemberGuardPolling();
    // V10.3 问题5.2: 启动即检查云端新数据(红点提示)
    checkCloudDataUpdate(true);
  }
}else{
  showScreen('screen-login');
}
renderBrandTags();
renderVehicleList();
loadFeishuConfig();
renderSyncLog();
renderBackupHistory();
})();
(function(){
  const verEl=document.getElementById('update-current-ver');
  if(verEl)verEl.textContent='当前版本 V'+APP_VERSION;
})();
// Silent update check 3s after launch (manual check always available in "我的")
setTimeout(()=>{checkUpdate(true).catch(()=>{});},3000);
// Populate device info
(function(){
  const sw=screen.width||window.innerWidth;
  const sh=screen.height||window.innerHeight;
  const dprEl=document.getElementById('dev-screen');
  const dprEl2=document.getElementById('dev-dpr');
  const pEl=document.getElementById('dev-platform');
  const mEl=document.getElementById('dev-model');
  if(dprEl)dprEl.textContent=sw+'×'+sh;
  if(dprEl2)dprEl2.textContent=(window.devicePixelRatio||1)+'x';
  if(pEl)pEl.textContent=navigator.userAgent.match(/Android/i)?'Android':navigator.userAgent.match(/iPhone|iPad|iPod/i)?'iOS':'Web';
  if(mEl){
    const m=navigator.userAgent.match(/;\s*([^;)]+)\s*[);]/);
    mEl.textContent=m?m[1].trim():navigator.userAgent.substring(0,20);
  }
  /* V10.7.0 问题4: 登录页版本号动态渲染(旧版静态写死"V5.1·2026-08-20",
   * 升级后展示陈旧版本号误导用户)。与"检查更新"入口的当前版本号同源APP_VERSION。 */
  const lv=document.getElementById('login-ver');
  if(lv)lv.textContent='V'+APP_VERSION;
  /* V10.7.0 问题4: 设备分级标记——识别屏幕物理带后给根节点打data-devclass,
   * 供CSS钩子(如[data-devclass="small"]进一步压缩)与真机诊断排查用。
   * 分级标准(近10年主流机型):
   *   small  ≤360px宽     (2016-2019入门机/iPhone SE系)
   *   standard 361-411px  (绝大多数Android/iPhone 12-15)
   *   large  ≥412px       (Pro Max/折叠屏外屏/平板手机)
   * 长屏额外标记tall(高≥850px,21:9带鱼屏)。 */
  const root=document.getElementById('app-root');
  // 防御: 极简DOM环境(单测桩)无setAttribute时不致命
  if(root&&typeof root.setAttribute==='function'){
    const w=Math.min(window.innerWidth,screen.width||window.innerWidth);
    const h=Math.max(window.innerHeight,screen.height||window.innerHeight);
    const cls=w<=360?'small':(w>=412?'large':'standard');
    root.setAttribute('data-devclass',h>=850?cls+' tall':cls);
    console.log('[适配] 设备分级:',cls,(h>=850?'tall ':''),'物理分辨率',sw+'×'+sh,'DPR',window.devicePixelRatio||1);
  }
})();
