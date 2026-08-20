#!/usr/bin/env python3
"""
太仓港断电指导APP V5.1 自动化测试套件
覆盖所有修复点: 导出分享、导航、登录持久化、视频播放、飞书同步
"""

import json
import os
import re
import sys
import urllib.parse
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
print('太仓港断电指导APP V5.1 自动化测试')
print('='*60)

# ==================== 1. 数据导出分享功能 ====================
print('\n--- 1. 数据导出分享功能 ---')
html = get_html()

test('html-docx-js CDN使用unpkg',
     'unpkg.com/html-docx-js' in html,
     '应使用unpkg CDN')

test('htmlDocx降级方案存在',
     '_htmlDocxReady' in html and 'window._htmlDocxReady' in html,
     '缺少降级方案变量')

test('generateWord函数有降级逻辑',
     'htmlDocx.asBlob' in html and 'application/msword' in html,
     '缺少HTML Blob降级')

test('exportData不再直接return失败',
     '库加载失败，正在使用降级方案' in html,
     '应使用降级而非直接阻断')

test('exportSingle不再直接return失败',
     html.count('正在使用降级方案') >= 2,
     'exportSingle也应使用降级')

test('Word导出支持doc和docx两种格式',
     "mimeType.includes('msword')?'doc':'docx'" in html,
     '应根据MIME类型选择扩展名')

test('shareFile函数存在',
     'async function shareFile' in html,
     '缺少shareFile函数')

test('shareVehicleDetail函数存在',
     'async function shareVehicleDetail' in html,
     '缺少shareVehicleDetail函数')

test('CSV导出包含UTF-8 BOM',
     '\\uFEFF' in html,
     'CSV需要BOM头处理中文')

test('Excel导出使用SheetJS',
     'XLSX.utils.json_to_sheet' in html and 'XLSX.write' in html,
     'Excel导出应使用SheetJS')

test('PDF导出使用jsPDF',
     'new jsPDF' in html and 'doc.autoTable' in html,
     'PDF导出应使用jsPDF+autoTable')

# ==================== 2. 返回上一步导航逻辑 ====================
print('\n--- 2. 返回上一步导航逻辑 ---')

test('goBack函数存在',
     'function goBack()' in html,
     '缺少goBack函数')

test('navHistory变量存在',
     'navHistory' in html,
     '缺少导航历史栈')

test('goBack有智能回退逻辑',
     "screen==='screen-detail'" in html and "screen==='screen-sync'" in html,
     'goBack应根据当前页面智能返回')

test('主Tab页面清除历史栈',
     "navHistory=[]" in html,
     '主Tab应清除历史栈')

test('showScreen维护历史栈',
     'navHistory.push(state.screen)' in html,
     'showScreen应push当前页面到历史')

test('saveVehicle使用showScreen而非_activateScreen',
     html.count('showScreen(\'screen-detail\')') > 0 and
     '_activateScreen(\'screen-detail\')' not in html.split('function saveVehicle')[1].split('function ')[0] if 'function saveVehicle' in html else False,
     'saveVehicle应使用showScreen')

# ==================== 3. 登录状态持久化 ====================
print('\n--- 3. 登录状态持久化 ---')

test('doLogin保存会话到localStorage',
     "localStorage.setItem('tcg_session'" in html,
     '登录时应保存会话')

test('restoreSession函数存在',
     'function restoreSession()' in html,
     '缺少restoreSession函数')

test('会话有7天有效期',
     '7*24*60*60*1000' in html,
     '会话应设置有效期')

test('restoreSession验证用户状态',
     "user.status!=='active'" in html or "u.status!=='active'" in html,
     '应验证用户状态')

test('启动时检查会话',
     'if(restoreSession())' in html,
     '初始化时应检查会话')

test('doLogout清除会话',
     "localStorage.removeItem('tcg_session')" in html,
     '退出时应清除会话')

test('changePassword更新会话时间戳',
     "tcg_session" in html.split('function changePassword')[1].split('function ')[0] if 'function changePassword' in html else False,
     '修改密码后应更新会话')

