# V10.13.0 复杂度治理版 发布文档（方案A Phase A3）

| 项目 | 内容 |
|---|---|
| 版本 | 10.13.0 (versionCode 101300) |
| 发布日期 | 2026-09-01 |
| 发布类型 | 复杂度治理 + 可测试性改造 + 状态安全 |
| 一句话总结 | V10.12.0 九模块拆分后，对最复杂的审批拉取/列表渲染/全局数组写入三条链路深度开刀：四刀切+渲染业务分离+State守卫+XSS绊线，复杂度达标 Clean Code 阈值 |
| 关联文档 | `CHANGELOG.md`§10.13 · `docs/V1011_代码审查与优化方案.md`(A3输入) · `tests/test_v1013_a3.js`(68项专项) |

---

## 一、交付背景（复杂度超标 → 专项治理）

V10.12.0 代码审查报告给出三条不合格（C级以上缺陷）：

| # | 缺陷 | 指标 | 阈值 |
|---|------|------|------|
| C1 | `pullPendingFromFeishu` 165 行单函数 | 网络IO + 审批规则 + 持久化 + 渲染 4 职责混合 (SRP违规×4) | ≤1 职责 / ≤80行 |
| C2 | `VEHICLES/USERS` 全仓 27 处散点 push/splice 直写 | 提权/越界写入可被前端 inspector 直接操作 | 仅 State API 可写 |
| C3 | `renderVehicleList` 内联 217 行，含 业务过滤 + DOM 拼装 + state 读 三责混合 | 单测覆盖难度 >70%（未达标） | 纯业务函数 / 纯DOM函数分离 |

A1 单向收敛 + A2 九模块拆分仅完成"文件级切分"（Phase 1-2），**函数级复杂度与全局写风险仍未解决**；本次（Phase A3）针对性治理。

---

## 二、核心交付 4 大专项

### A3-1 四刀切：审批拉取从 1 函数 → 4 单一职责函数

| 序号 | 新函数 | 职责 | 行数 | 原代码对应段 |
|---|---|---|---|---|
| ① | `fetchPendingFromCloud(cfg, opts)` | 网络IO：双位置列目录→下载→JSON解析→载荷校验 | 42行 | 旧版 L821-884（含重试自愈分支双拷贝） |
| ② | `applyApprovalRules(pendings)` | 业务规则：跨网络默认通过(active+crossPlatform+hidden+即消费即删)/本端人工审批进入pending/已拒绝账号保留拒绝态不复活 | 40行 | 旧版 L885-940 |
| ③ | `writePendingsToStorage(result)` | 持久化：有变更才 saveUsers 落盘（无渲染职责） | 4行 | 旧版内联 saveUsers 2处 |
| ④ | `refreshMemberUI(result, silent, selfHeal)` | 渲染+通知：renderMemberList + updateMembersBadge + Toast + leaderNotify系统通知 + addSyncLog同步日志 + debouncePushApprovedUsers云端回推去抖 | 27行 | 旧版内联 5处UI渲染 |
| 薄壳 | `pullPendingFromFeishu(silent)` | 顺序编排：①→②→③→④ + 一次性自愈(invalidateDataFolderCache + retryToken) | ≤26行有效代码 | 旧版165行 → 瘦身84% |

**归并修复 3 处历史漂移**：
- 自愈分支曾仅列"注册申请"子目录 → 统一为双位置读取（新旧兼容）；
- 自愈分支处理完本端 pending 就删云端文件 → 统一为主分支"组长审批动作触发删除"（审批规则幂等）；
- 自愈分支跨网络申请计数漏写为 `cnt=0` → 导致 saveUsers/云端回推整条跳过的潜在丢档 → 统一计数 `crossSilentCount`。

### A3-2 渲染业务分离：车辆列表从 217 行内联 → 3 层纯函数

**原结构**（217 行，业务逻辑与 DOM 交错，无法独立单测）：
```
renderVehicleList():
  - 读取 state.searchQuery/brandFilter/viewMode
  - 内嵌遍历 if-else 过滤 VEHICLES (按 keyword + brand + pinyin + __other__)
    ↳ 内嵌拼 HTML 字符串
  - 平铺视图 / 树形视图交替分支(含展开态管理,系列二级grouping)
  - 写 innerHTML
```

