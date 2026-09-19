@echo off
chcp 65001 >nul
title 象棋对战服务器
echo.
echo   ════════════════════════════════════════
echo     正在启动 象棋对战 局域网服务器……
echo   ════════════════════════════════════════
echo.
cd /d "%~dp0"
node server.js 8080
pause
