// ==UserScript==
// @name         Tweetcraft Better Options
// @namespace    tweetcraft.twitterentary
// @version      1.1.0
// @description  Adds a custom options menu for graphics, interface, keybinds, shaders, and zoom settings.
// @author       Twitterentary
// @match        https://tweetcraft.jai.vin/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const TAG = '[BetterOptions]';
  const MENU_NAME = 'tcoptions';
  const STORE_KEY = 'tc.options';
  const SHADER_PREFIX = 'tc.shader.';
  const RDS = [4, 6, 8, 10, 12];
  const VERSION = (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || '0.0.0';

  const DEFAULTS = {
    'ui.scale': 1,
    'hud.on': true,
    'input.sens': 1,
    'keys.map': {},
    'keys.mute': []
  };

  let cfg = {};
  try { cfg = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { cfg = {}; }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {} };
  const clone = v => (v && typeof v === 'object') ? JSON.parse(JSON.stringify(v)) : v;

  const sections = [];
  const keybinds = [];
  const subs = [];

  const bus = {
    version: VERSION,
    apiVersion: 2,
    get config() { return cfg; },
    get: (k, d) => (cfg[k] !== undefined ? cfg[k] : (DEFAULTS[k] !== undefined ? clone(DEFAULTS[k]) : d)),
    set(k, v) { cfg[k] = v; save(); emit(k, v); },
    // Back to the defaults; every key that was set is re-announced so subscribers re-read it.
    reset() {
      const prev = Object.keys(cfg);
      cfg = clone(DEFAULTS);
      save();
      for (const k of prev) emit(k, bus.get(k));
    },
    register(sec) { if (sec && sec.id && !sections.some(s => s.id === sec.id)) { sections.push(sec); emit('__sections'); } },
    registerKeybind(kb) { if (kb && kb.id && !keybinds.some(k => k.id === kb.id)) { keybinds.push(kb); emit('__keybinds'); } },
    changed(cb) { subs.push(cb); },
    open: () => openMenu(),
    toast,
    fov: null,
    capturing: false,
    ui: null
  };
  function emit(k, v) { for (const f of subs) { try { f(k, v); } catch (e) {} } }
  window.__tcOptions = bus;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };
  const isTyping = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  const $ = sel => document.querySelector(sel);

  function toast(text) {
    const n = document.getElementById('note');
    if (n) {
      try {
        n.textContent = text;
        n.classList.add('show');
        clearTimeout(toast._t);
        toast._t = setTimeout(() => n.classList.remove('show'), 2000);
        return;
      } catch (e) {}
    }
    console.log(TAG, text);
  }

  let _menus = null, _menusPending = null, _menusOverride = false;
  function domReady() {
    if (document.readyState !== 'loading') return Promise.resolve();
    return new Promise(res => document.addEventListener('DOMContentLoaded', res, { once: true }));
  }
  function menus() {
    if (_menus) return Promise.resolve(_menus);
    if (_menusPending) return _menusPending;
    _menusPending = (async () => {
      await domReady();
      try { const m = await import('/js/menus.js'); if (!_menusOverride) _menus = m; }
      catch (e) { console.warn(TAG, 'menus import failed', e); if (!_menusOverride) _menus = null; }
      return _menus;
    })();
    return _menusPending;
  }
  menus();
  bus._injectMenus = (m) => { _menusOverride = true; _menus = m; _menusPending = Promise.resolve(m); };

  // ---- the game's translations: pause-menu labels we look for, in the player's language
  let _i18n = null, _i18nPending = null;
  function i18n() {
    if (_i18n) return Promise.resolve(_i18n);
    if (_i18nPending) return _i18nPending;
    _i18nPending = (async () => {
      await domReady();
      try { const m = await import('/js/i18n.js'); _i18n = (m && typeof m.t === 'function') ? m : null; }
      catch (e) { console.warn(TAG, 'i18n import failed, using English labels', e); _i18n = null; }
      return _i18n;
    })();
    return _i18nPending;
  }
  // English labels always stay in the sets, as the fallback.
  function makeLabels(I) {
    const options = new Set(['Options…', 'Options...']);
    const full = new Set(['Fullscreen', 'Exit Fullscreen']);
    const dist = new Map();
    for (const n of RDS) dist.set('Distance: ' + n, n);
    const tr = (key, params) => {
      try {
        const s = I && typeof I.t === 'function' ? I.t(key, params) : null;
        return (typeof s === 'string' && s && s !== key) ? s : null;
      } catch (e) { return null; }
    };
    const o = tr('pause.options');
    if (o) options.add(o);
    for (const k of ['pause.full', 'pause.exitFull']) { const s = tr(k); if (s) full.add(s); }
    for (const n of RDS) { const s = tr('pause.distance', { n }); if (s) dist.set(s, n); }
    return { options, full, dist };
  }
  let LBL = makeLabels(null);
  const relabel = () => { if (_i18n) LBL = makeLabels(_i18n); };

  // Hides the pause menu's Distance and Fullscreen buttons (they live in our menu) in any language.
  let i18nStyle = null;
  function applyLabelCss() {
    try {
      const esc = (window.CSS && typeof CSS.escape === 'function') ? CSS.escape : s => String(s).replace(/["\\]/g, '\\$&');
      const sel = [];
      for (const s of LBL.dist.keys()) sel.push('#screen .inner button[aria-label="' + esc(s) + '"]');
      for (const s of LBL.full) sel.push('#screen .inner button[aria-label="' + esc(s) + '"]');
      const css = sel.join(',\n') + ' { display: none !important; }';
      if (!i18nStyle) {
        i18nStyle = document.createElement('style');
        i18nStyle.id = 'tc-options-i18n';
        (document.head || document.documentElement).append(i18nStyle);
      }
      if (i18nStyle.textContent !== css) i18nStyle.textContent = css;
    } catch (e) { console.warn(TAG, 'label CSS failed', e); }
  }
  async function initLabels() {
    const I = await i18n();
    if (!I) return;
    relabel();
    applyLabelCss();
    try {
      if (typeof I.onLocaleChange === 'function') I.onLocaleChange(() => { try { relabel(); applyLabelCss(); } catch (e) {} });
    } catch (e) { console.warn(TAG, 'onLocaleChange failed', e); }
  }
  bus._labels = () => ({ options: [...LBL.options], full: [...LBL.full], dist: [...LBL.dist], css: i18nStyle ? i18nStyle.textContent : '' });

  const ourMenuOpen = () => !!$('#screen .inner .tc-marker');

  let fovCache = (() => { const v = Number(store.get('mc.fov')); return v >= 30 && v <= 110 ? v : 70; })();
  const getFov = () => fovCache;
  // The game's own Options screen writes mc.fov too; pick that up before showing our slider.
  // 30-110 like the game's own load check: a reload while zoomed can leave a transient low value in mc.fov.
  function syncFov() { const v = Number(store.get('mc.fov')); if (v >= 30 && v <= 110) fovCache = v; }
  let fovInput;
  async function stealFovInput() {
    if (fovInput !== undefined) return fovInput;
    const M = await menus();
    if (!M) { fovInput = null; return null; }
    const wasOurs = ourMenuOpen();
    const gl = document.getElementById('gl');
    const wasLocked = !!gl && document.pointerLockElement === gl;
    fovInput = null;
    try {
      M.openOptions();
      const el = $('#screen .inner input[type="range"][data-k="fov"]');
      if (el) { el.min = '5'; el.step = 'any'; fovInput = el; }
    } catch (e) { console.warn(TAG, e); }
    try { if (wasOurs) M.showScreen(MENU_NAME, buildScreen, 'dim'); else M.closeMenu(); } catch (e) {}
    if (wasLocked && gl && gl.requestPointerLock) { try { gl.requestPointerLock(); } catch (e) {} }
    return fovInput;
  }
  async function setFov(v) {
    v = Math.max(2, Math.min(110, Number(v) || 70));
    fovCache = v; store.set('mc.fov', v);
    const inp = await stealFovInput();
    if (inp) { inp.value = String(v); inp.dispatchEvent(new Event('input', { bubbles: true })); }
  }
  bus.fov = { get: getFov, set: setFov };

  const currentRd = () => { const v = Number(store.get('mc.rd')); return RDS.includes(v) ? v : 8; };
  // The pause menu's Distance button, found by its label in the current language.
  function distanceButton() {
    for (const b of document.querySelectorAll('#screen .inner button[aria-label]')) {
      if (LBL.dist.has(b.getAttribute('aria-label'))) return b;
    }
    return null;
  }
  async function setRenderDistance(target) {
    if (!RDS.includes(target)) target = RDS[0];
    const M = await menus();
    if (!M) { toast('Options unavailable'); return; }
    await i18n();
    relabel();
    const wasOurs = ourMenuOpen();
    try {
      M.openPause();
      let guard = 0;
      while (guard++ < 12) {
        const b = distanceButton();
        if (!b) break;
        const cur = LBL.dist.get(b.getAttribute('aria-label'));
        if (cur === target) break;
        b.click();
      }
    } catch (e) { console.warn(TAG, e); }
    store.set('mc.rd', target);
    try { if (wasOurs) M.showScreen(MENU_NAME, buildScreen, 'dim'); else M.closeMenu(); } catch (e) {}
  }
  bus._setRenderDistance = t => setRenderDistance(t);

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch (e) { toast("Fullscreen isn't allowed here"); }
    refresh();
  }
  // The game only toggles its HUD on a real F1 while no menu is open: close, press, reopen ours.
  // onlyIfHidden: press only when the game's HUD is really hidden (closeMenu() runs updateTop(), which sets
  // #hudtop.hidden = !(in world && showHud)); our saved hud.on can be stale, and a missing #hudtop means
  // we can't tell, so we leave the HUD alone.
  async function sendF1(onlyIfHidden) {
    const M = await menus();
    if (!M) return;
    const wasOurs = ourMenuOpen();
    try {
      M.closeMenu();
      const top = document.getElementById('hudtop');
      if (!onlyIfHidden || (top && top.hidden)) {
        const down = new KeyboardEvent('keydown', { code: 'F1', key: 'F1', bubbles: true });
        down.__tc = true;
        window.dispatchEvent(down);
        const up = new KeyboardEvent('keyup', { code: 'F1', key: 'F1', bubbles: true });
        up.__tc = true;
        window.dispatchEvent(up);
      }
    } catch (e) { console.warn(TAG, e); }
    try { if (wasOurs) M.showScreen(MENU_NAME, buildScreen, 'dim'); } catch (e) {}
  }
  async function toggleHud() {
    bus.set('hud.on', !bus.get('hud.on', true));
    await sendF1();
  }

  let uiTimer = 0;
  const TOUCH_PARAM = (() => { try { return new URLSearchParams(location.search).has('touch'); } catch (e) { return false; } })();
  const isTouch = () => !!(window.matchMedia && matchMedia('(pointer: coarse)').matches) || TOUCH_PARAM;
  const defaultRd = () => (isTouch() ? 6 : 8);
  function uiMult() { return Math.max(0.5, Math.min(3, Number(bus.get('ui.scale', 1)) || 1)); }
  function uiBase() {
    const full = window.devicePixelRatio || 1;
    const t = isTouch();
    const raw = Math.max(t ? 2 : 1, Math.min(3, Math.min(innerWidth / 280, innerHeight / 190)));
    const u = Math.max(1, Math.round(raw * full)) / full;
    const d = Math.max(1, Math.round(u * full) - 1) / full;
    const hpx = Math.max(t ? 2 : 1, Math.round((t ? 1.75 : 1.25) * full));
    return { u, d, hp: hpx / full };
  }
  function applyUiScale() {
    const m = uiMult(), b = uiBase(), root = document.documentElement.style;
    root.setProperty('--u', (b.u * m) + 'px');
    root.setProperty('--d', (b.d * m) + 'px');
    root.setProperty('--tc-s', String(m));
    const scr = document.getElementById('screen');
    if (scr) rescaleLabels(scr);
  }
  function reassertUiScale() {
    const m = uiMult();
    if (m === 1) return;
    const b = uiBase(), root = document.documentElement.style;
    const near = (cur, want) => Math.abs(parseFloat(cur) - want) < 0.02;
    if (!near(root.getPropertyValue('--u'), b.u * m)) root.setProperty('--u', (b.u * m) + 'px');
    if (!near(root.getPropertyValue('--d'), b.d * m)) root.setProperty('--d', (b.d * m) + 'px');
    if (root.getPropertyValue('--tc-s') !== String(m)) root.setProperty('--tc-s', String(m));
  }

  let hudPatched = false, _uiOverride = null, capturedFont = null;
  function noteFont(f) { if (f && typeof f.draw === 'function' && typeof f.width === 'function') capturedFont = f; }
  const hudScale = (gs, m) => (typeof gs !== 'number' || m === 1) ? gs : Math.max(1, Math.round(gs * m));
  async function patchHudScale() {
    if (hudPatched) return;
    try {
      const ui = _uiOverride || await import('/js/ui.js');
      const P = ui && ui.Hud && ui.Hud.prototype;
      if (!P) return;
      if (P.draw && !P.draw.__tcScaled) {
        const orig = P.draw;
        const fn = function (o) {
          noteFont(this && this.font);
          const m = uiMult();
          if (m !== 1 && o && typeof o.gs === 'number') o = Object.assign({}, o, { gs: hudScale(o.gs, m) });
          return orig.call(this, o);
        };
        fn.__tcScaled = true; P.draw = fn;
      }
      const wrapScale = (name, argIndex) => {
        const orig = P[name]; if (!orig || orig.__tcScaled) return;
        const fn = function (...args) { const m = uiMult(); if (m !== 1 && typeof args[argIndex] === 'number') args[argIndex] = hudScale(args[argIndex], m); return orig.apply(this, args); };
        fn.__tcScaled = true; P[name] = fn;
      };
      wrapScale('suggestions', 0); wrapScale('tab', 1); wrapScale('hint', 1);
      hudPatched = true;
    } catch (e) {}
  }

  let survPatched = false, _survOverride = null;
  async function patchSurvivalScale() {
    if (survPatched) return;
    try {
      const mod = _survOverride || await import('/js/survival/client.js');
      const P = mod && mod.SurvivalClient && mod.SurvivalClient.prototype;
      if (!P || !P.drawHud) return;
      if (!P.drawHud.__tcScaled) {
        const orig = P.drawHud;
        const fn = function (hud, font, gs) {
          noteFont(font || (hud && hud.font));
          return orig.call(this, hud, font, hudScale(gs, uiMult()));
        };
        fn.__tcScaled = true; P.drawHud = fn;
      }
      survPatched = true;
    } catch (e) {}
  }

  function redrawButtonLabels(btn) {
    if (!capturedFont || !btn || btn.tagName !== 'BUTTON') return;
    if (btn.classList.contains('hb')) return;
    const text = btn.getAttribute('aria-label') || '';
    if (!text) return;
    const m = uiMult();
    for (const c of Array.from(btn.children)) {
      if (!c || c.tagName !== 'CANVAS') continue;
      const fw = capturedFont.width(text);
      if (c.__tcPx == null) {
        const px0 = c.width / Math.max(1, fw + 1);
        if (Math.abs(c.height - 9 * px0) > 1 || Math.abs(c.width - (fw + 1) * px0) > Math.max(1, px0)) continue;
        c.__tcPx = px0;
      }
      const px = Math.max(1, c.__tcPx * m);
      const color = c.classList.contains('hi') ? '#ffffa0' : (btn.disabled ? '#a0a0a0' : '#ffffff');
      const W = Math.max(1, Math.round((fw + 1) * px));
      const H = Math.max(1, Math.round(9 * px));
      if (c.width !== W) c.width = W;
      if (c.height !== H) c.height = H;
      const ctx = c.getContext('2d');
      if (!ctx) continue;
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, W, H);
      capturedFont.draw(ctx, text, 0, 0, px, color, true);
      const dpr = window.devicePixelRatio || 1;
      c.style.width = (W / dpr) + 'px';
      c.style.height = (H / dpr) + 'px';
    }
  }
  function rescaleLabels(root) {
    if (!capturedFont || !root || root.nodeType !== 1) return;
    if (root.matches && root.matches('button.mcb')) redrawButtonLabels(root);
    if (root.querySelectorAll) for (const b of root.querySelectorAll('button.mcb')) redrawButtonLabels(b);
  }
  let labelObserver = null;
  function startLabelObserver() {
    if (labelObserver || !window.MutationObserver) return;
    const screen = document.getElementById('screen');
    if (!screen) return;
    labelObserver = new MutationObserver(muts => {
      for (const mu of muts) for (const n of mu.addedNodes) {
        if (!n || n.nodeType !== 1) continue;
        if (n.tagName === 'CANVAS' && n.parentElement) redrawButtonLabels(n.parentElement);
        else rescaleLabels(n);
      }
    });
    labelObserver.observe(screen, { childList: true, subtree: true });
  }

  bus._injectUi = (ui) => { _uiOverride = ui; hudPatched = false; };
  bus._patchHud = () => patchHudScale();
  bus._patchSurvival = () => patchSurvivalScale();
  bus._injectSurvival = (mod) => { _survOverride = mod; survPatched = false; };
  bus._rescaleLabels = (root) => rescaleLabels(root);

  function h(tag, props, ...kids) {
    const e = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else if (v !== null && v !== undefined) e.setAttribute(k, v);
    }
    for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) e.append(kid);
    return e;
  }
  const T = s => document.createTextNode(String(s));
  const row = (...kids) => h('div', { class: 'row' }, ...kids);
  const note = text => h('p', { class: 'desc' }, T(text));
  const small = text => h('p', { class: 'desc small' }, T(text));
  const header = text => h('div', { class: 'tc-title' }, T(text));
  const subhead = text => h('div', { class: 'tc-sub' }, T(text));
  const sep = () => h('div', { class: 'tc-sep' });

  function btn(label, onclick, opts) {
    const b = h('button', { class: 'mcb' + (opts && opts.cls ? ' ' + opts.cls : ''), type: 'button', 'aria-label': label, text: label });
    b.addEventListener('click', e => { e.preventDefault(); try { onclick && onclick(e); } catch (err) { console.error(TAG, err); } });
    b.__setLabel = t => { b.textContent = t; b.setAttribute('aria-label', t); };
    return b;
  }
  // A full-width game-style row: "Label: ON".
  function toggle(label, value, onchange) {
    const text = () => label + ': ' + (value ? 'ON' : 'OFF');
    const b = btn(text(), () => { value = !value; b.__setLabel(text()); if (typeof onchange === 'function') onchange(value); }, { cls: 'tc-full tc-tg' });
    return b;
  }
  // A full-width row that steps through options ([[value, label], ...]): "Label: Soft".
  function cycle(label, options, value, onchange) {
    const opts = Array.isArray(options) ? options.filter(o => Array.isArray(o) && o.length) : [];
    const same = (a, b) => a === b || (typeof a === 'number' && Math.abs(a - Number(b)) < 1e-9);
    let i = opts.findIndex(o => same(o[0], value));
    const text = () => label + ': ' + (i >= 0 ? String(opts[i][1] !== undefined ? opts[i][1] : opts[i][0]) : String(value));
    const b = btn(text(), () => {
      if (!opts.length) return;
      i = (i + 1) % opts.length;
      b.__setLabel(text());
      if (typeof onchange === 'function') onchange(opts[i][0]);
    }, { cls: 'tc-full tc-cycle' });
    return b;
  }
  function stepDecimals(step) {
    const s = String(step);
    const e = s.match(/e-(\d+)$/i);
    if (e) return Math.min(6, Number(e[1]) || 0);
    const dot = s.indexOf('.');
    return dot < 0 ? 0 : Math.min(6, s.length - dot - 1);
  }
  // The game's slider look (style.css .fov-control): a 200 x 20 track with the caption drawn on it.
  function slider(label, value, min, max, step, oninput, onchange) {
    const dp = stepDecimals(step);
    const round = v => { const n = Number(v); return Number.isFinite(n) ? Number(n.toFixed(dp)) : n; };
    const fmt = v => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(dp) : String(v); };
    const inp = h('input', { class: 'tc-range', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    const cap = h('div', { class: 'tc-cap', 'aria-hidden': 'true' });
    const show = () => {
      const t = label + ': ' + fmt(inp.value);
      cap.textContent = t;
      inp.setAttribute('aria-valuetext', t);
    };
    inp.setAttribute('aria-label', label);
    show();
    inp.addEventListener('input', () => { show(); if (oninput) oninput(round(inp.value)); });
    if (onchange) inp.addEventListener('change', () => onchange(round(inp.value)));
    return h('div', { class: 'tc-slider' }, inp, cap);
  }
  // Full-width controls (toggles, cycles, sliders) carry their own caption, so they stand alone.
  // Anything else (keybind buttons, Fullscreen) gets a caption on the left.
  function item(label, control) {
    const cl = control && control.classList;
    if (cl && (cl.contains('tc-full') || cl.contains('tc-slider'))) return control;
    return h('div', { class: 'tc-item' }, h('div', { class: 'tc-cap', text: label, title: label }), control);
  }

  let cssDone = false;
  function ensureCSS() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    const S = '#screen .inner:has(> .tc-marker)';
    st.textContent = `
      /* the pixel font, everywhere. form controls do not inherit it by default */
      #screen .inner, #screen .inner button, #screen .inner input, #screen .inner select, #screen .inner textarea {
        font-family: "Tweetcraft", ui-monospace, monospace;
      }
      /* caption size: 8u, shrunk with the 94vw width cap on narrow screens so text still fits */
      ${S} { --tc-f: min(calc(8 * var(--u)), 3.7vw); }
      #screen .inner .tc-title { font: calc(9 * var(--u)) "Tweetcraft", ui-monospace, monospace; margin: 0 0 calc(2 * var(--u)); text-shadow: calc(1 * var(--u)) calc(1 * var(--u)) 0 #282828; }
      #screen .inner .tc-cap { font: var(--tc-f, calc(8 * var(--u)))/1 "Tweetcraft", ui-monospace, monospace; white-space: nowrap; color: #fff; text-shadow: calc(var(--tc-f, calc(8 * var(--u))) / 8) calc(var(--tc-f, calc(8 * var(--u))) / 8) 0 #3f3f3f; }
      #screen .inner .tc-sub { font: var(--tc-f, calc(8 * var(--u)))/1 "Tweetcraft", ui-monospace, monospace; color: #a0a0a0; text-shadow: calc(var(--tc-f, calc(8 * var(--u))) / 8) calc(var(--tc-f, calc(8 * var(--u))) / 8) 0 #282828; margin-top: calc(3 * var(--u)); max-width: min(94vw, calc(200 * var(--u))); text-align: center; }
      ${S} .mcb { font: var(--tc-f)/1 "Tweetcraft", ui-monospace, monospace; white-space: nowrap; color: #fff; text-shadow: calc(var(--tc-f) / 8) calc(var(--tc-f) / 8) 0 #3f3f3f; }
      ${S} .mcb:hover:not(:disabled), ${S} .mcb:focus-visible { color: #ffffa0; }
      ${S} .mcb:disabled { color: #a0a0a0; }
      ${S} .desc { font-size: min(calc(8 * var(--d)), 3.2vw); line-height: 1.25; }
      /* the game's canvas button labels are redrawn crisply by JS (see
         redrawButtonLabels); only the crosshair bitmap needs a plain scale. */
      #cross { transform: translate(-50%, -50%) scale(var(--tc-s, 1)); }
      #screen .inner .tc-tabs { display: flex; gap: calc(2 * var(--u)); flex-wrap: wrap; justify-content: center; max-width: 94vw; }
      #screen .inner .tc-tabs .mcb { width: auto; padding: 0 calc(4 * var(--u)); height: calc(18 * var(--u)); }
      #screen .inner .mcb.on { border-image-source: url(/assets/gui/button_highlighted.png); }
      #screen .inner .mcb.tc-full { width: calc(200 * var(--u)); max-width: 94vw; }
      #screen .inner .tc-item { display: flex; flex: none; gap: calc(3 * var(--u)); align-items: center; justify-content: space-between; width: min(94vw, calc(200 * var(--u))); }
      #screen .inner .tc-item > .tc-cap { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; text-align: left; }
      #screen .inner .tc-item > .mcb { flex: none; display: block; width: calc(82 * var(--u)); max-width: 40vw; padding: 0 calc(2 * var(--u)); overflow: hidden; text-overflow: ellipsis; text-align: center; }
      #screen .inner .tc-list { display: flex; flex-direction: column; gap: calc(2 * var(--u)); width: min(94vw, calc(200 * var(--u))); }
      #screen .inner .tc-list > .tc-item { width: 100%; }
      #screen .inner .tc-sep { height: calc(3 * var(--u)); }
      #screen .inner .tc-slider { position: relative; flex: none; width: calc(200 * var(--u)); max-width: 94vw; height: calc(20 * var(--u)); }
      #screen .inner .tc-slider > .tc-cap { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; overflow: hidden; }
      #screen .inner .tc-slider:hover > .tc-cap { color: #ffffa0; }
      #screen .inner .tc-slider > .tc-range { appearance: none; -webkit-appearance: none; display: block; width: 100%; height: 100%; margin: 0; padding: 0; border: var(--u) solid #000; border-radius: 0; background: #252525; cursor: pointer; touch-action: none; }
      #screen .inner .tc-slider > .tc-range:focus-visible { outline: var(--u) solid #ffffa0; outline-offset: var(--u); }
      #screen .inner .tc-slider > .tc-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: calc(8 * var(--u)); height: calc(18 * var(--u)); border: calc(3 * var(--u)) solid transparent; border-image: url(/assets/gui/button.png) 3 fill / calc(3 * var(--u)) stretch; }
      #screen .inner .tc-slider > .tc-range::-moz-range-thumb { width: calc(8 * var(--u)); height: calc(18 * var(--u)); border-radius: 0; border: calc(3 * var(--u)) solid transparent; border-image: url(/assets/gui/button.png) 3 fill / calc(3 * var(--u)) stretch; }
      /* these now live in our menu, so drop them from the game's pause screen
         (English fallback; the labels in the player's language are in #tc-options-i18n) */
      #screen .inner button[aria-label^="Distance:"] { display: none !important; }
      #screen .inner button[aria-label="Fullscreen"],
      #screen .inner button[aria-label="Exit Fullscreen"] { display: none !important; }
    `;
    (document.head || document.documentElement).append(st);
  }

  // Two-click confirmations. The state lives outside build() so a rebuild keeps it; the label is changed
  // in place (button[data-tc-arm]), never through refresh(), so a slider drag on another row isn't cut off.
  const ARMED_LABEL = 'Click again to reset';
  const armed = {};
  const isArmed = id => !!armed[id];
  function relabelArmed(id, text) {
    const b = document.querySelector('#screen .inner button[data-tc-arm="' + id + '"]');
    if (b && b.__setLabel) b.__setLabel(text);
  }
  function arm(id, label) {
    clearTimeout(armed[id]);
    armed[id] = setTimeout(() => { delete armed[id]; relabelArmed(id, label); }, 3000);
    relabelArmed(id, ARMED_LABEL);
  }
  function disarm(id) { clearTimeout(armed[id]); delete armed[id]; }
  function armButton(id, label, onclick) {
    const b = btn(isArmed(id) ? ARMED_LABEL : label, onclick);
    b.setAttribute('data-tc-arm', id);
    return b;
  }

  function fovRow() {
    syncFov();
    return slider('Field of View', Math.round(getFov()), 30, 110, 1, v => { setFov(v); });
  }
  function rdRow() {
    const cur = currentRd();
    return slider('Render distance', cur, RDS[0], RDS[RDS.length - 1], 2, null, v => { setRenderDistance(v).then(refresh); });
  }
  function fullscreenRow() {
    const on = !!document.fullscreenElement;
    return item('Fullscreen', btn(on ? 'Exit' : 'Enter', toggleFullscreen));
  }
  function scaleRow() {
    const cur = Number(bus.get('ui.scale', 1));
    return slider('Interface & HUD size', cur, 0.75, 2, 0.05, v => { bus.set('ui.scale', v); applyUiScale(); });
  }
  function hudRow() {
    return item('HUD', toggle('HUD', !!bus.get('hud.on', true), toggleHud));
  }
  // The game's own Options screen (held light, music, country, chat translation, language).
  // Its Done button goes back to the pause menu.
  async function openGameOptions() {
    const M = await menus();
    if (!M || typeof M.openOptions !== 'function') { toast('Options unavailable'); return; }
    try { M.openOptions(); } catch (e) { console.warn(TAG, e); }
  }
  function graphicsSection() {
    return [
      fovRow(), rdRow(), fullscreenRow(), scaleRow(), hudRow(),
      sep(),
      btn('Game options…', openGameOptions),
      small('Held light, music, language and more.')
    ];
  }

  const KEYNAMES = { Space: ' ', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Slash: '/', Quote: "'", Comma: ',', Period: '.', Minus: '-', Equal: '=', Backquote: '`', Semicolon: ';', Backslash: '\\', BracketLeft: '[', BracketRight: ']' };
  const keyName = code => KEYNAMES[code] || (code.startsWith('Key') ? code.slice(3).toLowerCase() : code.startsWith('Digit') ? code.slice(5) : code);
  let capturing = null;
  function setCapturing(entry) { capturing = entry; bus.capturing = !!entry; }

  function screenIsOn() { const s = document.getElementById('screen'); return !!s && /(^|\s)on(\s|$)/.test(s.className || ''); }
  function invClosed() { const el = document.getElementById('inv'); return !el || el.classList.contains('off'); }
  function remapActive() { return !screenIsOn() && invClosed() && !isTyping(document.activeElement); }
  function modKeySet() {
    const set = new Set();
    for (const kb of keybinds) { try { const k = kb.get && kb.get(); if (k) set.add(k); } catch (e) {} }
    return set;
  }
  function onKeyCapture(e) {
    try { onKeyCaptureImpl(e); } catch (err) {}
  }
  function onKeyCaptureImpl(e) {
    if (e.__tc) return;
    if (capturing && !ourMenuOpen()) setCapturing(null);

    if (capturing && (e.type === 'keydown')) {
      e.preventDefault(); e.stopImmediatePropagation();
      e.__tcCaptured = true;
      const entry = capturing.entry;
      if (e.code === 'Escape') { setCapturing(null); refresh(); return; }
      if (entry && entry.def && modKeySet().has(e.code)) { setCapturing(null); refresh(); toast('That key is used by a mod'); return; }
      setCapturing(null); bindEntry(entry, e.code); refresh();
      return;
    }

    if (!remapActive()) return;
    if (modKeySet().has(e.code)) return;
    const map = bus.get('keys.map', {}) || {};
    const to = map[e.code];
    if (to) {
      e.preventDefault(); e.stopImmediatePropagation();
      const ev = new KeyboardEvent(e.type, {
        code: to, key: keyName(to), bubbles: true, cancelable: true, repeat: e.repeat,
        ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey
      });
      ev.__tc = true;
      window.dispatchEvent(ev);
      return;
    }
    const mute = bus.get('keys.mute', []) || [];
    if (mute.includes(e.code)) { e.preventDefault(); e.stopImmediatePropagation(); }
  }
  addEventListener('keydown', onKeyCapture, true);
  addEventListener('keyup', onKeyCapture, true);

  function currentKeyFor(def) {
    const map = bus.get('keys.map', {}) || {};
    for (const src in map) if (map[src] === def) return src;
    const mute = bus.get('keys.mute', []) || [];
    return mute.includes(def) ? null : def;
  }
  function bindEntry(entry, newKey) {
    if (entry && (entry.get || entry.set)) { entry.set(newKey); return; }
    const def = entry.def;
    const map = bus.get('keys.map', {}) || {};
    const mute = (bus.get('keys.mute', []) || []).slice();
    for (const src in map) if (map[src] === def) delete map[src];
    const mi = mute.indexOf(def);
    if (newKey === def) { if (mi >= 0) mute.splice(mi, 1); }
    else { map[newKey] = def; if (mi < 0) mute.push(def); }
    bus.set('keys.map', map);
    bus.set('keys.mute', mute);
  }

  const GAME_ACTIONS = [
    ['Forward', 'KeyW'], ['Back', 'KeyS'], ['Left', 'KeyA'], ['Right', 'KeyD'],
    ['Jump', 'Space'], ['Sneak', 'ShiftLeft'], ['Sprint (Mac)', 'ControlLeft'],
    ['Drop item', 'KeyQ'], ['Inventory', 'KeyE'], ['Chat', 'KeyT'], ['View', 'F5'],
    ['Debug (F3)', 'F3'], ['HUD (F1)', 'F1']
  ];
  function keybindEntries() {
    const list = GAME_ACTIONS.map(([label, def]) => ({ id: 'g:' + def, label, def }));
    for (const kb of keybinds) list.push({ id: 'm:' + kb.id, label: kb.label, get: kb.get, set: kb.set });
    return list;
  }
  function entryKey(entry) { return entry.get ? entry.get() : currentKeyFor(entry.def); }

  function keybindsSection() {
    const out = [header('Keybinds'), note('Click a key to change it, then press the new key. Escape cancels. Game keys are remapped; mod keys are handled by their script.')];
    out.push(slider('Mouse sensitivity', Number(bus.get('input.sens', 1)), 0.25, 3, 0.05, v => bus.set('input.sens', v)));
    out.push(sep());
    const list = h('div', { class: 'tc-list' });
    for (const entry of keybindEntries()) {
      const isCap = capturing && capturing.entry && capturing.entry.id === entry.id;
      const cur = entryKey(entry);
      const kb = btn(isCap ? 'Press a key' : (cur ? prettyKey(cur) : '(none)'), () => { setCapturing({ entry }); refresh(); });
      list.append(item(entry.label, kb));
    }
    out.push(list);
    out.push(sep());
    out.push(row(btn('Reset all keybinds', () => {
      bus.set('keys.map', {}); bus.set('keys.mute', []);
      for (const kb of keybinds) if (kb.reset) kb.reset();
      refresh();
    })));
    return out;
  }
  function prettyKey(code) {
    if (!code) return '(none)';
    if (code.startsWith('Key')) return code.slice(3);
    if (code.startsWith('Digit')) return code.slice(5);
    if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
    return code;
  }

  // ---- Shaders tab (window.Twitterentary; every member is feature-detected)
  function clearShaderKeys() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.indexOf(SHADER_PREFIX) === 0) keys.push(k); }
      for (const k of keys) localStorage.removeItem(k);
      return keys.length;
    } catch (e) { return 0; }
  }
  function setShader(TE, key, value) {
    if (typeof TE.set === 'function') {
      try { TE.set(key, value); return; } catch (e) { console.warn(TAG, 'shader set failed', key, e); }
    }
    const c = TE.cfg; c[key] = value;
    try { localStorage.setItem(SHADER_PREFIX + key, String(value)); } catch (e) {}
    if (typeof TE.apply === 'function') { try { TE.apply(); } catch (e) {} }
  }
  // Returns false when only the saved keys could be cleared (an older shader script: reload to apply).
  // Then the rows still show the old live values, so the tab says so until the page reloads.
  let shReloadPending = false;
  function resetShaders(TE) {
    let live = false;
    if (TE && typeof TE.reset === 'function') {
      try { TE.reset(); live = true; } catch (e) { console.warn(TAG, 'shader reset failed', e); }
    }
    clearShaderKeys();
    if (!live) shReloadPending = true;
    return live;
  }
  function presetPicker(TE, group, title, out) {
    const list = TE.presets && Array.isArray(TE.presets[group]) ? TE.presets[group].filter(p => p && p.id) : [];
    if (!list.length) return null;
    const cur = () => { try { const id = TE.currentPreset(group); return list.find(p => p.id === id) || null; } catch (e) { return null; } };
    const d = small('');
    const b = btn(title, () => {
      const p = cur(), i = p ? list.indexOf(p) : -1;
      const next = list[(i + 1) % list.length];
      try { TE.applyPreset(group, next.id); } catch (e) { console.warn(TAG, 'preset failed', group, next.id, e); }
      refresh();
    }, { cls: 'tc-full tc-cycle' });
    const update = () => {
      const p = cur();
      b.__setLabel(title + ': ' + (p ? (p.name || p.id) : 'Custom'));
      d.textContent = p ? (p.desc || '') : 'Your own mix. Click to pick a preset.';
    };
    update();
    out.push(b, d);
    return update;
  }
  function shadersSection() {
    const TE = window.Twitterentary;
    if (!TE || !TE.cfg) return [header('Shaders'), note('Twitterentary Shaders is not loaded on this page.')];
    const c = TE.cfg;
    const schema = Array.isArray(TE.schema) ? TE.schema.filter(f => f && f.key) : [];
    const out = [header('Shaders')];
    if (shReloadPending) out.push(note('Shader settings were cleared. Defaults apply after a reload.'));

    const pickers = [];
    if (TE.presets && typeof TE.applyPreset === 'function' && typeof TE.currentPreset === 'function') {
      for (const [group, title] of [['quality', 'Quality'], ['look', 'Look']]) {
        const up = presetPicker(TE, group, title, out);
        if (up) pickers.push(up);
      }
    }
    const syncPickers = () => { for (const f of pickers) { try { f(); } catch (e) {} } };

    const anyReload = schema.some(f => f.reload);
    const write = (f, v) => {
      setShader(TE, f.key, v);
      syncPickers();
    };
    const reloadToast = () => toast('Saved. Reload to apply');

    if ('enabled' in c) out.push(toggle('Shaders', !!c.enabled, v => write({ key: 'enabled' }, v)));

    // rows grouped under their section heading, in schema order
    const groups = new Map();
    for (const f of schema) {
      if (f.key === 'enabled') continue;
      const s = typeof f.section === 'string' ? f.section : '';
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(f);
    }
    for (const [name, rows] of groups) {
      if (name) out.push(subhead(name));
      for (const f of rows) {
        const label = f.label + (f.reload ? ' (reload)' : '');
        if (f.type === 'bool') {
          out.push(toggle(label, !!c[f.key], v => { write(f, v); if (f.reload) reloadToast(); }));
        } else if (f.type === 'num') {
          const cur = Number(c[f.key]);
          out.push(slider(label, Number.isFinite(cur) ? cur : f.min, f.min, f.max, f.step,
            v => write(f, v), f.reload ? reloadToast : null));
        } else if (f.type === 'choice' && Array.isArray(f.options)) {
          out.push(cycle(label, f.options, c[f.key], v => { write(f, v); if (f.reload) reloadToast(); }));
        }
      }
    }
    if (!schema.length) out.push(note('This version of the shader script has no settings list.'));

    out.push(sep());
    out.push(note(anyReload ? 'Settings marked (reload) need a page refresh.' : 'Changes apply instantly.'));
    out.push(armButton('sh', 'Reset shaders', () => {
      if (!isArmed('sh')) { arm('sh', 'Reset shaders'); return; }
      disarm('sh');
      if (!resetShaders(TE)) toast('Shader settings cleared. Reload to apply');
      refresh();
    }));
    if (anyReload || shReloadPending) out.push(btn('Reload page', () => location.reload()));
    return out;
  }

  // ---- About tab: version and "Reset all options"
  let resetting = false;
  async function resetAll() {
    if (resetting) return;
    resetting = true;
    let shaderReload = false;
    try {
      if (capturing) setCapturing(null);
      disarm('sh'); disarm('all');
      // mod keybinds first: their reset writes their key back into tc.options (zoom.key)
      for (const kb of keybinds.slice()) {
        if (kb && typeof kb.reset === 'function') { try { await kb.reset(); } catch (e) { console.warn(TAG, 'keybind reset failed', kb.id, e); } }
      }
      const TE = window.Twitterentary;
      if (TE && TE.cfg) shaderReload = !resetShaders(TE);
      else clearShaderKeys();
      bus.reset();
      applyUiScale();
      // the HUD default is on: show it if the game's HUD is hidden, whether we or a real F1 hid it
      await sendF1(true);
      await setFov(70);
      await setRenderDistance(defaultRd());
    } catch (e) {
      console.warn(TAG, 'reset all failed', e);
    } finally {
      resetting = false;
    }
    refresh();
    toast(shaderReload ? 'Options reset. Reload to apply the shader defaults' : 'All options reset');
  }
  async function onResetAllClick() {
    if (resetting) return;
    const M = await menus();
    if (M && typeof M.showMessage === 'function' && typeof M.showScreen === 'function') {
      const reopen = () => { try { M.showScreen(MENU_NAME, buildScreen, 'dim'); } catch (e) { console.warn(TAG, e); } };
      try {
        M.showMessage('Reset all options?',
          'Every setting in this menu goes back to its default: shaders, interface, HUD, keybinds and mod settings, ' +
          'plus FOV 70 and render distance ' + defaultRd() + '. Other game settings are kept.',
          [['Reset', () => { reopen(); resetAll(); }], ['Cancel', reopen]]);
        return;
      } catch (e) { console.warn(TAG, 'confirm dialog failed', e); reopen(); }
    }
    if (isArmed('all')) { disarm('all'); resetAll(); } else arm('all', 'Reset all options');
  }
  function aboutSection() {
    return [
      header('About'),
      note('Better Options v' + VERSION + '. Settings are saved automatically.'),
      note('Opened from the pause menu\'s Options button. Escape goes back.'),
      sep(),
      armButton('all', 'Reset all options', onResetAllClick),
      small('Everything here, plus FOV 70 and render distance ' + defaultRd() + '.')
    ];
  }

  let curTab = 'graphics';
  function tabsList() {
    const t = [{ id: 'graphics', title: 'Graphics' }];
    if (window.Twitterentary && window.Twitterentary.cfg) t.push({ id: 'shaders', title: 'Shaders' });
    for (const s of sections) t.push({ id: 'reg:' + s.id, title: s.title || s.id });
    t.push({ id: 'keybinds', title: 'Keybinds' });
    t.push({ id: 'about', title: 'About' });
    return t;
  }
  function buildScreen() {
    ensureCSS();
    const tabs = h('div', { class: 'tc-tabs' });
    for (const t of tabsList()) {
      const b = btn(t.title, () => { curTab = t.id; refresh(); });
      if (curTab === t.id) b.classList.add('on');
      tabs.append(b);
    }
    const body = [];
    body.push(h('span', { class: 'tc-marker', style: 'display:none' }));
    body.push(header('More Options'), tabs, sep());

    try {
      if (curTab === 'graphics') body.push(...graphicsSection());
      else if (curTab === 'shaders') body.push(...shadersSection());
      else if (curTab === 'keybinds') body.push(...keybindsSection());
      else if (curTab === 'about') body.push(...aboutSection());
      else if (curTab.startsWith('reg:')) {
        const sec = sections.find(x => x.id === curTab.slice(4));
        if (sec) { try { body.push(...sec.build(api())); } catch (e) { body.push(note('Section error: ' + e.message)); } }
      }
    } catch (e) {
      console.warn(TAG, 'tab failed', curTab, e);
      body.push(note('This tab failed to load: ' + (e && e.message)));
    }
    body.push(sep());
    body.push(row(btn('Done', closeMenu)));
    return body;
  }
  function api() {
    return { bus, h, T, row, note, header, btn, toggle, cycle, slider, item, refresh, toast, prettyKey, currentKeyFor, fov: bus.fov };
  }
  bus.ui = { h, T, row, note, header, btn, toggle, cycle, slider, item, refresh, toast, prettyKey };
  bus.build = buildScreen;
  bus.close = closeMenu;

  async function openMenu() {
    if (ourMenuOpen()) { refresh(); return; }
    const M = await menus();
    if (!M) { toast('Options unavailable'); return; }
    M.showScreen(MENU_NAME, buildScreen, 'dim');
    stealFovInput();
  }
  function closeMenu() {
    if (capturing) setCapturing(null);
    const doBack = M => { if (M) { try { M.back(); } catch (e) {} } };
    if (_menus) doBack(_menus);
    else menus().then(doBack);
  }
  function refresh() {
    if (_menus && ourMenuOpen()) { try { _menus.refresh(); } catch (e) {} }
  }

  // The pause menu's "Options…" (in the player's language) opens our menu instead.
  function onDocClick(e) {
    const t = e.target;
    if (!t || typeof t.closest !== 'function') return;
    const b = t.closest('#screen .inner button[aria-label]');
    if (!b || !LBL.options.has(b.getAttribute('aria-label'))) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    openMenu();
  }
  addEventListener('click', onDocClick, true);

  function sensMult() { return Math.max(0.1, Math.min(5, Number(bus.get('input.sens', 1)) || 1)); }
  addEventListener('mousemove', (e) => {
    const m = sensMult();
    if (m === 1) return;
    const gl = document.getElementById('gl');
    if (!gl || document.pointerLockElement !== gl) return;
    try {
      Object.defineProperty(e, 'movementX', { value: e.movementX * m, configurable: true });
      Object.defineProperty(e, 'movementY', { value: e.movementY * m, configurable: true });
    } catch (err) {}
  }, true);

  applyUiScale();
  ensureCSS();
  let patchTries = 0;
  const tryPatch = () => Promise.all([patchHudScale(), patchSurvivalScale()]).then(() => {
    if ((!hudPatched || !survPatched) && ++patchTries < 10) setTimeout(tryPatch, 300);
  });
  domReady().then(() => { ensureCSS(); tryPatch(); startLabelObserver(); initLabels(); });
  addEventListener('resize', () => { applyUiScale(); setTimeout(applyUiScale, 0); });
  uiTimer = setInterval(reassertUiScale, 250);
  addEventListener('fullscreenchange', () => refresh());

  console.info(TAG, 'loaded. Open it from the pause menu\'s "Options…" button.');
})();
