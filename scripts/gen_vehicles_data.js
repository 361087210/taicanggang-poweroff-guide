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

// 媒体路径约定单一真源(与 js/00-media-paths.js 同源, V10.25.0)。
// 优雅降级: 模块缺失时不影响数据校正主流程(仅跳过路径归一)。
let MP = null;
try { MP = require('../js/00-media-paths.js'); } catch (e) { MP = null; }

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
  { broken: '钥匙盒\uFFFD\uFFFD好', fixed: '钥匙盒关好', note: 'id=58 keyFrame[2] (残留 2×efbfbd)' },
  { broken: '车门\uFFFD\uFFFD\uFFFD短按', fixed: '车门，短按', note: 'id=24 长安启源(CS55PLUS(2026款)) steps[1] (残留 3×efbfbd, 参照 id=58 完好句)' },
  { broken: '再次\uFFFD\uFFFD动车门', fixed: '再次拉动车门', note: 'id=58 奇瑞艾瑞泽(艾瑞泽5PRO) steps[3] (残留 2×efbfbd, 参照 id=59 完好句)' },
  { broken: '关\uFFFD\uFFFD\uFFFD车门', fixed: '关闭车门', note: 'id=59 奇瑞皮卡(RELY R8) steps[1] (残留 3×efbfbd, 参照 id=58 完好句)' },
  { broken: '猎\uFFFD\uFFFD\uFFFD）', fixed: '猎手）', note: 'id=30 长安皮卡(HUNTER) display (残留 3×efbfbd, 参照视频名 猎手)' },
  { broken: '逆时\uFFFD\uFFFD\uFFFD松动', fixed: '逆时针松动', note: 'id=64 奇瑞捷途JETOUR(T2 I-DM) steps[2] (残留 3×efbfbd, 参照其它车型同句式)' },
  { broken: '绑扎检\uFFFD\uFFFD完',       fixed: '绑扎检查完',       note: 'id=15 比亚迪元(元UP) keyContainer[0] (残留 2×efbfbd, 参照同字段完好句)' },
  { broken: '断电无\uFFFD\uFFFD\uFFFD后', fixed: '断电无误后',       note: 'id=21 长安深蓝(S7/S5/S05) keyContainer[1] (残留 3×efbfbd, 参照其它车型同句式)' },
  { broken: '绑扎检查\uFFFD\uFFFD。',     fixed: '绑扎检查完。',     note: 'id=55 奇瑞瑞虎(瑞虎7PRO) keyContainer[0] (残留 2×efbfbd)' },
  { broken: '绑扎及框\uFFFD\uFFFD检查完', fixed: '绑扎及框架检查完', note: 'id=57 奇瑞瑞虎(瑞虎8 CSH) keyFrame[0] (残留 2×efbfbd, 参照完好句)' },
  { broken: '拔掉负\uFFFD\uFFFD线束',     fixed: '拔掉负极线束',     note: 'id=85 吉利豪越OKAVANGO steps[3] (残留 2×efbfbd, 参照其它车型同句式)' },
  { broken: '锁住\uFFFD\uFFFD\uFFFD门',   fixed: '锁住车门',         note: 'id=91 比亚迪元YUAN-UP-DM-I steps[1] (残留 3×efbfbd, 参照校正表首条)' },
  { broken: '所有车辆\uFFFD\uFFFD\uFFFD匙数量', fixed: '所有车辆钥匙数量', note: '镜像侧新损坏(残留 3×efbfbd, 参照产物完好句)' },
  { broken: '遥控钥\uFFFD\uFFFD\uFFFD锁车',    fixed: '遥控钥匙锁车',     note: '镜像侧新损坏(残留 3×efbfbd, 参照产物完好句)' },
  { broken: '铅封\uFFFD\uFFFD内',            fixed: '铅封袋内',         note: '镜像侧新损坏(残留 2×efbfbd, 参照产物完好句)' },
  { broken: '确\uFFFD\uFFFD断电无误',        fixed: '确认断电无误',     note: 'id=15 比亚迪元(元UP) keyContainer[1] (残留 2×efbfbd, 参照同字段完好句)' },
  { broken: '确认断电\uFFFD\uFFFD误后',      fixed: '确认断电无误后',   note: 'id=100 北汽-极狐ARCFOX-T1 keyContainer[0] (残留 2×efbfbd, 参照其它车型同句式)' },
  { broken: '通电，\uFFFD\uFFFD保四个车窗关闭', fixed: '通电，确保四个车窗关闭', note: 'id=14 比亚迪唐ATTO-8 steps[0] (残留 2×efbfbd, 参照同句式「确保」)' },
  { broken: '奇瑞艾瑞泽_艾\uFFFD\uFFFD\uFFFD泽5PRO.mp4', fixed: '奇瑞艾瑞泽_艾瑞泽5PRO.mp4', note: 'id=58 奇瑞艾瑞泽(艾瑞泽5PRO) videoPaths[0] (残留 3×efbfbd, 参照 display 名)' },
  // ↓ 2026-10-06 新同步批次带来: 飞书源表持续产出新损坏的实证(校正表只能兜症状)
  { broken: '确认\uFFFD\uFFFD\uFFFD电无误后', fixed: '确认断电无误后', note: 'id=15 比亚迪元(元UP) keyContainer[1] (残留 3×efbfbd, 参照 94× 同句式)' },
  { broken: '确认断\uFFFD\uFFFD无误后',     fixed: '确认断电无误后', note: 'id=43 东风小康(MPVC37) keyFrame[1] (残留 2×efbfbd, 参照 94× 同句式)' },
  { broken: '封好铅封\uFFFD\uFFFD\uFFFD',   fixed: '封好铅封。',     note: 'id=92 北汽BAIC-BJ30e keyFrame[2] (残留 3×efbfbd, 参照 94× 同句式句尾句号)' },
  // ↓ 2026-10-06 17:02 同步批次(第三次新增, 源表持续损坏)
  { broken: '取出车\uFFFD\uFFFD\uFFFD匙',   fixed: '取出车钥匙',     note: 'id=80 比亚迪海豹SEAL-U DM-I steps[0] (残留 3×efbfbd, 参照 id=14 同句式)' },
  // ↓ 2026-10-06 22:04 同步批次(第四次新增, 镜像刷新后又坏 3 处)
  { broken: '所\uFFFD\uFFFD\uFFFD车辆钥匙数量', fixed: '所有车辆钥匙数量', note: 'id=45 江淮江淮皮卡(T8PRO) keyFrame[0] (残留 3×efbfbd, 参照 5× "1.所有车辆钥匙数量，绑扎及框架检查完。")' },
  { broken: '\uFFFD\uFFFD\uFFFD闭后备箱',       fixed: '关闭后备箱',       note: 'id=69 奇瑞东南SOUEAST(S08DM) steps[3] (残留 3×efbfbd, 参照 2× "4.关闭后备箱，再次拉动车门确保关闭。")' },
  { broken: '车辆进箱无\uFFFD\uFFFD\uFFFD收钥匙', fixed: '车辆进箱无需收钥匙', note: 'id=98 吉利STARRAY-EM-i keyContainer[0] (残留 3×efbfbd, 参照 11× "2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。")' },
  // ↓ 2026-10-06 22:2x 同步批次(第五次新增, 源表仍在持续损坏 —— 见下方 I4 提示)
  { broken: '\uFFFD\uFFFD\uFFFD翔',           fixed: '悦翔',           note: 'id=23 长安 series 字段(残留 3×efbfbd, 同记录 display 完好为 "悦翔(CS15/...)")' },
  { broken: '封好铅封\uFFFD\uFFFD',           fixed: '封好铅封。',     note: 'id=59 奇瑞皮卡(RELY（瑞麟）R8) keyFrame[2] (残留 2×efbfbd, 句尾句号缺失; 与 id=92 的 3×efbfbd 是两种形态)' },
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

