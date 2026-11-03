// Machine checks before a real-GPU bench (bench.mjs --preflight): is this laptop in a state where its numbers mean
// something? Cheap checks only (one PowerShell call, ~1-3 s); the vanilla calibration itself is in bench.mjs.
//   power      on AC (Win32_Battery.BatteryStatus 2 = on AC; 1 = discharging) - on battery the UHD 620 clocks down
//   plan       the active power scheme (powercfg /getactivescheme) and the Windows 11 power mode overlay
//   cpu        background CPU load over a short sample (other work skews frame times)
//   lock       who holds reports/.gpu.lock (we would wait for it)
//   display    the panel's mode (Win32_VideoController: 1920x1080 at 60 Hz is the standard)
//   perfPct    "% Processor Performance" (CPU clock vs nominal; well under 100 while busy = power/thermal limited)
// Each check gives { ok: true|false|null, text }; null = could not tell (non-Windows, query failed).
import { execFile } from 'node:child_process';
import { cpus, platform } from 'node:os';
import { lockStatus } from './gpu-lock.mjs';

// Windows 11 power mode overlays (HKLM\...\Power\User\PowerSchemes ActiveOverlayAcPowerScheme).
const OVERLAYS = {
  'ded574b5-45a0-4f42-8737-46345c09c238': 'Best performance',
  '00000000-0000-0000-0000-000000000000': 'Balanced',
  '961cc777-2547-4f9d-8174-7d86181b8a7a': 'Best power efficiency',
  '3af9b8d9-7c97-431d-ad78-34a8bfea439f': 'Better performance',
};

const PS = `$o = @{}
try { $o.battery = @(Get-CimInstance Win32_Battery -ErrorAction Stop | ForEach-Object { @{ status = $_.BatteryStatus; charge = $_.EstimatedChargeRemaining } }) } catch { $o.batteryErr = "$_" }
try { $o.scheme = (powercfg /getactivescheme) -join ' ' } catch {}
try { $p = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes' -ErrorAction Stop; $o.overlayAc = $p.ActiveOverlayAcPowerScheme; $o.overlayDc = $p.ActiveOverlayDcPowerScheme } catch {}
try { $o.video = @(Get-CimInstance Win32_VideoController -ErrorAction Stop | ForEach-Object { @{ name = $_.Name; w = $_.CurrentHorizontalResolution; h = $_.CurrentVerticalResolution; hz = $_.CurrentRefreshRate } }) } catch {}
try { $o.perfPct = [math]::Round((Get-Counter '\\Processor Information(_Total)\\% Processor Performance' -ErrorAction Stop).CounterSamples[0].CookedValue, 1) } catch {}
$o | ConvertTo-Json -Depth 4 -Compress`;

function powershellJson(script, timeout = 25000) {
  return new Promise(res => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout, windowsHide: true }, (err, out) => {
      if (err) return res(null);
      try { res(JSON.parse(String(out).trim())); } catch { res(null); }
    });
  });
}

function cpuTimes() {
  return cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
}
/** Whole-machine CPU busy % over `ms`. */
export async function cpuLoad(ms = 2000) {
  const a = cpuTimes();
  await new Promise(r => setTimeout(r, ms));
  const b = cpuTimes();
  return b.all > a.all ? Math.round((100 * (b.busy - a.busy)) / (b.all - a.all)) : null;
}

/**
 * The system checks. `cpuMaxPct`: background load above this WARNs. Returns { checks: {name: {ok, text, ...}}, bad: [text] }.
 * Never throws.
 */
export async function systemChecks({ cpuMaxPct = 20, cpuSampleMs = 2000, w = 1920, h = 1080 } = {}) {
  const checks = {};
  const [info, load] = await Promise.all([
    platform() === 'win32' ? powershellJson(PS) : Promise.resolve(null),
    cpuLoad(cpuSampleMs),
  ]);
  // Power source.
  if (!info) checks.power = { ok: null, text: platform() === 'win32' ? 'could not query Win32_Battery' : `not checked on ${platform()}` };
  else if (!info.battery || !info.battery.length) checks.power = { ok: true, text: 'no battery (mains)' };
  else {
    const onAc = info.battery.every(b => b.status !== 1 && b.status !== 4 && b.status !== 5); // 1 discharging, 4 low, 5 critical
    const charge = info.battery[0].charge;
    checks.power = { ok: onAc, text: onAc ? `on AC (battery ${charge ?? '?'}%)` : `ON BATTERY (${charge ?? '?'}%): the GPU and CPU clock down; plug in`, status: info.battery.map(b => b.status), charge };
  }
  // Power plan and mode.
  if (info && info.scheme) {
    const m = info.scheme.match(/\(([^)]+)\)\s*$/);
    const name = m ? m[1] : info.scheme;
    const mode = OVERLAYS[String(info.overlayAc || '').toLowerCase()] || (info.overlayAc ? `overlay ${info.overlayAc}` : null);
    const saver = /saver|efficien/i.test(name) || /efficiency/i.test(mode || '');
    checks.plan = { ok: !saver, text: `${name}${mode ? `, power mode ${mode}` : ''}${saver ? ': a power-saving plan lowers clocks' : ''}`, scheme: name, mode };
  } else checks.plan = { ok: null, text: 'could not read the power plan' };
  // Background CPU.
  checks.cpu = load === null ? { ok: null, text: 'could not sample CPU load' } : { ok: load <= cpuMaxPct, text: `${load}% busy over ${cpuSampleMs / 1000}s${load > cpuMaxPct ? ` (> ${cpuMaxPct}%: background work skews frame times)` : ''}`, pct: load };
  // GPU lock.
  try {
    const ls = lockStatus();
    const g = ls.gpu && ls.gpu.pid !== process.pid ? ls.gpu : null;
    checks.lock = g ? { ok: false, text: `held by ${g.owner} (pid ${g.pid}): this run waits for it`, owner: g.owner, pid: g.pid } : { ok: true, text: 'free' };
    if (ls.software.length) checks.lock.text += `; ${ls.software.length} software-mode browser(s) running`;
  } catch (e) { checks.lock = { ok: null, text: `could not read: ${e.message}` }; }
  // Display mode.
  const v = info && Array.isArray(info.video) ? info.video.find(x => x.w) || info.video[0] : null;
  if (v) {
    const good = v.w === w && v.h === h && (!v.hz || Math.abs(v.hz - 60) <= 1);
    checks.display = { ok: good, text: `${v.w}x${v.h} at ${v.hz ?? '?'} Hz (${v.name})${good ? '' : ` (the standard is ${w}x${h} at 60 Hz)`}`, w: v.w, h: v.h, hz: v.hz, gpu: v.name };
  } else checks.display = { ok: null, text: 'could not read the display mode' };
  // CPU clock vs nominal (informational: at idle it reads high on this laptop, ~160%).
  if (info && typeof info.perfPct === 'number') checks.perfPct = { ok: null, text: `CPU at ${info.perfPct}% of nominal clock`, pct: info.perfPct };
  const bad = Object.entries(checks).filter(([k, c]) => c.ok === false && k !== 'lock').map(([k, c]) => `${k}: ${c.text}`);
  return { checks, bad };
}
