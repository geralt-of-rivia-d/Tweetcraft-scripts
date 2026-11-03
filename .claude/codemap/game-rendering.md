# Game rendering (WebGL2)

Verified against game build 575c9209bc on 2026-11-03 (re-verified from 325afb04b5, itself re-verified from c111547912, itself re-verified from d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). 575c9209bc changed no rendering file (only `lang/*`, `rules/books.js`, `rules/enchant.js`, `survival/creative.js`, `survival/gear.js`, plus the new `rules/chestcopy.js`); `engine.wasm`, gfx.js and every `shaders/*.glsl` are byte-identical to 325afb04b5's. In 325afb04b5 gfx.js only gained an `ids.js` import (so its line numbers moved by +1) and `baseOf` in `drawWall`; every `shaders/*.glsl` is byte-identical to c111547912's. Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build 575c9209bc's `pretty/` (identical to 325afb04b5's for every file cited). "(inferred)" = not directly verified in code. "Live" = measured with `npm run probe` on the build named.

## 1. Overview

- One WebGL2 context on `<canvas id="gl">`, created in the `Gfx` constructor (`pretty/js/gfx.js:724`) with `antialias:false, alpha:false, depth:true, powerPreference:"high-performance"`.
  - Live `getContextAttributes()` on 325afb04b5 (and d7bde3deb9): `stencil:false, preserveDrawingBuffer:false, premultipliedAlpha:true, desynchronized:false, failIfMajorPerformanceCaveat:false`.
  - The game never calls `bindFramebuffer`, `createFramebuffer` or `createRenderbuffer`, so everything draws into the default framebuffer. `readPixels` appears only in `entities/debug.js` (TEST).
  - Its only `getExtension` call is new in 325afb04b5: `gpuName(gl)` (`pretty/js/gpuwatch.js:3`, once at boot, `main.js:333`) reads `WEBGL_debug_renderer_info` and `UNMASKED_RENDERER_WEBGL` for the F3 `GPU:` line.
- The rAF loop is `createFrameLoop(frame)` (`pretty/js/frameloop.js:1`, created at `pretty/js/main.js:550`, started by `loop.start()` at :449). Its `step` re-arms `requestAnimationFrame` **before** calling `frame(now)`. The global `requestAnimationFrame` is looked up at call time, so a wrapper installed at document-start is used.
- `frame()` (`pretty/js/main.js:579`, new in 325afb04b5) only times `frameBody()` (:589): the rAF interval and the JS time inside the callback, averaged per second into `gpu.frameMs`/`gpu.jsMs` (game-core.md §4). `frameBody` works in this order:
  1. It applies a deferred `resize()` first (:590-593).
  2. Once `S.started`, it runs 20 Hz ticks (`TICK=0.05`, up to 10 per frame, each also calls `gfx.tickParticles`).
  3. It calls `updateChunks()` (:1222): synchronous wasm meshing on the main thread, with a 5 ms budget in game and 12 ms otherwise. Frames that are CPU-bound here can't be helped by a lower resolution.
  4. It calls `render()` (:814), which builds a view object `v` and calls `gfx.draw(v)` (:933). `v.w/v.h` are `glCanvas.width/height` (:862-863).
  5. After `render`: music, `inv.draw`, survival screens, advancements, sponsors and `net.pos`. The 2D `#hud` canvas is redrawn every frame at full resolution inside `render` (`hud.draw`, :989).
- `Gfx.draw` (`pretty/js/gfx.js:1182`) runs in this order:
  1. Animated tiles.
  2. Clear to the fog colour.
  3. The sky.
  4. Opaque and cutout terrain (one draw per chunk).
  5. Players, entities, particles, the selection box and the undo preview.
  6. `solidOverlays`.
  7. With blending on: the ocean plane, translucent terrain, stained-glass depth, clouds, chat bubbles, `overlays` (including fireflies), and the creative held item.
- After `gfx.draw` returns, survival draws the mining crack, then the first-person hands (after a depth clear), then the burning overlay (`pretty/js/main.js:959-964`), all in the same rAF callback.
- **Live frame profile** (title screen, rd 8, 1280×720 at DPR 1):
  - c111547912: 183 `drawElements` (89 opaque, 88 cutout, 3 translucent), 1 `drawArrays`, 7 `useProgram` (sky, sun, moon, opaque, cutout and translucent terrain, clouds plane), 180 `uniform3f`, 188 `bindVertexArray`, 30 `texSubImage3D`, 1 `viewport`, 1 `clear`, about 550 GL calls. About 28k quads were drawn, of 125k opaque, 102k cutout and 230 translucent quads meshed across 173 chunks; cutout is about 45% of the geometry.
  - 325afb04b5, 30 frames averaged right after boot (still meshing, rotating title camera): 51.5 `drawElements`, 1 `drawArrays`, 7 `useProgram`, 1 `viewport`, 1 `clear`, 0 `bindFramebuffer`, 0 `getParameter`, about 290 GL calls. The draw count follows the number of visible chunks; the fixed costs (1 viewport, 1 clear, 7 programs) are the same.
- **The game has no render-scale option.** `#gl` is always `round(innerWidth·dpr) × round(innerHeight·dpr)` (§9). The graphics settings are `mc.rd`, `mc.fov` and `mc.heldLight`, nothing else.
- HUD (`#hud`) and inventory (`#inv`) are separate 2D canvases on top, and menus are DOM (`#screen`). They are not in the GL frame, so post-processing the GL canvas leaves the HUD untouched.
- World rendering is camera-relative. `uVP` = perspective × rotation only (`playerView` `pretty/js/gfx.js:199`). Per-chunk `uOrigin = chunkOrigin − cam`.
- Lighting is Minecraft-style. The wasm mesher bakes sky and block light levels and a face shade into each vertex, and the GLSL `lightmap()` turns them into colour using the day brightness `uSkyLight`. Fog is linear and cylindrical. There are no normals, no sun shading and no shadows on terrain.

## 2. Modules (rendering-related)

