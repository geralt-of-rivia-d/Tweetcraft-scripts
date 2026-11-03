// This laptop's benchmark profile (tools/lib/machine-profile.json, written by the analysis of past reports) and the
// bench protocols built on it. bench.mjs reads it for --protocol defaults and the preflight's vanilla calibration.
// Every number has a built-in fallback, so the bench runs (with a note) when the file is missing or partial.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const PROFILE_PATH = fileURLToPath(new URL('./machine-profile.json', import.meta.url));

// Built-in protocol defaults, used for every field the profile leaves out (or null).
//   seconds/warmup/repeat/cooldown: as the bench flags.
//   warp: fast-forward factor for the title camera's clock before the scenario is applied (1 = off, the legacy wait).
//   settle: real seconds between applying the scenario and measuring (warm-up included) when warping.
//   earlyStop: with repeat >= 3, stop after pass 2 when both passes agree (see bench.mjs earlyStopCheck).
//   vsync_seconds / vsync_repeat: the --vsync pass that accept runs after the uncapped one.
export const PROTOCOL_DEFAULTS = {
  screen: { seconds: 5, warmup: 2, repeat: 1, cooldown: 0, warp: 10, settle: 12, earlyStop: false },
  accept: { seconds: 8, warmup: 2, repeat: 3, cooldown: 30, warp: 10, settle: 12, earlyStop: true, vsync_seconds: 30, vsync_repeat: 1 },
};
// Fallbacks for the noise and thermal fields (the 1-pass spread seen in the 1.4.0/1.5 reports: medians within
// +-2-6%, p95gb about twice that).
export const NOISE_DEFAULTS = { med_pct: 6, p95gb2_pct: 10, gpuMs_pct: 6 };
export const THERMAL_DEFAULTS = { cooldown_s: 30 };

/** Read the profile: { profile, path, error }. A missing file is not an error (profile null). */
export function loadProfile(path = PROFILE_PATH) {
  if (!existsSync(path)) return { profile: null, path, error: null };
  try { return { profile: JSON.parse(readFileSync(path, 'utf8')), path, error: null }; } catch (e) { return { profile: null, path, error: e.message.split(/\r?\n/)[0] }; }
}

const POSITIVE = new Set(['seconds', 'repeat', 'warp', 'settle', 'vsync_seconds', 'vsync_repeat']);
const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const pick = (...vs) => vs.find(v => v !== undefined && v !== null);

/** The protocol's settings: profile values over the built-in ones; each value says where it came from. */
export function protocolSettings(name, profile) {
  const base = PROTOCOL_DEFAULTS[name];
  if (!base) return null;
  const p = profile?.protocol?.[name] || {};
  const out = {}, from = {};
  for (const k of Object.keys(base)) {
    let v = typeof base[k] === 'boolean' ? (typeof p[k] === 'boolean' ? p[k] : undefined) : num(p[k]);
    if (POSITIVE.has(k) && !(v > 0)) v = undefined; // the profile template's 0 placeholders mean "not set"
    out[k] = v !== undefined ? v : base[k];
    from[k] = v !== undefined ? 'profile' : 'built-in';
  }
  return { ...out, from, why: p.why || null };
}

export function noiseOf(profile) {
  const n = profile?.noise || {};
  return { med_pct: pick(num(n.med_pct) || undefined, NOISE_DEFAULTS.med_pct), p95gb2_pct: pick(num(n.p95gb2_pct) || undefined, NOISE_DEFAULTS.p95gb2_pct), gpuMs_pct: pick(num(n.gpuMs_pct) || undefined, NOISE_DEFAULTS.gpuMs_pct) };
}
export function cooldownOf(profile) { return pick(num(profile?.thermal?.cooldown_s) || undefined, THERMAL_DEFAULTS.cooldown_s); }

/** Does the profile describe this machine? (machine.gpu is a substring of the renderer string.) */
export function gpuMatches(profile, gpu) {
  const want = profile?.machine?.gpu;
  if (!want || !gpu) return null;
  return String(gpu).toLowerCase().includes(String(want).toLowerCase());
}

/** Is this run at the profile's standard (the conditions its vanilla ranges were measured in)? Returns a reason or ''. */
export function offStandard(profile, { rd, fov, w, h, vsync, angle, headless }) {
  const st = { rd: 12, fov: 80, w: 1920, h: 1080, ...(profile?.standard || {}) };
  const why = [];
  if (rd !== st.rd) why.push(`rd ${rd} (profile: ${st.rd})`);
  if (fov !== st.fov) why.push(`FOV ${fov} (profile: ${st.fov})`);
  if (w !== st.w || h !== st.h) why.push(`${w}x${h} (profile: ${st.w}x${st.h})`);
  if (vsync) why.push('vsync (vanilla is pinned at 16.7 ms)');
  if (angle !== (profile?.machine?.angle || 'd3d11')) why.push(`ANGLE ${angle}`);
  if (headless) why.push('headless');
  return why.join(', ');
}

/**
 * Judge a vanilla row against the profile's vanilla ranges ({med, p95gb2, gpuMs}: [lo, hi]).
 * Returns { ok, checked: {metric: {value, range, verdict}}, slow: [text], fast: [text], worstPct } where `slow`
 * lists metrics above the range (throttled / loaded machine) and `fast` those below it (just noted).
 */
export function checkVanilla(row, profile) {
  const ranges = profile?.vanilla || {};
  const checked = {}, slow = [], fast = [];
  let worstPct = 0;
  for (const k of ['med', 'p95gb2', 'gpuMs']) {
    const r = ranges[k], v = row?.[k];
    if (!Array.isArray(r) || r.length !== 2 || typeof r[0] !== 'number' || typeof r[1] !== 'number' || typeof v !== 'number') continue;
    const [lo, hi] = r;
    let verdict = 'in range';
    if (v > hi) { verdict = 'slow'; const pct = (v / hi - 1) * 100; worstPct = Math.max(worstPct, pct); slow.push(`${k} ${v.toFixed(2)} ms > ${hi} (+${pct.toFixed(0)}%)`); }
    else if (v < lo) { verdict = 'fast'; fast.push(`${k} ${v.toFixed(2)} ms < ${lo}`); }
    checked[k] = { value: v, range: r, verdict };
  }
  return { ok: !slow.length, any: Object.keys(checked).length > 0, checked, slow, fast, worstPct: Math.round(worstPct) };
}
