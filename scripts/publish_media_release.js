#!/usr/bin/env node
/**
 * publish_media_release.js — 把 720p 转码件发布到 GitHub Release（零成本视频方案第 2 步）
 *
 * 背景:
 *   media-videos Release 里现有的资产多是**原始体积**(单文件 130–190 MB),
 *   手机 4G 拉流就是分钟级。本脚本把同名资产替换为 720p 版本(5–18 MB),
 *   播放体积降到 1/10, 且仍支持 HTTP Range(可拖动进度条)。
 *
 * 用法:
 *   export GITHUB_TOKEN=ghp_xxx        # 需要 repo 权限(公开仓库也需写权限)
 *   node scripts/publish_media_release.js --dry-run          # 只打印计划
 *   node scripts/publish_media_release.js                    # 替换/新增
 *   node scripts/publish_media_release.js --only-upload      # 不删旧资产(会重名冲突, 一般不用)
 *
 * 产物: docs/media_release_map.json  { 原始文件名: 资产名 }, 供 js/00-bootstrap.js 的
 *       MEDIA_DIRECT_ASSETS 同步。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const OWNER = '361087210';
const REPO = 'taicanggang-poweroff-guide';
const TAG = 'media-videos';           // 复用既有 release, 保证 App 里的 MEDIA_RELEASE_BASE 不变
const VIDEO_DIR = path.join(ROOT, '..', 'videos-720p');
const DRY = process.argv.includes('--dry-run');

const TOKEN = process.env.GITHUB_TOKEN;
const API = 'https://api.github.com';

function assetNameFor(fileName, existingMap) {
  if (existingMap[fileName]) return existingMap[fileName];
  const h = crypto.createHash('sha256').update(fileName).digest('hex').slice(0, 10);
  return `tcgv_${h}.mp4`;
}

async function api(pathname, opt) {
  const res = await fetch(API + pathname, {
    ...opt,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {}),
      ...(opt && opt.headers)
    }
  });
  const txt = await res.text();
  let json = null;
  try { json = txt ? JSON.parse(txt) : null; } catch (e) { /* 非 JSON */ }
  if (!res.ok) throw new Error(`${pathname} → ${res.status} ${json ? json.message : txt.slice(0, 200)}`);
  return json;
}

async function uploadAsset(uploadUrl, filePath, name) {
  const data = fs.readFileSync(filePath);
  const url = uploadUrl.replace('{?name,label}', '') + `?name=${encodeURIComponent(name)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'video/mp4',
      'Content-Length': String(data.length)
    },
    body: data
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`上传 ${name} → ${res.status} ${json.message}`);
  return json;
}

function loadExistingMap() {
  const p = path.join(ROOT, 'docs', 'media_release_map.json');
  if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf8')).map || {};
  // 退化: 从 00-bootstrap.js 的 MEDIA_DIRECT_ASSETS 解析
  const src = fs.readFileSync(path.join(ROOT, 'js', '00-bootstrap.js'), 'utf8');
  const m = src.match(/const MEDIA_DIRECT_ASSETS=\{([\s\S]*?)\};/);
  const map = {};
  if (m) {
    for (const [, k, v] of m[1].matchAll(/'([^']+)':\s*'([^']+)'/g)) map[k] = v;
  }
  return map;
}

async function main() {
  if (!TOKEN && !DRY) {
    console.error('[publish] 缺少 GITHUB_TOKEN。请先: export GITHUB_TOKEN=ghp_xxx');
    process.exit(2);
  }
  if (!fs.existsSync(VIDEO_DIR)) {
    console.error('[publish] 视频目录不存在:', VIDEO_DIR);
    process.exit(2);
  }
  const files = fs.readdirSync(VIDEO_DIR).filter(f => /\.mp4$/i.test(f)).sort();
  const existingMap = loadExistingMap();

  const release = await api(`/repos/${OWNER}/${REPO}/releases/tags/${TAG}`);
  const assetsByName = new Map((release.assets || []).map(a => [a.name, a]));
  console.log(`[publish] release "${TAG}" 现有资产 ${assetsByName.size} 个`);

  const plan = [];
  let totalNew = 0, totalOld = 0;
  for (const f of files) {
    const assetName = assetNameFor(f, existingMap);
    const old = assetsByName.get(assetName);
    const size = fs.statSync(path.join(VIDEO_DIR, f)).size;
    totalNew += size;
    if (old) totalOld += old.size;
    plan.push({ file: f, assetName, oldId: old ? old.id : null, oldSize: old ? old.size : 0, size });
  }

  console.log(`[publish] 待处理 ${plan.length} 个 | 新体积 ${(totalNew / 1048576).toFixed(0)} MB | 被替换的旧资产 ${(totalOld / 1048576).toFixed(0)} MB`);
  for (const p of plan.slice(0, 5)) {
    console.log(`  ${p.oldId ? '替换' : '新增'} ${p.file} → ${p.assetName}  ${(p.oldSize / 1048576).toFixed(0)} → ${(p.size / 1048576).toFixed(1)} MB`);
  }
  if (DRY) { console.log('[publish] --dry-run, 未执行'); return; }

  const map = { ...existingMap };
  let ok = 0, fail = 0;
  for (const p of plan) {
    try {
      if (p.oldId) {
        await api(`/repos/${OWNER}/${REPO}/releases/assets/${p.oldId}`, { method: 'DELETE' });
      }
      await uploadAsset(release.upload_url, path.join(VIDEO_DIR, p.file), p.assetName);
      map[p.file] = p.assetName;
      ok++;
      console.log(`  ✅ ${p.file} → ${p.assetName}  ${(p.size / 1048576).toFixed(1)} MB`);
    } catch (e) {
      fail++;
      console.error(`  ❌ ${p.file}: ${e.message}`);
    }
  }

  fs.writeFileSync(path.join(ROOT, 'docs', 'media_release_map.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), tag: TAG, map }, null, 1));
  console.log(`\n[publish] 完成: 成功 ${ok} | 失败 ${fail}`);
  console.log('[publish] 映射已写入 docs/media_release_map.json, 记得同步 js/00-bootstrap.js 的 MEDIA_DIRECT_ASSETS');
}

main().catch(e => { console.error('[publish] 失败:', e.message); process.exit(1); });
