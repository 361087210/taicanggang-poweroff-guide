#!/usr/bin/env python3
"""
太仓港断电指导APP V5.2 自动化测试套件
重点: 原生社交分享(微信/QQ/钉钉) + V5.1核心功能回归
"""

import json
import re
from pathlib import Path

BASE_DIR = Path(__file__).parent.parent
DEMO_HTML = BASE_DIR / 'demo.html'
VEHICLES_JS = BASE_DIR / 'vehicles_data.js'
VERSION_JSON = BASE_DIR / 'version.json'
CONFIG_XML = BASE_DIR / 'config.xml'

passed = 0
failed = 0
errors = []

def test(name, condition, detail=''):
    global passed, failed
    if condition:
        passed += 1
        print(f'  [PASS] {name}')
    else:
        failed += 1
        errors.append(f'{name}: {detail}')
        print(f'  [FAIL] {name} - {detail}')

def get_html():
    with open(DEMO_HTML, 'r', encoding='utf-8') as f:
        return f.read()

def get_js():
    with open(VEHICLES_JS, 'r', encoding='utf-8') as f:
        return f.read()

print('\n' + '='*60)
print('太仓港断电指导APP V5.2 自动化测试')
print('='*60)

html = get_html()
js = get_js()

# ==================== 1. 原生社交分享(V5.2新增) ====================
print('\n--- 1. 原生社交分享(微信/QQ/钉钉) ---')

test('hasNativeShare检测函数存在',
     'function hasNativeShare' in html and 'socialsharing' in html,
     '缺少原生分享检测')

test('原生分享插件检测条件完整',
     "window.plugins.socialsharing" in html and "shareWithOptions" in html,
     '应检测plugins.socialsharing.shareWithOptions')

test('config.xml声明socialsharing插件',
     'cordova-plugin-x-socialsharing' in Path(CONFIG_XML).read_text(encoding='utf-8'),
     'config.xml应声明cordova-plugin-x-socialsharing')

test('blobToDataURL辅助函数存在',
     'function blobToDataURL' in html and 'readAsDataURL' in html,
     '缺少Blob转base64函数')

test('shareFile三级降级策略',
     html.count('navigator.canShare') >= 1 and 'URL.createObjectURL' in html,
     '应有Web Share API和下载兜底')

test('原生分享优先于Web Share API',
     html.find('hasNativeShare()') < html.find('navigator.canShare'),
     '原生分享应最先执行')

test('分享取消静默处理',
     "e==='canceled'" in html,
     '用户取消分享应静默返回')

test('分享docx MIME自动修正',
     "ext==='docx'" in html and 'wordprocessingml.document' in html,
     'docx分享应修正MIME类型')

test('分享xlsx MIME自动修正',
     "ext==='xlsx'" in html and 'spreadsheetml.sheet' in html,
     'xlsx分享应修正MIME类型')

test('分享pdf MIME自动修正',
     "ext==='pdf'" in html,
     'pdf分享应修正MIME类型')

test('deviceready等待机制',
     "addEventListener('deviceready'" in html,
     '原生插件未就绪时应等待deviceready')

test('等待机制有超时保护',
     'setTimeout' in html and '2000' in html,
     '等待deviceready应有2秒超时')

test('shareWithOptions文件分享调用',
     'files:[fileDataUrl]' in html,
     '应通过files参数分享文件')

test('详情页文本分享支持原生通道',
     'socialsharing.share(shareText' in html,
     'shareVehicleDetail应优先原生分享')

test('原生分享失败降级处理',
     '原生分享失败,降级到Web Share API' in html,
     '原生失败应有降级日志')

# ==================== 2. 数据导出回归 ====================
print('\n--- 2. 数据导出回归 ---')

test('html-docx-js CDN使用unpkg',
     'unpkg.com/html-docx-js' in html,
     '应使用unpkg CDN')

test('generateWord函数有降级逻辑',
     'htmlDocx.asBlob' in html and 'application/msword' in html,
     '缺少HTML Blob降级')

test('五种导出格式完整',
     all(f"fmt=== '{f}'" in html or f"format==='{f}'" in html or f"format === '{f}'" in html or f"format==='{f}'" in html for f in ['json','csv','excel','pdf','word']),
     '应支持json/csv/excel/pdf/word五种格式')

test('批量导出Word带扩展名识别',
     "mimeType.includes('msword')?'doc':'docx'" in html,
     '应按MIME识别doc/docx扩展名')

# ==================== 3. 导航与登录回归 ====================
print('\n--- 3. 导航与登录回归 ---')

test('goBack函数存在且有智能回退',
     'function goBack' in html and 'navHistory.pop' in html,
     '返回逻辑应从历史栈弹出')

test('登录会话持久化',
     "localStorage.setItem('tcg_session'" in html and 'function restoreSession' in html,
     '应保存会话到localStorage')

test('会话7天有效期',
     '7*24*60*60*1000' in html,
     '会话应有7天有效期')

test('doLogout清除会话',
     "localStorage.removeItem('tcg_session')" in html,
     '退出应清除会话')

# ==================== 4. 视频与飞书回归 ====================
print('\n--- 4. 视频与飞书回归 ---')

test('视频CDN回退',
     'cdn.jsdelivr.net/gh' in html and 'video.onerror' in html,
     '视频应有CDN回退')

test('closeVideoPlayer清理',
     "video.src=''" in html,
     '关闭播放器应清理src')

test('飞书Token获取重试',
     'async function getFeishuToken' in html and 'retries' in html,
     'Token获取应支持重试')

test('doSyncDownload智能合并',
     'async function doSyncDownload' in html and 'addedCount' in html and 'updatedCount' in html,
     '下载同步应区分新增和更新')

# ==================== 5. 版本与配置 ====================
print('\n--- 5. 版本与配置 ---')

test('demo.html版本号5.2.0',
     "APP_VERSION='5.2.0'" in html,
     '版本号应为5.2.0')

with open(CONFIG_XML, 'r', encoding='utf-8') as f:
    config = f.read()

test('config.xml版本号5.2',
     'version="5.2.0"' in config,
     'config.xml版本应为5.2.0')

with open(VERSION_JSON, 'r', encoding='utf-8') as f:
    ver = json.load(f)

test('version.json版本5.2.0',
     ver.get('version') == '5.2.0',
     f"当前: {ver.get('version')}")

test('version.json有更新日志',
     len(ver.get('changelog', [])) >= 5,
     '更新日志至少5条')

test('version.json APK地址指向V5.2',
     'V5.2' in ver.get('apkUrl', ''),
     'apkUrl应指向V5.2')

test('config.xml保留全部原有插件',
     all(p in config for p in ['cordova-plugin-camera','cordova-plugin-file','cordova-plugin-media-capture','cordova-plugin-statusbar','cordova-plugin-edge-to-edge']),
     '原有插件不应丢失')

# ==================== 6. 数据完整性 ====================
print('\n--- 6. 数据完整性 ---')

test('车辆数据条数>70',
     len(re.findall(r'\{\s*id:', js)) > 70 or js.count('videoPaths') > 100,
     '车辆数据应大于70条')

test('视频路径定义存在',
     'vehicle_videos/' in js,
     '应有视频路径')

# ==================== 结果 ====================
print('\n' + '='*60)
print(f'测试结果: {passed} 通过, {failed} 失败, 共 {passed+failed} 项')
print('='*60)

if failed:
    print('\n失败项详情:')
    for e in errors:
        print(f'  - {e}')
    exit(1)
else:
    print('\n所有测试通过!')
    exit(0)
