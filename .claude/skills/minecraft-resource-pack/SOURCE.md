# Source

- Upstream: https://github.com/Jahrome907/minecraft-agent-skills/tree/22d61ce6b7a0c5f215008824aa6b94ecc73f2a43/.claude/skills/minecraft-resource-pack
- Pinned commit: `22d61ce6b7a0c5f215008824aa6b94ecc73f2a43`
- License: MIT (see `LICENSE` in this folder, copied from the upstream repository)
- Imported: 2026-11-01. Vetted by reading SKILL.md in full and scanning every included file for network calls,
  install commands, shell execution and prompt-injection phrasing (clean).
- Not included: `scripts/validate-resource-pack.sh` and `scripts/jq-shim.mjs` (a pack validator; we don't build resource packs).
- Local changes: a "Project notes (tweetcraft-scripts)" block at the top of SKILL.md, explaining how the skill
  applies to this repo; a sentence added to the `description` scoping it to the Minecraftizer; a note that the validator script is not installed. Everything else is unmodified.

Update by re-fetching the pinned path at a newer commit, then re-vetting the same way and re-adding the project notes.
