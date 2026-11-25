#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
process_media_delete_queue.py — 资源库「硬删除」后台清理作业（V10.28.4）

背景:
  App 端「移出资源库」分软删除（回收站，可恢复）与硬删除（彻底删除）。
  硬删除只做三件本地能保证的事: 立刻隐藏、回收站留审计记录、把待清理项写入
  飞书「APP数据备份/media_delete_queue.json」。真正的文件清理由本脚本执行，
  由 .github/workflows/media-hard-delete.yml 每 15 分钟触发。

一次消费对一个路径做的事:
  1. COS: 照片 key = 相对路径; 视频 key = media-library/baseline/<Release 资产名>
  2. 飞书云盘: APP数据备份/<vehicle_images|vehicle_videos>/<车型目录>/<文件>
  3. GitHub: 照片 git rm; 视频删除 media-videos Release 资产并清掉直链映射
  4. 重建索引: media_library.json + vehicle_media_mapping/manifest
  5. 回写队列状态(done/error)到飞书, App 下次拉取即可看到进度

为什么不在 App 里直删: COS 与 GitHub 的写权限都在 CI Secrets，客户端只有飞书凭据；
队列让删除成为幂等的后台作业 —— 弱网/离线/App 被杀都不会丢删除意图。

用法:
  export FEISHU_APP_ID=... FEISHU_APP_SECRET=...
  export TCG_COS_SECRET_ID=... TCG_COS_SECRET_KEY=...
  export GH_TOKEN=ghp_xxx              # 需要 repo contents:write
  python scripts/process_media_delete_queue.py [--dry-run] [--probe] [--enqueue PATH...] [--max-items N]

