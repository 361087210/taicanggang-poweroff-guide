/* ===========================================================
 * 模块: 13-media-library.js — 资源库(车型照片/视频台账 + 云端管理) V10.26.0
 * ===========================================================
 * 解决什么: 照片/视频散在 vehicle_images/<车型目录>/、_共享/、_未归类/ 与
 *   GitHub Release 四处, 组长只能靠"翻车型详情"或跑脚本才知道缺什么。
 *   本模块把 media_library.json(由 scripts/gen_media_library.js 生成)渲染成
 *   一页可搜索/可筛选/可预览/可导出缺失清单的台账, 且**离线可用**(索引随仓库发布)。
 *
 * 数据契约(media_library.json, 仓库根/与 Pages 同路径):
 *   { stats:{...}, assets:[{path,kind,kindLabel,status,sizeText,vehicleText,missingFor?}],
 *     orphans:[{path,status:'orphan',...}] }
 *   status: ok 正常 / shared 共享 / unfiled 未归类引用 / remote 云端视频 / missing 缺失 / orphan 孤儿
 *
 * 依赖: 台账只读 fetch 本地 JSON; 云端实测/上传/删除按需调用 FeishuAPI / feishuListFiles /
 *   httpUploadFileSmart(缺失时优雅降级, 离线仍可只读浏览台账)。
 * 页面: #screen-media-library (demo.html 内为空容器, 由本模块渲染)
 * =========================================================== */
