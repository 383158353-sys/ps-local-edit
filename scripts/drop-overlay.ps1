# Resident catch layer. The helper starts this process at boot.
# While a drag is active the panel calls /drop/cover; a background poll wakes
# immediately and this window covers the cursor so the same drop can read files.
# It has no title bar and no taskbar button. Do not use a click-through style.
# Do not set Form.Opacity. A value below 1 makes a layered window, and Windows
# will not deliver an Explorer file drop to a layered window.
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
  public static void AllowDropMessages(IntPtr hwnd) {
    ChangeWindowMessageFilterEx(hwnd, 0x0049, 1, IntPtr.Zero); // WM_COPYGLOBALDATA
    ChangeWindowMessageFilterEx(hwnd, 0x004A, 1, IntPtr.Zero); // WM_COPYDATA
    ChangeWindowMessageFilterEx(hwnd, 0x0233, 1, IntPtr.Zero); // WM_DROPFILES
  }
  public static void PulseDrag() {
    mouse_event(0x0001, 1, 0, 0, System.UIntPtr.Zero);
  }
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
$form.AutoScaleMode = 'None'
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
  $ok = [OverlayNative]::GetCursorPos([ref]$pt)
  if (-not $ok -and $null -ne $sync.x -and $null -ne $sync.y) { $pt.X = [int]$sync.x; $pt.Y = [int]$sync.y }
  return $pt
}
function Test-Inside($pt) {
  if (-not $form.Visible) { return $false }
  return $pt.X -ge ($form.Left + 8) -and $pt.Y -ge ($form.Top + 8) -and $pt.X -lt ($form.Right - 8) -and $pt.Y -lt ($form.Bottom - 8)
}
function Get-CoverRect($pt) {
  # VirtualScreen is in the same coordinate space as this WinForms window.
  # A 900x700 rect built from GetCursorPos is not: that API is physical pixels,
  # and SetProcessDPIAware inside an already-started PowerShell process does
  # not change the form. On a scaled display the catch layer missed the cursor,
  # so Explorer released onto the UXP panel.
  $screen = [System.Windows.Forms.SystemInformation]::VirtualScreen
  if ($screen.Width -lt 100 -or $screen.Height -lt 100) {
    return New-Object System.Drawing.Rectangle(0, 0, 1920, 1080)
  }
  return New-Object System.Drawing.Rectangle($screen.X, $screen.Y, $screen.Width, $screen.Height)
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
  $script:pulsed = $true
  # DoDragDrop hit-tests on mouse movement. A window shown under a still
  # cursor never receives DragEnter. One pixel stays on the full-screen target.
  # Do not use SetCursorPos: the shell drag loop ignores it and the hotspot
  # drifts off the window.
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
