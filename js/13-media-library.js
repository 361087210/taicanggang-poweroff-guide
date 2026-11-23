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
const PAGE_LIMIT = 400;          // 单次渲染上限(超出用筛选收窄, 防一次性建 DOM 卡顿)
const STATUS_META = {
  missing: { label: '缺失', cls: 'bg-red-50 text-red-600' },
  shared:  { label: '共享', cls: 'bg-amber-50 text-amber-700' },
  unfiled: { label: '未归类', cls: 'bg-violet-50 text-violet-700' },
  remote:  { label: '云端', cls: 'bg-blue-50 text-blue-600' },
  ok:      { label: '正常', cls: 'bg-green-50 text-green-700' },
  orphan:  { label: '孤儿', cls: 'bg-gray-100 text-gray-600' }
};
const FILTERS = [
  { id: 'all',     label: '全部' },
  { id: 'missing', label: '缺失' },
  { id: 'shared',  label: '共享' },
  { id: 'remote',  label: '云端视频' },
  { id: 'orphan',  label: '未归类/孤儿' },
  { id: 'photo',   label: '照片' },
  { id: 'video',   label: '视频' }
];

let _data = null;         // 最近一次加载的索引
let _loading = false;
let _error = '';
let _filter = 'all';
let _query = '';
let _current = null;      // 预览中的资产

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
    if(filter === 'remote' && a.status !== 'remote') return false;
    if(filter === 'orphan' && a.status !== 'orphan') return false;
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
    unfiled: by.unfiled || 0,
    remote: by.remote || 0,
    missing: by.missing || 0,
    orphan: by.orphan || 0
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
    const all = _data ? (_data.assets || []).concat(_data.orphans || []) : [];
    all.forEach(function(a){
      if(a && _isMediaPath(a.path)) a.cloudState = byPath[a.path] ? 'present' : 'absent';
    });
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
          '<span class="text-[10px] text-gray-400 ml-2">' + ((v.photoPaths || []).length) + ' 照片 / ' +
          ((v.videoPaths || []).length) + ' 视频</span></button>';
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
  let ok = 0, fail = 0;
  try{
    const token = await window.FeishuAPI.getTenantToken();
    const root = await _dataRoot(token);
    if(!root) throw new Error('数据文件夹不可用');
    const MP = _mp();
    const folderName = (MP && typeof MP.folderNameForVehicle === 'function')
      ? MP.folderNameForVehicle(v) : _safeBase(v.display);
    for(const file of files){
      const isVideo = /^video\//.test(file.type || '') || /\.(mp4|mov|m4v|webm|avi|mkv)$/i.test(file.name || '');
      const topName = isVideo ? 'vehicle_videos' : 'vehicle_images';
      try{
        const topToken = await _ensureFolder(token, root, topName);
        const dirToken = await _ensureFolder(token, topToken, folderName);
        const key = isVideo ? 'videoPaths' : 'photoPaths';
        const seq = (v[key] || []).length + 1;
        const ext = (/\.([a-z0-9]+)$/i.exec(file.name || '') || [])[1];
        const fileName = _safeBase(v.display) + (isVideo ? '_v' : '_p') + seq + '_' +
          _quickHash(file.name + ':' + file.size + ':' + Date.now()) + '.' +
          (ext ? ext.toLowerCase() : (isVideo ? 'mp4' : 'jpg'));
        const res = await httpUploadFileSmart({ token: token, fileName: fileName, folderToken: dirToken, blob: file });
        if(!res || res.code !== 0) throw new Error((res && res.msg) || '飞书拒绝上传');
        const rel = (MP && typeof MP.photoRelPath === 'function')
          ? (isVideo ? MP.videoRelPath(folderName, fileName) : MP.photoRelPath(folderName, fileName))
          : topName + '/' + folderName + '/' + fileName;
        const cur = (v[key] || []).slice();
        cur.push(rel);
        v[key] = cur;
        if(typeof State !== 'undefined' && State && typeof State.updateVehicle === 'function'){
          const patch = {};
          patch[key] = cur;
          State.updateVehicle(v.id, patch);
        }else if(typeof persistVehicles === 'function') persistVehicles();
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
  _toast(ok ? ('上传完成 ' + ok + ' 个' + (fail ? '，失败 ' + fail + ' 个' : '')) : '上传失败');
  render();
}

function deleteCloud(path){
  if(!_canEdit()){ _toast('仅组长可删除云端资源'); return; }
  const cf = _cloud && _cloud.byPath && _cloud.byPath[path];
  if(!cf || !cf.token){ _toast('未找到云端文件，请先点「核对云端」'); return; }
  const doDelete = async function(){
    try{
      await window.FeishuAPI.driveDeleteFile(cf.token);
      _vehicles().forEach(function(v){
        let changed = false;
        ['photoPaths', 'videoPaths'].forEach(function(k){
          const arr = v[k] || [];
          const next = arr.filter(function(p){ return p !== path; });
          if(next.length !== arr.length){ v[k] = next; changed = true; }
        });
        if(changed && typeof State !== 'undefined' && State && typeof State.updateVehicle === 'function'){
          State.updateVehicle(v.id, { photoPaths: v.photoPaths, videoPaths: v.videoPaths });
        }
      });
      if(_data){
        _data.assets = (_data.assets || []).filter(function(a){ return a.path !== path; });
        _data.orphans = (_data.orphans || []).filter(function(a){ return a.path !== path; });
      }
      if(_cloud){
        _cloud.orphans = (_cloud.orphans || []).filter(function(a){ return a.path !== path; });
        delete _cloud.byPath[path];
        const sp = _splitPath(path);
        if(sp && sp.top === 'vehicle_videos') _cloud.videos = Math.max(0, (_cloud.videos || 1) - 1);
        else _cloud.photos = Math.max(0, (_cloud.photos || 1) - 1);
      }
      closePreview();
      render();
      _toast('已删除云端文件并解除引用');
    }catch(e){
      _toast('删除失败: ' + ((e && e.message) || e));
    }
  };
  if(typeof showConfirm === 'function'){
    showConfirm('删除云端文件', '将删除「' + cf.name + '」并解除所有车型引用，不可恢复。', doDelete);
  }else if(window.confirm && window.confirm('确认删除「' + cf.name + '」？')){
    doDelete();
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
  /* 标题用**文件名**(照片行的"车型名"已在下行显示, 旧版会连写两遍同样的字) */
  const title = a.path.split('/').pop();
  return '<div class="flex items-center gap-3 p-2 bg-white rounded-xl active:bg-gray-50" ' +
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
        '</div>' +
      '</div>' +
      '<button onclick="event.stopPropagation();MediaLibrary.preview(\'' + esc(a.path) + '\')" ' +
        'class="px-2 py-1 text-xs text-blue-600 shrink-0">查看</button>' +
    '</div>';
}

function bodyHtml(){
  if(_error){
    return '<div class="mx-4 mt-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm">' + esc(_error) +
      '<button onclick="MediaLibrary.refresh(true)" class="ml-2 underline">重试</button></div>';
  }
  if(!_data){
    return '<div class="mx-4 mt-6 text-center text-sm text-gray-400">' + (_loading ? '正在加载资源索引…' : '点击刷新加载') + '</div>';
  }
  const st = statsOf(_data.assets, _data.orphans.concat(_cloud ? _cloud.orphans : []));
  const all = (_data.assets || []).concat(_data.orphans || []).concat(_cloud ? _cloud.orphans : []);
  const shown = filterAssets(all, _filter, _query);
  const cap = shown.slice(0, PAGE_LIMIT);

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

  const empty = !cap.length
    ? '<div class="text-center text-sm text-gray-400 py-8">没有匹配的资产' + (_query ? '（关键字：' + esc(_query) + '）' : '') + '</div>'
    : '';

  return '' +
    '<div class="px-4 mt-2 flex gap-2">' + statCards + '</div>' +
    '<div class="px-4 mt-3 flex gap-2">' +
      '<input id="ml-search" value="' + esc(_query) + '" placeholder="搜索车型 / 文件名" ' +
        'oninput="MediaLibrary.setQuery(this.value)" ' +
        'class="flex-1 px-3 py-2 rounded-xl bg-white border border-gray-200 text-sm outline-none">' +
      '<button onclick="MediaLibrary.exportMissing()" class="px-3 py-2 rounded-xl bg-white border border-gray-200 text-xs text-gray-600">复制缺失清单</button>' +
    '</div>' +
    '<div class="px-4 mt-2 flex gap-2 overflow-x-auto pb-1">' + FILTERS.map(function(f){ return chipHtml(f, st); }).join('') + '</div>' +
    '<div class="px-4 mt-2 text-[11px] ' + (_cloudErr ? 'text-red-500' : 'text-gray-400') + '">' +
      (_cloudErr ? esc(_cloudErr)
        : (_cloud
            ? '云端实测：照片 ' + _cloud.photos + ' · 视频 ' + _cloud.videos + ' · 无台账 ' + (_cloud.orphans || []).length +
              ' · ' + new Date(_cloud.at).toTimeString().slice(0, 5)
            : '台账为仓库索引快照，可能滞后；点右上「核对云端」与飞书实际文件对账')) +
    '</div>' +
    '<div class="px-4 mt-2 text-[11px] text-gray-400">' +
      '共 ' + shown.length + ' 项' + (shown.length > cap.length ? '（显示前 ' + cap.length + ' 项，请用筛选收窄）' : '') +
      ' · 索引生成 ' + esc((_data.generatedAt || '').replace('T', ' ').slice(0, 16)) +
    '</div>' +
    '<div class="px-4 mt-2 space-y-2 pb-6" id="ml-list">' + (cap.map(rowHtml).join('') || empty) + '</div>';
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
      '<button onclick="MediaLibrary.refresh(true)" class="px-2 py-1 text-xs text-blue-600">刷新</button>' +
    '</div>' +
    '<div class="flex-1 scroll-y min-h-0 pb-24">' + bodyHtml() + '</div>';
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
  const all = (_data.assets || []).concat(_data.orphans || []).concat(_cloud ? _cloud.orphans : []);
  const a = all.find(function(x){ return x.path === path; });
  if(!a) return;
  _current = a;
  const cf = _cloud && _cloud.byPath && _cloud.byPath[a.path];
  const el = ensurePreview();
  document.getElementById('ml-preview-title').textContent = a.kindLabel + ' · ' + (STATUS_META[a.status] || {}).label;
  const media = a.kind === 'video'
    ? (a.status === 'remote'
        ? '<div class="text-center text-sm text-gray-500 py-8">该视频在 Release/CDN（' + esc(a.path) + '），App 内播放走云端直链</div>'
        : '<video src="' + esc(a.path) + '" controls playsinline class="w-full rounded-lg bg-black"></video>')
    : (a.status === 'missing' || a.status === 'orphan'
        ? '<div class="text-center text-sm text-gray-500 py-8">' +
            (a.status === 'missing' ? '台账标记缺失' : '未归类孤儿') +
            (cf ? '，但云端实测存在该文件' : '，本地与云端均无此文件（需补拍/补传）') + '</div>'
        : '<img src="' + esc(a.path) + '" class="w-full rounded-lg" alt="">');
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

function refresh(force){
  if(_loading) return;
  if(_data && !force){ render(); return; }
  _loading = true; _error = '';
  render();
  loadIndex()
    .then(function(j){
      if(!j || !Array.isArray(j.assets)) throw new Error('索引格式异常');
      _data = j; _loading = false; render();
    })
    .catch(function(e){
      _loading = false;
      _error = '资源索引加载失败：' + (e && e.message || e) + '（App 内本地索引缺失时会尝试线上索引，需联网一次）';
      render();
    });
}

/* ---------------- 交互 ---------------- */

function setFilter(id){
  _filter = FILTERS.some(function(f){ return f.id === id; }) ? id : 'all';
  render();
}

function setQuery(q){
  _query = String(q || '');
  const list = document.getElementById('ml-list');
  if(!_data || !list){ render(); return; }
  /* 只重画列表, 避免输入时整页重建导致输入框失焦 */
  const all = (_data.assets || []).concat(_data.orphans || []);
  const shown = filterAssets(all, _filter, _query).slice(0, PAGE_LIMIT);
  list.innerHTML = shown.map(rowHtml).join('') ||
    '<div class="text-center text-sm text-gray-400 py-8">没有匹配的资产</div>';
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
  /* V10.26.0 云端实测与资源管理 */
  loadIndex: loadIndex,
  checkCloud: checkCloud,
  uploadFlow: uploadFlow,
  onUploadFiles: onUploadFiles,
  deleteCloud: deleteCloud,
  loadCloudPreview: loadCloudPreview,
  /* 纯函数: 供单测直接引用 */
  filterAssets: filterAssets,
  statsOf: statsOf,
  humanSize: humanSize,
  missingListText: missingListText
};

})();
