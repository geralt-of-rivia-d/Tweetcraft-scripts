// ==UserScript==
// @name         Tweetcraft <Feature>
// @namespace    tweetcraft.<feature>
// @version      0.1.0
// @description  <One sentence: what the player gets.>
// @author       <you>
// @match        https://tweetcraft.jai.vin/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Template: replace <Feature> / <feature>, rename window.__tcFeature and the __tcFeature marker at the
// bottom to match, and delete what you don't need. It passes `npm run check` as it is.

(() => {
  'use strict';

  const TAG = '[<Feature>]';
  // Never hard-code the version: Tampermonkey provides GM_info even with @grant none (so does the smoke harness).
  const VERSION = typeof GM_info !== 'undefined' && GM_info.script ? GM_info.script.version : '?';
  const NS = '<feature>.'; // keys in tc.options: '<feature>.on', '<feature>.key'
  const DEFAULTS = { on: true, key: 'KeyG' };
  const log = (...a) => console.info(TAG, ...a);

  // ---- settings: Better Options' bus when present, else tc.options directly (same storage) -----
  const bus = () => window.__tcOptions;
  function get(k, d = DEFAULTS[k]) {
    const b = bus();
    if (b) return b.get(NS + k, d);
    try {
      const c = JSON.parse(localStorage.getItem('tc.options') || '{}');
      return c[NS + k] !== undefined ? c[NS + k] : d;
    } catch (e) { return d; }
  }
  function set(k, v) {
    const b = bus();
    if (b) { b.set(NS + k, v); return; } // persists and notifies changed() subscribers, us included
    try {
      const c = JSON.parse(localStorage.getItem('tc.options') || '{}');
      c[NS + k] = v;
      localStorage.setItem('tc.options', JSON.stringify(c));
    } catch (e) {}
    reload();
  }

  // Cached copies, so key handlers and hot paths don't read settings on every call.
  let ON = DEFAULTS.on, KEY = DEFAULTS.key;
  function reload() {
    ON = !!get('on');
    KEY = get('key') || DEFAULTS.key;
  }
  reload();

  // ---- game hooks: detect first; if the anchor is missing, leave the game untouched -----------
  // Browser prototypes (WebGL2RenderingContext, HTMLImageElement...) must be patched right away,
  // before the game's modules load.
  function patchEarly() {
    // const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
    // if (!P || typeof P.drawArrays !== 'function' || P.drawArrays.__tcFeature) return;
    // ...same wrapper shape as in install() below.
  }

  // Game modules and the DOM: only after DOMContentLoaded. Importing /js/menus.js earlier breaks the
  // game's menus. Imports return the same module instances the game uses.
  let hookFailed = false; // log a failing hook once, not on every call
  async function install() {
    try {
      // const ui = await import('/js/ui.js');
      // const P = ui && ui.Hud && ui.Hud.prototype;
      // if (!P || typeof P.draw !== 'function' || P.draw.__tcFeature) return; // anchor missing: do nothing
      // const orig = P.draw;
      // const fn = function (o) {                  // fixed arity: no rest-args allocation per frame
      //   const r = orig.call(this, o);             // the original always runs
      //   if (ON) {
      //     try { /* draw after the original */ }
      //     catch (e) { if (!hookFailed) { hookFailed = true; console.error(TAG, 'draw hook failed', e); } }
      //   }
      //   return r;
      // };
      // fn.__tcFeature = true;
      // P.draw = fn;
    } catch (e) {
      console.error(TAG, 'install failed', e);
    }
  }

  // ---- input: skip typing, open screens and inventory, and Better Options' key capture --------
  const typing = t => !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
  const screenOn = () => { const s = document.getElementById('screen'); return !!s && s.classList.contains('on'); };
  const invOpen = () => { const i = document.getElementById('inv'); return !!i && !i.classList.contains('off'); };
  addEventListener('keydown', e => {
    if (e.__tcCaptured || bus()?.capturing) return;
    if (e.code !== KEY || e.repeat || !ON) return;
    if (typing(e.target) || typing(document.activeElement) || screenOn() || invOpen()) return;
    // ... your action
  }, true);

  // ---- settings tab and keybind in Better Options (optional: the script works without it) -----
  let busTries = 0;
  function registerWithBus() {
    const b = bus();
    if (!b || typeof b.register !== 'function') {
      if (++busTries < 50) setTimeout(registerWithBus, 200); // it may load after us, or not be installed
      return;
    }
    reload();
    if (b.changed) b.changed(k => { if (typeof k === 'string' && k.startsWith(NS)) reload(); });
    if (b.registerKeybind) {
      b.registerKeybind({ // listed in the Keybinds tab, and Better Options won't remap or mute this key
        id: '<feature>',
        label: '<Feature>',
        get: () => KEY,
        set: code => set('key', code),
        reset: () => set('key', DEFAULTS.key),
      });
    }
    b.register({
      id: '<feature>',
      title: '<Feature>', // the tab's label in Better Options
      build: api => [ // re-run on every refresh(): return an array of fresh nodes
        api.header('<Feature>'),
        api.item('Enabled', api.toggle('Enabled', ON, v => set('on', v))),
        api.note('Key: ' + api.prettyKey(KEY) + ' (change it in the Keybinds tab). <Short help text>'),
      ],
    });
  }

  patchEarly();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install, { once: true });
  else install();
  registerWithBus();

  window.__tcFeature = { version: VERSION, get, set, DEFAULTS }; // one debug handle: rename to window.__tc<Feature>
  log('v' + VERSION + ' loaded');
})();
