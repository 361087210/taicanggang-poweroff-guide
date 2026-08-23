#!/usr/bin/env python3
"""
V5.7 飞书真实链路集成测试 (Task 5: 云端目录重构验证)
验证链路: 凭证 → token → 根目录 → 数据分仓目录结构 → 读写往返
模拟 APP 端 getDataFolderToken/getDataSubFolderToken 的完整行为
"""
import json, os, sys, urllib.request, urllib.error

# V5.7.1 安全规范: Secret 不落库, 从环境变量读取 (见 tests/README.md)
APP_ID = "cli_aa0ce4fd91f85be8"
APP_SECRET = os.environ.get("TCG_FEISHU_APP_SECRET", "")
ROOT = "WdXUfZPkClI1audQxIYc90XRnWc"  # 与 APP 内置一致

if not APP_SECRET:
    print("[环境缺失] 请先设置环境变量 TCG_FEISHU_APP_SECRET (飞书应用Secret)")
    print("  Linux/macOS: export TCG_FEISHU_APP_SECRET=<你的Secret>")
    print("  Windows:     set TCG_FEISHU_APP_SECRET=<你的Secret>")
    sys.exit(1)

BASE = "https://open.feishu.cn/open-apis"
PASSED, FAILED = [], []

def check(name, cond, detail=""):
    (PASSED if cond else FAILED).append(name)
    print(f"  [{'PASS' if cond else 'FAIL'}] {name}" + (f" | {detail}" if detail else ""))

def req(method, url, token=None, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, method=method, data=data, headers={
        "Content-Type": "application/json",
        **({"Authorization": f"Bearer {token}"} if token else {})
    })
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            content = resp.read()
            return resp.status, (content if raw else (json.loads(content) if content else {}))
    except urllib.error.HTTPError as e:
        content = e.read()
        try: return e.code, content if raw else json.loads(content)
        except Exception: return e.code, content

def list_folders(token, parent):
    """分页列出 parent 下全部条目 (与APP端 feishuListFiles 同逻辑)"""
    items, page = [], None
    while True:
        url = f"{BASE}/drive/v1/files?folder_token={parent}&page_size=200&order_by=CreatedTime&direction=ASC"
        if page: url += f"&page_token={page}"
        st, data = req("GET", url, token)
        if st != 200 or data.get("code") != 0:
            return items, data
        items += (data.get("data") or {}).get("files") or []
        page = (data.get("data") or {}).get("next_page_token")
        if not page: return items, {"code": 0}

def ensure_folder(token, parent, name):
    """与APP端 getDataSubFolderToken 同逻辑: 找→无则建"""
    items, _ = list_folders(token, parent)
    for f in items:
        if f.get("type") == "folder" and f.get("name") == name:
            return f["token"], "found"
    st, data = req("POST", f"{BASE}/drive/v1/files/create_folder", token,
                   {"name": name, "folder_token": parent})
    if st == 200 and data.get("code") == 0:
        return data["data"]["token"], "created"
    return None, f"create_failed:{data}"

print("=" * 62)
print("阶段1: 凭证与Token (issue 4 根因: 空Secret导致全链路静默失败)")
print("=" * 62)
st, data = req("POST", f"{BASE}/auth/v3/tenant_access_token/internal", None,
               {"app_id": APP_ID, "app_secret": APP_SECRET})
token = (data.get("tenant_access_token") if isinstance(data, dict) else "") or ""
check("1.1 tenant_access_token 获取", bool(token), f"code={data.get('code')}")
if not token:
    print(json.dumps(data, ensure_ascii=False)); sys.exit(1)

print()
print("=" * 62)
print("阶段2: 根目录可达性与现状盘点 (issue 4: 根目录产物与操作数据混放)")
print("=" * 62)
items, err = list_folders(token, ROOT)
check("2.1 根文件夹可列出", err.get("code") == 0, f"{len(items)} items")
root_names = [(f["name"], f["type"]) for f in items]
print(f"  根目录现状: {root_names}")

