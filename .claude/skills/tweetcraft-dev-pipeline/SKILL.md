---
name: tweetcraft-dev-pipeline
description: The required workflow for any change to a Tweetcraft userscript (fix, feature, optimisation or refactor), "measure twice, cut once", run by default as a parallel team of subagents. Understand the exact game code and our code involved (research fanned out to parallel agents), specify the hooks as compat expectations first, split the work into one-owner-per-file workstreams and launch them as parallel subagents that message each other, implement defensively, verify with check/smoke/probe, get an independent review, then hand over for an in-game test. Use at the start of every script change, before editing code.
---

# Measure twice, cut once

Scripts hook code we don't own, and the game changes under us. They work every time only when each change is
grounded in verified facts about both codebases and proven by tests before it ships. Follow these phases in
order; scale the depth to the change, but don't skip a phase. Run them as a team (next section).

## Run it as a team (mandatory, always on)

Speed comes from parallel subagents. Quality comes from the phases, and those don't change. By default, every
non-trivial change runs as a team. Non-trivial means it touches more than one file or takes more than a few minutes.
A one-line fix doesn't need a team.

- **The lead (you):** plan, contracts, briefs, integration, the final `npm test` and the handover. Do work yourself
  only when it's a handful of tool calls.
- **Fan out research** in phase 1. Launch several `game-code-explorer` and Explore agents in one message, one
  question area each.
- **Split the work** after phase 2 into independent workstreams, and launch them as parallel subagents in one
  message. Give each a short team name (`SH`, `BO`, `COMPAT`, `CODEMAPS`). A typical split:
  - one agent per userscript being changed;
  - one owning `compat/expectations.mjs`;
  - one for codemaps and docs;
  - `game-code-explorer` and Explore agents for questions about the game;
  - `userscript-reviewer` at the end.
- **One owner per file.** No two agents edit the same file. Each brief names the files its agent owns and forbids
  touching any others.
- **Every brief stands alone.** It gives the goal, the files to read, the rules (hard rules, owned files, no
  commits) and how to verify. It also spells out the cross-agent contracts:
  - the script APIs: `window.Twitterentary` (`cfg`, `schema`, `state`) and the `window.__tcOptions` bus;
  - the DOM selectors and labels the compat checks rely on;
  - the game anchors from phase 2.
- **Teams talk.**
  - Agent IDs exist only after launch. So right after launching, send every agent a roster message, one
    `NAME = <agent ID>` per teammate, with the files each one owns.
  - Agents load SendMessage (ToolSearch `select:SendMessage`) and message each other directly about contracts. They
    keep working while they wait for an answer, and never idle.
  - The lead relays messages, and decides when owners disagree.
- **One working tree.** Agents share it, so `npm run check` and `npm test` also see teammates' unfinished files.
  - Judge only your own results, and report other failures to their owner.
  - Parallel smoke runs overwrite the same `reports/smoke-<target>.{json,png}`, so copy yours aside right after the
    run.
  - Don't use worktree isolation. `game/` and `node_modules/` are gitignored, so a worktree has no snapshot.
- **The gates don't move.**
  - Each agent verifies its own part: `npm run check`, `npm run smoke -- --only <script>`, and screenshots for UI
    or visuals.
  - Then the lead integrates: `userscript-reviewer` on the full diff, then `npm test`.
  - Speed never skips a phase.

## 1. Understand (measure)

- **Our side:** read the relevant section of `.claude/codemap/scripts.md`, then the actual functions in the script.
  Note every place the change touches, including hot paths and cross-script contracts (`window.__tcOptions`,
  `window.Twitterentary`, storage keys). These become the contracts in the team's briefs.
- **The game's side:**
  1. `npm run snapshot` (cheap if nothing changed).
  2. Read `.claude/codemap/game-*.md` for the area.
  3. Confirm the specifics in `game/prod/<LATEST>/pretty/` or `shaders/`.
  4. Fan wide searches out to parallel `game-code-explorer` agents, one question area each.
- **Live facts:** confirm assumptions with `npm run probe -- "<expr>"`. Exports, DOM after a menu opens and shader
  sources are all checkable in seconds. Don't build on a guess you could have checked.
- **The baseline:** run `npm test` before changing anything (in the background while the research agents work), so
  you know which failures are yours.

## 2. Specify (measure again)

Write down, before coding:
- **What the user will see** (the acceptance criteria).
- **Hooks:** for each game hook, the anchor, how it's detected, and what happens if it's missing (the fallback).
- **The checks that prove it applied.** The `compat/expectations.mjs` owner adds them before the code that depends
  on them:
  - a `source` anchor for each new dependency on game code (it should pass against today's snapshot);
  - a `runtime` check for each wrapper or registration;
  - a `shaders` marker and `min` for GLSL patches.
- **Performance budget**, for anything on a per-frame or per-draw path.
- **The team plan:** the workstreams, each one's owner and files, and the contracts between them. The contracts go
  into the briefs word for word.

For a non-trivial change, show this plan to the user before implementing. It's cheap to fix a plan.

## 3. Implement (cut)

- **Launch the workstreams** in one message, then send the roster. Each agent follows the rules below for its own
  files.
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

- **In a team,** each agent runs `check` and `smoke -- --only <script>` on its own part and reports the results.
  The lead runs `npm test` once every part is in.
- **Green means green.** No new failures, no new `console.error` from our scripts, and the expectations you
  added pass. If a test is wrong, fix the test with a written reason. Never weaken a check just to pass.
- **Look at `reports/smoke-prod.png`** for anything visual.
- **Prove the checks catch breakage.** For a new hook, temporarily break its anchor (in a copy of the snapshot,
  run `npm run check -- --snapshot <copy>`) and make sure the check fails.

## 5. Review

- The lead runs the `userscript-reviewer` agent on the full, integrated diff. It checks hook safety, fallbacks, hot
  paths, compatibility, metadata and version, and expectations coverage.
- Address its findings or explain why not. Send each finding to the agent that owns the file, through SendMessage
  (its context is intact), and fix it yourself only if that's a handful of tool calls.
- Then run `npm test` again. It is the final gate.

## 6. Hand over

- **Check the version and README:** confirm `@version` was bumped (`npm run check` enforces it) and update the
  README if users will see a difference.
- **Ask the user for an in-game test** via the dev loaders (`npm run dev`). Tell them exactly what to try
  (scenario, setting, where to look), because the automated run only covers the title-screen world in
  software rendering.
- **Update the codemaps** you used if anything in them turned out wrong or new (the codemaps owner does this, in a
  team).
- **Commit and push only when asked.** CI (`game-watch.yml`) re-verifies against prod and staging on push.
