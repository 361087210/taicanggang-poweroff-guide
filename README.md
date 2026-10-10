# 太仓港商品车断电操作标准化指导平台 v10.25.0

> 面向太仓港商品车（滚装船）断电作业的标准化指导应用：车辆信息管理、断电操作指导、照片/视频媒体管理、文档导出与一键分享、飞书云端数据同步与备份、跨网络注册审批、问题反馈闭环，以及应用内更新。

## 版本信息

- **当前版本**: v10.25.0（versionCode 102500）—— 最新代号「媒体工程化版」
- **发布日期**: 2026-10-10
- **适用平台**: Android 7.0+ (API 24+)；iOS / 桌面浏览器经 PWA 方式使用
- **签名方式**: V1+V2 正式签名（CI 自动解码 `KEYSTORE_BASE64` 签名构建）
- **完整变更历史**: 见 [CHANGELOG.md](CHANGELOG.md)

## 快速导航

| 文档 | 说明 |
|------|------|
| [📄 V10.25.0 发布说明](docs/RELEASE_V10.25.0.md) | 最新版本「一句话 + 背景 + 逐项变更」 |
| [🏗️ 架构文档](docs/ARCHITECTURE.md) | 分层架构、模块划分、数据流、冲突策略、错误与安全设计 |
| [🛠️ CI/CD 使用说明](docs/CICD使用说明.md) | 双流水线 + Secrets 配置 + 构建号策略 + 发布流程 |
| [📖 开发文档](docs/DEVELOPMENT.md) | 本地运行、模块约定与开发流程 |
| [🧪 测试矩阵](docs/TEST_MATRIX.md) | 各版本测试项与断言覆盖矩阵 |
| [📌 待办与已知问题](docs/PENDING_ISSUES.md) | 尚未闭环的议题 |
| [🔒 安全策略](SECURITY.md) | 凭证保护、零明文与脱敏策略 |
| [📝 变更历史](CHANGELOG.md) | 全量版本变更（Keep a Changelog 格式） |

## 核心功能

### 1. 车辆管理
- **100 辆车辆数据**，覆盖比亚迪 / 长安 / 上汽 / 长城 / 东风 / 江淮 / 吉利 / 奇瑞 / 零跑 / 广汽 / 北汽 等 11+ 品牌
- 车辆列表（缩略图、品牌筛选、搜索）、详情查看、新增 / 编辑 / 删除（带删除守卫）
- 车型照片分区（前脸 / 侧面 / 钥匙盒等）、部位标签与备注

### 2. 断电操作指导
- 每车「断电步骤」+「关键帧检查」+「钥匙盒处置」三段结构化指引
- 详情页媒体卡片与全屏查看器（照片 / 视频）

### 3. 媒体管理
- 照片拍照 / 相册选择，自动压缩（最大 800px，质量 70%），最多 9 张
- **诚实空态（V10.20.1）**: 照片缺失不再用灰图占位（灰图会被误认为「还在加载」），详情格 / 列表缩略图 / 查看器直接标注「照片缺失」，并按 `missing`（登记了但取不到，联系组长补传）/ `never`（本就没登记，需重拍）区分处置文案
- 视频四源回退链：本地 APK → 飞书云端 → GitHub Release 免鉴权直链 → 诚实降级提示
- 组长可在占位页一键上传教学视频（≤20MB）至飞书云端；上传按车型名称命名，别名歧义整体拒绝（宁可漏不可错）

### 4. 文档导出与一键分享
- Excel / PDF / Word 导出；单车多工作表、批量汇总 + 详情
- CSV 规范：11 列标准表头 + UTF-8 BOM + CRLF，Windows Excel 双击直开
- 三级分享策略：写缓存文件走 `file://`（微信/QQ/钉钉对 base64 兼容差）→ base64 回退 → Web Share API → 浏览器下载
- 导出中全部按钮禁用防重复提交，成功后自动清空选择集

### 5. 数据存储与飞书云同步
- 飞书**多维表格（Bitable）**承载车辆数据；飞书云盘承载备份 / 审批 / 偏好等用户数据
- **数据分仓**: 项目产物（文档 / APK / 代码）与用户数据（账号 / 审批 / 备份）物理隔离，互不污染
- `npm run sync:push` / `sync:pull` / `sync:status` 负责推送 / 拉取 / 状态查看
- **同步防倒退**: 写入前回滚熔断（车辆数异常减少则拒绝覆盖）+ 同名副本按 `modified_time` 取最新，杜绝镜像取到陈旧副本导致数量倒退
- 飞书 API 请求门控（最小间隔 + 并发上限 + 限流码指数退避 + 目录列表缓存），弱网与突发并发不再随机失败