**新结构**（可独立单测 / 可定位缺陷 / 复杂度≤12每函数）：
```
getFilteredVehicles()                      // 3行 state 桥接(便于oninput事件直接调)
  └── filterVehicles(keyword, brandId)     // 纯数据过滤: 无 DOM / 无 state 依赖 / 可注入任意数组测试
renderVehicleList()                        // 15行: 取过滤结果 → 持久化c.innerHTML= + refreshCount 更新
  └── renderVehicleCards(list)             // 纯DOM拼装: 入参是已过滤list → 出参是HTML字符串 / 平铺树形双模式纯内部分支
```

**性能**：同 A2-2 一次 Map 两级预分组方案保留，不降级。

### A3-3 状态守卫 State 门面：27 处散点写 → 100% 收敛到 API

**原则（读写隔离）**：
- **读**：外部代码只拿 `State.vehicles` 与 `State.users`，它们返回 `Array.slice()` **只读副本**（外部 push/pop 不会污染内部真实数组）
- **写**：全部 9 种写路径通过受控 API：

| API | 语义 | 内部处理 |
|---|---|---|
| `State.addVehicle(data)` | 创建语义：新增车辆(表单保存路径) | id 自增 / brandId 映射 / 必填兜底字段(步骤数组/pinyin/photos计数)/持久化1次 |
| `State.pushVehicle(v)` | 追加语义：导入备份/镜像同步后批量入列 | 不持久化(调用方统一批量 persist) |
| `State.replaceVehicles(list)` | 整体替换：镜像同步/数据迁移 | VEHICLES 原地清空+push(引用不变，闭包共享持续有效)，返回新长度 |
| `State.updateVehicle(id, patch)` | 更新语义：编辑保存 | Object.assign 合并 + 持久化 |
| `State.removeVehicle(id)` | 删除语义：删除确认框确认后 | 出列 + 持久化 |
| `State.addUser(u)` | 新增用户：注册申请/跨网络默认通过 | 直接入列 |
| `State.removeUser(phone)` | 按手机号删除：成员被踢出 | 出列 |
| `State.promoteToLeader()` | 前端提权 tripwire | 直接 throw new Error("禁止前端提权") |

**提权防御**：`promoteToLeader()` 永远抛错，即使攻击者通过前端 inspector 把 `state.currentUser.role='admin'` 也无法通过此路径持久化；真实角色来源只能是：
1. `doRegister()` 时 `phone === LEADER_PHONE` 判定（出厂 seed 管理员）
2. 组长 `approveMember()` 审批（admin 角色已登录守卫）
3. 飞书云端 `approved_users.json`（权威下发）

**写入点收敛验证**（test_v1013_a3.js A11-A13）：
- VEHICLES.push 仅存在于 State 内部（addVehicle/pushVehicle/replaceVehicles 3 处）
- VEHICLES.splice / VEHICLES.length=0 仅存在于 State 内部（1+1 处）
- USERS.push / USERS.splice 仅存在于 State 内部（1+1 处）

### A3-4 XSS 绊线：开发模式 innerHTML 守卫

**设计权衡**：生产 Cordova 环境中 XSS 风险较低（`file://` 协议 + 同源 + 无第三方 JS），但若全量拦截会带来 117 处合法内联 onclick 与 19 处含 `<div onclick=...>` 合法字符串拼装的误报 → 采用 "绊线 + 分级"：

| 形态 | 行为 |
|---|---|
| 生产 APK（cordova 环境） | 绊线**不安装**：零开销 / 零行为差异 |
| 开发模式（浏览器 / 测试沙箱） | 自动安装。默认宽松：写入 `<script` / `javascript:` 片段 → `console.warn` 留痕 + 写入仍继续；严格模式（`window.__XSS_GUARD_STRICT__=true`）直接抛错阻断（CI / 审计场景） |
| 合法内联事件（`<div onclick="x()">` / `<button oninput=...>`） | 不拦截（绊线仅检查 `<script` 字面 / `javascript:` 伪协议，正则对 `on\w+=` 不触发） |

**安全收益**：V10.12.0 XSS 全量 `esc()` 是"输出端合规"（最终写入 DOM 前转义）；A3-4 是"写入端防护"（中间层写入时捕获明显的注入），双保险覆盖。

---

## 三、测试与验证

