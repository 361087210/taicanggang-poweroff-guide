#!/usr/bin/env node
/**
 * ============================================================
 * 网页版数据镜像同步脚本 V2.1 (V10.14.3 配套)
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
 * V2.1 变更(修复"网页版只有73组内置数据 + 组员账号无法登录"):
 *   V2.0多位置候选仍落空——取证快照显示 APP数据备份/同步数据/ 存在4个文件
 *   却按名字找不到vehicle_sync_data.json,证明云端实际结构漂移超出预设候选。
 *   V2.1改为全盘树遍历,彻底消除"位置假设":
 *   1. 从应用云盘根 + 配置根目录(FEISHU_FOLDER_TOKEN)双入口递归遍历全树
 *      (folder_token去重防环,深度≤5防御异常深层嵌套)
 *   2. 三个核心JSON(vehicle_sync_data/data_update_notice/approved_users)
 *      按文件名在全树范围搜索,跨位置取modified_time最新一份——数据无论
 *      漂移到哪个文件夹都能命中,与安卓端三级回退语义对齐且更宽
 *   3. 备份回退: vehicle_sync_data.json全树不存在时,取最新
 *      vehicle_backup_*.json(组长手动备份,含vehicles+users全量快照)作为
 *      车型与账号数据源——云端主数据丢失/损坏时网页版仍可从备份恢复;
 *      approved_users.json缺失/为空/备份更新且账号更多时同样回退
 *   4. 完整树形取证快照写入web-data/debug_structure.json
 *      (文件名中11位手机号脱敏;仅名称/类型/修改时间,不含文件内容)
 *
 * 镜像内容:
 *   1. vehicle_sync_data.json  → web-data/vehicle_sync_data.json   (车型数据)
 *   2. data_update_notice.json → web-data/data_update_notice.json (轻量更新通知)
 *   3. approved_users.json     → web-data/approved_users.web.json  (脱敏账号表)
 *   4. 云端vehicle_images/新增图片 → vehicle_images/               (新增车型照片)
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
const IMAGES_DIR_NAME = 'vehicle_images';
const WEB_DATA_DIR = 'web-data';
const MAX_IMAGE_DOWNLOADS = 80; // 单次运行最多镜像图片数(防超时,余量下次继续)
const MAX_WALK_DEPTH = 5;       // 树遍历深度上限(防御异常深层嵌套)
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
    let url = `${API_BASE}/drive/v1/files?folder_token=${encodeURIComponent(folderToken)}&page_size=200`;
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

/** 下载并解析JSON(容错BOM) */
async function downloadJson(token, fileToken) {
  const buf = await downloadFile(token, fileToken);
  return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
}

function mtime(f) { return parseInt(f && f.modified_time || 0, 10) || 0; }

function sha256Hex(s) {
  return crypto.createHash('sha256').update(s, 'utf8').digest('hex');
}

/** 文件名脱敏(公开取证文件用): 11位手机号段打码,其余保留 */
function redactName(name) {
  return String(name).replace(/\d{11}/g, m => m.slice(0, 3) + '****' + m.slice(-2));
}

// ---------- GitHub Actions输出(供workflow条件部署Pages) ----------
function setOutput(name, value) {
  const out = process.env.GITHUB_OUTPUT; // Actions运行时注入的输出文件
  if (out && fs.existsSync(path.dirname(out))) fs.appendFileSync(out, `${name}=${value}\n`);
  else console.log(`(本地运行,无GITHUB_OUTPUT) ${name}=${value}`);
}

