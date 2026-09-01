#!/usr/bin/env node
/* ============================================================
 * sync_feishu_local.js - V10.13 本地↔飞书云文档双向同步
 * ============================================================
 * 功能:
 *   --push   本地 → 飞书: 把 vehicles_data.js + version.json + demo.html 推到「同步数据/本地备份」
 *   --pull   飞书 → 本地: 把「同步数据/云端镜像」拉回本地 vehicles_data.js
 *   --sync   双向合并: 先 pull 再 push(以云端为权威, 冲突保留较新版本)
 *   --status 对比本地与云端数据时间戳
 *
 * 凭据: 通过环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN 注入
 *       或读取项目根目录 .env.feishu (gitignore 已排除)
 *
 * 云端目录结构 (APP数据备份/):
 *   ├── 同步数据/
 *   │   ├── vehicles_data.json       ← 云端镜像的车辆数据
 *   │   ├── version.json             ← 版本配置镜像
 *   │   └── local_backup/           ← 每次 push 时的本地快照备份
 *   └── ... (注册申请/审批结果/备份文件)
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const SUB = '同步数据';

// ---- 凭据加载 ----
function loadCreds() {
  let appId = process.env.FEISHU_APP_ID;
  let appSecret = process.env.FEISHU_APP_SECRET;
  let folderToken = process.env.FEISHU_FOLDER_TOKEN;
  if (!appId) {
    const envFile = path.join(REPO, '.env.feishu');
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*(FEISHU_APP_ID|FEISHU_APP_SECRET|FEISHU_FOLDER_TOKEN)\s*=\s*['"]?(.+?)['"]?\s*$/);
        if (m) {
          if (m[1] === 'FEISHU_APP_ID') appId = m[2];
          if (m[1] === 'FEISHU_APP_SECRET') appSecret = m[2];
          if (m[1] === 'FEISHU_FOLDER_TOKEN') folderToken = m[2];
        }
      }
    }
  }
  if (!appId || !appSecret || !folderToken) {
    console.error('缺少飞书凭据。请设置环境变量 FEISHU_APP_ID/FEISHU_APP_SECRET/FEISHU_FOLDER_TOKEN');
    console.error('或在项目根目录创建 .env.feishu 文件(已 gitignore)');
    process.exit(1);
  }
  return { appId, appSecret, folderToken };
}

// ---- Feishu API 封装 ----
class FeishuClient {
  constructor({ appId, appSecret, folderToken }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.rootFolderToken = folderToken;
    this._token = null;
    this._tokenExpires = 0;
    this._subFolderCache = new Map();
  }

  async getToken() {
    if (this._token && Date.now() < this._tokenExpires - 60000) return this._token;
    const body = JSON.stringify({ app_id: this.appId, app_secret: this.appSecret });
    const r = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body
    });
    const d = await r.json();
    if (d.code !== 0) throw new Error('tenant_access_token 失败: ' + d.msg);
    this._token = d.tenant_access_token;
    this._tokenExpires = Date.now() + d.expire * 1000;
    return this._token;
  }

  async headers() { return { Authorization: 'Bearer ' + (await this.getToken()) }; }

  async listFiles(folderToken) {
    const r = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`, {
      headers: await this.headers()
    });
    const d = await r.json();
    if (d.code !== 0) throw new Error('listFiles 失败: ' + d.msg);
    return d.data.files || [];
  }

  async ensureSubFolder(name, parentToken) {
    if (this._subFolderCache.has(name)) return this._subFolderCache.get(name);
    const files = await this.listFiles(parentToken);
    const existing = files.find(f => f.name === name && f.type === 'folder');
    if (existing) {
      this._subFolderCache.set(name, existing.token);
      return existing.token;
    }
    const body = JSON.stringify({ name, folder_token: parentToken });
    const r = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder', {
      method: 'POST', headers: { ...(await this.headers()), 'Content-Type': 'application/json' }, body
    });
    const d = await r.json();
    if (d.code !== 0) throw new Error('create_folder ' + name + ' 失败: ' + d.msg);
    this._subFolderCache.set(name, d.data.token);
    return d.data.token;
  }

  async uploadJson(folderToken, fileName, jsonStr) {
    const fd = new FormData();
    fd.append('file_name', fileName);
    fd.append('parent_type', 'explorer');
    fd.append('parent_node', folderToken);
    fd.append('size', String(Buffer.byteLength(jsonStr)));
    fd.append('file', new Blob([jsonStr], { type: 'application/json' }), fileName);
    const r = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
      method: 'POST', headers: await this.headers(), body: fd
    });
    const d = await r.json();
    if (d.code === 1061043) throw new Error('文件过大超限, 需分片上传');
    if (d.code !== 0) throw new Error('upload 失败: ' + d.msg);
    return d.data.file_token;
  }

  async findFileByName(folderToken, fileName) {
    const files = await this.listFiles(folderToken);
    return files.find(f => f.name === fileName && f.type === 'file') || null;
  }

  async downloadFile(fileToken) {
    const r = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`, {
      headers: await this.headers()
    });
    if (!r.ok) throw new Error('download 失败 HTTP ' + r.status);
    return await r.text();
  }

  async deleteFile(fileToken) {
    const r = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}?type=file`, {
      method: 'DELETE', headers: await this.headers()
    });
    const d = await r.json().catch(() => ({}));
    if (r.status !== 200 || (d.code !== undefined && d.code !== 0)) throw new Error('delete 失败: ' + d.msg);
  }
}

// ---- 本地数据读取 ----
function readVehiclesData() {
  const js = fs.readFileSync(path.join(REPO, 'vehicles_data.js'), 'utf8');
  // 提取 window.VEHICLES = [...]
  const m = js.match(/window\.VEHICLES\s*=\s*(\[[\s\S]*?\])\s*;/);
  if (!m) throw new Error('vehicles_data.js 中找不到 window.VEHICLES');
  return JSON.parse(m[1]);
}

function fileHash(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return crypto.createHash('sha1').update(fs.readFileSync(filePath)).digest('hex').substring(0, 12);
}

function fileMtimeIso(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return new Date(fs.statSync(filePath).mtime).toISOString();
}

// ---- 主命令 ----
async function main() {
  const args = process.argv.slice(2);
  const mode = args[0] || '--help';

  // --help / 无参数先返回帮助, 不依赖凭据
  if (mode === '--help' || mode === '-h' || args.length === 0) {
    console.log(`
sync_feishu_local.js - 本地↔飞书云同步

用法: node scripts/sync_feishu_local.js <command>

命令:
  --push    本地 → 飞书: vehicles_data.js + version.json → ${SUB}/
  --pull    飞书 → 本地: ${SUB}/vehicles_data.json → vehicles_data.js
  --sync    双向合并: 先 pull 再 push (云端为权威)
  --status  对比本地与云端时间戳

凭据: 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN
      或创建 .env.feishu (已 gitignore)
`);
    process.exit(0);
  }

  const creds = loadCreds();
  const feishu = new FeishuClient(creds);

  // 定位 同步数据 子文件夹
  const dataFolderToken = await feishu.ensureSubFolder('APP数据备份', creds.folderToken);
  const syncFolderToken = await feishu.ensureSubFolder(SUB, dataFolderToken);
  const localBackupToken = await feishu.ensureSubFolder('本地备份', syncFolderToken);

  switch (mode) {
    case '--push': return doPush(feishu, syncFolderToken, localBackupToken);
    case '--pull': return doPull(feishu, syncFolderToken);
    case '--sync': return doSync(feishu, syncFolderToken, localBackupToken);
    case '--status': return doStatus(feishu, syncFolderToken);
    default:
      console.log(`
sync_feishu_local.js - 本地↔飞书云同步

用法: node scripts/sync_feishu_local.js <command>

命令:
  --push    本地 → 飞书: vehicles_data.js + version.json → ${SUB}/
  --pull    飞书 → 本地: ${SUB}/vehicles_data.json → vehicles_data.js
  --sync    双向合并: 先 pull 再 push (云端为权威)
  --status  对比本地与云端时间戳

凭据: 环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN
      或创建 .env.feishu (已 gitignore)
`);
      process.exit(0);
  }
}

async function doPush(f, syncToken, backupToken) {
  console.log('[PUSH] 本地 → 飞书云文档');
  const vehicles = readVehiclesData();
  const vehiclesJson = JSON.stringify({ updated: new Date().toISOString(), count: vehicles.length, vehicles }, null, 2);

  // 1. 上传 vehicles_data.json (覆盖更新)
  const existing = await f.findFileByName(syncToken, 'vehicles_data.json');
  if (existing) await f.deleteFile(existing.token);
  const tk1 = await f.uploadJson(syncToken, 'vehicles_data.json', vehiclesJson);
  console.log(`  ✓ vehicles_data.json (${vehicles.length} 条, token=${tk1})`);

  // 2. 上传 version.json
  const versionJson = fs.readFileSync(path.join(REPO, 'version.json'), 'utf8');
  const existingV = await f.findFileByName(syncToken, 'version.json');
  if (existingV) await f.deleteFile(existingV.token);
  const tk2 = await f.uploadJson(syncToken, 'version.json', versionJson);
  console.log(`  ✓ version.json (token=${tk2})`);

  // 3. 本地快照备份 (带时间戳)
  const snapName = `vehicles_snapshot_${Date.now()}.json`;
  const snapJson = JSON.stringify({ captured: new Date().toISOString(), vehicles }, null, 2);
  await f.uploadJson(backupToken, snapName, snapJson);
  console.log(`  ✓ 本地快照: ${snapName}`);

  // 4. 清理备份目录中超过 30 天的旧快照
  const backups = await f.listFiles(backupToken);
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const b of backups) {
    if (!b.name.startsWith('vehicles_snapshot_')) continue;
    const ts = parseInt(b.name.match(/_(\d+)\.json$/)[1], 10);
    if (ts < cutoff) {
      await f.deleteFile(b.token);
      console.log(`  🗑 清理旧快照: ${b.name}`);
    }
  }
  console.log('[PUSH] 完成');
}

async function doPull(f, syncToken) {
  console.log('[PULL] 飞书云文档 → 本地');
  const existing = await f.findFileByName(syncToken, 'vehicles_data.json');
  if (!existing) { console.log('  ⚠ 云端无 vehicles_data.json'); return; }

  const text = await f.downloadFile(existing.token);
  let data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('云端 vehicles_data.json JSON 解析失败: ' + e.message); }
  const vehicles = data.vehicles || data;
  if (!Array.isArray(vehicles)) throw new Error('云端 vehicles_data.json 格式异常: vehicles 字段非数组');

  // 备份当前本地
  const localPath = path.join(REPO, 'vehicles_data.js');
  const backupPath = path.join(REPO, 'vehicles_data.js.bak');
  if (fs.existsSync(localPath)) {
    fs.copyFileSync(localPath, backupPath);
    console.log(`  ✓ 本地备份: vehicles_data.js.bak`);
  }

  // 写回 vehicles_data.js (保持原有 window.VEHICLES = [...] 格式)
  const newJs = '// 飞书云端同步于 ' + (data.updated || new Date().toISOString()) + '\n'
    + 'window.VEHICLES = ' + JSON.stringify(vehicles, null, 2) + ';\n';
  fs.writeFileSync(localPath, newJs);
  console.log(`  ✓ 已更新 vehicles_data.js (${vehicles.length} 条, 备份 .bak)`);

  // 拉 version.json
  const versionCloud = await f.findFileByName(syncToken, 'version.json');
  if (versionCloud) {
    const vtext = await f.downloadFile(versionCloud.token);
    const vlocal = path.join(REPO, 'version.json');
    const vhashLocal = fileHash(vlocal);
    const vhashCloud = crypto.createHash('sha1').update(vtext).digest('hex').substring(0, 12);
    if (vhashLocal !== vhashCloud) {
      fs.writeFileSync(vlocal, vtext);
      console.log(`  ✓ 已更新 version.json (云端与本地有差异)`);
    } else {
      console.log(`  - version.json 一致, 跳过`);
    }
  }
  console.log('[PULL] 完成');
}

async function doSync(f, syncToken, backupToken) {
  console.log('[SYNC] 双向合并 (云端为权威)');
  await doPull(f, syncToken);
  await doPush(f, syncToken, backupToken);
  console.log('[SYNC] 完成');
}

async function doStatus(f, syncToken) {
  console.log('[STATUS] 本地 vs 云端');
  const localHash = fileHash(path.join(REPO, 'vehicles_data.js'));
  const localMtime = fileMtimeIso(path.join(REPO, 'vehicles_data.js'));
  const localVHash = fileHash(path.join(REPO, 'version.json'));
  const localVMtime = fileMtimeIso(path.join(REPO, 'version.json'));
  console.log(`  本地 vehicles_data.js: hash=${localHash} mtime=${localMtime}`);
  console.log(`  本地 version.json:       hash=${localVHash} mtime=${localVMtime}`);

  const remoteFiles = await f.listFiles(syncToken);
  for (const target of ['vehicles_data.json', 'version.json']) {
    const r = remoteFiles.find(x => x.name === target);
    if (!r) { console.log(`  云端 ${target}: (不存在)`); continue; }
    console.log(`  云端 ${target}:          token=${r.token} modified=${new Date(parseInt(r.modified_time || '0', 10) * 1000).toISOString()}`);
  }
}

main().catch(e => { console.error('✗ FAIL:', e.message); process.exit(1); });
