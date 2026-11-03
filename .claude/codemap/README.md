# Codemap

How this repo is laid out, how the pieces relate, and where new things go. Detailed maps:

| Map | Covers |
|---|---|
| [scripts.md](scripts.md) | Our four userscripts, function by function: hooks, globals, storage, cross-script contracts, known issues |
| [game-core.md](game-core.md) | The game: modules, boot sequence, main loop, state, world data, networking, storage keys |
| [game-rendering.md](game-rendering.md) | The game's WebGL2 renderer: frame passes, the 18 shader programs, chunk meshes, lighting, texture units |
| [game-ui.md](game-ui.md) | The game's screens and menus, CSS units and font, canvas HUD, input and keys |
| [machine-profile.md](machine-profile.md) | This laptop as a bench machine: vanilla range, noise floor, thermal behaviour, bench protocols, cost of each feature and preset, first guesses. Its data is `tools/lib/machine-profile.json` |
| [optimisation-log.md](optimisation-log.md) | Every past shader optimisation and bench decision: what was tried, what it gained, the dead ends, process lessons |

Read the last two before any bench (see "Benchmark smart" in the `tweetcraft-shaders` skill).

The maps name the game build they were verified against in their first lines. `npm run check` warns when that isn't
the latest snapshot's build. `npm run snapshot` (and the CI issue) lists which maps mention the files that changed.
Re-verify those sections (see the `tweetcraft-game-update` skill), then update the build id. Code beats maps: if
they disagree, fix the map.

## Repo layout

```
.
├── *.js                         userscripts (one self-contained file each, repo root; new ones: *.user.js)
│   ├── twitterentary-shaders.user.js   WebGL2/GLSL patching: shadows, waving plants, water, sky
│   ├── tweetcraft-better-options.js    options menu + settings bus window.__tcOptions + HUD/UI scale
│   ├── tweetcraft-zoom.user.js         hold-to-zoom (FOV via Better Options' fov API)
│   └── tweetcraft-chat-history.js      Up/Down chat recall
├── compat/expectations.mjs      what every script needs from the game (source / runtime / shaders checks)
├── tools/                       Node tooling (no build step)
│   ├── snapshot.mjs             fetch game → game/<target>/<time>-<build>/ + change report
│   ├── check.mjs                metadata/syntax + `source` expectations vs latest snapshot (offline)
│   ├── smoke.mjs                live game in headless Chrome + `runtime`/`shaders` expectations
│   ├── probe.mjs                evaluate an expression in the live game, print JSON
│   ├── bench.mjs                real-GPU benchmark: headed, uncapped 1920×1080 Chrome, scenarios → table + reports/bench-*.json
│   ├── bench-history.mjs        one table of every saved bench report (npm run bench:history)
│   ├── cloud.mjs                check/smoke in GitHub Actions on the working tree via a throwaway ci/* branch; minutes; status
│   ├── dev-loaders.mjs          Tampermonkey dev loaders → dev/
│   └── lib/
│       ├── common.mjs           paths, TARGETS (prod/staging), userscript discovery + metadata parsing, output
│       ├── game.mjs             crawler: HTML/CSS/ES-module graph, acorn import/export analysis
│       ├── browser.mjs          Chrome launch (SwiftShader by default, real GPU via ANGLE with gpu:true), shader-program recorder, openGame, labelProgram
│       ├── gpu-lock.mjs         one real-GPU browser at a time: reports/.gpu.lock vs reports/.sw-<pid>.lock (used by launchBrowser)
│       ├── bench-profile.mjs    reads machine-profile.json: --protocol values, noise, vanilla ranges (built-in fallbacks)
│       ├── bench-preflight.mjs  machine checks before a real-GPU bench: AC power, power plan, background CPU, GPU lock, display
│       ├── bench-report.mjs     shared reading of bench reports: holds-60 verdicts, settings, script versions
│       ├── machine-profile.json data: this laptop's bench profile, regenerated from reports/bench-*.json (see machine-profile.md)
│       ├── github.mjs           read-only (GET) GitHub REST via fetch, token from this repo's Git Credential Manager (never gh auth)
│       └── userscript-env.mjs   Tampermonkey emulation (frames/@match, document-start timing, GM_* shims)
├── .github/workflows/game-watch.yml   daily + push/PR + ci/* pushes: snapshot → check → smoke for prod and staging;
│                                      notify: issue per new game build; upstream: issue on new AndresTube commits
├── .claude/                     agent instructions: CLAUDE.md, rules/, skills/, agents/, hooks/, codemap/
├── README.md                    user-facing: scripts list + development quick start
├── game/      (gitignored)      local snapshots of the game's code; never commit
├── reports/   (gitignored)      smoke JSON + screenshots, change reports (changes-<target>.md/.diff), bench-*.json, GPU locks,
│                                cloud/<run-id>/ (artifacts of npm run cloud runs)
└── dev/       (gitignored)      generated Tampermonkey dev loaders
```

