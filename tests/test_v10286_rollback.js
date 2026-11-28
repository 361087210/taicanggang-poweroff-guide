/**
 * ============================================================
 * test_v10286_rollback.js — 回滚能力回归
 * ============================================================
 * 覆盖:
 *   R1 releases_index.json 清单契约(状态/计数/链接/去重/排序)
 *   R2 清单生成器(--check 防漂移, 基于 tags+releases)
 *   R3 网页回滚工作流(二次确认、按 tag checkout、共用发布清单)
 *   R4 发布清单单一真源(prepare_pages.sh 被两个工作流共用)
 *   R5 App 内历史版本入口(弹层/按钮/下载函数)
 *   R6 云端备份恢复(列表/下载/复用合并逻辑)
 *
 * 运行: node tests/test_v10286_rollback.js
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

/* ---------------- R1 清单契约 ---------------- */
section('R1 releases_index.json 契约');
let idx = null;
try { idx = JSON.parse(src('releases_index.json')); } catch (e) { check('R1a 清单可解析', false, e.message); }
check('R1a 清单可解析', !!idx);
if (idx) {
  check('R1b schemaVersion=1', idx.schemaVersion === 1);
  check('R1c releases 为非空数组', Array.isArray(idx.releases) && idx.releases.length > 0, idx && idx.releases && idx.releases.length);
  check('R1d latest 在清单内', !!idx.latest && idx.releases.some((r) => r.version === idx.latest), idx && idx.latest);

  const cnt = { total: idx.releases.length, complete: 0, partial: 0, missing: 0, unreleased: 0 };
  idx.releases.forEach((r) => { if (cnt[r.status] === undefined) cnt[r.status] = 0; cnt[r.status]++; });
  check('R1e counts 与明细实算一致',
    idx.counts && idx.counts.total === cnt.total && idx.counts.complete === cnt.complete &&
    idx.counts.partial === cnt.partial && idx.counts.missing === (cnt.missing || 0) &&
    idx.counts.unreleased === (cnt.unreleased || 0), JSON.stringify(idx.counts) + ' vs ' + JSON.stringify(cnt));

  const completeOk = idx.releases.filter((r) => r.status === 'complete')
    .every((r) => r.apk && /^https:\/\//.test(r.apk.url || '') && r.ipa && r.apkSha256 && r.apk.size > 0);
  check('R1f complete 必须同时有 APK/IPA/sha256 且为 https 直链', completeOk);

  const unreleasedOk = idx.releases.filter((r) => r.status === 'unreleased')
    .every((r) => !r.publishedAt && !r.releaseUrl && !r.rollbackable);
  check('R1g unreleased 不带发布日期/链接/可回滚标记', unreleasedOk);

  const rbOk = idx.releases.every((r) => r.rollbackable === !!(r.apk || r.ipa));
  check('R1h rollbackable 与是否有安装包一致', rbOk);

  const vers = idx.releases.map((r) => r.version);
  check('R1i 版本号唯一', new Set(vers).size === vers.length);
  const desc = vers.every((v, i) => i === 0 || (function (a, b) {
    const pa = String(b).split('.').map(Number), pb = String(a).split('.').map(Number);
    for (let k = 0; k < Math.max(pa.length, pb.length); k++) {
      const x = pa[k] || 0, y = pb[k] || 0;
      if (x !== y) return x > y;
    }
    return false;
  })(v, vers[i - 1]));
  check('R1j 按版本号倒序', desc);

  const known = idx.releases.find((r) => r.version === '10.27.3');
  check('R1k 历史上未产出的版本被如实标注', !known || known.status === 'unreleased' || known.status === 'missing',
    known && known.status);
}

/* ---------------- R2 生成器 ---------------- */
section('R2 清单生成器');
const gen = src('scripts/gen_release_index.js');
check('R2a 生成器存在且读 tags 与 releases', gen.indexOf('/tags') >= 0 && gen.indexOf('/releases') >= 0);
check('R2b 支持 --check 漂移校验', gen.indexOf('--check') >= 0 && gen.indexOf('generatedAt') >= 0);
check('R2c 同名重复 Release 取资产最全的一份', /byTag/.test(gen) && /assets/.test(gen));
check('R2d 输出路径为仓库根 releases_index.json', /releases_index\.json/.test(gen));

/* ---------------- R3 网页回滚工作流 ---------------- */
section('R3 网页回滚工作流');
const rb = src('.github/workflows/rollback.yml');
check('R3a 支持手动触发且要输入版本', rb.indexOf('workflow_dispatch:') >= 0 && rb.indexOf('version:') >= 0);
check('R3b 二次确认串必须与版本一致', /confirm.*!=.*version/.test(rb.replace(/\s+/g, ' ')) || /inputs\.confirm\}\}" != "\$\{\{ inputs\.version/.test(rb));
check('R3c 按目标 tag checkout 站点内容', /ref:\s*\$\{\{\s*inputs\.version\s*\}\}/.test(rb));
check('R3d 发布前校验该版本产物并写入摘要', rb.indexOf('releases/tags/') >= 0 && rb.indexOf('GITHUB_STEP_SUMMARY') >= 0);
check('R3e 具备 Pages 部署权限', /pages:\s*write/.test(rb) && /id-token:\s*write/.test(rb));

/* 血泪教训: 在 run: | 块里写 heredoc, 正文一旦顶格就会提前结束 YAML 块标量,
 * 整份工作流无法解析(run 里 0 个 job, 名字显示为文件路径)。
 * 这里不粗暴禁 heredoc(正确缩进的 heredoc 是合法的), 而是要求每份工作流都能被解析。 */
const wfFiles = fs.readdirSync(path.join(ROOT, '.github', 'workflows')).filter((f) => f.endsWith('.yml'));
let yamlLib = null;
try { yamlLib = require('js-yaml'); } catch (e) { /* 缺依赖时跳过 */ }
if (yamlLib) {
  const bad = [];
  wfFiles.forEach((f) => {
    try { yamlLib.load(src(path.join('.github', 'workflows', f))); }
    catch (e) { bad.push(f + ': ' + String(e.message).split('\n')[0]); }
  });
  check('R3f 所有工作流均可被 YAML 解析', bad.length === 0, bad.join(' | '));
}

/* ---------------- R4 发布清单单一真源 ---------------- */
section('R4 发布清单单一真源');
const dp = src('.github/workflows/deploy-pages.yml');
check('R4a 正常发布调用共用脚本', dp.indexOf('scripts/prepare_pages.sh') >= 0);
check('R4b 正常发布不再内联 cp 清单', dp.indexOf('cp demo.html _publish/') < 0);
check('R4c 回滚也调用同一脚本', rb.indexOf('scripts/prepare_pages.sh') >= 0);
const pp = src('scripts/prepare_pages.sh');
check('R4d 脚本接收源目录与输出目录', /SRC=/.test(pp) && /OUT=/.test(pp));
check('R4e 脚本覆盖核心站点文件', ['index.html', 'demo.html', 'sw.js', 'version.json', 'js', 'css', 'vendor'].every((f) => pp.indexOf(f) >= 0));
check('R4f 脚本包含版本清单', pp.indexOf('releases_index.json') >= 0);

/* 回滚时源目录是 site/, 输出必须落在调用者目录 —— 曾经因为 cd 到源目录后
 * 用相对路径输出, 把 _publish 建到了 site/ 里面, 部署步骤找不到目录 */
const os = require('os');
const { execSync } = require('child_process');
let r4gOk = false, r4gMsg = '';
try {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-'));
  const site = path.join(tmp, 'site');
  fs.mkdirSync(site);
  ['index.html', 'demo.html', 'manifest.json', 'sw.js', 'feishu-api.js', 'vehicles_data.js', 'version.json']
    .forEach((f) => fs.writeFileSync(path.join(site, f), 'x'));
  ['css', 'js', 'vendor', 'vehicle_images'].forEach((d) => fs.mkdirSync(path.join(site, d)));
  const out = path.join(tmp, '_publish');
  execSync('bash "' + path.join(ROOT, 'scripts', 'prepare_pages.sh') + '" "' + site + '" "' + out + '"', { stdio: 'pipe' });
  r4gOk = fs.existsSync(path.join(out, 'index.html')) && !fs.existsSync(path.join(site, '_publish'));
  r4gMsg = 'out=' + fs.existsSync(path.join(out, 'index.html')) + ' site/_publish=' + fs.existsSync(path.join(site, '_publish'));
  fs.rmSync(tmp, { recursive: true, force: true });
} catch (e) { r4gMsg = String(e.message).slice(0, 160); }
check('R4g 源目录与输出目录分离时, 输出落在调用者位置', r4gOk, r4gMsg);

/* ---------------- R5 App 历史版本入口 ---------------- */
section('R5 App 内历史版本');
const demo = src('demo.html');
const cache = src('js/07-cache.js');
check('R5a 入口按钮存在', demo.indexOf('openVersionHistory()') >= 0 && demo.indexOf('安装包回滚') >= 0);
check('R5b 弹层容器存在', demo.indexOf('id="modal-versions"') >= 0 && demo.indexOf('id="versions-list"') >= 0);
check('R5b2 标题与「关于」里的版本历史区分开', demo.indexOf('安装包回滚（历史版本）') >= 0);
check('R5c 读取版本清单', cache.indexOf('releases_index.json') >= 0 && /function loadReleaseIndex/.test(cache));
check('R5d 直链下载函数', /function downloadVersionAsset/.test(cache) && /function openVersionHistory/.test(cache));
check('R5e 标注 Android 降级需卸载', cache.indexOf('需先卸载') >= 0);

/* ---------------- R6 云端备份恢复 ---------------- */
section('R6 云端备份恢复');
const sync = src('js/05-sync.js');
check('R6a 数据页入口存在', demo.indexOf('openCloudBackupList()') >= 0 && demo.indexOf('从云端备份恢复') >= 0);
check('R6b 弹层容器存在', demo.indexOf('id="modal-cloud-backups"') >= 0);
check('R6c 列出云端备份并支持恢复', /async function openCloudBackupList/.test(sync) && /async function restoreCloudBackup/.test(sync));
check('R6d 复用本地导入的合并与二次确认', /handleImportBackup\(inputEl,\s*presetData\)/.test(sync) && sync.indexOf('预设') === -1);
check('R6e 恢复按 file token 精确定位(同名多档可区分)',
  /downloadJsonByFileToken\(token,\s*fileToken\)/.test(sync) && sync.indexOf('esc(f.token)') >= 0);
check('R6f 列表展示秒级时间, 同名备份可区分', sync.indexOf('slice(0,19)') >= 0);
check('R6g 按 token 的下载器独立于按名查找', /async function downloadJsonByFileToken/.test(sync) && /return downloadJsonByFileToken\(token,target\.token\)/.test(sync));

/* ---------------- R7 版本一致性 ---------------- */
section('R7 版本一致性');
const ver = JSON.parse(src('version.json'));
check('R7a version.json 与 APP_VERSION 一致',
  cache.length > 0 && src('js/00-bootstrap.js').indexOf("APP_VERSION='" + ver.version + "'") >= 0, ver.version);
check('R7b 发布说明文件存在', fs.existsSync(path.join(ROOT, 'docs', 'RELEASE_V' + ver.version + '.md')));

console.log('\n========== 结果 ==========');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) console.log('失败项: ' + failures.join(' | '));
process.exit(fail ? 1 : 0);
