/**
 * V10.7.0 根因修复验证测试
 * 运行: node tests/test_v107_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查:
 *    A1-A6   问题1: 待审核注册默认通过(本端申请拉取即激活/拒绝不复活/即消费即删/回推云端)
 *    A7-A14  问题2: advanced-http 7参数签名修复+保存即自动同步+云端通知+组员轻量感知
 *    A15-A16 问题3: 组员端侧边菜单隐藏组员管理入口(车型页右上角菜单)
 *    A17-A23 问题4: 全界面自适应(安全区/六维断点/横屏/设备分级/动态版本号)
 *    A24     版本10.7.0三处一致性
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. openSideMenu 角色裁剪(组长显示/组员隐藏组员管理入口)
 *    B2. detectPendingLocalMedia 未上云媒体计数
 *    B3. scheduleAutoSyncAfterSave 防抖不立即执行+权限拦截
 *    B4. httpUploadFile 原生7参数签名(mock cordova捕获实参)
 *    B5. _runAutoSyncAfterSave 无待上云媒体时零云端动作
 *    B6. checkCloudDataUpdate 通知命中走轻量通道(不下载全量JSON)
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const _h = require('./e2e_harness'); // A2拆分兼容: js/*.js defer 内联回原时序 + css/app.css 内联回原文
const html = _h.inlineStylesheets(_h.inlineDeferScripts(fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8')));
const configXml = fs.readFileSync(path.join(REPO, 'config.xml'), 'utf8');
const versionJson = JSON.parse(fs.readFileSync(path.join(REPO, 'version.json'), 'utf8'));

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');

// ---- 问题1: V10.8.0回退——本端恢复人工审批,跨网络保留自动通过 ----
console.log('-- 问题1: V10.8.0回退——本端pending/跨网络自动通过 --');
check('A1 问题1(V10.8.0回退): 本端申请恢复pending态(人工审批)',
  /status='pending'; \/\/ 人工审批/.test(html));
check('A2 问题1(V10.8.0回退): pending用户不再自动转active',
  !/existingUser\.status='active'; \/\/ 默认通过/.test(html));
check('A3 问题1(V10.8.0回退): 已拒绝账号保留拒绝状态',
  /已拒绝账号的新申请保留拒绝状态/.test(html));
check('A4 问题1: 跨网络申请即消费即删云端文件(防轮询重复消费)',
  (html.match(/deletePendingFileFromFeishu\(u\.phone\)/g)||[]).length >= 1);
check('A5 问题1: 跨网络自动通过后回推云端用户表(去抖)',
  /_debouncePushApprovedUsers\(\);/.test(html));
check('A6 问题1(V10.8.0回退): 不再有"新组员已自动通过"通知',
  !/新组员已自动通过/.test(html) && !/无需人工审批/.test(html));

// ---- 问题2: V10.8.0上传签名修复(sendRequest+multipart)+自动同步闭环 ----
console.log('-- 问题2: sendRequest+multipart修复+自动同步+组员通知 --');
check('A7 问题2(V10.8.0修复): sendRequest+serializer multipart替代uploadFile',
  /http\.sendRequest\(\s*'https:\/\/open\.feishu\.cn\/open-apis\/drive\/v1\/files\/upload_all'/.test(html)
  && /serializer:'multipart'/.test(html)
  && !html.includes('http.uploadFile('));
check('A8 问题2: 原生调用同步抛错走reject(不静默吞掉)',
  /reject\(syncErr instanceof Error\?syncErr:new Error\(String\(syncErr\)\)\);/.test(html));
check('A9 问题2: 同步管线单一事实源(手动/自动共用零分叉)',
  /async function _syncUploadPipeline\(\)/.test(html)
  && (html.match(/await _syncUploadPipeline\(\)/g)||[]).length >= 2);
check('A10 问题2: 上传成功写轻量data_update_notice(组员感知通道)',
  /data_update_notice\.json/.test(html) && /type:'data_update_notice'/.test(html));
check('A11 问题2: 保存车型即调度自动同步(8秒防抖)',
  /scheduleAutoSyncAfterSave\(\);\s*\n\s*showToast\('保存成功'\);/.test(html)
  && /const AUTO_SYNC_DEBOUNCE_MS=8000;/.test(html));
check('A12 问题2: 组员端优先读通知文件(轻量),不可用回退全量比对',
  /更新通知读取失败,回退全量比对/.test(html)
  && /'data_update_notice\.json',cfg\.syncSub/.test(html));
check('A13 问题2: 自动同步检出未上云base64媒体才执行(纯文字编辑不惊动云端)',
  /function detectPendingLocalMedia\(\)/.test(html)
  && /data:image\\\//.test(html));
check('A14 问题2: 管线执行中防重入+busy互斥',
  /_autoSyncBusy=true;/.test(html) && /if\(_autoSyncBusy\)return;/.test(html));

// ---- 问题3: 组员端菜单权限 ----
console.log('-- 问题3: 组员端隐藏组员管理入口 --');
check('A15 问题3: 侧边菜单项挂id(side-menu-members)',
  /id="side-menu-members"/.test(html));
check('A16 问题3: openSideMenu按canEdit()裁剪(组长flex/组员none)',
  /smm\.style\.display=canEdit\(\)\?'flex':'none';/.test(html));

// ---- 问题4: 屏幕自适应 ----
console.log('-- 问题4: 全界面自适应近10年主流手机屏 --');
check('A17 问题4: viewport-fit=cover声明(刘海/挖孔安全区前提)',
  /viewport-fit=cover/.test(html));
check('A18 问题4: 四向安全区CSS变量(top/bottom/left/right)',
  /--safe-top:env\(safe-area-inset-top,0px\);--safe-bottom:env\(safe-area-inset-bottom,0px\);--safe-left:env\(safe-area-inset-left,0px\);--safe-right:env\(safe-area-inset-right,0px\);/.test(html));
check('A19 问题4: 动态视口高度100dvh(带100vh回退)',
  /height:100vh;height:100dvh;/.test(html));
check('A20 问题4: 六维断点(小屏/大屏/矮屏/长屏/横屏+文本自缩放纠正)',
  /@media \(max-width:360px\)/.test(html)
  && /@media \(min-width:412px\)/.test(html)
  && /@media \(max-height:620px\)/.test(html)
  && /@media \(min-height:850px\)/.test(html)
  && /@media \(orientation:landscape\)/.test(html)
  && /-webkit-text-size-adjust:100%;text-size-adjust:100%;/.test(html));
check('A21 问题4: 横屏左右安全区内收',
  /\.phone-frame\{padding-left:var\(--safe-left\);padding-right:var\(--safe-right\);\}/.test(html));
check('A22 问题4: 设备分级识别打标(small/standard/large/tall)',
  /data-devclass/.test(html) && /'small':\(w>=412\?'large':'standard'\)/.test(html));
check('A23 问题4: 登录页版本号动态渲染(旧静态V5.1清除)',
  /id="login-ver"/.test(html) && !/>V5\.1 · 2026/.test(html));

// ---- 版本一致性 ----
console.log('-- 版本一致性(动态,发版免改) --');
{
  const htmlVer = /const APP_VERSION='([0-9.]+)';/.exec(html);
  const cfgVer = /version="([0-9.]+)" android-versionCode="(\d+)"/.exec(configXml);
  check('A24 版本三处一致(demo.html/config.xml/version.json)',
    !!htmlVer && !!cfgVer
    && htmlVer[1] === versionJson.version
    && cfgVer[1] === versionJson.version && Number(cfgVer[2]) === versionJson.versionCode
    && versionJson.downloadUrl.includes('v' + versionJson.version),
    `html=${htmlVer&&htmlVer[1]} config=${cfgVer&&cfgVer[1]}/${cfgVer&&cfgVer[2]} json=${versionJson.version}/${versionJson.versionCode}`);
}

/* ============================================================
 * B. 运行时行为验证(jsdom真实执行)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证(jsdom) ---');
const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  resources: 'usable',
  url: 'file://' + path.resolve(REPO, 'demo.html'),
  pretendToBeVisual: true,
  beforeParse(window) {
    // localStorage值mock(file://被jsdom视为opaque origin,原生localStorage抛SecurityError)
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: k => (k in store ? store[k] : null),
        setItem: (k,v) => { store[k]=String(v); },
        removeItem: k => { delete store[k]; },
        clear: () => { for (const k in store) delete store[k]; },
      },
    });
    window.fetch = async () => ({ ok:true, text: async()=>('{}'), json: async()=>({code:0, data:{files:[]}}) });
    window.HTMLCanvasElement.prototype.getContext = () => null;
  },
});
const w = dom.window;
const G = expr => { try { return w.eval(expr); } catch(e) { return {__err:String(e)}; } };
const GAsync = expr => w.eval(expr);

// 兜底看门狗: 若任一异步用例挂起导致总结未打印,30秒后按失败退出(防静默假通过)
const watchdog = setTimeout(() => {
  console.log('\n[看门狗] 30秒超时,测试流程疑似挂起(按失败处理)');
  console.log(`通过: ${PASSED.length}  失败: ${FAILED.length + 1}(含挂起)`);
  process.exit(1);
}, 30000);
watchdog.unref && watchdog.unref();

setTimeout(async () => {
  check('B0 页面加载无JS语法错误(内联脚本已执行)', typeof G('goBack') === 'function' && typeof G('openSideMenu') === 'function');

  // B1: 侧边菜单角色裁剪(问题3核心)
  try {
    const r1 = G(`(function(){
      // 注: state为顶层let声明,不挂window,须在同域eval内直接引用
      state.currentUser={id:1,name:'测试组长',phone:'13800000001',role:'admin',status:'active'};
      openSideMenu();
      const leaderVisible=document.getElementById('side-menu-members').style.display;
      state.currentUser={id:2,name:'测试组员',phone:'13800000002',role:'user',status:'active'};
      openSideMenu();
      const memberVisible=document.getElementById('side-menu-members').style.display;
      return {leaderVisible,memberVisible};
    })()`);
    check('B1 openSideMenu角色裁剪(组长显示flex/组员隐藏none)',
      r1 && r1.leaderVisible === 'flex' && r1.memberVisible === 'none', JSON.stringify(r1));
  } catch(e) {
    check('B1 openSideMenu角色裁剪(组长显示flex/组员隐藏none)', false, e.message);
  }

  // B2: 未上云媒体检测(问题2自动同步的触发判据)
  try {
    const stat = G(`(function(){
      VEHICLES.length=0;
      VEHICLES.push(
        {id:1,photoPaths:['data:image/jpeg;base64,AAA','feishu://cloud/photo1.jpg'],videoPaths:['data:video/mp4;base64,BBB']},
        {id:2,photoPaths:[],videoPaths:['https://example.com/v.mp4']}
      );
      return detectPendingLocalMedia();
    })()`);
    check('B2 detectPendingLocalMedia计数(base64照片1/视频1,云端路径不计)',
      stat && stat.photos === 1 && stat.videos === 1, JSON.stringify(stat));
  } catch(e) {
    check('B2 detectPendingLocalMedia计数(base64照片1/视频1,云端路径不计)', false, e.message);
  }

  // B3: 自动同步调度防抖+权限拦截
  try {
    const r3 = G(`(function(){
      localStorage.setItem('feishu_config',JSON.stringify({appId:'cli_test',appSecret:'test_secret',folder:'fld_test',syncSub:'同步数据'}));
      // 组员身份: 调度应被canEdit()拦截,不设定时器
      state.currentUser={id:2,name:'组员',phone:'13800000002',role:'user',status:'active'};
      _autoSyncTimer=null;
      scheduleAutoSyncAfterSave();
      const memberScheduled=_autoSyncTimer!==null;
      // 组长身份: 应成功调度,但不立即执行(8秒防抖)
      state.currentUser={id:1,name:'组长',phone:'13800000001',role:'admin',status:'active'};
      scheduleAutoSyncAfterSave();
      const leaderScheduled=_autoSyncTimer!==null;
      if(_autoSyncTimer)clearTimeout(_autoSyncTimer);
      _autoSyncTimer=null;
      return {memberScheduled,leaderScheduled};
    })()`);
    check('B3 scheduleAutoSyncAfterSave(组员被拦截/组长防抖调度不立即执行)',
      r3 && r3.memberScheduled === false && r3.leaderScheduled === true, JSON.stringify(r3));
  } catch(e) {
    check('B3 scheduleAutoSyncAfterSave(组员被拦截/组长防抖调度不立即执行)', false, e.message);
  }

  // B4: httpUploadFile原生sendRequest+multipart签名(V10.8.0根因修复)
  try {
    const r4 = await GAsync(`(async()=>{
      const calls=[];
      // mock插件: sendRequest+ponyfills.FormData(V10.8.0改用multipart序列化器)
      window.cordova={plugin:{http:{
        sendRequest:function(url,opts,success,fail){
          calls.push({url:url,method:opts.method,serializer:opts.serializer,
            hasFormData:opts.data instanceof FormData,
            authHeader:opts.headers&&opts.headers.Authorization});
          // 模拟插件: multipart序列化器+FormData合法即同步回调success
          success({data:'{"code":0,"data":{"file_token":"fn_test"}}'});
        },
        ponyfills:{FormData:window.FormData}
      }}};
      const res=await httpUploadFile({token:'t_test',fileName:'x.jpg',folderToken:'fld_test',blob:new Blob(['test'])});
      return {calls,res};
    })()`);
    const c4 = r4 && r4.calls && r4.calls[0];
    check('B4 httpUploadFile原生sendRequest+multipart(V10.8.0签名修复)',
      c4 && c4.url==='https://open.feishu.cn/open-apis/drive/v1/files/upload_all'
      && c4.method==='post'
      && c4.serializer==='multipart'
      && c4.hasFormData===true
      && c4.authHeader==='Bearer t_test'
      && r4.res && r4.res.code === 0,
      c4 ? c4.serializer+'/'+c4.method+' | res.code=' + (r4.res && r4.res.code) : JSON.stringify(r4).substring(0,120));
  } catch(e) {
    check('B4 httpUploadFile原生sendRequest+multipart(V10.8.0签名修复)', false, e.message);
  }

  // B5: 自动同步执行体——无待上云媒体时零动作
  try {
    const r5 = await GAsync(`(async()=>{
      VEHICLES.length=0;
      VEHICLES.push({id:1,photoPaths:['feishu://cloud/ok.jpg'],videoPaths:[]}); // 全部已上云
      state.currentUser={id:1,name:'组长',phone:'13800000001',role:'admin',status:'active'};
      await _runAutoSyncAfterSave();
      return {busyAfter:_autoSyncBusy};
    })()`);
    check('B5 _runAutoSyncAfterSave无新媒体时静默返回(不触发云端)',
      r5 && r5.busyAfter === false, JSON.stringify(r5));
  } catch(e) {
    check('B5 _runAutoSyncAfterSave无新媒体时静默返回(不触发云端)', false, e.message);
  }

  // B6: 组员端轻量通知感知——命中通知即返回,不下载全量JSON
  try {
    const r6 = await GAsync(`(async()=>{
      // 构造: 本地水位早于通知 → 应命中"有新数据"
      localStorage.setItem('feishu_sync_data',JSON.stringify({timestamp:'2026-08-20T00:00:00.000Z',version:'v10.6.0'}));
      localStorage.setItem('feishu_config',JSON.stringify({appId:'cli_test',appSecret:'test_secret',folder:'fld_test',syncSub:'同步数据'}));
      state.currentUser={id:2,name:'组员',phone:'13800000002',role:'user',status:'active'};
      // mock: 通知文件返回新时间戳; 全量下载被调用则标记
      window.__fullDownloadCalled=false;
      window.getFeishuToken=async()=>'t_mock';
      window.downloadJsonFromDataFeishu=async(token,name,sub)=>{
        if(name==='data_update_notice.json')return {type:'data_update_notice',version:'v10.7.0',timestamp:'2026-08-25T00:00:00.000Z',vehicleCount:8,uploadedBy:'组长'};
        return null;
      };
      window.downloadSyncDataMigrated=async()=>{window.__fullDownloadCalled=true;return null;};
      await checkCloudDataUpdate(true);
      const dotVisible=!document.getElementById('sync-new-dot').classList.contains('hidden');
      return {dotVisible,fullDownloadCalled:window.__fullDownloadCalled};
    })()`);
    check('B6 checkCloudDataUpdate轻量通道(通知命中亮红点+跳过全量下载)',
      r6 && r6.dotVisible === true && r6.fullDownloadCalled === false, JSON.stringify(r6));
  } catch(e) {
    check('B6 checkCloudDataUpdate轻量通道(通知命中亮红点+跳过全量下载)', false, e.message);
  }

  // ===== 汇总 =====
  console.log('\n========== 测试总结 ==========');
  console.log(`通过: ${PASSED.length}  失败: ${FAILED.length}`);
  if (FAILED.length) { console.log('失败项:', FAILED.join(', ')); process.exit(1); }
  console.log('✅ V10.7.0 全部验证通过');
  process.exit(0);
}, 1500);
