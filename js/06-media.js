/* ===========================================================
 * 模块: 06-media.js
 * 功能: 图片查看器/视频播放器/飞书云端图片视频/户外模式/模态框/侧栏/硬件反馈/等待文件就绪
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js, 03-vehicles.js, 04-export.js, 05-sync.js
 * 源范围: demo.html L5653-L6376
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
function imgLoadError(img){
  img.onerror=null;
  // V5.3: 先从飞书云端回退拉取,未命中再显示占位图
  const fn=(img.getAttribute('src')||'').split('/').pop();
  imgFromFeishuCloud(img,fn).then(ok=>{
    if(!ok)img.src=_imgPlaceholder();
  });
}

function openPhotoViewer(index){
  state.photoIndex=index;
  state.photoZoom=1;
  const img=document.getElementById('photo-viewer-img');
  const v=VEHICLES.find(x=>x.id===state.currentVehicleId);
  const labels=['前脸照片','车尾照片','钥匙照片','断电位照片'];
  document.getElementById('photo-viewer-label').textContent=labels[index]||`照片 ${index+1}`;
  if(v&&v.photoPaths&&v.photoPaths[index]){
    img.src=v.photoPaths[index];
    // 运行时加载失败兜底: 先试飞书云端回退,再显示带车名的占位图而非破图图标
    img.onerror=()=>{
      img.onerror=null;
      const fn=(v.photoPaths[index]||'').split('/').pop();
      imgFromFeishuCloud(img,fn).then(ok=>{
        if(!ok)img.src='data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1a1a2e"/><text x="200" y="150" text-anchor="middle" fill="#666" font-size="20" font-family="sans-serif">${v?v.display:''} - ${labels[index]||'照片'}</text><rect x="50" y="50" width="300" height="200" fill="none" stroke="#444" stroke-width="2" rx="10"/><circle cx="120" cy="120" r="15" fill="#333"/><path d="M50 250 L150 150 L250 200 L350 100 L350 250 Z" fill="#222"/></svg>`);
      });
    };
  }else{
    img.src='data:image/svg+xml;utf8,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#1a1a2e"/><text x="200" y="150" text-anchor="middle" fill="#666" font-size="20" font-family="sans-serif">${v?v.display:''} - ${labels[index]||'照片'}</text><rect x="50" y="50" width="300" height="200" fill="none" stroke="#444" stroke-width="2" rx="10"/><circle cx="120" cy="120" r="15" fill="#333"/><path d="M50 250 L150 150 L250 200 L350 100 L350 250 Z" fill="#222"/></svg>`);
  }
  img.style.transform='scale(1)';
  document.getElementById('photo-viewer').classList.add('show');
}

function closePhotoViewer(){document.getElementById('photo-viewer').classList.remove('show');}

function cycleZoom(){
  state.photoZoom=state.photoZoom===1?2:state.photoZoom===2?3:1;
  document.getElementById('photo-viewer-img').style.transform=`scale(${state.photoZoom})`;
}

function resetZoom(){state.photoZoom=1;document.getElementById('photo-viewer-img').style.transform='scale(1)';}

// ===================== VIDEO PLAYER =====================
/**
 * 视频播放器 - V5.3.5五源回退链(视频根源修复迭代)
 * 为什么重构: 43辆车的videoPaths引用vehicle_videos/*.mp4,但视频文件从未随
 * 项目分发(本地无/GitHub仓库无),CDN回退链接也必然404,真机上必然播放失败。
 * V5.3.5源链: ①本地APK内 → ②GitHub Release直链(免鉴权+Range流式,秒开可拖动)
 *          → ③飞书云端"APP数据备份/vehicle_videos"(组长通过APP上传的新视频)
 *          → ④GitHub jsDelivr CDN → ⑤诚实提示"视频待上传"+组长上传入口
 * ②优于③的原因: Release直链支持HTTP Range边下边播, 飞书方案需全量下载完才能播。
 * 不伪造视频: AI生成的假断电操作视频会误导现场作业,宁可明确提示待补充。
 */
/**
 * V5.9.0 视频播放会话守卫(问题2根治)
 * 根因: 五源回退链是长异步链(飞书分片下载可达分钟级),用户在加载完成前退出时,
 * 旧版closeVideoPlayer只清了"当前这一个"定时器与回调,仍在途的异步链完成后会
 * 再次调用tryPlaySource:重新挂载onerror/8秒定时器/设置src并play()——播放器状态
 * 被"复活",叠加WebView异常时'show'类未移除,表现为无法返回上一层+残留音频。
 * 方案: 会话号(_videoSession)机制(业界标准做法,等价于取消令牌):
 *  - openVideoPlayer开启新会话并捕获会话号,整条源链传递该会话号;
 *  - 所有异步续体(定时器/错误回调/飞书下载完成回调)执行前先校验会话号,
 *    会话已失效则直接终止,关闭后的源链彻底死透;
 *  - closeVideoPlayer递增会话号使所有在途回调全部失效。
 */
let _videoSession=0;

