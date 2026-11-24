## 变更说明

<!-- 一句话说清"为什么改"和"改完用户能感知到什么" -->

## 类型

- [ ] 功能（feat）  - [ ] 修复（fix）  - [ ] 性能（perf）  - [ ] 重构（refactor）
- [ ] 文档（docs）  - [ ] 测试（test）  - [ ] 流水线/工程（chore/ci）

## 自检清单（缺一项就别提 PR）

- [ ] `npm run test:all` 全绿（70+ 套件）
- [ ] `node scripts/check_version_consistency.js` 通过（动了 `js/` 必须升版本号）
- [ ] 新增/修改的测试**断言的是行为**，不是"源码里有这行字"
- [ ] 涉及媒体/车型数据的改动：`node scripts/fix_shared_refs.js --verify`、`node scripts/gen_media_library.js --check` 通过
- [ ] 涉及发版：`docs/RELEASE_V<版本>.md` 已写（发版流程的 `body_path` 硬前置）
- [ ] 没有把密钥/手机号/密码哈希写进仓库或日志（`npm run scan:secrets`）

## 风险与回滚

<!-- 影响面、是否需要数据迁移、出问题怎么回滚（revert PR / 重发版本） -->
