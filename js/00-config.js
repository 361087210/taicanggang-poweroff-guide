/* ===========================================================
 * 模块: 00-config.js  —  单一配置真源 (V10.18.0 重构引入)
 * -----------------------------------------------------------
 * 设计目标(重构原则: 单一 owner / 删除重复真源):
 *   此前飞书 appId/chatId、GITHUB_REPO/BRANCH、BASE_APP_TOKEN、
 *   FEEDBACK_TABLE_ID、WEB_SYNC_SALT 等常量散落在 00-bootstrap /
 *   09-web-sync / 12-bitable 多处硬编码, 极易漂移(如网页镜像 SALT
 *   与生成脚本不一致导致手机号哈希对不上)。本模块统一集中, 所有
 *   模块改从此读取并保留兜底默认值, 不再各自写死。
 *
 * 安全红线(绝不突破):
 *   ❌ appSecret / GitHub PAT / 任何密钥 绝不出现在本文件或任何源码中。
 *   密钥仅来源: ① 构建期 inject_build_secrets.js 注入 window.__BUILD_SECRETS__
 *              ② CI 仓库 Secrets(FEISHU_APP_SECRET / FEISHU_APP_ID)
 *              ③ 用户设置页手动填写(仅存 localStorage)。
 * =========================================================== */
(function(){
  'use strict';
  window.TCG_CONFIG = {
    /* ---------- 飞书(公开字段, 非机密) ---------- */
    FEISHU_APP_ID: 'cli_aa0ce4fd91f85be8',
    FEISHU_FOLDER_TOKEN: 'nodcnGA95g93RhIUSdCeTkhKlQc',

    /* ---------- 多维表格(bitable) ---------- */
    BASE_APP_TOKEN: 'Gn4db7il9a27QrsOtVbclSE3nnf',
    FEEDBACK_TABLE_ID: 'tblPB0AnsTS9puqw',

    /* ---------- GitHub(仓库 / 分支 / 网页注册登记库) ---------- */
    GITHUB_REPO: '361087210/taicanggang-poweroff-guide',
    GITHUB_BRANCH: 'main',
    GITHUB_REGISTER_REPO: '361087210/tcg-registration-inbox',

    /* ---------- 网页镜像桥 ----------
     * ⚠️ WEB_SYNC_SALT 必须与 scripts/sync_web_data.js 中的 SALT 完全一致!
     * 两者运行在不同运行时(浏览器 / Node), 无法共享同一常量,
     * 因此各自维护同一字面量并互相注释引用, 修改时务必两处同改。 */
    WEB_SYNC_SALT: 'tcg-web-2026',
    WEB_MIRROR_BASE: 'web-data/',

    /* ---------- 飞书群通知(组长拒绝注册时推送) ---------- */
    DEFAULT_CHAT_ID: 'oc_1b25c691971c61de0b7773e49cb42796'
  };
})();
