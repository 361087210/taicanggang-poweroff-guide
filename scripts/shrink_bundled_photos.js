#!/usr/bin/env node
/**
 * 打包期照片瘦身（V10.27.10）
 * ---------------------------------------------------------------------------
 * 背景: 飞书云空间对单文件有大小上限（当前租户约 20MB）。APK/IPA 会把仓库里
 *   vehicle_images/ 的**原始照片**整包打进 www，一旦回流一张手机原图（4MB+），
 *   安装包就会越过 20MB，导致 "Sync Release to Feishu" 预上传失败
 *   （1061043 file size beyond limit），飞书目录拿不到这一版安装包。
 *
 * 策略: **仓库保留原图**（资源库/COS 仍用原图），只在**构建产物**里生成压缩副本：
 *   - 仅处理 .jpg/.jpeg；PNG 图标与调色板渲染图有透明/色彩约束，不动
 *   - 体积超过 --max-bytes 或最长边超过 --max-edge 的照片，等比缩到 max-edge，重编码
 *   - 处理完再校验目录总预算（--budget-mb），超限直接失败，避免"悄悄变大"
 *
 * 用法:
 *   node scripts/shrink_bundled_photos.js tcg_app/www/vehicle_images
 *   node scripts/shrink_bundled_photos.js <dir> --max-edge 1600 --max-bytes 800000 \
 *        --quality 80 --budget-mb 18 [--dry-run]
 *
 * 退出码: 0 正常 / 1 依赖缺失、压缩失败或预算超限
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const DEFAULTS = { maxEdge: 1600, maxBytes: 800 * 1024, quality: 80, budgetMb: 18 };

function parseArgs(argv) {
  const args = { dirs: [], dryRun: false, allowMissing: false, ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--allow-missing-imagemagick') args.allowMissing = true;
    else if (a === '--max-edge') args.maxEdge = Number(next());
    else if (a === '--max-bytes') args.maxBytes = Number(next());
    else if (a === '--quality') args.quality = Number(next());
    else if (a === '--budget-mb') args.budgetMb = Number(next());
    else if (a.startsWith('--')) throw new Error('未知参数: ' + a);
    else args.dirs.push(a);
  }
  if (!args.dirs.length) throw new Error('缺少目标目录');
  return args;
}

/** 递归收集指定后缀的文件（返回绝对路径） */
function collect(dir, exts) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collect(p, exts));
    else if (exts.has(path.extname(ent.name).toLowerCase())) out.push(p);
  }
  return out;
}

function dirBytes(files) {
  return files.reduce((s, f) => s + fs.statSync(f).size, 0);
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2) + 'MB';
}

function which(bin) {
  const r = spawnSync(bin, ['-version'], { encoding: 'utf8' });
  return r.status === 0;
}

/** 读取 jpg 最长边（ImageMagick identify）；失败返回 0（按体积规则处理） */
function maxEdgeOf(file) {
  const r = spawnSync('identify', ['-format', '%[fx:max(w,h)]', file], { encoding: 'utf8' });
  if (r.status !== 0) return 0;
  const n = parseInt(String(r.stdout).trim(), 10);
  return Number.isFinite(n) ? n : 0;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const files = [];
  for (const d of args.dirs) files.push(...collect(path.resolve(d), new Set(['.jpg', '.jpeg'])));
  if (!files.length) {
    console.log('[照片瘦身] 目标目录内没有 jpg/jpeg，跳过');
    return;
  }

  const hasIm = which('mogrify') && which('identify');
  if (!hasIm) {
    const msg = '[照片瘦身] 未找到 ImageMagick（mogrify/identify）';
    if (args.dryRun || args.allowMissing) {
      console.warn(msg + '，本次跳过压缩（dry-run/allow-missing）');
    } else {
      console.error(msg + '，无法压缩打包照片；请安装 ImageMagick，或显式传 --allow-missing-imagemagick');
      process.exit(1);
    }
  }

  const before = dirBytes(files);
  let changed = 0, saved = 0;
  const targets = [];

  for (const f of files) {
    const size = fs.statSync(f).size;
    const edge = (hasIm && !args.dryRun) ? maxEdgeOf(f) : 0;
    const tooBig = size > args.maxBytes;
    const tooWide = edge > args.maxEdge;
    if (!tooBig && !tooWide) continue;
    targets.push({ f, size, edge });
  }

  for (const t of targets) {
    if (args.dryRun) {
      console.log(`[照片瘦身][dry-run] 待压缩 ${path.relative(process.cwd(), t.f)} (${mb(t.size)}${t.edge ? ', ' + t.edge + 'px' : ''})`);
      continue;
    }
    const r = spawnSync('mogrify', [
      '-resize', `${args.maxEdge}x${args.maxEdge}>`,
      '-quality', String(args.quality),
      '-strip', t.f
    ], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(`[照片瘦身] 压缩失败: ${t.f}\n${r.stderr || ''}`);
      process.exit(1);
    }
    const after = fs.statSync(t.f).size;
    saved += Math.max(0, t.size - after);
    changed++;
    console.log(`[照片瘦身] ${path.relative(process.cwd(), t.f)} ${mb(t.size)} -> ${mb(after)}`);
  }

  const afterTotal = dirBytes(files);
  console.log(`[照片瘦身] 压缩 ${changed} 张（候选 ${targets.length}），合计 ${mb(before)} -> ${mb(afterTotal)}，节省 ${mb(saved)}`);

  if (afterTotal > args.budgetMb * 1024 * 1024) {
    const top = files.map(f => ({ f, s: fs.statSync(f).size })).sort((a, b) => b.s - a.s).slice(0, 5);
    console.error(`[照片瘦身] 打包照片总量 ${mb(afterTotal)} 超过预算 ${args.budgetMb}MB，请压缩/替换以下大图后再发版:`);
    for (const t of top) console.error('  - ' + path.relative(process.cwd(), t.f) + ' ' + mb(t.s));
    process.exit(1);
  }
}

try {
  main();
} catch (e) {
  console.error('[照片瘦身] ' + (e && e.message ? e.message : e));
  process.exit(1);
}
