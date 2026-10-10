/**
 * ============================================================
 * test_v1025_media_paths_e2e.js - V10.25 媒体三段式布局 · 运行时E2E测试
 * ============================================================
 * 背景: 用户需求「图片/视频按车型名称分文件夹存放, GitHub 与飞书一致,
 *   保证媒体与车型准确对应、避免数据错乱(断电教学视频张冠李戴有现场安全隐患)」。
 *
 * 与 test_v1025_media_paths.js 的分工:
 *   test_v1025_media_paths.js      = 单一真源 js/00-media-paths.js 的纯单元测试;
 *   本文件                          = 运行时接线 E2E —— 把真源注入「应用函数桩沙箱」后,
 *     驱动真实的 syncUploadVehiclePhotos / syncUploadVehicleVideos /
 *     _syncUploadPipeline / _feishuLocatePhotoFile, 验证三段式布局端到端成立。
 *
 * 注入法(为何不能用现成的 DEMO_BLOCKS 通道):
 *   e2e_harness 的 createAppSandbox 用 _buildBlockFileIndex 只索引
 *   function / const|let|var 声明; js/00-media-paths.js 是 IIFE 且未登记进
 *   DEMO_BLOCKS, 故沙箱内 TCG_MEDIA_PATHS 默认不可见(代码自动降级两段式)。
 *   本测试采用「路径(d)」: createAppSandbox() 返回后, 由外部 require('vm')
 *   把 00-media-paths.js 源码 runInContext 进 box.ctx —— 沙箱无 module / self /
 *   require / vm, UMD 走 else 分支且顶层 this = 沙箱全局对象,
 *   于是裸全局 TCG_MEDIA_PATHS 被挂上(与浏览器/Cordova 真机加载语义一致)。
 *   注入发生在管线调用之前, 而业务代码用 typeof 在调用时读取, 故生效。
 *
 * 覆盖:
 *   M1 注入生效: box.ctx.TCG_MEDIA_PATHS 可见且为真源对象
 *   M2 组长端全管线: 照片/视频落 <顶层>/<车型名>/ 子目录, 本地路径回写三段式
 *   M3 幂等: 二次同步零媒体上传(顶层 + 各车型子目录扫描命中, 无冗余副本)
 *   M4 组员端拉取: 三段式媒体路径完整合并到本地(数据闭环)
 *   M5 云端定位: _feishuLocatePhotoFile 逐车型子目录下钻命中(导出/文档路径)
 *   M6 向后兼容: 未注入真源(降级)时保持两段式, 旧数据与旧客户端不受影响
 *
 * 运行: node tests/test_v1025_media_paths_e2e.js
 * ============================================================
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { MockFeishuServer } = require('./mock_feishu_server');
const { createAppSandbox, extractNamedBlock, resolveBlockFile, loadCombinedSource } = require('./e2e_harness');

const ROOT = path.resolve(__dirname, '..');
const MP_PATH = path.join(ROOT, 'js', '00-media-paths.js');
const MP_SRC = fs.readFileSync(MP_PATH, 'utf8');
// 进程内真源实例(用于计算期望子目录名/相对路径; fs/path 参数不影响纯函数结果)
const MP = require(MP_PATH);

const MB = 1024 * 1024;

// ---------- 确定性伪随机数据(可复现) ----------
let _seed = 20260831;
function randBytes(n) {
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
    u8[i] = _seed & 0xff;
  }
  return u8;
}
function b64(u8) { return Buffer.from(u8).toString('base64'); }
function bufEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** 构造测试车辆(与 test_v1010_sync_e2e.js#makeVehicle 同构) */
function makeVehicle(id, display, photos, videos) {
  return {
    id, brandId: (id % 5) + 1, brand: '测试品牌' + (id % 3), series: '随机系列' + id,
    config: '标准版', display, size: '4.65m', powerType: '纯电', position: 'A区' + id,
    steps: [{ title: '步骤1', desc: '关闭电源' }], keyFrame: '', keyContainer: '',
    remarks: 'e2e自动测试数据', photos: photos.map((_, i) => '照片' + (i + 1)),
    photoPaths: photos, videos: videos.map((_, i) => '视频' + (i + 1)), videoPaths: videos,
  };
}

