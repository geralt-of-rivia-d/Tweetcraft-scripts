#!/usr/bin/env node
// Static checks (offline, a few seconds):
//   1. every userscript has a complete metadata block, parses as a classic script, is listed in the README,
//      and breaks none of the code-checkable hard rules (no login secrets, Turnstile, WebSocket or /api/);
//      nothing under game/, dev/ or reports/ is committed
//   2. every userscript changed since the published version (origin/main) has a higher @version, and none
//      was renamed or changed @name/@namespace (installed copies would silently stop updating)
//   3. every game hook listed in compat/expectations.mjs (`source`) still exists in the snapshot
//   4. the game codemaps were verified against the latest snapshot's build (warning only)
//
//   npm run check                          # against the latest production snapshot
//   npm run check -- --target staging
//   npm run check -- --snapshot game/prod/<dir>
//   npm run check -- --base <git ref>      # compare versions against this ref (default: origin/main;
//                                          # CI passes the PR base or the pre-push commit via TC_BASE_REF)
import { parseArgs } from 'node:util';
import { readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { ROOT, listUserscripts, latestSnapshot, parseMeta, c, PASS, FAIL, WARN, KNOWN, annotate } from './lib/common.mjs';
import { source as expectations } from '../compat/expectations.mjs';

const { values: opts } = parseArgs({
  options: { target: { type: 'string', default: 'prod' }, snapshot: { type: 'string' }, base: { type: 'string' } },
});

let failures = 0;
const fail = (msg, detail = '') => { failures++; console.log(`  ${FAIL} ${msg}${detail ? c.dim(`  ${detail}`) : ''}`); annotate('error', `${msg} ${detail}`); };
const pass = (msg, detail = '') => console.log(`  ${PASS} ${msg}${detail ? c.dim(`  ${detail}`) : ''}`);
const warn = (msg, detail = '') => { console.log(`  ${WARN} ${msg}${detail ? c.dim(`  ${detail}`) : ''}`); annotate('warning', `${msg} ${detail}`); };

const git = (...args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const scripts = await listUserscripts();

// ---- 1. metadata + syntax ---------------------------------------------------
console.log(c.bold('\nUserscripts'));
const REQUIRED = ['name', 'namespace', 'version', 'description', 'match', 'run-at', 'grant'];
const GAME_URL = 'https://tweetcraft.jai.vin/';
const matchToRegex = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$');
const names = new Map();
for (const s of scripts) {
  const problems = [];
  for (const key of REQUIRED) if (!s.meta.all(key).length) problems.push(`missing @${key}`);
  const version = s.meta.get('version');
  if (version && !/^\d+(\.\d+){1,3}([-+][\w.]+)?$/.test(version)) problems.push(`@version "${version}" is not like 1.2.3`);
  const matches = s.meta.all('match');
  if (matches.length && !matches.some(m => matchToRegex(m).test(GAME_URL))) problems.push(`no @match covers ${GAME_URL}`);
  const name = s.meta.get('name');
  if (names.has(name)) problems.push(`@name "${name}" is also used by ${names.get(name)}`);
  names.set(name, s.file);
  try {
    new vm.Script(s.source, { filename: s.file }); // compile only, like a userscript manager would
  } catch (e) {
    problems.push(`syntax error: ${e.message}`);
  }
  if (problems.length) fail(s.file, problems.join('; '));
  else pass(`${s.file}`, `${name} v${version}`);
  if (!s.file.endsWith('.user.js')) console.log(c.dim(`      note: new scripts should be *.user.js (Tampermonkey offers to install those from a raw URL); don't rename existing ones`));
}
// A typo in the // ==UserScript== lines makes a script invisible to every check and to the smoke test, so
// every .js file in the root must be a userscript with a parseable block.
for (const f of (await readdir(ROOT)).filter(f => f.endsWith('.js') && !scripts.some(s => s.file === f))) {
  fail(`${f}: no parseable metadata block`, 'it needs "// ==UserScript==" ... "// ==/UserScript==" lines exactly; until then no check or smoke test covers it');
}

// Hard rules from .claude/CLAUDE.md that code can be checked for: client-side visuals and UX only.
const FORBIDDEN = [
  [/\bmc\.(tok|admin|key)\b/, 'reads the game\'s login/admin secrets (mc.tok, mc.admin, mc.key.*)'],
  [/turnstile/i, 'touches the Turnstile challenge'],
  [/WebSocket\b/, 'touches the game\'s network connection (WebSocket)'],
  [/["'`]\/api\//, 'calls the game\'s server API'],
];
for (const s of scripts) {
  for (const [re, what] of FORBIDDEN) {
    const line = s.source.split('\n').findIndex(l => re.test(l));
    if (line >= 0) fail(`${s.file}:${line + 1} ${what}`, 'not allowed: see "Hard rules" in .claude/CLAUDE.md');
  }
}
// Every script is listed for users in the README's "## Scripts" section ("- **<@name>** - ...").
const readmePath = join(ROOT, 'README.md');
const readme = existsSync(readmePath) ? await readFile(readmePath, 'utf8') : '';
const scriptsSection = (readme.match(/^## Scripts\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m) || [, ''])[1].toLowerCase();
for (const s of scripts) {
  if (!scriptsSection.includes(`- **${s.meta.get('name')}**`.toLowerCase())) {
    fail(`${s.file}: not in the README "Scripts" list`, `add "- **${s.meta.get('name')}** - <what it does>"`);
  }
}

const tracked = git('ls-files', '--', 'game', 'dev', 'reports').stdout.trim();
if (tracked) fail('generated or third-party files are committed', `git rm -r --cached these (game/ is the game developer's code): ${tracked.split('\n').slice(0, 3).join(', ')}`);

// ---- 2. versions vs the published copy ----------------------------------------
// Tampermonkey only installs an update when @version increases, and identifies a script by its URL
// (file name) and @name + @namespace. Compare with what's published, so a change can't ship unnoticed.
const base = opts.base || process.env.TC_BASE_REF || (git('rev-parse', '--verify', '-q', 'origin/main^{commit}').status === 0 ? 'origin/main' : '');
const haveRef = ref => git('rev-parse', '--verify', '-q', `${ref}^{commit}`).status === 0;
// After a force-push the previous head is no longer in the checkout; GitHub still serves it by SHA.
if (base && /^[0-9a-f]{40}$/.test(base) && !/^0+$/.test(base) && !haveRef(base)) git('fetch', '--quiet', '--no-tags', 'origin', base);
if (!base || /^0+$/.test(base)) {
  console.log(c.bold('\nVersions') + c.dim('  skipped: no published commit to compare with (no origin/main, or a new branch)'));
} else if (!haveRef(base)) {
  console.log(c.bold('\nVersions'));
  warn(`cannot compare versions: git ref "${base}" not found`, 'fetch it, or check out with full history (fetch-depth: 0); after a force-push run npm run check -- --base <old head> locally');
} else {
  console.log(c.bold('\nVersions') + c.dim(`  vs ${base} (what's published)`));
  const norm = s => s.replace(/\r\n/g, '\n');
  const before = new Map(); // file -> { source, meta } at base
  for (const f of git('ls-tree', '--name-only', base).stdout.split('\n').filter(f => f.endsWith('.js'))) {
    const src = git('show', `${base}:${f}`).stdout;
    const meta = parseMeta(src);
    if (meta) before.set(f, { source: src, meta });
  }
  let unchanged = 0;
  for (const s of scripts) {
    const old = before.get(s.file);
    if (!old) {
      // Same @name + @namespace as a file that's gone = a rename: the install URL changed.
      const from = [...before].find(([f, o]) => !scripts.some(x => x.file === f) && o.meta.get('name') === s.meta.get('name') && o.meta.get('namespace') === s.meta.get('namespace'));
      if (from) fail(`${s.file}: renamed from ${from[0]}`, 'installed copies update from the old URL and will never see this file; keep the old name');
      else pass(`${s.file}: new script`, `v${s.meta.get('version')}`);
      continue;
    }
    for (const key of ['name', 'namespace']) {
      if (old.meta.get(key) !== s.meta.get(key)) {
        fail(`${s.file}: @${key} changed ("${old.meta.get(key)}" → "${s.meta.get(key)}")`, 'Tampermonkey identifies a script by @name + @namespace: users would get a duplicate instead of an update; change it back');
      }
    }
    if (norm(old.source) === norm(s.source)) { unchanged++; continue; }
    const was = old.meta.get('version'), now = s.meta.get('version');
    if (compareVersions(now, was) > 0) pass(`${s.file}: changed, @version ${was} → ${now}`);
    else fail(`${s.file}: changed since ${base} but @version is still ${now}`, `bump it (fix = patch, feature = minor), or installed copies never get the change`);
  }
  for (const [f, old] of before) {
    const renamedTo = scripts.find(s => s.meta.get('name') === old.meta.get('name') && s.meta.get('namespace') === old.meta.get('namespace'));
    if (!scripts.some(s => s.file === f) && !renamedTo) warn(`${f} (${old.meta.get('name')}) was removed`, 'fine if intended: installed copies simply stop getting updates');
  }
  if (unchanged) console.log(c.dim(`  ${unchanged} script(s) unchanged`));
}

// ---- 3. game hooks ----------------------------------------------------------
const dir = opts.snapshot ? resolve(opts.snapshot) : await latestSnapshot(opts.target);
if (!dir || !existsSync(join(dir, 'manifest.json'))) {
  console.log(c.bold('\nGame hooks'));
  fail(`no snapshot for "${opts.target}"`, `run: npm run snapshot${opts.target === 'prod' ? '' : ` -- --target ${opts.target}`}`);
  process.exit(1);
}
const manifest = JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8'));
console.log(c.bold(`\nGame hooks`) + c.dim(`  vs ${relative(ROOT, dir)} (build ${manifest.buildId}, fetched ${manifest.fetchedAt.slice(0, 16).replace('T', ' ')} UTC)`));

const present = new Set(scripts.map(s => s.file));
// 'shaders:vs' / 'shaders:fs' = every captured vertex / fragment shader, joined.
const SHADER_FILES = { 'shaders:vs': '.vert.glsl', 'shaders:fs': '.frag.glsl' };
const hasShaders = existsSync(join(dir, 'shaders'));
const rawCache = new Map();
const raw = async file => {
  if (!rawCache.has(file)) {
    let text = null;
    if (SHADER_FILES[file]) {
      if (hasShaders) {
        const names = (await readdir(join(dir, 'shaders'))).filter(n => n.endsWith(SHADER_FILES[file])).sort();
        text = (await Promise.all(names.map(n => readFile(join(dir, 'shaders', n), 'utf8')))).join('\n');
      }
    } else {
      const p = join(dir, 'raw', file);
      if (existsSync(p)) text = await readFile(p, 'utf8');
    }
    rawCache.set(file, text);
  }
  return rawCache.get(file);
};
const describe = file => ({ 'shaders:vs': 'vertex shaders', 'shaders:fs': 'fragment shaders' })[file] || file;

const covered = new Set();
const byScript = new Map();
for (const e of expectations) {
  const owners = [e.script].flat();
  owners.forEach(o => covered.add(o));
  if (!owners.some(o => present.has(o))) continue;
  const key = owners.filter(o => present.has(o)).join(' + ');
  if (!byScript.has(key)) byScript.set(key, []);
  byScript.get(key).push(e);
}

for (const [owner, list] of byScript) {
  console.log(c.cyan(` ${owner}`));
  for (const e of list) {
    const text = await raw(e.file);
    let ok, label, detail = '';
    if (text == null && SHADER_FILES[e.file]) {
      warn(`skipped ${describe(e.file)} check (${e.why})`, 'snapshot has no shaders/ - re-run npm run snapshot -- --force with Chrome available');
      continue;
    } else if (text == null) {
      ok = false; label = `${e.file} exists`; detail = 'file is no longer part of the game';
    } else if (e.exports) {
      const have = new Set(manifest.exports?.[e.file] || []);
      const missing = e.exports.filter(x => !have.has(x));
      ok = missing.length === 0;
      label = `${e.file} exports ${e.exports.join(', ')}`;
      if (!ok) detail = `missing: ${missing.join(', ')}`;
    } else {
      ok = typeof e.test === 'string' ? text.includes(e.test) : e.test.test(text);
      label = `${describe(e.file)}: ${typeof e.test === 'string' ? JSON.stringify(e.test) : short(e.test)}`;
    }
    const why = c.dim(`— ${e.why}`);
    if (ok && e.known) warn(`${label} ${why}`, 'now passes: remove its `known` note');
    else if (ok) console.log(`  ${PASS} ${label} ${why}`);
    else if (e.known) console.log(`  ${KNOWN} ${label} ${why}${c.yellow(`  known: ${e.known}`)}`);
    else fail(`${label} ${why}`, detail);
  }
}

for (const f of present) if (!covered.has(f)) warn(`${f} has no entries in compat/expectations.mjs`, 'add the game hooks it relies on');
for (const f of covered) if (!present.has(f)) warn(`compat/expectations.mjs mentions ${f}, which is not in the repo`);

// ---- 4. codemap freshness (prod only) -------------------------------------------
// Each codemap names the game build(s) it was verified against in its first lines. When the game moves
// on, say so, so the maps get re-verified instead of quietly going stale.
const mapsDir = join(ROOT, '.claude', 'codemap');
if (opts.target === 'prod' && !opts.snapshot && existsSync(mapsDir)) {
  const stale = [];
  for (const map of (await readdir(mapsDir)).filter(f => f.endsWith('.md')).sort()) {
    const head = (await readFile(join(mapsDir, map), 'utf8')).split('\n').slice(0, 8).join('\n');
    const builds = [...head.matchAll(/\b[0-9a-f]{10}\b/g)].map(m => m[0]);
    if (builds.length && !builds.includes(manifest.buildId)) stale.push(`${map} (${[...new Set(builds)].join('/')})`);
  }
  if (stale.length) {
    console.log(c.bold('\nCodemaps'));
    warn(`written against an older game build than ${manifest.buildId}: ${stale.join(', ')}`,
      're-verify the sections for files that changed (tweetcraft-game-update skill), then put the new build id in the header');
  }
}

console.log(failures ? c.red(`\n${failures} problem(s).`) : c.green('\nAll static checks passed.'));
process.exit(failures ? 1 : 0);

/**
 * Compare versions like semver: dotted numbers compared numerically ("1.10.0" > "1.9.2", "1.2" = "1.2.0"),
 * a pre-release ("-beta.2") sorts before its release and is compared identifier by identifier, and
 * build metadata ("+5") is ignored.
 */
function compareVersions(a = '', b = '') {
  const parse = v => {
    const [core, ...rest] = String(v).split('+')[0].split('-');
    return { nums: core.split('.').map(n => parseInt(n, 10) || 0), pre: rest.length ? rest.join('-').split('.') : null };
  };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < Math.max(x.nums.length, y.nums.length); i++) {
    const d = (x.nums[i] || 0) - (y.nums[i] || 0);
    if (d) return Math.sign(d);
  }
  if (!x.pre || !y.pre) return x.pre ? -1 : y.pre ? 1 : 0;
  for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
    const p = x.pre[i], q = y.pre[i];
    if (p === undefined || q === undefined) return p === undefined ? -1 : 1;
    const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
    if (pn && qn && +p !== +q) return Math.sign(+p - +q);
    if (pn !== qn) return pn ? -1 : 1;
    if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

function short(re) {
  const s = String(re);
  return s.length > 70 ? s.slice(0, 67) + '…/' : s;
}
