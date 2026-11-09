#!/usr/bin/env node
/**
 * test_v10251_media_gc_plan.js — 飞书云盘对账计划器测试(纯函数, 不联网)
 *
 * 覆盖 feishu_media_gc.js#planActions 的四类判定:
 *   移动/改名(MISPLACED) | 孤儿(ORPHAN) | 缺失(MISSING) | 歧义不猜(AMBIGUOUS)
 */
'use strict';

const path = require('path');
const { planActions } = require(path.join(__dirname, '..', 'scripts', 'feishu_media_gc.js'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.error('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

const mk = (rel, token) => ({ rel, name: rel.split('/').pop(), folder: rel.split('/').length === 3 ? rel.split('/')[1] : '', token: token || 't-' + rel });

/* 1) 完全一致 → 无动作 */
console.log('\n[1] 完全一致');
{
  const exp = new Set(['vehicle_images/A车/image1.jpeg']);
  const r = planActions([mk('vehicle_images/A车/image1.jpeg')], exp);
  ok(r.moves.length === 0 && r.orphans.length === 0 && r.missing.length === 0, '无任何动作');
}

/* 2) 扁平 → 应在车型目录(典型迁移遗留) */
console.log('\n[2] 扁平文件归位');
{
  const exp = new Set(['vehicle_images/A车/image1.jpeg']);
  const r = planActions([mk('vehicle_images/image1.jpeg')], exp);
  ok(r.moves.length === 1, '产生 1 条移动');
  ok(r.moves[0].to === 'vehicle_images/A车/image1.jpeg', '目标路径正确');
  ok(r.orphans.length === 0, '不误判为孤儿');
}

/* 3) 旧命名 + 清单指向新名 → 不做推断式改名, 记为孤儿(等应用切名后归档) */
console.log('\n[3] 不推断改名');
{
  const exp = new Set(['vehicle_images/A车/A车_p1_ab12cd34.jpeg']);
  const r = planActions([mk('vehicle_images/A车/image1.jpeg')], exp);
  ok(r.moves.length === 0, '不凭文件名差异猜测改名');
  ok(r.orphans.length === 1, '当作孤儿归档(可恢复), 而不是猜错改名');
}

/* 4) 云端有、清单无 → 孤儿(归档) */
console.log('\n[4] 孤儿识别');
{
  const exp = new Set(['vehicle_images/A车/image1.jpeg']);
  const r = planActions([
    mk('vehicle_images/A车/image1.jpeg'),
    mk('vehicle_images/A车/image9.jpeg')
  ], exp);
  ok(r.orphans.length === 1 && r.orphans[0].rel.endsWith('image9.jpeg'), '多余文件判为孤儿');
}

/* 5) 同名对应多个车型 → 歧义, 不动手 */
console.log('\n[5] 歧义不猜');
{
  const exp = new Set([
    'vehicle_images/A车/image4.jpeg',
    'vehicle_images/B车/image4.jpeg'
  ]);
  const r = planActions([mk('vehicle_images/image4.jpeg')], exp);
  ok(r.moves.length === 0, '歧义时不做任何移动');
  ok(r.ambiguous.length === 1, '记入歧义清单待人工确认');
  ok(r.orphans.length === 0, '也不能当孤儿归档');
}

/* 6) 清单有、云端无 → 缺失(只报告) */
console.log('\n[6] 缺失只报告');
{
  const exp = new Set(['vehicle_images/A车/image1.jpeg', 'vehicle_images/A车/image2.jpeg']);
  const r = planActions([mk('vehicle_images/A车/image1.jpeg')], exp);
  ok(r.missing.length === 1 && r.missing[0].endsWith('image2.jpeg'), '缺失清单正确');
}

/* 7) 回收站内的文件不参与判定 */
console.log('\n[7] 回收站豁免');
{
  const exp = new Set();
  const r = planActions([mk('vehicle_images/_回收站/20261109/image1.jpeg')], exp);
  ok(r.orphans.length === 0, '回收站内文件不再被当孤儿');
}

/* 8) 幂等: 整理后再跑一遍应零动作 */
console.log('\n[8] 幂等');
{
  const exp = new Set(['vehicle_images/A车/A车_p1_ab12cd34.jpeg']);
  const after = [mk('vehicle_images/A车/A车_p1_ab12cd34.jpeg')];
  const r = planActions(after, exp);
  ok(r.moves.length === 0 && r.orphans.length === 0, '整理后重跑零动作');
}

/* 9) 会被"移动到位"的文件, 不得再计入缺失(否则报表虚高) */
console.log('\n[9] 缺失口径');
{
  const exp = new Set(['vehicle_images/A车/image1.jpeg', 'vehicle_images/A车/image2.jpeg']);
  const r = planActions([
    mk('vehicle_images/image1.jpeg'),        // 需归位
    mk('vehicle_images/A车/image2.jpeg')     // 已到位
  ], exp);
  ok(r.moves.length === 1, '有 1 条归位');
  ok(r.missing.length === 0, '归位目标不算缺失', JSON.stringify(r.missing));
}

console.log('\n' + '='.repeat(50));
console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
if (fail) process.exit(1);
