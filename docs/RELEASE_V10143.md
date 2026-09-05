# V10.14.3 发版说明: iOS PWA深化版(PNG图标关键修复+安装引导+即时更新+standalone适配)
发布日期: 2026-09-05  
版本号: 10.14.3 (versionCode=101403)  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v10.14.3/tcg_poweroff_v10.14.3.apk  
SHA-256: 运行时生成 `release/tcg_poweroff_v10.14.3.apk.sha256`

---

## 一、版本亮点(一句话给现场组长/组员)
> **修复iOS Safari不支持SVG图标的关键缺陷(主屏幕图标此前无法正确显示),组员iPhone用Safari打开会自动弹出「添加到主屏幕」操作指引;PWA有新版本时点「立即更新」即时生效;全屏模式适配刘海/灵动岛,体验进一步接近原生APP。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🐛关键修复 | iOS主屏幕图标PNG化 | icon-180/192/512/1024.png + icon-192/512-maskable.png | iOS Safari不支持SVG作为apple-touch-icon,V10.14.2的主屏幕图标在iOS上不显示——本次新增全尺寸PNG图标全家桶 |
| 🐛关键修复 | manifest.json图标声明PNG化 | manifest.json | any用途192/512 PNG + maskable用途192/512 PNG + SVG兜底,Android/iOS/桌面Chrome全兼容 |
| ✨新功能 | iOS安装引导浮层 | demo.html PWA脚本块 | 检测iOS Safari+未安装状态,自动弹出「分享→添加到主屏幕」操作指引(含图标图示);关闭后3天内不再打扰 |
| ✨新功能 | 新版本即时更新提示 | demo.html + sw.js | SW检测到新版本等待激活→底部弹出「发现新版本」提示条→点「立即更新」postMessage(SKIP_WAITING)即时接管刷新,无需等所有标签页关闭 |
| ✨新功能 | standalone全屏模式适配 | demo.html + css/app.css | 检测standalone后在html加pwa-standalone类:顶栏避开刘海/灵动岛、Toast抬离手势条、禁用文本选择呼出菜单(对齐原生APP行为,输入框保留选择) |
| 🛡️健壮性 | PWA脚本沙箱防御 | demo.html `_isStandalone()` | window.navigator/window.matchMedia/document.documentElement逐步判空——Node测试沙箱/老WebView无这些对象时整段安全跳过(修复test_v53运行时仿真回归) |
| 🏷版本对齐 | 10.14.2 → 10.14.3 九处一致性升级(versionCode 101403) | bootstrap.js / config.xml / version.json / demo.html / ios-release.yml / test_v1014 / test_v1015 | 防 versionCode 漂移 |
| 📚文档 | CHANGELOG + 本发版说明 | CHANGELOG.md / docs/RELEASE_V10143.md | 发版知识沉淀 |

---

## 三、功能详解

### 3.1 PNG图标关键修复(为什么必须改)

**缺陷背景**: V10.14.2的`apple-touch-icon`指向`icon.svg`。iOS Safari**不支持SVG格式**作为apple-touch-icon——组员在Safari里选「添加到主屏幕」时,图标要么显示为网页截图要么显示空白,manifest.json里仅有的SVG图标同样不被iOS安装对话框采用。

