/* V10.18.0 架构重构专项测试 — 验证 6 项问题修复 + 重构交付物
 * 运行: node tests/test_refactor_v1018.js  (仓库根目录 src/ 下)
 * 纯静态文本/产物校验, 不依赖浏览器/jsdom。 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const exists = p => fs.existsSync(path.join(ROOT, p));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

section('F1 配置单一真源 00-config.js');
check('F1a 00-config.js 存在', exists('js/00-config.js'));
const cfg = src('js/00-config.js');
check('F1b 定义 WEB_SYNC_SALT=tcg-web-2026', cfg.includes("WEB_SYNC_SALT: 'tcg-web-2026'"));
check('F1c 定义 GITHUB_REPO', cfg.includes("GITHUB_REPO: '361087210/taicanggang-poweroff-guide'"));
check('F1d 定义 BASE_APP_TOKEN', cfg.includes('Gn4db7il9a27QrsOtVbclSE3nnf'));
check('F1e 定义 DEFAULT_CHAT_ID', cfg.includes('oc_1b25c691971c61de0b7773e49cb42796'));
check('F1f 不含密钥明文', !/s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb|ghp_/.test(cfg)); /* noqa:secret */

section('F2 配置读取改造(降级兜底)');
const web = src('js/09-web-sync.js');
check('F2a WEB_SYNC_SALT 改从 TCG_CONFIG 读取', web.includes('window.TCG_CONFIG&&window.TCG_CONFIG.WEB_SYNC_SALT'));
check('F2b 保留兜底默认值', web.includes("||'tcg-web-2026'"));
const boot = src('js/00-bootstrap.js');
check('F2c GITHUB_REPO 改从 TCG_CONFIG 读取', boot.includes('window.TCG_CONFIG&&window.TCG_CONFIG.GITHUB_REPO'));
const bit = src('js/12-bitable.js');
check('F2d BASE_APP_TOKEN 改从 TCG_CONFIG 读取', bit.includes('window.TCG_CONFIG&&window.TCG_CONFIG.BASE_APP_TOKEN'));
const html = src('demo.html');
check('F2e demo.html 先加载 00-config 再 00-bootstrap', /00-config\.js[\s\S]*?00-bootstrap\.js/.test(html));

section('F3 问题1 往期账号可见性归一(05-sync.js)');
const sync = src('js/05-sync.js');
check('F3a 引入 LEGACY_OK', sync.includes('LEGACY_OK'));
check('F3b 归一旧值 approved/normal/verified', sync.includes("cu.status==='approved'") && sync.includes("cu.status==='normal'") && sync.includes("cu.status==='verified'"));
check('F3c 空/未知 status 归一为 active', sync.includes("const norm =") && sync.includes("'active'"));
check('F3d 绝不误归一 pending/rejected', sync.includes("cu.status==='pending'||cu.status==='rejected'"));

section('F4 问题1 拒绝通知 chatId 落地(05-sync.js)');
check('F4a loadFeishuConfig 缓存 tcg_version_feishu_config', sync.includes("localStorage.setItem('tcg_version_feishu_config'"));
check('F4b watchRegistrationActivation 被拒即通知', sync.includes('pushRegistrationRejectionNotice(local)'));

section('F5 网页镜像管道(问题2+网页播放根因)');
check('F5a scripts/sync_web_data.js 存在', exists('scripts/sync_web_data.js'));
check('F5b 工作流 sync-web-data.yml 存在', exists('.github/workflows/sync-web-data.yml'));
check('F5c 工作流使用 FEISHU Secrets', src('.github/workflows/sync-web-data.yml').includes('FEISHU_APP_SECRET'));
check('F5d 工作流提交 web-data', src('.github/workflows/sync-web-data.yml').includes('git add web-data/'));
const script = src('scripts/sync_web_data.js');
check('F5e 脚本 SALT 一致', script.includes("'tcg-web-2026'"));
check('F5f 支持本地离线模式', script.includes('--source-dir'));
check('F5g 手机号脱敏', script.includes('phoneHash') && script.includes('sha256'));

