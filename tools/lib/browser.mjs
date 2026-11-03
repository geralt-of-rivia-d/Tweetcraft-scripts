// Headless Chrome helpers: open the game with WebGL2, inject userscripts, record shader programs.
import { chromium } from 'playwright-core';
import { acquireGpuLock, acquireSoftwareLock } from './gpu-lock.mjs';

// Software WebGL so this works on machines and CI runners without a GPU.
const ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio'];

// Real-GPU mode (bench, GPU experiments): the real ANGLE backend, no frame cap, no throttling of a window that is
// occluded or in the background, and DPR 1 so 1920x1080 CSS px are 1920x1080 device px. `vsync: true` keeps the
// display's vsync and Chrome's frame-rate limit (drops --disable-gpu-vsync and --disable-frame-rate-limit), so frames
// are paced like a player's browser (60 Hz on this laptop). Don't add a
// --disable-features flag here: Chrome keeps only the last one, which would drop Playwright's own list.
export const ANGLE_BACKENDS = ['d3d11', 'd3d9', 'gl', 'vulkan', 'metal', 'swiftshader'];
const UNCAP_ARGS = ['--disable-gpu-vsync', '--disable-frame-rate-limit'];
const gpuArgs = (angle, vsync) => [
  `--use-angle=${angle}`,
  '--ignore-gpu-blocklist',
  ...(vsync ? [] : UNCAP_ARGS),
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  '--disable-background-timer-throttling',
  '--force-device-scale-factor=1',
  '--window-position=0,0',
  '--mute-audio',
];

/**
 * Launch installed Google Chrome; fall back to a Playwright-managed Chromium if present.
 *
 * Software mode (default): SwiftShader, headless unless `headed`. Registers reports/.sw-<pid>.lock and first waits
 * while a real-GPU run holds reports/.gpu.lock (see gpu-lock.mjs).
 * GPU mode (`gpu: true`): the real GPU through ANGLE `angle` (d3d11 | gl | vulkan ...), headed unless
 * `headless: true`, uncapped unless `vsync: true`. Waits for and holds the exclusive GPU lock. `args` are appended
 * either way.
 * The lock is released when the browser disconnects (close, crash) and on process exit.
 */
export async function launchBrowser({ headed = false, gpu = false, angle = 'd3d11', headless, vsync = false, args = [], windowSize = [1920, 1080], owner, lockTimeoutMs, log } = {}) {
  if (gpu && !ANGLE_BACKENDS.includes(angle)) throw new Error(`Unknown ANGLE backend "${angle}". Use one of: ${ANGLE_BACKENDS.join(', ')}`);
  const lockOpts = { owner, timeoutMs: lockTimeoutMs, log };
  for (const k of Object.keys(lockOpts)) if (lockOpts[k] === undefined) delete lockOpts[k];
  const release = gpu ? await acquireGpuLock(lockOpts) : await acquireSoftwareLock(lockOpts);
  const opts = gpu
    ? { headless: headless === true, args: [...gpuArgs(angle, vsync), ...(windowSize ? [`--window-size=${windowSize[0]},${windowSize[1]}`] : []), ...args] }
    : { headless: !headed, args: [...ARGS, ...args] };
  let browser;
  try {
    try {
      browser = await chromium.launch({ ...opts, channel: 'chrome' });
    } catch (chromeErr) {
      try {
        browser = await chromium.launch(opts);
      } catch {
        throw new Error(`Could not start Google Chrome (${chromeErr.message.split('\n')[0]}). Install Chrome, or run "npx playwright-core install chromium".`);
      }
    }
  } catch (e) {
    release();
    throw e;
  }
  browser.on('disconnected', release);
  return browser;
}

// Runs in the page before anything else. Wraps linkProgram to record each program's final
// vertex/fragment source and compile/link status. It sits *under* any userscript wrappers,
// so it sees exactly what reaches the GPU (patched source if a userscript patched it).
function recorder() {
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (!P || window.__tcwatch || window.top !== window) return; // the game renders in the top frame
  const N = {};
  for (const k of ['shaderSource', 'linkProgram', 'getAttachedShaders', 'getShaderParameter', 'getShaderInfoLog', 'getProgramParameter', 'getProgramInfoLog']) N[k] = P[k];
  const sources = new WeakMap();
  const ids = new WeakMap();
  let nextId = 0;
  const W = (window.__tcwatch = { programs: new Map() });
  P.shaderSource = function (shader, source) {
    sources.set(shader, source);
    return N.shaderSource.call(this, shader, source);
  };
  P.linkProgram = function (program) {
    const result = N.linkProgram.call(this, program);
    try {
      if (!ids.has(program)) ids.set(program, nextId++);
      const rec = {
        id: ids.get(program),
        linked: !!N.getProgramParameter.call(this, program, this.LINK_STATUS),
        log: N.getProgramInfoLog.call(this, program) || '',
      };
      for (const s of N.getAttachedShaders.call(this, program) || []) {
        const kind = N.getShaderParameter.call(this, s, this.SHADER_TYPE) === this.VERTEX_SHADER ? 'vs' : 'fs';
        rec[kind] = {
          source: sources.get(s) ?? '',
          compiled: !!N.getShaderParameter.call(this, s, this.COMPILE_STATUS),
          log: N.getShaderInfoLog.call(this, s) || '',
        };
      }
      W.programs.set(rec.id, rec);
    } catch {}
    return result;
  };
}

