param([string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'PSLocalEditHelper'),[string]$PluginPath,[string]$NodePath)
$ErrorActionPreference='Stop'
$sourceRoot=$PSScriptRoot
if(!$PluginPath){$PluginPath=Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\com.local.lk888.psedit'}
if(!$NodePath -and (Test-Path -LiteralPath (Join-Path $sourceRoot 'runtime\node.exe'))){$NodePath=Join-Path $sourceRoot 'runtime\node.exe'}
if(!$NodePath){$command=Get-Command node.exe -ErrorAction SilentlyContinue;if($command){$NodePath=$command.Source}}
if(!$NodePath -or !(Test-Path -LiteralPath $NodePath)){throw '未找到 Node.js，请安装 Node.js 22+，或使用包含 runtime/node.exe 的完整安装包。'}
if((Resolve-Path -LiteralPath $NodePath).Path -eq (Join-Path $InstallRoot 'runtime\node.exe')){$runtimePresent=$true}else{$runtimePresent=$false}
$backup=Join-Path $InstallRoot ('backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force $backup | Out-Null
if(Test-Path -LiteralPath $PluginPath){Copy-Item -LiteralPath $PluginPath -Destination (Join-Path $backup 'plugin') -Recurse}
# Restart only processes belonging to this installation, so an upgrade also
# loads changed helper/overlay code without touching Photoshop or CinePrompt.
$ownedRuntime=Join-Path $InstallRoot 'runtime\node.exe'
$ownedScripts=@('helper-supervisor.cjs','standalone-helper.cjs','drop-overlay.ps1')
foreach($scriptName in $ownedScripts){
  $scriptPath=Join-Path $InstallRoot ('scripts\'+$scriptName)
  Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -and $_.CommandLine.Contains($scriptPath) -and
    (($_.Name -eq 'node.exe' -and $_.ExecutablePath -eq $ownedRuntime) -or
     ($scriptName -eq 'drop-overlay.ps1' -and $_.Name -eq 'powershell.exe' -and $_.ExecutablePath -like ($env:SystemRoot+'\*')))
  } | ForEach-Object {Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue}
}
foreach($folder in @('scripts','helper','plugin','runtime')){New-Item -ItemType Directory -Force (Join-Path $InstallRoot $folder) | Out-Null}
foreach($folder in @('scripts','helper','plugin')){Get-ChildItem -LiteralPath (Join-Path $sourceRoot $folder) -Force | Copy-Item -Destination (Join-Path $InstallRoot $folder) -Recurse -Force}
Copy-Item -LiteralPath (Join-Path $sourceRoot 'start-helper.vbs') -Destination (Join-Path $InstallRoot 'start-helper.vbs') -Force
if(!$runtimePresent){$targetRuntime=Join-Path $InstallRoot 'runtime\node.exe';if(!(Test-Path -LiteralPath $targetRuntime) -or (Get-FileHash -LiteralPath $NodePath).Hash -ne (Get-FileHash -LiteralPath $targetRuntime).Hash){Copy-Item -LiteralPath $NodePath -Destination $targetRuntime -Force}}
New-Item -ItemType Directory -Force $PluginPath | Out-Null
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'plugin') -Force | Copy-Item -Destination $PluginPath -Recurse -Force
$legacyRecords=Join-Path $env:APPDATA 'cine-prompt-local\local-data\media-submissions'
$ownRecords=Join-Path $InstallRoot 'data\media-submissions'
if(Test-Path -LiteralPath $legacyRecords){
  New-Item -ItemType Directory -Force $ownRecords | Out-Null
  Get-ChildItem -LiteralPath $legacyRecords -File -Filter '*.json' |
    Where-Object {$_.BaseName -match '^[a-f0-9]{64}$'} |
    ForEach-Object {
      $dest=Join-Path $ownRecords $_.Name
      if(!(Test-Path -LiteralPath $dest)){Copy-Item -LiteralPath $_.FullName -Destination $dest}
    }
}
# Same plugin ID and location: UXP secureStorage/settings/history are deliberately untouched.
$wscript=Join-Path $env:SystemRoot 'System32\wscript.exe'
$startScript=Join-Path $InstallRoot 'start-helper.vbs'
$protocol='HKCU:\Software\Classes\pslocaledit-helper'
New-Item -Path (Join-Path $protocol 'shell\open\command') -Force | Out-Null
Set-Item -Path $protocol -Value 'URL:PS Local Edit Helper'
New-ItemProperty -Path $protocol -Name 'URL Protocol' -Value '' -Force | Out-Null
Set-Item -Path (Join-Path $protocol 'shell\open\command') -Value ('"'+$wscript+'" "'+$startScript+'" "%1"')
$shortcut=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path ([Environment]::GetFolderPath('Startup')) '局部改图独立助手.lnk'))
$shortcut.TargetPath=$wscript;$shortcut.Arguments='"'+$startScript+'"';$shortcut.WorkingDirectory=$InstallRoot;$shortcut.WindowStyle=7;$shortcut.Description='Photoshop 局部改图独立助手，无需影词魔方';$shortcut.Save()
Start-Process -FilePath $wscript -ArgumentList ('"'+$startScript+'"') -WindowStyle Hidden
[PSCustomObject]@{installRoot=$InstallRoot;pluginPath=$PluginPath;backup=$backup;version='0.1.11'}|ConvertTo-Json
