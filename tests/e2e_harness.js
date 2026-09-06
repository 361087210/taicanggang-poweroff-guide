/**
 * ============================================================
 * e2e_harness.js - V10.10.0 真机模拟测试基建(提取器+沙箱)
 * ============================================================
 * 设计目标: 不复制粘贴业务代码——直接从 demo.html / feishu-api.js
 * 源码中按名称提取真实函数实现, 注入带浏览器API桩的 vm 沙箱,
 * 所有网络调用路由到 MockFeishuServer。测试跑的是与真机同一份
 * 代码路径(仅 cordova 原生插件分支按设计回退 fetch, 与浏览器
 * 预览/真机降级路径一致), 保证"真机模拟"的有效性。
 *
 * 提取器: 状态机扫描(字符串/模板串/注释/正则字面量全感知),
 * 支持 `function name(` / `async function name(` / `const|let name=`
 * 三种声明形态, 简单单行声明按分号截断。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const DEMO_PATH = path.join(__dirname, '..', 'demo.html');
const FEISHU_API_PATH = path.join(__dirname, '..', 'feishu-api.js');
const JS_DIR = path.join(__dirname, '..', 'js');

/** V10.12 A2 拆分后: 函数实际定义散落在 js/00-bootstrap.js ~ js/08-main.js (9个模块)
 *  读取全部模块(按文件名自然排序=defer顺序),拼接为单一源码串供 extractNamedBlock 扫描,
 *  保持 DEMO_BLOCKS 列表和提取正则零改动即可兼容新/旧源码组织。 */
function loadCombinedSource() {
  let src = fs.readFileSync(DEMO_PATH, 'utf8');
  if (fs.existsSync(JS_DIR)) {
    const files = fs.readdirSync(JS_DIR)
      .filter(f => f.endsWith('.js'))
      .sort();
    for (const f of files) {
      src += '\n' + fs.readFileSync(path.join(JS_DIR, f), 'utf8') + '\n';
    }
  }
  return src;
}

/** 判断某字符是否可作为"正则字面量前驱"(启发式, 覆盖本项目全部用例) */
function isRegexPreceding(ch) {
  if (!ch) return true; // 行首/文件首
  return '(,=:[!&|?{};+-*%<>~^'.includes(ch);
}

/**
 * 从源码中提取指定名称的完整声明块
 * @param {string} src - 源码
 * @param {string} name - 函数/常量名
 * @returns {string} 完整声明源码(含声明头)
 */
