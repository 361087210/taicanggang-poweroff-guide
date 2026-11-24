#!/usr/bin/env node
/**
 * ============================================================
 * test_media_source_bench.js — 播放源基准脚本与评估文档的一致性
 * ============================================================
 * 为什么要测"一个测量脚本"：
 *   ① 基准的口径（中位 / p95 / Range 判定）一旦悄悄改掉，历史 JSON 就不可比了；
 *   ② 评估文档里的结论必须挂在一个真能跑的脚本上，否则半年后没人知道 418 KB/s 怎么来的；
 *   ③ 这两个都是"决策依据"，比功能代码更需要防漂移。
 *
 * 断言意图而非实现：不检查脚本用什么库、跑几次，只检查口径与 URL 形状、
 * 以及文档是否仍然指向脚本并保留一票否决项。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
const bench = require(path.join(ROOT, 'scripts/bench_media_sources.js'));

let pass = 0, fail = 0;
function T(name, fn) {
  try { fn(); pass++; console.log('  ✅ ' + name); }
  catch (e) { fail++; console.log('  ❌ ' + name + ' — ' + e.message); }
}

console.log('\n=== 播放源基准与评估文档 (test_media_source_bench) ===\n');

/* ---------- A. 统计口径 ---------- */
T('A1 中位数：奇数长度取正中', () => {
  assert.strictEqual(bench.median([3, 1, 2]), 2);
});
T('A2 中位数：偶数长度取中间两数均值，且不改入参顺序', () => {
  const arr = [4, 1, 3, 2];
  assert.strictEqual(bench.median(arr), 2.5);
  assert.deepStrictEqual(arr, [4, 1, 3, 2], 'median 不应就地排序');
});
T('A3 p95 取的是"接近最差"而不是最大值', () => {
  const oneToTwenty = Array.from({ length: 20 }, (_, i) => i + 1);
  const v = bench.p95(oneToTwenty);
  assert.ok(v >= 19 && v <= 20, 'p95 应落在 19–20，实际 ' + v);
});
T('A4 p95 在单样本时退化为该样本（不越界）', () => {
  assert.strictEqual(bench.p95([7]), 7);
});
T('A5 kb() 输出人类可读单位，便于贴进文档', () => {
  assert.strictEqual(bench.kb(1024 * 500), '500 KB/s');
});

/* ---------- B. GitHub 样本取址 ---------- */
T('B1 样本地址指向 media-videos 的 Release 资产，且是 mp4', () => {
  const { url } = bench.githubSampleUrl();
  assert.ok(url.includes('/releases/download/media-videos/'), '缺少 Release 路径: ' + url);
  assert.ok(/\.mp4$/.test(url), '样本不是 mp4: ' + url);
});
T('B2 样本名来自仓库内的映射表（换视频后基准自动跟着换）', () => {
  const mapFile = path.join(ROOT, 'docs/media_release_map.json');
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8')).map || {};
  const names = Object.keys(map);
  assert.ok(names.length > 0, '映射表为空，基准将取不到真实样本');
  const asset = bench.githubSampleUrl().url.split('/').pop();
  assert.ok(Object.values(map).includes(asset), '样本资产不在映射表里: ' + asset);
});

/* ---------- C. 评估文档与脚本互相指向 ---------- */
const docPath = path.join(ROOT, 'docs/VIDEO_SOURCE_EVAL.md');
T('C1 评估文档存在', () => {
  assert.ok(fs.existsSync(docPath), '缺少 docs/VIDEO_SOURCE_EVAL.md');
});
const doc = fs.existsSync(docPath) ? fs.readFileSync(docPath, 'utf8') : '';

T('C2 文档给出复现命令，且指向本脚本', () => {
  assert.ok(doc.includes('scripts/bench_media_sources.js'), '文档没提基准脚本');
  assert.ok(/node scripts\/bench_media_sources\.js/.test(doc), '文档缺少可直接复制的运行命令');
});
T('C3 文档保留"一票否决"规则（否则加权分会把不可直连的源排上来）', () => {
  assert.ok(doc.includes('一票否决'), '缺少一票否决段');
  assert.ok(doc.includes('Range'), '一票否决项里应包含 Range 支持');
});
T('C4 文档保留 WorkBuddy 待确认清单（含 S3 兼容与缓存头）', () => {
  assert.ok(/S3 兼容/.test(doc), '缺少 S3 兼容性提问');
  assert.ok(/Cache-Control/.test(doc), '缺少缓存头提问');
});
T('C5 文档的验收阈值是可量化的数字（不是"要快"）', () => {
  assert.ok(/TTFB p95 ≤ \*\*1\.5s\*\*/.test(doc), '缺少 TTFB 阈值');
  assert.ok(/吞吐中位 ≥ \*\*1\.5 MB\/s\*\*/.test(doc), '缺少吞吐阈值');
});
T('C6 文档结论是"真源与播放源分离"，不是"换掉飞书"', () => {
  assert.ok(doc.includes('真源'), '文档应说明飞书仍是真源');
  assert.ok(doc.includes('回退') || doc.includes('备源'), '缺少多源回退设计');
});

/* ---------- D. 留痕 JSON 的形状 ---------- */
const jsonPath = path.join(ROOT, 'docs/media_source_bench.json');
T('D1 留痕 JSON 存在且结构可被后续比较', () => {
  assert.ok(fs.existsSync(jsonPath), '缺少 docs/media_source_bench.json（跑脚本时加 --write 生成）');
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.ok(j.generatedAt && j.maxBytes && j.repeat && Array.isArray(j.results), '字段不完整');
});
T('D2 每个源都带 summary 或明确的 error，不允许"静默无数据"', () => {
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  assert.ok(j.results.length > 0, 'results 为空');
  j.results.forEach(r => {
    assert.ok(r.summary || r.error, r.label + ' 既没有 summary 也没有 error');
  });
});

console.log('\n  结果: ' + pass + ' 通过, ' + fail + ' 失败\n');
process.exit(fail ? 1 : 0);
