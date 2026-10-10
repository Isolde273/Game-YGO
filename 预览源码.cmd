@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 请先安装 Node.js 22.18 或更新版本。
  pause
  exit /b 1
)
echo 源码预览地址：http://127.0.0.1:5173
echo 修改源码后刷新浏览器即可查看，按 Ctrl+C 停止服务。
node scripts/serve.mjs
pause
