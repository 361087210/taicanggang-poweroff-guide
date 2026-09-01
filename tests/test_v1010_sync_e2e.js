/**
 * ============================================================
 * test_v1010_sync_e2e.js - V10.10.0 飞书同步修复 真机模拟E2E测试
 * ============================================================
 * 测试策略: 从 demo.html / feishu-api.js 提取真实业务函数, 注入
 * 浏览器API桩沙箱, 全部网络调用路由到高保真 MockFeishuServer
 * (忠实复现官方20MB上限/4MB定长分片/Adler-32校验/错误码语义)。
 *
 * 覆盖矩阵:
 *  A组 单元: 文件名清洗 / Adler-32 / QPS门控
 *  B组 上传路由: 小文件upload_all / 大文件分片 / 超限回归 /
 *               弱网重试 / 事务过期重传 / 500MB上限 / 恶意文件名
 *  C组 全链路真机模拟: 组长上传(随机名+图文视频) → 组员拉取合并 →
 *               幂等二次上传 → JSON体积守卫 → 随机名称压力
 *  D组 FeishuDataLayer(feishu-api.js)分片上传同构验证
 *  E组 发布一致性: 三处版本号对齐
 *
 * 运行: node tests/test_v1010_sync_e2e.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MockFeishuServer, adler32, UPLOAD_ALL_LIMIT } = require('./mock_feishu_server');
const { createAppSandbox, createFeishuApiSandbox } = require('./e2e_harness');

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

// ---------- 微型测试运行器 ----------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const results = [];

/** 构造测试车辆(随机名称+媒体) */
function makeVehicle(id, display, photos, videos) {
  return {
    id, brandId: (id % 5) + 1, brand: '测试品牌' + (id % 3), series: '随机系列' + id,
    config: '标准版', display, size: '4.65m', powerType: '纯电', position: 'A区' + id,
    steps: [{ title: '步骤1', desc: '关闭电源' }], keyFrame: '', keyContainer: '',
    remarks: 'e2e自动测试数据', photos: photos.map((_, i) => '照片' + (i + 1)),
    photoPaths: photos, videos: videos.map((_, i) => '视频' + (i + 1)), videoPaths: videos,
  };
}

// ============================================================
// A组: 单元测试
// ============================================================
test('A1 文件名清洗: 恶意随机名称全部净化为飞书合法名', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const cases = [
    ['my video: *final* <cut>|v2?.mp4', 'my_video_final_cut_v2_.mp4'],
    ['\\server/path\\file.jpeg', 'server_path_file.jpeg'],
    ['"quoted"name.png', 'quoted_name.png'],
    ['控制\u0000字符\u001f名.mp4', '控制字符名.mp4'],
    ['emoji🚗⚡车名.mp4', 'emoji车名.mp4'],
    ['  前后空白  .  ', '前后空白'],
  ];
  for (const [input, expect] of cases) {
    const out = box.run(`_sanitizeFeishuFileName(${JSON.stringify(input)})`);
    assert.strictEqual(out, expect, `清洗结果不符: ${JSON.stringify(input)} → ${JSON.stringify(out)}`);
    // 清洗结果必须不含飞书非法字符
    assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/.test(out), '清洗后仍含非法字符: ' + out);
  }
  // 超长名截断保扩展名
  const long = box.run(`_sanitizeFeishuFileName('a'.repeat(300)+'.mp4')`);
  assert.ok(long.length <= 150, '超长名未截断: ' + long.length);
  assert.ok(long.endsWith('.mp4'), '截断丢失扩展名');
  // 空名兜底
  const empty = box.run(`_sanitizeFeishuFileName('...')`);
  assert.ok(empty.length > 0, '空名未兜底');
  // 幂等: 合法名原样通过
  assert.strictEqual(box.run(`_sanitizeFeishuFileName('user_v9001_p1_ab12cd.jpeg')`), 'user_v9001_p1_ab12cd.jpeg');
});

