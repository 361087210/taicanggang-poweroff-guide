#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5.3.6 全量数据备份到飞书云文档
用法:
    export FEISHU_APP_ID=your_app_id
    export FEISHU_APP_SECRET=your_app_secret
    python scripts/backup_to_feishu.py
"""
import os, sys, json, time, hashlib, requests

APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
FOLDER_TOKEN = "WdXUfZPkClI1audQxIYc90XRnWc"
DATA_FOLDER_NAME = "APP数据备份"

FEISHU_API = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{FEISHU_API}/auth/v3/tenant_access_token/internal"

def get_token():
    resp = requests.post(TOKEN_URL, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        print(f"获取 token 失败: {data}")
        sys.exit(1)
    return data["tenant_access_token"]

def get_or_create_data_folder(token):
    headers = {"Authorization": f"Bearer {token}"}
    resp = requests.get(f"{FEISHU_API}/drive/v1/files/{FOLDER_TOKEN}/children?page_size=200", headers=headers, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        raise Exception(f"列出文件失败: {data}")
    files = data.get("data", {}).get("files", [])
    for f in files:
        if f.get("name") == DATA_FOLDER_NAME and f.get("type") == "folder":
            return f["token"]
    create_resp = requests.post(
        f"{FEISHU_API}/drive/v1/files/create_folder",
        headers=headers,
        json={"name": DATA_FOLDER_NAME, "folder_token": FOLDER_TOKEN},
        timeout=30
    )
    create_data = create_resp.json()
    if create_data.get("code") != 0:
        raise Exception(f"创建文件夹失败: {create_data}")
    return create_data["data"]["token"]

def upload_json(token, folder_token, filename, json_data):
    blob = json.dumps(json_data, ensure_ascii=False, indent=2).encode("utf-8")
    headers = {"Authorization": f"Bearer {token}"}
    files = {"file": (filename, blob, "application/json")}
    data = {
        "file_name": filename,
        "parent_type": "explorer",
        "parent_node": folder_token,
        "size": str(len(blob)),
    }
    resp = requests.post(f"{FEISHU_API}/drive/v1/medias/upload_all", headers=headers, data=data, files=files, timeout=120)
    result = resp.json()
    if result.get("code") != 0:
        raise Exception(f"上传失败: {result}")
    return result["data"]["file_token"]

def main():
    print(f"[{time.strftime('%H:%M:%S')}] 开始全量备份到飞书…")
    token = get_token()
    folder_token = get_or_create_data_folder(token)
    backup = {
        "version": "5.3.6",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "backup_to_feishu.py",
    }
    if os.path.exists("vehicles_data.js"):
        with open("vehicles_data.js", "r", encoding="utf-8") as f:
            backup["vehicles_data_js_size"] = len(f.read())
    if os.path.exists("version.json"):
        with open("version.json", "r", encoding="utf-8") as f:
            backup["version_info"] = json.load(f)
    filename = f"manual_backup_{time.strftime('%Y%m%d_%H%M%S')}.json"
    file_token = upload_json(token, folder_token, filename, backup)
    print(f"[{time.strftime('%H:%M:%S')}] 备份完成: {filename} -> {file_token}")

if __name__ == "__main__":
    main()