退出码: 0 = 无待处理/全部成功; 1 = 至少一条失败(下轮自动重试)
"""
import argparse
import hashlib
import hmac
import json
import os
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VERSION_FILE = os.path.join(ROOT, 'version.json')
QUEUE_NAME = 'media_delete_queue.json'
DATA_FOLDER_NAME = 'APP数据备份'
RELEASE_TAG = 'media-videos'
OWNER = '361087210'
REPO = 'taicanggang-poweroff-guide'

COS_BUCKET = os.environ.get('TCG_COS_BUCKET', 'tcg-poweroff-guide-1539213542')
COS_REGION = os.environ.get('TCG_COS_REGION', 'ap-shanghai')
COS_HOST = '%s.cos.%s.myqcloud.com' % (COS_BUCKET, COS_REGION)

FEISHU_BASE = 'https://open.feishu.cn/open-apis'


def log(msg):
    sys.stdout.write(str(msg) + '\n')
    sys.stdout.flush()


def env(name):
    return os.environ.get(name, '').strip()


# ---------------------------------------------------------------- 飞书
class Feishu(object):
    def __init__(self):
        self.app_id = env('FEISHU_APP_ID')
        self.app_secret = env('FEISHU_APP_SECRET')
        self.root = env('FEISHU_FOLDER_TOKEN') or self._root_from_version()
        self.token = ''

    @staticmethod
    def _root_from_version():
        try:
            with open(VERSION_FILE, 'r', encoding='utf-8') as f:
                cfg = json.load(f).get('feishuConfig') or {}
            return cfg.get('folderToken') or cfg.get('folder') or ''
        except Exception:
            return ''

    def ready(self):
        return bool(self.app_id and self.app_secret and self.root)

    def auth(self):
        body = json.dumps({'app_id': self.app_id, 'app_secret': self.app_secret}).encode()
        req = urllib.request.Request(
            FEISHU_BASE + '/auth/v3/tenant_access_token/internal',
            data=body, headers={'Content-Type': 'application/json'}, method='POST')
        with urllib.request.urlopen(req, timeout=30) as r:
            data = json.loads(r.read().decode('utf-8'))
        if data.get('code') != 0:
            raise RuntimeError('飞书鉴权失败: %s' % data.get('msg'))
        self.token = data.get('tenant_access_token', '')
        return self.token

    def _headers(self):
        return {'Authorization': 'Bearer ' + self.token}

    def _json(self, method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        headers = self._headers()
        if data is not None:
            headers['Content-Type'] = 'application/json'
        req = urllib.request.Request(FEISHU_BASE + path, data=data, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read().decode('utf-8'))

    def children(self, folder_token):
        out = []
        page = ''
        for _ in range(20):
            q = '?folder_token=%s&page_size=200' % urllib.parse.quote(folder_token)
            if page:
                q += '&page_token=' + urllib.parse.quote(page)
            data = self._json('GET', '/drive/v1/files' + q)
            if data.get('code') != 0:
                raise RuntimeError('列目录失败: %s' % data.get('msg'))
            d = data.get('data') or {}
            out.extend(d.get('files') or [])
            page = d.get('next_page_token') or ''
            if not d.get('has_more') or not page:
                break
        return out

    def child(self, folder_token, name, kind=None):
        for f in self.children(folder_token):
            if f.get('name') != name:
                continue
            if kind and f.get('type') != kind:
                continue
            return f
        return None

    def download(self, file_token):
        req = urllib.request.Request(
            FEISHU_BASE + '/drive/v1/files/%s/download' % file_token,
            headers=self._headers(), method='GET')
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.read()

    def delete(self, file_token):
        data = self._json('DELETE', '/drive/v1/files/%s?type=file' % file_token)
        if data.get('code') != 0:
            raise RuntimeError('删除文件失败: %s' % data.get('msg'))

    def upload(self, folder_token, name, payload):
        boundary = '----tcgqueue%s' % hashlib.sha1(str(time.time()).encode()).hexdigest()[:12]
        fields = {
            'file_name': name,
            'parent_type': 'explorer',
            'parent_node': folder_token,
            'size': str(len(payload)),
        }
        body = b''
        for k, v in fields.items():
            body += ('--%s\r\nContent-Disposition: form-data; name="%s"\r\n\r\n%s\r\n'
                     % (boundary, k, v)).encode('utf-8')
        body += ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\n'
                 'Content-Type: application/json\r\n\r\n' % (boundary, name)).encode('utf-8')
        body += payload + ('\r\n--%s--\r\n' % boundary).encode('utf-8')
        req = urllib.request.Request(
            FEISHU_BASE + '/drive/v1/files/upload_all', data=body,
            headers={'Authorization': 'Bearer ' + self.token,
                     'Content-Type': 'multipart/form-data; boundary=' + boundary},
            method='POST')
        with urllib.request.urlopen(req, timeout=120) as r:
            data = json.loads(r.read().decode('utf-8'))
        if data.get('code') != 0:
            raise RuntimeError('上传文件失败: %s' % data.get('msg'))


# ---------------------------------------------------------------- COS
def cos_signature(secret_id, secret_key, method, key, host, now=None):
    """腾讯云 COS 请求签名(q-sign-algorithm=sha1, 只签 host 头)。"""
    start = int(now if now is not None else time.time()) - 60
    end = start + 900
    key_time = '%d;%d' % (start, end)
    sign_key = hmac.new(secret_key.encode(), key_time.encode(), hashlib.sha1).hexdigest()
    uri = '/' + urllib.parse.quote(key, safe='/~')
    http_string = '%s\n%s\n\nhost=%s\n' % (method.lower(), uri, host)
    string_to_sign = 'sha1\n%s\n%s\n' % (key_time, hashlib.sha1(http_string.encode()).hexdigest())
    signature = hmac.new(sign_key.encode(), string_to_sign.encode(), hashlib.sha1).hexdigest()
    return ('q-sign-algorithm=sha1&q-ak=%s&q-sign-time=%s&q-key-time=%s'
            '&q-header-list=host&q-url-param-list=&q-signature=%s'
            % (secret_id, key_time, key_time, signature))


def cos_delete(key):
    """删除一个 COS 对象; 404 视为已删除(幂等)。缺密钥抛错由调用方记 error。"""
    secret_id = env('TCG_COS_SECRET_ID')
    secret_key = env('TCG_COS_SECRET_KEY')
    if not secret_id or not secret_key:
        raise RuntimeError('缺少 COS 密钥(TCG_COS_SECRET_ID / TCG_COS_SECRET_KEY)')
    url = 'https://%s/%s' % (COS_HOST, urllib.parse.quote(key, safe='/~'))
    req = urllib.request.Request(url, headers={
        'Host': COS_HOST,
        'Authorization': cos_signature(secret_id, secret_key, 'DELETE', key, COS_HOST),
    }, method='DELETE')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            if r.status not in (200, 204):
                raise RuntimeError('COS 删除返回 HTTP %s' % r.status)
    except urllib.error.HTTPError as e:
        if e.code != 404:
            raise RuntimeError('COS 删除返回 HTTP %s' % e.code)


def cos_probe():
    """自检 COS 凭据/策略/桶连通性: 对一个必然不存在的 key 发 DELETE。

    不删除任何真实对象, 只读回 HTTP 状态与 COS 错误码, 用于密钥补全后首次核验:
      204 (或 404 NoSuchKey) → 正常(凭据可用 + 有 DeleteObject 权限)
      403 AccessDenied     → 凭据可用但子用户策略缺 cos:DeleteObject
      403 SignatureDoesNotMatch / InvalidAccessKeyId → 密钥不对
      404 NoSuchBucket     → 桶名或地域不对
    """
    secret_id = env('TCG_COS_SECRET_ID')
    secret_key = env('TCG_COS_SECRET_KEY')
    key = '_probe/never-exists.txt'
    log('[probe] bucket=%s region=%s key=%s' % (COS_BUCKET, COS_REGION, key))
    log('[probe] 密钥注入: id=%s key=%s' % ('有' if secret_id else '缺', '有' if secret_key else '缺'))
    if not secret_id or not secret_key:
        log('[probe] FAIL 缺少 TCG_COS_SECRET_ID / TCG_COS_SECRET_KEY')
        return 1
    url = 'https://%s/%s' % (COS_HOST, urllib.parse.quote(key, safe='/~'))
    req = urllib.request.Request(url, headers={
        'Host': COS_HOST,
        'Authorization': cos_signature(secret_id, secret_key, 'DELETE', key, COS_HOST),
    }, method='DELETE')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            # COS 的 DELETE 是幂等的: 对象不存在也返回 204(部分配置返回 404),
            # 能拿到 2xx 就说明签名被接受且 DeleteObject 权限通过
            log('[probe] HTTP %s' % r.status)
            log('[probe] PASS 凭据可用, DeleteObject 权限正常(对象不存在时 COS 亦返回 204)')
            return 0
    except urllib.error.HTTPError as e:
        body = e.read().decode('utf-8', 'replace')[:800]
        code = ''
        m = re.search(r'<Code>([^<]+)</Code>', body)
        if m:
            code = m.group(1)
        log('[probe] HTTP %s Code=%s' % (e.code, code or '(无)'))
        log(body)
        if e.code == 404 and code in ('NoSuchKey', 'NoSuchObject', ''):
            log('[probe] PASS 凭据可用, DeleteObject 权限正常')
            return 0
        if e.code == 403 and code == 'AccessDenied':
            log('[probe] FAIL 凭据可用, 但子用户策略缺少 cos:DeleteObject')
        elif e.code == 403:
            log('[probe] FAIL 密钥不正确(SignatureDoesNotMatch / InvalidAccessKeyId)')
        elif e.code == 404:
            log('[probe] FAIL 桶名或地域不对(NoSuchBucket)')
        else:
            log('[probe] FAIL 未预期响应')
        return 1
    except Exception as e:
        log('[probe] FAIL 请求异常: %s' % e)
        return 1


# ---------------------------------------------------------------- GitHub
def gh_api(path, method='GET'):
    token = env('GH_TOKEN') or env('GITHUB_TOKEN')
    if not token:
        raise RuntimeError('缺少 GH_TOKEN')
    req = urllib.request.Request('https://api.github.com' + path, method=method, headers={
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
    })
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode('utf-8')
    return json.loads(raw) if raw else {}


def release_assets():
    data = gh_api('/repos/%s/%s/releases/tags/%s' % (OWNER, REPO, RELEASE_TAG))
    return {a['name']: a for a in (data.get('assets') or [])}


_ASSETS_CACHE = {}


def cached_assets():
    """Release 资产表按次缓存: 一个队列里多条视频时不重复打 GitHub API。"""
    if not _ASSETS_CACHE:
        _ASSETS_CACHE.update(release_assets())
    return _ASSETS_CACHE


# ---------------------------------------------------------------- 映射
def load_release_map():
    p = os.path.join(ROOT, 'docs', 'media_release_map.json')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'map': {}}


def save_release_map(data):
    p = os.path.join(ROOT, 'docs', 'media_release_map.json')
    with open(p, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=1)
        f.write('\n')


def asset_candidates(path, rel_map):
    """视频路径 → 可能的 Release 资产名(去掉目录后的文件名查映射, 再回退原名)。"""
    name = os.path.basename(path)
    out = []
    mapped = (rel_map.get('map') or {}).get(name)
    if mapped:
        out.append(mapped)
    if name not in out:
        out.append(name)
    return out


def strip_bootstrap_asset(original, asset):
    """从 js/00-bootstrap.js 的 MEDIA_DIRECT_ASSETS 中移除一条直链映射。"""
    p = os.path.join(ROOT, 'js', '00-bootstrap.js')
    try:
        with open(p, 'r', encoding='utf-8') as f:
            lines = f.readlines()
    except Exception:
        return False
    pat = re.compile(r"^\s*'%s'\s*:\s*'%s'\s*,?\s*$" % (re.escape(original), re.escape(asset)))
    kept = [ln for ln in lines if not pat.match(ln.rstrip('\n'))]
    if len(kept) == len(lines):
        return False
    with open(p, 'w', encoding='utf-8') as f:
        f.writelines(kept)
    return True


# ---------------------------------------------------------------- 单项处理
def handle_item(item, feishu, data_folder, rel_map, dry):
    """清理一个路径; 返回 (ok, message)。dry=True 只打印计划。"""
    path = item.get('path') or ''
    kind = item.get('kind') or ('video' if path.lower().endswith(('.mp4', '.mov', '.m4v', '.webm')) else 'photo')
    name = os.path.basename(path)
    notes = []

    if not path.startswith('vehicle_images/') and not path.startswith('vehicle_videos/'):
        return False, '非法路径(只允许 vehicle_images/ 或 vehicle_videos/): %s' % path

    # 1) COS
    if kind == 'video':
        if dry:
            asset = asset_candidates(path, rel_map)[0]
        else:
            assets = cached_assets()
            asset = next((c for c in asset_candidates(path, rel_map) if c in assets), None)
        cos_keys = ['media-library/baseline/%s' % (asset or name)]
    else:
        cos_keys = [path]
    for key in cos_keys:
        if dry:
            log('    [dry] COS DELETE %s' % key)
        else:
            cos_delete(key)
            notes.append('COS:' + key)

    # 2) 飞书云盘
    parts = path.split('/')
    if len(parts) >= 3:
        top, folder = parts[0], parts[1]
        sub_name = '/'.join(parts[2:])
        if dry:
            log('    [dry] 飞书 DELETE %s/%s/%s' % (top, folder, sub_name))
        else:
            top_f = feishu.child(data_folder, top, 'folder')
            car_f = feishu.child(top_f['token'], folder, 'folder') if top_f else None
            f = feishu.child(car_f['token'], sub_name, 'file') if car_f else None
            if f:
                feishu.delete(f['token'])
                notes.append('飞书:已删除')
            else:
                notes.append('飞书:已不存在')

    # 3) GitHub
    if kind == 'video':
        if dry:
            log('    [dry] 删除 Release 资产 %s' % name)
        else:
            try:
                assets = cached_assets()
                originals = [k for k, v in (rel_map.get('map') or {}).items() if v == name]
                hit = assets.get(name)
                if not hit:
                    for orig in originals or [name]:
                        hit = assets.get(orig)
                        if hit:
                            break
                if hit:
                    gh_api('/repos/%s/%s/releases/assets/%s' % (OWNER, REPO, hit['id']), 'DELETE')
                    notes.append('GitHub:资产已删除')
                else:
                    notes.append('GitHub:资产不存在')
                # 清掉直链映射, 避免前端继续指向已删资产
                rel_map['map'] = {k: v for k, v in (rel_map.get('map') or {}).items() if v != name}
                for orig in originals:
                    strip_bootstrap_asset(orig, name)
                notes.append('映射已清理')
            except Exception as e:
                return False, 'GitHub 清理失败: %s' % e
    else:
        if dry:
            log('    [dry] git rm %s' % path)
        else:
            r = subprocess.run(['git', 'rm', '--ignore-unmatch', '-q', path], cwd=ROOT)
            if r.returncode != 0:
                return False, 'git rm 失败(exit %s)' % r.returncode
            notes.append('GitHub:照片已删除')

    return True, '; '.join(notes) or '已处理'


def rebuild_indexes(dry):
    if dry:
        log('  [dry] 跳过索引重建')
        return
    for cmd, label in (
        (['node', 'scripts/gen_media_library.js'], 'media_library.json'),
        (['node', 'scripts/gen_media_mapping.js'], 'mapping/manifest'),
    ):
        r = subprocess.run(cmd, cwd=ROOT)
        if r.returncode != 0:
            raise RuntimeError('重建 %s 失败(exit %s)' % (label, r.returncode))
        log('  重建 %s 完成' % label)


def enqueue_paths(feishu, data_folder_token, paths, dry):
    """把待删路径写进飞书清理队列(与 App 写同一个文件), 供运维验证/补删使用。"""
    now = int(time.time() * 1000)
    items = []
    for p in paths:
        p = (p or '').strip().lstrip('/')
        if not p:
            continue
        if not p.startswith(('vehicle_images/', 'vehicle_videos/')):
            raise RuntimeError('路径不在媒体目录白名单内: %s' % p)
        items.append({'path': p, 'kind': 'video' if p.startswith('vehicle_videos/') else 'photo',
                      'owners': [], 'at': now, 'status': 'pending', 'tries': 0, 'source': 'cli'})
    if not items:
        raise RuntimeError('没有可入队的路径')
    state = {'schemaVersion': 1, 'updatedAt': now, 'items': []}
    old = feishu.child(data_folder_token, QUEUE_NAME, 'file')
    if old:
        try:
            state = json.loads(feishu.download(old['token']).decode('utf-8'))
        except Exception as e:
            log('[enqueue] 现有队列无法解析, 将新建: %s' % e)
    by_path = {it.get('path'): it for it in (state.get('items') or []) if it.get('path')}
    for it in items:
        # 与 App 一致: 同路径覆盖并重置为 pending
        by_path[it['path']] = it
    state['items'] = list(by_path.values())
    state['updatedAt'] = now
    log('[enqueue] 入队 %d 条, 队列共 %d 条: %s'
        % (len(items), len(by_path), ', '.join(it['path'] for it in items)))
    if dry:
        log('[enqueue] [dry] 不写回')
        return
    if old:
        feishu.delete(old['token'])
    feishu.upload(data_folder_token, QUEUE_NAME,
                  json.dumps(state, ensure_ascii=False, indent=2).encode('utf-8'))
    log('[enqueue] 已写回 %s' % QUEUE_NAME)


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true', help='只打印计划, 不删不改不写回')
    ap.add_argument('--max-items', type=int, default=30, help='单次最多处理条数(默认 30)')
    ap.add_argument('--probe', action='store_true', help='只自检 COS 凭据连通性, 不读队列不删文件')
    ap.add_argument('--enqueue', nargs='+', metavar='PATH',
                    help='先把路径写进飞书清理队列再消费(与 App 写同一文件)')
    args = ap.parse_args()
    dry = args.dry_run

    if args.probe:
        return cos_probe()

    feishu = Feishu()
    if not feishu.ready():
        log('[queue] 缺少飞书凭据(FEISHU_APP_ID/SECRET/FOLDER_TOKEN), 无法读取删除队列')
        return 1
    feishu.auth()
    data_folder = feishu.child(feishu.root, DATA_FOLDER_NAME, 'folder')
    if not data_folder:
        log('[queue] 未找到「%s」目录, 无事可做' % DATA_FOLDER_NAME)
        return 0
    if args.enqueue:
        enqueue_paths(feishu, data_folder['token'], args.enqueue, dry)
        # 只入队: 消费需要 COS/GitHub 凭据, 由后续步骤(或下一轮定时任务)负责
        return 0
    qf = feishu.child(data_folder['token'], QUEUE_NAME, 'file')
    if not qf:
        log('[queue] 没有 %s, 无事可做' % QUEUE_NAME)
        return 0
    try:
        queue = json.loads(feishu.download(qf['token']).decode('utf-8'))
    except Exception as e:
        log('[queue] 队列解析失败: %s' % e)
        return 1
    items = queue.get('items') or []
    pending = [it for it in items if it.get('path') and it.get('status') != 'done']
    log('[queue] 共 %d 条, 待处理 %d 条' % (len(items), len(pending)))
    if not pending:
        return 0

    rel_map = load_release_map()
    rel_before = json.dumps(rel_map, ensure_ascii=False, sort_keys=True)
    results = {}
    for it in pending[:max(1, args.max_items)]:
        path = it['path']
        log('  → %s' % path)
        try:
            ok, msg = handle_item(it, feishu, data_folder['token'], rel_map, dry)
        except Exception as e:
            ok, msg = False, str(e)
        it['status'] = 'done' if ok else 'error'
        it['tries'] = int(it.get('tries') or 0) + 1
        it['processedAt'] = int(time.time() * 1000)
        it['result'] = msg
        results[path] = (ok, msg)
        log('    %s %s' % ('OK' if ok else 'FAIL', msg))

    if not dry:
        rebuild_indexes(dry)
        if json.dumps(rel_map, ensure_ascii=False, sort_keys=True) != rel_before:
            save_release_map(rel_map)
        # 回写前重新拉一次, 避免覆盖 App 期间新排的请求(以 path 为键只更新状态)
        try:
            fresh = json.loads(feishu.download(feishu.child(data_folder['token'], QUEUE_NAME, 'file')['token']).decode('utf-8'))
        except Exception:
            fresh = queue
        by_path = {it.get('path'): it for it in (fresh.get('items') or []) if it.get('path')}
        for p, (ok, msg) in results.items():
            if p in by_path:
                by_path[p].update({
                    'status': 'done' if ok else 'error',
                    'tries': int(by_path[p].get('tries') or 0) + 1,
                    'processedAt': int(time.time() * 1000),
                    'result': msg,
                })
        fresh['updatedAt'] = int(time.time() * 1000)
        fresh['items'] = list(by_path.values())
        old = feishu.child(data_folder['token'], QUEUE_NAME, 'file')
        if old:
            feishu.delete(old['token'])
        feishu.upload(data_folder['token'], QUEUE_NAME,
                      json.dumps(fresh, ensure_ascii=False).encode('utf-8'))
        log('[queue] 已回写队列状态')

    failed = [p for p, (ok, _) in results.items() if not ok]
    log('[queue] 完成: 成功 %d, 失败 %d' % (len(results) - len(failed), len(failed)))
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
