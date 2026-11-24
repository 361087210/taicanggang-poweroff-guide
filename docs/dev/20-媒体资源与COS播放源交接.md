# 20 媒体资源库 × COS 播放源：交接与复刻手册

> 适用前提：微信小程序原生项目 + WorkBuddy Cloud（Database / Auth / Storage / LLM，**无云函数**）。
> 本文档的目标是：换一个 AI、换一个人接手，能凭本文把「车型信息 ↔ 资源库」的强关联和
> 「COS 作为照片/视频查看播放源」这两件事原样复刻出来，不需要读完全部源码。
>
> 阅读顺序：20.1 全景 → 20.3 路径契约 → 20.4 url 契约 → 20.5 同步通路 → 20.8 施工步骤。
> 如果只关心 COS，可直接跳 20.8，但请先看 20.4，那是唯一会让人踩坑的地方。

---

## 20.1 一句话架构

```
车型表（poweroff_vehicles，JSONB payload）   资源库表（poweroff_media，一行一个文件）
              │                                          │
              │ 归属：vehicle_id + vehicle_display        │ 实体：url（对象键 或 直链）
              └──────────────┬───────────────────────────┘
                             │
                    utils/media-store.js  ← 唯一的资源读写入口
                             │
        ┌────────────────────┴────────────────────┐
   对象键（media-library/…）              直链（https://…）
   → 签名 URL，1 小时/10 分钟            → 原样使用，不签名
        └────────────────────┬────────────────────┘
                             │
                  displayUrl（统一出口）
                             │
        ┌────────────────────┴────────────────────┐
   <image> 高清层 / 缩略图                <video> 候选链 → downloadFile → 诚实失败态
```

三条不可动摇的原则（出自现场安全需求，不是技术偏好）：

1. **照片视频是车型信息的补充。** 媒体全挂，车型信息和作业步骤必须照常可用。
2. **删除必须可恢复。** 只有软删除 + `deleted_reason`，没有物理删除；清理是组长手动触发的兜底。
3. **命名即归属。** 文件路径就是归属声明，绝不靠"猜"来匹配跨车型同名文件——看错照片＝拔错部件。

---

## 20.2 数据模型

### poweroff_media（资源库主表，实测结构）

| 字段 | 类型 | 默认 | 语义 |
|---|---|---|---|
| `id` | bigint | identity | 主键 |
| `owner_id` | text | `auth.uid()` | 上传者，由服务端填充，客户端不传 |
| `owner_name` | text | `''` | 上传者昵称，仅展示 |
| `vehicle_id` | integer | `0` | 归属车型 id（对应 `poweroff_vehicles.vehicle_id`） |
| `vehicle_display` | text | `''` | 归属车型显示名（车型改名时要同步，见 20.5） |
| `kind` | text | `'photo'` | `photo` / `video` |
| `file_name` | text | 无 | 文件名（含扩展名） |
| `folder` | text | `''` | 车型目录名，三段式的第二段 |
| `rel_path` | text | `''` | 完整相对路径 `vehicle_images/<folder>/<file>` |
| `section` | text | `''` | 部位分区：断电位置 / 钥匙 / 外观 / 现场照片 / 教学视频 |
| `label` | text | `''` | 部位标签，如"电池负极"、"线束夹" |
| `sha256` | text | `''` | 字节级判重；>8MB 或真机无 WebCrypto 时为 FNV 回退值或空 |
| `size` | bigint | `0` | 字节数；为 0 表示"只有登记、没有对象" |
| `mime` | text | `''` | `image/jpeg` / `video/mp4` 等 |
| `url` | text | `''` | **双形态**：对象键 或 直链，见 20.4 |
| `source` | text | `'manual'` | `manual` / `baseline` / `baseline-mirror` / `cos` |
| `state` | text | `'ok'` | `ok` / `missing`（登记了但取不到）/ `never`（压根没登记） |
| `tags` | jsonb | `'[]'` | 自由标签数组 |
| `remark` | text | `''` | 备注 |
| `deleted` | boolean | `false` | 软删除标记 |
| `deleted_reason` | text | null | `user`（手工删）/ `vehicle_cascade`（车型下线级联） |
| `created_at` / `updated_at` | timestamptz | `now()` | |

索引只有一个，但它是查询的主路径：

```sql
CREATE INDEX poweroff_media_lookup
  ON poweroff_media (vehicle_id, kind, deleted, updated_at DESC);
```

