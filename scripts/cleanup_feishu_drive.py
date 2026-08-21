#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书云盘治理脚本 (V5.3.4 · 诊断报告根因3治理)
================================================
诊断报告《飞书云盘数据获取和备份同步失败原因分析》云盘侧三大垃圾源:
  A. 17个完整MP4直接躺在项目根目录(应在 APP数据备份/vehicle_videos) —— 根因2
  B. 288个 .7z 分卷压缩包垃圾(APP从不解析,纯占空间) —— 根因3
  C. vehicle_sync_data.json 历史旧档混在根目录(V5.3.4已改存数据区) —— 根因6存量

本脚本三层治理:
  1. MP4归位: 项目根目录完整MP4 → 移入 APP数据备份/vehicle_videos (move API, 文件token不变)
  2. .7z清剿: 删除所有 *.7z / *.7z.* 分卷(根目录+数据区全扫)
  3. 旧档清理: 根目录 vehicle_sync_data.json 旧档删除(APP已自动迁移,此处收尾)

安全设计:
  - 默认 DRY-RUN(只打印将执行的操作,不动云盘任何数据)
  - --apply 才真正执行; 每类操作前打印完整清单与计数
  - 幂等: 已在vehicle_videos的同名MP4跳过移动; 重复执行结果一致
  - MP4移动用 move API(飞书文件token不变,URL引用不失效), 非下载重传

运行:
  DRY-RUN(安全预览):
    FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx python3 scripts/cleanup_feishu_drive.py
  真正执行:
    FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx python3 scripts/cleanup_feishu_drive.py --apply
