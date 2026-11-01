---
name: tweetcraft-ui
description: Build or change in-game UI for the Tweetcraft userscripts, such as the Better Options menu (tweetcraft-better-options.js), a settings tab or keybind registered from another script through window.__tcOptions, HUD tweaks, toasts, and anything that must look and behave like the game's native Minecraft-style UI (pixel font, --u scale units, mcb buttons, #screen menus). Use for any menu, settings, HUD or input-handling work.
---

# In-game UI for the userscripts

Read first:
- `.claude/codemap/game-ui.md`: the game's screen system, CSS units, HUD and input handling.
- `.claude/codemap/scripts.md`: Better Options internals and the bus.

## Golden rules

1. **Add settings through Better Options' bus**, not with your own floating panels. The user gets one consistent
   menu, opened from the pause menu's "Options…".
2. **Look native.**
   - Size everything in the game's pixel unit: `calc(N * var(--u))`.
   - Use the `"Tweetcraft"` font and `button.mcb` buttons (the game's `/assets/gui/button*.png` border images).
   - Render inside `#screen .inner` through `menus.showScreen`.
3. **Never break input.**
   - Key handlers bail out while typing (INPUT/TEXTAREA/contentEditable), while `window.__tcOptions?.capturing`
     is set (keybind capture), and on events marked `e.__tcCaptured`.
   - Only use capture-phase listeners when you must pre-empt the game.
4. **The DOM gets rebuilt.**
   - `menus.showScreen(name, build, look)` keeps `build` and re-runs it on every `refresh()`, which is triggered
     by resizes, network events and every toggle press.
   - Build your UI in the section's `build()`.
   - If you must inject into one of the game's own screens, re-apply it from a `MutationObserver` on
     `#screen > .inner`.
5. **Never import `/js/menus.js` before `DOMContentLoaded`.** It looks up `#screen` and `.inner` when the module
   first evaluates, so an early import breaks every game menu. Better Options and zoom await `domReady()` first.
6. **There is no screen stack.** `menus.back()` is a hard-coded chain, so a custom screen "goes back" to the pause
   menu. Return to where you came from explicitly when that matters.
7. **Native-looking text.** The game's button labels and titles are **canvas bitmaps**, rendered at
   `round(UI.u * devicePixelRatio)`, not CSS text. Use the exported `ui.button`/`ui.textCanvas` (with a font
   captured from a `Hud` instance), or CSS `font: calc(8*var(--u)) "Tweetcraft"` with a `#3f3f3f` shadow offset
   by one `--u`. The game rewrites `--u`/`--d`/`--hp`/`--hb` on every resize.
8. **Find buttons by `aria-label`.** The game, Better Options and our tests rely on them. `"Options…"` uses the
   real ellipsis U+2026.

## Registering a tab and a keybind (the pattern zoom uses)

The new-script template (`.claude/skills/tweetcraft-new-userscript/template.user.js`) has a complete version of
this, with a localStorage fallback for when Better Options isn't installed.

```js
let KEY = window.__tcOptions?.get('mything.key', 'KeyG') || 'KeyG', tries = 0;
function registerWithBus() {
  const b = window.__tcOptions;
  if (!b || !b.register) { if (++tries < 50) setTimeout(registerWithBus, 200); return; } // may load later, or never
  KEY = b.get('mything.key', KEY) || KEY;             // re-read now that the bus exists
  b.changed?.((key, value) => {                       // fires for every key, including '__sections'/'__keybinds'
    if (typeof key === 'string' && key.startsWith('mything.')) { /* re-read your config */ }
  });
  b.registerKeybind({                                  // only id, label, get, set and reset are read
    id: 'mything', label: 'My thing (hold)',
    get: () => KEY, set: code => { KEY = code; b.set('mything.key', code); },
    reset: () => { KEY = 'KeyG'; b.set('mything.key', 'KeyG'); },
  });
  b.register({
    id: 'mything', title: 'My Thing',                 // becomes a tab in More Options
    build: api => [                                    // called on every render: return an array of fresh nodes
      api.header('My Thing'),
      api.slider('Strength', b.get('mything.strength', 1), 0, 2, 0.05, v => b.set('mything.strength', v)),
      api.item('Enabled', api.toggle('Enabled', b.get('mything.on', true), v => b.set('mything.on', v))),
      api.note('Short help text.'),
      api.row(api.btn('Reset', () => { b.set('mything.strength', 1); api.refresh(); })),
    ],
  });
}
registerWithBus();
```

- **Bus** (all in `tweetcraft-better-options.js`, lines 37-52 and 580-585):
  - `get(key, default)` and `set(key, value)`. `set` persists to localStorage `tc.options` and notifies every
    `changed(cb)` subscriber as `cb(key, value)`. There is no unsubscribe.
  - `register(section)` and `registerKeybind(kb)`. Both ignore a second registration with the same `id`. A section
    becomes the tab `reg:<id>`, placed after Shaders and before Keybinds.
  - `open()` (async: `await` it before reading the DOM), `close()`, and `toast(text)` (`#note`, or `console.log`
    if there is none).
  - `fov.get()` and `fov.set(v)` (async; clamps to 2-110 and writes `mc.fov`).
  - `capturing` (true while the Keybinds tab waits for a key).
  - `ui`: the same helpers as `api` minus `bus`, `currentKeyFor` and `fov`.
- **`api` in `build()`:** `header`, `note`, `row`, `item(label, control)`, `btn(label, fn, {cls})`,
  `toggle(label, value, onChange)`, `slider(label, value, min, max, step, onInput, onChange)`,
  `h(tag, props, ...kids)`, `T(text)`, `refresh()`, `toast()`, `prettyKey(code)`, `currentKeyFor`, `fov`, `bus`.
- **Key names:** namespace them by script (`zoom.level`, `mything.on`). Shader settings are the exception: they use
  `tc.shader.<key>` via `Twitterentary.schema`.

## Styling recipes

- **CSS:** inject one `<style>` once (`ensureCSS` pattern), scoped under `#screen .inner` with `tc-` prefixed
  classes. Existing classes: `.tc-title .tc-cap .tc-row .tc-item .tc-range .tc-tabs .tc-list .tc-sep .mcb.on`.
- **Sizes:** use `--u` multiples (titles about `9u`, labels `8u`, rows up to `230u` wide). Better Options' UI scale
  multiplies `--u`/`--d`, so anything in `--u` scales for free.
- **HUD (canvas, `#hud`):**
  - `Hud.prototype.draw(o)` runs every frame, clears the canvas first, and returns early when the HUD is hidden
    (`!o.show`).
  - To add an element, wrap `draw` (or `SurvivalClient.prototype.drawHud` for survival only), and draw after the
    original on its context at integer scale.
  - The HUD scale `o.gs` is separate from `--u` (1920×1080 at 1× gives `gs=4`, `u=3`).
  - Don't overlay DOM on the HUD unless it's interactive.
- **Keybinds:** the game handles `keydown` on `window` in the bubble phase and ignores most keys while a menu is
  open. Add yours as a capture-phase listener that skips when:
  - the player is typing, or chat is open;
  - `#screen` has class `on`;
  - `#inv` is showing;
  - `__tcOptions.capturing` is set;
  - `e.__tcCaptured` is set.

  Check for collisions with the game's keys in `codemap/game-ui.md` ("Input"). Note that `KeyC` confirms undo
  previews.
- **Toasts:** `window.__tcOptions.toast(text)` (uses the game's `#note`).

## Verify

- `npm run smoke -- --only options --only <your-script>`. Runtime checks confirm the hooks applied. Add a
  `runtime` expectation for anything new (for example, that your tab is registered or your HUD wrapper is marked).
- `npm run probe -- --only options --only <your-script> "(async () => { await window.__tcOptions.open(); return document.querySelector('#screen .inner')?.innerText })()"`
  dumps what the menu renders. Without the `await`, it reads the DOM before the menu exists and returns `""`.
  The probe evaluates once the shader count settles, which isn't necessarily after `boot()` has reached
  `initMenus`. If `open()` throws `Cannot read properties of null (reading 'S')`, boot wasn't done yet: add
  `--wait 10000`.
- `npm run smoke -- --headed --only options` to look at it. Then ask the user to check the real game at a few
  window sizes and UI scales, and on touch if relevant.
