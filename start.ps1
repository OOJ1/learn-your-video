# Windows 启动脚本 - 后端 + 前端（开发模式）

Write-Host "=== study-buddy startup ===" -ForegroundColor Cyan

# 0. 清理旧实例：Windows 允许重复绑定端口，双实例会导致请求被路由到不写日志的旧进程
foreach ($port in 8000, 5173) {
    try {
        $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($opid in $pids) {
            if ($opid -and $opid -ne $PID) {
                Write-Host "[cleanup] killing old process $opid on :$port" -ForegroundColor Yellow
                Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
            }
        }
    } catch { }  # 端口无监听时忽略
}

# 1. 后端
$py = "E:\study-buddy\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Error "venv not found: $py"; exit 1 }

Write-Host "[backend] launching uvicorn on :8000 ..." -ForegroundColor Yellow
Start-Process -FilePath $py `
    -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
    -WorkingDirectory "E:\study-buddy\backend" `
    -RedirectStandardOutput "E:\study-buddy\logs\backend.log" `
    -RedirectStandardError  "E:\study-buddy\logs\backend.err"

# 2. 前端
Write-Host "[frontend] launching vite on :5173 ..." -ForegroundColor Yellow
Start-Process -FilePath "npx.cmd" `
    -ArgumentList "vite","--host","127.0.0.1" `
    -WorkingDirectory "E:\study-buddy\frontend" `
    -RedirectStandardOutput "E:\study-buddy\logs\frontend.log" `
    -RedirectStandardError  "E:\study-buddy\logs\frontend.err"

Write-Host ""
Write-Host "Backend  : http://127.0.0.1:8000  (API docs: /docs)" -ForegroundColor Green
Write-Host "Frontend : http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Logs     : E:\study-buddy\logs\" -ForegroundColor Gray
Write-Host ""
Write-Host "Press Ctrl+C in this window to stop (or close the spawned shells)." -ForegroundColor Gray

# 等待后端就绪
Start-Sleep -Seconds 5
try {
    $r = Invoke-WebRequest "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "Health check: $($r.StatusCode) $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed. Tail of backend.err:" -ForegroundColor Red
    if (Test-Path "E:\study-buddy\logs\backend.err") { Get-Content "E:\study-buddy\logs\backend.err" -Tail 20 }
}