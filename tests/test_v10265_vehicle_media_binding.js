/**
 * ============================================================
 * test_v10265_vehicle_media_binding.js — 车型信息 ↔ 资源库 强关联回归
 * ============================================================
 * 需求: 任意一方变更后，另一方必须能**看出对不上**，而不是静默错位。
 *
 * 六种变更及其应有的可观测结果:
 *   ① 车型改名    → 引用还写旧目录、文件在新目录 ⇒ 索引 renamedRefs 命中（UI「改名失配」）
 *   ② 车型删除    → 旧目录没人引用          ⇒ 索引 unownedFolders 命中（UI「无主目录」）
 *   ③ 新增车型    → 还没有任何素材          ⇒ 索引 vehiclesWithoutMedia 命中（UI「无素材」）
 *   ④ 新增照片/视频 → 车型汇总计数变化        ⇒ vehicles[].photos/videos 增加
 *   ⑤ 云端改数据  → 镜像/索引重建            ⇒ sync → gen 链路（见 test_v10263/…）
 *   ⑥ App 内看旧索引 → 本地索引失败时拉 Pages ⇒ CSP connect-src 允许 + 模块 REMOTE_INDEX_URL
 *
 * 本套件只依赖已提交产物与纯函数，不联网、不改仓库。
 *
 * 运行: node tests/test_v10265_vehicle_media_binding.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MP = require(path.join(ROOT, 'js/00-media-paths.js'));
const GEN = require(path.join(ROOT, 'scripts/gen_media_library.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const idx = JSON.parse(src('media_library.json'));
const manifest = JSON.parse(src('docs/vehicle_media_manifest.json'));
const mirror = JSON.parse(src('web-data/vehicle_sync_data.json'));

section('B1 车型维度覆盖：每台车都能在资源库里定位');
const mirrorIds = (mirror.vehicles || []).map(v => v.id).sort((a, b) => a - b);
const idxIds = (idx.vehicles || []).map(v => v.id).sort((a, b) => a - b);
check('B1a 索引 vehicles[] 与镜像车型数一致', idx.vehicles.length === mirror.vehicles.length,
  idx.vehicles.length + ' vs ' + mirror.vehicles.length);
check('B1b 车型 id 集合完全相同（不漏车/不多车）', JSON.stringify(mirrorIds) === JSON.stringify(idxIds),
  '缺失 ' + mirrorIds.filter(i => idxIds.indexOf(i) < 0).slice(0, 5).join(','));
check('B1c 每台车都有 folder 字段（目录名可复算）',
  idx.vehicles.every(v => v.folder === MP.folderNameForVehicle({ id: v.id, display: v.display })));
check('B1d 每台车都有素材计数', idx.vehicles.every(v => typeof v.photos === 'number' && typeof v.videos === 'number'));

section('B2 新增车型无素材 → 必须可见');
const noMedia = idx.vehicles.filter(v => (v.photos + v.videos) === 0);
check('B2a stats.vehiclesWithoutMedia 与实算一致',
  idx.stats.vehiclesWithoutMedia === noMedia.length, idx.stats.vehiclesWithoutMedia + ' vs ' + noMedia.length);
check('B2b vehiclesWithoutMedia 明细与 vehicles[] 自洽',
  (idx.vehiclesWithoutMedia || []).length === noMedia.length
  && (idx.vehiclesWithoutMedia || []).every(v => v.noMedia === true));
check('B2c 存在无素材车型时列表可枚举（当前 ' + noMedia.length + ' 台）', Array.isArray(idx.vehiclesWithoutMedia));

section('B3 删除车型 → 旧目录必须被标为无主');
/* 与生成器同口径: 磁盘上 depth-1 目录 − 车型目录 − 保留目录 */
const foldersOnDisk = new Set();
MP.listMediaFiles(ROOT, MP.PHOTO_TOP).forEach(f => {
  const parts = f.relPath.split('/');
  if (parts.length >= 4 && parts[1]) foldersOnDisk.add(parts[1]);
});
const vehicleFolders = new Set((mirror.vehicles || []).map(v => MP.folderNameForVehicle(v)));
const expectUnowned = Array.from(foldersOnDisk)
  .filter(f => ![MP.SHARED_FOLDER, MP.ORPHAN_FOLDER].includes(f) && !vehicleFolders.has(f)).sort();