**修复方案**: 新增6个PNG图标(与SVG视觉完全一致:蓝色圆角背景#2563eb+白色闪电,4倍超采样抗锯齿):

| 文件 | 尺寸 | 用途 |
|---|---|---|
| `icon-180.png` | 180×180 | **iOS apple-touch-icon标准尺寸**(iPhone主屏幕) |
| `icon-192.png` | 192×192 | Android/Chrome常规图标 |
| `icon-512.png` | 512×512 | Android高分辨率/splash |
| `icon-1024.png` | 1024×1024 | App Store级大图(iPad/高分屏) |
| `icon-192-maskable.png` | 192×192 | maskable自适应图标(内容内缩76%居中,安全区内不裁剪) |
| `icon-512-maskable.png` | 512×512 | maskable自适应图标(同上) |

**demo.html引用更新**: `apple-touch-icon`指向`icon-180.png`(iOS必需);新增`icon`类型favicon声明(192/512);保留SVG作为现代浏览器兜底。manifest.json的icons数组PNG优先+SVG兜底,`purpose`字段区分any/maskable。

### 3.2 iOS安装引导浮层

**触发条件**(三条件同时满足才显示):
1. iOS Safari浏览器(排除Chrome/Firefox/Edge等iOS第三方浏览器——它们没有「添加到主屏幕」的PWA能力)
2. 未安装状态(非standalone模式启动,即从Safari地址栏直接访问)
3. 3天内未关闭过该引导(localStorage记忆`pwa_ios_guide_dismissed`时间戳)

**浮层内容**: 深色卡片+分享按钮图示+「安装『太仓港断电』到主屏幕」标题+三步操作说明(点击分享→添加到主屏幕→全屏使用离线可用)。20秒自动消失或点×关闭(关闭记忆3天)。

### 3.3 新版本即时更新提示

**机制**: 页面load时注册SW→监听`updatefound`→新SW进入`installed`状态且已有controller(非首次安装)→底部弹出「发现新版本」提示条(深色卡片:「立即更新」蓝色按钮+「稍后」灰色按钮)。

**点击立即更新**: `navigator.serviceWorker.controller.postMessage({action:'SKIP_WAITING'})`→sw.js收到消息调用`self.skipWaiting()`立即激活新版本→300ms后`location.reload()`拉取新资源。**用户无需关闭所有标签页**(传统SW更新要等所有客户端关闭,现场组员几乎从不主动关页面,这个机制让更新即时可达)。

### 3.4 standalone全屏模式适配

组员从主屏幕图标启动后(`display-mode: standalone`),demo.html检测到该状态在`<html>`上添加`pwa-standalone`类,css/app.css末尾新增对应规则:

| 规则 | 作用 |
|---|---|
| `.phone-frame{padding-top:var(--safe-top)}` | 顶栏避开刘海/灵动岛(black-translucent状态栏下content默认顶到屏幕顶端) |
| `.toast{bottom:calc(90px+var(--safe-bottom))}` | Toast提示抬离底部手势条 |
| `-webkit-user-select:none` | 禁止长按呼出文本选择菜单(对齐原生APP行为) |
| `input/textarea{-webkit-user-select:text}` | 输入框保留文本选择(不影响输入体验) |

浏览器/APK环境无`pwa-standalone`类,零影响(纯增量CSS)。

---

## 四、测试验证(全量回归 0 FAIL)

| 套件 | 断言数 | 结果 | 说明 |
|---|---|---|---|
| V53 运行时仿真 | 21 | ✅ 0 FAIL | 修复PWA脚本沙箱兼容后恢复(window.navigator判空) |
| V57 跨网络真机模拟 | 16 | ✅ 0 FAIL | **真实飞书云端**: 组员注册→组长审批→新设备发现全链路 |
| V57 逻辑 | 34 | ✅ 0 FAIL | |
| V1014 零配置专项 | 49 | ✅ 0 FAIL | 版本断言已随10.14.3对齐 |
| V1015 出口统一专项 | 50 | ✅ 0 FAIL | 版本断言已随10.14.3对齐 |
| V1010 E2E同步 | 18 | ✅ 0 FAIL | |
| V1011 镜像同步 | 6 | ✅ 0 FAIL | |
| V1013 A3复杂度 | 68 | ✅ 0 FAIL | |
| V103-V109 其余套件 | 合计 | ✅ 0 FAIL | V103:62/V104:46/V105:49/V106:33/V107:31/V108:20/V109:17 |
| 语法校验 | - | ✅ | demo.html内联脚本/manifest.json/version.json/sw.js 全部通过 |

**沙箱兼容回归修复记录**: 首次实现时`_isStandalone()`直接访问`window.navigator.standalone`,test_v53沙箱的window对象无navigator属性导致「Cannot read properties of undefined」——改为try/catch+逐步判空后恢复21/21。该防御同时惠及老WebView等非标准环境。

---

## 五、兼容性与回退

- **升级路径**: 直接安装覆盖(同签名,versionCode 101403 > 101402),本地数据/登录态/用户表保留
- **PWA用户升级**: 无需任何操作——下次打开自动检测到新SW,弹出「发现新版本」提示条,点「立即更新」即时生效(本次起生效的更新机制)
- **V10.14.2 PWA用户注意**: 若已用SVG图标添加到主屏幕,图标可能显示异常——删除旧图标重新添加即获得正确的PNG图标
- **数据兼容**: 视频文件存储、飞书云端结构、同步链路全部零变更
- **🛟 紧急回退**: 若现场V10.14.3出现罕见bug,可从GitHub Release页下载V10.14.2的apk直接安装降级;PWA用户点「稍后」暂不更新即可
- **V10.14.2保护**: 车辆详情页多视频支持等功能逻辑零改动,仅版本号断言升级

---

## 六、发版流程

### 6.1 发版前检查(已全部完成)
1. ✅ 版本九处对齐: `js/00-bootstrap.js` APP_VERSION = `config.xml` = `version.json`(含downloadUrl) = `demo.html` = **10.14.3 / 101403**;test_v1014/test_v1015断言 / ios-release.yml 同步
2. ✅ 全量回归: 上述全部套件 0 FAIL(含真实飞书云端16项)
3. ✅ PWA三件套升级: manifest.json(PNG图标)/sw.js(v10.14.3+SKIP_WAITING)/demo.html(PNG引用+安装引导+更新提示)
4. ✅ 语法校验: 内联脚本/JSON/SW全部通过

### 6.2 签名流水线(自动)
```
推送 origin main → 打标签 git tag -a v10.14.3 → 推送标签
→ GitHub Actions「Android CI Build & Release」自动触发:
   config.xml 读取版本 → Secret 构建注入 → Cordova 构建 → zipalign
   → V1+V2 签名(KEYSTORE_BASE64 Secrets) → apksigner verify 自校验
   → 生成 SHA-256 → Release 挂载 APK + .apk.sha256 双资产
→ 同步飞书: python scripts/sync_release_to_feishu.py(双通道分发)
```

### 6.3 iOS组员PWA使用流程(V10.14.3起)
```
1. Safari打开线上地址 → 自动弹出「安装到主屏幕」引导浮层(本次新增)
2. 按指引: 分享 → 添加到主屏幕 → 主屏幕出现蓝色闪电PNG图标(本次修复)
3. 点击图标全屏启动,离线可用
4. 有新版本时自动弹「发现新版本」→ 点「立即更新」即时生效(本次新增)
```

### 6.4 发版后核验
1. CI工作流全绿(Android/iOS/CI/CodeQL)
2. Release v10.14.3资产完整: `tcg_poweroff_v10.14.3.apk` + `.apk.sha256` + IPA
3. 飞书`APP数据备份/发版产物/v10.14.3/`目录同步完整
4. 真机冒烟: Safari打开→安装引导弹出→添加主屏幕→PNG图标正确→全屏启动→离线可用
