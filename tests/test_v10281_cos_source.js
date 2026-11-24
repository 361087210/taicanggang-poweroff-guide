#!/usr/bin/env node
/**
 * ============================================================
 * test_v10281_cos_source.js — COS 国内源接入
 * ============================================================
 * 为什么要有这一版测试：
 *   视频/照片从"GitHub 唯一源"扩展成"COS 国内源主 + Release 备"后，最容易
 *   悄悄坏掉的四件事：
 *     ① 未配置 COS 时行为必须与旧版完全一致（老包/裸仓库不能退化）；
 *     ② 绝对 URL 不能再次拼基址（历史 GitHub 直链拼上 COS 基址 → 404）；
 *     ③ 相对路径只能编码一次（已编码的中文名再编一次 → %25 双重编码 → 404）；
 *     ④ Cordova 白名单漏掉 COS 域名 → 网页端正常、App 全挂。
 * 设计约束：与 test_v10275 相同 —— 零依赖 + vm 跑真实源码，断言行为而不是文本。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; failures.push(name); console.log('  ❌ ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n=== ' + t + ' ==='); }

const BOOT = src('js/00-bootstrap.js');
const CONFIG = src('js/00-config.js');
const MEDIA = src('js/06-media.js');
const XML = src('config.xml');

function extractFn(code, name) {
  const re = new RegExp('(?:async\\s+)?function\\s+' + name + '\\s*\\(');
  const m = re.exec(code);
  if (!m) return null;
  const open = code.indexOf('{', m.index);
  let d = 0, j = open;
  for (; j < code.length; j++) {
    if (code[j] === '{') d++;
    else if (code[j] === '}') { d--; if (d === 0) { j++; break; } }
  }
  return code.slice(m.index, j);
}

/* ---------------- A. 配置常量与 Cordova 白名单 ---------------- */
section('A. 配置：桶地址就位，白名单已放行');

const BUCKET = 'tcg-poweroff-guide-1539213542.cos.ap-shanghai.myqcloud.com';
/* 直接执行真实配置模块读取值, 再用 URL 解析做精确断言 ——
 * 不用正则/子串拼装主机名(CodeQL: 未转义的点会匹配更多主机)。 */
const cfgCtx = { window: {} };
vm.createContext(cfgCtx);
vm.runInContext(CONFIG, cfgCtx);
const COS_FROM_CONFIG = String((cfgCtx.window.TCG_CONFIG || {}).MEDIA_COS_BASE || '');
let cosParsed = null;
try { cosParsed = new URL(COS_FROM_CONFIG); } catch (e) { cosParsed = null; }
check('A1 已配置 MEDIA_COS_BASE（非空）', COS_FROM_CONFIG.length > 0, COS_FROM_CONFIG);
check('A2 是 https 绝对地址且 host 精确等于上海桶',
  !!cosParsed && cosParsed.protocol === 'https:' && cosParsed.hostname === BUCKET,
  COS_FROM_CONFIG);
check('A3 config.xml 放行 COS 域名（否则 Cordova 原生 WebView 直接拦）',
  XML.includes('<access origin="https://*.myqcloud.com" />'));
check('A4 白名单未回退成 origin="*"',
  !XML.includes('<access origin="*" />'));

/* ---------------- 抽取真实播放源注册表 ---------------- */
const _regMark = /\/\* =+ V\d+(?:\.\d+)*: 播放源注册表/.exec(BOOT);
const registryStart = _regMark ? _regMark.index : -1;
const registryEnd = BOOT.indexOf('/**\n * 查询视频的首选直链(V5.3.5)');
const REGISTRY = BOOT.slice(registryStart, registryEnd) + (extractFn(BOOT, 'mediaDirectUrl') || '');
check('A5 抽取到播放源注册表（结构未被改形）',
  registryStart > 0 && registryEnd > registryStart && REGISTRY.includes('MEDIA_PLAYBACK_SOURCES'));

const F_MEDIA_DIRECT_URLS = extractFn(BOOT, 'mediaDirectUrls');
check('A6 抽取到 mediaDirectUrls()', !!F_MEDIA_DIRECT_URLS);

/* ---------------- vm 运行环境 ---------------- */
const ASSETS = { '通用断电视频.mp4': 'tcgv_b5fc668c92.mp4' };
const RELEASE_BASE = 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos';
const COS_BASE = 'https://' + BUCKET;

function buildCtx(opts) {
  opts = opts || {};
  const store = Object.assign({}, opts.localStorage || {});
  const ctx = {
    window: { TCG_CONFIG: opts.config || {} },
    localStorage: {
      getItem: (k) => (k in store ? store[k] : null),
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: (k) => { delete store[k]; },
    },
    console, Date, JSON, Object, String, Array, RegExp,
    encodeURIComponent, decodeURIComponent,
    MEDIA_DIRECT_ASSETS: ASSETS,
    MEDIA_RELEASE_BASE: RELEASE_BASE,
    __store: store,
  };
  vm.createContext(ctx);
  vm.runInContext(REGISTRY, ctx);
  vm.runInContext(F_MEDIA_DIRECT_URLS, ctx);
  return ctx;
}

