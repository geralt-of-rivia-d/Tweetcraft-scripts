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
   (1024 wide, or wider if there are more layers).
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
   packed position). `dFdx`/`dFdy` are core in ES 3.00.
5. **Samplers.** The game uses texture units 0–5 only, and 6 and 7 are ours. A sampler you add to a game shader
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
     `viewport`) captures every world draw.
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
  - Chrome DevTools Performance panel (GPU track and main thread).
  - `chrome://gpu` for the active backend.
  - Frame time via `requestAnimationFrame` deltas over about 10 seconds, A/B with `Twitterentary.cfg.enabled` and
    `cfg.shadows` toggled.
  - `EXT_disjoint_timer_query_webgl2` for GPU pass timing, where the browser exposes it (often it doesn't).
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

## Done means

- `npm test` passes.
- Expectations are updated: `source` anchors on `shaders:vs` / `shaders:fs`, `shaders` markers and `min`.
- `@version` is bumped.
- `window.Twitterentary` and the SCHEMA stay backwards compatible, because Better Options reads them.
- Real-Chrome check done or explicitly handed to the user.
