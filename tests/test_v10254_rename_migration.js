#!/usr/bin/env node
/**
 * test_v10254_rename_migration.js — 车型改名迁移计划器测试(纯函数, 无 IO 副作用)
 */
'use strict';

const path = require('path');
const { buildRenamePlan } = require(path.join(__dirname, '..', 'scripts', 'migrate_vehicle_rename.js'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.error('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const V = (display, photos) => ({ id: 1, display, photoPaths: photos || [], videoPaths: [] });

/* 1) 改名后: 旧目录引用应迁到新目录 */
console.log('\n[1] 改名迁移');
{
  const v = V('比亚迪海豚DOLPHIN(低配)', ['vehicle_images/比亚迪海豚(低配)/image1.jpeg']);
  const plan = buildRenamePlan([v], p => p.includes('比亚迪海豚(低配)'));
  ok(plan.moves.length === 1, '产生 1 条迁移', JSON.stringify(plan.moves));
  ok(plan.moves[0].to === 'vehicle_images/比亚迪海豚DOLPHIN(低配)/image1.jpeg', '目标目录为新车型名', plan.moves[0] && plan.moves[0].to);
  ok(plan.moves[0].kind === 'move+rewrite', '判定为"移动+改引用"');
}

/* 2) 新目录已有文件、旧目录没有 → 只改引用, 不移动 */
console.log('\n[2] 仅改引用');
{
  const v = V('新名', ['vehicle_images/旧名/image1.jpeg']);
  const plan = buildRenamePlan([v], p => p.includes('新名'));
  ok(plan.moves.length === 1 && plan.moves[0].kind === 'rewrite-only', '只回写引用');
}

/* 3) 两边都有 → 冲突, 不动手 */
console.log('\n[3] 冲突不猜');
{
  const v = V('新名', ['vehicle_images/旧名/image1.jpeg']);
  const plan = buildRenamePlan([v], () => true);
  ok(plan.moves.length === 0, '冲突时不移动');
  ok(plan.conflicts.length === 1, '记入冲突清单', JSON.stringify(plan.conflicts));
}

/* 4) 源文件不存在 → 记缺失, 不臆造 */
console.log('\n[4] 缺失不臆造');
{
  const v = V('新名', ['vehicle_images/旧名/image1.jpeg']);
  const plan = buildRenamePlan([v], () => false);
  ok(plan.moves.length === 0 && plan.missing.length === 1, '记缺失');
}

/* 5) _共享 目录不参与改名 */
console.log('\n[5] 共享目录豁免');
{
  const v = V('任意名', ['vehicle_images/_共享/image4.jpeg']);
  const plan = buildRenamePlan([v], () => true);
  ok(plan.moves.length === 0 && plan.conflicts.length === 0, '_共享 不动');
}

/* 6) 已是正确目录 → 零动作(幂等) */
console.log('\n[6] 幂等');
{
  const v = V('比亚迪海豚', ['vehicle_images/比亚迪海豚/image1.jpeg']);
  const plan = buildRenamePlan([v], () => true);
  ok(plan.moves.length === 0, '无需迁移');
}

/* 7) 视频侧同样处理 */
console.log('\n[7] 视频同样迁移');
{
  const v = { id: 2, display: '新车型', photoPaths: [], videoPaths: ['vehicle_videos/旧车型/a.mp4'] };
  const plan = buildRenamePlan([v], p => p.includes('旧车型'));
  ok(plan.moves.length === 1 && plan.moves[0].to === 'vehicle_videos/新车型/a.mp4', '视频目录迁移', JSON.stringify(plan.moves));
}

console.log('\n' + '='.repeat(50));
console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
if (fail) process.exit(1);
