/* ===========================================================
 * 模块: 03-vehicles.js
 * 功能: renderBrandTags/搜索筛选/车辆列表渲染/详情/编辑/saveVehicle/分享/导出文本
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js
 * 源范围: demo.html L2124-L2929
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
function renderBrandTags(){
  const c=document.getElementById('brand-tags');
  let html=`<button onclick="setBrandFilter('all')" class="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${state.brandFilter==='all'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600'}">全部</button>`;
  // V10.9.2 性能优化: 一次遍历统计各品牌车辆数,替代 O(n*m) 嵌套filter
  const brandCount={};
  const knownIds=new Set(BRANDS.map(b=>b.id));
  let otherCount=0;
  VEHICLES.forEach(v=>{
    if(knownIds.has(v.brandId)){
      brandCount[v.brandId]=(brandCount[v.brandId]||0)+1;
    }else{
      otherCount++;
    }
  });
  BRANDS.forEach(b=>{
    const count=brandCount[b.id]||0;
    html+=`<button onclick="setBrandFilter('${b.id}')" class="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${state.brandFilter===b.id?'bg-blue-600 text-white':'bg-gray-100 text-gray-600'}">${b.name}(${count})</button>`;
  });
  if(otherCount>0){
    html+=`<button onclick="setBrandFilter('__other__')" class="px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap ${state.brandFilter==='__other__'?'bg-blue-600 text-white':'bg-gray-100 text-gray-600'}">其他(${otherCount})</button>`;
  }
  c.innerHTML=html;
}

function setBrandFilter(bid){state.brandFilter=bid;renderBrandTags();renderVehicleList();}

function setViewMode(mode){
  state.viewMode=mode;
  const btnBase='text-sm font-medium flex items-center gap-1 px-3 py-2 rounded-full ';
  document.getElementById('btn-tree').className=btnBase+(mode==='tree'?'text-blue-600 bg-blue-50':'text-gray-500');
  document.getElementById('btn-flat').className=btnBase+(mode==='flat'?'text-blue-600 bg-blue-50':'text-gray-500');
  renderVehicleList();
}

function getFilteredVehicles(){
  // A3渲染/业务分离: 过滤逻辑下沉到纯函数filterVehicles(可独立单测), 本函数仅做state桥接
  return filterVehicles(state.searchQuery,state.brandFilter);
}

/**
 * 纯数据过滤(无state/DOM依赖,可独立单测) — A3渲染/业务分离(V10.13)
 * @param {string} keyword 搜索词(空=不过滤; 命中display/pinyin/series/brand/position)
 * @param {string} brandId 'all'|'__other__'(自定义品牌兜底)|具体品牌id
 * @returns {Array} 过滤后的车辆数组(VEHICLES子集,与旧实现同为引用过滤)
 */
function filterVehicles(keyword,brandId){
  let list=VEHICLES;
  if(brandId==='__other__'){
    const knownIds=new Set(BRANDS.map(b=>b.id));
    list=list.filter(v=>!knownIds.has(v.brandId));
  }else if(brandId!=='all'){
    list=list.filter(v=>v.brandId===brandId);
  }
  if(keyword){
    const q=keyword.toLowerCase();
    list=list.filter(v=>v.display.toLowerCase().includes(q)||v.pinyin.toLowerCase().includes(q)||v.series.toLowerCase().includes(q)||v.brand.toLowerCase().includes(q)||v.position.toLowerCase().includes(q));
  }
  return list;
}

// V10.9.2 代码优化: 搜索防抖——避免每次按键全量重绘DOM,低端机也流畅
let searchDebounceTimer=null;
function handleSearch(){
  if(searchDebounceTimer)clearTimeout(searchDebounceTimer);
  searchDebounceTimer=setTimeout(()=>{
    state.searchQuery=document.getElementById('search-input').value.trim();
    renderVehicleList();
  },150);
}

function toggleSearchMode(){
  showScreen('screen-vehicles');
  document.getElementById('search-input').focus();
}

function renderVehicleList(){
  renderBrandTags();
  const list=getFilteredVehicles();
  document.getElementById('vehicle-count-label').textContent=`共${list.length}条`;
  // Recent section
  const rs=document.getElementById('recent-section');
  if(state.searchQuery||state.brandFilter!=='all'){rs.style.display='none';}else{rs.style.display='';const rl=document.getElementById('recent-list');rl.innerHTML=state.recentVehicles.map(id=>{const v=VEHICLES.find(x=>x.id===id);if(!v)return'';return`<div onclick="openVehicleDetail(${v.id})" class="bg-white rounded-xl p-2 shadow-sm border border-gray-100 flex-shrink-0" style="width:160px;"><div class="text-xs font-medium text-gray-900 truncate">${esc(v.display)}</div><div class="text-xs text-gray-400 mt-0.5 truncate">${esc(v.position)}</div></div>`;}).join('');}

  const c=document.getElementById('vehicle-list-container');
  if(list.length===0){c.innerHTML='<div class="text-center py-20 text-gray-400 text-sm">未找到匹配的车型</div>';return;}

  // A3渲染/业务分离: 过滤已在filterVehicles完成, 这里只委托纯DOM拼装
  c.innerHTML=renderVehicleCards(list);
}

/**
 * 纯DOM拼装(输入已过滤list,输出html字符串;无过滤/IO职责) — A3渲染/业务分离(V10.13)
 * 树形模式: 品牌×系列两级分组(V10.9.2一次遍历分组), 自定义品牌归入"其他品牌"兜底;
 * 平铺模式: 卡片流直出。展示态(viewMode/expandedBrands/brandFilter)从state读取。
 * @param {Array} list 已过滤的车辆数组(getFilteredVehicles产物)
 * @returns {string} html字符串
 */
