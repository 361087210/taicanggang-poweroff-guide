#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V10.14.0 全量数据备份到飞书云文档(同步脚本)
【V10.14.0 更新】
  - FOLDER_TOKEN 从 version.json + 环境变量动态读取(不再硬编码V5.3的过期值WdXUfZPkClI1audQxIYc90XRnWc)
  - 版本号/备份版本源从 version.json(APP 真实版本)读取,不再硬编码
  - 子目录名与 APP 端统一: "同步数据"/"注册申请"/"审批结果"/"备份文件"
用法:
    export FEISHU_APP_ID=cli_xxx
    export FEISHU_APP_SECRET=xxx
    export FEISHU_FOLDER_TOKEN=nodcnGA95g93RhIUSdCeTkhKlQc  # 可选,默认读 version.json.feishuConfig.folder
    python scripts/backup_to_feishu.py
"""
import os, sys, json, time, hashlib, glob
try:
    import requests
except ImportError:
    print("[错误] 缺少 requests 依赖,请先安装: pip install requests")
    sys.exit(1)

# ------------- V10.14.0 动态读取版本与公开配置 -------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILE = os.path.join(PROJECT_ROOT, "version.json")
APP_VERSION = "unknown"
APP_FOLDER_DEFAULT = ""  # version.json 公开 folderToken(非机密,项目公开的根目录ID)
if os.path.exists(VERSION_FILE):
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            v = json.load(f)
        APP_VERSION = v.get("version", APP_VERSION)
        fc = v.get("feishuConfig") or {}
        APP_FOLDER_DEFAULT = fc.get("folder", APP_FOLDER_DEFAULT)
    except Exception as _e:
        print(f"[WARN] version.json 读取失败: {_e},使用回退默认值")

# 秘钥/凭据全部走环境变量; folder_token 非秘钥可以用 version.json 的公开值兜底
APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
FOLDER_TOKEN = os.environ.get("FEISHU_FOLDER_TOKEN", "") or APP_FOLDER_DEFAULT or "nodcnGA95g93RhIUSdCeTkhKlQc"

# 飞书云文档目录结构(与 00-bootstrap.js DEFAULT_FEISHU_CONFIG 完全对齐,01-sync.js/05-sync.js 同步子路径一致)
DATA_FOLDER_NAME = "APP数据备份"
SUB_PATHS = {
    "sync": "同步数据",
    "pending": "注册申请",
    "approved": "审批结果",
    "backup": "备份文件",
    "images": "vehicle_images",
    "videos": "vehicle_videos",
}
UPDATED_AT = "2026-09-04 V10.14.0"  # 脚本更新日期

if not APP_ID or not APP_SECRET:
    print("[错误] 缺少飞书应用凭据。请设置:")
    print("  export FEISHU_APP_ID=cli_xxx")
    print("  export FEISHU_APP_SECRET=xxx")
    sys.exit(1)
if not FOLDER_TOKEN:
    print("[错误] FOLDER_TOKEN 为空。检查 version.json.feishuConfig.folder 或 export FEISHU_FOLDER_TOKEN=")
    sys.exit(1)

FEISHU_API = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{FEISHU_API}/auth/v3/tenant_access_token/internal"


def get_token():
    resp = requests.post(TOKEN_URL, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        print(f"获取 token 失败: {data}")
        sys.exit(1)
    return data["tenant_access_token"]


def list_children(token, folder_token, page_size=200):
    """列出指定目录的子文件/文件夹(飞书Drive API v1)
    V10.14.1基建修复: 原用 GET /drive/v1/files/{token}/children 路径形态, 该应用调用恒返回404;
    改用与APP端 feishu-api.js driveListFiles 完全一致的查询参数形态 ?folder_token= 并补分页"""
    headers = {"Authorization": f"Bearer {token}"}
    files, page_token = [], None
    while True:
        url = f"{FEISHU_API}/drive/v1/files?folder_token={folder_token}&page_size={page_size}"
        if page_token:
            url += f"&page_token={page_token}"
        resp = requests.get(url, headers=headers, timeout=30)
        data = resp.json()
        if data.get("code") != 0:
            raise Exception(f"列出文件失败(folder={folder_token}): {data}")
        d = data.get("data") or {}
        files.extend(d.get("files", []))
        if not d.get("has_more"):
            break
        page_token = d.get("page_token")
    return {f.get("name"): f for f in files}


def get_or_create_folder(token, parent_token, name):
    """按名字查找/创建文件夹,返回 folder_token"""
    children = list_children(token, parent_token)
    existing = children.get(name)
    if existing and existing.get("type") == "folder":
        return existing["token"]
    headers = {"Authorization": f"Bearer {token}"}
    create_resp = requests.post(
        f"{FEISHU_API}/drive/v1/files/create_folder",
        headers=headers,
        json={"name": name, "folder_token": parent_token},
        timeout=30
    )
    d = create_resp.json()
    if d.get("code") != 0:
        raise Exception(f"创建文件夹失败[{name}]: {d}")
    return d["data"]["token"]


def upload_json(token, folder_token, filename, json_data):
    blob = json.dumps(json_data, ensure_ascii=False, indent=2).encode("utf-8")
    return _upload_bytes(token, folder_token, filename, blob, "application/json")


def _upload_bytes(token, folder_token, filename, blob, mime):
    headers = {"Authorization": f"Bearer {token}"}
    # V10.14.0: 兼容 Android APK 构建镜像脚本(部分沙箱 requests 缺失 multipart 编码器的 fallback)
    data_dict = {
        "file_name": filename,
        "parent_type": "explorer",
        "parent_node": folder_token,
        "size": str(len(blob)),
    }
    resp = requests.post(
        f"{FEISHU_API}/drive/v1/medias/upload_all",
        headers=headers,
        data=data_dict,
        files={"file": (filename, blob, mime)},
        timeout=300
    )
    result = resp.json()
    if result.get("code") != 0:
        raise Exception(f"上传失败[{filename}]: {result}")
    return result["data"]["file_token"], len(blob)


def _collect_local_jsondata_backup():
    """V10.14.0: 扫描项目根+ backups/ 目录下所有 json 格式的车辆备份,作为"备份文件"子目录上传"""
    result = {}
    pats = [
        "vehicle_backup_*.json",
        "vehicle_poweroff_backup_*.json",
        "cloud_sync_config.json",
        "manual_backup_*.json",
    ]
    for pat in pats:
        for p in glob.glob(os.path.join(PROJECT_ROOT, pat)) + glob.glob(os.path.join(PROJECT_ROOT, "backups", pat)):
            try:
                with open(p, "r", encoding="utf-8") as f:
                    size = len(f.read())
                result[os.path.basename(p)] = {"size": size, "mtime": os.path.getmtime(p)}
            except Exception:
                pass
    return result


def main():
    t0 = time.time()
    print(f"[{time.strftime('%H:%M:%S')}] 开始全量备份(脚本:{UPDATED_AT}) → 飞书根目录 {FOLDER_TOKEN[:8]}...")
    print(f"[INFO] APP_VERSION = {APP_VERSION}")
    token = get_token()

    # 创建/获取各级目录(与 APP 完全对齐)
    app_folder = get_or_create_folder(token, FOLDER_TOKEN, DATA_FOLDER_NAME)
    sub_tokens = {}
    for key, name in SUB_PATHS.items():
        sub_tokens[key] = get_or_create_folder(token, app_folder, name)

    # 主备份 JSON → "备份文件" 子目录
    backup_payload = {
        "scriptVersion": UPDATED_AT,
        "appVersion": APP_VERSION,
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "backup_to_feishu.py",
        "projectRoot": PROJECT_ROOT,
    }
    if os.path.exists(VERSION_FILE):
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            backup_payload["version_info"] = json.load(f)
    backup_payload["backupsDirCatalog"] = _collect_local_jsondata_backup()
    backup_filename = f"manual_backup_v{APP_VERSION.replace('.', '_')}_{time.strftime('%Y%m%d_%H%M%S')}.json"
    ft1, size1 = upload_json(token, sub_tokens["backup"], backup_filename, backup_payload)
    print(f"  [backup] {backup_filename} ({size1:,} B) → {ft1}")

    # version.json 镜像推到 "同步数据" 子目录,组员端 checkCloudDataUpdate 可比对 downloadUrl 与版本号
    if os.path.exists(VERSION_FILE):
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            vdata = json.load(f)
        ft2, size2 = upload_json(token, sub_tokens["sync"], f"version_snapshot_v{APP_VERSION.replace('.','_')}.json", vdata)
        print(f"  [sync] version_snapshot ({size2:,} B) → {ft2}")

    dt = time.time() - t0
    print(f"[{time.strftime('%H:%M:%S')}] 备份完成 ✔ 耗时 {dt:.1f}s  输出目录: {DATA_FOLDER_NAME}(folder={app_folder[:8]}...)")


if __name__ == "__main__":
    main()
