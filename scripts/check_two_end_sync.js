#!/usr/bin/env node
/* =============================================================================
 * scripts/check_two_end_sync.js — 「两端错配」防复发门禁
 * =============================================================================
 * 拦截的系统性根因(本次线上故障)：
 *   网页端跟 `main` **自动更新**，App 只跟 **tag** 更新 →
 *   代码进了 main 却**没升版本号/没打 tag** ⇒ App 与网页端**静默错配**。
 *
 * 判定(架构师 spec)：
 *   TAG   = 语义化最新 tag (`git tag -l 'v*' --sort=-v:refname` 首行)
 *   无 TAG → exit 2 (skip, 防浅克隆/首次误报)
 *   base  = merge-base(TAG, HEAD)
 *   diff  = git diff --name-only base..HEAD -- <SHARED_CODE_PATHS>
 *   diff 空 → exit 0
 *   mainVer = version.json@HEAD ; tagVer = version.json@TAG
 *   mainVer == tagVer → **FAIL(1)**：共享代码改了但版本未提升(= 未发布变更堆积)
 *   否则            → **WARN(0)**：发布窗口内"先 bump 后打 tag"的瞬态, 不阻断
 *   ref ≠ main      → 一律**降级 WARN**(PR/特性分支不该因此变红)
 *
 * ★ 本文件属**敏感面**(门禁本身, AI 不得改门禁): 由人编写维护。
 *
 * 用法: node scripts/check_two_end_sync.js [--repo <dir>] [--tag vX] [--ref <name>] [--json] [--record]
 *   --record  人工确认后**手动**记录"已观察 1 个发布周期"(写入状态文件, 需人工提交)
 *             —— 告警→FAIL 的切换**不自动发生**, 必须人工确认。
 * =============================================================================
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXIT_PASS = 0;
const EXIT_FAIL = 1;
const EXIT_SKIP = 2;

/* ---------------------------------------------------------------------------
 * SHARED_CODE_PATHS —— 「两端都发、且改动会改变运行契约」的路径。
 * 为什么算"代码/数据"：App(内嵌 www) 与 网页(Pages) **同源加载**这些文件,
 * 任何改动都可能让两端行为分叉 ⇒ 改动**必须**伴随版本号提升(并打 tag)。
 * --------------------------------------------------------------------------- */
const SHARED_CODE_PATHS = [
  'js',            /* 两端同源业务代码: App 内嵌 + 网页加载 → 改了就是改了运行契约 */
  'demo.html',     /* 两端共同入口(App 的 www 页由它生成) */
  'feishu-api.js', /* 两端共用的飞书数据层 */
  'css',           /* 两端共用样式(渲染契约) */
  'vendor'         /* 两端共用第三方库(行为/版本契约) */
];

/* ---------------------------------------------------------------------------
 * 明确**排除**(纳入会把门禁变成噪音工厂):
 *   vehicles_data.js    —— **cron 每 15 分钟重写**; 且两端都能经云端/镜像收敛数据 → 纳入必红
 *   web-data/**         —— 仅网页镜像(cron 产物)
 *   docs/**             —— 文档
 *   vehicle_images/**   —— 媒体资产(cron/人工同步)
 *   index.html / manifest.json / sw.js —— **仅网页**入口/清单/缓存, 不构成两端契约
 *   scripts/**  .github/**  tests/**  package.json  config.xml  version.json —— 构建/测试/元数据
 *   icon-*              —— 图标
 * (此列表**只在文档里维护**, 不参与匹配; 匹配靠 SHARED_CODE_PATHS 白名单。)
 * --------------------------------------------------------------------------- */

const STATE_FILE = path.join('.ci', 'two_end_gate_state.json');

/* ---------------- 三段自解释告警(硬要求: 藏在日志里的告警等于没报) ---------------- */
function warnText(extra) {
  return [
    '①【当前未阻断】本告警**当前不会让本次 CI 变红**。',
    '②【何时转 FAIL】将于**第 2 次发布之后**转为 FAIL(切换需**人工确认**, 不自动发生)。',
    '③【现在该做什么】要么**升版本号并打 tag**(把已进 main 的改动正式发布), ' +
      '要么**确认属预期的发布堆积**(在下一步发布里一并处理)。' + (extra ? ' ' + extra : '')
  ].join('\n');
}

