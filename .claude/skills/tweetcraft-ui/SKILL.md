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
8. **Find buttons by `aria-label`, in the player's language.** The game, Better Options and our tests rely on
   them. The game is translated, so a label is whatever its `t()` returns (see "Matching the game's labels" below).
   The English `"Options…"` uses the real ellipsis U+2026.
9. **One full-width row per setting**, like the game's own Options screen: a toggle, cycle or slider with its text
   on it, and no separate caption on the left (see "Rows" below).

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
      api.toggle('Enabled', b.get('mything.on', true), v => b.set('mything.on', v)),   // "Enabled: ON"
      api.slider('Strength', b.get('mything.strength', 1), 0, 2, 0.05, v => b.set('mything.strength', v)),
      api.cycle?.('Mode', [['a', 'Fast'], ['b', 'Pretty']], b.get('mything.mode', 'a'),  // "Mode: Fast"
        v => b.set('mything.mode', v)),                    // BO 1.1.0+; an undefined row is skipped
      api.note('Short help text.'),
      api.row(api.btn('Reset', () => { b.set('mything.strength', 1); api.refresh(); })),
    ],
  });
}
registerWithBus();
```

- **Bus** (all in `tweetcraft-better-options.js`, lines 39-62, 197 and 899-904):
  - `get(key, default)` and `set(key, value)`. `set` persists to localStorage `tc.options` and notifies every
    `changed(cb)` subscriber as `cb(key, value)`. There is no unsubscribe.
  - `reset()` puts all of `tc.options` back to its defaults, which removes your keys. It then calls
    `cb(key, value)` for every key that was set, with `value` `undefined` for a mod's key. So in `changed`, re-read
    your config with your own defaults rather than using the value passed. "Reset all options" uses it, after
    calling each keybind's `reset`.
  - `version` is Better Options' `@version`. `apiVersion` is `2` (it has `cycle` and `reset`). Feature-check with
    `apiVersion >= 2` or `typeof api.cycle === 'function'`, since an older Better Options may be installed.
  - `register(section)` and `registerKeybind(kb)`. Both ignore a second registration with the same `id`. A section
    becomes the tab `reg:<id>`, placed after Shaders and before Keybinds.
  - `open()` (async: `await` it before reading the DOM), `close()`, and `toast(text)` (`#note`, or `console.log`
    if there is none).
  - `fov.get()` and `fov.set(v)` (async; clamps to 2-110 and writes `mc.fov`, though the game only loads 30-110).
  - `capturing` (true while the Keybinds tab waits for a key).
  - `ui`: the same helpers as `api` minus `bus`, `currentKeyFor` and `fov`.
- **`api` in `build()`:** `header`, `note`, `row`, `item(label, control)`, `btn(label, fn, {cls})`,
  `toggle(label, value, onChange)`, `cycle(label, [[value, text], …], value, onChange)`,
  `slider(label, value, min, max, step, onInput, onChange)`, `h(tag, props, ...kids)`, `T(text)`, `refresh()`,
  `toast()`, `prettyKey(code)`, `currentKeyFor`, `fov`, `bus`. See "Rows" below for how each one looks.
- **Key names:** namespace them by script (`zoom.level`, `mything.on`). Shader settings are the exception: they use
  `tc.shader.<key>` via `Twitterentary.schema`.

## Rows: the game's Options-screen look

Since 1.1.0, Better Options draws every setting the way the game draws its own Options screen and FOV slider. Each
setting is one row, 200u wide (`min(94vw, 200u)`), with its text drawn on the control itself.

- **`toggle(label, value, fn)`:** a full-width `button.mcb.tc-full` reading `Label: ON` or `Label: OFF`.
- **`cycle(label, [[value, text], …], value, fn)`:** a full-width button reading `Label: text`.
  - A click steps to the next option, wrapping around, and calls `fn(value)`.
  - Use it for a small set of named choices: presets, filters, modes.
  - A current value that isn't in the list is shown raw, and the first click picks the first option.
- **`slider(label, value, min, max, step, onInput, onChange)`:** a 200u × 20u `div.tc-slider` track.
  - It holds an `input.tc-range` with a `div.tc-cap` caption, `Label: value`, centred on it. This copies the
    game's `.fov-control` CSS, and the thumb is `/assets/gui/button.png`.
  - The value is shown, and passed to the callbacks, rounded to the step's decimals (`0.75`, not
    `0.7500000000000001`).
  - `onInput` runs while dragging, `onChange` on release.
- **`item(label, control)`:**
  - It returns a full-width control (toggle, cycle or slider) by itself. Wrapping one is harmless, so older code
    like `api.item('Enabled', api.toggle(...))` still works.
  - Any other control, such as a plain `btn`, gets the two-column layout: an ellipsised caption on the left and an
    82u button on the right. The keybind rows and Fullscreen use it.
