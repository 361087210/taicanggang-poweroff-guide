/**
 * ============================================================
 * test_v1022_linkkey_p0.js — P0 linkKey 架构级脱敏测试(phoneH → linkKey)
 * ============================================================
 * 背景: 旧方案 phoneH = sha256(WEB_SYNC_SALT + phone), 盐公开在源码,
 *       手机号空间 ~10^10 可离线枚举还原全部手机号。本测试锁定新方案:
 *       linkKey = PBKDF2-HMAC-SHA256(password, LINK_SALT + '|' + phone,
 *                  100000, 256bit) —— 熵完全来自密码, 仅凭 phone 无法枚举。
 *
 * 覆盖矩阵:
 *  L1  客户端原语: 00-bootstrap.js 提供 deriveLinkKey, 复用 _pbkdf2Hex
 *  L2  配置: 00-config.js 用 LINK_SALT 替换 WEB_SYNC_SALT
 *  L3  网页连接键匹配: 09-web-sync.js 删除 _sha256Hex/WEB_SYNC_SALT/phoneH
 *  L4  镜像脱敏(动态): sync_web_data.js 输出 linkKey 且不含 phoneH/phone/password
 *  L5  linkKey 不可由 phone 单独推导(动态, PBKDF2 与 SHA-256 对照)
 *  L6  网页换设备登录重建: 用 deriveLinkKey 匹配镜像 linkKey 重建本地账号
 *  L7  存活守卫: 按 state.currentUser.id 匹配镜像 id(不再用 phoneH)
 *  L8  云端组员列表: 按 id 做差集(不再用 phoneH)
 *
 * 运行: node tests/test_v1022_linkkey_p0.js
 * 要求: 本测试为「先红后绿」——改造前应失败(红), 改造后全绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const configJs = src('js/00-config.js');
const bootstrapJs = src('js/00-bootstrap.js');
const webSyncJs = src('js/09-web-sync.js');
const authJs = src('js/02-auth.js');
const cacheJs = src('js/07-cache.js');
const syncJs = src('js/05-sync.js');
const scriptJs = src('scripts/sync_web_data.js');

/* ---------- L1 客户端原语 ---------- */
section('L1 客户端原语: deriveLinkKey');
check('L1a 00-bootstrap.js 定义 deriveLinkKey', /async\s+function\s+deriveLinkKey\s*\(/.test(bootstrapJs));
check('L1b deriveLinkKey 复用 _pbkdf2Hex 原语', /deriveLinkKey[\s\S]{0,300}_pbkdf2Hex\s*\(/.test(bootstrapJs));
check('L1c deriveLinkKey 使用 LINK_SALT + "|" + phone 作为盐', /LINK_SALT[\s\S]{0,200}\+[\s\S]{0,50}\'\|\'[\s\S]{0,100}phone/.test(bootstrapJs));

/* ---------- L2 配置 ---------- */
section('L2 配置: LINK_SALT 替换 WEB_SYNC_SALT');
check('L2a 00-config.js 定义 LINK_SALT', configJs.includes("LINK_SALT: 'tcg-link-2026'"));
check('L2b 00-config.js 不再含 WEB_SYNC_SALT', !configJs.includes('WEB_SYNC_SALT'));
check('L2c 00-config.js 不再含旧盐 tcg-web-2026', !configJs.includes('tcg-web-2026'));

/* ---------- L3 网页连接键匹配改造 ---------- */
section('L3 09-web-sync.js: 删除 sha256 手机号哈希, 改用 linkKey');
check('L3a 不再引用 WEB_SYNC_SALT', !webSyncJs.includes('WEB_SYNC_SALT'));
check('L3b 删除 _sha256Hex 函数', !webSyncJs.includes('async function _sha256Hex'));
check('L3c 不再用 sha256Hex(WEB_SYNC_SALT+phone)', !webSyncJs.includes('sha256Hex(WEB_SYNC_SALT'));
check('L3d 不再引用镜像 phoneH 字段', !webSyncJs.includes('phoneH'));
check('L3e 使用 deriveLinkKey 派生连接键', webSyncJs.includes('deriveLinkKey'));
check('L3f 匹配镜像 linkKey 字段', webSyncJs.includes('.linkKey'));

/* ---------- L4 镜像脱敏(动态执行) ---------- */
section('L4 镜像脱敏: 输出 linkKey, 不含 phoneH/phone/password');
try {
  const tmp = path.join(ROOT, '_verify_linkkey_out');
  const sdir = path.join(ROOT, '_verify_linkkey_src');
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, 'vehicle_sync_data.json'), JSON.stringify({ vehicles: [], version: 'v10.22.0' }));
  // 源数据含明文 phone + password + phoneH(旧字段), 以及合法 linkKey
  fs.writeFileSync(path.join(sdir, 'approved_users.json'), JSON.stringify({ users: [
    { id: 1, name: '组长', phone: '13800000001', status: 'active', password: 'pbkdf2$salt$100000$cafe', pw_ts: 1, role: 'admin', created: '2026', linkKey: 'a'.repeat(64) },
    { id: 2, name: '18570474454', phone: '18570474454', status: 'active', role: 'user', created: '2026', password: 'pbkdf2$deadbeef$100000$cafe', pw_ts: 9, phoneH: 'b'.repeat(64), linkKey: 'c'.repeat(64) }
  ] }));
  execSync('node scripts/sync_web_data.js --source-dir _verify_linkkey_src --out _verify_linkkey_out', { cwd: ROOT, stdio: 'inherit' });
  const aw = JSON.parse(fs.readFileSync(path.join(tmp, 'approved_users.web.json'), 'utf8'));
  check('L4a 镜像无明文 phone', aw.users.every(u => !u.phone));
  check('L4b 镜像无 password(密码哈希不出库)', aw.users.every(u => !u.password));
  check('L4c 镜像无 pw_ts', aw.users.every(u => !u.pw_ts));
  check('L4d 镜像无 phoneH(旧枚举键彻底下线)', aw.users.every(u => !u.phoneH));
  check('L4e 镜像含 linkKey(64位hex)', aw.users.length > 0 && aw.users.every(u => u.linkKey && /^[0-9a-f]{64}$/.test(u.linkKey)));
  check('L4f name 手机号形态掩码', (aw.users.find(u => u.id === 2) || {}).name === '185****4454');
  const rawOut = fs.readFileSync(path.join(tmp, 'approved_users.web.json'), 'utf8');
  check('L4g 产物全文无独立11位明文手机号', ((rawOut.match(/(?<!\d)1[3-9]\d{9}(?!\d)/g) || []).length) === 0);
  check('L4h 白名单字段含 linkKey', (aw.fieldAllowlist || []).indexOf('linkKey') >= 0);
  check('L4i 白名单字段不含 phoneH', (aw.fieldAllowlist || []).indexOf('phoneH') === -1);
  fs.rmSync(tmp, { recursive: true }); fs.rmSync(sdir, { recursive: true });
} catch (e) {
  check('L4 动态执行异常: ' + e.message, false);
}

/* ---------- L5 linkKey 不可由 phone 单独推导(动态 PBKDF2) ---------- */
section('L5 linkKey 熵来自密码(仅 phone 无法推导)');
(async () => {
  try {
    const { extractNamedBlock } = require('./e2e_harness');
    const deriveBlock = extractNamedBlock(bootstrapJs, 'deriveLinkKey');
    const pbkdf2Block = extractNamedBlock(bootstrapJs, '_pbkdf2Hex');
    const sandbox = {
      crypto: globalThis.crypto, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer,
      console, window: { TCG_CONFIG: { LINK_SALT: 'tcg-link-2026' } }
    };
    sandbox.globalThis = sandbox;
    const ctx = vm.createContext(sandbox);
    vm.runInContext(pbkdf2Block, ctx, { filename: '_pbkdf2Hex.js' });
    vm.runInContext(deriveBlock, ctx, { filename: 'deriveLinkKey.js' });
    const lk1 = await vm.runInContext(`deriveLinkKey('13800000001','abc123')`, ctx);
    const lk2 = await vm.runInContext(`deriveLinkKey('13800000001','def456')`, ctx);
    check('L5a deriveLinkKey 输出 64 位 hex', typeof lk1 === 'string' && /^[0-9a-f]{64}$/.test(lk1));
    check('L5b 不同密码派生不同 linkKey(密码参与派生)', lk1 !== lk2);
    // 对照: sha256(LINK_SALT+phone) 不含密码, 必不等于 linkKey
    const sha = require('crypto').createHash('sha256').update('tcg-link-2026|13800000001', 'utf8').digest('hex');
    check('L5c linkKey !== sha256(LINK_SALT+phone)(旧枚举向量失效)', lk1 !== sha);
    // 无密码派生(密码为空)得到的是另一个值, 且无法与有密码的匹配
    const lkEmpty = await vm.runInContext(`deriveLinkKey('13800000001','')`, ctx);
    check('L5d 空密码派生值不等于真实密码派生值', lkEmpty !== lk1);
  } catch (e) {
    check('L5 动态执行异常: ' + e.message, false);
  }
  finish();
})();

/* ---------- L6/L7/L8 静态语义断言 ---------- */
section('L6 网页换设备登录重建(linkKey 命中即密码验真)');
check('L6a 重建用 deriveLinkKey 派生值匹配镜像 linkKey(命中即密码验真)', /linkKey[\s\S]{0,120}String\(lk\)|String\(lk\)[\s\S]{0,80}linkKey/.test(webSyncJs));
check('L6b 重建 id 取镜像 cu.id', /State\.addUser\([\s\S]{0,300}id\s*:\s*me\.id|id\s*:\s*cu\.id/.test(webSyncJs));
check('L6c 重建 password 用本机新盐哈希存本地会话(不再取镜像 password)', /password\s*:\s*(localHash|await\s+hashPassword)/.test(webSyncJs));
check('L6d 重建不再写 password:cu.password', !webSyncJs.includes('password:cu.password'));

section('L7 存活守卫: 按 id 匹配(不再用 phoneH)');
check('L7a checkMemberAccountAlive 按 state.currentUser.id 匹配镜像 id', /String\(cu\.id\)===String\(state\.currentUser\.id\)|String\(state\.currentUser\.id\)===String\(cu\.id\)/.test(webSyncJs));
check('L7b 存活守卫不再计算 myH/sha256', !/checkMemberAccountAlive[\s\S]{0,800}_sha256Hex|checkMemberAccountAlive[\s\S]{0,800}myH/.test(webSyncJs));

section('L8 云端组员列表: 按 id 差集(不再用 phoneH)');
check('L8a _appendCloudOnlyMembers 按 id 建本地索引', /hasLocal\[String\(u\.id\)\]|hasLocal\[u\.id\]/.test(webSyncJs));
check('L8b 云端组员按 id 差集过滤', /!hasLocal\[String\(cu\.id\)\]|!hasLocal\[cu\.id\]/.test(webSyncJs));
check('L8c 云端组员不再计算 localH(sha256)', !/_appendCloudOnlyMembers[\s\S]{0,600}localH/.test(webSyncJs));

/* ---------- 全链路写入点(注册/改密/重置/加人/推送) ---------- */
section('L9 全链路 linkKey 写入与透传');
check('L9a 安卓注册写入 linkKey', /deriveLinkKey\s*\(\s*phone\s*,\s*pass\s*\)/.test(authJs));
check('L9b 网页注册写入 linkKey', /deriveLinkKey\s*\(\s*phone\s*,\s*pass\s*\)/.test(webSyncJs));
check('L9c 安卓改密重算 linkKey', /deriveLinkKey\s*\(\s*state\.currentUser\.phone\s*,\s*n\s*\)/.test(cacheJs));
check('L9d 组长加人写入 linkKey', /deriveLinkKey\s*\(\s*phone\s*,\s*pass\s*\)/.test(cacheJs));
check('L9e 重置密码重算 linkKey(123456)', /deriveLinkKey\s*\(\s*u\.phone\s*,\s*'123456'\s*\)|deriveLinkKey\(u\.phone,'123456'\)/.test(cacheJs));
check('L9f pushApprovedUsersToFeishu 透传 linkKey', /linkKey\s*:\s*u\.linkKey/.test(syncJs));
check('L9g syncPendingToFeishu 透传 linkKey', /linkKey\s*:\s*user\.linkKey/.test(syncJs));

/* ---------- 镜像脚本去盐化 ---------- */
section('L10 scripts/sync_web_data.js 去盐化');
check('L10a 删除 DEFAULT_SALT', !scriptJs.includes('DEFAULT_SALT'));
check('L10b 删除 phoneHash 补算函数', !scriptJs.includes('function phoneHash'));
check('L10c 白名单 linkKey 替换 phoneH', scriptJs.includes("'linkKey'") && !scriptJs.includes("'phoneH'"));
check('L10d linkKey 只接受 64 位 hex 形态', /linkKey[\s\S]{0,300}\[0-9a-f\]\{64\}/.test(scriptJs));
check('L10e 凭据字段兜底仍拦截 password/token/salt', /CREDENTIAL_FIELD_RE[\s\S]{0,120}password/.test(scriptJs));

function finish(){
  console.log('\n==============================================================');
  console.log('P0 linkKey 脱敏测试汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
}
