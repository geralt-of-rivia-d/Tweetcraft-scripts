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
  Chrome, the shader recorder and `openGame`; `gpu-lock.mjs` for the real-GPU lock; `bench-*.mjs` for bench
  helpers; `github.mjs` for the GitHub REST API).
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
  - `shaders`: `{ script, name, kind, stage, marker, min, max? }`. `kind` comes from `labelProgram()`. `min` is
    the count observed when it worked, and includes programs the scripts add. Optional `max`: the marker may appear
    in at most that many programs (`hit <= max`); `max: 0` forbids it, as the "no flat varying" entries do. An entry
    needs at least one of the two: smoke fails one with neither `min` nor `max`, and a max-only entry whose
    program pool is empty (it would pass without checking anything).
  - `known: 'reason'` marks a known bug: reported, but it doesn't fail the run. Remove it when fixed. The tools say
    when a known item starts passing.
- **The smoke harness emulates Tampermonkey.** It runs scripts only in frames matching `@match` (staging is mapped
  to the prod host), once `<html>` exists, wrapped with `GM_info` and shims for granted `GM_*` APIs. Keep it that
  way: injecting into every frame or before `<html>` produced false failures before.
- **Waiting for the game:** `openGame` waits until at least the vanilla program count from the latest snapshot is
  linked. The game links a second batch of programs a few seconds after the first.
- **Bench reports are a long-lived format.** `reports/bench-*.json` (`{env, rows[]}`) are read back by `--from`,
  `--compare`, `bench:history` and the machine profile, including reports from older bench versions. Add fields
  freely, but never rename, remove or change the meaning of an existing one; treat a missing field as the old
  behaviour (e.g. no `env.rd` means rd 8 / FOV 70, no `env.vsync` means uncapped, no `env.protocol` means a
  legacy run). Existing flags keep their meaning, and without `--protocol` every default stays the legacy one, so
  old commands measure exactly as before. Verdicts (holds 60) live in `lib/bench-report.mjs`, shared by the bench
  and `bench:history`: change them there only.
- **`tools/lib/machine-profile.json` is data, not code.** It is regenerated from `reports/bench-*.json` (see
  `.claude/codemap/machine-profile.md`), never hand-tuned to make a result look right. Every number names its
  source report, and a value with no source is `null`. The bench reads it for `--protocol` and `--preflight`, and
  must still run (on built-in fallbacks, with a note) when it is missing or for another machine (`machine.gpu` doesn't match `env.gpu`).
- **GitHub from tooling:** REST calls go through `tools/lib/github.mjs` with `fetch`, and it allows only `GET`.
  Writes are plain `git push` to `ci/*` refs. The token comes from this repo's Git Credential Manager (`git
  credential fill` run inside the repo) per command, is held in memory only, is sent only to api.github.com, and
  is never printed, logged, passed on a command line or written to a file. Never run `gh auth *` or change git config or credentials (a hard rule:
  another project depends on the global `gh` login).
- **`ci/*` branches are throwaway.** `tools/cloud.mjs` pushes the working tree there from a temporary index
  (`GIT_INDEX_FILE`), never the real index, files or main, and deletes the branch after the run unless `--keep`.
  The `ci/*` commit's message tells `game-watch.yml` which target and steps to run, so a workflow change that
  reads it must keep `cloud.mjs` in step.
  Nothing may depend on a `ci/*` branch existing: `cloud status --prune` deletes any older than a day, so never
  push work you care about there. Each run gets its own timestamped branch, and the workflow's concurrency group
  cancels only older runs of the same branch. The `notify` job runs only on main and `upstream` never on `ci/*`,
  so cloud runs never open issues; keep it that way. They restore the snapshot cache but never save it, and check
  versions against `origin/main` (`TC_BASE_REF`), as local check does.
- **Prove it catches breakage.** When you change a checker, verify it still fails on a broken input (edit a copy
  of a snapshot, or add a throwing temp userscript), then clean up.
