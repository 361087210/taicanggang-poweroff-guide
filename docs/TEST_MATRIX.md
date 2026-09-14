# 回归测试矩阵报告（TEST_MATRIX）

> 生成人：QA（Edward） · 生成时间：2026-09-14
> 目的：补齐 `tests/` 回归安全网，作为后续改动巨型模块（demo.html / js/06-media.js / js/05-sync.js）前的基线。
> 仓库：`361087210/taicanggang-poweroff-guide` @ `main`（匿名只读拉取）

---

## 一、同步结论（增量补齐，未删除/未覆盖任何本地文件）

| 项 | 数量 | 说明 |
|---|---|---|
| 远程 `tests/` 条目总数 | **28** | 含 README.md、2 个库模块、3 个 results.json、1 个 .py |
| 本次新下载 | **27** | 全部通过 codeload tarball 一次性拉取，无截断（逐文件校验 `解码体积 == 远程 size`） |
| 同名冲突、保留本地 | **1** | `test_v1017_registration_video.js`（详见下） |
| 下载失败 | **0** | 未触发 GitHub 匿名限流 |
| 本地独有（远程无） | **4** | `test_refactor_v1018.js`、`test_video_playback_v1019.js`、`_probe2~6.js`、`_probe_v1019.js` |

### 同名冲突说明（未覆盖，已保留本地版本）

`tests/test_v1017_registration_video.js` 本地 8819B vs 远程 8793B，diff 结果：

- 本地 **E 组已升级到 V10.19.0**（version.json=10.19.0 / versionCode=101900 / sw.js 缓存名 v10.19.0 …），远程仍停在 V10.17.1 → **远程版本是过期的**
- V10.19.0 起 E 组（以及 test_refactor_v1018.js 的 F8 组）**期望值不再写死版本号**，改为从 `version.json` 动态推导：测试只校验"各处是否一致"，不再随升版整组变红（此前每次发版都要人工改测试，属反复发作的坏味道）
- 本地 **B1 断言更健壮**（拆成 `includes('tcg-registration-inbox') && includes('/contents/registrations')`）

✅ 结论：**保留本地版本正确，不要回滚**。远程 `main` 分支的这份测试已落后一个版本，建议后续回推。

---

## 二、测试矩阵

图例：🟢 全通过 · 🔴 有失败 · ⏭️ 跳过 · ⚪ 非测试入口
「本地原有」= 同步前就在本地的文件（未做任何修改）

