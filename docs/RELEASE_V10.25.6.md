# V10.25.6 发布说明（数据同步修复版）

- **发布日期**：2026-11-23
- **版本号**：10.25.6（versionCode 102506）
- **一句话总结**：找到并修掉「自动同步反复把中文写坏」的真根因——收流时逐块 `toString` 把多字节字符切成两半；数据镜像冻结两周后恢复，车型/账号/媒体映射全部刷新。

## 修了什么

### 🔴 根因：收流逐块解码把汉字切成两半
`scripts/sync_web_data.js` 的 `_req` / `_reqText` 用的是：

```js
res.on('data', c => d += c)   // c 是 Buffer，+= 逐块 toString()
```

一个 3 字节的中文字符只要被 TCP 分块切开，两半各自变成 `U+FFFD` 替换符，随后被 `JSON.stringify` 写进 `web-data/` 与 `vehicles_data.js` **提交上线**。证据：

| 读取方式（同一份云端文件） | U+FFFD |
|---|---|
| python 整段读取 | 0 处 |
| node 现网代码（CI 那轮 / 本地那轮） | 2 处 / 3 处（位置每次不同） |

历史上几次「自动同步写坏数据」都是这条路径；此前只修复坏串 + 加写盘守卫，属治标。

**现改为**：`_collectText()` 用 `Buffer.concat(chunks).toString('utf8')` 整段解码，`_req` 与 `_reqText` 共用。

### 🟢 数据：镜像恢复刷新
自 2026-11-09 起连续失败的 `Sync Web Data Mirror` 首次成功：

- 车型 **100**、品牌 **12**、账号 **11**、反馈 **2**
- `vehicles_data.js`、`docs/vehicle_media_mapping.*`、`docs/vehicle_media_manifest.json` 一并重新生成
- 线上网页端镜像 `syncedAt` 已推进到 2026-11-23

### 🟢 可观测与闭环
- 熔断打 `::error::` 注解 + 诊断三元组（**实际取到的源文件 token/修改时间**、本次车数、已有镜像 syncedAt/车数）+ `--force` 处置提示
- 同步失败**自动开 issue**、恢复**自动关闭**（issue #14 已完成一次「失败 → 修复 → 自动关闭」实测）
- `.github/labeler.yml` 补齐（只用仓库已有标签），`actions/labeler@v4 → v7`
- 飞书 `modified_time` 按秒级解析（此前误当毫秒，诊断行显示成 `1970-01-21`）

### 🧪 测试
- 新增 `tests/test_v10256_stream_decode.js`（10 断言）：把响应体**故意切在汉字字节中间**，旧实现下 4 项红
- 新增 `tests/test_v10255_mirror_diag.js`（21 断言）：熔断必红、必带注解、必自解释、不得覆盖产物
- 全量：**62/62 套件通过**

## 升级方式
- **网页版**：随 `main` 自动生效（刷新即可，缓存名已升到 `tcg-poweroff-v10.25.6`）
- **Android / iOS**：安装本 Release 的 APK / IPA

## 已知遗留
1. 63 张照片真缺失、64 条视频尚无 sha256 指纹（`npm run audit:media`）
2. dependabot 报 18 个依赖漏洞（9 high），PR #4 未处理
3. cron 用 `GITHUB_TOKEN` 推送不会触发下游 Pages 部署——本次由人工触发一次发布，长期需加 `workflow_run` 触发或改用 PAT
4. `softprops/action-gh-release@v1` 被 actionlint 指 runner 过旧，建议升 v2
