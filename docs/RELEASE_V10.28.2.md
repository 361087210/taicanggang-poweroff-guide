# V10.28.2 更新提示修复版

> 一句话：按飞书《开发文档 V5.3.3》的更新分发章节逐条核对，核心判定没问题，
> 修掉两处「一旦触发就 404」的直链兜底，并让发版流程真正回写安装包体积。
> v10.28.1 因 tag 指向工作流语法损坏的提交而未出包，本版重发。

## 为什么做这一版

对照《太仓港断电指导APP开发文档V5.3.3》3.2 / 4.2 / 4.3 / 4.4 四节核对更新提示：

| 项 | 结论 |
| --- | --- |
| 3.2 多源探测（4 源、8 秒超时、取最高、非首个成功） | 与文档一致 |
| 4.2 L1 `downloadUrl` / L2 `apkUrl`（过滤 V5.3 断链） | 与文档一致 |
| 4.2 L3 兜底命名 | **不一致**：代码仍用 `taicanggang-V{ver}-b{build}.apk`，实际产物是 `tcg_poweroff_v{ver}.apk` |
| 4.3 弹窗主按钮 | 文档写「直链→系统浏览器」，现为主「应用内下载并安装」+「浏览器下载安装包」 |
| 4.4 CI 回写 `downloadUrl` | 一致（命名已按新产物） |
| 4.4 CI 回写 `apkSize` | **不一致**：从未回写 |

## 改了什么

### 1. 直链第 3 级兜底改为实际产物命名

`resolveApkUrl` 的三级回退结构不变，只把 L3 的拼法从
`releases/download/v{ver}/taicanggang-V{ver}-b{build}.apk`
改为
`releases/download/v{ver}/tcg_poweroff_v{ver}.apk`。

L3 只在 `version.json` 同时缺 `downloadUrl` 与 `apkUrl` 时生效（换源、手工改、极旧版本），
但写错就是 100% 404，属于必须修的兜底。

### 2. 删掉写死的 v5.7 资产地址

`downloadAndInstallApk` 之前带一个写死的 `.../download/v5.7/tcg_poweroff_v5.7.0.apk` 作为最后兜底——
该 Release 资产早已不存在。现在解不出直链时明确提示「未取到下载地址，请稍后在「检查更新」重试」，
并把按钮恢复为可重试状态。

### 3. 发版回写 `apkSize`

更新弹窗会读 `version.json` 的 `apkSize` 决定是否显示「安装包大小：xx」，但发版流程只回写
`downloadUrl` / `version` / `versionCode`。现在 Android 发版在重写 version.json 的同一步，
按实际 APK 字节数写入 `"apkSize": "16.7MB"`（字段缺失时插入，存在时原地替换），实现为纯 `sed`，无 heredoc。

## ⚠️ 发版事故：v10.28.1 未出包

- v10.28.1 打 tag 后 Android 工作流立即失败，run 里 0 个 job —— 新增的回写步骤用了顶格书写的 heredoc，
  把 YAML 块标量打断，整个工作流文件无法解析（GitHub 只能显示文件路径作名字）。
- 发布 tag 受保护、不可移动，按既定规则不重打 10.28.1，改为升 **10.28.2**。
- 该步骤改写为纯 `sed`；推送前用 `js-yaml` 本地校验工作流可解析，并单独模拟了「字段缺失 → 插入」分支。

## 升级与兼容

- 无接口变更，`version.json` 结构向后兼容（`apkSize` 为新增可选字段）
- 更新弹窗、跳过、静默检查行为与 V10.28.0 完全一致

## 已验证

- `test:v10285-update-prompt` 19 → **26 断言**全绿：新增 L1/L2/L3 三级回退、V5.3 断链过滤、
  无版本返回 null、`apkSize` 回写接线、写死旧资产已移除
- `check_version_consistency` / `check_ci_coverage` 通过；工作流 YAML 本地解析通过

## 待办（文档侧，本版未改）

飞书《开发文档V5.3.3》需要同步更新：4.2 的 L3 命名、4.3 的按钮结构、4.4 的字段清单。
