# Architecture

> 证据基线：`docs/codebase/.codebase-scan.txt` + `js/*.js`、`feishu-api.js`、`demo.html` 实际读取。
> ⚠️ 本文档描述**当前实际代码**（Cordova + Vanilla JS 单页）；仓库另有 `docs/ARCHITECTURE.md` 描述**未落地的** Capacitor/Vite/TS 重写路线，二者冲突见 CONCERNS.md。

## Core Sections (Required)

### 1) Architectural Style

- Primary style：**单页 Vanilla JS + 隐式全局作用域耦合**（single-page, global-scope coupled），非严格分层。
- Why this classification：`demo.html` 用 `<script defer>` 按 `NN-` 前缀顺序加载 15 个 `js/*.js`（`demo.html:666-682`）；模块间无 `import/export`，靠 `window.*` 与顶层函数互引（如 `window.TCG_CONFIG`、`window.FeishuAPI`、`window.Audit`、顶层 `const APP_VERSION`、`const State`）。
- Primary constraints：
  1. **加载顺序即依赖序** —— 后加载模块可调用先加载模块的全局函数，反之不可（`js/00-bootstrap.js` 必须最先，`js/08-main.js` 绑定 `deviceready` 最后）。
  2. **无打包器** —— 因此不能简单引入 Vite/Rollup，会把隐式共享作用域切断（`docs/REWRITE_PROPOSAL.md:86-96`）。
  3. **两端同源契约** —— 同一套 `js/`/`demo.html`/`feishu-api.js`/`css/`/`vendor/` 既进 App 又进网页端，改动受「两端错配门禁」约束（`scripts/check_two_end_sync.js:38-48`）。

### 2) System Flow

```text
demo.html (DOM: screens/modals)
  -> <script defer> 顺序加载 js/00-config.js -> 00-bootstrap.js -> 01-state.js -> 02-auth.js
     -> 03-vehicles -> 04-export -> 05-sync -> 06-media -> 07-cache -> 08-main
     -> 09-web-sync -> 10-feedback -> 11-about -> 12-bitable -> 16-audit
  -> deviceready (08-main.js) 绑定硬件返回键 / popstate / 双击退出
  -> 用户操作触发顶层全局函数 (doLogin / renderVehicles / generateExcel / syncPendingToFeishu ...)
  -> 数据访问: 经 window.FeishuAPI (feishu-api.js 单例) 或 00-bootstrap 的 httpFetch 适配层
  -> 传输: cordova-plugin-advanced-http 原生栈 (真机) / fetch (浏览器降级)
  -> 外部: 飞书 OpenAPI (认证/Bitable/Drive/审批/IM) + GitHub (Release 媒体直链 / Pages / Raw CDN)
  -> 输出: DOM 渲染 / localStorage·IndexedDB 持久化 / 文件导出 / 分享
```

4-6 步证据：`demo.html:666-682`（加载序）→ `js/08-main.js:62-73`（事件绑定）→ `js/00-bootstrap.js:570`（`httpFetch`）→ `feishu-api.js:1095`（`window.FeishuAPI`）→ `js/05-sync.js`/`js/03-vehicles.js`（业务调用）。

### 3) Layer/Module Responsibilities

| Layer or module | Owns | Must not own | Evidence |
|-----------------|------|--------------|----------|
| 配置层 `js/00-config.js` | 公开常量单一真源 `window.TCG_CONFIG` | 密钥、业务逻辑 | `js/00-config.js:21-59` |
| 启动/原语层 `js/00-bootstrap.js` | 车辆/用户初值、拼音、密码哈希、`deriveLinkKey`、`httpFetch`、缓存路径、媒体直链、版本常量 | 页面业务 | `js/00-bootstrap.js:16-1725` |
| 状态层 `js/01-state.js` | `state`、导航栈、`showScreen`、`goBack` | 网络/持久化 | `js/01-state.js:8,19-305` |
| 认证层 `js/02-auth.js` | 登录/注册/会话恢复/身份判断/linkKey 迁移 | 车辆渲染 | `js/02-auth.js:28-451` |
| 业务层 `js/03-vehicles.js`、`04-export.js`、`06-media.js`、`10-feedback.js`、`11-about.js` | 列表/导出/媒体/反馈/关于 | 底层飞书请求 | `js/03-vehicles.js`… |
| 同步层 `js/05-sync.js`、`09-web-sync.js` | 审批轮询、成员守护、备份、镜像桥 | UI | `js/05-sync.js`；`js/09-web-sync.js` |
| 数据访问层 `feishu-api.js`、`js/12-bitable.js` | 飞书 OpenAPI 单例、Bitable 封装 | UI | `feishu-api.js:1065-1095`；`js/12-bitable.js:19-60` |
| 审计层 `js/16-audit.js` | `window.Audit` 操作留痕 | 业务写入 | `js/16-audit.js:1-60` |