// ---------- 微型测试运行器 ----------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const results = [];

/**
 * 路径(d)注入口: 把单一真源 00-media-paths.js 源码注入应用桩沙箱全局。
 * 沙箱无 module/self/require ⇒ UMD 走 else 分支, 顶层 this = 沙箱全局对象。
 * @returns {object|null} 注入后的 TCG_MEDIA_PATHS(应为真源对象)
 */
function injectMediaPaths(box) {
  vm.runInContext(MP_SRC, box.ctx, { filename: MP_PATH });
  return box.ctx.TCG_MEDIA_PATHS || null;
}

// 跨用例共享的组长端状态(M2→M5)
let mock, box, vehicles, subName, photoFileName, videoFileName;
// M2 原始媒体载荷(供 M3 用完全相同的字节重放, 才能命中同名幂等键)
let m2Media;

// ============================================================
// M1 注入生效
// ============================================================
test('M1 真源注入: 沙箱内 TCG_MEDIA_PATHS 可见且接口完整', async () => {
  const m = new MockFeishuServer();
  const b = createAppSandbox({ mock: m, vehicles: [] });
  // 注入前: 沙箱内该标识符不可见(默认降级两段式的客观证据)
  assert.strictEqual(
    b.run("typeof TCG_MEDIA_PATHS"), 'undefined',
    '注入前沙箱内不应已存在 TCG_MEDIA_PATHS');
  const mp = injectMediaPaths(b);
  assert.ok(mp && typeof mp === 'object', '真源注入失败');
  assert.strictEqual(b.run("typeof TCG_MEDIA_PATHS"), 'object', '注入后沙箱内应可见');
  for (const k of ['PHOTO_TOP', 'VIDEO_TOP', 'SHARED_FOLDER', 'folderNameForVehicle', 'photoRelPath', 'videoRelPath', 'candidateRelPaths', 'parseMediaPath']) {
    assert.ok(k in mp, '真源缺少接口: ' + k);
  }
  assert.strictEqual(b.ctx.TCG_MEDIA_PATHS.PHOTO_TOP, 'vehicle_images');
  assert.strictEqual(b.ctx.TCG_MEDIA_PATHS.VIDEO_TOP, 'vehicle_videos');
});

