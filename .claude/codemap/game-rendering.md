# Game rendering (WebGL2)

Verified against game build d7bde3deb9 on 2026-11-01 (the same game code as builds b4bc035ec8 and 26479914e5, which were hashed over fewer files). Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build d7bde3deb9's `pretty/`. "(inferred)" = not directly verified in code.

## 1. Overview

- One WebGL2 context on `<canvas id="gl">`, created in `Gfx` constructor `pretty/js/gfx.js:721` with `antialias:false, alpha:false, depth:true, powerPreference:"high-performance"`. No stencil, no preserveDrawingBuffer (live `getContextAttributes()` confirms). The game never creates a framebuffer or renderbuffer and never calls `getExtension`. Everything draws into the default framebuffer.
- `frame()` `pretty/js/main.js:510` (rAF) runs 20 Hz ticks once `S.started` (`TICK=0.05`, which also calls `gfx.tickParticles`), then `updateChunks()` (wasm meshing, 5 ms budget in game, 12 ms otherwise, :1089), then `render()` :709. `render` builds a view object `v` and calls `gfx.draw(v)` :820.
- `Gfx.draw` `pretty/js/gfx.js:1170`, in order: clear to fog colour, sky, opaque + cutout terrain (one draw per chunk), players/entities/particles/selection/undo preview, `solidOverlays`, then blending on: ocean plane, translucent terrain, stained-glass depth, clouds, chat bubbles, `overlays`, creative held item.
- After `gfx.draw` returns, survival draws the mining crack, the first-person hands (after a depth clear) and the burning overlay (`pretty/js/main.js:845-850`).
- HUD (`#hud`) and inventory (`#inv`) are separate 2D canvases on top, and menus are DOM (`#screen`). They are not in the GL frame, so post-processing the GL canvas leaves the HUD untouched.
- World rendering is camera-relative. `uVP` = perspective × rotation only (`playerView` `pretty/js/gfx.js:197`). Per-chunk `uOrigin = chunkOrigin − cam`.
- Lighting is Minecraft-style: the wasm mesher bakes sky/block light levels and a face shade into each vertex, and the GLSL `lightmap()` turns them into colour using day brightness `uSkyLight`. Fog is linear and cylindrical. There are no normals, no sun shading and no shadows on terrain.

## 2. Modules (rendering-related)

| Module | Responsibility | Key exports | Imported by |
|---|---|---|---|
| `js/gfx.js` | Renderer `class Gfx`, matrix helpers, sky/day maths, all core GLSL | `Gfx, lightmap, overlays, solidOverlays, playerView, playerVisible, perspective, mul, rotX/Y/Z, scale, translate, angDiff` | main.js (`Gfx, angDiff, playerView, playerVisible`), net.js (`angDiff`), signs.js, survival/chestlabels.js, survival/grace.js (`overlays`), survival/client.js (`overlays, solidOverlays`), survival/{enchantfx,chesticons,entities,equipment}.js (`lightmap`) |
| `js/engine.js` | Loads `engine.wasm` (world, mesher, lighting). Loads, tints and alpha-fixes block tiles | `loadEngine, loadTiles, loadImage, K, B, withVariants` | main.js, inventory.js, survival/{crack,fluids,gear,items,screens}.js |
| `js/view.js` | Render-distance steps, nether fog | `RDS=[4,6,8,10,12], renderDistance, netherFogEnd, GHAST_FOG_MARGIN` | gfx.js, main.js, survival/terrain.js |
| `js/held-light.js` | Dynamic hand-held lights (≤8) | `HL {on, lights}, HELD_LEVEL, heldLevel, nearest, withHeld, heldAt, falloff, MAX_LIGHTS, K_SOLID, eyeInWall` | gfx.js (`HL`), main.js, survival/entities.js, survival/equipment.js |
| `js/remesh-sched.js` | Budgeted dirty-chunk remesh queue | `RemeshSched` | main.js |
| `js/item3d.js` | Item display transforms, first-person item pose | `mat, T, R, S, display, DISPLAY, firstPerson, armHold, bowFrame, POSE` | gfx.js, entities/index.js, entities/mesh.js, survival/equipment.js |
| `js/hand.js` | First-person hand swing/equip state, hurt/death view roll | `H, OFF, ROLL, viewRoll, swingAt, tickHand, snapHand…` | main.js, state.js, survival/equipment.js, survival/hud.js |
| `js/entities/index.js` | Entity renderer: mobs, dropped items, armour, held items (3rd and 1st person), fire, xp orbs, fishing line | `createEntityRenderer, loadEntityAssets` | gfx.js (dynamic `import()` `pretty/js/gfx.js:1786`), dragonview.js |
| `js/entities/{mesh,models,anim,skin}.js` | Geometry builders, model defs (`MAX_BONES=16`), animation families, dragon skins | `buildKind, poseBones, KINDS, MODELS, FAMILIES…` | entities/index.js, dragonview.js, survival/end.js |
| `js/survival/crack.js` | Block-breaking crack overlay | `CrackRenderer` | survival/client.js |
| `js/survival/enchantfx.js` | Enchanting-table books and glyph particles (a `solidOverlays` callback) | `EnchantFxClient`, book helpers | survival/client.js |
| `js/survival/fluids.js` | Bucket/fire logic. Its only rendering is pushing smoke into `gfx.smoke` (`onSound` :105) | `FluidsClient, inGrace` | survival/client.js, survival/life.js |
| `signs.js`, `survival/chestlabels.js`, `survival/chesticons.js`, `survival/grace.js`, `chat-bubbles.js` | World-space billboards/overlays (`overlays` callbacks, plus `chatBubbles.draw`) | `SignsClient`, `ChestLabelsClient`, `ChestIconsClient`, `GraceClient`, `ChatBubbles` | main.js / survival/client.js |
| `js/dragonview.js` | Its **own** WebGL2 context (`alpha/antialias:true`) for dragon previews. Not the game canvas | `dragonView` | dragon-sponsor-preview.js, survival/end.js (dynamic) |

