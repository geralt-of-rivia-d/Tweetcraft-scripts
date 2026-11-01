# Tweetcraft game core codemap (for userscript authors)

Verified against game build d7bde3deb9 on 2026-11-01 (the same game code as builds b4bc035ec8 and 26479914e5, which were hashed over fewer files). Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build d7bde3deb9's `pretty/`. `~` = responsibility inferred from export names / a skim only.

## 1. Overview
- 102 unbundled ES modules (plus `/engine.wasm`). `index.html` loads one `<script type="module" src="/js/main.js">` at the end of `<body>`. `main.js` (3153 lines) holds boot, state, the main loop, input, net handlers and glue, and **exports nothing**.
- The world simulation (terrain gen, block storage, lighting, player physics, raycast, chunk meshing) runs in **`/engine.wasm`**, wrapped by `js/engine.js`. JS only drives it through `eng.x.*` exports and typed-array views on its memory.
- Creative and title worlds: terrain is generated client-side from a seed. The server only sends block edits. Survival: still a WASM seed world, plus server-streamed per-chunk deltas and a server-authoritative dig/place/inventory model (`js/survival/*`).
- Rendering is WebGL2 (`Gfx`, `gfx.js`). The HUD is a 2D canvas (`Hud`, `ui.js`). Menus are DOM in `#screen` (`menus.js`). Networking is one JSON+binary WebSocket per room (`net.js`, `proto.js`).
- Central state is a module-local `S` object in main.js (main.js:185). Prod has no global handle to it. Reach it through prototype hooks on exported classes (§5, §9).

