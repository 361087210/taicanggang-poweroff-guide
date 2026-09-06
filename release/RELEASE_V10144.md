# V10.14.4 发版说明: 网页版数据同步修复 + 安卓端顶部留白修复
发布日期: 2026-09-06  
版本号: 10.14.4 (versionCode=101404)  
网页版地址: https://361087210.github.io/taicanggang-poweroff-guide/demo.html  
下载地址: https://github.com/361087210/taicanggang-poweroff-guide/releases/tag/v10.14.4

---

## 一、版本亮点(一句话给现场组长/组员)

> **彻底修复网页版与安卓端数据不同步的历史问题——安卓端82组车型、网页版只有73组的根因已修复,镜像脚本升级为三入口遍历(云盘根+配置根+旧根),组长在哪根写数据网页版都能5分钟内追上;组员安卓端注册、组长审批后可直接在网页版登录;同时修复安卓端顶部大片留白问题,WebView从状态栏下方开始,完美自适应手机屏幕。**

---

## 二、本次主要交付(交付物对照清单)

| 分类 | 交付物 | 路径 | 说明 |
|---|---|---|---|
| 🐛关键修复 | 安卓端顶部留白修复 | config.xml + css/app.css | StatusBarOverlaysWebView=false,WebView从状态栏下方开始,safe-top恒为0→pt-12=48px纯标题栏高度,消除多余顶部留白;状态栏背景色#1e3a5f与登录页统一 |
| 🐛关键修复 | 镜像脚本V2.5双根遍历 | scripts/sync_web_data.js | 根因:组长安卓端localStorage缓存旧根token(WdXUfZPk...),业务数据(82车型/10账号/图片视频)持续写旧根,而镜像脚本只遍历云盘根+配置根(只有73组内置数据)——V2.5升级为三入口遍历,任一根更新都能被感知 |
| 🐛关键修复 | 双根数据一次性合并 | merge_roots.js(诊断工具) | 按V10.14.3格式对齐两根数据:车型按id去重(旧根82条为基)+新根独有补入;账号按phone去重+跨根冲突取mtime更新记录;密码salt$hash原样保留,不改写 |
| ✨新功能 | 注册审批全链路打通 | js/02-auth.js + js/05-sync.js + js/07-cache.js + js/09-web-sync.js | 安卓组员注册→syncPendingToFeishu上传申请→组长approveMember审批→pushApprovedUsersToFeishu回推→镜像脚本5分钟内拉取→SHA-256脱敏→网页端哈希匹配登录,密码校验与安卓同源 |
| 🛡️健壮性 | 自续链防分裂修复 | .github/workflows/sync-web-data.yml | 修复已取消的重复运行被误判为并发源导致链条断裂的bug,改为只统计queued/in_progress状态;修复remote.origin.fetch仅跟踪单个tag的配置错误 |
| 🛡️健壮性 | GitHub Actions全面兼容Node.js 24 | .github/workflows/*.yml | actions/checkout@v7 / configure-pages@v6 / upload-pages-artifact@v5 / deploy-pages@v5,消除Node.js 20弃用警告 |
| 🔒隐私 | 手机号SHA-256脱敏 | scripts/sync_web_data.js + js/09-web-sync.js | 仓库与Pages为公开,账号表镜像时手机号脱敏为sha256(SALT+phone),姓名/密码哈希保留(登录校验必需);SALT两端严格一致 |
| 🏷版本对齐 | 10.14.3 → 10.14.4 九处一致性升级(versionCode 101404) | js/00-bootstrap.js / config.xml / version.json / demo.html / sw.js / tests/test_v1014 / tests/test_v1015 / ios-release.yml | 防versionCode漂移 |
| 📚文档 | 本发版说明 | docs/RELEASE_V10144.md | 发版知识沉淀 |

---

## 三、功能详解

### 3.1 数据同步根因分析与修复(为什么网页版只有73组)

**问题现象**: 安卓端组长/组员都能同步到82组车型、10个账号;网页版只能看到73组内置数据、注册过的组员账号无法登录。

**根因定位(三层取证)**:

1. **第一层: 网页端** — `09-web-sync.js`从同源`web-data/`读取镜像,数据量由镜像脚本决定,前端逻辑无bug
2. **第二层: 镜像脚本** — V2.0~V2.4不断升级多位置候选→全盘树遍历→备份回退→云盘根端点修复,但始终只能找到73组
3. **第三层: 云盘目录树** — 全树取证发现两棵并行目录树:
   - 新根(`nodcnGA...` = 应用云盘根): 只有内置73组车型 + 1个测试账号残根
   - 旧根(`WdXUfZPk...` = 组长端V5.x起缓存的历史根): 82组车型 + 10个账号 + 全部图片视频

**结论**: 组长安卓端`localStorage`缓存了V5.x时代的旧根token,后续所有版本升级都未覆盖该缓存,业务数据持续写入旧根;而镜像脚本从应用云盘根出发遍历,只能看到新根——这就是"安卓82组/网页73组"的真正根因。

**修复方案(V2.5三入口遍历)**:

| 入口 | 作用 |
|---|---|
| 应用云盘根(`/drive/explorer/v2/root_folder/meta`) | 覆盖全部可达空间,新安装设备的默认根 |
| 配置根(`FEISHU_FOLDER_TOKEN`) | 与APP端`feishuConfig.folderToken`对齐,若与云盘根不同树则补充遍历 |
| 旧根(`WdXUfZPk...`) | 组长端缓存的历史根,V2.5新增,确保历史数据不遗漏 |

三入口去重防环(`walkedFolders` Set),任一根的后续更新都能被镜像脚本感知,从根源上消除"数据漂移到另一根就看不到"的风险。

### 3.2 双根一次性合并(数据对齐)

按V10.14.3格式对齐两根数据,合并语义:

- **车型**: 按id去重,旧根82条为基(最新且全),新根独有补入 → 载荷结构`{version,timestamp,uploadedBy,vehicleCount,vehicles[]}`与`doSyncUpload`完全一致
- **账号**: 按phone去重,跨根冲突取mtime更新文件的记录;密码`salt$hash`原样保留,跨网络组员的`undefined$hash`是V10.14.3原生产物,不改写 → 载荷`{type:'approved_users',version,timestamp,users[]}`与`pushApprovedUsersToFeishu`完全一致
- **写入**: 两根都写入合并后的数据,防止后续漂移

合并后两根均为: 82组车型 + 10个账号(组长1 / 组员6 / 普通用户3)。

### 3.3 注册审批全链路打通

网页端登录的完整数据流:

```
组员安卓端注册
  ↓ doRegister() → syncPendingToFeishu()
  ↓ 上传 pending_reg_{手机号}.json → 飞书「APP数据备份/注册申请/」
组长安卓端审批
  ↓ approveMember() → pushApprovedUsersToFeishu()
  ↓ 上传 approved_users.json → 飞书「APP数据备份/审批结果/」
镜像脚本(5分钟周期, V2.5双根遍历)
  ↓ 全树搜索 approved_users.json → 取mtime最新一份
  ↓ 手机号SHA-256脱敏 → 写入 web-data/approved_users.web.json
  ↓ commit+push → GitHub Pages部署
网页端组员登录
  ↓ doLogin() → 本地无账号 → pullApprovedStatusFromFeishu()(网页重写版)
  ↓ fetch 同源 approved_users.web.json → 哈希匹配 → 重建本地账号
  ↓ verifyPassword 密码校验(salt$hash,与安卓同源) → 登录成功
```

**隐私保障**: 公开仓库与Pages中不存储明文手机号,仅存储SHA-256哈希值;登录时对用户输入的手机号做同样哈希后比对,还原用户身份。SALT为`tcg-web-2026`,前后端严格一致。

### 3.4 自续链可靠性升级

**问题**: 同一次push产生两个工作流运行(其中一个因并发组排队后被取消),防分裂检查把已取消的运行也算入"近期运行",误判为"有并发触发源"而跳过续链,导致5分钟同步链条断裂。

**修复**: 防分裂检查的jq过滤条件从「近5分钟内的全部运行」改为「近5分钟内 status 为 in_progress 或 queued 的运行」——已取消/已完成的运行不是并发触发源,不应计入。

**同步机制回顾**:
- 主机制: 链式自续期——每轮运行结束时用`GITHUB_TOKEN`触发`workflow_dispatch`拉起下一轮,官方文档明确这是反递归规则的例外
- 兜底: cron `*/5 * * * *`(GitHub调度不可靠,仅在链断裂时复活)
- 节奏: 镜像~1min + sleep 4min ≈ 5分钟周期
- 无数据变化时(changed=false)跳过提交与部署,零开销

### 3.5 Node.js 24 兼容升级

GitHub Actions 已将 runner 默认 Node.js 从 20 升级到 24,旧版 actions 会产生 "Node.js 20 已被弃用" 警告。本次全面升级:

| Action | 旧版 | 新版 |
|---|---|---|
| actions/checkout | v4 | v7 |
| actions/configure-pages | v5 | v6 |
| actions/upload-pages-artifact | v4 | v5 |
| actions/deploy-pages | v4 | v5 |

---

## 四、测试验证

| 验证项 | 结果 | 说明 |
|---|---|---|
| 线上车型数据量 | ✅ 82组 | 数据源: 安卓主档:(旧根)/APP数据备份/同步数据/vehicle_sync_data.json |
| 线上账号数据量 | ✅ 10个 | 组长1 / 组员6 / 用户3,phoneH哈希字段完整 |
| 线上新增图片 | ✅ 24张 | v82等新增车型图片已上线,HTTP 200 |
| 密码校验同源 | ✅ 通过 | verifyPassword 与安卓端 02-auth.js 共用salt$hash实现 |
| 自续链存活 | ✅ 正常 | run #28 → #29 → #30 链条持续运转 |
| 双根遍历生效 | ✅ 通过 | debug_structure.json 含 (旧根) 节点 |
| Pages可访问 | ✅ 200 | demo.html / 根路径 均正常返回 |

---

## 五、兼容性与回退

- **升级路径**:
  - 安卓用户: 直接安装覆盖(同签名,versionCode 101404 > 101403),本地数据/登录态/用户表保留
  - 网页版/PWA用户: 无需任何操作——Service Worker自动检测新版本,弹出「发现新版本」提示条,点「立即更新」即时生效
- **数据兼容**: 飞书云端结构、同步链路、密码哈希算法 全部零变更
- **双根并行**: 旧根与新根数据已对齐,组长端无论用哪根都能正常同步;后续V2.5+镜像脚本同时遍历两根,不会再出现数据漂移
- **🛟 紧急回退**: 若现场V10.14.4出现问题,安卓用户可从GitHub Release页下载V10.14.3 apk降级;PWA用户点「稍后」暂不更新即可
- **V10.14.3保护**: iOS PWA深化(PNG图标+安装引导+即时更新+standalone适配) 全部功能零改动,仅版本号升级

---

## 六、发版流程

### 6.1 发版前检查
1. ✅ 版本九处对齐: `js/00-bootstrap.js` APP_VERSION = `config.xml` = `version.json` = `demo.html` = `sw.js` = **10.14.4 / 101404**; test_v1014/test_v1015断言 / ios-release.yml 同步
2. ✅ 线上数据验证: 82车型 / 10账号 / 图片24张 全部到位
3. ✅ 自续链验证: 链条正常运转,5分钟周期稳定
4. ✅ 密码校验验证: 哈希匹配正确,登录闭环打通

### 6.2 发版流水线
```
推送 origin main → 打标签 git tag -a v10.14.4 → 推送标签
→ GitHub Pages 自动部署最新网页版
→ 同步飞书: python scripts/sync_release_to_feishu.py(双通道分发)
```

### 6.3 网页版使用流程(V10.14.4起)
```
1. 浏览器打开线上地址 → 自动加载最新镜像数据
2. iOS用户: Safari打开→弹出安装引导→添加到主屏幕→全屏启动
3. 组员登录: 输入与安卓端相同的手机号+密码即可登录(数据已同步)
4. 数据更新: 组长安卓端上传后,网页版最迟5分钟自动同步(60秒轮询感知)
```

### 6.4 发版后核验
1. GitHub Pages 部署成功,网页版可访问
2. Release v10.14.4 创建完成
3. 飞书`APP数据备份/发版产物/v10.14.4/`目录同步完整
4. 线上数据: 车型82组 / 账号10个,与安卓端一致