约束只有主键。`kind` 的取值靠代码保证（`media-store.kindOf`），没有 check 约束——
如果复刻时想加 `CHECK (kind IN ('photo','video'))`，可以加，但**不要加在 url 上**
（url 允许空、允许直链、允许对象键，三种都合法）。

### 行级权限（实测策略）

| 策略 | 命令 | 条件 |
|---|---|---|
| `poweroff_media_read_all` | SELECT | `true`（全员可读） |
| `poweroff_media_insert_leader` | INSERT | `owner_id = auth.uid() AND tcg_is_active_leader()` |
| `poweroff_media_update_leader` | UPDATE | `tcg_is_active_leader()`（USING 与 WITH CHECK 都是） |
| `poweroff_media_delete_leader` | DELETE | `tcg_is_active_leader()` |

`tcg_is_active_leader()` 是 SECURITY INVOKER 函数，检查
`poweroff_roles` 里 `role='leader' AND status='active'`。**组长身份由数据库判定，客户端不传。**

### poweroff_vehicles（车型覆盖层）

| 字段 | 类型 | 语义 |
|---|---|---|
| `vehicle_id` | integer | 唯一，对应本地基线 `data/vehicles.js` 的 `id` |
| `payload` | jsonb | 完整车型对象（含 steps / keyFrame / keyContainer / photoPaths / videoPaths） |
| `deleted` | boolean | 墓碑：删除车型就是 upsert 一行 `deleted=true` |
| `rev` | integer | 乐观锁版本号，默认 0 |
| `owner_id` / `owner_name` | text | 最后修改人 |

关键设计：**车型信息以 `payload` JSONB 整体存储，字段演进不需要改表**；
本地基线是 fallback，云端覆盖层按 id 合并（`vehicle-store.merge`）。

---

## 20.3 路径契约：三段式与候选回退

实现文件：`utils/media-paths.js`（纯字符串函数，无 fs/DOM 依赖）。

### 布局

```
vehicle_images/<车型目录>/<文件名>     照片
vehicle_videos/<车型目录>/<文件名>     视频
```

两个保留目录：

- `_共享` —— 多车共用资产（如通用的钥匙特写图）
- `_未归类` —— 迁移期的孤儿资产

### 硬规则

| 规则 | 理由 |
|---|---|
| 顶层目录 `vehicle_images` / `vehicle_videos` 不可变 | 跨版本、跨端一致性 |
| 车型目录由**显示名**清洗而来（`folderNameForVehicle`），退化顺序：display → series → brand → `vehicle_<id>` | 人与文件系统都认得出 |
| 文件名约定 `<车型显示名>_p<N>_<hash>.jpeg` / `_v<N>_<hash>.mp4` | 可读 + 防撞 |
| **幂等键 = 车型目录 + 文件名**，不是裸文件名 | 修的是"两个车型有同名照片 → 互相污染"的历史缺陷 |
| 候选回退**只允许同名不同目录**：三段式 → 两段式 → 裸文件名 | **绝不跨名猜测**。看错照片＝拔错部件，安全事故级 |
| 目录名最长 40 字符，文件名最长 150 字符 | 超长在部分机型上会截断 |

名称清洗顺序（`sanitizeName`）：去控制字符 → 路径保留字 `\/:*?"<>|` 换 `_` → 去 emoji →
空白折叠为 `_` → 多下划线折叠 → 去首尾 `._` → 截断（保留扩展名）。

### 客户端之外的第二层转义

对象存储键还需要 ASCII 安全（见 20.6 的 `safeSegment`）。
**这是两层不同的转义，不要合并**：`sanitizeName` 保证人可读，`safeSegment` 保证服务端接受。

---

## 20.4 url 字段的双形态契约（最容易踩的坑）

`poweroff_media.url` 有两种合法取值，**必须分流处理**：

| 取值形态 | 例子 | 处理方式 |
|---|---|---|
| `http://` / `https://` 开头 | `https://<bucket>.cos.ap-shanghai.myqcloud.com/media-library/baseline/x.mp4` | **原样播放，不签名** |
| 其它 | `media-library/<folder>/x.mp4`（对象键） | 换成短时签名 URL |

实现（`utils/media-store.js`）：

