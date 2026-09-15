# 后续待办清单（PENDING ISSUES）

> 最后更新：2026-09-15 12:40。按优先级排列，每项附最小修复路径。

## P0 — 安全（最高优先）

### 1. phoneH 可枚举还原（架构级）—— 已修复 ✅
- **旧现状**：`phoneH = sha256(SALT + phone)`、`SALT='tcg-web-2026'` 公开在 `js/00-config.js`，手机号空间（~10^10）可离线枚举还原。
- **修复**：连接键改为 `linkKey = PBKDF2(password, LINK_SALT + '|' + phone, 100000)`，熵来自密码，仅凭 phone 无法枚举。客户端在拿到明文密码的瞬间派生并透传，镜像端只透传不重算；网页端换设备登录用「手机号+密码」派生 linkKey 匹配镜像（命中即密码验真），存活守卫/云端组员列表改按 id 匹配。
- **存量账号**：惰性迁移——安卓端登录时若本地账号无 linkKey 则补算并回推云端，下次镜像生成即带上 linkKey，该账号即可网页端登录。
- **关联**：受影响用户（手机号曾公开）需通知改密码，通知方式待用户确认。

### 1.1 发布节奏错配：网页端跟 `main`、App 跟 tag/发布 —— 无门禁拦（**本次故障系统性根因**）⚠️
- **事实**：网页端（GitHub Pages）随 `main` 自动更新；App（APK/IPA）只随 **tag/Release** 更新。若把代码提交进 `main` 却**未升版本号 / 未打标签**，网页端立即拿到新逻辑，而 App 最新发布版永远拿不到 → **两端静默错配**；且现有门禁（七源一致性 / CI 覆盖率）**都拦不住**——它们只校验"同一时刻各版本源彼此一致"，**不校验"线上 App 发布版是否已包含 `main` 的行为"**。
- **本次实例**：P0(phoneH→linkKey) 在 **v10.19.1 打标签之后**才进 `main`，且**未升版本号**。于是 v10.19.1 的 App 仍是 phoneH 旧方案，而网页端（跑 `main`）已要求 linkKey → 存量账号永远无法完成惰性迁移 → 网页端长期报"账号或密码错误"，直到 **v10.19.2 发布**才解。
- **阳性对照（字节级，v10.19.1）**：`js/09-web-sync.js` 内 `phoneH`=7 次、`linkKey`=0 次；`js/02-auth.js`、`js/00-bootstrap.js` 内 `deriveLinkKey`/`linkKey` 均 0 次。v10.19.2 的 `js/02-auth.js` 内 `deriveLinkKey`=3、`linkKey`=29 次。
- **附带教训（本轮已修）**：源码注释曾写"P0(>=10.19.1)"——把首次发布版本号记错，并**据此误导了运维操作步骤**。注释与事实不符比没有注释更危险。
- **最小修复路径（待裁定）**：① 任何触碰 `js/` 或行为语义的提交**必须同批升版本号**（哪怕 patch）；② CI 增门禁"`main` 相比上一个 tag 若有 `js/**` 变更却 `APP_VERSION` 未变 → FAIL（或先做粗粒度告警）"；③ 成本最低：发布/PR 流程强提示"改 `js/` 必 bump"，并在 RELEASE 说明标注本版行为变化。

### 1.2 版本归属事实基线（**证据留存**；判版本归属必须拉该标签真实内容，勿按发布说明推断）
> **方法纪律**：判断"某改动属于哪个发布"，**必须**用 `git show <tag>:<path>` 拉该标签的**真实文件内容**核对，
>   不可依据 `version.json` / RELEASE 文档 / 源码注释的文字描述推断 —— 本轮即因按注释/发布说明推断，
>   误把 P0 归属到 10.19.1（并据此给出了错误的运维步骤）。
- **v10.19.1 已上线**：账号表**字段白名单**（`web-data/approved_users.web.json` 内
  `fieldAllowlist = [id, name, phoneH, role, status, created]`、`droppedFields = [phone, password, pw_ts]`）
  —— 即"去掉明文手机号 + 密码哈希"的隐私修复。
- **v10.19.2 才上线**：`phoneH → linkKey` 去盐化（`deriveLinkKey`，客户端 PBKDF2 派生）。
- **证据（可复现）**：
  - `git show v10.19.1:web-data/approved_users.web.json` → allowlist 含 `phoneH`；dropped 含 `phone/password/pw_ts`；
  - `git show v10.19.1:scripts/sync_web_data.js` → `linkKey`=0 次、`phoneH`=15 次；
  - `git show v10.19.1:js/02-auth.js` → `deriveLinkKey`=0、`linkKey`=0。

### 1.3 10.19.3「诊断版」独立发布配方（可直接执行；**尚未执行**，待用户拍板）
> 目的：让用户**只更新一次**即同时拿到「修复(linkKey 迁移) + 诊断(加密能力自检 / 两种失败提示)」。
> 纪律：全程在 `release/10.19.3`，**不 push、不打 tag**，直到用户点头。