/* ===================== 自动派生校正(V10.20.2) =====================
 * 为什么需要(实证, 不是拍脑袋):
 *   飞书源表是"活"的 —— cron 每 15 分钟同步一次, 每次都可能产出**新的**损坏,
 *   而且**损坏位置会迁移**。同一天内的两次同步:
 *     第 1 批: id=80 '取出车???匙'  第 2 批: id=80 '取出??钥匙'(形态不同)
 *   已收录的手工条目对后一批**完全不匹配**, 校正表因此只能永远差一轮。
 *
 * 做法: 把损坏串的 U+FFFD 连续段当通配符, 在**本仓干净语料**里求唯一解。
 *   - 为什么是"宽松"段长(1..n+1)而不是等长: 双重编码下 FFFD 个数 ≠ 原字符数,
 *     等长通配实测 0/3 命中, 宽松通配 3/3 命中(见 _probe_autoderive.js)。
 *   - 为什么敢自动改: 库内同句式常有 N× 完好副本, "唯一解"等价于人工判定。
 *     回放历史 30 条人工条目: 复现 29 条, **0 条纠错**, 剩下 1 条是真正有歧义的。
 *
 * 安全边界(宁可不改, 不可改错):
 *   ① 必须**唯一命中**; 0 命中 / 多解一律不动
 *   ② 损坏串的**字面上下文 ≥ 4 字**, 否则模式太宽泛, 拒绝
 *   ③ 每条自动修复都打印 from → to, CI 日志可审计
 *   ④ 未解决的损坏照旧 WARN, 交人工收录
 * 手工表 KNOWN_CORRUPTIONS 仍在**前面**优先执行, 自动派生只补它没兜住的。
 */
