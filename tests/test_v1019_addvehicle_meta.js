/* ============================================================
 * V10.19.1 State.addVehicle 板块化照片元数据保留 专项测试
 * 运行: node tests/test_v1019_addvehicle_meta.js   (仓库根目录)
 *
 * 背景(由 QA 在 tests/test_v1020_vehicles_crud.js 中发现):
 *   State.addVehicle 用逐字段对象字面量构造车辆, 字段表里漏了 V10.15.5 引入的
 *   photoSections / photoLabels / keyPhotoRemark, 而 03-vehicles.js:900 确实传了
 *   这三个字段 → 被静默丢弃。编辑路径 State.updateVehicle 走 Object.assign 是全
 *   保留的, 于是"新增丢、编辑留"不对称: 新增车辆选的照片板块(车钥匙/断电位置)
 *   保存即丢, loadEditMedia 回读时 v.photoSections 为 undefined, 全部照片回退
 *   到 exterior 板块。
 *
 * 覆盖:
 *   S1 三个元数据字段在新增路径保留(复刻真实传参)
 *   S2 键序不被透传打乱(既有序列化/同步产物 diff 稳定)
 *   S3 透传生效且安全: 未来新字段不再静默丢弃, 但计算字段不可被入参覆盖
 *   S4 与 updateVehicle 语义对称
 * =========================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'js', '01-state.js'), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){
  if(cond){ pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t){ console.log('\n========== ' + t + ' =========='); }

/** 按花括号配对抽取 `const State={...}` 完整声明 */
function extractStateBlock(){
  const re = /(?:^|\n)[ \t]*const[ \t]+State[ \t]*=/;
  const m = re.exec(src);
  if(!m) throw new Error('01-state.js 中未找到 const State=');
  const open = src.indexOf('{', m.index);
  let d = 0, j = open;
  for(; j < src.length; j++){
    if(src[j] === '{') d++;
    else if(src[j] === '}'){ d--; if(d === 0){ j++; break; } }
  }
  return src.slice(m.index, j) + ';';
}

const VEHICLES = [];
const sandbox = {
  console: { log(){}, warn(){}, error(){} },
  VEHICLES,
  BRANDS: [{ id: 'byd', name: '比亚迪' }],
  persistVehicles: () => { sandbox.__persists++; },
  getPinyin: s => 'PY:' + s,
  window: {},
  Object, Array, Math, JSON, String, Number, Boolean,
  __persists: 0
};
sandbox.window.Audit = { track: () => {} };
sandbox.globalThis = sandbox; // const 声明不会自动挂到 context 对象上
vm.createContext(sandbox);
// 追加导出: 让 const State 可从沙箱外部取到
vm.runInContext(extractStateBlock() + '\n;globalThis.__State=State;', sandbox, { filename: '01-state.js#State' });
const State = sandbox.__State;

/** 复刻 03-vehicles.js:900 对 State.addVehicle 的真实调用形态 */
function addLikeSaveVehicle(extra){
  return State.addVehicle(Object.assign({
    brand: '比亚迪', series: '汉', config: 'EV', display: '汉EV', powerType: '纯电',
    size: '4995*1910*1495', position: '前机盖', steps: ['s1'], keyFrame: ['k1'], keyContainer: ['c1'],
    remarks: 'R', photoPaths: ['a.jpg', 'b.jpg'], videoPaths: ['v.mp4'],
    photoSections: ['key', 'position'], photoLabels: ['车钥匙', '断电位置'], keyPhotoRemark: '钥匙在扶手箱'
  }, extra || {}));
}

/* ===== S1 元数据保留 ===== */
section('S1 新增路径保留板块化照片元数据');
const v1 = addLikeSaveVehicle();
check('S1a photoSections 保留', Array.isArray(v1.photoSections) && v1.photoSections.join() === 'key,position', JSON.stringify(v1.photoSections));
check('S1b photoLabels 保留', Array.isArray(v1.photoLabels) && v1.photoLabels.join() === '车钥匙,断电位置', JSON.stringify(v1.photoLabels));
check('S1c keyPhotoRemark 保留', v1.keyPhotoRemark === '钥匙在扶手箱', String(v1.keyPhotoRemark));
// loadEditMedia(03-vehicles.js:853) 的还原逻辑: sections[i] || 'exterior'
const restored = v1.photoPaths.map((p, i) => (v1.photoSections || [])[i] || 'exterior');
check('S1d loadEditMedia 不再全部回退 exterior', restored.join() === 'key,position', restored.join());
check('S1e 新增已入列并持久化', VEHICLES.length === 1 && sandbox.__persists === 1);

/* ===== S2 键序稳定 ===== */
section('S2 键序不被透传打乱(保证序列化/同步产物 diff 稳定)');
const keys = Object.keys(v1);
console.log('  键序: ' + keys.join(','));
check('S2a 前18个键仍是原有字段且顺序不变',
  keys.slice(0, 18).join(',') === 'id,brandId,brand,series,config,display,powerType,size,position,steps,keyFrame,keyContainer,remarks,photos,photoPaths,videos,videoPaths,pinyin',
  keys.slice(0, 18).join(','));
check('S2b 新增字段追加在末尾', keys.slice(18).sort().join(',') === 'keyPhotoRemark,photoLabels,photoSections', keys.slice(18).join(','));

/* ===== S3 透传生效且安全 ===== */
section('S3 透传: 防复发 + 不覆盖计算字段');
const v2 = addLikeSaveVehicle({ futureMetaField: { a: 1 } });
check('S3a 字面量未列出的字段也被保留(不再静默丢弃)', !!(v2.futureMetaField && v2.futureMetaField.a === 1), JSON.stringify(v2.futureMetaField));
const v3 = State.addVehicle({
  brand: '未知品牌', series: 'S', config: 'C', display: 'X', powerType: '', size: '', position: 'P',
  steps: [], keyFrame: [], keyContainer: [], remarks: '', photoPaths: [], videoPaths: [],
  id: 999, brandId: 'hack', photos: 99, videos: 99, pinyin: 'hack'
});
check('S3b id 不被入参覆盖', v3.id === 3, String(v3.id));
check('S3c brandId 不被入参覆盖(未知品牌→custom)', v3.brandId === 'custom', String(v3.brandId));
check('S3d photos/videos 计数不被入参覆盖', v3.photos === 0 && v3.videos === 0, v3.photos + '/' + v3.videos);
check('S3e pinyin 不被入参覆盖', v3.pinyin === 'PY:X', String(v3.pinyin));
check('S3f powerType 空值兜底为纯电', v3.powerType === '纯电', String(v3.powerType));
check('S3g steps/keyFrame/keyContainer 空兜底',
  v3.steps.length === 1 && v3.keyFrame.length === 1 && v3.keyContainer.length === 1,
  JSON.stringify([v3.steps, v3.keyFrame, v3.keyContainer]));

/* ===== S4 与 updateVehicle 对称 ===== */
section('S4 新增/编辑语义对称');
const v4 = State.updateVehicle(v1.id, { photoSections: ['exterior'] });
check('S4a updateVehicle 仍正常合并', !!(v4 && v4.photoSections && v4.photoSections.join() === 'exterior'), JSON.stringify(v4 && v4.photoSections));
check('S4b 编辑后元数据与新增路径同源', v4.photoLabels.join() === '车钥匙,断电位置', JSON.stringify(v4.photoLabels));

console.log('\n=========================================');
console.log('结果: 通过 ' + pass + ' / 失败 ' + fail);
if(fail){ console.log('失败项:'); failures.forEach(f => console.log('  - ' + f)); }
console.log('=========================================');
process.exit(fail ? 1 : 0);
