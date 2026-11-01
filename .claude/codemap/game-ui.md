# Game UI codemap: screens, CSS, HUD, input

Verified against game build d7bde3deb9 on 2026-11-01 (the same game code as builds b4bc035ec8 and 26479914e5, which were hashed over fewer files). Re-verify the sections whose files appear in a newer snapshot's changes, then update this id. `npm run check` warns while it isn't the latest build.

Paths are relative to `game/prod/<LATEST>/` (the folder named in `game/prod/LATEST`), and line numbers are those of build d7bde3deb9's `pretty/`. `M` = `menus.js`, `S` = the game state object (`main.js:185`), `G` = the
host object main.js gives menus.js (`main.js:2883`, via `initMenus`). Neither `S` nor `G` is global (`window.__mc` exists only on DEV hosts, `main.js:3080`).

## 1. Overview: DOM layers (`pretty/index.html`, z-index from `pretty/style.css`)

- `#gl` WebGL2 world canvas, z auto, `tabindex=0`, the pointer-lock target. It gets `.pix` (pixelated) while the claim/verify/pending screens are up (`main.js:456,475`).
- `#hud` 2D canvas, z1, `pointer-events:none`. The whole in-game HUD is canvas-drawn here every frame: hotbar, chat log and chat field, nametags, F3, hints, tab list, survival bars.
- `#cross` crosshair `<img>` z2 · `#touch` (stick, jump, sneak) z3 · `#hudtop` (`#hudleft`/`#hudright` DOM buttons) z4 · `#chat-toggle` and `aside#world-sponsors` z4 (z6 with `.pause-visible`), both created by JS.
- `#screen > .inner` z5: every menu. They are DOM elements, but their titles and button labels are pre-rendered `<canvas>`es, not text.
- `#chatbox` z6 and `#invsearch` z8 are invisible `<input>`s laid over canvas-drawn fields. `#inv` z7 is the canvas for the creative inventory and for survival containers.
- `#adv` advancement toast canvas z9 (created on demand) · `#note` DOM toast z10 · `#load` loading canvas z11 · `#fatal` z12. `.off` and `[hidden]` both mean `display:none!important` (`style.css:18,21`).
- Overlays appended to `<body>`: `.se` skin editor z4500, `.sp` z4600, `#sign-editor`, `#book-screen`, turnstile overlay z5000 (`M:184`), `#sponsor-tooltip` z10000.

## 2. Screen system (`pretty/js/menus.js`)

**Core API (exported):**
- `showScreen(name, build, look)` `M:95`.
  - `name` becomes `S.menuName`.
  - `build` is `() => Array<Node|null|false>` (falsy items are dropped). It is stored as `S.menu` and called again on every refresh.
  - `look` is a class string appended after `on` on `#screen` (`className` = `"on"`, plus `" " + look` when given).
  - Side effects: stops sponsor previews; closes the creative inventory (`G.closeInv`, unless `name==='inv'`); `.inner.replaceChildren(...)`; `scrollTop=0`; `G.releaseInput()` (clears held keys, mouse and stick, and exits pointer lock); `G.updateTop()` (hides `#hudtop` and `#touch`).
- `refresh(...names)` `M:108`: calls `S.menu()` again and replaces `.inner`'s children.
  - No-op when there is no menu, when `menuName==='inv'`, or when `names` is given and doesn't include the current screen.
  - Keeps `#screen.scrollTop`, the `.servers` list scroll, and the focus and selection of the focused element, matched by its `data-k`.
- `closeMenu()` `M:129`: clears `S.menu`/`S.menuName`, sets `#screen.className=""`, empties `.inner`, runs `updateTop`. It does **not** re-lock the pointer or focus `#gl`. `resume()` (`main.js:2671`, not exported) does both.
- `back()` `M:199`: there is **no screen stack**. It's a hard-coded chain:
  1. `S.closed` → `location.reload()`
  2. claim/pending → stay put
  3. sponsor (opened from mine) or mineedit → mine
  4. sponsor, sponsored or mine → `openServers`
  5. title page → `showTitle`
  6. verify, owner or create opened from the game → `G.resume`
  7. started → `openPause`
  8. otherwise → `closeMenu`

  An unknown (custom) name lands on step 7, `openPause()`, in a world, and on step 5, `showTitle()`, on the title page.
- `showMessage(title, text, buttons=[["Back", back]])` `M:151`: a generic dialog (name `msg`, look `dim`). Each button is `[label, fn | url-string (rendered as <a target=_blank>) | {at, run} retry]`.
- Escape while any screen is open (`main.js:2356`): `pause` → `resume()`, otherwise `M.back()`. Ignored when `S.closed`, on a card, and on `title`/`death`.
- The `look` values in use: `dim` = `rgba(16,16,16,.62)` (`style.css:86`); `blur` = `.4` black + `backdrop-filter:blur(5px)` (`:92`); `title`; `card`; `death` (style injected as `#deathcss`); `endcredits`; `blur servers-menu`.

