# Source

- Upstream: https://github.com/henkisdabro/wookstar-claude-plugins/tree/e0d5c508efc0c04904b917b324fc26a26ed7c0c2/plugins/tampermonkey/skills/tampermonkey
- Pinned commit: `e0d5c508efc0c04904b917b324fc26a26ed7c0c2`
- License: MIT (see `LICENSE` in this folder, copied from the upstream repository)
- Imported: 2026-11-01. Vetted by reading SKILL.md in full and scanning every included file for network calls,
  install commands, shell execution and prompt-injection phrasing (clean).
- Not included: nothing (SKILL.md and all 19 reference files are included).
- Local changes: a "Project notes (tweetcraft-scripts)" block at the top of SKILL.md, explaining how the skill
  applies to this repo; a sentence added to the `description` pointing script work to the `tweetcraft-*` skills; the upstream `allowed-tools: Read, Glob, Grep, Write, Edit` line removed (a vendored skill should not pre-approve file writes). Everything else is unmodified.

Update by re-fetching the pinned path at a newer commit, then re-vetting the same way and re-adding the project notes.
