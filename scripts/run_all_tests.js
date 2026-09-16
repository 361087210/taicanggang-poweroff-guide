#!/usr/bin/env node
'use strict';
/**
 * ============================================================
 * scripts/run_all_tests.js —— test:all 的可靠执行器(修复 CI 结构问题 1)
 * ============================================================
 * 问题背景:
 *   原 package.json 的 test:all 是一长串 `npm run test:X && npm run test:Y && ...`
 *   (共 47 个子套件)。`&&` 串联的致命缺陷: 任一子套件失败会让整条链硬中断,
 *   后续十几个套件完全不执行, 使"test:all 全绿"这条验收线长期不可信(红灯被
 *   静默吞掉, 无人察觉)。
 *
 * 本脚本的做法:
 *   逐个执行 test:all 引用到的每个子脚本, 不因失败提前退出, 收集每个套件的退出码,
 *   最后打印"通过/失败"汇总表, 并按"是否有任一失败"决定 process.exit 码。
 *
 * 设计要点:
 *   - TEST_SUITES 即原 test:all 的子脚本清单(单一真源)。scripts/check_ci_coverage.js
 *     复用它来推导 CI 可达性闭包 —— 否则改为本 runner 后子套件会全部"不可达"而误报。
 *   - 每个子脚本通过 `npm run <script>` 执行, 严格沿用 package.json 中的定义。
 *   - 本文件被 check_ci_coverage.js require 时只导出 TEST_SUITES, 不会触发 main(),
 *     避免门禁脚本误把全部测试跑一遍。
 *
 * 运行: node scripts/run_all_tests.js
 * 退出码: 0 = 全部通过; 1 = 任一子套件失败
 */

const { execSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/**
 * 子套件清单 —— 原 test:all 串联的 47 个套件(单一真源)。
 * 注意: 仅复刻原 test:all 引用的子脚本, 不增不减; 新增套件须同步加入此处
 * 并登记到 package.json 的对应 test:* 脚本(否则 check_ci_coverage 门禁会拦截)。
 */
const TEST_SUITES = [
  'test:version',
  'check:two-end',
  'test:two-end-gate',
  'test:logic',
  'test:runtime',
  'test:v103',
  'test:v104',
  'test:v105',
  'test:v106',
  'test:v107',
  'test:v108',
  'test:v109',
  'test:v1010',
  'test:v1011',
  'test:v1013',
  'test:v1014',
  'test:v1015',
  'test:v110-bitable',
  'test:v110-audit',
  'test:v1016',
  'test:refactor',
  'test:registration',
  'test:video',
  'test:v1019-addvehicle',
  'test:v1020-crud',
  'test:v1021-guard',
  'test:v1019-gate',
  'test:v1019-hygiene',
  'test:linkkey',
  'test:backup',
  'test:web-account',
  'test:manifest',
  'test:remove-guard',
  'test:audit',
  'test:export-photo',
  'test:vehicles-sync',
  'test:validate-web',
  'test:docx-sheets',
  'test:video-sync',
  'test:v1033',
  'test:feedback-version',
  'test:feedback-status',
  'test:process-feedback',
  'test:crypto-capability',
  'test:nav-guard',
  'test:vehicle-integrity',
  'test:cross'
];

/**
 * 执行单个子套件, 返回 { name, ok, code, secs }。
 * 失败(非 0 退出)被捕获, 不向上抛出 —— 这是修复的核心: 不让单套件失败中断全流程。
 * @param {string} name
 * @return {{ name: string, ok: boolean, code: number, secs: string }}
 */
function runSuite(name) {
  const start = Date.now();
  let ok = true;
  let code = 0;
  try {
    execSync('npm run ' + name, { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    ok = false;
    code = (e && typeof e.status === 'number') ? e.status : 1;
  }
  const secs = ((Date.now() - start) / 1000).toFixed(1);
  return { name: name, ok: ok, code: code, secs: secs };
}

function main() {
  const results = [];
  console.log('==============================================================');
  console.log(' test:all runner  (scripts/run_all_tests.js)');
  console.log(' 共 ' + TEST_SUITES.length + ' 个子套件, 逐个执行, 失败不中断');
  console.log('==============================================================');

  for (const name of TEST_SUITES) {
    const r = runSuite(name);
    results.push(r);
    console.log((r.ok ? '  [PASS] ' : '  [FAIL] ') + name + '  (exit=' + r.code + ', ' + r.secs + 's)');
  }

  const passed = results.filter(r => r.ok).map(r => r.name);
  const failed = results.filter(r => !r.ok).map(r => r.name);

  console.log('--------------------------------------------------------------');
  console.log('汇总: 通过 ' + passed.length + ' / 失败 ' + failed.length + ' / 总计 ' + results.length);
  if (failed.length) {
    console.log('失败套件(' + failed.length + '):');
    failed.forEach(n => console.log('   - ' + n));
  }
  console.log('--------------------------------------------------------------');
  process.exit(failed.length ? 1 : 0);
}

// 仅直接运行时执行; 被 check_ci_coverage.js 引用时只导出 TEST_SUITES 清单。
if (require.main === module) {
  main();
}

module.exports = { TEST_SUITES };