## 2. Module map (js/…)
| Area | Module: responsibility |
|---|---|
| core | `main.js`: boot/loop/input/net glue (no exports) · `state.js`: `createState` (apply server state, hotbar save, `inv` sync), `loadHotbar` · `engine.js`: WASM loader `loadEngine`, `K` kinds, `B` ids, `loadTiles`, `loadImage`, `withVariants` · `devhost.js`: `DEV` (localhost or staging host) · `remesh-sched.js`: `RemeshSched` chunk remesh time budget · `hand.js`: first-person hand/swing state `H` · `pose-playback.js`: `PosePlayback` remote-player interpolation · `recent.js`: recent worlds (`mc.recent`) · `signs.js`: `SignsClient` (sign records, editor, 3D sign text overlay) |
| rendering | `gfx.js`: `Gfx` renderer, matrices, `playerView`, exported `overlays`/`solidOverlays` arrays · `item3d.js`: item display/pose transforms · `held-light.js`: held-item dynamic lights `HL`, `eyeInWall` · `view.js`: `RDS` [4,6,8,10,12], nether fog |
| UI | `ui.js`: `el`, `button`, `hudButton`, bitmap `Font`, `Icons`, `Hud`, `note`, `drawLoading`, `preloadButtons` · `menus.js`: every DOM screen (`showScreen`, `showTitle`, `openPause`, `openOptions`, `turnstileCheck`…) · `inventory.js`: `Inventory` creative inventory on `#inv` · `chat-bubbles.js`: 3D chat bubbles · `chat-pending.js`: unconfirmed chat lines (nonces) · `chat-style.js`: name styling, VIP rainbow, wrapping · `chat-suggest.js`: command/name autocomplete · `chat-toggle.js`: `ChatToggle` "Hide chat" button · `chat-whisper.js`: `/msg` whispers · `chat-notice.js`: "Self-promotion blocked" dialog · `wl-suggest.js`: whitelist handle suggest · `country.js`/`country-mark.js`: show-country setting, flag marks by names |
| survival | `client.js`: `SurvivalClient` hub (systems list, terrain, dig/place, predictions) · `wire.js`: chunk-delta codec · `terrain.js`: `TerrainStore` (known/parked chunks, radius) · `player.js`: `PlayerClient` health/hunger/combat~ · `screens.js`: `Screens` container windows on `#inv` · `clicks.js`: window click/craft/furnace slot logic · `entities.js`: `SurvivalEntities` (ENT_* frames, `view()` for gfx) · `equipment.js`: worn/held gear, `eq`/`phurt` · `hud.js`: `SurvivalHud` bars, `hurtTilt` · `items.js`: `SurvivalIcons` item atlas · `crack.js`: `CrackRenderer` break-crack GLSL · `creative.js`: creative inventory for gm players · `place-prediction.js` / `drop-prediction.js`: optimistic place/drop · `blocks.js`: usable blocks (doors, beds…) · `fluids.js`: buckets/fluids~ · `life.js`: animal feeding~ · `eyes.js`: eye of ender~ · `fishing.js`: rod/bobber · `book.js`: book editor · `chestlabels.js`/`chesticons.js`: chest labels/icons · `enchantfx.js`: enchant-table book/glyph FX · `gear.js`: enchant offers, shield~ · `grace.js`: spawn-protection border · `onboarding.js`: spawn hints (`/wild`) · `portals.js`: portal FX~ · `end.js`: End fight, boss bar, credits · `ambient.js`: ambient hums (fire/lava/water/furnace)~ · `touch.js`: `SurvivalTouch` |
| entities | `index.js`: `createEntityRenderer` (WebGL mob/item/player models), `loadEntityAssets` (`/assets/atlas/entities.webp`, `items.webp` and their `.json`) · `models.js`: `MODELS`/`KINDS` bone models · `mesh.js`: geometry builders · `anim.js`: `FAMILIES` animations · `skin.js`: dragon mesh/skin, sponsor logos · `debug.js`: `debugEntities` (TEST only) |
| rules/data | `ids.js`: id ranges · `rules/items.js`: item/block registry (`bindBlocks`, `itemInfo`, `idOf`, `blockName`, `ITEM`) · `achievements` · `books` · `chests` · `combat` · `crafting` · `creative-menu` (`TABS`, `INV`) · `creative-shapes` (doors/beds/torches, `placeCells`, `toggled`) · `enchant` · `end` · `fire` · `food` · `mining` (break ticks, drops) · `names` (`MOB_NAME`) · `portal` · `replace` · `signs` (`SIGN`=174) · `smelting` · `stairs` (`STAIRS`=211) · `variants` (hi-byte variants) |
| net/identity | `net.js`: `createNet` WebSocket client · `proto.js`: wire constants (`PROTO`=5, `FRAME`, `MSG`…) · `identity.js`: `createIdentity` (X token via `/api/me`), `readTok`, `tokI` · `sojo.js`: Sojo SDK loader (`/api/sojo`, `id.sojo.gg`) · `sojo-identity.js`: Sojo account identity, sign-in "pill" · `turnstile.js`: `requestTurnstile` (Cloudflare) |
| audio/voice | `sound.js`: WebAudio SFX, positional `playAt`/`playBlock`, `setListener` · `voice.js`: `createVoice` proximity voice (WebRTC, `/ws/voice/<room>`, transcription tap) |
| cosmetics | `avatar.js`: skin/cape compositing · `skin-layout.js`: skin UV/parts, VIP/royal lists · `skin-editor.js`, `skin-import.js`, `skin-preview.js` · `wardrobe.js`: `createWardrobe` shop/state (`/api/wardrobe*`, `cos` ticket) |
| sponsors | `sojo-ads.js`: ad fetch/display/view tracking (`/api/ads`) · `world-sponsors.js`: per-world sponsor HUD · `sponsor-tooltip.js` · `dragon-sponsor-preview.js`, `dragonview.js`: 3D dragon sponsor panels |

**Area import graph (static):** core→{rendering, UI, survival, rules, net, audio, cosmetics, sponsors}. survival→{core (engine, hand, pose-playback, inventory), rendering, entities, rules, net (proto, sojo), UI (menus, ui), audio}. UI→{core (engine, recent), rules, net (proto, turnstile), sponsors, audio}. rendering→cosmetics (gfx imports avatar, skin-layout). net→rendering (net.js imports `angDiff`). entities→rendering (item3d). sponsors→{entities, net (sojo)}. audio→net (voice imports proto). Nothing imports main.js. `rules/items.js` is the most-imported module (29 importers).
**Lazy `import()`:** `Gfx.prototype.entities()` → `./entities/index.js` (gfx.js:1786). `survival/end.js:164` → `../dragonview.js`. `main.js:3124` → `./entities/debug.js` (TEST only). The first two are also imported statically (menus → dragon-sponsor-preview → dragonview → entities/index), so they load at boot anyway. Lazy external scripts: Turnstile `api.js` (turnstile.js:7) and Sojo `sdk.js` (sojo.js:1, 48-49).