// ============================================================
// M2 组长端全管线(注入 → 三段式落盘)
// ============================================================
test('M2 组长端全管线: 照片/视频落 <顶层>/<车型名>/ 子目录, 本地路径回写三段式', async () => {
  mock = new MockFeishuServer();
  box = createAppSandbox({ mock, vehicles: [], userName: '组长-老王' });
  assert.ok(injectMediaPaths(box), 'M2 注入失败');

  const photo1 = 'data:image/jpeg;base64,' + b64(randBytes(2048));
  const photo2 = 'data:image/png;base64,' + b64(randBytes(3000));
  const smallVideo = 'data:video/mp4;base64,' + b64(randBytes(512 * 1024));
  // 留档: M3 幂等用例须用完全相同的字节重放(哈希→文件名同名才可命中云端跳过)
  m2Media = { photos: [photo1, photo2], videos: [smallVideo] };
  // 恶意/特殊字符车型名: 验证子目录名与文件名经同一清洗规则, 且准确对应车型
  vehicles = [makeVehicle(9501, '⚡新车型<A1>:/测试*版?', [photo1, photo2], [smallVideo])];
  box.ctx.VEHICLES.length = 0;
  vehicles.forEach(v => box.ctx.VEHICLES.push(v));

  const r = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.photos, 2, '照片替换数不符: ' + JSON.stringify(r));
  assert.strictEqual(r.videos, 1, '视频替换数不符: ' + JSON.stringify(r));
  assert.strictEqual(r.pendingMedia, 0, '不应残留 base64 媒体');

  // 期望子目录名(同一真源纯函数)
  subName = MP.folderNameForVehicle(vehicles[0]);
  assert.ok(subName && subName !== 'vehicle_unknown', '子目录名异常: ' + subName);
  assert.ok(!/[\\/:*?"<>|]/.test(subName), '子目录名仍含非法字符: ' + subName);
  assert.strictEqual(box.ctx.TCG_MEDIA_PATHS.folderNameForVehicle(vehicles[0]), subName, '沙箱内真源与进程内真源结果不一致');

  // 本地路径: 三段式 vehicle_images/<车型名>/<文件>
  for (const p of vehicles[0].photoPaths) {
    assert.ok(p.startsWith('vehicle_images/' + subName + '/'), '照片路径未三段式: ' + p);
  }
  assert.ok(vehicles[0].videoPaths[0].startsWith('vehicle_videos/' + subName + '/'), '视频路径未三段式: ' + vehicles[0].videoPaths[0]);

  // 云端结构: 顶层只有车型子目录(无散落文件), 文件全部落入子目录
  const imgTop = mock.listFolder('APP数据备份/vehicle_images');
  assert.strictEqual(imgTop.filter(f => f.type === 'file').length, 0, '照片顶层出现散落文件(未进车型子目录)');
  const imgSubs = imgTop.filter(f => f.type === 'folder');
  assert.strictEqual(imgSubs.length, 1, '照片顶层应有且仅有 1 个车型子目录');
  assert.strictEqual(imgSubs[0].name, subName, '照片子目录名与真源派生名不一致');

  const vidTop = mock.listFolder('APP数据备份/vehicle_videos');
  assert.strictEqual(vidTop.filter(f => f.type === 'file').length, 0, '视频顶层出现散落文件');
  assert.strictEqual(vidTop.filter(f => f.type === 'folder').length, 1, '视频顶层应有且仅有 1 个车型子目录');
  assert.strictEqual(vidTop.filter(f => f.type === 'folder')[0].name, subName, '视频子目录名与照片不一致');

  // 子目录内文件与本地路径末段一致, 且字节一致(媒体↔车型准确对应)
  photoFileName = vehicles[0].photoPaths[0].split('/').pop();
  videoFileName = vehicles[0].videoPaths[0].split('/').pop();
  const savedPhoto = mock.findFile('APP数据备份/vehicle_images/' + subName + '/' + photoFileName);
  assert.ok(savedPhoto, '云端车型子目录内未找到照片');
  assert.ok(bufEqual(savedPhoto.buffer, Buffer.from(photo1.split(',')[1], 'base64')), '照片字节不一致');
  const savedVideo = mock.findFile('APP数据备份/vehicle_videos/' + subName + '/' + videoFileName);
  assert.ok(savedVideo, '云端车型子目录内未找到视频');
  assert.ok(bufEqual(savedVideo.buffer, Buffer.from(smallVideo.split(',')[1], 'base64')), '视频字节不一致');
});

// ============================================================
// M3 幂等(第二遍零媒体上传)
// ============================================================
test('M3 幂等: 二次同步零媒体上传, 顶层+子目录扫描命中, 无冗余副本', async () => {
  assert.ok(mock && box && vehicles && m2Media, '依赖 M2');
  const before = {
    uploadAll: mock.stats.uploadAll,
    prepare: mock.stats.prepare,
    imgCount: mock.listFolder('APP数据备份/vehicle_images').length,
    vidCount: mock.listFolder('APP数据备份/vehicle_videos').length,
  };
  // 恢复为 M2 的原始 base64 媒体(字节完全相同 ⇒ 哈希相同 ⇒ 文件名相同 ⇒ 云端应命中跳过)
  box.run(`VEHICLES[0].photoPaths=${JSON.stringify(m2Media.photos)};`);
  box.run(`VEHICLES[0].videoPaths=${JSON.stringify(m2Media.videos)};`);

  const r = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '二次管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.photos, 0, '二次上传不应再替换照片(云端命中应跳过)');
  assert.strictEqual(r.videos, 0, '二次上传不应再替换视频(云端命中应跳过)');
  assert.strictEqual(r.pendingMedia, 0, '二次跑完不应残留 base64 媒体');
  assert.strictEqual(mock.stats.prepare, before.prepare, '二次上传不应触发任何媒体分片(prepare)');
  assert.strictEqual(mock.stats.uploadAll, before.uploadAll + 2, '二次仅应重传 JSON+通知两个小文件');
  assert.strictEqual(mock.listFolder('APP数据备份/vehicle_images').length, before.imgCount, '照片目录产生冗余副本');
  assert.strictEqual(mock.listFolder('APP数据备份/vehicle_videos').length, before.vidCount, '视频目录产生冗余副本');

  // 二次跑完后本地路径仍为三段式, 且文件名与首轮一致(未被新哈希改写)
  assert.strictEqual(vehicles[0].photoPaths[0].split('/').pop(), photoFileName, '照片文件名被二次同步改写');
  assert.strictEqual(vehicles[0].videoPaths[0].split('/').pop(), videoFileName, '视频文件名被二次同步改写');
});

// ============================================================
// M4 组员端拉取(三段式路径闭环)
// ============================================================
test('M4 组员端拉取: 三段式媒体路径完整合并到本地', async () => {
  assert.ok(mock && subName, '依赖 M2');
  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 1, '组员端未拉取到车型');
  const mv = memberVehicles[0];
  assert.strictEqual(mv.id, 9501);
  assert.ok(mv.photoPaths.length === 2, '组员端照片路径数不符');
  for (const p of mv.photoPaths) {
    assert.ok(p.startsWith('vehicle_images/' + subName + '/'), '组员端照片路径未三段式: ' + p);
  }
  assert.ok(mv.videoPaths[0].startsWith('vehicle_videos/' + subName + '/'), '组员端视频路径未三段式: ' + mv.videoPaths[0]);
  // 解析回车型归属: parseMediaPath 可还原 folder
  const parsed = MP.parseMediaPath(mv.photoPaths[0]);
  assert.strictEqual(parsed.folder, subName, 'parseMediaPath 未能还原车型子目录');
  assert.strictEqual(parsed.fileName, photoFileName);
});