test('A2 Adler-32校验和: 标准向量与分片实现一致', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  // 标准向量: adler32("abc")=38600999, adler32("Wikipedia")=300286872
  assert.strictEqual(box.run(`_adler32(new TextEncoder().encode('abc'))`), '38600999');
  assert.strictEqual(box.run(`_adler32(new TextEncoder().encode('Wikipedia'))`), '300286872');
  // 与mock服务端实现逐字节一致(随机4MB分片)
  const chunk = randBytes(4 * MB);
  box.ctx.__chunk = chunk;
  const clientSide = box.run(`_adler32(__chunk)`);
  assert.strictEqual(clientSide, adler32(chunk), '客户端/服务端Adler-32不一致');
});

test('A3 QPS门控: 连续上传调用间隔≥220ms(贴官方5QPS飞行)', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const elapsed = await box.run(`(async()=>{const t0=Date.now();await _feishuQpsGate();await _feishuQpsGate();await _feishuQpsGate();return Date.now()-t0;})()`);
  assert.ok(elapsed >= 400, '三次门控总间隔不足(期望≥440ms±容差): ' + elapsed + 'ms');
});

// ============================================================
// B组: 上传路由测试
// ============================================================
test('B1 小文件(1MB)走upload_all单次上传+字节级回环校验', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(1 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'small.bin',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d])})`);
  assert.strictEqual(res.code, 0, '上传失败: ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.uploadAll, 1, '应走upload_all');
  assert.strictEqual(mock.stats.prepare, 0, '不应触发分片');
  const saved = mock.findFile('small.bin');
  assert.ok(saved, '云端未落盘');
  assert.ok(bufEqual(saved.buffer, data), '字节内容不一致');
});

test('B2 17MB文件自动路由分片上传(5片)+字节级回环校验', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(17 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const progress = [];
  box.ctx.__prog = (done, total) => progress.push(done + '/' + total);
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'big17.bin',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d]),onProgress:__prog})`);
  assert.strictEqual(res.code, 0, '分片上传失败: ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.prepare, 1, '应prepare一次');
  assert.strictEqual(mock.stats.part, 5, '17MB应传5片(4×4MB+1MB)');
  assert.strictEqual(mock.stats.finish, 1, '应finish一次');
  assert.strictEqual(mock.stats.uploadAll, 0, '不应走upload_all');
  assert.strictEqual(progress.length, 5, '进度回调缺失');
  const saved = mock.findFile('big17.bin');
  assert.ok(saved && bufEqual(saved.buffer, data), '分片合并后字节不一致');
});

