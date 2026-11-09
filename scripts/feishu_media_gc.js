#!/usr/bin/env node
/**
 * feishu_media_gc.js — 飞书云盘媒体「对账 + 整理 + 回收」脚本
 *
 * 解决两个线上症状:
 *   ① 分布散乱 / 命名无序: 云端同时存在三代命名(imageN.jpeg / user_vN_pN_hash /
 *      车型_pN_hash), 且大批文件堆在顶层, 与仓库的三段式布局不一致。
 *   ② 只增不减: 车型照片被替换/删除后, 云端旧文件从不清理, 越积越多,
 *      孤儿文件既占配额又让"到底哪张是对的"变得不可判断。
 *
 * 原则(重要):
 *   - **清单即真源**: 以 vehicles_data.js 的 photoPaths/videoPaths 为准, 云端只服从它。
 *   - **默认不动手**: 不加 --apply 一律 dry-run, 只打印计划。
 *   - **删除可恢复**: 孤儿文件默认"移到 _回收站/<日期>/"而不是硬删; 只有显式
 *     --purge 才真删(且只删已在回收站里的)。
 *   - **不改名**: 改名需要知道新名字(含内容哈希), 云端无从推断 —— 规范命名由
 *     上传侧保证(车型名_pN_hash), 存量旧名文件只要是应用还在引用的就"只挪位不改名";
 *     等应用切到新名字后, 旧文件自然变成孤儿 → 归档。宁可少做, 不做错。
 *   - **歧义不猜**: 一个文件名对应多个车型目录时, 只报告不动手(断电教学媒体张冠李戴
 *     是现场安全问题, 宁可漏不可错)。
 *
 * 用法:
 *   export FEISHU_APP_ID=cli_xxx FEISHU_APP_SECRET=xxx
 *   node scripts/feishu_media_gc.js                     # 预览(默认)
 *   node scripts/feishu_media_gc.js --apply             # 执行整理(移动/归档)
 *   node scripts/feishu_media_gc.js --apply --purge     # 连同回收站内容一起删除
 *   node scripts/feishu_media_gc.js --only photos       # 只处理照片
 *   node scripts/feishu_media_gc.js --report /tmp/gc.json
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API = 'https://open.feishu.cn/open-apis';

/* ---------------- 纯函数: 计划器(可单测, 不发网络请求) ---------------- */

/**
 * @param {Array<{rel:string, name:string, folder:string, token:string, size?:number}>} cloud
 *        云端现有文件, rel 形如 "vehicle_images/比亚迪海豚/image1.jpeg"
 * @param {Set<string>} expected 期望存在的相对路径集合
 * @param {Object} opts {recycleName:'_回收站'}
 * @returns {{moves:Array, orphans:Array, missing:Array, ambiguous:Array}}
 */
function planActions(cloud, expected, opts) {
  const recycleName = (opts && opts.recycleName) || '_回收站';
  const byName = new Map();   // 文件名 → 期望路径列表
  for (const p of expected) {
    const name = p.split('/').pop();
    if (!byName.has(name)) byName.set(name, []);
    byName.get(name).push(p);
  }

  const moves = [], orphans = [], ambiguous = [];
  const present = new Set();

  for (const f of cloud) {
    const rel = f.rel;
    present.add(rel);
    if (expected.has(rel)) continue;                 // 完全正确
    if (rel.includes('/' + recycleName + '/')) continue;  // 回收站内的不参与

    const cands = byName.get(f.name) || [];
    if (cands.length === 1) {
      // 云端有、位置不对、且清单里唯一指向某处 → 移动到位(顺带完成改名)
      moves.push({ from: rel, to: cands[0], token: f.token });
    } else if (cands.length > 1) {
      ambiguous.push({ rel, candidates: cands });
    } else {
      orphans.push({ rel, token: f.token, size: f.size || 0 });
    }
  }

  /* 注意: 被 MOV 到位的目标也算"将有", 否则同一批文件会同时出现在
   * 「位置归位」和「缺失」两个清单里, 让报表看起来比实际糟糕得多。 */
  const willExist = new Set(present);
  moves.forEach(m => willExist.add(m.to));
  const missing = [...expected].filter(p => !willExist.has(p));
  return { moves, orphans, missing, ambiguous };
}

/* ---------------- 飞书 API ---------------- */

async function api(pathname, opt) {
  const res = await fetch(API + pathname, opt || {});
  const txt = await res.text();
  let json = null;
  try { json = JSON.parse(txt); } catch (e) { /* 非 JSON */ }
  if (!res.ok || (json && json.code !== 0 && json.code !== undefined)) {
    const msg = json ? `${json.code} ${json.msg}` : txt.slice(0, 200);
    throw new Error(`API ${pathname} 失败: ${msg}`);
  }
  return json ? json.data : null;
}

