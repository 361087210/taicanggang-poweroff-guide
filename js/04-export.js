/* ===========================================================
 * 模块: 04-export.js
 * 功能: Excel+zip压缩/Word OOXML/PDF(canvas+legacy)/批量导出折叠面板/exportData/exportSingle/shareBackup
 * 前置依赖 (defer顺序): 00-bootstrap.js, 01-state.js, 02-auth.js, 03-vehicles.js
 * 源范围: demo.html L2930-L4130
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
function generateExcel(vehicles){
  const data=vehicles.map(v=>({
    'ID':v.id,'品牌':v.brand,'车系':v.series,'配置':v.config,'显示名称':v.display,
    '动力类型':v.powerType,'车辆尺寸':v.size||'','断电位置':v.position,
    '断电步骤':v.steps.map((s,i)=>(i+1)+'. '+s).join('\n'),
    '钥匙-框架':(v.keyFrame||[]).join('\n'),
    '钥匙-集装箱':(v.keyContainer||[]).join('\n'),
    '备注':v.remarks||'','照片数量':v.photos||0,
    '照片路径':(v.photoPaths||[]).join('; '),'视频数量':v.videos||0,
    '视频路径':(v.videoPaths||[]).join('; ')
  }));
  const ws=XLSX.utils.json_to_sheet(data);
  ws['!cols']=[{wch:5},{wch:10},{wch:12},{wch:10},{wch:20},{wch:8},{wch:15},{wch:20},{wch:50},{wch:30},{wch:30},{wch:15},{wch:8},{wch:40},{wch:5},{wch:40}];
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,ws,'断电指导数据');
  return XLSX.write(wb,{bookType:'xlsx',type:'array'});
}

/**
 * ===================== V5.8 导出分享方案对齐(基准: 安装包V1.8 React版) =====================
 * 背景: 车辆详情/数据中心导出需与新版安装包行为一致,老用户换机/混用两端时文档结构与文件名不混淆。
 * 原则: 结构/命名/交互对齐APK,保留本项目vendor库(零CDN依赖)与照片内嵌回退链等既有优势。
 */

/**
 * ===================== V5.9.0 Excel照片内嵌(问题1核心,零外部依赖) =====================
 * 背景: SheetJS社区版不支持写图片,此前Excel导出仅含照片路径文字,接收方打开看不到照片。
 * 方案: 生成xlsx后按Office OpenXML规范做ZIP级注入——
 *   ①读取SheetJS输出的xlsx(STORE无压缩ZIP,自研解析,无需JSZip依赖);
 *   ②在xl/media/追加JPEG/PNG图片字节;
 *   ③生成xl/drawings/drawingN.xml(SpreadsheetML Drawing锚点)+关系文件;
 *   ④工作表XML追加<drawing>引用,[Content_Types].xml注册图片扩展名;
 *   ⑤重新打包为合法xlsx。
 * 兼容性: 已用openpyxl/LibreOffice/WPS三端验证(2026-08原型test_embed.js)。
 */

/** ZIP CRC32查表(嵌入式标准实现) */
const _zipCrcTable=(()=>{
  const t=new Uint32Array(256);
  for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=(c&1)?(0xEDB88320^(c>>>1)):(c>>>1);t[n]=c;}
  return t;
})();

/** @param {Uint8Array} u8 @returns {number} CRC32校验值 */
function _zipCrc32(u8){
  let c=0xFFFFFFFF;
  for(let i=0;i<u8.length;i++)c=_zipCrcTable[(c^u8[i])&0xFF]^(c>>>8);
  return (c^0xFFFFFFFF)>>>0;
}

/**
 * 读取STORE型ZIP为Map<文件名,Uint8Array>(SheetJS输出即此格式)
 * 遇到DEFLATE压缩条目返回null(本项目链路不会出现,防御性处理)
 * @param {Uint8Array} u8 - zip二进制
 * @returns {Map<string,Uint8Array>|null}
 */
function _zipRead(u8){
  const dv=new DataView(u8.buffer,u8.byteOffset,u8.byteLength);
  let eocd=-1;
  for(let i=u8.length-22;i>=0;i--){if(dv.getUint32(i,true)===0x06054b50){eocd=i;break;}}
  if(eocd<0)return null;
  const count=dv.getUint16(eocd+10,true);
  let off=dv.getUint32(eocd+16,true);
  const files=new Map();
  for(let i=0;i<count;i++){
    if(dv.getUint32(off,true)!==0x02014b50)return null;
    const method=dv.getUint16(off+10,true);
    const csize=dv.getUint32(off+20,true);
    const nameLen=dv.getUint16(off+28,true);
    const extraLen=dv.getUint16(off+30,true);
    const commentLen=dv.getUint16(off+32,true);
    const localOff=dv.getUint32(off+42,true);
    const name=new TextDecoder().decode(u8.slice(off+46,off+46+nameLen));
    if(dv.getUint32(localOff,true)!==0x04034b50)return null;
    const lNameLen=dv.getUint16(localOff+26,true);
    const lExtraLen=dv.getUint16(localOff+28,true);
    const dataStart=localOff+30+lNameLen+lExtraLen;
    if(method!==0)return null; // 仅支持STORE
    files.set(name,u8.slice(dataStart,dataStart+csize));
    off+=46+nameLen+extraLen+commentLen;
  }
  return files;
}

/**
 * 将Map<文件名,Uint8Array>打包为STORE型ZIP
 * @param {Array<[string,Uint8Array]>} entries - 文件项数组
 * @returns {Uint8Array} zip二进制
 */
function _zipWrite(entries){
  const enc=new TextEncoder();
  const parts=[],central=[];
  let offset=0;
  const DOS_TIME=0,DOS_DATE=0x5801; // 2026-01-01,固定时间戳保证可复现构建
  for(const [name,data] of entries){
    const nameBytes=enc.encode(name);
    const crc=_zipCrc32(data);
    const lh=new Uint8Array(30+nameBytes.length);
    const ldv=new DataView(lh.buffer);
    ldv.setUint32(0,0x04034b50,true);
    ldv.setUint16(4,20,true);ldv.setUint16(6,0,true);ldv.setUint16(8,0,true);
    ldv.setUint16(10,DOS_TIME,true);ldv.setUint16(12,DOS_DATE,true);
    ldv.setUint32(14,crc,true);
    ldv.setUint32(18,data.length,true);ldv.setUint32(22,data.length,true);
    ldv.setUint16(26,nameBytes.length,true);ldv.setUint16(28,0,true);
    lh.set(nameBytes,30);
    parts.push(lh,data);
    const ch=new Uint8Array(46+nameBytes.length);
    const cdv=new DataView(ch.buffer);
    cdv.setUint32(0,0x02014b50,true);
    cdv.setUint16(4,20,true);cdv.setUint16(6,20,true);
    cdv.setUint16(8,0,true);cdv.setUint16(10,0,true);
    cdv.setUint16(12,DOS_TIME,true);cdv.setUint16(14,DOS_DATE,true);
    cdv.setUint32(16,crc,true);
    cdv.setUint32(20,data.length,true);cdv.setUint32(24,data.length,true);
    cdv.setUint16(28,nameBytes.length,true);
    cdv.setUint16(30,0,true);cdv.setUint16(32,0,true);
    cdv.setUint16(34,0,true);cdv.setUint16(36,0,true);
    cdv.setUint32(38,0,true);
    cdv.setUint32(42,offset,true);
    ch.set(nameBytes,46);
    central.push(ch);
    offset+=lh.length+data.length;
  }
  let cdSize=0;central.forEach(c=>cdSize+=c.length);
  const eocd=new Uint8Array(22);
  const edv=new DataView(eocd.buffer);
  edv.setUint32(0,0x06054b50,true);
  edv.setUint16(8,entries.length,true);edv.setUint16(10,entries.length,true);
  edv.setUint32(12,cdSize,true);edv.setUint32(16,offset,true);
  const total=offset+cdSize+22;
  const out=new Uint8Array(total);
  let p=0;
  for(const part of [...parts,...central,eocd]){out.set(part,p);p+=part.length;}
  return out;
}

/** dataURL的base64段→Uint8Array(逐字节解码,兼容无atob环境由上层保证) */
function _b64ToU8(b64){
  const bin=atob(b64);
  const u8=new Uint8Array(bin.length);
  for(let i=0;i<bin.length;i++)u8[i]=bin.charCodeAt(i);
  return u8;
}

/**
 * 将xlsx二进制注入照片锚点(OpenXML DrawingML)
 * @param {Uint8Array} xlsxU8 - SheetJS输出的xlsx
 * @param {Array<{sheet:string,col:number,row:number,dataUrl:string,w?:number,h?:number}>} anchors - 锚点列表
 * @returns {Uint8Array} 含照片的新xlsx
 */
