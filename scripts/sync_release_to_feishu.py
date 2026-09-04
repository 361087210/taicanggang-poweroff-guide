#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V10.14.0 发版产物同步到飞书云空间(发版工具链)
【用途】
  将发版产物(APK/IPA/SHA256/发版说明)同步到飞书APP数据目录, 供团队成员在飞书端直接下载:
    APP数据备份/发版产物/v{version}/
  与 scripts/push_github_final.sh(GitHub Release侧) 互补, 构成"GitHub+飞书"双通道发版产物分发。
【用法】
    export FEISHU_APP_ID=cli_xxx
    export FEISHU_APP_SECRET=xxx
    export FEISHU_FOLDER_TOKEN=nodcnGA95g93RhIUSdCeTkhKlQc   # 可选,默认读 version.json.feishuConfig.folder
    python scripts/sync_release_to_feishu.py [产物目录]       # 默认 release/
【设计对齐】
  - 目录列举端点用 GET /drive/v1/files?folder_token= (APP端 feishu-api.js 生产验证形态;
    注意 /drive/v1/files/{token}/children 路径形态对该应用返回404, 勿改回)
  - ≤16MB upload_all; >16MB 分片上传(upload_prepare/upload_part/upload_finish), 500MB上限
  - 220ms QPS门控 + 1061021事务过期整段重传 + 1061045频控退避(与APP端一致)
  - 同名文件先删后传(幂等, 重复执行不产生副本)
