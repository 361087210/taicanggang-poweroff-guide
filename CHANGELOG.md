# Changelog

本文件记录太仓港商品车断电操作标准化指导平台的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [10.27.5] - 2026-11-24

### 播放源可配置：CDN 主 + Release 备，带源健康记忆

#### ✨ 新增:
- `MEDIA_PLAYBACK_SOURCES` 注册表（`js/00-bootstrap.js`）：播放源从"写死一个 URL"变成"有序候选链"。在 `js/00-config.js` 填 `MEDIA_CDN_BASE` 即启用对象存储为主源，Release 自动降为备源；留空则与 10.27.4 **逐字节一致**（零风险）
- 只接受 `https:` 绝对地址：`http:`（混合内容会被浏览器拦）、相对路径、空白一律忽略并保持单源
- 源健康记忆 `MEDIA_SOURCE_HEALTH`：失败源 30 分钟内排到候选链末尾，成功一次立刻恢复主源优先；全部源都坏过时仍按序试一遍而不是直接空态

#### 🔄 变更:
- 源② 从"单串直链"改为候选链 `_playCandidateChain()`：主源 onerror / 8 秒停滞 → 自动降级备源 → 才进入别名 / 飞书 / CDN 回退；只有成功源的 URL 写入落盘缓存
- 别名回退（改名后的视频）同样走候选链，不再比未改名视频少一层保障
- 每次源尝试都带会话守卫：关闭播放器后不再续拉流

#### 🧪 测试:
- 新增 `tests/test_v10275_playback_sources.js`（31 断言）：向后兼容、非法配置拒绝、健康记忆 TTL、**候选链假播放器实跑**（真回退而非文本断言）、接线守卫（改回单串会被 G2 抓）
- 全量 77/77

#### 📄 文档:
- `docs/VIDEO_SOURCE_EVAL.md`：三源评估（实测、加权矩阵、一票否决、12 问清单、迁移 5 步、CI 阈值）
- `scripts/bench_media_sources.js` + `docs/media_source_bench.json`：可复现基准与留痕
- `docs/RELEASE_V10.27.5.md`

## [10.27.4] - 2026-11-24

### 发版修复（功能同 10.27.3）

#### 🐛 修复:
- 补齐 `docs/RELEASE_V10.27.4.md`：发版流程 `body_path` 要求存在该发布说明文件，缺失会让 Android/iOS 在创建 Release 前失败（10.27.3 的 tag 因此未产出 Release）
- 版本号 10.27.3 → 10.27.4（10.27.3 tag 受保护不可移动），功能与 10.27.3 完全一致

#### ✨ 纳入本版的功能:
- 车型详情页照片/视频叠加资源库状态徽标（正常/共享/云端/缺失/低清）与板块汇总
- 点徽标 → 资源库自动翻页并高亮该资产；板块「资源库 ›」→ 只看该车型资产
- 索引加载去重，索引不可用时静默降级

## [10.27.3] - 2026-11-24

### 车型详情 ↔ 资源库双向联动

#### ✨ 新增:
- **详情页状态徽标**: 照片格子 / 视频卡片渲染后由资源库索引补充徽标 —— 正常 / 共享 / 云端 / 缺失 / 低清；缺失项红色标注，共享、云端、低清一眼可辨
- **板块汇总**: 「车辆照片」「视频演示」标题旁显示本车型的「N 项 · N 缺失 · N 共享 · N 低清」，各媒体类型独立统计
- **点按定位**: 点徽标 → 资源库自动翻到该资产所在分页并高亮该行（`openPath`）
- **只看这台车**: 板块「资源库 ›」→ 资源库只显示该车型引用的资产，顶部可一键清除收窄（`openForVehicle`）—— 与既有「打开车型」形成双向闭环

#### 🔧 工程:
- 索引加载去重：详情页装饰与台账页共用同一次 `media_library.json` 请求；索引不可用时静默降级，详情页照常可用
- 收窄后的分页/总数统一走 `filteredAssets()`，避免「只看这台车」时页码与实际列表不一致

#### 🧪 测试:
- 新增 `tests/test_v10273_media_link.js`（22 断言）：徽标文案与低清拼接、板块汇总、重复装饰幂等、车型收窄与清除、120 条资产的分页定位与唯一高亮、前端接线、并发只拉一次索引

## [10.27.2] - 2026-11-24

### 修通依赖升级的 CI：没有密钥不该算失败

#### 🔴 修复:
- `ci.yml` 的「Secret注入基线校验」原本只在 **fork PR** 时降级，而 dependabot 的 PR 来自**同仓库分支**——拿不到 secrets 却仍按严格模式校验，于是 6 个依赖升级 PR 全红
- 后果是 18 个依赖漏洞（9 high）的升级 PR 永远合不进来：门禁把"正常状态"判成了失败
- 现改为 CI 内一律 `FEISHU_STRICT=0`（缺失仅告警）。真实注入仍只发生在 `android-release.yml` / `ios-release.yml`，那边缺 secrets 依旧直接失败

#### 🧪 测试:
- 新增 `tests/test_v10272_ci_pr_secrets.js`（15 断言）：钉住 CI 不依赖 secrets、真实构建未被降级、降级不等于删掉校验、dependabot 回路仍在

## [10.27.1] - 2026-11-24

### 运维与可信度：RUNBOOK、严格规则集模板、覆盖率双口径

#### 🟢 运维:
- 新增 `docs/RUNBOOK.md`：线上拓扑、网页/App/数据三种回滚、常见故障处置（含 Pages 重复 artifact、规则集拒推、媒体 404）、季度恢复演练、值班升级路径

#### 🟢 治理:
- 新增 `.github/rulesets/branch-strict.json` / `tag-protect.json`：自动化能满足必需检查后，一键恢复「强制 PR + 必过 CI/Secret Scan」

#### 🔧 可信度:
- 覆盖率门禁同时打印 **可归因 98.09%** 与 **整体 80.45%（不可归因占源码行 18.0%）**

#### 🧪 测试:
- 去掉两处写死数据量（真缺失 64 / 车型 100），改为与索引明细、镜像车型数互证——数据增长不再让 CI 误红
- 新增 `tests/test_v10268_governance_docs.js`（23 断言）

## [10.27.0] - 2026-11-23

### 资源库分页 + 车型信息双向强关联

> 资源库原本一次性渲染 300+ 行(首屏 DOM 约 304KB)，且台账是发版快照 —— 车型侧改了图，资源库不会跟着变；资源库删了文件，车型的照片计数与板块标签也不会跟着改。

#### ⚡ 资源库:
- 改为 **50 条/页** 分页渲染（首屏 DOM 约 **304KB → 44KB**），底部「上一页 / 第 x/y 页 / 下一页」，越界自动钳制
- 切换筛选或输入搜索自动回到第 1 页；搜索只重画计数/列表/分页区，输入框不失焦

#### 🔗 车型 ↔ 资源库强关联:
- **车型改了 → 资源库立即看到**：列表合并「索引快照 + 车型当前引用」，新增/换图以「新增」状态出现；车型侧删掉的图，索引行自动隐藏（不再有幽灵行）
- **资源库改了 → 车型信息跟着更新**：上传/删除同步维护 `photoPaths/videoPaths` 与 `photos/videos` 计数，并保持 `photoSections/photoLabels` 与照片**按下标对齐** —— 修掉「删掉第 1 张后，第 2 张顶着第 1 张板块/标签」错位
- **回写飞书**：资源库增删后 3 秒防抖复用既有上传管线，组员端与 cron 索引不再停在旧状态
- **云端核对不误报**：已知集合改为「索引 + 实时引用」并集

#### 🔍 清晰度 (照片/视频):
- 现场照片本地压缩 **1600px/q0.9 → 2400px/q0.92**；上云归一 **1280px/q0.85 → 2560px/q0.9**，放大查看不再糊
- 查看器高清升级阈值 **700 → 1600**：433px 内置旧图、1280px 旧上传图都会自动探测并热替换云端高清版
- 视频不做二次压缩（沿用原始文件）；Release 上极小的历史视频为源文件本身分辨率低，需重新上传原片

#### 🧯 媒体缺失不阻断业务:
- **媒体只是补充**：照片/视频分离上传失败（目录不可用 / 权限 / 网络）不再让整次同步失败，车型文字信息照常上云
- 上云副本自动剔除未上传的 base64 媒体，并同步裁剪 `photoSections/photoLabels`，路径与计数始终对齐；本地数据不改，下一轮自动重试
- 从飞书拉取时保留本机尚未上云的 base64 媒体，不会被云端副本覆盖丢失
- 资源库预览兼容「车型实时新增」行；图片/视频文件缺失时显示明确占位，不报错、不影响其他操作

#### 🧩 车型增删改查细化:
- 新增/编辑拦截**同名显示名称**（目录名即归属，同名会共用媒体目录、串车）
- 删除提示改为真实语义：只删车型记录，独享媒体保留在云端成为孤儿（可在资源库清理），避免误删原件
- 删除/编辑均不依赖媒体文件存在与否

#### 🛡 门禁 / 🧪 测试:
- `ci.yml` 新增「资源库索引一致性」：`npm run check:media-library`
- `tests/test_v10257_media_library.js` 扩到 **86 断言**（分页 / 双向联动 / 计数重算 / 删除时元数据同步剔除）
- `tests/test_v10251_media_fallback.js` 扩到 **27 断言**（新增上云快照剔除、拉取保留待传媒体、清晰度参数回归）

---

## [10.26.5] - 2026-11-23

### 车型信息 ↔ 资源库：把「对不上」变成可见

> 此前：删掉车型后它的照片目录变成隐形孤儿；改名后只显示"照片缺失"看不出原因；新增车型还没素材时**资源库里根本没有这台车**。

#### 🟢 索引新增（`media_library.json`）:
- `vehicles[]`：每台车的 照片/视频/缺失 计数（**含 0 素材车型**）
- `unownedFolders[]`：有文件、但没有任何车型引用的目录（删车/改名残留）
- `renamedRefs[]`：引用还写旧目录、文件其实在新目录 —— 带上 `declared` 与 `foundAt`

#### 🟢 界面:
- 资源库顶部出现「⚑ 车型与资源有 N 处对不上：X 台无素材 · Y 个无主目录 · Z 条改名失配」，点击进入新增的「断链」筛选

#### 🔧 修复:
- 改名检测抽成纯函数 `detectRenamedRefs`（共享/未归类目录**不算**改名，避免误报）
- CSP `connect-src` 放行 `https://361087210.github.io`：App 内本地索引缺失/过期时可拉线上最新索引

#### 🧪 测试:
- 新增 `tests/test_v10265_vehicle_media_binding.js`（22 断言）：车型 id 覆盖、无素材计数、无主目录与磁盘实算一致、改名检测（含反例）、UI 接线、索引幂等



### 视频内容指纹：从「约定」变成「可验证事实」

> 视频不入仓库，manifest 里的 sha256 长期为空——「通用断电视频被 13 个车型共用」只是约定。一旦有人换了同名文件，所有引用它的车型会静默变成错片。

#### 🟢 数据:
- `docs/video_fingerprints.json` 入库 **92 条**（46 个原始文件名 + 46 个资产名）
- manifest 视频指纹覆盖 **46/49 = 94%**；`audit:media` 显示 **59/62 条引用已有 sha256**（此前 0 条）
- **两个共享视频 100% 覆盖**：`通用断电视频.mp4`(13 台)、`长安UNI__UNI_T.mp4`(2 台) → C8「共享视频无内容指纹」告警消失

#### 🛠 工程:
- 新增工作流 `Fingerprint Videos`：从 Release 拉映射表点名的资产 → 算 sha256 → `--release-map` 把 `tcgv_*.mp4` 的指纹回填到原始名 → 重建 manifest/索引 → 有变化才提交；**每周一复查**（同名替换会在 diff 里暴露）
- 为什么在 CI 跑：本地下载 449MB 实际只有 ~50KB/s；GitHub Runner 拉自家 Release 是内网速度

#### 🔧 修复:
- `fingerprint_videos.js` 新增 `--release-map`（资产名 → 原始名反向映射）；`--check` 会提示本地缺哪些已入库视频

#### 🧪 测试:
- 新增 `tests/test_v10264_video_fingerprints.js`（20 断言）：指纹形态、映射生效、manifest 覆盖 ≥90%、**共享视频 100%**、C8 告警消失、工作流接线

> 遗留：3 个视频（`长安深蓝(G318)_v2` 等）在映射表里有条目但 Release 里没有对应资产，指纹暂缺 6%（待补传）。



### 修复 31 条照片 404 引用（管线自动回写 + 双重卡口）

> 迁移脚本把被多车型复用的照片挪进 `vehicle_images/_共享/`，却没回写引用 —— 云盘里看得到图、App 里 404；而每次云端同步又把"车型目录路径"写回产物。

#### 🔴 修复:
- 同步流水线在 `gen_vehicles_data` 之后自动执行 `fix_shared_refs.js`（**幂等**），把失配引用改写到 `vehicle_images/_共享/`
- `audit:media` 的「引用失配」**31 → 0**，可直接命中的照片 **172 → 203**（真缺失仍 64 条，需业务补拍）

#### 🛡 门禁:
- 同步流水线**提交前**执行 `fix_shared_refs.js --verify`
- `ci.yml` 新增独立 step「照片引用完整性」，退出码直接传播（不加 `|| true`）

