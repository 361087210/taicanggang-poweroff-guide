#!/usr/bin/env node
/**
 * ============================================================
 * test_v10275_playback_sources.js — 播放源候选链与健康记忆
 * ============================================================
 * 为什么要有这一版测试：
 *   视频从"只有一个 GitHub Release 源"扩展成"对象存储 CDN 主 + Release 备"后，
 *   最容易悄悄坏掉的三件事：
 *     ① 未配置 CDN 时行为必须与旧版**完全一致**（否则老包/老配置直接退化）；
 *     ② 主源失败必须真的降级到备源（而不是直接落到"没有密钥的飞书"→空态）；
 *     ③ 健康记忆不能把源永久拉黑（30 分钟 TTL + 一次成功即恢复）。
 *
 * 设计约束（沿用 test_video_playback_v1019 的做法）：
 *   - 零依赖：node:vm + 假 window/localStorage/localStorage，直接跑真实源码；
 *   - 断言行为而不是文本：不检查源码里有没有某个字符串来"证明"回退可用，
 *     而是用假 video 真跑一遍候选链，看它到底试了哪个 URL。
 *   - 密钥红线：不读不写任何 secret。
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
const MEDIA = src('js/06-media.js');

/* ---------------- 从真实源码里抽取要测的代码块 ---------------- */

/** 按括号配对抽整个函数（与 test_video_playback_v1019 同一工具） */
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

/* 标记里带版本号, 发版升号时会被一起改掉（本轮就踩到: 源码 V10.27.3 / 断言 V10.27.5
 * 导致切片为空、ctx 里根本没有注册表）。这里用正则只认"播放源注册表"这个稳定语义。 */
const _regMark = /\/\* =+ V\d+(?:\.\d+)*: 播放源注册表/.exec(BOOT);
const registryStart = _regMark ? _regMark.index : -1;
const registryEnd = BOOT.indexOf('/**\n * 查询视频的首选直链(V5.3.5)');
/* mediaDirectUrl 的文档注释被切在 registry 之外, 但函数体要一并加载(旧调用点仍在用它) */
const REGISTRY = BOOT.slice(registryStart, registryEnd) + (extractFn(BOOT, 'mediaDirectUrl') || '');
check('抽取到播放源注册表（源码结构未被改形）',
  registryStart > 0 && registryEnd > registryStart && REGISTRY.includes('MEDIA_PLAYBACK_SOURCES'));

const F_MEDIA_DIRECT_URLS = extractFn(BOOT, 'mediaDirectUrls');
check('抽取到 mediaDirectUrls()', !!F_MEDIA_DIRECT_URLS);

const F_CHAIN = extractFn(MEDIA, '_playCandidateChain');
check('抽取到 _playCandidateChain()', !!F_CHAIN);

/* ---------------- 在 vm 里搭一个"足够真"的运行环境 ---------------- */

const ASSETS = { '通用断电视频.mp4': 'tcgv_b5fc668c92.mp4' };
const RELEASE_BASE = 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/media-videos';

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
    console,
    Date,
    JSON,
    Object,
    String,
    Array,
    RegExp,
    MEDIA_DIRECT_ASSETS: ASSETS,
    MEDIA_RELEASE_BASE: RELEASE_BASE,
    __store: store,
  };
  vm.createContext(ctx);
  vm.runInContext(REGISTRY, ctx);
  vm.runInContext(F_MEDIA_DIRECT_URLS, ctx);
  return ctx;
}

/* ---------------- A. 向后兼容：没配 CDN 时与旧版一致 ---------------- */
section('A. 未配置 CDN：行为必须与 V10.27.4 完全一致');

{
  const ctx = buildCtx();
  const cands = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('A1 只有一个候选源', cands.length === 1, '实际 ' + cands.length);
  check('A2 该源是 github，URL 与旧格式逐字符相同',
    cands[0].sourceId === 'github' && cands[0].url === RELEASE_BASE + '/tcgv_b5fc668c92.mp4',
    cands[0] && cands[0].url);
  check('A3 mediaDirectUrl() 仍返回首选直链（旧调用点不受影响）',
    vm.runInContext('mediaDirectUrl("通用断电视频.mp4")', ctx) === RELEASE_BASE + '/tcgv_b5fc668c92.mp4');
}

