/* 临时分析: FeishuAPI vs 内联上传实现的调用点影响面 */
'use strict';
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');

const targets = ['js/05-sync.js', 'js/06-media.js', 'js/00-bootstrap.js', 'js/03-vehicles.js', 'js/10-feedback.js', 'js/09-web-sync.js', 'demo.html'];
const out = [];

for (const t of targets) {
  let s;
  try { s = read(t); } catch (e) { continue; }
  s.split('\n').forEach((line, i) => {
    if (/httpUploadFileSmart|httpUploadFileMultipart|httpUploadFile\b|FeishuAPI\./.test(line)) {
      out.push(`${t}:${i + 1}: ${line.trim()}`);
    }
  });
}
out.push('\n===== feishu-api.js 是否含 httpFetch =====');
const api = read('feishu-api.js');
out.push('httpFetch 出现: ' + (api.match(/httpFetch/g) || []).length + ' 次');
out.push('getTenantToken 出现: ' + (api.match(/getTenantToken/g) || []).length + ' 次');
out.push('_cordovaMultipart 出现: ' + (api.match(/_cordovaMultipart/g) || []).length + ' 次');
out.push('\n===== FeishuAPI 导出清单 =====');
const em = api.match(/return\s*\{[\s\S]*?\};?\s*\}\)\(\);?/g);
const tail = api.slice(api.lastIndexOf('return {'));
out.push(tail.slice(0, 2500));

out.push('\n===== 是否导出 httpUploadFileSmart =====');
out.push('含 httpUploadFileSmart: ' + /httpUploadFileSmart/.test(api));

fs.writeFileSync(path.join(__dirname, '_an1.txt'), out.join('\n'), 'utf8');
console.log('done ' + out.length);
