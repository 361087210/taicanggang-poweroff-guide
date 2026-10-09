#!/usr/bin/env node
'use strict';
/**
 * ============================================================
 * scripts/check_coverage_threshold.js —— 行覆盖率验收门禁
 * ============================================================
 * 背景:
 *   仓库有 48 个 test:* 套件, 却从未量化"到底覆盖了多少行源码"——
 *   新增模块可以长期零测试, CI 依然全绿。本门禁把"行覆盖率"变成硬性验收线。
 *
 * 数据来源:
 *   npm run test:coverage
 *   = c8 对 js 目录做 --all 归因(通配 js 下全部 .js), 包裹 npm run test:all 采集数据
 *   产出 coverage/coverage-summary.json
 *
 * 判定:
 *   ① 可归因源文件(js/ 下除声明式排除项)的整体"行覆盖率" >= MIN_LINES_PCT;
 *   ② 声明式排除项必须**仍是未归因**(覆盖率 <= STALE_EPSILON), 否则报 STALE,
 *      提醒移除排除——避免排除清单变成永久盲区(与 check_ci_coverage.js 同思路)。
 *
 * 为什么存在排除项(度量口径限制, 不是"没测"):
 *   js/00-config.js、09-web-sync.js、10-feedback.js、11-about.js、12-bitable.js
 *   由 JSDOM(window.eval, runScripts:'dangerously'|'outside-only') 装载,
 *   不经 vm.runInContext, c8 无法按文件名归因(实测 0%)。
 *   详见 docs/codebase/TESTING.md。
 *
 * 运行: node scripts/check_coverage_threshold.js
 * 退出码: 0=达标, 1=未达标/排除项过期/缺覆盖率数据
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUMMARY_FILE = path.join(ROOT, 'coverage', 'coverage-summary.json');

/** 行覆盖率验收线(可归因 js/ 源文件整体, 百分比) */
const MIN_LINES_PCT = 95;

/** 判定"仍未归因"的阈值: 行覆盖率 <= 该值 视为未归因 */
const STALE_EPSILON = 1;

/**
 * 声明式排除: 因装载方式导致 c8 无法归因的源文件。
 * 必须写明理由; 一旦被归因(出现覆盖)会报 STALE, 要求从清单移除。
 */
const EXPECTED_UNATTRIBUTED = {
  'js/00-config.js': 'JSDOM window.eval 装载, 不经 vm.runInContext, c8 无法按文件名归因',
  'js/09-web-sync.js': '同上(window.eval 装载)',
  'js/10-feedback.js': '同上(window.eval 装载)',
  'js/11-about.js': '同上(window.eval 装载)',
  'js/12-bitable.js': '同上(window.eval 装载)'
};

const pctOf = m => (m && typeof m.pct === 'number') ? m.pct : null;

/** 归一化 json-summary 的绝对路径键 -> js/<name> */
function relKey(abs) {
  const n = String(abs).replace(/\\/g, '/');
  const i = n.lastIndexOf('/js/');
  return i >= 0 ? 'js/' + n.slice(i + 4) : n;
}

function main() {
  const out = [];
  const fail = [];
  const log = s => out.push(s);
  const bad = s => { out.push(s); fail.push(s); };

  if (!fs.existsSync(SUMMARY_FILE)) {
    bad('[FAIL] 未找到覆盖率数据: ' + path.relative(ROOT, SUMMARY_FILE).replace(/\\/g, '/'));
    log('       请先运行: npm run test:coverage');
    console.log(out.join('\n'));
    process.exit(1);
  }

  let summary;
  try {
    summary = JSON.parse(fs.readFileSync(SUMMARY_FILE, 'utf8'));
  } catch (e) {
    bad('[FAIL] 覆盖率数据解析失败: ' + e.message);
    console.log(out.join('\n'));
    process.exit(1);
  }

  // 收集 js/ 逐文件条目
  const files = {};
  for (const k of Object.keys(summary)) {
    if (k === 'total') continue;
    const rel = relKey(k);
    if (rel.indexOf('js/') !== 0) continue;
    files[rel] = summary[k];
  }
  const names = Object.keys(files).sort();

  log('--- 行覆盖率门禁 (js/ 源码) ---');

  if (names.length === 0) {
    bad('[FAIL] 覆盖率数据中没有任何 js/ 源文件条目, 请检查 --include="js/**/*.js"');
    console.log(out.join('\n'));
    process.exit(1);
  }

  // ① 排除项必须仍未被归因
  const staleExcluded = [];
  const missingExcluded = [];
  for (const f of Object.keys(EXPECTED_UNATTRIBUTED)) {
    if (!(f in files)) { missingExcluded.push(f); continue; }
    const p = pctOf(files[f].lines);
    if (p !== null && p > STALE_EPSILON) staleExcluded.push(f + ' (行覆盖率 ' + p + '%)');
  }
  if (missingExcluded.length) {
    bad('[FAIL] 声明式排除文件已不存在, 请从 EXPECTED_UNATTRIBUTED 移除:');
    missingExcluded.forEach(f => log('       - ' + f));
  }
  if (staleExcluded.length) {
    bad('[FAIL] 以下排除项已被归因(不再是未归因), 排除清单已过期, 请移除:');
    staleExcluded.forEach(f => log('       - ' + f));
  }

  // ② 可归因文件聚合行覆盖率
  let cov = 0, tot = 0;
  const per = [];
  for (const f of names) {
    if (f in EXPECTED_UNATTRIBUTED) continue;
    const l = files[f].lines || {};
    const c = Number(l.covered || 0), t = Number(l.total || 0);
    cov += c; tot += t;
    per.push([f, c, t, t ? (c / t * 100) : 0]);
  }
  const agg = tot ? (cov / tot * 100) : 0;

  log('');
  log('可归因文件明细:');
  per.forEach(([f, c, t, p]) => {
    log('  ' + (p.toFixed(2) + '%').padStart(8) + '  ' +
        (String(c) + '/' + String(t)).padStart(12) + '  ' + f);
  });
  log('  ' + '-'.repeat(62));
  log('  可归因合计: ' + cov + '/' + tot + ' = ' + agg.toFixed(2) + '%');
  log('  验收线 MIN_LINES_PCT: ' + MIN_LINES_PCT + '%');
  log('');

  if (agg + 1e-9 < MIN_LINES_PCT) {
    bad('[FAIL] 行覆盖率未达标: ' + agg.toFixed(2) + '% < ' + MIN_LINES_PCT + '%');
  }

  // 其它口径(仅供参考, 不作门禁)
  const t = summary.total || {};
  const g = (k) => (t[k] && typeof t[k].pct === 'number') ? t[k].pct : '?';
  log('参考(全量 ' + names.length + ' 文件): 行 ' + g('lines') + '% / 语句 ' +
      g('statements') + '% / 分支 ' + g('branches') + '% / 函数 ' + g('functions') + '%');
  log('');

  if (fail.length === 0) {
    log('[PASS] 行覆盖率门禁通过 (' + agg.toFixed(2) + '% >= ' + MIN_LINES_PCT + '%)');
  }

  console.log(out.join('\n'));
  process.exit(fail.length ? 1 : 0);
}

main();
