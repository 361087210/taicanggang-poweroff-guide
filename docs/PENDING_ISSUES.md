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

**附：版本字面量分类表（**处理任何"版本号"前先分类，禁止一刀切全局替换**）**
| 类别 | 例子 | 判定依据 | 处理 |
|---|---|---|---|
| 期望值（写死真实版本） | 原 `tests/test_v1033:39-40` `EXPECT_VER='10.19.2'` | 断言"某处应等于该版本" → 升版必红 | **改为从 `version.json` 推导** + 配**变异自证** |
| 自洽 fixture（输入） | `test_v110_audit:92/151`、`test_v1014:140`、`test_v1015:133`、`test_v1023:45` | 把版本喂进去再断言往返，与真实版本无关 | 保留（升版不会红） |
| 历史/归属引用（正确事实） | "P0 首次发布=10.19.2"、`V10.x 修复` 注释、各 `RELEASE_V*.md` | 描述已发生的事实 | 保留（误改 = 制造新的错误归属） |
| **活代码里的版本常量** | 原 `sync_release_both_roots.py:18` `APP_VERSION="10.17.1"` | 被用于**命名/拼路径** → 输出会带旧版本 | **改为从 `version.json` 读**（见 §1.4） |
| 已是动态（范式） | `test_v1019_version_gate.js`、`sync_release_to_feishu.py` | 从单一真源推导 + 含变异自证 | 参考 |

### 1.3 10.19.3「诊断版」独立发布配方（可直接执行；**尚未执行**，待用户拍板）
> 目的：让用户**只更新一次**即同时拿到「修复(linkKey 迁移) + 诊断(加密能力自检 / 两种失败提示)」。
> 纪律：全程在 `release/10.19.3`，**不 push、不打 tag**，直到用户点头。

**A. 要独立发布的提交（**精确清单**：按序 cherry-pick 到当时的 `origin/main` tip）**
> `release/10.19.3` 相对 `f254205` 共 **15** 个提交；其中 **3 个不入本次发布**（1 个已在 main、2 个是 F0-c），
> 故**实际要重放的是下面这 12 个**（顺序即依赖序）：
1. `db21274` F0-a（反馈「APP版本」字段）
2. `cc6acd6` P0 版本归属更正 + §1.1（纯注释/文档）
3. `5b557ce` §1.2 版本归属事实基线（纯文档）
4. `921fddc` **提交组A**（加密能力自检 + 迁移失败两因区分）
5. `b9060a6` §1.3 发布配方（纯文档）
6. `b2404f3` `test_v1033` 期望值改动态推导 + 变异自证
7. `6770791` **`docs/RELEASE_V10.19.3.md`**（`body_path` 硬前置）
8. `eaef20b` 发版工具链修复（Feishu 目录名 / 迁移 `syncVersion` 改读 `version.json`，见 §1.4）
9. `7d1cf11` **未登录导航守卫**（注册页返回泄漏 R1+R2+R3+R4，见 §1.5）
10. `0c9ac5f` 环境纪律文档（纯文档）
11. `6b04935` **七源版本号 10.19.2→10.19.3**（versionCode 101903）+ releaseNotes/VERSION_HISTORY
12. **`CHANGELOG.md` 补 10.19.2 / 10.19.3 两条**（本条提交，位于 `6b04935` 之后；内容自 `docs/RELEASE_V10.19.2.md` / `RELEASE_V10.19.3.md` 提炼）

**不入本次发布的 3 个**：
- `44fb793`（注册改引导语 + 删登记令牌）—— **已在 main**（由 team-lead 以 `e7b5869` 重放推送），**勿重复 cherry-pick**（内容相同，会报 empty/冲突）。
- `718d0ce` / `2ff1964`（**F0-c**）—— 运行期依赖飞书「状态」选项（未补），带入会让 `ai-feedback` cron 在 main 上失败；**继续留在分支**。

**B. cherry-pick 到 main 的冲突与解决**
- `git checkout main && git cherry-pick db21274 921fddc`
- 唯一预期冲突：`package.json`（A 的片段上下文含 F0-c 的 `test:process-feedback`）。解决：
  - `scripts` 增一行 `"test:crypto-capability": "node tests/test_crypto_capability_ux.js",`
  - `test:all` 目标行（**照抄**）：
    `... && npm run test:v1033 && npm run test:feedback-version && npm run test:crypto-capability && npm run test:cross`
    （含 `test:feedback-version`(F0-a) 与 `test:crypto-capability`(A)，**不含** `test:process-feedback`）

