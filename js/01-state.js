/* ===========================================================
 * 模块: 01-state.js
 * 功能: state对象/confirm回调/navHistory+5封装/路由常量/_activateScreen/showScreen/goBack
 * 前置依赖 (defer顺序): 00-bootstrap.js
 * 源范围: demo.html L1803-L1946
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
let state={screen:'screen-login',currentUser:null,viewMode:'tree',currentVehicleId:null,currentVehicleIndex:0,searchQuery:'',brandFilter:'all',selectedVehicles:new Set(),editingVehicle:null,isEditing:false,outdoorMode:false,expandedBrands:new Set(['saic']),recentVehicles:[],photoZoom:1,detailExporting:null,batchExporting:null,backupExporting:false,pendingDetailOpen:null};
let confirmCallback=null;
let confirmCancelCallback=null;
let navHistory=[];
// V10.12: 导航栈统一封装,杜绝散点直操作(曾导致 goBack 页面错乱)
// 用法: navPush/navPop 用于进出栈, navReset 用于清空, navRemove 清理特定屏幕残留
function navPush(id){
  if(LOGIN_FAMILY_SCREENS.includes(id))return;                        // 登录系页面不入栈
  navHistory.push(id);
  if(navHistory.length>1&&navHistory[navHistory.length-1]===navHistory[navHistory.length-2])navHistory.pop(); // 去连续重复(防御性)
  if(navHistory.length>20)navHistory=navHistory.slice(-20);          // 栈深度上限
}
function navPop(){return navHistory.pop();}
function navReset(){navHistory=[];}
function navRemove(id){navHistory=navHistory.filter(s=>s!==id);}
function navTop(){return navHistory[navHistory.length-1];}

// ===================== NAVIGATION =====================
function _activateScreen(id){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  // V5.7.1: 空元素防御——非法id时回退主Tab, 杜绝返回键因脏栈卡死
  const targetEl=document.getElementById(id)||document.getElementById('screen-vehicles');
  if(!targetEl){console.warn('无法激活页面:',id);return;}
  targetEl.classList.add('active','screen-slide');
  const tab=id.replace('screen-','');
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  const navMap={'vehicles':0,'data':1,'my':2};
  if(navMap[tab]!==undefined){document.querySelectorAll('.nav-tab')[navMap[tab]].classList.add('active');}
  state.screen=id;
  if(id==='screen-vehicles')renderVehicleList();
  if(id==='screen-data')renderDataList();
  if(id==='screen-my')renderMemberList();
  const showNav=['screen-vehicles','screen-data','screen-my'].includes(id);
  document.getElementById('bottom-nav').style.display=showNav?'flex':'none';
  document.getElementById('fab-add').style.display=(id==='screen-vehicles'&&canEdit())?'flex':'none';
  if(id==='screen-my'){
    updateMyInfo();
    const memMenu=document.getElementById('menu-members');
    if(memMenu)memMenu.style.display=canEdit()?'flex':'none';
    _refreshCacheHint(); // V10.2: 进入「我的」页刷新缓存管理入口的大小提示
  }
  // V10.0: 组长打开组员管理页立即拉取云端注册申请(非静默,确保有反馈)
  if(id==='screen-members'&&isLeader()){
    pullPendingFromFeishu(false).then(()=>{
      renderMemberList();
    }).catch((e)=>{
      console.warn('[审核] 进入组员管理页拉取申请失败:',e);
      renderMemberList(); // 仍渲染本地缓存的用户列表
    });
  }
  if(id==='screen-password'){
    const acct=document.getElementById('pw-current-account');
    if(acct&&state.currentUser)acct.textContent=state.currentUser.phone;
  }
  if(id==='screen-sync'){
    loadFeishuConfig();
    renderSyncLog();
    // 按角色刷新同步按钮文案（修复静态HTML中模板表达式未渲染导致的字符串错乱）
    const t=document.getElementById('sync-upload-title'),d=document.getElementById('sync-upload-desc');
    if(t)t.textContent=canEdit()?'上传数据至飞书':'从飞书获取数据';
    if(d)d.textContent=canEdit()?'组长：将本地车型数据同步到飞书云':'组员：从飞书云端获取最新数据';
    // V10.3 问题4: 本地版本号动态渲染(旧版静态写死v5.1,升级后显示陈旧版本号)
    const lv=document.getElementById('sync-local-ver');
    if(lv)lv.textContent='v'+APP_VERSION;
    // V10.3 问题5.2: 飞书账号接口配置仅组长可见——组员端隐藏(组员不该也不需要
    // 触碰AppID/Secret等敏感配置,旧版对全员展示既泄露配置入口又造成界面噪音)
    const fc=document.getElementById('feishu-account-config');
    if(fc)fc.style.display=canEdit()?'block':'none';
    // V10.3 问题5.2: 进入同步中心即静默核查云端新数据(节流5分钟)
    checkCloudDataUpdate();
  }
  // V10.3 问题5.2: 进入数据中心静默核查云端新数据→同步入口红点
  if(id==='screen-data'){
    checkCloudDataUpdate();
  }
}

/**
 * 导航系统 - 维护页面历史栈,支持返回上一步
 * 主页面(vehicles/data/my)清除历史栈,子页面入栈
 * V5.7加固: ①连续重复页去重 ②栈深度上限20防泄漏 ③登录族页面不入栈
 */
