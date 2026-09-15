/**
 * ============================================================
 * test_v1033_linkkey_migration_ux.js — P0 迁移缺口「可操作提示 + App 引导」测试
 * ============================================================
 * 事故背景(线上正在发生):
 *   网页端账号表只透传 linkKey(见 scripts/sync_web_data.js 白名单), 而 linkKey 必须
 *   由持有**明文密码**的 App 端在登录瞬间派生回推(惰性迁移, 见 js/02-auth.js doLogin)。
 *   存量账号若从未在 P0(>=10.19.1) 版 App 登录过, 云端镜像里就**没有 linkKey**,
 *   网页端无从校验 → 统一落到 doLogin 的 !passOk 分支, 报「账号或密码错误」——
 *   用户以为密码错, 实为「迁移未完成」。
 *
 * 本测试锁定三类回归(先红后绿):
 *   V1 版本 10.19.2 七处一致性(含 sw.js CACHE_NAME, 否则修了也到不了用户)
 *   V2 网页端登录失败的可操作提示(引导去 App 完成升级 + 重试入口)
 *      红线: 提示必须通用, 绝不能泄露「该手机号是否为已注册账号」(镜像无明文手机号,
 *            网页端本就无法区分「未注册」与「未迁移」, 文案不得引入存在性泄露)
 *   V3 App 端缺 linkKey 引导(不静默失败) + 不落盘明文密码(红线)
 *   V4 09-web-sync.js 迁移未完成信号
 *
 * 运行: node tests/test_v1033_linkkey_migration_ux.js
 * 要求: 先红后绿——修复前应失败(红), 修复后全绿。
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

const EXPECT_VER = '10.19.2';
const EXPECT_CODE = '101902';

const versionJson = JSON.parse(src('version.json'));
const configXml = src('config.xml');
const bootstrapJs = src('js/00-bootstrap.js');
const swJs = src('sw.js');
const demoHtml = src('demo.html');
const aboutJs = src('js/11-about.js');
const authJs = src('js/02-auth.js');
const webSyncJs = src('js/09-web-sync.js');

/* ============================================================
 * V1 版本 10.19.2 七处一致性
 * ============================================================ */
section('V1 版本 ' + EXPECT_VER + ' 七处一致性(版本门禁同款覆盖)');
check('V1a version.json.version === ' + EXPECT_VER, String(versionJson.version) === EXPECT_VER, String(versionJson.version));
check('V1b version.json.versionCode === ' + EXPECT_CODE, String(versionJson.versionCode) === EXPECT_CODE, String(versionJson.versionCode));
check('V1c config.xml version/android-versionCode 同步',
  new RegExp('version="' + EXPECT_VER.replace(/\./g, '\\.') + '" android-versionCode="' + EXPECT_CODE + '"').test(configXml));
check('V1d js/00-bootstrap.js APP_VERSION === ' + EXPECT_VER,
  bootstrapJs.includes("const APP_VERSION='" + EXPECT_VER + "';"));
check('V1e js/11-about.js 兜底字面量 APP_VERSION || ' + EXPECT_VER,
  new RegExp("APP_VERSION\\s*\\|\\|\\s*'" + EXPECT_VER.replace(/\./g, '\\.') + "'").test(aboutJs));

/* sw.js CACHE_NAME: 缓存优先策略下不同步 = 修了也到不了用户 */
const swM = swJs.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/);
const swName = swM ? swM[1] : '';
check('V1f sw.js CACHE_NAME 存在', !!swM, swName);
check('V1g sw.js CACHE_NAME 内嵌版本 === ' + EXPECT_VER,
  swName === 'tcg-poweroff-v' + EXPECT_VER, swName);
check('V1h sw.js 缓存名版本 === version.json 版本(缓存诅咒根治)',
  (swName.match(/(\d+\.\d+\.\d+)/) || [])[1] === String(versionJson.version), swName);

/* demo.html 本地版本展示位 */
check('V1i demo.html sync-local-ver === v' + EXPECT_VER,
  demoHtml.includes('id="sync-local-ver">v' + EXPECT_VER));