| Module | Responsibility | Key exports | Imported by |
|---|---|---|---|
| `js/gfx.js` | Renderer `class Gfx`, matrix helpers, sky/day maths, all core GLSL. Imports `baseOf` from `ids.js` since 325afb04b5 | `Gfx, lightmap, overlays, solidOverlays, playerView, playerVisible, perspective, mul, rotX/Y/Z, scale, translate, angDiff` | main.js (`Gfx, angDiff, playerView, playerVisible`), net.js (`angDiff`), signs.js, fireflies.js, survival/chestlabels.js, survival/grace.js (`overlays`), survival/client.js (`overlays, solidOverlays`), survival/{enchantfx,chesticons,entities,equipment}.js (`lightmap`) |
| `js/engine.js` | Loads `engine.wasm` (world, mesher, lighting). Loads, tints and alpha-fixes block tiles | `loadEngine, loadTiles, loadImage, K, B, withVariants` | main.js, inventory.js, survival/{crack,fluids,gear,items,screens}.js |
| `js/view.js` | Render-distance steps, nether fog | `RDS=[4,6,8,10,12], renderDistance, netherFogEnd, GHAST_FOG_MARGIN` | gfx.js, main.js, survival/terrain.js |
| `js/held-light.js` | Dynamic hand-held lights (≤8) | `HL {on, lights}, HELD_LEVEL, heldLevel, nearest, withHeld, heldAt, falloff, MAX_LIGHTS, K_SOLID, eyeInWall` | gfx.js (`HL`), main.js, survival/entities.js, survival/equipment.js |
| `js/remesh-sched.js` | Budgeted dirty-chunk remesh queue, with a settle delay for far chunks | `RemeshSched` | main.js |
| `js/frameloop.js` | The rAF loop, and the backing-store DPR cap | `createFrameLoop, backingDpr, MAX_PX` | main.js |
| `js/gpuwatch.js` | **New in 325afb04b5.** Renderer name for F3, software-renderer test, and the slow-frame watchdog that makes main.js re-allocate the canvases (game-core.md §4) | `createSlowWatch, gpuName, shortGpu, isSoftware, SOFTWARE` | main.js |
| `js/fireflies.js` | Night fireflies: spawned from grass/flower blocks and drawn as an `overlays` callback with its own program | `Fireflies, nightOf, hostTable, MAX=48, TICK=50, KEY` | main.js |
| `js/item3d.js` | Item display transforms, first-person item pose | `mat, T, R, S, display, DISPLAY, firstPerson, armHold, bowFrame, POSE` | gfx.js, entities/index.js, entities/mesh.js, survival/equipment.js |
| `js/hand.js` | First-person hand swing/equip state, hurt/death view roll | `H, OFF, ROLL, viewRoll, swingAt, tickHand, snapHand…` | main.js, state.js, survival/equipment.js, survival/hud.js |
| `js/entities/index.js` | Entity renderer: mobs, dropped items, armour, held items (3rd and 1st person), fire, xp orbs, fishing line. New in c111547912: TNT, armour stands, item frames | `createEntityRenderer, loadEntityAssets` | gfx.js (dynamic `import()` `pretty/js/gfx.js:1806`), dragonview.js |
| `js/entities/{mesh,models,anim,skin}.js` | Geometry builders, model defs (`MAX_BONES=16`), animation families (+ `STAND_POSES`), dragon skins | `buildKind, poseBones, KINDS, MODELS, FAMILIES…` | entities/index.js, dragonview.js, survival/end.js |
| `js/survival/crack.js` | Block-breaking crack overlay | `CrackRenderer` | survival/client.js |
| `js/survival/enchantfx.js` | Enchanting-table books and glyph particles (a `solidOverlays` callback) | `EnchantFxClient`, book helpers | survival/client.js |
| `js/survival/fluids.js` | Bucket/fire logic. Its only rendering is pushing smoke into `gfx.smoke` (`onSound` :109) | `FluidsClient, inGrace` | survival/client.js, survival/life.js |
| `signs.js`, `survival/chestlabels.js`, `survival/chesticons.js`, `survival/grace.js`, `chat-bubbles.js` | World-space billboards and overlays (`overlays` callbacks, plus `chatBubbles.draw`) | `SignsClient`, `ChestLabelsClient`, `ChestIconsClient`, `GraceClient`, `ChatBubbles` | main.js / survival/client.js |
| `js/dragonview.js` | Its **own** WebGL2 context (`alpha/antialias:true`) for dragon previews. Not the game canvas | `dragonView` | dragon-sponsor-preview.js, survival/end.js (dynamic) |

## 3. Frame pipeline

| # | Step | Code | Program | State / notes |
|---|---|---|---|---|
| 0 | Ticks, chunk meshing, camera, players list | `pretty/js/main.js:589-621`, `render` :814, `playerView` :867 | – | `viewRoll` (hand.js, survival only, :866) feeds `roll` |
| 1 | Viewport. Lit programs compiled once. Animated tiles | `draw` `pretty/js/gfx.js:1186-1188`, `initLit` :1373, `animateFire` :1079 → `animateLayer` :1086 | – | `gl.viewport(0, 0, v.w, v.h)` (:1186) is the game's **only** `viewport` call on this context (the other, dragonview.js:175, is a separate context). See "Animated layers" below. This runs before the `v.wall` early return |
| 2 | Environment (sky/fog/time) | `skyAt` :347 / `dimSky` :390 → `this.env` | – | see §7. `depthMask(true)` (:1215) just before the wall test |
| 3 | Eye inside a solid block | `drawWall` :2148 → **return** (:1216-1219) | lazy `pWall` | skips everything else, including the fog uniforms |
| 4 | Clear | :1231-1233 | – | Clear colour = fog (End: `env.clear`, except underwater or in lava). Clears colour + depth. The only `clear` of the colour buffer in a frame |
| 5 | Sky (overworld; not underwater, not in lava) | `drawSkyLit` :1391 (unlit: `drawSky` :1344) | `16-sky` (`04-sky`), stars `17-rot-b`, sun/moon `05-c-r` via `sprite` :1424 | Depth test off, cull off. Fullscreen triangle from `gl_VertexID` (`vEmpty`), z=0.999. Stars, sun and moon are additive (`SRC_ALPHA,ONE`) |
| 6 | Chunk cull + sort | :1242-1256 | – | Distance ≤ fogEnd+24, frustum AABB `boxVisible` :194, sorted near→far. Just before (:1238-1241): `DEPTH_TEST` on with `LEQUAL`, `CULL_FACE` on, blend off |
| 7 | Opaque terrain (lava included) | `pass(pt[0])` :1260 → `pass` :1321 | `13-terrain` (unlit `00`) | `tArr` on unit 0 (:1257-1258). One `drawElements` per chunk |
| 8 | Cutout terrain | `pass(pt[1])` :1261 | `14-terrain` (`01`) | alpha test `a<0.5` |
| 9 | Players | `drawPlayers` :1607 | `08-m-over`. Glow: `10-m-color` (`drawGlow` :1763) | 6 part draws + cape per player. Armour, held items and fire go to the entity renderer. Glow: `cullFace(FRONT)`, `ONE,ONE` |
| 10 | Mobs, items, xp, bobbers, TNT, fixtures | `drawEntities` :1826 → `ents.draw` `pretty/js/entities/index.js:888` | entity program (lazy) | xp orbs blended; the fishing line has its own program |
| 11 | Particles | `drawParticles` :2014, `partPass` :2031 | `11-r-u` (block bits), `12-r-u` (items/sparks/smoke/explosions) | Instanced, cull off during the draw |
| 12 | Block outline | `drawSel` :1549 | `07-off-s` | `LINES`, blended |
| 13 | Undo preview | `drawPreview` :1520 | lazy `pPv` | |
| 14 | `solidOverlays` | :1274 (`f(gfx,vp,cam,v,fog,fs,fe)`) | enchantfx's own program + `12-r-u` | depth write on, blend off |
| 15 | → transparent state | :1275-1278 | – | blend `SRC_ALPHA,ONE_MINUS_SRC_ALPHA`, `depthMask(false)`, **cull off** |
| 16 | Ocean beyond world edge | `drawPlane(0)` :1281 / :1437 | `06-cloud` (`uKind=0`, water texture) | Only within fogEnd+16 of the world edge, overworld only. `uHole` discards inside the world |
| 17 | Translucent terrain (water included) | `pass(pt[2], vis.reverse())` :1284 | `15-terrain` (`02`) | Far→near per chunk, both faces drawn. The atlas is rebound on unit 0 first (:1282-1283) |
| 18 | Stained-glass depth | `stainedDepth` :1285 → :1295 | `03-terrain` | Colour mask off, depth write on, layers ≥240, front faces |
| 19 | Clouds | `drawPlane(1)` :1286-1287 | `06-cloud` (`uKind=1`) | y=160, overworld, not underwater, not in lava |
| 20 | Chat bubbles | `v.chatBubbles.draw` :1288 → `chatBillboard` :1565 | lazy `pChat` | |
| 21 | `overlays` | :1289 (`f(gfx,vp,cam,v)`) | Signs and labels: `pChat`. Chest icons, grace and fireflies: their own programs | Signs set `depthMask(true)`. Chest icons use `POLYGON_OFFSET_FILL`. Fireflies: instanced, `blendFunc(ONE,ONE)`, restored to `SRC_ALPHA,ONE_MINUS_SRC_ALPHA` (`pretty/js/fireflies.js:233-244`) |
| 22 | Restore + creative held | :1290-1293, `drawHeld` :2218 | `09-textured` (block) or `08-m-over` (arm) | **End state of `draw`:** `depthMask(true)`, `disable(BLEND)`, `enable(CULL_FACE)`. Then creative `drawHeld`: `clear(DEPTH)` first (:2220), 70° projection |
| 23 | Survival extras | `pretty/js/main.js:959-964` | `CrackRenderer`. Hands: `drawHeld`→`drawHands` :2306 → entity `drawHeld`. `drawFireOverlay` :2078 lazy `pFire` | Crack blend `DST_COLOR,ZERO`. Hands clear depth. Fire overlay: depth off |

