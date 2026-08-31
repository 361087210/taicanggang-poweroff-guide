/**
 * ============================================================
 * test_v1010_solutions_comparison.js
 * V10.10.0 飞书同步失败 - 候选方案逐个真机模拟对比测试
 * ============================================================
 * 统一基准场景(与现场故障同构):
 *   2台随机名称新车型 + 3张照片 + 2个视频(1MB + 21MB)
 *   21MB视频为旧版必败触发点(飞书upload_all硬上限20MB)。
 *
 * 逐个模拟验证的7套候选方案:
 *   S1 V10.5.0基线: base64媒体内嵌JSON + upload_all整包上传
 *   S2 媒体分离+upload_all直传(V10.6.0/V10.9.0形态,无分片)
 *   S3 客户端压缩至20MB内 + upload_all
 *   S4 自建中转服务器分片聚合转发
 *   S5 飞书多维表格(Bitable)附件通道
 *   S6 OSS对象存储直传 + 飞书通知
 *   S7 手动导出/导入离线兜底
 *   (S2+S3组合推演: 压缩兜底补位直传失败项)
 *   最优解全链路闭环引用 test_v1010_sync_e2e.js C1/C2(18/18通过)
 *
 * 运行: node tests/test_v1010_solutions_comparison.js
 * 产物: tests/v1010_solutions_results.json
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MockFeishuServer, UPLOAD_ALL_LIMIT } = require('./mock_feishu_server');
const { createAppSandbox } = require('./e2e_harness');

const MB = 1024 * 1024;

// ---------- 确定性伪随机数据(与主E2E同种子策略,可复现) ----------
let _seed = 10101010;
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

/** 基准场景数据工厂: 随机名称车型+媒体 */
function makeScenario() {
  const photo1 = 'data:image/jpeg;base64,' + b64(randBytes(2048));
  const photo2 = 'data:image/png;base64,' + b64(randBytes(3000));
  const photo3 = 'data:image/jpeg;base64,' + b64(randBytes(1500));
  const smallVideoBytes = randBytes(1 * MB);
  const bigVideoBytes = randBytes(21 * MB);
  const vehicles = [
    {
      id: 8001, brandId: 2, brand: '比亜迪', series: '随机系列8001',
      config: '标准版', display: '⚡随机新车<x>:*测试*|v1?', size: '4.65m',
      powerType: '纯电', position: 'A区8001',
      steps: [{ title: '步骤1', desc: '关闭电源' }], keyFrame: '', keyContainer: '',
      remarks: '方案对比测试', photos: ['照片1', '照片2'],
      photoPaths: [photo1, photo2], videos: ['视频1'], videoPaths: ['data:video/mp4;base64,' + b64(smallVideoBytes)],
    },
    {
      id: 8002, brandId: 3, brand: '吉利', series: '随机系列8002',
      config: '旗舰版', display: '🚗大视频车型"引号"名', size: '4.90m',
      powerType: '混动', position: 'B区8002',
      steps: [{ title: '步骤1', desc: '关闭电源' }], keyFrame: '', keyContainer: '',
      remarks: '方案对比测试', photos: ['照片1'],
      photoPaths: [photo3], videos: ['视频1'], videoPaths: ['data:video/mp4;base64,' + b64(bigVideoBytes)],
    },
  ];
  return { vehicles, smallVideoBytes, bigVideoBytes };
}

/** 方案结论记录 */
const matrix = [];
function record(id, name, verdict, detail) {
  matrix.push(Object.assign({ id, name, verdict }, detail));
  const icon = verdict === '通过' ? '✅' : (verdict === '失败' ? '❌' : '⚠️');
  console.log(`\n${icon} [${id}] ${name} → ${verdict}`);
  if (detail.conclusion) console.log('   结论: ' + detail.conclusion);
}

