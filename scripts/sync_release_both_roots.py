#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
发版产物同步到飞书应用云盘根
在 sync_release_to_feishu.py 的基础上, 上传到应用云盘根目录
"""
import os, sys

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(PROJECT_ROOT, "scripts"))
from sync_release_to_feishu import (
    get_token, list_children, get_or_create_folder,
    upload_file, delete_if_exists, DATA_FOLDER_NAME, RELEASE_FOLDER_NAME,
    QPS_INTERVAL, qps_gate, APP_VERSION
)

# 注: APP_VERSION 由 sync_release_to_feishu 从项目根 version.json 动态读取(单一真源)。
# 勿再写死版本号。
ROOT = "CeT0fYNgalU4fQdW9etcJLJGn1b"


def sync_to_root(token, root_token, assets_dir):
    print(f"\n{'='*50}")
    print(f"  同步到 应用云盘根 ({root_token[:12]}...)")
    print(f"{'='*50}")
    app_folder = get_or_create_folder(token, root_token, DATA_FOLDER_NAME)
    rel_folder = get_or_create_folder(token, app_folder, RELEASE_FOLDER_NAME)
    ver_folder = get_or_create_folder(token, rel_folder, f"v{APP_VERSION}")
    print(f"  目标: {DATA_FOLDER_NAME}/{RELEASE_FOLDER_NAME}/v{APP_VERSION}/")

    files = sorted(f for f in os.listdir(assets_dir)
                   if os.path.isfile(os.path.join(assets_dir, f)) and not f.startswith("."))

    results = []
    for name in files:
        path = os.path.join(assets_dir, name)
        deleted = delete_if_exists(token, ver_folder, name)
        d = upload_file(token, ver_folder, path)
        results.append((name, os.path.getsize(path), d.get("file_token", "")))
        print(f"  [OK] {'覆盖' if deleted else '新增'} {name} ({os.path.getsize(path):,} B)")

    # 终验
    final = list_children(token, ver_folder)
    ok = True
    for name, _, _ in results:
        if final.get(name) and final[name].get("type") == "file":
            print(f"    ✓ {name}")
        else:
            ok = False
            print(f"    ✗ {name} 缺失!")
    print(f"  {'完成 ✔' if ok else '存在缺失 ✗'} 共 {len(results)} 个产物")
    return ok


def main():
    assets_dir = os.path.join(PROJECT_ROOT, "release")
    if not os.path.isdir(assets_dir):
        print(f"[错误] 产物目录不存在: {assets_dir}")
        sys.exit(1)

    APP_ID = os.environ.get("FEISHU_APP_ID", "")
    APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
    if not APP_ID or not APP_SECRET:
        # 从APK注入块读取
        for cand in [
            "/data/user/work/apk_extract/assets/www/demo.html",
        ]:
            if os.path.exists(cand):
                with open(cand, "r", encoding="utf-8") as f:
                    html = f.read()
                import re
                m = re.search(r"window\.__BUILD_SECRETS__\s*=\s*\{([\s\S]*?)\};", html)
                if m:
                    block = m.group(1)
                    APP_ID = (re.search(r"appId:\s*'([^']+)'", block) or [None, ""])[1]
                    APP_SECRET = (re.search(r"appSecret:\s*'([^']+)'", block) or [None, ""])[1]
                break

    if not APP_ID or not APP_SECRET:
        print("[错误] 缺少飞书凭据,请设置 FEISHU_APP_ID / FEISHU_APP_SECRET")
        sys.exit(1)

    os.environ["FEISHU_APP_ID"] = APP_ID
    os.environ["FEISHU_APP_SECRET"] = APP_SECRET

    token = get_token()
    print(f"飞书认证成功 · 版本 v{APP_VERSION}")
    print(f"产物目录: {assets_dir}")

    ok = sync_to_root(token, ROOT, assets_dir)

    print(f"\n{'='*50}")
    print(f"  同步{'完成 ✅' if ok else '存在缺失 ⚠️'}")
    print(f"{'='*50}")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()