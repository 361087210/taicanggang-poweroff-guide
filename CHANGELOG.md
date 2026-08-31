# Changelog

本文件记录太仓港商品车断电操作标准化指导平台的所有重要变更。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
[4.0.0]: https://github.com/361087210/taicanggang-poweroff-guide
