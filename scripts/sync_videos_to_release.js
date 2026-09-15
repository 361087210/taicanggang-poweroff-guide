#!/usr/bin/env node
/**
 * 飞书 → GitHub Release 视频自动同步(P1 收尾: 解决组长新上传视频网页端无直链)
 *
 * 为什么存在: 组长在 App 端上传视频 → 存飞书 vehicle_videos/ → 但不会同步到
 * GitHub Release 的 media-videos tag → 网页端(无飞书 Secret)拿不到直链不可播。
 * 典型: 长安深蓝(G318)_v2.mp4(audit_media_consistency.js C2 告警追踪中)。
 *
 * 五阶段:
 *   ① 定位飞书 APP数据备份/vehicle_videos/, 列出全部视频(.mp4/.mov/.webm/.m4v/.avi/.mkv)
 *   ② 解析 js/00-bootstrap.js 的 MEDIA_DIRECT_ASSETS 键集合
 *   ③ 检测缺失: 飞书文件名按 _flattenForAssetKey 扁平化(保留 _v<N>)后比对,
 *      归一化仍无映射 → 缺直链(新 _v2 片即新增独立条目, 旧片不动)
 *   ④ 下载→上传: /files/{token}/download 流式下载 → SHA-256 前10位 → 资产名
 *      tcgv_<sha10>.mp4(内容相同加 _2 去重) → gh release upload media-videos
 *   ⑤ 补映射: MEDIA_DIRECT_ASSETS 末尾插 '<扁平化文件名>':'tcgv_<sha10>.mp4', 幂等
 *
 * 用法:
 *   node scripts/sync_videos_to_release.js            # 同步(幂等, 无新视频零副作用)
 *   node scripts/sync_videos_to_release.js --dry-run  # 只报告不写
 *
 * 凭据(零硬编码, 全走 env/secrets):
 *   FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_FOLDER_TOKEN
 *   GH_TOKEN 或 GITHUB_TOKEN(GitHub Release 上传, 优先 GH_TOKEN)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FEISHU_HOST = 'https://open.feishu.cn';
const MEDIA_TAG = 'media-videos';
const VIDEO_EXT = /\.(mp4|mov|webm|m4v|avi|mkv)$/i;

/* ===================== 纯函数(可测) ===================== */

/** 文件名 → 下划线扁平化(保留 _v<N> 与扩展名, 不转小写; 对齐 MEDIA_DIRECT_ASSETS 键约定) */
function _flattenForAssetKey(name){
  return String(name == null ? '' : name)
    .replace(/[（(【［｛{]/g, '_')
    .replace(/[）)】］｝}]/g, '_')
    // 注意: 不含 `.`, 以保留扩展名 `.mp4`(与 _normMediaKey 先剥扩展名再拍平 `.` 不同)
    .replace(/[\s\-\/\\·,、]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** 解析 js/00-bootstrap.js 的 MEDIA_DIRECT_ASSETS → {扁平化键: 资产名} */
function parseMediaDirectAssets(src){
  const out = {};
  const m = String(src || '').match(/const MEDIA_DIRECT_ASSETS=\{([\s\S]*?)\n\};/);
  if(!m) return out;
  for(const mm of m[1].matchAll(/'([^']+)'\s*:\s*'([^']+)'/g)) out[mm[1]] = mm[2];
  return out;
}

/** 检测缺直链视频: 飞书文件名(原始名 与 扁平化名)都不在映射键集合 → 缺失。
 *  关键: 映射 key 用**原始文件名**(App 端 mediaDirectUrl 是精确匹配原始名,
 *  扁平化键不会被命中); _flattenForAssetKey 仅用于「旧片已扁平化覆盖」的判定。 */
function detectMissingVideos(feishuFileNames, assetMap){
  const missing = [];
  for(const n of feishuFileNames){
    const flat = _flattenForAssetKey(n);
    const covered = assetMap && (
      Object.prototype.hasOwnProperty.call(assetMap, n) ||
      Object.prototype.hasOwnProperty.call(assetMap, flat)
    );
    if(!covered) missing.push({ file: n, key: n });
  }
  return missing;
}

/** 资产名生成: tcgv_<sha10>.mp4, 与现有资产名冲突则加 _2/_3... 去重 */
function assetNameFor(sha10, existingNames){
  const set = new Set(existingNames || []);
  let name = `tcgv_${sha10}.mp4`;
  let i = 2;
  while(set.has(name)){
    name = `tcgv_${sha10}_${i}.mp4`;
    i++;
  }
  return name;
}

/** 生成 MEDIA_DIRECT_ASSETS 映射行(带尾逗号, 便于插在最后一项后) */
function buildMappingLine(key, assetName){
  return `'${key}':'${assetName}',`;
}

/* ===================== 飞书 API ===================== */

async function _req(method, url, headers, body){
  const res = await fetch(url, {
    method,
    headers: Object.assign({}, headers),
    body: body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body)),
  });
  if(!res.ok) throw new Error(`飞书请求失败 HTTP ${res.status}: ${url}`);
  return res.json();
}

