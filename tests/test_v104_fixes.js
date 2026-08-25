/**
 * V10.4.0 根因修复验证测试
 * 运行: node tests/test_v104_fixes.js  (需 jsdom: npm i)
 *
 * 覆盖维度:
 * A. 静态源码检查: 根因修复标记/新增功能代码存在性
 *    A0. 根因: cordova.js桥接层加载(问题1/2/5.1共同根源)
 *    A1. 问题1: 分享链路冷启动加固
 *    A2. 问题2: 视频播放标记+已播放徽标+索引元数据合并
 *    A3. 问题5.1: 全屏进出双语义+关闭先退全屏+返回键全屏优先
 *    A4. 问题4: 滚动容器min-height修复
 *    A5. 问题5.2: 跨端网格员申请静默处理(source标识+跨端徽标)
 *    A6. 问题6: 版本10.4.0一致性
 * B. 运行时行为验证(jsdom加载demo.html真实执行):
 *    B1. markVideoAsPlayed 标记/幂等/占位/文件名归一
 *    B2. _cacheItemHtml 已播放徽标渲染
 *    B3. 全屏退出链路(toggleFullscreen/closeVideoPlayer/handleHardwareBack)
 */
const fs = require('fs');
const path = require('path');
let JSDOM;
try { JSDOM = require('jsdom').JSDOM; }
catch(e) { console.error('请先安装: npm i jsdom'); process.exit(2); }

const REPO = '.';
const html = fs.readFileSync(path.join(REPO, 'demo.html'), 'utf8');
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

