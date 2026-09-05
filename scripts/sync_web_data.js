#!/usr/bin/env node
/**
 * ============================================================
 * 网页版数据镜像同步脚本 V1.0 (V10.14.3 配套)
 * ============================================================
 * 背景: 飞书OpenAPI响应头不携带Access-Control-Allow-Origin,
 *      浏览器(GitHub Pages网页版)直接fetch飞书API会被CORS策略100%拦截;
 *      安卓版靠cordova-plugin-advanced-http原生层发请求绕过CORS,
 *      网页版无此能力 → 车型/账号数据永远拉不到飞书云端。
 * 方案: 本脚本运行在GitHub Actions(服务端,无CORS限制),
 *      定时从飞书云端拉取最新数据,镜像到仓库web-data/目录,
 *      前端从同源web-data/读取(零CORS问题) → 网页版与安卓版数据同步。
 *
 * 数据流: 组长安卓端上传 → 飞书云盘 → [本脚本定时镜像] → 仓库web-data/
 *        → GitHub Pages部署 → 网页版同源fetch(60秒轮询感知更新)
 *
 * 镜像内容:
 *   1. 同步数据/vehicle_sync_data.json  → web-data/vehicle_sync_data.json   (车型数据)
 *   2. 同步数据/data_update_notice.json → web-data/data_update_notice.json (轻量更新通知)
 *   3. 审批结果/approved_users.json     → web-data/approved_users.web.json  (脱敏账号表,见下)
 *   4. 云端vehicle_images/新增图片      → vehicle_images/                   (新增车型照片)
 *
 * 隐私: 仓库与Pages为公开,账号表镜像时手机号脱敏为sha256(SALT+phone),
 *      姓名/密码哈希保留(网页版登录校验必需);网页端登录时对输入手机号
 *      同样计算sha256后比对还原。SALT必须与前端js/09-web-sync.js保持一致。
 *
 * 环境变量(GitHub Actions Secrets, 与Android CI共用):
 *   FEISHU_APP_ID      - 飞书应用ID
 *   FEISHU_APP_SECRET  - 飞书应用Secret
 *   FEISHU_FOLDER_TOKEN - 云文档根文件夹token(可选,默认内置值)
 * ============================================================
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

// ---------- 配置 ----------
const SALT = 'tcg-web-2026'; // ⚠️ 必须与 js/09-web-sync.js 中 WEB_SYNC_SALT 完全一致
const ROOT_FOLDER = process.env.FEISHU_FOLDER_TOKEN || 'nodcnGA95g93RhIUSdCeTkhKlQc';
const DATA_FOLDER_NAME = 'APP数据备份';
const SYNC_SUB = '同步数据';
const APPROVED_SUB = '审批结果';
const IMAGES_DIR_NAME = 'vehicle_images';
const WEB_DATA_DIR = 'web-data';
const MAX_IMAGE_DOWNLOADS = 80; // 单次运行最多镜像图片数(防超时,余量下次继续)
const API_BASE = 'https://open.feishu.cn/open-apis';

const APP_ID = process.env.FEISHU_APP_ID;
const APP_SECRET = process.env.FEISHU_APP_SECRET;
const REPO_DIR = path.resolve(__dirname, '..');

// ---------- 日志 ----------
function log(msg) { console.log('[sync-web-data]', msg); }
function warn(msg) { console.warn('[sync-web-data][warn]', msg); }

// ---------- 飞书API基础封装 ----------
async function getToken() {
  const resp = await fetch(`${API_BASE}/auth/v3/tenant_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: APP_ID, app_secret: APP_SECRET }),
  });
  const data = await resp.json();
  if (!data.tenant_access_token) throw new Error(`飞书认证失败: ${data.msg || resp.status}`);
  return data.tenant_access_token;
}

async function apiGet(token, url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  const text = await resp.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error(`响应非JSON: ${text.slice(0, 120)}`); }
  if (data.code !== undefined && data.code !== 0) throw new Error(`飞书API ${data.code}: ${data.msg}`);
  return data.data || data;
}

/** 列出文件夹内全部文件(自动翻页) */
async function listAllFiles(token, folderToken) {
  const files = [];
  let pageToken = '';
  for (let i = 0; i < 10; i++) {
    let url = `${API_BASE}/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if (pageToken) url += `&page_token=${pageToken}`;
    const data = await apiGet(token, url);
    (data.files || []).forEach(f => files.push(f));
    if (!data.has_more || !data.page_token) break;
    pageToken = data.page_token;
  }
  return files;
}

/** 下载云文档文件(返回Buffer) */
async function downloadFile(token, fileToken) {
  const resp = await fetch(`${API_BASE}/drive/v1/files/${fileToken}/download`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error(`下载HTTP ${resp.status}`);
  return Buffer.from(await resp.arrayBuffer());
}

/** 在文件列表中按名字取修改时间最新的一份(与前端语义一致) */
function latestByName(files, name) {
  const matches = files.filter(f => f.name === name && f.type === 'file');
  if (!matches.length) return null;
  return matches.reduce((a, b) =>
    (parseInt(b.modified_time || 0, 10) || 0) > (parseInt(a.modified_time || 0, 10) || 0) ? b : a);
}

/** 在文件夹下按名字找子文件夹token */
function findSubFolder(files, name) {
  const hit = files.find(f => f.name === name && f.type === 'folder');
  return hit ? hit.token : null;
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

// ---------- 主流程 ----------
async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.log('::notice::缺少FEISHU_APP_ID/FEISHU_APP_SECRET,跳过本次镜像');
    return;
  }
  log('开始镜像飞书云端数据...');
  const token = await getToken();
  log('飞书认证成功');

  // 1) 定位目录结构: 根 → APP数据备份 → {同步数据, 审批结果, vehicle_images}
  let rootFiles = await listAllFiles(token, ROOT_FOLDER);
  let dataFolderToken = findSubFolder(rootFiles, DATA_FOLDER_NAME);
  if (!dataFolderToken) {
    // 容错: 根目录本身可能就是数据区(历史配置)
    warn(`根目录下未找到"${DATA_FOLDER_NAME}"文件夹,按根目录为数据区处理`);
    dataFolderToken = ROOT_FOLDER;
  }
  const dataFiles = dataFolderToken === ROOT_FOLDER ? rootFiles : await listAllFiles(token, dataFolderToken);
  const syncFolderToken = findSubFolder(dataFiles, SYNC_SUB) || dataFolderToken;
  const approvedFolderToken = findSubFolder(dataFiles, APPROVED_SUB) || dataFolderToken;
  const imagesFolderToken = findSubFolder(dataFiles, IMAGES_DIR_NAME);
  if (imagesFolderToken) log(`定位到云端图片目录: ${IMAGES_DIR_NAME}/`);
  else warn(`云端无${IMAGES_DIR_NAME}目录(尚无新增车型照片,正常)`);

  const syncFiles = syncFolderToken === dataFolderToken ? dataFiles : await listAllFiles(token, syncFolderToken);
  const approvedFiles = approvedFolderToken === dataFolderToken ? dataFiles : await listAllFiles(token, approvedFolderToken);

  // 2) 下载三个核心JSON
  const results = { vehicle: null, notice: null, approved: null, images: 0 };
  const vehicleFile = latestByName(syncFiles, 'vehicle_sync_data.json');
  if (vehicleFile) {
    try {
      const buf = await downloadFile(token, vehicleFile.token);
      results.vehicle = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
      log(`车型数据: ${results.vehicle.vehicleCount || (results.vehicle.vehicles || []).length}条 · ${results.vehicle.version || ''} · ${results.vehicle.timestamp || ''}`);
    } catch (e) { warn(`vehicle_sync_data.json下载/解析失败: ${e.message}`); }
  } else { warn('云端无vehicle_sync_data.json(组长尚未在安卓端上传过)'); }

  const noticeFile = latestByName(syncFiles, 'data_update_notice.json');
  if (noticeFile) {
    try {
      const buf = await downloadFile(token, noticeFile.token);
      results.notice = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
      log(`更新通知: ${results.notice.version || ''} · ${results.notice.timestamp || ''}`);
    } catch (e) { warn(`data_update_notice.json下载失败: ${e.message}`); }
  }

  const approvedFile = latestByName(approvedFiles, 'approved_users.json');
  if (approvedFile) {
    try {
      const buf = await downloadFile(token, approvedFile.token);
      results.approved = JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
      log(`账号表: ${(results.approved.users || []).length}个账号`);
    } catch (e) { warn(`approved_users.json下载失败: ${e.message}`); }
  } else { warn('云端无approved_users.json(尚无组员账号同步)'); }

  // 3) 镜像新增图片(云端vehicle_images → 仓库vehicle_images, 仅下载本地缺失且当前车型引用的)
  if (imagesFolderToken && results.vehicle && Array.isArray(results.vehicle.vehicles)) {
    const needed = new Set();
    results.vehicle.vehicles.forEach(v => {
      (v.photoPaths || []).forEach(p => {
        if (typeof p === 'string' && p.startsWith('vehicle_images/')) needed.add(p.split('/').pop());
      });
    });
    const localImgDir = path.join(REPO_DIR, IMAGES_DIR_NAME);
    const localImgs = new Set(fs.existsSync(localImgDir) ? fs.readdirSync(localImgDir) : []);
    const missing = [...needed].filter(n => !localImgs.has(n));
    if (missing.length) {
      log(`需镜像图片${missing.length}张(本地缺失), 单次上限${MAX_IMAGE_DOWNLOADS}张`);
      const cloudImgs = await listAllFiles(token, imagesFolderToken);
      const cloudMap = new Map(cloudImgs.filter(f => f.type === 'file').map(f => [f.name, f.token]));
      let downloaded = 0;
      for (const name of missing.slice(0, MAX_IMAGE_DOWNLOADS)) {
        const ft = cloudMap.get(name);
        if (!ft) { warn(`云端vehicle_images中未找到${name}`); continue; }
        try {
          const buf = await downloadFile(token, ft);
          fs.writeFileSync(path.join(localImgDir, name), buf);
          downloaded++;
        } catch (e) { warn(`图片${name}下载失败: ${e.message}`); }
      }
      results.images = downloaded;
      log(`本次实际镜像图片${downloaded}张`);
    } else { log('图片已全部同步(本地齐全)'); }
  }

  // 4) 写入web-data/
  if (!fs.existsSync(path.join(REPO_DIR, WEB_DATA_DIR))) fs.mkdirSync(path.join(REPO_DIR, WEB_DATA_DIR), { recursive: true });
  const written = [];
  if (results.vehicle) {
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'vehicle_sync_data.json'), JSON.stringify(results.vehicle));
    written.push('vehicle_sync_data.json');
  }
  if (results.notice) {
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'data_update_notice.json'), JSON.stringify(results.notice));
    written.push('data_update_notice.json');
  } else if (results.vehicle && results.vehicle.timestamp) {
    // 兜底: 云端无notice(老版本组长端)时用车型数据时间戳合成,保证前端有轻量探测点
    const synth = {
      type: 'data_update_notice',
      timestamp: results.vehicle.timestamp,
      version: results.vehicle.version || '',
      vehicleCount: results.vehicle.vehicleCount || (results.vehicle.vehicles || []).length,
      uploadedBy: '镜像合成',
    };
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'data_update_notice.json'), JSON.stringify(synth));
    written.push('data_update_notice.json(合成)');
  }
  if (results.approved && Array.isArray(results.approved.users)) {
    // 脱敏: 手机号 → sha256(SALT+phone); 姓名与密码哈希保留(登录校验必需)
    const web = {
      type: 'approved_users_web',
      version: results.approved.version || '',
      timestamp: results.approved.timestamp || '',
      syncedAt: new Date().toISOString(),
      users: results.approved.users
        .filter(u => u && u.phone)
        .map(u => ({
          id: u.id, name: u.name || '',
          phoneH: sha256Hex(SALT + String(u.phone)),
          password: u.password || '', role: u.role || 'user',
          status: u.status || 'pending', created: u.created || '',
        })),
    };
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'approved_users.web.json'), JSON.stringify(web));
    written.push('approved_users.web.json(脱敏)');
  }
  log(`已写入: ${written.join(', ') || '(无数据文件)'}`);

  // 5) git提交(有变化才提交)
  // ⚠️ meta.json含本次镜像时间戳,必须在变更检测之后写入——否则每5分钟
  //    产生一次空提交(288次/天),污染提交历史并频繁触发Pages重部署
  const git = (cmd) => execSync(cmd, { cwd: REPO_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const status = git('git status --porcelain -- web-data vehicle_images');
  if (!status) { log('无数据变化,跳过提交(不写meta.json避免空提交)'); return; }
  fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'meta.json'), JSON.stringify({
    syncedAt: new Date().toISOString(),
    vehicleVersion: results.vehicle ? (results.vehicle.version || '') : null,
    vehicleCount: results.vehicle ? (results.vehicle.vehicleCount || (results.vehicle.vehicles || []).length) : null,
    accountCount: results.approved && results.approved.users ? results.approved.users.length : 0,
  }));
  git('git config user.name "github-actions[bot]"');
  git('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  git('git add web-data vehicle_images');
  const parts = [];
  if (results.vehicle) parts.push(`车型${results.vehicle.vehicleCount || (results.vehicle.vehicles || []).length}条`);
  if (results.approved) parts.push(`账号${(results.approved.users || []).length}个`);
  if (results.images) parts.push(`图片${results.images}张`);
  git(`git commit -m "chore(web-data): 镜像飞书云端最新数据 ${parts.join('/')}"`);
  try {
    git('git pull --rebase origin main');
  } catch (e) {
    // rebase失败→中止并跳过本轮(避免push非快进报错),下次运行自动补偿
    try { git('git rebase --abort'); } catch (e2) { /* 已中止 */ }
    warn(`rebase失败(并发冲突,跳过本轮): ${e.message.split('\n')[0]}`);
    return;
  }
  git('git push origin HEAD:main');
  log('✅ 已提交并推送, GitHub Pages将自动重新部署');
}

main().catch(err => {
  // 镜像属增强能力: 失败不置红(避免cron高频噪音), 输出notice供Actions页面查看
  console.log(`::notice::镜像同步失败: ${err.message}`);
  process.exit(0);
});