/**
 * Open the game. `userscripts` are injected at document-start in the given order, like
 * Tampermonkey's @run-at document-start. Each gets a sourceURL so errors can be traced to it.
 * `initScripts` (functions or `{content}`) run before the shader recorder and the userscripts, so anything they
 * wrap (requestAnimationFrame, getContext) sits under every userscript wrapper. `viewport`/`deviceScaleFactor`
 * default to 1280x720 at the browser's own DPR.
 */
export async function openGame(browser, url, { userscripts = [], timeoutMs = 60000, settleMs = 2500, minPrograms = 0, viewport = { width: 1280, height: 720 }, deviceScaleFactor, initScripts = [], fullscreen = false } = {}) {
  const context = await browser.newContext({ viewport, ...(deviceScaleFactor ? { deviceScaleFactor } : {}) });
  const page = await context.newPage();
  if (fullscreen) await setFullscreen(page);
  for (const s of initScripts) await page.addInitScript(s);
  const consoleMsgs = [];
  const pageErrors = [];
  page.on('console', m => {
    const loc = m.location();
    consoleMsgs.push({ type: m.type(), text: m.text(), url: loc.url || '', line: loc.lineNumber });
  });
  page.on('pageerror', e => pageErrors.push({ message: e.message, stack: e.stack || '' }));

  await page.addInitScript(recorder);
  for (const s of userscripts) {
    await page.addInitScript({ content: `${s.source}\n//# sourceURL=userscript:///${s.file}` });
  }
  await page.goto(url.replace(/\/?$/, '/'), { waitUntil: 'load', timeout: timeoutMs });
  const programs = await waitForShaders(page, { timeoutMs, settleMs, minPrograms });
  return { context, page, consoleMsgs, pageErrors, programs };
}

/**
 * Put a headed page's window into real browser fullscreen (like F11: no tabs or borders, the page covers the
 * screen), through the DevTools protocol. Use with `viewport: null`, so the page takes the window's size. (Chrome's
 * --start-fullscreen flag is not applied to the windows Playwright opens for new contexts.) Returns the window bounds.
 */
export async function setFullscreen(page) {
  const cdp = await page.context().newCDPSession(page);
  try {
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'fullscreen' } });
    await page.waitForTimeout(500);
    return (await cdp.send('Browser.getWindowBounds', { windowId })).bounds;
  } finally {
    await cdp.detach().catch(() => {});
  }
}

/**
 * Wait until at least `minPrograms` programs are linked and the count has stopped changing.
 * The game links a second batch of programs a few seconds after the first, and later still
 * when userscripts slow startup, so pass the count from a vanilla snapshot when you have it.
 */
export async function waitForShaders(page, { settleMs = 2500, timeoutMs = 60000, minPrograms = 0 } = {}) {
  const t0 = Date.now();
  let last = -1, stableSince = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const n = await page.evaluate(() => (window.__tcwatch ? window.__tcwatch.programs.size : 0));
    if (n !== last) { last = n; stableSince = Date.now(); }
    else if (n > 0 && n >= minPrograms && Date.now() - stableSince >= settleMs) return n;
    await page.waitForTimeout(250);
  }
  return last;
}

export const readPrograms = page =>
  page.evaluate(() => [...(window.__tcwatch ? window.__tcwatch.programs.values() : [])]);

/** Did the game boot? Returns the text of its fatal-error panel if it is showing. */
export const readFatal = page =>
  page.evaluate(() => {
    const f = document.getElementById('fatal');
    return f && !f.classList.contains('off') && f.textContent.trim() ? f.textContent.trim() : null;
  });

/**
 * Short name for a program, for file names and reports: a known kind (terrain/sky/cloud,
 * matching the shader userscript's own detection) or its most distinctive uniform names.
 */
export function labelProgram(p) {
  const vs = p.vs?.source || '', fs = p.fs?.source || '';
  if (/aPos\s*&\s*uvec3/.test(vs)) return 'terrain';
  if (/uniform\s+vec3\s+uTop\s*,\s*uHor\s*;/.test(fs)) return 'sky';
  if (fs.includes('uTint, uHole')) return 'cloud';
  const uniforms = [...`${vs}\n${fs}`.matchAll(/uniform\s+(?:\w+\s+)?\w+\s+([\w\s,]+?)\s*;/g)].flatMap(m => m[1].split(',').map(s => s.trim()));
  const distinct = [...new Set(uniforms)].filter(u => !/^u(VP|MVP|Inv|Tex|Texel|Fog|FogR|Origin|Cam|Time)$/.test(u));
  return distinct.length ? distinct.slice(0, 2).map(u => u.replace(/^u/, '').toLowerCase()).join('-') : 'textured';
}
