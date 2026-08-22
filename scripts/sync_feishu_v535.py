#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
V5.3.5 飞书产物区双端同步脚本 (REST直连版)
====================================================
演进自 sync_feishu_v534.py, 两点升级:
  1. APK不再硬编码本地路径 —— 自动读 version.json 的 downloadUrl
     (CI发布时回写的直链) 下载到 release/, 避免版本迭代忘改清单
  2. 上传前自检: APK存在性/大小/签名块(吸取V5.3.2未签名包教训)

三阶段(默认全跑, 可单独指定):
  --clean-7z   清剿产物区 .7z/.7z.* 分卷垃圾(幂等)
  --upload     上传 V5.3.5 产物五件套(幂等: 先删同名旧档再传)
  --verify     全量验证(垃圾=0+产物齐全+分仓合规)

运行:
  python3 scripts/sync_feishu_v535.py [--clean-7z] [--upload] [--verify]
凭据(二选一):
  LARKSUITE_CLI_USER_ACCESS_TOKEN  (user身份)
  FEISHU_APP_ID + FEISHU_APP_SECRET (bot身份)
"""
import json
import os
import ssl
import struct
import sys
import time
import urllib.error
import urllib.request

FOLDER = os.environ.get('FEISHU_FOLDER', 'WdXUfZPkClI1audQxIYc90XRnWc')  # 产物区(项目根文件夹)
DATA_FOLDER_NAME = 'APP数据备份'  # 数据区(仅APP运行时写入)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = 'https://open.feishu.cn/open-apis'

PASS, FAIL = 0, 0
TOKEN = ''


def check(name, cond, detail=''):
    global PASS, FAIL
    mark = 'PASS' if cond else 'FAIL'
    PASS, FAIL = PASS + (1 if cond else 0), FAIL + (0 if cond else 1)
    print(f'  [{mark}] {name}' + ('' if cond else f'  | {detail}'))
    return cond


def get_token():
    """双模式取token: user直用 / bot换取tenant"""
    global TOKEN
    TOKEN = os.environ.get('LARKSUITE_CLI_USER_ACCESS_TOKEN', '')
    if TOKEN:
        print('  凭据模式: user_access_token(宿主注入)')
        return True
    app_id = os.environ.get('FEISHU_APP_ID', '')
    app_secret = os.environ.get('FEISHU_APP_SECRET', '')
    if app_id and app_secret:
        body = json.dumps({'app_id': app_id, 'app_secret': app_secret}).encode()
        req = urllib.request.Request(BASE + '/auth/v3/tenant_access_token/internal', data=body, method='POST')
        req.add_header('Content-Type', 'application/json; charset=utf-8')
        with urllib.request.urlopen(req, timeout=60) as r:
            TOKEN = json.loads(r.read()).get('tenant_access_token', '')
        print('  凭据模式: tenant_access_token(bot)')
        return bool(TOKEN)
    print('FATAL: 缺凭据(需 LARKSUITE_CLI_USER_ACCESS_TOKEN 或 FEISHU_APP_ID/SECRET)')
    return False


def api(method, path, body=None, raw_body=None, content_type='application/json; charset=utf-8', retries=2):
    """飞书OpenAPI调用, 带重试(限流/服务端错误退避)"""
    url = BASE + path
    data = raw_body if raw_body is not None else (json.dumps(body).encode() if body is not None else None)
    last_err = ''
    for attempt in range(retries + 1):
        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('Content-Type', content_type)
        req.add_header('Authorization', 'Bearer ' + TOKEN)
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            last_err = f'HTTP{e.code}: {e.read().decode()[:200]}'
            if e.code in (429, 500, 502, 503) and attempt < retries:
                time.sleep(1.5 * (attempt + 1))
                continue
            return {'code': e.code, 'msg': last_err}
        except Exception as e:
            last_err = str(e)[:150]
            if attempt < retries:
                time.sleep(1)
                continue
    return {'code': -1, 'msg': last_err}


def list_all(folder, label=''):
    """全量列目录(翻页; 注意分页字段是 next_page_token 非 page_token)"""
    files, page_token = [], ''
    while True:
        path = f'/drive/v1/files?folder_token={folder}&page_size=200'
        if page_token:
            path += f'&page_token={page_token}'
        d = api('GET', path)
        data = d.get('data', {})
        files.extend(data.get('files', []))
        page_token = data.get('next_page_token', '')
        if not data.get('has_more') or not page_token:
            break
    if label:
        print(f'  [盘点] {label}: {len(files)}项')
    return files


def delete_file(token):
    """删除单个文件(进回收站30天可恢复); 串行调用, 勿并发(限流1061001)"""
    return api('DELETE', f'/drive/v1/files/{token}?type=file')


def upload_all(folder, name, content, mime):
    """upload_all 直传(multipart, 单文件上限20MB; 超限需改分卷或upload_prepare)"""
    boundary = '----tcgv535sync' + str(int(time.time() * 1000))
    parts = []
    for field, value in [('file_name', name), ('parent_type', 'explorer'),
                         ('parent_node', folder), ('size', str(len(content)))]:
        parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="{field}"\r\n\r\n{value}\r\n'.encode())
    parts.append(f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
                 f'Content-Type: {mime}\r\n\r\n'.encode())
    parts.append(content)
    parts.append(f'\r\n--{boundary}--\r\n'.encode())
    return api('POST', '/drive/v1/files/upload_all', raw_body=b''.join(parts),
               content_type=f'multipart/form-data; boundary={boundary}')


def mime_of(name):
    n = name.lower()
    for ext, m in [('.apk', 'application/vnd.android.package-archive'), ('.html', 'text/html'),
                   ('.js', 'application/javascript'), ('.md', 'text/markdown'), ('.json', 'application/json')]:
        if n.endswith(ext):
            return m
    return 'application/octet-stream'


def fetch_apk():
    """下载CI产物APK到release/(读version.json的downloadUrl直链)"""
    print('=== 阶段0: 获取CI产物APK ===')
    vj_path = os.path.join(ROOT, 'version.json')
    if not os.path.exists(vj_path):
        check('version.json 存在', False)
        return None
    with open(vj_path, encoding='utf-8') as f:
        vj = json.load(f)
    url = vj.get('downloadUrl') or vj.get('apkUrl') or ''
    ver = vj.get('version', '')
    bn = vj.get('buildNumber', '')
    if not check(f'downloadUrl已回写(v{ver}-b{bn})', url.endswith('.apk') and f'V{ver}' in url, url[:90]):
        return None
    local = os.path.join(ROOT, 'release', f'tcg_v{ver.replace(".", "")}_b{bn}.apk')
    os.makedirs(os.path.dirname(local), exist_ok=True)
    # 已存在且>10MB直接复用
    if os.path.exists(local) and os.path.getsize(local) > 10 * 1024 * 1024:
        check(f'APK已存在({os.path.getsize(local) // 1024}KB)', True)
    else:
        print(f'  下载: {url}')
        ctx = ssl.create_default_context()
        with urllib.request.urlopen(url, timeout=300, context=ctx) as r, open(local, 'wb') as f:
            f.write(r.read())
        check(f'APK下载({os.path.getsize(local) // 1024}KB)', os.path.getsize(local) > 10 * 1024 * 1024)
    # 签名块自检(与CI发布关卡同逻辑, 未签名包绝不进飞书)
    data = open(local, 'rb').read()
    eocd = data.rfind(b'PK\x05\x06')
    cd_off = struct.unpack('<I', data[eocd + 16:eocd + 20])[0] if eocd >= 0 else -1
    signed = eocd >= 0 and data.rfind(b'APK Sig Block 42', 0, cd_off) == cd_off - 16
    check('APK签名块自检(v2+)', signed)
    return local if signed else None


def clean_7z():
    """阶段1: 清剿.7z垃圾(串行限速, 失败退避重试)"""
    print('=== 阶段1: 清剿 .7z 分卷垃圾 ===')
    files = list_all(FOLDER, '产物区')
    junk = [(f['name'], f['token']) for f in files
            if f.get('type') == 'file' and '.7z' in f.get('name', '').lower()]
    print(f'  待删除: {len(junk)}个')
    if not junk:
        check('.7z垃圾已清零', True)
        return
    ok, fails = 0, []
    for i, (name, tok) in enumerate(junk, 1):
        done = False
        for attempt in range(4):
            if delete_file(tok).get('code') == 0:
                done = True
                break
            time.sleep(0.8 * (attempt + 1))  # 限流退避
        ok += 1 if done else 0
        if not done:
            fails.append(name)
        if i % 40 == 0:
            print(f'    进度: {i}/{len(junk)} (成功{ok})')
        time.sleep(0.35)  # 限速: 并发会触发1061001
    check(f'.7z删除 {ok}/{len(junk)}', ok == len(junk), f'失败: {fails[:3]}')
    remain = [f['name'] for f in list_all(FOLDER)
              if f.get('type') == 'file' and '.7z' in f.get('name', '').lower()]
    check('复核: .7z残留=0', len(remain) == 0, f'仍残留{len(remain)}')


def build_artifacts():
    """组装产物五件套(APK动态获取)"""
    apk = fetch_apk() or ''
    vj = json.load(open(os.path.join(ROOT, 'version.json'), encoding='utf-8'))
    ver, bn = vj.get('version', ''), vj.get('buildNumber', '')
    return [
        (os.path.join(ROOT, 'version.json'), 'version.json'),
        (os.path.join(ROOT, 'README.md'), 'README.md'),
        (os.path.join(ROOT, 'demo.html'), 'demo.html'),
        (os.path.join(ROOT, 'vehicles_data.js'), 'vehicles_data.js'),
        (apk, f'太仓港断电指导V{ver}.apk(签名CI版-b{bn})'),
    ]


def upload_artifacts():
    """阶段2: 上传产物五件套(幂等)"""
    print('=== 阶段2: 上传产物五件套 ===')
    artifacts = build_artifacts()
    existing = {}
    for f in list_all(FOLDER):
        if f.get('type') == 'file':
            existing.setdefault(f['name'], []).append(f['token'])
    for local, remote in artifacts:
        if not local or not os.path.exists(local):
            check(f'上传 {remote}', False, '本地文件不存在(APK未就绪?)')
            continue
        content = open(local, 'rb').read()
        if len(content) > 20 * 1024 * 1024:
            check(f'上传 {remote}', False, f'超20MB上限({len(content) // 1024}KB)')
            continue
        for old_tok in existing.get(remote, []):  # 幂等: 删同名旧档
            delete_file(old_tok)
        r = upload_all(FOLDER, remote, content, mime_of(remote))
        ft = r.get('data', {}).get('file_token') or r.get('file_token')
        check(f'上传 {remote} ({len(content) // 1024}KB)', bool(ft), str(r)[:150])


def verify():
    """阶段3: 全量验证"""
    print('=== 阶段3: 全量验证 ===')
    files = list_all(FOLDER, '产物区')
    all_files = [f for f in files if f.get('type') != 'folder']
    folders = {f['name']: f['token'] for f in files if f.get('type') == 'folder'}
    junk = [f for f in all_files if '.7z' in f.get('name', '').lower()]
    check('.7z垃圾=0', len(junk) == 0, f'仍有{len(junk)}')
    for _, remote in build_artifacts():
        check(f'产物存在: {remote}', any(f['name'] == remote for f in all_files))
    # 旧版本APK清理提示(保留最近2个版本)
    apks = sorted([f['name'] for f in all_files if f['name'].endswith('.apk)') or '.apk' in f['name']])
    print(f'  [盘点] 产物区APK: {len(apks)}个')
    data_tok = folders.get(DATA_FOLDER_NAME)
    if check('数据区存在', bool(data_tok)) and data_tok:
        data_names = [f['name'] for f in list_all(data_tok, '数据区') if f.get('type') != 'folder']
        check('数据区无产物', not any('.apk' in n or n in ('version.json', 'demo.html') for n in data_names))
    check('产物区无用户JSON',
          not any('approved_users' in n or 'pending_registrations' in n or n == 'vehicle_sync_data.json'
                  for n in (f['name'] for f in all_files)))


if __name__ == '__main__':
    args = sys.argv[1:] or ['--clean-7z', '--upload', '--verify']
    print('=== V5.3.5 飞书产物区双端同步 ===')
    if not get_token():
        sys.exit(1)
    t0 = time.time()
    if '--clean-7z' in args:
        clean_7z()
    if '--upload' in args:
        upload_artifacts()
    if '--verify' in args:
        verify()
    print(f'\n{"=" * 50}\n同步完成: {PASS}通过/{FAIL}失败 (耗时{time.time() - t0:.0f}s)\n{"=" * 50}')
    sys.exit(1 if FAIL else 0)
