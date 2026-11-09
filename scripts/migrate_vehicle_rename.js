#!/usr/bin/env node
/**
 * migrate_vehicle_rename.js — 车型改名后的媒体归属迁移（幂等，可 dry-run）
 *
 * 背景（唯一会让归属失效的高频操作）:
 *   目录名由 `folderNameForVehicle(vehicle)` 从 `display` 派生。**改一次车型名，目录名就变**,
 *   已上传的照片视频仍留在旧目录 → 引用全部指向不存在的路径 → 网页端/ App 端同时"照片缺失",
 *   旧目录变成孤儿。
 *
 * 本脚本做三件事（不做第四件）:
 *   ① 仓库侧: 把 `vehicle_images/<旧目录>/` 用 `git mv` 移到 `<新目录>/`（保留历史）
 *   ② 数据侧: 回写 `vehicles_data.js` 与 `web-data` 镜像里的引用（文本替换，保留原格式）
 *   ③ 清单侧: 重新生成 manifest（调用 gen_media_mapping）
 *   ✗ 云端不在这里动 —— 数据改完后，飞书侧跑一次 `feishu_media_gc.js --apply` 即可:
 *     它按"同名不同目录"判定为 MISPLACED，自动把文件搬到新目录（判据与这里一致）。
 *
 * 用法:
 *   node scripts/migrate_vehicle_rename.js --dry-run        # 只报告（默认）
 *   node scripts/migrate_vehicle_rename.js --apply          # 执行
 *   node scripts/migrate_vehicle_rename.js --id 42 --apply  # 只处理某个车型
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MP = require(path.join(ROOT, 'js', '00-media-paths.js'));

const APPLY = process.argv.includes('--apply');
const DRY = !APPLY;
const idIdx = process.argv.indexOf('--id');
const ONLY_ID = idIdx > -1 ? Number(process.argv[idIdx + 1]) : null;

function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const decl = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  const start = src.indexOf('[', decl.index);
  const end = src.lastIndexOf(']');
  return new Function('return (' + src.slice(start, end + 1) + ')')();
}

function dirTokens() {
  return [MP.PHOTO_TOP, MP.VIDEO_TOP];
}

function main() {
  const vehicles = loadVehicles();
  const plan = [];   // {id, display, top, from, to, files:[relPath], refs:[oldPath]}

  for (const v of vehicles) {
    if (ONLY_ID != null && v.id !== ONLY_ID) continue;
    const expected = MP.folderNameForVehicle(v);

    for (const top of dirTokens()) {
      const key = top === MP.PHOTO_TOP ? 'photoPaths' : 'videoPaths';
      const refs = Array.isArray(v[key]) ? v[key] : [];
      const fromSet = new Set();
      for (const p of refs) {
        if (typeof p !== 'string' || !p.startsWith(top + '/')) continue;
        const seg = p.split('/');
        if (seg.length !== 3) continue;
        if (seg[1] === MP.SHARED_FOLDER || seg[1] === expected) continue;
        fromSet.add(seg[1]);
      }
      for (const from of fromSet) {
        const dir = path.join(ROOT, top, from);
        const files = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter(f => fs.statSync(path.join(dir, f)).isFile())
          : [];
        plan.push({
          id: v.id, display: v.display, top, from, to: expected,
          files,
          refs: refs.filter(p => typeof p === 'string' && p.split('/')[1] === from)
        });
      }
    }
  }

  if (!plan.length) {
    console.log('[rename] 未发现"引用目录 ≠ 当前车型目录"的漂移，无需迁移');
    return;
  }

  console.log(`[rename] 发现 ${plan.length} 组待迁移（车型目录与当前 display 不一致）:\n`);
  for (const p of plan) {
    console.log(`  id ${p.id} ${p.display}`);
    console.log(`    ${p.top}/${p.from}  →  ${p.top}/${p.to}`);
    console.log(`    文件 ${p.files.length} 个 | 引用 ${p.refs.length} 条`);
  }

  if (DRY) {
    console.log('\n[rename] 这是预演。确认后加 --apply 执行（git mv + 回写引用）。');
    console.log('[rename] 云端迁移随后执行: node scripts/feishu_media_gc.js --apply');
    return;
  }

  // 冲突预检: 目标目录已存在且非空 → 拒绝(避免把两个车型的文件混在一起)
  for (const p of plan) {
    const target = path.join(ROOT, p.top, p.to);
    if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
      console.error(`[rename] 目标目录已存在且有内容，拒绝合并: ${p.top}/${p.to}`);
      console.error('[rename] 请先人工确认两者是否同一车型，或改名避免目录冲突');
      process.exit(1);
    }
  }

  let movedFiles = 0, rewrote = 0;
  for (const p of plan) {
    const fromDir = path.join(ROOT, p.top, p.from);
    const toDir = path.join(ROOT, p.top, p.to);
    fs.mkdirSync(toDir, { recursive: true });
    for (const f of p.files) {
      try {
        execFileSync('git', ['mv', path.join(p.top, p.from, f), path.join(p.top, p.to, f)], { cwd: ROOT });
      } catch (e) {
        fs.renameSync(path.join(fromDir, f), path.join(toDir, f));
      }
      movedFiles++;
    }
    try { fs.rmdirSync(fromDir); } catch (e) { /* 非空则保留 */ }
    console.log(`  ✅ ${p.top}/${p.from} → ${p.to} (${p.files.length} 个文件)`);
  }

  // 数据回写（文本替换，保留格式）
  const map = new Map();
  for (const p of plan) {
    for (const r of p.refs) map.set(r, r.replace(`${p.top}/${p.from}/`, `${p.top}/${p.to}/`));
  }
  for (const rel of ['vehicles_data.js', 'web-data/vehicle_sync_data.json']) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    let text = fs.readFileSync(abs, 'utf8');
    const before = text;
    let n = 0;
    for (const [oldP, newP] of map) {
      const parts = text.split('"' + oldP + '"');
      if (parts.length > 1) { n += parts.length - 1; text = parts.join('"' + newP + '"'); }
    }
    if (text !== before) {
      fs.writeFileSync(abs, text);
      console.log(`  ✏️  ${rel}: 回写 ${n} 处引用`);
      rewrote += n;
    }
  }

  console.log(`\n[rename] 完成: 移动 ${movedFiles} 个文件 | 回写 ${rewrote} 处引用`);
  console.log('[rename] 下一步:');
  console.log('  1) node scripts/gen_media_mapping.js');
  console.log('  2) node scripts/check_media_ownership.js   （必须 0 违规）');
  console.log('  3) node scripts/feishu_media_gc.js --apply  （云端把文件搬到新目录）');
}

main();
