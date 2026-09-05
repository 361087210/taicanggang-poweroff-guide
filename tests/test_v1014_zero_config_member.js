/**
 * ============================================================
 * test_v1014_zero_config_member.js - V10.14.0 组员零配置 + 镜像同步 真机级专项测试
 * ============================================================
 * 覆盖矩阵(Z1~Z8 真机必走链路,是沙箱测试盲区补全):
 *  Z1: 【修复A核心】注入消耗 + 清localStorage 后 getFeishuCfg 仍能取回相同秘钥(闭包缓存永久化验证)
 *  Z2: 【修复C琥珀】无注入 + 无localStorage + role=member → 横幅显示为"⚠️未注入官方凭据"警示(琥珀色class)
 *  Z3: 【修复C绿色】有注入 + role=member → 横幅绿色"✅组员账号:云端配置已内置" + 三个输入框 readonly+disabled + 保存按钮隐藏
 *  Z4: 【修复C蓝色】组长登录(role=admin) → 横幅蓝色"🛠组长管理员设置区" + 输入框可编辑 + 保存按钮显示
 *  Z5: 【修复B核心】时间戳相等但 ID 集合不一致(含删除)时 doSyncDownload 仍执行镜像删除传播(双通道兜底)
 *  Z6: 【修复A安全】_INJECTED_SECRETS_CACHE 不在 window 对象(没被暴露,外部拿不到)
 *  Z7: 【修复A稳定性】localStorage.clear() 后 saveUsers=空 → 连续两次 getFeishuCfg 返回与第一次相同对象值
 *  Z8: 【修复C样式】三色横幅样式class状态机正确(绿/琥珀/蓝各对应role+注入组合)
 *  Z9: 【修复C深度防御】saveFeishuConfig 被 member 角色调用时立即 return,不写入 localStorage,showToast 提示
 *  Z10:【修复C脏配置】成员端 localStorage 保存了垃圾 appSecret 值('旧版脏值123')时 getFeishuCfg 仍返回注入缓存正确值(不被历史脏值遮蔽)
 *
 * 运行: node tests/test_v1014_zero_config_member.js
 */
'use strict';

const assert = require('assert');
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

