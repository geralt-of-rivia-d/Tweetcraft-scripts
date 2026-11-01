#!/usr/bin/env node
// Snapshot the game's client code so scripts can be checked against it and updates diffed.
//
//   npm run snapshot                      # production (tweetcraft.jai.vin)
//   npm run snapshot -- --target staging  # the game's staging host (often updated first)
//   npm run snapshot -- --force           # write a new snapshot even if nothing changed
//   npm run snapshot -- --no-browser      # skip capturing runtime shaders with Chrome
//   npm run snapshot -- --keep 20          # snapshots to keep per target (default 10)
//
// Layout: game/<target>/<timestamp>-<buildId>/
//   raw/      exactly what the server sent: index.html, CSS, every JS module, engine.wasm, and the JSON data
//             the game fetches by path (atlas layouts, sound events)
//   pretty/   the same text files run through Prettier, for reading and diffing
//   shaders/  every GLSL program the game linked at startup (captured in headless Chrome)
//   manifest.json, MODULES.md, changes.diff (vs the previous snapshot)
// When the build changed it also writes reports/changes-<target>.{md,diff}, and in GitHub Actions sets the
// step outputs changed/from/build (the workflow turns them into an issue).
import { parseArgs } from 'node:util';
import { readFile, writeFile, rm, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename, dirname, extname } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as prettier from 'prettier';
import { ROOT, targetUrl, sha256, writeFileDeep, snapshotsDir, latestSnapshot, REPORTS_DIR, c, annotate, summary, output } from './lib/common.mjs';
import { crawlGame, pathFor, CRAWLER_VERSION } from './lib/game.mjs';

const { values: opts } = parseArgs({
  options: {
    target: { type: 'string', default: 'prod' },
    force: { type: 'boolean', default: false },
    'no-browser': { type: 'boolean', default: false },
    keep: { type: 'string', default: '10' },
  },
});
const target = opts.target;
const base = targetUrl(target);

console.log(`Fetching ${c.bold(base)} ...`);
const { files, modules } = await crawlGame(base, { log: m => console.log(c.yellow(m)) });
const paths = [...files.keys()].sort();
const fileInfo = Object.fromEntries(paths.map(p => [p, { sha256: sha256(files.get(p)), bytes: Buffer.byteLength(files.get(p)) }]));
const buildId = sha256(paths.map(p => `${p}\0${fileInfo[p].sha256}`).join('\n')).slice(0, 10);
const totalKb = Math.round(paths.reduce((n, p) => n + fileInfo[p].bytes, 0) / 1024);
console.log(`  ${paths.length} files, ${totalKb} KB, build ${c.cyan(buildId)}`);

const prevDir = await latestSnapshot(target);
const prev = prevDir ? JSON.parse(await readFile(join(prevDir, 'manifest.json'), 'utf8')) : null;
if (prev && prev.buildId === buildId && !opts.force) {
  console.log(c.green(`No change: ${target} is still build ${buildId} (snapshot ${basename(prevDir)}).`));
  await summary(`**${target}**: no change, still build \`${buildId}\` (first seen ${prev.fetchedAt.slice(0, 16).replace('T', ' ')} UTC)`);
  await output({ changed: 'false', build: buildId });
  process.exit(0);
}

const stamp = new Date().toISOString().replace(/\.\d+Z$/, '').replace(/[-:]/g, '').replace('T', '-');
const dir = join(snapshotsDir(target), `${stamp}-${buildId}`);
if (existsSync(dir)) await rm(dir, { recursive: true });

// raw + pretty
const parserFor = p => ({ '.js': 'babel', '.mjs': 'babel', '.css': 'css', '.html': 'html', '.json': 'json' })[extname(p)];
for (const p of paths) {
  const src = files.get(p);
  await writeFileDeep(join(dir, 'raw', p), src);
  if (Buffer.isBuffer(src)) continue; // binary (engine.wasm): raw only; its exports are in manifest/MODULES.md
  let pretty = src;
  try {
    if (parserFor(p)) pretty = await prettier.format(src, { parser: parserFor(p), printWidth: 110 });
  } catch (e) {
    console.log(c.yellow(`  prettier could not format ${p}: ${e.message.split('\n')[0]}`));
  }
  await writeFileDeep(join(dir, 'pretty', p), pretty);
}
console.log(`  wrote raw/ and pretty/`);

