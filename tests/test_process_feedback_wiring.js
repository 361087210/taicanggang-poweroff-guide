/**
 * ============================================================
 * test_process_feedback_wiring.js — F0-c: AI 流水线接线 + AI 承载字段回写
 * ============================================================
 * 依据: docs/AI_FEEDBACK_LOOP_DESIGN.md §1.3 / §3.3 / §4(F1/F5)。
 *
 * 事故背景(本测试存在的理由):
 *   1) `scripts/process_feedback.js` 全用 `await fetch(`, 沙箱代理会篡改
 *      undici 请求导致飞书返回 1061002 params error -> 改 `https.request`。
 *   2) 脚本一直写旧终态「已解决」, 与组长端「已处理」并存两个终态 -> 统一「已修复」。
 *   3) **最致命**: 飞书 Bitable 新增了 4 个 AI 承载字段, 但流水线从来**没写**它们
 *      -> 表建好了、列全是空的, 闭环实际是断的。且飞书**写不存在的字段不报错、
 *      静默丢弃**, 所以必须"回写前校验字段存在, 缺失即点名报错"。
 *
 * 断言:
 *   A. 脚本不含裸 `await fetch(`(改用 https.request)
 *   B. 状态写入值 ∈ 内部 5 态, 且不含已废弃的「已解决」
 *   C. 4 个 AI 承载字段名都出现, 且每个都真的出现在**回写字段对象**里
 *   D. 字段存在性校验链路完整: listFields(GET /fields) + 缺失即**点名**的报错
 *   E. 主流程接线顺序: 取字段 -> 校验 -> 置「分析中」-> 置「已修复」+ 回写 4 字段 -> 通知
 *   F. 跨文件一致性: 与 js/10-feedback.js 的 FEEDBACK_STATUS / FEEDBACK_AI_FIELDS 不漂移
 *   G. CI 接线门禁: 本测试必须在 package.json 且并入 test:all(否则被 test:ci-coverage 拦)
 *
 * 运行: node tests/test_process_feedback_wiring.js
 * 要求: 先红后绿——F0-c 落地前 A/B/C/D 应失败(红), 落地后全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const SCRIPT = 'scripts/process_feedback.js';
const script = src(SCRIPT);

/* ============================================================
 * A. 裸 fetch 已消除(§3.3: 沙箱代理篡改 undici -> 飞书 1061002)
 * ============================================================ */
section('A. 裸 `await fetch(` 已消除(改用 https.request)');
check('A1 脚本不含裸 `await fetch(`', script.indexOf('await fetch(') < 0,
  '出现位置(行号): ' + script.split('\n').map((l, i) => (l.indexOf('await fetch(') >= 0 ? i + 1 : 0)).filter(Boolean).join(','));
