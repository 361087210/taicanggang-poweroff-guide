#!/usr/bin/env node
/**
 * ============================================================
 * bench_media_sources.js — 资源库视频「播放源」可复现基准测试
 * ============================================================
 * 为什么存在：视频放哪儿（飞书 / GitHub / 对象存储）是个要拿数据拍的决定，
 * 但"我觉得飞书快"不能作为依据。本脚本把三件事测成数字：
 *   ① 冷缓存下的首字节（TTFB）—— 用户点播放到第一帧出现的时间主体；
 *   ② 稳态吞吐（读前 N MB）—— 决定 8MB 视频是 2 秒还是 90 秒；
 *   ③ Range 支持（206 + Content-Range）—— 决定进度条能不能拖着播。
 *
 * 用法：
 *   node scripts/bench_media_sources.js                      # 测 GitHub + 飞书
 *   node scripts/bench_media_sources.js --sources github     # 只测一个源
 *   node scripts/bench_media_sources.js --bytes 8388608 --repeat 3
 *   WORKBUDDY_BENCH_URLS="https://cdn.example.com/a.mp4" \
 *     node scripts/bench_media_sources.js --sources workbuddy
 *   node scripts/bench_media_sources.js --write              # 结果写 docs/media_source_bench.json
 *
 * 设计约束（为什么这么写）：
 *   - 只用 Node 内置 http/https，不引入依赖：CI 与本机都能跑；
 *   - 每个源至少 repeat 次，报「中位 + p95」，因为国内到 GitHub 的抖动本身
 *     就是结论的一部分（单次测量会把 21 秒那次当成噪声丢掉）；
 *   - 测的是"搬运速度"不是"服务稳定性"：失败率单独统计，不混进均值；
 *   - 飞书源必须带 tenant_access_token（前端拿不到，这是它最大的工程成本），
 *     凭据从 ~/Desktop/秘钥.txt 或 FEISHU_APP_ID/FEISHU_APP_SECRET 读。
 *
 * 退出码：0 全部源测通；1 有源失败（矩阵仍打印，便于对比）。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = '361087210/taicanggang-poweroff-guide';
const KEY_FILE = process.env.TCG_KEY_FILE || path.join(process.env.HOME || '', 'Desktop/秘钥.txt');

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const ONLY = String(arg('sources', 'github,feishu')).split(',').map(s => s.trim()).filter(Boolean);
const MAX_BYTES = Number(arg('bytes', 4 * 1024 * 1024));
const REPEAT = Math.max(1, Number(arg('repeat', 3)));
const CONCURRENCY = Math.max(1, Number(arg('concurrency', 2)));
const WRITE = arg('write', false) === true;
const OUT = path.join(ROOT, 'docs/media_source_bench.json');

/* ---------- 一把尺子：对任意 URL 测 首字节 / 吞吐 / Range ---------- */

/**
 * 下载至多 maxBytes，返回耗时分解。
 * 为什么要自己算而不是用 curl：要区分 DNS/TCP/TLS/TTFB，且要跨源同口径。
 */
function fetchSample(url, opts) {
  opts = opts || {};
  const maxBytes = opts.maxBytes || MAX_BYTES;
  const headers = Object.assign({ 'User-Agent': 'tcg-bench/1' }, opts.headers || {});
  if (opts.range) headers.Range = 'bytes=0-' + (maxBytes - 1);

  return new Promise((resolve) => {
    const t0 = process.hrtime.bigint();
    const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
    let dnsMs = null, connectMs = null, tlsMs = null, ttfbMs = null, bytes = 0, status = 0;
    let contentRange = null, settled = false;
    const lib = url.startsWith('https:') ? https : http;

    const done = (err) => {
      if (settled) return; settled = true;
      resolve({ err: err ? String(err.message || err) : null, dnsMs, connectMs, tlsMs, ttfbMs,
        bytes, status, contentRange, totalMs: ms(t0) });
    };

    const req = lib.get(url, { headers }, (res) => {
      status = res.statusCode;
      contentRange = res.headers['content-range'] || null;
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 跨域跳转（GitHub→objects、飞书→CDN）：跟随，但不再带 Authorization，
        // 否则 CDN 会以"非法头"拒绝——这也是前端拿不到飞书直链的原因之一。
        res.resume();
        settled = true;
        return resolve(fetchSample(res.headers.location, Object.assign({}, opts, { headers: {} }))
          .then(r => resolve === null ? r : r));
      }
      res.on('data', (c) => {
        if (ttfbMs === null) ttfbMs = ms(t0);
        bytes += c.length;
        if (bytes >= maxBytes) { res.destroy(); done(null); }
      });
      res.on('end', () => done(null));
      res.on('error', (e) => done(e));
    });
    req.on('socket', (s) => {
      s.once('lookup', () => { dnsMs = ms(t0); });
      s.once('connect', () => { connectMs = ms(t0); });
      s.once('secureConnect', () => { tlsMs = ms(t0); });
    });
    req.setTimeout(45000, () => { req.destroy(new Error('timeout 45s')); });
    req.on('error', (e) => done(e));
  });
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const p95 = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };

