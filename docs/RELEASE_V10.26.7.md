# V10.26.7 发布说明（工程治理版）

- **发布日期**：2026-11-24
- **版本号**：10.26.7（versionCode 102607）
- **一句话总结**：补齐行业标准里最缺的三块——**分支/tag 保护与协作规范**、**全局错误捕获与诊断上报**、**依赖与供应链治理**。

## 一、分支与 tag 保护（此前 `main` 无保护）

走查发现：仓库里虽有一条名为「保护分支」的规则集，但 `include` 是**空数组**——等于不生效，任何人都能直推 `main`（本次会话我自己就多次直推、并两次移动已发布 tag）。

现在的规则：

| 对象 | 规则 |
|---|---|
| `refs/heads/main` | 必须走 PR；必过 **`Web资产与安全校验`（CI）** 与 **`scan`（Secret Scan）**；线性历史（只允许 squash/rebase）；**禁 force push**；**禁删除** |
| `refs/tags/v*` | **禁止移动/删除**（打错了就发下一个 patch 版本，不再 `tag -f`） |
| 例外 | 仓库管理员保留应急绕过（会有操作记录）；GitHub Actions 数据流水线仍可直推数据提交 |

配套协作文件：`.github/CODEOWNERS`、`.github/pull_request_template.md`（自检清单）、`CONTRIBUTING.md`（分支/提交/发版/数据/可观测性规范）。

## 二、全局错误捕获与诊断（此前完全没有）

新增 `js/17-error-report.js`（**尽早加载**，早于 `00-bootstrap`，以覆盖启动期异常）：

- 捕获 `window.onerror` 与 `unhandledrejection`（含脚本、行列、堆栈）
- 落 `localStorage` 环形缓冲（**最多 20 条**，重启不丢）
- **落盘前掩码 PII**：手机号 / 邮箱 / 身份证（顺序上先处理 18 位身份证，否则会被手机号规则截胡——这是单测抓出来的真实 bug）
- **轻量自动上报**：每小时最多 1 条到飞书反馈表（字段：文本/平台/APP版本）；离线或字段不匹配一律降级为"仅本地保留"，不影响主流程
- **我的 → 复制诊断信息**：现场可一键导出最近 20 条错误给开发

## 三、依赖与供应链

- 新增 `.github/dependabot.yml`：npm 每周（按 dev-tooling / cordova-chain 分组）、actions 每月
- **34 处 action 引用全部固定到 commit SHA**（16 条 workflow）——防 `@vN` tag 被上游移动的供应链风险
- 遗留：18 个依赖漏洞（9 high / 8 medium / 1 low）**全部来自 cordova 构建链**（dev 期依赖，不进入客户端运行包）；cordova 已是 npm 最新 `13.0.0`，后续由 dependabot 逐条升级；`vendor/` 第三方库的 SRI 仍缺，列入下一批

## 四、验证

- 新增 `tests/test_v10267_error_reporting.js`（**29 断言**）：PII 掩码（含身份证顺序）、环形缓冲、载荷构造、capture→drain 端到端、install 幂等与双监听、限流常量、接线
- 全量测试、门禁、构建、部署、飞书同步状态见发布记录

## 五、仍待治理（下一批）

1. 覆盖率口径修正（门禁 95% 只覆盖「可归因」子集，23% 代码未测）
2. 20 个纯静态断言迁移为行为断言
3. ESLint/Prettier + `tsconfig` checkJs
4. RUNBOOK（回滚/恢复演练）、vendor SRI/SBOM
