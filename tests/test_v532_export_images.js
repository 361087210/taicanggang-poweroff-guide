/**
 * V5.3.2 导出图片嵌入测试 - 在Node中执行真实导出函数
 * =====================================================
 * 验证问题4根源修复: Word/PDF导出前预取照片(本地→飞书云端)转base64内嵌。
 *
 * 覆盖场景:
 *   E1 照片解析: 本地vehicle_images命中→dataURL; 不存在→null(负缓存)
 *   E2 缓存: 同路径二次解析不再发起网络请求
 *   E3 preparePhotoMap: 真实车辆照片批量预取命中
 *   E4 Word内嵌: generateWord(photoMap)输出含base64<img>; 空map降级为文字占位
 *   E5 PDF内嵌: generatePDF(photoMap)产物含/Image XObject且体积显著增大
 *   E6 张数上限: 超过8张照片的车辆仅预取前8张(防文档体积失控)
 *
 * 运行: node tests/test_v532_export_images.js
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BASE = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(BASE, 'demo.html'), 'utf-8');

// ---------- 最小DOM/环境模拟(沿用test_v53_runtime.js模式) ----------
function el(tag) {
  return {
    tag, classList: {
      _s: new Set(),
      add(c) { this._s.add(c); },
      remove(c) { this._s.delete(c); },
      contains(c) { return this._s.has(c); },
    },
    style: {}, textContent: '', innerHTML: '', src: '',
    parentElement: null, children: [],
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {}, appendChild() {}, remove() {},
    pause() {}, load() {}, play() { return Promise.resolve(); },
  };
}

const registry = {};
['photo-viewer', 'video-player', 'photo-viewer-img', 'photo-viewer-label',
 'video-element', 'bottom-nav', 'fab-add', 'screen-vehicles', 'screen-login',
 'detail-content', 'detail-index'].forEach(id => { registry[id] = el('div'); registry[id].id = id; });

const documentMock = {
  getElementById: id => registry[id] || (registry[id] = Object.assign(el('div'), { id })),
  querySelectorAll: () => [],
  createElement: t => el(t),
  addEventListener() {},
};

// FileReader模拟: 基于Buffer直接产出dataURL(blobToDataURL依赖)
class FileReaderMock {
  constructor() { this.result = null; }
  readAsDataURL(blob) {
    const type = (blob && blob.type) || 'image/jpeg';
    const b64 = blob && blob._buf ? blob._buf.toString('base64') : '';
    this.result = `data:${type};base64,${b64}`;
    if (this.onloadend) this.onloadend({ target: this });
  }
}

// fetch模拟: 仅放行本地vehicle_images相对路径(读仓库真实图片),其余按断网处理
let fetchCallCount = 0;
function mimeOf(name) {
  if (/\.png$/i.test(name)) return 'image/png';
  if (/\.webp$/i.test(name)) return 'image/webp';
  return 'image/jpeg';
}
async function fetchMock(url) {
  const clean = String(url).split('?')[0];
  if (/^vehicle_images\/[\w.-]+$/.test(clean)) {
    const fp = path.join(BASE, clean);
    if (fs.existsSync(fp)) {
      fetchCallCount++;
      const buf = fs.readFileSync(fp);
      return { ok: true, status: 200, blob: async () => ({ size: buf.length, type: mimeOf(clean), _buf: buf }) };
    }
  }
  throw new Error('network blocked in test');
}

const sandbox = {
  console, document: documentMock, navigator: { userAgent: 'NodeTest' },
  setTimeout, clearTimeout, setInterval, clearInterval, Promise, Date, JSON, Math,
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  location: { href: 'http://test.local/demo.html' },
  history: { pushState() {} },
  screen: { width: 1080, height: 2400 },
  fetch: fetchMock,
  FileReader: FileReaderMock,
  Blob, atob, btoa,
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  localStorage: { _m: {}, getItem(k) { return this._m[k] ?? null; }, setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; } },
};

const ctx = vm.createContext(sandbox);
// window/self指向vm全局,使jspdf UMD挂载与window.jspdf取值一致
vm.runInContext('var window = this; var self = this;', ctx);

// ---------- 加载vendor库(与APK内www/vendor同源) ----------
const jspdfCode = fs.readFileSync(path.join(BASE, 'vendor/jspdf.umd.min.js'), 'utf-8');
const autotableCode = fs.readFileSync(path.join(BASE, 'vendor/jspdf.plugin.autotable.min.js'), 'utf-8');
try {
  vm.runInContext(jspdfCode, ctx);
  vm.runInContext(autotableCode, ctx);
} catch (e) {
  console.error('vendor库加载失败:', e.message);
  process.exit(1);
}

// ---------- 注入业务JS ----------
const scripts = [...html.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const js = scripts.join('\n;\n');
try { vm.runInContext(js, ctx); } catch (e) {
  console.error('JS注入失败(顶层执行错误):', e.message);
  process.exit(1);
}

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}`); }
  else { fail++; console.log(`  [FAIL] ${name}  ${detail}`); }
}
function section(t) { console.log(`\n===== ${t} =====`); }

(async () => {
  const V = () => vm.runInContext('VEHICLES', ctx);
  check('VEHICLES已加载', Array.isArray(V()) && V().length >= 70, `实际${V().length}`);

  // ---------- E1 照片解析 ----------
  section('E1 照片解析(fetchPhotoDataURL)');
  const url1 = await vm.runInContext("fetchPhotoDataURL('vehicle_images/image1.jpeg')", ctx);
  check('本地命中返回dataURL', typeof url1 === 'string' && /^data:image\/jpeg;base64,/.test(url1), String(url1).slice(0, 40));
  check('dataURL有效(base64长度>1KB)', url1 && url1.length > 1024, `长度${url1 ? url1.length : 0}`);
  const urlMiss = await vm.runInContext("fetchPhotoDataURL('vehicle_images/not_exist_999.jpeg')", ctx);
  check('不存在的照片返回null(全源未命中)', urlMiss === null);

  // ---------- E2 缓存 ----------
  section('E2 解析缓存');
  const before = fetchCallCount;
  const url1b = await vm.runInContext("fetchPhotoDataURL('vehicle_images/image1.jpeg')", ctx);
  check('二次解析直接走缓存(无新网络请求)', fetchCallCount === before, `fetch调用${before}→${fetchCallCount}`);
  check('缓存结果与首次一致', url1b === url1);

  // ---------- E3 preparePhotoMap ----------
  section('E3 批量预取(preparePhotoMap)');
  const v0 = V().find(v => v.photoPaths && v.photoPaths.length >= 3);
  check('找到带照片的测试车辆', !!v0, '无photoPaths车辆');
  const map = await vm.runInContext(`preparePhotoMap([VEHICLES.find(v=>v.id===${v0.id})])`, ctx);
  const hitCount = Object.keys(map).length;
  check('全部照片命中预取', hitCount === v0.photoPaths.length, `${hitCount}/${v0.photoPaths.length}`);
  check('映射值为dataURL', Object.values(map).every(u => /^data:image\//.test(u)));

  // ---------- E4 Word内嵌 ----------
  section('E4 Word内嵌(generateWord)');
  ctx.__testMap = map;
  const wordBlob = vm.runInContext(`generateWord([VEHICLES.find(v=>v.id===${v0.id})], __testMap)`, ctx);
  const wordHtml = await wordBlob.text();
  const imgCount = (wordHtml.match(/<img src="data:image\//g) || []).length;
  check('Word含base64内嵌图片', imgCount === v0.photoPaths.length, `内嵌${imgCount}/${v0.photoPaths.length}张`);
  check('无"照片未能内嵌"占位', !wordHtml.includes('照片未能内嵌'));
  check('无相对路径img残留', !/src="vehicle_images\//.test(wordHtml));

  const wordBlobNoMap = vm.runInContext(`generateWord([VEHICLES.find(v=>v.id===${v0.id})], {})`, ctx);
  const wordHtmlNoMap = await wordBlobNoMap.text();
  check('空map时降级为文字占位', (wordHtmlNoMap.match(/照片未能内嵌/g) || []).length === v0.photoPaths.length);
  check('Word降级Blob可用(msword类型)', wordBlobNoMap.type === 'application/msword', wordBlobNoMap.type);

  // ---------- E5 PDF内嵌 ----------
  section('E5 PDF内嵌(generatePDF)');
  const pdfBlob = vm.runInContext(`generatePDF([VEHICLES.find(v=>v.id===${v0.id})], __testMap)`, ctx);
  const pdfBuf = Buffer.from(await pdfBlob.arrayBuffer());
  const pdfNoMap = vm.runInContext(`generatePDF([VEHICLES.find(v=>v.id===${v0.id})], {})`, ctx);
  const pdfNoMapBuf = Buffer.from(await pdfNoMap.arrayBuffer());
  check('PDF含图片XObject(/Image)', pdfBuf.includes('/Image'), `大小${pdfBuf.length}`);
  check('PDF含JPEG数据流(SOI标记)', pdfBuf.includes(Buffer.from([0xFF, 0xD8, 0xFF])));
  check('内嵌图片后体积显著增大', pdfBuf.length > pdfNoMapBuf.length + 10000, `${pdfNoMapBuf.length} → ${pdfBuf.length}`);
  check('无map时PDF可正常生成(占位文字)', pdfNoMapBuf.length > 1000 && pdfNoMapBuf.includes('%PDF'));

  // ---------- E6 张数上限 ----------
  section('E6 单车照片上限');
  const many = { ...v0, photoPaths: Array.from({ length: 12 }, (_, i) => `vehicle_images/image${i + 1}.jpeg`) };
  ctx.__manyVehicle = [many];
  const mapMany = await vm.runInContext('preparePhotoMap(__manyVehicle)', ctx);
  check('超过8张仅预取前8张', Object.keys(mapMany).length === 8, `实际${Object.keys(mapMany).length}`);

  // ---------- 汇总 ----------
  console.log(`\n========== 结果: ${pass}通过 / ${fail}失败 ==========`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试执行异常:', e); process.exit(1); });