```js
const DIRECT_URL = /^https?:\/\//i
function isDirectUrl(v) { return DIRECT_URL.test(String(v || '')) }

// 同为直链，COS 与境外图床在排障时不是一回事：
const COS_URL = /^https?:\/\/[a-z0-9-]+\.cos\.[a-z0-9-]+\.myqcloud\.com\//i
function isCosUrl(v) { return COS_URL.test(String(v || '')) }

async function resolveUrls(rows, opts) {
  const withKey = (rows || []).filter(r => r.url && !isDirectUrl(r.url))
  // 只有对象键才调 service.signedUrls；直链直接透传
  ...
  return rows.map(r => {
    if (!r.url) return { ...r, displayUrl: '' }
    if (isDirectUrl(r.url)) return { ...r, displayUrl: r.url }
    return { ...r, displayUrl: map[r.url] || '' }
  })
}
```

**如果漏掉这个分流会怎样**：直链被当成对象键送去签名 → 签名接口对一个不存在的对象返回错误 →
`displayUrl` 全为空 → 资源库全部显示"未入库"、播放器全部"无法播放"。
这是本项目实际踩过的坑，改一次要重新回填全表数据。

第二处必须同步：回收站清理。直链没有本地对象可删，混进批量 `storage.remove` 会让整批失败。

```js
const paths = batch.map(r => r.url).filter(u => u && !isDirectUrl(u))   // 只删对象键
```

### 签名有效期

| 资源 | ttl | 缓存策略 |
|---|---|---|
| 照片（列表/详情） | 默认 600s | 提前 60s 视为过期 |
| 视频（预览页/详情内联） | **3600s** | 要求缓存剩余 ≥ 50% 才复用，否则按新 ttl 重签 |

`service.signedUrls` 的契约：**输入数组与输出数组等长、按输入顺序对齐**。
实现上先分离"缓存命中 / 需重签"，只签缺失项，再用返回项自带的 `path` 作 key 回填——
**不能用下标对齐**，签名接口不保证返回顺序。

---

## 20.5 车型 ↔ 资源库的 5 条同步通路

协调层：`utils/vehicle-media-link.js`。三条底线写在文件头注释里，代码严格照此实现：

1. 写失败不回滚车型信息 —— 车型始终以 `poweroff_vehicles` / 本地基线为准；
2. 读失败不阻塞页面 —— 媒体拉不到就按基线渲染，作业流程照常；
3. 不做隐式硬删 —— 车型下线只软隐藏媒体，可恢复。

| # | 通路 | 触发点 | 实现 | 失败表现 |
|---|---|---|---|---|
| 1 | 车型**改名** → 资源库显示名跟随 | `vehicle-admin.save()` 保存成功后 | `link.syncVehicleDisplay(id, display, oldDisplay)` → `UPDATE poweroff_media SET vehicle_display=? WHERE vehicle_id=?` | 只告警 `车型已保存，资源名待同步`，不阻断 |
| 2 | 车型**删除** → 素材级联隐藏 | `store.removeVehicle()` | upsert 墓碑 + `cascadeHideMedia(id)` → `deleted=true, deleted_reason='vehicle_cascade'` | 返回 `msg` 提示"资源库隐藏失败"，车型照删 |
| 3 | 车型**恢复** → 素材回滚 | `vehicle-admin.restoreVehicle()` | `link.restoreMedia(id)` → 只恢复 `deleted_reason='vehicle_cascade'` 的行 | 提示"车型已恢复，素材待恢复" |
| 4 | **资源库增删** → 详情页动态合并 | `detail.loadCloudMedia(id)` | `listByVehicle(id)` → `resolveUrls(rows,{ttl:3600})` → `applyCloudMedia()` | 静默，基线数据照常渲染 |
| 5 | **一致性巡检** | `vehicle-admin` 巡检入口 | `link.reconcile(vehicles, autoFix=true)` | 返回 orphan / renamed / unlinked 三张清单 |

### 为什么通路 4 不写回 payload

`poweroff_vehicles.payload` 存的是**车型自身信息**（步骤、钥匙、备注……），
资源库是**独立一等公民**。如果把媒体列表写进 payload，就会出现两个真源：

- 组长在资源库删了一张照片 → payload 里还在 → 详情页显示一张已删的图；
- 组长编辑车型保存 → payload 覆盖 → 资源库新上传的照片被"回滚"掉。

所以合并只在渲染时发生，`applyCloudMedia` 是纯函数式的数据合并，**不产生任何写操作**。

### 合并规则（`detail.applyCloudMedia`）

