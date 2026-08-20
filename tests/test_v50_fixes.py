from playwright.sync_api import sync_playwright
import os, json

FILE_URL = "file:///e:/车辆断电指导应用开发/demo.html"
SCREENSHOT_DIR = "e:/车辆断电指导应用开发/test_screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 412, "height": 915})
    results = []

    def check(name, cond, detail=""):
        status = "PASS" if cond else "FAIL"
        msg = f"   [{status}] {name}: {detail}"
        print(msg)
        results.append((name, cond))

    print("=" * 60)
    print("  V5.0 Fix Verification Test")
    print("=" * 60)

    # Setup: Load and login
    print("\n[Setup] Load app and login as leader")
    page.goto(FILE_URL)
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_load_state('networkidle')

    # Login as leader
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button[onclick="doLogin()"]')
    page.wait_for_timeout(1500)
    check("Leader logged in", page.locator('#screen-vehicles.active').count() > 0, "vehicles screen active")

    # [1] Vehicle detail - video display
    print("\n[1] Vehicle detail - video display")
    first_card = page.locator('[onclick*="openVehicleDetail"]').first
    if first_card.count() > 0:
        first_card.click()
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SCREENSHOT_DIR}/v50_01_detail.png")

        # Check if video element or video path is displayed
        video_elements = page.locator('video').count()
        video_text = page.locator('text=视频').count()
        check("Video section present", video_elements > 0 or video_text > 0, f"video elements: {video_elements}, text: {video_text}")
    else:
        check("Vehicle card found", False, "no card found")

    # Check vehicle data has videoPaths
    has_videoPaths = page.evaluate("VEHICLES.find(v=>v.id===1)?.videoPaths?.length > 0")
    check("Vehicle 1 has videoPaths", has_videoPaths, f"videoPaths: {page.evaluate('VEHICLES.find(v=>v.id===1)?.videoPaths')}")

    # [2] Edit vehicle - photos/videos display
    print("\n[2] Edit vehicle - existing photos/videos display")
    edit_btn = page.locator('#screen-detail button[onclick*="openEditVehicle"]')
    if edit_btn.count() > 0:
        edit_btn.first.click()
        page.wait_for_timeout(500)
        page.screenshot(path=f"{SCREENSHOT_DIR}/v50_02_edit.png")

        # Check if photo preview has items (look for img tags in edit area)
        photo_count = page.locator('#edit-photos img, .edit-photo-item, #photo-preview img').count()
        check("Photos shown in edit", photo_count > 0, f"photo items: {photo_count}")

        # Check loadEditMedia function
        loadEdit_source = page.evaluate("loadEditMedia.toString()")
        check("loadEditMedia has no data: filter", "p.startsWith('data:')" not in loadEdit_source, "filter removed")
        check("loadEditMedia maps photoPaths", "v.photoPaths.map" in loadEdit_source, "maps all paths")
    else:
        check("Edit button found", False, "no edit button found")

    # Go back to vehicles
    page.evaluate("showScreen('screen-vehicles')")
    page.wait_for_timeout(300)

    # [3] Data center - export library loading
    print("\n[3] Data center - export library availability")
    page.evaluate("showScreen('screen-data')")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v50_03_data.png")

    # Check if libraries are loaded
    has_xlsx = page.evaluate("typeof window.XLSX !== 'undefined'")
    has_jspdf = page.evaluate("typeof window.jspdf !== 'undefined'")
    has_htmlDocx = page.evaluate("typeof window.htmlDocx !== 'undefined'")
    check("XLSX loaded", has_xlsx, f"XLSX: {has_xlsx}")
    check("jsPDF loaded", has_jspdf, f"jspdf: {has_jspdf}")
    check("htmlDocx loaded", has_htmlDocx, f"htmlDocx: {has_htmlDocx}")

    # Check export functions exist
    has_exportData = page.evaluate("typeof exportData === 'function'")
    has_exportSingle = page.evaluate("typeof exportSingle === 'function'")
    has_generateWord = page.evaluate("typeof generateWord === 'function'")
    has_generatePDF = page.evaluate("typeof generatePDF === 'function'")
    has_generateExcel = page.evaluate("typeof generateExcel === 'function'")
    check("exportData function exists", has_exportData)
    check("exportSingle function exists", has_exportSingle)
    check("generateWord function exists", has_generateWord)
    check("generatePDF function exists", has_generatePDF)
    check("generateExcel function exists", has_generateExcel)

    # Check exportData has library checks
    exportData_source = page.evaluate("exportData.toString()")
    check("exportData checks XLSX", "window.XLSX" in exportData_source)
    check("exportData checks jsPDF", "window.jspdf" in exportData_source)
    check("exportData checks htmlDocx", "window.htmlDocx" in exportData_source)

    # [4] Data backup - history and config
    print("\n[4] Data backup - history and config")
    # Check backup UI elements
    backup_dest = page.locator('input[name="backup-dest"]').count()
    check("Backup destination radio exists", backup_dest > 0, f"count: {backup_dest}")

    backup_history_div = page.locator('#backup-history').count()
    check("Backup history div exists", backup_history_div > 0)

    # Check backup functions exist
    has_doBackup = page.evaluate("typeof doBackup === 'function'")
    has_addBackupHistory = page.evaluate("typeof addBackupHistory === 'function'")
    has_renderBackupHistory = page.evaluate("typeof renderBackupHistory === 'function'")
    check("doBackup function exists", has_doBackup)
    check("addBackupHistory function exists", has_addBackupHistory)
    check("renderBackupHistory function exists", has_renderBackupHistory)

    # Test backup history recording
    page.evaluate("addBackupHistory('local','test_backup.json',74,1024)")
    history = page.evaluate("JSON.parse(localStorage.getItem('backup_history')||'[]')")
    check("Backup history recorded", len(history) > 0 and history[0]['filename'] == 'test_backup.json', f"history: {len(history)} items")

    # Check if history is rendered
    page.evaluate("renderBackupHistory()")
    page.wait_for_timeout(200)
    history_html = page.locator('#backup-history').inner_html()
    check("Backup history rendered", '本地' in history_html, f"html length: {len(history_html)}")

    # Check doBackup uses saved config
    doBackup_source = page.evaluate("doBackup.toString()")
    check("doBackup reads saved config", "localStorage.getItem('feishu_config')" in doBackup_source, "uses saved config")
    check("doBackup FormData has file field", "formData.append('file'" in doBackup_source, "has file field")

    # [5] Data sync - export config
    print("\n[5] Data sync - export config")
    page.evaluate("showScreen('screen-sync')")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v50_04_sync.png")

    has_exportSyncConfig = page.evaluate("typeof exportSyncConfig === 'function'")
    check("exportSyncConfig function exists", has_exportSyncConfig)

    exportSync_source = page.evaluate("exportSyncConfig.toString()")
    check("exportSyncConfig reads saved config", "localStorage.getItem('feishu_config')" in exportSync_source, "uses saved config")
    check("exportSyncConfig exports vehicles", "vehicles" in exportSync_source, "exports vehicle data")

    # [6] Security and data integrity
    print("\n[6] Security and data integrity")
    has_esc = page.evaluate("typeof esc === 'function'")
    check("esc() XSS protection exists", has_esc)

    vehicle_count = page.evaluate("VEHICLES.length")
    check("VEHICLES count > 70", vehicle_count > 70, f"count: {vehicle_count}")

    vehicles_with_video = page.evaluate("VEHICLES.filter(v=>v.videoPaths&&v.videoPaths.length>0).length")
    check("Vehicles with videoPaths > 0", vehicles_with_video > 0, f"count: {vehicles_with_video}")

    vehicles_with_photos = page.evaluate("VEHICLES.filter(v=>v.photoPaths&&v.photoPaths.length>0).length")
    check("Vehicles with photoPaths > 0", vehicles_with_photos > 0, f"count: {vehicles_with_photos}")

    # [7] shareFile function
    print("\n[7] Share file function")
    share_source = page.evaluate("shareFile.toString()")
    check("shareFile uses navigator.canShare", "navigator.canShare" in share_source)
    check("shareFile uses navigator.share", "navigator.share" in share_source)
    check("shareFile is async", "async" in share_source or "await" in share_source)

    # [8] generateWord includes photos and videos
    print("\n[8] Document generation includes media")
    word_source = page.evaluate("generateWord.toString()")
    check("generateWord includes photoPaths", "photoPaths" in word_source)
    check("generateWord includes videoPaths", "videoPaths" in word_source)
    check("generateWord returns blob", "asBlob" in word_source)

    pdf_source = page.evaluate("generatePDF.toString()")
    check("generatePDF includes photoPaths", "photoPaths" in pdf_source)
    check("generatePDF includes videoPaths", "videoPaths" in pdf_source)
    check("generatePDF returns blob", "output('blob')" in pdf_source or "output('blob')" in pdf_source)

    excel_source = page.evaluate("generateExcel.toString()")
    check("generateExcel includes photoPaths", "photoPaths" in excel_source)
    check("generateExcel includes videoPaths", "videoPaths" in excel_source)

    # Summary
    print("\n" + "=" * 60)
    passed = sum(1 for _, c in results if c)
    failed = sum(1 for _, c in results if not c)
    print(f"  Results: {passed} passed, {failed} failed, {len(results)} total")
    print("=" * 60)

    if failed > 0:
        print("\nFailed tests:")
        for name, cond in results:
            if not cond:
                print(f"  - {name}")

    browser.close()