### 4) Reused Patterns

| Pattern | Where found | Why it exists |
|---------|-------------|---------------|
| Singleton（单例） | `window.FeishuAPI`（`feishu-api.js:1095`）、`window.TCG_CONFIG`（`js/00-config.js:21`） | 收敛去重，避免多份配置/客户端漂移 |
| Global namespace object | `window.TCG_CONFIG`、`window.Audit`、`window.VEHICLES`/`USERS` | 无模块系统下的跨文件共享 |
| Fallback chain（多源回退） | 视频四源回退（本地 APK→飞书云→GitHub CDN→提示）；HTTP 原生→fetch 回退（`feishu-api.js:306-318`）；版本多源探测（GitHub Raw→jsDelivr→飞书） | 弱网/真机兼容与可用性 |
| Adapter（适配层） | `httpFetch`/`httpUploadFile`（`js/00-bootstrap.js:570,679,809`）统一原生与 Web 网络栈 | 屏蔽 Cordova 与浏览器差异 |
| QPS gate + backoff | `_qpsGate`、限流码退避重试（150ms/3 并发；400→800→1600ms） | 规避飞书 API 限流（99991400~99991404） |
| Generation-by-mirror（镜像覆盖） | `js/09-web-sync.js` 安装 `web-data/` 镜像覆盖层 | 网页端无后端/CORS 不可达时读静态镜像 |

### 5) Known Architectural Risks

- **隐式全局耦合阻碍重构**：任何打包器化都会切断跨文件共享作用域 → 运行时 `xxx is not defined`（`docs/REWRITE_PROPOSAL.md:86-96`）。
- **三套飞书数据访问路径并存**：`feishu-api.js` 单例 / `js/00-bootstrap.js` 内联兼容上传 / `js/09-web-sync.js` 镜像覆盖（`docs/ARCHITECTURE.md:76-80`）→ 收敛困难、易漂移。
- **巨型模块**：`js/05-sync.js`（1865 行）、`js/00-bootstrap.js`（1759 行）、`js/04-export.js`（1273 行）单文件混合多职责，改动风险高。
- **两端错配**：网页端跟 `main` 自动更新、App 只跟 tag 更新 → 代码进 main 未升版本号/未打 tag 会造成静默错配（`scripts/check_two_end_sync.js:1-24`；`docs/PENDING_ISSUES.md:13-18`）。
- **客户端持有 App Secret 能力**：飞书 Secret 经构建注入 `window.__BUILD_SECRETS__` 由客户端使用 → 逆向可提取（架构级风险，见 CONCERNS.md）。

### 6) Evidence

- `demo.html:666-682`
- `js/00-config.js`、`js/00-bootstrap.js`、`js/01-state.js`、`js/02-auth.js`、`js/05-sync.js`、`js/08-main.js`、`js/09-web-sync.js`
- `feishu-api.js:306-318,1065-1095`
- `scripts/check_two_end_sync.js`
- `docs/ARCHITECTURE.md`、`docs/REWRITE_PROPOSAL.md`（重写意图，未落地）
- `docs/codebase/.codebase-scan.txt`

## Extended Sections (Optional)

### 初始化顺序

1. `js/00-config.js` 写 `window.TCG_CONFIG`。
2. `js/00-bootstrap.js` 定义 `APP_VERSION`、`VEHICLES`、`USERS`、`httpFetch`、`deriveLinkKey`、媒体直链等原语。
3. `js/01-state.js` 定义 `state` 与导航。
4. … 依次加载至 `js/08-main.js`，其 `deviceready` 回调绑定硬件返回键；`popstate` 绑定浏览器返回。
5. `demo.html` 末尾注册 Service Worker（`demo.html:684-699`）。

### 抗退化设计（已内建）

- 版本一致性门禁（七源对齐）、两端错配门禁、CI 覆盖率门禁、密钥扫描门禁、媒体映射漂移门禁 —— 均见 TESTING.md / CONCERNS.md。