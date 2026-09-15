#!/usr/bin/env node
'use strict';
/* ===========================================================
 * scripts/sync_web_data.js  —  网页端镜像生成器 (V10.18.0 重构引入)
 * -----------------------------------------------------------
 * 根因: 09-web-sync.js 采用"探测式激活"——仅当同源 web-data/meta.json
 *       存在且含 syncedAt 时才安装网页镜像覆盖(注册/播放/反馈读取)。
 *       此前仓库既无本脚本也无生成产物, 镜像永不就绪 → 网页端注册/播放
 *       整条链路静默死掉(反馈问题2 + 网页端完全无法播放的共同根因)。
 *
 * 本脚本把飞书云端数据镜像为仓库 web-data/ 下的纯静态 JSON, 由
 * GitHub Actions(sync-web-data.yml) 定时 + push 触发运行并提交, 使
 * GitHub Pages 部署的网页版自动获得可用镜像。
 *
 * 两种数据源模式:
 *   A) 本地模式(--source-dir / 环境变量 TCG_LOCAL_SOURCE_DIR):
 *      直接从本地目录读取 vehicle_sync_data.json / approved_users.json
 *      / feedback_data.json, 生成镜像。用于离线测试与一次性迁移。
 *   B) 飞书模式(默认, 需 FEISHU_APP_ID / FEISHU_APP_SECRET 环境变量):
 *      调用飞书 OpenAPI 拉取云端文件, 生成镜像。CI 使用此模式。
 *
 * ⚠️ 安全: 密钥仅来自环境变量/CI Secrets, 绝不读源码、绝不写日志、
 *   绝不出现在任何产物中。账号连接键 linkKey 由客户端用 PBKDF2(password,
 *   LINK_SALT|phone) 派生, 本脚本只透传、不重算(见 sanitizeApprovedUsers)。
 *
 * ⚠️ 隐私红线(所有镜像): web-data/ 是要发布到 GitHub Pages 的**公开静态
 *   资源**, 原始云端数据含个人可识别字段。本脚本对**每一份**镜像(反馈表 +
 *   账号表)一律执行**字段白名单**投影(默认拒绝, 而非黑名单剔除——黑名单会
 *   漏掉将来新增的敏感列), 并叠加一层敏感字段名正则兜底。
 *   - 反馈表: 详见 FEEDBACK_FIELD_ALLOWLIST / sanitizeFeedback
 *   - 账号表: 详见 APPROVED_FIELD_ALLOWLIST / sanitizeApprovedUsers
 *     (V10.19.1 P0: 明文手机号 + pbkdf2 密码哈希曾在此处公网暴露)
 * =========================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const vm = require('vm');

/* 用 https.request 而非 fetch: 沙箱代理会篡改 fetch(undici) 请求导致飞书返回
 * 1061002 params error; 裸 https.request 直连飞书正常(已验证)。 */
function _req(method, urlStr, headers, body){
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign({ 'User-Agent': 'tcg-mirror/1.0' }, headers || {})
    };
    if(data) options.headers['Content-Type'] = 'application/json';
    const r = lib.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e){ reject(new Error('JSON解析失败: ' + d.slice(0,200))); } });
    });
    r.on('error', reject);
    if(data) r.write(data);
    r.end();
  });
}
function _reqText(urlStr, headers){
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const r = lib.request({
      hostname: u.hostname, port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''), method: 'GET',
      headers: Object.assign({ 'User-Agent': 'tcg-mirror/1.0' }, headers || {})
    }, res => { let d=''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
    r.on('error', reject); r.end();
  });
}

/* ===========================================================
 * 反馈表镜像配置: 统一从 js/00-config.js 的 TCG_CONFIG 读取(单一真源)
 * -----------------------------------------------------------
 * FEEDBACK_APP_TOKEN 是多维表格 App Token(非密钥), 但同样不应散落硬编码,
 * 故与 BASE_APP_TOKEN / FEEDBACK_TABLE_ID 一起从 TCG_CONFIG 取值;
 * CI 可用环境变量覆盖(优先级: 环境变量 > TCG_CONFIG), 缺省则反馈镜像降级为空
 * (宁可少同步, 也不硬编码常量造成日后漂移)。
 * =========================================================== */