```js
// 照片：先按 key 对，再按 label 对
key   = normName(file_name)   // 去目录/扩展名/括号/空白/连字符，转小写
label = 部位标签
// 命中 → 用云端 url 覆盖 view、hq=true、清空 hdSrc（云端已是最高清）
// 未命中且基线未登记 → 追加到「现场照片」分区，标注来源为资源库
```

视频同理，但**资源库原片排在前面**（组长上传的清晰度最高），GitHub 映射版作补充：

```js
const videoList = libVideos.concat(rest)   // libVideos 来自资源库
```

### 读方向的一致性保护

`listMedia` 默认排除已删除车型的素材：

```js
const deletedVehicles = o.includeDeletedVehicle ? new Set() : vehicleStore.getDeletedIds()
if (deletedVehicles.has(Number(r.vehicle_id))) return false
```

`getDeletedIds()` 读的是本地缓存的墓碑集合，所以**即使云端级联失败，资源库也不会显示孤儿素材**。

---

## 20.6 上传链路：从 chooseMedia 到可播放

入口：`mediaStore.uploadMedia(tempFilePath, meta)`。
另有 `replaceObject(id, tempFilePath)` 用于"给已登记的资源补上实体文件"（原地替换，不新增行）。

### 六步流程

```
1. 登录校验        service.getSession()，未登录直接返回 needLogin
2. 视频压缩        >8MB → video-compress 三级降档，输出统一为 mp4
3. 定路径          folder = sanitizeName(display)   rel_path = vehicle_images/<folder>/<file>
4. 判重            findDuplicate(folder, file_name, sha)  幂等键不含裸文件名
5. 转义 + 上传     safeUserPath(uid, 'media-library/<folder>/<file>')
6. 写库            失败则 storage.remove 回滚，避免留下无主文件
```

### 为什么要自己写上传通道

官方 SDK 的 `createMiniProgramFetch` **拒绝非字符串 body**：

```
createMiniProgramFetch: 暂不支持非字符串 body（ArrayBuffer/FormData 待补）
```

所以 `cloud.storage.upload(key, ArrayBuffer)` 在真机必失败。`utils/cloud-upload.js` 直接构造等价 HTTP：

```
POST {ENDPOINT}/.cloud/storage/object/runtime/<编码后的键>
x-wb-webapp-access-key: <publishable key>
Authorization: Bearer <accessToken>
x-upsert: true
cache-control: max-age=3600
content-type: video/mp4 | image/jpeg
```

| 文件大小 | 通道 | 注意 |
|---|---|---|
| ≤ 8MB | `wx.request` ArrayBuffer 直传 | 保留 `content-type` |
| > 8MB | `wx.uploadFile` 流式，字段名先试 `''` 再试 `'file'` | **不能传 content-type**（multipart 自行设置 boundary） |

**413 是硬墙**：网关限制单次请求体，换字段名、换通道都救不了。
代码里 `parseError` 特判 413 并立即上抛，交给上层压缩——不要再重试。

### 对象键必须 ASCII 安全（血泪教训）

真实报错：

```
Invalid key: users/WX:owNM4.../media-library/比亚迪鲨鱼皮卡（SHARK）/tmp_xxx.jpg
```

CloudBase 只接受 `[0-9a-zA-Z]/!-_.,*` 与中文，**冒号、全角括号都是非法字符**。
SDK 的 `userPath` 只做宽松校验，原样转发后被服务端拒绝。两层转义：

```js
// ① owner 段：必须与 RLS 策略里的表达式逐字一致，否则 storage 的 RLS 拒绝
//    策略：foldername(name)[2] = regexp_replace(auth.uid(), '[^A-Za-z0-9._-]', '_', 'g')
function safeOwnerSegment(uid) {
  return String(uid).replace(/[^A-Za-z0-9._-]/g, '_') || 'anonymous'
}

// ② 其余段：转 ASCII + 短哈希防碰撞（中文名转义后可能撞车）
function safeSegment(v) {
  const ascii = String(v).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80)
  return ascii === String(v) ? ascii : ascii + '_' + shortHash(String(v))
}
```

**owner 段绝不能加哈希**——加了就与 RLS 表达式不匹配，报：

```
PG RLS error: new row violates row-level security policy for table "objects"
```

### Content-Type 决定能不能播

> 8MB 走 `wx.uploadFile` 时，微信会把 multipart 的 part 类型固定成 `application/octet-stream`，
> 播放器拒绝播放。所以写库时必须**用扩展名自己推**：