function extractNamedBlock(src, name) {
  const re = new RegExp(
    '(?:^|\\n)[ \\t]*(?:(?:async\\s+)?function\\s+' + name + '\\s*\\(|(?:const|let|var)\\s+' + name + '\\s*=)',
    'm'
  );
  const m = re.exec(src);
  if (!m) throw new Error('extractNamedBlock: 未找到 ' + name);
  let i = m.index + m[0].length;

  // ---- 阶段1: 定位第一个 `{`(函数参数表内可能含默认值, 用括号深度+字符串感知跳过) ----
  // 注意: 函数声明形态的正则已吞掉参数表的开括号, 初始深度须为1
  let paren = m[0].endsWith('(') ? 1 : 0;
  let st0 = 'code'; // code|sq|dq|tpl
  for (; i < src.length; i++) {
    const c = src[i];
    if (st0 === 'code') {
      if (c === "'") st0 = 'sq';
      else if (c === '"') st0 = 'dq';
      else if (c === '`') st0 = 'tpl';
      else if (c === '(') paren++;
      else if (c === ')') paren--;
      else if (c === '{' && paren === 0) break;
      else if (c === ';' && paren === 0) {
        // 简单单行声明(如 `const APP_VERSION='10.10.0';`), 无块体
        return src.slice(m.index, i + 1);
      }
    } else if (st0 === 'sq') {
      if (c === '\\') i++;
      else if (c === "'" || c === '\n') st0 = 'code';
    } else if (st0 === 'dq') {
      if (c === '\\') i++;
      else if (c === '"' || c === '\n') st0 = 'code';
    } else if (st0 === 'tpl') {
      if (c === '\\') i++;
      else if (c === '`') st0 = 'code';
    }
  }
  if (i >= src.length) throw new Error('extractNamedBlock: ' + name + ' 无块体');

  // ---- 阶段2: 状态机扫描到配对的 `}` ----
  let depth = 0;
  const frames = ['code'];   // 帧栈: code|tpl|line|block|sq|dq
  const frameBase = [1];     // 每个code帧的最小深度(根帧体内深度≥1)
  let lastSig = '';          // 最近一个有意义字符(正则字面量判定用)
  for (let j = i; j < src.length; j++) {
    const c = src[j], n = src[j + 1];
    const st = frames[frames.length - 1];
    if (st === 'code') {
      if (c === '/' && n === '/') { frames.push('line'); j++; continue; }
      if (c === '/' && n === '*') { frames.push('block'); j++; continue; }
      if (c === '/' && isRegexPreceding(lastSig)) {
        // 正则字面量: 扫描到未转义的类外 `/`
        let inClass = false;
        j++;
        for (; j < src.length; j++) {
          const rc = src[j];
          if (rc === '\\') { j++; continue; }
          if (rc === '[') inClass = true;
          else if (rc === ']') inClass = false;
          else if (rc === '/' && !inClass) break;
          else if (rc === '\n') break; // 防御: 非正则时止损
        }
        // 跳过标志位
        while (j + 1 < src.length && 'gimsuyd'.includes(src[j + 1])) j++;
        lastSig = '/';
        continue;
      }
      if (c === "'") { frames.push('sq'); continue; }
      if (c === '"') { frames.push('dq'); continue; }
      if (c === '`') { frames.push('tpl'); continue; }
      if (c === '{') { depth++; }
      else if (c === '}') {
        depth--;
        if (depth < frameBase[frameBase.length - 1]) {
          frames.pop(); frameBase.pop();
          if (frames.length === 0) return src.slice(m.index, j + 1);
        }
      }
      if (!/\s/.test(c)) lastSig = c;
    } else if (st === 'tpl') {
      if (c === '\\') j++;
      else if (c === '`') frames.pop();
      else if (c === '$' && n === '{') { frames.push('code'); frameBase.push(depth + 1); depth++; j++; }
    } else if (st === 'line') {
      if (c === '\n') frames.pop();
    } else if (st === 'block') {
      if (c === '*' && n === '/') { frames.pop(); j++; }
    } else if (st === 'sq') {
      if (c === '\\') j++;
      else if (c === "'" || c === '\n') frames.pop();
    } else if (st === 'dq') {
      if (c === '\\') j++;
      else if (c === '"' || c === '\n') frames.pop();
    }
  }
  throw new Error('extractNamedBlock: ' + name + ' 花括号不配对');
}

/** 构造路由到 MockFeishuServer 的 fetch 桩 */
function createMockFetch(mock) {
  return async function mockFetch(url, init) {
    init = init || {};
    const method = (init.method || 'GET').toUpperCase();
    const headers = init.headers || {};
    const r = await mock.handle(method, String(url), headers, init.body);
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      statusText: String(r.status),
      json: async () => {
        if (r.json !== undefined) return r.json;
        throw new Error('mock: 响应无JSON体');
      },
      text: async () => {
        if (r.buffer) return new TextDecoder('utf-8').decode(r.buffer);
        return JSON.stringify(r.json);
      },
      arrayBuffer: async () => {
        if (r.buffer) return r.buffer.buffer.slice(r.buffer.byteOffset, r.buffer.byteOffset + r.buffer.byteLength);
        return new ArrayBuffer(0);
      },
    };
  };
}

/** 内存版 localStorage */
function createLocalStorage() {
  const map = new Map();
  return {
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: k => map.delete(k),
    clear: () => map.clear(),
    _dump: () => Object.fromEntries(map),
  };
}

/** demo.html 同步链路需要提取的声明清单(依赖序)
 *  V10.12: 移除_FS_XOR_KEY/_fsDec(已从源码删除,改为构建期注入window.__BUILD_SECRETS__)
 *  —— 若测试需要mock飞书配置,通过 opts.feishuConfig 传入(本文件下方已支持注入)
 */
