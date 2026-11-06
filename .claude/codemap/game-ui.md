# Game UI codemap: screens, CSS, HUD, input

Verified against game build b10d551d41 on 2026-11-06 (re-verified from f6b38f505d, itself from c25d4c024d, itself from 6b3963e444, itself from 575c9209bc, 325afb04b5, c111547912 and d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). b10d551d41 changed main.js, menus.js (one line, the Blueprints button), blueprint-ui.js, lang/en.js and `survival/{client,clicks}.js`; index.html, style.css, ui.js, keys.js and i18n.js are byte-identical to f6b38f505d's. f6b38f505d changed main.js, menus.js, inventory.js, blueprint-ui.js, style.css (appended rules only, for the Controls screen) and `survival/*`, and added `keys.js` and `controls.js`; index.html, ui.js and i18n.js are byte-identical to c25d4c024d's. c25d4c024d changed main.js, menus.js, ui.js, style.css (two selectors, for `#recipesearch`) and `survival/*`, and added `blueprint-ui.js`, `sound-cats.js`, `survival/hotbars.js` and `survival/recipe-book.js`. Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build b10d551d41's `pretty/`, moved from f6b38f505d with a line diff of the two snapshots.
- `M` = `menus.js`.
- `S` = the game state object (`main.js:188`).
- `G` = the host object main.js gives menus.js (`main.js:3312`, via `initMenus`).
- Neither `S` nor `G` is global, but since f6b38f505d `M.kit().G` reaches both (§5). `window.__mc` exists only on DEV hosts (`main.js:3493`).

**Since c111547912 every label is localised.** Menus, HUD buttons, dialogs and canvas text use `T(key)` from `js/i18n.js` (13 locales, chosen by `mc.lang` or the browser). The English strings are the same as before, so English selectors still match in `en` but not in other locales. See §7 and game-core.md §9.

## 1. Overview: DOM layers (`pretty/index.html`, z-index from `pretty/style.css`)

