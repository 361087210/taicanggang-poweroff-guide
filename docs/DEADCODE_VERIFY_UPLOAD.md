# 死代码实证报告：00-bootstrap.js 内联上传实现

> 执行人：QA（Edward） · 时间：2026-09-14
> 对象：`src/js/00-bootstrap.js` L461–L685 的「原生文件上传适配层 / 大文件分片上传模块」
> 质疑的注释：源码自称「实现下沉到FeishuAPI」（L514、L524、L573）
> **本轮只核查，未删除任何源码。**

---

## 一句话结论

> **判定：❌ 非死代码（"已下沉到FeishuAPI"这条注释是部分错误的）。**
> 该模块**不可整体删除**：其中 `httpUploadFileSmart` 在 FeishuAPI 中**根本没有对应实现**，且被 05-sync/06-media 的真实上传链路调用；其余内联实现虽然在 App 运行时被委托分支遮蔽，但**它们是 e2e 测试沙箱中真正被执行的代码**（已实测证明）。仅有一个常量 `FEISHU_UPLOAD_ALL_LIMIT` 属于真·未使用，但**它也删不得**——见文末「陷阱」。

---

## 一、静态引用图（证据链 1）

扫描范围：`js/*.js`、`demo.html`、`index.html`、`feishu-api.js`、`tests/*.js`、`scripts/*.js`，全词边界匹配。

| 符号 | 定义处 | App 源码真实调用点（已逐条人工核对，排除注释） | 结论 |
|---|---|---|---|
| `httpUploadFileSmart` | 00-bootstrap.js:672 | **js/05-sync.js:1193**（照片上传）、**js/05-sync.js:1266**（视频上传）、**js/06-media.js:775**（手动上传视频，带 onProgress） | ❌ **非死代码** |
| `httpUploadFile` | 00-bootstrap.js:478 | **js/05-sync.js:20 / :31**（注册申请推送+自愈重试）、**js/05-sync.js:692 / :701**（备份上传+重试）、**js/05-sync.js:861**（JSON上传，3次重试） | ❌ **非死代码** |
| `_sanitizeFeishuFileName` | 00-bootstrap.js:551 | **js/05-sync.js:1185、1193、1254、1266**、**js/06-media.js:736、746** | ❌ **非死代码** |
| `FEISHU_MULTIPART_THRESHOLD` | 00-bootstrap.js:520 | **js/05-sync.js:1263、1326**、**js/06-media.js:758** | ❌ **非死代码** |
| `FEISHU_MULTIPART_MAX` | 00-bootstrap.js:522 | **js/06-media.js:754**（超500MB拦截） | ❌ **非死代码** |
| `httpUploadFileMultipart` | 00-bootstrap.js:608 | 00-bootstrap.js:677、682（被 Smart 内部调用） | ⚠️ 仅内联回退路径 |
| `_adler32` | 00-bootstrap.js:538 | 00-bootstrap.js:635（仅内联分片回退） | ⚠️ 仅内联回退路径 |
| `_feishuQpsGate` | 00-bootstrap.js:529 | 00-bootstrap.js:620、639、653（仅内联分片回退） | ⚠️ 仅内联回退路径 |
| `_uploadPartOnce` | 00-bootstrap.js:572 | 00-bootstrap.js:640（仅内联分片回退） | ⚠️ 仅内联回退路径 |
| `_feishuUploadLastTs` | 00-bootstrap.js:525 | 00-bootstrap.js:530、532（供 `_feishuQpsGate`） | ⚠️ 仅内联回退路径 |
| `FEISHU_UPLOAD_ALL_LIMIT` | 00-bootstrap.js:518 | **无任何 js/ 或 demo.html 引用**（全仓仅 tests/e2e_harness.js:197 与 feishu-api.js:247 各自副本） | ✅ 真·未使用（但删不得，见陷阱） |

**误判排除**：`js/04-export.js:1250` 虽命中 `httpUploadFile`，但经核对是**文档注释**而非调用，不计入调用点。

**demo.html 内联事件专项扫描**（87 条 onclick/onchange 等）：与上传相关的仅 1 条
`demo.html:347 onclick="canEdit()?doSyncUpload():doSyncDownload()"` —— 走的是 `doSyncUpload`，不直接调用上传三兄弟，但会间接进入 `httpUploadFileSmart`。**未发现任何内联事件直接调用本模块函数。**

