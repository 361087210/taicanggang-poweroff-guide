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
    folderToken: 'nodcnGA95g93RhIUSdCeTkhKlQc',      // 云文档根文件夹(V10.13: 新App根目录)
    dataFolderName: 'APP数据备份',                      // 数据备份子文件夹
    bitableAppToken: '',                                // 多维表格 AppToken（可选）
    approvalCode: '',                                   // 审批定义 Code（可选）
    chatId: '',                                         // 默认群聊 ID
    tokenCacheKey: 'feishu_token_cache',
    tokenExpiryMargin: 300,                            // token 提前 5 分钟刷新
    requestTimeout: 30000,
    maxRetries: 2,
    retryDelay: 1000,
    // V11.0: Bitable 双表默认表名 (收敛硬编码字符串, 供 dataAccess/迁移脚本/测试共用)
    bitableTables: {
      VEHICLES: 'tbl Vehicles',
      USERS: 'tbl Users',
    },
    // V11.0: JSON 双写窗口(天); 超过窗口的旧写入只写 Bitable, 不再双写 JSON 控制 Drive 体积
    jsonMirrorDays: 30,
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
      `https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${c.folderToken}&page_size=200`,
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
      `https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    return data.files || [];
  }

  // ==========================================================
  // V10.12.0: 上传核心能力统一到此(取代demo.html双轨);兼容 Cordova 原生+fetch 双栈
  // 特性: 220ms QPS串行门控 · 1061021事务过期整段重传 · 1061045频控退避 · 文件名清洗
  // ==========================================================
  /** 上传类API QPS门控: 串行+最小间隔220ms,贴官方5QPS限制飞行 */
  let _feishuUploadLastTs = 0;
  const FEISHU_UPLOAD_ALL_LIMIT = 20 * 1024 * 1024;
  const FEISHU_MULTIPART_THRESHOLD = 16 * 1024 * 1024;
  const FEISHU_MULTIPART_MAX = 500 * 1024 * 1024;
  async function _qpsGate() {
    const wait = Math.max(0, _feishuUploadLastTs + 220 - Date.now());
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    _feishuUploadLastTs = Date.now();
  }
  /** Adler-32 校验和(飞书 upload_part checksum 算法) */
  function _adler32(u8) {
    const MOD = 65521; let a = 1, b = 0;
    for (let i = 0; i < u8.length; i++) { a = (a + u8[i]) % MOD; b = (b + a) % MOD; }
    return String((((b << 16) | a) >>> 0));
  }
  /** 飞书文件名清洗 - 解决 1061109 file name cqc not passed */
  function _sanitizeFeishuFileName(name, maxLen) {
    const limit = maxLen || 150;
    let s = String(name || '')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu, '')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^[.\s_]+|[.\s_]+$/g, '');
    if (!s) s = 'file_' + Date.now().toString(36);
    if (s.length > limit) {
      const dot = s.lastIndexOf('.');
      const ext = (dot > 0 && s.length - dot <= 6) ? s.slice(dot) : '';
      s = s.slice(0, limit - ext.length) + ext;
    }
    return s;
  }
  /** Cordova 原生上传(绕过 CORS + ponyfill FormData); 失败返回 null */
  function _cordovaMultipart(url, token, fieldsPairs, fileTriple) {
    if (!(typeof window !== 'undefined' && window.cordova && window.cordova.plugin && window.cordova.plugin.http)) return null;
    try {
      const http = window.cordova.plugin.http;
      const FormDataCtor = (http.ponyfills && http.ponyfills.FormData) || window.FormData;
      if (!FormDataCtor) return null;
      const fd = new FormDataCtor();
      fieldsPairs.forEach(([k, v]) => fd.append(k, v));
      if (fileTriple) fd.append(fileTriple[0], fileTriple[1], fileTriple[2]);
      return new Promise((resolve, reject) => {
        try {
          http.sendRequest(url, {
            method: 'post',
            data: fd,
            serializer: 'multipart',
            headers: { Authorization: 'Bearer ' + token },
            responseType: 'text'
          },
            res => { try { resolve(JSON.parse(res.data)); } catch (e) { resolve(res.data); } },
            err => reject(new Error(typeof err === 'object' ? (err.error || err.message || '上传失败') : String(err)))
          );
        } catch (syncErr) { reject(syncErr instanceof Error ? syncErr : new Error(String(syncErr))); }
      });
    } catch (e) { console.warn('[feishu-api] cordova upload fallback trigger:', e); return null; }
  }
  /** 上传单个分片 - 原生multipart优先,fetch兜底 */
  async function _uploadPartOnce(token, uploadId, seq, u8, checksum) {
    const chunkBlob = new Blob([u8]);
    const pairs = [['upload_id', uploadId], ['seq', String(seq)], ['size', String(u8.length)], ['checksum', checksum]];
    const cvd = await _cordovaMultipart(
      'https://open.feishu.cn/open-apis/drive/v1/files/upload_part',
      token, pairs, ['file', chunkBlob, 'chunk_' + seq]
    );
    if (cvd !== null) return cvd;
    const fd = new FormData();
    pairs.forEach(([k, v]) => fd.append(k, v));
    fd.append('file', chunkBlob, 'chunk_' + seq);
    const res = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_part', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd });
    return res.json();
  }
  /** 通用单次 upload_all: Cordova → fetch 双栈,返回原始响应{code,msg,data} */
  async function _uploadAllRaw(token, folderToken, fileName, blob) {
    const safeName = _sanitizeFeishuFileName(fileName);
    const pairs = [['file_name', safeName], ['parent_type', 'explorer'], ['parent_node', folderToken], ['size', String(blob.size)]];
    await _qpsGate();
    const cvd = await _cordovaMultipart(
      'https://open.feishu.cn/open-apis/drive/v1/files/upload_all',
      token, pairs, ['file', blob, safeName]
    );
    if (cvd !== null) return cvd;
    const form = new FormData();
    pairs.forEach(([k, v]) => form.append(k, v));
    form.append('file', blob, safeName);
    const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    return await resp.json();
  }

  /** 上传文件到云文档(V10.12: 统一Cordova双栈+QPS+超限升级) */
  async function driveUploadFile(folderToken, fileName, blob) {
    const token = await getTenantToken();
    if (blob && blob.size > FEISHU_MULTIPART_THRESHOLD) {
      return await driveUploadFileMultipart(folderToken, fileName, blob);
    }
    const data = await _uploadAllRaw(token, folderToken, fileName, blob);
    if (data.code === 1061043) {
      log('warn', 'upload_all超限,自动升级分片上传', fileName);
      return await driveUploadFileMultipart(folderToken, fileName, blob);
    }
    if (data.code !== 0) throw new Error(`上传失败 ${data.code}: ${data.msg}`);
    log('success', `文件上传成功`, fileName);
    return data.data;
  }

  /**
   * V10.12: 分片上传 - 新增:QPS门控/1061021事务过期整段重传/1061045频控退避/Cordova原生分片
   */
  async function driveUploadFileMultipart(folderToken, fileName, blob, onProgress) {
    const token = await getTenantToken();
    const op = onProgress || (() => {});
    if (!blob || blob.size <= 0) throw new Error('空文件不可上传');
    if (blob.size > FEISHU_MULTIPART_MAX) throw new Error('文件超过500MB上限,请压缩后重试');
    const safeName = _sanitizeFeishuFileName(fileName);
    const doPrepare = async () => {
      await _qpsGate();
      const full = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_prepare', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ file_name: safeName, parent_type: 'explorer', parent_node: folderToken, size: blob.size })
      }).then(r => r.json());
      if (!full || full.code !== 0) throw new Error(`预上传失败: ${(full && full.msg) || '无响应'}`);
      const prep = full.data;
      return {
        uploadId: String(prep.upload_id),
        blockSize: prep.block_size || 4194304,
        blockNum: prep.block_num || Math.ceil(blob.size / (prep.block_size || 4194304))
      };
    };
    for (let session = 0; session < 2; session++) {
      const { uploadId, blockSize, blockNum } = await doPrepare();
      let expired = false;
      for (let seq = 0; seq < blockNum; seq++) {
        const chunk = blob.slice(seq * blockSize, Math.min((seq + 1) * blockSize, blob.size));
        const u8 = new Uint8Array(await chunk.arrayBuffer());
        const checksum = _adler32(u8);
        let ok = false, lastErr = null;
        for (let attempt = 0; attempt < 3 && !ok; attempt++) {
          try {
            await _qpsGate();
            const res = await _uploadPartOnce(token, uploadId, seq, u8, checksum);
            if (res && res.code === 0) ok = true;
            else if (res && res.code === 1061021) { expired = true; break; }
            else if (res && res.code === 1061045) lastErr = new Error('频控可重试');
            else lastErr = new Error('分片' + seq + '失败: ' + ((res && res.msg) || '未知'));
          } catch (e) { lastErr = e; }
          if (!ok && !expired) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
        if (expired) break;
        if (!ok) throw lastErr || new Error('分片上传失败 seq=' + seq);
        op(seq + 1, blockNum);
      }
      if (expired) {
        if (session === 0) { log('warn', '[分片]事务过期,重新预上传并重传:', safeName); continue; }
        throw new Error('分片事务两次过期,上传失败');
      }
      await _qpsGate();
      const finFull = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_finish', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ upload_id: uploadId, block_num: blockNum })
      }).then(r => r.json());
      if (!finFull || finFull.code !== 0) throw new Error(`完成上传失败: ${(finFull && finFull.msg) || '无响应'}`);
      log('success', `大文件分片上传成功(${blockNum}片)`, safeName);
      return finFull.data;
    }
    throw new Error('分片上传失败: 事务过期重传仍失败');
  }

  // ==========================================================
  // V10.12 兼容薄封装 (与demo.html历史函数同签名,实现单向收敛到上面的实现)
  // ==========================================================
  async function httpUploadFile(params) {
    const data = await _uploadAllRaw(params.token, params.folderToken, params.fileName, params.blob);
    if (data.code === 1061043) {
      log('warn', 'upload_all超限,自动升级分片上传(params)', params.fileName);
      return await httpUploadFileMultipart(params);
    }
    return data;
  }
  async function httpUploadFileMultipart(params) {
    try {
      const d = await driveUploadFileMultipart(
        params.folderToken, params.fileName, params.blob,
        params.onProgress || null
      );
      return { code: 0, msg: 'success', data: d || {} };
    } catch (e) {
      return { code: -1, msg: e.message || String(e), data: {} };
    }
  }

  /** 下载云文档文件(与js/05-sync.js一致: /drive/v1/files/{token}/download; 旧?type=file meta端点已废弃404) */
  async function driveDownloadFile(fileToken) {
    const token = await getTenantToken();
    const downloadResp = await fetch(
      `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
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
    const tableId = options?.tableId || DEFAULTS.bitableTables.VEHICLES;
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
    const tableId = options?.tableId || DEFAULTS.bitableTables.VEHICLES;
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
    const tableId = options?.tableId || DEFAULTS.bitableTables.USERS;
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
    const tableId = options?.tableId || DEFAULTS.bitableTables.USERS;
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
  // V11.0: 数据访问分层 - Bitable 优先 + JSON 兜底 + 30 天双写窗口
  // 封装在既有同步原语之上(不改既有函数签名, 向后兼容)
  // ==========================================================
  const BITABLE_TABLE_NAMES = DEFAULTS.bitableTables;

  /** 读取本地/云端 JSON 兜底源(vehicles_data.js / web JSON) */
  function _readLocalJSON(type) {
    try {
      if (type === 'users') {
        const raw = localStorage.getItem('approved_users');
        if (raw) return JSON.parse(raw);
      }
      const veh = (typeof VEHICLES !== 'undefined' ? VEHICLES : (typeof window !== 'undefined' && window.VEHICLES ? window.VEHICLES : []));
      return Array.isArray(veh) ? veh : [];
    } catch (e) { return []; }
  }

  /** 读: 优先 Bitable(增量对齐), 失败/空 → JSON 兜底, 弱网不阻塞 */
  async function dataReadAll(type, options) {
    const c = getConfig();
    if (!c.bitableAppToken) return _readLocalJSON(type);
    try {
      const syncFn = type === 'users' ? syncUsersFromBitable : syncVehiclesFromBitable;
      const result = await Promise.race([
        syncFn({ onConflict: 'newer', localVehicles: (typeof VEHICLES !== 'undefined' ? VEHICLES : []), localUsers: (typeof USERS !== 'undefined' ? USERS : []) }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Bitable 超时(' + (options?.bitableTimeoutMs || 8000) + 'ms)')), options?.bitableTimeoutMs || 8000)),
      ]);
      if (result && (result.added + result.updated) > 0) {
        return type === 'users' ? (typeof USERS !== 'undefined' ? USERS : []) : (typeof VEHICLES !== 'undefined' ? VEHICLES : []);
      }
      throw new Error('Bitable 无有效数据');
    } catch (e) {
      // 弱网/未配置 Bitable → JSON 兜底
      return _readLocalJSON(type);
    }
  }

  /** 写: Bitable 优先(串行+QPS门控) + JSON 双写(窗口内), 失败入本地重试队列 */
  async function dataWrite(type, payload, options) {
    const c = getConfig();
    const bitableOk = await (type === 'users'
      ? syncUsersToBitable([payload], { userName: options?.userName || '' })
      : syncVehiclesToBitable([payload], { userName: options?.userName || '' })
    ).then(() => true).catch((e) => { log('warn', '[dataAccess] Bitable 写入失败, 走 JSON/重试', type, e.message); return false; });
    // JSON 双写窗口: 30 天内的写入双写 JSON, 更早的记录只写 Bitable
    const windowMs = (DEFAULTS.jsonMirrorDays === Infinity ? Infinity : (DEFAULTS.jsonMirrorDays || 30) * 86400000);
    const isRecent = !payload.updatedAt || (Date.now() - Number(payload.updatedAt) <= windowMs);
    if (isRecent && bitableOk !== undefined) {
      try {
        const key = type === 'users' ? 'approved_users' : 'vehicles_data_js_mirror';
        const arr = JSON.parse(localStorage.getItem(key) || (type === 'users' ? '[]' : '[]'));
        const idx = arr.findIndex((x) => x && x.id === payload.id);
        if (idx >= 0) arr[idx] = payload; else arr.push(payload);
        localStorage.setItem(key, JSON.stringify(arr));
      } catch (e) { /* 双写失败不阻断 */ }
    }
    if (!bitableOk) {
      // 本地重试队列(下一轮 05-sync 自动补写 Bitable)
      try {
        const q = JSON.parse(localStorage.getItem('bitable_retry_queue') || '[]');
        q.push({ type, payload, ts: Date.now() });
        localStorage.setItem('bitable_retry_queue', JSON.stringify(q.slice(-100)));
      } catch (e) { /* 队列上限 100, 忽略 */ }
    }
    return bitableOk;
  }

  const DATA_ACCESS = { readAll: dataReadAll, write: dataWrite, TABLE_NAMES: BITABLE_TABLE_NAMES };

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
    // V10.12: 与 demo.html 同签名的兼容上传入口(单向收敛)
    httpUploadFile, httpUploadFileMultipart,
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
    // V11.0: 数据访问分层 + 表名常量
    BITABLE_TABLE_NAMES, DATA_ACCESS,
    // 工具
    log, vehicleToBitable, bitableToVehicle,
  };
})();

// 兼容旧代码: 若存在全局 getFeishuToken, 将其代理到 FeishuAPI
if (typeof window !== 'undefined') {
  window.FeishuAPI = FeishuAPI;
}