async function tenantToken() {
  const id = process.env.FEISHU_APP_ID, secret = process.env.FEISHU_APP_SECRET;
  if (!id || !secret) {
    console.error('[gc] 缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET');
    console.error('[gc] 这两个值在飞书开放平台「凭证与基础信息」页, 不要写进代码');
    process.exit(2);
  }
  const res = await fetch(API + '/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: id, app_secret: secret })
  });
  const j = await res.json();
  if (j.code !== 0) throw new Error('换取 tenant_access_token 失败: ' + j.msg);
  return j.tenant_access_token;
}

async function listFolder(token, folderToken) {
  const out = [];
  let pageToken = '';
  do {
    const q = new URLSearchParams({ folder_token: folderToken, page_size: '200' });
    if (pageToken) q.set('page_token', pageToken);
    const d = await api('/drive/v1/files?' + q.toString(), { headers: { Authorization: 'Bearer ' + token } });
    (d.files || []).forEach(f => out.push(f));
    pageToken = d.has_more ? d.next_page_token : '';
    await sleep(120);
  } while (pageToken);
  return out;
}

async function ensureFolder(token, parentToken, name) {
  const kids = await listFolder(token, parentToken);
  const hit = kids.find(f => f.type === 'folder' && f.name === name);
  if (hit) return hit.token;
  const d = await api('/drive/v1/files/create_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name, folder_token: parentToken })
  });
  return d.token;
}

