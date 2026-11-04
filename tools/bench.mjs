#!/usr/bin/env node
// Real-GPU benchmark: open the game in a visible, uncapped Chrome on this machine's GPU, apply each scenario and
// measure frame times in the page. Holds the GPU lock (tools/lib/gpu-lock.mjs) for the whole run.
//
//   npm run bench                                         # vanilla,off,low,medium,high,ultra with the working copy
//   npm run bench -- --scenarios high,high+shadowFilter=0,ultra-moving,high-sprint
//   npm run bench -- --ref origin/main --label baseline   # userscripts as published on origin/main
//   npm run bench -- --script C:\path\to\shaders.user.js  # replace the script with the same @name (or add it)
//   npm run bench -- --angle gl --seconds 10 --warmup 3 --compare reports/bench-baseline.json
//   npm run bench -- --repeat 3 --cooldown 60             # decisions: 3 passes, 60 s idle before each
//   npm run bench -- --scenarios "vanilla,high,vanilla@rd=8,high@rd=8,high@fov=110,high@heldLight=off"
//
// Game settings: --rd (default 12) and --fov (default 80) are the standard the user plays at (render distance 12, the
//   game's maximum, FOV 80, 1920x1080); --held-light on|off is left at the game default unless given. They are written
//   to mc.rd / mc.fov / mc.heldLight in the bench's fresh profile before the game loads (plain settings, never the
//   mc.tok / mc.admin / mc.key.* secrets). A row can override them with @rd=N, @fov=N, @heldLight=on|off. Every row
//   checks on the live page that the game draws them (fog end = rd*16-4, the FOV and far plane of the camera's
//   view-projection) and records that in row.view; a mismatch WARNs. At rd 12 the title world meshes ~577 chunk
//   columns (2x rd 8's 293), so the bench also waits for meshing to stop before measuring (--mesh-max).
//
// Scenarios: vanilla (no userscripts) | off (shaders enabled=false) | <preset>[+key=value]...[-moving|-sprint|-stress]
//   <preset> is low|medium|high|ultra|current (current = the script's defaults); +key=value goes through
//   Twitterentary.set(). A preset, key or API the loaded script lacks makes the row n/a, never a silent stand-in.
// Motion suffixes go through Twitterentary.stress() (in memory only). The title camera stands still, so these
//   emulate a moving player's camera drift for the script's shadow-refresh logic only (no chunk loading or meshing):
//   -moving  stress({moveSpeed: 11})          creative flying, ~11 blocks/s
//   -sprint  stress({moveSpeed: 22})          sprint-flying, ~22 blocks/s
//   -stress  stress({shadowRefreshEvery: 4})  a forced shadow redraw every 4 frames: informational worst case only
//   Why: shadowRefreshEvery 4 forces ~1000 redraws/min, while a real player on High causes ~60-90 walking and ~300
//   sprint-flying, so -stress overstates the moving cost several times over. (-moving meant -stress before this
//   recalibration; --compare flags rows whose baseline used the other meaning.) A script whose stress() does not
//   echo moveSpeed back makes -moving/-sprint rows n/a.
// Noise/thermal guard (--guard 25, needs --repeat >= 2): vanilla runs in every pass (it is added if missing) as the
//   machine's reference. A pass whose vanilla median or p95gb is more than 25% above the best pass's is marked
//   unreliable (WARN, row notes, runs[].unreliable, env.passes): after hours of GPU load this laptop throttles (seen:
//   vanilla median spread 62%, p95gb 10.5 vs ~5.6 ms). The medians still include that pass. --cooldown <s> idles
//   (holding the GPU lock) before each pass.
// Isolation: one browser (and GPU lock) per run, one fresh browser context per scenario (clean localStorage, new
//   page, new GL context), so nothing leaks from one scenario into the next.
// Per scenario: boot -> wait for window.__ready and steady frame times (world meshed) -> apply -> warm-up -> wait
//   until the title camera, which turns 0.03 rad per second of game time, reaches --at seconds (default 40) -> measure.
//   So every scenario sees the same view (same chunks and pixels); the row records the yaw it started at.
// Measured in the page by an init script that sits under every userscript (so vanilla and old refs work too):
//   frame interval = difference of consecutive rAF timestamps; JS ms = time spent in all rAF callbacks of a frame;
//   GPU ms = EXT_disjoint_timer_query_webgl2 TIME_ELAPSED around every rAF callback on the game's context, summed
//   per frame (includes GPU-process decode time and bubbles: an upper bound), or, when the shader script times the
//   GPU itself (Twitterentary.perf.timer), its per-frame samples (perf.gpuRing, joined on perf.frame);
//   1% low = 1000 / mean of the slowest 1% of frame intervals; p95gb / cpuSpikes / holds60: see stats().
//   With --repeat N each row is the median of N passes (run in alternating order) and carries spreadPct.
// Read medians and p95gb rather than mean FPS: the game's own JS bursts make means swing by up to ~30% between runs.
// The D3D11 backend (Chrome's default on Windows) paces frames evenly; gl and vulkan deliver them in bunches (tiny
// median, long stalls), which flatters the median and p95gb, so compare across backends by mean ms only.
//
// ---- Protocols: one decision in 1-2 runs (devloop, 2026-11) ------------------------------------------------------
//   npm run bench -- --protocol screen --scenarios vanilla,high,high+shadowRes=1024       # a quick look, ~40 s/row
//   npm run bench -- --protocol accept --scenarios vanilla,off,low,medium,high,ultra --label final-1.5b
//   npm run bench:history -- --scenario high --since 2026-11-01                          # look before you rerun
// --protocol screen|accept fills --seconds/--warmup/--repeat/--cooldown, --warp/--settle and --early-stop from
//   tools/lib/machine-profile.json (protocol.screen / protocol.accept), else built-in defaults (lib/bench-profile.mjs).
//   Explicit flags always win. accept then runs a --vsync pass as a child bench (bench-<label>-vsync.json), unless
//   --no-vsync-pass. Without --protocol every default is the legacy one (warp off, no early stop), so older
//   commands, such as BENCH4's acceptance runs, measure exactly as before.
// Where a row's time went (row.totalS ~52 s in every report up to 1.5): ~2.5 s to the first frame, ~10 s for the
//   shaders, steady frames and meshing (row.steadyS ~4 s, row.meshS ~0), then ~27 s doing nothing but wait for the
//   title camera's clock to reach --at 40, then 8 s measuring and ~1.5 s for the view probe and GPU queries. So
//   half of every row was the --at wait.
// --warp K (protocols: 10; 1 = off) fast-forwards that wait. The title camera's yaw only depends on the game's dt,
//   which is min(0.25 s, the difference of the rAF timestamps it is given) (main.js frameBody). Once the world is
//   meshed, and before the scenario is applied, the sampler adds an offset to the timestamps every rAF callback
//   receives, so each frame's dt is K times the real one (never past a frame's 0.25 s cap) until the clock reaches
//   --at minus --settle. The offset then stays constant, so every later dt is real. The game sees the timeline it
//   would see at that clock: the same yaw, the same `now` for its animations, the same chunks. Frame intervals are
//   still measured on the real timestamps. Trade-offs:
//     - the scenario now runs --settle (default 12 s; warm-up included) real seconds before measuring, instead of
//       the ~27 s the --at wait used to give it. row.settleS records it (legacy rows get it too). The shader
//       script's governor keeps 30 s of per-scale history, and so it has less of it at the start of the measurement.
//       Raise --settle if Auto-scale rows look different from the legacy ones;
//     - during the ~2 s of warping, the camera turns K times faster (a few extra shadow redraws), and the shader
//       script sees K-times frame intervals in its cadence rule. Both happen before the scenario is applied, and
//       --settle s of normal frames follow them;
//     - JS and GPU warm-up are ~15 s shorter (fewer JIT and GC cycles before the measurement).
//   Measured (reports/bench-devloop-warp-ab.json, warped and @warp=1 rows interleaved in one run, 5 s measure): rows
//   took 29-33 s instead of 48-50, and the results matched within the 1-pass noise (vanilla med 4.60/4.90 vs 4.50;
//   high 12.3/11.5 vs 12.3/11.7; GPU within 0.25 ms), all at clock 40.0-40.1. row.warp records
//   { k, fromClock, toClock, gainedS, realS, ok }.
// --early-stop (accept: on), with --repeat >= 2. After pass 1, a row whose verdict is clear of the holds-60 line
//   (|p95gb2 - 16.7| >= 2 and |med - 14| >= 0.8; vsync: miss% <= 0.5 or >= 1.5) is settled. In 74 past single passes,
//   no verdict outside those margins flipped against the 3-pass median (machine-profile.json protocol.accept.adaptive).
//   It needs a clean preflight calibration. If every row is settled, the run stops. Otherwise (adaptive; --no-adaptive
//   turns this off) only the unsettled rows, plus vanilla for the guard, run the later passes; the settled ones
//   keep their one pass and say so in the note. After pass 2 of 3+, the run stops when both passes agree: median
//   within max(0.6 ms, noise.med_pct), p95gb2 within max(1 ms, noise.p95gb2_pct), the same verdict, and nothing
//   flagged by the guard. env.earlyStop records each check. This is for verdicts: an A/B delta under ~0.4 ms median
//   needs all 3 passes (--no-early-stop).
// --preflight (on for headed real-GPU runs; --no-preflight skips it): before launching it checks AC power, the
//   power plan and mode, background CPU, the GPU lock holder and the display mode (lib/bench-preflight.mjs). Then a
//   vanilla calibration, compared with the profile's vanilla ranges (at the profile's standard, uncapped only). That
//   is pass 1's own vanilla row when vanilla runs first (so it costs nothing), or else an extra warped vanilla row.
//   If it is above the range: with a protocol, cool down (profile thermal.cooldown_s) and recalibrate once. Then a
//   WARN, or exit 1 before measuring anything with --strict. Everything is recorded in env.preflight.
// --skip-vanilla: with --repeat >= 2, don't add vanilla to every pass. The guard then judges only the passes that
//   have a vanilla row, by the best pass and the profile range; the preflight calibration stands in for the rest.
//   It saves one row per pass, but a pass that throttles without a vanilla row is not caught.
// A/B drift: passes already alternate their order (ABBA), so slow drift hits A and B alike. A tighter
//   interleave would need several contexts alive at once, which costs isolation (two games sharing the GPU), so
//   there is none.
import { parseArgs } from 'node:util';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { cpus, platform, release as osRelease } from 'node:os';
import { join, resolve, relative, basename, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listUserscripts, parseMeta, targetUrl, latestSnapshot, ROOT, REPORTS_DIR, c, PASS, FAIL, WARN, annotate, summary } from './lib/common.mjs';
import { launchBrowser, openGame, readFatal, setFullscreen, ANGLE_BACKENDS } from './lib/browser.mjs';
import { wrapUserscript } from './lib/userscript-env.mjs';
import { lockStatus } from './lib/gpu-lock.mjs';
import { HOLD_MED, HOLD_P95, MISS_MS, HITCH_MS, VSYNC_MED, VSYNC_MED_TOL, VSYNC_MISS_PCT, HOLDS_RULE, holds60Of, holds60VsyncOf, holdsText, settingsOf, sameSettings, settingsText } from './lib/bench-report.mjs';
import { loadProfile, protocolSettings, noiseOf, cooldownOf, gpuMatches, offStandard, checkVanilla } from './lib/bench-profile.mjs';
import { systemChecks, cpuLoad } from './lib/bench-preflight.mjs';

