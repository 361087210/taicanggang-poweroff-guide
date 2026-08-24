// V5.0 GitHub delivery: push files to main, create Release V5.0, upload APK asset
const fs = require('fs');
const path = require('path');

const ROOT = 'e:/车辆断电指导应用开发';
const REPO = '361087210/taicanggang-poweroff-guide';
const TOKEN = process.env.GH_TOKEN;
const API = 'https://api.github.com';

if (!TOKEN) { console.error('GH_TOKEN missing'); process.exit(1); }

const H = {
  'Authorization': 'Bearer ' + TOKEN,
  'User-Agent': 'tcg-v50-sync',
  'Accept': 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28'
};

const FILES = [
  ['demo.html', 'demo.html'],
  ['version.json', 'version.json'],
  ['config.xml', 'config.xml'],
  ['tcg_app/config.xml', 'tcg_app/config.xml'],
  ['README.md', 'README.md'],
  ['vehicles_data.js', 'vehicles_data.js'],
  ['build_apk_v50.bat', 'build_apk_v50.bat'],
  ['patch_projectbuilder.js', 'scripts/patch_projectbuilder.js'],
  ['sync_github_v50.js', 'scripts/sync_github_v50.js'],
  ['tests/test_v50_fixes.py', 'tests/test_v50_fixes.py'],
];

const DELETES = ['release/太仓港断电指导V4.1.apk', '太仓港断电指导V4.1.apk'];

async function api(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!res.ok) throw new Error(`${res.status} ${url}\n${typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function withRetry(fn, label, times = 3) {
  let lastErr;
  for (let i = 1; i <= times; i++) {
    try { return await fn(); } catch (e) {
      lastErr = e;
      console.log(`  retry ${i}/${times} ${label}: ${String(e.message).slice(0, 120)}`);
      await new Promise(r => setTimeout(r, 3000 * i));
    }
  }
  throw lastErr;
}

async function main() {
  const cachePath = path.join(ROOT, '.sync_blob_cache_v50.json');
  const cache = fs.existsSync(cachePath) ? JSON.parse(fs.readFileSync(cachePath, 'utf8')) : {};

  // 1. Get current main head commit + tree
  const ref = await api(`${API}/repos/${REPO}/git/ref/heads/main`);
  const headSha = ref.object.sha;
  const commit = await api(`${API}/repos/${REPO}/git/commits/${headSha}`);
  const baseTree = commit.tree.sha;
  console.log('[1] main HEAD:', headSha.slice(0, 8), 'tree:', baseTree.slice(0, 8));

  // 2. Create blobs
  const entries = [];
  for (const [local, remote] of FILES) {
    const localPath = path.join(ROOT, local);
    if (!fs.existsSync(localPath)) {
      console.log('  skip (not found):', local);
      continue;
    }
    const buf = fs.readFileSync(localPath);
    const key = remote;
    if (cache[key] && cache[key].size === buf.length) {
      entries.push({ path: remote, mode: '100644', type: 'blob', sha: cache[key].sha });
      console.log('  blob cached:', remote);
      continue;
    }
    const blob = await withRetry(() => api(`${API}/repos/${REPO}/git/blobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: buf.toString('base64'), encoding: 'base64' })
    }), 'blob ' + remote);
    cache[key] = { sha: blob.sha, size: buf.length };
    fs.writeFileSync(cachePath, JSON.stringify(cache));
    entries.push({ path: remote, mode: '100644', type: 'blob', sha: blob.sha });
    console.log('  blob ok:', remote, buf.length, 'bytes');
  }

  // Delete old paths
  const baseTreeData = await api(`${API}/repos/${REPO}/git/trees/${baseTree}?recursive=1`);
  const existing = new Set(baseTreeData.tree.filter(t => t.type === 'blob').map(t => t.path));
  for (const p of DELETES) {
    if (!existing.has(p)) { console.log('  tree delete skipped (absent):', p); continue; }
    entries.push({ path: p, mode: '100644', type: 'blob', sha: null });
    console.log('  tree delete:', p);
  }

  // 3. Tree -> commit -> update ref
  const tree = await withRetry(() => api(`${API}/repos/${REPO}/git/trees`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ base_tree: baseTree, tree: entries })
  }), 'tree');
  const newCommit = await withRetry(() => api(`${API}/repos/${REPO}/git/commits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'V5.0: 修复视频/编辑/导出/备份/同步全链路问题',
      tree: tree.sha,
      parents: [headSha]
    })
  }), 'commit');
  await withRetry(() => api(`${API}/repos/${REPO}/git/refs/heads/main`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sha: newCommit.sha })
  }), 'update ref');
  console.log('[2] Commit pushed:', newCommit.sha.slice(0, 8));

  // 4. Create Release V5.0
  const rels = await api(`${API}/repos/${REPO}/releases`);
  for (const r of rels) {
    if (r.tag_name === 'V5.0') {
      await api(`${API}/repos/${REPO}/releases/${r.id}`, { method: 'DELETE' });
      console.log('  old V5.0 release deleted');
    }
  }
  const ver = JSON.parse(fs.readFileSync(path.join(ROOT, 'version.json'), 'utf8'));
  const notes = `## V5.0 更新内容\n\n` + ver.changelog.map(c => '- ' + c).join('\n') +
    `\n\n## 下载\n- Android APK：本页附件 taicanggang-V5.0.apk（${ver.apkSize}）\n- 飞书云盘备份：${ver.feishuFolder}\n\n**发布日期**：${ver.date}`;
  const release = await api(`${API}/repos/${REPO}/releases`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: 'V5.0',
      target_commitish: 'main',
      name: '太仓港断电指导 V5.0',
      body: notes,
      draft: false,
      prerelease: false
    })
  });
  console.log('[3] Release created:', release.html_url);

  // 5. Upload APK asset
  const apkPath = path.join(ROOT, '太仓港断电指导V5.0.apk');
  if (!fs.existsSync(apkPath)) {
    console.log('[4] APK not found at', apkPath, '- skipping asset upload');
    console.log('\nDone! Release:', release.html_url);
    return;
  }
  const apkBuf = fs.readFileSync(apkPath);
  console.log('[4] Uploading APK', apkBuf.length, 'bytes...');
  const uploadUrl = `https://uploads.github.com/repos/${REPO}/releases/${release.id}/assets?name=taicanggang-V5.0.apk`;
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      ...H,
      'Content-Type': 'application/vnd.android.package-archive',
      'Content-Length': String(apkBuf.length)
    },
    body: apkBuf
  });
  if (upRes.ok) {
    const upData = await upRes.json();
    console.log('  APK uploaded:', upData.browser_download_url);
  } else {
    console.log('  APK upload failed:', upRes.status, (await upRes.text()).slice(0, 200));
  }

  console.log('\n=== GitHub sync complete ===');
  console.log('Commit:', newCommit.sha.slice(0, 8));
  console.log('Release:', release.html_url);
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