"""
import os, sys, json, time, zlib
try:
    import requests
except ImportError:
    print("[错误] 缺少 requests 依赖,请先安装: pip install requests")
    sys.exit(1)

# ------------- 配置读取(与 backup_to_feishu.py 同模式) -------------
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILE = os.path.join(PROJECT_ROOT, "version.json")
APP_VERSION, APP_FOLDER_DEFAULT = "unknown", ""
if os.path.exists(VERSION_FILE):
    try:
        with open(VERSION_FILE, "r", encoding="utf-8") as f:
            v = json.load(f)
        APP_VERSION = v.get("version", APP_VERSION)
        APP_FOLDER_DEFAULT = (v.get("feishuConfig") or {}).get("folder", "")
    except Exception as e:
        print(f"[WARN] version.json 读取失败: {e}")

APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
FOLDER_TOKEN = os.environ.get("FEISHU_FOLDER_TOKEN", "") or APP_FOLDER_DEFAULT or "nodcnGA95g93RhIUSdCeTkhKlQc"

DATA_FOLDER_NAME = "APP数据备份"       # 与 00-bootstrap.js DEFAULT_FEISHU_CONFIG.dataFolder 对齐
RELEASE_FOLDER_NAME = "发版产物"
UPDATED_AT = "2026-09-04 V10.14.0"

FEISHU_API = "https://open.feishu.cn/open-apis"
UPLOAD_ALL_LIMIT = 20 * 1024 * 1024
MULTIPART_THRESHOLD = 16 * 1024 * 1024
MULTIPART_MAX = 500 * 1024 * 1024
QPS_INTERVAL = 0.22

if not APP_ID or not APP_SECRET:
    print("[错误] 缺少飞书应用凭据。请设置:")
    print("  export FEISHU_APP_ID=cli_xxx")
    print("  export FEISHU_APP_SECRET=xxx")
    sys.exit(1)

_last_ts = 0.0
def qps_gate():
    global _last_ts
    wait = _last_ts + QPS_INTERVAL - time.time()
    if wait > 0:
        time.sleep(wait)
    _last_ts = time.time()


def get_token():
    resp = requests.post(f"{FEISHU_API}/auth/v3/tenant_access_token/internal",
                         json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        print(f"获取 token 失败: {data}")
        sys.exit(1)
    return data["tenant_access_token"]


def list_children(token, folder_token):
    """列出目录子项(APP端生产验证的查询参数形态, 含分页)"""
    files, page_token = {}, None
    while True:
        params = {"folder_token": folder_token, "page_size": 200}
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(f"{FEISHU_API}/drive/v1/files", headers={"Authorization": f"Bearer {token}"},
                            params=params, timeout=30)
        d = resp.json()
        if d.get("code") != 0:
            raise Exception(f"列出文件失败(folder={folder_token}): code={d.get('code')} {d.get('msg')}")
        data = d.get("data") or {}
        for f in data.get("files", []):
            files[f.get("name")] = f
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return files


def get_or_create_folder(token, parent_token, name):
    children = list_children(token, parent_token)
    existing = children.get(name)
    if existing and existing.get("type") == "folder":
        return existing["token"]
    qps_gate()
    resp = requests.post(f"{FEISHU_API}/drive/v1/files/create_folder",
                         headers={"Authorization": f"Bearer {token}"},
                         json={"name": name, "folder_token": parent_token}, timeout=30)
    d = resp.json()
    if d.get("code") != 0:
        raise Exception(f"创建文件夹失败[{name}]: code={d.get('code')} {d.get('msg')}")
    return d["data"]["token"]


def delete_if_exists(token, folder_token, name):
    """同名文件先删后传,保证幂等"""
    children = list_children(token, folder_token)
    old = children.get(name)
    if not old or old.get("type") != "file":
        return False
    qps_gate()
    resp = requests.delete(f"{FEISHU_API}/drive/v1/files/{old['token']}",
                           headers={"Authorization": f"Bearer {token}"},
                           params={"type": "file"}, timeout=30)
    d = resp.json()
    if d.get("code") != 0:
        print(f"  [WARN] 删除旧文件[{name}]失败: {d.get('msg')}(将继续上传,可能出现同名副本)")
    return True


def upload_all_once(token, folder_token, path, name):
    size = os.path.getsize(path)
    qps_gate()
    with open(path, "rb") as f:
        resp = requests.post(
            f"{FEISHU_API}/drive/v1/files/upload_all",
            headers={"Authorization": f"Bearer {token}"},
            data={"file_name": name, "parent_type": "explorer",
                  "parent_node": folder_token, "size": str(size)},
            files={"file": (name, f, "application/octet-stream")},
            timeout=600)
    return resp.json()


def upload_multipart(token, folder_token, path, name):
    """分片上传:>16MB或upload_all返回1061043时启用(与APP端driveUploadFileMultipart对齐)"""
    size = os.path.getsize(path)
    if size > MULTIPART_MAX:
        raise Exception(f"文件超过500MB上限: {name}")
    for session in range(2):  # 1061021事务过期允许整段重传1次
        qps_gate()
        prep = requests.post(f"{FEISHU_API}/drive/v1/files/upload_prepare",
                             headers={"Authorization": f"Bearer {token}",
                                      "Content-Type": "application/json; charset=utf-8"},
                             json={"file_name": name, "parent_type": "explorer",
                                   "parent_node": folder_token, "size": size},
                             timeout=60).json()
        if prep.get("code") != 0:
            raise Exception(f"预上传失败[{name}]: {prep.get('msg')}")
        p = prep["data"]
        upload_id, block_size = str(p["upload_id"]), p.get("block_size") or 4194304
        block_num = p.get("block_num") or ((size + block_size - 1) // block_size)
        expired = False
        with open(path, "rb") as f:
            for seq in range(block_num):
                chunk = f.read(block_size)
                checksum = zlib.adler32(chunk) & 0xFFFFFFFF
                ok, last_err = False, None
                for attempt in range(3):
                    try:
                        qps_gate()
                        f.seek(seq * block_size)
                        chunk = f.read(block_size)
                        resp = requests.post(
                            f"{FEISHU_API}/drive/v1/files/upload_part",
                            headers={"Authorization": f"Bearer {token}"},
                            data={"upload_id": upload_id, "seq": str(seq),
                                  "size": str(len(chunk)), "checksum": str(checksum)},
                            files={"file": (f"chunk_{seq}", chunk)}, timeout=600)
                        d = resp.json()
                        if d.get("code") == 0:
                            ok = True
                        elif d.get("code") == 1061021:
                            expired = True
                            break
                        else:
                            last_err = Exception(f"分片{seq}失败: {d.get('msg')}")
                    except Exception as e:
                        last_err = e
                    if not ok and not expired:
                        time.sleep(0.5 * (attempt + 1))
                if expired:
                    break
                if not ok:
                    raise last_err or Exception(f"分片上传失败 seq={seq}")
                print(f"    分片 {seq + 1}/{block_num}")
        if expired:
            if session == 0:
                print(f"  [WARN] 事务过期,重新预上传整段重传: {name}")
                continue
            raise Exception(f"分片事务两次过期,上传失败: {name}")
        qps_gate()
        fin = requests.post(f"{FEISHU_API}/drive/v1/files/upload_finish",
                            headers={"Authorization": f"Bearer {token}",
                                     "Content-Type": "application/json; charset=utf-8"},
                            json={"upload_id": upload_id, "block_num": block_num},
                            timeout=60).json()
        if fin.get("code") != 0:
            raise Exception(f"完成上传失败[{name}]: {fin.get('msg')}")
        return fin["data"]
    raise Exception(f"分片上传失败: {name}")


def upload_file(token, folder_token, path):
    name = os.path.basename(path)
    size = os.path.getsize(path)
    if size <= MULTIPART_THRESHOLD:
        d = upload_all_once(token, folder_token, path, name)
        if d.get("code") == 1061043:  # 服务端判定超限,升级分片
            print(f"  [WARN] upload_all超限,自动升级分片上传: {name}")
            return upload_multipart(token, folder_token, path, name)
        if d.get("code") != 0:
            raise Exception(f"上传失败[{name}]: code={d.get('code')} {d.get('msg')}")
        return d["data"]
    return upload_multipart(token, folder_token, path, name)


def main():
    assets_dir = sys.argv[1] if len(sys.argv) > 1 else os.path.join(PROJECT_ROOT, "release")
    if not os.path.isdir(assets_dir):
        print(f"[错误] 产物目录不存在: {assets_dir}")
        print("  Android本地构建: scripts/build_android.sh 产物在 release/")
        print("  或从GitHub Release下载: tcg_poweroff_v{ver}.apk / *_ios.ipa / *.sha256")
        sys.exit(1)
    files = sorted(f for f in os.listdir(assets_dir)
                   if os.path.isfile(os.path.join(assets_dir, f)) and not f.startswith("."))
    if not files:
        print(f"[错误] 产物目录为空: {assets_dir}")
        sys.exit(1)

    print(f"[{time.strftime('%H:%M:%S')}] 发版产物同步(脚本:{UPDATED_AT})")
    print(f"  版本: v{APP_VERSION} | 产物数: {len(files)} | 目录: {assets_dir}")
    for f in files:
        print(f"    - {f} ({os.path.getsize(os.path.join(assets_dir, f)):,} B)")

    token = get_token()
    app_folder = get_or_create_folder(token, FOLDER_TOKEN, DATA_FOLDER_NAME)
    rel_folder = get_or_create_folder(token, app_folder, RELEASE_FOLDER_NAME)
    ver_folder = get_or_create_folder(token, rel_folder, f"v{APP_VERSION}")
    print(f"  目标: {DATA_FOLDER_NAME}/{RELEASE_FOLDER_NAME}/v{APP_VERSION} (folder={ver_folder[:12]}...)")

    results = []
    for name in files:
        path = os.path.join(assets_dir, name)
        deleted = delete_if_exists(token, ver_folder, name)
        d = upload_file(token, ver_folder, path)
        results.append((name, os.path.getsize(path), d.get("file_token", "")))
        print(f"  [OK] {'覆盖' if deleted else '新增'} {name} → file_token={str(d.get('file_token'))[:16]}...")

    # 终验: 重新列举目标目录
    print(f"\n=== 云端目录终验 (v{APP_VERSION}) ===")
    final = list_children(token, ver_folder)
    ok = True
    for name, size, _ in results:
        hit = final.get(name)
        if hit and hit.get("type") == "file":
            print(f"  ✓ {name}")
        else:
            ok = False
            print(f"  ✗ {name} 未在云端发现!")
    print(f"\n[{'完成 ✔' if ok else '存在缺失 ✗'}] 共 {len(results)} 个产物 → 飞书 {DATA_FOLDER_NAME}/{RELEASE_FOLDER_NAME}/v{APP_VERSION}/")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