**Hand pass and the depth-only clear:** `drawHeld`'s `clear(DEPTH_BUFFER_BIT)` (gfx.js:2220) is the frame's only depth-only clear. In creative it runs inside `draw` (step 22); in survival after `draw`, from main.js:962. It only happens when a hand or held item is drawn: first person with the HUD shown, not on the title screen, in F5 or with F1. So "the scene's depth is complete" is either just before that clear, or the end of the rAF callback when there is none.

**Animated layers** (`animateFire` :1079, called from `draw` :1188 when `v.lit`):
- It animates `gfx.fireLayer` (`fire_0`), the nether portal `ft[189*6]` and the end portal `ft[208*6]` (procedural, `loadStars` :1106).
- New in c111547912: it also animates the four fluid layers `water_still, water_flow, lava_still, lava_flow`. They come from `gfx.fluidLayers` (`{name: layer}`, set in `pretty/js/main.js:369-371` from `eng.texNames.indexOf(name)`).
- Frames are built once by `loadFire(name)` (:1030) from `/assets/block/<name>.png` + `.mcmeta`. It crops each frame to the top-left 16×16 and bleeds colour into transparent texels. For `water_*` it tints by (63,118,228)/255 and forces alpha 170, the same tint `loadTiles` bakes into the static layer.
- `animateLayer(layer, name, key, now)` (:1086) only uploads when the frame index changes. It then calls `activeTexture(TEXTURE0)` and `bindTexture(TEXTURE_2D_ARRAY, tArr)`, and does `texSubImage3D` of all 5 mip levels into that layer. So **anything a mod writes into these layers is overwritten** on the next frame change. `gfx.rgba` (the CPU copy) is not updated.

GL state facts:
- Depth func is `LEQUAL` everywhere except the entity glint pass (`glintPass` `pretty/js/entities/index.js:972`), which sets `EQUAL` (:993) and resets to `LEQUAL` (:997). `depthFunc(LEQUAL)` is set once per frame (`pretty/js/gfx.js:1239`).
- `cullFace` is `BACK` (default) and `frontFace` is never changed. No scissor or stencil.
- `viewport(0,0,w,h)` is the first GL call in every `draw` and the only `viewport` call on the game context. `clear(DEPTH)` on its own happens only in `drawHeld` :2220.

**Texture units** (all `activeTexture` uses, grep-verified):

| Unit | Contents | Users |
|---|---|---|
| 0 | `tArr`: block `TEXTURE_2D_ARRAY` (also re-bound by `animateLayer` on frame changes) | terrain `uTex`, `09`, `11`, `pWall`, entity `uArr` |
| 1 | every `gfx.tex2d()` texture: clouds, sun, moon, water, skins, capes, chat/sign/label canvases, enchant book, chest icons | `05`, `06`, `08`, `pChat`, enchantfx, chesticons |
| 2 | entity atlas `entities.webp` + per-kind skins. Also `CrackRenderer`'s destroy-stage `TEXTURE_2D_ARRAY` | entity `uTex`, crack `uTex` |
| 3 | `items.webp` atlas, particle atlas `particles.webp` | `12-r-u` (`uTex=3`), entity item meshes |
| 4 | enchant glint textures | entity `uGlint` |
| 5 | `fire_1` animated overlay | `pFire` |
| **6 and up** | **Never used** by the game. Nothing goes above `TEXTURE5`, the entity `texture(gl, unit, …)` is only called with 2/3/4, and fireflies bind no texture. `dragonview.js` is a separate context. WebGL2 guarantees at least 16 fragment units | free for mods. Our shader script keeps 6 (shadow map), 7 (block-class row) and, since 1.5.0, 8 (scene colour for the render-scale composite) bound; 9 and up are reserved for its 1.6 work (compat checks that the game stays below 6) |

Caveat: `tex2d` (:903) binds on unit 1 and leaves `ACTIVE_TEXTURE = TEXTURE1`. Async image loads (skins, capes, moon, chat textures) call it between frames. `animateLayer` leaves it at `TEXTURE0` on frames where an animation advanced. Don't assume either.

## 4. Shader programs (`shaders/index.json`)

- `NN` is the link order at startup, captured on the title page by `tools/lib/browser.mjs`.
- Labels come from `labelProgram` there:
  - `terrain` = the VS has `aPos & uvec3`;
  - `sky` = the FS has `uTop, uHor`;
  - `cloud` = the FS has `uTint, uHole`;
  - otherwise the label is the first two distinctive uniform names.
- All `gfx.js` programs go through `prog()` (:856). It compiles, links, introspects `ACTIVE_UNIFORMS` into `{p,u}`, calls `useProgram` and sets sampler units.
- The program list and every captured GLSL source are unchanged in 325afb04b5. (In c111547912 only the seven terrain VSs had changed, by one line, see §5.)

