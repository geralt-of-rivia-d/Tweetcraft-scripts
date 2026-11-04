---
name: tweetcraft-shaders
description: Change, extend, debug or optimise the Twitterentary shader userscript (twitterentary-shaders.user.js), which hooks the Tweetcraft game's WebGL2 calls and regex-patches its GLSL ES 3.00 shaders to add shadows, waving plants, water, and sky and cloud effects. Use for any GLSL or WebGL change, new visual effects or settings, shader compile/link errors, and GPU or CPU performance work in this repo.
---

# Working on the shader mod

Any non-trivial change runs as a team (see "Run it as a team" in `tweetcraft-dev-pipeline`). Put
`window.Twitterentary` (`cfg`, `schema`) in every brief, since it's the contract with Better Options.

Read first:
- `.claude/codemap/scripts.md`: function-by-function map of `twitterentary-shaders.user.js`, including the CFG,
  SCHEMA and uniform table.
- `.claude/codemap/game-rendering.md`: how the game renders a frame and what each of its programs does.
- The game's real GLSL: `game/prod/$(cat game/prod/LATEST)/shaders/*.glsl`. Run `npm run snapshot` if missing.

## How the mod works (one screen)

1. **Wrap.** At document-start it saves the originals of the `WebGL2RenderingContext.prototype` methods it needs
   in `O` and installs wrappers: `shaderSource`, `compileShader`, `attachShader`, `linkProgram`, `useProgram`,
   `getUniformLocation`, `uniform3f`/`3fv`/`1f`, `bindVertexArray`, `deleteVertexArray`, `drawElements`, `clear`,
   `texImage3D`/`texSubImage3D`.
2. **Patch.** `shaderSource` sends each game shader to `patchSource()`, which detects its kind and calls
   `patchTerrainVS`, `patchTerrainFS`, `patchSky` or `patchCloud`. Each returns patched source, or `null` to
   leave the shader untouched. If a patched shader fails to compile or link, the original is restored and the
   error is logged.
3. **Track.** `linkProgram` records `progInfo` (terrain, lit, mode for opaque/cutout/translucent, sky...).
   `useProgram` calls `applyUniforms` on every use of a patched program. That pushes CFG values and observed state,
   but only when `info.gen !== ST.gen`. `gen` bumps once per frame in `updateState`, and again at the frame's first
   terrain draw, so each program uploads about once or twice per frame.
4. **Observe.** Wrapped uniform calls watch what the game sends (`OBS`: sky colour, sun sprite position, camera,
   lit or dim world). The texture-name list (atlas layer order) is captured through an
   `Array.prototype.indexOf('oak_planks')` hook, which stays installed. Each atlas layer is then classed as leaves,
   plants, water or emissive: by name first (`nameClass`), falling back to pixel statistics from `texImage3D` and
   animation from `texSubImage3D`. The classes go into a one-row RGBA8 texture `uClsTex` on **texture unit 7**
   (1024 wide, or wider if there are more layers). The layer is 9 bits on build 6b3963e444: use `tcLayer`
   (`layerDecl()`), never `int(aInfo.x)` alone.
5. **Shadow pass.** `drawElements` sends terrain draws to `terrainDraw`, which records each chunk VAO (origin, index
   count, cutout) in `rec`. `renderShadow` redraws the recorded chunks within `shadowExtent` into a
   `shadowSize²` depth texture on **texture unit 6**. It runs every `shadowEvery` frames, or when the camera moves
   more than `shadowMove` blocks or the sun moves.
6. **Expose.** `window.Twitterentary = { cfg, schema, state, stats, shadow, obs, debug }`. Better Options builds
   its Shaders tab from `schema` and writes `localStorage['tc.shader.<key>']`.

## Measure twice: before changing GLSL

1. **Read the target shader in `shaders/`** as compiled, and note its exact lines. Our regexes match those lines.
2. **Make anchors robust.** Use `\s*` around every token, never a literal space, and anchor on distinctive
   lines, not whole bodies. Single-escape inside regex literals (`/\s*/`); the cloud bug was `\\s`.
3. **Avoid name collisions.** Injected identifiers use the `tc` prefix for locals (`tcC`, `tcDx`) and `u<Name>`
   for uniforms. Grep `shaders/` so a new name doesn't already exist in the game's GLSL.
