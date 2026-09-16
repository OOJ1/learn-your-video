# ============================================================
#  你的学习搭子 (study-buddy) - 一键启动
#
#  用法：双击同目录下的「学习搭子.cmd」（直接启动），或在本目录执行 .\start.ps1
#
#  它会做四件事：
#    1) 清理 8000 / 5173 端口上的旧实例（可以重复双击，不会起两份）
#    2) 以「后台无窗口」方式启动 后端(uvicorn) + 前端(vite)
#    3) 等待后端健康检查通过
#    4) 自动打开浏览器
#
#  停止：网页右上角「停止」，或执行 .\学习搭子.cmd stop（等价于 .\stop.ps1）
# ============================================================
[CmdletBinding()]
param(
    [switch]$NoBrowser,       # 加这个参数则不自动打开浏览器
    [int]$TimeoutSec = 90,    # 等待后端就绪的最长秒数
    [int]$OpenDelaySec = 1    # 确认就绪到真正打开浏览器之间的缓冲秒数（避免页面还没加载好就弹窗）
)

$root = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$logDir = Join-Path $root 'logs'
$ports = 8000, 5173

function Say([string]$msg, [string]$color = 'Gray') { Write-Host $msg -ForegroundColor $color }
function Err([string]$msg) { Write-Host $msg -ForegroundColor Red }

Say ''
Say '===================================================' DarkCyan
Say '            你的学习搭子   study-buddy' Cyan
Say '===================================================' DarkCyan

if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
$bOut = Join-Path $logDir 'backend.log'
$bErr = Join-Path $logDir 'backend.err'
$fOut = Join-Path $logDir 'frontend.log'
$fErr = Join-Path $logDir 'frontend.err'

# --- 1. 清理旧实例 ----------------------------------------------
$killed = 0
foreach ($port in $ports) {
    # 端口没被占用时 Get-NetTCPConnection 会报错，用 SilentlyContinue 静默跳过
    $old = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)

    foreach ($opid in $old) {
        if (-not $opid -or $opid -eq $PID) { continue }
        $nm = (Get-Process -Id $opid -ErrorAction SilentlyContinue).ProcessName
        Say "  [清理] :$port 上的旧进程 $opid ($nm) 已关闭" Yellow
        Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
        $killed++
    }
}
if ($killed -gt 0) { Start-Sleep -Milliseconds 800 }
Say ''

# --- 2. 环境自检 ------------------------------------------------
$py = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $py)) {
    Err '  [错误] 找不到后端 Python 虚拟环境：'
    Err "         $py"
    Err '         请先执行：'
    Err '           python -m venv .venv'
    Err '           .\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt'
    Say ''
    exit 1
}

$frontend = Join-Path $root 'frontend'
$viteJs = Join-Path $frontend 'node_modules\vite\bin\vite.js'
if (-not (Test-Path $viteJs)) {
    Err '  [错误] 前端依赖未安装，找不到：'
    Err "         $viteJs"
    Err '         请先执行：cd frontend; npm install'
    Say ''
    exit 1
}

# 找 node.exe：PATH → 常见安装位置 → 已知托管版本
$node = $null
$cmdNode = Get-Command node -ErrorAction SilentlyContinue
if ($cmdNode) { $node = $cmdNode.Source }

