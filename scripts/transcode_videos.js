#!/usr/bin/env node
/**
 * transcode_videos.js — 教学视频批量转码（零成本方案的执行器）
 *
 * 目的: 把手机原片(均值 114MB)压到 ~15MB, 使 jsDelivr(单文件 20MB 上限)可用、
 *       手机 4G 首帧从「分钟级」降到「秒级」，且不需要买 CDN。
 *
 * 关键点:
 *   ① -movflags +faststart 把 moov 前置 → 边下边播(不必下完), 这是"秒开"的物理前提
 *   ② 720p 下限: 断电位置/线束细节要看得清, 再低影响现场识别
 *   ③ 输出文件名带内容哈希 → CDN 可永久缓存, 且天然解决重名
 *
 * 用法:
 *   node scripts/transcode_videos.js --check                 # 检查 ffmpeg 是否可用
 *   node scripts/transcode_videos.js --dry-run               # 只列计划
 *   node scripts/transcode_videos.js                         # 转码 vehicle_videos/ → dist/videos-720p/
 *   node scripts/transcode_videos.js --in <目录> --out <目录> --profile 1080p --force
 *
 * 输出: <out>/<原名去后缀>__<sha8>.mp4  +  <out>/transcode-report.json
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

function argOf(flag, dft) {
  const i = process.argv.indexOf(flag);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : dft;
}
const IN_DIR = path.resolve(ROOT, argOf('--in', 'vehicle_videos'));
const OUT_DIR = path.resolve(ROOT, argOf('--out', 'dist/videos-720p'));
const PROFILE = argOf('--profile', '720p');
const FORCE = process.argv.includes('--force');
const DRY = process.argv.includes('--dry-run');
const CHECK = process.argv.includes('--check');

const PROFILES = {
  // 720p: 现场手机观看为主, 兼顾体积与清晰度
  '720p':  { scale: 'scale=-2:720', fps: 25, crf: 26, maxrate: '1500k', bufsize: '3000k', audio: '96k' },
  // 1080p: 需要看清线束细节时用, 体积约翻倍
  '1080p': { scale: 'scale=-2:1080', fps: 30, crf: 27, maxrate: '2500k', bufsize: '5000k', audio: '128k' }
};

const JSDELIVR_LIMIT = 20 * 1024 * 1024; // jsDelivr 单文件上限, 超过则该文件只能走 GitHub 直链

function run(cmd, args) {
  return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 });
}

function checkFfmpeg() {
  const r = run('ffmpeg', ['-version']);
  if (r.error || r.status !== 0) {
    console.error('[transcode] 未找到 ffmpeg。安装方式:');
    console.error('  Ubuntu/Debian : sudo apt install ffmpeg');
    console.error('  Windows       : https://www.gyan.dev/ffmpeg/builds/ (解压后把 bin 加入 PATH)');
    process.exit(2);
  }
  const ver = (r.stdout || '').split('\n')[0];
  const enc = run('ffmpeg', ['-hide_banner', '-encoders']);
  const has264 = /libx264/.test(enc.stdout || '');
  console.log(`[transcode] ${ver}`);
  console.log(`[transcode] libx264: ${has264 ? '✅ 可用' : '❌ 不可用(需要换一个带 x264 的构建)'}`);
  if (!has264) process.exit(2);
  console.log(`[transcode] 预设 ${PROFILE}: ${JSON.stringify(PROFILES[PROFILE] || PROFILES['720p'])}`);
}

function sha256File(p) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(p, 'r');
  const buf = Buffer.alloc(1024 * 1024);
  let n;
  try { while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n)); }
  finally { fs.closeSync(fd); }
  return h.digest('hex');
}

function mb(bytes) { return (bytes / 1048576).toFixed(1); }

function main() {
  if (CHECK) { checkFfmpeg(); return; }

  const prof = PROFILES[PROFILE];
  if (!prof) { console.error(`[transcode] 未知预设 ${PROFILE}, 可选: ${Object.keys(PROFILES).join(' / ')}`); process.exit(2); }
  if (!fs.existsSync(IN_DIR)) {
    console.error(`[transcode] 输入目录不存在: ${IN_DIR}`);
    console.error('[transcode] 提示: 视频不入仓库(.gitignore), 先在本机恢复一次:');
    console.error('           python scripts/sync_feishu_assets.py --phase videos');
    process.exit(2);
  }

  const files = fs.readdirSync(IN_DIR).filter(f => /\.(mp4|mov|m4v)$/i.test(f)).sort();
  if (!files.length) { console.error('[transcode] 目录内没有视频'); process.exit(2); }

  if (!DRY) { checkFfmpeg(); fs.mkdirSync(OUT_DIR, { recursive: true }); }

  const report = [];
  let srcTotal = 0, outTotal = 0, skipped = 0, failed = 0;

  console.log(`[transcode] ${files.length} 个视频 → ${path.relative(ROOT, OUT_DIR)}  (预设 ${PROFILE})\n`);

  files.forEach((f, idx) => {
    const src = path.join(IN_DIR, f);
    const srcSize = fs.statSync(src).size;
    const stem = f.replace(/\.[^.]+$/, '');
    const srcSha = sha256File(src);
    const outName = `${stem}__${srcSha.slice(0, 8)}.mp4`;
    const out = path.join(OUT_DIR, outName);

    if (!FORCE && fs.existsSync(out)) {
      const outSize = fs.statSync(out).size;
      console.log(`[${idx + 1}/${files.length}] ⏭  已存在，跳过: ${outName}`);
      report.push({ src: f, out: outName, srcSize, outSize, outSha256: sha256File(out), skipped: true });
      srcTotal += srcSize; outTotal += outSize; skipped++;
      return;
    }

    const args = [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-i', src,
      '-vf', prof.scale,
      '-r', String(prof.fps),
      '-c:v', 'libx264', '-preset', 'medium',
      '-crf', String(prof.crf),
      '-maxrate', prof.maxrate, '-bufsize', prof.bufsize,
      '-profile:v', 'high', '-level', '4.0',
      '-pix_fmt', 'yuv420p',            // 兼容老机型解码
      '-c:a', 'aac', '-b:a', prof.audio, '-ac', '1',
      '-movflags', '+faststart',        // ← moov 前置, 秒开的关键
      out
    ];

    console.log(`[${idx + 1}/${files.length}] ▶ ${f}  (${mb(srcSize)} MB)`);
    if (DRY) { console.log('    ' + ['ffmpeg', ...args].join(' ')); return; }

    const r = run('ffmpeg', args);
    if (r.status !== 0 || !fs.existsSync(out)) {
      failed++;
      console.error(`    ❌ 失败: ${(r.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
      return;
    }

    const outSize = fs.statSync(out).size;
    const outSha = sha256File(out);
    const ratio = ((1 - outSize / srcSize) * 100).toFixed(0);
    const flag = outSize > JSDELIVR_LIMIT ? '  ⚠️ 超 20MB，该片只能走 GitHub 直链' : '';
    console.log(`    ✅ ${mb(srcSize)} MB → ${mb(outSize)} MB  (省 ${ratio}%)${flag}`);

    report.push({ src: f, out: outName, srcSize, outSize, outSha256: outSha, skipped: false });
    srcTotal += srcSize; outTotal += outSize;
  });

  if (DRY) { console.log('\n[transcode] --dry-run，未执行转码'); return; }

  fs.writeFileSync(
    path.join(OUT_DIR, 'transcode-report.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), profile: PROFILE, inDir: path.relative(ROOT, IN_DIR), items: report }, null, 1)
  );

  const saved = srcTotal ? ((1 - outTotal / srcTotal) * 100).toFixed(0) : '0';
  console.log(`\n[transcode] 完成: ${report.length} 个 | 跳过 ${skipped} | 失败 ${failed}`);
  console.log(`[transcode] 体积 ${mb(srcTotal)} MB → ${mb(outTotal)} MB (省 ${saved}%)`);
  console.log(`[transcode] 报告: ${path.relative(ROOT, path.join(OUT_DIR, 'transcode-report.json'))}`);
  console.log('[transcode] 下一步: 把输出目录里的 mp4 传到 GitHub Release，并跑 fingerprint_videos 更新指纹');
  if (failed) process.exit(1);
}

main();