(function(){
'use strict';

const INDEX_URL = 'media_library.json';
const PAGE_SIZE = 50;            // 每页条数(分页渲染, 控制 DOM 规模; 旧版是一次性 400 条)
const STATUS_META = {
  missing: { label: '缺失', cls: 'bg-red-50 text-red-600' },
  shared:  { label: '共享', cls: 'bg-amber-50 text-amber-700' },
  unfiled: { label: '未归类', cls: 'bg-violet-50 text-violet-700' },
  remote:  { label: '云端', cls: 'bg-blue-50 text-blue-600' },
  ok:      { label: '正常', cls: 'bg-green-50 text-green-700' },
  'new':   { label: '新增', cls: 'bg-sky-50 text-sky-700' },
  orphan:  { label: '孤儿', cls: 'bg-gray-100 text-gray-600' },
  /* V10.26.5: 车型 ↔ 资源 对不上的三类（统一进"断链"筛选） */
  unowned: { label: '无主目录', cls: 'bg-orange-50 text-orange-700' },
  renamed: { label: '改名失配', cls: 'bg-rose-50 text-rose-700' },
  nomedia: { label: '无素材', cls: 'bg-slate-100 text-slate-600' }
};
const FILTERS = [
  { id: 'all',     label: '全部' },
  { id: 'missing', label: '缺失' },
  { id: 'shared',  label: '共享' },
  { id: 'new',     label: '新增' },
  { id: 'remote',  label: '云端视频' },
  { id: 'orphan',  label: '未归类/孤儿' },
  { id: 'photo',   label: '照片' },
  { id: 'video',   label: '视频' },
  { id: 'lowres',  label: '低清' },
  /* V10.26.5: 车型信息与资源对不上（删车/改名/新增无素材） */
  { id: 'broken',  label: '断链' }
];

let _data = null;         // 最近一次加载的索引
let _loading = false;
let _error = '';
let _filter = 'all';
let _query = '';
let _page = 0;            // 当前页(0 基), 筛选/搜索时归零
let _current = null;      // 预览中的资产
let _focusPath = '';      // 详情页 → 资源库: 待定位高亮的资产路径
let _vehicleFocus = null; // 资源库「只看这台车」 {id, display}
let _indexPromise = null; // 索引加载中的 Promise(台账页与详情页装饰共用, 避免重复拉取)

/* ---------------- 纯函数(供测试直接引用) ---------------- */

function humanSize(n){
  if(!Number.isFinite(n) || n <= 0) return '';
  const u = ['B','KB','MB','GB'];
  let i = 0, v = n;
  while(v >= 1024 && i < u.length - 1){ v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + u[i];
}

/**
 * 资产筛选(纯函数)。
 * @param {Array} assets
 * @param {string} filter  all|missing|shared|remote|orphan|photo|video
 * @param {string} query   关键字(匹配车型显示名 / 文件名 / 路径)
 * @returns {Array}
 */
function filterAssets(assets, filter, query){
  const list = Array.isArray(assets) ? assets : [];
  const q = String(query || '').trim().toLowerCase();
  return list.filter(function(a){
    if(!a) return false;
    if(filter === 'photo' && a.kind !== 'photo') return false;
    if(filter === 'video' && a.kind !== 'video') return false;
    if(filter === 'missing' && a.status !== 'missing') return false;
    if(filter === 'shared' && a.status !== 'shared') return false;
    if(filter === 'new' && a.status !== 'new') return false;
    if(filter === 'remote' && a.status !== 'remote') return false;
    if(filter === 'orphan' && a.status !== 'orphan') return false;
    if(filter === 'lowres' && !a.lowRes) return false;   // V10.26.6: 分辨率不达标(照片宽<900)
    if(!q) return true;
    const hay = [a.vehicleText, a.path, a.kindLabel].join(' ').toLowerCase();
    return hay.indexOf(q) >= 0;
  });
}

/** 统计(纯函数): 由 assets+orphans 现算, 不信任文件里的 stats(防索引与展示不一致) */
function statsOf(assets, orphans){
  const list = (Array.isArray(assets) ? assets : []).concat(Array.isArray(orphans) ? orphans : []);
  const by = {};
  list.forEach(function(a){ by[a.status] = (by[a.status] || 0) + 1; });
  return {
    total: list.length,
    photos: list.filter(function(a){ return a.kind === 'photo'; }).length,
    videos: list.filter(function(a){ return a.kind === 'video'; }).length,
    ok: by.ok || 0,
    shared: by.shared || 0,
    'new': by['new'] || 0,
    unfiled: by.unfiled || 0,
    remote: by.remote || 0,
    missing: by.missing || 0,
    orphan: by.orphan || 0
  };
}

/**
 * 车型当前引用 → 实时资产(纯函数)。
 * 资源库索引是发版快照: 车型侧新增/换图后索引不会自己重算, 台账就会与车型信息脱节。
 * 这里用当前车型数据现算一份"实时引用", 由 mergeAssets 与静态索引合并,
 * 保证"车型改了 → 资源库立刻能看到", 不必等下次发版重建索引。
 * @param {Array} vehicles 车型数组(读 photoPaths/videoPaths)
 * @returns {Array} [{path,kind,kindLabel,status:'new',vehicles,vehicleText}]
 */
function liveAssetsOf(vehicles){
  const list = Array.isArray(vehicles) ? vehicles : [];
  const byPath = {};
  const out = [];
  list.forEach(function(v){
    if(!v) return;
    ['photoPaths', 'videoPaths'].forEach(function(k){
      const isVideo = k === 'videoPaths';
      (v[k] || []).forEach(function(p){
        if(typeof p !== 'string' || !/^vehicle_(images|videos)\//.test(p)) return;
        if(!byPath[p]){
          byPath[p] = {
            path: p,
            kind: isVideo ? 'video' : 'photo',
            kindLabel: isVideo ? '视频' : '照片',
            status: 'new',
            vehicles: [],
            vehicleText: ''
          };
          out.push(byPath[p]);
        }
        if(!byPath[p].vehicles.some(function(x){ return x.id === v.id; })){
          byPath[p].vehicles.push({ id: v.id, display: v.display });
        }
      });
    });
  });
  out.forEach(function(a){
    a.vehicleText = a.vehicles.map(function(x){ return x.display; }).join('、');
  });
  return out;
}

/**
 * 静态索引 + 实时引用合并(纯函数)。
 *   - 静态行优先(带体积/校验状态), 实时只补索引里没有的路径(标"新增")
 *   - 引用型静态行(正常/共享/缺失)若其所有引用车型都已不再引用该路径 → 丢弃,
 *     避免车型侧删图/换目录后, 资源库还挂着幽灵行
 *   - 按 path 去重, 不产生重复行
 * @param {Array} staticList 索引里的 assets/orphans
 * @param {Array} liveList   liveAssetsOf() 的产物
 */
function mergeAssets(staticList, liveList){
  const live = Array.isArray(liveList) ? liveList : [];
  const liveRef = {};
  live.forEach(function(a){
    (a.vehicles || []).forEach(function(v){
      if(v && v.id != null) liveRef[a.path + '#' + v.id] = true;
    });
  });
  const seen = {};
  const out = [];
  (Array.isArray(staticList) ? staticList : []).forEach(function(a){
    if(!a || !a.path || seen[a.path]) return;
    const vs = a.vehicles || [];
    const refDriven = a.status === 'ok' || a.status === 'shared' || a.status === 'missing';
    if(refDriven && vs.length){
      const alive = vs.some(function(v){ return v && liveRef[a.path + '#' + v.id]; });
      if(!alive) return;
    }
    seen[a.path] = true;
    out.push(a);
  });
  live.forEach(function(a){
    if(!a || !a.path || seen[a.path]) return;
    seen[a.path] = true;
    out.push(a);
  });
  return out;
}

/**
 * 从单个车型解除某条媒体引用(纯函数, 原地修改)。
 * 路径与照片板块/标签(按下标一一对应)必须同步剔除, 否则后续照片会整体前移、
 * 顶替上一张的板块与标签(详情页显示错部位)。
 * @returns {boolean} 是否发生了变更
 */
function unlinkPathOf(v, path){
  if(!v || typeof path !== 'string') return false;
  let changed = false;
  ['photoPaths', 'videoPaths'].forEach(function(k){
    const arr = v[k];
    if(!Array.isArray(arr)) return;
    const isPhoto = k === 'photoPaths';
    const secs = (isPhoto && Array.isArray(v.photoSections)) ? v.photoSections : null;
    const labs = (isPhoto && Array.isArray(v.photoLabels)) ? v.photoLabels : null;
    const next = [], nextSecs = [], nextLabs = [];
    arr.forEach(function(p, i){
      if(p === path) return;
      next.push(p);
      if(secs) nextSecs.push(secs[i] || 'exterior');
      if(labs) nextLabs.push(labs[i] || '');
    });
    if(next.length !== arr.length){
      v[k] = next;
      if(secs) v.photoSections = nextSecs;
      if(labs) v.photoLabels = nextLabs;
      changed = true;
    }
  });
  return changed;
}

/**
 * 媒体引用变更后的车型补丁(纯函数): 路径、数量与照片元数据必须同时更新。
 * 资源库与车型详情是同一份数据的两种视图:
 *   - 只改 photoPaths 会让 export/其他端读到过期的 photos/videos 计数;
 *   - 不同步 photoSections/photoLabels 会让详情页照片板块与标签整体错位
 *     (数组按下标一一对应), 例如资源库删掉第 1 张后, 第 2 张会顶着第 1 张的标签。
 * 因此这里按 photoPaths 长度对齐元数据: 缺失补默认板块, 多余截断。
 */
function mediaPatchOf(v){
  const photos = (v && Array.isArray(v.photoPaths)) ? v.photoPaths.slice() : [];
  const videos = (v && Array.isArray(v.videoPaths)) ? v.videoPaths.slice() : [];
  const secIn = (v && Array.isArray(v.photoSections)) ? v.photoSections : [];
  const labIn = (v && Array.isArray(v.photoLabels)) ? v.photoLabels : [];
  const photoSections = photos.map(function(_, i){ return secIn[i] || 'exterior'; });
  const photoLabels = photos.map(function(_, i){ return labIn[i] || ''; });
  return {
    photoPaths: photos,
    videoPaths: videos,
    photos: photos.length,
    videos: videos.length,
    photoSections: photoSections,
    photoLabels: photoLabels
  };
}

/** 缺失清单文本(纯函数): 供"复制清单"发给补拍的人 */
function missingListText(assets){
  const rows = (Array.isArray(assets) ? assets : []).filter(function(a){ return a.status === 'missing'; });
  const lines = ['车型\t类型\t文件'];
  rows.forEach(function(a){
    const who = (a.missingFor && a.missingFor.length ? a.missingFor : a.vehicles || []).map(function(v){ return v.display; }).join('、');
    lines.push((who || '(未知车型)') + '\t' + (a.kindLabel || '') + '\t' + a.path.split('/').pop());
  });
  return lines.join('\n');
}

/* ============================================================
 * 媒体登记表(运行时单一真源, V10.28.2)
 * ------------------------------------------------------------
 * 旧行为: 资源库上传直接 push 进车型 photoPaths/videoPaths, 再全量同步
 *   vehicle_sync_data.json; 删除则 unlinkPathOf 后再全量同步。
 *   两处都是"整份车型数据覆盖"——别的设备只改过别的车型, 也会被覆盖;
 *   某设备旧快照再同步一次, 已删的图会"自己回来"(云端文件已无 → 永久缺失)。
 * 现行为: 资源库只写登记表(新增行 / 删除墓碑), 车型 payload 一概不动;
 *   所有渲染在读取时合并「车型基线 + 登记表」, 台账统计同口径。
 *   登记表按 path 去重、按 at 取最新(LWW), 删除用墓碑表达 —— 因此可以
 *   "下载→并集→上传"地增量同步, 不需要整份覆盖, 也不会把删除复活。
 * 存储: localStorage(tcg_media_registry) + 云端 media_registry.json(可选,
 *   离线/无飞书接口时静默降级, 仅影响跨设备可见性, 不影响本机浏览)。
 * ============================================================ */
const REGISTRY_KEY = 'tcg_media_registry';
const REGISTRY_CLOUD_FILE = 'media_registry.json';
let _regCache = null;
let _regSyncTimer = null;

function _regStore(){
  if(_regCache) return _regCache;
  let rows = {};
  try{
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(REGISTRY_KEY) : null;
    const obj = raw ? JSON.parse(raw) : null;
    if(obj && obj.rows && typeof obj.rows === 'object') rows = obj.rows;
  }catch(e){ rows = {}; }
  _regCache = rows;
  return _regCache;
}

function _regSave(){
  try{
    if(typeof localStorage === 'undefined') return false;
    localStorage.setItem(REGISTRY_KEY, JSON.stringify({ version: 1, updatedAt: Date.now(), rows: _regStore() }));
    return true;
  }catch(e){ return false; }
}

/** 全部登记行(含墓碑); 兼容单测直接读取 */
function registryRows(){ return _regStore(); }
function registryRow(path){ return _regStore()[String(path || '')] || null; }
/** 该路径是否已被登记表墓碑/清理(跨设备删除也以登记表为准) */
function _regDead(path){
  const r = registryRow(path);
  return !!(r && (r.deletedAt || r.purgedAt));
}

/**
 * 合并两份登记行(纯函数)。
 * 同一路径取「at 较新」的一次变更; 时间相同则删除优先 —— 宁可少显示一张,
 * 也不能让已删的图借合并复活。
 */
function registryMerge(localRows, remoteRows){
  const out = {};
  [localRows, remoteRows].forEach(function(rows){
    Object.keys(rows || {}).forEach(function(p){
      const r = rows[p];
      if(!r || !r.path) return;
      const cur = out[p];
      const rt = Number(r.at) || 0, ct = cur ? (Number(cur.at) || 0) : -1;
      const newer = !cur || rt > ct ||
        (rt === ct && !!r.deletedAt && !cur.deletedAt);
      if(newer) out[p] = r;
    });
  });
  return out;
}

/** 登记一条上传资产; 写盘失败返回 null(调用方据此回滚已上传文件) */
function registryAdd(row){
  if(!row || !row.path) return null;
  const rows = _regStore();
  const rec = {
    path: row.path,
    kind: row.kind === 'video' ? 'video' : 'photo',
    vehicleId: row.vehicleId,
    display: row.display || '',
    at: Date.now(),
    source: row.source || 'upload'
  };
  const prev = rows[rec.path];
  rows[rec.path] = rec;
  if(_regSave()) return rec;
  /* 写盘失败必须回滚内存, 否则调用方"回滚"后视图仍能看到一条没落盘的登记 */
  if(prev) rows[rec.path] = prev; else delete rows[rec.path];
  return null;
}

/** 删除 = 写墓碑(云端文件与车型 payload 都不动) */
function registryTombstone(path, reason, owners, kind){
  if(!path) return false;
  const rows = _regStore();
  const prev = rows[path] || {};
  rows[path] = {
    path: path,
    kind: kind === 'video' ? 'video' : (prev.kind === 'video' ? 'video' : 'photo'),
    vehicleId: prev.vehicleId,
    display: prev.display || '',
    vehicles: owners || prev.vehicles || [],
    source: prev.source || 'upload',
    at: Date.now(),
    deletedAt: Date.now(),
    deletedReason: reason || 'user'
  };
  return _regSave();
}

/** 恢复 = 摘掉墓碑(仍不写回车型 payload) */
function registryRestore(path){
  const rec = _regStore()[String(path || '')];
  if(!rec) return false;
  delete rec.deletedAt;
  delete rec.deletedReason;
  rec.at = Date.now();
  return _regSave();
}

/** 彻底删除后保留一条"已清理"记录, 防止旧设备快照把路径又合并回来 */
function registryPurge(path){
  if(!path) return false;
  const rows = _regStore();
  const rec = rows[path] || { path: path, kind: 'photo' };
  const now = Date.now();
  rec.purgedAt = now;
  rec.deletedAt = rec.deletedAt || now;
  rec.at = now;
  rows[path] = rec;
  return _regSave();
}

/**
 * 车型媒体视图(纯函数): 基线路径 + 登记表新增, 剔除墓碑。
 * @param {object} v 车型
 * @param {'photo'|'video'} kind
 * @param {object} [rows] 登记行(默认读本机登记表)
 * @returns {string[]}
 */
function mediaPathsFor(v, kind, rows){
  const isVideo = kind === 'video';
  const key = isVideo ? 'videoPaths' : 'photoPaths';
  const base = (v && Array.isArray(v[key])) ? v[key] : [];
  const all = rows || _regStore();
  const dead = {};
  const extra = [];
  Object.keys(all).forEach(function(p){
    const r = all[p];
    if(!r || !r.path) return;
    if((r.kind === 'video') !== isVideo) return;
    if(r.deletedAt || r.purgedAt){ dead[p] = true; return; }
    if(v && String(r.vehicleId) === String(v.id)) extra.push(p);
  });
  const out = [];
  base.forEach(function(p){ if(p && !dead[p] && out.indexOf(p) < 0) out.push(p); });
  extra.forEach(function(p){ if(out.indexOf(p) < 0) out.push(p); });
  return out;
}

/**
 * 车型照片/视频视图 + 对齐的板块/标签(纯函数)。
 * photoSections/photoLabels 与路径按下标一一对应: 剔除墓碑后必须同步重排,
 * 否则后面的照片会顶着前一张的板块与标签。
 */
function mediaMetaFor(v, kind, rows){
  const isVideo = kind === 'video';
  const key = isVideo ? 'videoPaths' : 'photoPaths';
  const base = (v && Array.isArray(v[key])) ? v[key] : [];
  const secs = (!isVideo && v && Array.isArray(v.photoSections)) ? v.photoSections : [];
  const labs = (!isVideo && v && Array.isArray(v.photoLabels)) ? v.photoLabels : [];
  const paths = mediaPathsFor(v, kind, rows);
  const sections = paths.map(function(p){ const i = base.indexOf(p); return i >= 0 ? (secs[i] || 'exterior') : 'exterior'; });
  const labels = paths.map(function(p){ const i = base.indexOf(p); return i >= 0 ? (labs[i] || '') : ''; });
  return { paths: paths, sections: sections, labels: labels };
}

/** 登记表中"新增"的资产 → 台账行(纯函数, 已在基线里的不重复出) */
function registryAssets(rows, vehicles){
  const all = rows || _regStore();
  const vs = Array.isArray(vehicles) ? vehicles : _vehicles();
  const owned = {};
  vs.forEach(function(v){
    (v.photoPaths || []).concat(v.videoPaths || []).forEach(function(p){ if(p) owned[p] = true; });
  });
  return Object.keys(all).map(function(p){ return all[p]; }).filter(function(r){
    return r && r.path && !r.deletedAt && !r.purgedAt && !owned[r.path] && _isMediaPath(r.path);
  }).map(function(r){
    const v = vs.find(function(x){ return String(x.id) === String(r.vehicleId); });
    const isVideo = r.kind === 'video';
    return {
      path: r.path,
      kind: isVideo ? 'video' : 'photo',
      kindLabel: isVideo ? '视频' : '照片',
      status: /^vehicle_(images|videos)\/_共享\//.test(r.path) ? 'shared' : 'ok',
      vehicles: v ? [{ id: v.id, display: v.display }] : [],
      vehicleText: v ? (v.display || '') : '',
      sizeText: '',
      cloudState: 'present',
      registered: true
    };
  });
}

/**
 * 登记表增量上云: 下载 → 并集 → 有变化才上传。
 * 不做整份车型覆盖, 因此不会覆盖别的设备的改动, 墓碑也能传到其他设备。
 */
async function mediaRegistrySync(){
  if(typeof downloadJsonFromDataFeishu !== 'function' || typeof uploadJsonToDataFeishu !== 'function') return false;
  if(!window.FeishuAPI || typeof window.FeishuAPI.getTenantToken !== 'function') return false;
  const token = await window.FeishuAPI.getTenantToken();
  let remote = null;
  try{ remote = await downloadJsonFromDataFeishu(token, REGISTRY_CLOUD_FILE); }catch(e){ remote = null; }
  const remoteRows = (remote && remote.rows) ? remote.rows : {};
  _regCache = registryMerge(_regStore(), remoteRows);
  _regSave();
  if(JSON.stringify(_regCache) !== JSON.stringify(remoteRows)){
    await uploadJsonToDataFeishu(token, REGISTRY_CLOUD_FILE,
      JSON.stringify({ version: 1, updatedAt: Date.now(), rows: _regCache }));
  }
  return true;
}

/** 拉取云端登记表(与车型同步同一时机调用); 有变化返回 true */
async function mediaRegistryPull(){
  if(typeof downloadJsonFromDataFeishu !== 'function') return false;
  if(!window.FeishuAPI || typeof window.FeishuAPI.getTenantToken !== 'function') return false;
  const token = await window.FeishuAPI.getTenantToken();
  let remote = null;
  try{ remote = await downloadJsonFromDataFeishu(token, REGISTRY_CLOUD_FILE); }catch(e){ return false; }
  if(!remote || !remote.rows) return false;
  const before = JSON.stringify(_regStore());
  _regCache = registryMerge(_regStore(), remote.rows);
  _regSave();
  return JSON.stringify(_regCache) !== before;
}

/** 资源库变更后合并上云(3 秒防抖); 离线/非组长静默跳过 */
function _scheduleRegistrySync(){
  if(!_canEdit()) return;
  if(typeof downloadJsonFromDataFeishu !== 'function' || typeof uploadJsonToDataFeishu !== 'function') return;
  if(_regSyncTimer) clearTimeout(_regSyncTimer);
  _regSyncTimer = setTimeout(function(){
    _regSyncTimer = null;
    mediaRegistrySync().catch(function(e){ console.warn('[资源库] 媒体登记表同步失败', e); });
  }, 3000);
}

/* ---------------- 云端实测与资源管理 (V10.26.0) ---------------- */
/* 台账(索引)是离线快照, 会滞后; 本段负责与飞书云端实际文件对账, 并提供组长上传/删除。
 * 对账结果只落在内存(_cloud), 不修改 docs/media_library.json —— 索引仍由生成脚本维护。 */

let _cloud = null;          // {at, photos, videos, byPath:{path:{name,token,size,folder}}, orphans:[asset]}
let _cloudBusy = false;
let _cloudErr = '';
let _uploadTarget = null;

function _toast(msg){ if(typeof showToast === 'function') showToast(msg); }

function _canEdit(){
  try { return typeof canEdit === 'function' && !!canEdit(); } catch(e){ return false; }
}

function _mp(){
  try { if(typeof TCG_MEDIA_PATHS !== 'undefined' && TCG_MEDIA_PATHS) return TCG_MEDIA_PATHS; } catch(e){}
  return window.TCG_MEDIA_PATHS || null;
}

function _vehicles(){
  try { if(typeof VEHICLES !== 'undefined' && VEHICLES) return VEHICLES; } catch(e){}
  return window.VEHICLES || [];
}

function _isMediaPath(p){ return /^vehicle_(images|videos)\//.test(String(p || '')); }

function _splitPath(p){
  const m = /^(vehicle_(?:images|videos))\/([^/]+)\/(.+)$/.exec(String(p || ''));
  return m ? { top: m[1], folder: m[2], name: m[3] } : null;
}

function _bustList(tk){
  try { if(typeof _feishuListCache !== 'undefined' && _feishuListCache) delete _feishuListCache['fl:' + tk]; } catch(e){}
}

async function _ensureFolder(token, parentToken, name){
  _bustList(parentToken);
  const list = await feishuListFiles(token, parentToken);
  const hit = (list || []).find(function(f){ return f.type === 'folder' && f.name === name; });
  if(hit) return hit.token;
  const r = await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({ name: name, folder_token: parentToken })
  });
  const tok = r && r.data && r.data.token;
  if(!tok) throw new Error('创建云端目录失败: ' + name);
  _bustList(parentToken);
  return tok;
}

async function _dataRoot(token){
  if(typeof getDataFolderToken === 'function') return await getDataFolderToken(token);
  return null;
}

function _cloudAsset(path, f){
  const sp = _splitPath(path);
  const isVideo = !!(sp && sp.top === 'vehicle_videos');
  return {
    path: path,
    kind: isVideo ? 'video' : 'photo',
    kindLabel: isVideo ? '视频' : '照片',
    status: 'orphan',
    vehicleText: '云端有 · 台账无引用' + (sp && sp.folder ? '（' + sp.folder + '）' : ''),
    vehicles: [],
    sizeText: humanSize(f && f.size),
    cloudState: 'present'
  };
}

async function checkCloud(){
  if(_cloudBusy) return;
  if(!window.FeishuAPI || typeof window.FeishuAPI.getTenantToken !== 'function' || typeof feishuListFiles !== 'function'){
    _cloudErr = '当前环境不支持云端核对（缺少飞书接口）';
    render();
    return;
  }
  _cloudBusy = true; _cloudErr = ''; render();
  try{
    const token = await window.FeishuAPI.getTenantToken();
    const root = await _dataRoot(token);
    if(!root) throw new Error('数据文件夹不可用');
    const topList = await feishuListFiles(token, root) || [];
    const byPath = {};
    let photos = 0, videos = 0;
    for(const topName of ['vehicle_images', 'vehicle_videos']){
      const folder = topList.find(function(f){ return f.type === 'folder' && f.name === topName; });
      if(!folder) continue;
      const entries = await feishuListFiles(token, folder.token) || [];
      for(const e of entries){
        if(e.type !== 'folder'){                      // 旧布局: 顶层散落文件
          const p = topName + '/' + e.name;
          byPath[p] = { name: e.name, token: e.token, size: e.size || 0, folder: '' };
          if(topName === 'vehicle_images') photos++; else videos++;
          continue;
        }
        const files = await feishuListFiles(token, e.token) || [];
        for(const f of files){
          if(f.type === 'folder') continue;
          const p = topName + '/' + e.name + '/' + f.name;
          byPath[p] = { name: f.name, token: f.token, size: f.size || 0, folder: e.name };
          if(topName === 'vehicle_images') photos++; else videos++;
        }
      }
    }
    /* 已知集合必须用"索引 + 车型实时引用"的并集, 否则车型侧刚上传、
     * 索引还没重建的文件会被误判成"云端有·台账无引用"的孤儿。 */
    const all = baseAssets();
    const known = {};
    all.forEach(function(a){ if(a && a.path) known[a.path] = 1; });
    const orphans = Object.keys(byPath).filter(function(p){ return !known[p]; })
      .map(function(p){ return _cloudAsset(p, byPath[p]); });
    _cloud = { at: Date.now(), photos: photos, videos: videos, byPath: byPath, orphans: orphans };
    _toast('核对完成: 云端照片 ' + photos + ' / 视频 ' + videos +
      (orphans.length ? ('，' + orphans.length + ' 个无台账文件') : '，全部有台账'));
  }catch(e){
    _cloudErr = '云端核对失败: ' + ((e && e.message) || e);
  }
  _cloudBusy = false; render();
}

function _safeBase(name){
  return String(name || '').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 60) || 'vehicle';
}

function _quickHash(s){
  let h = 5381;
  for(let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return ('0000000' + h.toString(16)).slice(-8);
}

/**
 * 文件内容哈希（P1 上传判重的基础）
 * 只采样首尾各 1MB + 总字节数参与摘要：大视频不必整读进内存，且同一文件
 * 每次得到同一个名字 —— 旧实现把 Date.now() 放进哈希，导致重复上传永远
 * 判不重、云端堆同样内容的多份文件。
 */
async function _fileContentHash(file){
  try{
    const size = file.size || 0;
    const chunk = 1024 * 1024;
    const head = await file.slice(0, Math.min(chunk, size)).arrayBuffer();
    const tail = size > chunk ? await file.slice(Math.max(0, size - chunk), size).arrayBuffer() : new ArrayBuffer(0);
    const bytes = new Uint8Array(head.byteLength + tail.byteLength + 8);
    bytes.set(new Uint8Array(head), 0);
    bytes.set(new Uint8Array(tail), head.byteLength);
    new DataView(bytes.buffer).setFloat64(head.byteLength + tail.byteLength, size, true);
    if(typeof crypto !== 'undefined' && crypto && crypto.subtle && crypto.subtle.digest){
      const d = await crypto.subtle.digest('SHA-256', bytes.buffer);
      return Array.prototype.slice.call(new Uint8Array(d), 0, 4).map(function(b){
        return ('0' + b.toString(16)).slice(-2);
      }).join('');
    }
    let h = 5381;
    for(let i = 0; i < bytes.length; i++) h = ((h * 33) ^ bytes[i]) >>> 0;
    return ('0000000' + h.toString(16)).slice(-8);
  }catch(e){
    return _quickHash((file.name || '') + ':' + (file.size || 0));
  }
}

/** 内容哈希 → 已上传路径（仅本机记忆，用于跳过重复上传） */
function _hashIndex(){
  try{
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem('tcg_media_hashes') : null;
    return raw ? (JSON.parse(raw) || {}) : {};
  }catch(e){ return {}; }
}
function _hashSave(map){
  try{ if(typeof localStorage !== 'undefined') localStorage.setItem('tcg_media_hashes', JSON.stringify(map || {})); }catch(e){}
}

function uploadFlow(){
  if(!_canEdit()){ _toast('仅组长可上传资源'); return; }
  const vs = _vehicles();
  if(!vs.length){ _toast('没有可上传的车型'); return; }
  let el = document.getElementById('ml-pick-vehicle');
  if(!el){
    el = document.createElement('div');
    el.id = 'ml-pick-vehicle';
    el.className = 'modal-overlay';
    el.addEventListener('click', function(e){ if(e.target === el) el.classList.remove('show'); });
    document.body.appendChild(el);
  }
  el.innerHTML = '<div class="modal-sheet" style="max-height:80vh">' +
    '<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">' +
      '<div class="text-sm font-medium">选择上传到的车型</div>' +
      '<button onclick="document.getElementById(\'ml-pick-vehicle\').classList.remove(\'show\')" ' +
        'class="text-gray-400 text-xl leading-none">×</button>' +
    '</div>' +
    '<div class="p-3 overflow-auto space-y-2">' +
      vs.map(function(v){
        return '<button data-ml-veh="' + v.id + '" class="w-full text-left px-3 py-2 rounded-xl bg-gray-50 text-sm text-gray-800">' +
          esc(v.display || ('车型' + v.id)) +
          '<span class="text-[10px] text-gray-400 ml-2">' + mediaPathsFor(v, 'photo').length + ' 照片 / ' +
          mediaPathsFor(v, 'video').length + ' 视频</span></button>';
      }).join('') +
    '</div></div>';
  el.querySelectorAll('[data-ml-veh]').forEach(function(btn){
    btn.onclick = function(){
      const id = btn.getAttribute('data-ml-veh');
      _uploadTarget = _vehicles().find(function(v){ return String(v.id) === id; }) || null;
      el.classList.remove('show');
      if(!_uploadTarget) return;
      const input = _uploadInput();
      input.value = '';
      input.click();
    };
  });
  el.classList.add('show');
}

function _uploadInput(){
  let input = document.getElementById('ml-upload-input');
  if(input) return input;
  input = document.createElement('input');
  input.type = 'file';
  input.id = 'ml-upload-input';
  input.accept = 'image/*,video/*';
  input.multiple = true;
  input.style.display = 'none';
  input.addEventListener('change', function(){ if(input.files && input.files.length) onUploadFiles(input.files); });
  document.body.appendChild(input);
  return input;
}

async function onUploadFiles(fileList){
  const v = _uploadTarget;
  if(!v){ _toast('请先选择车型'); return; }
  if(!_canEdit()){ _toast('仅组长可上传资源'); return; }
  if(typeof httpUploadFileSmart !== 'function' || typeof feishuListFiles !== 'function'){
    _toast('当前环境不支持上传（缺少飞书接口）'); return;
  }
  const files = Array.prototype.slice.call(fileList || []);
  if(!files.length) return;
  if(!_data) _data = { assets: [], orphans: [] };
  _toast('正在上传 ' + files.length + ' 个文件…');
  let ok = 0, fail = 0, skip = 0;
  try{
    const token = await window.FeishuAPI.getTenantToken();
    const root = await _dataRoot(token);
    if(!root) throw new Error('数据文件夹不可用');
    const MP = _mp();
    const folderName = (MP && typeof MP.folderNameForVehicle === 'function')
      ? MP.folderNameForVehicle(v) : _safeBase(v.display);
    const hi = _hashIndex();
    for(const file of files){
      const isVideo = /^video\//.test(file.type || '') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name || '');
      const topName = isVideo ? 'vehicle_videos' : 'vehicle_images';
      try{
        /* P1 判重: 同名同内容(首尾采样哈希)已传过 → 直接跳过, 不再上传第二份 */
        const hash = await _fileContentHash(file);
        const seen = hi[hash];
        if(seen && !isTrashed(seen) && !isPurged(seen)){
          skip++;
          continue;
        }
        const topToken = await _ensureFolder(token, root, topName);
        const dirToken = await _ensureFolder(token, topToken, folderName);
        const seq = mediaPathsFor(v, isVideo ? 'video' : 'photo').length + 1;
        const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
        /* 文件名用内容哈希(不是时间戳): 同一文件重复上传得到同一名字, 云端幂等 */
        const fileName = _safeBase(v.display) + (isVideo ? '_v' : '_p') + seq + '_' +
          hash + '.' + (ext ? ext.toLowerCase() : (isVideo ? 'mp4' : 'jpg'));
        const res = await httpUploadFileSmart({ token: token, fileName: fileName, folderToken: dirToken, blob: file });
        if(!res || res.code !== 0) throw new Error((res && res.msg) || '飞书拒绝上传');
        const rel = (MP && typeof MP.photoRelPath === 'function')
          ? (isVideo ? MP.videoRelPath(folderName, fileName) : MP.photoRelPath(folderName, fileName))
          : topName + '/' + folderName + '/' + fileName;
        /* 单一真源: 只登记到媒体登记表, 不写回车型 photoPaths/videoPaths。
         * 序号按合并视图计算, 保证文件名不重复; 车型 payload 全程不动。 */
        if(!registryAdd({ path: rel, kind: isVideo ? 'video' : 'photo', vehicleId: v.id, display: v.display, source: 'upload' })){
          /* P1 失败回滚: 本地登记失败 → 删掉刚上传的云端文件, 避免孤儿 */
          try{
            const ft = res && res.data && res.data.file_token;
            if(ft && window.FeishuAPI && typeof window.FeishuAPI.driveDeleteFile === 'function'){
              await window.FeishuAPI.driveDeleteFile(ft);
            }
          }catch(e2){ console.warn('[资源库] 回滚删除失败', e2); }
          throw new Error('媒体登记表写入失败');
        }
        hi[hash] = rel;
        _hashSave(hi);
        if(!_cloud) _cloud = { at: Date.now(), photos: 0, videos: 0, byPath: {}, orphans: [] };
        if(!_cloud.byPath) _cloud.byPath = {};
        _cloud.byPath[rel] = { name: fileName, token: '', size: file.size || 0, folder: folderName };
        if(isVideo) _cloud.videos = (_cloud.videos || 0) + 1;
        else _cloud.photos = (_cloud.photos || 0) + 1;
        _data.assets.unshift({
          path: rel,
          kind: isVideo ? 'video' : 'photo',
          kindLabel: isVideo ? '视频' : '照片',
          status: folderName === '_共享' ? 'shared' : 'ok',
          sizeText: humanSize(file.size),
          vehicleText: v.display || '',
          vehicles: [{ id: v.id, display: v.display }],
          cloudState: 'present'
        });
        ok++;
      }catch(err){
        fail++;
        console.warn('[资源库] 上传失败', file.name, err);
      }
    }
  }catch(e){
    _toast('上传失败: ' + ((e && e.message) || e));
    render();
    return;
  }
  _toast(ok
    ? ('上传完成 ' + ok + ' 个' + (skip ? ('，跳过重复 ' + skip + ' 个') : '') + (fail ? ('，失败 ' + fail + ' 个') : ''))
    : (skip ? ('这 ' + skip + ' 个文件之前已上传过，已跳过') : '上传失败'));
  if(ok) _scheduleRegistrySync();
  render();
}

/* ============================================================
 * 媒体回收站（V10.28.0 / P0：删除必须可恢复）
 * ------------------------------------------------------------
 * 旧行为: deleteCloud 直接 driveDeleteFile 并解除引用, 弹窗写死"不可恢复"。
 * 现行为: 删除 = 回收站记录 + 媒体登记表墓碑(渲染层隐藏), 云端文件保留;
 *   回收站里「恢复」只摘墓碑,「彻底删除」才真正调 driveDeleteFile。
 * 记录独立存 localStorage(tcg_media_trash), 与车型数据解耦:
 *   车型被删后记录仍在; 墓碑随登记表增量上云, 其他设备也会同步隐藏。
 * ============================================================ */
const TRASH_KEY = 'tcg_media_trash';
let _trashStoreCache = null;
let _trashMode = false;

function _videoLike(path){ return /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(String(path || '')); }

function _trashStore(){
  if(_trashStoreCache) return _trashStoreCache;
  try{
    const raw = (typeof localStorage !== 'undefined') ? localStorage.getItem(TRASH_KEY) : null;
    const list = raw ? JSON.parse(raw) : [];
    _trashStoreCache = Array.isArray(list) ? list.filter(Boolean) : [];
  }catch(e){ _trashStoreCache = []; }
  return _trashStoreCache;
}
function _trashSave(){
  try{
    if(typeof localStorage !== 'undefined') localStorage.setItem(TRASH_KEY, JSON.stringify(_trashStore()));
  }catch(e){}
}
function trashEntries(){ return _trashStore().filter(function(t){ return t && !t.purged; }); }
function trashCount(){ return trashEntries().length; }
function isTrashed(path){ return !!path && trashEntries().some(function(t){ return t.path === path; }); }
function isPurged(path){ return !!path && _trashStore().some(function(t){ return t.path === path && t.purged; }); }
function trashRecord(path){ return trashEntries().find(function(t){ return t.path === path; }) || null; }

/** 当前仍在引用该路径的车型(基线引用 + 登记表归属) */
function _ownersOf(path){
  const out = _vehicles().filter(function(v){
    return (v.photoPaths || []).indexOf(path) >= 0 || (v.videoPaths || []).indexOf(path) >= 0;
  }).map(function(v){ return { id: v.id, display: v.display }; });
  const reg = registryRow(path);
  if(reg && reg.vehicleId != null && !out.some(function(o){ return String(o.id) === String(reg.vehicleId); })){
    const v = _vehicles().find(function(x){ return String(x.id) === String(reg.vehicleId); });
    out.push({ id: v ? v.id : reg.vehicleId, display: v ? v.display : (reg.display || '') });
  }
  return out;
}

/** 移入回收站(幂等); 只记台账, 不动云端文件 */
function moveToTrash(path, reason, kind, owners){
  if(!path) return null;
  const list = _trashStore();
  const hit = list.find(function(t){ return t.path === path && !t.purged; });
  if(hit) return hit;
  const rec = {
    path: path,
    kind: kind || (_videoLike(path) ? 'video' : 'photo'),
    reason: reason || 'user',
    at: Date.now(),
    name: String(path).split('/').pop(),
    vehicles: owners || _ownersOf(path)
  };
  list.push(rec); _trashSave();
  return rec;
}
function dropTrash(path){
  const list = _trashStore();
  const i = list.findIndex(function(t){ return t.path === path; });
  if(i >= 0){ list.splice(i, 1); _trashSave(); }
}
function markPurged(path){
  const list = _trashStore();
  const rec = list.find(function(t){ return t.path === path && !t.purged; });
  if(rec){ rec.purged = true; rec.purgedAt = Date.now(); _trashSave(); }
  return rec || null;
}

/** 恢复: 摘掉登记表墓碑即可重新可见; 车型 payload 全程不动 */
function restoreFromTrash(path){
  const rec = trashRecord(path);
  if(!rec){ _toast('回收站中没有该文件'); return false; }
  registryRestore(path);
  dropTrash(path);
  _scheduleRegistrySync();
  render();
  _toast('已恢复');
  return true;
}

/** 彻底删除: 必须拿到云端句柄, 否则拒绝(避免只删记录、留死文件) */
function purgeFromTrash(path){
  if(!_canEdit()){ _toast('仅组长可彻底删除'); return; }
  const rec = trashRecord(path);
  if(!rec){ _toast('回收站中没有该文件'); return; }
  const cf = _cloud && _cloud.byPath && _cloud.byPath[path];
  if(!cf || !cf.token){ _toast('请先点「核对云端」取得文件句柄，再彻底删除'); return; }
  const name = cf.name || rec.name || path;
  const doPurge = async function(){
    try{
      await window.FeishuAPI.driveDeleteFile(cf.token);
      markPurged(path);
      /* 保留一条"已清理"墓碑, 防止旧设备的快照把它合并回来 */
      registryPurge(path);
      if(_cloud){
        _cloud.orphans = (_cloud.orphans || []).filter(function(a){ return a.path !== path; });
        delete _cloud.byPath[path];
        const sp = _splitPath(path);
        if(sp && sp.top === 'vehicle_videos') _cloud.videos = Math.max(0, (_cloud.videos || 1) - 1);
        else _cloud.photos = Math.max(0, (_cloud.photos || 1) - 1);
      }
      render();
      _scheduleRegistrySync();
      _toast('已彻底删除云端文件');
    }catch(e){
      _toast('彻底删除失败: ' + ((e && e.message) || e));
    }
  };
  if(typeof showConfirm === 'function'){
    showConfirm('彻底删除', '「' + name + '」将从云端永久删除，不可恢复。', doPurge);
  }else if(window.confirm && window.confirm('永久删除「' + name + '」？')){
    doPurge();
  }
}

/** 车型删除级联: 独享媒体入回收站, 共享媒体保持不动 */
function trashVehicleMedia(id, display){
  const v = _vehicles().find(function(x){ return String(x.id) === String(id); });
  if(!v) return 0;
  let n = 0;
  [['photoPaths', 'photo'], ['videoPaths', 'video']].forEach(function(pair){
    (v[pair[0]] || []).forEach(function(p){
      if(!_isMediaPath(p)) return;
      const owners = _ownersOf(p);
      if(owners.length <= 1){
        moveToTrash(p, 'vehicle_cascade', pair[1], owners.length ? owners : [{ id: v.id, display: display || v.display }]);
        registryTombstone(p, 'vehicle_cascade', owners.length ? owners : [{ id: v.id, display: display || v.display }], pair[1]);
        n++;
      }
    });
  });
  return n;
}

function toggleTrash(){
  _trashMode = !_trashMode;
  _page = 0;
  render();
}

function trashRowHtml(t){
  const reason = t.reason === 'vehicle_cascade' ? '车型删除级联' : '手动删除';
  const vs = (t.vehicles || []).map(function(x){ return x && (x.display || x.id); }).filter(Boolean).join('、');
  const when = new Date(t.at || Date.now());
  return '<div class="bg-white rounded-xl p-3 flex items-start gap-2">' +
    '<div class="flex-1 min-w-0">' +
      '<div class="text-[13px] font-medium text-gray-800 truncate">' + esc(t.name || t.path) + '</div>' +
      '<div class="text-[11px] text-gray-400 mt-0.5 truncate">' + esc(t.path) + '</div>' +
      '<div class="text-[11px] text-gray-400 mt-0.5">' + reason +
        (vs ? (' · ' + esc(vs)) : '') + ' · ' + when.toLocaleString() + '</div>' +
    '</div>' +
    '<button onclick="MediaLibrary.restoreFromTrash(\'' + esc(t.path) + '\')" ' +
      'class="px-2 py-1 text-xs text-blue-600 shrink-0">恢复</button>' +
    '<button onclick="MediaLibrary.purgeFromTrash(\'' + esc(t.path) + '\')" ' +
      'class="px-2 py-1 text-xs text-red-500 shrink-0">彻底删除</button>' +
  '</div>';
}

function trashHtml(){
  const list = trashEntries();
  return '<div class="px-4 mt-3">' +
    '<div class="rounded-xl bg-amber-50 text-amber-800 text-[11px] leading-relaxed px-3 py-2">' +
      '回收站只解除引用，<b>不删除云端文件</b>；「彻底删除」才会真正删文件。共 ' + list.length + ' 项。' +
    '</div>' +
    '<div class="mt-2 space-y-2">' +
      (list.length ? list.map(trashRowHtml).join('')
        : '<div class="text-center text-sm text-gray-400 py-8">回收站是空的</div>') +
    '</div></div>';
}

function deleteCloud(path){
  if(!_canEdit()){ _toast('仅组长可删除资源'); return; }
  const cf = _cloud && _cloud.byPath && _cloud.byPath[path];
  const asset = allAssets().find(function(a){ return a.path === path; });
  const kind = (asset && asset.kind) || (_videoLike(path) ? 'video' : 'photo');
  const name = (cf && cf.name) || String(path).split('/').pop();
  const owners = _ownersOf(path);
  const doTrash = function(){
    moveToTrash(path, 'user', kind, owners);
    /* 只写墓碑: 渲染层据此隐藏, 车型 payload 不动 → 不会被旧快照同步回来 */
    registryTombstone(path, 'user', owners, kind);
    closePreview();
    render();
    _scheduleRegistrySync();
    _toast('已移入回收站，可在回收站恢复');
  };
  if(typeof showConfirm === 'function'){
    showConfirm('移入回收站', '将把「' + name + '」移入回收站，并在所有车型中隐藏；文件不会删除，可随时恢复。', doTrash);
  }else if(window.confirm && window.confirm('将「' + name + '」移入回收站？')){
    doTrash();
  }else{
    _toast('需要确认后才能删除');
  }
}

async function loadCloudPreview(path){
  const cf = _cloud && _cloud.byPath && _cloud.byPath[path];
  const box = document.getElementById('ml-preview-body');
  if(!cf || !cf.token){ _toast('该文件没有云端句柄，请先核对云端'); return; }
  if(!box) return;
  box.innerHTML = '<div class="text-center text-xs text-gray-400 py-6">正在从云端读取…</div>';
  try{
    const isVideo = !/\.(jpe?g|png|webp|gif|bmp|heic)$/i.test(cf.name);
    let blob;
    if(typeof feishuDownloadFile === 'function'){
      const token = await window.FeishuAPI.getTenantToken();
      blob = await feishuDownloadFile(
        'https://open.feishu.cn/open-apis/drive/v1/files/' + cf.token + '/download',
        token, isVideo ? 'video/mp4' : 'image/jpeg', 120);
    }else{
      blob = await window.FeishuAPI.driveDownloadFile(cf.token);
    }
    const url = URL.createObjectURL(blob);
    box.innerHTML = (isVideo
        ? '<video src="' + url + '" controls autoplay playsinline class="w-full rounded-lg bg-black"></video>'
        : '<img src="' + url + '" class="w-full rounded-lg" alt="">') +
      '<div class="mt-3 text-xs text-gray-500 break-all">路径：' + esc(path) + '</div>' +
      '<div class="mt-3"><button onclick="MediaLibrary.deleteCloud(\'' + esc(path) + '\')" ' +
        'class="w-full py-2 rounded-xl bg-red-50 text-sm text-red-600">删除云端文件</button></div>';
  }catch(e){
    _toast('云端读取失败: ' + ((e && e.message) || e));
  }
}

/* ---------------- 渲染 ---------------- */

/**
 * 「车型 ↔ 资源」断链行（V10.26.5，纯函数，供单测）
 * 三个来源: 无主目录（删车/改名残留） / 改名失配（引用旧目录、文件在新目录） / 无素材车型
 */
function brokenRows(data){
  const d = data || {};
  const rows = [];
  (d.unownedFolders || []).forEach(function(u){
    rows.push({ path: 'vehicle_images/' + u.folder, title: u.folder, kind: 'photo', kindLabel: '无主目录', status: 'unowned',
      sizeText: (u.files || 0) + ' 个文件', vehicleText: '无车型引用（删车或改名残留）', vehicles: [] });
  });
  (d.renamedRefs || []).forEach(function(r){
    rows.push({ path: r.foundAt || r.declared, title: (r.fileName || ''), kind: 'photo', kindLabel: '改名失配', status: 'renamed',
      sizeText: '', vehicleText: r.display + ' → 文件在「' + (r.foundFolder || '?') + '」',
      vehicles: r.id ? [{ id: r.id, display: r.display }] : [] });
  });
  (d.vehiclesWithoutMedia || []).forEach(function(v){
    rows.push({ path: 'vehicle_images/<' + v.folder + '>', title: v.display, kind: 'photo', kindLabel: '无素材', status: 'nomedia',
      sizeText: '', vehicleText: '该车型还没有照片/视频', vehicles: v.id ? [{ id: v.id, display: v.display }] : [] });
  });
  return rows;
}

function esc(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
    return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
  });
}

function chipHtml(f, st){
  const n = f.id === 'all' ? st.total
    : f.id === 'photo' ? st.photos
    : f.id === 'video' ? st.videos
    : (st[f.id] || 0);
  const active = _filter === f.id;
  return '<button data-ml-filter="' + f.id + '" onclick="MediaLibrary.setFilter(\'' + f.id + '\')" ' +
    'class="px-3 py-1.5 rounded-full text-xs whitespace-nowrap ' +
    (active ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 border border-gray-200') + '">' +
    esc(f.label) + '<span class="ml-1 opacity-70">' + n + '</span></button>';
}

function thumbHtml(a){
  const st = STATUS_META[a.status] || STATUS_META.ok;
  /* V10.26.5: 断链行(无主目录/改名失配/无素材)没有可显示的图, 用文字占位, 别放坏 <img> */
  if(a.status === 'unowned' || a.status === 'renamed' || a.status === 'nomedia'){
    const txt = a.status === 'unowned' ? '目录' : (a.status === 'renamed' ? '改名' : '无素材');
    return '<div class="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-[10px] shrink-0">' + txt + '</div>';
  }
  if(a.kind === 'video'){
    return '<div class="w-14 h-14 rounded-lg bg-gradient-to-br from-slate-700 to-slate-500 flex items-center justify-center text-white text-lg shrink-0">▶</div>';
  }
  if(a.status === 'missing' || a.status === 'orphan'){
    return '<div class="w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs shrink-0">无图</div>';
  }
  return '<img loading="lazy" decoding="async" src="' + esc(a.path) + '" alt="" ' +
    'class="w-14 h-14 rounded-lg object-cover bg-gray-100 shrink-0" ' +
    'onerror="this.replaceWith(Object.assign(document.createElement(\'div\'),{className:\'w-14 h-14 rounded-lg bg-gray-100 flex items-center justify-center text-gray-400 text-xs shrink-0\',textContent:\'加载失败\'}))">';
}

function rowHtml(a){
  const st = STATUS_META[a.status] || STATUS_META.ok;
  /* 标题: 断链行给 a.title(车型/目录名); 其余用**文件名**(车型名在下行显示, 避免连写两遍) */
  const title = a.title || String(a.path || '').split('/').pop();
  return '<div class="flex items-center gap-3 p-2 bg-white rounded-xl active:bg-gray-50' +
    (a.path === _focusPath ? ' ring-2 ring-blue-400' : '') + '" ' +
    'data-ml-key="' + esc(a.path) + '">' +
      thumbHtml(a) +
      '<div class="min-w-0 flex-1">' +
        '<div class="text-sm text-gray-800 truncate">' + esc(title) + '</div>' +
        '<div class="text-xs text-gray-400 truncate mt-0.5">' + esc(a.vehicleText || a.path) + '</div>' +
        '<div class="flex items-center gap-1.5 mt-1">' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] ' + st.cls + '">' + esc(st.label) + '</span>' +
          (a.cloudState
            ? '<span class="px-1.5 py-0.5 rounded text-[10px] ' +
              (a.cloudState === 'present' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-500') + '">' +
              (a.cloudState === 'present' ? '云端✓' : '云端✗') + '</span>'
            : '') +
          (a.sizeText ? '<span class="text-[10px] text-gray-400">' + esc(a.sizeText) + '</span>' : '') +
          (a.sha256 ? '<span class="text-[10px] text-gray-400">已指纹</span>' : '') +
          (a.lowRes ? '<span class="px-1.5 py-0.5 rounded text-[10px] bg-fuchsia-50 text-fuchsia-700">低清' + (a.resText ? ' ' + a.resText : '') + '</span>' : '') +
        '</div>' +
      '</div>' +
      '<button onclick="event.stopPropagation();MediaLibrary.preview(\'' + esc(a.path) + '\')" ' +
        'class="px-2 py-1 text-xs text-blue-600 shrink-0">查看</button>' +
    '</div>';
}

/* 静态索引(assets + orphans) + 车型实时引用 + 媒体登记表新增, 三者合并。
 * 资源库上传只进登记表, 所以台账必须并入登记表, 否则刚上传的图"消失到下次发版"。 */
function baseAssets(){
  const base = _data || {};
  const statics = (base.assets || []).concat(base.orphans || []);
  const vehicles = _vehicles();
  /* 车型未加载(或本页无车型数据)时只读静态索引, 不能按引用关系过滤掉全部行 */
  if(!vehicles.length) return statics;
  const live = liveAssetsOf(vehicles).concat(registryAssets(registryRows(), vehicles));
  return mergeAssets(statics, live);
}

function allAssets(){
  /* 回收站/永久删除/登记表墓碑的路径不再出现在台账与统计里 */
  const list = baseAssets().concat((_cloud && _cloud.orphans) || []).filter(function(a){
    return a && a.path && !isTrashed(a.path) && !isPurged(a.path) && !_regDead(a.path);
  });
  if(_cloud && _cloud.byPath){
    list.forEach(function(a){
      if(a && _isMediaPath(a.path)) a.cloudState = _cloud.byPath[a.path] ? 'present' : 'absent';
    });
  }
  return list;
}

/* ============================================================
 * 车型详情页 ↔ 资源库 双向强关联 (V10.27.3)
 * ------------------------------------------------------------
 * 此前只有「资源库 → 车型」一个方向(资源库打开车型)。车型详情页仍直接
 * 渲染 photoPaths/videoPaths, 用户看不出这张图在资源库里是什么状态
 * (共享/云端/缺失/低清), 也无法从车型跳到对应资产 —— 两个视图各说各话。
 * 本段补上「车型 → 资源库」: 详情页媒体卡片挂状态徽标, 点按定位到台账行;
 * 台账页可按车型收窄, 也可从某条资产直接打开车型, 形成闭环。
 * ============================================================ */

/** 路径 → 合并后的资产(索引快照 + 车型实时引用) */
function indexMap(){
  const map = {};
  baseAssets().forEach(function(a){ if(a && a.path) map[a.path] = a; });
  return map;
}

/**
 * 单车型的资源库汇总(纯函数, 供详情页标题与测试)。
 * 只统计「当前车型确实引用」的资产, 口径与台账行一致。
 */
function vehicleSummary(id, list){
  const assets = Array.isArray(list) ? list : baseAssets();
  const out = { id: id, total: 0, photos: 0, videos: 0, ok: 0,
    shared: 0, remote: 0, missing: 0, lowRes: 0 };
  assets.forEach(function(a){
    if(!a) return;
    const owns = (a.vehicles || []).some(function(v){ return v && String(v.id) === String(id); });
    if(!owns) return;
    out.total++;
    if(a.kind === 'video') out.videos++; else out.photos++;
    if(a.status === 'missing') out.missing++;
    else if(a.status === 'shared') out.shared++;
    else if(a.status === 'remote') out.remote++;
    else out.ok++;
    if(a.lowRes) out.lowRes++;
  });
  return out;
}

/** 资产 → 详情页徽标文案/配色 */
function badgeOf(a){
  const meta = STATUS_META[a && a.status] || STATUS_META.ok;
  const text = (a && a.status === 'new') ? '待入库' : meta.label;
  let label = text;
  if(a && a.lowRes) label += ' · 低清';
  return { text: label, cls: meta.cls };
}

/** 详情页媒体卡片装饰: 叠加资源库状态徽标 + 板块汇总 + 跳转入口 */
function decorateVehicleMedia(vehicle){
  if(typeof document === 'undefined' || !document.getElementById) return;
  const host = document.getElementById('detail-content');
  if(!host || typeof host.querySelectorAll !== 'function') return;
  const v = vehicle;
  const paint = function(){
    const map = indexMap();
    host.querySelectorAll('[data-media-path]').forEach(function(tile){
      if(tile.querySelector('[data-media-badge]')) return;
      const p = tile.getAttribute('data-media-path');
      const a = map[p];
      if(!a) return;
      const b = badgeOf(a);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute('data-media-badge', '1');
      btn.className = 'absolute top-1 left-1 z-10 px-1.5 py-0.5 rounded text-[10px] ' + b.cls;
      btn.textContent = b.text;
      btn.onclick = function(ev){
        if(ev && ev.stopPropagation) ev.stopPropagation();
        openPath(p);
      };
      tile.appendChild(btn);
    });
    if(v && v.id != null){
      const ps = { total: 0, missing: 0, shared: 0, lowRes: 0 };
      const vs = { total: 0, missing: 0, shared: 0, lowRes: 0 };
      Object.keys(map).forEach(function(p){
        const a = map[p];
        if(!a || !(a.vehicles || []).some(function(x){ return x && String(x.id) === String(v.id); })) return;
        const s = a.kind === 'video' ? vs : ps;
        s.total++;
        if(a.status === 'missing') s.missing++;
        else if(a.status === 'shared') s.shared++;
        if(a.lowRes) s.lowRes++;
      });
      const label = function(s){
        const seg = [];
        if(s.total) seg.push(s.total + ' 项');
        if(s.missing) seg.push(s.missing + ' 缺失');
        if(s.shared) seg.push(s.shared + ' 共享');
        if(s.lowRes) seg.push(s.lowRes + ' 低清');
        return seg.join(' · ');
      };
      const pEl = host.querySelector('[data-media-summary="photo"]');
      if(pEl) pEl.textContent = label(ps);
      const vEl = host.querySelector('[data-media-summary="video"]');
      if(vEl) vEl.textContent = label(vs);
    }
  };
  if(_data){ paint(); return; }
  ensureIndex().then(paint).catch(function(){ /* 索引不可用时不打扰用户, 详情页照常可用 */ });
}

/** 从详情页跳到资源库并定位到该资产所在分页/行 */
function openPath(path){
  const p = String(path || '');
  if(!p) return;
  _focusPath = p;
  _vehicleFocus = null;
  _filter = 'all';
  _query = '';
  _page = 0;
  if(typeof showScreen === 'function') showScreen('screen-media-library');
  const go = function(){
    const list = filterAssets(allAssets(), 'all', '');
    const idx = list.findIndex(function(a){ return a && a.path === p; });
    if(idx >= 0) _page = Math.floor(idx / PAGE_SIZE);
    render();
  };
  if(_data){ go(); return; }
  ensureIndex().then(go).catch(function(e){
    _error = '资源索引加载失败：' + ((e && e.message) || e);
    render();
  });
}

/** 从详情页进入资源库并只看这台车的资产 */
function openForVehicle(id){
  const v = _vehicles().find(function(x){ return x && String(x.id) === String(id); });
  _vehicleFocus = { id: id, display: (v && v.display) || ('#' + id) };
  _focusPath = '';
  _filter = 'all';
  _query = '';
  _page = 0;
  if(typeof showScreen === 'function') showScreen('screen-media-library');
  refresh(false);
}

function clearVehicleFocus(){
  _vehicleFocus = null;
  _page = 0;
  render();
}

function _scrollToFocus(){
  if(!_focusPath || typeof document === 'undefined' || !document.getElementById) return;
  const box = document.getElementById('ml-list');
  if(!box || typeof box.querySelectorAll !== 'function') return;
  Array.prototype.forEach.call(box.querySelectorAll('[data-ml-key]'), function(row){
    if(row.getAttribute('data-ml-key') === _focusPath && typeof row.scrollIntoView === 'function'){
      try { row.scrollIntoView({ block: 'center' }); } catch(e){ /* 老 WebView 不支持对象参数 */ }
    }
  });
}

function pagerHtml(total, pages){
  if(total <= PAGE_SIZE) return '';
  function btn(label, to, disabled){
    return '<button onclick="MediaLibrary.setPage(' + to + ')" ' + (disabled ? 'disabled ' : '') +
      'class="px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-xs ' +
      (disabled ? 'text-gray-300' : 'text-blue-600') + '">' + label + '</button>';
  }
  return '<div id="ml-pager" class="px-4 mt-3 flex items-center justify-center gap-2">' +
    btn('上一页', _page - 1, _page <= 0) +
    '<span class="text-xs text-gray-500">' + (_page + 1) + ' / ' + pages + '</span>' +
    btn('下一页', _page + 1, _page >= pages - 1) +
    '</div>';
}

/* 当前筛选/搜索/车型收窄后的完整列表(分页与总数都以此为准) */
function filteredAssets(){
  let list = _filter === 'broken' ? brokenRows(_data) : filterAssets(allAssets(), _filter, _query);
  if(_vehicleFocus){
    list = list.filter(function(a){
      return (a.vehicles || []).some(function(x){ return x && String(x.id) === String(_vehicleFocus.id); });
    });
  }
  return list;
}

/* 计数 + 列表 + 分页; 搜索时只重画这一段, 避免整页重建导致输入框失焦 */
function listBlockHtml(){
  /* 「断链」是纯派生的诊断行(无主目录/改名失配/无素材), 不参与媒体分页索引 */
  const shown = filteredAssets();
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  if(_page < 0) _page = 0;
  if(_page > pages - 1) _page = pages - 1;
  const cap = shown.slice(_page * PAGE_SIZE, _page * PAGE_SIZE + PAGE_SIZE);
  const empty = !cap.length
    ? '<div class="text-center text-sm text-gray-400 py-8">' +
      (_vehicleFocus
        ? '这台车还没有媒体资产（可在资源库上传，或补拍后重新生成索引）'
        : '没有匹配的资产' + (_query ? '（关键字：' + esc(_query) + '）' : '')) +
      '</div>'
    : '';
  return '' +
    '<div id="ml-count" class="px-4 mt-2 text-[11px] text-gray-400">' +
      '共 ' + shown.length + ' 项' +
      (shown.length > PAGE_SIZE ? ' · 第 ' + (_page + 1) + '/' + pages + ' 页' : '') +
      ' · 索引生成 ' + esc(((_data && _data.generatedAt) || '').replace('T', ' ').slice(0, 16)) +
    '</div>' +
    '<div class="px-4 mt-2 space-y-2" id="ml-list">' + (cap.map(rowHtml).join('') || empty) + '</div>' +
    pagerHtml(shown.length, pages);
}

function bodyHtml(){
  if(_error){
    return '<div class="mx-4 mt-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm">' + esc(_error) +
      '<button onclick="MediaLibrary.refresh(true)" class="ml-2 underline">重试</button></div>';
  }
  if(_trashMode) return trashHtml();
  if(!_data){
    return '<div class="mx-4 mt-6 text-center text-sm text-gray-400">' + (_loading ? '正在加载资源索引…' : '点击刷新加载') + '</div>';
  }
  const st = statsOf(allAssets(), []);
  const broken = brokenRows(_data);
  st.broken = broken.length;

  const statCards = [
    ['资产', st.total, 'text-gray-800'],
    ['照片', st.photos, 'text-blue-600'],
    ['视频', st.videos, 'text-indigo-600'],
    ['缺失', st.missing, st.missing ? 'text-red-600' : 'text-gray-400'],
    ['共享', st.shared, 'text-amber-600']
  ].map(function(x){
    return '<div class="flex-1 bg-white rounded-xl px-2 py-2 text-center">' +
      '<div class="text-lg font-bold ' + x[2] + '">' + x[1] + '</div>' +
      '<div class="text-[10px] text-gray-400 mt-0.5">' + x[0] + '</div></div>';
  }).join('');

  return '' +
    '<div class="px-4 mt-2 flex gap-2">' + statCards + '</div>' +
    (broken.length
      ? '<div class="px-4 mt-2"><button onclick="MediaLibrary.setFilter(&quot;broken&quot;)" ' +
        'class="w-full text-left px-3 py-2 rounded-xl bg-amber-50 text-amber-800 text-xs leading-relaxed">' +
        '⚑ 车型与资源有 ' + broken.length + ' 处对不上：' +
        (broken.filter(function(x){ return x.status === 'nomedia'; }).length) + ' 台无素材 · ' +
        (broken.filter(function(x){ return x.status === 'unowned'; }).length) + ' 个无主目录 · ' +
        (broken.filter(function(x){ return x.status === 'renamed'; }).length) + ' 条改名失配' +
        ((_data.stats && _data.stats.lowRes) ? ' · 低清 ' + _data.stats.lowRes + ' 项' : '') +
        '<span class="underline ml-1">点此查看</span></button></div>'
      : '') +
    '<div class="px-4 mt-3 flex gap-2">' +
      '<input id="ml-search" value="' + esc(_query) + '" placeholder="搜索车型 / 文件名" ' +
        'oninput="MediaLibrary.setQuery(this.value)" ' +
        'class="flex-1 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm outline-none">' +
      '<button onclick="MediaLibrary.exportMissing()" class="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs text-gray-600">复制缺失清单</button>' +
    '</div>' +
    (_vehicleFocus
      ? '<div class="px-4 mt-2"><button onclick="MediaLibrary.clearVehicleFocus()" ' +
        'class="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px]">只看车型：' +
        esc(_vehicleFocus.display) + ' ×</button></div>'
      : '') +
    '<div class="px-4 mt-2 flex gap-2 overflow-x-auto pb-1">' + FILTERS.map(function(f){ return chipHtml(f, st); }).join('') + '</div>' +
    '<div class="px-4 mt-2 text-[11px] ' + (_cloudErr ? 'text-red-500' : 'text-gray-400') + '">' +
      (_cloudErr ? esc(_cloudErr)
        : (_cloud
            ? '云端实测：照片 ' + _cloud.photos + ' · 视频 ' + _cloud.videos + ' · 无台账 ' +
              (_cloud.orphans || []).filter(function(a){ return a && !isTrashed(a.path) && !isPurged(a.path); }).length +
              ' · ' + new Date(_cloud.at).toTimeString().slice(0, 5)
            : '台账为仓库索引快照，可能滞后；点右上「核对云端」与飞书实际文件对账')) +
    '</div>' +
    '<div id="ml-body">' + listBlockHtml() + '</div>' +
    '<div class="pb-6"></div>';
}

function render(){
  const el = document.getElementById('screen-media-library');
  if(!el) return;
  el.innerHTML = '' +
    /* 头部固定; 正文放进 .scroll-y flex-1 —— .screen 是 flex 列容器(overflow:hidden),
     * 直接子项默认 flex-shrink:1, 带 overflow 的行会被压塌(实测筛选条高度 4px)。 */
    '<div class="pt-12 px-4 pb-3 flex items-center gap-3 shrink-0 bg-gray-50">' +
      '<button onclick="showScreen(\'screen-my\')" class="w-8 h-8 flex items-center justify-center">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>' +
      '<div class="flex-1"><h2 class="text-base font-bold">资源库</h2>' +
        '<p class="text-[11px] text-gray-400 mt-0.5">车型照片 · 视频 · 缺失与共享台账</p></div>' +
      '<button onclick="MediaLibrary.checkCloud()" class="px-2 py-1 text-xs text-emerald-600">' + (_cloudBusy ? '核对中…' : '核对云端') + '</button>' +
      (_canEdit() ? '<button onclick="MediaLibrary.uploadFlow()" class="px-2 py-1 text-xs text-blue-600">上传</button>' : '') +
      '<button onclick="MediaLibrary.toggleTrash()" class="px-2 py-1 text-xs ' +
        (_trashMode ? 'text-amber-600 font-medium' : 'text-gray-500') + '">回收站' +
        (trashCount() ? (' ' + trashCount()) : '') + '</button>' +
      '<button onclick="MediaLibrary.refresh(true)" class="px-2 py-1 text-xs text-blue-600">刷新</button>' +
    '</div>' +
    '<div class="flex-1 scroll-y min-h-0 pb-24">' + bodyHtml() + '</div>';
  /* 详情页跳转过来时, 把目标行滚到视口中间(高亮已在 rowHtml 里) */
  if(_focusPath) setTimeout(_scrollToFocus, 0);
}

/* ---------------- 预览弹层 ---------------- */

function ensurePreview(){
  let el = document.getElementById('ml-preview');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'ml-preview';
  el.className = 'modal-overlay';
  el.innerHTML = '<div class="modal-sheet" style="max-height:86vh">' +
    '<div class="flex items-center justify-between px-4 py-3 border-b border-gray-100">' +
      '<div class="text-sm font-medium" id="ml-preview-title">预览</div>' +
      '<button onclick="MediaLibrary.closePreview()" class="text-gray-400 text-xl leading-none">×</button>' +
    '</div>' +
    '<div id="ml-preview-body" class="p-3 overflow-auto"></div>' +
    '</div>';
  el.addEventListener('click', function(e){ if(e.target === el) closePreview(); });
  document.body.appendChild(el);
  return el;
}

function preview(path){
  if(!_data) return;
  // 索引 + 车型实时引用 + 云端孤儿: 车型侧刚加/刚换的「新增」行也要能预览(此前只查静态索引会点不开)
  const all = allAssets();
  const a = all.find(function(x){ return x.path === path; });
  if(!a) return;
  _current = a;
  const cf = _cloud && _cloud.byPath && _cloud.byPath[a.path];
  const el = ensurePreview();
  document.getElementById('ml-preview-title').textContent = a.kindLabel + ' · ' + (STATUS_META[a.status] || {}).label;
  // 媒体是车型信息的补充: 文件缺失时给出明确占位, 不阻断预览面板的其他操作
  const _mediaFallback = function(what){
    return '<div style="display:none" class="text-center text-sm text-gray-500 py-8">' + what + '</div>';
  };
  const media = a.kind === 'video'
    ? (a.status === 'remote'
        ? '<div class="text-center text-sm text-gray-500 py-8">该视频在 Release/CDN（' + esc(a.path) + '），App 内播放走云端直链</div>'
        : '<video src="' + esc(a.path) + '" controls playsinline class="w-full rounded-lg bg-black" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'"></video>' +
          _mediaFallback('视频无法加载（本地文件缺失，可在「核对云端」后从云端加载）'))
    : (a.status === 'missing' || a.status === 'orphan'
        ? '<div class="text-center text-sm text-gray-500 py-8">' +
            (a.status === 'missing' ? '台账标记缺失' : '未归类孤儿') +
            (cf ? '，但云端实测存在该文件' : '，本地与云端均无此文件（需补拍/补传）') + '</div>'
        : '<img src="' + esc(a.path) + '" class="w-full rounded-lg" alt="" ' +
          'onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'block\'">' +
          _mediaFallback('图片无法加载（本地与云端均缺失，车型信息本身不受影响）'));
  document.getElementById('ml-preview-body').innerHTML = media +
    '<div class="mt-3 text-xs text-gray-500 space-y-1">' +
      '<div>车型：' + esc(a.vehicleText || '—') + '</div>' +
      '<div class="break-all">路径：' + esc(a.path) + '</div>' +
      '<div>云端：' + (cf ? ('存在' + (cf.size ? ' · ' + humanSize(cf.size) : '')) : (_cloud ? '不存在' : '未核对')) + '</div>' +
      (a.sizeText ? '<div>大小：' + esc(a.sizeText) + '</div>' : '') +
      '<div>指纹：' + (a.sha256 ? '已记录' : '未记录（无法证明内容一致）') + '</div>' +
    '</div>' +
    '<div class="mt-3 flex gap-2">' +
      '<button onclick="MediaLibrary.copyPath()" class="flex-1 py-2 rounded-xl bg-gray-100 text-sm text-gray-700">复制路径</button>' +
      (cf && (a.status === 'missing' || a.status === 'orphan')
        ? '<button onclick="MediaLibrary.loadCloudPreview(\'' + esc(a.path) + '\')" class="flex-1 py-2 rounded-xl bg-emerald-50 text-sm text-emerald-700">云端加载</button>'
        : '') +
      (a.vehicles && a.vehicles.length === 1
        ? '<button onclick="MediaLibrary.openVehicle(' + a.vehicles[0].id + ')" class="flex-1 py-2 rounded-xl bg-blue-50 text-sm text-blue-600">打开车型</button>'
        : '') +
    '</div>' +
    (cf && _canEdit()
      ? '<div class="mt-2"><button onclick="MediaLibrary.deleteCloud(\'' + esc(a.path) + '\')" ' +
        'class="w-full py-2 rounded-xl bg-red-50 text-sm text-red-600">删除云端文件（并解除引用）</button></div>'
      : '');
  el.classList.add('show');
}

function closePreview(){
  const el = document.getElementById('ml-preview');
  if(el) el.classList.remove('show');
  _current = null;
}

/* ---------------- 数据加载 ---------------- */

/* V10.26.0 修复: App 内(https://localhost / app:// / file://)读不到索引。
 *   根因1: fetch 在 file://(iOS app://) 协议下不可用;
 *   根因2: 旧打包脚本没把 media_library.json 拷进 www。
 * 兜底顺序: fetch → XHR(兼容 Cordova 自定义协议) → 线上 Pages 索引(需联网一次)。 */
const REMOTE_INDEX_URL = 'https://361087210.github.io/taicanggang-poweroff-guide/media_library.json';

function _parseJson(txt){
  try { return JSON.parse(txt); } catch(e){ throw new Error('索引格式异常'); }
}

function _fetchJson(url){
  return fetch(url, { cache: 'no-store' }).then(function(r){
    if(!r || !r.ok) throw new Error('HTTP ' + (r && r.status));
    return r.json();
  });
}

function _xhrJson(url){
  return new Promise(function(resolve, reject){
    const Xhr = (typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest) ||
      (typeof window !== 'undefined' && window.XMLHttpRequest);
    if(!Xhr){ reject(new Error('XMLHttpRequest 不可用')); return; }
    const xhr = new Xhr();
    xhr.open('GET', url, true);
    xhr.onload = function(){
      if(xhr.status && (xhr.status < 200 || xhr.status >= 300)){ reject(new Error('HTTP ' + xhr.status)); return; }
      try { resolve(_parseJson(xhr.responseText)); } catch(e){ reject(e); }
    };
    xhr.onerror = function(){ reject(new Error('读取失败')); };
    xhr.send();
  });
}

function _remoteJson(){
  const url = REMOTE_INDEX_URL + '?v=' + Date.now();
  if(typeof httpFetch === 'function'){
    try { return Promise.resolve(httpFetch(url)); } catch(e){ return Promise.reject(e); }
  }
  return _fetchJson(url);
}

function loadIndex(){
  return _fetchJson(INDEX_URL + '?v=' + Date.now())
    .catch(function(){ return _xhrJson(INDEX_URL); })
    .catch(function(){ return _remoteJson(); });
}

/**
 * 索引加载(去重): 详情页装饰与台账页共用同一份索引, 不允许并发重复拉取。
 * @param {boolean} refetch 为 true 时强制重取(台账页「刷新」用)
 */
function ensureIndex(refetch){
  if(_data && !refetch) return Promise.resolve(_data);
  if(_indexPromise) return _indexPromise;
  _indexPromise = loadIndex()
    .then(function(j){
      if(!j || !Array.isArray(j.assets)) throw new Error('索引格式异常');
      _data = j; _indexPromise = null; return _data;
    }, function(e){
      _indexPromise = null; throw e;
    });
  return _indexPromise;
}

function refresh(force){
  if(_loading) return;
  if(_data && !force){ render(); return; }
  _loading = true; _error = '';
  render();
  ensureIndex(!!force)
    .then(function(){ _loading = false; render(); })
    .catch(function(e){
      _loading = false;
      _error = '资源索引加载失败：' + (e && e.message || e) + '（App 内本地索引缺失时会尝试线上索引，需联网一次）';
      render();
    });
}

/* 交互 */

function setFilter(id){
  _filter = FILTERS.some(function(f){ return f.id === id; }) ? id : 'all';
  _page = 0;
  _focusPath = '';
  render();
}

function setPage(n){
  const shown = filteredAssets();
  const pages = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const p = Math.max(0, Math.min(pages - 1, parseInt(n, 10) || 0));
  if(p === _page) return;
  _page = p;
  _focusPath = '';
  render();
}

function setQuery(q){
  _query = String(q || '');
  _page = 0;
  _focusPath = '';
  const body = document.getElementById('ml-body');
  if(!_data || !body){ render(); return; }
  /* 只重画计数/列表/分页, 避免输入时整页重建导致输入框失焦 */
  body.innerHTML = listBlockHtml();
}

function copyText(text){
  if(navigator.clipboard && navigator.clipboard.writeText){
    return navigator.clipboard.writeText(text);
  }
  const ta = document.createElement('textarea');
  ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); } finally { document.body.removeChild(ta); }
  return Promise.resolve();
}

