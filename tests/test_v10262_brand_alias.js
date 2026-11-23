/**
 * ============================================================
 * test_v10262_brand_alias.js — 品牌别名归一回归
 * ============================================================
 * 背景: 现场多台设备各持本地数据, 同一品牌出现「北汽BAIC / 北汽(BAIC)」两种写法,
 *   一旦有人用旧写法上传, check_field_duplicates 把 CI 判红（已发生两次）。
 *   把云端改成某一种写法后, 下台设备再上传又会改回去 —— 纯数据侧修不干净。
 *
 * 方案: 生成镜像时按 BRAND_ALIASES 归一, 并显式告警；云端原件不动。
 * 本套件钉住:
 *   A1 别名表存在且映射方向正确
 *   A2 归一函数只改命中的品牌, 其他字段/对象原样保留
 *   A3 归一结果让 check_field_duplicates 风格的分裂消失（同品牌只剩一种写法）
 *   A4 未命中别名时返回空清单（不误报）
 *   A5 管线接线: main() 里真的调用归一, 且告警可被 CI 看见（::warning::）
 *
 * 运行: node tests/test_v10262_brand_alias.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const scriptPath = path.join(ROOT, 'scripts/sync_web_data.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const mod = require(scriptPath);
const src = fs.readFileSync(scriptPath, 'utf8');

section('A1 别名表');
check('A1a 导出 BRAND_ALIASES', !!mod.BRAND_ALIASES && typeof mod.BRAND_ALIASES === 'object');
check('A1b 北汽BAIC → 北汽(BAIC)', mod.BRAND_ALIASES && mod.BRAND_ALIASES['北汽BAIC'] === '北汽(BAIC)');
check('A1c 导出 normalizeVehicleFields', typeof mod.normalizeVehicleFields === 'function');

section('A2 归一行为');
const input = [
  { id: 92, brand: '北汽BAIC', series: '北京BJ', display: '北汽BAIC-BJ30e' },
  { id: 100, brand: '北汽(BAIC)', series: '极狐ARCFOX' },
  { id: 1, brand: '比亚迪', series: '海豚' }
];
const snapshot = JSON.parse(JSON.stringify(input));
const r = mod.normalizeVehicleFields(input);
check('A2a 命中别名的改成规范写法', r.vehicles[0].brand === '北汽(BAIC)', r.vehicles[0].brand);
check('A2b 已是规范写法的不动', r.vehicles[1].brand === '北汽(BAIC)');
check('A2c 其他品牌原样', r.vehicles[2].brand === '比亚迪');
check('A2d 其他字段不被改动(series/display)', r.vehicles[0].series === '北京BJ' && r.vehicles[0].display === '北汽BAIC-BJ30e');
check('A2e 归一清单只含 1 条且信息完整',
  r.normalized.length === 1 && r.normalized[0].id === 92 && r.normalized[0].from === '北汽BAIC' && r.normalized[0].to === '北汽(BAIC)',
  JSON.stringify(r.normalized));

section('A3 分裂消失（与 check_field_duplicates 口径一致）');
const brands = Array.from(new Set(r.vehicles.map(v => v.brand)));
check('A3a 归一后同品牌只有一种写法', brands.filter(b => b.indexOf('北汽') === 0).length === 1, brands.join(','));
check('A3b 归一前确实有两种写法(证明这条防线有意义)', new Set(snapshot.map(v => v.brand)).size !== brands.length || snapshot[0].brand !== snapshot[1].brand);

section('A4 未命中不误报');
const r2 = mod.normalizeVehicleFields([{ id: 1, brand: '比亚迪' }, { id: 2, brand: '奇瑞' }]);
check('A4a 无别名时清单为空', r2.normalized.length === 0);
check('A4b 空/非法输入不炸', mod.normalizeVehicleFields(null).normalized.length === 0 && mod.normalizeVehicleFields([null, {}]).normalized.length === 0);

section('A5 管线接线');
check('A5a main() 里调用了 normalizeVehicleFields', /main\(\)[\s\S]{0,4000}normalizeVehicleFields\(vehicle\.vehicles\)/.test(src));
check('A5b 归一后输出可被 CI 看见的 ::warning::', src.indexOf("::warning::[mirror] 品牌写法已归一") >= 0);

console.log('\n==============================================================');
console.log('品牌别名归一回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
