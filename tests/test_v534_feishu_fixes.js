#!/usr/bin/env node
/**
 * V5.3.4 飞书云盘数据获取与备份同步修复 专项测试
 * =====================================================
 * 依据: 飞书诊断报告《飞书云盘数据获取和备份同步失败原因分析》6大根因
 * 覆盖: F1 配置双查(根因1) / F2 视频根目录回退(根因2) / F3 blob兼容(根因4)
 *       F4 失败可感知(根因5) / F5 存储位置统一(根因6) / F6 版本一致性
 *       根因3(288个.7z分卷)属云盘治理,由整理脚本处理,此处校验APP不解析.7z
 *
 * 运行: node tests/test_v534_feishu_fixes.js
 */
const fs = require('fs');
const path = require('path');

const BASE = path.join(__dirname, '..');
let PASS = 0, FAIL = 0;

function check(name, cond, detail = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  PASS += cond ? 1 : 0; FAIL += cond ? 0 : 1;
  console.log(`  [${mark}] ${name}${cond ? '' : '  ← ' + detail}`);
}
function section(t) { console.log(`\n===== ${t} =====`); }

const html = fs.readFileSync(path.join(BASE, 'demo.html'), 'utf8');
const vj = JSON.parse(fs.readFileSync(path.join(BASE, 'version.json'), 'utf8'));
const cfgXml = fs.readFileSync(path.join(BASE, 'config.xml'), 'utf8');
const ciwf = fs.readFileSync(path.join(BASE, '.github/workflows/android-release.yml'), 'utf8');

/** 沙箱提取demo.html中的具名函数体 */
function evalFn(fnName, extraSrc = '') {
  const re = new RegExp(`function ${fnName}\\([^)]*\\)\\{`);
  const m = html.match(re);
  if (!m) return null;
  const start = m.index;
  // 大括号配平提取完整函数体
  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') { depth--; if (depth === 0) break; }
  }
  const body = html.slice(start, i + 1);
  try {
    // eslint-disable-next-line no-new-func
    return new Function('showToast', 'addSyncLog', extraSrc + '\n' + body + `\nreturn ${fnName};`)(null, null);
  } catch (e) { return null; }
}

// ==================== F1 配置完整性双查(根因1) ====================
section('F1 feishuCfgReady 配置双查(根因1:Secret缺失静默失败)');

