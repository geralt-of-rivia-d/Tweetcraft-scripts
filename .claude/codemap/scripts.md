# Codemap: our Tweetcraft userscripts

Verified on 2026-11-06 against game build f6b38f505d (game references moved from c25d4c024d with a line diff of the two snapshots) and the working copies of SH 1.5.2 (2078 lines), BO 1.4.0 (1788), ZM 1.1.2 (269) and CH 1.0.1 (97). Abbreviations: **SH** `twitterentary-shaders.user.js`, **BO** `tweetcraft-better-options.js`, **ZM** `tweetcraft-zoom.user.js`, **CH** `tweetcraft-chat-history.js`, **game:** = `game/prod/<LATEST>/pretty/js/` (`game style.css` = `pretty/style.css`); its line numbers are those of build f6b38f505d. `SH:120` means file:line. Anything not checked directly in code is marked (inferred).

## 1. How the scripts relate

All four scripts are standalone `document-start` IIFEs on `https://tweetcraft.jai.vin/*`.

- **BO is the hub.** It sets up `window.__tcOptions` synchronously when it runs (BO:65).
  - The tooling loads BO first (`tools/lib/common.mjs:63-68`), and ZM polls every 200 ms until the bus exists (ZM:232-234), so for the bus itself load order doesn't matter.
  - Load order does decide which capture listener on `window` runs first.
- **SH** only needs to wrap `WebGL2RenderingContext.prototype` (and, since 1.5.0, `window.requestAnimationFrame`) before gfx.js creates its context and compiles its shaders in the `Gfx` constructor (game:gfx.js:703).
  - It reads `tc.shader.<key>` once at startup, clamped (SH:129), and publishes `window.Twitterentary` (SH:2024).
  - Its `set`, `applyPreset` and `reset` write the settings back; `bench()` changes `CFG` in memory and restores it.
  - It uses the bus only for `toast` (`notify`, SH:2030-2041) and `capturing` (the toggle-key guard, SH:2042-2054), and since 1.5.2 `registerKeybind` for that key (`registerToggleKey`, SH:2058-2075).
- **BO's Shaders tab** reads `Twitterentary.cfg`, `.schema` and `.presets` each time the tab is built, and writes through `TE.set`, `applyPreset` and `reset` (BO:1113-1160).
  - Its performance overlay reads `Twitterentary.perf` 4×/s, and its benchmark calls `Twitterentary.bench()` (with `bench.running`, `.defaults`, `.estimate`, and `.abort` to stop a run on Escape). All are feature-detected (§3).
  - With an older SH without `set`, it writes `cfg[key]` and `tc.shader.<key>` itself.
- **CH** shares nothing with the others.
- **ZM** publishes `window.__tcZoom` (new in ZM 1.1.1): BO reads `realFov` while `zooming`, so the slider and Copy all settings never show a zoomed FOV.
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
          v                                         v survival/client.js, keys.js                 | (fallback)
     game gfx.js GL calls                      game menus / HUD  <--------------------------------+
                                               #screen, "Options…" (any language), F1, Distance, --u/--d

  CHAT HISTORY --> #chatbox keydown (standalone)
```

**Bus `window.__tcOptions`** (all defined in BO)

| Member | BO line | Notes / consumers |
|---|---|---|
| `version` | 41 | `VERSION` = `GM_info.script.version` (20), `'0.0.0'` without `GM_info`. Shown in the About tab (1679) |
| `apiVersion` | 42 | `2` since 1.1.0 (adds `reset`, `ui.cycle`). Checked by compat; no script consumer yet |
| `config` (getter) | 43 | live `cfg` object. No consumer |
| `get(k, d)` | 44 | stored value, else a clone of `DEFAULTS[k]`, else `d`. Used by BO and ZM `tcGet` (ZM:44) |
| `set(k, v)` | 45 | `cfg[k]=v`, `save()` to `tc.options`, `emit(k, v)`. Used by BO and ZM `tcSet` (ZM:49) |
| `reset()` | 48-54 | `cfg = clone(DEFAULTS)`, `save()`, then emits every key that was set before as `(k, bus.get(k))`: the default for BO's keys, `undefined` for mod keys (`zoom.*`). ZM re-reads through `changed` → `refreshConfig`. The `keys.migrated` flag survives it, so a reset never migrates again. Used by `resetAll` (1642) |
| `register({id,title,build(api)})` | 55 | adds a tab `reg:<id>` (after Shaders, before Keybinds) and emits `'__sections'`; a repeated `id` is ignored. `build` must return an array of nodes (spread into the screen at 1718). ZM:245 (Zoom tab) |
| `registerKeybind({id,label,get,set,reset})` | 56 | listed in the Keybinds tab, emits `'__keybinds'`; a repeated `id` is ignored. ZM:236 (`defaultKey` is passed but never read); BO itself registers `tc.perfOverlay` (1086). `reset` may be async: `resetAll` awaits it |
| `changed(cb)` | 57 | `cb(key, value)` on every set or emit; no way to unsubscribe. ZM:235, BO's overlay (1082) |
| `open()` | 58 | `openMenu` (async). No consumer |
| `toast(text, ms)` | 59/75 | writes `#note.show` for `ms` (default 2 s; the `ms` argument is new in 1.2.0); `console.log` if there's no `#note`. SH `notify` |
| `fov {get,set,setNow,prime}` | 317 | `get` = `getFov`, `set` = `setFov` (async). **New in 1.3.0:** `setNow(v)` = `setFovNow`: synchronous, writes at once and returns true if the input is cached, else returns false and does nothing (never opens a menu); `prime()` = `primeFov`: one async attempt to fill the cache, never rejects. `_forget()` is a test seam. ZM:111, ZM:184, ZM:143 |
| `settingsText()` | 1336 | new in 1.3.0: the exact text the Copy all settings button copies (§3). compat's check |
| `capturing` | 61, 764 | true while the Keybinds tab waits for a key. ZM:195,201, SH's K listener and BO's `onPerfKey` and `onBenchKey` check it; CH doesn't |
| `ui {h,T,row,note,header,btn,toggle,cycle,slider,item,refresh,toast,prettyKey}` | 1731 | builder kit. Sections actually get `api()` (1728-1730), which adds `bus, currentKeyFor, fov` |
| `build`, `close` | 1732-1733 | `buildScreen` / `closeMenu`. No consumer |
| test seams | 106, 186, 353, 407, 545-549, 939-948, 986, 1520-1521, 317 | `_injectMenus`, `_labels` (compat's i18n check), `_setRenderDistance`, `_sendF1(onlyIfHidden)`, `_injectUi, _patchHud, _patchSurvival, _injectSurvival, _rescaleLabels`, `_injectKeys(m)`, `_nativeKeys()`, `_migrateKeys()`, `_keybinds()`, `_runBench(opts)`, `_benchText(b)`, `fov._forget()` (compat's runtime checks) |

**localStorage**

| Key | Format | Writers | Readers |
|---|---|---|---|
| `tc.options` | JSON `{ui.scale, hud.on, input.sens, keys.map{src:def}, keys.mute[def], keys.migrated, perf.overlay, perf.key, bench.last, zoom.key, zoom.level, zoom.look}` (`bench.last`: §3) | BO `save` (33), also from `bus.reset` (52); ZM:50 fallback only | BO:32 once at load; ZM:45 fallback |
| `tc.shader.<CFG key>` | `String(value)`; removed when it equals the default | SH `persist` (SH:173-181, from `set`/`applyPreset`, which includes the K toggle); SH `reset` removes every `tc.shader.*` key (SH:1990-2000); SH `bench()` restores every key exactly afterwards (`lsRestore`, SH:1809-1815); BO `setShader` fallback (1125-1127) and `clearShaderKeys` (1113) | SH:129, only at startup, through `coerce` |
| `tc.shader.format` | `'1.5'`: this profile was saved by SH 1.5.0+ | SH: the one-time 1.4.0 High/Ultra migration (SH:138-158) and `persist` with its first non-default value (SH:173-181); removed by SH `reset` and BO `clearShaderKeys` with the other `tc.shader.*` keys; `bench()` restores it exactly | SH:140, at startup (it gates the migration) |
| `tc.shader.toggleKey` | a key code; absent = `KeyK` | SH `setToggleKey` (SH:165-171), through the keybind's `set` and `reset`, and SH `reset` | SH:164, only at startup; BO `modKeysSaved` (878), during the key migration. Not in `CFG`, `SCHEMA` or `DEFAULTS`: it's a key code, not a shader setting |
| `mc.fov` | number. The game accepts 30-110 (game:main.js:210-213) | game slider `oninput` (game:menus.js:1825-1829), BO `setFov` (312), ZM's `pagehide` (ZM:210) | game, BO:190/199, ZM:63 |
| `mc.keys` | the game's own binds, JSON `{bindId: code}` (game:keys.js:1) | the game's Controls screen; BO once, through `K.set` in `migrateKeys` | the game; BO through `/js/keys.js`, never by name |
| `mc.rd` | one of 4,6,8,10,12 (game:view.js:1) | game `cycleRd` (game:main.js:3269-3271), BO:350 | game (game:main.js:235), BO:324 |

