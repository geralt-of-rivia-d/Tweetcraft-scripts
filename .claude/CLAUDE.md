# Tweetcraft scripts

Tampermonkey userscripts that mod [Tweetcraft](https://tweetcraft.jai.vin), a browser block-building game
(WebGL2, about 100 unbundled ES modules), plus Node tooling that snapshots the game's code and tests the scripts
against the live game. Current focus: optimising the shaders, improving the UI, and keeping every script working
as the game updates.

## Hard rules

- **Never commit `game/`** or paste large chunks of it anywhere. It is the game developer's code, kept locally for
  reading and diffing only (gitignored).
- **Never change GitHub or git credentials.** This clone already pushes with the right account. Never run
  `gh auth login|switch|logout|refresh` or `git config --global ...`, and never edit the `credential.*` or `user.*`
  config of this repo. Another project on this machine depends on the global `gh` login.
  `.claude/hooks/guard-git-auth.mjs` blocks these once the user enables it (see `.claude/hooks/README.md`). Never
  edit `.claude/settings*.json` yourself. The user has given standing permission (2026-11-03) for read-only GitHub
  API calls through `tools/lib/github.mjs` and for throwaway `ci/*` pushes through `npm run cloud`. Any other GitHub
  API call or push needs the user first.
- **Hook the game defensively.** Detect, then patch. If the target isn't there, leave the game untouched and fall
  back to the original. A broken game is worse than a missing feature. Code inside the game's frame loop must
  never throw: `js/frameloop.js` re-arms `requestAnimationFrame` before calling `frame()`, so an exception
  silently skips rendering and network sends for every frame after it.
- **Client-side visuals and UX only, never anything that touches fair play or security.** Never touch, automate or
  hide the Turnstile challenge. Never alter the `hello` handshake or protocol version. Never forge or replay
  network traffic (dig, place, movement). Never read or send the `mc.tok`, `mc.admin` or `mc.key.*` secrets.
- **Every new or changed game hook gets an entry in `compat/expectations.mjs`.** That is how updates that break it
  get caught.
- Commit and push only when the user asks.

## Commands

| Command | What it does |
|---|---|
| `npm run snapshot` | Fetch the game into `game/prod/<time>-<build>/` (`raw/`, `pretty/`, `shaders/*.glsl`, `manifest.json`) and print what changed. No-op if unchanged. `-- --target staging` for staging. |
| `npm run check` | Offline: userscript metadata, syntax, README listing and the code-checkable hard rules (no `mc.tok`/`mc.admin`/`mc.key.*`, Turnstile, `WebSocket` or `/api/`; nothing in `game/` committed); **fails if a script changed since `origin/main` without a higher `@version`**, if a script was renamed or its `@name`/`@namespace` changed, or if a root `.js` file's metadata block doesn't parse; `compat` `source` anchors against the latest snapshot; warns when a codemap's build id is stale. |
| `npm run smoke` | Live: headless Chrome loads the game with the userscripts and checks `runtime` and `shaders` expectations. `-- --only <name>`, `--headed`, `--target staging`. Writes `reports/smoke-<target>.{json,png}`. |
| `npm test` | Local `check`, then `smoke` (~1.5 min, occupies the laptop). Prefer `npm run cloud -- test`; use this when iterating on one hook or when the cloud is unavailable. |
| `npm run cloud -- <cmd>` | GitHub Actions instead of this laptop (free: the repo is public). `test|check|smoke [--target prod|staging|both] [--only <name>] [--no-wait] [--keep]` pushes the working tree (via a temp index, never the real one) to a throwaway `ci/*` branch, waits for Game watch, prints each step, saves artifacts to `reports/cloud/<run-id>/` and deletes the branch (`test` ~2 min 15 s, `check` ~25 s; exit 1 means red or couldn't run). `wait <run-id|branch>` collects a `--no-wait` run. `minutes`: this month's Actions usage and quota (run it at the start of a heavy session). `status [--prune]`: recent runs, open issues, stale `ci/*` branches. Auth comes from this repo's Git Credential Manager, never `gh auth`. |
| `npm run dev` | Tampermonkey dev loaders in `dev/` that `@require` the working copy. |
| `npm run probe -- "<expr>"` | Evaluate an (async) expression in the live game and print JSON. `--scripts` loads our userscripts; `--programs` lists shader programs. |
| `npm run bench -- --scenarios <list>` | **Real GPU** (this laptop's UHD 620): headed, uncapped Chrome at 1920×1080 times scenarios (`vanilla`, `off`, `<preset>[+key=value]`, with suffixes `-moving` for flying at 11 blocks/s, `-sprint` at 22, and `-stress` for a forced shadow redraw every 4 frames, a worst case only). **Use a protocol, which reads `tools/lib/machine-profile.json`; explicit flags win.** `--protocol screen` (5 s, 1 pass, ~30-35 s a row) ranks candidates on median and `gpuMs`, and never declares a pass. `--protocol accept --label <x>` (8 s, 3 passes with adaptive early stop, then a vsync pass into `bench-<x>-vsync.json`) is the one run per release decision; add `--no-early-stop` for A/B deltas under ~0.4 ms. Both warp the title camera's clock to `--at` (`--warp 10 --settle 12`; `@warp=1` per row restores the old wait). A preflight runs by default (AC power, power plan, background CPU, GPU lock, display, a vanilla calibration against the profile); `--strict` aborts on a bad state, `--no-preflight` skips it. `--guard` flags passes where vanilla slowed (on this laptop that was always background CPU, never heat). Without `--protocol` every default is the legacy one. `--ref origin/main` runs the published baseline; `--compare <json>` prints the deltas. Judge uncapped runs on median and `p95gb2`: "Holds 60" means median ≤ 14 ms and p95gb2 ≤ 16.7 ms. (`p95gb` leaves out frames with a game JS spike; `p95gb2` also leaves out the interval right after each spike, where the one-frame lag of rAF timestamps shows the same stall again. `p95gb` is still reported, so old reports stay comparable.) `--vsync` keeps the display's 60 Hz vsync, as players have it. Rows then add miss% (intervals > 20 ms), > 50 ms hitches, scale changes/min (governor hunting) and redraws/min, and "holds 60 (vsync)" means median 16.7 ± 0.5 ms and miss% ≤ 1%. `--compare` WARNs on a vsync mismatch. **The standard is the user's setup: render distance 12, FOV 80, fullscreen 1920×1080**, which is the default (`--rd 12 --fov 80`; `--held-light on\|off` is left at the game's default unless given). Secondary rows: rd 8/10, FOV 70/110 and held light off (which has no effect on the title screen: nothing is held), per row with `@rd=8`, `@fov=110`, `@heldLight=off` (e.g. `high@rd=8`). Every row checks on the live page that the game draws those settings and WARNs on a mismatch; `--compare` WARNs when the baseline's rd/FOV differ (JSONs without `env.rd` count as rd 8 / FOV 70). The 1.4.0 baseline at the standard is `reports/bench-baseline-1.4.0-rd12.json` (the older `bench-baseline-1.4.0.json` is rd 8 / FOV 70). A GPU lock (`reports/.gpu.lock`) serialises real-GPU runs, and smoke and probe wait for it. |
| `npm run bench:history` | Every saved bench row in one table. Check it before re-running: `-- --scenario "high*" --rd 12 --fov 80 --latest`, plus `--version`, `--label`, `--since`, `--vsync|--uncapped`, `--md`, `--json`. A flags column marks unreliable, warped, early-stopped and preflight-warned rows, and `X` for reports the machine profile excludes as contaminated; `--clean` drops those. |

There is no snapshot on a fresh clone: run `npm install && npm run snapshot` first.

## Where things are

- Userscripts are in the repo root (`*.js` with a `// ==UserScript==` block):
  - `twitterentary-shaders.user.js`: GLSL patching, shadows, waving plants, water, sky
  - `tweetcraft-better-options.js`: options menu and the shared settings bus `window.__tcOptions`
  - `tweetcraft-zoom.user.js`, `tweetcraft-chat-history.js`
- `compat/expectations.mjs`: what each script needs from the game
- `tools/`: snapshot, check, smoke, probe, bench, bench-history, cloud and dev-loaders
- `.github/workflows/game-watch.yml`: runs everything daily, and on every push and PR, for prod and staging. When
  the game's build changes, it opens a "Tweetcraft changed to build …" issue (with the change report and the codemaps
  to re-verify). When AndresTube's original repo gets new commits, it opens an "Upstream has new commits" issue.
  Either issue means: follow `tweetcraft-game-update`.

## How we work: measure twice, cut once

Every script change follows the **`tweetcraft-dev-pipeline`** skill:
1. Understand our code and the game's code, using the codemaps, the snapshot and `npm run probe`.
2. Specify the hooks as `compat/expectations.mjs` entries before coding.
3. Implement defensively.
4. `npm run cloud -- test` (local `npm test` only when the cloud is unavailable).
5. `userscript-reviewer`.
6. Hand over for an in-game test.

- Don't skip phases. Scale their depth to the change.
- **Fix the acceptance criteria and their metrics before implementing**, and ask for the user's real setup first.
  Past sessions lost the most time to criteria changed mid-way and numbers taken at the wrong settings
  (`optimisation-log.md` §6).
- **Test in the cloud, bench smart.** Check and smoke go to GitHub Actions (`npm run cloud -- test`, run in the
  background), which leaves the laptop free for a real-GPU bench. Never run local smoke, probe, snapshot or other
  CPU-heavy work during a bench: background CPU, not heat, is what spoiled past passes. Before any bench, read
  `machine-profile.md` and `optimisation-log.md`, check `npm run bench:history` for an existing answer, and write
  down the predicted result. Then run one `--protocol screen` to choose and one `--protocol accept` to ship (see
  "Benchmark smart" in `tweetcraft-shaders`).
- **Run it as a team (mandatory).** Every non-trivial change (more than one file, or more than a few minutes) runs
  as parallel subagents. Research fans out to several `game-code-explorer` and Explore agents, then one agent per
  workstream, with one owner per file. Each brief stands alone and carries the cross-agent contracts. Teammates
  message each other with SendMessage, after the lead sends them a roster of agent IDs. The lead integrates, runs
  `userscript-reviewer` and then the cloud test, and hands over. Speed never skips a phase. Details: "Run it as a team"
  in the skill.

## North star and to-do list

`VISION.md` holds the project's north star (every shader setting at maximum, a locked 60 FPS, no jitter, in a real
world at native resolution), its ethos and **the project's only to-do list**. Read it before any performance or shader
work. The list is a strict timeline, worked from the top, with no side work: anything new gets a place on it before it
starts, and the only exception is a game update that breaks a script. When the user mentions a to-do, a "to-do item" or
anything that matches a name on that list, read it first and work from what it says. Delete an item as soon as it's
done. Being next on the list is not a request to start it: wait for the user.

## Private notes

`private/` is gitignored and holds details of the user's machine and setup that stay out of this public repo: the
exact laptop model, BIOS, Windows build and update state, installed software. Read `private/machine.md` before any
work on the laptop itself. Never copy its contents into a tracked file, commit message, issue or CI log. Public files
name the chip only (i7-8650U, UHD 620).

## Knowledge base

- `.claude/codemap/README.md`: repo layout, how the pieces relate, and **where new things belong**
- `.claude/codemap/scripts.md`: our four scripts, function by function, plus known issues
- `.claude/codemap/game-core.md`, `game-rendering.md`, `game-ui.md`: how the game works
- `game/prod/<LATEST>/MODULES.md`: generated map of all game modules, always matching the snapshot
- `.claude/codemap/machine-profile.md` (data: `tools/lib/machine-profile.json`): this laptop as a bench machine. It
  covers the noise floor, the cost per feature at rd 12 and 8, preset numbers, protocols and first guesses. **Read it
  before any bench.**
- `.claude/codemap/optimisation-log.md`: every optimisation tried, with its measured effect, the dead ends not to
  retry, how this GPU and driver behave, and process lessons

## Skills and agents in this repo (use them)

- `tweetcraft-dev-pipeline`: the workflow for any script change, run as a parallel team of subagents (start here)
- `tweetcraft-game-code`: find how the game does something, read its modules and real GLSL, probe it live
- `tweetcraft-shaders`: any change to the shader script, GLSL patches or rendering performance
- `tweetcraft-ui`: menus, settings tabs, keybinds, HUD, matching the game's look
- `tweetcraft-new-userscript`: creating a new script end to end
- `tweetcraft-game-update`: the game changed, or check/smoke/CI is red
- Third-party reference skills (vetted, MIT; repo rules win on conflicts): `tampermonkey`, `webgl`
  and `shader-art-coding` (GLSL building blocks). See `.claude/skills/README.md`.
- Agent `game-code-explorer`: delegate "where/how does the game do X" questions, several in parallel (one question
  area each), so the 690 KB of game code stays out of your context
- Agent `userscript-reviewer`: review the full diff of a script change before it ships

Path-scoped rules in `.claude/rules/` load automatically when you touch userscripts, tooling or `game/`.

## Shipping a change

1. `npm run cloud -- test` passes (or `npm test` when the cloud is unavailable). Look at the smoke screenshot
   (`reports/cloud/<run-id>/report-prod/smoke-prod.png`, or `reports/smoke-prod.png` locally), and for visual changes test in real Chrome through the dev
   loader too. SwiftShader in the test is not a real GPU. A performance change also needs a `--protocol accept`
   report and a line in `optimisation-log.md`.
2. Bump the script's `@version` (semver: fix = patch, feature = minor) as part of the change, once per change
   relative to `origin/main`. Installed copies only update when it increases, so `npm run check` fails until you
   do. Never rename a script file or change its `@name`/`@namespace`: installed copies would stop updating. Keep
   any in-code version string (`bus.version`, `debug()` output) in sync, or better, read `GM_info.script.version`.
3. Update the README script list if behaviour changed for users.
4. Commit and push only when asked, then mention the CI run.

## Known issues

`.claude/codemap/scripts.md` ("Issues & smells") lists more than 40 verified bugs and performance problems in the
current scripts, by function and line. Check it before changing a function, and remove an entry when you fix it.
Notable ones:
- `patchCloud()` never matches (double-escaped regexes), and its inserted `'\\n'` would break GLSL once the regexes
  are fixed. It's marked `known` in `compat/expectations.mjs`.
- Better Options scales the HUD hint and the tab player list twice when UI scale isn't 1 (#45).
- The shaders' K toggle can't be rebound (it isn't registered with `registerKeybind`).
- Zoom's default `KeyC` collides with the game's undo-preview confirm key.
- GLSL trap: never write `flat ` in terrain GLSL, not even in a comment. A flat varying costs ~2.3-3 GPU ms at rd 12
  on ANGLE D3D11, and smoke forbids the string.
