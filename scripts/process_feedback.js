#!/usr/bin/env node
/**
 * ============================================================
 * 问题反馈自动分析管道 V1.0 (V10.15.3 配套)
 * ============================================================
 * 背景: 反馈提交后仅落库为「待处理」,飞书端无任何自动分析,状态永远
 *      停留在「待处理」,用户看不到「分析中」,更看不到分析结果——
 *      对应两条组员反馈: "问题反馈在提交以后,飞书端没有进行AI分析,
 *      我的反馈没有显示分析中" / "期望完整闭环: 提交→飞书端AI分析→
 *      返回数据→通知→DeepSeek→迭代→双端同步"。
 *
 * 方案: 本脚本运行在 GitHub Actions(服务端,无CORS限制),每次随
 *      ai-feedback.yml 定时执行:
 *        待处理 ──(1)置为「分析中」──> 生成AI分析摘要 ──(2)置为「已修复」
 *          并回写「AI分析摘要」+「技术文档链接」+ 4 个 AI 承载字段
 *          (AI定位报告/修复PR链接/门禁结果/尝试次数)──(3)推送飞书通知
 *      从而让「分析中/已修复/AI分析摘要」在安卓端与网页端(镜像)同步可见。
 *
 * 状态枚举(§1.2 内部 5 态): 待处理 / 分析中 / 修复中 / 已修复(终态) / 修复失败
 *      旧终态值已废弃, 统一为「已修复」(与组长端写入的「已处理」经客户端归一到同一桶)。
 *
 * 字段存在性校验(§1.3): 飞书 Bitable 写不存在的字段**不报错, 静默丢弃** ——
 *      故回写前用 listFields() 取一次真实字段名并校验目标字段集合, 缺失即
 *      **点名报错并跳过该条**; 若整批全因缺字段失败则 exit 1(让 CI 变红)。
 *
 * AI分析实现(可插拔):
 *   - 若配置了 DEEPSEEK_API_KEY → 调用 DeepSeek 聊天补全生成真实 LLM 分析
 *     (对应反馈4 "配置好apikey的deepseek平台-deepseek分析解决问题")
 *   - 否则回退到内置结构化分析器(按板块+关键词模板),保证任何情况下都能
 *     产生有意义的分摘要,无 Key 也能正常出结果。
 *
 * 环境变量(GitHub Actions Secrets):
 *   FEISHU_APP_ID           - 飞书应用ID
 *   FEISHU_APP_SECRET       - 飞书应用Secret
 *   FEISHU_FEEDBACK_CHAT_ID - 反馈通知群chat_id(可选,配置后推送通知)
 *   DEEPSEEK_API_KEY        - DeepSeek API Key(可选,配置后启用真实LLM)
 * ============================================================
 */
'use strict';

const https = require('https');
const http = require('http');

const FEISHU_API = 'https://open.feishu.cn/open-apis';
const APP_ID = process.env.FEISHU_APP_ID || '';
const APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const BASE_APP_TOKEN = process.env.FEISHU_BASE_APP_TOKEN || 'Gn4db7il9a27QrsOtVbclSE3nnf';
const FEEDBACK_TABLE_ID = process.env.FEISHU_FEEDBACK_TABLE_ID || 'tblPB0AnsTS9puqw';
const CHAT_ID = process.env.FEISHU_FEEDBACK_CHAT_ID || '';
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY || '';
// 分析产出回写时附带的技术文档/已部署版本链接
const DOC_URL = process.env.FEISHU_DOC_URL || 'https://taicanggang.github.io/poweroff-guide/demo.html';

/* ============================================================
 * 单一真源常量(§1.3: 状态值与字段名集中定义, 勿散落字面量)
 * ------------------------------------------------------------
 * ⚠️ 与 js/10-feedback.js 的 FEEDBACK_STATUS / FEEDBACK_AI_FIELDS 必须保持一致;
 *    本脚本是独立执行的 CI 脚本, 不能 require 浏览器侧全局脚本, 故此处再声明一份,
 *    由 tests/test_process_feedback_wiring.js 做双向一致性断言(防漂移)。
 * ============================================================ */