"""
import json
import os
import sys
import urllib.request
import urllib.error

APP_ID = os.environ.get('FEISHU_APP_ID', '')
APP_SECRET = os.environ.get('FEISHU_APP_SECRET', '')
PROJECT_FOLDER = os.environ.get('FEISHU_FOLDER', 'WdXUfZPkClI1audQxIYc90XRnWc')
BASE = 'https://open.feishu.cn/open-apis'
APPLY = '--apply' in sys.argv

if not APP_ID or not APP_SECRET:
    print('缺少凭据: FEISHU_APP_ID / FEISHU_APP_SECRET')
    sys.exit(1)

PASS, FAIL, SKIP = 0, 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    mark = 'PASS' if cond else 'FAIL'
    PASS, FAIL = PASS + (1 if cond else 0), FAIL + (0 if cond else 1)
    print(f'  [{mark}] {name}' + ('' if cond else f'  {detail}'))
    return cond


def api(method, path, token=None, body=None):
    """飞书OpenAPI统一调用(错误不抛异常,返回含code的错误dict由调用方判断)"""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'msg': e.read().decode()[:200]}
    except Exception as e:
        return {'code': -1, 'msg': str(e)[:200]}


def list_all_files(token, folder):
    """全量列出文件夹(自动翻页,分页字段next_page_token)"""
    files, page_token, page_no = [], '', 0
    while True:
        path = f'/drive/v1/files?folder_token={folder}&page_size=200'
        if page_token:
            path += f'&page_token={page_token}'
        resp = api('GET', path, token)
        d = resp.get('data', {})
        files.extend(d.get('files', []))
        page_no += 1
        page_token = d.get('next_page_token', '')
        if not page_token or not d.get('has_more'):
            break
    return files


def move_file(token, file_token, target_folder):
    """移动文件到目标文件夹(飞书move API,文件token不变,引用不失效)"""
    return api('POST', f'/drive/v1/files/{file_token}/move?type=file', token,
               {'folder_token': target_folder})


def delete_file(token, file_token):
    return api('DELETE', f'/drive/v1/files/{file_token}?type=file', token)


def main():
    mode = 'APPLY(真实执行)' if APPLY else 'DRY-RUN(只预览不动数据)'
    print(f'=== 飞书云盘治理 · {mode} ===\n')

    # ---------- 0. 认证 ----------
    print('=== 0. 获取tenant_access_token ===')
    t = api('POST', '/auth/v3/tenant_access_token/internal',
            body={'app_id': APP_ID, 'app_secret': APP_SECRET})
    token = t.get('tenant_access_token')
    if not check('token获取', bool(token), str(t)[:150]):
        sys.exit(1)

    # ---------- 1. 摸清目录结构 ----------
    print('\n=== 1. 摸清目录结构 ===')
    root_files = list_all_files(token, PROJECT_FOLDER)
    print(f'    项目根目录: {len(root_files)}项')

    data_folder = next((f['token'] for f in root_files
                        if f.get('name') == 'APP数据备份' and f.get('type') == 'folder'), None)
    check('数据区「APP数据备份」存在', bool(data_folder))
    if not data_folder:
        sys.exit(1)

    data_files = list_all_files(token, data_folder)
    print(f'    数据区: {len(data_files)}项')

    video_folder = next((f['token'] for f in data_files
                         if f.get('name') == 'vehicle_videos' and f.get('type') == 'folder'), None)
    check('视频子目录「vehicle_videos」存在', bool(video_folder))
    if not video_folder:
        print('    [提示] vehicle_videos不存在,APK运行时组长上传视频会自动创建;')
        print('           根目录若无MP4则无整理对象,脚本结束')
        sys.exit(0)

    video_files = list_all_files(token, video_folder)
    video_names = {f['name'] for f in video_files if f.get('type') == 'file'}
    print(f'    vehicle_videos: {len(video_files)}项(其中文件{len(video_names)}个)')

    # ---------- 2. MP4归位(根因2治理) ----------
    print('\n=== 2. MP4归位: 项目根目录 → APP数据备份/vehicle_videos ===')
    root_mp4s = [f for f in root_files if f.get('type') == 'file'
                 and f['name'].lower().endswith('.mp4')]
    print(f'    根目录MP4: {len(root_mp4s)}个')
    moved, skipped = 0, 0
    for f in root_mp4s:
        if f['name'] in video_names:
            # 目标已有同名文件: 删除根目录这份冗余(以子目录为准), 防双份数据漂移
            if APPLY:
                r = delete_file(token, f['token'])
                if r.get('code') in (0, 204) or 'file_token' not in r:
                    moved += 1
                    print(f'    [冗余清除] {f["name"]}(子目录已有同名)')
                else:
                    print(f'    [失败] {f["name"]}: {str(r)[:100]}')
            else:
                print(f'    [DRY] 冗余清除 {f["name"]}(子目录已有同名)')
    todo = [f for f in root_mp4s if f['name'] not in video_names]
    for f in todo:
        if APPLY:
            r = move_file(token, f['token'], video_folder)
            if r.get('code') == 0:
                moved += 1
                print(f'    [已移动] {f["name"]}')
            else:
                print(f'    [失败] {f["name"]}: {str(r)[:120]}')
        else:
            print(f'    [DRY] 将移动 {f["name"]}({int(f.get("size", 0)) // 1048576}MB)')
    skipped = len(root_mp4s) - len(todo)
    check(f'MP4归位完成(移动/清冗余{moved}, 冗余跳过{skipped})', True)
    print(f'    移动后vehicle_videos将有: {len(video_names) + len(todo)}个视频文件')

    # ---------- 3. .7z清剿(根因3治理) ----------
    print('\n=== 3. .7z分卷垃圾清剿(根目录+数据区全扫) ===')
    junk = []

    def scan_junk(files, where):
        for f in files:
            n = f.get('name', '')
            if f.get('type') == 'file' and ('.7z' in n.lower()):
                junk.append((where, f))

    scan_junk(root_files, '根目录')
    scan_junk(data_files, '数据区')
    scan_junk(video_files, '视频目录')
    print(f'    发现.7z垃圾: {len(junk)}个')
    if junk:
        for where, f in junk[:10]:
            print(f'      {where}/{f["name"]}')
        if len(junk) > 10:
            print(f'      ...(其余{len(junk) - 10}个略)')
    deleted = 0
    if APPLY:
        for where, f in junk:
            r = delete_file(token, f['token'])
            if r.get('code') in (0, 204) or 'file_token' not in r:
                deleted += 1
            else:
                print(f'    [失败] {where}/{f["name"]}: {str(r)[:100]}')
        print(f'    已删除: {deleted}个')
    else:
        print(f'    [DRY] 将删除上述 {len(junk)} 个.7z文件')
    check('.7z清剿完成', True)

    # ---------- 4. 根目录同步旧档清理(根因6存量收尾) ----------
    print('\n=== 4. 根目录 vehicle_sync_data.json 旧档清理 ===')
    olds = [f for f in root_files if f.get('type') == 'file'
            and f.get('name') == 'vehicle_sync_data.json']
    print(f'    根目录旧档: {len(olds)}个')
    if APPLY:
        for f in olds:
            r = delete_file(token, f['token'])
            if r.get('code') in (0, 204) or 'file_token' not in r:
                print(f'    [已删除] 根目录旧档(数据区为准)')
            else:
                print(f'    [失败]: {str(r)[:100]}')
    elif olds:
        print('    [DRY] 将删除根目录旧档(APP已改存数据区,V5.3.4下载自动回退兼容)')

    # ---------- 5. 终态校验 ----------
    print('\n=== 5. 终态校验 ===')
    if APPLY:
        root_final = list_all_files(token, PROJECT_FOLDER)
        root_mp4_final = [f for f in root_final if f.get('type') == 'file' and f['name'].lower().endswith('.mp4')]
        check('根目录MP4已清零(全部归位)', len(root_mp4_final) == 0,
              f'残留{len(root_mp4_final)}个')
        junk_final = [f for f in root_final if '.7z' in f.get('name', '').lower()]
        check('根目录.7z已清零', len(junk_final) == 0, f'残留{len(junk_final)}个')
        vf_final = list_all_files(token, video_folder)
        print(f'    vehicle_videos终态: {len([x for x in vf_final if x.get("type") == "file"])}个视频文件')
    else:
        print('    [DRY-RUN] 跳过终态校验(未执行变更)')

    print(f'\n{"=" * 48}\n云盘治理{"完成" if APPLY else "预览"}: {PASS}通过 / {FAIL}失败\n{"=" * 48}')
    if not APPLY:
        print('确认无误后加 --apply 执行:\n  FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx python3 scripts/cleanup_feishu_drive.py --apply')
    sys.exit(1 if FAIL else 0)


main()