4. **Stay valid GLSL ES 3.00 with the game's precision.** Integer and bit ops need `highp` (`aPos` is a `uvec3`
   packed position). `dFdx`/`dFdy` are core in ES 3.00. Never write the `flat` qualifier in terrain GLSL, not even
   in a comment: smoke forbids it. The 1.5 betas' `vCls`, read by every terrain pixel, cost 2.3-3 GPU ms at rd 12 on
   ANGLE D3D11. Don't quote that for every flat varying: the game's own `vGlass`, which we strip to satisfy the guard,
   measured inside the noise floor on the title screen, for reasons unverified. The number of varyings doesn't matter.
5. **Samplers.** The game uses texture units 0–5, its atlas pages begin at unit 8 (`PAGE_UNIT`), and we hold 6 and 7. A sampler you add to a game shader
   **defaults to unit 0**, where a `sampler2DArray` already sits. That's an `INVALID_OPERATION` on draw unless you
   `uniform1i` it to its unit after link (see `applyUniforms`). `Gfx.tex2d` leaves `TEXTURE1` active, so save and
   restore `ACTIVE_TEXTURE` around your own binds.
6. **Patch the programs the game actually draws.**
   - Terrain: the lit variants (`13`–`15`) are drawn. Programs `00`–`02` and `04-sky` are compiled but probably
     unused (see `game-rendering.md`).
   - Not captured in `shaders/`: entity, crack, enchant, chest-icon, bubble and similar programs compile after the
     title screen.
   - Shared source: several programs share vertex source (`VS_SPRITE`, `VS_ENT`), so a vertex-only match can hit
     more than you intend.
   - Clouds: `06-cloud` also draws the far ocean plane.
7. **A failed compile can kill the game.** If a patched shader fails to compile inside the `Gfx` constructor, the
   game shows "This game needs WebGL 2" and stops. The original-source fallback in `compileShader`/`linkProgram` is
   mandatory, never remove it.
8. **Post-processing hooks:**
   - The game never binds framebuffers, so a mod FBO bound at frame start (the first GL call each frame is
     `viewport`) captures every world draw. We have none since 1.5.1: 1.6 effects that need one restore it from
     `d73912c`, shaped for 100%, and pay about 0.6-0.77 ms at 1080p.
   - The first-person hand pass clears depth mid-frame (`drawHeld`), so grab scene depth before that.
   - The HUD is a separate 2D canvas and is unaffected.
   - World rendering is camera-relative: `uVP` is rotation and projection only, and `uOrigin` is chunk origin minus
     camera.
9. **Plan a new setting end to end:**
   1. Add the `CFG` default and a `SCHEMA` entry (`reload: true` if it changes compiled code or allocations).
   2. Add the uniform name to `UNIFORMS` and push it in `applyUniforms`.
   3. Declare and use it in the injected GLSL.
   4. Add a `compat/expectations.mjs` marker if the patch must apply.

## Cut once: implement and verify

```sh
npm run smoke -- --only shaders          # compiles and links every patched program in real Chrome (SwiftShader)
npm run probe -- --only shaders --programs
npm run probe -- --only shaders "window.Twitterentary.debug()"
npm run probe -- --only shaders "window.Twitterentary.stats"
npm run cloud -- smoke --only shaders    # the same smoke in GitHub Actions: use it while a bench holds the GPU
```

- **Compile, then check effect.** The smoke test fails on any compile or link error, on `console.error` from the
  script, and if fewer programs are patched than `compat/expectations.mjs` `shaders` `min` expects. Update
  `min` when you deliberately change coverage.
- **Look at `reports/smoke-prod.png`.** For visual changes, compare it against a near-vanilla shot
  (`npm run smoke -- --only chat`). Both runs write the same `reports/smoke-prod.png`, so copy the first one aside.
- **SwiftShader is not a GPU.** Precision, performance and some driver bugs differ. Validate visuals and frame time
  in real Chrome with the dev loader (`npm run dev`), then ask the user to check in-game (day/night, water,
  leaves, caves, Nether/End).
- **Use the script's debug view.** In the browser console, `Twitterentary.debug()` shows sun, shadow and atlas
  class state. `Twitterentary.cfg.<key> = value` changes the uniform-backed settings, plus `enabled`, `waving`,
  `shadowEvery` and `shadowMove`, on the next frame. The `reload` ones (and `shadowDepth`) only take effect on a
  page reload.

