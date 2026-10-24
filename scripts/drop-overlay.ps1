# Resident catch layer. The helper starts this process at boot.
# While a drag is active the panel calls /drop/cover; a background poll wakes
# immediately and this window covers the cursor so the same drop can read files.
# It has no title bar and no taskbar button. Do not use a click-through style.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;
public class QuietDropForm : Form {
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override CreateParams CreateParams {
    get {
      CreateParams cp = base.CreateParams;
      cp.ExStyle |= 0x08000000; // WS_EX_NOACTIVATE
      cp.ExStyle |= 0x00000080; // WS_EX_TOOLWINDOW
      return cp;
    }
  }
}
public class OverlayNative {
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT pt);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(POINT pt);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);
  [DllImport("user32.dll")] public static extern IntPtr GetParent(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
[OverlayNative]::SetProcessDPIAware() | Out-Null
$sync = [hashtable]::Synchronized(@{ action = 'idle'; id = ''; x = $null; y = $null; gen = 0; miss = 0; stop = $false })
$form = New-Object QuietDropForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AllowDrop = $true
$form.Opacity = 0.35
$form.StartPosition = 'Manual'
$form.Text = ''
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 72, 140)
$form.Size = New-Object System.Drawing.Size(900, 700)
$label = New-Object System.Windows.Forms.Label
$label.Text = "松手即可添加参考图"
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.AllowDrop = $true
$label.ForeColor = [System.Drawing.Color]::White
$label.BackColor = $form.BackColor
try { $label.Font = New-Object System.Drawing.Font('Microsoft YaHei', 16) } catch {}
$form.Controls.Add($label)
$script:shownId = ''
$script:sessionId = ''
$script:holdOffId = ''
$script:over = $false
$script:nudges = 0
$script:lastNudge = [datetime]::MinValue
$script:upSince = $null
function Hide-Cover {
  if ($form.Visible) { $form.Hide() }
  $script:shownId = ''
  $script:over = $false
}
function Test-MouseDown { return ([OverlayNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0 }
function Get-CursorPoint {
  $pt = New-Object OverlayNative+POINT
  $ok = [OverlayNative]::GetCursorPos([ref]$pt)
  if (-not $ok -and $null -ne $sync.x -and $null -ne $sync.y) { $pt.X = [int]$sync.x; $pt.Y = [int]$sync.y }
  return $pt
}
function Test-Inside($pt) {
  if (-not $form.Visible) { return $false }
  return $pt.X -ge ($form.Left + 8) -and $pt.Y -ge ($form.Top + 8) -and $pt.X -lt ($form.Right - 8) -and $pt.Y -lt ($form.Bottom - 8)
}
function Get-CoverRect($pt) {
  $width = 900
  $height = 700
  $left = $pt.X - 450
  $top = $pt.Y - 350
  $hwnd = [OverlayNative]::WindowFromPoint($pt)
  $guard = 0
  while ($hwnd -ne [IntPtr]::Zero -and $hwnd -ne $form.Handle -and $guard -lt 12) {
    $rect = New-Object OverlayNative+RECT
    if ([OverlayNative]::GetWindowRect($hwnd, [ref]$rect)) {
      $w = $rect.Right - $rect.Left
      $h = $rect.Bottom - $rect.Top
      $contains = $pt.X -ge $rect.Left -and $pt.X -lt $rect.Right -and $pt.Y -ge $rect.Top -and $pt.Y -lt $rect.Bottom
      if ($contains -and $w -ge 180 -and $h -ge 120 -and $w -le 1600 -and $h -le 2200) {
        $uLeft = [Math]::Min($left, [int]$rect.Left)
        $uTop = [Math]::Min($top, [int]$rect.Top)
        $uRight = [Math]::Max($left + $width, [int]$rect.Right)
        $uBottom = [Math]::Max($top + $height, [int]$rect.Bottom)
        if (($uRight - $uLeft) -le 1700 -and ($uBottom - $uTop) -le 2300) {
          $left = $uLeft; $top = $uTop; $width = $uRight - $uLeft; $height = $uBottom - $uTop
        }
      }
    }
    $next = [OverlayNative]::GetParent($hwnd)
    if ($next -eq [IntPtr]::Zero -or $next -eq $hwnd) { break }
    $hwnd = $next
    $guard++
  }
  return New-Object System.Drawing.Rectangle($left, $top, [Math]::Max(480, $width), [Math]::Max(360, $height))
}
function Keep-Topmost {
  if ($form.Visible) { [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, [uint32]0x0013) | Out-Null }
}
function Nudge-Cursor($pt) {
  if ($script:over -or -not (Test-MouseDown)) { return }
  if ($script:nudges -ge 12) { return }
  if (((Get-Date) - $script:lastNudge).TotalMilliseconds -lt 90) { return }
  $cx = $form.Left + [int]($form.Width / 2)
  $cy = $form.Top + [int]($form.Height / 2)
  $nx = $pt.X + $(if ($pt.X -lt $cx) { 2 } else { -2 })
  $ny = $pt.Y + $(if ($pt.Y -lt $cy) { 2 } else { -2 })
  $nx = [Math]::Max($form.Left + 12, [Math]::Min($form.Right - 12, $nx))
  $ny = [Math]::Max($form.Top + 12, [Math]::Min($form.Bottom - 12, $ny))
  [OverlayNative]::SetCursorPos([int]$nx, [int]$ny) | Out-Null
  $script:nudges++
  $script:lastNudge = Get-Date
}
function Update-Cover([string]$id) {
  if ($script:holdOffId -eq $id) { return }
  $pt = Get-CursorPoint
  $same = $script:shownId -eq $id -and $form.Visible
  if ($same -and $script:over) { Keep-Topmost; return }
  if ($same -and (Test-Inside $pt)) { Keep-Topmost; Nudge-Cursor $pt; return }
  $bounds = Get-CoverRect $pt
  $form.Bounds = $bounds
  if (-not $same) { $script:nudges = 0; $script:over = $false }
  $script:shownId = $id
  $script:sessionId = $id
  if (-not $form.Visible) { $form.Show() }
  [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, [uint32]0x0050) | Out-Null
  Nudge-Cursor (Get-CursorPoint)
}
function Send-Json([string]$url, [string]$json, [string]$method) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Method = $method
  $req.Timeout = 4000
  $req.Headers.Add('X-PS-Local-Voice', '1')
  if ($json) {
    $req.ContentType = 'application/json; charset=utf-8'
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $req.ContentLength = $bytes.Length
    $stream = $req.GetRequestStream()
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Close()
  } else { $req.ContentLength = 0 }
  $res = $req.GetResponse()
  $res.Close()
}
function Send-References($refs) {
  $parts = foreach ($ref in @($refs)) {
    $name = ([string]$ref.name).Replace('\', '\\').Replace('"', '\"')
    '{"name":"' + $name + '","data":"' + [string]$ref.data + '"}'
  }
  Send-Json ('http://127.0.0.1:17402/drop/upload?id=' + [uri]::EscapeDataString($script:sessionId)) ('{"references":[' + ($parts -join ',') + ']}') 'POST'
}
function Reference-FromFile([string]$file) {
  $info = [System.IO.FileInfo]::new($file)
  if ($info.Length -gt 10MB) { throw '每张图片不超过 10MB。' }
  $mime = switch ($info.Extension.ToLowerInvariant()) { '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } '.webp' { 'image/webp' } default { 'image/png' } }
  return @{ name = $info.Name; data = ('data:' + $mime + ';base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($info.FullName))) }
}
$onEnter = {
  param($sender, $e)
  $script:over = $true
  $script:upSince = $null
  if ($e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy }
  else { $e.Effect = [System.Windows.Forms.DragDropEffects]::None }
}
$onDrop = {
  param($sender, $e)
  $script:over = $true
  try {
    $files = @($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop) | Where-Object { [System.IO.Path]::GetExtension($_).ToLowerInvariant() -in '.png', '.jpg', '.jpeg', '.webp' -and [System.IO.File]::Exists($_) } | Select-Object -First 5)
    if ($files.Count -gt 0) {
      $refs = @()
      foreach ($file in $files) { $refs += Reference-FromFile ([string]$file) }
      Send-References $refs
    }
  } catch {}
  $script:holdOffId = $script:shownId
  Hide-Cover
}
$form.Add_DragEnter($onEnter)
$form.Add_DragOver($onEnter)
$form.Add_DragDrop($onDrop)
$label.Add_DragEnter($onEnter)
$label.Add_DragOver($onEnter)
$label.Add_DragDrop($onDrop)
$form.Add_DragLeave({ $script:over = $false })
$label.Add_DragLeave({ $script:over = $false })
$null = $form.Handle
try { Send-Json 'http://127.0.0.1:17402/drop/ready' '' 'POST' } catch {}
$poll = {
  param($state)
  $since = 0
  while (-not $state.stop) {
    try {
      $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:17402/drop/overlay?wait=1&since=$since")
      $req.Method = 'GET'
      $req.Timeout = 5000
      $req.Headers.Add('X-PS-Local-Voice', '1')
      $res = $req.GetResponse()
      $reader = New-Object System.IO.StreamReader($res.GetResponseStream())
      $text = $reader.ReadToEnd()
      $reader.Close(); $res.Close()
      $view = $text | ConvertFrom-Json
      $state.action = [string]$view.action
      $state.id = [string]$view.id
      $state.gen = [int]$view.gen
      $state.x = $view.x
      $state.y = $view.y
      $since = [int]$view.gen
      $state.miss = 0
    } catch {
      $state.miss = [int]$state.miss + 1
      Start-Sleep -Milliseconds 200
      if ([int]$state.miss -ge 25) { $state.stop = $true }
    }
  }
}
$rs = [System.Management.Automation.Runspaces.RunspaceFactory]::CreateRunspace()
$rs.ApartmentState = 'MTA'
$rs.Open()
$ps = [System.Management.Automation.PowerShell]::Create()
$ps.Runspace = $rs
[void]$ps.AddScript($poll).AddArgument($sync)
$null = $ps.BeginInvoke()
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 15
$timer.Add_Tick({
  if ($sync.stop) { $timer.Stop(); [System.Windows.Forms.Application]::Exit(); return }
  $action = [string]$sync.action
  $id = [string]$sync.id
  if ($action -ne 'show' -or -not $id) { $script:holdOffId = ''; $script:upSince = $null; Hide-Cover; return }
  Update-Cover $id
  if (-not $form.Visible) { return }
  if (Test-MouseDown) { $script:upSince = $null; return }
  if (-not $script:upSince) { $script:upSince = Get-Date; return }
  if (-not $script:over -and ((Get-Date) - $script:upSince).TotalMilliseconds -ge 700) {
    $script:holdOffId = $id
    Hide-Cover
  }
})
$context = New-Object System.Windows.Forms.ApplicationContext
$timer.Start()
[System.Windows.Forms.Application]::Run($context)
$sync.stop = $true
try { $rs.Close() } catch {}
