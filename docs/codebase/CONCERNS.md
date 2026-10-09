# Codebase Concerns

> 证据基线：`docs/codebase/.codebase-scan.txt`、`SECURITY.md`、`README.md`、`docs/ARCHITECTURE.md`、`docs/CICD使用说明.md`、`version.json`、`package.json`、`scripts/*`、`.github/workflows/*`。

## Core Sections (Required)

### 1) Top Risks (Prioritized)

| Severity | Concern | Evidence | Impact | Suggested action |
|----------|---------|----------|--------|------------------|
| high | 历史明文飞书 App Secret 泄露 | `SECURITY.md:24`（记录旧值 `s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb`）<!-- noqa:secret --> | 旧值若未真正轮换或仍存在 fork/镜像，可被冒用获取 tenant token | ✅ 已完成：平台轮换生效 + `git-filter-repo` 历史清理 + 强推远端；泄漏令牌自全历史清零（复核 `exit=1`） |
| high | 签名 keystore 曾入 git 历史 | `docs/CICD使用说明.md:73` 建议轮换；`SECURITY.md` 未覆盖 | APK 签名密钥外泄可致仿冒分发 | ✅ 已完成：新 keystore 已轮换、旧密钥作废；keystore/`.jks` 已从 git 全历史清零 |
| high | 网页镜像 `web-data/` 公开暴露 | `SECURITY.md:30-44`；`js/09-web-sync.js`；`.github/workflows/sync-web-data.yml` | 静态脱敏数据发布到 GitHub Pages，任何脱敏缺陷即隐私泄露 | 维持 linkKey（PBKDF2）方案、禁止明文 phone/密码哈希出库；对镜像产物加发布前脱敏审计门禁 |
| low | 文档与实现偏差（已修正） | `README.md`（版本已更正为 10.20.0）；`docs/ARCHITECTURE.md:1-3`（Capacitor+Vite+TS 重写已标注「作废/未落地」） | 若新文档再不同步，仍会误导新人 | 维持文档-实现一致性核对；新文档发布前比对 `version.json` |
| low | 验收仍部分依赖源码文本断言（行覆盖率门禁已落地） | `scripts/check_ci_coverage.js`（可达性门禁）；`scripts/check_coverage_threshold.js`（行覆盖率 ≥95% 硬门禁，可归因实测 99.38%）；`tests/test_v57_logic.js`（正则/`eval` 断言） | 重构（尤其 `demo.html` 结构调整/A2 脚本拆分）仍可能大面积误报；5 个 JSDOM 装载文件不可归因，其覆盖率未被门禁约束 | 将文本断言逐步替换为行为断言；为 JSDOM 装载文件补充可归因装载路径 |
| med | `web-data/` 超高 churn（机器人自动提交） | `.codebase-scan.txt:400-403`（90 天：1824/1823/1588 次） | 仓库噪声、merge 冲突、误触发 CI、audit 失真 | 将镜像产物迁出主仓（独立分支/仓库或 Actions 产物），或降低提交频率（批量聚合） |
| med | 无 APM / 集中错误上报 | `INTEGRATIONS.md`（观测性仅 `console` + 本地 `audit_log`） | 线上失败不可见，只靠用户反馈发现 | 接入最小化错误上报（可复用现有群机器人/审批通道）或结构化日志落盘 |
| low | Bitable 更新限流（10 QPS/表） | `docs/DESIGN_V110_BITABLE.md:120-128` | 规模化写入时可能触发限流、丢更新 | 保留现有退避重试；写入批处理/排队，监控限流错误码 |
| low | localStorage 明文存配置/账号/审计 | `js/16-audit.js`；`docs/ARCHITECTURE.md:25` | XSS 可读取本地数据 | 敏感字段加密或缩短留存；收敛 XSS 面（内容转义） |

### 2) Technical Debt

