# CI/CD 使用说明

> 落实优化方案「问题5：版本号保持不变重新生成产物，双端同步规范化」。本仓库已配置两条 GitHub Actions 流水线，实现"代码合入即校验、打标签即出正式签名包"。

## 流水线总览

| 流水线 | 触发条件 | 作用 | 文件 |
| ------ | -------- | ---- | ---- |
| **CI** | 每次 push / PR | 资产校验 + 凭证泄露扫描 + 映射表漂移检测 | `.github/workflows/ci.yml` |
| **Android Release Build** | 推送 `v*` 标签 / 手动触发 | 全量重编译 + Secrets 签名 + 发布 GitHub Release | `.github/workflows/android-release.yml` |

## 一、CI 校验关卡（自动运行）

每次代码变更自动执行 `scripts/validate_web_assets.js` 与 `scripts/gen_media_mapping.js --check`，任一失败即阻断合入：

1. 核心文件存在性（demo.html / vehicles_data.js / vendor / vehicle_images）
2. JavaScript 语法校验（vehicles_data.js 可解析）
3. demo.html 关键能力标记（离线依赖 / httpFetch / 数据分仓 / 返回键路由）
4. JSON 合法性（version.json / 映射表）
5. **凭证泄露扫描**（GitHub PAT / 飞书 Secret / 签名密码字面量）
6. 签名密钥未入库检查（.gitignore 排除项）
7. **映射表漂移检测**（docs/vehicle_media_mapping.json 必须与 vehicles_data.js 一致）

本地等价命令（提交前自查）：

```bash
node scripts/validate_web_assets.js
node scripts/gen_media_mapping.js --check
```

## 二、首次配置 Secrets（一次性）

进入 仓库 → **Settings → Secrets and variables → Actions → New repository secret**，添加 3 项：

| Secret 名 | 内容 | 生成方式 |
| --------- | ---- | -------- |
| `KEYSTORE_BASE64` | 签名密钥 base64 | 在持有密钥的机器执行：<br>Linux/Mac: `base64 -w0 release/keystore/tcg_release.keystore`<br>Windows PowerShell: `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release\keystore\tcg_release.keystore"))` |
| `KEYSTORE_PASSWORD` | keystore 密码 | 与 keyPassword 共用，仅本人保管 |
| `KEY_ALIAS` | 密钥别名 | 默认 `tcg_release` |

## 三、日常发布流程

```bash
# 1. 提交代码(CI 自动跑校验)
git add . && git commit -m "feat: xxx" && git push

# 2. 打标签触发正式构建
git tag v5.3.2
git push origin v5.3.2

# 3. 到 Actions 页查看构建，完成后 Release 页自动出现签名 APK
```

手动试构建（不发布）：Actions → Android Release Build → Run workflow → 勾选 `dry_run`。

## 四、构建号策略（版本号不变也可区分产物）

落实优化方案"使用独立构建号 buildNumber 区分产物"：

- `android-versionCode = 50300 + run_number`（唯一递增，避免覆盖安装冲突）
- 产物命名：`taicanggang-V5.3-b{run_number}.apk`
- `version.json` 自动回写 `buildNumber` 与 `buildDate` 并提交（APP 内多源版本探测读取该文件）
- 每次构建在全新虚拟机执行，天然零缓存，满足"每次构建前清理缓存"

## 五、双端同步目标分离

| 渠道 | 存放内容 | 同步方式 |
| ---- | -------- | -------- |
| GitHub Release | **正式产物**（签名 APK） | 流水线自动上传 |
| 飞书云「APP数据备份」 | **内部测试产物** + 用户数据 | `scripts/sync_feishu_v53.py` 手动/单独推送 |
| Git 仓库 | 源代码 + 文档（**无二进制、无密钥**） | git push |

> V5.3.1 起签名密钥与 APK 已从 git 跟踪中移除（本地文件保留）。历史提交中仍存在旧密钥，**建议在 V5.4 轮换签名密钥**（生成新 keystore + 更新 Secrets + 全量重装），彻底消除历史泄露影响。

## 六、故障排查

| 现象 | 处理 |
| ---- | ---- |
| CI 报"映射表与源数据不一致" | `node scripts/gen_media_mapping.js` 重新生成后提交 |
| CI 报"含 keystore 密码明文" | 检查是否误写字面量密码，应使用 `$VAR` 环境变量 |
| Release 构建报缺 KEYSTORE_BASE64 | 按第二节配置 Secrets |
| 版本探测显示旧 buildNumber | 检查 version.json 回写提交是否成功（Actions 日志 "提交构建号" 步骤） |
