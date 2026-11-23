# V10.26.2 发布说明（样式提速版）

- **发布日期**：2026-11-23
- **版本号**：10.26.2（versionCode 102602）
- **一句话总结**：把运行时 Tailwind（441KB JS，官方明确不可用于生产）换成 **25KB 预编译静态 CSS**，首屏再省 415KB。

## 为什么

`vendor/tailwind.js` 是 **Tailwind Play CDN**——它的工作方式是：在浏览器里用 `MutationObserver` 盯着 DOM，把页面出现过的类名收集起来，**现场生成 CSS** 再注入 `<style>`。两个问题：

1. **体积**：441KB JS 要跟着首屏下载（这份文件自己也打印了 `cdn.tailwindcss.com should not be used in production`）；
2. **运行时开销**：每次 DOM 变化都要重新扫描 + 生成，移动端 WebView 上尤其明显。

## 改了什么

| 项 | 内容 |
|---|---|
| 产物 | `css/tailwind.build.css`（**25KB / gzip 5KB**），`<link rel="stylesheet">` 放 head |
| 删除 | `vendor/tailwind.js`（441KB） |
| 可复现 | 新增 `scripts/build_tailwind_css.js` / `npm run build:tailwind`，扫描 `demo.html` + `js/**/*.js` |
| 离线 | `sw.js` 预缓存从 `vendor/tailwind.js` 换成 `css/tailwind.build.css` |
| 发版校验 | android/ios 两条 workflow 的 vendor 清单同步去掉 `tailwind.js` |

**关键点：必须扫 `js/**/*.js`。** 本项目的类名大量写在 JS 模板字符串里（`<div class="bs-item …">`），只扫 html 会大面积缺样式。

## 怎么保证"换完之后没坏"

1. **计算样式对照**：无头 Chrome 430×932，把同一套操作走完 10 个界面（车型列表/详情/数据中心/导出面板/我的/侧滑菜单/关于/资源库/缺失筛选/预览弹层/反馈/同步），对 **148 个可见元素的 29 项计算样式**逐项比对：运行时版本 vs 静态版本 → **0 差异**。
2. **类名覆盖率门禁**（`tests/test_v10261_tailwind_static.js`，20 断言）：从所有 `class="…"` / `className='…'` 里抽出工具类 token（本次扫到 **200+** 个），逐个检查是否出现在产物中，**漏一个即红**。

这条门禁是刻意设计的：预编译最大的风险不是"换的时候坏"，而是**将来有人加了新类名却忘了重建 CSS**——页面上局部没样式，肉眼极难发现。

## 实测（无头 Chrome 430×932 2x，模拟 4G 200KB/s + 150ms RTT）

| 指标 | V10.26.1 | **V10.26.2** |
|---|---|---|
| 首屏 FCP | 2.75 s | 待发布后实测 |
| 首屏传输量 | 551 KB | 预计再降 ~150KB(gzip) |
| 样式框架体积 | 441 KB JS | **25 KB CSS** |

## 怎么用

```bash
# 改了模板里的类名之后（新增/删除 class）必须重建，否则覆盖率门禁会红
npm run build:tailwind
node tests/test_v10261_tailwind_static.js
```

## 已知

- `build:tailwind` 需要能取到 `tailwindcss@3.4.17`（`npx` 或 `pnpm dlx`）；离线环境请用已缓存版本或直接把产物一起提交
- 若将来引入 Tailwind 插件（forms/aspect-ratio 等）或改 `theme`，必须同步改 `scripts/build_tailwind_css.js` 里的配置，否则产物与开发期不一致
