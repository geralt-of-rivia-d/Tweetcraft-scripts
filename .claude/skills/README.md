# Skills in this repo

Claude Code loads a skill when its description matches the task. You can also invoke one with `/<name>`.

## Project skills (written for this repo)

| Skill | Use it for |
|---|---|
| `tweetcraft-dev-pipeline` | **Any change to a userscript.** The measure-twice-cut-once workflow. Start here. |
| `tweetcraft-game-code` | Finding how the game does something: snapshot, module map, real GLSL, live probing |
| `tweetcraft-shaders` | The shader mod: GLSL patches, new effects or settings, compile errors, GPU/CPU performance |
| `tweetcraft-ui` | Menus, settings tabs, keybinds, HUD, a native look and feel |
| `tweetcraft-new-userscript` | Creating a new script end to end (includes `template.user.js`) |
| `tweetcraft-game-update` | The game changed, or check, smoke or CI is red |

## Third-party reference skills (vetted, MIT)

Each folder has a `SOURCE.md` (upstream URL, pinned commit, what was left out) and its `LICENSE`. A "Project
notes" block at the top of each SKILL.md says how it applies here. Where one disagrees with our rules, the repo's
rules win.

| Skill | Upstream | Useful for |
|---|---|---|
| `tampermonkey` | henkisdabro/wookstar-claude-plugins | Userscript headers, sandbox modes, `@run-at`, CSP, common pitfalls, debugging |
| `webgl` | shreyam1008/shre-skills | WebGL2 cost model and performance checklist |
| `shader-art-coding` | gokayfem/shader-skills | Tested GLSL ES 3.00 functions (noise, PCG hash, sky, water optics, tonemapping) and technique references |

## Considered but not installed (2026-11-01 search)

- **No license**, so ideas only and nothing copied:
  - `webgl-dropped-draw-audit` (vibegameengine/web-starter-kit): count `getError` after draws in a Playwright
    init script to catch silently dropped draws. A good future addition to `npm run smoke`.
  - `realtime-shadows` (rustcircle/c101): shadow bias, PCF with a Vogel disk and interleaved gradient noise,
    cascades, PCSS.
  - `web-shader-extractor` (lixiaolin94/skills).
- **License or fit issues:**
  - `testing-and-benchmarking` (GPL-3.0): good GPU A/B benchmarking method (timer queries, A/A noise floor). Its
    key points are already in `tweetcraft-shaders`.
  - `shader-dev` (MiniMax-AI, MIT): 1.4 MB of Shadertoy techniques that overlap `shader-art-coding`.
  - `develop-web-game` (openai/skills): removed upstream; covered by our smoke and probe tools.
  - `wakaru` and `ast-grep`: need extra CLIs. Our `pretty/` snapshots and `MODULES.md` cover reading the game.
- **Off-target:** Minecraft modding, server or datapack skills (Java/Bedrock gameplay); Three.js-specific shader
  skills; generic Playwright and web-vitals skills; game-UI persona skills.
- **Warning:** WebGL code searches surface deliberately malicious "skills" (malware benchmark datasets such as
  lxyeternal/MalSkillBench). Only install skills after reading every file, from the upstream source, with a license.
