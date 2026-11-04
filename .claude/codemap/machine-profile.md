# Machine profile: the bench laptop

Measured on Intel i7-8650U / UHD 620 (ANGLE D3D11, Chrome 156, Windows 11); data up to 2026-11-04 14:40 UTC; regenerate with the steps in §Regenerate (§9).

The numbers come from `reports/bench-*.json`, and every one names its report. `tools/lib/machine-profile.json` holds the
same numbers as data, for `bench --protocol` and `--preflight`. Read this before you benchmark: it tells you which
settings to start from, which deltas are noise, and when a run is worth trusting. A value with no data is null or
"unknown". All of it is measured on the title screen, at the standard (rd 12, FOV 80, 1920×1080, DPR 1, uncapped,
`--at 40`) unless a row says otherwise.

## §1 Machine and backend

- **Hardware:** i7-8650U (4C/8T), Intel UHD 620, 60 Hz 1920×1080 panel, a laptop.
- **Software:** Chrome 156.0.8078.80, ANGLE **d3d11** (Chrome's default on Windows).
- **GPU timer:** `EXT_disjoint_timer_query_webgl2` works on d3d11, gl and vulkan. TIMESTAMP_EXT has 0 bits, so all
  GPU times come from TIME_ELAPSED, and its results arrive 0.25-1.5 s late.
- **gpuMs source.** The bench's own timer (`gpuSource: bench`, used for vanilla) is an upper bound. Rows with our
  script read the script's per-frame samples (`script per frame`). `bench-sh-rc2` used `script mean`, an 8-query ring
  that covered ~6% of frames; its GPU numbers are unreliable.
- **Backends:** gl and vulkan deliver frames in bunches, so their median and p95gb are meaningless; compare backends
  by mean ms only.
  - On 1.4.0 at rd 8 / FOV 70, High's mean was d3d11 16.6-17.6, gl 12.6 and vulkan 11.3 ms (`bench-angle-*`).
  - That was before the flat-varying fix (§4). The gap today is unknown.
- **Frame time is GPU-bound.** Uncapped, `cpuMs` ≈ `med`, because the JS callback blocks in GL calls. Read `gpuMs`
  instead. Under `--vsync`, `cpuMs` is the real JS time (about 2.3 ms on High).
- **The GPU downclocks.** With slack under a 60 Hz cap, the UHD 620 reads about 1.5 GPU ms more for the same work.
  This comes from LAB2 scratch data and SH5's vsync traces, not from a bench report. Thresholds tuned uncapped
  therefore read low in real play.
- **Chunk work grows with rd.** At rd 12 the title world has about 400 chunk draws per frame: 213 at rd 8, 299 at
  rd 10, 483 at FOV 110. Meshing has always finished by the time frame times are steady (`meshS` = 0 in every rd-12
  report).

## §2 Noise floor

Spread between passes of the same row in the same run (from `runs[]`, rd-12 reports with 3 passes, clean passes):

| row type | med SD | gpuMs SD | p95gb SD | p95gb2 SD |
|---|---|---|---|---|
| vanilla | 0.18 ms (3.8%) | 0.22 | 0.61 | 0.12 (4 passes) |
| fixed renderScale | 0.21 (1.8%) | 0.34 (2.6%) | 1.36 (8%) | n/a |
| Auto (governor) | 0.28 | 0.54 | 2.45 (14%) | 0.29 (2 rows, `bench-sh5-medium`) |

**A delta below these is noise** (about 2 SD of a difference):

| comparison | med | gpuMs | p95gb2 | p95gb |
|---|---|---|---|---|
| two rows, same run, 1 pass | 0.6 ms | 0.9 | 1.0 | 3.0 |
| two rows, same run, 3 passes | 0.4 | 0.6 | 0.7 | 2.0 |
| same row, different reports, fixed scale | 0.5 | 0.5 | | |
| same row, different reports, Auto | 0.8 | | | 2.6 |

- **Fixed-scale rows reproduce very well across reports.** high@rd=8 read med 10.2-10.3 / gpu 10.37-10.71 in 5
  reports over 2.5 h; ultra@rd=8 read 10.5-10.8 / 10.79-11.24 in 3.
- **p95gb is the worst metric.** The same row ranged 4.5 ms across reports (high@rd=8: 12.7-17.2). p95gb2 removes most
  of that: ultra@rd=8 p95gb 18.5 became p95gb2 12.3.
- **Auto rows carried governor noise (1.5.0 reports only; Auto is gone since 1.5.1).** The median moves 0.6-0.7 ms when the governor lands at 1.0 instead of 0.9. The
  1-pass `bench-sh5-v7` medium read 12.1 / p95gb2 16.86 at scale 1.00; three passes (`bench-sh5-medium`) read 11.5 /
  15.10 at 0.89.
- **The same build, 1 pass vs 3:** `bench-sh4-final2` and `bench-final-1.5` (v-final2). The Auto rows' p95gb differed
  by 1.2-2.6 ms: every preset "held" in the 1-pass run and failed in the 3-pass one. The medians differed by only
  0.1-0.7 ms.
- **Verdict flips:** 5 of 74 single passes gave a different holds-60 verdict than their row's 3-pass median. Every
  flip was on p95, never on med. The rows' margins were −0.75 to +2.74 ms on p95gb.
- **Longer windows only help the tail.** In per-frame data (`bench-lab2-raw1`, rd 12), any 4-s window already has
  med SD ≤ 0.2 and gpu SD ≤ 0.15, below the pass-to-pass SD. A longer `--seconds` helps only the p95 tail, which is
  bursty: one 2-s window of high@1 read p95gb2 24.6 against 16-17 in the others.
- **Best discriminators.**
  - For cost questions: **med and gpuMs on fixed-renderScale rows.**
  - For holds-60 verdicts: **p95gb2**, never p95gb.
  - 1% low is the noisiest metric of all; don't judge on it.

## §3 Thermal and background load

- **No GPU-thermal throttling has been seen.** Over about 5 h of near-continuous GPU load (11-03, 11:00-16:15),
  vanilla's median stayed at 4.4-5.0 ms with no trend. Within one run without cooldown it crept by +0.3 ms at most
  (`bench-sh5-medium` vanilla: 4.6 / 4.8 / 4.9).
- **Every slow or flagged pass was background CPU load**, with the row's `sysCpuPct` at 58% or more:
  - the lead's govsim (pass 1 of `bench-final-1.5` and `-native`);
  - COMPAT3's SwiftShader smokes (`bench-bench3-verify` and `-fs-window`, vanilla 5.8-8.7, sysCpu 74-100%);
  - 83% in `bench-sh2-a-final` pass 1 (vanilla +62%).
- **`--cooldown 60` did not help.** Both 60-s-cooldown acceptance runs still had pass 1 flagged. A 30-s cooldown is
  cheap insurance against the small creep. Nothing in the data supports more.
- **Vanilla can miss contamination of the heavy rows.** In `bench-sh4-sh7` the renderScale=1 rows read +1.8 to
  +2.6 ms med (sysCpu 51-84%) against `bench-sh4-sh7b`, yet vanilla read 4.7 in both.
- **Detect a bad state early:**

| signal | normal | WARN | abort / re-run |
|---|---|---|---|
| vanilla med (rd 12, `--at 40`) | 4.4-5.0 (typical 4.7) | > 5.0 | > 5.5 |
| vanilla p95gb | 6.4-8.5 | > 8.5 | > 10 |
| vanilla p95gb2 | 7.07-7.30 (thin data) | | |
| vanilla gpuMs | 4.39-5.17 | | |
| row sysCpuPct | vanilla 42-50, heavy rows 33-48 | > 55 (vanilla), > 50 (heavy row) | |

- **Vanilla at the other settings:**
  - rd 8: 3.3-3.5 (gpu 3.57-3.83);
  - rd 10: 4.2 (one clean row);
  - FOV 70: 4.7;
  - FOV 110: 5.1-5.3.
  - The old rd 8 / FOV 70 standard (11-02): 3.4-3.8.
- **`--at` changes the view.** At `--at 20` vanilla reads 3.9-4.2, so never calibrate or compare across different
  `--at` values.

## §4 Cost table (GPU ms unless marked; scale 1)

"Current" means the 1.5.0 working copy (v-final2 / SH5 v-final; only the governor differs between the two).
"base-gov1" means LAB2's breakdown build, from before the flat-varying fix. Single-pass knob rows are only as good
as the 0.9 ms noise in §2.

| feature / change | rd 12 | rd 8 | source |
|---|---|---|---|
| vanilla | 4.76 | 3.6 | vanilla passes (§3) |
| `off` tax, current | +0.2 (0.07-0.42) | unknown | `sh5-v7`, `final-1.5`, `sh4-final` |
| `off` tax with the old flat varying | +3.04 | +1.08 | `lab2-breakdown-rd12/-rd8` (per-primitive, grows with rd) |
| effects without shadows (low − off) | +6.0 current; +4.31 base-gov1 | +4.48 base-gov1 | `sh5-v7`, `final-1.5-native`; LAB2. Per-pixel, flat in rd |
| shadows on | +2.1 (medium@1 − low@1) | +1.6 | `final-1.5-native` (3 passes); `lab2-low-retest`, `-breakdown-rd8` |
| high over medium | +0.53 (noise) | | `final-1.5-native` |
| ultra over high | −0.43 (noise) | +0.5 | `final-1.5-native`; `sh5-secondary`, `final-1.5-secondary` |
| shadowFilter=0 / =2 | +0.29 / +0.69 (noise) | 1.4.0: −1.96 / −0.8 | `lab2-breakdown-rd12`; `baseline-1.4.0` (rd 8, FOV 70) |
| shadowCascades=false | +0.1 (med −0.2), redraws 30 → 15/min | | `lab2-breakdown-rd12` |
| shadowSize=1024 | +0.48 (noise) | | `lab2-breakdown-rd12` |
| shadowSize=4096 | **+2.11, p95gb +11** | | `lab2-breakdown-rd12` |
| waterEffects / waving / skyEffects = false | +0.36 / +0.84 / 0.00 (all noise) | 1.4.0: −0.42 / −0.33 / −1.32 | `lab2-breakdown-rd12`; `baseline-1.4.0` |
| renderScale 1 → 0.9 | −0.3 (high, early 1.5); about −1.3 (medium, current, across reports) | | `early-1.5-rd12-fixed`; `final-1.5-native` vs `sh5-medium` |
| renderScale 1 → 0.7 | −2.0 to −3.0 | | `lab2-raw1`, `lab2-breakdown-rd12` |
| renderScale 1 → 0.6 | −3.9 | −3.7 | base-gov1, `lab2-breakdown-rd12/-rd8` |
| high@1 by rd | 14.04 | 10.7 (rd 10: 12.4-12.6) | about +0.84 per rd unit; `final-1.5-native`, `*-secondary` |
| FOV 110 vs 80 | vanilla +0.4; ultra@1 **−1.5**; high@1 −0.5 | | `sh4-final*`, `final-1.5-secondary`, `sh4-sh7b` |
| FOV 70 vs 80 | vanilla +0.1; high +0.5 (at scale 0.94) | | `sh4-sh7b`, `*-secondary` |
| held light off | unknown (inert on the title screen) | | |
| shadow redraws at real movement (127/min) | ≈ 0 (−0.19) | | `final-1.5` high-moving vs high |
| `-stress`-level redraws (~1250/min, the old `-moving`) | | +1.3 | `sh-rc3` |
| 1.4.0 → 1.5 (high, scale 1) | 15.72 → 14.04 (med 15.3 → 12.9) | | `baseline-1.4.0-rd12`, `final-1.5-native` |

- **Where the cost is.** Effects and the shadow lookup are per-pixel: they are flat between rd 8 and rd 12. The old
  `off` tax was per-primitive and grew with rd.
- **No big lever is left among the settings.** Render scale was the only one, and 1.5.1 removed it: the user wants
  100% only. Every other knob except shadows on/off and shadowSize=4096 is inside single-pass noise.
- **Wide FOV is not the worst case for the script.** On the title view, FOV 110 shows more sky and fewer terrain
  pixels, so ultra at scale 1 is cheaper there than at FOV 80. FOV 70 costs more.

## §5 Presets at the standard (latest known)

Shaders 1.5.1, always scale 1, game build 6b3963e444, uncapped (`bench-final-1.5.1`). Title-screen numbers only:
they don't transfer to a real world.

| preset | med | p95gb2 | gpuMs | passes | holds 60 |
|---|---|---|---|---|---|
| low | 9.7 | 12.70 | 9.82 | 1 | yes |
| medium | 11.7 | 14.52 | 11.56 | 1 | yes |
| high | 12.1 | 15.10 | 12.00 | 3 | yes |
| ultra | 12.3 | 15.80 | 12.62 | 3 | yes |
| high-moving | 12.2 | 15.17 | 12.18 | 3 | yes |
| ultra-moving | 12.4 | 15.24 | 12.26 | 3 | yes |

- **Native scale 1** (`bench-final-1.5-native`, 3 passes, med / p95gb / gpu): low 10.7 / 15.95 / 11.37, medium 12.3 /
  19.68 / 13.51, high 12.9 / 19.44 / 14.04, ultra 12.6 / 19.78 / 13.61. Holds 60 is **unknown**: no p95gb2 was
  recorded, and the medians are ≤ 14.
- **Secondary rows** (`bench-sh5-secondary`, 1 pass, interrupted; med / p95gb2), all holding:
  - high@rd=8 10.2 / 12.33, ultra@rd=8 10.8 / 12.35;
  - high@rd=10 12.1 / 15.5, ultra@rd=10 11.2 / 14.4;
  - high@fov=70 11.6 / 14.4, ultra@fov=70 10.5 / 14.6;
  - high@fov=110 11.5 / 16.4, which is 0.3 from the line.
  - ultra@fov=110: no data (the row errored).
- **Under vsync** (1.5.1, 1 pass of 30 s, second virtual desktop; `bench-ab-vsync-151`, `bench-final-1.5.1-vsync-clean`), as
  FPS / miss% / GPU ms: off 60 / 0 / 3.95, low 60 / 0 / 10.28, medium 59.8 / 0.06 / 12.12, high 60 / 0 / 12.23, ultra 60 / 0 / 12.50,
  high-moving 60 / 0 / 12.38, ultra-moving 60 / 0 / 12.56. All hold. Same conditions on 1.5.0 at 100% (`bench-ab-vsync-150`):
  high 59.8 / 0.45 / 14.07, ultra 60 / 0.11 / 13.95. The 1.8 GPU ms gap is one pass per row, so don't read much into it.
- **1.4.0 baseline at the standard** (`bench-baseline-1.4.0-rd12`, 3 passes, med / p95gb):
  - vanilla 4.5 / 6.8, off 6.1 / 9.37;
  - low 15.1 / 19.2, medium 15.1 / 18.7, high 15.3 / 18.99, ultra 15.3 / 27.31.
  - None held 60.

## §6 Protocols

The wall time of a run is dominated by `--at`, not by `--seconds`. `--warp 10 --settle 12` fast-forwards the title
clock to the same view (clock 40, same yaw) and cuts a scenario to 29-33 s. It reads the same within 1-pass noise
(`bench-devloop-warp-ab`: vanilla 4.75 vs 4.5, high 11.9 vs 12.0, GPU 12.40 vs 12.35), so warped rows compare with
`--at 40` reports and use the same vanilla range. Without warp:
- **Per scenario:** about `at + seconds + 3-5 s`, which is 51-53 s at `--at 40` whatever `--seconds` is. Boot,
  steady and warm-up overlap the wait for the title camera.
- **Total:** about `scenarios × passes × 52 s + passes × cooldown + ~10 s`.
- **The guard adds vanilla to every pass,** so count it as a scenario.
- **What changing the settings saves:** `--seconds 8 → 5` saves about 3 s a scenario (6%). Runs at `--at 20` took
  29-32 s, but that is another view. A steady wait over ~35 s stretches a row (angle-gl High took 81 s).

| protocol | seconds | warmup | repeat | cooldown | at | use | wall time |
|---|---|---|---|---|---|---|---|
| **screen** | 5 | 2 | 1 | 0 | 40, warp 10 | A/B cost questions on med/gpuMs, rows at fixed renderScale | ~30 s/scenario warped (~50 legacy); 4 scenarios ≈ 2 min |
| **accept** | 8 | 2 | 3 | 30 | 40, warp 10 | holds-60 verdicts, version-to-version comparisons, guard 25 | 8 scenarios ≈ 15 min warped (≈ 22.5 legacy) |
| **accept vsync** | 30 | 2 | 2 | 30 | 40 | holds 60 (vsync), governor hunting | about (at + 34 s) × scenarios × 2; 8 scenarios ≈ 20 min |

- **Adaptive accept** cuts wall time where verdicts are clear:
  - Run pass 1, then stop for each row whose `|p95gb2 − 16.7| ≥ 2.0` and `|med − 14| ≥ 0.8`.
  - Give passes 2-3 only to the rows inside those margins.
  - On the latest data that settles low, high and ultra-moving after 1 pass, and leaves medium, ultra and high-moving
    for more passes.
  - The 2.0 margin covers the largest 1-pass p95gb2 error seen (+1.76).
- **Vsync:**
  - ≥ 30 s per row. At 8 s one frame is 0.21 pp of miss%; at 30 s it is 0.056 pp.
  - Re-run at 60 s if miss% lands between 0.5 and 1.5.
  - The guard can't see throttling under vsync (vanilla is pinned at 16.7), so do the uncapped preflight first.
- **Would one 8-s pass have called every verdict right?** No: 5 of 74 passes flipped. With the adaptive margins,
  every one of those flips would have gone on to 3 passes.
- **Is 5 s enough?**
  - For med and gpu, yes: 4-s windows have SD ≤ 0.2.
  - For a p95 verdict, no: windows of 2-4 s missed or hit single bursts.
- **Before any real-GPU run,** run the preflight (§3): vanilla med 4.4-5.0 and sysCpu ≤ 55.
  - If it fails, wait for the other agents' CPU work to finish. Cooling down won't help.

## §7 First guesses

| goal | start with | why |
|---|---|---|
| hold 60 at the standard (title screen) | any preset | 9.7-12.4 med, p95gb2 12.7-15.8 uncapped; at most 0.06% miss under vsync (§5). Says nothing about a real world |
| cheapest shadows | **medium**, or `high+shadowCascades=false` | Shadows cost ~2 GPU ms at rd 12 (1.6 at rd 8). Filter, cascades and 1024-2048 maps are all noise, and cascades off halves redraws. Avoid shadowSize=4096 (+2.1, p95gb +11). The real saving is shadows off |
| is my GLSL change a per-primitive regression? | `vanilla,off,vanilla@rd=8,off@rd=8` (screen) | Today's off tax is +0.1-0.4 GPU ms at rd 12. More than ~1 ms, growing with rd, means per-primitive cost, like the old flat varying (+3.0 at rd 12, +1.1 at rd 8) |
| a player at rd 8 | high or ultra at scale 1 | 10.2-10.8 med, p95gb2 12.3 (`sh5-secondary`) |
| worst secondary row to include | high@rd=10, high@fov=110 | 12.1 / 15.5 and 16.4 (0.3 from the line); FOV 70 is dearer for the script than FOV 110 |
| did the effect knob X change cost? | screen protocol, same run | Single-knob costs at rd 12 are ≤ 0.8 ms |

## §8 Gotchas from the reports

- **Results that look valid but aren't comparable:**
  - **`bench-final-1.5.1-vsync`** is contaminated: 20 prewarmed windows on a second desktop, two audits running on the laptop for
    pass 1, and the user looked at that desktop. high read 8.5% miss, ultra 11.9%, against 0% in the clean A/B minutes later, and
    vanilla was inflated too. Which of those caused it is unknown. Keep `--prewarm` small and the laptop quiet under vsync.
  - **No `env.rd`** means rd 8 / FOV 70 (the 11-02 reports). Those numbers are not comparable to the rd-12 standard.
  - **`-moving` before `bench-bench2-motion-check`** means today's `-stress` (~1000-1470 redraws/min).
  - **p95gb2 exists only from `bench-sh5-v7` / `bench4-vsync-check` on.** Older verdicts used p95gb (the table prints
    `yes(gb)`).
  - **Different `--at` means a different view:** the bench3 `*2` reports used 20. `--warp` keeps the view (it still
    measures at clock 40), so warped and legacy rows compare.
  - **`bench-devloop-verify`** is contaminated (vanilla 5.2-6.7 at sysCpu 51-77%); preflight and the guard caught it.
  - **Rows aligned to different yaws are useless:** `bench-baseline-1.4.0-unaligned`, `trial1`, `diag-raw`.
- **n/a rows** are reasons, not errors. A version without `Twitterentary.stress()` (1.4.0) or without its `moveSpeed`
  option makes `-moving` n/a, and so does a missing preset or key.
- **Flaky rows to retry, not to read:**
  - "no frames were recorded (is requestAnimationFrame running?)": `lab2-breakdown-rd12` low@1, and `sh4-startb`
    high@rd=10, whose row also recorded rd 12. A rerun was fine.
  - "uncaught: Cannot read properties of null (reading 'S')" (shadowSize=1024 row). It is probably the game's.
  - "Target page, context or browser has been closed": the user interrupted `sh5-secondary`.
  - "the game did not boot: This game needs WebGL 2" at 960×540 in early `diag-540`.
- **Window and fullscreen:** `--fullscreen` via `--start-fullscreen` once gave a 1904×985 canvas (`bench3-fs-full`).
  Check the canvas WARN. The CDP fullscreen fix gives the same timings as windowed.
- **Mesh waits:** `meshS` was 0 in every rd-12 report. `steadyS` is 3-11 s, but up to 25 s on the early heavy
  1.4.0 rows. A long steady wait means something is wrong (backend, load).
- **A vanilla 25% guard pass is not enough.** It missed `sh4-sh7`'s contaminated heavy rows. Check each row's
  sysCpuPct too.
- **8-s vsync rows can't decide the 1% miss rule** (`bench4-vsync-check` failed by 0.05 pp).
- **1-pass Auto verdicts are the most misleading numbers in the reports.** `sh4-final2` said every preset holds and
  `final-1.5` said none (except low) did, on the same build.

## §9 Regenerate

Do this by hand after new real-GPU runs; nothing is automated yet. If `npm run bench:history` exists, start with its
table (`--md --since <date>`).
1. Load every `reports/bench-*.json` and flatten one row per scenario. Record: label, `env.at`, the shader version
   and file, rd/fov (missing means 8/70), vsync, angle, w×h, `--at` (row `clock`), med, p95gb, p95gb2, gpuMs, cpuMs,
   missPct, scaleChgPerMin, scale, sysCpuPct, spreadPct, runs[] and totalS.
2. Drop the exclusions listed in `machine-profile.json` → `excluded`, plus any new run whose vanilla or row
   sysCpuPct breaks §3.
3. **vanilla:** collect every clean vanilla pass at the standard with `--at 40` (runs[] when present). The ranges are
   min-max; warn and abort stay at the levels in §3 unless the distribution moves.
4. **noise:** SD of runs[] per row and per metric, pooled RMS by row type (vanilla / fixed / Auto). Add the
   cross-report ranges of rows run on the same build. Count verdict flips of single passes against the 3-pass median.
5. **window test** (needs `--raw`): split each row's 8 s of frames into 1-5 s windows and take the SD of med, gpu and
   p95gb2 across windows.
6. **costs:** take differences of rows in the same report that differ by one key, at scale 1. Prefer 3-pass
   reports, and mark single-pass deltas below §2's thresholds as noise.
7. **presets:** use the newest build's Auto rows and fixed-scale rows. Note the passes, and any verdict inside the
   adaptive margins.
8. Update `tools/lib/machine-profile.json`, including `sources`, `updated` and `data_up_to`. Keep every number traced
   to a report; use null when there is no data. Then update this file's header and tables.
