#!/usr/bin/env node
// Live test: open the real game in headless Chrome with the userscripts injected at
// document-start, then check that they loaded cleanly and their hooks took effect
// (compat/expectations.mjs `runtime` and `shaders`). Writes reports/smoke-<target>.json/.png.
//
//   npm run smoke
//   npm run smoke -- --target staging
//   npm run smoke -- --only shaders          # only scripts whose file name contains "shaders"
//   npm run smoke -- --headed                # watch it in a visible browser window
import { parseArgs } from 'node:util';
import { join } from 'node:path';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { listUserscripts, targetUrl, latestSnapshot, REPORTS_DIR, c, PASS, FAIL, WARN, KNOWN, annotate, summary } from './lib/common.mjs';
import { launchBrowser, openGame, readPrograms, readFatal, labelProgram } from './lib/browser.mjs';
import { wrapUserscript } from './lib/userscript-env.mjs';
import { runtime, shaders } from '../compat/expectations.mjs';

const { values: opts } = parseArgs({
  options: {
    target: { type: 'string', default: 'prod' },
    only: { type: 'string', multiple: true },
    headed: { type: 'boolean', default: false },
    timeout: { type: 'string', default: '60000' },
    settle: { type: 'string' },
  },
});
const url = targetUrl(opts.target);
const all = await listUserscripts();
const scripts = opts.only?.length ? all.filter(s => opts.only.some(o => s.file.includes(o))) : all;
if (!scripts.length) { console.log(c.red('No userscripts matched --only.')); process.exit(1); }
const loaded = new Set(scripts.map(s => s.file));
const applies = e => [e.script].flat().some(f => loaded.has(f));

let failures = 0;
const results = [];
const record = (status, script, name, detail = '') => {
  results.push({ status, script, name, detail });
  if (status === 'fail') { failures++; annotate('error', `[${opts.target}] ${script}: ${name} ${detail}`); }
  if (status === 'warn') annotate('warning', `[${opts.target}] ${script}: ${name} ${detail}`);
};

// How many programs the game links without userscripts (from the latest snapshot), so we wait
// for all of them: the game links a second batch a few seconds after the first.
const snap = await latestSnapshot(opts.target);
const vanilla = snap ? JSON.parse(await readFile(join(snap, 'manifest.json'), 'utf8')).shaders?.length || 0 : 0;
const settleMs = Number(opts.settle ?? (vanilla ? 2500 : 10000));
if (!vanilla) console.log(c.yellow(`No snapshot with shaders for "${opts.target}" - waiting ${settleMs / 1000}s for shaders to settle instead (run npm run snapshot for a reliable test).`));

console.log(`Opening ${c.bold(url)} with ${scripts.length} userscript(s) ...`);
const t0 = Date.now();
const browser = await launchBrowser({ headed: opts.headed });
let page, consoleMsgs = [], pageErrors = [], programs = [];
try {
  ({ page, consoleMsgs, pageErrors } = await openGame(browser, url, {
    userscripts: scripts.map(s => ({ file: s.file, source: wrapUserscript(s, { pageOrigin: new URL(url).origin }) })),
    timeoutMs: Number(opts.timeout),
    settleMs,
    minPrograms: vanilla,
  }));
  console.log(c.dim(`  booted in ${((Date.now() - t0) / 1000).toFixed(1)}s (Chrome ${browser.version()})`));

  const fatal = await readFatal(page);
  if (fatal) record('fail', 'game', 'game booted in the test browser', `it showed: ${fatal}`);

  programs = await readPrograms(page);
  const broken = programs.filter(p => !p.linked || (p.vs && !p.vs.compiled) || (p.fs && !p.fs.compiled));
  if (!programs.length) record('fail', 'game', 'shader programs were linked', 'none recorded - did the game start?');
  else if (broken.length) record('fail', 'game', 'all shader programs compile and link', broken.map(p => `#${p.id} ${labelProgram(p)}: ${(p.log || p.fs?.log || p.vs?.log || '').trim().split('\n')[0]}`).join(' | '));
  else record('pass', 'game', `all ${programs.length} shader programs compile and link`);
  if (vanilla && programs.length < vanilla) {
    record('fail', 'game', 'every shader program the game normally builds was built',
      `only ${programs.length} of the ${vanilla} linked without userscripts (if the game changed, re-run npm run snapshot)`);
  }

  await page.evaluate(() => {
    window.__tcwait = async (fn, ms = 10000) => {
      const t = Date.now();
      while (Date.now() - t < ms) {
        try { if (await fn()) return true; } catch {}
        await new Promise(r => setTimeout(r, 200));
      }
      return false;
    };
  });

  for (const e of shaders.filter(applies)) {
    const pool = programs.filter(p => labelProgram(p) === e.kind);
    const hit = pool.filter(p => p.linked && (p[e.stage]?.source || '').includes(e.marker)).length;
    // min: the marker must appear in at least that many programs; max (optional): at most that many (max: 0 forbids it)
    if (typeof e.min !== 'number' && typeof e.max !== 'number') { settle(e, false, 'entry has neither min nor max'); continue; }
    // a max-only entry must still find programs of its kind, or it would pass on an empty pool
    if (typeof e.min !== 'number' && !pool.length) { settle(e, false, `no ${e.kind} programs to check`); continue; }
    const min = e.min ?? 0, max = e.max ?? Infinity;
    settle(e, hit >= min && hit <= max,
      `${hit}/${pool.length} ${e.kind} programs (expected ${max === Infinity ? `at least ${min}` : min ? `${min}-${max}` : `at most ${max}`})`);
  }
  // Each check gets a time limit, so one that never settles fails on its own instead of running the CI
  // job into its timeout (which would also lose this run's report).
  const CHECK_MS = 90000;
  for (const e of runtime.filter(applies)) {
    let out, timer;
    const timeout = new Promise(r => { timer = setTimeout(() => r(`timed out after ${CHECK_MS / 1000}s`), CHECK_MS); });
    try { out = await Promise.race([page.evaluate(e.run), timeout]); } catch (err) { out = `threw: ${err.message.split('\n')[0]}`; }
    clearTimeout(timer);
    settle(e, out === true, out === true ? '' : String(out));
  }

  await mkdir(REPORTS_DIR, { recursive: true });
  await page.screenshot({ path: join(REPORTS_DIR, `smoke-${opts.target}.png`) });
} catch (e) {
  record('fail', 'game', 'test run completed', e.message.split('\n')[0]);
} finally {
  await browser.close();
}