新增 `tests/test_v1013_a3.js` 专项 **68 项全通过**：

| 组 | 维度 | 用例 | 结果 |
|---|---|---|---|
| A | 静态结构检查 | 四刀切函数存在 / 薄壳≤26行 / 薄壳按序调四函数 / 不再内联业务IO / 自愈重试保留 / filterVehicles存在 / getFilteredVehicles退化 / renderVehicleCards纯DOM / State守卫API / 写入点收敛（VEHICLES 3push+1splice+1length=0 + USERS 1push+1splice） / XSS绊线源码标记 | 14 项 ✅ |
| B | State守卫行为 | vehicles/users 返回副本隔离(外部改不污染) / addVehicle id+brandId+pinyin+持久化 / addVehicle photos计数 / 究竟入列 / updateVehicle 合并+持久化 / removeVehicle 命中出列 / replaceVehicles 引用不变 / pushVehicle 不持久化批量 / addUser入列 / removeUser 按号删除 / promoteToLeader 抛错 | 14 项 ✅ |
| C | 渲染业务分离 | filterVehicles 全量/关键词/拼音/品牌筛选/其他品牌兜底/组合 | 10 项 ✅ |
| D | 审批四刀规则 | 跨网络默认通过(active+crossPlatform+hidden)/本端pending计数/即消费即删仅跨网络/幂等不重复计数/已拒绝保留拒绝态/writePendings落盘三态/refreshMemberUI非静默+静默+自愈三种文案+云端回推去抖 | 10 项 ✅ |
| E | 编排链路 | pullPendingFromFeishu全链(双位置收集→规则→落盘→渲染)/自愈重试(首次token失败→invalidate→retryToken 成功)/自愈路径双位置/自愈跨网络计数防丢档 | 10 项 ✅ |
| F | XSS绊线 | 非cordova安装/合法onclick不误报/风险脚本warn/伪协议warn/严格模式抛错/cordova环境不安装 | 6 项 ✅ |
| G | 版本一致性 | version.json === APP_VERSION === config.xml(10.13.0) + versionCode 三处对齐(101300) | 2 项 ✅ |

### 历史回归
- V10.11.0 镜像同步 6/6
- V10.10.0 大文件分片 E2E 18/18 + 方案对比 9/9
- V10.9.x / V10.8.0 / V10.7.0 ~ V10.3 全量回归：0 失败

---

## 四、变更文件清单

### 修改
- `js/05-sync.js`：新增 fetchPendingFromCloud / applyApprovalRules / writePendingsToStorage / refreshMemberUI，pullPendingFromFeishu瘦身编排薄壳（原 165 行 → 26 行）
- `js/01-state.js`：新增 State 门面 (vehicles/users 只读副本 + 9 个受控写 API + promoteToLeader tripwire)
- `js/03-vehicles.js`：拆出 filterVehicles(keyword, brandId) 纯数据过滤 / renderVehicleCards(list) 纯DOM 拼装 / renderVehicleList 瘦身委托
- `js/02-auth.js`、`js/07-cache.js`、`js/04-export.js`：车辆/用户写路径统一收敛到 State API，移除直接 push/splice
- `demo.html`：sync-local-version 10.11.0 → 10.13.0，XSS 绊线脚本注入
- `config.xml`：version 10.13.0 / android-versionCode 101300
- `version.json`：releaseNotes 更新为 A3 复杂度治理六件套说明
- `CHANGELOG.md`：新增 V10.13.0 完整条目
- `.github/workflows/ci.yml`：新增 test:v1013 step
- `tests/e2e_harness.js`：补注入 State 块（DEMO_BLOCKS 扩展），修复 V1010/V1011 沙箱缺失 State API 问题
- `tests/test_v1013_a3.js`：新增 A3 专项 68 用例

---

## 五、向后兼容性

- **完全向后兼容**：全局公开 API（doSyncDownload/pullPendingFromFeishu/renderVehicleList 等）签名、调用点全部保留；demo.html 117 处 onclick 零改动；
- 数据格式、云端飞书文件夹结构、同步载荷结构、审批规则均 100% 兼容。
- 镜像同步（V10.11.0 删除传播机制）仍为默认拉取语义，A3 改进仅在其上游（审批拉取）与渲染端；V10.12 的 Secret 注入机制不变。
