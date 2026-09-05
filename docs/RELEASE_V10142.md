# V10.14.2 发版说明: 车辆详情页多视频支持 + iOS方案A(PWA网页应用)
发布日期: 2026-09-05  
版本号: 10.14.2 (versionCode=101402)  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/download/v10.14.2/tcg_poweroff_v10.14.2.apk  
SHA-256: 运行时生成 `release/tcg_poweroff_v10.14.2.apk.sha256`

---

## 一、版本亮点(一句话给现场组长/组员)
> **车辆详情页视频区域支持添加和播放多个教学视频(视频列表+切换播放),iOS端按方案A实现PWA网页应用——组员iPhone用Safari打开即可添加到桌面,像原生APP一样全屏使用,离线也能看。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| ✨新功能 | 车辆详情页多视频列表展示 | js/03-vehicles.js `_renderVehicleDetail` | 单视频卡片→多视频垂直列表,每个视频独立点击播放,标题显示"视频演示(N个)" |
| ✨新功能 | 视频播放器内切换(上一个/下一个) | js/06-media.js `openVideoPlayer`/`switchVideo`/`_updateVideoNav` | 新增`_currentVideoIndex`索引追踪;`switchVideo(direction)`无缝切换复用五源回退链;导航UI(序号+按钮)动态显示 |
| ✨新功能 | 视频上传后回到当前索引 | js/06-media.js `pickVideoFile` | 上传完成后`openVideoPlayer(_currentVideoIndex)`回到当前视频而非第一个 |
| ✨新功能 | iOS方案A: PWA应用清单 | manifest.json | 应用名称/图标/全屏模式/竖屏/主题色声明 |
| ✨新功能 | iOS方案A: Service Worker离线缓存 | sw.js | 应用壳预缓存+静态资源缓存优先+API网络优先+离线导航降级 |
| ✨新功能 | iOS方案A: 应用图标 | icon.svg | 512x512 SVG矢量图标(蓝色背景+白色闪电) |
| ✨新功能 | iOS方案A: PWA meta标签+SW注册 | demo.html `<head>` + `</body>`前 | apple-mobile-web-app-capable/status-bar-style/touch-icon + navigator.serviceWorker.register |
| 🏷版本对齐 | 10.14.1 → 10.14.2 九处一致性升级(versionCode 101402) | bootstrap.js / config.xml / version.json / demo.html / ios-release.yml / test_v1014 / test_v1015 | 防 versionCode 漂移 |
| 📚文档 | 本发版说明 | docs/RELEASE_V10142.md | 发版知识沉淀 |

---

## 三、功能详解

### 3.1 多视频支持(车辆详情页 + 播放器)

**背景**: V10.14.1及之前版本,车辆详情页视频区域仅支持单个视频展示(一个播放卡片)。现场反馈部分车型需要多个角度的断电教学视频(如:整车断电流程+电池拆卸特写+仪表盘复位)。

**改动**:

| 层级 | 改动前 | 改动后 |
|---|---|---|
| 详情页渲染 | 单个`aspect-video`卡片,onclick固定调`openVideoPlayer()` | `videoPaths`数组遍历生成多卡片垂直列表,onclick传索引`openVideoPlayer(i)` |
| 卡片标题 | 固定"断电教学视频" | 第一个为"断电教学视频",其余为"补充视频N";右上角显示序号标记 |
| 区域标题 | 固定"视频演示" | 多视频时显示"视频演示(N个)" |
| 播放器入口 | `openVideoPlayer()`无参 | `openVideoPlayer(videoIndex)`接受0-based索引,默认0 |
| 播放器内切换 | 无 | 新增`switchVideo(direction)`: -1上一个/+1下一个,循环切换;切换时清理当前视频状态(暂停/移除src/清除定时器),复用`openVideoPlayer`五源回退链重新加载 |
| 导航UI | 无 | 播放器顶部显示"视频 1/3"序号+上一个/下一个按钮(单视频时隐藏) |
| 上传回调 | `openVideoPlayer()`回到第一个 | `openVideoPlayer(_currentVideoIndex)`回到当前视频 |
| `pickVideoFile` | 硬编码`v.videoPaths[0]` | `v.videoPaths[_currentVideoIndex]`取当前视频文件名 |

**安全语义不变**: 视频上传飞书云端链路(vehicle_videos目录)、五源回退链(本地APK→GitHub Release直链→飞书云端→CDN→飞书folder)均未改动,仅索引维度扩展。

### 3.2 iOS方案A: PWA网页应用

**背景**: iOS端此前依赖Cordova打包为原生APP(GitHub Actions流水线签名构建)。现场部分组员iPhone无法通过TestFlight安装(企业证书限制/设备未注册UDID)。方案A将Web版直接作为PWA,组员用Safari打开→分享→添加到主屏幕,即可获得接近原生APP的体验(全屏/独立图标/离线可用),无需经过App Store审核。

**三层架构**:

| 层 | 文件 | 作用 |
|---|---|---|
| 应用清单 | `manifest.json` | 声明应用名称("太仓港断电指导")、短名称、图标、启动页(demo.html)、显示模式(standalone全屏)、方向(portrait竖屏)、主题色 |
| 离线缓存 | `sw.js` | ①Install: 预缓存应用壳(demo.html+所有JS/CSS/vendor依赖+manifest+icon) ②Activate: 清理旧版本缓存 ③Fetch: 飞书/GitHub API网络优先(失败降级缓存);同源静态资源缓存优先(未命中再网络请求并回填);导航请求离线时返回demo.html |
| HTML注入 | `demo.html` `<head>` | `<link rel="manifest">` + `apple-mobile-web-app-capable`(全屏) + `apple-mobile-web-app-status-bar-style`(状态栏透明) + `apple-touch-icon`(主屏幕图标) + `theme-color` |
| SW注册 | `demo.html` `</body>`前 | `navigator.serviceWorker.register('sw.js')` load后异步注册,失败仅console.warn不影响功能 |

**iOS Safari使用流程**: Safari打开demo.html → 底部分享按钮 → "添加到主屏幕" → 主屏幕出现"太仓港断电"图标 → 点击启动 → 全屏无地址栏 → 离线可用

---

## 四、版本继承关系

V10.14.2继承V10.14.1及之前所有版本的全部能力(本次为纯增量,不改动V10.14.1任何已有逻辑):

| 版本 | 继承能力 |
|---|---|
| V10.14.1 | 同步配置出口统一修复(五处直读localStorage改走getFeishuCfg()统一出口) |
| V10.14.0 | 组员零配置同步(构建期注入秘钥闭包缓存+成员态禁写+三色横幅状态机) |
| V10.13.0 | A3四刀切/渲染分离/State守卫/XSS绊线 |
| V10.12.0 | 单向收敛/九模块拆分/Secret构建注入 |
| V5.3 | 全部依赖库本地化打包(离线/弱网可用) |

---

## 五、兼容性与回退

- **升级路径**: 直接安装覆盖(同签名,versionCode 101402 > 101401),本地数据/登录态/用户表保留
- **数据兼容**: 视频文件存储路径(vehicle_videos目录)和飞书云端结构零变更;单视频车辆自动兼容(数组长度=1时导航UI隐藏)
- **PWA兼容**: manifest.json/sw.js仅在浏览器/Safari环境生效;Cordova打包APP内SW注册会被WebView忽略(Cordova环境无navigator.serviceWorker或受限),不影响原生APP功能
- **🛟 紧急回退**: 若现场V10.14.2出现罕见bug,可从GitHub Release页下载V10.14.1的apk直接安装降级(需先卸载再安装,数据保留在本地);PWA用户删除主屏幕图标重新用Safari访问即可
- **V10.14.1保护**: V10.14.1的代码逻辑、测试断言、发版产物均未改动,仅版本号断言从10.14.1升级到10.14.2(测试文件test_v1014/test_v1015中的版本期望值)

---

## 六、发版流程

### 6.1 发版前检查
1. ✅ 版本九处对齐: `js/00-bootstrap.js` APP_VERSION = `config.xml` = `version.json`(含downloadUrl) = `demo.html` = **10.14.2 / 101402**;test_v1014/test_v1015断言 / ios-release.yml 同步
2. ✅ 多视频功能: 详情页多视频列表渲染+播放器切换+上传回调均验证
3. ✅ PWA三件套: manifest.json + sw.js + icon.svg 创建完毕;demo.html meta标签+SW注册注入完毕
4. ✅ V10.14.1代码未改动: 仅版本断言升级,核心逻辑零变更

### 6.2 签名流水线(自动)
```
推送 origin main → 打标签 git tag -a v10.14.2 → 推送标签
→ GitHub Actions「Android CI Build & Release」自动触发:
   config.xml 读取版本 → Secret 构建注入 → Cordova 构建 → zipalign
   → V1+V2 签名(KEYSTORE_BASE64 Secrets) → apksigner verify 自校验
   → 生成 SHA-256 → Release 挂载 APK + .apk.sha256 双资产
```

### 6.3 iOS方案A部署(PWA)
```
组员iPhone操作:
1. Safari打开 demo.html 的线上地址(或GitHub Pages/飞书云空间托管URL)
2. 点击底部「分享」按钮
3. 选择「添加到主屏幕」
4. 主屏幕出现"太仓港断电"图标,点击即可全屏使用
5. 首次加载后离线可用(Service Worker已预缓存应用壳)
```

### 6.4 发版后核验
1. CI工作流全绿
2. Release v10.14.2资产完整: `tcg_poweroff_v10.14.2.apk` + `.apk.sha256`
3. `version.json.downloadUrl`指向v10.14.2资产(APP内检查更新链路)
4. 真机冒烟: 车辆详情页多视频列表展示→点击不同视频→播放器内切换上一个/下一个
5. iOS PWA冒烟: Safari打开→添加到主屏幕→全屏启动→断网后仍可浏览车型手册
