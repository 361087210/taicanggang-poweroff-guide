#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
飞书数据分离端到端集成测试 (V5.3)
====================================
用真实飞书API验证APP的数据/产物分离设计,完全复现demo.html的调用链:
  1. tenant_access_token获取          (getFeishuToken)
  2. 项目根目录下查找/创建APP数据备份   (getDataFolderToken)
  3. 用户数据JSON上传到数据文件夹       (uploadJsonToDataFeishu)
  4. 注册申请文件上传+拉取              (pending_reg_流程,问题5闭环)
  5. 审批结果上传+下载                  (pushApprovedUsersToFeishu)
  6. 测试数据清理,不污染真实数据

运行: FEISHU_APP_ID=xxx FEISHU_APP_SECRET=xxx FEISHU_FOLDER=xxx python3 tests/test_v53_feishu_e2e.py

安全说明: 凭据从环境变量读取,严禁硬编码(GitHub密钥扫描会拦截LARK_APP_SECRET明文提交)。
"""

import json
import os
import sys
import time
import uuid
import urllib.request
import urllib.error

APP_ID = os.environ.get('FEISHU_APP_ID', '')
APP_SECRET = os.environ.get('FEISHU_APP_SECRET', '')
PROJECT_FOLDER = os.environ.get('FEISHU_FOLDER', 'WdXUfZPkClI1audQxIYc90XRnWc')
BASE = 'https://open.feishu.cn/open-apis'

if not APP_ID or not APP_SECRET:
    print('缺少凭据: 请设置环境变量 FEISHU_APP_ID / FEISHU_APP_SECRET')
    sys.exit(1)

PASS, FAIL = 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    mark = 'PASS' if cond else 'FAIL'
    if cond:
        PASS += 1
    else:
        FAIL += 1
    print(f'  [{mark}] {name}' + ('' if cond else f'  {detail}'))
    return cond


def api(method, path, token=None, body=None, raw=False):
    """飞书API调用封装(等价APP内httpFetch的浏览器分支)"""
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json; charset=utf-8')
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            content = r.read()
            return json.loads(content) if not raw else content
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'msg': e.read().decode()[:200]}


def upload_all(token, folder, name, content):
    """
    飞书upload_all上传 - multipart/form-data编码
    等价APP内FormData方式(浏览器分支)/原生插件uploadFile(APP分支)
    """
    boundary = uuid.uuid4().hex
    parts = []
    for field, value in [('file_name', name), ('parent_type', 'explorer'),
                         ('parent_node', folder), ('size', str(len(content)))]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                 f'Content-Type: application/json\r\n\r\n'.encode())
    parts.append(content)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    body = b''.join(parts)
    req = urllib.request.Request(BASE + '/drive/v1/files/upload_all', data=body, method='POST')
    req.add_header('Authorization', 'Bearer ' + token)
    req.add_header('Content-Type', f'multipart/form-data; boundary={boundary}')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'code': e.code, 'msg': e.read().decode()[:150]}


print('===== 飞书数据分离E2E集成测试 =====')

# 1. Token
r = api('POST', '/auth/v3/tenant_access_token/internal', body={'app_id': APP_ID, 'app_secret': APP_SECRET})
TOKEN = r.get('tenant_access_token', '')
check('1. tenant_access_token获取', r.get('code') == 0 and TOKEN, r.get('msg', ''))

# 2. 项目根目录结构盘点(产物区)
r = api('GET', f'/drive/v1/files?folder_token={PROJECT_FOLDER}&page_size=200', TOKEN)
check('2.1 项目根目录可访问', r.get('code') == 0, r.get('msg', ''))
root_files = (r.get('data') or {}).get('files', [])
print(f'  信息: 项目根目录(产物区)现有{len(root_files)}项: ' + ', '.join(f"{f['name']}({f['type'][:3]})" for f in root_files[:8]))

# 2.2 查找/创建APP数据备份文件夹(等价getDataFolderToken)
data_folder = next((f['token'] for f in root_files if f['type'] == 'folder' and f['name'] == 'APP数据备份'), None)
created_data_folder = False
if not data_folder:
    r = api('POST', '/drive/v1/files/create_folder', TOKEN, {'name': 'APP数据备份', 'folder_token': PROJECT_FOLDER})
    data_folder = (r.get('data') or {}).get('token')
    created_data_folder = bool(data_folder)
check('2.2 APP数据备份文件夹就绪' + ('(本次新建)' if created_data_folder else '(已存在,复用)'), bool(data_folder))

# 3. 用户数据上传到数据区(等价uploadJsonToDataFeishu)
ts = int(time.time())
test_payload = {'type': 'approved_users', 'version': 'v5.3.0-e2e-test', 'timestamp': ts,
                'users': [{'id': 9901, 'name': 'E2E测试组员', 'phone': '13900000001', 'role': 'member', 'status': 'active'}]}
up = upload_all(TOKEN, data_folder, f'e2e_test_users_{ts}.json', json.dumps(test_payload).encode())
check('3. 用户数据上传到数据区(multipart)', up.get('code') == 0, json.dumps(up)[:150])

# 4. 数据区文件列表+下载校验(等价downloadJsonFromDataFeishu)
r = api('GET', f'/drive/v1/files?folder_token={data_folder}&page_size=200', TOKEN)
data_files = (r.get('data') or {}).get('files', [])
target = next((f for f in data_files if f['name'] == f'e2e_test_users_{ts}.json'), None)
check('4.1 数据区可见新上传文件', target is not None)
if target:
    dl = api('GET', f"/drive/v1/files/{target['token']}/download", TOKEN, raw=True)
    try:
        back = json.loads(dl)
        ok = back.get('users', [{}])[0].get('phone') == '13900000001'
    except Exception:
        ok = False
    check('4.2 数据下载且内容一致(备份/更新闭环)', ok)

# 5. 产物区与数据区分离校验(核心:问题4)
r = api('GET', f'/drive/v1/files?folder_token={PROJECT_FOLDER}&page_size=200', TOKEN)
root_names = [f['name'] for f in (r.get('data') or {}).get('files', [])]
e2e_in_root = [n for n in root_names if n.startswith('e2e_test_')]
check('5. 产物区无用户数据污染(分离有效)', len(e2e_in_root) == 0, f'泄漏: {e2e_in_root}')

# 6. 注册申请文件闭环(问题5: pending_reg_流程)
pending = {'type': 'pending_registration', 'version': 'v5.3.0-e2e-test',
           'user': {'id': 9902, 'name': 'E2E待审组员', 'phone': '13900000002', 'role': 'member', 'status': 'pending'}}
up2 = upload_all(TOKEN, data_folder, f'pending_reg_e2e_{ts}.json', json.dumps(pending).encode())
check('6.1 注册申请文件上传', up2.get('code') == 0, json.dumps(up2)[:150])
r = api('GET', f'/drive/v1/files?folder_token={data_folder}&page_size=200', TOKEN)
pendings = [f for f in (r.get('data') or {}).get('files', []) if f['name'].startswith('pending_reg_')]
check('6.2 组长轮询可发现申请文件', len(pendings) >= 1, f'发现{len(pendings)}条')

# 7. 清理测试数据
cleaned = 0
r = api('GET', f'/drive/v1/files?folder_token={data_folder}&page_size=200', TOKEN)
for f in (r.get('data') or {}).get('files', []):
    if 'e2e' in f['name']:
        d = api('DELETE', f"/drive/v1/files/{f['token']}?type=file", TOKEN)
        if d.get('code') == 0:
            cleaned += 1
check('7. 测试数据清理', cleaned >= 2, f'清理{cleaned}个文件')

print('\n' + '=' * 48)
print(f'飞书E2E完成: {PASS}通过 / {FAIL}失败 / 共{PASS + FAIL}项')
print('=' * 48)
sys.exit(1 if FAIL else 0)
