#!/usr/bin/env node
/**
 * v10.36 照片回流(scripts/sync_photos_to_repo.js) 契约 + 纯函数测试
 *
 * 背景(为什么必须自动化回流):
 *   车型 82 → 100 期间, vehicle_images/ 停在 188 个文件不动, 66 张新照片只留在
 *   飞书云盘。照片链**没有**视频那样的自动回流(sync_videos_to_release.js),
 *   导致网页端(Pages 静态, 飞书被 CORS 挡)与 App 端同时看不到照片 ——
 *   修 token 也救不回网页端。本套件锁定"回流脚本存在且行为正确"。
 *
 * 覆盖:
 *   S1 静态契约(零硬编码凭据 / 串行下载 / 体积下限 / tag 不串台 / main 守卫)
 *   S2 纯函数(筛选 / 缺失检测 / sha256 / 报告合并)
 *   S3 CLI 契约(--dry-run / --limit / --no-release)
 *   S4 工作流接线(存在 / 引脚本 / 提交 vehicle_images / cron 与视频错开)
 *   S5 注册(package.json 有入口, run_all_tests.js 已纳入 test:all)
 *
 * 注意: 本套件**不联网**——飞书 API 相关只做静态与纯函数校验, 保证 CI 可跑。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'scripts', 'sync_photos_to_repo.js');
const WF = path.join(ROOT, '.github', 'workflows', 'sync-photos-repo.yml');
const IMAGES_DIR = path.join(ROOT, 'vehicle_images');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name + (extra ? ' — ' + extra : '')); console.log('  [FAIL] ' + name + (extra ? ' — ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------- S1 静态契约 ---------- */
section('S1 静态契约: 凭据走 env / 串行下载 / 体积下限 / tag 不串台');
check('S1a scripts/sync_photos_to_repo.js 存在', fs.existsSync(SCRIPT));
const src = fs.existsSync(SCRIPT) ? fs.readFileSync(SCRIPT, 'utf8') : '';

check('S1b 三重凭据全走 env(无硬编码)',
  /process\.env\.FEISHU_APP_ID/.test(src) &&
  /process\.env\.FEISHU_APP_SECRET/.test(src) &&
  /process\.env\.FEISHU_FOLDER_TOKEN/.test(src));
