/**
 * ============================================================
 * test_v10256_stream_decode.js — HTTP 响应体多字节字符分块解码回归
 * ============================================================
 * 真实故障（2026-11-23 定位）：`sync-web-data` 连续失败两周，报"镜像含 N 处 U+FFFD"，
 * 但同一份云端文件用整段读取（python）是 **0 处**，而每次 node 运行报的数量还不一样
 * （CI 那轮 2 处、本地 3 处、坏的位置也每次不同）。
 *
 * 根因不在飞书，在本仓库的收流实现：
 *   `res.on('data', c => d += c)` —— c 是 Buffer，`+=` 会**逐块** toString()。
 *   一个 3 字节的中文字符只要被 TCP 分块切开，两半各自变成 U+FFFD。
 *   坏字符随后被 JSON.stringify 写进 web-data/ 与 vehicles_data.js 提交上线
 *   —— 历史上几次"自动同步写坏数据"都是这条路径。
 *
 * 本套件用本地 http server 把响应体**故意切在一个中文字符的字节中间**，
 * 断言解码后既没有 U+FFFD、也没有丢字。旧实现在这里必红（先红后绿）。
 *
 * 运行: node tests/test_v10256_stream_decode.js
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const SCRIPT = path.resolve(__dirname, '..', 'scripts', 'sync_web_data.js');
const scriptSrc = fs.readFileSync(SCRIPT, 'utf8');

let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; failures.push(name); console.log('  [FAIL] ' + name + (extra !== undefined ? '  -> ' + extra : '')); }
}
function section(t) { console.log('\n========== ' + t + ' =========='); }

const mod = require(SCRIPT);

/* 起一个本地服务：把 body 在 splitAt 处**分两次 write**（不设 Content-Length，
 * 走 chunked，两次 write 必然成为两个 data 事件）。 */
function serveSplit(bodyBuf, splitAt) {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.write(bodyBuf.subarray(0, splitAt));
      setTimeout(() => { res.write(bodyBuf.subarray(splitAt)); res.end(); }, 30);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, port: srv.address().port }));
  });
}
function close(srv) { return new Promise(r => srv.close(r)); }

(async () => {
  section('S0 静态守卫：收流必须整段拼接后再解码');
  /* 只看**代码**，不看注释——注释里为讲清根因会引用那段旧写法。 */
  const codeOnly = scriptSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1'); // 行注释（避开 http:// 这类）
  check('S0a 代码里不再出现逐块拼接 `d += c`', !/\bd\s*\+=\s*c\b/.test(codeOnly),
    (codeOnly.match(/.*\bd\s*\+=\s*c\b.*/) || [''])[0].trim());
  check('S0b 源码使用 Buffer.concat 整体解码', /Buffer\.concat\(chunks\)\.toString\('utf8'\)/.test(scriptSrc));
  check('S0c 导出 _req/_reqText 以便回归测试', typeof mod._req === 'function' && typeof mod._reqText === 'function');

  const TEXT = '取出车钥匙，屏幕下方，车内中控台';
  const payload = JSON.stringify({ msg: TEXT, n: 100 });
  const buf = Buffer.from(payload, 'utf8');
  const carIdx = buf.indexOf(Buffer.from('车钥匙', 'utf8'));
  check('S0d 探针：能定位到「车钥匙」的字节位置', carIdx > 0, carIdx);

  try {
    /* --- 切在一个 3 字节汉字的第 2 个字节中间（旧实现必坏） --- */
    const splitAt = carIdx + 1;
    const { srv, port } = await serveSplit(buf, splitAt);
    try {
      section('S1 _reqText：切在多字节字符中间也必须无损');
      const text = await mod._reqText('http://127.0.0.1:' + port + '/x');
      check('S1a 不含 U+FFFD 替换符', !text.includes('\uFFFD'), JSON.stringify(text.slice(0, 80)));
      check('S1b 中文完整（含「取出车钥匙」）', text.includes('取出车钥匙'), JSON.stringify(text.slice(0, 80)));
      check('S1c 整段内容逐字节等价', text === payload, 'len=' + text.length + ' vs ' + payload.length);

      section('S2 _req：JSON 路径同样无损');
      const j = await mod._req('GET', 'http://127.0.0.1:' + port + '/json');
      check('S2a JSON 可解析且字段无损', j && j.msg === TEXT, j && JSON.stringify(j.msg));
      check('S2b 解析结果不含 U+FFFD', !JSON.stringify(j).includes('\uFFFD'));
    } finally { await close(srv); }

    /* --- 控制组：切在字符边界上，本来就该正常（防"用错方式修"） --- */
    const { srv: srv2, port: port2 } = await serveSplit(buf, 0);
    try {
      section('S3 控制组：整段一次写入也必须无损');
      const text2 = await mod._reqText('http://127.0.0.1:' + port2 + '/x');
      check('S3a 无 U+FFFD 且内容等价', !text2.includes('\uFFFD') && text2 === payload);
    } finally { await close(srv2); }
  } catch (e) {
    check('S 用例执行未抛异常', false, e.message + ' | ' + (e.stack || '').split('\n')[1]);
  }

  console.log('\n==============================================================');
  console.log('收流解码回归汇总: ' + pass + ' passed, ' + fail + ' failed');
  if (failures.length) { console.log('失败项: ' + failures.join(' / ')); process.exit(1); }
  else console.log('全部通过 OK');
})();