function renderVehicleCards(list){
  if(state.viewMode!=='tree'){
    // Flat view
    return list.map((v,i)=>renderVehicleCard(v,i,'')).join('');
  }
  // Hierarchical view
  let html='';
  // V10.9.2 性能优化: 一次遍历按brandId+series两级分组,替代 O(n*m) 嵌套filter
  const brandMap={};
  const knownIds=new Set(BRANDS.map(b=>b.id));
  let otherVehicles=[];
  list.forEach(v=>{
    if(knownIds.has(v.brandId)){
      if(!brandMap[v.brandId])brandMap[v.brandId]={};
      if(!brandMap[v.brandId][v.series])brandMap[v.brandId][v.series]=[];
      brandMap[v.brandId][v.series].push(v);
    }else{
      otherVehicles.push(v);
    }
  });
  const brandsToShow=state.brandFilter==='all'?BRANDS:BRANDS.filter(b=>b.id===state.brandFilter);
  brandsToShow.forEach(b=>{
    const seriesMap=brandMap[b.id];
    if(!seriesMap)return;
    const brandCount=Object.values(seriesMap).reduce((s,a)=>s+a.length,0);
    const expanded=state.expandedBrands.has(b.id);
    html+=`<div class="mb-2">
      <div onclick="toggleBrand('${b.id}')" class="flex items-center justify-between py-2 px-1 cursor-pointer">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-400 transition-transform ${expanded?'rotate-90':''}"><path d="M9 6l6 6-6 6"/></svg>
          <span class="text-sm font-bold text-gray-900">${esc(b.name)}${b.en?'('+esc(b.en)+')':''}</span>
          ${b.note?`<span class="text-xs text-gray-300">— ${esc(b.note.substring(0,20))}${b.note.length>20?'...':''}</span>`:''}
        </div>
        <span class="text-xs text-gray-400">${brandCount}条</span>
      </div>`;
    if(expanded){
      Object.entries(seriesMap).forEach(([sName,svs])=>{
        html+=`<div class="ml-6 mb-1">
          <div class="flex items-center gap-2 py-1.5 px-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3 h-3 text-gray-300"><path d="M6 9l6 6 6-6"/></svg>
            <span class="text-xs font-medium text-gray-700">${esc(sName)}</span>
            <span class="text-xs text-gray-400">${svs.length}条</span>
          </div>`;
        svs.forEach((v,i)=>{
          html+=renderVehicleCard(v,i,'ml-12');
        });
        html+='</div>';
      });
    }
    html+='</div>';
  });
  // V10.9.2 问题1: 自定义品牌(brandId不在BRANDS中)的车辆归入"其他品牌"分组,
  // 确保新增车型在分级列表中也能显示,不会因为品牌未登记而"消失"
  if(otherVehicles.length>0&&(state.brandFilter==='all'||state.brandFilter==='__other__')){
    const expanded=state.expandedBrands.has('__other__');
    const series={};
    otherVehicles.forEach(v=>{if(!series[v.series])series[v.series]=[];series[v.series].push(v);});
    html+=`<div class="mb-2">
      <div onclick="toggleBrand('__other__')" class="flex items-center justify-between py-2 px-1 cursor-pointer">
        <div class="flex items-center gap-2">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-400 transition-transform ${expanded?'rotate-90':''}"><path d="M9 6l6 6-6 6"/></svg>
          <span class="text-sm font-bold text-gray-900">其他品牌</span>
          <span class="text-xs text-gray-300">— 自定义品牌</span>
        </div>
        <span class="text-xs text-gray-400">${otherVehicles.length}条</span>
      </div>`;
    if(expanded){
      Object.entries(series).forEach(([sName,svs])=>{
        html+=`<div class="ml-6 mb-1">
          <div class="flex items-center gap-2 py-1.5 px-1">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-3 h-3 text-gray-300"><path d="M6 9l6 6 6-6"/></svg>
            <span class="text-xs font-medium text-gray-700">${esc(sName)}</span>
            <span class="text-xs text-gray-400">${svs.length}条</span>
          </div>`;
        svs.forEach((v,i)=>{
          html+=renderVehicleCard(v,i,'ml-12');
        });
        html+='</div>';
      });
    }
    html+='</div>';
  }
  return html;
}

function renderVehicleCard(v,i,ml){
  const ptClass='pt-'+v.powerType;
  const statusClass=v.id%5===0?'status-done':'status-pending';
  const statusText=v.id%5===0?'已完成':'未开始';
  const hasPhoto=v.photoPaths&&v.photoPaths.length>0;
  // V10.12: 用户可编辑字段全部 esc(); 资源 src= 保持原文
  const thumbHtml=hasPhoto?`<div class="w-16 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100"><img src="${v.photoPaths[0]}" class="w-full h-full object-cover" alt="${esc(v.display)}" onerror="thumbImgError(this)"></div>`:'';
  return `<div onclick="openVehicleDetail(${v.id})" class="${ml} bg-white rounded-xl p-3 shadow-sm border border-gray-100 active:scale-98 transition-transform cursor-pointer mb-1.5 anim-up" style="animation-delay:${i*0.03}s">
    <div class="flex items-start gap-2">
      ${thumbHtml}
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span class="font-medium text-gray-900 text-sm truncate">${esc(v.display)}</span>
          <span class="text-xs px-1.5 py-0.5 rounded-full ${ptClass} flex-shrink-0">${esc(v.powerType)}</span>
        </div>
        <div class="text-xs text-gray-400 mt-0.5 truncate">${esc(v.position)}</div>
        <div class="flex items-center gap-1.5 mt-0.5">
          <span class="text-xs px-1.5 py-0.5 rounded-full ${statusClass}">${esc(statusText)}</span>
          <span class="text-xs text-gray-400">${v.steps.length}步${hasPhoto?` · ${v.photoPaths.length}张图`:''}</span>
        </div>
      </div>
    </div>
  </div>`;
}

function toggleBrand(bid){
  if(state.expandedBrands.has(bid))state.expandedBrands.delete(bid);
  else state.expandedBrands.add(bid);
  renderVehicleList();
}