## Known issues in the shader script

Before touching a function, read its entries under "Issues & smells" in `.claude/codemap/scripts.md`. Examples:
- Shader state is global, while the game's dragon view creates a second WebGL2 context.
- `shadows` isn't really live.
- `shadowExtent` is read live, but its GLSL bias is baked in at compile.
- Errors are logged every frame.
- Sun and day detection rely on the game's draw order.

## Performance work

Profile before optimising, and change one thing at a time.

- **Measuring:**
  - Frame-time numbers come from `npm run bench` on the real GPU, run as in "Benchmark smart" below. Nothing else
    counts as a performance claim.
  - To find out *where* the time goes: Chrome DevTools Performance panel (GPU track and main thread),
    `chrome://gpu` for the active backend, and `Twitterentary.perf` (per-frame GPU timer samples).
- **Known costs in this mod (verify, then fix):**
  - `renderShadow` re-rasterises every in-range chunk into a `shadowSize²` depth map (`DEPTH_COMPONENT16`,
    back-face culled, opaque parts through a depth-only program). Since 1.4.0 it runs only when something changed
    (`STATS.why`: dirty chunks or settings, camera moved `shadowMove`, sun turned, 2 s safety net), at most every
    `shadowEvery` frames. Cost scales with `shadowExtent²` and chunk count; the footprint cull is X/Y only and
    assumes a 128-tall column.
  - It saves and restores only cheap state (`isEnabled`, bindings, viewport); the depth func and mask are set back
    to what gfx.js uses for the terrain passes (anchored in `compat/expectations.mjs`). Don't add `getParameter`
    calls for depth state: they are GPU-process round trips.
  - Shadow filtering (`shadowFilter`) is 1, 4 (3x3 tent) or 9 (5x5 tent) hardware-PCF taps, all through
    `textureLod` so ANGLE can skip them in branches. Beyond 32 blocks and on foliage and water it is one tap. It is
    still the main per-pixel cost.
  - Terrain FS extras (derivatives, water waves) run on every terrain pixel; fully fogged pixels return early.
    Branch on uniforms to skip disabled features, which is cheap and coherent.
  - Wrapped `drawElements` and `useProgram` run for every draw call. Keep them allocation-free and branch-light;
    uniforms go through the per-program cache in `applyUniforms` / `pushCam`.
- **Rules of thumb:**
  - Don't call `getError`, `getParameter`, `readPixels` or `getShaderParameter` in per-frame paths.
  - Reuse typed arrays (`SCRATCH`).
  - Avoid redundant uniform uploads (the `gen` check).
  - Never allocate in hot paths.

## Benchmark smart

Real-GPU time is the slowest part of the loop, and this laptop is noisy and throttles. A decision should take one
or two bench runs, not five. Before any bench:

1. **Read what is already known.**
   - `.claude/codemap/machine-profile.md`: the backend (§1), the noise floor (§2), thermal and background load (§3),
     the cost table (§4), presets (§5), the protocols and their wall time (§6), first guesses per goal (§7) and
     gotchas (§8). Its data is `tools/lib/machine-profile.json`.
   - `.claude/codemap/optimisation-log.md`: every past optimisation and what it gained (§1), how this GPU behaves
     (§2), the benchmarking mistakes and the rule against each (§3), the dead ends (§4) and the next likely wins (§5).
2. **Look for an existing answer.** `npm run bench:history -- --scenario "high*" --rd 12 --fov 80 --latest` lists
   that row from every saved report (filters: `--version`, `--label`, `--since`, `--vsync`/`--uncapped`; `--md`
   for a table to paste). If a row with the same script version and settings exists, and nothing on its path
   changed since, quote it instead of re-running. Its flags column marks rows not to trust: `U` unreliable pass,
   `P!` preflight warned.
3. **Predict the result** from the cost table (profile §4, and "Where the cost is" in log §2) and write the
   prediction down. Start from the profile's first guess (§7) for the goal. A result far off it is as often a
   measurement problem (throttling, wrong rd/FOV, a background process) as a real effect: check `env`, the guard
   and the `view` WARNs before believing it.