print()
print("=" * 62)
print("阶段3: 数据分仓目录创建 (APP数据备份 → 四子目录)")
print("=" * 62)
data_root, how = ensure_folder(token, ROOT, "APP数据备份")
check("3.1 数据区根 APP数据备份", bool(data_root), how)
subs = {}
for sub in ["同步数据", "注册申请", "审批结果", "备份文件"]:
    t, h = ensure_folder(token, data_root, sub)
    check(f"3.2 子目录 {sub}", bool(t), h)
    subs[sub] = t

print()
print("=" * 62)
print("阶段4: 交付产物目录 (项目产物与操作数据分离的另一半)")
print("=" * 62)
prod_root, how = ensure_folder(token, ROOT, "项目交付产物")
check("4.1 交付产物目录 项目交付产物", bool(prod_root), how)
for sub in ["APK安装包", "开发文档", "测试报告"]:
    t, h = ensure_folder(token, prod_root, sub)
    check(f"4.2 子目录 {sub}", bool(t), h)

print()
print("=" * 62)
print("阶段5: 注册申请链路读写往返 (issue 5: 跨网络注册审批)")
print("=" * 62)
test_phone = "13900000570"
fname = f"pending_reg_{test_phone}.json"
payload = {"type": "pending_registration",
           "user": {"id": "test_v57", "name": "集成测试组员", "phone": test_phone,
                    "password": "salt$hash", "role": "member", "status": "pending",
                    "created": "2026-08-23T00:00:00Z"},
           "timestamp": "2026-08-23T00:00:00Z"}
import io, uuid
boundary = uuid.uuid4().hex
def multipart_body(filename, content):
    b = []
    b.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file_name\"\r\n\r\n{filename}\r\n".encode())
    b.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"parent_type\"\r\n\r\nexplorer\r\n".encode())
    b.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"parent_node\"\r\n\r\n{subs['注册申请']}\r\n".encode())
    b.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"size\"\r\n\r\n{len(content)}\r\n".encode())
    b.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\nContent-Type: application/json\r\n\r\n".encode())
    b.append(content + f"\r\n--{boundary}--\r\n".encode())
    return b"".join(b)

content = json.dumps(payload, ensure_ascii=False, indent=2).encode()
body = multipart_body(fname, content)
r = urllib.request.Request(f"{BASE}/drive/v1/files/upload_all", method="POST", data=body, headers={
    "Authorization": f"Bearer {token}",
    "Content-Type": f"multipart/form-data; boundary={boundary}"})
try:
    with urllib.request.urlopen(r, timeout=30) as resp:
        up = json.loads(resp.read())
    check("5.1 模拟组员上传注册申请", up.get("code") == 0, f"file_token={(up.get('data') or {}).get('file_token','')[:16]}...")
except urllib.error.HTTPError as e:
    check("5.1 模拟组员上传注册申请", False, e.read().decode()[:200])

# 5.2 模拟组长拉取 (与 pullPendingFromFeishu 同逻辑, 允许历史测试残留)
reg_files, _ = list_folders(token, subs["注册申请"])
found = [f for f in reg_files if f["name"] == fname]
check("5.2 组长侧可发现申请文件", len(found) >= 1, f"{len(reg_files)} files in 注册申请/")

# 5.3 模拟下载解析
if found:
    st, raw = req("GET", f"{BASE}/drive/v1/files/{found[0]['token']}/download", token, raw=True)
    try:
        parsed = json.loads(raw)
        check("5.3 申请文件可下载且解析正确",
              parsed.get("type") == "pending_registration" and parsed["user"]["phone"] == test_phone)
    except Exception as ex:
        check("5.3 申请文件可下载且解析正确", False, str(ex))

# 5.4 清理全部同名测试文件(含历史运行残留)
if found:
    ok = True
    for f in [x for x in reg_files if x["name"] == fname]:
        st, _ = req("DELETE", f"{BASE}/drive/v1/files/{f['token']}?type=file", token)
        ok = ok and st == 200
    check("5.4 测试文件清理(含历史残留)", ok)

print()
print("=" * 62)
print(f"结果: {len(PASSED)} 通过 / {len(FAILED)} 失败")
if FAILED:
    print("失败项:", FAILED); sys.exit(1)
print("全部通过 ✓ 飞书链路与数据分仓结构就绪")
print("=" * 62)