**All screens** (name · opener · look · contents):

| name | opener | look | contents |
|---|---|---|---|
| `title` | `showTitle(text?)` `M:224` | title | logo and splash; Multiplayer, Create New World, Skins & VIP ("Skins & Royal" on Sojo), Discord |
| `servers` | `openServers(note?, retry?)` `M:278` | blur servers-menu | search `[data-k=sq]`, Sort:/Show: cycle buttons (`wide`), `.servers` list of `.srow`, Join/Create/Refresh/Sponsor/Back |
| `sponsor` | `openSponsor(placement?, from?)` `M:695` | blur | sponsor checkout form (`spt spd spl spb spemail spworld`). Opens a new tab when started or framed |
| `sponsored` | `openSponsored(session)` `M:1305` | blur | payment confirmation |
| `mine` / `mineedit` | `openMine(path)` `M:1412`, `openEditMine` `M:1537` | blur | manage a sponsor listing (`set sed sel`) |
| `create` | `openCreate(fromGame?)` `M:1681` | blur | name `[data-k=wn]`, Game Mode, Who can build (creative) or PvP + Keep Inventory (survival), Whitelist, Listed in server list |
| `options` | `openOptions()` `M:1790` | dim | FOV `input[type=range][data-k=fov][aria-label="Field of View"]` (30–110), Held light, Show my country, Done |
| `pause` | `openPause()` `M:1834` | dim | "Game Menu". Details below the table |
| `achievements` | `openAchievements` `M:1877` (private) | dim | `.achlist` of `.ach[.on]` |
| `players` | `openPlayers` `M:1917` (private) | dim | `.row.p` rows: face canvas, `.who`, country mark |
| `verify` | `openVerify(fromGame)` `M:1967` | dim | post on 𝕏, paste link `[data-k=pv]` |
| `claim` / `pending` | `openClaim` `M:2007` / `openPending` `M:2023` | dim | publish the world / wait for verification (back is blocked) |
| `owner` | `openOwner(fromGame)` `M:2196` | dim | Owner/Admin tools: rename `[rn]`, lock, kick/ban, roles (`wladd`, `opadd`), life rules, undo builders, Reset world |
| `msg` | `showMessage` `M:151` | dim | dialogs: reset confirm `M:2613`, disconnected, voice, playing in another tab |
| `card` | `main.js:684` | card | logo only (`?card` preview) |
| `wardrobe` | `wardrobe.js:785` | dim | Skins & VIP |
| `death` | `survival/player.js:416` | death | You died!/Game over!, score, Respawn, Title screen (disabled for the first 1 s) |
| `credits` | `survival/end.js:111` | endcredits | End credits (all keys swallowed, `end.js:199`) |
| `spawn-onboarding` | `survival/onboarding.js:65` | dim | "Spawn is protected", buttons with `[data-spawn-action]` |
| `inv` / `sinv` | `main.js:2778` / `:2787` | — | pseudo-menus with `S.menu = () => []`, shown while the `#inv` canvas is open. `#screen` does not get `.on` |

The pause screen's buttons, in order: Back to Game; Share world or Save your progress; Players: N (plus Achievements in survival); Skins; `Options…`; `Distance: N`, with Fullscreen beside it when available; a status line; Return to Title Screen; Log out (signed in, not Sojo); and `.corners` holding the Discord link and the VIP link (hidden for VIPs).

Other exports: `turnstileCheck`, `rolesNote`, `onRoles`, `onRenamed`, `onUndo*`, `confirmUndoPreview`, `cancelUndoPreview`, `initMenus`.

**Building blocks** (menus.js helpers are private; ui.js helpers are exported):
- `fpx()` `M:18` = `max(1, round(G.UI.u * devicePixelRatio))`: device px per GUI px for label canvases.
- `btn(text, fn, size, disabled)` `M:19` wraps `ui.button(G.font, fpx(), ...)`.
  - `size` is one of `half wide third small pvp keepinv`. These are just CSS width classes.
  - **Toggles and cycles** are plain btns whose label reads `"Label: ON"` (create screen) or `"Label: On"` (options). The handler flips the state and calls `refresh(name)` (`M:1727,1818`). There is no toggle widget.
