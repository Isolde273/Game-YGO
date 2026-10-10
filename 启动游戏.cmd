@echo off
chcp 65001 >nul
setlocal
set "ELECTRON_RUN_AS_NODE="
set "YGO_SMOKE_TEST="
set "YGO_SMOKE_USERDATA="
if not exist "%~dp0portable\游戏王开盒模拟器\游戏王开盒模拟器.exe" (
  echo 未找到游戏程序，请保留完整的 portable 文件夹。
  pause
  exit /b 1
)
start "" /D "%~dp0portable\游戏王开盒模拟器" "%~dp0portable\游戏王开盒模拟器\游戏王开盒模拟器.exe"
