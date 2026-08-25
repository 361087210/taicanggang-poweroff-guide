#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书产物区同名旧档清理脚本 — V10.6.0 问题5
背景:
    历史版本迭代中,发布产物区(项目根目录)残留多份同名旧档
    (如多次上传的 version.json/demo.html/发布说明/APK)。
    同名多副本会导致组员端拉取到过期数据、更新检测误判。
    本脚本扫描根目录,按文件名分组,每组仅保留最新一份,删除其余旧档。

用法:
    export FEISHU_APP_ID=cli_aa0ce4fd91f85be8
    export FEISHU_APP_SECRET=<secret>
    # 预览模式(只报告不删除, 强烈建议先跑一遍):
    python scripts/cleanup_feishu_duplicates.py --dry-run
    # 实际清理:
    python scripts/cleanup_feishu_duplicates.py

安全设计:
    1. 默认dry-run语义需显式 --apply 才真删(双保险,防误删)
    2. 每组按修改时间倒序,最新一份永不删除
    3. 删除走飞书V1 DELETE接口且强制携带 ?type=file(否则静默失败)
    4. 全程留痕: 每个删除动作打印文件名+token,可追溯
"""
import os, sys, time, argparse, requests

APP_ID = os.environ.get("FEISHU_APP_ID", "")
APP_SECRET = os.environ.get("FEISHU_APP_SECRET", "")
ROOT_FOLDER = "WdXUfZPkClI1audQxIYc90XRnWc"   # 项目根目录(与APP内置一致)

FEISHU_API = "https://open.feishu.cn/open-apis"
TOKEN_URL = f"{FEISHU_API}/auth/v3/tenant_access_token/internal"
LIST_URL = f"{FEISHU_API}/drive/v1/files"
DELETE_URL = f"{FEISHU_API}/drive/v1/files/{{token}}"


def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")


def get_token():
    resp = requests.post(TOKEN_URL, json={"app_id": APP_ID, "app_secret": APP_SECRET}, timeout=30)
    data = resp.json()
    if data.get("code") != 0:
        log(f"获取token失败: {data}")
        sys.exit(1)
    return data["tenant_access_token"]


def list_files(token, folder_token):
    """列出文件夹下全部文件(自动翻页, 分页字段next_page_token, 单页上限200)"""
    files, page_token = [], None
    while True:
        params = {"folder_token": folder_token, "page_size": 200}
        if page_token:
            params["page_token"] = page_token
        resp = requests.get(LIST_URL, headers={"Authorization": f"Bearer {token}"}, params=params, timeout=30)
        data = resp.json()
        if data.get("code") != 0:
            raise Exception(f"列目录失败: {data.get('msg')}")
        d = data.get("data", {})
        files.extend(d.get("files", []))
        page_token = d.get("next_page_token")
        if not d.get("has_more") or not page_token:
            return files


def delete_file(token, file_token):
    """删除单个文件——必须带 ?type=file, 否则飞书返回404静默失败"""
    resp = requests.delete(f"{DELETE_URL.format(token=file_token)}?type=file",
                           headers={"Authorization": f"Bearer {token}"}, timeout=30)
    try:
        data = resp.json()
        return data.get("code") == 0
    except Exception:
        return resp.status_code == 200


def _mtime(f):
    """文件修改时间(飞书返回created_time秒级时间戳; 缺失则视为最旧)"""
    try:
        return int(f.get("modified_time") or f.get("created_time") or 0)
    except (TypeError, ValueError):
        return 0


def main():
    parser = argparse.ArgumentParser(description="飞书产物区同名旧档清理")
    parser.add_argument("--apply", action="store_true",
                        help="实际执行删除(缺省为dry-run预览,只报告不删除)")
    parser.add_argument("--folder", default=ROOT_FOLDER, help="目标文件夹token(缺省为项目根目录)")
    args = parser.parse_args()

    if not APP_ID or not APP_SECRET:
        log("缺少环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET")
        sys.exit(1)

    token = get_token()
    log("飞书token获取成功, 开始扫描产物区 ...")
    files = [f for f in list_files(token, args.folder) if f.get("type") == "file"]
    log(f"产物区共 {len(files)} 个文件")

    # 按文件名分组
    groups = {}
    for f in files:
        groups.setdefault(f["name"], []).append(f)

    dup_groups = {k: v for k, v in groups.items() if len(v) > 1}
    if not dup_groups:
        log("未发现同名重复文件, 产物区干净 ✓")
        return

    log(f"发现 {len(dup_groups)} 组同名重复文件:")
    to_delete = []
    for name, items in sorted(dup_groups.items()):
        items.sort(key=_mtime, reverse=True)   # 最新在前
        keep, olds = items[0], items[1:]
        log(f"  「{name}」 x{len(items)}: 保留最新({_fmt_time(_mtime(keep))}), 清理{len(olds)}份旧档")
        for o in olds:
            to_delete.append((name, o["token"], _mtime(o)))

    if not args.apply:
        log(f"[dry-run] 共 {len(to_delete)} 份旧档待清理(未实际删除)。确认无误后加 --apply 执行。")
        return

    ok, fail = 0, 0
    for name, ftoken, mt in to_delete:
        if delete_file(token, ftoken):
            ok += 1
            log(f"  已删除: {name} (token={ftoken}, 时间={_fmt_time(mt)})")
        else:
            fail += 1
            log(f"  删除失败: {name} (token={ftoken})")
    log(f"清理完成: 成功{ok} 失败{fail} ✓" if fail == 0 else f"清理结束: 成功{ok} 失败{fail} ⚠")


def _fmt_time(ts):
    return time.strftime('%Y-%m-%d %H:%M', time.localtime(ts)) if ts else "未知时间"


if __name__ == "__main__":
    main()
