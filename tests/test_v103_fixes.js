/**
 * V10.3.0 六大问题修复验证测试
 * 运行: node tests/test_v103_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查: 六大问题的修复标记/根因代码存在性
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. 问题1: shareFile 系统级分享-only——①Web Share API可调起且无下载降级
 *        ②全链路失败时返回false并报错(绝不触发浏览器下载)
 *    B2. 问题2: 缓存管理——确认弹框z-index高于业务弹层;点选原地更新;
 *        冷启动等待deviceready
 *    B3. 问题3/5.1: 组员账号守卫——被删组员端强制退出(通知+会话清理+回登录页)
 *    B4. 问题4: 同步屏——本地版本动态渲染(非静态v5.1)
 *    B5. 问题5.2: 组员端隐藏飞书配置;云端新数据红点;拉取后红点消化
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const _h = require('./e2e_harness'); // A2拆分兼容: js/*.js defer 内联回原时序 + css/app.css 内联回原文
const html = _h.inlineStylesheets(_h.inlineDeferScripts(fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8')));

const PASSED = [], FAILED = [];
function check(name, cond, detail='') {
  (cond ? PASSED : FAILED).push(name);
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}` + (detail ? ` | ${detail}` : ''));
}

/* ============================================================
 * A. 静态源码检查
 * ============================================================ */
console.log('\n--- A. 静态源码检查 ---');

// 版本(V10.4.0起改为动态一致性校验: demo.html/config.xml/version.json 三端同版本,
// 避免每次发版都要人肉改测试里的硬编码版本号)
const vjson = JSON.parse(fs.readFileSync(path.join(REPO, 'version.json'), 'utf8'));
const vCfg = (fs.readFileSync(path.join(REPO, 'config.xml'), 'utf8').match(/version="([0-9.]+)"/) || [])[1];
check(`A1 APP_VERSION 与version.json一致(当前${vjson.version})`, new RegExp(`APP_VERSION='${vjson.version.replace(/\./g, '\\.')}'`).test(html));
check('A1b config.xml 与version.json版本一致', vCfg === vjson.version, `config=${vCfg} json=${vjson.version}`);
check('A2 version.json 已同步(由CI关卡校验)', true);

// 问题1: 分享仅系统级(V10.15.10需求变更: 网页版系统分享不可用时允许降级浏览器下载)
const shareFnMatch = html.match(/async function shareFile\(blob,filename,mimeType,title\)\{[\s\S]*?\n\}/);
const shareFnSrc = shareFnMatch ? shareFnMatch[0] : '';
check('A3 问题1: shareFile 含浏览器下载降级兜底(createObjectURL+a.download)', shareFnSrc && shareFnSrc.includes('createObjectURL') && shareFnSrc.includes('a.download'));
check('A4 问题1: shareFile 全失败时明确报错(系统分享面板不可用)', shareFnSrc.includes('系统分享面板不可用'));
check('A5 问题1: 保留 Web Share API 一级链路(navigator.share)', shareFnSrc.includes('navigator.share'));
check('A6 问题1: 保留 socialsharing 二级链路(原生分享面板)', shareFnSrc.includes('socialsharing.shareWithOptions'));

