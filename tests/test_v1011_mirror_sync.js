/**
 * ============================================================
 * test_v1011_mirror_sync.js - V10.11.0 组员端镜像同步(删除传播)测试
 * ============================================================
 * Bug: 组员端将云端数据"合并"到本地,但组长删除的车型在组员端
 *      永远滞留——合并逻辑只有正向差集(新增/更新),无反向差集(删除)。
 * 期望: 同源同步,车型数量一致,增减同步(镜像语义,云端为唯一真源)。
 *
 * 覆盖矩阵:
 *  M1 核心: 组长删除车型 → 组员拉取后同步删除,数量一致
 *  M2 混合: 删1+改1+增1 一次同步全部对齐
 *  M3 幂等: 云端无更新时二次拉取不误删
 *  M4 防御: 云端空数据拒绝镜像,本地不被清空
 *  M5 提示: 同步完成文案携带删除计数
 *  M6 闭环: 删除传播后组员端ID集合与云端完全一致
 *
 * 运行: node tests/test_v1011_mirror_sync.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { MockFeishuServer } = require('./mock_feishu_server');
const { createAppSandbox } = require('./e2e_harness');

// ---------- 确定性伪随机 ----------
let _seed = 20261111;
function randBytes(n) {
  const u8 = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
    u8[i] = _seed & 0xff;
  }
  return u8;
}
function b64(u8) { return Buffer.from(u8).toString('base64'); }

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }
const results = [];

/** 构造测试车辆(轻量媒体,聚焦同步语义) */
function makeVehicle(id, display) {
  const photo = 'data:image/jpeg;base64,' + b64(randBytes(1024));
  return {
    id, brandId: (id % 5) + 1, brand: '测试品牌' + (id % 3), series: '系列' + id,
    config: '标准版', display, size: '4.65m', powerType: '纯电', position: 'A区' + id,
    steps: [{ title: '步骤1', desc: '关闭电源' }], keyFrame: '', keyContainer: '',
    remarks: '镜像同步测试', photos: ['照片1'], photoPaths: [photo],
    videos: [], videoPaths: [],
  };
}

// ============================================================
// M1 核心: 组长删除车型 → 组员同步删除,数量一致
// ============================================================
test('M1 组长删除1台车型再上传,组员拉取后同步删除,两端数量一致', async () => {
  const mock = new MockFeishuServer();
  // 组长端: 3台车型上云
  const leaderVehicles = [makeVehicle(101, '车型A'), makeVehicle(102, '车型B'), makeVehicle(103, '车型C')];
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  let r = await lbox.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '组长首次上传失败: ' + JSON.stringify(r));

  // 组员端: 首次拉取 → 3台
  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 3, '首次拉取应为3台');

  // 组长删除车型A(102)后再上传 → 云端2台
  const idx = leaderVehicles.findIndex(v => v.id === 102);
  leaderVehicles.splice(idx, 1);
  r = await lbox.run('_syncUploadPipeline()');
  assert.strictEqual(r.ok, true, '组长删除后上传失败: ' + JSON.stringify(r));

  // 组员再拉取: 期望镜像同步,删除传播
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 2, `删除未传播: 组员端仍${memberVehicles.length}台,应为2台(与云端一致)`);
  const ids = memberVehicles.map(v => v.id).sort();
  assert.deepStrictEqual(ids, [101, 103], '组员端ID集合与云端不一致');
});

// ============================================================
// M2 混合: 删1 + 改1 + 增1,一次同步全部对齐
// ============================================================
test('M2 删1+改1+增1混合场景一次同步全部对齐,数量一致', async () => {
  const mock = new MockFeishuServer();
  const leaderVehicles = [makeVehicle(201, '原始1'), makeVehicle(202, '原始2'), makeVehicle(203, '原始3')];
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  await lbox.run('_syncUploadPipeline()');

  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 3);

  // 组长: 删202 / 改201 / 增204
  leaderVehicles.splice(leaderVehicles.findIndex(v => v.id === 202), 1);
  const v201 = leaderVehicles.find(v => v.id === 201);
  v201.display = '已修改的1号';
  v201.remarks = '组长端修改过';
  leaderVehicles.push(makeVehicle(204, '新增4号'));
  await lbox.run('_syncUploadPipeline()');

  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 3, '增删相抵后应为3台');
  const ids = memberVehicles.map(v => v.id).sort();
  assert.deepStrictEqual(ids, [201, 203, 204], '混合同步后ID集合不符');
  const m201 = memberVehicles.find(v => v.id === 201);
  assert.strictEqual(m201.display, '已修改的1号', '更新未传播');
  assert.strictEqual(m201.remarks, '组长端修改过', '更新字段未传播');
  const m202 = memberVehicles.find(v => v.id === 202);
  assert.strictEqual(m202, undefined, '已删除车型202仍残留在组员端');
});

// ============================================================
// M3 幂等: 云端无更新时二次拉取不误删不重复
// ============================================================
test('M3 云端无更新时组员二次拉取: 数量稳定,不误删不重复', async () => {
  const mock = new MockFeishuServer();
  const leaderVehicles = [makeVehicle(301, '稳定1'), makeVehicle(302, '稳定2')];
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  await lbox.run('_syncUploadPipeline()');

  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 2);
  // 云端未变,再次拉取
  await mbox.run('doSyncDownload()');
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 2, '重复拉取导致数量漂移');
  const ids = memberVehicles.map(v => v.id).sort();
  assert.deepStrictEqual(ids, [301, 302]);
});

