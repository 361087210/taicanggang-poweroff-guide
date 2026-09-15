# 后续待办清单（PENDING ISSUES）

> 最后更新：2026-09-15 12:40。按优先级排列，每项附最小修复路径。

## P0 — 安全（最高优先）

### 1. phoneH 仍可枚举还原（架构级）
- **现状**：`web-data/approved_users.web.json` 已脱敏（无明文手机号/密码哈希），但 `phoneH = sha256(SALT + phone)`、`SALT='tcg-web-2026'` 仍公开在 `js/00-config.js`。手机号空间（~10^10）可离线枚举还原。
- **修法**：改为随机不透明 token（如 `crypto.randomUUID()`），或用服务端加盐的 HMAC。需同步改前端连接键与飞书同步逻辑。
- **关联**：受影响用户（手机号曾公开）需通知改密码，通知方式待用户确认。

## P1 — 数据一致性（工程师 429 中断，未完成）

### 2. 数据一致性/资源完整性 4 项
1. docx/sheets 类型未处理
2. 视频链接数量不符
3. Excel 导出车型名不匹配
4. 车型数量不匹配
- 已派工程师但额度耗尽中断，未落地。需重新派发，每项先红后绿（配测试暴露）。

## P2 — 架构重构

### 3. ESM 化
- 隐式全局变量互引（非 ESM），`js/*.js` 靠 `demo.html` 加载顺序耦合，≥3 套飞书通路。`tests/e2e_harness.js` 的 DEMO_BLOCKS 提取器已加固支持 `export` 前缀，可安全推进。

## P2 — 发布

### 4. 真机模拟测试
- 多维度真机模拟测试（两台手机 + 真实飞书云端场景）尚未执行。Android/iOS 构建已打通（见下"已完成"）。

---

## 已完成（2026-09-15 本轮）

- ✅ **版本迭代 10.19.1 上线**：七源对齐，网页端 + Release + 飞书端全部发布
- ✅ **Android/iOS 安装包构建发布**：修复 setup-android@v3 失效（改用 runner 预装 SDK），APK 17.19MB + IPA 16.22MB 已上传 Release
- ✅ **CI 测试覆盖率 63.8% → 100%**：ci.yml 改用 test:all 聚合入口 + 接入覆盖率门禁（未触达即 FAIL），漏跑的 12 套件全部纳入 CI
- ✅ **jscrambler 模板残留删除**：node-version 20 告警源清零
- ✅ **发布产物行业标准补全**：CHANGELOG 补全 + RELEASE 文档 + body_path 正文 + 飞书同步自动化（workflow_run）
- ✅ **P0 隐私脱敏上线**：approved_users.web.json 无明文手机号/密码哈希（phoneH 架构风险见 P0-1）

## 已结案（无需再处理）
- **CI-011**：工程师 + QA 独立全盘搜索均确认不存在（编号记错）。已抽成常驻断言 `test_v1019_repo_hygiene.js` S4。
- **sw.js 缓存名漂移**：误报，实为 meta.json 数据镜像版本。真正漂移 `js/11-about.js` 兜底 10.15.0 已修。