**动态派发扫描**：全仓 `window['xxx']` / `eval` / `new Function` 检索，**未发现对上传函数的动态名派发**（仅测试用 eval 调其他函数）。故静态引用图可信。

---

## 二、运行时可观察性（证据链 2）

**结论：全部为顶层声明的真全局，可被任意跨文件/内联事件/Cordova 回调按名调用。**

- `00-bootstrap.js` **无 IIFE 包裹**（文件头 L1–L7 起即为 `const PINYIN_MAP` / `function getPinyin` 顶层声明）
- 文件头 L6 自述不变量：*"函数名/签名100%保留, **顶层function声明挂window供onclick裸调用**"*
- 因此 `httpUploadFile*` / `_adler32` 等均为 `window` 属性 —— **这本身就意味着静态 grep 永远无法证明"无调用者"**

**委托分支的运行时取值**：`httpUploadFile`(L479) 与 `httpUploadFileMultipart`(L611) 的 `typeof FeishuAPI!=='undefined'` 判定发生在**调用时**，非加载时。
- demo.html:50 `<script src="feishu-api.js">`（**无 defer**）→ 解析期即执行
- demo.html:642 `<script defer src="js/00-bootstrap.js">`（defer）→ 后执行
- feishu-api.js:1095 `window.FeishuAPI = FeishuAPI;` 无条件赋值
→ **App 运行时 FeishuAPI 必然已定义，委托分支生效，内联回退体不可达**（除非 feishu-api.js 加载失败）。

**但测试沙箱正好相反，且这是硬依赖** —— 见下条实测。

---

## 三、行为等价性核对（证据链 3）

内联实现 vs `feishu-api.js` 对应能力逐项比对：

| 维度 | 00-bootstrap 内联 | FeishuAPI | 等价? |
|---|---|---|---|
| 重试/事务过期逻辑 | L629–651：session 0/1、3次attempt、500×(n+1)退避、1061021整段重传、1061045频控 | feishu-api.js:381–403：完全相同 | ✅ |
| Adler-32 / QPS 220ms 门控 | L538、L529 | feishu-api.js:256、250 | ✅ |
| 成功返回形态 | `{code:0,msg:'success',data:...}` (L660) | feishu-api.js:438 同形 | ✅ |
| 文件名清洗 / onProgress | L609、L650 | feishu-api.js:365、402 | ✅ |
| **错误语义** | **抛异常**（L617/618/626/649/652/659/662） | **捕获并返回 `{code:-1,msg}`**（feishu-api.js:439–441），**从不抛** | ❌ **不等价** |
| **token 来源** | 用调用方传入的 `params.token` | **忽略入参**，内部 `getTenantToken()` 自取（:343、:361） | ❌ **不等价** |
| **prepare/finish 传输层** | 用 `httpFetch`（**Cordova 原生优先，绕 CORS**）(L621、L654) | 用**裸 `fetch`**（:368、:409），**WebView CORS 风险** | ❌ **不等价** |
| **1061043 超限自动升级分片** | 内联 `httpUploadFile` **没有**，升级在调用方 Smart（L680） | `httpUploadFile` **内置升级**（:426–429） | ❌ **不等价** |
| **智能路由能力** | `httpUploadFileSmart`（L672）完整实现 | **FeishuAPI 无对应物**（全仓检索 `httpUploadFileSmart` 未命中 feishu-api.js） | ❌ **FeishuAPI 缺能力** |

> **第 4 条差异的实际影响**：`05-sync.js:20/692/861` 等处是**直接调用 `httpUploadFile`**（不经 Smart）。走 FeishuAPI 时带自动升级，走内联回退时**不带** —— 同一份调用代码在两条路径下行为不同。这正是"未被完全迁移"的证据。

**等价性结论：核心算法已迁移，但错误处理/token/传输层/升级位置 4 处不等价，且智能路由能力 FeishuAPI 根本缺失 → 不满足"三者都等价"，不能判定为确认真冗余。**

---

## 四、决定性实测（运行时证明内联代码真的在跑）

用既有测试基建 `e2e_harness.createAppSandbox` + `MockFeishuServer` 实跑（未修改任何源码）：