const DEMO_BLOCKS = [
  'DEFAULT_FEISHU_CONFIG', '_INJECTED_SECRETS_CACHE', 'getFeishuCfg', 'feishuCfgReady',
  'httpFetch', 'httpUploadFile',
  'FEISHU_UPLOAD_ALL_LIMIT', 'FEISHU_MULTIPART_THRESHOLD', 'FEISHU_MULTIPART_MAX',
  '_feishuUploadLastTs', '_feishuQpsGate', '_adler32', '_sanitizeFeishuFileName',
  '_uploadPartOnce', 'httpUploadFileMultipart', 'httpUploadFileSmart',
  'feishuListFiles', 'getDataFolderToken', 'getDataSubFolderToken', 'invalidateDataFolderCache',
  'APP_VERSION',
  '_b64ToU8',
  'getFeishuToken', 'uploadJsonToFolder', 'fetchSignalSafe', 'downloadJsonFromFolder',
  'uploadJsonToDataFeishu', 'downloadJsonFromDataFeishu', 'downloadSyncDataMigrated',
  '_strHashDjb2', '_normalizePhotoForUpload',
  'State', // V10.13 A3状态守卫: doSyncDownload/_syncUploadPipeline经State API写VEHICLES/USERS
  'syncUploadVehiclePhotos', 'syncUploadVehicleVideos', '_syncUploadPipeline', 'doSyncDownload',
];

/**
 * 构造"真机模拟"沙箱: demo.html 真实函数 + 浏览器API桩 + fetch→mock
 * @param {Object} opts - {mock, vehicles, userName, feishuConfig?}
 * @returns {Object} {ctx, run(expr), stubs}
 */
function createAppSandbox(opts) {
  const { mock } = opts;
  const src = loadCombinedSource();
  const localStorage = createLocalStorage();
  const stubs = {
    toasts: [], syncLogs: [], persists: 0, renders: 0, confirms: [],
  };

  const sandbox = {
    console,
    localStorage,
    window: null, // 下面自引用
    FormData, Blob, URL, URLSearchParams, TextDecoder, TextEncoder,
    AbortController, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Promise, Set, Map, RegExp, Error, String, Number, Boolean, Array, Object, Uint8Array, ArrayBuffer,
    fetch: createMockFetch(mock),
    // DOM桩
    document: {
      getElementById: () => null,
      createElement: () => ({
        width: 0, height: 0,
        getContext: () => ({ drawImage() {} }),
        toDataURL: () => 'data:image/jpeg;base64,',
      }),
    },
    // Image桩: 解码必失败 → _normalizePhotoForUpload 走"原样上传"兜底分支
    Image: class { set src(v) { setTimeout(() => this.onerror && this.onerror(new Error('mock decode')), 0); } },
    // UI桩
    showToast: msg => stubs.toasts.push(String(msg)),
    addSyncLog: (msg, color) => stubs.syncLogs.push({ msg, color }),
    showConfirm: (title, msg, cb) => { stubs.confirms.push(title); cb && cb(); },
    persistVehicles: () => { stubs.persists++; },
    renderVehicleList: () => { stubs.renders++; },
    renderBrandTags: () => {},
    renderSyncLog: () => {},
    getPinyin: s => s,
    _setSyncNewDot: () => {},
    canEdit: () => opts.role !== 'member',
    // 业务状态
    VEHICLES: opts.vehicles || [],
    state: { currentUser: { name: opts.userName || '组长-测试' } },
  };
  sandbox.window = sandbox; // 自引用: window.cordova 为 undefined → 走fetch路径
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  // 注入飞书配置(模拟真机"设置"页已填写)
  const cfg = Object.assign({ appId: 'cli_mock', appSecret: 'secret_mock', folder: mock.ROOT }, opts.feishuConfig);
  localStorage.setItem('feishu_config', JSON.stringify(cfg));

  // 按依赖序注入真实实现
  for (const name of DEMO_BLOCKS) {
    const block = extractNamedBlock(src, name);
    vm.runInContext(block, ctx, { filename: 'demo.html#' + name + '.js' });
  }
  return {
    ctx, stubs, localStorage,
    run: expr => vm.runInContext(expr, ctx, { filename: 'e2e_eval.js' }),
  };
}

