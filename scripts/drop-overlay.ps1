# Resident catch layer. The helper starts this process at boot.
# While a drag is active the panel calls /drop/cover with the on-screen
# rectangle of #dropzone. This window covers only that box so Explorer can
# drop onto it. No title bar, no taskbar button, never the whole desktop.
# Do not set Form.Opacity. A value below 1 makes a layered window, and Windows
# will not deliver an Explorer file drop to a layered window.
# Do not call SetProcessDPIAware. Cursor.Position and this form then share
# WinForms logical pixels, the same space as the panel's CSS screen rect.
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
  [DllImport("user32.dll")] public static extern bool ChangeWindowMessageFilterEx(IntPtr hWnd, uint message, uint action, IntPtr pChangeFilterStruct);
  [DllImport("user32.dll")] public static extern void mouse_event(uint dwFlags, uint dx, uint dy, uint dwData, System.UIntPtr dwExtraInfo);
  [DllImport("user32.dll")] public static extern uint GetDpiForSystem();
  public static void AllowDropMessages(IntPtr hwnd) {
    ChangeWindowMessageFilterEx(hwnd, 0x0049, 1, IntPtr.Zero); // WM_COPYGLOBALDATA
    ChangeWindowMessageFilterEx(hwnd, 0x004A, 1, IntPtr.Zero); // WM_COPYDATA
    ChangeWindowMessageFilterEx(hwnd, 0x0233, 1, IntPtr.Zero); // WM_DROPFILES
  }
  public static void PulseDrag() {
    mouse_event(0x0001, 1, 0, 0, System.UIntPtr.Zero);
    mouse_event(0x0001, 0xFFFFFFFFu, 0, 0, System.UIntPtr.Zero);
  }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