const FFFD = '\uFFFD';
const _reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** 损坏串 -> 通配正则(纯函数): U+FFFD 连续段(长度 n) 展开为 [\s\S]{1,n+1} */
function brokenToRegExp(s) {
  const str = String(s == null ? '' : s);
  let out = '', i = 0, literal = 0;
  while (i < str.length) {
    if (str[i] === FFFD) {
      let n = 0;
      while (i < str.length && str[i] === FFFD) { n++; i++; }
      out += '[\\s\\S]{1,' + (n + 1) + '}';
    } else {
      let p = i;
      while (p < str.length && str[p] !== FFFD) p++;
      out += _reEsc(str.slice(i, p));
      literal += p - i;
      i = p;
    }
  }
  return { re: new RegExp('^' + out + '$'), literal: literal };
}

/** 收集干净语料: 车辆记录里所有**不含** U+FFFD 的字符串(去重, 保持插入序) */
function collectCleanCorpus(vehicles) {
  const out = new Set();
  const push = x => { if (typeof x === 'string' && !x.includes(FFFD)) out.add(x); };
  const walk = v => {
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (v && typeof v === 'object') { Object.keys(v).forEach(k => walk(v[k])); return; }
    push(v);
  };
  walk(vehicles || []);
  return out;
}

/**
 * 尝试自动派生修复(纯函数, 不改入参)
 * @param {string} str  含 U+FFFD 的损坏串
 * @param {Set<string>|Iterable<string>} corpus 干净语料
 * @returns {string|null} 唯一解返回修复串; 无解/多解/上下文过短一律 null
 */
function deriveFix(str, corpus) {
  const s = String(str == null ? '' : str);
  if (!s.includes(FFFD)) return null;
  const { re, literal } = brokenToRegExp(s);
  if (literal < 4) return null; // 字面上下文太短, 模式过宽, 拒绝猜测
  let hit = null, n = 0;
  for (const c of corpus || []) {
    if (re.test(c)) { n++; if (n > 1) return null; hit = c; }
  }
  return n === 1 ? hit : null;
}

/**
 * 对车辆数组施加自动派生校正(先建语料, 再逐个求解)
 * @returns {{applied:Array, unresolved:Array}} applied/unresolved 均含 {path, from, to}
 */