// runtime shaders
// The game links a second batch of programs a few seconds after the first, so wait for as many as the
// previous snapshot had (or settle longer when there is none). A snapshot without shaders would turn every
// shaders:* check into a warning and stay the baseline until the game changes again, so a failed capture
// discards the snapshot instead (use --no-browser to skip capture on purpose).
let shaders = null;
if (!opts['no-browser']) {
  const expect = prev?.shaders?.length || 0;
  try {
    shaders = await captureShaders(base, join(dir, 'shaders'), expect);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    console.log(c.red(`Shader capture failed, so the snapshot was discarded: ${e.message.split('\n')[0]}`));
    console.log('Re-run it, or pass --no-browser to snapshot without shaders.');
    annotate('error', `[${target}] shader capture failed: ${e.message.split('\n')[0]}`);
    process.exit(1);
  }
  console.log(`  captured ${shaders.length} distinct shader programs into shaders/`);
  if (shaders.length < expect) {
    console.log(c.yellow(`  only ${shaders.length} of the ${expect} programs the previous snapshot had (waited 60 s): the game may have dropped some, or startup was slow`));
    annotate('warning', `[${target}] captured ${shaders.length} shader programs, previous snapshot had ${expect}`);
  }
}

// Module graph with imports resolved to snapshot paths (static vs lazy import()).
const resolveSpec = (from, spec) => (/^[./]/.test(spec) ? pathFor(new URL(spec, `${base}/${from}`).href) : null);
const graph = Object.fromEntries([...modules].sort(([a], [b]) => a.localeCompare(b)).map(([p, m]) => [p, {
  imports: m.imports.filter(s => !m.dynamic.includes(s)).map(s => resolveSpec(p, s)).filter(Boolean).sort(),
  lazy: m.dynamic.map(s => resolveSpec(p, s)).filter(Boolean).sort(),
}]));

const manifest = {
  target,
  url: base,
  fetchedAt: new Date().toISOString(),
  buildId,
  files: fileInfo,
  exports: Object.fromEntries([...modules].filter(([, m]) => m.exports.length).map(([p, m]) => [p, m.exports])),
  graph,
  shaders,
  crawler: CRAWLER_VERSION,
};
await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2));
await writeFile(join(dir, 'MODULES.md'), modulesMarkdown(manifest));
await writeFile(join(snapshotsDir(target), 'LATEST'), basename(dir) + '\n');
console.log(c.green(`Saved snapshot ${join('game', target, basename(dir))}`));

// A crawler upgrade (CRAWLER_VERSION) collects files that were always there, which changes the build id. That
// alone isn't a game update: only files both snapshots have (changed or now missing) count.
const crawlerChanged = prev && (prev.crawler || 1) !== CRAWLER_VERSION;
const gameChanged = prev && (!crawlerChanged || changedPaths(prev, manifest).some(p => p in prev.files));
if (prev && !gameChanged) {
  const added = changedPaths(prev, manifest);
  console.log(c.cyan(`\nThe snapshot format changed (crawler v${prev.crawler || 1} → v${CRAWLER_VERSION}): ${added.length} more file(s) are captured now`));
  console.log(c.dim(`  ${added.join(', ')}`));
  console.log(c.green(`The game code itself is unchanged since ${prev.buildId}. This snapshot is the new baseline; updates are reported from the next change.`));
  await summary(`**${target}**: snapshot format upgraded (crawler v${prev.crawler || 1} → v${CRAWLER_VERSION}, +${added.length} files); game unchanged, new baseline \`${buildId}\``);
  await output({ changed: 'false', build: buildId });
} else if (prev) {
  if (crawlerChanged) console.log(c.cyan(`\nThe snapshot format also changed (crawler v${prev.crawler || 1} → v${CRAWLER_VERSION}), so some "added" files below were simply not captured before.`));
  const report = describeChanges(prev, manifest);
  console.log('\n' + report);
  const stale = await codemapsMentioning(changedPaths(prev, manifest));
  if (stale.length) {
    console.log(`\n${c.bold('Codemaps to re-verify')} (they mention changed files):`);
    for (const s of stale) console.log(`  ${s.map}: ${s.files.join(', ')}`);
  }
  const diff = gitDiff(prevDir, dir);
  await mkdir(REPORTS_DIR, { recursive: true });
  if (diff) {
    await writeFile(join(dir, 'changes.diff'), diff.full);
    await writeFile(join(REPORTS_DIR, `changes-${target}.diff`), diff.full);
    console.log(`\n${c.bold('Line changes (pretty/ and shaders/)')}:\n${diff.stat}`);
    console.log(`Full diff: ${join('game', target, basename(dir), 'changes.diff')}`);
  }
  annotate('notice', `Tweetcraft ${target} changed: build ${prev.buildId} -> ${buildId}`);
  const fence = '```';
  const md = [
    `### Tweetcraft ${target} changed: \`${prev.buildId}\` → \`${buildId}\``,
    fence, report, fence,
    stale.length ? `**Codemaps to re-verify** (they mention changed files):\n${stale.map(s => `- \`.claude/codemap/${s.map}\`: ${s.files.map(f => `\`${f}\``).join(', ')}`).join('\n')}` : '',
    diff ? `The full line diff is in the run's \`report-${target}\` artifact (\`changes-${target}.diff\`).` : '',
  ].filter(Boolean).join('\n');
  await writeFile(join(REPORTS_DIR, `changes-${target}.md`), md + '\n');
  await summary(md);
  await output({ changed: 'true', from: prev.buildId, build: buildId });
} else {
  await summary(`**${target}**: first snapshot, build \`${buildId}\``);
  await output({ changed: 'false', build: buildId });
}
await prune(Number(opts.keep));
console.log(`\nNext: ${c.bold('npm run check' + (target === 'prod' ? '' : ` -- --target ${target}`))} to see if the scripts still fit.`);

