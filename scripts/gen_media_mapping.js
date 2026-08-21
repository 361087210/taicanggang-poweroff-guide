#!/usr/bin/env node
/**
 * 车型-媒体映射表生成/校验脚本（CI 可重复执行）
 *
 * 为什么存在: 落实优化方案「问题4」——车型与媒体文件的映射必须以
 * vehicles_data.js 为唯一事实源自动生成，禁止人工维护产生漂移。
 *
 * 用法:
 *   node scripts/gen_media_mapping.js          # 重新生成 docs/vehicle_media_mapping.{json,csv}
 *   node scripts/gen_media_mapping.js --check  # CI 一致性校验: 已提交映射与源数据不一致时退出码 1
 *
 * 输出:
 *   docs/vehicle_media_mapping.json  程序读取(含 generatedAt / stats / records)
 *   docs/vehicle_media_mapping.csv   Excel/飞书多维表格导入(BOM 头)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'docs', 'vehicle_media_mapping.json');
const OUT_CSV = path.join(ROOT, 'docs', 'vehicle_media_mapping.csv');
const CHECK_MODE = process.argv.includes('--check');

/** 从 vehicles_data.js 安全提取 VEHICLES 数组(不用 eval, 受限表达式求值) */
function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const vIdx = src.indexOf('const VEHICLES=');
  if (vIdx < 0) throw new Error('vehicles_data.js 中未找到 "const VEHICLES=" 声明');
  const start = src.indexOf('[', vIdx);
  const end = src.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('无法定位 VEHICLES 数组边界');
  const arrText = src.slice(start, end + 1);
  // Function 构造器在无外部作用域隔离下求值, 数据文件为可信静态资产
  return new Function('return (' + arrText + ')')();
}

/** 生成本地图片清单, 用于照片缺失统计 */
function loadLocalImages() {
  const imgDir = path.join(ROOT, 'vehicle_images');
  return new Set(fs.existsSync(imgDir) ? fs.readdirSync(imgDir) : []);
}

function buildRecords(vehicles, localImages) {
  return vehicles.map(v => {
    const photoPaths = Array.isArray(v.photoPaths) ? v.photoPaths : [];
    const videoPaths = Array.isArray(v.videoPaths) ? v.videoPaths : [];
    const missingPhotos = photoPaths.filter(p => !localImages.has(p.split('/').pop()));
    return {
      车型ID: 'V' + String(v.id).padStart(3, '0'),
      品牌: v.brand,
      车系: v.series,
      配置: v.config,
      显示名称: v.display,
      动力类型: v.powerType,
      断电位置: v.position,
      照片数: photoPaths.length,
      照片文件: photoPaths.map(p => p.split('/').pop()).join(';'),
      本地照片缺失数: missingPhotos.length,
      视频数: videoPaths.length,
      视频文件: videoPaths.map(p => p.split('/').pop()).join(';'),
      视频匹配状态: videoPaths.length === 0 ? '无视频引用' : '本地缺失-需云端补录',
      备注说明: v.remarks || ''
    };
  });
}

function buildStats(records) {
  return {
    车型总数: records.length,
    品牌数: new Set(records.map(r => r['品牌'])).size,
    有视频引用: records.filter(r => r['视频数'] > 0).length,
    无视频引用: records.filter(r => r['视频数'] === 0).length,
    照片引用总数: records.reduce((s, r) => s + r['照片数'], 0),
    本地照片缺失总数: records.reduce((s, r) => s + r['本地照片缺失数'], 0),
    视频引用总数: records.reduce((s, r) => s + r['视频数'], 0)
  };
}

function toCsv(records) {
  const cols = Object.keys(records[0]);
  const lines = [cols.join(',')];
  for (const r of records) {
    lines.push(cols.map(c => {
      let val = String(r[c] == null ? '' : r[c]);
      if (/[",\n]/.test(val)) val = '"' + val.replace(/"/g, '""') + '"';
      return val;
    }).join(','));
  }
  return '\uFEFF' + lines.join('\n');
}

// ---- 主流程 ----
const vehicles = loadVehicles();
const records = buildRecords(vehicles, loadLocalImages());
const stats = buildStats(records);

if (CHECK_MODE) {
  // CI 一致性校验: 忽略 generatedAt 时间戳, 只比对 stats + records
  if (!fs.existsSync(OUT_JSON)) {
    console.error('[FAIL] docs/vehicle_media_mapping.json 不存在, 请先运行: node scripts/gen_media_mapping.js');
    process.exit(1);
  }
  const committed = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
  const drift = JSON.stringify({ stats, records }) !== JSON.stringify({ stats: committed.stats, records: committed.records });
  if (drift) {
    console.error('[FAIL] 映射表与 vehicles_data.js 不一致(数据漂移), 请重新运行: node scripts/gen_media_mapping.js 并提交');
    process.exit(1);
  }
  console.log('[OK] 映射表一致性校验通过: ' + records.length + ' 条记录与源数据一致');
} else {
  fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), stats, records }, null, 2), 'utf8');
  fs.writeFileSync(OUT_CSV, toCsv(records), 'utf8');
  console.log('[OK] 映射表已生成: ' + records.length + ' 条 -> docs/vehicle_media_mapping.json + .csv');
}
console.log('[STATS] ' + JSON.stringify(stats));