## How the pieces relate

```
              ┌──────────────────── tweetcraft.jai.vin (prod) / staging ────────────────────┐
              │  index.html → /js/main.js → ~100 ES modules (gfx.js, menus.js, ui.js, ...)   │
              └───────▲───────────────────────▲──────────────────────────────▲──────────────┘
     fetch HTML/CSS/JS│        headless Chrome │ (userscripts injected)       │ Tampermonkey (real use)
                      │                        │                              │
   tools/snapshot.mjs ┘        tools/smoke.mjs ┤ tools/probe.mjs              │  *.js userscripts
          │                            │       │                              │   (dev/ loaders @require them)
          ▼                            ▼       ▼                              │
   game/<target>/<snap>/   compat/expectations.mjs  ◄── tools/check.mjs ──────┘ (metadata + syntax)
   raw/ pretty/ shaders/     source  → check.mjs (vs snapshot)
   manifest.json             runtime → smoke.mjs (in page)
   changes.diff              shaders → smoke.mjs (linked programs)
```

`tools/cloud.mjs` runs the same check and smoke in GitHub Actions instead of on this laptop: it commits the working tree from a temporary index onto a throwaway `ci/<slug>-<time>` branch, whose commit message tells `game-watch.yml` which target and steps to run, then collects the per-step results and the `report-*` artifacts into `reports/cloud/<run-id>/` and deletes the branch. Smoke uses SwiftShader in both places, so the results match. `notify` runs only on main, so `ci/*` runs never open issues.

`tools/bench.mjs` loads the game and the userscripts the way smoke does (the working copy, or `--ref <git-ref>`), but in a headed, uncapped Chrome on the real GPU (`launchBrowser({ gpu: true })`). It measures frame times per scenario. While it holds `reports/.gpu.lock`, smoke, probe and snapshot wait, because SwiftShader would load the CPU and skew the timings.

How to read and trust its numbers:
- **Isolation:** one fresh browser context per scenario (clean localStorage, new GL context). Measuring starts at the same title-camera position, when its turn clock reaches `--at` seconds (default 40; the camera yaws 0.03 rad per second of game time). Each row records `yawDeg` and `clock`.
- **Row fields:**
  - `fps`, `ms`, `med` and `p95` are frame intervals from rAF timestamps. `low1` = 1000 / the mean of the slowest 1%; use it for relative comparisons only.
  - `cpuMs` = the time in all rAF callbacks of a frame.
  - `gpuMs` = `TIME_ELAPSED` around the frame. That is an upper bound, because it spans waits. `gpuSource` is `bench` (its own timer), `script per frame` (`Twitterentary.perf.gpuRing`) or `script mean`.
  - `scale` / `scaleRange` = `perf.scale`; `refreshPerMin`; `errors[]`; `sysCpuPct`.
