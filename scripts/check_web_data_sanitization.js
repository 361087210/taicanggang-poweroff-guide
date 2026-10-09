#!/usr/bin/env node
'use strict';
/**
 * ============================================================
 * scripts/check_web_data_sanitization.js —— web-data/ 公网镜像脱敏门禁
 * ============================================================
 * 背景(为什么需要本门禁):
 *   web-data/ 是发布到**公开** GitHub Pages 的数据镜像, 由
 *   scripts/sync_web_data.js 每 15 分钟生成并自动提交(.github/workflows/
 *   sync-web-data.yml)。历史上(见 sync_web_data.js 注释 "V10.19.1 P0")
 *   此处曾把**明文手机号 + pbkdf2 密码哈希**暴露到公网。生成侧此后已改为
 *   "白名单投影(默认拒绝)"脱敏, 但仍有两个缺口:
 *     ① scripts/secret-scan.js 的 SKIP 集合**包含 web-data** —— 即
 *        已发布镜像产物从来不被任何扫描器覆盖(它只扫源码, 不扫产物);
 *     ② 生成侧校验只保护"生成路径"。若产物被手工改动、或绕过脚本直接提交,
 *        没有任何门禁能拦下未脱敏内容。
 *   本门禁补上**产物侧**复核: 直接对 web-data/ 下**已存在**的产物做默认拒绝
 *   校验, 口径与 scripts/sync_web_data.js 的脱敏白名单保持一致(见下方常量)。
 *
 * 校验项(命中任一即计入 findings → exit 1):
 *   A. 记录级字段白名单(默认拒绝, 与生成侧同口径)
 *      - approved_users.web.json: 每个 user 的键 ⊆ APPROVED_FIELD_ALLOWLIST
 *      - feedback_data.json:      每个 item 为**嵌套**结构 {fields:{…}, record_id, created_time}
 *        (与生成侧 sanitizeFeedback 输出、消费侧 10-feedback.js 的 item.fields 一致):
 *        外层包装键 ⊆ FEEDBACK_ITEM_ALLOWLIST, 内层 item.fields 键 ⊆ FEEDBACK_FIELD_ALLOWLIST
 *   B. 敏感字段名兜底(全产物): 键命中 SENSITIVE_FIELD_RE(联系方式/手机/姓名…)
 *   C. 凭据字段名兜底(全产物): 键命中 CREDENTIAL_FIELD_RE(password/pw_ts/token/secret/salt)
 *   D. 明文手机号字段名(全产物): 键精确命中 PLAIN_PHONE_FIELD_RE(phone/mobile/tel/telephone)
 *   E. 明文手机号取值(全产物): 值中出现未掩码的 11 位手机号形态
 *   F. linkKey 形态: 出现时必须为 64 位 hex(PBKDF2-HMAC-SHA256 派生)
 *   G. 脱敏哨兵: users / feedback 产物必须携带 sanitized === true
 *
 * 运行: node scripts/check_web_data_sanitization.js [web-data目录]
 * 退出码: 0 = 通过(目录不存在时按"跳过"处理); 1 = 发现未脱敏/可疑内容
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, 'web-data');

/* ---------------------------------------------------------------
 * 脱敏口径 —— 与 scripts/sync_web_data.js 生成侧**逐字对齐**(单一真源)。
 * 若生成侧调整白名单/正则, 必须同步修改此处, 否则门禁与生成侧漂移。
 * ------------------------------------------------------------- */
const FEEDBACK_FIELD_ALLOWLIST = ['反馈ID', '问题板块', '问题描述', '状态', '创建时间'];
/* 反馈产物为嵌套结构: item 包装层允许的键 —— 与生成侧 sanitizeFeedback 的输出对象一致 */
const FEEDBACK_ITEM_ALLOWLIST = ['fields', 'record_id', 'created_time'];
const APPROVED_FIELD_ALLOWLIST = ['id', 'name', 'linkKey', 'role', 'status', 'created'];
const SENSITIVE_FIELD_RE = /(联系方式|设备信息|提交人|手机|电话|邮箱|邮件|微信|QQ|IMEI|设备型号|系统版本|平台|APP版本|角色|姓名|账号|IP|定位|地址)/i;
const CREDENTIAL_FIELD_RE = /(password|passwd|pwd|pw_?ts|token|secret|salt)/i;
const PLAIN_PHONE_FIELD_RE = /^(phone|mobile|tel|telephone)$/i;