/* ---------------- B. 配置 CDN：主源在前、拼接不产生双斜杠 ---------------- */
section('B. 配置 MEDIA_CDN_BASE：CDN 主源排在 Release 之前');

{
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: 'https://cdn.example.com/media/' } });
  const cands = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('B1 两个候选源，CDN 在前', cands.length === 2 && cands[0].sourceId === 'cdn', JSON.stringify(cands.map(c => c.sourceId)));
  check('B2 尾部斜杠被归一化（不会拼出 //tcgv_）',
    cands[0].url === 'https://cdn.example.com/media/tcgv_b5fc668c92.mp4', cands[0].url);
  check('B3 CDN 之后仍有 GitHub 备源', cands[1].sourceId === 'github' && /releases\/download\/media-videos/.test(cands[1].url));
}

/* ---------------- C. 非法配置被忽略（混合内容/相对路径/空值） ---------------- */
section('C. 非法 MEDIA_CDN_BASE 不得启用（避免混合内容与 404 基址）');

[
  ['http://cdn.example.com', 'C1 http: 被拒绝（混合内容会被浏览器拦）'],
  ['/media', 'C2 相对路径被拒绝（无法确认指向哪个域）'],
  ['   ', 'C3 空白被拒绝'],
].forEach(([val, name]) => {
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: val } });
  const cands = ctx.mediaDirectUrls('通用断电视频.mp4');
  check(name, cands.length === 1 && cands[0].sourceId === 'github', JSON.stringify(cands.map(c => c.sourceId)));
});

/* ---------------- D. 未映射的文件名不猜 ---------------- */
section('D. 未映射文件名返回空候选（宁可空态也不乱播）');

{
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: 'https://cdn.example.com' } });
  check('D1 空候选数组', ctx.mediaDirectUrls('组长新上传_未登记.mp4').length === 0);
  check('D2 mediaDirectUrl() 返回 null（交给飞书/别名回退链）',
    vm.runInContext('mediaDirectUrl("组长新上传_未登记.mp4")', ctx) === null);
}

/* ---------------- E. 健康记忆：坏源靠后但不删除，成功即恢复 ---------------- */
section('E. 健康记忆（30 分钟 TTL，成功即恢复主源）');

{
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: 'https://cdn.example.com' } });
  vm.runInContext('MEDIA_SOURCE_HEALTH.markFailed("cdn")', ctx);
  const sick = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('E1 坏过的 CDN 被挪到末尾，但不被删除',
    sick.length === 2 && sick[0].sourceId === 'github' && sick[1].sourceId === 'cdn',
    JSON.stringify(sick.map(c => c.sourceId)));
  check('E2 失败记录写进了 localStorage（跨会话生效）',
    typeof ctx.__store.tcg_media_src_fail_v1 === 'string' && ctx.__store.tcg_media_src_fail_v1.includes('"cdn"'),
    String(ctx.__store.tcg_media_src_fail_v1));

  vm.runInContext('MEDIA_SOURCE_HEALTH.markOk("cdn")', ctx);
  const healed = ctx.mediaDirectUrls('通用断电视频.mp4');
  check('E3 成功一次即恢复主源优先（故障恢复不等 TTL）', healed[0].sourceId === 'cdn');
  check('E4 恢复后记录被清掉', !ctx.__store.tcg_media_src_fail_v1.includes('cdn'));
}

{
  // 30 分钟前的失败记录 → 视为已恢复
  const old = JSON.stringify({ cdn: Date.now() - 31 * 60 * 1000 });
  const ctx = buildCtx({ config: { MEDIA_CDN_BASE: 'https://cdn.example.com' },
    localStorage: { tcg_media_src_fail_v1: old } });
  check('E5 TTL 过期后自动回到主源（不会永久拉黑）',
    ctx.mediaDirectUrls('通用断电视频.mp4')[0].sourceId === 'cdn');
}

/* ---------------- F. 候选链真的会顺着往下试 ---------------- */
section('F. _playCandidateChain 行为（假 video + 假 tryPlaySource 真跑）');

