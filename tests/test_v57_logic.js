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
let html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');

/** V10.12 A2 拆分后 demo.html 骨架化: 9 个<script defer src="js/*.js">引用。
 *  JSDOM 的 runScripts:'dangerously' 默认不会从本地文件系统拉取子资源(相对路径),
 *  导致 defer 脚本不执行 → goBack/APP_VERSION等全为undefined。
 *  这里做一次性"测试兼容内联":
 *  ① 按文件名排序读 js/*.js, 把 defer 标签替换成等价 <script>…(内容)</script>;
 *  ② 内联内容做 HTML-tokenizer 净化: 字面 </script>(如00-bootstrap注释里的注入
 *     说明)会提前闭合块、<!-- (03-vehicles模板串)会触发script-data-escaped状态机,
 *     均替换为 JS 语义等价转义 <\/script / <\!-- (运行时字符串值不变);
 *  ③ 内联块统一定位到 </body> 之前——原单文件版主 script 就在 body 末尾
 *     (启动INIT副作用依赖已解析的DOM),defer 的真实语义也等价 body-end,
 *     避免 head 内联时 getElementById 拿到 null。
 *  单文件旧版 html 也兼容(未找到 defer tag → 跳过)。 */
(function inlineDeferScripts() {
  const re = /[ \t]*<script[^>]+defer[^>]+src="(js\/[^"]+\.js)"[^>]*><\/script>[ \t]*(?:\r?\n|$)/g;
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return;
  const inlined = [];
  let replaced = html;
  for (const m of matches) {
    replaced = replaced.replace(m[0], ''); // 从原位移除
    const srcFile = path.join(REPO, m[1]);
    if (!fs.existsSync(srcFile)) {
      console.error('[warn] V57 inline: 缺少 ' + srcFile + ' → jsdom可能加载失败');
      continue;
    }
    const content = fs.readFileSync(srcFile, 'utf8')
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
    inlined.push(`<script>\n${content}\n</script>\n`);
  }
  const closeIdx = replaced.lastIndexOf('</body>');
  if (closeIdx >= 0) {
    replaced = replaced.slice(0, closeIdx) + inlined.join('') + replaced.slice(closeIdx);
  } else {
    replaced += inlined.join('');
  }
  html = replaced;
  console.log(`[V57] A2 拆分兼容: 内联 ${inlined.length} 个 js/*.js → 移至</body>前(JSDOM 可直接执行)。`);
})();

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
  check('1.3 DEFAULT_FEISHU_CONFIG 内置公开字段', G('DEFAULT_FEISHU_CONFIG.appId') === 'cli_aa0ce4fd91f85be8');
  // V10.12 安全基线升级: 源码不再硬编码appSecret(XOR key+hex解密函数一同移除,
  // 改为构建期注入window.__BUILD_SECRETS__, 首次getFeishuCfg读取后立即delete)。
  // 安全断言改为: DEFAULT_FEISHU_CONFIG.appSecret 未声明或为空; _fsDec/_FS_XOR_KEY 全局不存在
  const builtInSecret = G('DEFAULT_FEISHU_CONFIG.appSecret');
  check('1.4 DEFAULT_FEISHU_CONFIG.appSecret 源码无硬编码(防反编译还原)',
        builtInSecret === void 0 || builtInSecret === null || String(builtInSecret) === '',
        builtInSecret ? ('仍保留硬编码,长度=' + String(builtInSecret).length) : '已移除硬编码 ✓');
  check('1.4b 旧版_fsDec/_FS_XOR_KEY 已移除(杜绝同源文件内密文+算法还原)',
        typeof G('_fsDec') !== 'function' && typeof G('_FS_XOR_KEY') !== 'string');
  check('1.4c 新注入路径存在: getFeishuCfg读window.__BUILD_SECRETS__并delete',
        typeof G('getFeishuCfg') === 'function' &&
        /window\.__BUILD_SECRETS__/.test(String(G('getFeishuCfg'))) &&
        /delete\s+window\.__BUILD_SECRETS__/.test(String(G('getFeishuCfg'))));
  if (process.env.TCG_FEISHU_APP_SECRET) {
    // 若提供注入环境变量, 模拟构建注入验证归并优先级(手动写入->注入->默认)
    G("window.__BUILD_SECRETS__={appId:'cli_xx',appSecret:'" + String(process.env.TCG_FEISHU_APP_SECRET).replace(/'/g,"\\'") + "',folderToken:'xx'}");
    const after = G("(function(){var c=getFeishuCfg(); return c.appSecret;})()");
    check('1.4d 构建注入Secret优先归并(非localStorage场景)', after === process.env.TCG_FEISHU_APP_SECRET);
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
    /* V10.14.1 修复测试状态污染: 1.4d 用例(设置了TCG_FEISHU_APP_SECRET环境变量时)会
     * 提前消费一次 getFeishuCfg(),注入秘钥按"首读即焚"语义进入闭包缓存
     * _INJECTED_SECRETS_CACHE 并常驻——导致本维度"默认未注入"三断言(4.1/4.2a/4.2c)
     * 全部失真(appSecret非空/ready=true/二次注入不消费)。此处重置闭包缓存,
     * 等价模拟"全新页面加载"的干净初始态;未设置环境变量时本行为幂等无副作用。 */
    G('_INJECTED_SECRETS_CACHE=null');
    // V10.12 安全基线: 默认配置不再含appSecret(与1.4呼应)。"开箱即用"语义迁移为:
    //   默认未配置 → feishuCfgReady=false(安全拦截,提示用户配置) —— 这是正确行为;
    //   构建注入(window.__BUILD_SECRETS__) → 立即就绪 —— 真机APK的实际出厂形态。
    check('4.1 getFeishuCfg 默认齐全(非Secret字段全备+无硬编码Secret)',
      G('(()=>{const c=getFeishuCfg();return c.appId&&c.folder&&c.dataFolder&&c.syncSub&&c.pendingSub&&c.approvedSub&&c.backupSub&&c.interval&&!c.appSecret})()'));
    check('4.2a 默认未注入时 feishuCfgReady=false(安全拦截,非静默失败)',
      G('feishuCfgReady(getFeishuCfg())') === false);
    G("window.__BUILD_SECRETS__={appId:'cli_test',appSecret:'test_secret_for_jsdom_injection_32',folderToken:'fldcnTestToken'}");
    check('4.2b 构建注入后 feishuCfgReady=true(真机APK出厂形态)',
      G('feishuCfgReady(getFeishuCfg())') === true);
    check('4.2c 注入Secret用完即焚(读取后__BUILD_SECRETS__已delete)',
      G('window.__BUILD_SECRETS__') === undefined);
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
      && Array.isArray(versionJson.feishuConfig.dataSubFolders) && versionJson.feishuConfig.dataSubFolders.length === 5);

    console.log();
    console.log('='.repeat(62));
    console.log(`结果: ${PASSED.length} 通过 / ${FAILED.length} 失败`);
    if (FAILED.length) { console.log('失败项:', FAILED); process.exit(1); }
    console.log('逻辑测试全部通过 ✓');
    process.exit(0);
  })().catch(e => { console.error('测试崩溃:', e); process.exit(1); });
}, 400);
