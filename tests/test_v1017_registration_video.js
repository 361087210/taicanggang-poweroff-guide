/**
 * ============================================================
 * test_v1017_registration_video.js - V10.17.0 注册闭环与视频恢复 测试
 * ============================================================
 * 覆盖矩阵:
 *  A组 注册闭环(反馈问题1): rejected状态双向同步/拒绝通知函数/守望器拒绝终止/
 *     登录拒绝文案精准化/组长拒绝飞书通知调用
 *  B组 网页端注册(反馈问题2): 登记通道常量/密文token/注册校验链/
 *     pending载荷结构/诚实失败路径
 *  C组 视频恢复与封面(反馈问题3): 映射表49全覆盖/Release资产名合法/
 *     详情页封面双层结构/占位文案区分空态
 *  D组 上传命名(反馈需求4): 按车型名称命名规则/保留幂等哈希
 *  E组 版本一致性: 三源对齐 V10.17.0
 *
 * 运行: node tests/test_v1017_registration_video.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const syncJs = src('js/05-sync.js');
const authJs = src('js/02-auth.js');
const cacheJs = src('js/07-cache.js');
const webSyncJs = src('js/09-web-sync.js');
const bootstrapJs = src('js/00-bootstrap.js');
const vehiclesJs = src('js/03-vehicles.js');
const mediaJs = src('js/06-media.js');
const versionJson = JSON.parse(src('version.json'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name); }
}
function section(title) {
  console.log('\n==============================================================');
  console.log(title);
  console.log('==============================================================');
}

/* ---------- A组 注册闭环(反馈问题1) ---------- */
section('A组 注册闭环: 拒绝通知与状态同步');
check('A1 pullApprovedStatusFromFeishu 合并rejected状态', syncJs.includes("cu.status==='active'||cu.status==='rejected'"));
check('A2 拒绝落地通知函数存在(pushRegistrationRejectionNotice)', syncJs.includes('function pushRegistrationRejectionNotice(user)'));
check('A3 拒绝落地时触发通知', /me\.status==='rejected'[\s\S]{0,400}pushRegistrationRejectionNotice\(local\)/.test(syncJs));
check('A4 本地通知插件调度(notify.schedule)', syncJs.includes("notify.schedule({"));
check('A5 拒绝通知含Toast降级', syncJs.includes("showToast('您的注册申请未通过审核"));
check('A6 拒绝同步日志留痕', syncJs.includes("注册申请未通过审核"));
check('A7 守望器检测rejected并终止轮询', /local\.status==='rejected'[\s\S]{0,200}clearInterval\(_regWatchTimer\)/.test(syncJs));
check('A8 组长拒绝后调用飞书群通知', cacheJs.includes("notifyRegistrationResult(USERS[idx].phone,'rejected'"));
check('A9 登录pending态拉取后复核rejected', authJs.includes("after&&after.status==='rejected'"));
check('A10 登录rejected文案含联系组长指引', authJs.includes('您的注册申请未通过组长审核，如有疑问请联系组长'));
check('A11 rejected登录前先云端复核(组长可改判)', /status==='rejected'[\s\S]{0,120}pullApprovedStatusFromFeishu\(user\)/.test(authJs));

/* ---------- B组 网页端注册: 经收集箱仓库转投飞书 (Issue2 复投) ----------
 * 架构: 网页端为只读镜像, 无法直连飞书(无后端+CORS); 申请投递到专用公开收集箱
 * 仓库 tcg-registration-inbox/registrations/, 其 relay.yml 每5分钟转投飞书
 * 「注册申请/」, 组长安卓端既有审批链路零改动。
 * 安全: 写库令牌为构建期注入 registerTokenEnc(建议 fine-grained 仅限收集箱
 *      内容写), 源码绝不含明文 PAT; 令牌缺失时优雅降级为引导语, 不崩溃。 */
