/* ===========================================================
 * 模块: 10-feedback.js  问题反馈功能 V1.0 (V10.15.0 新增)
 * ===========================================================
 * 功能:
 *   1. 问题反馈表单(板块选择/描述/截图/联系方式)
 *   2. 提交到飞书多维表格,失败则本地缓存待同步
 *   3. 反馈列表查看(组长看全部,组员看自己)
 *   4. 反馈详情查看(含AI分析摘要/技术文档链接)
 * =========================================================== */
(function(){
'use strict';

const CATEGORIES = [
  '车辆查询模块', '断电操作模块', '数据同步模块', '账号登录注册',
  '组员管理模块', '缓存与导出', '系统设置', '其他问题'
];

let _draftScreenshots = []; // [{blob, dataUrl, name}]
let _feedbackList = [];
let _currentFilter = 'all';

/** 初始化反馈页面 */
window.initFeedbackPage = function() {
  renderFeedbackForm();
  // 加载本地缓存的反馈
  loadLocalFeedback();
  // 尝试同步待上传的
  syncPendingFeedback().catch(()=>{});
};

/** 渲染反馈表单 */
function renderFeedbackForm() {
  const catOptions = CATEGORIES.map(c => `<div class="bs-item" onclick="selectFeedbackCategory('${c}')"><span class="text-sm text-gray-800">${c}</span></div>`).join('');
  const html = `
    <div class="sticky top-0 z-30 bg-white shadow-sm">
      <div class="pt-12 px-4 pb-3 flex items-center gap-3">
        <button onclick="showScreen('screen-my')" class="w-8 h-8 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h2 class="text-base font-bold">问题反馈</h2>
      </div>
    </div>
    <div class="flex-1 scroll-y px-4 pb-24 pt-4 space-y-4">
      <!-- 类型切换 -->
      <div class="flex gap-2 bg-gray-100 rounded-xl p-1">
        <button id="fb-tab-form" class="flex-1 py-2 rounded-lg text-sm font-medium bg-white text-blue-600 shadow-sm" onclick="switchFeedbackTab('form')">提交反馈</button>
        <button id="fb-tab-list" class="flex-1 py-2 rounded-lg text-sm font-medium text-gray-500" onclick="switchFeedbackTab('list')">我的反馈</button>
      </div>

      <!-- 表单视图 -->
      <div id="fb-form-view" class="space-y-4">
        <!-- 问题板块 -->
        <div class="bg-white rounded-2xl p-4 shadow-sm">
          <label class="text-sm font-bold text-gray-700 mb-2 block">问题板块 <span class="text-red-500">*</span></label>
          <div id="fb-category-btn" class="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 text-sm text-gray-400 flex items-center justify-between cursor-pointer" onclick="openFeedbackCategoryPicker()">
            <span id="fb-category-text">请选择问题所属板块</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-400"><path d="M6 9l6 6 6-6"/></svg>
          </div>
        </div>

        <!-- 问题描述 -->
        <div class="bg-white rounded-2xl p-4 shadow-sm">
          <label class="text-sm font-bold text-gray-700 mb-2 block">问题描述 <span class="text-red-500">*</span></label>
          <textarea id="fb-description" class="key-textarea" rows="5" placeholder="请详细描述遇到的问题，包括：操作步骤、现象、期望结果..." maxlength="500" oninput="updateDescCounter()"></textarea>
          <div class="text-right text-xs text-gray-400 mt-1"><span id="fb-desc-count">0</span>/500</div>
        </div>

        <!-- 截图 -->
        <div class="bg-white rounded-2xl p-4 shadow-sm">
          <label class="text-sm font-bold text-gray-700 mb-3 block">问题截图 <span class="text-gray-400 text-xs font-normal">(最多3张)</span></label>
          <div class="grid grid-cols-4 gap-2" id="fb-screenshot-grid">
            <div class="aspect-square bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer" onclick="triggerFeedbackScreenshot()">
              <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" class="w-6 h-6"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
            </div>
          </div>
          <input type="file" id="fb-screenshot-input" accept="image/*" multiple class="hidden" onchange="handleFeedbackScreenshots(this)">
        </div>

        <!-- 联系方式 -->
        <div class="bg-white rounded-2xl p-4 shadow-sm">
          <label class="text-sm font-bold text-gray-700 mb-2 block">联系方式 <span class="text-gray-400 text-xs font-normal">(选填，方便回复)</span></label>
          <input id="fb-contact" type="text" placeholder="QQ / 手机号 / 其他联系方式" class="w-full px-4 py-3 bg-gray-50 rounded-xl border border-gray-200 focus:border-blue-500 focus:bg-white outline-none text-sm">
        </div>

        <!-- 提交按钮 -->
        <button id="fb-submit-btn" onclick="submitFeedback()" class="w-full py-3.5 bg-gradient-to-r from-blue-600 to-blue-500 text-white rounded-xl font-medium text-sm shadow-lg shadow-blue-500/30 active:scale-[0.98] transition-transform">提交反馈</button>
      </div>

      <!-- 列表视图 -->
      <div id="fb-list-view" class="space-y-3 hidden">
        <div class="flex gap-2 overflow-x-auto pb-1 scroll-y">
          <button class="fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-blue-500 text-white whitespace-nowrap" data-filter="all" onclick="filterFeedback('all')">全部</button>
          <button class="fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap" data-filter="待处理" onclick="filterFeedback('待处理')">待处理</button>
          <button class="fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap" data-filter="分析中" onclick="filterFeedback('分析中')">分析中</button>
          <button class="fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap" data-filter="已解决" onclick="filterFeedback('已解决')">已解决</button>
        </div>
        <div id="fb-list-container" class="space-y-3">
          <div class="text-center text-gray-400 text-sm py-8">暂无反馈记录</div>
        </div>
      </div>
    </div>

    <!-- 板块选择弹层 -->
    <div class="modal-overlay" id="modal-fb-category" onclick="closeModal('modal-fb-category')">
      <div class="modal-sheet" onclick="event.stopPropagation()">
        <div class="px-4 py-3 border-b border-gray-100 text-center text-sm font-bold text-gray-700">选择问题板块</div>
        <div>${catOptions}</div>
      </div>
    </div>

    <!-- 反馈详情弹层 -->
    <div class="modal-overlay" id="modal-fb-detail" onclick="closeModal('modal-fb-detail')">
      <div class="modal-sheet" onclick="event.stopPropagation()" style="max-height:85vh;">
        <div class="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <span class="text-sm font-bold text-gray-700">反馈详情</span>
          <button onclick="closeModal('modal-fb-detail')" class="text-gray-400">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div id="fb-detail-content" class="p-4 space-y-4"></div>
      </div>
    </div>
  `;
  document.getElementById('screen-feedback').innerHTML = html;
}

window.updateDescCounter = function() {
  const v = document.getElementById('fb-description').value.length;
  document.getElementById('fb-desc-count').textContent = v;
};

window.openFeedbackCategoryPicker = function() {
  openModal('modal-fb-category');
};

window.selectFeedbackCategory = function(cat) {
  document.getElementById('fb-category-text').textContent = cat;
  document.getElementById('fb-category-text').classList.remove('text-gray-400');
  document.getElementById('fb-category-text').classList.add('text-gray-800');
  closeModal('modal-fb-category');
};

window.switchFeedbackTab = function(tab) {
  const formBtn = document.getElementById('fb-tab-form');
  const listBtn = document.getElementById('fb-tab-list');
  const formView = document.getElementById('fb-form-view');
  const listView = document.getElementById('fb-list-view');
  if (tab === 'form') {
    formBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium bg-white text-blue-600 shadow-sm';
    listBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium text-gray-500';
    formView.classList.remove('hidden');
    listView.classList.add('hidden');
  } else {
    listBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium bg-white text-blue-600 shadow-sm';
    formBtn.className = 'flex-1 py-2 rounded-lg text-sm font-medium text-gray-500';
    listView.classList.remove('hidden');
    formView.classList.add('hidden');
    loadAndRenderFeedbackList();
  }
};

window.triggerFeedbackScreenshot = function() {
  if (_draftScreenshots.length >= 3) { showToast('最多上传3张截图'); return; }
  document.getElementById('fb-screenshot-input').click();
};

window.handleFeedbackScreenshots = function(input) {
  const files = input.files;
  const remaining = 3 - _draftScreenshots.length;
  const toAdd = Math.min(files.length, remaining);
  let processed = 0;
  for (let i = 0; i < toAdd; i++) {
    const file = files[i];
    const reader = new FileReader();
    reader.onload = function(e) {
      // 压缩图片
      const img = new Image();
      img.onload = function() {
        const canvas = document.createElement('canvas');
        const maxW = 1280, maxH = 1280;
        let w = img.width, h = img.height;
        if (w > maxW) { h = h * maxW / w; w = maxW; }
        if (h > maxH) { w = w * maxH / h; h = maxH; }
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        canvas.toBlob(function(blob) {
          const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
          _draftScreenshots.push({ blob, dataUrl, name: 'screenshot_' + Date.now() + '_' + processed + '.jpg' });
          processed++;
          if (processed === toAdd) {
            renderScreenshotGrid();
            input.value = '';
          }
        }, 'image/jpeg', 0.8);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }
};

function renderScreenshotGrid() {
  const grid = document.getElementById('fb-screenshot-grid');
  let html = '';
  _draftScreenshots.forEach((s, i) => {
    html += `<div class="aspect-square relative rounded-xl overflow-hidden">
      <img src="${s.dataUrl}" class="w-full h-full object-cover">
      <button onclick="removeFeedbackScreenshot(${i})" class="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" class="w-3 h-3"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
    </div>`;
  });
  if (_draftScreenshots.length < 3) {
    html += `<div class="aspect-square bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 flex items-center justify-center cursor-pointer" onclick="triggerFeedbackScreenshot()">
      <svg viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2" class="w-6 h-6"><path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z"/><circle cx="12" cy="13" r="4"/></svg>
    </div>`;
  }
  grid.innerHTML = html;
}

window.removeFeedbackScreenshot = function(idx) {
  _draftScreenshots.splice(idx, 1);
  renderScreenshotGrid();
};

/** 提交反馈 */
window.submitFeedback = async function() {
  const category = document.getElementById('fb-category-text').textContent;
  const description = document.getElementById('fb-description').value.trim();
  const contact = document.getElementById('fb-contact').value.trim();

  if (!category || category === '请选择问题所属板块') { showToast('请选择问题板块'); return; }
  if (description.length < 5) { showToast('问题描述至少5个字'); return; }

  const btn = document.getElementById('fb-submit-btn');
  btn.disabled = true;
  btn.textContent = '提交中...';

  try {
    const user = state && state.currentUser;
    const deviceInfo = getDeviceInfoStr();
    const id = 'fb_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);

    // 收集截图file_tokens
    let screenshotTokens = [];
    if (_draftScreenshots.length > 0 && window.FeedbackBase && window.FeedbackBase.isAvailable()) {
      try {
        for (const s of _draftScreenshots) {
          const result = await window.FeedbackBase.uploadScreenshot(s.blob, s.name);
          screenshotTokens.push(result);
        }
      } catch (e) {
        console.warn('截图上传失败,先存本地:', e);
      }
    }

    const feedback = {
      id,
      category,
      description,
      screenshotTokens,
      contact,
      reporterName: user ? user.name : '匿名',
      reporterPhone: user ? user.phone : '',
      reporterRole: user ? (user.role || 'user') : 'user',
      platform: (window.cordova && window.cordova.platformId) ? 'Android' : '网页',
      appVersion: APP_VERSION || 'unknown',
      deviceInfo,
      status: '待处理',
      createdAt: new Date().toISOString(),
      synced: false,
    };

    // 保存本地
    saveFeedbackLocal(feedback);

    // 尝试上传到多维表格
    if (window.FeedbackBase && window.FeedbackBase.isAvailable()) {
      try {
        // 构建Bitable字段对象
        const fields = {
          '反馈ID': id,
          '问题板块': category,
          '问题描述': description,
          '提交人': user ? user.name : '匿名',
          '角色': user ? (user.role === 'leader' ? '组长' : '组员') : '用户',
          '平台': (window.cordova && window.cordova.platformId) ? 'Android' : '网页',
          'APP版本': 'V' + (window.APP_VERSION || 'unknown'),
          '设备信息': deviceInfo,
          '联系方式': contact || '',
          '状态': '待处理',
        };
        // 截图附件: 写入问题描述末尾
        if (screenshotTokens.length > 0) {
          fields['问题描述'] = description + '\n\n[截图' + screenshotTokens.length + '张,已上传云盘]';
        }
        await window.FeedbackBase.addFeedbackRecord(fields);
        feedback.synced = true;
        updateFeedbackLocal(id, { synced: true, screenshotTokens });
        showToast('反馈提交成功，感谢您的反馈！');
        resetFeedbackForm();
      } catch (e) {
        console.warn('写入飞书失败,本地缓存待同步:', e);
        showToast('已保存，网络恢复后自动同步');
        resetFeedbackForm();
      }
    } else {
      showToast('已保存，网络恢复后自动同步');
      resetFeedbackForm();
    }
  } catch (e) {
    console.error('提交反馈失败:', e);
    showToast('提交失败，请重试');
  } finally {
    btn.disabled = false;
    btn.textContent = '提交反馈';
  }
};

function resetFeedbackForm() {
  document.getElementById('fb-category-text').textContent = '请选择问题所属板块';
  document.getElementById('fb-category-text').classList.add('text-gray-400');
  document.getElementById('fb-category-text').classList.remove('text-gray-800');
  document.getElementById('fb-description').value = '';
  document.getElementById('fb-desc-count').textContent = '0';
  document.getElementById('fb-contact').value = '';
  _draftScreenshots = [];
  renderScreenshotGrid();
}

function getDeviceInfoStr() {
  const parts = [];
  const s = document.getElementById('dev-screen');
  if (s && s.textContent) parts.push('屏幕:' + s.textContent);
  const d = document.getElementById('dev-dpr');
  if (d && d.textContent) parts.push('DPR:' + d.textContent);
  const p = document.getElementById('dev-platform');
  if (p && p.textContent) parts.push('平台:' + p.textContent);
  const m = document.getElementById('dev-model');
  if (m && m.textContent) parts.push('型号:' + m.textContent);
  return parts.join(' | ');
}

/* ---- 本地存储 ---- */

function loadLocalFeedback() {
  try {
    const data = localStorage.getItem('tcg_feedback_list');
    _feedbackList = data ? JSON.parse(data) : [];
  } catch (e) { _feedbackList = []; }
}

function saveFeedbackLocal(feedback) {
  _feedbackList.unshift(feedback);
  localStorage.setItem('tcg_feedback_list', JSON.stringify(_feedbackList));
}

function updateFeedbackLocal(id, updates) {
  const idx = _feedbackList.findIndex(f => f.id === id);
  if (idx >= 0) {
    Object.assign(_feedbackList[idx], updates);
    localStorage.setItem('tcg_feedback_list', JSON.stringify(_feedbackList));
  }
}

/* ---- 同步待上传的反馈 ---- */

async function syncPendingFeedback() {
  const pending = _feedbackList.filter(f => !f.synced);
  if (!pending.length) return;
  if (!window.FeedbackBase || !window.FeedbackBase.isAvailable()) return;

  for (const fb of pending) {
    try {
      const fields = {
        '反馈ID': fb.id,
        '问题板块': fb.category,
        '问题描述': fb.description,
        '提交人': fb.reporterName || '匿名',
        '角色': fb.reporterRole === 'leader' ? '组长' : (fb.reporterRole === 'user' ? '组员' : '用户'),
        '平台': fb.platform || '',
        'APP版本': fb.appVersion || '',
        '设备信息': fb.deviceInfo || '',
        '联系方式': fb.contact || '',
        '状态': '待处理',
      };
      if (fb.screenshotTokens && fb.screenshotTokens.length > 0) {
        fields['问题描述'] = fb.description + '\n\n[截图' + fb.screenshotTokens.length + '张,已上传云盘]';
      }
      await window.FeedbackBase.addFeedbackRecord(fields);
      updateFeedbackLocal(fb.id, { synced: true });
    } catch (e) {
      console.warn('同步反馈失败:', fb.id, e);
    }
  }
}
window.syncPendingFeedback = syncPendingFeedback;

/* ---- 反馈列表 ---- */

async function loadAndRenderFeedbackList() {
  // 先显示本地的
  renderFeedbackList();
  // 尝试从云端拉取最新状态
  if (window.FeedbackBase && window.FeedbackBase.isAvailable()) {
    try {
      const items = await window.FeedbackBase.listFeedbackRecords({ pageSize: 50 });
      // 合并云端状态到本地(按反馈ID匹配)
      const user = state && state.currentUser;
      const isLeader = user && user.role === 'leader';
      const cloudItems = items || [];
      cloudItems.forEach(item => {
        const f = item.fields;
        const fbId = f['反馈ID'];
        if (!fbId) return;
        const local = _feedbackList.find(x => x.id === fbId);
        if (local) {
          local.status = f['状态'] || local.status;
          local.analysisSummary = f['AI分析摘要'] || local.analysisSummary;
          local.techDocUrl = f['技术文档链接'] || local.techDocUrl;
        } else if (isLeader) {
          // 组长能看到所有反馈
          _feedbackList.push({
            id: fbId,
            category: f['问题板块'] || '',
            description: f['问题描述'] || '',
            reporterName: f['提交人'] || '',
            reporterRole: f['角色'] || '',
            platform: f['平台'] || '',
            appVersion: f['APP版本'] || '',
            deviceInfo: f['设备信息'] || '',
            status: f['状态'] || '待处理',
            analysisSummary: f['AI分析摘要'] || '',
            techDocUrl: f['技术文档链接'] || '',
            createdAt: f['创建时间'] ? new Date(f['创建时间']).toISOString() : '',
            synced: true,
            _fromCloud: true,
          });
        }
      });
      localStorage.setItem('tcg_feedback_list', JSON.stringify(_feedbackList));
      renderFeedbackList();
    } catch (e) {
      console.warn('拉取云端反馈失败:', e);
    }
  }
}

function renderFeedbackList() {
  const container = document.getElementById('fb-list-container');
  if (!container) return;

  const user = state && state.currentUser;
  const isLeader = user && user.role === 'leader';

  let list = _feedbackList;
  // 非组长只看自己的
  if (!isLeader) {
    const myPhone = user && user.phone;
    list = list.filter(f => f.reporterPhone === myPhone || f._isMine);
  }
  // 筛选
  if (_currentFilter !== 'all') {
    list = list.filter(f => f.status === _currentFilter);
  }

  if (!list.length) {
    container.innerHTML = '<div class="text-center text-gray-400 text-sm py-8">暂无反馈记录</div>';
    return;
  }

  container.innerHTML = list.map(f => {
    const statusColor = f.status === '已解决' ? 'status-done' : f.status === '分析中' ? 'status-pending' : 'bg-gray-100 text-gray-500';
    return `<div class="bg-white rounded-xl p-3 shadow-sm cursor-pointer active:bg-gray-50" onclick="showFeedbackDetail('${f.id}')">
      <div class="flex items-center justify-between mb-2">
        <span class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">${f.category || '未分类'}</span>
        <span class="text-xs px-2 py-0.5 rounded-full ${statusColor}">${f.status || '待处理'}</span>
      </div>
      <div class="text-sm text-gray-800 line-clamp-2 mb-2">${escapeHtml(f.description || '')}</div>
      <div class="flex items-center justify-between text-xs text-gray-400">
        <span>${f.reporterName || '匿名'}</span>
        <span>${formatTime(f.createdAt)}</span>
      </div>
    </div>`;
  }).join('');
}

window.filterFeedback = function(status) {
  _currentFilter = status;
  document.querySelectorAll('.fb-filter-btn').forEach(btn => {
    if (btn.dataset.filter === status) {
      btn.className = 'fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-blue-500 text-white whitespace-nowrap';
    } else {
      btn.className = 'fb-filter-btn px-3 py-1.5 rounded-full text-xs bg-gray-100 text-gray-600 whitespace-nowrap';
    }
  });
  renderFeedbackList();
};

window.showFeedbackDetail = function(id) {
  const fb = _feedbackList.find(f => f.id === id);
  if (!fb) return;
  const statusColor = fb.status === '已解决' ? 'status-done' : fb.status === '分析中' ? 'status-pending' : 'bg-gray-100 text-gray-500';

  let html = `
    <div class="flex items-center gap-2 mb-3">
      <span class="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600">${fb.category || '未分类'}</span>
      <span class="text-xs px-2 py-0.5 rounded-full ${statusColor}">${fb.status || '待处理'}</span>
    </div>
    <div class="text-sm text-gray-800 leading-relaxed mb-4">${escapeHtml(fb.description || '')}</div>
  `;

  if (fb.analysisSummary) {
    html += `<div class="bg-amber-50 rounded-xl p-3 mb-4">
      <div class="text-xs font-bold text-amber-700 mb-1">🤖 AI分析摘要</div>
      <div class="text-xs text-amber-600 leading-relaxed">${escapeHtml(fb.analysisSummary)}</div>
    </div>`;
  }

  if (fb.techDocUrl) {
    html += `<div class="bg-blue-50 rounded-xl p-3 mb-4 cursor-pointer" onclick="window.open('${fb.techDocUrl}')">
      <div class="text-xs font-bold text-blue-700 mb-1">📄 技术文档</div>
      <div class="text-xs text-blue-600">点击查看详细分析报告 →</div>
    </div>`;
  }

  html += `<div class="border-t border-gray-100 pt-3 space-y-2 text-xs text-gray-500">
    <div class="flex justify-between"><span>提交人</span><span class="text-gray-700">${fb.reporterName || '匿名'}</span></div>
    <div class="flex justify-between"><span>平台</span><span class="text-gray-700">${fb.platform || '-'}</span></div>
    <div class="flex justify-between"><span>版本</span><span class="text-gray-700">${fb.appVersion || '-'}</span></div>
    <div class="flex justify-between"><span>设备</span><span class="text-gray-700 text-right max-w-[60%]">${fb.deviceInfo || '-'}</span></div>
    <div class="flex justify-between"><span>提交时间</span><span class="text-gray-700">${formatTime(fb.createdAt)}</span></div>
  </div>`;

  document.getElementById('fb-detail-content').innerHTML = html;
  openModal('modal-fb-detail');
};

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

function formatTime(iso) {
  if (!iso) return '-';
  try {
    const d = new Date(iso);
    const now = new Date();
    const diff = (now - d) / 1000;
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff/60) + '分钟前';
    if (diff < 86400) return Math.floor(diff/3600) + '小时前';
    if (diff < 86400 * 7) return Math.floor(diff/86400) + '天前';
    return d.toLocaleDateString();
  } catch (e) { return '-'; }
}

/* V10.15.0: 页面初始化(defer加载,DOM已就绪) */
if (document.getElementById('screen-feedback')) {
  initFeedbackPage();
}

})();
