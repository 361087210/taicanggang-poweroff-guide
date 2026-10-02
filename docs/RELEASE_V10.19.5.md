# V10.19.5 飞书限流根治版 — 发布说明

> 版本号：10.19.5 ｜ versionCode：101905

## 一句话

根治 App 从飞书云端加载图片/视频偶发失败的问题（飞书 API 限流 `99991400 request trigger frequency limit`）：统一请求门控（150ms 最小间隔 + 并发上限 3）、限流码指数退避重试、目录列表 30s 缓存、图片/视频下载统一走门控入口，弱网与突发并发场景不再随机失败。

## 根因

图片/视频下载此前走裸 `sendRequest`/`fetch`，完全绕过 `httpFetch` 的门控与退避；图片加载还会反复列目录、无缓存，突发并发直接撞飞书 QPS 限流（`99991400`）。

## 本次内容

### 治理（请求门控）

- 飞书 API 请求全局最小间隔 **150ms** + 并发上限 **3**（同步/异步调用方通用），从源头掐断突发并发撞飞书 QPS 限流。
- 门控函数 `feishuGateEnter`/`feishuGateExit` 成对使用，等待队列保证并发不超过上限。

### 治理（限流退避）

- 限流码 `99991400~99991404` 与网络错误触发指数退避重试（400ms → 800ms → 1600ms + 随机抖动，预算 3 次，仅幂等 GET/HEAD）。
- 重试预算耗尽后优雅降级返回限流响应/抛出，由调用方 `try/catch` 处理，不崩溃。

### 治理（统一下载）

- 新增 `feishuDownloadFile` 统一门控下载入口（150ms 最小间隔 + 并发上限 3 + 限流退避重试 3 次）。
- `06-media.js` 图片下载（`_fetchFeishuImageBlobUrl`）与视频分片下载（`downloadBlob`）从裸请求全部切换接入。

### 治理（列表缓存）

- `feishuListFiles` 目录列表 **30s 缓存**，折叠图片加载反复列目录的高 QPS 请求。

### 工程

- 新增专项测试 `tests/test_v10195_feishu_rate_limit.js`：静态断言防回退（下载路径必须走 `feishuDownloadFile`）+ 动态用例桩掉网络层，验证并发上限、最小间隔、退避重试次数、缓存命中。
- 版本升号 10.19.4 → 10.19.5（七源对齐：config.xml / version.json / release/version.json / 00-bootstrap / sw.js / demo.html / 11-about 版本历史与兜底字面量）。

## 升级指引

1. 打开 App，确认提示的新版本为 **V10.19.5**。
2. 点击「更新」下载安装（Android 签名包）。
3. 若为 iOS，请联系组长获取安装包。

## 资产

| 文件 | 说明 |
|---|---|
| `tcg_poweroff_v10.19.5.apk` | Android 签名安装包（v1+v2 签名） |
| `tcg_poweroff_v10.19.5.apk.sha256` | APK SHA-256 校验和 |
| `tcg_poweroff_v10.19.5_ios.ipa` | iOS 安装包（development，无签名） |
| `version.json` | 版本清单（`downloadUrl` 指向 v10.19.5） |

## 备注

- 本版是 10.19.4 的超集，包含其全部内容（环境对齐、别名安全加固、注册投递修复等），只需更新这一次。
- 若设备网络极端弱导致重试预算耗尽，图片/视频会走既有降级链路（占位图/重试提示），不再随机白屏。
