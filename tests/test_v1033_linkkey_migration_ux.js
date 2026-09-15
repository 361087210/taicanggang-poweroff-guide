/**
 * ============================================================
 * test_v1033_linkkey_migration_ux.js — P0 迁移缺口「可操作提示 + App 引导」测试
 * ============================================================
 * 事故背景(线上正在发生):
 *   网页端账号表只透传 linkKey(见 scripts/sync_web_data.js 白名单), 而 linkKey 必须
 *   由持有**明文密码**的 App 端在登录瞬间派生回推(惰性迁移, 见 js/02-auth.js doLogin)。
 *   存量账号若从未在 P0(>=10.19.2) 版 App 登录过, 云端镜像里就**没有 linkKey**,
 *   网页端无从校验 → 统一落到 doLogin 的 !passOk 分支, 报「账号或密码错误」——
 *   用户以为密码错, 实为「迁移未完成」。
 *
 * 本测试锁定三类回归(先红后绿):
 *   V1 七源版本一致性(期望值取自 version.json, 不写死) + V2 变异自证(改坏任一源必红)
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

/* V10.19.3: 期望值**不再写死** —— 从 version.json 单一真源推导(升版免维护, 避免
 * "升版 = 测试红"的维护税与"习惯性改断言"的坏习惯)。真正的不变量是:
 *   「其余六源与 version.json 一致」+「versionCode === encode(version)」。
 * 为防"改成推导后断言恒真(防线被拆)", 下方 V2 段用**变异测试**自证:
 *   改坏任一源 → 一致性判定必须判红。 */
const versionJson = JSON.parse(src('version.json'));
const EXPECT_VER = String(versionJson.version);
const EXPECT_CODE = String(versionJson.versionCode);

const configXml = src('config.xml');
const bootstrapJs = src('js/00-bootstrap.js');
const swJs = src('sw.js');
const demoHtml = src('demo.html');
const aboutJs = src('js/11-about.js');
const authJs = src('js/02-auth.js');
const webSyncJs = src('js/09-web-sync.js');

/* ============================================================
 * V1 版本一致性(期望值取自 version.json; 判定逻辑单一实现, 供 V2 变异自证复用)
 * ============================================================ */
/**
 * 唯一的"七源一致"判定实现: 返回问题清单(空数组 = 一致)。
 * @param {{version:object,config:string,bootstrap:string,sw:string,demo:string,about:string}} s
 * @returns {string[]}
 */
