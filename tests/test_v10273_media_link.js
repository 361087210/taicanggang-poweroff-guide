/**
 * ============================================================
 * test_v10273_media_link.js — 车型详情 ↔ 资源库 双向强关联回归
 * ============================================================
 * 覆盖:
 *   L1 模块导出: openPath / openForVehicle / decorateVehicleMedia / vehicleSummary
 *   L2 详情页装饰: 每张照片/视频叠加资源库状态徽标(已入库/共享/缺失/云端/低清),
 *      板块标题汇总随资产状态现算, 重复装饰不产生重复徽标
 *   L3 车型 → 资源库: openForVehicle 只保留该车型引用的资产, 可清除收窄
 *   L4 资产 → 资源库: openPath 自动翻到资产所在分页并高亮该行
 *   L5 接线: 03-vehicles.js 挂 data-media-path 且调用装饰; demo.html 顺序正确
 *   L6 索引加载去重: 并发装饰+定位只拉一次 media_library.json
 *
 * 运行: node tests/test_v10273_media_link.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MOD = path.join(ROOT, 'js', '13-media-library.js');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

/* ---------------- 极简 DOM 桩 ---------------- */
function El(id, attrs) {
  this.id = id || '';
  this.attrs = attrs || {};
  this.children = [];
  this._html = '';
  this.textContent = '';
  this.className = '';
  this.type = '';
  this.style = {};
  this.onclick = null;
}
El.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
El.prototype.getAttribute = function (k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; };
El.prototype.appendChild = function (c) { this.children.push(c); return c; };
El.prototype.classList = { add: function () {} };
El.prototype.querySelectorAll = function (sel) {
  if (sel === '[data-media-badge]') {
    return this.children.filter(function (c) { return c.getAttribute('data-media-badge') === '1'; });
  }
  return [];
};
El.prototype.querySelector = function (sel) {
  if (sel === '[data-media-badge]') {
    return this.children.filter(function (c) { return c.getAttribute('data-media-badge') === '1'; })[0] || null;
  }
  return null;
};
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return this._html; },
  set: function (v) { this._html = String(v); }
});

function makeEnv(ledger, vehicles, fetchDelay) {
  const els = {};
  const getEl = function (id) { return els[id] || (els[id] = new El(id)); };
  const detail = new El('detail-content');
  detail.tiles = [];
  detail.summaries = { photo: new El('', { 'data-media-summary': 'photo' }), video: new El('', { 'data-media-summary': 'video' }) };
  detail.querySelectorAll = function (sel) {
    return sel === '[data-media-path]' ? detail.tiles : [];
  };
  detail.querySelector = function (sel) {
    const m = /data-media-summary="(\w+)"/.exec(sel);
    return m ? (detail.summaries[m[1]] || null) : null;
  };
  els['detail-content'] = detail;

  const doc = {
    getElementById: getEl,
    createElement: function () { return new El('tmp'); },
    querySelectorAll: function () { return []; },
    body: { appendChild: function () {} }
  };
  let fetchCount = 0;
  const ctx = {
    window: {}, document: doc, console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    fetch: function () {
      fetchCount++;
      const go = function () { return { ok: true, json: function () { return Promise.resolve(JSON.parse(JSON.stringify(ledger))); } }; };
      return fetchDelay ? new Promise(function (res) { setTimeout(function () { res(go()); }, fetchDelay); }) : Promise.resolve(go());
    },
    XMLHttpRequest: undefined
  };
  ctx.window.VEHICLES = vehicles || [];
  ctx.VEHICLES = ctx.window.VEHICLES;
  vm.createContext(ctx);
  vm.runInContext(src('js/13-media-library.js'), ctx, { filename: MOD });
  return { ctx: ctx, els: els, detail: detail, fetches: function () { return fetchCount; } };
}

const sleep = (ms) => new Promise(function (r) { setTimeout(r, ms); });

