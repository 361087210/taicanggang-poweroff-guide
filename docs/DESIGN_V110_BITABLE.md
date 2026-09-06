# V11.0 Bitable 后端升级设计（P0-2）

> 范围：73 车 + 现场用户数据从 Drive JSON（全量对象存储）迁移到飞书多维表格（Bitable）双表，保留 30 天 JSON 双写兜底窗口。
> 目标：把「数据不丢」从单机/单文件依赖升级为结构化云端收敛，同时守住弱网可用性。
> 前置：V10.15.1 版本对齐已完成（`docs/RELEASE_V10151.md`）。

---

## 一、现状盘点（复用优先，避免重复造轮子）

`feishu-api.js` 已具备以下 Bitable 原语，**本阶段不重写，只做增量补齐**：

| 能力 | 现有符号 | 状态 |
|---|---|---|
| 车辆字段映射 | `vehicleToBitable` / `bitableToVehicle` | ✅ 已有（含 steps/photos/videos JSON 序列化） |
| 车辆双向增量同步 | `syncVehiclesToBitable` / `syncVehiclesFromBitable` | ✅ 已有（id→record_id 映射、批量 100/批） |
| 用户字段映射/同步 | `userToBitable` / `bitableToUser` + 用户 sync | ✅ 已有 |
| 批量 CRUD | `bitableBatchCreate/BatchUpdate/ListRecords` | ✅ 已有 |
| QPS 门控 | `_qpsGate` | ✅ 已有（V10.10） |
| 云盘备份 | `backupAllData`、`driveUploadFile` | ✅ 已有（Drive 对象存储） |
| 表名约定 | `bitableAppToken`（config）+ `'tbl Vehicles'`/`'tbl Users'` 默认表名 | ⚠️ 表名硬编码为字符串，需常量收敛 |

**缺口（本阶段要做）**：
1. 全量迁移脚本（Drive JSON → 双表），一次性 + 幂等可重跑。
2. 数据访问分层：Bitable 优先 + Drive JSON 兜底 + 30 天双写窗口。
3. 表结构校验与自动建表（缺表时友好报错而非静默）。
4. 双写策略：写入同时落 Bitable 与 JSON，30 天后 JSON 转只读兜底。

---

## 二、目标架构

```
写入路径(组员/组长)
  └─ 数据访问层 dataAccess.write(vehicle|user)
        ├─ 1. Bitable 优先写（按表串行 + QPS 门控）
        ├─ 2. JSON 双写（30 天窗口内同步写 Drive 备份 JSON）
        └─ 失败降级：仅 JSON 成功 → 本地队列重试补写 Bitable

读取路径(桌面/异端)
  └─ dataAccess.readAll()
        ├─ 1. Bitable 拉取（全量增量对齐，id+updatedAt 冲突消解）
        ├─ 2. Bitable 失败/空 → JSON 兜底
        └─ 弱网：Bitable 超时(阈值 8s)自动切 JSON，不阻塞 UI
```

**冲突消解规则**（沿用 `syncVehiclesFromBitable` 已有逻辑）：
- 主键：车辆 `id` / 用户 `id`。
- 字段冲突：`updatedAt` 大者胜（`onConflict='newer'`），保留本地 `_syncTs`。
- 唯一性约束：`syncVehiclesFromBitable` 用 id → record_id 映射实现「有则更新、无则新增」，天然幂等。

---

## 三、双表 Schema

### 3.1 Vehicles 表（目标表名：`tbl Vehicles`）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | 文本 | 车辆唯一 ID（主键） |
| brand / series / config / display | 文本 | 车型归属与展示名 |
| powerType / position | 文本 | 能源类型、位置 |
| steps | 文本(JSON) | 断电步骤数组 |
| keyFrame / keyContainer | 文本 | 关键帧、关键容器 |
| remarks | 文本 | 备注 |
| photos / videos | 文本(JSON) | 图片/视频 token 数组 |
| updatedAt | 数字 | 时间戳，冲突消解依据 |
| updatedBy | 文本 | 最后修改人 |
| syncVersion | 文本 | 写入方 APP 版本 |

### 3.2 Users 表（目标表名：`tbl Users`）
复用 `userToBitable` 既有字段（id/name/phone/role/status 等），不新增权限位；行级权限后续 V11.1 用 Bitable「字段权限」或独立 App 隔离。

---

## 四、迁移脚本设计

**新增** `scripts/migrate_drive_to_bitable.js`（Node 24，复用 feishu-api 的 token/upload 逻辑）：

