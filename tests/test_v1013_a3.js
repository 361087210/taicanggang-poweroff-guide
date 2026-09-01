/**
 * ============================================================
 * test_v1013_a3.js - V10.13.0 复杂度治理(方案A Phase A3) 测试
 * ============================================================
 * 覆盖矩阵:
 *  A组 静态结构: pullPendingFromFeishu 四刀切编排薄壳 / filterVehicles+
 *      renderVehicleCards 拆分存在 / State 守卫API齐全 / 写入点收敛
 *      (push/splice 仅存于 State 内部) / XSS绊线源码标记
 *  B组 State行为: 只读副本 / addVehicle(创建语义+持久化) /
 *      updateVehicle / removeVehicle / replaceVehicles / promoteToLeader抛错
 *  C组 渲染业务分离: filterVehicles 纯函数过滤正确性 / renderVehicleCards
 *      平铺与树形拼装
 *  D组 审批四刀: applyApprovalRules(跨网络默认通过+本端pending+已拒绝保留+
 *      幂等) / writePendingsToStorage / refreshMemberUI(三态文案)
 *  E组 编排链路: pullPendingFromFeishu 全链(双位置收集→规则→落盘→渲染)
 *      + 自愈重试(首次token失败→invalidate→retryToken成功)
 *  F组 XSS绊线: 非cordova安装 / 风险片段warn / 严格模式抛错 /
 *      合法onclick不误报 / cordova环境不安装
 *  G组 版本一致性: version.json === APP_VERSION === config.xml
 *
 * 运行: node tests/test_v1013_a3.js
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

// ---------- 通用: 构造带 State 的业务沙箱 ----------
function makeSandbox(extra) {
  const stubs = { persists: 0, savedUsers: 0, renders: 0, badges: 0, toasts: [], logs: [], notifies: [], debounces: 0, deletes: [] };
  const sandbox = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    localStorage: { _m: new Map(), getItem(k) { return this._m.has(k) ? this._m.get(k) : null; }, setItem(k, v) { this._m.set(k, String(v)); }, removeItem(k) { this._m.delete(k); } },
    setTimeout, clearTimeout, AbortController,
    VEHICLES: [], USERS: [],
    BRANDS: [{ id: 'bx', name: '品牌X', en: 'BrandX' }, { id: 'by', name: '品牌Y' }],
    getPinyin: s => s,
    persistVehicles: () => { stubs.persists++; },
    saveUsers: u => { stubs.savedUsers++; sandbox.localStorage.setItem('tcg_users', JSON.stringify(u)); },
    renderMemberList: () => { stubs.renders++; },
    updateMembersBadge: () => { stubs.badges++; },
    showToast: m => stubs.toasts.push(String(m)),
    addSyncLog: (m, c) => stubs.logs.push({ m, c }),
    leaderNotify: (t, b) => stubs.notifies.push({ t, b }),
    _debouncePushApprovedUsers: () => { stubs.debounces++; },
    deletePendingFileFromFeishu: async phone => { stubs.deletes.push(phone); },
    invalidateDataFolderCache: () => { stubs.invalidated = (stubs.invalidated || 0) + 1; },
    state: { searchQuery: '', brandFilter: 'all', viewMode: 'flat', expandedBrands: new Set(), currentUser: null },
  };
  Object.assign(sandbox, extra || {});
  sandbox.window = sandbox; // 无cordova → 非原生路径
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { sandbox, ctx, stubs, run: expr => vm.runInContext(expr, ctx, { filename: 'v1013_eval.js' }) };
}

function injectBlocks(ctx, names) {
  for (const n of names) {
    vm.runInContext(extractNamedBlock(src, n), ctx, { filename: 'v1013#' + n + '.js' });
  }
}

(async function main() {

// =============================================================
section('A组: 静态结构(A3四刀切/渲染分离/State守卫/写入点收敛)');
// =============================================================
check('A1 四刀切四函数均为顶层声明', [
  'function fetchPendingFromCloud(', 'async function applyApprovalRules(',
  'function writePendingsToStorage(', 'function refreshMemberUI(',
].every(s => src.includes(s)));

// pullPendingFromFeishu 编排薄壳: 仅四步编排, 无内联IO/无USERS直写
const orch = extractNamedBlock(src, 'pullPendingFromFeishu');
const orchBodyLines = orch.split('\n').filter(l => l.trim() && !l.trim().startsWith('//') && !l.trim().startsWith('*')).length;
check('A2 pullPendingFromFeishu 薄壳化(≤26有效行)', orchBodyLines <= 26);
check('A3 薄壳按序调用四函数', ['await fetchPendingFromCloud(cfg)', 'applyApprovalRules(await fetchPendingFromCloud', 'writePendingsToStorage(result', 'refreshMemberUI(result']
  .every(s => orch.includes(s)));
check('A4 薄壳不再内联业务/IO(无USERS直写/无裸fetch/无saveUsers直调)', !/USERS\.|await fetch\(|saveUsers\(/.test(orch));
check('A5 自愈重试保留(invalidateDataFolderCache+retryToken)', orch.includes('invalidateDataFolderCache()') && orch.includes('{retryToken:true}'));

check('A6 filterVehicles纯函数存在(显式入参)', /function filterVehicles\(keyword,brandId\)/.test(src));
const gfv = extractNamedBlock(src, 'getFilteredVehicles');
check('A7 getFilteredVehicles 退化为state桥接', gfv.includes('filterVehicles(state.searchQuery,state.brandFilter)') && gfv.split('\n').length <= 6);
check('A8 renderVehicleCards 纯DOM拼装存在', /function renderVehicleCards\(list\)/.test(src));
check('A9 renderVehicleList 仅委托拼装(c.innerHTML=renderVehicleCards(list))', src.includes('c.innerHTML=renderVehicleCards(list)'));

check('A10 State守卫API齐全(副本getter+增删改+提权tripwire)', [
  'get vehicles(){return VEHICLES.slice();}', 'get users(){return USERS.slice();}',
  'addVehicle(data){', 'pushVehicle(v){', 'replaceVehicles(list){',
  'updateVehicle(id,patch){', 'removeVehicle(id){', 'addUser(u){', 'removeUser(phone){',
  'promoteToLeader(){throw new Error',
].every(s => src.includes(s)));

// 写入点收敛: 全仓(js/) VEHICLES/USERS 结构性写仅存在于 01-state.js 的 State 内部
const jsDir = path.join(ROOT, 'js');
let combined = '';
for (const f of fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort()) {
  combined += fs.readFileSync(path.join(jsDir, f), 'utf8') + '\n';
}
const countOf = (re) => (combined.match(re) || []).length;
check('A11 VEHICLES.push 仅存于State内部(3处: addVehicle/pushVehicle/replaceVehicles)', countOf(/VEHICLES\.push/g) === 3);
check('A12 VEHICLES.splice/length=0 仅存于State内部(1+1处)', countOf(/VEHICLES\.splice/g) === 1 && countOf(/VEHICLES\.length=0/g) === 1);
check('A13 USERS.push/splice 仅存于State内部(1+1处)', countOf(/USERS\.push/g) === 1 && countOf(/USERS\.splice/g) === 1);
check('A14 XSS绊线源码标记存在(__innerHTMLGuardInstalled__/__XSS_GUARD_STRICT__)', src.includes('__innerHTMLGuardInstalled__') && src.includes('__XSS_GUARD_STRICT__'));

// =============================================================
section('B组: State守卫行为(副本/增删改/防提权)');
// =============================================================
{
  const sb = makeSandbox();
  injectBlocks(sb.ctx, ['State']);
  sb.run('VEHICLES.push({id:1,display:"A",pinyin:"A",series:"S",brand:"品牌X",brandId:"bx",position:"P",photoPaths:[],videoPaths:[]});USERS.push({phone:"13800000000",name:"u0",status:"active"})');
  check('B1 State.vehicles 返回副本(外部改动不污染)', sb.run('(function(){const c=State.vehicles;c.push({id:999});return VEHICLES.length===1&&c.length===2;})()'));
  check('B2 State.users 返回副本', sb.run('(function(){const c=State.users;c.pop();return USERS.length===1&&c.length===0;})()'));
  const created = sb.run('State.addVehicle({brand:"品牌Y",series:"S2",config:"C",display:"越野B",size:"5米",position:"舱内",steps:[],keyFrame:[],keyContainer:[],remarks:"",photoPaths:["a.jpg"],videoPaths:[]})');
  check('B3 addVehicle id自增+brandId映射+兜底字段', created.id === 2 && created.brandId === 'by' && created.powerType === '纯电' && Array.isArray(created.steps) && created.steps.length === 1 && created.pinyin === '越野B');
  check('B4 addVehicle photos/videos计数+持久化1次', created.photos === 1 && created.videos === 0 && sb.stubs.persists === 1);
  check('B5 addVehicle 究竟入列(VEHICLES.length=2)', sb.run('VEHICLES.length') === 2);
  const up = sb.run('State.updateVehicle(2,{display:"越野B2"})');
  check('B6 updateVehicle 合并+持久化', up && up.display === '越野B2' && sb.stubs.persists === 2);
  check('B7 updateVehicle 未命中→null(不抛错)', sb.run('State.updateVehicle(999,{x:1})') === null);
  check('B8 removeVehicle 命中→true并出列+持久化', sb.run('(function(){const ok=State.removeVehicle(2);return ok&&VEHICLES.length===1&&VEHICLES[0].id===1;})()') && sb.stubs.persists === 3);
  check('B9 removeVehicle 未命中→false', sb.run('State.removeVehicle(999)') === false);
  check('B10 replaceVehicles 原地整体替换(引用不变)', sb.run('(function(){const ref=VEHICLES;const n=State.replaceVehicles([{id:7},{id:8}]);return ref===VEHICLES&&n===2&&VEHICLES[1].id===8;})()'));
  check('B11 pushVehicle 追加不持久化(调用方统一persist)', sb.run('(function(){State.pushVehicle({id:9});return VEHICLES.length===3;})()') && sb.stubs.persists === 3);
  check('B12 addUser 入列', sb.run('(function(){State.addUser({phone:"13900000000",status:"pending"});return USERS.length===2;})()'));
  check('B13 removeUser 按手机号删除', sb.run('(function(){const ok=State.removeUser("13900000000");return ok&&USERS.length===1;})()'));
  let threw = false;
  try { sb.run('State.promoteToLeader()'); } catch (e) { threw = true; }
  check('B14 promoteToLeader 抛错拒绝前端提权', threw);
}

// =============================================================
section('C组: 渲染/业务分离(filterVehicles纯函数 + renderVehicleCards)');
// =============================================================
{
  const sb = makeSandbox();
  injectBlocks(sb.ctx, ['esc', 'State', 'filterVehicles', 'renderVehicleCard', 'renderVehicleCards', 'getFilteredVehicles']);
  sb.run('VEHICLES.push({id:1,display:"轿车A",pinyin:"jiaocheA",series:"S1",brand:"品牌X",brandId:"bx",position:"甲板",steps:["step1"],keyFrame:["k1"],keyContainer:["c1"],photoPaths:[],videoPaths:[]},{id:2,display:"越野B",pinyin:"yueyeB",series:"S2",brand:"品牌Y",brandId:"by",position:"舱内",steps:["step1"],keyFrame:["k1"],keyContainer:["c1"],photoPaths:[],videoPaths:[]},{id:3,display:"自定义C",pinyin:"zidingyiC",series:"S3",brand:"品牌Z",brandId:"custom_z",position:"甲板",steps:["step1"],keyFrame:["k1"],keyContainer:["c1"],photoPaths:[],videoPaths:[]})');
  check('C1 filterVehicles 全量(all)=3条', sb.run('filterVehicles("","all").length') === 3);
  check('C2 filterVehicles 关键词命中display', sb.run('filterVehicles("轿车","all").map(v=>v.id).join()') === '1');
  check('C3 filterVehicles 关键词命中拼音', sb.run('filterVehicles("yueye","all").length') === 1);
  check('C4 filterVehicles brandId过滤', sb.run('filterVehicles("","by").map(v=>v.id).join()') === '2');
  check('C5 filterVehicles __other__自定义品牌兜底', sb.run('filterVehicles("","__other__").map(v=>v.id).join()') === '3');
  check('C6 filterVehicles 组合(关键词×品牌)为空安全', sb.run('filterVehicles("轿车","by").length') === 0);
  check('C7 getFilteredVehicles 经state桥接一致', sb.run('(function(){state.searchQuery="越野";const r=getFilteredVehicles().length;state.searchQuery="";return r;})()') === 1);
  const flatHtml = sb.run('renderVehicleCards(VEHICLES.slice())');
  check('C8 平铺模式: 卡片流含详情入口', typeof flatHtml === 'string' && flatHtml.includes('openVehicleDetail(1)') && flatHtml.includes('openVehicleDetail(3)'));
  const treeHtml = sb.run('(function(){state.viewMode="tree";state.expandedBrands=new Set(["bx"]);return renderVehicleCards(VEHICLES.slice());})()');
  check('C9 树形模式: 品牌分组+系列行+展开内容', treeHtml.includes('品牌X') && treeHtml.includes("toggleBrand('bx')") && treeHtml.includes('S1'));
  check('C10 树形模式: 未展开品牌不渲染卡片体', !treeHtml.includes('openVehicleDetail(2)'));
}

// =============================================================
section('D组: 审批四刀(规则/落盘/渲染三态)');
// =============================================================
{
  const sb = makeSandbox();
  injectBlocks(sb.ctx, ['State', 'applyApprovalRules', 'writePendingsToStorage', 'refreshMemberUI']);
  const rulesOnce = () => sb.run('applyApprovalRules(['
    + '{source:"react-web",user:{phone:"13800000001",name:"跨网络"}},'
    + '{source:"tcg-cordova",user:{phone:"13800000002",name:"本端"}}'
    + '])');
  const res1 = await rulesOnce();
  check('D1 跨网络默认通过(active+crossPlatform+hidden)+本端pending计数', res1.newCount === 1 && res1.crossSilentCount === 1 && res1.changed === true);
  check('D2 跨网络用户入列且隐形标记齐全', sb.run('(function(){const u=USERS.find(u=>u.phone==="13800000001");const l=USERS.find(u=>u.phone==="13800000002");return u.status==="active"&&u.hidden===true&&u.crossPlatform===true&&l.status==="pending";})()'));
  check('D3 即消费即删: 跨网络申请云端文件被删除', sb.stubs.deletes.includes('13800000001') && !sb.stubs.deletes.includes('13800000002'));
  const res2 = await rulesOnce();
  check('D4 规则幂等(重复载荷不重复计数/不重复入列)', res2.newCount === 0 && res2.crossSilentCount === 0 && sb.run('USERS.length') === 2);
  sb.run('USERS.find(u=>u.phone==="13800000002").status="rejected"');
  const res3 = await sb.run('applyApprovalRules([{source:"tcg-cordova",user:{phone:"13800000002",name:"本端"}}])');
  check('D5 已拒绝账号保留拒绝状态(不复活)', res3.newCount === 0 && sb.run('USERS.find(u=>u.phone==="13800000002").status') === 'rejected');
  sb.stubs.savedUsers = 0;
  check('D6 writePendingsToStorage changed=false不落盘', sb.run('writePendingsToStorage({newCount:0,crossSilentCount:0,changed:false})') === false && sb.stubs.savedUsers === 0);
  check('D7 writePendingsToStorage changed=true落盘tcg_users', sb.run('writePendingsToStorage({newCount:1,crossSilentCount:0,changed:true})') === true && sb.stubs.savedUsers === 1 && !!sb.sandbox.localStorage.getItem('tcg_users'));
  sb.stubs.toasts.length = 0; sb.stubs.notifies.length = 0; sb.stubs.logs.length = 0;
  sb.run('refreshMemberUI({newCount:2,crossSilentCount:1,changed:true},false)');
  check('D8 非静默: 列表+徽标+组长通知+同步日志+云端回推去抖', sb.stubs.renders >= 1 && sb.stubs.badges >= 1 && sb.stubs.notifies.length === 1 && sb.stubs.logs.length === 1 && sb.stubs.debounces === 1);
  check('D9 非静默文案', sb.stubs.toasts.some(t => t.includes('从飞书拉取2条待审核注册')));
  sb.stubs.toasts.length = 0; sb.stubs.notifies.length = 0; sb.stubs.logs.length = 0; sb.stubs.debounces = 0;
  sb.run('refreshMemberUI({newCount:1,crossSilentCount:0,changed:true},true)');
  check('D10 静默(轮询): 仅Toast+日志, 不推系统通知', sb.stubs.toasts.some(t => t.includes('收到1条新的组员注册申请')) && sb.stubs.notifies.length === 0 && sb.stubs.logs.length === 1);
  sb.stubs.toasts.length = 0; sb.stubs.notifies.length = 0; sb.stubs.logs.length = 0;
  sb.run('refreshMemberUI({newCount:1,crossSilentCount:0,changed:true},false,true)');
  check('D11 自愈路径: 沿用原自愈文案(仅Toast, 无日志/无通知)', sb.stubs.toasts.some(t => t.includes('收到1条新注册申请，请审核')) && sb.stubs.notifies.length === 0 && sb.stubs.logs.length === 0);
  check('D12 无变更不渲染(refreshMemberUI changed=false→false)', sb.run('refreshMemberUI({newCount:0,crossSilentCount:0,changed:false},false)') === false);
}

// =============================================================
section('E组: pullPendingFromFeishu 编排链路(双位置收集+自愈重试)');
// =============================================================
function buildPullSandbox(opts) {
  const sb = makeSandbox();
  injectBlocks(sb.ctx, ['State', 'fetchPendingFromCloud', 'applyApprovalRules', 'writePendingsToStorage', 'refreshMemberUI', 'pullPendingFromFeishu']);
  const bodies = {
    t1: JSON.stringify({ type: 'pending_registration', source: 'react-web', user: { phone: '13800000001', name: '跨网络' } }),
    t2: JSON.stringify({ type: 'pending_registration', source: 'tcg-cordova', user: { phone: '13800000002', name: '本端' } }),
    t3: JSON.stringify({ type: 'pending_registration', source: 'tcg-cordova', user: { phone: '13800000003', name: '去重件' } }),
  };
  sb.sandbox.fetch = (url) => {
    const m = /files\/([^/]+)\/download/.exec(url);
    const body = m && bodies[m[1]];
    if (!body) return Promise.resolve({ ok: false, status: 404, text: async () => 'not found' });
    return Promise.resolve({ ok: true, status: 200, text: async () => body });
  };
  sb.sandbox.getFeishuCfg = () => ({ pendingSub: '注册申请' });
  sb.sandbox.feishuCfgReady = () => true;
  let tokenCalls = 0;
  sb.sandbox.getFeishuToken = async (cfg, retry) => {
    tokenCalls++;
    if (opts.failFirstToken && tokenCalls === 1 && !retry) throw new Error('token first fail');
    return 'tok' + tokenCalls;
  };
  sb.sandbox.getDataSubFolderToken = async () => 'subTok';
  sb.sandbox.getDataFolderToken = async () => 'rootTok';
  sb.sandbox.feishuListFiles = async (token, folder) => {
    if (folder === 'subTok') return [{ name: 'pending_reg_13800000001.json', token: 't1' }];
    if (folder === 'rootTok') return [{ name: 'pending_reg_13800000002.json', token: 't2' }, { name: 'pending_reg_13800000001.json', token: 't3' }, { name: 'readme.txt', token: 't9' }];
    return [];
  };
  return sb;
}
{
  // E1 主链路(非静默)
  const sb = buildPullSandbox({});
  const n = await sb.run('pullPendingFromFeishu(false)');
  check('E1 全链返回新申请数(跨网络1+本端1=2)', n === 2);
  check('E2 双位置收集+按文件名去重(仅t1/t2下载, t3/t9忽略)', sb.run('USERS.map(u=>u.phone).sort().join()') === '13800000001,13800000002');
  check('E3 落盘+渲染+组长通知+云端回推去抖', sb.stubs.savedUsers >= 1 && sb.stubs.renders >= 1 && sb.stubs.notifies.length === 1 && sb.stubs.debounces === 1);
  check('E4 跨网络即消费即删(仅13800000001)', sb.stubs.deletes.join() === '13800000001');
  const n2 = await sb.run('pullPendingFromFeishu(false)');
  check('E5 二轮幂等(重复文件不再计数/不再通知)', n2 === 0 && sb.stubs.notifies.length === 1);
}
{
  // E6 静默模式文案
  const sb = buildPullSandbox({});
  const n = await sb.run('pullPendingFromFeishu(true)');
  check('E6 静默轮询: Toast+同步日志(仅计本端1条,跨网络隐形), 无组长通知', n === 2 && sb.stubs.toasts.some(t => t.includes('收到1条新的组员注册申请')) && sb.stubs.notifies.length === 0 && sb.stubs.logs.length === 1);
}
{
  // E7 自愈重试: 首次token失败→invalidate→retryToken成功→仍全量处理
  const sb = buildPullSandbox({ failFirstToken: true });
  const n = await sb.run('pullPendingFromFeishu(false)');
  check('E7 自愈重试成功(结果与主链一致=2)', n === 2);
  check('E8 自愈触发invalidateDataFolderCache一次', sb.stubs.invalidated === 1);
  check('E9 自愈路径文案(收到N条新注册申请，请审核, 无组长通知)', sb.stubs.toasts.some(t => t.includes('收到1条新注册申请，请审核')) && sb.stubs.notifies.length === 0);
  check('E10 自愈路径跨网络同样计数/落盘/回推(A3归并防丢档)', sb.stubs.debounces === 1 && sb.stubs.savedUsers >= 1);
}

// =============================================================
section('F组: XSS绊线(开发模式innerHTML守卫)');
// =============================================================
function extractGuardBlock() {
  const mark = '// ===================== XSS 绊线 (V10.13 A3-4) =====================';
  const start = src.indexOf(mark);
  assert(start >= 0, '未找到绊线源码标记');
  const end = src.indexOf('\n}', start); // if块收尾(列0的})
  return src.slice(start, end + 2);
}
function guardSandbox(cordova) {
  const warns = [], errors = [];
  const sandbox = {
    console: { warn: m => warns.push(String(m)), error: m => errors.push(String(m)), log: () => {} },
    Element: class Element { },
    setTimeout, clearTimeout,
  };
  if (cordova) sandbox.cordova = cordova;
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  return { sandbox, ctx, warns, errors, run: e => vm.runInContext(e, ctx, { filename: 'v1013_guard.js' }) };
}
{
  const guard = extractGuardBlock();
  // F1-F5 安装+默认warn+严格模式
  const sb = guardSandbox(null);
  sb.run('Object.defineProperty(Element.prototype,"innerHTML",{set:function(v){this._h=v;},get:function(){return this._h;},configurable:true})');
  sb.run(guard);
  check('F1 非cordova环境绊线已安装', sb.run('!!window.__innerHTMLGuardInstalled__'));
  const setHtml = v => sb.run('(function(){const el=new Element();try{el.innerHTML=' + JSON.stringify(v) + ';}catch(e){return "THROWN:"+e.message;}return "SET";})()');
  const r1 = setHtml('<div onclick="openVehicleDetail(1)">正常卡片</div>');
  check('F2 合法onclick模板不误报不阻断', r1 === 'SET' && sb.warns.length === 0);
  const r2 = setHtml('<div>ok</div><script>alert(1)<\/script>');
  check('F3 <script注入→warn留痕且写入继续(默认非阻断)', r2 === 'SET' && sb.warns.length === 1 && sb.warns[0].includes('XSS绊线'));
  const r3 = setHtml('<a href="javascript:alert(1)">x</a>');
  check('F4 javascript:伪协议→warn留痕', r3 === 'SET' && sb.warns.length === 2);
  sb.run('window.__XSS_GUARD_STRICT__=true');
  const r4 = setHtml('<script>x<\/script>');
  check('F5 严格模式: 风险写入抛错阻断', typeof r4 === 'string' && r4.startsWith('THROWN:') && r4.includes('strict mode'));
  // F6 cordova环境不安装(生产零开销)
  const sb2 = guardSandbox({});
  sb2.run('Object.defineProperty(Element.prototype,"innerHTML",{set:function(v){this._h=v;},get:function(){return this._h;},configurable:true})');
  sb2.run(guard);
  check('F6 cordova环境绊线不安装', sb2.run('!window.__innerHTMLGuardInstalled__'));
}

// =============================================================
section('G组: 版本一致性(三处对齐)');
// =============================================================
{
  const vj = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const appVer = extractNamedBlock(src, 'APP_VERSION').match(/'([^']+)'/)[1];
  const cfgXml = fs.readFileSync(path.join(ROOT, 'config.xml'), 'utf8');
  const mCfg = /version="([^"]+)"\s+android-versionCode="(\d+)"/.exec(cfgXml);
  check('G1 version.json === APP_VERSION === config.xml (10.13.0)', vj.version === '10.13.0' && appVer === '10.13.0' && !!mCfg && mCfg[1] === '10.13.0');
  check('G2 versionCode三处对齐(101300)', vj.versionCode === 101300 && !!mCfg && Number(mCfg[2]) === 101300);
}

// ---------- 汇总 ----------
console.log('\n==============================================================');
console.log(`结果: ${pass} 通过 / ${fail} 失败`);
if (fail > 0) { failures.forEach(f => console.log('  ✗ ' + f)); process.exitCode = 1; }
else console.log('V10.13.0 A3 复杂度治理测试全部通过 ✓');
console.log('==============================================================');

})().catch(e => {
  console.error('[测试异常]', e);
  process.exitCode = 1;
});