**A. 要独立发布的提交（叠在 F0-c 之上，需 cherry-pick 到 main）**
- `921fddc` 提交组A（加密能力自检 + 迁移失败两因区分）
- `db21274` F0-a（反馈「APP版本」字段）
- **不要包含** `718d0ce` / `2ff1964`（F0-c）——F0-c 运行期依赖飞书「状态」选项（未补），带了会红。

**B. cherry-pick 到 main 的冲突与解决**
- `git checkout main && git cherry-pick db21274 921fddc`
- 唯一预期冲突：`package.json`（A 的片段上下文含 F0-c 的 `test:process-feedback`）。解决：
  - `scripts` 增一行 `"test:crypto-capability": "node tests/test_crypto_capability_ux.js",`
  - `test:all` 目标行（**照抄**）：
    `... && npm run test:v1033 && npm run test:feedback-version && npm run test:crypto-capability && npm run test:cross`
    （含 `test:feedback-version`(F0-a) 与 `test:crypto-capability`(A)，**不含** `test:process-feedback`）

**C. 七源版本号 10.19.2 → 10.19.3（原子同改；versionCode 101902 → 101903 = 10×10000+19×100+3）**
| 源 | 位置 | 目标 |
|---|---|---|
| `config.xml` | `:2` | `version="10.19.3" android-versionCode="101903"` |
| `version.json` | `:2/:3/:4` | `10.19.3` / `101903` / `downloadUrl` 指向 `v10.19.3` |
| `release/version.json` | `:2/:3/:4` | 同上（镜像，保持一致） |
| `sw.js` | `:11` | `const CACHE_NAME='tcg-poweroff-v10.19.3';` |
| `demo.html` | `:338` | `id="sync-local-ver">v10.19.3` |
| `js/00-bootstrap.js` | `:1310` | `const APP_VERSION='10.19.3';` |
| `js/11-about.js` | `:11` / `:487` | VERSION_HISTORY 头新增 `V10.19.3` 条目 / 兜底字面量 `'10.19.3'` |
- ⚠️ **禁止全局替换 `10.19.2`**：仓库另有**历史引用**（`js/02-auth.js`、`js/09-web-sync.js`、`scripts/sync_web_data.js` 注释；`tests/test_v1033`、`tests/test_crypto_capability_ux` 说明）指「P0 首次发布 = 10.19.2」——误改会制造新的**错误版本归属**（与 §1.2 同类坑）。
- ⚠️ `tests/test_v1033_linkkey_migration_ux.js:39-40` **写死** `EXPECT_VER='10.19.2'` / `EXPECT_CODE='101902'` → 升版必红。二选一：(a) 同步改常量；(b) **推荐** 改为从 `version.json` 推导（只校验"七源彼此一致"，与 `test_v1017` E组 同款，以后免维护）。

**D. Release 正文硬前置**
- 生成 `docs/RELEASE_V10.19.3.md` —— `android-release.yml:202` / `ios-release.yml:263` 的
  `body_path: docs/RELEASE_V<config.xml version>.md`，**缺文件发版必失败**。
- `version.json` / `release/version.json` 的 `releaseNotes` **必须含 10.19.3 条目**（`tests/test_v1017` E7 校验）。

**E. 验收命令**
```
node scripts/check_version_consistency.js   # 七源一致 + versionCode===encode(version)
npm run test:all                            # 全绿(含 test:crypto-capability / test:feedback-version)
node scripts/check_ci_coverage.js
node scripts/validate_web_assets.js
```
**F. 发布动作（仅用户点头后）**：推 main → **紧邻**推 `git tag v10.19.3`（避免 `version.json.downloadUrl` 指向空资产的窗口）→ 验收 7 条（两条 release workflow / 两个资产 / `curl -I` 非 404 / `sync-release-feishu` / `deploy-pages` 且 demo.html 哈希变化 / 登录页实测 / `git status`）。

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
- ✅ **P0 phoneH→linkKey 架构级脱敏**：连接键改用 PBKDF2(password, LINK_SALT|phone)，镜像不再含可枚举的 phoneH；网页端三使用点(换设备登录重建/存活守卫/云端组员)改 linkKey+id 匹配；存量账号惰性迁移（**勘误：实际随 v10.19.2 发布；v10.19.1 不含 P0，详见 §1.1**）

## 已结案（无需再处理）
- **CI-011**：工程师 + QA 独立全盘搜索均确认不存在（编号记错）。已抽成常驻断言 `test_v1019_repo_hygiene.js` S4。
- **sw.js 缓存名漂移**：误报，实为 meta.json 数据镜像版本。真正漂移 `js/11-about.js` 兜底 10.15.0 已修。
