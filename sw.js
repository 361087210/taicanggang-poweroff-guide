/* ===========================================================
 * 太仓港断电指导 PWA Service Worker (V10.14.3 iOS方案A深化)
 * 功能: 应用壳预缓存 + 离线降级 + 静态资源缓存优先 + API网络优先 + 新版本即时接管
 * 策略:
 *   - 飞书API/GitHub API: 网络优先(失败降级缓存)
 *   - 同源静态资源: 缓存优先(未命中再网络请求并回填)
 *   - 导航请求: 离线时返回demo.html应用壳
 * V10.14.3: 新增SKIP_WAITING消息处理(配合页面"立即更新"按钮即时接管) + PNG图标预缓存
 * =========================================================== */

const CACHE_NAME='tcg-poweroff-v10.14.3';
const APP_SHELL=[
  './demo.html',
  './css/app.css',
  './js/00-bootstrap.js',
  './js/01-state.js',
  './js/02-auth.js',
  './js/03-vehicles.js',
  './js/04-export.js',
  './js/05-sync.js',
  './js/06-media.js',
  './js/07-cache.js',
  './js/08-main.js',
  './feishu-api.js',
  './vehicles_data.js',
  './vendor/tailwind.js',
  './vendor/xlsx.full.min.js',
  './vendor/jspdf.umd.min.js',
  './vendor/jspdf.plugin.autotable.min.js',
  './vendor/html-docx.js',
  './vendor/html2canvas.min.js',
  './manifest.json',
  './icon.svg',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  './icon-192-maskable.png',
  './icon-512-maskable.png'
];

// Install: 预缓存应用壳
self.addEventListener('install',e=>{
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache=>cache.addAll(APP_SHELL))
      .then(()=>self.skipWaiting())
      .catch(err=>console.warn('[SW]预缓存部分失败(非阻塞):',err.message))
  );
});

// Activate: 清理旧缓存并接管客户端
self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

// V10.14.3: 页面"立即更新"按钮 → postMessage({action:'SKIP_WAITING'}) → 立即接管
self.addEventListener('message',e=>{
  if(e.data&&e.data.action==='SKIP_WAITING'){
    self.skipWaiting();
  }
});

// Fetch: 智能缓存策略
self.addEventListener('fetch',e=>{
  const req=e.request;
  // 仅拦截GET请求
  if(req.method!=='GET')return;

  const url=new URL(req.url);
  const isFeishuAPI=url.hostname.includes('feishu.cn')||url.hostname.includes('larksuite');
  const isGitHubAPI=url.hostname.includes('github.com')||url.hostname.includes('githubusercontent')||url.hostname.includes('jsdelivr.net');

  // 飞书/GitHub API: 网络优先(失败降级缓存)
  if(isFeishuAPI||isGitHubAPI){
    e.respondWith(
      fetch(req).catch(()=>caches.match(req))
    );
    return;
  }

  // 同源静态资源: 缓存优先
  if(url.origin===self.location.origin){
    e.respondWith(
      caches.match(req).then(cached=>{
        if(cached)return cached;
        return fetch(req).then(response=>{
          if(response.ok){
            const clone=response.clone();
            caches.open(CACHE_NAME).then(cache=>cache.put(req,clone));
          }
          return response;
        }).catch(()=>{
          // 离线降级: 导航请求返回应用壳
          if(req.mode==='navigate')return caches.match('./demo.html');
        });
      })
    );
    return;
  }

  // 跨域非API请求: 网络优先(失败降级缓存)
  e.respondWith(
    fetch(req).catch(()=>caches.match(req))
  );
});