// ===================== VEHICLE DETAIL =====================
// V10.15.3: 照片部位标示不再按数组下标硬编码猜测(第0张=前脸/第1张=车尾...),
// 改为优先读取车辆数据中的 photoLabels 配置;未配置时显示通用「照片N」,避免"胡乱标记"。
function _photoLabel(v,i){
  if(v&&v.photoLabels&&v.photoLabels[i])return v.photoLabels[i];
  return `照片 ${i+1}`;
}
function _renderVehicleDetail(id){
  const v=VEHICLES.find(x=>x.id===id);
  if(!v)return;
  state.currentVehicleId=id;
  state.currentVehicleIndex=VEHICLES.indexOf(v);
  if(!state.recentVehicles.includes(id)){state.recentVehicles.unshift(id);state.recentVehicles=state.recentVehicles.slice(0,5);}
  document.getElementById('detail-index').textContent=`${state.currentVehicleIndex+1}/${VEHICLES.length}`;
  const ptClass='pt-'+v.powerType;
  const photosHtml=(v.photoPaths&&v.photoPaths.length)?v.photoPaths.map((src,i)=>`<div onclick="openPhotoViewer(${i})" class="aspect-square rounded-xl overflow-hidden cursor-pointer relative bg-gray-100"><img src="${src}" class="w-full h-full object-cover" alt="车辆照片${i+1}" onerror="imgLoadError(this)"><span class="absolute bottom-1 left-1 text-xs text-white bg-black/50 px-1.5 rounded">${esc(_photoLabel(v,i))}</span></div>`).join(''):Array.from({length:v.photos},(_,i)=>`<div onclick="openPhotoViewer(${i})" class="aspect-square rounded-xl bg-gradient-to-br from-blue-100 to-indigo-100 flex items-center justify-center cursor-pointer relative"><svg viewBox="0 0 24 24" fill="none" stroke="#6366f1" stroke-width="1" class="w-8 h-8"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg><span class="absolute bottom-1 left-1 text-xs text-indigo-600 bg-white/70 px-1.5 rounded">${esc(_photoLabel(v,i))}</span></div>`).join('');
  // V10.14.2: 多视频支持——详情页视频区域从单视频改为多视频列表展示
  const videoPaths=v.videoPaths||[];
  const videoHtml=videoPaths.length?`
    <div class="space-y-2">
      ${videoPaths.map((vp,i)=>{
        const fn=vp.split('/').pop().replace(/\.[^.]+$/,'');
        const label=i===0?'断电教学视频':`补充视频${i}`;
        return `<div onclick="openVideoPlayer(${i})" class="aspect-video rounded-xl bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center cursor-pointer relative overflow-hidden">
          <video src="${esc(vp)}" preload="metadata" muted playsinline controlslist="nodownload" class="absolute inset-0 w-full h-full object-cover" onerror="this.style.display='none'"></video>
          <svg viewBox="0 0 24 24" fill="white" class="w-10 h-10 absolute drop-shadow"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>
          <span class="absolute bottom-2 left-2 text-xs text-white drop-shadow">${esc(label)}</span>
          ${videoPaths.length>1?`<span class="absolute top-2 right-2 text-xs text-white bg-black/50 px-1.5 rounded">${i+1}/${videoPaths.length}</span>`:''}
        </div>`;
      }).join('')}
    </div>
  `:`<div class="aspect-video rounded-xl bg-gray-100 flex items-center justify-center text-gray-400 text-sm">暂无视频</div>`;
  
  document.getElementById('detail-content').innerHTML=`
    <div class="px-4 pt-4">
      <div class="flex items-center gap-2 mb-2">
        <h2 class="text-lg font-bold text-gray-900">${esc(v.display)}</h2>
        <span class="text-xs px-2 py-0.5 rounded-full ${ptClass} font-medium">${esc(v.powerType)}</span>
      </div>
    </div>
    <!-- Info card -->
    <div class="px-4 mt-2"><div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="grid grid-cols-2 gap-3">
        <div><div class="text-xs text-gray-400">车辆尺寸</div><div class="text-sm font-medium text-gray-800 mt-0.5">${esc(v.size||'未填写')}</div></div>
        <div><div class="text-xs text-gray-400">动力类型</div><div class="text-sm font-medium text-gray-800 mt-0.5">${esc(v.powerType)}</div></div>
        <div><div class="text-xs text-gray-400">品牌/车系</div><div class="text-sm font-medium text-gray-800 mt-0.5">${esc(v.brand)} / ${esc(v.series)}</div></div>
        <div><div class="text-xs text-gray-400">配置</div><div class="text-sm font-medium text-gray-800 mt-0.5">${esc(v.config)}</div></div>
      </div>
    </div></div>
    <!-- Power off position -->
    <div class="px-4 mt-3"><div class="bg-blue-50 rounded-2xl p-4 border border-blue-100">
      <div class="flex items-center gap-2 mb-1"><svg viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" class="w-5 h-5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><span class="font-bold text-blue-900 text-sm">断电位置</span></div>
      <div class="text-sm text-blue-800">${esc(v.position)}</div>
    </div></div>
    <!-- Steps -->
    <div class="px-4 mt-3"><div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center justify-between mb-3"><div class="flex items-center gap-2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 text-gray-700"><path d="M9 11l3 3L22 4M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg><span class="font-bold text-gray-900 text-sm">断电步骤</span></div><span class="text-xs text-gray-400">已完成 0/${v.steps.length}</span></div>
      <div class="space-y-3">${v.steps.map((s,i)=>`<div class="flex items-start gap-3 anim-up" style="animation-delay:${i*0.06}s"><div class="step-circle">${i+1}</div><div class="text-sm text-gray-700 pt-1 flex-1">${esc(s)}</div></div>`).join('')}</div>
    </div></div>
    <!-- Key handling -->
    <div class="px-4 mt-3"><div class="bg-white rounded-2xl p-4 shadow-sm">
      <div class="flex items-center gap-2 mb-3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5 text-gray-700"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M14 12l8-8M16 6l4 4M19 3l4 4"/></svg><span class="font-bold text-gray-900 text-sm">钥匙处理方式</span></div>
      <div class="flex border-b border-gray-200 mb-3" id="key-tabs">
        <button onclick="switchKeyTab('frame')" id="ktab-frame" class="flex-1 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600">框架</button>
        <button onclick="switchKeyTab('container')" id="ktab-container" class="flex-1 py-2 text-sm font-medium border-b-2 border-transparent text-gray-400">集装箱</button>
      </div>
      <div id="key-frame-content" class="space-y-2">${v.keyFrame.map((s,i)=>`<div class="flex items-start gap-2"><div class="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">${i+1}</div><div class="text-sm text-gray-700">${esc(s)}</div></div>`).join('')}</div>
      <div id="key-container-content" class="space-y-2 hidden">${v.keyContainer.map((s,i)=>`<div class="flex items-start gap-2"><div class="w-5 h-5 rounded-full bg-blue-100 text-blue-600 text-xs flex items-center justify-center flex-shrink-0 mt-0.5">${i+1}</div><div class="text-sm text-gray-700">${esc(s)}</div></div>`).join('')}</div>
    </div></div>
    <!-- Photos -->
    ${(v.photos>0||(v.photoPaths&&v.photoPaths.length))?`<div class="px-4 mt-3"><div class="bg-white rounded-2xl p-4 shadow-sm"><div class="text-sm font-bold text-gray-700 mb-3">车辆照片</div><div class="grid grid-cols-2 gap-2">${photosHtml}</div></div></div>`:''}
    <!-- Video -->
    <div class="px-4 mt-3"><div class="bg-white rounded-2xl p-4 shadow-sm"><div class="text-sm font-bold text-gray-700 mb-3">${videoPaths.length>1?`视频演示(${videoPaths.length}个)`:videoPaths.length===1?'视频演示':'视频演示'}</div>${videoHtml}</div></div>
    <!-- Remarks -->
    ${v.remarks?`<div class="px-4 mt-3"><div class="bg-amber-50 rounded-2xl p-4 border border-amber-100"><div class="flex items-center gap-2"><svg viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2" class="w-5 h-5"><path d="M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/></svg><span class="font-bold text-amber-900 text-sm">备注</span></div><div class="text-sm text-amber-800 mt-1">${esc(v.remarks)}</div></div></div>`:''}
    <!-- Export buttons -->
    <!-- V5.9.0 问题1: Word/PDF/Excel重定义为两步分享(①生成含照片文档②系统分享面板);原"分享"明确为文字分享 -->
    <div class="px-4 mt-4 mb-6">
      <div class="grid grid-cols-5 gap-2">
        <button onclick="exportSingle('word')" id="btn-detail-export-word" class="flex flex-col items-center gap-1 py-2.5 bg-blue-50 text-blue-600 rounded-xl text-xs font-medium disabled:opacity-50">Word分享</button>
        <button onclick="exportSingle('pdf')" id="btn-detail-export-pdf" class="flex flex-col items-center gap-1 py-2.5 bg-red-50 text-red-600 rounded-xl text-xs font-medium disabled:opacity-50">PDF分享</button>
        <button onclick="exportSingle('excel')" id="btn-detail-export-excel" class="flex flex-col items-center gap-1 py-2.5 bg-green-50 text-green-600 rounded-xl text-xs font-medium disabled:opacity-50">Excel分享</button>
        <button onclick="shareVehicleDetail()" class="flex flex-col items-center gap-1 py-2.5 bg-purple-50 text-purple-600 rounded-xl text-xs font-medium">文字分享</button>
        ${canEdit()?`<button onclick="openEditVehicle(${v.id})" class="flex flex-col items-center gap-1 py-2.5 bg-gray-50 text-gray-600 rounded-xl text-xs font-medium">编辑</button><button onclick="confirmDeleteVehicle(${v.id})" class="flex flex-col items-center gap-1 py-2.5 bg-red-50 text-red-500 rounded-xl text-xs font-medium">删除</button>`:'<div class="flex flex-col items-center gap-1 py-2.5 bg-gray-50 text-gray-300 rounded-xl text-xs">-</div>'}

      </div>
    </div>
  `;
}

