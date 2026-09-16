/**
 * ============================================================
 * test_feedback_status_enum.js — F0-b: 反馈状态枚举对齐(内部 5 态 + 用户 3 桶)
 * ============================================================
 * 依据: docs/AI_FEEDBACK_LOOP_DESIGN.md §1.2 / §1.3 / §3.2(第 129 行那几条断言)。
 *
 * 定案(§1.2):
 *   内部 5 态: 待处理 / 分析中 / 修复中 / 已修复 / 修复失败
 *   用户 3 桶: 待处理(含 分析中) / 修复中 / 已处理(含 已修复)
 *   '修复失败' 字样**仅组长(role==='admin')可见**; 组员折入 '已处理' 桶。
 *
 * 断言:
 *   A. 静态(源码) ——
 *     A1 不再含旧降级 `if (s === '分析中') return '待处理';`(分析中不再被吞)
 *     A2 存在 `_uiBucket`(内部态 → 用户桶)
 *     A3 `'修复失败'` 作为**标签字面量**仅在 `_uiBucket` 的 leader 真分支出现(全仓唯一渲染点)
 *     A4 `已解决/已处理` 经 LEADACY 归一映射到同一终态(单一真源 LEGACY_STATUS_MAP)
 *     A5 单一真源常量: FEEDBACK_STATUS(5 态)/FEEDBACK_STATUS_OPTIONS/LEGACY_STATUS_MAP/FEEDBACK_AI_FIELDS(4 字段)
 *     A6 回写前字段存在性校验机制: checkFeedbackFields / assertFeedbackFields(缺字段抛 .code)
 *   B. 行为级(vm 提取纯函数) ——
 *     B1 _normStatus: 历史/别名归一 + 分析中原样 + 兜底
 *     B2 _uiBucket: 5 态 × 组长/组员 → 3 桶(含 修复失败 只组长可见)
 *     B3 assertFeedbackFields: 缺字段**抛错**(带 code), 不缺返回 true
 *   C. 接线门禁 —— 本测试必须可达(package.json + test:all)。
 *
 * 运行: node tests/test_feedback_status_enum.js
 * 要求: 先红后绿——F0-b 落地前 A1/A2/A3 应失败(红), 落地后全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if(cond){ pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }
function occ(str, sub){ let n = 0, i = 0; while((i = str.indexOf(sub, i)) >= 0){ n++; i += sub.length; } return n; }

const feedbackJs = src('js/10-feedback.js');

/* ============================================================
 * A. 静态(源码)检查 —— §3.2 第 129 行四条 + §1.3 支撑
 * ============================================================ */
section('A1 旧降级逻辑已消除(分析中 不再被吞)');
check("A1a 源文件不含 `if (s === '分析中') return '待处理';`",
  feedbackJs.indexOf("if (s === '分析中') return '待处理';") < 0);
check("A1b 源文件不含旧映射 `if (s === '已解决') return '已处理';`",
  feedbackJs.indexOf("if (s === '已解决') return '已处理';") < 0);
