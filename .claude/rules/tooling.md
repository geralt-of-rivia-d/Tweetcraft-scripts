---
paths:
  - "tools/**"
  - "compat/**"
  - ".github/**"
  - "package.json"
---

# Editing the tooling

- **Node 20+, ES modules, no build step.** Allowed dependencies: `playwright-core` (uses installed Chrome, never
  downloads browsers), `prettier`, `acorn` and `acorn-walk`. Ask before adding more. Shared code lives in `tools/lib/`
  (`common.mjs` for paths, targets, userscript discovery and output; `game.mjs` for the crawler; `browser.mjs` for
  Chrome, the shader recorder and `openGame`).
- **Exit codes and output are the interface.** Exit 0 means pass and 1 means problems. Use the `PASS/FAIL/WARN/KNOWN`
  markers, plus `annotate()` and `summary()` from `common.mjs`, so failures show on GitHub Actions run pages.
  `output()` sets step outputs for later workflow steps: `snapshot.mjs` sets `changed`/`from`/`build`, which the
  workflow's `notify` job turns into an issue.
- **What the snapshot captures:** `index.html`, its stylesheets, the whole ES-module graph, `engine.wasm`, and the
  JSON data files the game fetches by literal path (atlas layouts, sound events; `/api/` is excluded). Anything a
  script reads from the game's server must be in that list, or `npm run check` can't anchor on it. Extend the
  crawler in `lib/game.mjs` if a script starts depending on something else, and **bump `CRAWLER_VERSION`**
  there. The build id hashes every collected file, so without the bump the extra files would look like a game
  update (and open a CI issue); with it, the next snapshot becomes a quiet new baseline.
- **Snapshots fail loudly rather than save something partial.** A fetch error other than 404 aborts the crawl, and
  a failed shader capture discards the snapshot (`--no-browser` skips capture on purpose). Capture waits for the
  previous snapshot's program count. A partial snapshot would become the CI baseline and cause false results
  until the game next changes.
- **The version check** in `check.mjs` compares each userscript with the published commit: `--base`, else
  `TC_BASE_REF` (set by the workflow: the PR base or the pre-push commit), else `origin/main`. CI needs
  `fetch-depth: 0` for it.
- **`compat/expectations.mjs` entries:**
  - `source`: `{ script, file, test | exports, why }`. `file` is a snapshot path like `js/menus.js`, or
    `shaders:vs` / `shaders:fs` for the runtime GLSL. Prefer `shaders:*` for GLSL, because the game builds some
    lines from template pieces.
  - `runtime`: `{ script, name, run }`. `run` executes in the page and returns `true` or a reason string. `__tcwait(fn, ms)`
    is available. Checks that open menus must restore the screen (`menus.back()`) and go last.
  - `shaders`: `{ script, name, kind, stage, marker, min }`. `kind` comes from `labelProgram()`. `min` is the
    count observed when it worked, and includes programs the scripts add.
  - `known: 'reason'` marks a known bug: reported, but it doesn't fail the run. Remove it when fixed. The tools say
    when a known item starts passing.
- **The smoke harness emulates Tampermonkey.** It runs scripts only in frames matching `@match` (staging is mapped
  to the prod host), once `<html>` exists, wrapped with `GM_info` and shims for granted `GM_*` APIs. Keep it that
  way: injecting into every frame or before `<html>` produced false failures before.
- **Waiting for the game:** `openGame` waits until at least the vanilla program count from the latest snapshot is
  linked. The game links a second batch of programs a few seconds after the first.
- **Prove it catches breakage.** When you change a checker, verify it still fails on a broken input (edit a copy
  of a snapshot, or add a throwing temp userscript), then clean up.