## 3. Frame pipeline

| # | Step | Code | Program | State / notes |
|---|---|---|---|---|
| 0 | Ticks, chunk meshing, camera, players list | `pretty/js/main.js:510-533`, `render` :709, `playerView` :762 | – | `viewRoll` (hand.js, survival only, :761) feeds `roll` |
| 1 | Viewport. Lit programs compiled once. Animated tiles | `draw` `pretty/js/gfx.js:1174-1176`, `initLit` :1353, `animateFire` :1069 | – | `animateLayer` uploads all 5 mips with `texSubImage3D` on `tArr` when the frame index changes |
| 2 | Environment (sky/fog/time) | `skyAt` :344 / `dimSky` :387 → `this.env` | – | see §7 |
| 3 | Eye inside a solid block | `drawWall` :2128 → **return** | lazy `pWall` | skips everything else |
| 4 | Clear | :1211-1213 | – | clear colour = fog (End: `env.clear`), colour + depth |
| 5 | Sky (overworld, not underwater) | `drawSkyLit` :1371 (unlit: `drawSky` :1324) | `16-sky` (`04-sky`), stars `17-rot-b`, sun/moon `05-c-r` via `sprite` :1404 | depth test off, cull off. Fullscreen triangle from `gl_VertexID` (`vEmpty`), z=0.999. Stars/sun/moon additive `SRC_ALPHA,ONE` |
| 6 | Chunk cull + sort | :1222-1236 | – | distance ≤ fogEnd+24, frustum AABB `boxVisible` :192, sorted near→far. Just before (:1218-1221): `DEPTH_TEST` on with `LEQUAL`, `CULL_FACE` on, blend off |
| 7 | Opaque terrain | `pass(pt[0])` :1240 → `pass` :1301 | `13-terrain` (unlit `00`) | `tArr` on unit 0. One `drawElements` per chunk |
| 8 | Cutout terrain | `pass(pt[1])` :1241 | `14-terrain` (`01`) | alpha test `a<0.5` |
| 9 | Players | `drawPlayers` :1587 | `08-m-over`. Glow `10-m-color` (`drawGlow` :1743) | 6 part draws + cape per player. Armour/held/fire go to the entity renderer. Glow: `cullFace(FRONT)`, `ONE,ONE` |
| 10 | Mobs, items, xp, bobbers | `drawEntities` :1806 → `ents.draw` `pretty/js/entities/index.js:769` | entity program (lazy) | xp orbs blended; fishing line has its own program |
| 11 | Particles | `drawParticles` :1994, `partPass` :2011 | `11-r-u` (block bits), `12-r-u` (items/sparks/smoke/explosions) | instanced, cull off during the draw |
| 12 | Block outline | `drawSel` :1529 | `07-off-s` | `LINES`, blended |
| 13 | Undo preview | `drawPreview` :1500 | lazy `pPv` | |
| 14 | `solidOverlays` | :1254 (`f(gfx,vp,cam,v,fog,fs,fe)`) | enchantfx own program + `12-r-u` | depth write on, blend off |
| 15 | → transparent state | :1255-1258 | – | blend `SRC_ALPHA,ONE_MINUS_SRC_ALPHA`, `depthMask(false)`, **cull off** |
| 16 | Ocean beyond world edge | `drawPlane(0)` :1261 / :1417 | `06-cloud` (`uKind=0`, water texture) | only within fogEnd+16 of the world edge, overworld. `uHole` discards inside the world |
| 17 | Translucent terrain | `pass(pt[2], vis.reverse())` :1264 | `15-terrain` (`02`) | far→near per chunk, both faces drawn |
| 18 | Stained-glass depth | `stainedDepth` :1275 | `03-terrain` | colour mask off, depth write on, layers ≥240 front faces |
| 19 | Clouds | `drawPlane(1)` :1267 | `06-cloud` (`uKind=1`) | y=160, overworld, not underwater |
| 20 | Chat bubbles | `v.chatBubbles.draw` :1268 → `chatBillboard` :1545 | lazy `pChat` | |
| 21 | `overlays` | :1269 (`f(gfx,vp,cam,v)`) | signs/labels: `pChat`. Chest icons and grace: own programs | signs set `depthMask(true)`. Chest icons use `POLYGON_OFFSET_FILL` |
| 22 | Restore + creative held | :1270-1273, `drawHeld` :2198 | `09-textured` (block) or `08-m-over` (arm) | `clear(DEPTH)` first, 70° projection |
| 23 | Survival extras | `pretty/js/main.js:845-850` | `CrackRenderer`. Hands: `drawHeld`→`drawHands` :2286 → entity `drawHeld`. `drawFireOverlay` :2058 lazy `pFire` | crack blend `DST_COLOR,ZERO`. Hands clear depth. Fire overlay: depth off |

