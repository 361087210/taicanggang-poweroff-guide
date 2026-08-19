#!/usr/bin/env node
/**
 * Upload remaining vehicle_images to GitHub
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

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: GITHUB_API,
      path: apiPath,
      method,
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

async function uploadBatch(files, parentSHA, batchNum, totalBatches) {
  console.log(`  [Batch ${batchNum}/${totalBatches}] ${files.length} images...`);
  const treeItems = files.map(f => ({
    path: `vehicle_images/${f.name}`,
    mode: '100644',
    type: 'blob',
    content: fs.readFileSync(f.fullPath).toString('base64'),
    encoding: 'base64',
  }));

  const treeResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/trees`, {
    base: parentSHA,
    tree: treeItems,
  });

  if (treeResp.status !== 201) {
    console.error(`  Tree failed: ${treeResp.status}`);
    return parentSHA;
  }

  const commitResp = await apiRequest('POST', `/repos/${OWNER}/${REPO_NAME}/git/commits`, {
    message: `Upload vehicle images batch ${batchNum}`,
    tree: treeResp.data.sha,
    parents: [parentSHA],
  });

  if (commitResp.status !== 201) {
    console.error(`  Commit failed: ${commitResp.status}`);
    return parentSHA;
  }

  const refResp = await apiRequest('PATCH', `/repos/${OWNER}/${REPO_NAME}/git/refs/heads/main`, {
    sha: commitResp.data.sha,
    force: true,
  });

  if (refResp.status === 200) {
    console.log(`  Done (commit ${commitResp.data.sha.substring(0, 7)})`);
  }
  return commitResp.data.sha;
}

async function main() {
  console.log('=== Uploading remaining vehicle images ===\n');

  // Get all image files
  const allImages = fs.readdirSync(IMG_DIR)
    .filter(f => /\.(jpg|jpeg|png|gif|bmp)$/i.test(f))
    .sort();

  // Already uploaded images (from previous runs)
  const alreadyUploaded = new Set([
    'image1.jpeg', 'image10.jpeg', 'image100.jpeg', 'image101.jpeg',
    'image103.jpeg', 'image105.jpeg', 'image106.jpeg', 'image108.jpeg',
    'image11.jpeg', 'image110.jpeg', 'image111.jpeg', 'image112.jpeg',
    'image113.jpeg', 'image115.jpeg', 'image117.jpeg', 'image118.jpeg',
    'image120.jpeg', 'image121.jpeg', 'image123.jpeg', 'image125.jpeg',
    'image126.jpeg', 'image128.jpeg', 'image129.jpeg', 'image13.jpeg',
    'image131.jpeg', 'image132.jpeg', 'image133.jpeg', 'image134.jpeg',
    'image136.jpeg', 'image137.jpeg', 'image139.jpeg', 'image14.jpeg',
    'image140.jpeg', 'image142.jpeg', 'image143.jpeg', 'image144.jpeg',
    'image145.jpeg', 'image146.jpeg', 'image148.jpeg', 'image149.jpeg',
    'image15.jpeg', 'image151.jpeg', 'image152.jpeg', 'image154.jpeg',
    'image155.jpeg', 'image157.png', 'image158.png', 'image16.jpeg',
    'image160.jpeg', 'image161.jpeg',
  ]);

  const remaining = allImages.filter(f => !alreadyUploaded.has(f));
  console.log(`Total images: ${allImages.length}`);
  console.log(`Already uploaded: ${alreadyUploaded.size}`);
  console.log(`Remaining: ${remaining.length}\n`);

  if (remaining.length === 0) {
    console.log('All images already uploaded!');
    return;
  }

  // Prepare file objects
  const filesToUpload = remaining.map(name => ({
    name,
    fullPath: path.join(IMG_DIR, name),
  }));

  // Upload in batches of 10
  const batchSize = 10;
  const totalBatches = Math.ceil(filesToUpload.length / batchSize);
  let sha = await getMainSHA();
  console.log(`Starting from SHA: ${sha.substring(0, 7)}\n`);

  for (let i = 0; i < filesToUpload.length; i += batchSize) {
    const batch = filesToUpload.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    sha = await uploadBatch(batch, sha, batchNum, totalBatches);
  }

  console.log(`\n=== All images uploaded! ===`);
  console.log(`Repository: https://github.com/${OWNER}/${REPO_NAME}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
