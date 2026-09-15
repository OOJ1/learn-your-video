@echo off
chcp 936 >nul
title 学习搭子  -  停止
cd /d "%~dp0"

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
set RC=%ERRORLEVEL%
echo.
if "%RC%"=="0" goto ok

echo  ********************************************************
echo   [注意] 仍有端口未释放（退出码 %RC%），详见上方提示。
echo  ********************************************************
goto end

:ok
echo  ********************************************************
echo   [完成] 已停止，端口 8000 与 5173 均已释放。
echo   提示：浏览器里已打开的页面会失效（显示连接错误），这是正常的；
echo         重新打开请双击「学习搭子」或 start.cmd。
echo  ********************************************************

:end
echo.
echo  按任意键关闭此窗口 ...
pause >nul
exit /b %RC%
