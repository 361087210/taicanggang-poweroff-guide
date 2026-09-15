/**
 * ============================================================
 * test_v1021_addvehicle_passthrough_guard.js
 * State.addVehicle 透传语义守卫(防原型污染回归)
 * ============================================================
 * 背景:
 *   V10.19.1 修复了 State.addVehicle 静默丢弃 photoSections/photoLabels/
 *   keyPhotoRemark 的缺陷(js/01-state.js)。修复引入了一行"透传":
 *       Object.keys(data).forEach(k=>{ if(!(k in v)) v[k]=data[k]; });
 *
 *   这行的**安全性完全依赖 `k in v` 走原型链**这一事实:
 *   __proto__/constructor/toString 等键必然在原型链上命中 -> 被跳过 ->
 *   不会被写成自有属性 -> 无原型污染。
 *
 *   ⚠️ 若有人"顺手优化"成下面的任一种, 就会把它变成真正的原型污染漏洞:
 *       if(!Object.prototype.hasOwnProperty.call(v,k)) v[k]=data[k];
 *       if(!v.hasOwnProperty(k)) v[k]=data[k];
 *   因为 __proto__ 不是自有属性, 改后反而满足条件, 会被 v[k]=data[k]
 *   写成自有键。源码注释已写明, 但注释挡不住手快的人 —— 故固化为测试。
 *
 * 守卫方式(双重, 互补):
 *   G1/G2 静态: 直接断言源码透传语句使用 `k in v` 且不含 hasOwnProperty
 *               —— 改动当场报错, 并给出明确原因(最快失败)
 *   G3/G4/G5 行为: 即使静态断言被绕过(如换了写法、正则失配),
 *               投毒数据实测仍能抓住真实污染(兜底)
 *
 * 其余断言(P1-P6)为该修复的回归网: 元数据保留 / 透传 no-op / 计算字段
 * 不被覆盖 / 键序稳定 / 空值行为未变。
 *
 * 运行: node tests/test_v1021_addvehicle_passthrough_guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const stateSrc = fs.readFileSync(path.join(ROOT, 'js/01-state.js'), 'utf8');

let pass = 0, fail = 0;
function check(name, ok, extra) {
  if (ok) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}  -> ${extra === undefined ? '' : JSON.stringify(extra)}`); }
}
function section(t) {
  console.log('\n========== ' + t + ' ==========');
}

/** 在 vm 中加载真实的 State 对象(带最小依赖桩) */
function makeCtx() {
  const sandbox = {
    VEHICLES: [], USERS: [], BRANDS: [{ id: 'b1', name: '比亚迪' }],
    persistVehicles() { sandbox.__persist = (sandbox.__persist || 0) + 1; },
    getPinyin(s) { return 'py_' + s; },
    window: {}, console: console, JSON: JSON, Object: Object, Array: Array,
    __persist: 0
  };
  const ctx = vm.createContext(sandbox);
  const i = stateSrc.indexOf('const State={');
  const j = stateSrc.indexOf('\n};', i);
  if (i < 0 || j < 0) throw new Error('未能在 js/01-state.js 中定位 State 对象字面量');
  vm.runInContext(stateSrc.slice(i, j + 3), ctx);
  // vm 中顶层 const 不挂到 sandbox 对象上(在词法作用域), 需回读
  return { sandbox, ctx, State: vm.runInContext('State', ctx) };
}

const BASE = {
  brand: '比亚迪', series: '唐', config: 'EV', display: '唐EV', powerType: '纯电',
  size: '4870*1950*1725', position: '前机盖', steps: ['s1'], keyFrame: ['k1'],
  keyContainer: ['c1'], remarks: 'r', photoPaths: ['p1'], videoPaths: ['v1'],
  photoSections: ['key'], photoLabels: ['钥匙'], keyPhotoRemark: '备注K'
};

