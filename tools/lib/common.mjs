// Shared helpers for the repo tooling: paths, targets, userscript discovery, output.
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const GAME_DIR = join(ROOT, 'game');
export const REPORTS_DIR = join(ROOT, 'reports');

// Where the game is served. Staging is referenced by the game's own js/devhost.js and
// usually receives updates before production, so checking it gives early warning.
export const TARGETS = {
  prod: 'https://tweetcraft.jai.vin',
  staging: 'https://minecraft-jai-vin-staging.sojodex.workers.dev',
};

export function targetUrl(name) {
  const url = TARGETS[name];
  if (!url) throw new Error(`Unknown target "${name}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  return url;
}

export const sha256 = data => createHash('sha256').update(data).digest('hex');

export async function writeFileDeep(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}

// ---- userscripts -----------------------------------------------------------

const META_START = '// ==UserScript==';
const META_END = '// ==/UserScript==';

/** Parse a userscript metadata block into [key, value] pairs (keys keep their order). */
export function parseMeta(source) {
  const start = source.indexOf(META_START);
  const end = source.indexOf(META_END);
  if (start < 0 || end < start) return null;
  const entries = [];
  for (const line of source.slice(start + META_START.length, end).split(/\r?\n/)) {
    const m = line.match(/^\s*\/\/\s*@([\w:-]+)(?:\s+(.*?))?\s*$/);
    if (m) entries.push([m[1], m[2] ?? '']);
  }
  return {
    entries,
    get: key => entries.find(([k]) => k === key)?.[1],
    all: key => entries.filter(([k]) => k === key).map(([, v]) => v),
  };
}

/** Every .js file in the repo root that has a userscript metadata block. */
export async function listUserscripts() {
  const files = (await readdir(ROOT)).filter(f => f.endsWith('.js')).sort();
  const out = [];
  for (const file of files) {
    const source = await readFile(join(ROOT, file), 'utf8');
    const meta = parseMeta(source);
    if (meta) out.push({ file, path: join(ROOT, file), source, meta });
  }
  // Better Options provides the shared settings bus the others register with, so load it first
  // (Tampermonkey users typically order it first too; the others retry until it exists anyway).
  out.sort((a, b) => rank(a) - rank(b) || a.file.localeCompare(b.file));
  return out;
}
const rank = s => (/better-options/i.test(s.file) ? 0 : 1);

// ---- snapshots -------------------------------------------------------------

export const snapshotsDir = target => join(GAME_DIR, target);

/** Path of the most recent snapshot for a target, or null. */
export async function latestSnapshot(target) {
  const pointer = join(snapshotsDir(target), 'LATEST');
  if (!existsSync(pointer)) return null;
  const name = (await readFile(pointer, 'utf8')).trim();
  const dir = join(snapshotsDir(target), name);
  return existsSync(dir) ? dir : null;
}

// ---- output ----------------------------------------------------------------

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = code => s => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
export const c = { red: paint(31), green: paint(32), yellow: paint(33), dim: paint(2), bold: paint(1), cyan: paint(36) };
export const PASS = c.green('✔'), FAIL = c.red('✘'), WARN = c.yellow('!'), KNOWN = c.yellow('~');

/** In GitHub Actions, also emit an annotation so failures show on the run page. */
export function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS) console.log(`::${level}::${message.replace(/\r?\n/g, '%0A')}`);
}

/** In GitHub Actions, set step outputs (`steps.<id>.outputs.<key>`) for later workflow steps. */
export async function output(values) {
  if (!process.env.GITHUB_OUTPUT) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_OUTPUT, Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, ' ')}\n`).join(''));
}

/** In GitHub Actions, append markdown to the job summary shown on the run page. */
export async function summary(markdown) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const { appendFile } = await import('node:fs/promises');
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown.trimEnd() + '\n\n');
}