4. **One protocol per decision.** Don't mix protocols, or settings, inside one comparison.
   - `--protocol screen` to choose between candidates: one short pass with the title camera's wait fast-forwarded
     (`--warp`), about 33 s a row (4 rows ≈ 2.5 min). Enough to rank them on median and `gpuMs`; it can't judge
     a p95. Judge "holds 60" only from accept, never from a screen.
   - `--protocol accept --label <name>` once, for the release numbers at the standard (rd 12, FOV 80,
     1920×1080): up to 3 passes, then a vsync pass written to `bench-<name>-vsync.json`. A row whose verdict is
     clear after pass 1 keeps that pass, and only the unsettled rows (plus vanilla) run on. 8 rows take about
     5-16 min, plus about 15 min for the vsync pass, against about an hour before. These JSONs are what the
     handover quotes. For a small A/B delta (under ~0.4 ms median) add `--no-early-stop`.
   - Values come from the profile; explicit flags (`--seconds`, `--repeat`, `--cooldown`, `--warp 1`...) still win.
     Without `--protocol` the bench measures exactly as before.
   - There is no interleaved mode: passes already alternate their order, so slow drift hits A and B alike. Put A
     and B in the same run.
   - Plan the baseline's rows (`--ref origin/main`) to match the candidate's, so `--compare` has a row for each.
5. **Bench a pinned copy.** `--script <scratchpad>/v-x.user.js`, not the shared working tree, which teammates are
   editing. Accept only on a frozen tree.
6. **Trust the preflight.** It runs by default on headed real-GPU runs: AC power, the power plan, background CPU,
   the GPU lock and the display mode, then a vanilla calibration against the profile's range (with a protocol it
   cools down and recalibrates once). If it still warns, fix the machine or wait; don't read the numbers.
   `--strict` makes it exit 1 instead, which suits an unattended accept run.
7. **Leave the machine alone while it runs.** The GPU lock only serialises browsers: no local smoke, probe or
   snapshot, and no CPU-heavy node work (simulators, builds) either. Run check and smoke in the cloud instead
   (`npm run cloud -- test`, see "Testing" in `tweetcraft-dev-pipeline`).

```sh
npm run bench:history -- --scenario "high*" --rd 12 --fov 80 --uncapped --latest
npm run bench -- --protocol screen --script <copy> --scenarios vanilla,high,high+shadowSize=1024 --label scr-shadowres
npm run bench -- --protocol accept --script <copy> --scenarios vanilla,off,low,medium,high,ultra,high-moving,ultra-moving --label final-1.5b --compare reports/bench-baseline-1.4.0-rd12.json
```

Reading the result:
- **Deltas under the noise floor (profile §2) are noise.** Report "no measurable change" and move on. Don't
  iterate on them. Decide on median and `gpuMs`, the steadiest metrics; `p95gb` is the noisiest.
- **Check the row before the number:** no UNRELIABLE pass, vanilla in its usual range, no "system CPU" note, `view`
  matches the settings, and `gpuSource` is "script per frame" with `gpuFrames` ≈ `frames` before you read GPU ms.
- **Validate a new metric** on vanilla, on `--raw` frames and under `--vsync` before optimising for it: a tail
  has to exist at 60 Hz to matter.
- **Correlation isn't cause.** Before building on one, prove it with a causal A/B: both variants as rows of one
  run, 3 passes, `--no-early-stop`.
- **Simulators and synthetic load screen, they don't accept.** Calibrate synthetic load against real play (the old
  `-moving` forced 1000+ redraws/min against a real 60-300), and take one real `--vsync` run before accepting
  anything a simulator (govsim) approved.
- **The title screen is a lower bound** on in-world cost (no walking, no meshing). Every bench number is a title-screen
  number, so say so when you quote one, and confirm in game.
- **Don't retry a dead end** (log §4), unless the reason it failed no longer holds. Say why.
- **Feed the knowledge back.** After an accept run, add the result to the optimisation log, and regenerate the
  machine profile from the reports (profile §9), so the next prediction is better.

## Done means

- `npm run cloud -- test` passes (`npm test` if the cloud is unavailable).
- Expectations are updated: `source` anchors on `shaders:vs` / `shaders:fs`, `shaders` markers and `min`.
- `@version` is bumped.
- `window.Twitterentary` and the SCHEMA stay backwards compatible, because Better Options reads them.
- Real-Chrome check done or explicitly handed to the user.
- For a performance change: one `--protocol accept` bench JSON at the standard, quoted with its `env`, and an
  entry in `.claude/codemap/optimisation-log.md`.