// ============================================================
// M4 防御: 云端空数据拒绝镜像,本地不被清空
// ============================================================
test('M4 云端车辆数为0时拒绝镜像,本地数据不被误清空', async () => {
  const mock = new MockFeishuServer();
  // 组长上传1台
  const leaderVehicles = [makeVehicle(401, '防御用')];
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  await lbox.run('_syncUploadPipeline()');

  const memberVehicles = [makeVehicle(402, '组员本地已有')];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  // 手工构造云端空数据(模拟上传中断/异常): 直接篡改云端JSON
  const token = await mbox.run('getFeishuToken({appId:"cli_mock",appSecret:"secret_mock"},1)');
  mbox.ctx.__tk = token;
  const emptyData = JSON.stringify({ version: 'v10.11.0', timestamp: new Date().toISOString(), uploadedBy: 'x', vehicleCount: 0, vehicles: [] });
  mbox.ctx.__empty = emptyData;
  await mbox.run(`httpUploadFile({token:__tk,fileName:'vehicle_sync_data.json',folderToken:${JSON.stringify('MOCK_NONEXIST')},blob:new Blob([__empty],{type:'application/json'})})`).catch(() => {});
  // 通过正常管线读取路径注入空数据: 直接在云端正确目录写入空数据文件
  const okUp = await mbox.run(`(async()=>{const cfg=JSON.parse(localStorage.getItem('feishu_config'));const t=await getFeishuToken(cfg,1);return await uploadJsonToDataFeishu(t,'vehicle_sync_data.json',__empty,cfg.syncSub);})()`);
  assert.ok(okUp, '注入空数据失败');
  await mbox.run('doSyncDownload()');
  assert.strictEqual(memberVehicles.length, 1, '云端空数据误清空了本地');
});

// ============================================================
// M5 提示: 同步完成文案携带删除计数
// ============================================================
test('M5 删除传播发生时,同步完成提示包含删除计数', async () => {
  const mock = new MockFeishuServer();
  const leaderVehicles = [makeVehicle(501, 'A'), makeVehicle(502, 'B')];
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  await lbox.run('_syncUploadPipeline()');

  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');

  leaderVehicles.pop(); // 删除502
  await lbox.run('_syncUploadPipeline()');
  await mbox.run('doSyncDownload()');
  const delToast = mbox.stubs.toasts.find(t => /删除\s*1\s*条/.test(t));
  assert.ok(delToast, '提示未携带删除计数: ' + mbox.stubs.toasts.join(' | '));
  assert.ok(mbox.stubs.persists >= 2, '删除传播后未持久化');
});

// ============================================================
// M6 闭环: 多轮增删后组员端ID集合与云端完全一致
// ============================================================
test('M6 多轮增删压力: 组员端ID集合与组长端最终态完全一致', async () => {
  const mock = new MockFeishuServer();
  const leaderVehicles = [];
  for (let i = 601; i <= 606; i++) leaderVehicles.push(makeVehicle(i, '多轮' + i));
  const lbox = createAppSandbox({ mock, vehicles: leaderVehicles, userName: '组长-老王' });
  await lbox.run('_syncUploadPipeline()');

  const memberVehicles = [];
  const mbox = createAppSandbox({ mock, vehicles: memberVehicles, userName: '组员-小李', role: 'member' });
  await mbox.run('doSyncDownload()');

  // 轮1: 删601,602
  leaderVehicles.splice(0, 2);
  await lbox.run('_syncUploadPipeline()');
  await mbox.run('doSyncDownload()');
  // 轮2: 增607,删603
  leaderVehicles.push(makeVehicle(607, '多轮607'));
  leaderVehicles.splice(leaderVehicles.findIndex(v => v.id === 603), 1);
  await lbox.run('_syncUploadPipeline()');
  await mbox.run('doSyncDownload()');
  // 轮3: 全删后只留1台
  leaderVehicles.length = 0;
  leaderVehicles.push(makeVehicle(608, '最终仅存'));
  await lbox.run('_syncUploadPipeline()');
  await mbox.run('doSyncDownload()');

  assert.strictEqual(memberVehicles.length, 1, '多轮增删后数量不一致');
  assert.strictEqual(memberVehicles[0].id, 608, '最终态ID不符');
  const leaderIds = leaderVehicles.map(v => v.id).sort();
  const memberIds = memberVehicles.map(v => v.id).sort();
  assert.deepStrictEqual(memberIds, leaderIds, '组员端与组长端最终态ID集合不一致');
});

// ---------- 运行器 ----------
(async () => {
  console.log('============================================================');
  console.log('V10.11.0 组员端镜像同步(删除传播)测试');
  console.log('开始时间: ' + new Date().toLocaleString());
  console.log('============================================================');
  let pass = 0, fail = 0;
  for (const t of tests) {
    const t0 = Date.now();
    try {
      await t.fn();
      results.push({ name: t.name, status: 'PASS', ms: Date.now() - t0 });
      pass++;
      console.log(`  ✅ PASS  ${t.name}  (${Date.now() - t0}ms)`);
    } catch (e) {
      results.push({ name: t.name, status: 'FAIL', ms: Date.now() - t0, error: String(e && e.message || e) });
      fail++;
      console.log(`  ❌ FAIL  ${t.name}  (${Date.now() - t0}ms)`);
      console.log(`         ${e && e.message}`);
    }
  }
  console.log('============================================================');
  console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${tests.length} 总计`);
  console.log('============================================================');
  fs.writeFileSync(path.join(__dirname, 'v1011_mirror_sync_results.json'), JSON.stringify({ runAt: new Date().toISOString(), pass, fail, total: tests.length, results }, null, 2), 'utf8');
  process.exit(fail > 0 ? 1 : 0);
})();