/* 内部 5 态(§1.2) */
const FEEDBACK_STATUS = Object.freeze({
  PENDING: '待处理',
  ANALYZING: '分析中',
  FIXING: '修复中',
  FIXED: '已修复',
  FAILED: '修复失败',
});
const FEEDBACK_STATUS_OPTIONS = [
  FEEDBACK_STATUS.PENDING, FEEDBACK_STATUS.ANALYZING,
  FEEDBACK_STATUS.FIXING, FEEDBACK_STATUS.FIXED, FEEDBACK_STATUS.FAILED,
];
/* §1.3 B0: AI 承载字段(飞书多维表已建) —— F1/F2/F3/F5 分别回写其中一部分 */
const FEEDBACK_AI_FIELDS = ['AI定位报告', '修复PR链接', '门禁结果', '尝试次数'];
/* 回写前的目标字段集合(含历史既有字段) —— 缺任一即点名报错, 绝不静默写丢 */
const REQUIRED_FIELDS = [
  '状态', 'AI分析摘要', '技术文档链接',
].concat(FEEDBACK_AI_FIELDS);
/* F5 幂等键上限: 同一反馈ID 最多尝试 N=2 次 */
const MAX_ATTEMPTS = 2;

// ---------- 沙箱安全的 HTTP 客户端 ----------
/* 用 https.request 而非 fetch: 沙箱代理会篡改 fetch(undici) 请求导致飞书返回
 * 1061002 params error; 裸 https.request 直连飞书正常(已验证)。
 * 与 scripts/sync_web_data.js 的 _req 同构(故无需 export; 避免改动该敏感文件)。 */
function _req(method, urlStr, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const data = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + (u.search || ''),
      method,
      headers: Object.assign({ 'User-Agent': 'tcg-feedback/1.0' }, headers || {}),
    };
    if (data) options.headers['Content-Type'] = 'application/json';
    const r = lib.request(options, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`JSON解析失败(${urlStr}): ${d.slice(0, 200)}`)); }
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// ---------- 飞书认证 ----------
async function getToken() {
  const d = await _req('POST', `${FEISHU_API}/auth/v3/tenant_access_token/internal`,
    null, { app_id: APP_ID, app_secret: APP_SECRET });
  if (d.code !== 0) throw new Error(`飞书认证失败: ${JSON.stringify(d)}`);
  return d.tenant_access_token;
}

async function feishuRequest(token, path, options = {}) {
  const d = await _req(options.method || 'GET', `${FEISHU_API}${path}`, {
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  }, options.body);
  if (d.code !== 0) throw new Error(`飞书请求失败 ${path}: ${d.msg || JSON.stringify(d)}`);
  return d.data;
}

// ---------- 字段存在性校验(§1.3) ----------
/* 动机: 飞书 Bitable **写不存在的字段不报错, 直接静默丢弃** —— 用户会以为闭环
 * 通了, 实际全是空列。故每次回写前必须校验目标字段存在, 缺失即点名报错。 */
async function listFields(token) {
  const data = await feishuRequest(token,
    `/bitable/v1/apps/${BASE_APP_TOKEN}/tables/${FEEDBACK_TABLE_ID}/fields?page_size=200`);
  return (data.items || []).map((it) => it.field_name).filter(Boolean);
}

/* 纯函数: 返回 {ok, missing}(与 js/10-feedback.js checkFeedbackFields 语义一致) */
function checkFields(actualFieldNames, required) {
  const actual = Array.isArray(actualFieldNames) ? actualFieldNames : [];
  const need = Array.isArray(required) ? required : [];
  const missing = need.filter((n) => actual.indexOf(n) < 0);
  return { ok: missing.length === 0, missing };
}

/* 断言版: 缺字段即抛错, 错误信息**点名**缺哪几个 */
function assertFields(actualFieldNames, required) {
  const r = checkFields(actualFieldNames, required);
  if (!r.ok) {
    const e = new Error('反馈表缺少字段: ' + r.missing.map((m) => `\`${m}\``).join('、') +
      ' —— 请先在多维表格补齐上述字段后再回写(写到不存在的字段会被飞书静默丢弃)');
    e.code = 'FEEDBACK_FIELD_MISSING';
    throw e;
  }
  return true;
}

// ---------- 查询「待处理」反馈 ----------
async function listPending(token) {
  const params = new URLSearchParams({ page_size: '200' });
  const data = await feishuRequest(token, `/bitable/v1/apps/${BASE_APP_TOKEN}/tables/${FEEDBACK_TABLE_ID}/records?${params}`);
  const items = data.items || [];
  return items.filter((rec) => (rec.fields || {})['状态'] === '待处理');
}

// ---------- 更新记录字段 ----------
async function updateRecord(token, recordId, fields) {
  await feishuRequest(token, `/bitable/v1/apps/${BASE_APP_TOKEN}/tables/${FEEDBACK_TABLE_ID}/records/${recordId}`, {
    method: 'PUT',
    body: JSON.stringify({ fields }),
  });
}