test('B3 21MB视频(旧版必败场景)分片上传成功——根因修复核心验证', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(21 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'video21.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d],{type:'video/mp4'})})`);
  assert.strictEqual(res.code, 0, '21MB上传失败: ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.part, 6, '21MB应传6片');
  assert.strictEqual(mock.stats.uploadAllRejected, 0, '智能路由不应触碰20MB红线');
  const saved = mock.findFile('video21.mp4');
  assert.ok(saved && bufEqual(saved.buffer, data), '字节内容不一致');
});

test('B4 旧版回归对照: upload_all直传21MB必被拒(1061043)——根因复现', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(21 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFile({token:__tk,fileName:'legacy.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d])})`);
  assert.strictEqual(res.code, 1061043, '官方20MB上限未生效,根因模型错误: ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.uploadAllRejected, 1);
});

test('B5 弱网故障注入: 每片首次请求500,客户端3次重试全部救回', async () => {
  const mock = new MockFeishuServer({ failPartOnce: true });
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(17 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'weak.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d])})`);
  assert.strictEqual(res.code, 0, '弱网下分片上传应靠重试成功: ' + JSON.stringify(res));
  assert.ok(mock.stats.partFailed >= 5, '故障注入未生效');
  assert.strictEqual(mock.stats.part, 10, '5片×(1次失败+1次成功)');
  const saved = mock.findFile('weak.mp4');
  assert.ok(saved && bufEqual(saved.buffer, data), '弱网重试后字节不一致');
});

test('B6 事务过期(1061021): 自动重新prepare整段重传成功', async () => {
  const mock = new MockFeishuServer({ expireFirstSession: true });
  const box = createAppSandbox({ mock, vehicles: [] });
  const data = randBytes(17 * MB);
  box.ctx.__d = data;
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'expire.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d])})`);
  assert.strictEqual(res.code, 0, '事务过期应自动重传成功: ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.prepare, 2, '应重新prepare一次');
  const saved = mock.findFile('expire.mp4');
  assert.ok(saved && bufEqual(saved.buffer, data), '重传后字节不一致');
});

test('B7 500MB上限防御: 超限文件明确拒绝而非推上云端', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  let threw = false;
  try {
    await box.run(`httpUploadFileMultipart({token:__tk,fileName:'huge.bin',folderToken:${JSON.stringify(mock.ROOT)},blob:{size:600*1024*1024}})`);
  } catch (e) {
    threw = true;
    assert.ok(/500MB/.test(String(e.message)), '错误信息不明确: ' + e.message);
  }
  assert.ok(threw, '600MB应被拒绝');
});

test('B8 恶意文件名上传: 智能入口统一清洗,云端落盘为合法名', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const token = await box.run(`getFeishuToken({appId:'cli_mock',appSecret:'secret_mock'},1)`);
  box.ctx.__tk = token;
  box.ctx.__d = randBytes(1024);
  const res = await box.run(`httpUploadFileSmart({token:__tk,fileName:'现场:拍摄*最终版<剪>|.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__d])})`);
  assert.strictEqual(res.code, 0);
  const files = mock.listFolder('');
  const hit = files.find(f => f.type === 'file');
  assert.ok(hit, '云端无文件');
  assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/.test(hit.name), '云端文件名仍含非法字符: ' + hit.name);
});

// ============================================================
// C组: 全链路真机模拟(组长上传→组员拉取→幂等→守卫→压力)
// ============================================================
let cMock, cVehicles, cBox; // 跨C1-C3共享的组长端状态

test('C1 组长端全管线: 随机名称新车型+3照片+2视频(含21MB)一次同步成功', async () => {
  cMock = new MockFeishuServer();
  const photo1 = 'data:image/jpeg;base64,' + b64(randBytes(2048));
  const photo2 = 'data:image/png;base64,' + b64(randBytes(3000));
  const photo3 = 'data:image/jpeg;base64,' + b64(randBytes(1500));
  const smallVideo = 'data:video/mp4;base64,' + b64(randBytes(1 * MB));
  cBox = createAppSandbox({ mock: cMock, vehicles: [], userName: '组长-老王' });
  // 21MB大视频在沙箱内构造(避免跨上下文拷贝大对象)
  cBox.ctx.__bigVideoB64 = b64(randBytes(21 * MB));
  const bigVideo = 'data:video/mp4;base64,' + cBox.ctx.__bigVideoB64;
  cVehicles = [
    makeVehicle(9001, '⚡随机新车型<A1>:/测试*版?', [photo1, photo2], [smallVideo]),
    makeVehicle(9002, '🚗大型视频车型"引号"|管道', [photo3], [bigVideo]),
  ];
  cBox.ctx.VEHICLES.length = 0;
  cVehicles.forEach(v => cBox.ctx.VEHICLES.push(v));

  const r = await cBox.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.vehicles, 2);
  assert.strictEqual(r.photos, 3, '照片替换数不符: ' + JSON.stringify(r));
  assert.strictEqual(r.videos, 2, '视频替换数不符: ' + JSON.stringify(r));
  assert.strictEqual(r.photoFailed, 0);
  assert.strictEqual(r.videoFailed, 0);
  assert.strictEqual(r.pendingMedia, 0, '不应有残留base64媒体');

  // 本地路径已原位替换为云端相对路径
  for (const v of cVehicles) {
    for (const p of v.photoPaths) assert.ok(p.startsWith('vehicle_images/'), '照片路径未替换: ' + p);
    for (const p of v.videoPaths) assert.ok(p.startsWith('vehicle_videos/'), '视频路径未替换: ' + p);
  }

  // 云端结构: 同步数据子目录(修复②生效,不再是数据区根)
  const syncJson = cMock.findFile('APP数据备份/同步数据/vehicle_sync_data.json');
  assert.ok(syncJson, 'vehicle_sync_data.json未落入[同步数据]子目录——根因修复②未生效');
  const cloudData = JSON.parse(new TextDecoder('utf-8').decode(syncJson.buffer));
  assert.strictEqual(cloudData.vehicleCount, 2);
  assert.strictEqual(cloudData.uploadedBy, '组长-老王');
  const cloudStr = JSON.stringify(cloudData);
  assert.ok(!/data:(image|video)\//.test(cloudStr), '同步JSON中残留base64媒体');
  assert.ok(cloudStr.length < 1 * MB, '同步JSON未轻量化: ' + cloudStr.length);
  assert.strictEqual(cloudData.vehicles[0].photoPaths[0], cVehicles[0].photoPaths[0], '云端路径与本地不一致');

  // 通知文件落云(组员轻量感知通道)
  const notice = cMock.findFile('APP数据备份/同步数据/data_update_notice.json');
  assert.ok(notice, 'data_update_notice.json缺失');
  const noticeData = JSON.parse(new TextDecoder('utf-8').decode(notice.buffer));
  assert.strictEqual(noticeData.vehicleCount, 2);
  assert.strictEqual(noticeData.videoCount, 2);

  // 媒体文件全部落盘且字节一致
  assert.strictEqual(cMock.listFolder('APP数据备份/vehicle_images').filter(f => f.type === 'file').length, 3);
  assert.strictEqual(cMock.listFolder('APP数据备份/vehicle_videos').filter(f => f.type === 'file').length, 2);
  const bigSaved = (() => {
    const list = cMock.listFolder('APP数据备份/vehicle_videos');
    const name = cVehicles[1].videoPaths[0].replace('vehicle_videos/', '');
    return cMock.findFile('APP数据备份/vehicle_videos/' + name);
  })();
  assert.ok(bigSaved, '21MB大视频云端缺失');
  assert.ok(bufEqual(bigSaved.buffer, Buffer.from(cBox.ctx.__bigVideoB64, 'base64')), '21MB视频字节不一致');
  assert.strictEqual(cMock.stats.uploadAllRejected, 0, '全程不应触碰20MB红线');
  assert.ok(cMock.stats.prepare >= 1, '大视频应走分片上传');
});

test('C2 组员端拉取: 新车型完整合并到本地(数据闭环)', async () => {
  assert.ok(cMock, '依赖C1');
  const memberVehicles = [];
  const mbox = createAppSandbox({ mock: cMock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 2, '组员端未拉取到2条新车型');
  const v1 = memberVehicles.find(v => v.id === 9001);
  const v2 = memberVehicles.find(v => v.id === 9002);
  assert.ok(v1 && v2, '车型ID缺失');
  assert.strictEqual(v1.photoPaths.length, 2);
  assert.ok(v1.photoPaths.every(p => p.startsWith('vehicle_images/')), '组员端照片路径异常');
  assert.ok(v2.videoPaths[0].startsWith('vehicle_videos/'), '组员端视频路径异常');
  assert.strictEqual(v1.display, '⚡随机新车型<A1>:/测试*版?', '随机名称文本未完整同步');
  assert.ok(mbox.stubs.persists >= 1, '拉取合并后未持久化');
  assert.ok(mbox.stubs.toasts.some(t => /数据同步完成/.test(t)), '成功提示缺失: ' + mbox.stubs.toasts.join('|'));
});

test('C3 幂等二次上传: 已上云媒体零流量跳过,云端无冗余副本', async () => {
  assert.ok(cBox, '依赖C1');
  const before = {
    uploadAll: cMock.stats.uploadAll,
    prepare: cMock.stats.prepare,
    part: cMock.stats.part,
    imgCount: cMock.listFolder('APP数据备份/vehicle_images').length,
    vidCount: cMock.listFolder('APP数据备份/vehicle_videos').length,
  };
  const r = await cBox.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '二次管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.photos, 0, '二次上传不应再替换照片');
  assert.strictEqual(r.videos, 0, '二次上传不应再替换视频');
  assert.strictEqual(cMock.stats.uploadAll, before.uploadAll + 2, '二次仅应重传JSON+通知两个小文件');
  assert.strictEqual(cMock.stats.prepare, before.prepare, '二次上传不应触发任何媒体分片');
  assert.strictEqual(cMock.stats.part, before.part, '二次上传不应有任何分片流量');
  assert.strictEqual(cMock.listFolder('APP数据备份/vehicle_images').length, before.imgCount, '媒体目录产生冗余副本');
  assert.strictEqual(cMock.listFolder('APP数据备份/vehicle_videos').length, before.vidCount, '媒体目录产生冗余副本');
});

test('C4 JSON体积守卫: 媒体分离失败残留时诊断性失败,云端数据不被污染', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [], userName: '组长-老王' });
  const goodPhoto = 'data:image/jpeg;base64,' + b64(randBytes(1024));
  const vehicles = [makeVehicle(9101, '正常车型', [goodPhoto], [])];
  vehicles.forEach(v => box.ctx.VEHICLES.push(v));
  const r1 = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r1.ok, true, '基线上传失败: ' + JSON.stringify(r1));
  const beforeBuf = mock.findFile('APP数据备份/同步数据/vehicle_sync_data.json').buffer;

  // 注入损坏的大视频(非base64格式→分离必败→滞留JSON)
  box.ctx.__broken = 'x'.repeat(17 * MB);
  box.run(`VEHICLES.push(${JSON.stringify(makeVehicle(9102, '损坏媒体车型', [], []))}); VEHICLES[VEHICLES.length-1].videoPaths=['data:video/mp4;broken,'+__broken];`);
  const r2 = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r2.ok, false, '守卫未拦截异常大JSON');
  assert.ok(/异常过大/.test(r2.msg || ''), '守卫错误信息不明确: ' + r2.msg);
  assert.strictEqual(r2.videoFailed, 1, '应报告1个媒体失败');
  const afterBuf = mock.findFile('APP数据备份/同步数据/vehicle_sync_data.json').buffer;
  assert.ok(bufEqual(beforeBuf, afterBuf), '守卫失败后云端数据被污染');
});

