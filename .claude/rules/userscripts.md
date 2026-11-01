---
paths:
  - "*.user.js"
  - "tweetcraft-*.js"
  - "twitterentary-*.js"
---

# Editing a userscript

- **Keep the metadata block complete and accurate:** `@name @namespace @version @description @match @run-at @grant`.
  `npm run check` enforces this. Bump `@version` with every change; `npm run check` fails if the file differs
  from `origin/main` without a higher version. Never rename the file or change `@name`/`@namespace`, because
  Tampermonkey would treat it as a new script and installed copies would stop updating. After changing `@grant`,
  `@match` or `@require`, re-run `npm run dev` so the dev loaders match.
- **Don't hard-code the script's version in code.** Read `GM_info.script.version`, which Tampermonkey provides even
  with `@grant none` and the smoke harness shims. Existing hard-coded strings (`bus.version`) must match
  `@version`.
- **One self-contained IIFE per file.** Start it with `'use strict'`, and keep globals behind one namespaced object
  (`window.Twitterentary`, `window.__mcChatHistory`...) for debugging and cross-script use.
- **Run at `document-start`.** Patch prototypes (`WebGL2RenderingContext.prototype`, `HTMLImageElement.prototype`)
  before the game's modules load: the renderer compiles its shaders in the `Gfx` constructor during boot. Touch the
  DOM only after it exists (`DOMContentLoaded`, or poll for the element).
- **Never `import('/js/menus.js')` before `DOMContentLoaded`.** It looks up `#screen` when the module first
  evaluates, so an early import breaks the game's menus.
- **Detect, then patch.** Every regex or anchor must tolerate whitespace (`\s*`). If an anchor is missing, return the
  original untouched. Wrap every hook in try/catch, and fall back to the original function, source or value on
  error. Log with the script's `[Tag]` prefix: `console.error` for real failures. The smoke test fails on errors
  attributed to a script, so don't log expected conditions as errors.
- **Wrapped GL and DOM methods are hot paths.** They run every draw call or every frame: no allocations, closures,
  `getParameter` or `getError` calls, or logging inside them.
- **Regex literals use single escapes** (`/\s*/`). Double escapes like `\\s` belong only inside `new RegExp('...')`
  strings. This exact mistake broke `patchCloud()`.
- **Settings:** shader settings use localStorage `tc.shader.<key>`. Everything else goes through `window.__tcOptions`
  (`tc.options`). The game's own keys are `mc.*`; read them, but don't redefine their meaning.
- **Key handlers** must ignore events while typing (`INPUT`/`TEXTAREA`/contentEditable) and while
  `window.__tcOptions?.capturing` is set or `e.__tcCaptured` is true.
- **After the edit:** update `compat/expectations.mjs` for any new or changed game hook, then run
  `npm test` (or `npm run smoke -- --only <name>` while iterating).