```
[1MB]  沙箱内 typeof FeishuAPI = undefined      ← 关键：沙箱里根本没有 FeishuAPI
       typeof httpUploadFile/httpUploadFileMultipart/httpUploadFileSmart/_adler32
              /_feishuQpsGate/_uploadPartOnce/_sanitizeFeishuFileName = function
       httpUploadFileSmart → code=0
       mock.stats = {"uploadAll":1,"prepare":0,"part":0,"finish":0}   ← 内联 upload_all 执行了

[17MB] 沙箱内 typeof FeishuAPI = undefined
       httpUploadFileSmart → code=0
       mock.stats = {"uploadAll":0,"prepare":1,"part":5,"finish":1}   ← 内联分片三件套执行了
       进度回调次数 = 5                                                ← 内联 onProgress 执行了
```

**对照组（人工注入 FeishuAPI 桩）**：
```
注入后 httpUploadFile            → {"code":999,"msg":"DELEGATED_STUB"}      委托分支生效
注入后 httpUploadFileMultipart   → {"code":999,"msg":"DELEGATED_STUB_MP"}   委托分支生效
注入后 httpUploadFileSmart       → {"code":999,"msg":"DELEGATED_STUB"}      Smart 自身无委托，
                                                                            但其路由体仍执行后转调
```

**这组实测同时证明了三件事**：
1. 沙箱内 `FeishuAPI === undefined` → L479/L611 的 `if` 必假 → **内联回退体是实际执行路径**（`uploadAll:1` / `prepare:1,part:5,finish:1` 就是它跑出来的）
2. 委托分支在 FeishuAPI 存在时确实生效（对照组），说明"委托+回退"是**有意设计的双轨**，不是残留
3. `httpUploadFileSmart` **没有自己的委托分支**，它的路由逻辑无论如何都执行

**为什么沙箱没有 FeishuAPI（根因，两条硬证据）**：
- `e2e_harness.js:28–39` `loadCombinedSource()` 只拼 `demo.html` + `js/*.js`，**不包含 feishu-api.js**
- `e2e_harness.js:223–256` sandbox 对象里**没有 `FeishuAPI`** 这一项

---

## 五、⚠️ 给第 3 步 ESM 化的删除陷阱（务必先读）

`e2e_harness.js:194–208` 的 `DEMO_BLOCKS` **按名字**从源码提取这些声明并注入沙箱：

```js
'httpFetch', 'httpUploadFile',
'FEISHU_UPLOAD_ALL_LIMIT', 'FEISHU_MULTIPART_THRESHOLD', 'FEISHU_MULTIPART_MAX',
'_feishuUploadLastTs', '_feishuQpsGate', '_adler32', '_sanitizeFeishuFileName',
'_uploadPartOnce', 'httpUploadFileMultipart', 'httpUploadFileSmart',
```

而 `e2e_harness.js:59`：
```js
if (!m) throw new Error('extractNamedBlock: 未找到 ' + name);
```

**实测**：调用 `extractNamedBlock(src,'THIS_SYMBOL_DOES_NOT_EXIST')` → 抛 `extractNamedBlock: 未找到 ...`。
`createAppSandbox`（L266–269）逐个提取，**任一名字缺失即整体抛错**。

→ **后果：删除上表任一符号（哪怕是从未使用的 `FEISHU_UPLOAD_ALL_LIMIT`），会直接让 3 个测试文件在构造沙箱阶段崩溃**（`test_v1010_sync_e2e.js` 18条、`test_v1010_solutions_comparison.js` 9条、`test_v1011_mirror_sync.js` 6条，共 **33 条断言**）。

**因此第 3 步若要删除任何一项，必须同步修改 `tests/e2e_harness.js:194–208` 的 DEMO_BLOCKS 清单，否则回归网会整体炸掉。** 这正是"名字级耦合"的典型风险点。

---

## 六、判定与建议清单

### ❌ 不可删（有真实调用路径，删了立刻炸）

| 符号 | 行号 | 不可删理由（证据） |
|---|---|---|
| `httpUploadFileSmart` | **672–685** | 05-sync.js:1193/1266、06-media.js:775 真实调用；**FeishuAPI 无对应实现**，删了上传链路直接断 |
| `httpUploadFile` | **478–510** | 05-sync.js:20/31/692/701/861 真实调用（注册推送、备份、JSON上传），均为带重试的核心链路 |
| `_sanitizeFeishuFileName` | **551–567** | 05-sync.js:1185/1193/1254/1266、06-media.js:736/746 真实调用（车型命名功能依赖） |
| `FEISHU_MULTIPART_THRESHOLD` | **520** | 05-sync.js:1263/1326、06-media.js:758 真实引用（路由阈值 + JSON体积守卫） |
| `FEISHU_MULTIPART_MAX` | **522** | 06-media.js:754 真实引用（500MB拦截） |
| `writeBlobToCache` | **693–707** | js/03-vehicles.js:1103 真实调用（本篇顺带核查，非上传模块但相邻，勿误删） |

