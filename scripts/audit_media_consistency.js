#!/usr/bin/env node
/**
 * 媒体一致性巡检脚本(需求3第一阶段) —— 对比 manifest 唯一真源与本地/GitHub 源
 *
 * 职责: 用 docs/vehicle_media_manifest.json(唯一真源) 与 vehicles_data.js +
 *       vehicle_images/ 本地资产三方对账, 揪出三类风险:
 *   C1 数量对齐  : manifest.stats 与 vehicles_data.js 实际 photo/video 引用数一致
 *   C2 引用缺失  : 车型引用了本地不存在、又无 Release 映射的照片/视频 → fail
 *   C3 张冠李戴  : 同 fileName 被多车引用却未在 assets.vehicleIds 显式声明 → fail
 *   C4 孤儿文件  : vehicle_images/ 里有文件但无任何车型引用 → warn(不阻断)
 *
 * 用法:
 *   node scripts/audit_media_consistency.js                 # 巡检(默认读 docs/vehicle_media_manifest.json)
 *   node scripts/audit_media_consistency.js --manifest <p>  # 指定 manifest 路径(测试用)
 *
 * 退出码: 0=通过, 1=存在 fail 项
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST_PATH = (() => {
  const i = process.argv.indexOf('--manifest');
  return i > -1 ? path.resolve(ROOT, process.argv[i + 1]) : path.join(ROOT, 'docs', 'vehicle_media_manifest.json');
})();

const fails = [];
const warns = [];

function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const declMatch = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!declMatch) throw new Error('vehicles_data.js 未找到 VEHICLES 声明');
  const start = src.indexOf('[', declMatch.index);
  const end = src.lastIndexOf(']');
  return new Function('return (' + src.slice(start, end + 1) + ')')();
}

function basename(p) { return String(p == null ? '' : p).split('/').pop(); }

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('[FAIL] manifest 不存在: ' + MANIFEST_PATH + ' (请先运行 node scripts/gen_media_mapping.js)');
    process.exit(1);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const vehicles = loadVehicles();

  // ---- C1 数量对齐 ----
  const photoRefs = vehicles.reduce((s, v) => s + (Array.isArray(v.photoPaths) ? v.photoPaths.length : 0), 0);
  const videoRefs = vehicles.reduce((s, v) => s + (Array.isArray(v.videoPaths) ? v.videoPaths.length : 0), 0);
  if (manifest.stats.vehicleCount !== vehicles.length) fails.push(`C1 车型数量漂移: manifest=${manifest.stats.vehicleCount} 实际=${vehicles.length}`);
  if (manifest.stats.photoCount !== photoRefs) fails.push(`C1 照片引用数漂移: manifest=${manifest.stats.photoCount} 实际=${photoRefs}`);
  if (manifest.stats.videoCount !== videoRefs) fails.push(`C1 视频引用数漂移: manifest=${manifest.stats.videoCount} 实际=${videoRefs}`);

  // 本地照片清单 + 车型引用索引
  const imgDir = path.join(ROOT, 'vehicle_images');
  const localImages = new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);
  const referenced = new Set();
  vehicles.forEach(v => (Array.isArray(v.photoPaths) ? v.photoPaths : []).forEach(p => referenced.add(basename(p))));

  // ---- C2 引用缺失 ----
  for (const mv of manifest.vehicles || []) {
    for (const ph of mv.photos || []) {
      if (/^(data:|https?:)/.test(ph.fileName)) continue; // 云端/base64 引用, 非本地资产
      if (!ph.sha256) fails.push(`C2 车型 ${mv.id} 照片引用缺失(本地无文件/无指纹): ${ph.fileName}`);
      else if (!localImages.has(ph.fileName)) fails.push(`C2 车型 ${mv.id} 照片本地文件缺失: ${ph.fileName}`);
    }
    for (const vd of mv.videos || []) {
      if (!vd.releaseAsset) warns.push(`C2 车型 ${mv.id} 视频无 Release 资产映射: ${vd.fileName}`);
    }
  }

  // ---- C3 张冠李戴(共享须显式声明) ----
  const owners = {}; // fileName -> Set(vehicleId)
  for (const mv of manifest.vehicles || []) {
    const names = [];
    (mv.photos || []).forEach(p => { if (p && p.fileName) names.push(p.fileName); });
    (mv.videos || []).forEach(v => { if (v && v.fileName) names.push(v.fileName); });
    names.forEach(n => { (owners[n] = owners[n] || new Set()).add(mv.id); });
  }
  // sha256 -> fileName(反向查找, 用于 assets 校验)
  const shaByName = {};
  for (const mv of manifest.vehicles || []) {
    (mv.photos || []).forEach(p => { if (p && p.sha256 && p.fileName) shaByName[p.fileName] = p.sha256; });
  }
  for (const [name, ids] of Object.entries(owners)) {
    if (ids.size <= 1) continue;
    const sha = shaByName[name];
    if (!sha) { warns.push(`C3 视频跨车共用(无内容指纹, 待七牛阶段补 sha256): ${name} -> [${[...ids].join(',')}]`); continue; }
    const asset = manifest.assets && manifest.assets[sha];
    if (!asset || !Array.isArray(asset.vehicleIds) || asset.vehicleIds.length <= 1) {
      fails.push(`C3 张冠李戴风险: ${name} 被多车引用但未在 assets.vehicleIds 显式声明 [${[...ids].join(',')}]`);
    } else {
      const missing = [...ids].filter(id => !asset.vehicleIds.includes(id));
      if (missing.length) fails.push(`C3 共享声明不完整: ${name} 缺失 vehicleIds [${missing.join(',')}]`);
    }
  }

  // ---- C4 孤儿文件 ----
  for (const f of localImages) {
    if (!referenced.has(f)) warns.push(`C4 孤儿文件(无车型引用): vehicle_images/${f}`);
  }

  // ---- C5 数据源对账: vehicles_data.js vs web-data 镜像(P1 防复发) ----
  const mirrorPath = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
  if (!fs.existsSync(mirrorPath)) {
    warns.push('C5 web-data/vehicle_sync_data.json 不存在, 跳过数据源对账');
  } else {
    try {
      const mirror = JSON.parse(fs.readFileSync(mirrorPath, 'utf8'));
      const mv = Array.isArray(mirror.vehicles) ? mirror.vehicles : [];
      if (vehicles.length !== mv.length) {
        fails.push(`C5 车型数量漂移: vehicles_data.js=${vehicles.length} web-data=${mv.length}`);
      }
      const mById = {};
      mv.forEach(v => { mById[v.id] = v; });
      const nameDrifts = [];
      for (const v of vehicles) {
        const m = mById[v.id];
        if (m && String(m.display) !== String(v.display)) nameDrifts.push(`id=${v.id}:「${v.display}」vs「${m.display}」`);
      }
      if (nameDrifts.length) fails.push(`C5 display 名漂移 ${nameDrifts.length} 车: ${nameDrifts.slice(0, 5).join(' | ')}`);
      const vVids = new Set(vehicles.flatMap(v => (v.videoPaths || []).map(p => String(p).split('/').pop())));
      const mVids = new Set(mv.flatMap(v => (v.videoPaths || []).map(p => String(p).split('/').pop())));
      const onlyV = [...vVids].filter(x => !mVids.has(x));
      const onlyM = [...mVids].filter(x => !vVids.has(x));
      if (onlyV.length || onlyM.length) {
        fails.push(`C5 视频名集合漂移: 仅vehicles_data=[${onlyV.join(',')}] 仅web-data=[${onlyM.join(',')}]`);
      }
    } catch (e) {
      fails.push('C5 web-data 镜像解析失败: ' + e.message);
    }
  }

  // ---- 汇总 ----
  warns.forEach(w => console.warn('[WARN] ' + w));
  if (fails.length) {
    fails.forEach(f => console.error('[FAIL] ' + f));
    console.error(`\n[audit:media] 巡检失败: ${fails.length} 个错误, ${warns.length} 个警告`);
    process.exit(1);
  }
  console.log(`[audit:media] 巡检通过: ${manifest.stats.vehicleCount} 车型 / ${manifest.stats.photoCount} 照片 / ${manifest.stats.videoCount} 视频 / assets ${Object.keys(manifest.assets || {}).length} 项 / ${warns.length} 个警告`);
}

main();