GL state facts: depth func `LEQUAL` everywhere, except the entity glint pass (`glintPass` `pretty/js/entities/index.js:851`), which sets `EQUAL` (:872) and resets to `LEQUAL` (:876). `depthFunc(LEQUAL)` is set once per frame (`pretty/js/gfx.js:1219`). `cullFace` is `BACK` (default) and `frontFace` is never changed. No scissor or stencil. `viewport(0,0,w,h)` is the first GL call in every `draw`. `clear(DEPTH)` on its own happens only in `drawHeld` :2200.

**Texture units** (all `activeTexture` uses, grep-verified):

| Unit | Contents | Users |
|---|---|---|
| 0 | `tArr`: block `TEXTURE_2D_ARRAY` | terrain `uTex`, `09`, `11`, `pWall`, entity `uArr` |
| 1 | every `gfx.tex2d()` texture: clouds, sun, moon, water, skins, capes, chat/sign/label canvases, enchant book, chest icons | `05`, `06`, `08`, `pChat`, enchantfx, chesticons |
| 2 | entity atlas `entities.webp` + per-kind skins. Also `CrackRenderer`'s destroy-stage `TEXTURE_2D_ARRAY` | entity `uTex`, crack `uTex` |
| 3 | `items.webp` atlas, particle atlas `particles.webp` | `12-r-u` (`uTex=3`), entity item meshes |
| 4 | enchant glint textures | entity `uGlint` |
| 5 | `fire_1` animated overlay | `pFire` |
| **6 and up** | **never used** by the game (nothing above `TEXTURE5`, and the entity `texture(gl, unit, …)` is only called with 2/3/4). `dragonview.js` is a separate context. WebGL2 guarantees at least 16 fragment units | free for mods |

Caveat: `tex2d` :900 binds on unit 1 and leaves `ACTIVE_TEXTURE = TEXTURE1` (a live probe between frames reads unit 1). Async image loads (skins, capes, moon, chat textures) call it between frames.

## 4. Shader programs (`shaders/index.json`)

`NN` is link order at startup, captured on the title page by `tools/lib/browser.mjs`. Labels come from `labelProgram` there: `terrain` = VS has `aPos & uvec3`, `sky` = FS `uTop, uHor`, `cloud` = FS `uTint, uHole`, otherwise the first two distinctive uniform names. All `gfx.js` programs go through `prog()` :853 (compile, link, introspect `ACTIVE_UNIFORMS` into `{p,u}`, `useProgram`, set sampler units).