const MAIN_TAB_SCREENS=['screen-vehicles','screen-data','screen-my'];
const LOGIN_FAMILY_SCREENS=['screen-login','screen-register','screen-forgot'];
function showScreen(id){
  if(state.screen&&state.screen!==id){
    // V10.12: 散点push/去重/限深 → 交给navPush()统一封装(含登录族过滤)
    navPush(state.screen);
  }
  // 主Tab页面清除历史栈,避免跨Tab返回混乱 (仍保留显式判断)
  if(MAIN_TAB_SCREENS.includes(id)){
    navReset();
  }
  _activateScreen(id);
}

/**
 * 返回上一步 - V5.7统一分层返回逻辑(与硬件返回键完全一致)
 * 优先级: 照片查看器 → 视频播放器 → 弹层(侧边菜单/选择器/确认框) → 历史栈 → 智能主Tab
 * 修复: 旧版goBack直接弹栈,查看器/弹层打开时页面返回按钮会连跳两层,行为错乱
 */
function goBack(){
  // 1. 照片查看器打开 → 先关查看器
  const pv=document.getElementById('photo-viewer');
  if(pv&&pv.classList.contains('show')){closePhotoViewer();return;}
  // 2. 视频播放器打开 → 先关播放器
  const vp=document.getElementById('video-player');
  if(vp&&vp.classList.contains('show')){closeVideoPlayer();return;}
  // 3. 任一弹层打开 → 关闭最上层弹层
  const openModals=Array.from(document.querySelectorAll('.modal-overlay.show'));
  if(openModals.length>0){closeModal(openModals[openModals.length-1].id);return;}
  let target=navPop();
  if(!target){
    // 历史栈为空时,根据当前页面返回到主Tab
    const screen=state.screen;
    if(screen==='screen-detail'||screen==='screen-edit'){
      target='screen-vehicles';
    }else if(screen==='screen-sync'){
      target='screen-data';
    }else if(screen==='screen-members'||screen==='screen-password'){
      target='screen-my';
    }else{
      target='screen-vehicles';
    }
    // 直接返回主Tab,不需要再push历史
  }
  // V5.7: 历史栈不应弹出登录族页面(防御兜底,正常流程栈已清理)
  if(LOGIN_FAMILY_SCREENS.includes(target)){
    target='screen-vehicles';
  }
  // V5.7.1 铁壁防御: 栈内出现任何非法页面名(历史遗留无screen-前缀/已删除页面/脏数据)
  // 时直接回主Tab, 绝不让_activateScreen收到不存在的id导致返回键卡死
  if(!document.getElementById(target)){
    target='screen-vehicles';
  }
  _activateScreen(target);
}

// ===================== 状态守卫 (V10.13 A3-3) =====================
/**
 * 顶层可变数组的唯一合法写入门面(P1-2 状态越权治理)
 * 背景: VEHICLES 被 18 个函数直接 push/splice/赋索引, USERS 同样多点直写,
 * 不可追溯谁改的;角色权限位无 guard。
 * 设计(渐进式,不破不变量):
 *   - VEHICLES/USERS 仍为顶层数组(const引用+原地变更), 241个全局函数/117 onclick 零感知;
 *   - 读侧提供副本 getter(防外部误改内部数组);写侧收敛到命名API(增/改/删/替换);
 *   - 交互式写路径必须走 State API;只读代码不受影响。
 * 持久化约定: 单条增改删 API 内部调用 persistVehicles()/由调用方 saveUsers(USERS),
 * 批量/同步场景(pushVehicle/replaceVehicles/addUser)由调用方统一持久化一次。
 */
