# Codemap: our Tweetcraft userscripts

Verified on 2026-11-02 against the working copies and game build c111547912 (re-verified from d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). Abbreviations: **SH** `twitterentary-shaders.user.js`, **BO** `tweetcraft-better-options.js`, **ZM** `tweetcraft-zoom.user.js`, **CH** `tweetcraft-chat-history.js`, **game:** = `game/prod/<LATEST>/pretty/js/` (`game style.css` = `pretty/style.css`); its line numbers are those of build c111547912. `SH:120` means file:line. Anything not checked directly in code is marked (inferred).

## 1. How the scripts relate

All four scripts are standalone `document-start` IIFEs on `https://tweetcraft.jai.vin/*`.

- **BO is the hub.** It sets up `window.__tcOptions` synchronously when it runs (BO:62).
  - The tooling loads BO first (`tools/lib/common.mjs:63-68`), and ZM polls every 200 ms until the bus exists (ZM:133-135), so for the bus itself load order doesn't matter.
  - Load order does decide which capture listener on `window` runs first.
- **SH** only needs to wrap `WebGL2RenderingContext.prototype` before gfx.js creates its context and compiles its shaders in the `Gfx` constructor (game:gfx.js:723).
  - It reads `tc.shader.<key>` once at startup, clamped (SH:128-133), and publishes `window.Twitterentary` (SH:1338).
  - Its `set`, `applyPreset` and `reset` write the settings back.
  - It uses the bus only for `toast` (SH:1345-1346) and `capturing` (the K guard, SH:1358).
- **BO's Shaders tab** reads `Twitterentary.cfg`, `.schema` and `.presets` each time the tab is built, and writes through `TE.set`, `applyPreset` and `reset` (BO:702-721).
  - With an older SH without `set`, it writes `cfg[key]` and `tc.shader.<key>` itself.
- **CH** shares nothing with the others.
- **Shared storage and DOM:**
  - BO writes the game's `mc.fov` and `mc.rd`; ZM writes `mc.fov` when BO is missing.
  - BO and SH both show toasts in `#note`. SH goes through `__tcOptions.toast` when BO is there.

```
  localStorage:   tc.shader.*             tc.options (JSON)            mc.fov / mc.rd (game-owned)
                  SH r/w, BO clears       BO r/w (ZM if no BO)         game + BO r/w (ZM if no BO)

  +----------------+ cfg/schema/presets, +---------------------+  register, registerKeybind,  +--------+
  | SHADERS        |<- set/applyPreset/ -| BETTER OPTIONS      |<---- changed, get/set, ------| ZOOM   |
  | window.        |   reset             | window.__tcOptions  |      fov.get/set, capturing  |        |
  | Twitterentary  |-- toast, capturing->| (bus)               |                              +---+----+
  +-------+--------+                     +----------+----------+                                  |
          | wraps WebGL2 prototype                  | imports menus.js, i18n.js, ui.js,           | menus.js
          v                                         v survival/client.js                          | (fallback)
     game gfx.js GL calls                      game menus / HUD  <--------------------------------+
                                               #screen, "Options…" (any language), F1, Distance, --u/--d

  CHAT HISTORY --> #chatbox keydown (standalone)
```

**Bus `window.__tcOptions`** (all defined in BO)

