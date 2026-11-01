---
name: tweetcraft-game-update
description: Handle a Tweetcraft game update or anything red, such as a "Tweetcraft changed to build …" or "Upstream has new commits" GitHub issue, a failing "Game watch" GitHub Actions run, a failing npm run check or npm run smoke, a "codemap written against an older game build" warning, or a user report that a script stopped working after the game changed. Snapshot, read what changed, find which hooks broke, fix them, and update compat expectations and codemaps.
---

# The game changed (or a check is red)

## How you find out

- **"Tweetcraft changed to build `<id>`" issue:** opened by the `Game watch` workflow on main whenever the
  game's code changes, even when nothing breaks. It has the check and smoke results per target, the change
  report, and **the codemaps that mention changed files**. Close it once those maps are re-verified.
- **A red `Game watch` run:** GitHub emails the repo owner.
- **`npm run check` warns that a codemap is behind the latest build:** the game moved on since the map was verified.
- **"Upstream has new commits" issue:** AndresTube's original repo changed, and may contain its own fix for a
  game update. Run `git fetch upstream && git log --stat main..upstream/main`. Merge or cherry-pick what's
  useful (then `npm test`), or close the issue to dismiss it. This repo pushes as its own account: never touch
  git credentials to do this.

## 1. See what changed

```sh
npm run snapshot                    # prints changed/added/removed files, export changes, shader changes
npm run snapshot -- --target staging   # staging often gets the update first
```

- **The change report:** the export changes matter most, because scripts import game modules. Shader changes matter
  for the shader mod.
- **Line-level detail:** `game/prod/$(cat game/prod/LATEST)/changes.diff` (pretty JS, CSS and GLSL). For a CI run,
  the `report-<target>` artifact has `changes-<target>.diff`, `smoke-<target>.json` and the screenshot.
- **If nothing changed and it's still red:** look for flakiness or the environment (network, the game being down,
  Chrome changes). Re-run before "fixing" anything.

## 2. See what broke

```sh
npm run check     # static: which anchors/exports vanished (fast, offline)
npm run smoke     # live: which hooks didn't apply, which scripts threw, shader compile/link
```

Map each failure to its script and its `why` in `compat/expectations.mjs`. Then:
- **Anchor moved or reshaped** (most common): find the new form in `pretty/` or `shaders/`, using the old anchor's
  neighbourhood in `changes.diff`.
- **Export renamed or removed:** search `manifest.json` exports and `changes.diff` for the replacement.
- **Behaviour changed** (e.g. a new shader variant, a different screen): read the new code and decide whether the
  hook still makes sense. If it needs a redesign, ask the user.

For a big diff, delegate the investigation to the `game-code-explorer` agent: "In the new snapshot, what replaced X?"

## 3. Fix

- Fix the script with the narrowest change: a widened regex or a new anchor that still detects-then-patches.
  Keep fallbacks.
- Update `compat/expectations.mjs` to the new anchor, plus `min` counts in `shaders` if the program set changed
  (the smoke output shows the new counts).
- Re-run `npm test` until green. Check `reports/smoke-prod.png` looks right.
- Bump `@version` (patch) for each script you fixed.

## 4. Keep the knowledge current

- Update `.claude/codemap/game-*.md` (and `scripts.md`'s game references) for the files that changed. The
  snapshot output and the issue list which maps mention them. Then put the new build id in each map's header line.
  `npm run check` reads the first lines of each map for build ids, and warns until the latest one is there. If a
  section is now wrong and you can't verify it, delete it rather than leave it stale.
- If the game added something the scripts could use, note it in the relevant codemap's "Extension points".
- Summarise for the user: what changed in the game, what broke, what you fixed, and what needs an in-game check.