// ============================================================
// M5 云端定位逐子目录下钻(_feishuLocatePhotoFile)
// ============================================================
test('M5 云端定位: _feishuLocatePhotoFile 逐车型子目录下钻命中', async () => {
  assert.ok(mock && box && subName && photoFileName, '依赖 M2');
  // _feishuLocatePhotoFile 未登记进 DEMO_BLOCKS, 按需提取单块注入(与 createAppSandbox 同源机制)
  const blk = extractNamedBlock(loadCombinedSource(), '_feishuLocatePhotoFile');
  assert.ok(blk && /_feishuLocatePhotoFile/.test(blk), '未能提取 _feishuLocatePhotoFile');
  vm.runInContext(blk, box.ctx, { filename: resolveBlockFile('_feishuLocatePhotoFile') || path.join(ROOT, 'js', '04-export.js') });

  const tokens = await box.run('(async()=>{const cfg=getFeishuCfg();const tk=await getFeishuToken(cfg,2);const df=await getDataFolderToken(tk);return {tk,df};})()');
  assert.ok(tokens && tokens.df, '无法取得数据文件夹 token');

  const found = await box.run(
    `_feishuLocatePhotoFile(${JSON.stringify(tokens.tk)},${JSON.stringify(tokens.df)},${JSON.stringify(photoFileName)})`);
  assert.ok(found, '未定位到子目录内照片文件');
  assert.strictEqual(found.name, photoFileName, '定位到的文件名不符');
  assert.ok(found.token, '定位结果应含文件 token');

  // 负向: 不存在的文件名应返回 null(不误命中)
  const miss = await box.run(
    `_feishuLocatePhotoFile(${JSON.stringify(tokens.tk)},${JSON.stringify(tokens.df)},${JSON.stringify('__not_exist__.jpeg')})`);
  assert.strictEqual(miss, null, '不存在的文件不应被定位');
});

