# Windows 启动脚本 - 后端 + 前端（开发模式）
# 说明：两个服务都以「隐藏窗口」方式后台启动，不会再弹出 cmd 黑窗。
#       日志仍在 logs/ 下，停止服务用 .\stop.ps1。

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

$root = "E:\study-buddy"
$logDir = Join-Path $root "logs"
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }

# 1. 后端
$py = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { Write-Error "venv not found: $py"; exit 1 }

Write-Host "[backend] launching uvicorn on :8000 ..." -ForegroundColor Yellow
Start-Process -FilePath $py `
    -ArgumentList "-m","uvicorn","app.main:app","--host","127.0.0.1","--port","8000" `
    -WorkingDirectory (Join-Path $root "backend") `
    -WindowStyle Hidden `
    -RedirectStandardOutput (Join-Path $logDir "backend.log") `
    -RedirectStandardError  (Join-Path $logDir "backend.err")

# 2. 前端
#    直接调 node 跑 vite，不再走 npx.cmd：npx.cmd 是批处理，必须由 cmd.exe 再包一层，
#    既拖慢启动，也多一个窗口来源。
$frontend = Join-Path $root "frontend"
$viteJs = Join-Path $frontend "node_modules\vite\bin\vite.js"

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
$node = $null
if ($nodeCmd) { $node = $nodeCmd.Source }

if ($node -and (Test-Path $viteJs)) {
    Write-Host "[frontend] launching vite on :5173 ..." -ForegroundColor Yellow
    Start-Process -FilePath $node `
        -ArgumentList $viteJs,"--host","127.0.0.1" `
        -WorkingDirectory $frontend `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "frontend.log") `
        -RedirectStandardError  (Join-Path $logDir "frontend.err")
} else {
    # 兜底：机器上找不到 node 或本地没装 vite 时，退回 npx（同样隐藏窗口）
    Write-Host "[frontend] node/vite not found, fallback to npx.cmd ..." -ForegroundColor DarkYellow
    Start-Process -FilePath "npx.cmd" `
        -ArgumentList "vite","--host","127.0.0.1" `
        -WorkingDirectory $frontend `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir "frontend.log") `
        -RedirectStandardError  (Join-Path $logDir "frontend.err")
}

Write-Host ""
Write-Host "Backend  : http://127.0.0.1:8000  (API docs: /docs)" -ForegroundColor Green
Write-Host "Frontend : http://127.0.0.1:5173" -ForegroundColor Green
Write-Host "Logs     : $logDir\" -ForegroundColor Gray
Write-Host "Stop     : .\stop.ps1" -ForegroundColor Gray
Write-Host ""

# 等待后端就绪
Start-Sleep -Seconds 5
try {
    $r = Invoke-WebRequest "http://127.0.0.1:8000/api/health" -UseBasicParsing -TimeoutSec 5
    Write-Host "Health check: $($r.StatusCode) $($r.Content)" -ForegroundColor Green
} catch {
    Write-Host "Health check failed. Tail of backend.err:" -ForegroundColor Red
    $errFile = Join-Path $logDir "backend.err"
    if (Test-Path $errFile) { Get-Content $errFile -Tail 20 }
}