## 3. Boot sequence
1. `index.html`: canvases `#gl #hud #load #inv`, `#screen .inner`, `#chatbox`, `#invsearch`, `#touch`, `#hudtop>#hudleft,#hudright`, `#cross`, `#note`, `#fatal`. modulepreload, then the main.js module script at the end of body, so the DOM exists. Import-time side effects: `menus.js:13` caches `#screen` and `#screen .inner`. `sojo-identity.js:35` calls `sojoOptions`.
2. URL parsing (main.js:96-134). `ROOM` comes from `/r/<16 [a-z0-9]>` or `/play/…`. `TITLE=!ROOM`, `CARD` (?card preview), `NEW` (?new), `TEST` (DEV && ?test), `CODE` (?c invite), `ROUTE` (#create, #servers, #sponsor, /sponsor-credit), `RETRY_*`, `TOUCH`, `FRAMED` (iframe), `SOJO_PAGE` (`meta[name=sojo]`). On the title page, `sojoConfig()` makes a GET to `/api/sojo`.
3. Hash handoff (main.js:164-184): `#sid` → `mc.sid` (else the stored `mc.sid`, else `rid(20)`), `#tok` → `mc.tok`, `#key` → `mc.key.<room>`, `#admin` → `mc.admin`, `#voice=1`. Then `history.replaceState` strips the hash, `c` and `new`. A userscript must read the hash at document-start.
4. Module-level setup: `S` (185), DOM refs (256), `ChatToggle`, `worldSponsors` (creates `aside#world-sponsors`), `ChatBubbles`, `ChatSuggest`, `net=createNet` (1574), `signs=new SignsClient` (1610), `voice` (1632), `state` (1644), identity (2061-2062), `wardrobe` (2874), `G` (2883), DEV `window.__mc` (3080). Then `boot()` (3150); a failure shows `fatal()`.
5. `boot()` (main.js:302):
   - `document.fonts.load('16px "Tweetcraft"')` (304), `preloadButtons()` (306).
   - `gfx = new Gfx(#gl)` (308). Without WebGL2 it shows `fatal`.
   - `initSound()` (312).
   - Loads `gui/ascii.png` into `new Font` and `block/dirt.png`, then `resize()` (314-319).
6. In parallel (321-329): `loadEngine("/engine.wasm", seed)`, where seed = `fnv(ROOM)` or `fnv("minecraft.jai.vin title")`, plus `gui/hotbar.png`, `hotbar_selection.png`, `env/clouds.png`, `env/sun.png`, `entity/steve.png`, `gui/toast.png`. Then it reads `WORLD/WORLD_H/CN` from `eng.x.world_*()`, calls `set_lighting(1)` and sets `S.time=6000`.
7. Tiles:
   - `loadTiles(eng.texNames)` (339) loads `/assets/block/<name>.png`, skipping empty names (engine.js:78), so the request order is not the layer index.
   - `texNames.indexOf("oak_planks")` (340).
   - `gfx.setTiles(data, n, eng.ft, eng.kind)` (341), `gfx.setImages({clouds, sun, steve, water})` (342), `new Icons` (343).
   - Door item sprites come from `/assets/atlas/items.json` + `.webp` (`loadItemSprite`, 1175).
8. Data and UI:
   - `bindBlocks(eng.blockNames)` (355).
   - `hud=new Hud(#hud,…)` (361).
   - `matOf[]` sound materials (`material()`, 1188).
   - `inv=new Inventory(#inv,#invsearch)` (363).
   - `M.initMenus(G)` (378).
9. Camera: on TITLE it uses `spawnPoint()`, 6 blocks up, slowly rotating. CARD uses a fixed yaw. Otherwise `placeSpawn()` picks a random point near spawn (433). Then `buildSpiral`, `buildTop` (HUD DOM buttons, 2093), and `bindInput` (2411).
10. Net and identity (394-417):
    - Sojo page: `identity.start()`, then `net.connect()`.
    - Otherwise: `net.connect()` if ROOM&&!CARD, and `identity.sync()` (`/api/me`).
    - Title: when `SOJO_WAIT` resolves (at most 1.5 s), switch to Sojo identity if `{on}`.
    - Then `requestAnimationFrame(frame)` (418).
11. Title: when `meshedFrac()>=1` and Sojo is known, `onReady()` (677) runs: sets `window.__ready=true`, hides `#load`, then opens the card screen, `openCreate`, `openServers`, `openSponsor`, `openMine`, `openSponsored`, or `M.showTitle()` (703).
12. Room: `loading()` (592) draws "Joining world..." until `welcome` (`S.room`), then "Loading terrain..." with a % until `synced` and the near chunks are meshed (creative also spawns after 6 s without `synced`; `?new` worlds run a scripted ~3.7 s sequence). Then `spawn()` (652): `S.started=S.ready=true`, `window.__ready=true`, input mode lock/drag/touch, `loadBlockSounds()`, then the claim or pending screen if relevant.

## 4. Main loop — `frame(now)` (main.js:510), one rAF per frame
1. `requestAnimationFrame(frame)` is the **first** statement, so a throwing hook skips the rest of every frame without stopping the loop. Next: `identity.pill?.()`, dt (capped at 0.25 s), fps counter.
2. **Fixed tick:** `TICK=0.05` (20 Hz), at most 10 per frame, backlog dropped. Each tick calls `tick()` (557) and `gfx.tickParticles(solidAt)`. `tick()` does:
   - survival gate (`abort` unless synced) and `survival.tick()`;
   - `S.prev` = position;
   - keys to fwd/str/flags (1 jump, 2 sneak, 4 sprint, 8 touch);
   - `survival.move()`, else **`eng.x.player_tick(fwd,str,flags,sin yaw,cos yaw)`** (WASM physics, 587);
   - `holdTick()` (1359: creative held break every 6 ticks via `breakCd=5`, held use every 4; survival mines through `survival.mine()`), `tickHand`, remote swings.
   - Before `S.started` (title, loading) no ticks run at all: `frame` only rotates the yaw (not on CARD).
3. `updateChunks(5 ms playing / 12 ms loading)` (1089): `set_focus`, `remeshSched.run` (dirty chunks, nearest first, cap 4), then fill the spiral of unmeshed chunks within rd+1. Every 1 s it drops meshed chunks beyond rd+3 and calls `survival.prune`.
4. `updateRemotes(dt)` (1558): `PosePlayback` sampling, limb animation.
5. `render(alpha=acc/TICK (1 before started), dt, now)` (709):
   - position interpolation, eye height (1.62, crouching 1.27), F5 third-person cam (`camDist`), `eyeInWall`, `HL.lights`, `setListener`, `voice.update`, `raycast()` to `S.sel`, FOV lerp (fly ×1.1, sprint ×1.15), `playerView`;
   - builds the players list, then **`gfx.draw({...})` (820)**;
   - survival only, and not when the eye is in a wall: crack, first-person hands, burning overlay (846-850); name tags via `gfx.project`;
   - **`hud.draw({...})` (875)**, `survival.drawHud` (906), `drawUndoPreview`, `hud.suggestions`, `chatToggle.update` (909).
6. Then: `inv.draw`, `survival.screens.draw()`, `updateAdvancement`, `worldSponsorHUD.update(S)`.
7. **`net.pos(now)`** sends a POS frame only if the player moved. Throttle: every 100 ms below 50 players, 200 below 200, 333 below 500, else 500. 50 ms while swinging.
8. `loading()` / `resuming()` / `onReady()`, pixelated-menu resize, welcome toast.

Input is event-driven (`bindInput`, 2411; `onKeyDown`, 2322):
- Movement and slots: Digit1-9 slot, double-Space fly, double-W sprint.
- Screens: E inventory, Q drop (survival), T/Enter chat, `/` command, Esc pause, Tab player list.
- Account and world: V verify, O owner tools, M new world, P voice.
- View: F1 HUD, F3 debug, F5 camera.
- Mouse: 0 `attack`, 2 `doPlace`, 1 `pick`. `mousemove` calls `turn(movementX,movementY,SENS)` under pointer lock, or uses DRAG_SENS in drag mode.

## 5. Game state
**`S`** (main.js:185) is a module-local plain object. Selected fields:
| Group | Fields |
|---|---|
| lifecycle | `started ready closed resuming restored synced loadAt welcomePending` |
| UI/input | `menu` (build fn or null), `menuName` ("title","pause","inv","sinv","options","claim"…), `chatOpen chatHidden input` ("none","lock","drag","touch"), `keys{code:true} mouse[3] drag look stick tjump tsneak sprint wheel hint flash toast debug showHud tab` |
| camera | `yaw pitch eye fov baseFov view`(0/1/2) `cam[3] eyePos[3] prev[3] sel{x,y,z} inWall rd heldLight` |
| inventory | `hotbar[9] slot itemAt`, survival only: `sinv{s[46],sel} counts[9]` |
| identity/room | `tok{token,handle,name,pfp,(perks,sojo)} myId me owner op creator verifying room{name,mode,hardcore,beaten,pending,host} quote ownerStats global achs undoPv` |
| world | `lit time`, survival only: `sv{seed,w,gen,time,spawn,grace,dim,fixedTime…}` and `gm` (creative-mode player) |
| chat | `chat[]` (≤60 `{text,color,nameStyle,at}`), `lastWhisper` |

Other locals in main.js:
- `eng` holds `x` (WASM exports), `mem`, `nb`, `nt`, `texNames`, `blockNames`, `kind`, `ft`, `st`, `ray`, `ebuf`.
- **`eng.st`** is a Float64Array(12): [0-2] feet xyz, [3-5] velocity, [6] on ground, [7] flying, [8] ?(ladder or in liquid, inferred), [9] crouching, [10] in water, probably at eye level (inferred: it drives the first-person underwater fog, main.js:825, and survival air bubbles, player.js:386; survival/client.js:382 calls it `inWater`). [11] is unused by JS.
- **`eng.ray`** is an Int32Array(8): [1-3] hit block, [4-6] face normal, [7] block id.
- Also: `gfx`, `hud`, `font`, `icons`, `inv`, `survival` (SurvivalClient or null), `remotes` (Map id → `{name,h,p,cos,cc,x,y,z,tx..,yaw,pitch,body,limb,crouch,has,sw,motion}`), `self`, `UI{dpr,gs,pad,u,hpx}`, `net`, `identity`, `voice`, `wardrobe`, `signs`.
- **`G`** (2883) is the glue object handed to `M.initMenus(G)` and kept module-local in menus.js:12. It holds `S`, `UI`, `net`, `remotes`, `store`, `ROOM`, `TITLE`, `api()`, `resume`, `chatLine`, `releaseInput`… and is **not reachable** from menus' exports.

**How to reach state from a userscript on prod.** There are no globals except `window.__ready` (boolean). `window.__mc` exists **only on DEV hosts** (main.js:3080).
| Need | Hook (all are prototypes of exported classes; get them with `await import('/js/<mod>.js')`) |
|---|---|
| S, net, eng, gfx | `SignsClient.prototype.draw(gfx,vp,cam)`: `this.o.S`, `this.o.net`, `this.o.eng()`, `this.o.gfx()`. It runs every frame via gfx `overlays` (gfx.js:1269; the overlay at signs.js:14 calls `this.draw` dynamically), title screen included (verified live), except while the eye is in a wall. Also `.onMsg(m)` (every JSON message that reaches `onJson`; net.js consumes `full`/`busy`/`ticket`/`challenge` first) and `.key(e)` (every keydown) |
| S | `ChatToggle.prototype.update`: `this.state === S`, every frame (main.js:909) |
| eng.x | `RemeshSched.prototype.run(x,…)`: first argument, every frame (verified live: `world_w()`=1024 on the title world). Or wrap `WebAssembly.instantiate` at document-start: engine.js:22 is the only caller, and `instance.exports` = `eng.x`, including `memory` |
| gfx, frame params | `Gfx.prototype.draw(v)`: `this` = gfx; `v.cam, yaw, pitch, fov, rd, players, time, lit, dim` |
| survival | `SurvivalClient.prototype.tick/onMsg/onBin/drawHud`: `this.S`, `this.eng`, `this.net`, `this.o` (callbacks), `this.systems` |
| HUD | `Hud.prototype.draw(o)` (ui.js:415) |
Mutable exported singletons: `overlays`/`solidOverlays` (gfx.js:10-11; push `(gfx,vp,cam,v)=>{}`), `HL` (held-light), `H` (hand.js). `K`/`B` are mutable but don't touch them.

## 6. World data
- WASM `eng.x` API used by JS:
  - world: `init(seed) set_world(w) set_gen(g) set_lighting world_w/h/cn find_spawn surface_y light_at`
  - blocks: `get_block set_block get_full raycast`
  - player: `player_set player_tick player_fly player_vel unstuck`
  - meshing: `set_focus pop_dirty mesh_chunk mesh_n mesh_ptr mesh_ymin mesh_ymax`
  - edits/chunks: `apply_edits reset_edits apply_chunk clear_chunk chunk_edits edit_room/edit_fits`
  - tables: `tex_names block_names variant_names tex_full kind_ptr ft_ptr state_ptr ray_ptr ebuf_ptr nblocks ntex`
  - exported but never called by JS (MODULES.md lists them): `overworld_height overworld_biome stronghold_list stronghold_near fortress_at fortress_list end_spikes copy_box dense_room chunk_pooled shape_probe shape_dump name_probe name_in_ptr hishape_ptr stats_ptr variant_names_ok`
- **Block ids:** 0-254 are base blocks (`eng.nb`=255 live; creative 0-67, phases up to 219 per ids.js). 255 = REVERT. Items are 256-65535 minus the variant range (`ITEM_FIRST/LAST`, ids.js; defined phases use 256-1023). 4096-32767 are variants `(hi<<8)|lo` (rules/variants.js `withHi`).
- `B` (engine.js:2): AIR 0, STONE 1, GRASS 2, DIRT 3, WATER 9, BEDROCK 12, LAVA 68. `K` kinds (engine.js:1): AIR, SOLID, LEAVES, GLASS, WATER, PLANT, LAVA.
- `eng.kind[id]` gives the kind. `eng.ft[id*6+face]` gives the tile layer.
- **Two name lists:**
  - `eng.blockNames` holds display names ("Fire", "Snow Block", "Enchanting Table") from `block_names()` + `variant_names()` (engine.js:52). `bindBlocks()` (rules/items.js:334) builds `idOf` / `blockName` / `itemInfo`.
  - **`eng.texNames`** holds texture basenames ("oak_planks", "water_still"…) from `tex_names()` (engine.js:51). Its index is the layer in the `TEXTURE_2D_ARRAY` (256 entries live, `eng.nt`; "oak_planks" is layer 5).
- **`indexOf("oak_planks")`:** the only call is main.js:340 in `boot()`. `eng.texNames.indexOf("oak_planks")` picks the oak-plank tile canvas as the sign background (`signPlank`, given to `SignsClient` as `plank()`).
  - It runs once, after `await loadTiles(texNames)` and immediately before `gfx.setTiles` (341), so the captured names line up 1:1 with the uploaded layers.
  - The next call is `indexOf("water_still")` (342).
  - Survival code also calls `blockNames.indexOf("Fire")` / `indexOf("Chest")` (survival/entities.js:501, fluids.js:159, chesticons.js:47, chestlabels.js:17, creative.js:35, screens.js:227). That is the display-name list, so check `v==='oak_planks'`.
  - If the sign texture changes, the capture silently fails. Fallback: call `tex_names()` yourself via the `WebAssembly.instantiate` hook (cstr from `memory`).
- **Tiles** (`loadTiles`, engine.js:77): each layer is 16×16 RGBA (1024 B). Tints for grass, leaves and water; the grass-side overlay is composited in; water alpha is 170; layers matching `CUTOUT` get an alpha threshold (≥26) and colour bleed.
- **Geometry:**
  - Creative/title world: `WORLD`=1024 wide, `WORLD_H`=128, `CN`=64 chunks per side.
  - Survival: `set_world(sv.w)`, e.g. 5120 overworld, 640 nether (rules/portal.js).
  - A chunk is a 16×16×128 column. Chunk index `ci = cz*CN+cx`. Creative block key `(x<<17)|(z<<7)|y` (proto.js:101).
- **Creative edits:**
  - The server sends edits only. A SYNC frame (3) carries n × [u32 key, u8 block]; they are copied into `eng.ebuf`, then `apply_edits` (main.js:1968).
  - RELAY frames carry live edits. DENY (4) sets or reverts one block (`setKey`, 1978).
  - Local edits go through `edit()` (1236): `set_block`, `net.edit`, `effects()` (particles and sound).
- **Survival terrain:**
  - `welcome.sv` drives `init(seed)`, `set_world`, `set_gen` (`SurvivalClient.welcome`, survival/client.js:97).
  - CHUNK_DELTA frames (12) are parsed by `decodeChunks` (wire.js:35): `[u8 12, u8 dim, u16 n]`, then per chunk `[i32 ci, u16 nrec, nrec×(u16 idx=((z&15)*16+(x&15))*128+y, u8 lo, u8 hi|QUIET 128)]`.
  - Unknown chunks go to `TerrainStore.load` (terrain.js:146) and on to `apply_chunk`. Known chunks get per-block `setBlock` + effects (client.js:208).
  - A chunk is meshed only when it and its 8 neighbours are known (`canMesh`, client.js:193).
- **Meshing:** `remesh(ci)` (main.js:1128) calls `mesh_chunk(cx,cz)`, which produces 3 parts. Each part is n quads × 32 B (4 vertices × [u16×3 pos, u8×2 attributes], gfx.js:987). The parts go to `gfx.setChunk(ci,cx,cz,parts,ymin,ymax)`. Part 0 is opaque, part 1 cutout (alpha-tested program), part 2 translucent, drawn in the blended pass (gfx.js:1240-1241, 1264). `gfx.chunks` is a Map; `gfx.dropChunk(ci)`.

## 7. Networking
- **Room socket:** `wss://<host>/ws/<room>` (net.js:20), `binaryType` arraybuffer. Text messages are JSON `{t:…}`; binary messages are frames. Keepalive: text `"ping"` every 25 s (net.js:221); `"pong"` is ignored.
- **Join:**
  - `onopen` → `sendHello` (net.js:60) sends `{t:"hello", v:PROTO(5), rd, sid, key?, token?, code?, admin?, cc, challenge:true, turnstile?, take?, re?, rt?}` (fields from main.js:1583).
  - The server may reply:
    - `challenge{sitekey}` → `M.turnstileCheck` (menus.js:173) → `requestTurnstile` (action "guest_join", interaction-only, 6 s, **one try**) → a second hello with the token;
    - `ticket{rt}` (resume ticket);
    - `full`/`busy{retryAfter}`;
    - `welcome{id,you,owner,op,creator,room,quote,players,sv?,st?,revoked?,rt}`, then `synced`.
  - No welcome within 15 s → reject "timeout". Reconnect: 30 s.
  - Close codes: 4002 full, 4004 moved (other tab), 4008 idle, 4009 lost (no retry). Anything else reconnects with a backoff that doubles from 1 to 15 s, jittered ×0.5-2 (net.js:114-115).
- **JSON types:** the lists are `MSG_TO_SERVER`/`MSG_TO_CLIENT` (proto.js:202/255).
  - `onJson` (main.js:1646) handles welcome, synced, sinv, time, moved, idle, spawn, place, signedout, evs, join, leave, who, cos, chat, sys, ach(s), room, you, roles, renamed, undo*, poke, reset, full/busy, kicked and old. Everything else goes to `survival.onMsg` and then each system. `SignsClient.onMsg` sees messages first.
  - Sent from the client: `chat{m,n}`, `view{rd}`, `inv{hotbar,slot}`, `auth{token}`, `cos{k}`, `achs`, `cc{on}`, and survival `dig{s:0 start/1 abort/2 done,x,y,z,f,i}`, `place{x,y,z,f,…prediction}`, `sel{i}`, `attack`, `use`, `click`, `drop`….
- **Binary frames** (`FRAME`, proto.js:2):
  - client→server: POS 1 (18 B: f32 x,y,z, i16 yaw×1e4, i16 pitch×1e4, u8 flags 1 crouch/2 fly/4 swing), EDIT 2 (6 B: u32 key, u8 block; creative only).
  - server→client: SYNC 3; DENY 4; RELAY 5 / RELAY_FULL 6 (`u16 np, u16 ne`, np×19 B players, ne×7 B edits, then an optional JSON event array; FULL hides absent players; main.js:1923); ENT_SPAWN..ENT_EQUIP 7-11 (survival/entities.js:107); CHUNK_DELTA 12.
  - INV/WINDOW/HEALTH/TIME/DIM (13-17) are defined but not referenced by client code.
- **HTTP** (all same-origin):
  - identity: `/api/me` (GET identity by cookie `mcv=1`, POST bridge token, DELETE logout), `/api/sojo`, `/api/sojo/link`, `/api/sojo/post`, `/api/verify`, `/api/verify/code`, `/api/admin`;
  - worlds: `/api/online`, `/api/servers?…`, `/api/rooms` (POST create → `{id,key}` → `/r/<id>?new#key=`), `/api/rooms/<id>/stats`;
  - assets: `/api/pfp?u=`, `/api/skin/…`, `/api/cape/…`;
  - shop and ads: `/api/wardrobe*`, `/api/sponsor*`, `/api/ads`;
  - voice: `/ws/voice/<room>` and `/api/voice/<room>/tap` (WS).
  - `G.api()` (main.js:2860) POSTs JSON.
- **To join a world:** open the URL `/r/<id>`, optionally with `?c=<invite>`. The hello needs a `sid`; a token is optional, as are an owner key (`mc.key.<room>`) and an admin key. Turnstile only runs if the server challenges. Whitelist and bans are enforced server-side (`kicked`). An `old` reply means a protocol mismatch, and the game stops with "Update available".

## 8. Settings and storage (localStorage, mostly via `store` main.js:135, which swallows errors; menus.js:482/507, sojo-ads.js and sojo-identity.js read `localStorage` directly)
| Key | Meaning (where) |
|---|---|
| `mc.fov` | base FOV 30-110, default 70 (read main.js:206, written menus.js:1806) |
| `mc.rd` | render distance in RDS, default 8 (6 on touch) (230, `cycleRd` 2846) |
| `mc.heldLight` | "0" turns off held-item light (204, menus.js:1820) |
| `mc.hotbar` | JSON [9 ids] creative hotbar (state.js:6/17) |
| `mc.sid` | session id, 20 chars, sent in hello (167-168) |
| `mc.tok` | JSON `{token,handle,name,pfp}` X-account token (169, 233, identity.js) |
| `mc.bridged` | token already bridged to the cookie (identity.js:26/38) |
| `mc.key.<room>` | owner key of a world you created (170-174, menus.js:1782; scanned in menus.js:508) |
| `mc.admin` | admin key, sent in hello and as the `x-admin` header (177) |
| `mc.nonce` | verify-flow nonce (menus.js:1957, sojo-identity.js:91) |
| `mc.cos` / `mc.wardrobe` | cosmetics ticket cache `{key,who,ticket,exp,at}` / owns-cosmetics flag (wardrobe.js:81/84/98) |
| `mc.recent` | comma-separated recent world ids, at most 50 (recent.js:1) |
| `mc.showCountry` | "0"/"1" show flag (country.js:2, menus.js:1825) |
| `mc.adseen` | JSON `{adId:time}` (sojo-ads.js:132) |
| `mc.voiceOff` / `mc.voiceNotice` | "1" = no auto-listen / transcription notice acknowledged (1638, 3016-3075) |
Most keys are read once at module init or boot, so set them before main.js runs for them to take effect. There is also the cookie `mcv=1` (verified session). No sessionStorage or IndexedDB.

## 9. Extension points and risks
**Stable enough to hook:**
- Exported names (manifest `exports`) and the prototypes of exported classes: `Gfx`, `Hud`, `Font`, `Icons`, `Inventory`, `SignsClient`, `ChatToggle`, `ChatBubbles`, `RemeshSched`, `PosePlayback`, `SurvivalClient` and every survival `*Client`, `Screens`, `TerrainStore`, `CrackRenderer`.
- The `overlays`/`solidOverlays` arrays.
- DOM ids from index.html, `#screen` className `on …`, the CSS vars `--u --d --hp --hb` (set in `resize()`, main.js:488-491).
- `window.__ready`. It goes back to false while a survival world (re)loads (main.js:1704) and true again in `resuming()` (2198).
- At document-start: wrap `WebSocket`, `fetch` and `WebAssembly.instantiate`, or seed `mc.*` keys.

**Fragile:**
- Line numbers and minified locals.
- Exact call shapes: the `indexOf('oak_planks')` capture depends on main.js:340.
- Field names of `S`, `eng.st`/`eng.ray` slot indices, WASM export names, binary layouts, `menuName` strings.
- Prefer feature checks (does the method exist, does it have the expected arity) and fall back to doing nothing.

**Gotchas:**
- Import game modules only after the DOM exists, at the exact URL `/js/<name>.js`, to get the same instance. `menus.js:13` caches `#screen` at evaluation time. Importing menus.js too early, or anything that pulls it in (`survival/client.js`, `wardrobe.js`, `survival/player.js`, `survival/onboarding.js`, `survival/end.js`), would break every menu.
- Module namespaces are read-only: you cannot replace an exported function, only patch the objects and prototypes it exposes.
- `Array.prototype.indexOf` is hot: compare the string first, then do the work.
- Hooks inside `frame()` must not throw: rAF re-arms first, so a throw freezes the rest of every frame (rendering, `net.pos`).
- Keep pointer lock working: `#gl` `requestPointerLock`, and `pointerlockchange` opens pause. Do not swallow `window` keydown or mouse events with capturing listeners.

**Never break:**
- **Turnstile:** `challenge`, `turnstileCheck`, the overlay `.turnstile-overlay` (z-index 5000), and the `challenges.cloudflare.com` script. Don't hide, block, auto-solve or delay it. There is one attempt per connection, then "Couldn't join world".
- **The hello payload and `PROTO`:** the server answers `old` and the game stops.
- **Server authority:**
  - creative edits can be reverted (DENY);
  - survival dig/place are validated, and predictions are rolled back via `digack`/`placeack`;
  - chat is filtered (spam, links, promotion); kicks and bans apply.
  - Don't forge `dig`/`place`/POS traffic or alter movement: the server presumably checks movement too (inferred, the server is not visible).
- **Credentials:** `mc.tok`, Sojo tokens, `mc.admin` and `mc.key.*` are secrets. Never log or send them anywhere.