// A bare --guard (no number, as the docs write it) means the default 25%.
const argv = process.argv.slice(2).flatMap((a, i, all) => (a === '--guard' && (i === all.length - 1 || all[i + 1].startsWith('-')) ? ['--guard=25'] : [a]));
const { values: opts } = parseArgs({
  args: argv,
  options: {
    scenarios: { type: 'string', default: 'vanilla,off,low,medium,high,ultra' },
    ref: { type: 'string' },
    script: { type: 'string', multiple: true },
    angle: { type: 'string', default: 'd3d11' },
    // No defaults here: --protocol fills what is not given explicitly, then the legacy defaults (see `explicit`).
    seconds: { type: 'string' },
    warmup: { type: 'string' },
    label: { type: 'string' },
    out: { type: 'string' },
    compare: { type: 'string' },
    'headless-gpu': { type: 'boolean', default: false },
    'chrome-arg': { type: 'string', multiple: true },
    target: { type: 'string', default: 'prod' },
    timeout: { type: 'string', default: '90000' },
    'steady-max': { type: 'string', default: '25' },
    shots: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
    size: { type: 'string', default: '1920x1080' },
    at: { type: 'string', default: '40' },
    repeat: { type: 'string' },
    guard: { type: 'string', default: '25' },
    cooldown: { type: 'string' },
    protocol: { type: 'string' },
    preflight: { type: 'boolean' },
    'no-preflight': { type: 'boolean', default: false },
    strict: { type: 'boolean', default: false },
    warp: { type: 'string' },
    settle: { type: 'string' },
    'early-stop': { type: 'boolean' },
    'no-early-stop': { type: 'boolean', default: false },
    'skip-vanilla': { type: 'boolean', default: false },
    'no-adaptive': { type: 'boolean', default: false },
    'vsync-pass': { type: 'boolean' },
    'no-vsync-pass': { type: 'boolean', default: false },
    'vsync-seconds': { type: 'string' },
    'vsync-repeat': { type: 'string' },
    prewarm: { type: 'string' },
    rd: { type: 'string', default: '12' },
    fov: { type: 'string', default: '80' },
    'held-light': { type: 'string' },
    fullscreen: { type: 'boolean', default: false },
    'mesh-max': { type: 'string', default: '120' },
    from: { type: 'string' },
    vsync: { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
if (opts.help) {
  console.log(`Usage: npm run bench -- [--scenarios a,b,...] [--ref <git-ref>] [--script <path>]... [--angle d3d11|gl|vulkan]
                 [--seconds 8] [--warmup 2] [--label <text>] [--out <json>] [--compare <json>] [--headless-gpu]
                 [--chrome-arg <flag>]... [--target prod|staging] [--steady-max 25] [--shots] [--raw] [--size 1920x1080]
                 [--at 40] [--repeat 1] [--guard 25] [--cooldown 0] [--rd 12] [--fov 80] [--held-light on|off]
                 [--fullscreen] [--mesh-max 120] [--from <json>] [--vsync]
                 [--protocol screen|accept] [--no-preflight] [--strict] [--warp 1] [--settle 12] [--early-stop]
                 [--skip-vanilla] [--no-adaptive] [--no-vsync-pass] [--vsync-seconds N] [--vsync-repeat N]

Decisions in 1-2 runs (look first: npm run bench:history -- --scenario <name>):
  --protocol screen   a quick look: 1 pass, warped --at wait, short measure (~35 s per row)
  --protocol accept   the decision: 3 passes with early stop, then a --vsync pass (bench-<label>-vsync.json)
                      Values come from tools/lib/machine-profile.json (protocol.*), else built-in; flags win.
  --warp K            fast-forward the title camera's clock K-fold (before applying the scenario) up to --at minus
                      --settle, instead of waiting for it in real time. 1 = off (the default without --protocol).
                      Same yaw and game time at the measurement; the scenario gets --settle s instead of ~27 s.
  --settle S          real seconds between applying the scenario and measuring when warping (default 12).
  --early-stop        with --repeat >= 2: stop after pass 1 when every verdict is clear of the holds-60 line
                      (|p95gb2 - 16.7| >= 2 and |med - 14| >= 0.8), or after pass 2 when both passes agree within
                      the profile's noise. Good for verdicts; for small A/B deltas (< 0.4 ms med) use --no-early-stop.
                      Adaptive: rows settled after pass 1 skip the later passes (--no-adaptive: all rows run them).
  --preflight         (default for headed runs; --no-preflight skips it) checks AC power, power plan, background CPU,
                      the GPU lock and the display mode, then calibrates on vanilla against the profile's range.
                      Out of range: WARN (with a protocol: cool down, recalibrate once). --strict: exit 1 instead.
  --skip-vanilla      with --repeat >= 2, don't add vanilla to every pass (the preflight calibration is the reference).
  @warp=K             per row, e.g. "vanilla,vanilla@warp=1": A/B the warp itself in one run.
  --no-vsync-pass     accept without the vsync pass. --vsync-seconds / --vsync-repeat size it (profile: 30 s x 2).
  --prewarm N         open N windows at launch and give one to each row, so all of them stay on the virtual desktop that
                      was active then (see prewarmWindows). Writes reports/.prewarm-done when they are open. Size it for
                      1 + rows x passes + a few retries. Use with --no-vsync-pass: an accept's vsync child opens later.

Scenarios: vanilla | off | <low|medium|high|ultra|current>[+key=value]...[-moving|-sprint|-stress]
  -moving   Twitterentary.stress({moveSpeed: 11}): creative flying (~11 blocks/s), camera drift for the shadow refresh
  -sprint   Twitterentary.stress({moveSpeed: 22}): sprint-flying (~22 blocks/s)
  -stress   Twitterentary.stress({shadowRefreshEvery: 4}): a forced shadow redraw every 4 frames, worst case only
            (~1000 redraws/min, vs ~60-90 for a real High player walking and ~300 sprint-flying; it was -moving before)
  A preset, key or stress() option the loaded script lacks makes the row n/a.
--repeat N    N passes, alternating order; each row is the median of its passes. Use 3 for decisions.
--guard P     with --repeat >= 2: vanilla runs in every pass, and a pass whose vanilla median or p95gb is more than
              P% above the best pass's is marked unreliable (thermal throttling, background load). 0 = off;
              a bare --guard means 25 (the default).
--cooldown S  idle S seconds (holding the GPU lock) before each pass.
--rd N        the game's render distance (mc.rd: 4|6|8|10|12), default 12 (the standard; the game's own default is 8).
--fov N       the game's FOV setting (mc.fov: 30-110), default 80 (the standard; the game's own default is 70).
--held-light on|off   the game's held-item light (mc.heldLight); unset = the game's default (on).
              All three go into the bench profile's localStorage before the game loads, and every row checks them
              on the live page (fog end, the FOV and far plane of the projection, chunk draws): a mismatch WARNs.
Per-scenario overrides for the secondary rows: append @rd=N, @fov=N, @heldLight=on|off, e.g.
  --scenarios "vanilla,high,vanilla@rd=8,high@rd=8,high@fov=110,high@heldLight=off,high-moving@rd=10"
--fullscreen  put each window into real browser fullscreen (DevTools Browser.setWindowBounds, like F11) without
              viewport emulation, so the canvas is the screen, instead of a 1920x1080 emulated viewport in a
              1920x1080 window. On this 1920x1080 laptop both give a 1920x1080 canvas.
--mesh-max S  after the game is ready, wait up to S s (default 120) until chunk meshing has stopped (no chunk
              buffer upload for 2 s); at rd 12 the far chunks mesh for a while after window.__ready.
--from <json>  run nothing: print a saved bench report's table (and --compare it), e.g. to compare two old runs.
--vsync       keep the display's vsync and Chrome's frame cap (no --disable-gpu-vsync / --disable-frame-rate-limit):
              frames are paced like a player's browser. Rows then add miss% (intervals > 20 ms, over all frames and
              over non-spike frames), > 50 ms hitches, scale changes/min (governor hunting) and the vsync verdict.
Judge uncapped runs on median and p95gb2. Holds 60 = median <= 14 ms and p95gb2 <= 16.7 ms.
  p95gb  = p95 interval without the frames whose callback was a game JS spike (>= 12 ms, not GPU wait);
  p95gb2 = also without the interval right after each spike (rAF timestamps lag a frame, so the stall shows twice).
  p95gb is still reported, so older reports stay comparable.
Holds 60 (vsync) = median 16.7 +- 0.5 ms and miss% <= 1%.
The standard: rd 12, FOV 80, 1920x1080 (the defaults). Secondary rows: rd 8 and 10, FOV 70 and 110, held light off.`);
  process.exit(0);
}

// ---- protocol and profile ------------------------------------------------------------
// Precedence for each value: an explicit flag, then --protocol (machine-profile.json, then built-in), then legacy.
const LEGACY = { seconds: 8, warmup: 2, repeat: 1, cooldown: 0, warp: 1, settle: 12, earlyStop: false };
const { profile: PROFILE, path: PROFILE_PATH, error: PROFILE_ERR } = loadProfile();
const PROTOCOL = opts.protocol ? String(opts.protocol).toLowerCase() : null;
if (PROTOCOL && !['screen', 'accept'].includes(PROTOCOL)) fail('--protocol must be screen or accept');
const PROTO = PROTOCOL ? protocolSettings(PROTOCOL, PROFILE) : null;
const pickNum = (flag, key) => (opts[flag] !== undefined ? Number(opts[flag]) : PROTO ? PROTO[key] : LEGACY[key]);
const pickBool = (flag, key) => (opts[`no-${flag}`] ? false : opts[flag] !== undefined ? opts[flag] : PROTO ? PROTO[key] : LEGACY[key]);
const SECONDS = pickNum('seconds', 'seconds'), WARMUP = pickNum('warmup', 'warmup'), STEADY_MAX = Number(opts['steady-max']), AT = Number(opts.at);
const REPEAT = Math.max(1, Math.floor(pickNum('repeat', 'repeat')) || 1);
const GUARD = Number(opts.guard), COOLDOWN = pickNum('cooldown', 'cooldown');
const WARP = pickNum('warp', 'warp'), SETTLE = pickNum('settle', 'settle');
const EARLY_STOP = pickBool('early-stop', 'earlyStop') && REPEAT >= 2;
// Adaptive (with early stop): rows settled after pass 1 skip passes 2..N. Off with --no-adaptive or protocol adaptive: false.
const ADAPTIVE = !opts['no-adaptive'] && (PROFILE?.protocol?.[PROTOCOL]?.adaptive?.enabled ?? true) !== false;
if (!(WARP >= 1 && WARP <= 50)) fail('--warp must be from 1 (off) to 50');
if (!(SETTLE >= 0)) fail('--settle must be >= 0 seconds');
const PREFLIGHT = !opts['no-preflight'] && !opts.from && (opts.preflight === true || !opts['headless-gpu']);
const STRICT = opts.strict;
const NOISE = noiseOf(PROFILE);
// accept runs a vsync pass after the uncapped one (a child bench with --vsync), unless asked not to or already vsync.
const VSYNC_PASS = !opts.vsync && !opts.from && (opts['no-vsync-pass'] ? false : opts['vsync-pass'] !== undefined ? opts['vsync-pass'] : PROTOCOL === 'accept');
// Preflight thresholds: profile.preflight.{warn,abort} if given, else analyst-data's numbers (25 clean vanilla passes,
// 2026-11-03): clean vanilla rows read sysCpuPct 42-50, every contaminated one >= 58.
// profile.vanilla.warn_if / abort_if: { med_gt, p95gb_gt, sysCpuPct_gt }.
const pfWarn = PROFILE?.vanilla?.warn_if || {}, pfAbort = PROFILE?.vanilla?.abort_if || {};
const PF_LIMITS = {
  warn: { med: pfWarn.med_gt ?? 5.0, p95gb: pfWarn.p95gb_gt ?? 8.5, sysCpuPct: pfWarn.sysCpuPct_gt ?? 55 },
  abort: { med: pfAbort.med_gt ?? 5.5, p95gb: pfAbort.p95gb_gt ?? 10 },
  bgCpuPct: PROFILE?.preflight?.bgCpuPct ?? 20,
  from: PROFILE?.vanilla?.warn_if ? 'profile' : 'built-in',
};
if (!(GUARD >= 0)) fail('--guard must be a percentage >= 0 (0 turns the noise guard off)');
if (!(COOLDOWN >= 0)) fail('--cooldown must be >= 0 seconds');
if (!(AT >= 0)) fail('--at must be >= 0 (seconds of the title camera turn at which measuring starts)');
if (!(SECONDS > 0) || !(WARMUP >= 0)) fail('--seconds must be > 0 and --warmup >= 0');
if (!ANGLE_BACKENDS.includes(opts.angle)) fail(`--angle must be one of ${ANGLE_BACKENDS.join(', ')}`);
const url = targetUrl(opts.target);
const [vw, vh] = opts.size.split('x').map(Number);
if (!(vw > 0 && vh > 0)) fail('--size must look like 1920x1080');
const VIEW = { width: vw, height: vh };
const FULLSCREEN = opts.fullscreen;
const MESH_MAX = Number(opts['mesh-max']);
const VSYNC = opts.vsync;
if (VSYNC && opts['headless-gpu']) fail('--vsync needs a visible window (a headless browser has no display to sync to): drop --headless-gpu');
if (!(MESH_MAX >= 0)) fail('--mesh-max must be >= 0 seconds');

// ---- game settings (the bench profile's localStorage, written before the game's modules run) ---------------------
// main.js reads them once at startup: mc.rd must be one of view.js RDS (else 8, 6 on touch); mc.fov is used when it
// is 30..110 (rounded, else 70); mc.heldLight is off only when it is "0" (the options menu writes "1"/"0").
const RDS = [4, 6, 8, 10, 12];
function parseRd(v, where) {
  const n = Number(v);
  if (!RDS.includes(n)) fail(`${where}: render distance must be one of ${RDS.join(', ')} (got "${v}")`);
  return n;
}
function parseFov(v, where) {
  const n = Number(v);
  if (!(Number.isInteger(n) && n >= 30 && n <= 110)) fail(`${where}: FOV must be a whole number from 30 to 110 (got "${v}")`);
  return n;
}
function parseHeld(v, where) {
  if (v === undefined || v === null) return null;
  const s = String(v).toLowerCase();
  if (['on', '1', 'true'].includes(s)) return 'on';
  if (['off', '0', 'false'].includes(s)) return 'off';
  fail(`${where}: held light must be on or off (got "${v}")`);
}
const SETTINGS = { rd: parseRd(opts.rd, '--rd'), fov: parseFov(opts.fov, '--fov'), heldLight: parseHeld(opts['held-light'], '--held-light') };
// Written by an init script in the top frame of the game's origin only (not into the Turnstile iframe).
const settingsInit = (s, origin) => ({
  content: `(() => { try { if (window.top !== window || location.origin !== ${JSON.stringify(origin)}) return;
  localStorage.setItem('mc.rd', ${JSON.stringify(String(s.rd))});
  localStorage.setItem('mc.fov', ${JSON.stringify(String(s.fov))});
  ${s.heldLight ? `localStorage.setItem('mc.heldLight', ${JSON.stringify(s.heldLight === 'on' ? '1' : '0')});` : ''}
} catch (e) {} })();`,
});

// ---- scenarios ----------------------------------------------------------------

const PRESETS = ['low', 'medium', 'high', 'ultra', 'current'];
// Motion suffixes -> Twitterentary.stress() options. The title camera stands still; moveSpeed (blocks/s) emulates a
// moving player's camera drift for the script's shadow-refresh logic. Calibration: a forced redraw every 4 frames
// (now -stress, formerly -moving) is ~1000 redraws/min, but a real High player walking causes ~60-90 and
// sprint-flying ~300, so -moving / -sprint use creative flying (~11 blocks/s) and sprint-flying (~22 blocks/s).
const MOTIONS = {
  moving: { moveSpeed: 11 },
  sprint: { moveSpeed: 22 },
  stress: { shadowRefreshEvery: 4 }, // informational worst case
};
// What a "-moving" row of a bench JSON written before the recalibration measured (rows carry no `stress` field).
const LEGACY_MOTIONS = { moving: { shadowRefreshEvery: 4 } };
function parseScenario(name) {
  const raw = name.trim();
  // Per-row game settings: <scenario>@rd=8@fov=110@heldLight=off (each optional; the rest come from --rd/--fov/...).
  const [base, ...ovs] = raw.split('@');
  const settings = { ...SETTINGS };
  let warp;
  for (const o of ovs) {
    const m = o.match(/^(rd|fov|heldLight|heldlight|hl|warp)=?(.+)$/);
    if (!m) throw new Error(`scenario "${raw}": "@${o}" is not @rd=N, @fov=N, @heldLight=on|off or @warp=K`);
    const where = `scenario "${raw}"`;
    if (m[1] === 'warp') { warp = Number(m[2]); if (!(warp >= 1 && warp <= 50)) throw new Error(`${where}: @warp must be from 1 (off) to 50`); }
    else if (m[1] === 'rd') settings.rd = parseRd(m[2], where);
    else if (m[1] === 'fov') settings.fov = parseFov(m[2], where);
    else settings.heldLight = parseHeld(m[2], where);
  }
  const sc = parseBase(base, raw);
  sc.name = raw;
  sc.settings = settings;
  if (warp !== undefined) sc.warp = warp; // per row (to A/B the warp itself), else --warp
  return sc;
}
function parseBase(raw, full) {
  if (raw === 'vanilla') return { vanilla: true };
  if (raw === 'off') return { off: true };
  let rest = raw, stress = null;
  const m = rest.match(/-(\w+)$/);
  if (m && MOTIONS[m[1]]) { stress = MOTIONS[m[1]]; rest = rest.slice(0, -m[0].length); }
  const [preset, ...pairs] = rest.split('+');
  if (!PRESETS.includes(preset)) throw new Error(`scenario "${full}": "${preset}" is not vanilla, off or a preset (${PRESETS.join(', ')})`);
  const sets = pairs.map(p => {
    const m = p.match(/^([\w.]+)=(.*)$/);
    if (!m) throw new Error(`scenario "${full}": "+${p}" is not key=value`);
    return [m[1], parseValue(m[2])];
  });
  return { preset, sets, stress };
}
function parseValue(v) {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (v !== '' && !Number.isNaN(Number(v))) return Number(v);
  return v;
}
let scenarios;
try { scenarios = opts.scenarios.split(',').filter(s => s.trim()).map(parseScenario); } catch (e) { fail(e.message); }
if (!scenarios.length) fail('no scenarios given');
if (new Set(scenarios.map(s => s.name)).size !== scenarios.length) fail('a scenario is listed twice');
// The noise/thermal guard compares the passes by their vanilla row, so every pass needs one.
const GUARDED = REPEAT > 1 && GUARD > 0;
const SKIP_VANILLA = opts['skip-vanilla'];
const guardAdded = GUARDED && !SKIP_VANILLA && !scenarios.some(s => s.name === 'vanilla');
if (guardAdded) scenarios.unshift(parseScenario('vanilla'));

// ---- userscripts ----------------------------------------------------------------

async function loadScripts() {
  let list;
  if (opts.ref) {
    const git = (...a) => execFileSync('git', ['-C', ROOT, ...a], { encoding: 'utf8', maxBuffer: 64 << 20 });
    let commit;
    try { commit = git('rev-parse', '--short', `${opts.ref}^{commit}`).trim(); } catch { fail(`--ref ${opts.ref}: not a commit in this repo`); }
    const files = git('ls-tree', '--name-only', opts.ref).split(/\r?\n/).filter(f => f.endsWith('.js'));
    list = [];
    for (const file of files) {
      const source = git('show', `${opts.ref}:${file}`);
      const meta = parseMeta(source);
      if (meta) list.push({ file, source, meta, ref: `${opts.ref} (${commit})` });
    }
  } else {
    list = (await listUserscripts()).map(s => ({ ...s, ref: 'working copy' }));
  }
  for (const p of opts.script || []) {
    const path = resolve(p);
    if (!existsSync(path)) fail(`--script ${p}: no such file`);
    const source = await readFile(path, 'utf8');
    const meta = parseMeta(source);
    if (!meta) fail(`--script ${p}: no // ==UserScript== block`);
    const rel = relative(ROOT, path);
    const inRepo = rel && !rel.startsWith('..') && !isAbsolute(rel);
    const s = { file: inRepo ? rel.replace(/\\/g, '/') : basename(path), source, meta, ref: `file ${path}` };
    const i = list.findIndex(x => x.meta.get('name') === meta.get('name'));
    if (i >= 0) list[i] = s; else list.push(s);
  }
  // Same order as listUserscripts(): Better Options (the settings bus) first.
  const rank = s => (/better-options/i.test(s.file) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
}

// ---- the in-page sampler (init script; runs before the recorder and every userscript) ----------------------------

function sampler() {
  if (window.top !== window || window.__tcbench) return;
  const TIME_ELAPSED = 0x88bf, AVAILABLE = 0x8867, RESULT = 0x8866;
  const now = performance.now.bind(performance);
  const B = (window.__tcbench = {
    gl: null, ext: null, timer: false, conflict: false, rec: false, armed: false,
    n: 0, sum: 0, lastT: -1, cur: 0, // cumulative frame counters (always on), JS ms of the frame in progress
    iv: [], js: [], qn: [], gs: [], gc: [], disjoint: 0, // per recorded frame
    activeQ: null, pool: [], pendQ: [], pendF: [],
    t0: 0, t1: 0, lost: 0, clock: 0,
    // --warp: off = offset (ms) added to the timestamp every rAF callback gets; while warpK > 1 and clock < warpTo,
    // each frame's game dt is warpK x the real one (capped at 0.25 s and at warpTo). Real timestamps stay in B.iv.
    off: 0, warpK: 1, warpTo: 0,
  });
  try { document.addEventListener('webglcontextlost', () => { B.lost++; }, true); } catch (e) {}
  try {
    const HC = HTMLCanvasElement.prototype, getContext = HC.getContext;
    HC.getContext = function (type) {
      const ctx = getContext.apply(this, arguments);
      try { if (!B.gl && ctx && type === 'webgl2' && this.id === 'gl') B.gl = ctx; } catch (e) {}
      return ctx;
    };
  } catch (e) {}
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  const nBegin = P && P.beginQuery, nEnd = P && P.endQuery;
  if (P) {
    // Someone else (a userscript's own GPU timer) starts a TIME_ELAPSED query while ours runs: only one can be
    // active, so end ours (discarded) and stop timing for the rest of this page, rather than break theirs.
    P.beginQuery = function (target, q) {
      if (target === TIME_ELAPSED && this === B.gl && B.activeQ) {
        try { nEnd.call(this, TIME_ELAPSED); } catch (e) {}
        B.pendQ.push(B.activeQ); B.pendF.push(-1);
        B.activeQ = null; B.conflict = true;
      }
      return nBegin.call(this, target, q);
    };
    // Evidence that the game's settings apply (B.probeView, outside the measured window) and meshing activity.
    // gfx.js pass() sets uVP, then uFog, then uFogR = (fogStart, fogEnd) per terrain pass, so the uVP set last before
    // a uFogR is the main camera's view-projection (rotation only: chunk origins are camera-relative).
    // Outside a probe these wrappers cost one property check; the VAO/buffer counters are on rare calls only.
    B.vaos = 0; B.bufN = 0; B.bufT = 0; B.probe = null;
    const names = new WeakMap();
    const nGUL = P.getUniformLocation, nU2f = P.uniform2f, nU1i = P.uniform1i, nUM4 = P.uniformMatrix4fv;
    const nDE = P.drawElements, nCVA = P.createVertexArray, nDVA = P.deleteVertexArray, nBD = P.bufferData;
    P.getUniformLocation = function (prog, name) {
      const l = nGUL.call(this, prog, name);
      try { if (l && this === B.gl && (name === 'uVP' || name === 'uFogR' || name === 'uHeldN')) names.set(l, name); } catch (e) {}
      return l;
    };
    P.uniformMatrix4fv = function (l, t, d) {
      const pr = B.probe;
      if (pr && this === B.gl && l && names.get(l) === 'uVP') { try { pr.vp = Array.prototype.slice.call(d, 0, 16); } catch (e) {} }
      return nUM4.apply(this, arguments);
    };
    P.uniform2f = function (l, x, y) {
      const pr = B.probe;
      if (pr && this === B.gl && l && names.get(l) === 'uFogR' && pr.fog.length < 400) pr.fog.push([x, y, pr.vp]);
      return nU2f.call(this, l, x, y);
    };
    P.uniform1i = function (l, v) {
      const pr = B.probe;
      if (pr && this === B.gl && l && names.get(l) === 'uHeldN') pr.held = Math.max(pr.held, v);
      return nU1i.call(this, l, v);
    };
    P.drawElements = function (m, n, t, o) {
      const pr = B.probe;
      if (pr && this === B.gl) pr.draws++;
      return nDE.call(this, m, n, t, o);
    };
    P.createVertexArray = function () {
      const v = nCVA.call(this);
      if (this === B.gl && v) B.vaos++;
      return v;
    };
    P.deleteVertexArray = function (v) {
      if (this === B.gl && v) B.vaos--;
      return nDVA.call(this, v);
    };
    P.bufferData = function () {
      if (this === B.gl) { B.bufN++; B.bufT = now(); }
      return nBD.apply(this, arguments);
    };
  }
  // Read the view the game draws for ms milliseconds: fog range, FOV/aspect/near/far from the projection, terrain
  // draws per frame, held lights, live VAOs (about 1-3 per meshed chunk column, plus a handful of the game's own).
  B.probeView = ms => new Promise(res => {
    const n0 = B.n;
    B.probe = { vp: null, fog: [], held: 0, draws: 0 };
    setTimeout(() => {
      const pr = B.probe, frames = B.n - n0;
      B.probe = null;
      const out = { frames, drawsPerFrame: frames ? pr.draws / frames : null, heldN: pr.held, vaos: B.vaos, fogStart: null, fogEnd: null, fov: null, aspect: null, near: null, far: null, fogSamples: pr.fog.length };
      // The most common fog range (the terrain passes), with the uVP that came with it.
      const cnt = new Map();
      for (const s of pr.fog) { const k = `${s[0].toFixed(2)},${s[1].toFixed(2)}`; const e = cnt.get(k) || { n: 0, s }; e.n++; if (!e.s[2] && s[2]) e.s = s; cnt.set(k, e); }
      const top = [...cnt.values()].sort((a, b) => b.n - a.n)[0];
      if (top) {
        out.fogStart = top.s[0]; out.fogEnd = top.s[1];
        const m = top.s[2];
        if (m) {
          // Column-major; VP = P * R with R a rotation: |row1| = f, |row0| = f / aspect, row3 = -R row 2 (unit length).
          const row = r => [m[r], m[4 + r], m[8 + r], m[12 + r]];
          const len3 = v => Math.hypot(v[0], v[1], v[2]);
          const r0 = row(0), r1 = row(1), r2 = row(2), r3 = row(3);
          const l3 = len3(r3);
          if (l3 > 0) {
            const f = len3(r1) / l3;
            out.fov = (2 * Math.atan(1 / f) * 180) / Math.PI;
            out.aspect = len3(r0) > 0 ? len3(r1) / len3(r0) : null;
            const A = -(r2[0] * r3[0] + r2[1] * r3[1] + r2[2] * r3[2]) / (l3 * l3), Bc = r2[3] / l3;
            out.far = A + 1 !== 0 ? Bc / (A + 1) : null;
            out.near = A - 1 !== 0 ? Bc / (A - 1) : null;
          }
        }
      }
      res(out);
    }, ms);
  });
  function poll() {
    const gl = B.gl, ext = B.ext;
    try {
      while (B.pendQ.length) {
        const q = B.pendQ[0];
        if (!gl.getQueryParameter(q, AVAILABLE)) break;
        const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT);
        const ns = gl.getQueryParameter(q, RESULT);
        const f = B.pendF[0];
        B.pendQ.shift(); B.pendF.shift(); B.pool.push(q);
        if (disjoint) B.disjoint++;
        else if (f >= 0) { B.gs[f] = (B.gs[f] || 0) + ns / 1e6; B.gc[f] = (B.gc[f] || 0) + 1; }
      }
    } catch (e) { B.timer = false; }
  }
  function newFrame(t) {
    if (B.lastT >= 0) {
      const d = t - B.lastT;
      B.n++; B.sum += d;
      // The title camera turns by dt * 0.03 rad per frame, dt = min(0.25 s, frame interval) (main.js frameBody):
      // follow the same clock from the game's first frames so every scenario can be measured at the same yaw.
      let g = Math.min(0.25, d / 1000);
      if (B.warpK > 1 && B.gl && B.clock < B.warpTo && d > 0 && d < 250) {
        const want = Math.min(0.25, (d * B.warpK) / 1000, B.warpTo - B.clock);
        if (want > g) { B.off += want * 1000 - d; g = want; }
      }
      if (B.gl) B.clock += g;
    }
    if (B.rec) {
      const w = now(); if (B.armed) { B.iv.push(t - B.lastT); B.ivw.push(w - B.lastW); B.js.push(B.cur); if (B.qn.length < B.iv.length) B.qn.push(0); }
      else { B.armed = true; B.t0 = w; }
      B.lastW = w;
    }
    B.lastT = t; B.cur = 0;
    if (B.pendQ.length && B.ext) poll();
  }
  // A callback's work ends in a microtask queued after it returns, so work the callback deferred to a microtask
  // (a userscript's composite pass) is timed too. Microtasks run in queue order, after each rAF callback.
  let mS = 0, mQ = null;
  function endCallback() {
    const q = mQ;
    mQ = null;
    if (q && B.activeQ === q) {
      try { nEnd.call(B.gl, TIME_ELAPSED); B.pendQ.push(q); B.pendF.push(B.iv.length); } catch (e) { B.timer = false; }
      B.activeQ = null;
    }
    B.cur += now() - mS;
    // The shader script's id for the game frame drawn in this frame (its GPU samples carry the same id).
    if (B.rec && B.armed && B.scriptTimer) {
      try { const p = window.Twitterentary.perf; if (typeof p.frame === 'number') B.fid[B.iv.length] = p.frame; } catch (e) {}
    }
    // The script's render scale and shadow-refresh count after this frame's callbacks (tail analysis, see tailStats).
    if (B.rec && B.armed && B.tailOk) {
      try { const T = window.Twitterentary, i = B.iv.length; B.fsc[i] = T.perf.scale; B.frf[i] = T.stats.refreshes; } catch (e) {}
    }
  }
  function run(cb, t) {
    if (t !== B.lastT) newFrame(t);
    const s = now();
    let q = null;
    if (B.rec && B.armed && B.timer && !B.conflict && !B.activeQ) {
      try {
        q = B.pool.pop() || B.gl.createQuery();
        nBegin.call(B.gl, TIME_ELAPSED, q);
        B.activeQ = q;
        const f = B.iv.length;
        while (B.qn.length <= f) B.qn.push(0);
        B.qn[f]++;
      } catch (e) { q = null; B.timer = false; }
    }
    try { return cb(B.off ? t + B.off : t); } finally {
      mS = s; mQ = q;
      queueMicrotask(endCallback);
    }
  }
  const raf = window.requestAnimationFrame, wraps = new WeakMap();
  window.requestAnimationFrame = function (cb) {
    if (typeof cb !== 'function') return raf.call(window, cb);
    let w = wraps.get(cb);
    if (!w) { w = t => run(cb, t); wraps.set(cb, w); }
    return raf.call(window, w);
  };
  // A shader script that times the GPU itself (Twitterentary.perf.timer) keeps its query; we sample its mean instead.
  let iv = 0;
  const T = () => window.Twitterentary;
  B.start = () => {
    if (!B.ext && B.gl) { try { B.ext = B.gl.getExtension('EXT_disjoint_timer_query_webgl2'); } catch (e) {} }
    const perf = T() && T().perf;
    B.scriptTimer = !!(perf && perf.timer === true);
    B.timer = !!(B.gl && B.ext) && !B.scriptTimer;
    if (B.timer) { try { B.gl.getParameter(B.ext.GPU_DISJOINT_EXT); } catch (e) {} } // clear a stale disjoint flag
    B.iv = []; B.ivw = []; B.lastW = 0; B.js = []; B.qn = []; B.gs = []; B.gc = []; B.disjoint = 0; B.pg = []; B.pc = []; B.ps = [];
    // Per-frame GPU samples of the script (perf.gpuRing/gpuRingFrame/gpuFrame), joined to our frames by frame id.
    B.fid = []; B.ring = new Map();
    B.fsc = []; B.frf = [];
    B.tailOk = !!(perf && typeof perf.scale === 'number' && T().stats && typeof T().stats.refreshes === 'number');
    B.ringOk = !!(B.scriptTimer && perf.gpuRing && perf.gpuRingFrame && typeof perf.gpuFrame === 'number' && typeof perf.frame === 'number');
    B.ringSeen = B.ringOk ? perf.gpuFrame : 0; B.ringBound = B.ringSeen;
    clearInterval(iv);
    iv = setInterval(() => {
      try {
        const p = T() && T().perf;
        if (p && typeof p.gpuMs === 'number') B.pg.push(p.gpuMs);
        if (p && typeof p.cpuMs === 'number') B.pc.push(p.cpuMs);
        if (p && typeof p.scale === 'number') B.ps.push(p.scale);
        // Copy samples one tick late: the script NaNs the samples of a disjoint period at its own 4 Hz tick.
        if (B.ringOk && p) { readRing(p, B.ringBound); B.ringBound = p.gpuFrame; }
      } catch (e) {}
    }, 250);
    B.resizes = 0;
    try {
      const cv = document.getElementById('gl');
      if (cv && !B.mo) { B.mo = new MutationObserver(l => { if (B.rec) B.resizes += l.length; }); B.mo.observe(cv, { attributes: true, attributeFilter: ['width', 'height'] }); }
    } catch (e) {}
    B.armed = false; B.rec = true;
  };
  function readRing(p, upTo) {
    const from = Math.max(B.ringSeen, upTo - 256);
    for (let k = from; k < upTo; k++) {
      const v = p.gpuRing[k & 255];
      if (Number.isFinite(v)) B.ring.set(p.gpuRingFrame[k & 255], v);
    }
    if (upTo > B.ringSeen) B.ringSeen = upTo;
  }
  B.stop = () => { B.rec = false; B.t1 = now(); clearInterval(iv); };
  B.result = () => {
    const n = B.iv.length;
    const gpu = [];
    if (B.ringOk) {
      try { const p = T().perf; readRing(p, p.gpuFrame); } catch (e) {}
      for (let i = 0; i < n; i++) { const v = B.fid[i] === undefined ? undefined : B.ring.get(B.fid[i]); gpu.push(v === undefined ? null : v); }
    } else {
      for (let i = 0; i < n; i++) gpu.push(B.qn[i] && B.gc[i] === B.qn[i] ? B.gs[i] : null);
    }
    return { iv: B.iv, ivw: B.ivw, js: B.js, gpu, fsc: B.tailOk ? Array.from({ length: n }, (_, i) => (B.fsc[i] === undefined ? null : B.fsc[i])) : null, frf: B.tailOk ? Array.from({ length: n }, (_, i) => (B.frf[i] === undefined ? null : B.frf[i])) : null, timer: B.timer, scriptTimer: B.scriptTimer, ring: B.ringOk, perfGpu: B.pg, perfCpu: B.pc, perfScale: B.ps, conflict: B.conflict, disjoint: B.disjoint, resizes: B.resizes, lost: B.lost, wallMs: B.t1 - B.t0, pending: B.pendQ.length };
  };
}

// ---- statistics ------------------------------------------------------------------

const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function quantile(sorted, q) {
  if (!sorted.length) return null;
  const i = (sorted.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
// Team acceptance metric. A "CPU spike" frame is one whose rAF callbacks took >= 12 ms (the game's own 20-80 ms JS
// bursts); p95gb is the p95 frame interval over the other frames. When the GPU is the bottleneck the callback blocks
// in GL calls (backpressure), so a slow GPU frame also has a long callback; where the bench timed that frame's GPU
// work, a long callback that is mostly GPU time (callback - GPU < 6 ms) is NOT a spike. Without per-frame GPU times
// (a script timing the GPU itself) the plain 12 ms rule applies.
// p95gb2 also drops the interval right after each spike frame. iv[i] runs from frame i's rAF timestamp to frame i+1's
// and js[i] is frame i's callback time, so a spike in frame i fills iv[i] (excluded by p95gb); but rAF timestamps lag
// one frame, so the stall shows up again in iv[i+1]. Those after-spike intervals were 50-62% of the p95gb tail (SH5,
// vanilla alike), and under real 60 Hz vsync that tail is absent. So "holds 60" (uncapped) = median <= 14 ms and
// p95gb2 <= 16.7 ms; p95gb stays in the reports so old ones remain comparable.
// Vsync (--vsync, frames paced by the display): a miss is an interval > 20 ms (a frame shown late, 16.7 ms + slack);
// "holds 60 (vsync)" = median 16.7 +- 0.5 ms and miss% (over all frames) <= 1%. Hitches are intervals > 50 ms.
const SPIKE_MS = 12, SPIKE_GPU_SLACK = 6;
function stats(r) {
  const iv = r.iv, sorted = [...iv].sort((a, b) => a - b);
  const ms = mean(iv);
  const worst = sorted.slice(Math.floor(sorted.length * 0.99));
  const gpu = r.gpu.filter(g => g !== null);
  const spike = r.js.map((j, i) => j >= SPIKE_MS && (r.gpu[i] === null || r.gpu[i] === undefined || j - r.gpu[i] >= SPIKE_GPU_SLACK));
  const afterSpike = spike.map((_, i) => i > 0 && spike[i - 1] && !spike[i]);
  const keep2 = i => !spike[i] && !afterSpike[i];
  const gb = iv.filter((_, i) => !spike[i]).sort((a, b) => a - b);
  const gb2 = iv.filter((_, i) => keep2(i)).sort((a, b) => a - b);
  const med = quantile(sorted, 0.5), p95gb = quantile(gb, 0.95), p95gb2 = quantile(gb2, 0.95);
  const perFrameGpu = gpu.length >= iv.length * 0.5;
  // Intervals come from rAF timestamps (the frame times Chrome and the game use). Under GPU backpressure they pair up
  // (e.g. 4.6 + 17.9 ms); main-thread wall-clock intervals between first callbacks are kept for comparison.
  const ivw = r.ivw || [];
  const sw = [...ivw].sort((a, b) => a - b), gbw = ivw.filter((_, i) => !spike[i]).sort((a, b) => a - b);
  const gbw2 = ivw.filter((_, i) => keep2(i)).sort((a, b) => a - b);
  const pct = (k, n) => (n ? (100 * k) / n : null);
  const gbN = iv.length - spike.filter(Boolean).length;
  return {
    medWall: quantile(sw, 0.5), p95gbWall: quantile(gbw, 0.95), p95gb2Wall: quantile(gbw2, 0.95),
    frames: iv.length,
    fps: ms ? 1000 / ms : null,
    ms, med, p95: quantile(sorted, 0.95), p99: quantile(sorted, 0.99), max: sorted.at(-1) ?? null,
    p95gb, p95gb2, afterSpike: afterSpike.filter(Boolean).length,
    cpuSpikes: iv.length ? spike.filter(Boolean).length / iv.length : null, spikes: spike.filter(Boolean).length,
    spikeRule: perFrameGpu ? `callback>=${SPIKE_MS}ms and callback-GPU>=${SPIKE_GPU_SLACK}ms` : `callback>=${SPIKE_MS}ms`,
    holds60: holds60Of(med, p95gb2),
    holds60gb: med !== null && p95gb !== null ? med <= HOLD_MED && p95gb <= HOLD_P95 : null, // the old rule, on p95gb
    // Vsync metrics (computed for every run; the verdict means something only under --vsync).
    missPct: pct(iv.filter(x => x > MISS_MS).length, iv.length),
    holds60Vsync: holds60VsyncOf(med, pct(iv.filter(x => x > MISS_MS).length, iv.length)),
    missPctGb: pct(iv.filter((x, i) => !spike[i] && x > MISS_MS).length, gbN),
    hitches50: iv.filter(x => x > HITCH_MS).length,
    slowPctGb: pct(gb.filter(x => x > HOLD_P95).length, gb.length), slowPctGb2: pct(gb2.filter(x => x > HOLD_P95).length, gb2.length),
    low1: worst.length ? 1000 / mean(worst) : null,
    cpuMs: mean(r.js),
    gpuMs: gpu.length >= Math.max(10, iv.length * 0.5) ? mean(gpu) : null,
    gpuP95: gpu.length >= Math.max(10, iv.length * 0.5) ? quantile([...gpu].sort((a, b) => a - b), 0.95) : null,
    gpuFrames: gpu.length,
    spike,
  };
}

/**
 * The p95gb tail: which non-spike frames are slow (interval > 16.7 ms), and do they line up with the shader script's
 * render-scale changes or shadow redraws? A frame counts as "with" an event when the event happened in that frame or
 * the one before (its cost lands in the next interval under GPU backpressure). Compare withRefreshPct with
 * refreshFramePct (the share of all frames near a redraw): much higher means redraws cause the tail.
 */
function tailStats(raw, spike) {
  const iv = raw.iv, n = iv.length, sc = raw.fsc, rf = raw.frf;
  if (!sc || !rf || !n) return null;
  const ref = new Array(n).fill(false), chg = new Array(n).fill(false);
  let drops = 0, raises = 0;
  for (let i = 1; i < n; i++) {
    if (rf[i] !== null && rf[i - 1] !== null && rf[i] > rf[i - 1]) ref[i] = true;
    if (sc[i] !== null && sc[i - 1] !== null && sc[i] !== sc[i - 1]) { chg[i] = true; if (sc[i] < sc[i - 1]) drops++; else raises++; }
  }
  const near = (a, i) => a[i] || (i > 0 && a[i - 1]);
  let gb = 0, slow = 0, slowRef = 0, slowChg = 0, allRef = 0, allChg = 0, slowMs = 0;
  const slowScale = new Map();
  for (let i = 0; i < n; i++) {
    if (near(ref, i)) allRef++;
    if (near(chg, i)) allChg++;
    if (spike[i]) continue;
    gb++;
    if (iv[i] <= 16.7) continue;
    slow++; slowMs += iv[i];
    if (near(ref, i)) slowRef++;
    if (near(chg, i)) slowChg++;
    const k = sc[i] === null ? 'null' : String(sc[i]);
    slowScale.set(k, (slowScale.get(k) || 0) + 1);
  }
  const pct = (a, b) => (b ? round((100 * a) / b, 1) : null);
  const scaleFrames = new Map();
  for (let i = 0; i < n; i++) { if (spike[i]) continue; const k = sc[i] === null ? 'null' : String(sc[i]); scaleFrames.set(k, (scaleFrames.get(k) || 0) + 1); }
  return {
    gbFrames: gb, slow, slowPct: pct(slow, gb), slowMeanMs: slow ? round(slowMs / slow, 2) : null,
    withRefreshPct: pct(slowRef, slow), refreshFramePct: pct(allRef, n),
    withScaleChangePct: pct(slowChg, slow), scaleChangeFramePct: pct(allChg, n),
    drops, raises,
    // per render scale: slow non-spike frames / all non-spike frames at that scale
    byScale: Object.fromEntries([...scaleFrames.entries()].sort().map(([k, v]) => [k, { frames: v, slowPct: pct(slowScale.get(k) || 0, v) }])),
  };
}

// ---- machine load (another SwiftShader browser or a heavy node tool skews timings) ------------------------------

function cpuTimes() {
  return cpus().reduce((a, c) => { const t = c.times; a.busy += t.user + t.nice + t.sys + t.irq; a.all += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { busy: 0, all: 0 });
}
const busyPct = (a, b) => (b.all > a.all ? Math.round((100 * (b.busy - a.busy)) / (b.all - a.all)) : null);

/** Other processes that eat CPU/GPU: SwiftShader Chromes and other repo tools (smoke/probe/snapshot). Windows only. */
function heavyProcesses() {
  if (platform() !== 'win32') return Promise.resolve([]);
  // Browser processes only (no --type= children); node processes running one of the repo's browser tools.
  const ps = "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and (($_.Name -eq 'chrome.exe' -and $_.CommandLine -match 'use-angle=swiftshader' -and $_.CommandLine -notmatch '--type=') -or ($_.Name -eq 'node.exe' -and $_.CommandLine -match 'tools[\\\\/](smoke|probe|snapshot|bench)\\.mjs')) } | ForEach-Object { '' + $_.ProcessId + '|' + $_.Name + '|' + (($_.CommandLine -replace '\\s+', ' ') -replace '^.*?(tools[\\\\/]\\S+\\.mjs.*)$', '$1') }";
  return new Promise(res => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 20000, windowsHide: true }, (err, out) => {
      if (err) return res([]);
      res(out.split(/\r?\n/).map(s => s.trim()).filter(Boolean).map(s => s.split('|')).filter(([pid]) => Number(pid) !== process.pid)
        .map(([pid, name, cmd]) => (name === 'chrome.exe' ? `SwiftShader Chrome (pid ${pid})` : `node ${(cmd || '').slice(0, 80)} (pid ${pid})`)));
    });
  });
}

// ---- main ---------------------------------------------------------------------------

const warnings = [];
const warn = msg => { warnings.push(msg); console.log(`${WARN} ${msg}`); annotate('warning', msg); };
if (opts.from) {
  // Offline: reprint a saved report, optionally against a baseline. Uses no browser and no GPU lock.
  let saved;
  try { saved = JSON.parse(await readFile(resolve(opts.from), 'utf8')); } catch (e) { fail(`--from ${opts.from}: ${e.message.split(/\r?\n/)[0]}`); }
  console.log(c.bold(`${saved.env?.label || opts.from}: ${(saved.env?.scripts || []).map(s => `${s.name || s.file} ${s.version}`).join(', ') || 'vanilla'}, ${settingsText(settingsOf(null, saved.env))}`));
  printTable(saved.rows || []);
  printTail(saved.rows || []);
  printVsync(saved.rows || []);
  if (opts.compare) {
    let b;
    try { b = JSON.parse(await readFile(resolve(opts.compare), 'utf8')); } catch (e) { fail(`--compare ${opts.compare}: ${e.message.split(/\r?\n/)[0]}`); }
    printCompare(saved.rows || [], b, saved.env);
  }
  process.exit(0);
}
const scripts = scenarios.every(s => s.vanilla) ? [] : await loadScripts();
const pageOrigin = new URL(url).origin;
const wrapped = scripts.map(s => ({ file: s.file, source: wrapUserscript(s, { pageOrigin }) }));
const snap = await latestSnapshot(opts.target);
const vanillaPrograms = snap ? JSON.parse(await readFile(join(snap, 'manifest.json'), 'utf8')).shaders?.length || 0 : 0;
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const label = (opts.label || stamp).replace(/[^\w.-]+/g, '_');
const outPath = opts.out ? resolve(opts.out) : join(REPORTS_DIR, `bench-${label}.json`);

console.log(`Bench ${c.bold(url)} on the real GPU (ANGLE ${opts.angle}${opts['headless-gpu'] ? ', headless' : ''}${VSYNC ? ', VSYNC on (60 Hz pacing)' : ', uncapped'}), ${SECONDS}s + ${WARMUP}s warm-up per scenario`);
console.log(`  game settings: ${c.bold(settingsText(SETTINGS))}${SETTINGS.heldLight ? '' : ' (held light: game default)'}, ${FULLSCREEN ? 'fullscreen' : `${VIEW.width}x${VIEW.height} window`} at DPR 1${scenarios.some(sc => settingsText(sc.settings) !== settingsText(SETTINGS)) ? '; some rows override them (@...)' : ''}`);
console.log(c.dim(`  scripts: ${scripts.length ? scripts.map(s => `${s.file} ${s.meta.get('version')}`).join(', ') : 'none'}${opts.ref ? ` from ${opts.ref}` : ''}`));
let heavyBefore = [];
const RUN_T0 = Date.now();
let preflightFailed = false;
let browser, failures = 0;
const rows = [];
const env = {
  gpu: null, angle: opts.angle, w: null, h: null, dpr: null, timer: null, chrome: null,
  scripts: scripts.map(s => ({ file: s.file, name: s.meta.get('name'), version: s.meta.get('version'), ref: s.ref })),
  url, label, at: new Date().toISOString(), seconds: SECONDS, warmup: WARMUP, headless: opts['headless-gpu'],
  chromeArgs: opts['chrome-arg'] || [], os: `${platform()} ${osRelease()}`, cpu: cpus()[0]?.model, cores: cpus().length,
  uncappedFps: null, extensions: null, warnings, vsync: VSYNC, refreshHz: null,
  repeat: REPEAT, guardPct: GUARDED ? GUARD : 0, cooldown: COOLDOWN, passes: [],
  rd: SETTINGS.rd, fov: SETTINGS.fov, heldLight: SETTINGS.heldLight, fullscreen: FULLSCREEN, view: null,
  // devloop additions (absent in older reports): the protocol and where its values came from, --warp/--settle,
  // early stop, the preflight, and how many passes actually ran.
  protocol: PROTOCOL ? { name: PROTOCOL, profile: PROFILE ? relative(ROOT, PROFILE_PATH).replace(/\\/g, '/') : null, from: PROTO.from, why: PROTO.why } : null,
  warp: WARP, settle: WARP > 1 ? SETTLE : null, earlyStop: EARLY_STOP ? { enabled: true, stoppedAfter: null, checks: [] } : null,
  skipVanilla: SKIP_VANILLA || undefined, preflight: null, passesRun: null, vsyncPass: null,
};
if (PROFILE_ERR) warn(`machine profile ${relative(ROOT, PROFILE_PATH)}: ${PROFILE_ERR} (using built-in defaults)`);
if (PROTOCOL) {
  console.log(c.dim(`  protocol ${PROTOCOL}: ${SECONDS}s x ${REPEAT} pass(es), cooldown ${COOLDOWN}s, warp ${WARP > 1 ? `${WARP}x, settle ${SETTLE}s` : 'off'}${EARLY_STOP ? ', early stop' : ''}${VSYNC_PASS ? ', then a vsync pass' : ''} (${PROFILE ? 'machine-profile.json' : 'built-in defaults: tools/lib/machine-profile.json not found'})`));
}
// The preflight's system checks run before the launch (which may wait for the GPU lock).
if (PREFLIGHT) {
  const sys = await systemChecks({ cpuMaxPct: PF_LIMITS.bgCpuPct, w: VIEW.width, h: VIEW.height });
  env.preflight = { checks: sys.checks, calibration: null, verdict: 'ok' };
  console.log(c.dim(`  preflight: ${Object.entries(sys.checks).map(([k, v]) => `${k} ${v.ok === false ? c.yellow(v.text) : v.text}`).join(' | ')}`));
  for (const b of sys.bad) warn(`preflight ${b}`);
  if (sys.bad.length) env.preflight.verdict = 'warn';
  if (STRICT && sys.checks.power?.ok === false) fail('--strict: on battery power, the numbers would not be comparable');
}
try {
  browser = await launchBrowser({ gpu: true, angle: opts.angle, headless: opts['headless-gpu'], vsync: VSYNC, args: opts['chrome-arg'] || [], owner: `bench ${label}` });
  env.chrome = browser.version();
  if (opts.prewarm !== undefined) await prewarmWindows(browser, Number(opts.prewarm));
  // Once we hold the lock, lock-aware tools wait; a SwiftShader browser still running predates the lock (or ignores it).
  heavyBefore = await heavyProcesses();
  const swBefore = heavyBefore.filter(p => p.startsWith('SwiftShader'));
  if (swBefore.length) warn(`SwiftShader browser(s) running outside the GPU lock (timings may be skewed): ${swBefore.join(', ')}`);
  const toolsBefore = heavyBefore.filter(p => !p.startsWith('SwiftShader'));
  if (toolsBefore.length) console.log(c.dim(`  other repo tools running (waiting for the GPU lock): ${toolsBefore.join(', ')}`));
  env.uncappedFps = await uncapCheck(browser);
  // Under --vsync the blank page runs at the display's refresh rate instead (env.refreshHz).
  if (VSYNC) {
    env.refreshHz = env.uncappedFps;
    if (env.refreshHz !== null && env.refreshHz > 75) warn(`--vsync: a blank WebGL page ran at ${env.refreshHz.toFixed(0)} FPS, so vsync is not pacing frames (or the display is not 60 Hz): the vsync verdict assumes 60 Hz`);
    else if (env.refreshHz !== null && Math.abs(env.refreshHz - 60) > 3) warn(`--vsync: the display seems to run at ${env.refreshHz.toFixed(1)} Hz, not 60: the vsync verdict (median 16.7 +- 0.5 ms) assumes 60 Hz`);
  } else if (env.uncappedFps !== null && env.uncappedFps < 90) warn(`a blank WebGL page only reached ${env.uncappedFps.toFixed(0)} FPS: the frame cap / vsync is probably still on, so FPS above 60 can't be measured`);

  // --repeat N runs the whole list N times, every other pass in reverse order, so slow drift (heat, background
  // load) hits every scenario alike; each row is then the median of its passes, with the spread between them.
  if (guardAdded) console.log(c.dim(`  vanilla added to every pass as the noise/thermal reference (--guard 0 to skip it)`));
  // One row, with one retry on a GPU-process hiccup (no WebGL2, lost context, crashed tab) in a fresh context.
  const runRow = async (sc, tag) => {
    process.stdout.write(`  ${tag.padEnd(28)} `);
    let row = await runScenario(browser, sc).catch(e => ({ name: sc.name, error: e.message.split('\n')[0] }));
    if (row.error && /did not boot|context lost|context was destroyed|navigat|crash|Target .*closed/i.test(row.error)) {
      process.stdout.write(c.yellow(`retrying (${row.error.slice(0, 60)}) `));
      const first = row.error;
      row = await runScenario(browser, sc).catch(e => ({ name: sc.name, error: e.message.split('\n')[0] }));
      row.note = [row.note, `retried after: ${first.slice(0, 100)}`].filter(Boolean).join('; ');
    }
    if (row.error) console.log(`${FAIL} ${row.error}`);
    else if (row.na) console.log(c.yellow(`n/a  ${row.na}`));
    else console.log(`${fmt(row.fps, 1).padStart(6)} FPS  med ${fmt(row.med, 2)}  p95gb ${fmt(row.p95gb, 2)}  p95gb2 ${fmt(row.p95gb2, 2)}${VSYNC ? `  miss ${fmt(row.missPct, 2)}%` : ''}  JS ${fmt(row.cpuMs, 2)}  GPU ${fmt(row.gpuMs, 2)}  ${c.dim(`${fmt(row.totalS, 0)}s`)}${row.note ? c.dim('  ' + row.note) : ''}`);
    return row;
  };

  // Preflight calibration: vanilla against the profile (see the header). Pass 1's own vanilla row when it runs first.
  let calibrated = null;
  if (PREFLIGHT) calibrated = await preflightCalibration(runRow);

  const passes = [];
  let only = null; // adaptive early stop: after pass 1, only the rows whose verdict is not settled (plus vanilla)
  for (let p = 0; p < REPEAT; p++) {
    if (COOLDOWN > 0 && !(p === 0 && calibrated)) {
      console.log(c.dim(`  cooling down ${COOLDOWN}s before pass ${p + 1}/${REPEAT} (holding the GPU lock) ...`));
      await new Promise(res => setTimeout(res, COOLDOWN * 1000));
    }
    const order = p % 2 ? [...scenarios].reverse() : scenarios;
    const got = new Map();
    for (const sc of order) {
      if (p > 0 && passes[0].get(sc.name)?.na) { got.set(sc.name, passes[0].get(sc.name)); continue; }
      if (p === 0 && calibrated && sc.name === 'vanilla') { got.set(sc.name, calibrated); continue; }
      if (only && !only.has(sc.name) && !(sc.name === 'vanilla' && GUARDED)) continue;
      got.set(sc.name, await runRow(sc, REPEAT > 1 ? `${sc.name} (${p + 1}/${REPEAT})` : sc.name));
    }
    passes.push(got);
    if (EARLY_STOP && p + 1 < REPEAT) {
      const es = earlyStopCheck(passes);
      env.earlyStop.checks.push({ afterPass: p + 1, stop: es.stop, why: es.why });
      if (es.stop) {
        env.earlyStop.stoppedAfter = p + 1;
        console.log(c.green(`  early stop after pass ${p + 1}/${REPEAT}: ${es.why}`));
        break;
      }
      if (es.settled && es.settled.length) {
        only = new Set(scenarios.map(x => x.name).filter(k => k !== 'vanilla' && !es.settled.includes(k)));
        env.earlyStop.settledAfterPass1 = es.settled;
        console.log(c.dim(`  pass ${p + 1}/${REPEAT}: verdict settled for ${es.settled.join(', ')}; the next passes run only ${[...only].join(', ')}${GUARDED ? ' (and vanilla)' : ''}: ${es.why}`));
      } else console.log(c.dim(`  pass ${p + 1}/${REPEAT} not conclusive, going on: ${es.why}`));
    }
  }
  env.passesRun = passes.length;
  if (GUARDED && passes.length > 1) {
    env.passes = noiseGuard(passes);
    for (const ps of env.passes) {
      if (ps.unreliable) warn(`pass ${ps.pass}/${passes.length} looks unreliable (background load or throttling?): ${ps.unreliable}. Its rows are marked; the medians still include it. Re-run when the machine is idle.`);
      else if (ps.vanillaMed === null && !SKIP_VANILLA) warn(`pass ${ps.pass}/${passes.length}: no vanilla result, so the noise guard can't judge it`);
    }
  }
  // Every vanilla row at the standard against the profile's limits too (also with one pass): sysCpuPct > 55 or a
  // median above the clean range means background load during that row.
  if (!VSYNC && !offStandard(PROFILE, { rd: SETTINGS.rd, fov: SETTINGS.fov, w: VIEW.width, h: VIEW.height, vsync: VSYNC, angle: opts.angle, headless: opts['headless-gpu'] })) {
    passes.forEach((m, i) => {
      const v = m.get('vanilla');
      if (!v || v.error || v.na || v === calibrated) return;
      const bad = vanillaLimits(v).warn;
      if (bad.length) warn(`pass ${i + 1}: vanilla is outside the machine profile's clean range (${bad.join(', ')}): background load? Check the rows of that pass.`);
    });
  }
  for (const sc of scenarios) {
    const settled = env.earlyStop?.settledAfterPass1?.includes(sc.name);
    // Rows the adaptive early stop left out of later passes have no entry there: combine only the passes they ran.
    const list = passes.map(m => m.get(sc.name));
    const row = combine(only ? list.filter(Boolean) : list);
    if (settled && !row.error && !row.na) row.note = [row.note, `1 pass: verdict settled after pass 1 (adaptive early stop)`].filter(Boolean).join('; ');
    rows.push(row);
    if (row.error) { failures++; annotate('error', `bench ${sc.name}: ${row.error}`); }
  }
  // Checked while we still hold the GPU lock: a tool that was waiting for it starts the moment we close.
  const overlap = (await heavyProcesses()).filter(p => p.startsWith('SwiftShader') && !heavyBefore.includes(p));
  if (overlap.length) warn(`a SwiftShader browser started during the run (timings may be skewed): ${overlap.join(', ')}`);
} catch (e) {
  failures++;
  if (e.preflight) preflightFailed = true;
  console.log(`${FAIL} ${e.message.split('\n')[0]}`);
  annotate('error', `bench: ${e.message.split('\n')[0]}`);
} finally {
  if (browser) await browser.close().catch(() => {});
}

// ---- report -----------------------------------------------------------------------------

const viewRow = rows.find(r => r.view && settingsText(r.settings) === settingsText(SETTINGS));
if (viewRow) env.view = { row: viewRow.name, ...viewRow.view };
const vanillaRow = rows.find(r => r.name === 'vanilla' && r.fps);
if (!VSYNC && vanillaRow && vanillaRow.fps <= 61) warn(`vanilla ran at ${vanillaRow.fps.toFixed(1)} FPS, not above 60: uncapping may not work (or the game itself is GPU/CPU-bound here)`);
env.wallS = round((Date.now() - RUN_T0) / 1000, 0);
const report = { env, rows };
await mkdir(REPORTS_DIR, { recursive: true });
await writeFile(outPath, JSON.stringify(report, null, 2));

console.log('');
console.log(c.dim(`GPU: ${env.gpu || '?'} | Chrome ${env.chrome || '?'} | canvas ${env.w}x${env.h} @ DPR ${env.dpr}${FULLSCREEN ? ' fullscreen' : ''} | GPU timer ${env.timer === null ? '?' : env.timer ? 'yes' : 'no'} | blank page ${env.uncappedFps ? env.uncappedFps.toFixed(0) : '?'} FPS${VSYNC ? ' | VSYNC on' : ' | uncapped'}`));
console.log(c.dim(`Settings: ${settingsText(SETTINGS)}${SETTINGS.heldLight ? '' : ' (held light: game default)'}${env.view ? ` | drawn (${env.view.row}): fog ${fmt(env.view.fogStart, 1)}-${fmt(env.view.fogEnd, 1)}, FOV ${fmt(env.view.fov, 1)}, far ${fmt(env.view.far, 0)}, ${fmt(env.view.drawsPerFrame, 0)} draws/frame, ${env.view.vaos} VAOs, uHeldN ${env.view.heldN}` : ''}`));
const guardLine = env.passes.length
  ? `Noise guard (vanilla per pass, unreliable above +${GUARD}% vs the best pass): ${env.passes.map(ps => `pass ${ps.pass} ${ps.vanillaMed === null ? 'no vanilla' : `med ${fmt(ps.vanillaMed, 2)}${ps.medPct ? ` (+${fmt(ps.medPct, 0)}%)` : ''} p95gb ${fmt(ps.vanillaP95gb, 2)}${ps.p95gbPct ? ` (+${fmt(ps.p95gbPct, 0)}%)` : ''}`}${ps.unreliable ? ' UNRELIABLE' : ''}`).join(' | ')}`
  : '';
if (guardLine) console.log(env.passes.some(ps => ps.unreliable) ? c.yellow(guardLine) : c.dim(guardLine));
printTable(rows);
printTail(rows);
printVsync(rows);
let base = null;
if (opts.compare) {
  try { base = JSON.parse(await readFile(resolve(opts.compare), 'utf8')); } catch (e) { warn(`--compare ${opts.compare}: ${e.message.split('\n')[0]}`); }
  if (base) printCompare(rows, base);
}
console.log(c.dim(`\nWall time ${fmtDur(env.wallS)}: ${env.passesRun ?? 0} pass(es) of ${scenarios.length} row(s)${env.earlyStop?.stoppedAfter ? ` (early stop after pass ${env.earlyStop.stoppedAfter} of ${REPEAT})` : ''}${WARP > 1 ? `, warp ${WARP}x / settle ${SETTLE}s` : ''}${env.preflight ? `, preflight ${env.preflight.verdict}` : ''}`));
console.log(c.dim(`Report: ${relative(ROOT, outPath).replace(/\\/g, '/') || outPath}`));
console.log(failures ? c.red(`${failures} scenario(s) failed.`) : c.green(`Bench finished${warnings.length ? ` with ${warnings.length} warning(s)` : ''}.`));
await summary([
  `### Bench ${label} (${env.gpu || '?'}, ANGLE ${env.angle})`,
  ...(guardLine ? [`${env.passes.some(ps => ps.unreliable) ? '**Warning:** ' : ''}${guardLine}`, ''] : []),
  `| Scenario | FPS | ms | median | p95 | p95gb | p95gb2 | miss% | ${VSYNC ? 'holds 60 (vsync)' : 'holds 60'} | 1% low | JS ms | GPU ms | note |`, '|---|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map(r => `| ${r.name} | ${r.na ? 'n/a' : r.error ? '❌' : fmt(r.fps, 1)} | ${fmt(r.ms, 2)} | ${fmt(r.med, 2)} | ${fmt(r.p95, 2)} | ${fmt(r.p95gb, 2)} | ${fmt(r.p95gb2, 2)} | ${fmt(r.missPct, 2)} | ${r.na || r.error ? '' : holdsText(r)} | ${fmt(r.low1, 1)} | ${fmt(r.cpuMs, 2)} | ${fmt(r.gpuMs, 2)} | ${(r.na || r.error || r.note || '').replace(/\|/g, '\\|')} |`),
].join('\n'));

// accept: the --vsync pass, as a child bench with the same scenarios and scripts (its own browser, launched
// after ours closed, so it takes the GPU lock next). Its report is bench-<label>-vsync.json.
let vsyncFailed = false;
if (VSYNC_PASS && !preflightFailed) {
  const vsSeconds = opts['vsync-seconds'] !== undefined ? Number(opts['vsync-seconds']) : PROTO?.vsync_seconds ?? 30;
  const vsRepeat = opts['vsync-repeat'] !== undefined ? Number(opts['vsync-repeat']) : PROTO?.vsync_repeat ?? 1;
  const childArgs = [fileURLToPath(import.meta.url), ...(opts.cooldown === undefined ? ['--cooldown', '0'] : []), ...childArgv(argv),
    '--vsync', '--no-vsync-pass', '--no-preflight', '--seconds', String(vsSeconds), '--repeat', String(vsRepeat), '--label', `${label}-vsync`];
  const vsOut = join(REPORTS_DIR, `bench-${label}-vsync.json`);
  console.log(c.bold(`\nVsync pass (${vsSeconds}s x ${vsRepeat}): node ${childArgs.map(a => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ').replace(fileURLToPath(import.meta.url), 'tools/bench.mjs')}`));
  const code = await new Promise(res => {
    const ch = spawn(process.execPath, childArgs, { stdio: 'inherit' });
    ch.on('exit', c2 => res(c2 ?? 1));
    ch.on('error', () => res(1));
  });
  vsyncFailed = code !== 0;
  env.vsyncPass = { report: relative(ROOT, vsOut).replace(/\\/g, '/'), seconds: vsSeconds, repeat: vsRepeat, exit: code };
  env.wallTotalS = round((Date.now() - RUN_T0) / 1000, 0);
  await writeFile(outPath, JSON.stringify(report, null, 2));
  console.log(c.dim(`accept total wall time ${fmtDur(env.wallTotalS)} (uncapped ${fmtDur(env.wallS)} + vsync ${fmtDur(env.wallTotalS - env.wallS)})`));
} else if (VSYNC_PASS) console.log(c.yellow(`Vsync pass skipped (the preflight failed).`));
process.exit(failures || vsyncFailed ? 1 : 0);

/** The parent's arguments for the vsync child, minus what the child sets itself (label, out, compare, sizes). */
function childArgv(args) {
  const drop = new Set(['--label', '--out', '--compare', '--seconds', '--repeat', '--vsync-seconds', '--vsync-repeat', '--prewarm']);
  const dropFlag = new Set(['--vsync-pass', '--no-vsync-pass', '--preflight', '--no-preflight', '--strict']);
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i], k = a.split('=')[0];
    if (drop.has(k)) { if (!a.includes('=')) i++; continue; }
    if (dropFlag.has(k)) continue;
    out.push(a);
  }
  return out;
}
function fmtDur(s) { return typeof s === 'number' ? (s >= 90 ? `${Math.floor(s / 60)}m${String(Math.round(s % 60)).padStart(2, '0')}s` : `${Math.round(s)}s`) : '?'; }

// ---------------------------------------------------------------------------------------------

/**
 * --prewarm N. Windows puts a new top-level window on the active virtual desktop, and refuses to move another process's
 * window (MoveWindowToDesktop: 0x80070005), so a bench started on another desktop would open every later row on the
 * desktop the user went back to. So all the windows are opened now, and each newContext() takes one. A retry past the
 * end of the pool falls back to a real new window, with a WARN, because that one lands on the user's desktop.
 */
async function prewarmWindows(browser, n) {
  if (!(Number.isInteger(n) && n >= 1 && n <= 64)) fail('--prewarm must be a whole number from 1 to 64');
  const ctxOpts = FULLSCREEN ? { viewport: null } : { viewport: VIEW, deviceScaleFactor: 1 };
  const real = browser.newContext.bind(browser), pool = [];
  for (let i = 0; i < n; i++) {
    const ctx = await real(ctxOpts), page = await ctx.newPage(), newPage = ctx.newPage.bind(ctx);
    ctx.newPage = async () => { ctx.newPage = newPage; return page; };
    pool.push(ctx);
  }
  browser.newContext = async o => {
    const ctx = pool.shift();
    if (ctx) return ctx;
    warn('--prewarm: the window pool is empty, so this row opens a new window on the active desktop');
    return real(o);
  };
  env.prewarm = n;
  await mkdir(REPORTS_DIR, { recursive: true });
  await writeFile(join(REPORTS_DIR, '.prewarm-done'), String(n));
  console.log(c.dim(`  prewarmed ${n} window(s)`));
}

async function uncapCheck(browser) {
  const ctx = await browser.newContext(FULLSCREEN ? { viewport: null } : { viewport: VIEW, deviceScaleFactor: 1 });
  try {
    const page = await ctx.newPage();
    if (FULLSCREEN) await setFullscreen(page);
    await page.setContent('<canvas id=c width=1920 height=1080 style="display:block;width:100vw;height:100vh"></canvas>');
    return await page.evaluate(() => new Promise(res => {
      const gl = document.getElementById('c').getContext('webgl2');
      let n = 0, t0 = 0;
      const f = t => { gl.clearColor(n & 1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); if (n === 10) t0 = t; if (++n < 250) requestAnimationFrame(f); else res(239000 / (t - t0)); };
      requestAnimationFrame(f);
    }));
  } catch { return null; } finally { await ctx.close().catch(() => {}); }
}

/** A vanilla row against the preflight limits: { warn: [text], abort: [text], range } (see PF_LIMITS, checkVanilla). */
function vanillaLimits(row) {
  const w = [], a = [];
  const L = PF_LIMITS;
  if (typeof row.med === 'number' && row.med > L.warn.med) w.push(`med ${fmt(row.med, 2)} > ${L.warn.med} ms`);
  if (typeof row.p95gb === 'number' && row.p95gb > L.warn.p95gb) w.push(`p95gb ${fmt(row.p95gb, 2)} > ${L.warn.p95gb} ms`);
  if (typeof row.sysCpuPct === 'number' && row.sysCpuPct > L.warn.sysCpuPct) w.push(`system CPU ${row.sysCpuPct}% > ${L.warn.sysCpuPct}% during the row`);
  const range = checkVanilla(row, PROFILE);
  const gHi = PROFILE?.vanilla?.gpuMs?.[1];
  if (typeof gHi === 'number' && typeof row.gpuMs === 'number' && row.gpuMs > gHi * (1 + NOISE.gpuMs_pct / 100)) w.push(`GPU ${fmt(row.gpuMs, 2)} > ${gHi} ms +${NOISE.gpuMs_pct}%`);
  if (typeof row.med === 'number' && row.med > L.abort.med) a.push(`med ${fmt(row.med, 2)} > ${L.abort.med} ms`);
  if (typeof row.p95gb === 'number' && row.p95gb > L.abort.p95gb) a.push(`p95gb ${fmt(row.p95gb, 2)} > ${L.abort.p95gb} ms`);
  return { warn: w, abort: a, range };
}

/**
 * The preflight's vanilla calibration. Runs pass 1's vanilla row when the list starts with plain "vanilla" (and
 * returns it, to be used as that row), else an extra warped vanilla row (recorded in env.preflight only; returns
 * null). Above the limits: with a protocol or --strict, cool down and recalibrate once; then WARN, or exit 1 (--strict).
 */
async function preflightCalibration(runRow) {
  const pf = env.preflight || (env.preflight = { checks: {}, calibration: null, verdict: 'ok' });
  const off = offStandard(PROFILE, { rd: SETTINGS.rd, fov: SETTINGS.fov, w: VIEW.width, h: VIEW.height, vsync: VSYNC, angle: opts.angle, headless: opts['headless-gpu'] });
  if (off) { pf.calibration = { skipped: `not at the profile's standard: ${off}` }; console.log(c.dim(`  preflight calibration skipped (${off})`)); return null; }
  if (PROFILE && gpuMatches(PROFILE, env.gpu) === false) warn(`machine profile is for "${PROFILE.machine.gpu}", this GPU is "${env.gpu}": its ranges may not apply`);
  // The launch may have waited for the GPU lock: sample the background CPU again now that we hold it.
  if (pf.checks.lock && pf.checks.lock.ok === false) {
    const load = await cpuLoad(2000);
    pf.checks.cpuAfterLock = { ok: load === null ? null : load <= PF_LIMITS.bgCpuPct, text: `${load}% busy after taking the GPU lock`, pct: load };
    if (load > PF_LIMITS.bgCpuPct) warn(`preflight: background CPU is ${load}% after taking the GPU lock: frame times will be skewed`);
  }
  const reuse = scenarios[0].name === 'vanilla';
  const sc = reuse ? scenarios[0] : { ...parseScenario('vanilla'), name: 'vanilla (calibration)', warp: Math.max(WARP, 10) };
  if (reuse && COOLDOWN > 0) {
    console.log(c.dim(`  cooling down ${COOLDOWN}s before pass 1/${REPEAT} (holding the GPU lock) ...`));
    await new Promise(res => setTimeout(res, COOLDOWN * 1000));
  }
  const attempt = async n => {
    const row = await runRow(sc, `${reuse ? (REPEAT > 1 ? `vanilla (1/${REPEAT})` : 'vanilla') : 'vanilla (calibration)'}${n ? ' retry' : ''}`);
    const lim = row.error || row.na ? null : vanillaLimits(row);
    return { row, lim };
  };
  let { row, lim } = await attempt(0);
  const record = (r, l) => ({ med: r.med ?? null, p95gb: r.p95gb ?? null, p95gb2: r.p95gb2 ?? null, gpuMs: r.gpuMs ?? null, sysCpuPct: r.sysCpuPct ?? null, totalS: r.totalS ?? null, error: r.error || r.na || null, warn: l ? l.warn : [], abort: l ? l.abort : [], range: l ? l.range.checked : null });
  pf.calibration = { reused: reuse, profile: !!PROFILE, limits: PF_LIMITS, attempts: [record(row, lim)] };
  if (lim && lim.warn.length && (PROTOCOL || STRICT)) {
    const heavy = await heavyProcesses();
    const cd = cooldownOf(PROFILE);
    console.log(c.yellow(`  calibration looks slow (${lim.warn.join(', ')})${heavy.length ? `; busy: ${heavy.join(', ')}` : ''}: idling ${cd}s and recalibrating once ...`));
    await new Promise(res => setTimeout(res, cd * 1000));
    ({ row, lim } = await attempt(1));
    pf.calibration.attempts.push(record(row, lim));
  }
  if (!lim) { warn(`preflight calibration failed: ${row.error || row.na}`); pf.verdict = 'warn'; return reuse ? row : null; }
  if (lim.warn.length) {
    pf.verdict = lim.abort.length ? 'abort' : 'warn';
    const msg = `preflight: vanilla calibration is outside the clean range (${lim.warn.join(', ')}${lim.abort.length ? `; abort level: ${lim.abort.join(', ')}` : ''}): the machine looks loaded or throttled, so this run's numbers may not compare with others`;
    if (STRICT) {
      console.log(`${FAIL} ${msg}. --strict: stopping before measuring.`);
      annotate('error', msg);
      throw Object.assign(new Error('preflight failed (--strict)'), { preflight: true });
    }
    warn(msg);
  } else {
    console.log(c.green(`  preflight calibration ok: vanilla med ${fmt(row.med, 2)}, p95gb ${fmt(row.p95gb, 2)}, GPU ${fmt(row.gpuMs, 2)} ms, system CPU ${row.sysCpuPct ?? '?'}%${PROFILE ? '' : ' (built-in limits; no machine profile)'}`));
  }
  return reuse ? row : null;
}

/**
 * --early-stop. After pass 1: stop when every measured row's verdict is clear of the holds-60 line (uncapped:
 * |p95gb2 - 16.7| >= 2 and |med - 14| >= 0.8; vsync: miss% <= 0.5 or >= 1.5), which is when single passes never
 * flipped a verdict in 74 past passes (analyst-data), and the preflight was clean. After pass 2 (of 3+): stop when
 * every row's two passes agree within the noise (median within max(0.6 ms, noise.med_pct), p95gb2 within
 * max(1 ms, noise.p95gb2_pct)), with the same verdict, and the noise guard flags neither pass.
 */
function earlyStopCheck(passes) {
  const n = passes.length;
  const names = scenarios.map(s => s.name);
  const ok = r => r && !r.error && !r.na && typeof r.med === 'number';
  const verdictClear = r => (r.vsync ? typeof r.missPct === 'number' && (r.missPct <= 0.5 || r.missPct >= 1.5) : typeof r.p95gb2 === 'number' && Math.abs(r.p95gb2 - HOLD_P95) >= 2 && Math.abs(r.med - HOLD_MED) >= 0.8);
  const verdict = r => (r.vsync ? holds60VsyncOf(r.med, r.missPct) : holds60Of(r.med, r.p95gb2));
  if (passes.some(m => names.some(k => m.get(k)?.error))) return { stop: false, why: 'a row failed' };
  if (n === 1) {
    if (env.preflight && env.preflight.verdict !== 'ok') return { stop: false, why: `preflight ${env.preflight.verdict}` };
    if (!env.preflight?.calibration?.attempts) return { stop: false, why: 'no preflight calibration to vouch for pass 1' };
    const measured = names.filter(k => k !== 'vanilla' && ok(passes[0].get(k)));
    const unclear = measured.filter(k => !verdictClear(passes[0].get(k)));
    const settled = ADAPTIVE ? measured.filter(k => verdictClear(passes[0].get(k))) : [];
    return unclear.length ? { stop: false, settled, why: `verdict near the line: ${unclear.join(', ')}` } : { stop: true, why: 'every verdict is clear of the holds-60 line' };
  }
  if (n === 2) {
    if (GUARDED) {
      const g = noiseGuard(passes.map(m => new Map([...m].map(([k, r]) => [k, r && { ...r }])))); // on copies: no tagging yet
      if (g.some(x => x.unreliable)) return { stop: false, why: 'the noise guard flags a pass' };
    }
    const bad = [];
    for (const k of names) {
      const a = passes[0].get(k), b = passes[1].get(k);
      if (!ok(a) || !ok(b)) continue;
      const medTol = Math.max(0.6, (a.med * NOISE.med_pct) / 100);
      const p2Tol = typeof a.p95gb2 === 'number' ? Math.max(1, (a.p95gb2 * NOISE.p95gb2_pct) / 100) : Infinity;
      if (Math.abs(a.med - b.med) > medTol) bad.push(`${k} med ${fmt(a.med, 2)}/${fmt(b.med, 2)}`);
      else if (typeof a.p95gb2 === 'number' && typeof b.p95gb2 === 'number' && Math.abs(a.p95gb2 - b.p95gb2) > p2Tol) bad.push(`${k} p95gb2 ${fmt(a.p95gb2, 2)}/${fmt(b.p95gb2, 2)}`);
      else if (verdict(a) !== verdict(b)) bad.push(`${k} verdict ${verdict(a)}/${verdict(b)}`);
    }
    return bad.length ? { stop: false, why: `passes disagree: ${bad.join(', ')}` } : { stop: true, why: 'both passes agree within the noise' };
  }
  return { stop: false, why: 'only checked after passes 1 and 2' };
}

async function runScenario(browser, sc) {
  const t0 = Date.now();
  const game = await openGame(browser, url, {
    userscripts: sc.vanilla ? [] : wrapped,
    initScripts: [sampler, settingsInit(sc.settings, pageOrigin)],
    // Fullscreen: no viewport emulation, the page is the real (fullscreen) window; DPR 1 comes from the launch flag.
    viewport: FULLSCREEN ? null : VIEW, deviceScaleFactor: FULLSCREEN ? undefined : 1, fullscreen: FULLSCREEN,
    timeoutMs: Number(opts.timeout), minPrograms: vanillaPrograms, settleMs: 2500,
  });
  const { context, page, pageErrors, consoleMsgs } = game;
  try {
    const fatal = await readFatal(page);
    if (fatal) return { name: sc.name, error: `the game did not boot: ${fatal}` };
    const info = await page.evaluate(() => {
      const B = window.__tcbench, cv = document.getElementById('gl');
      let gpu = null, timer = false, exts = null;
      try {
        const gl = B && B.gl;
        if (gl) {
          const dbg = gl.getExtension('WEBGL_debug_renderer_info');
          gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
          timer = !!gl.getExtension('EXT_disjoint_timer_query_webgl2');
          exts = gl.getSupportedExtensions();
        }
      } catch (e) {}
      return { gpu, timer, exts, sampler: !!B, gl: !!(B && B.gl), w: cv ? cv.width : null, h: cv ? cv.height : null, iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio, vis: document.visibilityState };
    });
    if (!info.sampler) return { name: sc.name, error: 'the frame sampler did not load in the page' };
    if (env.gpu === null && info.gpu) { env.gpu = info.gpu; env.timer = info.timer; env.w = info.w; env.h = info.h; env.dpr = info.dpr; env.extensions = info.exts; }
    if (!info.gl) warn(`${sc.name}: the game's WebGL2 context (#gl) was not captured, so GPU ms is n/a`);
    if (info.w !== VIEW.width || info.h !== VIEW.height || info.dpr !== 1) warn(`${sc.name}: the game canvas is ${info.w}x${info.h} at DPR ${info.dpr} (window ${info.iw}x${info.ih}), not ${VIEW.width}x${VIEW.height} at DPR 1`);
    if (info.vis !== 'visible') warn(`${sc.name}: the page is ${info.vis}, so Chrome may throttle it`);
    if (/swiftshader|basic render|microsoft basic|llvmpipe|softpipe|software|mesa offscreen/i.test(info.gpu || '')) warn(`${sc.name}: the renderer is "${info.gpu}", not a real GPU`);

    // Wait until the title-screen world has loaded: per-second mean frame time steady for 3 s.
    const steady = await waitSteady(page, STEADY_MAX);
    // At rd 12 the far chunks keep meshing after window.__ready (onReady needs only the nearest ones), at a steady
    // 12 ms/frame budget that waitSteady can mistake for steady: wait until no chunk buffer was uploaded for 2 s.
    const meshed = await waitMeshed(page, MESH_MAX);

    // --warp: fast-forward the camera clock to --at minus --settle (see the header), before the scenario is applied.
    const warp = await warpClock(page, sc.warp ?? WARP);
    const tApply = Date.now();

    // Apply the scenario.
    let applied = { ok: true };
    if (!sc.vanilla) {
      applied = await page.evaluate(sc => {
        const T = window.Twitterentary;
        if (!T) return { na: 'window.Twitterentary is missing (shader script not loaded?)' };
        if (sc.off) {
          if (!T.cfg || !('enabled' in T.cfg) || typeof T.set !== 'function') return { na: 'this version has no cfg.enabled / set()' };
          T.set('enabled', false);
          return { ok: true, version: T.version };
        }
        if (sc.preset !== 'current') {
          if (typeof T.applyPreset !== 'function') return { na: 'this version has no applyPreset()' };
          if (!T.applyPreset('quality', sc.preset)) return { na: `this version has no "${sc.preset}" quality preset` };
        }
        const got = {};
        for (const [k, v] of sc.sets) {
          if (!T.cfg || !(k in T.cfg) || typeof T.set !== 'function') return { na: `this version has no "${k}" setting` };
          if (T.set(k, v) === false) return { na: `set("${k}", ${JSON.stringify(v)}) was refused` };
          got[k] = T.cfg[k];
        }
        let stressed = null;
        if (sc.stress) {
          if (typeof T.stress !== 'function') return { na: 'this version has no Twitterentary.stress()' };
          // stress() returns its state (also in debug().stress); an option it doesn't know is not echoed back.
          let st = T.stress(sc.stress);
          if (!st || typeof st !== 'object') { try { st = T.debug().stress; } catch (e) { st = null; } }
          for (const [k, v] of Object.entries(sc.stress)) {
            if (!st || st[k] !== v) {
              try { T.stress({}); } catch (e) {}
              return { na: `this version's stress() has no ${k} option (asked ${k}: ${v}, it reports ${JSON.stringify(st && st[k])})` };
            }
          }
          stressed = st;
        }
        return { ok: true, got, stressed, version: T.version, preset: typeof T.currentPreset === 'function' ? T.currentPreset('quality') : null };
      }, { off: !!sc.off, preset: sc.preset, sets: sc.sets || [], stress: sc.stress || null });
    }
    if (applied.na) return { name: sc.name, na: applied.na, stress: sc.stress || null };
    const notes = [];
    for (const [k, v] of sc.sets || []) if (applied.got && applied.got[k] !== v) notes.push(`${k} became ${JSON.stringify(applied.got[k])}`);
    if (!steady.ok) notes.push(`not steady after ${STEADY_MAX}s`);

    await page.waitForTimeout(WARMUP * 1000);
    // Start at the same point of the title camera's slow turn in every scenario (same view, same chunks drawn).
    let clockStart = await page.evaluate(() => window.__tcbench.clock);
    if (clockStart < AT) {
      await page.waitForFunction(at => window.__tcbench.clock >= at, AT, { polling: 50, timeout: (AT - clockStart + 30) * 1000 }).catch(() => {});
      clockStart = await page.evaluate(() => window.__tcbench.clock);
    } else if (clockStart > AT + 1) notes.push(`started ${(clockStart - AT).toFixed(1)}s late on the camera turn (raise --at)`);
    const settleS = round((Date.now() - tApply) / 1000, 1);
    const locksBefore = lockStatus();
    const cpu0 = cpuTimes();
    const extra0 = await page.evaluate(readExtra);
    const buf0 = await page.evaluate(() => window.__tcbench.bufN);
    await page.evaluate(() => window.__tcbench.start());
    await page.waitForTimeout(SECONDS * 1000);
    await page.evaluate(() => window.__tcbench.stop());
    const cpu1 = cpuTimes();
    const extra1 = await page.evaluate(readExtra);
    const bufRun = (await page.evaluate(() => window.__tcbench.bufN)) - buf0;
    // What the game drew, read on the live page right after measuring (same view): see sampler() probeView.
    const view = await page.evaluate(() => window.__tcbench.probeView(600)).catch(() => null);
    // Let the last GPU queries resolve: on Chrome/D3D11/Intel results arrive 0.25-1.5 s after endQuery.
    await page.waitForFunction(() => !window.__tcbench.pendQ.length, null, { polling: 100, timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(250);
    const raw = await page.evaluate(() => window.__tcbench.result());
    const locksAfter = lockStatus();
    // A waiting software tool writes its lock for a moment every poll, then backs off: only an older lock is real.
    const realSw = l => l.started && Date.now() - Date.parse(l.started) > 3000;
    if ([...locksBefore.software, ...locksAfter.software].some(realSw)) notes.push('a software-mode browser was running');
    if (opts.shots) {
      const dir = join(REPORTS_DIR, `bench-${label}`);
      await mkdir(dir, { recursive: true });
      await page.screenshot({ path: join(dir, `${sc.name.replace(/[^\w.+=-]+/g, '_')}.png`) }).catch(() => {});
    }

    if (raw.lost) return { name: sc.name, error: `WebGL context lost ${raw.lost}x (GPU reset or crash)` };
    const s = stats(raw);
    const tail = tailStats(raw, s.spike);
    if (!s.frames) return { name: sc.name, error: 'no frames were recorded (is requestAnimationFrame running?)' };
    if (raw.timer && s.gpuMs === null && !raw.conflict) notes.push(`GPU timer: only ${s.gpuFrames}/${s.frames} frames resolved${raw.disjoint ? `, ${raw.disjoint} disjoint` : ''}`);
    let gpuMs = s.gpuMs, gpuSrc = gpuMs !== null ? (raw.ring ? 'script per frame' : 'bench') : null;
    if (raw.conflict || (raw.scriptTimer && gpuMs === null)) {
      gpuMs = raw.perfGpu.length ? mean(raw.perfGpu) : typeof extra1.perfGpuMs === 'number' ? extra1.perfGpuMs : null;
      gpuSrc = gpuMs !== null ? 'script mean' : null;
      if (raw.scriptTimer && !raw.ring) notes.push('no per-frame GPU (script lacks perf.gpuRing/gpuRingFrame/frame): plain 12 ms spike rule');
      else if (raw.scriptTimer) notes.push(`the script timed only ${s.gpuFrames} of ${s.frames} frames: mean GPU from perf.gpuMs, plain 12 ms spike rule`);
      if (raw.conflict) notes.push('the script started its own GPU timer mid-run');
      if (gpuMs === null) notes.push('GPU ms n/a (the script times the GPU but reported nothing)');
    }
    const scriptCpuMs = raw.perfCpu.length ? mean(raw.perfCpu) : null;
    // A callback blocked on a busy GPU looks like JS time, so judge the bottleneck by GPU time first.
    if (gpuMs !== null && s.ms && gpuMs / s.ms > 0.8) notes.push('GPU-bound (GPU >= 80% of the frame; callbacks wait on it)');
    else if (s.cpuMs !== null && s.ms && s.cpuMs / s.ms > 0.8) notes.push('CPU-bound (JS >= 80% of the frame)');
    const vcheck = checkView(view, sc.settings);
    if (vcheck.bad.length) { notes.push(`settings not applied: ${vcheck.bad.join(', ')}`); warn(`${sc.name}: the game is not drawing ${settingsText(sc.settings)}: ${vcheck.bad.join(', ')}`); }
    if (!meshed.ok) notes.push(`chunks still meshing after ${MESH_MAX}s`);
    const sysPct = busyPct(cpu0, cpu1);
    if (sysPct !== null && sysPct > PF_LIMITS.warn.sysCpuPct) notes.push(`system CPU ${sysPct}% during the row (> ${PF_LIMITS.warn.sysCpuPct}%: background load?)`);
    if (warp && !warp.ok) notes.push(`--warp stopped at clock ${fmt(warp.toClock, 1)} before its target`);
    if (bufRun > 0) notes.push(`${bufRun} buffer upload(s) during the run (chunks still meshing?)`);
    if (raw.resizes) notes.push(`#gl canvas resized ${raw.resizes}x during the run (the game's slow-frame watchdog?)`);
    if (gpuSrc === 'bench' && gpuMs > s.ms * 1.05) notes.push('GPU timer > frame time (it spans waits)');
    const errList = [
      ...pageErrors.map(e => `uncaught: ${e.message.split('\n')[0]}`),
      ...consoleMsgs.filter(m => m.type === 'error' && m.url.startsWith('userscript:///')).map(m => `${m.url.slice(14)}: ${m.text.split('\n')[0]}`),
    ];
    if (errList.length) notes.push(`${errList.length} script/page error(s): ${errList[0].slice(0, 120)}`);
    // Governor hunting: render-scale changes per minute, from the per-frame scale (sampler, after each frame's callbacks).
    let scaleChanges = null;
    if (raw.fsc) { scaleChanges = 0; for (let i = 1; i < raw.fsc.length; i++) if (raw.fsc[i] !== null && raw.fsc[i - 1] !== null && raw.fsc[i] !== raw.fsc[i - 1]) scaleChanges++; }
    const scaleChgPerMin = scaleChanges !== null && raw.wallMs > 0 ? (scaleChanges * 60000) / raw.wallMs : null;
    const refreshPerMin = extra0.refreshes !== null && extra1.refreshes !== null && raw.wallMs > 0 ? ((extra1.refreshes - extra0.refreshes) * 60000) / raw.wallMs : null;
    return {
      name: sc.name,
      fps: round(s.fps, 1), ms: round(s.ms, 3), med: round(s.med, 3), p95: round(s.p95, 3), p99: round(s.p99, 3), max: round(s.max, 2),
      p95gb: round(s.p95gb, 3), p95gb2: round(s.p95gb2, 3), cpuSpikes: round(s.cpuSpikes, 4), spikes: s.spikes, afterSpike: s.afterSpike,
      holds60: s.holds60, holds60gb: s.holds60gb, holdsRule: HOLDS_RULE, spikeRule: s.spikeRule,
      medWall: round(s.medWall, 3), p95gbWall: round(s.p95gbWall, 3), p95gb2Wall: round(s.p95gb2Wall, 3),
      missPct: round(s.missPct, 2), missPctGb: round(s.missPctGb, 2), hitches50: s.hitches50, holds60Vsync: VSYNC ? s.holds60Vsync : null,
      slowPctGb: round(s.slowPctGb, 2), slowPctGb2: round(s.slowPctGb2, 2),
      scaleChanges, scaleChgPerMin: round(scaleChgPerMin, 1), vsync: VSYNC,
      low1: round(s.low1, 1), cpuMs: round(s.cpuMs, 3), gpuMs: round(gpuMs, 3), gpuP95: gpuSrc === 'bench' || gpuSrc === 'script per frame' ? round(s.gpuP95, 3) : null, gpuSource: gpuSrc,
      scriptCpuMs: round(scriptCpuMs, 3),
      scale: raw.perfScale.length ? round(mean(raw.perfScale), 3) : extra1.scale,
      scaleRange: raw.perfScale.length ? [Math.min(...raw.perfScale), Math.max(...raw.perfScale)] : null,
      refreshPerMin: round(refreshPerMin, 1),
      note: notes.join('; '),
      tail,
      frames: s.frames, gpuFrames: s.gpuFrames, wallMs: Math.round(raw.wallMs), sysCpuPct: busyPct(cpu0, cpu1),
      settings: sc.settings, view: view && { fogStart: round(view.fogStart, 2), fogEnd: round(view.fogEnd, 2), fov: round(view.fov, 2), aspect: round(view.aspect, 4), near: round(view.near, 3), far: round(view.far, 1), drawsPerFrame: round(view.drawsPerFrame, 1), vaos: view.vaos, heldN: view.heldN, ok: !vcheck.bad.length, expected: vcheck.expected },
      meshS: meshed.s, meshVaos: meshed.vaos,
      canvas: [info.w, info.h], scene: extra1.scene, version: applied.version ?? null, preset: applied.preset ?? null,
      stress: sc.stress || null,
      clock: round(clockStart, 2), yawDeg: round(((0.6 - 0.03 * clockStart) * 180) / Math.PI, 1),
      totalS: round((Date.now() - t0) / 1000, 1), steadyS: steady.s, settleS, warp,
      disjoint: raw.disjoint, gpuPending: raw.pending, errors: errList.slice(0, 10),
      ...(opts.raw ? { raw: { iv: raw.iv.map(x => round(x, 3)), ivw: raw.ivw.map(x => round(x, 3)), js: raw.js.map(x => round(x, 3)), gpu: raw.gpu.map(x => round(x, 3)), ...(raw.fsc ? { scale: raw.fsc, refreshes: raw.frf } : {}) } } : {}),
    };
  } finally {
    await context.close().catch(() => {});
  }
}


/**
 * The vsync view per row (rows of a --vsync run): median interval, miss% (intervals > 20 ms) over all frames and over
 * non-spike frames, > 50 ms hitches, mean render scale, scale changes per minute (governor hunting) and redraws/min.
 * Holds 60 (vsync) = median 16.7 +- 0.5 ms and miss% (all frames) <= 1%.
 */
function printVsync(rows) {
  const v = rows.filter(r => r.vsync && !r.na && !r.error);
  if (!v.length) return;
  console.log(c.bold(`\nVsync (60 Hz): holds 60 = median ${VSYNC_MED} +- ${VSYNC_MED_TOL} ms and miss% <= ${VSYNC_MISS_PCT}% (a miss = interval > ${MISS_MS} ms)`));
  const head = ['Scenario', 'med', 'miss%', 'miss%gb', `>${HITCH_MS}ms`, 'spikes', 'scale', 'scale chg/min', 'refr/min', 'holds 60 (vsync)'];
  const body = v.map(r => [r.name, fmt(r.med, 2), fmt(r.missPct, 2), fmt(r.missPctGb, 2), r.hitches50 ?? '-', r.spikes ?? '-', r.scale === null || r.scale === undefined ? '-' : fmt(r.scale, 2), fmt(r.scaleChgPerMin, 1), fmt(r.refreshPerMin, 0), holdsText(r)]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => String(b[i]).length)));
  const line = cells => cells.map((x, i) => (i === 0 ? String(x).padEnd(widths[i]) : String(x).padStart(widths[i]))).join('  ').trimEnd();
  console.log(c.bold(line(head)));
  for (const b of body) console.log(line(b));
}
/** The p95gb tail per row (tailStats): slow non-spike frames and whether they follow a shadow redraw or a scale change. */
function printTail(rows) {
  const t = rows.filter(r => r.tail && r.tail.gbFrames);
  if (!t.length) return;
  console.log(c.dim('Tail (non-spike frames > 16.7 ms; "after" = in that frame or the one before, vs the share of all frames):'));
  for (const r of t) {
    const x = r.tail;
    console.log(c.dim(`  ${r.name.padEnd(24)} slow ${fmt(x.slowPct, 1)}% (mean ${fmt(x.slowMeanMs, 1)} ms) | after a shadow redraw ${fmt(x.withRefreshPct, 0)}% vs ${fmt(x.refreshFramePct, 0)}% | after a scale change ${fmt(x.withScaleChangePct, 0)}% vs ${fmt(x.scaleChangeFramePct, 0)}% | scale drops ${x.drops} raises ${x.raises}`));
  }
}
/** One row from the passes of a scenario: medians of the numbers, plus the per-pass values and their spread. */
function combine(list) {
  const ok = list.filter(r => r && !r.error && !r.na);
  if (!ok.length) return list.find(r => r && r.na) || list.find(r => r && r.error) || { name: '?', error: 'no result' };
  // Passes the noise guard marked (noiseGuard() sets row.unreliable): listed first in the note.
  const unreliablePasses = list.map((r, i) => (r && !r.error && !r.na && r.unreliable ? i + 1 : 0)).filter(Boolean);
  const badNotes = unreliablePasses.map(p => `pass ${p}/${list.length} unreliable (${list[p - 1].unreliable})`);
  if (ok.length === 1) {
    if (list.length === 1) return ok[0];
    const one = { ...ok[0], unreliablePasses, note: [...badNotes, ok[0].note, `${list.length - 1} pass(es) failed`].filter(Boolean).join('; ') };
    delete one.unreliable;
    return one;
  }
  const median = a => { const s = a.filter(v => typeof v === 'number').sort((x, y) => x - y); return s.length ? quantile(s, 0.5) : null; };
  const out = { ...ok[0] };
  delete out.unreliable;
  out.unreliablePasses = unreliablePasses;
  for (const k of ['ms', 'med', 'p95', 'p99', 'max', 'p95gb', 'p95gb2', 'cpuSpikes', 'spikes', 'afterSpike', 'low1', 'cpuMs', 'gpuMs', 'gpuP95', 'scriptCpuMs', 'scale', 'refreshPerMin', 'sysCpuPct', 'frames', 'gpuFrames', 'medWall', 'p95gbWall', 'p95gb2Wall', 'missPct', 'missPctGb', 'hitches50', 'slowPctGb', 'slowPctGb2', 'scaleChanges', 'scaleChgPerMin']) {
    out[k] = round(median(ok.map(r => r[k])), 3);
  }
  out.fps = out.ms ? round(1000 / out.ms, 1) : null;
  out.holds60 = holds60Of(out.med, out.p95gb2);
  out.holds60gb = out.med !== null && out.p95gb !== null ? out.med <= HOLD_MED && out.p95gb <= HOLD_P95 : null;
  out.holds60Vsync = out.vsync ? holds60VsyncOf(out.med, out.missPct) : null;
  const spread = k => { const v = ok.map(r => r[k]).filter(x => typeof x === 'number'); const m = median(v); return v.length > 1 && m ? round(((Math.max(...v) - Math.min(...v)) / m) * 100, 1) : null; };
  out.spreadPct = { ms: spread('ms'), med: spread('med'), p95gb: spread('p95gb'), p95gb2: spread('p95gb2'), gpuMs: spread('gpuMs'), missPct: spread('missPct') };
  out.runs = list.map(r => (r && !r.error && !r.na ? { fps: r.fps, ms: r.ms, med: r.med, p95: r.p95, p95gb: r.p95gb, p95gb2: r.p95gb2, p95gbWall: r.p95gbWall, p95gb2Wall: r.p95gb2Wall, missPct: r.missPct, missPctGb: r.missPctGb, hitches50: r.hitches50, scaleChgPerMin: r.scaleChgPerMin, refreshPerMin: r.refreshPerMin, holds60: r.holds60, cpuSpikes: r.cpuSpikes, low1: r.low1, gpuMs: r.gpuMs, gpuP95: r.gpuP95, gpuSource: r.gpuSource, spikeRule: r.spikeRule, gpuFrames: r.gpuFrames, frames: r.frames, scale: r.scale, scaleRange: r.scaleRange, tail: r.tail || null, yawDeg: r.yawDeg, sysCpuPct: r.sysCpuPct, totalS: r.totalS, settleS: r.settleS, ...(r.unreliable ? { unreliable: r.unreliable } : {}) } : { error: r?.error || r?.na || 'missing' }));
  // Per-pass labels: say so when the passes disagree (e.g. one pass fell back to the plain spike rule).
  const same = k => { const v = [...new Set(ok.map(r => r[k] ?? 'none'))]; return v.length === 1 ? ok[0][k] : `mixed: ${v.join(' / ')}`; };
  // Tail analysis over passes: the median of each pass's numbers (per pass in runs[].tail).
  const tails = ok.map(r => r.tail).filter(Boolean);
  out.tail = tails.length ? Object.fromEntries(['gbFrames', 'slow', 'slowPct', 'slowMeanMs', 'withRefreshPct', 'refreshFramePct', 'withScaleChangePct', 'scaleChangeFramePct', 'drops', 'raises'].map(k => [k, round(median(tails.map(t => t[k])), 2)])) : null;
  out.gpuSource = same('gpuSource');
  out.spikeRule = same('spikeRule');
  const ranges = ok.map(r => r.scaleRange).filter(Array.isArray);
  out.scaleRange = ranges.length ? [Math.min(...ranges.map(x => x[0])), Math.max(...ranges.map(x => x[1]))] : null;
  out.disjoint = ok.reduce((a, r) => a + (r.disjoint || 0), 0);
  out.gpuPending = Math.max(...ok.map(r => r.gpuPending || 0));
  // Notes are joined with '; ', but a note may contain '; ' inside parentheses: split only outside them.
  out.note = [...new Set([...badNotes, ...ok.flatMap(r => (r.note ? r.note.split(/; (?![^(]*\))/) : []))])].join('; ');
  if (ok.length < list.length) out.note = [out.note, `${list.length - ok.length} pass(es) failed`].filter(Boolean).join('; ');
  out.errors = [...new Set(ok.flatMap(r => r.errors || []))].slice(0, 10);
  if (out.raw) delete out.raw;
  return out;
}

/**
 * Noise/thermal guard (--guard P, with --repeat >= 2): every pass runs vanilla, the same work each time, so a pass
 * whose vanilla median or p95gb is more than P% above the best pass's ran on a slower machine (thermal throttling
 * after long GPU load, background work). Tags that pass's rows (row.unreliable) and returns one entry per pass.
 */
function noiseGuard(passes) {
  const usable = r => r && !r.error && !r.na && typeof r.med === 'number' && typeof r.p95gb === 'number';
  const v = passes.map(m => (usable(m.get('vanilla')) ? m.get('vanilla') : null));
  const good = v.filter(Boolean);
  const bestMed = good.length ? Math.min(...good.map(r => r.med)) : null;
  const bestGb = good.length ? Math.min(...good.map(r => r.p95gb)) : null;
  return v.map((r, i) => {
    const entry = { pass: i + 1, vanillaMed: r ? r.med : null, vanillaP95gb: r ? r.p95gb : null, medPct: null, p95gbPct: null, unreliable: null };
    if (!r || good.length < 2 || !(bestMed > 0) || !(bestGb > 0)) return entry;
    entry.medPct = round((r.med / bestMed - 1) * 100, 1);
    entry.p95gbPct = round((r.p95gb / bestGb - 1) * 100, 1);
    const badMed = entry.medPct > GUARD, badGb = entry.p95gbPct > GUARD;
    if (!badMed && !badGb) return entry;
    entry.unreliable = [badMed ? `vanilla median ${fmt(r.med, 2)} ms, +${fmt(entry.medPct, 0)}% vs the best pass's ${fmt(bestMed, 2)}` : '',
      badGb ? `vanilla p95gb ${fmt(r.p95gb, 2)} ms, +${fmt(entry.p95gbPct, 0)}% vs ${fmt(bestGb, 2)}` : ''].filter(Boolean).join(', ');
    // Short form for the row notes (no '; ' in it: notes are joined with '; ').
    const short = `vanilla ${[badMed ? `median +${fmt(entry.medPct, 0)}%` : '', badGb ? `p95gb +${fmt(entry.p95gbPct, 0)}%` : ''].filter(Boolean).join(', ')} vs the best pass`;
    for (const row of passes[i].values()) if (row && !row.error && !row.na) row.unreliable = short;
    return entry;
  });
}

/**
 * Does the drawn view match the settings? gfx.js draw(): fogEnd = rd * 16 - 4 (overworld, not underwater), fogStart
 * = 0.55 * fogEnd; playerView(): far = max(320, rd * 40), FOV = S.fov, which eases to mc.fov (x1.1 while flying).
 */
function checkView(view, s) {
  const expected = { fogEnd: s.rd * 16 - 4, far: Math.max(320, s.rd * 40), fov: s.fov };
  const bad = [];
  if (!view || view.fogEnd === null) return { expected, bad: ['could not read the fog range from the page (uFogR not seen)'] };
  if (Math.abs(view.fogEnd - expected.fogEnd) > 0.5) bad.push(`fog end ${fmt(view.fogEnd, 1)}, expected ${expected.fogEnd} for rd ${s.rd}`);
  if (view.fov === null) bad.push('could not read the projection (uVP not seen)');
  else {
    if (Math.abs(view.fov - s.fov) > 0.5 && Math.abs(view.fov - s.fov * 1.1) > 0.5) bad.push(`FOV ${fmt(view.fov, 1)}, expected ${s.fov}`);
    if (view.far !== null && Math.abs(view.far / expected.far - 1) > 0.01) bad.push(`far plane ${fmt(view.far, 0)}, expected ${expected.far}`);
  }
  if (s.heldLight === 'off' && view.heldN > 0) bad.push(`held light off but uHeldN = ${view.heldN}`);
  return { expected, bad };
}

/**
 * --warp K: run the title camera's clock K times faster until it reaches --at minus --settle, then normal again (the
 * timestamp offset stays, so later frames get real dt). Returns null when off, else { k, fromClock, toClock,
 * gainedS (game seconds gained), realS, ok }.
 */
async function warpClock(page, k) {
  if (!(k > 1)) return null;
  const target = Math.max(0, AT - Math.max(SETTLE, WARMUP));
  const t0 = Date.now();
  const from = await page.evaluate(() => window.__tcbench.clock);
  if (from >= target) return { k, fromClock: round(from, 2), toClock: round(from, 2), gainedS: 0, realS: 0, ok: true };
  await page.evaluate(([k, to]) => { const B = window.__tcbench; B.warpTo = to; B.warpK = k; }, [k, target]);
  // At least ~1 s of game time per real second even on very slow frames (the 0.25 s cap per frame binds then).
  const ok = await page.waitForFunction(to => window.__tcbench.clock >= to - 0.001, target, { polling: 50, timeout: ((target - from) / Math.min(k, 4) + 20) * 1000 }).then(() => true, () => false);
  const st = await page.evaluate(() => { const B = window.__tcbench; B.warpK = 1; return { clock: B.clock, off: B.off }; });
  return { k, fromClock: round(from, 2), toClock: round(st.clock, 2), gainedS: round(st.off / 1000, 2), realS: round((Date.now() - t0) / 1000, 1), ok };
}

/** Wait until chunk meshing has stopped: no bufferData on the game's context for 2 s (chunk uploads, gfx.setChunk). */
async function waitMeshed(page, maxS) {
  const t0 = Date.now();
  for (;;) {
    const st = await page.evaluate(() => ({ idle: performance.now() - window.__tcbench.bufT, vaos: window.__tcbench.vaos }));
    if (st.idle >= 2000) return { ok: true, s: round((Date.now() - t0) / 1000, 1), vaos: st.vaos };
    if ((Date.now() - t0) / 1000 >= maxS) return { ok: false, s: round((Date.now() - t0) / 1000, 1), vaos: st.vaos };
    await page.waitForTimeout(500);
  }
}

function readExtra() {
  const T = window.Twitterentary;
  const st = T && T.stats, perf = T && T.perf, post = st && st.post;
  return {
    refreshes: st && typeof st.refreshes === 'number' ? st.refreshes : null,
    scale: perf && typeof perf.scale === 'number' ? perf.scale : null,
    perfGpuMs: perf && typeof perf.gpuMs === 'number' ? perf.gpuMs : null,
    scene: post && post.active && post.w ? [post.w, post.h] : null,
  };
}

/** Wait until the world has loaded: per-second mean frame time within 15% for 3 consecutive seconds. */
// The game sets window.__ready once the chunks around the camera are meshed (main.js onReady/spawn), so wait for that
// first; then for the frame time to settle.
async function waitSteady(page, maxS) {
  const t0 = Date.now();
  const read = () => page.evaluate(() => ({ n: window.__tcbench.n, sum: window.__tcbench.sum, ready: window.__ready === true }));
  let prev = await read(), means = [];
  while ((Date.now() - t0) / 1000 < maxS) {
    await page.waitForTimeout(1000);
    const cur = await read();
    const n = cur.n - prev.n;
    means.push(n && cur.ready ? (cur.sum - prev.sum) / n : Infinity);
    prev = cur;
    const last = means.slice(-3);
    if (last.length === 3 && last.every(Number.isFinite)) {
      const lo = Math.min(...last), hi = Math.max(...last);
      if (hi <= lo * 1.15) return { ok: true, s: round((Date.now() - t0) / 1000, 1) };
    }
  }
  return { ok: false, s: round((Date.now() - t0) / 1000, 1) };
}

function printTable(rows) {
  const vs = rows.some(r => r.vsync);
  const head = ['Scenario', 'FPS', 'ms', 'med', 'p95', 'p95gb', 'p95gb2', 'spk%', vs ? '60?vs' : '60?', '1%low', 'JS ms', 'GPU ms', 'scale', 'refr/min', 'note'];
  const body = rows.map(r => r.na || r.error
    ? [r.name, r.error ? 'FAIL' : 'n/a', '', '', '', '', '', '', '', '', '', '', '', '', r.error || r.na]
    : [r.name, fmt(r.fps, 1), fmt(r.ms, 2), fmt(r.med, 2), fmt(r.p95, 2), fmt(r.p95gb, 2), fmt(r.p95gb2, 2), fmt(r.cpuSpikes * 100, 1), holdsText(r), fmt(r.low1, 1), fmt(r.cpuMs, 2), fmt(r.gpuMs, 2), r.scale === null || r.scale === undefined ? '' : fmt(r.scale, 2), fmt(r.refreshPerMin, 0),
      [r.spreadPct ? `spread over ${r.runs.length} passes${r.unreliablePasses?.length ? ` (${r.unreliablePasses.length} UNRELIABLE)` : ''}: ms ${fmt(r.spreadPct.ms, 0)}%, med ${fmt(r.spreadPct.med, 0)}%, p95gb ${fmt(r.spreadPct.p95gb, 0)}%${r.spreadPct.p95gb2 !== undefined ? `, p95gb2 ${fmt(r.spreadPct.p95gb2, 0)}%` : ''}` : '', r.note || ''].filter(Boolean).join('; ')]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(b => String(b[i]).length)));
  const line = cells => cells.map((v, i) => (i === 0 || i === cells.length - 1 ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i]))).join('  ').trimEnd();
  console.log(c.bold(line(head)));
  body.forEach((b, i) => console.log(rows[i].unreliablePasses?.length ? c.yellow(line(b)) : line(b)));
}