function _versionProblems(s){
  const V = String(s.version.version), C = String(s.version.versionCode);
  const p = V.split('.');
  const expectCode = String(Number(p[0]) * 10000 + Number(p[1]) * 100 + Number(p[2]));
  const esc = V.replace(/\./g, '\\.');
  const probs = [];
  if(!/^\d+\.\d+\.\d+$/.test(V)) probs.push('version 非 x.y.z 形态: ' + V);
  if(C !== expectCode) probs.push('versionCode=' + C + ' 与 version=' + V + ' 不匹配(期望 ' + expectCode + ')');
  if(!new RegExp('version="' + esc + '" android-versionCode="' + C + '"').test(s.config)) probs.push('config.xml 与 version.json 不一致');
  if(!s.bootstrap.includes("const APP_VERSION='" + V + "';")) probs.push('00-bootstrap APP_VERSION 不一致');
  if(!new RegExp("APP_VERSION\\s*\\|\\|\\s*'" + esc + "'").test(s.about)) probs.push('11-about 兜底字面量不一致');
  const swName = (s.sw.match(/const\s+CACHE_NAME\s*=\s*['"]([^'"]+)['"]/) || [])[1] || '';
  if(swName !== 'tcg-poweroff-v' + V) probs.push('sw.js CACHE_NAME 不一致(' + swName + ')');
  if(!s.demo.includes('id="sync-local-ver">v' + V)) probs.push('demo.html 显示版本不一致');
  const hist = (s.about.match(/const\s+VERSION_HISTORY\s*=\s*\[\s*\{\s*version:\s*'(V?[0-9.]+)'/) || [])[1] || '';
  if(hist.replace(/^V/, '') !== V) probs.push('11-about VERSION_HISTORY 头不一致(' + hist + ')');
  return probs;
}
const REAL_SOURCES = { version: versionJson, config: configXml, bootstrap: bootstrapJs, sw: swJs, demo: demoHtml, about: aboutJs };

section('V1 版本 ' + EXPECT_VER + ' 七处一致性(期望值取自 version.json, 不写死)');
const v1probs = _versionProblems(REAL_SOURCES);
check('V1a version 为 x.y.z 三段数字', /^\d+\.\d+\.\d+$/.test(EXPECT_VER), EXPECT_VER);
check('V1b versionCode === encode(version)(' + EXPECT_CODE + ')', !v1probs.some(p => p.indexOf('versionCode') >= 0), v1probs.join(' | '));
check('V1c config.xml version/android-versionCode 与 version.json 同步', !v1probs.some(p => p.indexOf('config.xml') >= 0), v1probs.join(' | '));
check('V1d js/00-bootstrap.js APP_VERSION 与 version.json 一致', !v1probs.some(p => p.indexOf('00-bootstrap') >= 0), v1probs.join(' | '));
check('V1e js/11-about.js 兜底字面量与 version.json 一致', !v1probs.some(p => p.indexOf('兜底字面量') >= 0), v1probs.join(' | '));
check('V1f sw.js CACHE_NAME 存在', /const\s+CACHE_NAME\s*=\s*['"]/.test(swJs));
check('V1g sw.js CACHE_NAME 与 version.json 一致(缓存优先下不同步=修了也到不了用户)', !v1probs.some(p => p.indexOf('sw.js') >= 0), v1probs.join(' | '));
check('V1i demo.html sync-local-ver 与 version.json 一致', !v1probs.some(p => p.indexOf('demo.html') >= 0), v1probs.join(' | '));
check('V1j js/11-about.js VERSION_HISTORY 最新条目与 version.json 一致', !v1probs.some(p => p.indexOf('VERSION_HISTORY') >= 0), v1probs.join(' | '));
check('V1 汇总: 七源问题清单为空', v1probs.length === 0, v1probs.join(' | '));

/* ---------- V2 变异自证: 改成"推导"后防线仍有效(不恒真) ----------
 * 若只把期望值改成推导、却不验"能否抓到不一致", 这道防线就退化成恒真。
 * 这里对每一个源做一次变异, 断言 _versionProblems 必须报出对应问题。 */
section('V1m 变异自证: 改坏任一源 → 一致性判定必红');
const _mut = (o, k, from, to) => { const c = Object.assign({}, o); c[k] = String(o[k]).split(from).join(to); return c; };
const _mutCode = (code) => { const c = Object.assign({}, REAL_SOURCES); c.version = Object.assign({}, versionJson, { versionCode: code }); return c; };
const MUTANTS = [
  ['M1 sw.js CACHE_NAME 改坏', _mut(REAL_SOURCES, 'sw', 'tcg-poweroff-v' + EXPECT_VER, 'tcg-poweroff-v9.9.9'), 'sw.js'],
  ['M2 config.xml version 改坏', _mut(REAL_SOURCES, 'config', 'version="' + EXPECT_VER + '"', 'version="9.9.9"'), 'config.xml'],
  ['M3 00-bootstrap APP_VERSION 改坏', _mut(REAL_SOURCES, 'bootstrap', "const APP_VERSION='" + EXPECT_VER + "';", "const APP_VERSION='9.9.9';"), '00-bootstrap'],
  ['M4 demo.html 显示版本改坏', _mut(REAL_SOURCES, 'demo', 'id="sync-local-ver">v' + EXPECT_VER, 'id="sync-local-ver">v9.9.9'), 'demo.html'],
  ['M5 11-about 兜底字面量改坏', _mut(REAL_SOURCES, 'about', "APP_VERSION || '" + EXPECT_VER + "'", "APP_VERSION || '9.9.9'"), '兜底字面量'],
  ['M6 versionCode 改坏', _mutCode(999999), 'versionCode']
];
MUTANTS.forEach(function(m){
  const probs = _versionProblems(m[1]);
  const caught = probs.length > 0 && probs.some(p => p.indexOf(m[2]) >= 0);
  check(m[0] + ' → 被判红(问题清单含 "' + m[2] + '")', caught, probs.join(' | ') || '(未报任何问题 = 防线失效)');
});

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
 * V4 网页端环境判定 + 死信号清理回归
 * ============================================================ */
section('V4 网页端环境判定与死信号清理');
check('V4a 探测式激活内设置 __TCG_WEB_MIRROR__(网页端判定依据)',
  /__TCG_WEB_MIRROR__\s*=\s*true/.test(webSyncJs));
check('V4b 已移除只写不读的 __TCG_WEB_MIGRATION_HINT__ 死信号(整洁性回归)',
  !/__TCG_WEB_MIGRATION_HINT__/.test(webSyncJs));

/* ============================================================
 * V5 行为级验证(jsdom 真实渲染): 登录失败 → 提示与重试按钮真的出现
 * ------------------------------------------------------------
 * 为什么不是"源码里含某字符串": 源码匹配无法发现"函数定义了却没被调用""提示
 * 元素被删/被隐藏"等回归。这里真实执行 doLogin 的失败路径, 断言 DOM 上确实渲染
 * 出可操作提示与「我已升级，重新登录」按钮。
 * 安全约束: 宽提示是**隐私选择**(镜像不含手机号, 收窄提示会泄露账号存在性),
 * 故断言文案与账号存在性无关(仅"账号或密码错误"通用开头)。
 * ============================================================ */
section('V5 行为级: 网页端登录失败真实渲染提示(jsdom)');
(async function(){
  let ok = false, detail = '';
  try {
    const { JSDOM } = require('jsdom');
    /* url 必填: 否则 origin 为 opaque, jsdom 的 localStorage 不可用(doLogin 会用到) */
    const dom = new JSDOM(src('demo.html'), { url: 'https://tcg.test/demo.html', runScripts: 'outside-only', pretendToBeVisual: true });
    const win = dom.window;
    /* 只注入 doLogin 失败路径所需的最小全局(成功路径的依赖不会被触达)。
     * USERS 为空 + pullApprovedStatusFromFeishu 返回 false ⇒ 必落"账号未命中"失败分支。 */
    win.USERS = [];
    win.state = { currentUser: null };
    win.showToast = function(){};
    win.pullApprovedStatusFromFeishu = async function(){ return false; };
    win.APP_VERSION = EXPECT_VER;
    win.__TCG_WEB_MIRROR__ = true; /* 纯网页镜像端 */
    win.eval(authJs);              /* 顶层 function 声明挂到 win(window.doLogin 等) */
    win.document.getElementById('login-phone').value = '13800000000';
    win.document.getElementById('login-pass').value = 'whatever1';
    await win.eval('doLogin()');
    const el = win.document.getElementById('login-hint');
    const html = el ? el.innerHTML : '';
    ok = !!el && !el.classList.contains('hidden')
      && html.indexOf('账号或密码错误') >= 0
      && html.indexOf('我已升级，重新登录') >= 0
      && /doLogin\s*\(/.test(html);
    detail = 'hidden=' + (el ? el.classList.contains('hidden') : 'no-el') + ' html=' + html.slice(0, 70);
  } catch (e) { detail = 'exception: ' + e.message; }
  check('V5a 行为级: 登录失败 → #login-hint 可见且含文案与重试按钮', ok, detail);
  finish();
})();

/* 汇总在异步行为断言完成后输出(避免 process.exit 抢跑, 漏报 V5) */
function finish(){
  console.log('\n==============================================================');
  console.log('P0 迁移缺口 UX 修复测试汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
}