test('C5 随机名称压力: 5台恶意命名车型+控制字符全部同步成功且云端文件名合法', async () => {
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [], userName: '组长-压力测试' });
  const hostile = ['\u0000\u001f零控制', '斜杠/反斜杠\\双杀', '星号*问号?引号"', '尖括号<大于>管道|', 'emoji🚗⚡🔥混合'];
  for (let i = 0; i < 5; i++) {
    const photo = 'data:image/jpeg;base64,' + b64(randBytes(512 + i * 100));
    const video = 'data:video/mp4;base64,' + b64(randBytes(64 * 1024));
    box.ctx.VEHICLES.push(makeVehicle(9200 + i, hostile[i] + '车型' + i, [photo], [video]));
  }
  const r = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '压力管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.photos, 5);
  assert.strictEqual(r.videos, 5);
  assert.strictEqual(r.photoFailed + r.videoFailed, 0);
  // 云端所有文件名必须合法
  for (const dir of ['APP数据备份/vehicle_images', 'APP数据备份/vehicle_videos']) {
    for (const f of mock.listFolder(dir)) {
      if (f.type !== 'file') continue;
      assert.ok(!/[\\/:*?"<>|\u0000-\u001f]/.test(f.name), '云端非法文件名: ' + f.name);
      assert.ok(f.name.length <= 250, '云端文件名超长: ' + f.name.length);
    }
  }
  // 组员端可完整拉回(含控制字符车型文本)
  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-压力', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 5, '组员端压力数据不完整');
});