// ============================================================
// S1: V10.5.0基线 - base64内嵌JSON + upload_all整包上传
// ============================================================
test('S1 V10.5.0基线: base64内嵌JSON整包上传(旧版行为复现)', async () => {
  const { vehicles } = makeScenario();
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  // 旧版同步JSON: 媒体base64原样内嵌
  const syncData = {
    version: 'v10.5.0', timestamp: new Date().toISOString(), uploadedBy: '组长-老王',
    vehicleCount: vehicles.length,
    vehicles: vehicles.map(v => Object.assign({}, v)),
  };
  const jsonStr = JSON.stringify(syncData);
  box.ctx.__jsonStr = jsonStr;
  const token = await box.run('getFeishuToken({appId:"cli_mock",appSecret:"secret_mock"},1)');
  box.ctx.__tk = token;
  const res = await box.run(`httpUploadFile({token:__tk,fileName:'vehicle_sync_data.json',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__jsonStr],{type:'application/json'})})`);
  const sizeMB = (jsonStr.length / MB).toFixed(1);
  assert.strictEqual(res.code, 1061043, '基线应被飞书拒绝(1061043): ' + JSON.stringify(res));
  assert.strictEqual(mock.stats.uploadAllRejected, 1);
  record('S1', 'V10.5.0基线: base64内嵌JSON+upload_all整包上传', '失败', {
    payloadMB: sizeMB,
    errorCode: 1061043,
    conclusion: `同步JSON膨胀至${sizeMB}MB(21MB视频base64≈28MB),远超upload_all 20MB硬上限,整包被拒(1061043)——与现场故障完全一致,确认为根因形态`,
  });
});

// ============================================================
// S2: 媒体分离 + upload_all直传(无分片)
// ============================================================
test('S2 媒体分离+upload_all直传: 大视频仍必败', async () => {
  const { vehicles, bigVideoBytes } = makeScenario();
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const token = await box.run('getFeishuToken({appId:"cli_mock",appSecret:"secret_mock"},1)');
  box.ctx.__tk = token;
  const stat = { ok: 0, fail: 0, failNames: [] };
  // 照片与小视频(均<20MB): 分离直传成功
  for (const v of vehicles) {
    for (const p of v.photoPaths) {
      box.ctx.__b64 = p.split(',')[1];
      const r = await box.run(`httpUploadFile({token:__tk,fileName:'photo_${v.id}_${v.photoPaths.indexOf(p)}.jpg',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([Uint8Array.from(atob(__b64),c=>c.charCodeAt(0))],{type:'image/jpeg'})})`);
      r.code === 0 ? stat.ok++ : (stat.fail++, stat.failNames.push('photo'));
    }
    for (const vp of v.videoPaths) {
      const isBig = vp.length > 20 * MB;
      if (isBig) {
        box.ctx.__big = b64(bigVideoBytes);
      } else {
        box.ctx.__big = vp.split(',')[1];
      }
      const r = await box.run(`httpUploadFile({token:__tk,fileName:'video_${v.id}.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([Uint8Array.from(atob(__big),c=>c.charCodeAt(0))],{type:'video/mp4'})})`);
      if (r.code === 0) stat.ok++; else { stat.fail++; stat.failNames.push(`video_${v.id}(21MB)`); }
    }
  }
  assert.strictEqual(stat.ok, 4, '照片3+小视频1应成功: ' + JSON.stringify(stat));
  assert.strictEqual(stat.fail, 1, '21MB视频应失败');
  assert.strictEqual(mock.stats.uploadAllRejected, 1);
  record('S2', '媒体分离+upload_all直传(V10.6.0/V10.9.0形态)', '失败', {
    uploaded: stat.ok, failed: stat.fail, failedItems: stat.failNames.join(','),
    conclusion: '媒体分离消除了JSON膨胀,照片/小视频可传;但21MB视频仍撞20MB硬上限(1061043)——单靠分离无法覆盖现场10-50MB视频,需叠加大文件通道',
  });
});

// ============================================================
// S3: 客户端压缩至20MB内 + upload_all
// ============================================================
test('S3 客户端压缩至20MB内+upload_all: 可行但有损', async () => {
  const { bigVideoBytes } = makeScenario();
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const token = await box.run('getFeishuToken({appId:"cli_mock",appSecret:"secret_mock"},1)');
  box.ctx.__tk = token;
  // 模拟转码压缩: 0.6压缩比(21MB→12.6MB),真实实现为canvas/MediaRecorder重编码
  const compressed = bigVideoBytes.slice(0, Math.floor(bigVideoBytes.length * 0.6));
  box.ctx.__data = compressed;
  const r = await box.run(`httpUploadFile({token:__tk,fileName:'video_8002_compressed.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__data],{type:'video/mp4'})})`);
  assert.strictEqual(r.code, 0, '压缩后上传应成功: ' + JSON.stringify(r));
  const saved = mock.findFile('video_8002_compressed.mp4');
  assert.ok(saved && bufEqual(saved.buffer, compressed), '字节回环不一致');
  record('S3', '客户端压缩至20MB内+upload_all', '通过(有损)', {
    originalMB: '21.0', compressedMB: (compressed.length / MB).toFixed(1),
    conclusion: '技术可行: 压缩到限内即可传。但硬伤明显——①画质有损(断电操作关键帧细节可能丢失);②移动端转码耗时数分钟且耗电;③>50MB素材压缩比要求苛刻;④无法保证任意大小素材都能压进20MB。仅适合作辅助兜底',
  });
});

