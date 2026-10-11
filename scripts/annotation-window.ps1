param([Parameter(Mandatory=$true)][string]$SessionId)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()
Add-Type -Namespace LocalEdit -Name WindowVisibility -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr handle, int command); [System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr handle);'
$script:api='http://127.0.0.1:17402/annotate/'
$script:headers=@{'X-PS-Local-Voice'='1'}
$source=Invoke-RestMethod -Uri ($script:api+'image?id='+[uri]::EscapeDataString($SessionId)) -Headers $script:headers -TimeoutSec 20
$bytes=[Convert]::FromBase64String(($source.image -split ',',2)[1])
$stream=[System.IO.MemoryStream]::new($bytes)
$script:base=[System.Drawing.Bitmap]::new($stream)
$script:marks=[System.Collections.ArrayList]::new()
$script:draft=$null
$script:color=[System.Drawing.Color]::FromArgb(255,64,64)
$script:penWidth=[Math]::Max(3,[Math]::Round($script:base.Width/250))
function Point-FromMouse($e){
  return [System.Drawing.PointF]::new([single]($e.X*$script:base.Width/$script:surface.Width),[single]($e.Y*$script:base.Height/$script:surface.Height))
}
function Draw-One($g,$mark){
  $p=[System.Drawing.Pen]::new($mark.color,[single]$script:penWidth)
  $p.StartCap=$p.EndCap=[System.Drawing.Drawing2D.LineCap]::Round
  try{
    $a=$mark.start;$b=$mark.end
    $g.DrawLine($p,$a,$b)
    $angle=[Math]::Atan2($b.Y-$a.Y,$b.X-$a.X);$len=[Math]::Max(18,$script:base.Width/35)
    $g.DrawLine($p,$b,[System.Drawing.PointF]::new([single]($b.X-$len*[Math]::Cos($angle-.5)),[single]($b.Y-$len*[Math]::Sin($angle-.5))))
    $g.DrawLine($p,$b,[System.Drawing.PointF]::new([single]($b.X-$len*[Math]::Cos($angle+.5)),[single]($b.Y-$len*[Math]::Sin($angle+.5))))
  }finally{$p.Dispose()}
}
function Draw-All($g){foreach($mark in $script:marks){Draw-One $g $mark};if($script:draft){Draw-One $g $script:draft}}
$form=New-Object System.Windows.Forms.Form
$form.Text='局部改图 · 标注参考图'
$form.StartPosition='CenterScreen'
$form.Size=New-Object System.Drawing.Size(580,670)
$form.MinimumSize=New-Object System.Drawing.Size(420,350)
$form.TopMost=$true
$form.ShowInTaskbar=$true
$form.BackColor=[System.Drawing.Color]::White
$topPanel=New-Object System.Windows.Forms.Panel
$topPanel.Dock='Top';$topPanel.Height=78;$topPanel.BackColor=[System.Drawing.Color]::White
$form.Controls.Add($topPanel)
$header=New-Object System.Windows.Forms.Panel
$header.Dock='Top';$header.Height=39;$header.BackColor=[System.Drawing.Color]::White
$headerTitle=New-Object System.Windows.Forms.Label
$headerTitle.Text='标注参考图';$headerTitle.Font=[System.Drawing.Font]::new('Microsoft YaHei',10,[System.Drawing.FontStyle]::Bold)
$headerTitle.Location=New-Object System.Drawing.Point(12,10);$headerTitle.AutoSize=$true
$header.Controls.Add($headerTitle)
$headerClose=New-Object System.Windows.Forms.Button
$headerClose.Text='×';$headerClose.Width=28;$headerClose.Height=27;$headerClose.Anchor='Top,Right';$headerClose.Location=New-Object System.Drawing.Point(530,6)
$headerClose.FlatStyle='Flat';$headerClose.FlatAppearance.BorderSize=0;$headerClose.BackColor=[System.Drawing.Color]::White
$headerClose.Add_Click({$form.Close()});$header.Controls.Add($headerClose)
$topPanel.Controls.Add($header)
$toolbar=New-Object System.Windows.Forms.FlowLayoutPanel
$toolbar.Dock='Bottom';$toolbar.Height=39;$toolbar.WrapContents=$false;$toolbar.AutoScroll=$true;$toolbar.BackColor=[System.Drawing.Color]::White
$topPanel.Controls.Add($toolbar)
function Style-Button($button){$button.FlatStyle='Flat';$button.FlatAppearance.BorderColor=[System.Drawing.Color]::FromArgb(221,221,221);$button.BackColor=[System.Drawing.Color]::FromArgb(248,248,248);$button.ForeColor=[System.Drawing.Color]::FromArgb(35,35,35);$button.Font=[System.Drawing.Font]::new('Microsoft YaHei',8)}
$arrow=New-Object System.Windows.Forms.Button;$arrow.Text='↗ 箭头';$arrow.Width=58;$arrow.Height=28;Style-Button $arrow;$arrow.BackColor=[System.Drawing.Color]::FromArgb(30,30,30);$arrow.ForeColor=[System.Drawing.Color]::White;$toolbar.Controls.Add($arrow)|Out-Null
$colorButton=New-Object System.Windows.Forms.Button;$colorButton.Text='颜色';$colorButton.Width=43;$colorButton.Height=28;Style-Button $colorButton;$colorButton.Add_Click({$dialog=New-Object System.Windows.Forms.ColorDialog;$dialog.Color=$script:color;if($dialog.ShowDialog() -eq 'OK'){$script:color=$dialog.Color}});$toolbar.Controls.Add($colorButton)|Out-Null
$undo=New-Object System.Windows.Forms.Button;$undo.Text='撤销';$undo.Width=43;$undo.Height=28;Style-Button $undo;$undo.Add_Click({if($script:marks.Count){$script:marks.RemoveAt($script:marks.Count-1);$script:surface.Invalidate()}});$toolbar.Controls.Add($undo)|Out-Null
$clear=New-Object System.Windows.Forms.Button;$clear.Text='清空';$clear.Width=43;$clear.Height=28;Style-Button $clear;$clear.Add_Click({$script:marks.Clear();$script:surface.Invalidate()});$toolbar.Controls.Add($clear)|Out-Null
$footer=New-Object System.Windows.Forms.FlowLayoutPanel
$footer.Dock='Bottom';$footer.Height=47;$footer.FlowDirection='RightToLeft';$footer.BackColor=[System.Drawing.Color]::White
$form.Controls.Add($footer)
$save=New-Object System.Windows.Forms.Button;$save.Text='✓ 完成标注';$save.Width=100;$save.Height=31;$save.FlatStyle='Flat';$save.BackColor=[System.Drawing.Color]::FromArgb(25,25,25);$save.ForeColor=[System.Drawing.Color]::White;$footer.Controls.Add($save)|Out-Null
$cancel=New-Object System.Windows.Forms.Button;$cancel.Text='取消';$cancel.Width=55;$cancel.Height=31;Style-Button $cancel;$cancel.Add_Click({$form.Close()});$footer.Controls.Add($cancel)|Out-Null
$footerHint=New-Object System.Windows.Forms.Label;$footerHint.Text='在图片上拖动绘制箭头。';$footerHint.Width=300;$footerHint.Height=31;$footerHint.TextAlign='MiddleLeft';$footerHint.ForeColor=[System.Drawing.Color]::Gray;$footer.Controls.Add($footerHint)|Out-Null
$hostPanel=New-Object System.Windows.Forms.Panel
$hostPanel.Dock='Fill';$hostPanel.AutoScroll=$true;$hostPanel.BackColor=[System.Drawing.Color]::FromArgb(240,240,240)
$form.Controls.Add($hostPanel)
$script:surface=New-Object System.Windows.Forms.PictureBox
$script:surface.BackColor=[System.Drawing.Color]::White
$fit=[Math]::Min(1,[Math]::Min(515/$script:base.Width,450/$script:base.Height))
$script:surface.Width=[Math]::Max(1,[int]($script:base.Width*$fit));$script:surface.Height=[Math]::Max(1,[int]($script:base.Height*$fit))
$script:surface.Location=New-Object System.Drawing.Point(8,8)
$hostPanel.Controls.Add($script:surface)
$script:surface.Add_Paint({param($sender,$e)
  $e.Graphics.InterpolationMode=[System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $e.Graphics.ScaleTransform([single]($script:surface.Width/$script:base.Width),[single]($script:surface.Height/$script:base.Height))
  $e.Graphics.DrawImage($script:base,0,0,$script:base.Width,$script:base.Height)
  Draw-All $e.Graphics
})
$script:surface.Add_MouseDown({param($sender,$e)
  if($e.Button -ne [System.Windows.Forms.MouseButtons]::Left){return}
  $point=Point-FromMouse $e
  $script:draft=@{start=$point;end=$point;color=$script:color};$script:surface.Capture=$true
})
$script:surface.Add_MouseMove({param($sender,$e)
  if(-not $script:draft){return};$script:draft.end=Point-FromMouse $e;$script:surface.Invalidate()
})
$script:surface.Add_MouseUp({param($sender,$e)
  if($script:draft){$script:draft.end=Point-FromMouse $e;[void]$script:marks.Add($script:draft);$script:draft=$null;$script:surface.Capture=$false;$script:surface.Invalidate()}
})
$save.Add_Click({
  try{
    $output=[System.Drawing.Bitmap]::new($script:base.Width,$script:base.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($output)
    $memory=[System.IO.MemoryStream]::new()
    try{$graphics.DrawImage($script:base,0,0,$script:base.Width,$script:base.Height);Draw-All $graphics;$output.Save($memory,[System.Drawing.Imaging.ImageFormat]::Png)
      if($memory.Length -gt 10MB){throw '标注图片超过 10MB，请减少标注或使用较小的图片。'}
      $body=[System.Text.Encoding]::UTF8.GetBytes((@{image=('data:image/png;base64,'+[Convert]::ToBase64String($memory.ToArray()))}|ConvertTo-Json -Compress))
      Invoke-RestMethod -Uri ($script:api+'save?id='+[uri]::EscapeDataString($SessionId)) -Method Post -Headers $script:headers -Body $body -ContentType 'application/json; charset=utf-8' -TimeoutSec 20 | Out-Null
      $form.Close()
    }finally{$graphics.Dispose();$output.Dispose();$memory.Dispose()}
  }catch{[System.Windows.Forms.MessageBox]::Show($_.Exception.Message,'保存标注失败')|Out-Null}
})
$form.Add_FormClosed({$script:base.Dispose();$stream.Dispose()})
$form.Add_Shown({[LocalEdit.WindowVisibility]::ShowWindow($form.Handle,5)|Out-Null;[LocalEdit.WindowVisibility]::SetForegroundWindow($form.Handle)|Out-Null})
[void]$form.ShowDialog()
