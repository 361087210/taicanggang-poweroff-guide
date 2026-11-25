/* ===========================================================
 * 模块: 11-about.js  关于页面 V1.0 (V10.15.0 新增)
 * ===========================================================
 * 内容: 版本历史 / 技术架构 / 开发工具 / 项目地址 / 开发者署名
 * =========================================================== */
(function(){
'use strict';

const VERSION_HISTORY = [
  {
    version: 'V10.28.1',
    date: '2026-11-25',
    highlight: '更新提示修复: 直链兜底命名 + 写死旧资产 + 安装包体积回写',
    features: [
      '修复: 直链三级回退的最后一级仍按 V5.3 时代的 taicanggang-V{ver}-b{build}.apk 命名拼地址, 实际产物已是 tcg_poweroff_v{ver}.apk, 缺 downloadUrl 时必 404',
      '修复: 应用内安装删掉写死的 v5.7 资产兜底(该资产已不存在), 解不出直链时明确提示并恢复按钮',
      '修复: 发版流程回写 version.json 的 apkSize, 弹窗不再永远只显示「直链下载已就绪」',
      '测试: 新增 test:v10285-update-prompt(19 断言), 固化版本比较/多源取最高/跳过语义与直链三级回退'
    ]
  },
  {
    version: 'V10.28.0',
    date: '2026-11-24',
    highlight: '资源库移出资源: 软删除 / 硬删除 + 云端自动清理',
    features: [
      '新增: 「移出资源库」改为软删除(回收站可恢复)与硬删除(彻底删除)两个平级选项, 硬删除需二次确认',
      '新增: 硬删除写入飞书清理队列, 每 15 分钟工作流同步删除 COS 对象、飞书云盘文件与 GitHub 照片/视频资产',
      '新增: 客户端队列按路径幂等, 离线或提交失败会在下次进入资源库时自动补交',
      '安全: COS/GitHub 写权限仅存在 CI Secrets, 脚本路径白名单限定媒体目录',
      '测试: 新增 test:v10284-media-hard-delete(41 断言)'
    ]
  },
  {
    version: 'V10.27.11',
    date: '2026-11-24',
    highlight: '发版包体积修复: 打包期压缩照片 + 体积预算门禁',
    features: [
      '修复: v10.27.9 安装包因原图被打包而超过飞书单文件 20MB 上限, 飞书同步失败',
      '新增: 打包时对超过 800KB 或最长边超过 1600px 的照片生成压缩副本, 仓库原图保留',
      '新增: 打包照片总量超过 18MB 直接让构建失败, 并列出最大的 5 张',
      '新增: 发布流程自动安装 ImageMagick, 避免构建镜像缺依赖直接失败'
    ]
  },
  {
    version: 'V10.27.9',
    date: '2026-11-24',
    highlight: '媒体资源治理: 回收站 + COS 国内源 + 媒体单一真源',
    features: [
      '新增: 资源库删除可恢复 —— 回收站记录 + 墓碑, 云端文件保留, 支持恢复/彻底删除',
      '新增: COS 国内源直链(公有读桶), 照片与视频按 CDN → COS → GitHub → 飞书 分流',
      '重构: 资源库上传/删除只写媒体登记表, 不再整份覆盖车型数据; 渲染时合并「车型基线 + 登记表」',
      '修复: 同步改为增量合并登记表(下载→并集→上传), 旧快照回传不会让已删文件"复活"'
    ]
  },
  {
    version: 'V10.27.8',
    date: '2026-11-24',
    highlight: '发版同步韧性: 上传遇空响应/网关错误自动重试',
    features: [
      '修复: 上传返回空体时不再抛 JSONDecodeError 让整个同步进程退出',
      '新增: 单请求上传(≤16MB)失败重试 2 次，两次都失败才报错并附原因',
      '新增: 分片上传的预上传/完成同样安全解析',
      '说明: Android / iOS 两条同步只要一条成功，飞书目录就是完整的'
    ]
  },
  {
    version: 'V10.27.7',
    date: '2026-11-24',
    highlight: '发版产物唯一性: 飞书不再出现同名副本',
    features: [
      '修复: Android/iOS 两个同步任务并发上传导致的同名副本(构建时间接近时必然发生)',
      '修复: 副本清不掉 —— 覆盖前删除"全部"同名文件, 而不是只删一条',
      '修复: 终验改为"在且唯一", 副本不再被报成完成',
      '清理: v10.27.1 / v10.27.2 / v10.27.5 的存量副本已清, 各目录恢复 4 件'
    ]
  },
  {
    version: 'V10.27.6',
    date: '2026-11-24',
    highlight: 'Pages 部署可靠性: 等工件可见 + 失败重试一次',
    features: [
      '修复: 部署前等待工件元数据可见(此前连续 4 次报 No artifacts named github-pages)',
      '首次部署失败不再中断, 自动重试一次; 重试仍失败才算红',
      '站点内容与 V10.27.5 一致, 本版仅改 CI'
    ]
  },
  {
    version: 'V10.27.5',
    date: '2026-11-24',
    highlight: '播放源可配置: 对象存储 CDN 主 + Release 备, 带源健康记忆',
    features: [
      '视频播放源改为注册表 + 候选链: 填 MEDIA_CDN_BASE 即启用 CDN 主源',
      '主源失败自动降级备源, 不再直接掉进无密钥的飞书源',
      '源健康记忆 30 分钟: 坏源靠后, 成功一次即恢复主源优先',
      '不配置 CDN 时行为与上版完全一致(单源, 零风险)'
    ]
  },
  {
    version: 'V10.27.4',
    date: '2026-11-24',
    highlight: '车型详情 ↔ 资源库双向联动: 媒体状态徽标 + 点按定位台账行',
    features: [
      '详情页: 每张照片/视频叠加资源库状态徽标(正常/共享/云端/缺失/低清)',
      '详情页: 照片/视频板块显示「N 项 · N 缺失 · N 共享 · N 低清」汇总',
      '点按徽标: 自动翻到资源库对应分页并高亮该资产',
      '板块「资源库 ›」: 只查看该车型的资产, 一键清除收窄',
      '索引加载去重; 索引不可用时静默降级, 详情页照常可用',
      '发版补齐: docs/RELEASE_V10.27.4.md(10.27.3 构建因缺发布说明文件未发布)'
    ]
  },
  {
    version: 'V10.27.2',
    date: '2026-11-24',
    highlight: 'RUNBOOK + 严格规则集模板 + 覆盖率双口径 + 清掉写死数据量的脆弱断言',
    features: [
      '运维: 新增 RUNBOOK(回滚/数据恢复/故障处置/季度演练/值班路径)',
      '治理: 严格分支规则集模板入库, 自动化就绪后一键恢复"强制 PR + 必过检查"',
      '可信度: 覆盖率同时报「可归因 98%」与「整体 80.45%（不可归因占 18%）」',
      '健壮性: 去掉写死的 64/100, 改与索引明细、镜像车型数互证'
    ]
  },
  {
    version: 'V10.26.7',
    date: '2026-11-24',
    highlight: '工程治理: 分支/tag 保护 + 全局错误捕获与诊断上报 + 依赖供应链治理',
    features: [
      '分支保护: main 必须走 PR, 必过 CI 与 Secret Scan, 线性历史, 禁 force push',
      '发布 tag 不可移动/删除: 打错就发下一个 patch 版本',
      '可观测: 捕获未处理异常, 本地缓冲 20 条(PII 掩码), 每小时最多自动上报 1 条',
      '我的 → 复制诊断信息: 白屏/报错时一键导出给开发',
      '供应链: dependabot 分组更新 + 34 处 action 引用固定到 commit SHA'
    ]
  },
  {
    version: 'V10.26.6',
    date: '2026-11-23',
    highlight: '画质回退无损 + 低清可观测 + 媒体缺失不崩 + 改名自愈 + 重名守卫',
    features: [
      '画质: 撤回 PNG 调色板压缩(恢复无损); 模糊真因是源图分辨率(多为 433px 宽)',
      '清晰度: 资源库标注「低清 + 尺寸」(170 项)，新增「低清」筛选，推动 ≥1200px 补拍',
      '韧性: 删除车型不删任何文件(文案已纠正)；缺图不影响列表/详情/导出；索引缺失有重试',
      '强关联: 同步流水线自动执行改名迁移(幂等)并校验无待迁移项',
      '增删改查: 显示名唯一校验(防媒体目录撞车)，编辑时排除自身'
    ]
  },
  {
    version: 'V10.26.5',
    date: '2026-11-23',
    highlight: '车型↔资源强关联: 无主目录 / 改名失配 / 无素材车型 一律可见',
    features: [
      '索引新增 vehicles[](含 0 素材车型)、unownedFolders、renamedRefs',
      '资源库顶部提示「车型与资源有 N 处对不上」，点进「断链」筛选逐条看',
      '改名不再只表现为"照片缺失"，而是明确标出文件实际所在目录',
      'App 内允许从 Pages 拉最新索引(CSP 放行)，本地快照缺失/过期时有兜底'
    ]
  },
  {
    version: 'V10.26.4',
    date: '2026-11-23',
    highlight: '视频内容指纹: 59/62 条引用已有 sha256，共享视频 100% 覆盖',
    features: [
      '同名换片可被发现: 两个共享视频(13 台 / 2 台)指纹齐备, audit C8 告警消失',
      '指纹由 CI 下载 Release 资产生成(本地网络下 449MB 不可行)',
      'fingerprint_videos 新增 --release-map, 把资产名指纹回填到原始文件名',
      '每周一自动复查, 云端被替换会在 diff 里立刻可见'
    ]
  },
  {
    version: 'V10.26.3',
    date: '2026-11-23',
    highlight: '修复 31 条「照片在 _共享/ 却引用车型目录」的 404，并在管线与 CI 双重卡口',
    features: [
      '同步管线自动回写失配引用(幂等), 不再被下一次同步覆盖回去',
      'audit「引用失配」31 → 0, 可直接命中的照片 172 → 203',
      '同步流水线提交前 + CI 各加一道 --verify, 有失配即红',
      '真缺失仍 64 条(需业务补拍/补传)'
    ]
  },
  {
    version: 'V10.26.2',
    date: '2026-11-23',
    highlight: '样式提速: 运行时 Tailwind(441KB) → 预编译静态 CSS(25KB)',
    features: [
      '性能: 首屏少下载 415KB JS, 去掉浏览器里扫描 DOM 生成样式的开销',
      '工程: npm run build:tailwind 可复现(扫描 demo.html + js/**.js, 模板类名一并收集)',
      '测试: 类名覆盖率门禁 —— 模板新增类名忘重建会直接红, 防「局部没样式」',
      '验证: 148 个可见元素 × 29 项计算样式与运行时版本 0 差异'
    ]
  },
  {
    version: 'V10.26.1',
    date: '2026-11-23',
    highlight: '首屏提速: 导出组件按需加载(FCP 6.9s→3.6s) + PNG 省 3.1MB + 参考资料出仓',
    features: [
      '性能: 1.8MB 导出库移出 <head>, 首次导出时按需注入(幂等, 失败仍降级)',
      '性能: 12 张 PNG 重编码, 4.96MB → 1.89MB',
      '工程: 57MB 参考资料归档 Release(refdocs-2026-11), 工作树 75MB → 18MB',
      'CI: 发版校验改为「装载清单 + 首屏不得含导出库」, 不再绑死 demo.html 标签',
      '测试: 新增 33 断言; 订正 test_v106 A1 的实现细节断言'
    ]
  },
  {
    version: 'V10.26.0',
    date: '2026-11-23',
    highlight: '资源库增强: 台账与飞书云端实际文件对账(云端✓/✗·无台账孤儿) + 组长上传/删除',
    features: [
      '资源库(核对): 新增「核对云端」按钮, 扫描 vehicle_images/vehicle_videos 实际文件, 逐项标记 云端✓/云端✗',
      '资源库(孤儿): 云端存在但台账无引用的文件单独列出(状态=孤儿), 可预览/删除',
      '资源库(上传): 组长选择车型后可批量上传照片/视频, 自动建目录、按车型命名并回写 photoPaths/videoPaths',
      '资源库(删除): 组长可在预览中删除云端文件, 同步解除所有车型引用(不可恢复, 二次确认)',
      '资源库(预览): 台账缺失/孤儿但云端存在时, 支持「云端加载」直接读取飞书文件预览',
      '修复(App): media_library.json 随 APK/IPA 打包, 且索引加载支持 fetch → XHR → 线上三级兜底, 修掉 App 内「资源索引加载失败」',
      '资源库(兼容): 保留 V10.25.8 索引移仓根/Pages 可访问, 以及 V10.25.7 台账/筛选/导出全部能力'
    ]
  },
  {
    version: 'V10.25.9',
    date: '2026-11-23',
    highlight: '资源库排版修复: 筛选条不再被 flex 压塌 + 列表标题改为文件名',
    features: [
      '修复: .screen 是 flex 列容器, 直接子项被 flex-shrink 压塌 —— 筛选条只剩 4px, 点不到',
      '修复: 头部固定 + 正文进 .scroll-y flex-1 min-h-0, 滚动与安全区恢复正常',
      '修复: 列表标题改为文件名, 车型名只在下行显示(旧版重复两遍)',
      '验证: 无头 Chrome 逐屏截图(登录/车型/详情/资源库/缺失筛选/预览弹层/数据/我的/关于)'
    ]
  },
  {
    version: 'V10.25.8',
    date: '2026-11-23',
    highlight: '资源库修复: 索引移到仓库根(docs/ 不在 Pages 发布白名单), 同步流水线自动重建',
    features: [
      '修复: media_library.json 位置从 docs/ 改到仓库根, deploy-pages 发布清单与触发路径同步补上',
      '修复: 此前网页端点开资源库会报"索引加载失败"(线上 docs/ 路径 404); App 与网页端现在一致',
      'CI: sync-web-data 每次同步后自动重建索引并提交, 数据变索引即变',
      '功能不变: 314 条台账 / 五档计数 / 筛选搜索 / 预览 / 一键复制缺失清单'
    ]
  },
  {
    version: 'V10.25.7',
    date: '2026-11-23',
    highlight: '资源库: 100 台车的照片/视频统一台账(搜索·筛选·预览·一键导缺失清单)',
    features: [
      '新增 我的 → 资源库 / 侧滑菜单入口, 离线可用',
      '五档计数: 资产 / 照片 / 视频 / 缺失 / 共享, 一眼看出还差多少素材',
      '按 缺失·共享·云端视频·未归类·照片·视频 筛选, 支持车型名/文件名搜索',
      '点开即预览(照片大图 / 视频播放), 显示路径·大小·指纹, 可复制路径或跳转车型',
      '「复制缺失清单」一键导出(车型/类型/文件), 直接发给补拍的人',
      '工程: 新增 scripts/gen_media_library.js → docs/media_library.json(314 条), 路径规则复用 00-media-paths 单一真源'
    ]
  },
  {
    version: 'V10.25.6',
    date: '2026-11-23',
    highlight: '数据同步修复: 收流整段解码(修掉反复写坏中文的根因) + 镜像冻结两周后恢复刷新',
    features: [
      '修复(同步解码): 收流改为 Buffer 整段拼接后一次性解码, 旧写法会在 TCP 分块边界把汉字切成 U+FFFD',
      '修复(数据): 镜像从 11-09 刷新到 11-23, 车型 100 / 品牌 12 / 账号 11 / 反馈 2, vehicles_data 与媒体映射一并重生成',
      '工程(诊断): 熔断带 ::error:: 注解与「源文件 token/修改时间 + 本次车数 + 已有镜像 syncedAt」, 失败可自解释',
      'CI(闭环): 同步失败自动开 issue、恢复自动关闭; 补 labeler 配置并升 v7',
      '测试(新增): 多字节分块解码回归 + 镜像熔断可诊断性回归'
    ]
  },
  {
    version: 'V10.25.5',
    date: '2026-11-23',
    highlight: '自动化修复: 数据镜像流水线失败不再静默(自动开单/关单) + Labeler 配置补齐 + 工程元信息补全',
    features: [
      'CI(镜像同步): 熔断改打 ::error:: 注解 + 自解释诊断(源文件 token/修改时间、本次车数、已有镜像 syncedAt/车数), 并提示 --force 处置',
      'CI(告警闭环): sync-web-data 失败自动开 issue、恢复自动关闭 —— 修掉「连续失败 49 次无人察觉、镜像冻结两周」的根因',
      'CI(Labeler): 补 .github/labeler.yml(仅用已有标签), actions/labeler v4 → v7; 此前 18 次运行 0 次成功',
      '工程(元信息): package.json 补 name/version/private/description/license/engines, 版本门禁增加非阻断漂移提示',
      '测试(新增): test_v10255_mirror_diag(21 断言, 本地模式实跑 CLI 验证熔断可诊断且不覆盖产物)',
      '说明: 本版不含业务代码变更, App 行为与 V10.25.4 一致, 仅版本号前进'
    ]
  },
  {
    version: 'V10.25.4',
    date: '2026-11-10',
    highlight: '媒体链路修复: 上传幂等按车型作用域 + 失败不再降级顶层 + 客户端候选路径回退',
    features: [
      '媒体(幂等): 判重键改为「车型目录/文件名」, 修复 A 车型同名文件导致 B 车型被跳传',
      '媒体(防散乱): 子目录创建失败不再静默降级顶层, 改为重试+抛错, 保留下轮重试',
      '媒体(回退): 客户端新增候选路径回退(原路径 → _共享/同名 → 顶层/同名)',
      '媒体(映射): 直链映射补齐 3 条, 50 → 53',
      '工程(守卫): 保留目录名断言, 防车型目录与系统目录撞名'
    ]
  },
  {
    version: 'V10.25.0',
    date: '2026-10-10',
    highlight: '媒体工程化版: 图片/视频按车型名分文件夹(GitHub + 飞书同构)杜绝错配 + 账号注销防复活(墓碑)与生命周期加固',
    features: [
      '媒体(结构化): 图片/视频按车型名分文件夹存储, 单一真源加三段式路径下钻定位, GitHub 与飞书同构, 从结构上杜绝媒体与车型错配; 存量迁移单车163 + 共享14 + 未归类16 共 193 个文件',
      '账号(防复活): 新增 tcg_deleted_users 墓碑机制, 三条删除路径统一经 State.removeUser 收口落墓碑, 云端 deleted 名单跨设备传播, 所有复活点前置拦截',
      '账号(自助注销): 新增自助注销入口(菜单 + 02-auth), 用户可自主发起注销',
      '安全(生命周期加固): 忘记密码重置写 pw_ts 修复跨设备仲裁、登出清理账号作用域缓存防串号、改密重建会话重新签名 sig 修复篡改绕过',
      '工程(门禁): 新增 web-data 脱敏门禁与 c8 行覆盖率验收门禁(js/ 可归因源文件 >= 95%), 新增 docs/codebase 七篇知识文档'
    ]
  },
  {
    version: 'V10.20.2',
    date: '2026-10-09',
    highlight: '仓库治理版: AI 工具配置目录出库 + LICENSE 补全, 不涉及 APP 功能与 versionCode 语义变更',
    features: [
      '仓库卫生(出库): 59 个 AI 工具配置目录(实体副本 + 符号链接农场)取消 git 跟踪, 移除 2576 个与业务无关的跟踪文件; 本地文件全部保留, 不删除任何内容',
      '复检补漏: 非根目录 data/skills/ 下 28 条 lark 技能符号链接一并出库, 全程扫描确认无残留泄漏点',
      '合规: 补 Apache-2.0 LICENSE 全文, 修复 GitHub 无法识别仓库许可证的问题',
      '文档: README 由 V10.11.0 更新至当前版本现状(版本 / 结构 / 功能 / 测试 / 安全)'
    ]
  },
  {
    version: 'V10.20.1',
    date: '2026-10-06',
    features: [
      '照片空态改为「诚实空态」: 删除灰图占位, 详情格/缩略图直接写明「照片缺失·云端与本地均无此文件」, 不再让人误以为还在加载',
      '查看器大图区分两种缺失: 登记了但取不到(联系组长补传) / 车型本就没登记(需重新拍摄上传)',
      'web-data 镜像改为按 modified_time 取同名最新副本, 并加写入前回滚熔断(新车数少于旧车数即拒绝覆盖), 防止网页端倒回 82 车',
      '编码校正表 30 → 35 条, 兜住本轮同步批次新增的 5 处 U+FFFD 损坏'
    ]
  },
  {
    version: 'V10.20.0',
    date: '2026-10-04',
    highlight: '组长重置口令安全加固版: 不再写死固定口令 123456, 改为 12 位随机一次性口令',
    features: [
      '安全(随机口令): 新增 generateRandomPassword 原语——CSPRNG(crypto.getRandomValues)取随机字节, 不可用时降级 Math.random; 拒绝采样消除取模偏差; 去歧义字符集(去除 0/O/o/1/l/I), 长度 12 位',
      '安全(重置改写): resetMemberPass 改为随机口令+哈希存储(genSalt 加盐 PBKDF2), 同步刷新 pw_ts 与 linkKey 供组员端仲裁, 明文口令绝不落盘/上云',
      '安全(展示收敛): 新增 reset-pass 弹层一次性展示新口令(附复制按钮), 关闭即清空; toast/日志/云端回传均不含明文',
      '工程(门禁): 新增 resetMemberPass 加固回归测试(34 断言), 并入 test:all 与 CI 覆盖率门禁; 全量套件由 47 增至 48'
    ]
  },
  {
    version: 'V10.19.5',
    date: '2026-10-03',
    highlight: '飞书限流根治版: 请求门控+退避重试+列表缓存, 云端图片/视频加载不再随机失败',
    features: [
      '治理(请求门控): 飞书API全局最小间隔150ms+并发上限3, 掐断突发并发撞QPS限流(99991400)',
      '治理(限流退避): 限流码99991400~99991404与网络错误指数退避重试(仅幂等GET/HEAD, 预算3次), 耗尽优雅降级不崩溃',
      '治理(统一下载): 新增 feishuDownloadFile 门控下载入口, 图片/视频下载全部切换接入(旧裸请求完全绕过门控是根因)',
      '治理(列表缓存): 目录列表30s缓存, 折叠图片加载反复列目录的高QPS请求',
      '工程: 新增限流治理专项测试(门控/退避/缓存接线, 动态用例桩掉网络层)'
    ]
  },
  {
    version: 'V10.19.4',
    date: '2026-10-02',
    highlight: '环境对齐与别名安全加固版: 飞书新环境配置 + 视频别名歧义拒绝',
    features: [
      '配置(对齐): 飞书 appId/folderToken/bitableAppToken/bitableFeedbackTableId 更新为新环境实值(新应用/文件夹/问题反馈库); 修复 Python 发版脚本读取 folderToken 字段',
      '安全(视频别名): 别名解析对「归一化键歧义」整体拒绝(≥2 份源资产或为其它键前缀一律不猜, 宁可漏不可错); 长安深蓝(G318)/长安启源(EADO PLUS) v2 重传属已知歧义, 靠精确名直链播放',
      '修复: 注册投递 appVersion 残留全局版本引用(恒取 undefined)改回 APP_VERSION; 视频映射同步脚本补逗号防语法断裂; 钥匙盒文案 U+FFFD 残留消除'
    ]
  },
  {
    version: 'V10.19.3',
    date: '2026-09-16',
    highlight: '诊断加固版: 先自检再升级 + 注册页返回泄漏修复',
    features: [
      '新增(诊断): 「关于」页「运行环境自检」显示加密能力 可用/不可用(实证探测, 不靠「能登录」间接判断)',
      '修复(诊断): 安全升级失败不再静默 —— ①设备不支持→换较新手机/联系组长 ②回传失败→检查网络+重试上传',
      '修复(导航): 未登录时任何返回路径都不进应用内页面(注册页按返回不再落主界面); 用户卡去掉硬编码占位',
      '修复: 反馈「APP版本」字段不再恒为 Vunknown',
      '修复(工具链): 飞书发版目录名/迁移 syncVersion 改从 version.json 读取(不再写死 10.17.1)',
      '含 10.19.2 全部内容(linkKey 惰性迁移 + 网页端登录提示)'
    ]
  },
  {
    version: 'V10.19.2',
    date: '2026-09-15',
    highlight: '网页端登录修复版: 修「App能用/网页端报密码错误」的 P0 迁移缺口',
    features: [
      '网页端登录失败: 通用可操作提示, 引导去 App 完成升级后重试(不泄露账号存在性)',
      'App 迁移闭环: 启动检测缺 linkKey 一次性引导重登 + 低频补推, 不静默失败',
      '缓存: sw.js CACHE_NAME 升版, 解除缓存优先导致修复到不了用户'
    ]
  },
  {
    version: 'V10.19.1',
    date: '2026-09-15',
    highlight: '稳定性加固版: 修新建车辆照片分区丢失 + 三处工程防线',
    features: [
      '新建车辆: addVehicle 补回照片分区/备注三字段, 配回归断言防复发',
      '版本门禁: 扩展至 sw.js/demo.html/兜底字面量, 漏改升版即拦截',
      '测试覆盖: CI 改 test:all 聚合入口, 覆盖率 63.8%→100%',
      'Android 构建: 移除失效第三方 action, 改用 runner 预装 SDK'
    ]
  },
  {
    version: 'V10.19.0',
    date: '2026-09-14',
    highlight: '视频可播性修复版: 无封面/迭代失效/网页不可播 + 隐私白名单',
    features: [
      '视频封面: 收敛单一真源, 未播放态可见车型名封面不再黑屏',
      '迭代失效: 上传改名失配修复 + 原名留档, 改名后仍可播',
      '网页可播: 走免鉴权 Release 直链, 无源可播时优雅降级',
      '隐私: 公开镜像加字段白名单, 手机号/密码哈希脱敏'
    ]
  },
  {
    version: 'V10.18.0',
    date: '2026-09-14',
    highlight: '审批闭环加固版: 飞书群拒绝通知 + 视频按车型名命名',
    features: [
      '飞书群拒绝通知 chatId 落地, 被拒申请即时弹窗通知',
      '视频上传按车型名称命名, 便于云端人工辨识',
      '播放器封面显示, 继承 V10.17.x 全部能力'
    ]
  },
  {
    version: 'V10.17.0',
    date: '2026-09-14',
    highlight: '注册闭环与视频恢复版: 拒绝通知+网页注册+视频直链全覆盖',
    features: [
      '拒绝闭环: 组长拒绝后组员端同步rejected状态并弹“未通过审核”通知,登录文案精准化',
      '网页注册: 网页端开放自助注册(GitHub登记库+镜像工作流转投飞书),安卓审批流零改动',
      '视频恢复: 直链映射46全覆盖,失效源复用Release资产秒开;双层封面不再黑屏',
      '命名规则: 上传照片/视频按车型名称命名,云端文件一眼可辨,幂等语义不变',
      '继承 V10.16.7(反馈状态流转+可见性)全部能力'
    ]
  },
  {
    version: 'V10.16.7',
    date: '2026-09-08',
    highlight: '反馈系统修复版: 状态流转对齐+可见性修复',
    features: [
      '状态流转: 反馈AI分析后为待处理,组长确认处理好后为已处理,历史值自动归一',
      '反馈可见性: 反馈/同步链路凭据统一,组员提交的反馈组长全部可见(含分页拉全量)',
      '组员管理: 组长端进入组员管理页自动拉云端全量用户,往期审批组员恢复可见可管理',
      '网页端: 反馈镜像带问题描述,云端组员以只读卡片合并展示',
      '继承 V10.16.6 全部能力'
    ]
  },
  {
    version: 'V10.16.6',
    date: '2026-09-08',
    highlight: '组员管理修复版: 跨端组员可见可管理',
    features: [
      '反馈修复: 网页端注册的组员在组长端组员管理页恢复显示, 可重置密码/删除',
      '来源标识: 跨端注册组员带紫色"跨端"角标, 区分APP注册与网页注册',
      '不变式: 跨端申请审批静默策略不变(自动通过不进待审队列)',
      '继承 V10.16.5 全部能力'
    ]
  },
  {
    version: 'V10.16.5',
    date: '2026-09-08',
    highlight: '信息保护版: 错误信息脱敏+注册限流+生产日志静默',
    features: [
      '信息脱敏: 登录失败统一提示"账号或密码错误", 不暴露账号是否存在',
      '注册限流: 同一设备1小时内最多注册3次, 防止批量注册',
      '日志静默: 生产环境(Cordova)静默console.log, 保留warn/error',
      '继承 V10.16.4 全部能力'
    ]
  },
  {
    version: 'V10.16.4',
    date: '2026-09-08',
    highlight: '认证强化版: 登录限流+空闲超时+密码强度',
    features: [
      '登录限流: 连续5次密码错误锁定5分钟, 防止暴力破解',
      '空闲超时: 30分钟无操作自动登出, 防止遗忘设备会话劫持',
      '密码强度: 注册/重置密码须含数字+字母, 杜绝纯数字弱密码',
      '继承 V10.16.3 全部能力'
    ]
  },
  {
    version: 'V10.16.3',
    date: '2026-09-08',
    highlight: '安全加固续篇: 凭据加密存储+XSS绊线生产生效+SW同源校验',
    features: [
      '凭据加密: feishu_config中appSecret以appSecretEnc(XOR+base64)存储, 不再明文落盘; 旧明文自动兼容',
      'XSS绊线: innerHTML注入绊线扩展到生产环境, console.warn留痕不阻断功能',
      'SW校验: sw.js message事件校验e.source来源, 仅同源页面可触发skipWaiting',
      '继承 V10.16.2 全部能力'
    ]
  },
  {
    version: 'V10.16.2',
    date: '2026-09-08',
    highlight: '纵深防御版: CSP策略+PBKDF2密码哈希+会话HMAC签名',
    features: [
      'CSP: demo.html添加Content-Security-Policy meta, 限制script/img/connect来源',
      'PBKDF2: 密码哈希从单轮SHA-256升级到PBKDF2(10万迭代), 暴力破解成本提升数万倍',
      '会话签名: tcg_session新增HMAC-SHA256签名, 篡改uid即失效, 旧会话自动补签',
      '继承 V10.16.1 全部能力'
    ]
  },
  {
    version: 'V10.16.1',
    date: '2026-09-08',
    highlight: '安全加固版: 移除硬编码组长手机号+默认弱密码,密码重置新增双重校验',
    features: [
      '安全加固1: 移除 LEADER_PHONE 硬编码与默认账号123456,首个注册用户自动为admin,后续为待审组员',
      '安全加固2: doForgotPassword 新增姓名+手机号双重校验,仅凭手机号无法重置密码',
      '继承 V10.16.0 全部能力'
    ]
  },
  {
    version: 'V10.16.0',
    date: '2026-09-07',
    highlight: 'AI自主进化·阶段1: 排序自学习+照片手势引擎+视频预取秒开',
    features: [
      '排序自学习: 查看车型详情即记频次(vehicle_view_counts持久化,上限200条),列表按频次降序重排,高频车型自动前置',
      '最近查看持久化(tcg_recent_vehicles): 重启保留,自学习痕迹不丢',
      '照片手势引擎重构: 双指捏合缩放(1x~4x锚点跟随)+放大后拖拽平移+单击1x↔2.5x+越界钳制+缩放倍数徽标,修复"无法放大查看指定位置"',
      '照片智能高清回退: 本地图分辨率<700px时后台探测飞书云端同名原图,仅更高清才热替换,组长后传高清照片即时生效',
      '视频后台预取: 详情页打开即静默预取首个教学视频到磁盘缓存(GitHub Release直链),点开秒播',
      '版本文档清理: docs/删除39个过期RELEASE/DEVLOG(git历史永久可查),保留最新一对+核心架构文档',
    ]
  },
  {
    version: 'V10.15.15',
    date: '2026-09-07',
    highlight: '数据池统一+仓库文件整理: 统一车型数据源+删除冗余文件',
    features: [
      '统一车型数据池: demo.html加载vehicles_data.js为唯一内置数据源,00-bootstrap.js内联73条改为引用window.VEHICLES,消除38KB重复',
      '内置数据与用户新增车型统一在同一VEHICLES数组,IndexedDB持久化+飞书云端同步',
      '仓库文件清理: 删除release/3个旧文档(与docs/重复),删除web-data/debug_structure.json(自动生成),删除.trae-html-share-packages/构建产物',
      '继承V10.15.14全部修复(pw_ts仲裁>=+mergeUser)',
    ]
  },
  {
    version: 'V10.15.14',
    date: '2026-09-07',
    highlight: '紧急修复: 改密后换设备登录仍报密码错误(pw_ts仲裁边界+镜像丢密码)',
    features: [
      '根因1: 05-sync.js/09-web-sync.js密码仲裁 cuTs>loTs——旧版本改密不写pw_ts(=0),云端与本地均为0时严格大于永不成立,新密码永不被采纳',
      '根因2: sync_web_data.js多源合并approved_users.json只按文件时间戳取整个对象,新根文件时间戳新但密码旧会冲掉旧根改密后的新哈希',
      '修复1: 密码仲裁改为 cuTs>=loTs,相等时以云端权威源为准,新设备/旧设备均能拿到新密码',
      '修复2: sync_web_data.js新增mergeUser,密码字段单独按pw_ts仲裁(>=),备份与verify快照统一走mergeUser',
      '全量回归0 FAIL',
    ]
  },
  {
    version: 'V10.15.13',
    date: '2026-09-07',
    highlight: '紧急修复: 密码跨设备同步整表覆盖竞态+网页端改密假成功',
    features: [
      '根因1: pushApprovedUsersToFeishu整表覆盖竞态——组长在旧设备审批/删除组员时,本机USERS表缺其他组员新改的密码,覆盖云端把别人新密码冲回旧值',
      '根因2: 网页端改密假成功——网页版只读镜像CORS不可达飞书API,push被封堵,改密只改本浏览器不推云端',
      '修复1: pushApprovedUsersToFeishu内部强制fullMerge,按pw_ts仲裁保留本机新密码+补充云端用户',
      '修复2: 网页端禁止改密,引导至安卓APP操作',
      '继承V10.15.12登录失败拉云端重试',
    ]
  },
  {
    version: 'V10.15.12',
    date: '2026-09-06',
    highlight: '紧急修复: 旧设备新密码登录报密码错误',
    features: [
      '根因: doLogin仅本地无账号时才拉云端,本地旧密码哈希验证失败直接报错返回,云端最新密码永远没机会参与验证(V10.15.11修复缺口)',
      '修复: 本地验证失败→拉云端最新名单(pw_ts仲裁采纳新哈希)→重试验证一次再判定',
      '覆盖: 旧设备新密码登录/云端未更新不误放行/新设备建号登录,网页端共用链路同步受益',
      '新增4项登录闭环测试,专项40项+全量回归全绿',
    ]
  },
  {
    version: 'V10.15.11',
    date: '2026-09-06',
    highlight: '问题反馈多端同步+组长状态审核+密码跨设备同步',
    features: [
      '问题反馈多端同步:组员反馈按提交人跨设备拉回(换机/重装不丢),云端状态/AI摘要/技术文档链接同步展示',
      '组长状态审核:组长可将反馈标记为已解决/待处理(云端Bitable回写),全端同步可见',
      '修复组长角色判断Bug:反馈模块4处误用role===leader(实际为admin)致审核按钮永不显示、云端全量反馈拉不到',
      '密码跨设备同步:改密推送云端+账号级pw_ts时间戳仲裁,旧设备拉取采纳新密码哈希(修复改密后换设备新密码失效)',
      '权限加固:setFeedbackStatus/resetMemberPass函数层组长守卫,禁重置组长账号密码',
      '网页端反馈镜像:web-data/feedback_data.json只读镜像(脱敏),写入/审核封堵并引导走安卓端',
      '版本三源对齐:config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.11',
      '继承 V10.15.10 网页版分享降级链版全部能力',
    ]
  },
  {
    version: 'V10.15.10',
    date: '2026-09-06',
    highlight: '网页版分享降级链',
    features: [
      '文件导出降级链:系统分享面板不可用时自动降级浏览器下载(a.download→window.open→msSaveBlob)',
      '文本分享execCommand保底:剪贴板API不可用的旧浏览器/非HTTPS环境仍可复制断电信息',
      'Web Share API优先逻辑不变,降级仅在系统分享彻底不可用时触发',
      '浏览器E2E实测:PDF/Excel/Word三格式全部成功触发下载',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.10',
      '继承 V10.15.9 批量导出全格式去图+网页端账号同步修复版全部能力',
    ]
  },
  {
    version: 'V10.15.9',
    date: '2026-09-06',
    highlight: '批量导出全格式去图+网页账号登录修复',
    features: [
      '批量导出Word/PDF/Excel全部不含图片(仅单车导出含图),减小体积加快导出',
      '修复安卓端注册账号无法在网页端登录:飞书双根approved_users.json合并去重,镜像账号从1个恢复到10个',
      '弱网优化:网页镜像fetch加10s超时,不再挂起阻塞UI',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.9',
      '继承 V10.15.8 批量导出PDF不含图片版全部能力',
    ]
  },
  {
    version: 'V10.15.8',
    date: '2026-09-06',
    highlight: '批量导出PDF不含图片',
    features: [
      '_buildExportHtml() includeImages 默认值改为 false,批量导出PDF不再内嵌车辆照片,仅显示照片数量',
      'exportData() PDF 分支跳过照片预取,导出速度更快',
      '单车详情页Word/PDF导出仍保留照片内嵌,不影响单车导出体验',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.8',
      '继承 V10.15.7 批量导出Word不含图片版全部能力',
    ]
  },
  {
    version: 'V10.15.7',
    date: '2026-09-06',
    highlight: '批量导出Word不含图片',
    features: [
      '数据中心批量导出的Word不再内嵌车辆照片，仅显示照片数量，避免文档体积过大导致微信/钉钉分享超限',
      '单车详情页Word导出仍保留照片内嵌，不影响单车导出体验',
      'PDF批量导出保持含图不变',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.7',
      '继承 V10.15.6 账号级字段选项云同步版全部能力',
    ]
  },
  {
    version: 'V10.15.6',
    date: '2026-09-06',
    highlight: '账号级字段选项云同步',
    features: [
      '断电位置/钥匙处理方式/断电步骤字段选项升级为账号级云同步(飞书「偏好设置」子目录 field_options.json)',
      '组长端增删改字段选项后自动上传云端，换机/重装登录即可同步，修复本地持久化跨设备不共享问题',
      '组员/新设备登录或拉取数据时自动下载云端选项，与组长端保持一致',
      '本地持久化仍为兜底，云端为权威自定义层(默认种子+数据库内容为基底)',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.6',
      '继承 V10.15.5 反馈迭代版全部能力',
    ]
  },
  {
    version: 'V10.15.5',
    date: '2026-09-06',
    highlight: '字段选项模块化 + 照片分板块上传',
    features: [
      '批量导出 Word 结构调整为「首张总表(不含图片) + 每车含图分表」，与车辆详情页导出一致',
      '断电位置/钥匙处理方式/断电步骤字段选项模块化，按当前数据库内容生成可增删改选项',
      '媒体照片分板块上传(车辆外观/车钥匙/断电位置三板块, 每板块<=5张)，压缩提升至1600px/90%',
      '同步/导出携带 photoSections/photoLabels/keyPhotoRemark 元数据',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.5',
      '继承 V10.15.4 问题反馈修复版全部能力',
    ]
  },
  {
    version: 'V10.15.4',
    date: '2026-09-06',
    highlight: '问题反馈修复版',
    features: [
      '批量导出 Word 在总表后追加每车含图分表，修复反馈「批量导出Word不含图片」',
      '问题反馈板块选项由 8 项细化为 15 项，覆盖车型/搜索/照片/详情/步骤/钥匙/单车导出等细分场景',
      '车辆照片压缩由 800px/70% 提升为 1280px/80%，修复反馈「照片压缩太严重」',
      '版本三源对齐：config.xml / version.json / js/00-bootstrap.js 同步至 V10.15.4',
      '继承 V10.15.3 反馈自动分析管道与飞书群通知闭环全部能力',
    ]
  },
  {
    version: 'V10.15.3',
    date: '2026-09-06',
    highlight: '真实DeepSeek分析 + 飞书群通知闭环',
    features: [
      '反馈自动分析管道升级为真实 DeepSeek LLM 分析，配置 Secrets 后生成 AI 摘要',
      '修复飞书群通知推送参数缺失，打通提交→AI分析→飞书群通知→迭代闭环',
      '状态闭环回写：待处理→分析中→已解决，回写摘要与文档链接',
      '端到端验证通过：DeepSeek 摘要格式区别于内置模板，测试记录已清理',
    ]
  },
  {
    version: 'V10.15.2',
    date: '2026-09-06',
    highlight: '数据后端升级 + 安全加固',
    features: [
      '新增飞书多维表格(Bitable)后端数据层与 Drive→Bitable 迁移脚本',
      '新增审计日志模块：环形缓冲 500 条，删除/清空操作留痕',
      '构建期密钥升级为 XOR+base64 双重加密，明文 Secret 永不落盘',
      '新增 R8/ProGuard 加固钩子，保护 Cordova JS Bridge 防反射剥离',
    ]
  },
  {
    version: 'V10.15.1',
    date: '2026-09-06',
    highlight: '版本对齐与发布门禁',
    features: [
      '三处版本号对齐：config.xml / version.json / bootstrap APP_VERSION 统一为 10.15.1',
      '新增 scripts/check_version_consistency.js 发版门禁，纳入 npm test:all',
      '修复 SDK 数据源解析与参数名契约，反馈提交与读取更稳定',
      '关于页版本号、同步屏「本地版本」显示同步刷新',
    ]
  },
  {
    version: 'V10.15.0',
    date: '2026-09-06',
    highlight: '问题反馈+关于页面+多机型适配测试',
    features: [
      '新增问题反馈功能：按板块提交、支持截图、同步飞书多维表格',
      'AI智能分析：飞书智能体自动分析问题、生成技术文档、通知组长',
      '新增关于页面：版本历史、技术架构、开发工具、项目地址、开发者',
      '多机型屏幕适配测试：覆盖7种主流设备尺寸，消除留白/显示不全',
      '安卓端顶部留白修复：StatusBarOverlaysWebView=false',
    ]
  },
  {
    version: 'V10.14.4',
    date: '2026-09-06',
    highlight: '网页版数据同步修复',
    features: [
      '镜像脚本V2.5三入口遍历：云盘根+配置根+旧根',
      '安卓端82组车型数据完整同步到网页版',
      '注册审批后网页端可登录，账号密码完全一致',
      '自续链修复：5分钟同步周期稳定运转',
    ]
  },
  {
    version: 'V10.14.3',
    date: '2026-09-05',
    highlight: 'iOS PWA适配+网页版上线',
    features: [
      'iOS端PWA standalone模式适配：安全区、触控优化、键盘适配',
      'GitHub Pages网页版发布：iOS组员免安装即可使用',
      '飞书云端数据镜像方案：5分钟自动同步',
      '手机号SHA-256脱敏登录：保护隐私的同时支持跨端登录',
    ]
  },
  {
    version: 'V10.13.0',
    date: '2026-08-20',
    highlight: 'iOS平台支持+注册审批四刀切',
    features: [
      '新增iOS平台Cordova构建支持',
      '注册申请拉取A3四刀切方案：健壮性大幅提升',
      '飞书API三端统一封装：Android/iOS/Web',
    ]
  },
  {
    version: 'V10.9.0',
    date: '2026-08-10',
    highlight: '屏幕自适应+老旧WebView兼容',
    features: [
      '修复Android WebView顶部状态栏遮挡标题问题',
      '修复底部按钮被导航栏遮挡问题',
      '新增全尺寸断点适配：小屏/大屏/矮屏/超长屏/横屏',
      '老旧WebView min-height:0滚动修复',
    ]
  },
  {
    version: 'V10.7.0',
    date: '2026-07-25',
    highlight: '视频缓存+导出文档',
    features: [
      '视频下载缓存机制：离线可看断电操作视频',
      '导出操作指南文档：PDF/Word格式',
      '缓存管理功能：查看/删除已缓存内容',
    ]
  },
  {
    version: 'V10.2.0',
    date: '2026-06-15',
    highlight: '组员管理+批量导出',
    features: [
      '组员管理模块：注册审批、角色分配',
      '批量导出操作记录',
      '缓存管理入口+红点通知',
    ]
  },
  {
    version: 'V5.7.0',
    date: '2026-05-20',
    highlight: '飞书云存储+数据同步',
    features: [
      '飞书开放平台云存储集成',
      '组长/组员数据同步机制',
      '车辆数据云端备份与恢复',
    ]
  },
  {
    version: 'V1.0.0',
    date: '2026-03-01',
    highlight: '项目启动+基础功能',
    features: [
      '太仓港商品车断电操作指导APP立项',
      '车型数据库基础架构',
      '断电操作步骤标准化',
      'Android端首版发布',
    ]
  },
];

const TECH_STACK = [
  { icon: '📄', name: '前端', value: 'HTML5 / CSS3 / Vanilla JavaScript' },
  { icon: '📱', name: '移动端', value: 'Apache Cordova 12 + cordova-android 13' },
  { icon: '☁️', name: '云存储', value: '飞书开放平台 OpenAPI / Bitable' },
  { icon: '🌐', name: '网页端', value: 'PWA + GitHub Pages' },
  { icon: '⚙️', name: 'CI/CD', value: 'GitHub Actions + 自续链同步' },
  { icon: '🔒', name: '安全', value: 'SHA-256 密码哈希 / 手机号脱敏' },
];

const DEV_TOOLS = [
  { icon: '💻', name: 'IDE', value: 'Trae / VS Code' },
  { icon: '🧪', name: '测试', value: 'Chrome DevTools 设备仿真' },
  { icon: '📦', name: '构建', value: 'Cordova CLI' },
  { icon: '📊', name: '版本管理', value: 'Git + GitHub' },
  { icon: '🤖', name: 'AI辅助', value: 'Trae AI 编程助手' },
  { icon: '🎨', name: '设计', value: '原生CSS + SVG图标' },
];

const PROJECT_LINKS = [
  { icon: '📦', name: 'GitHub 仓库', url: 'https://github.com/361087210/taicanggang-poweroff-guide' },
  { icon: '🌐', name: 'GitHub Pages', url: 'https://361087210.github.io/taicanggang-poweroff-guide/demo.html' },
  { icon: '📁', name: '飞书数据平台', url: 'https://mwawzzuvb7f.feishu.cn/drive/home/' },
];

let _expandedVersion = null;

window.initAboutPage = function() {
  renderAboutPage();
};

function renderAboutPage() {
  const html = `
    <div class="sticky top-0 z-30 bg-white shadow-sm">
      <div class="pt-12 px-4 pb-3 flex items-center gap-3">
        <button onclick="showScreen('screen-my')" class="w-8 h-8 flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-5 h-5"><path d="M15 18l-6-6 6-6"/></svg>
        </button>
        <h2 class="text-base font-bold">关于</h2>
      </div>
    </div>
    <div class="flex-1 scroll-y px-4 pb-24 pt-4 space-y-4">
      <!-- Logo & 版本 -->
      <div class="bg-gradient-to-br from-blue-700 via-blue-600 to-blue-500 rounded-2xl p-6 text-white text-center">
        <div class="w-16 h-16 mx-auto mb-3 bg-white/20 rounded-2xl flex items-center justify-center">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-8 h-8">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
        </div>
        <div class="text-lg font-bold">太仓港断电指导</div>
        <!-- V10.19.1: 兜底字面量由 10.15.0 同步为当前版本。该兜底仅在
             APP_VERSION 缺失时生效, 而一旦它生效, 它就是用户看到的"版本号"——
             留着旧值等于静默展示过期版本。scripts/check_version_consistency.js
             已把这类 APP_VERSION 兜底字面量纳入强校验, 下版忘了改会直接拦下。
             注意: 本文件是模板字符串, 注释里禁止出现反引号, 否则会截断模板。 -->
        <div class="text-xs text-white/60 mt-1">V${APP_VERSION || '10.28.1'}</div>
        <div class="text-xs text-white/50 mt-0.5">商品车断电操作标准化平台</div>
      </div>

      <!-- 版本历史 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>📋</span>
          <span class="text-sm font-bold text-gray-700">版本历史</span>
          <span class="text-xs text-gray-400 ml-auto">共 ${VERSION_HISTORY.length} 个版本</span>
        </div>
        <div class="version-timeline space-y-1" id="about-version-list">
          ${VERSION_HISTORY.map((v, i) => renderVersionItem(v, i)).join('')}
        </div>
      </div>

      <!-- 运行环境自检(提交组A: 让组长更新 App 后"先看一眼就知道能不能成", 无需反复试) -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>🛡️</span>
          <span class="text-sm font-bold text-gray-700">运行环境自检</span>
        </div>
        <div class="flex items-center gap-3 py-1.5">
          <span class="text-base" id="about-crypto-cap-icon">⏳</span>
          <span class="text-xs text-gray-500 w-40">安全升级所需加密能力</span>
          <span class="text-xs font-medium text-gray-400 flex-1" id="about-crypto-cap">检测中…</span>
        </div>
        <div class="text-xs text-gray-400 mt-1 hidden" id="about-crypto-hint"></div>
      </div>

      <!-- 技术架构 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>🏗️</span>
          <span class="text-sm font-bold text-gray-700">技术架构</span>
        </div>
        <div class="space-y-2">
          ${TECH_STACK.map(t => `
            <div class="flex items-center gap-3 py-1.5">
              <span class="text-base">${t.icon}</span>
              <span class="text-xs text-gray-500 w-16">${t.name}</span>
              <span class="text-xs text-gray-700 flex-1">${t.value}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 开发工具 -->
      <div class="bg-white rounded-2xl p-4 shadow-sm">
        <div class="flex items-center gap-2 mb-3">
          <span>🔧</span>
          <span class="text-sm font-bold text-gray-700">开发工具</span>
        </div>
        <div class="grid grid-cols-2 gap-2">
          ${DEV_TOOLS.map(t => `
            <div class="flex items-center gap-2 py-1.5 px-2 bg-gray-50 rounded-lg">
              <span class="text-sm">${t.icon}</span>
              <div>
                <div class="text-xs text-gray-700 font-medium">${t.name}</div>
                <div class="text-xs text-gray-400">${t.value}</div>
              </div>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- 项目地址 -->
      <div class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="px-4 pt-3 pb-2 flex items-center gap-2">
          <span>🌐</span>
          <span class="text-sm font-bold text-gray-700">项目地址</span>
        </div>
        ${PROJECT_LINKS.map(l => `
          <div class="bs-item" onclick="openExternalLink('${l.url}')">
            <div class="flex items-center gap-3">
              <span class="text-base">${l.icon}</span>
              <span class="text-sm text-gray-800">${l.name}</span>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-300"><path d="M9 6l6 6-6 6"/></svg>
          </div>
        `).join('')}
      </div>

      <!-- 开发者 -->
      <div class="bg-gradient-to-br from-gray-800 to-gray-900 rounded-2xl p-5 text-white">
        <div class="flex items-center gap-3 mb-3">
          <div class="w-12 h-12 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 flex items-center justify-center text-lg font-bold">云</div>
          <div>
            <div class="font-bold">云飞呀云飞</div>
            <div class="text-xs text-white/60">全栈开发者</div>
          </div>
        </div>
        <div class="flex items-center gap-2 text-sm text-white/80">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
          </svg>
          <span>QQ: 361087210</span>
        </div>
      </div>

      <div class="text-center text-xs text-gray-400 py-2">
        © 2026 太仓港断电指导 · 保留所有权利
      </div>
    </div>
  `;
  document.getElementById('screen-about').innerHTML = html;
  // 异步填充"加密能力自检"结果(不阻塞渲染; 探测失败按不可用提示, 但绝不静默)
  (function(){
    const capEl=document.getElementById('about-crypto-cap');
    if(!capEl||typeof probeCryptoCapability!=='function') return;
    probeCryptoCapability().then(function(ok){
      const iconEl=document.getElementById('about-crypto-cap-icon');
      const hintEl=document.getElementById('about-crypto-hint');
      if(ok){
        capEl.textContent='可用';
        capEl.className='text-xs font-medium text-green-600 flex-1';
        if(iconEl)iconEl.textContent='✅';
      }else{
        capEl.textContent='不可用';
        capEl.className='text-xs font-medium text-red-600 flex-1';
        if(iconEl)iconEl.textContent='❌';
        if(hintEl){
          hintEl.textContent='本设备缺少所需加密能力，网页端安全升级无法完成；请换用较新的手机，或联系组长。';
          hintEl.classList.remove('hidden');
        }
      }
    }).catch(function(){ /* 探测异常: 保持"检测中"，不误导为可用 */ });
  })();
}

function renderVersionItem(v, index) {
  const isLatest = index === 0;
  const isExpanded = _expandedVersion === v.version;
  return `
    <div class="version-item">
      <div class="flex items-start gap-3 py-2 cursor-pointer" onclick="toggleVersion('${v.version}')">
        <div class="version-dot w-2.5 h-2.5 rounded-full ${isLatest ? 'bg-blue-500' : 'bg-gray-300'} mt-1.5 flex-shrink-0"></div>
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-2">
            <span class="text-sm font-bold ${isLatest ? 'text-blue-600' : 'text-gray-700'}">${v.version}</span>
            ${isLatest ? '<span class="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded">最新</span>' : ''}
            <span class="text-xs text-gray-400 ml-auto">${v.date}</span>
          </div>
          <div class="text-xs text-gray-500 mt-0.5">${v.highlight}</div>
          ${isExpanded ? `
            <div class="mt-2 pl-2 border-l-2 border-gray-100 space-y-1">
              ${v.features.map(f => `<div class="text-xs text-gray-500 flex items-start gap-1.5"><span class="text-blue-400 mt-0.5">•</span><span>${f}</span></div>`).join('')}
            </div>
          ` : ''}
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="w-4 h-4 text-gray-300 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}" style="margin-top:4px;"><path d="M9 6l6 6-6 6"/></svg>
      </div>
    </div>
  `;
}

window.toggleVersion = function(version) {
  _expandedVersion = _expandedVersion === version ? null : version;
  const list = document.getElementById('about-version-list');
  if (list) {
    list.innerHTML = VERSION_HISTORY.map((v, i) => renderVersionItem(v, i)).join('');
  }
};

window.openExternalLink = function(url) {
  if (window.cordova && window.cordova.InAppBrowser) {
    cordova.InAppBrowser.open(url, '_system');
  } else {
    window.open(url, '_blank');
  }
};

/* V10.15.0: 页面初始化(defer加载,DOM已就绪) */
if (document.getElementById('screen-about')) {
  window.initAboutPage();
}

})();
