#!/usr/bin/env node
// Run check and smoke on GitHub Actions instead of this laptop (so they never compete with a real-GPU bench),
// and keep an eye on Actions minutes. Smoke uses SwiftShader both here and in CI, so the results match.
//
//   npm run cloud -- test|check|smoke [--target prod|staging|both] [--only <script>] [--keep] [--no-wait]
//                                     [--force] [--timeout <min>] [--slug <name>] [--dry-run]
//   npm run cloud -- wait <run-id|ci/branch> [--keep]   # collect a --no-wait run
//   npm run cloud -- minutes                            # repo visibility, this month's Actions minutes, quota
//   npm run cloud -- status [--prune]                   # recent runs, open game-watch issues, stale ci/* branches
//
// test|check|smoke snapshots the working tree WITHOUT touching the real index or any file: a temp
// GIT_INDEX_FILE is seeded from HEAD, `git add -A` (which honours .gitignore, so game/, reports/, dev/ stay
// out) fills it, and write-tree + commit-tree make a commit on top of HEAD that no local ref points at. That
// commit is pushed to a throwaway ci/<slug>-<yyyymmdd-hhmmss> branch (UTC), which runs the "Game watch"
// workflow as defined in that tree. The commit message tells the workflow which target and steps to run.
// Results: per-step outcomes, the failing step's log tail, the report-* artifacts in reports/cloud/<run-id>/,
// then the branch is deleted (unless --keep). Exit 0 = the run passed, 1 = it failed or couldn't be completed.
//
// Auth and safety: GitHub API calls are read-only (tools/lib/github.mjs refuses anything but GET) with the
// token from this repo's Git Credential Manager; pushes and branch deletes are plain `git push` to ci/* refs
// only. Never main, never gh auth, never git config.
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { ROOT, REPORTS_DIR, c, PASS, FAIL, WARN } from './lib/common.mjs';
import { api, paginate, download, unzip, originRepo, me, ApiError } from './lib/github.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'prod' },
    only: { type: 'string' },
    keep: { type: 'boolean', default: false },
    'no-wait': { type: 'boolean', default: false },
    force: { type: 'boolean', default: false },
    prune: { type: 'boolean', default: false },
    slug: { type: 'string' },
    timeout: { type: 'string', default: '30' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const WORKFLOW = 'Game watch';
const FREE_QUOTA = { free: 2000, pro: 3000 }; // included private-repo minutes per month by plan
const OS_MULT = { UBUNTU: 1, WINDOWS: 2, MACOS: 10 };
const { owner, repo, full } = originRepo();
const R = `/repos/${owner}/${repo}`;
const started = Date.now();

const git = (args, extra = {}) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, ...extra });
const gitOk = (args, extra) => {
  const r = git(args, extra);
  if (r.status !== 0) throw new Error(`git ${args[0]} failed: ${(r.stderr || r.stdout || '').trim().split('\n').slice(-3).join(' | ')}`);
  return r.stdout.trim();
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fmtDur = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`; };
const ago = iso => fmtDur(Date.now() - Date.parse(iso)).replace(/(\d+)m\d+s/, (_, m) => (m >= 120 ? `${Math.round(m / 60)}h` : `${m}m`));
const stamp = d => d.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15); // yyyymmdd-hhmmss UTC
const monthStart = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); };
const mark = conclusion => ({ success: PASS, failure: FAIL, cancelled: WARN, timed_out: FAIL, skipped: c.dim('-') })[conclusion] || c.dim('?');

const cmd = positionals[0];
try {
  if (['test', 'check', 'smoke'].includes(cmd)) process.exitCode = await runCloud(cmd);
  else if (cmd === 'wait') process.exitCode = await waitCmd(positionals[1]);
  else if (cmd === 'minutes') process.exitCode = await minutesCmd();
  else if (cmd === 'status') process.exitCode = await statusCmd();
  else {
    console.log('usage: npm run cloud -- test|check|smoke [--target prod|staging|both] [--only <script>] [--keep] [--no-wait] [--force]\n' +
      '       npm run cloud -- wait <run-id|ci/branch> | minutes | status [--prune]');
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.log(`\n${FAIL} ${e.message}`);
  if (['test', 'check', 'smoke', 'wait'].includes(cmd)) console.log(c.dim('  The cloud run could not be completed: run npm test locally instead (it waits for the GPU lock).'));
  process.exitCode = 1;
}

// ---- test | check | smoke ---------------------------------------------------------

async function runCloud(mode) {
  const target = opts.target;
  if (!['prod', 'staging', 'both'].includes(target)) throw new Error(`--target must be prod, staging or both (got "${target}")`);
  if (opts.only && mode === 'check') console.log(`${WARN} --only applies to smoke; check covers every script`);

  // Quota guard: only private repos use minutes.
  const repoInfo = await api(R);
  if (repoInfo.private && !opts.force) {
    const m = await accountMinutes(repoInfo);
    if (m.pct != null && m.pct > 95) throw new Error(`Actions quota ${m.used}/${m.quota} min (${m.pct.toFixed(0)}%) used this month and ${full} is private; use --force to run anyway`);
  }

  // 1. snapshot the working tree into a commit (real index and files untouched)
  const snap = snapshotWorkingTree(mode, target);
  console.log(c.bold(`\nCloud ${mode}`) + c.dim(`  ${full}, target ${target}${opts.only ? `, only ${opts.only}` : ''}`));
  console.log(`  snapshot ${snap.sha.slice(0, 10)} on ${snap.head.slice(0, 10)} (${snap.branchName})` + c.dim(`  ${snap.changed.length} file(s) differ from HEAD`));
  for (const l of snap.changed.slice(0, 12)) console.log(c.dim(`    ${l}`));
  if (snap.changed.length > 12) console.log(c.dim(`    … ${snap.changed.length - 12} more`));

  if (opts['dry-run']) { console.log(c.dim(`  dry run: not pushed (tree ${snap.tree.slice(0, 10)}, ${snap.files} files)`)); return 0; }

  // 2. push it to a throwaway ci/* branch
  const branch = `ci/${opts.slug ? slugify(opts.slug) : `${slugify(snap.branchName)}-${mode}`}-${stamp(new Date())}`;
  if (!/^ci\/[\w.-]+$/.test(branch)) throw new Error(`refusing to push to "${branch}"`);
  const push = git(['push', '--quiet', 'origin', `${snap.sha}:refs/heads/${branch}`], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
  if (push.status !== 0) throw new Error(`git push to ${branch} failed: ${(push.stderr || '').trim().split('\n').slice(-3).join(' | ')}`);
  console.log(`  pushed ${c.cyan(branch)}`);

  let cleaned = false;
  const cleanup = () => {
    if (cleaned || opts.keep) return;
    cleaned = true;
    const r = git(['push', '--quiet', 'origin', '--delete', `refs/heads/${branch}`], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    console.log(r.status === 0 ? c.dim(`  deleted ${branch}`) : `  ${WARN} could not delete ${branch}: npm run cloud -- status --prune`);
  };
  process.once('SIGINT', () => { console.log(`\n  interrupted; the cloud run carries on without us`); cleanup(); process.exit(130); });

  // 3. find the run
  const run = await findRun(snap.sha);
  console.log(`  run ${run.html_url}` + c.dim(`  (${run.status}, found after ${fmtDur(Date.now() - started)})`));
  if (opts['no-wait']) {
    console.log(c.dim(`  not waiting: npm run cloud -- wait ${run.id}   (that deletes ${branch} afterwards)`));
    return 0;
  }
  try {
    return await finishRun(run.id, { cleanup, printMinutes: true });
  } finally { cleanup(); }
}

function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'wip'; }

/** Commit the working tree as git add -A would see it, via a throwaway index. Touches no ref, index or file. */
function snapshotWorkingTree(mode, target) {
  const head = gitOk(['rev-parse', 'HEAD']);
  const branchName = git(['symbolic-ref', '--quiet', '--short', 'HEAD']).stdout.trim() || 'detached';
  const tmp = mkdtempSync(join(tmpdir(), 'tc-cloud-'));
  const env = { ...process.env, GIT_INDEX_FILE: join(tmp, 'index'), GIT_OPTIONAL_LOCKS: '0' };
  let tree;
  try {
    gitOk(['read-tree', 'HEAD'], { env });
    gitOk(['add', '-A'], { env });
    tree = gitOk(['write-tree'], { env });
  } finally { rmSync(tmp, { recursive: true, force: true }); }

  // Belt and braces: nothing generated, third-party or secret may go up (the repo is public).
  const files = gitOk(['ls-tree', '-r', '--name-only', tree]).split('\n').filter(Boolean);
  const bad = files.filter(f => /^(game|reports|dev|node_modules)\//.test(f) || /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519).*|settings\.local\.json)$/i.test(f));
  if (bad.length) throw new Error(`the snapshot would include files that must not be pushed: ${bad.slice(0, 5).join(', ')} (check .gitignore)`);

  const changed = gitOk(['diff-tree', '-r', '--name-status', head, tree]).split('\n').filter(Boolean).map(l => l.replace(/\t/, ' '));
  const tags = [`[tc-cloud mode=${mode}]`];
  if (target !== 'both') tags.push(`[tc-cloud target=${target}]`);
  if (mode === 'check') tags.push('[tc-cloud skip=smoke]');
  if (mode === 'smoke') tags.push('[tc-cloud skip=check]');
  if (opts.only) {
    if (!/^[\w.-]+$/.test(opts.only)) throw new Error(`--only must be a script file name (got "${opts.only}")`);
    tags.push(`[tc-cloud only=${opts.only}]`);
  }
  const msg = `cloud ${mode}: working tree of ${branchName} at ${head.slice(0, 10)}\n\nThrowaway snapshot pushed by npm run cloud; deleted after the run.\n${tags.join(' ')}\n`;
  const sha = gitOk(['commit-tree', tree, '-p', head], { input: msg });
  return { sha, tree, head, branchName, changed, files: files.length };
}

async function findRun(sha) {
  const deadline = Date.now() + 3 * 60_000;
  for (let wait = 3000; ; wait = Math.min(wait * 1.5, 10_000)) {
    const { workflow_runs: runs } = await api(`${R}/actions/runs?head_sha=${sha}&per_page=20`);
    const run = runs.find(r => r.name === WORKFLOW || r.path?.endsWith('game-watch.yml'));
    if (run) return run;
    if (Date.now() > deadline) throw new Error(`no "${WORKFLOW}" run started for ${sha.slice(0, 10)} within 3 minutes (does the pushed game-watch.yml have ci/** in its push branches?)`);
    await sleep(wait);
  }
}

// ---- wait / results ------------------------------------------------------------------

async function waitCmd(arg) {
  if (!arg) throw new Error('usage: npm run cloud -- wait <run-id|ci/branch>');
  let id = /^\d+$/.test(arg) ? +arg : null;
  let branch = null;
  if (!id) {
    branch = arg.replace(/^refs\/heads\//, '');
    const { workflow_runs: runs } = await api(`${R}/actions/runs?branch=${encodeURIComponent(branch)}&per_page=5`);
    if (!runs.length) throw new Error(`no runs for branch ${branch}`);
    id = runs[0].id;
  }
  const run = await api(`${R}/actions/runs/${id}`);
  branch ??= run.head_branch;
  console.log(c.bold(`\nCloud run`) + c.dim(`  ${run.html_url}`));
  const cleanup = () => {
    if (opts.keep || !branch?.startsWith('ci/')) return;
    const r = git(['push', '--quiet', 'origin', '--delete', `refs/heads/${branch}`]);
    console.log(r.status === 0 ? c.dim(`  deleted ${branch}`) : c.dim(`  ${branch} already gone`));
  };
  try { return await finishRun(id, { printMinutes: true }); } finally { cleanup(); }
}

/** Poll a run to completion, print step outcomes and failing logs, download report-* artifacts. 0 = passed. */
async function finishRun(id, { printMinutes } = {}) {
  const deadline = Date.now() + Number(opts.timeout) * 60_000;
  const seen = new Set();
  let run;
  for (let wait = 10_000; ; wait = Math.min(Math.round(wait * 1.25), 30_000)) {
    run = await api(`${R}/actions/runs/${id}`);
    const jobs = (await api(`${R}/actions/runs/${id}/jobs?per_page=50`)).jobs;
    for (const job of jobs) for (const step of job.steps || []) {
      const key = `${job.id}:${step.number}`;
      if (step.status !== 'completed' || seen.has(key) || boring(step)) continue;
      seen.add(key);
      const dur = step.started_at && step.completed_at ? fmtDur(Date.parse(step.completed_at) - Date.parse(step.started_at)) : '';
      console.log(`  ${c.cyan(job.name.padEnd(8))} ${mark(step.conclusion)} ${step.name}` + c.dim(`  ${dur}`));
    }
    if (run.status === 'completed') { run.jobs = jobs; break; }
    if (Date.now() > deadline) throw new Error(`run still ${run.status} after ${opts.timeout} min: ${run.html_url} (collect it later with npm run cloud -- wait ${id} --keep)`);
    await sleep(wait);
  }

  console.log(c.bold('\nResult'));
  for (const job of run.jobs.filter(j => j.name !== 'notify' && j.name !== 'upstream' || j.conclusion !== 'skipped')) {
    const dur = job.started_at && job.completed_at ? fmtDur(Date.parse(job.completed_at) - Date.parse(job.started_at)) : '';
    console.log(`  ${mark(job.conclusion)} ${job.name}` + c.dim(`  ${job.conclusion}, ${dur}`));
    for (const step of (job.steps || []).filter(s => s.conclusion === 'failure')) {
      console.log(c.red(`    failed: ${step.name}`));
      try { for (const line of await stepLogTail(job, step)) console.log(`    ${c.dim('│')} ${line}`); }
      catch (e) { console.log(c.dim(`    (log unavailable: ${e.message})`)); }
    }
  }

  // Artifacts
  const arts = (await api(`${R}/actions/runs/${id}/artifacts?per_page=50`)).artifacts.filter(a => a.name.startsWith('report-') && !a.expired);
  if (arts.length) {
    const dir = join(REPORTS_DIR, 'cloud', String(id));
    for (const a of arts) {
      try {
        const files = await unzip(await download(`${R}/actions/artifacts/${a.id}/zip`), join(dir, a.name));
        const shot = files.find(f => f.endsWith('.png'));
        console.log(`  ${c.dim('artifact')} ${relative(ROOT, join(dir, a.name))}` + c.dim(`  ${files.length} file(s)${shot ? `, screenshot ${relative(ROOT, shot)}` : ''}`));
      } catch (e) { console.log(`  ${WARN} artifact ${a.name}: ${e.message}`); }
    }
  }

  const ok = run.conclusion === 'success';
  const runDur = run.run_started_at ? fmtDur(Date.parse(run.updated_at) - Date.parse(run.run_started_at)) : '?';
  console.log((ok ? c.green(`\nCloud run passed.`) : c.red(`\nCloud run ${run.conclusion}.`)) +
    c.dim(`  ${run.html_url}\n  wall ${fmtDur(Date.now() - started)} here, run ${runDur} on GitHub`));
  if (printMinutes) {
    try { console.log(c.dim(`  ${await minutesLine()}`)); } catch (e) { console.log(c.dim(`  minutes: unavailable (${e.message})`)); }
  }
  return ok ? 0 : 1;
}

function boring(s) { return /^(Set up job|Complete job|Post )/.test(s.name) && s.conclusion !== 'failure'; }

/**
 * The failing step's output from the job log, ✘/error lines first, then the tail. The log has one section per
 * step, opened by a "##[group]Run …" header; the step is the section that starts inside its time window
 * (API times are whole seconds, so allow 1 s) and, when several do, the one with an error line.
 */
async function stepLogTail(job, step, tail = 12) {
  const text = (await download(`${R}/actions/jobs/${job.id}/logs`)).toString('utf8');
  const from = Date.parse(step.started_at) - 1000, to = Date.parse(step.completed_at) + 1000;
  const strip = s => (process.stdout.isTTY ? s : s.replace(/\x1b\[[0-9;]*m/g, ''));
  const sections = [];
  let cur = null, inHeader = false;
  for (const raw of text.split(/\r?\n/)) {
    const m = raw.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z) ?(.*)$/);
    if (!m) continue;
    if (m[2].startsWith('##[group]Run ')) { sections.push(cur = { t: Date.parse(m[1]), lines: [] }); inHeader = true; continue; }
    if (!cur) continue;
    if (inHeader) { if (m[2].startsWith('##[endgroup]')) inHeader = false; continue; } // the echoed command + env
    cur.lines.push(strip(m[2]));
  }
  const inWindow = sections.filter(s => s.t >= from && s.t <= to);
  const sec = inWindow.find(s => s.lines.some(l => l.startsWith('##[error]'))) || inWindow[0];
  if (!sec) return ['(no log section found for this step)'];
  const lines = sec.lines;
  const fails = lines.filter(l => /✘|##\[error\]/.test(l)).slice(0, 15);
  const last = lines.slice(-tail).filter(l => !fails.includes(l));
  const cut = l => (l.length > 220 ? l.slice(0, 219) + '…' : l);
  return [...fails, ...(fails.length ? ['…'] : []), ...last].map(cut);
}

// ---- minutes ---------------------------------------------------------------------

/** Minutes a set of runs took, billing-style: each job rounded up to a whole minute, times the OS multiplier. */
async function runMinutes(repoPath, since) {
  const runs = await paginate(`${repoPath}/actions/runs?created=${encodeURIComponent('>=' + since.toISOString().slice(0, 10))}`, 'workflow_runs', 2000);
  let minutes = 0, jobsN = 0;
  const queue = [...runs];
  await Promise.all(Array.from({ length: 6 }, async () => {
    for (let r; (r = queue.shift());) {
      const jobs = await paginate(`${repoPath}/actions/runs/${r.id}/jobs?filter=all`, 'jobs', 500);
      for (const j of jobs) {
        if (!j.started_at || !j.completed_at) continue;
        const ms = Date.parse(j.completed_at) - Date.parse(j.started_at);
        if (ms <= 0) continue;
        const labels = (j.labels || []).join(' ').toLowerCase();
        const mult = labels.includes('mac') ? 10 : labels.includes('windows') ? 2 : 1;
        minutes += Math.ceil(ms / 60_000) * mult; jobsN++;
      }
    }
  }));
  return { minutes, runs: runs.length, jobs: jobsN };
}

/** This month's private-repo Actions minutes for the account, from the best source the token can read. */
async function accountMinutes(repoInfo) {
  const user = await me();
  const login = user.login;
  const plan = user.plan?.name?.toLowerCase();
  const quota = FREE_QUOTA[plan] ?? 2000;
  const quotaNote = FREE_QUOTA[plan] ? `${plan} plan` : `${plan ? `"${plan}" plan, ` : ''}Free plan quota assumed`;
  const now = new Date(), since = monthStart();
  const done = (used, source) => ({ used, quota, pct: (used / quota) * 100, source, quotaNote });

  const why = [];
  // 1. Enhanced billing platform
  try {
    const u = await api(`/users/${login}/settings/billing/usage?year=${now.getUTCFullYear()}&month=${now.getUTCMonth() + 1}`);
    const items = (u.usageItems || []).filter(i => /actions/i.test(i.product) && /minute/i.test(i.unitType));
    const publicRepos = new Set((await paginate('/user/repos?affiliation=owner', null)).filter(r => !r.private).map(r => r.name.toLowerCase()));
    const used = items.filter(i => !publicRepos.has(String(i.repositoryName || '').split('/').pop().toLowerCase())).reduce((s, i) => s + (i.quantity || 0), 0);
    return done(Math.round(used), 'billing usage API');
  } catch (e) { if (!(e instanceof ApiError)) throw e; why.push(`billing/usage ${e.status}`); }
  // 2. Legacy billing endpoint
  try {
    const b = await api(`/users/${login}/settings/billing/actions`);
    return { ...done(b.total_minutes_used, 'legacy billing API'), quota: b.included_minutes || quota, pct: (b.total_minutes_used / (b.included_minutes || quota)) * 100 };
  } catch (e) { if (!(e instanceof ApiError)) throw e; why.push(`billing/actions ${e.status}`); }
  // 3. Sum job times across the account's private repos (the token can't read billing)
  const priv = (await paginate('/user/repos?affiliation=owner', null)).filter(r => r.private);
  let used = 0;
  for (const r of priv) used += (await runMinutes(`/repos/${r.full_name}`, since)).minutes;
  return done(used, `job times of ${priv.length} private repo(s), billing API not readable with this token: ${why.join(', ')}`);
}

async function minutesLine() {
  const repoInfo = await api(R);
  const mine = await runMinutes(R, monthStart());
  const acc = await accountMinutes(repoInfo);
  return `minutes: ${full} is ${repoInfo.private ? 'private' : 'public (free)'}, ${mine.minutes} min this month here; ` +
    `private-repo usage ${acc.used}/${acc.quota} (${acc.pct.toFixed(0)}%, ${acc.source})`;
}

async function minutesCmd() {
  const repoInfo = await api(R);
  const user = await me();
  console.log(c.bold('\nActions minutes') + c.dim(`  ${monthStart().toISOString().slice(0, 7)} (UTC), account ${user.login}`));
  console.log(`  ${full}: ${repoInfo.private ? c.yellow('private (uses the quota)') : c.green('public (standard runners are free)')}`);
  const mine = await runMinutes(R, monthStart());
  console.log(`  this repo: ${mine.minutes} min this month` + c.dim(`  (${mine.runs} runs, ${mine.jobs} jobs, each job rounded up to a minute${repoInfo.private ? '' : '; not billed'})`));
  const acc = await accountMinutes(repoInfo);
  const line = `private-repo usage: ${acc.used} / ${acc.quota} min (${acc.pct.toFixed(1)}%), ${Math.max(0, acc.quota - acc.used)} left`;
  console.log(`  ${acc.pct > 80 ? WARN : PASS} ${line}` + c.dim(`  source: ${acc.source}; quota: ${acc.quotaNote}`));
  if (acc.pct > 80) console.log(c.yellow(`  over 80% of the monthly quota: private repos' workflows stop when it runs out`));
  if (user.scopes?.length) console.log(c.dim(`  token scopes: ${user.scopes.join(', ')}`));
  return 0;
}

// ---- status ----------------------------------------------------------------------

async function statusCmd() {
  console.log(c.bold('\nCloud status') + c.dim(`  ${full}`));
  const show = r => {
    const dur = r.status === 'completed' && r.run_started_at ? fmtDur(Date.parse(r.updated_at) - Date.parse(r.run_started_at)) : r.status;
    console.log(`  ${r.status === 'completed' ? mark(r.conclusion) : c.yellow('…')} ${r.created_at.slice(0, 16).replace('T', ' ')}  ${r.event.padEnd(17)} ${r.head_branch.padEnd(32)} ${r.head_sha.slice(0, 7)}  ${dur.padStart(6)}  ${c.dim(r.html_url)}`);
  };
  const main = (await api(`${R}/actions/runs?branch=main&per_page=5`)).workflow_runs;
  console.log(c.cyan(' main'));
  main.forEach(show);
  const ci = (await api(`${R}/actions/runs?event=push&per_page=50`)).workflow_runs.filter(r => r.head_branch?.startsWith('ci/')).slice(0, 5);
  console.log(c.cyan(' ci/*'));
  if (ci.length) ci.forEach(show); else console.log(c.dim('  none'));

  const issues = (await api(`${R}/issues?state=open&per_page=100`)).filter(i => !i.pull_request && /^(Tweetcraft changed|Upstream has new commits)/.test(i.title));
  console.log(c.cyan(' open game-watch issues'));
  if (issues.length) for (const i of issues) console.log(`  ${WARN} #${i.number} ${i.title}` + c.dim(`  ${ago(i.created_at)} ago  ${i.html_url}`));
  else console.log(`  ${PASS} none`);

  const heads = git(['ls-remote', '--heads', 'origin', 'refs/heads/ci/*'], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).stdout.trim().split('\n').filter(Boolean)
    .map(l => { const [sha, ref] = l.split('\t'); return { sha, branch: ref.replace('refs/heads/', '') }; });
  for (const h of heads) {
    const m = h.branch.match(/-(\d{8})-(\d{6})$/);
    h.at = m ? Date.parse(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4)}Z`)
      : Date.parse((await api(`${R}/commits/${h.sha}`)).commit.committer.date);
  }
  const stale = heads.filter(h => Date.now() - h.at > 24 * 3600_000);
  console.log(c.cyan(' ci/* branches'));
  if (!heads.length) console.log(`  ${PASS} none`);
  for (const h of heads) console.log(`  ${stale.includes(h) ? WARN : c.dim('·')} ${h.branch}` + c.dim(`  ${ago(new Date(h.at).toISOString())} old${stale.includes(h) ? ', stale' : ''}`));
  if (stale.length && opts.prune) {
    const r = git(['push', '--quiet', 'origin', '--delete', ...stale.map(h => `refs/heads/${h.branch}`)], { env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
    console.log(r.status === 0 ? `  ${PASS} pruned ${stale.length} stale branch(es)` : `  ${FAIL} prune failed: ${(r.stderr || '').trim()}`);
    if (r.status !== 0) return 1;
  } else if (stale.length) console.log(c.dim(`  delete the stale ones with: npm run cloud -- status --prune`));
  return 0;
}
