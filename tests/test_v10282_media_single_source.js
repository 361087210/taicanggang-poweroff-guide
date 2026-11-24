/**
 * ============================================================
 * test_v10282_media_single_source.js — 媒体单一真源(登记表)回归
 * ============================================================
 * 背景: 资源库上传/删除曾直接改车型 photoPaths/videoPaths 并整份同步
 *   vehicle_sync_data.json。别的设备只改别的车型也会被覆盖; 旧快照再同步
 *   一次, 已删的图会"自己回来"。V10.28.2 起改为:
 *     资源库只写媒体登记表(新增行/删除墓碑) → 渲染时合并 → 增量上云。
 *
 * 覆盖:
 *   S1 登记表 API 已导出
 *   S2 registryMerge: 按 at 取新, 时间相同删除优先, 不同路径并集
 *   S3 mediaPathsFor: 基线顺序 + 登记表新增 + 墓碑剔除 + 类型/车型隔离
 *   S4 mediaMetaFor: 墓碑剔除后板块/标签不错位, 新增项补默认值
 *   S5 登记/删除/恢复/彻底删除 全生命周期
 *   S6 registryAssets: 只出未在基线中的有效新增, 共享目录标 shared
 *   S7 接线契约: 资源库不再回写/整份同步, 详情页/查看器/播放器走合并视图
 *
 * 运行: node tests/test_v10282_media_single_source.js
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

const MEDIA_SRC = src('js/13-media-library.js');
const VEH_SRC = src('js/03-vehicles.js');
const VIEW_SRC = src('js/06-media.js');
const BOOT_SRC = src('js/00-bootstrap.js');
const SYNC_SRC = src('js/05-sync.js');

/* ---------------- 模块加载(含 localStorage 桩) ---------------- */
let ML = null;
const MEM = {};
try {
  const mem = MEM;
  const ls = {
    getItem: function(k){ return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
    setItem: function(k, v){ mem[k] = String(v); },
    removeItem: function(k){ delete mem[k]; }
  };
  const sandbox = {
    window: {},
    console: console,
    localStorage: ls,
    fetch: function(){ return Promise.reject(new Error('no net')); }
  };
  sandbox.window.navigator = {};
  vm.createContext(sandbox);
  vm.runInContext(MEDIA_SRC, sandbox, { filename: 'js/13-media-library.js' });
  ML = sandbox.window.MediaLibrary;
} catch (e) {
  check('S1a 模块可加载', false, e.message);
}

function fnBlock(name) {
  const i = MEDIA_SRC.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const j = MEDIA_SRC.indexOf('\nfunction ', i + 10);
  return MEDIA_SRC.slice(i, j < 0 ? MEDIA_SRC.length : j);
}

section('S1 登记表 API');
check('S1a 模块可加载', !!ML, ML ? '' : 'window.MediaLibrary 未生成');
check('S1b 登记表读写与合并已导出', !!(ML && ML.registryRows && ML.registryAdd &&
  ML.registryTombstone && ML.registryRestore && ML.registryPurge && ML.registryMerge &&
  ML.registryAssets && ML.mediaPathsFor && ML.mediaMetaFor &&
  ML.mediaRegistrySync && ML.mediaRegistryPull));

section('S2 registryMerge(LWW + 删除优先)');
if (ML) {
  const P = 'vehicle_images/x/a_p1_1111.jpeg';
  let m = ML.registryMerge({ [P]: { path: P, at: 100 } }, { [P]: { path: P, at: 200, kind: 'photo' } });
  check('S2a 远端较新则取远端', m[P].at === 200, JSON.stringify(m[P]));
  m = ML.registryMerge({ [P]: { path: P, at: 300 } }, { [P]: { path: P, at: 200 } });
  check('S2b 本地较新则保留本地', m[P].at === 300, JSON.stringify(m[P]));
  m = ML.registryMerge(
    { [P]: { path: P, at: 200 } },
    { [P]: { path: P, at: 200, deletedAt: 200 } });
  check('S2c 时间相同删除优先(防复活)', !!m[P].deletedAt, JSON.stringify(m[P]));
  const Q = 'vehicle_images/x/a_p2_2222.jpeg';
  m = ML.registryMerge({ [P]: { path: P, at: 1 } }, { [Q]: { path: Q, at: 2 } });
  check('S2d 不同路径取并集', !!m[P] && !!m[Q], Object.keys(m).join(','));
  check('S2e 合并幂等', JSON.stringify(ML.registryMerge(m, m)) === JSON.stringify(m));
}

section('S3 mediaPathsFor(基线 + 新增 − 墓碑)');
if (ML) {
  const v = { id: 7, photoPaths: ['vehicle_images/x/a_p1_1111.jpeg', 'vehicle_images/x/a_p2_2222.jpeg'],
    photoSections: ['exterior', 'key'], photoLabels: ['前脸', '钥匙'] };
  const P1 = v.photoPaths[0], P2 = v.photoPaths[1];
  const P3 = 'vehicle_images/x/a_p3_3333.jpeg';
  const rows = { [P3]: { path: P3, kind: 'photo', vehicleId: 7, at: 10 } };
  check('S3a 未登记时等于基线', JSON.stringify(ML.mediaPathsFor(v, 'photo', {})) === JSON.stringify([P1, P2]));
  check('S3b 新增追加到末尾', JSON.stringify(ML.mediaPathsFor(v, 'photo', rows)) === JSON.stringify([P1, P2, P3]));
  check('S3c 墓碑剔除基线路径', JSON.stringify(ML.mediaPathsFor(v, 'photo',
    { [P1]: { path: P1, kind: 'photo', at: 10, deletedAt: 10 } })) === JSON.stringify([P2]));
  check('S3d 视频登记不影响照片', JSON.stringify(ML.mediaPathsFor(v, 'photo',
    { [P3]: { path: P3, kind: 'video', vehicleId: 7, at: 10 } })) === JSON.stringify([P1, P2]));
  check('S3e 其它车型的登记不串台', JSON.stringify(ML.mediaPathsFor(v, 'photo',
    { [P3]: { path: P3, kind: 'photo', vehicleId: 99, at: 10 } })) === JSON.stringify([P1, P2]));
  check('S3f 与基线重复只保留一条', ML.mediaPathsFor(v, 'photo',
    { [P1]: { path: P1, kind: 'photo', vehicleId: 7, at: 10 } }).length === 2);
  check('S3g 视频视图同规则', JSON.stringify(ML.mediaPathsFor(
    { id: 7, videoPaths: ['vehicle_videos/x/a_v1_4444.mp4'] }, 'video',
    { 'vehicle_videos/x/a_v2_5555.mp4': { path: 'vehicle_videos/x/a_v2_5555.mp4', kind: 'video', vehicleId: 7, at: 10 } }))
    === JSON.stringify(['vehicle_videos/x/a_v1_4444.mp4', 'vehicle_videos/x/a_v2_5555.mp4']));
}

section('S4 mediaMetaFor(板块/标签随视图重排)');
if (ML) {
  const P1 = 'vehicle_images/x/a_p1_1111.jpeg', P2 = 'vehicle_images/x/a_p2_2222.jpeg';
  const v = { id: 7, photoPaths: [P1, P2], photoSections: ['exterior', 'key'], photoLabels: ['前脸', '钥匙'] };
  let meta = ML.mediaMetaFor(v, 'photo', { [P1]: { path: P1, kind: 'photo', at: 1, deletedAt: 1 } });
  check('S4a 剔除首张后标签不前移', meta.paths.length === 1 && meta.paths[0] === P2 &&
    meta.labels[0] === '钥匙' && meta.sections[0] === 'key', JSON.stringify(meta));
  const P3 = 'vehicle_images/x/a_p3_3333.jpeg';
  meta = ML.mediaMetaFor(v, 'photo', { [P3]: { path: P3, kind: 'photo', vehicleId: 7, at: 5 } });
  check('S4b 新增项补默认板块/空标签', meta.paths.length === 3 &&
    meta.sections[2] === 'exterior' && meta.labels[2] === '', JSON.stringify(meta));
}

section('S5 登记 → 删除 → 恢复 → 彻底删除');
if (ML) {
  const P = 'vehicle_images/登记生命周期/a_p1_abcd1234.jpeg';
  const added = ML.registryAdd({ path: P, kind: 'photo', vehicleId: 7, display: '生命周期车' });
  check('S5a 新增行写入成功', !!(added && ML.registryRow(P) && !ML.registryRow(P).deletedAt), JSON.stringify(added));
  check('S5b 墓碑后视图隐藏', ML.registryTombstone(P, 'user', [{ id: 7, display: '生命周期车' }], 'photo') &&
    ML.mediaPathsFor({ id: 7, photoPaths: [] }, 'photo').indexOf(P) < 0);
  check('S5c 墓碑带原因与归属', ML.registryRow(P).deletedReason === 'user' &&
    Array.isArray(ML.registryRow(P).vehicles) && ML.registryRow(P).vehicles.length === 1);
  check('S5d 恢复后重新可见', ML.registryRestore(P) &&
    ML.mediaPathsFor({ id: 7, photoPaths: [] }, 'photo').indexOf(P) >= 0);
  check('S5e 彻底删除后仍隐藏且带 purgedAt', ML.registryPurge(P) &&
    !!ML.registryRow(P).purgedAt && ML.mediaPathsFor({ id: 7, photoPaths: [] }, 'photo').indexOf(P) < 0);
  check('S5f 登记表已持久化到 localStorage', (function(){
    const saved = JSON.parse(MEM['tcg_media_registry'] || '{}');
    return !!(saved.rows && saved.rows[P] && saved.rows[P].purgedAt);
  })());
}

section('S6 registryAssets(台账新增行)');
if (ML) {
  const P1 = 'vehicle_images/x/a_p1_1111.jpeg';
  const P2 = 'vehicle_images/x/a_p2_2222.jpeg';
  const P3 = 'vehicle_images/x/a_p3_3333.jpeg';
  const P4 = 'vehicle_images/_共享/shared_6666.jpeg';
  const rows = {
    [P2]: { path: P2, kind: 'photo', vehicleId: 7, at: 10 },
    [P3]: { path: P3, kind: 'photo', vehicleId: 7, at: 20, deletedAt: 20 },
    [P4]: { path: P4, kind: 'photo', vehicleId: 7, at: 30 }
  };
  const vs = [{ id: 7, display: '测试车', photoPaths: [P1], videoPaths: [] }];
  const list = ML.registryAssets(rows, vs);
  const paths = list.map(function(a){ return a.path; });
  check('S6a 基线里已有的不重复出', paths.indexOf(P1) < 0, paths.join(','));
  check('S6b 有效新增出现且归属正确', paths.indexOf(P2) >= 0 &&
    list.find(function(a){ return a.path === P2; }).vehicles[0].id === 7);
  check('S6c 墓碑行不出现', paths.indexOf(P3) < 0);
  check('S6d 共享目录标 shared', (list.find(function(a){ return a.path === P4; }) || {}).status === 'shared');
}

section('S7 接线契约');
const upStart = MEDIA_SRC.indexOf('async function onUploadFiles(');
const upEnd = MEDIA_SRC.indexOf('\nfunction deleteCloud(');
const upBlock = upStart >= 0 && upEnd > upStart ? MEDIA_SRC.slice(upStart, upEnd) : '';
check('S7a 上传只登记, 不写回车型 payload', upBlock.indexOf('registryAdd(') >= 0 &&
  upBlock.indexOf('State.updateVehicle') < 0 && upBlock.indexOf('v[key] = prev') < 0);
check('S7b 上传不再整份同步车型数据', upBlock.indexOf('_scheduleVehicleSync') < 0 && MEDIA_SRC.indexOf('_scheduleVehicleSync') < 0);
const delBlock = fnBlock('deleteCloud');
check('S7c 删除写墓碑, 不再 unlink 车型引用', delBlock.indexOf('registryTombstone(') >= 0 &&
  delBlock.indexOf('unlinkPathOf(') < 0 && delBlock.indexOf('State.updateVehicle') < 0);
const restoreBlock = fnBlock('restoreFromTrash');
check('S7d 恢复只摘墓碑, 不重新挂回 payload', restoreBlock.indexOf('registryRestore(') >= 0 &&
  restoreBlock.indexOf('push(path)') < 0);
const purgeBlock = fnBlock('purgeFromTrash');
check('S7e 彻底删除留墓碑', purgeBlock.indexOf('registryPurge(') >= 0);
check('S7f 详情页渲染走合并视图', VEH_SRC.indexOf("_mediaViewMeta(v,'photo')") >= 0 &&
  VEH_SRC.indexOf("_mediaViewPaths(v,'video')") >= 0 && VEH_SRC.indexOf("_mediaViewPaths(v,'photo')") >= 0);
check('S7g 查看器/播放器走合并视图', VIEW_SRC.indexOf('mediaViewMeta(v,\'photo\')') >= 0 &&
  VIEW_SRC.indexOf('mediaViewPaths(v,\'video\')') >= 0);
check('S7h 合并读取口定义在 bootstrap', /function mediaViewPaths\(v,kind\)/.test(BOOT_SRC) &&
  /function mediaViewMeta\(v,kind\)/.test(BOOT_SRC));
check('S7i 同步拉取时合并登记表', SYNC_SRC.indexOf('MediaLibrary.mediaRegistryPull') >= 0);
check('S7j 登记表上云走独立文件+并集', MEDIA_SRC.indexOf("REGISTRY_CLOUD_FILE = 'media_registry.json'") >= 0 &&
  fnBlock('mediaRegistrySync').indexOf('registryMerge(') >= 0 &&
  fnBlock('mediaRegistrySync').indexOf('uploadJsonToDataFeishu(') >= 0);

console.log('\n==================================================');
console.log('单一真源回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (fail) console.log('失败项: ' + failures.join(', '));
process.exit(fail ? 1 : 0);