| Program | Draws | Key uniforms / attributes | Created → used (`pretty/js/gfx.js`) |
|---|---|---|---|
| `00-terrain` | unlit opaque | `aPos` uvec3@0, `aInfo` uvec2@1. `uVP, uOrigin, uHeld[8], uHeldN, uTex(0), uFog, uFogR` | `pTerrain[0]` :737 → `pass` :1321 |
| `01-terrain` | unlit cutout (`c.a<0.5` discard) | same | `pTerrain[1]` |
| `02-terrain` | unlit translucent (stained back-face discard, outputs `c.a`) | same | `pTerrain[2]` |
| `03-terrain` | stained-glass depth only (no texture sample) | `VS_TERRAIN` + `FS_STAINED_DEPTH` :281 | `pStainedDepth` :738 → `stainedDepth` :1295 |
| `04-sky` | unlit sky gradient | `uInv, uTop, uHor` | `pSky` :741 → `drawSky` :1344 |
| `05-c-r` | textured billboard (sun, moon) | `aC` vec2. `uVP, uC, uR, uU, uTex(1)` | `pSprite` :742 → `drawSky`, `sprite` :1424 |
| `06-cloud` | world-aligned plane: **clouds and the ocean plane** | `aC`. `uVP, uCam, uY, uSize, uTex(1), uScroll, uTexel, uTint, uHole, uFog, uFogR, uKind` | `pPlane` :743 → `drawPlane` :1437 |
| `07-off-s` | selection box lines | `aP`. `uVP, uOff, uS, uCol` | `pLine` :744 → `drawSel` :1549 |
| `08-m-over` | Steve/player boxes, cape, first-person arm | `aP, aUV, aS`. `uVP, uM, uTex(1), uFog, uFogR, uOver` (hurt tint), `uLight` | `pEnt` :745 → `drawPlayers`, `drawHeld` |
| `09-textured` | creative held block/flat item from the block array | `aP, aUV`(vec3), `aS`. `uMVP, uTex(0)` | `pHeld` :746 → `drawHeld` / `heldVao` :2169 |
| `10-m-color` | cosmetic glow shells | `VS_ENT` + `FS_GLOW`. `uVP, uM, uColor` | `pGlow` :826 → `drawGlow` :1763 |
| `11-r-u` | block-break particles (instanced) | `aC`, `aP`(pos,size), `aT`(u,v,layer,shade). `uVP, uR, uU, uTex(0), uFog, uFogR` | `pPart` :828 → `partPass` :2031 |
| `12-r-u` | atlas particles (items, sparks, smoke, explosion, enchant glyphs) | + `uSz, uTint`, `uTex(3)` | `pIPart` :829 → `partPass` |
| `13-terrain` | **lit** opaque (the one actually used) | `00` + `LIGHTMAP`: `vLight, uSkyLight, uAmbient` | `initLit` :1376 `lit.terrain[0]` → `pass` |
| `14-terrain` | lit cutout | same | `lit.terrain[1]` |
| `15-terrain` | lit translucent | same | `lit.terrain[2]` |
| `16-sky` | lit sky + sunrise/sunset glow | `uInv, uTop, uHor, uGlow, uSide` | `lit.sky` → `drawSkyLit` :1391 |
| `17-rot-b` | stars | `aP`. `uVP, uRot, uB` | `lit.star` → `drawSkyLit` |

- **Why 7 terrain programs:**
  - There is one shared `VS_TERRAIN` (:230). All seven `.vert.glsl` files are byte-identical.
  - `fsTerrain(mode, lit)` (:289) is a template: mode 0 = opaque, 1 = cutout, 2 = translucent.
  - `lit` splices in the `LIGHTMAP` chunk (:270), with `GAMMA.toFixed(2)` inlined as `0.50`.
  - That makes 2 × 3 = 6, plus the depth-only stained-glass program.
- The unlit set (00-02, 04) is compiled eagerly. `S.lit` is set true at boot (`pretty/js/main.js:362`, before `loop.start()` at :449) and never set false in this build, so the unlit set is never drawn with.
- Shared sources: `05` and lazy `pChat` share `VS_SPRITE`. `08` and `10` share `VS_ENT`. `07` and lazy `pPv` share `FS_LINE`. `04` and `16` share `VS_SKY`.
- **Not in `shaders/`** (compiled lazily after startup):
  - Gfx: `pPv` (`VS_PV` :504), `pChat` (:1581), `pFire` (`VS_FIRE` :634), `pWall` (`VS_WALL` :647).
  - The entity renderer: `VS`/`FS` at `pretty/js/entities/index.js:35-82` (bones `uBones[16]` + `gl_InstanceID`, two fixed lights, a `uBlk` array/2D switch, glint, eyes) and the fishing line (:312).
  - `CrackRenderer` (`pretty/js/survival/crack.js:2`), enchantfx (:234), chesticons (:21), grace (:11).
  - Fireflies (`pretty/js/fireflies.js:291-319`, built on the first draw via `gfx.prog`): attributes `aC, aP, aB`, uniforms `uVP, uR, uU, uFar`, no sampler.
  - The entity renderer and crack use their own `program()` (not `gfx.prog`; no `useProgram` after link). Grace, chest icons, enchantfx and fireflies go through `gfx.prog`.
  - Crack and grace VSs also declare an attribute named `aPos` (as `vec3`), so never detect terrain by `aPos` alone.

## 5. Chunk and mesh data

- **Storage:**
  - `gfx.chunks` is a `Map<ci, {cx, cz, ymin, ymax, d, parts:[opaque, cutout, translucent]}>`, with `ci = cz*CN + cx`.
  - A part is `{vao, vbo, n /*quads*/, stained}`.
  - There is one mesh per 16×16 column, full height (`setChunk` :990).
- **Upload:**
  - `remesh(ci)` (`pretty/js/main.js:1261`) calls wasm `mesh_chunk(cx,cz)`.
  - For each part it takes `Uint8Array(mem.buffer, mesh_ptr(i), mesh_n(i)*32)` (or `null` when empty), then calls `gfx.setChunk`.
  - These are views into wasm memory and are overwritten by the next `mesh_chunk`, so a `setChunk` wrapper must copy them to keep them.
  - `setChunk` uploads with `bufferData(STATIC_DRAW)`: the buffer is re-specified on every remesh, and the VAO is created once.
  - `n` is capped at `MAXQ=65536` quads.
  - Every VAO uses the shared `Uint32` quad IBO `gfx.ibo` (65536×6 indices, :747-760). Chunks are drawn with `drawElements(TRIANGLES, n*6, UNSIGNED_INT, 0)`.
- **Vertex = 8 bytes, 4 per quad** (`vertexAttribIPointer` :1011-1013; decoded by the VS at :247-263):

| Bytes | Attr | Bits |
|---|---|---|
| 0-1 | `aPos.x` u16 | 0-8: x in 1/16 block (chunk-local). **9: box-UV half offset (since c111547912, see below).** 10-15: sky light ×4 → `vLight.x` (`(aPos.xz >> 10u) * 0.25`) |
| 2-3 | `aPos.y` u16 | 0-11: y in 1/16 block (≤256 blocks). 12-15: UV mode `r` |
| 4-5 | `aPos.z` u16 | 0-8: z. 10-15: block light ×4 → `vLight.y` |
| 6 | `aInfo.x` u8 | texture-array layer (`vUV.z`). 240-255 = stained glass |
| 7 | `aInfo.y` u8 | bit 0: u corner, bit 1: v corner, bits 2-7: shade/63 → `vShade` (face shade with AO baked in; fluids have no AO, see below) |

  There are **no normals** in the vertex format.

- **UV mode `r`:**
  - 0 = full tile.
  - 1-3 = fixed sub-rects `RECT` (:241): pixel rects 7,6-9,16 / 7,6-9,8 / 7,13-9,15. These are probably the torch side, top and bottom (inferred from the coordinates).
  - 4-9 = box-projected UVs from the in-block position via `BOXUV` (partial blocks, inferred).
  - 10-15 = the same with U mirrored.
