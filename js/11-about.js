/* ===========================================================
 * 模块: 11-about.js  关于页面 V1.0 (V10.15.0 新增)
 * ===========================================================
 * 内容: 版本历史 / 技术架构 / 开发工具 / 项目地址 / 开发者署名
 * =========================================================== */
(function(){
'use strict';

const VERSION_HISTORY = [
  {
    version: 'V10.15.14',
    date: '2026-09-07',
    highlight: '紧急修复: 改密后换设备登录仍报密码错误(pw_ts仲裁边界+镜像丢密码)',
    features: [
      '根因1: 05-sync.js/09-web-sync.js密码仲裁 cuTs>loTs——旧版本改密不写pw_ts(=0),云端与本地均为0时严格大于永不成立,新密码永不被采纳',
      '根因2: sync_web_data.js多源合并approved_users.json只按文件时间戳取整个对象,新根文件时间戳新但密码旧会冲掉旧根改密后的新哈希',
      '修复1: 密码仲裁改为 cuTs>=loTs,相等时以云端权威源为准,新设备/旧设备均能拿到新密码',
      '修复2: sync_web_data.js新增mergeUser,密码字段单独按pw_ts仲裁(>=),备份与verify快照统一走mergeUser',
      '全量回归0 FAIL',
    ]
  },
  {
    version: 'V10.15.13',
    date: '2026-09-07',
    highlight: '紧急修复: 密码跨设备同步整表覆盖竞态+网页端改密假成功',
    features: [
      '根因1: pushApprovedUsersToFeishu整表覆盖竞态——组长在旧设备审批/删除组员时,本机USERS表缺其他组员新改的密码,覆盖云端把别人新密码冲回旧值',
      '根因2: 网页端改密假成功——网页版只读镜像CORS不可达飞书API,push被封堵,改密只改本浏览器不推云端',
      '修复1: pushApprovedUsersToFeishu内部强制fullMerge,按pw_ts仲裁保留本机新密码+补充云端用户',
      '修复2: 网页端禁止改密,引导至安卓APP操作',
      '继承V10.15.12登录失败拉云端重试',
    ]
  },
  {
    version: 'V10.15.12',
    date: '2026-09-06',
    highlight: '紧急修复: 旧设备新密码登录报密码错误',
    features: [
      '根因: doLogin仅本地无账号时才拉云端,本地旧密码哈希验证失败直接报错返回,云端最新密码永远没机会参与验证(V10.15.11修复缺口)',
      '修复: 本地验证失败→拉云端最新名单(pw_ts仲裁采纳新哈希)→重试验证一次再判定',
      '覆盖: 旧设备新密码登录/云端未更新不误放行/新设备建号登录,网页端共用链路同步受益',
      '新增4项登录闭环测试,专项40项+全量回归全绿',
    ]
  },
  {
    version: 'V10.15.11',
    date: '2026-09-06',
    highlight: '问题反馈多端同步+组长状态审核+密码跨设备同步',
    features: [
      '问题反馈多端同步:组员反馈按提交人跨设备拉回(换机/重装不丢),云端状态/AI摘要/技术文档链接同步展示',
      '组长状态审核:组长可将反馈标记为已解决/待处理(云端Bitable回写),全端同步可见',
      '修复组长角色判断Bug:反馈模块4处误用role===leader(实际为admin)致审核按钮永不显示、云端全量反馈拉不到',
      '密码跨设备同步:改密推送云端+账号级pw_ts时间戳仲裁,旧设备拉取采纳新密码哈希(修复改密后换设备新密码失效)',
      '权限加固:setFeedbackStatus/resetMemberPass函数层组长守卫,禁重置组长账号密码',
      '网页端反馈镜像:web-data/feedback_data.json只读镜像(脱敏),写入/审核封堵并引导走安卓端',
      '版本三源对齐:config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.11',
      '继承 V10.15.10 网页版分享降级链版全部能力',
    ]
  },
  {
    version: 'V10.15.10',
    date: '2026-09-06',
    highlight: '网页版分享降级链',
    features: [
      '文件导出降级链:系统分享面板不可用时自动降级浏览器下载(a.download→window.open→msSaveBlob)',
      '文本分享execCommand保底:剪贴板API不可用的旧浏览器/非HTTPS环境仍可复制断电信息',
      'Web Share API优先逻辑不变,降级仅在系统分享彻底不可用时触发',
      '浏览器E2E实测:PDF/Excel/Word三格式全部成功触发下载',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.10',
      '继承 V10.15.9 批量导出全格式去图+网页端账号同步修复版全部能力',
    ]
  },
  {
    version: 'V10.15.9',
    date: '2026-09-06',
    highlight: '批量导出全格式去图+网页账号登录修复',
    features: [
      '批量导出Word/PDF/Excel全部不含图片(仅单车导出含图),减小体积加快导出',
      '修复安卓端注册账号无法在网页端登录:飞书双根approved_users.json合并去重,镜像账号从1个恢复到10个',
      '弱网优化:网页镜像fetch加10s超时,不再挂起阻塞UI',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.9',
      '继承 V10.15.8 批量导出PDF不含图片版全部能力',
    ]
  },
  {
    version: 'V10.15.8',
    date: '2026-09-06',
    highlight: '批量导出PDF不含图片',
    features: [
      '_buildExportHtml() includeImages 默认值改为 false,批量导出PDF不再内嵌车辆照片,仅显示照片数量',
      'exportData() PDF 分支跳过照片预取,导出速度更快',
      '单车详情页Word/PDF导出仍保留照片内嵌,不影响单车导出体验',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.8',
      '继承 V10.15.7 批量导出Word不含图片版全部能力',
    ]
  },
  {
    version: 'V10.15.7',
    date: '2026-09-06',
    highlight: '批量导出Word不含图片',
    features: [
      '数据中心批量导出的Word不再内嵌车辆照片，仅显示照片数量，避免文档体积过大导致微信/钉钉分享超限',
      '单车详情页Word导出仍保留照片内嵌，不影响单车导出体验',
      'PDF批量导出保持含图不变',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.7',
      '继承 V10.15.6 账号级字段选项云同步版全部能力',
    ]
  },
  {
    version: 'V10.15.6',
    date: '2026-09-06',
    highlight: '账号级字段选项云同步',
    features: [
      '断电位置/钥匙处理方式/断电步骤字段选项升级为账号级云同步(飞书「偏好设置」子目录 field_options.json)',
      '组长端增删改字段选项后自动上传云端，换机/重装登录即可同步，修复本地持久化跨设备不共享问题',
      '组员/新设备登录或拉取数据时自动下载云端选项，与组长端保持一致',
      '本地持久化仍为兜底，云端为权威自定义层(默认种子+数据库内容为基底)',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.6',
      '继承 V10.15.5 反馈迭代版全部能力',
    ]
  },
  {
    version: 'V10.15.5',
    date: '2026-09-06',
    highlight: '字段选项模块化 + 照片分板块上传',
    features: [
      '批量导出 Word 结构调整为「首张总表(不含图片) + 每车含图分表」，与车辆详情页导出一致',
      '断电位置/钥匙处理方式/断电步骤字段选项模块化，按当前数据库内容生成可增删改选项',
      '媒体照片分板块上传(车辆外观/车钥匙/断电位置三板块, 每板块<=5张)，压缩提升至1600px/90%',
      '同步/导出携带 photoSections/photoLabels/keyPhotoRemark 元数据',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.5',
      '继承 V10.15.4 问题反馈修复版全部能力',
    ]
  },
  {
    version: 'V10.15.4',
    date: '2026-09-06',
    highlight: '问题反馈修复版',
    features: [
      '批量导出 Word 在总表后追加每车含图分表，修复反馈「批量导出Word不含图片」',
      '问题反馈板块选项由 8 项细化为 15 项，覆盖车型/搜索/照片/详情/步骤/钥匙/单车导出等细分场景',
      '车辆照片压缩由 800px/70% 提升为 1280px/80%，修复反馈「照片压缩太严重」',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.4',
      '继承 V10.15.3 反馈自动分析管道与飞书群通知闭环全部能力',
    ]
  },
  {
    version: 'V10.15.3',
    date: '2026-09-06',
    highlight: '真实DeepSeek分析 + 飞书群通知闭环',
    features: [
      '反馈自动分析管道升级为真实 DeepSeek LLM 分析，配置 Secrets 后生成 AI 摘要',
      '修复飞书群通知推送参数缺失，打通提交→AI分析→飞书群通知→迭代闭环',
      '状态闭环回写：待处理→分析中→已解决，回写摘要与文档链接',
      '端到端验证通过：DeepSeek 摘要格式区别于内置模板，测试记录已清理',
    ]
  },
  {
    version: 'V10.15.2',
    date: '2026-09-06',
    highlight: '数据后端升级 + 安全加固',
    features: [
      '新增飞书多维表格(Bitable)后端数据层与 Drive→Bitable 迁移脚本',
      '新增审计日志模块：环形缓冲 500 条，删除/清空操作留痕',
      '构建期密钥升级为 XOR+base64 双重加密，明文 Secret 永不落盘',
      '新增 R8/ProGuard 加固钩子，保护 Cordova JS Bridge 防反射剥离',
    ]
  },
  {
    version: 'V10.15.1',
    date: '2026-09-06',
    highlight: '版本对齐与发布门禁',
    features: [
      '三处版本号对齐：config.xml / version.json / bootstrap APP_VERSION 统一为 10.15.1',
      '新增 scripts/check_version_consistency.js 发版门禁，纳入 npm test:all',
      '修复 SDK 数据源解析与参数名契约，反馈提交与读取更稳定',
      '关于页版本号、同步屏「本地版本」显示同步刷新',
    ]
  },
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
  window.initAboutPage();
}

})();
