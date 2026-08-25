/**
 * V5.7 多维度逻辑测试 - 第二轮 (DOM级模拟: 导航/导出/混淆/数据分仓)
 * 运行: node test_v57_logic.js  (需 jsdom)
 * 注: 页面顶层 const/let 不挂到 window, 统一经 w.eval 取值
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://app.local/demo.html',
  pretendToBeVisual: true,
  beforeParse(window) {
    // crypto.subtle shim (jsdom缺失, 用Node webcrypto补齐)
    const { webcrypto } = require('crypto');
    try { Object.defineProperty(window, 'crypto', { value: webcrypto, configurable: true, writable: true }); }
    catch(_) { window.crypto = webcrypto; }
    // localStorage shim
    const store = {};
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      getItem: k => (k in store ? store[k] : null),
      setItem: (k,v) => { store[k]=String(v); },
      removeItem: k => { delete store[k]; },
      clear: () => { for (const k in store) delete store[k]; },
    });
    // fetch 桩: 飞书API
    window.fetch = async (url, opts) => {
      window.__fetchCalls.push(String(url));
      if (String(url).includes('/auth/v3/tenant_access_token'))
        return { ok:true, json: async()=>({code:0, tenant_access_token:'fake_tenant_token'}) };
      if (String(url).includes('/drive/v1/files/create_folder'))
        return { ok:true, json: async()=>({code:0, data:{token:'fake_folder_token'}}) };
      return { ok:true, json: async()=>({code:0, data:{files:[]}}) };
    };
    window.__fetchCalls = [];
    // 图片预取桩: 永挂起 → 验证超时
    window.__origImage = window.Image;
    window.Image = class { constructor(){ window.__imgCreated = (window.__imgCreated||0)+1; } set src(v){ /* never fires onload */ } };
  },
});

const w = dom.window;
const G = expr => { try { return w.eval(expr); } catch(e) { return undefined; } };