function embedPhotosInXlsx(xlsxU8,anchors){
  const files=_zipRead(new Uint8Array(xlsxU8));
  if(!files||!files.size)throw new Error('xlsx结构解析失败,无法嵌入照片');
  const dec=new TextDecoder();
  // ① 解析workbook.xml: 工作表名→rId
  const wbXml=dec.decode(files.get('xl/workbook.xml'));
  const nameToRid={};
  let m;const sheetRe=/<sheet\b[^>]*>/g;
  while((m=sheetRe.exec(wbXml))){
    const tag=m[0];
    const nm=(tag.match(/name="([^"]*)"/)||[])[1];
    const rid=(tag.match(/r:id="(rId\d+)"/)||[])[1];
    if(nm&&rid)nameToRid[nm]=rid;
  }
  // ② 解析workbook关系: rId→sheetN.xml
  const relsXml=dec.decode(files.get('xl/_rels/workbook.xml.rels'));
  const ridToTarget={};
  const relRe=/<Relationship\b[^>]*>/g;
  while((m=relRe.exec(relsXml))){
    const id=(m[0].match(/Id="(rId\d+)"/)||[])[1];
    const tgt=(m[0].match(/Target="([^"]*)"/)||[])[1];
    if(id&&tgt)ridToTarget[id]=tgt;
  }
  const bySheet={};
  anchors.forEach(a=>{(bySheet[a.sheet]=bySheet[a.sheet]||[]).push(a);});
  let drawingN=0,imgN=0;
  let contentTypes=dec.decode(files.get('[Content_Types].xml'));
  // ③ webp扩展名注册(现场拍照的dataURL可能是webp)
  const hasWebp=anchors.some(a=>/^data:image\/webp/.test(a.dataUrl));
  if(hasWebp&&contentTypes.indexOf('Extension="webp"')<0){
    contentTypes=contentTypes.replace('</Types>','<Default Extension="webp" ContentType="image/webp"/></Types>');
  }
  for(const sheetName in bySheet){
    const list=bySheet[sheetName];
    if(!list.length)continue;
    const rid=nameToRid[sheetName];
    const target=rid&&ridToTarget[rid];
    if(!target){console.warn('[xlsx照片]未找到工作表:',sheetName);continue;}
    const sheetPath='xl/'+target.replace(/^\//,'');
    const sheetFile=files.get(sheetPath);
    if(!sheetFile)continue;
    drawingN++;
    // DrawingML: oneCellAnchor锚点(从(col,row)起,固定w×h展示尺寸)
    let drawingXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    let drawingRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">';
    list.forEach(a=>{
      const mm=/^data:image\/(png|jpe?g|webp);base64,(.*)$/.exec(a.dataUrl);
      if(!mm)return;
      imgN++;
      const ext=mm[1]==='png'?'png':(mm[1]==='webp'?'webp':'jpeg');
      files.set('xl/media/image'+imgN+'.'+ext,_b64ToU8(mm[2]));
      const relId='rIdImg'+imgN;
      drawingRels+='<Relationship Id="'+relId+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image'+imgN+'.'+ext+'"/>';
      const w=(a.w||180)*9525,h=(a.h||135)*9525; // px→EMU(1px=9525EMU)
      drawingXml+='<xdr:oneCellAnchor><xdr:from><xdr:col>'+a.col+'</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>'+a.row+'</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:ext cx="'+w+'" cy="'+h+'"/><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="'+(imgN+1)+'" name="Photo'+imgN+'"/><xdr:cNvPicPr><a:picLocks noChangeAspect="1"/></xdr:cNvPicPr></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="'+relId+'"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+w+'" cy="'+h+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:oneCellAnchor>';
    });
    drawingXml+='</xdr:wsDr>';
    drawingRels+='</Relationships>';
    files.set('xl/drawings/drawing'+drawingN+'.xml',new TextEncoder().encode(drawingXml));
    files.set('xl/drawings/_rels/drawing'+drawingN+'.xml.rels',new TextEncoder().encode(drawingRels));
    // ④ 工作表关系追加drawing引用(已存在则拼接)
    const sheetRelsPath='xl/worksheets/_rels/'+target.split('/').pop()+'.rels';
    const drwRid='rIdDrw'+drawingN;
    const relTag='<Relationship Id="'+drwRid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing'+drawingN+'.xml"/>';
    if(files.has(sheetRelsPath)){
      let sr=dec.decode(files.get(sheetRelsPath));
      sr=sr.replace('</Relationships>',relTag+'</Relationships>');
      files.set(sheetRelsPath,new TextEncoder().encode(sr));
    }else{
      files.set(sheetRelsPath,new TextEncoder().encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+relTag+'</Relationships>'));
    }
    // ⑤ worksheet.xml末尾追加<drawing>(必须在</worksheet>前,schema要求drawing为末元素)
    let sx=dec.decode(sheetFile);
    if(sx.indexOf('</worksheet>')<0)continue;
    sx=sx.replace('</worksheet>','<drawing r:id="'+drwRid+'"/></worksheet>');
    files.set(sheetPath,new TextEncoder().encode(sx));
    contentTypes=contentTypes.replace('</Types>','<Override PartName="/xl/drawings/drawing'+drawingN+'.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>');
  }
  files.set('[Content_Types].xml',new TextEncoder().encode(contentTypes));
  return _zipWrite(Array.from(files.entries()));
}

/**
 * 照片嵌入前降采样(Canvas)——控制xlsx体积
 * 现场照片原图2-5MB,直接嵌入会让批量Excel超20MB(微信分享限25MB);
 * 降采样到长边≤1024px/JPEG质量0.85后约80-150KB/张,8张≈1MB,肉眼可辨且体积可控。
 * @param {string} dataUrl - 原始照片dataURL
 * @param {number} [maxEdge] - 长边像素上限,默认1024
 * @param {number} [quality] - JPEG质量,默认0.85
 * @returns {Promise<string>} 降采样后的dataURL(失败时原样返回)
 */
async function shrinkPhotoForEmbed(dataUrl,maxEdge,quality){
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=dataUrl;});
    const limit=maxEdge||1024;
    if(img.width<=limit&&img.height<=limit)return dataUrl; // 已足够小,原样嵌入
    const scale=Math.min(limit/img.width,limit/img.height,1);
    const canvas=document.createElement('canvas');
    canvas.width=Math.max(1,Math.round(img.width*scale));
    canvas.height=Math.max(1,Math.round(img.height*scale));
    canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',quality||0.85);
  }catch(e){
    console.warn('[xlsx照片]降采样失败,原样嵌入:',e.message||e);
    return dataUrl;
  }
}

/**
 * 批量降采样照片映射表(Excel内嵌专用)
 * 串行处理: 同一时间仅解码一张,避免10辆×4张并发解码撑爆手机WebView内存。
 * @param {Object} photoMap - preparePhotoMapSafe输出的{path:dataURL}
 * @returns {Promise<Object>} 降采样后的新映射表
 */
async function shrinkPhotoMapForExcel(photoMap){
  const out={};
  if(!photoMap)return out;
  for(const p in photoMap){
    if(photoMap[p])out[p]=await shrinkPhotoForEmbed(photoMap[p]);
  }
  return out;
}

/**
 * 单车Excel导出 - 四工作表结构(对齐APK jk函数)
 * 为什么拆4个sheet: 汇总型单表在手机Excel里列宽拥挤,分表后"信息/步骤/媒体/备注"
 * 各自独立成栏,现场查阅断电步骤时无需横向滚动。
 * V5.9.0: 新增photoMap参数,照片以DrawingML真实内嵌(此前仅路径文字)。
 * @param {Object} v - 车辆对象
 * @param {Object} [photoMap] - photoPath→dataURL映射(preparePhotoMap预取)
 * @returns {ArrayBuffer} xlsx二进制
 */
function generateExcelSingle(v,photoMap){
  if(!v||!v.id)throw new Error('车辆数据为空,无法导出');
  const wb=XLSX.utils.book_new();
  // Sheet1 车辆信息: 项目/内容两列,缺失字段填"未填写"(对齐APK,避免空单元格歧义)
  const infoRows=[
    ['项目','内容'],
    ['品牌',v.brand],['车系',v.series],['配置',v.config],['显示名称',v.display],
    ['车辆尺寸',v.size||'未填写'],['动力类型',v.powerType||'未填写'],['断电位置',v.position||'未填写'],
    ['钥匙-框架',(v.keyFrame||[]).join('; ')||'未填写'],['钥匙-集装箱',(v.keyContainer||[]).join('; ')||'未填写']
  ];
  const wsInfo=XLSX.utils.aoa_to_sheet(infoRows);
  wsInfo['!cols']=[{wch:16},{wch:60}];
  XLSX.utils.book_append_sheet(wb,wsInfo,'车辆信息');
  // Sheet2 断电步骤: 序号/说明/注意事项,空步骤兜底"暂无步骤"
  const stepRows=[['步骤序号','操作说明','注意事项']];
  (v.steps||[]).forEach((s,i)=>stepRows.push([String(i+1),s,'']));
  if(stepRows.length===1)stepRows.push(['','暂无步骤','']);
  const wsSteps=XLSX.utils.aoa_to_sheet(stepRows);
  wsSteps['!cols']=[{wch:10},{wch:60},{wch:40}];
  XLSX.utils.book_append_sheet(wb,wsSteps,'断电步骤');
  // Sheet3 媒体资源: 类型/路径说明,路径截断120字符(过长的blob路径会撑爆单元格)
  // 对齐APK: 车辆图片每张一行,视频每条一行,无则单行"无"兜底
  const mediaRows=[['类型','路径/说明']];
  if((v.photoPaths||[]).length)v.photoPaths.forEach(p=>mediaRows.push(['车辆图片',String(p).slice(0,120)]));
  else mediaRows.push(['车辆图片','无']);
  if((v.videoPaths||[]).length)v.videoPaths.forEach(p=>mediaRows.push(['视频',String(p).slice(0,120)]));
  else mediaRows.push(['视频','无']);
  const wsMedia=XLSX.utils.aoa_to_sheet(mediaRows);
  wsMedia['!cols']=[{wch:12},{wch:80}];
  XLSX.utils.book_append_sheet(wb,wsMedia,'媒体资源');
  // Sheet4 车辆照片(V5.9.0): 标题+统计行,照片以DrawingML锚点真实内嵌
  // 布局: 4列×2行网格,每张180×135px;列间隔4个默认列宽,行间隔9个默认行高(已原型验证)
  const photoList=v.photoPaths||[];
  const embedded=photoList.filter(p=>photoMap&&photoMap[p]);
  const photoRows=[['车辆照片'],[`【${v.display}】照片 ${photoList.length}张`]];
  if(photoList.length===0)photoRows.push(['无']);
  else if(embedded.length===0)photoRows.push(['照片未能内嵌(本地与云端均不可达),文件名: '+photoList.map(p=>String(p).split('/').pop()).join('; ')]);
  for(let i=0;i<18;i++)photoRows.push([]); // 预留照片绘制区(2行×9行高)
  const wsPhotos=XLSX.utils.aoa_to_sheet(photoRows);
  XLSX.utils.book_append_sheet(wb,wsPhotos,'车辆照片');
  // Sheet5 备注
  const wsNotes=XLSX.utils.aoa_to_sheet([['备注'],[v.remarks||'无']]);
  wsNotes['!cols']=[{wch:80}];
  XLSX.utils.book_append_sheet(wb,wsNotes,'备注');
  const u8=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  // V5.9.0: 命中照片≥1张时走DrawingML注入链;失败回退无图版本(导出主流程不中断)
  if(!embedded.length)return u8;
  const anchors=embedded.slice(0,8).map((p,i)=>({sheet:'车辆照片',col:(i%4)*4,row:i<4?2:11,dataUrl:photoMap[p],w:180,h:135}));
  try{
    const withPhotos=embedPhotosInXlsx(u8,anchors);
    console.log(`[导出]Excel照片内嵌完成: ${anchors.length}张,体积 ${((u8.byteLength||u8.length)/1024).toFixed(0)}KB → ${(withPhotos.length/1024).toFixed(0)}KB`);
    return withPhotos;
  }catch(e){
    console.warn('[导出]Excel照片内嵌失败,回退无图版本:',e.message||e);
    showToast('Excel照片内嵌失败,已导出不含照片版本');
    return u8;
  }
}

