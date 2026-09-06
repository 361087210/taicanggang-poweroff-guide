/* ===========================================================
 * 模块: 12-bitable.js  飞书多维表格操作封装 V1.0 (V10.15.0)
 * ===========================================================
 * 依赖: feishu-api.js → window.FeishuAPI
 * 用途: 问题反馈数据写入/查询、截图上传
 * =========================================================== */
(function(){
'use strict';

const BASE_APP_TOKEN = 'Gn4db7il9a27QrsOtVbclSE3nnf';
const FEEDBACK_TABLE_ID = 'tblPB0AnsTS9puqw';
const SCREENSHOT_FOLDER = '问题反馈截图';

let _screenshotFolderToken = null;

/**
 * 判断飞书API是否可用(安卓端可用,网页端镜像模式不可用)
 */
function isAvailable() {
  if (!window.FeishuAPI) return false;
  try {
    return window.FeishuAPI.isConfigReady();
  } catch (e) { return false; }
}

/**
 * 写入一条反馈记录到多维表格
 * @param {Object} fields 反馈字段对象
 * @returns {Promise<Object>} record对象
 */
async function addFeedbackRecord(fields) {
  if (!window.FeishuAPI) throw new Error('飞书API不可用');
  return await window.FeishuAPI.bitableCreateRecord(BASE_APP_TOKEN, FEEDBACK_TABLE_ID, fields);
}

/**
 * 查询反馈列表
 * @param {Object} opts { pageSize, pageToken }
 */
async function listFeedbackRecords(opts) {
  if (!window.FeishuAPI) throw new Error('飞书API不可用');
  opts = opts || {};
  return await window.FeishuAPI.bitableListRecords(
    BASE_APP_TOKEN, FEEDBACK_TABLE_ID, { page_size: opts.pageSize || 50 }
  );
}

/**
 * 获取/创建截图存放目录token
 */
async function getScreenshotFolderToken() {
  if (_screenshotFolderToken) return _screenshotFolderToken;
  if (!window.FeishuAPI) throw new Error('飞书API不可用');

  // 获取APP数据备份目录
  const dataFolder = await window.FeishuAPI.getDataFolderToken();
  // 在其下创建/获取问题反馈截图目录
  // 先尝试查找
  const list = await window.FeishuAPI.driveListFiles(dataFolder);
  let folder = (list.files || []).find(f => f.name === SCREENSHOT_FOLDER && f.type === 'folder');
  if (!folder) {
    // 创建目录(用drive v1 folders API)
    const token = await window.FeishuAPI.getTenantToken();
    const resp = await fetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
      },
      body: JSON.stringify({
        name: SCREENSHOT_FOLDER,
        folder_token: dataFolder,
      }),
    });
    const d = await resp.json();
    if (d.code !== 0) throw new Error('创建截图目录失败: ' + d.msg);
    _screenshotFolderToken = d.data.token;
  } else {
    _screenshotFolderToken = folder.token;
  }
  return _screenshotFolderToken;
}

/**
 * 上传反馈截图到飞书云盘
 * @param {Blob} blob
 * @param {string} fileName
 * @returns {Promise<string>} file_token
 */
async function uploadScreenshot(blob, fileName) {
  if (!window.FeishuAPI) throw new Error('飞书API不可用');
  const folderToken = await getScreenshotFolderToken();
  const result = await window.FeishuAPI.driveUploadFile(folderToken, fileName, blob);
  return result.file_token || result.token;
}

// 暴露到全局
window.FeedbackBase = {
  BASE_APP_TOKEN,
  FEEDBACK_TABLE_ID,
  isAvailable,
  addFeedbackRecord,
  listFeedbackRecords,
  uploadScreenshot,
};

})();
