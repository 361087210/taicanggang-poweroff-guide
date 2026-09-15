/**
 * ============================================================
 * test_v1029_vehicles_data_sync.js — vehicles_data.js 数据源对账测试(P1)
 * ============================================================
 * Bug: vehicles_data.js(App 打包内置源, 73 车, 停 09-01) 与
 *      web-data/vehicle_sync_data.json(网页镜像, 82 车, cron 每 15 分钟同步)
 *      漂移 —— 9 车缺失 + 8 车改名 + 1 视频缺直链。
 *
 * 期望:
 *  S1 scripts/gen_vehicles_data.js 存在且支持 --check(对账, 漂移即非零退出)
 *  S2 audit_media_consistency.js 接入 C5 数据源对账
 *  S3 动态: gen_vehicles_data.js --check 对当前仓库运行通过(exit 0, 即两源已一致)
 *
 * 运行: node tests/test_v1029_vehicles_data_sync.js
 * 要求: 先红后绿——修复前(73 vs 82 漂移 + 脚本缺失)红, 反向生成后绿。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra){ if(cond){ pass++; console.log('  [PASS] ' + name); } else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); } }
function section(t){ console.log('\n========== ' + t + ' =========='); }

const genJsPath = path.join(ROOT, 'scripts', 'gen_vehicles_data.js');

section('S1/S2 静态');
check('S1a scripts/gen_vehicles_data.js 存在', fs.existsSync(genJsPath));
const genJs = fs.existsSync(genJsPath) ? fs.readFileSync(genJsPath, 'utf8') : '';
check('S1b gen_vehicles_data.js 支持 --check 对账', genJs.includes('--check'));
check('S1c gen_vehicles_data.js 读 web-data 镜像', genJs.includes('vehicle_sync_data.json'));
check('S2a audit_media_consistency.js 接入 C5 对账(读 web-data 镜像)', /vehicle_sync_data\.json/.test(src('scripts/audit_media_consistency.js')));

section('S3 动态: 对账运行(两源一致)');
try {
  execFileSync(process.execPath, ['scripts/gen_vehicles_data.js', '--check'], { cwd: ROOT, stdio: 'pipe' });
  check('S3a gen_vehicles_data.js --check 通过(vehicles_data 与 web-data 一致)', true);
} catch (e) {
  check('S3a gen_vehicles_data.js --check 通过(vehicles_data 与 web-data 一致)', false, (e.stderr || e.stdout || e.message || '').toString().slice(0, 300));
}

console.log('\n==============================================================');
console.log('vehicles_data 对账测试汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