| # | 文件 | 体积 | 本地原有 | 语法 | 能否运行 | 通过/失败 | 覆盖功能域 |
|---|---|---:|:---:|:---:|:---:|:---:|---|
| 1 | test_v1010_solutions_comparison.js | 21673 | | ✅ | ✅ | 9 / 0 🟢 | 同步(方案选型/分片上传/校验) |
| 2 | test_v1010_sync_e2e.js | 26335 | | ✅ | ✅ | 18 / 0 🟢 | 同步(E2E闭环/组长→组员) |
| 3 | test_v1011_feedback_sync.js | 23904 | | ✅ | ✅ | **49 / 2** 🔴 | 同步(反馈多端同步)**/导出脱敏** |
| 4 | test_v1011_mirror_sync.js | 12505 | | ✅ | ✅ | 6 / 0 🟢 | 同步(网页镜像/增删改混合) |
| 5 | test_v1013_a3.js | 24357 | | ✅ | ✅ | 69 / 0 🟢 | 架构(渲染分离/State守卫/写入收敛)、审批 |
| 6 | test_v1014_zero_config_member.js | 29306 | | ✅ | ✅ | 49 / 0 🟢 | 注册/审批(零配置成员、注入秘钥、横幅状态机) |
| 7 | test_v1015_member_sync_gate.js | 22323 | | ✅ | ✅ | 50 / 0 🟢 | 同步(成员门禁/配置出口统一/安全守卫) |
| 8 | test_v1016_self_learning.js | 11231 | | ✅ | ✅ | 32 / 0 🟢 | UI(排序自学习/手势引擎/视频预取)、版本 |
| 9 | test_v1017_registration_video.js | 8819 | **✔** | ✅ | ✅ | 51 / 0 🟢 | 注册(拒绝通知/状态同步)、**视频(直链映射/封面)**、上传命名、版本 |
| 10 | test_v103_fixes.js | 17665 | | ✅ | ✅ | 62 / 0 🟢 | 分享/缓存/审批(组员守卫)/同步屏 |
| 11 | test_v104_fixes.js | 13272 | | ✅ | ✅ | 46 / 0 🟢 | **视频(播放标记/已播放徽标)**、全屏退出 |
| 12 | test_v105_fixes.js | 16843 | | ✅ | ✅ | 49 / 0 🟢 | 分享(原生文件)、保存目录/权限、导出 |
| 13 | test_v106_fixes.js | 14240 | | ✅ | ✅ | 33 / 0 🟢 | 持久化(降级不抛错) |
| 14 | test_v107_fixes.js | 16460 | | ✅ | ✅ | 31 / 0 🟢 | 同步(分片上传/自动同步/云端更新感知) |
| 15 | test_v108_fixes.js | 10899 | | ✅ | ✅ | 20 / 0 🟢 | 注册(人工审批文案)、上传(multipart) |
| 16 | test_v109_fixes.js | 10654 | | ✅ | ✅ | 17 / 0 🟢 | 导出/导入(备份/确认弹窗回调) |
| 17 | test_v110_audit.js | 11509 | | ✅ | ✅ | 31 / 0 🟢 | 审计(本地留痕/删除告警节流/Bitable上报/清理) |
| 18 | test_v110_bitable_data_access.js | 13828 | | ✅ | ✅ | 24 / 0 🟢 | 同步(Bitable 读写分层/兜底/重试队列) |
| 19 | test_v53_runtime.js | 9469 | | ✅ | ✅ | 21 / 0 🟢 | 运行时(媒体迁移/返回键状态机/**视频源链回退**/导航栈) |
| 20 | test_v57_logic.js | 16414 | | ✅ | ✅ | 34 / 0 🟢 | 配置(注入秘钥/安全基线)、版本一致性 |
| 21 | test_refactor_v1018.js | 6730 | **✔** | ✅ | ✅ | 36 / 0 🟢 | 配置单一真源、账号可见性、**网页镜像**、安全治理、版本 |
| 22 | test_video_playback_v1019.js | 20433 | **✔**(新) | ✅ | ✅ | 47 / 0 🟢 | **视频(封面/迭代后播放/网页端播放)**、上传按车型命名、安全红线 |
| 23 | test_v57_cross_network.js | 14364 | | ✅ | ⏭️ **跳过** | — | 跨网络真机（**需 TCG_FEISHU_APP_SECRET + 真实飞书 API**） |
| 24 | test_v57_integration.py | 7891 | | ✅ (py_compile) | ⏭️ **跳过** | — | 集成（**需 TCG_FEISHU_APP_SECRET**） |
| 25 | e2e_harness.js | 14450 | | ✅ | ⚪ 库模块 | — | 测试基建（源码提取器 + vm 沙箱），非测试入口 |
| 26 | mock_feishu_server.js | 14999 | | ✅ | ⚪ 库模块 | — | 飞书 Mock 服务，非测试入口 |
| 27 | README.md / v1010_e2e_results.json / v1010_solutions_results.json / v1011_mirror_sync_results.json | 10661 | | — | ⚪ 非测试 | — | 文档与历史结果产物 |
| — | _probe2.js / _probe3.js / _probe4.js / _probe5.js / _probe6.js / _probe_v1019.js | — | **✔** | ✅ | ⚪ 临时探测脚本 | — | 真实 GitHub 网络探测，**非回归测试**，不计入矩阵 |

### 汇总

- **可执行测试文件：22 个**，其中 🟢 全通过 **21 个**、🔴 有失败 **1 个**
- **总断言：786 条** → 通过 **784**、失败 **2** → **通过率 99.7%**
  （失败 2 条均为问题 1 的源码缺口 A7/A10，非测试缺陷；问题 2 的 F10a 已修复转绿）