function runChain(opts) {
  /* 每条源的可选行为：'ok' 播放成功，'fail' 触发 onerror */
  const tried = [];
  const cached = [];
  const marked = [];
  const ctx = {
    console,
    _videoSession: 7,
    cacheUrlToDisk: (url, name) => cached.push([url, name]),
    MEDIA_SOURCE_HEALTH: {
      markFailed: (id) => marked.push('fail:' + id),
      markOk: (id) => marked.push('ok:' + id),
    },
    /* 假播放器：把"成功/失败"按 plan 决定，同步回调，避免测试里等待 */
    tryPlaySource: (video, url, fallback, session, onReady) => {
      tried.push(url);
      const verdict = (opts.plan[url] || 'fail');
      if (verdict === 'ok') { if (onReady) onReady(); }
      else fallback();
    },
  };
  vm.createContext(ctx);
  vm.runInContext('let _videoSession = this._videoSession;', ctx);
  vm.runInContext(F_CHAIN, ctx);
  let allFailed = 0;
  const cands = opts.cands;
  const session = 'session' in opts ? opts.session : 7;
  vm.runInContext('_playCandidateChain', ctx)(
    { parentElement: { querySelector: () => null } }, cands, 0, () => { allFailed++; }, session, '通用断电视频.mp4');
  return { tried, cached, marked, allFailed };
}

const CDN = { sourceId: 'cdn', label: '对象存储', url: 'https://cdn.example.com/tcgv_b5fc668c92.mp4' };
const GH = { sourceId: 'github', label: 'GitHub Release', url: RELEASE_BASE + '/tcgv_b5fc668c92.mp4' };

{
  const r = runChain({ cands: [CDN, GH], plan: { [CDN.url]: 'fail', [GH.url]: 'ok' } });
  check('F1 主源失败后确实试了备源', r.tried.length === 2 && r.tried[1] === GH.url, JSON.stringify(r.tried));
  check('F2 只给失败的源记 fail，成功的源记 ok',
    r.marked.join(',') === 'fail:cdn,ok:github', r.marked.join(','));
  check('F3 落盘缓存用的是成功那个源的 URL（不能把失败源写进缓存）',
    r.cached.length === 1 && r.cached[0][0] === GH.url, JSON.stringify(r.cached));
  check('F4 有源成功就不触发"全部失败"', r.allFailed === 0);
}

{
  const r = runChain({ cands: [CDN, GH], plan: {} });
  check('F5 全部失败时调用一次 onAllFailed（交给飞书/别名回退链）', r.allFailed === 1);
  check('F6 全部失败不写落盘缓存', r.cached.length === 0);
}

{
  const r = runChain({ cands: [], plan: {} });
  check('F7 空候选链直接回调 onAllFailed（不抛异常）', r.allFailed === 1 && r.tried.length === 0);
}

{
  // 会话失效：用户已退出播放器，任何源都不该再试
  const r = runChain({ cands: [CDN, GH], plan: {}, session: 8 });
  check('F8 会话失效时一个源都不试（关闭播放器后不再拉流）', r.tried.length === 0 && r.allFailed === 0);
}

/* ---------------- G. 接线：播放链路必须走候选链，不能再用单串 ---------------- */
section('G. 播放链路的接线（防止有人把候选链改回单串）');

const F_PLAY_RELEASE = extractFn(MEDIA, '_playReleaseOrCloud');
const F_FEISHU = extractFn(MEDIA, 'tryFeishuVideoSource');

check('G1 _playReleaseOrCloud 使用 mediaDirectUrls（候选链）', /mediaDirectUrls\s*\(/.test(F_PLAY_RELEASE || ''));
check('G2 _playReleaseOrCloud 不再直接调用 mediaDirectUrl（单串会被主源故障卡死）',
  !/[^s]\bmediaDirectUrl\s*\(/.test(F_PLAY_RELEASE || ''));
check('G3 别名回退同样走候选链', /mediaDirectUrlsAlias\s*\(/.test(F_FEISHU || ''));
check('G4 候选链播放器带会话守卫（关闭播放器后不再续试）',
  /session!==_videoSession/.test(F_CHAIN || ''));

/* ---------------- 汇总 ---------------- */
console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败');
if (fail) { console.log('  失败项: ' + failures.join(' | ')); }
process.exit(fail ? 1 : 0);
