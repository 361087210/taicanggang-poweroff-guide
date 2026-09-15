#!/usr/bin/env node
/**
 * 车型-媒体映射表 + 唯一真源 manifest 生成/校验脚本（CI 可重复执行）
 *
 * 为什么存在: 落实优化方案「问题4」——车型与媒体文件的映射必须以
 * vehicles_data.js 为唯一事实源自动生成，禁止人工维护产生漂移。
 *
 * V10.22 需求3第一阶段(唯一真源): 在原有映射表之外，新增
 * docs/vehicle_media_manifest.json —— 带 SHA-256 内容指纹 + assets 反向
 * 索引的媒体唯一真源(供删除保护 / 巡检 / 第二阶段七牛直传迁移使用)。
 *
 * 用法:
 *   node scripts/gen_media_mapping.js                       # 重新生成映射表 + manifest
 *   node scripts/gen_media_mapping.js --check               # CI 校验映射表一致性(既有)
 *   node scripts/gen_media_mapping.js --check-manifest      # CI 校验 manifest 一致性
 *   node scripts/gen_media_mapping.js --manifest-out <dir>  # manifest 写到指定目录(测试用)
 *
 * 输出:
 *   docs/vehicle_media_mapping.json   程序读取(含 generatedAt / stats / records)
 *   docs/vehicle_media_mapping.csv    Excel/飞书多维表格导入(BOM 头)
 *   docs/vehicle_media_manifest.json  媒体唯一真源(SHA-256 指纹 + assets 反向索引)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OUT_JSON = path.join(ROOT, 'docs', 'vehicle_media_mapping.json');
const OUT_CSV = path.join(ROOT, 'docs', 'vehicle_media_mapping.csv');
const DEFAULT_MANIFEST_DIR = path.join(ROOT, 'docs');
const CHECK_MODE = process.argv.includes('--check');
const CHECK_MANIFEST_MODE = process.argv.includes('--check-manifest');
const MANIFEST_ONLY = process.argv.includes('--manifest-only');
const MANIFEST_DIR = (() => {
  const i = process.argv.indexOf('--manifest-out');
  return i > -1 ? path.resolve(ROOT, process.argv[i + 1] || 'docs') : DEFAULT_MANIFEST_DIR;
})();
const MANIFEST_PATH = path.join(MANIFEST_DIR, 'vehicle_media_manifest.json');

/** 从 vehicles_data.js 安全提取 VEHICLES 数组(不用 eval, 受限表达式求值)
 * V10.14.0 基建修复: vehicles_data.js 经 sync_feishu_local.js 云端同步重写后,
 * 声明格式从 `const VEHICLES=` 变为 `window.VEHICLES = [`(写回保持该格式),
 * 旧版单点 indexOf('const VEHICLES=') 直接抛错导致 CI「映射表一致性校验」
 * 连续失败(main + 发版分支双线受阻)。此处兼容两种声明,历史/新格式均可解析。 */
function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const declMatch = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!declMatch) throw new Error('vehicles_data.js 中未找到 "const VEHICLES=" 或 "window.VEHICLES =" 声明');
  const start = src.indexOf('[', declMatch.index);
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

/* ============================================================
 * 唯一真源 manifest 生成(V10.22 需求3第一阶段)
 * ============================================================ */

/** 从 js/00-bootstrap.js 解析 MEDIA_DIRECT_ASSETS(视频文件名 → Release 资产名) */
function parseMediaDirectAssets() {
  const src = fs.readFileSync(path.join(ROOT, 'js', '00-bootstrap.js'), 'utf8');
  const m = src.match(/const MEDIA_DIRECT_ASSETS=\{([\s\S]*?)\};/);
  if (!m) return {};
  const out = {};
  for (const mm of m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) out[mm[1]] = mm[2];
  return out;
}

