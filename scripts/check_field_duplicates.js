#!/usr/bin/env node
/**
 * check_field_duplicates.js — 车型字段「近似重复」巡检门禁
 *
 * 背景(线上真实案例):
 *   id92 brand="北汽BAIC"、id100 brand="北汽(BAIC)" —— 同一个品牌两种写法,
 *   筛选器按字符串分组, 于是"北汽"裂成两个各只有 1 辆车的选项,
 *   用户以为数据丢了。这类问题肉眼极难发现(要恰好把两个车型并排看)。
 *
 * 做法: 对关键字段做归一化(去括号/空格/连字符/全半角差异)后分组,
 *   若"归一化后的取值数 < 原始取值数", 说明存在写法分裂 → FAIL。
 *
 * 归一化只用于**比对**, 不用于改数据: 是否真的合并由人判断
 *   (例如 "唐DM-i" 与 "唐DMi" 可能确是两个配置)。
 *
 * 用法:
 *   node scripts/check_field_duplicates.js           # 巡检(有重复则退出码 1)
 *   node scripts/check_field_duplicates.js --warn    # 只告警不阻断(灰度期用)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WARN_ONLY = process.argv.includes('--warn');

/** 参与巡检的字段: 都是"被用来分组/筛选/展示"的维度 */
const FIELDS = ['brand', 'series', 'config', 'powerType', 'position'];

function norm(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .replace(/[()（）[\]【】\s\-_·・,.。、/]/g, '');
}

function loadVehicles() {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const decl = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!decl) throw new Error('vehicles_data.js 未找到 VEHICLES 声明');
  const start = src.indexOf('[', decl.index);
  const end = src.lastIndexOf(']');
  return new Function('return (' + src.slice(start, end + 1) + ')')();
}

function main() {
  const vehicles = loadVehicles();
  const problems = [];

  for (const field of FIELDS) {
    const groups = new Map();   // norm -> Set(原始写法)
    const owners = new Map();   // norm -> [id...]
    for (const v of vehicles) {
      const raw = v[field];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const k = norm(raw);
      if (!groups.has(k)) { groups.set(k, new Set()); owners.set(k, []); }
      groups.get(k).add(raw);
      owners.get(k).push(v.id);
    }
    for (const [k, variants] of groups) {
      if (variants.size > 1) {
        problems.push({
          field,
          variants: [...variants],
          ids: owners.get(k)
        });
      }
    }
  }

  if (!problems.length) {
    console.log(`[字段巡检] 通过: ${FIELDS.length} 个字段均无近似重复 (车型 ${vehicles.length} 台)`);
    return;
  }

  problems.forEach(p => {
    const line = `[字段巡检] ${p.field} 存在写法分裂: ${p.variants.map(v => `"${v}"`).join(' / ')}  (车型 id: ${p.ids.join(',')})`;
    if (WARN_ONLY) console.warn('[WARN] ' + line);
    else console.error('[FAIL] ' + line);
  });
  console.error(`\n[字段巡检] 共 ${problems.length} 组问题。修正建议: 统一为其中一种写法并用脚本回写 vehicles_data.js 与 web-data 镜像。`);
  if (!WARN_ONLY) process.exit(1);
}

main();
