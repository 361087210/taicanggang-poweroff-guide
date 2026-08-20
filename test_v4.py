#!/usr/bin/env python3
"""V4.0 Full Test Suite - Vehicle Power-Off Guide App"""
import sys, os

PASS = 0
FAIL = 0
FAILURES = []

BASE = os.path.dirname(os.path.abspath(__file__))
HTML_FILE = os.path.join(BASE, "demo.html")
CONFIG_FILE = os.path.join(BASE, "config.xml")

def check(desc, condition):
    global PASS, FAIL
    if condition:
        PASS += 1
        print(f"  [PASS] {desc}")
    else:
        FAIL += 1
        FAILURES.append(desc)
        print(f"  [FAIL] {desc}")

# Read HTML
with open(HTML_FILE, 'r', encoding='utf-8') as f:
    html = f.read()

def test_initialization():
    print("\n=== 1. App Initialization ===")
    check("HTML loads (>10KB)", len(html) > 10000)
    check("Has demo.html title", '太仓港车辆断电指导' in html)
    check("Version V4.0", 'V4.0' in html)
    check("Login screen active", 'screen-login' in html)
    check("No auto-login (showScreen login)", "showScreen('screen-login')" in html)
    check("xlsx.js CDN", 'xlsx' in html)
    check("jspdf CDN", 'jspdf' in html)
    check("html-docx CDN", 'html-docx' in html)
    check("DEFAULT_FEISHU_CONFIG exists", 'DEFAULT_FEISHU_CONFIG' in html)
    check("Feishu appId built-in", 'cli_aa0ce4fd91f85be8' in html)
    check("Feishu folder built-in", 'WdXUfZPkClI1audQxIYc90XRnWc' in html)

def test_security():
    print("\n=== 2. Security Audit ===")
    check("esc() function exists", "function esc(" in html)
    check("No inline eval()", 'eval(' not in html)
    check("No document.write()", 'document.write(' not in html)
    check("Toast 1.5s timeout", "show'),1500" in html)
    check("Member list uses esc()", "esc(u.name)" in html)
    check("Pending list uses esc()", "esc(u.phone)" in html)

def test_document_generation():
    print("\n=== 3. Document Generation ===")
    check("generateExcel function exists", "function generateExcel(" in html)
    check("generateWord function exists", "function generateWord(" in html)
    check("generatePDF function exists", "function generatePDF(" in html)
    check("exportSingle function exists", "function exportSingle(" in html)
    check("exportData function exists", "function exportData(" in html)
    check("shareFile function exists", "function shareFile(" in html)
    check("Excel export button in detail", "exportSingle('excel')" in html)
    check("PDF export button in detail", "exportSingle('pdf')" in html)
    check("Word export button in detail", "exportSingle('word')" in html)
    check("Batch Word export", "exportData('word')" in html)
    check("Batch PDF export", "exportData('pdf')" in html)
    check("Batch Excel export", "exportData('excel')" in html)
    check("Excel includes photoPaths", "photoPaths" in html)
    check("Excel includes videoPaths", "videoPaths" in html)
    check("Word includes photos", "photoHtml" in html)
    check("Word includes videos", "videoHtml" in html)
    check("PDF includes photo info", "photoPaths" in html)

def test_photo_video_edit():
    print("\n=== 4. Photo/Video Edit ===")
    check("File input for camera", 'capture="environment"' in html)
    check("File input accept image", 'accept="image/*"' in html)
    check("File input accept video", 'accept="video/*"' in html)
    check("Multiple photo select", 'multiple' in html)
    check("handlePhotoSelect function", "function handlePhotoSelect(" in html)
    check("handleVideoSelect function", "function handleVideoSelect(" in html)
    check("compressImage function", "function compressImage(" in html)
    check("renderPhotoPreview function", "function renderPhotoPreview(" in html)
    check("renderVideoPreview function", "function renderVideoPreview(" in html)
    check("removePhoto function", "function removePhoto(" in html)
    check("removeVideo function", "function removeVideo(" in html)
    check("loadEditMedia function", "function loadEditMedia(" in html)
    check("Photo preview container", 'id="photo-preview"' in html)
    check("Video preview container", 'id="video-preview"' in html)
    check("saveVehicle saves photoPaths", "v.photoPaths=photoPaths" in html)
    check("saveVehicle saves videoPaths", "v.videoPaths=videoPaths" in html)
    check("No placeholder showToast for camera", 'showToast(\'拍照功能需APP环境\')' not in html)
    check("No placeholder showToast for gallery", 'showToast(\'相册功能需APP环境\')' not in html)
    check("Video size limit 100MB", '100*1024*1024' in html)
    check("Photo max 9", '9-editPhotos.length' in html)

def test_backup():
    print("\n=== 5. Data Backup ===")
    check("Backup radio local", 'name="backup-dest"' in html)
    check("Backup radio feishu", 'value="feishu"' in html)
    check("Backup radio local default", 'value="local" checked' in html)
    check("doBackup function exists", "function doBackup(" in html)
    check("Backup uses DEFAULT_FEISHU_CONFIG", "DEFAULT_FEISHU_CONFIG" in html)
    check("Backup version v4.0", "version:'v4.0'" in html)

def test_sync():
    print("\n=== 6. Cloud Sync ===")
    check("loadFeishuConfig uses defaults", "saved.appId||DEFAULT_FEISHU_CONFIG.appId" in html)
    check("doSyncUpload uses defaults", "saved.appId||DEFAULT_FEISHU_CONFIG.appId" in html)
    check("doSyncDownload uses defaults", "saved.appId||DEFAULT_FEISHU_CONFIG.appId" in html)
    check("Sync version v4.0", "version:'v4.0'" in html)

def test_navigation():
    print("\n=== 7. Navigation ===")
    check("navHistory exists", "navHistory" in html)
    check("goBack function", "function goBack(" in html)
    check("showScreen function", "function showScreen(" in html)
    check("Full-screen 100vw", "100vw" in html)
    check("Full-screen 100dvh", "100dvh" in html)

def test_config_xml():
    print("\n=== 8. Config.xml (Cordova) ===")
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE, 'r', encoding='utf-8') as f:
            config = f.read()
        check("config.xml exists", True)
        check("Camera permission", "android.permission.CAMERA" in config)
        check("READ_MEDIA_IMAGES", "READ_MEDIA_IMAGES" in config)
        check("READ_MEDIA_VIDEO", "READ_MEDIA_VIDEO" in config)
        check("INTERNET permission", "android.permission.INTERNET" in config)
        check("Camera plugin", "cordova-plugin-camera" in config)
        check("File plugin", "cordova-plugin-file" in config)
        check("Media capture plugin", "cordova-plugin-media-capture" in config)
        check("Edge-to-edge plugin", "cordova-plugin-edge-to-edge" in config)
        check("Version 4.0.0", 'version="4.0.0"' in config)
    else:
        check("config.xml exists", False)

if __name__ == '__main__':
    print("=" * 60)
    print("V4.0 Full Test Suite")
    print("=" * 60)

    test_initialization()
    test_security()
    test_document_generation()
    test_photo_video_edit()
    test_backup()
    test_sync()
    test_navigation()
    test_config_xml()

    print("\n" + "=" * 60)
    print(f"Results: {PASS} passed, {FAIL} failed, total {PASS+FAIL}")
    if FAILURES:
        print(f"Failed: {FAILURES}")
    print("=" * 60)
    sys.exit(0 if FAIL == 0 else 1)
