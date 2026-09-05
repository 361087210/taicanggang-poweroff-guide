/**
 * ============================================================
 * test_v1015_member_sync_gate.js - V10.14.1 同步链路配置出口统一 专项回归测试
 * ============================================================
 * 背景(真机反馈): "组长组员数据无法同步,组员端显示飞书配置不完整"。
 * 根因: js/05-sync.js 五处(loadFeishuConfig/_syncUploadPipeline/doSyncDownload/
 *       checkCloudDataUpdate/exportSyncConfig)直读 localStorage.getItem('feishu_config')
 *       自行拼装 cfg,绕过 getFeishuCfg() 的构建期注入秘钥闭包缓存(_INJECTED_SECRETS_CACHE):
 *         · 组员端本地从未保存过配置 → appSecret 恒取 DEFAULT 空串 → feishuCfgReady 拦截
 *           + 三色横幅误报"未注入同步凭据"(组员端显示飞书配置不完整)
 *         · 组长端未在设置页手动保存过配置(依赖构建注入凭据) → 上传管线同样被拦,数据无法上云
 *         · 历史脏配置(无 _writer=admin 标记)反而会以脏 appSecret 放行 → token 请求必败
 * 修复: 五处全部改走 getFeishuCfg() 统一出口(与 syncPendingToFeishu 等 8 处既有调用对齐)。
 *
 * 覆盖矩阵:
 *  P1-P5  源码级: 五个函数块内必须调用 getFeishuCfg();三个同步关键函数内禁止再直读 feishu_config
 *  P6     源码级: js/05-sync.js 全文件 feishu_config 直读数 ≤ 2(仅剩 loadFeishuConfig/
 *         exportSyncConfig 的 Secret/interval 回显用途)
 *  B1  组员+注入+零本地配置 → loadFeishuConfig 绿色横幅(✅已内置),不再误报琥珀色"未注入"
 *  B2  组员+注入+零本地配置 → _syncUploadPipeline 以注入秘钥通过门禁(ok=true,token 收到注入 appSecret)
 *  B3  组长+注入+零本地配置(从未手动保存) → 上传管线同样通过(组长侧"无法同步"复现路径)
 *  B4  组员+注入+零本地配置 → doSyncDownload 以注入秘钥调用下载,完整走通镜像合并
 *  B5  组员+注入+零本地配置 → checkCloudDataUpdate(true) 不再被门禁静默吞掉(发起 token 轮询)
 *  B6  组员+注入 → exportSyncConfig 导出注入 appId/folderToken;导出 payload 永不含 Secret
 *  B7  【守卫】无注入+零本地配置 → 门禁仍应拦截(未签名调试构建不得静默同步)
 *  B8  【脏配置】组员+注入+无标记脏配置 → 管线仍用注入秘钥(不被脏值遮蔽/放行)
 *  B9  【守卫】admin 保存过 interval=60 → 设置页回显 60(用户偏好不被统一出口冲掉)
 *  B10 【安全守卫】组员+注入 → Secret 输入框不回显注入秘钥(仅回显手动保存值)
 *  B11 【守卫】admin 显式保存(_writer=admin) → 手动保存值仍优先于注入(覆盖语义保留)
 *
 * 运行: node tests/test_v1015_member_sync_gate.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { loadCombinedSource, extractNamedBlock } = require('./e2e_harness');

const ROOT = path.join(__dirname, '..');
const src = loadCombinedSource();

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

// 注入秘钥固定测试值(与真机构建期 inject_build_secrets.js 注入的字段形态一致)
const INJ = {
  appId: 'cli_INJECTED_1015',
  appSecret: 'SEC_INJECTED_1015_secret',
  folderToken: 'FLDR_injected_1015',
};

// ---------- 通用沙箱: 角色 + localStorage + DOM 存根 + 网络/副作用记录桩 ----------
function makeSyncSandbox(role, opts) {
  opts = opts || {};
  const rec = {
    tokenCfgs: [], downloadCfgs: [], uploads: [], shared: [],
    toasts: [], syncLogs: [], persists: 0, replaced: [], dots: [],
  };
  const mkInput = id => ({
    id, value: '', readOnly: false, disabled: false, className: '',
    attributes: {},
    setAttribute(a, v) { this.attributes[a] = String(v); if (a === 'readonly') this.readOnly = true; if (a === 'disabled') this.disabled = true; },
    removeAttribute(a) { delete this.attributes[a]; if (a === 'readonly') this.readOnly = false; if (a === 'disabled') this.disabled = false; },
    hasAttribute(a) { return a in this.attributes; },
    style: {},
    classList: {
      _cls: new Set(),
      add(...cs) { cs.forEach(c => this._cls.add(c)); },
      remove(...cs) { cs.forEach(c => this._cls.delete(c)); },
      toggle(c, on) { on ? this._cls.add(c) : this._cls.delete(c); },
      contains(c) { return this._cls.has(c); },
    },
  });
  const bannerEl = {
    id: 'feishu-role-banner',
    className: '',
    innerHTML: '',
    classList: {
      _cls: new Set(['hidden']),
      add(...cs) { cs.forEach(c => this._cls.add(c)); },
      remove(...cs) { cs.forEach(c => this._cls.delete(c)); },
      contains(c) { return this._cls.has(c); },
    },
  };
  const saveBtn = {
    classList: {
      _cls: new Set(),
      add(...cs) { cs.forEach(c => this._cls.add(c)); },
      remove(...cs) { cs.forEach(c => this._cls.delete(c)); },
      contains(c) { return this._cls.has(c); },
    },
  };
  const elements = {
    'feishu-role-banner': bannerEl,
    'feishu-appid': mkInput('feishu-appid'),
    'feishu-secret': mkInput('feishu-secret'),
    'feishu-folder': mkInput('feishu-folder'),
    'feishu-interval': Object.assign(mkInput('feishu-interval'), { value: '30' }),
    'feishu-status': { textContent: '' },
    'sync-cloud-ver': { textContent: '' },
    'sync-status-text': { className: '', innerHTML: '' },
    'sync-new-hint-text': { textContent: '' },
    'sync-new-hint': { classList: { toggle() {} } },
    'sync-new-dot': { classList: { toggle() {} } },
    'sync-new-dot-side': { classList: { toggle() {} } },
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
      clear() { this._m.clear(); },
    },
    setTimeout, clearTimeout, Promise, JSON, Object, Array, Date, Set, Map, RegExp, Error,
    VEHICLES: opts.vehicles || [{
      id: 1, brandId: 1, brand: '测试品牌', series: '测试车系', config: '标准', display: '本地测试车A',
      size: '', powerType: '纯电', position: '前舱', steps: [], keyFrame: '', keyContainer: '',
      remarks: '', photos: 0, photoPaths: [], videos: 0, videoPaths: [],
    }],
    USERS: [],
    APP_VERSION: '10.14.4',
    FEISHU_MULTIPART_THRESHOLD: 16 * 1024 * 1024,
    CLOUD_CHECK_THROTTLE_MS: 5 * 60 * 1000,
    _cloudCheckLastTs: 0,
    _cloudCheckBusy: false,
    getPinyin: s => 'PY_' + String(s),
    state: {
      searchQuery: '', brandFilter: 'all', viewMode: 'flat', expandedBrands: new Set(),
      currentUser: role ? {
        role, name: role === 'admin' ? '组长测试' : '组员测试',
        phone: role === 'admin' ? '17602554481' : '13800000001',
      } : null,
    },
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(sel) {
        if (sel && /saveFeishuConfig|feishu-save|^button/.test(sel)) return saveBtn;
        return null;
      },
    },
    // ---- 副作用/网络记录桩(目标函数按名解析,不注入这些真实实现) ----
    showToast: m => rec.toasts.push(String(m)),
    addSyncLog: (m, c) => rec.syncLogs.push({ m: String(m), c }),
    persistVehicles: () => { rec.persists++; },
    renderVehicleList: () => {},
    renderBrandTags: () => {},
    renderSyncLog: () => {},
    _setSyncNewDot: on => rec.dots.push(!!on),
    getFeishuToken: async (cfg) => { rec.tokenCfgs.push(cfg); return 'mock_token'; },
    syncUploadVehiclePhotos: async () => ({ replaced: 0, skipped: 0, failed: 0 }),
    syncUploadVehicleVideos: async () => ({ replaced: 0, skipped: 0, failed: 0 }),
    uploadJsonToDataFeishu: async (token, name, str, sub) => { rec.uploads.push({ name, sub }); return {}; },
    getDataFolderToken: async () => 'mock_data_root',
    feishuListFiles: async () => [],
    httpFetch: async () => ({ ok: true, status: 200 }),
    downloadSyncDataMigrated: async (cfg) => {
      rec.downloadCfgs.push(cfg);
      return opts.cloudData !== undefined ? opts.cloudData : null;
    },
    downloadJsonFromDataFeishu: async () => null,
    State: { replaceVehicles: arr => { rec.replaced.push(arr); } },
    shareFile: async (blob, name, type) => { rec.shared.push({ blob, name, type }); },
    Blob: class {
      constructor(parts, o) { this.parts = parts; this.type = o && o.type; this.size = (parts && parts[0] || '').length; }
    },
  };
  sandbox.window = sandbox;
  if (opts.withSecrets) {
    sandbox.__BUILD_SECRETS__ = {
      appId: INJ.appId, appSecret: INJ.appSecret, folderToken: INJ.folderToken,
      dataFolderName: 'APP数据备份', syncSubFolder: '同步数据', pendingSubFolder: '注册申请',
      approvedSubFolder: '审批结果', backupSubFolder: '备份文件',
    };
  }
  sandbox.globalThis = sandbox;
  if (opts.savedConfig) {
    sandbox.localStorage.setItem('feishu_config', JSON.stringify(opts.savedConfig));
  }
  const ctx = vm.createContext(sandbox);
  return {
    sandbox, ctx, rec, elements, bannerEl,
    run: expr => vm.runInContext(expr, ctx, { filename: 'v1015_eval.js' }),
  };
}

// 注入真实源码块(统一出口 + 五个目标函数; 网络依赖由沙箱桩提供)
const GATE_BLOCKS = [
  'DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady',
  'loadFeishuConfig', '_syncUploadPipeline', 'doSyncDownload', 'checkCloudDataUpdate',
  'exportSyncConfig',
];
function injectGateBlocks(ctx) {
  for (const n of GATE_BLOCKS) {
    vm.runInContext(extractNamedBlock(src, n), ctx, { filename: 'v1015#' + n + '.js' });
  }
}

/** 安全提取函数块(提取失败返回 null, 由 check 记 FAIL 而非崩溃) */
function safeBlock(name) {
  try { return extractNamedBlock(src, name); } catch (_) { return null; }
}

