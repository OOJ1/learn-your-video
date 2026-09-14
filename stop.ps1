# Windows 停止脚本 - 关闭后端(8000) / 前端(5173) 及其子进程
# 隐藏窗口启动后没有可见的控制台可关，用这个脚本来停。

param([switch]$Quiet)

$ports = 8000, 5173
$stopped = 0

foreach ($port in $ports) {
    try {
        $pids = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop |
            Select-Object -ExpandProperty OwningProcess -Unique
    } catch {
        $pids = @()
    }
    foreach ($opid in $pids) {
        if (-not $opid) { continue }
        # vite 由 node 启动、uvicorn 由 python 启动，直接结束监听进程即可
        try {
            Stop-Process -Id $opid -Force -ErrorAction Stop
            $stopped++
            if (-not $Quiet) { Write-Host "[stop] killed pid $opid on :$port" -ForegroundColor Yellow }
        } catch {
            if (-not $Quiet) { Write-Host "[stop] skip pid ${opid}: $($_.Exception.Message)" -ForegroundColor DarkYellow }
        }
    }
}

Start-Sleep -Milliseconds 600
$left = @()
foreach ($port in $ports) {
    try {
        $left += Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction Stop
    } catch { }
}

if ($left.Count -eq 0) {
    if (-not $Quiet) { Write-Host "已全部停止（共 $stopped 个进程）。" -ForegroundColor Green }
    exit 0
} else {
    Write-Host "以下端口仍在监听：$($left | Select-Object -ExpandProperty LocalPort | Sort-Object -Unique)" -ForegroundColor Red
    exit 1
}
