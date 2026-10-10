$ErrorActionPreference = 'Continue'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskLoader = Join-Path $PSScriptRoot 'open-plugin.ps1'
$taskLog = Join-Path $env:LOCALAPPDATA '局部改图-plugin-keeper.log'
$taskWasRunning = $false

while ($true) {
    $taskIsRunning = [bool](Get-Process -Name Photoshop -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($taskIsRunning -and -not $taskWasRunning) {
        try {
            & $taskLoader -Silent *>> $taskLog
            if ($LASTEXITCODE -eq 0) { Add-Content -LiteralPath $taskLog -Value ('['+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+'] Photoshop plugin loaded.') }
        } catch {
            Add-Content -LiteralPath $taskLog -Value ('['+(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+'] '+$_.Exception.Message)
        }
    }
    $taskWasRunning = $taskIsRunning
    Start-Sleep -Seconds 4
}
