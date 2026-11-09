#!/usr/bin/env node
/**
 * migrate_vehicle_rename.js — 车型改名后的媒体迁移（仓库侧）
 *
 * 问题:
 *   媒体目录名由 folderNameForVehicle(v) = sanitize(v.display) 派生。
 *   组长在 App 里把车型名从「比亚迪海豚(低配)」改成「比亚迪海豚DOLPHIN(低配)」后,
 *   photoPaths 里仍是旧目录 → 引用全部失效, 旧目录的文件变成孤儿,
 *   而归属门禁(A2)会立刻报红 —— 这说明"改名"是唯一一个**正常操作就会破坏归属**的场景。
 *
 * 本脚本做的事(仓库侧):
 *   1. 找出"引用目录 ≠ 该车型当前应有目录"的媒体
 *   2. 把文件从旧目录搬到新目录(存在性优先, 冲突则报告不动手)
 *   3. 回写 vehicles_data.js 与 web-data 镜像里的路径
 *   4. 清理搬空后的旧目录
 *
 * 云端怎么同步?
 *   本脚本**不直连飞书**。仓库侧纠正后, 直接跑 `scripts/feishu_media_gc.js`:
 *   它以 vehicles_data.js 为真源, 会把云端里"名字对、目录错"的文件归位,
 *   并把搬空后的旧目录留作空目录(可人工删除)。这样职责单一, 也避免两处写盘打架。
 *
 * 用法:
 *   node scripts/migrate_vehicle_rename.js                 # 默认 dry-run, 只打印计划
 *   node scripts/migrate_vehicle_rename.js --apply         # 执行(文件移动 + 路径回写)
 *   node scripts/migrate_vehicle_rename.js --apply --json  # 机器可读输出
 *
 * 安全: 只移动、不删除; 冲突(新目录已有同名文件且内容不同)一律跳过并报告。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MP = require(path.join(ROOT, 'js', '00-media-paths.js'));
const TOP = { photo: MP.PHOTO_TOP, video: MP.VIDEO_TOP };

const APPLY = process.argv.includes('--apply');
const JSON_OUT = process.argv.includes('--json');

function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const decl = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!decl) throw new Error('vehicles_data.js 未找到 VEHICLES 声明');
  const s = src.indexOf('[', decl.index);
  const e = src.lastIndexOf(']');
  return new Function('return (' + src.slice(s, e + 1) + ')')();
}

/**
 * 纯函数: 生成迁移计划(不做任何 IO, 便于单测)
 * @param {Array} vehicles 车型数组
 * @param {function(string):boolean} exists 相对路径是否存在(仓库内)
 * @returns {{moves:Array, conflicts:Array, missing:Array}}
 */
function buildRenamePlan(vehicles, exists) {
  const moves = [], conflicts = [], missing = [];
  for (const v of vehicles) {
    const expected = MP.folderNameForVehicle(v);
    const lists = [
      { type: 'photo', paths: v.photoPaths || [], top: TOP.photo },
      { type: 'video', paths: v.videoPaths || [], top: TOP.video }
    ];
    for (const { type, paths, top } of lists) {
      for (const p of paths) {
        if (typeof p !== 'string' || !p.startsWith(top + '/')) continue;
        const seg = p.split('/');
        if (seg.length !== 3) continue;                 // 非三段式交给归属门禁报, 这里不动
        const [, folder, file] = seg;
        if (folder === expected || folder === MP.SHARED_FOLDER) continue;

        const to = `${top}/${expected}/${file}`;
        const fromExists = exists(p);
        const toExists = exists(to);
        if (!fromExists && toExists) { moves.push({ type, from: p, to, kind: 'rewrite-only', v: v.id }); continue; }
        if (!fromExists && !toExists) { missing.push({ type, from: p, v: v.id }); continue; }
        if (fromExists && toExists) { conflicts.push({ type, from: p, to, v: v.id }); continue; }
        moves.push({ type, from: p, to, kind: 'move+rewrite', v: v.id });
      }
    }
  }
  return { moves, conflicts, missing };
}

function existsRel(rel) {
  try { return fs.statSync(path.join(ROOT, rel)).isFile(); } catch (e) { return false; }
}

