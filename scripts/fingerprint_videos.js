#!/usr/bin/env node
/**
 * fingerprint_videos.js — 视频内容指纹生成器(零成本方案)
 *
 * 背景(反馈问题5): `通用断电视频.mp4` 被 15 个车型共用, 但 manifest 里 sha256 恒为空
 *   (视频不入仓库, 只存飞书/GitHub Release), 于是"确实是同一个视频"只是约定而非证明;
 *   一旦有人替换了同名文件, 所有引用它的车型会静默变成"错片", 且无法被审计发现。
 *
 * 做法: 在**持有本地视频文件的机器**上跑一次, 把 {文件名: {sha256,size}} 落到
 *   docs/video_fingerprints.json(约几十 KB, 可入库)。之后:
 *     - gen_media_mapping.js 生成 manifest 时自动读取并填入 sha256;
 *     - audit_media_consistency.js 的 C3/C8 即可校验"共享视频内容一致";
 *     - 云端替换检测: 任何一次重新生成指纹后 diff 该文件, 内容变了立刻可见。
 *
 * 用法:
 *   node scripts/fingerprint_videos.js                    # 扫描 vehicle_videos/
 *   node scripts/fingerprint_videos.js --dir <路径>        # 指定视频目录
 *   node scripts/fingerprint_videos.js --check            # 只校验不写盘(CI 用)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'docs', 'video_fingerprints.json');

function argOf(flag, dft) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dft;
}

const VIDEO_DIR = path.resolve(ROOT, argOf('--dir', 'vehicle_videos'));
const CHECK_ONLY = process.argv.includes('--check');
/**
 * V10.26.4: --release-map <path>
 * GitHub Release 里的视频文件名是 `tcgv_<hash>.mp4`（脱敏/去重后的名字），
 * 而 manifest / 数据里引用的是**原始文件名**（如「通用断电视频.mp4」）。
 * 传了映射表就把同一资产的指纹回填到所有原始名下，否则 manifest 永远填不上。
 */
const RELEASE_MAP = argOf('--release-map', '') ? path.resolve(ROOT, argOf('--release-map', '')) : '';
function loadAliasMap() {
  if (!RELEASE_MAP) return {};
  try {
    const j = JSON.parse(fs.readFileSync(RELEASE_MAP, 'utf8'));
    const alias = {};                       // asset -> [原始名...]
    for (const [orig, asset] of Object.entries(j.map || {})) (alias[asset] = alias[asset] || []).push(orig);
    return alias;
  } catch (e) {
    console.error('[fingerprint] 读取 --release-map 失败:', e.message); process.exit(2);
  }
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  try {
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest('hex');
}

function main() {
  if (!fs.existsSync(VIDEO_DIR)) {
    console.error(`[fingerprint] 视频目录不存在: ${VIDEO_DIR}`);
    console.error('[fingerprint] 提示: 视频不入仓库(.gitignore), 需先在本机恢复一次:');
    console.error('            python scripts/sync_feishu_assets.py --phase videos');
    process.exit(2);
  }
  const files = fs.readdirSync(VIDEO_DIR).filter(f => /\.(mp4|mov|m4v)$/i.test(f));
  if (!files.length) {
    console.error('[fingerprint] 目录内没有视频文件');
    process.exit(2);
  }

  const prev = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : { videos: {} };
  const next = { generatedAt: new Date().toISOString(), dir: path.relative(ROOT, VIDEO_DIR), videos: {} };
  const changed = [];

  const alias = loadAliasMap();
  for (const f of files) {
    const abs = path.join(VIDEO_DIR, f);
    const sha = sha256File(abs);
    const size = fs.statSync(abs).size;
    next.videos[f] = { sha256: sha, size };
    /* 资产名 -> 数据里的原始文件名（一一或多对一） */
    (alias[f] || []).forEach(function (orig) {
      next.videos[orig] = { sha256: sha, size: size, asset: f };
      const old = prev.videos && prev.videos[orig];
      if (old && old.sha256 && old.sha256 !== sha) changed.push(orig);
    });
    const old = prev.videos && prev.videos[f];
    if (old && old.sha256 && old.sha256 !== sha) changed.push(f);
  }

  if (changed.length) {
    console.warn(`[fingerprint] ⚠️ 内容已变化(同名不同片, 需人工确认是否有意替换): ${changed.join(', ')}`);
  }

  if (CHECK_ONLY) {
    const prevVideoKeys = Object.keys(prev.videos || {}).filter(function (k) { return (prev.videos[k] || {}).sha256; });
    const missing = prevVideoKeys.filter(function (k) { return !next.videos[k]; });
    if (missing.length) { console.error('[fingerprint] --check: 本地目录缺少这些已入库指纹的视频: ' + missing.slice(0, 5).join(', ')); process.exit(1); }
    const a = JSON.stringify(next.videos), b = JSON.stringify((prev.videos || {}));
    if (a !== b) { console.error('[fingerprint] --check: 指纹与已入库文件不一致, 请重跑生成'); process.exit(1); }
    console.log(`[fingerprint] --check 通过: ${files.length} 个视频指纹一致`);
    return;
  }

  fs.writeFileSync(OUT, JSON.stringify(next, null, 1));
  console.log(`[fingerprint] 已写入 ${path.relative(ROOT, OUT)}: ${files.length} 个视频`);
  for (const f of files.slice(0, 5)) console.log(`  ${next.videos[f].sha256.slice(0, 12)}…  ${(next.videos[f].size / 1048576).toFixed(1)}MB  ${f}`);
}

main();