/**
 * 批量Excel导出 - 汇总表+前10辆详情子表结构(对齐APK Pk函数)
 * 为什么详情子表只取前10: 超过10个sheet后Excel移动端打开明显卡顿,
 * 汇总表已含全部记录的关键字段,深度详情可对单辆再导出。
 * V5.9.0: photoMap照片内嵌——每辆详情子表追加2×2照片网格(≤4张/辆,
 * 降采样后单辆<600KB,10辆合计<6MB,微信25MB分享限额内)。
 * @param {Array} vehicles - 选中的车辆数组
 * @param {Object} [photoMap] - photoPath→dataURL映射(preparePhotoMap预取)
 * @returns {ArrayBuffer} xlsx二进制
 */
function generateExcelBatch(vehicles,photoMap){
  if(!Array.isArray(vehicles)||vehicles.length===0)throw new Error('未选择任何车辆,无法导出');
  const wb=XLSX.utils.book_new();
  // 汇总表: 标题/导出时间/记录总数 + 11列标准表头(对齐APK)
  const summaryRows=[
    ['车辆断电数据批量导出'],
    ['导出时间',new Date().toLocaleString('zh-CN')],
    ['记录总数',String(vehicles.length)],
    [],
    ['品牌','车系','配置','显示名称','车辆尺寸','动力类型','断电位置','钥匙-框架','钥匙-集装箱','步骤数','备注']
  ];
  vehicles.forEach(v=>{
    summaryRows.push([
      v.brand,v.series,v.config,v.display,v.size||'',v.powerType||'',v.position||'',
      (v.keyFrame||[]).join('; '),(v.keyContainer||[]).join('; '),
      String((v.steps||[]).length),v.remarks||''
    ]);
  });
  const wsSummary=XLSX.utils.aoa_to_sheet(summaryRows);
  wsSummary['!cols']=[{wch:12},{wch:14},{wch:20},{wch:24},{wch:14},{wch:10},{wch:20},{wch:14},{wch:14},{wch:8},{wch:30}];
  XLSX.utils.book_append_sheet(wb,wsSummary,'汇总');
  // 前10辆: 每辆一个"项目/内容"详情子表(含步骤行),sheet名取显示名前20字符
  const batchAnchors=[]; // V5.9.0: 收集各详情子表的照片锚点
  vehicles.slice(0,10).forEach(v=>{
    const rows=[['项目','内容'],
      ['品牌',v.brand],['车系',v.series],['配置',v.config],['显示名称',v.display],
      ['车辆尺寸',v.size||''],['动力类型',v.powerType||''],['断电位置',v.position||''],
      ['钥匙-框架',(v.keyFrame||[]).join('; ')],['钥匙-集装箱',(v.keyContainer||[]).join('; ')]];
    (v.steps||[]).forEach((s,i)=>rows.push([`步骤${i+1}`,s]));
    if(v.remarks)rows.push(['备注',v.remarks]);
    // V5.9.0: 照片统计行(接收方在汇总层即可知照片是否已内嵌)
    const embeddedList=(v.photoPaths||[]).filter(p=>photoMap&&photoMap[p]);
    rows.push(['照片',`${(v.photoPaths||[]).length}张${embeddedList.length?`(已内嵌${Math.min(embeddedList.length,4)}张)`:''}`]);
    const photoStartRow=rows.length+1; // 统计行下空1行起放照片
    for(let i=0;i<20;i++)rows.push([]); // 预留照片绘制区(2行×9行高)
    embeddedList.slice(0,4).forEach((p,i)=>{
      batchAnchors.push({sheet:'',col:(i%2)*4,row:photoStartRow+(i<2?0:9),dataUrl:photoMap[p],w:180,h:135,_vehicle:v});
    });
    const wsDetail=XLSX.utils.aoa_to_sheet(rows);
    wsDetail['!cols']=[{wch:16},{wch:60}];
    const sheetName=(v.display||'').slice(0,20)||'未命名';
    batchAnchors.forEach(a=>{if(a._vehicle===v)a.sheet=sheetName;}); // 回填锚点所属sheet
    XLSX.utils.book_append_sheet(wb,wsDetail,sheetName);
  });
  const u8=XLSX.write(wb,{bookType:'xlsx',type:'array'});
  // V5.9.0: DrawingML照片注入;失败回退无图版本(导出主流程不中断)
  if(!batchAnchors.length)return u8;
  try{
    const withPhotos=embedPhotosInXlsx(u8,batchAnchors.map(({_vehicle,...a})=>a));
    console.log(`[导出]批量Excel照片内嵌完成: ${batchAnchors.length}张,体积 ${((u8.byteLength||u8.length)/1024).toFixed(0)}KB → ${(withPhotos.length/1024).toFixed(0)}KB`);
    return withPhotos;
  }catch(e){
    console.warn('[导出]批量Excel照片内嵌失败,回退无图版本:',e.message||e);
    showToast('Excel照片内嵌失败,已导出不含照片版本');
    return u8;
  }
}

/**
 * 批量/单车导出的按钮loading状态管理(V5.8对齐APK交互)
 * 为什么需要: 导出是异步链(生成文件→写缓存→调分享面板),期间用户重复点击
 * 会生成多个文件并连续弹分享面板,现场操作极易误触。
 * @param {string} group - 'batch'(数据中心) | 'detail'(车辆详情)
 * @param {string|null} format - 当前导出格式,'html'内文本切"导出中..."
 */
function setExportLoading(group,format){
  // V5.9.0: Word/PDF/Excel为两步分享(生成含照片文档→系统分享面板),按钮文案同步重定义
  const labels={'word':'Word','pdf':'PDF','excel':'Excel','csv':'CSV','json':'JSON'};
  if(group==='batch'){
    state.batchExporting=format;
    ['word','pdf','excel','csv','json'].forEach(f=>{
      const btn=document.getElementById('btn-export-'+f);
      if(!btn)return;
      btn.disabled=format!==null;
      const shareable=['word','pdf','excel'].indexOf(f)>=0;
      btn.lastChild.textContent=format===f?'生成中...':(shareable?`${labels[f]}分享`:`导出${labels[f]}`);
    });
  }else if(group==='detail'){
    state.detailExporting=format;
    ['word','pdf','excel'].forEach(f=>{
      const btn=document.getElementById('btn-detail-export-'+f);
      if(!btn)return;
      btn.disabled=format!==null;
      btn.textContent=format===f?'生成中...':`${labels[f]}分享`;
    });
  }
}

/**
 * ===================== 导出图片嵌入 (V5.3.2 问题4根源修复) =====================
 * 缺陷: generateWord/generatePDF此前仅写入相对路径(vehicle_images/image1.jpeg),
 *       导出的.docx/.pdf在Word/阅读器中无图——相对路径在离线文档里不可解析。
 * 方案: 导出前把照片解析为base64数据流内嵌进文档(与展示层同源回退链):
 *       ①data:URL(用户现拍照片本就是base64) ②本地APK内/www目录文件
 *       ③飞书云端"APP数据备份/vehicle_images"
 */
const _exportPhotoCache={}; // 照片路径/文件名 -> dataURL|null(含未命中负缓存,防重复探测)

/**
 * V10.12: 从飞书云端下载单文件二进制(统一Cordova原生HTTP与fetch回退)
 * 抽取目的: 消除 fetchFeishuPhotoDataURL 内的 Cordova/fetch 嵌套分支,
 * 将 L3639 附近的最大嵌套深度从 8 层降到 ≤ 4 层。
 * @param {string} token - 飞书 tenant_access_token
 * @param {string} fileToken - drive 文件 token
 * @param {string} mimeType - 期望 MIME (如 image/jpeg), 用于 Cordova ArrayBuffer→Blob 归一
 * @returns {Promise<Blob|null>}
 */
