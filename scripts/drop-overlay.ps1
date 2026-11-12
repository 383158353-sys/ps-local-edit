# Add-area catch. The helper starts this process at boot with the window hidden.
# While a drag is over #dropzone the panel calls /drop/cover with that box's
# size and the pointer's offset inside it. This window is moved to that box
# only, so Explorer can drop on the add-image area. It is never a desktop-sized
# layer, never a cursor-following pad, and it has no title, label, or border.
# Do not set Form.Opacity. A value below 1 makes a layered window, and Windows
# will not deliver an Explorer file drop to a layered window.
# Keep cursor, hit testing and receiver bounds in physical screen pixels.
# UXP supplies CSS pixels; convert them using the monitor under the pointer.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Windows.Forms -TypeDefinition @'
using System;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Text;
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
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromPoint(POINT p, uint flags);
  [DllImport("shcore.dll")] public static extern int GetScaleFactorForMonitor(IntPtr monitor, out int scale);
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
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int i);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  public static string Describe(IntPtr h) { var s=new StringBuilder(256);GetClassName(h,s,256);uint p;GetWindowThreadProcessId(h,out p);return s+" pid="+p+" visible="+IsWindowVisible(h)+" enabled="+IsWindowEnabled(h)+" style="+GetWindowLong(h,-16)+" ex="+GetWindowLong(h,-20); }
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
try { [OverlayNative]::SetThreadDpiAwarenessContext([IntPtr](-4)) | Out-Null } catch { [OverlayNative]::SetProcessDPIAware() | Out-Null }
$sync = [hashtable]::Synchronized(@{ action = 'idle'; id = ''; x = $null; y = $null; left = $null; top = $null; width = $null; height = $null; offsetX = $null; offsetY = $null; gen = 0; miss = 0; stop = $false })
$form = New-Object QuietDropForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AllowDrop = $true
$form.AutoScaleMode = 'None'
$form.StartPosition = 'Manual'
$form.Text = ''
# Same fill as the panel surface. No label and no colored edge: the window is
# the add-image area itself, not a second dialog.
$form.Padding = New-Object System.Windows.Forms.Padding(0)
$form.BackColor = [System.Drawing.Color]::FromArgb(53, 53, 53)
$form.Size = New-Object System.Drawing.Size(32, 32)
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
  $pt = New-Object OverlayNative+POINT
  [OverlayNative]::GetCursorPos([ref]$pt) | Out-Null
  return $pt
}
function Test-Inside($pt) {
  if (-not $form.Visible) { return $false }
  return $pt.X -ge ($form.Left + 8) -and $pt.Y -ge ($form.Top + 8) -and $pt.X -lt ($form.Right - 8) -and $pt.Y -lt ($form.Bottom - 8)
}
function Get-DpiScale {
  $scale = 100
  try {
    $point=Get-CursorPoint
    $monitor=[OverlayNative]::MonitorFromPoint($point,2)
    if([OverlayNative]::GetScaleFactorForMonitor($monitor,[ref]$scale) -ne 0){$scale=100}
  } catch {}
  return [double]$scale / 100.0
}
function Test-PointInRect($pt, $left, $top, $width, $height, $slack) {
  if ($width -lt 24 -or $height -lt 24 -or $width -gt 800 -or $height -gt 360) { return $false }
  if ($left -lt -8000 -or $left -gt 16000 -or $top -lt -8000 -or $top -gt 16000) { return $false }
  return ($pt.X -ge ($left - $slack)) -and ($pt.X -lt ($left + $width + $slack)) -and ($pt.Y -ge ($top - $slack)) -and ($pt.Y -lt ($top + $height + $slack))
}
function Get-CoverRect($pt) {
  # Place the window on the add-image box by the pointer's offset inside it.
  # Absolute screen coordinates from UXP were landing beside the cursor, so
  # Explorer dropped on the panel and the upload never arrived. Do not invent
  # a pad under the cursor: that pad is a separate window and covers other controls.
  $baseW = 0.0; $baseH = 0.0
  try { $baseW = [double]$sync.width; $baseH = [double]$sync.height } catch {}
  if ($baseW -lt 24 -or $baseH -lt 24 -or $baseW -gt 800 -or $baseH -gt 360) { return $null }
  $scale=Get-DpiScale
  $baseW *= $scale; $baseH *= $scale
  $ox = $null; $oy = $null
  try {
    if ($null -ne $sync.offsetX -and "$($sync.offsetX)" -ne '') { $ox = [double]$sync.offsetX }
    if ($null -ne $sync.offsetY -and "$($sync.offsetY)" -ne '') { $oy = [double]$sync.offsetY }
  } catch {}
  if ($null -ne $ox -and $null -ne $oy) {
    $left = [int][Math]::Round($pt.X - $ox * $scale)
    $top = [int][Math]::Round($pt.Y - $oy * $scale)
    $rect = New-Object System.Drawing.Rectangle($left, $top, [int][Math]::Round($baseW), [int][Math]::Round($baseH))
    if (Test-PointInRect $pt $rect.X $rect.Y $rect.Width $rect.Height 1) { return $rect }
    return $null
  }
  try {
    $left = [double]$sync.left; $top = [double]$sync.top
    if (Test-PointInRect $pt $left $top $baseW $baseH 1) {
      return New-Object System.Drawing.Rectangle([int][Math]::Round($left), [int][Math]::Round($top), [int][Math]::Round($baseW), [int][Math]::Round($baseH))
    }
  } catch {}
  return $null
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
  $script:dropRegistered = $true
}
function Pulse-Drag {
  if ($script:pulsed -or -not (Test-MouseDown)) { return }
  $pt = Get-CursorPoint
  # +1 then -1 has to stay on the catch. A pulse from the edge walks the
  # hotspot onto the UXP panel and the drop is empty again.
  $inside = $form.Visible -and $pt.X -ge $form.Left -and $pt.X -lt $form.Right -and $pt.Y -ge $form.Top -and $pt.Y -lt $form.Bottom
  if (-not $inside) { return }
  $script:pulsed = $true
  try { [OverlayNative]::PulseDrag() } catch {}
}
function Update-Cover([string]$id) {
  if ($script:holdOffId -eq $id) { return }
  $pt = Get-CursorPoint
  # Freeze the add-area rectangle for this drag. Recomputing it from the live
  # cursor and the first dragenter offset makes the target chase the cursor,
  # particularly when Explorer enters within the first few edge pixels.
  $same = $script:shownId -eq $id -and $form.Visible
  if ($same) { Keep-Topmost; Pulse-Drag; return }
  $bounds = Get-CoverRect $pt
  if ($null -eq $bounds) { try { Send-Json 'http://127.0.0.1:17402/drop/native' ((@{event='invalid-rectangle';width=$sync.width;height=$sync.height;offsetX=$sync.offsetX;offsetY=$sync.offsetY}|ConvertTo-Json -Compress)) 'POST' } catch {}; Hide-Cover; return }
  $form.Bounds = $bounds
  try { Send-Json 'http://127.0.0.1:17402/drop/native' ((@{event='cover';id=$id;left=$bounds.X;top=$bounds.Y;width=$bounds.Width;height=$bounds.Height;cursorX=$pt.X;cursorY=$pt.Y;scale=(Get-DpiScale)}|ConvertTo-Json -Compress)) 'POST' } catch {}
  if (-not $same) { $script:over = $false }
  $script:shownId = $id
  $script:sessionId = $id
  $wasVisible = [bool]$form.Visible
  if (-not $wasVisible) { $form.Show() }
  $placed = [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, [uint32]0x0050)
  Enable-DropTarget
  Pulse-Drag
  try {
    $physical=New-Object OverlayNative+POINT
    [OverlayNative]::GetCursorPos([ref]$physical) | Out-Null
    $actual=New-Object OverlayNative+RECT
    [OverlayNative]::GetWindowRect($form.Handle,[ref]$actual) | Out-Null
    $hit=[OverlayNative]::WindowFromPoint($physical)
    Send-Json 'http://127.0.0.1:17402/drop/native' ((@{event='shown';id=$id;placed=$placed;visible=$form.Visible;mouseDown=(Test-MouseDown);pulsed=$script:pulsed;physicalX=$physical.X;physicalY=$physical.Y;actualLeft=$actual.Left;actualTop=$actual.Top;actualRight=$actual.Right;actualBottom=$actual.Bottom;hit=$hit.ToInt64();hitInfo=[OverlayNative]::Describe($hit);hwnd=$form.Handle.ToInt64();formInfo=[OverlayNative]::Describe($form.Handle)}|ConvertTo-Json -Compress)) 'POST'
  } catch {}
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
  if ($info.Length -gt 40MB) { throw '每张图片不超过 40MB。' }
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
  try { Send-Json 'http://127.0.0.1:17402/drop/native' '{"event":"enter"}' 'POST' } catch {}
  $script:upSince = $null
  if (Test-FileDrag $e.Data) { $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy }
  else { $e.Effect = [System.Windows.Forms.DragDropEffects]::None }
}
$onDrop = {
  param($sender, $e)
  $script:over = $true
  try { Send-Json 'http://127.0.0.1:17402/drop/native' '{"event":"drop"}' 'POST' } catch {}
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
$form.Add_DragLeave({ $script:over = $false })
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
      $state.offsetX = $view.offsetX
      $state.offsetY = $view.offsetY
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
$script:lastHeartbeat = [DateTime]::MinValue
$timer.Add_Tick({
  if (((Get-Date)-$script:lastHeartbeat).TotalMilliseconds -gt 1000) {
    $script:lastHeartbeat=Get-Date
    try { Send-Json 'http://127.0.0.1:17402/drop/native' ((@{event='heartbeat';action=$sync.action;session=$sync.id;visible=$form.Visible;left=$form.Left;top=$form.Top;width=$form.Width;height=$form.Height;mouseDown=(Test-MouseDown)}|ConvertTo-Json -Compress)) 'POST' } catch {}
  }
  if ($sync.stop) { $timer.Stop(); [System.Windows.Forms.Application]::Exit(); return }
  $action = [string]$sync.action
  $id = [string]$sync.id
  if ($action -ne 'show' -or -not $id) { $script:holdOffId = ''; $script:upSince = $null; Hide-Cover; return }
  Update-Cover $id
  if (-not $form.Visible) { return }
  if (Test-MouseDown) { $script:upSince = $null; return }
  if (-not $script:upSince) { $script:upSince = Get-Date; return }
  if (((Get-Date) - $script:upSince).TotalMilliseconds -ge 200) {
    $script:holdOffId = $id
    Hide-Cover
  }
})
$context = New-Object System.Windows.Forms.ApplicationContext
$timer.Start()
[System.Windows.Forms.Application]::Run($context)
$sync.stop = $true
try { $rs.Close() } catch {}
