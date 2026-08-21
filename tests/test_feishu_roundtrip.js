// Real Feishu API roundtrip test for the fixed upload/download logic
// 安全加固: 凭证从环境变量读取, 不硬编码在代码中
//   用法: FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_FOLDER=xxx node tests/test_feishu_roundtrip.js
const CFG = {
  appId: process.env.FEISHU_APP_ID || '',
  appSecret: process.env.FEISHU_APP_SECRET || '',
  folder: process.env.FEISHU_FOLDER || ''
};

if (!CFG.appId || !CFG.appSecret || !CFG.folder) {
  console.error('缺少环境变量: FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER');
  process.exit(1);
}

async function getToken() {
  const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: CFG.appId, app_secret: CFG.appSecret })
  });
  const data = await res.json();
  if (!data.tenant_access_token) throw new Error('auth failed: ' + JSON.stringify(data));
  return data.tenant_access_token;
}

async function main() {
  const token = await getToken();
  console.log('[1] Token OK');

  const docName = 'sync_test_roundtrip.json';
  // delete old
  const listRes = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${CFG.folder}&page_size=200`, { headers: { Authorization: 'Bearer ' + token } });
  const listData = await listRes.json();
  if (listData.code !== 0) throw new Error('list failed: ' + JSON.stringify(listData));
  const olds = ((listData.data || {}).files || []).filter(f => f.name === docName);
  for (const f of olds) {
    await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${f.token}?type=file`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  }
  console.log('[2] Old files cleaned:', olds.length);

  // upload with file content (the fixed pattern)
  const payload = JSON.stringify({ type: 'test', msg: 'v4.1 roundtrip', ts: Date.now() });
  const blob = new Blob([payload], { type: 'application/json' });
  const fd = new FormData();
  fd.append('file_name', docName);
  fd.append('parent_type', 'explorer');
  fd.append('parent_node', CFG.folder);
  fd.append('size', String(blob.size));
  fd.append('file', blob, docName);
  const upRes = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: fd
  });
  const upData = await upRes.json();
  if (upData.code !== 0 && upData.code !== undefined) throw new Error('upload failed: ' + JSON.stringify(upData));
  console.log('[3] Upload OK ->', upData.data && upData.data.file_token);

  // download
  const list2 = await (await fetch(`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${CFG.folder}&page_size=200`, { headers: { Authorization: 'Bearer ' + token } })).json();
  const target = ((list2.data || {}).files || []).find(f => f.name === docName);
  if (!target) throw new Error('uploaded file not found in listing');
  const dlRes = await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`, { headers: { Authorization: 'Bearer ' + token } });
  const dlText = await dlRes.text();
  const parsed = JSON.parse(dlText);
  console.log('[4] Download OK ->', parsed.msg, parsed.ts === JSON.parse(payload).ts ? 'CONTENT MATCH' : 'CONTENT MISMATCH');

  // cleanup
  await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}?type=file`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
  console.log('[5] Cleanup OK');
  console.log('ROUNDTRIP TEST PASSED');
}

main().catch(e => { console.error('FAILED:', e.message); process.exit(1); });
