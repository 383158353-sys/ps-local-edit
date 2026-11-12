$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$entry=Join-Path $root 'start-helper.vbs'
$wscript=Join-Path $env:SystemRoot 'System32\wscript.exe'
$link=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) '局部改图独立助手.lnk'))
$link.TargetPath=$wscript;$link.Arguments='"'+$entry+'"';$link.WorkingDirectory=$root;$link.WindowStyle=7;$link.Save()
& (Join-Path $PSScriptRoot 'open-plugin.ps1') -Silent
