@echo off
chcp 65001 >nul
title 别时容易见时难
echo.
echo ============================
echo   别时容易见时难
echo ============================
echo.
echo 正在启动服务器...
echo 打开浏览器访问: http://localhost:5500
echo 按 Ctrl+C 停止服务器
echo ============================
echo.
node server.mjs
pause
