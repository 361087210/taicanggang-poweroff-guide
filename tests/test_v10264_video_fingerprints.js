/**
 * ============================================================
 * test_v10264_video_fingerprints.js — 视频内容指纹回归
 * ============================================================
 * 背景: 视频不入仓库（存 GitHub Release / 飞书），manifest 里的 sha256 长期为空 ——
 *   「通用断电视频.mp4 被 13 个车型共用」只是**约定**，不是可验证事实；
 *   一旦有人换了同名文件，所有引用它的车型会静默变成错片，且审计发现不了。
 *
 * 现在: 由 CI 工作流 Fingerprint Videos 下载 Release 资产 → 计算 sha256 →
 *   通过 `--release-map` 把 `tcgv_<hash>.mp4` 的指纹回填到**原始文件名** →
 *   重建 manifest → 提交。
 *
 * 本套件钉住（只依赖已提交的产物，不联网）:
 *   F1 docs/video_fingerprints.json 结构合法、条目数足够、sha256 形态正确
 *   F2 键里既有原始文件名（中文名）也有资产名，说明 --release-map 生效
 *   F3 manifest 视频指纹覆盖率 ≥ 90%
 *   F4 **共享视频 100% 有指纹**（C8 的实质要求 —— 这是本项的核心价值）
 *   F5 audit 不再报「共享视频无内容指纹」
 *   F6 接线: fingerprint-videos.yml 下载映射资产 → 跑指纹 → 重建 → 提交；并有每周复查
 *   F7 脚本支持 --release-map 且做"资产名 → 原始名"反向映射
 *
 * 运行: node tests/test_v10264_video_fingerprints.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const src = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

section('F1 指纹文件');
let fp = null;
try { fp = JSON.parse(src('docs/video_fingerprints.json')); } catch (e) { /* 下面断言报错 */ }
check('F1a docs/video_fingerprints.json 存在且可解析', !!fp);
const videos = (fp && fp.videos) || {};
const withSha = Object.keys(videos).filter(k => videos[k] && /^[0-9a-f]{64}$/.test(videos[k].sha256 || '')) ;
check('F1b 有 sha256 的条目 ≥ 80', withSha.length >= 80, withSha.length + ' 条');
check('F1c 每条指纹的 size 为正数', withSha.every(k => Number(videos[k].size) > 0));
check('F1d sha256 全为 64 位小写十六进制', withSha.every(k => /^[0-9a-f]{64}$/.test(videos[k].sha256)));

section('F2 资产名 → 原始名 映射生效');
const origNames = withSha.filter(k => /[\u4e00-\u9fa5]/.test(k));
const assetNames = withSha.filter(k => /^tcgv_/.test(k));
check('F2a 存在原始文件名（含中文）条目 ≥ 40', origNames.length >= 40, origNames.length + ' 条');
check('F2b 同时保留资产名条目（便于反查）', assetNames.length >= 40, assetNames.length + ' 条');

section('F3 manifest 覆盖率');
const manifest = JSON.parse(src('docs/vehicle_media_manifest.json'));
const refs = (manifest.vehicles || []).flatMap(v => v.videos || []);
const uniq = Array.from(new Set(refs.map(r => r.fileName)));
const shaByName = new Map();
refs.forEach(r => { if (r.sha256) shaByName.set(r.fileName, r.sha256); });
const covered = uniq.filter(n => shaByName.has(n));
const rate = uniq.length ? covered.length / uniq.length : 0;
check('F3a 唯一视频数 ≥ 45', uniq.length >= 45, uniq.length + ' 个');
check('F3b 指纹覆盖率 ≥ 90%', rate >= 0.9, Math.round(rate * 100) + '%（' + covered.length + '/' + uniq.length + '）');

section('F4 共享视频必须 100% 有指纹（核心价值）');
/* 共享判定要按"引用它的车型数"，manifest 里的视频条目本身不带 id —— 从车型维度遍历 */
const owners = new Map();
(manifest.vehicles || []).forEach(v => {
  (v.videos || []).forEach(r => {
    if (!owners.has(r.fileName)) owners.set(r.fileName, { ids: new Set(), sha: '' });
    const o = owners.get(r.fileName);
    o.ids.add(v.id);
    if (r.sha256) o.sha = r.sha256;
  });
});
const shared = Array.from(owners.entries()).filter(([, o]) => o.ids.size > 1);
check('F4a 存在共享视频（≥1 个）', shared.length >= 1, shared.length + ' 个');
const sharedNoSha = shared.filter(([, o]) => !o.sha);
check('F4b 共享视频全部有 sha256', sharedNoSha.length === 0, sharedNoSha.map(([n]) => n).join(', '));

section('F5 audit 不再报「共享视频无内容指纹」');
const audit = spawnSync(process.execPath, [path.join(ROOT, 'scripts/audit_media_consistency.js')], { cwd: ROOT, encoding: 'utf8' });
const auditOut = (audit.stdout || '') + (audit.stderr || '');
check('F5a 输出不含「共享视频无内容指纹」', auditOut.indexOf('共享视频无内容指纹') < 0);
check('F5b 视频指纹覆盖已有明细', /视频指纹: \d+\/\d+ 已有 sha256/.test(auditOut));

section('F6 工作流接线');
const wf = src('.github/workflows/fingerprint-videos.yml');
check('F6a 从 Release 下载映射表里点名的资产', wf.indexOf('media_release_map.json') >= 0 && wf.indexOf('gh release download media-videos') >= 0);
check('F6b 用 --release-map 生成指纹', wf.indexOf('--release-map docs/media_release_map.json') >= 0);
check('F6c 指纹后重建 manifest 与索引', wf.indexOf('gen_media_mapping.js') >= 0 && wf.indexOf('gen_media_library.js') >= 0);
check('F6d 有变化才提交', /git diff --cached --quiet/.test(wf) && /git push/.test(wf));
check('F6e 每周复查（检测同名替换）', /schedule:/.test(wf) && /cron:/.test(wf));

section('F7 脚本能力');
const fpSrc = src('scripts/fingerprint_videos.js');
check('F7a 支持 --release-map', fpSrc.indexOf('--release-map') >= 0);
check('F7b 做资产名→原始名的反向映射', /alias\[f\]/.test(fpSrc) && /next\.videos\[orig\]/.test(fpSrc));
check('F7c --check 会提示本地缺哪些已入库视频', /本地目录缺少这些已入库指纹的视频/.test(fpSrc));

console.log('\n==============================================================');
console.log('视频指纹回归汇总: ' + pass + ' passed, ' + fail + ' failed');
if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
else console.log('全部通过 OK');