// 硬编码事故: 旧目录 token 曾散落 15 处。新脚本禁止任何 cli_*/裸 token 字面量。
check('S1c 源码无 cli_ 开头的 appId 字面量', !/['"]cli_[a-z0-9]{10,}['"]/.test(src));
check('S1d 源码无裸飞书 folder token 字面量(20+ 位字母数字)',
  !/['"][A-Za-z0-9]{20,}['"]/.test(src.replace(/['"]media-(photos|videos)['"]/g, '')));

check('S1e 串行下载(无 Promise.all 并发, 守飞书 5 QPS)', !/Promise\.all/.test(src));
check('S1f 有最小体积保护(防下载失败空体落盘)', /MIN_BYTES\s*=/.test(src) && /buf\.length\s*<\s*MIN_BYTES/.test(src));
check('S1g 归档 tag 为 media-photos', /MEDIA_TAG\s*=\s*['"]media-photos['"]/.test(src));
check('S1h 不误写 media-videos(与视频归档隔离)', !/['"]media-videos['"]/.test(src));
check('S1i main() 受 require.main 守卫(require 无副作用)', /require\.main\s*===\s*module/.test(src) && /module\.exports/.test(src));
check('S1j 幂等: 本地已存在同名则跳过(重复执行零副作用)', /local\.has\(n\)/.test(src));

/* ---------- S2 纯函数 ---------- */
section('S2 纯函数: 筛选 / 缺失检测 / sha256 / 报告合并');
let m;
try { m = require(SCRIPT); } catch (e) { m = null; }
check('S2a 模块可 require 且导出四项纯函数', !!m &&
  typeof m.filterImageFiles === 'function' && typeof m.detectMissingPhotos === 'function' &&
  typeof m.sha256Of === 'function' && typeof m.mergeReport === 'function',
  m ? '' : 'require 失败');

if (m) {
  const files = [
    { type: 'file', name: 'a_p1_1111.jpeg' },
    { type: 'folder', name: '子目录' },
    { type: 'file', name: 'b_p2_2222.jpg' },
    { type: 'file', name: '说明.txt' },
    { type: 'file', name: 'c_p3_3333.PNG' },
  ];
  const imgs = m.filterImageFiles(files);
  check('S2b filterImageFiles 只留图片(排除文件夹与非图片)',
    imgs.length === 3 && !imgs.some(f => f.type !== 'file'),
    '实际 ' + imgs.length);

  const feishu = ['x_p1_1.jpeg', 'y_p1_2.jpeg', 'z_p1_3.jpeg', 'z_p1_3.jpeg'];
  check('S2c detectMissingPhotos 排除本地已有 + 飞书重名去重',
    JSON.stringify(m.detectMissingPhotos(feishu, ['y_p1_2.jpeg'])) === JSON.stringify(['x_p1_1.jpeg', 'z_p1_3.jpeg']),
    JSON.stringify(m.detectMissingPhotos(feishu, ['y_p1_2.jpeg'])));
  check('S2d 本地为空时全部视为缺失',
    m.detectMissingPhotos(['a.jpeg', 'b.png'], []).length === 2);
  check('S2e 全部已存在时返回空(零副作用)',
    m.detectMissingPhotos(['a.jpeg'], ['a.jpeg', 'x.png']).length === 0);

  check('S2f sha256Of 与标准向量一致',
    m.sha256Of(Buffer.from('abc', 'utf8')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');

  const merged = m.mergeReport(
    { photos: [{ name: 'a.jpeg', sha256: 'SA', feishuToken: 'tok-a', bytes: 10 }] },
    [{ name: 'a.jpeg', sha256: 'SB', bytes: 20 }, { name: 'b.jpeg', sha256: 'SC', bytes: 30 }]
  );
  check('S2g mergeReport 按 name 去重(不产生重复条目)',
    merged.photos.length === 2 && merged.count === 2, '实际 ' + merged.photos.length);
  check('S2h mergeReport 新条目覆盖 sha256/bytes',
    merged.photos.find(p => p.name === 'a.jpeg').sha256 === 'SB' &&
    merged.photos.find(p => p.name === 'a.jpeg').bytes === 20);
  check('S2i mergeReport 保留历史字段(feishuToken 不丢)',
    merged.photos.find(p => p.name === 'a.jpeg').feishuToken === 'tok-a');
  check('S2j mergeReport 输出按 name 排序(便于 diff 稳定)',
    merged.photos[0].name <= merged.photos[1].name);
  check('S2k 索引清单含内容指纹与飞书 token(供迁对象存储/对账)',
    m.mergeReport(null, [{ name: 'n.jpeg', sha256: 'S', feishuToken: 'T' }]).photos[0].feishuToken === 'T');
}

/* ---------- S3 CLI 契约 ---------- */
section('S3 CLI 契约: --dry-run / --limit / --no-release');
check('S3a 支持 --dry-run(只报告不写盘)', /--dry-run/.test(src));
check('S3b --dry-run 时确实跳过写盘', /if\s*\(dryRun\)\s*\{[^}]*不下载不写盘|if\s*\(!dryRun\)\s*fs\.writeFileSync/.test(src));
check('S3c 支持 --limit(控单次 QPS/时长)', /--limit/.test(src) && /slice\(0,\s*limit\)/.test(src));
check('S3d 支持 --no-release(只回仓库不传 Release)', /--no-release/.test(src));
check('S3e Release 凭据缺失不阻塞仓库回流(降级不失败)', /跳过 Release 归档/.test(src));

/* ---------- S4 工作流接线 ---------- */
section('S4 工作流接线: cron 错峰 / 提交 vehicle_images');
check('S4a .github/workflows/sync-photos-repo.yml 存在', fs.existsSync(WF));
const wf = fs.existsSync(WF) ? fs.readFileSync(WF, 'utf8') : '';
check('S4b 工作流执行回流脚本', /node\s+scripts\/sync_photos_to_repo\.js/.test(wf));
check('S4c 凭据全走 secrets(无明文)', /secrets\.FEISHU_APP_ID/.test(wf) && /secrets\.FEISHU_APP_SECRET/.test(wf) && /secrets\.FEISHU_FOLDER_TOKEN/.test(wf));
check('S4d 提交 vehicle_images/ 与索引清单', /git\s+add\s+vehicle_images\s+docs\/photo_sync_report\.json/.test(wf));
check('S4e cron 与视频同步(0 2 * * *)错开, 避免争抢 5 QPS',
  /cron:\s*'30 2 \* \* \*'/.test(wf) && !/cron:\s*'0 2 \* \* \*'/.test(wf));
check('S4f 无新照片时跳过提交(防空提交刷历史)', /无新照片, 跳过提交/.test(wf));

/* ---------- S5 注册 ---------- */
section('S5 注册: 进 package.json 与 test:all');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
check('S5a package.json 有 test:photo-sync 入口',
  pkg.scripts && pkg.scripts['test:photo-sync'] === 'node tests/test_v1036_photo_sync.js',
  pkg.scripts ? pkg.scripts['test:photo-sync'] : '');
const runner = fs.readFileSync(path.join(ROOT, 'scripts', 'run_all_tests.js'), 'utf8');
check('S5b run_all_tests.js TEST_SUITES 已纳入 test:photo-sync', /'test:photo-sync'/.test(runner));

/* ---------- S6 现状观测(不阻断) ---------- */
section('S6 现状观测: 仓库照片数与清单');
if (fs.existsSync(IMAGES_DIR)) {
  const n = fs.readdirSync(IMAGES_DIR).filter(f => m && m.IMG_EXT.test(f)).length;
  console.log(`  [INFO] 仓库 vehicle_images/ 当前 ${n} 个图片文件`);
  console.log('  [INFO] 缺失数量由 npm run audit:media 的 C2 告警给出; 首次运行回流脚本后应显著下降');
} else {
  console.log('  [INFO] 未找到 vehicle_images/, 跳过观测');
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(60));
console.log('照片回流测试汇总: ' + pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(60));
if (fail) {
  console.log('失败项:');
  failures.forEach(f => console.log('  - ' + f));
  console.log('❌ 存在失败');
  process.exit(1);
}
console.log('✅ 全部通过');
