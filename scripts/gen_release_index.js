#!/usr/bin/env node
/**
 * ============================================================
 * scripts/gen_release_index.js —— 生成 releases_index.json
 * ============================================================
 * 为什么需要:
 *   回滚依赖"每个版本到底有没有产物、产物在哪"。这些信息原本只散在
 *   GitHub Releases 页面里, App 和网页端都拿不到, 也无法判断某个版本
 *   是否可回滚(有没有 APK/IPA、有没有校验和)。
 *
 * 产出: 仓库根 releases_index.json(随 Pages 与 App 包一起发布)
 *   { schemaVersion, generatedAt, latest, releases: [...] }
 *   每项: version / tag / status / apk / apkSha256 / ipa / releaseUrl / rollbackable
 *   status: complete(APK+IPA+sha256) | partial(缺件) | missing(空 Release) | unreleased(只有 tag 无 Release)
 *
 * 用法:
 *   node scripts/gen_release_index.js            # 写文件
 *   node scripts/gen_release_index.js --check     # 与仓库内文件比对(漂移则退出 1)
 * 令牌: GH_TOKEN / GITHUB_TOKEN, 都没有时回退 `gh auth token`
 */
'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const { execSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'releases_index.json');
const OWNER = '361087210';
const REPO = 'taicanggang-poweroff-guide';
const API_HOST = 'api.github.com';

function token() {
  const t = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (t) return t;
  try { return execSync('gh auth token', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch (e) { return ''; }
}

const TOKEN = token();
if (!TOKEN) {
  console.error('缺少 GH_TOKEN / GITHUB_TOKEN, 且 gh 未登录');
  process.exit(1);
}

function api(pathname) {
  return new Promise((resolve, reject) => {
    https.get({
      host: API_HOST,
      path: pathname,
      headers: {
        'Authorization': 'Bearer ' + TOKEN,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'tcg-release-index',
        'X-GitHub-Api-Version': '2022-11-28'
      }
    }, (res) => {
      let buf = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { buf += c; });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' ' + pathname + ' ' + buf.slice(0, 200)));
        try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

async function listAll(base) {
  const out = [];
  for (let page = 1; page <= 20; page++) {
    const arr = await api(`${base}?per_page=100&page=${page}`);
    if (!Array.isArray(arr) || !arr.length) break;
    out.push.apply(out, arr);
    if (arr.length < 100) break;
  }
  return out;
}

const cmpVer = (a, b) => {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
};

function pickAsset(assets, suffix) {
  const a = (assets || []).find((x) => x.name.endsWith(suffix));
  return a ? { name: a.name, url: a.download_url || a.browser_download_url, size: a.size } : null;
}

async function build() {
  const tags = (await listAll(`/repos/${OWNER}/${REPO}/tags`)).filter((t) => /^v\d/.test(t.name));
  const releases = await listAll(`/repos/${OWNER}/${REPO}/releases`);

  /* 同一 tag 可能有重复 Release: 取资产最全、其次最新的一份 */
  const byTag = new Map();
  for (const r of releases) {
    if (!r.tag_name) continue;
    const prev = byTag.get(r.tag_name);
    const score = (x) => ((x.assets || []).length * 1e13) + new Date(x.published_at || 0).getTime();
    if (!prev || score(r) > score(prev)) byTag.set(r.tag_name, r);
  }

  const items = [];
  const seen = new Set();
  const add = (tagName, release) => {
    seen.add(tagName);
    const version = tagName.replace(/^v/, '');
    const assets = release ? (release.assets || []) : [];
    const apk = pickAsset(assets, '.apk');
    const ipa = pickAsset(assets, '.ipa');
    const sha = pickAsset(assets, '.apk.sha256');
    let status;
    if (!release) status = 'unreleased';
    else if (!assets.length) status = 'missing';
    else if (apk && ipa && sha) status = 'complete';
    else status = 'partial';
    items.push({
      version,
      tag: tagName,
      status,
      publishedAt: release ? (release.published_at || null) : null,
      releaseUrl: release ? release.html_url : null,
      apk,
      apkSha256: sha,
      ipa,
      /* Android 只能靠 APK 回滚; iOS 靠 IPA。任一存在即"该端可回滚" */
      rollbackable: !!(apk || ipa)
    });
  };

  tags.forEach((t) => add(t.name, byTag.get(t.name) || null));
  /* 没有对应 tag 的历史 Release 也收录(极早期版本), 但标注出来 */
  for (const [tagName, r] of byTag) {
    if (seen.has(tagName)) continue;
    if (!/^v\d/.test(tagName)) continue;
    add(tagName, r);
  }

  items.sort((a, b) => cmpVer(b.version, a.version));

  const complete = items.filter((i) => i.status === 'complete');
  const latestVer = complete.length ? complete[0].version : (items.length ? items[0].version : null);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    repo: `${OWNER}/${REPO}`,
    latest: latestVer,
    counts: {
      total: items.length,
      complete: items.filter((i) => i.status === 'complete').length,
      partial: items.filter((i) => i.status === 'partial').length,
      missing: items.filter((i) => i.status === 'missing').length,
      unreleased: items.filter((i) => i.status === 'unreleased').length
    },
    releases: items
  };
}

function stripGeneratedAt(obj) {
  const c = JSON.parse(JSON.stringify(obj));
  delete c.generatedAt;
  return c;
}

(async () => {
  const data = await build();
  const text = JSON.stringify(data, null, 2) + '\n';

  if (process.argv.includes('--check')) {
    if (!fs.existsSync(OUT)) { console.error('缺少 releases_index.json, 请先运行 node scripts/gen_release_index.js'); process.exit(1); }
    const cur = JSON.parse(fs.readFileSync(OUT, 'utf8'));
    const a = JSON.stringify(stripGeneratedAt(cur));
    const b = JSON.stringify(stripGeneratedAt(data));
    if (a !== b) {
      console.error('[release-index] 清单与线上 Releases 不一致, 请重新生成并提交');
      process.exit(1);
    }
    console.log('[release-index] 一致, 共 ' + data.releases.length + ' 个版本');
    return;
  }

  fs.writeFileSync(OUT, text);
  console.log('[release-index] 已写入 ' + OUT);
  console.log('  版本 ' + data.counts.total + ' | complete ' + data.counts.complete +
    ' | partial ' + data.counts.partial + ' | missing ' + data.counts.missing +
    ' | unreleased ' + data.counts.unreleased + ' | latest ' + data.latest);
})().catch((e) => {
  console.error('[release-index] 失败: ' + e.message);
  process.exit(1);
});
