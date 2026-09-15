/**
 * ============================================================
 * test_v1026_remove_vehicle_guard.js — 删除保护测试(需求3第一阶段)
 * ============================================================
 * 覆盖:
 *  G1 State.mediaShare 正确分类共享/独享媒体(查唯一真源 manifest)
 *  G2 删除共享媒体的车 → confirmDeleteVehicle 弹「该媒体被 N 车共用，仅解除本车引用」, 确认后才删
 *  G3 删除独享媒体的车 → 弹「将同时删除云端照片/视频」, 确认后才删
 *  G4 无媒体/manifest 缺失 → 回退通用「不可撤销」确认(保持旧语义)
 *
 * 运行: node tests/test_v1026_remove_vehicle_guard.js
 * 要求: 先红后绿——删除保护实现前红, 实现后绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const { extractNamedBlock } = require('./e2e_harness');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const stateJs = src('js/01-state.js');
const vehiclesJs = src('js/03-vehicles.js');

function makeManifest(){
  return {
    vehicles: [
      { id: 1, photos: [{ fileName: 'image1.jpeg' }], videos: [{ fileName: 'v1.mp4' }] },
      { id: 2, photos: [{ fileName: 'image4.jpeg' }], videos: [{ fileName: 'v1.mp4' }] },
      { id: 3, photos: [{ fileName: 'image4.jpeg' }], videos: [] },
      { id: 4, photos: [{ fileName: 'image5.jpeg' }], videos: [] }
    ]
  };
}
function makeVehicles(){
  return [
    { id: 1, display: 'A', photoPaths: ['vehicle_images/image1.jpeg'], videoPaths: ['vehicle_videos/v1.mp4'] },
    { id: 2, display: 'B', photoPaths: ['vehicle_images/image4.jpeg'], videoPaths: ['vehicle_videos/v1.mp4'] },
    { id: 3, display: 'C', photoPaths: ['vehicle_images/image4.jpeg'], videoPaths: [] },
    { id: 4, display: 'D', photoPaths: ['vehicle_images/image5.jpeg'], videoPaths: [] }
  ];
}

// showConfirm 只捕获不自动回调(测试"确认前不删/确认后真删")
function makeCtx(manifest){
  const confirms = [], toasts = [];
  const vehicles = makeVehicles();
  const sandbox = {
    console,
    VEHICLES: vehicles,
    USERS: [],
    BRANDS: [],
    getPinyin: s => s,
    persistVehicles: () => {},
    showConfirm: (title, msg, cb) => { confirms.push({ title, msg, cb }); },
    showToast: m => toasts.push(String(m)),
    renderBrandTags: () => {},
    renderVehicleList: () => {},
    goBack: () => {},
    window: manifest ? { __MEDIA_MANIFEST__: manifest } : {},
    Date, JSON, Math, String, Number, Boolean, Array, Object, Set, Map,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(extractNamedBlock(stateJs, 'State'), ctx, { filename: 'State.js' });
  vm.runInContext(extractNamedBlock(vehiclesJs, 'confirmDeleteVehicle'), ctx, { filename: 'confirmDeleteVehicle.js' });
  return { ctx, vehicles, confirms, toasts };
}

section('G1 State.mediaShare 分类(查 manifest)');
{
  const { ctx } = makeCtx(makeManifest());
  const share = vm.runInContext('State.mediaShare(2)', ctx);
  check('G1a id2 共享媒体含 image4.jpeg + v1.mp4', share.shared.includes('image4.jpeg') && share.shared.includes('v1.mp4'), JSON.stringify(share));
  check('G1b id2 共享车数=2(去重 id1/id3)', share.sharedVehicles.length === 2, JSON.stringify(share.sharedVehicles));
  check('G1c id2 无独享媒体', share.exclusive.length === 0, JSON.stringify(share.exclusive));
  const share4 = vm.runInContext('State.mediaShare(4)', ctx);
  check('G1d id4 独享 image5.jpeg 且无共享', share4.exclusive.includes('image5.jpeg') && share4.shared.length === 0, JSON.stringify(share4));
  const noM = vm.runInContext('(function(){window.__MEDIA_MANIFEST__=undefined;return State.mediaShare(1);})()', ctx);
  check('G1e manifest 缺失优雅降级(返回空)', noM.shared.length === 0 && noM.exclusive.length === 0 && noM.sharedVehicles.length === 0);
}

section('G2 删除共享媒体车 → 弹「仅解除本车引用」且确认后才删');
{
  const { ctx, vehicles, confirms } = makeCtx(makeManifest());
  vm.runInContext('confirmDeleteVehicle(2)', ctx);
  check('G2a 弹确认且文案含「车共用」+「仅解除本车引用」', confirms.length === 1 && /车共用/.test(confirms[0].msg) && /仅解除本车引用/.test(confirms[0].msg), JSON.stringify(confirms.map(c => c.msg)));
  check('G2b 确认前不删(数据完好)', vehicles.some(v => v.id === 2));
  confirms[0].cb();
  check('G2c 确认后车辆真删', !vehicles.some(v => v.id === 2));
  check('G2d 共享媒体不影响他车(仅解除本车引用)', vehicles.some(v => v.id === 3) && vehicles.some(v => v.id === 1));
}

section('G3 删除独享媒体车 → 弹「将同时删除云端照片/视频」');
{
  const { ctx, vehicles, confirms } = makeCtx(makeManifest());
  vm.runInContext('confirmDeleteVehicle(4)', ctx);
  check('G3a 弹确认且文案含「将同时删除云端照片/视频」', confirms.length === 1 && /将同时删除云端照片\/视频/.test(confirms[0].msg), JSON.stringify(confirms.map(c => c.msg)));
  check('G3b 确认前不删', vehicles.some(v => v.id === 4));
  confirms[0].cb();
  check('G3c 确认后车辆真删', !vehicles.some(v => v.id === 4));
}

section('G4 无媒体/manifest 缺失 → 回退通用「不可撤销」确认');
{
  const { ctx, vehicles, confirms } = makeCtx(null);
  vm.runInContext('confirmDeleteVehicle(1)', ctx);
  check('G4a 回退通用确认(含「不可撤销」)', confirms.length === 1 && /不可撤销/.test(confirms[0].msg), JSON.stringify(confirms.map(c => c.msg)));
  confirms[0].cb();
  check('G4b 确认后删除', !vehicles.some(v => v.id === 1));
}

console.log('\n==============================================================');
console.log('删除保护测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
