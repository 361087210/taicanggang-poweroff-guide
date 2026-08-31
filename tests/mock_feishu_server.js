/**
 * ============================================================
 * mock_feishu_server.js - 飞书开放平台云空间API高保真模拟器
 * V10.10.0 真机模拟测试基建
 * ============================================================
 * 忠实复现官方行为(与官方文档逐条对齐):
 *  - POST /auth/v3/tenant_access_token/internal      → tenant_access_token
 *  - POST /drive/v1/files/create_folder              → 建目录
 *  - GET  /drive/v1/files/:token/children            → 列目录
 *  - POST /drive/v1/files/upload_all                 → 全量上传, >20MB拒绝(1061043)
 *  - POST /drive/v1/files/upload_prepare             → 分片预上传(4MB定长分片)
 *  - POST /drive/v1/files/upload_part                → 分片上传(校验seq/size/Adler-32)
 *  - POST /drive/v1/files/upload_finish              → 完成上传落盘
 *  - GET  /drive/v1/files/:token/download            → 下载原始字节
 *  - DELETE /drive/v1/files/:token?type=file         → 删除文件
 *  - GET  /drive/v1/files?folder_token=xxx             → 列目录(应用feishuListFiles真实调用形态)
 * 错误码语义: 1061043超限 / 1061044父节点不存在 / 1061021事务过期 /
 *            1062008校验和错误 / 1062009尺寸不符 / 1062010分片缺失
 * 可注入故障(弱网模拟):
 *   opts.failPartOnce=true   每片首次请求强制500(验证客户端分片重试)
 *   opts.expireFirstSession  首个upload_id的分片全部返回1061021事务过期
 *                            (验证客户端重新prepare整段重传兜底)
 */
'use strict';

const UPLOAD_ALL_LIMIT = 20 * 1024 * 1024; // 官方20MB硬上限
const BLOCK_SIZE = 4 * 1024 * 1024;        // 官方固定4MB分片

function adler32(u8) {
  const MOD = 65521; let a = 1, b = 0;
  for (let i = 0; i < u8.length; i++) { a = (a + u8[i]) % MOD; b = (b + a) % MOD; }
  return String((((b << 16) | a) >>> 0));
}

/** 从 FormData(jsdom或原生) 提取字段值与文件Blob */
function formGet(fd, key) { return fd.get(key); }

class MockFeishuServer {
  constructor(opts = {}) {
    this.opts = opts;
    this.reset();
  }

  reset() {
    this.folders = new Map();   // token -> {name, parent, children:Set<token>}
    this.files = new Map();     // token -> {name, parent, buffer:Uint8Array}
    this.uploads = new Map();   // upload_id -> {fileName, parent, size, blockSize, blockNum, parts:Map<seq,Uint8Array>, finished}
    this.stats = { uploadAll: 0, uploadAllRejected: 0, prepare: 0, part: 0, partFailed: 0, finish: 0, download: 0, list: 0 };
    this._seq = 0;
    // 根目录
    this.ROOT = 'mockroot0001';
    this.folders.set(this.ROOT, { name: 'ROOT', parent: null, children: new Set() });
  }

  _newToken(prefix) { return prefix + (++this._seq).toString(36) + Math.random().toString(36).slice(2, 8); }

