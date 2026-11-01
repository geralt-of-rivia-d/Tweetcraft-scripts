# Source

- Upstream: https://github.com/gokayfem/shader-skills/tree/b19dcf95591fa60326739d780fe6fa746594fca3/skills/shader-art-coding
- Pinned commit: `b19dcf95591fa60326739d780fe6fa746594fca3`
- License: MIT (see `LICENSE` in this folder, copied from the upstream repository)
- Imported: 2026-11-01. Vetted by reading SKILL.md in full and scanning every included file for network calls,
  install commands, shell execution and prompt-injection phrasing (clean).
- Not included: `scripts/glsl_tools.py` (third-party executable; use `references/library-index.md` and `npm run smoke` instead), `templates/` (standalone Shadertoy art scenes), `agents/openai.yaml`.
- Local changes: a "Project notes (tweetcraft-scripts)" block at the top of SKILL.md, explaining how the skill
  applies to this repo; the `description` narrowed to a reference role (it no longer advertises the bundler/checker, and points script work to `tweetcraft-shaders`); workflow steps 3 and 6 say the upstream `glsl_tools.py` is not installed and what to use instead. Everything else is unmodified.

Update by re-fetching the pinned path at a newer commit, then re-vetting the same way and re-adding the project notes.
