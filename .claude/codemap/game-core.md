# Tweetcraft game core codemap (for userscript authors)

Verified against game build f6b38f505d on 2026-11-06 (re-verified from c25d4c024d, itself from 6b3963e444, itself from 575c9209bc, 325afb04b5, c111547912 and d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build f6b38f505d's `pretty/`. They were moved from c25d4c024d with a line diff of the two snapshots, and every inexact match was checked by hand; research notes marked with an older build are as old as that build. "Live" = checked with `npm run probe` on the build named. `~` = responsibility inferred from export names / a skim only.

## 1. Overview
- 165 unbundled ES modules (plus `/engine.wasm`). Build f6b38f505d added 6, c25d4c024d 24, 6b3963e444 16, 575c9209bc one (`rules/chestcopy.js`), 325afb04b5 one (`gpuwatch.js`) and c111547912 15; none were removed. See §2 "New in f6b38f505d", "New in c25d4c024d", "New in 6b3963e444", "New in 575c9209bc" and "New in 325afb04b5".
- `index.html` loads one `<script type="module" src="/js/main.js">` at the end of `<body>`.
- `main.js` (3570 lines) holds boot, state, the main loop, input, net handlers and glue, and **exports nothing**.
- The world simulation (terrain gen, block storage, lighting, player physics, raycast, chunk meshing) runs in **`/engine.wasm`**, wrapped by `js/engine.js`. JS only drives it through `eng.x.*` exports and typed-array views on its memory.
- Creative and title worlds: terrain is generated client-side from a seed. The server only sends block edits.
- Survival: still a WASM seed world, plus server-streamed per-chunk deltas and a server-authoritative dig/place/inventory model (`js/survival/*`).
- Rendering is WebGL2 (`Gfx`, `gfx.js`). The HUD is a 2D canvas (`Hud`, `ui.js`). Menus are DOM in `#screen` (`menus.js`). Networking is one JSON+binary WebSocket per room (`net.js`, `proto.js`).
- All user-visible text now goes through `i18n.js` (`t(key)`), in 13 locales (§9).
- Central state is a module-local `S` object in main.js (main.js:188). Prod has no global handle to it. Reach it through prototype hooks on exported classes (§5, §9).

## 2. Module map (js/…)
| Area | Module: responsibility |
|---|---|
| core | `main.js`: boot/loop/input/net glue (no exports) · `frameloop.js`: `createFrameLoop` (the rAF loop), `backingDpr`/`MAX_PX` (canvas DPR cap) · `gpuwatch.js` (new in 325afb04b5): `createSlowWatch` (slow-frame watchdog, §4), `gpuName`/`shortGpu` (renderer name for F3), `isSoftware`/`SOFTWARE` (software-renderer regex) · `state.js`: `createState` (apply server state, hotbar save, `inv` sync), `loadHotbar` · `engine.js`: WASM loader `loadEngine` (its result `eng` now also has `idTop` and `copyBox16`, §6), `K` kinds, `B` ids, `loadTiles`, `loadImage`, `withVariants` · `devhost.js`: `DEV` (localhost or staging host) · `remesh-sched.js`: `RemeshSched` chunk remesh time budget and settle delay · `hand.js`: first-person hand/swing state `H` · `pose-playback.js`: `PosePlayback` remote-player interpolation · `look.js`: `keepLook` (keeps the local yaw/pitch when server state is applied), `createSpikeFilter` (drops outlier mouse-look deltas) · `landing.js`: `landingPoint` (survival landing position for a forced POS) · `recent.js`: recent worlds (`mc.recent`) · `signs.js`: `SignsClient` (sign records, editor, 3D sign text overlay) · `fnv.js`: `fnv` (moved out of main.js) · `histkey.js`: `histCodec` (undo-history block keys) · `item-look.js`: `itemLook`, `bindLook` (how an id is drawn as an item, §2) · `keys.js` (new in f6b38f505d): the key-bind table and every lookup on it (§2, §9) · `frametime.js` (new in f6b38f505d): `createFrameTimes`, `PH` (per-phase frame timers, §4) |
| i18n | `i18n.js`: `t, tOr, tn, srvText, locale, localeInfo, setLocale, onLocaleChange, LOCALES, LOCALE_CODES, LANG_KEY, wrapText…` · `lang/en.js`: the English catalog (default export) · `lang/server.js`: `srv.*` keys for server messages · `lang-select.js`: `startLanguage`, `chooseLanguage`, `followSojo` (Sojo locale sync) · `glyph-pages.js` / `glyph-ui.js`: glyph-page advance tables and the frequent-CJK glyph list for `ui.Font` (data only) |
| rendering | `gfx.js`: `Gfx` renderer, matrices, `playerView`, exported `overlays`/`solidOverlays` arrays · `item3d.js`: item display/pose transforms · `held-light.js`: held-item dynamic lights `HL`, `eyeInWall`, `LANTERN_LEVEL` · `outline.js` (new in f6b38f505d): `pickOutline`, `outlineEdges` (the block outline's edges, game-rendering.md §3) · `view.js`: `RDS` [4,6,8,10,12], nether fog · `fireflies.js`: `Fireflies` (night fireflies, an `overlays` callback) |
| UI | `ui.js`: `el`, `button`, `hudButton`, bitmap `Font` (now with on-demand glyph pages), `canDraw`, `Icons`, `Hud`, `note`, `drawLoading`, `preloadButtons` · `menus.js`: every DOM screen (`showScreen`, `showTitle`, `openPause`, `openOptions`, `turnstileCheck`…) · `inventory.js`: `Inventory` creative inventory on `#inv` · `chat-bubbles.js`: 3D chat bubbles · `chat-pending.js`: unconfirmed chat lines (nonces), `CHAT_MAX`=256, `cutChat` · `chat-style.js`: name styling, VIP rainbow, wrapping · `chat-suggest.js`: command/name autocomplete · `chat-toggle.js`: `ChatToggle` "Hide chat" button · `chat-whisper.js`: `/msg` whispers, `visibleChat` · `chat-translate.js`: `ChatTranslator` (auto-translates incoming chat via `/api/translate`) · `translate-lang.js`: target-language mapping and language detection for it · `chat-notice.js`: "Self-promotion blocked" dialog · `wl-suggest.js`: whitelist handle suggest · `country.js`/`country-mark.js`: show-country setting, flag marks by names · `blueprint-ui.js`: blueprint screen, corner pick and paste ghost · `controls.js` (new in f6b38f505d): `openControls`, the key-rebinding screen (game-ui.md §2) |
| survival | `client.js`: `SurvivalClient` hub (systems list, terrain, dig/place, predictions) · `wire.js`: chunk-delta codec · `terrain.js`: `TerrainStore` (known/parked chunks, radius) · `player.js`: `PlayerClient` health/hunger/combat~ · `screens.js`: `Screens` container windows on `#inv` · `clicks.js`: window click/craft/furnace/anvil slot logic · `anvil.js`: `AnvilClient` (anvil screen, `#anvil-name` rename input) · `fixtures.js`: `FixturesClient` (armour stands, item frames) · `entities.js`: `SurvivalEntities` (ENT_* frames, `view()` for gfx) · `equipment.js`: worn/held gear, `eq`/`phurt` · `hud.js`: `SurvivalHud` bars, `hurtTilt` · `items.js`: `SurvivalIcons` item atlas · `crack.js`: `CrackRenderer` break-crack GLSL · `creative.js`: creative inventory for gm players (since 575c9209bc also Ctrl+middle-click copy of a chest with its contents) · `place-prediction.js` / `drop-prediction.js`: optimistic place/drop · `blocks.js`: usable blocks (doors, beds, buttons…) · `fluids.js`: buckets/fluids~ · `life.js`: animal feeding~ · `eyes.js`: eye of ender~ · `fishing.js`: rod/bobber · `book.js`: book editor · `chestlabels.js`/`chesticons.js`: chest labels/icons · `enchantfx.js`: enchant-table book/glyph FX · `gear.js`: enchant offers, shield~ · `grace.js`: spawn-protection border · `onboarding.js`: spawn hints (`/wild`) · `portals.js`: portal FX~ · `end.js`: End fight, boss bar, credits · `ambient.js`: ambient hums (fire/lava/water/furnace)~ · `touch.js`: `SurvivalTouch` · `hotbars.js`: `Hotbars` (the `loadout`, `saveToolbar` and `loadToolbar` binds; R, C and X by default) · `recipe-book.js` / `recipe-fill.js`: `RecipeBook`, filling the crafting grid · `cutter.js`: `CutterClient` (stonecutter window) · `cyclone.js`: `CycloneClient` (the cyclone boss's HUD bar; it has no sky or weather effect) · `campfires.js`: `CampfiresClient` (food on campfires, an `overlays` callback) · `pistonfx.js`: `PistonFx` · `overlay-pass.js`: `overlayBegin`/`overlayEnd`, shared by claims and grace |
| entities | `index.js`: `createEntityRenderer` (WebGL mob/item/player models, now also TNT, armour stands, item frames), `loadEntityAssets` (`/assets/atlas/entities.webp`, `items.webp` and their `.json`) · `models.js`: `MODELS`/`KINDS` bone models · `mesh.js`: geometry builders · `anim.js`: `FAMILIES` animations, `STAND_POSES` · `skin.js`: dragon mesh/skin, sponsor logos · `debug.js`: `debugEntities` (TEST only) |
| rules/data | `ids.js`: id ranges, and since 325afb04b5 `baseOf` (an id's base block), `BASE_TOP`/`ID_TOP` and the wide-id band (§6) · `rules/items.js`: item/block registry (`bindBlocks`, `itemInfo`, `idOf`, `blockName`, `ITEM`) · `achievements` · `books` · `chestcopy` (new in 575c9209bc: `CC_KEY` = `"cc"`, `chestRef`, `cleanRef`, `refHash`; the `cc` field of an item's meta that marks a chest carrying copied contents) · `chests` · `combat` · `crafting` · `creative-menu` (`TABS`, `INV`) · `creative-shapes` (doors/beds/torches, `placeCells`, `toggled`) · `enchant` (now also anvil costs, `NAME_MAX`, `customName`) · `end` · `fire` · `food` · `mining` (break ticks, drops) · `names` (`MOB_NAME`) · `portal` · `replace` · `signs` (`SIGN`=174) · `smelting` · `stairs` (`STAIRS`=211) · `variants` (hi-byte variants; now also buttons, anvils, wet variants) · new in c25d4c024d: `blueprint`, `campfire`, `cyclone`, `dispensers`, `hoppers`, `kinds` (per-mode rule defaults), `lectern`, `pistons`, `roles` (`PERMS`, `MENU_PERMS`), `stonecutter`, `tripwire` · new in f6b38f505d: `backpack` (`WORN`, `BP_SLOTS`, `isBackpack`, `wornLantern`…), `loadouts` (`rowCount`, `hasRow`, `moveRows`) |
| net/identity | `net.js`: `createNet` WebSocket client · `proto.js`: wire constants (`PROTO`=20, `FRAME`, `MSG`…) · `identity.js`: `createIdentity` (X token via `/api/me`), `readTok`, `tokI` · `sojo.js`: Sojo SDK loader (`/api/sojo`, `id.sojo.gg`) · `sojo-identity.js`: Sojo account identity, sign-in "pill" · `turnstile.js`: `requestTurnstile` (Cloudflare) |
| audio/voice | `sound.js`: WebAudio SFX, positional `playAt`/`playBlock`, `playFlat`, `setListener`, and since c25d4c024d per-category gains (`setVolumes`, `soundLevel`) · `sound-cats.js`: `CATS`, `eventCat`, `fileCat`, `readVolumes`, `saveVolume` · `music.js`: `createMusic` background music (`MusicPlayer`, pools day/night/creative/nether/end/menu, `/assets/sound/music/manifest.json`) · `voice.js`: `createVoice` proximity voice (WebRTC, `/ws/voice/<room>`, transcription tap) |
| cosmetics | `avatar.js`: skin/cape compositing · `skin-layout.js`: skin UV/parts, VIP/royal lists · `skin-editor.js`, `skin-import.js`, `skin-preview.js` · `wardrobe.js`: `createWardrobe` shop/state (`/api/wardrobe*`, `cos` ticket) |
| sponsors | `sojo-ads.js`: ad fetch/display/view tracking (`/api/ads`) · `world-sponsors.js`: per-world sponsor HUD · `sponsor-tooltip.js` · `dragon-sponsor-preview.js`, `dragonview.js`: 3D dragon sponsor panels |

**New in f6b38f505d** (rebindable keys, backpacks, frame timers, shaped block outlines). Six new modules, none removed; all 35 GLSL files are byte-identical to c25d4c024d's and the terrain atlas didn't change:
- **Key binds:** `keys.js` holds `BINDS`, one row per action with an `id`, default code `def`, optional second code `alt`, a `cat` and a `scope` (`game`, `row`, `place` or `debug`). The user's changes live in `mc.keys` (§8). `main.js`, `inventory.js` and `survival/{screens,hotbars,creative,horse,player}.js` all ask it instead of testing codes, and mouse buttons are codes too (`Mouse0`…). `KB.prevent` replaces main.js's `PREVENT` set. Input details: game-ui.md §5.
- **Controls screen:** `controls.js`, opened from Options when not on touch (game-ui.md §2).
- **Frame timers:** `frametime.js`; main.js's `ft` (:489) splits each frame into phases and keeps the last 20 slow ones (§4).
- **Block outline:** `outline.js` plus the wasm's `pick_dump` give the outline a block's real shape, drawn by a new path in `drawSel` (game-rendering.md §3).
- **Backpack:** item 411 (`ITEM.backpack`, stack 1) is worn in inventory slot `WORN` = 46 and holds `BP_SLOTS` = 18 items plus a lantern slot (`BP_LANTERN`), stored in the item's meta under `"bp"`. `S.sinv.s` now has 47 entries, the `inv` window has client slots `BP_FIRST`-`BP_LAST` (47-65) and grows taller while one is worn (`Screens.bpOn`, `hgt`, `drawBp`, survival/screens.js:201-208, 762). A worn lantern is a held-style light, for remote players too (`w[7]` bit 32; bit 16 = backpack worn; game-rendering.md §7).
- **Loadouts:** `rules/loadouts.js`. Hotbar rows go from 4 to 6 with a backpack on, and there are bind rows for R + 1-5 (`row1`-`row5`).
- **`menus.js`:** `kit()` now also returns `G` and `text`, which makes `G` reachable from a mod (§5, §9).
- **`proto.js`:** `PROTO` 19 → 20. Nothing else in the file changed.
- **`engine.wasm`** (167 → 168 KB): adds `pick_dump`. Nothing was removed.
- **Settings:** `mc.keys` (§8).

**New in c25d4c024d.** Twenty-four new modules, none removed:
- **Blueprints:** `blueprint-ui.js` and `rules/blueprint.js`. Save a build of at most 32 blocks per side, share it by link and paste it, for creative-mode players (`S.gm`). `?bp=<link>` is stashed at startup (`BP.stashLink`, main.js:103). The paste ghost goes through the undo preview's `gfx.setPreview` (`S.undoPv?.cells || BP.cells()`). `BP.active()` is true during a corner pick or a ghost (blueprint-ui.js:186) and claims the `place`-scope keys in `onKeyDown` (main.js:2658, game-ui.md §5). It has no DOM sign.
- **Sounds:** nine volume categories in `sound-cats.js`, each with its own gain node in `sound.js`. `music.setMaster` and `voice.setVolume` follow them. The Options music slider became the `sounds` screen (game-ui.md §2).
- **Item looks:** `item-look.js` is the one table of how an id is drawn: `itemLook(id)` returns `{key}` (atlas sprite), `{layer}` (flat tile), `{boxes}` (shape) or `{cube}`. It replaces `icons.flat`, `icons.models`, `loadItemSprite`, `gfx.itemSprite` and `gfx.flatBlock`.
- **New survival systems:** `survival/hotbars.js`, `recipe-book.js`, `recipe-fill.js`, `cutter.js`, `cyclone.js`, `campfires.js` and `pistonfx.js`, with the rules in `rules/` (§2). `SurvivalClient` holds them as `hotbars`, `cutter`, `cyclone`, `campfires` and `pistonfx`, and `fluids` is now a field too. Pistons, dispensers, droppers, hoppers, tripwire hooks, lecterns and the stonecutter are new blocks.
- **Roles and world kinds:** named roles with permissions (`S.perms`, `rules/roles.js`), `staff()` and `mayFly()` (main.js:1554, 1551). `S.room.caps` (`ach`, `undo`, `lock`) replaces `room.mode` checks in menus, and owner toggles are `{t:"rule",k,v}` messages rather than chat commands.
- **Reconnects:** a survival reconnect now keeps open screens and editors (`S.rejoin`, `S.rejoined`, `S.reopenPause`, `overlayOpen()`, main.js:3083). `signs.flush()` sends a sign text written while offline.
- **Rendering:** program `09-textured` is gone, and held blocks go through the entity renderer. Every other shader is byte-identical, with the later programs renumbered (game-rendering.md §4). The atlas has 347 layers.
- **`proto.js`:** `PROTO` 11 → 19. `ENT_KIND` gains `squid`, `cyclone`, `cyclone_smoke`, and `MSG` gains `rule`, `cut`, `hrow`, `bpSave`, `bpList`, `bpDel`, `bpLoad`, `bpPaste`.
- **`engine.wasm`** (149 → 167 KB): adds `ent_boxes`, `ent_box_ptr` (wrapped as `eng.entBoxes`) and `id_collides` (used by `inTheWay`, rules/replace.js, in `doPlace`). Nothing was removed.
- **Net:** `net.ping()` and `net.rtt` measure latency from the keepalive (§7).
- **Settings:** `mc.vol.<cat>`, `mc.hotbars`, `mc.bpLink` (§8).

**New in 6b3963e444** (riding, sparks, rails, claims and a texture atlas over 256 layers). Sixteen new modules, none removed:
- **Riding:** `survival/riding.js` (`RidingClient`: seats, the `ride` message, `remoteSeat`, vehicle HUD), `survival/ridefx.js`, `survival/boat.js`, `survival/cart.js`, `survival/horse.js`, with the shared rules in `rules/seats.js`, `rules/boat.js`, `rules/cart.js`, `rules/horses.js`. `SurvivalClient` holds them as `riding`, `cart` and `horses`. Boats, minecarts, horses and pigs can be ridden. `render` draws a seated player from the seat (`sit`, main.js:905-906, 927). None of this touches FOV.
- **Sparks and rails:** `rules/spark.js`, `rules/spark-place.js`, `rules/rails.js` (the game's redstone: dust, torches, repeaters, comparators, lamps, plates, powered/detector/activator rails).
- **World rules:** `survival/claims.js` (`ClaimsClient`, land claims), `survival/spawnrule.js` (spawn protection), `rules/throws.js`.
- **Rendering:** `texpages.js`, for atlases over the GPU's layer limit (game-rendering.md §5). Terrain's layer is now 9 bits, and stained glass is marked by `uGlass`, not by layers ≥ 240.
- **`proto.js`:** `PROTO` 7 → 11. `POS_FLAG` gains `SEAT` and `FWD`, `ENT_KIND` gains `boat`, `minecart`, `horse`, `ENT_EV` gains `RIDE`, `RIDE2`, `TAME`, and `MSG` gains `sparktest`, `egg`, `ride`, `refill`, `claims`, `sv`.
- **`engine.wasm`** (129 → 149 KB): adds `ft_width`, `texf_ptr`, `tex_glass`, `tex_probe`, `body_move`, `body_out_ptr`, `mesh_vfmt`, `mesh_vstride`, `dust_sides_at`, and drops `copy_box`.
- **Canvases:** `regainCanvases` no longer touches `#gl` or `#inv` (§4), and `#inv` is 1×1 while hidden (game-ui.md §3).
- **Settings:** `mc.refill` (§8).

**New in 575c9209bc** (a small gameplay update; nothing rendering-, HUD- or menu-related changed, and no hook of ours touches these files):
- Module `rules/chestcopy.js` (exports `CC_KEY, chestRef, cleanRef, refHash`), imported by `rules/enchant.js`, `survival/creative.js` and `survival/gear.js`. `rules/books.js` adds `"cc"` to its meta keys, and `cleanEnch` keeps a valid `cc` ref.
- Behaviour: in creative mode, **Ctrl (or Cmd) + middle-click** on a plain chest puts a chest item that carries a copy of its contents in the hotbar (`survival/creative.js` `pick()` :154, the chest branch :160-172). The flag comes from **capture-phase listeners on `window`** at module load (:53-59) that only record `e.ctrlKey || e.metaKey` and never call `preventDefault`; since f6b38f505d they follow the `pickItem` bind, on `mousedown` and `keydown`. Such items show a grey "+ Contents" tooltip line (`inv.chestCopy`, in the creative hotbar tooltip and in `GearClient` tooltips). New strings: `inv.chestCopy` (lang/en.js:315) and `room.chest_copy_gone` (lang/server.js:137).

**New in 325afb04b5:**
- Module `gpuwatch.js` (exports `SOFTWARE, createSlowWatch, gpuName, isSoftware, shortGpu`). main.js uses it for the F3 `GPU:`/`Frame:` lines and the slow-frame watchdog (§4).
- `ids.js` (not new) gained `BASE_TOP` (4096), `ID_TOP` (32768), `WIDE_FIRST`/`WIDE_LAST` (1024/4095), `PHASE_WIDE`, `baseOf`, `isWide`, `isRegisteredWide`, `registerWide`, `isRevert`. The modules that used `id & 255` or 256-entry tables now import `baseOf`/`BASE_TOP` from it (engine, gfx, fireflies, held-light, ui, entities/index, rules/*, survival/ambient, place-prediction, terrain).
- `survival/terrain.js` gained `knownTo`, `unknownRecord`, `dropUnknownWide`. `survival/entities.js` now exports `SPRITE`.
- `engine.wasm` changed (125 → 129 KB) and gained the exports `copy_box16`, `id_top` and `ids_probe`.
- Behaviour: `frame()` measures itself, a slow-frame watchdog re-allocates the canvases, and a WebGL context loss reloads the page (§4). Middle-click clones a stack in the creative inventory and, for creative-mode players, in survival containers (`CLICK_MODE.CLONE` = 3, proto.js). `PROTO` is 7 and the handshake gained a field (§7).

**New in c111547912** (`MODULES.md` rows): `chat-translate.js`, `fireflies.js`, `frameloop.js`, `glyph-pages.js`, `glyph-ui.js`, `i18n.js`, `landing.js`, `lang-select.js`, `lang/en.js`, `lang/server.js`, `look.js`, `music.js`, `survival/anvil.js`, `survival/fixtures.js`, `translate-lang.js`, plus the asset `assets/sound/music/manifest.json`. No module or export was removed.
- Exports added to existing modules: `chat-pending.cutChat`, `entities/anim.STAND_POSES`, `rules/books.{COST_KEY,NAME_KEY}`, `rules/creative-shapes.{lanternDrop,toggleRest}`, `rules/enchant` (anvil helpers), `rules/fire.fireInfo`, `rules/signs.{signBehind,signShift,signWall}`, `rules/variants` (buttons, anvils, wet variants), `skin-layout.mcCapeTemplate`, `sound.playFlat`, `survival/clicks.{A_LEFT,A_OUT,A_RIGHT,anvilState}`, `ui.canDraw`.

**Area import graph (static):**
- core → {rendering, UI, i18n, survival, rules, net, audio, cosmetics, sponsors}.
- survival → {core (engine, hand, pose-playback, inventory), rendering, entities, rules, net (proto, sojo), UI (menus, ui), i18n, audio}.
- UI → {core (engine, recent), rules, net (proto, turnstile), sponsors, audio, i18n}.
- i18n → {net (lang-select imports sojo)}.
- rendering → cosmetics (gfx imports avatar, skin-layout). Fireflies → rendering (gfx `overlays`).
- Since 325afb04b5, core, rendering, UI, entities and survival also import `ids.js` (rules/data) for `baseOf`/`BASE_TOP`; it now has 22 importers.
- net → rendering (net.js imports `angDiff`). entities → rendering (item3d). sponsors → {entities, net (sojo), i18n}. audio → {net (voice imports proto), i18n}.
- Nothing imports main.js.
- The most-imported modules are `rules/items.js` (40 importers) and `i18n.js` (31).

**Lazy `import()`:**
- `Gfx.prototype.entities()` → `./entities/index.js` (gfx.js:1861).
- `survival/end.js:170` → `../dragonview.js`.
- `Font` → `./glyph-ui.js`, on the first CJK glyph (`ui.js:179`).
- `main.js:3541` → `./entities/debug.js` (TEST only).
- The first two are also imported statically (menus → dragon-sponsor-preview → dragonview → entities/index), so they load at boot anyway.
- Lazy external scripts: Turnstile `api.js` (turnstile.js:7) and Sojo `sdk.js` (sojo.js:1, 48-49).

## 3. Boot sequence
1. **`index.html`:**
   - Canvases `#gl #hud #load #inv`, plus `#screen .inner`, `#chatbox` (now `maxlength=256`), `#invsearch`, `#touch`, `#hudtop>#hudleft,#hudright`, `#cross`, `#note`, `#fatal`.
   - modulepreload, then the main.js module script at the end of body, so the DOM exists.
   - Import-time side effects: `menus.js:19` caches `#screen` and `#screen .inner`. `sojo-identity.js:43` and `lang-select.js:3` call `sojoOptions`.
2. **URL parsing** (main.js:99-137):
   - `ROOM` comes from `/r/<16 [a-z0-9]>` or `/play/…`. `TITLE=!ROOM`.
   - Flags: `CARD` (?card preview), `NEW` (?new), `TEST` (DEV && ?test), `CODE` (?c invite), `ROUTE` (#create, #servers, #sponsor, /sponsor-credit), `RETRY_*`, `TOUCH`, `FRAMED` (iframe), `SOJO_PAGE` (`meta[name=sojo]`). New: `?bp=` is stashed for the blueprint screen (103).
   - On the title page, `sojoConfig()` makes a GET to `/api/sojo`.
3. **Language** (main.js:153-159):
   - `startLanguage(store, {sojoPage})` picks the locale. Order: saved `mc.lang` (ignored on Sojo pages), then the first matching `navigator.languages` entry, then `en`.
   - It fetches `/assets/lang/<code>.json` for a non-English locale.
   - `langReady` becomes true when that settles or after 2.5 s, whichever comes first.
   - On Sojo pages `followSojo()` follows the Sojo locale.
4. **Hash handoff** (main.js:167-187):
   - `#sid` → `mc.sid` (else the stored `mc.sid`, else `rid(20)`).
   - `#tok` → `mc.tok`, `#key` → `mc.key.<room>`, `#admin` → `mc.admin`, `#voice=1`.
   - Then `history.replaceState` strips the hash, `c` and `new`. A userscript must read the hash at document-start.
5. **Module-level setup:**
   - `S` (188), DOM refs (261), `ChatToggle` (270), `worldSponsors` (271, creates `aside#world-sponsors`), `ChatBubbles` (294), `ChatSuggest` (301).
   - `translator` (1603) and the `onLocaleChange` handler (1613).
   - `loop=createFrameLoop(frame)` (561), then (new) the module-local `gpu` stats object and `slowWatch = createSlowWatch()` (562-563). `net=createNet` (1827), `signs=new SignsClient` (1872), `voice` (1894), `state` (1910).
   - identity (2355-2356), `wardrobe` (3299), `G` (3308), DEV `window.__mc` (3483; it now also exposes `gpu`, `regainCanvases`, `debugLines` and `debugTop`).
   - Then `boot()` (3567); a failure shows `fatal()`.
6. **`boot()`** (main.js:309):
   - `document.fonts.load('16px "Tweetcraft"')` (311), `preloadButtons()` (313).
   - `gfx = new Gfx(#gl)` (315). Without WebGL2 it shows `fatal`.
   - New: `gpu.name = gpuName(gfx.gl)` (319) reads `WEBGL_debug_renderer_info` once, for the F3 `GPU:` line.
   - `initSound()` (321), then `setVolumes(readVolumes(store))` (322, new). `music = createMusic(...)`, `music.setMaster(...)` (new) and `music.load()` after 3 s (324-328; not on CARD).
   - It loads `gui/ascii.png` into `new Font` (332) and `block/dirt.png`, then calls `resize()` (330-335).
7. **In parallel** (337-345): `loadEngine("/engine.wasm", seed)`, where seed = `fnv(ROOM)` or `fnv("minecraft.jai.vin title")`. Also `gui/hotbar.png`, `hotbar_selection.png`, `env/clouds.png`, `env/sun.png`, `entity/steve.png` and `gui/toast.png`. Then it reads `WORLD/WORLD_H/CN` from `eng.x.world_*()`, calls `set_lighting(1)` and sets `S.time=6000`.
8. **Tiles:**
   - `loadTiles(eng.texNames)` (355) loads `/assets/block/<name>.png`, skipping empty names (engine.js:115), so the request order is not the layer index.
   - `texNames.indexOf("oak_planks")` (356).
   - `gfx.setTiles(data, n, eng.ft, eng.kind)` (357), then `gfx.setImages({clouds, sun, steve, water})` (358).
   - `gfx.fluidLayers` = the layers of `water_still/water_flow/lava_still/lava_flow` (359-361), plus `campfire_fire` (362, new). Then `new Icons` (363).
   - Item looks come from `bindLook(eng)` and `item-look.js` (365, new); `loadItemSprite` and the `icons.flat`/`icons.models` setup are gone.
9. **Data and UI:**
   - `bindBlocks(eng.blockNames)` (364). Since 325afb04b5 it also registers the named wide ids (`registerWide`, rules/items.js:406).
   - `fireflies = new Fireflies(eng)` (366; not on CARD).
   - `hud=new Hud(#hud,…)` (372).
   - `matOf[]` sound materials (`material()`, 1370).
   - `inv=new Inventory(...)` (374).
   - `M.initMenus(G)` (389), `BP.initBlueprints(G)` (390, new).
10. **Camera:** on TITLE it uses `spawnPoint()`, 6 blocks up, slowly rotating. CARD uses a fixed yaw. Otherwise `placeSpawn()` (447) picks a random point near spawn. Then `buildSpiral`, `buildTop` (HUD DOM buttons, 2387), and `bindInput` (2759).
11. **Net and identity** (406-430):
    - Sojo page: `identity.start()`, then `net.connect()`.
    - Otherwise: `net.connect()` if ROOM&&!CARD, and `identity.sync()` (`/api/me`).
    - Title: when `SOJO_WAIT` resolves (at most 1.5 s), switch to Sojo identity if `{on}`, and `followSojo()`.
    - Then `loop.start()` (431) starts the frame loop.
12. **Title:** when `meshedFrac()>=1`, Sojo is known **and `langReady`**, `onReady()` (815) runs. It sets `window.__ready=true` and hides `#load` (`hideLoad`, 439, which now also shrinks `#load` to 1×1), then opens the card screen, `openCreate`, `openServers`, `openSponsor`, `openMine`, `openSponsored`, or `M.showTitle()` (841).
13. **Room:**
    - `loading()` (730) draws "Joining world..." until `welcome` (`S.room`), then "Loading terrain..." with a % until `synced` and the near chunks are meshed. Creative also spawns after 6 s without `synced`. `?new` worlds run a scripted ~3.7 s sequence.
    - Then `spawn()` (790) sets `S.started=S.ready=true` and `window.__ready=true`, sets the input mode (lock/drag/touch), calls `loadBlockSounds()`, and opens the claim or pending screen if relevant.
    - The loading texts are now `T("load.terrain")` etc.

## 4. Main loop: `frame(now)` (main.js:593) → `frameBody(now)` (608), one rAF per frame
1. **The loop:** `createFrameLoop`'s `step` (`frameloop.js:4-8`) calls `requestAnimationFrame(step)` **before** `frame(now)`, so a throwing hook skips the rest of every frame without stopping the loop (the same behaviour as build d7bde3deb9, where `frame` re-armed rAF itself). The global `requestAnimationFrame` is looked up on every call, so a wrapper installed at document-start is the one used.
   - **New in 325afb04b5:** `frame` is now a thin timer around `frameBody`. It adds `now − previous now` (the rAF interval) and the `performance.now()` time spent inside `frameBody` to per-second sums (593-607). See "Frame timing" below.
   - **New in f6b38f505d:** `frame` also calls `ft.begin(now)` (594) and `ft.end()` (605), and `frameBody` marks each phase with `ft.to(PH.…)`. See "Phase timers" below. Remesh order is unchanged.
   - `frameBody` is the old `frame`. It first runs a deferred `resize()` if one was requested, or if `#load` is showing but still 1×1, or `#inv` is stale (`invStale`) (609-612; see game-ui.md §3), then `identity.pill?.()`, `identity.signInPost?.()` (new), dt (capped at 0.25 s) and the fps counter. When the counter rolls over (once a second, 618-633) it sets `S.fps`, `gpu.frameMs`, `gpu.jsMs`, `gpu.worstMs` and `gpu.slow`, calls `remeshSched.second()` and, while F3 is on, `net.ping()`, then calls `watchGpu(now)`.
2. **Fixed tick:** `TICK=0.05` (20 Hz), at most 10 per frame, backlog dropped. Each tick calls `tick()` (690) and `gfx.tickParticles(solidAt)`. `tick()` does:
   - the survival gate (`abort` unless synced) and `survival.tick()`;
   - `S.prev` = position;
   - keys to fwd/str/flags (1 jump, 2 sneak, 4 sprint, 8 touch), since f6b38f505d through `KB.held(id, S.keys)` (708-716);
   - `survival.move()`, else **`eng.x.player_tick(fwd,str,flags,sin yaw,cos yaw)`** (WASM physics, 721);
   - survival only (not gm): if `landingPoint(...)` reports a landing, `net.pos(now, true, at)` sends a forced POS at the landing spot (722-725);
   - `holdTick()` (1557: creative held break every 6 ticks via `breakCd=5`, held use every 4; survival mines through `survival.mine()`), `tickHand`, remote swings.
   - Before `S.started` (title, loading) no ticks run at all: `frame` only rotates the yaw (not on CARD).
3. **`updateChunks(5 ms playing / 12 ms loading)`** (1276):
   - `set_focus`, then `remeshSched.run` (`new RemeshSched(4, 250)`, 1275): dirty chunks, nearest first, cap 4; chunks more than 1 away wait 250 ms.
   - Then it fills the spiral of unmeshed chunks within rd+1.
   - Every 1 s it drops meshed chunks beyond rd+3 and calls `survival.prune`.
4. **`updateRemotes(dt)`** (1788): `PosePlayback` sampling, limb animation.
5. **`render(alpha=acc/TICK (1 before started), dt, now)`** (847):
   - Position interpolation, eye height (1.62, crouching 1.27), F5 third-person cam (`camDist`), `eyeInWall`, `HL.lights`, `setListener`, `voice.update`, `raycast()` to `S.sel` (since f6b38f505d with `S.sel.lines` from `pickOutline`, 893), FOV lerp (fly ×1.1, sprint ×1.15), `playerView`.
   - `fireflies.update(dt, {...})` (960), every frame including the title screen (not on `?card`, where `fireflies` is null).
   - It builds the players list, then calls **`gfx.draw({...})` (973)**. `v.w/v.h` are `glCanvas.width/height` (896-897); `under`/`lava` are `st[10]`/`st[11]` in first person, or `waterAt`/`lavaAt(cam)` in F5 (978-979).
   - Survival only, and not when the eye is in a wall: crack, first-person hands and the burning overlay (999-1004). Name tags via `gfx.project`.
   - **`hud.draw({...})` (1030)**, then `survival.drawHud` (1058), `drawUndoPreview`, `hud.suggestions` and `chatToggle.update` (1061).
6. **Then:** `music.update(dt, poolFor({...}))` (652-663), `inv.draw`, `survival.screens.draw()`, `updateAdvancement`, `worldSponsorHUD.update(S)`.
7. **`net.pos(now)`** (671) sends a POS frame only if the player moved. Throttle (`posMs`, main.js:1864): every 100 ms below 50 players, 200 below 200, 333 below 500, else 500. 50 ms while swinging.
8. **Last:** `loading()` / `resuming()` / `onReady()`, the pixelated-menu resize, and the welcome toast.

**Phase timers (new in f6b38f505d):**
- `ft = createFrameTimes({ctx: slowCtx})` (main.js:489) adds time to the phases of `PH` (frametime.js:1): `net resize sim remesh remotes world hud screen other browser`. `browser` is whatever a slow interval doesn't account for.
- An rAF interval over 50 ms is kept in `ft.slow` (the last 20), with its phases, message counts and `slowCtx`'s screen, chunk, nearby-player and heap readings. `timed` (main.js:1804) wraps `onJson` and `onBin` to count messages and the time they take between frames.
- F3 shows the latest one (game-ui.md §4), and with F3 open `copySlow` (`KeyL`, main.js:1814) copies the report to the clipboard.
- `ft` is module-local (DEV hosts expose it as `window.__mc.ft`). Time spent in a mod's frame hooks lands in whichever phase is running, so a slow `world` line can be ours.

**Frame timing, slow-frame watchdog and context loss (new in 325afb04b5):**
- **`gpu`** (main.js:562) = `{name, frameMs, jsMs, worstMs, slow, regained, lost, hint}`, module-local (only DEV hosts expose it, as `window.__mc.gpu`).
  - `frameMs` is the mean interval between rAF timestamps over the last second.
  - `jsMs` is the mean time spent inside the rAF callback: all of `frameBody`, including meshing, GL command submission and any mod hooks. It is CPU time, not GPU time.
  - `worstMs` (new in c25d4c024d) is the longest rAF interval of the last second, and `slow` the number of intervals over 50 ms in it.
  - Both update once a second. F3 shows them on its new `GPU:` and `Frame:` lines (game-ui.md §4).
- **`createSlowWatch`** (gpuwatch.js:22), defaults `{ratio: 1.8, min: 18, need: 4, keep: 120, cooldown: 2e4, tries: 3}`.
  - `watchGpu` (main.js:587) feeds it `S.fps` once a second, flagged `steady` = started, not resuming, no menu, not closed, page visible and synced. It never runs on the title screen or with a screen open.
  - Steady samples that aren't slow are kept (the last 120). The "usual" fps (`baseline`) is their 75th percentile, once there are 8.
  - "Slow" = baseline ≥ 18 and fps < baseline / 1.8. After 4 slow steady samples in a row it returns `"regain"` (at most every 20 s, at most 3 times), and after that `"hint"` once, which also empties the kept samples. Slow samples are never kept, and a non-steady sample resets the run.
- **`regainCanvases()`** (main.js:570), on `"regain"`:
  - For `#hud` only, it sets `width` to 1 (2 if it was 1) and straight back, which reallocates that backing store at the same size. Since 6b3963e444 it leaves `#gl` and `#inv` alone, so the watchdog never reallocates the WebGL drawing buffer.
  - It also clears the font's tint cache and resets its atlas canvas, then sets `resizeWanted`, so the next frame runs `resize()` (normally no size change).
  - On `"hint"`, `gpu.hint = true` only adds ", still slow: reload" to F3.
- **Context loss** (`bindInput`, main.js:2784-2805):
  - `webglcontextlost` on `#gl`: `preventDefault`, `gpu.lost++`. After 3 s, if the context is still lost and no such reload happened in the last 60 s (sessionStorage `mc.glreload`), `location.reload()`.
  - `webglcontextrestored`: reload (not in TEST).
  - `contextlost` on the 2D canvases (`#hud`, `#inv`, `#load`) also counts into `gpu.lost`; their `contextrestored` requests a resize.
- **For mods:**
  - Anything sized from `glCanvas.width/height` must still follow window resizes at every frame's viewport; `regainCanvases` itself can't change it any more.
  - Something that makes in-world FPS drop by 1.8× or more for 4 s (switching to a much heavier preset, a benchmark row) can trigger `regainCanvases`, a frame hitch, up to 3 times per page.
  - `gpu` isn't reachable on prod. A `width` write on `#hud` shows up through a `HTMLCanvasElement.prototype` `width` setter wrapper or a `MutationObserver` on its attributes.

Input is event-driven (`bindInput`, 2759; `onKeyDown`, 2633):
- Since f6b38f505d every action below is a bind in `keys.js`, so these are defaults and any of them can be a key or a mouse button. `onKeyDown` and `#gl`'s mousedown both end in `worldPress(code, e)` (2703), and `onKeyUp` and `mouseup` in `worldRelease(code)` (2745).
- Movement and slots: Digit1-9 slot, double-`jump` fly, double-`forward` sprint.
- Screens: E inventory, Q drop (survival), T/Enter chat, `/` command, Esc pause (fixed), Tab player list.
- Account and world: V verify, O owner tools, M new world, P voice.
- View: F1 HUD, F3 debug, F5 camera, F11 fullscreen (new).
- Mouse: 0 `attack`, 2 `doPlace`, 1 `pick`. `mousemove` calls `turn(movementX,movementY,SENS)` under pointer lock unless `lockJump(e)` rejects it (the first events after locking, or a spike from `createSpikeFilter`, 2610-2619). Drag mode uses DRAG_SENS.
- c25d4c024d adds F (swap hands), R and X (hotbars) in survival, and the blueprint keys: game-ui.md §5.

## 5. Game state
**`S`** (main.js:188) is a module-local plain object. Selected fields:
| Group | Fields |
|---|---|
| lifecycle | `started ready closed resuming restored synced loadAt welcomePending takeBack` (set by "Resume playing here"; the next welcome then applies the server's look direction instead of `keepLook`), and since c25d4c024d `rejoin rejoined reopenPause` (a survival reconnect that keeps open screens) |
| UI/input | `menu` (build fn or null), `menuName` ("title","pause","inv","sinv","options","sounds","controls","blueprints","claim"…), `chatOpen chatHidden input` ("none","lock","drag","touch"), `keys{code:true}` (since f6b38f505d also `Mouse0`…) `keyed mouse[3] drag` (now with the bind in `drag.a`) `look stick tjump tsneak sprint wheel hint flash toast debug showHud tab` |
| camera | `yaw pitch eye fov baseFov view`(0/1/2) `cam[3] eyePos[3] prev[3] sel{x,y,z,lines} selMemo inWall rd heldLight` |
| inventory | `hotbar[9] slot itemAt`; survival only: `sinv{s[47],sel} counts[9]` (47 since f6b38f505d: index 46 is the worn backpack; the client also accepts 46 from the server) |
| identity/room | `tok{token,handle,name,pfp,(perks,sojo)} myId me owner op perms creator verifying room{name,mode,hardcore,beaten,pending,host,translate,music,caps} quote ownerStats global achs undoPv` |
| world | `lit time fireflies` (default true; no UI toggle); survival only: `sv{seed,w,gen,time,spawn,grace,dim,fixedTime…}` and `gm` (creative-mode player) |
| chat | `chat[]` (≤60 `{text,color,nameStyle,at, tr?}`; `tr` is added by the translator), `lastWhisper`, `translate` (mirrors the translator's on state) |

Other locals in main.js:
- `eng` holds `x` (WASM exports), `mem`, `nb`, `nt`, `texNames`, `blockNames`, `kind`, `ft`, `st`, `ray`, `ebuf`, and since 325afb04b5 `idTop` and `copyBox16()` (§6). Live on 325afb04b5: `nb` 255, `nt` 256, `idTop` 32768. Read from the c25d4c024d wasm in Node: `nb` 255, `nt` 512 (the table size, not the 347 named layers). `eng.entBoxes(list)` is new (at most 16 boxes of 6 numbers).
- **`eng.st`** is a Float64Array(12):
  - [0-2] feet xyz, [3-5] velocity, [6] on ground, [7] flying, [8] ?(ladder or in liquid, inferred), [9] crouching.
  - [10] eye in water and [11] eye in lava, both using the fluid's real surface height (research on c111547912). [10] drives the first-person underwater fog (`v.under`, main.js:978) and survival air bubbles (player.js:439; survival/client.js:487 calls it `inWater`). [11] drives the first-person lava fog (`v.lava`, main.js:979). In F5 the game tests the block kind at the camera instead (`waterAt`/`lavaAt`, main.js:1094-1101).
- **`eng.ray`** is an Int32Array(8): [1-3] hit block, [4-6] face normal, [7] block id.
- Also: `gfx`, `hud`, `font`, `icons`, `inv`, `survival` (SurvivalClient or null), `remotes` (Map id → `{name,h,p,cos,cc,x,y,z,tx..,yaw,pitch,body,limb,crouch,has,sw,motion}`), `self`, `UI{dpr,gs,pad,u,hpx}`, `net`, `identity`, `voice`, `wardrobe`, `signs`, `translator`, `music`, `fireflies`, `loop`.
- **`G`** (3308) is the glue object handed to `M.initMenus(G)` and kept module-local in menus.js:18.
  - It holds `S`, `UI`, `net`, `remotes`, `store`, `ROOM`, `TITLE`, `api()`, `resume`, `chatLine`, `releaseInput`…
  - New: `music` (getter) and `translator`, and since c25d4c024d `volumes()`, `setVolume(cat, v)`, `openBlueprints()` and `bpAim`.
  - **Since f6b38f505d it is reachable:** `M.kit().G` (menus.js:140) returns it once `initMenus` has run, and it is `null` before that. See §9 for what a mod may do with it.

**How to reach state from a userscript on prod.** There are no globals except `window.__ready` (boolean) and `document.documentElement.lang` (the current locale code, set by `setLocale`). `window.__mc` exists **only on DEV hosts** (main.js:3483).
| Need | Hook (all are prototypes of exported classes; get them with `await import('/js/<mod>.js')`) |
|---|---|
| S, net, eng, gfx | `SignsClient.prototype.draw(gfx,vp,cam)`: `this.o.S`, `this.o.net`, `this.o.eng()`, `this.o.gfx()`.<br>It runs every frame via gfx `overlays` (gfx.js:1324; the overlay pushed at signs.js:25 calls `this.draw` dynamically), title screen included (verified live on build d7bde3deb9), except while the eye is in a wall.<br>Also `.onMsg(m)` (every JSON message that reaches `onJson`, main.js:1916; net.js consumes `full`/`busy`/`ticket`/`challenge` first) and `.key(e)` (every keydown, main.js:2635) |
| S | `(await import('/js/menus.js')).kit().G?.S` (new in f6b38f505d, no wrapper needed; §9).<br>`ChatToggle.prototype.update`: `this.state === S`, every frame (main.js:1061) |
| eng (whole object) | `Fireflies.prototype.update(dt, w)` (fireflies.js:71): `this.eng`. Called every frame from `render` (main.js:960), title screen and walls included, but not on `?card`. Verified live on 325afb04b5 (a one-shot wrapper got `eng` with `idTop` and `copyBox16` on the title screen) |
| eng.x | `RemeshSched.prototype.run(x,…)`: the first argument, every frame (verified live on build d7bde3deb9: `world_w()`=1024 on the title world).<br>Or wrap `WebAssembly.instantiate` at document-start: engine.js:23 is the only caller, and `instance.exports` = `eng.x`, including `memory` |
| gfx, frame params | `Gfx.prototype.draw(v)`: `this` = gfx; `v.cam, yaw, pitch, fov, rd, players, time, lit, dim, under, lava, wall, held, entities` |
| survival | `SurvivalClient.prototype.tick/onMsg/onBin/drawHud`: `this.S`, `this.eng`, `this.net`, `this.o` (callbacks), `this.systems` |
| HUD | `Hud.prototype.draw(o)` (ui.js:640) |
| locale | `import('/js/i18n.js')`: `locale()`, `t(key, vars)`, `onLocaleChange(fn)` (see §9) |

Mutable exported singletons: `overlays`/`solidOverlays` (gfx.js:13-14; push `(gfx,vp,cam,v)=>{}`), `HL` (held-light), `H` (hand.js). `K`/`B` are mutable but don't touch them.

## 6. World data
- **WASM `eng.x` API used by JS:**
  - world: `init(seed) set_world(w) set_gen(g) set_lighting world_w/h/cn find_spawn surface_y light_at`
  - blocks: `get_block set_block get_full raycast`
  - player: `player_set player_tick player_fly player_vel unstuck`
  - meshing: `set_focus pop_dirty mesh_chunk mesh_n mesh_ptr mesh_ymin mesh_ymax`
  - ids (new in 325afb04b5): `id_top` (read once by `loadEngine`), `copy_box16` (wrapped as `eng.copyBox16`)
  - edits/chunks: `apply_edits reset_edits apply_chunk clear_chunk chunk_edits edit_room/edit_fits`
  - tables: `tex_names block_names variant_names tex_full kind_ptr ft_ptr ft_width texf_ptr state_ptr ray_ptr ebuf_ptr nblocks ntex`
  - bodies (new in 6b3963e444): `body_move`, `body_out_ptr` (wrapped as `eng.bodyMove`, used by boats and horses)
  - collision (new in c25d4c024d): `ent_boxes`, `ent_box_ptr` (wrapped as `eng.entBoxes`), `id_collides`
  - outline (new in f6b38f505d): `pick_dump(x,y,z)` returns a pointer to `Int32Array` data: a box count, 6 ints per box, then a mask of the fine boxes (`pickOutline`, outline.js; at most 10 boxes are read)
  - Exported but never called by JS (MODULES.md lists them): `overworld_height overworld_biome stronghold_list stronghold_near fortress_at fortress_list end_spikes dense_room chunk_pooled shape_probe shape_dump name_probe name_in_ptr hishape_ptr stats_ptr variant_names_ok ids_probe`. 325afb04b5 added `copy_box16`, `id_top` and `ids_probe`; nothing else was added or removed.
- **Reading world data from a mod** (research on c111547912, re-checked where noted):
  - `engine.wasm` runs on the main thread, loaded by `loadEngine` (engine.js:20). There are no Workers.
  - Storage is one u16 per cell holding the full block id (§ "Block ids"). The chunk index is `((z&15)*16 + (x&15))*128 + y`. Chunks live in pooled slots whose addresses aren't exported, so **don't read wasm memory directly**.
  - Point reads: `x.get_block(x,y,z)` (base id), `x.get_full` (with variant), `x.light_at`, `x.surface_y`.
  - New in 325afb04b5: `eng.copyBox16(x0,y0,z0,sx,sy,sz)` (engine.js:90) returns a **copy** as a `Uint16Array` (`sx·sy·sz` values), or `null` when `copy_box16` is missing or fails. Live: a 2×2×2 box gave 8 values. Nothing in the game calls it yet.
  - **Change signals:** there are no events. `Gfx.prototype.setChunk(ci,cx,cz,parts,ymin,ymax)` runs after every (re)mesh (`remesh`, main.js:1326), and `Gfx.prototype.dropChunk(ci)` on unload (beyond rd+3, main.js:1308), on a survival scene reset (1261) and on a world switch (3555). Dirty chunks more than 1 away remesh only after a 250 ms settle (§4).
- **Block ids** (ids.js):
  - 0-254 are base blocks. `eng.nb`=255 (live on 325afb04b5). Creative uses 0-67 (`NBLOCKS_CREATIVE`), and phases go up to 219. Buttons are hi-byte variants in rules/variants.js.
  - 255 = `REVERT` (`isRevert`).
  - Items are 256-65535 minus the wide band and the variant range (`ITEM_FIRST/LAST`, `isItem`); the defined item phases use 256-1023.
  - **New in 325afb04b5: 1024-4095 = "wide" block ids** (`WIDE_FIRST/LAST`, `isWide`). One counts as a block only once `bindBlocks` has registered it, which happens when the engine has a name for it (`registerWide`, rules/items.js:406; `isRegisteredWide`, block phase `PHASE_WIDE` = 4). Read from the c25d4c024d wasm in Node: 432 names in this band (rails, levers, repeaters, lamps, plates, pistons, trapdoors, dispensers, tripwire hooks and more), so they are in real use.
  - 4096-32767 are variants `(hi<<8)|lo` (rules/variants.js `withHi`, :40). `ID_TOP` = 32768.
  - **`baseOf(id)`** (ids.js:29) = `id & 255` for variants and `id` itself otherwise (so wide ids stay whole). It replaces the old `id & 255` everywhere in the client. `BASE_TOP` = 4096 is the size of the per-base-id tables (fire, replaceable, ambient, fireflies).
- `K` kinds (engine.js:2): AIR, SOLID, LEAVES, GLASS, WATER, PLANT, LAVA. `B` (engine.js:3): AIR 0, STONE 1, GRASS 2, DIRT 3, WATER 9, BEDROCK 12, LAVA 68.
- `eng.kind[id]` gives the kind. `eng.ft[id*6+face]` gives the tile layer.
  - Since 325afb04b5, when the wasm has `id_top`, both are copied straight from wasm tables of `idTop` entries (engine.js:38-43), variants included. Since 6b3963e444 `ft` is a `Uint16Array` when the wasm's `ft_width()` is 2, because layers no longer fit a byte, and `ftX.texFlags` (from `texf_ptr`) carries each layer's glass flag. Live: `idTop` 32768, `kind.length` 32768, `ft.length` 196608. The old path (256 base entries plus the variants listed by `variant_names`, filled through `baseOf`) is the fallback.
- **Fluid ids** (live on 325afb04b5): water 9, levels 96-102 ("Water (Level 1)"…"(Level 7)"), falling 103; lava 68, levels 104-106 ("Lava (Level 2/4/6)"), falling 107. `K.WATER` 4, `K.LAVA` 6. Texture layers `water_still` 10, `water_flow` 100, `lava_still` 80, `lava_flow` 101 (`gfx.fluidLayers`). There is no client-side flow simulation: in survival, fluid levels arrive as server deltas. How fluids are meshed: game-rendering.md §5.
- **Sediment and ground blocks** (ids and display names live on 325afb04b5):
  - soil: Grass Block 2, Dirt 3, Coarse Dirt 78, Farmland 145 / Farmland (Wet) 146;
  - loose: Sand 8, Gravel 13, Clay 43, Sandstone 15, Grave Sand 181 (soul sand);
  - rock: Stone 1, Cobblestone 4, Mossy Cobblestone 22, Granite 79, Diorite 80, Andesite 81, Bedrock 12, Obsidian 24, Snow Block 14;
  - other: Terracotta 108 (plus coloured variants), Underrock 180 (netherrack), Magma Block 184, Lumen Rock 41 (glowstone), ores 28-33 (Coal, Iron, Gold, Diamond, Spark (redstone), Lapis Lazuli).
  - **New in c25d4c024d:** Deepslate, Cobbled Deepslate, Deepslate Bricks and Deepslate Tiles are wide-band ids (1456 and up), with their stairs and walls as variants.
  - **Missing** (none in the c25d4c024d wasm's names): red sand, mud, ice, copper, kelp, seagrass, prismarine. Note the game's own names: "Grave Sand", "Underrock", "Lumen Rock", "Spark Ore".
- **Two name lists:**
  - `eng.blockNames` holds display names ("Fire", "Snow Block", "Enchanting Table") from `block_names()` + `variant_names()` (engine.js:70), indexed by full id (27592 entries live on 325afb04b5, variants included). `bindBlocks()` (rules/items.js:403) builds `idOf` / `blockName` / `itemInfo`. These names stay English: the UI translates them at display time with `tn(name)` (e.g. `itemLabel`, main.js:1366-1369).
  - **`eng.texNames`** holds texture basenames ("oak_planks", "water_still"…) from `tex_names()` (engine.js:69). Its index is the layer in the `TEXTURE_2D_ARRAY`. There are 347 entries on c25d4c024d (read from the wasm in Node; 8 are empty, and it was 302 live on 6b3963e444 and 256 up to 575c9209bc). "oak_planks" is layer 5.
- **`indexOf("oak_planks")`:**
  - It is still the first `indexOf` call on `texNames`: main.js:356 in `boot()`. `eng.texNames.indexOf("oak_planks")` picks the oak-plank tile canvas as the sign background (`signPlank`, given to `SignsClient` as `plank()`).
  - It runs once, after `await loadTiles(texNames)` and immediately before `gfx.setTiles` (357), so the captured names line up 1:1 with the uploaded layers.
  - The next calls are `indexOf("water_still")` (358), then `indexOf` for `water_still, water_flow, lava_still, lava_flow` to fill `gfx.fluidLayers` (359-361).
  - Survival code also calls `blockNames.indexOf("Fire")` / `indexOf("Chest")` (survival/entities.js:547, fluids.js:161, chesticons.js:48, chestlabels.js:18, creative.js:80 and :161, screens.js:350). That is the display-name list, so check `v==='oak_planks'`.
  - If the sign texture changes, the capture silently fails. Fallback: call `tex_names()` yourself via the `WebAssembly.instantiate` hook (cstr from `memory`), or read `gfx.fluidLayers` for the fluid layers.
- **Tiles** (`loadTiles`, engine.js:114): each layer is 16×16 RGBA (1024 B). Tints for grass, leaves and water; the grass-side overlay is composited in; water alpha is 170; layers matching `CUTOUT` get an alpha threshold (≥26) and colour bleed. Fire, portals and the four fluid layers are then animated on the GPU by gfx (game-rendering.md §3).
- **Geometry:**
  - Creative/title world: `WORLD`=1024 wide, `WORLD_H`=128, `CN`=64 chunks per side.
  - Survival: `set_world(sv.w)`, e.g. 5120 overworld, 640 nether (rules/portal.js).
  - A chunk is a 16×16×128 column. Chunk index `ci = cz*CN+cx`. Creative block key `(x<<17)|(z<<7)|y` (`blockKey`, proto.js:116).
- **Creative edits:**
  - The server sends edits only. A SYNC frame (3) carries n × [u32 key, u8 block]; they are copied into `eng.ebuf`, then `apply_edits` (main.js:2272).
  - RELAY frames carry live edits. DENY (4) sets or reverts one block (`setKey`, 2276).
  - Local edits go through `edit()` (1427): `set_block`, `net.edit`, `effects()` (particles and sound; anvils now get their own land/break sounds).
- **Survival terrain:**
  - `welcome.sv` drives `init(seed)`, `set_world`, `set_gen` (`SurvivalClient.welcome`, survival/client.js:131).
  - CHUNK_DELTA frames (12) are parsed by `decodeChunks` (wire.js:35): `[u8 12, u8 dim, u16 n]`, then per chunk `[i32 ci, u16 nrec, nrec×(u16 idx=((z&15)*16+(x&15))*128+y, u8 lo, u8 hi|QUIET 128)]`. The id is `lo | (hi & 127) << 8`.
  - Unknown chunks go to `TerrainStore.load` (terrain.js:179) and on to `apply_chunk`. Known chunks get per-block `setBlock` + effects (`chunks`, client.js:279).
  - **Since 325afb04b5** an id counts as known when `eng.blockNames` has a name for it (`knownTo`, terrain.js:19; it was `lo < nb`). A known chunk with an unknown id fails with "The game was updated" (`UPDATED`). `load`/`mergeParked` reject a chunk with an unknown id outside the wide band (`unknownRecord`, :27), and when `apply_chunk` returns −2, `apply` retries without the unknown wide records (`dropUnknownWide`, :34).
  - A chunk is meshed only when it and its 8 neighbours are known (`canMesh`, client.js:264).
- **Meshing:**
  - `remesh(ci)` (main.js:1315) calls `mesh_chunk(cx,cz)`, which produces 3 parts.
  - Each part is n quads × 32 B (4 vertices × [u16×3 pos, u8×2 attributes], gfx.js:1022). `aPos.x` bit 9 is a UV flag (game-rendering.md §5).
  - The parts go to `gfx.setChunk(ci,cx,cz,parts,ymin,ymax)`. Part 0 is opaque (lava too), part 1 cutout (alpha-tested program), part 2 translucent (water too), drawn in the blended pass (gfx.js:1295-1296, 1319).
  - `gfx.chunks` is a Map; `gfx.dropChunk(ci)`.

## 7. Networking
- **Room socket:** `wss://<host>/ws/<room>` (net.js:21), `binaryType` arraybuffer. Text messages are JSON `{t:…}`; binary messages are frames. Keepalive: text `"ping"` every 25 s through `net.ping()` (net.js:245), and once a second while F3 is on, with at most one in flight for 10 s. Since c25d4c024d the `"pong"` sets `net.rtt`, which F3 shows.
- **Join:**
  - `onopen` → `sendHello` (net.js:67) sends `{t:"hello", v:PROTO, rd, sid, key?, token?, code?, admin?, cc, challenge:true, turnstile?, take?, re?, rt?}` (fields from main.js:1836). **`PROTO` is 20 since f6b38f505d** (19 in c25d4c024d, 11 in 6b3963e444, 7 in 325afb04b5, 6 in c111547912, 5 before; proto.js:1). We never touch the handshake, so it isn't documented further here.
  - The server may reply:
    - `challenge{sitekey}` → `M.turnstileCheck` (menus.js:223) → `requestTurnstile` (action "guest_join", interaction-only, 6 s, **one try**) → a second hello with the token;
    - `ticket{rt}` (resume ticket);
    - `full`/`busy{retryAfter}`;
    - `welcome{id,you,owner,op,creator,room,quote,players,sv?,st?,revoked?,rt}`, then `synced`.
  - No welcome within 15 s → reject "timeout". Reconnect: 30 s.
  - Close codes: 4002 full, 4004 moved (other tab), 4008 idle, 4009 lost (no retry). Anything else reconnects with a backoff that doubles from 1 to 15 s, jittered ×0.5-2 (net.js:121-122).
- **JSON types:** the lists are `MSG_TO_SERVER`/`MSG_TO_CLIENT` (proto.js:236/303). New in c111547912: `fixture`/`fixturetest` (to server), `fixturetest` (to client), and `MSG` names `CSET, LISTING, CC, FIXTURE, FIXTURETEST`. New in c25d4c024d: `rule`, `cut`, `hrow` (to server) and `bpSave`, `bpList`, `bpDel`, `bpLoad`, `bpPaste` (both ways).
  - `onJson` (main.js:1912) handles welcome, synced, sinv, time, moved, idle, spawn, place, signedout, evs, join, leave, who, cos, chat, sys, ach(s), room, you, roles, renamed, undo*, bp*, poke, reset, full/busy, kicked and old. Everything else goes to `survival.onMsg` and then each system. `SignsClient.onMsg` sees messages first (1916).
  - The `st` carried by `welcome` and `place` now goes through `keepLook(st, S)` once started (main.js:1996, 2002, 2048), so server state no longer snaps the camera. The exception is the first welcome after "Resume playing here" (`S.takeBack`).
  - Server texts (`sys`, `kicked`) are localised with `srvText(m)` when the server sends a key `k`.
  - Since 325afb04b5, `SurvivalClient.place(st, sv, keep)` (survival/client.js:167) can re-place the player without a reload. It keeps the loaded terrain and only shows the loading screen when the chunks within 6 of the new spot aren't known (`nearKnown`, :206).
  - Sent from the client: `chat{m,n}`, `view{rd}`, `inv{hotbar,slot}`, `auth{token}`, `cos{k}`, `achs`, `cc{on}`. Survival also sends `dig{s:0 start/1 abort/2 done,x,y,z,f,i}`, `place{x,y,z,f,…prediction}`, `sel{i}`, `attack`, `use`, `click`, `drop`, `aname{w,n}` (anvil rename, survival/anvil.js:84), `fixture{e,h}`…. Since c25d4c024d also `rule{k,v}` (owner toggles, menus.js:2425) and `hrow{r}` (hotbar rows).
- **Binary frames** (`FRAME`, proto.js:2):
  - client→server: POS 1 (18 B: f32 x,y,z, i16 yaw×1e4, i16 pitch×1e4, u8 flags 1 crouch/2 fly/4 swing) and EDIT 2 (6 B: u32 key, u8 block; creative only).
    - `net.pos(now, force, at)` gained an optional `at` = [x,y,z] that replaces the position. Survival uses it to report a landing point (main.js:722-725).
  - server→client:
    - SYNC 3; DENY 4.
    - RELAY 5 / RELAY_FULL 6: `u16 np, u16 ne`, np×19 B players, ne×7 B edits, then an optional JSON event array. FULL hides absent players (`onBin`, main.js:2220).
    - ENT_SPAWN..ENT_EQUIP 7-11 (survival/entities.js:119). New `ENT_KIND` tnt 30, armor_stand 31, item_frame 32, and since c25d4c024d squid 36, cyclone 37, cyclone_smoke 38; new `ENT_EV.POSE` 14.
    - CHUNK_DELTA 12.
  - INV/WINDOW/HEALTH/TIME/DIM (13-17) are defined but not referenced by client code.
- **HTTP** (all same-origin):
  - identity: `/api/me` (GET identity by cookie `mcv=1`, POST bridge token, DELETE logout), `/api/sojo`, `/api/sojo/link`, `/api/sojo/post`, `/api/verify`, `/api/verify/code`, `/api/admin`;
  - worlds: `/api/online`, `/api/servers?…`, `/api/rooms` (POST create → `{id,key}` → `/r/<id>?new#key=`), `/api/rooms/<id>/stats`;
  - chat: `/api/translate` (POST `{room,text,to}` → `{ok,text,from}`; 2 in flight, queue 8, a 429 pauses it; chat-translate.js:98);
  - assets: `/api/pfp?u=`, `/api/skin/…`, `/api/cape/…`, `/assets/lang/<code>.json` (i18n.js:158), `/assets/font/g/<page>.png?v=…` and `/assets/font/g/ui.png` (glyph pages, ui.js `Font.page`), `/assets/sound/music/manifest.json` + its tracks (music.js);
  - shop and ads: `/api/wardrobe*`, `/api/sponsor*`, `/api/ads`;
  - voice: `/ws/voice/<room>` and `/api/voice/<room>/tap` (WS).
  - `G.api()` (main.js:3285) POSTs JSON.
- **To join a world:** open the URL `/r/<id>`, optionally with `?c=<invite>`.
  - The hello needs a `sid`. A token is optional, as are an owner key (`mc.key.<room>`) and an admin key.
  - Turnstile only runs if the server challenges.
  - Whitelist and bans are enforced server-side (`kicked`).
  - An `old` reply means a protocol mismatch, and the game stops with "Update available" (`T("net.update")`).

## 8. Settings and storage
localStorage is reached mostly via `store` (main.js:138, which swallows errors). menus.js:524/549, sojo-ads.js and sojo-identity.js read `localStorage` directly.

| Key | Meaning (where) |
|---|---|
| `mc.fov` | base FOV 30-110, default 70 (read main.js:211, written menus.js:1827) |
| `mc.rd` | render distance in RDS, default 8 (6 on touch) (235, `cycleRd` 3269) |
| `mc.heldLight` | "0" turns off held-item light (208, menus.js:1843) |
| `mc.refill` | **new in 6b3963e444.** "0" turns off hotbar refill. The Options button writes it and sends `{t:"refill", on}` (menus.js:1852-1857); `survival/player.js:122-128` sends it again on each new socket |
| `mc.lang` | **new.** Locale code (`LANG_KEY`, i18n.js:20). Read by `startLanguage` (lang-select.js:15, ignored on Sojo pages), written by the Options "Language" cycle button (`chooseLanguage`, lang-select.js:45) |
| `mc.musicVol` | **new.** Music volume "0".."1", default 0.5 (`VOL_KEY`, music.js:3; written by the `sounds` screen's Music slider via `setVolume`) |
| `mc.vol.<cat>` | **new in c25d4c024d.** Volume "0".."1" of every other sound category, default 1 (`KEY`, sound-cats.js:12; read by `readVolumes`, written by `saveVolume`) |
| `mc.hotbars` | **new in c25d4c024d.** Saved hotbars as JSON (`HOTBARS_KEY`, survival/hotbars.js:4) |
| `mc.bpLink` | **new in c25d4c024d.** A blueprint link from `?bp=`, kept until used (blueprint-ui.js:6) |
| `mc.keys` | **new in f6b38f505d.** JSON `{bindId: code}`, only the binds that differ from `def`; removed when none do (`KEYS_KEY`, keys.js:1). Read when keys.js is evaluated, written by `set`, `reset` and `resetAll`. Not a secret, and not the `mc.key.<room>` family: the two names differ by one character |
| `mc.musicManifest` | **new**, DEV only. Manifest URL override (music.js:260; `?music=` too) |
| `translateChat` | **new, no `mc.` prefix.** "1"/"0" = your Translate chat choice; absent = follow the world's `room.translate` flag (`TRANSLATE_KEY`, chat-translate.js:3,7,49) |
| `mc.hotbar` | JSON [9 ids] creative hotbar (state.js:6/17) |
| `mc.sid` | session id, 20 chars, sent in hello (170-171) |
| `mc.tok` | JSON `{token,handle,name,pfp}` X-account token (172, 238, identity.js) |
| `mc.bridged` | token already bridged to the cookie (identity.js:26/38) |
| `mc.key.<room>` | owner key of a world you created (173-177, menus.js:1803; scanned in menus.js:550) |
| `mc.admin` | admin key, sent in hello and as the `x-admin` header (180) |
| `mc.nonce` | verify-flow nonce (menus.js:2056, sojo-identity.js:100) |
| `mc.cos` / `mc.wardrobe` | cosmetics ticket cache `{key,who,ticket,exp,at}` / owns-cosmetics flag (wardrobe.js:81/84/98) |
| `mc.recent` | comma-separated recent world ids, at most 50 (recent.js:1) |
| `mc.showCountry` | "0"/"1" show flag (country.js:2, menus.js:1848) |
| `mc.adseen` | JSON `{adId:time}` (sojo-ads.js:131) |
| `mc.voiceOff` / `mc.voiceNotice` | "1" = no auto-listen / transcription notice acknowledged (1900, 3403-3479) |
| `mc.glreload` (**sessionStorage**) | **new in 325afb04b5.** Time of the last automatic reload after a WebGL context loss; allows at most one per 60 s (main.js:2795-2798) |

- `fireflies.js:5` exports `KEY = "mc.fireflies"`, but nothing reads or writes it in this build.
- Most keys are read once at module init or boot, so set them before main.js runs for them to take effect.
  - The exceptions: `mc.lang` is read when language selection starts (at main.js module evaluation); `mc.musicVol` is read when `createMusic` runs in `boot()`; `translateChat` is re-read every time the translator checks its `on` getter (chat-translate.js:45).
- There is also the cookie `mcv=1` (verified session). sessionStorage holds only `mc.glreload` (new); there is no IndexedDB.

## 9. Extension points and risks
**Stable enough to hook:**
- Exported names (manifest `exports`) and the prototypes of exported classes: `Gfx`, `Hud`, `Font`, `Icons`, `Inventory`, `SignsClient`, `ChatToggle`, `ChatBubbles`, `ChatTranslator`, `RemeshSched`, `PosePlayback`, `Fireflies`, `SurvivalClient` and every survival `*Client` (including `AnvilClient`, `FixturesClient`, `CutterClient`, `CycloneClient`, `CampfiresClient`), `Hotbars`, `RecipeBook`, `PistonFx`, `Screens`, `TerrainStore`, `CrackRenderer`.
- The `overlays`/`solidOverlays` arrays.
- DOM ids from index.html, `#screen` className `on …`, and the CSS vars `--u --d --hp --hb` (set in `resize()`, main.js:535-538).
- `window.__ready`. It goes back to false while a survival world (re)loads (main.js:1974) and true again in `resuming()` (2491).
- `import('/js/gpuwatch.js')` (new): `isSoftware(name)`, `gpuName(gl)`, `shortGpu(s)` are pure helpers a mod can reuse. `createSlowWatch` creates a new, independent watchdog; the game's own instance and its `gpu` stats are module-local in main.js.
- `import('/js/ids.js')` (new exports): `baseOf`, `isWide`, `isRegisteredWide`, `BASE_TOP` for id handling that matches the game's.
- `import('/js/keys.js')` (new in f6b38f505d): the game's live bind table. It imports nothing, so it has no DOM side effects and is safe to import early (evaluating it reads `mc.keys`).
  - Reads: `BINDS`, `CATS`, `codeOf(id)`, `codes(id)` (with `alt`), `is(code, id)`, `held(id, keys)`, `action(code, scope)`, `slotOf(code)`, `loadoutRow(code)`, `bound(code)`, `conflicts()`, `isDefault(id)`, `keyName(code, T)`, `mouseCode(button)`.
  - Writes: `set(id, code)`, `reset(id)`, `resetAll()`. They save to `mc.keys` at once and take effect on the next key, since nothing is cached elsewhere.
  - `bound(code)` covers all scopes, so a mod can warn about a clash with a game key. A code held by a `place`, `row` or `debug` bind only acts in that mode.
- `M.kit().G` (new in f6b38f505d): `G.S` is the live state object, with no prototype wrapper needed. Treat it as read-only, and detect it (`kit` and `G` may be missing, and `G` is `null` before `initMenus`). `G` also holds `net` and `store`: our scripts must not call `net.*` or read secrets through `store` (see "Never break").
- `import('/js/frametime.js')` and `import('/js/outline.js')` (new in f6b38f505d) are pure helpers; the game's `ft` stays module-local.
- `import('/js/sound-cats.js')` (new in c25d4c024d): `CATS` and the pure `eventCat(name)`. `import('/js/item-look.js')`: `itemLook(id)` tells how an item is drawn, once `bindLook` has run at boot. `import('/js/blueprint-ui.js')`: `active()` is the only way to see blueprint mode, but the module imports menus.js (see Gotchas).
- At document-start: wrap `WebSocket`, `fetch` and `WebAssembly.instantiate`, or seed `mc.*` keys.
- **i18n (new)**: `import('/js/i18n.js')` gives the game's live instance.
  - `t(key, vars)` returns the current-locale string. It falls back to English (`lang/en.js` + `lang/server.js`) and then to the key itself.
  - `tOr(key, english, vars)` returns your English text when the key doesn't exist.
  - `has(key)`, `locale()`, `localeInfo()` (`{code,name}`) and `LOCALES` (13: en, es, pt-BR, de, fr, it, nl, id, ja, ko, zh-Hans, zh-Hant, ru) are also exported.
  - `onLocaleChange(fn)` returns an unsubscribe function. Listeners run in registration order, after the `/assets/lang/<code>.json` fetch resolves, and only on a real change. Errors are caught.
  - main.js registered first (main.js:1613), so the game has already called `buildTop()` and `M.refresh()` when a mod's listener runs.
  - **Build mod labels with `t()` and re-render them in `onLocaleChange`.** To match game buttons, compute the label with `t()` (e.g. `t("pause.options")`) instead of hard-coding the English text.
  - `setLocale` is exported, but switching the locale is a user choice: leave it to the game's Language button.

**Fragile:**
- Line numbers and minified locals.
- Exact call shapes: the `indexOf('oak_planks')` capture depends on main.js:356 being the first `texNames.indexOf`.
- Id arithmetic: use `baseOf(id)` (or the same rule: `id & 255` only for 4096-32767), not `id & 255`, which breaks wide ids (1024-4095). Size per-id tables by `eng.idTop`/`BASE_TOP`, not 256.
- Field names of `S`, `eng.st`/`eng.ray` slot indices, WASM export names, binary layouts, `menuName` strings.
- **English UI text.** Button labels, aria-labels and dialog titles are `T(key)` now. The English strings are unchanged, so English-text selectors still work in `en` but fail in the 12 other locales.
- Prefer feature checks (does the method exist, does it have the expected arity) and fall back to doing nothing.

**Gotchas:**
- Import game modules only after the DOM exists, at the exact URL `/js/<name>.js`, to get the same instance.
  - `menus.js:19` caches `#screen` at evaluation time.
  - Importing menus.js too early, or anything that pulls it in (`survival/client.js`, `wardrobe.js`, `blueprint-ui.js`, `controls.js`, `survival/player.js`, `survival/onboarding.js`, `survival/end.js`), would break every menu.
  - `i18n.js` has no DOM side effects at import (it only sets `<html lang>` on a locale change), so it is safe to import early. `lang-select.js` calls `sojoOptions` at import.
- Module namespaces are read-only: you cannot replace an exported function, only patch the objects and prototypes it exposes.
- `Array.prototype.indexOf` is hot: compare the string first, then do the work.
- Hooks inside `frame()` must not throw. rAF re-arms first (frameloop.js `step`), so a throw silently skips the rest of every frame (rendering, `net.pos`).
- The game now watches its own frame rate (§4): a sustained in-world drop of 1.8× or more makes it reallocate `#hud` and the font atlas (`regainCanvases`, up to 3 times), and a lost WebGL context reloads the page after 3 s.
- Keep pointer lock working: `#gl` `requestPointerLock`, and `pointerlockchange` opens pause. Do not swallow `window` keydown or mouse events with capturing listeners.
- During IME composition in chat, `onKeyDown` returns early (`composing(e)`, main.js:2508-2509, 2642). Keybind handlers should also skip `e.isComposing || e.keyCode === 229`.

**Never break:**
- **Turnstile:** `challenge`, `turnstileCheck`, the overlay `.turnstile-overlay` (z-index 5000), and the `challenges.cloudflare.com` script. Don't hide, block, auto-solve or delay it. There is one attempt per connection, then "Couldn't join world".
- **The hello payload and `PROTO`** (now 20): the server answers `old` and the game stops.
- **Server authority:**
  - creative edits can be reverted (DENY);
  - survival dig/place are validated, and predictions are rolled back via `digack`/`placeack`;
  - chat is filtered (spam, links, promotion); kicks and bans apply.
  - Don't forge `dig`/`place`/POS traffic or alter movement (that includes calling `net.pos` with an `at` position). Test tools may drive real input in the user's own worlds: see the hard rules in `.claude/CLAUDE.md`. The server presumably checks movement too (inferred, the server is not visible).
- **Credentials:** `mc.tok`, Sojo tokens, `mc.admin` and `mc.key.*` are secrets. Never log or send them anywhere.
- `/api/translate` is the game's own request. Our scripts must not call `/api/` endpoints (`npm run check` forbids it).
