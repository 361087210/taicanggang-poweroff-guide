/**
 * V5.3.6 权限与通知增强 回归测试
 * 运行: node tests/test_v536_perms_notify.js
 */
const fs = require('fs');
const assert = require('assert');

const ROOT = process.cwd();
const configPath = `${ROOT}/config.xml`;
const demoPath = `${ROOT}/demo.html`;
const versionPath = `${ROOT}/version.json`;
const workflowPath = `${ROOT}/.github/workflows/android-release.yml`;

let exitCode = 0;
function ok(msg) { console.log('  ✅ ' + msg); }
function fail(msg) { console.error('  ❌ ' + msg); exitCode = 1; }

console.log('\n========== V5.3.6 权限与通知回归测试 ==========\n');

// ---------- P1: config.xml 权限声明 ----------
console.log('P1: config.xml 权限声明');
if (!fs.existsSync(configPath)) { fail('config.xml 不存在'); }
else {
    const cfg = fs.readFileSync(configPath, 'utf8');
    try {
        assert(cfg.includes('version="5.3.6"'), 'widget version 应为 5.3.6');
        ok('widget version = 5.3.6');
    } catch(e) { fail(e.message); }
    try {
        assert(cfg.includes('android.permission.POST_NOTIFICATIONS'), '缺少 POST_NOTIFICATIONS 权限');
        ok('POST_NOTIFICATIONS 已声明');
    } catch(e) { fail(e.message); }
    try {
        assert(cfg.includes('android.permission.REQUEST_INSTALL_PACKAGES'), '缺少 REQUEST_INSTALL_PACKAGES 权限');
        ok('REQUEST_INSTALL_PACKAGES 已声明');
    } catch(e) { fail(e.message); }
    try {
        assert(cfg.includes('android.permission.VIBRATE'), '缺少 VIBRATE 权限');
        ok('VIBRATE 已声明');
    } catch(e) { fail(e.message); }
    try {
        assert(/READ_EXTERNAL_STORAGE.*maxSdkVersion="32"/.test(cfg), 'READ_EXTERNAL_STORAGE 应带 maxSdkVersion="32"');
        ok('READ_EXTERNAL_STORAGE maxSdkVersion=32');
    } catch(e) { fail(e.message); }
    try {
        assert(/WRITE_EXTERNAL_STORAGE.*maxSdkVersion="28"/.test(cfg), 'WRITE_EXTERNAL_STORAGE 应带 maxSdkVersion="28"');
        ok('WRITE_EXTERNAL_STORAGE maxSdkVersion=28');
    } catch(e) { fail(e.message); }
}

// ---------- P2: config.xml 插件声明 ----------
console.log('\nP2: config.xml 插件声明');
try {
    const cfg = fs.readFileSync(configPath, 'utf8');
    assert(cfg.includes('cordova-plugin-local-notification'), '缺少 cordova-plugin-local-notification 插件');
    ok('cordova-plugin-local-notification 已声明');
    assert(cfg.includes('cordova-plugin-file-opener2'), '缺少 cordova-plugin-file-opener2 插件');
    ok('cordova-plugin-file-opener2 已声明');
} catch(e) { fail(e.message); }

// ---------- P3: demo.html 函数存在性 ----------
console.log('\nP3: demo.html 函数存在性');
if (!fs.existsSync(demoPath)) { fail('demo.html 不存在'); }
else {
    const demo = fs.readFileSync(demoPath, 'utf8');
    const checks = [
        ['ensureNotifyPermission', '通知权限请求函数'],
        ['leaderNotify', '组长通知函数'],
        ['downloadAndInstallApk', '应用内下载安装函数'],
        ['cordova.plugins.notification.local.schedule', '本地通知调度调用'],
        ['cordova.plugins.fileOpener2.open', '文件打开器调用'],
        ['cordova.plugin.http.downloadFile', 'HTTP下载调用'],
        ['btn-install-apk', '安装按钮ID'],
    ];
    for (const [token, desc] of checks) {
        try {
            assert(demo.includes(token), `缺少 ${desc} (${token})`);
            ok(`${desc} 已存在`);
        } catch(e) { fail(e.message); }
    }
}

// ---------- P4: demo.html 版本一致性 ----------
console.log('\nP4: demo.html 版本一致性');
try {
    const demo = fs.readFileSync(demoPath, 'utf8');
    assert(demo.includes('content="5.3.6"'), 'meta version 应为 5.3.6');
    ok('meta version = 5.3.6');
    assert(demo.includes('V5.3.6</title>'), 'title 应包含 V5.3.6');
    ok('title 包含 V5.3.6');
    assert(demo.includes('build" content="50306"'), 'meta build 应为 50306');
    ok('meta build = 50306');
} catch(e) { fail(e.message); }

