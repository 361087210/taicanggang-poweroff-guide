#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5.3 飞书产物同步 (产物/数据分仓架构)
======================================
产物区: 项目根文件夹 (文档/APK/version.json/README)
数据区: APP数据备份 子文件夹 (仅由APP运行时写入,本脚本只验证存在性不写入)

运行: FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx python3 sync_feishu_v53.py
"""
import json
import os
import sys
import time
import urllib.request
import urllib.error

APP_ID = os.environ.get('FEISHU_APP_ID', '')
APP_SECRET = os.environ.get('FEISHU_APP_SECRET', '')
PROJECT_FOLDER = os.environ.get('FEISHU_FOLDER', 'WdXUfZPkClI1audQxIYc90XRnWc')
BASE = 'https://open.feishu.cn/open-apis'
ROOT = '/workspace/taicanggang-poweroff-guide'

if not APP_ID or not APP_SECRET:
    print('缺少凭据: FEISHU_APP_ID / FEISHU_APP_SECRET')
    sys.exit(1)

PASS, FAIL = 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    mark = 'PASS' if cond else 'FAIL'
    PASS, FAIL = PASS + (1 if cond else 0), FAIL + (0 if cond else 1)
    print(f'  [{mark}] {name}' + ('' if cond else f'  {detail}'))
    return cond


def api(method, path, token=None, body=None):
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


def upload_all(token, folder, name, content):
    """飞书upload_all直传(multipart/form-data),上限20MB"""
    boundary = '----tcgv53sync' + str(int(time.time()))
    parts = []
    for field, value in [('file_name', name), ('parent_type', 'explorer'),
                         ('parent_node', folder), ('size', str(len(content)))]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    mime = 'application/vnd.android.package-archive' if name.endswith('.apk') else (
        'text/html' if name.endswith('.html') else 'application/json')
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                 f'Content-Type: {mime}\r\n\r\n'.encode())
    parts.append(content)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    body = b''.join(parts)
    req = urllib.request.Request(BASE + '/drive/v1/files/upload_all', data=body, method='POST')
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'msg': e.read().decode()[:200]}


def main():
    print('=== 1. 获取tenant_access_token ===')
    t = api('POST', '/auth/v3/tenant_access_token/internal', body={'app_id': APP_ID, 'app_secret': APP_SECRET})
    token = t.get('tenant_access_token')
    if not check('token获取', bool(token), str(t)[:150]):
        sys.exit(1)

    print('=== 2. 验证/创建 APP数据备份 数据区 ===')
    children = api('GET', f'/drive/v1/files?folder_token={PROJECT_FOLDER}&page_size=200', token)
    data_folder = None
    for f in children.get('data', {}).get('files', []):
        if f.get('name') == 'APP数据备份' and f.get('type') == 'folder':
            data_folder = f.get('token')
            break
    if not data_folder:
        created = api('POST', '/drive/v1/files/create_folder', token,
                      {'name': 'APP数据备份', 'folder_token': PROJECT_FOLDER})
        data_folder = created.get('data', {}).get('token')
    check('数据区APP数据备份就绪', bool(data_folder))
    print(f'    数据区token: {data_folder}')

    print('=== 3. 上传产物到产物区(与数据区物理分离) ===')
    artifacts = [
        ('docs/太仓港断电指导APP开发文档V5.3.html', '太仓港断电指导APP开发文档V5.3.html'),
        ('docs/V5.4迭代计划.html', 'V5.4迭代计划.html'),
        ('version.json', 'version.json'),
        ('README.md', 'README.md'),
        ('release/太仓港断电指导V5.3.apk', '太仓港断电指导V5.3.apk(签名版)'),
    ]
    for local, remote in artifacts:
        p = os.path.join(ROOT, local)
        if not os.path.exists(p):
            check(f'上传 {remote}', False, '本地文件不存在')
            continue
        content = open(p, 'rb').read()
        if len(content) > 20 * 1024 * 1024:
            check(f'上传 {remote}', False, f'超过20MB上限({len(content)}字节)')
            continue
        r = upload_all(token, PROJECT_FOLDER, remote, content)
        ok = r.get('data', {}).get('file_token') or r.get('file_token')
        check(f'上传 {remote} ({len(content)//1024}KB)', bool(ok), str(r)[:150])

    print('=== 4. 分离校验: 数据区不含产物,产物区不含用户数据 ===')
    prod_files = [f.get('name') for f in children.get('data', {}).get('files', []) if f.get('type') != 'folder']
    data_children = api('GET', f'/drive/v1/files?folder_token={data_folder}&page_size=200', token)
    data_files = [f.get('name') for f in data_children.get('data', {}).get('files', [])]
    check('产物区无用户JSON(approved_users/pending_registrations)',
          not any('approved_users' in n or 'pending_registrations' in n or 'vehicle_backup' in n for n in prod_files))
    check('数据区无APK/文档产物',
          not any(n.endswith('.apk') or '开发文档' in n for n in data_files))
    print(f'    数据区现有: {data_files[:8]}')

    print(f'\n{"="*48}\n飞书同步完成: {PASS}通过 / {FAIL}失败 / 共{PASS+FAIL}项\n{"="*48}')
    sys.exit(1 if FAIL else 0)


main()