```js
const contentType = kind === 'video'
  ? (ext === 'mov' ? 'video/quicktime' : 'video/mp4')
  : (ext === 'png' ? 'image/png' : 'image/jpeg')
```

### 判重与覆盖

```js
findDuplicate(folder, fileName, sha)
// 幂等键 = folder + file_name（不是裸文件名）
// 同名且哈希一致 → 提示「内容一致」
// 同名但哈希不同 → 提示「可确认覆盖」，overwrite=true 时走 update 而非 insert
```

---

## 20.7 播放链路：三层降级与三态探测

实现：`pages/media-viewer/media-viewer.js` + `utils/media-net.js`。

### 候选链（按顺序推进，穷尽才失败）

```
① 云端签名 / 直链      displayUrl 已解析好（COS 直链或签名 URL）
② 外链兜底            仅当 ① 为空且 video-map 有映射 → GitHub Release
③ 本机下载            当前 url 用 wx.downloadFile 下到临时文件再播
④ 诚实失败            说明原因 + 保留补录入口
```

`onError` 的推进逻辑：

```js
onError(e) {
  const current = this._urls[this._ui]
  // 一手证据：外链域名确实不可达 → 全局记 blocked，后续不再发必然失败的请求
  if (current && (current.source === 'github' || current.source === 'mirror') &&
      mediaNet.isDeterministicFailure(msg)) mediaNet.markBlocked(msg)

  if (this.data.stage === 'direct') {
    const next = this._ui + 1
    if (next < this._urls.length) return this.setData({ url: this._urls[next].url })  // 换下一源
    if (!this._downloaded) return this.fallbackDownload(msg)                          // 降级下载
  }
  this._fail(msg)
}
```

注意 `stage` 必须显式区分 `direct / download / local / noobject / failed`，
**否则界面只会显示"一直转圈"，用户无法判断是网络问题还是没有文件**。

### 三态可达性探测（`media-net.js`）

| 状态 | 含义 | 行为 |
|---|---|---|
| `unknown` | 未探测或结果过期（24h） | 发一次 HEAD 探测；图片本轮先不出外链 |
| `ok` | 拿到任意 HTTP 响应（含 403/404） | 放开 GitHub 候选 |
| `blocked` | 确定性失败 | 不再发外链，直接走资源库/本地上传 |

**只有确定性失败才记 blocked**，判定条件里包含 `domain list`、`not in domain`、
`name_not_resolved`、`unsupported url`、`ssl`。超时和弱网抖动**不记**——
否则进一次电梯就会把全局高清图永久关掉。

这个模块替代了早期"按 `envVersion` 写死"的做法。写死的问题是：设备明明能连通，
我们也主动不发请求，导致高清与视频在所有正式环境"永远不可用"。

### 播放进度

按**资源 id** 记，不按 URL 记（签名 URL 每 10 分钟变一次，按 URL 记必然丢）：

```js
const progress = {}            // 模块级：id → 秒
onTimeUpdate(e) { if (now - mark >= 5) progress[this._id] = t }   // 5 秒节流
```

### 来源标签（排障入口）

预览页信息栏会显示数据实际走哪条链路：

| 标签 | 条件 |
|---|---|
| `腾讯云 COS` | `isCosUrl(url)` 为真 |
| `镜像直链` | 直链但不是 COS（如 GitHub Release） |
| `云端` | 对象键 + 签名成功 |
| `备用源` | 无 displayUrl，但有映射外链 |
| `未入库` | 无 displayUrl 也无映射 |

现场反馈"为什么还是慢"时，**先看这个标签**，再看首帧时间。

---

## 20.8 把 COS 接成播放源：施工步骤

以下步骤已在腾讯云实测通过，可直接照做。

### 步骤 1：建桶

| 配置项 | 取值 | 说明 |
|---|---|---|
| 名称 | `tcg-poweroff-guide-<APPID>` | 桶名**必须带 APPID 后缀**，漏了会 404 |
| 地域 | `ap-shanghai` | 与现场同城，直连 0.13–0.24s |
| 访问权限 | **公有读私有写** | 小程序端算不了 COS 签名（需要 SecretKey，不能进包） |
| 存储类型 | **标准存储** | 低频/归档读数要先取回，首帧反而更慢 |

### 步骤 2：确认权限真的开了

访问一个**不存在**的对象，看错误码：

```bash
curl -sS "https://<bucket>.cos.ap-shanghai.myqcloud.com/__probe_$(date +%s).txt" | head -c 300
```