function asset(path, kind, status, vehicles, extra) {
  const a = {
    path: path, kind: kind, kindLabel: kind === 'video' ? '视频' : '照片',
    status: status, vehicleText: (vehicles[0] && vehicles[0].display) || '',
    vehicles: vehicles
  };
  if (extra) Object.keys(extra).forEach(function (k) { a[k] = extra[k]; });
  return a;
}

const A1 = 'vehicle_images/A/a1.jpeg';
const A2 = 'vehicle_images/A/a2.jpeg';
const AS = 'vehicle_images/_共享/s.jpeg';
const AV = 'vehicle_videos/A/v1.mp4';
const B1 = 'vehicle_images/B/b1.jpeg';

const V1 = { id: 1, display: 'A', photoPaths: [A1, A2, AS], videoPaths: [AV] };
const V2 = { id: 2, display: 'B', photoPaths: [AS, B1], videoPaths: [] };
const V3 = { id: 3, display: 'C', photoPaths: [], videoPaths: [] };

const LEDGER = {
  schemaVersion: 1,
  generatedAt: '2026-11-24T00:00:00Z',
  stats: {},
  assets: [
    asset(A1, 'photo', 'ok', [{ id: 1, display: 'A' }], { sha256: 'x1' }),
    asset(A2, 'photo', 'missing', [{ id: 1, display: 'A' }], { missingFor: [{ id: 1, display: 'A' }] }),
    asset(AS, 'photo', 'shared', [{ id: 1, display: 'A' }, { id: 2, display: 'B' }], { lowRes: true, resText: '433×606' }),
    asset(AV, 'video', 'remote', [{ id: 1, display: 'A' }]),
    asset(B1, 'photo', 'ok', [{ id: 2, display: 'B' }])
  ],
  orphans: []
};

/* ---------------- L1 导出 ---------------- */
section('L1 模块导出');
const env = makeEnv(LEDGER, [V1, V2, V3]);
const ML = env.ctx.window.MediaLibrary;
check('L1a 模块可加载', !!ML);
check('L1b 双向联动函数已导出',
  !!(ML && ML.openPath && ML.openForVehicle && ML.decorateVehicleMedia && ML.vehicleSummary && ML.clearVehicleFocus));