- **语法检查：27/27 个 JS 文件全部 `node --check` 通过**，Python 文件 `py_compile` 通过
- **跳过：2 个**（需飞书凭据 + 真实网络，且 `test_v57_cross_network.js` 含对远端文件的 **DELETE** 操作，具破坏性，禁止在 CI/本地自动执行）

---

## 三、发现的问题

### 🔴 问题 1（源码缺口，需 Engineer 处理）：`scripts/sync_web_data.js` 未实现反馈表镜像与字段脱敏

**失败断言**（`tests/test_v1011_feedback_sync.js`）：

```
✗ A7 sync_web_data.js 反馈表镜像(FEEDBACK_APP_TOKEN分页拉取)
✗ A10 镜像脱敏: 含问题描述(V10.16.7),不含联系方式/设备信息字段
```

**判定依据（非测试写错）**：

- `FEEDBACK_APP_TOKEN` 在全仓库（含 .md/.json）**仅出现在该测试断言里**，源码从未实现 → 断言指向的是设计文档已承诺的能力
- `docs/RELEASE_V10.15.11.md:58` 明确记载：「scripts/sync_web_data.js：新增反馈表镜像（分页拉取+脱敏，不含问题描述/联系方式/设备信息）」
- 现状：`sync_web_data.js` 只从**飞书 Drive 目录** `feishuDownloadJson(token, folderToken, 'feedback_data.json')` 整包透传，**没有任何字段级白名单**
- 实测产物佐证：`web-data/feedback_data.json` 目前是 `{"items": []}`（空），即网页端反馈镜像实际上是**不工作的**

**附带风险（隐私）**：`web-data/` 是会被发布出去的**公开静态资源**。当前透传写法一旦拉到真实反馈数据，会连同「联系方式 / 设备信息」一并导出到公网，与 A10 的设计约束直接冲突。**建议优先修，不要等反馈数据灌进去才发现。**

**路由建议**：→ Engineer（源码缺口），非 QA 改测试。

---

### ✅ 问题 2（已修复）：secret-scan 把 3 处「测试占位符」判为密钥泄露

**处理方案①（逐行 `noqa:secret`，不整目录排除）**，已落地：

| 文件 | 行 | 处理 |
|---|---:|---|
| tests/test_v1014_zero_config_member.js | 413 | 行尾追加 ` // noqa:secret` |
| tests/test_v1015_member_sync_gate.js | 58 | 行尾追加 ` // noqa:secret` |
| tests/test_v57_logic.js | 229 | 行尾追加 ` // noqa:secret` |

仅加注释，**未改动任何断言逻辑**；三文件 `node --check` 全部通过。
附带修复：本报告（docs/TEST_MATRIX.md）因原文引用了这三个字面值，自身也触发了扫描，已在对应 3 行加 `noqa:secret`。

**自证结果**：
1. `node scripts/secret-scan.js .` → `未发现密钥泄露, 通过 ✓`，exit=0，3 处假阳性全部消失
2. `test_refactor_v1018.js` F10a **转通过**（35/1 → **36/0**）
3. **反向测试通过**：向 `tests/` 植入一个「32 位随机串形态、写法与真实 appSecret 完全一致」的假密钥字面量（探针文件 `tests/_tmp_secret_canary.js`，字面量形式 `appSecret: '<32位随机串>'`）→ 扫描器 **仍成功拦截**（exit=1，命中 `tests\_tmp_secret_canary.js`），证明 `noqa` 只豁免标注行、**未把 tests/ 变成盲区**；探针文件已删除，复扫恢复 exit=0
   > 注：此处刻意不抄录探针字面量原文 —— 本文件是会被 secret-scan 扫描的，抄录会再次触发规则（已踩过一次坑）。
4. 全套安全网重跑，通过率 **未回退**（99.6% → 99.7%）

**豁免机制结论**：`secret-scan.js` 按行过滤 `/noqa:secret/i`，作用域严格限于标注行，实现正确，无需修复。

**附：核查中发现的一个「历史凭据」记录**（非新泄露）—— `test_refactor_v1018.js:25` 与 `SECURITY.md:24` 含 32 位串 `s35nEpUBk8KtxN3Kwl2AEgUNnwXQHABb`。经核对，这是 `SECURITY.md`「已知泄露与轮换」章节**主动记录并已轮换作废**的旧飞书 App Secret，两处均已带 `noqa:secret`，属项目有意为之，无需处理。