// ============================================================
// M6 向后兼容(未注入 → 降级两段式)
// ============================================================
test('M6 向后兼容: 未注入真源时降级两段式, 顶层扁平布局不受影响', async () => {
  const m = new MockFeishuServer();
  const b = createAppSandbox({ mock: m, vehicles: [], userName: '组长-老旧客户端' });
  assert.strictEqual(b.run("typeof TCG_MEDIA_PATHS"), 'undefined', '本用例不应注入真源');
  const photo = 'data:image/jpeg;base64,' + b64(randBytes(1024));
  const video = 'data:video/mp4;base64,' + b64(randBytes(64 * 1024));
  const vs = [makeVehicle(9601, '降级车型', [photo], [video])];
  vs.forEach(v => b.ctx.VEHICLES.push(v));

  const r = await b.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '降级管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.photos, 1);
  assert.strictEqual(r.videos, 1);

  // 两段式: vehicle_images/<文件>, 无车型子目录
  assert.ok(/^vehicle_images\/[^/]+$/.test(vs[0].photoPaths[0]), '降级照片路径应为两段式: ' + vs[0].photoPaths[0]);
  assert.ok(/^vehicle_videos\/[^/]+$/.test(vs[0].videoPaths[0]), '降级视频路径应为两段式: ' + vs[0].videoPaths[0]);
  const imgTop = m.listFolder('APP数据备份/vehicle_images');
  assert.strictEqual(imgTop.filter(f => f.type === 'folder').length, 0, '降级模式不应创建车型子目录');
  assert.strictEqual(imgTop.filter(f => f.type === 'file').length, 1, '降级模式照片应落顶层');
  const name = vs[0].photoPaths[0].split('/').pop();
  assert.ok(m.findFile('APP数据备份/vehicle_images/' + name), '降级模式顶层照片缺失');
});

// ============================================================
// M7 接线门禁(本测试必须可达, 防被静默摘除)
// ============================================================
test('M7 接线门禁: package.json 与 run_all_tests 均可闭包到达本测试', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const key = 'test:v1025-media-paths-e2e';
  assert.ok(pkg.scripts && pkg.scripts[key], 'package.json 缺少 ' + key);
  assert.ok(String(pkg.scripts[key]).indexOf('test_v1025_media_paths_e2e.js') >= 0, key + ' 未指向本文件');
  const suites = require(path.join(ROOT, 'scripts', 'run_all_tests.js')).TEST_SUITES;
  assert.ok(suites.indexOf(key) >= 0, 'TEST_SUITES 未登记 ' + key + '(将不被 test:all / CI 触达)');
});

// ---------- 执行 ----------
(async () => {
  console.log('============================================================');
  console.log('V10.25 媒体三段式布局 · 运行时E2E测试');
  console.log('开始时间: ' + new Date().toLocaleString('zh-CN'));
  console.log('============================================================\n');
  let pass = 0, fail = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      const ms = Date.now() - t0;
      console.log(`  ✅ PASS  ${t.name}  (${ms}ms)`);
      results.push({ name: t.name, status: 'PASS', ms });
      pass++;
    } catch (e) {
      const ms = Date.now() - t0;
      console.error(`  ❌ FAIL  ${t.name}  (${ms}ms)`);
      console.error('         ' + String(e.stack || e).split('\n').slice(0, 6).join('\n         '));
      results.push({ name: t.name, status: 'FAIL', ms, error: String(e.message || e) });
      fail++;
    }
  }
  console.log('\n============================================================');
  console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${tests.length} 总计`);
  console.log('============================================================');
  process.exit(fail ? 1 : 0);
})();