async function _feishuDownloadBlob(token, fileToken, mimeType){
  const url=`https://open.feishu.cn/open-apis/drive/v1/files/${fileToken}/download`;
  if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
    return new Promise((resolve,reject)=>{
      window.cordova.plugin.http.sendRequest(url,{
        method:'GET',headers:{Authorization:'Bearer '+token},responseType:'blob',timeout:60,
      },res=>resolve(asBlob(res.data,mimeType)),                // V5.3.4: ArrayBuffer→Blob归一(根因4)
        err=>reject(new Error(String(err.error||'文件下载失败'))));
    });
  }
  const r=await fetch(url,{headers:{Authorization:'Bearer '+token}});
  return r.blob();
}

/**
 * V10.12: 在飞书dataFolder下定位照片目录并查找目标文件
 * 抽取目的: 拆出 3 层 if(dataFolder→dataFiles→imgFolder) 箭形嵌套,
 * 改为卫语句逐级返回,降低认知负荷。
 * @returns {Promise<Object|null>} 目标文件对象 {token,name,...}
 */
async function _feishuLocatePhotoFile(token, dataFolder, fileName){
  const dataFiles=await feishuListFiles(token,dataFolder);
  if(!dataFiles)return null;                                                           // 卫语句: 列目录失败直接出
  const imgFolder=dataFiles.find(f=>f.type==='folder'&&f.name==='vehicle_images');
  if(!imgFolder)return null;                                                           // 卫语句: 无照片子目录直接出
  const imgFiles=await feishuListFiles(token,imgFolder.token);
  if(!imgFiles)return null;
  return imgFiles.find(f=>f.type==='file'&&f.name===fileName)||null;
}

/**
 * 从飞书云端vehicle_images目录下载单张照片并转为base64数据流
 * 与imgFromFeishuCloud共用目录约定,但返回dataURL供文档内嵌(objectURL
 * 无法写入离线文档,Word/PDF阅读器解析不了blob:协议)
 * V10.12: 重写为 卫语句 + 抽函数, 最大嵌套深度 ≤ 4 层。
 * @param {string} fileName - 照片文件名(如image1.jpeg)
 * @returns {Promise<string|null>} dataURL,未命中返回null
 */
async function fetchFeishuPhotoDataURL(fileName){
  const cfg=getFeishuCfg();
  if(!feishuCfgReady(cfg)||!fileName)return null;              // V5.3.4: Secret缺失直接跳过(诊断根因1)
  const cacheKey='feishu:'+fileName;
  if(_exportPhotoCache.hasOwnProperty(cacheKey))return _exportPhotoCache[cacheKey];
  let result=null;
  try{
    const token=await getFeishuToken(cfg);
    const dataFolder=await getDataFolderToken(token);
    if(!dataFolder){ _exportPhotoCache[cacheKey]=null; return null; }           // 卫语句: 无数据目录直接出
    const target=await _feishuLocatePhotoFile(token,dataFolder,fileName);
    if(!target){ _exportPhotoCache[cacheKey]=null; return null; }               // 卫语句: 文件未命中直接出
    const blob=await _feishuDownloadBlob(token,target.token,'image/jpeg');
    if(blob&&blob.size>100)result=await blobToDataURL(blob);
  }catch(e){
    console.warn('[导出]飞书云端照片不可用:',fileName,e.message||e);
  }
  _exportPhotoCache[cacheKey]=result;
  return result;
}

/**
 * 解析单条photoPath为base64数据流(带正/负缓存)
 * @param {string} path - data:URL或相对路径(vehicle_images/image1.jpeg)
 * @returns {Promise<string|null>} dataURL,全源未命中返回null
 */
async function fetchPhotoDataURL(path){
  if(!path)return null;
  if(/^data:image\//i.test(path))return path; // 用户现拍照片本就是base64,直接内嵌
  if(_exportPhotoCache.hasOwnProperty(path))return _exportPhotoCache[path];
  let result=null;
  const fileName=path.split('/').pop();
  // 源①: 本地文件(浏览器预览取仓库目录;APK内取打包进www/的资源)
  try{
    const r=await fetch(path);
    if(r.ok){
      const blob=await r.blob();
      if(blob&&blob.size>100)result=await blobToDataURL(blob);
    }
  }catch(e){/* 本地未命中,继续云端回退 */}
  // 源②: 飞书云端(组长上传的真实照片)
  if(!result)result=await fetchFeishuPhotoDataURL(fileName);
  _exportPhotoCache[path]=result;
  if(result)console.log('[导出]照片命中:',fileName);
  return result;
}

/**
 * 导出前批量预取车辆照片为base64映射表
 * 为什么串行而非Promise.all: 飞书下载接口对并发敏感,串行+缓存最稳,
 * 且单车最多4-8张照片,耗时可接受(有Toast进度提示)。
 * @param {Array} vehicles - 待导出车辆
 * @param {number} perVehicleLimit - 单车最多嵌入张数(防文档体积失控)
 * @returns {Promise<Object>} {photoPath: dataURL} 仅含命中项
 */
async function preparePhotoMap(vehicles,perVehicleLimit){
  const limit=perVehicleLimit||8;
  const paths=[];
  vehicles.forEach(v=>{(v.photoPaths||[]).slice(0,limit).forEach(p=>{
    if(paths.indexOf(p)<0)paths.push(p);
  });});
  const map={};
  let hit=0;
  for(const p of paths){
    const url=await fetchPhotoDataURL(p);
    if(url){map[p]=url;hit++;}
  }
  console.log(`[导出]照片预取完成: ${hit}/${paths.length}张命中`);
  return map;
}

/** jsPDF addImage格式探测(dataURL前缀→jsPDF格式常量) */
function _jspdfImgFmt(dataUrl){
  if(/^data:image\/png/i.test(dataUrl))return 'PNG';
  if(/^data:image\/webp/i.test(dataUrl))return 'WEBP';
  return 'JPEG';
}

/**
 * ===================== V10.6.0 问题1: 导出文档生成管线重构 =====================
 * 根因诊断:
 *  ① Word无法打开——旧版主链路html-docx-js产出MHTML伪docx(桌面Word可容错,
 *    手机端WPS/Office按OOXML ZIP解析直接报"文件已损坏");降级链HTML Blob+.doc
 *    在手机端同样无法识别。
 *  ② PDF中文乱码——jsPDF内置Helvetica/Times字体无CJK字形,中文全部渲染为
 *    乱码方块。
 * 修复方案:
 *  ① Word: 自研真OOXML docx生成器(复用_zipWrite),标准ZIP+wordprocessingML,
 *    照片以DrawingML内嵌,字体按名称引用(微软雅黑),桌面/手机WPS全兼容;
 *    htmlDocx降为二级保底,HTML Blob仅浏览器预览兜底。
 *  ② PDF: html2canvas将同源HTML模板渲染为Canvas图像,按A4分页注入jsPDF——
 *    中文以像素呈现,从原理上杜绝字形缺失;无html2canvas时回退旧版文本链路。
 */

/** XML特殊字符转义(OOXML文本节点安全写入) */
function _xmlEsc(s){
  return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/**
 * 读取dataURL图像的自然像素尺寸(docx嵌入需按真实比例换算EMU)
 * @param {string} dataUrl - 图像dataURL
 * @returns {Promise<{w:number,h:number}>} 尺寸,解码失败返回4:3默认值
 */
function _imgNaturalSize(dataUrl){
  return new Promise(resolve=>{
    const img=new Image();
    img.onload=()=>resolve({w:img.naturalWidth||400,h:img.naturalHeight||300});
    img.onerror=()=>resolve({w:400,h:300});
    img.src=dataUrl;
  });
}

/**
 * webp照片转码为JPEG dataURL(Word/PDF对webp解码不可靠,统一归一化)
 * 非webp输入原样返回,不产生额外开销
 * @param {string} dataUrl - 原始dataURL
 * @returns {Promise<string>} JPEG dataURL(webp输入)或原值
 */
async function _webpToJpeg(dataUrl){
  if(!/^data:image\/webp/i.test(dataUrl))return dataUrl;
  try{
    const img=await new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=()=>rej(new Error('decode'));i.src=dataUrl;});
    const c=document.createElement('canvas');
    c.width=img.width;c.height=img.height;
    c.getContext('2d').drawImage(img,0,0);
    return c.toDataURL('image/jpeg',0.9);
  }catch(e){
    console.warn('[导出]webp转码失败,原样使用:',e.message||e);
    return dataUrl;
  }
}

/** docx段落构造器(字体按名称引用微软雅黑,中文由打开端本地字体渲染,天然无乱码) */
function _docxPara(text,o){
  o=o||{};
  const sz=o.sizePt?Math.round(o.sizePt*2):21;
  const rPr='<w:rPr><w:rFonts w:hint="eastAsia"/>'+(o.bold?'<w:b/>':'')+(o.color?'<w:color w:val="'+o.color+'"/>':'')+'<w:sz w:val="'+sz+'"/><w:szCs w:val="'+sz+'"/></w:rPr>';
  const pPr=o.spaceBefore?'<w:pPr><w:spacing w:before="'+o.spaceBefore+'"/></w:pPr>':'';
  return '<w:p>'+pPr+'<w:r>'+rPr+'<w:t xml:space="preserve">'+_xmlEsc(text)+'</w:t></w:r></w:p>';
}