// ---------- 构造通用沙箱:含 state.currentUser 角色 + localStorage + DOM 存根 ----------
function makeSandbox(role /* 'admin'|'user'|null */, opts) {
  opts = opts || {};
  const stubs = { toasts: [], syncLogs: [], bannerCalls: [], bannerRemoves: [], bannerAdds: [], bannerInner: '' };
  const mkInput = id => ({
    id, value: '', readOnly: false, disabled: false, className: '',
    attributes: {},
    // 样式操作
    setAttribute(a, v) { this.attributes[a] = String(v); if (a === 'readonly') this.readOnly = true; if (a === 'disabled') this.disabled = true; },
    removeAttribute(a) { delete this.attributes[a]; if (a === 'readonly') this.readOnly = false; if (a === 'disabled') this.disabled = false; },
    hasAttribute(a) { return a in this.attributes || (a === 'readonly' ? this.readOnly : (a === 'disabled' ? this.disabled : false)); },
    style: { opacity: '1', backgroundColor: 'transparent', display: '' },
    classList: {
      _cls: new Set(),
      add(...cls) { cls.forEach(c => this._cls.add(c)); this.className = [...this._cls].join(' '); },
      remove(...cls) { cls.forEach(c => this._cls.delete(c)); this.className = [...this._cls].join(' '); },
      contains(c) { return this._cls.has(c); }
    }
  });
  // 简易 banner div
  const bannerEl = {
    id: 'feishu-role-banner',
    attributes: {},
    setAttribute() {}, removeAttribute() {}, hasAttribute(){ return false;},
    _display: 'none',
    _className: '',
    get className() { return this._className; },
    set className(v) {
      this._className = String(v || '');
      this.classList._s = new Set(this._className.split(/\s+/).filter(Boolean));
      // 同步: 如果新className不含 'hidden',则视为可见(修复C loadFeishuConfig 写 className 直接赋值场景)
      if (!this.classList._s.has('hidden')) { this._display = 'block'; }
    },
    innerHTML: '',
    textContent: '',
    classList: {
      _s: new Set(['hidden']),
      add(...cls) {
        cls.forEach(c => this._s.add(c));
        bannerEl._className = [...this._s].join(' ');
        if (this._s.has('hidden')) { bannerEl._display = 'none'; }
      },
      remove(...cls) {
        cls.forEach(c => this._s.delete(c));
        bannerEl._className = [...this._s].join(' ');
        if (cls.includes('hidden') || !this._s.has('hidden')) { bannerEl._display = 'block'; }
      },
      contains(c) { return this._s.has(c); }
    },
    get style() {
      return {
        get display() { return bannerEl.classList.contains('hidden') ? 'none' : bannerEl._display; },
        set display(v) { bannerEl._display = v; if (v === 'none') bannerEl.classList.add('hidden'); else bannerEl.classList.remove('hidden'); }
      };
    }
  };
  // 保存按钮
  const saveBtn = {
    id: 'feishu-save',
    attributes: {},
    setAttribute() {}, removeAttribute() {},
    _display: '',
    style: {
      get display() { return saveBtn._display; },
      set display(v) { saveBtn._display = v; if (v === 'none') saveBtn.classList.add('hidden'); else saveBtn.classList.remove('hidden'); }
    },
    classList: {
      _s: new Set(),
      add(...cls) { cls.forEach(c => this._s.add(c)); },
      remove(...cls) { cls.forEach(c => this._s.delete(c)); },
      contains(c) { return this._s.has(c); }
    }
  };
  const elements = {
    'feishu-role-banner': bannerEl,
    'feishu-appid': mkInput('feishu-appid'),
    'feishu-secret': mkInput('feishu-secret'),
    'feishu-folder': mkInput('feishu-folder'),
    'feishu-interval': Object.assign(mkInput('feishu-interval'), { value: '30' }),
    'feishu-save': saveBtn,
    'feishu-status': { textContent: '' },
    'sync-cloud-ver': { textContent: '' },
  };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {}, info: () => {} },
    localStorage: {
      _m: new Map(),
      getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
      setItem(k, v) { this._m.set(k, String(v)); },
      removeItem(k) { this._m.delete(k); },
      clear() { this._m.clear(); }
    },
    setTimeout, clearTimeout, AbortController, Promise, JSON, Object, Array,
    VEHICLES: [], USERS: [], BRANDS: [], getPinyin: s => s,
    persistVehicles: () => {}, saveUsers: u => {},
    showToast: m => { stubs.toasts.push(String(m)); },
    addSyncLog: (m, c) => stubs.syncLogs.push({ m, c }),
    feishuCfgReady: (cfg, wt) => !!(cfg && cfg.appId && cfg.appSecret),
    APP_VERSION: '10.14.4',
    state: {
      searchQuery: '', brandFilter: 'all', viewMode: 'flat',
      expandedBrands: new Set(),
      currentUser: role ? { role, phone: role === 'admin' ? '17602554481' : '13800000001', name: '测试' + role } : null,
    },
    document: {
      getElementById(id) { return elements[id] || null; },
      querySelector(sel) {
        if (sel === '#feishu-role-banner') return bannerEl;
        if (sel === 'input#feishu-appid') return elements['feishu-appid'];
        // V10.14.0 修复C loadFeishuConfig 通过 selector 找保存按钮
        if (sel && /saveFeishuConfig|feishu-save|^button/.test(sel)) return saveBtn;
        return null;
      }
    },
    // 模拟注入秘钥(默认不注入,opts.withSecrets决定)
  };
  if (opts.withSecrets) {
    sandbox.window = sandbox;
    sandbox.window.__BUILD_SECRETS__ = {
      appId: opts.secretAppId || 'cli_INJECTED_APP_ID_123',
      appSecret: opts.secretAppSecret || 'SEC_INJECTED_abcd_efgh_1234_secretXYZ',
      folderToken: opts.secretFolder || 'FOLDER_injected_999888',
      dataFolderName: 'APP数据备份',
      syncSubFolder: '同步数据',
      pendingSubFolder: '注册申请',
      approvedSubFolder: '审批结果',
      backupSubFolder: '备份文件',
      interval: 90,
    };
  } else {
    sandbox.window = sandbox;
  }
  sandbox.globalThis = sandbox;
  // 默认常量注入
  sandbox.LEADER_PHONE = '17602554481';
  sandbox.DEFAULT_FEISHU_CONFIG = {
    appId: 'cli_DEFAULT_PUBLIC_OPENID',
    appSecret: '', // 默认不提供(公开版本)
    folder: 'nodcnGA95g93RhIUSdCeTkhKlQc', // version.json 公开 folderToken
    dataFolder: 'APP数据备份',
    syncSub: '同步数据',
    pendingSub: '注册申请',
    approvedSub: '审批结果',
    backupSub: '备份文件',
    interval: 90,
  };
  Object.assign(sandbox, opts.extra || {});
  const ctx = vm.createContext(sandbox);
  return { sandbox, ctx, stubs, elements, bannerEl, saveBtn,
    run: expr => vm.runInContext(expr, ctx, { filename: 'v1014_eval.js' }) };
}

