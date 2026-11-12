$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$taskOwner = New-Object System.Windows.Forms.Form
$taskOwner.TopMost = $true
$taskDialog = New-Object System.Windows.Forms.OpenFileDialog
$taskDialog.Title = '添加参考图片'
$taskDialog.Filter = '图片文件 (*.png;*.jpg;*.jpeg;*.webp)|*.png;*.jpg;*.jpeg;*.webp'
$taskDialog.Multiselect = $true
try {
    if ($taskDialog.ShowDialog($taskOwner) -ne [System.Windows.Forms.DialogResult]::OK) {
        [Console]::WriteLine('{"images":[]}')
        exit 0
    }
    $taskImages = @($taskDialog.FileNames | ForEach-Object {
        $taskInfo = [IO.FileInfo]::new($_)
        $taskMime = switch ($taskInfo.Extension.ToLowerInvariant()) { '.jpg' {'image/jpeg'} '.jpeg' {'image/jpeg'} '.webp' {'image/webp'} default {'image/png'} }
        @{name=$taskInfo.Name; data=('data:'+$taskMime+';base64,'+[Convert]::ToBase64String([IO.File]::ReadAllBytes($_)))}
    })
    [Console]::WriteLine((@{images=$taskImages} | ConvertTo-Json -Depth 4 -Compress))
} catch {
    [Console]::WriteLine((@{error=$_.Exception.Message} | ConvertTo-Json -Compress))
    exit 1
} finally { $taskDialog.Dispose(); $taskOwner.Dispose() }
