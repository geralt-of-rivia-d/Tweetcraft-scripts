// Shared reading of bench reports (reports/bench-*.json): verdicts, settings and script versions, so bench.mjs and
// bench-history.mjs judge rows the same way.

// Uncapped "holds 60" = median <= 14 ms and p95gb2 <= 16.7 ms (row.holds60; the older p95gb rule is row.holds60gb).
// Vsync "holds 60" = median 16.7 +- 0.5 ms and miss% (intervals > 20 ms, all frames) <= 1%.
export const HOLD_MED = 14, HOLD_P95 = 16.7, MISS_MS = 20, HITCH_MS = 50, VSYNC_MED = 16.7, VSYNC_MED_TOL = 0.5, VSYNC_MISS_PCT = 1;
export const HOLDS_RULE = 'med<=14 && p95gb2<=16.7';

export function holds60Of(med, p95gb2) { return typeof med === 'number' && typeof p95gb2 === 'number' ? med <= HOLD_MED && p95gb2 <= HOLD_P95 : null; }
export function holds60VsyncOf(med, missPct) { return typeof med === 'number' && typeof missPct === 'number' ? Math.abs(med - VSYNC_MED) <= VSYNC_MED_TOL && missPct <= VSYNC_MISS_PCT : null; }

/** "Holds 60" as printed: uncapped = median <= 14 and p95gb2 <= 16.7; a report from before p95gb2 shows its old p95gb verdict as "yes(gb)". */
export function holdsText(r) {
  if (r.vsync) return r.holds60Vsync === null || r.holds60Vsync === undefined ? '-' : r.holds60Vsync ? 'yes' : 'no';
  if (typeof r.p95gb2 === 'number') { const h = holds60Of(r.med, r.p95gb2); return h === null ? '-' : h ? 'yes' : 'no'; }
  return r.holds60 === null || r.holds60 === undefined ? '-' : `${r.holds60 ? 'yes' : 'no'}(gb)`;
}

/**
 * The game settings a row ran with. Bench JSONs from before --rd/--fov carry none: they ran at the game's defaults
 * on a fresh profile, rd 8 and FOV 70.
 */
export function settingsOf(r, env) {
  if (r && r.settings) return r.settings;
  return { rd: env?.rd ?? 8, fov: env?.fov ?? 70, heldLight: env?.heldLight ?? null };
}
export function sameSettings(a, b) { return a.rd === b.rd && a.fov === b.fov && (a.heldLight || 'on') === (b.heldLight || 'on'); }
export const settingsText = s => `rd ${s.rd}, FOV ${s.fov}${s.heldLight ? `, held light ${s.heldLight}` : ''}`;

/** The shader script's version in a report's env (null for vanilla-only runs). */
export function shaderVersion(env) {
  const s = (env?.scripts || []).find(x => /shader|twitterentary/i.test(`${x.file || ''} ${x.name || ''}`));
  return s ? s.version : null;
}

export function fmt(v, p) { return v === null || v === undefined || !Number.isFinite(v) ? '-' : v.toFixed(p); }
export function round(v, p) { return v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(p)); }
