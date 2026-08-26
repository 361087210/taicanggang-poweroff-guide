# RELEASE V10.9.0 — 视频分离上传 + UI适配修复版

> 发布日期: 2026-08-26  
> 版本号: 10.9.0 | versionCode: 100900  
> 测试: 32项全链路同步管线测试全部通过

---

## 一、本次修复的两个核心问题

### 问题1: 组员端收到通知但拉取数据失败

**现象**: 组长端更新带文字、图片、视频的测试车型数据,上传到飞书显示成功。组员端过了几分钟收到通知,但拉取数据失败。

**根因分析**:

V10.6.0 实现了照片分离上传(`syncUploadVehiclePhotos`),将 base64 图片单独上传至云端 `vehicle_images` 目录并替换为云端路径。但**视频仍以 `data:video/;base64,` 留在 `videoPaths` 数组中**,未被分离。

单段现场拍摄视频(10-30秒)的 base64 编码后常达 10-50MB,导致:
1. 飞书 `upload_all` 虽能上传(V10.8.0 multipart 修复),但生成的 JSON 文件巨大
2. 组员端 `download` 接口下载超时/内存溢出,表现为"收到通知但拉取失败"
3. 即使侥幸下载成功,`JSON.parse` 在移动端 WebView 内存受限下直接 OOM 崩溃

**修复方案**:

新增 `syncUploadVehicleVideos(token, vehicles)` 函数,与照片分离上传同构:

```
上传前: videoPaths[i] = "data:video/mp4;base64,AAAA..."
                ↓
  ① 提取 MIME 和 base64 数据
  ② 计算 djb2 哈希(幂等判定)
  ③ 文件名 = user_v{id}_v{序号}_{hash}.mp4
  ④ 云端已有同名 → 跳过(skipped++)
  ⑤ 云端无 → 转 Blob → 上传至 vehicle_videos 目录
  ⑥ videoPaths[i] = "vehicle_videos/user_v{id}_v{序号}_{hash}.mp4"
                ↓
上传后: JSON 只含轻量路径(50字节 vs 10-50MB)
```

**幂等设计**: 文件名 = 车辆id + 序号 + 内容哈希。重复上传命中云端同名文件即跳过,不产生冗余副本。本地 `videoPaths` 同步替换并持久化,二次上传零流量。

**管线集成**: `_syncUploadPipeline()` 中在照片分离上传后、JSON 上传前调用:

```javascript
const photoStat = await syncUploadVehiclePhotos(token, VEHICLES);  // V10.6.0
const videoStat = await syncUploadVehicleVideos(token, VEHICLES);  // V10.9.0 新增
if(photoStat.replaced > 0 || videoStat.replaced > 0) {
  persistVehicles(); // 路径对齐后立即持久化
}
```

**数据更新通知**: `data_update_notice.json` 增加 `videoCount` 字段,组长可感知视频上传统计。

### 问题1健壮性: 下载超时保护

为所有飞书文件下载路径增加超时保护:

| 下载路径 | 原生HTTP | fetch | 超时时间 |
|---------|---------|-------|---------|
| 主同步数据(`downloadJsonFromFolder`) | `timeout:120` | `AbortController(120s)` | 120秒 |
| 注册申请(主路径) | `timeout:60` | `AbortController(60s)` | 60秒 |
| 注册申请(自愈分支) | N/A | `AbortController(60s)` | 60秒 |

超时后提供清晰提示: `"数据下载超时(120s),请检查网络后重试"`

### 问题2: UI适配问题(红米K70 Pro, Android 16, 412×915, 2.625x)

| 问题 | 根因 | 修复 |
|------|------|------|
| 顶端标题和返回按键显示不全 | `.pt-12` 覆写为 `safe-top+12px`,Android `safe-top=0` → 仅12px | 修正为 `safe-top+48px` |
| 数据同步下方按钮显示不完整 | `.pb-24` 覆写为 `safe-bottom+24px`,Android `safe-bottom=0` → 仅24px<导航64px | 修正为 `safe-bottom+96px` |
| 同步中心从右往左滑有大片留白 | `.scroll-y` 缺少 `overflow-x:hidden`,Android WebView将visible解析为auto | 增加 `overflow-x:hidden` |

---

## 二、修改文件清单

| 文件 | 修改内容 |
|------|---------|
| `demo.html` | 新增 `syncUploadVehicleVideos()` 函数;修改 `_syncUploadPipeline()` 集成视频上传;修改 `downloadJsonFromFolder()` 增加超时;修改注册申请下载路径增加超时;修复 CSS `.pt-12`/`.pb-24`/`.scroll-y`;更新 `APP_VERSION` 为 10.9.0;更新 `invalidateDataFolderCache()` 纳入 `vehicle_videos`;更新通知文件增加 `videoCount` |
| `config.xml` | version 10.8.0→10.9.0, versionCode 100800→100900 |
| `version.json` | 版本号/版本代码/下载URL/发布说明全部更新 |
| `CHANGELOG.md` | 新增 V10.9.0 变更记录 |

---

## 三、测试报告

### 测试套件: 32项全通过

| 测试组 | 测试项数 | 通过 | 失败 |
|--------|---------|------|------|
| 1. 视频分离上传逻辑 | 5 | 5 | 0 |
| 2. JSON体积缩减验证 | 2 | 2 | 0 |
| 3. 下载超时保护 | 3 | 3 | 0 |
| 4. 全链路同步流程 | 3 | 3 | 0 |
| 5. 边界条件 | 3 | 3 | 0 |
| 6. CSS UI适配验证 | 10 | 10 | 0 |
| 7. 数据完整性验证 | 3 | 3 | 0 |
| 8. 端到端同步模拟 | 3 | 3 | 0 |
| **合计** | **32** | **32** | **0** |

### 关键测试结果

- JSON体积缩减: 50056 → 1486 bytes (缩减97.0%)
- 组员端下载JSON体积: 1.5KB(可轻松在移动端内存内解析)
- 幂等性: 重复上传相同视频,云端不产生冗余文件
- 超时保护: 模拟永久挂起的fetch,100ms后正确触发AbortError
- 端到端: 组长上传→飞书云端→组员下载→数据完全一致

---

## 四、版本兼容性

- 最低支持版本: 5.3.0
- 向后兼容: V10.6.0~V10.8.0 的云端数据可正常读取(视频路径已是云端格式或base64,V10.9.0会自动分离base64)
- 数据迁移: `vehicle_videos` 目录在首次上传时自动创建,无需手动干预
- 缓存失效: `invalidateDataFolderCache()` 已纳入 `vehicle_videos`,切换飞书配置时自动重建

---

## 五、发布检查清单

- [x] 代码修改完成并自审
- [x] 版本号一致(config.xml / version.json / demo.html APP_VERSION)
- [x] CHANGELOG.md 更新
- [x] 全链路测试 32 项通过
- [x] CSS UI 适配验证(红米K70 Pro Android 16 场景)
- [x] 向后兼容性确认
- [x] 缓存失效机制更新
- [x] 发布文档完成
- [ ] Git 提交推送
- [ ] GitHub Tag 触发 CI 构建
- [ ] APK 签名包产出
