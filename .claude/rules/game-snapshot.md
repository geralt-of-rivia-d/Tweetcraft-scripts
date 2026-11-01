---
paths:
  - "game/**"
---

# Reading the game snapshot

- **`game/` is read-only reference material:** the Tweetcraft developer's code, fetched by `npm run snapshot`. Never
  edit it, never commit it, and never copy more than a few lines of it into the repo (in a comment, when an anchor
  needs explaining).
- **Read `pretty/`.** `raw/` is the minified original that the `source` checks run against. GLSL is in `shaders/`
  (`NN-<label>.vert.glsl` / `.frag.glsl`, with uniforms listed in `shaders/index.json`), captured exactly as the game
  compiled it.
- **The latest snapshot is `game/<target>/$(cat game/<target>/LATEST)/`.**
  - `MODULES.md` is the generated module map: exports, imports, importers.
  - `manifest.json` has the build id, file hashes, exports and the import `graph`.
  - `changes.diff` shows what changed since the previous snapshot.
- **Find code by stable names.** Exported names, class and method names, string literals (button labels,
  `aria-label`s, localStorage keys `mc.*`, asset paths `/assets/...`) and GLSL uniform names survive minification.
  Local variable names don't.
- **For broad questions, delegate.** "Where does the game do X?" across many files goes to the
  `game-code-explorer` agent.