**Shared DOM / CSS:**
- **Elements:** `#gl` canvas (BO, ZM: pointer-lock checks), `#screen` with class `on` and `#screen .inner` (BO, ZM), `.tc-marker` (BO's "our menu is open" flag, 188/1708), `#inv.off` (BO:767), `#hudtop` (BO:389, the game's HUD state; also BO's overlay placement, 1033, with `#hudright`), `#tc-perf` (BO's overlay, 1002), `#note.show` (BO toast, SH `notify` fallback), `#chatbox` (CH; BO's `chatOpen` reads its `hidden`, 1092), `.se, .sp, #sign-editor, #book-screen` (the game's editors, BO's `editorOpen`, 1093; ZM's `canZoom` checks `.se`), `#screen.on .keylist` (the game's Controls screen: BO's `controlsOpen`, 1095, and SH:2050), `#screen .inner .tc-bench-screen` (BO's benchmark screen marker, 1366), `#cross` (BO CSS scales it by `--tc-s`; BO's `primeNow` and ZM's `crossOn` read its `.off` as the sign that no menu is up).
- **BO's `<style>` (`ensureCSS`, 631-691):** styles `#screen .inner .tc-*`, sets the pixel font, sizes captions with `--tc-f`, scopes its button text rules to `#screen .inner:has(> .tc-marker)` (our screen only), and hides the game's English `Distance:` and `Fullscreen` pause buttons.
- **`<style id="tc-options-i18n">` (162-176):** hides the same two buttons by their translated labels.
- **Distance:** BO still clicks the hidden Distance button (332-352, the click at 347).
- **CSS variables:** BO sets the root variables `--u`, `--d` and `--tc-s`.

**Capture-phase listeners (all on `window`).** Listeners on the same target run in registration order, which is the script load order.

| Script | Events | Guards |
|---|---|---|
| BO | `keydown`/`keyup` (809-810), `keydown` `onPerfKey` (1110), `keydown` `onBenchKey` (1431), `click` (1762), `mousemove` (1765); also, not capture-phase, `fullscreenchange`/`resize` `onBenchResize` (1438-1439) | skips events marked `e.__tc` (its own synthetic events); calls `stopImmediatePropagation` when it swallows, remaps or mutes a key (remap and mute only on the legacy path, §3). `onPerfKey` also skips `__tcCaptured`, `capturing`, IME, typing, chat, `#inv`, editors and the game's Controls screen, and only calls `preventDefault`. `onBenchKey` acts only on Escape while a benchmark runs on its screen (not while capturing or typing): it marks the event `__tcCaptured` and calls `stopImmediatePropagation`, so the game never opens its pause menu. `onBenchResize` only stops a running benchmark (in fullscreen, Chrome uses the first Escape to leave fullscreen and never sends the keydown) |
| ZM | `keydown`/`keyup` (194,200), `wheel` passive:false (213), `mousemove` (221) | `e.__tc` (BO's synthetic press), `e.__tcCaptured`, `__tcOptions.capturing`, typing. No modifier check on purpose. `canZoom` stops it on any game screen, Controls included, and in the skin editor |
| SH | `keydown` `toggleKey`, KeyK by default (2042-2054) | repeat, modifiers (flags ignored when the bound key is itself Control, Alt or Meta, 2045), `e.__tc` (BO's synthetic press), `e.__tcCaptured`, `__tcOptions.capturing`, `bench.running`, typing (`e.target`), `#screen.on .keylist` (2050, so a key the player is binding in the game's Controls doesn't flip the shaders). A registered keybind since 1.5.2, `tc.shaders.toggle` |
| CH | `focusin`, `keydown` (66,70) | runs only while `#chatbox` is visible; skips IME composition (71) |

**How they avoid conflicts:**
- **Key capture:** while a key is being captured, BO marks the event `e.__tcCaptured=true` and calls `stopImmediatePropagation` (782-783). That blocks every listener registered after BO's. `bus.capturing` covers the scripts that registered before BO (ZM and SH check it).
- **BO's own events:** BO tags its re-dispatched events with `ev.__tc=true` so its handler skips them (778): the legacy remaps (802), and the Hide HUD keydown and keyup (394-399). `onPerfKey` (1102), SH's toggle keydown (SH:2046) and ZM's keydown and keyup (ZM:195, 201) ignore them too, so a synthetic press can't flip the overlay, the shaders or the zoom.
- **When remapping is skipped:** always once `nativeKeys` is set, because the game rebinds its own keys (791). On the legacy path, for mod keys with no saved remap (`modKeySet()`, 769/795, which includes the overlay key and, with SH and ZM loaded, K and Z; since 1.4.0 a saved remap wins over a mod's key), and while a screen is open, the inventory is open, or the user is typing (768).
- **Mouse look:** BO's and ZM's `mousemove` handlers each redefine `movementX/Y` with `defineProperty`, multiplying in sensitivity and the zoom-look scale. The order doesn't matter (commutative).

## 2. twitterentary-shaders.user.js (SH, 2078 lines)

**Purpose:** patches the game's GLSL at `shaderSource` time:
- terrain VS: waving, plus the class lookup;
- terrain FS: lighting, AO, shadows, water, grading and fog;
- sky FS;
- cloud FS (broken).

It adds a sun shadow-map pass, which since 1.5.0 draws two tiles into one depth atlas: a sharp near tile around the camera and the full-range far tile. It measures frame, CPU and GPU time for `Twitterentary.perf` and `bench()`. Every frame renders straight to the canvas at 100%: render scale, the scene framebuffer, the composite and the Auto governor were removed in 1.5.1 (commit `d73912c` holds them, for a selective restore in 1.6). Everything is driven by uniforms computed from GL calls it observes. Every setting applies live, and Quality/Look presets set groups of them.

**Metadata:** `@version 1.5.2`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.twitterentary`. The in-code `VERSION` (16-18) reads `GM_info.script.version` (`'dev'` without `GM_info`) and feeds `debug()`, `bench()`'s `env.version` and the load log, so there's nothing to keep in sync.

| Name | Line | Purpose |
|---|---|---|
| `TAG, VERSION` | 15-18 | |
| `CFG` | 21-52 | 26 settings (table below). The defaults are Quality Medium + Look Natural |
| `DEFAULTS` | 53 | frozen copy of `CFG` |
| `SCHEMA` | 56-78 | 21 UI rows for BO: every CFG key except `shadowDepth`, `shadowTaps`, `shadowCull`, `shadowCascades` and `cloudEffects`. `group` (`quality`/`look`) names the preset picker that owns the key; `section` is its heading in the tab (Quality, Look, Motion & water). Types `bool`, `num` (`min/max/step`) and `choice` (`options: [[value, label]…]`). No `reload` flags |
| `FIELD, HIDDEN_RANGE` | 79-82 | key → SCHEMA row; clamp ranges for the keys without a row (`shadowDepth` 64-1024, `shadowTaps` 2-16) |
| `RANGE` | 84-85 | `[min, max]` of every numeric key (the SCHEMA range, or `HIDDEN_RANGE`), shared by `coerce` and `cfgNum` |
| `PRESETS, GROUP_KEYS, deepFreeze` | 87-102 | `{quality: [low, medium, high, ultra], look: [natural, vivid, soft]}`, each `{id, name, desc, values}`, deep-frozen. Low is `{shadows: false}`. `GROUP_KEYS` = the SCHEMA keys of each group (6 quality, 8 look) |
| `coerce` | 108-118 | `coerce(key, v)`: bools from `true/'true'/1/'1'`; numbers clamped to `RANGE`; a `choice` must be one of its options; non-finite → default |
| `cfgNum` | 121-125 | the live numeric value of a key, normalised like `coerce` (not a number → default, else clamped to `RANGE`) even if `CFG` was written directly from the console. Allocation-free, used by the frame code |
| `same, SKEY` | 126-134 | `same` = equal within 1e-6; `SKEY(k)` = `'tc.shader.' + k` |
| localStorage load | 129 | every CFG key from `tc.shader.<k>`, through `coerce` |
| `FORMAT_KEY, formatSaved, LEGACY_140` + the 1.4.0 migration | 138-158 | `tc.shader.format` = `'1.5'` marks a profile already saved by 1.5.0+ (`formatSaved`). Without it, a saved Quality group that is exactly 1.4.0's High or Ultra (shadowSize 4096 plus that preset's extent, filter, every and move, and every other Quality key at its default) loses its saved `shadowSize`, so the profile reads as High/Ultra again (2048 plus a near tile instead of a 6144×4096 atlas), and the marker is written. Any other combination is left alone. Idempotent; logged once with `console.info` |
| `persist` | 173-181 | writes `tc.shader.<key>`, or removes it when it equals the default. With the first non-default value it saves it also writes the `tc.shader.format` marker, so a 1.5 user who picks High and then deliberately sets 4096 is never migrated back |
| `TOGGLE_DEFAULT, TOGGLE_STORE, toggleKey, setToggleKey` | 160-172 | **new in 1.5.2.** The on/off key, read from `tc.shader.toggleKey` at load, so it also works without BO. Saved the way `persist` saves a setting (only when it isn't the default), but kept out of `CFG`, whose shape BO and the bench read |
| `proto`, `O` | 183-192 | bails out without WebGL2. `O` = 22 original methods: the 18 wrapped ones plus `uniform1i`, `uniform4f`, `uniformMatrix4fv` and `bindFramebuffer`, so our own calls skip our wrappers |
| `RAF` + `requestAnimationFrame` wrapper | 197-215 | **new.** Wraps every rAF callback once (a `WeakMap` fn → wrapper, so the game's recurring `step` allocates nothing per frame) to record `RAF.seq`, the callback's start time `t0`, its timestamp `ts` and whether a callback is running (`active`). The game looks `requestAnimationFrame` up at each re-arm (game:frameloop.js:7), so this document-start wrapper is the one it uses |
| `clamp01, sstep, dot, normInto, mixInto, copy3` | 217-222 | math helpers; the `*Into`/`copy3` ones write into a target array (no allocations) |
| `layerBits, layerDecl` | 230-231 | **new in 1.5.1.** `layerBits` = 9 when the game's terrain VS holds the `aPos.z >> 9u` decode (set in `patchTerrainVS`, so staging without that bit stays at 8). `layerDecl()` emits the `int tcLayer = …;` line for the terrain VS and the cutout shadow VS. We can't use the game's own local `layer`: it comes after the `vec3 p = …` line we insert at |
| `patchTerrainVS` | 233-269 | anchors on `uniform vec3 uOrigin;`, `out vec2 vLight;` and the `vec3 p = …*0.0625+uOrigin;` regex. Adds 7 uniforms (`uClsTex, uCam, uTime, uFx, uWaveOn, uLeafSway, uPlantSway`) and **one** output, `out vec4 vTcP` (245): the camera-relative position in `.xyz` and the layer class in `.w`. After `p` it fetches the class by `tcLayer` (`tcC`, behind `uFx`), writes `vTcP = vec4(p, tcC)` (268), then waves. The class is constant across a face, so the smooth varying interpolates to itself and the FS rounds it. **No `flat`:** the 1.5.0 betas' `flat out float vCls` cost about 2.3-3 GPU ms at rd 12 on the UHD 620 (LAB2), most likely ANGLE D3D11's provoking-vertex geometry shader, which ANGLE adds to a program with a flat varying (inferred; the game's own `vGlass` measured far less, see Hot paths). smoke forbids the string `flat ` in every terrain shader (`max: 0`), comments included. Since SH4 there is no VS block-light term (`tcBright`/`tcLm`/`vTcBlk`, `uTcSkyL`/`uTcAmbL`) and no `mainEndIndex` |
| `shadowGlsl` | 277-325 | new: `tcTap` and the two-tile `tcShadow` (below) |
| `fsDecls(mode)` | 327-379 | the FS uniforms (30, including new `uAmb0, uAmb1, uSunC, uSunK, uGrade, uShadowB, uShadowN` and `uTcLm0`), `in vec4 vTcP;` (363), `tcTone` (now a cubic roll-off instead of `exp`) and `shadowGlsl()`. `tcWv` (the wave function) is added only for mode 2 |
| `WATER_CODE` | 384-418 | the water model (below), emitted only into the translucent (mode 2) FS |
| `shadeCode(lit, alpha, mode, fogR)` | 420-510 | replaces the output line (below) |
| `patchTerrainFS` | 512-528 | `outRe` captures lightmap use and alpha; `cRe` (the `texture(uTex, vUV)` fetch) and `main` must exist. `mode`: 2 = `alpha==='c.a'` (translucent), 1 = has `discard` (cutout), 0 = opaque. `fogR` = the FS declares `uniform vec2 uFogR`. At the top of `main` it unpacks the locals `vec3 vRel = vTcP.xyz; float vCls = floor(vTcP.w + 0.5);` (523), so `shadeCode` reads `vRel`/`vCls` as before. New: `dFdx/dFdy(vRel)` are taken right after the fetch, in uniform control flow before any `discard`, and skipped with effects off |
| `skyCode`, `patchSky` | 530-573 | inserts `uSkySun/uSkyDay/uFx/uSkyOn` and (new) `uSkyGlow` after `out vec4 o;` and replaces `o=vec4(c,1.0);` (lit) or `o=vec4(mix(uHor,uTop,sqrt(t)),1.0);`. Always patched; it returns the vanilla colour when `uFx` or `uSkyOn` is 0 |
| `patchCloud` | 575-583 | **dead**: double-escaped regexes and a literal `\\n` in the inserted text (issue 1). Gated by `CFG.cloudEffects` |
| `patchSource` | 585-597 | dispatcher, needs `#version 300 es`. VS: `aPos & uvec3`. FS: `sampler2DArray`+`vShade`+`uFog`+`vDist`. Sky: `uTop, uHor`. Cloud: `uTint, uHole` |
| `FIXED_SUN, OBS, CAMLAST, locKind` | 601-611 | observation state. `locKind`: WeakMap<UniformLocation, 1..6> |
| `setCam`, `onSprite` | 613-618 | camera from the cloud plane's `uCam`; sun = the first `uC` after `uTop` in the frame |
| `ATL` + indexOf hook | 620-636 | a temporary `Array.prototype.indexOf` wrapper captures the block-name list searched for `'oak_planks'` (game:main.js:356, `eng.texNames`). It restores the original right after the capture, if it's still ours, or after 60 s at the latest |
| `RE_EMIT, RE_PLANT, nameClass` | 638-646 | name → class: 0 none, 1 leaves, 2 plant, 3 water, 4 emissive. `RE_EMIT` also matches the game's own name `lumen` (glowstone is "Lumen Rock") and, since 1.5.1, `spark_lamp_on`; `torch_off` is excluded, so `spark_torch_off` no longer glows. Since 1.5.2 `nameClass` also excludes `^campfire_log$` (640-641): `RE_EMIT` matches `campfire`, and that layer is the unlit log. `campfire_log_lit` and `campfire_fire` still glow |
| `readAtlas` | 648-666 | per-layer transparency and mean RGB from the 16×16 array upload. On a paged atlas it runs once per page and `ATL.n` ends at the last page, which does no harm: the class row isn't read at uFx = 0 |
| `layerClass` | 668-691 | class by name, falling back to colour and animation heuristics |
| `CLS_COUNTS, uploadClasses` | 693-717 | 1-row RGBA8 texture (R = class) on unit 7. It reuses `G.clsData` and uploads, and logs, only when a class changed. Then marks the shadow tiles dirty |
| `shaderSrc, progShaders, progInfo, PROGS` | 721-724 | WeakMaps: shader → `{orig, info, patched}`, program → shaders, program → `info`. `PROGS` lists every info but is never read (issue 53) |
| `curInfo, … rec, cols` | 727-730 | per-frame state: `curInfo`, `curVAO` (the main context's binding, which the shadow pass puts back), `frameId`, `mainGL`, `lastOrigin`, `haveOrigin`. `rec`: Map<VAO, part record>. `cols`: Map<column key, {p0, p1}> (the opaque and cutout records of a chunk column) |
| `ERR, hookError` | 734-743 | the first 3 hook errors are logged (`STATS.errors` counts them all). After 20 in the page's lifetime (not a rate, issue 54), `ERR.off` pauses the effects until a reload |
| `U1, U3, V1, V3` | 748-752 | the float and vec3 uniforms pushed to every patched program, and their per-frame values (20 floats and 10 vec3s). Since the 1.5.0 review `uAmbStr`/`uSunStr` are gone (issue 57): `ambientStrength` and `sunStrength` reach the GLSL only through `uAmb0/uAmb1` and `uSunC`. Since SH4 `U1` has no `uTcAmbL` and `U3` has `uTcLm0` instead of `uTcSkyL`; `V3` holds `uSunC` at 21-23, `uSkyGlow` at 24-26 and `uTcLm0` at 27-29 |
| proto wrappers | 760-877 | `shaderSource` (strips the game's flat varying first, below), `compileShader, attachShader, linkProgram, getUniformLocation, uniform3f, uniform3fv, uniform1f, texImage3D, texSubImage3D` |
| `FLAT_GLASS` | 758 | **new in 1.5.1.** The game's `flat out float vGlass` (VS) and `flat in float vGlass` (every terrain FS and the stained-glass depth FS) become plain `out`/`in`, for every source through `shaderSource`, before `patchSource`: ESSL 3.00 needs both stages to agree, so this also covers sources `patchSource` returns null for. `d.orig` stays pristine, so the compile and link fallbacks restore both stages together. `vGlass` is 0 or 1 and constant over a quad, so interpolation keeps it and the game's 0.5 test can't flip. A program only the strip touched is neither registered in `progInfo` nor logged. This also runs with shaders switched off. The game's `vGlass = …` line and `uGlass` stay untouched: gfx.js uploads `uGlass[0]` when the program has it. It's there because the smoke guard forbids `flat ` in terrain shaders, not for speed: no measured benefit on the title screen (Hot paths) |
| `bindVertexArray`, `deleteVertexArray` wrappers | 880-886 | track the main context's `curVAO`; deleting a recorded VAO marks its shadow tiles dirty and forgets the record |
| `vboVao, curABuf`, `bindBuffer`/`bufferData` wrappers, `remeshed` | 892-922 | **new: exact remesh tracking (fixes issue 51).** `gfx.setChunk` binds a part's VBO while its VAO is bound when it creates the part, and re-uploads that VBO with `bufferData(ARRAY_BUFFER, data)` on every remesh, drawn or not. So `bindBuffer` remembers VBO → VAO, **first bind wins** (a remesh rebinds the VBO under whatever VAO is then bound, normally none, which must not re-map it; only object buffers are recorded, so `null` or a stray value is ignored), and `bufferData` gives the part's record its new index count right away (`bytes / 32` quads × 6, capped by the shared index buffer, whose size the `ELEMENT_ARRAY_BUFFER` upload reveals), marking the tiles it is in dirty |
| `clear` wrapper | 925-928 | the frame tick: `clear(mask & COLOR_BUFFER_BIT)` on `mainGL` only |
| `cascade, G` | 936-948 | GL resources (`clsTex, clsData, clsW, maxTex, fbo, depthTex, texSize, texW, texH, farX, checkFbo, allocFailed, pOpaque, pCut, shadowOk`), `pCutSolid` (the far tile's leaf program), `dirty`/`dirtyN` (far/near tile), `nSize`, `lastRef` (frame of the last tile redraw), `nearNext` (the near tile is due the frame after a far redraw), and the two tile snapshots made by `cascade()`: `G.sh` = the far, full-range tile (`Twitterentary.shadow`, with `G.sh.near` = `G.nr`), `G.nr` = the near tile. Each holds `valid, drawn, frame, ms, c0, L, R, U, dx, dy, hx, hy, E, Z, size, cull, refresh, why` and (new) `d0`, the `stress({moveSpeed})` drift at its last redraw |
| `LM_D, lightMat` | 950-960 | ortho light matrix of a tile relative to `at`, from the basis and the extent/depth snapshotted at its last refresh, with the texel snap `dx, dy` |
| `SUN_LOW … STATS, STRESS, SCRATCH, isEnd, num` | 962-979 | derived per-frame state and counters. `WHY` = `['', init, dirty, move, sun, age, stress]`. `STATS = {shadowChunks, refreshes, why, tiles: {near, far, nearChunks, farChunks}, errors}`. `STRESS = {shadowRefreshEvery, forced, moveSpeed, drift, drifted, lastMs}` (`drift` = the emulated camera offset, `drifted` = blocks so far). `isEnd` matches the End's `uSkyLight` (compat-checked) |
| `updateState` | 981-1021 | once per `frameId`, allocation-free: time, cam, `dim`, day = `clamp01(OBS.top[2])` (the zenith's blue channel), sun, `sunL` (y ≥ 0.14), sun colour (`SUN_LOW` → `SUN_NOON`), cloud tint; fills `V1`/`V3` from `CFG`, and, new in 1.5.0, the uniform-only parts of the shading: `uSunK` = day × a horizon fade (0 in the Nether/End), `uSunC` = sun colour × `sunStrength` × `uSunK`, `uGrade` (0 while saturation and contrast are neutral), `uAmb0/uAmb1` (`ambientEnds`), `uSkyGlow` (the sun glow colour × its visibility around the horizon) and last `uTcLm0` (`tcLm0`, 1020) |
| `tcLm0` | 1024-1031 | **new in SH4.** `uTcLm0` = the game's `lightmap(vec2(0.0))`, computed per frame on the CPU from the game's own `uAmbient` and `uSkyLight` as observed last frame (`OBS.amb`, `OBS.sl`), with the same curve (`bright`, the warm block tint, the `vec3(0.75)`/0.04 mixes, the 0.5 gamma mix). The lit FS subtracts it from the game's `lightmap(vec2(0.0, vLight.y))` to get the engine's block-light term. This is the only place the curve is still mirrored (at l = 0); compat's `LIGHTMAP` anchor fails if the game changes it |
| `put3, AMB*, ambientEnds` | 1032-1053 | **new.** The hemisphere ambient's two endpoints (normal down = `uAmb0`, up = `uAmb1`), computed on the CPU once per frame: day with its twilight tint, mixed with night by `day`, or the flat Nether/End colours, times `ambientStrength` |
| `shadowTargetSize` | 1055-1057 | `cfgNum('shadowSize')` (1024-4096), capped at `MAX_TEXTURE_SIZE` |
| `NEAR_R, NEAR_SPARE, NEAR_MAX, COS_SUN, SHADOW_AGE_MS` | 1059-1063 | near tile: radius 24 blocks plus its spare margin `max(shadowMove, NEAR_SPARE)` (`NEAR_SPARE` = 8, new in SH4; it was `shadowMove`, i.e. 4 on High and 2 on Ultra), at most 2048 px. The near tile is redrawn once the camera has moved that margin, so High and Ultra now redraw it every 8 blocks. A sun turn of about 0.25° redraws the shadows (1.4.0: 0.17°). Age safety net 10 s (was 2 s, now that remeshes are tracked exactly) |
| `finalizeShadow(gl, canDraw)` | 1075-1164 | first advances the `stress({moveSpeed})` drift once a frame (0.6/0.8 of the step on x/z, a hitch counts at most 1 s); sets `ST.shadowOn` and decides which tile to refresh (below); snapshots the chosen tile(s) through `snapCascade` (a far redraw that keeps the light basis, `keep` at 1123, leaves the near tile valid); fills `ST.lvp` and the packed `uShadowP`/`uShadowB`/`uShadowN` values. When shaders or shadows are switched off, it shrinks the atlas back to 1×1, once |
| `camDist, snapCascade` | 1167-1185 | `camDist(cam, C)` (new; replaces `dist3`): the camera's distance from tile C's centre at its last redraw, plus the stress drift since then (`drift − C.d0`, zero without it), used by the two `move` tests. Only the redraw decision sees the drift; the tiles stay centred on the real camera. `snapCascade`: a tile's light basis (`R = L × +Z`, `U = L × R`; the near tile reuses the far tile's `L`), centre, extent, depth, size, culling and texel snap, plus the footprint margins `hx/hy`, and records `d0` |
| `inFootprint, markDirty, forget` | 1188-1211 | is a part record inside a tile's area (it assumes a 128-tall column centred at y = 64, issue 50)? `markDirty` dirties the tiles a changed caster is in; `forget` drops a record from `rec` and its column |
| `makeProg`, shadow GLSL, `shadowProg` | 1213-1286 | built with `O.*`, bypassing the patcher. `SHADOW_VS_OPAQUE`/`SHADOW_FS_OPAQUE` are depth only, with an empty FS. `shadowVS(skip)` (new in 1.5.1; a function because `layerDecl()` is only known once the game's terrain VS was seen, and `initGL` runs after that: gfx.js links a terrain program first) takes the classes that don't cast. `G.pCut` = `shadowVS('c > 1.5 && c < 3.5')` + `SHADOW_FS`: cutout alpha test against the atlas, plants and water culled. `G.pCutSolid` = `shadowVS('c < 0.5 || c > 1.5')` + the depth-only FS: leaves only, so the far tile's leaves are solid quads with no alpha test (LAB: about 15% cheaper redraws); the near tile alpha-tests them (holed leaf shadows). `shadowProg` sets `uClsTex = 7` and `uTex = 0` |
| `initGL` | 1286-1338 | on the game's first `useProgram` of a patched program (in `prog()`, game:gfx.js:853, during the `Gfx` constructor). Sets `mainGL`, `maxTex`, `clsTex` on unit 7, a **1×1** `DEPTH_COMPONENT16` compare texture on unit 6, the shadow FBO and the three shadow programs, whatever `CFG.shadows` is. Last `initTimer` (the GPU timer queries) |
| `resolveLocs` | 1340-1359 | per program, once: the uniform locations, then the samplers (`uShadowMap = 6`, `uClsTex = 7`); allocates the value caches |
| `applyUniforms` | 1361-1386 | `resolveLocs` first, so the samplers are on units 6/7 even if something below throws on a program's first use; then `updateState`; `uploadClasses` when dirty; uploads each `U1`/`U3` value only if it differs from the program's cache; `pushCam` only once the frame's camera is final (`ST.camFrame === frameId`) |
| `pushCam, pushMat, push4` | 1388-1413 | cached `uCam`, `uShadowOn`, and while shadows are on the far tile's light matrix `uLVP` and the packed `uShadowP`/`uShadowB`/`uShadowN` vec4s; `pushMat`/`push4` upload only on change |
| `offProgram` | 1417-1427 | the paused path, and every `info.vanilla` program: `uFx = 0` and the two samplers, once per program |
| `useProgram` wrapper | 1429-1439 | `initGL` once, `curInfo`, then `offProgram` when `ERR.off` or `info.vanilla`, else `OBS.lit` and `applyUniforms` |
| `resizeShadow` | 1442-1452 | `texImage2D` of the depth atlas on unit 6 at `(near size + far size) × far size`, restoring the active unit; flags an FBO check |
| `drawShadowSet` | 1454-1471 | one draw per record of a pass (opaque or cutout) inside a tile. Casters inside it keep casting however long ago they were drawn (behind the camera, for example); records outside the full map that haven't been drawn for 60 s are forgotten (a leak guard) |
| `renderShadow` | 1476-1516 | the shadow pass (below) |
| `drawTile` | 1517-1533 | one tile: viewport and **scissor** to its rectangle of the atlas, culling from its snapshot, `clear(DEPTH)`, opaque then cutout records (`pCutSolid` for the far tile when there are two); counts `STATS.refreshes`, `STATS.tiles` and the reason |
| `trackColumn` | 1538-1555 | when a column's opaque or cutout part is drawn without its sibling, the sibling's mesh became empty: forget it (and mark its tiles dirty) |
| `terrainDraw` | 1557-1598 | the frame's first terrain draw rebuilds the camera from `uOrigin` deltas, then runs `finalizeShadow(gl, mode < 2)`, `renderShadow` and `pushCam`. A throwing `renderShadow` is caught: no shadows that frame, the tiles are invalidated, `hookError`, and `pushCam` still runs. Every opaque/cutout draw updates its record (a new record in a tile marks it dirty), then `trackColumn` |
| `drawElements` wrapper | 1600-1606 | calls `terrainDraw` when `curInfo.terrain && curVAO && haveOrigin && !ERR.off` |
| `VP, PF, CPU_BOUND_MS` | 1614-1616 | `VP`: the viewport the game's frame currently draws with, so the shadow pass needs no `getParameter(VIEWPORT)`. `PF`: per-frame timing (`pending`, `seq`, `inRaf`, `prevTs`, `dt`, `t0`) and `id`, the count of game frames started (= `PERF.frame`; it tags the timer queries). A rAF callback over 12 ms is CPU-bound (`perf.cpuBound`, the bench's note) |
| `TQ_N, TQ, PERF, PT, BREC, BREC_MAX_MS` | 1621-1637 | `TQ`: a ring of `TQ_N` = 128 `TIME_ELAPSED` queries (`EXT_disjoint_timer_query_webgl2`), each tagged with its frame id. `PERF` = `Twitterentary.perf`. `PT`: the 250 ms perf window, the refresh history for refreshes/min and `gf`/`gT`, the `fpsGame` window. `BREC`: the bench recorder: `dt` keeps the first 16384 intervals (percentiles), `m` counts every interval (the means, `dtSum`), and intervals up to `BREC_MAX_MS` = 5000 ms count, so very slow renderers still get a row |
| `initTimer` | 1639-1648 | the ring of `TQ_N` timer queries if `EXT_disjoint_timer_query_webgl2` exists (all or none: a failed `createQuery` leaves `TQ.ok` false), then `PERF.timer` |
| `frameStart` | 1652-1662 | called from the frame's viewport (below): times the frame, queues `frameEnd` as a microtask and starts the GPU timer |
| `frameEnd` | 1666-1675 | the microtask after the game's whole rAF callback: ends the timer query, polls finished ones and runs `perfFrame` |
| `timerBegin, timerPoll` | 1678-1695 | one query per frame from the ring of 128, polled (up to 32 per frame) and never blocking. Results arrive 0.25-1.5 s late on the UHD 620 with D3D11. They feed `PERF.gpuMs` (the mean over each 250 ms window), `PERF.gpuRing` and the bench |
| `gameFps` | 1700-1704 | **new in 1.5.1.** `PERF.fpsGame`, counted exactly as the game's F3 counter (game:main.js `frameBody`): `gf++` per frame, and when `ts - gT > 1000` it publishes `gf` and restarts, on the rAF timestamp. Called only for frames inside rAF, so a stray viewport can't add to it. 0 until the first window closes. The game's window can't be read, so F2 and F3 can still read 1 apart |
| `perfFrame` | 1707-1739 | per frame: `gameFps` (inside rAF), then accumulates intervals (under 1 s), callback (CPU) times and the bench recorder (intervals under `BREC_MAX_MS`). Every 250 ms it publishes `PERF` in place (fps, ms, cpuMs, gpuMs, cpuBound = cpuMs > 12, shadow refreshes per minute over about 5 s, timer); a GPU-disjoint period discards that window's GPU samples |
| `viewport` wrapper | 1741-1753 | on `mainGL`, the first full-canvas `viewport(0, 0, canvas.width, canvas.height)` since the last frame ended is `gfx.draw`'s frame start → `frameStart`. A throw there can only come from `beginQuery`: it's caught locally and sets `TQ.ok = false`, not `hookError`, because 20 hook errors pause every effect. Every call is tracked in `VP` and passed through |
| `BENCH_DEFAULTS, BENCH_SETTLE, benchOpts, BENCH_MOTIONS, parseScenario` | 1758-1797 | `{seconds: 6, warmup: 2, scenarios: [current, off, low, medium, high, ultra]}`, 0.5 s settle per scenario. `parseScenario` uses `npm run bench`'s grammar: `off`, `current` or a Quality preset, `+key=value`…, then one motion suffix. `BENCH_MOTIONS` (new) maps the suffix to `stress()` options: `-moving` = `{moveSpeed: 11}` (creative flying), `-sprint` = `{moveSpeed: 22}` (sprint-flying), `-stress` = `{shadowRefreshEvery: 4}` (a forced redraw every 4 frames, the worst case; this is what `-moving` meant before). `vanilla` and unknown names give an `n/a` row with a note |
| `lsSnapshot, lsRestore, r3, naRow, benchRow, benchEnv` | 1799-1843 | every `tc.shader.*` key saved and restored exactly; a row = `{name, fps, ms, p95, low1, cpuMs, gpuMs, scale, refreshPerMin, note?}`, with `scale` always 1 on a measured row (`null` on an `n/a` row) (the means divide by `BREC.m`, the percentiles use the stored `n`; GPU only when at least half the frames have a timer sample; note `cpu-bound` when cpuMs > 12); `env = {gpu, w, h, dpr, version, timer}` |
| `BCTL, benchWait` | 1846-1847 | The running bench's control object (`{aborted, restored, wake, timer, restore}`, null when idle); `benchWait(ctl, ms)` is a timeout that `abort()` can wake early (it replaced `sleep`) |
| `bench` (+ `running`, `defaults`, `estimate`, `abort`) | 1852-1916 | the in-place benchmark (below). `bench.abort` is at 1906 |
| `stressSet, stressInfo, stress` | 1925-1947 | `stress({shadowRefreshEvery: n, moveSpeed: v})`, in memory only. `shadowRefreshEvery` (capped at 3600) forces redraws (reason `stress`): with two tiles the near tile every n frames and the far tile every `max(60, 15n)` (its near half on the next frame), a single map every n. `moveSpeed` (new, blocks/s, capped at 1000) emulates a horizontally moving camera for the redraw decision only, so the real rules decide what redraws (reasons `move`). Each call sets both (an option left out is off), so `stress({})` turns everything off; turning `moveSpeed` off also zeroes the drift and both tiles' `d0`. Returns `stressInfo()` = `{mode: 'off'/'shadowRefreshEvery'/'moveSpeed'/'both', shadowRefreshEvery, moveSpeed, forced, drifted}` |
| `apply, set, applyPreset, currentPreset, reset` | 1956-2000 | the settings API (below) |
| `debug` | 2002-2022 | diagnostics: version, frame, sun, cam, shadow state, `refreshWhy`, `shadowMap` size, `shadowTiles`, `records`, `remeshes`, `errors`, `paused`, `perf`, `stress` (= `stressInfo()`), `preset`, `layers`, `layerBits`, `layerNames`, `layerClasses` (the last three are new in 1.5.1, for compat), `animated` and the classed `names` |
| `window.Twitterentary` | 2024-2028 | the global (below) |
| `notify` | 2030-2041 | `__tcOptions.toast` when BO is there, else its own `#note` toast (1.8 s) |
| toggle-key listener | 2042-2054 | `toggleKey` (compared at 2043) toggles `enabled` through `set` (saved), with the guards in §1 (they include `e.__tc`, 2046: BO's synthetic press never toggles the shaders), and stands down while the game's Controls screen is up (2050), where nothing shows that it is waiting for a key. Ignored while `bench.running`, so K can't change a scenario mid-measurement (or be undone by the bench's restore) |
| `registerToggleKey` | 2058-2075 | **new in 1.5.2.** `__tcOptions.registerKeybind` with id `tc.shaders.toggle`, so the key shows in the Keybinds tab and is in BO's `modKeySet`. It retries every 200 ms, 100 tries (20 s), then stops. Without BO the key still works and no row appears. The load message (2077) names the live key |

**`window.Twitterentary`** (2024-2028)

| Member | What it is |
|---|---|
| `cfg`, `schema`, `defaults`, `presets`, `version` | live `CFG`, `SCHEMA`, the frozen `DEFAULTS` and `PRESETS`, and `VERSION` |
| `state`, `stats`, `shadow`, `obs` | `ST`, `STATS` (with `tiles`), `G.sh` (the far tile; `shadow.near` = the near tile) and `OBS`, for diagnostics and the smoke checks |
| **`perf`** | `PERF`, mutated in place every 250 ms, never replaced: `{fps, fpsGame, ms, cpuMs, gpuMs, scale, cpuBound, shadowRefreshPerMin, timer}`. `fps` = the mean of the frame intervals; `fpsGame` = frames per window as the game's F3 counts them (`gameFps`; new in 1.5.1, updates about once a second, 0 until the first window closes; BO's overlay shows it); `ms` = the mean frame interval; `cpuMs` = the mean time inside the game's rAF callback; `gpuMs` = the mean GPU time from the timer queries (`null` without the extension); `scale` = always 1 since 1.5.1 (`tools/bench.mjs` `tailOk` and older BO read it); `timer` = the GPU timer is available. Also, for `npm run bench`: `gpuRing` (`Float32Array(256)`, per-frame GPU ms, NaN = unknown or disjoint), `gpuRingFrame` (`Int32Array(256)`, the game-frame id of each sample), `gpuFrame` (samples written; index = `gpuFrame & 255`) and `frame` (the id of the game frame most recently started, incremented at its viewport). Samples arrive late (0.25-1.5 s on the UHD 620 with D3D11). BO's overlay reads the summary fields |
| `set(key, v)` | `coerce`, write `CFG`, `persist`; it takes effect on the next frame. Returns false for an unknown key. Hidden keys (`shadowDepth`, `shadowCull`…) are accepted too |
| `apply()` | a no-op, kept for API compatibility (BO calls it after a fallback write). Uniforms are rebuilt from `CFG` every frame, and the shadow tiles compare their settings with their last snapshots, so nothing needs marking |
| `applyPreset(group, id)` | sets **every** key of the group: the preset's value, or the default for keys it doesn't list. Then persists them. |
| `currentPreset(group)` | the id of the first preset whose listed values all match `CFG` (within 1e-6), else `null` ("Custom"). Low matches whenever `shadows` is off. A stale saved `tc.shader.renderScale` is never read (the load loop reads only `CFG` keys), so a saved 70% profile reads its preset |
| `reset()` | `CFG` = `DEFAULTS`, removes **every** `tc.shader.*` key (including stale ones such as `shadowTaps`, and the `tc.shader.format` marker; `formatSaved` is cleared too), and puts `toggleKey` back to KeyK (1992) |
| **`bench(opts)`** | `bench({seconds = 6, warmup = 2, scenarios = [current, off, low, medium, high, ultra]} = {})` → Promise of `{env: {gpu, w, h, dpr, version, timer}, rows: [...]}`. Runs where the player stands. `bench.running` (bool) and a second call rejects while one runs; `bench.defaults`; `bench.estimate(opts)` = seconds it will take. An aborted run resolves with `aborted: true` added |
| **`bench.abort()`** | stops a running bench. Before it returns, it restores `CFG`, every `tc.shader.*` key byte-identically, and the stress state, and sets `running` to false. The bench promise then resolves (never rejects) within a microtask with `{env, rows /* finished rows only, maybe [] */, aborted: true}`; the window being measured is discarded. Returns true if it stopped a bench, false when idle or on a second call. A new `bench()` can start right away. BO's Escape key on its benchmark screen calls it |
| **`stress(opts)`** | the in-memory debug hook above (`shadowRefreshEvery`, `moveSpeed`); returns its state, which is also `debug().stress` |
| `debug()` | logs and returns the diagnostics object |

**Frame timing:**
1. **Frame start.** `gfx.draw` begins every frame with `viewport(0, 0, v.w, v.h)` = the canvas size. That is the game's only `viewport` call on the main context. The `viewport` wrapper takes the first such call since the last frame ended as the frame start (`frameStart`): it works out the frame's interval and the rAF callback's start from `RAF`, queues `frameEnd` with `queueMicrotask` and begins a GPU timer query.
2. **Frame end.** The microtask runs right after the game's rAF callback returns (after the HUD's 2D draw, before the frame is presented). It ends the query, polls finished ones and runs `perfFrame`.
3. **F2 against F3.** `perf.fps` is a mean of intervals over 250 ms. `perf.fpsGame` is a count over the game's window, so F2 and F3 agree within 1 FPS at a steady rate; the game's `S.fps` itself isn't reachable. They can differ for up to a second during a hitch. With shaders off the viewport hook still runs, so `fpsGame` keeps updating.

**Paged atlas (game 6b3963e444).** When the atlas needs several pages, the game's FS samples through `uTex_t(`, `cRe` in `patchTerrainFS` doesn't match and it returns null. The terrain VS is still patched, so the program gets `info.vanilla` and stays at uFx = 0: no waving, no lighting, no shadow work, logged as `terrain vertex shader only (vanilla look)`. The sky keeps its effects. SH tested this on the live game with a faked `MAX_ARRAY_TEXTURE_LAYERS` of 256: 2 pages, 6 terrain programs on `uTex_t(`, all linked, no script errors.

**`bench()`** (1852-1916): for each scenario, in place and in memory only:
1. `CFG` is reset to the snapshot taken at the start, then the scenario's values are applied (a Quality preset sets all 6 quality keys and `enabled`; `+key=value` goes through `coerce`); the motion suffix sets `stress()` through `stressSet` (`-moving` = moveSpeed 11, `-sprint` = 22, `-stress` = shadowRefreshEvery 4; no suffix = both off).
2. A wait of warm-up + 0.5 s, then `seconds` of recording into `BREC` (frame intervals, CPU and GPU ms, refreshes). Every wait is a `benchWait` that `abort()` wakes.
3. The row comes from the recording; `n/a` rows carry a note.
- `ctl.restore` restores every `CFG` value, every `tc.shader.*` key exactly (`lsRestore`), and both stress options, then re-reads `formatSaved` from localStorage (the restore may have removed the `tc.shader.format` marker). It runs once: in the `finally`, so an error can't leave settings behind, or earlier from `bench.abort()`. A second call while one runs rejects.
- **Abort** (`bench.abort()`): the loop stops at its next check, the window in progress is discarded, and the promise resolves with the finished rows and `aborted: true`.
- Measured with `npm run bench` on the UHD 620 (BENCH2, before SH4's `NEAR_SPARE` and `keep`): High-moving about 216 shadow redraws/min, High-sprint 457, Medium-moving 120, High-stress 1555. After SH4 (LAB2), High-moving and Ultra-moving are about 120/min.
- BO's in-game benchmark runs it behind its `tcbench` screen; `npm run bench` (tools/bench.mjs) runs scenarios in fresh browser contexts instead.

**Shadow refresh** (`finalizeShadow` 1075, `renderShadow` 1476):
- **When shadows are on:** `enabled && shadows && shadowOk`, the size hasn't failed to allocate, the overworld (`dim 0`), sun y > 0.06 and day > 0.1.
- **When they're off:** both tiles are invalidated. If `enabled` or `shadows` is off (Quality Low, or K), the atlas is also shrunk back to 1×1, once. At night and in the Nether/End it keeps its size, so it isn't reallocated every dusk.
- **Two tiles** (cascades, automatic): when `shadowExtent ≥ 64` (High and Ultra; Medium's 56 is a single map, as in 1.4.0), `shadowExtent ≥ 1.5 × (24 + max(shadowMove, 8))`, and the near tile gets at least 512 px, the atlas holds a near tile (radius `24 + max(shadowMove, NEAR_SPARE 8)` = 32 on High and Ultra, `min(shadowSize, 2048)` px) at x = 0 and the far tile (`shadowExtent`, `shadowSize` px) beside it. Otherwise the far tile is the whole atlas. The terrain FS uses the near tile within `24 × 1.25` blocks and the far tile beyond it.
- **When the first terrain draw is translucent** (`canDraw` false): no refresh starts. The old tiles are kept, or shadows are off for that frame if the far tile isn't valid.
- **One tile redraw per `shadowEvery` frames at most** (`G.lastRef`); only the first map, the near half of a far redraw and `stress()` skip the wait. Reasons (`ST.why`, counted in `STATS.why` once drawn), checked in this order:
  1. far `init`: the far tile isn't valid (any frame);
  2. far `stress`: forced, every n frames, or every `max(60, 15n)` with two tiles;
  3. once due: a layout change (size, extent, depth, culling, near size or radius) → far `dirty`;
  4. near tile: `init`, `dirty` (a caster in it changed), `move` (more than its spare margin `max(shadowMove, 8)`; it was `shadowMove` before SH4);
  5. far tile: `dirty` (a caster in it changed), `move` (more than `max(shadowMove, (extent − near radius) / 2)` with two tiles, e.g. 20 blocks on High, else `shadowMove`), `sun` (about 0.25°, `COS_SUN`), `age` (10 s);
  6. near `stress`: every n frames.
- **`stress({moveSpeed})`** adds its emulated drift to both `move` tests (`camDist`), so a bench row like `high-moving` gets the near and far redraws a player flying at that speed would cause, under the same `shadowEvery` limit; they count as `move`, not `stress`.
- **Shared light basis:** the near tile is always drawn in the far tile's light direction, so the FS needs one matrix product (`uShadowN` maps far to near coordinates). `nearOn` (1146) also requires the near tile's `L` to equal the far tile's exactly.
  - **Since SH4 a far redraw keeps the light basis** (`keep`) when it is for chunk changes (`dirty`, not a layout change), a move or age, the near tile is valid and the sun has turned less than `COS_SUN`: the far tile is redrawn in its old `L`, so the near tile stays valid and no frame goes without it. After a kept `dirty` or `move` redraw no near redraw follows; after a kept `age` redraw the near tile is redrawn on the next frame in the same basis (`G.nearNext = 5`, 1139), so the 10 s safety net covers it too, and it stays on meanwhile.
  - Otherwise (`init`, `sun`, a layout change, `stress`) the near tile is invalid after the far redraw and is redrawn on the next frame ("the near half"), so no frame pays for both tiles; the near tile is off (far tile only) for that one frame, by design.
  - LAB2 at a fixed scale 0.9 with `-moving`: redraws went from 216 to 120/min on High and from 367 to 120/min on Ultra (`NEAR_SPARE` plus `keep`), with high-moving 13.0 / 16.43 → 11.9 / 15.41 ms (median / p95gb).
- **What marks a tile dirty:** a remesh of a recorded part inside it (`bufferData`, exact since 1.5.0), a new record inside it, `trackColumn` dropping an emptied part, `deleteVertexArray` on a recorded VAO, and a class re-upload. Settings changes don't (`apply()` is a no-op), so dragging a Look slider causes no shadow redraws.
- **The pass itself** (`renderShadow`):
  - It reads only 4 `isEnabled` (cull, depth, polygon offset, scissor). The framebuffer to restore is always null and the viewport comes from the `viewport` hook (`VP`), so there's no `getParameter` round trip (fixes issue 3; one `getParameter(VIEWPORT)` happens only if no viewport was seen yet).
  - It resizes the atlas if the layout changed (a failed resize sets `G.allocFailed`, which disables shadows at that size), binds the shadow FBO, enables scissor and depth, `depthFunc(LEQUAL)`, `depthMask(true)`, `polygonOffset(2, 1)`, then `drawTile` for each tile due.
  - It restores the program, VAO, framebuffer, viewport and capabilities, then `depthFunc(LEQUAL)` and `depthMask(true)` without querying them. That's what gfx.js has set at the first terrain draw (game:gfx.js:1273-1276; `depthMask` from compat).
  - If it throws, `terrainDraw` catches it: shadows are off for that frame, the tiles are invalidated, and the next frame starts over.

**Terrain FS** (`shadeCode` 420):
1. **Vanilla path:** returns the vanilla colour when `uFx < 0.5` (431). The derivatives are skipped then too.
2. **Fog early-out:** when `f > 0.999`, it outputs the fog plus the sun scatter and skips everything else (435). The scatter is only applied in open-air fog (`uFogR.y > 20`), not underwater or in lava.
3. **Normals and classes:** the normal is `cross(dFdx(vRel), dFdy(vRel))`, normalised; the leaf, plant, water and emissive classes come from `vCls` (unpacked from `vTcP.w` and rounded); leaves and plants bend their shading normal upward.
4. **Sun and shadows first** (456), while few values are live (LAB: about 1.2 ms cheaper than looking up after the ambient terms). `tcShadow` is sampled only where the sun can reach (`uShadowOn`, `ndl > 0`, `uSunK × sky mask > 0`), and as a single cheap tap beyond 32 blocks and on leaves, plants and water.
5. **Ambient:** AO is separated from the engine's face shading. The hemispheric ambient is `mix(uAmb0, uAmb1, hemi)`, with both endpoints computed on the CPU (day, twilight, night, Nether/End, ambient strength), then scaled by sky light.
6. **Block light:** `tcBl²(0.8+0.2·tcBl)` with a warm tint, plus (lit programs only) the engine's own term `tcBlkE` (477): `max(lightmap(vec2(0.0, vLight.y)) − uTcLm0, 0) × 0.35`, using the game's `lightmap()` already in the FS, evaluated only where `vLight.y > 0`. All × `blockLight`. (Since SH4; before, the VS computed a copy of the curve per vertex into `vTcBlk`.)
7. **Sun light:** `uSunC × ndl × visibility × sky mask`, plus leaf backscatter.
8. **Emissive**, then `WATER_CODE` (mode 2 only).
9. **Grading:** exposure, then `tcTone` (a cubic roll-off above 0.7: 70% hue-preserving, 30% per channel). Saturation (vibrance-style above 1) and contrast run only when `uGrade` says one isn't neutral.
10. **Fog:** fog with the sun scatter.

`tcShadow` (`shadowGlsl` 277-325):
- **One projection:** both tiles share the far tile's light basis, so `uLVP` gives the far coordinates and the near tile's are `xy × uShadowN.x + uShadowN.yz`, `z + uShadowN.w`.
- **Tile choice:** within `uShadowB.w` blocks of the camera (30, or 0 = far tile only) it uses the near tile when the point is inside it; otherwise the far tile, faded out at its edge.
- **Offsets:** a normal offset of `texel × 1.6 + 0.015` (the near or far tile's texel in blocks, `uShadowB.x/y`), and a slope bias divided by the depth range `uShadowB.z`.
- **Every tap is `textureLod(…, 0.0)`**, which ANGLE turns into `SampleCmp` on D3D11, so the taps in untaken branches can be skipped.
- **Taps by `uShadowQ`:** 1 tap (Hard, or `cheap`), a 4-tap 3×3 tent (Soft), or a 9-tap 5×5 tent (Softer). The 9-tap tent is unrolled by hand, so D3D doesn't build an indexable temp array.

`WATER_CODE` (384-418), unchanged in substance since 1.4.0:
- **Waves:** wave octaves faded by the pixel footprint (`tcDx/tcDy`): 2 octaves far away, 4 up close.
- **Fresnel:** Schlick.
- **Reflection:** the sky shader's own gradient plus the horizon term, darkened where there's no sky light.
- **Body colour:** teal, lit like terrain, keeping 30% of the texture's luminance.
- **Absorption:** by view path.
- **Blend:** `A = 1-(1-F)(1-abs)`, `C = (F·R + (1-F)·abs·W)/A`.
- **Glints:** a sun glint that respects `tcVis` (the shadow), sharper up close, and a moon glint.

**Sky FS** (`skyCode` 530-561):
- a light saturation boost, zenith darkening and a horizon brightening;
- the sun glow `uSkyGlow` × nested lobes, evaluated only inside their cones: ×5 above `dot` 0.4, ×40 above 0.9, ×700 above 0.99. The glow's colour and visibility come from the sun height, on the CPU;
- a moon glow when `uSkyDay < 0.999 && dot < -0.95`;
- IGN dither.

**Game hook points:**
- **WebGL2 prototype methods:** the wrappers above, plus `window.requestAnimationFrame`.
- **GLSL anchors:** the regexes in `patchTerrainVS` (233), `patchTerrainFS` (`outRe`, `cRe`, `main`; 511) and `patchSky` (563), plus the source checks in `patchSource` (585-597). The lit FS calls the game's own `lightmap()` (game:gfx.js:275-285); only its value at l = 0 is mirrored on the CPU (`tcLm0`), and compat's `LIGHTMAP` anchor covers the whole curve. The patched terrain GLSL must never contain `flat ` (smoke `max: 0`, see `patchTerrainVS`); the game's own `vGlass` is stripped (`FLAT_GLASS`) and the `aPos.z >> 9u` decode is detected (`layerBits`), both compat-checked.
- **Observed uniforms:** names are tagged by wrapping `getUniformLocation`: `uOrigin`, `uCam` (only in programs that also have `uSize`, the cloud/water plane VS), `uTop`, `uC`, `uAmbient`, `uSkyLight` (the dimension, and `tcLm0`). SH also uses the game's `uFogR` (game:gfx.js:300).
- **Atlas:** caught by `texImage3D(0x8C1A TEXTURE_2D_ARRAY, level 0, 16, 16, n, …, pixels=arg 9)`, once per page, `data.subarray(...)` being the pixels (game:gfx.js:944). Animated layers come from `texSubImage3D` (game:gfx.js:1135-1136) and are ignored once the names are known.
- **Block names:** from `Array.prototype.indexOf('oak_planks')` on `eng.texNames` (game:main.js:356).
- **Frame tick:** `clear(mask & COLOR_BUFFER_BIT)` on `mainGL` only, so the dragon view's own context (game:dragonview.js:54, 176-177) doesn't count.
- **Frame start and size:** the first full-canvas `viewport` of a frame on `mainGL` (game:gfx.js:1221, the only one), with `v.w/v.h` = `glCanvas.width/height` (game:main.js:896-897). `frameEnd` runs as a microtask after the rAF callback, which also contains the survival crack, hands and fire overlay (game:main.js:999-1004). compat checks all three.
- **Chunk uploads:** `gfx.setChunk` binds each part's VBO under its VAO and re-specifies it with `bufferData` on every remesh (game:gfx.js:1022-1052).
- **GL state assumed at the first terrain draw:** `depthFunc(LEQUAL)`, `CULL_FACE` on and `BLEND` off (game:gfx.js:1273-1276), and the atlas on unit 0 with `TEXTURE0` active (game:gfx.js:1292-1293). compat checks both.
- **Context:** no game framebuffers or scissor anywhere on the main context (compat-checked), which is what lets the scissored shadow tiles work.
- **DOM:** `#note` (fallback). **Events:** window `keydown` in the capture phase.

**Globals:** `window.Twitterentary` (above); `window.requestAnimationFrame` is wrapped. **Storage:** `tc.shader.<key>`, read at startup and written by `set`, `applyPreset` and `reset`; `bench()` restores it exactly. `tc.shader.format` (`'1.5'`, new): the 1.4.0 → 1.5 migration marker, written by the migration and with the first non-default value `persist` saves; removed by `reset()`.

**Data flow:**
1. **Patch:** game `shaderSource(src)` → `FLAT_GLASS` strip → `patchSource` → `{orig, info, patched}` stored in `shaderSrc`.
2. **Compile:** `compileShader`. If the patched shader fails, it recompiles the original.
3. **Attach:** `attachShader` records the shader.
4. **Link:** `linkProgram`. If any attached shader is patched and the link succeeds, `progInfo.set(p, {prog, loc:null, mode, lit, terrainVS?, terrainFS?, sky?, cloud?, terrain, vanilla})`, unless only the strip touched it. Otherwise it reverts every shader and relinks.
5. **Uniform enumeration:** the game enumerates uniforms (game:gfx.js:847-851), and the `getUniformLocation` wrapper tags `locKind`.
6. **useProgram:** game `useProgram(p)` → wrapper: `initGL` once; `curInfo`; `applyUniforms`: lazy `resolveLocs` first, then `updateState` once per frame, then cached uploads.
7. **Frame start:** game `viewport(0,0,w,h)` → `frameStart`: timer, `frameEnd` queued.
8. **Origin:** game `uniform3f(uOrigin)` updates `lastOrigin`.
9. **Draw:** game `drawElements` → wrapper → `terrainDraw`.
   - On the frame's first terrain draw: the camera fix-up, `finalizeShadow`, `renderShadow` if a tile is due and this is an opaque or cutout draw, then `pushCam`.
   - Then it records `rec[curVAO] = {vao, n, ox/oy/oz, wx/wy/wz, cut, seen, frame, col}` for mode < 2 and calls the original `drawElements`.
10. **Remesh:** game `bindBuffer` + `bufferData` on a recorded part's VBO → `remeshed`: new count, tiles dirtied.
11. **Frame end:** the microtask → timer poll, `perfFrame`.
12. **Terrain VS without our FS:** the stained-glass depth prepass (game:gfx.js:1331-1354), whose FS (game:gfx.js:287-294) is `o = vec4(0.0)`, and on a paged atlas every terrain program. They get `info.vanilla`, so `offProgram` keeps uFx at 0. A program with only other parts patched counts as "partial": uniforms are applied, but there's no `terrainDraw`.

**Texture units:**
- **Unit 6** = `G.depthTex`, the shadow atlas (`sampler2DShadow uShadowMap`), near tile and far tile side by side. It's 1×1 until the first refresh.
- **Unit 7** = `G.clsTex` (the class lookup, sampled by the terrain VS and the cutout shadow VS).
- **Binding:** both are bound once and never unbound; `resizeShadow` rebinds unit 6, restoring the active unit. We hold 6 and 7 only: the game uses units 0-5, and its atlas pages begin at unit 8 (`PAGE_UNIT`, compat-checked). If 1.6 needs a unit, it must avoid 8 and up on a paged atlas.
- **Atlas assumption:** the cutout shadow FS samples the atlas through `uTex = 0`, so it assumes the atlas is bound on unit 0 at the first terrain draw. It is: game:gfx.js:1292-1293, compat-checked.

**Observations (OBS):**
- **Sky and sun:** `uniform3fv(uTop)` sets `OBS.top`, `topFrame = frameId` and `sunSeen = false`. The next `uC` upload (`uniform3f`/`3fv`, kind 4) in the same frame becomes `OBS.sun`, normalized.
  - This relies on the sun sprite being the first `uC` after the sky: game:gfx.js:1388→1430 (`drawSky`), and 1402→1418-1429 via `sprite()` (`drawSkyLit`).
  - `uC` is also set by pChat (game:gfx.js:1650) and by signs (game:signs.js:326).
- **Dimension:** `uniform1f(uAmbient)` sets `OBS.amb`, and `uniform3fv(uSkyLight)` sets `OBS.sl`. `dim` is checked only when `OBS.lit`:
  - 1 when `amb > 0.05` (the Nether, where the game uses 0.1);
  - 2 when `isEnd(sl)` (the End).
  - compat checks both values.
- **Camera:** from the cloud plane's `uCam` (`setCam`), corrected per frame by `e.ox - lastOrigin` on a VAO drawn in the previous frame.

**CFG ↔ SCHEMA ↔ uniform ↔ GLSL**

| CFG key (default) | SCHEMA label / range (group) | Path | GLSL use |
|---|---|---|---|
| enabled (true) | Shaders, bool (top row) | `uFx`; gates `ST.shadowOn`; K toggle | VS class fetch, waving; FS vanilla return and derivatives; sky; cloud (dead) |
| shadows (true) | Sun shadows, bool (quality) | `ST.shadowOn` → `uShadowOn` | FS shadow gate |
| shadowSize (2048) | Shadow resolution 1024-4096, step 1024 (quality) | `shadowTargetSize` → far tile size; near tile = `min(size, 2048)`; atlas `(near + far) × far` | `uShadowP` |
| shadowExtent (56) | Shadow range 16-96, step 8 (quality) | far tile `E` (`lightMat`, `inFootprint`); 64 or more (and ≥ 1.5 × (24 + max(`shadowMove`, 8))) adds the near tile | `uLVP`, `uShadowB.y` |
| shadowDepth (256) | none; 64-1024 | tiles' `Z` | `uShadowB.z` (bias), `uShadowN.w` |
| shadowFilter (1) | Shadow edges: Hard / Soft / Softer, choice (quality) | `uShadowQ` | 1, 4 or 9 taps |
| shadowEvery (8) / shadowMove (6) | Shadow update limit (frames) 1-30 / Shadow update distance 1-16 (quality) | `finalizeShadow`: one tile redraw per `shadowEvery` frames; near radius and near move threshold use `max(shadowMove, 8)`, the far move threshold `shadowMove` | — |
| shadowCascades (true) | none; hidden, new | `finalizeShadow` (`useNear`): false = far tile only | — |
| shadowTaps (8) | none; unused since 1.4.0 | — | — |
| shadowCull (true) | none; debug | tiles' `cull` → `drawTile` | — |
| waving (true) | Waving leaves & plants, bool | `uWaveOn` | VS waving |
| leafSway (0.028) / plantSway (0.075) | 0-0.15 / 0-0.3 | `uLeafSway` / `uPlantSway` | VS waving |
| waterEffects (true) | Water effects, bool | `uWaterOn` | `WATER_CODE` gate (translucent FS only) |
| waveStrength (1.0) | 0-2 | `uWaveStr` | water normals |
| skyEffects (true) | Sky effects, bool | `uSkyOn` | sky gate |
| cloudEffects (true) | none | `patchCloud` gate | cloud patch (dead) |
| sunStrength (0.75) | Sun light 0-2 (look) | `uSunC` (CPU: sun colour × strength × `uSunK`) | FS sun light, leaf backscatter |
| ambientStrength (1.0) | Ambient light 0-2 (look) | `uAmb0`/`uAmb1` (CPU, `ambientEnds`) | FS ambient |
| blockLight (0.9) | Block light 0-2 (look) | `uBlockStr` | FS block light |
| aoPower (1.3) | Contact shadows (AO) 0.5-3 (look) | `uAoPow` | FS AO |
| emissive (1.0) | Emissive glow 0-2 (look) | `uEmissive` | FS emissive |
| exposure / saturation / contrast (1.0 / 1.0 / 1.0) | 0.4-2 / 0-1.5 / 0.5-1.8 (look) | `uExposure / uSaturation / uContrast`, plus `uGrade` = saturation or contrast not neutral | FS grading |

**Uniforms derived from state rather than CFG:**
- `uTime` (`ST.time`): VS waving, water waves. `uCam`: VS waving, water.
- `uSunDir` (= `sunL`, y ≥ 0.14), `uSunCol`, `uSkySun` (the raw sun), `uZenith` (= `OBS.top`), `uDay`, `uSkyDay`, `uDim`.
- New: `uSunK`, `uSunC`, `uAmb0/uAmb1`, `uGrade`, `uTcLm0` (lit FS; SH4, replacing the VS-only `uTcSkyL`/`uTcAmbL`) and `uSkyGlow` (sky), all from `updateState`.
- Shadows: `uLVP` (the far tile's light matrix), `uShadowP` = (near tile size, far tile size, 1 / atlas width, 1 / atlas height), `uShadowB` = (near texel, far texel in blocks, depth range, near radius or 0), `uShadowN` = the far → near scale and offset.
- Samplers: `uShadowMap` = 6, `uClsTex` = 7. `uCloudTint` is dead.
- The game's own: the lit FS uses `uAmbient` for its ambient floor (game:gfx.js:277) and `lightmap()` for the engine block-light term, and every patched terrain FS uses `uFogR`.

**Presets** (87-100). Quality sets `shadows, shadowSize, shadowExtent, shadowFilter, shadowEvery, shadowMove`:

| Quality | shadows | Size | Extent | Filter | Every | Move |
|---|---|---|---|---|---|---|
| Low | off | (default) | (default) | (default) | (default) | (default) |
| **Medium** | on | 2048 | 56 | Soft | 8 | 6 |
| High | on | 2048 (1.4.0: 4096) | 72 | Soft | 4 | 4 |
| Ultra | on | 2048 (1.4.0: 4096) | 96 | Softer | 2 | 2 |

High and Ultra use two tiles: a 2048 far tile next to a 2048 near tile (a 4096×2048 atlas), so near shadows are sharper than 1.4.0's single 4096 map at a lower cost. Their descriptions read "Sharp near shadows, …-block range, …". Medium stays a single 2048 map ("2048 shadows, 56-block range, soft edges.").

**1.4.0 profiles:** a saved 1.4.0 High or Ultra (shadowSize 4096 and nothing else changed in the Quality group) is migrated once at load: its saved `shadowSize` is dropped, so it reads as High/Ultra at 2048 with the near tile (`LEGACY_140`, 138-158). Any other saved combination stays as Custom.

Look sets `sunStrength, ambientStrength, blockLight, aoPower, emissive, exposure, saturation, contrast` (unchanged in 1.5.0):

| Look | Sun | Ambient | Block | AO | Emissive | Exposure | Saturation | Contrast |
|---|---|---|---|---|---|---|---|---|
| **Natural** | 0.75 | 1.0 | 0.9 | 1.3 | 1.0 | 1.0 | 1.0 | 1.0 |
| Vivid (the 1.3.0 look) | 0.9 | 1.0 | 1.0 | 1.5 | 1.15 | 1.0 | 1.12 | 1.05 |
| Soft | 0.65 | 1.1 | 0.85 | 1.0 | 0.9 | 1.05 | 0.92 | 0.95 |

`waving`, the sways, `waterEffects`, `waveStrength` and `skyEffects` belong to neither group.

**Hot paths:**
- **`requestAnimationFrame` wrapper:** a `WeakMap.get` per call, then three field writes per callback.
- **`viewport` wrapper:** two compares per call; the frame start adds `queueMicrotask` and one timer query.
- **`uniform3f/3fv/1f` wrappers:** a `WeakMap.get` on every uniform call in the game (one `uOrigin` per chunk per pass).
- **`bindBuffer`/`bufferData` wrappers:** a compare per call; a remesh of a recorded part adds a `WeakMap.get` and a `Map.get`.
- **`drawElements` wrapper:** runs on every draw call. `terrainDraw` adds per terrain draw a `Map.get`, field writes and `trackColumn`, which does a `Map.get` only when the record's column changed.
- **`useProgram`:** a `WeakMap.get`. For patched programs, a compare of the cached values, plus GL calls for the values that changed.
- **`clear`, `texSubImage3D`:** a compare each.
- **Frame end (microtask):** `getQueryParameter` on up to 32 finished queries and `perfFrame`. Every 250 ms `perfFrame` also reads `getParameter(GPU_DISJOINT_EXT)`.
- **`Array.prototype.indexOf`:** wrapped only until the names are captured.
- **`renderShadow`:** only on a refresh, at most one tile per frame. It makes 4 `isEnabled` calls, iterates `rec` twice per tile (opaque, then cutout), and makes one draw per record in the tile, with back faces culled.
- **GPU per terrain fragment:**
  - Within 32 blocks where the sun reaches: 1, 4 or 9 compare taps (Hard, Soft, Softer). Beyond that, and on foliage and water: 1 tap.
  - Fully fogged fragments skip lighting, shadows and water; with effects off (K) the derivatives are skipped too.
  - The engine's block-light term is one `lightmap()` call in the lit FS, only where `vLight.y > 0`; the day/ambient/sun mixes run once per frame on the CPU.
- **Varyings:** the patch adds one smooth `vec4` (`vTcP`) and no `flat` varying. The 1.5.0 betas' `flat out float vCls`, which every terrain pixel read, cost about 2.3-3 GPU ms per frame at rd 12 on the UHD 620 (most likely ANGLE D3D11's provoking-vertex geometry shader; LAB2: `off` 7.52 → 5.18 GPU ms against vanilla 4.57). That figure doesn't generalise: the game's own `vGlass` (6b3963e444), read only by the translucent pass and stained depth, measured far less, and the reason is unverified. On the title screen vanilla read 5.15 ms median against `off` 5.00, inside the noise floor (`reports/bench-flat-strip-screen.json`). SH strips it because the smoke guard requires it; it's harmless, with no measured benefit on the title screen, and water-heavy worlds are unmeasured.
- **Shadow redraws:** at most one tile per `shadowEvery` frames, and the far tile's leaves are drawn as solid quads.
- **Sky:** a full-screen pass; its glow lobes are only evaluated inside their cones.

**Settings:** every key applies on the next frame. Uniforms are rebuilt from `CFG` every frame, and `finalizeShadow` compares the shadow settings (through `cfgNum`) with each tile's last snapshot. There are no reload flags left.
- **`shadows` and `shadowSize`:** turning `shadows` on, or changing `shadowSize`, resizes the atlas at the next refresh. Turning shaders or shadows off shrinks it to 1×1.
- **Shadow range and depth:** `shadowExtent` and `shadowDepth` take effect with the next refresh, which a change triggers. `shadowExtent` and `shadowMove` also decide whether the near tile is used.
- **K toggle:** live, and saved.

## 3. tweetcraft-better-options.js (BO, 1788 lines)

**Purpose:** takes over the game's "Options…" button, on the pause menu and, since game build c25d4c024d, on the title (matched in the player's language), and opens a tabbed menu instead: Graphics, Shaders, registered mod tabs, Keybinds, About. Hosts the settings bus. Adds UI/HUD scale, mouse sensitivity, FOV (down to 2), render distance, the shaders' Quality and Look pickers, "Reset shaders" and "Reset all options". It has a **performance overlay** (F2, rebindable) that shows `Twitterentary.perf`, **Copy all settings** on the About tab (new in 1.3.0), and an **in-game benchmark** on the Shaders tab that runs `Twitterentary.bench()` where the player stands (Escape, leaving fullscreen or a window resize stops it). "Game options…" opens the game's own Options screen (FOV, music, held light, country, chat translation, language). Every setting is a game-style full-width button or slider with its caption drawn on it. Since 1.4.0 game keys belong to the game's Controls screen, and the Keybinds tab covers mod keys; where the game has no `js/keys.js` (staging today) it keeps the old game-key rows and remap. **Metadata:** `@version 1.4.0`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.twitterentary`; `@description` now ends "…, plus a performance overlay and an in-game benchmark." The in-code version `VERSION` (20) reads `GM_info.script.version` (`'0.0.0'` without `GM_info`), so there's nothing to keep in sync.

| Name | Line | Purpose |
|---|---|---|
| `TAG, MENU_NAME='tcoptions', STORE_KEY, SHADER_PREFIX, RDS, VERSION, DEFAULTS` | 15-29 | constants. Defaults: `ui.scale 1, hud.on true, input.sens 1, keys.map {}, keys.mute [], perf.overlay false` |
| `cfg, save, clone` | 31-34 | `tc.options` load and save |
| `sections, keybinds, subs, bus, emit` | 36-65 | the bus (see §1). `emit` swallows errors |
| `store, isTyping, $, toast` | 67-87 | localStorage wrapper, helpers, `#note` toast. `toast(text, ms)` takes an optional duration (default 2 s) since 1.2.0 |
| `domReady, menus, _injectMenus` | 89-106 | lazy, memoized `import('/js/menus.js')` after DOMContentLoaded, started at load (105) |
| `_keys, keysMod` | 110-111 | **new in 1.4.0.** Cached `import('/js/keys.js')` after DOMContentLoaded, checked for `codeOf`, `action`, `bound`, `set` and `BINDS`. Null means this build has no rebinding |
| `i18n, makeLabels, LBL, relabel` | 127-158 | lazy `import('/js/i18n.js')` after DOMContentLoaded (a failed import warns and keeps English). `LBL = {options, full, dist}`: the English labels always, plus `t('pause.options')`, `t('pause.full')`, `t('pause.exitFull')` and `t('pause.distance', {n})` for each of `RDS` (`dist` maps label → n). A `t()` that throws or returns the key is ignored |
| `applyLabelCss, initLabels, bus._labels` | 161-186 | `<style id="tc-options-i18n">`: hides the pause menu's Distance and Fullscreen buttons by their translated labels (`CSS.escape`d); rebuilt on `onLocaleChange` (183). `_labels()` is a test seam |
| `ourMenuOpen` | 188 | `#screen .inner .tc-marker` exists |
| `fovCache, getFov, zoomRealFov, syncFov, realFov` | 190-206 | cache of `mc.fov` (30-110 at load, else 70). `zoomRealFov` = `__tcZoom.realFov` while `zooming`, else null. `syncFov` re-reads whenever the Graphics tab is built, so a change made on the game's Options screen shows up: `zoomRealFov`, else `mc.fov` if it is 30-110, like the game's load check. `realFov` = the player's own FOV, never a zoomed one (Copy all settings) |
| `fovInput, pauseUp, fovSpot, grabFovInput, stealFovInput` | 215-265 | `fovInput`: undefined = not fetched yet, null = the game has no such input. `fovSpot` = the screen we can put back after opening the game's Options: `'ours'`, `'pause'`, `'idle'` (no screen, inventory, chat or editor), or `''` for anything only the game can rebuild, which leaves everything alone. `grabFovInput` opens the game's Options, keeps `input[type=range][data-k="fov"]`, sets `min=2, step=any`, then restores that screen, all in one synchronous task, so nothing paints. `document.exitPointerLock` is shadowed for that task: `showScreen`'s `releaseInput` would otherwise drop the lock and `onLockChange` would open the pause menu (inferred from the code). Held keys still drop once. A thrown `openOptions` retries, and gives up after 3 |
| `pauseUp` | 219-225 | **changed in 1.3.1.** True only with `on` **and `dim`** on `#screen` plus the Options label button. The title has that button too, but its class is `on title`, so it no longer reads as the pause menu |
| `noWorld` | 322 | **new in 1.3.1.** True off a world page: the game's full `ROOM` regex against `location.pathname`. Private |
| `primeNow, watchForPause, primeFov` | 270-295 | new in 1.3.0. Fills the cache only where nobody can notice: the pause menu, or world idle (`__ready`, no screen, no pointer lock, tab visible, nothing being typed, `#cross` without `.off`, not touch: touch play never takes pointer lock, so "no lock" says nothing there). Never the title: joining a world reloads the page, and the title can't be rebuilt exactly (random splash). The first `prime()` arms a MutationObserver, so pause primes the moment it opens |
| `clampFov, writeFov, setFovNow, setFov, bus.fov` | 298-317 | clamp to 2-110. `setFovNow` writes through the cached input and returns true, or false with no input; the game's handler saves `mc.fov`. `setFov` also writes `mc.fov` first, then steals the input if needed. Over a screen we can't restore it stores `mc.fov` and opens nothing |
| `currentRd, distanceButton, setRenderDistance, bus._setRenderDistance` | 324-353 | `openPause()`, then clicks the button whose `aria-label` is in `LBL.dist` until it shows the target (≤ 12 clicks), writes `mc.rd`, and reopens ours. On the title screen `openPause` returns early (game:menus.js:1921-1923), so only `mc.rd` is written. `_setRenderDistance` is a test seam |
| `toggleFullscreen` | 355-361 | `requestFullscreen`/`exitFullscreen`, toast on refusal |
| `hudKey, HUD_KEY_TOAST, sendF1(onlyIfHidden), bus._sendF1, toggleHud` | 365-413 | `hudKey` (**new in 1.4.0**, 365) is `codeOf('hideHud')`, or null when a synthetic press can't do it safely: bound to a mouse button, resolved by `K.action` to another action, or held by **any** other bind in any scope (371). Our press must never run another action: a `place`-scope bind such as `bpPaste` would make the game send a network message (game:blueprint-ui.js:208). `F1` without keys.js. `sendF1` is `closeMenu()`, a synthetic keydown and keyup of that key (both `__tc`, 394-399), then reopens ours, and resolves true only if a press was sent; a null key shows `HUD_KEY_TOAST`. With `onlyIfHidden` it presses only if `#hudtop.hidden`, the game's real HUD state once `closeMenu` has run `updateTop` (game:main.js:2372-2378), and does nothing when `#hudtop` is missing |
| `toggleHud` | 409-413 | **changed in 1.3.1.** With no world it shows a toast and calls `refresh()`, saving nothing and sending no key. **Changed in 1.4.0:** it flips `hud.on` only after a press was sent, then always refreshes, so the row shows what really happened |
| `uiTimer, TOUCH_PARAM, isTouch, defaultRd, uiMult, uiBase` | 415-428 | `isTouch` = `(pointer: coarse)` or the `?touch` URL param, like the game (game:main.js:124). `defaultRd` = 6 on touch, else 8. `uiBase` copies the game's `--u/--d` formula (game:main.js:527-536) |
| `applyUiScale, reassertUiScale` | 429-445 | set `--u, --d, --tc-s`; the reassert runs on a 250 ms interval |
| `noteFont, hudScale, patchHudScale` | 447-474 | wraps `Hud.prototype.draw` (`o.gs`, 456-464), `suggestions` (arg 0), `tab` (arg 1) and `hint` (arg 1) (`wrapScale`, 466-471), marked `__tcScaled`; captures the bitmap font |
| `patchSurvivalScale` | 476-493 | wraps `SurvivalClient.prototype.drawHud(hud, font, gs)` |
| `redrawButtonLabels, rescaleLabels, startLabelObserver` | 495-543 | redraws the canvas labels of `button.mcb` (not `.hb`) at the scaled px; MutationObserver on the `#screen` subtree |
| test seams | 545-549 | `_injectUi, _patchHud, _patchSurvival, _injectSurvival, _rescaleLabels` |
| `h, T, row, note, small, header, subhead, sep` | 551-569 | DOM builders. `small` = `p.desc.small`; `subhead` = a `.tc-sub` section heading |
| `btn(label, fn, {cls})` | 571-576 | `button.mcb` with `aria-label`; the click handler catches errors. `b.__setLabel(text)` relabels it in place |
| `toggle(label, v, fn)` | 578-582 | full-width `.mcb.tc-full.tc-tg` reading "Label: ON" / "Label: OFF" |
| `cycle(label, [[v, l]…], value, fn)` | 584-596 | full-width `.mcb.tc-full.tc-cycle` reading "Label: l"; a click steps to the next option and calls `fn(v)`. A value not in the list shows raw, and the first click picks option 0 |
| `stepDecimals, slider` | 597-621 | `div.tc-slider` = `input.tc-range` + `div.tc-cap`: the caption "Label: value" sits on the 200u × 20u track (the game's `.fov-control` look, game style.css:225-290). Values are shown and passed to `oninput`/`onchange` rounded to the step's decimals |
| `item(label, control)` | 624-628 | returns a `.tc-full` or `.tc-slider` control alone; anything else gets a two-column `.tc-item` with an ellipsised left caption (keybind rows, Fullscreen) |
| `ensureCSS` | 631-691 | one `<style>` (see §1). New in 1.2.0: the `.tc-bench` results grid (670-674, columns in `em` so they follow `--tc-f`), the bench screen (675-677) and `#tc-perf` (678-683) |
| `ARMED_LABEL, armed, isArmed, relabelArmed, arm, disarm, armButton` | 693-712 | two-click confirmations (3 s). The state is kept outside `build`, so a rebuild keeps it. `armButton(id, label, fn)` tags its button `data-tc-arm`, and `arm`/the timeout relabel it in place ("Click again to reset"), never through `refresh()`, so a slider drag on another row isn't cut off |
| `fovRow, rdRows, fullscreenRow, scaleRow, hudRow, perfRow` | 714-736 | Graphics rows. FOV slider 30-110. Render distance slider 4-12, step 2, applied on `change`. Fullscreen is an `item` with an Enter/Exit button. HUD is a toggle. **`perfRow`** (734, new) is the toggle "Performance overlay: ON/OFF" (`perf.overlay`) |
| `rdRows` | 718-722 | **renamed from `rdRow` in 1.3.1.** Returns an array, spread by `graphicsSection`, and adds the note "Applies when you join a world." when `noWorld()` is true, because with no world the slider only saves `mc.rd` |
| `openGameOptions, openGameControls, graphicsSection` | 737-759 | `openGameControls` (**new in 1.4.0**, 745) imports `/js/controls.js` and calls `openControls()`, falling back to `openGameOptions`. Its Done goes back to the game's Options. | "Game options…" calls `M.openOptions()`: the game's screen, whose Done (game:menus.js:1877) calls `back()`, which goes to the pause menu, or to the title screen before the world starts (game:menus.js:249-266). The Performance overlay row follows the HUD row |
| `KEYNAMES, keyName, capturing, setCapturing` | 761-764 | key-capture state. Mirrors `bus.capturing` |
| `screenIsOn, invClosed, remapActive, modKeySet` | 766-773 | remap gating (legacy path); `modKeySet` = the codes of registered mod keybinds (now including the overlay key) |
| `onKeyCapture, onKeyCaptureImpl` + listeners | 774-810 | capture mode swallows the key (a legacy game row can't take a mod's key, 786). Then it returns if `nativeKeys` is set (791). Legacy path only: `keys.map` remap re-dispatch (`__tc`, 802) and `keys.mute` block (807). Listeners at 809-810 |
| `currentKeyFor, bindEntry` | 812-834 | legacy game rows are stored as `map[newKey]=def` with `def` muted; mod binds call `entry.set`, then toast `keyClash`'s warning, if any. That warns and never blocks |
| `GAME_ONLY_KEYS, isGameKey` | 844-852 | **new in 1.3.1.** Since 1.4.0 `isGameKey` asks `K.bound(code)`, every scope included, when keys.js is there. Otherwise: keys the game uses that have no `GAME_ACTIONS` row, plus (through `currentKeyFor`) any key a `GAME_ACTIONS` row currently uses. Private |
| `modHolding, keyClash` | 854-867 | **new in 1.4.0.** `modHolding` finds the other mod keybind on a code. `keyClash` words the warning: `<key> is also a game key`, `<key> is also <mod>`, or both |
| `KEYS_DONE='keys.migrated', BIND_CODE, modKeysSaved, migrateKeys` | 869-926 | **new in 1.4.0.** One-time move of `keys.map` into the game's binds through `K.set`. A bind already changed in the game wins, a swap such as W and S stays whole, and a key another `game` bind holds is skipped. A remap **from** a key a mod answers to is skipped too (897): our capture listener used to stop that press, and with it gone every press would run both. `modKeysSaved` (873) is `modKeySet()` plus the saved `zoom.key`, `perf.key` and `tc.shader.toggleKey` (or their defaults), because Zoom and SH may not have registered at startup; a mod that isn't installed only costs that one remap. A source key failing `BIND_CODE` (870, what keys.js keeps on reload) is skipped as well (898). An action muted with no replacement can't move, because the game has no unbound state: it returns to its default and counts as skipped. On success it clears `keys.map` and `keys.mute`, sets the flag and toasts the counts, naming any keys skipped for a mod (919). If it can't finish it undoes what it set, keeps the old data and returns null |
| `nativeKeys, initNativeKeys` + seams | 928-948 | **new in 1.4.0.** `nativeKeys` holds the module once the remaps are in it; null keeps the legacy rows and remap (a build without keys.js, or a failed migration) |
| `GAME_ACTIONS, keybindEntries, entryKey` | 836-954 | 13 legacy game rows (WASD, Space, Shift, Ctrl, Q, E, T, F5, F3, F1) plus mod keybinds; mod keybinds alone when `nativeKeys` is set |
| `keybindsSection, prettyKey` | 956-985 | Keybinds tab: the mouse sensitivity slider (`input.sens`), with `nativeKeys` a "Game controls…" button (`openGameControls`), a `.tc-list` of `item` rows ("Press a key" while capturing), "Reset all keybinds", which now wraps each mod `reset()` in try/catch + `console.warn` (fixed issue 48) |
| `bus._keybinds` | 986-990 | test seam: `[{id, label, key}]` of the registered mod keybinds |
| `PERF_KEY_DEF='F2', PERF_LINES, readPerfKey` | 995-999 | the overlay key: `perf.key` in `tc.options`, absent = `F2` |
| `ensurePerfEl` | 1002-1017 | lazily appends `div#tc-perf` to `<body>` with four line divs `[data-l=fps\|cpu\|bound\|shadow]` |
| `perfSet(k, text), isNum, fx1, fx0` | 1019-1027 | writes a line only when its text changed; `null` hides it |
| `perfAt, placePerf` + `resize` listener | 1031-1049 | fixed top-right: below `#hudright`'s buttons while `#hudtop` is shown, else in the corner. That keeps it clear of the game's F3 text (top-left). It re-measures (`getBoundingClientRect`, 1043) only when one of its cheap reads changed: `#hudtop.hidden`, `#hudright`'s first child or child count (`buildTop()` replaces them), or `documentElement.style` `--hp`/`--tc-s`; a window `resize` (1049) and showing the overlay (1073) mark it dirty. A `#hudright` not laid out yet (height 0) is looked at again for up to 8 ticks (1045) |
| `perfTick` | 1050-1066 | reads `Twitterentary.perf` and `cfg`: "NN FPS · NN.N ms" (`p.fpsGame` when finite and above 0, else `p.fps`), "CPU NN.N ms · GPU NN.N ms\|n/a", "CPU-bound" (yellow, only when `perf.cpuBound`), "Shadows NN/min\|off". Without `perf`: "No performance data (needs Shaders 1.5)" |
| `applyPerfOverlay` | 1068-1081 | on: show, plus `setInterval(perfTick, 250)`; off: `clearInterval` and hide. No timer while hidden; ticks are skipped while `document.hidden` |
| `bus.changed` subscriber, overlay keybind | 1082-1091 | `perf.overlay` → `applyPerfOverlay`; `perf.key` → re-read. `registerKeybind({id: 'tc.perfOverlay', label: 'Performance overlay'})` (1086): `set` writes `perf.key`, `reset` restores F2 |
| `chatOpen, editorOpen, controlsOpen, onPerfKey` + listener | 1092-1110 | `controlsOpen` (new in 1.4.0, 1095) = `#screen.on .keylist` exists. `chatOpen` (1092) = `#chatbox` exists and isn't `hidden`; `editorOpen` (1093) = any of `.se, .sp, #sign-editor, #book-screen` exists. `onPerfKey` is a window keydown **capture** listener (1110, registered after `onKeyCapture`). It ignores repeats, Ctrl/Alt/Meta (a key bound to Control, Alt or Meta is exempt, as in the shader toggle: its own keydown has that flag set, 1101), `__tc`, `__tcCaptured`, `bus.capturing`, IME composition, a typing target or focused field, `#inv` shown, chat open, an open editor and the game's Controls screen, where F2 may be the key being bound. It works in menus (a harmless view toggle), calls only `preventDefault`, flips `perf.overlay`, and refreshes our menu when the Graphics tab is open. The benchmark also uses `chatOpen` (refuses to start, 1449) and both (never reopens our menu over them, 1502) |
| `clearShaderKeys, setShader, shReloadPending, resetShaders` | 1113-1140 | `clearShaderKeys` removes every `tc.shader.*` key. `setShader` = `TE.set(key, v)`; for an older SH without `set` it writes `cfg[key]` and `tc.shader.<key>` and calls `TE.apply` if present (1125-1127). `resetShaders` = `TE.reset()` + `clearShaderKeys()`. It returns false when only the keys could be cleared (an older SH without `reset`), and then sets `shReloadPending` |
| `presetPicker` | 1141-1160 | a `.tc-cycle` button "Quality: Medium" + a `small` description. A click applies the next preset (from Custom, the first) with `TE.applyPreset(group, id)`, then `refresh()`. Returns an `update()` that relabels it in place ("Custom" when `TE.currentPreset` is null) |
| `BENCH_DEF, numOrNull, cap1, isTextField, benchDefaults, benchSeconds` | 1163-1185 | `BENCH_DEF = {seconds: 6, warmup: 2, scenarios: [current, off, low, medium, high, ultra]}`, used when `TE.bench.defaults` is missing. `isTextField`: a range/checkbox/button input is not a text field. `benchSeconds` = `TE.bench.estimate(opts)`, else scenarios × (seconds + warmup + 1) |
| `benchPartial, packBench, BENCH_PARTIAL_NOTE, lastBench, benchNum, benchEnv, benchText` | 1188-1245 | `packBench(res, partial)` makes the JSON-safe `bench.last` (below; it keeps `scale`, so stored results stay readable); `benchPartial` accepts only `'stopped'` or `'interrupted'`. `benchText` builds the clipboard Markdown: `\| Scenario \| FPS \| Mean ms \| p95 ms \| 1% low \| CPU ms \| GPU ms \|`, then for a partial result its `BENCH_PARTIAL_NOTE` in italics (1244), plus an env line "GPU … · W×H · Shaders … · Better Options … · GPU timer yes\|no · date" |
| `copyFallback, copyText, copyBench` | 1246-1269 | `copyText`: `navigator.clipboard.writeText`, then a hidden-textarea `execCommand('copy')` fallback. `copyBench` logs the text if both fail; toast either way |
| `OPTION_KEYS, scriptVersion, gpuName, shaderSettings, settingsText, copySettings` | 1275-1342 | new in 1.3.0: Copy all settings (below) |
| `BENCH_SCREEN='tcbench', BENCH_ABORT_WAIT, benchRun, canAbort, benchScreenUp, benchStatus, setBenchStatus, buildBenchScreen, startBenchStatus, stopBenchStatus` | 1346-1381 | the see-through screen shown during a run: a hidden `span.tc-bench-screen` marker plus a `div.tc-cap.tc-bench-status` line at the top with a 1 s countdown: "Benchmark running, about N s left. Don't move.", then "Benchmark finishing. Don't move.", each followed by " Escape stops it." when `canAbort()` (`Twitterentary.bench.abort` exists, 1353), and "Stopping the benchmark." once stopped (1356). `benchRun` (1352) is the run in progress: `{started, watch, stop, abortAns, giveUp, giveUpTimer, fs}` (`fs`: it started in fullscreen). `benchScreenUp` = `#screen.on` with the `.tc-bench-screen` marker. The countdown also backs up the observer: each tick stops a watched run whose screen is gone (1376) |
| `onBenchScreenChange, watchBenchScreen, unwatchBenchScreen` | 1385-1403 | once the bench screen is up, a MutationObserver on `#screen`'s `class` and `#screen .inner`'s child list (1396-1397) calls `stopBench('closed')` as soon as the game takes the screen away (its pause menu, a death or message screen). Not watched when `showScreen` failed and the menu was closed instead |
| `stopBench(why)` | 1406-1417 | once per run: sets `run.stop`, stops watching, and (if `bench()` was called) calls `Twitterentary.bench.abort()`. `abortAns` records `'ok'`, `'idle'` (returned false), `'none'` (no `abort`) or `'threw'`. After `'ok'`, a 5 s give-up timer (`BENCH_ABORT_WAIT`, 1347) stops waiting for `bench()` |
| `onBenchKey` + listener | 1420-1431 | window keydown **capture** listener (1431, registered after `onPerfKey`). Only during a run, only Escape, and not while capturing a key or typing. On the bench screen it calls `preventDefault`, `stopImmediatePropagation`, marks `__tcCaptured` and calls `stopBench('escape')`. Without `bench.abort` (once `bench()` has started) Escape goes to the game as before |
| `onBenchResize` + listeners | 1435-1439 | window `fullscreenchange` and `resize` listeners (bubble phase, 1438-1439). During a run not yet stopped, it calls `stopBench(run.fs ? 'escape' : 'resized')`: in fullscreen, Chrome spends the first Escape on leaving fullscreen and never passes that keydown to the page, and any resize changes the pixel count mid-measurement. Unlike `onBenchKey` it needs neither the bench screen nor `bench.abort` (without it the run keeps measuring and is marked interrupted) |
| `benchBusy, runBench` | 1443-1519 | the benchmark flow (below) |
| `bus._runBench, bus._benchText` | 1520-1521 | test seams. `_runBench(opts)` never rejects; it resolves `{ok: true, result}`, `{ok: true, result, interrupted: true}`, `{ok: false, error}`, or for a stopped run `{ok: false, error: 'stopped', stopped: true, reason, saved, result}` (1516), `reason` being `'escape'`, `'resized'`, `'closed'` or `'bench'`. `_benchText(b?)` returns the Markdown for `b` or `bench.last` |
| `benchLine, benchRows` | 1522-1551 | the Shaders-tab block, only when `typeof TE.bench === 'function'`: `.tc-sub` "Benchmark", a blurb (scenarios from `bench.defaults`, duration from `bench.estimate()`), "Run benchmark" (disabled "Benchmark running" during a run), then, when `bench.last` has rows, "Last benchmark" (with " (stopped)" or " (interrupted)" for a partial result, 1539, and its note as `p.desc.small.tc-bench-partial`, 1540): a `div.tc-bench` table (scenario with its first letter capitalised and the raw name as `title`, FPS, p95 ms; non-finite values show "n/a"), a `p.desc.small.tc-bench-env` line and "Copy results" |
| `shadersSection` | 1553-1624 | the Shaders tab (below) |
| `resetting, resetAll, onResetAllClick, copySettingsButton, aboutSection` | 1627-1688 | the About tab ("Better Options v…", 1679), the `Copy all settings` button with `data-tc="copy-settings"` (1673) and "Reset all options" (below) |
| `curTab, tabsList, buildScreen, api` | 1690-1730 | screen builder (the `.tc-marker` at 1708); `reg:` sections get `build(api())` (1718); a tab that throws shows a note instead |
| `bus.ui, bus.build, bus.close` | 1731-1733 | exports |
| `openMenu, closeMenu, refresh` | 1735-1750 | `M.showScreen('tcoptions', buildScreen, 'dim')` then `stealFovInput()` (1740); `M.back()`; `M.refresh()` while our menu is open |
| `onDocClick` | 1753-1762 | capture click on a `#screen .inner button[aria-label]` whose label is in `LBL.options` opens our menu |
| `sensMult` + mousemove | 1764-1774 | scales `movementX/Y` under pointer lock on `#gl` |
| init | 1776-1785 | `applyUiScale`, CSS, then on DOM ready `tryPatch` (10 tries × 300 ms), the label observer, `initLabels` and `applyPerfOverlay` (1782); `resize` (2×), the interval (1784), `fullscreenchange` |

**`tc.options` keys of the overlay and benchmark:**
- `perf.overlay` (bool, default false).
- `perf.key` (the overlay's key code; absent = `F2`).
- `bench.last` = `{at (ms epoch), bo (BO version), env: {gpu, w, h, dpr, version, timer}, rows: [{name, fps, ms, p95, low1, cpuMs, gpuMs, scale, note?}], partial?}`. Numbers are kept as numbers or `null`, with at most 32 rows. `partial` is `'stopped'` (stopped early: only the scenarios that finished) or `'interrupted'` (it ran to the end, but its screen was closed during the run); absent for a complete run.

**Copy all settings** (`settingsText` 1311): pretty-printed JSON, one object: `tweetcraftSettings: 1`, `scripts` (versions of shaders, betterOptions, zoom, chatHistory; `null` when not loaded, `"unknown"` when loaded with no version, as CH), `gpu`, `screen {w, h, dpr}`, `game {rd, fov, heldLight, fireflies, lang}`, `shaders` and `options`.
- **Secrets:** it reads a fixed list of names only (`mc.rd`, `mc.fov`, `mc.heldLight`, `mc.fireflies`, `mc.lang`) and never walks `mc.*` or the rest of localStorage. `tc.shader.*` is walked by prefix. `options` is the `OPTION_KEYS` allow-list of 10 keys, so `bench.last`, `keys.migrated` and other mods' keys are left out. compat plants fake values to prove it.
- `game.fov` is `realFov()`, never a zoomed value. `game.fireflies` is the raw `mc.fireflies`, normally null: nothing in the game writes it.
- `shaders` also lists SCHEMA keys at their current value, because only non-defaults are stored. A stale `tc.shader.renderScale` is listed too (issue 67).

**Performance overlay** (`#tc-perf`, 992-1110):
- Look: the game's F3 style. An `rgba(80,80,80,.56)` box, `#e0e0e0` text in the Tweetcraft font at 8 × `--d` with a `--d #3f3f3f` shadow, so it follows BO's UI scale.
- Placement: fixed top-right, z-index 8 (under `#adv` z9 and `#note` z10), `pointer-events: none`. Below `#hudright` while `#hudtop` is shown, else in the corner (`placePerf` 1032).
- **Why F2:** it isn't a default in the game's `BINDS` (game:keys.js:10), and no game module handles it. Browsers give F2 no default action (unlike F4, F6, F7, F10-F12), and our other scripts use K (shaders) and Z (zoom). Since f6b38f505d a player can bind F2 to a game action in Controls, and then it fires alongside the overlay. Minecraft uses F2 for screenshots, so a future default is plausible.
- The key is ignored while chat is open (`#chatbox` not `hidden`), the inventory or a survival screen is shown, or one of the game's editors is open (skin editor `.se`, skin preview `.sp`, `#sign-editor`, `#book-screen`; present means open). compat anchors each editor's element and checks the page has none of them permanently.
- Not checkable in smoke: the in-world placement under `#hudright`, because the title screen hides `#hudtop`. Check it in game.

**Benchmark** (`runBench` 1444):
1. It refuses, with a toast, when there's no `bench()`, a bench is running, chat is open or a text field is focused (1447-1449), or `menus.js` lacks `closeMenu`/`showScreen`. It sets `benchBusy` before awaiting `menus()` (1450), so a second call in the same tick is refused, and clears it again on that last refusal (1453). It stops key capture (1459).
2. It shows the see-through screen: `menus.showScreen('tcbench', buildBenchScreen, '')`, falling back to `closeMenu()` if that throws (1461-1464), and starts watching it (1465). Then a 4 s toast "Benchmark running, about N s. Don't move." and a 150 ms settle.
3. `await Twitterentary.bench()` (raced against the give-up timer, 1471), then it stores `packBench(result, partial)` in `bench.last` (1493-1496): a complete run, an interrupted one, or a stopped one with at least one finished row. A stopped run with no finished rows leaves `bench.last` unchanged (`saved: false`).
4. Unless the game took the screen (`reason 'closed'`), it reopens BO on the Shaders tab, scrolled to `.tc-bench` (or the Run button), with a 3 s "Benchmark done", "Benchmark stopped", "Benchmark interrupted" or "Benchmark failed: <msg>" toast. If the screen was taken, or chat, a container, an editor or a text field is open by then, it closes the bench screen only if it's still up and toasts "… See Options, Shaders tab" when a result was saved (1502-1504).
- **Stopping a run early** (needs SH's `bench.abort()`):
  - **Escape** on the bench screen (`onBenchKey`): `reason 'escape'`. The game never sees the key, whose `back()` would open the pause menu and leave the run measuring. Our menu comes back on the Shaders tab; with a finished row, `bench.last.partial === 'stopped'` and the `.tc-bench-partial` note shows.
  - **Leaving fullscreen or a window resize** (`onBenchResize`): `reason 'escape'` if the run started in fullscreen (that is how Escape shows up there: Chrome exits fullscreen and the page never gets the keydown), else `reason 'resized'`. Either way our menu comes back on Shaders, as for Escape.
  - **The game takes the screen** (observer or the 1 s backstop): `reason 'closed'`, and the game's screen is left alone.
  - **Someone else calls `Twitterentary.bench.abort()`**: the result has `aborted: true`, `reason 'bench'`, and our menu comes back on Shaders.
  - Escape, leaving fullscreen or a resize before `bench()` is called (the 150 ms settle) stops it even without `abort`; nothing is saved.
  - Without `abort`, Escape goes to the game (its pause menu) and the run keeps measuring. The observer still notices: the result is kept as `partial: 'interrupted'` and resolves `{ok: true, result, interrupted: true}`, and our menu isn't reopened.
- **Why a screen rather than `closeMenu()`:**
  - With `S.menu` set, the game's slow-frame watchdog (game:main.js:588, `steady` requires `!S.menu`) never calls `regainCanvases()` mid-run (game-core.md §4).
  - The world, HUD and hand still draw exactly as in play: `show` has no `S.menu` term, and only the crosshair and hint hide.
  - The player can't move or look (`showScreen` → `releaseInput`).

**Shaders tab** (`shadersSection` 1553). Everything on `window.Twitterentary` is feature-detected, so an older SH still gets the per-row UI.
1. **While a benchmark runs** (`benchBusy || TE.bench.running`, 1561), it shows only a note and the Benchmark block. There are no preset or SCHEMA rows, so BO never writes `CFG` mid-run.
2. The header, a note while `shReloadPending`, then the Quality and Look pickers, shown only when `TE.presets`, `applyPreset` and `currentPreset` exist.
3. "Shaders: ON", then the SCHEMA rows grouped under `.tc-sub` headings by `f.section`, in schema order: `bool` → toggle, `num` → slider, `choice` → cycle.
4. The Benchmark block follows the Quality section's rows (1609), or, without that section, comes just before the reset separator.
5. Each write goes through `setShader` and relabels both pickers in place (`syncPickers`), so dragging a slider never rebuilds the screen.
6. Rows flagged `reload` (only an older SH has them) get "(reload)", a toast for any type, and a "Reload page" button. That button also shows while `shReloadPending`.
7. "Reset shaders" needs a second click within 3 s (`armButton`).

**Reset all options** (`onResetAllClick` 1656 → `resetAll` 1628). It asks first in the game's `showMessage(title, text, [[label, fn]…])` (game:menus.js:201). Both buttons first reopen our screen. Without `showMessage` it falls back to the two-click confirm. Then, in order:
1. stop key capture and disarm both confirms;
2. `await` each mod keybind's `reset()` (the overlay key included). This runs before `bus.reset()`, because Zoom's reset writes `zoom.key` into `tc.options`;
3. `resetShaders(TE)`, or only `clearShaderKeys()` when SH isn't loaded;
4. `bus.reset()` (which also turns the overlay off, drops `perf.key` and `bench.last`, and the `changed` subscriber hides `#tc-perf`), then `applyUiScale()`;
5. `sendF1(true)` (1645): presses the HUD key only if the game's HUD is hidden, whether BO or a real F1 hid it;
6. `await setFov(70)`, then `await setRenderDistance(defaultRd())` (8, or 6 on touch);
7. `refresh()` and a toast ("Reload to apply the shader defaults" for an older SH).

It never touches any other `mc.*` key.

**Game hooks:**
- **Modules:** `import('/js/menus.js')` for `openOptions, closeMenu, openPause, showScreen, showMessage, back, refresh`; `import('/js/i18n.js')` for `t, onLocaleChange` (game:i18n.js:104, 151); `import('/js/keys.js')` for `BINDS, codeOf, action, bound, set`; `import('/js/controls.js')` for `openControls`; `import('/js/ui.js')` for `Hud.prototype.{draw,suggestions,tab,hint}`; `import('/js/survival/client.js')` for `SurvivalClient.prototype.drawHud`.
- **Labels:** the i18n keys `pause.options`, `pause.full`, `pause.exitFull` and `pause.distance` (`{n}`); English in game:lang/en.js:59-62, 208.
- **Selectors:** `#screen(.on) .inner`, `#screen .inner button[aria-label]` matching `LBL.options` (the pause menu and, since c25d4c024d, the title have it, and `pauseUp` tells them apart by `dim`), `input[type="range"][data-k="fov"]`, `button[aria-label]` matched against `LBL`, `button.mcb` (skips `.hb`), `#inv.off`, `#gl`, `#note`, `#cross`, `#hudtop`, `#hudright` (overlay placement), `#chatbox` (`hidden` = chat closed) and the editor overlays `.se, .sp, #sign-editor, #book-screen` (overlay key and benchmark guards), and `#screen.on .keylist` (the Controls screen).
- **Other:** the CSS variables `--u` and `--d`, and `--hp` on `<html>` (read as the overlay's re-measure signal); a synthetic press of the `hideHud` bind (`F1` without keys.js) toggles the game HUD; `#cross.off` as the sign that no game menu is up, `showScreen` calling `releaseInput` and `document.exitPointerLock()` being looked up at call time (the FOV input's priming); the `tcbench` screen relies on the game's slow-frame watchdog skipping frames with a menu open; the bench-screen observer relies on `menus.js` keeping one `#screen` and `#screen .inner` for good (`showScreen` replaces the children and sets the class, `closeMenu` clears both); Escape on the bench screen relies on the game handling Escape in a bubble-phase window keydown listener (all compat-checked). Not a game hook: in fullscreen, Chrome uses the first Escape to leave fullscreen without a keydown, which `onBenchResize` catches through `fullscreenchange`.
- **Shaders API (1.5.0):** `Twitterentary.perf` (overlay, `fpsGame` since 1.5.1), `bench()`, `bench.running`, `bench.defaults`, `bench.estimate()`, `bench.abort()` (benchmark), all feature-detected.

**Globals:** `window.__tcOptions`, `div#tc-perf`. **Storage:** `tc.options` (including `perf.overlay`, `perf.key`, `bench.last`, `keys.migrated`), the game's `mc.keys` (once, through `K.set`), `tc.shader.*` (fallback writes and clearing), `mc.fov`, `mc.rd`.

**Hot paths:**
- `mousemove`, every event: `bus.get`; when sens ≠ 1, also `getElementById` and 2× `defineProperty`.
- `keydown`/`keyup`: with `nativeKeys` set it returns after the capture check. On the legacy path it allocates `modKeySet()`, and while `keys.map` is unset, `bus.get` JSON-clones the default. New: `onPerfKey` does one string compare per keydown unless it's the overlay key, and `onBenchKey` returns at once when no benchmark is running; so does `onBenchResize` on `resize`/`fullscreenchange`.
- The `Hud.draw` wrapper, every HUD frame: `Object.assign` when scale ≠ 1. `suggestions/tab/hint` take rest args on every call.
- The 250 ms interval: `bus.get` each tick; when `ui.scale` ≠ 1, also `uiBase()` → `matchMedia`.
- The overlay timer, 4×/s **only while it's shown**: two `getElementById`s and two inline-style reads in `placePerf` (a `getBoundingClientRect` of `#hudright` only when one of them changed) plus string building per tick, with DOM writes only when a line changes.
- During a benchmark only: the 1 s status tick and the bench-screen MutationObserver (fires on screen changes, not per frame).
- The MutationObserver redraws labels on every screen rebuild.
- The capture `click` listener runs one `closest()` per click.
- A Shaders-tab slider calls `TE.set` and 2× `currentPreset` per `input` event, while dragging only.

**Settings:** all live. `ui.scale` is read by every wrapped call, `input.sens` per event, legacy keys per event, `perf.overlay`/`perf.key` through `bus.changed`. FOV applies through the game's slider handler, render distance through the game's Distance button, and shader rows through `TE.set`. `hud.on` is only shown as a label and is never re-applied at load (issue 17); "Reset all options" checks `#hudtop` instead.

## 4. tweetcraft-zoom.user.js (ZM, 269 lines)

**Purpose:** hold a key (default `KeyZ` since 1.1.2; `KeyC` clashed with the game's undo confirm and its blueprint keys) to divide FOV by `zoom` (1.5-20, mouse wheel adjusts while held) and scale mouse look by `look/zoom`. Since 1.1.1 it tweens the FOV it writes, so the zoom is even at any frame rate. **Metadata:** `@version 1.1.2`, `@run-at document-start`, `@grant none`, `@namespace tweetcraft.zoom` (SH, BO and CH use `tweetcraft.twitterentary`). `__tcZoom.version` reads `GM_info`.

| Name | Line | Purpose |
|---|---|---|
| `DEFAULTS, KEY, zoom, look, TWEEN_MS, POLL_MS` | 15-20 | `{key:'KeyZ', level:4, look:1}`; a 250 ms tween; a 500 ms priming poll. A stored zoom key is kept, so a stored `KeyC` keeps the old clash |
| `zooming, held, orig, cur` | 23 | `zooming`: from the press until the view is back on `orig`. `held`: only while the key is down, which is what the wheel and look scaling follow. `orig`: the player's real FOV. `cur`: the last value written |
| `log, typing, gl, screenOn, canZoom, crossOn, chatShut, locked, inWorld, idle` | 25-40 | helpers. `canZoom` (29-31) = no screen, not typing, `#gl` present, and since 1.1.2 no `.se`: the skin editor can open with `#screen` off, and Ctrl+Z is undo there. `crossOn`: the crosshair is the only DOM sign that `S.menu` is empty. `idle` = a world is up and nothing holds input (before the first click), and not on a touch screen, where play never takes pointer lock |
| `tcGet, tcSet` | 42-53 | `zoom.<k>` through the bus, or directly in `tc.options` |
| `refreshConfig` | 53 | reloads KEY, zoom and look with clamping |
| `fovBus, validFov, storedFov` | 59-69 | `storedFov` reads `mc.fov` at the press (30-110, else `bus.fov.get()`, else 70), so a FOV changed in the game's Options is picked up. The old cached value went stale without BO |
| `domReady, menus, localStealFov` | 72-101 | fallback copy of BO's input steal, only without a BO that has `setNow`; shadows `exitPointerLock` the same way |
| `write` | 106-115 | the one place that writes the FOV: `bus.fov.setNow`, else the local input. Synchronous, can't throw, false = no input cached yet |
| `tweenTo, step, cancelTween, settle` | 119-133 | own rAF tween on `performance.now()`, linear in degrees, with values rounded to two decimals because the game's slider handler draws each one into a label canvas; the last write is exactly the target, and it stops rescheduling when done. One frame callback, so a fast wheel is one write per frame. Linear won a simulation through the game's `dt*10` ease at 60, 30 and 20 FPS; the feel isn't measured |
| `fillInput` | 136-153 | first press before priming worked: awaits the steal, and nothing has been written, so failing leaves the FOV alone |
| `start, stop, endNow` | 153-172 | `start`: reads `orig` unless the tween back is still running, then tweens to `orig/zoom`. If the input isn't cached it uses `fillInput` only when locked, idle or off a world page; unlocked in a world with the crosshair hidden may mean an open inventory, so the press is refused. `stop` tweens back. `endNow` restores at once with no tween |
| `primeTick` | 181 | polls `bus.fov.prime()` every 500 ms until true; without BO or with an older BO, runs `localStealFov` at the same idle moment |
| listeners | 194-230 | keydown/keyup capture (bus guards, and both ignore `e.__tc`, BO's synthetic press, 195/201). Keydown has no modifier check, so Ctrl, Meta or Alt + the key zooms in the world (196); `blur` and hidden tab → `endNow`, because rAF stops in a hidden tab; `pagehide` → `endNow` plus a direct `mc.fov` write, because `80 / 1.5 = 53` would pass the game's 30-110 check on reload; `wheel` and `mousemove` only while `held` |
| `registerWithBus` | 232 | polls every 200 ms; `changed`→`refreshConfig`; `registerKeybind('zoom')`; `register` Zoom tab (level and look sliders, reset button) |
| `window.__tcZoom` | 262 | `{get zooming(), get realFov(), version}`: `realFov` is `orig` while `zooming`, else `storedFov()` |

**The game does the easing.** It runs `S.fov += (target - S.fov) * min(1, dt*10)` once per frame (game:main.js), and ZM's tween feeds that a moving target. At 60 FPS the view settles about 650 ms after a press. Below 60 FPS the tween evens the steps but can't add frames.

**Game hooks:** `menus.js` `openOptions/closeMenu` and the FOV slider (fallback only), `#screen.on`, `#gl`, `.se`, `#cross.off`, `#chatbox`, `window.__ready`, `mc.fov`, world paths `/r/` and `/play/`. **Globals:** `window.__tcZoom`. **Storage:** `tc.options` → `zoom.key/level/look`; `mc.fov` (transient zoom value, restored on `pagehide`). **Hot paths:** `mousemove` and `wheel` do almost nothing unless `held`; the tween writes once per frame for 250 ms. **Settings:** live through `bus.changed` → `refreshConfig`.

## 5. tweetcraft-chat-history.js (CH, 97 lines)

**Purpose:** Up and Down in `#chatbox` recall the last 100 sent lines (memory only, lost on reload). **Metadata:** `@version 1.0.1`, `@run-at document-start`, `@grant none`. No in-code version.

| Name | Line | Purpose |
|---|---|---|
| `MAX, hist, cursor, draft, tracking` | 15-20 | state |
| `box, chatOpen` | 22-27 | `#chatbox`, visible when `!hidden` (game:main.js:3218/3232) |
| `reset, record, setValue` | 29-49 | `record` trims, de-duplicates consecutive lines, caps at 100 |
| `up, down` | 51-64 | saves the draft on the first Up; Down past the end restores it |
| `focusin` capture | 66 | `reset` when `#chatbox` gains focus |
| `keydown` capture | 70 | returns first on IME composition (`e.isComposing \|\| e.keyCode === 229`, 71), the same test as the game's chat `composing(e)` (game:main.js:2509, 2642). Enter → `record(value)` (before the game clears it). Up/Down without modifiers → `queueMicrotask`, then a `defaultPrevented` check |
| `window.__mcChatHistory` | 92 | `{list (getter copy), clear(), record}` |

**Hooks:** `#chatbox`, window `focusin`/`keydown` capture. **Hot path:** keydown, cheap. **Settings:** none.

## 6. Issues & smells

Numbers are stable: fixed entries are removed, not renumbered. Fixed in SH 1.4.0 / BO 1.1.0: 2, 4, 5, 7, 8 (frame counting; the rest is now 49), 9, 12, 13, 14, 15, 16, 27, 29, 30, 47, 52. Fixed in SH 1.5.0 / BO 1.2.0: 3 (no `getParameter` in the shadow pass), 48 (per-keybind reset), 51 (exact remesh tracking), 57 (`uAmbStr`/`uSunStr` dropped from `U1` and `fsDecls`), 58 (SH4: the lit FS calls the game's own `lightmap()` instead of a VS copy of the curve; only its value at l = 0 is still mirrored on the CPU, in `tcLm0` 999-1006, which compat's `LIGHTMAP` anchor covers), 60 (SH5: Auto no longer hunts under a real 60 Hz cap: the settle skip, 16 samples for a drop after a raise, the timed backoff, no 0.95 step, and capped drops that need two real misses and go at most 0.1 down; 36-45 → about 3 scale changes/min at 60 Hz vsync). Fixed in SH 1.5.1 / BO 1.3.0 / ZM 1.1.1: 24 (`el.min` is 2), 34 (the input is primed at idle or on pause, and the fallback keeps pointer lock). Gone with the composite and the governor in 1.5.1: 56, 61, 62, 63, 65. Fixed in SH 1.5.2 / BO 1.4.0 / ZM 1.1.2: 6 (K is a registered keybind, `tc.shaders.toggle`), 28 (`keyClash` warns about game keys and other mods' keys; it stays warn-only by design), 33 (the default is `KeyZ`, which is the whole fix: a stored `KeyC` keeps the clash, and there is no modifier guard).

| # | Where | Why it matters | Suggested fix |
|---|---|---|---|
| 1 | SH `patchCloud` 575-583 | regex literals use `\\s`/`\\(`, so they never match (known in compat). The inserted text `'\\nuniform…'` is a literal backslash-n, so fixing only the regex would produce a GLSL compile error | single escapes in both regexes and `'\n'` in the string; then remove `known` in compat |
| 10 | SH `getUniformLocation` 823-835, `onSprite` 614-618, `updateState` 981-1021 | the sun is "the first `uC` after `uTop`" (sprite, pChat and signs all use `uC`) and day = the zenith's blue channel; both depend on game draw order and palette. compat checks the draw order, not the palette | tag only the sprite program's `uC`; derive day from the sun height |
| 11 | SH `drawShadowSet` 1454-1471, `shadowProg` 1272-1281 | assumes one `TRIANGLES/UNSIGNED_INT/offset 0` draw per VAO (true today, game:gfx.js:1377) and the atlas on unit 0 at the first terrain draw (game:gfx.js:1292-1293). Both are compat-checked | store `mode/type/offset` in `rec`; bind the atlas explicitly |
| 17 | BO `toggleHud` 409-413, `hudRow` 731-733 | `hud.on` is saved but never applied at load and not updated by a real F1, so the label desyncs. "Reset all options" is safe: it calls `sendF1(true)` (1645), which reads `#hudtop` and also restores a HUD hidden by a real F1 | label from `#hudtop.hidden` (outside menus), or apply `hud.on` at startup |
| 18 | BO init 1784 (`uiTimer`), `reassertUiScale` 437-445 | `setInterval(reassertUiScale, 250)` runs forever. At scale 1 it returns after a `bus.get` (438-439), but at any other scale it recomputes `uiBase()` (`matchMedia`) and reads three CSS properties 4× a second | MutationObserver on `<html style>`, or reassert on resize only |
| 19 | BO `uiBase` 420-428, `applyUiScale` 429-436 | copies the game formula (game:main.js:527-536) and re-runs `matchMedia('(pointer: coarse)')` on each call. It also overwrites `--u/--d` even at scale 1, and `hp` is unused | multiply the game's current value; do nothing when `m === 1` |
| 20 | BO 64, 473, 492, 775 | `catch (e) {}` in `emit`, `patchHudScale`, `patchSurvivalScale`, `onKeyCapture` hides failures | `console.warn(TAG, …)` once |
| 21 | BO `Hud.draw` wrapper 456-464, `wrapScale` 466-471 | `Object.assign` every HUD frame when scale ≠ 1. The `suggestions/tab/hint` wrappers allocate a rest-args array on every call, even at scale 1 | mutate and restore `o.gs`; use fixed-arity wrappers |
| 22 | BO `redrawButtonLabels` 495, observer 535 | re-renders every `button.mcb` label on each screen rebuild even at scale 1 | return early when `m === 1` and `__tcPx` is unset |
| 23 | BO `stealFovInput` 258-265 | the in-flight race is fixed in 1.3.0: the cache is re-checked after the await, and the grab is one synchronous task. It still caches a detached `<input>` for good and relies on its `oninput` closure (game:menus.js:1825-1829), even after "Game options…" rebuilds that screen | re-steal if the game rebuilds |
| 25 | BO `setFovNow` 303, `setFov` 310 + game `oninput` | the transient zoom FOV is saved to `mc.fov` on every write. ZM 1.1.1 restores it on `pagehide`, so a normal reload is safe, but a crash while zoomed leaves it. The game then rejects < 30 (game:main.js:210-213) and the FOV resets to 70; a zoomed value of 30 or more would load as the real FOV | add a `temp` flag to `fov.setNow` that skips persistence. The game's handler writes `mc.fov` itself, so this needs an undo after the dispatch |
| 26 | BO `onKeyCaptureImpl` 786/795, `keyName` 762 | legacy path only since 1.4.0 (`nativeKeys` returns first): allocates `modKeySet()` per key event; remapped modifiers get `key:'ShiftLeft'` and keep the source's `shiftKey` flags | cache `modKeySet` on register; add Shift/Control names and flags |
| 31 | ZM `registerWithBus` 232-234 | polls every 200 ms forever when BO isn't installed | cap retries (for example 50) |
| 32 | ZM `changed` callback 235 | `refreshConfig` runs on any bus change (every key, `'__sections'`, and each key `bus.reset()` re-announces); resets the wheel-adjusted `zoom` (217) mid-zoom without re-applying FOV | filter `k.startsWith('zoom.')`; skip while `zooming` |
| 35 | CH keydown 84-89 | the microtask runs right after this capture listener (microtask checkpoint between listeners for browser events), before the game's `if (suggest.key(e)) e.preventDefault()` (game:main.js:2643), so history and suggestions both move on Up/Down | check the suggestion list's visibility, or defer with `setTimeout(0)` |
| 36 | CH `up/down` 51-64 | no `preventDefault`, so the input's default ArrowUp caret move runs after `setValue` (inferred), leaving the caret at the start | `preventDefault` once you know you're handling the key |
| 37 | CH keydown 70 | doesn't check `__tcOptions.capturing`/`__tcCaptured` (rule); low risk because it runs only while chat is open | add the guard for consistency |
| 44 | BO `clampFov` 298 | same root cause as 25: FOV is clamped to 2-110 and written to `mc.fov`, while the game only accepts 30-110 on load. BO's `syncFov` and `realFov` ignore such a value | fix with 25 |
| 45 | BO `patchHudScale` 450-474 | **hint and tab are scaled twice** when UI scale ≠ 1. `Hud.draw` passes its already-scaled `o.gs` to `this.hint`/`this.tab` (game:ui.js:740-741, their only callers), and the `wrapScale('hint'/'tab')` wrappers scale it again (gs·m²). `hint` partly clamps to the screen; the `tab` player list doesn't | drop the `hint`/`tab` wrappers (`draw` already covers them), keeping `suggestions` |
| 46 | SH `shadowVS` 1246-1262 | copies only the plain tile UV, but the game's terrain VS remaps UVs for shaped faces (`aPos.y >> 12u`, `RECT[]`/`BOXUV[]`), so cutout shadows of shaped blocks (torches...) sample the wrong texels | port the game VS's UV remap into `shadowVS` |
| 49 | SH globals 726, 941, 964 vs game:dragonview.js:54 | all GL state (`G`, `ST`, `rec`, `curInfo`, `frameId`) is shared by every WebGL2 context on the page. Only frame counting, the viewport hook and the buffer tracking are per context (`mainGL` = the first context to use a patched program, 1289). A second context that drew patched terrain would use the main context's shadow FBO and textures | keep state per context (`WeakMap<gl,…>`), or leave programs of other contexts unpatched |
| 50 | SH `inFootprint` 1188-1196, `snapCascade` 1172-1185 (`hx/hy`) | the footprint test assumes a 128-tall chunk column centred at y = 64 (the world is 128 tall today) | derive it from the game's world height, with a compat entry |
| 53 | SH `PROGS` 724, 806 | filled with every patched program's info but never read | remove it, or list the programs in `debug()` |
| 54 | SH `hookError` 735-743 | the error budget is for the page's lifetime, not a rate: 20 unrelated, transient errors over a long session (one per hour, say) pause every effect until a reload | count per time window (for example 20 per minute), or decay `ERR.n` after a run of clean frames |
| 55 | CH keydown 71 | the IME check is `e.isComposing \|\| e.keyCode === 229`, but the game's `composing(e)` (game:main.js:2509) also checks its own `compose.on` flag, set from `#chatbox` `compositionstart`/`compositionend` (game:main.js:2818-2832). In rare IME cases, an Enter that ends a composition could still be recorded as a sent line | track `compositionstart`/`compositionend` on `#chatbox` the same way |
| 59 | SH `bufferData` wrapper/`remeshed` 902-922, `trackColumn` 1538-1555, `drawShadowSet` 1454-1471; game:gfx.js:1034-1036 | **an emptied off-screen part keeps casting its shadow until it is seen.** When a part's mesh becomes empty, `gfx.setChunk` only sets `p.n = 0`, with no `bufferData` (a compat-documented limitation), so the remesh hook never sees it and the record keeps its old count. `trackColumn` drops the record only once its column is drawn again with the sibling part but without this one, so a part emptied behind the camera (a broken tree, say) still casts in both tiles until the player looks at it. A column whose opaque and cutout parts both emptied is never dropped while it stays inside the shadow map (the 60 s guard only forgets records outside it) | wrap the exported `Gfx.prototype.setChunk` to zero the record of a part whose new data is empty (with a compat entry), or treat a recorded part that isn't drawn while its column is in view as empty |
| 64 | SH `NEAR_SPARE` 1060, `finalizeShadow` 1100 | new in SH4, a visual item for the in-game check. The near tile's radius is `24 + max(shadowMove, 8)`, so it covers more ground at the same resolution: `En` 28 → 32 blocks on High and 26 → 32 on Ultra, i.e. near-tile texels 14-23% larger and close shadows a little softer. It bought far fewer near redraws (LAB2: 216 → 120/min on High-moving, 367 → 120 on Ultra-moving) | if close shadows look soft, lower `NEAR_SPARE` for High/Ultra only, or raise the near tile's size where `MAX_TEXTURE_SIZE` allows |
| 66 | ZM `start` 153-163, `fillInput` 137 | new in 1.1.1. With a lock granted at spawn and no pause yet, the first press uses the fallback: held keys drop once (`releaseKeys`). In a world, unlocked with the crosshair hidden and not primed yet (inventory, or third person in drag mode), a press is refused rather than risk closing the inventory. Neither was seen in a real world | prime sooner, if either shows in game |
| 67 | BO `shaderSettings` 1290-1310 | new in 1.3.0. Walks every `tc.shader.*` key, so a stale `renderScale` from 1.5.0 shows in Copy all settings though it does nothing | filter by `TE.cfg` when SH is loaded |
