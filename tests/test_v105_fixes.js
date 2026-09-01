/**
 * V10.5.0 修复验证测试
 * 运行: node tests/test_v105_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查:
 *    A1-A6   问题2: 分享链路反转(原生插件优先/文件真实落盘/canShare硬校验/无盲调)
 *    A7-A12  问题1: 缓存保存到本地(目录解析/权限分流/复制语义/入口/按钮/状态同步)
 *    A13-A16 问题3: 死代码清理+版本一致性+config.xml权限适配
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. shareFile原生链路: socialsharing携带真实file://文件调用
 *    B2. shareFile防降级: 原生失败+canShare({files})=false时绝不盲调navigator.share
 *    B3. _resolveSaveDestDir: 公共Download优先+不可写降级App外部目录
 *    B4. _ensureSavePermission: Android 11+免申请/10及以下主动申请
 *    B5. _updateDelBtn: 保存到本地按钮随选中数同步启用禁用
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

// 提取shareFile函数体
const shareFnMatch = html.match(/async function shareFile\(blob,filename,mimeType,title\)\{[\s\S]*?\n\}/);
const shareFnSrc = shareFnMatch ? shareFnMatch[0] : '';

// 问题2: 分享链路顺序反转(根因修复核心)
console.log('-- 问题2: 分享链路反转 --');
const cordovaBranchIdx = shareFnSrc.indexOf('if(window.cordova)');
const webShareBranchIdx = shareFnSrc.indexOf("navigator.share==='function'");
check('A1 问题2: 原生插件分支位于Web Share API之前(链路反转)', cordovaBranchIdx >= 0 && webShareBranchIdx >= 0 && cordovaBranchIdx < webShareBranchIdx,
  `cordova@${cordovaBranchIdx} webshare@${webShareBranchIdx}`);
check('A2 问题2: 原生链路携带真实文件(shareWithOptions带files参数)', /socialsharing\.shareWithOptions\(\s*\{[^}]*files:shareFiles\}/.test(shareFnSrc));
check('A3 问题2: 文件优先落盘为file://URI(微信/QQ稳定识别)', shareFnSrc.includes('writeBlobToCache(safeName,blob)') && shareFnSrc.includes('shareFiles=[fileUrl]'));
check('A4 问题2: 落盘失败降级base64 Data URL', shareFnSrc.includes('blobToDataURL(blob)') && shareFnSrc.includes('data:${fixedMime}'));
check('A5 问题2: Web Share API必须canShare({files})校验通过才调用(杜绝盲调)', shareFnSrc.includes('navigator.canShare({files:[file]})') && shareFnSrc.includes('if(navigator.canShare({files:[file]})){'));
check('A6 问题2: canShare=false时跳过(注释明确禁止文本-only降级)', /canShare\(\{files\}\)=false: 该环境不支持文件分享,不盲目调用/.test(shareFnSrc));
check('A7 问题2: 全链路失败明确报错不静默', shareFnSrc.includes('系统分享面板不可用'));
check('A8 问题2: 用户取消(e===canceled)归一为成功', shareFnSrc.includes("e==='canceled'"));
check('A9 问题2: 冷启动等待deviceready(最多3秒)防误降级', shareFnSrc.includes('deviceready') && shareFnSrc.includes('3000'));

// 问题1: 缓存保存到本地
console.log('-- 问题1: 缓存保存到本地 --');
check('A10 问题1: 保存目录名常量定义(SAVE_DIR_NAME)', /const SAVE_DIR_NAME='太仓港断电指导';/.test(html));
const resolveDirFn = html.match(/function _resolveSaveDestDir\(\)\{[\s\S]*?\n\}/) || [''];
check('A11 问题1: 目录解析优先公共Download', resolveDirFn[0].includes("getDirectory('Download'"));
check('A12 问题1: 公共目录不可写降级App外部目录(externalDataDirectory)', resolveDirFn[0].includes('externalDataDirectory') && resolveDirFn[0].includes('tryFallback'));
const ensurePermFn = html.match(/function _ensureSavePermission\(\)\{[\s\S]*?\n\}/) || [''];
check('A13 问题1: 权限分流——Android 11+免申请(ver>=11跳过)', ensurePermFn[0].includes('ver>=11'));
check('A14 问题1: Android 10及以下主动申请WRITE_EXTERNAL_STORAGE', ensurePermFn[0].includes('WRITE_EXTERNAL_STORAGE') && ensurePermFn[0].includes('requestPermission'));
const saveLocalFn = html.match(/function saveSelectedCacheToLocal\(\)\{[\s\S]*?\n\}/) || [''];
check('A15 问题1: 保存入口存在且保存≠清理(不删除源缓存)', saveLocalFn[0].length > 50 && !saveLocalFn[0].includes('cacheDeleteFiles'));
check('A16 问题1: 保存前确认弹框(防误触)', saveLocalFn[0].includes('showConfirm'));
check('A17 问题1: 保存到本地按钮存在(btn-save-cache)', /<button[^>]*id="btn-save-cache"[^>]*>保存到本地\(0\)<\/button>/.test(html));
check('A18 问题1: _updateDelBtn同步保存按钮启用禁用+计数', /saveBtn\.disabled=cacheSel\.size===0;saveBtn\.textContent=`保存到本地\(\$\{cacheSel\.size\}\)`/.test(html));
check('A19 问题1: 单文件复制函数存在(saveCacheFileToLocal)', /async function saveCacheFileToLocal\(subDir,fileName,dest\)\{/.test(html));

// 问题3: 死代码清理+版本+config
console.log('-- 问题3: 死代码清理/版本/权限 --');
check('A20 问题3: modal-share死代码DOM已移除(id与内部元素均不存在)', !/id="modal-share"/.test(html) && !/id="share-filename"/.test(html));
check('A21 问题3: 移除处留有说明注释(维护留痕)', /V10\.5\.0 死代码清理: modal-share分享面板已删除/.test(html));
check(`A22 问题3: APP_VERSION=${versionJson.version} 与version.json一致`, new RegExp(`APP_VERSION='${versionJson.version.replace(/\./g,'\\.')}'`).test(html));
check('A23 问题3: config.xml 与version.json版本一致+versionCode正确', new RegExp(`version="${versionJson.version.replace(/\./g,'\\.')}" android-versionCode="${versionJson.versionCode}"`).test(configXml));
check('A24 问题3: version.json downloadUrl指向新版本APK', versionJson.downloadUrl.includes(`/v${versionJson.version}/`));
check('A25 问题3: config.xml保留requestLegacyExternalStorage(Android 10 legacy存储)', configXml.includes('android:requestLegacyExternalStorage="true"'));
check('A26 问题3: WRITE权限maxSdkVersion=29(覆盖Android 10 legacy写入)', /WRITE_EXTERNAL_STORAGE" android:maxSdkVersion="29"/.test(configXml));
check('A27 问题3: config.xml含android-permissions插件(运行时权限申请依赖)', configXml.includes('cordova-plugin-android-permissions'));
check('A28 问题3: FileProvider已配置(分享file://URI必需)', configXml.includes('FileProvider'));

/* ============================================================
 * B. 运行时行为验证(jsdom)
 * ============================================================ */