// ============================================================
// D组: FeishuDataLayer(feishu-api.js)同构验证
// ============================================================
test('D1 feishu-api.js driveUploadFile: 小文件+17MB分片双路径字节回环', async () => {
  const mock = new MockFeishuServer();
  const fbox = createFeishuApiSandbox({ mock });
  fbox.run(`FeishuAPI.setConfig({ appId: 'cli_mock_app', appSecret: 'secret_mock_123', folderToken: ${JSON.stringify(mock.ROOT)} })`);
  // 小文件
  await fbox.run(`FeishuAPI.driveUploadFile(${JSON.stringify(mock.ROOT)}, 'api_small.json', new Blob(['{"hello":"feishu"}'], {type:'application/json'}))`);
  const small = mock.findFile('api_small.json');
  assert.ok(small, 'feishu-api小文件未落盘');
  assert.strictEqual(new TextDecoder().decode(small.buffer), '{"hello":"feishu"}');
  // 大文件(>16MB自动分片)
  const big = randBytes(17 * MB);
  fbox.ctx.__big = big;
  await fbox.run(`FeishuAPI.driveUploadFile(${JSON.stringify(mock.ROOT)}, 'api_big.mp4', new Blob([__big], {type:'video/mp4'}))`);
  assert.strictEqual(mock.stats.prepare, 1, 'feishu-api分片未触发');
  assert.strictEqual(mock.stats.part, 5);
  const bigSaved = mock.findFile('api_big.mp4');
  assert.ok(bigSaved && bufEqual(bigSaved.buffer, big), 'feishu-api分片合并字节不一致');
});