// ---------- 主流程 ----------
async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.log('::notice::缺少FEISHU_APP_ID/FEISHU_APP_SECRET,跳过本次镜像');
    setOutput('armed', 'false'); // 无凭证: 工作流不续链(避免无意义循环)
    return;
  }
  log('开始镜像飞书云端数据(V2.1全盘树遍历)...');
  const token = await getToken();
  log('飞书认证成功');

  // ---- ① 全盘树遍历: 应用云盘根 + 配置根目录双入口,token去重防环 ----
  const nodes = [];              // {path,name,type,mtime,token}
  const walkErrors = [];
  const walkedFolders = new Set();
  async function walk(folderToken, pathLabel, depth) {
    if (depth > MAX_WALK_DEPTH || walkedFolders.has(folderToken)) return;
    walkedFolders.add(folderToken);
    let files;
    try { files = await listAllFiles(token, folderToken); }
    catch (e) { walkErrors.push(`${pathLabel}: ${String(e.message || e).slice(0, 120)}`); return; }
    for (const f of files) {
      nodes.push({ path: pathLabel + f.name, name: f.name, type: f.type, mtime: mtime(f), token: f.token });
      if (f.type === 'folder') await walk(f.token, pathLabel + f.name + '/', depth + 1);
    }
  }
  // 获取应用云盘根token(飞书规范端点; 空folder_token调files接口会被拒)
  let driveRootToken = '';
  try {
    const rd = await apiGet(token, `${API_BASE}/drive/explorer/v2/root_folder_token`);
    driveRootToken = String((rd && (rd.token || rd.root_folder_token)) || '');
    if (driveRootToken) log(`云盘根token: ${driveRootToken.slice(0, 6)}...`);
  } catch (e) { walkErrors.push(`获取云盘根token失败: ${String(e.message || e).slice(0, 100)}`); }
  if (driveRootToken) await walk(driveRootToken, '(云盘根)/', 0);   // 应用云盘根(覆盖全部可达空间)
  if (ROOT_FOLDER && !walkedFolders.has(ROOT_FOLDER)) {
    await walk(ROOT_FOLDER, '(项目根)/', 0);                          // 配置根目录(若与云盘根不同树,补充遍历)
  }
  log(`树遍历完成: ${walkedFolders.size}个文件夹 / ${nodes.length}个节点`);

  // 全树文件检索工具
  const fileNodes = nodes.filter(n => n.type === 'file');
  const latest = arr => arr.reduce((a, b) => (b.mtime > a.mtime ? b : a));

  // ---- ② 备份候选(全树): vehicle_backup_*.json 取最新 ----
  let backupNode = null, backupData = null;
  const backupHits = fileNodes.filter(n => /^vehicle_backup_.+\.json$/.test(n.name));
  if (backupHits.length) {
    backupNode = latest(backupHits);
    try {
      backupData = await downloadJson(token, backupNode.token);
      log(`找到备份: ${backupNode.path} · 车型${(backupData.vehicles || []).length}条 · 账号${(backupData.users || []).length}个`);
    } catch (e) { warn(`备份${backupNode.path}下载/解析失败: ${e.message}`); backupNode = null; backupData = null; }
  }

  // ---- ③ 车型主数据: 三名候选全树搜索(按修改时间最新且非空优先) ----
  // 候选链背景(2026-09取证): 云端"同步数据/"下实际是 sync_feishu_local.js --push
  // 上传的 vehicles_data.json({updated,count,vehicles}) + vehicles_snapshot_*.json
  // ({captured,vehicles}); vehicle_sync_data.json 仅安卓组长端上传,当前缺失。
  // 选择语义: 活跃数据源=修改时间最新的非空档——组长一旦上传vehicle_sync_data.json
  // (mtime必新于开发者旧档)即自动成为主源;旧档仅在新档缺失/为空时兜底。
  let vehicleData = null, vehicleSource = '', vehicleBestMtime = 0;
  const VEHICLE_FILE_CANDIDATES = [
    { name: 'vehicle_sync_data.json', kind: '安卓主档', tsKey: 'timestamp' },
    { name: 'vehicles_data.json', kind: '开发者主档', tsKey: 'updated' },
    { name: /^vehicles_snapshot_.+\.json$/, kind: '本地快照', tsKey: 'captured', regex: true },
  ];
  for (const cand of VEHICLE_FILE_CANDIDATES) {
    const hits = cand.regex
      ? fileNodes.filter(n => cand.name.test(n.name))
      : fileNodes.filter(n => n.name === cand.name);
    if (!hits.length) continue;
    const node = latest(hits);
    try {
      const raw = await downloadJson(token, node.token);
      const vehicles = Array.isArray(raw.vehicles) ? raw.vehicles : [];
      const ts = raw[cand.tsKey] || new Date(node.mtime * 1000).toISOString();
      log(`车型候选[${cand.kind}]: ${vehicles.length}条 · ${ts} · ${node.path}`);
      if (vehicles.length && node.mtime > vehicleBestMtime) {
        vehicleData = {
          version: raw.version || raw.updated || raw.captured || `(镜像:${cand.kind})`,
          timestamp: ts,
          uploadedBy: `${cand.kind}:${node.path}`,
          vehicleCount: raw.count || vehicles.length,
          vehicles,
        };
        vehicleSource = `${cand.kind}:${node.path}`;
        vehicleBestMtime = node.mtime;
      }
    } catch (e) { warn(`车型候选${cand.kind}(${node.path})下载/解析失败: ${e.message}`); }
  }
  if (!vehicleData) {
    // ---- ③b 备份回退: vehicle_backup_*.json 取最新 ----
    if (backupData && Array.isArray(backupData.vehicles) && backupData.vehicles.length) {
      vehicleData = {
        version: backupData.version || '(备份恢复)',
        timestamp: backupData.timestamp || new Date(backupNode.mtime * 1000).toISOString(),
        uploadedBy: '备份回退:' + backupNode.name,
        vehicleCount: backupData.vehicleCount || backupData.vehicles.length,
        vehicles: backupData.vehicles,
      };
      vehicleSource = `backup:${backupNode.path}`;
      warn(`⚠️ 三名候选均无数据,已从备份恢复车型数据(${backupNode.path})`);
    } else warn('全树无任何车型数据(主档/开发者档/快照/备份均缺失),车型镜像跳过');
  }

  // ---- ④ 更新通知: data_update_notice.json 全树搜索;缺失则由车型数据合成 ----
  let noticeData = null, noticeSource = '';
  const noticeHits = fileNodes.filter(n => n.name === 'data_update_notice.json');
  if (noticeHits.length) {
    const nNode = latest(noticeHits);
    try {
      noticeData = await downloadJson(token, nNode.token);
      noticeSource = `sync:${nNode.path}`;
      log(`更新通知: ${noticeData.version || ''} · ${noticeData.timestamp || ''}`);
    } catch (e) { warn(`data_update_notice.json下载失败: ${e.message}`); }
  }

  // ---- ⑤ 账号表: approved_users.json 全树搜索取最新;缺失/为空/备份更新且更多则回退 ----
  let approvedData = null, approvedNode = null, usersSource = '';
  const approvedHits = fileNodes.filter(n => n.name === 'approved_users.json');
  if (approvedHits.length) {
    approvedNode = latest(approvedHits);
    try {
      approvedData = await downloadJson(token, approvedNode.token);
      usersSource = `approved:${approvedNode.path}`;
      log(`账号表(云端主档): ${(approvedData.users || []).length}个账号 · ${approvedNode.path}`);
    } catch (e) { warn(`approved_users.json(${approvedNode.path})下载/解析失败: ${e.message}`); approvedData = null; }
  }
  const approvedCount = approvedData && Array.isArray(approvedData.users) ? approvedData.users.length : 0;
  const backupUsers = backupData && Array.isArray(backupData.users) ? backupData.users : null;
  if (backupUsers && backupUsers.length) {
    if (!approvedData || approvedCount === 0) {
      approvedData = { version: backupData.version || '', timestamp: backupData.timestamp || '', users: backupUsers };
      usersSource = `backup:${backupNode.path}(云端账号表缺失)`;
      warn(`⚠️ 云端账号表缺失,已从备份恢复${backupUsers.length}个账号`);
    } else if (backupUsers.length > approvedCount) {
      const backupTs = new Date(backupData.timestamp || backupNode.mtime * 1000).getTime();
      const approvedTs = new Date(approvedData.timestamp || approvedNode.mtime * 1000).getTime();
      if (backupTs > approvedTs) {
        approvedData = { version: backupData.version || approvedData.version, timestamp: backupData.timestamp, users: backupUsers };
        usersSource = `backup:${backupNode.path}(较新且账号更多:${backupUsers.length}>${approvedCount})`;
        warn(`⚠️ 备份(${backupUsers.length}账号)比云端账号表(${approvedCount}账号)更新,已采用备份账号`);
      }
    }
  }
  if (!approvedData && !backupUsers) warn('全树无approved_users.json且无可用备份,账号表无法镜像');

  // ---- ⑤b 诊断: _sync_verify_*.json 顶层结构(排查账号与数据真源) ----
  const verifyHits = fileNodes.filter(n => /^_sync_verify_.+\.json$/.test(n.name));
  for (const v of verifyHits.slice(0, 2)) {
    try {
      const raw = await downloadJson(token, v.token);
      const keys = Object.keys(raw).join(',');
      const usersN = Array.isArray(raw.users) ? raw.users.length : null;
      const vehN = Array.isArray(raw.vehicles) ? raw.vehicles.length : null;
      log(`诊断[_sync_verify]: ${v.path} · 键[${keys}] · vehicles=${vehN} · users=${usersN}`);
      // 若verify文件含更多users,并入账号候选(安卓端同步校验快照,可能比审批结果主档新)
      if (usersN && usersN > (approvedData && approvedData.users ? approvedData.users.length : 0)) {
        approvedData = { version: raw.version || '', timestamp: raw.timestamp || raw.updated || '', users: raw.users };
        usersSource = `verify:${v.path}(${usersN}账号>主档)`;
        warn(`⚠️ _sync_verify快照含${usersN}个账号(多于审批结果主档),已采用`);
      }
    } catch (e) { warn(`诊断[_sync_verify]${v.path}解析失败: ${e.message}`); }
  }

  // ---- ⑥ 镜像新增图片(全树定位vehicle_images目录,取文件数最多的一份) ----
  let imagesMirrored = 0;
  if (vehicleData && Array.isArray(vehicleData.vehicles)) {
    const imgFolders = nodes.filter(n => n.type === 'folder' && n.name === IMAGES_DIR_NAME);
    let imgFolder = null, imgCount = -1;
    for (const f of imgFolders) {
      const cnt = fileNodes.filter(n => n.path.startsWith(f.path + '/')).length;
      if (cnt > imgCount) { imgCount = cnt; imgFolder = f; }
    }
    const needed = new Set();
    vehicleData.vehicles.forEach(v => {
      (v.photoPaths || []).forEach(p => {
        if (typeof p === 'string' && p.startsWith('vehicle_images/')) needed.add(p.split('/').pop());
      });
    });
    const localImgDir = path.join(REPO_DIR, IMAGES_DIR_NAME);
    const localImgs = new Set(fs.existsSync(localImgDir) ? fs.readdirSync(localImgDir) : []);
    const missing = [...needed].filter(n => !localImgs.has(n));
    if (missing.length && imgFolder) {
      log(`需镜像图片${missing.length}张(本地缺失), 源:${imgFolder.path}(${imgCount}张), 单次上限${MAX_IMAGE_DOWNLOADS}张`);
      const cloudMap = new Map(
        fileNodes.filter(n => n.path.startsWith(imgFolder.path + '/')).map(n => [n.name, n.token])
      );
      for (const name of missing.slice(0, MAX_IMAGE_DOWNLOADS)) {
        const ft = cloudMap.get(name);
        if (!ft) { warn(`云端vehicle_images中未找到${name}`); continue; }
        try {
          const buf = await downloadFile(token, ft);
          fs.writeFileSync(path.join(localImgDir, name), buf);
          imagesMirrored++;
        } catch (e) { warn(`图片${name}下载失败: ${e.message}`); }
      }
      log(`本次实际镜像图片${imagesMirrored}张`);
    } else if (!missing.length) { log('图片已全部同步(本地齐全)'); }
    else if (!imgFolder) { warn('全树未找到vehicle_images文件夹,跳过图片镜像'); }
  }

  // ---- ⑦ 写入web-data/ ----
  if (!fs.existsSync(path.join(REPO_DIR, WEB_DATA_DIR))) fs.mkdirSync(path.join(REPO_DIR, WEB_DATA_DIR), { recursive: true });
  const written = [];
  if (vehicleData) {
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'vehicle_sync_data.json'), JSON.stringify(vehicleData));
    written.push('vehicle_sync_data.json');
  } else { warn('全树无车型数据(主档+备份均缺失),车型镜像跳过'); }
  if (noticeData) {
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'data_update_notice.json'), JSON.stringify(noticeData));
    written.push('data_update_notice.json');
  } else if (vehicleData && vehicleData.timestamp) {
    // 兜底: 云端无notice时用车型数据时间戳合成,保证前端有轻量探测点
    const synth = {
      type: 'data_update_notice',
      timestamp: vehicleData.timestamp,
      version: vehicleData.version || '',
      vehicleCount: vehicleData.vehicleCount || (vehicleData.vehicles || []).length,
      uploadedBy: vehicleData.uploadedBy || '镜像合成',
    };
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'data_update_notice.json'), JSON.stringify(synth));
    written.push('data_update_notice.json(合成)');
  }
  if (approvedData && Array.isArray(approvedData.users)) {
    // 脱敏: 手机号 → sha256(SALT+phone); 姓名与密码哈希保留(登录校验必需)
    // (备份来源users含pending/rejected态,登录侧按status守卫,与安卓语义一致)
    const web = {
      type: 'approved_users_web',
      version: approvedData.version || '',
      timestamp: approvedData.timestamp || '',
      syncedAt: new Date().toISOString(),
      users: approvedData.users
        .filter(u => u && u.phone)
        .map(u => ({
          id: u.id, name: u.name || '',
          phoneH: sha256Hex(SALT + String(u.phone)),
          password: u.password || '', role: u.role || 'user',
          status: u.status || 'pending', created: u.created || '',
        })),
    };
    fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'approved_users.web.json'), JSON.stringify(web));
    written.push(`approved_users.web.json(脱敏${web.users.length}个)`);
  } else { warn('账号表镜像跳过(无数据)'); }
  log(`已写入: ${written.join(', ') || '(无数据文件)'}`);

  // ---- ⑧ 取证快照: 全树结构(脱敏)+数据源结论,仅结构变化才写避免空提交 ----
  const debug = {
    rootFolderToken: ROOT_FOLDER,
    walkSummary: { folders: walkedFolders.size, nodes: nodes.length, files: fileNodes.length, errors: walkErrors },
    tree: nodes.map(n => ({ p: redactName(n.path), t: n.type, m: n.mtime })),
    pendingRegCount: fileNodes.filter(n => /^pending_reg_.+\.json$/.test(n.name)).length,
    backups: backupHits.map(n => ({ p: redactName(n.path), m: n.mtime })),
    sources: { vehicle: vehicleSource || null, notice: noticeSource || null, users: usersSource || null },
    vehicleCandidates: VEHICLE_FILE_CANDIDATES.map(c => {
      const hits = c.regex ? fileNodes.filter(n => c.name.test(n.name)) : fileNodes.filter(n => n.name === c.name);
      return { kind: c.kind, count: hits.length, files: hits.map(n => ({ p: redactName(n.path), m: n.mtime })) };
    }),
    approvedHits: approvedHits.map(n => ({ p: redactName(n.path), m: n.mtime })),
    vehicleCount: vehicleData ? (vehicleData.vehicleCount || (vehicleData.vehicles || []).length) : null,
    accountCount: approvedData && approvedData.users ? approvedData.users.length : 0,
    generatedAt: undefined, // 不写时间戳: 结构无变化时不产生空提交
  };
  const debugPath = path.join(REPO_DIR, WEB_DATA_DIR, 'debug_structure.json');
  const debugStr = JSON.stringify(debug, null, 1);
  if (fs.existsSync(debugPath) && fs.readFileSync(debugPath, 'utf8') === debugStr) {
    log('云端目录结构无变化');
  } else {
    fs.writeFileSync(debugPath, debugStr);
    written.push('debug_structure.json(取证)');
  }

  // ---- ⑨ git提交(有变化才提交) ----
  // ⚠️ meta.json含本次镜像时间戳,必须在变更检测之后写入——否则每5分钟
  //    产生一次空提交(288次/天),污染提交历史并频繁触发Pages重部署
  const git = (cmd) => execSync(cmd, { cwd: REPO_DIR, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const status = git('git status --porcelain -- web-data vehicle_images');
  if (!status) { log('无数据变化,跳过提交(不写meta.json避免空提交)'); setOutput('changed', 'false'); setOutput('armed', 'true'); return; }
  fs.writeFileSync(path.join(REPO_DIR, WEB_DATA_DIR, 'meta.json'), JSON.stringify({
    syncedAt: new Date().toISOString(),
    vehicleVersion: vehicleData ? (vehicleData.version || '') : null,
    vehicleCount: vehicleData ? (vehicleData.vehicleCount || (vehicleData.vehicles || []).length) : null,
    accountCount: approvedData && approvedData.users ? approvedData.users.length : 0,
    vehicleSource: vehicleSource || null,
    usersSource: usersSource || null,
  }));
  git('git config user.name "github-actions[bot]"');
  git('git config user.email "41898282+github-actions[bot]@users.noreply.github.com"');
  git('git add web-data vehicle_images');
  const parts = [];
  if (vehicleData) parts.push(`车型${vehicleData.vehicleCount || (vehicleData.vehicles || []).length}条`);
  if (approvedData) parts.push(`账号${(approvedData.users || []).length}个`);
  if (imagesMirrored) parts.push(`图片${imagesMirrored}张`);
  git(`git commit -m "chore(web-data): 镜像飞书云端最新数据 ${parts.join('/')}"`);
  try {
    git('git pull --rebase origin main');
  } catch (e) {
    // rebase失败→中止并跳过本轮(避免push非快进报错),下次运行自动补偿
    try { git('git rebase --abort'); } catch (e2) { /* 已中止 */ }
    warn(`rebase失败(并发冲突,跳过本轮): ${e.message.split('\n')[0]}`);
    setOutput('changed', 'false');
    setOutput('armed', 'true');
    return;
  }
  git('git push origin HEAD:main');
  setOutput('changed', 'true');
  setOutput('armed', 'true');
  log('✅ 已提交并推送(本工作流deploy步骤将直接重新部署Pages,见sync-web-data.yml)');
}

main().catch(err => {
  // 镜像属增强能力: 失败不置红(避免cron高频噪音), 输出notice供Actions页面查看
  console.log(`::notice::镜像同步失败: ${err.message}`);
  setOutput('armed', 'true'); // 瞬时失败仍续链(链式触发是唯一可靠调度,断链即停摆)
  process.exit(0);
});
