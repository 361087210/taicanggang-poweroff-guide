/**
 * ============================================================
 * test_v10263_shared_refs.js — 「照片引用失配」回写管线回归
 * ============================================================
 * 历史故障: 迁移脚本把被多车型复用的照片放进 `vehicle_images/_共享/`，却**没有回写引用**，
 *   数据里仍写 `vehicle_images/<车型>/image4.jpeg` —— 云盘里看得到图、App 里 404。
 *   已发生 31 条；每次云端同步又会把"车型目录路径"写回来，所以必须由**管线自动回写**。
 *
 * 本套件钉住:
 *   R1 回写脚本能力齐全（--dry-run / --verify）
 *   R2 当前仓库**0 失配**：web-data 镜像里每条 photoPath 都能在磁盘上定位到文件
 *      （定位规则与 App/审计同一套: js/00-media-paths.js#resolveLocalFile）
 *   R3 管线接线：sync-web-data 在"生成 vehicles_data"之后、"生成映射/索引"之前回写,
 *      且提交前用 --verify 卡一道（顺序错了会把旧路径写进产物）
 *   R4 CI 有独立的「照片引用完整性」step（退出码直接传播, 不加 || true）
 *   R5 幂等：再跑一次 --verify 仍然通过（不会越修越乱）
 *
 * 运行: node tests/test_v10263_shared_refs.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const MP = require(path.join(ROOT, 'js/00-media-paths.js'));

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

section('R1 回写脚本能力');
const fixPath = path.join(ROOT, 'scripts/fix_shared_refs.js');
check('R1a scripts/fix_shared_refs.js 存在', fs.existsSync(fixPath));
const fixSrc = fs.existsSync(fixPath) ? fs.readFileSync(fixPath, 'utf8') : '';
check('R1b 支持 --dry-run', fixSrc.indexOf('--dry-run') >= 0);
check('R1c 支持 --verify', fixSrc.indexOf('--verify') >= 0);
check('R1d 同时改写 vehicles_data.js 与 web-data 镜像', /vehicles_data\.js/.test(fixSrc) && /web-data/.test(fixSrc));

section('R2 当前仓库 0 失配（与 App 同一套路径解析规则）');
let photoRefs = [];
try {
  const mirror = JSON.parse(src('web-data/vehicle_sync_data.json'));
  photoRefs = (mirror.vehicles || []).flatMap(v => (v.photoPaths || []));
} catch (e) { /* 由下面的断言报错 */ }
check('R2a 能从镜像读到 photoPaths', photoRefs.length > 0, photoRefs.length + ' 条');
const unresolved = photoRefs.filter(ref => !MP.resolveLocalFile(ROOT, MP.PHOTO_TOP, ref));
/* 存在"真缺失"（业务还没补拍）是允许的；不允许的是"文件在别处却没回写" */
const misplaced = unresolved.filter(ref => {
  const bn = path.basename(String(ref).replace(/\\/g, '/'));
  const inShared = fs.existsSync(path.join(ROOT, MP.PHOTO_TOP, MP.SHARED_FOLDER, bn));
  const inUnfiled = fs.existsSync(path.join(ROOT, MP.PHOTO_TOP, MP.ORPHAN_FOLDER, bn));
  return inShared || inUnfiled;   // 文件在别处 = 引用失配（可修）；都没有 = 真缺失
});
check('R2b 引用失配为 0（文件在 _共享/_未归类 却仍指向车型目录）', misplaced.length === 0,
  misplaced.length + ' 条: ' + misplaced.slice(0, 5).join(' | '));
check('R2c 真缺失数量与 audit 口径一致(64)', unresolved.length === 64, unresolved.length + ' 条');

section('R3 管线接线顺序');
const wf = src('.github/workflows/sync-web-data.yml');
const iGen = wf.indexOf('node scripts/gen_vehicles_data.js');
const iFix = wf.indexOf('node scripts/fix_shared_refs.js');
const iMap = wf.indexOf('node scripts/gen_media_mapping.js');
const iLib = wf.indexOf('node scripts/gen_media_library.js');
check('R3a 回写在 gen_vehicles_data 之后', iGen >= 0 && iFix > iGen);
check('R3b 回写在 gen_media_mapping 之前', iMap > iFix);
check('R3c 回写在 gen_media_library 之前', iLib > iFix);
check('R3d 提交前有 --verify 卡口', wf.indexOf('node scripts/fix_shared_refs.js --verify') > iFix);

section('R4 CI 独立门禁');
const ci = src('.github/workflows/ci.yml');
check('R4a 存在「照片引用完整性」step', /照片引用完整性/.test(ci));
check('R4b 该 step 直接跑 --verify', /run:\s*node scripts\/fix_shared_refs\.js --verify/.test(ci));
check('R4c 没有用 || true 静音', !/fix_shared_refs\.js --verify[^\n]*\|\| true/.test(ci));

section('R5 幂等');
const r = spawnSync(process.execPath, [fixPath, '--verify'], { cwd: ROOT, encoding: 'utf8' });
check('R5a --verify 退出码 0', r.status === 0, (r.stdout || '') + (r.stderr || ''));
const r2 = spawnSync(process.execPath, [fixPath, '--verify'], { cwd: ROOT, encoding: 'utf8' });
check('R5b 连续两次 --verify 都通过', r2.status === 0);

console.log('\n==============================================================');
console.log('照片引用回写管线回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
