# 参与开发 / 发布流程（Team Conventions）

> 目标：**任何人任何时候都能回答「线上跑的是哪一版、为什么是这一版」**。

## 1. 分支与提交

- `main` 受保护：**只能通过 PR 合并**（要求 CI `Web资产与安全校验` + `Secret Scan` 通过、线性历史、禁 force push）
- 分支命名：`feat/<主题>`、`fix/<主题>`、`chore/<主题>`
- 提交信息用 Conventional Commits：`feat|fix|perf|refactor|docs|test|chore(scope): 说明`
- 允许直推的特例只有：**仓库管理员**（应急）与**GitHub Actions 数据流水线**——两者都必须留下可见记录（workflow 日志 / PR 说明）

## 2. PR 自检

见 `.github/pull_request_template.md`。核心三条：
1. `npm run test:all` 全绿
2. 动 `js/` 必升版本号（七源一致，见 `scripts/check_version_consistency.js`）
3. 新测试断言**行为**，不要断言"源码里有这行字"

## 3. 发版流程（缺一步就会失败）

1. 升七源版本：`config.xml` / `version.json` / `release/version.json` / `js/00-bootstrap.js` / `sw.js` / `demo.html` / `js/11-about.js`（+ `package.json` 建议同值）
2. 写 `docs/RELEASE_V<版本>.md` —— Android/iOS 发版 workflow 的 `body_path` **硬前置**，缺文件必失败
3. `CHANGELOG.md` 增一节
4. 打 annotated tag `v<版本>` 并 push
5. 发版后检查：Android/iOS 构建、Release 资产（apk/ipa/sha256）、飞书「发版产物/vX」四件、Pages 线上版本号

> **tag 一经发布不可移动**（仓库已开 tag 规则集）。打错了就发下一个 patch 版本，不要 `tag -f`。

## 4. 数据与媒体

- 车型数据唯一真源 = 飞书云盘 `APP数据备份/同步数据/vehicle_sync_data.json`
- 派生数据一律由脚本生成，不手改：`gen_vehicles_data` / `gen_media_mapping` / `gen_media_library`
- 媒体路径规则唯一真源 = `js/00-media-paths.js`（车型目录 / `_共享` / `_未归类`）
- 车型改名后跑一次 `node scripts/migrate_vehicle_rename.js --apply`（同步流水线已自动执行）
- 媒体只是车型信息的**补充**：缺图/缺视频不得影响车型功能；删除车型**不删文件**

## 5. 可观测性

- 前端崩溃/异常由 `js/17-error-report.js` 捕获（本地环形缓冲 ≤20 条，PII 掩码），
  用户可在「我的 → 复制诊断信息」导出；每小时最多自动上报 1 条到飞书反馈表
- 数据同步失败会自动开 issue（`[auto] web-data 镜像同步失败`），恢复后自动关闭

## 6. 本地开发

```bash
npm ci
npm run test:all          # 70+ 套件
npm run test:coverage     # 行覆盖率
node scripts/check_version_consistency.js
npm run build:tailwind    # 改了模板里的 class 必须重建 CSS
```