'@
$sync = [hashtable]::Synchronized(@{ action = 'idle'; id = ''; x = $null; y = $null; left = $null; top = $null; width = $null; height = $null; gen = 0; miss = 0; stop = $false })
$form = New-Object QuietDropForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AllowDrop = $true
$form.AutoScaleMode = 'None'
$form.StartPosition = 'Manual'
$form.Text = ''
# Same dark fill as the panel dropzone, with a 1px highlight so the box reads
# as the dashed target without covering Photoshop.
$form.Padding = New-Object System.Windows.Forms.Padding(1)
$form.BackColor = [System.Drawing.Color]::FromArgb(138, 180, 255)
$form.Size = New-Object System.Drawing.Size(104, 96)
$label = New-Object System.Windows.Forms.Label
$label.Text = '松手添加'
$label.Dock = 'Fill'
$label.TextAlign = 'MiddleCenter'
$label.AllowDrop = $true
$label.ForeColor = [System.Drawing.Color]::FromArgb(242, 242, 242)
$label.BackColor = [System.Drawing.Color]::FromArgb(53, 53, 53)
try { $label.Font = New-Object System.Drawing.Font('Microsoft YaHei', 9) } catch {}
$form.Controls.Add($label)
$script:shownId = ''
$script:sessionId = ''
$script:holdOffId = ''
$script:over = $false
$script:upSince = $null
$script:pulsed = $false
function Hide-Cover {
  if ($form.Visible) { $form.Hide() }
  $script:shownId = ''
  $script:over = $false
  $script:pulsed = $false
}
function Test-MouseDown { return ([OverlayNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0 }
function Get-CursorPoint {
  # Logical pixels, same space as form.Bounds. GetCursorPos is physical and
  # misses this window on a scaled display.
  $cursor = [System.Windows.Forms.Cursor]::Position
  $pt = New-Object OverlayNative+POINT
  $pt.X = [int]$cursor.X
  $pt.Y = [int]$cursor.Y
  return $pt
}
function Test-Inside($pt) {
  if (-not $form.Visible) { return $false }
  return $pt.X -ge ($form.Left + 8) -and $pt.Y -ge ($form.Top + 8) -and $pt.X -lt ($form.Right - 8) -and $pt.Y -lt ($form.Bottom - 8)
}
$script:dpiScale = 0
function Get-DpiScale {
  if ($script:dpiScale -ge 1) { return $script:dpiScale }
  $script:dpiScale = 1.0
  try {
    $dpi = [OverlayNative]::GetDpiForSystem()
    if ($dpi -ge 96 -and $dpi -le 480) { $script:dpiScale = [double]$dpi / 96.0 }
  } catch {}
  return $script:dpiScale
}
function Test-PointInRect($pt, $left, $top, $width, $height, $slack) {
  if ($width -lt 40 -or $height -lt 40 -or $width -gt 640 -or $height -gt 480) { return $false }
  if ($left -lt -8000 -or $left -gt 16000 -or $top -lt -8000 -or $top -gt 16000) { return $false }
  return ($pt.X -ge ($left - $slack)) -and ($pt.X -lt ($left + $width + $slack)) -and ($pt.Y -ge ($top - $slack)) -and ($pt.Y -lt ($top + $height + $slack))
}
function Clamp-AroundCursor($left, $top, $width, $height, $pt) {
  $maxW = 480; $maxH = 360; $minW = 180; $minH = 160
  if ($width -lt $minW) { $left -= [int](($minW - $width) / 2); $width = $minW }
  if ($height -lt $minH) { $top -= [int](($minH - $height) / 2); $height = $minH }
  if ($width -gt $maxW) { $left = [int]$pt.X - [int]($maxW / 2); $width = $maxW }
  if ($height -gt $maxH) { $top = [int]$pt.Y - [int]($maxH / 2); $height = $maxH }
  return New-Object System.Drawing.Rectangle([int]$left, [int]$top, [int]$width, [int]$height)
}
function Get-CoverRect($pt) {
  # UXP CSS screen pixels and this form's pixels often differ by the DPI scale.
  # A 104x96 rect from the panel is then beside the cursor, Explorer never
  # enters it, and the poll ends with no upload. Use the rect only when it
  # actually contains Cursor.Position; otherwise keep a small pad under the cursor.
  $baseLeft = 0.0; $baseTop = 0.0; $baseW = 0.0; $baseH = 0.0; $has = $false
  try {
    $baseLeft = [double]$sync.left; $baseTop = [double]$sync.top; $baseW = [double]$sync.width; $baseH = [double]$sync.height
    if ($baseW -ge 40 -and $baseH -ge 40 -and $baseW -le 280 -and $baseH -le 280) { $has = $true }
  } catch {}
  if ($has) {
    $scale = Get-DpiScale
    $factors = @(1.0)
    if ($scale -gt 1.05) { $factors = @(1.0, $scale, (1.0 / $scale)) }
    foreach ($factor in $factors) {
      $left = $baseLeft * $factor; $top = $baseTop * $factor; $width = $baseW * $factor; $height = $baseH * $factor
      # Pad is 64px, so the cursor must already sit inside that pad. A rect that
      # only "almost" contains the cursor is the misplaced 104x96 window.
      if (Test-PointInRect $pt $left $top $width $height 48) {
        $rect = Clamp-AroundCursor ($left - 64) ($top - 64) ($width + 128) ($height + 128) $pt
        if (Test-PointInRect $pt $rect.X $rect.Y $rect.Width $rect.Height 0) { return $rect }
      }
    }
  }
  return New-Object System.Drawing.Rectangle(($pt.X - 116), ($pt.Y - 112), 232, 224)
}
function Keep-Topmost {
  if ($form.Visible) { [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, [uint32]0x0013) | Out-Null }
}
$script:dropRegistered = $false
function Enable-DropTarget {
  try { [OverlayNative]::AllowDropMessages($form.Handle) } catch {}
  # Register once, before a drag exists. Toggling AllowDrop off while Explorer
  # is already dragging revokes the OLE target and the release stays on UXP.
  if ($script:dropRegistered) { return }
  $form.AllowDrop = $true
  $label.AllowDrop = $true
  $script:dropRegistered = $true
}
function Pulse-Drag {
  if ($script:pulsed -or -not (Test-MouseDown)) { return }
  $pt = Get-CursorPoint
  # +1 then -1 has to stay on the catch. A pulse from the edge walks the
  # hotspot onto the UXP panel and the drop is empty again.
  $inside = $form.Visible -and $pt.X -ge ($form.Left + 12) -and $pt.X -lt ($form.Right - 12) -and $pt.Y -ge ($form.Top + 12) -and $pt.Y -lt ($form.Bottom - 12)
  if (-not $inside) { return }
  $script:pulsed = $true
  try { [OverlayNative]::PulseDrag() } catch {}
}
function Update-Cover([string]$id) {
  if ($script:holdOffId -eq $id) { return }
  $pt = Get-CursorPoint
  $same = $script:shownId -eq $id -and $form.Visible
  if ($same -and $script:over) { Keep-Topmost; return }
  if ($same -and (Test-Inside $pt)) { Keep-Topmost; Pulse-Drag; return }
  $bounds = Get-CoverRect $pt
  $form.Bounds = $bounds
  if (-not $same) { $script:over = $false }
  $script:shownId = $id
  $script:sessionId = $id
  $wasVisible = [bool]$form.Visible
  if (-not $wasVisible) { $form.Show() }
  [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, [uint32]0x0050) | Out-Null
  Enable-DropTarget
  Pulse-Drag
}
function Send-Json([string]$url, [string]$json, [string]$method) {
  $req = [System.Net.HttpWebRequest]::Create($url)
  $req.Proxy = $null
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
  $url = 'http://127.0.0.1:17402/drop/upload?id=' + [uri]::EscapeDataString($script:sessionId)
  $json = '{"references":[' + ($parts -join ',') + ']}'
  try { Send-Json $url $json 'POST' } catch { Start-Sleep -Milliseconds 150; Send-Json $url $json 'POST' }
}
function Reference-FromFile([string]$file) {
  $info = [System.IO.FileInfo]::new($file)
  if ($info.Length -gt 10MB) { throw '每张图片不超过 10MB。' }
  $mime = switch ($info.Extension.ToLowerInvariant()) { '.jpg' { 'image/jpeg' } '.jpeg' { 'image/jpeg' } '.webp' { 'image/webp' } default { 'image/png' } }
  return @{ name = $info.Name; data = ('data:' + $mime + ';base64,' + [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($info.FullName))) }
}
function Test-FileDrag($data) {
  foreach ($format in @([System.Windows.Forms.DataFormats]::FileDrop, 'FileNameW', 'FileName')) {
    try { if ($data.GetDataPresent($format)) { return $true } } catch {}
  }
  return $false
}
function Get-DroppedFiles($data) {
  foreach ($format in @([System.Windows.Forms.DataFormats]::FileDrop, 'FileNameW', 'FileName')) {
    try {
      if (-not $data.GetDataPresent($format)) { continue }
      $raw = $data.GetData($format)
      if ($null -eq $raw) { continue }
      if ($raw -is [string]) { return @($raw) }
      return @($raw)
    } catch {}
  }
  return @()
}
$onEnter = {
  param($sender, $e)
  $script:over = $true
  $script:upSince = $null
  if (Test-FileDrag $e.Data) { $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy }
  else { $e.Effect = [System.Windows.Forms.DragDropEffects]::None }
}
$onDrop = {
  param($sender, $e)
  $script:over = $true
  try {
    $files = @(Get-DroppedFiles $e.Data | Where-Object { [System.IO.Path]::GetExtension([string]$_).ToLowerInvariant() -in '.png', '.jpg', '.jpeg', '.webp' -and [System.IO.File]::Exists([string]$_) } | Select-Object -First 5)
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
# Create the drop target before any drag. Showing off-screen once lets
# AllowDrop stick; later covers only move the window.
try {
  $form.Bounds = New-Object System.Drawing.Rectangle(-32000, -32000, 10, 10)
  $form.Show()
  Enable-DropTarget
  $form.Hide()
} catch {}
try { Send-Json 'http://127.0.0.1:17402/drop/ready' '' 'POST' } catch {}
$poll = {
  param($state)
  $since = 0
  while (-not $state.stop) {
    try {
      $req = [System.Net.HttpWebRequest]::Create("http://127.0.0.1:17402/drop/overlay?wait=1&since=$since")
      $req.Proxy = $null
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
      $state.left = $view.left
      $state.top = $view.top
      $state.width = $view.width
      $state.height = $view.height
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
