# 21 媒体资源 × COS 播放源：对照审查差距清单

> 审查基准：[20-媒体资源与COS播放源交接.md](20-媒体资源与COS播放源交接.md)（小程序原生项目手册，跨端参考）
> 被审对象：本仓库 `361087210/taicanggang-poweroff-guide`，基线 `bdb0771`（V10.27.8 之后）
> 审查方式：只读代码走查（未改代码、未跑真机）。所有判定均给出 `文件:行号`，可逐条复核。
> 结论口径：✅ 等价实现 / 🟡 部分实现（形似神不同）/ ❌ 缺失（可落地）/ ➖ 架构性不适用（说明等价物）

---

## 0. 结论摘要

| 维度 | 文档要求 | 本仓库现状 | 判定 |
|---|---|---|---|
| 路径契约（三段式/命名/候选回退） | 单一真源 + 绝不跨名猜测 | `js/00-media-paths.js` 全量实现，另有归属门禁 | ✅ |
| 播放候选链 | 4 层降级 + 诚实失败 | 6 段候选链 + 30 分钟源健康记忆，强于文档 | ✅ |
| 诚实空态（禁灰图） | 缺图必须写明缺失 | 照片/缩略图/视频三处均替换为缺失态 | ✅ |
| **删除可恢复** | 软删除 + `deleted_reason` + 回收站 | 云端文件与车型均为**硬删、不可恢复** | ❌ P0 |
| **资源库为真源** | 详情页渲染时合并，不写回 payload | **方向相反**：资源库上传直接写回 `photoPaths` 并全量同步 | ❌ P0 |
| COS 作为主播放源 | 公有读桶 + 直链分流 + 国内优先 | 无任何 COS 代码，`MEDIA_CDN_BASE` 为空 | ❌ P1 |
| 上传治理 | 内容哈希判重 / 覆盖确认 / 失败回滚 / 大文件分层 | 资源库上传哈希含时间戳，无回滚，无覆盖确认 | ❌ P1 |
| 播放可观测性 | stage 显式 + 来源标签 + 按 id 续播 | 三者均无 | ❌ P2 |
| 签名 URL / RLS / 双形态 url | 服务端签名 + 行级权限 | 无数据库、无签名服务 | ➖ 架构性 |

一句话：**路径与播放"形"已经很好，媒体生命周期（删、恢复、单一真源）是最大空缺，COS 主源尚未接入。**

---

## 1. 三条不可动摇原则（20.1）