- `#gl` is the WebGL2 world canvas: z auto, `tabindex=0`, the pointer-lock target. It gets `.pix` (pixelated) while the claim/verify/pending screens are up (`main.js:472,522`).
- `#hud` is a 2D canvas, z1, `pointer-events:none`. The whole in-game HUD is canvas-drawn here every frame: hotbar, chat log and chat field, nametags, F3, hints, tab list, survival bars.
- `#cross` crosshair `<img>` z2 · `#touch` (stick, jump, sneak) z3 · `#hudtop` (`#hudleft`/`#hudright` DOM buttons) z4 · `#chat-toggle` and `aside#world-sponsors` z4 (z6 with `.pause-visible`), both created by JS.
- `#screen > .inner` z5 holds every menu. Menus are DOM elements, but their titles and button labels are pre-rendered `<canvas>`es, not text.
- `#chatbox` z6, `#invsearch` z8 and `#recipesearch` z8 (new in c25d4c024d, the recipe book's search, created at `survival/recipe-book.js:237`) are invisible `<input>`s laid over canvas-drawn fields. `#chatbox` is now `maxlength=256` (`CHAT_MAX`, chat-pending.js:5; was 120). `#inv` z7 is the canvas for the creative inventory and for survival containers.
- `#adv` advancement toast canvas z9 (created on demand) · `#note` DOM toast z10 · `#load` loading canvas z11 · `#fatal` z12.
  - `#load` is shrunk to 1×1 backing pixels while hidden (`resize`, main.js:506-514; since 325afb04b5 also right away in `hideLoad`, main.js:439, and `frameBody` resizes when a shown `#load` is still 1×1).
  - `.off` and `[hidden]` both mean `display:none!important` (`style.css:18,21`).
- Overlays appended to `<body>`:
  - `.se` skin editor z4500, `.sp` z4600, `#sign-editor`, `#book-screen`;
  - `#anvil-name` (new: the survival anvil's fixed rename `<input>`, z1002, `survival/anvil.js:50-56`);
  - the turnstile overlay z5000 (`M:234`), `#sponsor-tooltip` z10000.

## 2. Screen system (`pretty/js/menus.js`)

**Core API (exported):**
- `showScreen(name, build, look)` `M:143`.
  - `name` becomes `S.menuName`.
  - `build` is `() => Array<Node|null|false>` (falsy items are dropped). It is stored as `S.menu` and called again on every refresh.
  - `look` is a class string appended after `on` on `#screen` (`className` = `"on"`, plus `" " + look` when given). So the title page is `on title` and the pause menu `on dim`. Since c25d4c024d both show the Options button, so that button alone no longer means "pause menu": test `dim` as well.
  - Side effects: stops sponsor previews; closes the creative inventory (`G.closeInv`, unless `name==='inv'`); `.inner.replaceChildren(...)`; `scrollTop=0`; `G.releaseInput()` (clears held keys, mouse and stick, and exits pointer lock); `G.updateTop()` (hides `#hudtop` and `#touch`).
- `refresh(...names)` `M:156`: calls `S.menu()` again and replaces `.inner`'s children.
  - No-op when there is no menu, when `menuName==='inv'`, or when `names` is given and doesn't include the current screen.
  - Keeps `#screen.scrollTop`, the scroll of the `.servers` and (new in f6b38f505d) `.keylist` lists, and the focus and selection of the focused element, matched by its `data-k`.
- `closeMenu()` `M:179`: clears `S.menu`/`S.menuName`, sets `#screen.className=""`, empties `.inner`, runs `updateTop`. It does **not** re-lock the pointer or focus `#gl`. `resume()` (`main.js:3090`, not exported) does both.
- `back()` `M:249`: there is **no screen stack**, unchanged in c111547912. It's a hard-coded chain:
  1. `S.closed` → `location.reload()`
  2. claim/pending → stay put
  3. sponsor (opened from mine) or mineedit → mine
  4. sponsor, sponsored or mine → `openServers`
  5. sounds or controls → `openOptions` (`M:255`; sounds new in c25d4c024d, controls in f6b38f505d)
  6. title page → `showTitle`
  7. verify, owner or create opened from the game → `G.resume`
  8. started → `openPause`
  9. otherwise → `closeMenu`

  An unknown (custom) name lands on step 8, `openPause()`, in a world, and on step 6, `showTitle()`, on the title page. So Options' Done (`back`) returns to the pause menu in a world and to the title on the title page.
- `showMessage(title, text, buttons=[[T("menu.back"), back]])` `M:201`: a generic dialog (name `msg`, look `dim`). Each button is `[label, fn | url-string (rendered as <a target=_blank>) | {at, run} retry]`.
- Escape while any screen is open (`main.js:2678`): `pause` → `resume()`, otherwise `M.back()`. Ignored when `S.closed`, on a card, and on `title`/`death`.
- The `look` values in use: `dim` = `rgba(16,16,16,.62)` (`style.css:86`); `blur` = `.4` black + `backdrop-filter:blur(5px)` (`:92`); `title`; `card`; `death` (style injected as `#deathcss`); `endcredits`; `blur servers-menu`.

**All screens** (name · opener · look · contents):

| name | opener | look | contents |
|---|---|---|---|
| `title` | `showTitle(text?)` `M:268` | title | logo and splash (`title.splash1-6`); Multiplayer, Create New World, **Options** (new in c25d4c024d, `M:284`: the label `T("pause.options")`, the same as the pause menu's, opening `openOptions`), Skins & VIP ("Skins & Royal" on Sojo), blurb, Discord. Language is inside Options |
| `servers` | `openServers(note?, retry?)` `M:320` | blur servers-menu | search `[data-k=sq]`, Sort:/Show: cycle buttons (`wide`), a `.servers` list of `.srow`, Join/Create/Refresh/Sponsor/Back |
| `sponsor` | `openSponsor(placement?, from?)` `M:738` | blur | sponsor checkout form (`spt spd spl spb spemail spworld`). Opens a new tab when started or framed |
| `sponsored` | `openSponsored(session)` `M:1342` | blur | payment confirmation |
| `mine` / `mineedit` | `openMine(path)` `M:1437`, `openEditMine` `M:1557` | blur | manage a sponsor listing (`set sed sel`) |
| `create` | `openCreate(fromGame?)` `M:1697` | blur | name `[data-k=wn]`, Game Mode, Who can build (creative) or PvP + Keep Inventory (survival), Whitelist, Listed in server list |
| `options` | `openOptions()` `M:1811` | dim | In order: title, label "Field of View", the FOV control `div.fov-control > input[type=range][data-k=fov]` (30–110, aria-label `T("options.fov")`) (`M:1815`), Held light, **Music & Sounds...** (`T("options.sounds")`, `M:1858`, opens `openSounds`; new in c25d4c024d, replacing the Music slider), **Controls...** (`T("options.controls")`, `M:1859`, opens `openControls`; new in f6b38f505d, not on touch), Show my country, **Auto-refill** (`mc.refill`, new in 6b3963e444), **Translate chat**, **Language** (cycles `LOCALES`, or uses the Sojo picker), Done. Reached from the pause menu and, since c25d4c024d, from the title. Details below the table |
| `sounds` | `openSounds()` `M:1883` (new in c25d4c024d, exported) | dim | title, then one slider for each of `CATS` (`sound-cats.js:1`): `div.fov-control > input[type=range][data-k=vol-<cat>]`, 0–100, for master, music, weather, block, hostile, neutral, player, ambient and voice; Done → `openOptions` |
| `controls` | `openControls()` `controls.js:44` (new in f6b38f505d, exported; imported by menus.js) | dim | title, a scrolling `.keylist` of `.keycat` headings and `.keyrow`s, then Reset Keys and Done. Details below the table |
| `pause` | `openPause()` `M:1921` | dim | "Game Menu". Details below the table |
| `blueprints` | `openBlueprints()` `blueprint-ui.js:80` (new in c25d4c024d; opened from the pause menu's Blueprints button) | dim | set corners A and B, name, save and copy a link, load a link, "My blueprints". Picking a corner or placing a ghost closes the screen and runs in the world (§5). Since b10d551d41 a survival player without creative rights gets no corner or save rows, Guide replaces Paste, and a "Clear build guide" button shows while a guide is anchored |
| `achievements` | `openAchievements` `M:1976` (private) | dim | `.achlist` of `.ach[.on]` |
| `players` | `openPlayers` `M:2016` (private) | dim | `.row.p` rows: face canvas, `.who`, country mark |
| `verify` | `openVerify(fromGame)` `M:2066` | dim | post on 𝕏, paste link `[data-k=pv]` |
| `claim` / `pending` | `openClaim` `M:2093` / `openPending` `M:2108` | dim | publish the world / wait for verification (back is blocked) |
| `owner` | `openOwner(fromGame)` `M:2291` | dim | Owner/Admin tools: rename `[rn]`, lock, kick/ban, roles (`wladd`, `opadd`), whitelist, **named roles** with per-role permissions (`buildNamedRoles` `M:2545`, `PERMS` in `rules/roles.js`), **world rules** from the `RULE_ROWS` table (`M:2636`, built by `buildRules` `M:2660`; a row shows only when the `roles` reply has that field, and it sends `{t:"rule",k,v}` through `ruleSet` `M:2425`, no longer a chat command), **Translate all chat** and **Music** (rules too), undo builders (`S.room.caps.undo`), Reset world. Sections are gated by `can(perm)` `M:2428`, and non-owners with a menu permission can open this screen (`staff()`, `main.js:1557`) |
| `msg` | `showMessage` `M:201` | dim | dialogs: reset confirm (`confirmReset` `M:2848`), disconnected, voice, playing in another tab |
| `card` | `main.js:822` | card | logo only (`?card` preview) |
| `wardrobe` | `wardrobe.js:780` | dim | Skins & VIP |
| `death` | `survival/player.js:471` | death | You died!/Game over!, score, Respawn, Title screen (disabled for the first 1 s) |
| `credits` | `survival/end.js:113` | endcredits | End credits (all keys swallowed, `end.js:205`) |
| `spawn-onboarding` | `survival/onboarding.js:68` | dim | "Spawn is protected", buttons with `[data-spawn-action]` |
| `inv` / `sinv` | `main.js:3204` / `:3213` | — | pseudo-menus with `S.menu = () => []`, shown while the `#inv` canvas is open. `#screen` does not get `.on`. The survival anvil is a `sinv` container window plus `#anvil-name` |

**Controls details** (`controls.js`, new in f6b38f505d):
- Each `.keyrow` is a `.keyname`, a key button `.mcb.key[data-k="key-<bindId>"]` with `aria-label` `"<name>: <key>"`, and a `.mcb.keyreset` button that is disabled at the default. A clashing bind gets `.clash` and a red label (`conflicts()`, keys.js:122).
- Pressing a key button sets the module-local `waiting`. Window **capture** listeners (`controls.js:16-42`, added at module load) then take the next `keydown` or mouse button and call `K.set`, with `preventDefault` and `stopImmediatePropagation`. Escape cancels, so it can't be bound. The follow-up `click`/`auxclick` of a mouse bind is swallowed.
- **"Waiting" has no DOM sign.** The `> key <` label is a canvas, and the button's `aria-label` and classes don't change. Only `.keylist` under `#screen.on` shows that the screen is up, so a mod key listener has to stand down for the whole screen.
- Changes save straight away. There is no cancel, and Done is plain `back`.

**Options details** (`M:1811-1881`):
- `.fov-control` is **not unique**: every slider on `sounds` reuses it. Select the FOV slider by `[data-k=fov]` and a volume by `[data-k=vol-<cat>]`. `[data-k=music]` no longer exists.
- The FOV `input` handler writes `mc.fov` (`M:1827`).
- A `sounds` slider calls `G.setVolume(cat, v/100)` (`main.js:3317`): music goes through `music.setVolume` (`mc.musicVol`), anything else through `saveVolume` (`mc.vol.<cat>`), and the new levels are then pushed to sound.js, music and voice.
- Translate chat calls `G.translator.setOn(!on)`, which writes `translateChat`.
- Language calls `chooseLanguage()` (lang-select.js:37), then `refresh("options")`. Without Sojo it steps to the next `LOCALES` entry and writes `mc.lang`.
- The game refreshes `options` itself on `room` messages (`main.js:2156`) and once the music manifest has loaded (`onChange`, `main.js:325`; it no longer adds anything to this screen).

The pause screen's buttons, in order:
1. Back to Game.
2. Share world or Save your progress.
3. Players: N (plus Achievements when `S.room.caps.ach`).
4. Skins.
5. Claim here (new in 6b3963e444; signed in only; sends `/claim`).
6. Blueprints (new in c25d4c024d; since b10d551d41 for every player, not only with `S.gm`).
7. `Options…`.
8. `Distance: N`, with Fullscreen beside it when available.
9. A status line.
10. Return to Title Screen.
11. Log out (signed in, not Sojo).
12. `.corners`, holding the Discord link and the VIP link (hidden for VIPs).

These are now `T("pause.backToGame")`, `T("pause.options")`, `T("pause.distance",{n})`, `T("pause.full")`/`T("pause.exitFull")` and so on; the English text is unchanged.

Other exports: `kit` (`M:132`: returns `{btn, title, P, row, field, showScreen, back}`, and since f6b38f505d `G` and `text(s, color)`, §7), `openSounds`, `turnstileCheck`, `rolesNote`, `onRoles`, `onRenamed`, `onUndoBanResult`, `onUndoBuilders`, `onUndoPreview`, `onUndoResult`, `confirmUndoPreview`, `cancelUndoPreview`, `initMenus`.

**Building blocks** (menus.js helpers are private; ui.js helpers are exported):
- `fpx()` `M:24` = `max(1, round(G.UI.u * devicePixelRatio))`: device px per GUI px for label canvases.
- `btn(text, fn, size, disabled)` `M:25` wraps `ui.button(G.font, fpx(), ...)`.
  - `size` is one of `half wide third small pvp keepinv`. These are just CSS width classes; `third` and `small` now size to their label (§3).
  - **Toggles and cycles** are plain btns whose label reads `"Label: ON"` (create, `T("create.on")`) or `"Label: On"` (options, `T("options.on")`). The handler flips the state and calls `refresh(name)` (e.g. `M:1733`, `M:1844`). There is no toggle widget. Owner rule pairs (`sw()`) are two `half` btns, with `"> "` prefixed to the active one.
- Helpers:
  - `title(text)` `M:30` → `canvas.mct`.
  - `label(text)` `M:35` → `canvas.lbl` (`#a0a0a0`).
  - `P(text, cls)` `M:40` → `p.desc[.small|.err|.code]`, with 𝕏 wrapped in `<b>`.
  - `row` `M:48` → `div.row`; `prow` `M:49` → `div.row.p`; `rbo(b)` `M:26` adds the rainbow border `.rbo`.
- `field(k, value, props)` `M:122` → `input.link[data-k=k]`. The `data-k` is what lets `refresh()` restore focus.
- **Sliders:** all are `div.fov-control > input[type=range] + div.fov-caption`: FOV (`M:1815`) and one per sound category on `sounds` (`M:1883`). On `input`, the caption div's canvas is replaced with a freshly drawn one, and `aria-valuetext` is set.
- `ui.el(tag, props, ...kids)` `ui.js:5`: `class` sets className; `on*` function props become listeners; boolean and number props are set as properties; everything else becomes an attribute; `null`/`false` values and kids are skipped.
- `ui.button(font, px, text, onclick, size, disabled)` `ui.js:425`: `button.mcb[.size]` with `type=button`, `aria-label=text`, `disabled`, and two canvases `.lo` (white, `#a0a0a0` when disabled) and `.hi` (`#ffffa0`). Click → `preventDefault`, `playClick()`, `onclick(e, b)`. A disabled button gets no listener at all.
- `ui.hudButton(font, px, label, key, onclick, aria)` `ui.js:478`: `button.mcb.hb` with a drawn keycap. `mousedown` calls `preventDefault`, so focus stays on the game.
- `ui.textCanvas(font, str, px, color='#fff', shadow=true)` `ui.js:403`: a canvas of `(width+1)*px × 9*px` device px, CSS size = px / dpr.
  - New: if the string needs glyph pages that aren't loaded yet, it **repaints itself later** (`font.whenReady(str, paint)`, `ui.js:412`). `hudButton` canvases do the same (`ui.js:495`).
  - `ui.preloadButtons()` `:417`.
- **aria-label is the only stable handle on a game button, and it is now localised.** It equals the label text in the current locale.
  - In `en`: `button[aria-label="Options…"]` (U+2026), `[aria-label^="Distance:"]`, `"Back to Game"`, `"Fullscreen"`/`"Exit Fullscreen"`, `"Done"`.
  - In any locale: build the selector from `t("pause.options")`, `t("pause.distance",{n})`, `t("pause.backToGame")`, `t("pause.full")`, `t("pause.exitFull")`, `t("menu.done")` (`/js/i18n.js`).
  - Titles (`.mct`) and labels (`.lbl`) are bare canvases with no text. Sliders are best found by `data-k`.

**Game settings in localStorage** (written through main.js `store`, `main.js:138`; `set(k, null)` removes the key):

| key | where | meaning |
|---|---|---|
| `mc.fov` | `main.js:210-213`, `M:1827` | base FOV. The loader only accepts 30–110, anything else becomes 70 |
| `mc.rd` | `main.js:235`, `:3275` | render distance ∈ `RDS=[4,6,8,10,12]` (`view.js:1`), default 8 (6 on touch) |
| `mc.heldLight` | `main.js:208`, `M:1843` | `"0"` turns off held-item light |
| `mc.refill` | `M:1852-1857`, `survival/player.js:126` | **new in 6b3963e444.** `"0"` turns off hotbar refill (the "Auto-refill" button) |
| `mc.showCountry` | `country.js:2`, `M:1848` | `"0"`/`"1"`, share your country flag |
| `mc.lang` | `i18n.js:20` (`LANG_KEY`), `lang-select.js:15,45` | **new.** Locale code (en, es, pt-BR, de, fr, it, nl, id, ja, ko, zh-Hans, zh-Hant, ru). Ignored on Sojo pages |
| `mc.musicVol` | `music.js:3` | **new.** Music volume 0–1 (default 0.5) |
| `mc.vol.<cat>` | `sound-cats.js:12` (`KEY`), `G.setVolume` | **new in c25d4c024d.** Volume 0–1 of every sound category except music (default 1). Music keeps `mc.musicVol` |
| `mc.hotbars` | `survival/hotbars.js:4` | **new in c25d4c024d.** Saved hotbars as JSON: 9 entries, written by C + digit, read by X + digit |
| `mc.bpLink` | `blueprint-ui.js:19` | **new in c25d4c024d.** A blueprint link from `?bp=`, kept until it is used |
| `mc.bpGuide.<room>` | `blueprint-ui.js:37` (`GUIDE`) | **new in b10d551d41.** The anchored survival build guide as JSON `{id, at, q, dim}` |
| `mc.keys` | `keys.js:1` (`KEYS_KEY`) | **new in f6b38f505d.** The user's key binds as JSON `{bindId: code}`, non-defaults only. Not a secret; not the `mc.key.<room>` family |
| `translateChat` | `chat-translate.js:3` | **new, no `mc.` prefix.** `"1"`/`"0"` = your Translate chat choice; absent = follow the world's setting |
| `mc.hotbar` | `state.js:6,17` | creative hotbar as JSON (9 ids) |
| `mc.sid` / `mc.tok` / `mc.bridged` | `main.js:170,172`, `identity.js:25-26` | session id / login token JSON / token already bridged to a cookie |
| `mc.key.<room>` / `mc.admin` / `mc.nonce` | `main.js:173,180`, `M:2056` | owner key per world (also drives the "My worlds" filter, `M:550`) / admin key / verify nonce |
| `mc.recent` | `recent.js:1` | recently played worlds |
| `mc.voiceOff` / `mc.voiceNotice` | `main.js:1903,3447` | voice opt-out / voice notice seen |
| `mc.cos` / `mc.wardrobe` | `wardrobe.js:81,84` | cosmetics ticket cache / has a wardrobe |
| `mc.adseen` | `sojo-ads.js:131` | ad impressions, kept 2 h |

New in 325afb04b5, in **sessionStorage**: `mc.glreload` (main.js:2799-2802), the time of the last automatic reload after a lost WebGL context (at most one per 60 s).

## 3. Styling system (`pretty/style.css`, `main.js` `resize()`)

- **CSS variables.** Defaults are in `:root` `style.css:6` (`--u:2px --d:1.5px --hp:1px --hb:44px`). `resize()` `main.js:490` sets all four on `documentElement.style` (`:535-538`). It runs:
  - at boot;
  - **deferred to the start of the next frame** after a window `resize`, a `fullscreenchange` (again 300 ms later) or a `visualViewport` resize. The listeners only call `wantResize()` (`main.js:557-560`; listeners at `:2787` and `:2810-2814`), and `frameBody()` runs `if (resize()) M.refresh()` first thing (`:610-612`);
  - also deferred (new in 325afb04b5) after `regainCanvases()` and after a 2D canvas's `contextrestored` (game-core.md §4);
  - when `#inv` shows or hides (`invStale`, new in 6b3963e444, `main.js:471`): `#inv` is sized like `#hud` only while it's shown and is 1×1 while it has `.off`. `frameBody` checks it at the top and again before `inv.draw` (`:609`, `:664`). `openInventory` sizes the inventory from `hudCanvas`, because `#inv` can still be 1×1 at that moment;
  - on every `setInput()` (`:2371`);
  - when a pixelated menu opens or closes (`:676`).
- With `full=devicePixelRatio` and `dpr=backingDpr(full, innerWidth, innerHeight)` (`frameloop.js:24`: `min(full,2)`, lowered so the backing store stays ≤ 3840×2160):
  - `--u` = `max(1, round(raw*full))/full` px, where `raw = max(TOUCH?2:1, min(3, innerWidth/280, innerHeight/190))`. This is CSS px per GUI px, snapped to device pixels. It is also `G.UI.u`.
  - `--d` = `max(1, round(u*full)−1)/full` px, one device px smaller. Used for `.desc` body text.
  - `--hp` = `hpx/full` px, where `hpx = max(TOUCH?2:1, round((TOUCH?1.75:1.25)*full))`. Sizes the `#hudtop` buttons.
  - `--hb` = `(22*gs + pad)/dpr` px: the hotbar height. Positions the touch buttons.
- When `u` changes, `resize()` returns true and `frameBody()` calls `M.refresh()` (`main.js:611`), which re-renders the label canvases. A change of `hpx` triggers `buildTop()` instead.
- **HUD scale is separate from `--u`.** `UI.gs = clamp(floor(min(w/320, h/240)), 1, 6)` on device px (`main.js:525`). Example: 1920×1080 at 1×: `gs=4`, `u=3`.
- **Font.**
  - DOM text uses `@font-face "Tweetcraft"` from `/assets/font/tweetcraft.woff2` (`style.css:1`, `font-display:block`). Body is `16px/1.25 "Tweetcraft"`.
  - Canvases use `ui.Font` (`ui.js:141`), built from `/assets/gui/ascii.png` (an 8×8 glyph sheet, 16×16 grid, accent map `EXTRA`).
  - **New:** codepoints above 255 (Cyrillic, CJK, …) come from 16×16-cell glyph pages loaded on demand: `/assets/font/g/<hex page>.png?v=GLYPH_V`, plus a combined `/assets/font/g/ui.png` for frequent CJK UI glyphs (`glyph-ui.js`, lazy-imported). Tinted cells are cached in an atlas canvas.
  - A missing page draws `?` until it loads. `font.missing(str)`, `font.whenReady(str, repaint)` and `font.onChange(fn)` report load state. `canDraw(str)` (exported) tells whether the font can draw a string at all.
  - `Font.width(str)` is in GUI px. `Font.draw(ctx, str, x, y, s, color, shadow)` takes an integer scale `s`, and turns `…` into `...` and `×` into `x` first (`Font.prep`).
  - The shadow is drawn offset by `s` in `color>>2` per channel (`shadowOf`, `ui.js:393`): white → `#3f3f3f`, `#ffffa0` → `#3f3f28`, `#a0a0a0` → `#282828`. Lines are 9 GUI px.
- **Buttons.** `.mcb` `style.css:275`:
  - 200×20 `--u`, border-image `url(/assets/gui/button.png) 3 fill / calc(3*var(--u))`.
  - Hover and focus-visible switch to `button_highlighted.png` and swap the label canvases (`.lo` hidden, `.hi` shown).
  - `:disabled` uses `button_disabled.png`.
  - Widths: `.half` 98, `.wide` 148. **Changed in c111547912:** `.third` is `width:auto; min-width:64u; max-width:30vw; padding:0 4u`, and `.small` is `width:auto; min-width:60u; max-width:46vw; padding:0 4u` (`:324-335`), so they grow with longer translated labels. `.hb` `:770` is auto width × 18 `--hp`. `#hudleft.stack` (`:763`) stacks the left HUD buttons when they would overlap the right ones (`fitTop`, `main.js:2382`).
- **Other assets:**
  - `/assets/gui/`: `hotbar.png`, `hotbar_selection.png`, `crosshair.png`, `toast.png`, `inv/*`, `panel/*`, `container/*`.
  - `/assets/atlas/gui.json` + `gui.webp`: survival sprites.
  - `/assets/title/tweetcraft_edition.png`, `/assets/misc/discord.png`, `/assets/block/dirt.png` (loading and fatal backdrop).
- **Key classes:**
  - `.inner`: column flex, gap `4u`, padding `10u 6u` (`:101`).
  - `.row` / `.row.wrap`: flex rows, gap `4u` (`:215`). `.row.p` is 200u wide, for a field plus a button (`:347`).
  - `.desc` (`:188`): `8*--d`, `#a0a0a0`, max 230u. Variants `.small` `#808080`, `.err` `#ff5555`, `.code` `#ffff55`.
  - `.link` input (`:411`): black, `1px #a0a0a0` border, font `8*--u`.
  - `.mct` / `.lbl`: pixelated canvases. `.who`/`.face`: player rows. `.servers`/`.srow`: lists. `.fov-control` (`:227`): range input styled with a button thumb (used by the FOV slider and the `sounds` sliders).
  - `.keylist`, `.keycat`, `.keyrow`, `.keyname`, `.mcb.key`, `.mcb.keyreset` (new in f6b38f505d, `:1633-1671`): the Controls screen. The list scrolls inside `.keylist`, not `#screen`.
  - `.corners`, `.discord`, `.vipcorner`: fixed z6 corner links. `.ach*`: achievements.
- **Making injected UI look native:**
  1. Best: build with the game's own `ui.button`/`ui.textCanvas`.
     - `font` is a `Hud` instance's `.font` (capture it by wrapping `Hud.prototype.draw`), or `new Font(img)` with a loaded `/assets/gui/ascii.png` `<img>`. The constructor (`ui.js:142`) copies it to a 128×128 canvas; glyph pages then load from `/assets/font/g/` by default.
     - `px = max(1, round(parseFloat(getComputedStyle(documentElement).getPropertyValue('--u')) * devicePixelRatio))`, which is the game's `fpx()`.
     - The game's font draws every locale; a DOM font fallback may not.
  2. With text instead of canvases:
     - Set `font: calc(8 * var(--u)) "Tweetcraft"` explicitly, because buttons and inputs don't inherit it.
     - Use `#fff` text with `text-shadow: var(--u) var(--u) 0 #3f3f3f`; hover `#ffffa0`; disabled `#a0a0a0`.
     - Use `.desc` for prose and `.link` for inputs.
     - The `Tweetcraft` woff2 may lack CJK/Cyrillic glyphs (inferred), so such text falls back to a system font.
  3. Size everything in multiples of `var(--u)` and set `image-rendering:pixelated` on canvases and images.
  4. Reuse `.mcb` (plus the size classes), `.row`, `.desc`, `.link`.
  5. Call `playClick()` (`sound.js:130`) on click.
  6. Localise labels with `t()` and re-render them in `onLocaleChange` (§7).

## 4. HUD (canvas, `pretty/js/ui.js` `Hud`, `survival/*`)

- **Per-frame order.** `frame()` `main.js:593` → `frameBody()` `:608` → `render()` `:847` → `gfx.draw` → `hud.draw(o)` `:1033` → `survival.drawHud(hud, font, UI.gs)` `:1061` (only when `show`) → `drawUndoPreview` `:1062` → `hud.suggestions(UI.gs)` `:1063` → `chatToggle.update(...)` `:1064`. After `render()`, `music.update`, `inv.draw` / `survival.screens.draw()` paint the `#inv` canvas, then `updateAdvancement`.
- `Hud.draw` **runs every frame, title screen included, and clears the canvas first.** It returns right after clearing when `!o.show`, where `show = S.started && S.showHud && !CARD` (`:898`).
- `drawUndoPreview` also draws the blueprint hints since c25d4c024d (`BP.hud`, when `BP.shows()` and no menu is open; `shows()` is new in b10d551d41 and also covers the build guide's progress and materials lines). They are canvas text, so nothing in the DOM shows them.
- **`gs` / `s`** is device px per GUI px on `#hud`, whose size is `innerWidth×innerHeight×dpr` (the `backingDpr` above).
- **The `Hud` instance** (`ui.js:631`) is constructed at `main.js:372`.
  - Properties: `c` (canvas), `x` (2D context), `font`, `sp` (`{hotbar, sel}` images), `icons`, `rect`, `chatLayout`, `suggest`, `suggestRect`, `chatFirst`.
  - `icons` is a `SurvivalIcons` from `main.js:367`, whose `decorate()` draws stack counts. Survival swaps in its own at `survival/client.js:72`.
- **`draw(o)` `ui.js:640`** reads these fields of `o`:

  | field | meaning | field | meaning |
  |---|---|---|---|
  | `gs` | GUI scale | `show` | HUD visible |
  | `pad` | `6*gs` in touch mode | `sel` | selected hotbar slot |
  | `hotbar` | 9 item ids | `stacks` | survival stack data |
  | `tags` | nametags `[{x,y,s,text,color,rainbow,talk,mark}]` | `lift` | survival: 24 GUI px |
  | `item` | `{text,a}`, held item name (localised via `tn`) | `toast` | `{text,a}` |
  | `chat` | `[{text,color,nameStyle,italic,a}]` | `input` | chat field state or null: `{text, caret, sel…, max, suggest, blink, comp}`; `comp` = the IME composition range `[from,to]` (new), underlined in `#e0e0e0` |
  | `debug` / `debugY` | F3 lines / their y offset (see "F3 debug" below) | `hint` / `hintAbove` | hint text / place it above the crosshair |
  | `tab` | `{header, footer, rows:[{text,color,face,mark}]}` | | |

  Layout, in units of `s`:
  - Nametags are drawn first.
  - The hotbar sits at `x=W/2−91s`, `y=H−22s−pad`, size 182×22, and sets `this.rect`.
  - Held item name at `hy−13s−lift`; toast at `hy−25s−lift`.
  - Chat lines stack upward from `hy−lift−16s` (`28s` when a toast is showing), 9s each, width `min(320s, W−4s)`, background `rgba(0,0,0,.5)`. Sets `this.chatLayout = {left, top, baseline, scale}`.
  - Then `chatField`, debug lines (top-left, from `2s + debugY`, ui.js:731-732), `hint`, `tab`.
- **F3 debug** (`debugLines`, main.js:1161; drawn only while `S.debug`). The lines, in order:
  1. `Tweetcraft (<host>)`;
  2. `N fps, N chunks, N particles`;
  3. `Display: WxH at N.NNx[, fullscreen]` (`#gl`'s backing size and `UI.dpr`);
  4. **new in 325afb04b5:** `GPU: <renderer>[ (SOFTWARE)]`, from `gpuName()` (gpuwatch.js:3), which shortens ANGLE strings to "device, API". "(SOFTWARE)" means it matched `SOFTWARE` (SwiftShader, llvmpipe, Microsoft Basic Render…);
  5. **changed in c25d4c024d:** `Frame: x ms (worst w, >50ms: n), JS y ms`. That is the mean rAF interval, the worst interval of the last second, how many intervals passed 50 ms, and the mean JS time in the frame callback;
  6. **new:** `Watch: usual N fps, regained R, lost L[, still slow: reload]`: the slow-frame watchdog's baseline ("?" until it has 8 samples), canvas reallocations and lost contexts (game-core.md §4);
  7. **new:** `Ping: N ms` (`net.rtt`) and `Remesh: n/s, x ms/s, max y ms` (`remeshSched.last`);
  8. **new in f6b38f505d:** `last slow N ms (T s ago): <top 4 phases>` (`ft.line`, main.js:1176, game-core.md §4) and, while any slow frame is kept, the hint `T("debug.copySlow", {key})`, which names the live `copySlow` key since b10d551d41. Both are empty lines before the first slow frame;
  9. `Heap: used / limit MB` (an empty line without `performance.memory`);
  10. then `XYZ`, `Block`, `Chunk` and the rest.
  - `debugY` now comes from `debugTop()` (main.js:1154): the bottom of `#hudleft` (when `#hudtop` is shown) or of a visible `#world-sponsors` (+4 px), whichever is lower, in `#hud` pixels. Before 325afb04b5 only `#hudleft` counted.
  - The block takes the top-left of `#hud` from that y down, about 26 lines × 9 GUI px. A mod overlay should sit elsewhere (top-right, say) or hide while F3 is on (`S.debug`, readable once `S` is captured, §5).
- **Methods.**
  - `chatField(o, s, pad)` `:743` draws the chat input at `H−pad−14s` with caret, selection, ghost suggestion and the IME underline.
  - `suggestions(s)` `:809` draws the command popup; `suggestAt(cx, cy)` `:845` maps client px to a popup row.
  - `hint(text, s, above)` `:854` sits below the crosshair at `H/2+20k`, or at `H*.32` when `above`, shrinking `k` until it fits.
  - `tab(t, s)` `:869` is the player list, centered at the top in columns of up to 20.
  - `drawLoading(c, font, dirt, o)` `:925` draws the `#load` screen.
- **Survival.** `SurvivalClient.drawHud(hud, font, gs)` `survival/client.js:390` → `drawCounts` `:586` (stack numbers on the hotbar) → each system's `drawHud`:
  - `PlayerClient.drawHud` `survival/player.js:413` → `SurvivalHud.draw(ctx, font, s, rect, st)` `survival/hud.js:28`.
    - It draws hearts, absorption, armor, food, air, the XP bar and level, and the attack indicator under the crosshair. Positions are relative to `hud.rect`.
    - Atlas sprite names are `hud/heart/*`, `hud/food_*`, `hud/armor_*`, `hud/experience_bar_*`.
    - When `st.cr` (creative-gamemode player, `player.js:451`) is set, the bar sprites and the level number are skipped.
    - `PlayerClient.drawHud` draws nothing while spectating (`st.sp`).
  - `BlocksClient` `blocks.js:110`: sleep fade.
  - `PortalsClient` `portals.js:43`: portal overlay.
  - `EndClient` `end.js:278`: boss bar at the top.
  - `CycloneClient` `cyclone.js:18` (new in c25d4c024d): the cyclone's boss bar at the top, moved down 22 GUI px while the dragon's bar shows in the End.

  `SurvivalClient.lift` `client.js:409` is the largest `lift` among its systems (24 from `player.js:55`).
- **DOM HUD parts.**
  - `#cross` gets `.off` toggled every frame (`main.js:1031`): it's hidden when a menu is open, in third person, or with the HUD off. It's sized `15*gs/dpr` in `resize`, with `mix-blend-mode:difference`.
  - `#hudtop`: `buildTop()` `main.js:2391` calls `replaceChildren` on both sides. Labels are `T("hud.*")`/`T("vc.*")`.
    - `#hudleft`: "≡" (aria `T("hud.menu")`, "Menu"), then one of Save your progress [V] (signed out), Owner/Admin tools [O] (owner or op) or Make your own world [M], then the voice buttons.
    - `#hudright`: Play in new tab (framed only), Inventory [E], Chat [T].
    - It is rebuilt at `:404,417,548,1619` (locale change)`,1900,2012,2170,2342,2354`. `updateTop()` `:2376` shows and hides it through the `hidden` attribute, then `fitTop()`.
  - `#adv`: `showAdvancement` `:1681`, a 160×32 GUI px `toast.png` that slides in for 5 s. Long names now wrap to two lines (`wrapText`), and it repaints when glyphs load.

## 5. Input (`pretty/js/main.js`)

- **Listeners** are registered in `bindInput()` `:2763`, called from `boot()` (`:405`) after assets load and before the network connects:
  - `window` keydown/keyup (**bubble phase**); window `blur` → `releaseKeys`; `pointerlockchange` → `onLockChange`.
  - Resizing: `window` `resize`, `document` `fullscreenchange` and `visualViewport` `resize` → `wantResize` (`:2787`, `:2810-2814`).
  - New in 325afb04b5, between those: `contextlost`/`contextrestored` on `#hud`, `#inv` and `#load`, and `webglcontextlost`/`webglcontextrestored` on `#gl`, which reload the page (`:2788-2809`, game-core.md §4).
  - `#gl`: mousedown, pointerdown/move/up, wheel (non-passive), contextmenu.
  - `window`: mouseup, mousemove, pointerup. `#inv`: pointer and wheel. `#stick`, `#t-jump`, `#t-sneak`: pointer handlers.
  - `#chatbox`: pointerdown/mousedown (caret placement), plus `compositionstart/update/end` (`:2822-2838`). During IME composition the input's own text is hidden (`opacity:0`) and the composing range is drawn on the canvas.
  - New in c25d4c024d, `main.js:2939-2966`: window **capture** `pointerdown` and `mousedown` remember what was pressed, and a window capture `contextmenu` blocks the browser menu everywhere, except on an editable element that was itself pressed or is focused.
  - Others: `ChatSuggest.listen` `chat-suggest.js:152` adds window **capture** pointerdown/mousedown/touchstart/wheel over popup rows. The skin editor adds window **capture** keydown/keyup that call `stopImmediatePropagation` (`skin-editor.js:463-464`). `#chat-toggle` stops key and pointer propagation. `SignsClient` ignores composing keys (`signs.js:128`).
- **`onKeyDown` `:2637`.** The first handler that claims the key returns:
  1. editors: `signs.key`, survival `labels`, `book`, `onboarding`, `end`.
  2. `S.resuming` → ignore the key.
  3. `S.chatOpen`:
     - **while composing (`compose.on || e.isComposing || e.keyCode === 229`, `:2513`) every key is left to the IME** (`:2646`);
     - otherwise `suggest.key` (Tab/Up/Down/Escape); Enter → `sendChat`; Escape → `closeChat`;
     - every other key goes natively to `#chatbox`.
  4. `survival.screens.key` (`screens.js:683`): Escape or `inventory` closes, a hotbar bind swaps, `drop` throws.
  5. creative `inv.key` (`inventory.js:226`): Escape or `inventory` closes, a hotbar bind assigns, a printable key focuses the search box.
  6. **Blueprint mode** (new in c25d4c024d, `:2662`): while `BP.active()` (a corner pick or a ghost) with no menu or chat, a `place`-scope key (`bpTurn` R, `bpKeep` K, `bpPaste` C) or Escape goes to `BP.key`, with `preventDefault`. Since f6b38f505d `BP.key` gets the bind id, not the code. Since b10d551d41 this also runs in survival: with no creative rights `bpPaste` anchors a build guide (`bpAnchor`), and its HUD line lists only `bpTurn` and `bpPaste`. An anchored guide is not this mode: `BP.active()` is false and it claims no keys. There is no DOM sign of this mode (§5, "Detecting state").
  7. Undo preview (`:2668`): the `bpPaste` bind confirms and Escape cancels. The other two `place` keys are claimed and do nothing.
  8. **Any `S.menu`**: the `perspective` bind gets `preventDefault`; Escape → resume/back; **everything else is ignored**, so inputs inside screens are safe.
  9. Ignore when not started or when the target is `INPUT`/`TEXTAREA`. In lock mode, a keypress with user activation re-requests the lock.
  10. `KB.prevent(e)` `:2695` (keys.js:117; new in f6b38f505d, replacing `PREVENT`) calls `preventDefault` for every bound code in any scope, and for Quote, unless Ctrl, Meta or Alt is down. That now includes letters and F11.
  11. The `playerlist` bind sets `S.tab` (held). After that, `e.repeat` is ignored, and Escape opens pause when not locked (`:2701`).
  12. `worldPress(c, e)` `:2707` records `S.keys[c]`, then tries, in order: `copySlow` while F3 is on, `survival.hotbars.key`, `jump`, `forward`, a hotbar slot, then the other actions. `#gl`'s mousedown in lock mode calls it too, with `KB.mouseCode(e.button)` (`:2863`), so any action can sit on a mouse button and `attack`/`use`/`pickItem` on a key. `worldRelease(c)` `:2749` is the matching release, from `onKeyUp` and `mouseup`.
- **Game keys.** Since f6b38f505d these are the **defaults** of `BINDS` (keys.js:10), so read the real code with `codeOf(id)` (§7). Each row of `BINDS` has a `scope`: `game` is always live, `row` only with `loadout` held, `place` only in blueprint mode and undo preview, and `debug` only with F3 open. Escape, Enter in chat and the screens' own editing keys are fixed.

  | group | keys |
  |---|---|
  | Movement | W/A/S/D move, with the arrows as `alt` codes (`KB.held` in `tick` `:708-709`); Space jumps, double-tap within 300 ms toggles flying; Shift (L/R) sneaks; double-tap `forward` sprints. `sprint` defaults to `ControlLeft`, but `held` ignores Control codes off Mac (keys.js:106), so Ctrl only sprints on Mac, while any other key holds sprint everywhere (`:716`). An `alt` code stops counting once any bind uses it (`codes`, keys.js:99) |
  | Hotbar | Digit1–9 select a slot, as does the wheel over `#gl`; Q drops (survival; Ctrl drops the stack); **F** swaps hands (survival, `:2733`). **Hotbar rows, survival only** (`survival/hotbars.js`, tried first in `worldPress`, `:2712`): tap **R** to cycle rows, **R + 1/2/3** to swap with a row (**1-5** with a backpack on, `rowCount`, rules/loadouts.js:2). For creative-mode players (`S.gm`) only: **C + digit** saves the hotbar, **X + digit** loads it |
  | Screens | E inventory; V verify; O owner tools (owner or op only); M new-world tab |
  | Chat, voice | P mutes or enables voice; T or Enter opens chat; `/` opens chat prefilled with `/` |
  | View | Escape pauses (when not pointer-locked); F1 toggles `S.showHud` (+ `updateTop`); F3 debug; **L with F3 open** copies the slow-frame report (new in f6b38f505d); F5 cycles `S.view` (0 first person, 1 behind, 2 front); **F11** toggles fullscreen (new in f6b38f505d, `:2747`); Tab player list while held; C confirms an undo preview. In blueprint mode (new): C sets a corner or pastes, R turns the ghost, K toggles "keep blocks under air", Escape cancels |
  | Mouse | LMB attack/break; RMB place/use; MMB pick block (since b10d551d41 in survival too: it selects the block's item in the hotbar or swaps it in from the inventory, `survival/client.js:265`); in drag mode, click and drag to look. **New in 325afb04b5:** MMB in the creative inventory picks up a full copy of a stack (`inventory.js`), and for creative-mode players in survival containers it clones the slot (`CLICK_MODE.CLONE`, screens.js:619-622). Both follow the `pickItem` bind since f6b38f505d. **New in 575c9209bc:** Ctrl/Cmd + MMB on a chest in creative mode picks a chest item carrying a copy of its contents (tooltip line "+ Contents"); capture-phase `window` `mousedown` and `keydown` listeners in survival/creative.js:53-59 record the modifier and do not `preventDefault` |
  | Touch | stick moves; drag on `#gl` looks; tap breaks or places (creative); survival adds `#t-hit`, `#t-use`, `#t-drop` (`survival/touch.js:33`) |
  | Unbound by default (`BINDS` plus a grep of the remaining `e.code`/`e.key` checks in `js/`, re-checked on b10d551d41) | B G H I J N U Y Z, Digit0, Backquote, F2, F4, F6–F10, F12. K acts only in blueprint mode and L only with F3 open, but `KB.prevent` covers both. F, R and X do nothing in creative worlds (no survival client). Ctrl+Z/Y are used only inside the skin editor. This table is only the defaults: a user can bind any of these, so ask `bound(code)` at run time |
- **Pointer lock and input modes.** `S.input` is one of `none|lock|drag|touch` (`setInput` `:2371`). `spawn()` `:790` picks:
  - `touch` when `TOUCH` (`matchMedia('(pointer: coarse)')` or `?touch`, `:124`);
  - `drag` when framed (inside an 𝕏 post), in tests, or when the lock is refused;
  - `lock` otherwise.
  - `active()` `:2364` = started, no menu or chat, not closed or resuming, and (in lock mode) actually locked. Look (`movementX*SENS`, `:2900`) and the wheel only work while `active()`.
  - Look deltas also pass `lockJump(e)` (`:2615`). It drops the first events after locking, plus single-frame spikes (`createSpikeFilter`, look.js).
  - When the lock is lost (Escape), `onLockChange` `:2579` opens the pause menu, unless a menu or chat is open. A running undo preview is cancelled instead, and so is blueprint mode (new in c25d4c024d, through `BP.key("Escape")`). Clicking `#gl` in lock mode re-requests the lock (`:2859`).
- **Detecting state without `S`:**
  - menu open = `#screen.classList.contains('on')`;
  - pause or another dialog, not the title = `on` and `dim`; the title = `on` and `title`;
  - inventory or container = `!#inv.classList.contains('off')`;
  - chat = `!#chatbox.hidden`;
  - typing = the active element is `INPUT`/`TEXTAREA`/contentEditable (includes `#anvil-name` and `#recipesearch`);
  - editors = `.se`, `#sign-editor` or `#book-screen` exists;
  - locked = `document.pointerLockElement === #gl`;
  - HUD visible = `!#hudtop.hidden` (also hidden during menus);
  - locale = `document.documentElement.lang`.
  - Controls screen = `#screen.on .keylist` exists (a pending rebind has no sign of its own, §2).
  - blueprint mode = **no DOM sign**. `active()` is exported from `blueprint-ui.js`, but that module imports menus.js, so import it only after the DOM exists (§8, gotcha 1).
- **Capturing `S`:** since f6b38f505d the direct way is `(await import('/js/menus.js')).kit().G?.S`, after the DOM exists (§8, gotcha 1), `null`-safe because `G` is `null` before `initMenus`. Read-only, and detect it; game-core.md §9. Not yet verified live. The older way below was verified with `npm run probe` on build d7bde3deb9; no script used it then.
  - Wrap `ChatToggle.prototype.update` (`chat-toggle.js:69`, called every frame, title screen included) and read `this.state`.
  - It is `S` (`main.js:270`), so `menuName`, `chatOpen`, `showHud`, `input`, `started`, `resuming`, `debug` (F3), `view`, `tab`, `fps` and `synced` become readable.
  - In survival, `SurvivalClient` instances also carry `.S`.
- **Adding a keybind:**
  1. Use `addEventListener('keydown', fn, true)` on `window` at document-start. It runs before the game's bubble listener.
  2. Bail out on any of these:
     - `e.repeat` (for toggles);
     - `e.isComposing || e.keyCode === 229` (IME);
     - `e.__tc`, `e.__tcCaptured` or `window.__tcOptions?.capturing`;
     - typing;
     - `#screen.on` (unless the screen is yours);
     - `#inv` visible;
     - chat open;
     - an editor overlay present;
     - `.keylist` under `#screen.on`, if the key can act while a screen is up: a document-start capture listener runs **before** the Controls screen's own, so it sees the key the user is trying to bind.
  3. Prefer an unbound code, and check `bound(code)` from `/js/keys.js` (§7) rather than the table above. To take over a game key, call `preventDefault()` and `stopImmediatePropagation()` in the capture phase. The game never checks `isTrusted`, so synthetic `KeyboardEvent`s dispatched on `window` trigger game actions. Better Options relies on this for its Hide HUD toggle, sending whatever `hideHud` is bound to.
  4. Register with `window.__tcOptions.registerKeybind({id, label, get, set, reset})` so the key appears in Better Options' Keybinds tab. Game keys themselves belong to the game's Controls screen since f6b38f505d.

## 6. Toasts, notes, chat

- **`ui.note(text)`** `ui.js:623` sets the text of `#note` and adds `.show` for 1800 ms (one shared timer, `note.t`).
  - It's exported, and it's the right toast for scripts.
  - Style: fixed top-center, `rgba(0,0,0,.8)`, `1px #555` border (`style.css:1064`).
  - It is DOM text in the Tweetcraft webfont, not the canvas font.
- **Canvas-only feedback** (main.js, not exported):
  - `toast(text, ms=2500)` `:1639` sets `S.toast`, drawn above the hotbar.
  - `flashHint(text, ms=4000)` `:1642` sets `S.flash`, drawn as the hint box.
  - `showAdvancement` `:1681`.
  - With `S` captured you can set `S.toast={text, until}` yourself, with `until` on the `performance.now()` clock (`main.js:1640`; `render` reads it at `:1046-1047`).
  - In survival, `SurvivalClient.o.chat(text, color)` and `o.flashHint(text, ms)` are reachable (`main.js:1955-1956`).
- **Chat log.** `chatLine(text, color, nameStyle, whisper)` `:1625` pushes `{text,color,nameStyle,at}` (+ `whisper, italic`) onto `S.chat` (max 60 entries) and **now returns the line object**.
  - `visibleChat` `chat-whisper.js:22` shows up to 10 lines (20 while chat is open, only 3 whispers when hidden), fading out between 9 and 10 s.
    - With `translate` on, a line that has `tr` shows `tr.text` (translation + `[FROM]` tag) instead.
    - While chat is open it also shows a grey `#8a8a8a` "Original: …" line above it.
  - `Hud.draw` wraps lines with `wrapChat` `chat-style.js:53` and colors them with `chatRuns` `:30`. `nameStyle` is `{start,end,color}` or `{spans:[[s,e,color|"rainbow"]]}`.
  - Incoming chat is handled at `main.js:2098-2137`. Non-blocked lines from others are offered to `translator.offer(line, m)` (`ChatTranslator`, chat-translate.js), which may set `line.tr` asynchronously. That needs Translate chat on, or the world's Translate-all flag.
  - Join/leave/achievement/system lines are localised (`T("chat.joined")`, `srvText(m)`…).
- **Chat input.** `openChat(prefix)` `:3218` calls `releaseInput()`, then unhides and focuses `#chatbox` (`maxlength` 256 = `CHAT_MAX`). `closeChat` resets the composition state. `chatInput()` `:2514` passes the caret, the selection and the IME range `comp` to `Hud.chatField`. `sendChat` `:3242` handles:
  - `/hide`, which toggles `S.chatHidden`.
  - whispers (`parseWhisper` `chat-whisper.js:4`).
  - pending echoes (`createPending` `chat-pending.js:42`: nonce, 10 s timeout, "not sent: reason").
  - In creative, `/commands` are dropped locally.
- **`ChatSuggest`** `chat-suggest.js:38`: command lists (`COMMANDS`/`OP`/`MOD`/`BOSS`), `key(e)`, `view()` → popup data (`ROWS=10`). `ChatToggle` `chat-toggle.js:24` is the `#chat-toggle` "Hide"/"Reveal chat" button. `chatLogVisible` `:6` keeps the log visible under `inv`, `sinv` and `death`.
- **Other chat modules.**
  - `ChatBubbles` `chat-bubbles.js:37`: 3D speech bubbles textured by gfx (6 s).
  - `promotionNotice` `chat-notice.js:2`: the "Self-promotion blocked" dialog.
  - `bindSponsorTooltip(node, () => lines, () => when)` `sponsor-tooltip.js:70` / `hideSponsorTooltip` `:12`: a reusable pixel-font tooltip (`#sponsor-tooltip`), skipped for touch and while pointer-locked.

## 7. Extension points for userscripts

| goal | hook | risks |
|---|---|---|
| New screen or tab UI | Wait for DOMContentLoaded, then `M = await import('/js/menus.js')` (the same module instance as the game's; `M.openOptions()` was verified from a probe on build d7bde3deb9). Call `M.showScreen('myname', build, 'dim')`; re-render with `M.refresh('myname')`; leave with `M.back()` (→ pause in a world, title screen on the title page). Mark it with a hidden element (Better Options: `.tc-marker`), since `S.menuName` can't be read without capturing `S` (§5) | `build` runs again on every refresh, so keep state outside it. Escape → `back()`. Use a name the game doesn't use. The game calls a bare `M.refresh()` on locale changes and `u` changes, which rebuilds your screen too |
| **Localised labels (new)** | `const I = await import('/js/i18n.js')`. Use `I.t(key, vars)` for game strings (keys are in `pretty/js/lang/en.js`, e.g. `pause.options`, `pause.distance`, `options.fov`, `menu.done`, `menu.back`), `I.tOr(key, english)` for your own, and `I.locale()`/`I.localeInfo()`. Re-render with `I.onLocaleChange(fn)` (returns an unsubscribe function; fires after the game's own refresh) | Don't call `setLocale` (the user's choice). Listeners fire asynchronously, after a fetch. A key you invent that the game lacks returns the key itself from `t()`, so use `tOr` |
| **Menu building blocks (new)** | `M.kit()` returns the private helpers `{btn, title, P, row, field, showScreen, back}`, which is how `blueprint-ui.js` builds its screen, and since f6b38f505d also `G` and `text(s, color)` (a label canvas, optionally coloured), as `controls.js` uses them | New in c25d4c024d, so detect it before use, and detect `G` and `text` separately. A mod could drop its own copies of these, but only with a fallback for builds without `kit` |
| Confirm dialog | `M.showMessage(title, text, [[label, fn], ...])` | It's the shared `msg` screen; Back → `back()` |
| Add a button to the pause menu | A `MutationObserver` (`childList`) on `#screen > .inner`. When `button[aria-label="${t('pause.options')}"]` is present and yours isn't, insert a `ui.button(...)` after it | The game re-renders often, so re-insert every time. Build the aria-label with `t()`: in `en` it is `Options…` (U+2026). The title has the same button since c25d4c024d, so also test `#screen.dim`. Add a compat test |
| Redirect a game button | A capture-phase `click` listener on `window` matching `button[aria-label="..."]`, then `preventDefault` + `stopImmediatePropagation` (Better Options `onDocClick`) | aria-label text is localised; build it with `t()`. `…` vs `...` |
| Drive a game setting | Open its screen, grab the control by `data-k` (`fov` on `options`, `vol-<cat>` on `sounds`, through the exported `M.openSounds()`), set its value and dispatch `input`. The detached FOV input keeps its closure over `G.S`. Or `.click()` a cycle button (`Distance:`, matched via `t("pause.distance",{n})`). Then restore with `showScreen`/`closeMenu` | Flicker. `showScreen` releases pointer lock, so re-lock afterwards. `.fov-control` matches every slider |
| Canvas HUD element | Wrap `Hud.prototype.draw`: call the original, then if `o.show`, draw on `this.x` with `this.font.draw(ctx, t, x, y, o.gs, color)`, placed relative to `this.rect`/`this.chatLayout`. For survival-only elements, wrap `SurvivalClient.prototype.drawHud(hud, font, gs)` | Hot path: no allocations or logging. Mark wrappers (`__tcScaled`-style) so they never double-wrap; chain behind Better Options' wrappers. Non-Latin text draws `?` until its glyph page loads (`font.whenReady`) |
| DOM HUD widget | A fixed element on `body` at z 3–4 with `pointer-events:none` (auto on controls); hide it when `#hudtop.hidden` or `#screen.on`. Or append a `ui.hudButton` to `#hudright` | `buildTop()` wipes `#hudleft`/`#hudright`, now also on every locale change |
| Keybind | §5 recipe plus `__tcOptions.registerKeybind` | Conflicts with editors and future game keys; skip IME composition; stand down on the Controls screen |
| **Read or change game binds (new in f6b38f505d)** | `const K = await import('/js/keys.js')`: no DOM side effects, safe at any time. `K.codeOf(id)`, `K.is(code, id)`, `K.bound(code)`, `K.keyName(code, T)`; `K.set(id, code)` and `K.reset(id)` save to `mc.keys` and apply at once. Open the screen with `(await import('/js/controls.js')).openControls()`, after the DOM exists | Absent on older builds, so fall back when the import fails. `set` doesn't check for clashes. Bind ids are game names and can change: add them to `compat/expectations.mjs` |
| Toast / tooltip / sound | `ui.note`, `bindSponsorTooltip`, `sound.playClick` | `#note` is shared with the game (1.8 s) |
| UI scale | Override `--u`/`--d` and redraw the `button.mcb` label canvases (Better Options `applyUiScale` + `redrawButtonLabels`) | The game resets the variables on every resize, now one frame after the event (see §8). Game label canvases may repaint themselves when glyphs load |

## 8. Gotchas

1. **Import order.** `menus.js` caches `#screen` and `.inner` when the module is evaluated (`M:19`). Importing it before the DOM exists binds `null` and breaks every menu. Always wait for DOMContentLoaded first.
2. **Screens are rebuilt constantly.** Any `refresh()` replaces all of `.inner`, and DOM you injected into a game screen disappears; handlers are recreated. Refreshes come from:
   - resizes that change `u`;
   - locale changes (`main.js:1620`);
   - network events: `M.refresh("pause","players","owner","verify","achievements","options")` at `main.js:1250,1654,2011,2149,2156,2162,2171,2343,2355`;
   - the music manifest finishing loading (`:325`, about 3 s after boot);
   - render-distance and fullscreen changes (`:3278,3287`);
   - every toggle press.
3. **Labels are bitmaps drawn at `fpx()` from `UI.u`, not from CSS `--u`.** Overriding `--u` resizes the boxes but leaves the labels at the old pixel size. A `.mcb` has no `textContent`; read its `aria-label` (localised). A label canvas can also repaint itself after creation when a glyph page loads (`whenReady`).
4. **`--u`/`--d`/`--hp`/`--hb` are rewritten inline on every resize** (`main.js:535-538`). Since c111547912 that happens at the start of the next animation frame after the `resize`/`fullscreenchange`/`visualViewport` event, not inside the event, so a `setTimeout(…, 0)` re-apply can run *before* the game's rewrite. Overrides have to be re-applied (Better Options polls every 250 ms). A stylesheet `:root{--u:…!important}` beats the inline value (an `!important` author rule outranks a normal inline declaration).
5. **`#inv` (z7) sits above `#screen` (z5).** `showScreen` closes only the creative inventory, not survival containers (`sinv`). Don't open screens while `#inv` is visible.
6. **`closeMenu()` doesn't resume play.** Nothing re-locks the pointer or focuses `#gl`; the player has to click. In lock mode, a canvas mousedown re-locks.
7. **Exiting pointer lock yourself** (`document.exitPointerLock()`) while no game menu is open makes `onLockChange` open the pause menu.
8. `back()` reloads the page when `S.closed` (disconnected / moved-to-another-tab dialogs).
9. **Escape inside your screen calls `back()`, even from a focused input.** To handle Escape yourself, catch it in the capture phase and call `stopImmediatePropagation`.
10. **Touch and mobile.** `--u` is at least 2, so menus are larger. `#hudtop` buttons have no keycaps, and `openCreate` doesn't autofocus. There's no hover, so `.hi` labels show only on `:focus-visible`. Touch buttons are placed using `--hb`; `UI.pad` lifts the hotbar by 6 GUI px and `#chatbox` is `24*gs` taller. Survival hides `#t-hit`/`#t-use`/`#t-drop` and the Inventory button while spectating (`survival/touch.js:147`).
11. **Framed and card pages.** `FRAMED` (an iframe in an 𝕏 post) has no pointer lock, and Create/Sponsor open new tabs. A `?card` page shows only the `card` screen. On the title page (no room), `openPause()` does nothing (it requires `S.started`), but since c25d4c024d the title has its own Options button, so a mod that takes over `Options…` also opens there. F1 does nothing on the title (step 9 of `onKeyDown`) and the Distance button doesn't exist there, so mod rows that depend on them need a no-world case.
12. **`mc.fov` outside 30–110 resets to 70 on the next load** (`main.js:210-213`). A mod that writes `mc.fov` below 30 (Better Options' `setFov` allowed 2–110 on build d7bde3deb9) loses the value on reload. Temporary (zoom) FOVs must not be persisted.
13. **`Hud.draw` clears `#hud` every frame**, so anything drawn outside the wrapped chain is wiped. `hud.suggestions` and the survival HUD draw after `Hud.draw`; the tab list is drawn before the survival bars.
14. **Use integer scales on `#hud`.** `Font.draw` with a fractional scale smears the glyphs (Better Options rounds `gs`).
15. **Editor overlays aren't `#screen`.** The sign, book and chest-label editors (and the end credits) swallow game keys through their `key()` hooks, and the skin editor stops propagation in its own capture listener. A document-start capture listener still sees those keys first, so check for the overlays (and for `#anvil-name` focus).
16. **Labels can be longer than in English.** `.third`/`.small` buttons now auto-size; fixed-width injected buttons may clip translated text.
17. **The game may reallocate `#hud`** (`regainCanvases`, game-core.md §4; since 6b3963e444 not `#inv` or `#gl`). Setting a canvas's `width` clears it and resets its 2D context state. `Hud.draw` redraws every frame anyway, but a mod that caches anything on those canvases (or on the font's atlas, which is reset too) must redraw it.
18. **Keys the game took in c25d4c024d.** F, R and X now act in survival worlds, and C, K, R and Escape are claimed in blueprint mode. A mod bound to one of them fires alongside the game's action, except that a capture-phase mod listener can stop it first. Blueprint mode can't be seen in the DOM, so a mod can't step aside for it without importing `blueprint-ui.js`. Since f6b38f505d all of these are defaults: the user can move any game action onto any key or mouse button, including one a mod uses.