- `title(text)` `M:24` → `canvas.mct`. `label(text)` `M:29` → `canvas.lbl` (`#a0a0a0`). `P(text, cls)` `M:34` → `p.desc[.small|.err|.code]`, with 𝕏 wrapped in `<b>`. `row` `M:42` → `div.row`; `prow` `M:43` → `div.row.p`; `rbo(b)` `M:20` adds the rainbow border `.rbo`.
- `field(k, value, props)` `M:85` → `input.link[data-k=k]`. The `data-k` is what lets `refresh()` restore focus.
- **Sliders**: there is only one, the FOV control `M:1794`: `div.fov-control > input[type=range] + div.fov-caption`. On `input`, the caption div's canvas is replaced with a freshly drawn one.
- `ui.el(tag, props, ...kids)` `ui.js:3`: `class` sets className; `on*` function props become listeners; boolean and number props are set as properties; everything else becomes an attribute; `null`/`false` values and kids are skipped.
- `ui.button(font, px, text, onclick, size, disabled)` `ui.js:203`: `button.mcb[.size]` with `type=button`, `aria-label=text`, `disabled`, and two canvases `.lo` (white, `#a0a0a0` when disabled) and `.hi` (`#ffffa0`). Click → `preventDefault`, `playClick()`, `onclick(e, b)`. A disabled button gets no listener at all.
- `ui.hudButton(font, px, label, key, onclick, aria)` `ui.js:256`: `button.mcb.hb` with a drawn keycap. `mousedown` calls `preventDefault`, so focus stays on the game.
- `ui.textCanvas(font, str, px, color='#fff', shadow=true)` `ui.js:186`: a canvas of `(width+1)*px × 9*px` device px, CSS size = px / dpr. `ui.preloadButtons()` `:195`.
- **aria-label is the only stable handle on a game button.** It equals the label text: `button[aria-label="Options…"]` (U+2026), `[aria-label^="Distance:"]`, `"Back to Game"`, `"Fullscreen"`/`"Exit Fullscreen"`, `"Done"`. Titles (`.mct`) and labels (`.lbl`) are bare canvases with no text.

**Game settings in localStorage** (written through main.js `store`, `main.js:135`; `set(k, null)` removes the key):

| key | where | meaning |
|---|---|---|
| `mc.fov` | `main.js:205`, `M:1806` | base FOV. The loader only accepts 30–110, anything else becomes 70 |
| `mc.rd` | `main.js:230`, `:2846` | render distance ∈ `RDS=[4,6,8,10,12]` (`view.js:1`), default 8 (6 on touch) |
| `mc.heldLight` | `main.js:204`, `M:1820` | `"0"` turns off held-item light |
| `mc.showCountry` | `country.js:2` | `"0"`/`"1"`, share your country flag |
| `mc.hotbar` | `state.js:6,17` | creative hotbar as JSON (9 ids) |
| `mc.sid` / `mc.tok` / `mc.bridged` | `main.js:167,169`, `identity.js:25-26` | session id / login token JSON / token already bridged to a cookie |
| `mc.key.<room>` / `mc.admin` / `mc.nonce` | `main.js:170,177`, `M:1957` | owner key per world (also drives the "My worlds" filter, `M:508`) / admin key / verify nonce |
| `mc.recent` | `recent.js:1` | recently played worlds |
| `mc.voiceOff` / `mc.voiceNotice` | `main.js:1638,3025` | voice opt-out / voice notice seen |
| `mc.cos` / `mc.wardrobe` | `wardrobe.js:81,84` | cosmetics ticket cache / has a wardrobe |
| `mc.adseen` | `sojo-ads.js:132` | ad impressions, kept 2 h |

## 3. Styling system (`pretty/style.css`, `main.js` `resize()`)

- **CSS variables.** Defaults are in `:root` `style.css:6` (`--u:2px --d:1.5px --hp:1px --hb:44px`). `resize()` `main.js:458` sets all four on `documentElement.style`, at boot, on every window `resize`, on every `setInput()` and when a pixelated menu opens or closes (`main.js:543`). With `full=devicePixelRatio` and `dpr=min(full,2)`:
  - `--u` = `max(1, round(raw*full))/full` px, where `raw = max(TOUCH?2:1, min(3, innerWidth/280, innerHeight/190))`. This is CSS px per GUI px, snapped to device pixels. It is also `G.UI.u`.
  - `--d` = `max(1, round(u*full)−1)/full` px, one device px smaller. Used for `.desc` body text.
  - `--hp` = `hpx/full` px, where `hpx = max(TOUCH?2:1, round((TOUCH?1.75:1.25)*full))`. Sizes the `#hudtop` buttons.
  - `--hb` = `(22*gs + pad)/dpr` px: the hotbar height. Positions the touch buttons.
- When `u` changes, `resize()` returns true and the game calls `M.refresh()` (`main.js:2436`), which re-renders the label canvases. A change of `hpx` triggers `buildTop()` instead.
- **HUD scale is separate from `--u`.** `UI.gs = clamp(floor(min(w/320, h/240)), 1, 6)` on device px (`main.js:478`). Example: 1920×1080 at 1×: `gs=4`, `u=3`.
- **Font.**
  - DOM text uses `@font-face "Tweetcraft"` from `/assets/font/tweetcraft.woff2` (`style.css:1`, `font-display:block`). Body is `16px/1.25 "Tweetcraft"`.
  - Canvases use `ui.Font` (`ui.js:108`), built from `/assets/gui/ascii.png` (an 8×8 glyph sheet, 16×16 grid, accent map `EXTRA`).
  - `Font.width(str)` is in GUI px. `Font.draw(ctx, str, x, y, s, color, shadow)` takes an integer scale `s`. The shadow is drawn offset by `s` in `color>>2` per channel (`ui.js:176`): white → `#3f3f3f`, `#ffffa0` → `#3f3f28`, `#a0a0a0` → `#282828`. Lines are 9 GUI px.