| Program | Draws | Key uniforms / attributes | Created → used (`pretty/js/gfx.js`) |
|---|---|---|---|
| `00-terrain` | unlit opaque | `aPos` uvec3@0, `aInfo` uvec2@1. `uVP, uOrigin, uHeld[8], uHeldN, uTex(0), uFog, uFogR` | `pTerrain[0]` :734 → `pass` :1301 |
| `01-terrain` | unlit cutout (`c.a<0.5` discard) | same | `pTerrain[1]` |
| `02-terrain` | unlit translucent (stained back-face discard, outputs `c.a`) | same | `pTerrain[2]` |
| `03-terrain` | stained-glass depth only (no texture sample) | `VS_TERRAIN` + `FS_STAINED_DEPTH` :278 | `pStainedDepth` :735 → `stainedDepth` :1275 |
| `04-sky` | unlit sky gradient | `uInv, uTop, uHor` | `pSky` :738 → `drawSky` :1324 |
| `05-c-r` | textured billboard (sun, moon) | `aC` vec2. `uVP, uC, uR, uU, uTex(1)` | `pSprite` :739 → `drawSky`, `sprite` :1404 |
| `06-cloud` | world-aligned plane: **clouds and the ocean plane** | `aC`. `uVP, uCam, uY, uSize, uTex(1), uScroll, uTexel, uTint, uHole, uFog, uFogR, uKind` | `pPlane` :740 → `drawPlane` :1417 |
| `07-off-s` | selection box lines | `aP`. `uVP, uOff, uS, uCol` | `pLine` :741 → `drawSel` :1529 |
| `08-m-over` | Steve/player boxes, cape, first-person arm | `aP, aUV, aS`. `uVP, uM, uTex(1), uFog, uFogR, uOver` (hurt tint), `uLight` | `pEnt` :742 → `drawPlayers`, `drawHeld` |
| `09-textured` | creative held block/flat item from the block array | `aP, aUV`(vec3), `aS`. `uMVP, uTex(0)` | `pHeld` :743 → `drawHeld` / `heldVao` :2149 |
| `10-m-color` | cosmetic glow shells | `VS_ENT` + `FS_GLOW`. `uVP, uM, uColor` | `pGlow` :823 → `drawGlow` :1743 |
| `11-r-u` | block-break particles (instanced) | `aC`, `aP`(pos,size), `aT`(u,v,layer,shade). `uVP, uR, uU, uTex(0), uFog, uFogR` | `pPart` :825 → `partPass` :2011 |
| `12-r-u` | atlas particles (items, sparks, smoke, explosion, enchant glyphs) | + `uSz, uTint`, `uTex(3)` | `pIPart` :826 → `partPass` |
| `13-terrain` | **lit** opaque (the one actually used) | `00` + `LIGHTMAP`: `vLight, uSkyLight, uAmbient` | `initLit` :1356 `lit.terrain[0]` → `pass` |
| `14-terrain` | lit cutout | same | `lit.terrain[1]` |
| `15-terrain` | lit translucent | same | `lit.terrain[2]` |
| `16-sky` | lit sky + sunrise/sunset glow | `uInv, uTop, uHor, uGlow, uSide` | `lit.sky` → `drawSkyLit` :1371 |
| `17-rot-b` | stars | `aP`. `uVP, uRot, uB` | `lit.star` → `drawSkyLit` |

- **Why 7 terrain programs:** one shared `VS_TERRAIN` :228 (all seven `.vert.glsl` files are byte-identical). `fsTerrain(mode, lit)` :286 is a template: mode 0 = opaque, 1 = cutout, 2 = translucent. `lit` splices in the `LIGHTMAP` chunk :267 (with `GAMMA.toFixed(2)` inlined as `0.50`). That makes 2 × 3 = 6, plus the depth-only stained-glass program.
- The unlit set (00-02, 04) is compiled eagerly. `S.lit` is set true at boot (`pretty/js/main.js:336`, before the first `requestAnimationFrame(frame)` at :418) and never set false in this build, so the unlit set is never drawn with.
- Shared sources: `05` and lazy `pChat` share `VS_SPRITE`. `08` and `10` share `VS_ENT`. `07` and lazy `pPv` share `FS_LINE`. `04` and `16` share `VS_SKY`.
- **Not in `shaders/`** (compiled lazily after startup):
  - Gfx: `pPv` (`VS_PV` :501), `pChat` (:1561), `pFire` (`VS_FIRE` :631), `pWall` (`VS_WALL` :644)
  - entity renderer: `VS`/`FS` `pretty/js/entities/index.js:34-81` (bones `uBones[16]` + `gl_InstanceID`, two fixed lights, `uBlk` array/2D switch, glint, eyes) and the fishing line (:311)
  - `CrackRenderer` `pretty/js/survival/crack.js:2`, enchantfx :234, chesticons :21, grace :10
  - The entity renderer and crack use their own `program()` (not `gfx.prog`; no `useProgram` after link). Grace, chest icons and enchantfx go through `gfx.prog`.
  - Crack and grace VSs also declare an attribute named `aPos` (as `vec3`), so never detect terrain by `aPos` alone.

## 5. Chunk and mesh data

- **Storage:** `gfx.chunks: Map<ci, {cx, cz, ymin, ymax, d, parts:[opaque, cutout, translucent]}>`, with `ci = cz*CN + cx`. A part is `{vao, vbo, n /*quads*/, stained}`. There is one mesh per 16×16 column, full height (`setChunk` :987).
- **Upload:** `remesh(ci)` `pretty/js/main.js:1128` calls wasm `mesh_chunk(cx,cz)`. For each part it takes `Uint8Array(mem.buffer, mesh_ptr(i), mesh_n(i)*32)` (or `null` when empty), then `gfx.setChunk`. These are views into wasm memory, overwritten by the next `mesh_chunk`, so a `setChunk` wrapper must copy them to keep them. `setChunk` uploads with `bufferData(STATIC_DRAW)` (the buffer is re-specified on every remesh; the VAO is created once). `n` is capped at `MAXQ=65536` quads. Every VAO uses the shared `Uint32` quad IBO `gfx.ibo` (65536×6 indices, :744-757). Drawn with `drawElements(TRIANGLES, n*6, UNSIGNED_INT, 0)`.
- **Vertex = 8 bytes, 4 per quad** (`vertexAttribIPointer` :1008-1010):

