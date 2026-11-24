/**
 * V10.27.6: Pages 部署竞态的自动化处置
 *
 * 背景（真事）：发 v10.27.5 时 Pages 连续 4 次失败 —— 上传步骤 success
 * （工件 ID、字节数、finalize 都正常），紧接着 deploy-pages 却报
 * `No artifacts named "github-pages" were found`。用 API 事后查同一个 run，
 * 工件明明在。这就是工件元数据的秒级可见性延迟，而 deploy-pages 只查一次。
 *
 * 修法不是"多试几次运气"，而是把竞态显式化：部署前等一会、首次失败自动重试一次。
 * 本套测试钉住这个结构，防止以后有人"顺手清理"掉等待步骤或重试。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name + (detail ? '  → ' + detail : '')); }
}
function section(t) { console.log('\n' + t); }

const WF = read('.github/workflows/deploy-pages.yml');

/* ---------------- A. 竞态处置结构 ---------------- */
section('A. 部署竞态的处置结构');

const iUpload = WF.indexOf('actions/upload-pages-artifact@');
const iWait = WF.indexOf('等待工件元数据可见');
const iDeploy = WF.indexOf('name: Deploy to GitHub Pages');
const iRetry = WF.indexOf('name: Deploy to GitHub Pages (重试一次)');

check('A1 三处关键步骤都存在(上传/等待/部署)', iUpload > 0 && iWait > 0 && iDeploy > 0);
check('A2 顺序正确: 上传 → 等待 → 部署', iUpload < iWait && iWait < iDeploy,
  'upload=' + iUpload + ' wait=' + iWait + ' deploy=' + iDeploy);
check('A3 等待步骤真的 sleep(不是空步骤)', /等待工件元数据可见[\s\S]{0,200}?run:\s*sleep\s+1[0-9]/.test(WF));
check('A4 首次部署允许失败(continue-on-error: true)',
  /id: deployment\b[\s\S]{0,300}?continue-on-error:\s*true/.test(WF));
check('A5 存在重试步骤且带条件(首次未成功才重试)',
  iRetry > iDeploy && /if:\s*steps\.deployment\.outcome\s*!=\s*'success'/.test(WF));
check('A6 重试步骤复用了同一个部署 action', WF.slice(iRetry).includes('actions/deploy-pages@'));
check('A7 重试步骤有独立 id(deployment_retry), 便于取 page_url',
  /id:\s*deployment_retry/.test(WF));

/* ---------------- B. 页面地址兜底 ---------------- */
section('B. environment.url 取值兜底');

check('B1 url 优先取重试输出, 回落到首次输出',
  /url:\s*\$\{\{\s*steps\.deployment_retry\.outputs\.page_url\s*\|\|\s*steps\.deployment\.outputs\.page_url\s*\}\}/.test(WF));

/* ---------------- C. 供应链与权限未被削弱 ---------------- */
section('C. 供应链固定与权限');

const shaRefs = (WF.match(/uses:\s*[\w-]+\/[\w-]+@([0-9a-f]{40})/g) || []);
const tagRefs = (WF.match(/uses:\s*[\w-]+\/[\w-]+@(?!([0-9a-f]{40}))\S+/g) || []);
check('C1 所有 action 都固定到 40 位 commit SHA', tagRefs.length === 0,
  tagRefs.join(' , '));
check('C2 至少 4 处固定引用(checkout/configure/upload/deploy)', shaRefs.length >= 4, '实际 ' + shaRefs.length);
check('C3 仍具备 pages: write 与 id-token: write',
  /pages:\s*write/.test(WF) && /id-token:\s*write/.test(WF));
check('C4 concurrency 仍以 pages 分组(cancel-in-progress 防并发部署互踩)',
  /concurrency:[\s\S]{0,120}group:\s*"?pages"?/.test(WF));

/* ---------------- D. 发布白名单没被顺手放宽 ---------------- */
section('D. 发布白名单');

check('D1 仍从 _publish 目录上传', /path:\s*'\.\/_publish'/.test(WF));
check('D2 白名单不含 docs/(docs 只在仓库里, 不做线上资产)', !/cp\s+-r\s+docs\b/.test(WF));

/* ---------------- E. 文档互链 ---------------- */
section('E. 文档');

const RB = read('docs/RUNBOOK.md');
check('E1 RUNBOOK 记录了 "No artifacts named" 这条症状', RB.includes('No artifacts named'));
check('E2 RUNBOOK 说明 V10.27.6 起已自动化(等 + 重试), 不必每次手工 dispatch',
  /V10\.27\.6 起已自动化/.test(RB) && /重试/.test(RB));

/* ---------------- F. 版本一致 ---------------- */
section('F. 版本');


/* 版本断言只校验"不倒退 + 编码自洽", 不写死当前版本号 ——
 * 否则下一个版本升号时这里必红(本轮就踩了: v10.27.6 的套件在 10.27.7 时 F2 红)。 */
function vnum(v) { return String(v).split('.').map(Number).reduce((a, b) => a * 100 + b, 0); }
function code(v) { const [a, b, c] = String(v).split('.').map(Number); return a * 10000 + b * 100 + c; }

const vj = JSON.parse(read('version.json'));
check('F1 版本不低于 10.27.6(本版已发布, 允许继续升号)',
  vnum(vj.version) >= vnum('10.27.6'), vj.version);
check('F2 versionCode 为数字且与 version 自洽',
  typeof vj.versionCode === 'number' && vj.versionCode === code(vj.version),
  vj.version + ' vs ' + String(vj.versionCode));
check('F3 发布说明里有 10.27.6 这一版(历史不被抹掉)',
  Array.isArray(vj.releaseNotes) && vj.releaseNotes.some((n) => /10\.27\.6/.test(n)));

console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败');
process.exit(fail === 0 ? 0 : 1);
