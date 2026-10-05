#!/usr/bin/env node
/**
 * 飞书 → 仓库 vehicle_images/ 照片自动回流(+ Release media-photos 异地归档)
 *
 * 为什么存在(事故背景):
 *   照片读取链路与视频**不对称**: 视频有 sync_videos_to_release.js + cron 自动
 *   回流到 Release 直链; 照片**没有任何回流自动化**。于是车型从 82 涨到 100 时,
 *   vehicle_images/ 停在 188 个文件不动, 新增车型的照片只留在飞书云盘里。
 *   结果: 网页端(静态 Pages, 飞书被 CORS 挡)与 App 端(去飞书取, 目录 token 已失效)
 *   **同时**看不到照片 —— 光修 token 也救不回网页端。
 *   本脚本补上缺失的那一半: 飞书 vehicle_images/ → 仓库 vehicle_images/。
 *
 * 五阶段:
 *   ① 定位飞书 APP数据备份/vehicle_images/ (回退: 根目录 vehicle_images)
 *   ② 列出全部图片(.jpeg/.jpg/.png/.webp/.gif)
 *   ③ 检测待回流: **只取被 vehicles_data.js 的 photoPaths 引用、云盘有、本地无**的文件
 *      —— 飞书该目录是 App 端通用上传落点, 混有私人废片与内容重复件(实测 201 张
 *      里 6 组重复); 不按引用过滤会让 cron 把私人照片提交进公开仓库。
 *   ④ 下载 → SHA-256 → 写入 vehicle_images/<原名>
 *   ⑤ 归档: 上传到 GitHub Release media-photos tag; 写 docs/photo_sync_report.json
 *      (含 feishuToken + sha256, 即"索引清单", 供后续迁对象存储/对账复用)
 *
 * 用法:
 *   node scripts/sync_photos_to_repo.js              # 同步(幂等, 无新照片零副作用)
 *   node scripts/sync_photos_to_repo.js --dry-run    # 只报告不下载不写盘
 *   node scripts/sync_photos_to_repo.js --no-release # 只回仓库, 不传 Release
 *   node scripts/sync_photos_to_repo.js --limit 20   # 单次最多处理 N 张(控 QPS/时长)
 *   node scripts/sync_photos_to_repo.js --all        # ⚠️ 关闭引用过滤(人工排查用, 严禁进 cron)
 *
 * 凭据(零硬编码, 全走 env/secrets):
 *   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN
 *   GH_TOKEN 或 GITHUB_TOKEN(可选; 缺省则跳过 Release 归档, 不失败)
 *
 * ⚠️ 飞书云盘 QPS 上限 5/s、10000/日; 本脚本**串行**下载, 不做并发。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FEISHU_HOST = 'https://open.feishu.cn';
const MEDIA_TAG = 'media-photos';
const LOCAL_DIR = path.join(ROOT, 'vehicle_images');
const REPORT_PATH = path.join(ROOT, 'docs', 'photo_sync_report.json');
const IMG_EXT = /\.(jpeg|jpg|png|webp|gif)$/i;
/** 单文件体积下限: 飞书下载失败常返回极小 JSON/空体, 低于此值视为异常不落盘 */
const MIN_BYTES = 512;

/* ===================== 纯函数(可测, 不触网) ===================== */

/** 从飞书文件列表中筛出图片条目 */
function filterImageFiles(files) {
  return (files || []).filter(f => f && f.type === 'file' && IMG_EXT.test(f.name || ''));
}

/** 检测"云盘有、本地无"的图片名(仅按名字比对, 不做引用过滤; 供 --all 兜底模式使用) */
function detectMissingPhotos(feishuNames, localNames) {
  const local = new Set(localNames || []);
  const seen = new Set();
  const missing = [];
  for (const n of feishuNames || []) {
    if (local.has(n) || seen.has(n)) continue;   // 已存在 / 飞书侧重名去重
    seen.add(n);
    missing.push(n);
  }
  return missing;
}