async function openVideoPlayer(){
  const v=VEHICLES.find(x=>x.id===state.currentVehicleId);
  if(!v||!v.videoPaths||!v.videoPaths.length){
    showToast('该车辆暂无视频');
    return;
  }
  const session=++_videoSession; // 开启新播放会话,旧会话的源链自动失效
  document.getElementById('video-player').classList.add('show');
  const video=document.getElementById('video-element');
  const cdnBase=`https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@${GITHUB_BRANCH}`;
  const fileName=v.videoPaths[0].split('/').pop();

  // 清除旧的事件监听器与错误提示
  video.onerror=null;
  video.onloadeddata=null;
  clearVideoError();

  // V10.4.0 问题2: 播放标记钩子——观看≥3秒或播放结束(ended)时标记"已播放",
  // 缓存管理列表据此显示「已播放」徽标;先移除上一会话的钩子防止监听器累积
  if(video._playedHook){
    video.removeEventListener('timeupdate',video._playedHook);
    video.removeEventListener('ended',video._playedHook);
  }
  video._playedHook=function(){
    if(session!==_videoSession)return; // 会话已失效,终止
    if(video.currentTime>=3||video.ended){
      if(markVideoAsPlayed(fileName)){
        video.removeEventListener('timeupdate',video._playedHook);
        video.removeEventListener('ended',video._playedHook);
      }
    }
  };
  video.addEventListener('timeupdate',video._playedHook,{passive:true});
  video.addEventListener('ended',video._playedHook,{passive:true});

  video.onloadeddata=function(){
    if(session!==_videoSession)return; // 会话已失效,不再处理
    const err=video.parentElement.querySelector('.video-error');
    if(err)err.remove();
  };

  // V10.2 问题1修复: 网络源链抽为独立函数,供磁盘缓存未命中/缓存损坏两条路径复用
  const playFromNetwork=()=>{
    // 源①: 本地APK内路径
    tryPlaySource(video,v.videoPaths[0],()=>{
      if(session!==_videoSession)return; // 用户已退出,终止源链
      // 源②: GitHub Release直链(V5.3.5, 免鉴权+Range流式秒开)
      const directUrl=mediaDirectUrl(fileName);
      if(directUrl){
        // V10.2: 流式播放成功后异步抓取落盘,下次秒开
        tryPlaySource(video,directUrl,()=>tryFeishuVideoSource(video,fileName,cdnBase,v.videoPaths[0],session),session,()=>{cacheUrlToDisk(directUrl,fileName);});
      }else{
        // 未映射的视频(组长新上传)直接走飞书云端
        tryFeishuVideoSource(video,fileName,cdnBase,v.videoPaths[0],session);
      }
    },session);
  };

  // 源⓪: V10.2 问题1修复——本地磁盘持久缓存命中,file://直读秒开
  // 根因: 旧版仅内存objectURL缓存,App重启即失效,每次播放重新走网络加载
  const cachedUrl=await cacheFileUrl(CACHE_DIR_VIDEOS,fileName).catch(()=>null);
  if(session!==_videoSession)return; // 查询期间用户已退出
  if(cachedUrl){
    console.log('[视频]命中本地磁盘缓存:',fileName);
    tryPlaySource(video,cachedUrl,()=>{
      // 缓存文件损坏(写入中断等)→ 清理损坏文件并回退完整网络源链
      if(session!==_videoSession)return;
      console.warn('[视频]磁盘缓存损坏,回退网络源链');
      cacheDeleteFiles(CACHE_DIR_VIDEOS,[fileName]).catch(()=>{});
      playFromNetwork();
    },session);
    return;
  }
  playFromNetwork();
}

/**
 * 飞书云端视频源 + CDN回退链(V5.3.5从openVideoPlayer拆出)
 * 为什么拆分: 五源链嵌套过深违反单一职责,拆出后openVideoPlayer保持可读。
 * @param {HTMLVideoElement} video - 播放器元素
 * @param {string} fileName - 视频文件名
 * @param {string} cdnBase - jsDelivr CDN基址
 * @param {string} videoPath - 车型数据中的相对视频路径
 * @param {number} [session] - V5.9.0播放会话号(缺省视为当前会话,兼容旧调用点)
 */
function tryFeishuVideoSource(video,fileName,cdnBase,videoPath,session){
  if(session!==undefined&&session!==_videoSession)return; // 会话已失效(用户已退出),终止
  // 源③: 飞书云端(组长上传的真实视频)
  playFromFeishuCloud(video,fileName,session).then(ok=>{
    if(session!==undefined&&session!==_videoSession)return; // 下载期间用户已退出,丢弃结果
    if(ok)return;
    // 源④: GitHub jsDelivr CDN(视频曾同步到仓库时可用)
    // V10.2: CDN流式播放成功后异步抓取落盘,下次秒开
    const cdnUrl=cdnBase+'/'+videoPath;
    tryPlaySource(video,cdnUrl,()=>{
      if(session!==undefined&&session!==_videoSession)return;
      // 源⑤: 全部失败 → 诚实提示 + 组长上传入口
      showVideoMissing(fileName,video);
    },session,()=>{cacheUrlToDisk(cdnUrl,fileName);});
  });
}