| Bytes | Attr | Bits |
|---|---|---|
| 0-1 | `aPos.x` u16 | 0-8: x in 1/16 block (chunk-local). 10-15: sky light ×4 → `vLight.x` |
| 2-3 | `aPos.y` u16 | 0-11: y in 1/16 block (≤256 blocks). 12-15: UV mode `r` |
| 4-5 | `aPos.z` u16 | 0-8: z. 10-15: block light ×4 → `vLight.y` |
| 6 | `aInfo.x` u8 | texture-array layer (`vUV.z`). 240-255 = stained glass |
| 7 | `aInfo.y` u8 | bit 0: u corner, bit 1: v corner, bits 2-7: shade/63 → `vShade` (face shade, probably including AO, inferred) |

- UV mode `r`: 0 = full tile. 1-3 = fixed sub-rects `RECT` :239 (pixel rects 7,6-9,16 / 7,6-9,8 / 7,13-9,15: the torch side, top and bottom, inferred from the coordinates). 4-9 = box-projected UVs from the in-block position via `BOXUV` (partial blocks, inferred). 10-15 = the same with U mirrored. Bit 9 of x/z is never read.
- **Per-chunk uniform:** `uOrigin = (cx*16 − cam.x, −cam.y, cz*16 − cam.z)` (:1318). In the VS: `p = pos/16 + uOrigin` (camera-relative), `vDist = max(length(p.xz), |p.y|)`.
- **Scheduling:** `updateChunks(budget)` `pretty/js/main.js:1089`, budget 5 ms in-game and 12 ms while loading:
  - `RemeshSched.run` `pretty/js/remesh-sched.js` drains wasm `pop_dirty()`, sorts by distance and remeshes at most `cap=4` per frame while an EMA cost estimate `est` fits the budget.
  - Then it meshes unmeshed chunks in `spiral` order (radius rd+1).
  - Every 1 s it `dropChunk`s columns beyond rd+3 (Chebyshev distance).
- **Atlas:** `setTiles(data, n, ft, kind)` :914 creates a `TEXTURE_2D_ARRAY` of RGBA8 **16×16×n** with mipmaps, `NEAREST` mag, `NEAREST_MIPMAP_LINEAR` min, `MAX_LEVEL 4`, clamp. It keeps a CPU copy in `gfx.rgba`.
  - Layer i = `eng.texNames[i]` (wasm `tex_names()`), loaded from `/assets/block/<name>.png` by `loadTiles` (`pretty/js/engine.js:77`). Live: 256 layers; names at 103-111 and 181 are empty (no image is loaded, the layer stays transparent); 240-255 are the 16 stained glasses.
  - `loadTiles` crops to the top-left 16×16 (first animation frame) and bakes tints (`TINT`: grass, leaves, water).
  - It composites the grass side overlay, forces water alpha to 170, and for `CUTOUT`-regex names binarizes alpha (≥26) and bleeds colour into transparent texels.
  - **Block → layer:** `ft[id*6+face]` (Uint8, from wasm `ft_ptr`; variants ≥256 come from `tex_full`). Face 2 = bottom, 3 = top, 0/1 = X sides, 4/5 = Z sides (live: grass is side,side,dirt,top,side,side; grass bursts use face 2 = dirt, `pretty/js/main.js:1226`). The −X,+X / −Z,+Z sign order within the pairs is inferred from `FC` :29.
  - `kind[id]` = `K` enum (AIR 0, SOLID 1, LEAVES 2, GLASS 3, WATER 4, PLANT 5, LAVA 6).
  - Animated layers: fire (`gfx.fireLayer`, set in `pretty/js/survival/entities.js:501`), nether portal `ft[189*6]`, end portal `ft[208*6]` (procedural, `loadStars` :1094).

## 6. Particles, entities, held items (brief)

- Particle lists: `gfx.parts` (≤2048), `iparts` (≤256), `xparts` (≤512), `sparks` (≤1024, pushed by survival/end.js and eyes.js), `smoke` (pushed by fluids.js and eyes.js up to 256, fishing.js up to 512). gfx fills the first three with `burst` :1819, `itemBurst` :1863, `explosion` :1903. Each `partPass` draws at most `MAXP`=2048. Physics runs in `tickParticles` :1928. All share one instanced VAO `vPart` and `partData` (8 floats per particle), uploaded with `bufferSubData` on each `partPass`.
- The entity renderer is created lazily by `gfx.entities()` :1783 (a stub until `/assets/atlas/entities.webp` and `items.webp` load). It lives at `gfx.ents`: `{draw, drawHeld, drawArmor, drawFire, kinds, stats{drawn,calls,culled,ms}, items{tex,rects,img}, setSkin, skins, bones, atlas, dragonPose}` (`pretty/js/entities/index.js:910`). `gfx.ents` does not exist until something needs it (absent on the title screen, live).
  - Vertex: `aP, aT`(uv,layer), `aN`, `aB` (bone index in the low 4 bits, tint flag in bit 4), stride 40.
  - Bones go in `uBones[16]` per draw. Copies are drawn instanced, offset by `gl_InstanceID`.
  - Per-entity light is computed on the CPU (`lightmap(...)`, `pretty/js/survival/entities.js:544`) and passed as `uLight`.
