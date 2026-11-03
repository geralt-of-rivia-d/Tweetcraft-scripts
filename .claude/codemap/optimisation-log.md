# Optimisation log: shaders and benchmarking on this laptop (1.4.0 to 1.5.0-wip)

What was tried, what it measured, what the UHD 620 and ANGLE D3D11 taught us, and what to do next. Written
2026-11-03 from the handovers and reports. The numbers for each machine are in `machine-profile.md`. This file holds
the history and the lessons. Read sections 2 to 4 before any shader or bench work.

**Sources** (handovers are in `~/.claude/plans/shaders-team/`):
- [SH], [SH3], [SH4], [SH5], [LAB2], [BENCH], [BENCH3], [BENCH4]: the `handover-<name>.md` files.
- [LAB]: the LAB section of `handover-COMPAT-BO-LAB.md`. It used a synthetic world about 2.5× the title's
  geometry, at rd 8.
- [C]: `shaders-team/CONTRACTS.md`.
- [PLAN]: `plans/okay-here-s-some-feedback-modular-pretzel.md`.
- [P140]: `plans/i-need-you-to-sequential-plum.md`, the 1.4.0 plan, and commit `f7dde53`.

Reports are `reports/bench-*.json`. Unless a row says otherwise, numbers are med / p95gb in ms, uncapped, d3d11 and
1920×1080. **rd 8** marks the runs taken before the rd-12 standard.

## 1. Ledger

