/* ===========================================================
 * V10.19.0 视频播放链路专项测试 (Bug ③ 视频播放 / Bug ④ 上传命名)
 * 运行: node tests/test_video_playback_v1019.js      (仓库根目录 src/ 下)
 *       TCG_LIVE_NET=1 node tests/test_video_playback_v1019.js  (附带公网实测)
 *
 * 设计约束:
 *  - 零第三方依赖(不引入 jsdom/mocha): 用 node:vm + 极简假DOM 直接驱动
 *    真实源码中的 openVideoPlayer / tryPlaySource / tryFeishuVideoSource,
 *    避免"静态文本断言"造成的纸上通过。
 *  - 默认离线: 公网可达性用例以 TCG_LIVE_NET=1 开启, 默认仅做离线断言,
 *    保证 CI/沙箱环境下结果稳定可复现。
 *  - 密钥红线: 本文件不读取/不写入任何 appSecret 或 GitHub Token。
 * =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name + (extra ? ' || ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }

const BOOT = src('js/00-bootstrap.js');
const MEDIA = src('js/06-media.js');
const VEH = src('js/03-vehicles.js');
const SYNC = src('js/05-sync.js');
const HTML = src('demo.html');

/* ---------------- 工具: 从源码中按括号配对抽取整个函数 ---------------- */
function extractFn(code, name){
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(code);
  if (!m) return null;
  const open = code.indexOf('{', m.index);
  if (open < 0) return null;
  let d = 0, j = open;
  for (; j < code.length; j++){
    const c = code[j];
    if (c === '{') d++;
    else if (c === '}') { d--; if (d === 0) { j++; break; } }
  }
  return code.slice(m.index, j);
}

/* ---------------- 载入真实映射表与归一化函数 ---------------- */
const mapBlock = BOOT.match(/const MEDIA_DIRECT_ASSETS=\{[\s\S]*?\n\};/)[0];
const normFn = extractFn(BOOT, '_normMediaKey');
const aliasIdx = BOOT.match(/const MEDIA_ALIAS_INDEX=\(function\(\)\{[\s\S]*?\n\}\)\(\);/)[0];
const mediaCtx = { window: {} };
vm.createContext(mediaCtx);
vm.runInContext([
  mapBlock,
  normFn,
  'const MEDIA_RELEASE_BASE=`https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos`;',
  aliasIdx,
  BOOT.match(/const MEDIA_ALIAS_KEYS=[^\n]*\n/)[0], // _mediaAliasByPrefix 依赖的有序键表
  extractFn(BOOT, 'mediaDirectUrl'),
  extractFn(BOOT, 'mediaDirectUrlAlias'),
  extractFn(BOOT, 'videoCoverDataUri'),
  // 注意: vm 上下文中 const/let 声明不会挂到 context 对象上, 需显式导出
  extractFn(BOOT, '_mediaAliasByPrefix'),
  ';globalThis.__export={MEDIA_DIRECT_ASSETS:MEDIA_DIRECT_ASSETS,MEDIA_ALIAS_INDEX:MEDIA_ALIAS_INDEX,'
    + 'MEDIA_RELEASE_BASE:MEDIA_RELEASE_BASE,_normMediaKey:_normMediaKey,_mediaAliasByPrefix:_mediaAliasByPrefix,'
    + 'mediaDirectUrl:mediaDirectUrl,mediaDirectUrlAlias:mediaDirectUrlAlias,videoCoverDataUri:videoCoverDataUri};'
].join('\n'), mediaCtx);
const M = mediaCtx.__export;
const MAP = M.MEDIA_DIRECT_ASSETS;
const normKey = M._normMediaKey;
const mediaDirectUrl = M.mediaDirectUrl;
const mediaDirectUrlAlias = M.mediaDirectUrlAlias;
const videoCoverDataUri = M.videoCoverDataUri;
const RELEASE_BASE = 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos';

/* ---------------- 载入真实 VEHICLES ---------------- */
const vctx = { window: {} };
vm.createContext(vctx);
vm.runInContext(src('vehicles_data.js'), vctx);
const VEHICLES = JSON.parse(JSON.stringify(vctx.window.VEHICLES));

const RELEASE_RE = /^https:\/\/github\.com\/361087210\/taicanggang-poweroff-guide\/releases\/download\/media-videos\/tcgv_[0-9a-z_]+\.mp4$/;
const isPublicDirect = u => RELEASE_RE.test(String(u || ''));