const State={
  /** 只读副本: 修改副本不影响内部数组(替代直接引用VEHICLES的读侧用法) */
  get vehicles(){return VEHICLES.slice();},
  /** 只读副本: 同上(USERS) */
  get users(){return USERS.slice();},
  /**
   * 新增车辆(创建语义): id自增+必填兜底+拼音+入列+持久化
   * 与旧saveVehicle新增分支逐字段一致(含steps/keyFrame/keyContainer空兜底)
   * @param {object} data {brand,series,config,display,powerType,size,position,steps,keyFrame,keyContainer,remarks,photoPaths,videoPaths}
   * @returns {object} 新建车辆对象(含id/pinyin/photos/videos计数)
   */
  addVehicle(data){
    const maxId=VEHICLES.reduce((m,v)=>Math.max(m,v.id),0);
    const brandObj=BRANDS.find(b=>b.name===data.brand);
    const v={id:maxId+1,brandId:brandObj?brandObj.id:'custom',brand:data.brand,series:data.series,config:data.config,display:data.display,powerType:data.powerType||'纯电',size:data.size,position:data.position,steps:data.steps&&data.steps.length?data.steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:data.keyFrame&&data.keyFrame.length?data.keyFrame:['钥匙数量绑扎检查完'],keyContainer:data.keyContainer&&data.keyContainer.length?data.keyContainer:['车辆进箱无需收钥匙'],remarks:data.remarks,photos:data.photoPaths.length,photoPaths:data.photoPaths,videos:data.videoPaths.length,videoPaths:data.videoPaths,pinyin:getPinyin(data.display)};
    VEHICLES.push(v);
    persistVehicles(); // V10.6.0 问题4: 车辆数据(含文字图片照片)立即持久化,重启不丢,可同步飞书
    return v;
  },
  /**
   * 追加外部预构建车辆对象(同步拉取/备份导入场景, id由云端/备份自带)
   * 不逐条持久化——调用方合并完成后统一 persistVehicles() 一次
   * @returns {object} 追加的对象(便于链式计数)
   */
  pushVehicle(v){VEHICLES.push(v);return v;},
  /**
   * 原地整体替换(保持VEHICLES const引用不变,persistVehicles/渲染闭包均持此引用)
   * 用于启动快照恢复/云端权威数据拉取(正向+反向差集合并后)
   * @returns {number} 替换后的车辆总数
   */
  replaceVehicles(list){VEHICLES.length=0;list.forEach(v=>VEHICLES.push(v));return VEHICLES.length;},
  /**
   * 更新车辆: 找到即合并补丁+持久化;未找到返回null(不抛错,与旧 findIndex 卫语句语义一致)
   * @returns {object|null} 更新后的车辆对象
   */
  updateVehicle(id,patch){
    const v=VEHICLES.find(x=>x.id===id);
    if(!v)return null;
    Object.assign(v,patch);
    persistVehicles(); // V10.6.0 问题4: 同上
    return v;
  },
  /**
   * 删除车辆: splice+持久化;未找到返回false
   * @returns {boolean} 是否删除成功
   */
  removeVehicle(id){
    const idx=VEHICLES.findIndex(v=>v.id===id);
    if(idx>-1){VEHICLES.splice(idx,1);persistVehicles();return true;} // V10.6.0 问题4: 删除同步持久化
    return false;
  },
  /**
   * 追加用户(注册/审批合并/组员创建), 落盘由调用方 saveUsers(USERS) 统一控制
   * @returns {object} 追加的用户对象
   */
  addUser(u){USERS.push(u);return u;},
  /**
   * 按手机号删除用户(云端删除传播/强制登出场景), 落盘由调用方 saveUsers(USERS) 控制
   * @returns {boolean} 是否删除成功
   */
  removeUser(phone){
    const idx=USERS.findIndex(u=>u.phone===phone);
    if(idx>-1){USERS.splice(idx,1);return true;}
    return false;
  },
  /**
   * 前端禁止角色提升(P1-2 tripwire): 用户角色只能由组长审批/云端镜像同步产生,
   * 任何试图在前端把组员提升为组长的调用都是攻击面——直接抛错拒绝。
   */
  promoteToLeader(){throw new Error('禁止前端提权: 用户角色只能由组长审批或云端同步产生');}
};

// ===================== LOGIN =====================
/**
 * 登录系统 - 支持会话持久化
 * 登录成功后保存用户信息到localStorage,下次启动自动恢复
 * 使用JSON序列化避免引用问题,退出时清除会话
 */
