# 太仓港停电指南 APP 迭代计划

## 已交付 V10.6.0（当前）

### 六大问题收口（详见 docs/RELEASE_V1060.md）
- [x] 问题1: Word真OOXML生成器(ZIP标准包)+html2canvas中文PDF画布链路——文档真实可打开,中文零乱码
- [x] 问题2: 跨网络组员申请完全隐形(即时激活+全UI过滤+即消费即删+仅console留痕)
- [x] 问题3: 本地备份直存通道saveBlobToLocalFolder——不再调起分享控件
- [x] 问题4: IndexedDB全量快照持久化+照片分离上传(哈希幂等)——新增数据真实同步飞书,组员可拉取
- [x] 问题5: 飞书同名旧档清理脚本(dry-run安全)+真机冒烟验证方案(12项矩阵)
- [x] 问题6: 版本10.6.0三处一致+241项全量回归零失败

## 已交付 V10.5.0

### 分享真实化+缓存留存
- [x] 分享链路反转: Cordova原生插件优先(文件落盘→file://→Intent.ACTION_SEND真实附件)
- [x] canShare({files})硬校验,杜绝文本-only盲调降级
- [x] 缓存视频/文档「保存到本地」: 公共Download目录+全版本权限适配
- [x] 死代码清理: modal-share静态占位面板移除

## 历史版本

### 已交付 V5.7

### 四大问题根治
- [x] 文档分享：vendor 导出库与车辆图片完整打包进 APK
- [x] 返回键逻辑：编辑保存/登录/登出/弹层六级路由修正
- [x] 飞书备份分仓：同步数据/注册申请/审批结果/备份文件独立子文件夹
- [x] 跨网络注册审批：组员秒传云端 + 组长轮询 + 审批结果云端秒同步
- [x] 导出照片预取 20 秒超时保护；文件 token 缓存失效自动重试自愈

### CI 签名构建根治（V5.4 以来全链路修复）
- [x] `KEYSTORE_BASE64` 自动解码签名
- [x] Manifest merger 冲突根治 / FileProvider 资源补齐 / zipalign 全路径
- [x] 插件版本锁定（dialogs 2.0.2、x-socialsharing 6.0.4）、移除 qrscanner
- [x] `contents:write` 权限声明（Create Release 403 修复）

## 已交付 V5.3.6

### 核心改进
- [x] FeishuDataLayer 统一封装层
- [x] 车型/用户数据双向同步（Bitable）
- [x] 全量备份与恢复（云文档 JSON 快照）
- [x] 审批流完整化（创建/查询/状态同步）
- [x] 应用内直装更新（file-opener2）
- [x] Android 13+ 通知权限适配
- [x] 组长审批提醒升级为状态栏通知
- [x] config.xml content src 修正
- [x] 存储权限 maxSdkVersion 放宽

## 规划 V5.8（短期，见 docs/V5.8迭代计划.html）

### P0（2026-09 中旬）
- [ ] 数据同步冲突解决：rev 修订号 + 三方合并（两阶段提交）
- [ ] 注册审批推送实时化：飞书事件订阅替代 60 秒轮询（保留轮询降级）
- [ ] Secret 服务端化：云函数代理，APP 仅持设备码

### P1
- [ ] 飞书原生审批流对接（模板/状态机/通知）
- [ ] 工程化：demo.html 拆分模块化构建（Vite/TS）

---

## 已交付 V10.7.0 ~ V10.14.0（补充，与 CHANGELOG / RELEASE_ 文档双向同步）

### 已交付 V10.7.0（防抖同步+菜单权限收紧）
- [x] checkCloudDataUpdate 轻量级红点通道（version_snapshot_*.json + data_update_notice.json，避免每次打开同步页都拉 2MB JSON）
- [x] 菜单权限收紧（角色判定隐藏 管理员专属入口）
- [x] debounce scheduleAutoSyncAfterSave（保存后防抖 8 秒合并上传，避免连续保存多次 push）

### 已交付 V10.8.0（FormData 根因修复 + 注册审批回退本端人工）
- [x] Cordova 端 FormData 真上传替代伪造 multipart（老版本 Content-Type 缺 boundary 飞书判定 400）
- [x] 注册审批从「自动通过」→ 回退本端人工审批（V10.7.0 保留跨网络自动通过不变）

### 已交付 V10.9.x（视频分离上传 + UI 适配修复）
- [x] 10-500MB 视频与照片同构分离（vehicle_videos 目录 + 飞书分片三件套）
- [x] Android 大尺寸返回键六级路由 + 视频源 fallback 链
- [x] 视频播放器：逐级 fallback（本地 → legacy → 飞书云端 → showVideoMissing 占位）

### 已交付 V10.10.0（飞书大文件分片同步 + 7 大方案对比）
- [x] upload_all 接口 20MB 硬上限突破 → 飞书官方分片三件套 upload_prepare / upload_part / upload_finish 4MB Adler32 校验分片
- [x] 智能上传路由 httpUploadFileSmart（≤16MB upload_all 直达 / >16MB 分片 / 1061043 自动升级重试双保险）
- [x] QPS 门控 / 事务过期重新 prepare 重传 / 500MB 大视频支持
- [x] docs/SOLUTIONS_V10100.md 7 大方案对比（本地/云/混合/分片直传/云函数中转/HTTP Range 等 + 成本/复杂度/落地概率三维打分）

### 已交付 V10.11.0（镜像同步：删除传播 100%）
- [x] 反向差集根治（旧版只正向差集追加/覆盖,localIds 声明后没用,删除从没同步过）
- [x] 镜像对齐语义（本地 = 云端 ID 集合全等）
- [x] 空云端熔断防御（0 台 ≡ 上传中断不覆盖组员本地）

### 已交付 V10.12.0（渐进式重构 A1：单向收敛 + 九模块拆分 + Secret 构建注入 + 导航栈封装 + XSS 全量转义）
- [x] A1-1 单向收敛: demo.html 内联 189 行飞书上传实现 → 下沉 FeishuAPI.driveXxx（httpUploadFileSmart 薄壳双栈兼容入口）
- [x] Secret 构建期注入（A1-2）：`scripts/inject_build_secrets.js` + `hooks/before_build/01_inject_secrets.js`，`window.__BUILD_SECRETS__` 读完即焚；彻底消除硬编码 appSecret
- [x] A2-1 CSS 抽取解耦、A2-2 主 Script 6570 行 → 9 个 defer 依赖拓扑模块拆分、demo.html 骨架化（241 全局函数签名 100% 保留，onclick 不漂移）
- [x] 导航栈封装（散点直操作 11 处 → navPush/Pop/Reset/Remove/Top 五函数，登录族不入栈+栈深上限20/连续重复去重/特定残留清除）
- [x] XSS 用户字段全转义（esc() 5 字符全链路覆盖 display/powerType/position/brand/series/config/step/name/en/note/s.keyContainer）
- [x] 降低嵌套深度(fetchFeishuPhotoDataURL 5 层箭形 → 2 层卫语句)
- [x] A2-5 本地无 npm 环境自举 bootstrap_npm.js（裸 node.exe 用内置 https+zlib+pax/ustar 自解 npm tarball,本地能跑测试）

### 已交付 V10.13.0（复杂度治理 A3：四刀切 + 渲染分离 + State 守卫 + XSS 绊线）
- [x] A3-1 审批四刀切：`pullPendingFromFeishu` 165 行 → `fetchPendingFromCloud / applyApprovalRules / writePendingsToStorage / refreshMemberUI` 单一职责四函数+主流程编排薄壳+自愈双收敛
- [x] A3-2 渲染业务分离：`filterVehicles`（纯数据无DOM/state依赖,独立单测）与 `renderVehicleCards`（纯 DOM 拼装）
- [x] A3-3 State 守卫：`vehicles/users` 只读副本 / 受控写入口（addVehicle/updateVehicle/removeVehicle/pushVehicle/replaceVehicles/addUser/removeUser）/ promoteToLeader() 直接抛错防前端提权 / 所有写入点收敛到 State
- [x] A3-4 XSS 绊线：开发模式(非 Cordova) 安装 innerHTML 注入拦截器，识别 `<script` 与 `javascript:` 伪协议，默认 console.warn 留痕不阻断/严格模式阻断。生产 APK 零开销。
- [x] 68 专项测试全部通过

### 已交付 V10.14.0（组员零配置同步修复：三大问题闭环 + 签名基建补齐）
详见 [RELEASE_V10140.md](./RELEASE_V10140.md) / [DEVLOG_V10140.md](./DEVLOG_V10140.md)
- [x] 修复A 秘钥闭包永久化（_INJECTED_SECRETS_CACHE：清缓存/杀进程/重装不丢）
- [x] 修复B 镜像双通道决策（timestamp + ID集合差集 双触发 OR 组合，3类真机盲区+空云端熔断）
- [x] 修复C 组员三色横幅状态机 + 输入框灰化 + saveFeishuConfig 成员 return 防御 + admin `_writer` 写入标记 + getFeishuCfg pick() 历史垃圾值过滤
- [x] 双端同步脚本过期值治理（backup_to_feishu.py folderToken 优先级链三态从硬编码→环境变量+version.json；push_github_final.sh参数化+APK大小预检+sha256生成/Draft→发布五步）
- [x] 签名基建:scripts/build_android.sh (zipalign/v1v2v3/verify/SHA256/缺keystore unsigned fallback)/build_ios.sh (Automatic/Manual 三态)；android-release.yml 新增 SHA step + 双文件上传；ci.yml 追加V10.14 step
- [x] 全量≈454断言 / 0 FAIL （test:cross 缺 Secret 预期跳过）

---

## 🚀 **【主动提出】V11.x 路线图 (5 Phase 规划)**

### 总体目标
从「V10.14 单机 + 飞书 Drive JSON 镜像」迈向「多端协作、弱网可用、安全合规、更新无感」的工业级协作软件。

**三条核心建议(第一性原理+市场同类对标得出,优先度 P0):**
> 1. 🔧 **后端选型升级**: 纯飞书 Drive JSON → Supabase(PostgreSQL免费版) 或 飞书多维表格(Bitable)。当前方案本质是"一个巨大JSON整包读写"，300车+500照片+50视频场景下JSON达50MB+读写冲突、无SQL查询、无法增量、无法权限控制。同类项目(PPE Guide/车间协作软件)普遍采用 PostgreSQL/Firestore。
> 2. 🔥 **APK 热更新**: 整包 80MB 下载→安装→重启→更新。替换为 Cordova Code Push / Capacitor 官方 Updater，JS/CSS/HTML 增量热更新（差量通常<500KB），无需重装、不中断现场工作。同类项目普遍采用(阿里/腾讯/微信小程序的热更新模型)。
> 3. 🛡 **Android/iOS 原生代码加固**: 目前飞书appSecret以明文存在于APK首屏<script>标签中,反编译可直接提取。同类商业软件均使用:Android 端字符串加密 + 爱加密/360加固保/网易易盾；iOS 端 bitcode + 字符串混淆 + ITSAppUsesNonExemptEncryption。考虑到飞书开放平台秘钥泄漏即意味着额度/数据被盗用，这一条是与「上规模推广到百人+」强相关的红线项。

---

### Phase 1 (V11.0)：后端选型升级（3 方案对比 + 迁移路径）
**目标**：从纯飞书 Drive JSON「整文件覆盖写」→ 真正的「结构化 CRUD」。

| 方案 | 说明 | 优点 | 缺点 | 预计成本(人周) |
|---|---|---|---|---|
| ① Supabase PostgreSQL 免费版 | PostgreSQL+RLS行级权限+Storage对象存储+Realtime 订阅+Auth | 真SQL+JOIN/行级权限每车/照片Storage独立(不再base64 JSON)/Realtime下一秒推送/免费版500MB数据库+1GB Storage足够当前 73车/150张照片 | 需要新账号/从飞书迁移数据/APP端同步逻辑重写为REST/Supabase-js SDK；组员端仍然零配置但需要 Supabase anon key(构建期注入) | 3 PW + 0.5 人月 |
| ② 飞书多维表格 (Bitable) | 仍飞书生态内；支持字段型/每车一行/照片附件字段；提供 SQL 风格查询 API(Query DB) | 不用新开云账号、仍在企业飞书；多维表格「天然结构化」比 JSON 好 100 倍+支持品牌/车系/分区多维筛选；自带审批/协作视图 | 飞书Bitable单表 5 万行上限(绰绰有余)；字段数量上限约 200；API 稳定性 vs Drive JSON 相当；视频 > 500MB 仍要 Drive 对象存储目录配合(当前已有 6 个子目录对象上传管线，可复用) | 2 PW |
| ③ Firebase Firestore | Google 官方NoSQL文档型+Realtime+Rules | 文档结构天然适合当前车型JSON；Realtime监听秒级更新；1GB/月免费额度 | 需要 Google 账号/国内网络访问 需 配置 香港节点/VPN；国内现场 车间 WiFi 大概率被墙 → 不可用 ❌ | 不推荐 |

**最终推荐 V11.0 Phase1 方案**:
> **方案②(飞书Bitable) 优先接入 + 方案①(Supabase) 做并行 POC**, 原因:
> - 现场公司已深度用飞书(飞书Drive当前在用,员工飞书APP已下载,注册流程不需要新账号),迁移成本最低。
> - Bitable 免费额度(单表5万行/每表500个附件)完全覆盖当前(73行)且未来到 300车仍充足。
> - 仍然保留 Drive JSON 作为视频/大文件对象存储(复用现有 10.14 修复B/媒体分离上传管线)。
> - Supabase 并行 POC: 若未来跨企业推广(多公司不同飞书租户隔离),Supabase 多租户 SQL 隔离 比 Bitable 单租户好。
**交付物**: Bitable迁移脚本(Vehicle/Users双表建表+附件字段+当前73车导入导入工具+V10.14旧JSON双写兜底30天迁移窗口) + 同步逻辑 Bitable SDK 接入 + RLS 管理员/组员行级权限控制。

### Phase 2 (V11.1): 车辆标签 + Excel/CSV 批量导入 + 品牌自定义管理
**痛点**: 当前车辆只能按预置品牌(丰田/日产/比亚迪/红旗/其他)硬编码分类;自定义只能进「其他」;组长从运维拿到 Excel 车辆清单需要手工录入 73 台车,耗时 3+小时。
**交付物**: 
- 标签系统:车型自定义标签(燃油/纯电/混动/新入库/待断电/已断电/负责人A/负责人B/...) + 筛选 UI 按标签过滤
- Excel/CSV 批量导入向导(列映射配置 + 导入前预览 diff + 增量合并 vs 全量覆盖模式 + 冲突标记黄色高亮)
- 品牌/系列管理后台(管理员可自定义品牌字典,不再硬编码JS常量)

### Phase 3 (V11.2): 离线增量同步 - CRDT 算法
**痛点**: 当前组长端全量覆盖写 JSON;组员端全量镜像。断网多天后(比如港口现场断网 3 天)三方合并容易数据覆盖冲突,组长改=赢,组员修改被静默覆盖(现行业务形态为组长绝对权威, OK; 但未来扩展多人协作会撞)。
**交付物**:
- CRDT(冲突可复制数据类型) 算法 选 Yjs(通用成熟,已集成 Quill/Notion/Tldraw) 或 Automerge
- 每条车辆记录独立 version vector(版本向量)，同步时拉 diff 而非全量 JSON,节省带宽 99%
- 三方合并 UI(冲突检测到后,人工选择保留A端/B端/合并,而非静默覆盖)

### Phase 4 (V11.3): 审计日志 & 操作追踪
**痛点**: 当前车辆增删改无操作人/时间戳/前后对比快照;组长误删车(73车→69)不知道谁删的,无回溯依据。同类已交付项目都具备"谁在何时对哪台车做了什么"。
**交付物**:
- 本地 `audit_log.json` (操作人,动作 C/U/D, 车辆ID,变更前快照,变更后快照,时间戳,客户端UUID)
- 同步日志上传云端 (Bitable「操作审计」表 + Drive JSON 月归档)
- 删除操作默认附加钉钉群/企业微信群 机器人 webhook 通知:「×××(用户名) 删除了车型 ×××(车牌号 品牌 配置)」
- 管理员审计查询页(按时间范围/人/车型ID/动作类型筛选)

### Phase 5 (V11.4): APK OTA 热更新(取代整包下载)
**痛点**: V10.14 OTA 机制是 version.json 比对→整包下载 80MB→系统弹出安装→手动确认→覆盖安装。现场车间网络差,下载耗时 3-10min;组员经常因为没流量不更新→版本漂移导致修复C横幅琥珀色频繁提示"请更新官方签名包"。
**交付物**:
- 接入 cordova-plugin-code-push (微软 App Center 免费版:5G/月流量上限,每天 100 台设备更新 绰绰有余) OR Capacitor 官方 Capacitor Updater(Ionic 免费版)
- 差量补丁生成(与上次版本做 bsdiff 二进制 diff,通常 < 500KB)
- 更新流程:启动 APP → 静默后台 diff 下载 → 下一次冷启动时自动 apply patch → 应用重启后生效 (不打断现场,不需要人工下载)
- 同步修复C绿色横幅 增加一行小字 "后台已自动更新补丁 v11.4.x，下次重启生效"

---

## 三项核心建议(从「第一性原理+信息差扫描+替代路径审查」得出)

> 这三项是 V11.0 必须纳入的 P0 级改进项,若不纳入则现场规模从「20人小组」推广到「百人+车间」会撞墙式失败。

### 建议 1 (V11.0 Phase1 P0): 后端选型从纯飞书 JSON 升级到 飞书Bitable + 对象存储
**为什么**:
- 纯飞书 JSON 的 3 个根本天花板:
  1. **单次写入原子粒度**: 整文件覆盖,每次同步相当于 重写整个数据库,并发=丢数据
  2. **查询能力为 0**: 无法按品牌/负责人/断电状态/标签 SQL 查询——只能前端全量拉下来再 filter
  3. **JSON 体积膨胀**: 300 台车 500 张照片(即使媒体分离到 Drive,车辆本身仍然有 70+字段),单文件轻松 10MB,每次同步都要下载 10MB,4G 网络下很容易超时
- 市场同类对标:
  - 比亚迪内部车辆调度系统(参考公开的 BYD Smart Factory): 用 PostgreSQL + 对象存储
  - 一汽大众车间协作 App (案例公开): 用 Airtable 迁移到飞书Bitable(同构)
  - 港口 TOS (码头作业系统): 用 TimescaleDB+PostgreSQL,不会用 JSON 文件
**潜在陷阱**(反方审查): 
> 「迁移到 Bitable 会让现有修复A/B/C白做吗?」—— 不会。修复A/B/C的三个问题是「注入秘钥不丢/删除不丢/组员不填配置」,这些仍然是 Bitable 端的基础前提。迁移只是后端存储形态变化,前端交互层(横幅/只读/灰化)全保留,不需要重写。迁移时保留 JSON 双写兜底 30 天,30 天后再切纯 Bitable。

### 建议 2 (V11.4 Phase5 P0): APK 热更新替代整包下载
**为什么**:
- 真实现场场景:太仓港现场 80% 的员工用 Android 个人手机,每月流量 2-5G 套餐,下载 80MB APK 约 10 元流量成本,大家不愿意下(已确认的现场反馈)。
- V10.14/V10.13/V10.12 每次发布本质都是 JS/CSS/HTML 资源的小改动(通常 < 2MB 未压缩),根本不需要下载 Cordova WebView 壳(60MB)。
- 市场同类对标: 企业协作类 App (钉钉/飞书/企业微信) 都是「热更新为主、仅半年一次整包大版本升级」；工业 App 如美的 M-Smart、海尔 COSMOPlat 均采用 CodePush 类方案；Capacitor 生态现在有官方 Updater(2025 年新出,之前 V10.x 没出)。
**潜在陷阱**(反方审查):
> 「热更新会让代码审计变难,不知道现场跑的哪个补丁」—— 每台设备加 `device_patch_version` 字段上报到 Bitable「设备状态表」,管理员后台可随时查每台手机 APP_VERSION + patch_version；并且每次热更新的 SHA-256 与 GitHub Release 对应(可审计)。

### 建议 3 (V11.3 Phase4 P0 并行): Android/iOS 原生代码加固 — 防反编译提取飞书 appSecret
**为什么**:
- 当前飞书 appSecret (cli_aa0ce4fd...) + 构建注入 最终存在于 APK 首屏 demo.html <script> 文本中。
- 反编译 APK 步骤(Android 上已成熟工具链): `apktool d tcg_poweroff_v10.14.0.apk` → `assets/www/demo.html` → 搜索 `FEISHU_APP_SECRET` → 直接拿到明文字符串。
- 拿到 appSecret = 调用 飞书 tenant_access_token = 读写整个 folderToken=公开目录下的所有同步JSON、审批、照片、视频 = **现场所有车型和断电信息被非授权人员下载/篡改/删除**。
- 市场同类对标:
  - 所有金融/支付/企业协作类 App 默认都做 360加固保/爱加密/网易易盾 三层加固(Dex加密+字符串加密+反调试)
  - Google Play 官方要求: 应用签名 + Play App Signing + R8/ProGuard 代码混淆(免费,Android Studio自带),至少 ProGuard 混淆 + appSecret 字符串加密
**缓解措施(加固前的临时过渡,V10.14已提供)**:
> a)飞书开放平台侧 设置 API 调用 IP 白名单(只允许车间 3 个出口公网IP);b)设置额度告警阈值(每日 tenant_access_token 调用>1000次 企业微信机器人报警);c)管理员端 appSecret 每月轮换一次(备份脚本+CI 流水线 自动注入新版秘钥)。但这些只是过渡,根治方案=加固 + 秘钥下沉服务端(建议1的后端升级)。

