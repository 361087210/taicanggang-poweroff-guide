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
/* 收流: **整段拼完再解码**, 绝不逐块 toString()。
 * 为什么: res.on('data', c => d += c) 里的 c 是 Buffer, `+=` 会**逐块**调用 toString();
 *   一个 3 字节的中文字符若正好被 TCP 分块切开, 两半各自变成 U+FFFD 替换符 ——
 *   于是同一份云端文件, 每次运行"坏几处、坏在哪"都不一样(CI 那轮 2 处, 本地 3 处;
 *   而同一时刻用 python 整段读取是 0 处)。
 *   这就是历史上"自动同步把数据写坏"的根因: 不是飞书的数据坏了, 是我们在解码时切碎了它。
 * @param {import('http').IncomingMessage} res
 * @returns {Promise<string>}
 */
function _collectText(res){
  return new Promise((resolve, reject) => {
    const chunks = [];
    res.on('data', c => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    res.on('error', reject);
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}
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
      _collectText(res).then(d => {
        try { resolve(JSON.parse(d)); }
        catch(e){ reject(new Error('JSON解析失败: ' + d.slice(0,200))); }
      }, reject);
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
    }, res => { _collectText(res).then(resolve, reject); });
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
 * 账号表镜像字段白名单(默认拒绝) —— V10.19.1 P0 隐私修复 / V10.19.2 P0 去盐化(phoneH→linkKey)
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
 *              命中手机号形态时强制掩码; 本次加固起真实姓名(2-4 个汉字)同样
 *              掩码为"姓氏+"**"", 防止真实姓名随公开镜像外泄(角色标签白名单除外)
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

/* 角色标签白名单: 这些不是个人姓名, 掩码后会丢失业务语义, 原样保留 */
const NAME_LABEL_ALLOWLIST = ['组长', '管理员', '组员', '跨网络组员', '测试', '测试员'];

/**
 * 姓名脱敏: 手机号形态走 maskPhoneLike; 2-4 个汉字的真实姓名保留姓氏首字,
 * 其余字符掩码为 *(成佃亚 → 成**)。角色标签(组长/组员等)原样保留。
 * 背景: web-data/ 发布在公开 GitHub Pages, 真实姓名属个人信息, 不应出库。
 * @param {*} s - 原始显示名
 * @returns {string} 脱敏后的显示名
 */
function maskPersonName(s){
  const str = maskPhoneLike(s);
  if(!str) return '';
  if(NAME_LABEL_ALLOWLIST.indexOf(str) !== -1) return str;
  if(/^[\u4e00-\u9fa5]{2,4}$/.test(str)) return str.charAt(0) + '*'.repeat(str.length - 1);
  return str;
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
/* 幂等写盘: 内容与已有文件逐字节一致则不写, 返回是否真的发生变化。
 * 目的: cron 每 15 分钟跑一次, 数据没变就不该产生提交 ——
 *   否则每轮都换 SHA, 连带 CI/CodeQL/Pages 全部重跑。 */
function writeJson(outDir, name, obj){
  const f = path.join(outDir, name);
  const text = JSON.stringify(obj, null, 2);
  /* V10.25.5 fail-fast: 云盘同步可能带进损坏字符(U+FFFD 替换符)。
   * 历史上是"照样写盘", 于是坏数据进了产物与仓库, 只能靠事后测试发现
   * (2026-11-09 20:10 那次同步就写坏了 3 处)。这里拒绝落盘并报出位置。 */
  const bad = text.match(/[^\n]*\uFFFD[^\n]*/g) || [];
  if (bad.length) {
    console.error(`[sync-web-data] ❌ ${name} 含 ${bad.length} 处 U+FFFD, 拒绝写盘:`);
    bad.slice(0, 3).forEach(l => console.error('   ' + l.trim().slice(0, 140)));
    console.error('[sync-web-data] 请检查飞书源数据编码; 修好后重跑, 不要带着坏数据提交。');
    process.exitCode = 1;
    throw new Error('镜像含编码损坏, 已中止写盘');
  }
  let prevText = null;
  try{ prevText = fs.readFileSync(f, 'utf8'); }catch(e){ /* 首次生成 */ }
  if (prevText === text) return false;
  fs.writeFileSync(f, text, 'utf8');
  return true;
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
/* 诊断用: 记录本次**实际取到**的源文件(名字 → 飞书文件元信息)。
 * 熔断失败时把它打出来, 日志才能自解释"到底是没找到, 还是取到了陈旧副本"。 */
const LAST_FOUND = {};
function _fmtTime(v){
  if(v === null || v === undefined || v === '') return '?';
  let n = Number(v);
  if(!Number.isFinite(n) || n <= 0) return '?';
  /* 飞书的 modified_time 是**秒**级时间戳(且常以字符串返回), 之前按毫秒解释
   * 会打印成 1970-01-21 —— 诊断信息本身不能是错的。 */
  if(n < 1e12) n *= 1000;
  try { return new Date(n).toISOString(); } catch(e){ return String(v); }
}
/**
 * 熔断退出: 统一打 GitHub Actions 错误注解(::error::) + 自解释诊断, 再非零退出。
 * 为什么需要: 熔断原先只打普通日志, cron 从 2026-11-09 起连续红了两周也没人发现
 *   —— 日志里的静默失败等于没失败。::error:: 让 Actions 把失败原因高亮进 run 摘要,
 *   配合 `.github/workflows/sync-web-data.yml` 的失败开 issue。
 * @param {string} reason - 熔断结论(与人读的原文案保持一致)
 * @param {Object|null} prevMirror - 已有产物(web-data/vehicle_sync_data.json)
 * @param {Object|null} vehicle - 本次拉到的源数据
 * @param {string} [hint] - 处置建议
 */
function _abortGuard(reason, prevMirror, vehicle, hint){
  const src = LAST_FOUND['vehicle_sync_data.json'];
  const prevCount = (prevMirror && Array.isArray(prevMirror.vehicles)) ? prevMirror.vehicles.length : 0;
  const newCount = (vehicle && Array.isArray(vehicle.vehicles)) ? vehicle.vehicles.length : 0;
  console.error('::error::[mirror] ' + reason);
  console.error('[mirror] 诊断:');
  console.error('  本次取到的源文件: ' + (src ? (src.name + ' token=' + src.token + ' 修改时间=' + _fmtTime(src.modified_time)) : '未找到 vehicle_sync_data.json'));
  console.error('  本次镜像: ' + newCount + ' 车 · 数据版本=' + ((vehicle && vehicle.version) || '?'));
  console.error('  已有镜像: ' + prevCount + ' 车 · syncedAt=' + ((prevMirror && prevMirror.syncedAt) || '?') + ' · 数据版本=' + ((prevMirror && prevMirror.version) || '?'));
  if(hint) console.error('  ' + hint);
  process.exit(1);
}
async function feishuTenantToken(appId, appSecret){
  const j = await _req('POST', `${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`, { 'Content-Type': 'application/json' }, { app_id: appId, app_secret: appSecret });
  if(j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + JSON.stringify(j));
  return j.tenant_access_token;
}
async function feishuListFiles(token, folderToken){
  const out = [];
  let pageToken = '';
  do {
    // P1#1 修复: 不传 types(拿全类型)——原 `types=folder,file` 会漏掉飞书原生
    // sheet/docx/bitable 等类型文件; 下游 feishuFindFile 按 name 精确匹配 + 仅递归
    // folder, 对新类型安全跳过, 不崩溃。
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${encodeURIComponent(folderToken)}&page_size=50${pageToken?('&page_token='+encodeURIComponent(pageToken)):''}`;
    const j = await _req('GET', url, { Authorization: 'Bearer ' + token });
    if(j.code !== 0) throw new Error('列出云盘文件失败: ' + JSON.stringify(j));
    (j.data.files || []).forEach(f => out.push(f));
    pageToken = j.data.next_page_token || '';
  } while(pageToken);
  return out;
}
/**
 * 同名多份时取"最新的一份"(modified_time 最大)。
 *
 * 为什么必须这样(2026-10-06 实测事故):
 *   飞书 APP数据备份/同步数据/ 里同名 vehicle_sync_data.json 确实有**两份且内容不同**:
 *     副本1 token=RHivbUPi… 98,347B / 100 车 / 数据时间戳 2026-10-03
 *     副本2 token=B1Drbg1b… 77,765B /  82 车 / 数据时间戳 2026-09-06
 *   原实现是 `hit = f; break;` —— 取 API 返回顺序里的第一份。顺序无任何保证,
 *   一旦取到副本2, 线上数据会从 100 车**静默回滚到 82 车**, 而 0 条熔断(阈值 0)拦不住。
 *   按 modified_time 取最大后, 无论顺序如何都拿到最新那份。
 */
function pickNewestByName(cands){
  if(!cands || !cands.length) return null;
  return cands.slice().sort((a, b) => (Number(b.modified_time) || 0) - (Number(a.modified_time) || 0))[0];
}

async function feishuFindFile(token, folderToken, name, _depth){
  _depth = _depth || 0;
  if(_depth > 6) return null; // 防御: 不超过6层
  const files = await feishuListFiles(token, folderToken);
  const cands = [];
  const folders = [];
  for(const f of files){
    if(f.name === name || f.name === name + '.json') cands.push(f);
    if(f.type === 'folder') folders.push(f.token);
  }
  const hit = pickNewestByName(cands);
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
  LAST_FOUND[name] = { name: hit.name, token: hit.token, modified_time: hit.modified_time };
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
function sanitizeFeedback(raw, ts){
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
    /* 用源数据自身的时间戳, 而不是"此刻": 否则内容一字未改也会每轮换个值,
     *   幂等失效 -> 每 15 分钟一个空提交。 */
    timestamp: ts || new Date().toISOString(),
    sanitized: true,
    fieldAllowlist: FEEDBACK_FIELD_ALLOWLIST.slice(),
    droppedFields: dropped
  };
}

async function buildFromFeishu(opt){
  const appId = process.env.FEISHU_APP_ID;
  const appSecret = process.env.FEISHU_APP_SECRET;
  const folderToken = process.env.FEISHU_FOLDER_TOKEN || 'CeT0fYNgalU4fQdW9etcJLJGn1b';
  if(!appId || !appSecret) throw new Error('飞书模式需要环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
  const token = await feishuTenantToken(appId, appSecret);
  const vehicle = await feishuDownloadJson(token, folderToken, 'vehicle_sync_data.json') || { vehicles: [], timestamp: new Date().toISOString(), version: 'feishu', vehicleCount: 0 };
  const vHit = LAST_FOUND['vehicle_sync_data.json'];
  console.log('[mirror] 车型源文件: ' + (vHit ? (vHit.name + ' token=' + vHit.token + ' 修改时间=' + _fmtTime(vHit.modified_time)) : '(未找到 vehicle_sync_data.json)')
    + ' · 车型数=' + ((vehicle.vehicles || []).length) + ' · 数据版本=' + (vehicle.version || '?'));
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
function sanitizeApprovedUsers(raw, ts){
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
      if(k === 'name') v = maskPersonName(v);
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
    /* 同 sanitizeFeedback: 用源数据时间戳, 避免无变化也换值导致空提交 */
    timestamp: ts || new Date().toISOString(),
    sanitized: true,
    fieldAllowlist: APPROVED_FIELD_ALLOWLIST.slice(),
    droppedFields: dropped
  };
}

/* ---------- 字段归一(品牌别名) ---------- */
/**
 * 品牌写法别名表 —— **镜像侧归一**, 云端原件不动。
 * 为什么需要: 现场多台设备各自持有本地数据, 同一品牌常出现「北汽BAIC / 北汽(BAIC)」
 *   两种写法; 一旦有人用旧写法上传, `check_field_duplicates` 会把 CI 判红(已发生两次),
 *   但把云端改成某一种写法后, 下台设备再上传又会改回去 —— 纯数据侧修不干净。
 * 策略: 已知别名在**生成镜像时**归一到规范写法, 并显式告警(谁在用什么别名、几处),
 *   既保证下游(vehicles_data / 映射 / manifest / 资源库索引)一致, 又留下可追的痕迹。
 * 维护: 新增别名只加一行; 规范写法必须与 `check_field_duplicates` 的期望一致。
 */
const BRAND_ALIASES = {
  '北汽BAIC': '北汽(BAIC)'
};

/**
 * 归一车型的品牌写法(纯函数, 不改入参对象以外的任何东西)。
 * @param {Array<Object>} vehicles
 * @returns {{vehicles: Array<Object>, normalized: Array<{id:number,from:string,to:string}>}}
 */
function normalizeVehicleFields(vehicles){
  const list = Array.isArray(vehicles) ? vehicles : [];
  const normalized = [];
  list.forEach(function(v){
    if(!v || typeof v.brand !== 'string') return;
    const to = BRAND_ALIASES[v.brand];
    if(to && to !== v.brand){
      normalized.push({ id: v.id, from: v.brand, to: to });
      v.brand = to;
    }
  });
  return { vehicles: list, normalized: normalized };
}

/* ---------- 主流程 ---------- */
async function main(){
  const opt = parseArgs(process.argv);
  const isLocal = !!opt.sourceDir;
  console.log(`[mirror] 模式: ${isLocal ? '本地('+opt.sourceDir+')' : '飞书'} · 输出: ${opt.out}`);

  const { vehicle, approved, feedback: rawFeedback } = isLocal ? buildFromLocal(opt) : await buildFromFeishu(opt);

  /* 品牌别名归一(见 BRAND_ALIASES 注释): 保证下游产物一致, 并把别名用法打进日志 */
  if(vehicle && Array.isArray(vehicle.vehicles)){
    const norm = normalizeVehicleFields(vehicle.vehicles);
    if(norm.normalized.length){
      const detail = norm.normalized.slice(0, 5).map(function(x){ return 'id=' + x.id + ' ' + x.from + '→' + x.to; }).join(', ');
      console.log('::warning::[mirror] 品牌写法已归一 ' + norm.normalized.length + ' 处: ' + detail);
      console.log('[mirror] 品牌别名归一 ' + norm.normalized.length + ' 处(云端原件未改, 仅镜像侧规范化)');
    }
  }

  /* 反馈脱敏(输出侧白名单投影): 本地模式与飞书模式一视同仁。
   * 放在出库前而不是拉取后, 是为了杜绝"换个数据源就绕过脱敏"的漏网路径。 */
  const feedback = sanitizeFeedback(rawFeedback, (rawFeedback && rawFeedback.timestamp) || (vehicle && vehicle.timestamp));

  /* 账号脱敏(输出侧白名单投影): 本地模式与飞书模式一视同仁。
   * 与反馈镜像同构——放在出库前而不是拉取后, 杜绝"换个数据源就绕过脱敏"。
   * P0: 旧 buildApprovedWeb 曾把 name(明文手机号)/password(pbkdf2 哈希)/phoneH
   * 整包透传进公开的 web-data/(实测 curl 可取原文)。字段白名单自 v10.19.1 起生效
   * (name/password 不再出库); phoneH→linkKey 去盐化在 v10.19.2。 */
  const approvedWeb = sanitizeApprovedUsers(approved.users || [], (approved && approved.timestamp) || (vehicle && vehicle.timestamp));

  // 数据更新通知(网页端 60s 轮询据此自动镜像对齐)
  const notice = {
    timestamp: vehicle.timestamp || new Date().toISOString(),
    version: vehicle.version || 'mirror'
  };

  const now = new Date().toISOString();
  const meta = {
    syncedAt: now,      // 数据**真正变化**的时间(数据无变化时沿用上一次, 见下方幂等处理)
    generatedAt: now,
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

  // P0 零条熔断: 即将写入 0 车镜像, 但已有产物 >0 -> 拒绝写盘并非零退出。
  // 拦在最上游(故障源头): 飞书凭证有效却取不到 vehicle_sync_data.json 时,
  // :341 会静默降级为 {vehicles:[]}; 若不拦, 下游 gen_vehicles_data 会把
  // vehicles_data.js 一起清成 0 并推上 main, 而 cron 不跑测试、
  // deploy-pages.yml 独立触发且不看 CI 结果 -> 坏数据先上线。
  // 保留原镜像不覆盖; 合法场景(飞书侧真的清空)需人工 --force 放行。
  const prevMirror = readJsonSafe(path.join(opt.out, 'vehicle_sync_data.json'));
  const prevCount = (prevMirror && Array.isArray(prevMirror.vehicles)) ? prevMirror.vehicles.length : 0;
  if ((vehicle.vehicles || []).length === 0 && prevCount > 0 && !process.argv.includes('--force')) {
    _abortGuard(`拒绝写入: 新镜像 0 车但已有产物 ${prevCount} 车(疑似飞书目录里取不到 vehicle_sync_data.json)`,
      prevMirror, vehicle, '确认飞书侧真的清空后加 --force 放行; 否则检查「同步数据」目录是否被改名/移动/权限变更。');
  }

  // P0 数据回退熔断(2026-10-06 补): 新镜像车型数**少于**已有产物 -> 拒绝写盘。
  // 为什么 0 条熔断不够: 它只挡"被清空", 挡不住"被回退"。真实诱因是
  // 飞书"同步数据"目录里同名的 vehicle_sync_data.json 有两份(100 车 / 82 车),
  // 取错那份会让线上从 100 车**静默回退**到 82 车 —— 数据看起来"正常", 没有任何告警。
  // 上游 feishuFindFile 已改为按 modified_time 取最新(治因), 本道是治果的兜底:
  // 即便将来又出现新的"取错"路径, 这里也会拦住。
  // 合法的车型删减场景(组长确实要下架车型)需人工加 --force 放行。
  const newCount = (vehicle.vehicles || []).length;
  if (newCount > 0 && prevCount > 0 && newCount < prevCount && !process.argv.includes('--force')) {
    _abortGuard(`拒绝写入: 新镜像 ${newCount} 车 < 已有产物 ${prevCount} 车(疑似取到同名陈旧副本)`,
      prevMirror, vehicle, '若是组长确实下架了车型, 加 --force 放行; 否则检查飞书「同步数据」目录里是否有同名重复的 vehicle_sync_data.json。');
  }

  mkdirp(opt.out);
  /* 幂等: 四份数据产物任一变化才算"数据变了"。
   * 全都没变时沿用旧 syncedAt/generatedAt, 并且 meta.json 也逐字节不变 ——
   *   这样工作流 `git diff --cached` 为空, 不会每 15 分钟产生一次空提交。
   * "本轮确实巡检过"的信号放在运行日志里(以及 Actions 运行历史), 不落盘:
   *   落盘就必然每轮改一个字段, 幂等立刻失效。 */
  const dataChanged = [
    writeJson(opt.out, 'vehicle_sync_data.json', vehicle),
    writeJson(opt.out, 'approved_users.web.json', approvedWeb),
    writeJson(opt.out, 'feedback_data.json', feedback),
    writeJson(opt.out, 'data_update_notice.json', notice)
  ].some(Boolean);
  if (!dataChanged) {
    const prevMeta = readJsonSafe(path.join(opt.out, 'meta.json'));
    if (prevMeta && prevMeta.syncedAt) {
      meta.syncedAt = prevMeta.syncedAt;
      meta.generatedAt = prevMeta.generatedAt || prevMeta.syncedAt;
    }
  }
  writeJson(opt.out, 'meta.json', meta);
  if (dataChanged) {
    console.log(`[mirror] 已生成 web-data/ 镜像: 车型${(vehicle.vehicles||[]).length} / 账号${approvedWeb.users.length} / 反馈${(feedback.items||[]).length}`);
    console.log(`[mirror] meta.syncedAt=${meta.syncedAt} (网页层将据此激活)`);
  } else {
    console.log(`[mirror] 数据无变化: 保持 syncedAt=${meta.syncedAt} (本轮核对 ${now}, 不产生提交)`);
  }
}

// 仅在被直接执行时运行; 被 require 时不产生副作用(便于单元测试纯函数)
if (require.main === module) {
  main().catch(e => { console.error('::error::[mirror] 失败: ' + e.message); process.exit(1); });
}

module.exports = { pickNewestByName, feishuFindFile, _req, _reqText, _collectText, normalizeVehicleFields, BRAND_ALIASES };
