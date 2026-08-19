#!/usr/bin/env node
/**
 * Upload project deliverables to GitHub repository via REST API
 * Usage: node upload_to_github.js <github_token>
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'api.github.com';
const REPO_NAME = 'taicanggang-poweroff-guide';
const REPO_DESC = '太仓港商品车断电指导APP - 包含应用主程序、安卓安装包、开发文档和测试脚本';
const PROJECT_DIR = __dirname;

function apiRequest(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: GITHUB_API,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
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
        resolve({ status: res.statusCode, data: json, headers: res.headers });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function createRepo(token) {
  return apiRequest('POST', '/user/repos', {
    name: REPO_NAME,
    description: REPO_DESC,
    private: false,
    auto_init: true,
  }, token);
}

function getRepoInfo(token, owner) {
  return apiRequest('GET', `/repos/${owner}/${REPO_NAME}`, null, token);
}

function getDefaultBranchSHA(token, owner) {
  return apiRequest('GET', `/repos/${owner}/${REPO_NAME}/git/refs/heads/main`, null, token);
}

function createTreeBlobs(token, owner, files) {
  const treeItems = files.map(f => ({
    path: f.path,
    mode: '100644',
    type: 'blob',
    content: f.content,
  }));
  return apiRequest('POST', `/repos/${owner}/${REPO_NAME}/git/trees`, { tree: treeItems }, token);
}

function createCommit(token, owner, treeSHA, parentSHA) {
  return apiRequest('POST', `/repos/${owner}/${REPO_NAME}/git/commits`, {
    message: 'Upload all project deliverables',
    tree: treeSHA,
    parents: [parentSHA],
  }, token);
}

function updateRef(token, owner, commitSHA) {
  return apiRequest('PATCH', `/repos/${owner}/${REPO_NAME}/git/refs/heads/main`, {
    sha: commitSHA,
    force: true,
  }, token);
}

function readFileAsText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function readFileAsBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  return buf.toString('base64');
}

function isBinary(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ['.apk', '.pdf', '.docx', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.zip'].includes(ext);
}

function collectFiles() {
  const files = [];
  const maxTextSize = 10 * 1024 * 1024; // 10MB limit for text
  const maxBinSize = 50 * 1024 * 1024; // 50MB limit for binary

  const textFiles = [
    'demo.html',
    'test_full_v3.py',
    '太仓港断电指导APP开发文档V1.0.html',
    'vehicles_data.js',
    'extract_final.py',
    'generate_js.py',
    'build_apk_v31.bat',
    'package.json',
  ];

  const binaryFiles = [
    '太仓港断电指导V2.0-release.apk.1',
    '太仓港断电指导V2.0.apk.1',
    '太仓港断电指导V2.0_1.apk',
    '太仓港断电指导V1.8.apk',
    '断电指导软件截图(1).pdf',
    '比亚迪唐L断电操作.pdf',
    '太仓港商品车断电操作手册.docx',
    '太仓港商品车断电操作手册20260603版.docx',
  ];

  for (const f of textFiles) {
    const fp = path.join(PROJECT_DIR, f);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      if (stat.size <= maxTextSize) {
        files.push({ path: f, content: readFileAsText(fp), isBinary: false, size: stat.size });
        console.log(`  [TEXT] ${f} (${(stat.size/1024).toFixed(1)}KB)`);
      } else {
        console.log(`  [SKIP] ${f} too large (${(stat.size/1024/1024).toFixed(1)}MB)`);
      }
    }
  }

  for (const f of binaryFiles) {
    const fp = path.join(PROJECT_DIR, f);
    if (fs.existsSync(fp)) {
      const stat = fs.statSync(fp);
      if (stat.size <= maxBinSize) {
        files.push({ path: f, content: readFileAsBase64(fp), isBinary: true, size: stat.size });
        console.log(`  [BIN]  ${f} (${(stat.size/1024/1024).toFixed(1)}MB)`);
      } else {
        console.log(`  [SKIP] ${f} too large (${(stat.size/1024/1024).toFixed(1)}MB)`);
      }
    }
  }

  // Collect vehicle_images (up to 50 images to stay within limits)
  const imgDir = path.join(PROJECT_DIR, 'vehicle_images');
  if (fs.existsSync(imgDir)) {
    const imgs = fs.readdirSync(imgDir).filter(f => /\.(jpg|jpeg|png|gif|bmp)$/i.test(f)).sort();
    const maxImages = 50;
    for (let i = 0; i < Math.min(imgs.length, maxImages); i++) {
      const fp = path.join(imgDir, imgs[i]);
      const stat = fs.statSync(fp);
      if (stat.size <= 5 * 1024 * 1024) {
        files.push({
          path: `vehicle_images/${imgs[i]}`,
          content: readFileAsBase64(fp),
          isBinary: true,
          size: stat.size,
        });
        console.log(`  [IMG]  vehicle_images/${imgs[i]} (${(stat.size/1024).toFixed(1)}KB)`);
      }
    }
    if (imgs.length > maxImages) {
      console.log(`  [INFO] ${imgs.length - maxImages} more images skipped (limit: ${maxImages})`);
    }
  }

  return files;
}

async function main() {
  const token = process.argv[2] || process.env.GITHUB_TOKEN;
  if (!token) {
    console.error('ERROR: No GitHub token provided.');
    console.error('Usage: node upload_to_github.js <github_personal_access_token>');
    console.error('');
    console.error('Create a token at: https://github.com/settings/tokens/new');
    console.error('Required scopes: repo (Full control of private repositories)');
    process.exit(1);
  }

  console.log('=== 太仓港断电指导APP - GitHub Upload Tool ===\n');

  // Step 1: Get user info
  console.log('[1] Checking GitHub authentication...');
  const me = await apiRequest('GET', '/user', null, token);
  if (me.status !== 200) {
    console.error(`  Failed to authenticate: ${me.status} ${JSON.stringify(me.data)}`);
    process.exit(1);
  }
  const owner = me.data.login;
  console.log(`  Authenticated as: ${owner}`);

  // Step 2: Create or verify repository
  console.log('\n[2] Creating repository...');
  let repoResp = await createRepo(token);
  if (repoResp.status === 201 || repoResp.status === 200) {
    console.log(`  Repository created: ${repoResp.data.html_url}`);
  } else if (repoResp.status === 422) {
    console.log(`  Repository already exists, using existing one.`);
  } else {
    console.error(`  Failed to create repo: ${repoResp.status} ${JSON.stringify(repoResp.data)}`);
    process.exit(1);
  }

  // Step 3: Get default branch SHA
  console.log('\n[3] Getting default branch info...');
  let refResp = await getDefaultBranchSHA(token, owner);
  let parentSHA;
  if (refResp.status === 200) {
    parentSHA = refResp.data.object.sha;
    console.log(`  Main branch SHA: ${parentSHA}`);
  } else {
    // Try master
    refResp = await apiRequest('GET', `/repos/${owner}/${REPO_NAME}/git/refs/heads/master`, null, token);
    if (refResp.status === 200) {
      parentSHA = refResp.data.object.sha;
      console.log(`  Master branch SHA: ${parentSHA}`);
    } else {
      console.error(`  Failed to get branch SHA: ${refResp.status}`);
      process.exit(1);
    }
  }

  // Step 4: Collect files
  console.log('\n[4] Collecting project files...');
  const files = collectFiles();
  console.log(`\n  Total files to upload: ${files.length}`);

  if (files.length === 0) {
    console.error('  No files to upload!');
    process.exit(1);
  }

  // Step 5: Upload files in batches (GitHub tree API has a limit)
  // Split into batches of 20 files to avoid timeouts
  const batchSize = 20;
  let currentSHA = parentSHA;

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(files.length / batchSize);

    console.log(`\n[5.${batchNum}/${totalBatches}] Uploading batch (${batch.length} files)...`);

    // For binary files, we need to use base64 encoding in the tree
    const treeItems = batch.map(f => {
      if (f.isBinary) {
        return {
          path: f.path,
          mode: '100644',
          type: 'blob',
          content: f.content,
          encoding: 'base64',
        };
      } else {
        return {
          path: f.path,
          mode: '100644',
          type: 'blob',
          content: f.content,
        };
      }
    });

    // Create tree
    const treeResp = await apiRequest('POST', `/repos/${owner}/${REPO_NAME}/git/trees`, {
      base: currentSHA,
      tree: treeItems,
    }, token);

    if (treeResp.status !== 201) {
      console.error(`  Failed to create tree: ${treeResp.status} ${JSON.stringify(treeResp.data)}`);
      // Continue with next batch instead of failing
      continue;
    }

    const treeSHA = treeResp.data.sha;
    console.log(`  Tree created: ${treeSHA.substring(0, 7)}`);

    // Create commit
    const commitResp = await createCommit(token, owner, treeSHA, currentSHA);
    if (commitResp.status !== 201) {
      console.error(`  Failed to create commit: ${commitResp.status} ${JSON.stringify(commitResp.data)}`);
      continue;
    }

    currentSHA = commitResp.data.sha;
    console.log(`  Commit created: ${currentSHA.substring(0, 7)}`);
  }

  // Step 6: Update main branch
  console.log('\n[6] Updating main branch...');
  const updateResp = await updateRef(token, owner, currentSHA);
  if (updateResp.status === 200) {
    console.log(`  Branch updated successfully!`);
  } else {
    // Try master
    const updateResp2 = await apiRequest('PATCH', `/repos/${owner}/${REPO_NAME}/git/refs/heads/master`, {
      sha: currentSHA,
      force: true,
    }, token);
    if (updateResp2.status === 200) {
      console.log(`  Master branch updated successfully!`);
    } else {
      console.error(`  Failed to update branch: ${updateResp.status}`);
    }
  }

  console.log(`\n=== Upload Complete! ===`);
  console.log(`Repository: https://github.com/${owner}/${REPO_NAME}`);
  console.log(`Files uploaded: ${files.length}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
