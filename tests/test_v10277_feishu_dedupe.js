/**
 * V10.27.7: 飞书发版产物"同名副本"的根治
 *
 * 背景（真事）：飞书云盘允许同名文件共存，而覆盖式上传在**两个同步任务并发**时
 * 会各传一份。实测 v10.27.2 目录里 4 个产物全都一对二、v10.27.1/v10.27.5 多一份 IPA。
 *
 * 更隐蔽的是"清不掉"：`list_children()` 用文件名做键，同名副本被聚合成一条，
 * 于是 `delete_if_exists()` 每次只删一条、再传一条 —— 副本数量永远不降，
 * 而终验只看"名字能查到"，所以一直显示"完成 ✔"。
 *
 * 修法两处：①并发串行化（根治产生）②删全部同名 + 终验按唯一性判定（自愈存量）。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const SRC = read('scripts/sync_release_to_feishu.py');
const BOTH = read('scripts/sync_release_both_roots.py');
const WF = read('.github/workflows/sync-release-feishu.yml');
const RB = read('docs/RUNBOOK.md');

/* ---------------- A. 聚合方式：不再用文件名当键 ---------------- */
section('A. 列举改为按名字分组，保留全部同名项');

check('A1 新增 list_children_all()', /def list_children_all\(token, folder_token\)/.test(SRC));
check('A2 它用 setdefault 累积同名项（而不是 files[name]=f 覆盖）',
  /groups\.setdefault\(f\.get\("name"\), \[\]\)\.append\(f\)/.test(SRC));
check('A3 它保留分页（has_more / page_token）',
  /has_more/.test(SRC.slice(SRC.indexOf('def list_children_all'))));

/* ---------------- B. 删除：删全部同名，而不是只删一条 ---------------- */
section('B. delete_if_exists 删除全部同名副本');

const delFn = (SRC.match(/def delete_if_exists\([\s\S]*?\n    return deleted/) || [''])[0];
check('B1 delete_if_exists 存在且用 list_children_all 取候选',
  delFn.includes('list_children_all(token, folder_token).get(name, [])'), delFn.slice(0, 80));
check('B2 候选里筛选 type=file', /if f\.get\("type"\) == "file"/.test(delFn));
check('B3 通过 for 循环逐个删除（不是只取 olds[0]）',
  /for old in olds:/.test(delFn) && !/olds\[0\]/.test(delFn));
check('B4 返回值是可累加的删除条数（不是布尔）',
  /deleted = 0/.test(delFn) && /deleted \+= 1/.test(delFn) && /return deleted/.test(delFn));
check('B5 多份时打印"清理"提示，便于日志里看出存量副本',
  /\[清理\]/.test(delFn));

/* ---------------- C. 终验：唯一性才算通过 ---------------- */
section('C. 终验把"同名副本"判成失败');

check('C1 单根终验改用 list_children_all', /groups = list_children_all\(token, ver_folder\)/.test(SRC));
check('C2 副本数 > 1 时不通过（单根）', /有 \{len\(got\)\} 份同名副本/.test(SRC));
check('C3 双根终验也改用 list_children_all', /groups = list_children_all\(token, ver_folder\)/.test(BOTH));
check('C4 副本数 > 1 时不通过（双根）', /有 \{len\(got\)\} 份副本/, BOTH.slice(BOTH.indexOf('results = []')));
check('C5 双根还额外扫全目录重名并报出来', /\[副本\]/.test(BOTH));
check('C6 双根导入 list_children_all',
  /upload_file, delete_if_exists, list_children_all,/.test(BOTH));

/* ---------------- D. 并发：串行化，且不取消进行中的任务 ---------------- */
section('D. 两个同步任务串行化');

check('D1 workflow 有 concurrency 分组', /concurrency:\s*\n\s*group:\s*release-feishu-sync/.test(WF));
check('D2 不取消进行中的任务（避免停在半个文件上）',
  /cancel-in-progress:\s*false/.test(WF));
check('D3 concurrency 在 jobs 之前（作用于整个工作流）',
  WF.indexOf('concurrency:') < WF.indexOf('\njobs:'));
check('D4 仍只挂 Android/iOS 两条构建完成事件',
  /workflows:\s*\["Android CI Build & Release", "iOS CI Build & Release"\]/.test(WF));

/* ---------------- E. 文档 ---------------- */
section('E. RUNBOOK 记录处置');

check('E1 RUNBOOK 有"飞书同名副本/重复"这条症状',
  /飞书.*副本|同名副本/.test(RB));
check('E2 RUNBOOK 说明已自动化（串行 + 删全部同名）', /V10\.27\.7/.test(RB));

/* ---------------- F. 版本 ---------------- */
section('F. 版本');


/* 版本断言只校验"不倒退 + 编码自洽", 不写死当前版本号 ——
 * 否则下一个版本升号时这里必红(本轮就踩了: v10.27.6 的套件在 10.27.7 时 F2 红)。 */
function vnum(v) { return String(v).split('.').map(Number).reduce((a, b) => a * 100 + b, 0); }
function code(v) { const [a, b, c] = String(v).split('.').map(Number); return a * 10000 + b * 100 + c; }

const vj = JSON.parse(read('version.json'));
check('F1 版本不低于 10.27.7(允许继续升号)',
  vnum(vj.version) >= vnum('10.27.7'), vj.version);
check('F2 versionCode 为数字且与 version 自洽',
  typeof vj.versionCode === 'number' && vj.versionCode === code(vj.version),
  vj.version + ' vs ' + String(vj.versionCode));
check('F3 releaseNotes 含 10.27.7 这一版',
  Array.isArray(vj.releaseNotes) && vj.releaseNotes.some((n) => /10\.27\.7/.test(n)));

console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