  /** 统一入口: method/url/headers/body(string|FormData) → {status, json?, buffer?} */
  async handle(method, url, headers, body) {
    const u = new URL(url, 'https://open.feishu.cn');
    const p = u.pathname;

    // ---- 认证(本身不需要Bearer) ----
    if (p === '/open-apis/auth/v3/tenant_access_token/internal') {
      const req = typeof body === 'string' ? JSON.parse(body) : (body || {});
      if (!req.app_id || !req.app_secret) return { status: 400, json: { code: 10014, msg: 'app_id or app_secret is invalid' } };
      return { status: 200, json: { code: 0, msg: 'ok', tenant_access_token: 't-mock' + Date.now(), expire: 7200 } };
    }

    const auth = (headers && (headers.Authorization || headers.authorization)) || '';
    if (!/^Bearer\s+t-/.test(auth)) return { status: 401, json: { code: 99991663, msg: 'token invalid' } };

    // ---- 建目录 ----
    if (p === '/open-apis/drive/v1/files/create_folder') {
      const req = typeof body === 'string' ? JSON.parse(body) : body;
      const parent = req.folder_token;
      if (!this.folders.has(parent)) return { status: 400, json: { code: 1061044, msg: 'parent node not exist.' } };
      // 幂等: 同名子目录直接返回
      for (const tk of this.folders.get(parent).children) {
        const f = this.folders.get(tk);
        if (f && f.name === req.name) return { status: 200, json: { code: 0, msg: 'success', data: { token: tk, url: 'mock://' + tk } } };
      }
      const token = this._newToken('fld');
      this.folders.set(token, { name: req.name, parent, children: new Set(), modifiedTime: Date.now() });
      this.folders.get(parent).children.add(token);
      return { status: 200, json: { code: 0, msg: 'success', data: { token, url: 'mock://' + token } } };
    }

    // ---- 列目录 ----
    const childMatch = p.match(/^\/open-apis\/drive\/v1\/files\/([^/]+)\/children$/);
    if (childMatch && method === 'GET') {
      this.stats.list++;
      const folder = this.folders.get(childMatch[1]);
      if (!folder) return { status: 400, json: { code: 1061044, msg: 'parent node not exist.' } };
      const files = [];
      for (const tk of folder.children) {
        const f = this.folders.get(tk);
        if (f) { files.push({ token: tk, name: f.name, type: 'folder' }); continue; }
        const fl = this.files.get(tk);
        if (fl) files.push({ token: tk, name: fl.name, type: 'file', size: fl.buffer.length });
      }
      return { status: 200, json: { code: 0, msg: 'success', data: { files, has_more: false } } };
    }

    // ---- 列目录(应用feishuListFiles真实调用形态: ?folder_token=xxx&page_size=200) ----
    if (p === '/open-apis/drive/v1/files' && method === 'GET') {
      this.stats.list++;
      const ft = u.searchParams.get('folder_token');
      const folder = this.folders.get(ft);
      if (!folder) return { status: 400, json: { code: 1061044, msg: 'parent node not exist.' } };
      const files = [];
      for (const tk of folder.children) {
        const f = this.folders.get(tk);
        if (f) { files.push({ token: tk, name: f.name, type: 'folder', modified_time: String(f.modifiedTime || 0) }); continue; }
        const fl = this.files.get(tk);
        if (fl) files.push({ token: tk, name: fl.name, type: 'file', size: fl.buffer.length, modified_time: String(fl.modifiedTime || 0) });
      }
      return { status: 200, json: { code: 0, msg: 'success', data: { files, has_more: false, next_page_token: '' } } };
    }

    // ---- 全量上传(20MB硬上限) ----
    if (p === '/open-apis/drive/v1/files/upload_all') {
      this.stats.uploadAll++;
      const fileName = String(formGet(body, 'file_name') || '');
      const parent = String(formGet(body, 'parent_node') || '');
      const size = parseInt(formGet(body, 'size') || '0', 10);
      const file = formGet(body, 'file'); // Blob
      if (!this.folders.has(parent)) return { status: 400, json: { code: 1061044, msg: 'parent node not exist.' } };
      if (!file || size <= 0) return { status: 400, json: { code: 1061002, msg: 'params error.' } };
      if (size > UPLOAD_ALL_LIMIT || file.size > UPLOAD_ALL_LIMIT) {
        this.stats.uploadAllRejected++;
        return { status: 400, json: { code: 1061043, msg: 'file size beyond limit.' } };
      }
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length !== size) return { status: 400, json: { code: 1062009, msg: 'the actual size is inconsistent with the parameter declaration size.' } };
      const token = this._saveFile(parent, fileName, buf);
      return { status: 200, json: { code: 0, msg: 'success', data: { file_token: token } } };
    }