### 6. 账号与审批
- 基于角色的登录系统（组长 / 组员），密码经加盐 **PBKDF2** 哈希落库，明文绝不落盘 / 上云
- 跨设备注册审批闭环：组员申请上传飞书 → 组长轮询 + 提醒 → 审批结果回传 → 组员端拉取，双机不同网络亦可闭环
- 组长重置组员口令为 **12 位高熵随机一次性口令**（CSPRNG，去歧义字符集），仅弹窗展示一次

### 7. 问题反馈闭环
- 应用内提交反馈 → 飞书多维表格 → 处理脚本 → 飞书群通知
- `web-data/` 为 GitHub Pages 公开静态镜像，反馈表镜像启用分页拉取 + 字段白名单（联系方式 / 设备信息 / 提交人等个人可识别字段默认不出库）

### 8. 应用内更新
- 启动 3 秒后自动静默检查更新（可手动触发），多源探测：GitHub Raw → jsDelivr CDN → 飞书云盘
- 统一走原生 HTTP 通道 + 超时保护，弱网不再无限挂起

### 9. 工程质量门禁
- **版本一致性七源对齐校验**：`version.json` / `release/version.json` / `config.xml` / `sw.js` / `demo.html` / `js/00-bootstrap.js` / `js/11-about.js`，任一处漏改升版立即拦截
- CI 校验流水线：资产校验 + 凭证泄露扫描 + 版本一致性 + 测试覆盖率门禁
- 测试产物（`*_results.json`）与 AI 工具配置目录不入库，`.gitignore` 常驻防线防止回潮

## 技术栈

- **前端**: HTML5 + Tailwind CSS（本地化）+ 原生 JavaScript（按模块拆分，非单文件）
- **移动端**: Apache Cordova (android@13)
- **原生插件**: advanced-http（网络）、x-socialsharing（分享）、camera / file / media-capture（媒体）
- **文档生成**: SheetJS + jsPDF(+AutoTable) + html-docx-js + html2canvas（全部本地化，零 CDN 外链）
- **云服务**: 飞书开放平台（多维表格 Bitable + 云盘 Drive）
- **构建工具**: Gradle 8.14.2 + Cordova CLI + JDK 17

## 项目结构

```
taicanggang-poweroff-guide/
├── index.html                  # GitHub Pages 入口（0 秒跳转 demo.html）
├── demo.html                   # 应用外壳（SPA），按序加载 vendor 与 js/ 模块
├── config.xml                  # Cordova 配置文件
├── manifest.json / sw.js       # PWA 清单与 Service Worker（缓存名随版本升级）
├── feishu-api.js               # 飞书开放平台 API 层（原生 httpFetch 统一适配）
├── vehicles_data.js            # 车辆数据（由飞书云端生成，当前 100 辆）
├── version.json                # 应用内更新的版本信息（version/versionCode/releaseNotes）
├── js/                         # 应用业务模块（文件名前缀为加载顺序）
│   ├── 00-config.js / 00-bootstrap.js
│   ├── 01-state.js / 02-auth.js / 03-vehicles.js
│   ├── 04-export.js / 05-sync.js / 06-media.js
│   ├── 07-cache.js / 08-main.js / 09-web-sync.js
│   ├── 10-feedback.js / 11-about.js / 12-bitable.js
│   └── 16-audit.js
├── vendor/                     # 本地化依赖库（零 CDN 外链）
│   └── tailwind / xlsx / jspdf(+autotable) / html-docx / html2canvas
├── vehicle_images/             # 车辆照片（随仓库分发）
├── web-data/                   # GitHub Pages 公开数据镜像（反馈表，字段白名单）
├── tests/                      # 自动化测试（jsdom 运行时 + 静态契约）
├── scripts/                    # 构建 / 同步 / 发版 / 审计脚本
├── docs/                       # 架构、发布说明、开发文档与参考资料
├── .github/workflows/          # CI 校验流水线 + Release 签名构建流水线
├── release/                    # 发版版本文件（APK 走 GitHub Releases，不入库）
├── CHANGELOG.md
├── SECURITY.md
└── LICENSE                     # Apache-2.0
```

## 快速开始

### 浏览器预览
直接用浏览器打开 `demo.html` 即可使用全部功能（飞书请求走 fetch 降级通道）。`index.html` 会 0 秒跳转到 `demo.html`。