function openVehicleDetail(id){
  _renderVehicleDetail(id);
  showScreen('screen-detail');
  document.getElementById('bottom-nav').style.display='none';
  document.getElementById('fab-add').style.display='none';
}

/**
 * V5.8.1 侧滑手势返回 - 车辆详情页专用
 * 用户从屏幕左边缘向右滑动时触发goBack(),与Android原生侧滑返回一致
 * 仅在screen-detail页面生效,不影响视频播放器/照片查看器(它们有自己的关闭逻辑)
 */
let _swipeStartX=0,_swipeStartY=0,_swipeActive=false;
document.addEventListener('touchstart',e=>{
  if(state.screen!=='screen-detail')return;
  // 视频播放器/照片查看器打开时不拦截手势
  const vp=document.getElementById('video-player');
  const pv=document.getElementById('photo-viewer');
  if((vp&&vp.classList.contains('show'))||(pv&&pv.classList.contains('show')))return;
  const t=e.touches[0];
  // 仅左边缘30px范围内触发
  if(t.clientX<=30){
    _swipeStartX=t.clientX;
    _swipeStartY=t.clientY;
    _swipeActive=true;
  }
},{passive:true});
document.addEventListener('touchmove',e=>{
  if(!_swipeActive)return;
  // 纵向滑动不触发(避免与列表滚动冲突)
  const t=e.touches[0];
  if(Math.abs(t.clientY-_swipeStartY)>Math.abs(t.clientX-_swipeStartX))return;
},{passive:true});
document.addEventListener('touchend',e=>{
  if(!_swipeActive){return;}
  _swipeActive=false;
  const t=e.changedTouches[0];
  const dx=t.clientX-_swipeStartX;
  const dy=Math.abs(t.clientY-_swipeStartY);
  // 水平滑动>80px且纵向偏移<50px时触发返回
  if(dx>80&&dy<50){
    goBack();
  }
},{passive:true});

function switchKeyTab(tab){
  const f=document.getElementById('ktab-frame'),c=document.getElementById('ktab-container');
  const fc=document.getElementById('key-frame-content'),cc=document.getElementById('key-container-content');
  if(tab==='frame'){f.className='flex-1 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600';c.className='flex-1 py-2 text-sm font-medium border-b-2 border-transparent text-gray-400';fc.classList.remove('hidden');cc.classList.add('hidden');}
  else{c.className='flex-1 py-2 text-sm font-medium border-b-2 border-blue-500 text-blue-600';f.className='flex-1 py-2 text-sm font-medium border-b-2 border-transparent text-gray-400';cc.classList.remove('hidden');fc.classList.add('hidden');}
}

function prevVehicle(){if(state.currentVehicleIndex>0){state.currentVehicleIndex--;_renderVehicleDetail(VEHICLES[state.currentVehicleIndex].id);}}
function nextVehicle(){if(state.currentVehicleIndex<VEHICLES.length-1){state.currentVehicleIndex++;_renderVehicleDetail(VEHICLES[state.currentVehicleIndex].id);}}

