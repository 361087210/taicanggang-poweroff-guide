/**
 * V10.27.8: 飞书上传对"空响应/网关 5xx"的韧性
 *
 * 背景（真事）：发 v10.27.7 时 Android 那条 `Sync Release to Feishu` 红了：
 *   requests.exceptions.JSONDecodeError: Expecting value: line 1 column 1 (char 0)
 * 上传请求返回了空体（网关中断），而 `upload_all_once` 直接 `.json()` → 抛异常 →
 * 整个同步进程退出。APK 15.7MB 正好走单请求上传这条路，一次抖动就白跑一轮。
 *
 * 修法：①响应体解析统一走 safe_json（非 JSON 变普通异常并带 http 码/片段）
 *       ②单请求上传失败重试 2 次
 *       ③分片上传的 prepare/finish 也走 post_json（同一类风险）
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
const RB = read('docs/RUNBOOK.md');
const fnOf = (name, stopMark) => {
  const i = SRC.indexOf('def ' + name + '(');
  const j = stopMark ? SRC.indexOf(stopMark, i) : SRC.length;
  return i < 0 ? '' : SRC.slice(i, j < 0 ? SRC.length : j);
};

/* ---------------- A. 安全解析 ---------------- */
section('A. 非 JSON 响应不再裸抛 JSONDecodeError');

const safe = fnOf('safe_json', 'def post_json(');
check('A1 新增 safe_json()', !!safe);
check('A2 捕获 ValueError(json 解码异常的父类)', /except ValueError/.test(safe));
check('A3 异常信息带 http 状态码', /status_code/.test(safe));
check('A4 异常信息带响应片段(便于判断是网关还是鉴权)', /resp\.text/.test(safe));
check('A5 新增 post_json() 复用 safe_json',
  /def post_json[\s\S]{0,200}return safe_json\(requests\.post\(url, \*\*kwargs\), what\)/.test(SRC));

/* ---------------- B. 单请求上传重试 ---------------- */
section('B. upload_all_once 重试 2 次');

const up = fnOf('upload_all_once', 'def upload_multipart(');
check('B1 有重试循环(2 次)', /for attempt in range\(1, 3\)/.test(up), up.slice(0, 60));
check('B2 5xx 视为可重试失败', /status_code.*>= 500|>= 500/.test(up));
check('B3 解析走 safe_json', /return safe_json\(resp/.test(up));
check('B4 捕获异常并记录 last(不会静默吞掉)', /except Exception as e/.test(up) && /last = e/.test(up));
check('B5 两次都失败才抛，且带上最后一次原因',
  /连续 2 次失败/.test(up) && /\{str\(last\)/.test(up));
check('B6 每次尝试都过 qps_gate(避免限流)', /qps_gate\(\)/.test(up));

/* ---------------- C. 分片上传同样安全解析 ---------------- */
section('C. 分片上传 prepare/finish 也走 post_json');

check('C1 upload_prepare 用 post_json', /prep = post_json\([^)]*upload_prepare/.test(SRC));
check('C2 upload_finish 用 post_json', /fin = post_json\([^)]*upload_finish/.test(SRC));
check('C3 剩余的裸 .json() 都不在 upload_* 路径里',
  !/upload_(prepare|finish)[\s\S]{0,300}?\)\.json\(\)/.test(SRC));

/* ---------------- D. 文档 ---------------- */
section('D. RUNBOOK');

check('D1 RUNBOOK 记录 JSONDecodeError 这条症状', /JSONDecodeError/.test(RB));
check('D2 RUNBOOK 说明 V10.27.8 起自动重试', /V10\.27\.8/.test(RB));
check('D3 RUNBOOK 说明两条同步只要一条成功目录就是全的', /只要有一条成功/.test(RB));

/* ---------------- E. 版本 ---------------- */
section('E. 版本');
function vnum(v) { return String(v).split('.').map(Number).reduce((a, b) => a * 100 + b, 0); }
function code(v) { const [a, b, c] = String(v).split('.').map(Number); return a * 10000 + b * 100 + c; }
const vj = JSON.parse(read('version.json'));
check('E1 版本不低于 10.27.8', vnum(vj.version) >= vnum('10.27.8'), vj.version);
check('E2 versionCode 与 version 自洽',
  typeof vj.versionCode === 'number' && vj.versionCode === code(vj.version),
  vj.version + ' vs ' + String(vj.versionCode));
check('E3 releaseNotes 含 10.27.8', Array.isArray(vj.releaseNotes) && vj.releaseNotes.some((n) => /10\.27\.8/.test(n)));

console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