async function moveFile(token, fileToken, toFolderToken) {
  return api(`/drive/v1/files/${fileToken}/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ type: 'file', folder_token: toFolderToken })
  });
}

async function deleteFile(token, fileToken) {
  return api(`/drive/v1/files/${fileToken}?type=file`, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token }
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------------- 期望集合 ---------------- */

function loadExpected(only) {
  const src = fs.readFileSync(path.join(ROOT, 'vehicles_data.js'), 'utf8');
  const decl = src.match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  const start = src.indexOf('[', decl.index);
  const end = src.lastIndexOf(']');
  const vehicles = new Function('return (' + src.slice(start, end + 1) + ')')();

  const photos = new Set(), videos = new Set();
  vehicles.forEach(v => {
    (v.photoPaths || []).forEach(p => { if (typeof p === 'string' && p.startsWith('vehicle_images/')) photos.add(p); });
    (v.videoPaths || []).forEach(p => { if (typeof p === 'string' && p.startsWith('vehicle_videos/')) videos.add(p); });
  });
  if (only === 'photos') return { photos, videos: new Set() };
  if (only === 'videos') return { photos: new Set(), videos };
  return { photos, videos };
}

/* ---------------- 云端树 ---------------- */

async function indexCloud(token, topName, topToken) {
  const files = [], subTokens = new Map();
  let parts = 0;   // 上传分片(.partNNN): 不是独立资产, 不参与对账
  const partBases = new Map();  // 分片基名 -> 分片数(用于"以分片形态存在"的判定)
  const top = await listFolder(token, topToken);
  for (const f of top) {
    if (f.type === 'folder') subTokens.set(f.name, f.token);
    else if (/\.part(\d+)$/i.test(f.name)) { parts++; addPart(f.name); }
    else files.push({ rel: `${topName}/${f.name}`, name: f.name, folder: '', token: f.token, size: Number(f.size) || 0 });
  }
  for (const [name, tk] of subTokens) {
    const kids = await listFolder(token, tk);
    for (const f of kids) {
      if (f.type === 'folder') continue;  // 目前只处理两层
      if (/\.part(\d+)$/i.test(f.name)) { parts++; addPart(f.name); continue; }  // 分片不计入资产
      files.push({ rel: `${topName}/${name}/${f.name}`, name: f.name, folder: name, token: f.token, size: Number(f.size) || 0 });
    }
  }
  function addPart(name) {
    const base = name.replace(/\.part\d+$/i, '');
    partBases.set(base, (partBases.get(base) || 0) + 1);
  }
  return { files, subTokens, parts, partBases };
}

/* ---------------- 主流程 ---------------- */

async function main() {
  const args = process.argv.slice(2);
  const APPLY = args.includes('--apply');
  const PURGE = args.includes('--purge');
  const onlyIdx = args.indexOf('--only');
  const ONLY = onlyIdx > -1 ? args[onlyIdx + 1] : 'all';
  const repIdx = args.indexOf('--report');
  const REPORT = repIdx > -1 ? path.resolve(args[repIdx + 1]) : '';

  const IMG_TOKEN = process.env.FEISHU_IMG_FOLDER_TOKEN || 'MtZMf8wiJlouSrdYn5dcr44vntg';
  const VID_TOKEN = process.env.FEISHU_VID_FOLDER_TOKEN || 'X5qRffvjtlcmKtdQAqKcW6JGnXe';

  console.log('[gc] 模式: ' + (APPLY ? (PURGE ? '执行(含删除回收站)' : '执行(移动/归档, 不硬删)') : '预览(dry-run)'));
  const token = await tenantToken();
  const exp = loadExpected(ONLY);
  const result = { moves: [], orphans: [], missing: [], ambiguous: [], done: 0, failed: 0 };

  const targets = [
    { name: 'vehicle_images', token: IMG_TOKEN, set: exp.photos },
    { name: 'vehicle_videos', token: VID_TOKEN, set: exp.videos }
  ].filter(t => t.set.size > 0);

  for (const t of targets) {
    console.log(`\n=== ${t.name} === 期望 ${t.set.size} 个文件`);
    const { files, parts, partBases } = await indexCloud(token, t.name, t.token);
    console.log(`    云端实有 ${files.length} 个文件` + (parts ? ` (+${parts} 个上传分片, 已跳过)` : ''));

    /* 视频常见形态: 一个 .mp4 被拆成 .part001~012 上传。这类"资产"不是缺失,
     * 只是以分片存在 —— 先从期望集合里摘出去, 单独计数, 避免虚报缺失。 */
    let asParts = 0;
    const expected = new Set();
    for (const p of t.set) {
      const base = p.split('/').pop();
      if (partBases.has(base)) { asParts++; continue; }
      expected.add(p);
    }
    const plan = planActions(files, expected, { recycleName: '_回收站' });
    if (asParts) console.log(`    其中 ${asParts} 个以分片(.part*)形态存在, 不计入缺失`);
    console.log(`    计划: 移动/改名 ${plan.moves.length} | 孤儿 ${plan.orphans.length} | 缺失 ${plan.missing.length} | 歧义(不动手) ${plan.ambiguous.length}`);

    plan.moves.slice(0, 10).forEach(m => console.log(`      MOV  ${m.from}\n        →  ${m.to}`));
    if (plan.moves.length > 10) console.log(`      ... 另有 ${plan.moves.length - 10} 条`);
    plan.ambiguous.slice(0, 5).forEach(a => console.log(`      ???? ${a.rel} → 候选 ${a.candidates.join(' | ')}`));
    if (plan.missing.length) console.log(`      缺失(需补传): ${plan.missing.slice(0, 5).join(', ')}${plan.missing.length > 5 ? ' …' : ''}`);

    result.moves.push(...plan.moves); result.orphans.push(...plan.orphans);
    result.missing.push(...plan.missing); result.ambiguous.push(...plan.ambiguous);

    if (!APPLY) continue;

    // ---- 执行: 移动/改名 ----
    for (const m of plan.moves) {
      try {
        const seg = m.to.split('/');               // top/folder/name
        const folderName = seg.length === 3 ? seg[1] : '';
        const newName = seg[seg.length - 1];
        const targetFolder = folderName ? await ensureFolder(token, t.token, folderName) : t.token;
        if (newName !== m.from.split('/').pop()) {
          console.warn(`      ⚠ 跳过 ${m.from}: 目标文件名不同(改名需显式映射, 本脚本不做推断)`);
          continue;
        }
        await moveFile(token, m.token, targetFolder);
        console.log(`      ✅ ${m.from} → ${m.to}`);
        result.done++;
        await sleep(150);
      } catch (e) {
        console.error(`      ❌ ${m.from}: ${e.message}`);
        result.failed++;
      }
    }

    // ---- 执行: 孤儿归档 ----
    if (plan.orphans.length) {
      const recycle = await ensureFolder(token, t.token, '_回收站');
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const bucket = await ensureFolder(token, recycle, day);
      for (const o of plan.orphans) {
        try {
          await moveFile(token, o.token, bucket);
          console.log(`      📦 归档 ${o.rel}`);
          result.done++;
          await sleep(150);
        } catch (e) {
          console.error(`      ❌ 归档失败 ${o.rel}: ${e.message}`);
          result.failed++;
        }
      }
    }
  }

  // ---- 回收站清理(显式 --purge 才做) ----
  if (APPLY && PURGE) {
    console.log('\n=== 清理回收站(不可恢复) ===');
    for (const t of targets) {
      const recycle = (await listFolder(token, t.token)).find(f => f.type === 'folder' && f.name === '_回收站');
      if (!recycle) continue;
      const buckets = (await listFolder(token, recycle.token)).filter(f => f.type === 'folder');
      for (const b of buckets) {
        const kids = await listFolder(token, b.token);
        for (const f of kids) {
          if (f.type !== 'file') continue;
          try { await deleteFile(token, f.token); console.log(`      🗑  ${t.name}/_回收站/${b.name}/${f.name}`); result.done++; }
          catch (e) { console.error(`      ❌ 删除失败 ${f.name}: ${e.message}`); result.failed++; }
          await sleep(150);
        }
      }
    }
  }

  console.log(`\n[gc] 汇总: 移动/归档 ${result.moves.length + result.orphans.length} | 缺失 ${result.missing.length} | 歧义 ${result.ambiguous.length} | 已执行 ${result.done} | 失败 ${result.failed}`);
  if (!APPLY) console.log('[gc] 这是预览。确认无误后加 --apply 执行。');

  if (REPORT) {
    fs.writeFileSync(REPORT, JSON.stringify(result, null, 1));
    console.log('[gc] 报告已写入 ' + REPORT);
  }
  if (result.failed) process.exit(1);
}

if (require.main === module) main().catch(e => { console.error('[gc] 失败: ' + e.message); process.exit(1); });
module.exports = { planActions };