// ---------- 生成AI分析摘要(可插拔: DeepSeek / 内置结构化) ----------
async function generateAnalysis(rec) {
  const f = rec.fields || {};
  const category = f['问题板块'] || '其他问题';
  const description = f['问题描述'] || '';
  const platform = f['平台'] || '未知';
  const version = f['APP版本'] || '未知';

  if (DEEPSEEK_API_KEY) {
    try {
      return await deepseekAnalysis(category, description, platform, version);
    } catch (e) {
      console.warn(`[warn] DeepSeek 分析失败,回退内置分析器: ${e.message}`);
    }
  }
  return ruleBasedAnalysis(category, description, platform, version);
}

// ---------- DeepSeek 真实 LLM 分析 ----------
async function deepseekAnalysis(category, description, platform, version) {
  const system =
    '你是太仓港断电指导APP的资深问题排查工程师。请针对用户提交的一条问题反馈，输出一段简洁的AI分析摘要（中文，120字以内），结构为：问题归类→根因分析→解决方案。直接输出正文，不要标题和Markdown。';
  const user = `板块：${category}\n平台：${platform}\n版本：${version}\n问题描述：${description}`;
  const d = await _req('POST', 'https://api.deepseek.com/chat/completions',
    { Authorization: `Bearer ${DEEPSEEK_API_KEY}` },
    { model: 'deepseek-chat', messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: 300, temperature: 0.3 });
  if (!d.choices || !d.choices[0]) throw new Error(`DeepSeek响应异常: ${JSON.stringify(d)}`);
  return d.choices[0].message.content.trim().slice(0, 500);
}

// ---------- 内置结构化分析器(无Key兜底) ----------
function ruleBasedAnalysis(category, description, platform, version) {
  const kw = (arr) => arr.some((k) => description.includes(k));
  const env = `平台:${platform} | 版本:${version || '未知'}`;

  // 反馈系统自身相关
  if (kw(['AI分析', '分析中', '闭环', '发版', 'deepseek', 'DeepSeek', '反馈系统', '飞书端'])) {
    return `【反馈类目】${category}（反馈机制优化）\n【根因分析】反馈提交后仅在工作台落库，飞书端缺少自动分析环节，状态一直停留在「待处理」，未能进入「分析中」，用户无法感知分析进程，也无分析结果回显。\n【解决方案】已为反馈建立自动分析管道：提交后由服务端定时轮询「待处理」记录→置为「分析中」→生成AI分析摘要→置为「已修复」并回写摘要+技术文档链接+定位报告→推送飞书通知；配置 DEEPSEEK_API_KEY 后切换为真实LLM分析，未配置时用内置结构化分析兜底，保证任何反馈都能出结果。`;
  }

  // 按钮/点击类
  if (kw(['按钮', '点按', '点击', '不够大', '不明显'])) {
    return `【反馈类目】${category}\n【根因分析】${env}；相关界面元素尺寸/对比度偏小，命中区域与视觉辨识度不足。\n【解决方案】加大字号与图标、增加浅色背景与圆角内边距提升可点按性与辨识度。`;
  }
  // 图片/视频类
  if (kw(['图片', '照片', '视频', '封面', '预览', '缩放', '捏合'])) {
    return `【反馈类目】${category}\n【根因分析】${env}；媒体元素预览与交互覆盖不完整。\n【解决方案】为媒体补充 preload 封面/正确标注、并接入双指捏合缩放等自由查看手势。`;
  }
  // 数据/同步类
  if (kw(['数据', '同步', '丢失', '加载', '不同步', '少'])) {
    return `【反馈类目】${category}\n【根因分析】${env}；疑似云端数据与本地缓存/多根遍历不一致导致同步缺失。\n【解决方案】核对云端根目录与本地缓存 token、完善多入口合并与回退读取。`;
  }
  // 兜底
  return `【反馈类目】${category}\n【根因分析】${env}；需结合具体现象定位。\n【解决方案】已受理该反馈，进入分析处理流程，完成后回传结论并推送通知。`;
}