/** docx表格构造器(单元格数组的数组,边框统一浅灰) */
function _docxTable(rows){
  const borders=['top','left','bottom','right','insideH','insideV'].map(b=>'<w:'+b+' w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>').join('');
  let xml='<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>'+borders+'</w:tblBorders></w:tblPr>';
  rows.forEach(r=>{
    xml+='<w:tr>'+r.map(c=>'<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'+_docxPara(c,{sizePt:10.5})+'</w:tc>').join('')+'</w:tr>';
  });
  return xml+'</w:tbl>';
}

/** docx内嵌图片段落构造器(DrawingML inline,EMU=px×9525) */
function _docxImage(rid,wPx,hPx,docPrId){
  const cx=Math.round(wPx*9525),cy=Math.round(hPx*9525);
  return '<w:p><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="'+cx+'" cy="'+cy+'"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="'+docPrId+'" name="photo'+docPrId+'"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="'+docPrId+'" name="photo'+docPrId+'"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="'+rid+'"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="'+cx+'" cy="'+cy+'"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
}

/**
 * 真OOXML docx生成器 - V10.6.0 问题1主链路
 * 产出标准ZIP结构docx([Content_Types].xml/_rels/word/document.xml/styles.xml/
 * word/media/*),桌面Word与手机WPS/Office均可直接打开;照片DrawingML内嵌,
 * 中文按字体名引用,彻底替代MHTML伪docx。
 * @param {Array} vehicles - 车辆数据数组(1条=单车详细文档,多条=批量汇总表)
 * @param {Object} [photoMap] - photoPath→dataURL映射(preparePhotoMap预取)
 * @returns {Promise<Blob>} 标准docx Blob
 */