// ===================== EDIT VEHICLE =====================
function openEditVehicle(id){
  if(!canEdit()){showToast('组员账号无编辑权限');return;}
  state.isEditing=!!id;
  const v=id?VEHICLES.find(x=>x.id===id):null;
  document.getElementById('edit-title').textContent=id?'编辑车辆':'添加车辆';
  document.getElementById('edit-content').innerHTML=`
    <div class="space-y-4">
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="text-sm font-bold text-gray-700 mb-3">车型信息</div>
        <div class="space-y-3">
          <div class="flex items-center justify-between"><label class="text-sm text-gray-600">品牌</label><div class="flex items-center gap-2"><button onclick="openSelector('brand')" id="sel-brand" class="text-sm text-gray-800 px-3 py-1.5 bg-gray-50 rounded-lg min-w-[120px] text-right">${v?esc(v.brand):'请选择品牌'}</button><button onclick="showToast('品牌管理')" class="text-xs text-blue-500">管理</button></div></div>
          <div class="flex items-center justify-between"><label class="text-sm text-gray-600">车系</label><div class="flex items-center gap-2"><button onclick="openSelector('series')" id="sel-series" class="text-sm text-gray-800 px-3 py-1.5 bg-gray-50 rounded-lg min-w-[120px] text-right">${v?esc(v.series):'请选择车系'}</button><button onclick="showToast('车系管理')" class="text-xs text-blue-500">管理</button></div></div>
          <div class="flex items-center justify-between"><label class="text-sm text-gray-600">配置</label><div class="flex items-center gap-2"><button onclick="openSelector('config')" id="sel-config" class="text-sm text-gray-800 px-3 py-1.5 bg-gray-50 rounded-lg min-w-[120px] text-right">${v?esc(v.config):'请选择配置'}</button><button onclick="showToast('配置管理')" class="text-xs text-blue-500">管理</button></div></div>
          <div><label class="text-xs text-gray-500 mb-1 block">显示名称</label><input id="edit-display" type="text" placeholder="例如：比亚迪海豹EV" value="${v?esc(v.display):''}" class="w-full px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500"></div>
          <div><label class="text-xs text-gray-500 mb-1 block">车辆尺寸（长×宽×高 mm）</label><input id="edit-size" type="text" placeholder="例如：4125*1770*1570" value="${v?esc(v.size):''}" class="w-full px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500"></div>
          <div class="flex items-center justify-between"><label class="text-sm text-gray-600">动力类型</label><button onclick="openSelector('power')" id="sel-power" class="text-sm text-gray-800 px-3 py-1.5 bg-gray-50 rounded-lg min-w-[120px] text-right">${v?esc(v.powerType):'请选择'}</button></div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="text-sm font-bold text-gray-700 mb-3">断电信息</div>
        <div class="space-y-3">
          <div><label class="text-xs text-gray-500 mb-1 block">断电位置 <span class="text-red-500">*</span></label><input id="edit-position" type="text" placeholder="例如：后备箱左侧小电瓶负极" value="${v?esc(v.position):''}" class="w-full px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500"></div>
          <div><label class="text-xs text-gray-500 mb-1 block">钥匙-框架处理方式</label><textarea id="edit-keyframe" class="key-textarea" placeholder="框架处理方式（例如：钥匙放在驾驶室手套箱内）">${v?esc(v.keyFrame.join('\n')):''}</textarea></div>
          <div><label class="text-xs text-gray-500 mb-1 block">钥匙-集装箱处理方式</label><textarea id="edit-keycontainer" class="key-textarea" placeholder="集装箱处理方式（例如：集装箱钥匙由理货员保管）">${v?esc(v.keyContainer.join('\n')):''}</textarea></div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="text-sm font-bold text-gray-700 mb-3">断电步骤</div>
        <div id="steps-container" class="space-y-2">
          ${v?v.steps.map((s,i)=>`<div class="flex gap-2"><input type="text" class="flex-1 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm outline-none" value="${esc(s)}"><button onclick="this.parentElement.remove()" class="px-2 text-red-400">✕</button></div>`).join(''):''}
        </div>
        <button onclick="addStep()" class="w-full py-2 mt-2 border-2 border-dashed border-gray-200 rounded-lg text-sm text-gray-400">+ 添加步骤</button>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="text-sm font-bold text-gray-700 mb-3">媒体资源</div>
        <div class="space-y-3">
          <div>
            <label class="text-xs text-gray-500 mb-1 block">车辆照片（最多9张）</label>
            <div class="flex gap-2 flex-wrap">
              <label class="px-3 py-2 bg-blue-50 text-blue-600 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
                拍照
                <input type="file" accept="image/*" capture="environment" class="hidden" onchange="handlePhotoSelect(this,'camera')">
              </label>
              <label class="px-3 py-2 bg-green-50 text-green-600 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>
                相册选图
                <input type="file" accept="image/*" multiple class="hidden" onchange="handlePhotoSelect(this,'gallery')">
              </label>
            </div>
            <div class="text-xs text-gray-400 mt-1">支持拍照、相册单选/批量选图，自动压缩保清晰</div>
            <div id="photo-preview" class="grid grid-cols-3 gap-2 mt-2"></div>
          </div>
          <div>
            <label class="text-xs text-gray-500 mb-1 block">视频资源</label>
            <div class="flex gap-2 flex-wrap">
              <label class="px-3 py-2 bg-purple-50 text-purple-600 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M23 7l-7 5 7 5V7zM1 5h15v14H1z"/></svg>
                选择视频
                <input type="file" accept="video/*" class="hidden" onchange="handleVideoSelect(this)">
              </label>
              <label class="px-3 py-2 bg-gray-50 text-gray-600 rounded-lg text-xs font-medium cursor-pointer flex items-center gap-1">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4"><path d="M15 10l4.76-2.06a1 1 0 011.24.5v7.12a1 1 0 01-1.24.5L15 14"/><rect x="1" y="5" width="14" height="14" rx="2"/></svg>
                拍摄视频
                <input type="file" accept="video/*" capture="environment" class="hidden" onchange="handleVideoSelect(this)">
              </label>
            </div>
            <div class="text-xs text-gray-400 mt-1">可从相册选择视频或拍摄视频</div>
            <div id="video-preview" class="space-y-2 mt-2"></div>
          </div>
        </div>
      </div>
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div><label class="text-xs text-gray-500 mb-1 block">注意事项（可选）</label><input id="edit-remarks" type="text" placeholder="例如：放干燥剂" value="${v?v.remarks:''}" class="w-full px-3 py-2.5 bg-gray-50 rounded-xl border border-gray-200 text-sm outline-none focus:border-blue-500"></div>
      </div>
    </div>
  `;
  state.editingVehicle=v;
  showScreen('screen-edit');
  document.getElementById('bottom-nav').style.display='none';
  document.getElementById('fab-add').style.display='none';
  loadEditMedia(v);
}

function addStep(){
  const c=document.getElementById('steps-container');
  const d=document.createElement('div');
  d.className='flex gap-2';
  d.innerHTML='<input type="text" class="flex-1 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm outline-none" placeholder="步骤描述"><button onclick="this.parentElement.remove()" class="px-2 text-red-400">✕</button>';
  c.appendChild(d);
}

// ===================== PHOTO/VIDEO HANDLING =====================
let editPhotos=[];
let editVideos=[];

function handlePhotoSelect(input,source){
  const files=Array.from(input.files);
  if(!files.length)return;
  const remaining=9-editPhotos.length;
  if(remaining<=0){showToast('最多添加9张照片');input.value='';return;}
  const toProcess=files.slice(0,remaining);
  if(files.length>remaining){showToast(`仅添加前${remaining}张，最多9张`);}
  toProcess.forEach(file=>{
    if(!file.type.startsWith('image/'))return;
    compressImage(file,800,0.7).then(dataUrl=>{
      editPhotos.push({name:file.name,data:dataUrl});
      renderPhotoPreview();
    });
  });
  input.value='';
}