- **Bit 9 of `aPos.x`:** in box mode the VS does `if ((aPos.x & 0x200u) != 0u) l.y = (l.y + 8u) & 15u;` (:255). The in-block y used for box UVs shifts by half a block, so the upper half of the texture shows (probably for slabs, inferred).
  - Position decoding (`aPos & uvec3(0x1FFu, 0xFFFu, 0x1FFu)`) is unchanged.
  - Bit 9 of z is never read.
- **Per-chunk uniform:** `uOrigin = (cx*16 − cam.x, −cam.y, cz*16 − cam.z)` (:1338). In the VS: `p = pos/16 + uOrigin` (camera-relative), `vDist = max(length(p.xz), |p.y|)`.
- **Fluid meshing** (research on c111547912, partly re-checked live on 325afb04b5; the mesher is in `engine.wasm`, which changed in 325afb04b5):
  - **Water** is in the translucent part 2, one quad per visible face. A full surface is at 14/16 of the block: the ocean surface is y = 62.875 (re-checked live: every still-water top quad of an ocean chunk at y 62.875, layer `water_still` 10, shade 63). Flowing levels slope down in 1/16 steps.
  - Sloped (flowing) tops use `water_flow` (layer 100), with the UV corner bits rotated in 90° steps so +v points downhill. A shader can read the flow direction from the UV rotation.
  - **Lava** is in the **opaque part 0** (drawn by program 13), not the translucent one: `lava_still` (80) on top, `lava_flow` (101) on the sides. There is no emissive term; its vertices carry block light 15.
  - Fluids have no AO, so their shade identifies the face: 63 top, 50 Z sides, 38 X sides, 32 bottom.
  - Fluid ids and levels: game-core.md §6.
- **Change signals:** none as events. `setChunk` runs after every (re)mesh and `dropChunk(ci)` (:1164) on unload (game-core.md §6). A remesh re-specifies the part's buffer with `bufferData` and keeps the same VAO, so a record keyed on the VAO (like the shader script's shadow records) must take the new quad count from `setChunk` (`parts[i].length / 32`) or the `bufferData` size, not from the next draw of that chunk. The shader script does this with a `bufferData` hook since 1.5.0 (it used to be its issue 51).
- **Scheduling:** `updateChunks(budget)` (`pretty/js/main.js:1222`), with a budget of 5 ms in game and 12 ms while loading:
  - `RemeshSched.run` (`pretty/js/remesh-sched.js:21`) drains wasm `pop_dirty()` into `pending`, now a `Map<ci, firstSeen>`.
  - The instance is `new RemeshSched(4, 250)` (main.js:1221): `cap=4`, `settle=250`. A dirty chunk more than 1 chunk away (Chebyshev) waits 250 ms after it was first queued, so bursts of edits coalesce.
  - It sorts the ready chunks by distance and remeshes at most `cap` per frame while an EMA cost estimate `est` fits the budget.
  - Then it meshes unmeshed chunks in `spiral` order (radius rd+1).
  - Every 1 s it `dropChunk`s columns beyond rd+3 (Chebyshev distance).
- **Atlas:** `setTiles(data, n, ft, kind)` (:917) creates a `TEXTURE_2D_ARRAY` of RGBA8 **16×16×n** with mipmaps, `NEAREST` mag, `NEAREST_MIPMAP_LINEAR` min, `MAX_LEVEL 4`, clamp. It keeps a CPU copy in `gfx.rgba`.
  - Layer i = `eng.texNames[i]` (wasm `tex_names()`), loaded from `/assets/block/<name>.png` by `loadTiles` (`pretty/js/engine.js:91`). There are 256 layers (live on 325afb04b5 and d7bde3deb9). On d7bde3deb9: the names at 103-111 and 181 were empty (no image is loaded, the layer stays transparent), and 240-255 were the 16 stained glasses.
  - `loadTiles` crops to the top-left 16×16 (the first animation frame) and bakes tints (`TINT`: grass, leaves, water).
  - It composites the grass side overlay and forces water alpha to 170. For `CUTOUT`-regex names it binarizes alpha (≥26) and bleeds colour into transparent texels.
  - **Block → layer:** `ft[id*6+face]` (Uint8). Since 325afb04b5 the wasm exports `id_top`, and `ft`/`kind` are copied whole from its tables for every id below `idTop` (32768 live), variants included. The older path, 256 base ids plus the listed variants from `tex_full`, is a fallback. Look variants up directly; don't reduce them with `& 255`.
    - Face 2 = bottom, 3 = top, 0/1 = X sides, 4/5 = Z sides. On build d7bde3deb9, grass was side,side,dirt,top,side,side live, and grass bursts use face 2 = dirt (`pretty/js/main.js:1369`).
    - The −X,+X / −Z,+Z sign order within the pairs is inferred from `FC` (:31).
  - `kind[id]` = `K` enum (AIR 0, SOLID 1, LEAVES 2, GLASS 3, WATER 4, PLANT 5, LAVA 6).
  - Animated layers: fire (`gfx.fireLayer`, set in `pretty/js/survival/entities.js:521`), nether portal, end portal, and the four fluid layers (§3, "Animated layers").

## 6. Particles, entities, held items (brief)

- **Particle lists:**
  - `gfx.parts` (≤2048), `iparts` (≤256), `xparts` (≤512), `sparks` (≤1024, pushed by survival/end.js and eyes.js), `smoke` (pushed by fluids.js and eyes.js up to 256, fishing.js up to 512).
  - gfx fills the first three with `burst` (:1839), `itemBurst` (:1883) and `explosion` (:1923).
  - Each `partPass` draws at most `MAXP`=2048. Physics runs in `tickParticles` (:1948).
  - **Particle atlas** `/assets/atlas/particles.json` + `.webp` (unchanged in 325afb04b5), loaded lazily by `particleAtlas()` (:1928) into `gfx.patlas = {img, tex, rects}`. Its 73 entries include `bubble`, `splash_0..3`, `drip_hang`, `drip_fall`, `drip_land`, `lava`, `flame`, `generic_0..7`, `explosion_0..15`, `sweep_0..7`, `glint`, `heart`, `critical_hit`, `enchanted_hit`, `damage` and the enchant glyphs `sga_a..z`.
  - Nothing spawns particles when you enter water. `bubble` and `splash_*` are used only by the fishing bobber (survival/fishing.js).
  - All share one instanced VAO `vPart` and `partData` (8 floats per particle), uploaded with `bufferSubData` on each `partPass`.
- **Fireflies** (`pretty/js/fireflies.js`):
  - They are not particles. They keep their own list (`MAX=48`) and a 50 ms tick.
  - They draw in `overlays` with their own instanced VAO and buffer (`bufferSubData` each draw).
  - Gating (`pretty/js/main.js:921-928`): on when `S.fireflies` (default true; no UI toggle, and the exported `KEY = "mc.fireflies"` is never read), `S.lit`, not in a wall, and in the survival overworld. In creative they only show with the DEV-only `S.litTest`.