- Hands: `drawHeld` :2198 uses `H` (hand.js) for swing/equip and `firstPerson()` (item3d.js) for survival hands. `fit` :2281 shifts x when aspect < 16:9. It has its own `perspective(70°, aspect, 0.05, 10)`.

## 7. Lighting, fog, sky, time of day

- **Time:**
  - Creative: `S.time = CREATIVE_NOON = 6000`, fixed (`pretty/js/main.js:93,337`).
  - Survival: `survival.timeTicks(now)` (`pretty/js/survival/client.js:164`) = server time + elapsed/50, or `sv.fixedTime`. `DAY = 24000`.
  - Clouds scroll with `v.clouds ?? v.time` (creative: `now/50`, `pretty/js/main.js:841`). `uScroll = t*0.075`.
- **`skyAt(time, yaw, pitch, camY, rd)`** :344 returns `{c, s, sky, fog, glow, side, dark, skyLight, stars, cloud, water, phase}`:
  - `g = frac(time/DAY − 0.25)`, `ang = g + ((1−cos πg)/2 − g)/3`, `c,s = cos/sin(2π·ang)`, `day = clamp01(2c + 0.5)`.
  - Sky top = `SKY·day`. Fog colour = `FOG` dimmed by `day`, blended toward the sunrise glow when facing the sun (rd ≥ 4), toward the sky colour by rd, and darkened below y=32 (`dark`).
  - `skyLight` = bluish night/day brightness → terrain `uSkyLight`.
  - `glow` is set when |c| ≤ 0.4 (sunrise/sunset) → `16-sky` `uGlow`, `uSide`.
- **Sun/moon direction:**
  - Lit: sun sprite at `(−s, c, 0)·100`, moon at `(s, −c, 0)·100` (:1398-1400), so the sun moves in the X-Y plane. A mod can read `gfx.env.c/.s`.
  - Unlit: constant `SUN = norm(0.62, 0.6, −0.5)` :15.
  - Moon phase = `floor(time/DAY) % 8`, textures `/assets/env/moon/<name>.png` with names from `MOON` :19 (`full_moon` … `waxing_gibbous`), loaded in `initLit`. Stars: `starQuads` :403, Minecraft RNG seed 10842, rotated by `uRot`, brightness `uB = env.stars`.
- **Dimensions** (`dimSky` :387, `DIM_SKY` :383): fixed noon env.
  - Nether: fog `(0.2,0.03,0.03)`, `uAmbient = 0.1`.
  - End: clear colour, fog and `skyLight` overridden.
  - Neither draws the sky, ocean plane or clouds.
- **Fog** (`draw` :1186-1190), uniforms `uFog` (colour) and `uFogR` (start, end), linear on `max(len(xz), |y|)`:
  - Overworld: end = rd·16 − 4, start = 0.55·end.
  - Underwater: 0..14, colour `UNDER·dark`.
  - Nether: end = `netherFogEnd(rd)` = min(rd·16, 192)/2, start = rd·0.8.
  - Clouds use fogEnd·1.2 .. far·0.9 and fade alpha instead of colour.
  - Far plane = max(320, rd·40), near = 0.05.
- **Lightmap:** GLSL `lightmap(vLight)` (`LIGHTMAP` :267). Block light gets warm curves and sky light × `uSkyLight`, with a gamma lift (`GAMMA=0.5`) and the 0.96x + 0.03 remap. The JS twin `lightmap(sky, blk, skyLight)` :394 is used for entities, enchant books, chest icons and the ocean tint (`env.water`). A GLSL change will not reach those unless you also wrap the JS callers.
- **Held lights:**
  - `HL.lights` is set every frame in `render` (`pretty/js/main.js:740`, toggle `mc.heldLight`). `nearest` keeps 8.
  - `draw` packs them camera-relative into `gfx.heldBuf` (:1200-1210). `pass` uploads them as `uHeld[0]` with `uniform4fv`, plus `uHeldN` (0 when unlit).
  - The VS raises `vLight.y` to at least `level − manhattan distance` per vertex (`max`, :261-265), looping up to `uHeldN` (≤8).

## 8. Extension points for userscripts

