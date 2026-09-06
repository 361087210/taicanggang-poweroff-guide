/* ===========================================================
 * 模块: 00-bootstrap.js
 * 功能: 拼音/品牌/车辆静态数据/用户持久化+密码工具/飞书Cfg+HTTP+上传三兄弟/缓存索引/APP_VERSION/esc
 * 前置依赖 (defer顺序): (无，启动块)
 * 源范围: demo.html L603-L1802
 * 不变量: 函数名/签名100%保留,顶层function声明挂window供onclick裸调用
 * =========================================================== */
// ===================== PINYIN MAP =====================
const PINYIN_MAP={'比':'B','亚':'Y','迪':'D','长':'C','安':'A','上':'S','海':'H','城':'C','东':'D','风':'F','江':'J','淮':'H','吉':'J','利':'L','奇':'Q','瑞':'R','零':'L','跑':'P','广':'G','汽':'Q','名':'M','爵':'J','大':'D','通':'T','好':'H','猫':'M','哈':'H','弗':'F','深':'S','蓝':'L','悦':'Y','翔':'X','启':'Q','源':'Y','糯':'N','米':'M','极':'J','氪':'K','沃':'W','尔':'E','雷':'L','达':'D','银':'Y','河':'H','领':'L','克':'K','欧':'O','萌':'M','虎':'H','艾':'A','泽':'Z','捷':'J','途':'T','南':'N','星':'X','辰':'C','小':'X','康':'K','行':'X','度':'D','帕':'P','拉':'L','丁':'D','驱':'Q','逐':'Z','舰':'J','腾':'T','势':'S','方':'F','程':'C','豹':'B','鲨':'S','皮':'P','鱼':'Y','秦':'Q','宋':'S','唐':'T','元':'Y','汉':'H','狮':'S','豚':'T','鸥':'O','赛':'S','博':'B','斯':'S','特':'T','福':'F','神':'S','锐':'R','棋':'Q','纳':'N','箱':'X','货':'H','车':'C','海':'H','鲸':'J','兰':'L','迪':'D','氪':'K','岚':'L','图':'T','界':'J','夙':'S','知':'Z','己':'J','菱':'L','程':'C','开':'K','迈':'M','腾':'T','势':'S','E':'E','V':'V','P':'P','H':'H','I':'I','G':'G','O':'O','C':'C','S':'S','A':'A','R':'R','X':'X','U':'U','N':'N','T':'T','D':'D','M':'M','K':'K','L':'L','B':'B','Z':'Z','F':'F','J':'J','W':'W','Q':'Q','Y':'Y','0':'0','1':'1','2':'2','3':'3','4':'4','5':'5','6':'6','7':'7','8':'8','9':'9'};

function getPinyin(str){
  let r='';
  for(let c of str){if(PINYIN_MAP[c])r+=PINYIN_MAP[c];else if(/[a-zA-Z0-9]/.test(c))r+=c.toUpperCase();}
  return r;
}

// ===================== DATA =====================
const BRANDS=[
  {id:'byd',name:'比亚迪',en:'BYD',pinyin:'BYD',color:'#DC2626',note:''},
  {id:'changan',name:'长安',en:'Changan',pinyin:'CA',color:'#003049',note:'新能源及混动车型无需断电池负极，车内下电后锁门即可'},
  {id:'saic',name:'上汽',en:'SAIC',pinyin:'SQ',color:'#006d77',note:''},
  {id:'gwm',name:'长城',en:'GWM',pinyin:'CC',color:'#e29578',note:''},
  {id:'dongfeng',name:'东风',en:'Dongfeng',pinyin:'DF',color:'#264653',note:''},
  {id:'jac',name:'江淮',en:'JAC',pinyin:'JH',color:'#2a9d8f',note:''},
  {id:'geely',name:'吉利',en:'Geely',pinyin:'JL',color:'#283618',note:''},
  {id:'chery',name:'奇瑞',en:'Chery',pinyin:'QR',color:'#bc4749',note:''},
  {id:'soueast',name:'东南',en:'Soueast',pinyin:'DN',color:'#6a4c93',note:''},
  {id:'leapmotor',name:'零跑',en:'Leapmotor',pinyin:'LP',color:'#52796f',note:''},
  {id:'gac',name:'广汽',en:'GAC',pinyin:'GQ',color:'#606c38',note:''},
];