| # | What | Who / version | Measured effect | Verdict |
|---|---|---|---|---|
| 1 | Change-driven shadow redraws, no depth `getParameter`, back-face-culled depth-only opaque pass, DEPTH16, uniform cache (~80 → 8-25 calls/frame), allocation-free state, `textureLod` tent PCF, fog early-out, sky gating, pow chains | 1.4.0 [P140] | **Never measured on a real GPU**: no bench existed, only SwiftShader smoke. Afterwards the user reported High ≈ 40 FPS and Ultra ≈ 30 in game at rd 12 [PLAN]. Bench at rd 12: presets 15.1-15.3 / 18.7-27.3 (`bench-baseline-1.4.0-rd12`) | kept, but unmeasured |
| 2 | No back-face culling in the shadow pass (control) | LAB | +35-62% redraw cost [LAB] | confirms #1 |
| 3 | Unrolled 9-tap PCF (dead shadow code cost 3.3 ms through register pressure) | LAB → SH | −2.3 ms [LAB] | kept |
| 4 | Shadow lookup first in `shadeCode` | LAB → SH | −0.5 to −1.2 ms, same image [LAB] | kept |
| 5 | exp-free (cubic) tone curve | LAB → SH | about −0.5 ms, PSNR 45 dB [LAB]; −0.2 to −0.8 [SH] | kept |
| 6 | Scene FBO + dynamic resolution + composite | SH 1.5 | rc2 Auto rows 7.2-8.6 med at scale 0.66-0.78 vs 1.4.0's 13.0-13.4 (rd 8, `bench-sh-rc2`). At rd 12 it buys less (row 18) | kept |
| 7 | FBO at scale 1 | LAB | +0.6-0.8 ms [SH]; render-to-texture overhead ~0.6 [LAB] | bypass at s = 1 (kept) |
| 8 | Composite: copy 0.77 / 3-tap sharpen 0.8-0.9 / 5-tap CAS 1.6 / 1-tap sharp bilinear 0.6-0.78 ms | LAB | [LAB] | 3-tap kept, 1-tap at the floor kept, 5-tap rejected |
| 9 | Depth texture vs renderbuffer for the scene | LAB | no difference [LAB] | dead end |
| 10 | Shadows: 4096 map → two 2048 tiles (near ±24, far), leaves solid in the far tile | SH 1.5 | redraw 4096/±72 9.7 ms vs 2048/±72 3.7, near 2048/±24 1.8 (synthetic) [LAB]; solid leaves −14-18% per redraw | kept (High, Ultra) |
| 11 | Compiled-in two-tile select code | LAB | +0.5-1 ms per frame [LAB]; near tile 1-1.8 ms/frame [SH] | Medium uses a single map (kept) |
| 12 | Runtime program variants: no-shadow, per-filter, vanilla program on K | SH 1.5 | per-filter ~1.1 ms < the 1.5 ms bar; no-shadow free after the unroll; background compiles stalled SwiftShader smoke [SH] | removed (dead end) |
| 13 | AO polynomial, more terms in the VS, "pickOnce" matrix select, hoisting the sky alone, fog/grade early-outs | LAB / SH | no reliable gain [SH], [LAB] | dead ends |
| 14 | Sun step 0.17° → 0.25°, 10 s age net, exact remesh tracking (#51) | SH 1.5 | no isolated number. Correctness plus fewer redraws | kept |
| 15 | Double-buffered animation atlas (texSubImage3D stalls) | BENCH / lead | interleaved A/B/C: vanilla −0.07 pts (95% CI −0.9 to +0.7), 1.5 High −0.40 (−1.6 to +0.8). Causality is reversed: a long frame lets the 50 ms animation clock tick [PLAN] | rejected |
| 16 | GPU timer ring of 8 → 128 queries, polling up to 32 per frame | SH rc2 → rc3 | rc2 covered ~6% of frames, so the governor ran on stale data: scales too low, medium spread ~40% [SH], [BENCH] | fixed |
| 17 | Sky after terrain | LAB / SH | estimated −1.2 to −1.4 ms at 1080p; patched sky 1.65-1.8 ms vs vanilla 0.6-0.7 [LAB] | **open**, deferred to 1.6 |
| 18 | DRS at rd 12 (early 1.5) | BENCH3 | scale 1 → 0.9 saves only 0.5 ms; Auto sat at 0.62-0.70 with a ~10 ms median, far under the 14 ms limit (`bench-early-1.5-rd12*.json`) | led to SH4 |
| 19 | Governor: median of 16 same-scale samples instead of an α = 0.1 EMA | SH4 | High 0.70 → 0.88, Ultra 0.62 → 0.90 (`bench-sh4-gov1`) | kept |
| 20 | Governor: per-scale measured table, a + b·s² prediction, marks 12.7 / 12.0 ms uncapped and 14.2 / 13.5 ms capped (scaled with the cadence) | SH4 | High 1.0, Ultra 0.90; every Auto row p95gb ≤ 16.0 at repeat 1 (`bench-sh4-final2`); govsim5: 60 Hz High 0.62 → 1.00 | kept |
| 21 | **No `flat` varying**: one smooth `vec4 vTcP`, class rounded in the FS | SH4 (from LAB2) | off: GPU 7.52 (`bench-lab2-var-fsonly`) / 7.86 (`-var-sh-vs1`) → 5.18 (`-var-sh-vs3`), med 6.7 → 5.0; high@1 GPU 13.99 → 13.17. The gov1 numbers are in LAB2 §3's table only: that file was overwritten by a later run | **kept, the biggest single win** |
| 22 | Hoist `tcLm(0)` in the VS (vs1); drop only `vTcBlk` (vs2, a whole vec3) | SH4 | within noise; vs2 GPU 7.36 vs 7.52 (`-vs1`, `-vs2`) | dead ends |
| 23 | Far redraw keeps the light basis; near spare margin max(shadowMove, `NEAR_SPARE` 8) | SH4 | high-moving 216 → 120 redraws/min, 13.0/16.43 → 11.9/15.41; ultra-moving 367 → 120, 13.4/17.39 → 11.8/16.68 (`-sh-gov1` vs `-sh-sh3`) | kept (visual check #64 pending) |
| 24 | Near tile at 1024 (`NEAR_MAX`) | LAB2 | near redraw +2.10 → +0.54 GPU ms; p95gb −0.6 in one run, but redraw frames are ~3% of frames [LAB2] | not kept (visual call), **open** |
| 25 | Knobs at rd 12: filter, cascades, 1024-2048 map, water, waving, sky | LAB2 | each ≤ 0.4 ms, i.e. noise; shadowSize 4096 +0.6 med and **p95gb +11** (`bench-lab2-breakdown-rd12`) | no knob is worth turning; avoid 4096 |
| 26 | Shadow caster culling against the view frustum | SH | not needed after #10 [SH] | not done |
| 27 | No-timer governor fallback: refresh-interval estimate (30/50 Hz caps) | SH3 | govsim4: no-timer 30 Hz 0.60 → 1.00 | kept (simulation only) |
| 28 | Governor under vsync: skip `GOV_SETTLE` 4 frames after a change, 16 samples to undo a raise, timed backoff (`GOV_UNDO_MS` 4 s), no 0.95 step, capped drops need 2 real misses and go at most 0.1 down | SH5 (v3 → v7, Shaders 1.5.0; review rounds v8-v9 = #33) | 60 Hz vsync: changes/min ~36-45 → 3-6; High miss% 0.42 → 0.17, mean scale 0.91 → 0.994; Ultra 0.95 → 0.994 (details below) [SH5 §2] | kept; acceptance passed (`bench-final-1.5-v9`) |
| 29 | `mediump` | plan step 3 | never measured | open, likely nothing (ANGLE on D3D11 usually runs it as 32-bit [PLAN]) |
| 30 | Governor: a capped over-mark drop on **one** real miss, with the full 0.25 search | SH5 v4 | a stray miss dropped 0.85 → 0.6 at once (the over-reading GPU time predicted every scale over budget) [SH5 §2] | dead end → two misses within 2 s, at most 0.1 down (#28) |
| 31 | Governor: 16 samples for **every** over-mark drop (not just after a raise) | SH5 govsim | govsim's start-up transient case 0.88 → 0.82: the first drop comes too late [SH5 §2] | dead end → 16 only after a raise (#28) |
| 32 | Governor: 8-sample medians for a drop right after a raise (pre-SH5 rule) | SH4 → SH5 | under vsync the median of the first 8 read 14.2-14.7 while the stretch's median was ~12.5-13, so drops came ~0.5 s after each raise [SH5 §1] | replaced (#28) |
| 33 | Governor review rounds (v8 and v9, after SH5's v7): capped drops need both real misses after the last scale change; the capped blind one-step drop is gated by `govHelps` (skipped when a fresh measurement shows the step down is not 0.3 ms cheaper, or the scale above not 0.3 ms costlier); `govReset` sets the settle frame too; v9: capped, the "staying" raise in the over-mark branch needs the scale above to measure no costlier at all (was +0.25 ms), a 0.3 ms dead band against `govHelps` | lead's review | govsim vs SH5's v-final: 78 of 79 cases identical, 1 not worse (v8 and v9); test-load 90/0 (v8). Not a speed change: it stops one pair of misses causing two drops, and a draw-bound frame ratcheting down to `renderScaleMin` (or cycling 1.0 ↔ 0.9) | kept |

**SH5: the frame-time tail and governor hunting under vsync** (Shaders 1.5.0; only `govern` and its helpers changed,
no GLSL, preset, SCHEMA or API change; `scripts.md` §2 has the rules with line numbers, issue #60 is fixed):
- **The tail wasn't real.** Uncapped, 50-62% of the p95gb tail frames were the interval right after an excluded CPU
  spike: rAF timestamps lag one frame under backpressure, so the stall shows up again in the next interval (vanilla
  too: 67% of its after-spike frames are in its tail). Excluding those as well (**p95gb2**): high@1 19.1 → 16.6,
  high Auto 17.95 → 15.85, ultra Auto 17.8 → 15.8, ultra-moving 17.6 → 15.3, vanilla 7.40 → 7.13 (p95gbWall
  15.3-16.8). Shadow redraws are 1-10 of ~65 tail frames, scale changes 0-3. Under real 60 Hz vsync the base build
  missed 0.00-0.42% of frames (> 20 ms). The pre-fix metric was unreachable: uncapped High Auto would have needed ~0.75.
  The lead and BENCH4 adopted p95gb2 and `--vsync` (miss%, changes/min).
- **The real problem was hunting under vsync**: 36-45 scale changes/min in a 0.85-0.9-0.95-1 sawtooth, plus one drop
  to 0.6. Causes: (1) drops decided on the first 8 samples after a raise read high (#32); (2) DVFS: with slack the
  UHD 620 clocks down until the frame nearly fills the refresh, so High at 1.0 read 12.7-14.8 GPU ms with 0 misses and
  the capped marks (14.2 / 13.5) and the predictions over-read the load; (3) 0.95 measured the same as 1.0 every time
  (13.14/13.2, 12.93/12.95, 14.41/14.7 ms), a dead step.
- **Tried, v3 → v9:** v3 added the timed backoff (changes/min 36-45 → 6-10); v4 tried a capped drop on one real miss
  with the 0.25 search (#30, dead end); v7 is the shipped set (#28): the settle skip, 16 samples after a raise, the
  timed backoff, no 0.95 step in Auto, and capped drops that need two real misses within 2 s and go at most 0.1 down.
  **v8 and v9, the lead's review rounds** (#33). v8: both real misses must fall after the last scale change; the capped blind
  one-step drop runs only if `govHelps` allows it; `govReset` also sets `GOV.cf`, so the settle skip covers a reset;
  and the 16-sample rule's hold for the first drop after load or a reset (`lastRaise = lastChange = -1e9`) is now
  documented as deliberate (govsim's start-up case did better). **v9**, the last change: capped, the "staying" raise in
  the over-mark branch needs the scale above to measure no costlier at all (`tg[ku] <= gpu + (capped ? 0 : 0.25)`),
  a 0.3 ms dead band against `govHelps`' blind drop, so the two can't take turns in a 1.0 ↔ 0.9 cycle. Expected: a
  draw-bound frame at 1.0 with steady real misses re-tries 0.9 about every 30 s, once 0.9's reading ages out.
  govsim against v7 (for v8 and for v9): 78 of 79 identical, 1 not worse.
  The vsync table below is v7's; the acceptance run is on the final copy.
  A 6.7% miss burst in v3's high-moving row (at every scale, GPU 11-13 ms) didn't reproduce; off has no such bursts,
  so it was most likely a compositor or system event.
- **Measured, 60 Hz vsync, base → v7** (40 s rows, base 20 s; miss% / mean scale / changes per min):

  | Row | base | v7 |
  |---|---|---|
  | off | 0.00 / 1 / 0 | 0.00 / 1 / 0 |
  | high | 0.42 / 0.91 / ~39 | 0.17 / 0.994 / 3.0 |
  | ultra | 0.00 / 0.95 / ~36 | 0.17 / 0.994 / 3.0 |
  | high-moving | n/a | 0.00 / 1.000 / 0 |
  | ultra-moving | 0.00 / 0.87 / ~45 | 0.59 / 0.985 / 6.0 (one real overload episode at ~31 s, plus one 167 ms game hitch) |

  The misses left at 1.0 are our GPU load near the limit (fixed ultra@1-moving 1.39%, clustered with the GPU at
  13-15 ms; off 0.00-0.04%).
- **Uncapped v7** (`bench-sh5-v7`, repeat 1) is the "Where 1.5.0-wip stands" table below. Uncapped High can settle at
  0.85 (base behaviour, `scripts.md` issue #65).
- **govsim5** (79 cases, base vs final): 41 identical, 37 better or equal, 1 lower (timer 30 Hz, rd 12 High with a
  +6 ms start-up transient, 0.903 → 0.896, because the simulator models 0.95 as cheaper than 1.0, which no real
  measurement showed). Start-up transient 0.867 → 0.92 uncapped and 0.881 → 0.92 at 60 Hz. No case has more misses.
- **Lessons:** DVFS under vsync makes GPU time over-read the load, so capped marks and predictions alone can't
  justify a drop: require real misses. Judge a governor on a real `--vsync` trace (changes/min, miss%), not on
  govsim, which has no DVFS and no stray misses. Validate a tail metric on vanilla before chasing it (§3.2).
- **Acceptance (final-1.5), v9, 2026-11-03: passed** (`bench-final-1.5-v9.json` + `-vsync.json`, `--protocol accept`,
  preflight calibration ok at vanilla 4.40). Uncapped med / p95gb2 / scale: low 10.1 / 13.38 / 1.00, medium 11.3 /
  13.80 / 0.90, high 10.4 / 13.86 / 0.85, ultra 12.3 / 15.20 / 1.00, high-moving 11.6 / 15.50 / 0.90, ultra-moving
  11.7 / 15.00 / 0.90. Native (renderScale=1) med 10.3 / 12.0 / 12.2 / 12.5 against 1.4.0's 15.1 / 15.1 / 15.3 / 15.3.
  1% low on Auto beats 1.4.0 on every preset (medium 15.4 → 18.3, high 16.2 → 19.6, ultra 16.0 → 19.7). Vsync (30 s x 2):
  every row holds 60; miss% 0.00-0.06, 0 hitches > 50 ms on Auto rows, **scale changes/min 0-3** (base build 36-45),
  mean scale 0.97-1.00.
  Secondary rows (`bench-final-1.5-v9-secondary`, screen, 1 pass): every row holds 60 uncapped, p95gb2 11.90-15.17;
  high/ultra med rd 8 10.5/10.6, rd 10 12.4/12.1, FOV 70 11.8/11.8, FOV 110 11.4/11.5, within noise of `bench-sh5-secondary`.

**Where 1.5.0-wip stands** at rd 12 / FOV 80 (`bench-sh5-v7`, repeat 1, uncapped; med / p95gb2 / scale):

| Preset | med | p95gb2 | scale |
|---|---|---|---|
| low | 10.4 | 13.73 | 1.0 |
| medium | 12.1 | 16.86 | 1.0 |
| high | 11.0 | 14.45 | 0.85 |
| ultra | 12.0 | 15.30 | 0.94 |

Medium at repeat 3 gives 11.5 / 15.10 at 0.89 (`bench-sh5-medium`). Against 1.4.0's 15.1-15.3 median that is about
−3 to −5 ms, and native beats 1.4.0 by 2.4-4.4 ms (`bench-final-1.5-native`). The acceptance run under the p95gb2 and
vsync criteria passed on v9: see the SH5 entry above.

## 2. How this GPU and driver behave

**Where the cost is (rd 12, High at scale 1, GPU ms)** [LAB2 §2, `bench-lab2-breakdown-rd12` / `-rd8`; before
the flat fix]:

| Layer | Cost at rd 12 | Type | rd 8 → rd 12 |
|---|---|---|---|
| vanilla | 5.2 | geometry + pixels | +1.34 |
| idle-patch tax (off − vanilla) | +3.0 (+0.3-0.5 after #21) | **per primitive** | +1.08 → +3.04 |
| effects without shadows (low − off) | +4.2 to 4.3 | per pixel | flat (+4.48 → +4.31) |
| shadow lookup (high − low) | +1.8 to 1.9 | per pixel | flat (+1.60 → +1.79) |

- **At rd 12 most of the frame is not pixels.** A forced-scale sweep fits about 8.6 ms fixed plus about 4.4 ms of
  pixel work at s = 1. Going from 1.0 to 0.6 saves only ~2.8 ms [LAB2 §4].
  - At rd 8 / 1.4.0 the opposite looked true: 540p cut the script's cost from +9.5 to +2.3 ms (`bench-size-540`,
    [BENCH]).
  - **The render distance decides which conclusion holds.**
- Draws grow 213 → 401 per frame from rd 8 to rd 12, and VAOs 590 → 1139 [LAB2]. Anything per draw, per vertex or
  per primitive scales with this.
- **A `flat` varying costs 2.3-3 GPU ms at rd 12** (1.1 at rd 8).
  - The cause is most likely ANGLE D3D11's provoking-vertex geometry-shader emulation: a per-primitive cost on every
    terrain draw [LAB2 §3].
  - The varying *count* doesn't matter: removing a whole vec3 gained nothing.
  - So: never write `flat ` in terrain GLSL, not even in a comment; smoke enforces `max: 0` [C §C7].
- **The JS hooks are free.** All of them with the game's GLSL equals vanilla (`-var-origsrc`). 74% of main-thread
  time is native GL calls (drawElements, uniform3f, bindVertexArray), which is GPU backpressure; our JS is 1.7%
  [BENCH §c].
- **Compiled-in code costs even when a branch skips it.**
  - Dead shadow code cost 3.3 ms through register pressure [LAB].
  - Two-tile selection costs 0.5-1 ms [LAB].
  - The off-vs-vanilla residual is register allocation [SH].
  - Measure the size of a code path, not only whether it runs.
- **ANGLE D3D11 sampling.** `texture()` on a shadow sampler becomes a gradient SampleCmp, which flattens the branches
  around it, so use `textureLod` [P140]. `textureLod(sampler2DShadow)` compiles to SampleCmp, not LevelZero [LAB].
- **The composite has a fixed cost of ~0.6 ms**, so 0.95 composited costs the same as 1.0 direct. Auto has no 0.95
  step [LAB2 §4], [SH5].
- **Shadow redraws:**
  - near +2.0 GPU ms at 2048 (+0.5 at 1024; raster-bound), far +2.0-2.3. These come from LAB2's scratch traces,
    not from a report [LAB2 §5];
  - synthetic: 2048 1.8-4.4 ms, 4096 5.3-9.7 ms by extent [LAB];
  - redraw frames are ~3% of frames and ~13% of the tail. Removing them all would move p95gb by only 0.2 ms;
  - real play causes ~60-90 redraws/min walking and ~300 sprint-flying on High (`tools/bench.mjs` header).
- **External GPU spikes.** Bursts of 2-5 samples at 20-37 ms come every 0.5-1 s, in vanilla too: 2.5% of frames are
  above 1.7× the median. They don't follow the callbacks (corr(cb, gpu) = 0.04). An EMA or a mean gets dragged by
  them; **use medians** [LAB2 §4]. F2's `perf.gpuMs` is still a mean (#61).
- **DVFS under a cap.** With slack, the UHD 620 clocks down until the frame nearly fills the refresh.
  - The same work reads ~1.5 GPU ms more under 60 Hz: High at 1.0 reads 14.42 capped vs 12.92 uncapped. This is LAB2 scratch sweep data, not a report [LAB2 §4].
  - SH5 saw 12.7-14.8 at 1.0 with 0 misses, so the capped marks and the predictions over-read the load. That is why
    a capped drop needs two real misses since SH5 (#28).
  - Never tune capped thresholds on uncapped numbers.
- **Timer queries.**
  - TIME_ELAPSED works on d3d11, gl and vulkan without a flag. TIMESTAMP_EXT has 0 bits.
  - Results arrive **0.25-1.5 s late**, so the ring must be deep (128) and samples tagged with their scale [BENCH],
    [SH].
  - The bench's own GPU ms spans waits: treat it as an upper bound.
- **rAF timestamps lag one frame under backpressure.** Intervals pair up (e.g. 4.6 + 17.9 ms), and a JS spike's stall
  reappears in the *next* interval.
  - That was 50-62% of the p95gb tail, in vanilla too. Hence **p95gb2** [SH5 §1].
  - Wall-clock intervals don't show it. Under backpressure, JS ms includes GL blocking, so read GPU ms for
    GPU-bound rows [BENCH §e].
- **Under real 60 Hz vsync the "spikes" almost vanish**: 0-1 per row against 124-156 uncapped, because they were
  callbacks inflated by backpressure. Frames over 20 ms: 0-0.42% on the same build [SH5]. Uncapped tails overstate
  what a player sees.
- **The game's own frame noise.**
  - Vanilla has 2-5% long callbacks (cause still unknown) and a 1% low of about 13.6 FPS on the title screen
    [PLAN]. 1% low is not a usable metric.
  - Meshing is synchronous wasm, up to 5 ms per frame while moving, and DRS can't fix CPU-bound frames [C §C5].
- **Backends.** gl and vulkan deliver frames in bunches: high on gl has a 3.8 ms median but 815 ms stalls
  (`bench-angle-gl`, `-vulkan`). Their medians are meaningless; optimise and accept on d3d11 only [BENCH].
- **Thermals.** After hours of GPU load the laptop throttles: vanilla median spread 62% (`bench-sh2-a-final`).
  Cool, the vanilla median is 4.5 in every pass at rd 12 (`bench-baseline-1.4.0-rd12`).
  - On 2026-11-03 every pass the guard flagged had background CPU load (sysCpu ≥ 58%), not GPU heat.
  - Vanilla at rd 12 stayed at 4.4-5.0 from 11:00 to 16:15 with no trend (analyst-data, `machine-profile.md`).
- **Settings that change nothing.** CDP fullscreen and the 1920×1080 window give the same canvas and timings
  [BENCH3 §3]. Held light is inert on the title screen (`uHeldN` = 0).

## 3. Benchmarking mistakes that cost time, and the rule that prevents each

1. **Wrong settings: rd 8 / FOV 70 instead of the user's rd 12 / FOV 80.**
   - Every 1.5 number before 2026-11-03 was taken at rd 8, about half the terrain. The user's 40/30 FPS report was
     at rd 12 [PLAN].
   - The conclusions flipped: "fragment-bound" became "two-thirds fixed". The governor tuned at rd 8 then
     over-shrank to 0.62-0.70 at rd 12 [BENCH3 §5].
   - **Rule:** ask for the user's real settings before the first bench. The bench now defaults to `--rd 12 --fov 80`
     and checks `row.view` live. `--compare` WARNs on rd/FOV mismatch.
2. **Metric artefact: p95gb counted the after-spike interval.**
   - SH4's "fix the tail" work chased a tail that is absent under vsync [SH5].
   - **Rule:** before optimising for a metric, check it on vanilla, on `--raw` frames and under `--vsync`. A tail
     must exist at 60 Hz to matter.
3. **Thermally throttled pass.** `sh2-a-final` (vanilla spread 62%) was nearly read as a result [PLAN history].
   - **Rule:** decisions use `--repeat 3 --cooldown 60 --guard`. Discard passes marked UNRELIABLE, and check that
     vanilla sits in its usual range.
4. **Contaminated runs.**
   - `bench-trial1` / `diag-*` ran on SH's working copy mid-edit, without alignment [BENCH].
   - `bench3-verify` / `fs-window` ran while COMPAT3's SwiftShader smokes did: vanilla 5.8-8.5, sysCpu up to 100%
     [BENCH3].
   - `sh4-sh7`'s renderScale=1 rows had 51-84% system CPU from outside the queue [SH4]. They read +1.8 to +2.6 ms
     median vs `sh4-sh7b`, while vanilla matched (4.7 in both). **Vanilla does not always reveal contamination of
     the heavy rows.**
   - `final-1.5` and `final-1.5-native` pass 1 ran during the lead's CPU-heavy govsim: vanilla p95gb +28/30%
     [BENCH3 §8].
   - **The GPU lock only serialises browsers, not CPU-heavy node work.**
   - **Rule:** bench a pinned `--script` copy; no govsim, smoke or builds during a bench; read `sysCpuPct`. A
     preflight check is due.
5. **Uncalibrated stress scenario.**
   - The old `-moving` forced a redraw every 4 frames: 1000-1470 redraws/min (`bench-sh-rc3`, `sh2-a-final`).
     Real play is ~60-300.
   - It overstated moving cost several times over and was renamed `-stress`.
   - **Rule:** calibrate synthetic load against real-play counts before trusting it. Old `-moving` rows aren't
     comparable.
6. **Repeat-1 verdicts.**
   - On the same v-final2 build, repeat 1 passed every Auto row at p95gb ≤ 16.0 (`bench-sh4-final2`), while repeat 3
     failed with medium, high, ultra and the moving rows at 17.3-18.2 (`bench-final-1.5`).
   - Low, medium, high and ultra went from 15.2 / 15.6 / 15.5 / 16.0 to 16.4 / 17.7 / 17.8 / 17.8, a Δ of
     1.2-2.6 ms. The medians differ by only 0.1-0.7 ms, because the governor landed at 1.0 in one run and 0.9 in the
     other (analyst-data).
   - v7 medium read 16.86 at repeat 1 and 15.10 at repeat 3 (`bench-sh5-medium`).
   - Single-row noise is about ±0.4 ms median and up to ±1 ms p95gb [LAB2]. Synthetic LAB noise is 5-30%, so only
     effects over ~10% show [LAB].
   - **Rule:** screen on repeat 1, decide and accept only on repeat 3. Don't declare "pass" from a screen.
7. **GPU timer coverage not checked.** rc2's ring of 8 joined ~6% of frames, so its rows fell back to
   `gpuSource: script mean` with the plain spike rule [BENCH].
   - **Rule:** check `gpuSource` = "script per frame" and `gpuFrames` ≈ `frames` before reading GPU ms or p95gb.
8. **A vsync sample that was too short.** At 8 s one frame is 0.21 pp of miss%, and `bench4-vsync-check` failed by
   0.05 pp [BENCH4 §3].
   - **Rule:** use `--seconds 20` or more for vsync verdicts. The guard can't see throttling under vsync, so run it on
     an uncapped pass.
9. **Unaligned or invalid views.**
   - The first 1.4.0 baseline measured rows at different yaws (`-unaligned`, fixed by `--at 40`).
   - `--start-fullscreen` gave 1904×985 (`bench3-fs-full`, invalid) [BENCH3].
   - **Rule:** check that the canvas is 1920×1080 at DPR 1 and that the yaw aligns in every new report.
10. **Emulated caps.** setTimeout pacing gave 16-19% misses even at 0.6, and the improved spin emulation still has a
    6-8% harness floor [LAB2 §6].
    - **Rule:** judge 60 Hz behaviour on a real `--vsync` run, never on an emulated cap.
11. **The spike rule.** The plain "callback ≥ 12 ms" rule flagged 44-45% of GPU-bound frames as spikes; the rule with
    GPU time flags 19-22% (`bench-diag-1.4.0-raw`) [BENCH].
    - **Rule:** keep the spike rule that uses GPU time, and check `spikeRule` on each row.
12. **n/a and missing baseline rows.**
    - `-moving` is n/a on 1.4.0 (it has no `stress()`). `renderScale=1` rows show "no baseline row" and had to be
      compared by hand [BENCH3 §8b].
    - "No frames were recorded" happened twice as a transient [SH4], [LAB2].
    - **Rule:** plan the baseline's rows to match the candidate's, and re-run errored rows before reading the table.
13. **Measuring the wrong place.**
    - The bench is the title screen only: no walking, no meshing, no in-world geometry.
    - 1.4.0 High at rd 12 benches at a 15.3 ms median (~65 FPS uncapped), yet the user saw ~40 in game.
    - **Rule:** treat title-screen numbers as a lower bound on in-world cost, and confirm in game (F2, the in-game
      "Run benchmark").

## 4. Dead ends: don't retry

- **Double-buffered animation atlas / texSubImage3D dedupe.** It has no causal effect on slow frames; the
  correlation is reversed (#15).
- **Runtime program specialisation** (per filter, no-shadow, vanilla program on K):
  - it saves ~1.1 ms, under the 1.5 ms bar;
  - background compiles stall SwiftShader smoke;
  - no-shadow is already free after the unroll (#12).
- **5-tap CAS sharpen.** It costs 1.6 ms against 0.8-0.9 for 3-tap (#8).
- **Depth texture vs renderbuffer, AO polynomial, more terms in the VS, matrix "pickOnce", hoisting the sky alone,
  fog/grade early-outs, the `tcLm(0)` VS hoist.** All within noise (#9, #13, #22).
- **Cutting varyings by count.** Removing a vec3 gains nothing. Only the `flat` qualifier mattered (#22).
- **Tuning shadow knobs at rd 12** (filter, cascades, 1024-2048, water, waving, sky). Each is ≤ 0.4 ms (#25).
- **4096 shadow maps.** They add +11 ms of p95gb (#25).
- **EMA or mean GPU time for the governor**, and an s²-only pixel model. External spikes drag the EMA, and at rd 12
  only ~1/3 of the GPU time is pixels (#19).
- **A 0.95 render scale.** The composite eats the saving (§2). Auto skips it since SH5 (#28).
- **Governor drops on thin evidence** (SH5): an 8-sample median right after a raise (#32), a capped drop on a single
  real miss with the 0.25 search (#30), and, the other way, 16 samples for every drop (#31, slows the start-up case).
  Under vsync, don't drop on GPU time alone (DVFS over-reads it).
- **gl or vulkan backends for acceptance.** They pace frames in bunches (§2).
- **"1% low within 10% of vanilla" as a criterion.** It is set by the game's own JS bursts, so every build failed it.
  It was dropped on 2026-11-02 [PLAN step 4].

## 5. Open questions and the next likely wins (ranked by expected ms per effort)

1. **Sky after terrain** (1.6 carry-over). LAB estimated −1.2 to −1.4 ms at 1080p: patched sky 1.65-1.8 ms vs
   vanilla 0.6-0.7 [LAB].
   - It is per pixel, so it adds to the DRS headroom.
   - Effort is medium-high: the sun and moon are two draws of one sprite program with per-draw uniforms, so they need
     uniform record and replay, and the replay must come before blended particles [SH (a)4].
   - It is the largest measured, unbanked win, and it pays for 1.6 effects.
2. **Open up the +4.2 ms "effects" bucket at rd 12** (low − off; the largest remaining layer).
   - Only water, waving and sky were ablated, each ≤ 0.4 ms.
   - Interpolation plus derivatives cost ~1.1 ms on the synthetic world [LAB]. The rest is not attributed.
   - Next: per-term `fsDebug` ablation builds (SH has the `mk-ablate` approach), run at rd 12 and repeat 3.
   - Expected: unknown, possibly 1-2 ms. Low effort to measure.
3. **Shadow lookup, +1.8-1.9 ms per pixel.** The filter choice is ≤ 0.3 ms, so the cost is the lookup and two-tile
   select code itself (0.5-1 ms compiled-in [LAB]). Try a cheaper tile select or a single projection path. Expected
   0.5-1 ms, medium effort.
4. **Near tile at 1024** (#24). −1.6 GPU ms per near-redraw frame, but those are ~3% of frames, so p95gb moves by
   −0.2 to −0.6. Low effort; it's a visual call (≈ 18 vs 37 texels per block).
5. **An in-world bench scenario** (walking with meshing). It saves no ms by itself, but closes the 65-vs-40 FPS gap
   in §3.13, which could reorder everything above. Also open: the cause of vanilla's 2-5% long callbacks. The next
   lead is a CPU/GPU-process trace [PLAN].
6. **The remaining off tax** (off 4.9-5.0 vs vanilla 4.4-4.7, i.e. 0.3-0.5 ms; `bench-sh4-final2`, `-sh5-v7`).
   Register allocation of the big program, so it's small and hard.
7. **`mediump`.** Never measured, and likely 0 on D3D11. Measure it once if it's cheap to try.
8. **In-game confirmations still owed.**
   - Governor at real 60 Hz and 30 Hz (Energy Saver): #60 (hunting) is fixed by SH5 on the vsync traces; in game,
     watch `debug().governor` drops/raises and expect about 0-3 changes/min at 0.98-1.0. Still open: #62 (`rf` stuck
     at 30 Hz).
   - F2 reading a mean (#61).
   - `NEAR_SPARE` softness (#64).
   - The 1.5 repeat-3 acceptance, uncapped and vsync (BENCH4 §5).

**The budget for 1.6/1.7.** At rd 12, High Auto runs at about 11-12 ms median uncapped, with p95gb2 of 14.5-16 and
vsync miss% ≤ 0.6 [SH5]. That leaves roughly 2-3 ms of median headroom to the 14 ms mark, before DRS. Every 1.6
effect needs an on/off row at rd 12. Sky after terrain is the only known way to create more room.

## 6. Process lessons (where sessions lost the most time)

1. **The acceptance criteria changed three times mid-flight.**
   - 2026-11-02: the "1% low" rule was dropped.
   - 2026-11-03: the rd-12 standard arrived.
   - 2026-11-03: p95gb2, the vsync miss% and the scale-changes/min criteria.
   - Each change invalidated finished work. SH4's tail work, and then the acceptance runs, were judged under a metric
     that was replaced the same afternoon [PLAN step 4], [BENCH3 §8], [SH5].
   - **Fix up front:** settle the settings (ask the user), the backend, the metric (validated on vanilla, `--raw` and
     `--vsync`) and the exact acceptance commands *before* the first optimisation, and write them into the plan.
2. **The standard was found late.** A whole session of rd-8 numbers had to be retaken.
   - **Fix:** step 0 of any perf plan records the user's real settings and display (rd, FOV, fullscreen, refresh
     rate, Energy Saver), and benches there first.
3. **1.4.0 shipped "faster shaders" without a real-GPU measurement**, and the user's report then set off 1.5.
   - **Fix:** no perf claim without a bench row, even a repeat-1 screen.
4. **GPU-lock wall time.**
   - A `--repeat 3` × 14-scenario run holds the GPU for ~40 min and blocks every smoke and probe [BENCH].
   - Acceptance is about 30 min uncapped plus 35 min vsync plus 12 min secondary [BENCH3 §6], [BENCH4 §5].
   - Agents queued chains of runs (`chain*.sh`) and waited on each other.
   - **Fix:** a short screen protocol for iteration, the full protocol only for acceptance, and paired or
     interleaved A/B inside one run. Keep CPU work (govsim, docs, compat) off the machine during GPU runs, not just
     other browsers.
5. **Shared working tree.** Benches picked up teammates' half-edited files, and check and smoke saw unfinished files
   too [C §C0].
   - **Fix:** always bench a pinned copy (`--script <scratch>/v-x.user.js`) and record its hash. Run acceptance only
     on a frozen tree.
6. **Agent churn and lost tooling.**
   - SH → SH3 → SH4 → SH5 and BENCH → BENCH3 → BENCH4 handed over at the 250k-token limit [PLAN].
   - The most useful analysis tools lived in session scratchpads and are now gone or stranded: `burst.mjs`,
     `texup.mjs`, `profile.mjs`, `gov.mjs`, `tiles.mjs`, `trace.mjs`, `tran.mjs`, `verify-p95gb2.mjs`, `table.mjs`,
     `govsim*.mjs`.
   - **Fix:** promote reusable ones into `tools/`, as bench `--raw` / `tailStats` and `bench-history` started to.
     Copy anything durable to `plans/shaders-team/` before a pause.
7. **Simulators are necessary but not enough.**
   - govsim (which extracts `govern()` verbatim) caught a 50 Hz runaway and the 30 Hz floor.
   - But it has no DVFS and no stray misses, so the vsync hunting (36-45 changes/min) only showed on real traces
     [SH5 §3].
   - **Fix:** sim to screen, then one real `--vsync` trace before accepting.
8. **Interrupted runs leave half-states.**
   - SH5's handover is a draft: its secondary section is the literal `SECONDARY_PLACEHOLDER`, and check, smoke,
     test-load and govsim were not run on the final copy.
   - `bench-sh5-secondary` ends in an errored row, and a stale GPU lock was left behind.
   - Orphaned processes couldn't be stopped (permission) [SH], [LAB2].
   - **Fix:** write the handover before a long run starts, and resume by re-running the gates on the exact copy.
9. **Correlation traps.** texSubImage3D in long frames, redraws in the tail and GPU spikes vs callbacks all looked
   causal and weren't. The A/B/C interleave with confidence intervals settled it [PLAN].
   - **Fix:** a causal A/B (interleaved, with a CI) before building anything on a correlation.
