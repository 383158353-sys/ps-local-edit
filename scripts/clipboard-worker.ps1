$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
try {
    Add-Type -AssemblyName System.Windows.Forms
    if ([System.Windows.Forms.Clipboard]::ContainsImage()) {
        $taskClipboardImage = [System.Windows.Forms.Clipboard]::GetImage()
        $taskClipboardStream = [System.IO.MemoryStream]::new()
        try {
            $taskClipboardImage.Save($taskClipboardStream,[System.Drawing.Imaging.ImageFormat]::Png)
            if ($taskClipboardStream.Length -gt 10MB) { throw '截图超过 10MB，请缩小截图范围后重试。' }
            [Console]::WriteLine((@{image=('data:image/png;base64,'+[Convert]::ToBase64String($taskClipboardStream.ToArray()))} | ConvertTo-Json -Compress))
        } finally { $taskClipboardImage.Dispose(); $taskClipboardStream.Dispose() }
    } elseif ([System.Windows.Forms.Clipboard]::ContainsFileDropList()) {
        $taskClipboardFile = @([System.Windows.Forms.Clipboard]::GetFileDropList() | Where-Object { [System.IO.Path]::GetExtension($_).ToLowerInvariant() -in '.png','.jpg','.jpeg','.webp' -and [System.IO.File]::Exists($_) }) | Select-Object -First 1
        if ($taskClipboardFile) {
            $taskClipboardInfo = [System.IO.FileInfo]::new([string]$taskClipboardFile)
            if ($taskClipboardInfo.Length -gt 10MB) { throw '图片超过 10MB，请选择较小的图片。' }
            $taskClipboardMime = switch ($taskClipboardInfo.Extension.ToLowerInvariant()) { '.jpg' {'image/jpeg'} '.jpeg' {'image/jpeg'} '.webp' {'image/webp'} default {'image/png'} }
            [Console]::WriteLine((@{image=('data:'+$taskClipboardMime+';base64,'+[Convert]::ToBase64String([System.IO.File]::ReadAllBytes($taskClipboardInfo.FullName)))} | ConvertTo-Json -Compress))
        } else { [Console]::WriteLine('{}') }
    } elseif ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $taskClipboardText = [System.Windows.Forms.Clipboard]::GetText()
        if ($taskClipboardText -match '^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$') {
            [Console]::WriteLine((@{image=$taskClipboardText} | ConvertTo-Json -Compress))
        } else { [Console]::WriteLine((@{text=$taskClipboardText.Substring(0,[Math]::Min(20000,$taskClipboardText.Length))} | ConvertTo-Json -Compress)) }
    } else { [Console]::WriteLine('{}') }
} catch {
    [Console]::WriteLine((@{error='读取剪贴板失败，请重新复制文字或截图后再试。'} | ConvertTo-Json -Compress))
    exit 1
}
