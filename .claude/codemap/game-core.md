# Tweetcraft game core codemap (for userscript authors)

Verified against game build c111547912 on 2026-11-02 (re-verified from d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build c111547912's `pretty/`. `~` = responsibility inferred from export names / a skim only.

## 1. Overview
- 117 unbundled ES modules (plus `/engine.wasm`). That is 15 more than build d7bde3deb9 and none removed; see §2 "New in c111547912".
- `index.html` loads one `<script type="module" src="/js/main.js">` at the end of `<body>`.
- `main.js` (3286 lines) holds boot, state, the main loop, input, net handlers and glue, and **exports nothing**.
- The world simulation (terrain gen, block storage, lighting, player physics, raycast, chunk meshing) runs in **`/engine.wasm`**, wrapped by `js/engine.js`. JS only drives it through `eng.x.*` exports and typed-array views on its memory.
- Creative and title worlds: terrain is generated client-side from a seed. The server only sends block edits.
- Survival: still a WASM seed world, plus server-streamed per-chunk deltas and a server-authoritative dig/place/inventory model (`js/survival/*`).
- Rendering is WebGL2 (`Gfx`, `gfx.js`). The HUD is a 2D canvas (`Hud`, `ui.js`). Menus are DOM in `#screen` (`menus.js`). Networking is one JSON+binary WebSocket per room (`net.js`, `proto.js`).
- All user-visible text now goes through `i18n.js` (`t(key)`), in 13 locales (§9).
- Central state is a module-local `S` object in main.js (main.js:202). Prod has no global handle to it. Reach it through prototype hooks on exported classes (§5, §9).

## 2. Module map (js/…)
| Area | Module: responsibility |
|---|---|
| core | `main.js`: boot/loop/input/net glue (no exports) · `frameloop.js`: `createFrameLoop` (the rAF loop), `backingDpr`/`MAX_PX` (canvas DPR cap) · `state.js`: `createState` (apply server state, hotbar save, `inv` sync), `loadHotbar` · `engine.js`: WASM loader `loadEngine`, `K` kinds, `B` ids, `loadTiles`, `loadImage`, `withVariants` · `devhost.js`: `DEV` (localhost or staging host) · `remesh-sched.js`: `RemeshSched` chunk remesh time budget and settle delay · `hand.js`: first-person hand/swing state `H` · `pose-playback.js`: `PosePlayback` remote-player interpolation · `look.js`: `keepLook` (keeps the local yaw/pitch when server state is applied), `createSpikeFilter` (drops outlier mouse-look deltas) · `landing.js`: `landingPoint` (survival landing position for a forced POS) · `recent.js`: recent worlds (`mc.recent`) · `signs.js`: `SignsClient` (sign records, editor, 3D sign text overlay) |
| i18n | `i18n.js`: `t, tOr, tn, srvText, locale, localeInfo, setLocale, onLocaleChange, LOCALES, LOCALE_CODES, LANG_KEY, wrapText…` · `lang/en.js`: the English catalog (default export) · `lang/server.js`: `srv.*` keys for server messages · `lang-select.js`: `startLanguage`, `chooseLanguage`, `followSojo` (Sojo locale sync) · `glyph-pages.js` / `glyph-ui.js`: glyph-page advance tables and the frequent-CJK glyph list for `ui.Font` (data only) |
| rendering | `gfx.js`: `Gfx` renderer, matrices, `playerView`, exported `overlays`/`solidOverlays` arrays · `item3d.js`: item display/pose transforms · `held-light.js`: held-item dynamic lights `HL`, `eyeInWall` · `view.js`: `RDS` [4,6,8,10,12], nether fog · `fireflies.js`: `Fireflies` (night fireflies, an `overlays` callback) |
| UI | `ui.js`: `el`, `button`, `hudButton`, bitmap `Font` (now with on-demand glyph pages), `canDraw`, `Icons`, `Hud`, `note`, `drawLoading`, `preloadButtons` · `menus.js`: every DOM screen (`showScreen`, `showTitle`, `openPause`, `openOptions`, `turnstileCheck`…) · `inventory.js`: `Inventory` creative inventory on `#inv` · `chat-bubbles.js`: 3D chat bubbles · `chat-pending.js`: unconfirmed chat lines (nonces), `CHAT_MAX`=256, `cutChat` · `chat-style.js`: name styling, VIP rainbow, wrapping · `chat-suggest.js`: command/name autocomplete · `chat-toggle.js`: `ChatToggle` "Hide chat" button · `chat-whisper.js`: `/msg` whispers, `visibleChat` · `chat-translate.js`: `ChatTranslator` (auto-translates incoming chat via `/api/translate`) · `translate-lang.js`: target-language mapping and language detection for it · `chat-notice.js`: "Self-promotion blocked" dialog · `wl-suggest.js`: whitelist handle suggest · `country.js`/`country-mark.js`: show-country setting, flag marks by names |
| survival | `client.js`: `SurvivalClient` hub (systems list, terrain, dig/place, predictions) · `wire.js`: chunk-delta codec · `terrain.js`: `TerrainStore` (known/parked chunks, radius) · `player.js`: `PlayerClient` health/hunger/combat~ · `screens.js`: `Screens` container windows on `#inv` · `clicks.js`: window click/craft/furnace/anvil slot logic · `anvil.js`: `AnvilClient` (anvil screen, `#anvil-name` rename input) · `fixtures.js`: `FixturesClient` (armour stands, item frames) · `entities.js`: `SurvivalEntities` (ENT_* frames, `view()` for gfx) · `equipment.js`: worn/held gear, `eq`/`phurt` · `hud.js`: `SurvivalHud` bars, `hurtTilt` · `items.js`: `SurvivalIcons` item atlas · `crack.js`: `CrackRenderer` break-crack GLSL · `creative.js`: creative inventory for gm players · `place-prediction.js` / `drop-prediction.js`: optimistic place/drop · `blocks.js`: usable blocks (doors, beds, buttons…) · `fluids.js`: buckets/fluids~ · `life.js`: animal feeding~ · `eyes.js`: eye of ender~ · `fishing.js`: rod/bobber · `book.js`: book editor · `chestlabels.js`/`chesticons.js`: chest labels/icons · `enchantfx.js`: enchant-table book/glyph FX · `gear.js`: enchant offers, shield~ · `grace.js`: spawn-protection border · `onboarding.js`: spawn hints (`/wild`) · `portals.js`: portal FX~ · `end.js`: End fight, boss bar, credits · `ambient.js`: ambient hums (fire/lava/water/furnace)~ · `touch.js`: `SurvivalTouch` |
| entities | `index.js`: `createEntityRenderer` (WebGL mob/item/player models, now also TNT, armour stands, item frames), `loadEntityAssets` (`/assets/atlas/entities.webp`, `items.webp` and their `.json`) · `models.js`: `MODELS`/`KINDS` bone models · `mesh.js`: geometry builders · `anim.js`: `FAMILIES` animations, `STAND_POSES` · `skin.js`: dragon mesh/skin, sponsor logos · `debug.js`: `debugEntities` (TEST only) |
| rules/data | `ids.js`: id ranges · `rules/items.js`: item/block registry (`bindBlocks`, `itemInfo`, `idOf`, `blockName`, `ITEM`) · `achievements` · `books` · `chests` · `combat` · `crafting` · `creative-menu` (`TABS`, `INV`) · `creative-shapes` (doors/beds/torches, `placeCells`, `toggled`) · `enchant` (now also anvil costs, `NAME_MAX`, `customName`) · `end` · `fire` · `food` · `mining` (break ticks, drops) · `names` (`MOB_NAME`) · `portal` · `replace` · `signs` (`SIGN`=174) · `smelting` · `stairs` (`STAIRS`=211) · `variants` (hi-byte variants; now also buttons, anvils, wet variants) |
| net/identity | `net.js`: `createNet` WebSocket client · `proto.js`: wire constants (`PROTO`=6, `FRAME`, `MSG`…) · `identity.js`: `createIdentity` (X token via `/api/me`), `readTok`, `tokI` · `sojo.js`: Sojo SDK loader (`/api/sojo`, `id.sojo.gg`) · `sojo-identity.js`: Sojo account identity, sign-in "pill" · `turnstile.js`: `requestTurnstile` (Cloudflare) |
| audio/voice | `sound.js`: WebAudio SFX, positional `playAt`/`playBlock`, `playFlat`, `setListener` · `music.js`: `createMusic` background music (`MusicPlayer`, pools day/night/creative/nether/end/menu, `/assets/sound/music/manifest.json`) · `voice.js`: `createVoice` proximity voice (WebRTC, `/ws/voice/<room>`, transcription tap) |
| cosmetics | `avatar.js`: skin/cape compositing · `skin-layout.js`: skin UV/parts, VIP/royal lists · `skin-editor.js`, `skin-import.js`, `skin-preview.js` · `wardrobe.js`: `createWardrobe` shop/state (`/api/wardrobe*`, `cos` ticket) |
| sponsors | `sojo-ads.js`: ad fetch/display/view tracking (`/api/ads`) · `world-sponsors.js`: per-world sponsor HUD · `sponsor-tooltip.js` · `dragon-sponsor-preview.js`, `dragonview.js`: 3D dragon sponsor panels |

**New in c111547912** (`MODULES.md` rows): `chat-translate.js`, `fireflies.js`, `frameloop.js`, `glyph-pages.js`, `glyph-ui.js`, `i18n.js`, `landing.js`, `lang-select.js`, `lang/en.js`, `lang/server.js`, `look.js`, `music.js`, `survival/anvil.js`, `survival/fixtures.js`, `translate-lang.js`, plus the asset `assets/sound/music/manifest.json`. No module or export was removed.
- Exports added to existing modules: `chat-pending.cutChat`, `entities/anim.STAND_POSES`, `rules/books.{COST_KEY,NAME_KEY}`, `rules/creative-shapes.{lanternDrop,toggleRest}`, `rules/enchant` (anvil helpers), `rules/fire.fireInfo`, `rules/signs.{signBehind,signShift,signWall}`, `rules/variants` (buttons, anvils, wet variants), `skin-layout.mcCapeTemplate`, `sound.playFlat`, `survival/clicks.{A_LEFT,A_OUT,A_RIGHT,anvilState}`, `ui.canDraw`.

**Area import graph (static):**
- core → {rendering, UI, i18n, survival, rules, net, audio, cosmetics, sponsors}.
- survival → {core (engine, hand, pose-playback, inventory), rendering, entities, rules, net (proto, sojo), UI (menus, ui), i18n, audio}.
- UI → {core (engine, recent), rules, net (proto, turnstile), sponsors, audio, i18n}.
- i18n → {net (lang-select imports sojo)}.
- rendering → cosmetics (gfx imports avatar, skin-layout). Fireflies → rendering (gfx `overlays`).
- net → rendering (net.js imports `angDiff`). entities → rendering (item3d). sponsors → {entities, net (sojo), i18n}. audio → {net (voice imports proto), i18n}.
- Nothing imports main.js.
- The most-imported modules are `rules/items.js` (30 importers) and `i18n.js` (25).

**Lazy `import()`:**
- `Gfx.prototype.entities()` → `./entities/index.js` (gfx.js:1805).
- `survival/end.js:169` → `../dragonview.js`.
- `Font` → `./glyph-ui.js`, on the first CJK glyph (`ui.js:178`).
- `main.js:3257` → `./entities/debug.js` (TEST only).
- The first two are also imported statically (menus → dragon-sponsor-preview → dragonview → entities/index), so they load at boot anyway.
- Lazy external scripts: Turnstile `api.js` (turnstile.js:7) and Sojo `sdk.js` (sojo.js:1, 48-49).

## 3. Boot sequence
1. **`index.html`:**
   - Canvases `#gl #hud #load #inv`, plus `#screen .inner`, `#chatbox` (now `maxlength=256`), `#invsearch`, `#touch`, `#hudtop>#hudleft,#hudright`, `#cross`, `#note`, `#fatal`.
   - modulepreload, then the main.js module script at the end of body, so the DOM exists.
   - Import-time side effects: `menus.js:15` caches `#screen` and `#screen .inner`. `sojo-identity.js:35` and `lang-select.js:3` call `sojoOptions`.
2. **URL parsing** (main.js:105-143):
   - `ROOM` comes from `/r/<16 [a-z0-9]>` or `/play/…`. `TITLE=!ROOM`.
   - Flags: `CARD` (?card preview), `NEW` (?new), `TEST` (DEV && ?test), `CODE` (?c invite), `ROUTE` (#create, #servers, #sponsor, /sponsor-credit), `RETRY_*`, `TOUCH`, `FRAMED` (iframe), `SOJO_PAGE` (`meta[name=sojo]`).
   - On the title page, `sojoConfig()` makes a GET to `/api/sojo`.
3. **Language** (main.js:159-165):
   - `startLanguage(store, {sojoPage})` picks the locale. Order: saved `mc.lang` (ignored on Sojo pages), then the first matching `navigator.languages` entry, then `en`.
   - It fetches `/assets/lang/<code>.json` for a non-English locale.
   - `langReady` becomes true when that settles or after 2.5 s, whichever comes first.
   - On Sojo pages `followSojo()` follows the Sojo locale.
4. **Hash handoff** (main.js:181-201):
   - `#sid` → `mc.sid` (else the stored `mc.sid`, else `rid(20)`).
   - `#tok` → `mc.tok`, `#key` → `mc.key.<room>`, `#admin` → `mc.admin`, `#voice=1`.
   - Then `history.replaceState` strips the hash, `c` and `new`. A userscript must read the hash at document-start.
5. **Module-level setup:**
   - `S` (202), DOM refs (274), `ChatToggle` (283), `worldSponsors` (284, creates `aside#world-sponsors`), `ChatBubbles` (307), `ChatSuggest` (314).
   - `translator` (1496) and the `onLocaleChange` handler (1506).
   - `loop=createFrameLoop(frame)` (547), `net=createNet` (1697), `signs=new SignsClient` (1733), `voice` (1755), `state` (1767).
   - identity (2191-2192), `wardrobe` (3032), `G` (3041), DEV `window.__mc` (3205).
   - Then `boot()` (3283); a failure shows `fatal()`.
6. **`boot()`** (main.js:322):
   - `document.fonts.load('16px "Tweetcraft"')` (324), `preloadButtons()` (326).
   - `gfx = new Gfx(#gl)` (328). Without WebGL2 it shows `fatal`.
   - `initSound()` (332). `music = createMusic(...)` with `music.load()` after 3 s (333-336; not on CARD).
   - It loads `gui/ascii.png` into `new Font` (340) and `block/dirt.png`, then calls `resize()` (338-343).
7. **In parallel** (345-353): `loadEngine("/engine.wasm", seed)`, where seed = `fnv(ROOM)` or `fnv("minecraft.jai.vin title")`. Also `gui/hotbar.png`, `hotbar_selection.png`, `env/clouds.png`, `env/sun.png`, `entity/steve.png` and `gui/toast.png`. Then it reads `WORLD/WORLD_H/CN` from `eng.x.world_*()`, calls `set_lighting(1)` and sets `S.time=6000`.
8. **Tiles:**
   - `loadTiles(eng.texNames)` (363) loads `/assets/block/<name>.png`, skipping empty names (engine.js:78), so the request order is not the layer index.
   - `texNames.indexOf("oak_planks")` (364).
   - `gfx.setTiles(data, n, eng.ft, eng.kind)` (365), then `gfx.setImages({clouds, sun, steve, water})` (366).
   - `gfx.fluidLayers` = the layers of `water_still/water_flow/lava_still/lava_flow` (367-369). Then `new Icons` (370).
   - Door item sprites come from `/assets/atlas/items.json` + `.webp` (`loadItemSprite`, 1257).
9. **Data and UI:**
   - `bindBlocks(eng.blockNames)` (382).
   - `fireflies = new Fireflies(eng)` (383; not on CARD).
   - `hud=new Hud(#hud,…)` (389).
   - `matOf[]` sound materials (`material()`, 1270).
   - `inv=new Inventory(...)` (391).
   - `M.initMenus(G)` (406).
10. **Camera:** on TITLE it uses `spawnPoint()`, 6 blocks up, slowly rotating. CARD uses a fixed yaw. Otherwise `placeSpawn()` (462) picks a random point near spawn. Then `buildSpiral`, `buildTop` (HUD DOM buttons, 2223), and `bindInput` (2546).
11. **Net and identity** (422-446):
    - Sojo page: `identity.start()`, then `net.connect()`.
    - Otherwise: `net.connect()` if ROOM&&!CARD, and `identity.sync()` (`/api/me`).
    - Title: when `SOJO_WAIT` resolves (at most 1.5 s), switch to Sojo identity if `{on}`, and `followSojo()`.
    - Then `loop.start()` (447) starts the frame loop.
12. **Title:** when `meshedFrac()>=1`, Sojo is known **and `langReady`**, `onReady()` (735) runs. It sets `window.__ready=true` and hides `#load`, then opens the card screen, `openCreate`, `openServers`, `openSponsor`, `openMine`, `openSponsored`, or `M.showTitle()` (761).
13. **Room:**
    - `loading()` (650) draws "Joining world..." until `welcome` (`S.room`), then "Loading terrain..." with a % until `synced` and the near chunks are meshed. Creative also spawns after 6 s without `synced`. `?new` worlds run a scripted ~3.7 s sequence.
    - Then `spawn()` (710) sets `S.started=S.ready=true` and `window.__ready=true`, sets the input mode (lock/drag/touch), calls `loadBlockSounds()`, and opens the claim or pending screen if relevant.
    - The loading texts are now `T("load.terrain")` etc.

## 4. Main loop: `frame(now)` (main.js:548), one rAF per frame
1. **The loop:** `createFrameLoop`'s `step` (`frameloop.js:4-8`) calls `requestAnimationFrame(step)` **before** `frame(now)`, so a throwing hook skips the rest of every frame without stopping the loop (the same behaviour as build d7bde3deb9, where `frame` re-armed rAF itself).
   - `frame` first runs a deferred `resize()` if one was requested (549-552; see game-ui.md §3), then `identity.pill?.()`, dt (capped at 0.25 s) and the fps counter.
2. **Fixed tick:** `TICK=0.05` (20 Hz), at most 10 per frame, backlog dropped. Each tick calls `tick()` (610) and `gfx.tickParticles(solidAt)`. `tick()` does:
   - the survival gate (`abort` unless synced) and `survival.tick()`;
   - `S.prev` = position;
   - keys to fwd/str/flags (1 jump, 2 sneak, 4 sprint, 8 touch);
   - `survival.move()`, else **`eng.x.player_tick(fwd,str,flags,sin yaw,cos yaw)`** (WASM physics, 641);
   - survival only (not gm): if `landingPoint(...)` reports a landing, `net.pos(now, true, at)` sends a forced POS at the landing spot (642-645);
   - `holdTick()` (1450: creative held break every 6 ticks via `breakCd=5`, held use every 4; survival mines through `survival.mine()`), `tickHand`, remote swings.
   - Before `S.started` (title, loading) no ticks run at all: `frame` only rotates the yaw (not on CARD).
3. **`updateChunks(5 ms playing / 12 ms loading)`** (1170):
   - `set_focus`, then `remeshSched.run` (`new RemeshSched(4, 250)`, 1169): dirty chunks, nearest first, cap 4; chunks more than 1 away wait 250 ms.
   - Then it fills the spiral of unmeshed chunks within rd+1.
   - Every 1 s it drops meshed chunks beyond rd+3 and calls `survival.prune`.
4. **`updateRemotes(dt)`** (1681): `PosePlayback` sampling, limb animation.
5. **`render(alpha=acc/TICK (1 before started), dt, now)`** (767):
   - Position interpolation, eye height (1.62, crouching 1.27), F5 third-person cam (`camDist`), `eyeInWall`, `HL.lights`, `setListener`, `voice.update`, `raycast()` to `S.sel`, FOV lerp (fly ×1.1, sprint ×1.15), `playerView`.
   - `fireflies.update(dt, {...})` (874).
   - It builds the players list, then calls **`gfx.draw({...})` (886)**, with the new field `lava` (892).
   - Survival only, and not when the eye is in a wall: crack, first-person hands and the burning overlay (912-917). Name tags via `gfx.project`.
   - **`hud.draw({...})` (942)**, then `survival.drawHud` (973), `drawUndoPreview`, `hud.suggestions` and `chatToggle.update` (976).
6. **Then:** `music.update(dt, poolFor({...}))` (575-586), `inv.draw`, `survival.screens.draw()`, `updateAdvancement`, `worldSponsorHUD.update(S)`.
7. **`net.pos(now)`** sends a POS frame only if the player moved. Throttle (`posMs`, main.js:1725): every 100 ms below 50 players, 200 below 200, 333 below 500, else 500. 50 ms while swinging.
8. **Last:** `loading()` / `resuming()` / `onReady()`, the pixelated-menu resize, and the welcome toast.

Input is event-driven (`bindInput`, 2546; `onKeyDown`, 2456):
- Movement and slots: Digit1-9 slot, double-Space fly, double-W sprint.
- Screens: E inventory, Q drop (survival), T/Enter chat, `/` command, Esc pause, Tab player list.
- Account and world: V verify, O owner tools, M new world, P voice.
- View: F1 HUD, F3 debug, F5 camera.
- Mouse: 0 `attack`, 2 `doPlace`, 1 `pick`. `mousemove` calls `turn(movementX,movementY,SENS)` under pointer lock unless `lockJump(e)` rejects it (the first events after locking, or a spike from `createSpikeFilter`, 2433-2442). Drag mode uses DRAG_SENS.
- The key set is unchanged from build d7bde3deb9.

## 5. Game state
**`S`** (main.js:202) is a module-local plain object. Selected fields:
| Group | Fields |
|---|---|
| lifecycle | `started ready closed resuming restored synced loadAt welcomePending takeBack` (set by "Resume playing here"; the next welcome then applies the server's look direction instead of `keepLook`) |
| UI/input | `menu` (build fn or null), `menuName` ("title","pause","inv","sinv","options","claim"…), `chatOpen chatHidden input` ("none","lock","drag","touch"), `keys{code:true} keyed mouse[3] drag look stick tjump tsneak sprint wheel hint flash toast debug showHud tab` |
| camera | `yaw pitch eye fov baseFov view`(0/1/2) `cam[3] eyePos[3] prev[3] sel{x,y,z} inWall rd heldLight` |
| inventory | `hotbar[9] slot itemAt`; survival only: `sinv{s[46],sel} counts[9]` |
| identity/room | `tok{token,handle,name,pfp,(perks,sojo)} myId me owner op creator verifying room{name,mode,hardcore,beaten,pending,host,translate,music} quote ownerStats global achs undoPv` |
| world | `lit time fireflies` (default true; no UI toggle); survival only: `sv{seed,w,gen,time,spawn,grace,dim,fixedTime…}` and `gm` (creative-mode player) |
| chat | `chat[]` (≤60 `{text,color,nameStyle,at, tr?}`; `tr` is added by the translator), `lastWhisper`, `translate` (mirrors the translator's on state) |

Other locals in main.js:
- `eng` holds `x` (WASM exports), `mem`, `nb`, `nt`, `texNames`, `blockNames`, `kind`, `ft`, `st`, `ray`, `ebuf`.
- **`eng.st`** is a Float64Array(12):
  - [0-2] feet xyz, [3-5] velocity, [6] on ground, [7] flying, [8] ?(ladder or in liquid, inferred), [9] crouching.
  - [10] in water, probably at eye level (inferred: it drives the first-person underwater fog, main.js:891, and survival air bubbles, player.js:387; survival/client.js:389 calls it `inWater`).
  - **[11] in lava at eye level** (new use: it drives the first-person lava fog, `lava: … st[11] > 0`, main.js:892).
- **`eng.ray`** is an Int32Array(8): [1-3] hit block, [4-6] face normal, [7] block id.
- Also: `gfx`, `hud`, `font`, `icons`, `inv`, `survival` (SurvivalClient or null), `remotes` (Map id → `{name,h,p,cos,cc,x,y,z,tx..,yaw,pitch,body,limb,crouch,has,sw,motion}`), `self`, `UI{dpr,gs,pad,u,hpx}`, `net`, `identity`, `voice`, `wardrobe`, `signs`, `translator`, `music`, `fireflies`, `loop`.
- **`G`** (3041) is the glue object handed to `M.initMenus(G)` and kept module-local in menus.js:14.
  - It holds `S`, `UI`, `net`, `remotes`, `store`, `ROOM`, `TITLE`, `api()`, `resume`, `chatLine`, `releaseInput`…
  - New: `music` (getter) and `translator`.
  - It is **not reachable** from menus' exports.

**How to reach state from a userscript on prod.** There are no globals except `window.__ready` (boolean) and `document.documentElement.lang` (the current locale code, set by `setLocale`). `window.__mc` exists **only on DEV hosts** (main.js:3205).
| Need | Hook (all are prototypes of exported classes; get them with `await import('/js/<mod>.js')`) |
|---|---|
| S, net, eng, gfx | `SignsClient.prototype.draw(gfx,vp,cam)`: `this.o.S`, `this.o.net`, `this.o.eng()`, `this.o.gfx()`.<br>It runs every frame via gfx `overlays` (gfx.js:1288; the overlay pushed at signs.js:23 calls `this.draw` dynamically), title screen included (verified live on build d7bde3deb9), except while the eye is in a wall.<br>Also `.onMsg(m)` (every JSON message that reaches `onJson`, main.js:1771; net.js consumes `full`/`busy`/`ticket`/`challenge` first) and `.key(e)` (every keydown, main.js:2458) |
| S | `ChatToggle.prototype.update`: `this.state === S`, every frame (main.js:976) |
| eng.x | `RemeshSched.prototype.run(x,…)`: the first argument, every frame (verified live on build d7bde3deb9: `world_w()`=1024 on the title world).<br>Or wrap `WebAssembly.instantiate` at document-start: engine.js:22 is the only caller, and `instance.exports` = `eng.x`, including `memory` |
| gfx, frame params | `Gfx.prototype.draw(v)`: `this` = gfx; `v.cam, yaw, pitch, fov, rd, players, time, lit, dim, under, lava, wall, held, entities` |
| survival | `SurvivalClient.prototype.tick/onMsg/onBin/drawHud`: `this.S`, `this.eng`, `this.net`, `this.o` (callbacks), `this.systems` |
| HUD | `Hud.prototype.draw(o)` (ui.js:641) |
| locale | `import('/js/i18n.js')`: `locale()`, `t(key, vars)`, `onLocaleChange(fn)` (see §9) |

Mutable exported singletons: `overlays`/`solidOverlays` (gfx.js:10-11; push `(gfx,vp,cam,v)=>{}`), `HL` (held-light), `H` (hand.js). `K`/`B` are mutable but don't touch them.

## 6. World data
- **WASM `eng.x` API used by JS:**
  - world: `init(seed) set_world(w) set_gen(g) set_lighting world_w/h/cn find_spawn surface_y light_at`
  - blocks: `get_block set_block get_full raycast`
  - player: `player_set player_tick player_fly player_vel unstuck`
  - meshing: `set_focus pop_dirty mesh_chunk mesh_n mesh_ptr mesh_ymin mesh_ymax`
  - edits/chunks: `apply_edits reset_edits apply_chunk clear_chunk chunk_edits edit_room/edit_fits`
  - tables: `tex_names block_names variant_names tex_full kind_ptr ft_ptr state_ptr ray_ptr ebuf_ptr nblocks ntex`
  - Exported but never called by JS (MODULES.md lists them): `overworld_height overworld_biome stronghold_list stronghold_near fortress_at fortress_list end_spikes copy_box dense_room chunk_pooled shape_probe shape_dump name_probe name_in_ptr hishape_ptr stats_ptr variant_names_ok`. The wasm export list is unchanged in c111547912.
- **Block ids:**
  - 0-254 are base blocks. `eng.nb`=255 live on build d7bde3deb9. Creative uses 0-67, and phases go up to 219 per ids.js. ids.js no longer reserves 169 for buttons; buttons are now hi-byte variants in rules/variants.js.
  - 255 = REVERT.
  - Items are 256-65535 minus the variant range (`ITEM_FIRST/LAST`, ids.js; the defined phases use 256-1023).
  - 4096-32767 are variants `(hi<<8)|lo` (rules/variants.js `withHi`, :38).
- `B` (engine.js:2): AIR 0, STONE 1, GRASS 2, DIRT 3, WATER 9, BEDROCK 12, LAVA 68. `K` kinds (engine.js:1): AIR, SOLID, LEAVES, GLASS, WATER, PLANT, LAVA.
- `eng.kind[id]` gives the kind. `eng.ft[id*6+face]` gives the tile layer.
- **Two name lists:**
  - `eng.blockNames` holds display names ("Fire", "Snow Block", "Enchanting Table") from `block_names()` + `variant_names()` (engine.js:52). `bindBlocks()` (rules/items.js:337) builds `idOf` / `blockName` / `itemInfo`. These names stay English: the UI translates them at display time with `tn(name)` (e.g. `itemLabel`, main.js:1252-1255).
  - **`eng.texNames`** holds texture basenames ("oak_planks", "water_still"…) from `tex_names()` (engine.js:51). Its index is the layer in the `TEXTURE_2D_ARRAY`. On build d7bde3deb9 there were 256 entries live (`eng.nt`), and "oak_planks" was layer 5.
- **`indexOf("oak_planks")`:**
  - It is still the first `indexOf` call on `texNames`: main.js:364 in `boot()`. `eng.texNames.indexOf("oak_planks")` picks the oak-plank tile canvas as the sign background (`signPlank`, given to `SignsClient` as `plank()`).
  - It runs once, after `await loadTiles(texNames)` and immediately before `gfx.setTiles` (365), so the captured names line up 1:1 with the uploaded layers.
  - The next calls are `indexOf("water_still")` (366), then `indexOf` for `water_still, water_flow, lava_still, lava_flow` to fill `gfx.fluidLayers` (367-369).
  - Survival code also calls `blockNames.indexOf("Fire")` / `indexOf("Chest")` (survival/entities.js:521, fluids.js:162, chesticons.js:47, chestlabels.js:18, creative.js:36, screens.js:238). That is the display-name list, so check `v==='oak_planks'`.
  - If the sign texture changes, the capture silently fails. Fallback: call `tex_names()` yourself via the `WebAssembly.instantiate` hook (cstr from `memory`), or read `gfx.fluidLayers` for the fluid layers.
- **Tiles** (`loadTiles`, engine.js:77): each layer is 16×16 RGBA (1024 B). Tints for grass, leaves and water; the grass-side overlay is composited in; water alpha is 170; layers matching `CUTOUT` get an alpha threshold (≥26) and colour bleed. Fire, portals and the four fluid layers are then animated on the GPU by gfx (game-rendering.md §3).
- **Geometry:**
  - Creative/title world: `WORLD`=1024 wide, `WORLD_H`=128, `CN`=64 chunks per side.
  - Survival: `set_world(sv.w)`, e.g. 5120 overworld, 640 nether (rules/portal.js).
  - A chunk is a 16×16×128 column. Chunk index `ci = cz*CN+cx`. Creative block key `(x<<17)|(z<<7)|y` (`blockKey`, proto.js:105).
- **Creative edits:**
  - The server sends edits only. A SYNC frame (3) carries n × [u32 key, u8 block]; they are copied into `eng.ebuf`, then `apply_edits` (main.js:2103).
  - RELAY frames carry live edits. DENY (4) sets or reverts one block (`setKey`, 2113).
  - Local edits go through `edit()` (1327): `set_block`, `net.edit`, `effects()` (particles and sound; anvils now get their own land/break sounds).
- **Survival terrain:**
  - `welcome.sv` drives `init(seed)`, `set_world`, `set_gen` (`SurvivalClient.welcome`, survival/client.js:103).
  - CHUNK_DELTA frames (12) are parsed by `decodeChunks` (wire.js:35): `[u8 12, u8 dim, u16 n]`, then per chunk `[i32 ci, u16 nrec, nrec×(u16 idx=((z&15)*16+(x&15))*128+y, u8 lo, u8 hi|QUIET 128)]`.
  - Unknown chunks go to `TerrainStore.load` (terrain.js:146) and on to `apply_chunk`. Known chunks get per-block `setBlock` + effects (`chunks`, client.js:214).
  - A chunk is meshed only when it and its 8 neighbours are known (`canMesh`, client.js:199).
- **Meshing:**
  - `remesh(ci)` (main.js:1209) calls `mesh_chunk(cx,cz)`, which produces 3 parts.
  - Each part is n quads × 32 B (4 vertices × [u16×3 pos, u8×2 attributes], gfx.js:989). `aPos.x` bit 9 is now a UV flag (game-rendering.md §5).
  - The parts go to `gfx.setChunk(ci,cx,cz,parts,ymin,ymax)`. Part 0 is opaque, part 1 cutout (alpha-tested program), part 2 translucent, drawn in the blended pass (gfx.js:1259-1260, 1283).
  - `gfx.chunks` is a Map; `gfx.dropChunk(ci)`.

## 7. Networking
- **Room socket:** `wss://<host>/ws/<room>` (net.js:20), `binaryType` arraybuffer. Text messages are JSON `{t:…}`; binary messages are frames. Keepalive: text `"ping"` every 25 s (net.js:227); `"pong"` is ignored.
- **Join:**
  - `onopen` → `sendHello` (net.js:60) sends `{t:"hello", v:PROTO(6), rd, sid, key?, token?, code?, admin?, cc, challenge:true, turnstile?, take?, re?, rt?}` (fields from main.js:1706). **`PROTO` went from 5 to 6 in c111547912** (proto.js:1); the hello fields are unchanged.
  - The server may reply:
    - `challenge{sitekey}` → `M.turnstileCheck` (menus.js:206) → `requestTurnstile` (action "guest_join", interaction-only, 6 s, **one try**) → a second hello with the token;
    - `ticket{rt}` (resume ticket);
    - `full`/`busy{retryAfter}`;
    - `welcome{id,you,owner,op,creator,room,quote,players,sv?,st?,revoked?,rt}`, then `synced`.
  - No welcome within 15 s → reject "timeout". Reconnect: 30 s.
  - Close codes: 4002 full, 4004 moved (other tab), 4008 idle, 4009 lost (no retry). Anything else reconnects with a backoff that doubles from 1 to 15 s, jittered ×0.5-2 (net.js:114-115).
- **JSON types:** the lists are `MSG_TO_SERVER`/`MSG_TO_CLIENT` (proto.js:211/266). New in c111547912: `fixture`/`fixturetest` (to server), `fixturetest` (to client), and `MSG` names `CSET, LISTING, CC, FIXTURE, FIXTURETEST`.
  - `onJson` (main.js:1769) handles welcome, synced, sinv, time, moved, idle, spawn, place, signedout, evs, join, leave, who, cos, chat, sys, ach(s), room, you, roles, renamed, undo*, poke, reset, full/busy, kicked and old. Everything else goes to `survival.onMsg` and then each system. `SignsClient.onMsg` sees messages first (1771).
  - The `st` carried by `welcome` and `place` now goes through `keepLook(st, S)` once started (main.js:1850, 1856, 1897), so server state no longer snaps the camera. The exception is the first welcome after "Resume playing here" (`S.takeBack`).
  - Server texts (`sys`, `kicked`) are localised with `srvText(m)` when the server sends a key `k`.
  - Sent from the client: `chat{m,n}`, `view{rd}`, `inv{hotbar,slot}`, `auth{token}`, `cos{k}`, `achs`, `cc{on}`. Survival also sends `dig{s:0 start/1 abort/2 done,x,y,z,f,i}`, `place{x,y,z,f,…prediction}`, `sel{i}`, `attack`, `use`, `click`, `drop`, `aname{w,n}` (anvil rename, survival/anvil.js:84), `fixture{e,h}`….
- **Binary frames** (`FRAME`, proto.js:2):
  - client→server: POS 1 (18 B: f32 x,y,z, i16 yaw×1e4, i16 pitch×1e4, u8 flags 1 crouch/2 fly/4 swing) and EDIT 2 (6 B: u32 key, u8 block; creative only).
    - `net.pos(now, force, at)` gained an optional `at` = [x,y,z] that replaces the position. Survival uses it to report a landing point (main.js:642-645).
  - server→client:
    - SYNC 3; DENY 4.
    - RELAY 5 / RELAY_FULL 6: `u16 np, u16 ne`, np×19 B players, ne×7 B edits, then an optional JSON event array. FULL hides absent players (`onBin`, main.js:2058).
    - ENT_SPAWN..ENT_EQUIP 7-11 (survival/entities.js:120). New `ENT_KIND` tnt 30, armor_stand 31, item_frame 32; new `ENT_EV.POSE` 14.
    - CHUNK_DELTA 12.
  - INV/WINDOW/HEALTH/TIME/DIM (13-17) are defined but not referenced by client code.
- **HTTP** (all same-origin):
  - identity: `/api/me` (GET identity by cookie `mcv=1`, POST bridge token, DELETE logout), `/api/sojo`, `/api/sojo/link`, `/api/sojo/post`, `/api/verify`, `/api/verify/code`, `/api/admin`;
  - worlds: `/api/online`, `/api/servers?…`, `/api/rooms` (POST create → `{id,key}` → `/r/<id>?new#key=`), `/api/rooms/<id>/stats`;
  - chat: `/api/translate` (POST `{room,text,to}` → `{ok,text,from}`; 2 in flight, queue 8, a 429 pauses it; chat-translate.js:98);
  - assets: `/api/pfp?u=`, `/api/skin/…`, `/api/cape/…`, `/assets/lang/<code>.json` (i18n.js:158), `/assets/font/g/<page>.png?v=…` and `/assets/font/g/ui.png` (glyph pages, ui.js `Font.page`), `/assets/sound/music/manifest.json` + its tracks (music.js);
  - shop and ads: `/api/wardrobe*`, `/api/sponsor*`, `/api/ads`;
  - voice: `/ws/voice/<room>` and `/api/voice/<room>/tap` (WS).
  - `G.api()` (main.js:3018) POSTs JSON.
- **To join a world:** open the URL `/r/<id>`, optionally with `?c=<invite>`.
  - The hello needs a `sid`. A token is optional, as are an owner key (`mc.key.<room>`) and an admin key.
  - Turnstile only runs if the server challenges.
  - Whitelist and bans are enforced server-side (`kicked`).
  - An `old` reply means a protocol mismatch, and the game stops with "Update available" (`T("net.update")`).

## 8. Settings and storage
localStorage is reached mostly via `store` (main.js:144, which swallows errors). menus.js:505/530, sojo-ads.js and sojo-identity.js read `localStorage` directly.

| Key | Meaning (where) |
|---|---|
| `mc.fov` | base FOV 30-110, default 70 (read main.js:224, written menus.js:1807) |
| `mc.rd` | render distance in RDS, default 8 (6 on touch) (248, `cycleRd` 3002) |
| `mc.heldLight` | "0" turns off held-item light (221, menus.js:1823) |
| `mc.lang` | **new.** Locale code (`LANG_KEY`, i18n.js:20). Read by `startLanguage` (lang-select.js:15, ignored on Sojo pages), written by the Options "Language" cycle button (`chooseLanguage`, lang-select.js:46) |
| `mc.musicVol` | **new.** Music volume "0".."1", default 0.5 (`VOL_KEY`, music.js:3; written by the Options music slider via `setVolume`) |
| `mc.musicManifest` | **new**, DEV only. Manifest URL override (music.js:255; `?music=` too) |
| `translateChat` | **new, no `mc.` prefix.** "1"/"0" = your Translate chat choice; absent = follow the world's `room.translate` flag (`TRANSLATE_KEY`, chat-translate.js:3,7,49) |
| `mc.hotbar` | JSON [9 ids] creative hotbar (state.js:6/17) |
| `mc.sid` | session id, 20 chars, sent in hello (184-185) |
| `mc.tok` | JSON `{token,handle,name,pfp}` X-account token (186, 251, identity.js) |
| `mc.bridged` | token already bridged to the cookie (identity.js:26/38) |
| `mc.key.<room>` | owner key of a world you created (187-191, menus.js:1783; scanned in menus.js:531) |
| `mc.admin` | admin key, sent in hello and as the `x-admin` header (194) |
| `mc.nonce` | verify-flow nonce (menus.js:2009, sojo-identity.js:91) |
| `mc.cos` / `mc.wardrobe` | cosmetics ticket cache `{key,who,ticket,exp,at}` / owns-cosmetics flag (wardrobe.js:81/84/98) |
| `mc.recent` | comma-separated recent world ids, at most 50 (recent.js:1) |
| `mc.showCountry` | "0"/"1" show flag (country.js:2, menus.js:1828) |
| `mc.adseen` | JSON `{adId:time}` (sojo-ads.js:132) |
| `mc.voiceOff` / `mc.voiceNotice` | "1" = no auto-listen / transcription notice acknowledged (1761, 3150-3201) |

- `fireflies.js:4` exports `KEY = "mc.fireflies"`, but nothing reads or writes it in this build.
- Most keys are read once at module init or boot, so set them before main.js runs for them to take effect.
  - The exceptions: `mc.lang` is read when language selection starts (at main.js module evaluation); `mc.musicVol` is read when `createMusic` runs in `boot()`; `translateChat` is re-read every time the translator checks its `on` getter (chat-translate.js:45).
- There is also the cookie `mcv=1` (verified session). No sessionStorage or IndexedDB.

## 9. Extension points and risks
**Stable enough to hook:**
- Exported names (manifest `exports`) and the prototypes of exported classes: `Gfx`, `Hud`, `Font`, `Icons`, `Inventory`, `SignsClient`, `ChatToggle`, `ChatBubbles`, `ChatTranslator`, `RemeshSched`, `PosePlayback`, `Fireflies`, `SurvivalClient` and every survival `*Client` (including `AnvilClient`, `FixturesClient`), `Screens`, `TerrainStore`, `CrackRenderer`.
- The `overlays`/`solidOverlays` arrays.
- DOM ids from index.html, `#screen` className `on …`, and the CSS vars `--u --d --hp --hb` (set in `resize()`, main.js:521-524).
- `window.__ready`. It goes back to false while a survival world (re)loads (main.js:1828) and true again in `resuming()` (2325).
- At document-start: wrap `WebSocket`, `fetch` and `WebAssembly.instantiate`, or seed `mc.*` keys.
- **i18n (new)**: `import('/js/i18n.js')` gives the game's live instance.
  - `t(key, vars)` returns the current-locale string. It falls back to English (`lang/en.js` + `lang/server.js`) and then to the key itself.
  - `tOr(key, english, vars)` returns your English text when the key doesn't exist.
  - `has(key)`, `locale()`, `localeInfo()` (`{code,name}`) and `LOCALES` (13: en, es, pt-BR, de, fr, it, nl, id, ja, ko, zh-Hans, zh-Hant, ru) are also exported.
  - `onLocaleChange(fn)` returns an unsubscribe function. Listeners run in registration order, after the `/assets/lang/<code>.json` fetch resolves, and only on a real change. Errors are caught.
  - main.js registered first (main.js:1506), so the game has already called `buildTop()` and `M.refresh()` when a mod's listener runs.
  - **Build mod labels with `t()` and re-render them in `onLocaleChange`.** To match game buttons, compute the label with `t()` (e.g. `t("pause.options")`) instead of hard-coding the English text.
  - `setLocale` is exported, but switching the locale is a user choice: leave it to the game's Language button.

**Fragile:**
- Line numbers and minified locals.
- Exact call shapes: the `indexOf('oak_planks')` capture depends on main.js:364 being the first `texNames.indexOf`.
- Field names of `S`, `eng.st`/`eng.ray` slot indices, WASM export names, binary layouts, `menuName` strings.
- **English UI text.** Button labels, aria-labels and dialog titles are `T(key)` now. The English strings are unchanged, so English-text selectors still work in `en` but fail in the 12 other locales.
- Prefer feature checks (does the method exist, does it have the expected arity) and fall back to doing nothing.

**Gotchas:**
- Import game modules only after the DOM exists, at the exact URL `/js/<name>.js`, to get the same instance.
  - `menus.js:15` caches `#screen` at evaluation time.
  - Importing menus.js too early, or anything that pulls it in (`survival/client.js`, `wardrobe.js`, `survival/player.js`, `survival/onboarding.js`, `survival/end.js`), would break every menu.
  - `i18n.js` has no DOM side effects at import (it only sets `<html lang>` on a locale change), so it is safe to import early. `lang-select.js` calls `sojoOptions` at import.
- Module namespaces are read-only: you cannot replace an exported function, only patch the objects and prototypes it exposes.
- `Array.prototype.indexOf` is hot: compare the string first, then do the work.
- Hooks inside `frame()` must not throw. rAF re-arms first (frameloop.js `step`), so a throw silently skips the rest of every frame (rendering, `net.pos`).
- Keep pointer lock working: `#gl` `requestPointerLock`, and `pointerlockchange` opens pause. Do not swallow `window` keydown or mouse events with capturing listeners.
- During IME composition in chat, `onKeyDown` returns early (`composing(e)`, main.js:2333-2334, 2465). Keybind handlers should also skip `e.isComposing || e.keyCode === 229`.

**Never break:**
- **Turnstile:** `challenge`, `turnstileCheck`, the overlay `.turnstile-overlay` (z-index 5000), and the `challenges.cloudflare.com` script. Don't hide, block, auto-solve or delay it. There is one attempt per connection, then "Couldn't join world".
- **The hello payload and `PROTO`** (now 6): the server answers `old` and the game stops.
- **Server authority:**
  - creative edits can be reverted (DENY);
  - survival dig/place are validated, and predictions are rolled back via `digack`/`placeack`;
  - chat is filtered (spam, links, promotion); kicks and bans apply.
  - Don't forge `dig`/`place`/POS traffic or alter movement (that includes calling `net.pos` with an `at` position). The server presumably checks movement too (inferred, the server is not visible).
- **Credentials:** `mc.tok`, Sojo tokens, `mc.admin` and `mc.key.*` are secrets. Never log or send them anywhere.
- `/api/translate` is the game's own request. Our scripts must not call `/api/` endpoints (`npm run check` forbids it).
