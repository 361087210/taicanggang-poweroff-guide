#!/usr/bin/env node
/**
 * test_v10251_media_fallback.js — 照片候选路径回退 + 上传幂等作用域 回归测试
 *
 * 覆盖两处 P0 修复:
 *   A. js/06-media.js#mediaCandidateSrcs  —— 三段式失败时依次回退 _共享/ → 顶层/
 *   B. js/05-sync.js 幂等键 _cloudKey     —— "子目录/文件名", 跨车型不再互相误判
 *
 * 打法说明: 这两个函数都在浏览器大文件里, 直接 require 会拉起整套 UI 依赖。
 *   故按"源码抽取 + 沙箱求值"的方式测试纯逻辑(与仓库既有测试风格一致)。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MP = require(path.join(ROOT, 'js', '00-media-paths.js'));

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  ✅ ' + name); }
  else { fail++; console.error('  ❌ ' + name + (extra ? '  → ' + extra : '')); }
}

/* ---------- 从源码中抽取指定函数(按大括号配平) ---------- */
function extractFn(src, name) {
  // 支持两种写法: 函数声明 `function name(...)` 与 箭头常量 `const name=(...) => ...;`
  const arrow = src.match(new RegExp('const\\s+' + name + '\\s*=\\s*([^;]+);'));
  if (arrow) return null; // 由调用方用 extractArrow 处理
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('未找到函数 ' + name);
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('函数体未闭合: ' + name);
}

const mediaSrc = fs.readFileSync(path.join(ROOT, 'js', '06-media.js'), 'utf8');
const syncSrc = fs.readFileSync(path.join(ROOT, 'js', '05-sync.js'), 'utf8');

const sandbox = { TCG_MEDIA_PATHS: MP };
const fnCode = extractFn(mediaSrc, 'mediaCandidateSrcs');
// eslint-disable-next-line no-new-func
const mediaCandidateSrcs = new Function('TCG_MEDIA_PATHS', fnCode + '\nreturn mediaCandidateSrcs;')(MP);
void sandbox;

/* ---------- A. 候选路径 ---------- */
console.log('\n[A] 照片候选路径回退');

const nested = 'vehicle_images/比亚迪海豚(低配)/image1.jpeg';
const c1 = mediaCandidateSrcs(nested);
ok(c1[0] === nested, '第 1 候选 = 原路径');
ok(c1.includes('vehicle_images/_共享/image1.jpeg'), '第 2 候选 = _共享/同名', JSON.stringify(c1));
ok(c1.includes('vehicle_images/image1.jpeg'), '第 3 候选 = 顶层/同名(旧扁平布局)', JSON.stringify(c1));
ok(c1.length === 3, '候选数量恰好 3(不多猜)', JSON.stringify(c1));

const top = 'vehicle_images/image1.jpeg';
const c2 = mediaCandidateSrcs(top);
ok(c2[0] === top && c2.includes('vehicle_images/_共享/image1.jpeg'), '两段式 → 追加 _共享/同名', JSON.stringify(c2));

const shared = 'vehicle_images/_共享/image1.jpeg';
const c3 = mediaCandidateSrcs(shared);
ok(c3[0] === shared && c3.length === 2 && new Set(c3).size === 2,
   '已共享路径不重复追加自身, 仍保留顶层回退', JSON.stringify(c3));

ok(mediaCandidateSrcs('').length === 0, '空路径 → 无候选');
ok(mediaCandidateSrcs(null).length === 0, 'null → 无候选');

const uniq = mediaCandidateSrcs(nested);
ok(new Set(uniq).size === uniq.length, '候选无重复');

/* ---------- B. 上传幂等键 ---------- */
console.log('\n[B] 上传幂等作用域');
const arrowMatch = syncSrc.match(/const\s+_cloudKey\s*=\s*([^;]+);/);
if (!arrowMatch) throw new Error('未找到 _cloudKey');
// eslint-disable-next-line no-new-func
const _cloudKey = new Function('return ' + arrowMatch[1] + ';')();

ok(_cloudKey('比亚迪海豚', 'x_p1_ab.jpeg') === '比亚迪海豚/x_p1_ab.jpeg', '子目录键 = 目录/文件名');
ok(_cloudKey('', 'x_p1_ab.jpeg') === 'x_p1_ab.jpeg', '顶层键 = 文件名');
ok(_cloudKey('A', 'x.jpeg') !== _cloudKey('B', 'x.jpeg'), '不同车型同名文件 → 键不同(不再互相跳过)');
ok(_cloudKey('', 'x.jpeg') !== _cloudKey('A', 'x.jpeg'), '顶层与子目录同名 → 键不同');

