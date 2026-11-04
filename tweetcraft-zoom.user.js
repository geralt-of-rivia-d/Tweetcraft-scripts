// ==UserScript==
// @name         Tweetcraft Zoom
// @namespace    tweetcraft.zoom
// @version      1.1.1
// @author       andrestube123
// @description  Hold a key to zoom in and adjust your FOV for a closer look.
// @match        https://tweetcraft.jai.vin/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const DEFAULTS = { key: "KeyC", level: 4, look: 1 };
  let KEY = DEFAULTS.key;
  let zoom = DEFAULTS.level;
  let look = DEFAULTS.look;
  const TWEEN_MS = 250;   // the game's own ease (main.js, dt*10) runs on top of this, so the view settles about 650 ms after a press
  const POLL_MS = 500;
  // zooming: from the press until the view is back on orig. held: only while the key is down, which is
  // what the wheel and look scaling follow. orig: the player's real FOV. cur: the last value written.
  let zooming = false, held = false, orig = null, cur = null;

  const log = (...a) => console.log("[zoom]", ...a);
  const typing = t => !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
  const gl = () => document.getElementById("gl");
  const screenOn = () => { const s = document.getElementById("screen"); return !!s && /(^|\s)on(\s|$)/.test(s.className || ""); };
  const canZoom = () => !screenOn() && !typing(document.activeElement) && !!gl();
  // Nothing on the page says the game's S.menu is empty except the crosshair (main.js hides it while a menu,
  // the inventory or a survival screen is up). Third person hides it too, which only makes us more careful.
  const crossOn = () => { const c = document.getElementById("cross"); return !!c && !c.classList.contains("off"); };
  const chatShut = () => { const c = document.getElementById("chatbox"); return !!c && c.hidden; };
  const locked = () => { const g = gl(); return !!g && document.pointerLockElement === g; };
  const inWorld = () => /^\/(?:r|play)\//.test(location.pathname);
  // Before the player's first click: a world is up, nothing holds input, so a menu rebuild disturbs nobody.
  // Touch play never takes pointer lock, so "no lock" says nothing there.
  const idle = () => !!window.__ready && !document.hidden && !document.pointerLockElement && !screenOn() && crossOn() && chatShut() && !typing(document.activeElement) && !window.matchMedia("(pointer: coarse)").matches;

  function tcGet(k, d) {
    const b = window.__tcOptions;
    if (b) return b.get("zoom." + k, d);
    try { const c = JSON.parse(localStorage.getItem("tc.options") || "{}"); return c["zoom." + k] !== undefined ? c["zoom." + k] : d; } catch (e) { return d; }
  }
  function tcSet(k, v) {
    const b = window.__tcOptions;
    if (b) { b.set("zoom." + k, v); return; }
    try { const c = JSON.parse(localStorage.getItem("tc.options") || "{}"); c["zoom." + k] = v; localStorage.setItem("tc.options", JSON.stringify(c)); } catch (e) {}
  }

  function refreshConfig() {
    KEY = tcGet("key", DEFAULTS.key) || DEFAULTS.key;
    zoom = Math.max(1.5, Math.min(20, Number(tcGet("level", DEFAULTS.level)) || DEFAULTS.level));
    look = Math.max(0.1, Math.min(3, Number(tcGet("look", DEFAULTS.look)) || DEFAULTS.look));
  }

  const fovBus = () => { const b = window.__tcOptions; return b && b.fov ? b.fov : null; };
  const validFov = v => v >= 30 && v <= 110;
  // mc.fov holds the real FOV whenever we aren't zooming: the game's Options screen writes it too, and a
  // cached copy would go stale and put the player back on an old value when the zoom ends.
  function storedFov() {
    let v = NaN;
    try { v = Number(localStorage.getItem("mc.fov")); } catch (e) {}
    if (validFov(v)) return v;
    const f = fovBus();
    const g = f && f.get ? Number(f.get()) : NaN;
    return validFov(g) ? g : 70;
  }

  let menusMod = null, menusPending = null;
  function domReady() { return document.readyState !== "loading" ? Promise.resolve() : new Promise(r => document.addEventListener("DOMContentLoaded", r, { once: true })); }
  function menus() {
    if (menusMod) return Promise.resolve(menusMod);
    if (!menusPending) menusPending = (async () => {
      await domReady();
      try { menusMod = await import("/js/menus.js"); } catch (e) { menusMod = null; }
      return menusMod;
    })();
    return menusPending;
  }

  // Only used without a Better Options that has setNow. undefined: not looked for yet. null: not there.
  let fovInput;
  async function localStealFov() {
    if (fovInput !== undefined) return fovInput;
    const M = await menus();
    if (fovInput !== undefined) return fovInput;
    if (!M) { fovInput = null; return null; }
    fovInput = null;
    // showScreen() drops pointer lock, and the game answers a lost lock with no menu up by opening the pause
    // menu. Hiding exitPointerLock for this one synchronous task keeps the lock, so none of that happens.
    document.exitPointerLock = () => {};
    try {
      M.openOptions();
      const el = document.querySelector('#screen .inner input[type="range"][data-k="fov"]');
      if (el) { el.min = "2"; el.step = "any"; fovInput = el; }
    } catch (e) {}
    try { M.closeMenu(); } catch (e) {}
    delete document.exitPointerLock;
    return fovInput;
  }

  // The one place that writes the FOV. Synchronous; false means the input isn't cached yet.
  function write(v) {
    v = Math.max(2, Math.min(110, Number(v) || 70));
    let ok = false;
    try {
      const f = fovBus();
      if (f && f.setNow) ok = f.setNow(v) === true;
      if (!ok && fovInput) { fovInput.value = String(v); fovInput.dispatchEvent(new Event("input", { bubbles: true })); ok = true; }
    } catch (e) { ok = false; }
    if (ok) cur = v;
    return ok;
  }

  // Runs inside requestAnimationFrame: write() can't throw, and this only reschedules while the tween is live.
  let raf = 0, twFrom = 0, twTo = 0, twStart = 0;
  function tweenTo(v) {
    twFrom = cur; twTo = v; twStart = performance.now();
    if (!raf) raf = requestAnimationFrame(step);
  }
  function step() {
    raf = 0;
    const p = (performance.now() - twStart) / TWEEN_MS;
    if (p >= 1) { write(twTo); if (!held) settle(); return; }
    // Two decimals: the game's slider handler draws this value into a label canvas on every write.
    if (write(Math.round((twFrom + (twTo - twFrom) * p) * 100) / 100)) raf = requestAnimationFrame(step);
    else if (!held) settle();
  }
  function cancelTween() { if (raf) { cancelAnimationFrame(raf); raf = 0; } }
  function settle() { zooming = false; orig = null; }

  // First press before priming worked. Nothing has been written yet, so failing here leaves the FOV alone.
  let firstPress = false;
  async function fillInput() {
    firstPress = true;
    const real = orig;
    let got = false;
    try {
      const f = fovBus();
      if (f && f.setNow) { await f.set(real); got = true; }
      else got = !!(await localStealFov());
    } catch (e) {}
    firstPress = false;
    if (!zooming) return;   // blur or pagehide ended it during the await
    if (!got || !write(real)) { held = false; settle(); }
    else if (held) tweenTo(orig / zoom);
    else settle();
  }

  function start() {
    if (held || firstPress || !canZoom()) return;
    held = true;
    // Pressed during the tween back: orig is still the real FOV, and cur the value to carry on from.
    if (!zooming) { zooming = true; orig = storedFov(); cur = orig; }
    if (write(cur)) { tweenTo(orig / zoom); log("zoom ON", orig, "->", orig / zoom); return; }
    // Unlocked in a world with the crosshair hidden may mean an open inventory, and a menu rebuild would close it.
    if (locked() || idle() || !inWorld()) { fillInput(); return; }
    held = false; settle();
  }
  function stop() {
    if (!held) return;
    held = false;
    log("zoom OFF");
    if (firstPress) return;
    if (cur === orig) { cancelTween(); settle(); }
    else tweenTo(orig);
  }
  // No tween: requestAnimationFrame stops in a hidden tab, and that would leave the zoom running.
  function endNow() {
    held = false;
    cancelTween();
    if (!zooming) return;
    if (cur !== orig) write(orig);
    settle();
  }

  // Fill the input cache while that can't disturb anyone, so the first press needs no menu at all.
  function primeTick() {
    const f = fovBus();
    if (f && f.setNow && f.prime) {
      Promise.resolve().then(() => f.prime()).then(ok => { if (ok !== true) setTimeout(primeTick, POLL_MS); }, () => {});
      return;
    }
    if (fovInput !== undefined) return;
    if (!zooming && idle()) { localStealFov(); return; }
    setTimeout(primeTick, POLL_MS);
  }

  refreshConfig();

  addEventListener("keydown", (e) => {
    if (e.__tcCaptured || (window.__tcOptions && window.__tcOptions.capturing)) return;
    if (e.code !== KEY || e.repeat) return;
    if (typing(e.target)) return;
    start();
  }, true);
  addEventListener("keyup", (e) => {
    if (e.__tcCaptured || (window.__tcOptions && window.__tcOptions.capturing)) return;
    if (e.code === KEY) stop();
  }, true);
  addEventListener("blur", endNow);
  document.addEventListener("visibilitychange", () => { if (document.hidden) endNow(); });
  // The game's slider handler stores every value it gets, and 80 / 1.5 = 53 would pass its 30-110 check on reload.
  addEventListener("pagehide", () => {
    const real = orig;
    endNow();
    if (real != null) { try { localStorage.setItem("mc.fov", String(real)); } catch (e) {} }
  });

  addEventListener("wheel", (e) => {
    if (!held) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    zoom = Math.min(20, Math.max(1.5, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    if (!firstPress) tweenTo(orig / zoom);   // tweenTo keeps one frame callback, so a fast wheel is one write per frame
  }, { capture: true, passive: false });

  addEventListener("mousemove", (e) => {
    if (!held) return;
    if (document.pointerLockElement !== gl()) return;
    const f = look / zoom;
    if (f === 1) return;
    try {
      Object.defineProperty(e, "movementX", { value: e.movementX * f, configurable: true });
      Object.defineProperty(e, "movementY", { value: e.movementY * f, configurable: true });
    } catch (err) {}
  }, true);

  function registerWithBus() {
    const b = window.__tcOptions;
    if (!b || !b.registerKeybind) { setTimeout(registerWithBus, 200); return; }
    if (b.changed) b.changed(() => refreshConfig());
    b.registerKeybind({
      id: "zoom",
      label: "Zoom (hold)",
      defaultKey: DEFAULTS.key,
      get: () => KEY,
      set: (code) => { KEY = code; tcSet("key", code); },
      reset: () => { KEY = DEFAULTS.key; tcSet("key", DEFAULTS.key); }
    });
    if (b.register) {
      b.register({
        id: "zoom",
        title: "Zoom",
        build: (api) => [
          api.header("Zoom"),
          api.slider("Zoom level", Math.round(zoom * 100) / 100, 1.5, 20, 0.5, v => { zoom = v; tcSet("level", v); }),
          api.slider("Look sensitivity (zoomed)", Math.round(Number(tcGet("look", DEFAULTS.look)) * 100) / 100, 0.1, 3, 0.05, v => { look = v; tcSet("look", v); refreshConfig(); }),
          api.note("Zoom key: " + (api.prettyKey ? api.prettyKey(KEY) : KEY) + " — change it in the Keybinds tab. Scroll to adjust the zoom while holding it."),
          api.row(api.btn("Reset zoom key to C", () => { KEY = DEFAULTS.key; tcSet("key", DEFAULTS.key); if (api.refresh) api.refresh(); }))
        ]
      });
    }
  }
  registerWithBus();
  primeTick();

  // Read by Better Options' Copy settings, which must never report a zoomed FOV.
  window.__tcZoom = {
    get zooming() { return zooming; },
    get realFov() { return zooming ? orig : storedFov(); },
    version: typeof GM_info !== "undefined" && GM_info.script ? GM_info.script.version : null
  };

  log("script loaded on", location.host);
})();