| # | 原则 | 判定 | 证据与说明 |
|---|---|---|---|
| 1 | 照片视频是补充，媒体全挂主流程照常 | ✅ | 缺图走 `showPhotoMissing` 换整格、`showThumbMissing` 换缩略图（[06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L8-L45)）；视频全失败才 `showVideoMissing`（[06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L647-L655)）；媒体加载不参与车型渲染主链 |
| 2 | 删除必须可恢复（软删 + `deleted_reason`） | ❌ | 资源库删除直接 `driveDeleteFile` 并解除引用，弹窗明写"不可恢复"（[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L545-L587)）；车型删除为 `splice` 硬删（[01-state.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/01-state.js#L287-L291)）。全仓库无回收站、无 `deleted_reason` |
| 3 | 命名即归属，绝不跨名猜 | ✅ | 三段式 + 候选只允许"同名不同目录"（[00-media-paths.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-media-paths.js#L106-L139)）；`scripts/check_media_ownership.js` 在 CI 强制目录必须匹配车型或 `_共享` |

---

## 2. 数据模型（20.2）

### 2.1 `poweroff_media` 表 / RLS / 索引

判定：**➖ 架构性不适用**。本仓库没有数据库与行级权限，等价物是三件套：

| 文档概念 | 本仓库等价物 | 证据 |
|---|---|---|
| `poweroff_media` 一行一个文件 | `media_library.json` 台账行（`assets`/`orphans`） | [gen_media_library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/scripts/gen_media_library.js#L252-L283) |
| 文件实体 | 飞书 Drive `vehicle_images/` `vehicle_videos/` | [05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L1174-L1304) |
| `deleted` / `deleted_reason` | **无对应字段** | 见 1-2 判定 |
| `vehicle_id` + `vehicle_display` 归属 | 台账 `vehicles: [{id, display}]`，由引用实时反算 | [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L124-L155) |
| `source` / `state` / `tags` / `remark` | 部分：`status`（ok/shared/missing/new/remote）与 `cloudState` | [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L78-L113) |
| RLS（写操作限组长） | 前端 `canEdit()` 守卫，无服务端强制 | [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L274-L276) |

风险：台账是**发版快照**（`generatedAt`），不是运行时真源；删除/上传只改内存与车型 payload，台账要等下次重建，必然滞后（代码注释已承认，见 [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L264-L265)）。

### 2.2 `poweroff_vehicles` 覆盖层（payload / 墓碑 / rev）

| 条目 | 判定 | 证据 |
|---|---|---|
| payload 整体存储、字段免改表 | 🟡 形似：`vehicles_data.js` + `vehicle_sync_data.json` 全量 JSON | [05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L2010) 云端整体覆盖本地 |
| 车型墓碑 `deleted=true` | ❌ 无 | 删除即 `splice`，多端靠"全量镜像少一条"隐式传播 |
| 乐观锁 `rev` | ❌ 无 | 全量覆盖，无冲突检测 |

> 这一节与 20.5 通路 2/3 是同一个洞：**没有墓碑就没有恢复，也没有"删了不会复活"的保证。**

---

## 3. 路径契约（20.3）

| 规则 | 判定 | 证据 |
|---|---|---|
| 顶层 `vehicle_images` / `vehicle_videos` 不可变 | ✅ | [00-media-paths.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-media-paths.js#L46-L47) |
| `_共享` / `_未归类` 保留目录 | ✅ | 同上 L48-L51，`RESERVED_FOLDERS` 参与重名守卫 |
| 车型目录由显示名清洗，退化 display→series→brand→`vehicle_<id>` | ✅ | [00-media-paths.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-media-paths.js#L88-L95) |
| 清洗顺序（控制字符→保留字→emoji→折叠→去首尾→截断） | ✅ | [00-media-paths.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-media-paths.js#L64-L85)，与 bootstrap 文件名清洗同规则 |
| 目录 ≤40 / 文件名 ≤150 | ✅ | `MAX_FOLDER_LEN=40`（L52）、`sanitizeName` 默认 150（L65） |
| 候选回退只允许同名不同目录 | ✅ | [06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L100-L150) `mediaCandidateSrcs` + `loadPhotoWithFallback`；注释明确"绝不跨名猜测" |
| 幂等键 = 车型目录 + 文件名 | ✅ | [05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L1198-L1203) `_cloudKey(scope,name)`，并修掉了"裸文件名跨目录误判" |
| 两层转义（`sanitizeName` + ASCII `safeSegment`） | ➖ | 飞书 Drive 接受中文名，无对象键 ASCII 限制；`_safeBase` 只做路径字符清洗（[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L408-L410)） |

**差异（非缺陷）**：文件名实际为 `<display>_p<N>_<hash>.jpeg`（[05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L1272-L1277)），不是文档的 `<车型显示名>_p<N>_<hash>` 之外的额外规则，语义一致。

---

## 4. url 双形态与签名（20.4）

判定：**➖ 架构性不适用**，但缺一层"显式分流"的防呆。

- 本仓库没有对象存储签名服务：照片用相对路径 + 候选源，视频用 `MEDIA_CDN_BASE`/Release 绝对 URL；因此不存在"直链被当对象键签名"的故障面。
- 代价是：一旦接入 COS（20.8），**必须新增** `isDirectUrl` / `isCosUrl` 分流，否则会把历史 GitHub 直链也塞进 COS 签名/拼接逻辑。
- 签名 TTL（照片 600s / 视频 3600s）与"按返回 path 回填"：➖ 不适用，无签名缓存层。

---

## 5. 车型 ↔ 资源库 5 条同步通路（20.5）——最大差距区

| # | 通路 | 判定 | 现状与证据 |
|---|---|---|---|
| 1 | 车型改名 → 资源库显示名跟随 | 🟡 | 只有**仓库侧手动脚本** `scripts/migrate_vehicle_rename.js`（默认 dry-run，[L22-L27](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/scripts/migrate_vehicle_rename.js#L22-L27)）；App 内改名后 `photoPaths` 仍指旧目录，只能等资源库标"改名失配"（[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L624-L641)）。**没有 `syncVehicleDisplay` 的即时写回。** |
| 2 | 车型删除 → 素材级联隐藏（软删） | ❌ | `confirmDeleteVehicle` → `State.removeVehicle` 直接 `splice`（[03-vehicles.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/03-vehicles.js#L937-L952)），媒体文件保留但不打软删标记；资源库下次重建索引时按"无引用"直接消失，**没有可查的删除原因，也没有隐藏状态** |
| 3 | 车型恢复 → 素材回滚 | ❌ | 无恢复入口、无 `deleted_reason='vehicle_cascade'` 可筛 |
| 4 | 资源库增删 → 详情页渲染时合并 | ❌ **方向相反** | 资源库上传是**直接写车型 payload**：`v[key].push(rel)` → `State.updateVehicle` → `_scheduleVehicleSync()` 全量上传（[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L505-L513)、[L297-L309](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L297-L309)）；台账反过来由车型引用生成（`liveAssetsOf`，L124-L155）。**正是文档 20.5「为什么通路 4 不写回 payload」点名要避免的双真源。** |
| 5 | 一致性巡检 | 🟡 | 有生成期巡检：`gen_media_library.js` 输出 `missing/orphans/uownedFolders/renamedRefs/vehiclesWithoutMedia`；有归属门禁 `check_media_ownership.js`；有资源库断链视图。但**没有 `reconcile(autoFix=true)` 的回写修复**，改名迁移仍需人工 `--apply` |

**双真源的具体后果**（可复现推理，不必真机）：
1. 组长在资源库删掉一张图 → `deleteCloud` 只删云端文件并 `unlinkPathOf` 解引用；若此时某设备本地 `vehicle_sync_data.json` 仍是旧快照，下一次全量覆盖会把 `photoPaths` 写回来 → **"删了又回来"**（云端文件已无，变成永久 missing）。
2. 两台设备同时给同一车型上传 → 后同步者 `v[key]` 基于旧数组 push，整体覆盖先同步者 → **丢引用**（无 rev 乐观锁）。

---

## 6. 上传链路（20.6）

| 步骤/要求 | 判定 | 证据与差距 |
|---|---|---|
| 登录校验 / 仅组长 | 🟡 | 前端 `canEdit()`，[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L418-L419)；无服务端强制 |
| 视频压缩（>8MB 三级降档，统一 mp4） | ❌ | 视频原样上传，仅 100MB 上限（[03-vehicles.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/03-vehicles.js#L818-L831)）；无转码/降档 |
| 定路径（三段式） | ✅ | [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L488-L507) |
| 判重（内容哈希 + 同名不同内容可确认覆盖） | ❌ | 资源库上传文件名哈希 = `hash(文件名:大小:当前时间)`（[L500-L502](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L500-L502)）→ **每次上传必然新名字，永远判不重**；无"内容一致/可确认覆盖"分支。对比：同步管线照片用 djb2 内容哈希 + 云端同名跳过（[05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L1268-L1287)），**两条上传通道口径不一致** |
| 失败回滚（写库失败删已传文件） | ❌ | 上传成功 → `State.updateVehicle` 若失败仅落 catch 计数，云端文件变孤儿（[L503-L533](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L503-L533)） |
| 大文件分层（≤8MB 直传 / >8MB 分片） | ✅ | `httpUploadFileSmart` 小文件 `upload_all`、超限自动分片 |
| Content-Type 自推 | ➖ | 飞书 Drive 存储无 multipart part 类型问题；播放按扩展名 |
| 413 硬墙特判 | 🟡 | 依赖分片规避，未做 413 特判与"立即压缩"上抛 |
| 上传进度 | ❌ | 只有一条 toast "正在上传 N 个文件"（[L482](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L482)）；无逐文件进度、无失败重试入口 |
| 照片压缩 | ✅ | `compressImage(file,2400,0.92)`（[03-vehicles.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/03-vehicles.js#L737-L768)）；同步管线再归一化到 2560px（[05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js#L1268)） |

---

## 7. 播放链路（20.7）

| 要求 | 判定 | 证据与差距 |
|---|---|---|
| 候选链按序推进、穷尽才失败 | ✅ **强于文档** | 6 段：CDN 主 → Release 备 → 飞书 → 官方别名 → jsDelivr → 诚实失败（[06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L575-L655)） |
| 源健康记忆 | ✅ | `MEDIA_SOURCE_HEALTH` 30 分钟 TTL，失败降权、成功即恢复（[00-bootstrap.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-bootstrap.js#L1637-L1661)） |
| 8 秒超时保护（ROM 不触发 onerror） | ✅ | [06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L681-L684) |
| `stage` 显式（direct/download/local/noobject/failed） | ❌ | 只有 loading 指示器与最终失败态，无阶段枚举，用户分不清"在换源"还是"没文件" |
| 三态可达性探测（unknown/ok/blocked，24h） | 🟡 | 有"失败即记 bad、成功即恢复"的 30 分钟记忆，但**不是 HEAD 探测**，也没有按域名判定"确定性失败"与"弱网抖动"（文档特意强调电梯场景不能永久拉黑） |
| 播放进度按资源 id 记 | ❌ | 未发现按 id 的进度持久化/续播；`currentTime` 只在播放器内做瞬时判断（[06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L430)） |
| 来源标签（COS/镜像直链/云端/备用源/未入库） | ❌ | 候选对象带 `label`（[L569](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js#L569)），但**未渲染到任何界面**，排障只能看 console |
| 国内源在前、境外兜底 | 🟡 | 顺序由 `mediaDirectUrls` 实现（[00-bootstrap.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-bootstrap.js#L1663-L1676)），但主源默认未配置（见 8），实际仍以境外/GitHub + 飞书为主 |

---

## 8. COS 接入（20.8）

判定：**❌ 全部缺失（仅有空占位）**。

| 步骤 | 状态 | 证据 |
|---|---|---|
| 1 建桶（公有读私有写/上海/标准） | ❌ 无代码/无配置 | 全仓库检索 `myqcloud`、`COS_`、`cos.ap-` **0 命中** |
| 2 权限探活 | ❌ | 无 `verify-cos-upload.js` 或等价探活脚本（`scripts/` 下无 COS 相关文件） |
| 3 目录与命名 | ✅ 前置已具备 | 三段式与 `media-library/baseline/` 语义可直接映射 |
| 4 上传（关压缩/关数据万象/关原图保护） | ❌ | 无 COS 上传工具链 |
| 5 保真校验（Content-Length/ETag） | ❌ | 无脚本 |
| 6 写回 url（幂等 UPDATE） | ❌ | 无 url 字段、无 DB |
| 7 代码常量（`COS_IMAGE_BASE` + 高清候选顺序） | 🟡 **有挂钩点** | `TCG_CONFIG.MEDIA_CDN_BASE`（[00-config.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-config.js#L60-L69)）默认 `''`；仅 https 生效（[00-bootstrap.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-bootstrap.js#L1616-L1635)）→ 主源未启用时退化为"仅 GitHub"，与旧版等价 |
| 8 Cordova 域名白名单 | ❌ | [config.xml](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/config.xml#L10-L18) 只放行飞书/GitHub/jsDelivr，无 `*.cos.*.myqcloud.com`；接入前必须补，否则 Cordova 原生链路会被拦 |

补充：`MEDIA_CDN_BASE` 是"可配置的国内主源"，架构上已经预留了正确的插入点，属于**低成本可落地项**（配置 + 白名单 + 直链分流）。

---

## 9. 验收（20.9）

| 类别 | 判定 | 说明 |
|---|---|---|
| 功能验收（真机 8 条） | 🟡 | 本仓库有等价验收：`test_v1025_media_paths`、`test_v10251_media_fallback`、`test_v10257_media_library`、`test_v10265_vehicle_media_binding`、`test_v10266_media_independence`、`test_v10273_media_link`；**缺** COS 首帧/续播/来源标签三条 |
| 工程验收 | 🟡 | 本项目门禁为 `Web资产与安全校验` + `scan` + `run_all_tests`，不是小程序的 39 用例；口径不同 |
| 数据验收（SQL 四列） | 🟡 | 等价口径已在 `media_library.json.stats`（见 11），但无"未删除且有 url"这一维度（无 url 字段） |

---

## 10. 红线 14 条逐条裁定（20.10）

| # | 红线 | 判定 | 说明 |
|---|---|---|---|
| 1 | url 必须区分直链与对象键 | ➖ | 无签名服务 |
| 2 | 回收站清理必须跳过直链 | ➖ | 无回收站 |
| 3 | 预览必须按 id 直查 | ➖ | 无分页全表扫描场景 |
| 4 | 视频签名 ≥1 小时 | ➖ | 无签名 |
| 5 | 播放进度按 id 记 | ❌ | 无续播 |
| 6 | 写库自推 Content-Type | ➖ | 飞书 Drive 无该问题 |
| 7 | 高清源国内在前 | 🟡 | 顺序可配，但主源未启用 |
| 8 | `safeOwnerSegment` 不加哈希 | ➖ | 无 RLS |
| 9 | 媒体读写全程 try/catch | ✅ | 上传、播放、同步、索引均有 try/catch 与降级 |
| 10 | 软删除必须写 `deleted_reason` | ❌ | 无软删除 |
| 11 | 禁止跨车型转移素材 | ✅ | 无转移功能；删除仅解引用 |
| 12 | 判重键不含裸文件名 | ✅ | `_cloudKey(scope,name)` |
| 13 | 缺失照片禁用灰图 | ✅ | 三处诚实空态 |
| 14 | 车型删除必须 upsert 墓碑 | ❌ | 无墓碑，硬删 |

**统计：✅ 4 条满足 / 🟡 1 条部分 / ❌ 4 条违反 / ➖ 5 条不适用。**

---

## 11. 现状数字对照（20.11）

本仓库 `media_library.json`（`generatedAt` 见文件头）：

| 指标 | 数值 |
|---|---|
| 台账总数 | 315（照片 266 + 视频 49） |
| 正常 / 共享 / 远程 / 缺失 | 172 / 14 / 49 / 64 |
| 孤儿文件（有文件无引用） | 16 |
| 缺失涉及车型 | 64 台 |
| 车型总数 / 无素材车型 | 100 / 4 |
| 无主目录 / 改名失配 | 0 / 0 |
| 低清素材（照片宽 < 阈值） | 170 |
| 已记录指纹 | 232 / 315 |

与手册 20.11 的 266 照片 / 65 视频不是同一套数据（两个项目各自维护），只作口径对照。**共同点：照片缺失是主要问题（本仓库 64 条，手册 63 条），且"低清"占比高（170/315）。**

---

## 12. 待办映射（20.12）

| 手册待办 | 本仓库对应动作 | 状态 |
|---|---|---|
| 上传照片到 COS | 配置 `MEDIA_CDN_BASE` + 上传 `vehicle_images/` + 白名单 | ❌ 未开始 |
| 上传视频到 COS | 同上，`media-library/baseline/` | ❌ 未开始 |
| 补拍缺失照片 | 已有「复制缺失清单」导出（[13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L252-L261)、[L1216](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js#L1216)） | ✅ 工具就绪，素材待补 |
| 补原片 / faststart | 无转码管线 | ❌ |
| Referer 白名单 / CDN 鉴权 | 无 | ❌（接入 COS 后再做） |
| 正式 appid / 发布 | 本项目为 Cordova，另有 CI 发版链路 | ➖ |

---

## 13. 风险排序与建议改造批次

### P0（破坏"可恢复 / 单一真源"，必须先决策）

1. **删除不可恢复**：资源库 `deleteCloud` 硬删 + 车型 `splice` 硬删。建议：先落"软删标记 + 回收站视图"（本仓库可用 `media_library.json` 之外的运行时删除清单 + 云端移到 `_回收站/` 目录代替物理删），再谈 COS。
2. **资源库写回 payload（双真源）**：`onUploadFiles` 直接改 `photoPaths` 并全量同步。建议改为"资源库登记 → 详情页渲染时合并"，至少先停止 `_scheduleVehicleSync` 的全量覆盖，改为增量写单条。

### P1（性能与数据质量）

3. **COS 主源未接**：`MEDIA_CDN_BASE` 为空 → 首帧仍慢。建议：配置常量 + `config.xml` 白名单 + `isDirectUrl/isCosUrl` 分流 + 国内源优先。
4. **上传判重失效**：资源库上传哈希含 `Date.now()`，每次新文件名；无非内容判重、无覆盖确认、无失败回滚（云端孤儿）。建议统一到 05-sync 的内容哈希口径，并补"同名不同内容 → 确认覆盖"。

### P2（可观测性与体验）

5. 播放 `stage` 显式 + 来源标签（`cand.label` 已有，只差渲染）。
6. 播放进度按 id 续播。
7. 车型改名后的即时联动（当前仅离线脚本 + "改名失配"视图）。

---

## 14. 取证索引

| 主题 | 文件 |
|---|---|
| 路径单一真源 | [00-media-paths.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-media-paths.js) |
| 归属门禁 | [check_media_ownership.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/scripts/check_media_ownership.js) |
| 索引生成 | [gen_media_library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/scripts/gen_media_library.js) |
| 改名迁移（手动） | [migrate_vehicle_rename.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/scripts/migrate_vehicle_rename.js) |
| 资源库前端 | [13-media-library.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/13-media-library.js) |
| 播放链路 | [06-media.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/06-media.js) |
| 播放源与健康 | [00-bootstrap.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-bootstrap.js) |
| 主源配置 | [00-config.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/00-config.js) |
| 上传/回写 | [05-sync.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/05-sync.js) |
| 车型删除 | [03-vehicles.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/03-vehicles.js)、[01-state.js](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/js/01-state.js) |
| 网络白名单 | [config.xml](file:///home/123z/Documents/Trae-CN/temp_20261117_01/tcg_audit/config.xml#L10-L18) |

---

> 本次审查未修改任何代码。若继续推进，建议先就 P0 两项（软删除、单一真源）做取舍：它们决定后续 COS 接入是否会在错误的真源上继续叠加复杂度。
