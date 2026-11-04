# Game UI codemap: screens, CSS, HUD, input

Verified against game build 6b3963e444 on 2026-11-04 (re-verified from 575c9209bc, itself from 325afb04b5, c111547912 and d7bde3deb9, which had the same game code as b4bc035ec8 and 26479914e5). 6b3963e444 changed main.js, menus.js, inventory.js and `survival/*`; style.css, index.html, ui.js and i18n.js are byte-identical to 575c9209bc's. Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build 6b3963e444's `pretty/`, moved from 575c9209bc with a line diff of the two snapshots.
- `M` = `menus.js`.
- `S` = the game state object (`main.js:204`).
- `G` = the host object main.js gives menus.js (`main.js:3132`, via `initMenus`).
- Neither `S` nor `G` is global. `window.__mc` exists only on DEV hosts (`main.js:3296`).

**Since c111547912 every label is localised.** Menus, HUD buttons, dialogs and canvas text use `T(key)` from `js/i18n.js` (13 locales, chosen by `mc.lang` or the browser). The English strings are the same as before, so English selectors still match in `en` but not in other locales. See §7 and game-core.md §9.

## 1. Overview: DOM layers (`pretty/index.html`, z-index from `pretty/style.css`)

- `#gl` is the WebGL2 world canvas: z auto, `tabindex=0`, the pointer-lock target. It gets `.pix` (pixelated) while the claim/verify/pending screens are up (`main.js:492,518`).
- `#hud` is a 2D canvas, z1, `pointer-events:none`. The whole in-game HUD is canvas-drawn here every frame: hotbar, chat log and chat field, nametags, F3, hints, tab list, survival bars.
- `#cross` crosshair `<img>` z2 · `#touch` (stick, jump, sneak) z3 · `#hudtop` (`#hudleft`/`#hudright` DOM buttons) z4 · `#chat-toggle` and `aside#world-sponsors` z4 (z6 with `.pause-visible`), both created by JS.
- `#screen > .inner` z5 holds every menu. Menus are DOM elements, but their titles and button labels are pre-rendered `<canvas>`es, not text.
- `#chatbox` z6 and `#invsearch` z8 are invisible `<input>`s laid over canvas-drawn fields. `#chatbox` is now `maxlength=256` (`CHAT_MAX`, chat-pending.js:5; was 120). `#inv` z7 is the canvas for the creative inventory and for survival containers.
- `#adv` advancement toast canvas z9 (created on demand) · `#note` DOM toast z10 · `#load` loading canvas z11 · `#fatal` z12.
  - `#load` is shrunk to 1×1 backing pixels while hidden (`resize`, main.js:502-510; since 325afb04b5 also right away in `hideLoad`, main.js:459, and `frameBody` resizes when a shown `#load` is still 1×1).
  - `.off` and `[hidden]` both mean `display:none!important` (`style.css:18,21`).
