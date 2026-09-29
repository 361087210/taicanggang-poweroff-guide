/* ===========================================================
 * 模块: 00-config.js  —  单一配置真源 (V10.18.0 重构引入)
 * -----------------------------------------------------------
 * 设计目标(重构原则: 单一 owner / 删除重复真源):
 *   此前飞书 appId/chatId、GITHUB_REPO/BRANCH、BASE_APP_TOKEN、
 *   FEEDBACK_TABLE_ID 等常量散落在 00-bootstrap / 09-web-sync /
 *   12-bitable 多处硬编码, 极易漂移。本模块统一集中, 所有模块改从
 *   此读取并保留兜底默认值, 不再各自写死。
 *
 * 安全说明(P0 脱敏): 旧手机号 sha256 枚举向量已删除, 账号连接键改用
 *   LINK_SALT —— 熵来自密码, 盐公开无妨(见 LINK_SALT 注释)。
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

    /* ---------- GitHub(仓库 / 分支) ----------
     * V10.19.3: 网页注册登记库(GITHUB_REGISTER_REPO)已随"网页端自助注册"下线一并移除。 */
    GITHUB_REPO: '361087210/taicanggang-poweroff-guide',
    GITHUB_BRANCH: 'main',

    /* ---------- 网页镜像桥 ----------
     * LINK_SALT 是账号连接键 linkKey = PBKDF2-HMAC-SHA256(password,
     * LINK_SALT + '|' + phone, 100000, 256bit) 的公开盐。
     * 熵完全来自密码(而非手机号): 攻击者拿不到明文密码就无法由公开镜像
     * 反推手机号, 故盐公开无妨。deriveLinkKey 实现在 js/00-bootstrap.js,
     * 安卓端与网页端共用同一原语; 镜像端(sync_web_data.js)只透传 linkKey,
     * 不再自己计算。 */
    LINK_SALT: 'tcg-link-2026',
    WEB_MIRROR_BASE: 'web-data/',

    /* ---------- 飞书群通知(组长拒绝注册时推送) ---------- */
    DEFAULT_CHAT_ID: 'oc_1b25c691971c61de0b7773e49cb42796',

    /* ---------- 网页端自助注册登记通道(V10.17.0 复投 / Issue2) ----------
     * 网页版为只读镜像, 无法直连飞书(无后端+CORS不可达); 注册申请统一投递到
     * 专用收集箱仓库 tcg-registration-inbox 的 registrations/ 目录,
     * 其 relay.yml(每5分钟)把 pending_reg_<phone>.json 转投飞书「注册申请/」,
     * 组长安卓端既有 60 秒轮询审批链路零改动即可看到申请。
     * 写库令牌: 不入源码, 经构建期注入 window.__BUILD_SECRETS__.registerTokenEnc
     * (scripts/inject_build_secrets.js 从 CI Secret TCG_REGISTER_TOKEN 注入,
     *  建议用仅含本收集箱仓库 contents:write 的 fine-grained PAT)。 */
    REGISTER_REPO: '361087210/tcg-registration-inbox',
    REGISTER_BRANCH: 'main',
    REGISTER_DIR: 'registrations'
  };
})();