/* ---------------- B. 源顺序 ---------------- */
section('B. 源顺序：COS 在 CDN 之后、GitHub 之前');

{
  const ctx = buildCtx({ config: { MEDIA_COS_BASE: COS_BASE + '/' } });
  const cands = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('B1 配置 COS 后有两个源', cands.length === 2, String(cands.length));
  check('B2 COS 是主源，GitHub 是备源',
    cands[0].sourceId === 'cos' && cands[1].sourceId === 'github',
    JSON.stringify(cands.map(c => c.sourceId)));
  check('B3 视频路径固定为 media-library/baseline/<资产名>',
    cands[0].url === COS_BASE + '/media-library/baseline/tcgv_b5fc668c92.mp4', cands[0].url);
  check('B4 尾部斜杠被归一化（不出现 //tcgv_）', !/\/\/tcgv_/.test(cands[0].url));
  check('B5 来源标签可读（排障/后续 UI 要用）', cands[0].label === 'COS 国内源', cands[0].label);
}

{
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: 'https://cdn.example.com', MEDIA_COS_BASE: COS_BASE } });
  const ids = ctx.mediaDirectUrls('通用断电视频.mp4').map(c => c.sourceId);
  check('B6 同时配置时顺序为 cdn → cos → github', ids.join(',') === 'cdn,cos,github', ids.join(','));
}

{
  const ctx = buildCtx({ config: {} });
  const cands = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('B7 未配置 COS 时行为与旧版一致（只有 github）',
    cands.length === 1 && cands[0].sourceId === 'github' && cands[0].url === RELEASE_BASE + '/tcgv_b5fc668c92.mp4',
    JSON.stringify(cands));
}

{
  const ctx = buildCtx({ config: { MEDIA_COS_BASE: 'http://insecure.example.com' } });
  check('B8 http:// 的 COS 基址被忽略（混合内容）',
    ctx.mediaDirectUrls('通用断电视频.mp4').length === 1);
}

/* ---------------- C. URL 拼接契约 ---------------- */
section('C. URL 拼接：绝对 URL 直通，相对路径只编码一次');

{
  const ctx = buildCtx({ config: { MEDIA_COS_BASE: COS_BASE } });
  const abs = 'https://example.com/a b/旧链接.mp4';
  check('C1 绝对 URL 原样直通（绝不拼基址）', ctx.mediaJoinUrl(COS_BASE, abs) === abs, ctx.mediaJoinUrl(COS_BASE, abs));
  check('C2 绝对 URL 不会被编码（直链里的 %20 不能被二次改写）',
    ctx.mediaJoinUrl(COS_BASE, 'https://example.com/a%20b.mp4') === 'https://example.com/a%20b.mp4');
  check('C3 相对路径逐段编码（中文/空格）',
    ctx.mediaJoinUrl(COS_BASE, 'vehicle_images/比亚迪 海豚/前 脸.jpg') ===
      COS_BASE + '/vehicle_images/' + encodeURIComponent('比亚迪 海豚') + '/' + encodeURIComponent('前 脸.jpg'),
    ctx.mediaJoinUrl(COS_BASE, 'vehicle_images/比亚迪 海豚/前 脸.jpg'));
  const once = ctx.mediaJoinUrl(COS_BASE, 'vehicle_images/比亚迪 海豚/前 脸.jpg');
  check('C4 编码幂等：编码结果再编码一次不变（不会 %25 双重编码）',
    ctx.mediaJoinUrl(COS_BASE, once.slice(COS_BASE.length + 1)) === once);
  check('C5 基址非法（相对/空）时返回空串，交给上层回退',
    ctx.mediaJoinUrl('/media', 'a.jpg') === '' && ctx.mediaJoinUrl('', 'a.jpg') === '');
  check('C6 空路径返回空串', ctx.mediaJoinUrl(COS_BASE, '') === '');
}

{
  const ctx = buildCtx({ config: { MEDIA_COS_BASE: COS_BASE } });
  check('C7 照片直链 = 基址 + 三段式相对路径',
    ctx.mediaCosPhotoUrl('vehicle_images/比亚迪_海豚/image1.jpeg') ===
      COS_BASE + '/vehicle_images/' + encodeURIComponent('比亚迪_海豚') + '/image1.jpeg',
    ctx.mediaCosPhotoUrl('vehicle_images/比亚迪_海豚/image1.jpeg'));
}
{
  const ctx = buildCtx({ config: {} });
  check('C8 未配置 COS 时照片直链为空（照片链路保持旧行为）', ctx.mediaCosPhotoUrl('vehicle_images/a/b.jpg') === '');
}

