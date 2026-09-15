# Windows 停止脚本 - 关闭后端(8000) / 前端(5173) 及其子进程
# 隐藏窗口启动后没有可见的控制台可关，用这个脚本来停。

param([switch]$Quiet)

$ports = 8000, 5173
$ownNames = @('python', 'pythonw', 'node')   # 本项目的服务只会是这两类进程

function Write-Line([string]$msg, [string]$color = 'Gray') {
    if ($Quiet) { return }
    Write-Host $msg -ForegroundColor $color
}

# 用 netstat 找监听进程：不依赖 NetTCPIP 模块（受限环境里该模块可能加载不了，
# 一旦加载失败旧写法会静默什么都不做、却仍报告"已全部停止"）
function Get-ListenPids([int]$Port) {
    $found = New-Object 'System.Collections.Generic.List[int]'
    try {
        foreach ($line in (& netstat -ano 2>$null)) {
            if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)") {
                $p = [int]$Matches[1]
                if ($p -gt 0 -and -not $found.Contains($p)) { $found.Add($p) }
            }
        }
    } catch { }
    return $found
}

# 真实连一次端口：这才是"有没有停干净"的判据
function Test-PortOpen([int]$Port, [int]$TimeoutMs = 500) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect('127.0.0.1', $Port, $null, $null)
        if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) { return $false }
        $client.EndConnect($iar)
        return $true
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

$stopped = 0
$skipped = @()

# 收集要结束的 PID：
#   1) netstat 看到的 8000/5173 监听进程
#   2) start.ps1 记到 logs\pids.txt 的 PID（兜底：个别环境下 netstat 可能漏报）
$targetPids = New-Object 'System.Collections.Generic.List[int]'
foreach ($port in $ports) {
    foreach ($opid in (Get-ListenPids $port)) {
        if ($opid -gt 0 -and -not $targetPids.Contains($opid)) { $targetPids.Add($opid) }
    }
}
$pidsFile = Join-Path $PSScriptRoot 'logs\pids.txt'
if (Test-Path $pidsFile) {
    foreach ($line in (Get-Content $pidsFile -ErrorAction SilentlyContinue)) {
        foreach ($m in [regex]::Matches($line, 'pid=(\d+)')) {
            $p = [int]$m.Groups[1].Value
            if ($p -gt 0 -and -not $targetPids.Contains($p)) { $targetPids.Add($p) }
        }
    }
}

foreach ($opid in $targetPids) {
    if ($opid -eq $PID) { continue }

    $proc = Get-Process -Id $opid -ErrorAction SilentlyContinue
    $nm = if ($proc) { $proc.ProcessName } else { '?' }

    # 安全闸：进程名既不是 python/node 也不是「未知」（未知时宁可杀，避免漏掉），
    # 只有明确是别的项目/系统进程才跳过
    if ($nm -ne '?' -and ($ownNames -notcontains $nm.ToLower())) {
        Write-Line "[stop] pid $opid ($nm) 看起来不是本项目，已跳过" DarkYellow
        $skipped += "$opid($nm)"
        continue
    }

    Write-Line "[stop] -> 结束 $nm (pid $opid) 及其子进程" Yellow
    # /T 连子进程一起结束，/F 强制：vite / uvicorn 都可能带子进程
    $null = & taskkill /PID $opid /T /F 2>&1
    if ($LASTEXITCODE -ne 0) {
        # taskkill 不可用时退回 Stop-Process
        try { Stop-Process -Id $opid -Force -ErrorAction Stop } catch { }
    }
    $stopped++
}

# 轮询复检，给进程一点退出时间
$busy = @()
for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Milliseconds 300
    $busy = @($ports | Where-Object { Test-PortOpen $_ })
    if ($busy.Count -eq 0) { break }
}

if ($busy.Count -eq 0) {
    if ($skipped.Count -gt 0) {
        Write-Line "本项目服务已停止（共 $stopped 个进程）；另跳过了非本项目占用的端口：$($skipped -join ', ')" Green
    } else {
        Write-Line "已全部停止（共 $stopped 个进程）。" Green
    }
    exit 0
} else {
    Write-Host "以下端口仍在监听：$($busy -join ', ')" -ForegroundColor Red
    if ($skipped.Count -gt 0) {
        Write-Host "其中被跳过的（非本项目）：$($skipped -join ', ')" -ForegroundColor DarkYellow
    }
    Write-Host "可尝试：以管理员身份运行本脚本，或手动 taskkill /PID <pid> /F" -ForegroundColor DarkYellow
    exit 1
}