// Vehicle data - 73 entries from 太仓港商品车断电操作手册20260603版
const VEHICLES=[
  {id:1,brandId:'byd',brand:'比亚迪',series:'海豚',config:'低配',display:'比亚迪海豚(低配)',powerType:'纯电',size:'',position:'副驾驶底部',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.副驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image1.jpeg','vehicle_images/image2.jpeg','vehicle_images/image3.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪海豚_低配.mp4"]},
  {id:2,brandId:'byd',brand:'比亚迪',series:'海豚',config:'高配',display:'比亚迪海豚(高配)',powerType:'纯电',size:'',position:'后排座椅腿托下方',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.打开后排车门，短按钥匙锁车键。','3.塑料撬棍撬开电池盖板，用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image1.jpeg','vehicle_images/image2.jpeg','vehicle_images/image4.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:3,brandId:'byd',brand:'比亚迪',series:'海鸥',config:'低配',display:'比亚迪海鸥(低配)',powerType:'纯电',size:'',position:'主驾驶座椅下面',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.主驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image5.jpeg','vehicle_images/image6.jpeg','vehicle_images/image7.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:4,brandId:'byd',brand:'比亚迪',series:'海鸥',config:'高配(天窗)',display:'比亚迪海鸥(高配(天窗))',powerType:'纯电',size:'',position:'后排座椅腿托下方',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.打开后排车门，短按钥匙锁车键。','3.塑料撬棍撬开电池盖板，用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image8.jpeg','vehicle_images/image9.jpeg','vehicle_images/image4.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪海鸥_高配_天窗_.mp4"]},
  {id:5,brandId:'byd',brand:'比亚迪',series:'海豹',config:'海豹DM-I',display:'比亚迪海豹(海豹DM-I)',powerType:'混动',size:'',position:'后备箱左侧储物网兜盖板内',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image10.jpeg','vehicle_images/image11.jpeg','vehicle_images/image12.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪海豹_海豹DM_I.mp4"]},
  {id:6,brandId:'byd',brand:'比亚迪',series:'海豹',config:'海豹EV',display:'比亚迪海豹(海豹EV)',powerType:'纯电',size:'',position:'后排腿托下方',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙，打开左后车门。','2.短按钥匙锁车键锁住车门，电动把手收起，撬开后排腿托下方电池盖板。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.电池盖板归位，关闭车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image13.jpeg','vehicle_images/image14.jpeg','vehicle_images/image4.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:7,brandId:'byd',brand:'比亚迪',series:'海狮',config:'海狮',display:'比亚迪海狮',powerType:'纯电',size:'',position:'主驾驶底部前端',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.主驾驶座位往后调整，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:8,brandId:'byd',brand:'比亚迪',series:'鲨鱼皮卡（SHARK）',config:'鲨鱼皮卡（SHARK）',display:'比亚迪鲨鱼皮卡（SHARK）',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:0},
  {id:9,brandId:'byd',brand:'比亚迪',series:'秦',config:'秦/秦PLUS/PRO',display:'比亚迪秦(秦/秦PLUS/PRO)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:0},
  {id:10,brandId:'byd',brand:'比亚迪',series:'宋',config:'宋PLUS DM-I',display:'比亚迪宋(宋PLUS DM-I)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:2,photoPaths:['vehicle_images/image15.jpeg','vehicle_images/image16.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪宋_宋PLUS_DM_I.mp4"]},
  {id:11,brandId:'byd',brand:'比亚迪',series:'宋',config:'宋PRO',display:'比亚迪宋(宋PRO)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.副驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:12,brandId:'byd',brand:'比亚迪',series:'唐',config:'唐L-EV（天神之眼）',display:'比亚迪唐(唐L-EV（天神之眼）)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.主驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image17.png','vehicle_images/image18.png','vehicle_images/image19.png'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:13,brandId:'byd',brand:'比亚迪',series:'唐',config:'唐EV（欧标）',display:'比亚迪唐(唐EV（欧标）)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:1,photoPaths:['vehicle_images/image20.png'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:14,brandId:'byd',brand:'比亚迪',series:'唐',config:'ATTO8',display:'比亚迪唐(ATTO8)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:2,photoPaths:['vehicle_images/image21.jpeg','vehicle_images/image22.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪唐_ATTO8.mp4"]},
  {id:15,brandId:'byd',brand:'比亚迪',series:'元',config:'元UP',display:'比亚迪元(元UP)',powerType:'纯电',size:'',position:'后排坐椅腿托下方',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.打开后排车门，短按钥匙锁车键，打开后排电池盖板。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.合上电池盖板，关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:1,photoPaths:['vehicle_images/image4.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪元_元UP.mp4"]},
  {id:16,brandId:'byd',brand:'比亚迪',series:'元',config:'元PRO',display:'比亚迪元(元PRO)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:1,photoPaths:['vehicle_images/image23.jpeg'],videos:0},
  {id:17,brandId:'byd',brand:'比亚迪',series:'元',config:'元PLUS',display:'比亚迪元(元PLUS)',powerType:'纯电',size:'',position:'副驾驶底部',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.副驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image24.jpeg','vehicle_images/image25.jpeg','vehicle_images/image3.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:18,brandId:'byd',brand:'比亚迪',series:'汉',config:'汉',display:'比亚迪汉',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:0},
  {id:19,brandId:'byd',brand:'比亚迪',series:'驱逐舰05（KING）',config:'驱逐舰05（KING）',display:'比亚迪驱逐舰05（KING）',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:0,photoPaths:[],videos:0},
  {id:20,brandId:'byd',brand:'比亚迪',series:'腾势',config:'方程豹B5',display:'比亚迪腾势(方程豹B5)',powerType:'混动',size:'',position:'副驾驶底部',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.副驾驶座位往前调整，打开后排车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后排车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.车辆进箱无需收钥匙，确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image26.jpeg','vehicle_images/image27.jpeg','vehicle_images/image3.jpeg'],videos:1,videoPaths:["vehicle_videos/比亚迪腾势_方程豹B5.mp4"]},
  {id:21,brandId:'changan',brand:'长安',series:'深蓝',config:'S7/S5',display:'长安深蓝(S7/S5)',powerType:'混动',size:'',position:'屏幕下电',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放置于车内中控台。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image28.jpeg','vehicle_images/image29.jpeg','vehicle_images/image30.png'],videos:1,videoPaths:["vehicle_videos/长安深蓝_S7_S5.mp4"]},
  {id:22,brandId:'changan',brand:'长安',series:'深蓝',config:'G318',display:'长安深蓝(G318)',powerType:'混动',size:'',position:'后备箱右下方',steps:['1.打开主驾驶车门，取出车钥匙。','2.关闭车门，短按钥匙锁车键后，打开后备箱右下方盖板。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image31.jpeg','vehicle_images/image32.jpeg','vehicle_images/image33.jpeg'],videos:1,videoPaths:["vehicle_videos/长安深蓝_G318.mp4"]},
  {id:23,brandId:'changan',brand:'长安',series:'悦翔',config:'CS15/CS35MAX/CS75/CS55PLUS(2025款)',display:'长安悦翔(CS15/CS35MAX/CS75/CS55PLUS(2025款))',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image34.jpeg','vehicle_images/image35.jpeg','vehicle_images/image36.jpeg'],videos:1,videoPaths:["vehicle_videos/长安悦翔_CS15_CS35MAX_CS75_CS55PLUS_2025款_.mp4"]},
  {id:24,brandId:'changan',brand:'长安',series:'启源',config:'CS55PLUS(2026款)',display:'长安启源(CS55PLUS(2026款))',powerType:'混动',size:'',position:'后备箱右下方',steps:['1.打开主驾驶车门，取出车钥匙。','2.关闭车门，短按钥匙锁车键后，打开后备箱右下方盖板。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image37.jpeg','vehicle_images/image38.jpeg','vehicle_images/image39.jpeg'],videos:1,videoPaths:["vehicle_videos/长安启源_CS55PLUS_2026款_.mp4"]},
  {id:25,brandId:'changan',brand:'长安',series:'启源',config:'EADO PLUS',display:'长安启源(EADO PLUS)',powerType:'混动',size:'',position:'后备箱左下方',steps:['1.打开主驾驶车门，取出车钥匙。','2.关闭车门，短按钥匙锁车键后，打开后备箱右下方盖板。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image40.jpeg','vehicle_images/image41.jpeg','vehicle_images/image42.jpeg'],videos:1,videoPaths:["vehicle_videos/长安启源_EADO_PLUS.mp4"]},
  {id:26,brandId:'changan',brand:'长安',series:'糯米',config:'糯米',display:'长安糯米',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image43.jpeg','vehicle_images/image44.jpeg','vehicle_images/image36.jpeg'],videos:1,videoPaths:["vehicle_videos/长安糯米_糯米.mp4"]},
  {id:27,brandId:'changan',brand:'长安',series:'UNI-',config:'UNI-T',display:'长安UNI-(UNI-T)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image45.jpeg','vehicle_images/image46.jpeg'],videos:1,videoPaths:["vehicle_videos/长安UNI__UNI_T.mp4"]},
  {id:28,brandId:'changan',brand:'长安',series:'UNI-',config:'UNI-V',display:'长安UNI-(UNI-V)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image45.jpeg','vehicle_images/image46.jpeg'],videos:1,videoPaths:["vehicle_videos/长安UNI__UNI_T.mp4"]},
  {id:29,brandId:'changan',brand:'长安',series:'长安之星',config:'小货车',display:'长安长安之星(小货车)',powerType:'混动',size:'',position:'主驾驶座位下方',steps:['1.打开主驾驶车门，松开座椅卡扣抬起座椅。','2.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','3.关闭座椅扣上卡扣，确确保车窗关闭，机械钥匙锁住车门。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image47.jpeg','vehicle_images/image48.jpeg'],videos:1,videoPaths:["vehicle_videos/长安长安之星_小货车.mp4"]},
  {id:30,brandId:'changan',brand:'长安',series:'皮卡',config:'HUNTER（猎手）燃油版/混动版',display:'长安皮卡(HUNTER（猎手）燃油版/混动版)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image49.jpeg','vehicle_images/image50.jpeg','vehicle_images/image51.jpeg'],videos:1,videoPaths:["vehicle_videos/长安皮卡_HUNTER_猎手_燃油版_混动版.mp4"]},
  {id:31,brandId:'saic',brand:'上汽',series:'名爵',config:'ZS/HS/EHS(PHEV)',display:'上汽名爵(ZS/HS/EHS(PHEV))',powerType:'混动',size:'',position:'断电器熄灭后自动断电',steps:['1.打开主驾驶车门，短按断电器点亮蓝灯，再次短按断电器蓝灯熄灭，确认车窗全部关闭后，取出车钥匙。','2.关闭车门，确保车窗关闭，短按钥匙锁车键。','4.再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image52.jpeg','vehicle_images/image53.jpeg','vehicle_images/image54.jpeg'],videos:1,videoPaths:["vehicle_videos/上汽名爵_ZS_HS_EHS_PHEV_.mp4"]},
  {id:32,brandId:'saic',brand:'上汽',series:'名爵',config:'赛博斯特',display:'上汽名爵(赛博斯特)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，打开前保险杠左前盖板，拉动拉线打开前机盖，扣回盖板，取出车钥匙。','2.关闭车门，确保车窗关闭，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'备注：机盖打开方式：拉动前保险杠左前盖板内的拉线',photos:2,photoPaths:['vehicle_images/image55.jpeg','vehicle_images/image56.jpeg'],videos:1,videoPaths:["vehicle_videos/上汽名爵_赛博斯特.mp4"]},
  {id:33,brandId:'saic',brand:'上汽',series:'大通',config:'大通货车',display:'上汽大通(大通货车)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image58.jpeg','vehicle_images/image59.jpeg'],videos:1,videoPaths:["vehicle_videos/上汽大通_大通货车.mp4"]},
  {id:34,brandId:'gwm',brand:'长城',series:'哈佛',config:'H6',display:'长城哈佛(H6)',powerType:'混动',size:'',position:'后备箱盖板下方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:3,photoPaths:['vehicle_images/image60.jpeg','vehicle_images/image61.jpeg','vehicle_images/image62.jpeg'],videos:1,videoPaths:["vehicle_videos/长城哈佛_H6.mp4"]},
  {id:35,brandId:'gwm',brand:'长城',series:'好猫',config:'好猫',display:'长城好猫',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'放干燥剂',photos:2,photoPaths:['vehicle_images/image63.png','vehicle_images/image64.png'],videos:1,videoPaths:["vehicle_videos/长城好猫_好猫.mp4"]},
  {id:36,brandId:'dongfeng',brand:'东风',series:'风行',config:'T5EVO',display:'东风风行(T5EVO)',powerType:'纯电',size:'',position:'后备箱盖板右下方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image65.jpeg','vehicle_images/image66.jpeg','vehicle_images/image67.jpeg'],videos:1,videoPaths:["vehicle_videos/东风风行_T5EVO.mp4"]},
  {id:37,brandId:'dongfeng',brand:'东风',series:'风度',config:'帕拉丁（PALADIN）',display:'东风风度(帕拉丁（PALADIN）)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image68.jpeg','vehicle_images/image69.jpeg','vehicle_images/image70.jpeg'],videos:1,videoPaths:["vehicle_videos/东风风度_帕拉丁_PALADIN_.mp4"]},
  {id:38,brandId:'dongfeng',brand:'东风',series:'风神',config:'风神HUGEMHD500T/MAGEMHD500T',display:'东风风神(风神HUGEMHD500T/MAGEMHD500T)',powerType:'混动',size:'',position:'后备箱右后方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image71.jpeg','vehicle_images/image72.jpeg','vehicle_images/image73.jpeg'],videos:1,videoPaths:["vehicle_videos/东风风神_风神HUGEMHD500T_MAGEMHD500T.mp4"]},
  {id:39,brandId:'dongfeng',brand:'东风',series:'VIGO',config:'VIGO（纳米06海外版）/纳米06国内版',display:'东风VIGO(VIGO（纳米06海外版）/纳米06国内版)',powerType:'混动',size:'',position:'屏幕下电',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image74.jpeg','vehicle_images/image75.jpeg'],videos:1,videoPaths:["vehicle_videos/东风VIGO_VIGO_纳米06海外版__纳米06国内版.mp4"]},
  {id:40,brandId:'dongfeng',brand:'东风',series:'VIGO',config:'纳米01',display:'东风VIGO(纳米01)',powerType:'混动',size:'',position:'屏幕下电',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image76.jpeg','vehicle_images/image77.jpeg'],videos:0},
  {id:41,brandId:'dongfeng',brand:'东风',series:'VIGO',config:'BOX',display:'东风VIGO(BOX)',powerType:'混动',size:'',position:'屏幕下电',steps:['1.短按主驾驶车门把手通电，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image78.jpeg','vehicle_images/image79.jpeg'],videos:0},
  {id:42,brandId:'dongfeng',brand:'东风',series:'锐棋（RICH）',config:'RICH6',display:'东风锐棋（RICH）(RICH6)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image80.jpeg','vehicle_images/image81.jpeg','vehicle_images/image82.jpeg'],videos:1,videoPaths:["vehicle_videos/东风锐棋_RICH__RICH6.mp4"]},
  {id:43,brandId:'dongfeng',brand:'东风',series:'小康',config:'MPVC37',display:'东风小康(MPVC37)',powerType:'混动',size:'',position:'主驾驶座位下方',steps:['1.打开主驾驶车门，松开座椅卡扣抬起座椅。','2.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','3.关闭座椅扣上卡扣，确确保车窗关闭，机械钥匙锁住车门。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image83.jpeg','vehicle_images/image84.jpeg','vehicle_images/image85.jpeg'],videos:1,videoPaths:["vehicle_videos/东风小康_MPVC37.mp4"]},
  {id:44,brandId:'jac',brand:'江淮',series:'E-JS1/4',config:'E-JS1/4',display:'江淮E-JS1/4',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image86.jpeg','vehicle_images/image87.jpeg','vehicle_images/image88.jpeg'],videos:1,videoPaths:["vehicle_videos/江淮E_JS1_4_E_JS1_4.mp4"]},
  {id:45,brandId:'jac',brand:'江淮',series:'江淮皮卡',config:'T8PRO',display:'江淮江淮皮卡(T8PRO)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image89.jpeg','vehicle_images/image90.jpeg','vehicle_images/image91.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:46,brandId:'jac',brand:'江淮',series:'江淮皮卡',config:'T6',display:'江淮江淮皮卡(T6)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image92.jpeg','vehicle_images/image93.jpeg','vehicle_images/image94.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:47,brandId:'geely',brand:'吉利',series:'极氪',config:'极氪001/X/7X',display:'吉利极氪(极氪001/X/7X)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image95.jpeg','vehicle_images/image96.jpeg'],videos:1,videoPaths:["vehicle_videos/吉利极氪_极氪001_X_7X.mp4"]},
  {id:48,brandId:'geely',brand:'吉利',series:'沃尔沃',config:'S60',display:'吉利沃尔沃(S60)',powerType:'混动',size:'',position:'后备箱左后盖板处',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到车内中控台'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image97.jpeg','vehicle_images/image98.jpeg','vehicle_images/image99.jpeg'],videos:1,videoPaths:["vehicle_videos/吉利沃尔沃_S60.mp4"]},
  {id:49,brandId:'geely',brand:'吉利',series:'雷达（RIODARA）皮卡',config:'雷达6',display:'吉利雷达（RIODARA）皮卡(雷达6)',powerType:'混动',size:'',position:'前机盖',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image100.jpeg','vehicle_images/image101.jpeg','vehicle_images/image102.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:50,brandId:'geely',brand:'吉利',series:'银河',config:'EX5（银河E5）',display:'吉利银河(EX5（银河E5）)',powerType:'纯电',size:'',position:'屏幕下电',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image103.jpeg','vehicle_images/image104.jpeg'],videos:1,videoPaths:["vehicle_videos/吉利银河_EX5_银河E5_.mp4"]},
  {id:51,brandId:'geely',brand:'吉利',series:'银河',config:'EX2（银河E2）',display:'吉利银河(EX2（银河E2）)',powerType:'纯电',size:'',position:'前机盖',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image105.jpeg','vehicle_images/image106.jpeg','vehicle_images/image107.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:52,brandId:'geely',brand:'吉利',series:'领克',config:'领克02',display:'吉利领克(领克02)',powerType:'混动',size:'',position:'屏幕下电',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后，钥匙放置于中控台手机无线充电位置。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image108.jpeg','vehicle_images/image109.jpeg'],videos:1,videoPaths:["vehicle_videos/吉利领克_领克02.mp4"]},
  {id:53,brandId:'geely',brand:'吉利',series:'领克',config:'领克08',display:'吉利领克(领克08)',powerType:'混动',size:'',position:'屏幕下电',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后，钥匙放置于中控台手机无线充电位置。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image110.jpeg','vehicle_images/image111.jpeg','vehicle_images/image109.jpeg'],videos:0},
  {id:54,brandId:'chery',brand:'奇瑞',series:'欧萌达',config:'欧萌达5',display:'奇瑞欧萌达(欧萌达5)',powerType:'混动',size:'',position:'后备箱盖板下方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image112.jpeg','vehicle_images/image113.jpeg','vehicle_images/image114.png'],videos:1,videoPaths:["vehicle_videos/奇瑞欧萌达_欧萌达5.mp4"]},
  {id:55,brandId:'chery',brand:'奇瑞',series:'瑞虎',config:'瑞虎7PRO',display:'奇瑞瑞虎(瑞虎7PRO)',powerType:'混动',size:'',position:'前机盖',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image115.jpeg','vehicle_images/image116.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞瑞虎_瑞虎7PRO.mp4"]},
  {id:56,brandId:'chery',brand:'奇瑞',series:'瑞虎',config:'瑞虎7 CSH/PLUGIN HYBRID',display:'奇瑞瑞虎(瑞虎7 CSH/PLUGIN HYBRID)',powerType:'混动',size:'',position:'后备箱泡沫板底部',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image117.jpeg','vehicle_images/image118.jpeg','vehicle_images/image119.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:57,brandId:'chery',brand:'奇瑞',series:'瑞虎',config:'瑞虎8 CSH',display:'奇瑞瑞虎(瑞虎8 CSH)',powerType:'混动',size:'',position:'后备箱电池负极',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image120.jpeg','vehicle_images/image121.jpeg','vehicle_images/image122.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞瑞虎_瑞虎8_CSH.mp4"]},
  {id:58,brandId:'chery',brand:'奇瑞',series:'艾瑞泽',config:'艾瑞泽5PRO',display:'奇瑞艾瑞泽(艾瑞泽5PRO)',powerType:'混动',size:'',position:'前机盖',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image123.jpeg','vehicle_images/image124.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞艾瑞泽_艾瑞泽5PRO.mp4"]},
  {id:59,brandId:'chery',brand:'奇瑞',series:'皮卡',config:'RELY（瑞麟）R8',display:'奇瑞皮卡(RELY（瑞麟）R8)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image125.jpeg','vehicle_images/image126.jpeg','vehicle_images/image127.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:60,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'X50',display:'奇瑞捷途JETOUR(X50)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image128.jpeg','vehicle_images/image129.jpeg','vehicle_images/image130.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_X50.mp4"]},
  {id:61,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'X70',display:'奇瑞捷途JETOUR(X70)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image131.jpeg','vehicle_images/image132.jpeg','vehicle_images/image130.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_X70.mp4"]},
  {id:62,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'DASHENG',display:'奇瑞捷途JETOUR(DASHENG)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，机械钥匙锁车。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image133.jpeg','vehicle_images/image134.jpeg','vehicle_images/image135.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_DASHENG.mp4"]},
  {id:63,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'T1 I-DM',display:'奇瑞捷途JETOUR(T1 I-DM)',powerType:'混动',size:'',position:'后备箱电池负极',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image136.jpeg','vehicle_images/image137.jpeg','vehicle_images/image138.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_T1_I_DM.mp4"]},
  {id:64,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'T2 I-DM',display:'奇瑞捷途JETOUR(T2 I-DM)',powerType:'混动',size:'',position:'后备箱电池负极',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image139.jpeg','vehicle_images/image140.jpeg','vehicle_images/image141.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_T2_I_DM.mp4"]},
  {id:65,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'T2 XWD',display:'奇瑞捷途JETOUR(T2 XWD)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，机械钥匙锁住车门。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image139.jpeg','vehicle_images/image142.jpeg','vehicle_images/image141.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞捷途JETOUR_T2_XWD.mp4"]},
  {id:66,brandId:'chery',brand:'奇瑞',series:'捷途JETOUR',config:'G700-GAIA',display:'奇瑞捷途JETOUR(G700-GAIA)',powerType:'混动',size:'',position:'后备箱右后方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image143.jpeg','vehicle_images/image144.jpeg','vehicle_images/image73.jpeg'],videos:0},
  {id:67,brandId:'chery',brand:'奇瑞',series:'东南SOUEAST',config:'S06DM',display:'奇瑞东南SOUEAST(S06DM)',powerType:'混动',size:'',position:'后备箱电池负极',steps:['1.打开车门，先放倒后排座椅，确保四个车窗关闭，取出车钥匙。','2.短按主驾驶锁车键锁住车门，在车内移动到后备箱位置。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.打开主驾驶车门，机械钥匙锁住车门，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image145.jpeg','vehicle_images/image146.jpeg','vehicle_images/image147.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:68,brandId:'chery',brand:'奇瑞',series:'东南SOUEAST',config:'S07',display:'奇瑞东南SOUEAST(S07)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，机械钥匙锁住车门。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image148.jpeg','vehicle_images/image149.jpeg','vehicle_images/image150.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞东南SOUEAST_S07.mp4"]},
  {id:69,brandId:'chery',brand:'奇瑞',series:'东南SOUEAST',config:'S08DM',display:'奇瑞东南SOUEAST(S08DM)',powerType:'混动',size:'',position:'后备箱电池负极',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.短按钥匙锁车键锁住车门，长按后备箱键打开后备箱。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image151.jpeg','vehicle_images/image152.jpeg','vehicle_images/image153.jpeg'],videos:1,videoPaths:["vehicle_videos/奇瑞东南SOUEAST_S08DM.mp4"]},
  {id:70,brandId:'chery',brand:'奇瑞',series:'东南SOUEAST',config:'S09-AWD',display:'奇瑞东南SOUEAST(S09-AWD)',powerType:'混动',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image154.jpeg','vehicle_images/image155.jpeg','vehicle_images/image156.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:71,brandId:'leapmotor',brand:'零跑',series:'零跑',config:'零跑B10',display:'零跑零跑(零跑B10)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['打开主驾驶车门，确认全部车窗关闭，取出车钥匙'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到车内中控台'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:2,photoPaths:['vehicle_images/image157.png','vehicle_images/image158.png'],videos:1,videoPaths:["vehicle_videos/零跑零跑_零跑B10.mp4"]},
  {id:72,brandId:'leapmotor',brand:'零跑',series:'零跑',config:'零跑C10',display:'零跑零跑(零跑C10)',powerType:'纯电',size:'',position:'后备箱盖板下方',steps:['1.打开车门，确保四个车窗关闭，取出车钥匙。','2.先长按后备箱键打开后备箱，然后卡片钥匙放到主驾驶后视镜钥匙感应区锁车门。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭后备箱，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image157.png','vehicle_images/image158.png','vehicle_images/image159.png'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]},
  {id:73,brandId:'gac',brand:'广汽',series:'AION（埃安）',config:'AION-V/AION-UT',display:'广汽AION（埃安）(AION-V/AION-UT)',powerType:'纯电',size:'',position:'前机盖电池负极',steps:['1.打开主驾驶车门，拉动前机盖开关打开前机盖，确认全部车窗关闭，取出车钥匙。','2.关闭车门，短按钥匙锁车键。','3.用10号扳手逆时针松动电池负极线束夹，拔掉负极线束夹并套上珍珠套管避免接触。','4.关闭前机盖，再次拉动车门确保关闭。'],keyFrame:['1.所有车辆钥匙数量，绑扎及框架检查完。','2.确认断电无误后放到铅封袋内封好袋口。','3.放入钥匙盒关好，封好铅封。'],keyContainer:['1.车辆钥匙数量及绑扎检查完。','2.确认断电无误后放置于车内中控台。'],remarks:'',photos:3,photoPaths:['vehicle_images/image160.jpeg','vehicle_images/image161.jpeg','vehicle_images/image162.jpeg'],videos:1,videoPaths:["vehicle_videos/通用断电视频.mp4"]}
];

// ===================== USER SYSTEM =====================
const LEADER_PHONE='17602554481';
function loadUsers(){
  let users=JSON.parse(localStorage.getItem('tcg_users')||'null');
  if(!users){
    users=[{id:1,name:'组长',phone:LEADER_PHONE,password:'123456',role:'admin',status:'active',created:'2026/08-20'}];
    localStorage.setItem('tcg_users',JSON.stringify(users));
  }
  return users;
}
function saveUsers(users){localStorage.setItem('tcg_users',JSON.stringify(users));}
let USERS=loadUsers();

// ===================== PASSWORD HASHING (V5.4 安全加固) =====================
// 使用 SHA-256 + 随机盐值哈希密码，不再明文存储
// 哈希结果格式: "salt$hash" (salt 为 16 位随机字符串，hash 为 64 位十六进制)
async function hashPassword(password, salt) {
  const data = new TextEncoder().encode(salt + password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
  return salt + '$' + hashHex;
}

function genSalt() {
  const arr = new Uint8Array(8);
  crypto.getRandomValues(arr);
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyPassword(password, stored) {
  if (!stored || !stored.includes('$')) return false;
  const salt = stored.split('$')[0];
  const hash = await hashPassword(password, salt);
  return hash === stored;
}

async function hashUserPasswords() {
  // 一次性迁移：将所有明文密码哈希化（V5.4 初始化时执行一次）
  let changed = false;
  for (const u of USERS) {
    if (u.password && !u.password.includes('$')) {
      const salt = genSalt();
      u.password = await hashPassword(u.password, salt);
      changed = true;
    }
  }
  if (changed) saveUsers(USERS);
}

// ===================== FEISHU DEFAULT CONFIG =====================
// V5.3: 双文件夹分离 - folder=项目产物目录(版本更新检查), dataFolder=APP用户数据目录(备份/注册申请/审批结果)
// V10.12 Secret 构建时注入:
//   · appId / appSecret / folderToken → 构建期由 scripts/inject_build_secrets.js 注入
//     到 <head></head> 间的 <script>window.__BUILD_SECRETS__={...}</script>,首次getFeishuCfg()读取后立即delete
//   · 公开目录结构(本文件可安全保留) → 根folder、数据仓名称、四子目录、同步间隔
//   · 本仓库源码不再含任何可还原密文(XOR key/hex cipher/明文Secret均移除),
//     validate_web_assets校验通过: "无硬编码Secret + 注入路径存在"
//   · 本地预览/未注入环境: appSecret为空,feishuCfgReady()会提示用户在设置页手动填写(安全兜底不泄密)
/* V10.14.0 修复A【零配置镜像同步·闭包永久缓存】
 * 根因: 旧版把window.__BUILD_SECRETS__读完就delete,但localStorage/tcg_session等
 *       会在用户点"清除缓存"、系统杀WebView回收内存等场景下被清空,此时
 *       再次进入页面调用getFeishuCfg()时注入脚本已经被delete且不会重新
 *       执行(HTML头部<script>只执行一次)→秘钥永久丢失→组员被迫手动填配置。
 * 修复: 首次读取后立即把注入值复制到本文件作用域的私有变量_INJECTED_SECRETS_CACHE,
 *       后续getFeishuCfg调用一律从私有变量取,不再依赖window或localStorage。
 *       私有变量挂在本脚本<script>作用域的JS引擎闭包里,WebView不被系统完全
 *       kill(普通onpause/resume/轻量GC/清localStorage)就始终存在,
 *       覆盖99%的日常使用场景;极端情况下(系统彻底杀进程重启WebView),
 *       HTML会被重新解析,注入<script>会再次执行(由浏览器保证),链路自愈。
 * 安全: 不挂window/不写持久化,内存dump仍需反向本闭包(比window全局
 *       裸暴露攻击面小得多),且与原来用完即焚的"明文在内存瞬态"同级安全。 */
let _INJECTED_SECRETS_CACHE = null;

/* V11.3 运行期解密构建期注入的密文 Secret【过渡加固】
 * 与 scripts/inject_build_secrets.js 的 xnorEnc/SECRET_XOR_KEY 完全一致。
 * 反方审查: key 必然在客户端, 不构成绝对防护; 价值是把"解包 grep 明文"抬升到
 *           "定位算法+key"级别, 属纵深防御, 根治见 V11.4 M2 加固 + Phase1 服务端秘钥。
 * 算法: base64 → 字符码 XOR 循环 key。仅处理注入路径; localStorage 用户手填仍明文,
 *       因为那是用户自己输入、本机可见, 不属攻击面。 */
const _SECRET_XOR_KEY = 'TCG_V11_XOR_2026';
function _decryptBuildSecret(enc){
  if (!enc || typeof atob !== 'function') return '';
  let bin;
  try { bin = atob(enc); } catch(_) { return ''; }
  let out = '';
  for (let i = 0; i < bin.length; i++) {
    out += String.fromCharCode(bin.charCodeAt(i) ^ _SECRET_XOR_KEY.charCodeAt(i % _SECRET_XOR_KEY.length));
  }
  return out;
}
const DEFAULT_FEISHU_CONFIG={
  // 公开字段(非机密, version.json/交付文档内已公开): 构建注入/用户保存优先,本处做兜底
  appId:'cli_aa0ce4fd91f85be8',
  folder:'nodcnGA95g93RhIUSdCeTkhKlQc',
  // ⚠️ appSecret(V10.12起源码内移除硬编码) → 来源顺序: localStorage设置 → 构建期window.__BUILD_SECRETS__注入
  //   本地未配置+未注入时: getFeishuCfg().appSecret 为空字符串, feishuCfgReady()拦截并给出提示
  dataFolder:'APP数据备份',   // 首次同步时自动在该名称子文件夹下定位/创建,token缓存于localStorage
  syncSub:'同步数据',          // 车型数据双向同步 vehicle_sync_data.json
  pendingSub:'注册申请',       // 组员注册申请 pending_reg_*.json
  approvedSub:'审批结果',      // 组长审批结果 approved_users.json
  backupSub:'备份文件',        // 手动全量备份 vehicle_backup_*.json
  interval:30
};

/**
 * 获取生效的飞书配置 - 用户自定义优先→构建注入→内置默认值(公开部分)
 * V10.12: 优先读取并一次性消耗 window.__BUILD_SECRETS__(注入的appId/appSecret/folderToken),
 *         读取后立即delete,防止后续内存dump读出Secret。
 * V10.14.0 修复A【闭包永久缓存】:
 *         首次从window.__BUILD_SECRETS__读到后立即clone写入_INJECTED_SECRETS_CACHE(私有闭包),
 *         后续调用即使localStorage被清空/注入已delete,仍能从闭包取回秘钥,
 *         保证组员零配置同步永不失效。
 * @returns {Object} {appId,appSecret,folder,dataFolder,interval,...}
 */
function getFeishuCfg(){
  // 1) 一次性消费window注入的值,并永远缓存到本文件闭包_INJECTED_SECRETS_CACHE
  if(_INJECTED_SECRETS_CACHE===null && typeof window!=='undefined' && window.__BUILD_SECRETS__){
    // 浅克隆一份,避免后续delete window引用也连带清掉闭包缓存
    _INJECTED_SECRETS_CACHE = Object.assign({}, window.__BUILD_SECRETS__);
    // V11.3: 若注入的是密文appSecretEnc, 运行期解出明文appSecret供下游pick()使用
    if(_INJECTED_SECRETS_CACHE && typeof _INJECTED_SECRETS_CACHE.appSecretEnc==='string' && _INJECTED_SECRETS_CACHE.appSecretEnc.length>0){
      _INJECTED_SECRETS_CACHE.appSecret = _decryptBuildSecret(_INJECTED_SECRETS_CACHE.appSecretEnc);
    }
    try{delete window.__BUILD_SECRETS__;}catch(_){window.__BUILD_SECRETS__=void 0;}
  }
  const injected = _INJECTED_SECRETS_CACHE; // 直接用闭包缓存(优先于窗口和存储)
  // 2) 用户设置页手动覆盖(localStorage)优先
  const saved=JSON.parse(localStorage.getItem('feishu_config')||'{}');
  /* V10.14.0 修复C【成员端忽略本地脏配置】
   * 如果当前角色是组员(非admin),且localStorage保存的配置与注入缓存/内置默认冲突,
   * 一律丢弃本地保存值,只信任注入缓存+内置默认。
   * 原因: 历史版本或调试路径可能写入了空字符串/占位值,一旦进入localStorage
   * 旧版pick()逻辑会"非空即取"(saved.appSecret=' ' 或 '开发调试')导致注入秘钥
   * 被覆盖,同步链永久失效。组员端理论上就不应该手动保存配置。
   * 注意: state可能尚未初始化(页面刚加载),null视为未登录按admin可覆盖模式,
   *       保证登录前的首次加载流程不被误拦截。 */
  const memberRole = !!(typeof state !== 'undefined' && state && state.currentUser && state.currentUser.role && state.currentUser.role !== 'admin');
  const writtenBy = saved && typeof saved._writer === 'string' ? saved._writer : null;
  const pick=(k,d)=>{
    const s=saved[k];
    // 成员端: 只信任admin显式写入(writtenBy='admin')或注入缓存,忽略所有其他历史值
    const skipSaved = memberRole && writtenBy !== 'admin';
    if(!skipSaved && typeof s==='string' && s.length>0) return s;
    if(injected){
      if(k==='folder'){if(typeof injected.folderToken==='string'&&injected.folderToken.length>0)return injected.folderToken;}
      else{if(typeof injected[k]==='string'&&injected[k].length>0)return injected[k];}
    }
    return d;
  };
  return {
    appId:pick('appId',DEFAULT_FEISHU_CONFIG.appId),
    appSecret:pick('appSecret',DEFAULT_FEISHU_CONFIG.appSecret),
    folder:pick('folder',DEFAULT_FEISHU_CONFIG.folder),
    dataFolder:pick('dataFolder',DEFAULT_FEISHU_CONFIG.dataFolder),
    syncSub:pick('syncSub',DEFAULT_FEISHU_CONFIG.syncSub),
    pendingSub:pick('pendingSub',DEFAULT_FEISHU_CONFIG.pendingSub),
    approvedSub:pick('approvedSub',DEFAULT_FEISHU_CONFIG.approvedSub),
    backupSub:pick('backupSub',DEFAULT_FEISHU_CONFIG.backupSub),
    interval:pick('interval',DEFAULT_FEISHU_CONFIG.interval)
  };
}

/**
 * 飞书配置完整性校验 - V5.3.4修复(诊断报告根因1)
 * 根因: 历史上所有飞书操作入口仅校验appId,而appId有内置默认值恒为真;
 *       appSecret自V5.3.1安全加固后默认留空,带空Secret请求token必然返回
 *       "app_id or app_secret is invalid",导致全部飞书功能静默失败,
 *       用户只看到"视频待补充/云端无数据",无法定位真实原因。
 * 修复: appId与appSecret缺一不可,未配置时给出明确指引而非静默跳过。
 * @param {Object} cfg - 飞书配置(getFeishuCfg返回值)
 * @param {boolean} [withToast] - 未配置时是否弹Toast提示用户
 * @returns {boolean} 配置是否完整可用
 */
function feishuCfgReady(cfg,withToast){
  const ok=!!(cfg&&cfg.appId&&cfg.appSecret);
  if(!ok&&withToast)showToast('飞书配置不完整: 请在「设置→飞书配置」填写 App Secret 后保存');
  return ok;
}

/**
 * 二进制响应统一转Blob - V5.3.4修复(诊断报告根因4)
 * 根因: cordova-plugin-advanced-http在部分Android/插件版本组合下,
 *       responseType:'blob'实际返回ArrayBuffer而非Blob对象;
 *       ArrayBuffer直接进URL.createObjectURL会抛TypeError,
 *       被外层catch静默吞掉,用户只看到"视频待补充",无法定位。
 * 修复: 统一在下载出口做类型归一,ArrayBuffer/TypedArray转真Blob。
 * @param {*} data - 插件或fetch返回的二进制数据
 * @param {string} [mimeType] - 目标MIME类型
 * @returns {Blob|null} 归一化后的Blob,无法识别返回null
 */
function asBlob(data,mimeType){
  if(!data)return null;
  if(typeof Blob!=='undefined'&&data instanceof Blob)return data;
  if(data instanceof ArrayBuffer)return new Blob([data],{type:mimeType||'application/octet-stream'});
  if(typeof Uint8Array!=='undefined'&&(data instanceof Uint8Array))return new Blob([data],{type:mimeType||'application/octet-stream'});
  return null;
}

/**
 * 飞书云端源失败提示(节流) - V5.3.4修复(诊断报告根因5)
 * 根因: 图片/视频飞书源失败只console.warn,用户完全无感知,
 *       无法区分"飞书没配置/网络不通/文件不存在"。
 * 修复: 失败时短暂Toast一次;30秒内多条失败合并为一条,避免刷屏。
 */
let _feishuFailToastAt=0;
function feishuFailToast(reason){
  const now=Date.now();
  if(now-_feishuFailToastAt<30000)return; // 30秒节流
  _feishuFailToastAt=now;
  showToast('飞书云端源不可用('+reason+'),已尝试其他来源');
}

/**
 * 统一HTTP请求适配层 - V5.3核心修复
 *
 * 为什么需要: 飞书开放API响应头不携带Access-Control-Allow-Origin,
 * Cordova android@13+ 的WebView以https://localhost为源发起fetch时会被CORS策略拦截,
 * 导致V5.2及之前版本在真机上所有飞书请求静默失败(浏览器预览正常,真机必现)。
 * cordova-plugin-advanced-http在原生层发起请求,天然绕过WebView CORS限制。
 *
 * 策略: APP环境优先走原生HTTP插件;浏览器/插件未就绪时回退fetch(保留网页预览能力)
 *
 * @param {string} url - 请求地址
 * @param {Object} opts - {method,headers,body} body支持字符串/普通对象;文件上传请用httpUploadFile
 * @returns {Promise<Object|string>} 解析后的JSON对象或原始文本
 */
async function httpFetch(url,opts){
  opts=opts||{};
  const method=(opts.method||'GET').toUpperCase();
  const headers=opts.headers||{};
  // APP环境且插件就绪: 走原生HTTP
  if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
    const http=window.cordova.plugin.http;
    http.setDataSerializer('json');
    return new Promise((resolve,reject)=>{
      const done=res=>{
        // 兼容插件自动解析对象 / 字符串含BOM两种形态,防止中文响应错乱
        let d=res.data;
        if(typeof d==='string'){
          if(d.charCodeAt(0)===0xFEFF)d=d.slice(1);
          try{resolve(JSON.parse(d));}catch(e){resolve(d);}
        }else{resolve(d);}
      };
      const fail=err=>reject(new Error(typeof err==='object'?(err.error||err.message||'网络请求失败'):String(err)));
      if(method==='GET'||method==='HEAD'){
        http.sendRequest(url,{method,headers},done,fail);
      }else{
        let body=opts.body;
        // 普通对象直接传,字符串JSON需先解析(插件json序列化器要求对象)
        if(typeof body==='string'){
          try{body=JSON.parse(body);}catch(e){/* 保留原样,由text序列化器处理 */}
        }
        if(typeof body==='object'&&body!==null){
          http.setDataSerializer('json');
        }else{
          http.setDataSerializer('utf8');
        }
        http.sendRequest(url,{method,headers,data:body},done,fail);
      }
    });
  }
  // 浏览器/降级: 标准fetch
  // V5.7.1修复: 普通对象body必须JSON序列化——旧版直接把对象交给fetch,
  // 实际发出"[object Object]"被飞书400拒绝(原生插件路径正常,浏览器/WebView
  // 降级路径全挂)。这是"真机上偶发飞书认证失败"的根因之一。
  let body=opts.body;
  const isFormData=typeof FormData!=='undefined'&&body instanceof FormData;
  const isBlob=typeof Blob!=='undefined'&&body instanceof Blob;
  const finalHeaders=Object.assign({},headers);
  if(body&&typeof body==='object'&&!isFormData&&!isBlob){
    if(!finalHeaders['Content-Type']&&!finalHeaders['content-type']){
      finalHeaders['Content-Type']='application/json';
    }
    body=JSON.stringify(body);
  }
  const res=await fetch(url,{method,headers:finalHeaders,body});
  const text=await res.text();
  try{return JSON.parse(text);}catch(e){return text;}
}

/**
 * 原生文件上传适配层 - 飞书upload_all接口
 * V10.8.0 根因修复: 飞书upload_all API要求file_name/parent_type/parent_node/size
 *   作为multipart/form-data体中的表单字段,而cordova-plugin-advanced-http的uploadFile()
 *   将第二参数(params)序列化为URL查询串——API在multipart体中找不到必填字段,返回
 *   {"code":1061002,"msg":"params error."}。这是"云同步失败"的直接根因。
 * 修复方案: 改用sendRequest()+serializer:'multipart'+FormData,所有参数(含文件Blob)
 *   由插件multipart序列化器通过FormData.entries()遍历,对字符串值作为普通form字段,
 *   对Blob值通过FileReader读取二进制,完整构造符合飞书API要求的multipart体。
 * 插件要求: WebView需支持Blob/FileReader/TextEncoder/FormData(Android 7+均已支持);
 *   若FormData.entries()不可用,使用插件自带的ponyfill FormData构造器。
 * @param {Object} params - {token,fileName,folderToken,blob}
 * @returns {Promise<Object>} 上传接口响应
 */
/**
 * V10.12: 首选FeishuAPI单例(单向收敛真源),缺省时回退内联实现(测试沙箱/老环境兼容);签名不变
 */
async function httpUploadFile(params){
  if(typeof FeishuAPI!=='undefined'&&FeishuAPI.httpUploadFile){return await FeishuAPI.httpUploadFile(params);}
  // ===== 兼容回退(与feishu-api.js _uploadAllRaw同构;测试沙箱兜底) =====
  const blob=params.blob;
  if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
    try{
      const http=window.cordova.plugin.http;
      const FormDataCtor=(http.ponyfills&&http.ponyfills.FormData)||window.FormData;
      if(!FormDataCtor){throw new Error('FormData不可用,WebView版本过低');}
      const formData=new FormDataCtor();
      formData.append('file_name',params.fileName);
      formData.append('parent_type','explorer');
      formData.append('parent_node',params.folderToken);
      formData.append('size',String(blob.size));
      formData.append('file',blob,params.fileName);
      return new Promise((resolve,reject)=>{
        const done=res=>{try{resolve(JSON.parse(res.data));}catch(e){resolve(res.data);}};
        const fail=err=>reject(new Error(typeof err==='object'?(err.error||err.message||'上传失败'):String(err)));
        try{
          http.sendRequest('https://open.feishu.cn/open-apis/drive/v1/files/upload_all',{method:'post',data:formData,serializer:'multipart',headers:{Authorization:'Bearer '+params.token},responseType:'text'},done,fail);
        }catch(syncErr){reject(syncErr instanceof Error?syncErr:new Error(String(syncErr)));}
      });
    }catch(e){console.warn('原生multipart上传失败,回退fetch:',e);}
  }
  const formData=new FormData();
  formData.append('file_name',params.fileName);
  formData.append('parent_type','explorer');
  formData.append('parent_node',params.folderToken);
  formData.append('size',String(blob.size));
  formData.append('file',blob,params.fileName);
  const res=await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_all',{method:'POST',headers:{Authorization:'Bearer '+params.token},body:formData});
  return res.json();
}

/**
 * ============================================================
 * V10.10.0 大文件分片上传模块(保留常量与工具函数,实现下沉到FeishuAPI)
 * ============================================================
 */
/** 飞书upload_all单文件硬上限(官方20MB) */
const FEISHU_UPLOAD_ALL_LIMIT=20*1024*1024;
/** 分片上传触发阈值: 16MB(预留4MB安全余量,规避multipart表单头边界) */
const FEISHU_MULTIPART_THRESHOLD=16*1024*1024;
/** 分片上传体积上限: 500MB(飞书云盘单文件上限随版本不同,保守取值) */
const FEISHU_MULTIPART_MAX=500*1024*1024;

/** 上传类API QPS门控: 串行+最小间隔220ms(实现已下沉到FeishuAPI._qpsGate;保留供测试/老代码引用) */
let _feishuUploadLastTs=0;
/**
 * V10.12: QPS门控薄壳(主流程不再依赖此函数;保留以防历史代码直接调用,与提取器正则兼容)
 */
async function _feishuQpsGate(){
  const wait=Math.max(0,_feishuUploadLastTs+220-Date.now());
  if(wait>0)await new Promise(r=>setTimeout(r,wait));
  _feishuUploadLastTs=Date.now();
}

/**
 * Adler-32校验和(保留, 不再参与主流程分片上传; 仍可供外部工具代码使用)
 */
function _adler32(u8){
  const MOD=65521;
  let a=1,b=0;
  for(let i=0;i<u8.length;i++){
    a=(a+u8[i])%MOD;
    b=(b+a)%MOD;
  }
  return String((((b<<16)|a)>>>0));
}

/**
 * 飞书文件名清洗 - 保留(外部代码多处使用: sync/json备份/视频上传)
 */
function _sanitizeFeishuFileName(name,maxLen){
  const limit=maxLen||150;
  let s=String(name||'')
    .replace(/[\u0000-\u001f\u007f]/g,'')
    .replace(/[\\/:*?"<>|]/g,'_')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/gu,'')
    .replace(/\s+/g,'_')
    .replace(/_{2,}/g,'_')
    .replace(/^[.\s_]+|[.\s_]+$/g,'');
  if(!s)s='file_'+Date.now().toString(36);
  if(s.length>limit){
    const dot=s.lastIndexOf('.');
    const ext=(dot>0&&s.length-dot<=6)?s.slice(dot):'';
    s=s.slice(0,limit-ext.length)+ext;
  }
  return s;
}

/**
 * V10.12: 分片上传单次上传薄壳(保留签名, 用于老代码直接引用)
 */
async function _uploadPartOnce(token,uploadId,seq,u8,checksum){
  // 逻辑已统一到 FeishuAPI._uploadPartOnce(闭包内未导出),此处独立实现保留兼容
  const chunkBlob=new Blob([u8]);
  if(window.cordova&&window.cordova.plugin&&window.cordova.plugin.http){
    try{
      const http=window.cordova.plugin.http;
      const FormDataCtor=(http.ponyfills&&http.ponyfills.FormData)||window.FormData;
      const fd=new FormDataCtor();
      fd.append('upload_id',uploadId);
      fd.append('seq',String(seq));
      fd.append('size',String(u8.length));
      fd.append('checksum',checksum);
      fd.append('file',chunkBlob,'chunk_'+seq);
      return await new Promise((resolve,reject)=>{
        http.sendRequest(
          'https://open.feishu.cn/open-apis/drive/v1/files/upload_part',
          {method:'post',data:fd,serializer:'multipart',headers:{Authorization:'Bearer '+token},responseType:'text'},
          res=>{try{resolve(JSON.parse(res.data));}catch(e){resolve(res.data);}},
          err=>reject(new Error(typeof err==='object'?(err.error||err.message||'分片上传失败'):String(err)))
        );
      });
    }catch(e){console.warn('[分片]原生multipart上传失败,回退fetch:',e);}
  }
  const fd=new FormData();
  fd.append('upload_id',uploadId);
  fd.append('seq',String(seq));
  fd.append('size',String(u8.length));
  fd.append('checksum',checksum);
  fd.append('file',chunkBlob,'chunk_'+seq);
  const res=await fetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_part',{method:'POST',headers:{Authorization:'Bearer '+token},body:fd});
  return res.json();
}

/**
 * V10.12: 首选FeishuAPI单例(单向收敛真源);缺省时回退内联实现(测试沙箱/老环境兼容);签名不变
 */
async function httpUploadFileMultipart(params){
  const fileName=_sanitizeFeishuFileName(params.fileName||'unnamed');
  const cleanParams=Object.assign({},params,{fileName});
  if(typeof FeishuAPI!=='undefined'&&FeishuAPI.httpUploadFileMultipart){
    return await FeishuAPI.httpUploadFileMultipart(cleanParams);
  }
  // ===== 兼容回退(旧版完整三件套实现;测试沙箱兜底) =====
  const blob=params.blob;
  const onProgress=params.onProgress||(()=>{});
  if(!blob||blob.size<=0)throw new Error('空文件不可上传');
  if(blob.size>FEISHU_MULTIPART_MAX)throw new Error('文件超过500MB上限,请压缩后重试');
  const doPrepare=async()=>{
    await _feishuQpsGate();
    const prep=await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_prepare',{
      method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8',Authorization:'Bearer '+params.token},
      body:JSON.stringify({file_name:fileName,parent_type:'explorer',parent_node:params.folderToken,size:blob.size})
    });
    if(!prep||prep.code!==0)throw new Error('预上传失败: '+((prep&&prep.msg)||'无响应'));
    return {uploadId:String(prep.data.upload_id),blockSize:prep.data.block_size||4194304,blockNum:prep.data.block_num||Math.ceil(blob.size/(prep.data.block_size||4194304))};
  };
  for(let session=0;session<2;session++){
    const {uploadId,blockSize,blockNum}=await doPrepare();
    let expired=false;
    for(let seq=0;seq<blockNum;seq++){
      const chunk=blob.slice(seq*blockSize,Math.min((seq+1)*blockSize,blob.size));
      const u8=new Uint8Array(await chunk.arrayBuffer());
      const checksum=_adler32(u8);
      let ok=false,lastErr=null;
      for(let attempt=0;attempt<3&&!ok;attempt++){
        try{
          await _feishuQpsGate();
          const res=await _uploadPartOnce(params.token,uploadId,seq,u8,checksum);
          if(res&&res.code===0){ok=true;}
          else if(res&&res.code===1061021){expired=true;break;}
          else if(res&&res.code===1061045){lastErr=new Error('频控可重试');}
          else{lastErr=new Error('分片'+seq+'失败: '+((res&&res.msg)||'未知'));}
        }catch(e){lastErr=e;}
        if(!ok&&!expired)await new Promise(r=>setTimeout(r,500*(attempt+1)));
      }
      if(expired)break;
      if(!ok)throw lastErr||new Error('分片上传失败 seq='+seq);
      onProgress(seq+1,blockNum);
    }
    if(expired){if(session===0){console.warn('[分片]事务过期,重新预上传并重传:',fileName);continue;}throw new Error('分片事务两次过期,上传失败');}
    await _feishuQpsGate();
    const fin=await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/upload_finish',{
      method:'POST',
      headers:{'Content-Type':'application/json; charset=utf-8',Authorization:'Bearer '+params.token},
      body:JSON.stringify({upload_id:uploadId,block_num:blockNum})
    });
    if(!fin||fin.code!==0)throw new Error('完成上传失败: '+((fin&&fin.msg)||'无响应'));
    return {code:0,msg:'success',data:fin.data||{}};
  }
  throw new Error('分片上传失败: 事务过期重传仍失败');
}

/**
 * 智能上传路由 - 全部上传场景统一入口(V10.10.0)
 * 策略: ≤16MB走upload_all(单次调用省配额);>16MB走官方分片三件套;
 *   upload_all返回1061043(超限)时自动升级分片重试,双保险。
 * @param {Object} params - {token,fileName,folderToken,blob,onProgress?}
 * @returns {Promise<Object>} 飞书响应
 */
async function httpUploadFileSmart(params){
  // V10.10.0 随机名称防护: 统一入口清洗文件名(幂等,合法名原样通过),
  // 覆盖小文件路径——分片路径内部另有清洗,双保险杜绝1061109合规拒绝
  if(params.fileName)params=Object.assign({},params,{fileName:_sanitizeFeishuFileName(params.fileName)});
  if(params.blob&&params.blob.size>FEISHU_MULTIPART_THRESHOLD){
    return await httpUploadFileMultipart(params);
  }
  const res=await httpUploadFile(params);
  if(res&&res.code===1061043&&params.blob){
    console.warn('[上传]upload_all超限(1061043),自动升级分片上传:',params.fileName);
    return await httpUploadFileMultipart(params);
  }
  return res;
}

/**
 * 将Blob写入APP缓存目录并返回file://路径 - 原生上传/分享共用
 * @param {string} fileName - 目标文件名
 * @param {Blob} blob - 二进制内容
 * @returns {Promise<string>} file://开头的本地路径
 */
function writeBlobToCache(fileName,blob){
  return new Promise((resolve,reject)=>{
    if(!window.resolveLocalFileSystemURL){reject(new Error('文件插件不可用'));return;}
    // relative URL格式: <cacheDir>/<fileName>
    window.resolveLocalFileSystemURL(cordova.file.cacheDirectory,dirEntry=>{
      dirEntry.getFile(fileName,{create:true,exclusive:false},fileEntry=>{
        fileEntry.createWriter(writer=>{
          writer.onwriteend=()=>resolve(fileEntry.toURL());
          writer.onerror=e=>reject(new Error('写入文件失败'));
          writer.write(blob);
        },err=>reject(new Error('创建写入器失败')));
      },err=>reject(new Error('创建文件失败')));
    },err=>reject(new Error('访问缓存目录失败')));
  });
}

/* ===================== 本地持久缓存层 (V10.2 问题1+问题2) =====================
 * 问题1根因: 视频播放走五源链(本地APK→GitHub直链→飞书云端→CDN→报错),
 *   旧版仅内存objectURL单文件缓存(_feishuVideoCache),App重启即失效,
 *   每次点开播放都要重新走网络加载。本层提供磁盘持久缓存:
 *   - video_cache/  : 播放过的视频落盘,二次打开file://秒开
 *   - exported_docs/: 导出生成的文档落盘,缓存管理页可见可删
 * 目录选型: dataDirectory(App私有持久目录,系统不自动清理),
 *   区别于cacheDirectory(系统低存储时可能回收,不适合视频缓存)。
 * 索引策略: 文件系统目录扫描为事实源,localStorage仅存展示元数据,
 *   外部删文件不会导致索引漂移(扫描时以实际存在为准)。
 * 容量防御: 单文件>100MB不缓存(视频为短操作教学片,正常≤19MB分片上限)。
 */
const CACHE_ROOT_DIR='tcg_cache';
const CACHE_DIR_VIDEOS='video_cache';
const CACHE_DIR_DOCS='exported_docs';
const CACHE_MAX_FILE_BYTES=100*1024*1024; // 100MB单文件上限

/** 读取缓存索引(localStorage,文件系统扫描结果的展示元数据补充) */
function _cacheIndexLoad(){
  try{return JSON.parse(localStorage.getItem('tcg_cache_index')||'{"videos":{},"docs":{}}');}
  catch(e){return{videos:{},docs:{}};}
}
function _cacheIndexSave(idx){try{localStorage.setItem('tcg_cache_index',JSON.stringify(idx));}catch(e){console.debug('[Cache]索引保存失败(localStorage配额满,不影响主流程):',e.message)}}

/**
 * 获取缓存子目录的DirectoryEntry(懒创建)
 * @param {string} subDir - 子目录名(video_cache/exported_docs)
 * @returns {Promise<DirectoryEntry|null>} 浏览器环境或插件不可用时返回null
 */
function _cacheDirEntry(subDir){
  return new Promise(resolve=>{
    if(!window.resolveLocalFileSystemURL||!window.cordova||!cordova.file){resolve(null);return;}
    window.resolveLocalFileSystemURL(cordova.file.dataDirectory,rootEntry=>{
      rootEntry.getDirectory(CACHE_ROOT_DIR,{create:true},cacheRoot=>{
        cacheRoot.getDirectory(subDir,{create:true},subEntry=>resolve(subEntry),()=>resolve(null));
      },()=>resolve(null));
    },()=>resolve(null));
  });
}

/**
 * 将Blob写入持久缓存并登记索引(V10.2核心写入API)
 * @param {string} subDir - 子目录名
 * @param {string} fileName - 文件名
 * @param {Blob} blob - 内容
 * @param {Object} [meta] - 展示元数据(vehicle/kind等,可选)
 * @returns {Promise<string|null>} file://URL;环境不支持或超限时返回null(不抛错,调用方可fire-and-forget)
 */
async function cacheSaveBlob(subDir,fileName,blob,meta){
  if(!blob||!(blob instanceof Blob)||blob.size===0)return null;
  if(blob.size>CACHE_MAX_FILE_BYTES){console.log('[缓存]文件超100MB上限,跳过:',fileName);return null;}
  const dir=await _cacheDirEntry(subDir);
  if(!dir)return null;
  const safeName=String(fileName).replace(/[\/\\:*?"<>|]/g,'_');
  return new Promise(resolve=>{
    dir.getFile(safeName,{create:true,exclusive:false},fileEntry=>{
      fileEntry.createWriter(writer=>{
        writer.onwriteend=()=>{
          const idx=_cacheIndexLoad();
          const bucket=subDir===CACHE_DIR_VIDEOS?'videos':'docs';
          // V10.4.0 问题2: 合并旧meta而非整条覆盖——流式播放期间已标记的
          // played状态在落盘回调到达时不能被新meta冲掉(时序: 播放标记可能
          // 先于磁盘写入完成),保留played/lastPlayed等展示元数据
          const prev=idx[bucket][safeName]||{};
          idx[bucket][safeName]={size:blob.size,ts:Date.now(),meta:Object.assign({},prev.meta,meta||{})};
          _cacheIndexSave(idx);
          console.log(`[缓存]已落盘 ${subDir}/${safeName} (${(blob.size/1048576).toFixed(1)}MB)`);
          resolve(fileEntry.toURL());
        };
        writer.onerror=()=>{console.warn('[缓存]写入失败:',safeName);resolve(null);};
        writer.write(blob);
      },()=>resolve(null));
    },()=>resolve(null));
  });
}

/**
 * 查询缓存文件是否已存在(视频播放源⓪)
 * @param {string} subDir - 子目录名
 * @param {string} fileName - 文件名
 * @returns {Promise<string|null>} file://URL;不存在或环境不支持返回null
 */
async function cacheFileUrl(subDir,fileName){
  const dir=await _cacheDirEntry(subDir);
  if(!dir)return null;
  const safeName=String(fileName).replace(/[\/\\:*?"<>|]/g,'_');
  return new Promise(resolve=>{
    dir.getFile(safeName,{create:false},fileEntry=>resolve(fileEntry.toURL()),()=>resolve(null));
  });
}

/**
 * 扫描缓存子目录,返回文件清单(文件系统为事实源,索引仅补元数据)
 * @param {string} subDir - 子目录名
 * @returns {Promise<Array<{name,size,ts,meta}>>} 按时间倒序
 */
async function cacheList(subDir){
  const dir=await _cacheDirEntry(subDir);
  if(!dir)return [];
  const idx=_cacheIndexLoad();
  const bucket=subDir===CACHE_DIR_VIDEOS?'videos':'docs';
  return new Promise(resolve=>{
    const reader=dir.createReader();
    const all=[];
    const readBatch=()=>reader.readEntries(entries=>{
      if(!entries.length){
        resolve(all.sort((a,b)=>b.ts-a.ts));
        return;
      }
      let pending=entries.length;
      entries.forEach(e=>{
        if(!e.isFile){if(--pending===0)readBatch();return;}
        e.file(f=>{
          all.push({name:e.name,size:f.size,ts:(idx[bucket][e.name]&&idx[bucket][e.name].ts)||f.lastModified||Date.now(),meta:(idx[bucket][e.name]&&idx[bucket][e.name].meta)||{}});
          if(--pending===0)readBatch();
        },()=>{if(--pending===0)readBatch();});
      });
    },()=>resolve(all.sort((a,b)=>b.ts-a.ts)));
    readBatch();
  });
}

/**
 * 删除缓存子目录中的指定文件并同步索引
 * @param {string} subDir - 子目录名
 * @param {string[]} names - 要删除的文件名数组
 * @returns {Promise<number>} 实际删除数
 */
async function cacheDeleteFiles(subDir,names){
  if(!names||!names.length)return 0;
  const dir=await _cacheDirEntry(subDir);
  if(!dir)return 0;
  const idx=_cacheIndexLoad();
  const bucket=subDir===CACHE_DIR_VIDEOS?'videos':'docs';
  let deleted=0;
  for(const name of names){
    await new Promise(res=>{
      dir.getFile(name,{create:false},fileEntry=>{
        fileEntry.remove(()=>{
          deleted++;
          delete idx[bucket][name];
          console.log('[缓存]已删除:',subDir+'/'+name);
          res();
        },()=>res());
      },()=>res());
    });
  }
  _cacheIndexSave(idx);
  return deleted;
}

/* ===================== V10.5.0 问题1: 缓存保存到本地 =====================
 * 需求: 清理缓存界面中检测到的视频和文档,提供"保存到本地"功能。
 * 背景: 缓存位于App私有目录(dataDirectory/tcg_cache/),文件管理器不可见;
 *   保存到本地=复制到公共下载目录(Download/太仓港断电指导/),用户可直接访问。
 * 系统兼容矩阵:
 *  - Android 11+: Scoped Storage下App可直接在公共Download创建文件(FUSE直写),无需权限
 *  - Android 10: requestLegacyExternalStorage标志生效(config.xml已注入)+运行时写权限
 *  - Android 6-9: WRITE_EXTERNAL_STORAGE运行时权限(已声明,保存前主动申请)
 *  - 全版本降级: 公共Download不可写时回退App外部目录(文件管理器可见)
 * 权限插件: cordova-plugin-android-permissions(已随CI安装)。
 */
const SAVE_DIR_NAME='太仓港断电指导';

/**
 * 解析"保存到本地"目标目录(公共Download优先,失败降级App外部目录)
 * @returns {Promise<{dir:DirectoryEntry,label:string}|null>} 目标目录与展示名;环境不支持返回null
 */
function _resolveSaveDestDir(){
  return new Promise(resolve=>{
    if(!window.resolveLocalFileSystemURL||!window.cordova||!cordova.file){resolve(null);return;}
    // 降级: App外部专用目录(/storage/emulated/0/Android/data/<pkg>/files/太仓港断电指导/)
    const tryFallback=()=>{
      const ext=cordova.file.externalDataDirectory;
      if(!ext){resolve(null);return;}
      window.resolveLocalFileSystemURL(ext,extEntry=>{
        extEntry.getDirectory(SAVE_DIR_NAME,{create:true},
          dest=>resolve({dir:dest,label:'手机存储/Android/data/'+SAVE_DIR_NAME}),
          ()=>resolve(null));
      },()=>resolve(null));
    };
    // 优先: 公共Download/太仓港断电指导/(/storage/emulated/0/Download/太仓港断电指导/)
    const root=cordova.file.externalRootDirectory;
    if(!root){tryFallback();return;}
    window.resolveLocalFileSystemURL(root,rootEntry=>{
      rootEntry.getDirectory('Download',{create:true},dlDir=>{
        dlDir.getDirectory(SAVE_DIR_NAME,{create:true},
          dest=>resolve({dir:dest,label:'下载/'+SAVE_DIR_NAME}),
          ()=>tryFallback());
      },()=>tryFallback());
    },()=>tryFallback());
  });
}

/**
 * Android 10及以下主动申请写存储权限(11+系统免权限,跳过避免无谓弹窗)
 * @returns {Promise<void>} 权限流程结束(拒绝不阻塞——后续写入失败走降级链)
 */
function _ensureSavePermission(){
  return new Promise(resolve=>{
    try{
      const perms=window.cordova&&window.plugins&&window.plugins.permissions;
      const ver=window.device&&parseInt(window.device.version,10);
      if(!perms||!window.device||isNaN(ver)||ver>=11){resolve();return;} // 11+无需权限
      perms.hasPermission(perms.WRITE_EXTERNAL_STORAGE,
        st=>{
          if(st&&st.hasPermission){resolve();return;}
          perms.requestPermission(perms.WRITE_EXTERNAL_STORAGE,()=>resolve(),()=>resolve());
        },
        ()=>resolve());
    }catch(e){resolve();}
  });
}

/**
 * 复制单个缓存文件到"保存到本地"目标目录
 * @param {string} subDir - 缓存子目录(video_cache/exported_docs)
 * @param {string} fileName - 文件名
 * @param {Object} dest - _resolveSaveDestDir()结果
 * @returns {Promise<void>} 失败抛错(调用方统计)
 */
async function saveCacheFileToLocal(subDir,fileName,dest){
  const srcDir=await _cacheDirEntry(subDir);
  if(!srcDir)throw new Error('缓存目录不可用');
  if(!dest||!dest.dir)throw new Error('本地保存目录不可用');
  // 读取源文件File对象(可直接作为Blob写入目标)
  const srcFile=await new Promise((resolve,reject)=>{
    srcDir.getFile(fileName,{create:false},
      fe=>fe.file(f=>resolve(f),()=>reject(new Error('读取缓存文件失败'))),
      ()=>reject(new Error('缓存文件不存在')));
  });
  await new Promise((resolve,reject)=>{
    dest.dir.getFile(fileName,{create:true},fe=>{
      fe.createWriter(w=>{
        w.onwriteend=()=>resolve();
        w.onerror=()=>reject(new Error('写入本地失败'));
        w.write(srcFile);
      },()=>reject(new Error('创建写入器失败')));
    },()=>reject(new Error('创建目标文件失败')));
  });
  console.log('[保存] 已保存到本地:',dest.label+'/'+fileName);
}

/**
 * 将Blob直接写入本地「下载/太仓港断电指导」目录(不调起任何分享控件)
 * V10.6.0 问题3核心函数: 本地备份等"仅保存"场景的统一落盘通道。
 * 环境分流:
 *  - Cordova(APP): 权限申请→公共Download目录解析→文件写入,失败返回null
 *  - 浏览器预览: a[download]触发浏览器下载(等价"保存到本地",无分享面板)
 * @param {Blob} blob - 要保存的文件内容
 * @param {string} filename - 目标文件名(含扩展名)
 * @returns {Promise<{label:string}|null>} 成功返回目录展示名,失败返回null
 */
async function saveBlobToLocalFolder(blob,filename){
  if(!blob||!filename)return null;
  if(window.cordova&&window.resolveLocalFileSystemURL){
    await _ensureSavePermission();
    const dest=await _resolveSaveDestDir();
    if(!dest||!dest.dir)return null;
    const safeName=filename.replace(/[\/\\:*?"<>|]/g,'_');
    await new Promise((resolve,reject)=>{
      dest.dir.getFile(safeName,{create:true},fe=>{
        fe.createWriter(w=>{
          w.onwriteend=()=>resolve();
          w.onerror=()=>reject(new Error('写入本地失败'));
          w.write(blob);
        },()=>reject(new Error('创建写入器失败')));
      },()=>reject(new Error('创建目标文件失败')));
    });
    console.log('[保存] 已直接写入本地目录:',dest.label+'/'+safeName);
    return {label:dest.label};
  }
  // 浏览器环境: 下载即"保存到本地"(无系统分享控件可调,语义等价)
  try{
    const url=URL.createObjectURL(blob);
    const a=document.createElement('a');
    a.href=url;a.download=filename;document.body.appendChild(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
    return {label:'浏览器下载目录'};
  }catch(e){
    console.warn('[保存] 浏览器下载失败:',e.message);
    return null;
  }
}

/**
 * 批量保存选中的缓存项到本地(缓存管理界面「保存到本地」入口)
 * V10.5.0 问题1: 复制(App私有缓存→公共Download),源缓存不删除(保存≠清理)
 */
function saveSelectedCacheToLocal(){
  if(!cacheSel.size)return;
  const n=cacheSel.size;
  showConfirm('保存到本地',`将选中的 ${n} 项保存到手机「下载/太仓港断电指导」目录？保存后可在文件管理器查看，不影响缓存。`,async()=>{
    hapticFeedback();
    await _ensureSavePermission();
    const dest=await _resolveSaveDestDir();
    if(!dest){showToast('保存失败：无法访问本地存储目录');return;}
    const videoNames=[...cacheSel].filter(k=>k.startsWith('video|')).map(k=>k.slice(6));
    const docNames=[...cacheSel].filter(k=>k.startsWith('doc|')).map(k=>k.slice(4));
    let ok=0,fail=0;
    for(const name of videoNames){
      try{await saveCacheFileToLocal(CACHE_DIR_VIDEOS,name,dest);ok++;}
      catch(e){console.warn('[保存]视频失败:',name,e.message);fail++;}
    }
    for(const name of docNames){
      try{await saveCacheFileToLocal(CACHE_DIR_DOCS,name,dest);ok++;}
      catch(e){console.warn('[保存]文档失败:',name,e.message);fail++;}
    }
    if(ok>0)showToast(`✅ 已保存 ${ok} 项到「${dest.label}」`+(fail>0?`，${fail} 项失败`:''));
    else showToast('保存失败：无法写入本地目录');
  });
}

/* ===================== V10.6.0 问题4: 车辆数据本地持久化层(IndexedDB) =====================
 * 根因: VEHICLES是内嵌于demo.html的const内存数组,新增/编辑/删除/同步合并的
 *   车辆数据(含文字图片照片)从不落盘——APP重启即回退到内置数据,组长新增的
 *   数据下次打开就丢了,自然"无法同步到飞书";组员拉取后同样只存内存,重启即丢,
 *   表现为"组员也无法获取最新数据"。
 * 选型: IndexedDB(而非localStorage)——照片为base64数据流,单车可达数MB,
 *   localStorage的5MB配额必然爆仓;IndexedDB配额数百MB级,适合结构化大数据。
 * 语义: 全量快照覆盖写(用户数据优先)——首次启动无快照用内置数据,
 *   任何一次数据变更(增/删/改/同步合并)后持久化当前全量,下次启动以快照为准。
 * 可靠性: 读写均静默降级(失败仅console告警),绝不阻塞主流程。 */

/** 打开持久化数据库(单例缓存连接) */
let _tcgDbConn=null;
function _tcgDb(){
  if(_tcgDbConn)return Promise.resolve(_tcgDbConn);
  return new Promise((resolve,reject)=>{
    if(!window.indexedDB){reject(new Error('indexedDB不可用'));return;}
    const req=indexedDB.open('tcg_poweroff',1);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains('vehicles'))db.createObjectStore('vehicles');
    };
    req.onsuccess=()=>{_tcgDbConn=req.result;resolve(_tcgDbConn);};
    req.onerror=()=>reject(req.error||new Error('IndexedDB打开失败'));
  });
}

/**
 * 持久化当前VEHICLES全量快照(增删改/同步合并后调用)
 * fire-and-forget语义: 调用方可不await,失败仅告警不阻塞
 * @returns {Promise<boolean>} 是否写入成功
 */
async function persistVehicles(){
  try{
    const db=await _tcgDb();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction('vehicles','readwrite');
      tx.objectStore('vehicles').put({timestamp:new Date().toISOString(),appVersion:'v'+APP_VERSION,vehicles:VEHICLES},'user_data');
      tx.oncomplete=()=>resolve();
      tx.onerror=()=>reject(tx.error||new Error('事务写入失败'));
      tx.onabort=()=>reject(tx.error||new Error('事务中止'));
    });
    return true;
  }catch(e){
    console.warn('[持久化] 车辆数据写入失败:',e.message||e);
    return false;
  }
}

/**
 * 启动时恢复持久化车辆数据(有快照则整体替换内存数组内容)
 * 保持const VEHICLES引用不变(splice+push),全部既有代码零感知
 * @returns {Promise<boolean>} 是否恢复了快照
 */
async function loadPersistedVehicles(){
  try{
    const db=await _tcgDb();
    const data=await new Promise((resolve,reject)=>{
      const tx=db.transaction('vehicles','readonly');
      const rq=tx.objectStore('vehicles').get('user_data');
      rq.onsuccess=()=>resolve(rq.result);
      rq.onerror=()=>reject(rq.error||new Error('读取失败'));
    });
    if(data&&Array.isArray(data.vehicles)&&data.vehicles.length){
      // A3状态守卫: 快照恢复走State.replaceVehicles(原地整体替换,保持const引用不变)
      State.replaceVehicles(data.vehicles);
      console.log('[持久化] 已恢复本地车辆数据:',VEHICLES.length,'条 (快照时间:'+(data.timestamp||'?')+')');
      return true;
    }
  }catch(e){
    console.warn('[持久化] 车辆数据读取失败(使用内置数据):',e.message||e);
  }
  return false;
}

/**
 * V10.4.0 问题2: 标记视频为已播放
 * 需求: "标记播放过的视频并缓存,清理缓存时索引标记过的缓存视频"——
 * 缓存管理列表中,播放过的视频带「已播放」徽标,与未播放缓存区分。
 * 设计:
 *  - 播放≥3秒或播放结束(ended)时标记(误触秒关不计入);
 *  - 状态写入索引meta(localStorage),文件系统扫描时作为展示元数据带出;
 *  - 视频尚未落盘完成时(流式播放中)也允许登记——cacheSaveBlob落盘时
 *    会合并已有meta,played标记不丢失;
 *  - 重复标记幂等(已标记直接跳过,避免高频timeupdate写穿localStorage)。
 * @param {string} fileName - 视频文件名(原始名,内部做安全名归一)
 */
function markVideoAsPlayed(fileName){
  if(!fileName)return false;
  try{
    const idx=_cacheIndexLoad();
    const safeName=String(fileName).replace(/[\/\\:*?"<>|]/g,'_');
    const entry=idx.videos[safeName];
    if(entry){
      if(entry.meta&&entry.meta.played)return false; // 已标记,幂等
      entry.meta=Object.assign({},entry.meta,{played:true,lastPlayed:Date.now()});
    }else{
      // 文件尚未落盘(流式播放中): 先登记占位,落盘时meta会带上played
      idx.videos[safeName]={size:0,ts:Date.now(),meta:{played:true,lastPlayed:Date.now()}};
    }
    _cacheIndexSave(idx);
    console.log('[视频]已标记为已播放:',safeName);
    return true;
  }catch(e){return false;} // 索引异常不影响播放主流程
}

/**
 * 从URL抓取内容落盘到缓存(流式播放成功后的异步预缓存)
 * 真机优先cordova http(无CORS限制),浏览器回退fetch(GitHub Release/jsDelivr均带CORS头)
 * @param {string} url - 源地址
 * @param {string} fileName - 目标文件名
 * @returns {Promise<string|null>} 落盘URL或null
 */
async function cacheUrlToDisk(url,fileName){
  try{
    if(!window.cordova)return null; // 浏览器调试环境无持久目录,跳过
    let blob=null;
    if(window.cordova.plugin&&window.cordova.plugin.http){
      blob=await new Promise((resolve,reject)=>{
        window.cordova.plugin.http.sendRequest(url,{method:'GET',responseType:'blob',timeout:120},
          res=>resolve(asBlob(res.data,'video/mp4')),err=>reject(new Error(String(err.error||'抓取失败'))));
      });
    }else{
      const r=await fetch(url);
      if(!r.ok)throw new Error('HTTP '+r.status);
      blob=await r.blob();
    }
    return await cacheSaveBlob(CACHE_DIR_VIDEOS,fileName,blob);
  }catch(e){
    console.warn('[缓存]URL预缓存失败(不影响播放):',fileName,e.message||e);
    return null;
  }
}

/**
 * 统计全部缓存总大小(缓存管理入口提示用)
 * @returns {Promise<number>} 字节数
 */
async function cacheTotalSize(){
  const [videos,docs]=await Promise.all([cacheList(CACHE_DIR_VIDEOS),cacheList(CACHE_DIR_DOCS)]);
  return videos.concat(docs).reduce((s,f)=>s+f.size,0);
}

/** 字节数格式化(B/KB/MB/GB) */
function cacheSizeText(bytes){
  if(!bytes||bytes<1024)return bytes+' B';
  if(bytes<1048576)return (bytes/1024).toFixed(1)+' KB';
  if(bytes<1073741824)return (bytes/1048576).toFixed(1)+' MB';
  return (bytes/1073741824).toFixed(2)+' GB';
}

/**
 * 列出飞书文件夹全部文件(自动翻页聚合) - 分页缺陷修复
 * 根因: files接口分页字段为next_page_token(而非page_token), 目录超过200项时
 *       单页请求会静默截断——视频分片/云端图片/备份/审批文件漏读, 同名幂等删除也会漏删旧档。
 *       (数据区vehicle_videos已156项, 逼近上限, 此修复为必要兜底)
 * @param {string} token - tenant_access_token
 * @param {string} folderToken - 文件夹token
 * @returns {Promise<Array|null>} 全量文件数组; 任一页请求失败返回null(由调用方兜底)
 */
async function feishuListFiles(token,folderToken){
  const all=[];
  let pageToken='';
  for(let page=0;page<50;page++){ // 上限50页(约1万项)防御异常翻页死循环
    let url=`https://open.feishu.cn/open-apis/drive/v1/files?folder_token=${folderToken}&page_size=200`;
    if(pageToken)url+='&page_token='+encodeURIComponent(pageToken);
    const res=await httpFetch(url,{method:'GET',headers:{Authorization:'Bearer '+token}});
    let data;
    try{data=typeof res==='string'?JSON.parse(res):res;}catch(e){return null;}
    if(!data||data.code!==0)return null;
    const d=data.data||{};
    all.push(...(d.files||[]));
    pageToken=d.next_page_token||'';
    if(!d.has_more||!pageToken)break;
  }
  return all;
}

/**
 * 获取APP数据文件夹token - 懒加载并缓存
 * 优先读localStorage缓存;无缓存时在项目根目录下按名称查找子文件夹,不存在则创建
 * V5.7: 支持forceRefresh强制刷新——换飞书应用/云端文件夹重建后,旧缓存token会
 *       因新应用无权限而403,导致"数据文件夹不可用"且永远无法自愈;
 *       所有数据操作失败时自动失效缓存重试一次,形成自愈闭环。
 * @param {string} token - 飞书tenant_access_token
 * @param {boolean} [forceRefresh] - 忽略缓存强制重新定位
 * @returns {Promise<string>} 数据文件夹的folder_token
 */
async function getDataFolderToken(token,forceRefresh){
  if(forceRefresh)localStorage.removeItem('tcg_data_folder');
  const cached=localStorage.getItem('tcg_data_folder');
  if(cached)return cached;
  const cfg=getFeishuCfg();
  const folders=(await feishuListFiles(token,cfg.folder)||[]).filter(f=>f.type==='folder'&&f.name===cfg.dataFolder);
  let folderToken=null;
  if(folders.length>0){
    folderToken=folders[0].token;
  }else{
    const createRes=await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({name:cfg.dataFolder,folder_token:cfg.folder})
    });
    const createData=typeof createRes==='string'?JSON.parse(createRes):createRes;
    if(createData.code!==0)throw new Error('创建数据文件夹失败:'+(createData.msg||''));
    folderToken=(createData.data||{}).token;
  }
  if(folderToken)localStorage.setItem('tcg_data_folder',folderToken);
  return folderToken;
}

/**
 * 获取/创建"APP数据备份"下的分类子文件夹 - V5.7数据分仓
 * 注册申请/审批结果/同步数据/备份文件各自独立子文件夹,云端结构清晰可维护
 * @param {string} token - tenant_access_token
 * @param {string} subName - 子文件夹名称
 * @returns {Promise<string>} 子文件夹token
 */
async function getDataSubFolderToken(token,subName){
  const cacheKey='tcg_sub_'+subName;
  const cached=localStorage.getItem(cacheKey);
  if(cached)return cached;
  const parent=await getDataFolderToken(token);
  const folders=(await feishuListFiles(token,parent)||[]).filter(f=>f.type==='folder'&&f.name===subName);
  let subToken=null;
  if(folders.length>0){
    subToken=folders[0].token;
  }else{
    const createRes=await httpFetch('https://open.feishu.cn/open-apis/drive/v1/files/create_folder',{
      method:'POST',
      headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
      body:JSON.stringify({name:subName,folder_token:parent})
    });
    const createData=typeof createRes==='string'?JSON.parse(createRes):createRes;
    if(createData.code!==0)throw new Error('创建子文件夹失败:'+subName+' '+(createData.msg||''));
    subToken=(createData.data||{}).token;
  }
  if(subToken)localStorage.setItem(cacheKey,subToken);
  return subToken;
}

/**
 * 失效全部数据区文件夹缓存(自愈重试前调用)
 */
function invalidateDataFolderCache(){
  localStorage.removeItem('tcg_data_folder');
  // V10.6.0: vehicle_images(照片分离上传目录)纳入缓存失效清单
  // V10.9.0: vehicle_videos(视频分离上传目录)纳入缓存失效清单
  ['同步数据','注册申请','审批结果','备份文件','vehicle_images','vehicle_videos'].forEach(n=>localStorage.removeItem('tcg_sub_'+n));
}

// ===================== APP VERSION & UPDATE =====================
const APP_VERSION='10.15.2';
const GITHUB_REPO='361087210/taicanggang-poweroff-guide';
const GITHUB_BRANCH='main';
const UPDATE_SOURCES=[
  `https://cdn.jsdelivr.net/gh/${GITHUB_REPO}@${GITHUB_BRANCH}/version.json`,
  `https://raw.githubusercontent.com/${GITHUB_REPO}/${GITHUB_BRANCH}/version.json`
];
const UPDATE_API_SOURCE=`https://api.github.com/repos/${GITHUB_REPO}/contents/version.json?ref=${GITHUB_BRANCH}`;

/* ===================== 教学视频直链映射 (V5.3.5新增) =====================
 * 为什么存在: 23个真实断电教学视频已重组上传至GitHub Release(media-videos标签),
 * Release资产URL免鉴权可公网访问且支持HTTP Range —— video.src可直接流式播放,
 * 支持进度条拖动秒开, 体验远优于飞书云端"全量下载后才可播"的方案。
 * asset名为内容MD5前缀(规避GitHub资产名中文归一化冲突), 由同步工具生成。
 * 未在此映射中的视频(如组长后上传的新视频)自动走飞书云端回退链。
 */
const MEDIA_RELEASE_BASE=`https://github.com/${GITHUB_REPO}/releases/download/media-videos`;
const MEDIA_DIRECT_ASSETS={
  '上汽名爵_ZS_HS_EHS_PHEV_.mp4':'tcgv_104bb1ef84.mp4',
  '上汽名爵_赛博斯特.mp4':'tcgv_0267256ec1.mp4',
  '东风VIGO_VIGO_纳米06海外版__纳米06国内版.mp4':'tcgv_f543b57fde.mp4',
  '东风锐棋_RICH__RICH6.mp4':'tcgv_2390f2570f.mp4',
  '东风风度_帕拉丁_PALADIN_.mp4':'tcgv_dc3fd70d32.mp4',
  '吉利沃尔沃_S60.mp4':'tcgv_454b6bb506.mp4',
  '奇瑞欧萌达_欧萌达5.mp4':'tcgv_6f0841a530.mp4',
  '比亚迪元_元UP.mp4':'tcgv_22119c21b2.mp4',
  '比亚迪唐_ATTO8.mp4':'tcgv_1a4e8e380c.mp4',
  '比亚迪宋_宋PLUS_DM_I.mp4':'tcgv_c8f5274b15.mp4',
  '比亚迪海豚_低配.mp4':'tcgv_31d9a7e1f6.mp4',
  '比亚迪海豹_海豹DM_I.mp4':'tcgv_3cbf27c326.mp4',
  '比亚迪腾势_方程豹B5.mp4':'tcgv_e01aad92b9.mp4',
  '江淮E_JS1_4_E_JS1_4.mp4':'tcgv_3af4ec1480.mp4',
  '通用断电视频.mp4':'tcgv_b5fc668c92.mp4',
  '长安UNI__UNI_T.mp4':'tcgv_cea9e0e51f.mp4',
  '长安启源_CS55PLUS_2026款_.mp4':'tcgv_592deb3e23.mp4',
  '长安启源_EADO_PLUS.mp4':'tcgv_24411bae03.mp4',
  '长安悦翔_CS15_CS35MAX_CS75_CS55PLUS_2025款_.mp4':'tcgv_572084283f.mp4',
  '长安深蓝_G318.mp4':'tcgv_a93a5f2ac6.mp4',
  '长安深蓝_S7_S5.mp4':'tcgv_b1cd814e4b.mp4',
  '长安糯米_糯米.mp4':'tcgv_5f94195e59.mp4',
  '长安长安之星_小货车.mp4':'tcgv_3a9d541a72.mp4'
};

/**
 * 查询视频的GitHub Release直链(V5.3.5)
 * @param {string} fileName - 视频文件名(如"通用断电视频.mp4")
 * @returns {string|null} 直链URL, 未映射返回null走后续回退链
 */
function mediaDirectUrl(fileName){
  const asset=MEDIA_DIRECT_ASSETS[fileName];
  return asset?`${MEDIA_RELEASE_BASE}/${asset}`:null;
}

// HTML escape helper to prevent XSS
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}

// ===================== XSS 绊线 (V10.13 A3-4) =====================
/* 开发模式 innerHTML 注入绊线(P1-1 运行时守卫): 仅在非Cordova环境(浏览器预览/测试)
 * 生效, 生产APK零开销零行为差异。拦截明确风险的写入片段:
 *   - <script 标签注入
 *   - javascript: 伪协议
 * 注: onclick=/onerror= 为本应用117处内联事件的合法形态(如thumbImgError),
 * 无法与文件名注入区分, 不纳入绊线——该风险面已由V10.12 q3的用户字段全esc()覆盖,
 * 新增innerHTML路径需在评审时人工确认esc()。严格模式(window.__XSS_GUARD_STRICT__=true,
 * 供测试与安全审计用)直接抛错阻断写入, 默认仅console.warn留痕。 */
if(typeof window!=='undefined'&&!window.cordova&&!window.__innerHTMLGuardInstalled__){
  window.__innerHTMLGuardInstalled__=true;
  try{
    const _desc=Object.getOwnPropertyDescriptor(Element.prototype,'innerHTML');
    if(_desc&&_desc.set){
      const _risky=/<script[\s>]|javascript:/i;
      Object.defineProperty(Element.prototype,'innerHTML',{
        get:_desc.get,
        set:function(v){
          if(typeof v==='string'&&_risky.test(v)){
            const msg='[XSS绊线] innerHTML 写入含风险片段(确认是否漏esc()): '+String(v).slice(0,120);
            if(window.__XSS_GUARD_STRICT__){console.error(msg);throw new Error('innerHTML risky write blocked (strict mode)');}
            console.warn(msg);
          }
          _desc.set.call(this,v);
        },
        configurable:true,enumerable:_desc.enumerable
      });
    }
  }catch(e){/* 环境不支持描述符(极老WebView)则静默跳过,不影响功能 */}
}

// Add pinyin to each vehicle
VEHICLES.forEach(v=>{v.pinyin=getPinyin(v.display);});

// ===================== STATE =====================
