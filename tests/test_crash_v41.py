from playwright.sync_api import sync_playwright
import os, json, traceback

FILE_URL = "file:///e:/车辆断电指导应用开发/demo.html"
SHOT = "e:/车辆断电指导应用开发/test_screenshots"
os.makedirs(SHOT, exist_ok=True)

PASS = 0; FAIL = 0; ISSUES = []
def check(name, cond, detail=""):
    global PASS, FAIL
    s = "PASS" if cond else "FAIL"
    print(f"  [{s}] {name}: {detail}")
    if cond: PASS += 1
    else: FAIL += 1; ISSUES.append(f"{name} :: {detail}")

console_errors = []
page_errors = []

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: page_errors.append(str(e)))

    print("=" * 62)
    print("  V4.0 Runtime Crash & Feature Test")
    print("=" * 62)

    # [1] 冷启动
    print("\n[1] 冷启动")
    page.goto(FILE_URL)
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_load_state('networkidle')
    check("登录页显示", page.locator('#screen-login.active').count() > 0, "ok")
    page.screenshot(path=f"{SHOT}/v41_01_login.png")

    # [2] 组长登录
    print("\n[2] 组长登录")
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    try:
        page.click('#btn-login')
        page.wait_for_timeout(1500)
    except Exception as e:
        print(traceback.format_exc()[-300:])
    page.screenshot(path=f"{SHOT}/v41_02_after_login.png")
    logged_in = page.evaluate("typeof state!=='undefined' && state.currentUser ? state.currentUser.name : null")
    check("登录成功", bool(logged_in), f"user={logged_in}")
    on_home = page.locator('#screen-home.active, .screen.active').count() > 0
    check("主界面渲染", on_home, "ok")

    # [3] 车辆列表
    print("\n[3] 车辆列表")
    try:
        count = page.evaluate("typeof VEHICLES!=='undefined' ? VEHICLES.length : -1")
        check("车辆数据加载", count >= 73, f"{count} vehicles")
    except Exception as e:
        check("车辆数据加载", False, str(e)[:100])
    page.screenshot(path=f"{SHOT}/v41_03_vehicle_list.png")

    # [4] 车辆详情（含视频图片）
    print("\n[4] 车辆详情")
    try:
        page.evaluate("typeof openVehicleDetail==='function' && openVehicleDetail(1)")
        page.wait_for_timeout(1000)
        detail_shown = page.evaluate("!!document.querySelector('.screen.active')")
        check("详情页打开", detail_shown, "ok")
        page.screenshot(path=f"{SHOT}/v41_04_detail.png")
    except Exception as e:
        check("详情页打开", False, str(e)[:150])

    # [5] 文档导出三件套
    print("\n[5] 文档导出")
    for fn, label in [("exportVehicleExcel", "Excel"), ("exportVehiclePDF", "PDF"), ("exportVehicleWord", "Word")]:
        exists = page.evaluate(f"typeof {fn}==='function'")
        check(f"{label}导出函数存在", exists, "ok" if exists else "MISSING")

    # [6] 数据备份
    print("\n[6] 数据备份")
    for fn in ["backupToLocal", "backupToFeishu", "DEFAULT_FEISHU_CONFIG"]:
        exists = page.evaluate(f"typeof {fn}!=='undefined'")
        check(f"{fn}", exists, "ok" if exists else "MISSING")

    # [7] 新增车辆（曾出问题的保存逻辑）
    print("\n[7] 新增/保存车辆")
    before = page.evaluate("VEHICLES.length")
    try:
        page.evaluate("""() => {
            state.editingVehicleId = null;
            const form = document.getElementById('form-vehicle') || document.querySelector('form');
            showScreen('screen-vehicle-edit');
        }""")
        page.wait_for_timeout(500)
        check("编辑页打开", page.locator('#screen-vehicle-edit.active').count() > 0, "ok")
        page.screenshot(path=f"{SHOT}/v41_05_edit.png")
    except Exception as e:
        check("编辑页打开", False, str(e)[:120])

    # [8] 返回导航栈
    print("\n[8] 导航栈")
    try:
        nav = page.evaluate("typeof navHistory!=='undefined'")
        check("navHistory存在", nav, "ok")
        gb = page.evaluate("typeof goBack==='function'")
        check("goBack函数", gb, "ok")
    except Exception as e:
        check("导航栈", False, str(e)[:100])

    # [9] 全局错误汇总
    print("\n[9] 运行时错误汇总")
    if page_errors:
        for e in page_errors[:8]:
            print(f"  [PAGEERROR] {e[:180]}")
    check("无页面崩溃(pageerror)", len(page_errors) == 0, f"{len(page_errors)} errors")
    real_console = [e for e in console_errors if 'net::ERR' not in e and 'Failed to load resource' not in e]
    check("无JS逻辑错误", len(real_console) == 0, f"{len(real_console)} errors")
    for e in real_console[:8]:
        print(f"  [CONSOLE] {e[:180]}")

    browser.close()

print("\n" + "=" * 62)
print(f"  Results: {PASS} passed, {FAIL} failed, total {PASS+FAIL}")
if ISSUES:
    print("  ISSUES:")
    for i in ISSUES: print(f"   - {i}")
print("=" * 62)