- **The entity renderer** is created lazily by `gfx.entities()` (:1803), a stub until `/assets/atlas/entities.webp` and `items.webp` load.
  - It lives at `gfx.ents`: `{draw, drawHeld, drawArmor, drawFire, kinds, stats{drawn,calls,culled,ms}, items{tex,rects,img}, setSkin, skins, bones, atlas, dragonPose}` (`pretty/js/entities/index.js:1031`). Since 325afb04b5 it decides "block or item mesh" with `isBlock(id)` instead of `id < 256`.
  - `gfx.ents` does not exist until something needs it. It was absent on the title screen when checked live on build d7bde3deb9.
  - Vertex: `aP, aT`(uv,layer), `aN`, `aB` (bone index in the low 4 bits, tint flag in bit 4), stride 40.
  - Bones go in `uBones[16]` per draw. Copies are drawn instanced, offset by `gl_InstanceID`.
  - Per-entity light is computed on the CPU (`lightmap(...)`, `pretty/js/survival/entities.js:564`) and passed as `uLight`.
  - New kinds (proto `ENT_KIND` 30-32): `tnt` (an item mesh that swells and flashes `uOver` near the end of its fuse), `armor_stand` (worn armour, `STAND_POSES`) and `item_frame`.
- **Hands:** `drawHeld` (:2218) uses `H` (hand.js) for swing/equip, and `firstPerson()` (item3d.js) for survival hands. `fit` (:2301) shifts x when the aspect ratio is below 16:9. It has its own `perspective(70°, aspect, 0.05, 10)`.

## 7. Lighting, fog, sky, time of day

- **Time:**
  - Creative: `S.time = CREATIVE_NOON = 6000`, fixed (`pretty/js/main.js:103,363`).
  - Survival: `survival.timeTicks(now)` (`pretty/js/survival/client.js:195`) = server time + elapsed/50, or `sv.fixedTime`. `DAY = 24000`.
  - Clouds scroll with `v.clouds ?? v.time` (creative: `now/50`, `pretty/js/main.js:955`). `uScroll = t*0.075`.
- **`skyAt(time, yaw, pitch, camY, rd)`** (:347) returns `{c, s, sky, fog, glow, side, dark, skyLight, stars, cloud, water, phase}`:
  - `g = frac(time/DAY − 0.25)`, `ang = g + ((1−cos πg)/2 − g)/3`, `c,s = cos/sin(2π·ang)`, `day = clamp01(2c + 0.5)`.
  - Sky top = `SKY·day`.
  - Fog colour = `FOG` dimmed by `day`. It is blended toward the sunrise glow when facing the sun (rd ≥ 4) and toward the sky colour by rd, and darkened below y=32 (`dark`).
  - `skyLight` = the bluish night/day brightness → terrain `uSkyLight`.
  - `glow` is set when |c| ≤ 0.4 (sunrise/sunset) → `16-sky` `uGlow`, `uSide`.
- **Sun/moon direction:**
  - Lit: the sun sprite is at `(−s, c, 0)·100` and the moon at `(s, −c, 0)·100` (:1418-1420), so the sun moves in the X-Y plane. A mod can read `gfx.env.c/.s`.
  - Unlit: a constant `SUN = norm(0.62, 0.6, −0.5)` (:17).
  - Moon phase = `floor(time/DAY) % 8`. Textures are `/assets/env/moon/<name>.png`, with names from `MOON` (:21: `full_moon` … `waxing_gibbous`), loaded in `initLit`.
  - Stars: `starQuads` (:406) with Minecraft RNG seed 10842, rotated by `uRot`, brightness `uB = env.stars`.
- **Dimensions** (`dimSky` :390, `DIM_SKY` :386): a fixed noon env.
  - Nether: fog `(0.2,0.03,0.03)`, `uAmbient = 0.1`.
  - End: clear colour, fog and `skyLight` overridden.
  - Neither draws the sky, the ocean plane or the clouds.
- **Fog** (`draw` :1198-1209), uniforms `uFog` (colour) and `uFogR` (start, end), linear on `max(len(xz), |y|)`. Priority: lava, then underwater, then nether, then overworld.
  - **In lava:** colour `LAVA_FOG = (0.6, 0.1, 0)` (:16), start 0.25, end 1.
    - `v.lava` is `eng.st[11] > 0` (eye in lava) in first person, or `lavaAt(cam)` in F5 (`pretty/js/main.js:939`, `lavaAt` :1049).
    - Like underwater, lava skips the sky, the clouds and the dimension clear colour (:1231-1237, :1286), and it disables the nether fog.
  - Underwater: 0..14, colour `UNDER·dark`. `v.under` is `eng.st[10] > 0` in first person, or `waterAt(cam)` in F5 (main.js:938, :1056).
  - Nether: end = `netherFogEnd(rd)` = min(rd·16, 192)/2, start = rd·0.8.
  - Overworld: end = rd·16 − 4, start = 0.55·end.
  - Clouds use fogEnd·1.2 .. far·0.9 and fade alpha instead of colour.
  - Far plane = max(320, rd·40), near = 0.05.
  - **`uFogR` signatures:** every lit pass that fogs (terrain, players, particles, ocean) gets `uniform2f(uFogR, start, end)`. Underwater it is exactly **(0, 14)** and in lava exactly **(0.25, 1)**. No other state sends those values: overworld ends at ≥ 60 (rd 4) with start 0.55·end, nether at ≥ 32 with start rd·0.8, clouds use 1.2·fogEnd, and `drawHeld` sends (1e9, 2e9). So a `uniform2f` wrapper (or the terrain FS itself) can tell "camera in water" and "camera in lava" from `uFogR`. On `drawWall` frames nothing sends it (the early return comes first).
- **Lightmap:** GLSL `lightmap(vLight)` (`LIGHTMAP` :270).
  - Block light gets warm curves and sky light × `uSkyLight`, with a gamma lift (`GAMMA=0.5`) and the 0.96x + 0.03 remap.
  - The JS twin `lightmap(sky, blk, skyLight)` (:397) is used for entities, enchant books, chest icons and the ocean tint (`env.water`). A GLSL change will not reach those unless you also wrap the JS callers.
- **Held lights:**
  - `HL.lights` is set every frame in `render` (`pretty/js/main.js:845`, toggle `mc.heldLight`). `nearest` keeps 8.
  - `draw` packs them camera-relative into `gfx.heldBuf` (:1220-1230). `pass` uploads them as `uHeld[0]` with `uniform4fv`, plus `uHeldN` (0 when unlit).
  - The VS raises `vLight.y` to at least `level − manhattan distance` per vertex (`max`, :264-268), looping up to `uHeldN` (≤8).

## 8. Extension points for userscripts

**Reaching the renderer**
- **Module import:** `await import('/js/gfx.js')` from the page context returns the game's own live module instance.
  - Module identity is per URL, and main.js imports the unversioned `./gfx.js` (`raw/js/main.js`).
  - Probe-verified on build d7bde3deb9: a function pushed into the imported `overlays` is called every frame with the game's `gfx`, and a `Gfx.prototype.draw` wrapper installed after boot takes effect.
  - This gives `Gfx.prototype`, which you can patch: `draw, pass, prog, setChunk, setTiles, drawPlane, drawSkyLit, initLit, stainedDepth, partPass, drawHeld, drawPlayers, tex2d, animateFire, animateLayer, loadFire`.
  - It also gives the `overlays` / `solidOverlays` arrays to push into, and the helpers `playerView, perspective, mul, lightmap`.
  - The same works for `/js/remesh-sched.js` and `/js/held-light.js` (mutable `HL`).
    - `RemeshSched.prototype.run/fits/timed` can be wrapped. `cap` and `settle` are instance fields: read them as `this.cap`/`this.settle` inside a wrapper.
  - `/js/frameloop.js` exports `backingDpr` and `MAX_PX`, but main.js holds the loop object privately.
  - You cannot reassign exports (live bindings are read-only).