| 返回码 | 含义 |
|---|---|
| `NoSuchKey` | ✅ GetObject 已放开，只是对象不存在 |
| `AccessDenied` | ❌ 私有读，直链会 403，方案不成立 |

访问**桶根目录**返回 403 是**正常的**：公有读默认不授予 ListBucket。
这反而是好事——别人无法枚举桶内文件，只能靠猜路径。

### 步骤 3：目录与文件命名

```
media-library/baseline/<asset>.mp4      基线视频
vehicle_images/<车型目录>/<文件名>       照片（与 20.3 的三段式一致）
```

文件名**保持全 ASCII 原样**，不要重命名、不要带中文。桶内的键就是 HTTP 路径的一部分，
路径错一层就是 404。

### 步骤 4：上传

用 COSBrowser 拖文件夹，一次可以拖几百个，不用逐个点。

**两个会毁画质的开关，必须关**：

| 位置 | 选项 | 后果 |
|---|---|---|
| 上传工具 | "上传前压缩图片/视频" | 传上去的字节数比本地小，等于白传 |
| 桶配置 | 数据万象（CI）图片处理 / 图片样式 | 访问时套用压缩预设 |

另外三个不要碰：

- **不要开「原图保护」**——开了之后原图只能通过样式访问，等于强制所有请求走处理链路。
- **不要建图片样式**——本项目代码里没有任何 `?imageMogr2/...` 参数，也不需要。
- **不要配生命周期自动转低频/删除**——会误删，且低频取回有延迟。

### 步骤 5：验证没被压缩

COS 是对象存储，**逐字节保存，不做任何转码**。验证方法：

```bash
node scripts/verify-cos-upload.js <本地目录> \
  https://<bucket>.cos.ap-shanghai.myqcloud.com <键前缀>
```

判定依据两条：

1. `Content-Length` 必须等于本地字节数（压缩必然改变字节数）
2. `ETag` 为 32 位 hex 时即单次 PUT 的 MD5，必须与本地 MD5 相同
   （分片上传的 ETag 形如 `xxx-8`，退化为只校验字节数）

实测结论：本项目已上传的 3 个视频全部 `OK`（MD5 完全一致），说明存储层没有任何改写。

### 步骤 6：写回 url（关键一步）

把 `poweroff_media.url` 从旧值改成 COS 直链。**必须用幂等写法**，可重复执行：

```sql
UPDATE poweroff_media AS m
SET url = v.newurl,
    source = 'cos',
    mime = 'video/mp4',
    state = 'ok',
    updated_at = now()
FROM (VALUES
  ('tcgv_b5fc668c92.mp4', 'https://<bucket>.cos.ap-shanghai.myqcloud.com/media-library/baseline/tcgv_b5fc668c92.mp4')
  -- 全量时把剩余文件按同样格式追加进来
) AS v(oldname, newurl)
WHERE m.deleted = false
  AND m.kind = 'video'
  AND m.url LIKE '%' || v.oldname;
```

匹配条件是 `url LIKE '%' || 文件名`，所以重复执行结果一致，不会重复计数。

### 步骤 7：代码侧（只需一处常量）

照片的高清主源在 `utils/media-url.js`：

```js
const COS_IMAGE_BASE = 'https://<bucket>.cos.ap-shanghai.myqcloud.com/vehicle_images'

function hdCandidates(relList) {
  const out = []
  list.forEach(rel => out.push(COS_IMAGE_BASE + '/' + enc(rel)))   // ① COS 永远第一
  if (githubAllowed()) {                                          // ② 境外仅在确认可达时兜底
    list.forEach(rel => out.push(RAW_BASE + '/' + enc(rel)))
    list.forEach(rel => out.push(PAGES_BASE + '/' + enc(rel)))
  }
  return out
}
```

**顺序不能反**：一个必然超时的境外请求足以拖垮整屏。

**COS 不受 `mediaNet` 探测门禁约束**——它和境外图床不是同一条链路，
探测结果不能决定国内源发不发。

### 步骤 8：小程序域名白名单

| 域名 | 加到哪里 | 作用 |
|---|---|---|
| `<bucket>.cos.ap-shanghai.myqcloud.com` | **downloadFile 合法域名** | `previewImage`、`wx.downloadFile` 兜底 |
| 同上 | request 合法域名 | HEAD 探测（可选） |

