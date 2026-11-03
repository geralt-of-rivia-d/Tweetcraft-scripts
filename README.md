# tweetcraft-scripts

A collection of userscripts for [TweetCraft](https://tweetcraft.jai.vin). Install them with a userscript manager such as Tampermonkey or Violentmonkey.

## Scripts

- **Twitterentary shaders** - Adds shader-style lighting, sun shadows, waving plants, realistic water (see-through near you, reflective at a distance) and a dynamic sky. Pick a Quality and a Look preset or fine-tune each setting. An automatic render scale keeps the frame rate smooth by lowering the 3D view's resolution in heavy scenes, while the HUD and menus stay sharp. Every change applies instantly, with no reload, and K switches the shaders on and off.
- **Tweetcraft Zoom** - Hold a key to zoom in and adjust your FOV for a closer look.
- **Tweetcraft Better Options** - Adds a custom options menu for graphics, interface, keybinds, shaders, and zoom settings, with "Reset shaders" and "Reset all options" buttons and a shortcut to the game's own options (music, language and more). It also adds a performance overlay (F2) and an in-game benchmark. Works in every game language.
- **Tweetcraft Chat History** - Minecraft-style chat history: press Up and Down to recall previously sent messages and commands.

## Notes

- Every script runs only on `https://tweetcraft.jai.vin/*`.
- **Tweetcraft Better Options** replaces the game's Options screen. The other scripts expose their settings through it (shaders, zoom, keybinds), so install it alongside them for full configuration.
- **Shader presets:** open Options, then Shaders.
  - **Quality** (Low, Medium, High, Ultra) trades shadow detail for speed. Low turns sun shadows off. Since 1.5.0, High and Ultra draw a sharp shadow map close to you plus a wider one for the distance, which looks crisper than 1.4.0's single big map and costs less.
  - **Look** (Natural, Vivid, Soft) sets the light and colour.
  - The two combine freely. The default is Medium + Natural.
  - A picker shows "Custom" once you change one of its settings yourself.
  - Press K in game to turn the shaders on or off. The choice is saved.
  - **Upgrading from 1.4.0:** if you used High or Ultra unchanged, it's switched to the new 2048 shadow resolution once, so it shows High or Ultra again instead of "Custom". Settings you changed yourself are kept.
- **Performance settings** (Options, then Shaders, then Performance):
  - **Render scale:** Auto (the default), or a fixed 100% down to 50%.
    - Auto watches how long each frame takes. When the graphics card can't keep 60 FPS (or the display's own rate when it runs slower, for example 30 FPS with Chrome's Energy Saver on), it draws the 3D world at a lower resolution, then raises it again once there is headroom. Since 1.5.0 it lowers the resolution only where that actually saves time, so it keeps full resolution much more often (on our test laptop, High now stays at 100%).
    - **What it trades:** in heavy scenes the world looks a little softer, in exchange for a steadier frame rate. The HUD, chat, text and menus are always drawn at full resolution.
    - It can't help when the processor is the bottleneck, for example while new terrain loads. The overlay shows "CPU-bound" then.
  - **Auto: lowest scale** (0.5-1, default 0.6, meaning 60%) is as far down as Auto goes. Raise it if the picture gets too soft; lower it on a slow machine.
  - **Upscale sharpening** (0-1, default 0.5) sharpens the lower-resolution image as it's scaled up to the screen. Higher looks crisper but can add halos.
  - Every Quality preset uses Auto with these defaults. Changing one of them makes the Quality picker show "Custom".
- **Performance overlay** (Better Options): press **F2** in game, or turn on "Performance overlay" in Options, then Graphics. Rebind the key in the Keybinds tab.
  - It shows FPS and frame time, CPU and GPU time per frame (GPU shows "n/a" when the browser has no GPU timer), the current render scale (Auto or Fixed), a "CPU-bound" marker, and how often sun shadows are redrawn per minute.
  - It sits below the game's top-right buttons (or in the corner while the HUD is hidden), clear of the game's F3 debug text.
- **In-game benchmark** (Better Options): Options, then Shaders, then **Run benchmark**.
  - It measures, where you stand, your current settings, shaders off, and the Low, Medium, High and Ultra presets, in about a minute. Don't move while it runs.
  - **Escape stops it.** Leaving fullscreen or resizing the window stops it too, because the numbers would no longer compare. The rows finished so far are kept and marked as a stopped run.
  - Your settings are restored afterwards, also when you stop it. The results stay in the Shaders tab, and **Copy results** copies them as a table you can paste into a bug report or a chat.

## Development

Requires Node 20+ and Google Chrome.

```sh
npm install
npm run snapshot   # save the current game code locally (game/, never committed) and show what changed
npm test           # static checks + a live smoke test of every script in headless Chrome
npm run dev        # generate Tampermonkey loaders that run your local files (follow the printed setup)
npm run probe -- "Object.keys(await import('/js/menus.js'))"   # evaluate code inside the live game
npm run bench      # benchmark the scripts on this machine's real GPU (opens a visible Chrome window)
```

- **Editing:** after the one-time `npm run dev` setup, save a script and reload the game tab. There's no need to paste anything into Tampermonkey.
- **When Tweetcraft updates:** `npm run snapshot` lists what changed, including the game's JS, module exports and shaders. `npm test` then shows which script hooks broke.
- **Benchmarking:** `npm run bench` runs each scenario (by default `vanilla,off,low,medium,high,ultra`) in a fresh 1920×1080 Chrome with no frame cap, at render distance 12 and FOV 80 (`--rd`, `--fov` and `--held-light on|off` change that; a single row can use `@rd=8`, `@fov=110` or `@heldLight=off`). It prints FPS, frame times (median, 95th percentile, 1% low), JS and GPU time, and saves `reports/bench-<label>.json`.
  - **"Holds 60"** is the pass mark: a median frame time of at most 14 ms, and a 95th percentile of at most 16.7 ms with CPU spikes (loading terrain, for example) left out. The `p95gb` and `spk%` columns show that percentile and the share of spike frames.
  - Every scenario is measured from the same title-screen view: measuring starts when the slowly turning title camera reaches `--at` seconds (default 40). `--size 2560x1440` changes the window size.
  - `--ref origin/main` measures the published scripts, and `--compare <json>` prints the differences. `--from <json>` reprints a saved report (with `--compare`) without running anything.
  - `--scenarios high+renderScale=1,ultra-moving` sets individual settings. `-moving` emulates flying at about 11 blocks/s and `-sprint` sprint-flying at 22 (for the shadow redraws only; the title camera itself doesn't move); `-stress` forces a shadow redraw every 4 frames, a worst case only.
  - `--repeat 3 --cooldown 60` runs three passes after a cool-down, and flags passes where the machine itself slowed down (heat). Use it before deciding anything.
  - Only one real-GPU run happens at a time, and smoke tests wait for it. Close other heavy programs first, because the numbers are only as quiet as the machine.
- **What scripts rely on:** `compat/expectations.mjs` lists every game hook each script uses. Add entries when you add a hook, so updates that break it get caught.
- **Automatic checks:** a GitHub Actions workflow (`.github/workflows/game-watch.yml`) runs the same checks daily against the live game and its staging server, and on every push and pull request. A run fails, and GitHub emails you, when an update breaks a script. Whenever the game's code changes, even harmlessly, the workflow opens a "Tweetcraft changed to build …" issue with the change report. When the original repo (AndresTube/tweetcraft-scripts) gets new commits, it opens an "Upstream has new commits" issue.
- **Releasing a change:** bump the script's `@version`. Tampermonkey only updates installed copies when it increases, and `npm run check` fails until you do. Never rename a script file or change its `@name`/`@namespace`, because installed copies would stop updating.
- **Agent and contributor docs:** see `.claude/`.
  - `CLAUDE.md`: conventions, commands, hard rules.
  - `codemap/`: how our scripts and the game work, and where things belong.
  - `skills/`: step-by-step workflows.
  - `agents/`, `rules/`, `hooks/`.
