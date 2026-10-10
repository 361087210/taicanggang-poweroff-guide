#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_feishu_assets.py
将飞书云盘里的项目资源（图片/视频/APK/文档）下载并重建为本地项目可用文件。

设计要点：
- 仅用 Python 标准库 urllib，无需安装 requests。
- 凭据（app_id/app_secret）仅存在于本机内存，绝不写入仓库。
- 下载幂等：本地已存在同名文件则跳过（--force 可强制重下）。
- 视频分卷（.part001..partNNN）按 base 名分组、数字升序流式合并为 <base>.mp4，
  合并后校验 mp4 'ftyp' 头，错误则告警并保留分卷。
- 分相位执行：--phase images|videos|apks|docs|manifest|all

用法：
  python sync_feishu_assets.py --phase images
  python sync_feishu_assets.py --phase videos --force
  python sync_feishu_assets.py --phase all
"""
import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ---- 凭据（仅本机环境变量注入，绝不硬编码入库） ----
# ⚠️ 安全：appSecret 已从仓库移除。运行前须 export FEISHU_APP_SECRET=...
APP_ID = "cli_aa0ce4fd91f85be8"          # 应用 ID（非机密）
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")

BASE = "https://open.feishu.cn/open-apis/drive/v1"
AUTH_URL = "https://open.feishu.cn/open-apis/auth/v3/app_access_token/internal"

# 云盘目录 token（扫描得出，稳定）
VEHICLE_IMAGES = "Wehwf8utKlvy22dkRsdcxGJUnSs"
VEHICLE_VIDEOS = "B9dffqFLrlfw6ldmJuEc0cXBnOb"
FABAN = "KqfnfaZQmlB7Ixd1F3Jcu1u1n9d"          # 发版产物（13 个版本子文件夹）
APK_PKG = "KXp9fVSwMlyvwDdXJs6cRNcwnwg"        # APK安装包（2 个 APK）
DOC_DEV = "ACgGfjdoBlRCIldOPj7cIVBKnjg"        # 开发文档（项目交付产物）
DOC_TEST = "ChQhf9J9jlZ0jhdxfZ2ctNGnnKb"      # 测试报告（项目交付产物）
DOC_V40 = "W8PffR4rxlzhbPd3a3JcCx42naf"        # docs（项目交付V4.0）
REL_V40 = "ES5pfb5M3lwu4Ydw2Yycod2pnxc"       # release（项目交付V4.0）

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TOKEN = None
H = {}


def log(msg):
    sys.stdout.write(msg + "\n")
    sys.stdout.flush()


def get_token():
    global TOKEN, H
    if TOKEN:
        return TOKEN
    req = urllib.request.Request(
        AUTH_URL,
        data=json.dumps({"app_id": APP_ID, "app_secret": APP_SECRET}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    data = json.load(urllib.request.urlopen(req, timeout=30))
    if data.get("code") != 0:
        raise RuntimeError("获取 token 失败: " + json.dumps(data, ensure_ascii=False))
    TOKEN = data["app_access_token"]
    H = {"Authorization": "Bearer " + TOKEN}
    return TOKEN


def list_folder(token):
    out = []
    page = None
    while True:
        url = f"https://open.feishu.cn/open-apis/drive/explorer/v2/folder/{token}/children"
        if page:
            url += f"?page_token={urllib.parse.quote(page)}"
        req = urllib.request.Request(url, headers=H)
        data = json.load(urllib.request.urlopen(req, timeout=30))
        if data.get("code") != 0:
            raise RuntimeError("列目录失败: " + json.dumps(data, ensure_ascii=False))
        for v in data.get("data", {}).get("children", {}).values():
            out.append((v.get("name"), v.get("type"), v.get("token")))
        if not data.get("data", {}).get("has_more"):
            break
        page = data.get("data", {}).get("page_token")
    return out


def _fetch(token, timeout):
    req = urllib.request.Request(f"{BASE}/files/{token}/download", headers=H)
    return urllib.request.urlopen(req, timeout=timeout)


def download(token, path, force=False):
    """流式下载单个文件到 path。返回 'skip' | 'ok' | 'err'。"""
    if os.path.exists(path) and not force:
        return "skip"
    os.makedirs(os.path.dirname(path), exist_ok=True)
    last = None
    for attempt in range(3):
        try:
            with _fetch(token, 180) as r:
                if r.status != 200:
                    return "err"
                with open(path, "wb") as f:
                    while True:
                        chunk = r.read(1024 * 1024)
                        if not chunk:
                            break
                        f.write(chunk)
            return "ok"
        except Exception as e:  # noqa
            last = e
            time.sleep(2)
    log(f"  [ERR] {os.path.basename(path)}: {last}")
    return "err"


def merge_parts(parts, out_path, force=False):
    """parts: [(token, name), ...] 已按分卷号升序。流式合并为 out_path。"""
    if os.path.exists(out_path) and not force:
        return "skip"
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    last = None
    for attempt in range(3):
        try:
            with open(out_path, "wb") as out:
                for token, name in parts:
                    with _fetch(token, 180) as r:
                        if r.status != 200:
                            raise RuntimeError(f"分卷下载失败 {name} status={r.status}")
                        while True:
                            c = r.read(1024 * 1024)
                            if not c:
                                break
                            out.write(c)
            # 校验 mp4 头
            with open(out_path, "rb") as f:
                head = f.read(12)
            if head[4:8] != b"ftyp":
                log(f"  [WARN] 合并文件头非 mp4 ftyp: {os.path.basename(out_path)} head={head!r}")
                return "warn"
            return "ok"
        except Exception as e:  # noqa
            last = e
            time.sleep(2)
    log(f"  [ERR] 合并失败 {os.path.basename(out_path)}: {last}")
    if os.path.exists(out_path):
        os.remove(out_path)
    return "err"


def phase_images(force):
    dst = os.path.join(REPO, "vehicle_images")
    items = list_folder(VEHICLE_IMAGES)
    files = [(n, tkn) for n, t, tkn in items if t == "file"]
    log(f"[images] 云盘 {len(files)} 张，目标 {dst}")
    ok = skip = err = 0
    for i, (name, token) in enumerate(files, 1):
        r = download(token, os.path.join(dst, name), force)
        if r == "ok":
            ok += 1
        elif r == "skip":
            skip += 1
        else:
            err += 1
        if i % 20 == 0:
            log(f"  ... {i}/{len(files)} (new={ok} skip={skip} err={err})")
    log(f"[images] 完成 new={ok} skip={skip} err={err}")


def phase_videos(force):
    dst = os.path.join(REPO, "vehicle_videos")
    items = list_folder(VEHICLE_VIDEOS)
    files = [(n, tkn) for n, t, tkn in items if t == "file"]
    log(f"[videos] 云盘 {len(files)} 个文件，目标 {dst}")

    standalone = []  # (name, token) 以 .mp4 结尾且无 .part
    groups = {}      # base -> [(num, name, token)]
    pat = re.compile(r"\.part(\d+)$")
    for name, token in files:
        m = pat.search(name)
        if m:
            base = name[: m.start()]
            groups.setdefault(base, []).append((int(m.group(1)), name, token))
        elif name.lower().endswith(".mp4"):
            standalone.append((name, token))
        else:
            log(f"  [skip] 未识别视频文件: {name}")

    log(f"  独立 mp4: {len(standalone)}，分卷组: {len(groups)}")

    ok = skip = err = warn = 0
    # 独立 mp4
    for name, token in standalone:
        r = download(token, os.path.join(dst, name), force)
        ok += r == "ok"; skip += r == "skip"; err += r == "err"; warn += r == "warn"
    # 分卷合并
    for base, parts in groups.items():
        parts.sort(key=lambda x: x[0])
        out = os.path.join(dst, base)
        r = merge_parts([(t, n) for _, n, t in parts], out, force)
        ok += r == "ok"; skip += r == "skip"; err += r == "err"; warn += r == "warn"
        log(f"  合并 {base}: {r} (分卷 {len(parts)})")
    log(f"[videos] 完成 new={ok} skip={skip} err={err} warn={warn}")


def _latest_version_folders():
    items = list_folder(FABAN)
    folders = [(n, tkn) for n, t, tkn in items if t == "folder"]
    # 版本名排序：v10.19.3 -> (10,19,3)
    def key(name):
        nums = re.findall(r"\d+", name)
        return tuple(int(x) for x in nums) if nums else (0,)
    folders.sort(key=lambda x: key(x[0]), reverse=True)
    return folders


def phase_apks(force, top_n=2):
    dst = os.path.join(REPO, "release")
    # 发版产物：取最新 top_n 个版本文件夹
    folders = _latest_version_folders()
    log(f"[apks] 发版产物共 {len(folders)} 个版本，取最新 {top_n}："
        + ", ".join(n for n, _ in folders[:top_n]))
    ok = skip = err = 0
    for name, token in folders[:top_n]:
        sub = list_folder(token)
        for fn, ft, ftn in sub:
            if ft != "file":
                continue
            r = download(ftn, os.path.join(dst, name, fn), force)
            ok += r == "ok"; skip += r == "skip"; err += r == "err"
    # APK安装包（2 个）
    for fn, ft, ftn in list_folder(APK_PKG):
        if ft != "file":
            continue
        r = download(ftn, os.path.join(dst, fn), force)
        ok += r == "ok"; skip += r == "skip"; err += r == "err"
    # release(V4.0) 1 个 apk
    for fn, ft, ftn in list_folder(REL_V40):
        if ft != "file":
            continue
        r = download(ftn, os.path.join(dst, "V4.0", fn), force)
        ok += r == "ok"; skip += r == "skip"; err += r == "err"
    log(f"[apks] 完成 new={ok} skip={skip} err={err}")


def phase_docs(force):
    dst = os.path.join(REPO, "docs")
    ok = skip = err = 0
    for label, token in [("开发文档", DOC_DEV), ("测试报告", DOC_TEST),
                         ("docs(V4.0)", DOC_V40)]:
        for fn, ft, ftn in list_folder(token):
            if ft != "file":
                continue
            r = download(ftn, os.path.join(dst, fn), force)
            ok += r == "ok"; skip += r == "skip"; err += r == "err"
    log(f"[docs] 完成 new={ok} skip={skip} err={err}")


def phase_manifest():
    manifest = {
        "vehicle_images": [(n, tkn) for n, t, tkn in list_folder(VEHICLE_IMAGES) if t == "file"],
        "vehicle_videos": [(n, tkn) for n, t, tkn in list_folder(VEHICLE_VIDEOS) if t == "file"],
    }
    out = os.path.join(REPO, "scripts", "feishu_assets_manifest.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    log(f"[manifest] 写出 {out}：images={len(manifest['vehicle_images'])} videos={len(manifest['vehicle_videos'])}")


def main():
    import urllib.parse  # noqa  (list_folder 内使用)
    ap = argparse.ArgumentParser()
    ap.add_argument("--phase", default="all",
                    choices=["images", "videos", "apks", "docs", "manifest", "all"])
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--top", type=int, default=2, help="发版产物取最新 N 个版本")
    args = ap.parse_args()

    get_token()
    if args.phase == "manifest":
        phase_manifest()
    elif args.phase == "images":
        phase_images(args.force)
    elif args.phase == "videos":
        phase_videos(args.force)
    elif args.phase == "apks":
        phase_apks(args.force, args.top)
    elif args.phase == "docs":
        phase_docs(args.force)
    else:
        phase_images(args.force)
        phase_videos(args.force)
        phase_apks(args.force, args.top)
        phase_docs(args.force)
    log("DONE")


if __name__ == "__main__":
    main()