/**
 * 尝试播放单个源,失败时回调fallback继续下一源
 * @param {HTMLVideoElement} video - 播放器元素
 * @param {string} src - 视频源地址
 * @param {Function} fallback - 该源失败后的回退函数
 * @param {number} [session] - V5.9.0播放会话号:关闭播放器后所有续体自动失效
 * @param {Function} [onReady] - V10.2可选:该源播放成功后的回调(用于流式源异步落盘预缓存)
 */
function tryPlaySource(video,src,fallback,session,onReady){
  // V5.9.0: 会话已失效(播放器已关闭)则本源与后续回退链全部终止
  if(session!==undefined&&session!==_videoSession)return;
  // V5.8.2: 显示加载状态指示器(方案3步骤三)
  const loadingEl=document.getElementById('video-loading');
  if(loadingEl)loadingEl.classList.add('show');
  let settled=false;
  const onErr=()=>{
    if(settled)return;settled=true;
    if(loadingEl)loadingEl.classList.remove('show');
    // V5.9.0: 会话已失效(用户已退出),不再继续回退链
    if(session!==undefined&&session!==_videoSession)return;
    console.warn('[视频]源加载失败,切换下一源:',src);
    fallback();
  };
  video.onerror=onErr;
  // 8秒超时保护: 部分ROM上onerror不触发,只有加载停滞
  const timer=setTimeout(onErr,8000);
  // V5.8.1: 将timer存到video元素上,closeVideoPlayer可统一清理
  video._currentTimer=timer;
  video.onloadeddata=()=>{
    clearTimeout(timer);settled=true;
    video._currentTimer=null;
    if(loadingEl)loadingEl.classList.remove('show');
    // V5.9.0: 会话已失效时连错误占位清理都不必做(容器已隐藏且会被close清理)
    if(session!==undefined&&session!==_videoSession)return;
    const err=video.parentElement.querySelector('.video-error');
    if(err)err.remove();
    // V10.2: 播放成功回调(会话守卫内),流式源在此触发异步落盘
    if(typeof onReady==='function'){try{onReady();}catch(e){console.warn('[视频]onReady回调异常:',e);}}
  };
  video.src=src;
  video.load();
  video.play().catch(()=>{/* 自动播放被阻止,用户手动点击播放 */});
}

/**
 * 从飞书云端"APP数据备份/vehicle_videos"下载视频并播放 - V5.3新增/V5.3.1分片重组
 * 组长上传的真实断电操作视频通过此通道分发到所有设备。
 * 云端两种形态(受飞书租户20MB单文件上限约束,大文件由同步工具按19MB切片):
 *   ① 完整文件 X.mp4 (≤19MB直传)
 *   ② 分片序列 X.mp4.part001 / .part002 / ... (按序下载重组后播放)
 * @param {HTMLVideoElement} video - 播放器元素
 * @param {string} fileName - 视频文件名
 * @returns {Promise<boolean>} 是否成功开始播放
 */
let _feishuVideoCache={name:null,url:null};

/* ===================== 照片飞书回退链(V5.3) =====================
 * 与视频回退链对称(问题4:查看照片时从飞书拉取):
 * 本地APK内图片缺失/加载失败时,自动按文件名从飞书云端
 * "APP数据备份/vehicle_images"拉取,命中后缓存objectURL复用。
 * 图片单文件小(≤500KB),无20MB分片问题;缓存上限40张防内存膨胀。
 */
let _feishuImgCache={}; // fileName -> objectURL

/** 通用"照片暂缺"占位图 */
function _imgPlaceholder(){
  return 'data:image/svg+xml;utf8,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150"><rect width="200" height="150" fill="#f3f4f6"/><text x="100" y="80" text-anchor="middle" fill="#9ca3af" font-size="14" font-family="sans-serif">照片暂缺</text></svg>');
}

/**
 * 从飞书云端拉取单张照片并注入img元素
 * @param {HTMLImageElement} img - 目标图片元素
 * @param {string} fileName - 照片文件名(如 image1.jpeg)
 * @returns {Promise<boolean>} 是否命中云端
 */