// ============================================================
// E组: 发布一致性
// ============================================================
test('E1 版本一致性: config.xml / version.json / demo.html(+js模块) 三处动态对齐', async () => {
  const root = path.join(__dirname, '..');
  const configXml = fs.readFileSync(path.join(root, 'config.xml'), 'utf8');
  const versionJson = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  const demoHtml = fs.readFileSync(path.join(root, 'demo.html'), 'utf8');
  // V10.12 A2 拆分: APP_VERSION 常量现在位于 js/00-bootstrap.js, 扫描时需把 demo.html + js/*.js 拼一起
  let combinedSrc = demoHtml;
  const jsDir = path.join(root, 'js');
  if (fs.existsSync(jsDir)) {
    const jsFiles = fs.readdirSync(jsDir).filter(f => f.endsWith('.js')).sort();
    for (const f of jsFiles) combinedSrc += '\n' + fs.readFileSync(path.join(jsDir, f), 'utf8') + '\n';
  }
  // V10.13: 断言改为动态三端一致(发版免改测试); versionCode=major*10000+minor*100+patch
  const ver = versionJson.version;
  assert.ok(/^\d+\.\d+\.\d+$/.test(ver), 'version.json版本格式非法');
  const p = ver.split('.').map(Number);
  const expectCode = p[0] * 10000 + p[1] * 100 + p[2];
  assert.ok(new RegExp(`version="${ver.replace(/\./g, '\\.')}"`).test(configXml), 'config.xml版本未对齐');
  assert.ok(new RegExp(`android-versionCode="${expectCode}"`).test(configXml), 'config.xml versionCode未对齐');
  assert.strictEqual(versionJson.versionCode, expectCode, 'version.json versionCode未对齐');
  assert.ok(new RegExp(`const APP_VERSION\\s*=\\s*'${ver.replace(/\./g, '\\.')}'`).test(combinedSrc), '(demo.html+js模块) APP_VERSION未对齐' + ver);
});

// ---------- 执行 ----------
(async () => {
  console.log('============================================================');
  console.log('V10.10.0 飞书同步修复 · 真机模拟E2E测试');
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
      console.error('         ' + String(e.stack || e).split('\n').slice(0, 5).join('\n         '));
      results.push({ name: t.name, status: 'FAIL', ms, error: String(e.message || e) });
      fail++;
    }
  }
  console.log('\n============================================================');
  console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${tests.length} 总计`);
  console.log('============================================================');
  // 输出机读结果供测试报告引用
  fs.writeFileSync(path.join(__dirname, 'v1010_e2e_results.json'), JSON.stringify({
    runAt: new Date().toISOString(), pass, fail, total: tests.length, results,
  }, null, 2));
  process.exit(fail ? 1 : 0);
})();