function loadTcgConfig(){
  try{
    const p = path.join(__dirname, '..', 'js', '00-config.js');
    const sandbox = { window: {} };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(p, 'utf8'), sandbox);
    return (sandbox.window && sandbox.window.TCG_CONFIG) || {};
  }catch(e){
    console.warn('[mirror] 读取 js/00-config.js 失败(反馈镜像可能降级):', e.message);
    return {};
  }
}
const TCG_CONFIG = loadTcgConfig();
const FEEDBACK_APP_TOKEN = process.env.FEISHU_BITABLE_APP_TOKEN || TCG_CONFIG.BASE_APP_TOKEN || '';
const FEEDBACK_TABLE_ID = process.env.FEISHU_FEEDBACK_TABLE_ID || TCG_CONFIG.FEEDBACK_TABLE_ID || '';

/* ===========================================================
 * 反馈镜像字段白名单(默认拒绝)
 * -----------------------------------------------------------
 * 为什么是白名单而不是黑名单: 飞书多维表格的字段可由飞书侧自动化(AI分析等)
 * 随时新增, 黑名单必然漏掉将来新增的敏感列; 白名单则"未明确允许即拒绝"。
 *
 * 允许出库的判定标准: 与"问题本身"相关且不可识别到个人。
 *   - 反馈ID : 不透明随机ID, 非个人信息; 且是 10-feedback.js 的主键
 *              (缺失时该模块会 `if (!fbId) return;` 直接跳过整条记录)
 *   - 问题板块/问题描述/状态/创建时间: 问题内容与处理进度, 非身份信息
 *
 * 明确拒绝出库(即便将来被误加进白名单也会被兜底正则拦下): 提交人姓名、
 * 联系方式、设备信息、平台、APP版本、角色, 以及任何可关联到个人的字段。
 * 注: 提交人是姓名, 在数十人的团队里 salt 哈希也可被暴力枚举还原, 因此
 *     连哈希形态也不输出。
 * =========================================================== */
const FEEDBACK_FIELD_ALLOWLIST = [
  '反馈ID',
  '问题板块',
  '问题描述',
  '状态',
  '创建时间'
];
/* 兜底拦截: 字段名命中即丢弃(与白名单形成双保险) */
const SENSITIVE_FIELD_RE = /(联系方式|设备信息|提交人|手机|电话|邮箱|邮件|微信|QQ|IMEI|设备型号|系统版本|平台|APP版本|角色|姓名|账号|IP|定位|地址)/i;

/* ===========================================================
 * 账号表镜像字段白名单(默认拒绝) —— V10.19.1 P0 隐私修复 / V10.22 P0 去盐化
 * -----------------------------------------------------------
 * 背景: approved_users 镜像此前走 buildApprovedWeb() 整包透传, 把
 *   - name  (本 App 组员 name 存的就是**明文手机号**)
 *   - password (pbkdf2 密码哈希, 可离线暴力破解还原弱口令)
 *   - phoneH(sha256(SALT+phone) 手机号哈希, 盐公开可分钟级枚举还原)
 * 一并写进了公开的 web-data/ —— 经实测 curl 线上 URL 可取到完整原文。
 *
 * 允许出库的判定标准: 网页端账号链路**必需**且不可识别到个人。
 *   - id     : 账号主键(09-web-sync.js 换设备登录重建/存活守卫/差集时用)
 *   - name   : 组员显示名(09-web-sync.js 状态传播 / 组长端列表展示);
 *              命中手机号形态时强制掩码 —— 保留可辨识性, 去掉号码本体
 *   - linkKey: 网页账号连接键 = PBKDF2(password, LINK_SALT|phone)。
 *              ⚠️ 熵来自密码: 拿不到密码就无法由公开镜像反推手机号;
 *              客户端在拿到明文密码的瞬间派生并透传, 本脚本只透传不重算。
 *   - role / status / created : 权限与审批态, 非身份信息
 *
 * 明确拒绝出库: phone(明文手机号)、password(密码哈希)、pw_ts(改密时间戳,
 * 与 password 配套的凭据仲裁字段), 以及任何未列入白名单的字段。
 * =========================================================== */
const APPROVED_FIELD_ALLOWLIST = ['id', 'name', 'linkKey', 'role', 'status', 'created'];
/* 凭据/密钥类字段兜底拦截(与白名单双保险: 即便被误加进白名单也会拦下) */
const CREDENTIAL_FIELD_RE = /(password|passwd|pwd|pw_?ts|token|secret|salt)/i;
/* 明文手机号字段兜底拦截: 必须**全字段精确匹配**(linkKey 是派生连接键,
 * 不含"phone"字样, 天然不受此正则影响)。 */
