# V10.15.3 发版说明: 真实 DeepSeek 分析 + 飞书群通知闭环
发布日期: 2026-09-06  
版本号: 10.15.3 (versionCode=101503)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.15.3  
飞书反馈库: https://mwawzzuvb7f.feishu.cn/base/Gn4db7il9a27QrsOtVbclSE3nnf

---

## 一、版本亮点(一句话给现场组长/组员)

> **本次把「反馈自动分析管道」从内置规则模板升级为真实 DeepSeek LLM 分析——配置 GitHub Secrets 后,每一条待处理反馈都会生成带上下文理解的 AI 摘要;同时修复了飞书群通知推送的参数缺陷,打通「提交反馈 → AI 分析 → 飞书群通知 → 状态闭环回写」全链路,让组员提的每条问题都能被自动分析并实时送达反馈群。无网络/同步逻辑破坏性变更。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🤖AI 分析 | 真实 DeepSeek 分析 | scripts/process_feedback.js | `DEEPSEEK_API_KEY` 配置后走 `deepseekAnalysis()`,调用 DeepSeek `/chat/completions` 生成 AI 摘要;无 Key 时回退 `ruleBasedAnalysis()` 规则模板 |
| 🔔飞书通知 | 群通知闭环修复 | scripts/process_feedback.js | `notify()` 补上 `receive_id_type=chat_id` 查询参数,整改此前推送失败的 `field validation failed` |
| 🔄状态回写 | 状态闭环 | scripts/process_feedback.js | 待处理 → 分析中 → 已解决 三态流转,回写分析摘要与文档链接到飞书 Bitable 反馈表 |
| 🔑凭据配置 | GitHub Secrets | 仓库 Actions Secrets | 新增 `FEISHU_APP_ID` / `FEISHU_APP_SECRET` / `DEEPSEEK_API_KEY` / `FEISHU_FEEDBACK_CHAT_ID` 四项,端到端验证通过 |
| ⚙️发版门禁 | 版本一致性校验 | scripts/check_version_consistency.js | 三处版本一致性 + versionCode 编码约定持续生效 |
| 🧪测试 | test:v110-audit / test:all | tests/ | 全量回归,0 FAIL |
| 📚文档 | 本发版说明 | docs/RELEASE_V10153.md | 发版知识沉淀 |

---

## 三、反馈闭环说明(核心)

- **闭环路径**: 组员提交反馈(待处理) → 定时工作流扫描 → 标记「分析中」 → 调用真实 DeepSeek 生成 AI 摘要 → 回写「已解决」+ 摘要 + 文档链接 → `notify()` 推送飞书反馈群。
- **DeepSeek 与规则模板区别**: 配置 `DEEPSEEK_API_KEY` 后,AI 摘要基于反馈正文做语义理解,输出格式与内置模板明显不同;未配置时安全回退到 `ruleBasedAnalysis()`,确保管道永远可运行。
- **通知修复**: `/im/v1/messages` 必须带 `receive_id_type=chat_id` 查询参数,否则飞书报 `field validation failed`;本次已补齐并端到端验证通过。
- **边界与说明**: 飞书 App Secret 以 Secrets 形式注入工作流运行环境,不进仓库;机器人需有反馈群成员权限,`FEISHU_FEEDBACK_CHAT_ID` 指向反馈群 `oc_...`。

---

## 四、根因与交付说明

- **AI 分析动机**: 规则模板无法理解反馈语义,只能做关键词/板块归类,组长仍需人工阅读正文。V10.15.3 启用真实 LLM,自动生成带上下文摘要,降低人工筛选成本。
- **通知失败根因**: `process_feedback.js` 的 `notify()` 调用 `POST /im/v1/messages` 时缺少 `receive_id_type=chat_id` 参数,飞书拒绝并报 `field validation failed`;补齐后成功推送。
- **版本编码约定**: `versionCode` = `major*10000 + minor*100 + patch`,例: `10.15.3` → `101503`。

---

## 五、验证

1. `node scripts/check_version_consistency.js` → 退出码 0(version=10.15.3, versionCode=101503 三处一致性通过)。
2. `node scripts/validate_web_assets.js` → 全部校验通过(129 个文件,无凭证泄露)。
3. `node scripts/gen_media_mapping.js --check` → 73 条记录与源数据一致。
4. `TCG_FEISHU_APP_SECRET="<app_secret>" npm run test:all` → 退出码 0,`test:v110-audit` PASS=31 FAIL=0。
5. 端到端闭环验证: 真实 DeepSeek 摘要 + 飞书群通知推送成功,测试记录已清理。