| Debt item | Why it exists | Where | Risk if ignored | Suggested fix |
|-----------|---------------|-------|-----------------|---------------|
| 无测试框架、自研 runner | 单页应用轻量起步，避免引入依赖 | `scripts/run_all_tests.js`；`tests/*` | 断言风格不一、无标准报告/覆盖率；套件随版本膨胀 | 保持现状但在 runner 中统一输出为 TAP/JUnit，便于 CI 消费 |
| 49 套件串行执行 | 换取失败容忍与清晰输出 | `scripts/run_all_tests.js:38-88` | CI 时长随套件增长 | 分组并行（按无共享状态分组） |
| 仓库内嵌镜像产物 | 网页端零后端直读 GitHub Pages | `web-data/*`（高 churn） | 主仓体积/噪声膨胀 | 镜像产物独立托管或裁剪保留 |
| 根因文档与实现脱节 | 重写方案先行、实现未落地 | `docs/ARCHITECTURE.md`、`REWRITE_PROPOSAL.md` | 认知负担、错误决策 | 在文档顶部标注「提案/未落地」状态 |
| 版本号多源硬化历史 | 曾写死版本导致反复发作 | `version.json:20-45`（修复记录） | 升版遗漏 | 已改为动态读取，补充一致性测试覆盖（`test:version`） |
| `.trae`/多 AI 工具镜像目录 | 多 AI 客户端各自维护规则副本 | `.codebase-scan.txt`（`.adal/.agents/.aider-desk/.augment/.autohand` 等 lark 技能镜像） | 配置漂移、噪声 | 已落地（仅本地）：单一真源 `.agents/skills` + `120000` 软链同步；`scan:skills`/`sync:skills` 收敛脚本按决策**不入库**、仅本地保留 |

### 3) Security Concerns

| Risk | OWASP category (if applicable) | Evidence | Current mitigation | Gap |
|------|--------------------------------|----------|--------------------|-----|
| 历史密钥泄露（飞书 Secret / keystore） | A02 Cryptographic Failures / A05 Security Misconfiguration | `SECURITY.md:24`；`docs/CICD使用说明.md:73` | 已在平台轮换；`secret-scan.js` 阻断新泄露；`git-filter-repo` 已重写历史并强推，泄露令牌/keystore/`.uploads` 从全历史清零（复核 `exit=1` 干净） | 已闭环；协作方需重新克隆/硬重置以同步重写后的历史 |
| 客户端密钥注入可逆（XOR+base64） | A02 Cryptographic Failures | `SECURITY.md:17-20`；`scripts/inject_build_secrets.js` | 运行期读后 `delete`、不落 localStorage | XOR 为混淆非加密；逆向可还原 App Secret（移动端固有难题，需以最小权限/轮换缓解） |
| 公开镜像数据隐私 | A01 Broken Access Control / 隐私 | `SECURITY.md:35-44`；`js/09-web-sync.js` | linkKey=PBKDF2，明文 phone/密码不外泄 | 依赖人工保证脱敏，缺发布前自动脱敏校验 |
| localStorage 明文敏感数据 | A02 / A07 | `js/16-audit.js`；`docs/ARCHITECTURE.md:25` | 本地存储，隔离于其他源 | XSS 场景可读；审计日志留存策略未明 |
| 无集中安全事件监测 | A09 Security Logging Failures | 仅 `secret-scan` + 审计日志 | CI 扫描、删除告警 | 无运行时安全告警/SLO 上报 |

### 4) Performance and Scaling Concerns

| Concern | Evidence | Current symptom | Scaling risk | Suggested improvement |
|---------|----------|-----------------|-------------|-----------------------|
| 飞书 API 全局限速（150ms/并发 3） | `version.json:11-15` | 大批量同步变慢 | 数据量增长时同步时长线性上升 | 分批/增量同步、夜间窗口、必要时申请更高配额 |
| 单文件全量备份到 Drive | `README.md:159-171` | 每次备份传整包 JSON | 数据膨胀致单文件过大、上传失败 | 分卷/增量/压缩 |
| 测试套件串行 | `scripts/run_all_tests.js` | CI 耗时叠加 | 套件增多后 CI 超时 | 分组并行 |
| `web-data/` 频繁全量提交 | `.codebase-scan.txt:400-403` | 仓库/网络开销 | 长期仓库膨胀 | 降低提交频率或迁出主仓 |
| PWA 缓存优先策略（历史致旧 JS 常驻） | `version.json:45`（已修） | 曾长期加载旧版 | 用户端版本滞后 | 已随 `sw.js` 缓存名升版修复，需持续回归 |

