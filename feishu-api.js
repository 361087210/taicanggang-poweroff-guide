/**
 * ============================================================
 * FeishuDataLayer v5.7.0
 * 太仓港停电指南 - 飞书数据同步封装层
 * 功能: 认证管理 | Bitable 结构化数据 | 云文档文件 | 审批流 | 消息推送
 * V5.7: 数据分仓(APP数据备份/{同步数据,注册申请,审批结果,备份文件})
 *       与demo.html内置实现互补,本模块作为高级能力保留
 * ============================================================
 */

const FeishuAPI = (function() {
  'use strict';

  // ---------- 默认配置 ----------
  const DEFAULTS = {
    appId: '',
    appSecret: '',
    folderToken: 'WdXUfZPkClI1audQxIYc90XRnWc',      // 云文档根文件夹
    dataFolderName: 'APP数据备份',                      // 数据备份子文件夹
    bitableAppToken: '',                                // 多维表格 AppToken（可选）
    approvalCode: '',                                   // 审批定义 Code（可选）
    chatId: '',                                         // 默认群聊 ID
    tokenCacheKey: 'feishu_token_cache',
    tokenExpiryMargin: 300,                            // token 提前 5 分钟刷新
    requestTimeout: 30000,
    maxRetries: 2,
    retryDelay: 1000,
  };

  // ---------- 内部状态 ----------
  let _cfg = null;
  let _token = null;
  let _tokenExpiry = 0;

  // ==========================================================
  // 配置管理
  // ==========================================================
  function getConfig() {
    if (_cfg) return _cfg;
    const saved = JSON.parse(localStorage.getItem('feishu_config') || '{}');
    _cfg = {
      appId: saved.appId || DEFAULTS.appId,
      appSecret: saved.appSecret || DEFAULTS.appSecret,
      folderToken: saved.folder || DEFAULTS.folderToken,
      dataFolderName: saved.dataFolder || DEFAULTS.dataFolderName,
      bitableAppToken: saved.bitableAppToken || DEFAULTS.bitableAppToken,
      approvalCode: saved.approvalCode || DEFAULTS.approvalCode,
      chatId: saved.chatId || DEFAULTS.chatId,
    };
    return _cfg;
  }

  function setConfig(updates) {
    const current = getConfig();
    Object.assign(current, updates);
    localStorage.setItem('feishu_config', JSON.stringify({
      appId: current.appId,
      appSecret: current.appSecret,
      folder: current.folderToken,
      dataFolder: current.dataFolderName,
      bitableAppToken: current.bitableAppToken,
      approvalCode: current.approvalCode,
      chatId: current.chatId,
    }));
    _cfg = current;
  }

  function isConfigReady() {
    const c = getConfig();
    return !!(c.appId && c.appSecret && c.appId.length > 5 && c.appSecret.length > 5);
  }

  // ==========================================================
  // 日志与通知
  // ==========================================================
  function log(level, msg, detail) {
    const entry = {
      time: new Date().toISOString(),
      level: level, // 'info' | 'warn' | 'error' | 'success'
      msg: msg,
      detail: detail || '',
    };
    const logs = JSON.parse(localStorage.getItem('feishu_sync_logs') || '[]');
    logs.unshift(entry);
    if (logs.length > 500) logs.length = 500;
    localStorage.setItem('feishu_sync_logs', JSON.stringify(logs));
    if (typeof addSyncLog === 'function') {
      addSyncLog(msg, level === 'error' ? 'red' : (level === 'success' ? 'green' : 'blue'));
    }
    console.log(`[FeishuAPI ${level}]`, msg, detail || '');
  }

  // ==========================================================
  // HTTP 请求封装（带重试、超时、错误处理）
  // ==========================================================
  async function request(url, options) {
    const opts = Object.assign({ method: 'GET', headers: {} }, options);
    opts.headers['Content-Type'] = opts.headers['Content-Type'] || 'application/json';

    let lastErr;
    for (let attempt = 0; attempt <= DEFAULTS.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), DEFAULTS.requestTimeout);
        const resp = await fetch(url, Object.assign(opts, { signal: controller.signal }));
        clearTimeout(timer);

        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          throw new Error(`HTTP ${resp.status}: ${data.msg || data.message || resp.statusText}`);
        }
        if (data.code !== undefined && data.code !== 0) {
          throw new Error(`Feishu API ${data.code}: ${data.msg || 'unknown error'}`);
        }
        return data.data || data;
      } catch (err) {
        lastErr = err;
        if (attempt < DEFAULTS.maxRetries) {
          log('warn', `请求重试 ${attempt + 1}/${DEFAULTS.maxRetries}`, url);
          await sleep(DEFAULTS.retryDelay * (attempt + 1));
        }
      }
    }
    throw lastErr;
  }

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // ==========================================================
  // 认证: Tenant Access Token
  // ==========================================================
  async function getTenantToken(forceRefresh) {
    const now = Math.floor(Date.now() / 1000);
    if (!forceRefresh && _token && now < (_tokenExpiry - DEFAULTS.tokenExpiryMargin)) {
      return _token;
    }
    const c = getConfig();
    if (!c.appId || !c.appSecret) {
      throw new Error('飞书配置不完整: 缺少 appId 或 appSecret');
    }
    const data = await request('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      body: JSON.stringify({ app_id: c.appId, app_secret: c.appSecret }),
    });
    _token = data.tenant_access_token;
    _tokenExpiry = now + (data.expire || 7200);
    log('info', 'Tenant token 刷新成功', `有效期至 ${new Date(_tokenExpiry * 1000).toLocaleString()}`);
    return _token;
  }

  async function authHeaders(forceRefresh) {
    const token = await getTenantToken(forceRefresh);
    return { Authorization: `Bearer ${token}` };
  }

  // ==========================================================
  // 云文档: 文件夹与文件
  // ==========================================================

  /** 获取或创建数据备份子文件夹 */
  async function getDataFolderToken() {
    const c = getConfig();
    const token = await getTenantToken();
    const headers = { Authorization: `Bearer ${token}` };

    // 1. 尝试从缓存读取
    const cached = localStorage.getItem('tcg_data_folder_token');
    if (cached) return cached;

    // 2. 列出根文件夹内容
    const list = await request(
      `https://open.feishu.cn/open-apis/drive/v1/files/${c.folderToken}/children?page_size=200`,
      { headers }
    );
    const found = (list.files || []).find(f => f.name === c.dataFolderName && f.type === 'folder');
    if (found) {
      localStorage.setItem('tcg_data_folder_token', found.token);
      return found.token;
    }

    // 3. 创建子文件夹
    log('info', `创建数据备份文件夹: ${c.dataFolderName}`);
    const created = await request('https://open.feishu.cn/open-apis/drive/v1/files/create_folder', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name: c.dataFolderName, folder_token: c.folderToken }),
    });
    localStorage.setItem('tcg_data_folder_token', created.token);
    return created.token;
  }

  /** 列出文件夹内文件 */
  async function driveListFiles(folderToken) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/drive/v1/files/${folderToken}/children?page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data.files || [];
  }

  /** 上传文件到云文档 */
  async function driveUploadFile(folderToken, fileName, blob) {
    const token = await getTenantToken();
    const form = new FormData();
    form.append('file_name', fileName);
    form.append('parent_type', 'explorer');
    form.append('parent_node', folderToken);
    form.append('size', String(blob.size));
    form.append('file', blob, fileName);

    const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/medias/upload_all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await resp.json();
    if (data.code !== 0) throw new Error(`上传失败 ${data.code}: ${data.msg}`);
    log('success', `文件上传成功`, fileName);
    return data.data;
  }

  /** 下载云文档文件 */
  async function driveDownloadFile(fileToken) {
    const token = await getTenantToken();
    const meta = await request(
      `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}?type=file`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const downloadResp = await fetch(meta.url || meta.tmp_url || meta.file_token, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!downloadResp.ok) throw new Error(`下载失败 HTTP ${downloadResp.status}`);
    return await downloadResp.blob();
  }

  /** 删除文件 */
  async function driveDeleteFile(fileToken) {
    const token = await getTenantToken();
    await request(
      `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}?type=file`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
    log('info', '文件已删除', fileToken);
  }

  // ==========================================================
  // Bitable: 结构化数据操作
  // ==========================================================

  function bitableHeaders() {
    return { Authorization: `Bearer ${_token}` };
  }

  /** 列出表格记录 */
  async function bitableListRecords(appToken, tableId, options) {
    const token = await getTenantToken();
    const params = new URLSearchParams();
    params.set('page_size', String(options?.pageSize || 500));
    if (options?.filter) params.set('filter', JSON.stringify(options.filter));
    if (options?.sort) params.set('sort', JSON.stringify(options.sort));
    const data = await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records?${params}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data.items || [];
  }

  /** 创建单条记录 */
  async function bitableCreateRecord(appToken, tableId, fields) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }
    );
    return data.record;
  }

  /** 批量创建记录 */
  async function bitableBatchCreate(appToken, tableId, records) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_create`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records.map(r => ({ fields: r })) }),
      }
    );
    return data.records || [];
  }

  /** 更新记录 */
  async function bitableUpdateRecord(appToken, tableId, recordId, fields) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields }),
      }
    );
    return data.record;
  }

  /** 批量更新 */
  async function bitableBatchUpdate(appToken, tableId, records) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/batch_update`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ records: records.map(r => ({ record_id: r.recordId, fields: r.fields })) }),
      }
    );
    return data.records || [];
  }

  /** 删除记录 */
  async function bitableDeleteRecord(appToken, tableId, recordId) {
    const token = await getTenantToken();
    await request(
      `https://open.feishu.cn/open-apis/bitable/v1/apps/${appToken}/tables/${tableId}/records/${recordId}`,
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } }
    );
  }

  // ==========================================================
  // 审批流
  // ==========================================================

  /** 创建审批实例 */
  async function approvalCreate(definitionCode, formData, userId) {
    const token = await getTenantToken();
    const data = await request(
      'https://open.feishu.cn/open-apis/approval/v4/instances',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          approval_code: definitionCode,
          form: JSON.stringify(formData),
          node_approver_user_id_list: userId ? [userId] : undefined,
        }),
      }
    );
    log('success', '审批实例创建成功', data.instance_code);
    return data.instance_code;
  }

  /** 查询审批状态 */
  async function approvalQuery(instanceCode) {
    const token = await getTenantToken();
    const data = await request(
      `https://open.feishu.cn/open-apis/approval/v4/instances/${instanceCode}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data;
  }

  /** 批量查询审批状态 */
  async function approvalBatchQuery(instanceCodes) {
    const results = [];
    for (const code of instanceCodes) {
      try {
        const status = await approvalQuery(code);
        results.push({ code, status: status.status, data: status });
      } catch (e) {
        results.push({ code, status: 'error', error: e.message });
      }
    }
    return results;
  }

  // ==========================================================
  // 消息推送
  // ==========================================================

  /** 发送文本消息到群聊 */
  async function sendGroupMessage(chatId, content) {
    const token = await getTenantToken();
    const data = await request(
      'https://open.feishu.cn/open-apis/im/v1/messages',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text: content }),
        }),
      }
    );
    log('success', '消息发送成功', chatId);
    return data;
  }

  /** 发送交互式卡片 */
  async function sendInteractiveCard(chatId, card) {
    const token = await getTenantToken();
    const data = await request(
      'https://open.feishu.cn/open-apis/im/v1/messages',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'interactive',
          content: JSON.stringify(card),
        }),
      }
    );
    log('success', '卡片发送成功', chatId);
    return data;
  }

  // ==========================================================
  // 高级同步: Vehicles 双向同步
  // ==========================================================

  const VEHICLE_TABLE_FIELDS = {
    id: 'text',
    brand: 'text',
    series: 'text',
    config: 'text',
    display: 'text',
    powerType: 'text',
    position: 'text',
    steps: 'text',       // JSON string
    keyFrame: 'text',
    keyContainer: 'text',
    remarks: 'text',
    photos: 'text',      // JSON array string
    videos: 'text',      // JSON array string
    updatedAt: 'number', // timestamp
    updatedBy: 'text',
    syncVersion: 'text', // APP version
  };

  /** 将 Vehicle 对象转换为 Bitable fields */
  function vehicleToBitable(v, userName) {
    return {
      id: v.id,
      brand: v.brand,
      series: v.series,
      config: v.config,
      display: v.display,
      powerType: v.powerType,
      position: v.position,
      steps: JSON.stringify(v.steps || []),
      keyFrame: v.keyFrame || '',
      keyContainer: v.keyContainer || '',
      remarks: v.remarks || '',
      photos: JSON.stringify(v.photos || v.photoPaths || []),
      videos: JSON.stringify(v.videos || v.videoPaths || []),
      updatedAt: Date.now(),
      updatedBy: userName || '',
      syncVersion: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '5.3.6'),
    };
  }

  /** 将 Bitable record 转换为 Vehicle 对象 */
  function bitableToVehicle(record) {
    const f = record.fields;
    const parseJson = (s) => { try { return JSON.parse(s); } catch(e) { return []; } };
    return {
      id: f.id,
      brand: f.brand,
      series: f.series,
      config: f.config,
      display: f.display,
      powerType: f.powerType,
      position: f.position,
      steps: parseJson(f.steps),
      keyFrame: f.keyFrame,
      keyContainer: f.keyContainer,
      remarks: f.remarks,
      photos: parseJson(f.photos),
      photoPaths: parseJson(f.photos),
      videos: parseJson(f.videos),
      videoPaths: parseJson(f.videos),
      pinyin: (typeof getPinyin === 'function' ? getPinyin(f.display) : f.display),
      _recordId: record.record_id,
      _syncTs: f.updatedAt,
    };
  }

  /** 增量上传 Vehicles 到 Bitable */
  async function syncVehiclesToBitable(vehicles, options) {
    const c = getConfig();
    if (!c.bitableAppToken) {
      throw new Error('未配置 Bitable AppToken，请在设置中填写');
    }
    const tableId = options?.tableId || 'tbl Vehicles';
    const userName = options?.userName || '';
    const batchSize = options?.batchSize || 100;

    log('info', `开始上传 ${vehicles.length} 条车型数据到 Bitable...`);

    // 1. 拉取云端现有记录（建立 id -> record_id 映射）
    const cloudRecords = await bitableListRecords(c.bitableAppToken, tableId, { pageSize: 500 });
    const idMap = new Map();
    for (const r of cloudRecords) {
      if (r.fields && r.fields.id) idMap.set(r.fields.id, r.record_id);
    }

    // 2. 分批处理: 新增 vs 更新
    const toCreate = [];
    const toUpdate = [];
    for (const v of vehicles) {
      const fields = vehicleToBitable(v, userName);
      if (idMap.has(v.id)) {
        toUpdate.push({ recordId: idMap.get(v.id), fields });
      } else {
        toCreate.push(fields);
      }
    }

    let created = 0, updated = 0;

    // 3. 批量创建
    for (let i = 0; i < toCreate.length; i += batchSize) {
      const batch = toCreate.slice(i, i + batchSize);
      await bitableBatchCreate(c.bitableAppToken, tableId, batch);
      created += batch.length;
      log('info', `批量创建进度 ${created}/${toCreate.length}`);
    }

    // 4. 批量更新
    for (let i = 0; i < toUpdate.length; i += batchSize) {
      const batch = toUpdate.slice(i, i + batchSize);
      await bitableBatchUpdate(c.bitableAppToken, tableId, batch);
      updated += batch.length;
      log('info', `批量更新进度 ${updated}/${toUpdate.length}`);
    }

    log('success', `车型数据同步完成`, `新增 ${created} 条, 更新 ${updated} 条`);
    return { created, updated, total: vehicles.length };
  }

  /** 从 Bitable 拉取 Vehicles 并智能合并到本地 */
  async function syncVehiclesFromBitable(options) {
    const c = getConfig();
    if (!c.bitableAppToken) {
      throw new Error('未配置 Bitable AppToken');
    }
    const tableId = options?.tableId || 'tbl Vehicles';
    const localVehicles = options?.localVehicles || (typeof VEHICLES !== 'undefined' ? VEHICLES : []);
    const onConflict = options?.onConflict || 'cloud'; // 'cloud' | 'local' | 'newer'

    log('info', '开始从 Bitable 拉取车型数据...');

    const cloudRecords = await bitableListRecords(c.bitableAppToken, tableId, { pageSize: 500 });
    const cloudVehicles = cloudRecords.map(bitableToVehicle);

    let added = 0, updated = 0, skipped = 0;
    const localMap = new Map(localVehicles.map(v => [v.id, v]));

    for (const cv of cloudVehicles) {
      const local = localMap.get(cv.id);
      if (!local) {
        localVehicles.push(cv);
        added++;
      } else {
        const cloudTs = cv._syncTs || 0;
        const localTs = local._syncTs || 0;
        let shouldUpdate = false;
        if (onConflict === 'cloud') shouldUpdate = true;
        else if (onConflict === 'newer') shouldUpdate = cloudTs > localTs;

        if (shouldUpdate) {
          Object.assign(local, cv);
          delete local._recordId;
          delete local._syncTs;
          updated++;
        } else {
          skipped++;
        }
      }
    }

    log('success', `车型数据拉取完成`, `新增 ${added}, 更新 ${updated}, 跳过 ${skipped}`);
    return { added, updated, skipped, total: cloudVehicles.length };
  }

  // ==========================================================
  // 高级同步: Users 双向同步
  // ==========================================================

  function userToBitable(u) {
    return {
      id: u.id,
      name: u.name,
      phone: u.phone || '',
      role: u.role,
      department: u.department || '',
      status: u.status || 'active',
      registeredAt: u.registeredAt || u.createdAt || Date.now(),
      approvedBy: u.approvedBy || '',
      approvedAt: u.approvedAt || '',
      feishuOpenId: u.feishuOpenId || '',
    };
  }

  function bitableToUser(record) {
    const f = record.fields;
    return {
      id: f.id,
      name: f.name,
      phone: f.phone,
      role: f.role,
      department: f.department,
      status: f.status,
      registeredAt: f.registeredAt,
      approvedBy: f.approvedBy,
      approvedAt: f.approvedAt,
      feishuOpenId: f.feishuOpenId,
      _recordId: record.record_id,
    };
  }

  async function syncUsersToBitable(users, options) {
    const c = getConfig();
    if (!c.bitableAppToken) throw new Error('未配置 Bitable AppToken');
    const tableId = options?.tableId || 'tbl Users';
    const cloudRecords = await bitableListRecords(c.bitableAppToken, tableId, { pageSize: 500 });
    const idMap = new Map();
    for (const r of cloudRecords) { if (r.fields?.id) idMap.set(r.fields.id, r.record_id); }

    const toCreate = [], toUpdate = [];
    for (const u of users) {
      const fields = userToBitable(u);
      if (idMap.has(u.id)) toUpdate.push({ recordId: idMap.get(u.id), fields });
      else toCreate.push(fields);
    }
    let created = 0, updated = 0;
    for (let i = 0; i < toCreate.length; i += 100) {
      const batch = toCreate.slice(i, i + 100);
      await bitableBatchCreate(c.bitableAppToken, tableId, batch);
      created += batch.length;
    }
    for (let i = 0; i < toUpdate.length; i += 100) {
      const batch = toUpdate.slice(i, i + 100);
      await bitableBatchUpdate(c.bitableAppToken, tableId, batch);
      updated += batch.length;
    }
    log('success', `用户数据同步完成`, `新增 ${created}, 更新 ${updated}`);
    return { created, updated };
  }

  async function syncUsersFromBitable(options) {
    const c = getConfig();
    if (!c.bitableAppToken) throw new Error('未配置 Bitable AppToken');
    const tableId = options?.tableId || 'tbl Users';
    const localUsers = options?.localUsers || (typeof USERS !== 'undefined' ? USERS : []);
    const cloudRecords = await bitableListRecords(c.bitableAppToken, tableId, { pageSize: 500 });
    const cloudUsers = cloudRecords.map(bitableToUser);

    let added = 0, updated = 0;
    const localMap = new Map(localUsers.map(u => [u.id, u]));
    for (const cu of cloudUsers) {
      const local = localMap.get(cu.id);
      if (!local) { localUsers.push(cu); added++; }
      else { Object.assign(local, cu); delete local._recordId; updated++; }
    }
    log('success', `用户数据拉取完成`, `新增 ${added}, 更新 ${updated}`);
    return { added, updated };
  }

  // ==========================================================
  // 全量备份与恢复（云文档 JSON 快照）
  // ==========================================================

  async function backupAllData(options) {
    const c = getConfig();
    const folderToken = await getDataFolderToken();
    const vehicles = options?.vehicles || (typeof VEHICLES !== 'undefined' ? VEHICLES : []);
    const users = options?.users || (typeof USERS !== 'undefined' ? USERS : []);
    const logs = JSON.parse(localStorage.getItem('feishu_sync_logs') || '[]');

    const payload = {
      version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '5.3.6'),
      timestamp: new Date().toISOString(),
      deviceInfo: navigator.userAgent,
      summary: {
        vehicleCount: vehicles.length,
        userCount: users.length,
        logCount: logs.length,
      },
      vehicles: vehicles,
      users: users,
      logs: logs.slice(0, 100), // 只备份最近 100 条日志
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const fileName = `full_backup_${new Date().toISOString().slice(0,10)}_${Date.now()}.json`;
    const result = await driveUploadFile(folderToken, fileName, blob);

    // 保留最近 10 个备份，删除旧备份
    try {
      const files = await driveListFiles(folderToken);
      const backups = files.filter(f => f.name.startsWith('full_backup_')).sort((a,b) => b.name.localeCompare(a.name));
      for (const old of backups.slice(10)) {
        await driveDeleteFile(old.token);
      }
    } catch(e) { log('warn', '旧备份清理跳过', e.message); }

    log('success', '全量备份完成', fileName);
    return { fileName, fileToken: result.file_token, size: blob.size };
  }

  async function restoreFromBackup(fileToken, options) {
    const blob = await driveDownloadFile(fileToken);
    const text = await blob.text();
    const data = JSON.parse(text);

    if (options?.vehicles && data.vehicles) {
      options.vehicles.length = 0;
      options.vehicles.push(...data.vehicles);
    }
    if (options?.users && data.users) {
      options.users.length = 0;
      options.users.push(...data.users);
    }
    if (data.logs) {
      localStorage.setItem('feishu_sync_logs', JSON.stringify(data.logs));
    }

    log('success', '数据恢复完成', `车型 ${data.vehicles?.length || 0} 条, 用户 ${data.users?.length || 0} 条`);
    return { vehicleCount: data.vehicles?.length || 0, userCount: data.users?.length || 0 };
  }

  // ==========================================================
  // 定时同步任务
  // ==========================================================

  let _syncTimer = null;

  function startAutoSync(options) {
    stopAutoSync();
    const interval = (options?.intervalMinutes || 30) * 60 * 1000;
    _syncTimer = setInterval(async () => {
      try {
        log('info', '执行定时自动同步...');
        if (options?.onSync) await options.onSync();
      } catch (e) {
        log('error', '定时同步失败', e.message);
      }
    }, interval);
    log('info', `定时同步已启动`, `间隔 ${options?.intervalMinutes || 30} 分钟`);
  }

  function stopAutoSync() {
    if (_syncTimer) { clearInterval(_syncTimer); _syncTimer = null; }
  }

  // ==========================================================
  // 导出公共 API
  // ==========================================================
  return {
    // 配置
    getConfig, setConfig, isConfigReady, DEFAULTS,
    // 认证
    getTenantToken, authHeaders,
    // 云文档
    getDataFolderToken, driveListFiles, driveUploadFile, driveDownloadFile, driveDeleteFile,
    // Bitable
    bitableListRecords, bitableCreateRecord, bitableBatchCreate,
    bitableUpdateRecord, bitableBatchUpdate, bitableDeleteRecord,
    // 审批
    approvalCreate, approvalQuery, approvalBatchQuery,
    // 消息
    sendGroupMessage, sendInteractiveCard,
    // 高级同步
    syncVehiclesToBitable, syncVehiclesFromBitable,
    syncUsersToBitable, syncUsersFromBitable,
    backupAllData, restoreFromBackup,
    startAutoSync, stopAutoSync,
    // 工具
    log, vehicleToBitable, bitableToVehicle,
  };
})();

// 兼容旧代码: 若存在全局 getFeishuToken, 将其代理到 FeishuAPI
if (typeof window !== 'undefined') {
  window.FeishuAPI = FeishuAPI;
}