const gotUnowned = (idx.unownedFolders || []).map(u => u.folder).sort();
check('B3a unownedFolders 与磁盘实算一致', JSON.stringify(expectUnowned) === JSON.stringify(gotUnowned),
  '实算 ' + expectUnowned.slice(0, 3).join(',') + ' / 索引 ' + gotUnowned.slice(0, 3).join(','));
check('B3b 每个无主目录带文件数', (idx.unownedFolders || []).every(u => Number(u.files) > 0));
check('B3c _共享/_未归类 不算无主', !gotUnowned.includes(MP.SHARED_FOLDER) && !gotUnowned.includes(MP.ORPHAN_FOLDER));

section('B4 改名失配检测（纯函数）');
const filesByFolder = new Map([
  ['新名字', new Set(['a.jpeg'])],
  ['_共享', new Set(['a.jpeg'])],
  ['_未归类', new Set(['a.jpeg'])]
]);
const refs = [{ id: 7, display: '老名字', folder: '老名字', fileName: 'a.jpeg', declared: 'vehicle_images/老名字/a.jpeg' }];
const hit = GEN.detectRenamedRefs(refs, filesByFolder, [MP.SHARED_FOLDER, MP.ORPHAN_FOLDER]);
check('B4a 命中别的车型目录 → 报改名失配', hit.length === 1 && hit[0].foundFolder === '新名字', JSON.stringify(hit));
check('B4b 给出 declared 与 foundAt 两个路径', hit[0] && hit[0].declared.indexOf('老名字') > 0 && hit[0].foundAt.indexOf('新名字') > 0);
check('B4c 共享/未归类目录不算改名（应走 shared/unfiled 状态）',
  GEN.detectRenamedRefs(refs, new Map([['_共享', new Set(['a.jpeg'])]]), [MP.SHARED_FOLDER, MP.ORPHAN_FOLDER]).length === 0
  && GEN.detectRenamedRefs(refs, new Map([['_未归类', new Set(['a.jpeg'])]]), [MP.SHARED_FOLDER, MP.ORPHAN_FOLDER]).length === 0);
check('B4d 索引里的 renamedRefs 与实算同口径（当前 ' + (idx.renamedRefs || []).length + ' 条）',
  Array.isArray(idx.renamedRefs) && idx.stats.renamedRefs === (idx.renamedRefs || []).length);

section('B5/B6 UI 能把断链显示出来');
const ml = src('js/13-media-library.js');
check('B5a 导出 brokenRows 纯函数', /brokenRows: brokenRows/.test(ml) && /function brokenRows\(/.test(ml));
check('B5b 有「断链」筛选项', /id:\s*'broken'/.test(ml));
check('B5c 三类断链都有状态样式', /unowned:\s*\{/.test(ml) && /renamed:\s*\{/.test(ml) && /nomedia:\s*\{/.test(ml));
check('B5d 顶部有「车型与资源有 N 处对不上」提示并可点', /车型与资源有/.test(ml) && /setFilter\(&quot;broken&quot;\)|setFilter\('broken'\)/.test(ml));
check('B6a 断链列表包含无主目录/改名失配/无素材三类',
  /unownedFolders/.test(ml) && /renamedRefs/.test(ml) && /vehiclesWithoutMedia/.test(ml));

section('B7 App 内索引过期时的兜底与 CSP');
check('B7a 模块仍保留线上索引兜底 URL', /REMOTE_INDEX_URL\s*=\s*'https:\/\/361087210\.github\.io/.test(ml));
check('B7b CSP 允许从 Pages 拉索引', /connect-src[^;]*https:\/\/361087210\.github\.io/.test(src('demo.html')));

section('B8 索引幂等（不会每次生成都漂移）');
const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/gen_media_library.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
check('B8a --check 退出码 0', r.status === 0, (r.stdout || '') + (r.stderr || ''));

console.log('\n==============================================================');
console.log('车型↔资源强关联回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