async function imgFromFeishuCloud(img,fileName){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg)||!fileName)return false; // V5.3.4: Secret缺失跳过(诊断根因1)
  try{
    if(_feishuImgCache[fileName]){img.onerror=null;img.src=_feishuImgCache[fileName];return true;}
    const token=await getFeishuToken(cfg);
    const dataFolder=await getDataFolderToken(token);
    if(!dataFolder)return false;
    const dataFiles=await feishuListFiles(token,dataFolder);
    if(!dataFiles)return false;
    const imgFolder=dataFiles.find(f=>f.type==='folder'&&f.name==='vehicle_images');
    if(!imgFolder)return false;
    const imgFiles=await feishuListFiles(token,imgFolder.token);
    if(!imgFiles)return false;
    const target=imgFiles.find(f=>f.type==='file'&&f.name===fileName);
    if(!target)return false;
    let blob;
    if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
      blob=await new Promise((resolve,reject)=>{
        window.cordova.plugin.http.sendRequest(
          `https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`,
          {method:'GET',headers:{Authorization:'Bearer '+token},responseType:'blob',timeout:60},
          res=>resolve(asBlob(res.data,'image/jpeg')),err=>reject(new Error(String(err.error||'图片下载失败')))); // V5.3.4: ArrayBuffer→Blob归一(根因4)
      });
    }else{
      const r=await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${target.token}/download`,{headers:{Authorization:'Bearer '+token}});
      blob=await r.blob();
    }
    if(!blob||blob.size<100)throw new Error('云端图片内容异常');
    const url=URL.createObjectURL(blob);
    const keys=Object.keys(_feishuImgCache);
    if(keys.length>=40){URL.revokeObjectURL(_feishuImgCache[keys[0]]);delete _feishuImgCache[keys[0]];}
    _feishuImgCache[fileName]=url;
    img.onerror=null;
    img.src=url;
    console.log('[照片]飞书云端源命中:',fileName);
    return true;
  }catch(e){
    console.warn('[照片]飞书云端源不可用:',e.message||e);
    feishuFailToast('图片'+(e.message||'加载失败')); // V5.3.4: 用户可见提示(诊断根因5)
    return false;
  }
}

/** 列表缩略图加载失败: 先试飞书云端,未命中再显示占位 */
function thumbImgError(img){
  img.onerror=null;
  const fn=(img.getAttribute('src')||'').split('/').pop();
  imgFromFeishuCloud(img,fn).then(ok=>{
    if(!ok)img.src=_imgPlaceholder();
  });
}

async function playFromFeishuCloud(video,fileName,session){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg))return false; // V5.3.4: Secret缺失跳过(诊断根因1)
  try{
    // 命中缓存直接复用(同一视频反复打开不再重复拉取分片)
    if(_feishuVideoCache.name===fileName&&_feishuVideoCache.url){
      tryPlaySource(video,_feishuVideoCache.url,()=>false,session);
      return true;
    }
    const token=await getFeishuToken(cfg);
    const dataFolder=await getDataFolderToken(token);
    if(!dataFolder)return false;
    // 在数据文件夹下查找vehicle_videos子目录(懒创建仅查询)
    const dataFiles=await feishuListFiles(token,dataFolder);
    if(!dataFiles)return false;
    const videoFolder=dataFiles.find(f=>f.type==='folder'&&f.name==='vehicle_videos');
    let cloudFiles=[];
    if(videoFolder){
      const allVideoFiles=await feishuListFiles(token,videoFolder.token);
      cloudFiles=(allVideoFiles||[]).filter(f=>f.type==='file');
    }
    let target=cloudFiles.find(f=>f.name===fileName);
    // 分片形态: X.mp4.part001..NNN,按数字序重组
    const partPrefix=fileName+'.part';
    const parts=cloudFiles.filter(f=>f.name.startsWith(partPrefix))
      .sort((a,b)=>parseInt(a.name.slice(partPrefix.length),10)-parseInt(b.name.slice(partPrefix.length),10));
    let rootHit=false;
    // V5.3.4修复(诊断根因2): 子目录未命中时回退项目根文件夹搜完整mp4
    // 根因: 云盘曾把17个完整MP4直接上传到项目根目录(而非vehicle_videos子目录),
    //       文件名与车型videoPaths完全匹配,但旧版只搜子目录,永远找不到,
    //       用户反复看到"视频待补充"而云端明明有视频。
    if(!target&&parts.length===0){
      const rootFiles=await feishuListFiles(token,cfg.folder);
      const rootTarget=rootFiles&&rootFiles.find(f=>f.type==='file'&&f.name===fileName);
      if(rootTarget){target=rootTarget;rootHit=true;}
    }
    const downloadBlob=async(fileToken)=>{
      if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
        return await new Promise((resolve,reject)=>{
          window.cordova.plugin.http.sendRequest(
            `https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`,
            {method:'GET',headers:{Authorization:'Bearer '+token},responseType:'blob',timeout:120},
            res=>resolve(asBlob(res.data,'video/mp4')),err=>reject(new Error(String(err.error||'分片下载失败'))) // V5.3.4: ArrayBuffer→Blob归一(根因4)
          );
        });
      }
      const r=await fetch(`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`,{headers:{Authorization:'Bearer '+token}});
      return await r.blob();
    };
    let blob;
    if(target){
      // ① 完整文件直下(子目录命中或根目录回退命中)
      blob=await downloadBlob(target.token);
    }else if(parts.length>0){
      // ② 分片序列: 逐片下载重组(全程提示进度,避免用户以为卡死)
      console.log(`[视频]云端命中分片序列:${fileName} × ${parts.length}片`);
      const chunks=[];
      for(let i=0;i<parts.length;i++){
        // V5.9.0: 下载期间用户已退出则中止后续分片拉取(会话守卫)
        if(session!==undefined&&session!==_videoSession){
          console.log('[视频]用户已退出,中止分片下载');
          return false;
        }
        showToast(`正在从飞书拉取视频分片 ${i+1}/${parts.length}...`);
        chunks.push(await downloadBlob(parts[i].token));
      }
      blob=new Blob(chunks,{type:'video/mp4'});
    }else{
      return false; // 云端无此视频
    }
    if(!blob||blob.size<1024)throw new Error('云端视频内容异常');
    // V5.9.0: 下载完成但用户已退出——直接丢弃结果,不复活播放器(旧版此处
    // 会继续tryPlaySource设置src并play(),导致关闭后残留音频/加载态复活)
    if(session!==undefined&&session!==_videoSession){
      console.log('[视频]下载完成但播放会话已结束,丢弃');
      return false;
    }
    const url=URL.createObjectURL(blob);
    if(_feishuVideoCache.url)URL.revokeObjectURL(_feishuVideoCache.url); // 只保留最近1个,防内存膨胀
    _feishuVideoCache={name:fileName,url};
    // V10.2 问题1修复: 飞书下载的完整blob(含分片重组)落盘持久缓存,下次file://秒开
    // fire-and-forget: 落盘失败不影响本次播放
    cacheSaveBlob(CACHE_DIR_VIDEOS,fileName,blob).catch(()=>{});
    tryPlaySource(video,url,()=>false,session);
    console.log('[视频]飞书云端源命中:',fileName,target?(rootHit?'(根目录回退完整文件)':'(完整文件)'):`(分片重组${parts.length}片,${(blob.size/1048576).toFixed(1)}MB)`);
    if(rootHit)addSyncLog(`视频命中根目录回退源 · ${fileName}`,'blue'); // V5.3.4: 回退命中留痕,便于云盘整理后观察
    return true;
  }catch(e){
    console.warn('[视频]飞书云端源不可用:',e.message||e);
    feishuFailToast('视频'+(e.message||'加载失败')); // V5.3.4: 用户可见提示(诊断根因5)
    return false;
  }
}

/**
 * 显示"视频待上传"诚实占位 - 全部源失败时
 * 组长/管理员额外显示上传按钮,上传后全组设备立即可播
 * @param {string} fileName - 期望的视频文件名
 * @param {HTMLVideoElement} video - 播放器元素
 */
function showVideoMissing(fileName,video){
  clearVideoError();
  const container=video.parentElement;
  const isAdmin=state.currentUser&&state.currentUser.role==='admin'&&state.currentUser.status==='active';
  const div=document.createElement('div');
  div.className='video-error';
  div.style.cssText='position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#fff;text-align:center;font-size:14px;max-width:90%;z-index:5;';
  div.innerHTML='<div style="font-size:40px;margin-bottom:10px;">📹</div>教学视频待补充'+
    '<div style="font-size:12px;color:#999;margin-top:6px;">现场请按图文步骤操作</div>'+
    (isAdmin?`<button onclick="pickVideoFile()" style="margin-top:12px;padding:8px 20px;background:#2563eb;color:#fff;border:none;border-radius:8px;font-size:13px;">上传本车视频</button>`:'');
  container.appendChild(div);
}

/** 清除视频错误占位层 */
function clearVideoError(){
  const video=document.getElementById('video-element');
  const container=video?video.parentElement:null;
  const err=container?container.querySelector('.video-error'):null;
  if(err)err.remove();
}

/**
 * 组长选择本地视频文件并上传到飞书 - V5.3新增
 * 上传到"APP数据备份/vehicle_videos/<fileName>",其他设备播放时自动命中云端源
 * V10.10.0: 解除20MB硬拒绝——>16MB自动走飞书官方分片上传(上限500MB),
 *   随机文件名先经_sanitizeFeishuFileName清洗,防1061109合规拒绝
 */
function pickVideoFile(){
  const v=VEHICLES.find(x=>x.id===state.currentVehicleId);
  if(!v||!v.videoPaths||!v.videoPaths.length)return;
  const fileName=_sanitizeFeishuFileName(v.videoPaths[0].split('/').pop());
  const input=document.createElement('input');
  input.type='file';
  input.accept='video/mp4,video/quicktime,video/webm';
  input.onchange=async()=>{
    const file=input.files&&input.files[0];
    if(!file)return;
    if(file.size>FEISHU_MULTIPART_MAX){
      showToast('视频超过500MB上限,请压缩后重传');
      return;
    }
    showToast(file.size>FEISHU_MULTIPART_THRESHOLD?'大视频将分片上传中...':'视频上传中...');
    try{
      const cfg=getFeishuCfg();
      if(!feishuCfgReady(cfg))throw new Error('飞书配置不完整: 请在设置中填写 App Secret'); // V5.3.4(诊断根因1)
      const token=await getFeishuToken(cfg);
      const dataFolder=await getDataFolderToken(token);
      if(!dataFolder)throw new Error('数据文件夹不可用');
      // 确保vehicle_videos子目录存在(先查后建)
      let vfToken=null;
      const exist=(await feishuListFiles(token,dataFolder)||[]).find(f=>f.type==='folder'&&f.name==='vehicle_videos');
      if(exist)vfToken=exist.token;
      if(!vfToken){
        const cr=await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({name:'vehicle_videos',folder_token:dataFolder})});
        vfToken=(cr.data||{}).token;
      }
      if(!vfToken)throw new Error('创建视频文件夹失败');
      // V10.10.0: 智能路由——>16MB自动分片上传,附分片进度提示
      const res=await httpUploadFileSmart({token,fileName,folderToken:vfToken,blob:file,
        onProgress:(done,total)=>{if(total>1)showToast(`视频分片上传 ${done}/${total}...`);}});
      if(res.code!==0)throw new Error(res.msg||'飞书拒绝上传');
      showToast('视频上传成功,全组设备已可播放');
      addSyncLog(`视频上传成功 · ${fileName} · ${(file.size/1048576).toFixed(1)}MB`,'green');
      clearVideoError();
      openVideoPlayer();
    }catch(err){
      console.error('Video upload failed:',err);
      showToast('视频上传失败: '+(err.message||err));
      addSyncLog('视频上传失败: '+(err.message||err),'red');
    }
  };
  input.click();
}

function closeVideoPlayer(){
  // V5.9.0加固: ①先递增会话号使所有在途异步源链(定时器/错误回调/飞书下载
  // 完成回调)全部失效;②先移除'show'类再清理video——即使某ROM的WebView在
  // pause/load阶段抛异常,播放器也已确定关闭,返回键不会被卡死在"关闭播放器"
  // 这一层(旧版'show'移除放在函数末尾,中途异常会导致播放器关不掉+无法返回)
  _videoSession++;
  document.getElementById('video-player').classList.remove('show');
  try{
    // V10.4.0 问题5.1: 关闭播放器前先退出全屏态。
    // 根因: video进入全屏后WebView接管整个窗口,若只移除overlay不退出全屏,
    // 全屏黑屏残留且手势返回被WebView全屏层吞掉——表现为"退出全屏后无法手势返回"。
    // 退出全屏必须发生在移除src之前(部分ROM在无媒体源时exitFullscreen抛异常)。
    const fsEl=document.fullscreenElement||document.webkitFullscreenElement;
    if(fsEl){
      if(document.exitFullscreen){const p=document.exitFullscreen();if(p&&p.catch)p.catch(()=>{});}
      else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
    }
    const video=document.getElementById('video-element');
    // V5.8.1: 清理tryPlaySource的8秒超时定时器,防止关闭后异步回调重新设置src并播放
    if(video._currentTimer){clearTimeout(video._currentTimer);video._currentTimer=null;}
    // V5.8.1: 清除事件回调,防止onerror/onloadeddata在src清空后仍被触发
    video.onerror=null;
    video.onloadeddata=null;
    // V10.4.0 问题2: 同步摘除播放标记钩子,防止关闭后timeupdate仍触发标记
    if(video._playedHook){
      video.removeEventListener('timeupdate',video._playedHook);
      video.removeEventListener('ended',video._playedHook);
    }
    video.pause();
    video.removeAttribute('src');
    video.load(); // 触发unload,确保释放媒体资源(部分浏览器仅src=''不释放)
  }catch(e){
    // 个别ROM的WebView在媒体态切换时可能抛异常:播放器已隐藏,此处仅记录
    console.warn('[视频]关闭时媒体清理异常(已忽略):',e&&e.message);
  }
  // V5.8.2: 隐藏加载状态指示器(方案3步骤三)
  const loadingEl=document.getElementById('video-loading');
  if(loadingEl)loadingEl.classList.remove('show');
  // 清除视频错误提示
  const container=document.getElementById('video-element');
  const c2=container?container.parentElement:null;
  const err=c2?c2.querySelector('.video-error'):null;
  if(err)err.remove();
  const errMsg=c2?c2.querySelector('.video-error-msg'):null;
  if(errMsg)errMsg.classList.remove('show');
}

function setVideoSpeed(speed){
  document.getElementById('video-element').playbackRate=parseFloat(speed);
}

/**
 * V10.4.0 问题5.1: 全屏切换修复
 * 旧版toggleFullscreen只进不出——进入全屏后按钮再点无反应,用户只能靠系统返回键
 * 退出全屏;而旧版backbutton又因cordova.js缺失从未注册,形成"全屏后无法返回"死局。
 * 现改为标准切换语义: 全屏中→退出全屏;非全屏→进入全屏。
 * 兼容: 标准Fullscreen API + webkit前缀(老WebView) + video原生的webkitEnterFullscreen。
 */
function toggleFullscreen(){
  const video=document.getElementById('video-element');
  const fsEl=document.fullscreenElement||document.webkitFullscreenElement;
  if(fsEl){
    // 退出全屏
    if(document.exitFullscreen){const p=document.exitFullscreen();if(p&&p.catch)p.catch(()=>{});}
    else if(document.webkitExitFullscreen)document.webkitExitFullscreen();
    return;
  }
  // 进入全屏
  if(video.requestFullscreen){const p=video.requestFullscreen();if(p&&p.catch)p.catch(()=>{});}
  else if(video.webkitEnterFullscreen)video.webkitEnterFullscreen();
}

// ===================== OUTDOOR MODE =====================
function toggleOutdoorMode(){
  state.outdoorMode=!state.outdoorMode;
  document.getElementById('app-root').classList.toggle('outdoor',state.outdoorMode);
  document.getElementById('toggle-outdoor').classList.toggle('on',state.outdoorMode);
  showToast(state.outdoorMode?'高对比度户外模式已开启':'户外模式已关闭');
}

// ===================== MODALS =====================
function openModal(id){document.getElementById(id).classList.add('show');}
function closeModal(id){document.getElementById(id).classList.remove('show');}

function openSideMenu(){
  if(state.currentUser){
    document.getElementById('side-avatar').textContent=state.currentUser.name.charAt(0);
    document.getElementById('side-phone').textContent=state.currentUser.phone;
    document.getElementById('side-role').textContent=state.currentUser.role==='admin'?'组长':'组员';
  }
  /* V10.7.0 问题3: 组员端隐藏组员管理入口——车型页右上角菜单打开侧边栏时
   * 按角色裁剪菜单项。canEdit()=isLeader()=仅组长可见,组员只能看到
   * 数据中心/数据同步/个人中心/退出登录四项,组员管理入口完全不可见。
   * 「我的」页的menu-members入口在_activateScreen('screen-my')已有同款控制,
   * 此处补齐侧边菜单这条路径,两个入口的权限裁剪策略完全一致。 */
  const smm=document.getElementById('side-menu-members');
  if(smm)smm.style.display=canEdit()?'flex':'none';
  openModal('modal-side-menu');
}

function showConfirm(title,msg,callback){
  document.getElementById('confirm-title').textContent=title;
  document.getElementById('confirm-msg').textContent=msg;
  confirmCallback=callback;
  openModal('modal-confirm');
}

function confirmAction(){
  closeModal('modal-confirm');
  if(confirmCallback){confirmCallback();confirmCallback=null;}
  confirmCancelCallback=null;
}

function confirmCancelAction(){
  closeModal('modal-confirm');
  if(confirmCancelCallback){confirmCancelCallback();confirmCancelCallback=null;}
  confirmCallback=null;
}

// ===================== MEMBERS =====================
function renderMemberList(){
  const c=document.getElementById('member-list');
  if(!c)return;
  // V10.6.0 问题2: 跨网络组员(hidden或crossPlatform标记)在组长端全部隐形——
  // 不进组员列表/不计入展示,仅保留在USERS数据层随approved_users.json同步,
  // 兼容V10.4/10.5已落地的跨端记录(旧记录无hidden字段,以crossPlatform一并过滤)
  const activeUsers=USERS.filter(u=>u.role==='user'&&u.status==='active'&&!u.hidden&&!u.crossPlatform);
  c.innerHTML=activeUsers.map(u=>{
    return `
    <div class="flex items-center justify-between py-2 px-2 bg-gray-50 rounded-lg">
      <div class="min-w-0"><div class="text-sm text-gray-800 truncate">${esc(u.name)}</div><div class="text-xs text-gray-400">${esc(u.phone)} · ${esc(u.created)}</div></div>
      <div class="flex gap-2 flex-shrink-0">
        <button onclick="resetMemberPass(${u.id})" class="text-xs text-blue-400">重置密码</button>
        <button onclick="deleteMember(${u.id})" class="text-xs text-red-400">删除</button>
      </div>
    </div>`;
  }).join('')||'<div class="text-center text-sm text-gray-400 py-4">暂无组员</div>';

  const pc=document.getElementById('pending-list');
  if(pc){
    // V10.6.0 问题2: 待审核队列同样排除跨网络申请(防御性,跨网络申请不应进入pending态)
    const pending=USERS.filter(u=>u.status==='pending'&&!u.hidden&&!u.crossPlatform);
    const pcount=document.getElementById('pending-count');
    if(pcount)pcount.textContent=pending.length?`(${pending.length})`:'';
    // V10.0: 增强待审核列表UI——显示完整注册信息,组长可清楚看到申请人详情
    // V10.1 问题3修复: 申请卡片支持点击展开完整详情(旧版无法查看申请详情),
    //                  展开/收起状态本地记忆,操作按钮区与详情区互不遮挡
    pc.innerHTML=pending.map(u=>{
      const timeStr=u.created||'未知';
      const roleStr=u.role==='admin'?'组长':(u.role==='user'?'组员':u.role||'未知');
      const expanded=state.pendingDetailOpen===u.id;
      return `
      <div class="py-3 px-3 bg-orange-50 rounded-lg border border-orange-200">
        <div class="flex items-start justify-between mb-2">
          <div class="flex-1 min-w-0 cursor-pointer" onclick="togglePendingDetail(${u.id})">
            <div class="flex items-center gap-2 mb-1">
              <span class="text-sm font-bold text-gray-900">${esc(u.name)}</span>
              <span class="px-1.5 py-0.5 text-xs bg-blue-100 text-blue-600 rounded">${esc(roleStr)}</span>
            </div>
            <div class="text-xs text-gray-600 mt-0.5">手机：${esc(u.phone)}</div>
            <div class="text-xs text-gray-400 mt-0.5">申请时间：${esc(timeStr)}</div>
            <div class="text-xs text-blue-500 mt-1.5 font-medium">${expanded?'收起详情 ▴':'点击展开详情 ▾'}</div>
          </div>
          <div class="flex flex-col gap-1.5 ml-2 flex-shrink-0">
            <button onclick="approveMember(${u.id})" class="px-3 py-1.5 text-xs text-white bg-green-500 rounded-lg font-medium active:bg-green-600">通过</button>
            <button onclick="rejectMember(${u.id})" class="px-3 py-1.5 text-xs text-red-600 bg-red-50 rounded-lg font-medium active:bg-red-100">拒绝</button>
          </div>
        </div>
        <div class="${expanded?'':'hidden'} pt-2 mt-1 border-t border-orange-200 text-xs text-gray-600 space-y-1 bg-white/60 rounded-lg px-2">
          <div class="font-medium text-gray-700 mb-1">注册申请详情</div>
          <div>申请人姓名：${esc(u.name)}</div>
          <div>联系电话：${esc(u.phone)}</div>
          <div>申请身份：${esc(roleStr)}</div>
          <div>申请时间：${esc(timeStr)}</div>
          <div>备注说明：${esc(u.remarks||'无')}</div>
          <div>申请来源：组员端APP自主注册（飞书云端推送）</div>
        </div>
      </div>`;
    }).join('')||'<div class="text-center text-sm text-gray-400 py-4">暂无待审核注册</div>';
  }
  updateMembersBadge(); // V10.1 问题3修复: 待审核数量变化时同步刷新入口红点
}

/**
 * V10.1 问题3修复: 待审核申请详情展开/收起
 * 旧版申请卡片信息固定展示且无详情入口,用户反馈"无法点击展开查看详情"。
 * 现点击卡片信息区展开完整注册信息,再点收起;展开状态存于state,重渲染后保持。
 * @param {number} id - 申请用户ID
 */
function togglePendingDetail(id){
  state.pendingDetailOpen=(state.pendingDetailOpen===id)?null:id;
  renderMemberList();
}

/**
 * V10.1 问题3修复: 组员管理红点通知
 * 有待审核注册时,「我的」页组员管理入口+侧边菜单组员管理入口显示红色数字角标,
 * 组长无需进入组员管理页即可感知新申请(60秒轮询/手动刷新/进入页面拉取后自动更新)。
 * 非组长账号强制隐藏角标。
 */
function updateMembersBadge(){
  const ids=['members-badge-my','members-badge-side'];
  if(!isLeader()){
    ids.forEach(i=>{const el=document.getElementById(i);if(el)el.classList.remove('show');});
    return;
  }
  const n=USERS.filter(u=>u.status==='pending').length;
  const text=n>99?'99+':String(n);
  ids.forEach(i=>{
    const el=document.getElementById(i);
    if(!el)return;
    el.textContent=text;
    el.classList.toggle('show',n>0);
  });
}

/**
 * V10.1 问题3修复: 审批操作触觉反馈(支持vibrate的Android设备)
 * 通过/拒绝/删除操作时短震动30ms,给用户即时物理反馈("点击后没收到反馈"补强)
 */
function hapticFeedback(){
  try{
    if(typeof navigator!=='undefined'&&typeof navigator.vibrate==='function')navigator.vibrate(30);
  }catch(e){/* 震动失败不影响主流程 */}
}

/* ===================== 缓存管理 (V10.2 问题2) =====================
 * 「我的」页缓存管理弹层: 列出持久缓存中的已缓存视频(video_cache/)与
 * 已导出文档(exported_docs/),支持复选多选删除与一键清空。
 * 浏览器调试环境无持久目录时展示空态引导,不影响其他功能。
 */
let cacheSel=new Set(); // 选中项集合,格式 'video|文件名' / 'doc|文件名'

/**
 * V10.3 问题2: 等待Cordova文件插件就绪(最长timeoutMs)
 * 根因: 冷启动后立即打开缓存管理时,deviceready可能尚未触发,
 * resolveLocalFileSystemURL尚未注入→_cacheDirEntry返回null→列表恒空,
 * 用户误以为"本地已缓存的视频/文档无法加载"。
 * @param {number} [timeoutMs=3000] - 最长等待
 * @returns {Promise<void>}
 */
function _waitCordovaFileReady(timeoutMs){
  timeoutMs=timeoutMs||3000;
  return new Promise(resolve=>{
    if(window.resolveLocalFileSystemURL&&window.cordova&&window.cordova.file){resolve();return;}
    let done=false;
    const finish=()=>{if(!done){done=true;clearTimeout(timer);resolve();}};
    const timer=setTimeout(finish,timeoutMs);
    document.addEventListener('deviceready',finish,{once:true});
  });
}

/** 打开缓存管理弹层并刷新列表 */
