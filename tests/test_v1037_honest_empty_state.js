#!/usr/bin/env node
/**
 * ============================================================
 * test_v1037_honest_empty_state.js —— V10.20.1「诚实空态」
 * ============================================================
 * 事故背景:
 *   22 个车型 / 65 张照片在飞书账号重置期间丢失, 云端与本地**都没有**。
 *   但旧代码对"照片加载失败"的处理是: 塞一张灰色占位图(详情格换 img.src、
 *   列表缩略图换 _imgPlaceholder())—— 格子仍可点击、仍挂着"前脸照片"标签,
 *   视觉上完全等同于"网络慢/还没加载出来"。用户在船期现场无法判断
 *   "文件真没了"还是"再等等就有", 会一直刷页面, 属于**骗用户**的空态。
 *
 * 修复原则(诚实空态):
 *   ① 说清事实: "照片缺失 / 云端与本地均无此文件, 请联系组长补传"
 *   ② 去掉误导: 整格替换(移除 onclick、虚线边框), 不再是"可点开的照片位"
 *   ③ 区分两种缺失(处置方式完全不同):
 *        missing = 登记了文件名但取不到 → 联系组长补传
 *        never   = 车型压根没登记这张   → 需要重新拍摄并上传
 *
 * 覆盖:
 *   S1 静态契约(灰图占位已删除 / 三条接线正确 / 文案就位)
 *   S2 行为: 详情格替换(jsdom)
 *   S3 行为: 列表缩略图替换(jsdom)
 *   S4 行为: 查看器大图两种文案 + XML 转义(jsdom)
 *   S5 注册(package.json 入口 + run_all_tests 已纳入 test:all)
 *
 * 注意: 本套件**不联网**; 飞书回退链用 stub 强制返回"未命中"。
 * 运行: node tests/test_v1037_honest_empty_state.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');
const { extractNamedBlock } = require('./e2e_harness');

const ROOT = path.resolve(__dirname, '..');
const MEDIA = path.join(ROOT, 'js', '06-media.js');
const VEHICLES = path.join(ROOT, 'js', '03-vehicles.js');

let pass = 0, fail = 0;
const failures = [];
function check(n, c, e) {
  if (c) { pass++; console.log('  [PASS] ' + n); }
  else { fail++; failures.push(n + (e ? ' — ' + e : '')); console.log('  [FAIL] ' + n + (e ? ' — ' + e : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const mediaSrc = fs.readFileSync(MEDIA, 'utf8');
const vehSrc = fs.readFileSync(VEHICLES, 'utf8');

/* ---------------- S1 静态契约 ---------------- */
section('S1 静态契约: 灰图占位已删除 / 接线正确 / 文案就位');