**Reaching the renderer**
- **Module import:** `await import('/js/gfx.js')` from page context returns the game's own live module instance. Module identity is per URL, and main.js imports the unversioned `./gfx.js` (`raw/js/main.js`). Probe-verified: a function pushed into the imported `overlays` is called every frame with the game's `gfx`, and a `Gfx.prototype.draw` wrapper installed after boot takes effect. This gives:
  - `Gfx.prototype`, which you can patch: `draw, pass, prog, setChunk, setTiles, drawPlane, drawSkyLit, initLit, stainedDepth, partPass, drawHeld, drawPlayers, tex2d`.
  - `overlays` / `solidOverlays` arrays that you can push into.
  - Helpers `playerView, perspective, mul, lightmap`.
  - The same works for `/js/remesh-sched.js` (`RemeshSched.prototype.run/fits/timed`; `cap` is an instance field, read it as `this.cap` inside a wrapper) and `/js/held-light.js` (mutable `HL`).
  - You cannot reassign exports (live bindings are read-only).
- **The instance:** `this` inside any patched prototype method. Useful fields:
  - `gl, chunks, vp, env, w, h`
  - `tArr, ibo, vQuad, vEmpty`
  - `pTerrain, lit{terrain[3], sky, star, stars, nStars, moon[]}` and the other `p*` programs (`{p, u}`)
  - `heldBuf/heldN, chatPlanes` (frustum), `ft, kind, rgba, world`
  - set lazily: `ents` (entity renderer), `patlas` (particle atlas), `fireLayer` (survival only, `pretty/js/survival/entities.js:501`), `pPv`, `pChat`, `pFire`, `pWall`
  - `window.__mc.gfx` exists only on DEV hosts (`pretty/js/main.js:3081`, `devhost.js`).
- **Overlay callbacks** (`pretty/js/gfx.js:10-11`):
  - `solidOverlays`: `f(gfx, vp, cam, v, fog, fogStart, fogEnd)`, called after opaque terrain and entities with depth write on and blend off.
  - `overlays`: `f(gfx, vp, cam, v)`, called after clouds with blend on, `depthMask` false and cull off.
  - The cleanest way to add world-space geometry. Restore the GL state you change.

**Observable through `WebGL2RenderingContext.prototype` wrappers**
- **`getContext`:** the game context belongs to `canvas#gl`. `dragonview.js` creates other webgl2 contexts, so filter on `gl.canvas.id === 'gl'`.
- **`shaderSource`:** every program passes through it (gfx `prog`, entity `program`, crack). Detect by stable tokens:
  - terrain: `aPos & uvec3`
  - lit terrain: `uSkyLight`
  - cutout: `c.a < 0.5) discard` plus `vShade` (the discard alone also matches the `09`, `11` and `12` FSs; `vShade` is only in terrain FSs)
  - translucent: `w2b-glass`
  - sky: `uTop, uHor`
  - cloud/ocean: `uTint, uHole`
  - entity: `uBones[`
- **`linkProgram` / `useProgram`:** tag programs with a kind. `prog()` calls `useProgram` right after link and sets its own samplers (:873-874), so add your sampler `uniform1i` there.
- **Uniform calls:**
  - `uniform3f(uOrigin)` comes right before every chunk `drawElements` (gives the chunk origin).
  - `uniform3fv(uCam)` on `06-cloud` = **world camera position** (only on frames where the ocean plane or clouds draw).
  - `uniformMatrix4fv(uVP)` = camera-relative VP.
- **Frame markers:**
  - start: `viewport(0,0,w,h)` then `clear(COLOR|DEPTH)`
  - scene depth complete: just before `clear(DEPTH_BUFFER_BIT)` alone (`drawHeld`). That clear only happens when a held item or hand is drawn (first person with the HUD shown); on the title screen, in F5 or with F1 there is none
  - no explicit end. The last GL calls of a frame are in `render` (`pretty/js/main.js:845-850`). To composite after the game, wrap `requestAnimationFrame` (inferred).
- **`bindFramebuffer`:** never called by the game. An FBO you bind at frame start stays bound through every game draw.

**What each enables**
- **Post-processing:** bind your FBO at `viewport`/first clear, grab depth before `drawHeld`'s depth clear, then composite to `null`. The HUD is unaffected (separate canvas).
- **Shadow maps:** re-draw `gfx.chunks` part VAOs from the sun (`gfx.env.c/s`) with a depth-only program. It must declare `layout(location=0) in uvec3 aPos; layout(location=1) in uvec2 aInfo;` and add `uOrigin` itself. The vertex positions are chunk-local (1/16 block); the game's `uOrigin` (chunk origin − cam) is what makes them camera-relative.
- **Per-block GLSL effects** (waving plants, water): key on `aInfo.x` (layer).
  - Layer → name needs `texNames`, which is not on `gfx`. Options: call wasm `tex_names()` via a `WebAssembly.instantiate` hook (see game-core.md), or record `/assets/block/<name>.png` `src` assignments during `loadTiles` and map them **by name**. The `src`s are set synchronously in layer order (`loadTiles` maps names to `loadImage`, engine.js:78), but empty layers (103-111, 181) load nothing, so a running count drifts from the layer index. `block/dirt.png` is also loaded earlier in boot. Or classify by `gfx.rgba`.
  - `gfx.ft/kind` map block ids to layers.
