---
name: tweetcraft-game-code
description: Find and understand code in the Tweetcraft game itself (tweetcraft.jai.vin, the site these userscripts mod), such as where a feature is implemented, what a module exports, what its real GLSL shaders look like, which DOM/CSS/localStorage the game uses, and what its live state is at runtime. Use before writing or fixing any hook into the game, and whenever a question is about how the game works rather than about our scripts.
---

# Exploring the Tweetcraft game code

We cannot see the server. We can see all of the client: about 100 ES modules, minified but not bundled or
mangled, so exported, class, method and property names are real.

## 1. Get the code locally

```sh
npm run snapshot                       # no-op if the game hasn't changed; add -- --target staging for staging
SNAP=game/prod/$(cat game/prod/LATEST)  # latest snapshot folder
```

| Path | Contents |
|---|---|
| `$SNAP/pretty/` | Every file run through Prettier. Read and grep these. |
| `$SNAP/raw/` | Byte-exact originals (what `source` checks run against) |
| `$SNAP/shaders/NN-<label>.{vert,frag}.glsl` | Every GLSL program linked by the title screen, exactly as compiled. Entity, crack, enchant and bubble programs compile later and are not captured. Read their templates in `pretty/`. |
| `$SNAP/shaders/index.json` | Program names, uniforms, link status |
| `$SNAP/MODULES.md` | **Generated module map:** every module's size, exports, imports (static and lazy) and importers. Start here. |
| `$SNAP/manifest.json` | Build id, file hashes, every module's exports, and the `graph` (resolved imports) |
| `$SNAP/changes.diff` | Diff of `pretty/` and `shaders/` against the previous snapshot |

**Never edit or commit `game/`.**

## 2. Find things

Search by names that survive minification:
- **User-visible strings:** button labels, `"aria-label"` values, chat and toast text.
- **Exported names:** search `manifest.json` `.exports` first, e.g. which module exports `Hud`.
- **Storage, DOM and assets:** localStorage keys (the game uses `mc.*`, e.g. `mc.fov`, `mc.rd`), DOM ids from
  `index.html` (`#gl #hud #screen #inv #chatbox #note #cross #touch #fatal #load`), CSS custom properties
  (`--u` pixel unit, `--d`), asset paths (`/assets/block/`, `/assets/gui/`, `/assets/env/`, `/assets/atlas/`).
- **GLSL:** uniform and attribute names. Grep `shaders/`, not `gfx.js`, because the game assembles some GLSL lines
  from template pieces.

Module map (from exports and names; confirm in the code):

| Module | Role |
|---|---|
| `js/main.js` | Boot (`boot()` creates `new Gfx(canvas)`), input and keys (F1 HUD, F3 debug, F5), main loop, glue. Exports nothing. |
| `js/gfx.js` | Renderer. `class Gfx`, all world shaders, `lightmap`, matrix helpers (`perspective`, `mul`, `rotX/Y/Z`), `playerView`. |
| `js/menus.js` | Screens: `showScreen(name, build, 'dim')`, `openOptions`, `openPause`, `showTitle`, `closeMenu`, `back`, `refresh`, and more. |
| `js/ui.js` | DOM helpers (`el`, `button`), `Font` (bitmap font), `Hud` (canvas HUD), `note` (toast), `drawLoading`. |
| `js/engine.js` | Block and tile tables (`B`, `K`), texture loading (`loadTiles`, `loadImage`). |
| `js/view.js` | Render distances `RDS`, fog. |
| `js/held-light.js` | Held-item dynamic light. |
| `js/net.js` | `createNet` (WebSocket protocol); `js/proto.js` holds the wire constants. |
| `js/survival/*` | Survival mode: `SurvivalClient`, `SurvivalHud`, `PlayerClient`, fluids, items, screens... |
| `js/entities/*` | Mob and player models and the entity renderer. |
| `js/rules/*` | Game data: items, crafting, mining, smelting, variants... |
| other | `sound.js`, `voice.js`, `wardrobe.js` / `skin-*.js`, `signs.js`, `inventory.js`, `sojo-*.js` (accounts/ads). |

**The world simulation is WebAssembly** (`/engine.wasm`, instantiated in `engine.js` `loadEngine`):
- terrain generation, blocks, lighting, physics, raycast and chunk meshing
- player state lives in typed arrays over WASM memory (`eng.st`)
- its exports (`mesh_chunk`, `tex_names`, `block_names`, `raycast`, ...) are listed in `MODULES.md`
- the snapshot keeps the binary in `raw/engine.wasm`, and the change report shows engine export changes

**Nothing useful is on `window` in production.** `main.js` exports nothing, and its state `S`, `eng`, `gfx` and
`net` are module-local. Reach live state through prototypes that get it passed in, e.g. `SignsClient.prototype.draw`
(`this.o`) runs every frame. Details and other options are in `.claude/codemap/game-core.md`
("Extension points").

For broad "where/how does the game do X" questions across many files, delegate to the **`game-code-explorer`**
agent and keep the conclusions, not the file dumps.

## 3. Probe the live game

Module imports from the page return **the same module instances the game uses**, so a script can call or wrap
their exports. Use the probe tool. It runs headless Chrome, waits until the number of linked shader programs has
been stable for 2.5 s, evaluates, and prints JSON:

```sh
npm run probe -- "Object.keys(await import('/js/menus.js'))"
npm run probe -- "(await import('/js/ui.js')).Hud.prototype.draw.toString().slice(0, 400)"
npm run probe -- --programs                              # linked shader programs
npm run probe -- --scripts "window.Twitterentary.debug()" # with our userscripts loaded
npm run probe -- --only options --wait 3000 "document.querySelector('#screen').className"
```

Notes:
- **Boot state:** after boot the game sits on the title screen with a background world. `menus.openOptions()` works
  there. `openPause()` returns immediately until you've joined a world (`!S.started`, `pretty/js/menus.js`
  `openPause`), so the pause menu and its `Distance:` button never render in the probe.
- **The probe doesn't wait for full boot.** Its shader-count wait can finish before `boot()` reaches
  `M.initMenus(G)` (`main.js`, after `await loadTiles`). Until then, `menus.js` functions throw on `G.S`. The
  Minecraftizer (`--scripts`) delays exactly that await, so add `--wait 10000` for menu or UI probes, or load
  fewer scripts with `--only`.
- **Joining needs a server:** joining a world needs the multiplayer backend and can involve a Turnstile check, so
  don't automate it. Ask the user to test in-game behaviour in real Chrome with the dev loaders (`npm run dev`).
- **Staging:** `--target staging` probes the staging host named in `js/devhost.js`, which may run newer code.

## 4. Turn findings into hooks

1. Pick the most stable anchor: an export, then a DOM id or `aria-label`, then a GLSL uniform name, and a code shape
   last.
2. Write the hook to detect the anchor and do nothing if it's absent.
3. Add the anchor to `compat/expectations.mjs` as a `source` entry (`file` = snapshot path, or `shaders:vs` /
   `shaders:fs`), or as a `runtime` check if it only exists live.
4. `npm test`.