- **Buttons.** `.mcb` `style.css:275`:
  - 200×20 `--u`, border-image `url(/assets/gui/button.png) 3 fill / calc(3*var(--u))`.
  - hover and focus-visible switch to `button_highlighted.png` and swap the label canvases (`.lo` hidden, `.hi` shown).
  - `:disabled` uses `button_disabled.png`.
  - widths: `.half` 98, `.wide` 148, `.third` 64, `.small` 60. `.hb` `:766` is auto width × 18 `--hp`.
- **Other assets:**
  - `/assets/gui/`: `hotbar.png`, `hotbar_selection.png`, `crosshair.png`, `toast.png`, `inv/*`, `panel/*`, `container/*`.
  - `/assets/atlas/gui.json` + `gui.webp`: survival sprites.
  - `/assets/title/tweetcraft_edition.png`, `/assets/misc/discord.png`, `/assets/block/dirt.png` (loading and fatal backdrop).
- **Key classes:**
  - `.inner`: column flex, gap `4u`, padding `10u 6u` (`:100`).
  - `.row` / `.row.wrap`: flex rows, gap `4u` (`:213`). `.row.p` is 200u wide, for a field plus a button (`:341`).
  - `.desc` (`:187`): `8*--d`, `#a0a0a0`, max 230u. Variants `.small` `#808080`, `.err` `#ff5555`, `.code` `#ffff55`.
  - `.link` input (`:405`): black, `1px #a0a0a0` border, font `8*--u`.
  - `.mct` / `.lbl`: pixelated canvases. `.who`/`.face`: player rows. `.servers`/`.srow`: lists. `.fov-control` (`:225`): range input styled with a button thumb.
  - `.corners`, `.discord`, `.vipcorner`: fixed z6 corner links. `.ach*`: achievements.
- **Making injected UI look native:**
  1. Best: build with the game's own `ui.button`/`ui.textCanvas`.
     - `font` is a `Hud` instance's `.font` (capture it by wrapping `Hud.prototype.draw`), or `new Font(img)` with a loaded `/assets/gui/ascii.png` `<img>` (the constructor, `ui.js:109`, copies it to a 128×128 canvas).
     - `px = max(1, round(parseFloat(getComputedStyle(documentElement).getPropertyValue('--u')) * devicePixelRatio))`, which is the game's `fpx()`.
  2. With text instead of canvases:
     - Set `font: calc(8 * var(--u)) "Tweetcraft"` explicitly, because buttons and inputs don't inherit it.
     - Use `#fff` text with `text-shadow: var(--u) var(--u) 0 #3f3f3f`; hover `#ffffa0`; disabled `#a0a0a0`.
     - Use `.desc` for prose and `.link` for inputs.
  3. Size everything in multiples of `var(--u)` and set `image-rendering:pixelated` on canvases and images.
  4. Reuse `.mcb` (plus the size classes), `.row`, `.desc`, `.link`.
  5. Call `playClick()` (`sound.js:111`) on click.

## 4. HUD (canvas, `pretty/js/ui.js` `Hud`, `survival/*`)

