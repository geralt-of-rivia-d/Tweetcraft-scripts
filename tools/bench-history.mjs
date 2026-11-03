#!/usr/bin/env node
// Every bench result so far, in one table: look a scenario up before running it again.
//
//   npm run bench:history                                   # every row of every reports/bench-*.json
//   npm run bench:history -- --scenario high --since 2026-11-01
//   npm run bench:history -- --scenario "high*,vanilla" --rd 12 --fov 80 --uncapped --md
//   npm run bench:history -- --label final --version 1.5 --latest
//
// Columns: label (env.label or the file name), date (env.at), shader script version, rd/FOV, vsync, scenario, med,
// p95gb2, GPU ms, holds 60, passes, sec/row, flags. "holds 60" follows the bench: uncapped median <= 14 and p95gb2 <= 16.7
// ("yes(gb)" = a report from before p95gb2, judged on p95gb); vsync median 16.7 +- 0.5 and miss% <= 1.
// Flags: U = a pass the noise guard marked unreliable, W = warped --at wait (--warp), E = early stop, P! = the preflight
// warned, X = the report (or part of it) is in machine-profile.json's `excluded` list (contaminated or not comparable:
// see that entry); --clean leaves X rows out, so --latest then picks the newest clean row. Rows that were n/a or failed
// are left out (--all keeps them).
// Filters (all optional, combined with AND): --scenario a,b (exact names, * wildcards), --label (substring or *
// wildcards), --since/--until YYYY-MM-DD, --version (prefix of the shader script version; "vanilla" = no scripts),
// --rd N, --fov N, --vsync / --uncapped, --latest (only the newest row per scenario + version + rd/FOV + vsync),
// --sort date|med|p95gb2|gpu, --json (machine-readable).
import { parseArgs } from 'node:util';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS_DIR, c } from './lib/common.mjs';
import { holdsText, settingsOf, shaderVersion, fmt } from './lib/bench-report.mjs';

const { values: o } = parseArgs({
  options: {
    scenario: { type: 'string' }, label: { type: 'string' }, since: { type: 'string' }, until: { type: 'string' },
    version: { type: 'string' }, rd: { type: 'string' }, fov: { type: 'string' },
    vsync: { type: 'boolean', default: false }, uncapped: { type: 'boolean', default: false },
    latest: { type: 'boolean', default: false }, all: { type: 'boolean', default: false }, clean: { type: 'boolean', default: false },
    sort: { type: 'string', default: 'date' }, md: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
    dir: { type: 'string' }, help: { type: 'boolean', short: 'h', default: false },
  },
});
if (o.help) {
  console.log(`Usage: npm run bench:history -- [--scenario a,b*] [--label text] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
                         [--version 1.5] [--rd 12] [--fov 80] [--vsync|--uncapped] [--latest] [--all] [--clean]
                         [--sort date|med|p95gb2|gpu] [--md] [--json] [--dir reports]
One row per scenario per report (reports/bench-*.json), oldest first. Flags: U unreliable pass, W warped wait,
E early stop, P! preflight warned, X in the machine profile's excluded list (--clean drops those). --latest keeps the newest row per scenario/version/rd/FOV/vsync.`);
  process.exit(0);
}

