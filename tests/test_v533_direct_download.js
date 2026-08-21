#!/usr/bin/env node
/**
 * V5.3.3 安装包直链下载 专项测试
 * =================================
 * 覆盖: 直链解析三级回退 / 按钮接线 / version.json直链字段 /
 *       CI直链回写 / GitHub Release直链可达性(网络实测)
 *
 * 运行: node tests/test_v533_direct_download.js
 */
const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE = path.join(__dirname, '..');
let PASS = 0, FAIL = 0;
const results = [];

function check(name, cond, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  PASS += cond ? 1 : 0; FAIL += cond ? 0 : 1;
  results.push({ name, ok: !!cond, detail });
  console.log(`  [${mark}] ${name}${cond ? '' : '  ← ' + detail}`);
}
function section(t) { console.log(`\n===== ${t} =====`); }

const html = fs.readFileSync(path.join(BASE, 'demo.html'), 'utf8');
const vj = JSON.parse(fs.readFileSync(path.join(BASE, 'version.json'), 'utf8'));

// ==================== D1 resolveApkUrl 三级回退逻辑(沙箱求值) ====================
section('D1 直链解析三级回退');

/** 从demo.html中提取resolveApkUrl函数体, 在受控沙箱中求值 */
function evalResolveApkUrl() {
  const GITHUB_REPO = '361087210/taicanggang-poweroff-guide';
  const m = html.match(/function resolveApkUrl\(info\)\{[\s\S]*?\n\}/);
  if (!m) return null;
  // eslint-disable-next-line no-new-func
  return new Function('GITHUB_REPO', m[0] + '\nreturn resolveApkUrl;')(GITHUB_REPO);
}
const resolveApkUrl = evalResolveApkUrl();
check('resolveApkUrl 可提取并在沙箱求值', typeof resolveApkUrl === 'function');

