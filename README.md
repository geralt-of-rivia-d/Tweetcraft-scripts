# tweetcraft-scripts

A collection of userscripts for [TweetCraft](https://tweetcraft.jai.vin). Install them with a userscript manager such as Tampermonkey or Violentmonkey.

## Scripts

- **Twitterentary shaders** - Adds shader-style lighting, sun shadows, waving plants, realistic water (see-through near you, reflective at a distance) and a dynamic sky. Pick a Quality and a Look preset or fine-tune each setting. Every change applies instantly, with no reload, and K switches the shaders on and off.
- **Tweetcraft Zoom** - Hold a key to zoom in and adjust your FOV for a closer look.
- **Tweetcraft Better Options** - Adds a custom options menu for graphics, interface, keybinds, shaders, and zoom settings, with "Reset shaders" and "Reset all options" buttons and a shortcut to the game's own options (music, language and more). Works in every game language.
- **Tweetcraft Chat History** - Minecraft-style chat history: press Up and Down to recall previously sent messages and commands.

## Notes

- Every script runs only on `https://tweetcraft.jai.vin/*`.
- **Tweetcraft Better Options** replaces the game's Options screen. The other scripts expose their settings through it (shaders, zoom, keybinds), so install it alongside them for full configuration.
- **Shader presets:** open Options, then Shaders.
  - **Quality** (Low, Medium, High, Ultra) trades shadow detail for speed. Low turns sun shadows off.
  - **Look** (Natural, Vivid, Soft) sets the light and colour.
  - The two combine freely. The default is Medium + Natural.
  - A picker shows "Custom" once you change one of its settings yourself.
  - Press K in game to turn the shaders on or off. The choice is saved.

## Development

Requires Node 20+ and Google Chrome.

```sh
npm install
npm run snapshot   # save the current game code locally (game/, never committed) and show what changed
npm test           # static checks + a live smoke test of every script in headless Chrome
npm run dev        # generate Tampermonkey loaders that run your local files (follow the printed setup)
npm run probe -- "Object.keys(await import('/js/menus.js'))"   # evaluate code inside the live game
```

- **Editing:** after the one-time `npm run dev` setup, save a script and reload the game tab. There's no need to paste anything into Tampermonkey.
- **When Tweetcraft updates:** `npm run snapshot` lists what changed, including the game's JS, module exports and shaders. `npm test` then shows which script hooks broke.
- **What scripts rely on:** `compat/expectations.mjs` lists every game hook each script uses. Add entries when you add a hook, so updates that break it get caught.
- **Automatic checks:** a GitHub Actions workflow (`.github/workflows/game-watch.yml`) runs the same checks daily against the live game and its staging server, and on every push and pull request. A run fails, and GitHub emails you, when an update breaks a script. Whenever the game's code changes, even harmlessly, the workflow opens a "Tweetcraft changed to build …" issue with the change report. When the original repo (AndresTube/tweetcraft-scripts) gets new commits, it opens an "Upstream has new commits" issue.
- **Releasing a change:** bump the script's `@version`. Tampermonkey only updates installed copies when it increases, and `npm run check` fails until you do. Never rename a script file or change its `@name`/`@namespace`, because installed copies would stop updating.
- **Agent and contributor docs:** see `.claude/`.
  - `CLAUDE.md`: conventions, commands, hard rules.
  - `codemap/`: how our scripts and the game work, and where things belong.
  - `skills/`: step-by-step workflows.
  - `agents/`, `rules/`, `hooks/`.