// 反向锚点: 灰图占位函数必须真的消失(否则又回到"看起来像待加载"的老路)
// 比对前剥掉块注释 —— 源码里那段"已删除 _imgPlaceholder"的说明注释本身含这些字面量,
// 不剥离会造成假红(与 test_v1035 里 S11b 踩过的坑同源)。
const mediaCode = mediaSrc.replace(/\/\*[\s\S]*?\*\//g, '');
check('S1a _imgPlaceholder 灰图占位函数已删除(不得复活)',
  !/function\s+_imgPlaceholder\s*\(/.test(mediaCode) && !/照片暂缺/.test(mediaCode));
check('S1b 删除理由已写入源码注释(防后人误加回)',
  /已删除\s*_imgPlaceholder/.test(mediaSrc));

check('S1c showPhotoMissing 存在(详情格诚实空态)',
  /function\s+showPhotoMissing\s*\(/.test(mediaSrc));
check('S1d showThumbMissing 存在(列表缩略图诚实空态)',
  /function\s+showThumbMissing\s*\(/.test(mediaSrc));

check('S1e imgLoadError 未命中云端时走 showPhotoMissing(而非换灰图)',
  /function\s+imgLoadError[\s\S]{0,320}showPhotoMissing\(img\)/.test(mediaSrc));
check('S1f thumbImgError 未命中云端时走 showThumbMissing(而非换灰图)',
  /function\s+thumbImgError[\s\S]{0,320}showThumbMissing\(img\)/.test(mediaSrc));
check('S1g 全文件不再出现 _imgPlaceholder 调用',
  (mediaSrc.match(/_imgPlaceholder/g) || []).length <= 1, // 仅允许注释里那一处说明
  '出现次数=' + ((mediaSrc.match(/_imgPlaceholder/g) || []).length));

check('S1h 详情格文案: 照片缺失 + 云端与本地均无此文件',
  /照片缺失/.test(mediaSrc) && /云端与本地/.test(mediaSrc));
check('S1i 缩略图文案: 缺失(64x48 极小, 文案压到最短)',
  /font-size:9px[^>]*>缺失</.test(mediaSrc));
check('S1j _photoViewerMissingSvg 区分 missing / never 两种原因',
  /reason===\s*'never'/.test(mediaSrc) && /照片文件缺失/.test(mediaSrc) && /该车型暂未上传照片/.test(mediaSrc));
check('S1k openPhotoViewer: 加载失败传 missing, 未登记传 never',
  /_photoViewerMissingSvg\(v,labels\[index\],'missing'\)/.test(mediaSrc) &&
  /_photoViewerMissingSvg\(v,labels\[index\],'never'\)/.test(mediaSrc));

// 接线回归: 模板里 onerror 必须仍指向这两个函数(改文案时最容易顺手改坏)
check('S1l 详情格模板仍接线 imgLoadError(this)',
  /onerror="imgLoadError\(this\)"/.test(vehSrc));
check('S1m 列表卡片模板仍接线 thumbImgError(this)',
  /onerror="thumbImgError\(this\)"/.test(vehSrc));

/* ---------------- jsdom 沙箱 ---------------- */
const dom = new JSDOM('<!doctype html><html><body></body></html>');
const win = dom.window;
const sandbox = {
  console, document: win.document, window: win,
  setTimeout, clearTimeout, encodeURIComponent, decodeURIComponent, Promise
};
vm.createContext(sandbox);

const BLOCKS = ['_xmlEsc', '_photoViewerMissingSvg', 'showPhotoMissing', 'showThumbMissing',
  'imgLoadError', 'thumbImgError']
  .map(n => extractNamedBlock(mediaSrc, n)).join('\n');

// 飞书回退链 stub: 一律"未命中", 才能逼出诚实空态分支
vm.runInContext(
  'var imgFromFeishuCloud = function(){ return Promise.resolve(false); };\n' + BLOCKS + '\n',
  sandbox
);

check('S1n 沙箱加载成功(六个函数可被提取并执行)',
  typeof sandbox.showPhotoMissing === 'function' &&
  typeof sandbox.showThumbMissing === 'function' &&
  typeof sandbox._photoViewerMissingSvg === 'function' &&
  typeof sandbox.imgLoadError === 'function' &&
  typeof sandbox.thumbImgError === 'function' &&
  typeof sandbox._xmlEsc === 'function');

const tick = () => new Promise(r => setTimeout(r, 0));

/* ---------------- S2 行为: 详情格 ---------------- */
section('S2 行为: 详情照片格整格替换为"照片缺失"');

function makeTile() {
  const tile = win.document.createElement('div');
  tile.className = 'aspect-square rounded-xl overflow-hidden cursor-pointer relative bg-gray-100';
  tile.setAttribute('onclick', 'openPhotoViewer(0)');
  tile.onclick = () => { tile.dataset.clicked = '1'; };
  const img = win.document.createElement('img');
  img.setAttribute('src', 'vehicle_images/缺图_a_p1_1111.jpeg');
  tile.appendChild(img);
  const badge = win.document.createElement('span');
  badge.textContent = '前脸照片';
  tile.appendChild(badge);
  win.document.body.appendChild(tile);
  return { tile, img };
}

(async function main() {
  const t1 = makeTile();
  sandbox.showPhotoMissing(t1.img);
  await tick();

  check('S2a 整格被替换: 原 <img> 已移除', !t1.tile.querySelector('img'));
  check('S2b 误导性 onclick 已移除(不再是"可点开的照片位")',
    t1.tile.getAttribute('onclick') === null && t1.tile.onclick === null);
  check('S2c 误导性部位标签已移除(不再显示"前脸照片")',
    !/前脸照片/.test(t1.tile.textContent));
  check('S2d 文案写出"照片缺失"', /照片缺失/.test(t1.tile.textContent));
  check('S2e 文案写出"云端与本地均无此文件"', /云端与本地均无此文件/.test(t1.tile.textContent));
  check('S2f 虚线边框(与正常照片格视觉可区分)',
    /border-dashed/.test(t1.tile.className));
  check('S2g 鼠标指针改为 default(不可点)', t1.tile.style.cursor === 'default');

  // 端到端: 走 imgLoadError(内含"先试云端"分支, stub 必未命中)
  const t2 = makeTile();
  sandbox.imgLoadError(t2.img);
  await tick();
  check('S2h imgLoadError 端到端落到诚实空态(云端未命中时)',
    /照片缺失/.test(t2.tile.textContent) && !t2.tile.querySelector('img'));
  check('S2i imgLoadError 仅挂一次 onerror(不会死循环重试)', t2.img.onerror === null);

  /* ---------------- S3 行为: 列表缩略图 ---------------- */
  section('S3 行为: 列表卡片缩略图替换为"缺失"');

  function makeThumb() {
    const box = win.document.createElement('div');
    box.className = 'w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100';
    const img = win.document.createElement('img');
    img.setAttribute('src', 'vehicle_images/缺图_a_p1_1111.jpeg');
    img.className = 'w-full h-full object-cover';
    box.appendChild(img);
    win.document.body.appendChild(box);
    return { box, img };
  }

  const b1 = makeThumb();
  sandbox.showThumbMissing(b1.img);
  await tick();
  check('S3a 缩略图 <img> 已移除', !b1.box.querySelector('img'));
  check('S3b 文案写出"缺失"', /缺失/.test(b1.box.textContent));
  check('S3c 虚线边框(与正常缩略图可区分)', /border-dashed/.test(b1.box.className));
  check('S3d 不写"照片暂缺"(那是灰图时代的旧文案)', !/照片暂缺/.test(b1.box.textContent));

  const b2 = makeThumb();
  sandbox.thumbImgError(b2.img);
  await tick();
  check('S3e thumbImgError 端到端落到诚实空态(云端未命中时)',
    /缺失/.test(b2.box.textContent) && !b2.box.querySelector('img'));

  /* ---------------- S4 行为: 查看器大图 ---------------- */
  section('S4 行为: 查看器大图两种缺失文案 + XML 转义');

  const v = { display: '比亚迪 唐 & <DM-i>' };
  const svgMissing = decodeURIComponent(sandbox._photoViewerMissingSvg(v, '前脸照片', 'missing').replace('data:image/svg+xml;utf8,', ''));
  const svgNever = decodeURIComponent(sandbox._photoViewerMissingSvg(v, '前脸照片', 'never').replace('data:image/svg+xml;utf8,', ''));

  check('S4a 返回 data:image/svg+xml 内联图', /^data:image\/svg\+xml;utf8,/.test(sandbox._photoViewerMissingSvg(v, '前脸照片', 'missing')));
  check('S4b missing: 写"照片文件缺失"', /照片文件缺失/.test(svgMissing));
  check('S4c missing: 引导"请联系组长补传"(这才是正确处置)', /请联系组长补传/.test(svgMissing));
  check('S4d never: 写"该车型暂未上传照片"(处置是重新拍摄, 不是补传)',
    /该车型暂未上传照片/.test(svgNever));
  check('S4e never 与 missing 文案不同(两种缺失必须可区分)', svgMissing !== svgNever);
  check('S4f 车名参与展示(便于组长定位是哪台车)', /前脸照片/.test(svgMissing));
  check('S4g 车名中的 & < > 已 XML 转义(不会破坏 SVG)',
    !/&(?!amp;|lt;|gt;|quot;)/.test(svgMissing) && /&amp;/.test(svgMissing) && /&lt;DM-i&gt;/.test(svgMissing));
  check('S4h 空车辆对象不抛异常(null-safe)',
    typeof sandbox._photoViewerMissingSvg(null, '', 'missing') === 'string' &&
    typeof sandbox._photoViewerMissingSvg(undefined, undefined, 'never') === 'string');
  check('S4i _xmlEsc 基础转义正确',
    sandbox._xmlEsc('a&b<c>d"e') === 'a&amp;b&lt;c&gt;d&quot;e' && sandbox._xmlEsc(null) === '');

  /* ---------------- S5 注册 ---------------- */
  section('S5 注册: package.json 入口 + test:all 已纳入');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  const runnerSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'run_all_tests.js'), 'utf8');
  check('S5a package.json 有 test:honest-empty 入口',
    pkg.scripts && pkg.scripts['test:honest-empty'] === 'node tests/test_v1037_honest_empty_state.js');
  check('S5b run_all_tests.js TEST_SUITES 已纳入 test:honest-empty',
    /'test:honest-empty'/.test(runnerSrc));

  /* ---------------- 汇总 ---------------- */
  console.log('\n----------------------------------------------');
  console.log(`结果: ${pass} 通过 / ${fail} 失败`);
  if (fail) {
    console.log('失败项:');
    failures.forEach(f => console.log('  - ' + f));
  }
  console.log('----------------------------------------------');
  process.exit(fail ? 1 : 0);
})().catch(e => {
  console.error('[test_v1037] 执行异常:', e && e.stack || e);
  process.exit(1);
});
