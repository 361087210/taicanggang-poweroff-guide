#!/usr/bin/env node
/**
 * check_media_ownership.js — 媒体"归属"门禁：保证每张照片/视频都落在它自己的车型目录里
 *
 * 解决的问题:
 *   用户最担心的是"新车型上传后混在一起、引用了别人家的图"。上传代码已经按
 *   <车型目录>/<车型名>_p<N>_<hash>.<ext> 生成路径，但**没有任何东西能证明它一直成立**——
 *   一次改名、一次手抖、一次旧客户端上传，就可能让引用指向别的车型目录。
 *
 * 本门禁静态检查四条不变量(违反即 FAIL):
 *   A1 三段式    : 所有本地媒体引用必须是 vehicle_images|vehicle_videos/<目录>/<文件>
 *   A2 归属一致  : 引用所在目录必须等于 folderNameForVehicle(该车型)，或为 _共享
 *   A3 显示名唯一: 不允许两个车型 display 完全相同(否则目录必然撞车)
 *   A4 目录唯一  : 不允许两个车型经 sanitize 后映射到同一个目录名
 *   附加: _共享 只能被 ≥2 个车型使用(单车型放 _共享 = 语义污染)
 *
 * 用法:
 *   node scripts/check_media_ownership.js            # 有违规即退出码 1
 *   node scripts/check_media_ownership.js --warn     # 只告警
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WARN_ONLY = process.argv.includes('--warn');
const MP = require(path.join(ROOT, 'js', '00-media-paths.js'));

function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const decl = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!decl) throw new Error('vehicles_data.js 未找到 VEHICLES 声明');
  const start = src.indexOf('[', decl.index);
  const end = src.lastIndexOf(']');
  return new Function('return (' + src.slice(start, end + 1) + ')')();
}

function main() {
  const vehicles = loadVehicles();
  const problems = [];

  const byDisplay = new Map();
  const byFolder = new Map();
  const sharedUsers = new Map();   // 共享文件名 -> Set(vehicleId)

  for (const v of vehicles) {
    const folder = MP.folderNameForVehicle(v);

    if (byDisplay.has(v.display)) problems.push(`A3 显示名重复: "${v.display}" (id ${byDisplay.get(v.display)} 与 ${v.id})`);
    else byDisplay.set(v.display, v.id);

    if (byFolder.has(folder)) problems.push(`A4 目录名碰撞: "${folder}" ← id ${byFolder.get(folder)} 与 ${v.id}`);
    else byFolder.set(folder, v.id);

    for (const p of [...(v.photoPaths || []), ...(v.videoPaths || [])]) {
      if (typeof p !== 'string' || !/^vehicle_(images|videos)\//.test(p)) continue;
      const seg = p.split('/');
      if (seg.length !== 3) {
        problems.push(`A1 非三段式: id ${v.id} → ${p}`);
        continue;
      }
      if (seg[1] === '_共享') {
        const key = seg[2];
        if (!sharedUsers.has(key)) sharedUsers.set(key, new Set());
        sharedUsers.get(key).add(v.id);
        continue;
      }
      if (seg[1] !== folder) {
        problems.push(`A2 归属错位: id ${v.id}(${v.display}) 应属 "${folder}"，却引用 "${p}"`);
      }
    }
  }

  for (const [name, ids] of sharedUsers) {
    if (ids.size < 2) problems.push(`附加 _共享 语义污染: "${name}" 只被 id ${[...ids]} 使用，应放回该车型目录`);
  }

  if (!problems.length) {
    console.log(`[归属门禁] 通过: ${vehicles.length} 车型 / ${byFolder.size} 目录，引用归属与命名均一致`);
    return;
  }
  problems.forEach(p => (WARN_ONLY ? console.warn('[WARN] ' + p) : console.error('[FAIL] ' + p)));
  console.error(`\n[归属门禁] 共 ${problems.length} 处违规`);
  if (!WARN_ONLY) process.exit(1);
}

main();