    // ---- 分片预上传 ----
    if (p === '/open-apis/drive/v1/files/upload_prepare') {
      this.stats.prepare++;
      const req = typeof body === 'string' ? JSON.parse(body) : body;
      if (!req.file_name || req.parent_type !== 'explorer' || !req.parent_node || !(req.size > 0)) {
        return { status: 400, json: { code: 1061002, msg: 'params error.' } };
      }
      if (!this.folders.has(req.parent_node)) return { status: 400, json: { code: 1061044, msg: 'parent node not exist.' } };
      const uploadId = 'up' + Date.now().toString(36) + (++this._seq);
      const blockNum = Math.ceil(req.size / BLOCK_SIZE);
      this.uploads.set(uploadId, { fileName: req.file_name, parent: req.parent_node, size: req.size, blockSize: BLOCK_SIZE, blockNum, parts: new Map(), createdAt: Date.now(), finished: false });
      return { status: 200, json: { code: 0, msg: 'success', data: { upload_id: uploadId, block_size: BLOCK_SIZE, block_num: blockNum } } };
    }

    // ---- 分片上传 ----
    if (p === '/open-apis/drive/v1/files/upload_part') {
      this.stats.part++;
      const uploadId = String(formGet(body, 'upload_id') || '');
      const seq = parseInt(formGet(body, 'seq') || '0', 10);
      const size = parseInt(formGet(body, 'size') || '0', 10);
      const checksum = String(formGet(body, 'checksum') || '');
      const file = formGet(body, 'file');
      const up = this.uploads.get(uploadId);
      if (!up || up.finished) return { status: 400, json: { code: 1061021, msg: 'upload id expire.' } };
      // 故障注入: 首个上传会话整体判定为事务过期(验证客户端重新prepare整段重传)
      if (this.opts.expireFirstSession) {
        if (!this._expiredSessions) this._expiredSessions = new Set();
        if (!this._firstSessionMarked) { this._firstSessionMarked = true; this._expiredSessions.add(uploadId); }
        if (this._expiredSessions.has(uploadId)) {
          this.stats.partFailed++;
          return { status: 400, json: { code: 1061021, msg: 'upload id expire.' } };
        }
      }
      // 弱网故障注入: 每片首次请求强制失败(验证客户端重试)
      if (this.opts.failPartOnce) {
        const key = uploadId + ':' + seq;
        if (!this._failOnceSeen) this._failOnceSeen = new Set();
        if (!this._failOnceSeen.has(key)) {
          this._failOnceSeen.add(key);
          this.stats.partFailed++;
          return { status: 500, json: { code: 1061001, msg: 'internal error.' } };
        }
      }
      if (!file) return { status: 400, json: { code: 1061002, msg: 'params error.' } };
      const buf = new Uint8Array(await file.arrayBuffer());
      if (buf.length !== size) return { status: 400, json: { code: 1062009, msg: 'the actual size is inconsistent with the parameter declaration size.' } };
      if (checksum && adler32(buf) !== checksum) return { status: 400, json: { code: 1062008, msg: 'checksum param Invalid.' } };
      if (seq < 0 || seq >= up.blockNum) return { status: 400, json: { code: 1062011, msg: 'block num out of bounds.' } };
      up.parts.set(seq, buf);
      return { status: 200, json: { code: 0, msg: 'success', data: {} } };
    }