- **Spikes and "holds 60":**
  - A spike frame has rAF callbacks ≥ 12 ms and callback − GPU ≥ 6 ms when a per-frame GPU time exists. Otherwise it is plain callback ≥ 12 ms, and `spikeRule` says which rule a row used. Don't compare a plain-rule row with a timer row blindly.
  - The GPU term matters because a GPU-bound frame also has a long callback: Chrome blocks the renderer in GL calls when the GPU falls behind. So the plain rule would drop exactly the slow GPU frames.
  - `p95gb` = p95 over the non-spike frames; `cpuSpikes` = the share of spike frames. `p95gb2` also leaves out the interval right after each spike (the one-frame lag of rAF timestamps shows the same stall again). **`holds60` = `med` ≤ 14 ms and `p95gb2` ≤ 16.7 ms**, the team's acceptance metric; the older verdict on `p95gb` is kept as `holds60gb`.
  - With `--vsync` (the display's 60 Hz, as players have it) rows add `missPct` (intervals > 20 ms), `hitches50`, `scaleChgPerMin` (governor hunting) and `refreshPerMin`; `holds60Vsync` = median 16.7 ± 0.5 ms and `missPct` ≤ 1%.
- **Bound labels:** JS time includes time blocked on the GPU, so a row is called GPU-bound when GPU ≥ 80% of the frame time, and only then is anything called CPU-bound.
- **Joining GPU samples:** with Shaders 1.5, `perf.timer === true` means bench runs no timer query of its own. It reads `perf.frame` in a microtask after each rAF callback and joins `perf.gpuRing`/`gpuRingFrame` samples by frame id (they arrive 2-3 frames late; disjoint periods are NaN).
- **Game settings:** `--rd` (default 12) and `--fov` (default 80) are the user's standard (the game's own defaults are 8 and 70); `--held-light on|off` is left at the game default unless given. They are written to `mc.rd`/`mc.fov`/`mc.heldLight` in the fresh profile before the game loads, and a row can override them with `@rd=N`, `@fov=N`, `@heldLight=on|off`. Each row checks on the live page that the game draws them (fog end, the camera's FOV and far plane) and records it in `row.view`; a mismatch WARNs. At rd 12 the title world meshes about 577 chunk columns, so the bench waits for meshing to stop first (`--mesh-max`, default 120 s).
- **Motion suffixes** go through `Twitterentary.stress()`, because the title camera stands still: `-moving` = `{moveSpeed: 11}` (creative flying), `-sprint` = `{moveSpeed: 22}`, both emulating camera drift for the shadow-refresh decision only (no chunk loading or meshing); `-stress` = `{shadowRefreshEvery: 4}`, a forced redraw every 4 frames (about 1000 redraws/min, against 60-90 for a real High player walking), a worst case only. `-moving` meant `-stress` before this recalibration; `--compare` flags rows whose baseline used the other meaning, and a script whose `stress()` doesn't echo `moveSpeed` makes `-moving`/`-sprint` rows `n/a`.
- **Repeats and the thermal guard:** `--repeat N` runs N passes in alternating order and each row is the median (with `spreadPct`). With `--repeat ≥ 2`, vanilla runs in every pass, and a pass whose vanilla median or `p95gb` is more than `--guard` (default 25) % above the best pass's is marked unreliable; this laptop throttles after hours of GPU load. `--cooldown S` idles before each pass. For decisions use `--protocol accept` (3 passes, early stop, vsync pass); `--skip-vanilla` drops the per-pass vanilla, leaving the preflight calibration as the reference.
- **Protocols and preflight:** `--protocol screen|accept` fills the run's settings from `tools/lib/machine-profile.json` (explicit flags win; without it every default is the legacy one). Both fast-forward the `--at` wait (`--warp`, then `--settle` real seconds before measuring; `row.warp`, `row.settleS`), which saves ~15-20 s a row (a row can override it with `@warp=K`). `accept` stops early when verdicts are clear (`--early-stop`, `env.earlyStop`; rows settled after pass 1 keep one pass unless `--no-adaptive`) and then runs a vsync pass into `bench-<label>-vsync.json`. The preflight (default for headed runs) checks the machine and calibrates on vanilla against the profile; `env.preflight` and `env.protocol` record both. When to use which: "Benchmark smart" in the `tweetcraft-shaders` skill.
- **History:** `npm run bench:history` prints one row per scenario per saved report, with filters; `bench-report.mjs` gives it the same verdicts as the bench.
- **Offline:** `--from <json>` runs nothing: it reprints a saved report's table (with `--compare <json>`, its deltas against another) without a browser or the GPU lock, e.g. to compare two old runs.
- **Caveat:** title-screen world only. Results are noisy while other processes load the CPU; the bench warns about that, about a software renderer, and about a frame cap still being on.

Runtime contracts between the scripts:
- `window.__tcOptions` (Better Options) is used by zoom (keybind, settings tab, `fov`), by any new script's
  settings, and by the `tc.options` storage.
- `window.Twitterentary` (shaders) has `cfg`, `schema` and `presets`, which Better Options' Shaders tab reads, and
  `set`, `applyPreset`, `currentPreset` and `reset`, which it calls. Its settings are stored as `tc.shader.<key>`.
  The shaders use Better Options' `toast` and `capturing` when they're there.
- Game-owned storage `mc.fov` and `mc.rd` is read by Better Options and zoom.

## Where things belong

| You're adding... | Put it in | Also update |
|---|---|---|
| A new player-facing feature with its own on/off | new `tweetcraft-<name>.user.js` (template in `skills/tweetcraft-new-userscript/`) | README scripts list, `compat/expectations.mjs`, `codemap/scripts.md` |
| A rendering or GLSL effect | `twitterentary-shaders.user.js` (CFG + SCHEMA + uniform + patch) | `shaders` expectations (`min`), `codemap/scripts.md` |
| A setting or UI for any script | that script, registered via `window.__tcOptions.register` | |
| A new game hook (any script) | the script | `compat/expectations.mjs` entry (required) |
| Shared tooling logic | `tools/lib/*.mjs` | `.claude/rules/tooling.md` if it changes conventions |
| A new tooling command | `tools/<name>.mjs` + `package.json` script | `.claude/CLAUDE.md` commands table, README |
| Anything that opens Chrome (tool, lab page, test) | `launchBrowser()` from `tools/lib/browser.mjs`. Pass `{ gpu: true }` for the real GPU; it takes the GPU lock. Never start your own GPU Chrome | |
| A performance claim or a before/after comparison | check `npm run bench:history` first; else measure it with `npm run bench -- --protocol screen\|accept` (`--ref origin/main` for the baseline, `--compare` for deltas) and quote the JSON's `env` with the numbers. SwiftShader smoke timings are not GPU numbers | `codemap/optimisation-log.md` |
| A bench result that changes what this machine costs (new vanilla range, noise, a feature's cost) | regenerate `tools/lib/machine-profile.json` from the reports | `codemap/machine-profile.md` |
| What an optimisation gained, or why it failed (a dead end) | `codemap/optimisation-log.md` | |
| A new CI step or a change to what the cloud run checks | `.github/workflows/game-watch.yml` (it serves main, PRs and `ci/*` pushes) | `tools/cloud.mjs` if it parses that step, `.claude/rules/tooling.md` |
| Any GitHub API call from tooling | `tools/lib/github.mjs` (read-only, token from this repo's Git Credential Manager per call, never `gh auth`). Ask the user before adding a write | `.claude/rules/tooling.md` |
| Knowledge about the game | `.claude/codemap/game-*.md` | the build id in its header |
| A repeatable agent workflow | `.claude/skills/<name>/SKILL.md` | `.claude/CLAUDE.md` skills list |
| A rule tied to certain files | `.claude/rules/<topic>.md` with `paths:` | |
| Anything from the game's source | nowhere: reference it by path and name | |