1. **输入**：飞书配置（App ID/Secret/根 folderToken/bitableAppToken），读 Drive JSON（vehicles.json / users.json）。
2. **对齐策略**：
   - 全量读 Bitable 现有记录，建 `id → record_id` 映射。
   - 每条 Driver JSON 记录：`id` 已存在 → 比对 `updatedAt`，云端较旧才更新；不存在 → 批量创建。
3. **分批**：每批 ≤100（对齐 `batchSize` 默认 100），创建/更新分开批处理。
4. **幂等**：脚本加 `--dry-run` 输出差异（新增 N/更新 M/跳过 K）不落库；`--force` 才写入。
5. **校验**：迁移后统计 Bitable 记录数 == Drive 记录数，且逐条 `id` 集完全一致；不一致则报错并保留 JSON 兜底。
6. **验收**：73 车全量查询 <300ms、写入 <1s、3 人并发不丢数据（见第七节）。

---

## 五、数据访问分层策略

在现有 `window.VehicleData` / `sync` 层之上抽薄薄一层 `dataAccess`（不改动既有函数签名，向后兼容）：

```js
const DATA_ACCESS = {
  async readAll(type) {          // type: 'vehicles' | 'users'
    try {
      const rows = await window.FeishuAPI[`sync${type}FromBitable`]({ onConflict: 'newer' });
      if (rows && rows.added + rows.updated + rows.skipped > 0) return rows;
      throw new Error('Bitable 无有效数据');
    } catch (e) {
      // 弱网/未配置 Bitable → JSON 兜底
      return await window.FeishuAPI.backupAllDataRead?.() || readLocalJSON(type);
    }
  },
  async write(type, payload) {
    const bitableOk = await tryBitableWrite(type, payload);   // QPS 门控 + 串行
    await tryJSONWrite(type, payload);                        // 30 天窗口内双写
    if (!bitableOk) enqueueLocalRetry(type, payload);         // 失败补写队列
    return bitableOk;
  }
};
```

- **双写窗口**：`config` 增加 `jsonMirrorDays: 30`；时间戳 > 30 天前的旧写入记录不再双写 JSON（只写 Bitable），控制 Drive 体积。
- **回退**：若 Bitable 配额/政策异常，`jsonMirrorDays` 置 `Infinity` 即回到纯 JSON 模式（开关一键降级）。

---

## 六、并发与 QPS

| 约束 | 值 | 应对 |
|---|---|---|
| Bitable 创建/批量 | 最高 50 QPS | `_qpsGate` 复用 |
| Bitable 更新 | 10 QPS / 表 | 更新路径单独更保守的门控 |
| 多表 | 按表串行 | 新增 `_qpsGate('table', tableId)` 表级互斥锁 |
| 3 人并发写入 | 不丢数据 | 幂等 id 主键 + 本地重试队列 |

---

## 七、验收指标（P0-2 Definition of Done）

| 编号 | 指标 | 门槛 |
|---|---|---|
| D1 | 73 车全量查询 | <300ms（带宽正常） |
| D2 | 单条写入（含双写） | <1s |
| D3 | 3 人并发写入 | 0 丢失，`updatedAt` 大者胜 |
| D4 | 迁移脚本幂等重跑 | 二次运行 增量=0 |
| D5 | 弱网降级 | Bitable 超时切 JSON，UI 不阻塞 |
| D6 | 回归 | `npm run test:all` 全绿（含 test:gate 新用例） |

---

## 八、风险与回退

| 风险 | 等级 | 缓解 |
|---|---|---|
| Bitable 变成唯一真相源而组员弱网 | 高 | 30 天 JSON 双写兜底 + 本地重试队列；`jsonMirrorDays` 一键回退 |
| 表名硬编码字符串漂移 | 中 | 抽取 `BITABLE_TABLE_NAMES` 常量收敛到 config |
| 配额超限（更新 10 QPS） | 中 | 表级串行 + 批次 ≤100 + 失败指数退避重试 |
| 行级权限缺失 | 中 | V11.1 用字段权限/独立 App 隔离；本阶段仅做数据同步不扩权限 |

---

## 九、迭代顺序与交接

- **本阶段交付**：迁移脚本 + dataAccess 分层 + 表名常量收敛 + test:gate 新用例。
- **后续**：V11.1 标签/Excel 批量导入（`docs/ITERATION_PLAN.md` → Phase2）、V11.2 CRDT 冲突消解（Phase3）、V11.4 OTA（Phase5）。
- **发版交接**：代码合入 + `npm run test:all` 全绿后移交 `太仓港app发版skill` 出正式产物；若该 skill 不可用，走 `docs/CICD使用说明.md` 手工链路兜底。