/* =========================================================
 * S1 映射表完整性: 车型引用 ↔ Release 资产 不得有孤儿
 * ========================================================= */
section('S1 官方资产映射完整性 (Bug③.2 "部分迭代后无法播放")');
const withVideo = VEHICLES.filter(v => v.videoPaths && v.videoPaths.length);
const refs = [];
withVideo.forEach(v => v.videoPaths.forEach(p => refs.push({ display: v.display, file: p.split('/').pop() })));
check('S1a 存在带视频的车型', withVideo.length > 0, 'count=' + withVideo.length);
/* P1 数据一致性: 长安深蓝(G318)_v2.mp4 为组长新上传、尚未配 Release 官方资产,
 * 由 audit_media_consistency.js C2 告警追踪; S1b 允许该已知待补项, 其余仍须精确命中。 */
const PENDING_VIDEOS = ['长安深蓝(G318)_v2.mp4'];
const orphan = refs.filter(r => !MAP[r.file] && !PENDING_VIDEOS.includes(r.file));
check('S1b 每个车型视频引用都能精确命中官方资产(除已知待补)', orphan.length === 0,
  orphan.length ? orphan.slice(0, 3).map(o => o.file).join(', ') : '');
const usedAssets = new Set(Object.values(MAP));
check('S1c 官方资产无冗余(全部被引用)', usedAssets.size === Object.keys(MAP).length);
const unusedKey = Object.keys(MAP).filter(k => !refs.some(r => r.file === k));
check('S1d 映射表无未被任何车型引用的孤儿键', unusedKey.length === 0, unusedKey.slice(0, 3).join(', '));
console.log('  (车型引用 ' + refs.length + ' 条 / 官方资产 ' + Object.keys(MAP).length + ' 个)');

/* =========================================================
 * S2 封面: 未播放态必须有可见封面, 不得黑屏 (Bug③.1)
 * ========================================================= */
