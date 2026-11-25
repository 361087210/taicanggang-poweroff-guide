/**
 * ============================================================
 * test_v10285_update_prompt.js — 更新提示逻辑回归
 * ============================================================
 * 背景: 更新提示的判定完全在客户端(js/07-cache.js), 之前零测试覆盖 ——
 *       改一行比较逻辑就可能让"该提示的不提示"或"永远提示已是最新"。
 * 覆盖:
 *   U1 versionNewer —— 按点分段比数值(不按字符串)、缺位补 0、后缀与异常形态
 *   U2 fetchUpdateInfo —— 多源探测取**最高版本**(不是首个成功)、单源失败不拖累、
 *      飞书兜底、全失败返回 null、GitHub API 的 base64 源参与比较
 *   U3 接线契约 —— 启动 3 秒静默检查、跳过键写入/读取、手动检查不受跳过影响、版本源顺序
 *
 * 做法: 从 js/07-cache.js 抽出真函数体, 在 vm 里用桩执行(不联网)。
 * 运行: node tests/test_v10285_update_prompt.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'js', '07-cache.js');
const src = fs.readFileSync(SOURCE, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* 从源码里截取一个函数块(到下一个指定标记为止) */
function block(startMarker, endMarker) {
  const i = src.indexOf(startMarker);
  if (i < 0) throw new Error('源码中找不到: ' + startMarker);
  const j = endMarker ? src.indexOf(endMarker, i) : -1;
  return src.slice(i, j > 0 ? j : src.length);
}

let sandbox = null;
try {
  const sandboxObj = {
    console: { debug() {}, warn() {}, log() {} },
    atob, TextDecoder, Uint8Array,
    setTimeout, clearTimeout,          /* fetchWithTimeout 的超时计时器 */
    GITHUB_REPO: '361087210/taicanggang-poweroff-guide',
    UPDATE_SOURCES: [], UPDATE_API_SOURCE: '',
    DEFAULT_FEISHU_CONFIG: {},
    downloadJsonFromFeishu: null, httpFetch: null
  };
  vm.createContext(sandboxObj);
  vm.runInContext(
    block('function versionNewer(', '/**\n * 获取最新版本信息') + '\r\n' +
    block('async function fetchUpdateInfo(', 'async function checkUpdate(') + '\r\n' +
    block('function resolveApkUrl(', '\nfunction downloadApkDirect('),
    sandboxObj, { filename: SOURCE });
  sandbox = sandboxObj;
} catch (e) {
  check('U0 可抽出并加载 versionNewer / fetchUpdateInfo', false, e.message);
}

section('U1 versionNewer 按数值比较');
const vn = (a, b) => vm.runInContext('versionNewer(' + JSON.stringify(a) + ',' + JSON.stringify(b) + ')', sandbox);
check('U1a 10.28.0 > 10.27.11(不按字符串比)', vn('10.28.0', '10.27.11') === true);
check('U1b 10.9.0 > 10.27.11 为假(小数段按数值)', vn('10.9.0', '10.27.11') === false);
check('U1c 同版本为假', vn('10.28.0', '10.28.0') === false);
check('U1d 10.28 vs 10.28.0 为假(缺位补 0)', vn('10.28', '10.28.0') === false);
check('U1e 10.28.1 > 10.28', vn('10.28.1', '10.28') === true);
check('U1f 10.28.0.1 > 10.28.0', vn('10.28.0.1', '10.28.0') === true);
check('U1g 后缀 -beta 被截断后相等', vn('10.28.0-beta', '10.28.0') === false);
check('U1h 带 v 前缀的版本串被算成 0(已知边界: version.json 必须写裸版本号)',
  vn('v10.28.0', '10.27.11') === false);

function runFetch(canned) {
  sandbox.UPDATE_SOURCES = Object.keys(canned.sources || {});
  sandbox.UPDATE_API_SOURCE = 'https://api/';
  sandbox.DEFAULT_FEISHU_CONFIG = canned.feishu ? { appId: 'x' } : {};
  sandbox.httpFetch = async (url) => {
    if (canned.sources && url.startsWith('s')) {
      const key = url.split('?')[0];
      if (canned.sources[key] instanceof Error) throw canned.sources[key];
      return JSON.parse(JSON.stringify(canned.sources[key]));
    }
    if (url.startsWith('https://api/')) {
      if (canned.api === undefined) throw new Error('net');
      return { content: Buffer.from(JSON.stringify(canned.api)).toString('base64') };
    }
    throw new Error('unexpected ' + url);
  };
  sandbox.downloadJsonFromFeishu = async () => {
    if (canned.feishu === undefined) throw new Error('no feishu');
    return JSON.parse(JSON.stringify(canned.feishu));
  };
  return vm.runInContext('fetchUpdateInfo()', sandbox);
}