const glob = s => new RegExp(`^${s.split('*').map(x => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');
const scenarioRes = o.scenario ? o.scenario.split(',').map(s => s.trim()).filter(Boolean).map(glob) : null;
const labelRe = o.label ? (o.label.includes('*') ? glob(o.label) : new RegExp(o.label.replace(/[.+?^${}()|[\]\\]/g, '\\$&'), 'i')) : null;
const day = s => { const t = Date.parse(s); if (!Number.isFinite(t)) { console.log(`--since/--until: "${s}" is not a date`); process.exit(1); } return t; };
const since = o.since ? day(o.since) : null, until = o.until ? day(o.until) + 86400e3 : null;

const dir = o.dir || REPORTS_DIR;
let files = [];
try { files = readdirSync(dir).filter(f => /^bench-.*\.json$/.test(f)); } catch (e) { console.log(`no reports in ${dir}: ${e.message}`); process.exit(1); }

// Reports the machine profile marks as contaminated or not comparable. Keys name one or more files, sometimes with a
// qualifier ("bench-x.json renderScale=1 rows"); any file named in a key is flagged.
const excluded = new Map();
try {
  const prof = JSON.parse(readFileSync(new URL('./lib/machine-profile.json', import.meta.url), 'utf8'));
  for (const [k, why] of Object.entries(prof.excluded || {})) for (const m of k.matchAll(/bench-[\w.+-]+?\.json/g)) excluded.set(m[0], `${k}: ${why}`);
} catch { /* no profile: nothing flagged */ }

const out = [];
let skipped = 0;
for (const f of files) {
  let j;
  try { j = JSON.parse(readFileSync(join(dir, f), 'utf8')); } catch { skipped++; continue; }
  if (!j || !Array.isArray(j.rows)) { skipped++; continue; }
  const env = j.env || {};
  let at = Date.parse(env.at);
  if (!Number.isFinite(at)) { try { at = statSync(join(dir, f)).mtimeMs; } catch { at = 0; } }
  const ver = shaderVersion(env) ?? ((env.scripts || []).length ? '?' : 'vanilla');
  const label = env.label || f.replace(/^bench-|\.json$/g, '');
  const flagsEnv = [env.earlyStop?.stoppedAfter ? 'E' : '', env.preflight && env.preflight.verdict !== 'ok' ? 'P!' : ''].join('');
  for (const r of j.rows) {
    if (!r || !r.name) continue;
    if ((r.na || r.error) && !o.all) continue;
    const s = settingsOf(r, env);
    const vs = !!(r.vsync ?? env.vsync);
    out.push({
      file: f, label, at, date: new Date(at).toISOString().slice(0, 16).replace('T', ' '),
      version: r.name.startsWith('vanilla') ? 'vanilla' : ver, scripts: ver, rd: s.rd, fov: s.fov, heldLight: s.heldLight || null, vsync: vs,
      scenario: r.name, med: r.med ?? null, p95gb2: r.p95gb2 ?? null, p95gb: r.p95gb ?? null, gpuMs: r.gpuMs ?? null, missPct: r.missPct ?? null,
      holds: r.na ? 'n/a' : r.error ? 'FAIL' : holdsText({ ...r, vsync: vs }),
      passes: Array.isArray(r.runs) ? r.runs.length : 1, totalS: r.totalS ?? null,
      flags: `${r.unreliablePasses?.length || r.unreliable ? 'U' : ''}${r.warp && r.warp.k > 1 ? 'W' : ''}${flagsEnv}${excluded.has(f) ? 'X' : ''}`,
      excluded: excluded.get(f) || null,
      note: r.na || r.error || '',
    });
  }
}

let rows = out.filter(r =>
  (!scenarioRes || scenarioRes.some(re => re.test(r.scenario))) &&
  (!labelRe || labelRe.test(r.label) || labelRe.test(r.file)) &&
  (since === null || r.at >= since) && (until === null || r.at < until) &&
  (!o.version || (o.version === 'vanilla' ? r.version === 'vanilla' : String(r.scripts).startsWith(o.version))) &&
  (!o.rd || r.rd === Number(o.rd)) && (!o.fov || r.fov === Number(o.fov)) &&
  (!o.vsync || r.vsync) && (!o.uncapped || !r.vsync) && (!o.clean || !r.excluded));

if (o.latest) {
  const best = new Map();
  for (const r of rows) {
    const k = [r.scenario, r.version, r.rd, r.fov, r.heldLight, r.vsync].join('|');
    if (!best.has(k) || best.get(k).at < r.at) best.set(k, r);
  }
  rows = [...best.values()];
}
const key = { date: r => r.at, med: r => r.med ?? Infinity, p95gb2: r => r.p95gb2 ?? Infinity, gpu: r => r.gpuMs ?? Infinity }[o.sort];
if (!key) { console.log('--sort must be date, med, p95gb2 or gpu'); process.exit(1); }
rows.sort((a, b) => key(a) - key(b) || a.at - b.at || a.scenario.localeCompare(b.scenario));

if (o.json) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const head = ['label', 'date', 'version', 'rd/fov', 'vsync', 'scenario', 'med', 'p95gb2', 'gpuMs', 'holds', 'passes', 's/row', 'flags'];
const body = rows.map(r => [r.label, r.date, r.version, `${r.rd}/${r.fov}${r.heldLight === 'off' ? ' hl-off' : ''}`, r.vsync ? 'vsync' : '-', r.scenario,
  fmt(r.med, 2), r.p95gb2 !== null ? fmt(r.p95gb2, 2) : r.p95gb !== null ? `(gb ${fmt(r.p95gb, 2)})` : '-', fmt(r.gpuMs, 2),
  r.vsync && r.missPct !== null ? `${r.holds} (${fmt(r.missPct, 2)}%)` : r.holds, String(r.passes), r.totalS === null ? '-' : fmt(r.totalS, 0), r.flags || '']);
if (o.md) {
  console.log(`| ${head.join(' | ')} |`);
  console.log(`|${head.map((_, i) => (i >= 6 && i <= 8 ? '---:' : '---')).join('|')}|`);
  for (const b of body) console.log(`| ${b.map(x => String(x).replace(/\|/g, '\\|')).join(' | ')} |`);
} else {
  const w = head.map((h, i) => Math.max(h.length, ...body.map(b => String(b[i]).length)));
  const num = new Set([6, 7, 8, 10, 11]);
  const line = cells => cells.map((x, i) => (num.has(i) ? String(x).padStart(w[i]) : String(x).padEnd(w[i]))).join('  ').trimEnd();
  console.log(c.bold(line(head)));
  for (const b of body) console.log(line(b));
}
console.log(c.dim(`${rows.length} row(s) from ${new Set(rows.map(r => r.file)).size} of ${files.length} report(s)${skipped ? `, ${skipped} unreadable` : ''}.`));
