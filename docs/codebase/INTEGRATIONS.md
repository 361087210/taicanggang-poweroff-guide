# External Integrations

> 证据基线：`feishu-api.js`、`js/00-config.js`、`js/05-sync.js`、`js/09-web-sync.js`、`scripts/*`、`SECURITY.md`、`.github/workflows/*`。

## Core Sections (Required)

### 1) Integration Inventory

| System | Type | Purpose | Auth model | Criticality | Evidence |
|--------|------|---------|------------|-------------|----------|
| 飞书开放平台 - 认证 | API | 获取/缓存 `tenant_access_token` | App ID + App Secret（构建注入/CI Secret） | high | `feishu-api.js`（认证族）；`scripts/inject_build_secrets.js` |
| 飞书 - 云文档 Drive | API/Storage | 文件上传下载、备份 JSON、教学视频存储 | tenant token | high | `feishu-api.js`（云文档族）；`js/06-media.js` |
| 飞书 - 多维表格 Bitable | API/DB | 结构化数据（反馈表 / Vehicles / Users 表） | tenant token | high | `js/12-bitable.js:19-60`；`version.json:61-62` |
| 飞书 - 审批 | API | 注册审批流创建/查询 | tenant token | high | `feishu-api.js`（审批族）；`js/05-sync.js` |
| 飞书 - 消息 IM | API | 组长拒件通知推送群 | tenant token | med | `feishu-api.js:1108-1138`（`notifyRegistrationResult`）；`version.json:64`（chatId） |
| GitHub - Releases | CDN/Storage | 教学视频/APK 直链（免鉴权、支持 Range） | 公开 | high | `js/00-bootstrap.js:1523`（`MEDIA_RELEASE_BASE`）；`scripts/sync_videos_to_release.js` |
| GitHub - Pages | Hosting | 网页端（PWA）部署 | 公开 | high | `.github/workflows/deploy-pages.yml` |
| GitHub - Raw / jsDelivr | CDN | 版本探测多源回退 | 公开 | med | `README.md:75`（多源探测） |
| GitHub - 注册收集箱仓库 | API/Storage | 网页端自助注册投递（绕过 CORS） | fine-grained PAT（构建注入 `TCG_REGISTER_TOKEN`） | med | `js/00-config.js:48-58`；`scripts/inject_build_secrets.js` |
| DeepSeek API | API | AI 反馈实时分析（CI cron） | `DEEPSEEK_API_KEY` | low | `.github/workflows/ai-feedback.yml:62-84` |
| 飞书开放平台 - 群机器人 | Webhook/API | 反馈/审批通知群 | tenant token | med | `version.json:64` |

> 无第三方云（数据库/消息队列/APM 等）。`SECURITY.md:3` 明确："主干平台为飞书与 GitHub，不引入第三方云"。

### 2) Data Stores

| Store | Role | Access layer | Key risk | Evidence |
|-------|------|--------------|----------|----------|
| localStorage | 配置/会话/账号/审计日志（`audit_log`） | 各 `js/*.js` 直接读写 | 明文存客户端；XSS 可读 | `js/16-audit.js`；`docs/ARCHITECTURE.md:25` |
| IndexedDB | 车型/用户/日志（重写方案中） | `[TODO]` 当前实际使用范围未证实 | — | `docs/ARCHITECTURE.md:25`（描述含 IndexedDB） |
| Cordova FileSystem | 缓存视频/文档、导出文件 | `js/07-cache.js`、`js/04-export.js` | 路径/权限 | `js/00-bootstrap.js:922-925`（`CACHE_ROOT_DIR` 等） |
| 飞书 Drive（JSON） | 用户数据备份、审批队列（`APP数据备份/` 子目录） | `feishu-api.js` | 单文件全量、弱网 | `README.md:159-171` |
| 飞书 Bitable | 反馈表 + 结构化数据双表 | `js/12-bitable.js` | QPS 限流（10 QPS/表更新） | `docs/DESIGN_V110_BITABLE.md:120-128` |
| `web-data/` 静态镜像 | 网页端只读数据（脱敏） | `js/09-web-sync.js` | **公开**（GitHub Pages），隐私必须脱敏 | `SECURITY.md:35-44`；`js/09-web-sync.js` |

### 3) Secrets and Credentials Handling

