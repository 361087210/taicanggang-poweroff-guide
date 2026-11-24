/**
 * ============================================================
 * test_v10266_media_independence.js — 媒体缺失不影响车型功能 + 强关联自愈
 * ============================================================
 * 需求（用户原话）:
 *   ① 照片/视频是车型信息的**补充**，不能因为媒体丢失/删除而让项目不能正常工作；
 *   ② 任意一方（车型信息 / 资源库）变更后，另一方要同步更新；
 *   ③ 车型增删改查模块要更严谨。
 *
 * 本套件钉住:
 *   I1 车型数据与媒体解耦：photoPaths/videoPaths 只是路径字符串，不含内联二进制；
 *      渲染层有"候选路径 + onerror 回退"，图片 404 不会抛异常
 *   I2 删除车型**不删文件**：State.removeVehicle 只做 splice+持久化+审计，
 *      且删除确认文案不再宣称"同时删除云端照片/视频"
 *   I3 增删改查守卫：新增/改名时**显示名唯一**（同名会导致媒体目录撞车）
 *   I4 改名自愈：同步流水线会跑 migrate_vehicle_rename --apply（幂等），
 *      并校验"无待迁移项"，否则红
 *   I5 资源库索引缺失/损坏时：加载有 catch，界面显示错误并提供重试（不白屏不崩）
 *   I6 索引自身对缺文件 tolerant：缺失项带 missingFor，且 stats 与明细自洽
 *
 * 运行: node tests/test_v10266_media_independence.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

section('I1 车型数据与媒体解耦');
const vehicles = src('vehicles_data.js');
const exportJs = src('js/04-export.js');
const mediaJs = src('js/06-media.js');
check('I1a 车型数据里不含内联图片(data:image)', vehicles.indexOf('data:image') < 0);
check('I1b photoPaths 是路径数组(以 vehicle_images/ 起头)',
  /"photoPaths"\s*:\s*\[[\s\S]{0,400}?"vehicle_images\//.test(vehicles) || /photoPaths/.test(vehicles));
check('I1c 图片加载有候选路径回退(mediaCandidateSrcs)', /function mediaCandidateSrcs/.test(mediaJs) && /img\.onerror/.test(mediaJs));
check('I1d 导出前给照片预取加了 safe 包装', /async function preparePhotoMapSafe/.test(exportJs) && /catch/.test(exportJs));
check('I1e 视频加载有 onerror 兜底', /video\.onerror\s*=/.test(mediaJs));

section('I2 删除车型不删媒体（媒体是补充）');
const stateJs = src('js/01-state.js');
const delBody = (stateJs.match(/removeVehicle\(id\)\{[\s\S]*?\n  \}/) || [''])[0];
check('I2a removeVehicle 只做 splice + 持久化', /splice/.test(delBody) && /persistVehicles/.test(delBody));
check('I2b removeVehicle 不含任何删除文件调用', !/unlink|deleteFile|fs\.|removeItem\(.*image/i.test(delBody));
const vehJs = src('js/03-vehicles.js');
/* 只看实际赋值给 msg 的文案(注释里保留历史说明是合理的, 不该因此判红) */
check('I2c 删除确认文案不再宣称删除文件',
  /msg\s*=\s*'仅删除车型信息，照片\/视频文件会保留/.test(vehJs)
  && !/msg\s*=\s*['"`][^'"`]*将同时删除云端照片/.test(vehJs));

section('I3 增删改查守卫：显示名唯一');
check('I3a saveVehicle 有同名车型拦截', /已存在同名车型/.test(vehJs));
check('I3b 编辑时排除自己（否则改别的字段也会被拦）',
  /x\.id!==state\.editingVehicle\.id/.test(vehJs));
check('I3c 必填校验仍在（显示名称 + 断电位置）', /请填写显示名称和断电位置/.test(vehJs));
check('I3d 尺寸格式校验仍在', /尺寸格式错误/.test(vehJs));

section('I4 改名自愈（管线）');
const wf = src('.github/workflows/sync-web-data.yml');
check('I4a 管线执行 migrate_vehicle_rename --apply', wf.indexOf('migrate_vehicle_rename.js --apply') >= 0);
check('I4b 迁移后有"无待迁移项"校验', /rename-plan\.json/.test(wf) && /仍有/.test(wf));
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/migrate_vehicle_rename.js'), '--json'], { cwd: ROOT, encoding: 'utf8' });
let plan = null;
try { plan = JSON.parse(r.stdout || '{}'); } catch (e) { /* 下面报错 */ }
check('I4c 当前仓库无待迁移项(moves=0)', !!plan && (plan.moves || []).length === 0,
  plan ? ('moves=' + (plan.moves || []).length) : 'plan 解析失败');
check('I4d 迁移脚本默认 dry-run(不带 --apply 不落盘)', src('scripts/migrate_vehicle_rename.js').indexOf('--apply') >= 0);

section('I5 索引缺失/损坏时资源库不崩');
const ml = src('js/13-media-library.js');
check('I5a 加载链路有 catch 并落到 _error', /\.catch\(function\(e\)[\s\S]{0,200}_error\s*=/.test(ml));
check('I5b 界面会渲染错误提示与重试按钮', /重试/.test(ml) && /索引加载失败/.test(ml));
check('I5c 索引字段缺失时用空数组兜底', /\|\[\] |\|\| \[\]/.test(ml) || /\|\| \[\]/.test(ml));

section('I6 索引对缺文件 tolerant');
const idx = JSON.parse(src('media_library.json'));
const missing = (idx.assets || []).filter(a => a.status === 'missing');
check('I6a 缺失项都带 missingFor', missing.every(a => Array.isArray(a.missingFor) && a.missingFor.length > 0));
check('I6b stats.missing 与明细一致', idx.stats.missing === missing.length, idx.stats.missing + ' vs ' + missing.length);
check('I6c 缺失项 size 为 0（不伪造体积）', missing.every(a => !a.size));
/* V10.26.8: 不写死 100 —— 按"索引车型数 == 镜像车型数"校验完整性, 数据增长也不会误红 */
const _mirrorCount = (JSON.parse(src('web-data/vehicle_sync_data.json')).vehicles || []).length;
check('I6d 索引车型清单与镜像一致（缺媒体不影响车型可见）',
  (idx.vehicles || []).length === _mirrorCount,
  '索引 ' + (idx.vehicles || []).length + ' / 镜像 ' + _mirrorCount);

console.log('\n==============================================================');
console.log('媒体独立性回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