/** 由扩展名推断 MIME(仅覆盖本项目出现的媒体类型) */
function mimeOf(fileName) {
  const ext = (String(fileName).split('.').pop() || '').toLowerCase();
  const map = { jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', mp4: 'video/mp4' };
  return map[ext] || '';
}

function basename(p) { return String(p == null ? '' : p).split('/').pop(); }

function sha256File(p) {
  try { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
  catch (e) { return ''; }
}

function sizeOf(p) {
  try { return fs.statSync(p).size; } catch (e) { return 0; }
}

/** 单个媒体条目: 本地可拿到的算真实 SHA-256, 云端/base64 置空并告警 */
function mediaEntry(p, type, mediaAssets, localImages, warnings) {
  const name = basename(p);
  const entry = { fileName: name, sha256: '', size: 0, mime: mimeOf(name), qiniuKey: '' };
  if (type === 'video') entry.releaseAsset = mediaAssets[name] || '';

  const raw = String(p || '');
  // 云端 base64 / http(s) 引用: 本阶段无法计算指纹
  if (/^(data:|https?:\/\/)/.test(raw)) {
    warnings.push(`${type} 云端/base64 引用无法计算 SHA-256: ${name}`);
    return entry;
  }

  if (type === 'photo') {
    const localPath = path.join(ROOT, 'vehicle_images', name);
    if (localImages.has(name) && fs.existsSync(localPath)) {
      entry.sha256 = sha256File(localPath);
      entry.size = sizeOf(localPath);
    } else {
      warnings.push(`照片本地缺失, SHA-256 置空(巡检将告警): ${name}`);
    }
  } else {
    // 视频不在仓库(存于飞书云端 / GitHub Release), 本阶段一律置空指纹
    if (!entry.releaseAsset) warnings.push(`视频无 Release 资产映射: ${name}`);
  }
  return entry;
}

function buildManifest(vehicles, mediaAssets, localImages) {
  const warnings = [];
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    qiniu: { bucket: 'tcg-media', cdnBase: '', region: '' },
    release: { base: '' },
    vehicles: [],
    assets: {},
    stats: { vehicleCount: 0, photoCount: 0, videoCount: 0, totalBytes: 0 }
  };

  let photoCount = 0, videoCount = 0, totalBytes = 0;
  for (const v of vehicles) {
    const photoPaths = Array.isArray(v.photoPaths) ? v.photoPaths : [];
    const videoPaths = Array.isArray(v.videoPaths) ? v.videoPaths : [];
    const photos = photoPaths.map(p => mediaEntry(p, 'photo', mediaAssets, localImages, warnings));
    const videos = videoPaths.map(p => mediaEntry(p, 'video', mediaAssets, localImages, warnings));
    manifest.vehicles.push({ id: v.id, display: v.display, photos, videos });
    photoCount += photos.length;
    videoCount += videos.length;
    // assets 反向索引: 同 sha256 多车引用时 vehicleIds 累积
    for (const ph of photos) {
      if (!ph.sha256) continue;
      if (!manifest.assets[ph.sha256]) manifest.assets[ph.sha256] = { qiniuKey: '', releaseAsset: '', vehicleIds: [] };
      if (!manifest.assets[ph.sha256].vehicleIds.includes(v.id)) manifest.assets[ph.sha256].vehicleIds.push(v.id);
      totalBytes += ph.size;
    }
  }
  manifest.stats = { vehicleCount: vehicles.length, photoCount, videoCount, totalBytes };
  return { manifest, warnings };
}

/** manifest 内容指纹(忽略 generatedAt, 用于幂等与 --check-manifest) */
function stripManifest(m){
  return JSON.stringify({ schemaVersion: m.schemaVersion, qiniu: m.qiniu, release: m.release, vehicles: m.vehicles, assets: m.assets, stats: m.stats });
}

// ---- 主流程 ----
const vehicles = loadVehicles();
const records = buildRecords(vehicles, loadLocalImages());
const stats = buildStats(records);

if (CHECK_MODE) {
  // CI 一致性校验(映射表): 忽略 generatedAt 时间戳, 只比对 stats + records
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
} else if (CHECK_MANIFEST_MODE) {
  // CI 一致性校验(manifest): 忽略 generatedAt, 只比对 schemaVersion/vehicles/assets/stats/qiniu/release
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error('[FAIL] ' + MANIFEST_PATH + ' 不存在, 请先运行: node scripts/gen_media_mapping.js');
    process.exit(1);
  }
  const { manifest: fresh } = buildManifest(vehicles, parseMediaDirectAssets(), loadLocalImages());
  const committed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  if (stripManifest(fresh) !== stripManifest(committed)) {
    console.error('[FAIL] manifest 与 vehicles_data.js 不一致(数据漂移), 请重新运行: node scripts/gen_media_mapping.js 并提交');
    process.exit(1);
  }
  console.log('[OK] manifest 一致性校验通过: ' + (fresh.vehicles || []).length + ' 车型');
} else {
  const { manifest, warnings } = buildManifest(vehicles, parseMediaDirectAssets(), loadLocalImages());
  // 幂等: 内容无变化(忽略 generatedAt)则跳过写, 避免 cron 每 15 分钟无意义提交
  let unchanged = false;
  try {
    if (fs.existsSync(OUT_JSON) && fs.existsSync(MANIFEST_PATH)) {
      const oldMap = JSON.parse(fs.readFileSync(OUT_JSON, 'utf8'));
      const oldManifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
      unchanged = JSON.stringify({ stats, records }) === JSON.stringify({ stats: oldMap.stats, records: oldMap.records })
        && stripManifest(manifest) === stripManifest(oldManifest);
    }
  } catch (e) { unchanged = false; }
  if (unchanged && !process.argv.includes('--force')) {
    console.log('[OK] 映射表/manifest 无变化, 跳过写入 (' + records.length + ' 条记录)');
  } else {
    fs.mkdirSync(MANIFEST_DIR, { recursive: true });
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2), 'utf8');
    if (warnings.length) warnings.forEach(w => console.warn('[manifest] ' + w));
    if (MANIFEST_ONLY) {
      console.log('[OK] manifest 已生成: ' + manifest.stats.vehicleCount + ' 车型 / ' + manifest.stats.photoCount + ' 照片 / ' + manifest.stats.videoCount + ' 视频 -> ' + MANIFEST_PATH);
    } else {
      fs.writeFileSync(OUT_JSON, JSON.stringify({ generatedAt: new Date().toISOString(), stats, records }, null, 2), 'utf8');
      fs.writeFileSync(OUT_CSV, toCsv(records), 'utf8');
      console.log('[OK] 映射表已生成: ' + records.length + ' 条 -> docs/vehicle_media_mapping.json + .csv');
      console.log('[OK] manifest 已生成: ' + manifest.stats.vehicleCount + ' 车型 / ' + manifest.stats.photoCount + ' 照片 / ' + manifest.stats.videoCount + ' 视频 -> ' + MANIFEST_PATH);
    }
  }
}
console.log('[STATS] ' + JSON.stringify(stats));