// Errors are attributed to a userscript through the sourceURL each one was injected with.
const tag = 'userscript:///';
const owner = s => (s.match(/userscript:\/\/\/([^\s:)]+)/) || [])[1];
for (const m of consoleMsgs.filter(m => m.url.startsWith(tag) && (m.type === 'error' || m.type === 'warning'))) {
  record(m.type === 'error' ? 'fail' : 'warn', owner(m.url), `console.${m.type === 'error' ? 'error' : 'warn'}`, m.text.split('\n').slice(0, 3).join(' '));
}
for (const e of pageErrors) {
  const who = owner(e.stack);
  if (who) record('fail', who, 'uncaught exception', e.message);
  else record('warn', 'game', 'uncaught exception (not traced to a userscript)', e.message);
}

// ---- report -----------------------------------------------------------------
const icon = { pass: PASS, fail: FAIL, warn: WARN, known: KNOWN };
const groups = new Map();
for (const r of results) {
  if (!groups.has(r.script)) groups.set(r.script, []);
  groups.get(r.script).push(r);
}
for (const [script, list] of groups) {
  console.log(c.cyan(` ${script}`));
  for (const r of list) console.log(`  ${icon[r.status]} ${r.name}${r.detail ? c.dim(`  ${r.detail}`) : ''}`);
}
const report = {
  target: opts.target, url, at: new Date().toISOString(), scripts: [...loaded], failures, results,
  programs: programs.map(p => ({ id: p.id, kind: labelProgram(p), linked: p.linked })),
  scriptConsole: consoleMsgs.filter(m => m.url.startsWith(tag)),
};
await mkdir(REPORTS_DIR, { recursive: true });
await writeFile(join(REPORTS_DIR, `smoke-${opts.target}.json`), JSON.stringify(report, null, 2));
console.log(c.dim(`\nReport: reports/smoke-${opts.target}.json, screenshot: reports/smoke-${opts.target}.png`));
console.log(failures ? c.red(`${failures} problem(s).`) : c.green('Smoke test passed.'));
const mdIcon = { pass: '✅', fail: '❌', warn: '⚠️', known: '🟡' };
await summary([
  `### Smoke test (${opts.target}): ${failures ? `❌ ${failures} problem(s)` : '✅ passed'}`,
  '| | Script | Check | Detail |', '|---|---|---|---|',
  ...results.map(r => `| ${mdIcon[r.status]} | ${r.script} | ${r.name} | ${String(r.detail).replace(/\|/g, '\\|').slice(0, 300)} |`),
].join('\n'));
process.exit(failures ? 1 : 0);

// ---------------------------------------------------------------------------

function settle(e, ok, detail) {
  const script = [e.script].flat().filter(f => loaded.has(f)).join(' + ');
  if (ok && e.known) record('warn', script, e.name, 'now passes: remove its `known` note in compat/expectations.mjs');
  else if (ok) record('pass', script, e.name, detail);
  else if (e.known) record('known', script, e.name, `${detail ? detail + ' - ' : ''}known: ${e.known}`);
  else record('fail', script, e.name, detail);
}