function copyPath(){
  if(!_current) return;
  copyText(_current.path).then(function(){
    if(typeof showToast === 'function') showToast('路径已复制');
  });
}

function exportMissing(){
  if(!_data) return;
  const text = missingListText((_data.assets || []).concat([]));
  if(text.split('\n').length <= 1){
    if(typeof showToast === 'function') showToast('没有缺失项');
    return;
  }
  copyText(text).then(function(){
    if(typeof showToast === 'function') showToast('缺失清单已复制（' + (text.split('\n').length - 1) + ' 条）');
  });
}

function openVehicle(id){
  closePreview();
  try {
    if(typeof showScreen === 'function') showScreen('screen-detail');
    if(typeof renderVehicleDetail === 'function') renderVehicleDetail(id);
    else if(typeof openVehicleDetail === 'function') openVehicleDetail(id);
  } catch(e){ console.warn('[资源库] 打开车型失败:', e && e.message); }
}

/* 页面进入时按需加载(showScreen 只加 class, 这里监听点击入口更稳) */
function open(){
  /* 从菜单进入 = 看全量台账, 清掉车型/资产定位的临时收窄 */
  _vehicleFocus = null;
  _focusPath = '';
  _page = 0;
  if(typeof showScreen === 'function') showScreen('screen-media-library');
  refresh(false);
}