- **Per-frame order.** `frame()` `main.js:510` → `render()` `:709` → `gfx.draw` → `hud.draw(o)` `:875` → `survival.drawHud(hud, font, UI.gs)` `:906` (only when `show`) → `drawUndoPreview` `:907` → `hud.suggestions(UI.gs)` `:908` → `chatToggle.update(...)` `:909`. After `render()`, `inv.draw` / `survival.screens.draw()` paint the `#inv` canvas, then `updateAdvancement`.
- `Hud.draw` **runs every frame, title screen included, and clears the canvas first.** It returns right after clearing when `!o.show`, where `show = S.started && S.showHud && !CARD` (`:759`).
- **`gs` / `s`** is device px per GUI px on `#hud`, whose size is `innerWidth×innerHeight×min(dpr,2)`.
- `Hud` instance (`ui.js:406`), constructed at `main.js:361`, has these properties: `c` (canvas), `x` (2D context), `font`, `sp` (`{hotbar, sel}` images), `icons` (a `SurvivalIcons` from `main.js:356`, whose `decorate()` draws stack counts; survival swaps in its own at `survival/client.js:56`), `rect`, `chatLayout`, `suggest`, `suggestRect`, `chatFirst`.
- **`draw(o)` `ui.js:415`** reads these fields of `o`:

  | field | meaning | field | meaning |
  |---|---|---|---|
  | `gs` | GUI scale | `show` | HUD visible |
  | `pad` | `6*gs` in touch mode | `sel` | selected hotbar slot |
  | `hotbar` | 9 item ids | `stacks` | survival stack data |
  | `tags` | nametags `[{x,y,s,text,color,rainbow,talk,mark}]` | `lift` | survival: 24 GUI px |
  | `item` | `{text,a}`, held item name | `toast` | `{text,a}` |
  | `chat` | `[{text,color,nameStyle,italic,a}]` | `input` | chat field state or null |
  | `debug` / `debugY` | F3 lines / their y offset | `hint` / `hintAbove` | hint text / place it above the crosshair |
  | `tab` | `{header, footer, rows:[{text,color,face,mark}]}` | | |

  Layout, in units of `s`:
  - Nametags are drawn first.
  - The hotbar sits at `x=W/2−91s`, `y=H−22s−pad`, size 182×22, and sets `this.rect`.
  - Held item name at `hy−13s−lift`; toast at `hy−25s−lift`.
  - Chat lines stack upward from `hy−lift−16s` (`28s` when a toast is showing), 9s each, width `min(320s, W−4s)`, background `rgba(0,0,0,.5)`. Sets `this.chatLayout = {left, top, baseline, scale}`.
  - Then `chatField`, debug lines (top-left), `hint`, `tab`.
- **Methods.** `chatField(o, s, pad)` `:518` draws the chat input at `H−pad−14s` with caret, selection and ghost suggestion. `suggestions(s)` `:576` draws the command popup; `suggestAt(cx, cy)` `:612` maps client px to a popup row. `hint(text, s, above)` `:621` sits below the crosshair at `H/2+20k`, or at `H*.32` when `above`, shrinking `k` until it fits. `tab(t, s)` `:636` is the player list, centered at the top in columns of up to 20. `drawLoading(c, font, dirt, o)` `:692` draws the `#load` screen.
- **Survival.** `SurvivalClient.drawHud(hud, font, gs)` `survival/client.js:293` → `drawCounts` `:468` (stack numbers on the hotbar) → each system's `drawHud`:
  - `PlayerClient.drawHud` `survival/player.js:360` → `SurvivalHud.draw(ctx, font, s, rect, st)` `survival/hud.js:28`. Draws hearts, absorption, armor, food, air, the XP bar and level, and the attack indicator under the crosshair. Positions are relative to `hud.rect`. Atlas sprite names are `hud/heart/*`, `hud/food_*`, `hud/armor_*`, `hud/experience_bar_*`. When `st.cr` (creative-gamemode player, `player.js:396`) is set, the bar sprites and the level number are skipped. `PlayerClient.drawHud` draws nothing while spectating (`st.sp`).
  - `BlocksClient` `blocks.js:69`: sleep fade.
  - `PortalsClient` `portals.js:43`: portal overlay.
  - `EndClient` `end.js:272`: boss bar at the top.

  `SurvivalClient.lift` `client.js:311` is the largest `lift` among its systems (24 from `player.js:53`).
- **DOM HUD parts.**
  - `#cross` gets `.off` toggled every frame: it's hidden when a menu is open, in third person, or with the HUD off (`main.js:874`). It's sized `15*gs/dpr` in `resize`, with `mix-blend-mode:difference`.
  - `#hudtop`: `buildTop()` `main.js:2093` calls `replaceChildren` on both sides.
    - `#hudleft`: "≡" (aria "Menu"), then one of Save your progress [V] (signed out), Owner/Admin tools [O] (owner or op) or Make your own world [M], then voice buttons.
    - `#hudright`: Play in new tab (framed only), Inventory [E], Chat [T].
    - Rebuilt at `:392,404,501,1635,1735,1877,2040,2051`. Shown and hidden by `updateTop()` `:2078` through the `hidden` attribute.
  - `#adv`: `showAdvancement` `:1460`, a 160×32 GUI px `toast.png` that slides in for 5 s.

## 5. Input (`pretty/js/main.js`)

- **Listeners** are registered in `bindInput()` `:2411`, called from `boot()` (`:393`) after assets load and before the network connects:
  - `window` keydown/keyup (**bubble phase**); window `blur` → `releaseKeys`; `pointerlockchange` → `onLockChange`.
  - `#gl`: mousedown, pointerdown/move/up, wheel (non-passive), contextmenu.
  - `window`: mouseup, mousemove, pointerup. `#inv`: pointer and wheel. `#chatbox`: pointerdown/mousedown (caret placement). `#stick`, `#t-jump`, `#t-sneak`: pointer handlers.
  - Others: `ChatSuggest.listen` `chat-suggest.js:149` adds window **capture** pointerdown/mousedown/touchstart/wheel over popup rows. The skin editor adds window **capture** keydown/keyup that call `stopImmediatePropagation` (`skin-editor.js:446,471`). `#chat-toggle` stops key and pointer propagation.
