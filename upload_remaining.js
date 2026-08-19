#!/usr/bin/env node
/**
 * Upload remaining files (batch 1 failed files) in smaller batches
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'api.github.com';
const REPO_NAME = 'taicanggang-poweroff-guide';
const PROJECT_DIR = __dirname;
const TOKEN = process.argv[2];
const OWNER = '361087210';

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: GITHUB_API,
      path: apiPath,
      method: method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'taicanggang-uploader',
        'Content-Type': 'application/json',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(options, (res) => {
      let chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = raw ? JSON.parse(raw) : null; } catch(e) { json = raw; }
        resolve({ status: res.statusCode, data: json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function getMainSHA() {
  const r = await apiRequest('GET', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`);
  return r.data.object.sha;
}

async function uploadFiles(files, parentSHA, label) {
  console.log(`\n  Uploading ${label} (${files.length} files)...`);
  const treeItems = files.map(f => {
    const item = { path: f.path, mode: '100644', type: 'blob' };
    if (f.isBinary) {
      item.content = f.content;
      item.encoding = 'base64';
    } else {
      item.content = f.content;
    }
    return item;
  });

  const treeResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/trees`, {
    base: parentSHA,
    tree: treeItems,
  });

  if (treeResp.status !== 201) {
    console.error(`  Tree failed: ${treeResp.status} ${JSON.stringify(treeResp.data).substring(0, 200)}`);
    return parentSHA;
  }
  console.log(`  Tree: ${treeResp.data.sha.substring(0, 7)}`);

  const commitResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/commits`, {
    message: `Upload ${label}`,
    tree: treeResp.data.sha,
    parents: [parentSHA],
  });

  if (commitResp.status !== 201) {
    console.error(`  Commit failed: ${commitResp.status}`);
    return parentSHA;
  }
  console.log(`  Commit: ${commitResp.data.sha.substring(0, 7)}`);

  const refResp = await apiRequest('PATCH', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`, {
    sha: commitResp.data.sha,
    force: true,
  });

  if (refResp.status === 200) {
    console.log(`  Branch updated!`);
  }
  return commitResp.data.sha;
}

function readText(fp) { return fs.readFileSync(fp, 'utf8'); }
function readBase64(fp) { return fs.readFileSync(fp).toString('base64'); }

async function main() {
  console.log('=== Uploading remaining files ===\n');

  let sha = await getMainSHA();
  console.log(`Current main SHA: ${sha.substring(0, 7)}`);

  // Batch 1: Text files (all small)
  const textFiles = [
    'demo.html',
    'test_full_v3.py',
    '太仓港断电指导APP开发文档V1.0.html',
    'vehicles_data.js',
    'extract_final.py',
    'generate_js.py',
    'build_apk_v31.bat',
    'package.json',
  ].map(f => {
    const fp = path.join(PROJECT_DIR, f);
    return { path: f, content: readText(fp), isBinary: false };
  });

  sha = await uploadFiles(textFiles, sha, 'text files');

  // Batch 2: Small images (first 5 from failed batch)
  const smallImages = [
    'image1.jpeg', 'image10.jpeg', 'image100.jpeg', 'image101.jpeg'
  ].map(f => {
    const fp = path.join(PROJECT_DIR, 'vehicle_images', f);
    return { path: `vehicle_images/${f}`, content: readBase64(fp), isBinary: true };
  });

  sha = await uploadFiles(smallImages, sha, 'small images');

  // Batch 3-10: Upload each large binary file individually
  const largeFiles = [
    { name: '太仓港断电指导V2.0-release.apk.1', path: '太仓港断电指导V2.0-release.apk.1' },
    { name: '太仓港断电指导V2.0.apk.1', path: '太仓港断电指导V2.0.apk.1' },
    { name: '太仓港断电指导V2.0_1.apk', path: '太仓港断电指导V2.0_1.apk' },
    { name: '太仓港断电指导V1.8.apk', path: '太仓港断电指导V1.8.apk' },
    { name: '断电指导软件截图(1).pdf', path: '断电指导软件截图(1).pdf' },
    { name: '比亚迪唐L断电操作.pdf', path: '比亚迪唐L断电操作.pdf' },
    { name: '太仓港商品车断电操作手册.docx', path: '太仓港商品车断电操作手册.docx' },
    { name: '太仓港商品车断电操作手册20260603版.docx', path: '太仓港商品车断电操作手册20260603版.docx' },
  ];

  for (const f of largeFiles) {
    const fp = path.join(PROJECT_DIR, f.path);
    if (!fs.existsSync(fp)) {
      console.log(`\n  Skipping ${f.name} (not found)`);
      continue;
    }
    const stat = fs.statSync(fp);
    console.log(`\n  Uploading ${f.name} (${(stat.size/1024/1024).toFixed(1)}MB)...`);

    const content = readBase64(fp);
    const treeItems = [{
      path: f.path,
      mode: '100644',
      type: 'blob',
      content: content,
      encoding: 'base64',
    }];

    const treeResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/trees`, {
      base: sha,
      tree: treeItems,
    });

    if (treeResp.status !== 201) {
      console.error(`  Tree failed: ${treeResp.status} ${JSON.stringify(treeResp.data).substring(0, 300)}`);
      continue;
    }
    console.log(`  Tree: ${treeResp.data.sha.substring(0, 7)}`);

    const commitResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/commits`, {
      message: `Upload ${f.name}`,
      tree: treeResp.data.sha,
      parents: [sha],
    });

    if (commitResp.status !== 201) {
      console.error(`  Commit failed: ${commitResp.status}`);
      continue;
    }

    sha = commitResp.data.sha;
    console.log(`  Commit: ${sha.substring(0, 7)}`);

    const refResp = await apiRequest('PATCH', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`, {
      sha: sha,
      force: true,
    });

    if (refResp.status === 200) {
      console.log(`  Branch updated! ✓`);
    }
  }

  console.log(`\n=== Upload Complete! ===`);
  console.log(`Repository: https://github.com/${OWNER}/${REPO_NAME}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