(async function () {
  if (!sandbox) {
    console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
    process.exit(1);
  }

  section('U2 fetchUpdateInfo 多源探测');
  let r = await runFetch({ sources: { s1: { version: '10.26.0' }, s2: { version: '10.28.0' }, s3: { version: '10.27.0' } } });
  check('U2a 取最高版本而不是首个成功', r && r.version === '10.28.0', r && r.version);

  r = await runFetch({ sources: { s1: new Error('timeout'), s2: { version: '10.27.0' } } });
  check('U2b 单源超时不影响其余源', r && r.version === '10.27.0', r && r.version);

  r = await runFetch({ sources: { s1: new Error('x') }, feishu: { version: '10.29.0' } });
  check('U2c 全部 CDN 失败时飞书源兜底', r && r.version === '10.29.0', r && r.version);

  r = await runFetch({ sources: { s1: new Error('x') } });
  check('U2d 全部失败返回 null(界面提示检查失败)', r === null || r === undefined, String(r));

  r = await runFetch({ sources: { s1: { version: '10.26.0' } }, api: { version: '10.28.0' } });
  check('U2e GitHub API 源(base64)参与比较', r && r.version === '10.28.0', r && r.version);

  r = await runFetch({ sources: { s1: { versionName: 'V10.30.0' } } });
  check('U2f 缺少 version 字段的数据被忽略', r === null || r === undefined, String(r));

  section('U3 接线契约(启动/跳过/版本源)');
  const main = fs.readFileSync(path.join(ROOT, 'js', '08-main.js'), 'utf8');
  const boot = fs.readFileSync(path.join(ROOT, 'js', '00-bootstrap.js'), 'utf8');
  check('U3a 启动后 3 秒静默检查一次',
    /setTimeout\(\(\)\s*=>\s*\{\s*checkUpdate\(true\)/.test(main));
  check('U3b 跳过只记版本号(update_skipped_ver)',
    src.indexOf("localStorage.setItem('update_skipped_ver'") >= 0 &&
    src.indexOf("localStorage.getItem('update_skipped_ver')") >= 0);
  check('U3c 只有静默检查尊重跳过(silent&&skipped)',
    /if\s*\(\s*silent\s*&&\s*skipped/.test(src));
  check('U3d 只有更新版本才弹窗(versionNewer 为真)',
    /if\s*\(\s*!versionNewer\(\s*info\.version\s*,\s*APP_VERSION\s*\)\s*\)/.test(src));
  check('U3e 版本源顺序: jsDelivr → raw → API → 飞书',
    boot.indexOf('cdn.jsdelivr.net/gh/') >= 0 &&
    boot.indexOf('cdn.jsdelivr.net/gh/') < boot.indexOf('raw.githubusercontent.com/') &&
    boot.indexOf('api.github.com/repos/') > boot.indexOf('raw.githubusercontent.com/') &&
    src.indexOf('downloadJsonFromFeishu(cfg,') > src.indexOf('UPDATE_API_SOURCE+'));
  const androidWf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'android-release.yml'), 'utf8');
  check('U3f 发版回写 apkSize(否则弹窗永远只显示"直链下载已就绪")',
    androidWf.indexOf('"apkSize"') >= 0 && /stat -c%s/.test(androidWf));

  section('U4 resolveApkUrl 直链三级回退');
  const rap = (o) => vm.runInContext('resolveApkUrl(' + JSON.stringify(o) + ')', sandbox);
  check('U4a L1 优先 downloadUrl', rap({ version: '10.28.1', downloadUrl: 'https://x/a.apk' }) === 'https://x/a.apk');
  check('U4b L2 兼容 apkUrl', rap({ version: '10.28.1', apkUrl: 'https://x/b.apk' }) === 'https://x/b.apk');
  check('U4c L2 过滤 V5.3 断链', String(rap({ version: '10.28.1', apkUrl: 'https://h/releases/download/V5.3/x.apk' })).indexOf('/download/V5.3/') < 0);
  check('U4d L3 兜底与 CI 产物命名一致(tcg_poweroff_v{ver}.apk)',
    rap({ version: '10.28.1' }) === 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v10.28.1/tcg_poweroff_v10.28.1.apk',
    rap({ version: '10.28.1' }));
  check('U4e 无任何版本字段时返回 null', rap({}) === null);
  check('U4f 不再写死 v5.7 资产地址', src.indexOf('/download/v5.7/') < 0);

  console.log('\n========== 结果 ==========');
  console.log(pass + ' passed, ' + fail + ' failed');
  if (fail) console.log('失败项: ' + failures.join(' | '));
  process.exit(fail ? 1 : 0);
})();