(async function main() {

// =============================================================
section('前置: 源码级配置出口统一断言 (P1-P6)');
// =============================================================
{
  const syncJs = fs.readFileSync(path.join(ROOT, 'js/05-sync.js'), 'utf8');
  const direct = (syncJs.match(/localStorage\.getItem\('feishu_config'\)/g) || []).length;

  const bUpload = safeBlock('_syncUploadPipeline');
  check('P1 _syncUploadPipeline 调用 getFeishuCfg() 统一出口', !!bUpload && /getFeishuCfg\(\)/.test(bUpload));
  check('P1 _syncUploadPipeline 不再直读 feishu_config', !!bUpload && !bUpload.includes("localStorage.getItem('feishu_config')"));

  const bDown = safeBlock('doSyncDownload');
  check('P2 doSyncDownload 调用 getFeishuCfg() 统一出口', !!bDown && /getFeishuCfg\(\)/.test(bDown));
  check('P2 doSyncDownload 不再直读 feishu_config', !!bDown && !bDown.includes("localStorage.getItem('feishu_config')"));

  const bCheck = safeBlock('checkCloudDataUpdate');
  check('P3 checkCloudDataUpdate 调用 getFeishuCfg() 统一出口', !!bCheck && /getFeishuCfg\(\)/.test(bCheck));
  check('P3 checkCloudDataUpdate 不再直读 feishu_config', !!bCheck && !bCheck.includes("localStorage.getItem('feishu_config')"));

  const bLoad = safeBlock('loadFeishuConfig');
  check('P4 loadFeishuConfig 调用 getFeishuCfg()(横幅就绪度判定走统一出口)', !!bLoad && /getFeishuCfg\(\)/.test(bLoad));

  const bExport = safeBlock('exportSyncConfig');
  check('P5 exportSyncConfig 调用 getFeishuCfg()(导出值取统一出口)', !!bExport && /getFeishuCfg\(\)/.test(bExport));

  check('P6 js/05-sync.js 直读 feishu_config 仅剩 ≤2 处(Secret/interval 回显用途), 当前=' + direct, direct <= 2);
}

// =============================================================
section('B1: 组员+注入+零本地配置 → 绿色横幅(不再误报"配置不完整")');
// =============================================================
{
  const sb = makeSyncSandbox('user', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  sb.run('loadFeishuConfig()');
  const html = sb.bannerEl.innerHTML || '';
  check('B1-1 横幅显示(非hidden)', sb.bannerEl.classList.contains('hidden') === false);
  check('B1-2 横幅为绿色"✅已内置"文案', html.includes('✅') && html.includes('已内置'));
  check('B1-3 横幅不再误报"⚠️未注入同步凭据"', !html.includes('未注入') && !html.includes('⚠️'));
  check('B1-4 AppId 输入框回显注入 appId', sb.elements['feishu-appid'].value === INJ.appId);
  check('B1-5 Folder 输入框回显注入 folderToken', sb.elements['feishu-folder'].value === INJ.folderToken);
  check('B1-6 状态文案"飞书账号已配置 ✓"', (sb.elements['feishu-status'].textContent || '').includes('已配置'));
}

// =============================================================
section('B2: 组员+注入+零本地配置 → 上传管线以注入秘钥通过门禁');
// =============================================================
{
  const sb = makeSyncSandbox('user', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  const r = await sb.run('_syncUploadPipeline()');
  check('B2-1 管线 ok=true(未被"配置不完整"门禁拦截)', !!(r && r.ok === true));
  check('B2-2 getFeishuToken 收到注入 appSecret', sb.rec.tokenCfgs.length > 0 && sb.rec.tokenCfgs[0].appSecret === INJ.appSecret);
  check('B2-3 getFeishuToken 收到注入 appId/folderToken', sb.rec.tokenCfgs[0] && sb.rec.tokenCfgs[0].appId === INJ.appId && sb.rec.tokenCfgs[0].folder === INJ.folderToken);
  check('B2-4 同步JSON上传至"同步数据"子目录(syncSub 随统一出口解析)',
    sb.rec.uploads.some(u => u.name === 'vehicle_sync_data.json' && u.sub === '同步数据'));
  check('B2-5 全程无"飞书配置不完整"toast', !sb.rec.toasts.some(t => /配置不完整/.test(t)));
  check('B2-6 本地同步水位已写入', !!sb.sandbox.localStorage.getItem('feishu_sync_data'));
}

// =============================================================
section('B3: 组长+注入+从未手动保存配置 → 上传管线同样通过(组长侧复现路径)');
// =============================================================
{
  const sb = makeSyncSandbox('admin', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  const r = await sb.run('_syncUploadPipeline()');
  check('B3-1 组长零保存配置下管线 ok=true', !!(r && r.ok === true));
  check('B3-2 组长侧 getFeishuToken 同样收到注入秘钥', sb.rec.tokenCfgs.length > 0 && sb.rec.tokenCfgs[0].appSecret === INJ.appSecret);
  check('B3-3 无"飞书配置不完整"toast', !sb.rec.toasts.some(t => /配置不完整/.test(t)));
}

// =============================================================
section('B4: 组员+注入+零本地配置 → 拉取管线以注入秘钥走通镜像合并');
// =============================================================
{
  const cloudData = {
    version: 'v99.9.9', timestamp: new Date(Date.now() + 60000).toISOString(), vehicleCount: 2,
    vehicles: [
      { id: 1, display: '云端车A', photoPaths: [], videoPaths: [] },
      { id: 2, display: '云端车B', photoPaths: [], videoPaths: [] },
    ],
  };
  const sb = makeSyncSandbox('user', { withSecrets: true, cloudData });
  injectGateBlocks(sb.ctx);
  await sb.run('doSyncDownload()');
  check('B4-1 downloadSyncDataMigrated 被调用(未被门禁拦截)', sb.rec.downloadCfgs.length > 0);
  check('B4-2 下载收到注入 appSecret', sb.rec.downloadCfgs[0] && sb.rec.downloadCfgs[0].appSecret === INJ.appSecret);
  check('B4-3 下载收到注入 folderToken + syncSub',
    !!(sb.rec.downloadCfgs[0] && sb.rec.downloadCfgs[0].folder === INJ.folderToken && sb.rec.downloadCfgs[0].syncSub === '同步数据'));
  check('B4-4 镜像合并执行(State.replaceVehicles 收到云端全集)', sb.rec.replaced.length === 1 && sb.rec.replaced[0].length === 2);
  check('B4-5 出现"数据同步完成"toast(完整走通而非中途拦截)', sb.rec.toasts.some(t => /数据同步完成/.test(t)));
  check('B4-6 无"飞书配置不完整"toast', !sb.rec.toasts.some(t => /配置不完整/.test(t)));
}

// =============================================================
section('B5: 组员+注入+零本地配置 → 云端更新感知轮询不再被静默吞掉');
// =============================================================
{
  const sb = makeSyncSandbox('user', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  await sb.run('checkCloudDataUpdate(true)');
  check('B5-1 发起了 token 请求(轻量通知轮询未被门禁静默拦截)', sb.rec.tokenCfgs.length > 0);
  check('B5-2 轮询使用注入 appSecret', sb.rec.tokenCfgs[0] && sb.rec.tokenCfgs[0].appSecret === INJ.appSecret);
  check('B5-3 无"飞书配置不完整"toast(该入口本应静默)', !sb.rec.toasts.some(t => /配置不完整/.test(t)));
}

// =============================================================
section('B6: 组员+注入 → 导出配置含注入 appId/folderToken 且永不含 Secret');
// =============================================================
{
  const sb = makeSyncSandbox('user', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  await sb.run('exportSyncConfig()');
  check('B6-1 shareFile 被调用(导出成功)', sb.rec.shared.length === 1);
  const payload = sb.rec.shared[0] && sb.rec.shared[0].blob.parts[0];
  check('B6-2 导出文件名 cloud_sync_config.json', sb.rec.shared[0] && sb.rec.shared[0].name === 'cloud_sync_config.json');
  let data = null;
  try { data = JSON.parse(payload); } catch (_) { /* 记失败 */ }
  check('B6-3 导出 payload 可解析', !!data);
  check('B6-4 导出 feishuConfig.appId 为注入值', data && data.feishuConfig && data.feishuConfig.appId === INJ.appId);
  check('B6-5 导出 feishuConfig.folder 为注入 folderToken', data && data.feishuConfig && data.feishuConfig.folder === INJ.folderToken);
  check('B6-6 导出 payload 不含注入 Secret(安全)', !payload || payload.indexOf(INJ.appSecret) === -1);
}

// =============================================================
section('B7: 【守卫】无注入+零本地配置 → 门禁仍拦截(调试构建不得静默同步)');
// =============================================================
{
  const sb = makeSyncSandbox('admin', { withSecrets: false });
  injectGateBlocks(sb.ctx);
  const r = await sb.run('_syncUploadPipeline()');
  check('B7-1 未配置构建管线 ok=false', !!(r && r.ok === false));
  check('B7-2 明确提示"飞书配置不完整"', /配置不完整/.test((r && r.msg) || '') || sb.rec.toasts.some(t => /配置不完整/.test(t)));
  check('B7-3 未发起任何 token 请求', sb.rec.tokenCfgs.length === 0);
}

// =============================================================
section('B8: 【脏配置】组员+注入+无标记脏配置 → 管线仍用注入秘钥');
// =============================================================
{
  const sb = makeSyncSandbox('user', {
    withSecrets: true,
    savedConfig: { appId: '脏值AppIdX', appSecret: '脏值SecretX', folder: '脏值FolderX', updatedAt: '2025-01-01T00:00:00Z' },
  });
  injectGateBlocks(sb.ctx);
  const r = await sb.run('_syncUploadPipeline()');
  check('B8-1 管线 ok=true(脏配置不阻断)', !!(r && r.ok === true));
  check('B8-2 token 收到注入秘钥而非脏值', sb.rec.tokenCfgs.length > 0 && sb.rec.tokenCfgs[0].appSecret === INJ.appSecret);
  check('B8-3 token 收到注入 appId 而非脏值', sb.rec.tokenCfgs[0] && sb.rec.tokenCfgs[0].appId === INJ.appId);
}

// =============================================================
section('B9: 【守卫】admin 保存 interval=60 → 设置页回显不被冲掉');
// =============================================================
{
  const sb = makeSyncSandbox('admin', { withSecrets: true, savedConfig: { interval: 60 } });
  injectGateBlocks(sb.ctx);
  sb.run('loadFeishuConfig()');
  check('B9 interval 用户偏好回显 60(非默认30)', String(sb.elements['feishu-interval'].value) === '60');
}

// =============================================================
section('B10: 【安全守卫】组员+注入 → Secret 输入框不回显注入秘钥');
// =============================================================
{
  const sb = makeSyncSandbox('user', { withSecrets: true });
  injectGateBlocks(sb.ctx);
  sb.run('loadFeishuConfig()');
  check('B10 Secret 输入框为空(注入秘钥只存在于闭包内存)', sb.elements['feishu-secret'].value === '');
}

// =============================================================
section('B11: 【守卫】admin 显式保存(_writer=admin) → 手动值仍优先');
// =============================================================
{
  const sb = makeSyncSandbox('admin', {
    withSecrets: true,
    savedConfig: { appId: 'cli_admin_saved', appSecret: 'admin_saved_secret', folder: 'admin_saved_folder', interval: 45, _writer: 'admin' },
  });
  injectGateBlocks(sb.ctx);
  sb.run('loadFeishuConfig()');
  const r = await sb.run('_syncUploadPipeline()');
  check('B11-1 设置页回显 admin 手动保存的 appId/Secret', sb.elements['feishu-appid'].value === 'cli_admin_saved' && sb.elements['feishu-secret'].value === 'admin_saved_secret');
  check('B11-2 管线使用 admin 手动保存秘钥(覆盖语义保留)', sb.rec.tokenCfgs.length > 0 && sb.rec.tokenCfgs[0].appSecret === 'admin_saved_secret');
  check('B11-3 管线 ok=true', !!(r && r.ok === true));
}

// =============================================================
console.log('\n==============================================================');
console.log(`V10.14.1 同步配置出口统一专项测试汇总: PASS=${pass}  FAIL=${fail}`);
console.log('==============================================================');
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(f => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('✅ 全部通过 V10.14.1 专项 (' + pass + ' 项)');
}

})().catch(e => { console.error('运行时错误:', e); process.exit(1); });