- Overlays appended to `<body>`:
  - `.se` skin editor z4500, `.sp` z4600, `#sign-editor`, `#book-screen`;
  - `#anvil-name` (new: the survival anvil's fixed rename `<input>`, z1002, `survival/anvil.js:50-56`);
  - the turnstile overlay z5000 (`M:218`), `#sponsor-tooltip` z10000.

## 2. Screen system (`pretty/js/menus.js`)

**Core API (exported):**
- `showScreen(name, build, look)` `M:128`.
  - `name` becomes `S.menuName`.
  - `build` is `() => Array<Node|null|false>` (falsy items are dropped). It is stored as `S.menu` and called again on every refresh.
  - `look` is a class string appended after `on` on `#screen` (`className` = `"on"`, plus `" " + look` when given).
  - Side effects: stops sponsor previews; closes the creative inventory (`G.closeInv`, unless `name==='inv'`); `.inner.replaceChildren(...)`; `scrollTop=0`; `G.releaseInput()` (clears held keys, mouse and stick, and exits pointer lock); `G.updateTop()` (hides `#hudtop` and `#touch`).
- `refresh(...names)` `M:141`: calls `S.menu()` again and replaces `.inner`'s children.
  - No-op when there is no menu, when `menuName==='inv'`, or when `names` is given and doesn't include the current screen.
  - Keeps `#screen.scrollTop`, the `.servers` list scroll, and the focus and selection of the focused element, matched by its `data-k`.
- `closeMenu()` `M:163`: clears `S.menu`/`S.menuName`, sets `#screen.className=""`, empties `.inner`, runs `updateTop`. It does **not** re-lock the pointer or focus `#gl`. `resume()` (`main.js:2917`, not exported) does both.
- `back()` `M:233`: there is **no screen stack**, unchanged in c111547912. It's a hard-coded chain:
  1. `S.closed` → `location.reload()`
  2. claim/pending → stay put
  3. sponsor (opened from mine) or mineedit → mine
  4. sponsor, sponsored or mine → `openServers`
  5. title page → `showTitle`
  6. verify, owner or create opened from the game → `G.resume`
  7. started → `openPause`
  8. otherwise → `closeMenu`

  An unknown (custom) name lands on step 7, `openPause()`, in a world, and on step 5, `showTitle()`, on the title page. So Options' Done (`back`) returns to the pause menu.
- `showMessage(title, text, buttons=[[T("menu.back"), back]])` `M:185`: a generic dialog (name `msg`, look `dim`). Each button is `[label, fn | url-string (rendered as <a target=_blank>) | {at, run} retry]`.
- Escape while any screen is open (`main.js:2560`): `pause` → `resume()`, otherwise `M.back()`. Ignored when `S.closed`, on a card, and on `title`/`death`.
- The `look` values in use: `dim` = `rgba(16,16,16,.62)` (`style.css:86`); `blur` = `.4` black + `backdrop-filter:blur(5px)` (`:92`); `title`; `card`; `death` (style injected as `#deathcss`); `endcredits`; `blur servers-menu`.

**All screens** (name · opener · look · contents):

| name | opener | look | contents |
|---|---|---|---|
| `title` | `showTitle(text?)` `M:251` | title | logo and splash (`title.splash1-6`); Multiplayer, Create New World, Skins & VIP ("Skins & Royal" on Sojo), blurb, Discord. No Options or Language button |
| `servers` | `openServers(note?, retry?)` `M:302` | blur servers-menu | search `[data-k=sq]`, Sort:/Show: cycle buttons (`wide`), a `.servers` list of `.srow`, Join/Create/Refresh/Sponsor/Back |
| `sponsor` | `openSponsor(placement?, from?)` `M:720` | blur | sponsor checkout form (`spt spd spl spb spemail spworld`). Opens a new tab when started or framed |
| `sponsored` | `openSponsored(session)` `M:1324` | blur | payment confirmation |
| `mine` / `mineedit` | `openMine(path)` `M:1419`, `openEditMine` `M:1539` | blur | manage a sponsor listing (`set sed sel`) |
| `create` | `openCreate(fromGame?)` `M:1678` | blur | name `[data-k=wn]`, Game Mode, Who can build (creative) or PvP + Keep Inventory (survival), Whitelist, Listed in server list |
| `options` | `openOptions()` `M:1792` | dim | In order: title, label "Field of View", the FOV control `div.fov-control > input[type=range][data-k=fov]` (30–110, aria-label `T("options.fov")`) (`M:1796`), Held light, **the Music slider** (`div.fov-control > input[type=range][data-k=music]`, 0–100, only when `G.music.has`, `M:1840-1865`), Show my country, **Auto-refill** (`mc.refill`, new in 6b3963e444), **Translate chat**, **Language** (cycles `LOCALES`, or uses the Sojo picker), Done. Details below the table |
| `pause` | `openPause()` `M:1890` | dim | "Game Menu". Details below the table |
| `achievements` | `openAchievements` `M:1944` (private) | dim | `.achlist` of `.ach[.on]` |
| `players` | `openPlayers` `M:1984` (private) | dim | `.row.p` rows: face canvas, `.who`, country mark |
| `verify` | `openVerify(fromGame)` `M:2034` | dim | post on 𝕏, paste link `[data-k=pv]` |
| `claim` / `pending` | `openClaim` `M:2061` / `openPending` `M:2076` | dim | publish the world / wait for verification (back is blocked) |
| `owner` | `openOwner(fromGame)` `M:2256` | dim | Owner/Admin tools: rename `[rn]`, lock, kick/ban, roles (`wladd`, `opadd`), on/off rule pairs (PvP, Keep Inventory, TNT, grass growth, tree capitator, vein mining, whitelist) and leaf-decay options, **Music** on/off (`/music`), **Translate all chat** (`/translate on|off`, `M:2541`), undo builders, Reset world |
| `msg` | `showMessage` `M:185` | dim | dialogs: reset confirm (`confirmReset` `M:2736`), disconnected, voice, playing in another tab |
| `card` | `main.js:798` | card | logo only (`?card` preview) |
| `wardrobe` | `wardrobe.js:780` | dim | Skins & VIP |
| `death` | `survival/player.js:466` | death | You died!/Game over!, score, Respawn, Title screen (disabled for the first 1 s) |
| `credits` | `survival/end.js:113` | endcredits | End credits (all keys swallowed, `end.js:205`) |
| `spawn-onboarding` | `survival/onboarding.js:68` | dim | "Spawn is protected", buttons with `[data-spawn-action]` |
| `inv` / `sinv` | `main.js:3024` / `:3033` | — | pseudo-menus with `S.menu = () => []`, shown while the `#inv` canvas is open. `#screen` does not get `.on`. The survival anvil is a `sinv` container window plus `#anvil-name` |

**Options details** (`M:1792-1888`):
- `.fov-control` is **no longer unique**: the music slider reuses it. Select the FOV slider by `[data-k=fov]`, and music by `[data-k=music]`.
- The FOV `input` handler writes `mc.fov` (`M:1808`).
- The music slider calls `G.music.setVolume(v/100)`, which writes `mc.musicVol`.
- Translate chat calls `G.translator.setOn(!on)`, which writes `translateChat`.
- Language calls `chooseLanguage()` (lang-select.js:38), then `refresh("options")`. Without Sojo it steps to the next `LOCALES` entry and writes `mc.lang`.
- The game refreshes `options` itself on `room` messages (`main.js:2068`) and once the music manifest has loaded (`onChange`, `main.js:338`; that is also when the Music slider first appears).

The pause screen's buttons, in order:
1. Back to Game.
2. Share world or Save your progress.
3. Players: N (plus Achievements in survival).
4. Skins.
5. Claim here (new in 6b3963e444; sends `/claim`).
6. `Options…`.
7. `Distance: N`, with Fullscreen beside it when available.
8. A status line.
9. Return to Title Screen.
10. Log out (signed in, not Sojo).
11. `.corners`, holding the Discord link and the VIP link (hidden for VIPs).

These are now `T("pause.backToGame")`, `T("pause.options")`, `T("pause.distance",{n})`, `T("pause.full")`/`T("pause.exitFull")` and so on; the English text is unchanged.

Other exports: `turnstileCheck`, `rolesNote`, `onRoles`, `onRenamed`, `onUndoBanResult`, `onUndoBuilders`, `onUndoPreview`, `onUndoResult`, `confirmUndoPreview`, `cancelUndoPreview`, `initMenus`.

**Building blocks** (menus.js helpers are private; ui.js helpers are exported):
- `fpx()` `M:20` = `max(1, round(G.UI.u * devicePixelRatio))`: device px per GUI px for label canvases.
- `btn(text, fn, size, disabled)` `M:21` wraps `ui.button(G.font, fpx(), ...)`.
  - `size` is one of `half wide third small pvp keepinv`. These are just CSS width classes; `third` and `small` now size to their label (§3).
  - **Toggles and cycles** are plain btns whose label reads `"Label: ON"` (create, `T("create.on")`) or `"Label: On"` (options, `T("options.on")`). The handler flips the state and calls `refresh(name)` (e.g. `M:1714`, `M:1825`). There is no toggle widget. Owner rule pairs (`sw()`) are two `half` btns, with `"> "` prefixed to the active one.
- Helpers:
  - `title(text)` `M:26` → `canvas.mct`.
  - `label(text)` `M:31` → `canvas.lbl` (`#a0a0a0`).
  - `P(text, cls)` `M:36` → `p.desc[.small|.err|.code]`, with 𝕏 wrapped in `<b>`.
  - `row` `M:44` → `div.row`; `prow` `M:45` → `div.row.p`; `rbo(b)` `M:22` adds the rainbow border `.rbo`.
- `field(k, value, props)` `M:118` → `input.link[data-k=k]`. The `data-k` is what lets `refresh()` restore focus.
- **Sliders:** there are two, both `div.fov-control > input[type=range] + div.fov-caption`: FOV (`M:1796`) and Music (`M:1840-1865`). On `input`, the caption div's canvas is replaced with a freshly drawn one, and `aria-valuetext` is set.
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

**Game settings in localStorage** (written through main.js `store`, `main.js:146`; `set(k, null)` removes the key):

| key | where | meaning |
|---|---|---|
| `mc.fov` | `main.js:226-229`, `M:1808` | base FOV. The loader only accepts 30–110, anything else becomes 70 |
| `mc.rd` | `main.js:251`, `:3095` | render distance ∈ `RDS=[4,6,8,10,12]` (`view.js:1`), default 8 (6 on touch) |
| `mc.heldLight` | `main.js:224`, `M:1824` | `"0"` turns off held-item light |
| `mc.refill` | `M:1833-1838`, `survival/player.js:126` | **new in 6b3963e444.** `"0"` turns off hotbar refill (the "Auto-refill" button) |
| `mc.showCountry` | `country.js:2`, `M:1829` | `"0"`/`"1"`, share your country flag |
| `mc.lang` | `i18n.js:20` (`LANG_KEY`), `lang-select.js:15,46` | **new.** Locale code (en, es, pt-BR, de, fr, it, nl, id, ja, ko, zh-Hans, zh-Hant, ru). Ignored on Sojo pages |
| `mc.musicVol` | `music.js:3` | **new.** Music volume 0–1 (default 0.5) |
| `translateChat` | `chat-translate.js:3` | **new, no `mc.` prefix.** `"1"`/`"0"` = your Translate chat choice; absent = follow the world's setting |
| `mc.hotbar` | `state.js:6,17` | creative hotbar as JSON (9 ids) |
| `mc.sid` / `mc.tok` / `mc.bridged` | `main.js:186,188`, `identity.js:25-26` | session id / login token JSON / token already bridged to a cookie |
| `mc.key.<room>` / `mc.admin` / `mc.nonce` | `main.js:189,196`, `M:2024` | owner key per world (also drives the "My worlds" filter, `M:532`) / admin key / verify nonce |
| `mc.recent` | `recent.js:1` | recently played worlds |
| `mc.voiceOff` / `mc.voiceNotice` | `main.js:1829,3250` | voice opt-out / voice notice seen |
| `mc.cos` / `mc.wardrobe` | `wardrobe.js:81,84` | cosmetics ticket cache / has a wardrobe |
| `mc.adseen` | `sojo-ads.js:132` | ad impressions, kept 2 h |

New in 325afb04b5, in **sessionStorage**: `mc.glreload` (main.js:2651-2654), the time of the last automatic reload after a lost WebGL context (at most one per 60 s).

## 3. Styling system (`pretty/style.css`, `main.js` `resize()`)

- **CSS variables.** Defaults are in `:root` `style.css:6` (`--u:2px --d:1.5px --hp:1px --hb:44px`). `resize()` `main.js:494` sets all four on `documentElement.style` (`:531-534`). It runs:
  - at boot;
  - **deferred to the start of the next frame** after a window `resize`, a `fullscreenchange` (again 300 ms later) or a `visualViewport` resize. The listeners only call `wantResize()` (`main.js:553-556`; listeners at `:2639` and `:2662-2666`), and `frameBody()` runs `if (resize()) M.refresh()` first thing (`:599-601`);
  - also deferred (new in 325afb04b5) after `regainCanvases()` and after a 2D canvas's `contextrestored` (game-core.md §4);
  - when `#inv` shows or hides (`invStale`, new in 6b3963e444, `main.js:491`): `#inv` is sized like `#hud` only while it's shown and is 1×1 while it has `.off`. `frameBody` checks it at the top and again before `inv.draw` (`:598`, `:642`). `openInventory` sizes the inventory from `hudCanvas`, because `#inv` can still be 1×1 at that moment;
  - on every `setInput()` (`:2272`);
  - when a pixelated menu opens or closes (`:652`).
- With `full=devicePixelRatio` and `dpr=backingDpr(full, innerWidth, innerHeight)` (`frameloop.js:24`: `min(full,2)`, lowered so the backing store stays ≤ 3840×2160):
  - `--u` = `max(1, round(raw*full))/full` px, where `raw = max(TOUCH?2:1, min(3, innerWidth/280, innerHeight/190))`. This is CSS px per GUI px, snapped to device pixels. It is also `G.UI.u`.
  - `--d` = `max(1, round(u*full)−1)/full` px, one device px smaller. Used for `.desc` body text.
  - `--hp` = `hpx/full` px, where `hpx = max(TOUCH?2:1, round((TOUCH?1.75:1.25)*full))`. Sizes the `#hudtop` buttons.
  - `--hb` = `(22*gs + pad)/dpr` px: the hotbar height. Positions the touch buttons.
- When `u` changes, `resize()` returns true and `frameBody()` calls `M.refresh()` (`main.js:600`), which re-renders the label canvases. A change of `hpx` triggers `buildTop()` instead.
- **HUD scale is separate from `--u`.** `UI.gs = clamp(floor(min(w/320, h/240)), 1, 6)` on device px (`main.js:521`). Example: 1920×1080 at 1×: `gs=4`, `u=3`.
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
  - Widths: `.half` 98, `.wide` 148. **Changed in c111547912:** `.third` is `width:auto; min-width:64u; max-width:30vw; padding:0 4u`, and `.small` is `width:auto; min-width:60u; max-width:46vw; padding:0 4u` (`:324-335`), so they grow with longer translated labels. `.hb` `:770` is auto width × 18 `--hp`. `#hudleft.stack` (`:763`) stacks the left HUD buttons when they would overlap the right ones (`fitTop`, `main.js:2283`).
- **Other assets:**
  - `/assets/gui/`: `hotbar.png`, `hotbar_selection.png`, `crosshair.png`, `toast.png`, `inv/*`, `panel/*`, `container/*`.
  - `/assets/atlas/gui.json` + `gui.webp`: survival sprites.
  - `/assets/title/tweetcraft_edition.png`, `/assets/misc/discord.png`, `/assets/block/dirt.png` (loading and fatal backdrop).
- **Key classes:**
  - `.inner`: column flex, gap `4u`, padding `10u 6u` (`:101`).
  - `.row` / `.row.wrap`: flex rows, gap `4u` (`:215`). `.row.p` is 200u wide, for a field plus a button (`:347`).
  - `.desc` (`:188`): `8*--d`, `#a0a0a0`, max 230u. Variants `.small` `#808080`, `.err` `#ff5555`, `.code` `#ffff55`.
  - `.link` input (`:411`): black, `1px #a0a0a0` border, font `8*--u`.
  - `.mct` / `.lbl`: pixelated canvases. `.who`/`.face`: player rows. `.servers`/`.srow`: lists. `.fov-control` (`:227`): range input styled with a button thumb (now used by the FOV and Music sliders).
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
  5. Call `playClick()` (`sound.js:111`) on click.
  6. Localise labels with `t()` and re-render them in `onLocaleChange` (§7).

## 4. HUD (canvas, `pretty/js/ui.js` `Hud`, `survival/*`)

- **Per-frame order.** `frame()` `main.js:587` → `frameBody()` `:597` → `render()` `:823` → `gfx.draw` → `hud.draw(o)` `:1003` → `survival.drawHud(hud, font, UI.gs)` `:1031` (only when `show`) → `drawUndoPreview` `:1032` → `hud.suggestions(UI.gs)` `:1033` → `chatToggle.update(...)` `:1034`. After `render()`, `music.update`, `inv.draw` / `survival.screens.draw()` paint the `#inv` canvas, then `updateAdvancement`.
- `Hud.draw` **runs every frame, title screen included, and clears the canvas first.** It returns right after clearing when `!o.show`, where `show = S.started && S.showHud && !CARD` (`:873`).
- **`gs` / `s`** is device px per GUI px on `#hud`, whose size is `innerWidth×innerHeight×dpr` (the `backingDpr` above).
- **The `Hud` instance** (`ui.js:633`) is constructed at `main.js:393`.
  - Properties: `c` (canvas), `x` (2D context), `font`, `sp` (`{hotbar, sel}` images), `icons`, `rect`, `chatLayout`, `suggest`, `suggestRect`, `chatFirst`.
  - `icons` is a `SurvivalIcons` from `main.js:388`, whose `decorate()` draws stack counts. Survival swaps in its own at `survival/client.js:65`.
- **`draw(o)` `ui.js:642`** reads these fields of `o`:

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
  - Then `chatField`, debug lines (top-left, from `2s + debugY`, ui.js:733-734), `hint`, `tab`.
- **F3 debug** (`debugLines`, main.js:1126; drawn only while `S.debug`). The lines, in order:
  1. `Tweetcraft (<host>)`;
  2. `N fps, N chunks, N particles`;
  3. `Display: WxH at N.NNx[, fullscreen]` (`#gl`'s backing size and `UI.dpr`);
  4. **new in 325afb04b5:** `GPU: <renderer>[ (SOFTWARE)]`, from `gpuName()` (gpuwatch.js:3), which shortens ANGLE strings to "device, API". "(SOFTWARE)" means it matched `SOFTWARE` (SwiftShader, llvmpipe, Microsoft Basic Render…);
  5. **new:** `Frame: x ms, JS y ms, usual N fps, regained R, lost L[, still slow: reload]`. That is the mean rAF interval, the mean JS time in the frame callback, the slow-frame watchdog's baseline ("?" until it has 8 samples), canvas reallocations and lost contexts (game-core.md §4);
  6. then `XYZ`, `Block`, `Chunk` and the rest.
  - `debugY` now comes from `debugTop()` (main.js:1120): the bottom of `#hudleft` (when `#hudtop` is shown) or of a visible `#world-sponsors` (+4 px), whichever is lower, in `#hud` pixels. Before 325afb04b5 only `#hudleft` counted.
  - The block takes the top-left of `#hud` from that y down, about 20 lines × 9 GUI px. A mod overlay should sit elsewhere (top-right, say) or hide while F3 is on (`S.debug`, readable once `S` is captured, §5).
- **Methods.**
  - `chatField(o, s, pad)` `:745` draws the chat input at `H−pad−14s` with caret, selection, ghost suggestion and the IME underline.
  - `suggestions(s)` `:811` draws the command popup; `suggestAt(cx, cy)` `:847` maps client px to a popup row.
  - `hint(text, s, above)` `:856` sits below the crosshair at `H/2+20k`, or at `H*.32` when `above`, shrinking `k` until it fits.
  - `tab(t, s)` `:871` is the player list, centered at the top in columns of up to 20.
  - `drawLoading(c, font, dirt, o)` `:927` draws the `#load` screen.
- **Survival.** `SurvivalClient.drawHud(hud, font, gs)` `survival/client.js:338` → `drawCounts` `:521` (stack numbers on the hotbar) → each system's `drawHud`:
  - `PlayerClient.drawHud` `survival/player.js:408` → `SurvivalHud.draw(ctx, font, s, rect, st)` `survival/hud.js:28`.
    - It draws hearts, absorption, armor, food, air, the XP bar and level, and the attack indicator under the crosshair. Positions are relative to `hud.rect`.
    - Atlas sprite names are `hud/heart/*`, `hud/food_*`, `hud/armor_*`, `hud/experience_bar_*`.
    - When `st.cr` (creative-gamemode player, `player.js:446`) is set, the bar sprites and the level number are skipped.
    - `PlayerClient.drawHud` draws nothing while spectating (`st.sp`).
  - `BlocksClient` `blocks.js:93`: sleep fade.
  - `PortalsClient` `portals.js:43`: portal overlay.
  - `EndClient` `end.js:278`: boss bar at the top.

  `SurvivalClient.lift` `client.js:356` is the largest `lift` among its systems (24 from `player.js:55`).
- **DOM HUD parts.**
  - `#cross` gets `.off` toggled every frame (`main.js:1002`): it's hidden when a menu is open, in third person, or with the HUD off. It's sized `15*gs/dpr` in `resize`, with `mix-blend-mode:difference`.
  - `#hudtop`: `buildTop()` `main.js:2292` calls `replaceChildren` on both sides. Labels are `T("hud.*")`/`T("vc.*")`.
    - `#hudleft`: "≡" (aria `T("hud.menu")`, "Menu"), then one of Save your progress [V] (signed out), Owner/Admin tools [O] (owner or op) or Make your own world [M], then the voice buttons.
    - `#hudright`: Play in new tab (framed only), Inventory [E], Chat [T].
    - It is rebuilt at `:424,437,544,1576` (locale change)`,1811,1916,2065,2228,2239`. `updateTop()` `:2277` shows and hides it through the `hidden` attribute, then `fitTop()`.
  - `#adv`: `showAdvancement` `:1638`, a 160×32 GUI px `toast.png` that slides in for 5 s. Long names now wrap to two lines (`wrapText`), and it repaints when glyphs load.

## 5. Input (`pretty/js/main.js`)

- **Listeners** are registered in `bindInput()` `:2615`, called from `boot()` (`:425`) after assets load and before the network connects:
  - `window` keydown/keyup (**bubble phase**); window `blur` → `releaseKeys`; `pointerlockchange` → `onLockChange`.
  - Resizing: `window` `resize`, `document` `fullscreenchange` and `visualViewport` `resize` → `wantResize` (`:2639`, `:2662-2666`).
  - New in 325afb04b5, between those: `contextlost`/`contextrestored` on `#hud`, `#inv` and `#load`, and `webglcontextlost`/`webglcontextrestored` on `#gl`, which reload the page (`:2640-2661`, game-core.md §4).
  - `#gl`: mousedown, pointerdown/move/up, wheel (non-passive), contextmenu.
  - `window`: mouseup, mousemove, pointerup. `#inv`: pointer and wheel. `#stick`, `#t-jump`, `#t-sneak`: pointer handlers.
  - `#chatbox`: pointerdown/mousedown (caret placement), plus `compositionstart/update/end` (`:2674-2690`). During IME composition the input's own text is hidden (`opacity:0`) and the composing range is drawn on the canvas.
  - Others: `ChatSuggest.listen` `chat-suggest.js:169` adds window **capture** pointerdown/mousedown/touchstart/wheel over popup rows. The skin editor adds window **capture** keydown/keyup that call `stopImmediatePropagation` (`skin-editor.js:463-464`). `#chat-toggle` stops key and pointer propagation. `SignsClient` ignores composing keys (`signs.js:115`).
- **`onKeyDown` `:2525`.** The first handler that claims the key returns:
  1. editors: `signs.key`, survival `labels`, `book`, `onboarding`, `end`.
  2. `S.resuming` → ignore the key.
  3. `S.chatOpen`:
     - **while composing (`compose.on || e.isComposing || e.keyCode === 229`, `:2403`) every key is left to the IME** (`:2534`);
     - otherwise `suggest.key` (Tab/Up/Down/Escape); Enter → `sendChat`; Escape → `closeChat`;
     - every other key goes natively to `#chatbox`.
  4. `survival.screens.key` (`screens.js:608`): Escape/E close, 1–9 swap, Q throw.
  5. creative `inv.key` (`inventory.js:225`): Escape/E close, 1–9 assign, a printable key focuses the search box.
  6. Undo preview: C confirms, Escape cancels.
  7. **Any `S.menu`**: F5 `preventDefault`; Escape → resume/back; **everything else is ignored**, so inputs inside screens are safe.
  8. Ignore when not started or when the target is `INPUT`/`TEXTAREA`. In lock mode, a keypress with user activation re-requests the lock.
  9. `PREVENT` `:89` calls `preventDefault` for Space, the arrows, Tab, F1, F3, F5, Slash, Quote, Enter and KeyT.
  10. Tab sets `S.tab` (held). After that, `e.repeat` is ignored.
- **Game keys** (`e.code`, unchanged in 325afb04b5):

  | group | keys |
  |---|---|
  | Movement | W/A/S/D and arrows move (read from `S.keys` in `tick` `:683`); Space jumps, double-tap within 300 ms toggles flying; Shift (L/R) sneaks; double-tap W/Up sprints, as does `ControlLeft` on Mac only (`:692`) |
  | Hotbar | Digit1–9 select a slot, as does the wheel over `#gl`; Q drops (survival; Ctrl drops the stack) |
  | Screens | E inventory; V verify; O owner tools (owner or op only); M new-world tab |
  | Chat, voice | P mutes or enables voice; T or Enter opens chat; `/` opens chat prefilled with `/` |
  | View | Escape pauses (when not pointer-locked); F1 toggles `S.showHud` (+ `updateTop`); F3 debug; F5 cycles `S.view` (0 first person, 1 behind, 2 front); Tab player list while held; C confirms an undo preview |
  | Mouse | LMB attack/break; RMB place/use; MMB pick block; in drag mode, click and drag to look. **New in 325afb04b5:** MMB in the creative inventory picks up a full copy of a stack (`inventory.js`), and for creative-mode players in survival containers it clones the slot (`CLICK_MODE.CLONE`, screens.js:545-548). **New in 575c9209bc:** Ctrl/Cmd + MMB on a chest in creative mode picks a chest item carrying a copy of its contents (tooltip line "+ Contents"); a capture-phase `window` `mousedown` listener in survival/creative.js:51-59 records the modifier and does not `preventDefault` |
  | Touch | stick moves; drag on `#gl` looks; tap breaks or places (creative); survival adds `#t-hit`, `#t-use`, `#t-drop` (`survival/touch.js:33`) |
  | Unbound (grep of every `e.code`/`e.key` check in `js/`, re-checked on 325afb04b5) | B F G H I J K L N R U X Y Z, Digit0, Backquote, F2, F4, F6–F10. Ctrl+Z/Y are used only inside the skin editor. F2 isn't in `PREVENT` either, so the browser default (none in Chrome) applies |
- **Pointer lock and input modes.** `S.input` is one of `none|lock|drag|touch` (`setInput` `:2272`). `spawn()` `:766` picks:
  - `touch` when `TOUCH` (`matchMedia('(pointer: coarse)')` or `?touch`, `:131`);
  - `drag` when framed (inside an 𝕏 post), in tests, or when the lock is refused;
  - `lock` otherwise.
  - `active()` `:2265` = started, no menu or chat, not closed or resuming, and (in lock mode) actually locked. Look (`movementX*SENS`, `:2758`) and the wheel only work while `active()`.
  - Look deltas also pass `lockJump(e)` (`:2503`). It drops the first events after locking, plus single-frame spikes (`createSpikeFilter`, look.js).
  - When the lock is lost (Escape), `onLockChange` `:2469` opens the pause menu, unless a menu or chat is open. A running undo preview is cancelled instead. Clicking `#gl` in lock mode re-requests the lock (`:2711`).
- **Detecting state without `S`:**
  - menu open = `#screen.classList.contains('on')`;
  - inventory or container = `!#inv.classList.contains('off')`;
  - chat = `!#chatbox.hidden`;
  - typing = the active element is `INPUT`/`TEXTAREA`/contentEditable (includes `#anvil-name`);
  - editors = `.se`, `#sign-editor` or `#book-screen` exists;
  - locked = `document.pointerLockElement === #gl`;
  - HUD visible = `!#hudtop.hidden` (also hidden during menus);
  - locale = `document.documentElement.lang`.
- **Capturing `S`:** verified live with `npm run probe` on build d7bde3deb9; no script used it then.
  - Wrap `ChatToggle.prototype.update` (`chat-toggle.js:69`, called every frame, title screen included) and read `this.state`.
  - It is `S` (`main.js:286`), so `menuName`, `chatOpen`, `showHud`, `input`, `started`, `resuming`, `debug` (F3), `view`, `tab`, `fps` and `synced` become readable.
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
     - an editor overlay present.
  3. Prefer an unbound code. To take over a game key, call `preventDefault()` and `stopImmediatePropagation()` in the capture phase. The game never checks `isTrusted`, so synthetic `KeyboardEvent`s dispatched on `window` trigger game actions. Better Options relies on this for its F1 toggle and key remaps.
  4. Register with `window.__tcOptions.registerKeybind({id, label, get, set, reset})` so the key appears in Better Options' Keybinds tab and is excluded from its remapping.

## 6. Toasts, notes, chat

- **`ui.note(text)`** `ui.js:625` sets the text of `#note` and adds `.show` for 1800 ms (one shared timer, `note.t`).
  - It's exported, and it's the right toast for scripts.
  - Style: fixed top-center, `rgba(0,0,0,.8)`, `1px #555` border (`style.css:1062`).
  - It is DOM text in the Tweetcraft webfont, not the canvas font.
- **Canvas-only feedback** (main.js, not exported):
  - `toast(text, ms=2500)` `:1596` sets `S.toast`, drawn above the hotbar.
  - `flashHint(text, ms=4000)` `:1599` sets `S.flash`, drawn as the hint box.
  - `showAdvancement` `:1638`.
  - With `S` captured you can set `S.toast={text, until}` yourself, with `until` on the `performance.now()` clock (`main.js:1597`; `render` reads it at `:1016-1017`).
  - In survival, `SurvivalClient.o.chat(text, color)` and `o.flashHint(text, ms)` are reachable (`main.js:1874-1875`).
- **Chat log.** `chatLine(text, color, nameStyle, whisper)` `:1582` pushes `{text,color,nameStyle,at}` (+ `whisper, italic`) onto `S.chat` (max 60 entries) and **now returns the line object**.
  - `visibleChat` `chat-whisper.js:22` shows up to 10 lines (20 while chat is open, only 3 whispers when hidden), fading out between 9 and 10 s.
    - With `translate` on, a line that has `tr` shows `tr.text` (translation + `[FROM]` tag) instead.
    - While chat is open it also shows a grey `#8a8a8a` "Original: …" line above it.
  - `Hud.draw` wraps lines with `wrapChat` `chat-style.js:53` and colors them with `chatRuns` `:30`. `nameStyle` is `{start,end,color}` or `{spans:[[s,e,color|"rainbow"]]}`.
  - Incoming chat is handled at `main.js:2012-2051`. Non-blocked lines from others are offered to `translator.offer(line, m)` (`ChatTranslator`, chat-translate.js), which may set `line.tr` asynchronously. That needs Translate chat on, or the world's Translate-all flag.
  - Join/leave/achievement/system lines are localised (`T("chat.joined")`, `srvText(m)`…).
- **Chat input.** `openChat(prefix)` `:3038` calls `releaseInput()`, then unhides and focuses `#chatbox` (`maxlength` 256 = `CHAT_MAX`). `closeChat` resets the composition state. `chatInput()` `:2404` passes the caret, the selection and the IME range `comp` to `Hud.chatField`. `sendChat` `:3062` handles:
  - `/hide`, which toggles `S.chatHidden`.
  - whispers (`parseWhisper` `chat-whisper.js:4`).
  - pending echoes (`createPending` `chat-pending.js:42`: nonce, 10 s timeout, "not sent: reason").
  - In creative, `/commands` are dropped locally.
- **`ChatSuggest`** `chat-suggest.js:50`: command lists (`COMMANDS`/`OP`/`MOD`/`BOSS`), `key(e)`, `view()` → popup data (`ROWS=10`). `ChatToggle` `chat-toggle.js:24` is the `#chat-toggle` "Hide"/"Reveal chat" button. `chatLogVisible` `:6` keeps the log visible under `inv`, `sinv` and `death`.
- **Other chat modules.**
  - `ChatBubbles` `chat-bubbles.js:37`: 3D speech bubbles textured by gfx (6 s).
  - `promotionNotice` `chat-notice.js:2`: the "Self-promotion blocked" dialog.
  - `bindSponsorTooltip(node, () => lines, () => when)` `sponsor-tooltip.js:70` / `hideSponsorTooltip` `:12`: a reusable pixel-font tooltip (`#sponsor-tooltip`), skipped for touch and while pointer-locked.

## 7. Extension points for userscripts

| goal | hook | risks |
|---|---|---|
| New screen or tab UI | Wait for DOMContentLoaded, then `M = await import('/js/menus.js')` (the same module instance as the game's; `M.openOptions()` was verified from a probe on build d7bde3deb9). Call `M.showScreen('myname', build, 'dim')`; re-render with `M.refresh('myname')`; leave with `M.back()` (→ pause in a world, title screen on the title page). Mark it with a hidden element (Better Options: `.tc-marker`), since `S.menuName` can't be read without capturing `S` (§5) | `build` runs again on every refresh, so keep state outside it. Escape → `back()`. Use a name the game doesn't use. The game calls a bare `M.refresh()` on locale changes and `u` changes, which rebuilds your screen too |
| **Localised labels (new)** | `const I = await import('/js/i18n.js')`. Use `I.t(key, vars)` for game strings (keys are in `pretty/js/lang/en.js`, e.g. `pause.options`, `pause.distance`, `options.fov`, `menu.done`, `menu.back`), `I.tOr(key, english)` for your own, and `I.locale()`/`I.localeInfo()`. Re-render with `I.onLocaleChange(fn)` (returns an unsubscribe function; fires after the game's own refresh) | Don't call `setLocale` (the user's choice). Listeners fire asynchronously, after a fetch. A key you invent that the game lacks returns the key itself from `t()`, so use `tOr` |
| Confirm dialog | `M.showMessage(title, text, [[label, fn], ...])` | It's the shared `msg` screen; Back → `back()` |
| Add a button to the pause menu | A `MutationObserver` (`childList`) on `#screen > .inner`. When `button[aria-label="${t('pause.options')}"]` is present and yours isn't, insert a `ui.button(...)` after it | The game re-renders often, so re-insert every time. Build the aria-label with `t()`: in `en` it is `Options…` (U+2026). Add a compat test |
| Redirect a game button | A capture-phase `click` listener on `window` matching `button[aria-label="..."]`, then `preventDefault` + `stopImmediatePropagation` (Better Options `onDocClick`) | aria-label text is localised; build it with `t()`. `…` vs `...` |
| Drive a game setting | Open its screen, grab the control by `data-k` (`fov`, `music`), set its value and dispatch `input`. The detached FOV input keeps its closure over `G.S`. Or `.click()` a cycle button (`Distance:`, matched via `t("pause.distance",{n})`). Then restore with `showScreen`/`closeMenu` | Flicker. `showScreen` releases pointer lock, so re-lock afterwards. `.fov-control` matches both sliders |
| Canvas HUD element | Wrap `Hud.prototype.draw`: call the original, then if `o.show`, draw on `this.x` with `this.font.draw(ctx, t, x, y, o.gs, color)`, placed relative to `this.rect`/`this.chatLayout`. For survival-only elements, wrap `SurvivalClient.prototype.drawHud(hud, font, gs)` | Hot path: no allocations or logging. Mark wrappers (`__tcScaled`-style) so they never double-wrap; chain behind Better Options' wrappers. Non-Latin text draws `?` until its glyph page loads (`font.whenReady`) |
| DOM HUD widget | A fixed element on `body` at z 3–4 with `pointer-events:none` (auto on controls); hide it when `#hudtop.hidden` or `#screen.on`. Or append a `ui.hudButton` to `#hudright` | `buildTop()` wipes `#hudleft`/`#hudright`, now also on every locale change |
| Keybind | §5 recipe plus `__tcOptions.registerKeybind` | Conflicts with editors and future game keys; skip IME composition |
| Toast / tooltip / sound | `ui.note`, `bindSponsorTooltip`, `sound.playClick` | `#note` is shared with the game (1.8 s) |
| UI scale | Override `--u`/`--d` and redraw the `button.mcb` label canvases (Better Options `applyUiScale` + `redrawButtonLabels`) | The game resets the variables on every resize, now one frame after the event (see §8). Game label canvases may repaint themselves when glyphs load |

## 8. Gotchas

1. **Import order.** `menus.js` caches `#screen` and `.inner` when the module is evaluated (`M:15`). Importing it before the DOM exists binds `null` and breaks every menu. Always wait for DOMContentLoaded first.
2. **Screens are rebuilt constantly.** Any `refresh()` replaces all of `.inner`, and DOM you injected into a game screen disappears; handlers are recreated. Refreshes come from:
   - resizes that change `u`;
   - locale changes (`main.js:1577`);
   - network events: `M.refresh("pause","players","owner","verify","achievements","options")` at `main.js:1207,1611,1930,2063,2068,2074,2081,2245,2256`;
   - the music manifest finishing loading (`:338`, about 3 s after boot);
   - render-distance and fullscreen changes (`:3098,3107`);
   - every toggle press.
3. **Labels are bitmaps drawn at `fpx()` from `UI.u`, not from CSS `--u`.** Overriding `--u` resizes the boxes but leaves the labels at the old pixel size. A `.mcb` has no `textContent`; read its `aria-label` (localised). A label canvas can also repaint itself after creation when a glyph page loads (`whenReady`).
4. **`--u`/`--d`/`--hp`/`--hb` are rewritten inline on every resize** (`main.js:531-534`). Since c111547912 that happens at the start of the next animation frame after the `resize`/`fullscreenchange`/`visualViewport` event, not inside the event, so a `setTimeout(…, 0)` re-apply can run *before* the game's rewrite. Overrides have to be re-applied (Better Options polls every 250 ms). A stylesheet `:root{--u:…!important}` beats the inline value (an `!important` author rule outranks a normal inline declaration).
5. **`#inv` (z7) sits above `#screen` (z5).** `showScreen` closes only the creative inventory, not survival containers (`sinv`). Don't open screens while `#inv` is visible.
6. **`closeMenu()` doesn't resume play.** Nothing re-locks the pointer or focuses `#gl`; the player has to click. In lock mode, a canvas mousedown re-locks.
7. **Exiting pointer lock yourself** (`document.exitPointerLock()`) while no game menu is open makes `onLockChange` open the pause menu.
8. `back()` reloads the page when `S.closed` (disconnected / moved-to-another-tab dialogs).
9. **Escape inside your screen calls `back()`, even from a focused input.** To handle Escape yourself, catch it in the capture phase and call `stopImmediatePropagation`.
10. **Touch and mobile.** `--u` is at least 2, so menus are larger. `#hudtop` buttons have no keycaps, and `openCreate` doesn't autofocus. There's no hover, so `.hi` labels show only on `:focus-visible`. Touch buttons are placed using `--hb`; `UI.pad` lifts the hotbar by 6 GUI px and `#chatbox` is `24*gs` taller. Survival hides `#t-hit`/`#t-use`/`#t-drop` and the Inventory button while spectating (`survival/touch.js:143`).
11. **Framed and card pages.** `FRAMED` (an iframe in an 𝕏 post) has no pointer lock, and Create/Sponsor open new tabs. A `?card` page shows only the `card` screen. On the title page (no room), `openPause()` does nothing (it requires `S.started`), so Options is unreachable there.
12. **`mc.fov` outside 30–110 resets to 70 on the next load** (`main.js:226-229`). A mod that writes `mc.fov` below 30 (Better Options' `setFov` allowed 2–110 on build d7bde3deb9) loses the value on reload. Temporary (zoom) FOVs must not be persisted.
13. **`Hud.draw` clears `#hud` every frame**, so anything drawn outside the wrapped chain is wiped. `hud.suggestions` and the survival HUD draw after `Hud.draw`; the tab list is drawn before the survival bars.
14. **Use integer scales on `#hud`.** `Font.draw` with a fractional scale smears the glyphs (Better Options rounds `gs`).
15. **Editor overlays aren't `#screen`.** The sign, book and chest-label editors (and the end credits) swallow game keys through their `key()` hooks, and the skin editor stops propagation in its own capture listener. A document-start capture listener still sees those keys first, so check for the overlays (and for `#anvil-name` focus).
16. **Labels can be longer than in English.** `.third`/`.small` buttons now auto-size; fixed-width injected buttons may clip translated text.
17. **The game may reallocate `#hud`** (`regainCanvases`, game-core.md §4; since 6b3963e444 not `#inv` or `#gl`). Setting a canvas's `width` clears it and resets its 2D context state. `Hud.draw` redraws every frame anyway, but a mod that caches anything on those canvases (or on the font's atlas, which is reset too) must redraw it.