### Android 安装
1. 从 [GitHub Releases](https://github.com/361087210/taicanggang-poweroff-guide/releases) 下载最新签名 APK
2. 在 Android 设备上安装（需允许未知来源安装）
3. 首次打开显示登录页面，使用账号登录

### 默认账号
- **组长**: 17602554481（完整权限）
- **组员**: 注册申请 → 组长审批（跨设备实时）→ 登录

## 测试

测试以 Node + jsdom 运行时断言为主，辅以静态契约检查（jsdom 用于真实 DOM 行为验证，例如照片缺失空态、导航守卫、透传守卫等）。

```bash
# 一键全量（聚合入口，含版本一致性与覆盖率门禁）
npm run test:all

# 单个套件示例
npm run test:honest-empty      # V10.20.1 诚实空态（39 断言）
npm run test:zero-guard        # 同步防倒退熔断（55 断言）
npm run test:vehicle-integrity # 车辆数据完整性 + 自动派生校正
npm run test:version           # 版本一致性七源对齐校验
```

> 飞书真实 API / 跨网络套件在缺少凭据时按「跳过」语义 `exit 0`，不再掐断全链；如需运行请设置 `TCG_FEISHU_APP_SECRET`（或 `FEISHU_APP_SECRET`）环境变量。

## 安全说明

- **密码存储**: 加盐 PBKDF2 哈希，明文口令绝不落盘 / 上云；重置口令为 12 位高熵随机一次性口令
- **连接键脱敏（linkKey）**: 云端不保存可用于离线校验的明文材料；存量账号惰性迁移，网页端登录引导先在 App 完成一次安全升级
- **代码库零明文**: 源码、文档、测试脚本均不含明文凭证；CI 内置凭证泄露扫描（`npm run scan:secrets`）
- **公开镜像隐私**: `web-data/` 反馈表镜像启用字段白名单，个人可识别信息默认不出库
- **安全建议**: 定期轮换凭证；生产环境优先使用服务端代理而非客户端直连飞书 API

## 数据架构

```
飞书云盘
├── 项目产物文件夹 (CeT0fYNgalU4fQdW9etcJLJGn1b)
│   ├── 开发文档 / APK / 代码备份 / version.json
│   └── vehicle_videos/ (教学视频, 组长可上传)
└── APP数据备份/ (自动创建, 与产物物理隔离)
    ├── 同步数据/          # vehicle_sync_data.json 等镜像源
    ├── 注册申请/          # pending_registrations.json
    ├── 审批结果/          # approved_users.json
    ├── 备份文件/          # vehicle_backup_*.json
    └── 偏好设置/
飞书多维表格 (Bitable)
├── 车辆数据表
└── 问题反馈表 (公开镜像经白名单同步至 web-data/)
```

## 近期版本要点

> 完整逐项变更见 [CHANGELOG.md](CHANGELOG.md)。

- **V10.25.0** 媒体工程化 + 账号安全加固：图片/视频按车型名分文件夹存储（GitHub 与飞书同构），单一真源 + 三段式路径下钻从结构上杜绝媒体与车型错配，存量迁移 193 个文件；新增账号注销防复活（墓碑机制）、自助注销与生命周期三处加固；新增代码库知识文档、web-data 脱敏门禁与行覆盖率验收门禁
- **V10.20.2** 仓库治理：59 个 AI 工具配置目录出库（含 `data/skills/` 28 条符号链接，共 2576 个跟踪文件）、补 Apache-2.0 LICENSE 全文修复 GitHub 许可证识别、README 更新至当前现状（不涉及 APP 功能与 versionCode 语义变更）
- **V10.20.1** 诚实空态 + 同步防倒退：删除会伪装的灰图占位，照片缺失直接标注并区分处置；同名镜像副本按修改时间取最新、写入前回滚熔断，杜绝网页端车型数量倒退；乱码校正表 30 → 35 条并新增自动派生校正层
- **V10.20.0** 组长重置口令安全加固：固定口令 `123456` → 12 位高熵随机一次性口令
- **V10.19.5** 飞书限流根治：统一请求门控 + 限流码指数退避 + 目录列表缓存
- **V10.19.4** 环境对齐与别名安全：飞书配置对齐新应用，视频别名歧义整体拒绝
- **V10.19.3 / V10.19.2 / V10.19.1** 诊断加固、网页端登录修复、版本门禁与测试覆盖补强
- **V10.19.0** 视频可播性修复：封面单一真源、改名后别名回退、网页端走免鉴权直链；公开镜像隐私白名单
- **V10.18.0** 审批闭环加固：飞书群拒绝通知、被拒端即时弹窗、视频按车型命名

## 许可证

[Apache-2.0](LICENSE)

## 仓库

- GitHub: https://github.com/361087210/taicanggang-poweroff-guide
- 飞书云盘(产物): https://feishu.cn/drive/folder/CeT0fYNgalU4fQdW9etcJLJGn1b
- 飞书云盘(用户数据): `APP数据备份/` 子文件夹（应用自动创建）