const PLAIN_PHONE_FIELD_RE = /^(phone|mobile|tel|telephone)$/i;
/* 中国大陆手机号形态: 1[3-9] + 9位, 可选 +86/86 前缀 */
const PHONE_PLAIN_RE = /(?:\+?86)?(1[3-9]\d{9})/g;

/**
 * 手机号掩码: 18570474454 → 185****4454
 * 只遮中间 4 位, 保留号段与尾号, 使组长在网页端仍能大致辨认组员。
 * @param {*} s - 原始值
 * @returns {string} 掩码后的字符串(非手机号原样返回)
 */
function maskPhoneLike(s){
  const str = String(s === undefined || s === null ? '' : s);
  if(!str) return '';
  let out = str.replace(PHONE_PLAIN_RE, (m, p1) => String(p1).slice(0, 3) + '****' + String(p1).slice(7));
  /* 兜底: 纯数字且长度≥7(基本只可能是手机号/长串账号), 整体掩码 */
  if(out === str && /^\d{7,}$/.test(str)){
    out = str.slice(0, 3) + '****' + str.slice(-2);
  }
  return out;
}

/** Bitable 字段值归一: 多选/单选等数组形态展平为字符串(与 10-feedback.js _flat 同义) */
function _flatField(v){ return Array.isArray(v) ? v.join('') : v; }

function parseArgs(argv){
  const o = { out: 'web-data', sourceDir: process.env.TCG_LOCAL_SOURCE_DIR || null, dry: false };
  for(let i=2;i<argv.length;i++){
    const a = argv[i];
    if(a==='--out') o.out = argv[++i];
    else if(a==='--source-dir') o.sourceDir = argv[++i];
    else if(a==='--dry') o.dry = true;
    else if(a==='--help'||a==='-h'){ printHelp(); process.exit(0); }
  }
  return o;
}
function printHelp(){
  console.log('Usage: node scripts/sync_web_data.js [--out web-data] [--source-dir <dir>] [--dry]');
  console.log('  --source-dir <dir>   本地模式: 从该目录读取源 JSON (vehicle_sync_data.json / approved_users.json / feedback_data.json)');
  console.log('  (无 --source-dir 则为飞书模式, 需环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET)');
}

function mkdirp(p){ fs.mkdirSync(p, { recursive: true }); }
function readJsonSafe(p){
  try{ return JSON.parse(fs.readFileSync(p, 'utf8')); }catch(e){ return null; }
}
function writeJson(outDir, name, obj){
  const f = path.join(outDir, name);
  fs.writeFileSync(f, JSON.stringify(obj, null, 2), 'utf8');
  return f;
}

/* ---------- 本地模式 ---------- */
function buildFromLocal(opt){
  const src = opt.sourceDir;
  const vehicle = readJsonSafe(path.join(src, 'vehicle_sync_data.json')) || { vehicles: [], timestamp: new Date().toISOString(), version: 'local', vehicleCount: 0 };
  const approved = readJsonSafe(path.join(src, 'approved_users.json')) || { users: [] };
  const feedback = readJsonSafe(path.join(src, 'feedback_data.json')) || { items: [] };
  return { vehicle, approved, feedback };
}