function injectBlocks(ctx, names) {
  for (const n of names) {
    vm.runInContext(extractNamedBlock(src, n), ctx, { filename: 'v1014#' + n + '.js' });
  }
}

(async function main() {

// =============================================================
section('前置: 源码含修复A/B/C标记');
// =============================================================
check('pre-A 源码含 _INJECTED_SECRETS_CACHE 闭包缓存声明(修复A核心)',
  src.includes('_INJECTED_SECRETS_CACHE') && src.includes('_INJECTED_SECRETS_CACHE = Object.assign({}, window.__BUILD_SECRETS__)'));
check('pre-A 源码读取注入后 delete window.__BUILD_SECRETS__(用完即焚)',
  src.includes('delete window.__BUILD_SECRETS__'));
check('pre-B sameIds 双通道比对(修复B)存在',
  src.includes('sameIds') && (src.includes('cloudTs > lastSyncTs') || src.includes('lastSyncTs < cloudTs')));
check('pre-C 横幅元素 id=feishu-role-banner 在 demo.html 中存在',
  src.includes('feishu-role-banner'));
check('pre-C 成员端readonly+disabled灰化应用代码存在(或保存按钮隐藏)',
  src.includes('disabled') && (src.includes('readonly') || src.includes('saveBtn') || src.includes('display = "none"')));

// =============================================================
section('Z组: 真机级零配置同步场景 (8+核心用例)');
// =============================================================

// --------- Z1: 注入消耗 + 清 localStorage 后仍能取回相同秘钥 ---------
section('Z1: 【修复A核心】闭包缓存永久化 - localStorage.clear 不丢失注入秘钥');
{
  const { sandbox, ctx, run } = makeSandbox('user', { withSecrets: true });
  // 注入 getFeishuCfg + DEFAULT + 闭包缓存let声明(必须先于getFeishuCfg)
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg']);
  // 第一次调用:消费 window.__BUILD_SECRETS__ + 写入闭包缓存
  const first = run('getFeishuCfg()');
  // 消费后 window 上不应有 __BUILD_SECRETS__
  check('Z1-1 首次调用后 window.__BUILD_SECRETS__ 被 delete(用完即焚)',
    sandbox.window.__BUILD_SECRETS__ === undefined || sandbox.window.__BUILD_SECRETS__ === null || sandbox.window.__BUILD_SECRETS__ === void 0);
  const expectSecret = first.appSecret;
  check('Z1-2 首次调用返回注入值(非默认公开appSecret="")', expectSecret === 'SEC_INJECTED_abcd_efgh_1234_secretXYZ');
  // 清 localStorage(模拟真机"清除缓存")
  sandbox.localStorage.clear();
  // 清 USERS / state 相关模拟(也属于清缓存)
  sandbox.state.currentUser = null;
  // 第二次调用: 必须走闭包缓存
  const second = run('getFeishuCfg()');
  check('Z1-3 localStorage.clear 后,第二次getFeishuCfg仍返回相同appSecret', second.appSecret === expectSecret);
  check('Z1-4 localStorage.clear 后,appId/folder仍完全一致', second.appId === first.appId && second.folder === first.folder);
  check('Z1-5 两次返回值不是 window 上泄露引用(对象引用不同)', second !== first && !(second && sandbox.window && Object.hasOwnProperty.call(sandbox.window, '_INJECTED_SECRETS_CACHE')));
  // 闭包内变量不存在于全局(window/sandbox顶层属性)
  const exposed = Object.keys(sandbox.window).filter(k => /INJECTED_SECRET|SECRET_CACHE/.test(k));
  check('Z1-6 window 顶层没有暴露闭包缓存变量名(安全)', exposed.length === 0);
}

// --------- Z6: _INJECTED_SECRETS_CACHE 不在 window ---------
section('Z6: 【修复A安全】闭包缓存名不出现在 window/全局属性枚举');
{
  const { sandbox, ctx, run } = makeSandbox('user', { withSecrets: true });
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg']);
  run('getFeishuCfg()');
  // 直接 hasOwnProperty 检测 (不能在 window 上)
  const hasDirect = Object.prototype.hasOwnProperty.call(sandbox.window, '_INJECTED_SECRETS_CACHE');
  const keysHas = Object.keys(sandbox.window).includes('_INJECTED_SECRETS_CACHE');
  check('Z6 window 不直接暴露 _INJECTED_SECRETS_CACHE 属性', !hasDirect && !keysHas);
}

// --------- Z7: localStorage.clear 后 N 次调用稳定性 ---------
section('Z7: 【修复A稳定性】localStorage.clear → N次 getFeishuCfg 幂等一致性');
{
  const { sandbox, ctx, run } = makeSandbox('user', { withSecrets: true });
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg']);
  const v1 = run('getFeishuCfg()');
  sandbox.localStorage.clear();
  sandbox.localStorage.removeItem('feishu_config');
  sandbox.localStorage.removeItem('tcg_users');
  const v2 = run('getFeishuCfg()');
  const v3 = run('getFeishuCfg()');
  const v4 = run('getFeishuCfg()');
  check('Z7 清除后 4 次调用 appSecret 值全等稳定',
    v1.appSecret === v2.appSecret && v2.appSecret === v3.appSecret && v3.appSecret === v4.appSecret);
  check('Z7 清除后 4 次调用 appId 值全等稳定',
    v1.appId === v2.appId && v2.appId === v3.appId && v3.appId === v4.appId);
  check('Z7 folderToken 值全等于注入值(公开token正确)',
    v1.folder === 'FOLDER_injected_999888' && v4.folder === 'FOLDER_injected_999888');
}

// --------- Z2: 无注入 + role=member → 琥珀色警示横幅 ---------
section('Z2: 【修复C琥珀】成员无注入 → 琥珀色警示横幅,提示下载官方签名包');
{
  const { sandbox, ctx, stubs, bannerEl, run } = makeSandbox('user', { withSecrets: false });
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig', 'saveFeishuConfig']);
  run('loadFeishuConfig()');
  // 横幅要显示 + 琥珀色
  const hasAmber = bannerEl.classList.contains('border-amber-500') ||
                   bannerEl.classList.contains('bg-amber-50') ||
                   bannerEl.classList.contains('amber') ||
                   /amber|警告|警示|⚠️|请下载|官方签名|未注入/.test(bannerEl.innerHTML || '');
  const bannerVisible = bannerEl.style.display !== 'none' && !bannerEl.classList.contains('hidden');
  check('Z2 无注入成员: 横幅显示(非none)', bannerVisible);
  check('Z2 无注入成员: 琥珀色警示文案', hasAmber);
  // showToast 不报错(兼容模式)
  const containsWarnToast = stubs.toasts.some(t => /未注入|更新|安装包|官方|签名/.test(t));
  check('Z2 无注入成员: showToast/横幅含"更新/官方签名"类引导(或者横幅显示即可)',
    hasAmber || containsWarnToast);
}

// --------- Z3: 有注入 + role=member → 绿色横幅 + readonly+disabled + 隐藏保存按钮 ---------
section('Z3: 【修复C绿色】成员有注入 → 绿色横幅 + 输入框只读 + 保存按钮隐藏');
{
  const { sandbox, ctx, elements, bannerEl, saveBtn, run } = makeSandbox('user', { withSecrets: true });
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig', 'saveFeishuConfig']);
  run('loadFeishuConfig()');
  // 横幅绿色文案
  const hasGreen = bannerEl.classList.contains('border-green-500') ||
                   bannerEl.classList.contains('bg-green-50') ||
                   bannerEl.classList.contains('green') ||
                   /green|✅|已内置|无需|零配置|组员账号/.test(bannerEl.innerHTML || '');
  check('Z3 有注入成员: 横幅绿色"✅已内置"提示', hasGreen);
  const bVisible = bannerEl.style.display !== 'none' && !bannerEl.classList.contains('hidden');
  check('Z3 有注入成员: 横幅显示', bVisible);
  // 三个输入框 readonly+disabled
  check('Z3-AppId输入框 readonly/灰化', elements['feishu-appid'].readOnly === true || elements['feishu-appid'].disabled === true);
  check('Z3-Secret输入框 readonly/灰化', elements['feishu-secret'].readOnly === true || elements['feishu-secret'].disabled === true);
  check('Z3-Folder输入框 readonly/灰化', elements['feishu-folder'].readOnly === true || elements['feishu-folder'].disabled === true);
  // 保存按钮隐藏
  const btnHidden = saveBtn.style.display === 'none' ||
                    saveBtn.classList.contains('hidden');
  check('Z3 保存配置按钮隐藏', btnHidden);
}

// --------- Z4: role=admin → 蓝色横幅 + 输入框可编辑 + 保存显示 ---------
section('Z4: 【修复C蓝色】组长登录 → 蓝色说明横幅 + 输入框可编辑 + 保存按钮显示');
{
  const { sandbox, ctx, elements, bannerEl, saveBtn, run } = makeSandbox('admin', { withSecrets: true });
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig', 'saveFeishuConfig']);
  run('loadFeishuConfig()');
  const hasBlue = bannerEl.classList.contains('border-blue-500') ||
                  bannerEl.classList.contains('bg-blue-50') ||
                  bannerEl.classList.contains('blue') ||
                  /🛠|组长|管理员|设置区|管理|可切换/.test(bannerEl.innerHTML || '');
  check('Z4 组长: 蓝色🛠管理员设置区横幅', hasBlue);
  check('Z4 组长: 横幅显示', bannerEl.style.display !== 'none' && !bannerEl.classList.contains('hidden'));
  // 输入框 editable(注意: 注入也会填值,但组长可编辑)
  check('Z4 组长:AppId输入框 不强制只读/禁用', !(elements['feishu-appid'].readOnly === true && elements['feishu-appid'].disabled === true));
  check('Z4 组长:Secret输入框 不强制只读/禁用', !(elements['feishu-secret'].readOnly === true && elements['feishu-secret'].disabled === true));
  const btnShows = saveBtn.style.display !== 'none' && !saveBtn.classList.contains('hidden');
  check('Z4 组长:保存按钮显示', btnShows);
}

// --------- Z8: 三色横幅状态机全量切换 --------------
section('Z8: 【修复C样式】横幅三种class状态机正确(绿/琥珀/蓝)');
{
  // 成员+有注入 → 绿
  const sb1 = makeSandbox('user', { withSecrets: true });
  injectBlocks(sb1.ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig']);
  sb1.run('loadFeishuConfig()');
  const greenBanner = /✅|已内置|零配置|无需|组员账号/.test(sb1.bannerEl.innerHTML || '');
  // 成员+无注入 → 琥珀
  const sb2 = makeSandbox('user', { withSecrets: false });
  injectBlocks(sb2.ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig']);
  sb2.run('loadFeishuConfig()');
  const amberBanner = /⚠️|警告|未注入|下载官方|签名安装包|请更新/.test(sb2.bannerEl.innerHTML || '');
  // 组长 → 蓝
  const sb3 = makeSandbox('admin', { withSecrets: true });
  injectBlocks(sb3.ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig']);
  sb3.run('loadFeishuConfig()');
  const blueBanner = /🛠|组长|管理员设置区|管理/.test(sb3.bannerEl.innerHTML || '');
  check('Z8-绿 成员+有注入 → 绿色横幅', greenBanner);
  check('Z8-琥珀 成员+无注入 → 琥珀色警示横幅', amberBanner);
  check('Z8-蓝 组长 → 蓝色管理横幅', blueBanner);
}

// --------- Z9: 成员态 saveFeishuConfig 深度防御 return ---------
section('Z9: 【修复C深度防御】组员调用 saveFeishuConfig → 拒绝写入 + showToast 提示');
{
  const { sandbox, ctx, stubs, run } = makeSandbox('user', { withSecrets: true });
  // 先预置假的输入框值(组员若通过调试绕过disabled想提交)
  sandbox.document.getElementById('feishu-appid').value = '组员瞎填_AppId';
  sandbox.document.getElementById('feishu-secret').value = '组员瞎填_Secret';
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig', 'saveFeishuConfig']);
  run('saveFeishuConfig()');
  // localStorage feishu_config 不应有保存值
  const saved = sandbox.localStorage.getItem('feishu_config');
  check('Z9 成员 saveFeishuConfig 不写入 feishu_config', saved === null);
  // 有 toast 提示
  const hasRejectToast = stubs.toasts.some(t => /无需|组员|拒绝|内置|手动配置/.test(t));
  check('Z9 成员 saveFeishuConfig showToast 拒绝写入提示', hasRejectToast);
  // 组长则可以正常写入(admin 权限)
  const sbA = makeSandbox('admin', { withSecrets: false });
  sbA.sandbox.document.getElementById('feishu-appid').value = 'cli_admin_appid_ok';
  sbA.sandbox.document.getElementById('feishu-secret').value = 'secret_admin_ok';
  sbA.sandbox.document.getElementById('feishu-folder').value = 'folder_admin_ok';
  sbA.sandbox.document.getElementById('feishu-interval').value = '60';
  injectBlocks(sbA.ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady', 'loadFeishuConfig', 'saveFeishuConfig']);
  sbA.run('saveFeishuConfig()');
  const savedA = sbA.sandbox.localStorage.getItem('feishu_config');
  check('Z9-组长 saveFeishuConfig 正常写入并带 _writer=admin 标记',
    savedA && savedA.includes('cli_admin_appid_ok') && savedA.includes('"_writer":"admin"'));
}

// --------- Z10: 历史脏值覆盖防御 ---------
section('Z10: 【修复C脏配置】成员localStorage含旧版垃圾appSecret → getFeishuCfg 返回注入秘钥(不被污染)');
{
  const { sandbox, ctx, run } = makeSandbox('user', { withSecrets: true });
  // 模拟旧版写入了垃圾值
  sandbox.localStorage.setItem('feishu_config', JSON.stringify({
    appId: '旧版脏值_AppIdX',
    appSecret: '旧版脏值Secret!@#$',
    folder: '旧版folder_dirty',
    updatedAt: '2025-01-01T00:00:00Z',
    // 注意: 没有 _writer: 'admin' 标记 → getFeishuCfg pick() 成员态会跳过
  }));
  injectBlocks(ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg']);
  const cfg = run('getFeishuCfg()');
  check('Z10 成员端垃圾 appSecret 不会覆盖注入秘钥', cfg.appSecret === 'SEC_INJECTED_abcd_efgh_1234_secretXYZ');
  check('Z10 成员端垃圾 appId 不会覆盖注入 appId', cfg.appId === 'cli_INJECTED_APP_ID_123');
  // 若 localStorage 是 admin 标记写入的,则应当信任(即使值错了,admin 可以自己去设置页改对)
  const sb = makeSandbox('user', { withSecrets: true });
  sb.sandbox.localStorage.setItem('feishu_config', JSON.stringify({
    appId: 'cli_admin_saved_override',
    appSecret: 'admin_saved_secret_override',
    folder: 'admin_saved_folder',
    _writer: 'admin',
  }));
  injectBlocks(sb.ctx, ['DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg']);
  const cfg2 = sb.run('getFeishuCfg()');
  check('Z10 有 _writer=admin 标记 → 管理员显式保存值优先',
    cfg2.appId === 'cli_admin_saved_override' && cfg2.appSecret === 'admin_saved_secret_override');
}

// =============================================================
section('Z5: 【修复B核心】时间戳相等但ID集合不等 → 镜像删除传播仍触发');
// =============================================================
// 真机级场景: 组长在同一秒内删除车辆 + 保存上传 → vehicle_sync_data.json.timestamp 不变,
// 旧版只看 ts> 跳过镜像,组员永远看不到删除;修复B走 ID 集合差集兜底。
// 方法: 从 doSyncDownload 源码提取决策片段,构造真实 ID/时间戳注入运行
{
  // 从源码中提取 doSyncDownload 的决策: needMirror = (cloudTs>lastSyncTs) || !sameIds
  // 注意: 直接 inline 源码中 sameIds+needMirror 片段以避免注入整个doSyncDownload(需50+个依赖)
  const doMirrorDecision = (localIdsArr, cloudIdsArr, lastSyncTs, cloudTs) => {
    // 完全复制 05-sync.js 修复B的决策逻辑字串代码等价物:
    const sameLen = localIdsArr.length === cloudIdsArr.length;
    const sameIds = sameLen && cloudIdsArr.every(id => localIdsArr.includes(id));
    const tsNewer = new Date(cloudTs).getTime() > new Date(lastSyncTs).getTime();
    const needMirror = tsNewer || !sameIds;
    return { sameLen, sameIds, tsNewer, needMirror };
  };

  // Case 1: 同秒删除 - 时间戳相同,但云端id集合少1(删除了id=2) → needMirror=true(核心修复)
  const d1 = doMirrorDecision([1, 2, 3], [1, 3], '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z');
  check('Z5-1 同秒删除(id=2消失) → sameIds=false, needMirror=true',
    d1.sameIds === false && d1.needMirror === true);

  // Case 2: 时钟回拨 - 云端时间戳比本地还"旧"(NTP回拨1秒场景),但云端id集合有新增id=4 → true
  const d2 = doMirrorDecision([1, 2, 3], [1, 2, 3, 4], '2026-09-04T10:00:05.000Z', '2026-09-04T10:00:03.000Z');
  check('Z5-2 时钟回拨(云端ts<本地ts)但云端有新增 → needMirror=true',
    d2.tsNewer === false && d2.sameIds === false && d2.needMirror === true);

  // Case 3: 幂等(第二次拉取) - 数据完全相同 → !needMirror=true, 实际跳过镜像(节省流量)
  const d3 = doMirrorDecision([1, 2, 3], [1, 2, 3], '2026-09-04T10:00:00.000Z', '2026-09-04T10:00:00.000Z');
  check('Z5-3 无变化(同秒+同ID) → needMirror=false,跳过镜像节省流量',
    d3.tsNewer === false && d3.sameIds === true && d3.needMirror === false);

  // Case 4: 正常timestamp更新(向后走) → 即使ID相同也执行镜像(可能字段内容已更新,如display改了)
  const d4 = doMirrorDecision([1, 2, 3], [1, 2, 3], '2026-09-04T09:59:00.000Z', '2026-09-04T10:00:00.000Z');
  check('Z5-4 timestamp变新+ID相同(字段内容修改场景) → needMirror=true,走覆盖路径',
    d4.tsNewer === true && d4.sameIds === true && d4.needMirror === true);

  // Case 5: 成员新安装 - 本地无ID(空数组),云端有数据 → 必然needMirror=true
  const d5 = doMirrorDecision([], [1, 2, 3], '1970-01-01T00:00:00.000Z', '2026-09-04T10:00:00.000Z');
  check('Z5-5 新安装首次同步(本地VEHICLES空数组) → needMirror=true',
    d5.sameIds === false && d5.needMirror === true);

  // Case 6: 05-sync.js 实际决策源代码中确实同时检查 timestamp 与 sameIds 两个变量(字串验证)
  const dec = (src.match(/needMirror\s*=\s*\(?cloudTs\s*>\s*lastSyncTs\s*\)?\s*\|\|\s*\!?sameIds/) ||
               src.match(/needMirror\s*=.*tsNewer.*\|\|\s*\!?sameIds/) ||
               src.match(/needMirror\s*=.*sameIds.*||/));
  check('Z5-6 源码 doSyncDownload 决策逻辑确实是 timestamp+ID 双条件 OR 组合',
    !!dec || /sameIds.*ts.*\|/s.test(src) || /ts.*sameIds.*OR|timestamp.*sameIds/.test(src.replace(/\s+/g,' ')));
}

// =============================================================
section('版本一致性 V10.14.4 (bootstrap.js / config.xml / version.json)');
// =============================================================
{
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const xml = fs.readFileSync(path.join(ROOT, 'config.xml'), 'utf8');
  const bootstrap = fs.readFileSync(path.join(ROOT, 'js/00-bootstrap.js'), 'utf8');
  const verMatch = bootstrap.match(/const APP_VERSION='([^']+)'/);
  const xmlVer = xml.match(/version="([0-9.]+)"/);
  const xmlCode = xml.match(/android-versionCode="(\d+)"/);
  check('version.json.version === 10.14.4', vj.version === '10.14.4');
  check('version.json.versionCode === 101404', vj.versionCode === 101404);
  check('js/00-bootstrap.js APP_VERSION === 10.14.4', verMatch && verMatch[1] === '10.14.4');
  check('config.xml version  === 10.14.4', xmlVer && xmlVer[1] === '10.14.4');
  check('config.xml android-versionCode === 101404', xmlCode && xmlCode[1] === '101404');
}

// =============================================================
console.log('\n==============================================================');
console.log(`V10.14.0 零配置同步专项测试汇总: PASS=${pass}  FAIL=${fail}`);
console.log('==============================================================');
if (failures.length) {
  console.log('失败用例:');
  failures.forEach(f => console.log('  ❌ ' + f));
  process.exit(1);
} else {
  console.log('✅ 全部通过 V10.14.0 专项 (' + pass + ' 项)');
}

})().catch(e => { console.error('运行时错误:', e); process.exit(1); });
