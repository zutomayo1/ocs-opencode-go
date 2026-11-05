@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   正在启动本地转发服务…… 用完直接关掉这个窗口。
echo.
node serve.mjs
pause
