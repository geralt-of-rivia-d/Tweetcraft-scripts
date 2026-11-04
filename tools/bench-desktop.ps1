# Runs a bench on the next virtual desktop, so its windows and flashing stay off the desktop you're using.
#
#   powershell -File tools/bench-desktop.ps1 -Log <file> -- --prewarm 20 --no-vsync-pass ...bench arguments...
#
# Uses the desktop to the right of the current one, creating one if there's only one desktop. The bench must get --prewarm:
# Windows opens new windows on the active desktop and won't move another process's window, so the windows are all
# opened during the few seconds this script spends on the other desktop.
#
# Your screen switches over and back once. The switch back is in a finally block with only time-limited waits before
# it, and nothing that can hang runs in between: an earlier version stranded the user on the empty desktop.
[CmdletBinding(PositionalBinding = $false)]
param(
    [Parameter(Mandatory)][string]$Log,
    [int]$OpenLimitSeconds = 45,
    [Parameter(ValueFromRemainingArguments)][string[]]$BenchArgs
)
$root = Split-Path $PSScriptRoot -Parent
$marker = Join-Path $root 'reports\.prewarm-done'
$vdKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops'

Add-Type -Name K -Namespace TcBench -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
function Combo([byte]$key) {
    $z = [UIntPtr]::Zero
    [TcBench.K]::keybd_event(0x5B, 0, 1, $z); [TcBench.K]::keybd_event(0x11, 0, 0, $z)
    [TcBench.K]::keybd_event($key, 0, 1, $z); [TcBench.K]::keybd_event($key, 0, 3, $z)
    [TcBench.K]::keybd_event(0x11, 0, 2, $z); [TcBench.K]::keybd_event(0x5B, 0, 3, $z)
}
function Current { [guid]::new([byte[]](Get-ItemProperty $vdKey).CurrentVirtualDesktop) }

$ids = (Get-ItemProperty $vdKey -ErrorAction SilentlyContinue).VirtualDesktopIDs
$create = -not $ids -or $ids.Length -lt 32
if (-not ($BenchArgs -match '^--prewarm')) { Write-Output 'FAIL: pass --prewarm N to the bench'; exit 1 }

Remove-Item $marker -ErrorAction SilentlyContinue
$args2 = @('tools/bench.mjs') + ($BenchArgs | Where-Object { $_ -ne '--' } | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } })
$homeDesk = Current
$proc = $null
try {
    if ($create) { Combo 0x44 } else { Combo 0x27 }   # Win+Ctrl+D creates and switches; Win+Ctrl+Right
    Start-Sleep -Milliseconds 700
    $benchDesk = Current
    if ($benchDesk -eq $homeDesk) { Write-Output 'FAIL: there is no desktop to the right of this one'; exit 1 }
    $proc = Start-Process -FilePath node -ArgumentList $args2 -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput $Log -RedirectStandardError "$Log.err"
    $null = $proc.Handle   # without this, ExitCode reads empty and a failed bench looks fine
    $waited = 0
    while ($waited -lt $OpenLimitSeconds * 10 -and -not (Test-Path $marker) -and -not $proc.HasExited) { Start-Sleep -Milliseconds 100; $waited++ }
    if (Test-Path $marker) { Write-Output "windows opened after $([math]::Round($waited / 10, 1)) s" }
    else { Write-Output 'WARN: the windows were not ready in time: later rows may open on your desktop' }
} finally {
    # Only if we moved: on the rightmost desktop Win+Ctrl+Right does nothing, and Left would then overshoot.
    if ((Current) -ne $homeDesk) { Combo 0x25; Start-Sleep -Milliseconds 700 }
}
if ((Current) -eq $homeDesk) { Write-Output 'back on your desktop' } else { Write-Output 'WARN: not back on the original desktop: press Win+Ctrl+Left' }
if ($proc) { $proc.WaitForExit(); Write-Output "bench exit code: $($proc.ExitCode)"; exit $proc.ExitCode } else { exit 1 }
