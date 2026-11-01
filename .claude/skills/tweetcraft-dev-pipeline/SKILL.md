---
name: tweetcraft-dev-pipeline
description: The required workflow for any change to a Tweetcraft userscript (fix, feature, optimisation or refactor), "measure twice, cut once". Understand the exact game code and our code involved, specify the hooks as compat expectations first, plan, implement defensively, verify with check/smoke/probe, get an independent review, then hand over for an in-game test. Use at the start of every script change, before editing code.
---

# Measure twice, cut once

Scripts hook code we don't own, and the game changes under us. They work every time only when each change is
grounded in verified facts about both codebases and proven by tests before it ships. Follow these phases in
order; scale the depth to the change, but don't skip a phase.

## 1. Understand (measure)

- **Our side:** read the relevant section of `.claude/codemap/scripts.md`, then the actual functions in the script.
  Note every place the change touches, including hot paths and cross-script contracts (`window.__tcOptions`,
  `window.Twitterentary`, storage keys).
- **The game's side:**
  1. `npm run snapshot` (cheap if nothing changed).
  2. Read `.claude/codemap/game-*.md` for the area.
  3. Confirm the specifics in `game/prod/<LATEST>/pretty/` or `shaders/`.
  4. Delegate wide searches to the `game-code-explorer` agent.
- **Live facts:** confirm assumptions with `npm run probe -- "<expr>"`. Exports, DOM after a menu opens and shader
  sources are all checkable in seconds. Don't build on a guess you could have checked.
- **The baseline:** run `npm test` before changing anything, so you know which failures are yours.

## 2. Specify (measure again)

Write down, before coding:
- **What the user will see** (the acceptance criteria).
- **Hooks:** for each game hook, the anchor, how it's detected, and what happens if it's missing (the fallback).
- **The checks that prove it applied.** Add them to `compat/expectations.mjs` now:
  - a `source` anchor for each new dependency on game code (it should pass against today's snapshot);
  - a `runtime` check for each wrapper or registration;
  - a `shaders` marker and `min` for GLSL patches.
- **Performance budget**, for anything on a per-frame or per-draw path.

For a non-trivial change, show this plan to the user before implementing. It's cheap to fix a plan.

## 3. Implement (cut)

- Smallest change that meets the spec, following `.claude/rules/userscripts.md`.
- **Detect, then patch:** keep originals and fall back on any error.
- No allocations or GL queries in hot paths.
- Keep public shapes backwards compatible (`Twitterentary.cfg`/`schema`, bus API, storage keys), or migrate them
  explicitly.
- **Bump `@version` now** (fix = patch, feature = minor; once per change relative to `origin/main`).
  `npm run check` fails for any script that differs from `origin/main` without a higher version, because
  installed copies would never get the change. Never rename the file or change `@name`/`@namespace`.

## 4. Verify

```sh
npm run check                                   # metadata, syntax, version bump, static anchors
npm run smoke -- --only <script>                # fast loop while iterating
npm test                                        # everything together: catches cross-script interactions
npm run probe -- --scripts "<expr>"             # inspect resulting state
```

- **Green means green.** No new failures, no new `console.error` from our scripts, and the expectations you
  added pass. If a test is wrong, fix the test with a written reason. Never weaken a check just to pass.
- **Look at `reports/smoke-prod.png`** for anything visual.
- **Prove the checks catch breakage.** For a new hook, temporarily break its anchor (in a copy of the snapshot,
  run `npm run check -- --snapshot <copy>`) and make sure the check fails.

## 5. Review

- Run the `userscript-reviewer` agent on the diff. It checks hook safety, fallbacks, hot paths, compatibility,
  metadata and version, and expectations coverage.
- Address its findings or explain why not.

## 6. Hand over

- **Check the version and README:** confirm `@version` was bumped (`npm run check` enforces it) and update the
  README if users will see a difference.
- **Ask the user for an in-game test** via the dev loaders (`npm run dev`). Tell them exactly what to try
  (scenario, setting, where to look), because the automated run only covers the title-screen world in
  software rendering.
- **Update the codemaps** you used if anything in them turned out wrong or new.
- **Commit and push only when asked.** CI (`game-watch.yml`) re-verifies against prod and staging on push.
