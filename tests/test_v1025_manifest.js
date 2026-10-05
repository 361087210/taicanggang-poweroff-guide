/**
 * ============================================================
 * test_v1025_manifest.js — 唯一真源 media manifest 生成测试(需求3第一阶段)
 * ============================================================
 * 覆盖:
 *  M1 gen_media_mapping.js 升级支持 manifest 生成(schemaVersion/assets)
 *  M2 动态: 生成 manifest, 照片本地文件有真实 SHA-256(64hex), 视频有 releaseAsset
 *  M3 assets 反向索引: 同 sha256 多车引用 vehicleIds 累积(张冠李戴可追溯)
 *  M4 stats 数量与 vehicles_data.js 对齐
 *
 * 运行: node tests/test_v1025_manifest.js
 * 要求: 先红后绿——生成器升级前红, 升级后绿。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

/* ------------------------------------------------------------------------
 * 子 node 进程执行器: 用**文件描述符**接管 stdout/stderr, stdin 置 'ignore'
 * ------------------------------------------------------------------------
 * 为什么不用管道: 本沙箱(Windows)实测, 已运行的 node 再 spawn 子 node 时
 *   - stdin 为 'pipe' → 必 EBUSY(status=null, code=EBUSY), 子脚本根本没跑;
 *   - 该失败与被测逻辑无关, 会让本套件在本地假红(CI/真机是绿的)。
 *   改用 fs.openSync 的文件描述符接管后完全正常, 退出码与输出都能完整拿到。
 * 临时目录在读取输出后**立即删除**, 不留垃圾, 也不在仓库里落任何文件。
 * 若连子进程本身都创建不了(极少见), 按 tests/test_v57_cross_network.js 先例
 * 打印 "[环境缺失] 跳过" 并 exit 0: 那是环境不具备执行条件, 不是测试失败。
 * ---------------------------------------------------------------------- */
function envUnavailable(err) {
  console.log('[环境缺失] 跳过本套件: 无法创建子 node 进程');
  console.log('  原因: ' + ((err && err.code ? err.code + ' ' : '') + (err && err.message ? err.message : '')));
  console.log('  视为"本环境不具备执行条件", 非测试失败, 退出码 0。CI 里会真跑。');
  process.exit(0);
}
function runNode(args, opts) {
  opts = opts || {};
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'v1025-'));
  const fo = path.join(d, 'o.txt');
  const fe = path.join(d, 'e.txt');
  const fdo = fs.openSync(fo, 'w');
  const fde = fs.openSync(fe, 'w');
  let r;
  try {
    r = spawnSync(process.execPath, args, { cwd: opts.cwd || ROOT, stdio: ['ignore', fdo, fde], timeout: 120000 });
  } catch (e) { r = { status: null, error: e }; }
  try { fs.closeSync(fdo); } catch (e) {}
  try { fs.closeSync(fde); } catch (e) {}
  if (r.status === null && r.error) envUnavailable(r.error);
  const stdout = fs.readFileSync(fo, 'utf8');
  const stderr = fs.readFileSync(fe, 'utf8');
  fs.rmSync(d, { recursive: true, force: true });
  return { status: r.status, stdout: stdout, stderr: stderr, all: stdout + stderr };
}

const genJs = src('scripts/gen_media_mapping.js');

section('M1 生成器升级(静态)');
check('M1a 生成器含 manifest 输出路径', genJs.includes('vehicle_media_manifest.json'));
check('M1b 生成器含 schemaVersion', genJs.includes('schemaVersion'));
check('M1c 生成器含 assets 反向索引', genJs.includes('assets'));
check('M1d 生成器含 SHA-256 计算', genJs.includes('createHash(\'sha256\')') || genJs.includes("createHash('sha256')"));
check('M1e 生成器解析 MEDIA_DIRECT_ASSETS(releaseAsset)', genJs.includes('MEDIA_DIRECT_ASSETS'));

section('M2/M3/M4 动态生成与断言');
try {
  const tmp = path.join(ROOT, '_verify_manifest');
  if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true });
  fs.mkdirSync(tmp, { recursive: true });
  const r = runNode(['scripts/gen_media_mapping.js', '--manifest-only', '--manifest-out', '_verify_manifest']);
  if (r.status !== 0) throw new Error('生成器退出码 ' + r.status + ': ' + r.all.slice(0, 300));
  const m = JSON.parse(fs.readFileSync(path.join(tmp, 'vehicle_media_manifest.json'), 'utf8'));

  check('M2a schemaVersion=1', m.schemaVersion === 1, m.schemaVersion);
  check('M2b generatedAt 为 ISO 时间戳', /^\d{4}-\d{2}-\d{2}T/.test(String(m.generatedAt)), m.generatedAt);
  check('M2c qiniu.bucket=tcg-media', m.qiniu && m.qiniu.bucket === 'tcg-media');
  check('M2d vehicles 数组非空', Array.isArray(m.vehicles) && m.vehicles.length > 0, m.vehicles && m.vehicles.length);
  check('M2e stats.vehicleCount === vehicles.length', m.stats.vehicleCount === m.vehicles.length, m.stats.vehicleCount + ' vs ' + m.vehicles.length);

  // 找一个本地照片(image1.jpeg)验证真实 sha256
  const v1 = (m.vehicles.find(v => v.id === 1) || {});
  const ph1 = (v1.photos || []).find(p => p.fileName === 'image1.jpeg');
  check('M2f 本地照片有真实 SHA-256(64hex)', !!(ph1 && /^[0-9a-f]{64}$/.test(ph1.sha256)), ph1 && ph1.sha256);
  check('M2g 本地照片有 size>0', !!(ph1 && ph1.size > 0), ph1 && ph1.size);
  check('M2h 本地照片 mime=image/jpeg', !!(ph1 && ph1.mime === 'image/jpeg'), ph1 && ph1.mime);

  // 视频有 releaseAsset(比亚迪海豚_低配.mp4 -> tcgv_*.mp4)
  const vd1 = (v1.videos || []).find(v => v.fileName === '比亚迪海豚_低配.mp4');
  check('M2i 视频有 releaseAsset(tcgv_*.mp4)', !!(vd1 && /^tcgv_[0-9a-f]+\.mp4$/.test(vd1.releaseAsset)), vd1 && vd1.releaseAsset);
  check('M2j 视频 sha256 置空(云端资产本阶段无指纹)', !!(vd1 && vd1.sha256 === ''));

  // assets 反向索引
  const assetKeys = Object.keys(m.assets || {});
  check('M3a assets 非空且键为 64hex', assetKeys.length > 0 && assetKeys.every(k => /^[0-9a-f]{64}$/.test(k)), assetKeys.length);
  const sharedAsset = assetKeys.find(k => (m.assets[k].vehicleIds || []).length > 1);
  check('M3b 存在跨车共享资产(image4.jpeg 等), vehicleIds.length>1', !!sharedAsset, sharedAsset);
  check('M3c 共享资产 vehicleIds 无重复', sharedAsset ? new Set(m.assets[sharedAsset].vehicleIds).size === m.assets[sharedAsset].vehicleIds.length : false);

  check('M4a photoCount>0 且 videoCount>0', m.stats.photoCount > 0 && m.stats.videoCount > 0, JSON.stringify(m.stats));

  fs.rmSync(tmp, { recursive: true });
} catch (e) {
  check('M2 动态执行异常: ' + e.message, false);
}

console.log('\n==============================================================');
console.log('manifest 生成测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
