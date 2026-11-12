param([switch]$Silent)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$entry=Join-Path $root 'start-helper.vbs'
if(!(Test-Path -LiteralPath $entry)){throw '请先运行独立助手安装程序。'}
Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList ('"'+$entry+'"') -WindowStyle Hidden
if(!$Silent){Write-Host '独立助手已启动。请在 Photoshop 的“增效工具”菜单打开“局部改图”，无需影词魔方。'}