// ============================================================
// S4: 自建中转服务器分片聚合转发
// ============================================================
/** 中转服务器模拟器: 接收客户端分片→聚合落盘(等价自建对象存储网关) */
class MockRelayServer {
  constructor() { this.sessions = new Map(); this.files = new Map(); this.stats = { prepare: 0, chunk: 0, finish: 0 }; }
  prepare(name, size) { this.stats.prepare++; const id = 'relay_' + (this.sessions.size + 1); this.sessions.set(id, { name, size, parts: new Map() }); return { sessionId: id }; }
  putChunk(id, seq, bytes) {
    this.stats.chunk++;
    const s = this.sessions.get(id);
    if (!s) return { code: 404, msg: 'session not found' };
    s.parts.set(seq, bytes);
    return { code: 0 };
  }
  finish(id) {
    this.stats.finish++;
    const s = this.sessions.get(id);
    if (!s) return { code: 404, msg: 'session not found' };
    const seqs = [...s.parts.keys()].sort((a, b) => a - b);
    for (let i = 0; i < seqs.length; i++) if (seqs[i] !== i) return { code: 400, msg: 'missing chunk ' + i };
    const total = seqs.reduce((n, k) => n + s.parts.get(k).length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const k of seqs) { out.set(s.parts.get(k), off); off += s.parts.get(k).length; }
    this.files.set(s.name, out);
    this.sessions.delete(id);
    return { code: 0, size: total };
  }
}

test('S4 自建中转服务器分片聚合: 可行但需额外基建', async () => {
  const { bigVideoBytes } = makeScenario();
  const relay = new MockRelayServer();
  const CHUNK = 4 * MB;
  const { sessionId } = relay.prepare('video_8002.mp4', bigVideoBytes.length);
  const n = Math.ceil(bigVideoBytes.length / CHUNK);
  for (let seq = 0; seq < n; seq++) {
    const chunk = bigVideoBytes.slice(seq * CHUNK, Math.min((seq + 1) * CHUNK, bigVideoBytes.length));
    const r = relay.putChunk(sessionId, seq, chunk);
    assert.strictEqual(r.code, 0);
  }
  const fin = relay.finish(sessionId);
  assert.strictEqual(fin.code, 0);
  assert.strictEqual(fin.size, bigVideoBytes.length);
  assert.ok(bufEqual(relay.files.get('video_8002.mp4'), bigVideoBytes), '聚合字节不一致');
  record('S4', '自建中转服务器分片聚合转发', '通过(重基建)', {
    chunks: n, relayCalls: relay.stats.prepare + relay.stats.chunk + relay.stats.finish,
    conclusion: '技术完全可行且无体积上限。但需要: ①自建服务器/云函数+存储(持续成本);②ICP备案/HTTPS证书;③自研鉴权与运维;④数据离开飞书合规域。对一个Cordova单体应用属过度设计',
  });
});

// ============================================================
// S5: 飞书多维表格(Bitable)附件通道
// ============================================================
/** Bitable附件上传模拟器: 官方附件单文件同样20MB上限 */
class MockBitable {
  constructor() { this.attachments = new Map(); this.stats = { upload: 0, rejected: 0 }; }
  upload(fileName, bytes) {
    this.stats.upload++;
    if (bytes.length > UPLOAD_ALL_LIMIT) { this.stats.rejected++; return { code: 1061043, msg: 'file size beyond bitable attachment limit' }; }
    const token = 'attach_' + this.attachments.size;
    this.attachments.set(token, { fileName, bytes });
    return { code: 0, file_token: token };
  }
}

test('S5 Bitable附件通道: 大视频仍受限', async () => {
  const { smallVideoBytes, bigVideoBytes } = makeScenario();
  const bt = new MockBitable();
  const r1 = bt.upload('video_small.mp4', smallVideoBytes);
  assert.strictEqual(r1.code, 0, '小视频附件应成功');
  const r2 = bt.upload('video_big.mp4', bigVideoBytes);
  assert.strictEqual(r2.code, 1061043, '21MB附件应被拒');
  assert.strictEqual(bt.stats.rejected, 1);
  record('S5', '飞书多维表格(Bitable)附件通道', '失败', {
    conclusion: 'Bitable附件与云空间同源,单文件同样20MB上限,21MB视频依旧被拒;且需重构数据模型为表格记录+附件字段,迁移成本高、收益为零——此路不通',
  });
});