### 5) Fragile/High-Churn Areas

| Area | Why fragile | Churn signal | Safe change strategy |
|------|-------------|-------------|----------------------|
| `web-data/*`（镜像产物） | 机器人自动全量重写，非手改 | `.codebase-scan.txt:400-403`（1824/1823/1588） | 不手工编辑；改动走生成脚本 + 脱敏门禁 |
| `demo.html` | 单文件承载大量 UI/逻辑，测试以文本断言它 | `.codebase-scan.txt:404`（92 次） | 改动后跑 `test:logic`/`test:cross`；避免无谓结构重排 |
| `version.json` | 版本/配置/同步参数多源汇聚 | `.codebase-scan.txt:405`（79 次） | 升版走一致性脚本，勿手改多处 |
| `config.xml` | Cordova 构建配置，改动即影响打包 | `.codebase-scan.txt:406`（74 次） | 变更后跑构建/门禁；小步验证 |
| `js/00-bootstrap.js` | 启动/常量/全局状态汇聚 | `.codebase-scan.txt:408`（48 次） | 改动需评估全局依赖（隐式全局变量） |
| `js/*.js` 隐式全局互引 | 模块间共享作用域，重写/拆分易断链 | `docs/ARCHITECTURE.md:80` | 拆分需同步 `DEMO_BLOCKS` 依赖序与测试 |

### 6) `[ASK USER]` Questions（已全部由用户确认并处置）

> 状态：7 项问题均已获用户答复，下方记录「决策 → 处置」映射。✅=已落地（本表 7 项现已全部完成）。

| # | 问题 | 用户决策 | 处置状态 |
|---|------|----------|----------|
| 1 | 历史泄露的飞书 App Secret 与签名 keystore 是否已轮换作废？是否安排 git 历史清理？ | **已轮换作废**，安排 git 历史清理 | ✅ 已完成：`git-filter-repo` 重写历史（2223 提交改写/1 提交剔除），泄露令牌 `s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb` 与全部 `.uploads/*`、keystore/`.jks` 已从全历史清零；已强推远端并复核（`main = 5c982646`，密钥扫描 `exit=1` 干净） |
| 2 | `docs/ARCHITECTURE.md` 的 Capacitor+Vite+TS 重写是「已决定执行」还是「仅提案」？ | **作废**（未落地提案） | ✅ 已在 `docs/ARCHITECTURE.md` 顶部标注「作废/未落地」 |
| 3 | `web-data/` 镜像数据发布到公开 GitHub Pages 是否已通过隐私评审？是否加自动脱敏门禁？ | **不确定是否通过隐私评审**，加入自动脱敏门禁 | ✅ 已落地 `scripts/check_web_data_sanitization.js` 并接入 CI |
| 4 | 是否引入行覆盖率（如 c8）作为验收线？ | **引入行覆盖率作为验收线** | ✅ 已落地：c8 + `test:coverage-gate`（可归因 ≥95%，实测 99.38%） |
| 5 | 生产环境是否接受「无 APM/集中错误上报」的现状？ | **接受**现状 | ✅ 维持现状；不接入集中错误上报/APM |
| 6 | 主仓内 `.adal/.agents/.aider-desk/.augment/.autohand` 等多 AI 工具镜像目录是否收敛为单一真源？ | **按建议处理** | ✅ 已落地（仅本地）：单一真源 `.agents/skills`（28 个技能）+ `120000` 软链镜像 54 处；消除 `agent/skills` 550 文件重复真源；`scan:skills`/`sync:skills` 收敛脚本按决策**不入库**、仅本地保留（不接入 CI） |
| 7 | 是否有明确的规模化目标（用户/车辆量级）用于判断优化优先级？ | **没有** | ✅ 不设规模化路线图；优化按现状风险排序 |