/** The stress() options a row ran with; rows written before the motion recalibration carry no `stress` field. */
function motionOf(r) {
  if ('stress' in r) return r.stress || null;
  const m = r.name.match(/-(\w+)$/);
  return (m && LEGACY_MOTIONS[m[1]]) || null;
}

function printCompare(rows, base, cur = env) {
  const byName = new Map((base.rows || []).map(r => [r.name, r]));
  console.log(c.bold(`\nCompared with ${base.env?.label || opts.compare} (${(base.env?.scripts || []).map(s => `${s.name || s.file} ${s.version}`).join(', ') || 'vanilla'}):`));
  const baseSet = settingsOf(null, base.env);
  const curSet = settingsOf(null, cur);
  const baseVs = !!base.env?.vsync, curVs = !!cur?.vsync;
  if (baseVs !== curVs) warn(`--compare: the baseline ran ${baseVs ? 'with vsync (60 Hz pacing)' : 'uncapped'}, this run ${curVs ? 'with vsync' : 'uncapped'}: frame times are not comparable (only GPU ms and scale are)`);
  if (!sameSettings(baseSet, curSet)) {
    warn(`--compare: the baseline ran at ${settingsText(baseSet)}${base.env && 'rd' in base.env ? '' : ' (it predates --rd/--fov: the game defaults)'}, this run at ${settingsText(curSet)}, so the deltas compare different loads`);
  }
  const head = ['Scenario', 'FPS', 'ΔFPS', 'ms', 'Δms', 'Δ%', 'med Δms', 'p95gb Δms', 'p95gb2 Δms', 'p95 Δms', 'miss Δpp', 'JS Δms', 'GPU Δms', 'note'];
  const NB = head.length - 3; // blank cells after "no baseline row" etc.
  const body = [];
  const blank = n => Array(n).fill('');
  for (const r of rows) {
    const b = byName.get(r.name);
    if (!b) { body.push([r.name, fmt(r.fps, 1), 'no baseline row', ...blank(NB)]); continue; }
    if (!r.fps || !b.fps) { body.push([r.name, r.fps ? fmt(r.fps, 1) : 'n/a', b.fps ? `was ${fmt(b.fps, 1)}` : 'was n/a', ...blank(NB)]); continue; }
    // Same name, different load: a "-moving" row from before the recalibration was a forced redraw every 4 frames.
    if (JSON.stringify(motionOf(r)) !== JSON.stringify(motionOf(b))) { body.push([r.name, fmt(r.fps, 1), `not comparable: baseline ran stress(${JSON.stringify(motionOf(b) || {})}), this run stress(${JSON.stringify(motionOf(r) || {})})`, ...blank(NB)]); continue; }
    const rs = settingsOf(r, cur), bs = settingsOf(b, base.env);
    const setNote = [sameSettings(rs, bs) ? '' : `settings differ: ${settingsText(rs)} vs ${settingsText(bs)}`, !!r.vsync !== !!b.vsync && (r.vsync !== undefined || b.vsync !== undefined) ? 'vsync differs' : ''].filter(Boolean).join('; ');
    const d =(x, y, p = 2) => (x === null || x === undefined || y === null || y === undefined ? '' : signed(x - y, p));
    body.push([r.name, fmt(r.fps, 1), d(r.fps, b.fps, 1), fmt(r.ms, 2), d(r.ms, b.ms), signed(((r.ms - b.ms) / b.ms) * 100, 1) + '%', d(r.med, b.med), d(r.p95gb, b.p95gb), d(r.p95gb2, b.p95gb2), d(r.p95, b.p95), d(r.missPct, b.missPct), d(r.cpuMs, b.cpuMs), d(r.gpuMs, b.gpuMs), setNote]);
  }
  const widths = head.map((h, i) => Math.max(h.length, ...body.map(x => String(x[i]).length)));
  const line = cells => cells.map((v, i) => (i === 0 || i === cells.length - 1 ? String(v).padEnd(widths[i]) : String(v).padStart(widths[i]))).join('  ').trimEnd();
  console.log(c.bold(line(head)));
  for (const b of body) {
    const pct = parseFloat(b[5]);
    const txt = line(b);
    console.log(Number.isFinite(pct) ? (pct <= -3 ? c.green(txt) : pct >= 3 ? c.red(txt) : txt) : txt);
  }
}

function fmt(v, p) { return v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(p); }
function signed(v, p) { return (v > 0 ? '+' : '') + v.toFixed(p); }
function round(v, p) { return v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(p)); }
function fail(msg) { console.log(`${FAIL} ${msg}`); process.exit(1); }
