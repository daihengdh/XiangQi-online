@echo off
chcp 65001 >nul
title 象棋对战 · 外网模式
echo.
echo   ════════════════════════════════════════
echo     象棋对战 · 外网模式（内网穿透）
echo     首次运行会自动下载穿透工具，请稍候
echo   ════════════════════════════════════════
echo.
cd /d "%~dp0"
node tunnel.js 8080
pause