# ==================== 4. 视频播放修复 ====================
print('\n--- 4. 视频播放修复 ---')

test('openVideoPlayer有错误处理',
     'video.onerror' in html,
     '视频播放器应有错误处理')

test('视频CDN回退到jsDelivr',
     'cdn.jsdelivr.net/gh' in html,
     '应回退到jsDelivr CDN')

test('closeVideoPlayer清理src',
     "video.src=''" in html,
     '关闭时应清理video src')

test('closeVideoPlayer清理错误提示',
     "querySelector('.video-error')" in html,
     '应清理视频错误提示')

test('视频加载成功有回调',
     'video.onloadeddata' in html,
     '应有视频加载成功回调')

test('视频播放器HTML存在',
     'id="video-element"' in html and 'id="video-player"' in html,
     '缺少视频播放器HTML')

test('视频支持倍速播放',
     'setVideoSpeed' in html and 'playbackRate' in html,
     '应支持倍速播放')

# ==================== 5. 飞书数据备份和同步 ====================
print('\n--- 5. 飞书数据备份和同步 ---')

test('getFeishuToken支持重试',
     'async function getFeishuToken(cfg,retries)' in html,
     'Token获取应支持重试')

test('uploadJsonToFeishu有重试逻辑',
     html.count('上传失败,重试') >= 1 or 'attempt<2' in html,
     '上传应有重试逻辑')

test('downloadJsonFromFeishu有重试逻辑',
     html.count('下载失败,重试') >= 1,
     '下载应有重试逻辑')

test('doSyncDownload智能合并',
     'addedCount' in html and 'updatedCount' in html,
     '同步应支持智能合并')

test('doSyncDownload区分新增和更新',
     '新增${addedCount}条' in html and '更新${updatedCount}条' in html,
     '应区分新增和更新数量')

test('doSyncDownload更新云版本显示',
     'sync-cloud-ver' in html,
     '应更新云端版本显示')

test('DEFAULT_FEISHU_CONFIG存在',
     'DEFAULT_FEISHU_CONFIG' in html,
     '缺少默认飞书配置')

test('飞书备份功能存在',
     'function doBackup()' in html,
     '缺少备份函数')

test('飞书同步上传存在',
     'function doSyncUpload()' in html,
     '缺少同步上传函数')

test('飞书Token获取URL正确',
     'open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' in html,
     'Token获取URL应正确')

test('飞书上传API URL正确',
     'open.feishu.cn/open-apis/drive/v1/files/upload_all' in html,
     '上传API URL应正确')

test('飞书下载API URL正确',
     'open.feishu.cn/open-apis/drive/v1/files' in html,
     '下载API URL应正确')

# ==================== 6. 数据完整性检查 ====================
print('\n--- 6. 数据完整性检查 ---')
js = get_js()

test('vehicles_data.js有BRANDS数组',
     'const BRANDS=' in js,
     '缺少品牌数据')

test('vehicles_data.js有VEHICLES数组',
     'const VEHICLES=' in js,
     '缺少车辆数据')

# 统计车辆数
vehicle_count = js.count('{id:')
test('车辆数据条数>70',
     vehicle_count > 70,
     f'车辆数: {vehicle_count}')

# 检查视频路径
video_paths = re.findall(r"videoPaths:\['([^']+)'\]", js)
test('有视频路径定义',
     len(video_paths) > 30,
     f'视频路径数: {len(video_paths)}')

test('视频路径使用vehicle_videos/前缀',
     all(v.startswith('vehicle_videos/') for v in video_paths),
     '视频路径应以vehicle_videos/开头')

# 检查图片路径(vehicles_data.js使用photos字段,demo.html使用photoPaths)
photo_paths = re.findall(r"photos:\['([^']+)'\]", js)
test('有照片路径定义',
     len(photo_paths) > 0,
     f'照片路径数: {len(photo_paths)}')

# ==================== 7. Cordova配置检查 ====================
print('\n--- 7. Cordova配置检查 ---')

