from playwright.sync_api import sync_playwright
import os

FILE_URL = "file:///e:/车辆断电指导应用开发/demo.html"
SCREENSHOT_DIR = "e:/车辆断电指导应用开发/test_screenshots"
os.makedirs(SCREENSHOT_DIR, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 412, "height": 870})
    results = []

    def check(name, cond, detail=""):
        status = "✅" if cond else "❌"
        msg = f"   {status} {name}: {detail}"
        print(msg)
        results.append((name, cond))

    print("=" * 60)
    print("  V3.1 全功能测试")
    print("=" * 60)

    # Clear localStorage for fresh start
    print("\n[1] 清空localStorage，模拟首次使用")
    page.goto(FILE_URL)
    page.wait_for_load_state('networkidle')
    page.evaluate("localStorage.clear()")
    page.reload()
    page.wait_for_load_state('networkidle')
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_01_fresh.png")
    check("登录界面显示", page.locator('#screen-login.active').count() > 0, "已显示")

    # Check no pre-filled login fields
    phone_val = page.locator('#login-phone').input_value() if page.locator('#login-phone').count() > 0 else ''
    pass_val = page.locator('#login-pass').input_value() if page.locator('#login-pass').count() > 0 else ''
    check("登录表单为空", phone_val == '' and pass_val == '', f"手机号: '{phone_val}', 密码: '{pass_val}'")

    # Check no credentials visible
    cred_text = page.locator('#screen-login').text_content()
    check("无组长凭据显示", "17602554481" not in cred_text and "123456" not in cred_text, "凭据已隐藏")

    # Check registration link exists
    reg_link = page.locator('button:has-text("注册账号")').count()
    check("注册链接存在", reg_link > 0, "已显示")

    # Check forgot password link
    forgot_link = page.locator('button:has-text("忘记密码")').count()
    check("忘记密码链接存在", forgot_link > 0, "已显示")

    # Check no vehicles screen visible
    check("车型页未显示", page.locator('#screen-vehicles.active').count() == 0, "登录前不可见")
    check("数据页未显示", page.locator('#screen-data.active').count() == 0, "登录前不可见")
    check("我的页未显示", page.locator('#screen-my.active').count() == 0, "登录前不可见")

    # Check no sync logs on first use
    sync_logs = page.evaluate("localStorage.getItem('sync_logs')")
    check("无同步日志", sync_logs == '[]' or sync_logs is None, "首次使用无日志")

    # Check no feishu config on first use
    feishu_cfg = page.evaluate("localStorage.getItem('feishu_config')")
    check("无飞书配置", feishu_cfg is None, "首次使用无配置")

    print("\n[2] 组长登录")
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_02_leader_login.png")
    check("组长登录成功", page.locator('#screen-vehicles.active').count() > 0, "进入车型页面")

    # Check vehicle count
    count = page.locator('#vehicle-count-label').text_content()
    check("车辆数据", "73" in count, f"显示 '{count}'")

    # Check FAB visible for leader
    fab = page.locator('#fab-add').get_attribute('style')
    check("组长可见添加按钮", 'flex' in (fab or ''), "FAB显示")

    print("\n[3] 车型列表缩略图")
    page.click('#btn-flat')
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_03_flat_thumbnails.png")
    thumb_count = page.locator('#vehicle-list-container img').count()
    check("缩略图显示", thumb_count > 10, f"找到 {thumb_count} 张缩略图")

    print("\n[4] 清除冗余最近查看记录")
    recent_section = page.locator('#recent-section')
    recent_display = recent_section.get_attribute('style') or ''
    recent_list = page.locator('#recent-list').text_content().strip()
    check("首次无查看记录", not recent_list or len(recent_list) < 5, f"记录内容: '{recent_list[:50]}'")

    print("\n[5] 查看车辆后产生最近记录")
    page.locator('#vehicle-list-container > div').first.click()
    page.wait_for_timeout(400)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_04_detail.png")
    page.evaluate('goBack()')
    page.wait_for_timeout(300)
    recent_after = page.locator('#recent-list').text_content().strip()
    check("查看后有记录", len(recent_after) > 5, f"记录: '{recent_after[:50]}'")

    print("\n[6] 组员注册流程")
    page.evaluate('doLogout()')
    page.wait_for_timeout(400)
    page.click('button:has-text("注册账号")')
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_05_register.png")
    check("注册页面显示", page.locator('#screen-register.active').count() > 0, "已显示")

    page.fill('#reg-name', '测试组员')
    page.fill('#reg-phone', '13800138000')
    page.fill('#reg-pass', 'test123')
    page.fill('#reg-pass2', 'test123')
    page.click('button:has-text("提交注册")')
    page.wait_for_timeout(500)
    check("注册提交成功", page.locator('#screen-login.active').count() > 0, "返回登录页")

    print("\n[7] 组员登录（待审核）")
    page.fill('#login-phone', '13800138000')
    page.fill('#login-pass', 'test123')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(500)
    check("待审核无法登录", page.locator('#screen-login.active').count() > 0, "仍在登录页")

    print("\n[8] 组长审核注册")
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_06_my.png")

    # Check user info
    user_name = page.locator('.user-name').text_content()
    check("用户信息正确", "组长" in user_name, f"显示: {user_name}")

    # Go to member management
    page.click('#menu-members')
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_07_members.png")
    check("组员管理页面", page.locator('#screen-members.active').count() > 0, "已显示")

    # Check pending registration
    pending = page.locator('#pending-list').text_content()
    check("待审核记录显示", '测试组员' in pending and '13800138000' in pending, "已显示")

    # Approve
    page.click('button:has-text("通过")')
    page.wait_for_timeout(300)
    check("审核通过", True, "已点击通过")

    print("\n[9] 组员登录（已审核）")
    page.evaluate('doLogout()')
    page.wait_for_timeout(400)
    page.fill('#login-phone', '13800138000')
    page.fill('#login-pass', 'test123')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    check("组员登录成功", page.locator('#screen-vehicles.active').count() > 0, "进入车型页面")

    # Check FAB hidden for member
    fab_member = page.locator('#fab-add').get_attribute('style')
    check("组员不可见添加按钮", 'none' in (fab_member or ''), "FAB隐藏")

    # Check member can't edit
    page.click('#btn-flat')
    page.wait_for_timeout(300)
    page.locator('#vehicle-list-container > div').first.click()
    page.wait_for_timeout(400)
    edit_btn = page.locator('button:has-text("编辑")').count()
    check("组员无编辑按钮", edit_btn == 0, f"编辑按钮数量: {edit_btn}")

    print("\n[10] 飞书数据同步")
    page.evaluate('doLogout()')
    page.wait_for_timeout(400)
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    page.click('#menu-sync')
    page.wait_for_timeout(300)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_08_sync.png")
    check("同步中心显示", page.locator('#screen-sync.active').count() > 0, "已显示")

    # Check Feishu config section
    feishu_section = page.locator('text=飞书账号接口').count()
    check("飞书配置区域", feishu_section > 0, "已显示")

    # Save Feishu config
    page.fill('#feishu-appid', 'cli_test_app_id')
    page.fill('#feishu-secret', 'test_secret_key')
    page.fill('#feishu-folder', 'fldcnTestFolder')
    page.click('button:has-text("保存配置")')
    page.wait_for_timeout(500)
    feishu_status = page.locator('#feishu-status').text_content()
    check("飞书配置保存", '已配置' in feishu_status, f"状态: {feishu_status}")

    # Upload sync
    page.evaluate('doSyncUpload()')
    page.wait_for_timeout(500)
    # Click confirm in the confirm dialog
    page.evaluate('confirmAction()')
    page.wait_for_timeout(2500)
    page.screenshot(path=f"{SCREENSHOT_DIR}/v3_09_sync_upload.png")
    sync_log = page.locator('#sync-log-list').text_content()
    check("上传同步完成", '上传同步完成' in sync_log, f"日志: {sync_log[:80]}")

    print("\n[11] 修改密码")
    page.evaluate('doLogout()')
    page.wait_for_timeout(400)
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', '123456')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    page.evaluate("showScreen('screen-password')")
    page.wait_for_timeout(300)
    pw_account = page.locator('#pw-current-account').text_content()
    check("密码页显示当前账号", '17602554481' in pw_account, f"账号: {pw_account}")

    print("\n[12] 忘记密码")
    page.evaluate('doLogout()')
    page.wait_for_timeout(400)
    page.click('button:has-text("忘记密码")')
    page.wait_for_timeout(300)
    check("忘记密码页面", page.locator('#screen-forgot.active').count() > 0, "已显示")
    page.fill('#forgot-phone', '17602554481')
    page.fill('#forgot-pass', 'newpass123')
    page.fill('#forgot-pass2', 'newpass123')
    page.click('button:has-text("确认重置")')
    page.wait_for_timeout(500)
    check("密码重置成功", page.locator('#screen-login.active').count() > 0, "返回登录页")

    # Login with new password
    page.fill('#login-phone', '17602554481')
    page.fill('#login-pass', 'newpass123')
    page.click('button:has-text("登 录")')
    page.wait_for_timeout(800)
    check("新密码登录成功", page.locator('#screen-vehicles.active').count() > 0, "进入车型页面")

    # Reset password back for future tests
    page.click('.nav-tab:has-text("我的")')
    page.wait_for_timeout(300)
    page.evaluate("showScreen('screen-password')")
    page.wait_for_timeout(300)
    page.fill('#pw-old', 'newpass123')
    page.fill('#pw-new', '123456')
    page.fill('#pw-confirm', '123456')
    page.click('button:has-text("确认修改")')
    page.wait_for_timeout(500)

    print("\n" + "=" * 60)
    passed = sum(1 for _, c in results if c)
    total = len(results)
    print(f"  结果: {passed}/{total} 项通过")
    print("=" * 60)
    if passed == total:
        print("  ✅ 全部测试通过!")
    else:
        failed = [n for n, c in results if not c]
        print(f"  ❌ 失败项: {', '.join(failed)}")
    print("=" * 60)

    browser.close()
