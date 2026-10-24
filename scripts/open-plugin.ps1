param([switch]$Silent)
$ErrorActionPreference = 'Stop'
try {
    $taskRoot = Split-Path -Parent $PSScriptRoot
    $taskNode = 'F:\360Downloads\node.exe'
    $taskCli = Join-Path $taskRoot '.tools\uxp-cli\node_modules\@adobe\uxp-devtools-cli\src\uxp.js'
    if (-not (Get-Process Photoshop -ErrorAction SilentlyContinue)) { throw '请先打开 Photoshop，再运行这个入口。' }
    if (-not (Test-Path -LiteralPath $taskNode) -or -not (Test-Path -LiteralPath $taskCli)) { throw '找不到本机 UXP 加载工具，请联系维护者重新配置。' }
    function Test-TaskService([int]$taskPort = 14001) {
        $taskClient = [System.Net.Sockets.TcpClient]::new()
        try { $taskConnect = $taskClient.ConnectAsync('127.0.0.1',$taskPort); return ($taskConnect.Wait(500) -and $taskClient.Connected) } catch { return $false } finally { $taskClient.Dispose() }
    }
    if (-not (Test-TaskService)) {
        Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskCli + '" service start') -WorkingDirectory $taskRoot -WindowStyle Hidden
        for ($taskAttempt=0; $taskAttempt -lt 30; $taskAttempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-TaskService) { break }
        }
    }
    if (-not (Test-TaskService)) { throw 'UXP 服务未能启动。' }
    function Get-DropOverlayText {
        try {
            $taskReq = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:17402/drop/overlay')
            $taskReq.Method = 'GET'
            $taskReq.Timeout = 800
            $taskReq.Headers.Add('X-PS-Local-Voice', '1')
            $taskRes = $taskReq.GetResponse()
            $taskReader = New-Object System.IO.StreamReader($taskRes.GetResponseStream())
            $taskText = $taskReader.ReadToEnd()
            $taskReader.Close(); $taskRes.Close()
            return $taskText
        } catch { return '' }
    }
    $taskStartedVoice = -not (Test-TaskService 17402)
    if ($taskStartedVoice) {
        $taskVoiceServer = Join-Path $taskRoot 'scripts\voice-server.cjs'
        Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskVoiceServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
        for ($taskVoiceAttempt=0; $taskVoiceAttempt -lt 20; $taskVoiceAttempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-TaskService 17402) { break }
        }
    }
    if (-not (Test-TaskService 17402)) { Write-Warning '语音服务未启动，改图功能仍可使用。' }
    else {
        $taskDropReady = $false
        $taskDropTries = $(if ($taskStartedVoice) { 16 } else { 1 })
        for ($taskDropAttempt=0; $taskDropAttempt -lt $taskDropTries; $taskDropAttempt++) {
            if ((Get-DropOverlayText) -match '"ready"\s*:\s*true') { $taskDropReady = $true; break }
            if (-not $taskStartedVoice) { break }
            Start-Sleep -Milliseconds 500
        }
        if (-not $taskDropReady) {
            if ($taskStartedVoice) { Write-Warning '拖入接图层尚未就绪。第一次拖放若没进参考图，请再拖一次，并在面板上停一下再松开。' }
            else { Write-Warning '17402 上已有旧助手，没有这次的拖入接图层。请先结束占用 17402 的 node，再重新运行本入口。' }
        }
    }
    & $taskNode $taskCli plugin load --manifest (Join-Path $taskRoot 'plugin\manifest.json') --apps PS
    if ($LASTEXITCODE -ne 0) { throw '插件加载失败，请确认 PS 已打开且启用了开发者模式。' }
    Write-Host '已加载插件。在 Photoshop「增效工具」菜单打开「局部改图」。'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($Silent) { throw }
    Read-Host '按 Enter 关闭'
    exit 1
}