if (-not $node) {
    $cand = @()
    if ($env:ProgramFiles) { $cand += (Join-Path $env:ProgramFiles 'nodejs\node.exe') }
    if (${env:ProgramFiles(x86)}) { $cand += (Join-Path ${env:ProgramFiles(x86)} 'nodejs\node.exe') }
    if ($env:LOCALAPPDATA) { $cand += (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe') }
    if ($env:APPDATA) { $cand += (Get-ChildItem (Join-Path $env:APPDATA 'nvm\v*\node.exe') -ErrorAction SilentlyContinue | Select-Object -ExpandProperty FullName) }
    $cand += 'C:\Users\ASUS\.workbuddy\binaries\node\versions\22.22.2-2\node.exe'
    $node = $cand | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

if (-not $node) {
    Err '  [错误] 找不到 node.exe，请安装 Node.js 18+ 并确保它在 PATH 里'
    Say ''
    exit 1
}

# --- 3. 启动两个服务（隐藏窗口，日志落 logs/）-------------------
# 说明：Start-Process 的 -RedirectStandardOutput 会自动覆盖同名日志，无需先删。
function Start-HiddenProcess([string]$File, [string[]]$ArgList, [string]$WorkDir, [string]$OutFile, [string]$ErrFile) {
    $args0 = @{
        FilePath               = $File
        ArgumentList           = $ArgList
        WorkingDirectory       = $WorkDir
        WindowStyle            = 'Hidden'
        RedirectStandardOutput = $OutFile
        RedirectStandardError  = $ErrFile
    }
    try {
        return Start-Process @args0 -PassThru
    } catch {
        # 极少数环境（某些 IDE / 容器沙箱）会在进程环境块里塞入「仅大小写不同」的重复键
        # （例如 http_proxy 与 HTTP_PROXY）。.NET 构造子进程环境时用大小写不敏感的字典，
        # 会抛「已添加项。字典中的关键字:...」。这里把它翻译成人话，避免用户看到天书。
        if ($_.Exception.Message -match '已添加项|已添加了具有相同键|already been added') {
            throw ("当前终端的环境变量里存在仅大小写不同的重复键（如 http_proxy / HTTP_PROXY），" +
                "Windows 无法据此创建子进程。请直接双击「学习搭子.cmd」启动，或换一个干净的终端再试。" +
                " 原始错误：$($_.Exception.Message)")
        }
        throw
    }
}

Say "  [启动] 后端  uvicorn  ->  http://127.0.0.1:8000"
try {
    $b = Start-HiddenProcess $py @('-m', 'uvicorn', 'app.main:app', '--host', '127.0.0.1', '--port', '8000') (Join-Path $root 'backend') $bOut $bErr
} catch {
    Err "  [错误] 后端启动失败：$($_.Exception.Message)"
    exit 1
}

Say "  [启动] 前端  vite     ->  http://127.0.0.1:5173"
try {
    $f = Start-HiddenProcess $node @($viteJs, '--host', '127.0.0.1') $frontend $fOut $fErr
} catch {
    Err "  [错误] 前端启动失败：$($_.Exception.Message)"
    exit 1
}

# --- 4. 等待就绪 ------------------------------------------------
# 用纯 .NET 的 TcpClient 探端口，不依赖 NetTCPIP 模块（受限环境里该模块可能加载不了）
function Test-Port([int]$Port, [int]$TimeoutMs = 800) {
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

# 真正取一次 HTTP 内容。Proxy 置空以绕过系统代理 —— 否则本机请求可能被代理截走，
# 明明服务是好的却探测失败（此前把健康检查降级为"仅提示"就是为此）。
function Test-Http([string]$Url, [int]$TimeoutMs = 5000) {
    try {
        $req = [System.Net.HttpWebRequest]::Create($Url)
        $req.Proxy = $null
        $req.Timeout = $TimeoutMs
        $req.ReadWriteTimeout = $TimeoutMs
        $req.Method = 'GET'
        $req.UserAgent = 'study-buddy-startup-check'
        $resp = $req.GetResponse()
        $code = [int]$resp.StatusCode
        $resp.Close()
        return ($code -ge 200 -and $code -lt 400)
    } catch {
        return $false
    }
}

# 取真正监听该端口的进程（venv 的 python.exe 是个转发器，Start-Process 拿到的
# PID 与最终监听端口的 PID 并不是同一个，排查时要以这个为准）
function Get-ListenPid([int]$Port) {
    try {
        foreach ($line in (& netstat -ano 2>$null)) {
            if ($line -match "^\s*TCP\s+\S+:$Port\s+\S+\s+LISTENING\s+(\d+)") { return $Matches[1] }
        }
    } catch { }
    return '?'
}

Say ''
Say '  [等待] 后端就绪中（首次启动稍慢，请稍候）...'

$beReady = $false
for ($i = 1; $i -le $TimeoutSec; $i++) {
    if (Test-Port 8000) { $beReady = $true; break }
    Start-Sleep -Seconds 1
}

# 前端要点：端口监听 ≠ 可以打开页面。
# Vite 8 会先打印 ready 再在后台预构建依赖，此时打开浏览器首屏是空白的，
# 用户必须手动刷新一次。所以这里必须实际请求一次首页与入口模块，
# 能拿到 200 才认为「打开即可用」。
Say '  [等待] 前端编译中（首次会预构建依赖，可能稍慢）...'

$feReady = $false
for ($i = 1; $i -le 120; $i++) {
    if ((Test-Port 5173) -and
        (Test-Http 'http://127.0.0.1:5173/') -and
        (Test-Http 'http://127.0.0.1:5173/src/main.tsx') -and
        (Test-Http 'http://127.0.0.1:5173/src/App.tsx')) {
        $feReady = $true
        break
    }
    Start-Sleep -Milliseconds 700
}
# 再确认一次并给依赖预构建留一点余量，避免"刚好就绪"的临界抖动
if ($feReady) {
    Start-Sleep -Milliseconds 500
    $feReady = (Test-Http 'http://127.0.0.1:5173/src/main.tsx')
}

# 端口通了再打一次健康检查，只用于给出更友好的提示；失败不影响结果判定
$health = '(未检查)'
if ($beReady) {
    try {
        $r = Invoke-WebRequest 'http://127.0.0.1:8000/api/health' -UseBasicParsing -TimeoutSec 5
        $health = "$($r.StatusCode)  $($r.Content)"
    } catch {
        $health = '(端口已监听，但健康检查未通过)'
    }
}

# 记录 PID，便于排查。listen_pid 才是真正占用端口的进程：
# venv 的 python.exe 是个转发器，Start-Process 返回的 launcher_pid 与它不同。
@(
    "backend  listen_pid=$(Get-ListenPid 8000)  launcher_pid=$($b.Id)  port=8000  log=$bOut"
    "frontend listen_pid=$(Get-ListenPid 5173)  launcher_pid=$($f.Id)  port=5173  log=$fOut"
) | Set-Content -Path (Join-Path $logDir 'pids.txt') -Encoding UTF8

# --- 5. 结果 ----------------------------------------------------
Say ''
if ($beReady -and $feReady) {
    Say '  [OK] 启动完成，两个服务已在后台运行。' Green
    Say '       这个窗口可以直接关掉，不影响服务。' DarkGray
    Say ''
    Say '       前端  http://127.0.0.1:5173' Green
    Say '       后端  http://127.0.0.1:8000/docs' Green
    Say "       健康  $health" DarkGray
    Say "       日志  $logDir\" DarkGray
    Say '       停止  网页右上角「停止」或 学习搭子.cmd stop' Yellow

    if (-not $NoBrowser) {
        # 给前端/浏览器留一点缓冲，避免「弹窗了页面还没加载好」的尴尬
        if ($OpenDelaySec -gt 0) {
            Say "       $OpenDelaySec 秒后自动打开浏览器..." DarkGray
            Start-Sleep -Seconds $OpenDelaySec
        }
        try {
            Start-Process 'http://127.0.0.1:5173'
            Say ''
            Say '       已为你打开浏览器。' Cyan
        } catch {
            Say ''
            Say '       (自动打开浏览器失败，请手动访问上面的前端地址)' DarkYellow
        }
    }
    Say ''
    exit 0
}

Err '  [FAIL] 启动失败或超时'
if (-not $beReady) {
    Err '         后端未就绪，logs\backend.err 末尾：'
    if (Test-Path $bErr) { Get-Content $bErr -Tail 15 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkRed } }
}
if (-not $feReady) {
    Err '         前端未监听 5173，logs\frontend.err 末尾：'
    if (Test-Path $fErr) { Get-Content $fErr -Tail 15 | ForEach-Object { Write-Host "         $_" -ForegroundColor DarkRed } }
}
Say ''
exit 1