// ---------------------------------------------------------------------------

async function captureShaders(url, outDir, minPrograms = 0) {
  const { launchBrowser, openGame, readPrograms, readFatal, labelProgram } = await import('./lib/browser.mjs');
  const browser = await launchBrowser();
  try {
    const { page } = await openGame(browser, url, { minPrograms, settleMs: minPrograms ? 2500 : 8000 });
    const fatal = await readFatal(page);
    if (fatal) throw new Error(`game showed an error in the test browser: ${fatal}`);
    const programs = await readPrograms(page);
    const seen = new Map();
    for (const p of programs) {
      const key = sha256(`${p.vs?.source}\0${p.fs?.source}`);
      if (!seen.has(key)) seen.set(key, p);
    }
    const index = [];
    let n = 0;
    for (const [key, p] of seen) {
      const name = `${String(n++).padStart(2, '0')}-${labelProgram(p)}`;
      if (p.vs) await writeFileDeep(join(outDir, `${name}.vert.glsl`), p.vs.source);
      if (p.fs) await writeFileDeep(join(outDir, `${name}.frag.glsl`), p.fs.source);
      const uniforms = [...new Set([...`${p.vs?.source}\n${p.fs?.source}`.matchAll(/uniform\s+(?:\w+\s+)?\w+\s+([\w\s,]+?)\s*(?:\[[^\]]*\])?\s*;/g)]
        .flatMap(m => m[1].split(',').map(s => s.trim())))];
      index.push({ name, hash: key.slice(0, 10), linked: p.linked, uniforms });
    }
    await writeFileDeep(join(outDir, 'index.json'), JSON.stringify(index, null, 2));
    return index;
  } finally {
    await browser.close();
  }
}