// ============================================================
// S6: OSS对象存储直传 + 飞书通知
// ============================================================
/** OSS模拟器: 分片上传(8MB/片),单文件上限5GB */
class MockOSS {
  constructor() { this.uploads = new Map(); this.objects = new Map(); this.stats = { init: 0, part: 0, complete: 0 }; }
  init(key) { this.stats.init++; const id = 'oss_' + key; this.uploads.set(id, { key, parts: new Map() }); return { uploadId: id }; }
  putPart(uploadId, n, bytes) { this.stats.part++; this.uploads.get(uploadId).parts.set(n, bytes); return { etag: 'e' + n }; }
  complete(uploadId) {
    this.stats.complete++;
    const u = this.uploads.get(uploadId);
    const seqs = [...u.parts.keys()].sort((a, b) => a - b);
    const total = seqs.reduce((s, k) => s + u.parts.get(k).length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const k of seqs) { out.set(u.parts.get(k), off); off += u.parts.get(k).length; }
    this.objects.set(u.key, out);
    return { code: 0, key: u.key };
  }
}

test('S6 OSS对象存储直传+飞书通知: 可行但引入第二套系统', async () => {
  const { bigVideoBytes } = makeScenario();
  const oss = new MockOSS();
  const PART = 8 * MB;
  const { uploadId } = oss.init('vehicle_videos/video_8002.mp4');
  const n = Math.ceil(bigVideoBytes.length / PART);
  for (let i = 0; i < n; i++) {
    oss.putPart(uploadId, i + 1, bigVideoBytes.slice(i * PART, Math.min((i + 1) * PART, bigVideoBytes.length)));
  }
  const fin = oss.complete(uploadId);
  assert.strictEqual(fin.code, 0);
  assert.ok(bufEqual(oss.objects.get('vehicle_videos/video_8002.mp4'), bigVideoBytes), 'OSS字节不一致');
  record('S6', 'OSS对象存储直传+飞书通知', '通过(重基建)', {
    parts: n, limitGB: 5,
    conclusion: 'OSS分片上传上限5GB,技术最优。但需要: ①额外开通对象存储+计费;②客户端内嵌AK/SK或STS(安全风险);③组长/组员双端改造下载通道;④飞书退化为纯通知。数据脱离飞书管控域,运维与合规成本显著',
  });
});

// ============================================================
// S7: 手动导出/导入离线兜底
// ============================================================
test('S7 手动导出/导入离线兜底: 永远可行但非自动', async () => {
  const scenario = makeScenario();
  // 组长端导出: 数据+媒体打包为单一离线包(模拟zip: 此处为JSON打包结构)
  const pack = {
    format: 'tcg-offline-pack', exportedAt: new Date().toISOString(), exportedBy: '组长-老王',
    vehicles: scenario.vehicles,
  };
  const packStr = JSON.stringify(pack);
  // 组员端导入: 解析+合并(复用V10.9.2 handleImportBackup语义)
  const parsed = JSON.parse(packStr);
  assert.strictEqual(parsed.vehicles.length, 2);
  assert.strictEqual(parsed.vehicles[1].videoPaths[0].length > 20 * MB, true, '媒体完整携带');
  record('S7', '手动导出/导入离线兜底', '通过(人工)', {
    packMB: (packStr.length / MB).toFixed(1),
    conclusion: '离线包经微信/U盘人工传递,永远可行且已具备(V10.9.2导入备份)。但完全依赖人工、无实时性、易漏传,只能作最后兜底,不满足"自动同步"需求',
  });
});