/* 明文手机号形态: 1[3-9] + 9 位。
 * 与生成侧的 PHONE_PLAIN_RE 相比, 这里额外加了**边界断言**(前后不得紧邻
 * 字母/数字): 否则产物中的合成成员 ID(如 "m1787572011751")会被子串误判为
 * 手机号(其 "17875720117" 恰好命中 1[3-9]\d{9})。这是产物侧扫描的必要收紧。 */
const PHONE_PLAIN_RE = /(?<![0-9A-Za-z])(?:\+?86)?(1[3-9]\d{9})(?![0-9A-Za-z])/;
const LINKKEY_RE = /^[0-9a-f]{64}$/i;

const findings = [];
function add(type, file, p, detail) {
  findings.push({ type: type, file: file, path: p, detail: String(detail) });
}

/* ---------------------------------------------------------------
 * 通用深度遍历: 对**所有**产物做全产物扫描(C/D/E/F)。
 * 只把对象属性键当作"字段名"(数组里的字符串是"取值", 不当字段名)。
 * ------------------------------------------------------------- */
function walk(node, pathStr, file) {
  if (Array.isArray(node)) {
    node.forEach((el, i) => walk(el, pathStr + '[' + i + ']', file));
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) {
      const v = node[k];
      const p = pathStr ? pathStr + '.' + k : k;
      // C: 凭据字段名
      if (CREDENTIAL_FIELD_RE.test(k)) add('credential-field', file, p, k);
      // B: 敏感字段名兜底(全产物 —— 覆盖 approved/feedback 记录级与其它产物, 单点上报)
      if (SENSITIVE_FIELD_RE.test(k)) add('sensitive-field', file, p, k);
      // D: 明文手机号字段名(精确匹配)
      if (PLAIN_PHONE_FIELD_RE.test(k)) add('plain-phone-field', file, p, k);
      // F: linkKey 形态
      if (k === 'linkKey' && typeof v === 'string' && !LINKKEY_RE.test(v)) {
        add('linkkey-shape', file, p, v.slice(0, 24) + '…');
      }
      if (v !== null && typeof v === 'object') {
        walk(v, p, file);
      } else if (typeof v === 'string' || typeof v === 'number') {
        checkPlainPhoneValue(v, p, file);
      }
    }
    return;
  }
  if (typeof node === 'string' || typeof node === 'number') checkPlainPhoneValue(node, pathStr, file);
}

/* E: 取值中的明文手机号(含数字型取值, 因为手机号可能被存成 number) */
function checkPlainPhoneValue(v, p, file) {
  const s = typeof v === 'string' ? v : String(v);
  const m = PHONE_PLAIN_RE.exec(s);
  if (m) add('plain-phone-value', file, p, m[1]);
}

/* A: 记录级白名单投影校验
 * 注: 敏感字段名兜底(B)已统一由 walk() 全产物上报, 此处不再重复, 避免同类重复计数。 */
function checkRecordKeys(records, allowlist, file, where) {
  records.forEach((rec, i) => {
    if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
      add('record-shape', file, where + '[' + i + ']', 'not an object');
      return;
    }
    for (const k of Object.keys(rec)) {
      if (allowlist.indexOf(k) === -1) add('extra-field', file, where + '[' + i + '].' + k, k);
    }
  });
}

function readJson(file) {
  const abs = path.join(TARGET, file);
  // 区分"产物缺失"与"产物损坏": 缺失单列一类, 仍 fail-closed(exit 1), 但不谎报为 JSON 解析失败
  if (!fs.existsSync(abs)) {
    add('missing-artifact', file, file, '必需产物不存在: ' + file);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(abs, 'utf8'));
  } catch (e) {
    add('bad-json', file, file, e.message);
    return null;
  }
}

/* ===================== 主流程 ===================== */
console.log('==============================================================');
console.log(' web-data 公网镜像脱敏门禁  (scripts/check_web_data_sanitization.js)');
console.log(' 目标目录: ' + TARGET);
console.log('==============================================================');

if (!fs.existsSync(TARGET) || !fs.statSync(TARGET).isDirectory()) {
  console.log('[SKIP] 目标目录不存在 —— 无已发布镜像产物需校验, 退出 0');
  console.log('        (若本地尚未生成, 可先运行: npm run sync:web)');
  process.exit(0);
}

const files = fs.readdirSync(TARGET).filter(f => /\.json$/i.test(f)).sort();
if (!files.length) {
  console.log('[SKIP] 目录内无 .json 产物 —— 退出 0');
  process.exit(0);
}
console.log('发现产物 ' + files.length + ' 个: ' + files.join(', '));
console.log('--------------------------------------------------------------');