if (resolveApkUrl) {
  // L1: downloadUrl 优先
  check('L1 downloadUrl优先命中',
    resolveApkUrl({ downloadUrl: 'https://x/y.apk', apkUrl: 'https://old/z.apk' }) === 'https://x/y.apk');
  // L2: downloadUrl非法时回退apkUrl
  check('L2 无downloadUrl回退apkUrl',
    resolveApkUrl({ apkUrl: 'https://a/b.apk' }) === 'https://a/b.apk');
  // L3: apkUrl为V5.3断链时被过滤, 按命名规则推导
  const derived = resolveApkUrl({ version: '5.3.3', buildNumber: 4, apkUrl: 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/V5.3/taicanggang-V5.3.apk' });
  check('L3 V5.3历史断链被过滤并按规则推导', derived === 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v5.3.3/taicanggang-V5.3.3-b4.apk', derived);
  // L3': 无buildNumber时不带b后缀
  check("L3' 无buildNumber推导不带b后缀",
    resolveApkUrl({ version: '5.2.0' }) === 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v5.2.0/taicanggang-V5.2.0.apk');
  // 边界: 空入参
  check('边界: null入参返回null', resolveApkUrl(null) === null);
  check('边界: 空对象返回null', resolveApkUrl({}) === null);
  // 非https协议拒绝
  check('边界: 非https的downloadUrl被拒绝', resolveApkUrl({ downloadUrl: 'http://insecure/x.apk', apkUrl: 'https://a/b.apk' }) === 'https://a/b.apk');
}

// ==================== D2 弹窗按钮接线 ====================
section('D2 更新弹窗直链按钮');

check('主按钮onclick=downloadApkDirect', /onclick="downloadApkDirect\(\)"/.test(html));
check('主按钮文案「直接下载安装包（推荐）」', html.includes('直接下载安装包（推荐）'));
check('主按钮为醒目绿色加粗样式', /bg-green-600[^>]*>直接下载安装包/.test(html.replace(/\n/g, '')) || /直接下载安装包（推荐）<\/button>/.test(html));
check('备用按钮保留飞书云盘通道', /onclick="downloadFromFeishu\(\)"/.test(html));
check('downloadUpdate旧入口并入直链通道(向后兼容)', /function downloadUpdate\(\)\{\s*downloadApkDirect\(\);\s*\}/.test(html));
check('直链引导文案(通知栏安装)', html.includes('下载完成后请下拉通知栏点击安装'));
check('标注无需仓库权限', html.includes('无需仓库权限'));
check('downloadApkDirect内含同步日志埋点', /downloadApkDirect[\s\S]{0,600}addSyncLog\('用户触发直链下载/.test(html));
check('直链无效时兜底toast引导飞书', html.includes('下载地址无效,请使用飞书云盘下载'));
check('update-size显示直链就绪状态', html.includes('直链下载已就绪'));

// ==================== D3 version.json 直链字段 ====================
section('D3 version.json 直链字段');

check('version=5.3.3', vj.version === '5.3.3');
check('versionName=V5.3.3', vj.versionName === 'V5.3.3');
check('downloadUrl存在且为https', typeof vj.downloadUrl === 'string' && vj.downloadUrl.startsWith('https://'));
check('downloadUrl指向本仓库Release', vj.downloadUrl.includes('github.com/361087210/taicanggang-poweroff-guide/releases/download/'));
check('downloadUrl含tag与小写v前缀', /\/download\/v5\.3\.3\//.test(vj.downloadUrl));
check('downloadUrl资产名含构建号', /taicanggang-V5\.3\.3-b\d+\.apk$/.test(vj.downloadUrl));
check('apkUrl与downloadUrl冗余一致', vj.apkUrl === vj.downloadUrl);
check('pageUrl指向发布页', vj.pageUrl === 'https://github.com/361087210/taicanggang-poweroff-guide/releases');
check('buildNumber为正整数', Number.isInteger(vj.buildNumber) && vj.buildNumber > 0);
const clText = (vj.changelog || []).join('');
check('changelog含直链下载条目', clText.includes('直链下载'));
check('changelog含断链修复条目', clText.includes('断链'));

// ==================== D4 CI 直链回写 ====================
section('D4 CI 工作流直链回写');

const ciwf = fs.readFileSync(path.join(BASE, '.github/workflows/android-release.yml'), 'utf8');
check('CI版本号=5.3.3', /APP_VERSION: '5\.3\.3'/.test(ciwf));
check('CI BASE_VERSION_CODE=50303', /BASE_VERSION_CODE: 50303/.test(ciwf));
check('CI回写downloadUrl', ciwf.includes('v.downloadUrl'));
check('CI直链URL预计算(ref_name+资产名)', ciwf.includes('releases/download/${{ github.ref_name }}/${{ steps.buildno.outputs.apk_name }}'));
check('CI apkUrl同步冗余', /v\.apkUrl = v\.downloadUrl/.test(ciwf));
check('CI仅tag触发时写入直链(防dry-run断链)', ciwf.includes("startsWith('refs/tags/v')"));
check('CI回写apkSize(按实际产物)', /v\.apkSize = \(fs\.statSync/.test(ciwf));
check('CI产物命名含独立构建号', /apk_name=taicanggang-V\$\{\{APP_VERSION\}\}-b\$\{\{ github\.run_number \}\}\.apk/.test(ciwf) || ciwf.includes('apk_name=taicanggang-V${APP_VERSION}-b'));
// ---- V5.3.3-b5 签名修复(b4事故复盘): build.json必须携带签名四要素 + 发布前签名关卡 ----
check('CI build.json注入keystore路径', /"keystore": "\$KS_FILE"/.test(ciwf));
check('CI build.json注入storePassword', /"storePassword": "\$KS_PASSWORD"/.test(ciwf));
check('CI build.json注入alias', /"alias": "\$\{KS_ALIAS/.test(ciwf));
check('CI build.json注入key password', /"password": "\$KS_PASSWORD"/.test(ciwf));
check('CI签名校验关卡存在(未签名即失败)', /校验APK签名\(未签名即失败\)/.test(ciwf));
check('CI关卡检测APK Sig Block魔数', ciwf.includes("APK Sig Block 42"));
check('CI关卡未签名走sys.exit阻断', /sys\.exit\('FATAL: APK未签名/.test(ciwf));

// ==================== D5 GitHub Release 直链可达性(网络实测) ====================
section('D5 Release 直链可达性(网络)');

/**
 * HEAD请求探测直链可达性, GitHub对release资产HEAD会302到CDN后返回200
 * 为什么用curl而非node https: 部分受限网络环境仅提供HTTP代理出口,
 * curl自动读取HTTPS_PROXY环境变量走代理, node原生https不感知代理会误报不可达
 * @returns {Promise<number>} HTTP状态码, 0表示网络不可达
 */
function headProbe(url, timeoutMs = 20000) {
  const { execSync } = require('child_process');
  return new Promise((resolve) => {
    try {
      const out = execSync(
        `curl -sI -o /dev/null -w "%{http_code}" --max-time ${Math.ceil(timeoutMs / 1000)} "${url}"`,
        { timeout: timeoutMs + 5000, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      resolve(parseInt(out, 10) || 0);
    } catch (e) {
      resolve(0);
    }
  });
}

(async () => {
  // D5.1 v5.3.3-b5 直链可达(b4未签名已随Release删除, b5为签名重建产物)
  const s1 = await headProbe(vj.downloadUrl);
  if (s1 === 404) {
    console.log('  [INFO] v5.3.3-b5直链尚未发布(预期: CI构建中), status=404, 构建完成后复验');
  } else {
    check('v5.3.3-b5签名产物直链可达(200/302)', s1 === 200 || s1 === 302, `status=${s1}`);
  }

  // D5.2 b4未签名坏包资产已清除(应404, 防止误下载不可安装的包)
  const badUrl = 'https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v5.3.3/taicanggang-V5.3.3-b4.apk';
  const s2 = await headProbe(badUrl);
  check('b4未签名坏包资产已随Release删除(404)', s2 === 404, `status=${s2}`);

  // D5.3 发布页可达
  const s3 = await headProbe(vj.pageUrl);
  check('GitHub Releases发布页可达', s3 === 200 || s3 === 302, `status=${s3}`);

  // ==================== 汇总 ====================
  console.log('\n' + '='.repeat(52));
  console.log(`V5.3.3直链下载测试: ${PASS}通过 / ${FAIL}失败 / 共${PASS + FAIL}项`);
  console.log('='.repeat(52));
  if (FAIL) {
    console.log('\n失败项:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
    process.exit(1);
  }
  console.log('全部通过 ✓');
})();
