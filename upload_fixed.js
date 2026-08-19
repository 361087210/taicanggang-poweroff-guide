#!/usr/bin/env node
/**
 * Fixed upload script - uses correct tree SHA as base_tree
 * This ensures all previous files are preserved when adding new files
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const GITHUB_API = 'api.github.com';
const REPO_NAME = 'taicanggang-poweroff-guide';
const PROJECT_DIR = __dirname;
const TOKEN = process.argv[2];
const OWNER = '361087210';
const IMG_DIR = path.join(PROJECT_DIR, 'vehicle_images');

function api(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: GITHUB_API, path: p, method,
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'taicanggang-uploader',
        'Content-Type': 'application/json',
      }
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);
    const req = https.request(opts, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
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

async function getCommitInfo(sha) {
  const r = await api('GET', `/repos/${OWNER}/${REPO_NAME}/git/commits/${sha}`);
  return { commitSHA: sha, treeSHA: r.data.tree.sha };
}

async function getCurrentMain() {
  const r = await api('GET', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`);
  const commitSHA = r.data.object.sha;
  return getCommitInfo(commitSHA);
}

async function createTree(baseTreeSHA, items) {
  const r = await api('POST', `/repos/${OWNER}/${REPO_NAME}/git/trees`, {
    base_tree: baseTreeSHA,
    tree: items,
  });
  return r;
}

async function createCommit(treeSHA, parentSHA, message) {
  const r = await api('POST', `/repos/${OWNER}/${REPO_NAME}/git/commits`, {
    message, tree: treeSHA, parents: [parentSHA],
  });
  return r;
}

async function updateRef(commitSHA) {
  const r = await api('PATCH', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`, {
    sha: commitSHA, force: true,
  });
  return r.status === 200;
}

function readText(fp) { return fs.readFileSync(fp, 'utf8'); }
function readBase64(fp) { return fs.readFileSync(fp).toString('base64'); }

function makeTreeItem(filePath, content, isBinary) {
  const item = { path: filePath, mode: '100644', type: 'blob' };
  if (isBinary) {
    item.content = content;
    item.encoding = 'base64';
  } else {
    item.content = content;
  }
  return item;
}

async function main() {
  console.log('=== Fixed Upload: All Project Files ===\n');

  // Get current state
  const { commitSHA: parentCommit, treeSHA: baseTree } = await getCurrentMain();
  console.log(`Current commit: ${parentCommit.substring(0, 7)}`);
  console.log(`Current tree: ${baseTree.substring(0, 7)}`);

  // We need to go back to the initial commit (auto-init README) and rebuild
  // Actually, let's just use the current tree as base and add all files
  // The current tree only has the last batch of images, so we need to add everything

  let currentTreeSHA = baseTree;
  let currentCommitSHA = parentCommit;

  // Step 1: Upload text files
  console.log('\n[1] Uploading text files...');
  const textFiles = [
    { name: 'demo.html', path: 'demo.html' },
    { name: 'test_full_v3.py', path: 'test_full_v3.py' },
    { name: '太仓港断电指导APP开发文档V1.0.html', path: '太仓港断电指导APP开发文档V1.0.html' },
    { name: 'vehicles_data.js', path: 'vehicles_data.js' },
    { name: 'extract_final.py', path: 'extract_final.py' },
    { name: 'generate_js.py', path: 'generate_js.py' },
    { name: 'build_apk_v31.bat', path: 'build_apk_v31.bat' },
    { name: 'package.json', path: 'package.json' },
    { name: 'upload_to_github.js', path: 'upload_to_github.js' },
    { name: 'upload_remaining.js', path: 'upload_remaining.js' },
    { name: 'upload_images.js', path: 'upload_images.js' },
    { name: 'upload_fixed.js', path: 'upload_fixed.js' },
  ];

  const textItems = textFiles.map(f => {
    const fp = path.join(PROJECT_DIR, f.path);
    const stat = fs.statSync(fp);
    console.log(`  [TEXT] ${f.name} (${(stat.size/1024).toFixed(1)}KB)`);
    return makeTreeItem(f.path, readText(fp), false);
  });

  // Also add a README
  const readmeContent = `# 太仓港商品车断电指导APP

太仓港商品车断电指导应用，包含应用主程序、安卓安装包、开发文档和测试脚本。

## 项目产物

| 文件 | 说明 |
|------|------|
| \`demo.html\` | 应用主程序（Web版） |
| \`太仓港断电指导V2.0-release.apk.1\` | 安卓安装包 |
| \`太仓港断电指导APP开发文档V1.0.html\` | 开发文档 |
| \`test_full_v3.py\` | 自动化测试脚本 |
| \`vehicles_data.js\` | 车型数据 |
| \`vehicle_images/\` | 车型图片（112张） |

## 技术栈

- HTML5 + CSS3 + JavaScript（前端）
- Apache Cordova（安卓打包）
- Playwright（自动化测试）

## 版本

当前版本: V1.1

## 文件说明

### 应用主程序
- \`demo.html\` - 完整的单文件Web应用，包含登录、车型管理、数据同步等功能

### 安卓安装包
- \`太仓港断电指导V2.0-release.apk.1\` - Release版本
- \`太仓港断电指导V2.0.apk.1\` - V2.0版本
- \`太仓港断电指导V1.8.apk\` - V1.8版本

### 开发文档
- \`太仓港断电指导APP开发文档V1.0.html\` - 完整开发文档

### 测试脚本
- \`test_full_v3.py\` - Playwright自动化测试（34项测试）

### 数据文件
- \`vehicles_data.js\` - 73辆车的完整数据
- \`vehicle_images/\` - 162张图片（112张关联到具体车型）

### 源文档
- \`太仓港商品车断电操作手册20260603版.docx\` - 原始操作手册
- \`比亚迪唐L断电操作.pdf\` - 比亚迪唐L断电操作指导
- \`断电指导软件截图(1).pdf\` - 软件截图
`;
  textItems.push(makeTreeItem('README.md', readmeContent, false));

  const treeResp1 = await createTree(currentTreeSHA, textItems);
  if (treeResp1.status === 201) {
    currentTreeSHA = treeResp1.data.sha;
    const c1 = await createCommit(currentTreeSHA, currentCommitSHA, 'Upload text files and README');
    if (c1.status === 201) {
      currentCommitSHA = c1.data.sha;
      await updateRef(currentCommitSHA);
      console.log(`  Text files uploaded ✓ (commit ${currentCommitSHA.substring(0, 7)})`);
    }
  } else {
    console.error(`  Failed: ${treeResp1.status} ${JSON.stringify(treeResp1.data).substring(0, 200)}`);
  }

  // Step 2: Upload each large binary file individually
  const binaryFiles = [
    { name: '太仓港断电指导V2.0-release.apk.1', path: '太仓港断电指导V2.0-release.apk.1' },
    { name: '太仓港断电指导V2.0.apk.1', path: '太仓港断电指导V2.0.apk.1' },
    { name: '太仓港断电指导V2.0_1.apk', path: '太仓港断电指导V2.0_1.apk' },
    { name: '太仓港断电指导V1.8.apk', path: '太仓港断电指导V1.8.apk' },
    { name: '断电指导软件截图(1).pdf', path: '断电指导软件截图(1).pdf' },
    { name: '比亚迪唐L断电操作.pdf', path: '比亚迪唐L断电操作.pdf' },
    { name: '太仓港商品车断电操作手册.docx', path: '太仓港商品车断电操作手册.docx' },
    { name: '太仓港商品车断电操作手册20260603版.docx', path: '太仓港商品车断电操作手册20260603版.docx' },
  ];

  for (const f of binaryFiles) {
    const fp = path.join(PROJECT_DIR, f.path);
    if (!fs.existsSync(fp)) { continue; }
    const stat = fs.statSync(fp);
    console.log(`\n  [BIN] ${f.name} (${(stat.size/1024/1024).toFixed(1)}MB)`);

    const items = [makeTreeItem(f.path, readBase64(fp), true)];
    const tr = await createTree(currentTreeSHA, items);
    if (tr.status === 201) {
      currentTreeSHA = tr.data.sha;
      const cr = await createCommit(currentTreeSHA, currentCommitSHA, `Upload ${f.name}`);
      if (cr.status === 201) {
        currentCommitSHA = cr.data.sha;
        await updateRef(currentCommitSHA);
        console.log(`  ✓ (${currentCommitSHA.substring(0, 7)})`);
      }
    } else {
      console.error(`  Failed: ${tr.status}`);
    }
  }

  // Step 3: Upload all images in batches of 10
  console.log('\n[3] Uploading all vehicle images...');
  const allImages = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(jpg|jpeg|png|gif|bmp)$/i.test(f))
    .sort();

  console.log(`  Total images: ${allImages.length}`);
  const batchSize = 10;

  for (let i = 0; i < allImages.length; i += batchSize) {
    const batch = allImages.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    const totalBatches = Math.ceil(allImages.length / batchSize);
    console.log(`  [Batch ${batchNum}/${totalBatches}] ${batch.length} images`);

    const items = batch.map(name => {
      const fp = path.join(IMG_DIR, name);
      return makeTreeItem(`vehicle_images/${name}`, readBase64(fp), true);
    });

    const tr = await createTree(currentTreeSHA, items);
    if (tr.status === 201) {
      currentTreeSHA = tr.data.sha;
      const cr = await createCommit(currentTreeSHA, currentCommitSHA, `Upload vehicle images batch ${batchNum}/${totalBatches}`);
      if (cr.status === 201) {
        currentCommitSHA = cr.data.sha;
        await updateRef(currentCommitSHA);
        process.stdout.write(`  ✓\n`);
      }
    } else {
      console.error(`  Failed: ${tr.status}`);
    }
  }

  console.log(`\n=== Upload Complete! ===`);
  console.log(`Repository: https://github.com/${OWNER}/${REPO_NAME}`);
  console.log(`Final commit: ${currentCommitSHA.substring(0, 7)}`);
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
