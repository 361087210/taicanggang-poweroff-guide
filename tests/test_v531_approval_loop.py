#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
太仓港断电指导APP V5.3.1 审批闭环接线验证测试套件
===================================================
背景: V5.3实现了跨设备审批的全部零件(轮询器/审批结果上传/组员拉取),
      但三个关键函数从未被调用(死代码),导致用户报告:
      "两台手机不在同一网络下,组员注册申请组长收不到"
V5.3.1修复: 把死代码接入登录/审批/登出/启动四个生命周期点,闭环真正打通。

验证点:
  A1: doLogin为async且pending用户先查云端审批结果再决定拦截/放行
  A2: 组长登录成功后启动60秒轮询(startPendingPolling接线)
  A3: 会话恢复(启动免登录)同样启动轮询
  A4: 退出登录停止轮询(stopPendingPolling接线)
  B1: approveMember通过审批后推送结果到飞书
  B2: rejectMember拒绝审批后推送结果到飞书
  B3: deleteMember删除组员后推送(组员列表云端一致)
  B4: resetMemberPass重置密码后推送(新密码可跨设备登录)
  C1: pullApprovedStatusFromFeishu支持传入用户参数(登录前currentUser未赋值场景)
  C2: 轮询器内部仅对active组长生效(权限防御)
  D1: JS整体语法通过node --check
  D2: 无空catch块(编程规范)

运行: python3 tests/test_v531_approval_loop.py
"""

import os
import re
import subprocess
import sys
import tempfile

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEMO = os.path.join(BASE, 'demo.html')

PASS, FAIL = 0, 0


def check(name, cond, detail=''):
    global PASS, FAIL
    if cond:
        PASS += 1
        print(f'  [PASS] {name}')
    else:
        FAIL += 1
        print(f'  [FAIL] {name}  {detail}')


def section(t):
    print(f'\n===== {t} =====')


html = open(DEMO, encoding='utf-8').read()

# 提取doLogin函数体(到下一个function或注释块)
def func_body(name):
    m = re.search(r'(?:async\s+)?function\s+' + name + r'\s*\([^)]*\)\s*\{', html)
    if not m:
        return ''
    start = m.end()
    depth = 1
    i = start
    while i < len(html) and depth > 0:
        if html[i] == '{':
            depth += 1
        elif html[i] == '}':
            depth -= 1
        i += 1
    return html[start:i - 1]


section('A 登录/登出生命周期接线')
login = func_body('doLogin')
logout = func_body('doLogout')

check('A1 doLogin为async且pending先查云端',
      'async' in html[:html.find('function doLogin') + 30] and
      'pullApprovedStatusFromFeishu(user)' in login,
      'doLogin应async化,且pending分支调用pullApprovedStatusFromFeishu(user)')
check('A2 组长登录启动轮询', 'startPendingPolling()' in login,
      'doLogin的admin分支应调用startPendingPolling()')
check('A3 会话恢复启动轮询',
      re.search(r'if\(restoreSession\(\)\)\{[\s\S]{0,400}startPendingPolling\(\)', html) is not None,
      'restoreSession()为true的admin分支应调用startPendingPolling()')
check('A4 退出登录停止轮询', 'stopPendingPolling();' in logout,
      'doLogout应先调用stopPendingPolling()')

section('B 审批动作结果推送')
for fname, label in [('approveMember', 'B1 通过审批'),
                     ('rejectMember', 'B2 拒绝审批'),
                     ('deleteMember', 'B3 删除组员'),
                     ('resetMemberPass', 'B4 重置密码')]:
    body = func_body(fname)
    check(f'{label}后推送云端', 'pushApprovedUsersToFeishu()' in body,
          f'{fname}应在saveUsers后调用pushApprovedUsersToFeishu()')

section('C 审批拉取健壮性')
check('C1 pullApprovedStatus支持传参',
      re.search(r'function\s+pullApprovedStatusFromFeishu\(userParam\)', html) is not None and
      'userParam||state.currentUser' in html,
      '签名应为(userParam),内部who=userParam||state.currentUser')
check('C2 轮询器权限防御',
      re.search(r'startPendingPolling\(\)\{[\s\S]{0,220}role===\'admin\'&&[\s\S]{0,80}status===\'active\'', html) is not None,
      '轮询回调内应校验admin+active双重身份')

section('D 工程质量')
# D1 语法检查
with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as tf:
    scripts = re.findall(r'<script>(.*?)</script>', html, re.S)
    tf.write('\n;\n'.join(scripts))
    tmp = tf.name
r = subprocess.run(['node', '--check', tmp], capture_output=True, text=True)
os.unlink(tmp)
check('D1 JS语法通过node --check', r.returncode == 0, r.stderr[:120])
# D2 空catch检查
empty_catch = re.findall(r'catch\s*(?:\([^)]*\))?\s*\{\s*\}', html)
check('D2 无空catch块', len(empty_catch) == 0, f'发现{len(empty_catch)}处空catch')

print(f'\n{"=" * 46}')
print(f'结果: {PASS}通过 / {FAIL}失败 / {PASS + FAIL}总计')
sys.exit(1 if FAIL else 0)
