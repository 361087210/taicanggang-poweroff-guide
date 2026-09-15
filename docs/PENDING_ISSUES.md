# 后续待办清单（PENDING ISSUES）

> 生成时间：2026-09-15。以下问题已确认存在或待推进，但按用户指令「先版本迭代、其余备注后续解决」暂缓。每项附最小复现/修复路径，供后续直接接手。

## P0 — 安全

### 1. phoneH 仍可枚举还原（架构级）
- **现状**：`web-data/approved_users.web.json` 已脱敏（无明文手机号/密码哈希），但 `phoneH = sha256(SALT + phone)`、`SALT='tcg-web-2026'` 仍公开在 `js/00-config.js`。手机号空间（~10^10）可离线枚举还原。
- **修法**：改为随机不透明 token（如 `crypto.randomUUID()`），或用服务端加盐的 HMAC。需同步改前端连接键与飞书同步逻辑。
- **关联**：受影响用户（手机号曾公开）需通知改密码，通知方式待用户确认。

## P1 — CI/工程

### 2. CI 测试覆盖缺口（63.8%）
- **现状**：`.github/workflows/ci.yml` 逐个 `npm run test:xxx` 手串 14 个入口，漏跑 12 个套件（含版本门禁 `test_v1019_version_gate`、视频 `test_video_playback_v1019`、CRUD `test_v1020`、守卫 `test_v1021` 等）。
- **已备好**：`scripts/check_ci_coverage.js` 门禁（未接 CI，仅入库）。当前红色基线：`测试文件 29 | 已覆盖 16 | 未覆盖 12`。
- **接入步骤**（转绿需同时满足两点，缺一仍红）：
  1. `ci.yml` 把 14 行逐个 `test:xxx` 整体换成一行 `npm run test:all`
  2. `package.json` 补 `test:v1021-guard` script 并接进 `test:all` 链；加 `test:ci-coverage` script，ci.yml 加一步跑它
- **前置**：`test_v57_cross_network.js` 缺凭据已改 `exit 0`（本版已含），可直接切换。

### 3. jscrambler 工作流应删除
- **现状**：`.github/workflows/jscrambler-code-integrity.yml` 是 GitHub 模板残留。五重证据：无 `build` 脚本、无 `jscrambler.json`、无 `dist/`、依赖 3 个未接入的付费服务 secrets、`on: push/PR to main` 每次必失败。
- **额外**：`node-version: 20` 是全仓唯一残留的 Node 20 弃用告警源（其余 workflow 已 22）。删除后全仓 `grep -rn "node-version\|@v3\|@v4" .github/workflows/` 应只剩 22。

## P1 — 数据一致性（4 个严重 bug，工程师 429 中断未完成）

### 4. 数据一致性/资源完整性 4 项
1. docx/sheets 类型未处理
2. 视频链接数量不符
3. Excel 导出车型名不匹配
4. 车型数量不匹配
- 已派工程师但额度耗尽中断，未落地。需重新派发，每项先红后绿。

## P2 — 架构重构

### 5. ESM 化
- 隐式全局变量互引（非 ESM），`js/*.js` 靠 `demo.html` 加载顺序耦合，≥3 套飞书通路。`tests/e2e_harness.js` 的 DEMO_BLOCKS 提取器已加固支持 `export` 前缀，可安全推进。

## P2 — 发布

### 6. 真机模拟 + APK/iOS 构建发版
- 多维度真机模拟测试、Android/iOS 构建（`scripts/build_android.sh` / `build_ios.sh`）、飞书 + GitHub 双通道同步发版，均未执行。

---

## 已结案（供参考，无需再处理）
- **CI-011**：工程师 + QA 独立全盘搜索均确认不存在（我此前编号记错）。已把「它想守的性质」抽成常驻断言 `test_v1019_repo_hygiene.js` S4（测试不得依赖 git 工作区状态）。
- **sw.js 缓存名漂移**：我此前误报，实为 `meta.json` 数据镜像版本 `v10.17.1`（由 cron 每 15 分钟重写，非应用版本）。真正漂移是 `js/11-about.js:440` 兜底 `10.15.0`，本版已修。