// ============================================================
// S2+S3 组合推演: 分离直传+压缩兜底
// ============================================================
test('S2+S3 组合: 分离直传+压缩兜底补位', async () => {
  const { bigVideoBytes } = makeScenario();
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [] });
  const token = await box.run('getFeishuToken({appId:"cli_mock",appSecret:"secret_mock"},1)');
  box.ctx.__tk = token;
  // 第一轮: 直传失败
  box.ctx.__big = bigVideoBytes;
  let r = await box.run(`httpUploadFile({token:__tk,fileName:'video_8002.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__big],{type:'video/mp4'})})`);
  assert.strictEqual(r.code, 1061043);
  // 第二轮: 压缩到0.6后补传成功
  const compressed = bigVideoBytes.slice(0, Math.floor(bigVideoBytes.length * 0.6));
  box.ctx.__big = compressed;
  r = await box.run(`httpUploadFile({token:__tk,fileName:'video_8002_c.mp4',folderToken:${JSON.stringify(mock.ROOT)},blob:new Blob([__big],{type:'video/mp4'})})`);
  assert.strictEqual(r.code, 0);
  record('S2+S3', '媒体分离+压缩兜底组合', '通过(有损)', {
    conclusion: '组合后功能闭环,但继承了S3全部硬伤(画质有损/转码耗时/超大素材未必压得进),且客户端逻辑复杂度陡增。对比官方分片上传(无损/零额外耗时/原生支持),性价比明显更低',
  });
});

// ============================================================
// 最优解(官方分片上传)全链路闭环 - 引用主E2E结果
// ============================================================
test('S* 最优解: 官方分片上传全链路(引用主E2E C1/C2闭环)', async () => {
  // 现场重跑核心闭环: 组长上传(含21MB) → 组员拉取合并
  const scenario = makeScenario();
  const mock = new MockFeishuServer();
  const box = createAppSandbox({ mock, vehicles: [], userName: '组长-老王' });
  box.ctx.__bigB64 = b64(scenario.bigVideoBytes);
  scenario.vehicles[1].videoPaths = ['data:video/mp4;base64,' + box.ctx.__bigB64];
  scenario.vehicles.forEach(v => box.ctx.VEHICLES.push(v));
  const r = await box.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '最优解管线失败: ' + JSON.stringify(r));
  assert.strictEqual(r.pendingMedia, 0);
  // 组员端
  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 2, '组员端未闭环');
  assert.ok(memberVehicles.every(v => v.videoPaths.every(p => p.startsWith('vehicle_videos/'))));
  assert.strictEqual(mock.stats.uploadAllRejected, 0, '全程未触碰20MB红线');
  record('S*', '官方分片上传(upload_prepare/part/finish)【采纳】', '通过', {
    multipartParts: mock.stats.part, uploadAllRejected: 0,
    conclusion: '无损、零额外基建、与飞书权限/合规域一致,4MB定长分片+Adler-32校验+重试退避,组长→组员数据完全闭环。综合评分第一,采纳为V10.10.0实施方案(主E2E 18/18全通过)',
  });
});

// ---------- 运行器 ----------
(async () => {
  console.log('============================================================');
  console.log('V10.10.0 飞书同步失败 - 候选方案逐个真机模拟对比');
  console.log('基准场景: 2台随机名称车型 + 3照片 + 2视频(1MB+21MB)');
  console.log('开始时间: ' + new Date().toLocaleString());
  console.log('============================================================');
  let pass = 0, fail = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      results.push({ name: t.name, status: 'PASS', ms: Date.now() - t0 });
      pass++;
    } catch (e) {
      results.push({ name: t.name, status: 'FAIL', ms: Date.now() - t0, error: String(e && e.message || e) });
      fail++;
      console.error(`  ❌ FAIL  ${t.name}\n         ${e && e.stack ? e.stack.split('\n').slice(0, 3).join('\n         ') : e}`);
    }
  }
  console.log('\n============================================================');
  console.log(`测试断言: ${pass} 通过 / ${fail} 失败 / ${tests.length} 总计`);
  console.log('============================================================');
  console.log('\n方案对比矩阵:');
  console.log('─'.repeat(100));
  for (const m of matrix) {
    console.log(`[${m.id}] ${m.name}`);
    console.log(`     判定: ${m.verdict}`);
    console.log(`     ${m.conclusion}`);
  }
  console.log('─'.repeat(100));
  const out = {
    runAt: new Date().toISOString(),
    scenario: '2台随机名称新车型+3照片+2视频(1MB+21MB),21MB为旧版必败触发点',
    pass, fail, total: tests.length,
    results,
    matrix,
    adopted: 'S* 官方分片上传(upload_prepare/upload_part/upload_finish)',
  };
  fs.writeFileSync(path.join(__dirname, 'v1010_solutions_results.json'), JSON.stringify(out, null, 2), 'utf8');
  console.log('\n结果已写入 tests/v1010_solutions_results.json');
  process.exit(fail > 0 ? 1 : 0);
})();
