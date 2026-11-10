#!/usr/bin/env node
/**
 * fix_shared_refs.js — 修复「文件被迁进 _共享/，但引用仍指向车型目录」的失配引用
 *
 * 背景(线上真实故障):
 *   migrate_media_to_folders.js 把"被 ≥2 个车型引用"的文件统一移入 vehicle_images/_共享/，
 *   但**没有回写引用**。数据里仍是 vehicle_images/<车型>/image4.jpeg，文件却在
 *   vehicle_images/_共享/image4.jpeg —— 浏览器 migrateLegacyMedia() 对三段式路径原样放行，
 *   于是这 31 条引用永久 404。
 *
 *   症状: 组长在飞书云盘/仓库里看得到这张图，App 却报「照片缺失」。
 *
 * 本脚本做的事(幂等):
 *   ① 扫描 vehicles_data.js 的 photoPaths 引用
 *   ② 引用路径在磁盘上不存在、但同名文件在 _共享/ 下 → 改写为 vehicle_images/_共享/<名>
 *   ③ 同步改写 web-data/vehicle_sync_data.json 的镜像(否则下次同步会用旧路径覆盖回去)
 *
 * 用法:
 *   node scripts/fix_shared_refs.js --dry-run   # 只打印计划, 不落盘
 *   node scripts/fix_shared_refs.js             # 执行回写
 *   node scripts/fix_shared_refs.js --verify    # 只校验当前是否还有失配(CI 用, 有则退出码 1)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = '_共享';
const PHOTO_TOP = 'vehicle_images';
const DRY = process.argv.includes('--dry-run');
const VERIFY = process.argv.includes('--verify');

function sharedIndex() {
  const dir = path.join(ROOT, PHOTO_TOP, SHARED);
  const set = new Set();
  if (!fs.existsSync(dir)) return set;
  for (const f of fs.readdirSync(dir)) {
    if (fs.statSync(path.join(dir, f)).isFile()) set.add(f);
  }
  return set;
}

function existsOnDisk(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; }
}

function main() {
  const shared = sharedIndex();
  if (!shared.size) {
    console.log('[fix-shared] 没有 _共享 目录或其为空, 无需处理');
    process.exit(0);
  }

  const dataPath = path.join(ROOT, 'vehicles_data.js');
  const src = fs.readFileSync(dataPath, 'utf8');
  const refs = [...src.matchAll(/"vehicle_images\/([^"]+)"/g)].map(m => 'vehicle_images/' + m[1]);

  const plan = [];   // {from, to}
  const seen = new Set();
  for (const ref of refs) {
    if (seen.has(ref)) continue;
    seen.add(ref);
    if (existsOnDisk(ref)) continue;                     // 路径有效
    if (ref.includes('/' + SHARED + '/')) continue;       // 已经是共享路径
    const base = ref.split('/').pop();
    if (shared.has(base)) plan.push({ from: ref, to: PHOTO_TOP + '/' + SHARED + '/' + base });
  }

  if (VERIFY) {
    if (plan.length) {
      console.error(`[fix-shared] 仍有 ${plan.length} 条引用失配(文件在 _共享/):`);
      plan.slice(0, 5).forEach(p => console.error(`  ${p.from}  →  ${p.to}`));
      process.exit(1);
    }
    console.log('[fix-shared] 校验通过: 无 _共享 引用失配');
    return;
  }

  if (!plan.length) {
    console.log('[fix-shared] 没有需要回写的引用');
    return;
  }

  console.log(`[fix-shared] 待回写 ${plan.length} 条:`);
  plan.forEach(p => console.log(`  ${p.from}\n    → ${p.to}`));

  if (DRY) { console.log('[fix-shared] --dry-run, 未写盘'); return; }

  // ① 改写 vehicles_data.js(精确字符串替换, 每条可能出现多次)
  let out = src, changed = 0;
  for (const p of plan) {
    const before = out;
    out = out.split('"' + p.from + '"').join('"' + p.to + '"');
    if (out !== before) changed++;
  }
  fs.writeFileSync(dataPath, out);
  console.log(`[fix-shared] vehicles_data.js: 改写 ${changed}/${plan.length} 条`);

  // ② 改写 web-data 镜像(防止下次同步把旧路径推回来)
  const mirrorPath = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
  if (fs.existsSync(mirrorPath)) {
    /* 注意: 必须走**文本替换**而不是 JSON.parse + stringify ——
     * 后者会把 2 空格缩进改成别的格式, 产生 7000+ 行无意义 diff, 淹没真正的改动。
     * 镜像里的中文是原样 UTF-8(非 \u 转义), 因此按带引号的完整路径替换是安全且幂等的。 */
    let text = fs.readFileSync(mirrorPath, 'utf8');
    const before = text;
    let mChanged = 0;
    for (const p of plan) {
      const needle = '"' + p.from + '"';
      const parts = text.split(needle);
      if (parts.length > 1) { mChanged += parts.length - 1; text = parts.join('"' + p.to + '"'); }
    }
    if (text !== before) {
      fs.writeFileSync(mirrorPath, text);
      console.log(`[fix-shared] web-data 镜像: 改写 ${mChanged} 处(保留原格式)`);
    } else {
      console.log('[fix-shared] web-data 镜像: 无需改动(可能已是新路径)');
    }
  }

  console.log('[fix-shared] 完成。建议接着跑: node scripts/gen_media_mapping.js && node scripts/audit_media_consistency.js');
}

main();