**B2. ★发版前如何确认「某提交的改动已在 main」—— 不要用祖先关系判断**
> `cherry-pick` / `replay` 会**新生成对象**，所以原提交**当然不是**新提交的祖先 —— 用
> `git merge-base --is-ancestor <原提交> <main>` 判断「改动是否已上线」**从原理上就是错的**（本项目实测踩过）。
> 要**比内容**，不比对象：
```
# 方法一(推荐): patch-id 相同 = 同一改动
git show <原提交>          | git patch-id
git show <main 上的提交>   | git patch-id     # 两行第一列相等 → 同一改动

# 方法二(直观): 对该提交改动的每个文件逐个比内容, 全部无输出 = 完全一致
for f in $(git show --pretty= --name-only <原提交>); do
  git diff --stat <原提交>:"$f" <main>:"$f"
done
```
> ⚠️ 注意：若 main 上还有**其他未重放的提交**也动过同一文件，方法二会显示**非空 diff** ——
> 此时要确认差异**只来自那些未重放的提交**。实例：`44fb793` 与 `e7b5869` 的 **patch-id 相同**
> （`18010065…`），逐文件仅在 `js/09-web-sync.js` 差 **3 行**，而那 3 行正是**尚未重放的 `cc6acd6`** 的注释改动。

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

### 1.4 发版工具链里写死版本号（`v10.17.1`）—— 已判定**活代码**，已修
- **`scripts/sync_release_both_roots.py:18`** `APP_VERSION = "10.17.1"` → **活代码**：
  - 该文件 `from sync_release_to_feishu import (...)` **未导入** `APP_VERSION`，反而在下方**自带同名常量覆盖**；而基座 `sync_release_to_feishu.py:30-36` 是**从 `version.json` 动态读取**的（正确）。
  - 该常量在 `:29` 被用于 `get_or_create_folder(..., f"v{APP_VERSION}")` → **命名飞书目录**；`:30/:91` 打印同名。
  - **链路**：`.github/workflows/sync-release-feishu.yml:62`（`workflow_run`，**每次发版后自动跑**）执行本脚本 → 于是**每次发版的产物都被传进名为 `v10.17.1` 的飞书目录**（旧根+新根两处），因 `delete_if_exists` 还会**反复覆盖同一目录**（无按版本留档）。即：文件是新的、**目录名是旧的**。
  - **实际影响**：飞书端浏览发版产物的人会看到 `发版产物/v10.17.1/` 里装着 10.19.2 的 APK → 误导；且丢失按版本留档。
  - **修法**：改为从基座导入 `APP_VERSION`（单一真源，动态读 `version.json`），删除本地写死常量。✅ 已在本轮修复。
- **`scripts/migrate_drive_to_bitable.js:110`** `const APP_VERSION = '10.17.1'` → **活代码但不在 CI**（npm `migrate:bitable`，操作员手动跑）：
  - 在 `:120` 用作 `syncVersion: APP_VERSION` → **把陈旧版本号写进每条迁移记录**（`syncVersion` 参与同步仲裁）→ 一旦运行即污染整批数据。
  - **修法**：改为模块级 `JSON.parse(fs.readFileSync(path.join(REPO,'version.json')))` 读取。✅ 已在本轮修复。
- **教训**：CHANGELOG 里这些脚本一直被列入"发版版本号同步清单"，但**从 10.17.1 起被漏更**（清单靠人工，漏了就静默漂移）。→ 建议把"脚本内版本常量"也纳入门禁（与 §1.1 的"改 js 必 bump"同源问题）。