`<video>` / `<image>` 组件本身不校验域名，所以主链路不受白名单影响；
但预览图和下载兜底走的是 downloadFile，必须加。COS 默认域名本身已在备案体系内，无需自己备案。

---

## 20.9 验收清单

### 功能验收（真机）

| # | 操作 | 期望 |
|---|---|---|
| 1 | 资源库下拉刷新 | 列表出现，视频条目不再有"未入库"角标 |
| 2 | 点开一条 COS 视频 | 信息栏标签显示 **腾讯云 COS**，首帧 < 1s |
| 3 | 拖动进度条 | 跟手，支持 Range |
| 4 | 切后台 30s 再回来 | 续播（签名 1 小时，不会中途 403） |
| 5 | 点开一条仍是 GitHub 的记录 | 标签显示 **镜像直链**，与 COS 对比首帧 |
| 6 | 车型改名后进资源库 | 该车素材的车型名同步更新 |
| 7 | 删除车型 → 看资源库 | 该车素材消失；回收站恢复后素材回来 |
| 8 | 断网进入详情页 | 车型步骤正常显示，照片回落到本地缩略图，不崩 |

### 工程验收

```bash
npm test                 # 39 个用例
node scripts/verify.js   # 8 道门禁（WXML/WXSS 真编译需 WCC_BIN/WCSC_BIN）
```

当前基线：37 JS / 21 JSON / 15 页 4 tab / 主包 1623.5KB / 39 测试通过。

### 数据验收

```sql
-- 应有：未删除视频全部有 url
SELECT kind, count(*) n,
       count(*) FILTER (WHERE COALESCE(url,'')='') AS no_url,
       count(*) FILTER (WHERE url LIKE '%myqcloud.com%') AS cos,
       count(*) FILTER (WHERE url LIKE '%github%') AS github
FROM poweroff_media WHERE deleted = false GROUP BY kind;
```

---

## 20.10 红线与已踩过的坑

按"踩过几次"排序，前 6 条都导致过线上不可用。

| # | 事实 | 如果做错会怎样 |
|---|---|---|
| 1 | `url` 必须区分直链与对象键 | 直链被签名 → displayUrl 全空 → 全部"未入库" |
| 2 | 回收站清理必须跳过直链 | 混入直链 → `storage.remove` 整批失败 → 清理中断 |
| 3 | 预览页必须按 id 直查（`getById`） | 用 `listByVehicle(0)` 是全表 500/页扫描 → "转很久然后失败" |
| 4 | 视频签名必须 ≥1 小时 | 用 600s → 长视频"看到一半黑屏" |
| 5 | 播放进度按 id 记 | 按 URL 记 → 每次进来都从头播 |
| 6 | 写库时必须自推 Content-Type | 信 `uploadFile` 的 → `octet-stream` → 播放器拒绝 |
| 7 | 高清源顺序：国内在前 | 境外源排前面 → 整屏等超时 |
| 8 | `safeOwnerSegment` 不能加哈希 | 与 RLS 表达式不匹配 → `row violates RLS policy` |
| 9 | 媒体读写全程 try/catch | 任一失败抛出 → 详情页白屏 → **作业流程中断** |
| 10 | 软删除必须写 `deleted_reason` | 恢复车型会把手工删的废片一起复活 |
| 11 | 跨车型转移素材必须禁止 | 只改 `vehicle_id` 不改路径 → 永久漂移，巡检反复告警 |
| 12 | 判重键不含裸文件名 | 两车同名照片互相污染 |
| 13 | 缺失照片禁用灰图占位 | 会被误认为"还在加载"，误导现场 |
| 14 | 车型删除必须 upsert 墓碑 | 只 update → 基线车型没有云端行 → 删了会"复活" |

### 一组对照数字（说明问题到底在哪）

| 层级 | 实际尺寸 | 体积 |
|---|---|---|
| 包内缩略图（离线兜底） | 最长边 260px | 3–8 KB |
| 线上"高清"（433px 天花板） | 433×606 | 26–43 KB |
| 基线视频 | 406×720 / 408×720 / 1280×720 | 586–1600 kbps |

**画质差是素材本身的问题，与传输链路无关。** COS 逐字节存储不会让画质变好，
它解决的是"3–15 秒才出画面"。两件事必须分开判断，否则会一直改错地方。

---

## 20.11 当前真实状态（2026-11-24）