### 7) Evidence

- `docs/codebase/.codebase-scan.txt:399-419`（高 churn 清单）、`:424-429`（代码度量 1483 文件/172233 行）
- `SECURITY.md:22-44`（已知泄露与轮换、CI 防护、镜像隐私）
- `docs/CICD使用说明.md:73`（keystore 轮换建议）
- `README.md`（版本已修正为 10.20.0）vs `version.json:2`（10.20.0）
- `docs/ARCHITECTURE.md:1-3,80`（Capacitor+Vite+TS 重写已标注作废 / 隐式全局变量难点）
- `docs/DESIGN_V110_BITABLE.md:120-128`（Bitable QPS 限流）
- `scripts/secret-scan.js`、`scripts/validate_web_assets.js`、`.github/workflows/secret-scan.yml`
- `scripts/check_coverage_threshold.js`（行覆盖率硬门禁，`MIN_LINES_PCT = 95`）、`tests/coverage-attribution.js`（c8 归因 filename 改写）、`scripts/check_web_data_sanitization.js`（镜像脱敏门禁）
- `js/16-audit.js`、`js/09-web-sync.js`、`scripts/sync_web_data.js`
- 历史清理复核：`git filter-repo` 2.47.0 重写结果 `filter-repo/commit-map`（total=2224 / unchanged=0 / pruned=1 / rewritten=2223）；强推后远端 `git ls-remote` → `5c982646… refs/heads/main`、`1543bc2d… refs/tags/v10.20.2`；`git grep -I -l 's35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb' 5c982646` 退出码 1（无命中）；`rev-list --objects` 全历史无 `.uploads/`、`.jks`、`.keystore` 路径

## Extended Sections (Optional)

### 文档-实现偏差汇总（跨文档一致性）

| 文档断言 | 实现事实 | 结论 |
|----------|----------|------|
| `README.md` 当前版本 V10.11.0 | `version.json` 10.20.0 | ✅ 已修正（README 更新为 10.20.0） |
| `docs/ARCHITECTURE.md` Capacitor+Vite+TS | Cordova + Vanilla JS 单页 | ✅ 已标注为「作废/未落地提案」 |
| `tests/README.md` 一键回归 `npm test` | `package.json` 无 `test` 脚本 | 指引命令无效，应为 `npm run test:all` |
| 扫描结论「生产代码无 TODO/FIXME」 | 确无 | 债务以文档偏差/高 churn/基建耦合形式存在，而非 TODO 标记 |

### 优先级建议（非约束，含落地进度）

1. ✅ 安全项已完成：轮换已确认，且 git 历史已用 `git-filter-repo` 清理并强推远端（事项 1）；遗留动作是从其他客户端重新克隆/硬重置以同步重写后的历史。
2. ✅ 文档偏差：README 版本已修正；`docs/ARCHITECTURE.md` 已标注作废（事项 2）。
3. ✅ 镜像隐私门禁：`scripts/check_web_data_sanitization.js` 已接入 CI（事项 3）；`web-data/` churn 治理待定。
4. ✅ 行覆盖率验收线已落地：c8 + `test:coverage-gate`（可归因 ≥95%，实测 99.38%，事项 4）；可观测性按用户决策维持现状、不接入 APM（事项 5）。
5. ✅ 多 AI 工具镜像目录收敛为单一真源（事项 6）：`.agents/skills` 为真源，54 处镜像为 `120000` 软链；`scan:skills`/`sync:skills` 收敛脚本按决策**不入库**、仅本地保留（不接入 CI）；`agent/skills` 550 文件重复真源已消除。
6. ✅ 不设规模化路线图（事项 7）；剩余优化按现状风险排序。