setTimeout(async () => {
  const doc = w.document;
  console.log('='.repeat(62));
  console.log('维度1: 页面加载与全局结构');
  console.log('='.repeat(62));
  check('1.1 demo.html 无JS语法错误(内联脚本已执行)', typeof G('goBack') === 'function');
  check('1.2 APP_VERSION 为语义化三段版本', /^\d+\.\d+\.\d+$/.test(String(G('APP_VERSION'))), String(G('APP_VERSION')));
  check('1.3 DEFAULT_FEISHU_CONFIG 内置凭证', G('DEFAULT_FEISHU_CONFIG.appId') === 'cli_aa0ce4fd91f85be8');
  // V5.7.1 安全规范: 不在代码中比对明文Secret, 改为格式校验(32位) + 可选环境变量比对
  const _decSecret = G('DEFAULT_FEISHU_CONFIG.appSecret');
  check('1.4 内置Secret解码正确(32位格式)', typeof _decSecret === 'string' && /^[A-Za-z0-9]{32}$/.test(_decSecret),
        _decSecret ? `长度${String(_decSecret).length}` : '解码失败');
  if (process.env.TCG_FEISHU_APP_SECRET) {
    check('1.4b 内置Secret与环境变量一致', _decSecret === process.env.TCG_FEISHU_APP_SECRET);
  }
  check('1.5 数据分仓四子目录配置', !!G('DEFAULT_FEISHU_CONFIG.syncSub') && !!G('DEFAULT_FEISHU_CONFIG.pendingSub') && !!G('DEFAULT_FEISHU_CONFIG.approvedSub') && !!G('DEFAULT_FEISHU_CONFIG.backupSub'));

  console.log();
  console.log('='.repeat(62));
  console.log('维度2: 分层返回逻辑 goBack (issue 3)');
  console.log('='.repeat(62));
  // 2.1 照片查看器
  const pv = doc.getElementById('photo-viewer');
  if (pv) {
    pv.classList.add('show');
    G("navHistory=['screen-vehicles']"); G("state.screen='screen-detail'");
    G('goBack()');
    check('2.1 查看器打开→仅关查看器不退页',
      !pv.classList.contains('show') && G('state.screen') === 'screen-detail');
  } else check('2.1 查看器打开→仅关查看器不退页', false, 'photo-viewer元素缺失');

  // 2.2 视频播放器
  const vp = doc.getElementById('video-player');
  if (vp) {
    vp.classList.add('show'); G("state.screen='screen-detail'");
    G('goBack()');
    check('2.2 播放器打开→仅关播放器', !vp.classList.contains('show') && G('state.screen') === 'screen-detail');
  } else check('2.2 播放器打开→仅关播放器', false, 'video-player元素缺失');

  // 2.3 弹层
  const m1 = doc.querySelector('.modal-overlay');
  if (m1) {
    m1.classList.add('show'); G("state.screen='screen-my'");
    G('goBack()');
    check('2.3 弹层打开→仅关弹层', !m1.classList.contains('show') && G('state.screen') === 'screen-my');
  } else check('2.3 弹层打开→仅关弹层', true, '无弹层(跳过)');

  // 2.4 正常历史栈回退 (真实navHistory变量)
  G("state.screen='screen-detail'"); G("navHistory=['screen-vehicles']");
  G('goBack()');
  check('2.4 详情页→车辆列表正常回退', G('state.screen') === 'screen-vehicles');

  // 2.4b V5.7.1 铁壁: 脏栈(无前缀'login')不再崩溃, 回退主Tab
  G("state.screen='screen-detail'"); G("navHistory=['login']");
  G('goBack()');
  check('2.4b 脏栈条目login→安全回主Tab(不崩溃)', G('state.screen') === 'screen-vehicles');

  // 2.4c 启动初始栈卫生: 源码层面验证初始state.screen已带screen-前缀(根因修复)
  check('2.4c 初始state.screen=screen-login(源码级根因修复)',
    /state=\{screen:'screen-login'/.test(html));
  // 2.4d 启动后真实导航栈必须干净(不再有历史脏条目)
  const initStack = (() => { const d2 = new JSDOM(html, {runScripts:'dangerously', url:'https://app.local/', pretendToBeVisual:true,
    beforeParse(window2){ const {webcrypto}=require('crypto'); try{Object.defineProperty(window2,'crypto',{value:webcrypto,configurable:true,writable:true});}catch(_){}
      const store={}; Object.defineProperty(window2,'localStorage',{configurable:true,getItem:k=>k in store?store[k]:null,setItem:(k,v)=>{store[k]=String(v);},removeItem:k=>{delete store[k];},clear:()=>{}});
      window2.fetch=async()=>({ok:true,json:async()=>({code:0})}); }});
    return new Promise(res => setTimeout(()=>res(d2.window.eval('navHistory')), 400)); })();
  check('2.4d 启动后navHistory无脏条目(空或全screen-前缀)', await initStack.then(st => !st || st.every(s => String(s).startsWith('screen-'))), JSON.stringify(await initStack));

  // 2.5 栈空智能兜底
  G("state.screen='screen-edit'"); G("navHistory=[]");
  G('goBack()');
  check('2.5 栈空+编辑页→回车辆列表(智能兜底)', G('state.screen') === 'screen-vehicles');

  G("state.screen='screen-sync'"); G("navHistory=[]");
  G('goBack()');
  check('2.6 栈空+同步页→回数据页', G('state.screen') === 'screen-data');

  G("state.screen='screen-members'"); G("navHistory=[]");
  G('goBack()');
  check('2.7 栈空+组员页→回我的页', G('state.screen') === 'screen-my');

  // 2.8 登录族防御
  G("state.screen='screen-my'"); G("navHistory=['screen-login']");
  G('goBack()');
  check('2.8 登出后返回键不回登录页(防御)', G('state.screen') === 'screen-vehicles');

  console.log();
  console.log('='.repeat(62));
  console.log('维度3: 预取超时保护 preparePhotoMapSafe (issue 2)');
  console.log('='.repeat(62));
  (async () => {
    const t0 = Date.now();
    try {
      const result = await G(`(async()=>{const r=await preparePhotoMapSafe([{id:1,display:'t',photoPaths:['vehicle_images/image1.jpeg']}],600);return {ok:Object.prototype.toString.call(r),len:Object.keys(r||{}).length}})()`);
      const elapsed = Date.now() - t0;
      check('3.1 预取超时不卡死(快速返回)', elapsed < 3000, `${elapsed}ms`);
      check('3.2 超时后返回可用映射对象', result && result.ok === '[object Object]');
    } catch(e) {
      check('3.1 预取超时不卡死(快速返回)', false, e.message);
      check('3.2 超时后返回可用映射对象', false);
    }

    console.log();
    console.log('='.repeat(62));
    console.log('维度4: 飞书配置与数据分仓 (issue 4)');
    console.log('='.repeat(62));
    check('4.1 getFeishuCfg 默认齐全', !!G('(()=>{const c=getFeishuCfg();return c.appId&&c.appSecret&&c.folder&&c.dataFolder})()'));
    check('4.2 feishuCfgReady 默认通过(开箱即用)', G('feishuCfgReady(getFeishuCfg())') === true);
    // 4.3 缓存失效
    G("localStorage.setItem('tcg_sub_同步数据','stale')"); G("localStorage.setItem('tcg_data_folder','stale')");
    G('invalidateDataFolderCache()');
    check('4.3 invalidateDataFolderCache 清空全部缓存',
      G("localStorage.getItem('tcg_sub_同步数据')") === null && G("localStorage.getItem('tcg_data_folder')") === null);

    // 4.4 注册轮询器存在
    check('4.4 startPendingPolling/stopPendingPolling 存在',
      typeof G('startPendingPolling') === 'function' && typeof G('stopPendingPolling') === 'function');
    check('4.5 syncPendingToFeishu/pullPendingFromFeishu 存在',
      typeof G('syncPendingToFeishu') === 'function' && typeof G('pullPendingFromFeishu') === 'function');

    console.log();
    console.log('='.repeat(62));
    console.log('维度5: 导出与vendor依赖 (issue 2)');
    console.log('='.repeat(62));
    const vendorRefs = (html.match(/vendor\/[a-z0-9._-]+\.js/g) || []);
    // V10.6.0: 新增html2canvas(中文PDF画布渲染),本地化依赖5→6个
    check('5.1 vendor导出库被引用(6个)', vendorRefs.length === 6, vendorRefs.join(','));
    check('5.2 Word/Excel/PDF 导出入口齐备(exportData/exportSingle)',
      typeof G('exportData') === 'function' && typeof G('exportSingle') === 'function'
      && /case\s*'word'|format==='word'/.test(html) && /case\s*'pdf'|format==='pdf'/.test(html)
      && /case\s*'excel'|format==='excel'/.test(html));
    check('5.3 分享函数存在(社交分享链路)', typeof G('shareFile') === 'function');

    console.log();
    console.log('='.repeat(62));
    console.log('维度6: 双端数据一致性');
    console.log('='.repeat(62));
    const versionJson = JSON.parse(fs.readFileSync(path.join(REPO, 'version.json'), 'utf8'));
    const appVer = String(G('APP_VERSION'));
    const expectCode = appVer.split('.').reduce((acc,p,i)=>acc + parseInt(p,10)*[10000,100,1][i], 0);
    // V10.3: 版本断言改为动态三端一致(硬编码版本号会在每次发版时陈旧失败)
    check('6.1 version.json 版本与APP_VERSION一致', versionJson.version === appVer, `version.json=${versionJson.version} APP=${appVer}`);
    check('6.2 version.json versionCode与版本号对应', versionJson.versionCode === expectCode, `versionCode=${versionJson.versionCode} 期望=${expectCode}`);
    const cfgXml = fs.readFileSync(path.join(REPO, 'config.xml'), 'utf8');
    check('6.3 config.xml 版本与version.json双一致',
      cfgXml.includes(`version="${versionJson.version}"`) && cfgXml.includes(`android-versionCode="${versionJson.versionCode}"`));
    check('6.4 version.json feishuConfig 与APP内置一致',
      versionJson.feishuConfig && versionJson.feishuConfig.appId === 'cli_aa0ce4fd91f85be8'
      && Array.isArray(versionJson.feishuConfig.dataSubFolders) && versionJson.feishuConfig.dataSubFolders.length === 4);

    console.log();
    console.log('='.repeat(62));
    console.log(`结果: ${PASSED.length} 通过 / ${FAILED.length} 失败`);
    if (FAILED.length) { console.log('失败项:', FAILED); process.exit(1); }
    console.log('逻辑测试全部通过 ✓');
    process.exit(0);
  })().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
}, 400);