/**
 * 【默认·唯一安全模式】只回流"被车型引用 + 云盘确实有 + 本地没有"的照片。
 *
 * 为什么必须按引用过滤(2026-10-06 实战教训):
 *   飞书 vehicle_images/ 是 App 端的**通用上传落点**, 里面混着与车型无关的私人废片
 *   (运输拖车框架编号照、碎屏手机照、手机换屏订单截图、晚霞风景照…), 还有大量
 *   同一内容重复转存(实测 201 张里 6 组重复)。若按"云盘有仓库无"无脑回流, cron 会
 *   把这些私人照片自动提交到**公开的 GitHub Pages 仓库**, 造成隐私泄露。
 *   而 vehicles_data.js 的 photoPaths 是"哪些照片属于哪个车型"的唯一权威表达,
 *   不在其中的文件对产品毫无价值 —— 因此以它为准。
 */
function selectReferencedMissingPhotos(referencedNames, cloudNames, localNames) {
  const cloud = new Set(cloudNames || []);
  const local = new Set(localNames || []);
  const out = [];
  for (const n of referencedNames || []) {
    if (cloud.has(n) && !local.has(n)) out.push(n);   // 云盘没有的连试都不用试(省 QPS)
  }
  return Array.from(new Set(out));
}

/** 从 vehicles_data.js 提取全部车型引用的照片文件名(权威清单) */
function loadReferencedPhotoNames(src) {
  const m = String(src || '').match(/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/);
  if (!m) return null;
  const s = String(src).indexOf('[', m.index);
  const e = String(src).lastIndexOf(']');
  if (s < 0 || e <= s) return null;
  let arr;
  try { arr = new Function('return (' + String(src).slice(s, e + 1) + ')')(); } catch (err) { return null; }
  if (!Array.isArray(arr)) return null;
  const set = new Set();
  for (const v of arr) {
    for (const p of (v && v.photoPaths) || []) {
      const n = String(p).split('/').pop();
      if (n && IMG_EXT.test(n)) set.add(n);
    }
  }
  return set;
}

/** 计算缓冲区 SHA-256(索引清单用, 后续迁对象存储可做内容寻址去重) */
function sha256Of(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/** 合并旧报告与新条目(按 name 去重, 保留历史字段) */
function mergeReport(prev, entries) {
  const base = (prev && Array.isArray(prev.photos)) ? prev.photos : [];
  const byName = new Map();
  for (const p of base) if (p && p.name) byName.set(p.name, p);
  for (const e of entries) byName.set(e.name, Object.assign({}, byName.get(e.name) || {}, e));
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    source: 'feishu:APP数据备份/vehicle_images',
    count: byName.size,
    photos: Array.from(byName.values()).sort((a, b) => String(a.name).localeCompare(String(b.name))),
  };
}

/* ===================== 飞书 API ===================== */

