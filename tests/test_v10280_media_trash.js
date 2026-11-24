/**
 * ============================================================
 * test_v10280_media_trash.js — 媒体回收站 + 上传判重/回滚 回归
 * ============================================================
 * 覆盖:
 *   T1 模块可加载, 回收站 API 已导出
 *   T2 moveToTrash: 记录 reason/kind/name, isTrashed/trashCount 生效
 *   T3 幂等: 同一路径重复移入不产生第二条
 *   T4 未入回收站的路径不误判
 *   T5 deleteCloud 不再直接删云端文件(必须先入回收站)
 *   T6 purgeFromTrash 才调用 driveDeleteFile, 且无句柄时拒绝
 *   T7 上传文件名用内容哈希, 不再把 Date.now() 拼进哈希
 *   T8 上传写库失败有回滚(撤回引用 + 删刚传文件)
 *   T9 车型删除前把独享媒体移入回收站
 *
 * 运行: node tests/test_v10280_media_trash.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------------- T1 加载模块（无 DOM，只有 window 桩） ---------------- */
const MEDIA_SRC = src('js/13-media-library.js');
let ML = null;
try {
  const sandbox = { window: {}, console: console, fetch: function(){ return Promise.reject(new Error('no net')); } };
  sandbox.window.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SRC, sandbox, { filename: 'js/13-media-library.js' });
  ML = sandbox.window.MediaLibrary;
} catch (e) {
  check('T1a 模块可在无 DOM 环境加载', false, e.message);
}

section('T1 模块导出');
check('T1a 模块可在无 DOM 环境加载', !!ML, ML ? '' : 'window.MediaLibrary 未生成');
check('T1b 回收站 API 已导出', !!(ML && ML.moveToTrash && ML.isTrashed && ML.trashEntries &&
  ML.trashCount && ML.restoreFromTrash && ML.purgeFromTrash && ML.trashVehicleMedia && ML.toggleTrash));

section('T2 移入回收站');
const P1 = 'vehicle_images/比亚迪海豚/海豚_p1_ab12cd34.jpeg';
let rec = null;
if (ML) rec = ML.moveToTrash(P1, 'user', 'photo', [{ id: 1, display: '比亚迪海豚' }]);
check('T2a 返回记录且字段完整', !!(rec && rec.path === P1 && rec.reason === 'user' &&
  rec.kind === 'photo' && rec.name === '海豚_p1_ab12cd34.jpeg'), rec && JSON.stringify(rec));
check('T2b 路径被标记为已入回收站', !!(ML && ML.isTrashed(P1)));
check('T2c 回收站计数为 1', !!(ML && ML.trashCount() === 1), ML && ML.trashCount());

section('T3 幂等');
if (ML) ML.moveToTrash(P1, 'user', 'photo', [{ id: 1, display: '比亚迪海豚' }]);
check('T3a 重复移入不新增记录', !!(ML && ML.trashCount() === 1), ML && ML.trashCount());

section('T4 未入回收站');
check('T4a 其它路径不误判', !!(ML && !ML.isTrashed('vehicle_images/长安深蓝/深蓝_p1_ffff0000.jpeg')));

section('T5/T6 软删与彻底删分离');
const delStart = MEDIA_SRC.indexOf('function deleteCloud(');
const delEnd = MEDIA_SRC.indexOf('async function loadCloudPreview(');
const delBlock = delStart >= 0 && delEnd > delStart ? MEDIA_SRC.slice(delStart, delEnd) : '';
const purgeStart = MEDIA_SRC.indexOf('function purgeFromTrash(');
const purgeEnd = MEDIA_SRC.indexOf('function trashVehicleMedia(');
const purgeBlock = purgeStart >= 0 && purgeEnd > purgeStart ? MEDIA_SRC.slice(purgeStart, purgeEnd) : '';
check('T5a deleteCloud 内不再直接 driveDeleteFile', !!delBlock && delBlock.indexOf('driveDeleteFile') < 0);
check('T5b deleteCloud 走 moveToTrash', !!delBlock && delBlock.indexOf('moveToTrash') >= 0);
check('T5c deleteCloud 文案改为可恢复', !!delBlock && delBlock.indexOf('移入回收站') >= 0 && delBlock.indexOf('不可恢复') < 0);
check('T6a 只有彻底删除才调 driveDeleteFile', !!purgeBlock && purgeBlock.indexOf('driveDeleteFile') >= 0);
check('T6b 无云端句柄时拒绝彻底删除', !!purgeBlock && purgeBlock.indexOf('取得文件句柄') >= 0);

section('T7/T8 上传判重与回滚');
const upStart = MEDIA_SRC.indexOf('async function onUploadFiles(');
const upEnd = MEDIA_SRC.indexOf('\nfunction deleteCloud(');
const upBlock = upStart >= 0 && upEnd > upStart ? MEDIA_SRC.slice(upStart, upEnd) : '';
check('T7a 上传前计算内容哈希', !!upBlock && upBlock.indexOf('await _fileContentHash(file)') >= 0);
check('T7b 文件名不再拼接 Date.now()', !!upBlock && upBlock.indexOf("file.size + ':' + Date.now()") < 0);
check('T7c 命中已传哈希时跳过', !!upBlock && upBlock.indexOf('skip++') >= 0 && upBlock.indexOf('hi[hash]') >= 0);
check('T8a 写库失败不改车型引用(只登记表回滚)', !!upBlock && upBlock.indexOf('v[key] = prev') < 0 && upBlock.indexOf('registryAdd(') >= 0);
check('T8b 写库失败删除刚上传文件', !!upBlock && upBlock.indexOf('回滚删除失败') >= 0);

section('T9 车型删除级联');
const vehSrc = src('js/03-vehicles.js');
check('T9a 删除车型前调用回收站级联', /trashVehicleMedia\(id\s*,\s*v\.display\)/.test(vehSrc));
const trashFn = MEDIA_SRC.slice(MEDIA_SRC.indexOf('function trashVehicleMedia('), MEDIA_SRC.indexOf('function toggleTrash('));
check('T9b 仅独享媒体入回收站(共享不动)', trashFn.indexOf('owners.length <= 1') >= 0);
check('T9c 级联原因标记为 vehicle_cascade', trashFn.indexOf("'vehicle_cascade'") >= 0);

section('结果');
console.log(pass + ' passed, ' + fail + ' failed');
if (fail) {
  console.log('失败项: ' + failures.join(' | '));
  process.exit(1);
}
process.exit(0);
