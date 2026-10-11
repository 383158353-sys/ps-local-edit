param([Parameter(Mandatory=$true)][string]$SessionId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -Namespace LocalEdit -Name WindowVisibility -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr handle, int command); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr handle);'
$form=New-Object System.Windows.Forms.Form
$form.Text='局部改图 · 拖入图片'
$form.Size=New-Object System.Drawing.Size(360,215)
$form.StartPosition='CenterScreen'
$form.TopMost=$true
$form.ShowInTaskbar=$true
$form.AllowDrop=$true
$form.FormBorderStyle='FixedDialog'
$form.MaximizeBox=$false
$form.MinimizeBox=$false
$label=New-Object System.Windows.Forms.Label
$label.Text='将 PNG / JPG / WebP 图片拖到这里'
$label.TextAlign='MiddleCenter'
$label.Dock='Fill'
$label.AllowDrop=$true
$label.Font=New-Object System.Drawing.Font('Microsoft YaHei',12)
$form.Controls.Add($label)
$onEnter={param($sender,$e) if($e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)){$e.Effect=[System.Windows.Forms.DragDropEffects]::Copy}else{$e.Effect=[System.Windows.Forms.DragDropEffects]::None}}
$onDrop={
  param($sender,$e)
  try {
    $files=@($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop) | Where-Object { [System.IO.Path]::GetExtension($_).ToLowerInvariant() -in '.png','.jpg','.jpeg','.webp' -and [System.IO.File]::Exists($_) }) | Select-Object -First 5
    if(-not $files -or $files.Count -eq 0){throw '请拖入 PNG、JPG 或 WebP 图片。'}
    $refs=@()
    foreach($file in $files){
      $info=[System.IO.FileInfo]::new([string]$file)
      if($info.Length -gt 10MB){throw '每张图片不超过 10MB。'}
      $mime=switch($info.Extension.ToLowerInvariant()){'.jpg'{'image/jpeg'} '.jpeg'{'image/jpeg'} '.webp'{'image/webp'} default{'image/png'}}
      $refs+=@{name=$info.Name;data=('data:'+$mime+';base64,'+[Convert]::ToBase64String([System.IO.File]::ReadAllBytes($info.FullName)))}
    }
    $body=[System.Text.Encoding]::UTF8.GetBytes((@{references=$refs}|ConvertTo-Json -Depth 5 -Compress))
    $uri='http://127.0.0.1:17402/drop/upload?id='+[uri]::EscapeDataString($SessionId)
    Invoke-RestMethod -Uri $uri -Method Post -Headers @{'X-PS-Local-Voice'='1'} -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 20 | Out-Null
    $label.Text='已添加 '+$refs.Count+' 张图片，可继续拖入。'
  }catch{$label.Text=$_.Exception.Message}
}
$form.add_DragEnter($onEnter)
$form.add_DragDrop($onDrop)
$label.add_DragEnter($onEnter)
$label.add_DragDrop($onDrop)
$form.add_Shown({[LocalEdit.WindowVisibility]::ShowWindow($form.Handle,5)|Out-Null;[LocalEdit.WindowVisibility]::SetForegroundWindow($form.Handle)|Out-Null})
[void]$form.ShowDialog()