async function feishuToken(appId, appSecret){
  const j = await _req('POST', `${FEISHU_HOST}/open-apis/auth/v3/tenant_access_token/internal`,
    { 'Content-Type': 'application/json' }, { app_id: appId, app_secret: appSecret });
  if(j.code !== 0) throw new Error('获取 tenant_access_token 失败: ' + JSON.stringify(j));
  return j.tenant_access_token;
}

async function feishuListFiles(token, folderToken){
  const out = [];
  let pageToken = '';
  do {
    const url = `${FEISHU_HOST}/open-apis/drive/v1/files?folder_token=${encodeURIComponent(folderToken)}&page_size=50${pageToken ? '&page_token=' + encodeURIComponent(pageToken) : ''}`;
    const j = await _req('GET', url, { Authorization: 'Bearer ' + token });
    if(j.code !== 0) throw new Error('列出云盘文件失败: ' + JSON.stringify(j));
    (j.data.files || []).forEach(f => out.push(f));
    pageToken = j.data.next_page_token || '';
  } while(pageToken);
  return out;
}

async function feishuFindFolder(token, parentToken, name){
  const files = await feishuListFiles(token, parentToken);
  return (files.find(f => f.type === 'folder' && f.name === name) || null);
}

async function feishuDownloadTo(token, fileToken, destPath){
  const meta = await _req('GET', `${FEISHU_HOST}/open-apis/drive/v1/files/${fileToken}/download`, { Authorization: 'Bearer ' + token });
  // 飞书下载返回 {code,data:{url}} 信封 → 抓真实文件; 部分环境直接返回字节
  if(meta && meta.data && meta.data.url){
    const res = await fetch(meta.data.url);
    if(!res.ok) throw new Error('下载飞书文件失败 HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(destPath, buf);
    return buf.length;
  }
  const buf = Buffer.from(JSON.stringify(meta));
  fs.writeFileSync(destPath, buf);
  return buf.length;
}

/* ===================== 主流程 ===================== */

async function main(){
  const dryRun = process.argv.includes('--dry-run');
  const appId = process.env.FEISHU_APP_ID || '';
  const appSecret = process.env.FEISHU_APP_SECRET || '';
  const folderToken = process.env.FEISHU_FOLDER_TOKEN || '';
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  if(!appId || !appSecret){ console.error('[错误] 缺少 FEISHU_APP_ID / FEISHU_APP_SECRET'); process.exit(1); }
  if(!folderToken){ console.error('[错误] 缺少 FEISHU_FOLDER_TOKEN'); process.exit(1); }

  // ② 解析现有映射
  const bootstrapPath = path.join(ROOT, 'js', '00-bootstrap.js');
  const assetMap = parseMediaDirectAssets(fs.readFileSync(bootstrapPath, 'utf8'));
  const assetKeys = Object.keys(assetMap);
  console.log(`[sync-videos] 现有直链映射 ${assetKeys.length} 条`);

  // ① 定位 vehicle_videos 并列出视频
  const token = await feishuToken(appId, appSecret);
  const dataFolder = await feishuFindFolder(token, folderToken, 'APP数据备份');
  if(!dataFolder){ console.log('[sync-videos] 未找到 APP数据备份 文件夹, 跳过'); return; }
  const videosFolder = await feishuFindFolder(token, dataFolder.token, 'vehicle_videos');
  if(!videosFolder){ console.log('[sync-videos] 未找到 vehicle_videos 文件夹, 跳过'); return; }
  const files = await feishuListFiles(token, videosFolder.token);
  const videoFiles = files.filter(f => f.type === 'file' && VIDEO_EXT.test(f.name));
  console.log(`[sync-videos] 飞书 vehicle_videos 共 ${videoFiles.length} 个视频`);

  // ③ 检测缺失
  const missing = detectMissingVideos(videoFiles.map(f => f.name), assetMap);
  if(!missing.length){ console.log('[sync-videos] 无缺直链视频, 零副作用结束'); return; }
  console.log(`[sync-videos] 检出 ${missing.length} 个缺直链视频:`);
  missing.forEach(m => console.log(`  - ${m.file} (key=${m.key})`));

  if(dryRun){ console.log('[sync-videos] --dry-run: 不下载不上传不写映射'); return; }
  if(!ghToken){ console.error('[错误] 缺少 GH_TOKEN / GITHUB_TOKEN(Release 上传凭据)'); process.exit(1); }

  // ④ 下载→上传 + ⑤ 补映射
  const existingNames = Object.values(assetMap);
  const newLines = [];
  for(const m of missing){
    const fileEntry = videoFiles.find(f => f.name === m.file);
    if(!fileEntry){ console.warn(`[sync-videos] 飞书未找到文件条目, 跳过: ${m.file}`); continue; }
    const tmp = path.join(ROOT, '.tmp_' + Date.now() + '_' + m.file.replace(/[\\/:*?"<>|]/g, '_'));
    try{
      const size = await feishuDownloadTo(token, fileEntry.token, tmp);
      if(size <= 100){ console.warn(`[sync-videos] 下载体积异常(${size}B), 跳过: ${m.file}`); continue; }
      const sha = crypto.createHash('sha256').update(fs.readFileSync(tmp)).digest('hex');
      const sha10 = sha.slice(0, 10);
      const assetName = assetNameFor(sha10, existingNames.concat(newLines.map(l => l.assetName)));
      if(!dryRun){
        // gh release upload: GITHUB_TOKEN/GH_TOKEN 走 env
        execFileSync('gh', ['release', 'upload', MEDIA_TAG, tmp, '--clobber'], {
          cwd: ROOT,
          stdio: 'pipe',
          env: Object.assign({}, process.env, { GH_TOKEN: ghToken, GITHUB_TOKEN: ghToken }),
        });
      }
      newLines.push({ line: buildMappingLine(m.key, assetName), assetName, key: m.key });
      existingNames.push(assetName);
      console.log(`[sync-videos] 已上传: ${m.file} → ${assetName} (sha10=${sha10}, ${size}B)`);
    } finally {
      try{ fs.unlinkSync(tmp); }catch(e){ /* 临时文件清理失败无妨 */ }
    }
  }

  if(newLines.length){
    const src = fs.readFileSync(bootstrapPath, 'utf8');
    // 在 MEDIA_DIRECT_ASSETS 最后一个值后插入新行(定位到 `};` 前的最后一项)
    const insertAt = src.lastIndexOf('\n};');
    if(insertAt < 0) throw new Error('无法定位 MEDIA_DIRECT_ASSETS 结束位置');
    const insertion = '\n  ' + newLines.map(n => n.line).join('\n  ');
    const next = src.slice(0, insertAt) + insertion + src.slice(insertAt);
    fs.writeFileSync(bootstrapPath, next, 'utf8');
    console.log(`[sync-videos] 已补 ${newLines.length} 条映射 → js/00-bootstrap.js`);
    console.log('[sync-videos] 提示: 请运行 node scripts/gen_media_mapping.js 重新生成 manifest 并提交');
  }
}

if(require.main === module){
  main().catch(e => { console.error('[sync-videos] 失败:', e && e.message); process.exit(1); });
}

module.exports = { _flattenForAssetKey, parseMediaDirectAssets, detectMissingVideos, assetNameFor, buildMappingLine };