// 幂等判定模拟: 云端只有 A 车目录下的 image1.jpeg
const cloud = new Set([_cloudKey('A车型', 'image1.jpeg')]);
ok(cloud.has(_cloudKey('A车型', 'image1.jpeg')) === true, 'A 车重复上传 → 正确跳过');
ok(cloud.has(_cloudKey('B车型', 'image1.jpeg')) === false, 'B 车同名文件 → 正确判定为"未上传"(旧实现会误跳过)');

/* ---------- C. 媒体是补充: 上云快照 / 拉取保留待传媒体 (V10.27.1) ---------- */
console.log('\n[C] 媒体不阻断车型信息同步');
// eslint-disable-next-line no-new-func
const _cloudVehicleSnapshot = new Function(extractFn(syncSrc, '_cloudVehicleSnapshot') + '\nreturn _cloudVehicleSnapshot;')();
// eslint-disable-next-line no-new-func
const _keepPendingLocalMedia = new Function(extractFn(syncSrc, '_keepPendingLocalMedia') + '\nreturn _keepPendingLocalMedia;')();

const vMixed = {
  id: 1, display: '测试车', photos: 3, photoPaths: ['vehicle_images/A_p1_1.jpeg', 'data:image/jpeg;base64,AAA', 'vehicle_images/A_p3_3.jpeg'],
  photoSections: ['exterior', 'key', 'position'], photoLabels: ['车头', '钥匙', '断电'],
  videos: 2, videoPaths: ['vehicle_videos/A_v1_1.mp4', 'data:video/mp4;base64,BBB']
};
const snap = _cloudVehicleSnapshot(vMixed);
ok(snap.photoPaths.length === 2 && snap.photos === 2, 'C1 上云副本剔除未上传的base64照片', JSON.stringify(snap.photoPaths));
ok(snap.photoSections.join(',') === 'exterior,position' && snap.photoLabels.join(',') === '车头,断电', 'C2 板块/标签随剔除同步对齐', JSON.stringify(snap.photoSections) + '|' + JSON.stringify(snap.photoLabels));
ok(snap.videoPaths.length === 1 && snap.videos === 1, 'C3 上云副本剔除未上传的base64视频');
ok(vMixed.photoPaths.length === 3 && vMixed.videos === 2, 'C4 本地数据不被改动(下轮继续重试)');
const snapEmpty = _cloudVehicleSnapshot({ id: 2, display: 'x', photoPaths: ['data:image/jpeg;base64,AAA'], photoSections: ['key'], photoLabels: ['钥匙'], videoPaths: [] });
ok(snapEmpty.photos === 0 && snapEmpty.videos === 0 && snapEmpty.photoSections.length === 0, 'C5 全为base64时上云副本仅保留文字信息');

const localV = { photoPaths: ['vehicle_images/A_p1_1.jpeg', 'data:image/jpeg;base64,AAA'], photoSections: ['exterior', 'key'], photoLabels: ['车头', '钥匙'], videoPaths: ['data:video/mp4;base64,BBB'] };
const cloudV = { photoPaths: ['vehicle_images/A_p1_1.jpeg'], photoSections: ['exterior'], photoLabels: ['车头'], videoPaths: [] };
const merged = _keepPendingLocalMedia(localV, cloudV);
ok(merged.photoPaths.length === 2 && merged.photos === 2, 'C6 拉取合并保留本机待上传照片');
ok(merged.photoSections.join(',') === 'exterior,key' && merged.photoLabels.join(',') === '车头,钥匙', 'C7 保留的待传照片板块/标签同下标对齐');
ok(merged.videoPaths.length === 1 && merged.videos === 1, 'C8 拉取合并保留本机待上传视频');
const noLocal = _keepPendingLocalMedia(null, { photoPaths: ['a'], videos: 0 });
ok(noLocal.photoPaths.join(',') === 'a', 'C9 无本地记录时安全返回');

/* 清晰度参数回归(防止无意回退到低分辨率) */
const vehicleSrc = fs.readFileSync(path.join(ROOT, 'js', '03-vehicles.js'), 'utf8');
ok(/compressImage\(file,2400,0\.92\)/.test(vehicleSrc), 'C10 本地照片压缩 2400px / 0.92');
ok(/_normalizePhotoForUpload\(raw,2560\)/.test(syncSrc) && /toDataURL\('image\/jpeg',0\.9\)/.test(syncSrc), 'C11 上云照片归一 2560px / 0.9');
ok(/naturalWidth>=1600/.test(mediaSrc), 'C12 高清升级阈值 1600(433/1280 旧图可升级)');

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(50));
console.log(`结果: ${pass} 通过 / ${fail} 失败 / ${pass + fail} 总计`);
if (fail) process.exit(1);