### 1.5 注册页"返回泄漏"—— 定性 **display-only**，已修（R1+R2+R3+R4）
- **现象**（用户报）：注册界面按返回（App 硬件返回键 / 网页浏览器返回，同一 handler）后自动进入"组长账号已登录"的界面；两端均可复现。
- **定性（关键）**：**仅界面渲染，不具组长能力**。该路径 `state.currentUser===null` → `isLeader()/canEdit()` 均 false（`js/02-auth.js`）→ 成员管理菜单/FAB 隐藏、组长逻辑不触发。片中"组长"二字来自 `demo.html` **硬编码占位**（原 `:394-395`）+ `updateMyInfo()` 在无用户时**直接 return** 未清空。
- **根因**：R1 `js/08-main.js` `handleHardwareBack()` **缺 `screen-register`/`screen-forgot` 分支** → 落 `goBack()`；R2 `js/01-state.js` `goBack()` **无登录守卫**且空栈兜底固定回 `screen-vehicles`（真正根因是"兜底兜到了需登录页"）；R3 硬编码占位；R4 `showScreen()` 未拦"已登录进登录族"。
- **修复不变量**（R2 核心）：**任何导航路径，在 `state.currentUser` 为空时都不得落在应用内页面**（统一收口，兼顾脏栈；已登录用户行为不变）。
- **回归防线**：新增 `tests/test_nav_login_guard.js`（jsdom+真实函数提取；**先红后绿**：修复前 11 项红、其中 B1 实测落 `screen-vehicles`、B7 实测 `name=组长/role=组长` 精确复现原 bug）。
- **⚠️ 附带发现（要记住的教训）：缺陷被测试钉住了。** `tests/test_v57_logic.js`(2.4–2.8) 与 `tests/test_v53_runtime.js`(优先级6/R4) **用"未登录"前置却断言"回到主界面/vehicles"** —— 它们之所以长期通过，**正是因为当时缺了登录守卫**（= 本次泄漏的同一根因）。即：**旧测试把 bug 行为固化成断言**，修好代码的同时必须改这些前置，否则"修了反而全红"。已补真实前置（显式置入登录用户、用后归还 `null`）并注明原因，语义不变。
  → **方法论**：当修复让一批旧测试变红时，先判断它们测的是"正确行为"还是"被固化的缺陷行为"，**不要把断言改回去迁就代码**。

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

## 环境纪律（本环境 `.git` 不可信）—— 每条都是踩出来的
1. **任何"会移动分支指针"的操作都不可信**：`commit` / `merge` / `reset` / `checkout -B` 均实测出现"**命令报成功但 ref 未落盘**"。最近一例：`git fetch` 明确打印 `047aa9a..ea4258a  main -> origin/main`，而紧接着的 `git show-ref` 里 `origin/main` **仍是 `047aa9a`**（remote-tracking ref 更新同样会丢）。
2. **一律"三重核验"，绝不相信命令成功回显**：① 操作后**手动落盘 ref**（`printf '%s\n' "$NEW" > .git/refs/heads/<branch>`）；② `git show-ref` 复核本地；③ **`git ls-remote`（服务端权威）复核远端**。
3. **不能用 `git rev-parse HEAD` 判定"新提交是否落盘"**：坏 ref 下 `HEAD` 与 ref 同源、会自洽地指向旧提交 → 误报 "OK"。新 sha 应取自 **`git commit` 的输出**，或 `git rev-parse <显式短 sha>`。
4. **手写 ref 必须用 `git rev-parse` 取完整 40 位、且 LF-only**（CRLF 会让 git 报 `bad ref …?`）；`packed-refs` 同样 LF-only。**切勿**把 `refs/remotes/origin/main` 写成**本地** main 的 sha —— 那会让 `git push` 报 `Everything up-to-date` 的**静默 no-op**（安全提交实际没推送）。
5. **`checkout`/`reset` 后复核工作树**：本环境出现过整目录被丢（`.github/`、`docs/`、`tests/` 一次消失 72 项）；修复：`git checkout -- .`。
6. **最小可用"重放+推送"解法（team-lead 已验证）**：
   `git checkout -B main <远端 tip>` → `git cherry-pick <我们的提交>` → **手动写 `.git/refs/heads/main`（LF）** → `git show-ref` 复核 → `git ls-remote` 复核远端 → `git push origin main`（**必须 PAT**：`GITHUB_TOKEN` 不触发下游 Deploy Pages）。
7. 本环境 `fetch`/`push` 会间歇 **502**；`git ls-remote` 可作轻量网络探测。
8. **推论**：远端 main 会被 cron（`chore: 自动同步数据`）持续推进 —— 任何"重放到 main"的计划都要**基于当时的远端 tip**，且用 `ls-remote` 复核，不能假设 tip 不变。

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
