---
name: tweetcraft-new-userscript
description: Create a new Tampermonkey userscript for Tweetcraft in this repo, end to end, covering the metadata block, defensive game hooks, settings via Better Options, compat expectations, dev loader, tests and README entry. Use when the user wants a new script, mod or feature that doesn't belong in an existing script.
---

# New userscript

First decide whether it belongs in an existing script:
- Shaders and rendering go in `twitterentary-shaders.user.js`.
- Settings UI goes in Better Options.
- Anything with its own on/off identity gets its own file.

## Steps

A new script touches several files, so it always runs as a team: see "Run it as a team" in `tweetcraft-dev-pipeline`.

1. **Measure.** Use the `tweetcraft-game-code` skill (or the `game-code-explorer` agent) to find the hook points.
   Pick the most stable anchor (export, then DOM id or aria-label, then GLSL uniform, then code shape), and check it
   live with `npm run probe`.
2. **Write the expectations first.** Add `source` and/or `runtime` entries for every hook in
   `compat/expectations.mjs`, under a new `const` for the file name. `npm run check` only evaluates entries whose
   script file exists in the repo root (otherwise it just warns that the file is missing), so create the file from
   the template (step 3) first. Then run `npm run check`: the new entries should pass against the current game
   before you write code that relies on them.
3. **Create the file.** Copy [template.user.js](template.user.js) to `<name>.user.js` in the repo root (kebab-case,
   prefixed `tweetcraft-`). It passes `npm run check` as it is. Replace every `<Feature>`/`<feature>` placeholder,
   rename `window.__tcFeature` and the `__tcFeature` marker, then fill in the metadata:
   - `@namespace tweetcraft.<name>`. A script's identity is `@name` + `@namespace`, and you can never change it
     after release.
   - `@version 0.1.0`
   - `@match https://tweetcraft.jai.vin/*`
   - `@run-at document-start`
   - `@grant none` unless you need GM APIs. Granting anything moves the script into a sandbox, where page globals
     need `unsafeWindow`. The smoke harness only shims `GM_info`, `unsafeWindow`, `GM_addStyle` and
     `GM_getValue`/`GM_setValue`/`GM_deleteValue`/`GM_listValues` (`tools/lib/userscript-env.mjs`).
4. **Implement defensively.** The template already has the shape:
   - one IIFE with `'use strict'` and a `TAG`;
   - the version read from `GM_info.script.version`, never hard-coded;
   - guards around every hook, with fallbacks to the originals, and errors logged once rather than per call;
   - a key handler that skips typing, open screens, the inventory and Better Options' key capture;
   - a settings tab and keybind registered through `window.__tcOptions`, with polling capped at 10 s, and storage
     straight to `tc.options` when Better Options isn't installed (see the `tweetcraft-ui` skill);
   - one debug global, `window.__tc<Name>`.
5. **Test.**
   - `npm run check`
   - `npm run smoke -- --only <name>`
   - `npm test` with all scripts, to catch interactions. Load order is Better Options first, then alphabetical.
   - Look at `reports/smoke-prod.png`.
6. **Try it in real Chrome.** Run `npm run dev` and install `dev/<name>.dev.user.js`. Ask the user to try it
   in-game.
7. **Document.** Add one bullet to the README "Scripts" list, and a section in `.claude/codemap/scripts.md`
   (structure, hooks, globals, storage keys).
8. **Ship** following the steps in `.claude/CLAUDE.md`. Commit and push only when asked.

The `userscript-reviewer` agent can review the finished script before shipping.