check("A1c _normStatus 内 `分析中` 不再被显式降级(无 '分析中'→'待处理' 字面配对)",
  !/分析中['"]\s*\)\s*return\s*['"]待处理/.test(feedbackJs));

section('A2 _uiBucket(内部态 → 用户桶)存在');
check('A2a 定义 function _uiBucket',
  /function\s+_uiBucket\s*\(/.test(feedbackJs));
check('A2b 接受 (status, isLeader) 两参',
  /function\s+_uiBucket\s*\(\s*status\s*,\s*isLeader\s*\)/.test(feedbackJs));

section("A3 '修复失败' 标签仅在 leader 分支(全仓唯一渲染点)");
(function(){
  const eb = require('./e2e_harness').extractNamedBlock;
  let block = '';
  try { block = eb(feedbackJs, '_uiBucket'); } catch(e){ block = ''; }
  check('A3a 成功提取 _uiBucket 块(块可独立提取)', block.length > 0);
  // 标签字面量形态: `label: '修复失败'`(单/双引号), 排除注释与常量定义(常量是 `FAILED: '修复失败'`)
  const labelOcc = occ(block, "label: '修复失败'") + occ(block, 'label: "修复失败"');
  check("A3b _uiBucket 内 `label: '修复失败'` 恰好 1 处", labelOcc === 1, 'count=' + labelOcc);
  check('A3c 该分支受 isLeader 三元条件包裹(leader ? {label:修复失败} : …)',
    /isLeader\s*\?\s*\{[^}]*label:\s*['"]修复失败['"]/.test(block));
  check("A3d 非 leader 分支对 FAILED 返回 '已处理'(组员不见修复失败字样)",
    /:\s*\{\s*label:\s*['"]已处理['"]/.test(block));
})();

section('A4 历史/别名归一(已解决/已处理 → 单一终态, 单一真源)');
check('A4a 定义 LEGACY_STATUS_MAP 常量(集中定义, 非散落字面量)',
  /const\s+LEGACY_STATUS_MAP\s*=/.test(feedbackJs));
check("A4b LEGACY_STATUS_MAP 含 '已解决' → FEEDBACK_STATUS.FIXED",
  /['"]已解决['"]\s*:\s*FEEDBACK_STATUS\.FIXED/.test(feedbackJs));
check("A4c LEGACY_STATUS_MAP 含 '已处理' → FEEDBACK_STATUS.FIXED",
  /['"]已处理['"]\s*:\s*FEEDBACK_STATUS\.FIXED/.test(feedbackJs));
check('A4d _normStatus 优先查 LEGACY_STATUS_MAP(命中即归一)',
  /function\s+_normStatus[\s\S]{0,300}LEGACY_STATUS_MAP\[s\]/.test(feedbackJs));

section('A5 单一真源常量(§1.3: 状态值与字段名集中定义)');
check('A5a FEEDBACK_STATUS 冻结对象(唯一真源)',
  /const\s+FEEDBACK_STATUS\s*=\s*Object\.freeze\(\{/.test(feedbackJs));
['待处理','分析中','修复中','已修复','修复失败'].forEach(function(v, idx){
  check('A5b.' + (idx + 1) + " 5 态含 '" + v + "'", feedbackJs.indexOf(v) >= 0);
});
check('A5c FEEDBACK_STATUS_OPTIONS 5 态全集(顺序即飞书选项顺序)',
  /const\s+FEEDBACK_STATUS_OPTIONS\s*=\s*\[/.test(feedbackJs) &&
  /FEEDBACK_STATUS_OPTIONS[\s\S]{0,200}FEEDBACK_STATUS\.FAILED/.test(feedbackJs));
check('A5d FEEDBACK_AI_FIELDS 常量存在(AI 承载字段同批建)',
  /const\s+FEEDBACK_AI_FIELDS\s*=\s*\[/.test(feedbackJs));
['AI定位报告','修复PR链接','门禁结果','尝试次数'].forEach(function(v, idx){
  check('A5e.' + (idx + 1) + " 4 字段含 '" + v + "'", feedbackJs.indexOf(v) >= 0);
});

section('A6 回写前字段存在性校验(§1.3: 缺字段即报错, 防静默丢弃)');
check('A6a 定义 checkFeedbackFields(纯函数, 返回 {ok,missing})',
  /function\s+checkFeedbackFields\s*\(/.test(feedbackJs));
check('A6b 定义 assertFeedbackFields(缺字段抛错)',
  /function\s+assertFeedbackFields\s*\(/.test(feedbackJs));
check("A6c assertFeedbackFields 抛错带 .code='FEEDBACK_FIELD_MISSING'",
  /\.code\s*=\s*['"]FEEDBACK_FIELD_MISSING['"]/.test(feedbackJs));

/* ============================================================
 * B. 行为级(vm 提取纯函数) —— 真正验证语义, 不只是源码包含
 * ============================================================ */
section('B. 行为级(vm): 提取纯函数并按语义断言');
let SB = null;
(function(){
  let vm;
  try { vm = require('vm'); } catch(e){ vm = null; }
  if(!vm){ check('B0 vm 可用', false, 'require("vm") 失败'); return; }
  const { extractNamedBlock } = require('./e2e_harness');
  const names = [
    'FEEDBACK_STATUS', 'FEEDBACK_STATUS_OPTIONS', 'LEGACY_STATUS_MAP', 'FEEDBACK_AI_FIELDS',
    '_flat', '_normStatus', '_uiBucket', 'checkFeedbackFields', 'assertFeedbackFields',
  ];
  let blocks = '';
  try {
    blocks = names.map(function(n){ return extractNamedBlock(feedbackJs, n); }).join('\n');
  } catch(e){
    check('B0 纯函数块全部可独立提取', false, e.message);
    return;
  }
  check('B0 纯函数块全部可独立提取', blocks.length > 0);
  const sb = {};
  vm.createContext(sb);
  vm.runInContext(blocks, sb, { filename: 'feedback-status-enum.js' });
  // 顶层 `const` 只进 context 的词法环境, 不挂到 context 对象(仅 function 声明会) → 经 runInContext 取值
  sb.__eval = function(expr){ return vm.runInContext(expr, sb); };
  SB = sb;
})();

if(SB){
  const ns = SB._normStatus, ub = SB._uiBucket;
  const S = SB.__eval('FEEDBACK_STATUS');

  section('B1 _normStatus: 历史/别名归一 + 分析中原样 + 兜底');
  check("B1a '已解决'(脚本旧值) → '已修复'", ns('已解决') === '已修复', ns('已解决'));
  check("B1b '已处理'(组长旧值) → '已修复'", ns('已处理') === '已修复', ns('已处理'));
  check("B1c '分析中' 原样保留(不再降级为 待处理)", ns('分析中') === '分析中', ns('分析中'));
  check("B1d '修复中' 原样", ns('修复中') === '修复中', ns('修复中'));
  check("B1e '修复失败' 原样", ns('修复失败') === '修复失败', ns('修复失败'));
  check("B1f '待处理' 原样", ns('待处理') === '待处理', ns('待处理'));
  check("B1g 空串 → '待处理'(兜底)", ns('') === '待处理', JSON.stringify(ns('')));
  check("B1h undefined → '待处理'(兜底)", ns(undefined) === '待处理', String(ns(undefined)));
  check("B1i 单元素数组 ['待处理'] 展平 → '待处理'(Bitable 单选数组通吃)", ns(['待处理']) === '待处理', JSON.stringify(ns(['待处理'])));
  check("B1j 未知值 'foo' 原样透传(不误吞)", ns('foo') === 'foo', ns('foo'));

  section('B2 _uiBucket: 5 态 × 组长/组员 → 3 桶');
  check("B2a '已修复' → 桶 '已处理'", ub('已修复', false).label === '已处理', ub('已修复', false).label);
  check("B2b '已处理'(历史) → 桶 '已处理'(④ 折进同一桶)", ub('已处理', false).label === '已处理', ub('已处理', false).label);
  check("B2c '已解决'(历史) → 桶 '已处理'(④ 折进同一桶)", ub('已解决', false).label === '已处理', ub('已解决', false).label);
  check("B2d '修复中' → 桶 '修复中'", ub('修复中', false).label === '修复中', ub('修复中', false).label);
  check("B2e '待处理' → 桶 '待处理'", ub('待处理', false).label === '待处理', ub('待处理', false).label);
  check("B2f '分析中' → 桶 '待处理'(分析中并入待处理桶)", ub('分析中', false).label === '待处理', ub('分析中', false).label);
  check("B2g '修复失败' + 组长 → 桶 '修复失败'(③ 组长可见)", ub('修复失败', true).label === '修复失败', ub('修复失败', true).label);
  check("B2h '修复失败' + 组员 → 桶 '已处理'(③ 组员不可见)", ub('修复失败', false).label === '已处理', ub('修复失败', false).label);
  check('B2i 桶返回带 color(渲染色带)', !!(ub('待处理', false).color && ub('修复中', false).color && ub('已修复', false).color));
  check('B2j 组员 3 桶全集恰为 {待处理,修复中,已处理}',
    (function(){
      const seen = {};
      ['待处理','分析中','修复中','已修复','修复失败'].forEach(function(s){ seen[ub(s, false).label] = 1; });
      const keys = Object.keys(seen).sort().join(',');
      return keys === ['已处理','修复中','待处理'].sort().join(',');
    })());
  check('B2k 组长额外可见 修复失败(第 4 种字样)',
    ub('修复失败', true).label === '修复失败' && ub('待处理', true).label === '待处理');
  check('B2l FEEDBACK_STATUS 五态齐备', S.PENDING === '待处理' && S.ANALYZING === '分析中' &&
    S.FIXING === '修复中' && S.FIXED === '已修复' && S.FAILED === '修复失败');

  section('B3 字段存在性校验: 缺字段抛错(带 code)');
  const ALL = ['反馈ID','问题板块','问题描述','状态','AI定位报告','修复PR链接','门禁结果','尝试次数','提交人','平台'];
  const r1 = SB.checkFeedbackFields(ALL, ['AI定位报告','门禁结果']);
  check('B3a 全齐 → {ok:true, missing:[]}', r1.ok === true && r1.missing.length === 0, JSON.stringify(r1));
  const r2 = SB.checkFeedbackFields(['反馈ID','状态'], ['AI定位报告','门禁结果']);
  check("B3b 缺 2 字段 → ok:false 且点名 missing", r2.ok === false && r2.missing.join(',') === 'AI定位报告,门禁结果', JSON.stringify(r2));
  const r3 = SB.checkFeedbackFields(null, ['AI定位报告']);
  check('B3c 非数组输入(undefined/null)按空表处理 → 全部 missing', r3.ok === false && r3.missing.length === 1, JSON.stringify(r3));
  let okRet = null, threw = null;
  try { okRet = SB.assertFeedbackFields(ALL, ['AI定位报告','修复PR链接','门禁结果','尝试次数']); }
  catch(e){ threw = e; }
  check('B3d assertFeedbackFields 全齐 → 返回 true', okRet === true && threw === null, threw && threw.message);
  let err = null;
  try { SB.assertFeedbackFields(['反馈ID'], ['AI定位报告','门禁结果']); }
  catch(e){ err = e; }
  check('B3e assertFeedbackFields 缺字段 → 抛错', !!err);
  check("B3f 抛错 .code === 'FEEDBACK_FIELD_MISSING'", !!err && err.code === 'FEEDBACK_FIELD_MISSING', err && err.code);
  check('B3g 错误信息点名缺失字段(可观测)', !!err && err.message.indexOf('AI定位报告') >= 0 && err.message.indexOf('门禁结果') >= 0,
    err && err.message.slice(0, 80));
}

/* ============================================================
 * C. 接线门禁(本测试必须可达)
 * ============================================================ */
section('C. 接线门禁');
let PKG = {};
try { PKG = JSON.parse(src('package.json')); } catch(e){ /* 下面断言会红 */ }
check('C1 package.json 有 test:feedback-status', !!(PKG.scripts && PKG.scripts['test:feedback-status']));
check('C2 test:all 经 run_all_tests 闭包可达 test:feedback-status(否则被 test:ci-coverage 拦)',
  require('../scripts/run_all_tests.js').TEST_SUITES.indexOf('test:feedback-status') >= 0);
check('C3 test:feedback-status 指向本文件',
  String((PKG.scripts && PKG.scripts['test:feedback-status']) || '').indexOf('test_feedback_status_enum.js') >= 0);

console.log('\n==============================================================');
console.log('F0-b 反馈状态枚举对齐 测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
