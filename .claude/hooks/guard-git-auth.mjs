#!/usr/bin/env node
// PreToolUse hook (Bash, PowerShell): block commands that would change GitHub / git credentials or
// identity. This machine runs another project that relies on the global `gh` login, and this
// repo pushes through its own repo-local credential setup. Exit 2 = block and tell Claude why.
let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let cmd = '';
  try { cmd = String(JSON.parse(raw)?.tool_input?.command || ''); } catch { process.exit(0); }
  const reason = check(cmd);
  if (reason) {
    process.stderr.write(
      `Blocked by .claude/hooks/guard-git-auth.mjs: ${reason}\n` +
      'This repo is already set up to push with the right GitHub account, and another project on this ' +
      'machine depends on the global gh login. Do not change credentials or git identity. If this is ' +
      'really needed, stop and ask the user to do it themselves.\n');
    process.exit(2);
  }
  process.exit(0);
});

function check(cmd) {
  // Split on shell separators so each sub-command is checked on its own.
  for (const part of cmd.split(/&&|\|\||[;|\n]/)) {
    const c = part.trim().replace(/^["']|["']$/g, '');
    // gh / gh.exe, possibly quoted or with a full path
    if (/(^|[\\/\s"'&])gh(\.exe)?["']?\s+auth\s+(login|logout|switch|refresh|setup-git)\b/i.test(c)) {
      return 'gh auth login/logout/switch/refresh/setup-git changes the global GitHub login';
    }
    if (/\bgit(\.exe)?["']?\s+(?:-C\s+\S+\s+|-c\s+\S+\s+)*config\b/i.test(c)) {
      const readOnly = /\s--(get|get-all|get-regexp|get-urlmatch|list)\b|\s-l\b|\s--show-(origin|scope)\b/.test(c) && !/\s--(unset|add|replace-all|edit)\b|\s-e\b/.test(c);
      if (!readOnly && /\s--(global|system)\b/.test(c)) return 'writing global/system git config';
      if (!readOnly && /\s(credential\.|user\.|url\..*insteadof|include\.|includeif\.)/i.test(c) && /\s\S+\s+\S+/.test(c.replace(/.*\bconfig\b/i, ''))) {
        return 'changing git credential/identity config';
      }
    }
    if (/\bgit(\.exe)?["']?\s+credential-manager\s+(?:github\s+)?(logout|erase|unconfigure|configure)\b/i.test(c)) {
      return 'changing Git Credential Manager accounts/config';
    }
    if (/\bgit(\.exe)?["']?\s+credential\s+(reject|erase|approve|store)\b/i.test(c)) {
      return 'modifying stored git credentials';
    }
    if (/\bcmdkey(\.exe)?\s+\/(delete|add|generic)\b/i.test(c)) return 'modifying Windows Credential Manager';
  }
  return null;
}