// ---------- P5: 更新弹窗按钮加载状态 ----------
console.log('\nP5: 更新弹窗按钮与加载状态');
try {
    const demo = fs.readFileSync(demoPath, 'utf8');
    assert(demo.includes('应用内下载并安装'), '缺少"应用内下载并安装"按钮文案');
    ok('主按钮文案: 应用内下载并安装');
    assert(demo.includes('浏览器下载安装包'), '缺少"浏览器下载安装包"按钮文案');
    ok('次按钮文案: 浏览器下载安装包');
    assert(demo.includes('btn.disabled = true'), '下载过程应禁用按钮');
    ok('下载过程禁用按钮（防重复点击）');
    assert(demo.includes('btn.disabled = false'), '完成后应恢复按钮');
    ok('完成后恢复按钮状态');
} catch(e) { fail(e.message); }

// ---------- P6: 审批轮询通知接线 ----------
console.log('\nP6: 审批轮询通知接线');
try {
    const demo = fs.readFileSync(demoPath, 'utf8');
    // 确认 leaderNotify 被 pullPendingFromFeishu 调用
    const idxNotify = demo.indexOf('leaderNotify(');
    const idxPull = demo.indexOf('pullPendingFromFeishu');
    assert(idxNotify > 0 && idxPull > 0 && idxNotify > idxPull, 'leaderNotify 应在 pullPendingFromFeishu 之后被调用');
    ok('leaderNotify 在 pullPendingFromFeishu 作用域内被调用');
    // 确认 ensureNotifyPermission 在登录流程中被调用
    const idxEnsure = demo.indexOf('ensureNotifyPermission()');
    const idxLogin = demo.indexOf('组长登录成功');
    assert(idxEnsure > 0 && idxLogin > 0 && idxEnsure > idxLogin, 'ensureNotifyPermission 应在组长登录后被调用');
    ok('ensureNotifyPermission 在组长登录后调用');
} catch(e) { fail(e.message); }

// ---------- P7: version.json ----------
console.log('\nP7: version.json');
if (!fs.existsSync(versionPath)) { fail('version.json 不存在'); }
else {
    const v = JSON.parse(fs.readFileSync(versionPath, 'utf8'));
    try {
        assert.strictEqual(v.version, '5.3.6', 'version 应为 5.3.6');
        ok('version = 5.3.6');
    } catch(e) { fail(e.message); }
    try {
        assert(v.versionCode >= 50306, 'versionCode 应 >= 50306');
        ok(`versionCode = ${v.versionCode}`);
    } catch(e) { fail(e.message); }
    try {
        assert(Array.isArray(v.releaseNotes) && v.releaseNotes.some(s => s.includes('通知')), 'releaseNotes 应包含通知相关描述');
        ok('releaseNotes 包含通知增强描述');
    } catch(e) { fail(e.message); }
}

// ---------- P8: CI 工作流版本 ----------
console.log('\nP8: CI 工作流版本');
if (!fs.existsSync(workflowPath)) { fail('android-release.yml 不存在'); }
else {
    const wf = fs.readFileSync(workflowPath, 'utf8');
    try {
        assert(wf.includes("APP_VERSION: 5.3.6"), 'CI APP_VERSION 应为 5.3.6');
        ok('CI APP_VERSION = 5.3.6');
    } catch(e) { fail(e.message); }
    try {
        assert(wf.includes("BASE: 50306"), 'CI BASE 应为 50306');
        ok('CI BASE = 50306');
    } catch(e) { fail(e.message); }
    try {
        assert(wf.includes('cordova-plugin-local-notification@1.2.3'), 'CI 应安装 local-notification 插件');
        ok('CI 安装 cordova-plugin-local-notification@1.2.3');
    } catch(e) { fail(e.message); }
    try {
        assert(wf.includes('cordova-plugin-file-opener2@4.0.0'), 'CI 应安装 file-opener2 插件');
        ok('CI 安装 cordova-plugin-file-opener2@4.0.0');
    } catch(e) { fail(e.message); }
}

// ---------- P9: 降级保护（旧测试仍应通过） ----------
console.log('\nP9: 降级保护（V5.3.4/5.3.5 能力保留）');
try {
    const demo = fs.readFileSync(demoPath, 'utf8');
    const cfg = fs.readFileSync(configPath, 'utf8');
    assert(demo.includes('downloadApkDirect'), '应保留 downloadApkDirect 作为降级');
    ok('保留 downloadApkDirect 降级');
    assert(demo.includes('openExternal'), '应保留 openExternal');
    ok('保留 openExternal');
    assert(demo.includes('showToast'), '应保留 showToast');
    ok('保留 showToast');
    assert(cfg.includes('cordova-plugin-advanced-http'), '应保留 advanced-http 插件');
    ok('保留 cordova-plugin-advanced-http');
} catch(e) { fail(e.message); }

console.log('\n========== 测试结束 ==========');
if (exitCode === 0) {
    console.log('✅ 全部通过');
} else {
    console.log('❌ 存在失败项');
}
process.exit(exitCode);