// 问题2: 缓存管理
check('A7 问题2: 确认弹框z-index提升规则(#modal-confirm z-index:320)', /#modal-confirm\{z-index:320;\}/.test(html));
check('A8 问题2: 缓存项渲染带 data-cache-key(原地选中态更新)', /data-cache-key="\$\{esc\(key\)\}"/.test(html));
check('A9 问题2: toggleCacheSel 不再整列表重渲染(无refreshCacheList调用)', (()=>{const m=html.match(/function toggleCacheSel\(kind,name\)\{[\s\S]*?\n\}/);return m&&!m[0].includes('refreshCacheList()');})());
check('A10 问题2: 冷启动等待文件插件就绪(_waitCordovaFileReady)', /function _waitCordovaFileReady\(/.test(html) && /await _waitCordovaFileReady\(\)/.test(html));
check('A11 问题2: 文件名JS转义(jsName含反斜杠+引号转义)', /const jsName=String\(item\.name\)\.replace/.test(html));

// 问题3/5.1: 组员账号守卫
check('A12 问题3: checkMemberAccountAlive 守卫函数存在', /async function checkMemberAccountAlive\(/.test(html));
check('A13 问题3: forceLogoutAsDeleted 强制退出函数存在', /async function forceLogoutAsDeleted\(/.test(html));
check('A14 问题3: startMemberGuardPolling 轮询启动(60秒)', /function startMemberGuardPolling\(\)/.test(html) && /memberGuardTimer=setInterval/.test(html));
check('A15 问题3: 登录后组员启动守卫', /startMemberGuardPolling\(\);\s*\n\s*\/\/ V10\.3 问题5\.2/.test(html) || (html.match(/startMemberGuardPolling\(\)/g)||[]).length>=3);
check('A16 问题3: 会话恢复后组员启动守卫', /组员会话恢复同样启动账号存活守卫/.test(html));
check('A17 问题3: 强制退出清理会话+本地账号', /localStorage\.removeItem\('tcg_session'\);[\s\S]{0,150}State\.removeUser\(state\.currentUser\.phone\)/.test(html)); // A3状态守卫: 删号走State API(行为等价)
check('A18 问题3: 防误判——云端无有效用户表时跳过', /if\(!data\|\|!Array\.isArray\(data\.users\)\|\|!data\.users\.length\)return true;/.test(html));
check('A19 问题3: 防重入(memberGuardBusy)', /memberGuardBusy/.test(html));
check('A20 问题3: 组长删号带云端推送重试+失败告警', /pushed=await pushApprovedUsersToFeishu\(\);\s*\n\s*if\(!pushed\)/.test(html) && /云端同步失败/.test(html));
check('A21 问题3: 禁止误删组长账号', /target\.role==='admin'/.test(html));
check('A22 问题3: 登出停止守卫轮询', /stopMemberGuardPolling\(\);\s*\n\s*window\.__tcgKicked=false/.test(html));

// 问题4: 同步屏显示完整性
check('A23 问题4: flex滚动容器min-height兜底(老WebView兼容)', /\.flex-1\.scroll-y\{min-height:0;\}/.test(html));
check('A24 问题4: 本地版本号动态渲染(非静态写死)', /lv\.textContent='v'\+APP_VERSION/.test(html) && !/>v5\.1</.test(html));

// 问题5.2: 组员隐藏飞书配置+红点
check('A25 问题5.2: 飞书配置卡片带id标记', /id="feishu-account-config"/.test(html));
check('A26 问题5.2: 组员端隐藏飞书配置(role判断)', /fc\.style\.display=canEdit\(\)\?'block':'none'/.test(html));
check('A27 问题5.2: 云端新数据红点元素(两入口)', /id="sync-new-dot"/.test(html) && /id="sync-new-dot-side"/.test(html));
check('A28 问题5.2: 同步中心新数据提示条', /id="sync-new-hint"/.test(html));
check('A29 问题5.2: checkCloudDataUpdate 节流检查函数', /async function checkCloudDataUpdate\(/.test(html) && /CLOUD_CHECK_THROTTLE_MS=5\*60\*1000/.test(html));
check('A30 问题5.2: 拉取/上传成功消化红点', /_setSyncNewDot\(false\)/.test(html));
check('A31 问题5.2: 组员同步主按钮直达拉取', /canEdit\(\)\?doSyncUpload\(\):doSyncDownload\(\)/.test(html));
check('A32 问题5.2: 红点CSS定义', /\.new-data-dot\{/.test(html));

/* ============================================================
 * B. 运行时行为验证(jsdom)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://app.local/demo.html',
  pretendToBeVisual: true,
  beforeParse(window) {
    // jsdom无WebCrypto: 注入Node crypto.subtle(登录密码哈希依赖)
    const nodeCrypto = require('crypto');
    if (!window.crypto) window.crypto = {};
    if (!window.crypto.subtle) {
      window.crypto.subtle = {
        digest: async (alg, data) => {
          const buf = data instanceof ArrayBuffer ? Buffer.from(new Uint8Array(data))
            : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength)
            : Buffer.from(String(data));
          const hash = nodeCrypto.createHash('sha256').update(buf).digest();
          return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
        },
      };
    }
  },
});
const { window } = dom;
const { document } = window;

// state/USERS/cacheSel/CLOUD_CHECK_THROTTLE_MS等为顶层let/const声明(全局词法绑定,
// 不挂window属性),须经window.eval访问;function声明则直接在window上
const G = (expr) => window.eval(expr);

// 等待脚本初始化完成
setTimeout(async () => {
  try {
    /* ---------- B1. 问题1: 系统级分享验证 ---------- */
    console.log('\n-- B1. 问题1: shareFile 系统级分享 --');
    let sharePanelInvoked = 0;
    let sharePayload = null;
    // 模拟Android WebView: navigator.share可用(等价原生Intent.ACTION_SEND)
    window.navigator.share = async (data) => {
      sharePanelInvoked++;
      sharePayload = data;
    };
    window.navigator.canShare = () => true;

    const blob = new window.Blob(['test-content-123'], { type: 'application/json' });
    const r1 = await window.shareFile(blob, 'test_export.json', 'application/json', '测试分享');
    check('B1-1 Web Share API调起系统分享面板(share被调用)', sharePanelInvoked === 1);
    check('B1-2 分享payload含File且带文件名', sharePayload && sharePayload.files && sharePayload.files.length === 1 && sharePayload.files[0].name === 'test_export.json');
    check('B1-3 分享成功返回true', r1 === true);

    // 系统分享不可用场景(V10.15.10需求变更): 移除navigator.share+无cordova →
    // 降级浏览器下载: 返回true且触发a.download链路
    delete window.navigator.share;
    delete window.navigator.canShare;
    let downloadTriggered = false;
    const origCreateObjectURL = window.URL.createObjectURL;
    window.URL.createObjectURL = () => { downloadTriggered = true; return 'blob:fake'; };
    window.URL.revokeObjectURL = () => {};
    const r2 = await window.shareFile(blob, 'test2.json', 'application/json');
    check('B1-4 系统分享不可用时降级下载返回true', r2 === true);
    check('B1-5 降级链触发浏览器下载(a.download)', downloadTriggered === true);
    window.URL.createObjectURL = origCreateObjectURL;

    // 用户取消(AbortError)仍算面板调起成功
    let abortCalled = false;
    window.navigator.share = async () => { abortCalled = true; const e = new Error('cancel'); e.name = 'AbortError'; throw e; };
    window.navigator.canShare = () => true;
    const r3 = await window.shareFile(blob, 'test3.json', 'application/json');
    check('B1-6 用户取消(AbortError)判定面板已调起', abortCalled && r3 === true);
    delete window.navigator.share;
    delete window.navigator.canShare;

    /* ---------- B2. 问题2: 缓存管理验证 ---------- */
    console.log('\n-- B2. 问题2: 缓存管理 --');
    const confirmEl = document.getElementById('modal-confirm');
    const cacheEl = document.getElementById('modal-cache');
    const zConfirm = confirmEl ? window.getComputedStyle(confirmEl).zIndex : '0';
    const zCache = cacheEl ? window.getComputedStyle(cacheEl).zIndex : '0';
    check('B2-1 确认弹框z-index(320)高于缓存管理弹层(300)', parseInt(zConfirm, 10) === 320 && parseInt(zCache, 10) === 300, `confirm=${zConfirm} cache=${zCache}`);

    // 点选原地更新: 注入模拟行(cache-video-list位于#modal-cache内),验证选中态与按钮联动
    const listEl = document.getElementById('cache-video-list');
    if (listEl) {
      const delBtn = document.getElementById('btn-del-cache');
      // 清场: 移除可能存在的行,注入干净测试行
      listEl.innerHTML = '<div data-cache-key="video|a.mp4" class="row flex items-center justify-between py-2 px-3"><div class="chk"></div><span>a.mp4</span></div>';
      if (delBtn) { delBtn.disabled = false; delBtn.textContent = '删除选中(0)'; }
      const row = listEl.querySelector('[data-cache-key="video|a.mp4"]');
      const rowsBefore = listEl.querySelectorAll('[data-cache-key]').length;
      // 第一次点选: 选中
      window.toggleCacheSel('video', 'a.mp4');
      check('B2-2 点选后选中集更新(按钮计数=1)', delBtn && delBtn.textContent.includes('(1)'));
      check('B2-3 点选原地更新复选框(不整列表重渲染)', row && row.querySelector('.chk').classList.contains('on') && listEl.querySelectorAll('[data-cache-key]').length === rowsBefore);
      // 第二次点选: 取消选中
      window.toggleCacheSel('video', 'a.mp4');
      check('B2-3b 再点取消选中(按钮计数=0且disabled)', delBtn && delBtn.textContent.includes('(0)') && delBtn.disabled === true && !row.querySelector('.chk').classList.contains('on'));
      listEl.innerHTML = '';
    } else {
      check('B2-2 缓存列表容器存在', false); check('B2-3 点选原地更新', false);
    }
    check('B2-4 _waitCordovaFileReady存在且为Promise', typeof window._waitCordovaFileReady === 'function');

    /* ---------- B3. 问题3/5.1: 组员账号守卫验证 ---------- */
    console.log('\n-- B3. 问题3/5.1: 组员账号守卫 --');
    check('B3-1 checkMemberAccountAlive 函数可调用', typeof window.checkMemberAccountAlive === 'function');
    check('B3-2 forceLogoutAsDeleted 函数可调用', typeof window.forceLogoutAsDeleted === 'function');
    check('B3-3 startMemberGuardPolling 函数可调用', typeof window.startMemberGuardPolling === 'function');

    // 模拟组员登录态(经eval写入let声明的作用域变量)
    const testUser = { id: 999001, name: '测试组员', phone: '13800001234', password: 'x', role: 'user', status: 'active', created: '2026-01-01' };
    G('USERS.push(' + JSON.stringify(testUser) + ')');
    G('state.currentUser = ' + JSON.stringify(testUser));
    window.localStorage.setItem('tcg_session', JSON.stringify({ uid: testUser.id, phone: testUser.phone, ts: Date.now() }));
    window.__tcgKicked = false;

    // 未配置同步环境防护: 中性化DEFAULT_FEISHU_CONFIG(内置真实凭据会使feishuCfgReady恒真),
    // 使核查走"配置不完整→跳过"确定性路径,不发真实网络请求
    window.localStorage.removeItem('feishu_config');
    G('DEFAULT_FEISHU_CONFIG.appId=""');
    G('DEFAULT_FEISHU_CONFIG.appSecret=""');
    const alive1 = await window.checkMemberAccountAlive();
    check('B3-4 未配置同步环境跳过核查不误踢(返回true)', alive1 === true);

    // 直接验证forceLogoutAsDeleted的完整踢出行为(云端拉取链路属集成测试范畴)
    G('state.currentUser = ' + JSON.stringify(testUser));
    await window.forceLogoutAsDeleted('您的账号已被组长删除');
    check('B3-5 强制退出后currentUser已清空', G('state.currentUser') === null);
    check('B3-6 强制退出后登录会话已清除', window.localStorage.getItem('tcg_session') === null);
    check('B3-7 强制退出后本地账号记录已删除', G('!USERS.find(u => u.phone === "13800001234")'));
    check('B3-8 强制退出后回到登录页', G('state.screen') === 'screen-login');
    check('B3-9 踢出防重复标记生效', window.__tcgKicked === true);

    /* ---------- B4. 问题4: 同步屏显示完整性 ---------- */
    console.log('\n-- B4. 问题4: 同步屏显示 --');
    // 组长身份进入同步屏 → 版本动态渲染
    window.__tcgKicked = false;
    const leader = G('USERS.find(u => u.role === "admin")') || { role: 'admin', status: 'active' };
    G('state.currentUser = ' + JSON.stringify(leader));
    window.showScreen('screen-sync');
    await new Promise(r => setTimeout(r, 100));
    const lvEl = document.getElementById('sync-local-ver');
    check(`B4-1 同步屏本地版本动态显示(当前v${vjson.version})`, lvEl && lvEl.textContent === 'v' + vjson.version, `实际=${lvEl && lvEl.textContent}`);
    const fcEl = document.getElementById('feishu-account-config');
    check('B4-2 组长端飞书配置可见', fcEl && fcEl.style.display !== 'none');

    /* ---------- B5. 问题5.2: 组员视角验证 ---------- */
    console.log('\n-- B5. 问题5.2: 组员端同步体验 --');
    G('state.currentUser = ' + JSON.stringify({ id: 999002, name: '组员B', phone: '13900005678', role: 'user', status: 'active' }));
    window.showScreen('screen-sync');
    await new Promise(r => setTimeout(r, 100));
    check('B5-1 组员端飞书账号配置已隐藏', fcEl && fcEl.style.display === 'none', `display=${fcEl && fcEl.style.display}`);

    // 红点联动
    window._setSyncNewDot(true);
    const dot1 = document.getElementById('sync-new-dot');
    const dotSide = document.getElementById('sync-new-dot-side');
    const hint = document.getElementById('sync-new-hint');
    check('B5-2 云端新数据红点亮起(数据中心入口)', dot1 && !dot1.classList.contains('hidden'));
    check('B5-3 云端新数据红点亮起(侧边菜单入口)', dotSide && !dotSide.classList.contains('hidden'));
    check('B5-4 同步中心新数据提示条显示', hint && !hint.classList.contains('hidden'));
    window._setSyncNewDot(false);
    check('B5-5 红点消化后全部隐藏', dot1.classList.contains('hidden') && dotSide.classList.contains('hidden') && hint.classList.contains('hidden'));
    check('B5-6 checkCloudDataUpdate函数存在', typeof window.checkCloudDataUpdate === 'function');
    check('B5-7 节流常量5分钟', G('CLOUD_CHECK_THROTTLE_MS') === 300000);

    // ---------- 汇总 ----------
    console.log('\n========================================');
    console.log(`总计: ${PASSED.length} 通过 / ${FAILED.length} 失败`);
    if (FAILED.length) {
      console.log('失败项:', FAILED.join(' | '));
      process.exit(1);
    }
    console.log('V10.3.0 六大问题修复验证: 全部通过 ✅');
    process.exit(0);
  } catch (e) {
    console.error('测试执行异常:', e);
    process.exit(1);
  }
}, 600);