/* 关于板块版本历史最新条目 */
const histM = aboutJs.match(/const\s+VERSION_HISTORY\s*=\s*\[\s*\{\s*version:\s*'(V?[0-9.]+)'/);
check('V1j js/11-about.js VERSION_HISTORY 最新 === V' + EXPECT_VER,
  !!histM && histM[1].replace(/^V/, '') === EXPECT_VER, histM && histM[1]);

/* 版本门禁本身必须通过(单点真源, 不重复实现) */
section('V1k 版本一致性门禁直接通过');
const { execFileSync } = require('child_process');
let gateOk = false, gateOut = '';
try {
  gateOut = execFileSync(process.execPath, [path.join('scripts', 'check_version_consistency.js')],
    { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  gateOk = true;
} catch (e) {
  gateOk = false;
  gateOut = String((e.stdout || '') + (e.stderr || ''));
}
check('V1k npm run test:version 退出码 0', gateOk, gateOut.trim().slice(0, 240));

/* ============================================================
 * V2 网页端登录失败的可操作提示
 * ============================================================ */
section('V2 网页端登录失败可操作提示(通用, 不泄露账号存在性)');
check('V2a demo.html 存在登录提示容器 id="login-hint"', /id="login-hint"/.test(demoHtml));
check('V2b 02-auth.js 定义 showWebLoginMigrationHint()',
  /function\s+showWebLoginMigrationHint\s*\(/.test(authJs));

const hintBlock = (authJs.match(/function\s+showWebLoginMigrationHint\s*\([\s\S]*?\n\}/) || [''])[0];
check('V2c 提示块非空(可提取)', hintBlock.length > 0);
check('V2d 提示以「账号或密码错误」开头(通用不泄露)', /账号或密码错误/.test(hintBlock));
check('V2e 提示引导去手机 App 完成升级', /手机\s*App|App（|App\(/.test(hintBlock) && /升级/.test(hintBlock));
check('V2f 提示明确作用于「网页端登录」', /网页端/.test(hintBlock));
check('V2g 提示含明确重试入口(按钮再次触发 doLogin)',
  /doLogin\s*\(/.test(hintBlock) && /重新登录/.test(hintBlock));
check('V2h 提示引用 App 版本号动态插值(避免文案版本漂移)', /APP_VERSION/.test(hintBlock));
/* 红线: 提示块不得含账号存在性泄露词 */
check('V2i 提示块不含账号存在性泄露词',
  !/未注册|账号不存在|未完成升级|该手机号|未找到该账号|请先注册/.test(hintBlock),
  hintBlock.replace(/\s+/g, ' ').slice(0, 200));

/* 仅在纯网页环境展示(App 端行为必须不变) */
check('V2j 提供 _isWebMirrorEnv() 网页环境判定', /function\s+_isWebMirrorEnv\s*\(/.test(authJs));
check('V2k 提示仅网页镜像端触发(cordova 守卫)',
  /_isWebMirrorEnv\s*\(\s*\)[\s\S]{0,200}showWebLoginMigrationHint/.test(authJs) ||
  /if\s*\(\s*_isWebMirrorEnv\(\)\s*\)\s*showWebLoginMigrationHint/.test(authJs));
check('V2l doLogin 登录失败分支确实调用提示', /showWebLoginMigrationHint\s*\(\s*\)\s*;/.test(authJs));

/* ============================================================
 * V3 App 端缺 linkKey 引导(不静默失败) + 明文密码红线
 * ============================================================ */
section('V3 App 缺 linkKey 引导(不静默失败)');
check('V3a 02-auth.js 定义缺 linkKey 引导函数', /function\s+_guideLinkKeyUpgrade\s*\(/.test(authJs));
check('V3b restoreSession 内调用引导(检测本地账号缺 linkKey)', /async function restoreSession[\s\S]*?_guideLinkKeyUpgrade\s*\(/.test(authJs));
const guideM = authJs.match(/function\s+_guideLinkKeyUpgrade\s*\([\s\S]*?\n\}/);
const guideBlock = guideM ? guideM[0] : '';
check('V3c 引导文案要求重新登录完成安全升级',
  /重新登录/.test(guideBlock) && /升级/.test(guideBlock), guideBlock.replace(/\s+/g, ' ').slice(0, 160));
check('V3d 引导仅 App 端触发(cordova 守卫)', /cordova/.test(guideBlock));
check('V3e 引导为一次性(带 localStorage 标记, 不反复骚扰)',
  /localStorage\.(getItem|setItem)\(\s*['"]tcg_link/.test(guideBlock), guideBlock.replace(/\s+/g, ' ').slice(0, 200));

/* 红线: 绝不为了自动补算而把明文密码写盘 */
section('V3f 红线: 不得落盘明文密码');
check('V3f 02-auth.js 无 localStorage 明文密码写入',
  !/localStorage\.setItem\([^)]*(password|passwd|pwd|明文)/i.test(authJs));
check('V3g 09-web-sync.js 无 localStorage 明文密码写入',
  !/localStorage\.setItem\([^)]*(password|passwd|pwd|明文)/i.test(webSyncJs));

/* ============================================================
 * V4 09-web-sync.js 迁移未完成信号
 * ============================================================ */
section('V4 09-web-sync.js 迁移未完成信号');
check('V4a 无匹配时置信号(供上层精确判定迁移缺口)',
  /__TCG_WEB_MIGRATION_HINT__/.test(webSyncJs));
check('V4b 仍在探测式激活内设置 __TCG_WEB_MIRROR__',
  /__TCG_WEB_MIRROR__\s*=\s*true/.test(webSyncJs));

console.log('\n==============================================================');
console.log('P0 迁移缺口 UX 修复测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
