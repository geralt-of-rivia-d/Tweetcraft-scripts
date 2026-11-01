# Hooks for this repo

Two small Node hooks guard agents working in this repo. Both are tested, but they are **not active until a person
adds them to `.claude/settings.json`**. Agents must not edit their own permissions or hooks.

| Hook | Event | What it does |
|---|---|---|
| `guard-git-auth.mjs` | PreToolUse (Bash, PowerShell) | Blocks commands that would change the GitHub or git login or identity: `gh auth login/logout/switch/refresh/setup-git`, global or system `git config` writes, `credential.*`/`user.*` config writes, GCM `logout`, `git credential reject/erase/...`, and `cmdkey /delete`. Read-only forms (`gh auth status`, `git config --get ...`) are allowed. |
| `check-edit.mjs` | PostToolUse (Edit, Write, MultiEdit) | After a root userscript is edited, checks its metadata block and classic-script syntax. After `tools/` or `compat/` `.mjs` edits, runs `node --check`. Problems go back to the agent (exit 2). |

To enable them, create `.claude/settings.json` with the following (or merge it in), then restart Claude Code or
review it in `/hooks`:

```json
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "allow": [
      "Bash(npm run snapshot)", "Bash(npm run snapshot *)",
      "Bash(npm run check)", "Bash(npm run check *)",
      "Bash(npm run smoke)", "Bash(npm run smoke *)",
      "Bash(npm run probe *)", "Bash(npm run dev)", "Bash(npm test)",
      "Bash(git status *)", "Bash(git diff *)", "Bash(git log *)", "Bash(git show *)"
    ],
    "deny": [
      "Bash(gh auth login *)", "Bash(gh auth logout *)", "Bash(gh auth switch *)",
      "Bash(gh auth refresh *)", "Bash(gh auth setup-git *)",
      "Bash(git config --global *)", "Bash(git config --system *)",
      "Edit(~/.gitconfig)", "Write(~/.gitconfig)"
    ]
  },
  "hooks": {
    "PreToolUse": [
      { "matcher": "Bash|PowerShell",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/guard-git-auth.mjs\"" }] }
    ],
    "PostToolUse": [
      { "matcher": "Edit|Write|MultiEdit",
        "hooks": [{ "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/.claude/hooks/check-edit.mjs\"" }] }
    ]
  }
}
```

The `deny` rules alone are not a hard guarantee, because they match command text and a full-path `gh.exe` slips
past. `guard-git-auth.mjs` catches those too.

Test a hook by piping it a sample event:

```sh
echo '{"tool_input":{"command":"gh auth login"}}' | node .claude/hooks/guard-git-auth.mjs; echo "exit $?"   # 2 = blocked
```
