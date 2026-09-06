# V10.15.10 开发日志

**日期**: 2026-09-06
**范围**: 网页版分享降级链 + signal 跨 realm 存量缺陷修复 + 发版迭代

---

## 一、需求与背景

用户需求（本轮原始输入）：
1. 多轮多维度尝试网页版能否实现调用系统分享面板
2. 给网页版增加自动下载降级（不支持系统分享时自动下载文件）
3. 增加复制链接/文本降级（针对文本类分享）
4. 保持现有 Web Share API 优先逻辑不变

## 二、多轮多维度实测过程（浏览器 E2E）

| 轮次 | 测试内容 | 结果 |
|------|---------|------|
| 1 | `navigator.share` / `navigator.canShare` 可用性 | **undefined**，Web Share API 完全不可用 |
| 2 | 实际导出流程（PDF/CSV） | 文件生成成功，但分享失败、无下载、无新标签 |
| 3 | `<a download>` 触发下载 + Clipboard API | 下载未触发；`clipboard.writeText` undefined |
| 4 | `window.open(blobURL)` / `location.href` / msSaveBlob | window.open 可用且安全；location.href 破坏性导航；msSaveBlob undefined |
| 5 | PDF/Excel/Word 三格式降级验证 | **全部成功触发下载，返回 true** |

**结论**: 该环境系统分享面板不可调起，需下载降级链兜底。

## 三、RCA：signal 跨 realm 兼容缺陷（本次发版的关键发现）

**现象**: 安装 jsdom 补齐测试依赖后，test:cross 暴露 7 项 FAIL（组长拉取申请 pulled=0、审批链路全断）。

**根因链**:
1. V10.9.0 起下载链路（fetchPendingFromCloud / downloadJsonFromFolder）使用 `AbortController` 超时
2. jsdom 沙箱中页面 realm 的 AbortController signal 传入 Node undici fetch（跨 realm）
3. undici 抛 `TypeError: Expected signal to be an instance of AbortSignal`
4. 旧代码无捕获该形态，per-file `catch(e){continue;}` 静默吞掉 → 拉取 0 条
5. 历史上未暴露：测试链在 test:logic 因缺 jsdom 提前中止，test:cross 从未真正跑过

**修复**（js/05-sync.js `fetchSignalSafe`）:
- 首试带 signal；捕获后以 `e.name==='TypeError' && /AbortSignal/i.test(message)` 判定，去 signal 重试
- **踩坑记录**: 第一版用 `e instanceof TypeError` 判定——跨 realm 错误对象原型链不同，instanceof 恒 false，修复无效。必须用 `e.name` 字符串属性（跨 realm 可靠）
- 超时 AbortError 照常抛，调用方语义不变

**修复前后对比**:

| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| test:cross | 9 通过 / 7 失败 | **16 通过 / 0 失败** |
| 组长拉取申请 | pulled=0 | pulled 正常 |
| 审批闭环 | user not found locally | ok:true |

## 四、文件级摘要

| 文件 | 改动 |
|------|------|
| js/03-vehicles.js | shareFile 增三级下载降级链；文本分享 execCommand 保底 |
| js/05-sync.js | 新增 fetchSignalSafe 垫片；两处 fetch 调用点接入 |
| js/09-web-sync.js | _fetchMirror 改用垫片（10s 超时语义保留） |
| js/11-about.js | VERSION_HISTORY 头部插入 V10.15.10 |
| version.json / release/version.json | 版本+releaseNotes |
| config.xml / js/00-bootstrap.js / sw.js / demo.html | 三源对齐 10.15.10/101510 + CACHE_NAME |
| scripts/sync_release_both_roots.py / migrate_drive_to_bitable.js | APP_VERSION |
| .github/workflows/ios-release.yml | default 版本 |
| tests/test_v103_fixes.js | A3/B1-4/B1-5 断言按新需求更新（旧断言编码的是 V10.3「禁止下载降级」需求） |
| tests/e2e_harness.js | DEMO_BLOCKS 增 fetchSignalSafe |
| tests/test_v1013_a3.js | E 组沙箱注入清单增 fetchSignalSafe |
| tests/test_v110_audit.js | 版本断言 10.15.10 |

## 五、测试矩阵

| 测试 | 结果 |
|------|------|
| test:version | ✅ 10.15.10/101510 |
| validate_web_assets | ✅ 全过（凭证扫描 140 文件） |
| gen_media_mapping --check | ✅ 73 条一致 |
| test:all（含 test:cross 真实飞书云端） | ✅ 552 PASS / 0 FAIL |
| 浏览器 E2E 降级验证 | ✅ PDF/Excel/Word 全触发下载 |
| 双端 Release CI | tag v10.15.10 触发构建 |

## 六、版本一致性附录

- config.xml: version=10.15.10, android-versionCode=101510
- version.json: version=10.15.10, versionCode=101510
- js/00-bootstrap.js: APP_VERSION='10.15.10'
- 联动: sw.js CACHE_NAME / 11-about.js / ios-release.yml / 双脚本 APP_VERSION / 审计断言 全部同步
