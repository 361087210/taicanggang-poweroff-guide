/* ===========================================================
 * 模块: 13-media-library.js — 资源库(车型照片/视频统一台账) V10.25.7
 * ===========================================================
 * 解决什么: 照片/视频散在 vehicle_images/<车型目录>/、_共享/、_未归类/ 与
 *   GitHub Release 四处, 组长只能靠"翻车型详情"或跑脚本才知道缺什么。
 *   本模块把 docs/media_library.json(由 scripts/gen_media_library.js 生成)渲染成
 *   一页可搜索/可筛选/可预览/可导出缺失清单的台账, 且**离线可用**(索引随仓库发布)。
 *
 * 数据契约(docs/media_library.json):
 *   { stats:{...}, assets:[{path,kind,kindLabel,status,sizeText,vehicleText,missingFor?}],
 *     orphans:[{path,status:'orphan',...}] }
 *   status: ok 正常 / shared 共享 / unfiled 未归类引用 / remote 云端视频 / missing 缺失 / orphan 孤儿
 *
 * 依赖: 无(只读 fetch 本地 JSON + 现有的 showToast)
 * 页面: #screen-media-library (demo.html 内为空容器, 由本模块渲染)
 * =========================================================== */
(function(){
'use strict';

const INDEX_URL = 'docs/media_library.json';
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
  const title = a.kind === 'video' ? a.path.split('/').pop() : (a.vehicleText || a.path);
  return '<div class="flex items-center gap-3 p-2 bg-white rounded-xl active:bg-gray-50" ' +
    'data-ml-key="' + esc(a.path) + '">' +
      thumbHtml(a) +
      '<div class="min-w-0 flex-1">' +
        '<div class="text-sm text-gray-800 truncate">' + esc(title) + '</div>' +
        '<div class="text-xs text-gray-400 truncate mt-0.5">' + esc(a.vehicleText || a.path) + '</div>' +
        '<div class="flex items-center gap-1.5 mt-1">' +
          '<span class="px-1.5 py-0.5 rounded text-[10px] ' + st.cls + '">' + esc(st.label) + '</span>' +
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
  const st = statsOf(_data.assets, _data.orphans);
  const all = (_data.assets || []).concat(_data.orphans || []);
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
    '<div class="px-4 mt-2 text-[11px] text-gray-400">' +
      '共 ' + shown.length + ' 项' + (shown.length > cap.length ? '（显示前 ' + cap.length + ' 项，请用筛选收窄）' : '') +
      ' · 索引生成 ' + esc((_data.generatedAt || '').replace('T', ' ').slice(0, 16)) +
    '</div>' +
    '<div class="px-4 mt-2 space-y-2 pb-28" id="ml-list">' + (cap.map(rowHtml).join('') || empty) + '</div>';
}

function render(){
  const el = document.getElementById('screen-media-library');
  if(!el) return;
  el.innerHTML = '' +
    '<div class="pt-12 px-4 pb-3 flex items-center gap-3 sticky top-0 bg-gray-50 z-10">' +
      '<button onclick="showScreen(\'screen-my\')" class="w-8 h-8 flex items-center justify-center">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>' +
      '</button>' +
      '<div class="flex-1"><h2 class="text-base font-bold">资源库</h2>' +
        '<p class="text-[11px] text-gray-400 mt-0.5">车型照片 · 视频 · 缺失与共享台账</p></div>' +
      '<button onclick="MediaLibrary.refresh(true)" class="px-2 py-1 text-xs text-blue-600">刷新</button>' +
    '</div>' + bodyHtml();
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
  const all = (_data.assets || []).concat(_data.orphans || []);
  const a = all.find(function(x){ return x.path === path; });
  if(!a) return;
  _current = a;
  const el = ensurePreview();
  document.getElementById('ml-preview-title').textContent = a.kindLabel + ' · ' + (STATUS_META[a.status] || {}).label;
  const media = a.kind === 'video'
    ? (a.status === 'remote'
        ? '<div class="text-center text-sm text-gray-500 py-8">该视频在 Release/CDN（' + esc(a.path) + '），App 内播放走云端直链</div>'
        : '<video src="' + esc(a.path) + '" controls playsinline class="w-full rounded-lg bg-black"></video>')
    : (a.status === 'missing' || a.status === 'orphan'
        ? '<div class="text-center text-sm text-gray-500 py-8">本地没有这个文件（' + esc(a.status === 'missing' ? '需补拍/补传' : '未归类孤儿') + '）</div>'
        : '<img src="' + esc(a.path) + '" class="w-full rounded-lg" alt="">');
  document.getElementById('ml-preview-body').innerHTML = media +
    '<div class="mt-3 text-xs text-gray-500 space-y-1">' +
      '<div>车型：' + esc(a.vehicleText || '—') + '</div>' +
      '<div class="break-all">路径：' + esc(a.path) + '</div>' +
      (a.sizeText ? '<div>大小：' + esc(a.sizeText) + '</div>' : '') +
      '<div>指纹：' + (a.sha256 ? '已记录' : '未记录（无法证明内容一致）') + '</div>' +
    '</div>' +
    '<div class="mt-3 flex gap-2">' +
      '<button onclick="MediaLibrary.copyPath()" class="flex-1 py-2 rounded-xl bg-gray-100 text-sm text-gray-700">复制路径</button>' +
      (a.vehicles && a.vehicles.length === 1
        ? '<button onclick="MediaLibrary.openVehicle(' + a.vehicles[0].id + ')" class="flex-1 py-2 rounded-xl bg-blue-50 text-sm text-blue-600">打开车型</button>'
        : '') +
    '</div>';
  el.classList.add('show');
}

function closePreview(){
  const el = document.getElementById('ml-preview');
  if(el) el.classList.remove('show');
  _current = null;
}

/* ---------------- 数据加载 ---------------- */

function refresh(force){
  if(_loading) return;
  if(_data && !force){ render(); return; }
  _loading = true; _error = '';
  render();
  const url = INDEX_URL + '?v=' + Date.now();
  fetch(url, { cache: 'no-store' })
    .then(function(r){ if(!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(function(j){
      if(!j || !Array.isArray(j.assets)) throw new Error('索引格式异常');
      _data = j; _loading = false; render();
    })
    .catch(function(e){
      _loading = false;
      _error = '资源索引加载失败：' + (e && e.message || e) + '（离线时首次打开需联网一次）';
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
  /* 纯函数: 供单测直接引用 */
  filterAssets: filterAssets,
  statsOf: statsOf,
  humanSize: humanSize,
  missingListText: missingListText
};

})();