function compressImage(file,maxSize,quality){
  return new Promise((resolve)=>{
    const reader=new FileReader();
    reader.onload=(e)=>{
      const img=new Image();
      img.onload=()=>{
        let{width,height}=img;
        if(width>maxSize||height>maxSize){
          if(width>height){height=Math.round(height*maxSize/width);width=maxSize;}
          else{width=Math.round(width*maxSize/height);height=maxSize;}
        }
        const canvas=document.createElement('canvas');
        canvas.width=width;canvas.height=height;
        canvas.getContext('2d').drawImage(img,0,0,width,height);
        resolve(canvas.toDataURL('image/jpeg',quality));
      };
      img.src=e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderPhotoPreview(){
  const c=document.getElementById('photo-preview');
  if(!c)return;
  c.innerHTML=editPhotos.map((p,i)=>`
    <div class="relative aspect-square rounded-lg overflow-hidden bg-gray-100">
      <img src="${p.data}" class="w-full h-full object-cover" onclick="viewPhoto(${i})">
      <button onclick="removePhoto(${i})" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white text-xs flex items-center justify-center">&times;</button>
    </div>
  `).join('');
}

function removePhoto(idx){
  editPhotos.splice(idx,1);
  renderPhotoPreview();
}

function viewPhoto(idx){
  const viewer=document.getElementById('photo-viewer');
  const img=viewer.querySelector('img');
  img.src=editPhotos[idx].data;
  state.photoZoom=1;
  img.style.transform='scale(1)';
  viewer.classList.add('show');
}

function handleVideoSelect(input){
  const files=Array.from(input.files);
  if(!files.length)return;
  const file=files[0];
  if(!file.type.startsWith('video/')){showToast('请选择视频文件');return;}
  if(file.size>100*1024*1024){showToast('视频不能超过100MB');input.value='';return;}
  const reader=new FileReader();
  reader.onload=(e)=>{
    editVideos.push({name:file.name,data:e.target.result,size:file.size});
    renderVideoPreview();
  };
  reader.readAsDataURL(file);
  input.value='';
}

function renderVideoPreview(){
  const c=document.getElementById('video-preview');
  if(!c)return;
  c.innerHTML=editVideos.map((v,i)=>`
    <div class="relative bg-gray-100 rounded-lg p-2 flex items-center gap-2">
      <video src="${v.data}" class="w-20 h-14 object-cover rounded" muted></video>
      <div class="flex-1 min-w-0"><div class="text-xs text-gray-700 truncate">${v.name}</div><div class="text-xs text-gray-400">${(v.size/1024/1024).toFixed(1)}MB</div></div>
      <button onclick="removeVideo(${i})" class="w-6 h-6 rounded-full bg-red-50 text-red-500 text-xs flex items-center justify-center">&times;</button>
    </div>
  `).join('');
}

function removeVideo(idx){
  editVideos.splice(idx,1);
  renderVideoPreview();
}

function loadEditMedia(v){
  editPhotos=[];
  editVideos=[];
  if(v&&v.photoPaths){
    editPhotos=v.photoPaths.map(p=>({name:'existing',data:p}));
  }
  if(v&&v.videoPaths){
    editVideos=v.videoPaths.map(p=>({name:'existing',data:p,size:0}));
  }
  renderPhotoPreview();
  renderVideoPreview();
}

function saveVehicle(){
  const display=document.getElementById('edit-display').value.trim();
  const position=document.getElementById('edit-position').value.trim();
  if(!display||!position){showToast('请填写显示名称和断电位置');return;}
  const size=document.getElementById('edit-size').value.trim();
  if(size&&!/^\d+\*\d+\*\d+$/.test(size)){showToast('尺寸格式错误，请使用数字*数字*数字格式');return;}
  const brand=document.getElementById('sel-brand').textContent.trim();
  const series=document.getElementById('sel-series').textContent.trim();
  const config=document.getElementById('sel-config').textContent.trim();
  const powerType=document.getElementById('sel-power').textContent.trim();
  const keyFrame=document.getElementById('edit-keyframe').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const keyContainer=document.getElementById('edit-keycontainer').value.split('\n').map(s=>s.trim()).filter(Boolean);
  const steps=Array.from(document.querySelectorAll('#steps-container input')).map(i=>i.value.trim()).filter(Boolean);
  const remarks=document.getElementById('edit-remarks').value.trim();
  const photoPaths=editPhotos.map(p=>p.data);
  const videoPaths=editVideos.map(v=>v.data);
  if(state.isEditing&&state.editingVehicle){
    const v=state.editingVehicle;
    const brandObj=BRANDS.find(b=>b.name===brand);
    // A3状态守卫: 编辑更新走State API(合并+持久化); 逐字段与旧直写等价
    State.updateVehicle(v.id,{
      display,size,position,brand,series,config,powerType,keyFrame,keyContainer,
      steps,remarks,pinyin:getPinyin(display),
      photos:photoPaths.length,photoPaths,videos:videoPaths.length,videoPaths,
      // V10.9.2 问题1: 编辑时也更新brandId——之前只改brand名称不改分组ID,
      // 导致分级列表分组错乱,改了品牌还在旧组里
      brandId:brandObj?brandObj.id:'custom'
    });
  }else{
    // A3状态守卫: 新增走State API(id自增+兜底+拼音+入列+持久化)
    State.addVehicle({brand,series,config,display,powerType,size,position,steps,keyFrame,keyContainer,remarks,photoPaths,videoPaths});
  }
  editPhotos=[];editVideos=[];
  /* V10.7.0 问题2: 保存即调度自动同步——8秒防抖窗口合并连续保存,
   * 检出未上云的base64照片/视频才执行完整上传管线(照片降采样→分离上传→
   * 路径替换→JSON上云→更新通知落云),组长无需再手动点"上传同步"。
   * 组员端无上传权限/飞书未配置时函数内部静默跳过,不产生任何干扰。 */
  scheduleAutoSyncAfterSave();
  showToast('保存成功');
  renderBrandTags();
  renderVehicleList();
  if(state.isEditing&&state.currentVehicleId){
    // V5.7修复: 编辑保存后返回详情页。旧版直接showScreen会把screen-edit压入历史栈,
    // 导致详情页按返回键又回到编辑表单(返回逻辑错乱的直接根源)。
    // 现改为: 从栈中移除编辑页后直接激活详情页,返回键正确回到列表页
    navRemove('screen-edit');
    _renderVehicleDetail(state.currentVehicleId);
    _activateScreen('screen-detail');
    document.getElementById('bottom-nav').style.display='none';
    document.getElementById('fab-add').style.display='none';
  }else{
    // 新增车辆后返回列表页
    showScreen('screen-vehicles');
  }
}

function confirmDeleteVehicle(id){
  showConfirm('删除车辆','确定删除该车辆信息？此操作不可撤销。',()=>{
    // A3状态守卫: 删除走State API(splice+持久化), 返回bool保持原idx>-1卫语句语义
    if(State.removeVehicle(id)){showToast('删除成功');renderBrandTags();renderVehicleList();goBack();}
  });
}

// ===================== SELECTOR (Bottom Sheet) =====================
function openSelector(type){
  let items=[],title='';
  if(type==='brand'){title='选择品牌';items=[...BRANDS.map(b=>b.name+(b.en?'('+b.en+')':'')),'+新增品牌...'];}
  else if(type==='series'){title='选择车系';const b=BRANDS.find(x=>x.name===document.getElementById('sel-brand').textContent.split('(')[0]);items=[...new Set(VEHICLES.filter(v=>!b||v.brandId===b.id).map(v=>v.series)),'+新增车系...'];}
  else if(type==='config'){title='选择配置';items=['低配','高配','标准','PRO','PLUS','EV','DM-i','PHEV','+新增配置...'];}
  else if(type==='power'){title='选择动力类型';items=['燃油','纯电','混动','插混','氢燃料'];}
  document.getElementById('selector-content').innerHTML=`
    <div class="sticky top-0 bg-white px-5 py-3 border-b border-gray-100 flex items-center justify-between rounded-t-2xl">
      <h3 class="font-bold text-gray-900">${title}</h3><button onclick="closeModal('modal-selector')" class="text-gray-400 text-xl">&times;</button>
    </div>
    <div>${items.map(i=>`<div class="bs-item ${i.startsWith('+')?'text-blue-500':''}" onclick="selectItem('${type}','${i}')"><span class="text-sm">${i}</span></div>`).join('')}</div>
    <div class="p-3"><button onclick="closeModal('modal-selector')" class="w-full py-2.5 bg-gray-100 text-gray-600 rounded-xl text-sm font-medium">取消</button></div>
  `;
  openModal('modal-selector');
}

function selectItem(type,item){
  if(item.startsWith('+')){
    const input=prompt('请输入新的'+(type==='brand'?'品牌':type==='series'?'车系':'配置')+'名称：');
    if(input&&input.trim()){
      if(type==='brand')document.getElementById('sel-brand').textContent=input.trim();
      else if(type==='series')document.getElementById('sel-series').textContent=input.trim();
      else if(type==='config')document.getElementById('sel-config').textContent=input.trim();
      showToast('新增成功');
    }
    closeModal('modal-selector');
    return;
  }
  if(type==='brand')document.getElementById('sel-brand').textContent=item.replace(/\(.*\)/,'');
  else if(type==='series')document.getElementById('sel-series').textContent=item;
  else if(type==='config')document.getElementById('sel-config').textContent=item;
  else if(type==='power')document.getElementById('sel-power').textContent=item;
  closeModal('modal-selector');
}

// ===================== SHARE =====================
/**
 * 检测Cordova原生社交分享插件是否可用
 * 原生分享可调起系统分享面板,直接分享文件到微信/QQ/钉钉等主流应用
 * @returns {boolean} 原生插件是否可用
 */
function hasNativeShare(){
  return !!(window.plugins&&window.plugins.socialsharing&&typeof window.plugins.socialsharing.shareWithOptions==='function');
}

/**
 * 将Blob转换为base64 Data URL - 原生分享插件要求文件以此格式传入
 * @param {Blob} blob - 文件二进制数据
 * @returns {Promise<string>} base64 Data URL字符串
 */
function blobToDataURL(blob){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onloadend=()=>resolve(reader.result);
    reader.onerror=()=>reject(new Error('文件读取失败'));
    reader.readAsDataURL(blob);
  });
}

async function shareVehicleDetail(){
  const v=VEHICLES.find(x=>x.id===state.currentVehicleId);
  if(!v)return;
  const shareText=getVehicleShareText(v);
  // V10.4.0 问题1加固: 冷启动后立即点分享时,插件可能尚未就绪(deviceready未触发),
  // 等待最多3秒再判定,避免误降级到剪贴板(用户观感=分享面板调不起)
  if(window.cordova&&!hasNativeShare()){
    await new Promise(res=>{
      let done=false;
      const timer=setTimeout(()=>{if(!done){done=true;res();}},3000);
      document.addEventListener('deviceready',()=>{if(!done){done=true;clearTimeout(timer);res();}},{once:true});
    });
  }
  // 优先原生分享: 调起系统分享面板(微信/QQ/钉钉/短信等均可接收)
  if(hasNativeShare()){
    window.plugins.socialsharing.share(shareText,v.display+' 断电指导',null,null,()=>{},()=>{
      // 原生失败时降级到Web Share API
      if(navigator.share){navigator.share({title:v.display+' 断电指导',text:shareText}).catch(()=>{});}
      else{showToast('分享取消');}
    });
    return;
  }
  const shareData={title:v.display+' 断电指导',text:shareText};
  if(navigator.share){
    try{await navigator.share(shareData);}catch(e){if(e.name!=='AbortError')showToast('分享取消');}
  }else if(navigator.clipboard){
    try{await navigator.clipboard.writeText(shareText);showToast('已复制断电信息到剪贴板');}catch(e){showToast('分享功能不可用');}
  }else{
    showToast('当前环境不支持分享');
  }
}

/**
 * 分享文件 - 三级降级策略确保微信/QQ/钉钉等主流应用均可接收
 * 1. Cordova原生socialsharing插件: 直接调起系统分享面板(最可靠)
 * 2. Web Share API Level 2: 新版WebView支持的系统分享
 * 3. 浏览器下载: 兜底方案
 * V5.8: 新增可选title参数(对齐APK方案)——原生分享面板标题统一为
 *       "选择保存或分享方式"语境,与新版安装包(V1.8 React版)行为一致
 * @param {Blob} blob - 文件二进制数据
 * @param {string} filename - 文件名(含扩展名)
 * @param {string} mimeType - MIME类型
 * @param {string} [title] - 分享面板标题(缺省用文件名)
 */
/**
 * V10.3 分享文件——仅系统级分享,移除下载兜底(问题1)
 * 需求: 数据分享必须调起系统分享面板分享到应用外部,不准降级为浏览器下载。
 * 链路: ① Web Share API(navigator.share,等价原生Intent.ACTION_SEND)
 *       ② Cordova socialsharing插件(file://URI→原生分享面板)
 *       全部失败→明确报错提示,绝不静默降级下载。
 * @param {Blob} blob - 要分享的二进制数据
 * @param {string} filename - 文件名（含扩展名）
 * @param {string} mimeType - MIME类型
 * @param {string} [title] - 分享面板标题
 * @returns {Promise<boolean>} true=分享面板已调起, false=系统分享不可用(已提示用户)
 */
async function shareFile(blob,filename,mimeType,title){
  // 输入验证
  if(!blob||!(blob instanceof Blob)){showToast('分享失败：数据无效');return false;}
  if(blob.size===0){showToast('分享失败：文件为空');return false;}
  if(!filename||typeof filename!=='string'){showToast('分享失败：文件名无效');return false;}
  // V10.2 问题2配套: 导出文档统一落盘登记到持久缓存exported_docs/
  // 所有导出点(批量导出/车辆详情/备份)经此函数分发,单点登记零调用方改动;
  // fire-and-forget: 落盘失败不影响分享流程
  if(window.cordova){cacheSaveBlob(CACHE_DIR_DOCS,filename,blob,{kind:(filename.split('.').pop()||'').toLowerCase()}).catch(()=>{});}
  // 修正MIME(确保与文件扩展名一致,避免微信识别异常)
  const ext=(filename.split('.').pop()||'dat').toLowerCase();
  let fixedMime=mimeType||'application/octet-stream';
  if(ext==='docx'&&!/wordprocessingml/.test(mimeType||''))fixedMime='application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(ext==='xlsx'&&!/spreadsheetml/.test(mimeType||''))fixedMime='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if(ext==='doc'&&!/msword/.test(mimeType||''))fixedMime='application/msword';
  if(ext==='pdf')fixedMime='application/pdf';
  if(ext==='json')fixedMime='application/json';
  if(ext==='csv')fixedMime='text/csv;charset=utf-8';
  console.log('[分享] 开始分享:',filename,'大小:',(blob.size/1024).toFixed(1)+'KB','MIME:',fixedMime);

  /* V10.5.0 问题2根因修复: 分享链路顺序反转(原生插件优先)
   * 根因: 旧版Web Share API优先——Android WebView的navigator.share在多数版本仅
   * 支持纯文本(Web Share Level 2文件分享在WebView中长期未开放),files参数被静默
   * 丢弃,分享面板虽弹出但只带出text字段(文件名),第三方应用收不到文件本体——
   * 即用户反馈的"只显示数据名称文本,没有真正把数据分享到第三方"。
   * 修复: Cordova环境下原生socialsharing插件优先(真实文件落盘→file://URI→
   * 原生Intent.ACTION_SEND带STREAM附件,微信/QQ/钉钉/飞书稳定接收);
   * Web Share API降为浏览器环境主链路/Cordova原生失败后的保底,
   * 且必须canShare({files})明确校验通过才调用,杜绝文本-only静默降级。 */
  if(window.cordova){
    // 等待deviceready(首次调用可能早于插件就绪)
    if(!hasNativeShare()){
      await new Promise(res=>{
        let done=false;
        const timer=setTimeout(()=>{if(!done){done=true;res();}},3000);
        document.addEventListener('deviceready',()=>{if(!done){done=true;clearTimeout(timer);res();}},{once:true});
      });
    }
    if(hasNativeShare()){
      try{
        let shareFiles=null;
        // 写真实文件分享(file://路径),微信/QQ/钉钉稳定识别
        if(window.resolveLocalFileSystemURL&&window.cordova&&window.cordova.file){
          try{
            const safeName=filename.replace(/[\/\\:*?"<>|]/g,'_');
            const fileUrl=await writeBlobToCache(safeName,blob);
            shareFiles=[fileUrl];
            console.log('[分享] 文件已写入缓存:',fileUrl);
          }catch(e){
            console.warn('[分享] 缓存写入失败,尝试base64:',e.message);
          }
        }
        if(!shareFiles){
          const dataUrl=await blobToDataURL(blob);
          shareFiles=[dataUrl.replace(/^data:[^;]*;/,`data:${fixedMime};`)];
        }
        if(!shareFiles||!shareFiles[0]){throw new Error('无有效分享文件');}
        console.log('[分享] 调用socialsharing(原生面板),文件:',filename);
        await new Promise((resolve,reject)=>{
          window.plugins.socialsharing.shareWithOptions(
            {message:filename,subject:filename,title:title||filename,dialogTitle:'选择分享方式',files:shareFiles},
            ()=>{console.log('[分享] socialsharing回调成功');resolve();},
            err=>{console.error('[分享] socialsharing失败:',JSON.stringify(err));reject(err);}
          );
        });
        return true; // 分享面板已调起(文件已附带给第三方应用)
      }catch(e){
        if(e==='canceled'){console.log('[分享] 用户取消');return true;}
        console.warn('[分享] 原生插件失败,降级Web Share API:',e);
      }
    }
  }

  // Web Share API(浏览器环境主链路/Cordova原生失败保底)
  // V10.5.0: 必须canShare({files})明确校验文件可分享才调用——
  // 旧版"无canShare直接盲调"分支正是文本-only分享的来源,已删除
  if(typeof navigator.share==='function'&&typeof navigator.canShare==='function'){
    try{
      const file=new File([blob],filename,{type:fixedMime});
      if(navigator.canShare({files:[file]})){
        await navigator.share({files:[file],title:title||filename,text:filename});
        console.log('[分享] Web Share API成功(文件已校验可分享)');
        return true;
      }
      // canShare({files})=false: 该环境不支持文件分享,不盲目调用(否则退化成纯文本分享)
      console.warn('[分享] 当前环境Web Share API不支持文件分享,跳过');
    }catch(e){
      if(e&&e.name==='AbortError'){
        console.log('[分享] 用户取消分享');
        return true; // 面板弹出了但用户取消,仍算成功调起
      }
      console.warn('[分享] Web Share API失败:',e&&e.message);
    }
  }

  // 全链路失败——明确报错,不准静默降级为纯文本分享
  console.error('[分享] 系统分享不可用: 原生插件与Web Share API均未调起',filename);
  showToast('分享失败：系统分享面板不可用，请检查系统或升级应用');
  return false;
}

function getVehicleShareText(v){
  return `${v.display} - 断电指导\n品牌：${v.brand} / ${v.series}\n配置：${v.config}\n动力类型：${v.powerType}\n断电位置：${v.position}\n\n断电步骤：\n${v.steps.map((s,i)=>(i+1)+'. '+s).join('\n')}\n\n备注：${v.remarks||'无'}`;
}