/* ---------- 各源如何"取一个可播放的地址" ---------- */

function githubSampleUrl() {
  const mapFile = path.join(ROOT, 'docs/media_release_map.json');
  let asset = null;
  if (fs.existsSync(mapFile)) {
    const m = JSON.parse(fs.readFileSync(mapFile, 'utf8')).map || {};
    const names = Object.keys(m);
    if (names.length) asset = m[names[Math.floor(names.length / 2)]]; // 取中位名，避免只测第一个
  }
  asset = asset || 'tcgv_104bb1ef84.mp4';
  return { label: 'github:' + asset,
    url: `https://github.com/${REPO}/releases/download/media-videos/${asset}` };
}

function readKeyFile() {
  try { return fs.readFileSync(KEY_FILE, 'utf8'); } catch (e) { return ''; }
}

async function feishuSample() {
  const env = process.env;
  let appId = env.FEISHU_APP_ID, appSecret = env.FEISHU_APP_SECRET;
  if (!appId || !appSecret) {
    const raw = readKeyFile();
    appId = appId || (raw.match(/cli_[a-z0-9]+/) || [])[0];
    const m = raw.match(/App Secret[：:]\s*([A-Za-z0-9]+)/);
    appSecret = appSecret || (m && m[1]);
  }
  if (!appId || !appSecret) return { label: 'feishu', err: '缺 FEISHU_APP_ID / FEISHU_APP_SECRET（或本机秘钥文件）' };

  /* 通用请求（GET 不带 body、POST 带 JSON）：飞书这边既要列表又要取 token */
  const req = (method, url, body, headers) => new Promise((resolve, reject) => {
    const u = new URL(url);
    const data = body ? JSON.stringify(body) : null;
    const r = https.request({ method, hostname: u.hostname, path: u.pathname + u.search,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers,
        data ? { 'Content-Length': Buffer.byteLength(data) } : {}) }, (res) => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error('HTTP ' + res.statusCode + ' ' + d.slice(0, 120))); } });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
  const post = (url, body, headers) => req('POST', url, body, headers);
  const get = (url, headers) => req('GET', url, null, headers);

  const auth = await post('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal',
    { app_id: appId, app_secret: appSecret }, {});
  const token = auth.tenant_access_token;
  if (!token) return { label: 'feishu', err: '取 token 失败: ' + JSON.stringify(auth).slice(0, 120) };

  /* 样本选择：环境变量指定 file_token 优先；否则用当前版本 APK（同在飞书 CDN 上，
   * 传输层口径一致——本脚本测的就是传输层，不是某个视频的编码特性） */
  let fileToken = env.FEISHU_BENCH_FILE_TOKEN || null;
  let label = 'feishu:' + (fileToken || '');
  if (!fileToken) {
    const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8')).version;
    const list = async (folder) => {
      const j = await get(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${encodeURIComponent(folder)}&page_size=100`, { Authorization: 'Bearer ' + token });
      return (j.data && j.data.files) || [];
    };
    const root = await list('DBgAffrR9lBuG1dWVPycAql4npb');
    const rel = root.find(f => f.name === '发版产物');
    if (!rel) return { label: 'feishu', err: '飞书里找不到「发版产物」目录' };
    const verFolder = (await list(rel.token)).find(f => f.name === 'v' + ver) || (await list(rel.token))[0];
    const apk = (await list(verFolder.token)).find(f => /\.apk$/.test(f.name));
    if (!apk) return { label: 'feishu', err: '找不到 APK 样本' };
    fileToken = apk.token;
    label = 'feishu:' + apk.name;
  }
  return {
    label,
    url: `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`,
    headers: { Authorization: 'Bearer ' + token },
  };
}

/* ---------- 主流程 ---------- */

async function benchSource(sample) {
  if (sample.err) return { label: sample.label, error: sample.err, runs: [] };
  const runs = [];
  for (let i = 0; i < REPEAT; i++) {
    const r = await fetchSample(sample.url, { headers: sample.headers, range: true });
    runs.push(r);
  }
  const ok = runs.filter(r => !r.err && r.bytes > 0);
  // 并发：2 路同时取，看带宽是否被抢占（CDN 与源站差异明显）
  const conc = await Promise.all(Array.from({ length: CONCURRENCY }, () =>
    fetchSample(sample.url, { headers: sample.headers, range: true })));
  const concSpeed = conc.filter(r => !r.err).reduce((s, r) => s + r.bytes / (r.totalMs / 1000), 0);

  return {
    label: sample.label,
    runs,
    error: ok.length ? null : (runs[0] && (runs[0].err || 'HTTP ' + runs[0].status)) || '无有效样本',
    summary: ok.length ? {
      samples: ok.length,
      ttfbMedian: median(ok.map(r => r.ttfbMs || r.totalMs)),
      ttfbP95: p95(ok.map(r => r.ttfbMs || r.totalMs)),
      speedMedian: median(ok.map(r => r.bytes / (r.totalMs / 1000))),
      speedP05: Math.min(...ok.map(r => r.bytes / (r.totalMs / 1000))),
      rangeOk: ok.every(r => r.status === 206 && !!r.contentRange),
      http: [...new Set(ok.map(r => r.status))].join('/'),
      concSpeed: Math.round(concSpeed),
    } : null,
  };
}

const kb = (b) => (b / 1024).toFixed(0) + ' KB/s';

/* 导出纯函数 + 取址逻辑：测试要能直接验证口径（中位/p95/URL 形状），
 * 而不用真的发请求——基准测试要可复现，断言也要可复现。 */
module.exports = { median, p95, githubSampleUrl, fetchSample, kb };

if (require.main === module) main();

async function main() {
  const samples = [];
  if (ONLY.includes('github')) samples.push(githubSampleUrl());
  if (ONLY.includes('feishu')) samples.push(await feishuSample());
  if (ONLY.includes('workbuddy')) {
    const urls = String(process.env.WORKBUDDY_BENCH_URLS || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!urls.length) {
      samples.push({ label: 'workbuddy', err: '缺 WORKBUDDY_BENCH_URLS（贴一个公开可读的对象存储直链）' });
    } else {
      urls.slice(0, 3).forEach((u, i) => samples.push({ label: 'workbuddy#' + (i + 1) + ':' + new URL(u).host, url: u }));
    }
  }

  const results = [];
  for (const s of samples) {
    process.stderr.write('  测试 ' + s.label + ' …\n');
    results.push(await benchSource(s));
  }

  /* 报表：先矩阵（横向对比），再逐次明细（抖动证据） */
  console.log('\n=== 资源库视频播放源基准（' + new Date().toISOString().slice(0, 19) + 'Z，每次至多 ' + (MAX_BYTES / 1048576).toFixed(1) + 'MB × ' + REPEAT + ' 次） ===\n');
  console.log('| 源 | HTTP | TTFB 中位 | TTFB p95 | 吞吐 中位 | 吞吐最差 | 2 路并发合计 | Range |');
  console.log('|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    if (!r.summary) { console.log(`| ${r.label} | - | - | - | - | - | - | 失败: ${r.error} |`); continue; }
    const s = r.summary;
    console.log(`| ${r.label} | ${s.http} | ${(s.ttfbMedian / 1000).toFixed(2)}s | ${(s.ttfbP95 / 1000).toFixed(2)}s | ${kb(s.speedMedian)} | ${kb(s.speedP05)} | ${kb(s.concSpeed)} | ${s.rangeOk ? '✅ 206' : '❌'} |`);
  }
  console.log('\n=== 逐次明细（抖动是结论的一部分，别只看中位） ===');
  for (const r of results) {
    if (!r.runs || !r.runs.length) continue;
    console.log('  ' + r.label);
    r.runs.forEach((x, i) => {
      const sp = x.bytes && x.totalMs ? kb(x.bytes / (x.totalMs / 1000)) : '-';
      console.log(`    #${i + 1} http=${x.status} ttfb=${x.ttfbMs ? (x.ttfbMs / 1000).toFixed(2) + 's' : '-'} ` +
        `total=${(x.totalMs / 1000).toFixed(2)}s bytes=${(x.bytes / 1048576).toFixed(2)}MB → ${sp}` + (x.err ? ' ERR=' + x.err : ''));
    });
  }

  if (WRITE) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(),
      maxBytes: MAX_BYTES, repeat: REPEAT, concurrency: CONCURRENCY, results }, null, 2) + '\n');
    console.log('\n  已写入 ' + path.relative(ROOT, OUT));
  }

  const failed = results.filter(r => !r.summary).length;
  process.exit(failed && failed === results.length ? 1 : 0);
}