#### 🧪 测试:
- 新增 `tests/test_v10263_shared_refs.js`（16 断言）：用**与 App 同一套**路径解析规则（`js/00-media-paths.js#resolveLocalFile`）验证 0 失配、管线顺序、CI 接线、幂等



### 样式提速：运行时 Tailwind → 预编译静态 CSS

> `vendor/tailwind.js` 是 Play CDN 运行时 JIT（441KB，官方明确不可用于生产），要在浏览器里扫描 DOM 再生成 CSS。换成 25KB 预编译产物。

#### ⚡ 性能:
- `vendor/tailwind.js`（441KB）→ `css/tailwind.build.css`（**25KB / gzip 5KB**）：首屏少下载 **415KB**，并去掉运行时扫描开销

#### 🛠 可复现:
- 新增 `scripts/build_tailwind_css.js`（`npm run build:tailwind`）：扫描 `demo.html` + `js/**/*.js`（**模板字符串里的类名也收集**）
- 两条发版工作流的 vendor 校验同步去掉 `tailwind.js`

#### 🧪 门禁:
- 新增 `tests/test_v10261_tailwind_static.js`（20 断言），核心是**类名覆盖率**：把模板里用到的工具类逐个对产物校验，漏一个即红 —— 防「加了类名忘重建 CSS → 局部没样式」
- 等价性验证：无头 Chrome 对照 148 个可见元素 × 29 项计算样式，与运行时版本 **0 差异**



### 首屏提速：导出组件按需加载 + 图片瘦身 + 参考资料出仓

> 一句话总结：只查一台车也要先下 1.8MB 导出套件的日子结束了 —— 模拟 4G 下 FCP **6.9s → 3.6s**。

#### ⚡ 性能:
- **导出组件按需加载**：`xlsx`(861KB)/`jsPDF`(356KB)/`autotable`/`html-docx`(406KB)/`html2canvas`(194KB) 从 `<head>` 移出（此前**没有 defer**，阻塞首屏），改由 `js/04-export.js` 的 `ensureExportLibs()` 首次导出时注入
- **图片重编码**：12 张 PNG 用调色板 PNG 重编码（同路径同扩展名）：4.96MB → **1.89MB**

#### 🧹 工程:
- `docs/参考资料`（57MB）移出仓库 → Release [refdocs-2026-11](https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/refdocs-2026-11)；工作树 **75MB → 18MB**
- 安卓发版校验由「`demo.html` 里必须有导出库 `<script>`」改为「装载清单含 5 个路径」+「`demo.html` 不得再引导出库」

#### 🧪 测试:
- 新增 `tests/test_v10260_lazy_export.js`（33 断言）
- 订正 `tests/test_v106_fixes.js` A1：原断言绑死在实现细节上，改为断言意图



### 资源库增强: 云端实测对账 + 组长上传/删除

> 一句话总结: 在 V10.25.7/V10.25.8 台账基础上接入飞书云端实测 —— 逐项标记「云端✓/云端✗」、列出云端有但台账无引用的孤儿文件, 并让组长在 App 内直接上传/删除车型照片与视频。

#### 🟢 新增:
- **核对云端**: 扫描 `APP数据备份/vehicle_images|vehicle_videos` 实际文件, 与台账逐项比对, 行内显示云端✓/云端✗; 顶部显示云端照片/视频/无台账文件计数
- **云端孤儿**: 云端存在但台账无引用的文件进入「未归类/孤儿」筛选, 可预览与删除
- **组长上传**: 选择车型后批量上传, 自动创建 `<车型目录>`、按 `<车型>_p<序号>_<hash>` 命名并回写 `photoPaths`/`videoPaths`
- **组长删除**: 预览中删除云端文件, 同步解除所有车型引用, 二次确认
- **云端加载预览**: 台账缺失/孤儿但云端存在时, 可直接从飞书拉取图片/视频预览

#### 🔵 变更:
- 保留 V10.25.8 索引位于仓库根(`media_library.json`)与 Pages 可访问性, 以及全部台账/筛选/搜索/缺失清单导出能力
- 版本七源同步至 `10.26.0`(102600), `sw.js` 缓存名升级 `tcg-poweroff-v10.26.0`

#### 🔴 修复:
- **App 内「资源索引加载失败」**: `media_library.json` 未随 APK/IPA 打包进 `www/`, 且 `fetch` 在 `file://`/`app://` 协议下不可用 —— Android/iOS 打包脚本补拷索引并加存在性校验, 前端加载改为 `fetch → XHR → 线上索引` 三级兜底

## [10.25.9] - 2026-11-23

### 资源库排版修复（截图复核时发现）

#### 🔴 修复:
- **筛选条被压塌**: `.screen` 是 `display:flex; flex-direction:column; overflow:hidden`，直接子项默认 `flex-shrink:1`，带 `overflow-x:auto` 的筛选行被压缩到 **4px**（真机上只剩一条边线，根本点不到）。现改为「头部固定 + 正文 `.scroll-y flex-1 min-h-0`」，与其他屏幕一致
- **列表标题重复**: 照片行标题用「车型名」、下行又写一遍车型名 → 标题改为**文件名**，车型名只保留下行

#### ✅ 验证方式:
用无头 Chrome（CDP + 430×932 移动视口）逐屏截图复核：登录 / 车型手册 / 车型详情 / 资源库 / 缺失筛选 / 预览弹层 / 数据中心 / 我的 / 关于



### 修复资源库索引的发布路径

> v10.25.7 把索引生成到 `docs/`，而 Pages 的发布白名单不含 `docs/` —— 网页端点开资源库会报"索引加载失败"（线上实测 404）。本版修掉。

#### 🔴 修复:
- `media_library.json` 移到**仓库根**（与 `version.json` / `vehicles_data.js` 同级），`deploy-pages` 的发布清单与触发路径同步补上
- 前端 `INDEX_URL` 改为 `media_library.json`

#### 🛠 自动化:
- `sync-web-data` 流水线在生成 `vehicles_data` / 媒体映射后再跑 `gen_media_library`，并把 `media_library.json` 纳入自动提交

#### ✅ 不变:
- 资源库功能本体（314 条台账、五档计数、筛选/搜索、预览、一键复制缺失清单）与 v10.25.7 相同
- 测试 `test_v10257_media_library`（39 断言，含生成器幂等与索引契约）全绿



### 新增「资源库」: 车型照片/视频统一台账 + 缺失清单导出

> 一句话总结: 照片和视频不再散落在四个地方靠脚本找 —— App 里有了一页台账，缺什么、哪些是共享、哪些在云端、哪些没人引用，一眼可见。

#### 🟢 新增:
- **资源库页面**(我的 → 资源库 / 侧滑菜单): 资产/照片/视频/缺失/共享 五档计数
- **筛选与搜索**: 缺失 · 共享 · 云端视频 · 未归类/孤儿 · 照片 · 视频; 车型名/文件名关键字
- **预览**: 照片大图、视频播放、缺图提示; 显示路径/大小/指纹; 复制路径、跳转车型
- **复制缺失清单**: 一键导出 `车型\t类型\t文件`, 直接发给补拍/补传的人

#### 🛠 工程:
- `scripts/gen_media_library.js` → `docs/media_library.json`(314 条台账: 265 照片 + 49 视频; 缺失 63 / 共享 14 / 云端 49 / 孤儿 16), 路径规则复用 `js/00-media-paths.js`, `--check` 可做漂移门禁
- `js/13-media-library.js` 新模块 + demo.html 屏幕容器/双入口 + 返回键映射 + sw.js 预缓存

#### 🧪 测试:
- `tests/test_v10257_media_library.js`(39 断言): 纯函数(筛选/统计/清单) + 索引契约(统计与实算一致、无 U+FFFD、缺失数 63 与 audit 口径一致) + 接线 + 生成器幂等



### 数据同步修复: 收流整段解码 + 镜像冻结两周后恢复

> 一句话总结: 找到并修掉「自动同步反复把中文写坏」的真根因 —— 收流时逐块 toString 把多字节字符切成两半; 数据镜像同步恢复并全量刷新。

#### 🔴 修复(根因):
- **收流逐块解码切碎汉字**: `_req/_reqText` 的 `res.on('data', c => d += c)` 会**逐块** `toString()`, 一个 3 字节汉字被 TCP 分块切开即变成两个 U+FFFD, 随后被写进 `web-data/` 与 `vehicles_data.js` 提交上线。同一份云端文件用 python 整段读取是 0 处损坏, node 却报 2~3 处且位置每次不同 —— 此前几次"自动同步写坏数据"都是这条路径, 只修坏串属治标
- **数据镜像恢复**: 自 2026-11-09 起连续失败的 `Sync Web Data Mirror` 首次成功, 镜像刷新到 11-23(车型 100 / 品牌 12 / 账号 11 / 反馈 2), `vehicles_data.js` 与媒体映射/manifest 一并重生成
- **诊断信息自身修正**: 飞书 `modified_time` 是秒级时间戳, 此前按毫秒解释打印成 `1970-01-21`

