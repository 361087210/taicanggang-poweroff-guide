/* ===========================================================
 * 模块: 11-about.js  关于页面 V1.0 (V10.15.0 新增)
 * ===========================================================
 * 内容: 版本历史 / 技术架构 / 开发工具 / 项目地址 / 开发者署名
 * =========================================================== */
(function(){
'use strict';

const VERSION_HISTORY = [
  {
    version: 'V10.15.0',
    date: '2026-09-06',
    highlight: '问题反馈+关于页面+多机型适配测试',
    features: [
      '新增问题反馈功能：按板块提交、支持截图、同步飞书多维表格',
      'AI智能分析：飞书智能体自动分析问题、生成技术文档、通知组长',
      '新增关于页面：版本历史、技术架构、开发工具、项目地址、开发者',
      '多机型屏幕适配测试：覆盖7种主流设备尺寸，消除留白/显示不全',
      '安卓端顶部留白修复：StatusBarOverlaysWebView=false',
    ]
  },
  {
    version: 'V10.14.4',
    date: '2026-09-06',
    highlight: '网页版数据同步修复',
    features: [
      '镜像脚本V2.5三入口遍历：云盘根+配置根+旧根',
      '安卓端82组车型数据完整同步到网页版',
      '注册审批后网页端可登录，账号密码完全一致',
      '自续链修复：5分钟同步周期稳定运转',
    ]
  },
  {
    version: 'V10.14.3',
    date: '2026-09-05',
    highlight: 'iOS PWA适配+网页版上线',
    features: [
      'iOS端PWA standalone模式适配：安全区、触控优化、键盘适配',
      'GitHub Pages网页版发布：iOS组员免安装即可使用',
      '飞书云端数据镜像方案：5分钟自动同步',
      '手机号SHA-256脱敏登录：保护隐私的同时支持跨端登录',
    ]
  },
  {
    version: 'V10.13.0',
    date: '2026-08-20',
    highlight: 'iOS平台支持+注册审批四刀切',
    features: [
      '新增iOS平台Cordova构建支持',
      '注册申请拉取A3四刀切方案：健壮性大幅提升',
      '飞书API三端统一封装：Android/iOS/Web',
    ]
  },
  {
    version: 'V10.9.0',
    date: '2026-08-10',
    highlight: '屏幕自适应+老旧WebView兼容',
    features: [
      '修复Android WebView顶部状态栏遮挡标题问题',
      '修复底部按钮被导航栏遮挡问题',
      '新增全尺寸断点适配：小屏/大屏/矮屏/超长屏/横屏',
      '老旧WebView min-height:0滚动修复',
    ]
  },
  {
    version: 'V10.7.0',
    date: '2026-07-25',
    highlight: '视频缓存+导出文档',
    features: [
      '视频下载缓存机制：离线可看断电操作视频',
      '导出操作指南文档：PDF/Word格式',
      '缓存管理功能：查看/删除已缓存内容',
    ]
  },
  {
    version: 'V10.2.0',
    date: '2026-06-15',
    highlight: '组员管理+批量导出',
    features: [
      '组员管理模块：注册审批、角色分配',
      '批量导出操作记录',
      '缓存管理入口+红点通知',
    ]
  },
  {
    version: 'V5.7.0',
    date: '2026-05-20',
    highlight: '飞书云存储+数据同步',
    features: [
      '飞书开放平台云存储集成',
      '组长/组员数据同步机制',
      '车辆数据云端备份与恢复',
    ]
  },
  {
    version: 'V1.0.0',
    date: '2026-03-01',
    highlight: '项目启动+基础功能',
    features: [
      '太仓港商品车断电操作指导APP立项',
      '车型数据库基础架构',
      '断电操作步骤标准化',
      'Android端首版发布',
    ]
  },
];

const TECH_STACK = [
  { icon: '📄', name: '前端', value: 'HTML5 / CSS3 / Vanilla JavaScript' },
  { icon: '📱', name: '移动端', value: 'Apache Cordova 12 + cordova-android 13' },
  { icon: '☁️', name: '云存储', value: '飞书开放平台 OpenAPI / Bitable' },
  { icon: '🌐', name: '网页端', value: 'PWA + GitHub Pages' },
  { icon: '⚙️', name: 'CI/CD', value: 'GitHub Actions + 自续链同步' },
  { icon: '🔒', name: '安全', value: 'SHA-256 密码哈希 / 手机号脱敏' },
];

const DEV_TOOLS = [
  { icon: '💻', name: 'IDE', value: 'Trae / VS Code' },
  { icon: '🧪', name: '测试', value: 'Chrome DevTools 设备仿真' },
  { icon: '📦', name: '构建', value: 'Cordova CLI' },
  { icon: '📊', name: '版本管理', value: 'Git + GitHub' },
  { icon: '🤖', name: 'AI辅助', value: 'Trae AI 编程助手' },
  { icon: '🎨', name: '设计', value: '原生CSS + SVG图标' },
];

const PROJECT_LINKS = [
  { icon: '📦', name: 'GitHub 仓库', url: 'https://github.com/361087210/taicanggang-poweroff-guide' },
  { icon: '🌐', name: 'GitHub Pages', url: 'https://361087210.github.io/taicanggang-poweroff-guide/demo.html' },
  { icon: '📁', name: '飞书数据平台', url: 'https://mwawzzuvb7f.feishu.cn/drive/home/' },
];

let _expandedVersion = null;

window.initAboutPage = function() {
  renderAboutPage();
};

function renderAboutPage() {
  const html = `
    <div class="sticky top-0 z-30 bg-white shadow-sm">
      <div class="pt-12 px-4 pb-3 flex items-center gap-3">
        <button onclick="showScreen('screen-my')" class="w-8 h-8 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h2 class="text-base font-bold">关于</h2>
      </div>
    </div>
    <div class="flex-1 scroll-y px-4 pb-24 pt-4 space-y-4">
      <!-- Logo & 版本 -->
      <div class="bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 rounded-2xl p-6 text-white text-center">
        <div class="w-16 h-16 mx-auto mb-3 bg-white/20 rounded-2xl flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-8 h-8">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <div class="text-lg font-bold">太仓港断电指导</div>
        <div class="text-xs text-white/60 mt-1">V${APP_VERSION || '10.15.0'}</div>
        <div class="text-xs text-white/50 mt-0.5">商品车断电操作标准化平台</div>
      </div>

      <!-- 版本历史 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>📋</span>
          <span class="text-sm font-bold text-gray-700">版本历史</span>
          <span class="text-xs text-gray-400 ml-auto">共 ${VERSION_HISTORY.length} 个版本</span>
        </div>
        <div class="version-timeline space-y-1" id="about-version-list">
          ${VERSION_HISTORY.map((v, i) => renderVersionItem(v, i)).join('')}
        </div>
      </div>

      <!-- 技术架构 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>🏗️</span>
          <span class="text-sm font-bold text-gray-700">技术架构</span>
        </div>
        <div class="space-y-2">
          ${TECH_STACK.map(t => `
            <div class="flex items-center gap-3 py-1.5">
              <span class="text-base">${t.icon}</span>
              <span class="text-xs text-gray-500 w-16">${t.name}</span>
              <span class="text-xs text-gray-700 flex-1">${t.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 开发工具 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>🔧</span>
          <span class="text-sm font-bold text-gray-700">开发工具</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${DEV_TOOLS.map(t => `
            <div class="flex items-center gap-2 py-1.5 px-2 bg-gray-50 rounded-lg">
              <span class="text-sm">${t.icon}</span>
              <div>
                <div class="text-xs text-gray-700 font-medium">${t.name}</div>
                <div class="text-xs text-gray-400">${t.value}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 项目地址 -->
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="px-4 pt-3 pb-2 flex items-center gap-2">
          <span>🌐</span>
          <span class="text-sm font-bold text-gray-700">项目地址</span>
        </div>
        ${PROJECT_LINKS.map(l => `
          <div class="bs-item" onclick="openExternalLink('${l.url}')">
            <div class="flex items-center gap-3">
              <span class="text-base">${l.icon}</span>
              <span class="text-sm text-gray-800">${l.name}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-300"><path d="M9 6l6 6-6 6"/></svg>
          </div>
        `).join('')}
      </div>

      <!-- 开发者 -->
      <div class="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 text-white">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-lg font-bold">云</div>
          <div>
            <div class="font-bold">云飞呀云飞</div>
            <div class="text-xs text-white/60">全栈开发者</div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-sm text-white/80">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>QQ: 361087210</span>
        </div>
      </div>

      <div class="text-center text-xs text-gray-400 py-2">
        © 2026 太仓港断电指导 · 保留所有权利
      </div>
    </div>
  `;
  document.getElementById('screen-about').innerHTML = html;
}

function renderVersionItem(v, index) {
  const isLatest = index === 0;
  const isExpanded = _expandedVersion === v.version;
  return `
    <div class="version-item">
      <div class="flex items-start gap-3 py-2 cursor-pointer" onclick="toggleVersion('${v.version}')">
        <div class="version-dot w-2.5 h-2.5 rounded-full ${isLatest ? 'bg-blue-500' : 'bg-gray-300'} mt-1.5 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold ${isLatest ? 'text-blue-600' : 'text-gray-700'}">${v.version}</span>
            ${isLatest ? '<span class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">最新</span>' : ''}
            <span class="text-xs text-gray-400 ml-auto">${v.date}</span>
          </div>
          <div class="text-xs text-gray-500 mt-0.5">${v.highlight}</div>
          ${isExpanded ? `
            <div class="mt-2 pl-2 border-l-2 border-gray-100 space-y-1">
              ${v.features.map(f => `<div class="text-xs text-gray-500 flex items-start gap-1.5"><span class="text-blue-400 mt-0.5">•</span><span>${f}</span></div>`).join('')}
            </div>
          ` : ''}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}" style="margin-top:4px;"><path d="M9 6l6 6-6 6"/></svg>
      </div>
    </div>
  `;
}

window.toggleVersion = function(version) {
  _expandedVersion = _expandedVersion === version ? null : version;
  const list = document.getElementById('about-version-list');
  if (list) {
    list.innerHTML = VERSION_HISTORY.map((v, i) => renderVersionItem(v, i)).join('');
  }
};

window.openExternalLink = function(url) {
  if (window.cordova && window.cordova.InAppBrowser) {
    cordova.InAppBrowser.open(url, '_system');
  } else {
    window.open(url, '_blank');
  }
};

/* V10.15.0: 页面初始化(defer加载,DOM已就绪) */
if (document.getElementById('screen-about')) {
  initAboutPage();
}

})();