- **`onKeyDown` `:2322`.** The first handler that claims the key returns:
  1. editors: `signs.key`, survival `labels`, `book`, `onboarding`, `end`.
  2. `S.resuming` → ignore the key.
  3. `S.chatOpen`: `suggest.key` (Tab/Up/Down/Escape); Enter → `sendChat`; Escape → `closeChat`. Every other key goes natively to `#chatbox`.
  4. `survival.screens.key` (`screens.js:515`): Escape/E close, 1–9 swap, Q throw.
  5. creative `inv.key` (`inventory.js:207`): Escape/E close, 1–9 assign, a printable key focuses the search box.
  6. Undo preview: C confirms, Escape cancels.
  7. **Any `S.menu`**: F5 `preventDefault`; Escape → resume/back; **everything else is ignored**, so inputs inside screens are safe.
  8. Ignore when not started or when the target is `INPUT`/`TEXTAREA`. In lock mode, a keypress with user activation re-requests the lock.
  9. `PREVENT` `:78` calls `preventDefault` for Space, the arrows, Tab, F1, F3, F5, Slash, Quote, Enter and KeyT.
  10. Tab sets `S.tab` (held). After that, `e.repeat` is ignored.
- **Game keys** (`e.code`):

  | group | keys |
  |---|---|
  | Movement | W/A/S/D and arrows move (read from `S.keys` in `tick` `:574`); Space jumps, double-tap within 300 ms toggles flying; Shift (L/R) sneaks; double-tap W/Up sprints, as does `ControlLeft` on Mac only (`:583`) |
  | Hotbar | Digit1–9 select a slot, as does the wheel over `#gl`; Q drops (survival; Ctrl drops the stack) |
  | Screens | E inventory; V verify; O owner tools (owner or op only); M new-world tab |
  | Chat, voice | P mutes or enables voice; T or Enter opens chat; `/` opens chat prefilled with `/` |
  | View | Escape pauses (when not pointer-locked); F1 toggles `S.showHud` (+ `updateTop`); F3 debug; F5 cycles `S.view` (0 first person, 1 behind, 2 front); Tab player list while held; C confirms an undo preview |
  | Mouse | LMB attack/break; RMB place/use; MMB pick block; in drag mode, click and drag to look |
  | Touch | stick moves; drag on `#gl` looks; tap breaks or places (creative); survival adds `#t-hit`, `#t-use`, `#t-drop` (`survival/touch.js:31`) |
  | Unbound (grep of every `e.code`/`e.key` check in `js/`) | B F G H I J K L N R U X Y Z, Digit0, Backquote, F2, F4, F6–F10. Ctrl+Z/Y are used only inside the skin editor |
- **Pointer lock and input modes.** `S.input` is one of `none|lock|drag|touch` (`setInput` `:2073`). `spawn()` `:652` picks `touch` when `TOUCH` (`matchMedia('(pointer: coarse)')` or `?touch`, `:120`), `drag` when framed (inside an 𝕏 post), in tests or when the lock is refused, and `lock` otherwise.
  - `active()` `:2066` = started, no menu or chat, not closed or resuming, and (in lock mode) actually locked. Look (`movementX*SENS`, `:2512`) and the wheel only work while `active()`.
  - When the lock is lost (Escape), `onLockChange` `:2271` opens the pause menu, unless a menu or chat is open. A running undo preview is cancelled instead. Clicking `#gl` in lock mode re-requests the lock (`:2465`).
- **Detecting state without `S`:** menu open = `#screen.classList.contains('on')`; inventory or container = `!#inv.classList.contains('off')`; chat = `!#chatbox.hidden`; typing = active element is `INPUT`/`TEXTAREA`/contentEditable; editors = `.se`, `#sign-editor` or `#book-screen` exists; locked = `document.pointerLockElement === #gl`; HUD visible = `!#hudtop.hidden` (also hidden during menus).
- **Capturing `S` (verified live with `npm run probe`; no script uses it yet):** wrap `ChatToggle.prototype.update` (`chat-toggle.js:69`, called every frame, title screen included) and read `this.state`. It is `S` (`main.js:265`), so `menuName`, `chatOpen`, `showHud`, `input`, `started`, `resuming`, `debug`, `view` and `tab` become readable. In survival, `SurvivalClient` instances also carry `.S`.
- **Adding a keybind:**
  1. Use `addEventListener('keydown', fn, true)` on `window` at document-start. It runs before the game's bubble listener.
  2. Bail out on any of these: `e.repeat` (for toggles); `e.__tc`, `e.__tcCaptured` or `window.__tcOptions?.capturing`; typing; `#screen.on` (unless the screen is yours); `#inv` visible; chat open; an editor overlay present.
  3. Prefer an unbound code. To take over a game key, call `preventDefault()` and `stopImmediatePropagation()` in the capture phase. The game never checks `isTrusted`, so synthetic `KeyboardEvent`s dispatched on `window` trigger game actions. Better Options relies on this for its F1 toggle and key remaps.
  4. Register with `window.__tcOptions.registerKeybind({id, label, get, set, reset})` so the key appears in Better Options' Keybinds tab and is excluded from its remapping.