### ⚠️ 条件性保留（App 内被委托遮蔽，但测试沙箱内**正在执行**；且行为不等价）

| 符号 | 行号 | 说明 |
|---|---|---|
| 内联 `upload_all` 回退体 | **480–509** | 实测 `uploadAll:1` 证明在沙箱执行；与 FeishuAPI 版本在 1061043 升级行为上不等价 |
| 内联分片三件套回退体 | **614–663** | 实测 `prepare:1,part:5,finish:1` 证明在沙箱执行 |
| `_adler32` | **538–546** | 仅回退路径用；但行为与 FeishuAPI 版一致，属可收敛项 |
| `_feishuQpsGate` | **529–533** | 同上 |
| `_uploadPartOnce` | **572–603** | 同上 |
| `_feishuUploadLastTs` | **525** | 同上 |

> 若第 3 步坚持要删这些回退体，**前提**是：① 让 `createAppSandbox` 注入 FeishuAPI（或改用 `createFeishuApiSandbox`）改写 4 个 e2e 用例；② 补齐上文 4 处行为差异。**这是"先改测试基建"的前置工作，不是单纯的删代码。**

### ✅ 真·未使用，但**删它仍需改测试**（唯一可清理项）

| 符号 | 行号 | 说明 |
|---|---|---|
| `FEISHU_UPLOAD_ALL_LIMIT` | **518** | 全仓 js/ 与 demo.html **零引用**；feishu-api.js:247 有自己的独立副本（同样未使用）。删除前必须先从 `e2e_harness.js:197` 的 DEMO_BLOCKS 中移除，否则 33 条断言崩 |

---

## 七、注释错在哪（针对"已下沉到FeishuAPI"）

1. **L514「实现下沉到FeishuAPI」—— 部分错**。下沉的是 `upload_all` 与分片三件套的**算法**；但**智能路由（`httpUploadFileSmart`）根本没下沉**，FeishuAPI 里没有对应函数，它是 00-bootstrap 独有的、被真实调用的活代码。
2. **L524 / L573「保留供测试/老代码引用」—— 这句是对的，但被低估了**。它不是"以防万一"的保留，而是**e2e 测试沙箱的唯一执行路径**（已实测 `FeishuAPI===undefined`），属硬依赖，不是可选兼容层。
3. **"回退分支永不执行"是错的**。它在 App 内被遮蔽，但在 4 个测试文件中每次都在执行。

---

## 八、存疑 / 无法证实的部分（诚实标注）

1. **App 真机运行时委托分支是否 100% 生效** —— 静态与源码层面的证据链完整（feishu-api.js 无 defer 先加载 + `window.FeishuAPI` 无条件赋值），但**未做真机验证**。若 feishu-api.js 在打包产物中缺失或加载失败，回退体就会在真机上运行，届时"未迁移完成的差异"会真实暴露。**标注：需真机确认（不要求凭据，仅需跑一次上传并抓日志）。**
2. **FeishuAPI 版在 Cordova WebView 下的 CORS 表现** —— 其 prepare/finish 用裸 `fetch`（feishu-api.js:368/409），而内联版用原生 `httpFetch`。理论上 Cordova WebView 有 CORS 风险，但**未实测，也需真机/凭据环境才能定论**。标注：**需凭据确认**。
3. `05-sync.js:861` 的 `httpUploadFile` 重试循环（3 次）与 FeishuAPI 内置 1061043 升级叠加后是否存在重复上传——属逻辑冗余嫌疑，但**未在本次核查范围**，不结论。

---

## 九、对第 3 步 ESM 化的建议顺序

1. 先改 `tests/e2e_harness.js`：让 `createAppSandbox` 支持注入 FeishuAPI（已有 `createFeishuApiSandbox` 可参考），把 4 个 e2e 用例切到"走真源"路径
2. 再补 4 处行为差异（错误语义 / token来源 / 传输层 / 升级位置），确保切换后行为不变
3. **最后**才删回退体，并从 DEMO_BLOCKS 移除对应名字
4. `httpUploadFileSmart` 若 ESM 化，需**先为它在 FeishuAPI 侧补一个对等实现**，否则不能删

未完成 1、2 之前，**不要动 L461–L685 的任何一行**。
