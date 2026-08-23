# 测试套件说明

## 安全规范（V5.7.1 起强制）

飞书 `App Secret` 一律通过环境变量 `TCG_FEISHU_APP_SECRET` 注入，**任何测试代码与文档中不得出现明文 Secret**（GitHub 推送保护会直接拦截）。

### 运行前设置环境变量

```bash
# Linux / macOS
export TCG_FEISHU_APP_SECRET="你的飞书应用Secret"

# Windows (CMD)
set TCG_FEISHU_APP_SECRET=你的飞书应用Secret

# Windows (PowerShell)
$env:TCG_FEISHU_APP_SECRET="你的飞书应用Secret"
```

Secret 获取路径：飞书开放平台 → 开发者后台 → 对应应用 → **凭证与基础信息**。

## V5.7 测试套件（82 用例）

| 脚本 | 类型 | 说明 |
|------|------|------|
| `test_v57_logic.js` | 逻辑测试 (30) | 纯本地，无需 Secret 也能跑（云端相关项自动跳过） |
| `test_v57_integration.py` | 真实API集成 (15) | 需要环境变量；验证凭证→token→数据分仓目录→读写往返 |
| `test_v57_cross_network.js` | 跨网络双机模拟 (16) | 需要环境变量；模拟组员申请→云端落盘→组长审批全链路 |
| `test_v53_runtime.js` | 回归测试 (21) | V5.3 核心功能回归，确认无破坏 |

### 一键全量回归

```bash
export TCG_FEISHU_APP_SECRET="你的飞书应用Secret"
npm test
```

## 历史遗留说明

V5.3.6 之前的个别旧测试脚本（如 `test_v536_feishu_sync.js`）内含历史明文 Secret，已在历史提交中存在。该应用 Secret 若仍在使用，建议尽快在飞书开放平台**重置**；新代码一律遵循环境变量规范。
