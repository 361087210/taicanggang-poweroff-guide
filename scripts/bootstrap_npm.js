#!/usr/bin/env node
/**
 * bootstrap_npm.js - 无 npm 环境引导安装器（V10.12 开发机专用工具）
 *
 * 背景: 本机仅有裸 node.exe（无 npm / corepack / python），而 tests/test_v57_logic.js
 *       需要 jsdom。CI(Linux)不受影响——CI 镜像自带 npm。
 *
 * 原理: npm 官方发布 tarball 自带全部 bundled 依赖（node_modules 内嵌），
 *       只需下载一次并解包，即可用 node 直接运行 npm-cli.js。
 *
 *   1) GET <registry>/npm/latest        → 取 dist.tarball
 *   2) 下载 .tgz → zlib.gunzipSync      → 最小 tar 解包器(ustar/pax/GNU长名)
 *      解到 scripts/.npm-vendor/npm/
 *   3) 之后: node scripts\.npm-vendor\npm\bin\npm-cli.js install <pkg>
 *
 * 用法: node scripts/bootstrap_npm.js [npm版本，默认latest]
 * 幂等: 已解包过则直接跳过。
 */
'use strict';

const https = require('https');
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NPM_DIR = path.join(ROOT, 'scripts', '.npm-vendor', 'npm');
// 国内优先 npmmirror，失败回落官方源
const REGISTRIES = [
  'https://registry.npmmirror.com',
  'https://registry.npmjs.org',
];

function fetchText(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'tcg-bootstrap-npm/1.0' }, timeout: timeoutMs || 30000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchText(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', c => data += c);
      res.on('end', () => resolve(data));
    });
    req.on('timeout', () => req.destroy(new Error('timeout: ' + url)));
    req.on('error', reject);
  });
}

function fetchBuffer(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'user-agent': 'tcg-bootstrap-npm/1.0' }, timeout: timeoutMs || 120000 }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve(fetchBuffer(new URL(res.headers.location, url).toString(), timeoutMs));
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode + ' ' + url)); }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout: ' + url)));
    req.on('error', reject);
  });
}

/** 最小 tar(.gz) 解包器——覆盖 npm tarball 会产生的全部形态:
 *  ustar prefix 长名 / pax 'x' path 覆盖 / GNU 'L' 长名 / 目录'5' / 文件'0'。
 *  symlink('2')/hardlink('1')/global-pax('g') 在 npm tarball 中不承载有效内容, 忽略。 */
function extractTarGz(buf, destDir) {
  const tar = zlib.gunzipSync(buf);
  const N = 512;
  let off = 0;
  let pendingName = null;      // GNU 'L' 长名 → 下一个条目
  let pendingPaxPath = null;   // pax 'x' path 覆盖 → 下一个条目
  let zeroBlocks = 0;
  let fileCount = 0, dirCount = 0;
  while (off + N <= tar.length) {
    const h = tar.subarray(off, off + N);
    let allZero = true;
    for (let i = 0; i < N; i++) if (h[i] !== 0) { allZero = false; break; }
    if (allZero) { zeroBlocks++; off += N; if (zeroBlocks >= 2) break; continue; } // 双零块=EOF
    zeroBlocks = 0;
    let name = h.toString('utf8', 0, 100).replace(/\0.*$/, '').trim();
    const size = parseInt(h.toString('utf8', 124, 136).replace(/[\0 ]/g, '').trim() || '0', 8) || 0;
    const type = String.fromCharCode(h[156] || 0x30);
    const prefix = h.toString('utf8', 345, 500).replace(/\0.*$/, '').trim();
    const dataStart = off + N;
    const dataEnd = dataStart + size;
    const data = tar.subarray(dataStart, dataEnd);
    off = dataStart + Math.ceil(size / N) * N;

    if (type === 'L') { pendingName = data.toString('utf8').replace(/\0.*$/, ''); continue; }
    if (type === 'x') {
      const m = /(?:^|\n)\d+ path=([^\n]*)/.exec(data.toString('utf8'));
      if (m) pendingPaxPath = m[1];
      continue;
    }
    if (type === 'g' || type === 'K') continue;

    if (pendingPaxPath) { name = pendingPaxPath; pendingPaxPath = null; }
    else if (pendingName) { name = pendingName; pendingName = null; }
    else if (prefix) name = prefix + '/' + name;

    if (type === '5') { dirCount++; continue; }
    if (type === '0' || type === '\0') {
      if (!name) continue;
      const rel = name.replace(/^package\//, '');
      if (!rel || rel.includes('..')) continue; // 防路径穿越
      const fp = path.join(destDir, rel);
      fs.mkdirSync(path.dirname(fp), { recursive: true });
      fs.writeFileSync(fp, Buffer.from(data));
      fileCount++;
      continue;
    }
    // '1'/'2'/其他: 忽略
  }
  return { fileCount, dirCount };
}

(async () => {
  if (fs.existsSync(path.join(NPM_DIR, 'bin', 'npm-cli.js'))) {
    console.log('[bootstrap] scripts/.npm-vendor/npm 已存在, 跳过下载。');
    return;
  }
  const ver = process.argv[2] || 'latest';
  let meta = null, regUsed = '';
  for (const reg of REGISTRIES) {
    try { meta = JSON.parse(await fetchText(reg + '/npm/' + ver)); regUsed = reg; break; }
    catch (e) { console.warn('[bootstrap] registry ' + reg + ' 不可达: ' + e.message); }
  }
  if (!meta) { console.error('[bootstrap] 所有 registry 均不可达, 无法引导 npm'); process.exit(1); }
  const tarballUrl = meta.dist.tarball;
  console.log('[bootstrap] npm ' + meta.version + ' ← ' + regUsed);
  console.log('[bootstrap] tarball: ' + tarballUrl);
  const tgz = await fetchBuffer(tarballUrl);
  console.log('[bootstrap] 下载完成 ' + (tgz.length / 1048576).toFixed(1) + ' MB, 解包中...');
  fs.mkdirSync(NPM_DIR, { recursive: true });
  const r = extractTarGz(tgz, NPM_DIR);
  console.log('[bootstrap] 解包完成: ' + r.fileCount + ' 个文件 / ' + r.dirCount + ' 个目录 → ' + NPM_DIR);
  console.log('[bootstrap] 完成。用法: node scripts\\.npm-vendor\\npm\\bin\\npm-cli.js install <pkg>');
})().catch(e => { console.error('[bootstrap] FAILED:', e.message); process.exit(1); });
