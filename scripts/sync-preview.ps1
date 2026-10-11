$ErrorActionPreference = 'Stop'
$source = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\plugin')).Path
$installed = Join-Path $env:APPDATA 'Adobe\UXP\Plugins\External\com.local.lk888.psedit'
$manifest = Join-Path $installed 'manifest.json'
if (-not (Test-Path -LiteralPath $manifest)) { throw "Installed plugin not found: $installed" }
if ((Get-Content -LiteralPath $manifest -Raw -Encoding UTF8 | ConvertFrom-Json).id -ne 'com.local.lk888.psedit') { throw 'Plugin ID mismatch in destination directory.' }

$updated = 0
foreach ($file in Get-ChildItem -LiteralPath $source -Recurse -File) {
    $relative = $file.FullName.Substring($source.Length + 1)
    $target = Join-Path $installed $relative
    $parent = Split-Path -Parent $target
    if (-not (Test-Path -LiteralPath $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    if (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $target).Hash) {
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        $updated++
    }
}
Write-Host "Synced $updated file(s). Click the refresh button in the Photoshop panel to preview without restarting."
Write-Host 'Manifest changes still require reloading the entire plugin.'