## 6. Toasts, notes, chat

- **`ui.note(text)`** `ui.js:398`: sets the text of `#note` and adds `.show` for 1800 ms (one shared timer, `note.t`). It's exported, and it's the right toast for scripts. Style: fixed top-center, `rgba(0,0,0,.8)`, `1px #555` border (`style.css:1058`).
- **Canvas-only feedback** (main.js, not exported):
  - `toast(text, ms=2500)` `:1419` sets `S.toast`, drawn above the hotbar.
  - `flashHint(text, ms=4000)` `:1422` sets `S.flash`, drawn as the hint box.
  - `showAdvancement` `:1460`.
  - With `S` captured you can set `S.toast={text, until}` yourself, with `until` on the `performance.now()` clock (`main.js:1420`; `render` reads it at `:888-889`). In survival, `SurvivalClient.o.chat(text, color)` and `o.flashHint(text, ms)` are reachable (`main.js:1682-1683`).
- **Chat log.** `chatLine(text, color, nameStyle, whisper)` `:1405` pushes `{text,color,nameStyle,at}` onto `S.chat` (max 60 entries).
  - `visibleChat` `chat-whisper.js:22` shows up to 10 lines (20 while chat is open, only 3 whispers when hidden), fading out between 9 and 10 s.
  - `Hud.draw` wraps lines with `wrapChat` `chat-style.js:52` and colors them with `chatRuns` `:29`. `nameStyle` is `{start,end,color}` or `{spans:[[s,e,color|"rainbow"]]}`.
  - Incoming chat is handled at `main.js:1820-1840`.
- **Chat input.** `openChat(prefix)` `:2792` releases input, unhides and focuses `#chatbox` (`maxlength` 120 = `CHAT_MAX`). `chatInput()` `:2206` passes the caret and selection to `Hud.chatField`. `sendChat` `:2813` handles:
  - `/hide`, which toggles `S.chatHidden`.
  - whispers (`parseWhisper` `chat-whisper.js:4`).
  - pending echoes (`createPending` `chat-pending.js:34`: nonce, 10 s timeout, "not sent: reason").
  - In creative, `/commands` are dropped locally.
- **`ChatSuggest`** `chat-suggest.js:35`: command lists (`COMMANDS`/`OP`/`MOD`/`BOSS`), `key(e)`, `view()` → popup data (`ROWS=10`). `ChatToggle` `chat-toggle.js:24` is the `#chat-toggle` "Hide"/"Reveal chat" button. `chatLogVisible` `:6` keeps the log visible under `inv`, `sinv` and `death`.
- **Other chat modules.** `ChatBubbles` `chat-bubbles.js:52`: 3D speech bubbles textured by gfx (6 s). `promotionNotice` `chat-notice.js:1`: the "Self-promotion blocked" dialog. `bindSponsorTooltip(node, () => lines, () => when)` `sponsor-tooltip.js:70` / `hideSponsorTooltip` `:12`: a reusable pixel-font tooltip (`#sponsor-tooltip`), skipped for touch and while pointer-locked.

## 7. Extension points for userscripts