    // ---- 完成上传 ----
    if (p === '/open-apis/drive/v1/files/upload_finish') {
      this.stats.finish++;
      const req = typeof body === 'string' ? JSON.parse(body) : body;
      const up = this.uploads.get(String(req.upload_id));
      if (!up) return { status: 400, json: { code: 1061021, msg: 'upload id expire.' } };
      if (parseInt(req.block_num, 10) !== up.blockNum) return { status: 400, json: { code: 1061002, msg: 'params error.' } };
      for (let i = 0; i < up.blockNum; i++) {
        if (!up.parts.has(i)) return { status: 400, json: { code: 1062010, msg: 'block missing, please upload all blocks.' } };
      }
      let total = 0; up.parts.forEach(b => total += b.length);
      const merged = new Uint8Array(total);
      let off = 0;
      for (let i = 0; i < up.blockNum; i++) { merged.set(up.parts.get(i), off); off += up.parts.get(i).length; }
      if (merged.length !== up.size) return { status: 400, json: { code: 1062009, msg: 'the actual size is inconsistent with the parameter declaration size.' } };
      up.finished = true;
      const token = this._saveFile(up.parent, up.fileName, merged);
      return { status: 200, json: { code: 0, msg: 'Success', data: { file_token: token } } };
    }

    // ---- 下载 ----
    const dlMatch = p.match(/^\/open-apis\/drive\/v1\/files\/([^/]+)\/download$/);
    if (dlMatch && method === 'GET') {
      this.stats.download++;
      const f = this.files.get(dlMatch[1]);
      if (!f) return { status: 404, json: { code: 1061003, msg: 'not found.' } };
      return { status: 200, buffer: f.buffer, contentType: 'application/octet-stream' };
    }

    // ---- 删除 ----
    const delMatch = p.match(/^\/open-apis\/drive\/v1\/files\/([^/]+)$/);
    if (delMatch && method === 'DELETE') {
      const tk = delMatch[1];
      const f = this.files.get(tk);
      if (!f) return { status: 404, json: { code: 1061003, msg: 'not found.' } };
      this.files.delete(tk);
      const parent = this.folders.get(f.parent);
      if (parent) parent.children.delete(tk);
      return { status: 200, json: { code: 0, msg: 'success' } };
    }

    return { status: 404, json: { code: 404, msg: 'mock: unknown endpoint ' + p } };
  }

  /** 同名覆盖语义与飞书一致: 同目录下同名文件覆盖 */
  _saveFile(parent, name, buffer) {
    const folder = this.folders.get(parent);
    for (const tk of folder.children) {
      const f = this.files.get(tk);
      if (f && f.name === name) { f.buffer = buffer; f.modifiedTime = Date.now(); return tk; }
    }
    const token = this._newToken('file');
    this.files.set(token, { name, parent, buffer, modifiedTime: Date.now() });
    folder.children.add(token);
    return token;
  }

  // ---------- 测试辅助 ----------
  /** 按路径查找文件: 'APP数据备份/vehicle_videos/xxx.mp4' */
  findFile(pathStr) {
    const segs = pathStr.split('/').filter(Boolean);
    let cur = this.ROOT;
    for (let i = 0; i < segs.length; i++) {
      const folder = this.folders.get(cur);
      if (!folder) return null;
      let next = null;
      for (const tk of folder.children) {
        const f = this.folders.get(tk);
        if (f && f.name === segs[i] && i < segs.length - 1) { next = tk; break; }
        const fl = this.files.get(tk);
        if (fl && fl.name === segs[i] && i === segs.length - 1) return { token: tk, ...fl };
      }
      if (next === null) return null;
      cur = next;
    }
    return null;
  }
  listFolder(pathStr) {
    const segs = pathStr.split('/').filter(Boolean);
    let cur = this.ROOT;
    for (const s of segs) {
      const folder = this.folders.get(cur);
      if (!folder) return [];
      let next = null;
      for (const tk of folder.children) {
        const f = this.folders.get(tk);
        if (f && f.name === s) { next = tk; break; }
      }
      if (!next) return [];
      cur = next;
    }
    const folder = this.folders.get(cur);
    const out = [];
    for (const tk of folder.children) {
      const f = this.folders.get(tk);
      if (f) { out.push({ name: f.name, type: 'folder' }); continue; }
      const fl = this.files.get(tk);
      if (fl) out.push({ name: fl.name, type: 'file', size: fl.buffer.length });
    }
    return out;
  }
}

module.exports = { MockFeishuServer, adler32, UPLOAD_ALL_LIMIT, BLOCK_SIZE };
