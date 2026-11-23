# V10.25.8 发布说明（资源库修复版）

- **发布日期**：2026-11-23
- **版本号**：10.25.8（versionCode 102508）
- **一句话总结**：v10.25.7 的资源库索引放错了目录（`docs/` 不在 Pages 发布白名单，线上 404），本版把索引移到仓库根，并让同步流水线自动重建。

## 问题

`deploy-pages.yml` 用**白名单**组装发布目录：

```
cp index.html demo.html manifest.json sw.js feishu-api.js vehicles_data.js version.json _publish/
cp -r css js vendor vehicle_images web-data _publish/
```

`docs/` 不在其中。于是：

- 网页端（Pages）打开「资源库」→ `fetch('docs/media_library.json')` → **404** → 提示「索引加载失败」
- 本地开发/测试看不出来（文件确实存在）

## 修复

| 改动 | 内容 |
|---|---|
| 索引位置 | `docs/media_library.json` → **`media_library.json`（仓库根）**，与 `version.json` / `vehicles_data.js` 同级 |
| 发布 | `deploy-pages` 增加 `cp media_library.json _publish/` 与触发路径 `media_library.json` |
| 前端 | `js/13-media-library.js` 的 `INDEX_URL` 改为 `media_library.json` |
| 自动化 | `sync-web-data` 流水线在生成 `vehicles_data` / 媒体映射后追加 `gen_media_library`，并把 `media_library.json` 纳入自动提交 —— 数据变，索引即变 |

## 保持不变

- 资源库功能本体：314 条台账（265 照片 + 49 视频；缺失 63 / 共享 14 / 云端 49 / 孤儿 16）、五档计数、筛选与搜索、预览、一键复制缺失清单
- 测试 `tests/test_v10257_media_library.js`（39 断言）：纯函数、索引契约（stats 与实算一致、无 U+FFFD、缺失数 63 与 `audit:media` 口径一致）、接线、生成器幂等

## 验证方式（你自己也能验）

```bash
# 线上索引应返回 JSON（不是 404 HTML）
curl -s https://361087210.github.io/taicanggang-poweroff-guide/media_library.json | head -c 120

# 仓库内索引与数据是否漂移
npm run check:media-library
```
