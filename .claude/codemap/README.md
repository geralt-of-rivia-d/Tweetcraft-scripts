# Codemap

How this repo is laid out, how the pieces relate, and where new things go. Detailed maps:

| Map | Covers |
|---|---|
| [scripts.md](scripts.md) | Our five userscripts, function by function: hooks, globals, storage, cross-script contracts, known issues |
| [game-core.md](game-core.md) | The game: modules, boot sequence, main loop, state, world data, networking, storage keys |
| [game-rendering.md](game-rendering.md) | The game's WebGL2 renderer: frame passes, the 18 shader programs, chunk meshes, lighting, texture units |
| [game-ui.md](game-ui.md) | The game's screens and menus, CSS units and font, canvas HUD, input and keys |

The maps name the game build they were verified against in their first lines. `npm run check` warns when that isn't
the latest snapshot's build. `npm run snapshot` (and the CI issue) lists which maps mention the files that changed.
Re-verify those sections (see the `tweetcraft-game-update` skill), then update the build id. Code beats maps: if
they disagree, fix the map.

## Repo layout

```
.
├── *.js                         userscripts (one self-contained file each, repo root; new ones: *.user.js)
│   ├── twitterentary-shaders.user.js   WebGL2/GLSL patching: shadows, waving plants, water, sky
│   ├── tweetcraft-better-options.js    options menu + settings bus window.__tcOptions + HUD/UI scale
│   ├── tweetcraft-zoom.user.js         hold-to-zoom (FOV via Better Options' fov API)
│   └── tweetcraft-chat-history.js      Up/Down chat recall
├── compat/expectations.mjs      what every script needs from the game (source / runtime / shaders checks)
├── tools/                       Node tooling (no build step)
│   ├── snapshot.mjs             fetch game → game/<target>/<time>-<build>/ + change report
│   ├── check.mjs                metadata/syntax + `source` expectations vs latest snapshot (offline)
│   ├── smoke.mjs                live game in headless Chrome + `runtime`/`shaders` expectations
│   ├── probe.mjs                evaluate an expression in the live game, print JSON
│   ├── dev-loaders.mjs          Tampermonkey dev loaders → dev/
│   └── lib/
│       ├── common.mjs           paths, TARGETS (prod/staging), userscript discovery + metadata parsing, output
│       ├── game.mjs             crawler: HTML/CSS/ES-module graph, acorn import/export analysis
│       ├── browser.mjs          Chrome launch (SwiftShader), shader-program recorder, openGame, labelProgram
│       └── userscript-env.mjs   Tampermonkey emulation (frames/@match, document-start timing, GM_* shims)
├── .github/workflows/game-watch.yml   daily + push/PR: snapshot → check → smoke for prod and staging;
│                                      notify: issue per new game build; upstream: issue on new AndresTube commits
├── .claude/                     agent instructions: CLAUDE.md, rules/, skills/, agents/, hooks/, codemap/
├── README.md                    user-facing: scripts list + development quick start
├── game/      (gitignored)      local snapshots of the game's code; never commit
├── reports/   (gitignored)      smoke JSON + screenshots, change reports (changes-<target>.md/.diff)
└── dev/       (gitignored)      generated Tampermonkey dev loaders
```

## How the pieces relate

```
              ┌──────────────────── tweetcraft.jai.vin (prod) / staging ────────────────────┐
              │  index.html → /js/main.js → ~100 ES modules (gfx.js, menus.js, ui.js, ...)   │
              └───────▲───────────────────────▲──────────────────────────────▲──────────────┘
     fetch HTML/CSS/JS│        headless Chrome │ (userscripts injected)       │ Tampermonkey (real use)
                      │                        │                              │
   tools/snapshot.mjs ┘        tools/smoke.mjs ┤ tools/probe.mjs              │  *.js userscripts
          │                            │       │                              │   (dev/ loaders @require them)
          ▼                            ▼       ▼                              │
   game/<target>/<snap>/   compat/expectations.mjs  ◄── tools/check.mjs ──────┘ (metadata + syntax)
   raw/ pretty/ shaders/     source  → check.mjs (vs snapshot)
   manifest.json             runtime → smoke.mjs (in page)
   changes.diff              shaders → smoke.mjs (linked programs)
```

Runtime contracts between the scripts:
- `window.__tcOptions` (Better Options) is used by zoom (keybind, settings tab, `fov`), by any new script's
  settings, and by the `tc.options` storage.
- `window.Twitterentary` (shaders) has `cfg` and `schema`, which Better Options' Shaders tab reads, plus
  `tc.shader.<key>` storage.
- Game-owned storage `mc.fov` and `mc.rd` is read by Better Options and zoom.

## Where things belong

| You're adding... | Put it in | Also update |
|---|---|---|
| A new player-facing feature with its own on/off | new `tweetcraft-<name>.user.js` (template in `skills/tweetcraft-new-userscript/`) | README scripts list, `compat/expectations.mjs`, `codemap/scripts.md` |
| A rendering or GLSL effect | `twitterentary-shaders.user.js` (CFG + SCHEMA + uniform + patch) | `shaders` expectations (`min`), `codemap/scripts.md` |
| A setting or UI for any script | that script, registered via `window.__tcOptions.register` | |
| A new game hook (any script) | the script | `compat/expectations.mjs` entry (required) |
| Shared tooling logic | `tools/lib/*.mjs` | `.claude/rules/tooling.md` if it changes conventions |
| A new tooling command | `tools/<name>.mjs` + `package.json` script | `.claude/CLAUDE.md` commands table, README |
| Knowledge about the game | `.claude/codemap/game-*.md` | the build id in its header |
| A repeatable agent workflow | `.claude/skills/<name>/SKILL.md` | `.claude/CLAUDE.md` skills list |
| A rule tied to certain files | `.claude/rules/<topic>.md` with `paths:` | |
| Anything from the game's source | nowhere: reference it by path and name | |