// 根因: cordova.js桥接层
check('A1 根因: demo.html已加载cordova.js(三大真机故障共同根源)', /<script src="cordova\.js"><\/script>/.test(html));
check('A2 根因: cordova.js带根因说明注释', /V10\.4\.0 根因修复: 加载Cordova桥接层/.test(html));
check('A3 根因: backbutton注册随deviceready生效(既有代码,桥接层补齐后激活)', /document\.addEventListener\('deviceready',\(\)=>\{[\s\S]*?backbutton/.test(html));

// 问题1: 分享冷启动加固
const shareDetailMatch = html.match(/async function shareVehicleDetail\(\)\{[\s\S]*?\n\}/);
check('A4 问题1: shareVehicleDetail冷启动等待deviceready(最多3秒)', shareDetailMatch && shareDetailMatch[0].includes('deviceready') && shareDetailMatch[0].includes('3000'));
check('A5 问题1: shareVehicleDetail优先原生socialsharing面板', shareDetailMatch && shareDetailMatch[0].includes('socialsharing.share('));

// 问题2: 视频播放标记
check('A6 问题2: markVideoAsPlayed函数存在', /function markVideoAsPlayed\(fileName\)\{/.test(html));
check('A7 问题2: 播放标记钩子挂载(timeupdate+ended,观看≥3秒)', /video\._playedHook=function\(\)\{[\s\S]*?currentTime>=3\|\|video\.ended/.test(html));
check('A8 问题2: 钩子先摘除旧监听防累积', /if\(video\._playedHook\)\{[\s\S]*?removeEventListener\('timeupdate',video\._playedHook\)/.test(html));
check('A9 问题2: 缓存列表渲染「已播放」徽标', /已播放/.test(html) && /item\.meta\.played/.test(html));
check('A10 问题2: cacheSaveBlob合并旧meta(played标记不被落盘冲掉)', /const prev=idx\[bucket\]\[safeName\]\|\|\{\};[\s\S]*?Object\.assign\(\{\},prev\.meta,meta\|\|\{\}\)/.test(html));
check('A11 问题2: markVideoAsPlayed幂等(已标记跳过)', /if\(entry\.meta&&entry\.meta\.played\)return false;/.test(html));
check('A12 问题2: 未落盘视频允许占位登记', /文件尚未落盘\(流式播放中\): 先登记占位/.test(html));

// 问题5.1: 全屏修复
const fsMatch = html.match(/function toggleFullscreen\(\)\{[\s\S]*?\n\}/);
check('A13 问题5.1: toggleFullscreen支持退出全屏(切换语义)', fsMatch && fsMatch[0].includes('fullscreenElement') && fsMatch[0].includes('exitFullscreen'));
check('A14 问题5.1: closeVideoPlayer先退全屏再清媒体源', /关闭播放器前先退出全屏态/.test(html) && /const fsEl=document\.fullscreenElement\|\|document\.webkitFullscreenElement;\s*\n\s*if\(fsEl\)\{[\s\S]*?exitFullscreen/.test(html));
check('A15 问题5.1: closeVideoPlayer摘除播放标记钩子', /closeVideoPlayer[\s\S]{0,2000}video\._playedHook[\s\S]{0,300}removeEventListener\('ended',video\._playedHook\)/.test(html));
check('A16 问题5.1: handleHardwareBack最优先处理全屏退出', /function handleHardwareBack\(\)\{\s*\n\s*\/\/ 0\. V10\.4\.0 问题5\.1[\s\S]*?if\(fsEl\)\{[\s\S]*?return;/.test(html));

// 问题4: 滚动修复
check('A17 问题4: 滚动容器min-height修复(.screen>.scroll-y)', /\.screen>\.scroll-y\{min-height:0;\}/.test(html));

// 问题5.2: 跨端静默处理
check('A18 问题5.2: 注册申请携带source来源标识', /source:'tcg-cordova'/.test(html) && (html.match(/source:'tcg-cordova'/g)||[]).length>=2);
check('A19 问题5.2: 跨端申请判定逻辑(isCrossPlatform)', /const isCrossPlatform=pendingData\.source!=='tcg-cordova';/.test(html));
check('A20 问题5.2: 跨端申请自动激活(status=active)', /u\.crossPlatform=true;\s*\n\s*u\.status='active';/.test(html));
check('A21 问题5.2: 跨端静默计数(crossSilentCount)', /crossSilentCount\+\+/.test(html) && /let crossSilentCount=0;/.test(html));
check('A22 问题5.2: 跨端仅日志留痕不弹通知', /跨端网格员申请\$\{crossSilentCount\}条已静默处理/.test(html));
check('A23 问题5.2: 组员列表「跨端」徽标', /跨端/.test(html) && /u\.crossPlatform[\s\S]{0,200}跨端/.test(html));
check('A24 问题5.2: 本端申请保留人工审批流程(newCount通知)', /本端申请: 原有审批通知流程/.test(html));

// 问题6: 版本一致性(V10.5.0起改为动态校验,对齐v103模式: 三端同版本即可,发版免改测试)
check(`A25 问题6: APP_VERSION=${versionJson.version} 与version.json一致`, new RegExp(`APP_VERSION='${versionJson.version.replace(/\./g,'\\.')}'`).test(html));
check('A26 问题6: config.xml 与version.json版本一致', /version="([0-9.]+)"/.exec(configXml)[1]===versionJson.version, `config=${/version="([0-9.]+)"/.exec(configXml)[1]} json=${versionJson.version}`);
check(`A27 问题6: version.json版本=${versionJson.version} code=${versionJson.versionCode}`, /^\d+\.\d+\.\d+$/.test(versionJson.version)&&Number.isInteger(versionJson.versionCode));
check(`A28 问题6: 同步屏本地版本号v${versionJson.version}`, new RegExp(`>v${versionJson.version.replace(/\./g,'\\.')}<`).test(html));

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

setTimeout(async () => {
  try {
    /* ---------- B1. markVideoAsPlayed 行为验证 ---------- */
    console.log('\n-- B1. 问题2: 视频播放标记 --');
    // 预置索引: 一个已存在的视频条目
    window.localStorage.setItem('tcg_cache_index', JSON.stringify({
      videos: { 'demo_video.mp4': { size: 1024, ts: 1700000000000, meta: { vehicle: '测试车' } } },
      docs: {}
    }));
    const r1 = window.markVideoAsPlayed('demo_video.mp4');
    check('B1-1 已登记视频标记成功返回true', r1 === true);
    let idx = JSON.parse(window.localStorage.getItem('tcg_cache_index'));
    check('B1-2 索引meta.played=true', idx.videos['demo_video.mp4'].meta.played === true);
    check('B1-3 索引meta.lastPlayed已记录', typeof idx.videos['demo_video.mp4'].meta.lastPlayed === 'number');
    check('B1-4 原有meta字段保留(vehicle不丢失)', idx.videos['demo_video.mp4'].meta.vehicle === '测试车');

    const r2 = window.markVideoAsPlayed('demo_video.mp4');
    check('B1-5 幂等: 已标记视频再次调用返回false', r2 === false);

    // 未落盘视频: 占位登记
    const r3 = window.markVideoAsPlayed('new_video.mp4');
    idx = JSON.parse(window.localStorage.getItem('tcg_cache_index'));
    check('B1-6 未落盘视频占位登记返回true', r3 === true);
    check('B1-7 占位条目meta.played=true', idx.videos['new_video.mp4'] && idx.videos['new_video.mp4'].meta.played === true);

    // 文件名归一: 特殊字符替换为下划线
    window.markVideoAsPlayed('视频:前"后.mp4');
    idx = JSON.parse(window.localStorage.getItem('tcg_cache_index'));
    check('B1-8 特殊字符文件名安全归一(:/"→_)', !!idx.videos['视频_前_后.mp4']);

    // 空文件名防御
    check('B1-9 空文件名返回false不抛错', window.markVideoAsPlayed('') === false);

    /* ---------- B2. 已播放徽标渲染 ---------- */
    console.log('\n-- B2. 问题2: 缓存列表已播放徽标 --');
    const playedHtml = window._cacheItemHtml('video', { name: 'a.mp4', size: 100, ts: Date.now(), meta: { played: true } });
    const unplayedHtml = window._cacheItemHtml('video', { name: 'b.mp4', size: 100, ts: Date.now(), meta: {} });
    check('B2-1 播放过的视频渲染「已播放」徽标', playedHtml.includes('已播放'));
    check('B2-2 未播放视频无徽标', !unplayedHtml.includes('已播放'));
    const docBadge = window._cacheItemHtml('doc', { name: 'c.docx', size: 100, ts: Date.now(), meta: { played: true } });
    check('B2-3 文档区不渲染已播放徽标(仅视频)', !docBadge.includes('已播放'));

    /* ---------- B3. 全屏退出链路 ---------- */
    console.log('\n-- B3. 问题5.1: 全屏退出链路 --');
    let exitFsCalls = 0;
    // 模拟处于全屏态
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => document.getElementById('video-element') });
    document.exitFullscreen = () => { exitFsCalls++; return Promise.resolve(); };

    // B3-1 toggleFullscreen: 全屏中→退出
    window.toggleFullscreen();
    check('B3-1 toggleFullscreen全屏中触发exitFullscreen', exitFsCalls === 1);

    // B3-2 closeVideoPlayer: 先退全屏
    document.getElementById('video-player').classList.add('show');
    exitFsCalls = 0;
    window.closeVideoPlayer();
    check('B3-2 closeVideoPlayer退出全屏(exitFullscreen被调)', exitFsCalls === 1);
    check('B3-3 closeVideoPlayer播放器已隐藏', !document.getElementById('video-player').classList.contains('show'));

    // B3-4 handleHardwareBack: 全屏态优先退全屏,不关播放器
    document.getElementById('video-player').classList.add('show');
    exitFsCalls = 0;
    window.handleHardwareBack();
    check('B3-4 handleHardwareBack全屏态触发exitFullscreen', exitFsCalls === 1);
    check('B3-5 全屏态按返回不误关播放器(仍显示,等待二次返回)', document.getElementById('video-player').classList.contains('show'));

    // B3-5 非全屏态按返回→关闭播放器
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    window.handleHardwareBack();
    check('B3-6 非全屏态按返回关闭播放器', !document.getElementById('video-player').classList.contains('show'));

    /* ---------- 总结 ---------- */
    console.log('\n========== 测试总结 ==========');
    console.log(`通过: ${PASSED.length}  失败: ${FAILED.length}`);
    if (FAILED.length) {
      console.log('失败项:');
      FAILED.forEach(f => console.log('  ✗ ' + f));
      process.exit(1);
    }
    console.log('✅ V10.4.0 全部验证通过');
    process.exit(0);
  } catch (e) {
    console.error('运行时测试异常:', e);
    process.exit(1);
  }
}, 1500);