- **The instance:** `this` inside any patched prototype method. Useful fields:
  - `gl, chunks, vp, env, w, h`
  - `tArr, ibo, vQuad, vEmpty`
  - `pTerrain, lit{terrain[3], sky, star, stars, nStars, moon[]}` and the other `p*` programs (`{p, u}`)
  - `heldBuf/heldN, chatPlanes` (frustum), `ft, kind, rgba, world`, `fluidLayers` (`{water_still, water_flow, lava_still, lava_flow}` → layer)
  - set lazily: `ents` (entity renderer), `patlas` (particle atlas), `fireLayer` (survival only, `pretty/js/survival/entities.js:521`), `pPv`, `pChat`, `pFire`, `pWall`, and the animation states `fireAnim, portalAnim, starAnim, water_stillAnim…` (`{frames, order, total, start, index}`)
  - `window.__mc.gfx` exists only on DEV hosts (`pretty/js/main.js:3281`, `devhost.js`).
- **Overlay callbacks** (`pretty/js/gfx.js:11-12`):
  - `solidOverlays`: `f(gfx, vp, cam, v, fog, fogStart, fogEnd)`, called after opaque terrain and entities with depth write on and blend off.
  - `overlays`: `f(gfx, vp, cam, v)`, called after clouds with blend on, `depthMask` false and cull off.
  - This is the cleanest way to add world-space geometry. Restore the GL state you change, and don't assume which program or VAO is bound when your callback runs (fireflies, for one, leave their own program bound).

**Observable through `WebGL2RenderingContext.prototype` wrappers**
- **`getContext`:** the game context belongs to `canvas#gl`. `dragonview.js` creates other webgl2 contexts, so filter on `gl.canvas.id === 'gl'`.
- **`shaderSource`:** every program passes through it (gfx `prog`, entity `program`, crack, fireflies). Detect by stable tokens:
  - terrain: `aPos & uvec3`
  - lit terrain: `uSkyLight`
  - cutout: `c.a < 0.5) discard` plus `vShade`. The discard alone also matches the `09`, `11` and `12` FSs; `vShade` is only in terrain FSs.
  - translucent: `w2b-glass`
  - sky: `uTop, uHor`
  - cloud/ocean: `uTint, uHole`
  - entity: `uBones[`
  - fireflies: `uFar` (grep: only fireflies.js uses it)
- **`linkProgram` / `useProgram`:** tag programs with a kind. `prog()` calls `useProgram` right after link and sets its own samplers (:876-877), so add your sampler `uniform1i` there.
- **Uniform calls:**
  - `uniform3f(uOrigin)` comes right before every chunk `drawElements` and gives the chunk origin.
  - `uniform3fv(uCam)` on `06-cloud` = the **world camera position**. It is only sent on frames where the ocean plane (overworld, near the world edge) or the clouds (overworld, not underwater or in lava) draw, and never in other dimensions.
  - `uniformMatrix4fv(uVP)` = the camera-relative VP.
  - `uniform2f(uFogR)` = (0, 14) underwater and (0.25, 1) in lava, values no other state sends (§7).
- **`texSubImage3D` on `TEXTURE_2D_ARRAY`:** on the game context this is the animated layers (§3, "Animated layers"). The crack renderer uploads into its own array on unit 2.
- **Frame markers:**
  - Start: `viewport(0,0,w,h)` then `clear(COLOR|DEPTH)`. `animateLayer` uploads can fall between the two. Both happen exactly once per frame (live), and `viewport` is the only one on the game context, so its `w,h` (= `glCanvas.width/height`) is the frame's size.
  - Scene depth complete: just before `clear(DEPTH_BUFFER_BIT)` alone (`drawHeld`, §3 "Hand pass"). That clear only happens when a held item or hand is drawn (first person with the HUD shown). On the title screen, in F5 or with F1 there is none.
  - There is no explicit end. The last GL calls of a frame are in `render` (`pretty/js/main.js:959-964`). The rAF callback is frameloop's `step`, which re-arms rAF first and looks up `requestAnimationFrame` on every call, so a wrapper installed at document-start sees one callback per frame. Work queued from that wrapper (or after the game's callback returns) runs after the whole frame, HUD included.
  - The game's own frame timing (new in 325afb04b5): `frame()` measures the rAF interval and the time spent in its callback, averaged per second (`gpu.frameMs`/`jsMs`, shown on F3), but keeps them module-local (game-core.md §4).
- **`bindFramebuffer`:** never called by the game. An FBO you bind at frame start stays bound through every game draw.
- **Canvas reallocation (new in 325afb04b5):** when in-world FPS stays at 1/1.8 of its usual value or below for 4 s, `regainCanvases()` sets `glCanvas.width` to 1 or 2 and back (up to 3 times per page, at most every 20 s). The drawing buffer is reallocated at the same size, and the context and its resources survive. A lost context reloads the page after 3 s. Anything sized from the canvas (an FBO, say) should compare against `v.w/v.h` or the viewport each frame instead of caching the size (game-core.md §4).

**What each enables**
- **Post-processing:** bind your FBO at `viewport`/first clear, grab depth before `drawHeld`'s depth clear, then composite to `null`. The HUD is unaffected (separate canvas).
- **Shadow maps:** re-draw the `gfx.chunks` part VAOs from the sun (`gfx.env.c/s`) with a depth-only program.
  - It must declare `layout(location=0) in uvec3 aPos; layout(location=1) in uvec2 aInfo;` and add `uOrigin` itself.
  - The vertex positions are chunk-local (1/16 block, mask x/z with `0x1FF`: bit 9 is now a UV flag). The game's `uOrigin` (chunk origin − cam) is what makes them camera-relative.
- **Per-block GLSL effects** (waving plants, water): key on `aInfo.x` (layer).
  - Layer → name needs `texNames`, which is not on `gfx`. Options:
    - Call wasm `tex_names()` via a `WebAssembly.instantiate` hook (see game-core.md).
    - Record `/assets/block/<name>.png` `src` assignments during `loadTiles` and map them **by name**. The `src`s are set synchronously in layer order (`loadTiles` maps names to `loadImage`, engine.js:92). But empty layers (103-111 and 181 on build d7bde3deb9) load nothing, so a running count drifts from the layer index. `block/dirt.png` is also loaded earlier in boot, and `loadFire` later loads `fire_0`, the fluid PNGs and `.mcmeta` files.
    - Read `gfx.fluidLayers` for the four fluid layers.
    - Classify by `gfx.rgba`.
  - `gfx.ft/kind` map block ids to layers.
  - Water and lava texels change every animation frame, so a texture-based effect must not rely on a one-time read of those layers.
- **Performance:**
  - wrap `pass` (skip, reorder, LOD);
  - skip `drawPlane(1)` clouds;
  - tune `RemeshSched` (`this.cap`, `this.settle`, the budget via `fits`);
  - use `bufferSubData` in `setChunk`;
  - lower the GL canvas resolution. `resize` rewrites `#gl` width/height at the start of the frame after any window resize, fullscreen change or visualViewport resize (and after `regainCanvases`), so re-apply it. Shrinking the canvas also shrinks `gfx.project` (nametags) and the CSS-scaled image; rendering into a smaller FBO and compositing to the full-size canvas keeps them.