window.MediaLibrary = {
  open: open,
  refresh: refresh,
  setFilter: setFilter,
  setQuery: setQuery,
  preview: preview,
  closePreview: closePreview,
  copyPath: copyPath,
  exportMissing: exportMissing,
  openVehicle: openVehicle,
  /* V10.27.3 车型详情 ↔ 资源库双向联动 */
  openForVehicle: openForVehicle,
  openPath: openPath,
  clearVehicleFocus: clearVehicleFocus,
  decorateVehicleMedia: decorateVehicleMedia,
  vehicleSummary: vehicleSummary,
  /* V10.26.0 云端实测与资源管理 */
  loadIndex: loadIndex,
  checkCloud: checkCloud,
  uploadFlow: uploadFlow,
  onUploadFiles: onUploadFiles,
  deleteCloud: deleteCloud,
  /* V10.28.0 回收站: 删除可恢复 */
  toggleTrash: toggleTrash,
  restoreFromTrash: restoreFromTrash,
  purgeFromTrash: purgeFromTrash,
  trashVehicleMedia: trashVehicleMedia,
  trashCount: trashCount,
  trashEntries: trashEntries,
  isTrashed: isTrashed,
  moveToTrash: moveToTrash,
  loadCloudPreview: loadCloudPreview,
  setPage: setPage,
  /* V10.28.2 媒体登记表(运行时单一真源) */
  registryRows: registryRows,
  registryRow: registryRow,
  registryMerge: registryMerge,
  registryAdd: registryAdd,
  registryTombstone: registryTombstone,
  registryRestore: registryRestore,
  registryPurge: registryPurge,
  registryAssets: registryAssets,
  mediaPathsFor: mediaPathsFor,
  mediaMetaFor: mediaMetaFor,
  mediaRegistrySync: mediaRegistrySync,
  mediaRegistryPull: mediaRegistryPull,
  /* 纯函数: 供单测直接引用 */
  filterAssets: filterAssets,
  statsOf: statsOf,
  humanSize: humanSize,
  missingListText: missingListText,
  liveAssetsOf: liveAssetsOf,
  mergeAssets: mergeAssets,
  mediaPatchOf: mediaPatchOf,
  unlinkPathOf: unlinkPathOf,
  brokenRows: brokenRows
};

})();