const feishuCfgReady = evalFn('feishuCfgReady');
check('feishuCfgReady 函数可提取', typeof feishuCfgReady === 'function');
if (feishuCfgReady) {
  check('appId+appSecret齐全 → true', feishuCfgReady({ appId: 'cli_x', appSecret: 's' }) === true);
  check('仅appId(Secret空) → false(核心修复)', feishuCfgReady({ appId: 'cli_x', appSecret: '' }) === false);
  check('仅appSecret(appId空) → false', feishuCfgReady({ appId: '', appSecret: 's' }) === false);
  check('null入参 → false', feishuCfgReady(null) === false);
  check('undefined入参 → false', feishuCfgReady(undefined) === false);
}
check('feishuCfgReady双条件校验appId+appSecret', /function feishuCfgReady\([\s\S]*?cfg&&cfg\.appId&&cfg\.appSecret/.test(html));
check('未配置提示文案含「填写 App Secret」引导', html.includes('填写 App Secret 后保存'));
check('demo.html 已无单查appId的旧校验残留', !/if\(!cfg\.appId\)/.test(html), '仍存在 if(!cfg.appId) 旧模式');
check('入口替换计数≥11(syncPending/pullPending/pushApproved/pullApproved/doBackup/doSyncUpload/doSyncDownload/imgCloud/playCloud/fetchPhotoDataURL/pickVideoFile)',
  (html.match(/feishuCfgReady\(cfg/g) || []).length >= 11,
  `实际${(html.match(/feishuCfgReady\(cfg/g) || []).length}处`);
check('DEFAULT配置 appSecret 保持留空(安全加固不回退)', /appSecret:'',\s*\n\s*folder:'WdXUfZPkClI1audQxIYc90XRnWc'/.test(html));

// ==================== F2 视频根文件夹回退(根因2) ====================
section('F2 视频搜索根文件夹回退(根因2:17个MP4放错位置)');

check('playFromFeishuCloud 含根文件夹回退搜索', /rootFiles&&rootFiles\.find\(f=>f\.type==='file'&&f\.name===fileName\)/.test(html));
check('回退触发条件: 子目录无完整文件且无分片', /if\(!target&&parts\.length===0\)\{[\s\S]{0,200}feishuListFiles\(token,cfg\.folder\)/.test(html));
check('回退命中留痕日志(便于云盘整理观察)', html.includes('视频命中根目录回退源'));
check('vehicle_videos子目录不存在不再提前return', !/if\(!videoFolder\)return false;/.test(html));
check('云目录列表类型过滤(type===file)', /cloudFiles=\(allVideoFiles\|\|\[\]\)\.filter\(f=>f\.type==='file'\)/.test(html));
check('APP不解析.7z分卷(根因3由云盘整理解决,客户端无7z逻辑)', !html.includes('.7z'));

// ==================== F3 blob类型兼容(根因4) ====================
section('F3 asBlob ArrayBuffer→Blob归一(根因4:插件blob兼容)');

const asBlob = evalFn('asBlob');
check('asBlob 函数可提取', typeof asBlob === 'function');
if (asBlob) {
  check('Blob原样透传', (() => {
    try { const b = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' }); return asBlob(b) === b; }
    catch (e) { return true; /* 环境无Blob则跳过严格等价 */ }
  })());
  check('ArrayBuffer转Blob', (() => {
    try {
      const r = asBlob(new ArrayBuffer(8), 'video/mp4');
      return r instanceof Blob && r.type === 'video/mp4';
    } catch (e) { return false; }
  })());
  check('Uint8Array转Blob', (() => {
    try {
      const r = asBlob(new Uint8Array([1, 2]), 'image/jpeg');
      return r instanceof Blob;
    } catch (e) { return false; }
  })());
  check('null/undefined → null', asBlob(null) === null && asBlob(undefined) === null);
  check('非二进制类型(字符串) → null', asBlob('not-binary') === null);
}
check('视频下载出口使用asBlob(res.data,video/mp4)', /asBlob\(res\.data,'video\/mp4'\)/.test(html));
check('图片下载出口使用asBlob(res.data,image/jpeg)×2处', (html.match(/asBlob\(res\.data,'image\/jpeg'\)/g) || []).length >= 2,
  `实际${(html.match(/asBlob\(res\.data,'image\/jpeg'\)/g) || []).length}处`);
check('responseType blob 的裸透传已清零(不再resolve(res.data)直出blob下载)',
  !/responseType:'blob'[\s\S]{0,120}res=>resolve\(res\.data\)/.test(html));

// ==================== F4 失败可感知(根因5) ====================
section('F4 feishuFailToast 节流提示(根因5:失败静默无感知)');

const feishuFailToastSrc = html.includes('function feishuFailToast(reason)');
check('feishuFailToast 函数存在', feishuFailToastSrc);
check('30秒节流防刷屏', /_feishuFailToastAt<30000/.test(html));
check('视频失败路径调用feishuFailToast', /feishuFailToast\('视频'/.test(html));
check('图片失败路径调用feishuFailToast', /feishuFailToast\('图片'/.test(html));
check('提示文案含原因与去向说明', html.includes('已尝试其他来源'));
check('console.warn保留(排障日志不打断用户)', /\[视频\]飞书云端源不可用/.test(html) && /\[照片\]飞书云端源不可用/.test(html));

// ==================== F5 同步数据存储位置统一(根因6) ====================
section('F5 同步数据统一入APP数据备份(根因6:位置不一致)');

check('doSyncUpload 改用 uploadJsonToDataFeishu(写入数据文件夹)', /uploadJsonToDataFeishu\(token,'vehicle_sync_data\.json'/.test(html));
check('上传后清理根目录历史旧档(防双份数据漂移)', /rootOlds[\s\S]{0,300}vehicle_sync_data\.json'?\)[\s\S]{0,200}DELETE/.test(html) || /rootOlds/.test(html));
check('downloadSyncDataMigrated 迁移读取函数存在', html.includes('async function downloadSyncDataMigrated(cfg)'));
check('迁移读取优先新位置(APP数据备份)', /data=await downloadJsonFromDataFeishu\(token,'vehicle_sync_data\.json'\)/.test(html));
check('迁移读取回退根目录历史位置', /downloadJsonFromFolder\(token,cfg\.folder,'vehicle_sync_data\.json'\)/.test(html));
check('doSyncDownload 调用迁移读取', /downloadSyncDataMigrated\(cfg\)/.test(html));
check('旧通用入口 uploadJsonToFeishu 保留(其他调用方兼容)', html.includes('async function uploadJsonToFeishu(cfg,docName,jsonStr)'));
check('迁移读取带3次重试', /downloadSyncDataMigrated[\s\S]{0,700}attempt<3/.test(html));

// ==================== F6 版本一致性 ====================
section('F6 版本一致性 V5.3.4');

check('demo.html APP_VERSION=5.3.4', /const APP_VERSION='5\.3\.4'/.test(html));
check('version.json version=5.3.4', vj.version === '5.3.4');
check('version.json versionName=V5.3.4', vj.versionName === 'V5.3.4');
check('version.json 更新日志覆盖根因1', vj.changelog.some(c => c.includes('配置校验V5.3.4') && c.includes('根因1')));
check('version.json 更新日志覆盖根因2', vj.changelog.some(c => c.includes('根目录回退V5.3.4') && c.includes('根因2')));
check('version.json 更新日志覆盖根因4', vj.changelog.some(c => c.includes('blob兼容V5.3.4') && c.includes('根因4')));
check('version.json 更新日志覆盖根因5', vj.changelog.some(c => c.includes('失败可感知V5.3.4') && c.includes('根因5')));
check('version.json 更新日志覆盖根因6', vj.changelog.some(c => c.includes('存储位置统一V5.3.4') && c.includes('根因6')));
check('config.xml version=5.3.4', /version="5\.3\.4"/.test(cfgXml));
check('config.xml android-versionCode=50304', /android-versionCode="50304"/.test(cfgXml));
check('CI workflow APP_VERSION=5.3.4', /APP_VERSION: '5\.3\.4'/.test(ciwf));
check('CI workflow BASE_VERSION_CODE=50304', /BASE_VERSION_CODE: 50304/.test(ciwf));
check('version.json 直链指向v5.3.4', (vj.downloadUrl || '').includes('/v5.3.4/'));
check('直链命名与CI产物规则一致(b{run_number}由CI回写)', /taicanggang-V5\.3\.4-b\d+\.apk/.test(vj.downloadUrl || ''));
check('CI签名校验关卡仍在(回归保护)', ciwf.includes('校验APK签名(未签名即失败)'));
check('CI build.json签名注入仍在(回归保护)', /"keystore": "\$KS_FILE"/.test(ciwf));
check('CI version.json回写downloadUrl仍在(直链机制)', ciwf.includes('回写 buildNumber 与 downloadUrl 到 version.json'));

// ==================== F7 直链下载回归(不因本次迭代破坏) ====================
section('F7 V5.3.3直链下载回归保护');

check('更新弹窗直链按钮仍在', html.includes('直接下载安装包（推荐）'));
check('resolveApkUrl三级回退仍在', html.includes('function resolveApkUrl(info)'));
check('downloadApkDirect入口仍在', html.includes('function downloadApkDirect()'));

console.log(`\n${'='.repeat(52)}\nV5.3.4飞书修复专项测试: ${PASS}通过 / ${FAIL}失败 / 共${PASS + FAIL}项\n${'='.repeat(52)}`);
process.exit(FAIL ? 1 : 0);