async function generateDocxOOXML(vehicles,photoMap){
  const enc=new TextEncoder();
  const media=[];      // {name,u8} 图片二进制
  const imgRels=[];    // {rid,target} 图片关系
  let imgN=0,docPrId=1;
  const body=[];

  /** 内嵌单张照片: 归一化→量尺寸→限幅→写入media,返回绘制参数 */
  const embedPhoto=async(dataUrl)=>{
    const norm=await _webpToJpeg(dataUrl);
    const mm=/^data:image\/(png|jpe?g);base64,(.*)$/.exec(norm);
    if(!mm)return null;
    const {w,h}=await _imgNaturalSize(norm);
    const scale=Math.min(460/Math.max(w,1),620/Math.max(h,1),1); // 版心限幅
    imgN++;
    const ext=mm[1]==='png'?'png':'jpeg';
    const name='media/image'+imgN+'.'+ext;
    media.push({name,u8:_b64ToU8(mm[2])});
    const rid='rIdImg'+imgN;
    imgRels.push({rid,target:name});
    return {rid,dw:Math.max(1,Math.round(w*scale)),dh:Math.max(1,Math.round(h*scale)),id:++docPrId};
  };

  if(vehicles.length===1){
    const v=vehicles[0];
    body.push(_docxPara(v.display+' 断电操作指导',{bold:true,sizePt:18,color:'1E40AF'}));
    body.push(_docxTable([
      ['品牌',v.brand,'车系',v.series],
      ['配置',v.config,'动力类型',v.powerType],
      ['断电位置',v.position,'',''],
      ...(v.size?[['车辆尺寸',v.size,'','']]:[])
    ]));
    body.push(_docxPara('断电步骤',{bold:true,sizePt:14,color:'1E40AF',spaceBefore:'240'}));
    (v.steps||[]).forEach((s,i)=>body.push(_docxPara((i+1)+'. '+s,{sizePt:11})));
    body.push(_docxPara('钥匙处理方式',{bold:true,sizePt:14,color:'1E40AF',spaceBefore:'240'}));
    body.push(_docxPara('框架: '+(v.keyFrame||[]).join('; '),{sizePt:11}));
    body.push(_docxPara('集装箱: '+(v.keyContainer||[]).join('; '),{sizePt:11}));
    if(v.keyPhotoRemark)body.push(_docxPara('车钥匙备注: '+v.keyPhotoRemark,{sizePt:11,color:'6B7280'}));
    if(v.remarks)body.push(_docxPara('备注: '+v.remarks,{sizePt:11,color:'D97706',spaceBefore:'120'}));
    if((v.photoPaths||[]).length){
      body.push(_docxPara('车辆照片',{bold:true,sizePt:14,color:'1E40AF',spaceBefore:'240'}));
      for(const p of v.photoPaths){
        const dataUrl=photoMap&&photoMap[p];
        if(dataUrl){
          const img=await embedPhoto(dataUrl);
          if(img){body.push(_docxImage(img.rid,img.dw,img.dh,img.id));continue;}
        }
        body.push(_docxPara('[照片未能内嵌: '+String(p).split('/').pop()+']',{sizePt:9,color:'999999'}));
      }
    }
    if((v.videoPaths||[]).length){
      body.push(_docxPara('视频资源',{bold:true,sizePt:14,color:'1E40AF',spaceBefore:'240'}));
      v.videoPaths.forEach(vp=>body.push(_docxPara('视频: '+vp,{sizePt:10})));
    }
    body.push(_docxPara('太仓港车辆断电指导APP · 生成于 '+new Date().toLocaleString('zh-CN'),{sizePt:9,color:'999999',spaceBefore:'360'}));
  }else{
    body.push(_docxPara('太仓港车辆断电指导 - 批量导出 ('+vehicles.length+'条)',{bold:true,sizePt:16,color:'1E40AF'}));
    body.push(_docxTable([
      ['ID','品牌','车系','配置','显示名称','动力','断电位置','步骤','照片','视频'],
      ...vehicles.map(v=>[String(v.id),v.brand,v.series,v.config,v.display,v.powerType,v.position,String((v.steps||[]).length),String(v.photos||0),String(v.videos||0)])
    ]));
    // V10.15.4 反馈7: 批量导出在总表后追加每车含图分表,与详情页导出一致
    for(const v of vehicles){
      body.push(_docxPara(v.display+' 车辆详情',{bold:true,sizePt:13,color:'1E40AF',spaceBefore:'300'}));
      body.push(_docxTable([
        ['品牌',v.brand,'车系',v.series],
        ['配置',v.config,'动力类型',v.powerType],
        ['断电位置',v.position,'',''],
        ...(v.size?[['车辆尺寸',v.size,'','']]:[])
      ]));
      body.push(_docxPara('断电步骤',{bold:true,sizePt:12,color:'1E40AF',spaceBefore:'120'}));
      (v.steps||[]).forEach((s,i)=>body.push(_docxPara((i+1)+'. '+s,{sizePt:11})));
      if(v.remarks)body.push(_docxPara('备注: '+v.remarks,{sizePt:11,color:'D97706',spaceBefore:'120'}));
      if((v.photoPaths||[]).length){
        body.push(_docxPara('车辆照片',{bold:true,sizePt:12,color:'1E40AF',spaceBefore:'120'}));
        for(const p of v.photoPaths){
          const dataUrl=photoMap&&photoMap[p];
          if(dataUrl){
            const img=await embedPhoto(dataUrl);
            if(img){body.push(_docxImage(img.rid,img.dw,img.dh,img.id));continue;}
          }
          body.push(_docxPara('[照片未能内嵌: '+String(p).split('/').pop()+']',{sizePt:9,color:'999999'}));
        }
      }
    }
    body.push(_docxPara('太仓港车辆断电指导APP · 生成于 '+new Date().toLocaleString('zh-CN'),{sizePt:9,color:'999999',spaceBefore:'360'}));
  }

  // ===== OOXML包结构组装 =====
  const documentXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>'+body.join('')+'<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>';
  const stylesXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:eastAsia="微软雅黑" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault/></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style></w:styles>';
  let contentTypes='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="jpeg" ContentType="image/jpeg"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>';
  const rootRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>';
  const docRels='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'+imgRels.map(r=>'<Relationship Id="'+r.rid+'" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="'+r.target+'"/>').join('')+'</Relationships>';
  const nowIso=new Date().toISOString().replace(/\.\d+Z$/,'Z');
  const coreXml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>太仓港车辆断电指导</dc:title><dc:creator>太仓港车辆断电指导APP v'+APP_VERSION+'</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">'+nowIso+'</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">'+nowIso+'</dcterms:modified></cp:coreProperties>';

  const entries=[
    ['[Content_Types].xml',enc.encode(contentTypes)],
    ['_rels/.rels',enc.encode(rootRels)],
    ['word/document.xml',enc.encode(documentXml)],
    ['word/styles.xml',enc.encode(stylesXml)],
    ['word/_rels/document.xml.rels',enc.encode(docRels)],
    ['docProps/core.xml',enc.encode(coreXml)]
  ];
  media.forEach(m=>entries.push(['word/'+m.name,m.u8]));
  const u8=_zipWrite(entries);
  console.log('[导出]OOXML docx生成完成: 图片'+imgN+'张, 体积'+(u8.length/1024).toFixed(0)+'KB');
  return new Blob([u8],{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'});
}

/**
 * 构建导出文档的HTML模板(单车详情/批量汇总) - Word降级链与中文PDF共用
 * V10.6.0: 从旧generateWord中抽出,成为generatePDFCanvas的渲染源,
 * 保证PDF与Word内容结构一致
 * @param {Array} vehicles - 车辆数据数组
 * @param {Object} [photoMap] - photoPath→dataURL映射
 * @returns {string} 完整HTML文档字符串
 */
function _buildExportHtml(vehicles,photoMap){
  const isSingle=vehicles.length===1;
  if(isSingle){
    const v=vehicles[0];
    // V5.3.2: 内嵌base64照片;未命中的照片降级为文字占位而非破图
    const photoHtml=(v.photoPaths||[]).map(p=>{
      const dataUrl=photoMap&&photoMap[p];
      if(dataUrl)return `<img src="${dataUrl}" style="max-width:440px;max-height:330px;margin:5px 0;display:block;"/>`;
      return `<p style="color:#999;font-size:9pt;">[照片未能内嵌: ${String(p).split('/').pop()}]</p>`;
    }).join('');
    const videoHtml=(v.videoPaths||[]).map(vp=>`<p>视频: ${vp}</p>`).join('');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:'微软雅黑','Noto Sans CJK SC',sans-serif;font-size:12pt;margin:24px;color:#111;}
    h1{color:#1e40af;font-size:18pt;}h2{color:#1e40af;font-size:14pt;margin-top:15px;}
    table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:6px;font-size:11pt;}
    .step{margin:5px 0;}.note{color:#d97706;}
    </style></head><body>
    <h1>${v.display} 断电操作指导</h1>
    <table><tr><td>品牌</td><td>${v.brand}</td><td>车系</td><td>${v.series}</td></tr>
    <tr><td>配置</td><td>${v.config}</td><td>动力类型</td><td>${v.powerType}</td></tr>
    <tr><td>断电位置</td><td colspan="3">${v.position}</td></tr>
    ${v.size?`<tr><td>车辆尺寸</td><td colspan="3">${v.size}</td></tr>`:''}
    </table>
    <h2>断电步骤</h2>${(v.steps||[]).map((s,i)=>`<p class="step">${i+1}. ${s}</p>`).join('')}
    <h2>钥匙处理方式</h2>
    <p><strong>框架:</strong> ${(v.keyFrame||[]).join('; ')}</p>
    <p><strong>集装箱:</strong> ${(v.keyContainer||[]).join('; ')}</p>
    ${v.keyPhotoRemark?`<p><strong>车钥匙备注:</strong> ${v.keyPhotoRemark}</p>`:''}
    ${v.remarks?`<h2>备注</h2><p class="note">${v.remarks}</p>`:''}
    ${photoHtml?`<h2>车辆照片</h2>${photoHtml}`:''}
    ${videoHtml?`<h2>视频资源</h2>${videoHtml}`:''}
    <p style="margin-top:20px;color:#999;font-size:9pt;">太仓港车辆断电指导APP · 生成于 ${new Date().toLocaleString('zh-CN')}</p>
    </body></html>`;
  }
  const rows=vehicles.map(v=>`<tr><td>${v.id}</td><td>${v.brand}</td><td>${v.series}</td><td>${v.config}</td><td>${v.display}</td><td>${v.powerType}</td><td>${v.position}</td><td>${(v.steps||[]).length}</td><td>${(v.photoPaths||[]).length}</td><td>${(v.videoPaths||[]).length}</td></tr>`).join('');
  // V10.15.5 反馈1: 批量导出HTML/降级链补齐「总表无图 + 每车含图分表」,与详情页导出一致
  const detailHtml=vehicles.map(v=>{
    const photoHtml=(v.photoPaths||[]).map(p=>{
      const dataUrl=photoMap&&photoMap[p];
      if(dataUrl)return `<img src="${dataUrl}" style="max-width:440px;max-height:330px;margin:5px 0;display:block;"/>`;
      return `<p style="color:#999;font-size:9pt;">[照片未能内嵌: ${String(p).split('/').pop()}]</p>`;
    }).join('');
    const videoHtml=(v.videoPaths||[]).map(vp=>`<p>视频: ${vp}</p>`).join('');
    return `<h1 style="color:#1e40af;font-size:14pt;margin-top:18px;">${v.display} 车辆详情</h1>
    <table><tr><td>品牌</td><td>${v.brand}</td><td>车系</td><td>${v.series}</td></tr>
    <tr><td>配置</td><td>${v.config}</td><td>动力类型</td><td>${v.powerType}</td></tr>
    <tr><td>断电位置</td><td colspan="3">${v.position}</td></tr>
    ${v.size?`<tr><td>车辆尺寸</td><td colspan="3">${v.size}</td></tr>`:''}</table>
    <h2 style="color:#1e40af;font-size:12pt;">断电步骤</h2>${(v.steps||[]).map((s,i)=>`<p class="step">${i+1}. ${s}</p>`).join('')}
    ${(v.keyFrame&&v.keyFrame.length)?`<h2 style="color:#1e40af;font-size:12pt;">钥匙处理方式</h2><p><strong>框架:</strong> ${v.keyFrame.join('; ')}</p><p><strong>集装箱:</strong> ${(v.keyContainer||[]).join('; ')}</p>${v.keyPhotoRemark?`<p><strong>车钥匙备注:</strong> ${v.keyPhotoRemark}</p>`:''}`:''}
    ${v.remarks?`<h2 style="color:#1e40af;font-size:12pt;">备注</h2><p class="note">${v.remarks}</p>`:''}
    ${photoHtml?`<h2 style="color:#1e40af;font-size:12pt;">车辆照片</h2>${photoHtml}`:''}
    ${videoHtml?`<h2 style="color:#1e40af;font-size:12pt;">视频资源</h2>${videoHtml}`:''}`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
  body{font-family:'微软雅黑','Noto Sans CJK SC',sans-serif;font-size:12pt;margin:24px;color:#111;}
  h1{color:#1e40af;font-size:18pt;}
  table{border-collapse:collapse;width:100%;}td,th{border:1px solid #ccc;padding:6px;font-size:10pt;}
  th{background:#1e40af;color:white;}
  .step{margin:5px 0;}.note{color:#d97706;}
  </style></head><body>
  <h1>太仓港车辆断电指导 - 批量导出 (${vehicles.length}条)</h1>
  <table><thead><tr><th>ID</th><th>品牌</th><th>车系</th><th>配置</th><th>显示名称</th><th>动力</th><th>断电位置</th><th>步骤数</th><th>照片</th><th>视频</th></tr></thead>
  <tbody>${rows}</tbody></table>
  ${detailHtml}
  <p style="margin-top:20px;color:#999;font-size:9pt;">太仓港车辆断电指导APP · 生成于 ${new Date().toLocaleString('zh-CN')}</p>
  </body></html>`;
}

/**
 * 中文PDF生成 - V10.6.0 问题1主链路: DOM→html2canvas→A4图像分页→jsPDF
 * 中文以像素图像呈现,彻底规避jsPDF内置字体无CJK字形的乱码问题;
 * 照片在DOM渲染阶段即完成内嵌,分页算法按A4版心高度切片。
 * @param {Array} vehicles - 车辆数据数组
 * @param {Object} [photoMap] - photoPath→dataURL映射
 * @returns {Promise<Blob>} PDF Blob
 */
async function generatePDFCanvas(vehicles,photoMap){
  if(!window.html2canvas)throw new Error('html2canvas未加载');
  const html=_buildExportHtml(vehicles,photoMap);
  const holder=document.createElement('div');
  // 离屏但保持渲染(display:none会导致html2canvas取不到布局)
  holder.style.cssText='position:absolute;left:-10000px;top:0;width:794px;background:#ffffff;z-index:-1;pointer-events:none;';
  holder.innerHTML=html.replace(/^<!DOCTYPE html>/,'').replace(/<\/?html>/g,'').replace(/<head>[\s\S]*?<\/head>/,'');
  document.body.appendChild(holder);
  let canvas;
  try{
    canvas=await html2canvas(holder,{scale:2,useCORS:true,allowTaint:false,backgroundColor:'#ffffff',logging:false});
  }finally{
    holder.remove();
  }
  if(!canvas||!canvas.width)throw new Error('PDF画布渲染失败');
  const{jsPDF}=window.jspdf;
  const pdf=new jsPDF('p','mm','a4');
  const pageWmm=210,pageHmm=297;
  const pxPerMm=canvas.width/pageWmm;         // 画布像素↔毫米换算
  const pagePx=Math.floor(pageHmm*pxPerMm);   // 单页画布高度
  let y=0,pageNo=0;
  while(y<canvas.height){
    const sliceH=Math.min(pagePx,canvas.height-y);
    const slice=document.createElement('canvas');
    slice.width=canvas.width;slice.height=sliceH;
    slice.getContext('2d').drawImage(canvas,0,y,canvas.width,sliceH,0,0,canvas.width,sliceH);
    if(pageNo>0)pdf.addPage();
    pdf.addImage(slice.toDataURL('image/jpeg',0.92),'JPEG',0,0,pageWmm,sliceH/pxPerMm);
    y+=sliceH;pageNo++;
  }
  console.log('[导出]中文PDF生成完成: '+pageNo+'页, 画布'+canvas.width+'x'+canvas.height);
  return pdf.output('blob');
}

/**
 * 生成Word文档 - V10.6.0三级链路: 真OOXML(主) → htmlDocx MHTML(保底) → HTML Blob(兜底)
 * V5.3.2: 照片以base64内嵌(photoMap由preparePhotoMap预取),修复离线文档无图缺陷
 * @param {Array} vehicles - 车辆数据数组
 * @param {Object} [photoMap] - photoPath→dataURL映射(缺省时退化为文字占位)
 * @returns {Promise<Blob>} Word文档Blob对象
 */
async function generateWord(vehicles,photoMap){
  // 主链路: 真OOXML docx(桌面/手机WPS全兼容)
  try{
    return await generateDocxOOXML(vehicles,photoMap);
  }catch(e){
    console.warn('[导出]OOXML生成失败,降级htmlDocx:',e.message||e);
  }
  // 二级保底: htmlDocx MHTML(桌面Word可开,手机端兼容差,仅作过渡)
  const html=_buildExportHtml(vehicles,photoMap);
  if(window._htmlDocxReady&&typeof htmlDocx!=='undefined'&&htmlDocx.asBlob){
    try{
      return htmlDocx.asBlob(html);
    }catch(e){
      console.warn('htmlDocx.asBlob failed, fallback to HTML blob:',e);
    }
  }
  // 兜底: HTML Blob(.doc,仅浏览器预览场景可用)
  return new Blob(['\ufeff'+html],{type:'application/msword'});
}

/**
 * 生成PDF文档 - V10.6.0双链路: canvas图像中文渲染(主) → jsPDF文本(保底)
 * V10.6.0 问题1: 主链路改走generatePDFCanvas——中文经DOM渲染为图像,
 * 根治jsPDF内置字体无CJK字形导致的乱码;canvas不可用(极老WebView)时
 * 回退旧版文本链路,保证导出功能永不缺席。
 * @param {Array} vehicles - 车辆数据数组
 * @param {Object} [photoMap] - photoPath→dataURL映射(preparePhotoMap预取)
 * @returns {Promise<Blob>} PDF文档Blob对象
 */
async function generatePDF(vehicles,photoMap){
  try{
    return await generatePDFCanvas(vehicles,photoMap);
  }catch(e){
    console.warn('[导出]canvas中文PDF失败,回退文本链路:',e.message||e);
    return generatePDFLegacy(vehicles,photoMap);
  }
}

/**
 * 旧版jsPDF文本链路(V10.6.0降为保底) - 照片以base64内嵌
 * 注意: 内置字体无CJK字形,中文显示为乱码方块,仅在html2canvas不可用时兜底
 * @param {Array} vehicles - 车辆数据数组
 * @param {Object} [photoMap] - photoPath→dataURL映射
 * @returns {Blob} PDF文档Blob对象
 */
function generatePDFLegacy(vehicles,photoMap){
  const{jsPDF}=window.jspdf;
  const doc=new jsPDF('p','mm','a4');
  const isSingle=vehicles.length===1;
  if(isSingle){
    const v=vehicles[0];
    doc.setFontSize(18);doc.setTextColor(30,64,175);
    doc.text(v.display+' 断电操作指导',14,20);
    doc.setFontSize(10);doc.setTextColor(0,0,0);
    let y=30;
    doc.autoTable({startY:y,theme:'grid',headStyles:{fillColor:[30,64,175]},
      head:[['品牌','车系','配置','动力类型']],
      body:[[v.brand,v.series,v.config,v.powerType]]});
    y=doc.lastAutoTable.finalY+5;
    doc.autoTable({startY:y,theme:'grid',headStyles:{fillColor:[30,64,175]},
      head:[['断电位置',v.position]],body:[]});
    y=doc.lastAutoTable.finalY+5;
    const stepData=v.steps.map((s,i)=>[String(i+1),s]);
    doc.autoTable({startY:y,theme:'striped',headStyles:{fillColor:[30,64,175]},
      head:[['步骤','内容']],body:stepData});
    y=doc.lastAutoTable.finalY+5;
    if(v.keyFrame&&v.keyFrame.length){
      doc.autoTable({startY:y,theme:'striped',headStyles:{fillColor:[30,64,175]},
        head:[['钥匙-框架处理']],body:v.keyFrame.map(s=>[s])});
      y=doc.lastAutoTable.finalY+3;
    }
    if(v.keyContainer&&v.keyContainer.length){
      doc.autoTable({startY:y,theme:'striped',headStyles:{fillColor:[30,64,175]},
        head:[['钥匙-集装箱处理']],body:v.keyContainer.map(s=>[s])});
      y=doc.lastAutoTable.finalY+3;
    }
    if(v.remarks){doc.setFontSize(9);doc.setTextColor(217,119,6);doc.text('备注: '+v.remarks,14,y+5);y+=10;}
    if(v.photoPaths&&v.photoPaths.length){
      doc.setFontSize(10);doc.setTextColor(100,100,100);
      doc.text('照片: '+v.photoPaths.length+'张',14,y+5);
      y+=10;
      // V5.3.2: 真实图片内嵌(3列×60×45mm网格,逐行推进坐标+自动分页);
      // 未命中的照片打印文件名占位,保持信息完整可追溯
      const labels=['前脸','车尾','钥匙','断电位'];
      let ty=y;
      v.photoPaths.forEach((p,i)=>{
        const dataUrl=photoMap&&photoMap[p];
        const col=i%3;
        if(col===0&&ty+50>282){doc.addPage();ty=20;}
        const x=14+col*64;
        if(dataUrl){
          try{
            doc.addImage(dataUrl,_jspdfImgFmt(dataUrl),x,ty,60,45);
            doc.setFontSize(7);doc.setTextColor(150,150,150);
            doc.text(`${i+1}.${labels[i]||''}`,x,ty+48);
          }catch(e){
            console.warn('PDF内嵌图片失败:',e);
            doc.setFontSize(8);doc.setTextColor(150,150,150);
            doc.text(`[${i+1}] ${String(p).split('/').pop()}(嵌入失败)`,x,ty+5);
          }
        }else{
          doc.setFontSize(8);doc.setTextColor(150,150,150);
          doc.text(`[${i+1}] ${String(p).split('/').pop()}(未能内嵌)`,x,ty+5);
        }
        if(col===2||i===v.photoPaths.length-1)ty+=50;
      });
      y=ty+5;
    }
    if(v.videoPaths&&v.videoPaths.length){
      doc.text('视频: '+v.videoPaths.join(', '),14,y+5);
    }
    doc.setFontSize(8);doc.setTextColor(150,150,150);
    doc.text('太仓港车辆断电指导APP · '+new Date().toLocaleString('zh-CN'),14,287);
  }else{
    doc.setFontSize(16);doc.setTextColor(30,64,175);
    doc.text(`车辆断电指导 - 批量导出 (${vehicles.length}条)`,14,20);
    const body=vehicles.map(v=>[String(v.id),v.brand,v.series,v.config,v.display,v.powerType,v.position,String(v.steps.length),String(v.photos||0),String(v.videos||0)]);
    doc.autoTable({startY:28,theme:'striped',headStyles:{fillColor:[30,64,175],fontSize:8},
      bodyStyles:{fontSize:7},head:[['ID','品牌','车系','配置','显示名称','动力','断电位置','步骤','照片','视频']],body:body});
    doc.setFontSize(8);doc.setTextColor(150,150,150);
    doc.text('太仓港车辆断电指导APP · '+new Date().toLocaleString('zh-CN'),14,287);
  }
  return doc.output('blob');
}

// ===================== DATA CENTER =====================
/**
 * V10.1 问题2修复: 批量导出车型列表折叠状态管理
 * 背景: 旧版73辆车选择列表常驻展开(约240px高度),把"数据备份/数据同步"区块
 * 挤出屏幕可视区,用户反馈"数据同步显示不完全"。现默认折叠,点击标题行展开/收起,
 * 全选时自动展开让用户看到选择结果,折叠态标题旁实时显示已选数量。
 */
const exportListState={expanded:false};
function toggleExportList(force){
  exportListState.expanded=(typeof force==='boolean')?force:!exportListState.expanded;
  const wrap=document.getElementById('export-list-wrap');
  const chevron=document.getElementById('export-list-chevron');
  if(!wrap||!chevron)return;
  wrap.classList.toggle('hidden',!exportListState.expanded);
  chevron.style.transform=exportListState.expanded?'rotate(90deg)':'rotate(0deg)';
  updateExportListHint();
}
function updateExportListHint(){
  const hint=document.getElementById('export-list-hint');
  if(!hint)return;
  const n=state.selectedVehicles.size;
  hint.textContent=exportListState.expanded?'收起':(n>0?`已选${n}辆 · 展开`:'选择车型 · 点击展开');
}
function renderDataList(){
  const c=document.getElementById('data-vehicle-list');
  c.innerHTML=VEHICLES.map(v=>`
    <div class="flex items-center gap-2 py-1.5 cursor-pointer" onclick="toggleSelect(${v.id})">
      <div class="chk ${state.selectedVehicles.has(v.id)?'on':''}" id="chk-${v.id}"></div>
      <span class="text-sm text-gray-700 flex-1 truncate">${v.display}</span>
      <span class="text-xs text-gray-400">${v.position.substring(0,15)}</span>
    </div>
  `).join('');
  updateSelectionCount();
}

function toggleSelect(id){
  if(state.selectedVehicles.has(id))state.selectedVehicles.delete(id);
  else state.selectedVehicles.add(id);
  document.getElementById('chk-'+id).classList.toggle('on');
  updateSelectionCount();
}

function updateSelectionCount(){
  const n=state.selectedVehicles.size;
  document.getElementById('selection-count').textContent=`已选 ${n}/${VEHICLES.length}`;
  document.getElementById('btn-select-all').textContent=n===VEHICLES.length?'取消全选':'全选';
  updateExportListHint(); // V10.1: 折叠态标题旁同步显示已选数量
}

function toggleSelectAll(){
  if(state.selectedVehicles.size===VEHICLES.length){state.selectedVehicles.clear();}else{VEHICLES.forEach(v=>state.selectedVehicles.add(v.id));}
  renderDataList();
  // V10.1: 全选后自动展开列表,用户可直观确认选择结果
  if(state.selectedVehicles.size>0)toggleExportList(true);
}

function clearSelection(){state.selectedVehicles.clear();renderDataList();}

/**
 * V5.7: 带超时保护的照片预取 - 文档导出不再被云端照片拖死
 * 真机上飞书照片拉取慢/失败时,旧版会无限等待导致"生成文件"Toast后无响应。
 * 现在: 最多等待timeoutMs,超时返回已命中的部分(文档无图但可正常导出分享)。
 */
async function preparePhotoMapSafe(vehicles,timeoutMs){
  const limit=timeoutMs||20000;
  let resolved=false;
  const p=preparePhotoMap(vehicles).then(m=>{resolved=true;return m;}).catch(()=>{resolved=true;return {};});
  const timeout=new Promise(r=>setTimeout(()=>r(null),limit));
  const result=await Promise.race([p,timeout]);
  if(result)return result;
  console.warn('[导出]照片预取超时('+limit+'ms),按已命中部分继续导出');
  return {};
}

/**
 * 数据中心批量导出 - V5.8对齐安装包方案
 * 对齐点: ①文件命名 vehicle_poweroff_export_* ②Excel汇总+详情双表结构
 *         ③CSV 11列标准表头+CRLF ④JSON含appVersion/backupAt/vehicles/users
 *         ⑤导出中按钮禁用 ⑥成功后清空选择 ⑦分享面板标题"选择保存或分享方式"
 * @param {string} format - word|pdf|excel|csv|json
 */
async function exportData(format){
  const n=state.selectedVehicles.size;
  // V10.1 问题2配套: 折叠态下未选车型直接点导出时,自动展开选择列表引导用户选择
  if(n===0){showToast('请先选择要导出的车型');toggleExportList(true);return;}
  if(state.batchExporting)return; // 互斥保护: 导出进行中忽略重复点击
  const names={'word':'Word','pdf':'PDF','excel':'Excel','csv':'CSV','json':'JSON'};
  if((format==='excel'&&!window.XLSX)||(format==='pdf'&&!window.jspdf)||(format==='word'&&!window._htmlDocxReady&&typeof htmlDocx==='undefined')){
    showToast(names[format]+'库加载失败，正在使用降级方案...');
  }
  const selectedVehicles=VEHICLES.filter(v=>state.selectedVehicles.has(v.id));
  setExportLoading('batch',format);
  try{
    if(format==='json'){
      // 对齐APK: JSON导出为带元信息的结构(非裸数组),接收方可识别来源与时间
      const payload={appVersion:APP_VERSION,backupAt:new Date().toISOString(),vehicles:selectedVehicles,users:USERS};
      const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
      await shareFile(blob,`vehicle_export_${n}_${Date.now()}.json`,'application/json','车辆断电数据导出');
    }else if(format==='csv'){
      // 对齐APK: 11列标准表头(含钥匙-框架/集装箱/步骤数),CRLF行尾保证Windows Excel兼容
      const headers=['品牌','车系','配置','显示名称','车辆尺寸','动力类型','断电位置','钥匙-框架','钥匙-集装箱','步骤数','备注'];
      const rows=selectedVehicles.map(v=>[v.brand,v.series,v.config,v.display,v.size||'',v.powerType||'',v.position||'',
        (v.keyFrame||[]).join('; '),(v.keyContainer||[]).join('; '),String((v.steps||[]).length),v.remarks||'']);
      const csv='\uFEFF'+[headers,...rows].map(r=>r.map(c=>'"'+String(c==null?'':c).replace(/"/g,'""')+'"').join(',')).join('\r\n');
      const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
      await shareFile(blob,`vehicle_poweroff_export_${Date.now()}.csv`,'text/csv;charset=utf-8');
    }else if(format==='excel'){
      showToast('正在生成含照片Excel...');
      const rawMap=await preparePhotoMapSafe(selectedVehicles);
      const photoMap=await shrinkPhotoMapForExcel(rawMap);
      const buf=generateExcelBatch(selectedVehicles,photoMap);
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      await shareFile(blob,`vehicle_poweroff_export_${n}_${Date.now()}.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }else if(format==='pdf'){
      if(!window.jspdf){showToast('PDF组件未打包,请更新至新版安装包');return;}
      showToast('正在生成含照片PDF...');
      const photoMap=await preparePhotoMapSafe(selectedVehicles);
      const blob=await generatePDF(selectedVehicles,photoMap); // V10.6.0: 异步canvas中文渲染
      await shareFile(blob,`vehicle_poweroff_export_${n}_${Date.now()}.pdf`,'application/pdf');
    }else if(format==='word'){
      showToast('正在生成含照片Word...');
      const photoMap=await preparePhotoMapSafe(selectedVehicles);
      const blob=await generateWord(selectedVehicles,photoMap); // V10.6.0: 异步真OOXML生成
      const mimeType=blob.type||'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const ext=mimeType.includes('msword')?'doc':'docx';
      await shareFile(blob,`车辆断电指南_批量_${n}_${Date.now()}.${ext}`,mimeType);
    }
    // 对齐APK: 导出成功后清空选择,避免二次导出重复携带旧选择集
    state.selectedVehicles.clear();
    renderDataList();
  }catch(err){
    console.error('批量导出失败:',err);
    showToast(`导出 ${names[format]} 失败: `+(err&&err.message?err.message:'未知错误'));
  }finally{
    setExportLoading('batch',null);
  }
}

/**
 * 车辆详情单辆导出 - V5.8对齐安装包方案
 * 对齐点: ①文件命名 {显示名}_断电指南.* ②Excel四工作表结构
 *         ③导出中按钮禁用+文案"导出中..." ④失败提示明确格式名
 * @param {string} format - word|pdf|excel
 */
async function exportSingle(format){
  const v=VEHICLES.find(x=>x.id===state.currentVehicleId);
  if(!v)return;
  if(state.detailExporting)return; // 互斥保护
  const names={'word':'Word','pdf':'PDF','excel':'Excel'};
  if((format==='excel'&&!window.XLSX)||(format==='pdf'&&!window.jspdf)||(format==='word'&&!window._htmlDocxReady&&typeof htmlDocx==='undefined')){
    showToast(names[format]+'库加载失败，正在使用降级方案...');
  }
  setExportLoading('detail',format);
  let shared=false; // shareFile返回值: true=系统分享面板已调起
  try{
    if(format==='excel'){
      showToast('正在生成含照片Excel...');
      const rawMap=await preparePhotoMapSafe([v]);
      const photoMap=await shrinkPhotoMapForExcel(rawMap);
      const buf=generateExcelSingle(v,photoMap);
      const blob=new Blob([buf],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      shared=await shareFile(blob,`${v.display}_断电指南.xlsx`,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    }else if(format==='pdf'){
      if(!window.jspdf){showToast('PDF组件未打包,请更新至新版安装包');return;}
      showToast('正在生成含照片PDF...');
      const photoMap=await preparePhotoMapSafe([v]);
      const blob=await generatePDF([v],photoMap); // V10.6.0: 异步canvas中文渲染
      shared=await shareFile(blob,`${v.display}_断电指南.pdf`,'application/pdf');
    }else if(format==='word'){
      showToast('正在生成含照片Word...');
      const photoMap=await preparePhotoMapSafe([v]);
      const blob=await generateWord([v],photoMap); // V10.6.0: 异步真OOXML生成
      const mimeType=blob.type||'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      const ext=mimeType.includes('msword')?'doc':'docx';
      shared=await shareFile(blob,`${v.display}_断电指南.${ext}`,mimeType);
    }
    // V10.3: shareFile仅系统级分享,失败时内部已报错提示,此处不重复toast
    if(!shared){
      console.log('[导出] '+names[format]+'系统分享未调起(已在shareFile内提示)');
    }
  }catch(err){
    console.error('单车导出失败:',err);
    showToast(`导出 ${names[format]} 失败: `+(err&&err.message?err.message:'未知错误'));
  }finally{
    setExportLoading('detail',null);
  }
}

/**
 * 分享备份 - V5.8新增,对齐安装包数据中心"数据备份"方案
 * 为什么独立于doBackup: 原备份体系面向"本地下载/飞书云"落盘,而现场
 * 组员换机/无公网场景最常用的是把完整备份JSON经微信/钉钉直接发给
 * 对方,故提供一键"全量数据→系统分享面板"通道。
 * 结构对齐APK: {appVersion, backupAt, vehicles, users} → vehicle_poweroff_backup_{ts}.json
 */
async function shareBackup(){
  if(state.backupExporting)return; // 互斥保护
  state.backupExporting=true;
  const btn=document.getElementById('btn-share-backup');
  if(btn){btn.disabled=true;btn.lastChild.textContent='生成备份中...';}
  try{
    const payload={appVersion:APP_VERSION,backupAt:new Date().toISOString(),vehicles:VEHICLES,users:USERS};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const shared=await shareFile(blob,`vehicle_poweroff_backup_${Date.now()}.json`,'application/json');
    // V10.3: shareFile仅系统级分享,失败时内部已报错提示
    addSyncLog(`分享备份完成 · ${VEHICLES.length}条车辆数据`,'blue');
  }catch(err){
    console.error('分享备份失败:',err);
    showToast('备份文件生成失败: '+(err&&err.message?err.message:'未知错误'));
  }finally{
    state.backupExporting=false;
    if(btn){btn.disabled=false;btn.lastChild.textContent='分享备份';}
  }
}

/**
 * 上传注册申请到飞书 - V5.7数据分仓重写
 * 变更: 1)走httpFetch/httpUploadFile绕过CORS(修复真机上传静默失败)
 *      2)上传到"APP数据备份/注册申请"子文件夹(与项目产物彻底分离)
 *      3)失败时给用户明确提示+重试(之前静默失败导致"组长收不到申请")
 *      4)V5.7: Secret已内置默认值,无需每台手机手动配置,跨网络开箱即用
 */
