# 太仓港停电指南 APP 迭代计划 V5.7

## 已交付 V5.7（当前）

### 四大问题根治
- [x] 文档分享：vendor 导出库与车辆图片完整打包进 APK
- [x] 返回键逻辑：编辑保存/登录/登出/弹层六级路由修正
- [x] 飞书备份分仓：同步数据/注册申请/审批结果/备份文件独立子文件夹
- [x] 跨网络注册审批：组员秒传云端 + 组长轮询 + 审批结果云端秒同步
- [x] 导出照片预取 20 秒超时保护；文件 token 缓存失效自动重试自愈

### CI 签名构建根治（V5.4 以来全链路修复）
- [x] `KEYSTORE_BASE64` 自动解码签名
- [x] Manifest merger 冲突根治 / FileProvider 资源补齐 / zipalign 全路径
- [x] 插件版本锁定（dialogs 2.0.2、x-socialsharing 6.0.4）、移除 qrscanner
- [x] `contents:write` 权限声明（Create Release 403 修复）

## 已交付 V5.3.6

### 核心改进
- [x] FeishuDataLayer 统一封装层
- [x] 车型/用户数据双向同步（Bitable）
- [x] 全量备份与恢复（云文档 JSON 快照）
- [x] 审批流完整化（创建/查询/状态同步）
- [x] 应用内直装更新（file-opener2）
- [x] Android 13+ 通知权限适配
- [x] 组长审批提醒升级为状态栏通知
- [x] config.xml content src 修正
- [x] 存储权限 maxSdkVersion 放宽

## 规划 V5.8（短期，见 docs/V5.8迭代计划.html）

### P0（2026-09 中旬）
- [ ] 数据同步冲突解决：rev 修订号 + 三方合并（两阶段提交）
- [ ] 注册审批推送实时化：飞书事件订阅替代 60 秒轮询（保留轮询降级）
- [ ] Secret 服务端化：云函数代理，APP 仅持设备码

### P1
- [ ] 飞书原生审批流对接（模板/状态机/通知）
- [ ] 工程化：demo.html 拆分模块化构建（Vite/TS）
- [ ] 存储层升级：localStorage → SQLite
- [ ] APK 加固与 SSL Pinning

### P2
- [ ] 崩溃与行为可观测性（错误上报飞书多维表格）
- [ ] 视频离线包与预加载策略
- [ ] 深色模式与适老化