/**
 * 构造 feishu-api.js(FeishuDataLayer)沙箱
 * @param {Object} opts - {mock, folderToken?}
 */
function createFeishuApiSandbox(opts) {
  const { mock } = opts;
  const src = fs.readFileSync(FEISHU_API_PATH, 'utf8');
  const localStorage = createLocalStorage();
  const sandbox = {
    console,
    localStorage,
    FormData, Blob, URL, URLSearchParams, TextDecoder, TextEncoder,
    AbortController, atob, btoa, setTimeout, clearTimeout, setInterval, clearInterval,
    Date, JSON, Math, Promise, Set, Map, RegExp, Error, String, Number, Boolean, Array, Object, Uint8Array, ArrayBuffer,
    fetch: createMockFetch(mock),
    window: null,
  };
  sandbox.window = sandbox;
  const ctx = vm.createContext(sandbox);
  vm.runInContext(src, ctx, { filename: 'feishu-api.js' });
  return { ctx, run: expr => vm.runInContext(expr, ctx, { filename: 'e2e_eval_api.js' }) };
}

/**
 * V10.12 A2 拆分兼容(共享版): demo.html 骨架化后主逻辑在 9 个 <script defer src="js/..."> 中,
 * vm/旧版提取器拿不到。本函数将 defer 标签内联回 html(移至 </body> 前, 还原原始执行时序),
 * 内联内容做 HTML-tokenizer 净化(字面 </script 与 <!-- 替换为 JS 语义等义转义)。
 * 供 test_v53_runtime / test_v103~v109 / test_v57_cross_network 等直接读 demo.html 的旧测试复用。
 * @param {string} html - demo.html 原文
 * @returns {string} 内联 js/*.js 后的 html
 */
function inlineDeferScripts(html) {
  const re = /[ \t]*<script[^>]+defer[^>]+src="(js\/[^"]+\.js)"[^>]*><\/script>[ \t]*(?:\r?\n|$)/g;
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return html;
  const inlined = [];
  let replaced = html;
  for (const m of matches) {
    replaced = replaced.replace(m[0], '');
    const srcFile = path.join(__dirname, '..', m[1]);
    if (!fs.existsSync(srcFile)) {
      console.error('[inlineDeferScripts] 缺少 ' + srcFile + ' → 测试可能加载失败');
      continue;
    }
    const content = fs.readFileSync(srcFile, 'utf8')
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<\\!--');
    inlined.push(`<script>\n${content}\n</script>\n`);
  }
  const closeIdx = replaced.lastIndexOf('</body>');
  if (closeIdx >= 0) {
    replaced = replaced.slice(0, closeIdx) + inlined.join('') + replaced.slice(closeIdx);
  } else {
    replaced += inlined.join('');
  }
  return replaced;
}

/**
 * V10.12 A2-1 兼容(共享版): CSS 抽取到 css/app.css 后, 旧测试在 demo.html 内
 * 搜不到样式规则。本函数把 <link rel="stylesheet" href="css/app.css"> 替换为
 * 内联 <style>, 使基于 html 字符串的 CSS 断言继续有效。
 * @param {string} html - demo.html 原文
 * @returns {string} 内联 css/app.css 后的 html(文件不存在则原样返回)
 */
function inlineStylesheets(html) {
  const re = /[ \t]*<link[^>]+href="(css\/[^"]+\.css)"[^>]*>[ \t]*(?:\r?\n|$)/g;
  return html.replace(re, (m, href) => {
    const cssFile = path.join(__dirname, '..', href);
    if (!fs.existsSync(cssFile)) return m;
    return `<style>\n${fs.readFileSync(cssFile, 'utf8')}\n</style>\n`;
  });
}

module.exports = { loadCombinedSource, inlineDeferScripts, inlineStylesheets, extractNamedBlock, createAppSandbox, createFeishuApiSandbox, createMockFetch, createLocalStorage, DEMO_PATH, FEISHU_API_PATH };