| Member | BO line | Notes / consumers |
|---|---|---|
| `version` | 40 | `VERSION` = `GM_info.script.version` (20), `'0.0.0'` without `GM_info`. Shown in the About tab (853) |
| `apiVersion` | 41 | `2` since 1.1.0 (adds `reset`, `ui.cycle`). Checked by compat; no script consumer yet |
| `config` (getter) | 42 | live `cfg` object. No consumer |
| `get(k, d)` | 43 | stored value, else a clone of `DEFAULTS[k]`, else `d`. Used by BO and ZM `tcGet` (ZM:29) |
| `set(k, v)` | 44 | `cfg[k]=v`, `save()` to `tc.options`, `emit(k, v)`. Used by BO and ZM `tcSet` (ZM:34) |
| `reset()` | 46-51 | `cfg = clone(DEFAULTS)`, `save()`, then emits every key that was set before as `(k, bus.get(k))`: the default for BO's keys, `undefined` for mod keys (`zoom.*`). ZM re-reads through `changed` → `refreshConfig`. Used by `resetAll` (821) |
| `register({id,title,build(api)})` | 52 | adds a tab `reg:<id>` (after Shaders, before Keybinds) and emits `'__sections'`; a repeated `id` is ignored. `build` must return an array of nodes (spread into the screen at 889). ZM:146 (Zoom tab) |
| `registerKeybind({id,label,get,set,reset})` | 53 | listed in the Keybinds tab, emits `'__keybinds'`; a repeated `id` is ignored. ZM:137 (`defaultKey` is passed but never read). `reset` may be async: `resetAll` awaits it |
| `changed(cb)` | 54 | `cb(key, value)` on every set or emit; no way to unsubscribe. ZM:136 |
| `open()` | 55 | `openMenu` (async). No consumer |
| `toast(text)` | 56/71 | writes `#note.show` for 2 s; `console.log` if there's no `#note`. SH `notify` (SH:1345) |
| `fov {get,set}` | 197 | `getFov` / `setFov` (async). ZM:45, ZM:79 |
| `capturing` | 58, 586 | true while the Keybinds tab waits for a key. ZM:103,109 and SH:1358 check it; CH doesn't |
| `ui {h,T,row,note,header,btn,toggle,cycle,slider,item,refresh,toast,prettyKey}` | 902 | builder kit. Sections actually get `api()` (899-901), which adds `bus, currentKeyFor, fov` |
| `build`, `close` | 903-904 | `buildScreen` / `closeMenu`. No consumer |
| test seams | 102, 164, 228, 394-398 | `_injectMenus`, `_labels` (compat's i18n check), `_setRenderDistance` (no consumer yet), `_injectUi, _patchHud, _patchSurvival, _injectSurvival, _rescaleLabels` (unused by `tools/` and `compat/`) |

**localStorage**

| Key | Format | Writers | Readers |
|---|---|---|---|
| `tc.options` | JSON `{ui.scale, hud.on, input.sens, keys.map{src:def}, keys.mute[def], zoom.key, zoom.level, zoom.look}` | BO `save` (32), also from `bus.reset` (49); ZM:35 fallback only | BO:31 once at load; ZM:30 fallback |
| `tc.shader.<CFG key>` | `String(value)`; removed when it equals the default | SH `persist` (SH:135, from `set`/`applyPreset`, which includes the K toggle); SH `reset` removes every `tc.shader.*` key (SH:1314); BO `setShader` fallback (707) and `clearShaderKeys` (694) | SH:128-133, only at startup, through `coerce` |
| `mc.fov` | number. The game accepts 30-110 (game:main.js:223-226) | game slider `oninput` (game:menus.js:1805-1809), BO `setFov` (193), ZM:80 | game, BO:168/172, ZM:44 |
| `mc.rd` | one of 4,6,8,10,12 (game:view.js:1) | game `cycleRd` (game:main.js:3002-3004), BO:225 | game (game:main.js:248), BO:199 |

**Shared DOM / CSS:**
- **Elements:** `#gl` canvas (BO, ZM: pointer-lock checks), `#screen` with class `on` and `#screen .inner` (BO, ZM), `.tc-marker` (BO's "our menu is open" flag, 166/879), `#inv.off` (BO:589), `#hudtop` (BO:247, the game's HUD state), `#note.show` (BO toast, SH `notify` fallback), `#chatbox` (CH), `#cross` (BO CSS scales it by `--tc-s`).
- **BO's `<style>` (`ensureCSS`, 480-525):** styles `#screen .inner .tc-*`, sets the pixel font, sizes captions with `--tc-f`, scopes its button text rules to `#screen .inner:has(> .tc-marker)` (our screen only), and hides the game's English `Distance:` and `Fullscreen` pause buttons.
- **`<style id="tc-options-i18n">` (139-154):** hides the same two buttons by their translated labels.
- **Distance:** BO still clicks the hidden Distance button (217-223).
- **CSS variables:** BO sets the root variables `--u`, `--d` and `--tc-s`.

**Capture-phase listeners (all on `window`).** Listeners on the same target run in registration order, which is the script load order.

| Script | Events | Guards |
|---|---|---|
| BO | `keydown`/`keyup` (630-631), `click` (933), `mousemove` (936) | skips events marked `e.__tc` (its own synthetic events); calls `stopImmediatePropagation` when it swallows, remaps or mutes a key |
| ZM | `keydown`/`keyup` (102,108), `wheel` passive:false (114), `mousemove` (122) | `e.__tcCaptured`, `__tcOptions.capturing`, typing |
| SH | `keydown` KeyK (1356) | modifiers, repeat, `e.__tcCaptured`, `__tcOptions.capturing`, typing (`e.target`). Not a registered keybind (issue 6) |
| CH | `focusin`, `keydown` (66,70) | runs only while `#chatbox` is visible; skips IME composition (71) |

**How they avoid conflicts:**
- **Key capture:** while a key is being captured, BO marks the event `e.__tcCaptured=true` and calls `stopImmediatePropagation` (604-605). That blocks every listener registered after BO's. `bus.capturing` covers the scripts that registered before BO (ZM and SH check it).
- **BO's own events:** BO tags its re-dispatched events with `ev.__tc=true` so its handler skips them (600): the remaps (623), and the F1 keydown and keyup (250/253).
- **When remapping is skipped:** for mod keys (`modKeySet()`, 591/614), and while a screen is open, the inventory is open, or the user is typing (590).
- **Mouse look:** BO's and ZM's `mousemove` handlers each redefine `movementX/Y` with `defineProperty`, multiplying in sensitivity and the zoom-look scale. The order doesn't matter (commutative).

## 2. twitterentary-shaders.user.js (SH, 1367 lines)

**Purpose:** patches the game's GLSL at `shaderSource` time:
- terrain VS: waving, plus the class lookup;
- terrain FS: lighting, AO, shadows, water, grading and fog;
- sky FS;
- cloud FS (broken).

It adds a sun shadow-map pass, and drives everything with uniforms computed from GL calls it observes. Every setting applies live, and Quality/Look presets set groups of them.

**Metadata:** `@version 1.4.0`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.twitterentary`. The in-code `VERSION` (16-18) reads `GM_info.script.version` (`'dev'` without `GM_info`) and feeds `debug()` (1327) and the load log (1366), so there's nothing to keep in sync.

| Name | Line | Purpose |
|---|---|---|
| `TAG, VERSION` | 15-18 | |
| `CFG` | 21-51 | 25 settings (table below). The defaults are Quality Medium + Look Natural |
| `DEFAULTS` | 52 | frozen copy of `CFG` |
| `SCHEMA` | 55-77 | 21 UI rows for BO: every CFG key except `shadowDepth`, `shadowTaps`, `shadowCull` and `cloudEffects`. `group` (`quality`/`look`) names the preset picker that owns the key; `section` is its heading in the tab. Types `bool`, `num` (`min/max/step`) and `choice` (`options: [[value, label]…]`). No `reload` flags |
| `FIELD, HIDDEN_RANGE` | 78-81 | key → SCHEMA row; clamp ranges for the keys without a row (`shadowDepth` 64-1024, `shadowTaps` 2-16) |
| `RANGE` | 82-84 | `[min, max]` of every numeric key (the SCHEMA range, or `HIDDEN_RANGE`), shared by `coerce` and `cfgNum` |
| `PRESETS, GROUP_KEYS, deepFreeze` | 86-104 | `{quality: [low, medium, high, ultra], look: [natural, vivid, soft]}`, each `{id, name, desc, values}`, deep-frozen. `GROUP_KEYS` = the SCHEMA keys of each group (6 quality, 8 look) |
| `coerce` | 107-117 | `coerce(key, v)`: bools from `true/'true'/1/'1'`; numbers clamped to `RANGE`; a `choice` must be one of its options; non-finite → default |
| `cfgNum` | 118-124 | the live numeric value of a key, normalised like `coerce` (not a number → default, else clamped to `RANGE`) even if `CFG` was written directly from the console. Allocation-free, used by the frame code |
| `same, SKEY` | 125-126 | `same` = equal within 1e-6; `SKEY(k)` = `'tc.shader.' + k` |
| localStorage load | 128-133 | every CFG key from `tc.shader.<k>`, through `coerce` |
| `persist` | 135-140 | writes `tc.shader.<key>`, or removes it when it equals the default |
| `proto`, `O` | 142-150 | bails out without WebGL2. `O` = 18 original methods: the 15 wrapped ones plus `uniform1i`, `uniform4f` and `uniformMatrix4fv`, so our own uploads skip our wrappers |
| `clamp01, sstep, dot, normInto, mixInto, copy3` | 152-157 | math helpers; the `*Into`/`copy3` ones write into a target array (no allocations) |
| `patchTerrainVS` | 161-190 | anchors on `uniform vec3 uOrigin;`, `out vec2 vLight;` and the `vec3 p = …*0.0625+uOrigin;` regex (162). Adds 7 uniforms, `vRel`/`vCls`, the class `texelFetch` (188), and waving (171-184) |
| `fsDecls(mode)` | 195-273 | the FS uniforms (24, including `uShadowP`, `uShadowQ`, `uWaterOn`, `uLVP` and `uShadowMap`), plus `tcTone` (231), `tcTap` (238) and `tcShadow` (241). `tcWv` (the wave function) is added only for mode 2 |
| `WATER_CODE` | 278-312 | the water model (below), emitted only into the translucent (mode 2) FS |
| `shadeCode(lit, alpha, mode, fogR)` | 314-403 | replaces the output line (below) |
| `patchTerrainFS` | 405-419 | `outRe` (406) captures lightmap use and alpha. `mode`: 2 = `alpha==='c.a'` (translucent), 1 = has `discard` (cutout), 0 = opaque. `fogR` = the FS declares `uniform vec2 uFogR` |
| `skyCode`, `patchSky` | 421-460 | inserts `uSkySun/uSkyDay/uFx/uSkyOn` after `out vec4 o;` and replaces `o=vec4(c,1.0);` (lit) or `o=vec4(mix(uHor,uTop,sqrt(t)),1.0);`. Always patched; it returns the vanilla colour when `uFx` or `uSkyOn` is 0 (423) |
| `patchCloud` | 462-470 | **dead**: double-escaped regexes (464, 466) and a literal `\\n` in the inserted text (466). Gated by `CFG.cloudEffects` |
| `patchSource` | 472-484 | dispatcher, needs `#version 300 es`. VS: `aPos & uvec3`. FS: `sampler2DArray`+`vShade`+`uFog`+`vDist`. Sky: `uTop, uHor`. Cloud: `uTint, uHole` |
| `FIXED_SUN, OBS, CAMLAST, locKind` | 488-498 | observation state. `locKind`: WeakMap<UniformLocation, 1..6> |
| `setCam`, `onSprite` | 500-505 | camera from the cloud plane's `uCam`; sun = the first `uC` after `uTop` in the frame |
| `ATL` + indexOf hook | 507-523 | a temporary `Array.prototype.indexOf` wrapper captures the block-name list searched for `'oak_planks'` (game:main.js:364, `eng.texNames`). It restores the original right after the capture, if it's still ours, or after 60 s at the latest |
| `RE_EMIT, RE_PLANT, nameClass` | 524-532 | name → class: 0 none, 1 leaves, 2 plant, 3 water, 4 emissive |
| `readAtlas` | 534-552 | per-layer transparency and mean RGB from the 16×16 array upload |
| `layerClass` | 554-577 | class by name, falling back to colour and animation heuristics |
| `CLS_COUNTS, uploadClasses` | 579-603 | 1-row RGBA8 texture (R = class) on unit 7. It reuses `G.clsData` and uploads, and logs, only when a class changed. Then sets `G.dirty` |
| `shaderSrc, progShaders, progInfo, PROGS` | 607-610 | WeakMaps: shader → `{orig, info, patched}`, program → shaders, program → `info`. `PROGS` lists every info but is never read (issue 53) |
| `curInfo, curVAO, frameId, shadowFrame, mainGL, lastOrigin, haveOrigin, rec, cols` | 612-616 | per-frame state. `rec`: Map<VAO, part record>. `cols`: Map<column key, {p0, p1}> (the opaque and cutout records of a chunk column) |
| `ERR, hookError` | 620-629 | the first 3 hook errors are logged (`STATS.errors` counts them all). After 20 in the page's lifetime (not a rate, issue 54), `ERR.off` pauses the effects until a reload |
| `U1, U3, V1, V3` | 633-637 | the 20 float and 5 vec3 uniforms pushed to every patched program, and their per-frame values |
| proto wrappers | 639-762 | `shaderSource, compileShader, attachShader, linkProgram, getUniformLocation, uniform3f, uniform3fv, uniform1f, texImage3D, texSubImage3D, bindVertexArray, deleteVertexArray, clear`. `useProgram` (1108) and `drawElements` (1265) come later |
| `G` | 764-772 | GL resources (`clsTex, clsData, clsW, maxTex, fbo, depthTex, texSize, checkFbo, allocFailed, pOpaque, pCut, shadowOk`), `dirty`, and the shadow snapshot `sh` (`valid, drawn, frame, ms, c0, L, R, U, dx, dy, hx, hy, E, Z, size, cull`) |
| `lightMat` | 776-784 | ortho light matrix relative to `at`, from the basis and the extent/depth snapshotted in `G.sh` at the last refresh, with the texel snap `dx, dy` |
| `SUN_LOW, SUN_NOON, ST, WHY, STATS, SCRATCH, isEnd, num` | 786-797 | derived per-frame state and counters. `STATS = {shadowChunks, refreshes, why: {init, dirty, move, sun, age}, errors}`. `isEnd` matches the End's `uSkyLight` (compat-checked) |
| `updateState` | 799-827 | once per `frameId`, allocation-free: time, cam, `dim`, day = `clamp01(OBS.top[2])` (the zenith's blue channel), sun, `sunL` (y ≥ 0.14), sun colour (`SUN_LOW` → `SUN_NOON`), cloud tint; fills `V1`/`V3` from `CFG` |
| `shadowTargetSize` | 829-831 | `cfgNum('shadowSize')` (1024-4096), capped at `MAX_TEXTURE_SIZE` |
| `finalizeShadow(gl, canDraw)` | 838-881 | sets `ST.shadowOn` and decides whether to refresh (below); snapshots the basis, centre and the normalised extent, depth, size and culling into `G.sh`; fills `ST.lvp`. When shaders or shadows are switched off, it shrinks the depth texture back to 1×1, once |
| `inFootprint` | 884-892 | is a part record inside the current map's area? It assumes a 128-tall column centred at y=64 (issue 50) |
| `forget` | 894-902 | drops a record from `rec` and its column |
| `makeProg`, shadow GLSL, `shadowProg` | 904-969 | built with `O.*`, bypassing the patcher. `SHADOW_VS_OPAQUE`/`FS_OPAQUE` (921-933) are depth only, with an empty FS. `SHADOW_VS`/`FS` (935-958) do the cutout alpha test against the atlas, and plants and water (classes 2-3) are culled. `shadowProg` sets `uClsTex = 7` and `uTex = 0` |
| `initGL` | 974-1024 | on the game's first `useProgram` of a patched program (in `prog()`, game:gfx.js:875, during the `Gfx` constructor). Sets `mainGL`, `maxTex`, `clsTex` on unit 7, a **1×1** `DEPTH_COMPONENT16` compare texture on unit 6, the FBO, and both shadow programs, whatever `CFG.shadows` is |
| `resolveLocs` | 1026-1040 | per program, once: the locations of `U1`, `U3`, `uCam`, `uLVP`, `uShadowP`, `uShadowOn`; sets the samplers (`uShadowMap = 6`, `uClsTex = 7`); allocates the value caches (`c1, c3, cc, cshp, clvp, cson`) |
| `applyUniforms` | 1042-1067 | `resolveLocs` first (1045), so the samplers are on units 6/7 even if something below throws on a program's first use; then `updateState`; `uploadClasses` when dirty; uploads each `U1`/`U3` value only if it differs from the program's cache; `pushCam` only once the frame's camera is final (`ST.camFrame === frameId`) |
| `pushCam` | 1069-1092 | cached `uCam`, `uShadowOn`, and while shadows are on, `uLVP` and `uShadowP = (size, 1/size, 2·E/size, Z)` |
| `offProgram` | 1096-1106 | the paused path: `uFx = 0` and the two samplers, once per program |
| `useProgram` wrapper | 1108-1118 | `initGL` once, `curInfo`, `OBS.lit`, then `applyUniforms` (or `offProgram`) |
| `resizeShadow` | 1120-1130 | `texImage2D` of the depth texture on unit 6 at the new size, restoring the active unit; flags an FBO check |
| `drawShadowSet` | 1132-1148 | one draw per record of a pass (opaque or cutout) inside the footprint. Casters inside it keep casting however long ago they were drawn (behind the camera, for example); records outside it that haven't been drawn for 60 s are forgotten (1140) |
| `renderShadow` | 1153-1198 | the shadow pass (below) |
| `trackColumn` | 1203-1220 | when a column's opaque or cutout part is drawn without its sibling, the sibling's mesh became empty: forget it (and mark dirty if in the footprint) |
| `terrainDraw` | 1222-1263 | the frame's first terrain draw rebuilds the camera from `uOrigin` deltas, then runs `finalizeShadow(gl, mode < 2)`, `renderShadow` and `pushCam`. A throwing `renderShadow` is caught (1236-1241): no shadows that frame, the map is invalidated, `hookError`, and `pushCam` still runs. Every opaque/cutout draw updates its record: a new record or a changed count in the footprint sets `G.dirty`; then `trackColumn` |
| `drawElements` wrapper | 1265-1271 | calls `terrainDraw` when `curInfo.terrain && curVAO && haveOrigin && !ERR.off` |
| `apply, set, applyPreset, currentPreset, reset` | 1280-1322 | the settings API (below) |
| `debug` | 1324-1337 | diagnostics: version, frame, sun, cam, shadow state, `refreshWhy`, `shadowMap` size, `records`, `errors`, `paused`, `preset`, layer classes |
| `window.Twitterentary` | 1338-1342 | the global (below) |
| `notify` | 1344-1355 | `__tcOptions.toast` when BO is there, else its own `#note` toast (1.8 s) |
| K listener | 1356-1364 | KeyK toggles `enabled` through `set` (saved), with the guards in §1 |

**`window.Twitterentary`** (1338-1342)

| Member | What it is |
|---|---|
| `cfg`, `schema`, `defaults`, `presets`, `version` | live `CFG`, `SCHEMA`, the frozen `DEFAULTS` and `PRESETS`, and `VERSION` |
| `state`, `stats`, `shadow`, `obs` | `ST`, `STATS`, `G.sh` and `OBS`, for diagnostics and the smoke checks |
| `set(key, v)` | `coerce`, write `CFG`, `persist`; it takes effect on the next frame. Returns false for an unknown key. Hidden keys (`shadowDepth`, `shadowCull`…) are accepted too |
| `apply()` | a no-op since the reviewer fixes, kept for API compatibility (BO calls it after a fallback write). Uniforms are rebuilt from `CFG` every frame, and the shadow map compares its settings with its last snapshot, so nothing needs marking |
| `applyPreset(group, id)` | sets **every** key of the group: the preset's value, or the default for keys it doesn't list (Low lists only `shadows: false`). Then persists them |
| `currentPreset(group)` | the id of the first preset whose listed values all match `CFG` (within 1e-6), else `null` ("Custom"). Low matches whenever `shadows` is off |
| `reset()` | `CFG` = `DEFAULTS`, removes **every** `tc.shader.*` key (including stale ones such as `shadowTaps`) |
| `debug()` | logs and returns the diagnostics object |

**Shadow refresh** (`finalizeShadow` 838, `renderShadow` 1153):
- **When shadows are on** (840-841): `enabled && shadows && shadowOk`, the size hasn't failed to allocate, the overworld (`dim 0`), sun y > 0.06 and day > 0.1.
- **When they're off:** the map is invalidated. If `enabled` or `shadows` is off (Quality Low, or K), the depth texture is also shrunk back to 1×1, once (844-852). At night and in the Nether/End it keeps its size, so it isn't reallocated every dusk.
- **When the first terrain draw is translucent** (`canDraw` false, 854-857): no refresh starts. The old map is kept, or shadows are off for that frame if it isn't valid.
- **Reasons** (`ST.why`, counted in `STATS.why` once drawn), checked in this order:
  - `init`: there's no valid map;
  - then, at most once every `shadowEvery` frames (859):
    - `dirty`: `G.dirty`, or the normalised size, extent, depth or culling differs from the snapshot (860). This is how setting changes are noticed;
    - `move`: the camera moved more than `shadowMove` (861);
    - `sun`: the sun turned about 0.003 rad (`dot < 0.9999955`, 862);
    - `age`: the map is more than 2 s old (863).
- **What sets `G.dirty`:**
  - a new record, or a changed index count, inside the footprint (1260);
  - `trackColumn` dropping an emptied part (1214, 1218);
  - `deleteVertexArray` on a recorded VAO in the footprint (755);
  - a class re-upload (601).
  - Settings changes don't set it (`apply()` is a no-op), so dragging a Look slider causes no shadow redraws.
- **Cost in practice:** SH measured a refresh mix on the idle title world (48 frames over 11 s) of dirty 5, age 1, move 0, sun 0.
- **The pass itself** (`renderShadow`):
  - It queries only `DRAW_FRAMEBUFFER_BINDING`, `VIEWPORT` and 4 `isEnabled` (1156-1159).
  - It resizes the texture if `SH.size` changed (1162-1170). A failed resize sets `G.allocFailed`, which disables shadows at that size.
  - It binds the FBO, sets `CULL_FACE` from the snapshot's `cull` (back faces; the hidden `cfg.shadowCull = false` disables it for debugging, 1172), sets `polygonOffset(2, 1)`, clears depth, and draws the opaque records with the depth-only program and then the cutout records (1181).
  - It restores the program, VAO, FBO, viewport and enables, then `depthFunc(LEQUAL)` and `depthMask(true)` without querying them. That's what gfx.js has set at the first terrain draw (game:gfx.js:1237-1240; `depthMask` from compat).
  - If it throws, `terrainDraw` catches it: shadows are off for that frame, the map is invalidated, and the next frame starts over (1236-1241).

**Terrain FS** (`shadeCode` 314):
1. **Vanilla path:** returns the vanilla colour when `uFx < 0.5` (325).
2. **Fog early-out:** when `f > 0.999`, it outputs the fog plus the sun scatter and skips everything else (329-333). The scatter is only applied in open-air fog (`uFogR.y > 20`, 322), not underwater or in lava.
3. **Normals and classes:** normals from `dFdx/dFdy(vRel)` (334-336), then the leaf, plant, water and emissive classes from `vCls` (337-340).
4. **Ambient:**
   - AO is separated from the engine's face shading (347-348).
   - A hemispheric ambient: day (356), twilight tint (358), night (359); Nether/End variants (362-363).
   - Sky-light scaling (364).
5. **Block light:** `tcBl²(0.8+0.2·tcBl)` with a warm tint (367).
6. **Sun and shadows:**
   - The sun term (370-376). `tcShadow` is sampled only where the sun reaches.
   - It's a single cheap tap beyond 32 blocks and on leaves, plants and water (375).
   - Leaf backscatter (377-380).
7. **Emissive** (384), then `WATER_CODE` (mode 2 only, 386).
8. **Grading:** exposure, `tcTone` (a 70% hue-preserving / 30% per-channel highlight roll-off), vibrance-style saturation (saturated colours are boosted less above 1), then contrast (389-395).
9. **Fog:** fog with the sun scatter (398-401).

`tcShadow` (241-271):
- **Offsets:** a normal offset of `uShadowP.z·1.6 + 0.015`, and a slope bias divided by the depth range `uShadowP.w`. It fades out at the map edge.
- **Every tap is `textureLod(…, 0.0)`** (238), so ANGLE can skip the taps in untaken branches.
- **Taps by `uShadowQ`:** 1 tap (Hard), a 4-tap 3×3 tent (Soft, 254-258), or a 9-tap 5×5 tent (Softer, 260-268).

`WATER_CODE` (278-312):
- **Waves:** wave octaves faded by the pixel footprint (`tcDx/tcDy`): 2 octaves far away, 4 up close (284-291).
- **Fresnel:** Schlick (292-293).
- **Reflection:** the sky shader's own gradient plus the horizon term (294-299).
- **Body colour:** teal, lit like terrain, keeping 30% of the texture's luminance (300-301).
- **Absorption:** by view path (302).
- **Blend:** `A = 1-(1-F)(1-abs)`, `C = (F·R + (1-F)·abs·W)/A` (303-304).
- **Glints:** a sun glint that respects `tcVis` (the shadow), sharper up close (305-309), and a moon glint (310-311).

**Sky FS** (`skyCode` 421):
- a light saturation boost (430) and zenith darkening (431), plus a horizon brightening (432-433);
- sun glow gated on `dot > 0.4` (437), moon glow on `uSkyDay < 1 && dot < -0.95` (441), each using one `log2` with `exp2`s;
- IGN dither (445).

**Game hook points:**
- **WebGL2 prototype methods:** the list above.
- **GLSL anchors:** the regexes at 162-164, 406-408 and 451-454, plus the source checks at 473-482.
- **Observed uniforms:** names are tagged by wrapping `getUniformLocation` (696-708): `uOrigin`, `uCam` (only in programs that also have `uSize`, the cloud/water plane VS), `uTop`, `uC`, `uAmbient`, `uSkyLight`. SH also uses the game's `uFogR` (game:gfx.js:293).
- **Atlas:** caught by `texImage3D(0x8C1A TEXTURE_2D_ARRAY, level 0, 16, 16, n, …, pixels=arg 9)` (game:gfx.js:923-925). Animated layers come from `texSubImage3D` (game:gfx.js:1098-1102) and are ignored once the names are known.
- **Block names:** from `Array.prototype.indexOf('oak_planks')` on `eng.texNames` (game:main.js:364).
- **Frame tick:** `clear(mask & COLOR_BUFFER_BIT)` on `mainGL` only (759-762), so the dragon view's own context (game:dragonview.js:54, 176-177) doesn't count.
- **GL state assumed at the first terrain draw:** `depthFunc(LEQUAL)`, `CULL_FACE` on and `BLEND` off (game:gfx.js:1237-1240), and the atlas on unit 0 with `TEXTURE0` active (game:gfx.js:1256-1257). compat checks both.
- **DOM:** `#note` (fallback). **Events:** window `keydown` in the capture phase.

**Globals:** `window.Twitterentary` (above). **Storage:** `tc.shader.<key>`, read at startup and written by `set`, `applyPreset` and `reset`.

**Data flow:**
1. **Patch:** game `shaderSource(src)` → `patchSource` (472) → `{src, info}` stored in `shaderSrc` (648).
2. **Compile:** `compileShader` (652). If the patched shader fails, it recompiles the original.
3. **Attach:** `attachShader` records the shader (663).
4. **Link:** `linkProgram` (670). If any attached shader is patched and the link succeeds, `progInfo.set(p, {prog, loc:null, mode, lit, terrainVS?, terrainFS?, sky?, cloud?, terrain})`. Otherwise it reverts every shader and relinks.
5. **Uniform enumeration:** the game enumerates uniforms (game:gfx.js:869-873), and the `getUniformLocation` wrapper tags `locKind`.
6. **useProgram:** game `useProgram(p)` → wrapper (1108): `initGL` once; `curInfo`; `applyUniforms` (1042): lazy `resolveLocs` first, then `updateState` once per frame, then cached uploads.
7. **Origin:** game `uniform3f(uOrigin)` updates `lastOrigin`.
8. **Draw:** game `drawElements` → wrapper (1265) → `terrainDraw` (1222).
   - On the frame's first terrain draw: the camera fix-up (1231), `finalizeShadow` (1233), `renderShadow` if a refresh is due and this is an opaque or cutout draw (1234-1242), then `pushCam` (1243).
   - Then it records `rec[curVAO] = {vao, n, ox/oy/oz, wx/wy/wz, cut, seen, frame, col}` for mode < 2 and calls the original `drawElements`.
9. **Partial programs:** programs where only the VS matched count as "partial": uniforms are applied, but there's no `terrainDraw`. One example is the stained-glass depth prepass (game:gfx.js:1295-1317), whose FS (game:gfx.js:281-287) is `o = vec4(0.0)`. Its VS still waves, through `uCam`.

**Texture units:**
- **Unit 7** = `G.clsTex` (the class lookup, sampled by the terrain VS and the cutout shadow VS).
- **Unit 6** = `G.depthTex` (`sampler2DShadow uShadowMap`). It's 1×1 until the first refresh, then sized to `shadowSize`.
- **Binding:** both are bound in `initGL` (982-995) and never unbound; `resizeShadow` rebinds unit 6 (1123-1124). The game uses units 0-5 only (compat checks gfx.js and entities).
- **Atlas assumption:** the cutout shadow FS samples the atlas through `uTex = 0` (967), so it assumes the atlas is bound on unit 0 at the first terrain draw. It is: game:gfx.js:1256-1257, compat-checked.

**Observations (OBS):**
- **Sky and sun:** `uniform3fv(uTop)` sets `OBS.top`, `topFrame = frameId` and `sunSeen = false` (724). The next `uC` upload (`uniform3f`/`3fv`, kind 4) in the same frame becomes `OBS.sun`, normalized (501-505).
  - This relies on the sun sprite being the first `uC` after the sky: game:gfx.js:1350→1362 (`drawSky`), and 1401→1417-1428 via `sprite()` (`drawSkyLit`).
  - `uC` is also set by pChat (game:gfx.js:1595) and by signs (game:signs.js:288).
- **Dimension:** `uniform1f(uAmbient)` sets `OBS.amb` (732), and `uniform3fv(uSkyLight)` sets `OBS.sl` (726). `dim` (806) is checked only when `OBS.lit`:
  - 1 when `amb > 0.05` (the Nether, where the game uses 0.1);
  - 2 when `isEnd(sl)` (the End).
  - compat checks both values.
- **Camera:** from the cloud plane's `uCam` (`setCam`), corrected per frame by `e.ox - lastOrigin` on a VAO drawn in the previous frame (1231).

**CFG ↔ SCHEMA ↔ uniform ↔ GLSL**

| CFG key (default) | SCHEMA label / range (group) | Path | GLSL use (SH line) |
|---|---|---|---|
| enabled (true) | Shaders, bool (top row) | `uFx` (820); gates `ST.shadowOn` (840); K toggle (1361) | VS wave gate 172; FS vanilla return 325; sky 423; cloud 468 (dead) |
| shadows (true) | Sun shadows, bool (quality) | `ST.shadowOn` (840) → `uShadowOn` (1077) | FS 374 |
| shadowSize (2048) | Shadow resolution 1024-4096, step 1024 (quality) | `shadowTargetSize` (829) → `SH.size` (871): texture resize (1162), viewport (1171), texel snap (872), `uShadowP.xy` (1089) | tent taps 248-249 |
| shadowExtent (56) | Shadow range 16-96, step 8 (quality) | `SH.E` (871): `lightMat` (777), `inFootprint` (891), `uShadowP.z` (1086) | normal offset 242 |
| shadowDepth (256) | none; 64-1024 | `SH.Z` (871): `lightMat` (777), `uShadowP.w` | bias 245 |
| shadowFilter (1) | Shadow edges: Hard / Soft / Softer, choice (quality) | `uShadowQ` (824) | 1 tap 247; 4-tap tent 254-258; 9-tap tent 260-268 |
| shadowEvery (8) / shadowMove (6) | Shadow update limit (frames) 1-30 / Shadow update distance 1-16 (quality) | `finalizeShadow` 859 / 861 | — |
| shadowTaps (8) | none; unused since 1.4.0 | — | — |
| shadowCull (true) | none; debug | `SH.cull` (871) → `renderShadow` 1172 | — |
| waving (true) | Waving leaves & plants, bool | `uWaveOn` (821) | VS 172 |
| leafSway (0.028) / plantSway (0.075) | 0-0.15 / 0-0.3 | `uLeafSway` / `uPlantSway` | VS 180 |
| waterEffects (true) | Water effects, bool | `uWaterOn` (824) | `WATER_CODE` gate 279 (translucent FS only) |
| waveStrength (1.0) | 0-2 | `uWaveStr` | 289 |
| skyEffects (true) | Sky effects, bool | `uSkyOn` (824) | sky 423 |
| cloudEffects (true) | none | `patchCloud` gate (463) | cloud patch (dead) |
| sunStrength (0.75) | Sun light 0-2 (look) | `uSunStr` | 376, 379 |
| ambientStrength (1.0) | Ambient light 0-2 (look) | `uAmbStr` | 364 |
| blockLight (0.9) | Block light 0-2 (look) | `uBlockStr` | 367 |
| aoPower (1.3) | Contact shadows (AO) 0.5-3 (look) | `uAoPow` | 348 |
| emissive (1.0) | Emissive glow 0-2 (look) | `uEmissive` | 384 |
| exposure / saturation / contrast (1.0 / 1.0 / 1.0) | 0.4-2 / 0-1.5 / 0.5-1.8 (look) | `uExposure / uSaturation / uContrast` | 389 / 393-394 / 395 |

**Presets** (86-98). Quality sets `shadows, shadowSize, shadowExtent, shadowFilter, shadowEvery, shadowMove`:

| Quality | shadows | Size | Extent | Filter | Every | Move |
|---|---|---|---|---|---|---|
| Low | off | (default) | (default) | (default) | (default) | (default) |
| **Medium** | on | 2048 | 56 | Soft | 8 | 6 |
| High | on | 4096 | 72 | Soft | 4 | 4 |
| Ultra | on | 4096 | 96 | Softer | 2 | 2 |

Look sets `sunStrength, ambientStrength, blockLight, aoPower, emissive, exposure, saturation, contrast`:

| Look | Sun | Ambient | Block | AO | Emissive | Exposure | Saturation | Contrast |
|---|---|---|---|---|---|---|---|---|
| **Natural** | 0.75 | 1.0 | 0.9 | 1.3 | 1.0 | 1.0 | 1.0 | 1.0 |
| Vivid (the 1.3.0 look) | 0.9 | 1.0 | 1.0 | 1.5 | 1.15 | 1.0 | 1.12 | 1.05 |
| Soft | 0.65 | 1.1 | 0.85 | 1.0 | 0.9 | 1.05 | 0.92 | 0.95 |

`waving`, the sways, `waterEffects`, `waveStrength` and `skyEffects` belong to neither group.

**Uniforms derived from state rather than CFG:**
- `uTime` (`ST.time`): VS waving, water waves.
- `uCam`: VS 173, water 280.
- `uSunDir` (= `sunL`, y ≥ 0.14): 370, 378.
- `uSunCol`: 376, 308, 331, 400.
- `uZenith` (= `OBS.top`): the water reflection, 296.
- `uSkySun` (the raw sun): 305, 330, 371, 399; sky 427-443.
- `uDay`: 352, the scatter at 322.
- `uSkyDay`: sky 426.
- `uDim`: 362-363, 372.
- `uLVP`: 242.
- `uShadowP`: 242-249.
- Samplers: `uShadowMap` = 6, `uClsTex` = 7. `uCloudTint` is dead.
- The game's own: the lit FS uses `uAmbient` (319; game:gfx.js:271), and every patched terrain FS uses `uFogR` (322).

**Hot paths:**
- **`uniform3f/3fv/1f` wrappers:** a `WeakMap.get` on every uniform call in the game (one `uOrigin` per chunk per pass).
- **`drawElements` wrapper:** runs on every draw call. `terrainDraw` adds per terrain draw a `Map.get`, field writes and `trackColumn`, which does a `Map.get` only when the record's column changed. `inFootprint` runs only for new or changed records.
- **`useProgram`:** a `WeakMap.get`. For patched programs, a compare of 20 floats and 5 vec3s against the program's cache, plus GL calls for the values that changed. That's about 8-25 uniform calls per frame in total, against about 80 in 1.3.0 (estimated).
- **`clear`, `texSubImage3D`:** a compare each.
- **`Array.prototype.indexOf`:** wrapped only until the names are captured.
- **`renderShadow`:** only on a refresh, so on change and at most every `shadowEvery` frames. It makes 2 `getParameter` and 4 `isEnabled` calls, iterates `rec` twice (opaque, then cutout), and makes one draw per record in the footprint, with back faces culled.
- **GPU per terrain fragment:**
  - Within 32 blocks where the sun reaches: 1, 4 or 9 compare taps (Hard, Soft, Softer).
  - Beyond that, and on foliage and water: 1 tap.
  - Fully fogged fragments skip lighting, shadows and water.
  - Measured in SwiftShader at 640×360 (not a real GPU): Hard costs about the same as Low (no shadows), Soft about +17 ms, Softer about +33 ms.
- **Sky:** a full-screen pass; its glow terms are gated.

**Settings:** every key applies on the next frame. Uniforms are rebuilt from `CFG` every frame, and `finalizeShadow` compares the shadow settings (through `cfgNum`) with the snapshot of its last refresh. There are no reload flags left.
- **`shadows` and `shadowSize`:** turning `shadows` on, or changing `shadowSize`, resizes the depth texture at the next refresh. Turning shaders or shadows off shrinks it to 1×1.
- **Shadow range and depth:** `shadowExtent` and `shadowDepth` take effect with the next refresh, which a change triggers, and reach the GLSL through `uShadowP`.
- **K toggle:** live, and saved.

## 3. tweetcraft-better-options.js (BO, 959 lines)

**Purpose:** takes over the pause menu's "Options…" button (matched in the player's language) and opens a tabbed menu instead: Graphics, Shaders, registered mod tabs, Keybinds, About. Hosts the settings bus. Adds UI/HUD scale, mouse sensitivity, game-key remapping, FOV (down to 2), render distance, the shaders' Quality and Look pickers, "Reset shaders" and "Reset all options". "Game options…" opens the game's own Options screen (FOV, music, held light, country, chat translation, language). Every setting is a game-style full-width button or slider with its caption drawn on it. **Metadata:** `@version 1.1.0`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.twitterentary`. The in-code version `VERSION` (20) reads `GM_info.script.version` (`'0.0.0'` without `GM_info`), so there's nothing to keep in sync.

| Name | Line | Purpose |
|---|---|---|
| `TAG, MENU_NAME='tcoptions', STORE_KEY, SHADER_PREFIX, RDS, VERSION, DEFAULTS` | 15-28 | constants. Defaults: `ui.scale 1, hud.on true, input.sens 1, keys.map {}, keys.mute []` |
| `cfg, save, clone` | 30-33 | `tc.options` load and save |
| `sections, keybinds, subs, bus, emit` | 35-62 | the bus (see §1). `emit` swallows errors |
| `store, isTyping, $, toast` | 64-83 | localStorage wrapper, helpers, `#note` toast |
| `domReady, menus, _injectMenus` | 85-102 | lazy, memoized `import('/js/menus.js')` after DOMContentLoaded, started at load (101) |
| `i18n, makeLabels, LBL, relabel` | 105-136 | lazy `import('/js/i18n.js')` after DOMContentLoaded (a failed import warns and keeps English). `LBL = {options, full, dist}`: the English labels always, plus `t('pause.options')`, `t('pause.full')`, `t('pause.exitFull')` and `t('pause.distance', {n})` for each of `RDS` (`dist` maps label → n). A `t()` that throws or returns the key is ignored |
| `applyLabelCss, initLabels, bus._labels` | 139-164 | `<style id="tc-options-i18n">`: hides the pause menu's Distance and Fullscreen buttons by their translated labels (`CSS.escape`d); rebuilt on `onLocaleChange` (161). `_labels()` is a test seam |
| `ourMenuOpen` | 166 | `#screen .inner .tc-marker` exists |
| `fovCache, getFov, syncFov` | 168-172 | cache of `mc.fov` (30-110 at load, else 70). `syncFov` re-reads `mc.fov` whenever the Graphics tab is built, so a change made on the game's Options screen shows up. It takes 30-110 only, like the game's load check, so a transient zoom value left in `mc.fov` is ignored |
| `stealFovInput, setFov, bus.fov` | 173-197 | opens the game's Options screen, grabs `input[type=range][data-k="fov"]`, sets `min=5, step=any`, reopens our menu or closes, re-locks the pointer. `setFov` clamps to 2-110, writes `mc.fov` and dispatches `input` |
| `currentRd, distanceButton, setRenderDistance, bus._setRenderDistance` | 199-228 | `openPause()`, then clicks the button whose `aria-label` is in `LBL.dist` until it shows the target (≤ 12 clicks), writes `mc.rd`, and reopens ours. On the title screen `openPause` returns early (game:menus.js:1882-1884), so only `mc.rd` is written. `_setRenderDistance` is a test seam (no consumer yet) |
| `toggleFullscreen` | 230-236 | `requestFullscreen`/`exitFullscreen`, toast on refusal |
| `sendF1(onlyIfHidden), toggleHud` | 237-262 | `closeMenu()`, a synthetic F1 keydown and keyup (both `__tc`), then reopens ours. With `onlyIfHidden` it presses only if `#hudtop.hidden`, the game's real HUD state once `closeMenu` has run `updateTop` (game:main.js:2208-2214), and does nothing when `#hudtop` is missing. `toggleHud` flips `hud.on`, then `sendF1()` |
| `uiTimer, TOUCH_PARAM, isTouch, defaultRd, uiMult, uiBase` | 264-277 | `isTouch` = `(pointer: coarse)` or the `?touch` URL param, like the game (game:main.js:129). `defaultRd` = 6 on touch, else 8. `uiBase` copies the game's `--u/--d` formula (game:main.js:515-522) |
| `applyUiScale, reassertUiScale` | 278-294 | set `--u, --d, --tc-s`; the reassert runs on a 250 ms interval |
| `noteFont, hudScale, patchHudScale` | 296-323 | wraps `Hud.prototype.draw` (`o.gs`), `suggestions` (arg 0), `tab` (arg 1) and `hint` (arg 1), marked `__tcScaled`; captures the bitmap font |
| `patchSurvivalScale` | 325-342 | wraps `SurvivalClient.prototype.drawHud(hud, font, gs)` |
| `redrawButtonLabels, rescaleLabels, startLabelObserver` | 344-392 | redraws the canvas labels of `button.mcb` (not `.hb`) at the scaled px; MutationObserver on the `#screen` subtree |
| test seams | 394-398 | `_injectUi, _patchHud, _patchSurvival, _injectSurvival, _rescaleLabels` |
| `h, T, row, note, small, header, subhead, sep` | 400-418 | DOM builders. `small` = `p.desc.small`; `subhead` = a `.tc-sub` section heading |
| `btn(label, fn, {cls})` | 420-425 | `button.mcb` with `aria-label`; the click handler catches errors. `b.__setLabel(text)` relabels it in place |
| `toggle(label, v, fn)` | 427-431 | full-width `.mcb.tc-full.tc-tg` reading "Label: ON" / "Label: OFF" |
| `cycle(label, [[v, l]…], value, fn)` | 433-445 | full-width `.mcb.tc-full.tc-cycle` reading "Label: l"; a click steps to the next option and calls `fn(v)`. A value not in the list shows raw, and the first click picks option 0 |
| `stepDecimals, slider` | 446-470 | `div.tc-slider` = `input.tc-range` + `div.tc-cap`: the caption "Label: value" sits on the 200u × 20u track (the game's `.fov-control` look, game style.css:225-290). Values are shown and passed to `oninput`/`onchange` rounded to the step's decimals |
| `item(label, control)` | 473-477 | returns a `.tc-full` or `.tc-slider` control alone; anything else gets a two-column `.tc-item` with an ellipsised left caption (keybind rows, Fullscreen) |
| `ensureCSS` | 480-525 | one `<style>` (see §1) |
| `ARMED_LABEL, armed, isArmed, relabelArmed, arm, disarm, armButton` | 527-546 | two-click confirmations (3 s). The state is kept outside `build`, so a rebuild keeps it. `armButton(id, label, fn)` tags its button `data-tc-arm`, and `arm`/the timeout relabel it in place ("Click again to reset"), never through `refresh()`, so a slider drag on another row isn't cut off |
| `fovRow, rdRow, fullscreenRow, scaleRow, hudRow` | 548-566 | Graphics rows. FOV slider 30-110. Render distance slider 4-12, step 2, applied on `change`. Fullscreen is an `item` with an Enter/Exit button. HUD is a toggle |
| `openGameOptions, graphicsSection` | 567-581 | "Game options…" calls `M.openOptions()`: the game's screen, whose Done (game:menus.js:1876) calls `back()`, which goes to the pause menu, or to the title screen before the world starts (game:menus.js:232-248) |
| `KEYNAMES, keyName, capturing, setCapturing` | 583-586 | key-capture state. Mirrors `bus.capturing` |
| `screenIsOn, invClosed, remapActive, modKeySet` | 588-595 | remap gating; `modKeySet` = the codes of registered mod keybinds |
| `onKeyCapture, onKeyCaptureImpl` + listeners | 596-631 | capture mode swallows the key (a game action can't take a mod's key, 608), `keys.map` remap re-dispatch (`__tc`), `keys.mute` block |
| `currentKeyFor, bindEntry` | 633-650 | game binds are stored as `map[newKey]=def` with `def` muted; mod binds call `entry.set` |
| `GAME_ACTIONS, keybindEntries, entryKey` | 652-663 | 13 game actions (WASD, Space, Shift, Ctrl, Q, E, T, F5, F3, F1) plus mod keybinds |
| `keybindsSection, prettyKey` | 665-691 | Keybinds tab: the mouse sensitivity slider (`input.sens`), a `.tc-list` of `item` rows ("Press a key" while capturing), "Reset all keybinds" |
| `clearShaderKeys, setShader, shReloadPending, resetShaders` | 694-721 | `clearShaderKeys` removes every `tc.shader.*` key. `setShader` = `TE.set(key, v)`; for an older SH without `set` it writes `cfg[key]` and `tc.shader.<key>` and calls `TE.apply` if present. `resetShaders` = `TE.reset()` + `clearShaderKeys()`. It returns false when only the keys could be cleared (an older SH without `reset`), and then sets `shReloadPending` |
| `presetPicker` | 722-741 | a `.tc-cycle` button "Quality: Medium" + a `small` description. A click applies the next preset (from Custom, the first) with `TE.applyPreset(group, id)`, then `refresh()`. Returns an `update()` that relabels it in place ("Custom" when `TE.currentPreset` is null) |
| `shadersSection` | 742-803 | the Shaders tab (below) |
| `resetting, resetAll, onResetAllClick, aboutSection` | 806-859 | the About tab and "Reset all options" (below) |
| `curTab, tabsList, buildScreen, api` | 861-901 | screen builder; `reg:` sections get `build(api())`; a tab that throws shows a note instead |
| `bus.ui, bus.build, bus.close` | 902-904 | exports |
| `openMenu, closeMenu, refresh` | 906-921 | `M.showScreen('tcoptions', buildScreen, 'dim')` then `stealFovInput()`; `M.back()`; `M.refresh()` while our menu is open |
| `onDocClick` | 923-933 | capture click on a `#screen .inner button[aria-label]` whose label is in `LBL.options` opens our menu |
| `sensMult` + mousemove | 935-945 | scales `movementX/Y` under pointer lock on `#gl` |
| init | 947-958 | `applyUiScale`, CSS, then on DOM ready `tryPatch` (10 tries × 300 ms), the label observer and `initLabels`; `resize` (2×), the interval, `fullscreenchange` |

**Shaders tab** (`shadersSection` 742). Everything on `window.Twitterentary` is feature-detected, so an older SH still gets the per-row UI.
1. The header, a note while `shReloadPending` (748), then the Quality and Look pickers (750-757), shown only when `TE.presets`, `applyPreset` and `currentPreset` exist.
2. "Shaders: ON" (766), then the SCHEMA rows grouped under `.tc-sub` headings by `f.section`, in schema order (769-790): `bool` → toggle, `num` → slider, `choice` → cycle.
3. Each write goes through `setShader` and relabels both pickers in place (`syncPickers`, 757), so dragging a slider never rebuilds the screen.
4. Rows flagged `reload` (only an older SH has them) get "(reload)", a toast for any type, and a "Reload page" button (801). That button also shows while `shReloadPending`.
5. "Reset shaders" (795) needs a second click within 3 s (`armButton`).

**Reset all options** (`onResetAllClick` 835 → `resetAll` 807). It asks first in the game's `showMessage(title, text, [[label, fn]…])` (game:menus.js:184). Both buttons first reopen our screen. Without `showMessage` it falls back to the two-click confirm (848). Then, in order:
1. stop key capture and disarm both confirms;
2. `await` each mod keybind's `reset()`. This runs before `bus.reset()`, because Zoom's reset writes `zoom.key` into `tc.options`;
3. `resetShaders(TE)`, or only `clearShaderKeys()` when SH isn't loaded;
4. `bus.reset()`, then `applyUiScale()`;
5. `sendF1(true)` (824): presses F1 only if the game's HUD is hidden, whether BO or a real F1 hid it;
6. `await setFov(70)`, then `await setRenderDistance(defaultRd())` (8, or 6 on touch);
7. `refresh()` and a toast ("Reload to apply the shader defaults" for an older SH).

It never touches any other `mc.*` key.

**Game hooks:**
- **Modules:** `import('/js/menus.js')` for `openOptions, closeMenu, openPause, showScreen, showMessage, back, refresh`; `import('/js/i18n.js')` for `t, onLocaleChange` (game:i18n.js:104, 151); `import('/js/ui.js')` for `Hud.prototype.{draw,suggestions,tab,hint}`; `import('/js/survival/client.js')` for `SurvivalClient.prototype.drawHud`.
- **Labels:** the i18n keys `pause.options`, `pause.full`, `pause.exitFull` and `pause.distance` (`{n}`); English in game:lang/en.js:59-61, 175.
- **Selectors:** `#screen(.on) .inner`, `input[type="range"][data-k="fov"]`, `button[aria-label]` matched against `LBL`, `button.mcb` (skips `.hb`), `#inv.off`, `#gl`, `#note`, `#cross`, `#hudtop`.
- **Other:** the CSS variables `--u` and `--d`; a synthetic `F1` key toggles the game HUD.

**Globals:** `window.__tcOptions`. **Storage:** `tc.options`, `tc.shader.*` (fallback writes and clearing), `mc.fov`, `mc.rd`.

**Hot paths:**
- `mousemove`, every event: `bus.get`; when sens ≠ 1, also `getElementById` and 2× `defineProperty`.
- `keydown`/`keyup`: allocates `modKeySet()`, and while `keys.map` is unset, `bus.get` JSON-clones the default.
- The `Hud.draw` wrapper, every HUD frame: `Object.assign` when scale ≠ 1. `suggestions/tab/hint` take rest args on every call.
- The 250 ms interval: `bus.get` each tick; when `ui.scale` ≠ 1, also `uiBase()` → `matchMedia`.
- The MutationObserver redraws labels on every screen rebuild.
- The capture `click` listener runs one `closest()` per click.
- A Shaders-tab slider calls `TE.set` and 2× `currentPreset` per `input` event, while dragging only.

**Settings:** all live. `ui.scale` is read by every wrapped call, `input.sens` per event, keys per event. FOV applies through the game's slider handler, render distance through the game's Distance button, and shader rows through `TE.set`. `hud.on` is only shown as a label and is never re-applied at load (issue 17); "Reset all options" checks `#hudtop` instead.

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

**Purpose:** Up and Down in `#chatbox` recall the last 100 sent lines (memory only, lost on reload). **Metadata:** `@version 1.0.1`, `@run-at document-start`, `@grant none`. No in-code version.

| Name | Line | Purpose |
|---|---|---|
| `MAX, hist, cursor, draft, tracking` | 15-20 | state |
| `box, chatOpen` | 22-27 | `#chatbox`, visible when `!hidden` (game:main.js:2951/2965) |
| `reset, record, setValue` | 29-49 | `record` trims, de-duplicates consecutive lines, caps at 100 |
| `up, down` | 51-64 | saves the draft on the first Up; Down past the end restores it |
| `focusin` capture | 66 | `reset` when `#chatbox` gains focus |
| `keydown` capture | 70 | returns first on IME composition (`e.isComposing \|\| e.keyCode === 229`, 71), the same test as the game's chat `composing(e)` (game:main.js:2334, 2465). Enter → `record(value)` (before the game clears it). Up/Down without modifiers → `queueMicrotask`, then a `defaultPrevented` check |
| `window.__mcChatHistory` | 92 | `{list (getter copy), clear(), record}` |

**Hooks:** `#chatbox`, window `focusin`/`keydown` capture. **Hot path:** keydown, cheap. **Settings:** none.

## 6. Issues & smells

Numbers are stable: fixed entries are removed, not renumbered. Fixed in SH 1.4.0 / BO 1.1.0: 2, 4, 5, 7, 8 (frame counting; the rest is now 49), 9, 12, 13, 14, 15, 16, 27, 29, 30, 47, 52.

| # | Where | Why it matters | Suggested fix |
|---|---|---|---|
| 1 | SH `patchCloud` 464, 466 | regex literals use `\\s`/`\\(`, so they never match (known in compat). The inserted text `'\\nuniform…'` is a literal backslash-n, so fixing only the regex would produce a GLSL compile error | single escapes in both regexes and `'\n'` in the string; then remove `known` in compat |
| 3 | SH `renderShadow` 1156-1159 | still 2 `getParameter` (`DRAW_FRAMEBUFFER_BINDING`, `VIEWPORT`) + 4 `isEnabled` per refresh; sync queries can stall on some drivers. Minor now that refreshes are change-driven | track that state in the wrappers, only if profiling shows a stall |
| 6 | SH K listener 1356-1364 | partly fixed in 1.4.0: it has the capture guards and is saved (`set('enabled')`). But it isn't registered through `registerKeybind`, so it can't be rebound, isn't in the Keybinds tab, and isn't in BO's `modKeySet`. A game action rebound to K, or a remap from K, also toggles the shaders when SH's listener runs first | `registerKeybind({id:'shaders', …})` once the bus exists, storing the key in `tc.shader.key` or the bus |
| 10 | SH `getUniformLocation` 696-708, `onSprite` 501-505, `updateState` 809 | the sun is "the first `uC` after `uTop`" (sprite, pChat and signs all use `uC`) and day = the zenith's blue channel; both depend on game draw order and palette. compat checks the draw order, not the palette | tag only the sprite program's `uC`; derive day from the sun height |
| 11 | SH `drawShadowSet` 1144, `shadowProg` 967 | assumes one `TRIANGLES/UNSIGNED_INT/offset 0` draw per VAO (true today, game:gfx.js:1339) and the atlas on unit 0 at the first terrain draw (game:gfx.js:1256-1257). Both are compat-checked | store `mode/type/offset` in `rec`; bind the atlas explicitly |
| 17 | BO `toggleHud` 259-262, `hudRow` 564-566 | `hud.on` is saved but never applied at load and not updated by a real F1, so the label desyncs. "Reset all options" is safe: it calls `sendF1(true)` (824), which reads `#hudtop` and also restores a HUD hidden by a real F1 | label from `#hudtop.hidden` (outside menus), or apply `hud.on` at startup |
| 18 | BO init 955 (`uiTimer`), `reassertUiScale` 286-294 | `setInterval(reassertUiScale, 250)` runs forever. At scale 1 it returns after a `bus.get` (288), but at any other scale it recomputes `uiBase()` (`matchMedia`) and reads three CSS properties 4× a second | MutationObserver on `<html style>`, or reassert on resize only |
| 19 | BO `uiBase` 269-277, `applyUiScale` 278-285 | copies the game formula (game:main.js:515-522) and re-runs `matchMedia('(pointer: coarse)')` on each call. It also overwrites `--u/--d` even at scale 1, and `hp` is unused | multiply the game's current value; do nothing when `m === 1` |
| 20 | BO 61, 322, 341, 597 | `catch (e) {}` in `emit`, `patchHudScale`, `patchSurvivalScale`, `onKeyCapture` hides failures | `console.warn(TAG, …)` once |
| 21 | BO `Hud.draw` wrapper 310, `wrapScale` 317 | `Object.assign` every HUD frame when scale ≠ 1. The `suggestions/tab/hint` wrappers allocate a rest-args array on every call, even at scale 1 | mutate and restore `o.gs`; use fixed-arity wrappers |
| 22 | BO `redrawButtonLabels` 344, observer 384 | re-renders every `button.mcb` label on each screen rebuild even at scale 1 | return early when `m === 1` and `__tcPx` is unset |
| 23 | BO `stealFovInput` 174-190 | no in-flight guard: `fovInput` is only set after `await menus()` (176, 181), so two first calls in the same task each open and close the game's Options screen. That's a narrow window today: every body after the await is synchronous, and callers (`openMenu` 911, the FOV slider, `resetAll` 825, Zoom) run in separate events. It also caches a detached `<input>` for good and relies on its `oninput` closure (game:menus.js:1805-1809), even after "Game options…" rebuilds that screen | memoize the promise; re-steal if the game rebuilds |
| 24 | BO `setFov` 192 vs 185 | clamps to ≥ 2, but the stolen range has `min='5'`, so the browser clamps to 5 and zoom beyond ~14× does nothing | set `el.min = '2'` |
| 25 | BO `setFov` 193 + game `oninput` | the transient zoom FOV is saved to `mc.fov`; after a reload while zoomed the game rejects < 30 (game:main.js:223-226) and the FOV resets to 70 | add a `temp` flag to `fov.set` that skips persistence |
| 26 | BO `onKeyCaptureImpl` 608/614, `keyName` 584 | allocates `modKeySet()` per key event; remapped modifiers get `key:'ShiftLeft'` and keep the source's `shiftKey` flags | cache `modKeySet` on register; add Shift/Control names and flags |
| 28 | BO `bindEntry` 639-640 | mod keybinds are set without checking for conflicts with game keys or other mods (only the reverse is blocked: a game action can't take a mod's key, 608) | reject codes used by `GAME_ACTIONS` or other mods |
| 31 | ZM `registerWithBus` 133-135 | polls every 200 ms forever when BO isn't installed | cap retries (for example 50) |
| 32 | ZM `changed` callback 136 | `refreshConfig` runs on any bus change (every key, `'__sections'`, and each key `bus.reset()` re-announces); resets the wheel-adjusted `zoom` (118) mid-zoom without re-applying FOV | filter `k.startsWith('zoom.')`; skip while `zooming` |
| 33 | ZM default `KeyC` 15 | the game uses `KeyC` to confirm the undo preview (game:main.js:2481-2484); both fire (no `preventDefault`) | skip while the undo preview is up, or change the default |
| 34 | ZM `start` 85-91 | without an earlier steal, the first zoom triggers it: the game Options screen flashes and pointer lock is lost and re-requested (ZM:73 / BO:188) (inferred UX). With BO, opening its menu once (BO:911) does the steal first | steal the FOV input once at load |
| 35 | CH keydown 84-89 | the microtask runs right after this capture listener (microtask checkpoint between listeners for browser events), before the game's `if (suggest.key(e)) e.preventDefault()` (game:main.js:2466), so history and suggestions both move on Up/Down | check the suggestion list's visibility, or defer with `setTimeout(0)` |
| 36 | CH `up/down` 51-64 | no `preventDefault`, so the input's default ArrowUp caret move runs after `setValue` (inferred), leaving the caret at the start | `preventDefault` once you know you're handling the key |
| 37 | CH keydown 70 | doesn't check `__tcOptions.capturing`/`__tcCaptured` (rule); low risk because it runs only while chat is open | add the guard for consistency |
| 44 | BO `setFov` 192-193 | same root cause as 25: it clamps FOV to 2-110 and writes it to `mc.fov`, but the game only accepts 30-110 on load (game:main.js:223-226), so any FOV below 30 comes back as 70. BO's own `syncFov` (172) now ignores such a value | fix with 25: keep the stored `mc.fov` at 30 or more, and hold the low zoom FOV only in memory |
| 45 | BO `patchHudScale` 310 + 320 | **hint and tab are scaled twice** when UI scale ≠ 1. `Hud.draw` passes its already-scaled `o.gs` to `this.hint`/`this.tab` (game:ui.js:741-742, their only callers), and the `wrapScale('hint'/'tab')` wrappers scale it again (gs·m²). `hint` partly clamps to the screen; the `tab` player list doesn't | drop the `hint`/`tab` wrappers (`draw` already covers them), keeping `suggestions` |
| 46 | SH `SHADOW_VS` 946 | copies only the plain tile UV, but the game's terrain VS remaps UVs for shaped faces (`aPos.y >> 12u`, `RECT[]`/`BOXUV[]`), so cutout shadows of shaped blocks (torches...) sample the wrong texels | port the game VS's UV remap into `SHADOW_VS` |
| 48 | BO `keybindsSection` 678-682 | "Reset all keybinds" calls each mod's `reset()` with no per-keybind try/catch: one that throws stops the loop and skips `refresh()` (the button's handler only logs it) | wrap each call, as `resetAll` does (815-817) |
| 49 | SH globals 612, 764, 788 vs game:dragonview.js:54 | all GL state (`G`, `ST`, `rec`, `curInfo`, `frameId`) is shared by every WebGL2 context on the page. Only frame counting is per context (`mainGL` = the first context to use a patched program, 977). A second context that drew patched terrain would use the main context's FBO and textures | keep state per context (`WeakMap<gl,…>`), or leave programs of other contexts unpatched |
| 50 | SH `inFootprint` 887, `finalizeShadow` 875-876 | the footprint test assumes a 128-tall chunk column centred at y = 64 (the world is 128 tall today) | derive it from the game's world height, with a compat entry |
| 51 | SH `terrainDraw` 1253, `drawShadowSet` 1144 | a remesh that keeps the same index count isn't seen as a change, so the shadow can stay stale until the 2 s `age` refresh. Worse, `e.n` only updates when the game draws the part: a chunk remeshed off-screen (behind the camera) keeps its old count, so the `age` refresh replays the new VBO with the old count. That truncates its shadow, or reads past the buffer when the mesh shrank (WebGL then fails the draw, inferred). Pre-existing | watch the recorded parts' buffer uploads (`bufferData` on the reused VAO's buffers, inferred) and take the count from there, or skip records whose buffer changed since they were last drawn |
| 53 | SH `PROGS` 610, 679 | filled with every patched program's info but never read | remove it, or list the programs in `debug()` |
| 54 | SH `hookError` 620-629 | the error budget is for the page's lifetime, not a rate: 20 unrelated, transient errors over a long session (one per hour, say) pause every effect until a reload | count per time window (for example 20 per minute), or decay `ERR.n` after a run of clean frames |
| 55 | CH keydown 71 | the IME check is `e.isComposing \|\| e.keyCode === 229`, but the game's `composing(e)` (game:main.js:2334) also checks its own `compose.on` flag, set from `#chatbox` `compositionstart`/`compositionend` (game:main.js:2583-2597). In rare IME cases, an Enter that ends a composition could still be recorded as a sent line | track `compositionstart`/`compositionend` on `#chatbox` the same way |