/* ---------- 飞书模式 ---------- */
const FEISHU_HOST = 'https://open.feishu.cn';
async function feishuTenantToken(appId, appSecret){
  const j = await _req('POST', `${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, { 'Content-Type': 'application/json' }, { app_id: appId, app_secret: appSecret });
  if(j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + JSON.stringify(j));
  return j.tenant_access_token;
}
async function feishuListFiles(token, folderToken){
  const out = [];
  let pageToken = '';
  do {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${encodeURIComponent(folderToken)}&page_size=50&types=folder,file${pageToken?('&page_token='+encodeURIComponent(pageToken)):''}`;
    const j = await _req('GET', url, { Authorization: 'Bearer ' + token });
    if(j.code !== 0) throw new Error('列出云盘文件失败: ' + JSON.stringify(j));
    (j.data.files || []).forEach(f => out.push(f));
    pageToken = j.data.next_page_token || '';
  } while(pageToken);
  return out;
}
async function feishuFindFile(token, folderToken, name, _depth){
  _depth = _depth || 0;
  if(_depth > 6) return null; // 防御: 不超过6层
  const files = await feishuListFiles(token, folderToken);
  let hit = null;
  const folders = [];
  for(const f of files){
    if(f.name === name || f.name === name + '.json'){ hit = f; break; }
    if(f.type === 'folder') folders.push(f.token);
  }
  if(hit) return hit;
  for(const ft of folders){
    const r = await feishuFindFile(token, ft, name, _depth + 1);
    if(r) return r;
  }
  return null;
}
async function feishuDownloadJson(token, folderToken, name){
  const hit = await feishuFindFile(token, folderToken, name);
  if(!hit) return null;
  const j = await _req('GET', `${FEISHU_HOST}/open-apis/drive/v1/files/${hit.token}/download`, { Authorization: 'Bearer ' + token });
  // 情况A: 返回下载信息信封 {code,data:{url}} → 抓取真实文件
  if(j && j.data && j.data.url){
    const text = await _reqText(j.data.url);
    return JSON.parse(text);
  }
  // 情况B(常见): 响应体即文件原始内容(飞书对文件类直接返回字节/文本)
  return j;
}
/**
 * 反馈表分页拉取(bitable)—— page_token 循环取全量
 * 为什么要循环: 飞书单页上限 500 条, 反馈记录超一页后只取首页会永远丢掉
 * 更早的记录(与 feishu-api.js bitableListRecords 的 V10.16.7 修复同因)。
 * @param {string} token - tenant_access_token
 * @param {string} appToken - 多维表格 App Token
 * @param {string} tableId - 反馈表 Table ID
 * @returns {Promise<Array<{record_id:string,fields:Object}>>}
 */
async function feishuListBitableRecords(token, appToken, tableId){
  const out = [];
  let pageToken = '';
  for(let i = 0; i < 20; i++){ // 上限20页(单页200, 共4000条防御性封顶)
    let url = `${FEISHU_HOST}/open-apis/bitable/v1/apps/${encodeURIComponent(appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=200`;
    if(pageToken) url += '&page_token=' + encodeURIComponent(pageToken);
    const j = await _req('GET', url, { Authorization: 'Bearer ' + token });
    if(!j || j.code !== 0) throw new Error('拉取反馈表记录失败: ' + JSON.stringify(j).slice(0, 200));
    const d = j.data || {};
    (d.items || []).forEach(it => out.push(it));
    if(!d.has_more || !d.page_token) break;
    pageToken = d.page_token;
  }
  return out;
}

/**
 * 反馈镜像脱敏: 按字段白名单投影, 默认拒绝
 * 输出侧统一调用(飞书模式与本地模式都走这里), 保证任何来源都不会把
 * 联系方式/设备信息/提交人等个人可识别字段写进公开的 web-data/。
 * @param {Object} raw - 原始反馈数据 { items: [{record_id, fields}] }
 * @returns {{items:Array, timestamp:string, sanitized:boolean, fieldAllowlist:string[], droppedFields:string[]}}
 */
function sanitizeFeedback(raw){
  const items = (raw && Array.isArray(raw.items)) ? raw.items : [];
  const dropped = [];
  const droppedSet = new Set();
  const out = [];
  for(const it of items){
    if(!it) continue;
    const fields = (it && it.fields) ? it.fields : {};
    const clean = {};
    for(const k of FEEDBACK_FIELD_ALLOWLIST){
      // 白名单字段仍过一遍敏感名兜底(防止有人往白名单里误加敏感列)
      if(SENSITIVE_FIELD_RE.test(k)) continue;
      if(fields[k] === undefined || fields[k] === null) continue;
      clean[k] = _flatField(fields[k]);
    }
    for(const k of Object.keys(fields)){
      if(FEEDBACK_FIELD_ALLOWLIST.indexOf(k) === -1 || SENSITIVE_FIELD_RE.test(k)){
        if(!droppedSet.has(k)){ droppedSet.add(k); dropped.push(k); }
      }
    }
    const o = { fields: clean };
    if(it.record_id) o.record_id = it.record_id;   // 主键, 供状态审核定位(非个人信息)
    if(it.created_time) o.created_time = it.created_time; // 记录级时间戳(非个人信息)
    out.push(o);
  }
  if(dropped.length){
    console.log('[mirror] 反馈镜像已按白名单剔除敏感字段:', dropped.join(', '));
  }
  return {
    items: out,
    timestamp: new Date().toISOString(),
    sanitized: true,
    fieldAllowlist: FEEDBACK_FIELD_ALLOWLIST.slice(),
    droppedFields: dropped
  };
}