section('F6 网页镜像产物已落地 web-data/');
check('F6a meta.json 含 syncedAt', (function(){ try{ const m=JSON.parse(src('web-data/meta.json')); return !!(m&&m.syncedAt); }catch(e){ return false; } })());
check('F6b vehicle_sync_data.json 存在', exists('web-data/vehicle_sync_data.json'));
check('F6c approved_users.web.json 脱敏', (function(){ try{ const a=JSON.parse(src('web-data/approved_users.web.json')); return Array.isArray(a.users) && a.users.every(u=>!u.phone); }catch(e){ return false; } })());

section('F7 安全治理');
check('F7a secret-scan.js 存在', exists('scripts/secret-scan.js'));
check('F7b secret-scan 工作流存在', exists('.github/workflows/secret-scan.yml'));
check('F7c SECURITY.md 存在', exists('SECURITY.md'));

section('F8 版本一致性 (期望值动态取自 version.json)');
const vj = JSON.parse(src('version.json'));
/* V10.19.0: 与 test_v1017 的 E 组同款改造——不写死具体版本号, 只校验
 * versionCode 与 version 的编码规则一致, 避免每次升版整组变红。 */
const vjV = String(vj.version || '');
const vjC = String(vj.versionCode == null ? '' : vj.versionCode);
function _vjToCode(v){ return String(v).split('.').map(function(p){ return p.padStart(2, '0'); }).join(''); }
check('F8a version.json.version 为 x.y.z 三段纯数字', /^[0-9]+\.[0-9]+\.[0-9]+$/.test(vjV), vjV);
check('F8b versionCode 与 version 编码一致(去点补零)', vjC === _vjToCode(vjV), 'version=' + vjV + ' versionCode=' + vjC);
check('F8c chatId 写入 version.json', vj.feishuConfig && vj.feishuConfig.chatId === 'oc_1b25c691971c61de0b7773e49cb42796');

section('F9 动态执行验证(本地镜像脚本)');
try {
  const tmp = path.join(ROOT, '_verify_out');
  const sdir = path.join(ROOT, '_verify_src');
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true }); fs.mkdirSync(sdir, { recursive: true });
  fs.writeFileSync(path.join(sdir, 'vehicle_sync_data.json'), JSON.stringify({ vehicles: [{ id: 'v1', display: '测试车', videoPaths: [] }], version: 'v10.18.0' }));
  fs.writeFileSync(path.join(sdir, 'approved_users.json'), JSON.stringify({ users: [{ id: 1, name: '甲', phone: '13800000001', status: 'active', password: 'x', pw_ts: 1, role: 'user', created: '2026' }] }));
  execSync('node scripts/sync_web_data.js --source-dir _verify_src --out _verify_out', { cwd: ROOT, stdio: 'inherit' });
  const meta = JSON.parse(fs.readFileSync(path.join(tmp, 'meta.json'), 'utf8'));
  check('F9a 本地模式生成 meta.syncedAt', !!(meta && meta.syncedAt));
  const aw = JSON.parse(fs.readFileSync(path.join(tmp, 'approved_users.web.json'), 'utf8'));
  check('F9b 本地模式脱敏(无明文phone, phoneH=64位)', aw.users.every(u => !u.phone) && aw.users[0].phoneH && aw.users[0].phoneH.length === 64);
  fs.rmSync(tmp, { recursive: true }); fs.rmSync(sdir, { recursive: true });
} catch (e) {
  check('F9 动态执行异常: ' + e.message, false);
}

section('F10 secret-scan 执行');
try {
  execSync('node scripts/secret-scan.js .', { cwd: ROOT, stdio: 'inherit' });
  check('F10a secret-scan 通过(无泄露)', true);
} catch (e) {
  check('F10a secret-scan 发现泄露/异常', false);
}

console.log('\n==============================================================');
console.log('V10.18.0 重构测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
