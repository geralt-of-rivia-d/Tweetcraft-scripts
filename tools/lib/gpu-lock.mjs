// One real-GPU browser at a time, and no SwiftShader browser while it runs (SwiftShader eats every CPU core
// and would skew GPU timings). launchBrowser() in browser.mjs calls these, so tools rarely need them directly.
//
//   reports/.gpu.lock        held by the one GPU-mode browser   {owner, pid, started}
//   reports/.sw-<pid>.lock   one per process running a software-mode browser
//
// GPU mode creates .gpu.lock exclusively, then waits until no live software lock remains. Software mode writes its
// own lock, then backs off (removes it and waits) while a live .gpu.lock exists. Both write first and check second,
// so two processes starting at the same moment always see each other; software always yields, so it can't deadlock,
// and a waiting GPU run is never starved by a stream of new software runs.
//
// A lock is stale, and is removed, when its pid is dead or its file is older than 20 min. Holders touch their lock
// file every minute, so "older" means "not refreshed": a long bench stays valid, a crashed one whose pid got reused
// doesn't. Locks are released when the browser closes and on process exit (also SIGINT/SIGTERM/SIGHUP/SIGBREAK).
import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPORTS_DIR } from './common.mjs';

export const LOCK_DIR = process.env.TC_LOCK_DIR || REPORTS_DIR; // override only to test the locking itself
export const GPU_LOCK = join(LOCK_DIR, '.gpu.lock');
export const swLockPath = pid => join(LOCK_DIR, `.sw-${pid}.lock`);
export const STALE_MS = 20 * 60e3;
const HEARTBEAT_MS = 60e3;
const POLL_MS = 500;
const NOTE_EVERY_MS = 15e3;

/** Is a process with this pid running? (EPERM means it exists but belongs to someone else.) */
export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Read a lock file: {owner, pid, started, path} or null if missing. Unparseable files report pid 0. */
function readLock(path) {
  let text, mtime;
  try { text = readFileSync(path, 'utf8'); mtime = statSync(path).mtimeMs; } catch { return null; }
  let data = {};
  try { data = JSON.parse(text); } catch {}
  return { owner: String(data.owner ?? '?'), pid: Number(data.pid) || 0, started: data.started ?? null, mtime, path };
}

function isStale(lock) {
  if (!lock) return true;
  const age = Date.now() - lock.mtime;
  if (!lock.pid) return age > 5e3; // half-written by a process that is creating it right now
  return !isAlive(lock.pid) || age > STALE_MS;
}

function removeIfStale(lock) {
  if (lock && isStale(lock)) { try { unlinkSync(lock.path); } catch {} return true; }
  return false;
}

/** Live software locks of other processes (stale ones are removed on the way). */
function liveSoftwareLocks() {
  let names = [];
  try { names = readdirSync(LOCK_DIR).filter(n => /^\.sw-\d+\.lock$/.test(n)); } catch {}
  const out = [];
  for (const n of names) {
    const lock = readLock(join(LOCK_DIR, n));
    if (!lock || removeIfStale(lock)) continue;
    if (lock.pid !== process.pid) out.push(lock);
  }
  return out;
}

/** The live GPU lock, if any (a stale one is removed). */
function liveGpuLock() {
  const lock = readLock(GPU_LOCK);
  return !lock || removeIfStale(lock) ? null : lock;
}

/** What holds the GPU right now: { gpu: lock|null, software: [lock] }. Used by bench to warn about overlap. */
export function lockStatus() {
  return { gpu: liveGpuLock(), software: liveSoftwareLocks() };
}

const describe = l => `${l.owner} (pid ${l.pid}${l.started ? `, since ${new Date(l.started).toLocaleTimeString()}` : ''})`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- what this process holds ------------------------------------------------

const held = { gpu: 0, sw: 0 };
let beat = null, handlersInstalled = false;
const owned = () => [held.gpu && GPU_LOCK, held.sw && swLockPath(process.pid)].filter(Boolean);

function writeLock(path, owner, flag) {
  writeFileSync(path, JSON.stringify({ owner, pid: process.pid, started: new Date().toISOString() }), { flag });
}

/** Remove our lock file, but only if it is still ours (a stale-lock sweep may have handed it to someone else). */
function unlinkOwn(path) {
  const lock = readLock(path);
  if (lock && lock.pid === process.pid) { try { unlinkSync(path); } catch {} }
}

function releaseAllSync() {
  if (held.gpu) unlinkOwn(GPU_LOCK);
  if (held.sw) unlinkOwn(swLockPath(process.pid));
  held.gpu = held.sw = 0;
  if (beat) { clearInterval(beat); beat = null; }
}

function startHeartbeat() {
  if (beat) return;
  beat = setInterval(() => {
    const now = new Date();
    for (const p of owned()) { try { utimesSync(p, now, now); } catch {} }
  }, HEARTBEAT_MS);
  beat.unref();
}

function installExitHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on('exit', releaseAllSync);
  const codes = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129, SIGBREAK: 149 };
  for (const [sig, code] of Object.entries(codes)) {
    try {
      process.on(sig, () => {
        releaseAllSync();
        // Playwright's own SIGINT handler closes Chrome and exits; if nobody else listens, exit ourselves.
        if (process.listenerCount(sig) <= 1) process.exit(code);
        setTimeout(() => process.exit(code), 5000).unref();
      });
    } catch {} // a signal this platform doesn't support
  }
}

function makeRelease(kind) {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    held[kind] = Math.max(0, held[kind] - 1);
    if (!held[kind]) unlinkOwn(kind === 'gpu' ? GPU_LOCK : swLockPath(process.pid));
    if (!held.gpu && !held.sw && beat) { clearInterval(beat); beat = null; }
  };
}

// ---- acquiring ----------------------------------------------------------------

/**
 * Take the exclusive GPU lock, waiting for other GPU holders and every live software-mode browser.
 * Re-entrant within one process. Returns an idempotent release function.
 */
export const acquireGpuLock = opts => reentrant('gpu', () => takeGpu(opts || {}));

/**
 * Register a software-mode (SwiftShader) browser. Waits while another process holds the GPU lock.
 * Re-entrant within one process. Returns an idempotent release function.
 */
export const acquireSoftwareLock = opts => reentrant('sw', () => takeSoftware(opts || {}));

// One acquisition per kind at a time within this process; callers arriving meanwhile wait for it, then share it.
const pending = { gpu: null, sw: null };
async function reentrant(kind, take) {
  for (;;) {
    if (held[kind]) { held[kind]++; return makeRelease(kind); }
    if (!pending[kind]) break;
    try { await pending[kind]; } catch {}
  }
  mkdirSync(LOCK_DIR, { recursive: true });
  installExitHandlers();
  pending[kind] = take();
  try { await pending[kind]; } finally { pending[kind] = null; }
  return makeRelease(kind);
}

async function takeGpu({ owner = processName(), timeoutMs = 120 * 60e3, log = defaultLog }) {
  const t0 = Date.now();
  let noted = 0;
  const note = (what) => {
    if (Date.now() - noted < NOTE_EVERY_MS) return;
    noted = Date.now();
    log(`Waiting for the GPU: ${what} (${Math.round((Date.now() - t0) / 1000)}s so far) ...`);
  };
  // 1. Become the GPU holder.
  for (;;) {
    try { writeLock(GPU_LOCK, owner, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
    }
    const other = liveGpuLock();
    if (other && other.pid === process.pid) { try { unlinkSync(GPU_LOCK); } catch {} continue; } // leftover of ours
    if (other) note(`another GPU run holds it: ${describe(other)}`);
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the GPU lock (${other ? describe(other) : 'reports/.gpu.lock'}).`);
    await sleep(POLL_MS);
  }
  held.gpu = 1;
  startHeartbeat();
  // 2. Let software-mode browsers that already started finish. New ones see our lock and wait.
  for (;;) {
    const sw = liveSoftwareLocks();
    if (!sw.length) break;
    note(`software-mode browser(s) still running: ${sw.map(describe).join(', ')}`);
    if (Date.now() - t0 > timeoutMs) {
      makeRelease('gpu')();
      throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for software-mode browsers to finish: ${sw.map(describe).join(', ')}.`);
    }
    await sleep(POLL_MS);
  }
}

async function takeSoftware({ owner = processName(), timeoutMs = 120 * 60e3, log = defaultLog }) {
  const path = swLockPath(process.pid);
  const t0 = Date.now();
  let noted = 0;
  for (;;) {
    writeLock(path, owner, 'w');
    held.sw = 1;
    const gpu = liveGpuLock();
    if (!gpu || gpu.pid === process.pid) break;
    // Back off so the GPU holder can start, then try again.
    held.sw = 0;
    unlinkOwn(path);
    if (Date.now() - t0 > timeoutMs) throw new Error(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the GPU run ${describe(gpu)} to finish (reports/.gpu.lock).`);
    if (Date.now() - noted >= NOTE_EVERY_MS) {
      noted = Date.now();
      log(`Waiting: a real-GPU run holds the GPU, ${describe(gpu)} (${Math.round((Date.now() - t0) / 1000)}s so far) ...`);
    }
    await sleep(POLL_MS);
  }
  startHeartbeat();
}

function processName() {
  const script = (process.argv[1] || 'node').split(/[\\/]/).pop();
  const args = process.argv.slice(2).join(' ');
  return `${script}${args ? ' ' + args : ''}`.slice(0, 200);
}

function defaultLog(msg) {
  process.stderr.write(`${msg}\n`);
}