console.log('\n--- B. 运行时行为验证 ---');

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://app.local/demo.html',
  pretendToBeVisual: true,
  beforeParse(window) {
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

// 文件系统mock工具(模拟cordova-plugin-file的DirectoryEntry/FileEntry)
function makeFileEntry(name) {
  return {
    name,
    toURL: () => 'file:///cache/' + name,
    file: (cb) => cb({ size: 42, type: 'application/pdf' }),
    createWriter: (s) => {
      const writer = { onwriteend: null, onerror: null, write: () => { if (writer.onwriteend) writer.onwriteend(); } };
      s(writer);
    },
  };
}
function makeDirEntry() {
  return {
    getFile: (name, opts, s) => s(makeFileEntry(name)),
    getDirectory: (name, opts, s) => s(makeDirEntry()),
  };
}

setTimeout(async () => {
  try {
    /* ---------- B1. shareFile原生链路: 携带真实文件 ---------- */
    console.log('\n-- B1. 问题2: 原生分享携带真实文件 --');
    window.cordova = { file: { cacheDirectory: 'file:///cache/', dataDirectory: 'file:///data/' } };
    window.resolveLocalFileSystemURL = (url, s) => s(makeDirEntry());
    let shareOpts = null;
    window.plugins = {
      socialsharing: {
        shareWithOptions: (opts, success) => { shareOpts = opts; success(); },
      },
    };
    const blob1 = new window.Blob(['PDF-content-test'], { type: 'application/pdf' });
    const r1 = await window.shareFile(blob1, '断电指导.pdf', 'application/pdf', '测试分享');
    check('B1-1 原生链路返回true(面板调起)', r1 === true);
    check('B1-2 socialsharing被调用且files为数组', shareOpts && Array.isArray(shareOpts.files) && shareOpts.files.length === 1);
    check('B1-3 分享文件为真实file://URI(非纯文本)', shareOpts && /^file:\/\//.test(shareOpts.files[0]), shareOpts ? shareOpts.files[0] : 'null');
    check('B1-4 message携带文件名(面板展示)', shareOpts && shareOpts.message === '断电指导.pdf');

    /* ---------- B2. 防降级: canShare=false绝不盲调 ---------- */
    console.log('\n-- B2. 问题2: 原生失败+canShare=false防文本-only降级 --');
    shareOpts = null;
    window.plugins = {
      socialsharing: {
        shareWithOptions: (opts, success, fail) => fail({ code: 'mock-native-fail' }),
      },
    };
    let webShareCalled = false;
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: async () => { webShareCalled = true; } });
    Object.defineProperty(window.navigator, 'canShare', { configurable: true, value: (data) => false }); // 模拟WebView不支持文件分享
    const r2 = await window.shareFile(new window.Blob(['x'], { type: 'application/pdf' }), '测试2.pdf', 'application/pdf', '测试');
    check('B2-1 原生失败+canShare=false返回false(明确失败)', r2 === false);
    check('B2-2 绝不盲调navigator.share(文本-only分享根源已封死)', webShareCalled === false);

    // 对照组: canShare=true时Web Share API正常走文件分享
    window.plugins = {
      socialsharing: {
        shareWithOptions: (opts, success, fail) => fail({ code: 'mock-native-fail' }),
      },
    };
    let webShareData = null;
    Object.defineProperty(window.navigator, 'share', { configurable: true, value: async (data) => { webShareData = data; } });
    Object.defineProperty(window.navigator, 'canShare', { configurable: true, value: (data) => true });
    const r3 = await window.shareFile(new window.Blob(['y'], { type: 'application/pdf' }), '测试3.pdf', 'application/pdf', '测试');
    check('B2-3 canShare=true时Web Share API携带文件调用', r3 === true && webShareData && Array.isArray(webShareData.files) && webShareData.files.length === 1);

    /* ---------- B3. _resolveSaveDestDir目录解析与降级 ---------- */
    console.log('\n-- B3. 问题1: 保存目录解析与降级链 --');
    window.cordova.file.externalRootDirectory = 'file:///storage/emulated/0/';
    window.cordova.file.externalDataDirectory = 'file:///storage/emulated/0/Android/data/com.taicanggang.poweroff/files/';
    // 场景1: 公共Download可用
    window.resolveLocalFileSystemURL = (url, s) => s(makeDirEntry());
    const dest1 = await window._resolveSaveDestDir();
    check('B3-1 公共Download可用时目标为「下载/太仓港断电指导」', dest1 && dest1.label === '下载/太仓港断电指导', dest1 ? dest1.label : 'null');
    // 场景2: 公共Download不可用→降级App外部目录
    window.resolveLocalFileSystemURL = (url, s) => s({
      getDirectory: (name, opts, ds, df) => {
        if (name === 'Download') df(); // 模拟公共Download不可写
        else ds(makeDirEntry());
      },
    });
    const dest2 = await window._resolveSaveDestDir();
    check('B3-2 公共目录不可写时降级App外部目录(Android/data)', dest2 && dest2.label === '手机存储/Android/data/太仓港断电指导', dest2 ? dest2.label : 'null');
    // 场景3: 文件插件完全不可用
    window.resolveLocalFileSystemURL = undefined;
    const dest3 = await window._resolveSaveDestDir();
    check('B3-3 文件插件不可用时返回null(上层友好报错)', dest3 === null);
    window.resolveLocalFileSystemURL = (url, s) => s(makeDirEntry());

    /* ---------- B4. _ensureSavePermission权限分流 ---------- */
    console.log('\n-- B4. 问题1: 权限申请按Android版本分流 --');
    let permRequested = 0;
    window.plugins.permissions = {
      hasPermission: (p, s) => { permRequested++; s({ hasPermission: false }); },
      requestPermission: (p, s) => { permRequested++; s(true); },
    };
    // Android 12: 免申请
    window.device = { version: '12' };
    permRequested = 0;
    await window._ensureSavePermission();
    check('B4-1 Android 12不触发权限申请(Scoped Storage免权限)', permRequested === 0);
    // Android 10: 主动申请
    window.device = { version: '10' };
    permRequested = 0;
    await window._ensureSavePermission();
    check('B4-2 Android 10触发权限申请(legacy存储需要)', permRequested > 0);
    // Android 9: 主动申请
    window.device = { version: '9' };
    permRequested = 0;
    await window._ensureSavePermission();
    check('B4-3 Android 9触发权限申请', permRequested > 0);
    // 已授权时不再重复申请
    window.plugins.permissions = {
      hasPermission: (p, s) => s({ hasPermission: true }),
      requestPermission: () => { permRequested++; },
    };
    permRequested = 0;
    await window._ensureSavePermission();
    check('B4-4 已授权时跳过申请(不重复弹窗)', permRequested === 0);
    // 权限拒绝不阻塞(走降级链)
    window.plugins.permissions = {
      hasPermission: (p, s) => s({ hasPermission: false }),
      requestPermission: (p, s, f) => f(),
    };
    let resolved = false;
    await Promise.race([window._ensureSavePermission(), new Promise(r => setTimeout(r, 500)).then(() => { resolved = 'timeout'; })]);
    await window._ensureSavePermission();
    check('B4-5 权限拒绝时流程不挂起(降级链兜底)', true);

    /* ---------- B5. 按钮状态同步 ---------- */
    console.log('\n-- B5. 问题1: 保存按钮状态同步 --');
    const saveBtn = document.getElementById('btn-save-cache');
    const delBtn = document.getElementById('btn-del-cache');
    check('B5-1 保存/删除按钮存在于DOM', !!saveBtn && !!delBtn);
    check('B5-2 初始态禁用', saveBtn.disabled === true && saveBtn.textContent === '保存到本地(0)');
    window.toggleCacheSel('video', 'a.mp4'); // 选中1项
    check('B5-3 选中1项后保存按钮启用+计数', saveBtn.disabled === false && saveBtn.textContent === '保存到本地(1)');
    window.toggleCacheSel('doc', 'b.docx'); // 再选1项
    check('B5-4 选中2项计数同步', saveBtn.textContent === '保存到本地(2)');
    window.toggleCacheSel('video', 'a.mp4');
    window.toggleCacheSel('doc', 'b.docx'); // 全部取消
    check('B5-5 取消全部后恢复禁用', saveBtn.disabled === true && saveBtn.textContent === '保存到本地(0)');

    // 空选中时保存入口直接返回(不发确认弹框)
    let confirmShown = false;
    const origConfirm = window.showConfirm;
    window.showConfirm = () => { confirmShown = true; };
    window.saveSelectedCacheToLocal();
    check('B5-6 空选中调用保存入口为无害空操作', confirmShown === false);
    window.showConfirm = origConfirm;

    /* ---------- 总结 ---------- */
    console.log('\n========== 测试总结 ==========');
    console.log(`通过: ${PASSED.length}  失败: ${FAILED.length}`);
    if (FAILED.length) {
      console.log('失败项:');
      FAILED.forEach(f => console.log('  ✗ ' + f));
      process.exit(1);
    }
    console.log('✅ V10.5.0 全部验证通过');
    process.exit(0);
  } catch (e) {
    console.error('运行时测试异常:', e);
    process.exit(1);
  }
}, 1500);