**Risks / fragile points**
- `prog()` throws on compile/link failure (:862, :869).
  - In the constructor, boot's `catch` shows **"This game needs WebGL 2"** (`pretty/js/main.js:328-332`).
  - In lazy `initLit`, the throw happens inside `draw` on every frame. The loop survives because `step` re-arms rAF before calling `frame` (`pretty/js/frameloop.js:4-8`), but the rest of every frame is skipped.
  - Always fall back to the original source.
- A new sampler defaults to unit 0. Terrain, `09` and `11` already have a `sampler2DArray` there, so a new `sampler2D` on unit 0 is a type conflict: `INVALID_OPERATION`, and the draw is dropped. Set new samplers explicitly to 6/7.
- Units 6/7 are free. Still restore `ACTIVE_TEXTURE` after binding: neither `tex2d` (unit 1) nor `animateLayer` (unit 0) restores it. Never sample a texture attached to the current draw FBO (feedback-loop error).
- Patches must match lazily compiled programs too, or skip them safely. Shared sources (`VS_SPRITE`, `VS_ENT`, `FS_LINE`) mean a VS-only match hits several programs.
- In `gfx.prog` the uniform map key for the array is `u["uHeld[0]"]`; the entity `program` strips `[0]`.
- `v.wall` (camera inside a solid block) takes the early return and nothing else draws. `animateFire` still runs before it.
- Stained-glass behaviour hard-codes layers ≥240 (the FS, the `setChunk` scan :1020, and `03`). More than 65536 quads per part are silently truncated.
- Constructor programs compile at `new Gfx` (`pretty/js/main.js:329`), before most scripts could patch prototypes, so GLSL must be patched at document-start via `shaderSource`. Lit terrain (13-17) compiles on the first lit `draw`.
- The terrain VS gained a line inside the `if (r >= 4u)` box-UV block in c111547912 (unchanged since). Regexes that span that block need re-checking on every build.
- `drawWall` (:2148) now takes the layer from `ft[baseOf(id)*6]`, so variants and wide ids show their base block's texture.

## 9. Performance notes

- **Draw calls:**
  - Terrain is ≤3 draws per visible chunk, plus 1 stained-depth draw when a chunk has stained glass. Each is `uniform3f` + `bindVertexArray` + `drawElements`, with no instancing or multi-draw.
  - At rd 12 (spiral radius 13, 577 columns meshed) roughly 150-250 chunks survive culling, i.e. ~300-700 terrain draws (inferred estimate). Live at rd 8 on the title screen: about 180 `drawElements` and 7 `useProgram` per frame (§1).
  - The program changes only per pass. Each chunk part costs 3 GL calls (`uniform3f(uOrigin)` + `bindVertexArray` + `drawElements`).
- **Sorting/overdraw:**
  - Opaque is near→far (helps early-Z). Cutout uses `discard`.
  - Translucent is sorted per chunk only, not per face, and drawn with **cull off**.
  - The sky is a fullscreen triangle every frame before terrain (full fill).
  - Clouds are one `far`-sized blended quad over the whole sky (big fill when looking up). The ocean plane does the same near world edges.
  - Glow shells are additive and double-shelled. Fireflies are additive but tiny (≤48 instanced quads).
- **Shader cost is low:**
  - terrain VS: a held-light loop of up to 8 iterations per vertex (stops at `uHeldN`)
  - terrain FS: one `sampler2DArray` fetch (`NEAREST_MIPMAP_LINEAR`) + `lightmap` (~25 ALU) + a linear fog mix, about 30 ALU per pixel. `14` discards at `c.a < 0.5`; `15` blends with cull off and `depthMask(false)`
  - Any per-pixel shadow/lighting a mod adds will dominate.
  - **Varyings:** no game shader uses a `flat` varying (checked in every `shaders/*.glsl` of 575c9209bc). Adding one is not free on this laptop: on ANGLE D3D11 / UHD 620 at rd 12, a single `flat` float in the terrain programs cost about 2.3-3 GPU ms per frame, a per-primitive cost that grows with the chunk count. Real GPU, measured by the Shaders 1.5 team (LAB2) with `npm run bench`; the likely cause is ANGLE's provoking-vertex emulation (GL takes flat values from the last vertex, D3D11 from the first), which adds a geometry shader to such programs (inferred). A value that is constant across a quad can ride in a smooth varying and be rounded in the FS.
  - No MSAA, no anisotropic filtering, no extensions.
- **Resolution:**
  - The GL canvas is `round(innerWidth·dpr) × round(innerHeight·dpr)` (`resize` `pretty/js/main.js:490`). The game has no render-scale setting.
  - `dpr = backingDpr(devicePixelRatio, innerWidth, innerHeight)` (`pretty/js/frameloop.js:24`): min(devicePixelRatio, 2), lowered (to no less than 0.5) whenever the backing store would exceed `MAX_PX = 3840×2160` pixels.
  - It is divided by `max(8, round(min(w,h)/40))` (class `.pix`) while the claim/verify/pending screens are up.
  - Resize triggers: window `resize`, `fullscreenchange` (plus a 300 ms retry), `visualViewport` `resize`, a pixelated menu opening or closing, and (new) `regainCanvases` and a 2D canvas `contextrestored`.
  - DPR 2 means 4× the fragments, which is probably the biggest single lever (inferred).
- **Per-frame JS allocations:**
  - `mul/rotX/rotY/translate/perspective` allocate a new `Float32Array(16)` per call (about 40 per player per frame in `drawPlayers`).
  - `skyAt` objects/arrays, `invert(vp)`, the `vis` array, and the `animateFire` fluid-name array literal.
  - `render`'s players array and `gfx.skin()` string keys.
  - The entity renderer reuses `BONES`.
- **CPU per frame (main thread):** meshing is synchronous wasm, up to 5 ms per frame while playing (12 ms while loading). Culling is a column AABB test plus one sort. The full-resolution 2D `#hud` canvas is cleared and redrawn every frame. Such frames are CPU-bound, and no resolution change helps them.
- **Uploads:**
  - Remesh = a full `bufferData` re-specification, plus a CPU scan of the translucent part for stained layers. Up to 4 dirty chunks plus new chunks per frame in 5 ms, and far dirty chunks wait 250 ms (`settle`).
  - `texSubImage3D` of 5 mip levels for each animated layer when its frame changes: now up to 7 layers (fire, 2 portals, 4 fluids), at each texture's `.mcmeta` frame time.
  - Particles: up to 5 `bufferSubData` calls per frame (one per list), plus enchant glyphs (enchantfx reuses `gfx.partPass` with its own buffer), the enchant books and fireflies (one `bufferSubData`). The grace border and fishing line use `bufferData` each frame.
- **Sync queries:** `CrackRenderer.draw` makes 9 `getParameter` + 3 `isEnabled` calls per frame while mining (`pretty/js/survival/crack.js:126-138`), grace makes 7 `getParameter` calls, and `drawGlow` 2 `isEnabled` calls. There is no `readPixels`/`getError` on the game canvas in prod paths. They only appear in `entities/debug.js` (TEST), and `dragonview.js:258` exposes `getError` for its own context.
- **Culling:** CPU only (distance + frustum AABB per chunk, sphere tests for entities/players). No occlusion queries.
