#!/usr/bin/env node
/**
 * 反向生成 vehicles_data.js（从网页镜像唯一真源 web-data/vehicle_sync_data.json）
 *
 * 为什么存在: `vehicles_data.js` 是 App 打包内置源(离线首屏数据), 而
 * `web-data/vehicle_sync_data.json` 由 cron 每 15 分钟从飞书云端镜像(最新)。
 * 此前二者字段完全一致(id/brandId/brand/series/config/display/.../videoPaths),
 * 却长期漂移(73 vs 82 车 / 8 车改名 / 1 视频缺直链)。本脚本把镜像数据反向
 * 写回 vehicles_data.js, 使两源收敛为同一份事实。
 *
 * 用法:
 *   node scripts/gen_vehicles_data.js           # 生成 vehicles_data.js(幂等: 内容无变化跳过写)
 *   node scripts/gen_vehicles_data.js --check   # 对账: 与镜像漂移即非零退出(CI/巡检用)
 *
 * 输出格式(与既有格式保持一致):
 *   // 飞书云端同步于 <时间>
 *   window.VEHICLES = [ ... ];
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIRROR = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
const OUT = path.join(ROOT, 'vehicles_data.js');
const CHECK = process.argv.includes('--check');

/** 读 web-data 镜像的 vehicles 数组 */
function loadMirrorVehicles() {
  const d = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  if (!d || !Array.isArray(d.vehicles)) throw new Error('web-data/vehicle_sync_data.json 缺少 vehicles 数组');
  return d;
}

/** 安全提取现有 vehicles_data.js 的 VEHICLES 数组(兼容 const/window 两种声明) */
function extractExistingVehicles() {
  if (!fs.existsSync(OUT)) return null;
  const src = fs.readFileSync(OUT, 'utf8');
  const m = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!m) return null;
  const s = src.indexOf('[', m.index);
  const e = src.lastIndexOf(']');
  if (s < 0 || e <= s) return null;
  try { return new Function('return (' + src.slice(s, e + 1) + ')')(); } catch (err) { return null; }
}

/** 归一化对比(忽略键序): 返回漂移明细数组 */
function diff(vehicles, mirrorVehicles) {
  const drifts = [];
  if (vehicles.length !== mirrorVehicles.length) {
    drifts.push(`车型数量漂移: vehicles_data.js=${vehicles.length} web-data=${mirrorVehicles.length}`);
  }
  const mById = {};
  mirrorVehicles.forEach(v => { mById[v.id] = v; });
  const nameDrifts = [];
  for (const v of vehicles) {
    const m = mById[v.id];
    if (m && String(m.display) !== String(v.display)) nameDrifts.push(`id=${v.id}: 「${v.display}」 vs 「${m.display}」`);
  }
  if (nameDrifts.length) drifts.push(`display 名漂移 ${nameDrifts.length} 车: ${nameDrifts.slice(0, 8).join('; ')}`);
  const vVids = new Set(vehicles.flatMap(v => (v.videoPaths || []).map(p => String(p).split('/').pop())));
  const mVids = new Set(mirrorVehicles.flatMap(v => (v.videoPaths || []).map(p => String(p).split('/').pop())));
  const onlyV = [...vVids].filter(x => !mVids.has(x));
  const onlyM = [...mVids].filter(x => !vVids.has(x));
  if (onlyV.length || onlyM.length) {
    drifts.push(`视频名集合漂移: 仅vehicles_data=[${onlyV.join(',')}] 仅web-data=[${onlyM.join(',')}]`);
  }
  return drifts;
}

function main() {
  const data = loadMirrorVehicles();
  const mirrorVehicles = data.vehicles;
  const existing = extractExistingVehicles() || [];

  if (CHECK) {
    const drifts = diff(existing, mirrorVehicles);
    if (drifts.length) {
      drifts.forEach(d => console.error('[FAIL] ' + d));
      console.error(`[gen_vehicles_data] 对账失败: ${drifts.length} 项漂移 (vehicles_data.js=${existing.length} web-data=${mirrorVehicles.length})`);
      process.exit(1);
    }
    console.log(`[gen_vehicles_data] 对账通过: vehicles_data.js 与 web-data 一致 (${mirrorVehicles.length} 车型)`);
    return;
  }

  // 幂等: 内容无变化不写(避免 cron 每 15 分钟无意义提交)
  const drifts = diff(existing, mirrorVehicles);
  const same = drifts.length === 0;
  if (same && !process.argv.includes('--force')) {
    console.log(`[gen_vehicles_data] 无变化, 跳过写入 (${mirrorVehicles.length} 车型)`);
    return;
  }
  const header = '// 飞书云端同步于 ' + (data.timestamp || new Date().toISOString()) + '\n';
  const body = 'window.VEHICLES = ' + JSON.stringify(mirrorVehicles, null, 2) + ';\n';
  fs.writeFileSync(OUT, header + body, 'utf8');
  console.log(`[gen_vehicles_data] 已生成 vehicles_data.js: ${mirrorVehicles.length} 车型 (漂移项 ${drifts.length})`);
}

main();
