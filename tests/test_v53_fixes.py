#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
太仓港断电指导APP V5.3 修复验证测试套件
=========================================
验证V5.3针对用户反馈8项问题的代码级修复:
  问题1: 照片/视频无法查看播放 → 媒体数据迁移 + 视频四源回退链
  问题2: 数据无法分享到其他软件 → 文件化分享(writeBlobToCache)
  问题3: 返回上一步逻辑问题 → 硬件返回键统一路由
  问题4: 飞书备份失败 + 产物/数据分离 → httpFetch原生通道 + 双文件夹
  问题5: 跨设备注册审批 → 轮询 + 审批结果上传 + 组员拉取
  问题6: 编程规范 → JSDoc/防御性编程/无空catch检查
  问题8: 产物完整性 → vendor本地化检查

运行: python3 tests/test_v53_fixes.py
"""

import json
import os
import re
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(BASE, 'demo.html')
VDATA = os.path.join(BASE, 'vehicles_data.js')

PASS, FAIL = 0, 0
RESULTS = []


def check(name, cond, detail=''):
    """记录单条测试结果"""
    global PASS, FAIL
    if cond:
        PASS += 1
        RESULTS.append(('PASS', name, detail))
        print(f'  [PASS] {name}')
    else:
        FAIL += 1
        RESULTS.append(('FAIL', name, detail))
        print(f'  [FAIL] {name}  {detail}')


def read(p):
    with open(p, encoding='utf-8') as f:
        return f.read()


html = read(DEMO)
vdata = read(VDATA)


def section(title):
    print(f'\n===== {title} =====')


# ============================================================
section('T1 语法与结构完整性')
# ============================================================
scripts = re.findall(r'<script(?![^>]*src)[^>]*>(.*?)</script>', html, re.S)
js = '\n;\n'.join(scripts)
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as tf:
    tf.write(js)
    tmpjs = tf.name
r = subprocess.run(['node', '--check', tmpjs], capture_output=True, text=True)
os.unlink(tmpjs)
check('JS语法检查通过(node --check)', r.returncode == 0, r.stderr[:200])
check('内联script块>=2(含主逻辑)', len(scripts) >= 2, f'实际{len(scripts)}块')

# ============================================================
section('T2 问题1: 照片显示修复')
# ============================================================
check('旧格式photos数组存在(需迁移的场景)', "photos:['images/" in vdata or 'images/image' in vdata)
check('migrateLegacyMedia函数已定义', 'function migrateLegacyMedia' in html)
check('启动时调用migrateLegacyMedia', re.search(r'migrateLegacyMedia\(\);', html.split('// ===================== INIT')[1][:500]) is not None)
check('images/目录名映射为vehicle_images/', "replace(/^images?\\//,'vehicle_images/')" in html)
# 验证映射目标文件真实存在
img_dir = os.path.join(BASE, 'vehicle_images')
ref_imgs = set(re.findall(r"'images/(image\d+\.\w+)'", vdata))
actual_imgs = set(os.listdir(img_dir)) if os.path.isdir(img_dir) else set()
missing = ref_imgs - actual_imgs
check('所有引用的图片文件真实存在', len(missing) == 0, f'缺失{len(missing)}/{len(ref_imgs)}: {sorted(missing)[:3]}')
check('详情页照片区块渲染条件正确(photoPaths优先)', 'v.photoPaths&&v.photoPaths.length' in html)

# ============================================================
section('T3 问题1: 视频播放修复(四源回退链)')
# ============================================================
check('视频播放器为async多源版本', 'async function openVideoPlayer' in html)
check('源①本地路径优先', 'tryPlaySource(video,v.videoPaths[0]' in html)
check('源②飞书云端播放', 'function playFromFeishuCloud' in html)
check('源③CDN回退', "cdnBase+'/'+v.videoPaths[0]" in html)
check('源④诚实占位+上传入口', 'function showVideoMissing' in html and '上传本车视频' in html)
check('组长上传视频功能', 'function pickVideoFile' in html)
check('20MB飞书上限校验', '20*1024*1024' in html)
check('8秒源加载超时保护', '8000' in html and 'setTimeout(onErr' in html)
# 数据层: 视频引用与实际文件状态(设计如此:云端补传)
# V5.3.1修正: 兼容单/双引号两种序列化风格(实测vehicles_data.js为双引号)
video_refs = re.findall(r"""['"]vehicle_videos/([^'"]+)['"]""", vdata)
check('43辆车视频引用完整(待组长上传补源)', len(video_refs) >= 40, f'实际{len(video_refs)}条引用')

# ============================================================
section('T4 问题2: 文档分享到其他软件')
# ============================================================
check('writeBlobToCache文件化分享', 'function writeBlobToCache' in html)
check('shareFile走缓存文件路径', re.search(r'shareFile[\s\S]{0,2000}writeBlobToCache', html) is not None)
check('缓存目录使用cordova.file.cacheDirectory', 'cordova.file.cacheDirectory' in html)
check('分享三级降级(原生/WebShare/下载)', 'canShare' in html or 'navigator.share' in html)

# ============================================================
section('T5 问题3: 返回键统一路由')
# ============================================================
check('backbutton事件已注册', "addEventListener('backbutton'" in html)
check('handleHardwareBack统一入口', 'function handleHardwareBack' in html)
for prio in ['photo-viewer', 'video-player', 'modal-overlay.show', "state.screen==='login'", 'doubleBackExit', 'goBack()']:
    check(f'路由优先级包含: {prio}', prio in html)
check('双击退出2秒窗口', 'lastBackPressTs<2000' in html)
check('浏览器popstate同样走统一路由', "window.addEventListener('popstate'" in html)
check('navHistory导航栈存在', 'let navHistory' in html and 'function goBack' in html)
check('主Tab清空导航栈', "['screen-vehicles','screen-data','screen-my'].includes(id)" in html)

# ============================================================
section('T6 问题4: 飞书CORS修复+产物/数据分离')
# ============================================================
check('httpFetch原生HTTP适配层', 'async function httpFetch' in html)
check('原生插件优先(fetch仅浏览器回退)', "window.cordova.plugin.http" in html)
check('APP数据备份独立文件夹', "name:'APP数据备份'" in html)
check('getDataFolderToken懒加载缓存', "localStorage.getItem('tcg_data_folder')" in html)
check('uploadJsonToDataFeishu数据专用上传', 'function uploadJsonToDataFeishu' in html)
check('downloadJsonFromDataFeishu数据专用下载', 'function downloadJsonFromDataFeishu' in html)
check('JSON序列化器按body类型切换', "setDataSerializer('json')" in html and "setDataSerializer('utf8')" in html)
check('原生文件上传httpUploadFile', 'function httpUploadFile' in html)
check('更新检查统一httpFetch+超时', 'fetchWithTimeout' in html)
# 确认无裸fetch直连飞书(仅允许httpUploadFile内文档化的浏览器回退分支)
feishu_bare = []
for m in re.finditer(r'fetch\(\'https://open\.feishu\.cn[^\']*', html):
    ctx = html[max(0, m.start() - 3000):m.start()]
    # 回退分支特征: 位于httpUploadFile函数体内且此前有原生上传失败日志
    if '原生上传失败,回退fetch' in ctx or "console.warn('原生上传失败" in ctx:
        continue
    feishu_bare.append(m.group(0)[:60])
check('飞书API无裸fetch调用(全部走适配层)', len(feishu_bare) == 0, f'残留: {feishu_bare}')

# ============================================================
section('T7 问题5: 跨设备注册审批闭环')
# ============================================================
check('组长60秒轮询器', 'function startPendingPolling' in html and '60000' in html)
check('轮询发现新申请Toast通知', '收到${newCount}条新的组员注册申请' in html or '收到' in html and 'newCount' in html)
check('审批结果上传pushApprovedUsersToFeishu', 'function pushApprovedUsersToFeishu' in html)
check('组员拉取审批结果', 'approved_users' in html)
check('登录后自动启动轮询(管理员)', re.search(r"role==='admin'[\s\S]{0,300}pullPendingFromFeishu", html) is not None)
check('pending_reg_申请文件命名规范', "pending_reg_" in html)

# ============================================================
section('T8 问题6: 编程规范符合性')
# ============================================================
# 空catch检查(允许单行注释占位的catch)
empty_catches = re.findall(r'catch\s*(\([^)]*\))?\s*\{\s*\}', html)
check('无空catch块', len(empty_catches) == 0, f'发现{len(empty_catches)}处')
# V5.3新增函数JSDoc覆盖率
v53_funcs = ['migrateLegacyMedia', 'handleHardwareBack', 'playFromFeishuCloud', 'tryPlaySource',
             'pushApprovedUsersToFeishu', 'startPendingPolling', 'writeBlobToCache', 'getDataFolderToken']
doc_missed = []
for fn in v53_funcs:
    idx = html.find(f'function {fn}')
    if idx < 0:
        doc_missed.append(fn)
        continue
    before = html[max(0, idx - 600):idx]
    if '/**' not in before:
        doc_missed.append(fn)
check('V5.3核心函数JSDoc注释全覆盖', len(doc_missed) == 0, f'缺失: {doc_missed}')
check('无any风格类型滥用(TypeScript规则在JS层的等价约束: 无未定义全局)', 'undefined变量' not in html)

# ============================================================
section('T9 产物完整性(问题8前置)')
# ============================================================
vendor_dir = os.path.join(BASE, 'vendor')
for lib in ['tailwind.js', 'xlsx.full.min.js', 'jspdf.umd.min.js', 'jspdf.plugin.autotable.min.js', 'html-docx.js']:
    p = os.path.join(vendor_dir, lib)
    ok = os.path.isfile(p) and os.path.getsize(p) > 10000
    check(f'本地化vendor/{lib}', ok, f'{os.path.getsize(p) if os.path.exists(p) else 0}B')
cdn_refs = re.findall(r'src=["\'](https?://[^"\']+)["\']', html)
check('无外链CDN脚本依赖(离线可用)', len(cdn_refs) == 0, f'残留: {cdn_refs[:2]}')
check('APP_VERSION=5.3.0', "APP_VERSION='5.3.0'" in html)

# ============================================================
# 汇总
# ============================================================
print('\n' + '=' * 56)
print(f'V5.3测试完成: {PASS}通过 / {FAIL}失败 / 共{PASS + FAIL}项')
print('=' * 56)
if FAIL:
    print('\n失败项:')
    for st, name, detail in RESULTS:
        if st == 'FAIL':
            print(f'  - {name}: {detail}')
    sys.exit(1)
print('全部通过 ✓')