`test_refactor_v1018.js` 的 F10a 断言执行 `scripts/secret-scan.js`，当前 **失败**：

```
[secret-scan] 发现疑似密钥泄露:
- appSecret literal assignment  @ tests\test_v1014_zero_config_member.js:413  appSecret: 'admin_saved_secret_override' // noqa:secret
- appSecret literal assignment  @ tests\test_v1015_member_sync_gate.js:58    appSecret: 'SEC_INJECTED_1015_secret' // noqa:secret
- appSecret literal assignment  @ tests\test_v57_logic.js:229                appSecret:'test_secret_for_jsdom_injection_32' // noqa:secret
```

**判定：全部是假阳性**，三处均为 jsdom 注入用的假字符串，**未发现任何真实 appSecret 硬编码**（已用正则 `appSecret[:=]['"][A-Za-z0-9]{8,}` 全量复扫，零命中；真实 Secret 均走 `process.env.TCG_FEISHU_APP_SECRET`）。

**未擅自修改**（按约定交你决策）。两种处理方式：
1. 在这 3 行加 `noqa:secret` 豁免（脚本自带该机制，官方推荐写法）
2. 把 `tests/` 加入 secret-scan 排除目录

推荐 **方案 1**（保留测试目录的扫描能力）。在这之前 `npm run test:refactor` 会一直是红的。

---

### 🟡 问题 3（环境，已修复）：`node_modules` 为空导致 10 个 jsdom 测试全挂

首次运行 10 个测试统一报 `请先安装: npm i jsdom`（退出码 2）。已执行 `npm install jsdom`（256 个包，`jsdom@^29.1.1`，与 package.json 一致）。修复后这 10 个测试全部转绿。
`node_modules/` 已在 `.gitignore` 中，不会污染仓库。**注意：换机器/CI 前必须先装依赖，否则回归网会假性全红。**

---

### 🟡 问题 4（低风险，备案）：测试内硬编码内部标识符

`tests/test_v57_cross_network.js:30` 硬编码了飞书 `appId: 'cli_aa0ce4fd91f85be8'` 与 `folderToken: 'nodcnGA95g93RhIUSdCeTkhKlQc'`。
**非密钥**（appId/目录 token 属标识符，Secret 走环境变量），且该测试本就跳过不执行。仅备案，供你判断是否要从测试里抽走。

---

### ⚪ 副作用核查结论

- 运行前后 `web-data/` 五个文件 mtime 未变 → **无脏数据写入**
- 仅 `tests/v1010_*.json`、`v1011_*.json` 被测试自身重写（这是测试设计内的产物输出，正常）
- 未在仓库根目录产生 flog/debug/临时文件

---

## 四、回归用法

```bash
# 1. 首次/换机必做
npm install          # jsdom 缺失会导致 10 个测试假性失败

# 2. 跑全量（package.json 已定义的 test:all，注意它会连带跑需凭据的 test:cross）
npm run test:all

# 3. 只跑安全网（推荐日常用，跳过需飞书凭据的）
for f in tests/test_v*.js tests/test_refactor_v1018.js; do node "$f" || echo "FAILED: $f"; done

# 4. 需要飞书真机验证时（务必人工确认，会 DELETE 远端文件）
export TCG_FEISHU_APP_SECRET=<secret>
node tests/test_v57_cross_network.js
python tests/test_v57_integration.py
```

**动巨型模块前的基线**：本文档第二节的 22 个可执行测试 = 786 条断言 = 99.7% 通过率（唯一红灯是问题 1 的 A7/A10 源码缺口）。改动后若掉到 20 个全绿以下，即为回归。

---

## 五、遗留（未下全的部分）

**无。** 远程 28 个条目全部到本地（27 下载 + 1 保留本地较新版），无因限流/截断导致的缺失。
真正的遗漏项在**远程侧**：本地 `test_refactor_v1018.js`、`test_video_playback_v1019.js` 尚未回推到 GitHub `main`，建议提交时一并带上，否则下一个人克隆仓库仍拿不到这两份最新测试。
