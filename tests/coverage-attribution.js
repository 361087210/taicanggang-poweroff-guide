/**
 * ============================================================
 * coverage-attribution.js - c8/V8 行覆盖率归属支持
 * ============================================================
 * 问题: 本项目的 vm 沙箱测试用"合成 filename"注入源码片段, 例如
 *   `demo.html#State.js` / `v1020#getVehicles.js` / `State.js` /
 *   `js/16-audit.js`(裸相对路径)。c8 按被统计文件的 URL/filename
 *   归属覆盖率, 上述形态都无法匹配仓库里的真实源文件
 *   → 执行过的 js/ 源码在本报告中恒报 0%。
 *
 * 实测结论(见 docs/codebase/TESTING.md):
 *   绝对路径(D:\...\js\16-audit.js) 与 file:// 绝对 URL → 可归属;
 *   裸相对路径 / 合成名                                  → 不可归属。
 *
 * 做法: 在测试进程内一次性给 `vm.runInContext / runInNewContext`
 *   打一个"透明补丁": 仅当 filename 若能被识别为某个真实源文件时,
 *   把它改写为该文件的 **绝对路径**; 其余情况下原样透传。
 *   filename 只影响堆栈与覆盖率归属, **不改变任何执行语义**。
 *
 * 设计取舍: 用单点补丁替代逐个修改 18 个测试文件的 filename,
 *   避免大面积改动带来的回归风险; 未识别的 filename 一律透传,
 *   因此对测试正确性零影响(最坏情况只是覆盖率不归属)。
 *
 * 已知局限: 基于 JSDOM `window.eval(...)` 的测试不经过 vm.runInContext,
 *   其执行的 js/ 源码无法归属(见 TESTING.md "覆盖率口径"节)。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const REPO_ROOT = path.join(__dirname, '..');
const DEMO_PATH = path.join(REPO_ROOT, 'demo.html');
const FEISHU_API_PATH = path.join(REPO_ROOT, 'feishu-api.js');
const JS_DIR = path.join(REPO_ROOT, 'js');

/** 块名 → 源文件绝对路径 索引(惰性构建, 只建一次) */
let _blockFileIndex = null;

/**
 * 扫描 demo.html + js/*.js, 建立"声明名 → 所在文件绝对路径"索引。
 * 按文件名自然排序取首个命中, 与实际注入顺序一致。
 * @returns {Map<string,string>}
 */
function _buildBlockFileIndex() {
  const idx = new Map();
  const push = file => {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch (e) { return; }
    const re = /(?:^|\n)[ \t]*(?:export[ \t]+)?(?:default[ \t]+)?(?:async[ \t]+)?(?:function[ \t]+([A-Za-z_$][\w$]*)[ \t]*\(|(?:const|let|var)[ \t]+([A-Za-z_$][\w$]*)[ \t]*=)/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const nm = m[1] || m[2];
      if (nm && !idx.has(nm)) idx.set(nm, file);
    }
  };
  push(DEMO_PATH);
  if (fs.existsSync(JS_DIR)) {
    fs.readdirSync(JS_DIR)
      .filter(f => f.endsWith('.js'))
      .sort()
      .forEach(f => push(path.join(JS_DIR, f)));
  }
  return idx;
}

/**
 * 解析某声明块所在源文件的绝对路径。
 * @param {string} name - 声明名(如 State / getVehicles)
 * @returns {string|null} 绝对路径, 未找到返回 null
 */
function resolveBlockFile(name) {
  if (!_blockFileIndex) _blockFileIndex = _buildBlockFileIndex();
  return _blockFileIndex.get(name) || null;
}

/** 判断"仓库根相对路径"是否指向一个真实文件 */
function _existingRepoFile(rel) {
  if (!rel) return null;
  let p;
  try { p = path.join(REPO_ROOT, rel); } catch (e) { return null; }
  try {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  } catch (e) { /* ignore */ }
  return null;
}

/**
 * 把一个 vm filename 映射到真实源文件绝对路径。
 * 识别顺序: 已绝对 → 透传; `<prefix>#<Name>[.js]` → 先按块名再按前缀文件;
 *           `<path>.js` → 先按仓库相对真实文件再按块名。
 * 无法识别时返回 null(调用方透传原 filename)。
 * @param {string} filename
 * @returns {string|null}
 */
function mapFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  if (path.isAbsolute(filename)) return null;
  const norm = filename.replace(/\\/g, '/');

  const hashIdx = norm.indexOf('#');
  if (hashIdx !== -1) {
    const prefix = norm.slice(0, hashIdx);
    const name = norm.slice(hashIdx + 1).replace(/\.js$/, '');
    const byName = resolveBlockFile(name);
    if (byName) return byName;
    const byPrefix = _existingRepoFile(prefix) ||
      (/\.js$/.test(prefix) ? null : _existingRepoFile(prefix + '.js'));
    return byPrefix || null;
  }

  if (norm.endsWith('.js')) {
    const byFile = _existingRepoFile(norm);
    if (byFile) return byFile;
    return resolveBlockFile(norm.slice(0, -3));
  }
  return null;
}

let _installed = false;

/** 给 vm.runInContext / runInNewContext 打透明补丁(幂等) */
function install() {
  if (_installed) return;
  _installed = true;
  for (const fn of ['runInContext', 'runInNewContext']) {
    const orig = vm[fn];
    if (typeof orig !== 'function') continue;
    vm[fn] = function (code, context, options) {
      if (options && typeof options === 'object' && typeof options.filename === 'string') {
        const mapped = mapFilename(options.filename);
        if (mapped) {
          const opts = Object.assign({}, options, { filename: mapped });
          return orig.call(vm, code, context, opts);
        }
      }
      return orig.call(vm, code, context, options);
    };
  }
}

install();

module.exports = {
  install,
  mapFilename,
  resolveBlockFile,
  DEMO_PATH,
  FEISHU_API_PATH,
  JS_DIR,
  REPO_ROOT,
};
