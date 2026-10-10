#!/usr/bin/env node
/**
 * migrate_media_to_folders.js — V10.25.0 存量媒体「按车型名分文件夹」一次性迁移(幂等)
 *
 * 背景: 改造前 vehicle_images/ 是「扁平大杂烩」—— 193 个文件直接堆在顶层,
 *   没有任何机器可读的「车型 → 文件」归属约定, 只能靠 vehicles_data.js 的
 *   photoPaths 反查, 极易漂移(断电教学视频张冠李戴有现场安全隐患)。
 *   V10.25.0 起约定收敛为 <顶层目录>/<车型目录>/<文件名>, 单一真源见
 *   js/00-media-paths.js。本脚本把存量文件按该约定归位, 可重复执行。
 *
 * 归置规则(与 js/00-media-paths.js 约定一致):
 *   1. 仅被 1 个车型引用      → vehicle_images/<车型目录>/   (车型目录 = folderNameForVehicle)
 *   2. 被 ≥2 个车型引用(共享) → vehicle_images/_共享/
 *   3. 无任何车型引用(孤儿)    → vehicle_images/_未归类/
 *        · 不塞 _共享: 「共享」语义是「多车型复用」, 孤儿零引用, 混入会污染语义;
 *        · 不按文件名前缀机械归位: 实测 user_vXX_* 等历史命名与当前对应车型已脱钩
 *          (例如 id30/31 现引用的是 imageNN), 硬归位会制造「张冠李戴」风险;
 *        · audit_media_consistency.js C4 会如实 WARN(不隐藏问题),
 *          待人工在飞书侧确认归属后再行处置。
 *   4. 视频侧不迁移: vehicle_videos/ 仓库内无本地文件(视频走 release 直链),
 *      且 videoPaths 约定保持两段式(见 js/06-media.js 上传回写)——本脚本只动图片。
 *
 * 用法:
 *   node scripts/migrate_media_to_folders.js --dry-run   # 只打印计划, 不落盘
 *   node scripts/migrate_media_to_folders.js             # 执行迁移
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIRROR = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
const PHOTO_TOP = 'vehicle_images';   // 顶层契约目录名(不得改名)
const UNCLASSIFIED = '_未归类';        // 迁移期临时归置目录(见头注规则 3); 车型目录名经 sanitizeName 必不以 '_' 开头, 不会撞车
const DRY = process.argv.includes('--dry-run');

// 优雅降级: 与 gen_media_mapping.js / audit_media_consistency.js 同一写法
let MP = null;
try { MP = require('../js/00-media-paths.js'); } catch (e) { MP = null; }
if (!MP) { console.error('[migrate] 无法加载 js/00-media-paths.js, 中止'); process.exit(1); }

// 复用镜像侧编码损坏校正(仅取值用, 不触发写文件)
let correctVehicle = function (v) { return v; };
try {
  const G = require('./gen_vehicles_data.js');
  if (typeof G.correctVehicle === 'function') correctVehicle = G.correctVehicle;
} catch (e) { /* 校正表不可用时按原样处理 */ }

function main() {
  const d = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  if (!d || !Array.isArray(d.vehicles)) throw new Error('vehicle_sync_data.json 缺少 vehicles 数组');
  const vehicles = d.vehicles.map(correctVehicle);
  const byId = Object.create(null);
  vehicles.forEach(v => { byId[v.id] = v; });

  // basename → 引用车型 id 集合(用于判定「共享」)
  const refBy = Object.create(null);
  vehicles.forEach(v => {
    (v.photoPaths || []).forEach(p => {
      const f = MP.parseMediaPath(p).fileName;
      if (!f) return;
      (refBy[f] || (refBy[f] = new Set())).add(v.id);
    });
  });

  const disk = MP.listMediaFiles(ROOT, PHOTO_TOP);
  const moves = [];
  const stats = { single: 0, shared: 0, orphan: 0, already: 0 };

  disk.forEach(f => {
    if (f.folder) { stats.already++; return; }          // 已在子目录 → 幂等跳过
    const ids = refBy[f.fileName];
    let dstFolder;
    if (!ids || ids.size === 0) { dstFolder = UNCLASSIFIED; stats.orphan++; }
    else if (ids.size > 1) { dstFolder = MP.SHARED_FOLDER; stats.shared++; }
    else {
      const id = Array.from(ids)[0];
      dstFolder = MP.folderNameForVehicle(byId[id] || { id: id });
      stats.single++;
    }
    const dstRel = PHOTO_TOP + '/' + dstFolder + '/' + f.fileName;
    if (dstRel === f.relPath) return;
    moves.push({ from: f.relPath, to: dstRel });
  });

  console.log('[migrate] 计划: 单车 ' + stats.single + ' / 共享 ' + stats.shared +
    ' / 未归类 ' + stats.orphan + ' / 已归位 ' + stats.already +
    '  (磁盘共 ' + disk.length + ' 个文件)');

  if (DRY) {
    moves.forEach(m => console.log('  DRY  ' + m.from + '  ->  ' + m.to));
    console.log('[migrate] --dry-run 结束, 未落盘');
    return;
  }

  const done = [];
  const problems = [];
  moves.forEach(m => {
    const srcAbs = path.join(ROOT, m.from);
    const dstAbs = path.join(ROOT, m.to);
    if (!fs.existsSync(srcAbs)) { problems.push('源缺失: ' + m.from); return; }
    if (fs.existsSync(dstAbs)) { problems.push('目标已存在(不覆盖): ' + m.to); return; }
    try {
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      fs.renameSync(srcAbs, dstAbs);
      done.push(m);
    } catch (e) { problems.push('失败 ' + m.from + ' -> ' + m.to + ' : ' + e.message); }
  });

  console.log('[migrate] 完成: 移动 ' + done.length + ' 个文件');
  if (problems.length) {
    console.error('[migrate] ' + problems.length + ' 项问题:');
    problems.slice(0, 20).forEach(p => console.error('  ' + p));
    process.exit(1);
  }
  console.log('[migrate] 提示: 执行 git add -A ' + PHOTO_TOP + ' 让 git 记录为 rename(保历史)');
}

if (require.main === module) main();
module.exports = { main: main };
