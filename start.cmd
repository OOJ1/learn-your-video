@echo off
chcp 936 >nul
title 学习搭子  -  启动
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set RC=%ERRORLEVEL%
echo.
if "%RC%"=="0" goto ok

echo  ********************************************************
echo   [失败] 启动未成功（退出码 %RC%）
echo          请查看 logs\backend.err 与 logs\frontend.err
echo  ********************************************************
goto end

:ok
echo  ********************************************************
echo   [完成] 两个服务已在后台运行，本窗口可以直接关掉。
echo          前端  http://127.0.0.1:5173
echo          后端  http://127.0.0.1:8000/docs
echo          停止  双击「学习搭子 - 停止」
echo  ********************************************************

:end
echo.
echo  按任意键关闭此窗口 ...
pause >nul
exit /b %RC%
