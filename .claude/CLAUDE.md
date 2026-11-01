# Tweetcraft scripts

Tampermonkey userscripts that mod [Tweetcraft](https://tweetcraft.jai.vin), a browser block-building game
(WebGL2, about 100 unbundled ES modules), plus Node tooling that snapshots the game's code and tests the scripts
against the live game. Current focus: optimising the shaders, improving the UI, and keeping every script working
as the game updates.

## Hard rules

- **Never commit `game/`** or paste large chunks of it anywhere. It is the game developer's code, kept locally for
  reading and diffing only (gitignored).
- **Never change GitHub or git credentials.** This clone already pushes with the right account. Never run
  `gh auth login|switch|logout|refresh` or `git config --global ...`, and never edit the `credential.*` or `user.*`
  config of this repo. Another project on this machine depends on the global `gh` login.
  `.claude/hooks/guard-git-auth.mjs` blocks these once the user enables it (see `.claude/hooks/README.md`). Never
  edit `.claude/settings*.json` yourself. For GitHub API calls, ask the user first.
- **Hook the game defensively.** Detect, then patch. If the target isn't there, leave the game untouched and fall
  back to the original. A broken game is worse than a missing feature. Code inside the game's frame loop must
  never throw: `frame()` re-arms `requestAnimationFrame` first, so an exception silently skips rendering and
  network sends for every frame after it.
- **Client-side visuals and UX only, never anything that touches fair play or security.** Never touch, automate or
  hide the Turnstile challenge. Never alter the `hello` handshake or protocol version. Never forge or replay
  network traffic (dig, place, movement). Never read or send the `mc.tok`, `mc.admin` or `mc.key.*` secrets.
- **Every new or changed game hook gets an entry in `compat/expectations.mjs`.** That is how updates that break it
  get caught.
- Commit and push only when the user asks.

## Commands

| Command | What it does |
|---|---|
| `npm run snapshot` | Fetch the game into `game/prod/<time>-<build>/` (`raw/`, `pretty/`, `shaders/*.glsl`, `manifest.json`) and print what changed. No-op if unchanged. `-- --target staging` for staging. |
| `npm run check` | Offline: userscript metadata, syntax, README listing and the code-checkable hard rules (no `mc.tok`/`mc.admin`/`mc.key.*`, Turnstile, `WebSocket` or `/api/`; nothing in `game/` committed); **fails if a script changed since `origin/main` without a higher `@version`**, if a script was renamed or its `@name`/`@namespace` changed, or if a root `.js` file's metadata block doesn't parse; `compat` `source` anchors against the latest snapshot; warns when a codemap's build id is stale. |
| `npm run smoke` | Live: headless Chrome loads the game with the userscripts and checks `runtime` and `shaders` expectations. `-- --only <name>`, `--headed`, `--target staging`. Writes `reports/smoke-<target>.{json,png}`. |
| `npm test` | `check`, then `smoke`. Run it before calling any script change done. |
| `npm run dev` | Tampermonkey dev loaders in `dev/` that `@require` the working copy. |
| `npm run probe -- "<expr>"` | Evaluate an (async) expression in the live game and print JSON. `--scripts` loads our userscripts; `--programs` lists shader programs. |

There is no snapshot on a fresh clone: run `npm install && npm run snapshot` first.

## Where things are

- Userscripts are in the repo root (`*.js` with a `// ==UserScript==` block):
  - `twitterentary-shaders.user.js`: GLSL patching, shadows, waving plants, water, sky
  - `tweetcraft-better-options.js`: options menu and the shared settings bus `window.__tcOptions`
  - `tweetcraft-zoom.user.js`, `tweetcraft-chat-history.js`, `tweetcraft-minecraftizer.js` (texture swap)
- `compat/expectations.mjs`: what each script needs from the game
- `tools/`: snapshot, check, smoke and dev-loaders
- `.github/workflows/game-watch.yml`: runs everything daily, and on every push and PR, for prod and staging. When
  the game's build changes, it opens a "Tweetcraft changed to build …" issue (with the change report and the codemaps
  to re-verify). When AndresTube's original repo gets new commits, it opens an "Upstream has new commits" issue.
  Either issue means: follow `tweetcraft-game-update`.

## How we work: measure twice, cut once

Every script change follows the **`tweetcraft-dev-pipeline`** skill:
1. Understand our code and the game's code, using the codemaps, the snapshot and `npm run probe`.
2. Specify the hooks as `compat/expectations.mjs` entries before coding.
3. Implement defensively.
4. `npm test`.
5. `userscript-reviewer`.
6. Hand over for an in-game test.

Don't skip phases. Scale their depth to the change.

## Knowledge base

- `.claude/codemap/README.md`: repo layout, how the pieces relate, and **where new things belong**
- `.claude/codemap/scripts.md`: our five scripts, function by function, plus known issues
- `.claude/codemap/game-core.md`, `game-rendering.md`, `game-ui.md`: how the game works
- `game/prod/<LATEST>/MODULES.md`: generated map of all game modules, always matching the snapshot

## Skills and agents in this repo (use them)

- `tweetcraft-dev-pipeline`: the workflow for any script change (start here)
- `tweetcraft-game-code`: find how the game does something, read its modules and real GLSL, probe it live
- `tweetcraft-shaders`: any change to the shader script, GLSL patches or rendering performance
- `tweetcraft-ui`: menus, settings tabs, keybinds, HUD, matching the game's look
- `tweetcraft-new-userscript`: creating a new script end to end
- `tweetcraft-game-update`: the game changed, or check/smoke/CI is red
- Third-party reference skills (vetted, MIT; repo rules win on conflicts): `tampermonkey`, `webgl`,
  `shader-art-coding` (GLSL building blocks) and `minecraft-resource-pack`. See `.claude/skills/README.md`.
- Agent `game-code-explorer`: delegate "where/how does the game do X" questions so the 690 KB of game code
  stays out of your context
- Agent `userscript-reviewer`: review script changes before they ship

Path-scoped rules in `.claude/rules/` load automatically when you touch userscripts, tooling or `game/`.

## Shipping a change

1. `npm test` passes. Look at `reports/smoke-prod.png`, and for visual changes test in real Chrome through the dev
   loader too. SwiftShader in the test is not a real GPU.
2. Bump the script's `@version` (semver: fix = patch, feature = minor) as part of the change, once per change
   relative to `origin/main`. Installed copies only update when it increases, so `npm run check` fails until you
   do. Never rename a script file or change its `@name`/`@namespace`: installed copies would stop updating. Keep
   any in-code version string (`bus.version`, `debug()` output) in sync, or better, read `GM_info.script.version`.
3. Update the README script list if behaviour changed for users.
4. Commit and push only when asked, then mention the CI run.

## Known issues

`.claude/codemap/scripts.md` ("Issues & smells") lists more than 40 verified bugs and performance problems in the
current scripts, by function and line. Check it before changing a function, and remove an entry when you fix it.
Notable ones:
- `patchCloud()` never matches (double-escaped regexes), and its inserted `'\\n'` would break GLSL once the regexes
  are fixed. It's marked `known` in `compat/expectations.mjs`.
- Toggling the `shadows` setting live does nothing until a reload.
- Better Options scales the HUD hint and the tab player list twice when UI scale isn't 1 (#45).
- The shaders' K toggle ignores keybind capture.
- Zoom's default `KeyC` collides with the game's undo-preview confirm key.
