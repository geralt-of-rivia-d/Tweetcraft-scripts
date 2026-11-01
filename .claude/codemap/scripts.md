# Codemap: our Tweetcraft userscripts

Verified on 2026-11-01 against the working copies and game build d7bde3deb9 (the same game code as builds b4bc035ec8 and 26479914e5, which were hashed over fewer files). Abbreviations: **SH** `twitterentary-shaders.user.js`, **BO** `tweetcraft-better-options.js`, **ZM** `tweetcraft-zoom.user.js`, **CH** `tweetcraft-chat-history.js`, **game:** = `game/prod/<LATEST>/pretty/js/`; its line numbers hold while the snapshot's JS is unchanged from that build. `SH:120` means file:line. Anything not checked directly in code is marked (inferred).

## 1. How the scripts relate

All four scripts are standalone `document-start` IIFEs on `https://tweetcraft.jai.vin/*`. **BO is the hub.** It sets up `window.__tcOptions` synchronously when it runs (BO:52). The tooling loads BO first (`tools/lib/common.mjs:63-68`), and ZM polls every 200 ms until the bus exists (ZM:133-135), so for the bus itself load order doesn't matter. Load order does decide which capture listener on `window` runs first. **SH** only needs to wrap `WebGL2RenderingContext.prototype` before gfx.js calls `getContext` (game:gfx.js:721). SH does **not** use the bus. It reads `tc.shader.<key>` once at startup (SH:47-55) and publishes `window.Twitterentary`. BO's Shaders tab reads `Twitterentary.cfg` and `.schema` each time the tab is built, then writes both `cfg[key]` and `tc.shader.<key>` (BO:501-528). BO also calls `TE.apply`, which doesn't exist. CH shares nothing with the others. BO writes the game's `mc.fov` and `mc.rd` (and ZM writes `mc.fov` when BO is missing). BO and SH both write toasts into `#note`.

```
  localStorage:   tc.shader.*             tc.options (JSON)            mc.fov / mc.rd (game-owned)
                  BO writes, SH reads     BO r/w (ZM if no BO)         game + BO r/w (ZM if no BO)

  +----------------+  reads cfg/schema,  +---------------------+  register, registerKeybind,  +--------+
  | SHADERS        |<--- writes cfg -----| BETTER OPTIONS      |<---- changed, get/set, ------| ZOOM   |
  | window.        |    (no bus use)     | window.__tcOptions  |      fov.get/set, capturing  |        |
  | Twitterentary  |                     | (bus)               |                              +---+----+
  +-------+--------+                     +----------+----------+                                  |
          | wraps WebGL2 prototype                  | imports menus.js, ui.js, survival/client.js | menus.js
          v                                         v #screen, "Options…" click, F1, Distance:, --u/--d
     game gfx.js GL calls                      game menus / HUD  <------------------------------------+ (fallback)

  CHAT HISTORY --> #chatbox keydown (standalone)
```

**Bus `window.__tcOptions`** (all defined in BO)

| Member | BO line | Notes / consumers |
|---|---|---|
| `version` | 38 | `'2.2.0'` (≠ @version 1.0.0). Only shown in the About tab (570) |
| `config` (getter) | 39 | live `cfg` object. No consumer |
| `get(k, d)` | 40 | stored value, else a clone of `DEFAULTS[k]`, else `d`. Used by BO and ZM `tcGet` (ZM:29) |
| `set(k, v)` | 41 | `cfg[k]=v`, `save()` to `tc.options`, `emit(k, v)`. Used by BO and ZM `tcSet` (ZM:34) |
| `register({id,title,build(api)})` | 42 | adds a tab `reg:<id>` (after Shaders, before Keybinds) and emits `'__sections'`; a repeated `id` is ignored. `build` must return an array of nodes (spread into the screen at 574). ZM:146 (Zoom tab) |
| `registerKeybind({id,label,get,set,reset})` | 43 | listed in the Keybinds tab, emits `'__keybinds'`; a repeated `id` is ignored. ZM:137 (`defaultKey` is passed but never read) |
| `changed(cb)` | 44 | `cb(key, value)` on every set or emit; no way to unsubscribe. ZM:136 |
| `open()` | 45 | `openMenu` (async). No consumer |
| `toast(text)` | 46/61 | writes `#note.show` for 2 s; `console.log` if there's no `#note` |
| `fov {get,set}` | 122 | `getFov` / `setFov` (async). ZM:45, ZM:79 |
| `capturing` | 48, 394 | true while the Keybinds tab waits for a key. ZM:103,109 check it; SH and CH don't |
| `ui {h,T,row,note,header,btn,toggle,slider,item,refresh,toast,prettyKey}` | 583 | builder kit. Sections actually get `api()` (580), which adds `bus, currentKeyFor, fov` |
| `build`, `close` | 584-585 | `buildScreen` / `closeMenu`. No consumer |
| `_injectMenus,_injectUi,_patchHud,_patchSurvival,_injectSurvival,_rescaleLabels` | 92, 295-299 | test seams. Nothing in `tools/` or `compat/` uses them |

**localStorage**