// ============================================================
section('G组 透传语义守卫(静态): 必须用 in, 不得改成 hasOwnProperty');
// ============================================================
const PASSTHROUGH_LINE = (function () {
  const lines = stateSrc.split('\n');
  const start = lines.findIndex(l => /addVehicle\s*\(\s*data\s*\)\s*\{/.test(l));
  if (start < 0) return { line: null, text: null };
  for (let i = start; i < Math.min(start + 40, lines.length); i++) {
    if (/Object\.keys\(/.test(lines[i]) && /forEach/.test(lines[i])) {
      return { line: i + 1, text: lines[i] };
    }
  }
  return { line: null, text: null };
})();
{
  check('G0 能在 addVehicle 中定位透传语句', PASSTHROUGH_LINE.text !== null, PASSTHROUGH_LINE);
  const t = PASSTHROUGH_LINE.text || '';
  check('G1 透传使用 `k in v` 语义(原型链判定)', /\bin\s+v\b/.test(t), t.trim());
  check('G2 透传未使用 hasOwnProperty(改成它会引入原型污染)',
    !/hasOwnProperty/.test(t), t.trim());
}

// ============================================================
section('G组 透传语义守卫(行为): 投毒数据实测不污染');
// ============================================================
{
  // JSON.parse 可产出自有 __proto__ 键, 模拟被污染的入参
  const poisoned = JSON.parse('{"brand":"比亚迪","display":"X","series":"S","config":"C",' +
    '"size":"1*1*1","position":"P","photoPaths":[],"videoPaths":[],' +
    '"__proto__":{"polluted":true},"constructor":"HACK","toString":"HACK"}');

  const c = makeCtx();
  const before = Object.keys(Object.prototype).length;
  let v = null, threw = null;
  try { v = c.State.addVehicle(poisoned); } catch (e) { threw = e.message; }

  check('G3 投毒入参不抛错(透传路径可执行)', threw === null, threw);
  if (v) {
    /* 注意(变异测试实测): 本条**不能**作为 __proto__ 污染的 canary。
     * `v['__proto__']=X` 是 setter 语义——它改变原型, 而不会生成自有键,
     * 所以即使被污染本条仍然通过。真正的 canary 是 G5(原型被换)与
     * G6/G7(constructor/toString 被写成自有属性)。本条保留为"无自有
     * __proto__ 键"这一独立不变式。 */
    check('G4 v 上未产生自有 __proto__ 键',
      !Object.prototype.hasOwnProperty.call(v, '__proto__'),
      Object.prototype.hasOwnProperty.call(v, '__proto__'));
    // 注意: 不能直接与主 realm 的 Object.prototype 比较(跨 realm 恒不等);
    // 也不能用 vm.runInContext('Object.prototype') —— 本沙箱向 vm 注入了宿主
    // 的 Object 绑定, 取到的是宿主原型; 而对象字面量用的是 realm 的**内在**
    // %Object.prototype%。故用同 realm 新字面量取内在原型作为基准。
    const vmObjectProto = Object.getPrototypeOf(vm.runInContext('({})', c.ctx));
    check('G5 v 的原型仍是(vm realm 的)Object.prototype, 未被改写',
      Object.getPrototypeOf(v) === vmObjectProto,
      Object.getPrototypeOf(v) === vmObjectProto ? '' : 'prototype changed');
    check('G6 constructor 未被覆盖为字符串',
      typeof v.constructor === 'function', v.constructor);
    check('G7 toString 未被覆盖为字符串',
      typeof v.toString === 'function', v.toString);
  } else {
    check('G4 v 上未产生自有 __proto__ 键', false, 'addVehicle 抛错, 无法验证');
    check('G5 v 的原型仍是 Object.prototype(未被改写)', false, 'addVehicle 抛错, 无法验证');
    check('G6 constructor 未被覆盖为字符串', false, 'n/a');
    check('G7 toString 未被覆盖为字符串', false, 'n/a');
  }
  check('G8 全局 Object.prototype 未被污染(跨沙箱不变式)',
    ({}).polluted === undefined && Object.keys(Object.prototype).length === before,
    { polluted: ({}).polluted, before, after: Object.keys(Object.prototype).length });
}

// ============================================================
section('P1 三个板块化照片元数据字段保留(原缺陷回归)');
// ============================================================
{
  const c = makeCtx();
  const v = c.State.addVehicle(Object.assign({}, BASE));
  check('P1a photoSections 保留', JSON.stringify(v.photoSections) === '["key"]', v.photoSections);
  check('P1b photoLabels 保留', JSON.stringify(v.photoLabels) === '["钥匙"]', v.photoLabels);
  check('P1c keyPhotoRemark 保留', v.keyPhotoRemark === '备注K', v.keyPhotoRemark);
}

// ============================================================
section('P2 透传对当前唯一生产调用方为 no-op');
// ============================================================
{
  // js/03-vehicles.js:900 实际传入的 16 个键
  const CALLER_KEYS = ['brand', 'series', 'config', 'display', 'powerType', 'size',
    'position', 'steps', 'keyFrame', 'keyContainer', 'remarks',
    'photoPaths', 'videoPaths', 'photoSections', 'photoLabels', 'keyPhotoRemark'];
  const c = makeCtx();
  const data = {};
  CALLER_KEYS.forEach(k => { data[k] = BASE[k]; });
  const v = c.State.addVehicle(data);
  const extra = Object.keys(v).filter(k => !CALLER_KEYS.includes(k)).sort();
  const expected = ['brandId', 'id', 'photos', 'pinyin', 'videos'].sort();
  check('P2 仅新增 5 个计算字段(无透传残留, 即透传对现网为 no-op)',
    JSON.stringify(extra) === JSON.stringify(expected), extra);
}

// ============================================================
section('P3 计算字段不可被入参覆盖');
// ============================================================
{
  const c = makeCtx();
  const v = c.State.addVehicle(Object.assign({}, BASE,
    { id: 9999, brandId: 'HACK', photos: 99, videos: 99, pinyin: 'HACK' }));
  check('P3a id 不被覆盖(自增语义)', v.id === 1, v.id);
  check('P3b brandId 不被覆盖', v.brandId === 'b1', v.brandId);
  check('P3c photos 计数不被覆盖', v.photos === 1, v.photos);
  check('P3d videos 计数不被覆盖', v.videos === 1, v.videos);
  check('P3e pinyin 不被覆盖', v.pinyin === 'py_唐EV', v.pinyin);
}

// ============================================================
section('P4 键序稳定(序列化/同步产物 diff 不会炸)');
// ============================================================
{
  const c = makeCtx();
  const v = c.State.addVehicle(Object.assign({}, BASE, { newFieldFromCaller: 1 }));
  const keys = Object.keys(v);
  check('P4a 前 18 个键序与修复前一致',
    keys.slice(0, 18).join(',') ===
    'id,brandId,brand,series,config,display,powerType,size,position,steps,keyFrame,keyContainer,remarks,photos,photoPaths,videos,videoPaths,pinyin',
    keys.slice(0, 18));
  check('P4b 新字段追加在末尾(字面量三字段 + 透传字段)',
    keys[18] === 'photoSections' && keys[19] === 'photoLabels' &&
    keys[20] === 'keyPhotoRemark' && keys[21] === 'newFieldFromCaller',
    keys.slice(18));
}

// ============================================================
section('P5 空值入参行为与修复前一致(不做假防御)');
// ============================================================
{
  // 源码刻意不写 data||{} —— 上面 data.brand 会先抛。此处固化"仍然抛错"
  // 这一既有行为, 防止有人误加 ||{} 造成"已防护"的假象。
  let threw1 = false, threw2 = false;
  try { makeCtx().State.addVehicle(null); } catch (e) { threw1 = true; }
  try { makeCtx().State.addVehicle(undefined); } catch (e) { threw2 = true; }
  check('P5a addVehicle(null) 仍抛错(未回归为静默通过)', threw1, threw1);
  check('P5b addVehicle(undefined) 仍抛错', threw2, threw2);
  check('P5c 源码未使用 data||{} 假防御',
    !/Object\.keys\(\s*data\s*\|\|/.test(stateSrc), 'found data||{}');
}

// ============================================================
console.log('\n=========================================');
console.log(`结果: 通过 ${pass} / 失败 ${fail}`);
console.log('=========================================');
process.exit(fail ? 1 : 0);
