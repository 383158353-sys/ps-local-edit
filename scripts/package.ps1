$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
$taskRoot = Split-Path -Parent $PSScriptRoot
$taskPlugin = Join-Path $taskRoot 'plugin'
$taskDist = Join-Path $taskRoot 'dist'
New-Item -ItemType Directory -Path $taskDist -Force | Out-Null
$taskPackageName = (-join @([char]0x5C40, [char]0x90E8, [char]0x6539, [char]0x56FE)) + '-LK888-0.1.2.ccx'
$taskPackage = Join-Path $taskDist $taskPackageName
$taskStream = [System.IO.File]::Open($taskPackage, [System.IO.FileMode]::Create)
$taskArchive = [System.IO.Compression.ZipArchive]::new($taskStream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -LiteralPath $taskPlugin -Recurse -File | Where-Object { $_.Name -ne '.uxprc' } | ForEach-Object {
        $taskRelative = $_.FullName.Substring($taskPlugin.Length + 1).Replace('\', '/')
        $taskEntry = $taskArchive.CreateEntry($taskRelative)
        $taskEntryStream = $taskEntry.Open()
        $taskInput = [System.IO.File]::OpenRead($_.FullName)
        try { $taskInput.CopyTo($taskEntryStream) } finally { $taskInput.Dispose(); $taskEntryStream.Dispose() }
    }
} finally { $taskArchive.Dispose(); $taskStream.Dispose() }
Get-Item -LiteralPath $taskPackage | Select-Object FullName,Length