function moveFile(fromRel, toRel) {
  const from = path.join(ROOT, fromRel), to = path.join(ROOT, toRel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    execFileSync('git', ['mv', '--', fromRel, toRel], { cwd: ROOT, stdio: 'ignore' });
  } catch (e) {
    fs.renameSync(from, to);   // 非 git 管理时退化为普通移动
  }
}

function rewriteRefs(pairs) {
  const map = new Map(pairs.map(p => [p.from, p.to]));
  // ① vehicles_data.js
  const vd = path.join(ROOT, 'vehicles_data.js');
  let text = fs.readFileSync(vd, 'utf8');
  let changed = 0;
  for (const [from, to] of map) {
    const parts = text.split('"' + from + '"');
    if (parts.length > 1) { changed += parts.length - 1; text = parts.join('"' + to + '"'); }
  }
  if (changed) fs.writeFileSync(vd, text);

  // ② web-data 镜像(文本替换, 保留原格式)
  const mirror = path.join(ROOT, 'web-data', 'vehicle_sync_data.json');
  let mChanged = 0;
  if (fs.existsSync(mirror)) {
    let mt = fs.readFileSync(mirror, 'utf8');
    for (const [from, to] of map) {
      const parts = mt.split('"' + from + '"');
      if (parts.length > 1) { mChanged += parts.length - 1; mt = parts.join('"' + to + '"'); }
    }
    if (mChanged) fs.writeFileSync(mirror, mt);
  }
  return { changed, mChanged };
}

function removeEmptyDirs(moves) {
  const dirs = new Set(moves.map(m => path.dirname(path.join(ROOT, m.from))));
  for (const d of dirs) {
    try {
      if (fs.readdirSync(d).length === 0) fs.rmdirSync(d);
    } catch (e) { /* 忽略 */ }
  }
}

function main() {
  const vehicles = loadVehicles();
  const plan = buildRenamePlan(vehicles, existsRel);

  const summary = {
    mode: APPLY ? 'apply' : 'dry-run',
    moves: plan.moves.length,
    conflicts: plan.conflicts.length,
    missing: plan.missing.length
  };

  if (JSON_OUT) {
    console.log(JSON.stringify({ summary, plan }, null, 1));
  } else {
    console.log(`[rename] 车型 ${vehicles.length} 台 | 待迁移 ${summary.moves} | 冲突 ${summary.conflicts} | 缺失 ${summary.missing}`);
    plan.moves.slice(0, 10).forEach(m => console.log(`  ${m.kind === 'move+rewrite' ? '移动' : '仅改引用'} ${m.from}\n        → ${m.to}`));
    if (plan.moves.length > 10) console.log(`  ... 另有 ${plan.moves.length - 10} 条`);
    plan.conflicts.forEach(c => console.log(`  ⚠ 冲突(跳过): ${c.from} 与 ${c.to} 同时存在`));
    plan.missing.forEach(m => console.log(`  ⚠ 源文件不存在: ${m.from}`));
  }

  if (!plan.moves.length) {
    if (!JSON_OUT) console.log('[rename] 无需迁移: 所有引用目录已与车型名一致');
    return;
  }
  if (!APPLY) {
    if (!JSON_OUT) console.log('[rename] 这是预览。确认后加 --apply 执行; 之后再跑 feishu_media_gc.js 同步云端');
    return;
  }

  let done = 0;
  const pairs = [];
  for (const m of plan.moves) {
    try {
      if (m.kind === 'move+rewrite') moveFile(m.from, m.to);
      pairs.push({ from: m.from, to: m.to });
      done++;
    } catch (e) {
      console.error(`[rename] 失败 ${m.from}: ${e.message}`);
    }
  }
  const r = rewriteRefs(pairs);
  removeEmptyDirs(plan.moves);
  console.log(`[rename] 完成: 文件 ${done} 个 | vehicles_data 改写 ${r.changed} 处 | 镜像 ${r.mChanged} 处`);
  console.log('[rename] 下一步: node scripts/feishu_media_gc.js  (dry-run 看计划, 再 --apply 同步云端)');
}

if (require.main === module) main();
module.exports = { buildRenamePlan };