function autoCorrectVehicles(vehicles, corpusIn) {
  const corpus = corpusIn || collectCleanCorpus(vehicles);
  const applied = [], unresolved = [];
  const walk = (node, path) => {
    if (Array.isArray(node)) return node.map((x, i) => walk(x, path + '[' + i + ']'));
    if (node && typeof node === 'object') {
      const o = {};
      for (const k of Object.keys(node)) o[k] = walk(node[k], path ? path + '.' + k : k);
      return o;
    }
    if (typeof node === 'string' && node.includes(FFFD)) {
      const fixed = deriveFix(node, corpus);
      if (fixed) { applied.push({ path: path, from: node, to: fixed }); return fixed; }
      unresolved.push({ path: path, from: node, to: null });
      return node;
    }
    return node;
  };
  const out = (vehicles || []).map((v, i) => walk(v, '[' + i + ']'));
  return { vehicles: out, applied: applied, unresolved: unresolved };
}

/**
 * 媒体路径归一(V10.25.0) —— 让镜像 photoPaths 与 vehicle_images/ 的
 * 「按车型名分文件夹」约定对称, 消除 --check 的伪漂移。
 *
 * 规则(与 scripts/migrate_media_to_folders.js 的归置口径逐字一致):
 *   · 仅被 1 个车型引用      → vehicle_images/<车型目录>/<文件名>
 *   · 被 ≥2 个车型引用(共享) → vehicle_images/_共享/<文件名>
 *   · 已是三段式(含子目录)   → 幂等保留(共享/未归类等非车型目录不可重算)
 *   · 非 vehicle_images 顶层(如裸文件名) → 原样保留
 *
 * 注意: 只归一 photoPaths。videoPaths 保持两段式(视频走 release 直链,
 * 本地无文件, 且 tests/test_vehicle_data_integrity.js I1e 依赖两段式字面),
 * 上传回写见 js/06-media.js。返回同一数组引用(原处修改)。
 */
function normalizePhotoPaths(vehicles) {
  if (!MP || !Array.isArray(vehicles)) return vehicles;
  // basename → 引用车型 id 集合(与迁移脚本同口径: 同一车型重复引用只计一次)
  const refBy = Object.create(null);
  vehicles.forEach(function (v) {
    (v && v.photoPaths || []).forEach(function (p) {
      const f = MP.parseMediaPath(p).fileName;
      if (!f) return;
      (refBy[f] || (refBy[f] = new Set())).add(v.id);
    });
  });
  vehicles.forEach(function (v) {
    if (!v || !Array.isArray(v.photoPaths)) return;
    v.photoPaths = v.photoPaths.map(function (p) {
      const parsed = MP.parseMediaPath(p);
      if (!parsed.fileName) return p;
      if (parsed.isNested) return p;                     // 已归位 → 幂等
      if (parsed.top !== MP.PHOTO_TOP) return p;         // 非照片顶层 → 不碰
      const ids = refBy[parsed.fileName];
      const folder = (ids && ids.size > 1)
        ? MP.SHARED_FOLDER
        : MP.folderNameForVehicle(v);
      return MP.photoRelPath(folder, parsed.fileName);
    });
  });
  return vehicles;
}

