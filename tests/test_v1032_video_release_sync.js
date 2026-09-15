/**
 * ============================================================
 * test_v1032_video_release_sync.js — 飞书→Release 视频自动同步测试
 * ============================================================
 * 背景: 组长在 App 端新上传的视频存飞书 vehicle_videos/, 但不会同步到
 *       GitHub Release media-videos tag → 网页端(无飞书 Secret)无直链不可播。
 *       典型: 长安深蓝(G318)_v2.mp4(audit C2 告警追踪)。
 *
 * 覆盖:
 *  R1 _flattenForAssetKey: 括号→下划线, 保留 _v2 与扩展名(长安深蓝(G318)_v2.mp4 → 长安深蓝_G318_v2.mp4)
 *  R2 detectMissingVideos: 已映射(旧片)跳过, 缺直链(新 _v2 片)检出
 *  R3 buildMappingLine: 生成映射行 'key':'tcgv_<sha10>.mp4'
 *  R4 assetNameFor: 内容相同加 _2 去重
 *  R5 脚本含飞书下载 + gh release upload 关键链路(静态)
 *
 * 运行: node tests/test_v1032_video_release_sync.js
 * 要求: 先红后绿——脚本落地前红, 落地后绿。
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

const scriptPath = path.join(ROOT, 'scripts', 'sync_videos_to_release.js');
const script = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, 'utf8') : '';

section('R1/R2/R3/R4 动态(纯函数)');
try {
  const names = ['_flattenForAssetKey', 'parseMediaDirectAssets', 'detectMissingVideos', 'assetNameFor', 'buildMappingLine'];
  const sandbox = { console, JSON, String, Array, Object, Set };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);
  for (const n of names) vm.runInContext(extractNamedBlock(script, n), ctx, { filename: n + '.js' });

  // R1 扁平化
  check('R1a 括号→下划线且保留 _v2', vm.runInContext("_flattenForAssetKey('长安深蓝(G318)_v2.mp4')", ctx) === '长安深蓝_G318_v2.mp4');
  check('R1b 已扁平化文件名不变', vm.runInContext("_flattenForAssetKey('长安深蓝_G318.mp4')", ctx) === '长安深蓝_G318.mp4');

  // R2 检测缺失
  const map = { '长安深蓝_G318.mp4': 'tcgv_a93a5f2ac6.mp4' };
  sandbox.__map = map;
  const missing = vm.runInContext("detectMissingVideos(['长安深蓝_G318.mp4','长安深蓝(G318)_v2.mp4'], __map)", ctx);
  check('R2a 旧片已映射→跳过', missing.filter(m => m.file === '长安深蓝_G318.mp4').length === 0, JSON.stringify(missing));
  check('R2b 新 _v2 片缺直链→检出(映射 key=原始文件名, App 精确匹配)', missing.length === 1 && missing[0].file === '长安深蓝(G318)_v2.mp4' && missing[0].key === '长安深蓝(G318)_v2.mp4', JSON.stringify(missing));

  // R3 映射行
  check('R3a 生成映射行(key=原始文件名)', vm.runInContext("buildMappingLine('长安深蓝(G318)_v2.mp4','tcgv_abc1234567.mp4')", ctx) === "'长安深蓝(G318)_v2.mp4':'tcgv_abc1234567.mp4',");

  // R4 去重
  check('R4a 内容相同加 _2', vm.runInContext("assetNameFor('ec0bb6fa76', ['tcgv_ec0bb6fa76.mp4'])", ctx) === 'tcgv_ec0bb6fa76_2.mp4');
  check('R4b 无冲突不加后缀', vm.runInContext("assetNameFor('abc1234567', ['tcgv_ec0bb6fa76.mp4'])", ctx) === 'tcgv_abc1234567.mp4');
} catch (e) {
  check('动态执行异常: ' + e.message, false);
}

section('R5 静态(关键链路)');
check('R5a 脚本存在', fs.existsSync(scriptPath));
check('R5b 含飞书下载端点(/files/{token}/download)', script.includes('/download'));
check('R5c 含 gh release upload media-videos', script.includes('release') && script.includes('media-videos'));
check('R5d 含 SHA-256 资产名生成', script.includes('sha256') || script.includes('createHash'));

console.log('\n==============================================================');
console.log('视频同步测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
