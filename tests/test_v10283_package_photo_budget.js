/**
 * ============================================================
 * test_v10283_package_photo_budget.js - 打包期照片瘦身（V10.27.10）
 * ============================================================
 * 背景: v10.27.9 发版时 APK 21.2MB / IPA 23.3MB 越过飞书单文件约 20MB 上限，
 *   "Sync Release to Feishu" 预上传失败（1061043 file size beyond limit）。
 *   根因是仓库里一张 4.4MB 手机原图被原样打进 www。
 *
 * 约束: 仓库必须保留原图（资源库/COS 用原图），只能压缩**打包副本**。
 *
 * 覆盖:
 *  W组 接线: Android/iOS 发布工作流都在拷完 vehicle_images 之后调用瘦身脚本
 *  S组 行为: dry-run 只报告不改文件 / 预算超限退出 1 /
 *           真实压缩后体积下降且最长边不超过上限 / 全量打包副本回落到预算内
 *
 * 运行: node tests/test_v10283_package_photo_budget.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'shrink_bundled_photos.js');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name); }
}
function section(t) {
  console.log('\n==============================================================');
  console.log(t);
  console.log('==============================================================');
}

function run(args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}
function hasImageMagick() {
  const a = spawnSync('mogrify', ['-version'], { encoding: 'utf8' });
  const b = spawnSync('identify', ['-version'], { encoding: 'utf8' });
  return a.status === 0 && b.status === 0;
}

/** 仓库内最大的 jpg/jpeg（用作"手机原图"样本） */
function biggestPhoto() {
  const dir = path.join(ROOT, 'vehicle_images');
  let best = null;
  (function walk(d) {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (/\.jpe?g$/i.test(ent.name)) {
        const s = fs.statSync(p).size;
        if (!best || s > best.size) best = { path: p, size: s };
      }
    }
  })(dir);
  return best;
}

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'v10283-'));
}

(function main() {
  section('W组: 发布工作流接线');
  const android = fs.readFileSync(path.join(ROOT, '.github/workflows/android-release.yml'), 'utf8');
  const ios = fs.readFileSync(path.join(ROOT, '.github/workflows/ios-release.yml'), 'utf8');
  for (const [name, yml] of [['android-release', android], ['ios-release', ios]]) {
    const cpAt = yml.indexOf('cp -r vehicle_images tcg_app/www/vehicle_images');
    const shrinkAt = yml.indexOf('node scripts/shrink_bundled_photos.js tcg_app/www/vehicle_images');
    check(`W ${name}: 拷贝 vehicle_images 后调用瘦身脚本`, cpAt > 0 && shrinkAt > cpAt);
    check(`W ${name}: 瘦身发生在 Verify bundled web assets 之前`,
      shrinkAt > 0 && shrinkAt < yml.indexOf('Verify bundled web assets'));
  }
  check('W 脚本存在且带预算参数', fs.existsSync(SCRIPT) && fs.readFileSync(SCRIPT, 'utf8').includes('budgetMb'));

  section('S组: 瘦身行为');
  if (!hasImageMagick()) {
    console.log('  [SKIP] 未安装 ImageMagick，跳过压缩行为断言（CI ubuntu-latest 自带）');
  } else {
    const big = biggestPhoto();
    check('S0 仓库存在可测的大图样本(>800KB)', !!big && big.size > 800 * 1024);

    // S1: dry-run 只报告，不改文件
    const d1 = mkTmp();
    fs.copyFileSync(big.path, path.join(d1, 'big.jpg'));
    const h1 = fs.statSync(path.join(d1, 'big.jpg')).size;
    const r1 = run([d1, '--dry-run']);
    check('S1a dry-run 退出 0 且报告待压缩', r1.status === 0 && /dry-run/.test(r1.stdout));
    check('S1b dry-run 不改动文件', fs.statSync(path.join(d1, 'big.jpg')).size === h1);

    // S2: 预算超限 → 退出 1（模拟打完后仍超预算的场景）
    const r2 = run([d1, '--dry-run', '--budget-mb', '1']);
    check('S2 预算超限退出码非 0', r2.status === 1 && /超过预算/.test(r2.stderr));

    // S3: 真实压缩 → 体积下降、最长边不超上限
    const r3 = run([d1, '--budget-mb', '18']);
    const size3 = fs.statSync(path.join(d1, 'big.jpg')).size;
    check('S3a 真实压缩成功', r3.status === 0);
    check('S3b 压缩后体积明显下降(至少省 50%)', size3 < h1 * 0.5);
    const edge = spawnSync('identify', ['-format', '%[fx:max(w,h)]', path.join(d1, 'big.jpg')], { encoding: 'utf8' });
    check('S3c 最长边不超过 1600', parseInt(edge.stdout, 10) <= 1600);

    // S4: 全量打包副本压完后总量回到 18MB 预算内（也就是别再顶穿飞书 20MB）
    const d2 = mkTmp();
    const srcDir = path.join(ROOT, 'vehicle_images');
    spawnSync('cp', ['-r', srcDir + '/.', d2], { encoding: 'utf8' });
    const r4 = run([d2, '--budget-mb', '18']);
    let total = 0;
    (function walk(d) {
      for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, ent.name);
        if (ent.isDirectory()) walk(p);
        else total += fs.statSync(p).size;
      }
    })(d2);
    check('S4 全量打包照片压后 ≤ 18MB 预算', r4.status === 0 && total <= 18 * 1024 * 1024);
    console.log(`  (全量照片 ${(total / 1048576).toFixed(2)}MB)`);
  }

  console.log('\n--------------------------------------------------------------');
  console.log(`汇总: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('失败项: ' + failures.join(' / '));
    process.exit(1);
  }
  console.log('全部通过 OK');
})();