async function _req(method, url, headers, body) {
  const res = await fetch(url, {
    method,
    headers: Object.assign({}, headers),
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  if (!res.ok) throw new Error(`飞书请求失败 HTTP ${res.status}: ${url}`);
  return res.json();
}

async function feishuToken(appId, appSecret) {
  const j = await _req('POST', `${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`,
    { 'Content-Type': 'application/json' }, { app_id: appId, app_secret: appSecret });
  if (j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + JSON.stringify(j));
  return j.tenant_access_token;
}

async function feishuListFiles(token, folderToken) {
  const out = [];
  let pageToken = '';
  do {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${encodeURIComponent(folderToken)}&page_size=50${pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''}`;
    const j = await _req('GET', url, { Authorization: 'Bearer ' + token });
    if (j.code !== 0) throw new Error('列出云盘文件失败: ' + JSON.stringify(j));
    (j.data.files || []).forEach(f => out.push(f));
    pageToken = j.data.next_page_token || '';
  } while (pageToken);
  return out;
}

async function feishuFindFolder(token, parentToken, name) {
  const files = await feishuListFiles(token, parentToken);
  return (files.find(f => f.type === 'folder' && f.name === name) || null);
}

/** 下载飞书文件到内存: 下载接口对媒体直接返二进制, 仅 JSON 信封时二次抓取 */
async function feishuDownload(token, fileToken) {
  const res = await fetch(`${FEISHU_HOST}/open-apis/drive/v1/files/${fileToken}/download`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (!res.ok) throw new Error('下载飞书文件失败 HTTP ' + res.status);
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('json')) {
    const meta = await res.json();
    if (!(meta && meta.data && meta.data.url)) {
      throw new Error('飞书下载返回未知 JSON: ' + JSON.stringify(meta).slice(0, 120));
    }
    const res2 = await fetch(meta.data.url);
    if (!res2.ok) throw new Error('下载飞书文件失败 HTTP ' + res2.status);
    return Buffer.from(await res2.arrayBuffer());
  }
  return Buffer.from(await res.arrayBuffer());
}

/** 确保 media-photos Release 存在(不存在则建一个空 tag) */
function ensureRelease(ghToken) {
  const env = Object.assign({}, process.env, { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken });
  try {
    execFileSync('gh', ['release', 'view', MEDIA_TAG], { cwd: ROOT, stdio: 'pipe', env });
    return true;
  } catch (e) {
    try {
      execFileSync('gh', ['release', 'create', MEDIA_TAG, '--title', '车辆照片归档',
        '--notes', '由 scripts/sync_photos_to_repo.js 自动维护的车辆照片异地归档(仓库 vehicle_images/ 的副本)。'],
        { cwd: ROOT, stdio: 'pipe', env });
      return true;
    } catch (e2) {
      console.warn(`[sync-photos] 无法创建/访问 Release ${MEDIA_TAG}, 跳过归档: ${e2.message}`);
      return false;
    }
  }
}

/* ===================== 主流程 ===================== */

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const noRelease = process.argv.includes('--no-release');
  const allMode = process.argv.includes('--all');
  const limitArg = process.argv.indexOf('--limit');
  const limit = limitArg >= 0 ? parseInt(process.argv[limitArg + 1], 10) : 0;

  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const folderToken = process.env.FEISHU_FOLDER_TOKEN || '';
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  if (!appId || !appSecret) { console.error('[错误] 缺少 FEISHU_APP_ID / FEISHU_APP_SECRET'); process.exit(1); }
  if (!folderToken) { console.error('[错误] 缺少 FEISHU_FOLDER_TOKEN'); process.exit(1); }

  // ② 本地现有文件(缺失判定的基准)
  if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
  const localNames = fs.readdirSync(LOCAL_DIR).filter(f => IMG_EXT.test(f));
  console.log(`[sync-photos] 本地 vehicle_images/ 现有 ${localNames.length} 个图片`);

  // ① 定位飞书 vehicle_images
  const token = await feishuToken(appId, appSecret);
  let photosFolder = null;
  const dataFolder = await feishuFindFolder(token, folderToken, 'APP数据备份');
  if (dataFolder) photosFolder = await feishuFindFolder(token, dataFolder.token, 'vehicle_images');
  if (!photosFolder) photosFolder = await feishuFindFolder(token, folderToken, 'vehicle_images');
  if (!photosFolder) {
    console.log('[sync-photos] 未找到飞书 vehicle_images 文件夹(已试 APP数据备份/ 下与根下), 跳过');
    return;
  }
  const files = filterImageFiles(await feishuListFiles(token, photosFolder.token));
  console.log(`[sync-photos] 飞书 vehicle_images/ 共 ${files.length} 个图片`);

  // ③ 检测待回流: 默认**只回流被车型引用的**(防私人废片被 cron 提交到公开仓库)
  const cloudNames = files.map(f => f.name);
  let missing;
  if (allMode) {
    console.warn('[sync-photos] ⚠️ --all: 已关闭"仅被引用"过滤, 会把云盘里所有本地没有的图片(含私人废片/重复件)拉进公开仓库。');
    console.warn('[sync-photos] ⚠️ 该模式仅供人工排查使用, 严禁接进 cron。');
    missing = detectMissingPhotos(cloudNames, localNames);
  } else {
    const refPath = path.join(ROOT, 'vehicles_data.js');
    if (!fs.existsSync(refPath)) {
      console.error('[sync-photos] 找不到 vehicles_data.js, 无法确定"哪些照片被车型引用"; 拒绝在无白名单情况下回流。');
      console.error('[sync-photos] 如确需全量拉取(不建议), 显式加 --all。');
      process.exit(1);
    }
    const referenced = loadReferencedPhotoNames(fs.readFileSync(refPath, 'utf8'));
    if (!referenced) {
      console.error('[sync-photos] 无法从 vehicles_data.js 解析 photoPaths; 拒绝在无白名单情况下回流。');
      process.exit(1);
    }
    missing = selectReferencedMissingPhotos([...referenced], cloudNames, localNames);
    const cloudOnly = detectMissingPhotos(cloudNames, localNames).length;
    console.log(`[sync-photos] 车型引用照片 ${referenced.size} 个 / 其中云盘有且本地缺 ${missing.length} 个`);
    if (cloudOnly > missing.length) {
      console.log(`[sync-photos] 另跳过 ${cloudOnly - missing.length} 个"云盘有但无任何车型引用"的文件(私人废片/重复件, 不进公开仓库)。`);
    }
  }
  if (limit > 0 && missing.length > limit) {
    console.log(`[sync-photos] --limit ${limit}: 仅处理前 ${limit} 张(剩余下次 cron 继续)`);
    missing = missing.slice(0, limit);
  }
  if (!missing.length) { console.log('[sync-photos] 无缺失照片, 零副作用结束'); return; }
  console.log(`[sync-photos] 检出 ${missing.length} 张待回流:`);
  missing.forEach(n => console.log('  - ' + n));
  if (dryRun) { console.log('[sync-photos] --dry-run: 不下载不写盘不上传'); return; }

  // ⑤-Release 预检(凭据缺失不阻塞仓库回流)
  let releaseOk = false;
  if (!noRelease) {
    if (!ghToken) console.warn('[sync-photos] 无 GH_TOKEN, 跳过 Release 归档(仓库回流照常)');
    else releaseOk = ensureRelease(ghToken);
  }

  // ④ 下载写盘 + ⑤ 归档/报告
  const entries = [];
  let written = 0, archived = 0, failed = 0;
  for (const name of missing) {
    const entry = files.find(f => f.name === name);
    if (!entry) { console.warn(`[sync-photos] 飞书未找到条目, 跳过: ${name}`); failed++; continue; }
    try {
      const buf = await feishuDownload(token, entry.token);
      if (buf.length < MIN_BYTES) { console.warn(`[sync-photos] 体积异常(${buf.length}B), 跳过: ${name}`); failed++; continue; }
      if (!dryRun) fs.writeFileSync(path.join(LOCAL_DIR, name), buf);
      written++;
      const rec = {
        name,
        bytes: buf.length,
        sha256: sha256Of(buf),
        feishuToken: entry.token,
        syncedAt: new Date().toISOString(),
      };
      if (releaseOk) {
        try {
          execFileSync('gh', ['release', 'upload', MEDIA_TAG, path.join(LOCAL_DIR, name), '--clobber'], {
            cwd: ROOT, stdio: 'pipe',
            env: Object.assign({}, process.env, { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken }),
          });
          rec.releaseAsset = name;
          archived++;
        } catch (e) {
          console.warn(`[sync-photos] Release 归档失败(不影响仓库回流): ${name} — ${e.message}`);
        }
      }
      entries.push(rec);
      console.log(`[sync-photos] 已回流: ${name} (${buf.length}B, sha256=${rec.sha256.slice(0, 10)})`);
    } catch (e) {
      failed++;
      console.warn(`[sync-photos] 下载失败, 跳过: ${name} — ${e.message}`);
    }
  }

  // 索引清单(供对账/后续迁对象存储)
  if (entries.length && !dryRun) {
    const prev = (() => { try { return JSON.parse(fs.readFileSync(REPORT_PATH, 'utf8')); } catch (e) { return null; } })();
    fs.writeFileSync(REPORT_PATH, JSON.stringify(mergeReport(prev, entries), null, 2) + '\n', 'utf8');
    console.log(`[sync-photos] 索引清单已更新: docs/photo_sync_report.json (累计 ${mergeReport(prev, entries).count} 条)`);
  }

  console.log(`[sync-photos] 完成: 回流 ${written} 张 / 归档 ${archived} 张 / 失败 ${failed} 张`);
  if (written > 0) {
    console.log('[sync-photos] 提示: 提交 vehicle_images/ 与 docs/photo_sync_report.json 后网页端即可显示');
  }
  if (failed > 0) process.exitCode = 0;   // 部分失败不算失败: 已回流的要能提交
}

if (require.main === module) {
  main().catch(e => { console.error('[sync-photos] 失败:', e && e.message); process.exit(1); });
}

module.exports = {
  filterImageFiles, detectMissingPhotos, sha256Of, mergeReport, IMG_EXT, MIN_BYTES, MEDIA_TAG,
  // 默认安全路径(按车型引用过滤) —— 新增, 供测试与后续复用
  selectReferencedMissingPhotos, loadReferencedPhotoNames,
};
