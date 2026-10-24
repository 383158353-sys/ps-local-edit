# Borderless catch layer for one Explorer drag. No title, no taskbar button.
# The panel calls /drop/cover while the mouse button is still down; this process
# polls /drop/overlay and shows itself over the panel so the same drop can read
# real file paths. It must not use a transparent hit-test style or the drop misses.
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
$form = New-Object QuietDropForm
$form.FormBorderStyle = 'None'
$form.ShowInTaskbar = $false
$form.TopMost = $true
$form.AllowDrop = $true
$form.Opacity = 0.06
$form.StartPosition = 'Manual'
$form.Text = ''
$form.Size = New-Object System.Drawing.Size(480, 360)
$script:shownId = ''
$script:sessionId = ''
$script:dismissedId = ''
$script:busy = $false
$script:misses = 0
$script:upTicks = 0
$script:over = $false
function Hide-Cover {
  if ($form.Visible) { $form.Hide() }
  $script:shownId = ''
}
function Find-CoverBounds {
  $pt = New-Object OverlayNative+POINT
  [OverlayNative]::GetCursorPos([ref]$pt) | Out-Null
  $hwnd = [OverlayNative]::WindowFromPoint($pt)
  if ($hwnd -eq $form.Handle -and $form.Visible) { return $null }
  $best = $null
  $guard = 0
  while ($hwnd -ne [IntPtr]::Zero -and $hwnd -ne $form.Handle -and $guard -lt 10) {
    $rect = New-Object OverlayNative+RECT
    if ([OverlayNative]::GetWindowRect($hwnd, [ref]$rect)) {
      $w = $rect.Right - $rect.Left
      $h = $rect.Bottom - $rect.Top
      if ($w -ge 140 -and $w -le 780 -and $h -ge 80 -and $h -le 2000) {
        $best = New-Object System.Drawing.Rectangle($rect.Left, $rect.Top, $w, $h)
      }
    }
    $next = [OverlayNative]::GetParent($hwnd)
    if ($next -eq $hwnd) { break }
    $hwnd = $next
    $guard++
  }
  if ($best) { return $best }
  return New-Object System.Drawing.Rectangle(($pt.X - 240), ($pt.Y - 180), 480, 360)
}
function Show-Cover([string]$id) {
  if ($script:dismissedId -eq $id) { return }
  if ($script:shownId -eq $id -and $form.Visible) {
    [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), 0, 0, 0, 0, [uint32]0x0013) | Out-Null
    return
  }
  $script:upTicks = 0
  $script:over = $false
  $bounds = Find-CoverBounds
  if (-not $bounds) { return }
  $form.Bounds = $bounds
  $script:shownId = $id
  $script:sessionId = $id
  if (-not $form.Visible) { $form.Show() }
  [OverlayNative]::SetWindowPos($form.Handle, [IntPtr](-1), $bounds.X, $bounds.Y, $bounds.Width, $bounds.Height, [uint32]0x0050) | Out-Null
}
function Get-OverlayState {
  try {
    $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:17402/drop/overlay')
    $req.Method = 'GET'
    $req.Timeout = 800
    $req.Headers.Add('X-PS-Local-Voice', '1')
    $res = $req.GetResponse()
    $reader = New-Object System.IO.StreamReader($res.GetResponseStream())
    $text = $reader.ReadToEnd()
    $reader.Close()
    $res.Close()
    return $text | ConvertFrom-Json
  } catch { return $null }
}
function Send-References($refs) {
  $parts = foreach ($ref in @($refs)) {
    $name = ([string]$ref.name).Replace('\', '\\').Replace('"', '\"')
    '{"name":"' + $name + '","data":"' + [string]$ref.data + '"}'
  }
  $json = '{"references":[' + ($parts -join ',') + ']}'
  $req = [System.Net.HttpWebRequest]::Create('http://127.0.0.1:17402/drop/upload?id=' + [uri]::EscapeDataString($script:sessionId))
  $req.Method = 'POST'
  $req.Timeout = 20000
  $req.ContentType = 'application/json; charset=utf-8'
  $req.Headers.Add('X-PS-Local-Voice', '1')
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  $req.ContentLength = $bytes.Length
  $stream = $req.GetRequestStream()
  $stream.Write($bytes, 0, $bytes.Length)
  $stream.Close()
  $res = $req.GetResponse()
  $res.Close()
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
  $script:upTicks = 0
  if ($e.Data.GetDataPresent([System.Windows.Forms.DataFormats]::FileDrop)) { $e.Effect = [System.Windows.Forms.DragDropEffects]::Copy }
  else { $e.Effect = [System.Windows.Forms.DragDropEffects]::None }
}
$onDrop = {
  param($sender, $e)
  try {
    $files = @($e.Data.GetData([System.Windows.Forms.DataFormats]::FileDrop) | Where-Object { [System.IO.Path]::GetExtension($_).ToLowerInvariant() -in '.png', '.jpg', '.jpeg', '.webp' -and [System.IO.File]::Exists($_) } | Select-Object -First 5)
    if (-not $files -or $files.Count -eq 0) { Hide-Cover; return }
    $refs = @()
    foreach ($file in $files) { $refs += Reference-FromFile ([string]$file) }
    Send-References $refs
    Hide-Cover
  } catch { Hide-Cover }
}
$form.Add_DragEnter($onEnter)
$form.Add_DragOver($onEnter)
$form.Add_DragDrop($onDrop)
$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 50
$timer.Add_Tick({
  if ($script:busy) { return }
  $script:busy = $true
  try {
    $state = Get-OverlayState
    if (-not $state) {
      $script:misses++
      if ($script:misses -ge 40) { $timer.Stop(); [System.Windows.Forms.Application]::Exit() }
      return
    }
    $script:misses = 0
    if ($state.action -eq 'show' -and $state.id) {
      Show-Cover ([string]$state.id)
      $down = ([OverlayNative]::GetAsyncKeyState(0x01) -band 0x8000) -ne 0
      if ($form.Visible -and -not $down) {
        $script:upTicks++
        if ($script:upTicks -ge 4) { $script:dismissedId = [string]$state.id; Hide-Cover }
      } else { $script:upTicks = 0 }
    } else { Hide-Cover }
  } finally { $script:busy = $false }
})
$context = New-Object System.Windows.Forms.ApplicationContext
$timer.Start()
[System.Windows.Forms.Application]::Run($context)