/** Generated, always-current structural map: every module with size, exports, imports and importers. */
function modulesMarkdown(m) {
  const importedBy = {};
  for (const [p, g] of Object.entries(m.graph)) {
    for (const d of g.imports) (importedBy[d] ||= []).push(p);
    for (const d of g.lazy) (importedBy[d] ||= []).push(`${p} (lazy)`);
  }
  const short = p => p.replace(/^js\//, '');
  const rows = Object.entries(m.graph).map(([p, g]) => [
    `\`${short(p)}\``,
    Math.round((m.files[p]?.bytes || 0) / 1024) || '<1',
    (m.exports[p] || []).join(', ') || '—',
    [...g.imports.map(short), ...g.lazy.map(x => `${short(x)} (lazy)`)].join(', ') || '—',
    (importedBy[p] || []).map(short).join(', ') || (p === 'js/main.js' ? 'index.html' : '—'),
  ].join(' | '));
  return [
    `# Modules: ${m.target} build ${m.buildId}`,
    '',
    `Generated by \`npm run snapshot\` from ${m.url} at ${m.fetchedAt}. Paths are relative to \`pretty/js/\`.`,
    'For what modules mean and how they work together, see `.claude/codemap/game-*.md`.',
    '',
    '| Module | KB | Exports | Imports | Imported by |',
    '|---|---|---|---|---|',
    ...rows.map(r => `| ${r} |`),
    '',
  ].join('\n');
}

/** Files added, removed or changed between two manifests. */
function changedPaths(prev, cur) {
  const all = new Set([...Object.keys(prev.files), ...Object.keys(cur.files)]);
  return [...all].filter(p => prev.files[p]?.sha256 !== cur.files[p]?.sha256).sort();
}

/** Which .claude/codemap/*.md files mention any of these snapshot paths (as js/x.js or x.js). */
async function codemapsMentioning(paths) {
  const mapsDir = join(ROOT, '.claude', 'codemap');
  if (!existsSync(mapsDir) || !paths.length) return [];
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = [];
  for (const map of (await readdir(mapsDir)).filter(f => f.endsWith('.md')).sort()) {
    const text = await readFile(join(mapsDir, map), 'utf8');
    const files = paths.filter(p => {
      const short = p.replace(/^js\//, '');
      return new RegExp(`(^|[^\\w.-])${esc(p)}($|[^\\w.-])`).test(text)
        || (short !== p && new RegExp(`(^|[^\\w./-])${esc(short)}($|[^\\w.-])`).test(text));
    });
    if (files.length) out.push({ map, files });
  }
  return out;
}

/** Plain-text summary of what changed between two snapshot manifests. */
function describeChanges(prev, cur) {
  const before = new Set(Object.keys(prev.files)), after = new Set(Object.keys(cur.files));
  const added = [...after].filter(p => !before.has(p));
  const removed = [...before].filter(p => !after.has(p));
  const changed = [...after].filter(p => before.has(p) && prev.files[p].sha256 !== cur.files[p].sha256);
  const out = [`Changes since ${prev.buildId} (${prev.fetchedAt.slice(0, 16).replace('T', ' ')} UTC)`];
  out.push(`  files: ${changed.length} changed, ${added.length} added, ${removed.length} removed`);
  for (const p of changed) out.push(`    M ${p}`);
  for (const p of added) out.push(`    A ${p}`);
  for (const p of removed) out.push(`    D ${p}`);

  // Export changes matter most: userscripts import game modules and call their exports.
  const lines = [];
  for (const p of new Set([...Object.keys(prev.exports || {}), ...Object.keys(cur.exports || {})])) {
    const a = new Set(prev.exports?.[p] || []), b = new Set(cur.exports?.[p] || []);
    const gone = [...a].filter(x => !b.has(x)), fresh = [...b].filter(x => !a.has(x));
    if (gone.length) lines.push(`    - ${p}: ${gone.join(', ')}`);
    if (fresh.length) lines.push(`    + ${p}: ${fresh.join(', ')}`);
  }
  out.push(`  module exports: ${lines.length ? '' : 'unchanged'}`, ...lines);

  if (prev.shaders && cur.shaders) {
    const a = new Set(prev.shaders.map(s => s.hash)), b = new Set(cur.shaders.map(s => s.hash));
    const changedShaders = cur.shaders.filter(s => !a.has(s.hash)).map(s => s.name);
    const goneShaders = prev.shaders.filter(s => !b.has(s.hash)).map(s => s.name);
    out.push(`  shaders: ${changedShaders.length || goneShaders.length ? `${changedShaders.length} new/changed, ${goneShaders.length} gone` : 'unchanged'}`);
    changedShaders.forEach(n => out.push(`    M ${n}`));
  }
  return out.join('\n');
}

/** Keep only the newest `keep` snapshots for this target. */
async function prune(keep) {
  if (!(keep > 0)) return;
  const dirs = (await readdir(snapshotsDir(target), { withFileTypes: true }))
    .filter(d => d.isDirectory() && /^\d{8}-\d{6}-/.test(d.name))
    .map(d => d.name)
    .sort();
  for (const name of dirs.slice(0, Math.max(0, dirs.length - keep))) {
    await rm(join(snapshotsDir(target), name), { recursive: true });
    console.log(c.dim(`  pruned old snapshot ${name}`));
  }
}

// Diff pretty/ and shaders/ only: raw/ is minified, so its diffs are unreadable.
function gitDiff(prevDir, curDir) {
  const parts = ['pretty', 'shaders'].filter(d => existsSync(join(prevDir, d)) && existsSync(join(curDir, d)));
  if (!parts.length) return null;
  // Run from the snapshots folder with short relative paths (keeps the repo path, which may
  // contain spaces, out of the output).
  const run = extra => parts
    .map(d => spawnSync('git', ['diff', '--no-index', '--no-color', '-M', ...extra, `${basename(prevDir)}/${d}`, `${basename(curDir)}/${d}`],
      { cwd: dirname(curDir), encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).stdout)
    .join('');
  return { stat: run(['--stat=110']).trimEnd() || '  (no line changes)', full: run([]) };
}