async function buildFromFeishu(opt){
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const folderToken = process.env.FEISHU_FOLDER_TOKEN || 'nodcnGA95g93RhIUSdCeTkhKlQc';
  if(!appId || !appSecret) throw new Error('飞书模式需要环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
  const token = await feishuTenantToken(appId, appSecret);
  const vehicle = await feishuDownloadJson(token, folderToken, 'vehicle_sync_data.json') || { vehicles: [], timestamp: new Date().toISOString(), version: 'feishu', vehicleCount: 0 };
  const approved = await feishuDownloadJson(token, folderToken, 'approved_users.json') || { users: [] };
  /* 反馈表: 优先从多维表格分页拉取(单一真源 = 安卓端写入的那张表)。
   * 旧实现从云盘整包下载 feedback_data.json, 那是全字段透传, 一旦有真实
   * 数据就会把联系方式/设备信息一起带进公开的 web-data/ —— 已废弃。
   * 注意: 无论走哪条来源, 出库前都会过 sanitizeFeedback 白名单(见 main)。 */
  let feedback = { items: [] };
  try {
    if(!FEEDBACK_APP_TOKEN || !FEEDBACK_TABLE_ID){
      console.warn('[mirror] 反馈表 AppToken/TableId 未配置(检查 js/00-config.js 的 BASE_APP_TOKEN / FEEDBACK_TABLE_ID), 反馈镜像降级为空');
    }else{
      const recs = await feishuListBitableRecords(token, FEEDBACK_APP_TOKEN, FEEDBACK_TABLE_ID);
      feedback = { items: recs };
      console.log(`[mirror] 反馈表(bitable)分页拉取完成: ${recs.length} 条`);
    }
  } catch(e){ console.warn('[mirror] 反馈表拉取失败(降级为空):', e.message); }
  return { vehicle, approved, feedback };
}

/* ---------- 转换: 账号表脱敏 ---------- */
/**
 * 账号镜像脱敏: 按字段白名单投影, 默认拒绝
 * 输出侧统一调用(飞书模式与本地模式都走这里), 保证任何来源都不会把明文
 * 手机号 / 密码哈希 / 凭据仲裁字段写进公开的 web-data/。
 *
 * 与旧 buildApprovedWeb 的区别(后者已删除——正是它把 password 整包透传):
 *   - 字段白名单投影, 未列入即丢弃(旧版是显式列全字段, 新增字段自动透传)
 *   - name 命中手机号形态 → 掩码(旧版原样输出)
 *   - password / pw_ts 不再输出(旧版原样输出)
 *   - linkKey 只接受 64 位十六进制形态(旧版 phoneH 同款防御, 且不再由 phone 补算)
 *
 * @param {Array<Object>|Object} raw - 原始账号数组或 {users:[...]}
 * @returns {{users:Array, timestamp:string, sanitized:boolean, fieldAllowlist:string[], droppedFields:string[]}}
 */
function sanitizeApprovedUsers(raw){
  const src = Array.isArray(raw) ? raw : ((raw && Array.isArray(raw.users)) ? raw.users : []);
  const dropped = [];
  const droppedSet = new Set();
  const users = [];
  for(const u of src){
    if(!u || typeof u !== 'object') continue;
    const clean = {};
    for(const k of APPROVED_FIELD_ALLOWLIST){
      // 白名单字段仍过一遍敏感名/凭据名兜底(防止有人往白名单里误加敏感列)
      if(SENSITIVE_FIELD_RE.test(k) || CREDENTIAL_FIELD_RE.test(k) || PLAIN_PHONE_FIELD_RE.test(k)) continue;
      let v = u[k];
      if(v === undefined || v === null) continue;
      if(k === 'name') v = maskPhoneLike(v);
      if(k === 'linkKey'){
        // 只接受 PBKDF2 派生 64 位 hex 形态; 其它值一律不输出
        v = /^[0-9a-f]{64}$/i.test(String(v)) ? String(v).toLowerCase() : '';
        if(!v) continue; // 存量账号无 linkKey / 非法形态: 不输出该字段
      }
      clean[k] = v;
    }
    for(const k of Object.keys(u)){
      if(APPROVED_FIELD_ALLOWLIST.indexOf(k) === -1 || SENSITIVE_FIELD_RE.test(k) || CREDENTIAL_FIELD_RE.test(k) || PLAIN_PHONE_FIELD_RE.test(k)){
        if(!droppedSet.has(k)){ droppedSet.add(k); dropped.push(k); }
      }
    }
    users.push(clean);
  }
  if(dropped.length){
    console.log('[mirror] 账号镜像已按白名单剔除敏感字段:', dropped.join(', '));
  }
  return {
    users,
    timestamp: new Date().toISOString(),
    sanitized: true,
    fieldAllowlist: APPROVED_FIELD_ALLOWLIST.slice(),
    droppedFields: dropped
  };
}

/* ---------- 主流程 ---------- */
async function main(){
  const opt = parseArgs(process.argv);
  const isLocal = !!opt.sourceDir;
  console.log(`[mirror] 模式: ${isLocal ? '本地('+opt.sourceDir+')' : '飞书'} · 输出: ${opt.out}`);

  const { vehicle, approved, feedback: rawFeedback } = isLocal ? buildFromLocal(opt) : await buildFromFeishu(opt);

  /* 反馈脱敏(输出侧白名单投影): 本地模式与飞书模式一视同仁。
   * 放在出库前而不是拉取后, 是为了杜绝"换个数据源就绕过脱敏"的漏网路径。 */
  const feedback = sanitizeFeedback(rawFeedback);

  /* 账号脱敏(输出侧白名单投影): 本地模式与飞书模式一视同仁。
   * 与反馈镜像同构——放在出库前而不是拉取后, 杜绝"换个数据源就绕过脱敏"。
   * V10.19.1 P0: 旧 buildApprovedWeb 把 name(明文手机号)/password(pbkdf2
   * 哈希)/phoneH 整包透传进公开的 web-data/, 已实测可 curl 取到原文。 */
  const approvedWeb = sanitizeApprovedUsers(approved.users || []);

  // 数据更新通知(网页端 60s 轮询据此自动镜像对齐)
  const notice = {
    timestamp: vehicle.timestamp || new Date().toISOString(),
    version: vehicle.version || 'mirror'
  };

  const meta = {
    syncedAt: new Date().toISOString(),     // 09-web-sync.js 探测激活的充要条件
    generatedAt: new Date().toISOString(),
    source: isLocal ? 'local' : 'feishu',
    /* P0 脱敏: 连接键已改 linkKey=PBKDF2(password, LINK_SALT|phone),
     * 熵来自密码, 无需也不输出任何盐值——盐(LINK_SALT)公开无妨。 */
    version: vehicle.version || 'mirror',
    counts: {
      vehicles: (vehicle.vehicles || []).length,
      users: approvedWeb.users.length,
      feedback: (feedback.items || []).length
    }
  };

  if(opt.dry){
    console.log('[mirror] --dry 模式, 不写入文件。产物预览:');
    console.log('  vehicle_sync_data.json:', (vehicle.vehicles||[]).length, '条车型');
    console.log('  approved_users.web.json:', approvedWeb.users.length, '条账号(已按白名单脱敏)');
    console.log('  账号白名单字段:', (approvedWeb.fieldAllowlist||[]).join(', '));
    console.log('  账号被剔除字段:', (approvedWeb.droppedFields||[]).join(', ') || '(无)');
    console.log('  feedback_data.json:', (feedback.items||[]).length, '条反馈(已按白名单脱敏)');
    console.log('  反馈白名单字段:', (feedback.fieldAllowlist||[]).join(', '));
    console.log('  反馈被剔除字段:', (feedback.droppedFields||[]).join(', ') || '(无)');
    console.log('  meta.json.syncedAt:', meta.syncedAt);
    return;
  }

  mkdirp(opt.out);
  writeJson(opt.out, 'vehicle_sync_data.json', vehicle);
  writeJson(opt.out, 'approved_users.web.json', approvedWeb);
  writeJson(opt.out, 'feedback_data.json', feedback);
  writeJson(opt.out, 'data_update_notice.json', notice);
  writeJson(opt.out, 'meta.json', meta);
  console.log(`[mirror] 已生成 web-data/ 镜像: 车型${(vehicle.vehicles||[]).length} / 账号${approvedWeb.users.length} / 反馈${(feedback.items||[]).length}`);
  console.log(`[mirror] meta.syncedAt=${meta.syncedAt} (网页层将据此激活)`);
}

main().catch(e => { console.error('[mirror] 失败:', e.message); process.exit(1); });
