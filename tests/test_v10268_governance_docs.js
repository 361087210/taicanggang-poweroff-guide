/**
 * ============================================================
 * test_v10268_governance_docs.js — 运维手册与规则集模板回归 (V10.26.8)
 * ============================================================
 * 走查（行业标准）发现的两类长期缺口：
 *   ① 没有 RUNBOOK：发布后怎么回滚、数据怎么恢复、Pages 重复 artifact 怎么处理，全靠记忆；
 *   ② 覆盖率门禁只报"可归因 98%"，容易被误读为"全项目 98%"（实际整体 80.45%）。
 *
 * 本套件钉住:
 *   G1 docs/RUNBOOK.md 存在且覆盖回滚/恢复/故障处置/演练/升级路径
 *   G2 规则集模板可一键恢复严格模式（pull_request + required_status_checks）
 *   G3 覆盖率门禁同时打印「可归因」与「整体(含不可归因)」两个口径
 *   G4 数据类断言不再写死具体数量（64/100）—— 数据增长不该让 CI 误红
 *   G5 CONTRIBUTING 与 RUNBOOK 互相可达
 *
 * 运行: node tests/test_v10268_governance_docs.js
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

section('G1 RUNBOOK');
check('G1a docs/RUNBOOK.md 存在', exists('docs/RUNBOOK.md'));
const rb = exists('docs/RUNBOOK.md') ? src('docs/RUNBOOK.md') : '';
['回滚', '恢复演练', '常见故障', '值班', 'git revert'].forEach(k => {
  check('G1 覆盖「' + k + '」', rb.indexOf(k) >= 0);
});
check('G1f 写明 Pages 重复 artifact 的处置', rb.indexOf('Multiple artifacts named') >= 0);
check('G1g 写明数据真源与恢复步骤', rb.indexOf('vehicle_sync_data.json') >= 0 && rb.indexOf('backup_to_feishu.py') >= 0);

section('G2 规则集模板');
const strictPath = '.github/rulesets/branch-strict.json';
const tagPath = '.github/rulesets/tag-protect.json';
check('G2a 严格分支规则集模板存在', exists(strictPath));
check('G2b tag 规则集模板存在', exists(tagPath));
let strict = null, tagRs = null;
try { strict = JSON.parse(src(strictPath)); } catch (e) {}
try { tagRs = JSON.parse(src(tagPath)); } catch (e) {}
const kinds = (rs) => (rs && rs.rules || []).map(r => r.type);
check('G2c 严格模式包含 pull_request', kinds(strict).includes('pull_request'));
check('G2d 严格模式包含 required_status_checks', kinds(strict).includes('required_status_checks'));
check('G2e 必过检查名为 CI/Secret Scan 的实际上下文',
  JSON.stringify(strict).indexOf('Web资产与安全校验') > 0 && JSON.stringify(strict).indexOf('"scan"') > 0);
check('G2f tag 规则禁删除且禁移动', kinds(tagRs).includes('deletion') && kinds(tagRs).includes('update'));
check('G2g RUNBOOK 指明升级路径指向该模板', rb.indexOf(strictPath) > 0);

section('G3 覆盖率双口径');
const gate = src('scripts/check_coverage_threshold.js');
check('G3a 打印整体口径（含不可归因）', /整体口径\(含不可归因\)/.test(gate));
check('G3b 说明不可归因占比与原因', /不可归因占源码行/.test(gate) && /JSDOM/.test(gate));
check('G3c 验收线仍是可归因 95%', /MIN_LINES_PCT\s*=\s*95/.test(gate));

section('G4 数据类断言不写死数量');
const t63 = src('tests/test_v10263_shared_refs.js');
const t66 = src('tests/test_v10266_media_independence.js');
check('G4a 共享引用测试不再写死 64', !/unresolved\.length === 64/.test(t63));
check('G4b 车型清单测试不再写死 100', !/\(idx\.vehicles \|\| \[\]\)\.length === 100/.test(t66));
check('G4c 改为与索引/镜像互证', /索引 missing 明细|_idxMissing/.test(t63) && /_mirrorCount/.test(t66));

section('G5 文档互链');
const contrib = src('CONTRIBUTING.md');
check('G5a CONTRIBUTING 指向 RUNBOOK', contrib.indexOf('RUNBOOK') >= 0);
check('G5b RUNBOOK 指向 CONTRIBUTING 的发版流程', rb.indexOf('CONTRIBUTING') >= 0);

console.log('\n==============================================================');
console.log('运维与规则集回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