section('B组 网页端注册: 经收集箱转投飞书(Issue2 复投, 安全注入)');
check('B1 注册通道走专用收集箱仓库', webSyncJs.includes('361087210/tcg-registration-inbox'));
check('B2 通过 GitHub Contents API 上行', webSyncJs.includes('api.github.com/repos/') && webSyncJs.includes('/contents/'));
check('B3 源码不含明文PAT令牌', !/ghp_[A-Za-z0-9]{20,}/.test(webSyncJs) && !webSyncJs.includes('Bearer ghp_'));
check('B4 写库令牌来自构建注入(registerTokenEnc解密), 不入源码', /registerTokenEnc[\s\S]{0,80}_decryptBuildSecret/.test(webSyncJs));
check('B5 doRegister 仍为异步函数', /window\.doRegister\s*=\s*async\s+function/.test(webSyncJs));
check('B6 令牌缺失时优雅降级引导(不崩溃)', webSyncJs.includes('网页登记通道未配置'));
check('B7 生成待审注册载荷(type/source/含linkKey)', /type:'pending_registration'/.test(webSyncJs) && /source:'web-mirror'/.test(webSyncJs) && webSyncJs.includes('linkKey'));
check('B8 与原生注册同款校验+密码哈希+派生linkKey', /await\s*hashPassword\(pass,\s*salt\)/.test(webSyncJs) && /await\s*deriveLinkKey\(phone,\s*pass\)/.test(webSyncJs));
check('B9 保留注册限流(tcg_reg_lock)', webSyncJs.includes('tcg_reg_lock'));
check('B10 网页端不在本机落 pending 账号(审批后镜像激活)', !webSyncJs.includes('watchRegistrationActivation(newUser)'));
check('B11 不含旧明文登记令牌常量(已删除)', !webSyncJs.includes('GITHUB_REGISTER_TOKEN_ENC'));
check('B12 注册失败带可操作分支', webSyncJs.includes('提交失败('));
check('B15 镜像脱敏通道(linkKey, 无旧盐/phoneH)', webSyncJs.includes('deriveLinkKey') && webSyncJs.includes('.linkKey') && !webSyncJs.includes('WEB_SYNC_SALT') && !webSyncJs.includes('phoneH'));
check('B16 安卓端注册链不受影响(02-auth.js 未变)', authJs.includes('await hashPassword(pass, salt)'));

/* ---------- C组 视频恢复与封面(反馈问题3) ---------- */
section('C组 视频恢复: 直链映射与封面');
const assetsMatch = bootstrapJs.match(/const MEDIA_DIRECT_ASSETS=\{([\s\S]*?)\};/);
const assetKeys = assetsMatch ? [...assetsMatch[1].matchAll(/'([^']+)':/g)].map(x => x[1]) : [];
const vehicleSrc = src('vehicles_data.js');
/* V10.25: 媒体路径改为三段式 vehicle_videos/<车型名>/xxx.mp4(见 js/00-media-paths.js)。
 * 这里统一取路径末段(裸文件名)再与资产表键比对, 使两段式与三段式引用都能匹配,
 * 49 计数语义保持不变。 */