check('A2 引入 https 模块', /require\(\s*['"]https['"]\s*\)/.test(script));
(function () {
  // 三个调用点(getToken / feishuRequest / DeepSeek) 都必须走 https 通道:
  // 判据 = 直接调用 _req 的次数 >= 3, 且不存在残留的 res.json() 读取(旧 fetch 写法)
  const callOcc = (script.match(/await\s+_req\(/g) || []).length;
  check('A3 三处调用点均改走 https 通道(`await _req(` >= 3 处)', callOcc >= 3, 'count=' + callOcc);
  check('A4 无残留 `res.json()` / `r.json()`(旧 fetch 响应读取写法)',
    !/\.json\(\)\s*;/.test(script));
  check('A5 沙箱约束注释保留(说明为何不用 fetch, 防后人改回)',
    script.indexOf('1061002') >= 0);
})();

/* ============================================================
 * B. 状态写入值 ∈ 内部 5 态(§1.2 / §3.3) —— 且旧终态「已解决」彻底消失
 * ============================================================ */
section('B. 状态写入值 ∈ 内部 5 态, 不含已废弃终态');
/* §3.3 第 138 行: 验收 `grep "已解决"` 必须为空 —— 所以本测试对脚本是**零容忍**:
 * 连注释/文案里都不许出现(旧字符串会被后人复制粘贴回代码, 一出现即红) */
check('B1 脚本任何位置均不含旧终态 `已解决`(含注释与文案, 验收要求 grep 为空)',
  script.indexOf('已解决') < 0,
  '出现行号: ' + script.split('\n').map((l, i) => (l.indexOf('已解决') >= 0 ? i + 1 : 0)).filter(Boolean).join(','));

const FIVE_STATES = ['待处理', '分析中', '修复中', '已修复', '修复失败'];
check('B2 定义 FEEDBACK_STATUS 冻结常量(单一真源, 勿散落字面量)',
  /const\s+FEEDBACK_STATUS\s*=\s*Object\.freeze\(\{/.test(script));
FIVE_STATES.forEach((v, i) => {
  check('B3.' + (i + 1) + " 5 态含 '" + v + "'", script.indexOf(v) >= 0);
});
check('B4 定义 FEEDBACK_STATUS_OPTIONS 5 态全集',
  /const\s+FEEDBACK_STATUS_OPTIONS\s*=\s*\[/.test(script));

/* 传给 updateRecord 的状态字面量必须都在 5 态内(不允许新的野值) */
(function () {
  const writes = [];
  const re = /['"]状态['"]\s*:\s*([^,\n}]+)/g;
  let m;
  while ((m = re.exec(script)) !== null) writes.push(m[1].trim());
  check('B5 能定位到「状态」写入点(至少 2 处: 分析中 / 终态)', writes.length >= 2, 'count=' + writes.length);

  const bad = writes.filter((w) => {
    const lits = w.match(/['"][^'"]*['"]/g) || [];
    return lits.some((l) => {
      const val = l.slice(1, -1);
      if (FIVE_STATES.indexOf(val) >= 0) return false;   // 合法字面量
      return !/^FEEDBACK_STATUS\.(PENDING|ANALYZING|FIXING|FIXED|FAILED)$/.test(w) && lits.length === 1;
    });
  });
  check('B6 所有「状态」写入值 ∈ 内部 5 态(无野值)',
    bad.length === 0 && writes.every((w) =>
      FIVE_STATES.some((s) => w.indexOf("'" + s + "'") >= 0 || w.indexOf('"' + s + '"') >= 0) ||
      /FEEDBACK_STATUS\./.test(w)),
    '写入值: ' + writes.join(' | '));
  check('B7 终态写入为 FEEDBACK_STATUS.FIXED / 或常量引用(非裸字面量)',
    /['"]状态['"]\s*:\s*FEEDBACK_STATUS\.FIXED/.test(script) || /['"]状态['"]\s*:\s*['"]已修复['"]/.test(script));
  check("B8 通知状态参数用同一常量(notify 第 4 参不再硬编码终态字面量)",
    /notify\([^)]*FEEDBACK_STATUS\.FIXED/.test(script));
})();

/* ============================================================
 * C. 4 个 AI 承载字段(§1.3 B0): 名必出现, 且必须真的被回写
 * ============================================================ */
section('C. 4 个 AI 承载字段名出现且真的被回写');
const AI_FIELDS = ['AI定位报告', '修复PR链接', '门禁结果', '尝试次数'];
check('C1 定义 FEEDBACK_AI_FIELDS 常量(4 字段集中定义)',
  /const\s+FEEDBACK_AI_FIELDS\s*=\s*\[/.test(script));
AI_FIELDS.forEach((v, i) => {
  check('C2.' + (i + 1) + " 字段名 '" + v + "' 出现", script.indexOf(v) >= 0);
});

/* 关键: 字段名出现在「回写字段对象」的键位上(而不只是常量数组里) */
(function () {
  const missingWrite = AI_FIELDS.filter((f) => {
    const re = new RegExp("['\"]" + f + "['\"]\\s*:");
    return !re.test(script);
  });
  check('C3 4 字段均作为回写字段对象的键出现(不写 = 列永远是空的)',
    missingWrite.length === 0, '未回写: ' + missingWrite.join(','));
  // 明令: 本批无 PR / 无门禁结果 -> 必须写空字符串, 绝不编造
  const fakeLink = /['"]修复PR链接['"]\s*:\s*['"][^'"]*https?:/i.test(script);
  check('C4 「修复PR链接」本批不编造假链接(写空字符串, 非 http(s) URL)', !fakeLink);
  check("C5 「修复PR链接」写入值为空字符串",
    /['"]修复PR链接['"]\s*:\s*['"]{2}/.test(script));
  check("C6 「门禁结果」写入值为空字符串(本批无门禁跑)",
    /['"]门禁结果['"]\s*:\s*['"]{2}/.test(script));
  check('C7 「尝试次数」写入首次尝试值 1(§4 F5 幂等键, 上限 N=2)',
    /['"]尝试次数['"]\s*:\s*1\b/.test(script));
  check('C8 定义 MAX_ATTEMPTS = 2(幂等上限常量, 不散落字面量)',
    /const\s+MAX_ATTEMPTS\s*=\s*2\b/.test(script));
  check('C9 「AI定位报告」写入内容非空(取 AI 分析产出, 非占位空串)',
    /['"]AI定位报告['"]\s*:\s*(?!['"]{2})/.test(script));
})();

/* ============================================================
 * D. 字段存在性校验(§1.3) —— 本任务核心价值: 缺失必须点名报错, 绝不静默
 * ============================================================ */
section('D. 字段存在性校验: listFields + 缺失即点名报错');
check('D1 定义 listFields(token) 拉取真实字段名',
  /async\s+function\s+listFields\s*\(\s*token\s*\)/.test(script));
check('D2 listFields 调 GET .../fields 接口',
  /\/bitable\/v1\/apps\/\$\{BASE_APP_TOKEN\}\/tables\/\$\{FEEDBACK_TABLE_ID\}\/fields/.test(script));
check('D3 listFields 取 field_name 作为字段名(非 field_id)',
  /field_name/.test(script));
check('D4 定义纯函数 checkFields(返回 {ok, missing})',
  /function\s+checkFields\s*\(/.test(script));
check('D5 定义断言版 assertFields(缺字段即抛错)',
  /function\s+assertFields\s*\(/.test(script));
check("D6 抛错带 .code='FEEDBACK_FIELD_MISSING'(可被上层分类捕获)",
  /\.code\s*=\s*['"]FEEDBACK_FIELD_MISSING['"]/.test(script));
check('D7 错误信息**点名**缺失字段(join 到 message 里, 不是只抛一个泛化错误)',
  /missing\.map\(/.test(script) && /反馈表缺少字段/.test(script));
check('D8 目标字段集合 REQUIRED_FIELDS 由常量拼装(含 4 个 AI 字段)',
  /const\s+REQUIRED_FIELDS\s*=/.test(script) && /concat\(FEEDBACK_AI_FIELDS\)/.test(script));

/* 必须逐字包含 7 个目标字段(4 个新字段 + 3 个既有) */
(function () {
  const REQUIRED = ['状态', 'AI分析摘要', '技术文档链接'].concat(AI_FIELDS);
  const miss = REQUIRED.filter((f) => !new RegExp("['\"]" + f + "['\"]").test(script));
  check('D9 REQUIRED_FIELDS 覆盖 7 个目标字段(3 既有 + 4 新增)',
    miss.length === 0, '缺: ' + miss.join(','));
})();

/* ============================================================
 * E. 主流程接线: 取字段 -> 校验 -> 分析中 -> 已修复 + 回写 4 字段 -> 通知
 * ============================================================ */
section('E. 主流程接线顺序与降级语义');
(function () {
  const p = (needle) => script.indexOf(needle);
  const iListFields = p('await listFields(token)');
  const iAssertBatch = p('assertFields(fieldNames, REQUIRED_FIELDS)');
  const iLoop = p('for (const rec of pending)');
  const iAnalyzing = script.indexOf('FEEDBACK_STATUS.ANALYZING', iLoop);
  /* 循环内的终态写入点(带 JSON 键, 区别于上面常量定义里的同名出现) */
  const iFixed = p("'状态': FEEDBACK_STATUS.FIXED");
  const iNotify = p('await notify(token, feedbackId, category, FEEDBACK_STATUS.FIXED');

  check('E1 批次内只取一次字段清单(listFields 在循环外)', iListFields >= 0 && iListFields < iLoop,
    'listFields@' + iListFields + ' loop@' + iLoop);
  check('E2 回写前先做批次校验(assertFields 在循环外, 省配额)', iAssertBatch >= 0 && iAssertBatch < iLoop);
  check('E3 置「分析中」在终态之前', iAnalyzing >= 0 && iFixed >= 0 && iAnalyzing < iFixed,
    'analyzing@' + iAnalyzing + ' fixed@' + iFixed);
  check('E4 终态「已修复」回写出现在循环内', iFixed > iLoop, 'loop@' + iLoop + ' fixed@' + iFixed);
  check('E5 终态回写后再推飞书通知', iNotify > iFixed);
  check('E6 记录级 try/catch 包裹(单条失败不拖垮整批)',
    /try\s*\{[\s\S]*?FEEDBACK_STATUS\.ANALYZING[\s\S]*?\}\s*catch\s*\(e\)/.test(script));
  check('E7 缺字段错误被单独分类处理(按 .code 判别)',
    /e\.code\s*===\s*['"]FEEDBACK_FIELD_MISSING['"]/.test(script));
  check('E8 批次校验失败即显式报错并 exit 1(让 CI 变红, 不静默跳过)',
    /assertFields\(fieldNames, REQUIRED_FIELDS\)[\s\S]{0,900}?process\.exit\(1\)/.test(script));
  check('E9 全部记录均因缺字段失败时 exit 1(部分失败只告警, 不拖垮流水线)',
    /fieldFailed\s*===\s*pending\.length[\s\S]{0,200}?process\.exit\(1\)/.test(script));
  check('E10 无凭据时优雅退出(exit 0, 不误报失败)',
    /缺少 FEISHU_APP_ID \/ FEISHU_APP_SECRET/.test(script) && /process\.exit\(0\)/.test(script));
})();

/* ============================================================
 * F. 跨文件一致性: 脚本常量 vs js/10-feedback.js(F0-b) —— 防两处真源漂移
 * ============================================================ */
section('F. 跨文件一致性(脚本常量 vs js/10-feedback.js)');
(function () {
  let feedbackJs = '';
  try { feedbackJs = src('js/10-feedback.js'); } catch (e) { /* 下面断言会红 */ }
  check('F1 客户端 F0-b 已定义 FEEDBACK_STATUS_OPTIONS', /FEEDBACK_STATUS_OPTIONS/.test(feedbackJs));
  check('F2 客户端 F0-b 已定义 FEEDBACK_AI_FIELDS', /FEEDBACK_AI_FIELDS/.test(feedbackJs));
  AI_FIELDS.forEach((v, i) => {
    check('F3.' + (i + 1) + " 客户端同名字段 '" + v + "'", feedbackJs.indexOf(v) >= 0);
  });
  // 5 态字面量集合双向一致
  const missInClient = FIVE_STATES.filter((v) => feedbackJs.indexOf(v) < 0);
  check('F4 5 态在客户端齐备(两端枚举不漂移)', missInClient.length === 0, '客户端缺: ' + missInClient.join(','));
  check("F5 两端均不含旧终态 '已解决' 作为**写入值**",
    feedbackJs.indexOf("'已解决'") < 0 || /LEGACY_STATUS_MAP/.test(feedbackJs));
})();

/* ============================================================
 * G. CI 接线门禁(未入 test:all 会被 scripts/check_ci_coverage.js 拦)
 * ============================================================ */
section('G. CI 接线门禁');
let PKG = {};
try { PKG = JSON.parse(src('package.json')); } catch (e) { /* 下面断言会红 */ }
check('G1 package.json 有 test:process-feedback', !!(PKG.scripts && PKG.scripts['test:process-feedback']));
check('G2 test:all 含 test:process-feedback',
  String((PKG.scripts && PKG.scripts['test:all']) || '').indexOf('test:process-feedback') >= 0);
check('G3 test:process-feedback 指向本文件',
  String((PKG.scripts && PKG.scripts['test:process-feedback']) || '').indexOf('test_process_feedback_wiring.js') >= 0);

console.log('\n==============================================================');
console.log('F0-c AI 流水线接线 + AI 承载字段回写 测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
