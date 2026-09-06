#!/usr/bin/env node
/* ============================================================
 * migrate_drive_to_bitable.js - V11.0 Drive JSON 全量迁移到 Bitable 双表
 * ============================================================
 * 用途:
 *   --dry-run 只输出差异(新增 N / 更新 M / 跳过 K), 不落库 (默认)
 *   --force   写入 Bitable; 新增走 batch_create, 更新走 batch_update (幂等可重跑)
 *
 * 对齐策略:
 *   1. 全量读 Bitable 现有记录 → 建 id → record_id 映射
 *   2. 每条本地记录: id 已存在 → 比 updatedAt (云端较旧才更新); 不存在 → 新增
 *   3. 迁移后统计 Bitable 记录数 == 本地记录数 && id 集完全一致
 *
 * 凭据: FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_TOKEN
 *       或读取项目根目录 .env.feishu (gitignore 已排除)
 * ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO = path.resolve(__dirname, '..');
const BITABLE_VEHICLES = 'tbl Vehicles';
const BITABLE_USERS = 'tbl Users';
const BATCH = 100;

// ---- 凭据加载 ----
function loadCreds() {
  let appId = process.env.FEISHU_APP_ID;
  let appSecret = process.env.FEISHU_APP_SECRET;
  let bitableToken = process.env.FEISHU_BITABLE_TOKEN;
  if (!appId) {
    const envFile = path.join(REPO, '.env.feishu');
    if (fs.existsSync(envFile)) {
      for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
        const m = line.match(/^\s*(FEISHU_APP_ID|FEISHU_APP_SECRET|FEISHU_BITABLE_TOKEN)\s*=\s*['"]?(.+?)['"]?\s*$/);
        if (m) {
          if (m[1] === 'FEISHU_APP_ID') appId = m[2];
          if (m[1] === 'FEISHU_APP_SECRET') appSecret = m[2];
          if (m[1] === 'FEISHU_BITABLE_TOKEN') bitableToken = m[2];
        }
      }
    }
  }
  if (!appId || !appSecret || !bitableToken) {
    console.error('缺少飞书凭据。请设置环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BITABLE_TOKEN');
    console.error('或在项目根目录创建 .env.feishu (已 gitignore)');
    process.exit(1);
  }
  return { appId, appSecret, bitableToken };
}

// ---- Feishu API 封装(仅需 token + Bitable 端点) ----
class FeishuClient {
  constructor({ appId, appSecret, bitableToken }) {
    this.appId = appId;
    this.appSecret = appSecret;
    this.bitableToken = bitableToken;
    this._token = null;
    this._tokenExpires = 0;
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

  async listRecords(tableId) {
    let items = [], pageToken = null;
    do {
      const url = `https://open.feishu.cn/open-apis/bitable/v1/apps/${this.bitableToken}/tables/${tableId}/records?page_size=500` + (pageToken ? `&page_token=${pageToken}` : '');
      const r = await fetch(url, { headers: await this.headers() });
      const d = await r.json();
      if (d.code !== 0) throw new Error('listRecords 失败: ' + d.msg);
      items = items.concat(d.data.items || []);
      pageToken = (d.data.has_more && d.data.page_token) ? d.data.page_token : null;
    } while (pageToken);
    return items;
  }
  async batchCreate(tableId, records) {
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${this.bitableToken}/tables/${tableId}/records/batch_create`, {
      method: 'POST', headers: { ...(await this.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ records: records.map((fields) => ({ fields })) })
    });
    const d = await r.json();
    if (d.code !== 0) throw new Error('batch_create 失败: ' + d.msg);
    return d.data.records || [];
  }
  async batchUpdate(tableId, records) {
    const r = await fetch(`https://open.feishu.cn/open-apis/bitable/v1/apps/${this.bitableToken}/tables/${tableId}/records/batch_update`, {
      method: 'POST', headers: { ...(await this.headers()), 'Content-Type': 'application/json' },
      body: JSON.stringify({ records })
    });
    const d = await r.json();
    if (d.code !== 0) throw new Error('batch_update 失败: ' + d.msg);
    return d.data.records || [];
  }
}

// ---- 字段映射(与 feishu-api.js 的 vehicleToBitable/userToBitable 保持一致) ----
function vehicleToBitable(v, userName) {
  const APP_VERSION = '10.15.2';
  return {
    id: v.id, brand: v.brand, series: v.series, config: v.config, display: v.display,
    powerType: v.powerType, position: v.position,
    steps: JSON.stringify(v.steps || []), keyFrame: v.keyFrame || '', keyContainer: v.keyContainer || '',
    remarks: v.remarks || '',
    photos: JSON.stringify(v.photos || v.photoPaths || []),
    videos: JSON.stringify(v.videos || v.videoPaths || []),
    updatedAt: v.updatedAt || v._syncTs || 0,
    updatedBy: userName || v.updatedBy || '',
    syncVersion: APP_VERSION,
  };
}
function userToBitable(u) {
  return {
    id: u.id, name: u.name, phone: u.phone || '', role: u.role,
    department: u.department || '', status: u.status || 'active',
    registeredAt: u.registeredAt || u.createdAt || Date.now(),
    approvedBy: u.approvedBy || '', approvedAt: u.approvedAt || '',
    feishuOpenId: u.feishuOpenId || '',
    updatedAt: u.updatedAt || Date.now(),
  };
}
const parseJson = (s, dflt) => { try { return JSON.parse(s); } catch (e) { return dflt; } };
function bitableToVehicle(record) {
  const f = record.fields;
  return {
    id: f.id, brand: f.brand, series: f.series, config: f.config, display: f.display,
    powerType: f.powerType, position: f.position,
    steps: parseJson(f.steps, []), keyFrame: f.keyFrame, keyContainer: f.keyContainer, remarks: f.remarks,
    photos: parseJson(f.photos, []), photoPaths: parseJson(f.photos, []),
    videos: parseJson(f.videos, []), videoPaths: parseJson(f.videos, []),
    _syncTs: f.updatedAt || 0,
    _recordId: record.record_id,
  };
}
function bitableToUser(record) {
  const f = record.fields;
  return {
    id: f.id, name: f.name, phone: f.phone, role: f.role, department: f.department,
    status: f.status, registeredAt: f.registeredAt, approvedBy: f.approvedBy,
    approvedAt: f.approvedAt, feishuOpenId: f.feishuOpenId,
    updatedAt: f.updatedAt || 0, _recordId: record.record_id,
  };
}

// ---- 本地数据读取 ----
function readVehicles() {
  const js = fs.readFileSync(path.join(REPO, 'vehicles_data.js'), 'utf8');
  const patched = js.replace(/^const VEHICLES\s*=/m, 'window.__vehicles_out = ');
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  try { vm.runInContext(patched, sandbox, { filename: 'vehicles_data.js' }); } catch (e) { throw new Error('vehicles_data.js 执行失败: ' + e.message); }
  const vehicles = sandbox.window.__vehicles_out;
  if (!Array.isArray(vehicles)) throw new Error('vehicles_data.js 中找不到 VEHICLES 数组');
  return vehicles;
}
function readUsers() {
  // 优先 web-data 发布镜像, 其次本地 approved_users JSON
  const candidates = [
    path.join(REPO, 'web-data', 'approved_users.web.json'),
    path.join(REPO, 'approved_users.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const arr = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (Array.isArray(arr)) return arr;
    }
  }
  return [];
}

// ---- 差异计算 ----
function diff(local, cloud, mkFields, getTs) {
  const cloudById = new Map(cloud.map((x) => [x.id, x]));
  const toCreate = [], toUpdate = [], skip = [];
  for (const item of local) {
    const c = cloudById.get(item.id);
    if (!c) { toCreate.push(item); }
    else if (Number(getTs(item) || 0) > Number(getTs(c) || 0)) { toUpdate.push({ recordId: c._recordId, fields: mkFields(item) }); }
    else { skip.push(item.id); }
  }
  return { toCreate, toUpdate, skip };
}

// ---- 主流程 ----
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const target = args.find((a) => a === 'vehicles' || a === 'users') || 'both';

  const creds = loadCreds();
  const f = new FeishuClient(creds);

  if (target === 'both' || target === 'vehicles') {
    const local = readVehicles();
    const cloud = (await f.listRecords(BITABLE_VEHICLES)).map(bitableToVehicle);
    const { toCreate, toUpdate, skip } = diff(local, cloud, (v) => vehicleToBitable(v, ''), (x) => x.updatedAt || x._syncTs);
    console.log(`[vehicles] 本地 ${local.length} / 云端 ${cloud.length} | 新增 ${toCreate.length} / 更新 ${toUpdate.length} / 跳过 ${skip.length}`);
    if (force) {
      for (let i = 0; i < toCreate.length; i += BATCH) {
        const batch = toCreate.slice(i, i + BATCH).map((v) => vehicleToBitable(v, ''));
        await f.batchCreate(BITABLE_VEHICLES, batch);
        console.log(`  创建进度 ${Math.min(i + BATCH, toCreate.length)}/${toCreate.length}`);
      }
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const batch = toUpdate.slice(i, i + BATCH);
        await f.batchUpdate(BITABLE_VEHICLES, batch);
        console.log(`  更新进度 ${Math.min(i + BATCH, toUpdate.length)}/${toUpdate.length}`);
      }
      const after = (await f.listRecords(BITABLE_VEHICLES)).map(bitableToVehicle);
      const localIds = new Set(local.map((x) => x.id));
      const cloudIds = new Set(after.map((x) => x.id));
      const missing = local.filter((x) => !cloudIds.has(x.id)).map((x) => x.id);
      const orphan = after.filter((x) => !localIds.has(x.id)).map((x) => x.id);
      if (after.length !== local.length || missing.length || orphan.length) {
        console.error(`✗ 校验失败: Bitable=${after.length} 本地=${local.length}, 缺=${missing.length}, 多余=${orphan.length}`);
        console.error(`  缺: ${missing.join(',') || '-'}`);
        console.error(`  多余: ${orphan.join(',') || '-'}`);
        process.exit(1);
      }
      console.log(`✓ 校验通过: Bitable=${after.length} == 本地=${local.length}, id 集完全一致`);
    }
  }

  if (target === 'both' || target === 'users') {
    const local = readUsers();
    const cloud = (await f.listRecords(BITABLE_USERS)).map(bitableToUser);
    const { toCreate, toUpdate, skip } = diff(local, cloud, (u) => userToBitable(u), (x) => x.updatedAt || 0);
    console.log(`[users] 本地 ${local.length} / 云端 ${cloud.length} | 新增 ${toCreate.length} / 更新 ${toUpdate.length} / 跳过 ${skip.length}`);
    if (force) {
      for (let i = 0; i < toCreate.length; i += BATCH) {
        const batch = toCreate.slice(i, i + BATCH).map((u) => userToBitable(u));
        await f.batchCreate(BITABLE_USERS, batch);
      }
      for (let i = 0; i < toUpdate.length; i += BATCH) {
        const batch = toUpdate.slice(i, i + BATCH);
        await f.batchUpdate(BITABLE_USERS, batch);
      }
      const after = (await f.listRecords(BITABLE_USERS)).map(bitableToUser);
      const localIds = new Set(local.map((x) => x.id));
      const cloudIds = new Set(after.map((x) => x.id));
      const missing = local.filter((x) => !cloudIds.has(x.id)).map((x) => x.id);
      const orphan = after.filter((x) => !localIds.has(x.id)).map((x) => x.id);
      if (after.length !== local.length || missing.length || orphan.length) {
        console.error(`✗ 校验失败: Bitable=${after.length} 本地=${local.length}, 缺=${missing.length}, 多余=${orphan.length}`);
        process.exit(1);
      }
      console.log(`✓ 校验通过: Bitable=${after.length} == 本地=${local.length}, id 集完全一致`);
    }
  }

  if (!force) console.log('\n[提示] 当前为 --dry-run, 未写入任何数据; 确认后加 --force 执行.');
}

main().catch((e) => { console.error('✗ FAIL:', e.message); process.exit(1); });