#### 🟢 新增(可观测与闭环):
- 熔断打 `::error::` 注解 + 「实际取到的源文件 token/修改时间 + 本次车数 + 已有镜像 syncedAt/车数」+ `--force` 处置提示
- 同步失败**自动开 issue**、恢复**自动关闭**(issue #14 已完成一次 失败→修复→自动关闭 实测)
- `.github/labeler.yml` 补齐(仅用已有标签), `actions/labeler@v4 → v7`(此前 18 次运行 0 次成功)

#### 🧪 测试:
- 新增 `tests/test_v10256_stream_decode.js`(10 断言): 把响应体故意切在汉字字节中间, 旧实现下 4 项红
- 新增 `tests/test_v10255_mirror_diag.js`(21 断言): 熔断必红+必带注解+必自解释+不得覆盖产物



### 自动化修复: 失败不再静默 + Labeler 复位 + 工程元信息补全

> 一句话总结: 本版**不含业务代码变更**, App 行为与 V10.25.4 一致, 只把"红了没人知道"的两条流水线和工程元信息修好。

#### 🔴 修复(CI 可观测性):
- **数据镜像流水线静默了两周**: `Sync Web Data Mirror` 自 2026-11-09 起连续失败 49/50 次, `web-data/` 镜像与 `vehicles_data.js`、媒体映射全部冻结; 熔断只打普通日志、无人被告知。现熔断改打 `::error::` 注解 + 自解释诊断(本次实际取到的源文件 token/修改时间、本次车数、已有镜像 syncedAt/车数) + `--force` 处置提示
- **失败自动开单、恢复自动关单**: `sync-web-data.yml` 增 `notify-failure` job, 失败开 issue(已存在则刷新正文, 不刷评论), 下一次成功自动关闭
- **Labeler 长期必红**: 仓库从来没有 `.github/labeler.yml`(18 次运行 0 次成功)。补配置(只用已有标签) + `actions/labeler@v4 → v7`

#### 🟢 新增(工程):
- `package.json` 补 `name`/`version`/`private`/`description`/`license`/`engines`
- 版本门禁对 `package.json` 增加**非阻断**漂移提示

#### 🧪 测试:
- 新增 `tests/test_v10255_mirror_diag.js`(21 断言): 本地模式实跑 CLI, 钉住"熔断必红 + 必带注解 + 必自解释 + 不得覆盖产物, `--force` 才是放行开关"

## [10.25.4] - 2026-11-10

### 媒体链路修复: 上传幂等作用域 + 不再降级顶层 + 客户端候选回退

> 一句话总结: 把"该传的没传""显示别人的图""云端顶层散落"三个症状从链路上根治。

#### 🔴 核心修复(媒体):
- **上传幂等跨车型污染**: 判重键由「裸文件名」改为「车型目录/文件名」。旧实现把所有子目录文件名倒进同一个 Set, A 车型目录里的 `image1.jpeg` 会让 B 车型同名文件被判"已上传"而跳传
- **子目录创建失败不再降级顶层**: 旧代码失败时静默返回顶层 token, 照片全堆根目录(云端 199 个文件散在根上的直接来源)。现重试一次(含同名目录复列)后仍失败即抛错, 外层记为 failed 保留下轮重试
- **客户端候选路径回退**: 新增 `mediaCandidateSrcs()`, 加载失败依次试 `原路径 → _共享/同名 → 顶层/同名`, 全失败才回退云端或显示缺失; 列表缩略图同步接入(带 `data-src`)

#### 🟢 新增(映射与守卫):
- 直链映射补齐「柳工2.5T叉车」「通用断电视频」「长安皮卡_HUNTER(_2)」, 50 → **53** 条
- `00-media-paths.js` 增 `RESERVED_FOLDERS`(`_共享`/`_未归类`)与断言守卫, 防车型目录与系统目录撞名

#### 🧪 测试:
- 新增 `tests/test_v10251_media_fallback.js`(15 项): 候选路径顺序/去重/边界 + 幂等键作用域隔离; 已接入 `test:all`

## [10.25.0] - 2026-10-10

### 媒体工程化: 图片/视频按车型名分文件夹 + 账号生命周期加固 + 工程门禁

> 一句话总结: 本版为**媒体工程化与账号安全加固版**——图片/视频改为按车型名分文件夹存储(GitHub 与飞书同构), 以单一真源 `js/00-media-paths.js` 加运行时三段式路径下钻定位(04-export/05-sync/06-media)从结构上杜绝媒体与车型错配, 并完成存量 193 个文件迁移; 同步补上账号注销防复活(墓碑机制)、自助注销与账号生命周期三处安全加固, 新增代码库知识文档、web-data 脱敏门禁与行覆盖率验收门禁。

#### 🟢 新增(媒体结构化):
- **图片/视频按车型名分文件夹存储**: 单一真源 `js/00-media-paths.js` 统一生成三段式路径(柜体规格/车型名/部位), GitHub 与飞书两侧同构, 从目录结构上杜绝媒体与车型错配
- **运行时三段式路径下钻定位**: `js/04-export.js` / `js/05-sync.js` / `js/06-media.js` 按 `04-export` / `05-sync` / `06-media` 三段逐级解析定位, 命名即归属
- **存量迁移脚本** `scripts/migrate_media_to_folders.js`: 单车 163 + 共享 14 + 未归类 16, 合计 193 个文件按新结构归位

#### 🟢 新增(账号):
- **注销防复活(墓碑机制)**: 新增独立存储键 `tcg_deleted_users`, 三条删除路径统一经 `State.removeUser` 收口落墓碑; 云端 `approved_users.json` 增 `deleted` 名单跨设备传播已注销事实; 所有「云端 → 本地」复活点以 `isPhoneTombstoned` 前置拦截, 重新注册时以 `clearTombstone` 作废旧标记
- **自助注销**: 新增 `cancelAccount` 自助注销入口(菜单 + `js/02-auth.js`), 用户可自主发起注销

#### 🔴 核心修复(账号生命周期加固):
- **忘记密码跨设备仲裁失效**: `doForgotPassword` 重置后补写 `pw_ts`, 修复跨设备密码仲裁失效
- **登出残留导致换号串号**: `doLogout` 清理会话与账号作用域缓存, 避免换号后读到上一账号数据
- **篡改会话绕过校验**: `changePassword` 改密后重建会话并重新签名 `sig`, 修复被篡改会话绕过校验

#### 🚩 工程加固:
- **代码库知识文档**: 新增 `docs/codebase/` 七篇(STACK/STRUCTURE/ARCHITECTURE/CONVENTIONS/INTEGRATIONS/TESTING/CONCERNS)与扫描快照, 每项结论可溯源; `ARCHITECTURE` 标注 Capacitor 方案作废
- **web-data 脱敏门禁**: 对已入库产物做脱敏复核(字段白名单 + 敏感字段名兜底 + 明文手机号 + linkKey 形态 + sanitized 哨兵)
- **行覆盖率门禁**: 引入 c8 行覆盖率采集与验收门禁(`js/` 可归因源文件 >= 95%)
- **代码清理**: 移除 3 个无引用孤儿会话键(映射表 52 → 49), 修复 refactor 正则字面量导致的非法量词语法错误, 恢复门禁全绿
- **测试**: 新增 `test_v1038` / `test_v1039` 覆盖墓碑与自助注销; 覆盖率门禁实测 99.38%

#### 🚩 版本一致性升级 10.20.2 → 10.25.0(versionCode 102500)
- 七源对齐: `version.json` / `release/version.json` / `config.xml` / `sw.js` / `demo.html` / `js/00-bootstrap.js` / `js/11-about.js`(含版本历史与兜底字面量)

## [10.20.2] - 2026-10-09

### 仓库治理: AI 工具配置目录出库

> 一句话总结: 本版为**仓库治理 / 合规版**——清理 59 个 AI 工具配置目录(含符号链接农场)出库、补 Apache-2.0 LICENSE 全文、README 更新至当前现状; **不涉及 APP 功能与安全语义变更**, versionCode 仅按发布流程递增。

#### 🚩 工程加固:
- **59 个 AI 工具配置目录取消 git 跟踪**（本地保留, 不删除任何文件）: 仓库根被各类 AI 编程工具的技能安装器写入 `.claude` / `.agents` / `agent` / `skills` / `.qwen` / `.windsurf` / `.trae` 等 58 个配置、缓存与技能副本路径, 共 2576 个被跟踪文件——实体内容为两份完整的 lark 技能包副本（`.agents/` 与 `agent/` 各 550 文件 / 5.3MB）, 其余 50+ 个目录是指向它们的符号链接农场（各 28 条 symlink）。与业务无关, 膨胀仓库体积、暴露工具链信息
- **复检补漏: 非根目录的 `data/skills/lark-*` 28 条符号链接出库**: 上述技能农场在 `data/` 下另有一份镜像（全为 mode 120000 链接, 指向同一批 lark 技能）, 首轮清理只覆盖仓库根路径故遗漏。经全仓符号链接扫描确认这是唯一残留的非根泄漏点, 且 `data/` 下其余文件与业务无关
- `.gitignore` 新增整段忽略规则防止再次入库（含 `/data/skills/`）; 已实证业务代码（js/、scripts/、feishu-api.js、package.json）与全部 CI workflow **零引用**, 取消跟踪无副作用; `.github` / `.gitignore` / `.traeignore` 保留跟踪
- ⚠️ 历史提交中仍残留这些文件的旧版本, 如需彻底缩减仓库体积需另行重写历史（破坏性操作, 单独评估）

#### 🚩 版本一致性升级 10.20.1 → 10.20.2(versionCode 102002)
- 七源对齐: `version.json` / `release/version.json` / `config.xml` / `sw.js` / `demo.html` / `js/00-bootstrap.js` / `js/11-about.js`(含版本历史与兜底字面量)

### V10.20.1 诚实空态 + 同步防倒退版

#### 🟢 新增(诚实空态):
- **照片缺失不再假装"正在加载"**: 22 个车型 / 65 张照片在飞书账号重置期间丢失(云端与本地已全量比对确认都没有)。旧实现对加载失败的处理是塞一张灰图占位 —— 格子仍可点击、仍挂着"前脸照片"标签, 视觉上与"网络慢"无从区分, 现场只能反复刷新干等。现改为:
  - **详情格**: 整格替换为虚线框 + 「**照片缺失** / 云端与本地均无此文件」, 移除 `onclick` 与部位标签, 鼠标指针改 `default`
  - **列表缩略图**: 64×48 内最小化呈现「缺失」
  - **查看器大图**: 按原因区分两种缺失 —— **missing**(登记了但取不到 → 联系组长补传) / **never**(车型本就没登记 → 需重新拍摄上传)
  - 删除 `js/06-media.js` 的 `_imgPlaceholder()` 灰图占位函数(原位置留下删除理由注释)

#### 🔴 核心修复:
- **web-data 镜像可能取到同名陈旧副本**: 飞书「同步数据」目录下现存两份同名 `vehicle_sync_data.json`(100 车 / 82 车), 旧 `feishuFindFile()` 命中第一个即 `break` —— 取到哪份完全取决于 API 返回顺序。现改为收集全部同名候选后按 `modified_time` 取最新(`pickNewestByName`)
- **写入前回滚熔断**: 新镜像车辆数少于已有产物(且两者均 > 0)时拒绝写入并保留原产物; 组长确实下架车型时加 `--force` 放行。与既有 0 车熔断构成上下界双闸
- **数据镜像新一轮 U+FFFD 损坏**: 校正表 **30 → 35 条**, 兜住 id=45/69/98/23/59 共 5 处(每处均以同句式或同记录完好副本为证据), 产物残留替换符归零
- **新增「自动派生校正」层, 结束手工追着乱码跑的 treadmill**: 源表是活的, 每 15 分钟同步都可能产出**形态迁移**的新损坏(同日内 id=80 从 `取出车???匙` 变成 `取出??钥匙`, 已收录条目完全不匹配)。现改为把 U+FFFD 连续段当通配符, 在本仓干净语料里求**唯一解**才改: 0 命中 / 多解 / 字面上下文 < 4 字一律不动并 `[WARN]` 交人工。手工表降级为 override(仍优先)。实测本轮 3/3 唯一命中 0 歧义; 回放历史 30 条人工条目复现 29 条、**0 条纠错**

#### 🚩 工程加固:
- 新增 `tests/test_v1037_honest_empty_state.js`(**39 断言**): 静态锚点 + jsdom 真实 DOM 行为(图片元素被移除、误导性 onclick 与部位标签已摘、虚线框、`cursor=default`、`imgLoadError` 端到端)+ 查看器文案与 XML 转义; 已登记 `test:honest-empty` 并纳入 `test:all`
- `tests/test_v1035_zero_guard.js` 增 S9/S10/S11(**39 → 55 断言**): 熔断触发且产物未被覆盖 / `--force` 放行 + 反假阳(100→100、100→101 不得触发) / `pickNewestByName` 纯函数(顺序无关取最新、缺时间戳排最后、null 安全、不改入参)
- 修 `_photoViewerMissingSvg` 双重转义: 车名先转义再拼进副标题二次转义, `&` 会渲染成 `&amp;amp;`
- 新增/扩充 `tests/test_vehicle_data_integrity.js` **I5 段(14 条断言, 19 → 33)**: 纯函数(唯一解 / 无候选 / 歧义 / 无损坏 / 上下文过短 / 不改入参)、语料去重与排除、`autoCorrectVehicles` 明细与 unresolved 保留原文、两级串联与 WARN 留存。**已做变异自证**: 把"字面上下文 ≥ 4"改成恒不成立后 I3a 立刻转红(残留 7), 证明"绿"来自自动派生而非手工表
- `.gitignore` 忽略测试临时目录 `_verify_*` / `_a29_*`: 清理被中断时会以 `??` 污染改动区

#### 🚩 版本一致性升级 10.20.0 → 10.20.1(versionCode 102001)
- 七源对齐: `version.json` / `release/version.json` / `config.xml` / `sw.js` / `demo.html` / `js/00-bootstrap.js` / `js/11-about.js`(含版本历史与兜底字面量)

### V10.19.3 诊断加固版

#### 🟢 新增(诊断):
- **「关于」页「运行环境自检」**: 显示 **安全升级所需加密能力: 可用 / 不可用** —— 采用**实证探测**(真跑一次 PBKDF2/`crypto.subtle` 通路), 而非只看能力对象是否存在; 因为密码哈希在加密能力不可用时会**静默降级**(App 仍能登录), 「能登录」并不能证明加密能力可用

#### 🔴 核心修复:
- **安全升级失败不再静默(两因区分)**: ①**本设备不支持所需加密能力** → 换用较新的手机或联系组长(**不**提供"重试"按钮, 重试对此无效) ②**已生成连接键但回传云端失败** → 检查网络后重试, 附 **「重试上传」** 入口
- **未登录导航守卫**(用户报告的"注册页按返回"问题): **未登录**时从**注册页 / 忘记密码页**按返回(App 硬件返回键 / 网页浏览器返回同一处理), **不再进入应用内页面**, 一律回**登录页**; 「我的」页未登录身份卡由**硬编码"组长"文字**改为「**未登录**」; 已登录状态不再能进入注册页(纵深防御)
  - ⚠️ 性质: **显示 / 导航层**缺陷 —— 未登录时 `isLeader()/canEdit()` 均为 `false`, **触达不到任何组长操作**, **不涉及权限泄漏、不是安全事故**(消除的是"观感像已登录"的误导)
- **反馈「APP版本」字段**: 不再恒为 `Vunknown`(此前从错误的对象读取版本变量)

#### 🚩 工程加固:
- **发版工具链**: 飞书发版目录名(`sync_release_both_roots.py`)与迁移 `syncVersion` 改为从 `version.json` 读取, 不再写死 `10.17.1`(此前每次发版都把产物传进名为 `v10.17.1` 的目录)
- **回归防线**: 新增 `tests/test_nav_login_guard.js`(先红后绿: 修复前 11 项红)与 `tests/test_crypto_capability_ux.js`; `test_v1033` 的版本期望值改为从 `version.json` 动态推导(附变异自证)

#### 🚩 版本一致性升级 10.19.2 → 10.19.3(versionCode 101903)
- 七源对齐: version.json / release/version.json / config.xml / sw.js / demo.html / 00-bootstrap / 11-about
- ⚠️ **本版是 10.19.2 的超集**(含其全部修复), 只需更新一次, 无需先装 10.19.2

### V10.19.2 网页端登录修复版

#### 🔴 核心修复:
- **网页端登录报「密码错误」**: 根因**不是**密码错误, 而是 P0 脱敏后**存量账号从未完成 linkKey 迁移**(云端镜像无任何可校验材料) → 登录失败改为**通用可操作提示**(引导先在手机 App 用手机号+密码登录一次完成安全升级, 附「我已升级, 重新登录」按钮); 该提示对**所有**登录失败通用, **不泄露**该手机号是否为已注册账号
- **App 迁移闭环**: 启动/会话恢复若检测账号缺 linkKey → **一次性引导**重新登录(不再静默失败); 已有 linkKey 但云端可能缺失时低频补推一次(6h 节流); **绝不落盘明文密码**

#### 🚩 工程加固:
- **缓存诅咒解除**: `sw.js` `CACHE_NAME` 随版本升至 `tcg-poweroff-v10.19.2`, 解除「缓存优先」导致修复到不了用户的问题
- **回归断言**: 新增 `tests/test_v1033_linkkey_migration_ux.js`

#### 🚩 版本一致性升级 10.19.1 → 10.19.2(versionCode 101902)
- 七源对齐: version.json / release/version.json / config.xml / sw.js / demo.html / 00-bootstrap / 11-about

### V10.19.1 稳定性加固版

#### 🔴 核心修复:
- **新建车辆照片分区丢失**: `addVehicle` 逐字段字面量遗漏 `photoSections/photoLabels/keyPhotoRemark` 三字段, 导致新建车辆照片分区与备注丢失; 现补回并加透传兜底, 配 16 条回归断言
- **飞书跨网络测试掐断全链**: `test_v57_cross_network.js` 缺凭据时原 `exit(1)` 会掐断 `test:all` 后续 19 个套件; 改为「跳过」语义 `exit 0`(断言真失败仍 exit 1)

#### 🚩 工程加固:
- **版本一致性门禁扩展**: 校验范围新增 sw.js 缓存名/demo.html 展示位/js 兜底字面量, 附变异测试证明拦得住; 修复 `js/11-about.js` 兜底版本号停在 10.15.0(落后 4 版)的漂移
- **测试覆盖补全**: `test:all` 聚合入口补全至 27 个测试文件; 补原型污染守卫 23 条 + 车辆 CRUD 冒烟 51 条
- **测试产物入库清理**: `tests/*_results.json` 不再入库(加 .gitignore), 测试不得依赖 git 工作区状态, 均固化常驻断言防复发
- **Android 构建修复**: 移除失效的 `android-actions/setup-android@v3`(下载 cmdline-tools 失败), 改用 runner 预装 SDK

#### 🚩 版本一致性升级 10.19.0 → 10.19.1(versionCode 101901)
- 七源对齐: version.json / release/version.json / config.xml / sw.js / demo.html / 00-bootstrap / 11-about

### V10.19.0 视频可播性修复版

#### 🔴 核心修复:
- **视频无封面**: 封面生成收敛为单一真源 `videoCoverDataUri`, 未播放态必定可见车型名封面, 不再黑屏
- **迭代后失效**: 组长上传改名「车型名_v序号.mp4」与官方资产表键 100% 失配导致 Release 直链被跳过; 新增官方片别名回退源 + 上传留档原名
- **网页端不可播**: 网页端跳过不存在的 `vehicle_videos/` 相对路径源, 直走免鉴权 Release 固定 tag 直链, 无源可播时优雅降级

#### 🚩 安全:
- **隐私白名单**: `web-data/` 是 GitHub Pages 公开资源, 反馈镜像加字段白名单(默认拒绝), 联系方式/设备信息/提交人不出库; 账号镜像脱敏(停公开手机号与密码哈希)

#### 🚩 版本一致性升级 10.18.0 → 10.19.0(versionCode 101900)
- 版本测试期望值改为从 version.json 动态读取; sw.js 缓存名随版本升级

### V10.18.0 审批闭环加固版

#### 🔴 核心修复:
- **飞书群拒绝通知**: chatId 落地, 组长拒绝后组员端即时弹窗通知
- **视频上传按车型名称命名**: 便于云端人工辨识
- **播放器封面显示**: 详情页视频显示封面

#### 🚩 版本一致性升级 10.17.1 → 10.18.0(versionCode 101800)

### V10.17.1 视频真实恢复补丁版

#### 🔴 核心修复:
- **撤销张冠李戴映射(安全问题)**: V10.17.0 曾把 23 个缺失视频错误映射到不相干车型的 Release 资产(断电教学视频看错车型有现场安全隐患);现改用本地 `E:\车辆断电指导应用开发\vehicle_videos\` 下的同名真实素材,重新上传为独立资产(资产名=内容 SHA-256 前 10 位),46 个车型引用全部对应各自真实教学视频
- **视频封面首帧走直链**: 详情页封面 `<video>` 层 src 由裸相对路径(404)改为 `mediaDirectUrl` 直链,有真实资产的车型显示真实首帧,无直链时才回退 SVG 兜底

#### 🚩 版本一致性升级 10.17.0 → 10.17.1(versionCode 101701)
- 三源对齐 + `test_v1016_self_learning.js` 版本断言改为"三源一致"动态校验(不再硬编码具体 patch)

### V10.17.0 注册闭环与视频恢复版

#### 🔴 核心修复:
- **拒绝通知闭环(反馈问题1)**: `pullApprovedStatusFromFeishu` 增加 rejected 状态双向同步——组长拒绝后组员端不再停留“审核中”,拉取后弹“未通过审核”通知(系统通知/Toast双通道)并终止激活守望;登录文案精准化(未通过+联系组长指引);组长拒绝动作即时推送飞书群消息(`notifyRegistrationResult`,60秒去重)
- **网页端自助注册(反馈问题2)**: 新增 GitHub 登记通道——网页端 `doRegister` 完整注册表单(同款校验链+限流+密码哈希),提交至 `tcg-registration-inbox` 专用库;镜像工作流(relay.yml)每5分钟转投飞书「注册申请/」,组长安卓端现有60秒轮询审批链路零改动;token 以项目同款 XOR+base64 密文存储,明文不入库不入包
- **视频链路恢复(反馈问题3)**: 直链映射表补齐 23 个缺失视频(46/46 全覆盖)——云端 `vehicle_videos` 目录丢失后,此前23个视频只能走已失效的 jsDelivr/飞书回退源;现复用 Release media-videos 标签中内容匹配的通用教学视频资产(已验证支持 Range 流式秒开);详情页视频新增双层封面(自然首帧 + 车名 SVG 兜底),不再黑屏;播放器空态文案区分“源失效/待补充”并保留组长重新上传入口

#### ✨ 新功能:
- **上传按车型名称命名(反馈需求4)**: 照片 `车型名称_p序号_哈希.jpeg`、视频 `车型名称_v序号_哈希.mp4`(旧规则 `user_v{id}_p{i}` 无法人工辨识);保留短哈希防同名冲突,幂等跳过语义不变

#### 🚩 版本一致性升级 10.16.7 → 10.17.0(versionCode 101700):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes / `demo.html` sync-local-ver / `sw.js` 缓存名 / `js/11-about.js` VERSION_HISTORY / `ios-release.yml` workflow_dispatch 默认版本号 / `scripts/sync_release_both_roots.py` + `scripts/migrate_drive_to_bitable.js` 内部版本号 / `tests/test_v110_audit.js` + `tests/test_v1016_self_learning.js` + `tests/test_v106_fixes.js` 版本与命名断言
- **全量回归 21 套件 0 FAIL**(V10.17.0 专项 51 项)

### V10.15.4 问题反馈修复版

#### 🔴 核心修复(依据飞书反馈库落地):
- **批量导出 Word 含图片**: `js/04-export.js` 的 `generateDocxOOXML()` 批量分支在总表后追加每车详情分表(车辆信息+断电步骤+备注+照片内嵌),与详情页导出一致,修复反馈『批量导出Word不含图片』
- **问题反馈板块选项细化**: `js/10-feedback.js` 将 `CATEGORIES` 由 8 项扩充为 15 项,覆盖车型/搜索/照片/详情/步骤/钥匙/单车导出等细分场景
- **车辆照片压缩质量提升**: `js/03-vehicles.js` 将 `compressImage(file,800,0.7)` 调整为 `compressImage(file,1280,0.8)`,修复反馈『照片压缩太严重』

#### 🚩 版本一致性升级 10.15.3 → 10.15.4(versionCode 101504):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(新增V10.15.4置顶) / `demo.html` sync-local-ver / `sw.js` 缓存名 v10.15.4 / `js/11-about.js` VERSION_HISTORY 新增 V10.15.4 / `ios-release.yml` workflow_dispatch 默认版本号 / `scripts/sync_release_both_roots.py` + `scripts/migrate_drive_to_bitable.js` 内部版本号 / `tests/test_v110_audit.js` 版本断言
- **全量回归 0 FAIL**: `npm run test:all` 含 `test:version`(三处一致性) + `test:v110-bitable` + `test:v110-audit`,版本门禁持续生效

### V10.15.3 真实AI分析 + 飞书群通知闭环

#### ✨ 新功能:
- **真实 DeepSeek LLM 分析**: `scripts/process_feedback.js` 新增 `deepseekAnalysis()`,配置 `DEEPSEEK_API_KEY` Secrets 后按『问题归类→根因→解决方案』生成摘要;无 Key / 调用失败自动回退 `ruleBasedAnalysis()` 兜底
- **飞书群通知闭环修复**: `notify()` 调用 `/im/v1/messages` 补齐 `receive_id_type=chat_id` 查询参数,修复 `field validation failed`,分析完成后推送『问题反馈处理完成』到反馈群(智能体集群)
- **状态闭环回写**: 待处理→分析中→已解决 三段流转,回写 AI 分析摘要 + 技术文档链接,安卓端与网页端镜像同步可见

#### 🚩 版本一致性升级 10.15.2 → 10.15.3(versionCode 101503):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(新增V10.15.3置顶) / `demo.html` sync-local-ver / `sw.js` 缓存名 v10.15.3 / `js/11-about.js` VERSION_HISTORY 新增 V10.15.3 / `ios-release.yml` workflow_dispatch 默认版本号 / `scripts/sync_release_both_roots.py` + `scripts/migrate_drive_to_bitable.js` 内部版本号 / `tests/test_v110_audit.js` 版本断言
- **全量回归 0 FAIL**: `npm run test:all` 含 `test:version`(三处一致性) + `test:v110-bitable` + `test:v110-audit`,版本门禁持续生效
- **端到端验证**: 注入测试反馈跑通全链路,DeepSeek 摘要格式与内置模板明显不同,群内收到完整通知消息;测试记录已清理

### V10.15.2 数据后端升级 + 安全加固

#### ✨ 新功能:
- **飞书多维表格(Bitable)后端数据层**: `feishu-api.js` 新增 `BITABLE_TABLE_NAMES` 常量与 `DATA_ACCESS` 数据访问层,车辆/用户数据双写 Drive + Bitable,`QPS` 门控与 Drive 读取回退补齐,迁移路径与字段契约和 `vehicleToBitable` / `userToBitable` 保持一致
- **Drive→Bitable 迁移脚本**: 新增 `scripts/migrate_drive_to_bitable.js`,批量再映射云端旧数据到二维表,配合 `docs/DESIGN_V110_BITABLE.md` 设计文档

#### 🛡️ 安全加固(V11.3 里程碑):
- **构建期密钥双重加密**: `scripts/inject_build_secrets.js` 由 XOR 混淆升级为 **XOR + base64** 双重编码,写入 `window.__BUILD_SECRETS__`,明文 App Secret 不再出现在 `demo.html` 构建产物;`00-bootstrap.js` `_decryptBuildSecret()` 运行时解密态 + 取读即删 + 闭包缓存
- **R8 / ProGuard 混淆**: 新增 `scripts/proguard_harden.js`(`after_prepare` 钩子)自动注入 `minifyEnabled true` + `shrinkResources true` + `proguard-rules.pro`(完整 Cordova JS Bridge keep 规则),防止反射剥离;幂等处理 + `TCG_PROGUARD=0` 降级开关
- **审计与删除轨迹**: 新增 `js/16-audit.js` 提供 `window.Audit`(track/init/readLocal/clearLocal),localStorage 环形缓冲 500 条,车辆/用户增删改操作时间线可追溯,删除留痕

#### 🚩 版本一致性升级 10.15.1 → 10.15.2(versionCode 101502):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(新增V10.15.2置顶) / `demo.html` sync-local-ver / `sw.js` 缓存名 v10.15.2 / `js/11-about.js` VERSION_HISTORY 新增 V10.15.2 / `ios-release.yml` workflow_dispatch 默认版本号 / `scripts/sync_release_both_roots.py` + `scripts/migrate_drive_to_bitable.js` 内部版本号 / `tests/test_v110_audit.js` 版本断言
- **全量回归 0 FAIL**: `npm run test:all` 含 `test:version`(三处一致性) + `test:v110-bitable` + `test:v110-audit`,版本门禁持续生效
- **安全运营跟进(非代码)**: 飞书 IP 白名单 + 配额告警 + 月度 Secret 轮换,见 `SECURITY.md`

### V10.15.1 版本一致性对齐 + 发版门禁

#### 🔴 核心修复:
- **三处版本对齐**: `config.xml` 由 `10.14.4/101404` → `10.15.1/101501`;`version.json` 同步为 `10.15.1/101501`;`js/00-bootstrap.js` 的 `APP_VERSION` → `'10.15.1'`。消除 APK 内 `cordova-plugin-app-version`(10.14.4) 与 OTA 元数据(10.15.0) 漂移导致的「请更新」横幅误报
- **发版门禁脚本**: 新增 `scripts/check_version_consistency.js`——解析 config.xml / version.json / 00-bootstrap.js 三处版本,校验三处一致 + `versionCode` 与版本号编码一致(每段补零到 2 位),不一致即退出非 0
- **测试接入**: `package.json` 新增 `test:version` 并置于 `test:all` 首位,版本漂移即刻中断全量回归

#### 🚩 版本一致性升级 10.15.0 → 10.15.1(versionCode 101501):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(新增V10.15.1置顶) / `docs/RELEASE_V10151.md` 新增
- **V10.15.0 功能逻辑零改动**: 仅版本号对齐 + 新增门禁脚本

### V10.14.3 iOS PWA深化版(PNG图标关键修复+安装引导+即时更新+standalone适配)

#### 🐛 关键修复:
- **iOS主屏幕图标PNG化**: iOS Safari**不支持SVG**作为apple-touch-icon,V10.14.2的`apple-touch-icon`指向`icon.svg`导致组员「添加到主屏幕」时图标显示异常——本次新增全尺寸PNG图标全家桶(`icon-180/192/512/1024.png` + `icon-192/512-maskable.png`,与SVG视觉一致:蓝色圆角背景#2563eb+白色闪电,4倍超采样抗锯齿);`demo.html`的apple-touch-icon改指`icon-180.png`(iPhone主屏幕标准尺寸);`manifest.json`图标数组PNG优先+SVG兜底,`purpose`区分any/maskable,Android/iOS/桌面Chrome全兼容

#### ✨ 新功能:
- **iOS安装引导浮层**: 三条件同时满足才显示(iOS Safari浏览器+非standalone未安装状态+3天内未关闭过);自动弹出深色卡片「安装『太仓港断电』到主屏幕」+分享按钮图示+三步操作说明;20秒自动消失或点×关闭,关闭记忆3天不再打扰(localStorage `pwa_ios_guide_dismissed`);排除Chrome/Firefox/Edge等iOS第三方浏览器(它们没有「添加到主屏幕」的PWA能力)
- **新版本即时更新提示**: SW监听`updatefound`→新SW进入`installed`状态且已有controller→底部弹出「发现新版本」提示条;点「立即更新」`postMessage({action:'SKIP_WAITING'})`→sw.js调用`self.skipWaiting()`立即激活新版本→300ms后`location.reload()`拉取新资源——**无需等所有标签页关闭**(传统SW更新要等所有客户端关闭,现场组员几乎从不主动关页面);sw.js新增message监听器
- **standalone全屏模式适配**: 检测`display-mode: standalone`启动后在html添加`pwa-standalone`类;css/app.css新增规则——顶栏避开刘海/灵动岛(black-translucent状态栏下content默认顶到屏幕顶端)、Toast抬离底部手势条、禁用长按呼出文本选择菜单(对齐原生APP行为,输入框保留文本选择);浏览器/APK环境无该类,纯增量CSS零影响

#### 🛡️ 健壮性:
- **PWA脚本沙箱防御**: `_isStandalone()`对`window.navigator`/`window.matchMedia`/`document.documentElement`逐步判空+try/catch——Node测试沙箱/老WebView无这些对象时整段安全跳过(修复test_v53运行时仿真「Cannot read properties of undefined」回归,防御同时惠及非标准环境)

#### 🚩 版本一致性升级 10.14.2 → 10.14.3(versionCode 101403):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(5条) / `demo.html` / `sw.js`缓存名v10.14.3 / `tests/test_v1014`+`tests/test_v1015` 版本断言 / `ios-release.yml` workflow_dispatch 默认版本号
- **V10.14.2功能逻辑零改动**: 车辆详情页多视频支持等仅版本号断言升级
- **全量回归 0 FAIL**: V53运行时21 + V57逻辑34 + V1014零配置49 + V1015出口统一50 + V1010分片18 + V1011镜像6 + V1013复杂度68 + V103-V109(62/46/49/33/31/20/17)

### V10.14.2 车辆详情页多视频支持 + iOS方案A(PWA网页应用)

#### ✨ 新功能:
- **车辆详情页多视频列表**: 详情页视频区域从单视频卡片改为多视频垂直列表展示,每个视频独立点击播放;区域标题多视频时显示"视频演示(N个)";卡片右上角显示序号标记;第一个视频标题为"断电教学视频",其余为"补充视频N"
- **播放器内视频切换**: 新增`_currentVideoIndex`索引追踪;`switchVideo(direction)`无缝切换上一个/下一个(循环),切换时清理当前视频状态后复用`openVideoPlayer`五源回退链重新加载;播放器顶部显示"视频 1/N"序号+导航按钮(单视频时隐藏)
- **上传回调回到当前索引**: `pickVideoFile`上传完成后`openVideoPlayer(_currentVideoIndex)`回到当前视频而非第一个;`pickVideoFile`文件名取`v.videoPaths[_currentVideoIndex]`而非硬编码`[0]`
- **iOS方案A PWA**: 新增`manifest.json`(应用名称/图标/全屏模式/竖屏/主题色) + `sw.js`(应用壳预缓存+静态资源缓存优先+API网络优先+离线导航降级) + `icon.svg`(512x512矢量图标);`demo.html`注入PWA meta标签(apple-mobile-web-app-capable/status-bar-style/touch-icon/theme-color)+Service Worker注册脚本;iOS Safari打开→添加到主屏幕→全屏图标体验接近原生APP,离线可用

#### 🚩 版本一致性升级 10.14.1 → 10.14.2(versionCode 101402):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes / `demo.html` / `tests/test_v1014`+`tests/test_v1015` 版本断言 / `ios-release.yml` workflow_dispatch 默认版本号
- **V10.14.1代码未改动**: 仅版本号断言升级,同步配置出口统一等核心逻辑零变更

### V10.14.1 同步配置出口统一修复(组长组员数据无法同步·组员端"飞书配置不完整"误报根因闭环)

#### 🔴 根因与核心修复:
- **根因**: `js/05-sync.js` 中 `loadFeishuConfig`/`_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate`/`exportSyncConfig` 五处直接 `JSON.parse(localStorage.getItem('feishu_config'))` 解析配置,绕过了 V10.14.0 建立的 `getFeishuCfg()` 统一出口——组员端本地从未保存过该键,`appSecret` 恒取 `DEFAULT_FEISHU_CONFIG` 空串 → `feishuCfgReady` 恒 false → ①三色横幅误报「未注入同步凭据」;②上传管线被"飞书配置不完整"门禁拦截(组长端依赖构建注入凭据、未在设置页手动保存时同样中招);③组员拉取云端数据被门禁拦截(本次"组长组员数据无法同步"主根因);④60秒轻量通知轮询形同虚设(红点永不亮);⑤导出的同步配置为空
- **修复(五处全部改走 `getFeishuCfg()` 统一出口)**: 优先消费构建期注入秘钥的闭包缓存 `_INJECTED_SECRETS_CACHE`(与 `syncPendingToFeishu` 等8处既有出口对齐),组员零配置场景仍返回完整可用配置;`syncSub/pendingSub/approvedSub/backupSub` 全部子目录字段随统一出口返回(V10.10.0 根因修复②语义保留)
- **安全语义保留**: Secret 输入框仅回显用户手动保存值(注入秘钥只在闭包内存供同步链路使用,不落DOM可读值);`interval` 为用户偏好保留回显;admin 显式保存(`_writer='admin'`)手动值仍优先覆盖注入值(覆盖语义不变)

#### ✅ 版本专项测试(红-绿-红三步验证):
- 新增 `tests/test_v1015_member_sync_gate.js` 专项 50 断言 11 场景(B1-B11: 组长/组员 × 注入/零本地/脏配置 × 上传/拉取/轮询/导出/安全守卫全矩阵);修复前 34 项失败复现 bug,修复后 50/50 通过,git stash 回退修复后测试重新失败(证明测试真实捕捉回归)
- **修复 `test:v107` B6 回归**: fixture 现代化——V10.14.0 起 `getFeishuCfg()` 对组员端只信任 admin 显式写入(或构建期注入)的配置,旧 fixture 无标记写入被安全忽略;补 `_writer:'admin'` 标记后轻量通知通道用例恢复通过(31/31)
- **修复 `test:cross` 真机跨网络 harness(既有缺陷,V10.12.0 秘钥剥离时遗留)**: `makePhone` 未模拟发版 APK 的构建期 `window.__BUILD_SECRETS__` 注入,加载干净源码时模拟手机内 `getFeishuCfg().appSecret` 恒空 → 注册申请/审批回推全部静默拦截(2.3 起 9 项连锁失败,基线复现确认与本次修复无关);harness 补注入后组员注册→云端落盘→组长拉取审批→新设备登录 16/16 全绿
- **修复 `test:logic` 维度4状态污染(既有缺陷)**: 1.4d 用例(设置 `TCG_FEISHU_APP_SECRET` 环境变量时)提前消费 `getFeishuCfg()` 致注入秘钥进入闭包缓存常驻,"默认未注入"三断言(4.1/4.2a/4.2c)失真;维度4前重置闭包缓存等价模拟全新页面加载,有/无环境变量两场景均通过(35/35、34/34)

#### 🚩 版本一致性升级 10.14.0 → 10.14.1(versionCode 101401):
- `js/00-bootstrap.js` APP_VERSION / `config.xml` version+versionCode / `version.json` version+versionCode+downloadUrl+releaseNotes(6条) / `demo.html` sync-local-ver 静态默认值 / `tests/test_v1014` 版本断言与sandbox stub / `package.json` 新增 test:v1015 并入 test:all / `ci.yml` 追加 V10.14.1 专项 step / `ios-release.yml` workflow_dispatch 默认版本号
- **全量回归 16 套件 0 FAIL**(带真实飞书凭据): V53运行时21 + V57逻辑35 + **V57跨网络真机16** + V103-V109 + V1010分片18 + V1011镜像6 + V1013复杂度68 + V1014零配置49 + **V1015出口统一50(新增)**

### iOS发版流水线基建修复(tag v10.14.0 触发后暴露的三处环境级缺陷, 不涉及APP业务代码)
- **修复1(macOS grep兼容)**: `ios-release.yml` 版本解析 `grep -oP`(GNU扩展)在 macOS BSD grep 下报 `invalid option -- P` 导致 APP_VERSION 空串; 改用 `sed -nE` BSD/GNU双兼容写法 + 空版本号显式阻断
- **修复2(Xcode版本随镜像演进)**: `XCODE_VERSION` 固定 `15.4` 已从 macos-latest 镜像移除(现仅 26.x), `setup-xcode` 报 `Could not find Xcode version`; 改用 `latest-stable` 随镜像演进不再过期
- **修复3(scheme误选框架库+产物路径漂移)**: Cordova 工程 scheme 列表含 `Cordova`/`CordovaLib`(框架库)与应用本体三项, 旧探测恒取首项导致仅构建框架(1 target)且产物落入 DerivedData, `Collect IPA` 找不到产物 exit 1; 升级为「config.xml `<name>` 精确匹配 + `^Cordova` 前缀排除」双保险探测, xcodebuild 追加 `-derivedDataPath build/dd` 固定产物路径, Collect IPA 三级回退搜索
- **修复4(插件源码与新SDK兼容)**: `cordova-plugin-advanced-http@3.3.1` 内置 AFNetworking 直接 `#import <netinet6/in6.h>`, 该头文件自 iOS 26.5 SDK 起为私有模块头, 编译报 `Use of private header from outside its module`; 构建步骤内在 cordova build(prepare 重拷源码)之后、xcodebuild 编译之前插入外科手术式补丁删除该冗余 import(`<netinet/in.h>` 已传递包含, 语义等价)
- 附带: workflow_dispatch 默认版本号 10.13.0 → 10.14.0

### 发版产物飞书双通道分发工具链(补齐"GitHub Release + 飞书云空间"双端产物同步能力)
- 新增 `scripts/sync_release_to_feishu.py`: 发版产物(APK/IPA/SHA256/发版说明)一键同步到飞书 `APP数据备份/发版产物/v{version}/`, 与 `push_github_final.sh` 构成双通道分发(组员可在飞书端直接下载官方签名安装包, 规避 GitHub 直链国内可达性问题); 版本号/folderToken 从 version.json 动态读取; 目录列举用 `GET /drive/v1/files?folder_token=` 查询参数形态(APP端生产验证); ≤16MB `upload_all`、>16MB 分片上传(upload_prepare/upload_part/upload_finish, 500MB上限); 220ms QPS门控 + 1061021事务过期整段重传 + 1061045频控退避(与APP端 feishu-api.js 完全对齐); 同名文件先删后传保证幂等; 终验重新列举目录全量核对
- **修复5(backup脚本列目录端点)**: `backup_to_feishu.py` `list_children` 原用 `GET /drive/v1/files/{token}/children` 路径形态, 该应用调用恒返回 404(脚本一旦运行即失败); 改为与APP端一致的查询参数形态并补 `has_more/page_token` 分页
- V10.14.0 五件产物(APK/APK.sha256/IPA/IPA.sha256/RELEASE_V10140.md)已实际同步至飞书并完成云端回下载 SHA256 端到端校验一致

## [10.14.0] - 2026-09-04

### 组员零配置同步修复版(组长-组员镜像数据一致性 + 双端同步脚本治理 + 签名构建基建补齐)

#### 🔴 核心修复(三大问题 闭环解决):
- **修复A(秘钥闭包永久化)**: 新增脚本作用域私有闭包 `_INJECTED_SECRETS_CACHE`；构建期注入的 `window.__BUILD_SECRETS__` 首次读取即浅克隆写入闭包缓存、立即 delete window 引用，后续所有调用直接返回闭包缓存；组员清localStorage、WebView杀进程/APP重启、OTA热更新 全路径下appSecret不再丢失(彻底解决组员「清缓存后必须找管理员抄配置」的高频运维工单)
- **修复B(镜像同步双通道决策)**: `doSyncDownload` 从单一 `cloudTs > lastSyncTs` 判新升级为 timestamp OR ID集合差集 双条件OR组合；覆盖「同秒上传+删除」「Android时区漂移/NTP时钟回拨」「新安装组员首次同步空ID集」3类真机盲区，保证删除传播100%；同时保留空云端熔断(云端=0台、本地>0台时跳过镜像，防组长上传中断误清空组员本地数据)
- **修复C(组员零配置横幅+深度防御写入过滤)**: `loadFeishuConfig` 三色横幅状态机——①成员+有注入→✅绿色横幅内置提示+三输入框readonly灰化disabled+同步间隔disabled+保存配置按钮隐藏；②成员+无注入→⚠️琥珀色警示横幅「请下载公司官方签名安装包」；③组长/未登录→🛠蓝色管理员说明横幅(可编辑)；`saveFeishuConfig` 成员态直接return+showToast拒绝,管理员写入强制携带 `_writer:'admin'` 写入标记；`getFeishuCfg pick()` 成员端忽略 localStorage 无admin标记的历史垃圾升级配置(只信任注入缓存/admin显式保存值)，杜绝V5.x→V10.x跨版本升级脏配置污染

#### 📚 文档与发版说明补齐:
- 新增 `docs/RELEASE_V10120.md`(8K级详细版:单向收敛+九模块拆分+Secret构建期注入+导航栈封装+嵌套深度降压+CSS抽取+XSS全量转义+NPM无npm自举+CI基建9维度完整交付说明+对应版本测试矩阵)
- 新增 `docs/RELEASE_V10130.md`(8K级详细版: A3四刀切/渲染业务分离/State守卫/XSS绊线 4大交付能力+68专项+变更文件清单)
- 新增 `docs/RELEASE_V10140.md`(本版本8K级详细交付说明)
- 新增 `docs/DEVLOG_V10140.md`(V10.14开发决策日志:5类问题根因分析表+修复对比矩阵+16文件修改级摘要+≈454断言全绿测试矩阵+5项遗留风险与缓解)
- 新增 `docs/ITERATION_PLAN.md` V11.x 五Phase路线图 + 三项核心建议(后端选型升级/APK热更新/原生加固)

#### 🔧 双端同步脚本过期值治理(从硬编码到参数化优先级链):
- `scripts/backup_to_feishu.py` 完全重写: folderToken = `OS环境变量FEISHU_FOLDER_TOKEN` > `version.json.feishuConfig.folder` > 正确公开默认值 `nodcnGA95g93RhIUSdCeTkhKlQc`(替换V5.3硬编码过期值 `WdXUfZPkClI1audQxIYc90XRnWc`)；自动从version.json读取版本号；飞书Drive目录与APP端对齐为6个子目录(同步数据/注册申请/审批结果/备份文件/vehicle_images/vehicle_videos,缺失则递归get_or_create创建)；新增凭据环境变量预检(缺 env 友好错误提示不抛 stack)
- `scripts/push_github_final.sh` 完全参数化: `GH_TAG APK_PATH REPO ASSET_NAME BRANCH` 全部 `环境变量 > version.json > 默认值` 优先级链；APK预检 5MB≤size≤120MB(太小直接阻断,太大warn 3s确认)；sha256sum自动生成(APK同目录.sha256)；GitHub发布五步：推送分支 → 删除旧tag下APK/SHA同名资产 → Auto Draft Release → 上传APK+SHA → PATCH Draft→正式发布(引用 docs/RELEASE_Vxxx.md 作为Release Body)

#### 🤖 行业标准构建/CI/签名基建补齐:
- 新增 `scripts/build_android.sh`: 环境自检(ANDROID_SDK/KEYSTORE/CORDOVA/NODE)→ cordova clean/prepare(触发Secret注入hook) → build release → zipalign 4字节对齐 → apksigner v1+v2+v3 三模签名 → apksigner verify 自校验 → SHA-256 生成 → release/ 产物清单；缺keystore时自动回退输出unsigned APK(兼容CI首跑)；版本号从version.json动态读取,无需手改脚本
- 新增 `scripts/build_ios.sh`: TEAM_ID / Automatic / Manual 签名三态；TEAM_ID缺失仅 cordova prepare 停止(工程检查形态)；xcodebuild archive → ExportOptions.plist 生成 → xcodebuild -exportArchive；IPA/SHA/xcarchive(.dSYM符号) 统一到 release/；三种签名路径注释占位：本地自动签名/GitHub Actions证书base64注入秘钥链/Fastlane match+gym+pilot企业推荐
- `.github/workflows/android-release.yml` 现有内联签名流程后追加「Generate APK SHA-256 Checksum」step；Upload artifact/Create Release files 均数组化同时上传 `APK + .apk.sha256`；新增 body_path 注释引用 RELEASE_Vxx.md(取消注释即可直接拼 Release Note 详情)
- `.github/workflows/ci.yml` 追加 V10.14 专项 step(npm run test:v1014)；上传校验摘要新增 版本号/V10.14 通过失败统计 两行输出
- **🚑CI阻断解除(发版流水线修复)**: `scripts/gen_media_mapping.js` `loadVehicles()` 由单点 `indexOf('const VEHICLES=')` 升级为正则双格式兼容 `/(?:const\s+VEHICLES\s*=|window\.VEHICLES\s*=)/`——`sync_feishu_local.js` 云端同步重写 `vehicles_data.js` 后声明格式变为 `window.VEHICLES = [`,旧解析直接抛「未找到声明」导致 main 与发版分支 CI「映射表一致性校验」连续失败(2026-09-01起3次)；修复后映射表 73 条记录再生成并校验通过,记录本身无漂移(仅解析崩溃)
- **📚4文档成套**: 新增 `docs/ROOT_CAUSE_V10140.md`(4根因证据链) + `docs/SOLUTIONS_V10140.md`(4问题×5方案选型矩阵) + `docs/TEST_REPORT_V10140.md`(454断言矩阵+基建验证+CR结论) + 更新 `docs/RELEASE_V10140.md`(交付清单/发版流程§8)

#### ✅ Clean Code 代码审查:
- **空Catch治理**: 合计补充 17 处关键路径 空catch日志——同步关键路径10处(05-sync.js)区分 console.debug(预期失败/新旧位置回退)/console.warn(API异常/列表失败)；localStorage配额满(00-bootstrap.js)；震动设备不支持(06-media.js)；OTA 三个版本源 回退失败(07-cache.js)。全部禁止裸 `catch(e){}` 或纯注释
- **复杂业务JSDoc**: `doSyncDownload` 追加完整JSDoc，解释 timestamp+ID差集双通道 决策必要性来源于 3 类真机盲区+空云端熔断
- **长函数检查**: `doSyncDownload` 实际 91 行(<150阈值)，无需拆分

#### ✅ 版本专项测试:
- 新增 `tests/test_v1014_zero_config_member.js` 真机级 Mock 10 场景 49 断言(Z1闭包注入/Z6闭包私有性/Z7清缓存幂等/Z2琥珀横幅/Z3绿色横幅+readonly/Z4蓝色管理员横幅/Z8三色class状态机/Z9成员save深度防御+组长admin写入/Z10历史脏配置覆盖防御/Z5镜像决策6子场景)
- 基建兼容修复:`tests/e2e_harness.js DEMO_BLOCKS` 首项追加 `_INJECTED_SECRETS_CACHE`(V10.14新引入声明必须前置于getFeishuCfg注入,否则旧V1011/v1013基于harness的测试崩溃)；`tests/test_v1013_a3.js` G组版本一致性从硬编码10.13.0改为三端全等动态断言；`tests/test_v104_fixes.js` A28同步屏版本与demo.html静态默认值从v10.13.0→v10.14.0
- **全量回归≈454断言 0 FAIL**：V53运行时21 + V57逻辑34 + V103六大62 + V104十维46 + V105批量49 + V106导出33 + V107防抖31 + V108回退20 + V109视频17 + V1010分片18 + V1011镜像6 + V1013复杂度68 + V1014零配置49 = 合计454断言/0失败。test:cross需真实飞书Secret跳过(预期)

#### 🚩 版本四处一致性(appId/versionCode):
- `js/00-bootstrap.js` APP_VERSION 常量 = 10.14.0
- `config.xml` version/versionCode = 10.14.0 / 101400
- `version.json` version/versionCode/downloadUrl(→V10.14.0 release URL) + releaseNotes[] 推8项V10.14.0详细条目 + 修复 releaseNotes 数组中JSON语法错误(缺失逗号/截断)
- `demo.html` 同步屏本地版本静态默认 id=sync-local-ver → v10.14.0(运行时仍会被JS重写为常量APP_VERSION,静态模板默认值仅用于jsdom测试A28)

## [10.13.0] - 2026-09-01

### 复杂度治理版(方案A Phase A3)

- **四刀切(A3-1)**: `pullPendingFromFeishu` 165行单函数 → `fetchPendingFromCloud`(①网络IO) / `applyApprovalRules`(②审批规则) / `writePendingsToStorage`(③持久化) / `refreshMemberUI`(④渲染+通知) 四个单一职责函数，主流程为编排薄壳；失败自愈路径(缓存失效重试)同步收敛到同一编排，消除主/自愈双份内联逻辑
- **渲染/业务分离(A3-2)**: `renderVehicleList` 拆出 `filterVehicles`(纯数据过滤,无DOM/state依赖,可独立单测) 与 `renderVehicleCards`(纯DOM拼装,输入已过滤list,输出html字符串)；平铺/树形两种视图的过滤与渲染职责彻底解耦
- **状态守卫(A3-3)**: 新增 `State` 门面 API — `vehicles/users` 只读副本(外部改动不污染内部数组)、`addVehicle/updateVehicle/removeVehicle/pushVehicle/replaceVehicles/addUser/removeUser` 受控写入口(含必填兜底/拼音/持久化收敛)；`promoteToLeader()` 直接抛错，杜绝前端提权(用户角色只能由组长审批或云端同步产生)；`saveVehicle/confirmDeleteVehicle/02-auth注册/07-cache成员增删` 等写入点全部收敛到 State
- **XSS绊线(A3-4)**: 开发模式(非Cordova)安装 `innerHTML` 注入绊线 — 拦截 `<script` 标签注入与 `javascript:` 伪协议两类明确风险片段，默认 `console.warn` 留痕不阻断(兼容117处内联事件合法形态)，`window.__XSS_GUARD_STRICT__=true` 严格模式直接抛错阻断(供测试与安全审计)；生产APK零开销零行为差异
- **版本对齐(A3-5)**: `version.json`(10.13.0/101300)、`config.xml`(version+android-versionCode)、`APP_VERSION` 三处同步
- **测试(A3-6)**: 新增 `tests/test_v1013_a3.js` 专项(静态结构/State守卫行为/渲染分离纯函数性/审批规则四刀切/XSS绊线/版本一致性)；`package.json` 新增 `test:v1013`，`test:all` 扩展至 V53~V1013；CI 新增 V10.13 step
- **测试基建收口(修复A2/A3遗留)**: `e2e_harness.js` 新增共享 `inlineDeferScripts`(js/*.js defer内联回原时序)与 `inlineStylesheets`(css/app.css内联回原文)，修复 V53运行时/V103~V109/V57跨网络 9个旧测试读不到拆分后源码的问题(V53曾整体崩溃"VEHICLES is not defined")；`DEMO_BLOCKS` 补注入 `State`(修复A3后 doSyncDownload 走State API导致 V1010/V1011 E2E 镜像同步全挂)；`demo.html` 同步屏本地版本号静态兜底 v10.11.0→v10.13.0；V106 A11/A18/A23、V103 A17、V109 A2 断言更新为A3等价形态；V108 A16 与 V1010 E1 版本断言从硬编码改为三端动态一致(发版免改测试)。全量回归 V53/V57logic/V57cross/V103~V109/V1010/V1011/V1013 全绿(0失败)

## [10.12.0] - 2026-09-01

### 渐进式重构版(方案A)

- **单向收敛(核心 A1-1)**: 飞书上传双轨 → 单例化统一。旧版 `demo.html` (含220ms QPS门控+1061021事务过期二次prepare重传+Cordova http.ponyfills双栈+1061109文件名清洗) 与 `feishu-api.js`(仅fetch且无可靠性特性) 长期功能漂移，本次把 demo 完整实现下沉到 `FeishuAPI.driveUploadFile/driveUploadFileMultipart`，新增 `FeishuAPI.httpUploadFile(params)/httpUploadFileMultipart(params)` 与 demo 同签名兼容入口，demo 内 189 行大实现改为 2 行薄壳委托，从架构上杜绝后续双真源回归
- **导航栈封装(q4 §七-4)**: `navHistory` 11 处散点直操作 → `navPush/navPop/navReset/navRemove/navTop` 五个封装函数，集中内置登录族不入栈、连续重复去重(防御性)、栈深度上限 20、特定页面残留移除，彻底根治 goBack 多层连跳/返回编辑页错乱
- **XSS 用户字段全转义(q3 §七-3)**: `renderVehicleCard`/`renderVehicleList`(含 recent-section+分级列表 brandMap/seriesMap)/`_renderVehicleDetail`(车辆详情所有模板)/`openEditVehicle`(编辑页表单 value/textarea) 等用户可见关键 innerHTML 路径，全部对 `v.display/v.powerType/v.position/v.size/v.brand/v.series/v.config/s.name/s.en/s.note/s.step/s.keyFrame/s.keyContainer/u.name 等` 包裹 `esc()` 5 字符转义
- **降低嵌套深度(q2 §七-2)**: `fetchFeishuPhotoDataURL` 原 5 层 if 箭形嵌套 + Cordova/Promise 回调共 8 层，抽出 `_feishuDownloadBlob(token,fileToken,mimeType)`(12行 Cordova/fetch 双栈下载) 与 `_feishuLocatePhotoFile(token,dataFolder,fileName)`(dataFiles→imgFolder→target 三级卫语句)，重写为 2 层卫语句 + try/catch 单 if，最大嵌套 ≤ 4 层
- **测试 & CI 补齐(q1 §七-1)**: `package.json` 新增 `test:v106`~`test:v1011` 脚本(含 v1010 solutions+sync 双组合)，`test:all` 扩展为 V53~V1011 全量；`.github/workflows/ci.yml` 在 V105 step 后追加 V106~V1011 六个 step
- **不变量保证(方案A核心原则)**: 全局 241 个函数名保留、117 处 onclick 零改动、`showScreen/goBack/doLogin/hashPassword/esc/saveUsers/...` 全部签名兼容，可回滚
- **A1-2 ✓ Secret 构建时注入(防反编译还原硬编码)**：从 demo.html 移除唯一真密文 `_FS_XOR_KEY + _fsDec(hex_cipher)` + `DEFAULT_FEISHU_CONFIG.appSecret` 声明；重写 `getFeishuCfg()` 优先级 `window.__BUILD_SECRETS__`(读后立即 delete，用完即焚) → localStorage 用户保存值 → 回退公开 DEFAULT(仅 appId/folder，version.json 已公开这对非机密)。新增 `scripts/inject_build_secrets.js`(模式 `--check`/写入 `</head>` 前幂等重入/`--strip` 清理) + Cordova 钩子 `hooks/before_build/01_inject_secrets.js`(失败直接 abort 构建)。CI：`ci.yml` 新增 "Secret注入基线校验" step(Fork PR 无 Secret → `FEISHU_STRICT=0` 降级不阻断)；`android-release.yml` Verify assets 后新增 "Inject Feishu build secrets" step(严格模式缺 env 直接失败，防发空 Secret 版本)。校验端：`validate_web_assets.js` 升级为新 3 态合规(注入脚本存在+getFeishuCfg引用&delete__BUILD_SECRETS__+DEFAULT字面量无appSecret声明行 → 通过)；`test_v57_logic.js` 旧"解码32位"断言升级为四条正向安全基线(1.4无硬编码/1.4b_fsDec不存在/1.4c getFeishuCfg双语句存在/1.4d 若提供env则注入归并优先级验证)；`e2e_harness.js` DEMO_BLOCKS 移除已不存在的 `_FS_XOR_KEY/_fsDec`
- **A2-1 ✓ CSS 抽取解耦**：demo.html L34-L245 内联 211 行 CSS 完整提取至 `css/app.css`；demo.html 内联替换为 `<link rel="stylesheet" href="css/app.css">`；`android-release.yml` Prepare build environment step 新增 `cp -r css tcg_app/www/css`(保证 APK 内含 css 目录生效)
- **A2-2/A2-3 ✓ 主 Script 九模块连续拆分 + demo.html 骨架化**：主 script 6570 行(L603-L7172)按依赖拓扑切为 9 个 defer 模块(边界零 gap/零 overlap，全量代码覆盖)— 00-bootstrap.js(拼音+品牌车辆数据+用户密码工具+飞书Cfg/HTTP/上传三兄弟/缓存索引+APP_VERSION/esc, 1200行) → 01-state.js(state对象/navHistory五层封装/路由常量+_activateScreen/showScreen/goBack, 144行) → 02-auth.js(注册审批登录找回, 177行) → 03-vehicles.js(品牌渲染/搜索筛选/车辆列表详情编辑保存/分享, 806行) → 04-export.js(Excel+zip压缩/Word OOXML/PDF canvas+legacy/批量折叠导出, 1201行) → 05-sync.js(审批轮询/成员守护/备份/JSON上传下载/doSyncUpload+Download/导入导出配置/同步日志, 1522行) → 06-media.js(图片查看/视频播放器/飞书云端图片视频/户外模式/模态框与硬件反馈, 724行) → 07-cache.js(缓存管理器/组员增删改/密码变更/校验工具/showToast/通知/版本更新与APK下载, 633行) → 08-main.js(Android backbutton/migrateLegacyMedia/deviceready入口/顶层side-effects, 163行)。demo.html 移除 <script> 6570 行内联大代码，紧接现有 `<script src="feishu-api.js">`（同步加载，保证 FeishuAPI 先于 defer 就绪）后顺序写入 9 行 `<script defer src="js/0x-xxx.js"></script>`。不变量：241 个全局函数名/签名 100% 保留、117 处 onclick 裸调用零改动、所有声明为顶层 function(自然挂 window，不包 IIFE 闭包)
- **A2-4 ✓ 测试基建 A2 兼容**：`tests/e2e_harness.js` 新增 `loadCombinedSource()`(demo.html 源码 + js/*.js 排序后拼接 → 统一注入 extractNamedBlock 沙箱)；`tests/test_v57_logic.js` 新增 `inlineDeferScripts()`(检测到 <script defer src=js/> → 内联回 <script> 并移至 `</body>` 前还原原始执行时序；内联内容做 HTML-tokenizer 净化：字面 `</script`/`<!--` 替换为 JS 语义等价的 `<\/script`/`<\!--`，防注释说明文字截断脚本块)；维度4 旧断言升级为 V10.12 基线(4.1 默认配置非Secret字段全备+无硬编码Secret；4.2a 默认未注入→feishuCfgReady=false 安全拦截；4.2b 模拟构建注入→立即就绪；4.2c 注入Secret用完即焚)；`scripts/validate_web_assets.js` 新增 `loadDemoPlusJs()` → 关键能力标记/Secret合规形态 3 态判断 统一扫 demo+js；`tests/test_v1010_sync_e2e.js` E1 版本断言升级为扫描 demo.html + js/* 组合字符串(APP_VERSION 常量现落在 00-bootstrap.js)
- **A2-5 ✓ 本地无 npm 环境引导工具**：开发机仅有裸 node.exe(无 npm/corepack/python)，新增 `scripts/bootstrap_npm.js`(Node 内置 https+zlib+最小 ustar/pax/GNU长名 tar 解包器，从 npmmirror/npmjs 下载官方 npm tarball 自解包到 `scripts/.npm-vendor/`)，使本地可运行 `node scripts\.npm-vendor\npm\bin\npm-cli.js install jsdom`；jsdom 已装至根 node_modules(V57 34/34 全绿验证)；`.npm-vendor/.npm-scratch/node_modules` 均不入库(gitignore)且凭证扫描排除

## [10.11.0] - 2026-08-31

### 镜像同步版(删除传播修复)

- **修复(根因)**: 组长删除车型后组员端不同步删除 — 旧版 `doSyncDownload()` 拉取合并只做**正向差集**(云端新增追加/同ID覆盖),**反向差集**(云端已删除的车型)永久滞留组员本地,导致两端车型数量越差越大;历史遗留证据: 旧版 `localIds` 声明后从未使用,即"删除同步从未实现"
- **镜像对齐**: 云端为唯一真源,拉取后本地与云端**完全对齐** — 新增/更新/删除全量传播,组长组员车型数量严格一致(`本地 = 云端` 镜像语义)
- **删除传播核心**: 本地存在但云端已无的ID → 移除;`VEHICLES` 数组**原地替换**(`length=0` + `push`),持久化与渲染闭包持有的引用不失效
- **防误清空**: 云端车辆数为0但本地有数据时视为异常,拒绝镜像同步,保护组员本地数据不被空数据覆盖
- **同步提示**: 完成通知升级为「新增N条 更新N条 删除N条」,删改明细一目了然;云端无更新时显示「数据已是最新」并跳过镜像,避免误删组员本地导入的备份数据
- **测试**: 镜像同步专项6用例(删除传播/增删改混合/幂等性/空云端防御/删除计数提示/多轮压力) + V10.10.0历史回归18用例,全部通过(0失败)

## [10.10.0] - 2026-08-31

### 飞书大文件分片同步版

- **修复(根因①)**: 新车型(含随机名称文字/图片/视频)经飞书同步组长组员数据失败 — 飞书 `upload_all` 接口单文件硬上限20MB,现场视频10-50MB必败(`1061043 file size beyond limit`),失败视频 base64 滞留 `videoPaths` → 同步JSON膨胀至数十MB → 整条管线中断 → 组员端永远拉不到新数据;接入飞书官方分片上传三件套(`upload_prepare`/`upload_part`/`upload_finish`),4MB定长分片+Adler-32校验,支持500MB大视频
- **新增**: 智能上传路由 `httpUploadFileSmart()` — ≤16MB走upload_all,>16MB走分片,`1061043`自动升级分片重试双保险
- **可靠性**: 每片3次重试+指数退避;`1061045`频控自动退避;`1061021`事务过期自动重新prepare整段重传;QPS门控串行220ms间隔(贴官方5QPS限制)
- **修复(根因②)**: 随机名称防护 — `_sanitizeFeishuFileName()` 清洗控制字符/非法符/emoji/超长名,杜绝 `1061109` 合规拒绝
- **修复(根因③)**: `_syncUploadPipeline`/`doSyncDownload`/`checkCloudDataUpdate` 三处 cfg 补齐 `syncSub`,同步数据稳定落入"同步数据"子目录,不再被迁移清理误删
- **守卫**: 同步JSON体积预检,残留base64媒体诊断性失败而非静默上传;管线返回媒体失败计数(`photoFailed`/`videoFailed`/`pendingMedia`)不再吞掉部分失败
- **修复(feishu-api.js)**: `driveUploadFileMultipart` 双解包缺陷 — `request()` 已解包返回,旧版误按完整响应检查 `prep.code` 导致分片上传必然抛"预上传失败: 无响应"
- **测试**: 真机模拟E2E 18用例 + 方案逐个对比9用例 + 历史回归17用例,全部通过(0失败);新增高保真飞书Mock服务器与真机模拟沙箱测试基建
- **文档**: `docs/ROOT_CAUSE_V10100.md` 根因报告 / `docs/SOLUTIONS_V10100.md` 7+2套方案穷举对比 / `docs/TEST_REPORT_V10100.md` 测试报告 / `docs/RELEASE_V10100.md` 发布文档

## [10.9.2] - 2026-08-27

### 分级列表修复 + 性能优化版

- **修复(问题1)**: 车型页分级列表不显示新增车型 — 自定义品牌(brandId 不在 BRANDS 中)的车辆在分级视图中无处归属直接"消失";修复方案:分级列表新增「其他品牌」分组收纳自定义品牌车辆,品牌标签栏新增「其他(N)」筛选入口,编辑车辆改品牌后 `brandId` 同步更新(此前编辑只改 `brand` 名称不改分组 ID)
- **性能优化**: 品牌标签栏从 O(n×m) 嵌套 filter 改为一次遍历统计;分级列表从多次 filter 改为 `brandId+series` 两级 Map 预分组;搜索输入增加 150ms 防抖,避免每次按键全量重绘 DOM

## [10.9.1] - 2026-08-27

### 组员端导入备份功能版

- **新增(问题3)**: 组员端数据同步页增加「导入备份 — 从本地恢复」功能 — 选择 `cloud_sync_config.json` 备份文件 → 智能合并(同 ID 覆盖/新增追加) → 二次确认 → 持久化到本地;支持三种格式兼容:标准 `sync_config_backup`/旧版 `vehicle_poweroff_backup`/裸车辆数组
- **权限设计**: 组长/组员均可使用导入备份 — 导入为本地数据恢复操作,不涉及上云,因此组员端(只读角色)也开放;上传至飞书仍仅限组长
- **安全防护**: 文件大小限制(50MB)+格式校验(JSON parse)+二次确认弹窗+导入结果统计(新增/覆盖数)+同步日志记录

## [10.9.0] - 2026-08-26

### 视频分离上传 + UI适配修复版

- **修复(问题1根因)**: 组员端收到通知但拉取数据失败 — V10.6.0 仅分离了照片 base64,视频仍以 `data:video/;base64,` 留在 `videoPaths`,单段视频 base64 编码后常达 10-50MB,JSON 膨胀至数十 MB 导致飞书下载接口超时/`JSON.parse` 在移动端 WebView 内存受限下 OOM 崩溃;V10.9.0 实现 `syncUploadVehicleVideos()` 函数,上传前把 `data:video` base64 分离 → 转 Blob → 单独上传至云端 `APP数据备份/vehicle_videos` 目录 → `videoPaths` 原位替换为云端相对路径(与内置数据同构) → JSON 只含轻量路径;幂等设计:文件名 = 车辆 id + 序号 + 内容哈希,重复上传命中云端同名文件即跳过
- **修复(问题1健壮性)**: 所有飞书文件下载路径(主同步数据/注册申请/自愈分支)增加超时保护 — 原生 HTTP 路径增加 `timeout` 参数(60-120 秒),`fetch` 路径增加 `AbortController`(60-120 秒),防止弱网下永久挂起;下载失败提供清晰超时提示而非模糊错误
- **修复(问题2-1)**: 数据页顶端标题和返回按键显示不全 — CSS 覆写将 `pt-12` 的 `padding-top` 从 48px 降到 `safe-top+12px`,Android WebView 的 `safe-area-inset-top` 恒为 0 导致仅 12px(不够);修正为 `safe-top+48px`
- **修复(问题2-2)**: 数据同步下方按钮显示不完整 — CSS 覆写将 `pb-24` 的 `padding-bottom` 从 96px 降到 `safe-bottom+24px`,Android 上仅 24px < 底部导航 64px;修正为 `safe-bottom+96px`
- **修复(问题2-3)**: 云端数据同步中心从右往左滑动有大片留白 — `.scroll-y` 仅有 `overflow-y:auto` 缺少 `overflow-x:hidden`,部分 Android WebView(含红米 K70 Pro Android 16)将 `overflow-x:visible` 解析为 `auto`;增加 `overflow-x:hidden`
- **测试**: V10.9.0 全链路同步管线测试 32 用例(0 失败) — 覆盖视频分离上传逻辑/JSON 体积缩减/下载超时保护/全链路同步流程/边界条件/CSS UI 适配/数据完整性/端到端同步模拟
- **文档**: `docs/RELEASE_V1090.md` 完整开发文档

## [10.8.0] - 2026-08-26

### 云同步根治 + 注册审核回退版

- **修复(问题1根因)**: 云同步失败 `{"code":1061002,"msg":"params error."}` — `cordova-plugin-advanced-http` 的 `uploadFile()` 将飞书必填参数(file_name/parent_type/parent_node/size)序列化为 URL 查询串,而飞书 `upload_all` API 要求这些参数作为 `multipart/form-data` 体中的表单字段;V10.8.0 改用 `sendRequest()` + `serializer:'multipart'` + `FormData`,所有参数(含文件 Blob)由插件 multipart 序列化器通过 `FormData.entries()` 遍历,完整构造符合飞书 API 要求的 multipart 体;优先使用插件 ponyfill `FormData` 兼容老旧 WebView;移除 `writeBlobToCache` 临时文件依赖(Blob 直传)
- **修复(问题2)**: 注册审核回退至 V10.6.0 策略 — 本端申请恢复 `pending` 态等待组长人工审批;移除 `autoApproveLegacyPendingUsers` 历史迁移函数(空操作);注册文案恢复"请等待组长审核";仅保留跨网络组员自动通过 + hidden 隐形 + 即消费即删(V10.6.0 策略不变)
- **继承 V10.7.0**: 保存即自动同步(8 秒防抖 + 未上云媒体检测)、组员端菜单权限收紧(canEdit 裁剪)、全界面自适应(viewport-fit=cover + 100dvh + 六维断点)
- **继承 V10.6.0**: 真实 Word/PDF 导出(OOXML + 画布中文)、跨网络申请隐形通过、IndexedDB 持久化、照片分离上传
- **测试**: V10.8.0 专项测试 20 用例 + 全量回归 241 用例(0 失败)
- **文档**: `docs/RELEASE_V1080.md` 完整开发文档

## [5.8.0] - 2026-08-24

### 导出分享方案对齐（基准：安装包 V1.8 React/Capacitor 版）

逆向安装包 `assets/public` 导出/分享链路（分享函数 `Us(blob, filename, title?)` + Excel/CSV/JSON 生成函数），车辆详情与数据中心两处导出全面对齐：

- **单车 Excel 四工作表**：车辆信息（项目/内容两列，缺失字段"未填写"兜底）/ 断电步骤（序号/说明/注意事项）/ 媒体资源（图片逐行、视频逐条）/ 备注；列宽规格与安装包一致（16/60、10/60/40、12/80、80）
- **批量 Excel 汇总+详情**：汇总表（标题/导出时间/记录总数 + 11 列标准表头）+ 前 10 辆"项目/内容"详情子表，子表名取显示名前 20 字符、空兜底"未命名"
- **CSV 规范**：11 列标准表头（含钥匙-框架/钥匙-集装箱/步骤数）+ UTF-8 BOM + CRLF 行尾 + `text/csv;charset=utf-8`，Windows Excel 直接双击打开不乱码
- **JSON 元信息结构**：批量导出为 `{appVersion, backupAt, vehicles, users}`（非裸数组），接收方可识别来源与时间
- **文件命名对齐**：单车 `{显示名}_断电指南.{docx|pdf|xlsx}`；批量 `vehicle_poweroff_export_{ts}.csv` / `vehicle_poweroff_export_{n}_{ts}.{xlsx|pdf}` / `车辆断电指南_批量_{n}_{ts}.docx`；备份 `vehicle_poweroff_backup_{ts}.json`；配置 `cloud_sync_config.json`（固定名，两端互认）
- **分享标题策略**：原生分享面板 `dialogTitle:"选择保存或分享方式"`，标题缺省回退为文件名（对齐安装包 `title:n||t`）；仅批量 JSON 显式传"车辆断电数据导出"

### 新增

- 数据中心"分享备份"一键通道：全量数据 JSON 经系统分享面板直接发微信/钉钉，组员换机/无公网场景免飞书
- 全部导出按钮 Loading 互斥保护 + 导出中禁用防重复提交；导出成功自动清空选择集（对齐安装包行为）
- 导出分享对齐测试套件 53 项（`tests/test_v58_export_align.js`：静态 26 + jsdom 运行时 27），覆盖 Excel 工作表结构/CSV 编码/JSON 载荷/文件命名/Loading 互斥/空 catch 治理

### 修复

- 单车 Excel 媒体资源表视频由合并单行改为逐条一行（对齐安装包结构）
- 空兜底文案统一：媒体"无"、步骤"暂无步骤"、备注"无"

## [5.7.0] - 2026-08-23

### 修复（四大问题根治）

- **文档分享**：CI 构建此前遗漏 `vendor/` 导出库与 `vehicle_images/` 车辆图片，导致 APK 内 Word/PDF/Excel 生成失效；现已完整打包，恢复 V5.3 级别的文档分享体验
- **返回键逻辑**：编辑保存后不再退回编辑表单；登录页返回键正确触发双击退出；登出/注册后返回键不再退回已登录界面；弹层/查看器打开时返回键逐层关闭
- **飞书备份与更新**：内置默认凭证（混淆存储）开箱即用；数据分仓：同步数据/注册申请/审批结果/备份文件各自独立子文件夹，与项目交付产物彻底分离
- **跨网络注册审批**：组员申请秒传云端；组长 60 秒轮询、切回 APP 即拉取；审批结果云端秒同步；组员新设备登录自动发现云端账号

### 新增

- 文档导出照片预取 20 秒超时保护：云端照片不可达时导出无图文档而非卡死
- 文件 token 缓存失效自动重试自愈（换飞书应用/云端文件夹重建场景）

### 工程化

- CI 签名构建全链路修复：`KEYSTORE_BASE64` 自动解码签名（V5.4 以来构建失败根因）、Manifest merger 冲突根治、FileProvider `file_paths.xml` 补齐、zipalign 改用 SDK build-tools 全路径、`contents:write` 权限声明（Create Release 403）
- `cordova-plugin-dialogs` 固定 2.0.2（3.0.0 构建崩溃）
- `x-socialsharing` 6.0.7 → 6.0.4（npm 不存在 6.0.7 导致构建崩溃）
- 移除 `qrscanner` 插件（AGP8 不兼容），patch 脚本增加防御性 gradle 清洗
- 校验脚本支持 V5.7 `_fsDec` 混淆 Secret 合规形态

### 安全

- 默认飞书 App Secret 以 `_fsDec` 混淆存储（V5.7 开箱即用、非明文合规），仍可在设置页覆盖

## [5.6.0] - 2026-08-23

- 升级版本号至 V5.6（内部迭代基线）
- 更新 README 版本标注

## [5.4.0] - 2026-08-23

### 安全加固

- **密码哈希化**：所有本地密码改为 SHA-256 + 随机盐值（`salt$hash` 格式）存储
- **自动迁移**：启动时幂等升级明文旧密码为哈希格式；首次登录自动升级，零用户感知
- **云端去密码**：上传飞书的 `approved_users.json` / `pending_reg_*.json` 均不含密码字段
- **凭证清理**：从 `demo.html` / `feishu-api.js` 移除硬编码凭证

## [5.3.6] - 2026-08-22

- FeishuDataLayer 统一封装层；车型/用户数据双向同步（Bitable）
- 全量备份与恢复（云文档 JSON 快照，保留最近 10 个）
- 审批流完整化（创建/查询/状态同步）
- 应用内直装更新（file-opener2）；Android 13+ 通知权限适配
- 组长审批提醒升级为状态栏通知；`config.xml` content src 修正
- CI 双流水线（校验 + Release 构建）上线

## [5.3.5] - 2026-08-22

- 教学视频 GitHub Release 直链秒开（buildNumber=7）
- 飞书产物区双端同步落地：REST 直连修复 unsafe file path

## [5.3.1] - 2026-08-21

- 飞书 App Secret 从默认配置移除，代码库零明文凭证
- 签名 keystore/APK 移出 git 跟踪；构建脚本密码环境变量化
- CI 凭证泄露扫描关卡上线

## [5.3.0] - 2026-08-20

- 数据分仓：项目产物与用户数据物理隔离
- 原生 HTTP 通道（advanced-http）修复真机飞书 CORS 静默失败
- 文件分享三级策略；MIME 自动修正
- 旧照片数据自动迁移（`images/` → `vehicle_images/`）
- 视频四源回退链 + 组长上传通道（≤20MB → 飞书云端）
- Android 硬件返回键六级路由
- 离线化：Tailwind/SheetJS/jsPDF/html-docx 全部本地化进 APK

## [4.0.0] - 2026-06-15

- 账号系统与角色权限（组长/组员）

[5.8.0]: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v5.8
[5.7.0]: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v5.7
[5.6.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.4.0]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.6]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.5]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.1]: https://github.com/361087210/taicanggang-poweroff-guide
[5.3.0]: https://github.com/361087210/taicanggang-poweroff-guide
[4.0.0]: https://github.com/361087210/taicanggang-poweroff-guide## [10.27.0] - 2026-11-23

### 资源库分页 + 车型信息双向强关联

> 资源库原本一次性渲染 300+ 行(首屏 DOM 约 304KB)，且台账是发版快照 —— 车型侧改了图，资源库不会跟着变；资源库删了文件，车型的照片计数与板块标签也不会跟着改。

#### ⚡ 资源库:
- 改为 **50 条/页** 分页渲染（首屏 DOM 约 **304KB → 44KB**），底部「上一页 / 第 x/y 页 / 下一页」，越界自动钳制
- 切换筛选或输入搜索自动回到第 1 页；搜索只重画计数/列表/分页区，输入框不失焦

#### 🔗 车型 ↔ 资源库强关联:
- **车型改了 → 资源库立即看到**：列表合并「索引快照 + 车型当前引用」，新增/换图以「新增」状态出现；车型侧删掉的图，索引行自动隐藏（不再有幽灵行）
- **资源库改了 → 车型信息跟着更新**：上传/删除同步维护 `photoPaths/videoPaths` 与 `photos/videos` 计数，并保持 `photoSections/photoLabels` 与照片**按下标对齐** —— 修掉「删掉第 1 张后，第 2 张顶着第 1 张板块/标签」错位
- **回写飞书**：资源库增删后 3 秒防抖复用既有上传管线，组员端与 cron 索引不再停在旧状态
- **云端核对不误报**：已知集合改为「索引 + 实时引用」并集

#### 🔍 清晰度 (照片/视频):
- 现场照片本地压缩 **1600px/q0.9 → 2400px/q0.92**；上云归一 **1280px/q0.85 → 2560px/q0.9**，放大查看不再糊
- 查看器高清升级阈值 **700 → 1600**：433px 内置旧图、1280px 旧上传图都会自动探测并热替换云端高清版
- 视频不做二次压缩（沿用原始文件）；Release 上极小的历史视频为源文件本身分辨率低，需重新上传原片

#### 🧯 媒体缺失不阻断业务:
- **媒体只是补充**：照片/视频分离上传失败（目录不可用 / 权限 / 网络）不再让整次同步失败，车型文字信息照常上云
- 上云副本自动剔除未上传的 base64 媒体，并同步裁剪 `photoSections/photoLabels`，路径与计数始终对齐；本地数据不改，下一轮自动重试
- 从飞书拉取时保留本机尚未上云的 base64 媒体，不会被云端副本覆盖丢失
- 资源库预览兼容「车型实时新增」行；图片/视频文件缺失时显示明确占位，不报错、不影响其他操作

#### 🧩 车型增删改查细化:
- 新增/编辑拦截**同名显示名称**（目录名即归属，同名会共用媒体目录、串车）
- 删除提示改为真实语义：只删车型记录，独享媒体保留在云端成为孤儿（可在资源库清理），避免误删原件
- 删除/编辑均不依赖媒体文件存在与否

#### 🛡 门禁 / 🧪 测试:
- `ci.yml` 新增「资源库索引一致性」：`npm run check:media-library`
- `tests/test_v10257_media_library.js` 扩到 **86 断言**（分页 / 双向联动 / 计数重算 / 删除时元数据同步剔除）
- `tests/test_v10251_media_fallback.js` 扩到 **27 断言**（新增上云快照剔除、拉取保留待传媒体、清晰度参数回归）

---


