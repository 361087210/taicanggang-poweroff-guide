# V10.15.10 发版说明 —— 网页版分享降级链

**发版日期**: 2026-09-06
**版本号**: V10.15.10 (versionCode=101510)
**发版类型**: 功能增强 + 存量缺陷修复

---

## 一、版本亮点

### 1. 网页版文件导出降级链（核心交付）

多轮浏览器实测（无头 Chromium E2E）确认：大量环境（无头浏览器/微信内置浏览器/旧 WebView）下 `navigator.share` 与 `navigator.canShare` 均为 `undefined`，Web Share API 完全不可用；且部分 WebView 连 `<a download>` 都被拦截。原版此场景下导出直接报错"分享失败：系统分享面板不可用"，用户导出后文件无处可去。

**修复**（js/03-vehicles.js `shareFile()` 末尾新增降级链）：

```
Cordova socialsharing 原生面板（安卓主链路，不变）
  → Web Share API（canShare({files}) 校验，不变）
    → <a download> 原生下载（新增主降级）
      → window.open(blobURL) 新窗口打开（新增备选）
        → navigator.msSaveBlob（旧 Edge/IE 保底）
          → 明确报错提示更换浏览器
```

- 下载成功 Toast「文件已开始下载，可在浏览器下载列表中查看」
- `revokeObjectURL` 延迟 5 秒清理，避免大文件下载中断
- **E2E 实测**: PDF/Excel/Word 三格式全部成功触发下载，返回 true

### 2. 文本分享 execCommand 保底

车辆断电信息文本分享（js/03-vehicles.js）：`navigator.clipboard` 不可用（非 HTTPS/旧 WebView）时降级 `document.execCommand('copy')`，复制成功仍提示已复制。

### 3. Web Share API 优先逻辑不变

原有 `canShare({files})` 校验分支原封未动——降级仅在系统分享彻底不可用时触发，杜绝文本-only 静默降级的老问题回归。

### 4. fetchSignalSafe 垫片（存量缺陷修复）

**根因**: V10.9.0 起下载链路使用 `AbortController` 超时。在 signal 与 fetch 跨 realm 的环境（jsdom 测试沙箱/部分旧 WebView polyfill），fetch 抛 `RequestInit: Expected signal to be an instance of AbortSignal`，导致**云端申请拉取/审批结果下载整链路静默失败**（组长拉取申请 pulled=0）。该缺陷因历史上测试链在 test:logic 提前中止而未被发现，本次装齐 jsdom 后暴露。

**修复**（js/05-sync.js 新增 `fetchSignalSafe(url,opts,timeoutMs)`）：
- 无 AbortController 环境直接裸 fetch
- 带 signal 首试；`e.name==='TypeError'` 且消息含 `AbortSignal` 时去 signal 重试一次（**不可用 instanceof**——跨 realm 错误对象原型链不同，instanceof 恒 false）
- 超时 AbortError 照常抛，调用方语义不变

三处调用点统一接入：`fetchPendingFromCloud`(60s)、`downloadJsonFromFolder`(120s)、`_fetchMirror`(10s，弱网超时语义保留)。

**效果**: test:cross 跨网络双设备链路从 9 通过/7 失败 → **16 通过/0 失败**。

---

## 二、交付物清单

| 类别 | 内容 |
|------|------|
| 功能 | 文件导出三级下载降级链、文本 execCommand 保底 |
| 修复 | signal 跨 realm 兼容（下载链路全断存量缺陷） |
| 版本 | config.xml / version.json / js/00-bootstrap.js 三源对齐 10.15.10/101510 |
| 联动 | sw.js CACHE_NAME、js/11-about.js VERSION_HISTORY、ios-release.yml、测试断言 |
| 测试 | test:all 全绿（552 PASS / 0 FAIL）；test:cross 真实飞书云端 16/16 |
| 产物 | GitHub Release v10.15.10 签名 APK + IPA + sha256 |

## 三、验证步骤

1. 网页版（GitHub Pages）：数据导出 → 任意格式 → 观察浏览器下载触发
2. 安卓端：导出 → 系统分享面板正常调起（原生链路不变）
3. 弱网：云端拉取超时 10s 后静默降级本地数据展示
4. `npm run test:all` 全绿

## 四、兼容性说明

- 老版本客户端不受影响（新增字段均有默认值，数据结构未变）
- PWA 用户随 CACHE_NAME 升级自动拉取新代码
- 网页镜像数据通道（web-data/）不受本次改动影响