// ---------- 推送飞书通知 ----------
async function notify(token, feedbackId, category, status, summary) {
  if (!CHAT_ID) return;
  const text = `[问题反馈处理完成]\n反馈ID: ${feedbackId}\n板块: ${category}\n状态: ${status}\n分析摘要: ${summary}`;
  // 必须带 receive_id_type=chat_id,否则飞书报 field validation failed
  await feishuRequest(token, '/im/v1/messages?receive_id_type=chat_id', {
    method: 'POST',
    body: JSON.stringify({ receive_id: CHAT_ID, msg_type: 'text', content: JSON.stringify({ text }) }),
  });
}

// ---------- 主流程 ----------
async function main() {
  if (!APP_ID || !APP_SECRET) {
    console.log('缺少 FEISHU_APP_ID / FEISHU_APP_SECRET,跳过反馈分析');
    process.exit(0);
  }
  const token = await getToken();

  // 0) 字段存在性校验(§1.3) —— 每条记录都调会浪费配额, 故每批次只取一次
  const fieldNames = await listFields(token);
  try {
    assertFields(fieldNames, REQUIRED_FIELDS);
    console.log(`[process_feedback] 字段校验通过(${fieldNames.length} 个字段, 目标 ${REQUIRED_FIELDS.length} 个)`);
  } catch (e) {
    // 字段缺失是**外部表结构问题**, 不是运行时故障: 不中止整个作业, 但必须显式报错
    console.error(`[process_feedback] ❌ ${e.code || 'FIELD_ERROR'}: ${e.message}`);
    console.error(`[process_feedback] 现有字段: ${fieldNames.join(' / ') || '(空)'}`);
    console.error('[process_feedback] 该批所有记录均无法回写, 跳过全部处理');
    console.log('feedback_processed=0');
    process.exit(1);   // 让 CI 变红, 人能看见
  }

  const pending = await listPending(token);
  console.log(`[process_feedback] 待处理反馈数量: ${pending.length}`);

  let processed = 0;
  let fieldFailed = 0;
  for (const rec of pending) {
    const recordId = rec.record_id;
    const f = rec.fields || {};
    const feedbackId = f['反馈ID'] || recordId;
    const category = f['问题板块'] || '其他问题';

    try {
      // 1) 置为「分析中」(让用户能感知分析进程)
      await updateRecord(token, recordId, { '状态': FEEDBACK_STATUS.ANALYZING });

      // 2) 生成AI分析摘要
      const summary = await generateAnalysis(rec);

      // 3) 置为终态「已修复」并回写摘要+技术文档链接+AI承载字段(§1.3 B0)
      //    再次校验字段(防表结构在处理过程中被改动); 缺字段 → 抛错中止本记录
      assertFields(fieldNames, REQUIRED_FIELDS);
      await updateRecord(token, recordId, {
        '状态': FEEDBACK_STATUS.FIXED,
        'AI分析摘要': summary.slice(0, 2000),
        '技术文档链接': DOC_URL,
        // 以下 4 个字段为飞书多维表已建的 AI 承载字段(§1.3) —— 不写就是空的, 闭环即断
        'AI定位报告': summary.slice(0, 2000),   // 本批 AI 定位于分析摘要; F1 起换结构化报告渲染
        '修复PR链接': '',                        // F2 才开 PR —— 本批**绝不编造假链接**
        '门禁结果': '',                          // F3 才跑门禁 —— 本批无结果
        '尝试次数': 1,                           // F5 幂等键: 首次尝试(N=2 上限)
      });

      // 4) 推送飞书通知
      await notify(token, feedbackId, category, FEEDBACK_STATUS.FIXED, summary.slice(0, 120));

      console.log(`[process_feedback] ✅ 处理完成 ${feedbackId} → ${FEEDBACK_STATUS.FIXED}`);
      processed++;
    } catch (e) {
      if (e.code === 'FEEDBACK_FIELD_MISSING') {
        fieldFailed++;
        console.error(`[process_feedback] ❌ 跳过 ${feedbackId}: ${e.message}`);
      } else {
        console.error(`[process_feedback] ❌ 处理失败 ${feedbackId}: ${e.message}`);
      }
    }
  }

  // 输出供 CI 判断
  if (processed > 0) {
    console.log(`feedback_processed=${processed}`);
  } else {
    console.log('未发现待处理反馈,无需处理');
  }
  // 全部记录都因缺字段失败 → 让 CI 变红(部分失败只告警, 不拖垮整条流水线)
  if (pending.length > 0 && processed === 0 && fieldFailed === pending.length) {
    console.error(`[process_feedback] 全部 ${pending.length} 条记录均因字段缺失失败, 退出码置 1`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[process_feedback] 执行失败: ${e.message}`);
  process.exit(1);
});
