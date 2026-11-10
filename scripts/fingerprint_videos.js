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

  for (const f of files) {
    const abs = path.join(VIDEO_DIR, f);
    const sha = sha256File(abs);
    const size = fs.statSync(abs).size;
    next.videos[f] = { sha256: sha, size };
    const old = prev.videos && prev.videos[f];
    if (old && old.sha256 && old.sha256 !== sha) changed.push(f);
  }

  if (changed.length) {
    console.warn(`[fingerprint] ⚠️ 内容已变化(同名不同片, 需人工确认是否有意替换): ${changed.join(', ')}`);
  }

  if (CHECK_ONLY) {
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
