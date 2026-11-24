/**
 * ============================================================
 * test_v10272_ci_pr_secrets.js — 「没有密钥」不该让 CI 失败 (V10.27.2)
 * ============================================================
 * 现象（真实故障，2026-11 实测）：dependabot 的 6 个依赖升级 PR 全红，
 * CI 第 38 步「Secret注入基线校验」失败 —— 因为该步只在
 * `github.event.pull_request.head.repo.fork == true` 时降级，而 dependabot
 * 的 PR 来自**同仓库分支**不是 fork，拿不到 secrets 却仍按严格模式校验。
 * 后果：18 个依赖漏洞（9 high）的升级 PR 永远无法合入 —— 门禁把"正常状态"
 * 当成了失败。
 *
 * 本套件钉住:
 *   P1 CI 的注入校验步骤一律降级（FEISHU_STRICT=0），不依赖 secrets 是否存在
 *   P2 CI 不再用 fork 判断降级（旧写法已删，防止改回去）
 *   P3 真实构建（Android/iOS release）仍然严格注入 —— 降级只发生在 CI，不外溢
 *   P4 依赖升级回路（dependabot）配置仍在且覆盖 npm 与 actions 两个生态
 *   P5 降级不等于放弃校验：CI 仍会跑注入脚本（不能把这一步删掉）
 *
 * 运行: node tests/test_v10272_ci_pr_secrets.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = (p) => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/** 取出 workflow 里「跑 inject_build_secrets 的那个 step」的原始文本块 */
function injectStepBlock(yaml, keyword) {
  const lines = yaml.split('\n');
  const hit = lines.findIndex(l => l.indexOf(keyword) >= 0);
  if (hit < 0) return '';
  // 往回找最近的 '- name:' 行，往后找到下一个同级 '- name:' 或文件尾
  let start = hit;
  while (start > 0 && !/^\s*-\s*name:/.test(lines[start])) start--;
  let end = hit + 1;
  while (end < lines.length && !/^\s*-\s*name:/.test(lines[end])) end++;
  return lines.slice(start, end).join('\n');
}

section('P1/P2 CI 的注入校验不再依赖 secrets');
const ci = exists('.github/workflows/ci.yml') ? src('.github/workflows/ci.yml') : '';
check('P1a ci.yml 存在', ci.length > 0);
const ciStep = injectStepBlock(ci, 'inject_build_secrets.js --check');
check('P1b CI 里有注入校验步骤', ciStep.length > 0);
check("P1c 该步骤设置 FEISHU_STRICT: '0'（缺失密钥仅告警）",
  /FEISHU_STRICT:\s*'0'/.test(ciStep), ciStep.split('\n').find(l => l.indexOf('FEISHU_STRICT') >= 0));
check('P1d 该步骤仍真的执行校验脚本（降级 ≠ 删除）',
  /run:\s*node scripts\/inject_build_secrets\.js --check/.test(ciStep));
check('P1e 步骤名点明"不注入真实密钥"，避免后人误以为它在验真实凭证',
  /不注入真实密钥|缺失仅告警/.test(ciStep));

check('P2a ci.yml 不再用 head.repo.fork 判断降级（dependabot PR 不是 fork）',
  ci.indexOf('head.repo.fork') < 0);
check('P2b 注释里留了这次故障的来龙去脉（dependabot 恒红 / 漏洞无法落地）',
  /dependabot/.test(ci) && /恒红|永远|无法落地|18 个漏洞/.test(ci));

section('P3 真实构建仍然严格注入');
['.github/workflows/android-release.yml', '.github/workflows/ios-release.yml'].forEach(f => {
  const wf = exists(f) ? src(f) : '';
  const blk = injectStepBlock(wf, 'inject_build_secrets.js');
  check('P3 ' + path.basename(f) + ' 真的注入密钥', blk.length > 0 && /inject_build_secrets\.js/.test(blk));
  check('P3 ' + path.basename(f) + ' 未被降级（无 FEISHU_STRICT=0）',
    blk.length > 0 && !/FEISHU_STRICT:\s*'?0'?/.test(blk));
});

section('P4 依赖升级回路');
check('P4a .github/dependabot.yml 存在', exists('.github/dependabot.yml'));
const dp = exists('.github/dependabot.yml') ? src('.github/dependabot.yml') : '';
/* 值可带引号（本仓库写的是 "npm"），断言生态名而非引号风格 */
check('P4b 覆盖 npm 生态', /package-ecosystem:\s*"?npm"?/.test(dp));
check('P4c 覆盖 github-actions 生态', /package-ecosystem:\s*"?github-actions"?/.test(dp));

section('P5 反面用例：换成旧写法必须被本套件抓住');
const legacy = ciStep.replace(/FEISHU_STRICT:\s*'0'/, "FEISHU_STRICT: ${{ github.event_name == 'pull_request' && '0' || '' }}");
check('P5a 旧写法（依赖事件/分支判断）不满足 P1c',
  !/FEISHU_STRICT:\s*'0'/.test(legacy));

console.log('\n--------------------------------------------------------------');
console.log('汇总: 通过 ' + pass + ' / 失败 ' + fail + ' / 总计 ' + (pass + fail));
console.log('--------------------------------------------------------------');
if (fail > 0) { console.log('失败项: ' + failures.join(' | ')); process.exit(1); }