- **Section headings:** `.tc-sub` (grey, 8u), as on the Shaders tab. `api.header` is the 9u tab title.
- **Keep the text on one line.**
  - Every caption is `white-space: nowrap`.
  - About 194u fits inside the button border, so `Label: value` must stay under that at 8u. The longest today,
    `Shadow update limit (frames): 30`, is about 160u.
  - On narrow screens the caption font shrinks along with the `94vw` width cap (`--tc-f: min(8u, 3.7vw)`).
  - The BO runtime check "every Better Options tab fits its button and slider text on one line…" in
    `compat/expectations.mjs` fails on any overflow. It visits registered tabs too.
- **Updating without a rebuild:** `btn(...).__setLabel(text)` relabels a button in place.
  - The Shaders tab uses it to keep the Quality and Look pickers current while a slider is dragged.
  - A `refresh()` mid-drag would rebuild the slider and drop the drag.
- **Confirmations:** for destructive actions, use the game's `showMessage(title, text, [[label, fn], …])` from
  `/js/menus.js`, after feature-checking it.
  - It replaces our screen, so reopen ours with `showScreen('tcoptions', bus.build, 'dim')` from **both** buttons.
  - If it's missing, fall back to a two-click button: "Click again to reset", disarmed after 3 s, with the state
    kept outside `build`. Relabel it in place (`__setLabel`) instead of calling `refresh()`, so a slider drag on
    another row isn't cut off (BO's `armButton`/`arm`, BO:527-546).

## Matching the game's labels (i18n)

The game ships translations:
- `/js/i18n.js`, with the catalogues in `/js/lang/<code>.js`;
- the player picks a language on the game's own Options screen, and it's stored as `mc.lang`.

Its menus label buttons with `t(key, params)`, and the `aria-label` is that translated text. Any game label you
match, hide or click must therefore come from the same `t()`:

```js
const I = await import('/js/i18n.js');   // after DOMContentLoaded, like menus.js; catch a failed import
const tr = (key, params) => {            // null when untranslated, missing or broken
  try { const s = I.t(key, params); return typeof s === 'string' && s && s !== key ? s : null; } catch (e) { return null; }
};
const labels = new Set(['Options…']);     // always keep the English text as the fallback
const o = tr('pause.options'); if (o) labels.add(o);
I.onLocaleChange?.(() => { /* rebuild the sets, and any CSS built from them */ });
```

- **Example:** Better Options does exactly this in `makeLabels` and `initLabels` (BO:118-163).
  - It covers `pause.options`, `pause.full`, `pause.exitFull` and `pause.distance` (with `{n}`).
  - `bus._labels()` shows its current sets.
- **CSS that hides a game button** needs one selector per translated label. Build a `<style>` of `CSS.escape`d
  `[aria-label="…"]` selectors, and rebuild it on `onLocaleChange` (BO's `#tc-options-i18n`).
- **Finding keys:** look in `game/prod/<LATEST>/pretty/js/lang/en.js`, and find the call site (for example
  `btn(T("pause.options"), …)`) in the game module.
  - Add `compat/expectations.mjs` `source` entries for the key in `en.js` and for the call site that uses it, as
    BO does.
- **Our own captions** (`Shaders: ON`) are English only. Don't use the game's `t()` for them: its keys are the
  game's, not ours.

## Styling recipes

- **CSS:** inject one `<style>` once (`ensureCSS` pattern), scoped under `#screen .inner`, with `tc-` prefixed
  classes.
  - Better Options' classes: `.tc-title .tc-sub .tc-cap .tc-item .tc-full .tc-tg .tc-cycle .tc-slider .tc-range
    .tc-tabs .tc-list .tc-sep .mcb.on`, plus the game's `.desc` (and `.desc.small`).
  - Its button text rules are scoped to `#screen .inner:has(> .tc-marker)`, so the game's own screens are
    untouched. They give white, `nowrap` text with a `#3f3f3f` shadow, and `#ffffa0` on hover.
  - Scope anything that should only apply to your own screen the same way.
- **Sizes:** use `--u` multiples: titles about `9u`, captions `8u`, rows `200u` wide, sliders `20u` tall. Better
  Options' UI scale multiplies `--u`/`--d`, so anything in `--u` scales for free.
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
- `npm run smoke -- --only options --only <your-script>` also runs the BO overflow check (see "Rows") on your tab.
- `npm run smoke -- --headed --only options` to look at it. Then ask the user to check the real game at a few
  window sizes and UI scales, and on touch if relevant.