with open(CONFIG_XML, 'r', encoding='utf-8') as f:
    config = f.read()

test('config.xml有相机权限',
     'android.permission.CAMERA' in config,
     '缺少相机权限')

test('config.xml有存储权限',
     'android.permission.READ_EXTERNAL_STORAGE' in config,
     '缺少存储权限')

test('config.xml有网络权限',
     'android.permission.INTERNET' in config,
     '缺少网络权限')

test('config.xml版本号为5.1',
     'version="5.1' in config,
     '版本号应更新')

test('config.xml允许所有域名访问',
     'access origin="*"' in config,
     '应允许所有域名')

test('config.xml有Cordova插件',
     'cordova-plugin-file' in config,
     '应包含file插件')

# ==================== 8. 版本信息检查 ====================
print('\n--- 8. 版本信息检查 ---')

with open(VERSION_JSON, 'r', encoding='utf-8') as f:
    version = json.load(f)

test('version.json有版本号',
     'version' in version,
     '缺少version字段')

test('version.json有更新日志',
     'changelog' in version and isinstance(version['changelog'], list),
     '缺少changelog')

test('version.json有APK下载地址',
     'apkUrl' in version,
     '缺少apkUrl')

test('version.json有飞书文件夹地址',
     'feishuFolder' in version,
     '缺少feishuFolder')

# ==================== 9. 安全性检查 ====================
print('\n--- 9. 安全性检查 ---')

test('有XSS防护esc函数',
     'function esc(s)' in html,
     '缺少XSS转义函数')

test('esc函数转义HTML特殊字符',
     '&amp;' in html and '&lt;' in html and '&gt;' in html and '&quot;' in html,
     'esc应转义所有HTML特殊字符')

test('会员列表使用esc转义',
     'esc(u.name)' in html and 'esc(u.phone)' in html,
     '会员列表应使用esc转义')

# ==================== 10. UI/UX检查 ====================
print('\n--- 10. UI/UX检查 ---')

test('使用Tailwind CSS',
     'cdn.tailwindcss.com' in html,
     '应使用Tailwind CSS')

test('有户外高对比度模式',
     'outdoor' in html and 'toggleOutdoorMode' in html,
     '缺少户外模式')

test('有Toast提示组件',
     'function showToast' in html,
     '缺少Toast函数')

test('有确认对话框',
     'function showConfirm' in html and 'function confirmAction' in html,
     '缺少确认对话框')

test('有底部导航栏',
     'bottom-nav' in html,
     '缺少底部导航')

test('有悬浮添加按钮(FAB)',
     'fab-add' in html,
     '缺少FAB按钮')

test('有照片查看器',
     'photo-viewer' in html,
     '缺少照片查看器')

test('有搜索功能',
     'handleSearch' in html and 'search-input' in html,
     '缺少搜索功能')

test('有品牌筛选',
     'renderBrandTags' in html,
     '缺少品牌筛选')

# ==================== 11. 应用更新检查 ====================
print('\n--- 11. 应用更新检查 ---')

test('有版本检查功能',
     'function checkUpdate' in html,
     '缺少版本检查')

test('有多源更新检测',
     'UPDATE_SOURCES' in html,
     '应有多更新源')

test('有GitHub API回退',
     'UPDATE_API_SOURCE' in html,
     '缺少GitHub API源')

test('有飞书回退检测更新',
     'downloadJsonFromFeishu(cfg,\'version.json\')' in html,
     '应从飞书获取版本信息')

test('有跳过版本功能',
     'update_skipped_ver' in html,
     '缺少跳过版本功能')

# ==================== 结果汇总 ====================
print('\n' + '='*60)
print(f'测试结果: {passed} 通过, {failed} 失败, 共 {passed+failed} 项')
print('='*60)

if failed > 0:
    print('\n失败项详情:')
    for e in errors:
        print(f'  - {e}')
    sys.exit(1)
else:
    print('\n所有测试通过!')
    sys.exit(0)
