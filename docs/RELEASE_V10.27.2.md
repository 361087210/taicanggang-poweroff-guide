# V10.27.2 — 修通依赖升级的 CI（没有密钥不该算失败）

## 一句话
dependabot 的 6 个依赖升级 PR 一直全红，根因不是代码坏了，而是 CI 把"没有 secrets"当成了失败；本版修掉它，让 18 个依赖漏洞（9 high）的升级能真正落地。

## 根因
`ci.yml` 第 38 步「Secret注入基线校验」只在 `github.event.pull_request.head.repo.fork == true` 时降级。
dependabot 的 PR 来自**同仓库分支**（不是 fork），因此不降级 → 拿不到 `FEISHU_*` → `inject_build_secrets.js --check` 退出 1 → CI 红 → PR 卡死。

## 改动
- CI 的注入校验一律 `FEISHU_STRICT: '0'`：这一步在 CI 里只验证「注入脚本可用 + 仓库无明文密钥」，不注入真实值；
- 真实注入仍只发生在 `android-release.yml` / `ios-release.yml`（严格模式不变，缺 secrets 直接失败）——降级没有外溢到发版链路；
- 步骤名改为「Secret注入基线校验(CI 不注入真实密钥, 缺失仅告警)」，并在注释里写下这次故障的来龙去脉，避免后人改回去。

## 验证
- 新增 `tests/test_v10272_ci_pr_secrets.js`（15 断言），含**反面用例**：把 `FEISHU_STRICT` 换回旧写法必须被套件抓住。
- 全量测试 73/73 通过。

## 影响
无用户可见变化；仅 CI 行为。发版产物与 v10.27.1 功能等价。
