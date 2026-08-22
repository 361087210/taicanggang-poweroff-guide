/**
 * V5.3.6 飞书数据同步架构回归测试
 * 运行: node tests/test_v536_feishu_sync.js
 */
const fs = require('fs');
const assert = require('assert');

const ROOT = process.cwd();
const paths = {
  feishuApi: `${ROOT}/feishu-api.js`,
  demo: `${ROOT}/demo.html`,
  config: `${ROOT}/config.xml`,
  version: `${ROOT}/version.json`,
  workflow: `${ROOT}/.github/workflows/android-release.yml`,
};

let exitCode = 0;
function ok(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.error('  ❌ ' + msg); exitCode = 1; }

console.log('
========== V5.3.6 飞书数据同步架构回归测试 ==========
');

// P1: feishu-api.js 存在性与结构
console.log('P1: feishu-api.js 模块结构');
if (!fs.existsSync(paths.feishuApi)) { fail('feishu-api.js 不存在'); }
else {
  const api = fs.readFileSync(paths.feishuApi, 'utf8');
  const checks = [
    ['FeishuAPI', '命名空间对象'],
    ['getTenantToken', '认证函数'],
    ['driveUploadFile', '云文档上传'],
    ['driveDownloadFile', '云文档下载'],
    ['driveListFiles', '云文档列表'],
    ['bitableListRecords', 'Bitable 查询'],
    ['bitableBatchCreate', 'Bitable 批量创建'],
    ['bitableBatchUpdate', 'Bitable 批量更新'],
    ['approvalCreate', '审批创建'],
    ['approvalQuery', '审批查询'],
    ['sendGroupMessage', '群消息'],
    ['sendInteractiveCard', '交互卡片'],
    ['syncVehiclesToBitable', '车型上传同步'],
    ['syncVehiclesFromBitable', '车型下载同步'],
    ['syncUsersToBitable', '用户上传同步'],
    ['syncUsersFromBitable', '用户下载同步'],
    ['backupAllData', '全量备份'],
    ['restoreFromBackup', '数据恢复'],
    ['startAutoSync', '定时同步启动'],
    ['stopAutoSync', '定时同步停止'],
    ['isConfigReady', '配置就绪检查'],
    ['DEFAULTS', '默认配置常量'],
    ['maxRetries', '重试机制'],
    ['tokenExpiryMargin', 'Token 提前刷新'],
  ];
  for (const [token, desc] of checks) {
    try { assert(api.includes(token), `缺少 ${desc} (${token})`); ok(`${desc} 已存在`); }
    catch(e) { fail(e.message); }
  }
  try {
    assert(api.includes("cli_aa0ce4fd91f85be8"), '默认 appId 应已填入');
    ok('默认 appId 已填入');
    assert(api.includes("s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb"), '默认 appSecret 应已填入');
    ok('默认 appSecret 已填入');
  } catch(e) { fail(e.message); }
}

// P2: demo.html 集成
console.log('
P2: demo.html FeishuAPI 集成');
if (!fs.existsSync(paths.demo)) { fail('demo.html 不存在'); }
else {
  const demo = fs.readFileSync(paths.demo, 'utf8');
  try {
    assert(demo.includes('feishu-api.js'), '应引入 feishu-api.js');
    ok('引入 feishu-api.js');
  } catch(e) { fail(e.message); }
  try {
    assert(demo.includes('FeishuAPI'), '应使用 FeishuAPI 命名空间');
    ok('使用 FeishuAPI 命名空间');
  } catch(e) { fail(e.message); }
}

// P3: config.xml 版本与插件
console.log('
P3: config.xml 版本与插件');
const cfg = fs.readFileSync(paths.config, 'utf8');
try {
  assert(cfg.includes('version="5.3.6"'), 'widget version 应为 5.3.6');
  ok('widget version = 5.3.6');
  assert(cfg.includes('content src="demo.html"'), 'content src 应为 demo.html');
  ok('content src = demo.html (已修正)');
  assert(cfg.includes('cordova-plugin-local-notification'), '应声明 local-notification 插件');
  ok('local-notification 插件已声明');
  assert(cfg.includes('cordova-plugin-file-opener2'), '应声明 file-opener2 插件');
  ok('file-opener2 插件已声明');
} catch(e) { fail(e.message); }

// P4: version.json
console.log('
P4: version.json');
const v = JSON.parse(fs.readFileSync(paths.version, 'utf8'));
try {
  assert.strictEqual(v.version, '5.3.6');
  ok('version = 5.3.6');
  assert(v.versionCode >= 50306);
  ok(`versionCode = ${v.versionCode}`);
  assert(v.releaseNotes.some(s => s.includes('FeishuDataLayer')), 'releaseNotes 应提及架构重构');
  ok('releaseNotes 包含架构重构说明');
  assert(v.feishuConfig && v.feishuConfig.appId === 'cli_aa0ce4fd91f85be8');
  ok('feishuConfig.appId 正确');
} catch(e) { fail(e.message); }

// P5: CI Workflow
console.log('
P5: CI Workflow');
const wf = fs.readFileSync(paths.workflow, 'utf8');
try {
  assert(wf.includes('APP_VERSION: 5.3.6'), 'CI APP_VERSION 应为 5.3.6');
  ok('CI APP_VERSION = 5.3.6');
  assert(wf.includes('cp feishu-api.js tcg_app/www/'), 'CI 应复制 feishu-api.js');
  ok('CI 复制 feishu-api.js 到 www');
} catch(e) { fail(e.message); }

// P6: 降级保护
console.log('
P6: 降级保护');
try {
  const demo = fs.readFileSync(paths.demo, 'utf8');
  assert(demo.includes('downloadApkDirect'), '保留浏览器下载降级');
  ok('保留浏览器下载降级');
  assert(demo.includes('showToast'), '保留 Toast 通知降级');
  ok('保留 Toast 通知降级');
} catch(e) { fail(e.message); }

console.log('
========== 测试结束 ==========');
if (exitCode === 0) console.log('✅ 全部通过');
else console.log('❌ 存在失败项');
process.exit(exitCode);
