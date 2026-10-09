# 生成 start-game.bat：显式 CRLF + 纯 ASCII 落盘，并做静态检查。
# 用法：python tools/make_launcher.py
import os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BAT = os.path.join(ROOT, "start-game.bat")

body = r"""@echo off
rem ============================================================
rem  ON-PURPOSE CONSTRAINTS - please do not "clean up"
rem  This file MUST stay CRLF + pure ASCII. cmd.exe only parses
rem  CRLF, and non-ASCII bytes get misread on GBK code pages.
rem  All Chinese usage notes are in the readme file next to this .bat.
rem ============================================================
setlocal
title SanGuo Launcher

set "ROOT=%~dp0"
if "%ROOT:~-1%"=="\" set "ROOT=%ROOT:~0,-1%"

echo ============================================
echo   SanGuo ZhuLu - Pixel Three Kingdoms Survivor
echo ============================================
echo.
echo [1/3] Starting backend (Go) on port 8099 ...
start "SG-Backend" cmd /k "cd /d %ROOT%\server && set APP_PORT=8099 && set APP_DATA_DIR=data && survivors-server.exe"

echo [2/3] Starting frontend (Vite) on port 5173 --open ...
start "SG-Frontend" cmd /k "cd /d %ROOT%\web && npm run dev -- --open"

echo.
echo Backend + frontend windows opened. Do NOT close them.
echo To stop the game, close those two black windows.
echo If the browser does not open, visit http://localhost:5173 manually.
echo.
pause
"""

# 断言：纯 ASCII（非 ASCII 会直接抛错）
try:
    body.encode("ascii")
except UnicodeEncodeError as e:
    raise SystemExit("NON-ASCII in bat: " + str(e))

raw = body.replace("\n", "\r\n").encode("ascii")
with open(BAT, "wb") as f:
    f.write(raw)

# ---------- 静态检查：行尾 / BOM / 非 ASCII / dangling goto ----------
data = open(BAT, "rb").read()
crlf = data.count(b"\r\n")
lone = data.count(b"\n") - crlf
bom = data[:3] == b"\xef\xbb\xbf"
nonascii = sum(1 for b in data if b > 127)
text = data.decode("ascii", "replace")
labels, gotos = set(), []
for i, line in enumerate(text.splitlines(), 1):
    s = line.strip(); low = s.lower()
    if not s or low.startswith("rem ") or low.startswith("::"):
        continue
    if s.startswith(":"):
        labels.add(s[1:].split(" ")[0].lower()); continue
    for m in re.finditer(r"\bgoto\s+([^\s&|>]+)", low):
        gotos.append((i, m.group(1).lstrip(":")))
dangling = [(ln, t) for ln, t in gotos if t and t != "eof" and t not in labels]

print("written:", os.path.relpath(BAT, ROOT), "bytes=%d" % len(data))
print("check -> crlf=%d lone_lf=%d bom=%s nonascii=%d dangling_goto=%d"
      % (crlf, lone, bom, nonascii, len(dangling)))
assert lone == 0 and not bom and nonascii == 0 and not dangling, "STATIC CHECK FAILED"
print("STATIC CHECK PASSED")