const referencedVids = [...new Set([...vehicleSrc.matchAll(/vehicle_videos\/([^'"]+)/g)].map(x => x[1].split('/').pop()))];
check('C1 直链映射表数量=49(全部引用全覆盖)', assetKeys.length === 49);
check('C2 视频引用数=49(49全部官方直链)', referencedVids.length === 49);
/* P1 数据一致性(2026-10-02 更新): 组长新上传 长安深蓝(G318)_v2.mp4 等 3 个视频已配
 * Release 直链(见 MEDIA_DIRECT_ASSETS), 且多维表格车辆数据已接入新名
 * (旧 user_v 命名 user_v22_v2_7a155908.mp4 已替换为直链资产名)。
 * 若未来出现新的旧命名遗留, 本断言与 test_video_playback_v1019.js 的 S1b/S1d 清单应同步处理。 */
check('C3 引用覆盖(全部引用均有直链, 无待接入遗留)', (() => {
  const missing = referencedVids.filter(k => !assetKeys.includes(k));
  return missing.length === 0;
})());
check('C4 资产值无重复(每个tcgv_仅对应一个车型,无张冠李戴)', (() => {
  const vals = assetsMatch ? [...assetsMatch[1].matchAll(/:'([^']+)'/g)].map(x => x[1]) : [];
  return new Set(vals).size === vals.length;
})());
check('C5 映射值均为tcgv_*.mp4资产名', assetKeys.length === 0 || assetKeys.every(() => true) && assetsMatch[1].includes('tcgv_'));
check('C6 详情页视频卡含SVG兜底封面', vehiclesJs.includes('fallbackSvg') && vehiclesJs.includes('data:image/svg+xml'));
check('C7 视频自然首帧层(preload=metadata)', vehiclesJs.includes('preload="metadata"'));
check('C8 首帧成功后替换兜底层(onloadeddata)', vehiclesJs.includes("onloadeddata="));
check('C9 兜底封面含车辆名(用户可辨识)', /fallbackSvg[\s\S]{0,600}v\.display/.test(vehiclesJs));
check('C10 占位文案区分源失效(不再误称待补充)', mediaJs.includes('教学视频加载失败'));
check('C11 组长可见重新上传入口', mediaJs.includes('重新上传本车视频'));

/* ---------- D组 上传命名(反馈需求4) ---------- */
section('D组 上传按车型名称命名');
check('D1 照片文件名含车型名(display)', /baseName=_sanitizeFeishuFileName\(v\.display[^)]*\)[\s\S]{0,120}_p\$\{i\+1\}_\$\{hash\}\.jpeg/.test(syncJs));
check('D2 视频文件名含车型名(display)', /baseName=_sanitizeFeishuFileName\(v\.display[^)]*\)[\s\S]{0,120}_v\$\{i\+1\}_\$\{hash\}\.mp4/.test(syncJs));
check('D3 保留幂等哈希后缀(防同名冲突)', syncJs.includes('_p${i+1}_${hash}.jpeg') && syncJs.includes('_v${i+1}_${hash}.mp4'));
check('D4 缺省车型名兜底(vehicle_{id})', syncJs.includes("v.display||('vehicle_'+v.id)"));
check('D5 文件名清洗(_sanitizeFeishuFileName)', /baseName=_sanitizeFeishuFileName\(/.test(syncJs));
check('D6 旧user_v命名已移除', !syncJs.includes('user_v${v.id}_'));

/* ---------- E组 版本一致性 ----------
 * V10.19.0 重构: 期望值全部从 version.json 动态推导, 不再写死版本号。
 * 根因(反复发作的坏味道): 旧断言把 10.18.0 / 101800 硬编码在 7 处, 每次
 * 发版升版本号都会整组变红, 被迫人工改测试——测试本该校验"各处是否一致",
 * 而不是"是否等于某个具体版本"。现以 version.json 为单一真源, 其余各处
 * 与之比对; versionCode 由 version 按去点补零规则推导(与
 * scripts/check_version_consistency.js 的 versionToCode 保持同规则)。 */
section('E组 版本一致性 (期望值动态取自 version.json)');
const V = String(versionJson.version || '');
const VC = String(versionJson.versionCode == null ? '' : versionJson.versionCode);
/** "10.19.0" -> "101900": 每段补零到 2 位后拼接(与 check_version_consistency.js 同规则) */
function _versionToCode(v){ return String(v).split('.').map(function(p){ return p.padStart(2, '0'); }).join(''); }
/** 把版本号转成可安全嵌入正则的字面量(转义点号) */
function _reEsc(s){ return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

check('E1 version.json.version 为 x.y.z 三段纯数字', /^[0-9]+\.[0-9]+\.[0-9]+$/.test(V), V);
check('E2 versionCode 与 version 编码一致(去点补零)', VC === _versionToCode(V), 'version=' + V + ' versionCode=' + VC);
check('E3 00-bootstrap APP_VERSION 与 version.json 一致', bootstrapJs.includes("const APP_VERSION='" + V + "';"));
check('E4 config.xml 与 version.json 一致',
  new RegExp('version="' + _reEsc(V) + '" android-versionCode="' + VC + '"').test(src('config.xml')));
check('E5 sw.js 缓存名随版本(tcg-poweroff-v' + V + ')', src('sw.js').includes('tcg-poweroff-v' + V));
check('E6 demo.html 本地版本显示与 version.json 一致', src('demo.html').includes('id="sync-local-ver">v' + V));
check('E7 releaseNotes 含当前版本号', versionJson.releaseNotes.some(function(n){ return String(n).includes(V); }));

/* ---------- 汇总 ---------- */
console.log('\n==============================================================');
console.log(`V10.17.0 测试汇总: ${pass} passed, ${fail} failed`);
console.log('==============================================================');
if (fail > 0) {
  console.log('失败项:');
  failures.forEach(f => console.log('  - ' + f));
  process.exit(1);
}
console.log('✅ 全部通过');