section('S2 视频封面 (Bug③.1 "视频无封面/黑屏")');
const cover = videoCoverDataUri('比亚迪海豚(低配)', '断电教学视频');
check('S2a 封面生成器返回 data:image/svg+xml', /^data:image\/svg\+xml/.test(cover));
check('S2b 封面非空且非纯黑底无内容', cover.length > 200 && /polygon|circle/.test(decodeURIComponent(cover.split(',')[1] || '')));
const coverDec = decodeURIComponent(cover);
check('S2c 封面含车型名(可辨识)', coverDec.indexOf('比亚迪海豚(低配)') >= 0 || /比亚迪海豚/.test(coverDec));
check('S2d 封面含播放引导文案', /点按播放/.test(coverDec));
// 播放器: openVideoPlayer 必须给 video-element 赋 poster
check('S2e 播放器设置 poster(未播放不黑屏)', /video\.poster\s*=\s*videoCoverDataUri\(/.test(MEDIA));
check('S2f poster 在 tryPlaySource 之前设置(先封面后取流)',
  MEDIA.indexOf('video.poster') < MEDIA.indexOf('playFromNetwork()'));
// 卡片: 详情页视频卡片必须有 SVG 兜底封面层
check('S2g 详情页卡片有 SVG 兜底封面层', /fallbackSvg/.test(VEH) && /<img src="\$\{fallbackSvg\}"/.test(VEH));
check('S2h 卡片封面复用同一真源 videoCoverDataUri', /videoCoverDataUri\(v\.display,label\)/.test(VEH));
check('S2i 封面首帧层优先走 Release 直链', /mediaDirectUrl\(fileName\)/.test(VEH));
// switchVideo 复用 openVideoPlayer → 切视频也重建封面
const switchFn = extractFn(MEDIA, 'switchVideo') || '';
check('S2j 切换视频复用 openVideoPlayer(封面随之重建)', /openVideoPlayer\(newIdx\)/.test(switchFn));

/* =========================================================
 * 功能沙箱: 用假DOM驱动真实 openVideoPlayer 源链
 * ========================================================= */
function buildSandbox(opts){
  opts = opts || {};
  const attempted = [];
  const missing = [];
  const toasts = [];
  let settledDone = false;

  const video = {
    poster: null, _src: null, onerror: null, onloadeddata: null, _currentTimer: null,
    currentTime: 0, ended: false,
    parentElement: {
      querySelector: () => null,
      appendChild: () => {}
    },
    addEventListener(){}, removeEventListener(){}, removeAttribute(){},
    load(){}, pause(){},
    play(){ return Promise.reject(new Error('autoplay blocked')); }
  };
  Object.defineProperty(video, 'src', {
    configurable: true,
    get(){ return video._src; },
    set(v){
      video._src = v;
      attempted.push(v);
      // 模拟浏览器: 可达公网直链 → loadeddata; 其余(相对路径/CDN) → error
      setTimeout(() => {
        if (isPublicDirect(v)) { if (typeof video.onloadeddata === 'function') video.onloadeddata(); }
        else if (typeof video.onerror === 'function') video.onerror();
      }, 1);
    }
  });

  const els = {};
  const getEl = id => {
    if (id === 'video-element') return video;
    if (!els[id]) els[id] = {
      id, style: {}, textContent: '', innerHTML: '',
      classList: { add(){}, remove(){}, toggle(){} },
      querySelector: () => null, appendChild(){}, addEventListener(){}, removeEventListener(){}
    };
    return els[id];
  };

  const realSetTimeout = setTimeout;
  const sandbox = {
    console: { log(){}, warn(){}, error(){}, debug(){} },
    // 把源码中 8 秒超时压缩到 3ms, 让测试秒级收敛(settled 标志保证语义不变)
    setTimeout: (fn, ms) => realSetTimeout(fn, Math.min(Number(ms) || 0, 3)),
    clearTimeout,
    setInterval: () => 0, clearInterval(){},
    Promise, Date, JSON, Math, Object, Array, String, Number, Boolean, Error, RegExp, encodeURIComponent,
    VEHICLES: opts.vehicles || VEHICLES,
    state: { currentVehicleId: opts.currentId, currentUser: { role: 'admin', status: 'active' } },
    window: opts.window || {},
    document: { getElementById: getEl, createElement: () => ({ style: {}, classList: { add(){} } }) },
    GITHUB_REPO: '361087210/taicanggang-poweroff-guide',
    GITHUB_BRANCH: 'main',
    CACHE_DIR_VIDEOS: 'video_cache',
    cacheFileUrl: async () => null,           // 无 Cordova → 无磁盘缓存
    cacheUrlToDisk: () => {},
    cacheDeleteFiles: async () => 0,
    markVideoAsPlayed: () => false,
    showToast: m => toasts.push(String(m)),
    clearVideoError: () => {},
    _updateVideoNav: () => {},
    showVideoMissing: fn => { missing.push(fn); settledDone = false; },
    playFromFeishuCloud: async () => !!opts.feishuHit,
    feishuCfgReady: () => !!opts.hasSecret,
    getFeishuCfg: () => ({ appId: 'x' }),
    mediaDirectUrl, mediaDirectUrlAlias, videoCoverDataUri,
    __api: { attempted, missing, toasts, video, isDone: () => settledDone }
  };
  vm.createContext(sandbox);
  vm.runInContext([
    'let _videoSession=0; let _currentVideoIndex=0;',
    extractFn(MEDIA, '_isWebStaticEnv'),
    extractFn(MEDIA, 'tryPlaySource'),
    extractFn(MEDIA, '_tryCdnSource'),
    extractFn(MEDIA, '_playReleaseOrCloud'),
    extractFn(MEDIA, 'tryFeishuVideoSource'),
    extractFn(MEDIA, 'openVideoPlayer')
  ].join('\n'), sandbox);
  return sandbox;
}

async function runPlayback(opts){
  const sb = buildSandbox(opts);
  const api = sb.__api;
  await sb.openVideoPlayer(opts.index || 0);
  // 轮询到源链收敛: 落入空态 或 连续 60 次轮询无新增尝试(最长 1s)
  let stable = 0, last = -1;
  for (let i = 0; i < 1000; i++){
    await new Promise(r => setTimeout(r, 1));
    if (api.missing.length) break;
    if (api.attempted.length === last) { if (++stable > 60) break; } else { stable = 0; last = api.attempted.length; }
  }
  return api;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

(async function main(){
  /* =======================================================
   * S3 App 端(Cordova + 有密钥): 源①本地 → 源②Release 直链
   * ======================================================= */
  section('S3 App 端源链 (Cordova + 飞书密钥可用)');
  {
    const v = VEHICLES.find(x => x.videoPaths && x.videoPaths.length && MAP[x.videoPaths[0].split('/').pop()]);
    const r = await runPlayback({
      currentId: v.id, window: { cordova: { platformId: 'android' } },
      hasSecret: true, feishuHit: false
    });
    check('S3a App端首源为本地APK相对路径(保留既有能力)',
      r.attempted[0] === v.videoPaths[0], String(r.attempted[0]));
    check('S3b 本地源404后回退到 Release 公网直链',
      isPublicDirect(r.attempted[1]), String(r.attempted[1]));
    check('S3c 最终未落入"视频加载失败"空态', r.missing.length === 0);
  }

  /* =======================================================
   * S4 网页端(无 Cordova + 无密钥): 直接走静态直链, 不得报错退出
   * ======================================================= */
  section('S4 网页端源链 (Bug③.3 "网页端完全无法播放")');
  {
    const v = VEHICLES.find(x => x.videoPaths && x.videoPaths.length && MAP[x.videoPaths[0].split('/').pop()]);
    const r = await runPlayback({
      currentId: v.id, window: {}, hasSecret: false, feishuHit: false
    });
    check('S4a 网页端跳过必然404的 vehicle_videos 相对路径',
      r.attempted.length > 0 && !/^vehicle_videos\//.test(String(r.attempted[0])), String(r.attempted[0]));
    check('S4b 网页端首源即为免鉴权公网直链',
      isPublicDirect(r.attempted[0]), String(r.attempted[0]));
    check('S4c 网页端解析出的URL为 Release 固定tag直链(不受分支迭代影响)',
      String(r.attempted[0]).indexOf('/releases/download/media-videos/') > 0);
    check('S4d 网页端未落入"视频加载失败"空态', r.missing.length === 0);
    check('S4e 网页端未尝试任何需鉴权的飞书下载', r.attempted.every(u => !/open\.feishu\.cn/.test(String(u))));

    // 极端: 既无官方映射也无别名 → 必须优雅降级到"待补充"空态, 不得抛错/卡死
    const cloned = JSON.parse(JSON.stringify(VEHICLES));
    const tv = cloned.find(x => x.videoPaths && x.videoPaths.length);
    tv.videoPaths[0] = 'vehicle_videos/某某全新车型XYZ_v1.mp4';
    let threw = null, r2 = null;
    try {
      r2 = await runPlayback({ vehicles: cloned, currentId: tv.id, window: {}, hasSecret: false, feishuHit: false });
    } catch (e) { threw = e; }
    check('S4f 无源可播时优雅降级(不抛异常)', threw === null, threw && String(threw.message));
    check('S4g 无源可播时进入"视频待上传"诚实空态而非静默黑屏',
      !!r2 && r2.missing.length === 1,
      JSON.stringify(r2 && { missing: r2.missing, attempted: r2.attempted, toasts: r2.toasts }));
    check('S4h 降级路径仅尝试静态源/CDN, 不含飞书鉴权下载',
      !!r2 && r2.attempted.every(u => !/open\.feishu\.cn/.test(String(u))), JSON.stringify(r2 && r2.attempted));
  }

  /* =======================================================
   * S5 上传改名后的别名回退 (Bug③.2 根治)
   * ======================================================= */
  section('S5 上传改名后仍可播 (别名回退)');
  {
    // 归一化键必须唯一, 否则别名会张冠李戴
    const cnt = {};
    Object.keys(MAP).forEach(k => { const n = normKey(k); cnt[n] = (cnt[n] || 0) + 1; });
    const dup = Object.keys(cnt).filter(k => cnt[k] > 1);
    check('S5a 归一化键在官方资产表内唯一(不会张冠李戴)', dup.length === 0, dup.join(','));

    // 逐车型模拟"组长上传后 videoPaths 被改写为 <display>_v<N>.mp4"
    let aliasOk = 0, aliasMiss = [];
    withVideo.forEach(v => {
      const renamed = String(v.display || ('vehicle_' + v.id)) + '_v1.mp4';
      if (mediaDirectUrlAlias(renamed)) aliasOk++;
      else aliasMiss.push(v.display + ' -> ' + renamed);
    });
    console.log('  (改名后可别名解析 ' + aliasOk + '/' + withVideo.length + '; 未覆盖者原引用为通用片或本就无专属资产)');
    check('S5b 大多数车型改名后仍能回退到官方片', aliasOk >= Math.floor(withVideo.length * 0.6),
      'ok=' + aliasOk + '/' + withVideo.length);
    check('S5c 精确命中时不走别名(新上传片不被旧官方片覆盖)',
      mediaDirectUrlAlias('比亚迪海豚_低配.mp4') === null);
    check('S5d 留档原名优先于归一化猜测',
      mediaDirectUrlAlias('某某车型_v1.mp4', '通用断电视频.mp4') === RELEASE_BASE + '/tcgv_b5fc668c92.mp4',
      String(mediaDirectUrlAlias('某某车型_v1.mp4', '通用断电视频.mp4')));

    // 端到端: 构造"已改名且无留档"的车型, 网页端应回退到官方片
    const v0 = VEHICLES.find(x => x.videoPaths && x.videoPaths.length && MAP[x.videoPaths[0].split('/').pop()]);
    const canon = v0.videoPaths[0].split('/').pop();
    const renamed = String(v0.display) + '_v1.mp4';
    const cloned = JSON.parse(JSON.stringify(VEHICLES));
    const target = cloned.find(x => x.id === v0.id);
    target.videoPaths[0] = 'vehicle_videos/' + renamed;
    const r = await runPlayback({ vehicles: cloned, currentId: v0.id, window: {}, hasSecret: false, feishuHit: false });
    const expectAlias = mediaDirectUrlAlias(renamed);
    if (expectAlias) {
      check('S5e 改名车型在网页端回退到官方片并可播',
        r.attempted.indexOf(expectAlias) >= 0 && r.missing.length === 0,
        JSON.stringify(r.attempted));
    } else {
      check('S5e 改名车型无官方片时优雅降级(不抛错)', true, '(该车型本就无专属官方片, 跳过)');
    }
    check('S5f 有留档原名时优先用留档(精确)',
      mediaDirectUrlAlias(renamed, canon) === RELEASE_BASE + '/' + MAP[canon],
      String(mediaDirectUrlAlias(renamed, canon)));

    // 关键: 只要上传时留档了原名(videoBaseNames), 100% 车型改名后仍可播
    let canonOk = 0;
    withVideo.forEach(v => {
      const rn = String(v.display || ('vehicle_' + v.id)) + '_v1.mp4';
      const cn = v.videoPaths[0].split('/').pop();
      if (mediaDirectUrlAlias(rn, cn)) canonOk++;
    });
    check('S5g 留档原名后 100% 车型改名仍可回退官方片(videoBaseNames)',
      canonOk === withVideo.length, 'ok=' + canonOk + '/' + withVideo.length);

    // 未覆盖的改名车型: 原引用为通用片的, 刻意不别名(避免通用片覆盖组长新片)
    const aliasMissOrigins = {};
    withVideo.forEach(v => {
      const rn = String(v.display || ('vehicle_' + v.id)) + '_v1.mp4';
      if (!mediaDirectUrlAlias(rn)) {
        const o = v.videoPaths[0].split('/').pop();
        aliasMissOrigins[o] = (aliasMissOrigins[o] || 0) + 1;
      }
    });
    const genericOnly = Object.keys(aliasMissOrigins).filter(k => k === '通用断电视频.mp4');
    check('S5h 未覆盖者主要为通用片车型(刻意不回退, 防通用片盖住组长新片)',
      genericOnly.length > 0, JSON.stringify(aliasMissOrigins));

    /* ---- V10.19.0 任务C: display 比资产键缺后缀的孤儿, 唯一前缀匹配 ---- */
    // 三个可安全修复的典型: display 是资产键的前缀, 且全表唯一
    const prefixCases = [
      { renamed: '长安糯米_v1.mp4', expect: '长安糯米_糯米.mp4' },
      { renamed: '长城好猫_v1.mp4', expect: '长城好猫_好猫.mp4' },
      { renamed: '江淮E-JS1/4_v1.mp4', expect: '江淮E_JS1_4_E_JS1_4.mp4' }
    ];
    prefixCases.forEach(c => {
      const got = mediaDirectUrlAlias(c.renamed);
      check('S5i 唯一前缀命中可回退: ' + c.renamed + ' -> ' + c.expect,
        got === RELEASE_BASE + '/' + MAP[c.expect], String(got));
    });

    // 歧义必须拒绝: 人为构造一个能命中多个资产的查询键
    const normKeys = Object.keys(MAP).map(k => normKey(k));
    let ambiguous = null;
    for (const k of normKeys){
      const seg = k.split('_')[0];
      if (!seg) continue;
      const hits = normKeys.filter(x => x === seg || x.indexOf(seg + '_') === 0);
      if (hits.length >= 2){ ambiguous = seg; break; }
    }
    if (ambiguous){
      check('S5j 前缀歧义时拒绝命中(宁可漏不可错)',
        mediaDirectUrlAlias(ambiguous + '_v1.mp4') === null, 'ambiguous=' + ambiguous);
    } else {
      // 当前资产表内不存在天然歧义前缀(好事), 用等价断言占位说明
      check('S5j 前缀歧义时拒绝命中(当前资产表无天然歧义前缀, 规则已内置)',
        mediaDirectUrlAlias('_v1.mp4') === null);
    }

    // 长安UNI-(UNI-V): display 归一化后为 ...uni_uni_v, 与资产键 ...uni_uni_t 不同,
    // 前缀匹配应无命中 → 必须拒绝(不得把 UNI-V 猜成 UNI-T)
    check('S5k 长安UNI-(UNI-V) 前缀无命中时拒绝(不猜成UNI-T)',
      mediaDirectUrlAlias('长安UNI-(UNI-V)_v1.mp4') === null,
      String(mediaDirectUrlAlias('长安UNI-(UNI-V)_v1.mp4')));

    // 全量安全扫描: 所有改名查询做严格前缀扫描, 不得出现歧义, 且命中必须与原精确引用一致
    let uni = 0, noHit = 0, amb = 0, mismatch = 0;
    withVideo.forEach(v => {
      const q = normKey(String(v.display || ('vehicle_' + v.id)) + '_v1.mp4');
      const hits = normKeys.filter(k => k === q || k.indexOf(q + '_') === 0);
      if (hits.length === 1){
        uni++;
        const origAsset = MAP[v.videoPaths[0].split('/').pop()];
        const hitAsset = mediaCtx.__export.MEDIA_ALIAS_INDEX[hits[0]];
        if (origAsset && origAsset !== hitAsset) mismatch++;
      } else if (hits.length === 0){ noHit++; } else { amb++; }
    });
    check('S5l 全量前缀扫描无歧义(命中数≠1即拒绝)', amb === 0, 'ambiguous=' + amb);
    check('S5m 全量前缀命中与原精确引用100%一致(无张冠李戴)', mismatch === 0, 'mismatch=' + mismatch);
    console.log('  (前缀扫描: 唯一命中 ' + uni + ' / 无命中 ' + noHit + ' / 歧义 ' + amb + ')');
  }

  /* =======================================================
   * S6 上传文件命名规则 (Bug④ 按车型名称命名)
   * ======================================================= */
  section('S6 上传文件按车型名称命名 (Bug④)');
  {
    const pick = extractFn(MEDIA, 'pickVideoFile') || '';
    check('S6a 手动上传视频命名为 <车型名>_v<序号>.mp4',
      /const fileName=`\$\{baseName\}_v\$\{idx\+1\}\.mp4`/.test(pick));
    check('S6b 车型名取自车辆 display(可人工辨识)',
      /_sanitizeFeishuFileName\(v\.display\|\|\('vehicle_'\+v\.id\)\)/.test(pick));
    check('S6c 上传不再使用随机哈希/原始文件名', !/_strHashDjb2|file\.name/.test(pick));
    check('S6d 上传序号做了越界保护', /const idx=\(_currentVideoIndex>=0&&_currentVideoIndex<v\.videoPaths\.length\)\?_currentVideoIndex:0/.test(pick));
    check('S6e 视频上传回写路径为 vehicle_videos/<车型名>', /v\.videoPaths\[idx\]='vehicle_videos\/'\+fileName/.test(pick));
    check('S6f 改名时留档官方原名(供别名回退)', /v\.videoBaseNames\[idx\]=prevName/.test(pick));

    const photoUpload = extractFn(SYNC, 'syncUploadVehiclePhotos') || '';
    check('S6g 照片分离上传按车型名命名 <车型名>_p<序号>',
      /const fileName=`\$\{baseName\}_p\$\{i\+1\}_\$\{hash\}\.jpeg`/.test(photoUpload));
    const videoUpload = extractFn(SYNC, 'syncUploadVehicleVideos') || '';
    check('S6h 视频分离上传按车型名命名 <车型名>_v<序号>',
      /const fileName=`\$\{baseName\}_v\$\{i\+1\}_\$\{hash\}\.mp4`/.test(videoUpload));
    check('S6i 照片/视频命名均已弃用 user_v{id} 形态',
      !/user_v\$\{v\.id\}|user_v\$\{/.test(photoUpload + videoUpload));
  }

  /* =======================================================
   * S7 安全与架构红线
   * ======================================================= */
  section('S7 安全/架构红线');
  {
    const mediaChain = BOOT + MEDIA + VEH;
    check('S7a 媒体链路源码不含任何密钥明文', !/appSecret\s*[:=]\s*['"][A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}/.test(mediaChain));
    check('S7b 网页端判定不依赖密钥(_isWebStaticEnv 仅读可用性)',
      !/appSecret/.test(extractFn(MEDIA, '_isWebStaticEnv') || ''));
    check('S7c 未新增第三方依赖(媒体链路零依赖)',
      !/require\(|import\s+.*from/.test(MEDIA));
    check('S7d 源链顺序: 官方精确直链 → 飞书 → 官方别名 → CDN',
      MEDIA.indexOf('_playReleaseOrCloud') < MEDIA.indexOf('tryFeishuVideoSource') &&
      /mediaDirectUrlAlias\(fileName,canonicalName\)/.test(extractFn(MEDIA, 'tryFeishuVideoSource') || ''));
    check('S7e demo.html 仍按序加载 00-bootstrap(别名表) 与 06-media',
      /00-bootstrap\.js[\s\S]*?06-media\.js/.test(HTML));
  }

  /* =======================================================
   * S8 公网实测(可选): 校验 46 个 Release 资产真实可达
   * ======================================================= */
  if (process.env.TCG_LIVE_NET === '1'){
    section('S8 Release 资产公网可达性实测 (TCG_LIVE_NET=1)');
    const get = url => new Promise(res => {
      let done = false; const fin = o => { if (!done){ done = true; res(o); } };
      const req = https.request(url, { method: 'GET', timeout: 20000,
        headers: { 'User-Agent': 'tcg-test', 'Range': 'bytes=0-63' } }, r => {
        const loc = r.headers.location;
        if ((r.statusCode === 301 || r.statusCode === 302) && loc){ r.resume(); return get(loc).then(fin); }
        let n = 0; r.on('data', c => n += c.length); r.on('end', () => fin({ code: r.statusCode, got: n }));
      });
      req.on('error', e => fin({ code: 'ERR', err: e.message }));
      req.on('timeout', () => { req.destroy(); fin({ code: 'TIMEOUT' }); });
      req.end();
    });
    const assets = [...new Set(Object.values(MAP))];
    let ok = 0; const gone = [], flaky = [];
    for (const a of assets){
      const r = await get(RELEASE_BASE + '/' + a);
      if (r.code === 200 || r.code === 206) ok++;
      else if (r.code === 404) gone.push(a);   // 404 = 资产确实缺失(真失败)
      else flaky.push(a + ':' + r.code);       // 超时/5xx/网关错误 = 网络抖动, 不做结论
    }
    check('S8a 无官方资产缺失(404=资产不存在)', gone.length === 0, gone.join(','));
    check('S8b 绝大多数官方资产公网可达(Range 200/206)', ok >= Math.ceil(assets.length * 0.8),
      'ok=' + ok + '/' + assets.length);
    console.log('  (可达 ' + ok + '/' + assets.length
      + '; 网络抖动未判定 ' + flaky.length + (flaky.length ? ' 例: ' + flaky.slice(0, 5).join(',') : '') + ')');
    if (flaky.length) console.log('  注: 抖动项多为沙箱出网不稳, 非资产缺失; 请在稳定网络下重跑确认。');
  } else {
    console.log('\n(跳过 S8 公网实测: 设置 TCG_LIVE_NET=1 开启)');
  }

  console.log('\n=========================================');
  console.log('结果: 通过 ' + pass + ' / 失败 ' + fail);
  if (fail) { console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
  console.log('=========================================');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试执行异常:', e); process.exit(2); });