- **Performance:** wrap `pass` (skip, reorder, LOD), skip `drawPlane(1)` clouds, tune `RemeshSched` (`this.cap`, budget via `fits`), use `bufferSubData` in `setChunk`, lower the GL canvas resolution (`resize` rewrites `#gl` width/height on window resize, so re-apply).

**Risks / fragile points**
- `prog()` throws on compile/link failure (:859, :866).
  - In the constructor, boot's `catch` shows **"This game needs WebGL 2"** (`pretty/js/main.js:307-311`).
  - In lazy `initLit`, the throw happens inside `draw` on every frame (rAF is re-requested first, :511).
  - Always fall back to the original source.
- A new sampler defaults to unit 0. Terrain/`09`/`11` already have a `sampler2DArray` there, so a new `sampler2D` on unit 0 is a type conflict: `INVALID_OPERATION` and the draw is dropped. Set new samplers explicitly to 6/7.
- Units 6/7 are free. Still restore `ACTIVE_TEXTURE` after binding; `tex2d` already leaves unit 1 active between frames. Never sample a texture attached to the current draw FBO (feedback-loop error).
- Patches must match lazily compiled programs too, or skip them safely. Shared sources (`VS_SPRITE`, `VS_ENT`, `FS_LINE`) mean a VS-only match hits several programs.
- Uniform map key for the array is `u["uHeld[0]"]` in `gfx.prog`; the entity `program` strips `[0]`.
- `v.wall` (camera inside a solid block) takes the early return and nothing else draws.
- Stained-glass behaviour hard-codes layers ≥240 (FS, `setChunk` scan :1017, `03`). More than 65536 quads per part are silently truncated.
- Constructor programs compile at `new Gfx` (`pretty/js/main.js:308`) before most scripts could patch prototypes, so GLSL must be patched at document-start via `shaderSource`. Lit terrain (13-17) compiles on the first lit `draw`.

## 9. Performance notes

- **Draw calls:**
  - Terrain is ≤3 draws per visible chunk, plus 1 stained-depth draw when a chunk has stained glass. Each is `uniform3f` + `bindVertexArray` + `drawElements`, with no instancing or multi-draw.
  - At rd 12 (spiral radius 13, 577 columns meshed) roughly 150-250 chunks survive culling, i.e. ~300-700 terrain draws (inferred estimate).
  - The program changes only per pass.
- **Sorting/overdraw:**
  - Opaque is near→far (helps early-Z). Cutout uses `discard`.
  - Translucent is sorted per chunk only, not per face, and drawn with **cull off**.
  - The sky is a fullscreen triangle every frame before terrain (full fill).
  - Clouds are one `far`-sized blended quad over the whole sky (big fill when looking up). The ocean plane does the same near world edges.
  - Glow shells are additive and double-shelled.
- **Shader cost is low:**
  - terrain VS: a held-light loop of up to 8 iterations per vertex (stops at `uHeldN`)
  - terrain FS: one array fetch + `lightmap` (~25 ALU)
  - Any per-pixel shadow/lighting a mod adds will dominate.
  - No MSAA, no anisotropic filtering, no extensions.
- **Resolution:** the GL canvas is `round(innerWidth·dpr) × round(innerHeight·dpr)` with `dpr = min(devicePixelRatio, 2)` (`resize` `pretty/js/main.js:458`), divided by at least 8 (class `.pix`) while the claim/verify/pending screens are up. DPR 2 means 4× the fragments, probably the biggest single lever (inferred).
- **Per-frame JS allocations:**
  - `mul/rotX/rotY/translate/perspective` allocate a new `Float32Array(16)` per call (about 40 per player per frame in `drawPlayers`).
  - `skyAt` objects/arrays, `invert(vp)`, `vis` array.
  - `render`'s players array and `gfx.skin()` string keys.
  - The entity renderer reuses `BONES`.
- **Uploads:**
  - Remesh = full `bufferData` re-specification, plus a CPU scan of the translucent part for stained layers. Up to 4 dirty plus new chunks per frame in 5 ms.
  - `texSubImage3D` of 5 mip levels for each animated layer when its frame changes.
  - Particles: up to 5 `bufferSubData` calls per frame (one per list), plus enchant glyphs (enchantfx reuses `gfx.partPass` with its own buffer) and the enchant books. Grace border and fishing line: `bufferData` each frame.
- **Sync queries:** `CrackRenderer.draw` makes 9 `getParameter` + 3 `isEnabled` calls per frame while mining (`pretty/js/survival/crack.js:126-138`), grace 7 `getParameter`, `drawGlow` 2 `isEnabled`. There is no `readPixels`/`getError` on the game canvas in prod paths (only `entities/debug.js`, TEST; `dragonview.js:258` exposes `getError` for its own context).
- **Culling:** CPU only (distance + frustum AABB per chunk, sphere tests for entities/players). No occlusion queries.
