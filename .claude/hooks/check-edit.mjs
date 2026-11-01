#!/usr/bin/env node
// PostToolUse hook (Edit, Write, MultiEdit): fast validation right after a file changes.
//  - root userscripts (*.js with a // ==UserScript== block): metadata + classic-script syntax
//  - tools/ and compat/ modules (*.mjs): ES module syntax
// Exit 2 sends the problem back to Claude. Silent and exit 0 when fine or not applicable.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve, relative, sep } from 'node:path';
import vm from 'node:vm';

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => (raw += d));
process.stdin.on('end', () => {
  let file, root;
  try {
    const input = JSON.parse(raw);
    file = input?.tool_input?.file_path;
    root = process.env.CLAUDE_PROJECT_DIR || input?.cwd || process.cwd();
  } catch { process.exit(0); }
  if (!file || !existsSync(file)) process.exit(0);
  file = resolve(file);
  root = resolve(root);
  const rel = relative(root, file);
  if (rel.startsWith('..')) process.exit(0);

  const problems = [];
  if (dirname(file) === root && file.endsWith('.js')) {
    const src = readFileSync(file, 'utf8');
    if (src.includes('// ==UserScript==')) problems.push(...checkUserscript(src, rel));
  } else if (/^(tools|compat)\/.*\.mjs$/.test(rel.split(sep).join('/'))) {
    const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (r.status !== 0) problems.push(`syntax error:\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`);
  }

  if (problems.length) {
    process.stderr.write(`check-edit: ${rel} has problems:\n- ${problems.join('\n- ')}\n`);
    process.exit(2);
  }
  process.exit(0);
});

function checkUserscript(src, rel) {
  const out = [];
  const start = src.indexOf('// ==UserScript=='), end = src.indexOf('// ==/UserScript==');
  if (end < start) return ['metadata block is not closed with // ==/UserScript=='];
  const keys = new Set([...src.slice(start, end).matchAll(/^\s*\/\/\s*@([\w:-]+)/gm)].map(m => m[1]));
  for (const k of ['name', 'namespace', 'version', 'description', 'match', 'run-at', 'grant']) {
    if (!keys.has(k)) out.push(`missing @${k} in the metadata block`);
  }
  try {
    new vm.Script(src, { filename: rel });
  } catch (e) {
    const line = (e.stack || '').split('\n').find(l => l.includes(rel)) || '';
    out.push(`syntax error: ${e.message}${line ? ` (${line.trim()})` : ''}`);
  }
  return out;
}