| Key | Format | Writers | Readers |
|---|---|---|---|
| `tc.options` | JSON `{ui.scale, hud.on, input.sens, keys.map{src:def}, keys.mute[def], zoom.key, zoom.level, zoom.look}` | BO `save` (30); ZM:35 fallback only | BO:29 once at load; ZM:30 fallback |
| `tc.shader.<CFG key>` | `String(value)` | BO `setShader` (526) | SH:47-55, only at startup. The K toggle does **not** persist |
| `mc.fov` | number. The game accepts 30-110 (game:main.js:205-208) | game slider `oninput` (game:menus.js:1804-1806), BO `setFov` (118), ZM:80 | game, BO:96, ZM:44 |
| `mc.rd` | one of 4,6,8,10,12 (game:view.js:1) | game (game:main.js:2846), BO:141 | game, BO:124 |

**Shared DOM / CSS:** `#gl` canvas (BO, ZM: pointer-lock checks), `#screen` with class `on` and `#screen .inner` (BO, ZM), `.tc-marker` (BO's "our menu is open" flag, 94/560), `#inv.off` (BO:397), `#note.show` (BO toast, SH `notify`), `#chatbox` (CH), `#cross` (BO CSS scales it by `--tc-s`). BO's `<style>` (340-370) styles `#screen .inner .tc-*`, sets the pixel font, and hides the game's `Distance:` and `Fullscreen` pause buttons. BO still clicks the hidden Distance button (134-138). BO sets the root CSS variables `--u`, `--d`, `--tc-s`.

**Capture-phase listeners (all on `window`).** Listeners on the same target run in registration order, which is the script load order.

| Script | Events | Guards |
|---|---|---|
| BO | `keydown`/`keyup` (438-439), `click` (613), `mousemove` (616) | skips events marked `e.__tc` (its own synthetic events); calls `stopImmediatePropagation` when it swallows, remaps or mutes a key |
| ZM | `keydown`/`keyup` (102,108), `wheel` passive:false (114), `mousemove` (122) | `e.__tcCaptured`, `__tcOptions.capturing`, typing |
| SH | `keydown` KeyK (948) | typing and modifiers only. **No** check of `capturing` or `__tcCaptured` |
| CH | `focusin`, `keydown` (66,70) | runs only while `#chatbox` is visible |

How they avoid conflicts. While a key is being captured, BO marks the event `e.__tcCaptured=true` and calls `stopImmediatePropagation` (412-413). That blocks every listener registered after BO's. `bus.capturing` covers the scripts that registered before BO (ZM checks it). BO tags its own re-dispatched events (remaps at 431, F1 keydown at 160) with `ev.__tc=true` so its handler skips them (408). Remapping is skipped for mod keys (`modKeySet()`, 399/422) and while a screen is open, the inventory is open, or the user is typing (398). BO's and ZM's `mousemove` handlers each redefine `movementX/Y` with `defineProperty` and multiply sensitivity and zoom-look scale (commutative).

## 2. twitterentary-shaders.user.js (SH, 957 lines)

**Purpose:** patches the game's GLSL at `shaderSource` time: terrain VS (waving plus class lookup), terrain FS (lighting, AO, shadows, water, grading, fog), sky FS, and cloud FS (broken). It adds a sun shadow-map pass and drives everything with uniforms computed from GL calls it observes. **Metadata:** `@version 1.3.0`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.twitterentary`. In-code version strings: `debug()` `version:'1.3.0'` (928) and the load log `v1.3.0` (957). Both are in sync.

| Name | Line | Purpose |
|---|---|---|
| `CFG` | 17 | 23 settings (table below) |
| localStorage load | 47 | overrides CFG from `tc.shader.<k>`: bool `=== 'true'`, numbers if finite. No clamping |
| `SCHEMA` | 57 | 22 UI rows for BO: every CFG key except `shadowDepth`. `reload:true` on water, sky, clouds, shadowSize, shadowExtent, shadowTaps |
| `O` | 85 | the original prototype methods (15) |
| `clamp01, sstep, mixv, norm, cross, dot, F` | 92-98 | math helpers. `F` = `toFixed(4)` for baking numbers into GLSL |
| `patchTerrainVS` | 100 | anchors on `uniform vec3 uOrigin;`, `out vec2 vLight;` and the `vec3 p = …*0.0625+uOrigin;` regex (101). Adds 7 uniforms, `vRel`/`vCls`, the class `texelFetch`, and waving |
| `fsDecls` | 131 | FS uniforms plus `tcTone`, `tcWaveSlope` and `tcShadow`, with `shadowSize/Depth/Extent/Taps` **baked in** |
| `shadeCode(lit, alpha)` | 196 | replacement for the output line: vanilla early return when `uFx<0.5`, then the lighting model. The water block is included only if `CFG.waterEffects` |
| `patchTerrainFS` | 295 | `outRe` (296) captures lightmap use and alpha. `mode`: 2 = `alpha==='c.a'` (translucent), 1 = has `discard` (cutout), 0 = opaque |
| `skyCode`, `patchSky` | 311, 335 | inserts `uSkySun/uSkyDay/uFx` after `out vec4 o;` and replaces `o=vec4(c,1.0);` (lit) or `o=vec4(mix(uHor,uTop,sqrt(t)),1.0);` |
| `patchCloud` | 348 | **dead**: double-escaped regexes (350, 352) and a literal `\\n` in the inserted text |
| `patchSource` | 358 | dispatcher, needs `#version 300 es`: VS `aPos & uvec3`; FS `sampler2DArray`+`vShade`+`uFog`+`vDist`; sky `uTop, uHor`; cloud `uTint, uHole` |
| `FIXED_SUN, OBS, CAMLAST, locKind` | 372-382 | observation state. `locKind`: WeakMap<UniformLocation, 1..6> |
| `setCam`, `onSprite` | 384-385 | camera from cloud `uCam`; sun = first `uC` after `uTop` in the frame |
| `ATL` + indexOf hook | 392-402 | **global `Array.prototype.indexOf` wrapper** captures the block-name array searched for `'oak_planks'` (game:main.js:340). Never removed |
| `RE_EMIT, RE_PLANT, nameClass` | 403-411 | name → class 0 none, 1 leaves, 2 plant, 3 water, 4 emissive |
| `readAtlas` | 413 | per-layer transparency and mean RGB from the 16×16 array upload |
| `layerClass` | 433 | class by name, falling back to colour and animation heuristics |
| `uploadClasses` | 459 | 1-row RGBA8 texture (R = class) on unit 7, plus a console.info summary |
| `shaderSrc, progShaders, progInfo` | 474-476 | WeakMaps: shader→`{orig,info,patched}`, program→shaders, program→`info` |
| `curInfo, curVAO, frameId, shadowFrame, lastOrigin, haveOrigin, rec` | 478-481 | per-frame state. `rec`: Map<VAO, chunk record> |
| `UNIFORMS` | 483 | the 27 uniform names resolved for every patched program |
| proto wrappers | 488-600 | `shaderSource, compileShader, attachShader, linkProgram, getUniformLocation, uniform3f, uniform3fv, uniform1f, texImage3D, texSubImage3D, bindVertexArray, deleteVertexArray, clear` |
| `G` | 602 | GL resources (`clsTex, fbo, depthTex, prog, loc, shadowOk`) and shadow basis `sh` |
| `lightMat` | 607 | ortho light matrix relative to `sh.c0` with texel snap `dx,dy` |
| `ST, STATS, SCRATCH, isEnd` | 617-624 | derived per-frame state and counters. `isEnd` matches the End's skyLight colour (inferred) |
| `updateState` | 626 | once per `frameId`: time, cam, `dim`, day = `clamp01(OBS.top[2])` (blue of the zenith), sun, sunCol, cloud tint |
| `finalizeShadow` | 649 | decides `shadowOn` and `refresh` (`shadowEvery` frames, moved > `shadowMove`, or sun turned); fills `ST.lvp` |
| `makeProg`, `SHADOW_VS/FS` | 669, 685, 701 | shadow program built with `O.*`, bypassing the patcher. Plants and water (class 2-3) are culled; cutout uses `uCut` |
| `initGL` | 711 | on the first patched `useProgram`: clsTex on unit 7; if `CFG.shadows`, depthTex `DEPTH_COMPONENT24` on unit 6, FBO, shadow program |
| `applyUniforms` | 767 | runs `uploadClasses` when dirty, resolves locations lazily, and uploads everything when `info.gen !== ST.gen` |
| `pushCam` | 809 | re-uploads `uCam/uLVP/uShadowOn` after the camera fix-up |
| `useProgram` wrapper | 819 | `initGL`, sets `curInfo`, `OBS.lit`, `applyUniforms` |
| `renderShadow` | 830 | saves state, then draws every recorded chunk inside extent+margin into the FBO, then restores |
| `terrainDraw` | 888 | first terrain draw of a frame rebuilds the camera from `uOrigin` deltas, then `finalizeShadow`, `renderShadow`, `pushCam`; records the chunk for mode < 2 |
| `drawElements` wrapper | 917 | calls `terrainDraw` when `curInfo.terrain && curVAO && haveOrigin` |
| `debug`, `window.Twitterentary`, `notify`, K listener | 925, 936, 938, 948 | diagnostics, global, `#note` toast, KeyK toggles `CFG.enabled` |

**Game hook points:** WebGL2 prototype methods (list above). GLSL anchors are the regexes at 101-103, 296-298 and 337-340, plus the source checks in 359-368. Uniform names observed by wrapping `getUniformLocation`: `uOrigin, uCam` (only in programs that also have `uSize`, which is the cloud VS), `uTop, uC, uAmbient, uSkyLight`. The atlas is caught by `texImage3D(0x8C1A TEXTURE_2D_ARRAY, level 0, 16, 16, n, …, pixels=arg 9)` (game:gfx.js:923); animated layers by `texSubImage3D` (game:gfx.js:1091). Block names come from `Array.prototype.indexOf('oak_planks')`, and a frame tick from `clear(mask & COLOR_BUFFER_BIT)`. DOM: `#note`. Events: window `keydown` in capture phase. **Globals:** `window.Twitterentary = {cfg, schema, state: ST, stats: STATS, shadow: G.sh, obs: OBS, debug}`. There is **no `apply`**. **Storage:** `tc.shader.<key>` (read only).

**Data flow:** game `shaderSource(src)` → `patchSource` (358) → `{src, info}` stored in `shaderSrc` (497) → `compileShader` (501; if the patched shader fails, recompile the original) → `attachShader` records it (512) → `linkProgram` (519): if any attached shader is patched and the link succeeds, `progInfo.set(p, {prog, loc:null, mode, lit, gen:-1, terrainVS?, terrainFS?, sky?, cloud?, terrain})`; otherwise revert every shader and relink → the game enumerates uniforms (game:gfx.js:870), and the `getUniformLocation` wrapper tags `locKind` → game `useProgram(p)` → wrapper (819): `initGL` once, `curInfo = progInfo.get(p)`, `applyUniforms` (767: `updateState` once per frame, lazy `O.getUniformLocation` of the 27 `UNIFORMS`, upload if gen changed) → game `uniform3f(uOrigin)` updates `lastOrigin` → game `drawElements` → wrapper (917) → `terrainDraw` (888). On the frame's first terrain draw: camera fix-up, `ST.gen++`, `finalizeShadow`, then `renderShadow(gl)` (830) if mode < 2 and a refresh is due, then `pushCam`. Then it records `rec[curVAO] = {n, origin, world xyz, cut, seen, frame}` → original `drawElements`. Programs where only the VS matched (for example the stained-glass depth prepass, game:gfx.js:1285-1296, whose FS is `o = vec4(0.0)`) count as "partial": uniforms are applied but there's no `terrainDraw`.

**Texture units:** unit **7** = `G.clsTex` (class lookup, sampled by the terrain VS and the shadow VS). Unit **6** = `G.depthTex` (`sampler2DShadow uShadowMap`). They're bound once in `initGL` (717, 728) and never unbound. The game uses units 0-5 only (verified by grep). The shadow FS samples the atlas through `uTex = 0`, so it assumes the terrain atlas is bound on unit 0 when the first terrain draw happens (inferred).

**Observations (OBS):** `uniform3fv(uTop)` sets `OBS.top`, `topFrame = frameId`, `sunSeen = false` (572). The next `uC` upload (`uniform3f`/`3fv`, kind 4) in the same frame becomes `OBS.sun`, normalized (385-390). This relies on the sun sprite being the first `uC` after the sky (game:gfx.js:1331→1343, and 1382→1398 via `sprite()`). `uC` is also set by pChat (game:gfx.js:1576) and signs (game:signs.js:264). `uniform1f(uAmbient)` sets `OBS.amb`, and `uniform3fv(uSkyLight)` sets `OBS.sl`. `dim` is 1 when `amb > 0.05` (Nether, inferred) and 2 when `isEnd(sl)` (End, inferred), checked only when `OBS.lit`. The camera comes from the cloud `uCam` (`setCam`), corrected per frame by `e.ox - lastOrigin` on a VAO drawn in the previous frame (896).

**CFG ↔ SCHEMA ↔ uniform ↔ GLSL**

| CFG key (default) | SCHEMA label / range | Path | GLSL use (SH line) |
|---|---|---|---|
| enabled (true) | Shaders on, bool | `uFx` (780); gates `ST.shadowOn` (651); K toggle (952) | VS wave gate 111; FS vanilla return 198; sky 313; cloud 354 (dead) |
| shadows (true) | Sun shadows, bool (no reload flag) | `ST.shadowOn` → `uShadowOn`; `initGL` allocates only if true at init (726) | FS 268 |
| shadowSize (2048) | Shadow resolution 1024-4096, reload | depthTex size (731), viewport (845), texel snap (650) | baked `SZ`, `texel` (132-133) → 176, 183 |
| shadowExtent (56) | Shadow range 16-96, reload | `lightMat` E (608), culling (852), texel (650) **read live** | baked `texel` (133) → bias 176 |
| shadowDepth (256) | not in SCHEMA | `lightMat` Zd (608) | baked `Z` → bias 180 |
| shadowEvery (8) / shadowMove (6) | Shadow update (frames 1-30 / blocks 1-16), live | `finalizeShadow` 655-656 | — |
| shadowTaps (8) | Shadow softness 4-16, reload | baked `TAPS` (134) | loop 185-190 |
| waving (true) | Waving leaves & plants, bool | `uWaveOn` (795) | VS 111 |
| leafSway (0.028) / plantSway (0.075) | 0-0.15 / 0-0.3 | `uLeafSway` / `uPlantSway` | VS 119 |
| waterEffects (true) | Water effects, reload | build time, `shadeCode` (200) | water block 201-219 |
| waveStrength (1.0) | 0-2 | `uWaveStr` | `tcWaveSlope` 173 (water only) |
| skyEffects / cloudEffects (true) | Sky / Clouds, reload | `patchSky` 336 / `patchCloud` 349 gates | sky / cloud patches |
| sunStrength (0.90) | Sun light 0-2 | `uSunStr` | 269 |
| ambientStrength (1.0) | Ambient light 0-2 | `uAmbStr` | 258 |
| blockLight (1.0) | Block light 0-2 | `uBlockStr` | 261 |
| aoPower (1.5) | Contact shadows (AO) 0.5-3 | `uAoPow` | 242 |
| emissive (1.15) | Emissive glow 0-2 | `uEmissive` | 277 |
| exposure / saturation / contrast (1.0 / 1.12 / 1.05) | 0.4-2 / 0-2 / 0.5-1.8 | `uExposure / uSaturation / uContrast` | 282 / 285 / 286 |

Uniforms derived from state rather than CFG: `uTime` (ST.time: VS waving, water), `uCam` (VS 112, water 202), `uSunDir` (= `sunL`, y ≥ 0.14: 264, 271), `uSunCol` (269, 211, 290), `uZenith` (= OBS.top: 209), `uSkySun` (raw sun: 210, 265, 290, sky 317-328), `uDay` (246), `uSkyDay` (sky 316), `uDim` (256-266), `uLVP` (177), `uShadowMap` = 6, `uClsTex` = 7, `uCloudTint` (dead). The lit FS also uses the game's own `uAmbient` (224; declared in game lit FS, gfx.js:269).

**Hot paths:** the `uniform3f/3fv/1f` wrappers do a `WeakMap.get` on every uniform call in the game (one `uOrigin` per chunk per pass). The `drawElements` wrapper runs on every draw call; `terrainDraw` adds a `Map.get` plus field writes per terrain draw. `useProgram` does a `WeakMap.get`, and patched programs get about 27 uniform uploads at most twice per frame. `texSubImage3D` does a `Set.has`. `Array.prototype.indexOf` adds a wrapper call on every `indexOf` in the page, forever. `renderShadow` runs every `shadowEvery` frames or on movement: 11 state queries (6 `getParameter` + 5 `isEnabled`), an `Array.from`, iterating all of `rec`, and one draw per chunk in range at 2048². GPU cost: 8 shadow taps plus water `pow`s per terrain fragment. **Settings:** uniform-backed keys plus enabled, shadowEvery and shadowMove apply on the next frame, since CFG is read every frame. waterEffects, sky, clouds, shadowSize, shadowTaps and shadowDepth need a reload. shadowExtent is half live (issue 5). Turning `shadows` on needs a reload if it was off at load. The K toggle is live and is not saved.

## 3. tweetcraft-better-options.js (BO, 639 lines)

**Purpose:** replaces the game's "Options…" screen with a tabbed menu (Graphics, Shaders, registered mod tabs, Keybinds, About). Hosts the settings bus. Adds UI/HUD scale, mouse sensitivity, game-key remapping, FOV (down to 2) and render distance. **Metadata:** `@version 1.0.0`, `@run-at document-start`, `@grant none`. In-code `bus.version = '2.2.0'` (38) doesn't match.

| Name | Line | Purpose |
|---|---|---|
| `TAG, MENU_NAME='tcoptions', STORE_KEY, RDS, DEFAULTS` | 15-26 | constants. Defaults: `ui.scale 1, hud.on, input.sens 1, keys.map {}, keys.mute []` |
| `cfg, save, clone` | 28-31 | `tc.options` load and save |
| `sections, keybinds, subs, bus, emit` | 33-52 | the bus (see §1). `emit` swallows errors |
| `store, isTyping, $, toast` | 54-73 | localStorage wrapper, helpers, `#note` toast |
| `domReady, menus, _injectMenus` | 76-92 | lazy, memoized `import('/js/menus.js')` after DOMContentLoaded |
| `ourMenuOpen` | 94 | `#screen .inner .tc-marker` exists |
| `fovCache, getFov, stealFovInput, setFov, bus.fov` | 96-122 | opens game Options, grabs `input[type=range][data-k="fov"]`, sets `min=5, step=any`, reopens our menu or closes; `setFov` writes `mc.fov` and dispatches `input` |
| `currentRd, setRenderDistance` | 124-143 | `openPause()`, clicks `button[aria-label^="Distance:"]` until it matches (≤ 12 tries), writes `mc.rd` |
| `toggleFullscreen, toggleHud` | 145-165 | toggleHud saves `hud.on` and dispatches a synthetic F1 keydown (`__tc`) and keyup (no `__tc`) |
| `isTouch, uiMult, uiBase` | 168-178 | `uiBase` copies the game's `--u/--d` formula (game:main.js:480-489) |
| `applyUiScale, reassertUiScale` | 179-195 | sets `--u, --d, --tc-s`; the reassert runs on a 250 ms interval |
| `noteFont, hudScale, patchHudScale` | 198-224 | wraps `Hud.prototype.draw` (`o.gs`), `suggestions` (arg0), `tab` (arg1), `hint` (arg1), marked `__tcScaled`; captures the bitmap font |
| `patchSurvivalScale` | 227 | wraps `SurvivalClient.prototype.drawHud(hud, font, gs)` |
| `redrawButtonLabels, rescaleLabels, startLabelObserver` | 245-293 | redraws the canvas labels of `button.mcb` at the scaled px; MutationObserver on `#screen` subtree |
| test seams | 295-299 | `_injectUi, _patchHud, _patchSurvival, _injectSurvival, _rescaleLabels` |
| `h, T, row, note, header, btn, toggle, slider, item` | 301-337 | DOM builders (game-styled `mcb` buttons, `tc-range` sliders) |
| `ensureCSS` | 340 | one `<style>` (see §1) |
| `fovRow, rdRow, fullscreenRow, scaleRow, hudRow` | 372-389 | Graphics tab rows |
| `KEYNAMES, keyName, capturing, setCapturing` | 391-394 | key-capture state. Mirrors `bus.capturing` |
| `screenIsOn, invClosed, remapActive, modKeySet` | 396-403 | remap gating; `modKeySet` = codes of registered mod keybinds |
| `onKeyCapture, onKeyCaptureImpl` + listeners | 404-439 | capture-mode swallow, `keys.map` remap re-dispatch (`__tc`), `keys.mute` block |
| `currentKeyFor, bindEntry` | 441-458 | game binds are stored as `map[newKey]=def` with `def` muted; mod binds call `entry.set` |
| `GAME_ACTIONS, keybindEntries, entryKey` | 460-471 | 13 game actions (WASD, Space, Shift, Ctrl, Q, E, T, F5, F3, F1) plus mod keybinds |
| `keybindsSection, prettyKey` | 473-499 | Keybinds tab, including the mouse sensitivity slider (`input.sens`) |
| `shadersSection, setShader, defaultShaderSchema` | 501-540 | Shaders tab from `TE.schema`; `setShader` writes `cfg` and `tc.shader.*` and calls the nonexistent `TE.apply` |
| `curTab, tabsList, buildScreen, api` | 542-582 | screen builder; `reg:` sections get `build(api())` |
| `bus.ui, bus.build, bus.close` | 583-585 | exports |
| `openMenu, closeMenu, refresh` | 587-602 | `M.showScreen('tcoptions', buildScreen, 'dim')`, `M.back()`, `M.refresh()` |
| `onDocClick` | 604 | capture click on `button[aria-label="Options…"/"Options..."]` opens our menu |
| `sensMult` + mousemove | 615-625 | scales `movementX/Y` under pointer lock on `#gl` |
| init | 627-636 | `applyUiScale`, CSS, `tryPatch` (10 tries × 300 ms), label observer, `resize` (2×), `setInterval`, `fullscreenchange` |

**Game hooks:** `import('/js/menus.js')` for `openOptions, closeMenu, openPause, showScreen, back, refresh`; `import('/js/ui.js')` for `Hud.prototype.{draw,suggestions,tab,hint}`; `import('/js/survival/client.js')` for `SurvivalClient.prototype.drawHud`. Selectors: `#screen(.on) .inner`, `input[type="range"][data-k="fov"]`, `button[aria-label^="Distance:"]`, `button[aria-label="Options…"]`, `button.mcb` (skips `.hb`), `#inv.off`, `#gl`, `#note`, `#cross`. CSS variables `--u` and `--d`. A synthetic `F1` key toggles the game HUD. **Globals:** `window.__tcOptions`. **Storage:** `tc.options`, `tc.shader.*` (write), `mc.fov`, `mc.rd`. **Hot paths:** `mousemove` (every event: `bus.get`; when sens ≠ 1 also `getElementById` and 2× `defineProperty`). `keydown`/`keyup` (allocates `modKeySet()`, and when `keys.map` is unset `bus.get` JSON-clones the default). `Hud.draw` wrapper every HUD frame (`Object.assign` when scale ≠ 1). `suggestions/tab/hint` rest args on every call. The 250 ms interval (`bus.get` each tick; when `ui.scale` ≠ 1 also `uiBase()` → `matchMedia`). The MutationObserver redraws labels on every screen rebuild. **Settings:** all live. `ui.scale` is read by every wrapped call, `input.sens` per event, keys per event. FOV applies through the game's slider handler, render distance through the game's Distance button. `hud.on` is only shown as a label and is never re-applied at load. Shader rows are live except those marked (reload).

## 4. tweetcraft-zoom.user.js (ZM, 162 lines)

**Purpose:** hold a key (default `KeyC`) to divide FOV by `zoom` (1.5-20, mouse wheel adjusts while held) and scale mouse look by `look/zoom`. **Metadata:** `@version 1.1.0`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.zoom` (SH, BO and CH use `tweetcraft.twitterentary`). No in-code version string.

| Name | Line | Purpose |
|---|---|---|
| `DEFAULTS, KEY, zoom, look, zooming, orig` | 15-19 | `{key:'KeyC', level:4, look:1}` |
| `log, typing, gl, screenOn, canZoom` | 21-25 | helpers. `canZoom` = no screen, not typing, `#gl` present |
| `tcGet, tcSet` | 27-36 | `zoom.<k>` through the bus, or directly in `tc.options` |
| `refreshConfig` | 38 | reloads KEY, zoom and look with clamping |
| `fovCache, getFov` | 44-45 | `bus.fov.get()` or own cache of `mc.fov` |
| `domReady, menus, localStealFov, setFov` | 48-83 | fallback copy of BO's FOV plumbing; `setFov` delegates to `bus.fov.set` when BO exists |
| `start, stop` | 85-98 | `orig=getFov(); setFov(orig/zoom)` / restore |
| listeners | 102-131 | keydown/keyup capture (bus guards), `blur`→stop, `wheel` (only while zooming; stops propagation), `mousemove` |
| `registerWithBus` | 133-158 | polls every 200 ms; `changed`→`refreshConfig`; `registerKeybind('zoom')`; `register` Zoom tab (level and look sliders, reset button) |

**Game hooks:** `menus.js` `openOptions/closeMenu` and the FOV slider (fallback only), `#screen.on`, `#gl`, `mc.fov`. **Globals:** none. **Storage:** `tc.options` → `zoom.key/level/look`; `mc.fov` (transient zoom value). **Hot paths:** `mousemove` and `wheel` do almost nothing unless zooming. **Settings:** live through `bus.changed` → `refreshConfig`.

## 5. tweetcraft-chat-history.js (CH, 97 lines)

**Purpose:** Up and Down in `#chatbox` recall the last 100 sent lines (memory only, lost on reload). **Metadata:** `@version 1.0.0`, `@run-at document-start`, `@grant none`. No in-code version.

| Name | Line | Purpose |
|---|---|---|
| `MAX, hist, cursor, draft, tracking` | 15-20 | state |
| `box, chatOpen` | 22-27 | `#chatbox`, visible when `!hidden` (game:main.js:2796/2807) |
| `reset, record, setValue` | 29-49 | `record` trims, de-duplicates consecutive lines, caps at 100 |
| `up, down` | 51-64 | saves the draft on the first Up; Down past the end restores it |
| `focusin` capture | 66 | `reset` when `#chatbox` gains focus |
| `keydown` capture | 70 | Enter → `record(value)` (before the game clears it). Up/Down without modifiers → `queueMicrotask` then `defaultPrevented` check |
| `window.__mcChatHistory` | 92 | `{list (getter copy), clear(), record}` |

**Hooks:** `#chatbox`, window `focusin`/`keydown` capture. **Hot path:** keydown, cheap. **Settings:** none.

## 6. Issues & smells

| # | Where | Why it matters | Suggested fix |
|---|---|---|---|
| 1 | SH `patchCloud` 350, 352 | regex literals use `\\s`/`\\(`, so they never match (known in compat). The inserted text `'\\nuniform…'` is a literal backslash-n, so fixing only the regex would produce a GLSL compile error | single escapes in both regexes and `'\n'` in the string; then remove `known` in compat |
| 2 | SH indexOf hook 395-401 | wraps every `Array.prototype.indexOf` in the page forever, even after the names are captured | restore `Array.prototype.indexOf = origIdx` once `ATL.names` is set (or after a timeout) |
| 3 | SH `renderShadow` 833-840 | 6 `getParameter` + 5 `isEnabled` + `Array.from(VIEWPORT)` per refresh (every 8 frames or on movement); sync queries can stall | track state in the wrappers, or restore the state gfx.js sets per pass |
| 4 | SH `initGL` 726 vs SCHEMA 59 | `shadows` has no reload flag, but the FBO and program are created only if it was true at init, so turning it on live does nothing | allocate lazily on the first `shadowOn`, or mark `reload` |
| 5 | SH `lightMat` 608, `finalizeShadow` 650, `renderShadow` 852 vs `fsDecls` 133 | `shadowExtent` is marked reload but read live, while the GLSL texel bias stays baked, so values are inconsistent until reload | snapshot extent at init, or pass texel as a uniform |
| 6 | SH K listener 948-955 | ignores `__tcOptions.capturing`/`e.__tcCaptured` (breaks the rule if SH loads before BO); not registered via `registerKeybind`, so it can't be rebound and isn't in `modKeySet`; not saved | add the guards, `registerKeybind({id:'shaders',…})`, write `tc.shader.enabled` |
| 7 | SH `drawElements` 920, `useProgram` 826 | `console.error` per call, so a persistent throw floods errors every frame; 920 disables shadows for any error | log once (flag), and disable the patch path after repeated errors |
| 8 | SH globals 478, 602 vs game:dragonview.js:54,177 | `G/curInfo/curVAO/frameId` are shared by all WebGL2 contexts; the dragon view's own `clear` bumps `frameId`, which skews `shadowEvery` | keep state per context (`WeakMap<gl,…>`), count frames only on the main canvas |
| 9 | SH CFG load 47-55 | no clamping, so for example `tc.shader.shadowSize=16384` or `shadowEvery=0` goes straight to GL | clamp using `SCHEMA` min/max |
| 10 | SH `getUniformLocation` 551, `onSprite` 385, `updateState` 636 | the sun is "the first `uC` after `uTop`" (sprite, pChat and signs all use `uC`) and day = zenith blue channel; both heuristics depend on game draw order and palette | tag only the sprite program's `uC`; add compat entries for these assumptions |
| 11 | SH `renderShadow` 867, `initGL` 754 | assumes one `TRIANGLES/UNSIGNED_INT/offset 0` draw per VAO (true today, game:gfx.js:1320) and the atlas on unit 0 (the game binds `tArr` there, game:gfx.js:921-922; inferred to hold at draw time) | store `mode/type/offset` in `rec`; bind the atlas explicitly |
| 12 | SH `texSubImage3D` 594 → `uploadClasses` 459 | each newly seen animated layer triggers a full reclassify plus `console.info` inside the game's `useProgram` | debounce to once per frame or second; log only on change |
| 13 | SH `debug` 928, log 957 | version `1.3.0` is hard-coded twice; easy to miss on bump | read `GM_info.script.version` (rules: never hard-code it) |
| 14 | BO `bus.version` 38 | `'2.2.0'` vs `@version 1.0.0`, and the About tab (570) shows the wrong one | `bus.version = GM_info.script.version` |
| 15 | BO `setShader` 527 | calls `TE.apply`, which SH never defines (936); dead branch. It works only because SH reads CFG every frame | add `Twitterentary.apply()` (for example a uniform re-push) or remove the call |
| 16 | BO `toggleHud` 162 | the synthetic F1 keyup has no `__tc`, so it goes through remap: swallowed if F1 is muted, or re-dispatched if F1 is a remap source | set `__tc = true` on the keyup too |
| 17 | BO `toggleHud` 156, `hudRow` 388 | `hud.on` is saved but never applied at load and not updated by a real F1, so the label desyncs | read the game's HUD state, or apply `hud.on` at startup |
| 18 | BO init 635 (`uiTimer`) | `setInterval(reassertUiScale, 250)` runs forever. At scale 1 it returns after a `bus.get` (189), but at any other scale it recomputes `uiBase()` (`matchMedia`) and reads three CSS properties 4× a second | MutationObserver on `<html style>`, or reassert on resize only |
| 19 | BO `uiBase` 170-178, `applyUiScale` 179 | copies the game formula (game:main.js:480-489). Its touch test differs: it re-runs `matchMedia('(pointer: coarse)')` each call and ignores the game's `?touch` param (game:main.js:120). It also overwrites `--u/--d` even at scale 1, and `hp` is unused | multiply the game's current value; do nothing when `m === 1` |
| 20 | BO 51, 223, 242, 405 | `catch (e) {}` in `emit`, `patchHudScale`, `patchSurvivalScale`, `onKeyCapture` hides failures | `console.warn(TAG, …)` once |
| 21 | BO `Hud.draw` wrapper 211, `wrapScale` 218 | `Object.assign` every HUD frame when scale ≠ 1. The `suggestions/tab/hint` wrappers allocate a rest-args array on every call, even at scale 1 | mutate and restore `o.gs`; use fixed-arity wrappers |
| 22 | BO `redrawButtonLabels` 245, observer 285 | re-renders every `button.mcb` label on each screen rebuild even at scale 1 | return early when `m === 1` and `__tcPx` is unset |
| 23 | BO `stealFovInput` 99-115 | no in-flight guard: `fovInput` is only set after `await menus()` (101, 106), so two first calls in the same task each open and close the game Options screen. That's a narrow window today: every body after the await is synchronous, and callers (`openMenu` 592, the FOV slider, Zoom) run in separate events. It also caches a detached `<input>` and relies on its `oninput` closure (game:menus.js:1804-1806) | memoize the promise; re-steal if the game rebuilds |
| 24 | BO `setFov` 117 vs 110 | clamps to ≥ 2, but the stolen range has `min='5'`, so the browser clamps to 5 and zoom beyond ~14× does nothing | set `el.min = '2'` |
| 25 | BO `setFov` 118 + game `oninput` | the transient zoom FOV is saved to `mc.fov`; after a reload while zoomed the game rejects < 30 (game:main.js:206) and the FOV resets to default | add a `temp` flag to `fov.set` that skips persistence |
| 26 | BO `onKeyCaptureImpl` 422-423, `keyName` 392 | allocates per key event; remapped modifiers get `key:'ShiftLeft'` and keep the source's `shiftKey` flags | cache `modKeySet` on register; add Shift/Control names and flags |
| 27 | BO `defaultShaderSchema` 529-540 | duplicate of SH SCHEMA (drift); dead while `TE.schema` exists | delete it, or derive from `cfg` keys |
| 28 | BO `bindEntry` 448 | mod keybinds are set without checking for conflicts with game keys or other mods | reject codes used by `GAME_ACTIONS` or other mods |
| 29 | BO `shadersSection` 511-514 | only bool rows toast "reload to apply"; numeric reload rows say nothing | toast for any `f.reload` change |
| 30 | BO `toast` 61 / SH `notify` 938 | two writers to `#note` with separate timers; one hides the other's message early | SH should use `__tcOptions.toast` when present |
| 31 | ZM `registerWithBus` 133-135 | polls every 200 ms forever when BO isn't installed | cap retries (for example 50) |
| 32 | ZM `changed` callback 136 | `refreshConfig` runs on any bus change (every key, `'__sections'`); resets the wheel-adjusted `zoom` (118) mid-zoom without re-applying FOV | filter `k.startsWith('zoom.')`; skip while `zooming` |
| 33 | ZM default `KeyC` 15 | the game uses `KeyC` to confirm undo preview (game:main.js:2346); both fire (no `preventDefault`) | skip while the undo preview is up, or change the default |
| 34 | ZM `start` 85-91 | the first zoom triggers the steal: the game Options screen flashes and pointer lock is lost and re-requested (73 / BO:113) (inferred UX) | steal the FOV input once at load |
| 35 | CH keydown 84-89 | the microtask runs right after this capture listener (microtask checkpoint between listeners for browser events), before the game's `suggest.key(e)` → `preventDefault` (game:main.js:2331), so history and suggestions both move on Up/Down | check the suggestion list's visibility, or defer with `setTimeout(0)` |
| 36 | CH `up/down` 51-64 | no `preventDefault`, so the input's default ArrowUp caret move runs after `setValue` (inferred), leaving the caret at the start | `preventDefault` once you know you're handling the key |
| 37 | CH keydown 70 | doesn't check `__tcOptions.capturing`/`__tcCaptured` (rule); low risk because it runs only while chat is open | add the guard for consistency |
| 44 | BO `setFov` 116-117 | clamps FOV to 2-110 and writes it to `mc.fov`, but the game only accepts 30-110 on load (game:main.js:205-208). Any FOV below 30, e.g. a reload while zoomed, comes back as 70 | keep the stored `mc.fov` at 30 or more, and hold the low zoom FOV only in memory |
| 45 | BO `patchHudScale` 211 + 221 | **hint and tab are scaled twice** when UI scale ≠ 1. `Hud.draw` passes its already-scaled `o.gs` to `this.hint`/`this.tab` (game:ui.js:515-516, their only callers), and the `wrapScale('hint'/'tab')` wrappers scale it again (gs·m²). `hint` partly clamps to the screen; the `tab` player list doesn't | drop the `hint`/`tab` wrappers (`draw` already covers them), keeping `suggestions` |
| 46 | SH `SHADOW_VS` 696 | copies only the plain tile UV, but the game's terrain VS remaps UVs for shaped faces (`aPos.y >> 12u`, `RECT[]`/`BOXUV[]`), so cutout shadows of shaped blocks (torches...) sample the wrong texels | port the game VS's UV remap into `SHADOW_VS` |
| 47 | BO `isTouch` 168 | ignores the game's `?touch` URL param (the game: `matchMedia(...) \|\| params.has("touch")`), so with `?touch` `uiBase()` gives a different `--u` and overrides the game's even at scale 1 | also check `new URLSearchParams(location.search).has('touch')` |