- Credential sources：
  1. 构建期注入：`scripts/inject_build_secrets.js` → `window.__BUILD_SECRETS__`（XOR+base64）。
  2. CI 仓库 Secrets：`FEISHU_APP_ID`、`FEISHU_APP_SECRET`、`FEISHU_FOLDER_TOKEN`、`TCG_REGISTER_TOKEN`。
  3. 用户设置页手动填写（仅存 localStorage）。
- Hardcoding checks：`scripts/secret-scan.js`（GitHub PAT `ghp_`/`github_pat_`、已知泄露飞书 Secret、高熵赋值），CI `.github/workflows/secret-scan.yml` 每次 push/PR 运行；`validate_web_assets.js` 亦含泄露扫描。
- Rotation/lifecycle：**已知历史泄露** —— 旧仓库曾硬编码飞书 App Secret（`SECURITY.md:24`），已在飞书开放平台轮换作废，新值仅经注入/Secrets。签名 keystore 曾入 git 历史，`SECURITY.md`/`docs/CICD使用说明.md:73` 建议后续轮换。
- 账号连接键脱敏：`linkKey = PBKDF2-HMAC-SHA256(password, LINK_SALT + '|' + phone, 100000, 256bit)`，`LINK_SALT` 公开无妨（熵来自密码）；镜像端只透传不重算（`SECURITY.md:36-44`；`js/00-config.js:35-42`）。

### 4) Reliability and Failure Behavior

- Retry/backoff：**已实现**。飞书 API 全局最小间隔 150ms + 并发上限 3；限流码 `99991400~99991404` 指数退避（400→800→1600ms + 抖动，预算 3 次，仅幂等 GET/HEAD）（`version.json:11-15`）。
- Timeout policy：版本探测走 `httpFetch` + 8 秒超时；Bitable 读取超时阈值 8s 自动切 JSON 兜底（`docs/DESIGN_V110_BITABLE.md:44`）。
- Circuit-breaker / fallback：视频四源回退链、HTTP 原生→fetch 回退、Bitable 失败→Drive JSON 兜底、弱网→静态镜像；下载统一入口 `feishuDownloadFile`（`version.json:14`）。
- Token 缓存：2 小时，提前 5 分钟刷新（`docs/ARCHITECTURE.md:98`）。

### 5) Observability for Integrations

- Logging around external calls：**有**，`console` 日志带 `[FeishuAPI xxx]` 前缀（`docs/DEVELOPMENT.md:84`）。
- Metrics/tracing：**无** APM/指标/分布式追踪。
- Audit：`js/16-audit.js` 本地 `audit_log` + 删除告警 + 可选 Bitable 上报。
- Missing visibility gaps：无集成级 SLO/告警；失败仅本地提示，无集中上报；`[TODO]` 是否接入任何监控服务未证实。

### 6) Evidence

- `feishu-api.js`、`js/00-config.js`、`js/05-sync.js`、`js/09-web-sync.js`、`js/12-bitable.js`、`js/16-audit.js`
- `scripts/inject_build_secrets.js`、`scripts/secret-scan.js`、`scripts/sync_web_data.js`
- `.github/workflows/secret-scan.yml`、`ai-feedback.yml`、`deploy-pages.yml`、`sync-web-data.yml`
- `SECURITY.md`、`docs/DEVELOPMENT.md`、`docs/DESIGN_V110_BITABLE.md`、`version.json`

## Extended Sections (Optional)

### 飞书配置（公开字段，实值）

- App ID：`cli_aa315800e5f8dd14`
- 文件夹 Token：`CeT0fYNgalU4fQdW9etcJLJGn1b`
- Bitable App Token：`Rv29b7CMAaKXj3sH2RBcRS5rnWb`
- 反馈表 ID：`tblxq32PwxKuUXOg`
- 通知群 chatId：`oc_5f7c4e8becbfeb487b0eb107ede3f5fb`
- 证据：`js/00-config.js:23-46`；`version.json:50-65`

### 数据同步拓扑

- 飞书 → GitHub：`sync-web-data.yml` cron `*/15 * * * *` 生成 `web-data/` 镜像并 commit（`.github/workflows/sync-web-data.yml:33-57`）。
- GitHub → 飞书：发版后 `sync-release-feishu.yml`（`workflow_run` 监听 Android Release）执行 `scripts/sync_release_both_roots.py`（`.github/workflows/sync-release-feishu.yml:58-62`）。
- 视频：`sync-videos-release.yml` cron `0 2 * * *` 同步视频到 GitHub Release（`.github/workflows/sync-videos-release.yml`）。