/** 读 web-data 镜像的 vehicles 数组, 并施加已知编码损坏校正 */
function loadMirrorVehicles() {
  const d = JSON.parse(fs.readFileSync(MIRROR, 'utf8'));
  if (!d || !Array.isArray(d.vehicles)) throw new Error('web-data/vehicle_sync_data.json 缺少 vehicles 数组');
  const rawCount = JSON.stringify(d.vehicles).match(/\uFFFD/g) || [];
  // ① 手工校正表优先(override)
  d.vehicles = d.vehicles.map(correctVehicle);
  // ② 自动派生补齐: 语料取自**校正后**的干净字段(含手工表的成果)
  const auto = autoCorrectVehicles(d.vehicles, collectCleanCorpus(d.vehicles));
  d.vehicles = auto.vehicles;
  if (auto.applied.length) {
    if (CHECK) {
      // --check 为对账模式: 只报计数, 不打逐条明细。两个原因:
      // ① 明细是"生成/审计"用的过程日志(--check 下无写盘, 无审计价值);
      // ② 对账失败原因([FAIL] 车型内容漂移 ...)在 stderr, 若 stdout 被逐条明细占满,
      //    下游按"输出前段"定位失败原因的消费者(如 test_v1029 S4e)会读不到关键行。
      console.error(`[自动派生] 唯一解自动修复 ${auto.applied.length} 处编码损坏 (明细见非 --check 生成模式)`);
    } else {
      auto.applied.forEach(a => console.log(`[自动派生] ${a.path}: ${JSON.stringify(a.from)} -> ${JSON.stringify(a.to)}`));
    }
  }
  // ③ 媒体路径归一: 与 vehicle_images/「按车型名分文件夹」约定对称(见 normalizePhotoPaths)
  d.vehicles = normalizePhotoPaths(d.vehicles);
  const afterCount = JSON.stringify(d.vehicles).match(/\uFFFD/g) || [];
  d.__corruption = {
    raw: rawCount.length,
    corrected: rawCount.length - afterCount.length,
    residual: afterCount.length,
    auto: auto.applied.length,
    unresolved: auto.unresolved.length
  };
  if (auto.unresolved.length) {
    console.error(`[WARN] ${auto.unresolved.length} 处损坏自动派生无唯一解(未修改): ` +
      auto.unresolved.slice(0, 5).map(u => u.path + ' ' + JSON.stringify(u.from)).join('; '));
  }
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

/** 稳定序列化(忽略键序): 用于逐车全字段内容比对 */
function stableJSON(v) {
  return JSON.stringify(v, (k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.keys(val).sort().reduce((o, k2) => { o[k2] = val[k2]; return o; }, {});
    }
    return val;
  });
}

/** 归一化对比(忽略键序): 返回漂移明细数组 */
function diff(vehicles, mirrorVehicles) {
  const drifts = [];

  // 全字段内容比对(2026-10-06 补):
  //   此前只比"车辆数 + display 名 + 视频名集合", 导致**纯文本字段**的差异被判为"无变化"。
  //   后果: 编码损坏校正(改的是 steps/keyFrame/keyContainer 正文)永远写不进产物,
  //   要等别的漂移顺带触发才落地 —— vehicles_data.js 因此长期残留 U+FFFD。
  //   幂等的正确语义是"内容相同才跳过", 不是"摘要相同就跳过"。
  const existingById = {};
  (vehicles || []).forEach(v => { if (v && v.id != null) existingById[v.id] = v; });
  const contentDrifts = [];
  for (const m of mirrorVehicles) {
    const e = existingById[m.id];
    if (!e) { contentDrifts.push('id=' + m.id + '(仅 web-data)'); continue; }
    if (stableJSON(e) !== stableJSON(m)) contentDrifts.push('id=' + m.id);
  }
  if (contentDrifts.length) {
    drifts.push(`车型内容漂移 ${contentDrifts.length} 车: ${contentDrifts.slice(0, 8).join(', ')}${contentDrifts.length > 8 ? ' …' : ''}`);
  }
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

  // P0 零条熔断: 镜像 0 车但本地已有数据 -> 绝不覆盖(防 82 车被静默清库)。
  // 语义对齐 js/09-web-sync.js:319 的运行时侧守卫 —— 生成链此前漏了这一道。
  // 必须 process.exit(非零) 而非"跳过写入后退出 0": sync-web-data.yml 无 continue-on-error,
  // 非零退出会让后续 git push 步骤被跳过, 从而根本不产生坏提交; 若只跳过写入,
  // 第 1 步已写好的 0 车镜像仍会被提交, 而 vehicles_data.js 仍是 82 -> 更隐蔽的坏状态。
  // 合法场景(飞书侧真的清空)需人工 --force 放行, 沿用 :158 既有约定。
  if (mirrorVehicles.length === 0 && existing.length > 0 && !process.argv.includes('--force')) {
    console.error(`[gen_vehicles_data] 拒绝覆盖: 镜像 0 车但本地已有 ${existing.length} 车(疑似飞书凭证有效却取不到 vehicle_sync_data.json)`);
    process.exit(1);
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

module.exports = {
  KNOWN_CORRUPTIONS, applyCorrections, correctVehicle, countRepl, loadMirrorVehicles,
  brokenToRegExp, collectCleanCorpus, deriveFix, autoCorrectVehicles
};
