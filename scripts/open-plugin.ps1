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
    if (-not (Test-TaskService 17402)) {
        $taskVoiceServer = Join-Path $taskRoot 'scripts\voice-server.cjs'
        Start-Process -FilePath $taskNode -ArgumentList ('"' + $taskVoiceServer + '"') -WorkingDirectory $taskRoot -WindowStyle Hidden
        for ($taskVoiceAttempt=0; $taskVoiceAttempt -lt 20; $taskVoiceAttempt++) {
            Start-Sleep -Milliseconds 500
            if (Test-TaskService 17402) { break }
        }
    }
    if (-not (Test-TaskService 17402)) { Write-Warning '语音服务未启动，改图功能仍可使用。' }
    & $taskNode $taskCli plugin load --manifest (Join-Path $taskRoot 'plugin\manifest.json') --apps PS
    if ($LASTEXITCODE -ne 0) { throw '插件加载失败，请确认 PS 已打开且启用了开发者模式。' }
    Write-Host '已加载插件。在 Photoshop「增效工具」菜单打开「局部改图」。'
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    if ($Silent) { throw }
    Read-Host '按 Enter 关闭'
    exit 1
}
