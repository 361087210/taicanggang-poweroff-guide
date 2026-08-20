from playwright.sync_api import sync_playwright
import os

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
    print("  V3.1 Full Feature Test")
    print("=" * 60)

    # [1] Fresh start - login screen
    print("\n[1] Fresh start - login screen")
    page.goto(FILE_URL)
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.screenshot(path=f"{SCREENSHOT_DIR}/v31_01_fresh.png")
    check("Login screen visible", page.locator('#screen-login.active').count() > 0, "shown")

    phone_val = page.locator('#login-phone').input_value() if page.locator('#login-phone').count() > 0 else ''
    pass_val = page.locator('#login-pass').input_value() if page.locator('#login-pass').count() > 0 else ''
    check("Login form empty", phone_val == '' and pass_val == '', f"phone='{phone_val}', pass='{pass_val}'")

    # Check no phone-frame black border (full screen)
    frame_style = page.evaluate("getComputedStyle(document.querySelector('.phone-frame'))")
    check("No black border", frame_style.get('background-color') != 'rgb(15, 15, 26)', f"bg={frame_style.get('background-color','?')}")
    check("Full viewport width", frame_style.get('width','') == '412px', f"w={frame_style.get('width','?')} (viewport=412)")

    # Check no phone-notch element
    notch_count = page.locator('.phone-notch').count()
    check("No phone notch", notch_count == 0, f"notch elements: {notch_count}")

    # Check no sync logs
    sync_logs = page.evaluate("localStorage.getItem('sync_logs')")
    check("No sync logs", sync_logs == '[]' or sync_logs is None, "clean")

    # [2] Leader login
    print("\n[2] Leader login")
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v31_02_leader.png")
    check("Leader login success", page.locator('#screen-vehicles.active').count() > 0, "vehicles screen")

    count = page.locator('#vehicle-count-label').text_content()
    check("Vehicle data loaded", "73" in count, f"count='{count}'")

    fab = page.locator('#fab-add').get_attribute('style')
    check("FAB visible for leader", 'flex' in (fab or ''), "shown")

    # [3] Navigation: detail -> back -> vehicles
    print("\n[3] Navigation: detail back to vehicles")
    page.click('#btn-flat')
    page.wait_for_timeout(300)
    page.locator('#vehicle-list-container > div').first.click()
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v31_03_detail.png")
    check("Detail screen", page.locator('#screen-detail.active').count() > 0, "shown")

    # Test back button
    page.evaluate('goBack()')
    page.wait_for_timeout(400)
    check("Back to vehicles", page.locator('#screen-vehicles.active').count() > 0, "back works")

    # [4] Navigation: data -> sync -> back -> data
    print("\n[4] Navigation: data -> sync -> back -> data")
    page.click('.nav-tab:has-text("数据")')
    page.wait_for_timeout(300)
    check("Data screen", page.locator('#screen-data.active').count() > 0, "shown")

    page.click('button:has-text("进入同步中心")')
    page.wait_for_timeout(300)
    check("Sync screen", page.locator('#screen-sync.active').count() > 0, "shown")

    page.evaluate('goBack()')
    page.wait_for_timeout(300)
    check("Back to data screen", page.locator('#screen-data.active').count() > 0, "back to data, not my")

    # [5] Navigation: my -> members -> back -> my
    print("\n[5] Navigation: my -> members -> back -> my")
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    page.click('#menu-members')
    page.wait_for_timeout(300)
    check("Members screen", page.locator('#screen-members.active').count() > 0, "shown")

    page.evaluate('goBack()')
    page.wait_for_timeout(300)
    check("Back to my screen", page.locator('#screen-my.active').count() > 0, "back to my")

    # [6] Navigation: my -> password -> back -> my
    print("\n[6] Navigation: my -> password -> back -> my")
    page.evaluate("showScreen('screen-password')")
    page.wait_for_timeout(300)
    check("Password screen", page.locator('#screen-password.active').count() > 0, "shown")

    page.evaluate('goBack()')
    page.wait_for_timeout(300)
    check("Back to my screen from password", page.locator('#screen-my.active').count() > 0, "back to my")

    # [7] Vehicle detail: share button exists
    print("\n[7] Vehicle detail: share and edit/delete buttons")
    page.click('.nav-tab:has-text("车型")')
    page.wait_for_timeout(300)
    page.click('#btn-flat')
    page.wait_for_timeout(300)
    page.locator('#vehicle-list-container > div').first.click()
    page.wait_for_timeout(400)
    share_btn = page.locator('button:has-text("分享")').count()
    check("Share button exists", share_btn > 0, f"found {share_btn}")

    edit_btn = page.locator('button:has-text("编辑")').count()
    check("Edit button exists (leader)", edit_btn > 0, f"found {edit_btn}")

    delete_btn = page.locator('button:has-text("删除")').count()
    check("Delete button exists (leader)", delete_btn > 0, f"found {delete_btn}")

    # [8] Prev/next vehicle navigation (no history pollution)
    print("\n[8] Prev/next vehicle")
    page.evaluate('nextVehicle()')
    page.wait_for_timeout(300)
    check("Next vehicle works", page.locator('#screen-detail.active').count() > 0, "still on detail")

    page.evaluate('prevVehicle()')
    page.wait_for_timeout(300)
    check("Prev vehicle works", page.locator('#screen-detail.active').count() > 0, "still on detail")

    # Back should go directly to vehicles (not multiple detail screens)
    page.evaluate('goBack()')
    page.wait_for_timeout(300)
    check("Back from detail to vehicles", page.locator('#screen-vehicles.active').count() > 0, "single back to vehicles")

    # [9] Side menu dynamic user info
    print("\n[9] Side menu dynamic info")
    page.evaluate('openSideMenu()')
    page.wait_for_timeout(300)
    side_phone = page.locator('#side-phone').text_content()
    check("Side menu shows phone", '17602554481' in side_phone, f"phone='{side_phone}'")
    page.evaluate("closeModal('modal-side-menu')")

    # [10] Device info dynamic
    print("\n[10] Device info dynamic")
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    dev_screen = page.locator('#dev-screen').text_content()
    check("Device screen size", dev_screen != '-' and ('x' in dev_screen.lower() or '×' in dev_screen), f"size='{dev_screen}'")
    dev_platform = page.locator('#dev-platform').text_content()
    check("Device platform", dev_platform != '-', f"platform='{dev_platform}'")

    # [11] Toast auto-hide
    print("\n[11] Toast behavior")
    page.evaluate('showToast("test message")')
    page.wait_for_timeout(100)
    toast_visible = page.locator('#toast.show').count() > 0
    check("Toast shows", toast_visible, "visible")
    page.wait_for_timeout(2500)
    toast_hidden = page.locator('#toast.show').count() == 0
    check("Toast auto-hides", toast_hidden, "hidden after 2s")

    # [12] Sync log shows empty on first use
    print("\n[12] Sync log empty state")
    page.click('.nav-tab:has-text("数据")')
    page.wait_for_timeout(300)
    page.click('button:has-text("进入同步中心")')
    page.wait_for_timeout(300)
    sync_log_text = page.locator('#sync-log-list').text_content()
    check("Sync log shows empty", '暂无同步记录' in sync_log_text, f"text='{sync_log_text[:50]}'")

    # Sync status shows gray "未同步"
    sync_status = page.locator('#sync-status-text').text_content()
    check("Sync status gray", '未同步' in sync_status, f"status='{sync_status}'")
    status_class = page.locator('#sync-status-text').get_attribute('class')
    check("Sync status gray color", 'gray' in (status_class or ''), f"class='{status_class}'")

    print("\n" + "=" * 60)
    passed = sum(1 for _, c in results if c)
    total = len(results)
    print(f"  Result: {passed}/{total} passed")
    print("=" * 60)
    if passed == total:
        print("  ALL TESTS PASSED!")
    else:
        failed = [n for n, c in results if not c]
        print(f"  FAILED: {', '.join(failed)}")
    print("=" * 60)

    browser.close()