---

## 时间与里程碑(建议排期)
| 里程碑 | 预计时间 | 交付物 | 准入标准 |
|---|---|---|---|
| V11.0 M1 后端选型 POC 完成 | 2026-09-20 | Bitable方案② 73车导入成功 + Supabase方案① 73车导入成功 + 2方案性能对比报告 | 73车查询响应 < 300ms / 写入 < 1s / 并发3人写入不丢数据 |
| V11.0 M2 Bitable上线 + JSON双写兜底窗口 | 2026-10-08 | APP端同步逻辑切换 + 管理员后台切换 | 30天双写期两端数据100%一致率>99.99% |
| V11.1 M1 标签+Excel批量导入 | 2026-10-22 | 标签系统/导入向导/品牌管理页 | 100 台 Excel 车清单批量导入 < 60秒 / 冲突标记 > 90% 准确 |
| V11.2 M1 CRDT 三方合并 POC | 2026-11-05 | 断网3天→3端同时编辑→合并成功率 > 95% / 冲突人工介入<5% | 三方合并 100 次 随机编辑 成功率模拟测试全绿 |
| V11.3 M1 操作审计日志 | 2026-11-26 | audit_log + 操作审计查询页 + 删除机器人通知 | 所有 C/U/D 动作 100% 留痕 |
| V11.4 M1 CodePush 热更新 | 2026-12-17 | 差量补丁生成流水线 + 现场静默 apply + 版本上报表 | 差量补丁大小 < 1MB 成功率 > 99% |
| V11.4 M2 Android/iOS 加固 | 2026-12-24 | ProGuard/R8 + 360加固保 + appSecret 字符串加密 + 反调试 | 逆向成功率 < 1% (由第三方测试团队验证) |
| V11.0 GA 正式发布 | 2027-01-07 | 所有 Phase1-5 交付 + 全量文档 + 全量回归测试(目标>1200断言/0失败) | 三项建议全部关闭 / 现场 30 台 Android 1个月灰度 0 工单 |
- [ ] 崩溃与行为可观测性（错误上报飞书多维表格）
- [ ] 视频离线包与预加载策略
- [ ] 深色模式与适老化