| 项 | 数值 |
|---|---|
| 资源库记录 | 照片 266 / 视频 65（未删除） |
| 照片 `url` 为空 | **266 条全部为空**（只有登记，没有对象） |
| 视频播放源 | COS 17 条 / GitHub 直链 48 条（共 65，全部有源） |
| 基线视频资产 | 50 条映射 / 49 个唯一文件 / 471.6MB |
| 照片两档素材 | 包内缩略图 186 张；433px 高清本地 186 张（待上传 COS） |
| 任何源上都不存在的照片 | **63 张**（清单见 `docs/dev/待补照片清单.md`） |
| 小程序发布 | 未发布，`appid` 仍为 `touristappid` |
| 门禁 | 37 JS / 21 JSON / 15 页 4 tab / 主包 1623.5KB / 39 测试 |

### COS 现状

- 桶：公有读私有写、标准存储、上海地域，已验证 `NoSuchKey`（权限正确）
- 已上传：`media-library/baseline/` 下 3 个视频，字节数与本地完全一致
- 已上传：`vehicle_images/` 下 **0 个**（186 张待传）
- 未接 CDN（量级不足时不值得付运维成本，直连 0.5 元/GB 足够）

### 成本口径

| 项 | 单价 | 本规模月成本 |
|---|---|---|
| 存储 | 0.118 元/GB/月 | 0.46GB ≈ **0.05 元** |
| 外网下行 | 0.5 元/GB | 500 次观看 ≈ 2.4 元；1 万次 ≈ 47 元 |

真实成本全在流量，不在存储。公有读 + 0.5 元/GB 意味着被爬虫刷 1TB 就是 500 元，
**量大之后必须补 Referer 白名单或 CDN URL 鉴权**。

---

## 20.12 待办与责任人

| # | 事项 | 责任方 | 影响 |
|---|---|---|---|
| 1 | 上传 186 张照片到 `vehicle_images/`，跑 `verify-cos-upload.js` | 用户 | 高清图从 433px 起步 |
| 2 | 上传剩余 46 个视频到 `media-library/baseline/`，追加迁移脚本 | 用户 | 全部视频走国内节点 |
| 3 | 补拍 63 张任何源上都不存在的照片 | 用户 | 这些车的详情页仍回落兜底图 |
| 4 | 补原片（照片 3000px+ / 视频 1080p 3–4Mbps） | 用户 | 唯一能真正解决"糊"的路径 |
| 5 | `ffmpeg -movflags +faststart` 重封装（补原片时顺手做） | 用户/脚本 | 首帧速度，比换任何存储都有效 |
| 6 | 正式 appid + 发布 | 用户 | 目前仍是 `touristappid`，无法正式上线 |
| 7 | Referer 白名单 / CDN 鉴权 | 待定 | 防盗刷，量大后再做 |
| 8 | 小程序上传改 COS 直传（需签名服务） | 待定 | 现在 >8MB 会压到 6.4MB，保不住 1080p |

---

## 附：文件地图

| 文件 | 职责 | 改动风险 |
|---|---|---|
| `utils/media-paths.js` | 三段式路径单一真源 | 极高（改动影响全部历史路径） |
| `utils/media-store.js` | 资源 CRUD / 签名 / 导入 / 回收站 | 极高 |
| `utils/media-url.js` | 高清候选链、视频映射 | 高（源顺序直接影响首屏） |
| `utils/media-net.js` | 外链三态探测 | 中 |
| `utils/cloud-upload.js` | 二进制上传通道 + ASCII 转义 | 高（与 RLS 强耦合） |
| `utils/vehicle-media-link.js` | 车型↔资源库同步协调 | 中 |
| `utils/vehicle-store.js` | 车型覆盖层 / 墓碑 / 乐观锁 / 级联 | 高 |
| `utils/service.js` | 会话 / 签名缓存 / 审计 | 中 |
| `pages/media/*` | 资源库列表 | 中 |
| `pages/media-viewer/*` | 播放候选链 | 高 |
| `pages/media-edit/*` | 单条上传/编辑 | 中 |
| `pages/vehicle-admin/*` | 车型 CRUD + 内嵌素材网格 | 高 |
| `pages/detail/*` | 详情页 + 媒体合并 | 高 |
| `db/migrations/*.sql` | 可重放的数据库变更 | 中（幂等，可安全重跑） |
| `scripts/verify-cos-upload.js` | 上传保真校验 | 低 |
| `scripts/normalize-video.sh` | 视频归一（只降不升 + faststart） | 低 |
