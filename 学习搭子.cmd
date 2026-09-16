@echo off
chcp 936 >nul
title 学习搭子
cd /d "%~dp0"

rem ==========================================================
rem   你的学习搭子 · 统一启停入口
rem     双击本文件                -> 直接启动（不进菜单）
rem     学习搭子.cmd stop          -> 停止服务
rem     学习搭子.cmd status       -> 查看运行状态
rem     学习搭子.cmd menu         -> 打开菜单（启停面板）
rem   带参数的用法供桌面快捷方式与页面内「停止」按钮调用。
rem ==========================================================

if /i "%~1"=="menu"   goto menu
if /i "%~1"=="stop"   goto once_stop
if /i "%~1"=="status" goto once_status

rem 默认（无参数 / start）：直接启动，双击即用
goto once_start


:menu
cls
echo.
echo   ========================================================
echo      你的学习搭子  ·  控制台
echo   ========================================================
echo.
echo      [1]  启动服务      前端  http://127.0.0.1:5173
echo                        后端  http://127.0.0.1:8000/docs
echo.
echo      [2]  停止服务      释放端口 8000 与 5173
echo      [3]  查看运行状态
echo      [0]  退出
echo.
echo   --------------------------------------------------------
echo      直接回车 = 启动；启动后也可以直接在网页右上角点「停止」
echo   --------------------------------------------------------
echo.
set "CH="
set /p "CH=  请选择 [0-3]："
if not defined CH goto menu_start
if "%CH%"=="1" goto menu_start
if "%CH%"=="2" goto menu_stop
if "%CH%"=="3" goto menu_status
if "%CH%"=="0" goto bye
echo.
echo   [!] 无效选项「%CH%」，请重新选择。
ping -n 2 127.0.0.1 >nul
goto menu

:menu_start
call :act_start
call :hold
goto menu

:menu_stop
call :act_stop
call :hold
goto menu

:menu_status
call :act_status
call :hold
goto menu

:once_start
call :act_start
if not defined RC set "RC=1"
exit /b %RC%

:once_stop
call :act_stop
if not defined RC set "RC=1"
exit /b %RC%

:once_status
call :act_status
exit /b 0

:bye
exit /b 0


rem ==================== 动作 ====================

:act_start
echo.
echo   --------------------------------------------------------
echo   [启动] 正在拉起前后端服务，首次启动约需 10-30 秒 ...
echo   --------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" goto act_start_fail
echo   [完成] 两个服务已在后台运行，本窗口可以直接关掉。
echo          前端  http://127.0.0.1:5173
echo          后端  http://127.0.0.1:8000/docs
echo.
echo          停止：点网页右上角「停止」，或运行  学习搭子.cmd stop
goto :eof

:act_start_fail
echo   ********************************************************
echo    [失败] 启动未成功（退出码 %RC%）
echo           请查看 logs\backend.err 与 logs\frontend.err
echo   ********************************************************
goto :eof


:act_stop
echo.
echo   --------------------------------------------------------
echo   [停止] 正在停止服务 ...
echo   --------------------------------------------------------
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop.ps1"
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" goto act_stop_warn
echo   [完成] 已停止，端口 8000 与 5173 均已释放。
echo          浏览器里已打开的页面会失效（显示连接错误），这是正常的。
goto :eof

:act_stop_warn
echo   ********************************************************
echo    [注意] 仍有端口未释放（退出码 %RC%），详见上方提示。
echo   ********************************************************
goto :eof


:act_status
echo.
echo   --------------------------------------------------------
echo   [状态] 检查端口占用 ...
echo   --------------------------------------------------------
netstat -ano | findstr "LISTENING" | findstr ":5173" >nul 2>&1
if errorlevel 1 (echo     前端 5173    未运行) else (echo     前端 5173    运行中    http://127.0.0.1:5173)
netstat -ano | findstr "LISTENING" | findstr ":8000" >nul 2>&1
if errorlevel 1 (echo     后端 8000    未运行) else (echo     后端 8000    运行中    http://127.0.0.1:8000/docs)
goto :eof


:hold
echo.
echo   按任意键返回菜单 ...
pause >nul
goto :eof
