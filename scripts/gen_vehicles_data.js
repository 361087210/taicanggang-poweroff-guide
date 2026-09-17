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

/**
 * 已知编码损坏校正表 —— 损坏发生在**飞书表内容侧**(非本仓库脚本)。
 *
 * 证据(2026-09-17 排查):
 *   web-data/vehicle_sync_data.json 是"唯一真源", 由 cron 从飞书云端镜像同步。
 *   该文件中 4 处已含 U+FFFD(替换符), 即**同步进来时就是坏的**。本生成器是纯
 *   透传(JSON.parse -> JSON.stringify), 无 latin1/binary/无参 toString()/
 *   decodeURIComponent 等任何会吞字符的编码转换环节。
 *   特殊之处: 原始字节为 EF BF BD EF BF BD(两个连续 U+FFFD, 8 个连续 '?'),
 *   即已发生"双重编码损坏"——源头字符已不可逆, 必须按上下文人工确定正确字符。
 *
 * 因此本表是**生成期的可维护校正**: 在反写 vehicles_data.js 前把已知损坏
 * 归一为正确文案, 使 App 内置数据立即正确、且下次同步不回归(幂等)。
 * ⚠️ 这不修复飞书表内容本身: 源表未改 + 本表未收录的新损坏仍会穿透。
 *    根治需用户在飞书多维表格手工修正下列 4 处, 否则每次同步都会再次产生损坏。
 *
 * 维护: 新增损坏 -> U+FFFD 扫描(见 tests/test_vehicle_data_integrity.js)发现 ->
 *       人工从上下文确定正确字符串 -> 追加一条 { broken, fixed }。
 */
const KNOWN_CORRUPTIONS = [
  { broken: '锁\uFFFD\uFFFD\uFFFD车门',       fixed: '锁住车门',            note: '比亚迪唐ATTO-8 steps[1] (残留 3×efbfbd)' },
  { broken: '2.\uFFFD\uFFFD\uFFFD认断电无误', fixed: '2.确认断电无误',      note: '吉利极氪 keyContainer[1] (残留 3×efbfbd)' },
  { broken: '奇瑞\uFFFD\uFFFD途JETOUR',      fixed: '奇瑞捷途JETOUR',      note: '奇瑞捷途JETOUR(T2 I-DM) videoPaths[0]' },
  { broken: '10号\uFFFD\uFFFD手',           fixed: '10号扳手',           note: '比亚迪海豹SEAL-5-DM-I steps[2]' },
  { broken: '驶车���，拉', fixed: '驶车门，拉', note: 'id=33 vehicle.steps[0]' },
  { broken: '车键���', fixed: '车键。', note: 'id=51 vehicle.steps[1]' },
  { broken: '，机���钥匙', fixed: '，机械钥匙', note: 'id=68 vehicle.steps[1]' },
];

/** 对单个字符串应用校正表(纯函数, 无匹配则原样返回) */
function applyCorrections(s) {
  let out = String(s);
  for (const { broken, fixed } of KNOWN_CORRUPTIONS) out = out.split(broken).join(fixed);
  return out;
}

/** 递归校正车辆记录的所有字符串值(数组/对象/标量) */
function correctVehicle(v) {
  if (Array.isArray(v)) return v.map(correctVehicle);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = correctVehicle(v[k]);
    return o;
  }
  return typeof v === 'string' ? applyCorrections(v) : v;
}

/** 统计一个字符串中的 U+FFFD 个数 */
function countRepl(s) { return (String(s).match(/\uFFFD/g) || []).length; }

/** 读 web-data 镜像的 vehicles 数组, 并施加已知编码损坏校正 */
function loadMirrorVehicles() {
  const d = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  if (!d || !Array.isArray(d.vehicles)) throw new Error('web-data/vehicle_sync_data.json 缺少 vehicles 数组');
  const rawCount = JSON.stringify(d.vehicles).match(/\uFFFD/g) || [];
  d.vehicles = d.vehicles.map(correctVehicle);
  const afterCount = JSON.stringify(d.vehicles).match(/\uFFFD/g) || [];
  d.__corruption = { raw: rawCount.length, corrected: rawCount.length - afterCount.length, residual: afterCount.length };
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
  const cc = data.__corruption || { raw: 0, corrected: 0, residual: 0 };

  // 校正后仍有 U+FFFD -> 说明出现"校正表未收录"的新损坏。
  // 不静默放行: 只修可由上下文确定的, 其余必须暴露给人看, 严禁猜测内容。
  if (cc.residual > 0) {
    const samples = [];
    mirrorVehicles.forEach(v => {
      const j = JSON.stringify(v);
      if (j.includes('\uFFFD') && samples.length < 5) samples.push('id=' + v.id + ' ' + String(v.display));
    });
    console.error(`[WARN] 校正后仍残留 ${cc.residual} 个 U+FFFD(校正表未收录): ${samples.join('; ')}`);
    console.error('[WARN] 需人工从飞书表上下文确定正确字符后追加到 KNOWN_CORRUPTIONS, 并请用户在飞书表手工修正。');
  }

  if (CHECK) {
    const drifts = diff(existing, mirrorVehicles);
    if (drifts.length) {
      drifts.forEach(d => console.error('[FAIL] ' + d));
      console.error(`[gen_vehicles_data] 对账失败: ${drifts.length} 项漂移 (vehicles_data.js=${existing.length} web-data=${mirrorVehicles.length})`);
      process.exit(1);
    }
    console.log(`[gen_vehicles_data] 对账通过: vehicles_data.js 与 web-data 一致 (${mirrorVehicles.length} 车型, 校正 ${cc.corrected} 处编码损坏)`);
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
  console.log(`[gen_vehicles_data] 已生成 vehicles_data.js: ${mirrorVehicles.length} 车型 (漂移项 ${drifts.length}, 校正 ${cc.corrected} 处编码损坏)`);
}

// 仅在被直接执行时运行; 被 require(如 audit_media_consistency.js 复用校正表)时不产生写文件副作用
if (require.main === module) main();

module.exports = { KNOWN_CORRUPTIONS, applyCorrections, correctVehicle, countRepl, loadMirrorVehicles };
