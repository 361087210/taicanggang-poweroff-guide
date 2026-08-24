#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5.3.6 飞书产物区同步脚本（通用版，版本号自动读取 version.json）
用法:
    export FEISHU_APP_ID=your_app_id
    export FEISHU_APP_SECRET=your_app_secret
    export FEISHU_CHAT_A=oc_xxx_group_a
    export FEISHU_CHAT_B=oc_xxx_group_b
    python scripts/sync_feishu_v536.py
"""
import os, sys, json, time, hashlib, requests

# ------------------------------------------------------------------
# 配置
# ------------------------------------------------------------------
APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
GROUP_CHAT_ID_A = "oc_xxx_group_a"      # 运维A群
GROUP_CHAT_ID_B = "oc_xxx_group_b"      # 运维B群
CHAT_IDS = [GROUP_CHAT_ID_A, GROUP_CHAT_ID_B]

FEISHU_API = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{FEISHU_API}/auth/v3/tenant_access_token/internal"
UPLOAD_URL = f"{FEISHU_API}/drive/v1/medias/upload_all"
SEND_URL = f"{FEISHU_API}/im/v1/messages"

# ------------------------------------------------------------------
# 日志
# ------------------------------------------------------------------
def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

# ------------------------------------------------------------------
# 获取 tenant_access_token
# ------------------------------------------------------------------
def get_tenant_token():
    resp = requests.post(TOKEN_URL, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        log(f"获取 token 失败: {data}")
        sys.exit(1)
    return data["tenant_access_token"]

# ------------------------------------------------------------------
# 读取 version.json
# ------------------------------------------------------------------
def load_version():
    with open("version.json", "r", encoding="utf-8") as f:
        return json.load(f)

# ------------------------------------------------------------------
# 上传文件到飞书云文档/云盘（获取 file_key）
# ------------------------------------------------------------------
def upload_apk_to_feishu(token, apk_path):
    if not os.path.exists(apk_path):
        log(f"APK 不存在: {apk_path}")
        return None
    file_name = os.path.basename(apk_path)
    file_size = os.path.getsize(apk_path)
    with open(apk_path, "rb") as f:
        file_data = f.read()
    checksum = hashlib.sha256(file_data).hexdigest()
    headers = {"Authorization": f"Bearer {token}"}
    files = {
        "file": (file_name, file_data, "application/vnd.android.package-archive"),
    }
    data = {
        "file_name": file_name,
        "parent_type": "explorer",
        "parent_node": "",
        "size": str(file_size),
        "checksum": checksum,
    }
    resp = requests.post(UPLOAD_URL, headers=headers, data=data, files=files, timeout=120)
    result = resp.json()
    if result.get("code") != 0:
        log(f"上传失败: {result}")
        return None
    file_key = result["data"]["file_token"]
    log(f"上传成功 file_key={file_key}")
    return file_key

# ------------------------------------------------------------------
# 发送群消息（富文本卡片）
# ------------------------------------------------------------------
def send_card(token, chat_id, version, download_url, file_key):
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    card = {
        "config": {"wide_screen_mode": True},
        "header": {
            "title": {"tag": "plain_text", "content": f"🚀 太仓港停电指南 V{version} 已发布"},
            "template": "green"
        },
        "elements": [
            {"tag": "div", "text": {"tag": "lark_md", "content": f"**版本:** V{version}\n**更新内容:** 权限放宽与通知增强"}},
            {"tag": "action", "actions": [
                {"tag": "button", "text": {"tag": "plain_text", "content": "下载 APK"}, "type": "primary", "url": download_url}
            ]}
        ]
    }
    payload = {
        "receive_id": chat_id,
        "msg_type": "interactive",
        "content": json.dumps(card)
    }
    resp = requests.post(SEND_URL, headers=headers, json=payload, timeout=30)
    result = resp.json()
    if result.get("code") != 0:
        log(f"发送消息失败(chat={chat_id}): {result}")
        return False
    log(f"消息已发送至 {chat_id}")
    return True

# ------------------------------------------------------------------
# 主流程
# ------------------------------------------------------------------
def main():
    log("开始同步 V5.3.6 产物到飞书…")
    version_info = load_version()
    version = version_info["version"]
    download_url = version_info.get("downloadUrl", "")
    apk_name = f"tcg_poweroff_v{version}.apk"
    apk_path = f"release/{apk_name}"

    token = get_tenant_token()
    log(f"获取 token 成功，版本={version}")

    file_key = upload_apk_to_feishu(token, apk_path)
    if not file_key:
        log("上传 APK 失败，尝试仅发送链接消息")

    success_count = 0
    for chat_id in CHAT_IDS:
        if send_card(token, chat_id, version, download_url, file_key):
            success_count += 1
        time.sleep(0.5)

    log(f"同步完成: {success_count}/{len(CHAT_IDS)} 个群消息发送成功")
    sys.exit(0 if success_count == len(CHAT_IDS) else 1)

if __name__ == "__main__":
    main()