/* ---------------- L2 详情页装饰 ---------------- */
section('L2 详情页媒体徽标与汇总');
ML.openPath(B1);                       // 触发索引加载
sleep(20).then(function () {
  /* 构造详情页媒体格子(模拟 03-vehicles.js 输出) */
  [A1, A2, AS].forEach(function (p) { env.detail.tiles.push(new El('', { 'data-media-path': p })); });
  ML.decorateVehicleMedia(V1);
  const badge = function (i) {
    const list = env.detail.tiles[i].querySelectorAll('[data-media-badge]');
    return list.length ? list[0].textContent : '';
  };
  check('L2a 正常照片标「正常」', badge(0) === '正常', badge(0));
  check('L2b 缺失照片标「缺失」', badge(1) === '缺失', badge(1));
  check('L2c 共享+低清照片标「共享 · 低清」', badge(2) === '共享 · 低清', badge(2));
  check('L2d 照片板块汇总随状态现算', env.detail.summaries.photo.textContent === '3 项 · 1 缺失 · 1 共享 · 1 低清',
    env.detail.summaries.photo.textContent);
  check('L2e 视频板块汇总只算视频', env.detail.summaries.video.textContent === '1 项', env.detail.summaries.video.textContent);
  ML.decorateVehicleMedia(V1);
  check('L2f 重复装饰不叠加徽标', env.detail.tiles.every(function (t) {
    return t.querySelectorAll('[data-media-badge]').length === 1;
  }));
  const btn = env.detail.tiles[1].querySelectorAll('[data-media-badge]')[0];
  check('L2g 徽标是按钮且可点按(不冒泡到照片查看器)', btn && btn.type === 'button' && typeof btn.onclick === 'function');

  section('L3 车型 → 资源库收窄');
  ML.openForVehicle(1);
  let html = env.els['screen-media-library'].innerHTML;
  check('L3a 只显示该车型引用的资产', html.indexOf(A1) >= 0 && html.indexOf(AV) >= 0 && html.indexOf(B1) < 0);
  check('L3b 顶部显示「只看车型」并可清除', html.indexOf('只看车型：A') >= 0 && html.indexOf('clearVehicleFocus') >= 0);
  ML.clearVehicleFocus();
  html = env.els['screen-media-library'].innerHTML;
  check('L3c 清除收窄后恢复全量', html.indexOf(B1) >= 0);
  ML.openForVehicle(3);
  html = env.els['screen-media-library'].innerHTML;
  check('L3d 无素材车型给出明确空态', html.indexOf('这台车还没有媒体资产') >= 0);

  /* ---------------- L4 资产 → 资源库定位 ---------------- */
  section('L4 openPath 分页定位与高亮');
  const many = [];
  for (let i = 0; i < 120; i++) many.push(asset('vehicle_images/X/f' + i + '.jpeg', 'photo', 'ok', [{ id: 9, display: 'X' }]));
  const target = many[60].path;
  const env2 = makeEnv({ schemaVersion: 1, generatedAt: '2026-11-24T00:00:00Z', assets: many, orphans: [] }, []);
  const M2 = env2.ctx.window.MediaLibrary;
  M2.openPath(target);
  return sleep(30).then(function () {
    const h = env2.els['screen-media-library'].innerHTML;
    check('L4a 自动翻到资产所在分页', h.indexOf('第 2/3 页') >= 0, h.match(/第 \d+\/\d+ 页/));
    check('L4b 目标行被高亮', h.indexOf('ring-2 ring-blue-400') >= 0 && h.indexOf(target) >= 0);
    check('L4c 非目标行不高亮', (h.match(/ring-2 ring-blue-400/g) || []).length === 1);

    /* ---------------- L5 接线 ---------------- */
    section('L5 前端接线');
    const vjs = src('js/03-vehicles.js');
    check('L5a 照片格子挂 data-media-path', vjs.indexOf('data-media-path="${esc(src)}"') >= 0);
    check('L5b 视频卡片挂 data-media-path', vjs.indexOf('data-media-path="${esc(vp)}"') >= 0);
    check('L5c 详情渲染后调用资源库装饰', vjs.indexOf('MediaLibrary.decorateVehicleMedia(v)') >= 0);
    check('L5d 两个媒体板块都有资源库入口', (vjs.match(/MediaLibrary\.openForVehicle\(\$\{v\.id\}\)/g) || []).length === 2);
    const demo = src('demo.html');
    const i3 = demo.indexOf('js/03-vehicles.js');
    const i13 = demo.indexOf('js/13-media-library.js');
    check('L5e demo.html 同时加载 03 与 13 且 13 在后', i3 > 0 && i13 > i3);

    /* ---------------- L6 索引加载去重 ---------------- */
    section('L6 并发加载只拉一次索引');
    const env3 = makeEnv(LEDGER, [V1, V2], 20);
    const tile3 = new El('', { 'data-media-path': A1 });
    env3.detail.tiles.push(tile3);
    env3.ctx.window.MediaLibrary.openPath(AS);
    env3.ctx.window.MediaLibrary.decorateVehicleMedia(V1);
    return sleep(60).then(function () {
      check('L6a 并发装饰+定位只请求一次索引', env3.fetches() === 1, 'fetches=' + env3.fetches());
      check('L6b 装饰仍能拿到状态', tile3.querySelectorAll('[data-media-badge]')[0] !== undefined);
      finish();
    });
  });
}).catch(function (e) {
  check('用例执行', false, e && e.stack || e);
  finish();
});

function finish() {
  console.log('\n==============================================================');
  console.log('车型↔资源库联动回归汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  console.log('全部通过 OK');
}
