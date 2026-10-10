$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskStartup = [Environment]::GetFolderPath('Startup')
$taskShortcutPath = Join-Path $taskStartup '局部改图自动加载.lnk'
$taskPowerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$taskArguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'plugin-keeper.ps1') + '"'
$taskShell = New-Object -ComObject WScript.Shell
$taskShortcut = $taskShell.CreateShortcut($taskShortcutPath)
$taskShortcut.TargetPath = $taskPowerShell
$taskShortcut.Arguments = $taskArguments
$taskShortcut.WorkingDirectory = $taskRoot
$taskShortcut.Description = 'Photoshop 打开时自动加载局部改图插件'
$taskShortcut.WindowStyle = 7
$taskShortcut.Save()

$taskWatcher = Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'powershell.exe' -and $_.CommandLine -like '*plugin-keeper.ps1*' } | Select-Object -First 1
if (-not $taskWatcher) {
    Start-Process -FilePath $taskPowerShell -ArgumentList $taskArguments -WorkingDirectory $taskRoot -WindowStyle Hidden
}
Write-Host '已设置 Windows 登录后自动运行。Photoshop 每次启动时会自动加载「局部改图」。'
