import json

with open(r"e:\车辆断电指导应用开发\docx_content\final_vehicles.json", "r", encoding="utf-8") as f:
    vehicles = json.load(f)

# Brand mapping
brand_ids = {
    "比亚迪": ("byd", "BYD"),
    "长安": ("changan", "Changan"),
    "上汽": ("saic", "SAIC"),
    "长城": ("gwm", "GWM"),
    "东风": ("dongfeng", "Dongfeng"),
    "江淮": ("jac", "JAC"),
    "吉利": ("geely", "Geely"),
    "奇瑞": ("chery", "Chery"),
    "东南": ("soueast", "Soueast"),
    "零跑": ("leapmotor", "Leapmotor"),
    "广汽": ("gac", "GAC"),
}

# Generate VEHICLES JavaScript array
lines = []
lines.append("// Vehicle data - 73 entries from 太仓港商品车断电操作手册20260603版")
lines.append("const VEHICLES=[")

for v in vehicles:
    brand_id, brand_en = brand_ids.get(v["brand"], ("other", ""))
    photos = v.get("photos", [])
    photo_count = len(photos)

    # Escape strings for JS
    def esc(s):
        return str(s).replace("\\", "\\\\").replace("'", "\\'").replace("\n", "\\n")

    steps = v.get("steps", [])
    if not steps:
        steps = ["打开主驾驶车门，确认全部车窗关闭，取出车钥匙"]

    key_frame = v.get("keyFrame", ["钥匙数量绑扎检查完"])
    key_container = v.get("keyContainer", ["车辆进箱无需收钥匙"])

    photos_js = "[" + ",".join(f"'{p}'" for p in photos) + "]"

    line = f"  {{id:{v['id']},brandId:'{brand_id}',brand:'{esc(v['brand'])}',series:'{esc(v['series'])}',config:'{esc(v['config'])}',display:'{esc(v['display'])}',powerType:'{esc(v['powerType'])}',size:'',position:'{esc(v['position'])}',steps:["
    line += ",".join(f"'{esc(s)}'" for s in steps)
    line += "],keyFrame:["
    line += ",".join(f"'{esc(s)}'" for s in key_frame)
    line += "],keyContainer:["
    line += ",".join(f"'{esc(s)}'" for s in key_container)
    line += f"],remarks:'{esc(v.get('remarks', ''))}',photos:{photo_count},photoPaths:{photos_js},videos:0}},".replace('"', '\\"')
    lines.append(line)

lines.append("];")

# Generate BRANDS array (add 东南)
brands_js = """const BRANDS=[
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
];"""

# Save to file
output = "// ===================== DATA =====================\n"
output += brands_js + "\n\n"
output += "\n".join(lines) + "\n"

with open(r"e:\车辆断电指导应用开发\docx_content\vehicles_js.txt", "w", encoding="utf-8") as f:
    f.write(output)

print(f"Generated {len(vehicles)} vehicle entries")
print("Output saved to vehicles_js.txt")
print(f"\nFirst 3 lines:")
for line in lines[:5]:
    print(line[:200])
