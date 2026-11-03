// Read-only GitHub REST helpers for tools/cloud.mjs.
//
// Auth: the token comes from `git credential fill`, run inside this repo so its local Git Credential Manager
// config answers (as the repo's push account), not the global gh helper (another account). It lives only in
// this module's memory: never printed, never written to disk, never passed on a command line, and only ever
// sent to api.github.com (download redirects to other hosts are followed without it). api() refuses anything
// but GET, so nothing here can change the repo; branch pushes and deletes go through plain `git push`.
// Never `gh auth *`, never `git credential approve|reject`, never any git config change.
import { spawnSync } from 'node:child_process';
import { inflateRawSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { ROOT } from './common.mjs';

const API = 'https://api.github.com';
const git = (args, opts = {}) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', ...opts });

/** owner/repo from the origin remote (https or ssh form). */
export function originRepo() {
  const url = git(['remote', 'get-url', 'origin']).stdout.trim();
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i);
  if (!m) throw new Error(`origin is not a GitHub repo: ${url || '(no origin remote)'}`);
  return { owner: m[1], repo: m[2], full: `${m[1]}/${m[2]}` };
}

/** The account this clone pushes as: the repo-local credential username. */
export function pushUser() {
  return git(['config', '--local', '--get', 'credential.https://github.com.username']).stdout.trim() || 'geralt-of-rivia-d';
}

let token = null; // module-private
let verified = false;

function getToken() {
  if (token) return token;
  const user = pushUser();
  const r = git(['credential', 'fill'], {
    input: `protocol=https\nhost=github.com\nusername=${user}\n\n`,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never' },
    timeout: 60_000,
  });
  const pw = r.stdout?.match(/^password=(.+)$/m)?.[1]?.trim();
  const who = r.stdout?.match(/^username=(.+)$/m)?.[1]?.trim();
  if (r.status !== 0 || !pw) {
    throw new Error(`git credential fill gave no GitHub token for ${user}. Sign in once through Git Credential Manager (e.g. git fetch origin), then retry.`);
  }
  if (who && who.toLowerCase() !== user.toLowerCase()) throw new Error(`git credential fill answered for "${who}", expected "${user}"; not using it`);
  token = pw;
  return token;
}

const headers = (accept = 'application/vnd.github+json') => ({
  Authorization: `Bearer ${getToken()}`,
  Accept: accept,
  'X-GitHub-Api-Version': '2022-11-28',
  'User-Agent': 'tweetcraft-scripts-cloud',
});

export class ApiError extends Error {
  constructor(status, path, message) { super(`GitHub API ${status} on GET ${path}: ${message}`); this.status = status; this.path = path; }
}

/** GET a REST path (e.g. "/repos/o/r/actions/runs?per_page=5"). Returns { data, headers }. */
export async function apiRaw(path, { method = 'GET', accept } = {}) {
  if (method !== 'GET') throw new Error('tools/lib/github.mjs is read-only: only GET requests are allowed');
  if (!verified) await verifyIdentity();
  const res = await fetch(API + path, { headers: headers(accept), redirect: 'follow' });
  if (!res.ok) {
    let msg = res.statusText;
    try { msg = (await res.json()).message || msg; } catch {}
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') msg = `rate limit reached; resets at ${new Date(+res.headers.get('x-ratelimit-reset') * 1000).toLocaleTimeString()}`;
    throw new ApiError(res.status, path.split('?')[0], msg);
  }
  const data = res.status === 204 ? null : await res.json();
  return { data, headers: res.headers };
}
export const api = async (path, opts) => (await apiRaw(path, opts)).data;

/** Follow `Link: rel="next"` pages; `key` picks the array out of wrapped responses (e.g. "workflow_runs"). */
export async function paginate(path, key, max = 1000) {
  const out = [];
  let next = path + (path.includes('?') ? '&' : '?') + (/[?&]per_page=/.test(path) ? '' : 'per_page=100');
  while (next && out.length < max) {
    const { data, headers: h } = await apiRaw(next);
    out.push(...(key ? data[key] : data));
    const link = h.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
    next = link ? link.replace(API, '') : null;
  }
  return out.slice(0, max);
}

/** Make sure the token belongs to the push account before using it for anything else. */
async function verifyIdentity() {
  const res = await fetch(API + '/user', { headers: headers() });
  if (!res.ok) { token = null; throw new ApiError(res.status, '/user', res.status === 401 ? 'the stored credential was rejected (sign in again with git fetch origin)' : res.statusText); }
  const me = await res.json();
  const want = pushUser();
  if (String(me.login).toLowerCase() !== want.toLowerCase()) { token = null; throw new Error(`token belongs to "${me.login}", expected "${want}"; not using it`); }
  verified = true;
  userCache = { ...me, scopes: (res.headers.get('x-oauth-scopes') || '').split(',').map(s => s.trim()).filter(Boolean) };
}
let userCache = null;
/** The authenticated user (login, plan if visible) plus the token's OAuth scopes. */
export async function me() { if (!verified) await verifyIdentity(); return userCache; }

/**
 * Download a binary (artifact zip, job log). Only the api.github.com request carries the token; the
 * pre-signed redirect target is fetched without it.
 */
export async function download(path) {
  if (!verified) await verifyIdentity();
  let res = await fetch(API + path, { headers: headers('application/vnd.github+json'), redirect: 'manual' });
  for (let hops = 0; res.status >= 300 && res.status < 400 && hops < 5; hops++) {
    const loc = res.headers.get('location');
    if (!loc) break;
    const url = new URL(loc, API + path);
    res = await fetch(url, url.origin === API ? { headers: headers(), redirect: 'manual' } : { redirect: 'manual' });
  }
  if (!res.ok) throw new ApiError(res.status, path.split('?')[0], res.statusText);
  return Buffer.from(await res.arrayBuffer());
}

/** Extract a zip (stored or deflated entries, as GitHub artifacts are) into dir. Returns the file paths. */
export async function unzip(buf, dir) {
  const root = resolve(dir);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip file');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad zip central directory');
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    if (name.endsWith('/')) continue;
    const out = resolve(root, name);
    if (out !== root && !out.startsWith(root + sep)) throw new Error(`zip entry escapes the target dir: ${name}`);
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw) : null;
    if (!data) throw new Error(`zip entry ${name}: unsupported compression ${method}`);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, data);
    files.push(join(dir, name));
  }
  return files;
}