/* ---------------- D. 健康记忆同样覆盖 COS ---------------- */
section('D. 健康记忆：COS 坏过靠后但不删除');

{
  const ctx = buildCtx({ config: { MEDIA_COS_BASE: COS_BASE } });
  vm.runInContext('MEDIA_SOURCE_HEALTH.markFailed("cos")', ctx);
  const sick = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('D1 坏过的 COS 被挪到 GitHub 之后但不被删除',
    sick.length === 2 && sick[0].sourceId === 'github' && sick[1].sourceId === 'cos',
    JSON.stringify(sick.map(c => c.sourceId)));
  vm.runInContext('MEDIA_SOURCE_HEALTH.markOk("cos")', ctx);
  check('D2 成功一次即恢复主源地位', ctx.mediaDirectUrls('通用断电视频.mp4')[0].sourceId === 'cos');
}

/* ---------------- E. 照片回退链接线 ---------------- */
section('E. 照片回退链：本地 → COS → 飞书 → 诚实缺失');

const F_COS_IMG = extractFn(MEDIA, 'imgFromCosCloud');
check('E1 imgFromCosCloud 存在', !!F_COS_IMG);

{
  const a = MEDIA.indexOf('imgFromCosCloud(img');
  const b = MEDIA.indexOf('imgFromFeishuCloud(img');
  check('E2 imgLoadError 中 COS 在飞书之前', a > 0 && b > a, 'cos@' + a + ' feishu@' + b);
  check('E3 诚实空态仍保留（COS 未命中也必须落到"照片缺失"）',
    /function\s+imgLoadError[\s\S]{0,600}showPhotoMissing\(img\)/.test(MEDIA));
}
{
  const viewer = extractFn(MEDIA, 'openPhotoViewer') || '';
  const a = viewer.indexOf('imgFromCosCloud');
  const b = viewer.indexOf('imgFromFeishuCloud');
  check('E4 查看器大图也先试 COS 再飞书', a > 0 && b > a, 'cos@' + a + ' feishu@' + b);
  check('E5 查看器缺图仍区分 missing/never',
    /_photoViewerMissingSvg\(v,labels\[index\],'missing'\)/.test(viewer));
}
{
  const thumb = extractFn(MEDIA, 'thumbImgError') || '';
  check('E6 列表缩略图也接入 COS，且未命中仍走 showThumbMissing',
    thumb.indexOf('imgFromCosCloud') > 0 && /showThumbMissing\(img\)/.test(thumb));
}

/* ---------------- F. imgFromCosCloud 真跑（假 img） ---------------- */
section('F. imgFromCosCloud 行为');

function makeImg() {
  return { onload: null, onerror: null, src: '', getAttribute: () => '' };
}

const COS_DEPS = ['mediaIsAbsoluteUrl', 'mediaEncodeRelPath', 'mediaJoinUrl', 'mediaCosPhotoUrl']
  .map(n => extractFn(BOOT, n)).join('\n');

function cosCtx(config) {
  const ctx = {
    window: { TCG_CONFIG: config || {} },
    Promise, encodeURIComponent, decodeURIComponent, String, RegExp, Object,
  };
  vm.createContext(ctx);
  vm.runInContext(COS_DEPS + '\n' + F_COS_IMG, ctx);
  return ctx;
}

(async function () {
  {
    const ctx = cosCtx({ MEDIA_COS_BASE: COS_BASE });
    const img = makeImg();
    const p = ctx.imgFromCosCloud(img, 'vehicle_images/比亚迪_海豚/image1.jpeg');
    check('F1 已挂上 COS 直链',
      img.src === COS_BASE + '/vehicle_images/' + encodeURIComponent('比亚迪_海豚') + '/image1.jpeg', img.src);
    img.onload({});
    check('F2 加载成功 resolve(true)', (await p) === true);
  }
  {
    const ctx = cosCtx({ MEDIA_COS_BASE: COS_BASE });
    const img = makeImg();
    const p = ctx.imgFromCosCloud(img, 'vehicle_images/a/b.jpg');
    img.onerror({});
    check('F3 加载失败 resolve(false)（交给飞书，不提示用户）', (await p) === false);
  }
  {
    const ctx = cosCtx({ MEDIA_COS_BASE: COS_BASE });
    const img = makeImg();
    const p = ctx.imgFromCosCloud(img, 'https://other.example.com/x.jpg');
    check('F4 绝对 URL 不重试（刚失败的直链重试无意义）', (await p) === false && img.src === '');
  }
  {
    const ctx = cosCtx({});
    const img = makeImg();
    check('F5 未配置 COS 时立即 resolve(false)', (await ctx.imgFromCosCloud(img, 'vehicle_images/a/b.jpg')) === false);
  }

  /* ---------------- 汇总 ---------------- */
  console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败');
  if (fail) { console.log('  失败项: ' + failures.join(' | ')); }
  process.exit(fail ? 1 : 0);
})();
