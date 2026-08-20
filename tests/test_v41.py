from playwright.sync_api import sync_playwright
import os, json

FILE_URL = "file:///e:/车辆断电指导应用开发/demo.html"
SCREENSHOT_DIR = "e:/车辆断电指导应用开发/test_screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

results = []
def check(name, cond, detail=""):
    status = "PASS" if cond else "FAIL"
    print(f"   [{status}] {name}: {detail}")
    results.append((name, bool(cond)))

VERSION_JSON_NEW = {
    "version": "4.2.0", "versionName": "V4.2", "date": "2026-08-21",
    "apkSize": "38MB",
    "changelog": ["新增检查更新功能", "修复飞书上传Bug", "性能优化"],
    "apkUrl": "https://github.com/361087210/taicanggang-poweroff-guide/releases/download/V4.2/app.apk",
    "pageUrl": "https://github.com/361087210/taicanggang-poweroff-guide/releases"
}
VERSION_JSON_SAME = {"version": "4.1.0", "versionName": "V4.1", "date": "2026-08-20",
    "changelog": ["x"], "apkUrl": "https://example.com/a.apk", "pageUrl": "https://example.com"}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width": 412, "height": 915})
    page = ctx.new_page()
    page_errors, console_errors = [], []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)

    print("=" * 60)
    print("  V4.1 Test: Crash Fix + Update Check + Feishu Upload")
    print("=" * 60)

    # [1] Load without crash
    print("\n[1] App loads without crash")
    page.goto(FILE_URL)
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.wait_for_timeout(3500)  # wait past silent auto-check (network will fail in test env -> silent)
    check("No page errors on load", len(page_errors) == 0, f"errors={page_errors[:3]}")
    check("Login screen active", page.locator('#screen-login.active').count() > 0, "shown")

    # [2] Version constant
    print("\n[2] Version infrastructure")
    v = page.evaluate("APP_VERSION")
    check("APP_VERSION constant", v == "4.1.0", f"v={v}")
    check("versionNewer works", page.evaluate("versionNewer('4.2.0','4.1.0') && !versionNewer('4.1.0','4.1.0') && !versionNewer('4.0.9','4.1.0') && versionNewer('4.1.1','4.1.0')"), "ok")
    check("Update functions exist", page.evaluate("typeof checkUpdate==='function' && typeof downloadUpdate==='function' && typeof skipUpdate==='function' && typeof openUpdatePage==='function' && typeof fetchUpdateInfo==='function'"), "all present")
    check("modal-update element", page.locator('#modal-update').count() > 0, "present")

    # [3] Login + my page update entry
    print("\n[3] Leader login & update menu entry")
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    check("Login success", page.locator('#screen-vehicles.active').count() > 0, "vehicles screen")
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(400)
    upd = page.locator('#update-current-ver')
    check("检查更新 menu item", upd.count() > 0, "present")
    check("Current version label", 'V4.1' in (upd.text_content() or ''), f"label={upd.text_content()}")
    page.screenshot(path=f"{SCREENSHOT_DIR}/v41_my_page.png")

    # [4] checkUpdate - newer version detected (mock network)
    print("\n[4] Update check: newer version available")
    def route_version(payload):
        def handler(route):
            route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
        return handler
    page.route("**/version.json*", route_version(VERSION_JSON_NEW))
    page.evaluate("checkUpdate(false)")
    page.wait_for_timeout(1200)
    check("Update modal shown", page.locator('#modal-update.show').count() > 0, "shown")
    title = page.locator('#update-title').text_content()
    check("Modal shows new version", 'V4.2' in (title or ''), f"title={title}")
    changelog_text = page.locator('#update-changelog').text_content()
    check("Changelog rendered", '检查更新功能' in (changelog_text or '') and '飞书上传Bug' in (changelog_text or ''), "items visible")
    size_text = page.locator('#update-size').text_content()
    check("APK size shown", '38MB' in (size_text or ''), f"size={size_text}")
    page.screenshot(path=f"{SCREENSHOT_DIR}/v41_update_modal.png")
    apk_url = page.evaluate("latestUpdateInfo && latestUpdateInfo.apkUrl")
    check("apkUrl captured", apk_url == VERSION_JSON_NEW["apkUrl"], "ok")

    # [5] skipUpdate stores preference
    print("\n[5] Skip update preference")
    page.evaluate("skipUpdate()")
    page.wait_for_timeout(300)
    check("Modal closed", page.locator('#modal-update.show').count() == 0, "closed")
    skipped = page.evaluate("localStorage.getItem('update_skipped_ver')")
    check("Skip version stored", skipped == "4.2.0", f"skipped={skipped}")
    # silent check respects skip
    page.evaluate("checkUpdate(true)")
    page.wait_for_timeout(800)
    check("Silent check respects skip", page.locator('#modal-update.show').count() == 0, "no modal")
    # manual check ignores skip
    page.evaluate("checkUpdate(false)")
    page.wait_for_timeout(800)
    check("Manual check ignores skip", page.locator('#modal-update.show').count() > 0, "modal shown")

    # [6] Same version -> latest toast
    print("\n[6] Update check: already latest")
    page.evaluate("closeModal('modal-update')")
    page.unroute("**/version.json*")
    page.route("**/version.json*", route_version(VERSION_JSON_SAME))
    page.evaluate("localStorage.removeItem('update_skipped_ver')")
    page.evaluate("checkUpdate(false)")
    page.wait_for_timeout(1000)
    toast = page.locator('#toast').text_content()
    check("Latest-version toast", '已是最新版本' in (toast or ''), f"toast={toast}")
    check("No modal on latest", page.locator('#modal-update.show').count() == 0, "no modal")

    # [7] Feishu upload fixes
    print("\n[7] Feishu upload fixes")
    src_upload = page.evaluate("uploadJsonToFeishu.toString()")
    check("uploadJsonToFeishu appends file", "append('file'" in src_upload, "file field present")
    src_backup = page.evaluate("doBackup.toString()")
    n_fname = src_backup.count("append('file_name'")
    check("doBackup no duplicate file_name", n_fname == 1, f"file_name count={n_fname}")
    check("doBackup appends file", "append('file'" in src_backup, "file field present")
    src_pending = page.evaluate("syncPendingToFeishu.toString()")
    check("syncPendingToFeishu appends file", "append('file'" in src_pending, "file field present")
    check("Real token function", "tenant_access_token" in page.evaluate("getFeishuToken.toString()"), "real API call")
    check("Real doSyncUpload", "uploadJsonToFeishu" in page.evaluate("doSyncUpload.toString()"), "uploads to cloud")
    check("Real doSyncDownload", "downloadJsonFromFeishu" in page.evaluate("doSyncDownload.toString()"), "downloads from cloud")

    # [8] Regression: core flows
    print("\n[8] Core regression")
    page.click('.nav-tab:has-text("车型")')
    page.wait_for_timeout(400)
    check("Vehicle list renders", page.locator('#vehicle-list-container > div').count() > 0, "items shown")
    cnt = page.locator('#vehicle-count-label').text_content()
    check("73 vehicles", '73' in (cnt or ''), f"count={cnt}")
    if page.locator('#btn-flat').count() > 0:
        page.click('#btn-flat')
        page.wait_for_timeout(400)
    page.locator('#vehicle-list-container > div').first.click()
    page.wait_for_timeout(500)
    check("Detail screen", page.locator('#screen-detail.active').count() > 0, "shown")
    check("Export functions exist", page.evaluate("typeof exportSingle==='function' || typeof exportData==='function'"), "present")
    page.evaluate("goBack()")
    page.wait_for_timeout(400)
    check("Back nav works", page.locator('#screen-vehicles.active').count() > 0, "vehicles screen")
    check("No page errors total", len(page_errors) == 0, f"errors={page_errors[:3]}")

    browser.close()

passed = sum(1 for _, c in results if c)
total = len(results)
print("\n" + "=" * 60)
print(f"  RESULT: {passed}/{total} passed")
if passed < total:
    print("  FAILED:")
    for name, c in results:
        if not c: print(f"   - {name}")
print("=" * 60)
exit(0 if passed == total else 1)