function emitWarning(line) {
  /* GitHub Actions 注解(会在 PR/Job 上显式高亮); 非 Actions 环境退化为普通输出。
   * ★ 为什么用注解: 藏在日志里的告警等于没报。 */
  console.log('::warning::' + String(line).replace(/\n/g, '%0A'));
  console.log(line);
}
function emitError(line) {
  /* FAIL 用 ::error:: —— 与 WARN 的 ::warning:: 区分, 避免"红/黄"被混为一谈 */
  console.log('::error::' + String(line).replace(/\n/g, '%0A'));
  console.log(line);
}

function parseArgs(argv) {
  const o = { repo: process.cwd(), json: false, record: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') o.repo = argv[++i];
    else if (a === '--tag') o.tag = argv[++i];
    else if (a === '--ref') o.ref = argv[++i];
    else if (a === '--json') o.json = true;
    else if (a === '--record') o.record = true;
  }
  return o;
}

function git(repo, args) {
  return execFileSync('git', args, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function gitOk(repo, args) {
  try { git(repo, args); return true; } catch (e) { return false; }
}
function readVersion(repo, ref) {
  try {
    const txt = git(repo, ['show', ref + ':version.json']);
    const j = JSON.parse(txt);
    return j && j.version ? String(j.version) : null;
  } catch (e) { return null; }
}
function readState(repo) {
  try { return JSON.parse(fs.readFileSync(path.join(repo, STATE_FILE), 'utf8')); }
  catch (e) { return { observedWarnCycles: 0, switchConfirmed: false }; }
}

function finish(result, code, args) {
  if (args.json) console.log('__RESULT__' + JSON.stringify(result));
  process.exit(code);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const repo = args.repo;
  const result = { exitCode: null, level: 'PASS', reason: '', tag: null, base: null, changedFiles: [], mainVer: null, tagVer: null, ref: null };

  if (!gitOk(repo, ['rev-parse', '--git-dir'])) {
    result.reason = 'not_a_git_repo';
    finish(result, EXIT_SKIP, args);
  }

  /* 当前 ref(非 main 一律降级 WARN) */
  let ref = args.ref;
  if (!ref) { try { ref = git(repo, ['rev-parse', '--abbrev-ref', 'HEAD']); } catch (e) { ref = 'HEAD'; } }
  result.ref = ref;

  /* 语义化最新 TAG */
  let tag = args.tag;
  if (!tag) {
    let list = '';
    try { list = git(repo, ['tag', '-l', 'v*', '--sort=-v:refname']); } catch (e) { list = ''; }
    tag = list.split('\n').map((s) => s.trim()).filter(Boolean)[0] || '';
  }
  if (!tag) {
    result.reason = 'no_tag_found(shallow clone? or first release)';
    finish(result, EXIT_SKIP, args);   /* exit 2 = 跳过, 防浅克隆误报 */
  }
  result.tag = tag;

  let base = '';
  try { base = git(repo, ['merge-base', tag, 'HEAD']); } catch (e) {
    result.reason = 'merge_base_failed:' + tag;
    finish(result, EXIT_SKIP, args);
  }
  result.base = base;

  /* 共享代码是否改动 */
  let changed = [];
  try {
    const out = git(repo, ['diff', '--name-only', base + '..HEAD', '--'].concat(SHARED_CODE_PATHS));
    changed = out.split('\n').map((s) => s.trim()).filter(Boolean);
  } catch (e) { changed = []; }
  result.changedFiles = changed;

  if (changed.length === 0) {
    result.reason = 'no_shared_code_change_since_' + tag;
    finish(result, EXIT_PASS, args);
  }

  const mainVer = readVersion(repo, 'HEAD');
  const tagVer = readVersion(repo, tag);
  result.mainVer = mainVer;
  result.tagVer = tagVer;

  if (!mainVer || !tagVer) {
    result.level = 'WARN';
    result.reason = 'version_read_failed(HEAD=' + mainVer + ', ' + tag + '=' + tagVer + ')';
    emitWarning('[两端错配门禁] 无法读取 version.json, 无法判定(降级为告警): HEAD=' + mainVer + ' / ' + tag + '=' + tagVer + '\n' + warnText());
    finish(result, EXIT_PASS, args);
  }

  const filesBrief = changed.slice(0, 8).join(', ') + (changed.length > 8 ? ' …(共 ' + changed.length + ' 个)' : '');
  const notMain = ref !== 'main';

  if (mainVer === tagVer) {
    /* 共享代码改了、版本号没升/没打 tag ⇒ 未发布变更堆积 */
    if (notMain) {
      result.level = 'WARN';
      result.reason = 'unpublished_change_stack(ref=' + ref + '≠main → 降级)';
      emitWarning('[两端错配门禁] 检测到**未发布的共享代码改动**(ref=' + ref + ' ≠ main, 已降级为告警): ' +
        'base(' + tag + ')..HEAD 改了 ' + changed.length + ' 个两端共享文件(' + filesBrief + '), ' +
        '而 version.json 与 ' + tag + ' 相同(' + mainVer + ')。\n' + warnText());
      finish(result, EXIT_PASS, args);
    }
    const st = readState(repo);
    result.level = 'FAIL';
    result.reason = 'unpublished_change_stack';
    const msg = '[两端错配门禁] **FAIL**: `main` 上有**已进主干但未发布**的共享代码改动 —— ' +
      '这是"网页端自动更新 / App 只跟 tag"导致的**静默错配**根因。\n' +
      '  · 对比基准: tag `' + tag + '` (base ' + base.slice(0, 8) + ')\n' +
      '  · 改动文件(' + changed.length + '): ' + filesBrief + '\n' +
      '  · version.json: HEAD=`' + mainVer + '` **等于** ' + tag + '=`' + tagVer + '`(未升版)\n' +
      '  · 已观察告警周期数: ' + (st.observedWarnCycles || 0) + ' / 切换已确认: ' + (st.switchConfirmed ? '是' : '否') + '\n' +
      '  ⇒ 请**升版本号并打 tag**, 或确认属预期堆积(见下方三步)。\n' + warnText();
    process.stderr.write(msg + '\n');
    emitError(msg);              /* ★ FAIL 用 ::error:: 注解(可见性), 不是普通日志 */
    finish(result, EXIT_FAIL, args);
  }

  /* 版本已升(发布窗口内的瞬态) → WARN, 不阻断 */
  result.level = 'WARN';
  result.reason = 'version_bumped_pending_tag';
  const st2 = readState(repo);
  emitWarning('[两端错配门禁] 共享代码已改、版本号已升(**发布窗口内瞬态**): HEAD=`' + mainVer + '` ≠ ' +
    tag + '=`' + tagVer + '` → 预期很快会打 tag。\n  · 改动文件(' + changed.length + '): ' + filesBrief + '\n' +
    '  · 已观察告警周期数: ' + (st2.observedWarnCycles || 0) + ' / 切换已确认: ' + (st2.switchConfirmed ? '是' : '否') + '\n' +
    warnText('当前版本尚未打 tag, 记得在发布时补 tag。'));
  finish(result, EXIT_PASS, args);
}

/* --record: 人工确认后手动记录"已观察 1 个发布周期"(需人工提交该状态文件) */
if (process.argv.indexOf('--record') >= 0) {
  const args = parseArgs(process.argv.slice(2));
  const p = path.join(args.repo, STATE_FILE);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const st = readState(args.repo);
  st.observedWarnCycles = (st.observedWarnCycles || 0) + 1;
  fs.writeFileSync(p, JSON.stringify(st, null, 2) + '\n');
  console.log('[两端错配门禁] 已记录: observedWarnCycles=' + st.observedWarnCycles + ' (需人工提交 ' + STATE_FILE + ')');
  process.exit(0);
}

main();
