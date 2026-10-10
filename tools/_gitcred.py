#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""git 凭据助手：从 Windows 凭据管理器读 GitHub 凭据，替代 git-credential-manager。

为什么需要它
------------
本机（WorkBuddy 沙箱）里 `git push` 会**无限期挂死**，且与网络、认证都无关：
- 匿名 `git ls-remote origin` 秒回（网络层完全正常）；
- 用同一份凭据直连 GitHub API 返回 200（凭据有效）；
- 但 `GIT_TRACE=1` 显示流程停在 `git-credential-manager.exe get` 上永不返回
  （它要拉起 GUI/代理进程，沙箱里起不来，于是谁也不返回）。

所以走"自己当凭据助手"这条路：git 通过 stdin 说明它要哪个 host，本脚本从
**Windows 凭据管理器**（`git:https://github.com`，由 GCM 自己存在那里的）
取出用户名与令牌，按 git 的格式写到 stdout。

本文件**不含任何密钥**，密钥始终留在系统凭据库里。

用法（在仓库里临时替换掉 GCM，用完即撤）：
    PY="C:/Users/yu.wang/.workbuddy/binaries/python/envs/default/Scripts/python.exe"
    git config --local credential.helper ""          # 空值 = 清掉全局 GCM
    git config --local credential.helper '!"'"$PY"'" "'"$PWD"'/tools/_gitcred.py"'
    git push --dry-run origin main
    git config --local --unset-all credential.helper  # 恢复
"""
import sys

TARGET = 'git:https://github.com'


def main():
    op = sys.argv[1] if len(sys.argv) > 1 else 'get'
    # 只实现 get：store / erase 直接返回成功就够了 —— 凭据由系统凭据库管，
    # 我们不该把它复制到 .git-credentials 那种明文文件里。
    if op != 'get':
        return 0
    try:
        import win32cred
    except ImportError:
        print('缺少 pywin32（win32cred）', file=sys.stderr)
        return 1
    try:
        hit = [c for c in win32cred.CredEnumerate(None, 0)
               if c.get('TargetName') == TARGET]
        if not hit:
            return 1
        c = hit[0]
        blob = c.get('CredentialBlob')
        if isinstance(blob, bytes):
            pw = blob.decode('utf-16-le').rstrip('\x00').strip()
        else:
            pw = str(blob).rstrip('\x00').strip()
        sys.stdout.write('username=%s\npassword=%s\n\n' % (c.get('UserName'), pw))
        return 0
    except Exception:
        return 1


if __name__ == '__main__':
    sys.exit(main())