/* 逐产物: 结构哨兵(G) + 记录级白名单(A/B) + 全产物扫描(C/D/E/F) */
const users = readJson('approved_users.web.json');
if (users) {
  if (Array.isArray(users.users)) {
    if (users.sanitized !== true) add('missing-sentinel', 'approved_users.web.json', 'sanitized', users.sanitized);
    checkRecordKeys(users.users, APPROVED_FIELD_ALLOWLIST, 'approved_users.web.json', 'users');
  } else {
    add('bad-shape', 'approved_users.web.json', 'users', 'not an array');
  }
}

const feedback = readJson('feedback_data.json');
if (feedback) {
  if (Array.isArray(feedback.items)) {
    if (feedback.sanitized !== true) add('missing-sentinel', 'feedback_data.json', 'sanitized', feedback.sanitized);
    // 反馈产物为嵌套结构(与生成侧 sanitizeFeedback 一致): item = {fields:{…}, record_id, created_time}
    //   外层包装键 ⊆ FEEDBACK_ITEM_ALLOWLIST; 内层 fields 键 ⊆ FEEDBACK_FIELD_ALLOWLIST。
    feedback.items.forEach((it, i) => {
      if (!it || typeof it !== 'object' || Array.isArray(it)) {
        add('record-shape', 'feedback_data.json', 'items[' + i + ']', 'not an object');
        return;
      }
      for (const k of Object.keys(it)) {
        if (FEEDBACK_ITEM_ALLOWLIST.indexOf(k) === -1) add('extra-field', 'feedback_data.json', 'items[' + i + '].' + k, k);
      }
      const f = it.fields;
      if (f === undefined) return;
      if (!f || typeof f !== 'object' || Array.isArray(f)) {
        add('record-shape', 'feedback_data.json', 'items[' + i + '].fields', 'not an object');
        return;
      }
      for (const k of Object.keys(f)) {
        if (FEEDBACK_FIELD_ALLOWLIST.indexOf(k) === -1) add('extra-field', 'feedback_data.json', 'items[' + i + '].fields.' + k, k);
      }
    });
  } else {
    add('bad-shape', 'feedback_data.json', 'items', 'not an array');
  }
}

// 全产物深度扫描(覆盖 vehicle_sync_data.json / meta.json / data_update_notice.json 等全部)
for (const f of files) {
  let doc;
  try {
    doc = JSON.parse(fs.readFileSync(path.join(TARGET, f), 'utf8'));
  } catch (e) {
    // 已在上面的定向 readJson 报过 bad-json 的不重复报
    if (f !== 'approved_users.web.json' && f !== 'feedback_data.json') add('bad-json', f, f, e.message);
    continue;
  }
  walk(doc, '', f);
}

/* ===================== 输出 ===================== */
if (!findings.length) {
  console.log('[PASS] 未发现未脱敏/可疑内容 —— 公网镜像脱敏校验通过 ✔');
  console.log('--------------------------------------------------------------');
  process.exit(0);
}

// 按类型分组打印, 同类合并计数
const TYPE_CN = {
  'credential-field': '凭据/密钥字段名(C)',
  'plain-phone-field': '明文手机号字段名(D)',
  'plain-phone-value': '明文手机号取值(E)',
  'extra-field': '白名单外多余字段(A)',
  'sensitive-field': '敏感个人信息字段名(B)',
  'missing-artifact': '必需产物缺失',
  'linkkey-shape': 'linkKey 非 64 位 hex(F)',
  'missing-sentinel': '缺少 sanitized 脱敏哨兵(G)',
  'record-shape': '记录结构异常',
  'bad-shape': '产物结构异常',
  'bad-json': 'JSON 解析失败'
};
const byType = {};
for (const x of findings) (byType[x.type] = byType[x.type] || []).push(x);

console.log('❌ 发现 ' + findings.length + ' 处未脱敏/可疑内容:');
for (const t of Object.keys(byType)) {
  console.log('');
  console.log('  【' + (TYPE_CN[t] || t) + '】 ' + byType[t].length + ' 处');
  byType[t].slice(0, 20).forEach(x => {
    console.log('     - ' + x.file + '  @ ' + (x.path || '(root)') + '  → ' + x.detail);
  });
  if (byType[t].length > 20) console.log('     … 其余 ' + (byType[t].length - 20) + ' 处省略');
}
console.log('');
console.log('--------------------------------------------------------------');
console.log('处置建议:');
console.log('  1) 切勿提交/发布该产物; 优先重新运行 `npm run sync:web` 让生成侧白名单投影重写。');
console.log('  2) 若为手工改动, 请还原为生成产物; 若生成侧确有新字段需求, 先评估隐私影响再更新白名单。');
console.log('--------------------------------------------------------------');
process.exit(1);
