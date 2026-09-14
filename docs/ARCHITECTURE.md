# 太仓港断电指导 App — 架构文档 V10.18（Capacitor + Vite + TS 重写）

> 最后更新：2026-09-14 ｜ 当前版本 v10.19.0 ｜ 技术路线：Capacitor 6 + Vite 5 + TypeScript 5
> 数据/认证/通知：**飞书**（Bitable + Drive + 审批 + 群机器人）；代码/网页/媒体 CDN：**GitHub**

## 一、整体架构

```
┌──────────────────────────────────────────────────────────┐
│                    多端交付层                              │
│  iOS App (Capacitor) │ Android App (Capacitor) │ 网页(PWA) │
│  └──── 同一套 Vite 构建产物 dist/ ────┘  (GitHub Pages)    │
├──────────────────────────────────────────────────────────┤
│                    应用层 (Vite + TS ESM)                 │
│  ts/main.ts 编排: core/config → core/feishu → data/*      │
│  → sync/web-mirror → auth/registration → ui/screens      │
├──────────────────────────────────────────────────────────┤
│                    数据访问层 (单一真源)                   │
│  ts/core/feishu.ts  (window.FeishuAPI 单例, 收敛去重)     │
│   ┌─────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│   │ Bitable │  │  Drive   │  │ 审批中心 │  │ 群机器人 │   │
│   └─────────┘  └──────────┘  └──────────┘  └──────────┘   │
├──────────────────────────────────────────────────────────┤
│                    本地存储层                              │
│  localStorage(配置/会话) │ IndexedDB(车型/用户/日志) │ FS   │
└──────────────────────────────────────────────────────────┘
```

## 二、配置单一真源

- `ts/config.ts` 导出 `getConfig()`，所有模块从此读取，不再各自硬编码。
- 密钥红线：appSecret / GitHub PAT **绝不进源码**。
  - 来源①：构建期 `scripts/inject_build_secrets.js` 注入 `window.__BUILD_SECRETS__`
  - 来源②：CI 仓库 Secrets（`FEISHU_APP_SECRET` / `FEISHU_APP_ID`）
  - 来源③：用户设置页手动填写（仅存 localStorage）
- `WEB_SYNC_SALT` 必须与 `scripts/sync_web_data.js` 中字面量**完全一致**（两运行时各自维护同一常量）。

## 三、数据流

### 3.1 车型数据双向同步
本地 `VEHICLES` ⇄ 飞书 Bitable（增量对比 id+timestamp，智能合并新增/更新/跳过）。

### 3.2 注册审批流（根治 bug①）
新用户注册 → 创建审批实例 → 飞书审批中心 → 组长操作 → 轮询状态变更 →
- `pending → active`：本地激活
- `rejected`：飞书群推送拒件通知 + 申请端提示（**watchRegistrationActivation**）
- 遗留账号（`approved`/`normal`/`verified`/空）归一为 `active`，组长端可见

### 3.3 网页镜像（根治 bug② + 网页端可用）
`scripts/sync_web_data.js` 每 15 分钟从飞书生成静态 `web-data/`：
`vehicle_sync_data.json` / `approved_users.web.json`(手机号 sha256 脱敏) / `feedback_data.json` / `data_update_notice.json` / `meta.json(syncedAt)`。
网页端 `sync/web-mirror` 探测 `meta.json.syncedAt` 后安装镜像覆盖层（注册走 GitHub inbox，规避 CORS）。

## 四、缺陷修复对照（原始 6 大 Bug）

| # | Bug | 落点 |
|---|-----|------|
| ① | 组长拒绝注册→无通知/无法登录/往期不可见 | `data/users.ts` 状态机 + 拒件通知 + 遗留归一 |
| ② | 网页端无法注册 | `auth/registration.ts` 走 GitHub inbox |
| ③ | 视频无封面/部分不可播/网页端不可播 | `data/media.ts` 统一封面+可播格式+直链 |
| ④ | 上传照片/视频按车型命名 | `data/media.ts` 结构化命名 |
| ⑤ | 只改提及功能+全面测试 | 仅实施本方案改动 + CI 测试门禁 |
| ⑥ | 发版飞书+GitHub 同步 | `ci/` 构建+发版流水线 |

## 五、关于"死代码"的重要更正

> ⚠️ 早期基于**不完整本地副本**得出的三条"死代码"结论已被证伪，特此记录，避免重复踩坑：
> - ~~`04-export.js` / `10-feedback.js` / `11-about.js` 缺失~~ → 远程仓库均存在（68/30/27KB），
>   且 `04-export.js` 支持照片嵌入 Excel、`10-feedback.js` 支持离线反馈队列+截图，均为真实功能。
> - ~~vendor 库（xlsx/jspdf/html-docx/html2canvas）是死重~~ → 是 `04-export.js` 的正常依赖（合计约 2.3MB）。
> - ~~package.json 脚本全部失效~~ → 其引用的 `tests/*.js`、`scripts/*.js` 远程仓库均存在。
>
> **任何"去无用代码"的结论都必须在完整源码树上、并有回归测试覆盖后才能执行。**

**当前待求证项（不得直接删除）**：
- `00-bootstrap.js` 内联兼容上传实现（注释自述"已下沉 FeishuAPI"）——疑似与 `feishu-api.js` 重复，删除前须跑全量回归。
- 三大数据访问路径重叠（feishu-api / 00-bootstrap 内联 / 09-web-sync 镜像）——收敛属重写阶段任务。

**重写核心难点**：`js/*.js` 模块间靠**隐式全局变量**互相引用，直接套 Vite 会切断共享作用域导致运行时报错，必须**逐模块改写为显式 ESM**（见 `REWRITE_PROPOSAL.md` 4.2 的推荐顺序）。

## 六、构建与部署

```bash
npm install
npm run dev          # Vite 本地预览
npm run build        # tsc 类型检查 + vite 构建 -> dist/
npx cap sync         # 同步原生壳(iOS/Android)
npm run test         # 运行回归测试
```

- 网页：GitHub Pages 部署 `dist/`（base 相对路径，适配子路径）。
- 原生：Capacitor 将 `dist/` 拷入 iOS/Android 工程。
- CI：`.github/workflows/sync-web-data.yml`（每 15 分钟生成镜像）+ `secret-scan.yml`（密钥扫描）+ 发版流水线。

## 七、安全设计

1. Token 缓存 2 小时，提前 5 分钟刷新
2. 权限最小化（Camera/Filesystem/Share/Haptics）
3. 数据隔离：车型/用户/日志分仓
4. 手机号 `sha256(WEB_SYNC_SALT + phone)` 脱敏，网页镜像无明文
5. 密钥不落源码，CI Secrets + 构建注入