| goal | hook | risks |
|---|---|---|
| New screen or tab UI | Wait for DOMContentLoaded, then `M = await import('/js/menus.js')` (same module instance as the game's; verified live, `M.openOptions()` works from a probe). Call `M.showScreen('myname', build, 'dim')`; re-render with `M.refresh('myname')`; leave with `M.back()` (→ pause in a world, title screen on the title page). Mark it with a hidden element (Better Options: `.tc-marker`), since `S.menuName` can't be read without capturing `S` (§5) | `build` runs again on every refresh, so keep state outside it. Escape → `back()`. Use a name the game doesn't use |
| Confirm dialog | `M.showMessage(title, text, [[label, fn], ...])` | It's the shared `msg` screen; Back → `back()` |
| Add a button to the pause menu | `MutationObserver` (`childList`) on `#screen > .inner`. When `button[aria-label="Options…"]` is present and yours isn't, insert a `ui.button(...)` after it | The game re-renders often, so re-insert every time. Labels can change between builds; add a compat test |
| Redirect a game button | Capture-phase `click` listener on `window` matching `button[aria-label="..."]`, then `preventDefault` + `stopImmediatePropagation` (Better Options `onDocClick`, `tweetcraft-better-options.js:604-613`) | aria-label text changes; `…` vs `...` |
| Drive a game setting | Open its screen, grab the control, set its value and dispatch `input`. The detached FOV input keeps its closure over `G.S`. Or `.click()` a cycle button (`Distance:`). Then restore with `showScreen`/`closeMenu` | Flicker. `showScreen` releases pointer lock, so re-lock afterwards |
| Canvas HUD element | Wrap `Hud.prototype.draw`: call the original, then if `o.show`, draw on `this.x` with `this.font.draw(ctx, t, x, y, o.gs, color)`, placed relative to `this.rect`/`this.chatLayout`. For survival-only elements, wrap `SurvivalClient.prototype.drawHud(hud, font, gs)` | Hot path: no allocations or logging. Mark wrappers (`__tcScaled`-style) so they never double-wrap; chain behind Better Options' wrappers |
| DOM HUD widget | Fixed element on `body` at z 3–4 with `pointer-events:none` (auto on controls); hide it when `#hudtop.hidden` or `#screen.on`. Or append a `ui.hudButton` to `#hudright` | `buildTop()` wipes `#hudleft`/`#hudright` |
| Keybind | §5 recipe plus `__tcOptions.registerKeybind` | Conflicts with editors and future game keys |
| Toast / tooltip / sound | `ui.note`, `bindSponsorTooltip`, `sound.playClick` | `#note` is shared with the game (1.8 s) |
| UI scale | Override `--u`/`--d` and redraw the `button.mcb` label canvases (Better Options `applyUiScale` + `redrawButtonLabels`) | The game resets the variables on every resize (see §8) |

## 8. Gotchas

1. **Import order.** `menus.js` caches `#screen` and `.inner` when the module is evaluated (`M:13`). Importing it before the DOM exists binds `null` and breaks every menu. Always wait for DOMContentLoaded first.
2. **Screens are rebuilt constantly.** Any `refresh()` replaces all of `.inner`. Refreshes come from resizes that change `u`, network events (`M.refresh("pause","players","owner","verify","achievements")` at `main.js:1060,1433,1734,1862,1871,1878,2041,2052`), render-distance and fullscreen changes, and every toggle press. DOM you injected into a game screen disappears; handlers are recreated.
3. **Labels are bitmaps drawn at `fpx()` from `UI.u`, not from CSS `--u`.** Overriding `--u` resizes the boxes but leaves the labels at the old pixel size. A `.mcb` has no `textContent`; read its `aria-label`.
4. **`--u`/`--d`/`--hp`/`--hb` are rewritten inline on every resize** (`main.js:488`). Overrides have to be re-applied (Better Options polls every 250 ms). A stylesheet `:root{--u:…!important}` beats the inline value (an `!important` author rule outranks a normal inline declaration).
5. **`#inv` (z7) sits above `#screen` (z5).** `showScreen` closes only the creative inventory, not survival containers (`sinv`). Don't open screens while `#inv` is visible.
6. **`closeMenu()` doesn't resume play.** Nothing re-locks the pointer or focuses `#gl`; the player has to click. In lock mode, a canvas mousedown re-locks.
7. **Exiting pointer lock yourself** (`document.exitPointerLock()`) while no game menu is open makes `onLockChange` open the pause menu.
8. `back()` reloads the page when `S.closed` (disconnected / moved-to-another-tab dialogs).
9. **Escape inside your screen calls `back()`, even from a focused input.** To handle Escape yourself, catch it in the capture phase and call `stopImmediatePropagation`.
10. **Touch and mobile.** `--u` is at least 2, so menus are larger. `#hudtop` buttons have no keycaps, and `openCreate` doesn't autofocus. There's no hover, so `.hi` labels show only on `:focus-visible`. Touch buttons are placed using `--hb`; `UI.pad` lifts the hotbar by 6 GUI px and `#chatbox` is `24*gs` taller. Survival hides `#t-hit`/`#t-use`/`#t-drop` and the Inventory button while spectating (`survival/touch.js:141`).
11. **Framed and card pages.** `FRAMED` (an iframe in an 𝕏 post) has no pointer lock, and Create/Sponsor open new tabs. A `?card` page shows only the `card` screen. On the title page (no room), `openPause()` does nothing (it requires `S.started`).
12. **`mc.fov` outside 30–110 resets to 70 on the next load** (`main.js:205`). Better Options' `setFov` clamps to 2–110 and does write `mc.fov` (`tweetcraft-better-options.js:117-118`), so a value below 30 is lost on reload. Temporary (zoom) FOVs must not be persisted.
13. **`Hud.draw` clears `#hud` every frame**, so anything drawn outside the wrapped chain is wiped. `hud.suggestions` and the survival HUD draw after `Hud.draw`; the tab list is drawn before the survival bars.
14. **Use integer scales on `#hud`.** `Font.draw` with a fractional scale smears the glyphs (Better Options rounds `gs`).
15. **Editor overlays aren't `#screen`.** The sign, book and chest-label editors (and the end credits) swallow game keys through their `key()` hooks, and the skin editor stops propagation in its own capture listener. A document-start capture listener still sees those keys first, so check for the overlays.
