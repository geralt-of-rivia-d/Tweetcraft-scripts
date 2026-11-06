// ==UserScript==
// @name         Twitterentary shaders
// @namespace    tweetcraft.twitterentary
// @version      1.5.2
// @author       andrestube123
// @description  Adds shader-style lighting, sun shadows, waving plants, reflective water, and a dynamic sky to TweetCraft, with Quality and Look presets.
// @match        https://tweetcraft.jai.vin/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    const TAG = '[Twitterentary]';
    const VERSION = (() => {
        try { return (typeof GM_info !== 'undefined' && GM_info && GM_info.script && GM_info.script.version) || 'dev'; } catch (e) { return 'dev'; }
    })();

    // Defaults = Quality "Medium" + Look "Natural" (see PRESETS).
    const CFG = {
        enabled: true,
        shadows: true,
        shadowSize: 2048,
        shadowExtent: 56,
        shadowDepth: 256,
        shadowFilter: 1,
        shadowEvery: 8,
        shadowMove: 6,
        shadowTaps: 8, // unused since 1.4.0 (replaced by shadowFilter); kept so old settings still parse
        shadowCull: true, // debug: back-face culling in the shadow pass
        shadowCascades: true, // no UI row: near + far shadow tiles (false = one map, as in 1.4.0)

        waving: true,
        leafSway: 0.028,
        plantSway: 0.075,

        waterEffects: true,
        waveStrength: 1.0,

        skyEffects: true,
        cloudEffects: true,

        sunStrength: 0.75,
        ambientStrength: 1.0,
        blockLight: 0.9,
        aoPower: 1.3,
        exposure: 1.0,
        saturation: 1.0,
        contrast: 1.0,
        emissive: 1.0
    };
    const DEFAULTS = Object.freeze(Object.assign({}, CFG));

    // UI rows for Better Options. `group` = which preset picker owns the key, `section` = heading in the tab.
    const SCHEMA = [
        { key: 'enabled', label: 'Shaders', type: 'bool' },
        { key: 'shadows', label: 'Sun shadows', type: 'bool', group: 'quality', section: 'Quality' },
        { key: 'shadowSize', label: 'Shadow resolution', type: 'num', min: 1024, max: 4096, step: 1024, group: 'quality', section: 'Quality' },
        { key: 'shadowExtent', label: 'Shadow range', type: 'num', min: 16, max: 96, step: 8, group: 'quality', section: 'Quality' },
        { key: 'shadowFilter', label: 'Shadow edges', type: 'choice', options: [[0, 'Hard'], [1, 'Soft'], [2, 'Softer']], group: 'quality', section: 'Quality' },
        { key: 'shadowEvery', label: 'Shadow update limit (frames)', type: 'num', min: 1, max: 30, step: 1, group: 'quality', section: 'Quality' },
        { key: 'shadowMove', label: 'Shadow update distance', type: 'num', min: 1, max: 16, step: 1, group: 'quality', section: 'Quality' },
        { key: 'sunStrength', label: 'Sun light', type: 'num', min: 0, max: 2, step: 0.05, group: 'look', section: 'Look' },
        { key: 'ambientStrength', label: 'Ambient light', type: 'num', min: 0, max: 2, step: 0.05, group: 'look', section: 'Look' },
        { key: 'blockLight', label: 'Block light', type: 'num', min: 0, max: 2, step: 0.05, group: 'look', section: 'Look' },
        { key: 'aoPower', label: 'Contact shadows (AO)', type: 'num', min: 0.5, max: 3, step: 0.1, group: 'look', section: 'Look' },
        { key: 'emissive', label: 'Emissive glow', type: 'num', min: 0, max: 2, step: 0.05, group: 'look', section: 'Look' },
        { key: 'exposure', label: 'Exposure', type: 'num', min: 0.4, max: 2, step: 0.05, group: 'look', section: 'Look' },
        { key: 'saturation', label: 'Saturation', type: 'num', min: 0, max: 1.5, step: 0.02, group: 'look', section: 'Look' },
        { key: 'contrast', label: 'Contrast', type: 'num', min: 0.5, max: 1.8, step: 0.01, group: 'look', section: 'Look' },
        { key: 'waving', label: 'Waving leaves & plants', type: 'bool', section: 'Motion & water' },
        { key: 'leafSway', label: 'Leaf sway', type: 'num', min: 0, max: 0.15, step: 0.002, section: 'Motion & water' },
        { key: 'plantSway', label: 'Plant sway', type: 'num', min: 0, max: 0.3, step: 0.005, section: 'Motion & water' },
        { key: 'waterEffects', label: 'Water effects', type: 'bool', section: 'Motion & water' },
        { key: 'waveStrength', label: 'Wave strength', type: 'num', min: 0, max: 2, step: 0.05, section: 'Motion & water' },
        { key: 'skyEffects', label: 'Sky effects', type: 'bool', section: 'Motion & water' }
    ];
    const FIELD = {};
    for (const f of SCHEMA) FIELD[f.key] = f;
    // keys without a UI row
    const HIDDEN_RANGE = { shadowDepth: [64, 1024], shadowTaps: [2, 16] };
    // [min, max] of every numeric key (the UI range, or HIDDEN_RANGE), shared by coerce() and cfgNum()
    const RANGE = {};
    for (const k in CFG) { const f = FIELD[k]; RANGE[k] = f && f.type === 'num' ? [f.min, f.max] : (HIDDEN_RANGE[k] || null); }

    const PRESETS = deepFreeze({
        quality: [
            { id: 'low', name: 'Low', desc: 'No sun shadows. Fastest.', values: { shadows: false } },
            { id: 'medium', name: 'Medium', desc: '2048 shadows, 56-block range, soft edges.', values: { shadows: true, shadowSize: 2048, shadowExtent: 56, shadowFilter: 1, shadowEvery: 8, shadowMove: 6 } },
            { id: 'high', name: 'High', desc: 'Sharp near shadows, 72-block range, quicker updates.', values: { shadows: true, shadowSize: 2048, shadowExtent: 72, shadowFilter: 1, shadowEvery: 4, shadowMove: 4 } },
            { id: 'ultra', name: 'Ultra', desc: 'Sharp near shadows, 96-block range, softest edges, fastest updates.', values: { shadows: true, shadowSize: 2048, shadowExtent: 96, shadowFilter: 2, shadowEvery: 2, shadowMove: 2 } }
        ],
        look: [
            { id: 'natural', name: 'Natural', desc: 'Neutral sunlight, true-to-texture colour.', values: { sunStrength: 0.75, ambientStrength: 1.0, blockLight: 0.9, aoPower: 1.3, emissive: 1.0, exposure: 1.0, saturation: 1.0, contrast: 1.0 } },
            { id: 'vivid', name: 'Vivid', desc: 'Stronger sun and richer colour.', values: { sunStrength: 0.9, ambientStrength: 1.0, blockLight: 1.0, aoPower: 1.5, emissive: 1.15, exposure: 1.0, saturation: 1.12, contrast: 1.05 } },
            { id: 'soft', name: 'Soft', desc: 'Gentle light and muted colour.', values: { sunStrength: 0.65, ambientStrength: 1.1, blockLight: 0.85, aoPower: 1.0, emissive: 0.9, exposure: 1.05, saturation: 0.92, contrast: 0.95 } }
        ]
    });
    const GROUP_KEYS = { quality: SCHEMA.filter(f => f.group === 'quality').map(f => f.key), look: SCHEMA.filter(f => f.group === 'look').map(f => f.key) };

    function deepFreeze(o) {
        if (o && typeof o === 'object') { for (const k of Object.keys(o)) deepFreeze(o[k]); Object.freeze(o); }
        return o;
    }

    // Turn any stored or user value into a valid one for `key` (clamped to the UI range).
    function coerce(key, v) {
        const d = DEFAULTS[key];
        if (typeof d === 'boolean') return v === true || v === 'true' || v === 1 || v === '1';
        let n = Number(v);
        if (!Number.isFinite(n)) return d;
        const f = FIELD[key];
        if (f && f.type === 'choice') return f.options.some(o => o[0] === n) ? n : d;
        const r = RANGE[key];
        if (r) n = Math.min(r[1], Math.max(r[0], n));
        return n;
    }
    // The live numeric value of `key`, normalised the same way even if CFG was written directly (console):
    // not a number -> default, otherwise clamped to RANGE. Allocation-free, so frame code can use it.
    function cfgNum(key) {
        const n = Number(CFG[key]), r = RANGE[key];
        if (!Number.isFinite(n)) return DEFAULTS[key];
        return r ? Math.min(r[1], Math.max(r[0], n)) : n;
    }
    const same = (a, b) => (typeof b === 'number' ? Math.abs(Number(a) - b) < 1e-6 : a === b);
    const SKEY = k => 'tc.shader.' + k;

    for (const k in CFG) {
        try {
            const v = localStorage.getItem(SKEY(k));
            if (v !== null) CFG[k] = coerce(k, v);
        } catch (e) {}
    }

    // tc.shader.format: written with the first non-default value 1.5.0+ saves (and by the migration below), so
    // the one-time 1.4.0 migration never undoes a choice made since. reset() clears it with every other key.
    const FORMAT_KEY = SKEY('format'), FORMAT = '1.5';
    let formatSaved = false;
    try { formatSaved = localStorage.getItem(FORMAT_KEY) !== null; } catch (e) {}
    // 1.4.0's High and Ultra saved shadowSize 4096; 1.5.0's use 2048 plus a near tile (a saved 4096 would make a
    // 6144x4096 atlas with ~9.7 ms far redraws, and the picker would read Custom). A saved Quality group that is
    // exactly one of those two 1.4.0 presets (every other Quality key at its default) loses its shadowSize, so it
    // reads as High / Ultra again. Any other combination is a deliberate Custom choice and stays. Idempotent.
    const LEGACY_140 = [
        { shadows: true, shadowSize: 4096, shadowExtent: 72, shadowFilter: 1, shadowEvery: 4, shadowMove: 4 }, // High
        { shadows: true, shadowSize: 4096, shadowExtent: 96, shadowFilter: 2, shadowEvery: 2, shadowMove: 2 }  // Ultra
    ];
    if (!formatSaved) {
        try {
            if (LEGACY_140.some(p => GROUP_KEYS.quality.every(k => same(CFG[k], k in p ? p[k] : DEFAULTS[k])))) {
                localStorage.removeItem(SKEY('shadowSize'));
                CFG.shadowSize = DEFAULTS.shadowSize;
                localStorage.setItem(FORMAT_KEY, FORMAT); formatSaved = true;
                console.info(TAG, 'Updated a 1.4.0 Quality preset: shadow resolution 2048 plus a near tile');
            }
        } catch (e) {}
    }

    // The on/off key. Saved the way persist() saves a setting (only when it isn't the default), but kept out of
    // CFG: it is a key code, not a shader setting, and CFG's shape is what Better Options and the bench read.
    const TOGGLE_DEFAULT = 'KeyK', TOGGLE_STORE = SKEY('toggleKey');
    let toggleKey = TOGGLE_DEFAULT;
    try { toggleKey = localStorage.getItem(TOGGLE_STORE) || TOGGLE_DEFAULT; } catch (e) {}
    function setToggleKey(code) {
        toggleKey = (typeof code === 'string' && code) || TOGGLE_DEFAULT;
        try {
            if (toggleKey === TOGGLE_DEFAULT) localStorage.removeItem(TOGGLE_STORE);
            else localStorage.setItem(TOGGLE_STORE, toggleKey);
        } catch (e) {}
    }

    function persist(key) {
        try {
            if (same(CFG[key], DEFAULTS[key])) localStorage.removeItem(SKEY(key));
            else {
                localStorage.setItem(SKEY(key), String(CFG[key]));
                if (!formatSaved) { localStorage.setItem(FORMAT_KEY, FORMAT); formatSaved = true; }
            }
        } catch (e) {}
    }

    const proto = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
    if (!proto) return;

    const O = {};
    for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram',
        'bindVertexArray', 'deleteVertexArray', 'getUniformLocation', 'uniform1f', 'uniform1i', 'uniform3f', 'uniform3fv',
        'uniform4f', 'uniformMatrix4fv', 'drawElements', 'clear', 'texImage3D', 'texSubImage3D',
        'viewport', 'bindFramebuffer', 'bindBuffer', 'bufferData']) {
        O[k] = proto[k];
    }

    // Frame timing: every rAF callback is wrapped once (WeakMap fn -> wrapper, so the game's recurring `step`
    // allocates nothing per frame) to note when it starts. The game looks requestAnimationFrame up at each
    // re-arm (frameloop.js), so this document-start wrapper is the one it uses.
    const RAF = { seq: 0, t0: 0, ts: 0, active: 0 };
    try {
        const origRaf = window.requestAnimationFrame;
        if (typeof origRaf === 'function') {
            const wraps = new WeakMap();
            window.requestAnimationFrame = function requestAnimationFrame(fn) {
                if (typeof fn !== 'function') return origRaf.call(window, fn);
                let w = wraps.get(fn);
                if (w === undefined) {
                    w = function (t) {
                        RAF.seq++; RAF.t0 = performance.now(); RAF.ts = t; RAF.active++;
                        try { return fn(t); } finally { RAF.active--; }
                    };
                    wraps.set(fn, w);
                }
                return origRaf.call(window, w);
            };
        }
    } catch (e) { console.warn(TAG, 'frame timing hook failed', e); }

    const clamp01 = x => Math.min(1, Math.max(0, x));
    const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function normInto(o, x, y, z) { const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; }
    function mixInto(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }
    function copy3(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }

    // ---------------------------------------------------------------- GLSL

    // The atlas layer of a vertex. Since build 6b3963e444 it is 9 bits: bit 8 sits in bit 9 of aPos.z. The game's own
    // `layer` local comes after the line we insert at, so we decode it ourselves. A build without that decode (staging
    // today) has only aInfo.x. patchTerrainVS detects it; the shadow programs read the result in initGL, which runs
    // after it because the game's first program is a terrain one (gfx.js; a runtime compat check reads the decode).
    let layerBits = 8;
    const layerDecl = () => `int tcLayer = ${layerBits === 9 ? 'int(aInfo.x | (((aPos.z >> 9u) & 1u) << 8u))' : 'int(aInfo.x)'};`;

    function patchTerrainVS(src) {
        const re = /vec3\s+p\s*=\s*vec3\(\s*aPos\s*&\s*uvec3\(\s*0x1FFu\s*,\s*0xFFFu\s*,\s*0x1FFu\s*\)\s*\)\s*\*\s*0\.0625\s*\+\s*uOrigin\s*;/;
        if (!/aPos\s*&\s*uvec3/.test(src) || !src.includes('uniform vec3 uOrigin;') ||
            !re.test(src) || !src.includes('out vec2 vLight;')) return null;
        layerBits = /aPos\.z\s*>>\s*9u/.test(src) ? 9 : 8;

        // One output: vTcP = (camera-relative position, layer class). On the UHD 620 every extra varying row costs
        // per vertex and per primitive (rd 12: ~2.5 ms with the 1.5.0 betas' vRel + flat vCls + vTcBlk); the class
        // rides in .w (constant across a face, so interpolation keeps it; the FS rounds it).
        let s = src.replace('uniform vec3 uOrigin;', () =>
            'uniform vec3 uOrigin;\nuniform highp sampler2D uClsTex;\nuniform vec3 uCam;\nuniform float uTime;\nuniform float uFx;' +
            '\nuniform float uWaveOn;\nuniform float uLeafSway;\nuniform float uPlantSway;');
        s = s.replace('out vec2 vLight;', () => 'out vec2 vLight;\nout vec4 vTcP;');

        const wave = `
  if (uFx > 0.5 && uWaveOn > 0.5 && tcC > 0.5 && tcC < 2.5) {
    vec3 tcW = p + uCam;
    float tcPl = tcC > 1.5 ? 1.0 : 0.0;
    // plants: the base (v=1) stays fixed, the tip moves
    float tcWt = tcPl > 0.5 ? 1.0 - float((aInfo.y >> 1u) & 1u) : 1.0;
    float tcG = 0.55 + 0.9 * (0.5 + 0.5 * sin(tcW.x * 0.11 + tcW.z * 0.07 + uTime * 0.45));
    float tcA = sin(uTime * 1.7 + tcW.x * 1.30 + tcW.z * 0.90) + 0.5 * sin(uTime * 3.1 + tcW.x * 2.30 - tcW.z * 1.70);
    float tcB = sin(uTime * 1.4 + tcW.z * 1.20 - tcW.x * 0.70) + 0.5 * sin(uTime * 2.7 - tcW.z * 2.10 + tcW.x * 1.90);
    float tcAmp = mix(uLeafSway, uPlantSway, tcPl) * tcWt * tcG;
    p.x += tcA * tcAmp;
    p.z += tcB * tcAmp;
    p.y += tcPl > 0.5 ? -abs(tcA + tcB) * tcAmp * 0.2 : tcB * tcAmp * 0.3;
  }`;

        return s.replace(re, m => `${m}
  float tcC = 0.0;
  if (uFx > 0.5) {
    ${layerDecl()}
    tcC = floor(texelFetch(uClsTex, ivec2(tcLayer, 0), 0).r * 255.0 + 0.5);
  }
  vTcP = vec4(p, tcC);${wave}`);
    }

    // The shadow lookup. Its constants are uniforms (uLVP, uShadowP/B/N: matrix, tile sizes, atlas texel, world
    // texels, depth range, near radius, near-tile scale and offset), so every setting applies live. Both tiles
    // share one light basis, so the near tile's coordinates are the far tile's, scaled and offset: one matrix
    // product per pixel. Castaño's tent filters: 1, 4 (3x3) or 9 (5x5) hardware-PCF taps by uShadowQ; the 9-tap
    // tent is unrolled by hand (a loop indexing local vectors can become an indexable temp array on D3D).
    // Note: ANGLE turns textureLod on a shadow sampler into SampleCmp (not ...LevelZero) on D3D11.
    function shadowGlsl() {
        return `float tcTap(vec2 p, float z) {
  return textureLod(uShadowMap, vec3(p, z), 0.0);
}
// Atlas: the near tile (uShadowP.x texels, at x = 0) close to the camera, the far tile (uShadowP.y texels, at
// x = uShadowP.x) elsewhere; uShadowP.zw = 1 / atlas size. uShadowB = (near texel, far texel in blocks, depth
// range, near radius: 0 = far tile only); uShadowN = (scale, offset) from far to near tile coordinates.
float tcShadow(vec3 rel, vec3 n, float ndl, bool cheap) {
  bool tcNear = dot(rel, rel) < uShadowB.w * uShadowB.w;
  vec3 sc = (uLVP * vec4(rel + n * ((tcNear ? uShadowB.x : uShadowB.y) * 1.6 + 0.015), 1.0)).xyz * 0.5 + 0.5;
  vec2 uv = vec2(0.0);
  float fade = 1.0;
  if (tcNear) {
    vec3 q = vec3(sc.xy * uShadowN.x + uShadowN.yz, sc.z + uShadowN.w);
    tcNear = max(abs(q.x - 0.5), abs(q.y - 0.5)) < 0.49 && q.z < 1.0 && q.z > 0.0;
    if (tcNear) { sc = q; uv = q.xy * uShadowP.x; }
  }
  if (!tcNear) {
    float edge = max(abs(sc.x - 0.5), abs(sc.y - 0.5)) * 2.0;
    if (edge >= 1.0 || sc.z >= 1.0 || sc.z <= 0.0) return 1.0;
    fade = 1.0 - smoothstep(0.82, 1.0, edge);
    uv = vec2(sc.x * uShadowP.y + uShadowP.x, sc.y * uShadowP.y);
  }
  float z = sc.z - (0.03 + 0.06 * (1.0 - ndl)) / (2.0 * uShadowB.z);
  vec2 inv = uShadowP.zw;
  if (cheap || uShadowQ < 0.5) return mix(1.0, tcTap(uv * inv, z), fade);
  vec2 b = floor(uv + 0.5);
  vec2 st = uv + 0.5 - b;
  b = (b - 0.5) * inv;
  float s;
  if (uShadowQ < 1.5) {
    vec2 w0 = 3.0 - 2.0 * st, w1 = 1.0 + 2.0 * st;
    vec2 o0 = ((2.0 - st) / w0 - 1.0) * inv, o1 = (st / w1 + 1.0) * inv;
    s = (w0.x * w0.y * tcTap(b + o0, z) + w1.x * w0.y * tcTap(b + vec2(o1.x, o0.y), z)
       + w0.x * w1.y * tcTap(b + vec2(o0.x, o1.y), z) + w1.x * w1.y * tcTap(b + o1, z)) * (1.0 / 16.0);
  } else {
    vec3 wx = vec3(4.0 - 3.0 * st.x, 7.0, 1.0 + 3.0 * st.x);
    vec3 wy = vec3(4.0 - 3.0 * st.y, 7.0, 1.0 + 3.0 * st.y);
    vec3 ox = vec3((3.0 - 2.0 * st.x) / wx.x - 2.0, (3.0 + st.x) / 7.0, st.x / wx.z + 2.0) * inv.x;
    vec3 oy = vec3((3.0 - 2.0 * st.y) / wy.x - 2.0, (3.0 + st.y) / 7.0, st.y / wy.z + 2.0) * inv.y;
    vec3 r0 = vec3(tcTap(b + vec2(ox.x, oy.x), z), tcTap(b + vec2(ox.y, oy.x), z), tcTap(b + vec2(ox.z, oy.x), z));
    vec3 r1 = vec3(tcTap(b + vec2(ox.x, oy.y), z), tcTap(b + vec2(ox.y, oy.y), z), tcTap(b + vec2(ox.z, oy.y), z));
    vec3 r2 = vec3(tcTap(b + vec2(ox.x, oy.z), z), tcTap(b + vec2(ox.y, oy.z), z), tcTap(b + vec2(ox.z, oy.z), z));
    s = (dot(wx, r0) * wy.x + dot(wx, r1) * wy.y + dot(wx, r2) * wy.z) * (1.0 / 144.0);
  }
  return mix(1.0, s, fade);
}
`;
    }

    function fsDecls(mode) {
        const water = mode === 2 ? `
vec2 tcWv(vec2 q, vec2 d, float k, float a, float s) {
  return d * (k * a) * cos(dot(q, d) * k + uTime * s);
}
` : '';
        return `
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uSunDir;
uniform vec3 uSunCol;
uniform vec3 uZenith;
uniform vec3 uSkySun;
uniform float uDay;
uniform float uDim;
uniform float uShadowOn;
uniform float uShadowQ;
uniform vec4 uShadowP;
uniform float uFx;
uniform float uWaterOn;
uniform float uWaveStr;
uniform float uAoPow;
uniform float uBlockStr;
uniform float uEmissive;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uAmb0;
uniform vec3 uAmb1;
uniform vec3 uSunC;
uniform float uSunK;
uniform float uGrade;
uniform mat4 uLVP;
uniform vec4 uShadowN;
uniform vec4 uShadowB;
uniform highp sampler2DShadow uShadowMap;
in vec4 vTcP;
uniform vec3 uTcLm0;

// Highlight roll-off above 0.7. Mostly applied to the brightest channel, so sunlit sand, wood and
// terracotta keep their hue instead of bleaching toward white; 30% per channel keeps a soft white-out.
// Cubic instead of exp (LAB: same slope at 0.7, saturates at 1.6; max 8/255 off the exp curve, cheaper).
vec3 tcTone(vec3 x) {
  vec3 v = 1.0 - clamp((x - 0.7) * (1.0 / 0.9), 0.0, 1.0);
  vec3 pc = min(x, vec3(0.7)) + 0.3 - 0.3 * v * v * v;
  float m = max(max(x.r, x.g), max(x.b, 1e-4));
  float vm = 1.0 - clamp((m - 0.7) * (1.0 / 0.9), 0.0, 1.0);
  float t = min(m, 0.7) + 0.3 - 0.3 * vm * vm * vm;
  return mix(x * (t / m), pc, 0.3);
}
${shadowGlsl()}
${water}`;
    }

    // Water without a depth or scene texture: Fresnel and view-path absorption decide the blend alpha
    // (A = 1-(1-F)(1-abs), C = (F*R + (1-F)*abs*W)/A), the reflection is the sky shader's own gradient,
    // and wave octaves fade with the pixel footprint so distant water turns into a calm mirror.
    const WATER_CODE = `
  if (tcWater && uWaterOn > 0.5) {
    vec3 tcWp = vRel + uCam;
    float tcFp = max(length(tcDx), length(tcDy));
    vec3 tcWn = tcN;
    if (tcN.y > 0.9) {
      vec2 tcG = tcWv(tcWp.xz, vec2(0.894, 0.447), 1.9, 0.040, 1.2) * clamp(1.5 - tcFp * 1.9, 0.0, 1.0)
               + tcWv(tcWp.xz, vec2(-0.6, 0.8), 3.1, 0.026, 1.6) * clamp(1.5 - tcFp * 3.1, 0.0, 1.0);
      if (tcFp < 0.283)
        tcG += tcWv(tcWp.xz, vec2(0.3, -0.954), 5.3, 0.016, 2.1) * clamp(1.5 - tcFp * 5.3, 0.0, 1.0)
             + tcWv(tcWp.xz, vec2(-0.95, -0.3), 8.9, 0.009, 2.9) * clamp(1.5 - tcFp * 8.9, 0.0, 1.0);
      tcG *= uWaveStr;
      tcWn = normalize(vec3(-tcG.x, 1.0, -tcG.y));
    }
    float tcM = 1.0 - max(dot(tcWn, -tcV), 0.0), tcM2 = tcM * tcM;
    float tcFres = 0.02 + 0.98 * tcM2 * tcM2 * tcM;
    vec3 tcR = reflect(tcV, tcWn);
    float tcRy = max(tcR.y, 0.0);
    vec3 tcRefl = mix(uFog, uZenith, sqrt(min(tcRy * 1.7, 1.0)));
    float tcHz = 1.0 - tcRy; tcHz *= tcHz;
    tcRefl += vec3(0.07, 0.085, 0.10) * (tcHz * tcHz * tcDay);
    tcRefl *= 0.3 + 0.7 * tcSkyK;
    float tcTex = dot(c.rgb, vec3(0.299, 0.587, 0.114)) * 3.1;
    vec3 tcBody = vec3(0.04, 0.33, 0.47) * mix(1.0, tcTex, 0.3) * (tcAmbient * tcAO + tcBlock + tcSunL * 0.6);
    float tcAbs = 1.0 - exp2(-1.4 / max(dot(tcN, -tcV), 0.05));
    tcAlpha = 1.0 - (1.0 - tcFres) * (1.0 - tcAbs);
    tcCol = (tcFres * tcRefl + (1.0 - tcFres) * tcAbs * tcBody) / tcAlpha;
    float tcSd = dot(tcR, uSkySun);
    if (tcSd > 0.85 && tcDay > 0.0) {
      float tcE = mix(1200.0, 160.0, clamp(tcFp * 6.0, 0.0, 1.0));
      tcCol += uSunCol * (exp2(tcE * log2(tcSd)) * tcE * 0.005 * tcVis * tcDay * smoothstep(0.0, 0.1, uSkySun.y) * tcSky / tcAlpha);
    }
    if (tcDay < 1.0 && tcSd < -0.98)
      tcCol += vec3(0.6, 0.7, 1.0) * (exp2(500.0 * log2(-tcSd)) * 2.0 * (1.0 - tcDay) * tcSky / tcAlpha);
  }`;

    function shadeCode(lit, alpha, mode, fogR) {
        const lm = lit ? ' * lightmap(vLight)' : '';
        const blockEngine = lit
            ? '+ tcBlkE'
            : '';
        const ambFloor = lit ? '+ vec3(0.012 + uAmbient * 0.5)' : '+ vec3(0.012)';
        // Sun scattering only in open-air fog: underwater (fog ends at 14) and in lava (1) it would put a
        // sun glow in the murk. The shortest overworld fog ends at 60 (render distance 4).
        const scat = fogR ? '(uFogR.y > 20.0 ? 0.18 * uDay : 0.0)' : '0.18 * uDay';

        return `
  if (uFx < 0.5) { o = vec4(mix(c.rgb * vShade${lm}, uFog, f), ${alpha}); return; }
  vec3 tcV = normalize(vRel);
  float tcScat = ${scat};
  // fully fogged: skip the lighting model, keep the sun-tinted fog
  if (f > 0.999) {
    float tcS0 = max(dot(tcV, uSkySun), 0.0); tcS0 *= tcS0;
    o = vec4(uFog + uSunCol * (tcS0 * tcS0 * tcS0 * tcScat), ${alpha});
    return;
  }
  vec3 tcNr = cross(tcDx, tcDy);
  float tcNl = length(tcNr);
  vec3 tcN = tcNl > 1e-12 ? tcNr / tcNl : vec3(0.0, 1.0, 0.0);
  bool tcLeaf = vCls > 0.5 && vCls < 1.5;
  bool tcPlant = vCls > 1.5 && vCls < 2.5;
  bool tcWater = vCls > 2.5 && vCls < 3.5;
  bool tcEmit = vCls > 3.5;

  vec3 tcNs = tcN;
  if (tcPlant) tcNs = normalize(mix(tcN, vec3(0.0, 1.0, 0.0), 0.7));
  else if (tcLeaf) tcNs = normalize(mix(tcN, vec3(0.0, 1.0, 0.0), 0.35));
  float tcSky = ${lit ? 'clamp(vLight.x * (1.0 / 15.0), 0.0, 1.0)' : '1.0'};

  // sun + shadows first, while few values are live (LAB: ~1.2 ms less than looking up after the ambient terms).
  // The shadow is only sampled where the sun can actually reach; uSunC = sun colour x strength x (day, sun
  // above the horizon, not Nether/End), from the CPU.
  float tcNdl = clamp(dot(tcNs, uSunDir) * 1.1 + 0.06, 0.0, 1.0);
  float tcSkyMask = smoothstep(0.5, 0.95, tcSky);
  float tcVis = 1.0;
  if (uShadowOn > 0.5 && tcNdl > 0.001 && uSunK * tcSkyMask > 0.001)
    tcVis = tcShadow(vRel, tcN, tcNdl, vDist > 32.0 || tcLeaf || tcPlant || tcWater);

  // ambient occlusion: separated from the engine's per-face shading
  float tcExp = abs(tcN.y) > 0.5 ? (tcN.y > 0.0 ? 1.0 : 0.5) : (abs(tcN.x) > abs(tcN.z) ? 0.6 : 0.8);
  float tcAO = pow(clamp(vShade / tcExp, 0.0, 1.0), uAoPow);

  float tcBl = ${lit ? 'clamp(vLight.y * (1.0 / 15.0), 0.0, 1.0)' : '0.0'};
  float tcDay = uDay;
  float tcHemi = tcNs.y * 0.5 + 0.5;

  // hemispheric ambient light: soft blue sky above, warm bounce from the sunlit ground below. The day,
  // twilight, night and Nether/End mixes depend only on uniforms: uAmb0/uAmb1 are the endpoints for a
  // normal facing straight down/up, computed on the CPU (ambient strength included).
  vec3 tcAmb = mix(uAmb0, uAmb1, tcHemi);
  float tcSkyK = uDim > 0.5 ? 1.0 : pow(tcSky, 1.7);
  vec3 tcAmbient = tcAmb * (0.14 + 0.86 * tcSkyK) ${ambFloor};

  // block light (torches, lava...)${lit ? '\n  vec3 tcBlkE = vec3(0.0);\n  if (vLight.y > 0.0) tcBlkE = max(lightmap(vec2(0.0, vLight.y)) - uTcLm0, 0.0) * 0.35;' : ''}
  vec3 tcBlock = (vec3(1.0, 0.74, 0.48) * (tcBl * tcBl * (0.8 + 0.2 * tcBl)) * 1.3 ${blockEngine}) * uBlockStr;

  vec3 tcSunL = uSunC * (tcNdl * tcVis * tcSkyMask);
  if (tcLeaf) {
    float tcBk = clamp(dot(tcV, uSunDir), 0.0, 1.0);
    tcSunL += uSunC * (tcBk * tcBk * tcBk * tcVis * tcSkyMask * 0.2);
  }

  vec3 tcLight = tcAmbient * tcAO + tcBlock * (0.6 + 0.4 * tcAO) + tcSunL * (0.55 + 0.45 * tcAO);
  vec3 tcCol = c.rgb * tcLight;
  if (tcEmit) tcCol = max(tcCol, c.rgb * uEmissive);
  float tcAlpha = ${alpha};
${mode === 2 ? WATER_CODE : ''}

  // colour grading; saturation above 1 works like vibrance (saturated colours are boosted less).
  // uGrade = 0 when saturation and contrast are neutral: tcTone's output is already in [0, 1].
  tcCol *= uExposure;
  tcCol = tcTone(tcCol);
  if (uGrade > 0.5) {
    float tcLum = dot(tcCol, vec3(0.299, 0.587, 0.114));
    float tcMx = max(tcCol.r, max(tcCol.g, tcCol.b)), tcMn = min(tcCol.r, min(tcCol.g, tcCol.b));
    float tcSat = uSaturation > 1.0 ? 1.0 + (uSaturation - 1.0) * (1.0 - (tcMx - tcMn) / max(tcMx, 1e-3)) : uSaturation;
    tcCol = mix(vec3(tcLum), tcCol, tcSat);
    tcCol = clamp((tcCol - 0.5) * uContrast + 0.5, 0.0, 1.0);
  }

  // atmospheric fog with scattering toward the sun
  float tcF = f * f * (3.0 - 2.0 * f);
  float tcS = max(dot(tcV, uSkySun), 0.0); tcS *= tcS;
  vec3 tcFog = uFog + uSunCol * (tcS * tcS * tcS * tcScat * tcF);
  o = vec4(mix(tcCol, tcFog, tcF), tcAlpha);
`;
    }

    function patchTerrainFS(src) {
        const outRe = /o\s*=\s*vec4\(\s*mix\(\s*c\.rgb\s*\*\s*vShade(\s*\*\s*lightmap\(\s*vLight\s*\))?\s*,\s*uFog\s*,\s*f\s*\)\s*,\s*([^;]*?)\s*\)\s*;/;
        const cRe = /vec4\s+c\s*=\s*texture\(\s*uTex\s*,\s*vUV\s*\)\s*;/;
        const mainRe = /void\s+main\s*\(\s*\)\s*\{/;
        const m = outRe.exec(src);
        if (!m || !cRe.test(src) || !mainRe.test(src)) return null;
        const lit = !!m[1];
        const alpha = m[2].trim();
        const mode = alpha === 'c.a' ? 2 : (/discard/.test(src) ? 1 : 0);

        // vRel (camera-relative position) and vCls (layer class) unpacked from the VS's single output vTcP
        let s = src.replace(mainRe, mm => fsDecls(mode) + '\n' + mm + '\n  vec3 vRel = vTcP.xyz;\n  float vCls = floor(vTcP.w + 0.5);');
        // derivatives here, in uniform control flow before any discard; skipped with effects off (K)
        s = s.replace(cRe, mm => `${mm}\n  vec3 tcDx = vec3(0.0), tcDy = vec3(0.0);\n  if (uFx > 0.5) { tcDx = dFdx(vRel); tcDy = dFdy(vRel); }`);
        s = s.replace(outRe, () => shadeCode(lit, alpha, mode, /uniform\s+vec2\s+uFogR\s*;/.test(src)));
        return { src: s, info: { terrainFS: true, mode, lit } };
    }

    function skyCode() {
        return `
  if (uFx < 0.5 || uSkyOn < 0.5) { o = vec4(tcBase, 1.0); return; }
  vec3 tcd = normalize(vDir);
  float tcH = clamp(tcd.y, 0.0, 1.0);
  float tcSD = uSkyDay;
  vec3 tcC = tcBase;
  float tcLum = dot(tcC, vec3(0.299, 0.587, 0.114));
  tcC = mix(vec3(tcLum), tcC, 1.0 + 0.08 * tcSD);
  tcC *= 1.0 - 0.08 * tcSD * smoothstep(0.15, 1.0, tcH);
  float tcHz = 1.0 - tcH; tcHz *= tcHz;
  tcC += vec3(0.07, 0.085, 0.10) * (tcHz * tcHz * tcSD);
  // uSkyGlow = sun glow colour x visibility (from the sun height, on the CPU). The sharper lobes are
  // below 1/255 outside their cones (dot < 0.9 for x40, < 0.99 for x700), so they are only evaluated inside.
  float tcDs = dot(tcd, uSkySun);
  if (uSkyGlow.r > 0.0 && tcDs > 0.4) {
    float tcL = log2(tcDs);
    float tcG = exp2(tcL * 5.0) * 0.16;
    if (tcDs > 0.9) {
      tcG += exp2(tcL * 40.0) * 0.30;
      if (tcDs > 0.99) tcG += exp2(tcL * 700.0) * 0.6;
    }
    tcC += uSkyGlow * tcG;
  }
  if (tcSD < 0.999 && tcDs < -0.95) {
    float tcL = log2(-tcDs);
    tcC += vec3(0.45, 0.55, 0.90) * ((exp2(tcL * 80.0) * 0.12 + exp2(tcL * 2000.0) * 0.3) * (1.0 - tcSD));
  }
  tcC += (fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) - 0.5) / 255.0;
  o = vec4(tcC, 1.0);
`;
    }

    function patchSky(src) {
        if (!/uniform\s+vec3\s+uTop\s*,\s*uHor\s*;/.test(src) || !src.includes('vDir')) return null;
        const litRe = /o\s*=\s*vec4\(\s*c\s*,\s*1\.0\s*\)\s*;/;
        const plainRe = /o\s*=\s*vec4\(\s*mix\(\s*uHor\s*,\s*uTop\s*,\s*sqrt\(\s*t\s*\)\s*\)\s*,\s*1\.0\s*\)\s*;/;
        let s = src.replace(/out\s+vec4\s+o\s*;/, mm => mm + '\nuniform vec3 uSkySun;\nuniform float uSkyDay;\nuniform float uFx;\nuniform float uSkyOn;\nuniform vec3 uSkyGlow;');
        if (!s.includes('uSkySun')) return null;
        if (litRe.test(s)) s = s.replace(litRe, () => 'vec3 tcBase = c;\n' + skyCode());
        else if (plainRe.test(s)) s = s.replace(plainRe, () => 'vec3 tcBase = mix(uHor, uTop, sqrt(t));\n' + skyCode());
        else return null;
        return { src: s, info: { sky: true } };
    }

    function patchCloud(src) {
        if (!CFG.cloudEffects) return null;
        const re = /if\\s*\\(\\s*c\\.a\\s*<\\s*0\\.02\\s*\\)\\s*discard\\s*;/;
        if (!src.includes('uniform vec4 uTint, uHole;') || !src.includes('uKind') || !re.test(src)) return null;
        let s = src.replace(/uniform\\s+int\\s+uKind\\s*;/, mm => mm + '\\nuniform vec3 uCloudTint;\\nuniform float uFx;');
        s = s.replace(re, mm => `${mm}
  if (uKind == 1 && uFx > 0.5) { c.rgb *= uCloudTint; c.rgb *= mix(0.88, 1.04, c.a); }`);
        return { src: s, info: { cloud: true } };
    }

    function patchSource(src) {
        if (!src.includes('#version 300 es')) return null;
        if (/aPos\s*&\s*uvec3/.test(src)) {
            const s = patchTerrainVS(src);
            return s ? { src: s, info: { terrainVS: true } } : null;
        }
        if (src.includes('sampler2DArray') && /vShade/.test(src) && /uFog/.test(src) && /vDist/.test(src)) {
            return patchTerrainFS(src);
        }
        if (/uniform\s+vec3\s+uTop\s*,\s*uHor\s*;/.test(src)) return patchSky(src);
        if (src.includes('uTint, uHole')) return patchCloud(src);
        return null;
    }

    // ---------------------------------------------------------------- observed game state

    const FIXED_SUN = Object.freeze(normInto([0, 0, 0], 0.62, 0.6, -0.5));
    const OBS = {
        camOk: false,
        top: [0.47, 0.655, 1],
        topFrame: -9, sunSeen: true,
        sun: FIXED_SUN.slice(), sunFrame: -9,
        amb: 0, sl: [1, 1, 1],
        lit: false
    };
    const CAMLAST = [0, 0, 0];
    const locKind = new WeakMap();

    function setCam(x, y, z) { CAMLAST[0] = x; CAMLAST[1] = y; CAMLAST[2] = z; OBS.camOk = true; }
    function onSprite(x, y, z) {
        if (OBS.topFrame === frameId && !OBS.sunSeen) {
            normInto(OBS.sun, x, y, z); OBS.sunFrame = frameId; OBS.sunSeen = true;
        }
    }

    const ATL = { n: 0, stats: null, anim: new Set(), dirty: false, names: null };

    // The block-name list is captured from the game's first indexOf('oak_planks') on it; the hook
    // removes itself right after (and after 60 s at the latest) so it doesn't tax every indexOf.
    try {
        const origIdx = Array.prototype.indexOf;
        const unhook = () => { if (Array.prototype.indexOf === idxHook) Array.prototype.indexOf = origIdx; };
        const idxHook = function (v, f) {
            if (v === 'oak_planks' && !ATL.names && this.length > 50 && typeof this[0] === 'string') {
                ATL.names = this.slice(); ATL.dirty = true;
                unhook();
            }
            return origIdx.call(this, v, f);
        };
        Array.prototype.indexOf = idxHook;
        setTimeout(unhook, 60000);
    } catch (e) { console.warn(TAG, 'names hook failed', e); }
    const RE_EMIT = /lava|magma|lumen|glowstone|torch|lantern|fire|beacon|shroomlight|sea_lantern|jack_o|redstone_lamp_on|spark_lamp_on|campfire/i;
    const RE_PLANT = /^(short_grass|grass|tall_grass.*|fern|large_fern.*|.*sapling|.*_tulip|poppy|dandelion|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|rose_bush.*|peony.*|lilac.*|sunflower.*|dead_bush|sugar_cane|.*seagrass.*|kelp.*|wheat_stage.*|carrots_stage.*|potatoes_stage.*|beetroots_stage.*|vine|sweet_berry_bush.*|torchflower.*|pitcher.*|.*_roots|.*_sprouts|bush|flower.*)$/i;
    function nameClass(nm) {
        // campfire_log is the unlit log; campfire_log_lit and campfire_fire do glow
        if (RE_EMIT.test(nm) && !/torch_top|torch_off|lantern_top|^campfire_log$/.test(nm)) return 4;
        if (/leaves/i.test(nm)) return 1;
        if (/^water/i.test(nm)) return 3;
        if (RE_PLANT.test(nm)) return 2;
        return 0;
    }

    function readAtlas(px, n) {
        const u8 = new Uint8Array(px.buffer, px.byteOffset, Math.min(px.byteLength, n * 1024));
        const st = new Float32Array(n * 5);
        for (let l = 0; l < n; l++) {
            let tr = 0, op = 0, r = 0, g = 0, b = 0;
            const base = l * 1024;
            for (let i = 0; i < 256; i++) {
                const o = base + i * 4;
                if (o + 3 >= u8.length) break;
                if (u8[o + 3] < 128) { tr++; continue; }
                op++; r += u8[o]; g += u8[o + 1]; b += u8[o + 2];
            }
            const o5 = l * 5;
            st[o5] = tr / 256;
            if (op) { st[o5 + 1] = r / op; st[o5 + 2] = g / op; st[o5 + 3] = b / op; }
            st[o5 + 4] = op;
        }
        ATL.n = n; ATL.stats = st; ATL.dirty = true;
    }

    function layerClass(l) {
        if (ATL.names && l < ATL.names.length) {
            const c = nameClass(String(ATL.names[l]));
            if (c) return c;
            const q = ATL.stats; if (q) {
                const o = l * 5, tr = q[o], r = q[o + 1], g = q[o + 2], b = q[o + 3];
                if (q[o + 4] >= 8 && tr >= 0.45 && g > r * 1.10 && g > b * 1.15 && !/(glass|pane|bars|door|trapdoor|ladder|chain|rail|web|sign|banner|bed|frame|redstone|tripwire|vine_)/i.test(String(ATL.names[l]))) return 2;
            }
            return 0;
        }
        const s = ATL.stats, o = l * 5;
        const tr = s[o], r = s[o + 1], g = s[o + 2], b = s[o + 3], op = s[o + 4];
        if (op < 8) return 0;
        if (ATL.anim.has(l)) {
            if (b > r * 1.25 && b >= g * 0.9) return 3;
            if (r > b * 1.3 && r >= g * 0.75) return 4;
            return 0;
        }
        if (tr < 0.02 && r > 200 && g > 150 && r > g * 1.12 && g > b * 1.35) return 4;
        const green = g > r * 1.02 && g > b * 1.05;
        if (green && tr >= 0.03 && tr < 0.45) return 1;
        if (g > r * 1.10 && g > b * 1.15 && tr >= 0.45) return 2;
        return 0;
    }

    const CLS_COUNTS = [0, 0, 0, 0, 0];
    // Re-uploads the class row only when a class actually changed.
    function uploadClasses(gl) {
        ATL.dirty = false;
        const n = ATL.n;
        const W = Math.min(G.maxTex || 4096, Math.max(1024, n));
        let data = G.clsData, changed = G.clsW !== W;
        if (!data || data.length !== W * 4) { data = G.clsData = new Uint8Array(W * 4); changed = true; }
        CLS_COUNTS.fill(0);
        for (let l = 0; l < W; l++) {
            const c = l < n ? layerClass(l) : 0;
            if (l < n) CLS_COUNTS[c]++;
            if (data[l * 4] !== c) { data[l * 4] = c; changed = true; }
        }
        if (!changed) return;
        const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
        gl.activeTexture(gl.TEXTURE7);
        gl.bindTexture(gl.TEXTURE_2D, G.clsTex);
        if (G.clsW === W) gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
        else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, W, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
        gl.activeTexture(prevActive);
        G.clsW = W;
        G.dirty = true; G.dirtyN = true;
        console.info(TAG, 'Layers classified -> leaves:', CLS_COUNTS[1], 'plants:', CLS_COUNTS[2], 'water:', CLS_COUNTS[3], 'emissive:', CLS_COUNTS[4], '(of ' + n + ')');
    }

    // ---------------------------------------------------------------- GL hooks

    const shaderSrc = new WeakMap();
    const progShaders = new WeakMap();
    const progInfo = new WeakMap();
    const PROGS = [];

    let curInfo = null, curVAO = null, frameId = 0, shadowFrame = -1, mainGL = null;
    const lastOrigin = [0, 0, 0];
    let haveOrigin = false;
    const rec = new Map();   // chunk-part VAO -> record (opaque and cutout parts)
    const cols = new Map();  // chunk column -> { p0, p1 } records, to notice parts that became empty

    // Hook errors: log the first few, then stop running our per-draw code so a persistent
    // failure can't flood the console or slow the frame loop.
    const ERR = { n: 0, off: false };
    function hookError(where, e) {
        ERR.n++;
        STATS.errors = ERR.n;
        if (ERR.n <= 3) console.error(TAG, where + ':', e);
        if (ERR.n >= 20 && !ERR.off) {
            ERR.off = true;
            console.error(TAG, 'Too many errors: shader effects are paused until the page is reloaded.');
        }
    }

    // Uniforms pushed to every patched program. Values are computed once per frame into V1/V3, and each
    // program keeps a cache of what it last received, so GL is only called when a value changes.
    // (ambientStrength and sunStrength have no uniform of their own: updateState folds them into uAmb0/uAmb1/uSunC.)
    const U1 = ['uFx', 'uTime', 'uDay', 'uSkyDay', 'uDim', 'uWaveOn', 'uLeafSway', 'uPlantSway', 'uWaveStr',
        'uAoPow', 'uBlockStr', 'uEmissive', 'uExposure', 'uSaturation', 'uContrast',
        'uShadowQ', 'uWaterOn', 'uSkyOn', 'uSunK', 'uGrade'];
    const U3 = ['uSunDir', 'uSunCol', 'uZenith', 'uSkySun', 'uCloudTint', 'uAmb0', 'uAmb1', 'uSunC', 'uSkyGlow', 'uTcLm0'];
    const V1 = new Float64Array(U1.length), V3 = new Float64Array(U3.length * 3);

    // The game's flat varying vGlass: we keep terrain programs free of them (no measured gain from this one). It is 0 or 1
    // and constant over a quad, so a smooth varying keeps it and the game's 0.5 test can't flip. It goes from every
    // source, also those patchSource leaves alone (the stained-glass depth FS, a paged FS), because ESSL 3.00 needs both
    // stages to agree. d.orig stays pristine, so the compile and link fallbacks restore both stages together.
    const FLAT_GLASS = /\bflat\s+(out|in)\s+float\s+vGlass\s*;/g;

    proto.shaderSource = function (shader, source) {
        if (typeof source !== 'string') return O.shaderSource.call(this, shader, source);
        let out = source, info = null;
        try {
            out = source.replace(FLAT_GLASS, '$1 float vGlass;');
            const r = patchSource(out);
            if (r) { out = r.src; info = r.info; }
        } catch (e) {
            console.error(TAG, 'Shader patch error:', e);
        }
        shaderSrc.set(shader, { orig: source, info, patched: out !== source });
        return O.shaderSource.call(this, shader, out);
    };

    proto.compileShader = function (shader) {
        O.compileShader.call(this, shader);
        const d = shaderSrc.get(shader);
        if (d && d.patched && !this.getShaderParameter(shader, this.COMPILE_STATUS)) {
            console.error(TAG, 'Patched shader failed to compile, using the original:\n' + this.getShaderInfoLog(shader));
            O.shaderSource.call(this, shader, d.orig);
            O.compileShader.call(this, shader);
            d.patched = false; d.info = null;
        }
    };

    proto.attachShader = function (p, s) {
        let list = progShaders.get(p);
        if (!list) { list = []; progShaders.set(p, list); }
        list.push(s);
        return O.attachShader.call(this, p, s);
    };

    proto.linkProgram = function (p) {
        O.linkProgram.call(this, p);
        const list = progShaders.get(p) || [];
        if (!list.some(s => shaderSrc.get(s)?.patched)) return;
        if (this.getProgramParameter(p, this.LINK_STATUS)) {
            // only FLAT_GLASS touched it: still the game's program, with nothing of ours to drive
            if (!list.some(s => shaderSrc.get(s)?.info)) return;
            const info = { prog: p, loc: null, mode: 0, lit: false };
            for (const s of list) { const d = shaderSrc.get(s); if (d && d.patched && d.info) Object.assign(info, d.info); }
            info.terrain = !!(info.terrainVS && info.terrainFS);
            // Our terrain VS without our FS (the stained-glass depth pass; every pass on a paged atlas, whose FS we
            // can't patch): uFx stays 0, so no waving without the lighting that goes with it, as offProgram does.
            info.vanilla = !!(info.terrainVS && !info.terrainFS);
            progInfo.set(p, info);
            PROGS.push(info);
            const kind = info.terrain ? 'terrain (mode ' + info.mode + (info.lit ? ', lit' : '') + ')' : info.vanilla ? 'terrain depth or unpatched pass (uFx off)' : info.sky ? 'sky' : info.cloud ? 'clouds' : 'partial';
            console.info(TAG, 'Patched program:', kind);
            return;
        }
        console.error(TAG, 'Patched program failed to link, reverting to the original:\n' + this.getProgramInfoLog(p));
        for (const s of list) {
            const d = shaderSrc.get(s);
            if (d && d.patched) {
                O.shaderSource.call(this, s, d.orig);
                O.compileShader.call(this, s);
                d.patched = false; d.info = null;
            }
        }
        O.linkProgram.call(this, p);
    };

    proto.getUniformLocation = function (p, name) {
        const r = O.getUniformLocation.call(this, p, name);
        if (!r) return r;
        switch (name) {
            case 'uOrigin': locKind.set(r, 1); break;
            case 'uCam': if (O.getUniformLocation.call(this, p, 'uSize')) locKind.set(r, 2); break;
            case 'uTop': locKind.set(r, 3); break;
            case 'uC': locKind.set(r, 4); break;
            case 'uAmbient': locKind.set(r, 5); break;
            case 'uSkyLight': locKind.set(r, 6); break;
        }
        return r;
    };

    proto.uniform3f = function (loc, x, y, z) {
        const k = locKind.get(loc);
        if (k !== undefined) {
            if (k === 1) { lastOrigin[0] = x; lastOrigin[1] = y; lastOrigin[2] = z; haveOrigin = true; }
            else if (k === 2) setCam(x, y, z);
            else if (k === 4) onSprite(x, y, z);
        }
        return O.uniform3f.call(this, loc, x, y, z);
    };

    proto.uniform3fv = function (loc, v, off, len) {
        const k = locKind.get(loc);
        if (k !== undefined && v && v.length >= 3) {
            if (k === 2) setCam(v[0], v[1], v[2]);
            else if (k === 3) { copy3(OBS.top, v); OBS.topFrame = frameId; OBS.sunSeen = false; }
            else if (k === 4) onSprite(v[0], v[1], v[2]);
            else if (k === 6) copy3(OBS.sl, v);
        }
        return off === undefined ? O.uniform3fv.call(this, loc, v) : O.uniform3fv.call(this, loc, v, off, len);
    };

    proto.uniform1f = function (loc, x) {
        if (locKind.get(loc) === 5) OBS.amb = x;
        return O.uniform1f.call(this, loc, x);
    };

    proto.texImage3D = function (target, level, ifmt, w, h, d) {
        try {
            if (target === 0x8C1A && level === 0 && w === 16 && h === 16 && arguments.length >= 10) {
                const px = arguments[9];
                if (px && ArrayBuffer.isView(px)) readAtlas(px, d);
            }
        } catch (e) { console.error(TAG, 'atlas read:', e); }
        return O.texImage3D.apply(this, arguments);
    };
    // Animated layers only matter for the pixel-statistics fallback (no block names). With names, the
    // per-frame animation uploads (water, lava, fire, and the crack overlay's own array) are ignored.
    proto.texSubImage3D = function (target, level, xo, yo, zo) {
        if (target === 0x8C1A && level === 0 && ATL.names === null && !ATL.anim.has(zo)) { ATL.anim.add(zo); ATL.dirty = true; }
        return O.texSubImage3D.apply(this, arguments);
    };

    // curVAO is the main context's binding (the shadow pass puts it back)
    proto.bindVertexArray = function (v) { if (this === mainGL || mainGL === null) curVAO = v; return O.bindVertexArray.call(this, v); };
    proto.deleteVertexArray = function (v) {
        const e = rec.get(v);
        if (e !== undefined) { markDirty(e); forget(e); }
        if (v === curVAO) curVAO = null; // GL unbinds a deleted VAO
        return O.deleteVertexArray.call(this, v);
    };

    // Exact remesh tracking (fixes codemap #51). gfx.setChunk binds a part's VBO while the part's VAO is bound
    // when it creates the part, and re-uploads that VBO with bufferData(ARRAY_BUFFER, data) on every remesh,
    // drawn or not. A recorded part gets its new index count right away (as gfx.js computes it: bytes / 32
    // quads x 6, capped by the shared index buffer), and the shadow map is marked dirty if the part is in it.
    const vboVao = new WeakMap();
    let curABuf = null, iboMax = 0, remeshCount = 0;
    proto.bindBuffer = function (target, buf) {
        if (target === 0x8892 && (this === mainGL || mainGL === null)) {
            curABuf = buf;
            // first bind wins: a remesh rebinds the VBO under whatever VAO is bound (normally none)
            if (curVAO !== null && buf != null && typeof buf === 'object' && !vboVao.has(buf)) vboVao.set(buf, curVAO);
        }
        return O.bindBuffer.call(this, target, buf);
    };
    proto.bufferData = function (target, data) {
        if (this === mainGL || mainGL === null) {
            try {
                if (target === 0x8892) {
                    if (curABuf !== null) {
                        const vao = vboVao.get(curABuf);
                        const e = vao === undefined ? undefined : rec.get(vao);
                        if (e !== undefined) remeshed(e, data);
                    }
                } else if (target === 0x8893 && data && data.byteLength > iboMax * 4) iboMax = data.byteLength >> 2;
            } catch (err) { hookError('bufferData', err); }
        }
        return O.bufferData.apply(this, arguments);
    };
    function remeshed(e, data) {
        const bytes = typeof data === 'number' ? data : (data && data.byteLength) || 0;
        let n = Math.floor(bytes / 32) * 6;
        if (iboMax > 0 && n > iboMax) n = iboMax - iboMax % 6;
        e.n = n; remeshCount++;
        markDirty(e);
    }

    // A frame starts with the colour clear. Only the main canvas counts (the dragon view has its own context).
    proto.clear = function (mask) {
        if ((mask & 0x4000) && (mainGL === null || this === mainGL)) frameId++;
        return O.clear.call(this, mask);
    };

    // Shadow cascades share one depth atlas on unit 6 (texW x texH): the near tile (up to 2048, +-(24 + shadowMove)
    // blocks around the camera at its last redraw) at x = 0, the far tile (shadowSize, +-shadowExtent) at
    // x = G.farX. Both use the far tile's light basis (the sun direction at its last redraw), each with its own
    // centre and texel snapping: the near tile alone is redrawn for moves and nearby chunk changes; a far redraw
    // (sun turns, chunk changes, large moves, a 10 s safety net) redraws both. Without cascades (short range,
    // or shadowCascades false) the far tile is the whole atlas.
    const cascade = (E, size) => ({
        valid: false, drawn: true, frame: -999, ms: 0, c0: [0, 0, 0], L: [0, 1, 0], R: [1, 0, 0], U: [0, 0, 1],
        dx: 0, dy: 0, hx: 0, hy: 0, E, Z: DEFAULTS.shadowDepth, size, cull: true, refresh: false, why: 0,
        d0: [0, 0, 0] // stress({ moveSpeed }) drift at its last redraw (0 without it)
    });
    const G = {
        init: false, clsTex: null, clsData: null, clsW: 0, maxTex: 0,
        shadowOk: false, fbo: null, depthTex: null, texSize: 0, texW: 0, texH: 0, farX: 0, checkFbo: false, allocFailed: 0,
        pOpaque: null, pCut: null, pCutSolid: null, dirty: true, dirtyN: true, nSize: -1, lastRef: -999, nearNext: 0,
        sh: cascade(DEFAULTS.shadowExtent, DEFAULTS.shadowSize), // the far (full-range) tile: Twitterentary.shadow
        nr: cascade(28, 2048)                                     // the near tile
    };
    G.sh.near = G.nr;

    const LM_D = [0, 0, 0];
    // Light-space matrix of cascade C relative to `at`, from the basis and extent snapshotted at its last refresh.
    function lightMat(m, at, C) {
        const E = C.E, Zd = C.Z, R = C.R, U = C.U, L = C.L, d = LM_D;
        d[0] = at[0] - C.c0[0]; d[1] = at[1] - C.c0[1]; d[2] = at[2] - C.c0[2];
        m[0] = R[0] / E; m[1] = U[0] / E; m[2] = -L[0] / Zd; m[3] = 0;
        m[4] = R[1] / E; m[5] = U[1] / E; m[6] = -L[1] / Zd; m[7] = 0;
        m[8] = R[2] / E; m[9] = U[2] / E; m[10] = -L[2] / Zd; m[11] = 0;
        m[12] = (dot(d, R) + C.dx) / E; m[13] = (dot(d, U) + C.dy) / E; m[14] = -dot(d, L) / Zd; m[15] = 1;
        return m;
    }

    const SUN_LOW = [1.0, 0.60, 0.36], SUN_NOON = [1.0, 0.97, 0.92];
    const WHITE = [1, 1, 1], CLOUD_TW = [1.0, 0.68, 0.50];
    const ST = {
        frame: -1, camFrame: -1, ms: 0, time: 0, cam: [0, 0, 0], sun: FIXED_SUN, sunL: FIXED_SUN.slice(), sunCol: [1, 1, 1],
        zenith: OBS.top, cloud: [1, 1, 1], day: 1, dim: 0, shadowOn: 0, refresh: false, why: 0,
        lvp: new Float32Array(16), shn: new Float64Array(4), shp: new Float64Array(4), shb: new Float64Array(4)
    };
    const WHY = ['', 'init', 'dirty', 'move', 'sun', 'age', 'stress'];
    const STATS = {
        shadowChunks: 0, refreshes: 0, tiles: { near: 0, far: 0, nearChunks: 0, farChunks: 0 }, why: { init: 0, dirty: 0, move: 0, sun: 0, age: 0, stress: 0 }, errors: 0
    };
    // Twitterentary.stress() for benchmarks (in memory only): forced shadow refreshes (shadowRefreshEvery), and an
    // emulated camera drift of moveSpeed blocks/s that only the shadow redraw decision sees (drift, drifted =
    // blocks so far, lastMs = the frame it last advanced)
    const STRESS = { shadowRefreshEvery: 0, forced: 0, moveSpeed: 0, drift: [0, 0, 0], drifted: 0, lastMs: -1 };
    const SCRATCH = new Float32Array(16);
    const isEnd = sl => Math.abs(sl[0] - 0.055) < 0.004 && Math.abs(sl[1] - 0.07) < 0.004 && Math.abs(sl[2] - 0.0625) < 0.004;
    const num = x => +x || 0;

    function updateState() {
        if (ST.frame === frameId) return;
        ST.frame = frameId;
        ST.ms = performance.now(); ST.time = ST.ms / 1000;
        copy3(ST.cam, CAMLAST);

        let dim = 0;
        if (OBS.lit) { if (OBS.amb > 0.05) dim = 1; else if (isEnd(OBS.sl)) dim = 2; }
        ST.dim = dim;

        const day = dim ? 0 : clamp01(OBS.top[2]);
        const sun = dim ? FIXED_SUN : OBS.sun;
        ST.sun = sun; ST.day = day;
        normInto(ST.sunL, sun[0], Math.max(sun[1], 0.14), sun[2]);

        const h = sun[1];
        mixInto(ST.sunCol, SUN_LOW, SUN_NOON, sstep(0, 0.35, h));
        mixInto(ST.cloud, WHITE, CLOUD_TW, (1 - sstep(0.02, 0.45, h)) * day);
        ST.zenith = OBS.top;

        const v = V1;
        v[0] = CFG.enabled ? 1 : 0; v[1] = ST.time; v[2] = day; v[3] = day; v[4] = dim;
        v[5] = CFG.waving ? 1 : 0; v[6] = num(CFG.leafSway); v[7] = num(CFG.plantSway); v[8] = num(CFG.waveStrength);
        v[9] = num(CFG.aoPower); v[10] = num(CFG.blockLight);
        v[11] = num(CFG.emissive); v[12] = num(CFG.exposure); v[13] = num(CFG.saturation); v[14] = num(CFG.contrast);
        v[15] = num(CFG.shadowFilter); v[16] = CFG.waterEffects ? 1 : 0; v[17] = CFG.skyEffects ? 1 : 0;
        // uniform-only parts of the terrain shading, once per frame instead of per pixel
        const sunK = dim ? 0 : day * sstep(0, 0.15, sun[1]);
        v[18] = sunK;
        v[19] = Math.abs(num(CFG.saturation) - 1) > 1e-4 || Math.abs(num(CFG.contrast) - 1) > 1e-4 ? 1 : 0;
        ambientEnds(dim, day, num(CFG.ambientStrength));
        const sk = sunK * num(CFG.sunStrength), sc = ST.sunCol;
        put3(0, ST.sunL); put3(1, ST.sunCol); put3(2, ST.zenith); put3(3, ST.sun); put3(4, ST.cloud);
        put3(5, AMB0); put3(6, AMB1);
        V3[21] = sc[0] * sk; V3[22] = sc[1] * sk; V3[23] = sc[2] * sk;
        // sky: sun glow colour (low sun orange, high sun pale) x its visibility around the horizon
        const gk = sstep(0, 0.4, h), gv = sstep(-0.25, 0.08, h);
        V3[24] = gv; V3[25] = (0.50 + 0.40 * gk) * gv; V3[26] = (0.22 + 0.50 * gk) * gv;
        // the zero point of the game's block-light curve, from its own sky light and ambient (observed last frame)
        tcLm0(num(OBS.amb), OBS.sl);
    }
    // uTcLm0 (V3[27..29]) = the game's lightmap(vec2(0.0)) (gfx.js; compat LIGHTMAP), which the lit FS subtracts
    // from lightmap(vec2(0.0, vLight.y)) for the engine's block-light term
    function tcLm0(a, sl) {
        const b = a * 1.5;
        for (let i = 0; i < 3; i++) {
            const x = (i === 0 ? b : i === 1 ? b * ((b * 0.6 + 0.4) * 0.6 + 0.4) : b * (b * b * 0.6 + 0.4)) + num(sl[i]) * a;
            const c = clamp01(x + (0.75 - x) * 0.04), e = 1 - c, m = c + (1 - e * e * e * e - c) * 0.5;
            V3[27 + i] = clamp01(m + (0.75 - m) * 0.04);
        }
    }
    function put3(i, a) { V3[i * 3] = a[0]; V3[i * 3 + 1] = a[1]; V3[i * 3 + 2] = a[2]; }

    // Hemisphere ambient endpoints (normal straight down = AMB0, up = AMB1): day with its twilight tint,
    // mixed with night by `day`, or the flat Nether/End colours; times the ambient strength.
    const AMB0 = [0, 0, 0], AMB1 = [0, 0, 0];
    const AMB_DAY0 = [0.48, 0.45, 0.40], AMB_DAY1 = [0.48, 0.53, 0.60], AMB_TW = [1.25, 0.95, 0.80];
    const AMB_NIGHT0 = [0.11, 0.12, 0.16], AMB_NIGHT1 = [0.17, 0.21, 0.31];
    const AMB_END0 = [0.10, 0.08, 0.13], AMB_END1 = [0.16, 0.13, 0.19];
    const AMB_NETHER0 = [0.24, 0.10, 0.07], AMB_NETHER1 = [0.34, 0.16, 0.10];
    function ambientEnds(dim, day, str) {
        if (dim === 2 || dim === 1) {
            const a = dim === 2 ? AMB_END0 : AMB_NETHER0, b = dim === 2 ? AMB_END1 : AMB_NETHER1;
            for (let i = 0; i < 3; i++) { AMB0[i] = a[i] * str; AMB1[i] = b[i] * str; }
            return;
        }
        const tw = day * (1 - day) * 4 * 0.35;
        for (let i = 0; i < 3; i++) {
            const t = 1 + (AMB_TW[i] - 1) * tw;
            AMB0[i] = (AMB_NIGHT0[i] + (AMB_DAY0[i] * t - AMB_NIGHT0[i]) * day) * str;
            AMB1[i] = (AMB_NIGHT1[i] + (AMB_DAY1[i] * t - AMB_NIGHT1[i]) * day) * str;
        }
    }

    function shadowTargetSize() {
        return Math.min(G.maxTex || 4096, Math.round(cfgNum('shadowSize')));
    }

    const NEAR_R = 24;                // blocks around the camera the near tile always covers
    const NEAR_SPARE = 8;             // ... plus at least this margin: it is redrawn after the camera moved that far
    const NEAR_MAX = 2048;            // near tile resolution cap
    const COS_SUN = 0.9999905;        // a ~0.25 deg sun turn redraws the shadows (1.4.0: 0.17 deg)
    const SHADOW_AGE_MS = 10000;      // safety net (chunk changes are tracked exactly, see bufferData)

    // Decides which shadow tile is redrawn this frame: only when something changed, and at most one tile redraw
    // per `shadowEvery` frames (the first map, stress() and the near half of a far redraw skip the wait). Far
    // tile (it sets the light basis both tiles share): the sun turned ~0.25 deg (COS_SUN), chunks in its range
    // changed, a shadow setting changed (snapshot of the last redraw), the camera moved half its spare range,
    // or 10 s passed; the near tile follows on the next frame only when the light basis changed (the sun turned, a
    // shadow setting changed, the first map, stress()): other far redraws keep the basis, so the near tile stays
    // valid. Near tile alone: chunks close by changed, or the camera moved max(`shadowMove`, NEAR_SPARE) blocks
    // (its spare margin; redrawing it more often changes nothing on screen). `canDraw` is false when the frame's first terrain draw is translucent
    // (no opaque or cutout parts in view): nothing can be redrawn then, so the old tiles are kept, or shadows
    // skip this frame.
    function finalizeShadow(gl, canDraw) {
        const SH = G.sh, NR = G.nr, cam = ST.cam, size = shadowTargetSize();
        // stress({ moveSpeed }): the emulated walk advances once a frame (a hitch counts at most 1 s)
        if (STRESS.moveSpeed > 0) {
            const t = ST.ms, D = STRESS.drift;
            const step = STRESS.lastMs >= 0 ? STRESS.moveSpeed * Math.min(1000, Math.max(0, t - STRESS.lastMs)) / 1000 : 0;
            D[0] += 0.6 * step; D[2] += 0.8 * step; STRESS.drifted += step; STRESS.lastMs = t;
        }
        const on = CFG.enabled && CFG.shadows && G.shadowOk && G.allocFailed !== size &&
            ST.dim === 0 && ST.sun[1] > 0.06 && ST.day > 0.1;
        ST.shadowOn = on ? 1 : 0;
        ST.refresh = false; SH.refresh = false; NR.refresh = false;
        if (!on) {
            SH.valid = false; NR.valid = false;
            // switched off (Quality: Low, or K): give the atlas's memory back, once. Night and the
            // Nether/End keep it, so the map isn't reallocated every dusk.
            if ((!CFG.enabled || !CFG.shadows) && G.texSize > 1 && G.depthTex) {
                try { resizeShadow(gl, 1, 1); } catch (e) { G.texSize = 1; }
            }
            return;
        }
        if (SH.valid && !SH.drawn) SH.valid = false;
        if (NR.valid && !NR.drawn) NR.valid = false;
        if (!canDraw && !SH.valid) { ST.shadowOn = 0; return; }
        const L = ST.sunL, E = cfgNum('shadowExtent'), Zd = cfgNum('shadowDepth'), cull = CFG.shadowCull !== false;
        const move = cfgNum('shadowMove'), every = cfgNum('shadowEvery'), nMove = Math.max(move, NEAR_SPARE), En = NEAR_R + nMove;
        let nSize = Math.min(size, NEAR_MAX);
        if (nSize + size > (G.maxTex || 4096)) nSize = Math.min(nSize, (G.maxTex || 4096) - size);
        // two tiles only for long ranges (High, Ultra): the near tile costs ~1-1.8 ms a frame (bench A/B), worth it only
        // where a single map would make close shadows blurry
        const useNear = CFG.shadowCascades !== false && E >= 64 && E >= En * 1.5 && nSize >= 512;
        if (!useNear) nSize = 0;
        if (canDraw) {
            // At most one tile redraw per `shadowEvery` frames (only the first map, the near half of a far redraw and
            // stress() skip the wait). Both tiles share the far tile's light basis, so a far redraw (new sun direction)
            // is followed by the near tile on the next frame; the near tile alone is redrawn for moves and nearby changes.
            const n = STRESS.shadowRefreshEvery, due = frameId - G.lastRef >= every;
            const layout = SH.size !== size || SH.E !== E || SH.Z !== Zd || SH.cull !== cull || G.nSize !== nSize ||
                (useNear && NR.E !== En);
            let wf = 0, wn = 0;
            // the near half of a far redraw: the frame after it, so no frame pays for both tiles (the near tile
            // is off for that one frame: it must be redrawn in the far tile's new light basis)
            if (useNear && G.nearNext && frameId !== G.lastRef && SH.valid) { wn = G.nearNext; G.nearNext = 0; }
            else if (!SH.valid) wf = 1;
            else if (n > 0 && frameId - SH.frame >= (useNear ? Math.max(60, n * 15) : n)) wf = 6;
            else if (due) {
                if (layout) wf = 2;
                else if (useNear && !NR.valid) wn = 1;
                else if (useNear && G.dirtyN) wn = 2;
                else if (useNear && camDist(cam, NR) > nMove) wn = 3;
                else if (G.dirty) wf = 2;
                else if (camDist(cam, SH) > (useNear ? Math.max(move, (E - En) / 2) : move)) wf = 3;
                else if (dot(L, SH.L) < COS_SUN) wf = 4;
                else if (ST.ms - SH.ms > SHADOW_AGE_MS) wf = 5;
            }
            if (!wf && !wn && useNear && NR.valid && n > 0 && frameId - NR.frame >= n) wn = 6;
            if (wf) {
                // a far redraw for chunk changes, moves or age keeps the light basis while the sun has turned less
                // than COS_SUN, so a valid near tile stays valid (no near redraw, no frame without it)
                const keep = (wf === 2 && !layout || wf === 3 || wf === 5) && useNear && NR.valid && dot(L, SH.L) >= COS_SUN;
                snapCascade(SH, keep ? SH.L : L, cam, E, Zd, size, cull, wf);
                G.dirty = false; G.nSize = nSize; G.farX = nSize; G.lastRef = frameId;
                if (!keep) { NR.valid = false; G.nearNext = useNear ? wf : 0; G.dirtyN = false; }
                // the 10 s age net covers the near tile too: redrawn next frame in the kept basis (it stays on meanwhile)
                else if (wf === 5) G.nearNext = 5;
            }
            if (wn) { snapCascade(NR, SH.L, cam, En, Zd, nSize, cull, wn); G.dirtyN = false; G.lastRef = frameId; }
            if (wf === 6 || wn === 6) STRESS.forced++;
            ST.refresh = !!(wf || wn); ST.why = wf || wn;
        }
        lightMat(ST.lvp, cam, SH);
        const nearOn = useNear && NR.valid && G.nSize === nSize && NR.size === G.nSize && NR.Z === SH.Z &&
            NR.L[0] === SH.L[0] && NR.L[1] === SH.L[1] && NR.L[2] === SH.L[2];
        // From the tiles' snapshots. uShadowP = (near tile size, far tile size, 1 / atlas size); uShadowB = (near
        // texel, far texel in blocks, depth range, near radius: 0 = far tile only). With the shared light basis
        // the near tile's coordinates are the far tile's scaled and offset: near = far.xy * k + o.xy, z + o.z,
        // uShadowN = (k, o) (see lightMat: x = (dot(p - c0, R) + dx) / E, then * 0.5 + 0.5).
        const ns = Math.max(0, G.nSize), W = ns + SH.size;
        ST.shp[0] = ns; ST.shp[1] = SH.size; ST.shp[2] = 1 / W; ST.shp[3] = 1 / SH.size;
        ST.shb[0] = nearOn ? 2 * NR.E / NR.size : 0; ST.shb[1] = 2 * SH.E / SH.size; ST.shb[2] = SH.Z;
        ST.shb[3] = nearOn ? NEAR_R * 1.25 : 0;
        if (nearOn) {
            const k = SH.E / NR.E, d = LM_D;
            d[0] = SH.c0[0] - NR.c0[0]; d[1] = SH.c0[1] - NR.c0[1]; d[2] = SH.c0[2] - NR.c0[2];
            ST.shn[0] = k;
            ST.shn[1] = 0.5 - 0.5 * k + 0.5 * (dot(d, SH.R) - SH.dx + NR.dx) / NR.E;
            ST.shn[2] = 0.5 - 0.5 * k + 0.5 * (dot(d, SH.U) - SH.dy + NR.dy) / NR.E;
            ST.shn[3] = -0.5 * dot(d, SH.L) / SH.Z;
        }
    }
    // How far the camera is from tile C's centre at its last redraw, plus the stress({ moveSpeed }) drift since then
    // (zero without it). Only the redraw decision uses the drift: the tiles stay centred on the real camera.
    function camDist(cam, C) {
        const c0 = C.c0, d0 = C.d0, D = STRESS.drift;
        return Math.hypot(cam[0] - c0[0] + (D[0] - d0[0]), cam[1] - c0[1] + (D[1] - d0[1]), cam[2] - c0[2] + (D[2] - d0[2]));
    }

    function snapCascade(C, L, cam, E, Zd, size, cull, why) {
        C.refresh = true; C.why = why;
        copy3(C.L, L); copy3(C.d0, STRESS.drift);
        const R = normInto(C.R, L[1], -L[0], 0), U = C.U; // R = L x +Z, U = L x R
        U[0] = L[1] * R[2] - L[2] * R[1]; U[1] = L[2] * R[0] - L[0] * R[2]; U[2] = L[0] * R[1] - L[1] * R[0];
        copy3(C.c0, cam);
        C.E = E; C.Z = Zd; C.size = size; C.cull = cull;
        const texel = 2 * E / size, cr = dot(cam, R), cu = dot(cam, U);
        C.dx = cr - Math.floor(cr / texel) * texel;
        C.dy = cu - Math.floor(cu / texel) * texel;
        C.hx = 8 * Math.abs(R[0]) + 64 * Math.abs(R[1]) + 8 * Math.abs(R[2]);
        C.hy = 8 * Math.abs(U[0]) + 64 * Math.abs(U[1]) + 8 * Math.abs(U[2]);
        C.frame = frameId; C.ms = ST.ms; C.valid = true; C.drawn = false;
    }

    // Is this chunk part inside the area tile C covers (the far, full-range tile by default)?
    function inFootprint(e, C) {
        const SH = C || G.sh;
        if (!SH.valid) return true;
        const cx = e.wx + 8 - SH.c0[0], cy = e.wy + 64 - SH.c0[1], cz = e.wz + 8 - SH.c0[2];
        const R = SH.R, U = SH.U;
        const sx = R[0] * cx + R[1] * cy + R[2] * cz + SH.dx;
        const sy = U[0] * cx + U[1] * cy + U[2] * cz + SH.dy;
        return Math.abs(sx) <= SH.E + SH.hx && Math.abs(sy) <= SH.E + SH.hy;
    }
    // A caster changed: redraw the tiles it is in.
    function markDirty(e) {
        if (!G.dirty && inFootprint(e, G.sh)) G.dirty = true;
        if (!G.dirtyN && inFootprint(e, G.nr)) G.dirtyN = true;
    }

    function forget(e) {
        rec.delete(e.vao);
        const col = e.col;
        if (col) {
            if (col.p0 === e) col.p0 = null;
            if (col.p1 === e) col.p1 = null;
            if (col.p0 === null && col.p1 === null) cols.delete(col.key);
        }
    }

    function makeProg(gl, vs, fs) {
        const mk = (type, src) => {
            const s = gl.createShader(type);
            O.shaderSource.call(gl, s, src);
            O.compileShader.call(gl, s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
            return s;
        };
        const p = gl.createProgram();
        O.attachShader.call(gl, p, mk(gl.VERTEX_SHADER, vs));
        O.attachShader.call(gl, p, mk(gl.FRAGMENT_SHADER, fs));
        O.linkProgram.call(gl, p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
        return p;
    }

    // Opaque chunk parts: depth only, no fragment work, so early-Z works.
    const SHADOW_VS_OPAQUE = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uvec3 aPos;
uniform mat4 uLVP;
uniform vec3 uOrigin;
void main() {
  vec3 p = vec3(aPos & uvec3(0x1FFu, 0xFFFu, 0x1FFu)) * 0.0625 + uOrigin;
  gl_Position = uLVP * vec4(p, 1.0);
}`;
    const SHADOW_FS_OPAQUE = `#version 300 es
precision mediump float;
void main() {}`;
    // Cutout parts: alpha-tested against the atlas; plants (class 2) don't cast shadows. Far tile: of the cutout part
    // only leaves cast, as solid quads (no alpha test, so early depth works).
    // `skip` = the classes that don't cast; a function, because layerDecl() is only known once the game's VS was seen.
    const shadowVS = skip => `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uvec3 aPos;
layout(location=1) in uvec2 aInfo;
uniform mat4 uLVP;
uniform vec3 uOrigin;
uniform highp sampler2D uClsTex;
out vec3 vUV;
void main() {
  ${layerDecl()}
  float c = floor(texelFetch(uClsTex, ivec2(tcLayer, 0), 0).r * 255.0 + 0.5);
  vUV = vec3(float(aInfo.y & 1u), float((aInfo.y >> 1u) & 1u), float(tcLayer));
  if (${skip}) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 p = vec3(aPos & uvec3(0x1FFu, 0xFFFu, 0x1FFu)) * 0.0625 + uOrigin;
  gl_Position = uLVP * vec4(p, 1.0);
}`;
    const SHADOW_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uTex;
in vec3 vUV;
void main() {
  if (textureLod(uTex, vUV, 0.0).a < 0.5) discard;
}`;

    function shadowProg(gl, vs, fs) {
        const prog = makeProg(gl, vs, fs);
        const g = n => O.getUniformLocation.call(gl, prog, n);
        const P = { prog, lvp: g('uLVP'), origin: g('uOrigin') };
        O.useProgram.call(gl, prog);
        const cls = g('uClsTex'), tex = g('uTex');
        if (cls) O.uniform1i.call(gl, cls, 7);
        if (tex) O.uniform1i.call(gl, tex, 0);
        return P;
    }

    // Runs once, on the game's first use of a patched program (during setup, outside the frame loop).
    // The shadow map starts as a 1x1 texture so unit 6 always holds a valid shadow sampler; it is
    // resized at the first refresh, and again whenever the resolution setting changes.
    function initGL(gl) {
        if (G.init) return;
        G.init = true;
        mainGL = gl;
        const prevActive = gl.getParameter(gl.ACTIVE_TEXTURE);
        const prevProg = gl.getParameter(gl.CURRENT_PROGRAM);
        try {
            G.maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;
            gl.activeTexture(gl.TEXTURE7);
            G.clsTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, G.clsTex);
            G.clsData = new Uint8Array(1024 * 4); G.clsW = 1024;
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1024, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, G.clsData);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

            gl.activeTexture(gl.TEXTURE6);
            G.depthTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, G.depthTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, 1, 1, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
            G.texSize = 1;
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);

            const prevFB = gl.getParameter(gl.FRAMEBUFFER_BINDING);
            G.fbo = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, G.fbo);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, G.depthTex, 0);
            gl.drawBuffers([gl.NONE]);
            gl.readBuffer(gl.NONE);
            const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
            gl.bindFramebuffer(gl.FRAMEBUFFER, prevFB);
            if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Shadow framebuffer incomplete: ' + status);

            G.pOpaque = shadowProg(gl, SHADOW_VS_OPAQUE, SHADOW_FS_OPAQUE);
            G.pCut = shadowProg(gl, shadowVS('c > 1.5 && c < 3.5'), SHADOW_FS);
            G.pCutSolid = shadowProg(gl, shadowVS('c < 0.5 || c > 1.5'), SHADOW_FS_OPAQUE); // far tile: leaves only, no alpha test
            G.shadowOk = true;
        } catch (e) {
            console.error(TAG, 'Could not initialize shadows:', e);
            G.shadowOk = false;
        } finally {
            O.useProgram.call(gl, prevProg);
            gl.activeTexture(prevActive);
        }
        initTimer(gl);
    }

    function resolveLocs(gl, info) {
        const g = n => O.getUniformLocation.call(gl, info.prog, n);
        const L = {
            l1: U1.map(g), l3: U3.map(g), cam: g('uCam'), lvp: g('uLVP'), shn: g('uShadowN'),
            shp: g('uShadowP'), shb: g('uShadowB'), son: g('uShadowOn')
        };
        const sm = g('uShadowMap'), ct = g('uClsTex');
        if (sm) O.uniform1i.call(gl, sm, 6);
        if (ct) O.uniform1i.call(gl, ct, 7);
        info.c1 = new Float64Array(U1.length).fill(NaN);
        info.c3 = new Float64Array(U3.length * 3).fill(NaN);
        info.cc = new Float64Array(3).fill(NaN);
        info.cshp = new Float64Array(4).fill(NaN);
        info.cshb = new Float64Array(4).fill(NaN);
        info.clvp = new Float32Array(16).fill(NaN);
        info.cshn = new Float64Array(4).fill(NaN);
        info.cson = NaN;
        info.loc = L;
        return L;
    }

    function applyUniforms(gl, info) {
        // locations and sampler units first: if anything below throws on a program's first use, its
        // samplers must already be on units 6/7, not on unit 0 next to the atlas's sampler2DArray
        const L = info.loc || resolveLocs(gl, info);
        updateState();
        if (ATL.dirty && G.clsTex && ATL.stats) {
            try { uploadClasses(gl); } catch (e) { ATL.dirty = false; hookError('uploadClasses', e); }
        }
        const l1 = L.l1, c1 = info.c1;
        for (let i = 0; i < l1.length; i++) {
            const loc = l1[i];
            if (loc !== null && c1[i] !== V1[i]) { c1[i] = V1[i]; O.uniform1f.call(gl, loc, V1[i]); }
        }
        const l3 = L.l3, c3 = info.c3;
        for (let i = 0; i < l3.length; i++) {
            const loc = l3[i];
            if (loc === null) continue;
            const j = i * 3;
            if (c3[j] !== V3[j] || c3[j + 1] !== V3[j + 1] || c3[j + 2] !== V3[j + 2]) {
                c3[j] = V3[j]; c3[j + 1] = V3[j + 1]; c3[j + 2] = V3[j + 2];
                O.uniform3f.call(gl, loc, V3[j], V3[j + 1], V3[j + 2]);
            }
        }
        // the camera, light matrix and shadow state are final only after the frame's first terrain draw
        if (ST.camFrame === frameId) pushCam(gl, info);
    }

    function pushCam(gl, info) {
        const L = info.loc;
        if (!L) return;
        const c = ST.cam, cc = info.cc;
        if (L.cam !== null && (cc[0] !== c[0] || cc[1] !== c[1] || cc[2] !== c[2])) {
            cc[0] = c[0]; cc[1] = c[1]; cc[2] = c[2];
            O.uniform3f.call(gl, L.cam, c[0], c[1], c[2]);
        }
        if (L.son !== null && info.cson !== ST.shadowOn) { info.cson = ST.shadowOn; O.uniform1f.call(gl, L.son, ST.shadowOn); }
        if (!ST.shadowOn) return;
        if (L.lvp !== null) pushMat(gl, L.lvp, ST.lvp, info.clvp);
        if (L.shn !== null && ST.shb[3] > 0) push4(gl, L.shn, ST.shn, info.cshn);
        if (L.shp !== null) push4(gl, L.shp, ST.shp, info.cshp);
        if (L.shb !== null) push4(gl, L.shb, ST.shb, info.cshb);
    }
    function pushMat(gl, loc, m, k) {
        for (let i = 0; i < 16; i++) {
            if (k[i] !== m[i]) { k.set(m); O.uniformMatrix4fv.call(gl, loc, false, m); return; }
        }
    }
    function push4(gl, loc, v, k) {
        if (k[0] !== v[0] || k[1] !== v[1] || k[2] !== v[2] || k[3] !== v[3]) {
            k[0] = v[0]; k[1] = v[1]; k[2] = v[2]; k[3] = v[3];
            O.uniform4f.call(gl, loc, v[0], v[1], v[2], v[3]);
        }
    }

    // Effects paused, or a program with no patched FS: vanilla output (uFx = 0), with our samplers still on their own units so a program
    // first used now can't put a sampler2D next to the atlas's sampler2DArray on unit 0.
    function offProgram(gl, info) {
        if (info.offDone) return;
        info.offDone = true;
        try {
            const g = n => O.getUniformLocation.call(gl, info.prog, n);
            const fx = g('uFx'), sm = g('uShadowMap'), ct = g('uClsTex');
            if (fx) O.uniform1f.call(gl, fx, 0);
            if (sm) O.uniform1i.call(gl, sm, 6);
            if (ct) O.uniform1i.call(gl, ct, 7);
        } catch (e) {}
    }

    proto.useProgram = function (p) {
        const gl = this;
        const info = p ? (progInfo.get(p) || null) : null;
        if (info !== null && !G.init) initGL(gl);
        O.useProgram.call(gl, p);
        curInfo = info;
        if (info === null) return;
        if (ERR.off || info.vanilla) { offProgram(gl, info); return; }
        if (info.terrain) OBS.lit = !!info.lit;
        try { applyUniforms(gl, info); } catch (e) { hookError('applyUniforms', e); }
    };

    // (Re)allocates the shadow atlas. texSize stays the far tile's size (debug().shadowMap).
    function resizeShadow(gl, w, h) {
        const prev = gl.getParameter(gl.ACTIVE_TEXTURE);
        try {
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, G.depthTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, w, h, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        } finally {
            gl.activeTexture(prev);
        }
        G.texSize = h; G.texW = w; G.texH = h; G.checkFbo = true;
    }

    function drawShadowSet(gl, P, cut, now, C) {
        const c0 = C.c0, far = C === G.sh;
        let n = 0, bound = false;
        for (const e of rec.values()) {
            if (e.cut !== cut) continue;
            // Casters out of view (behind the camera) still cast, however long ago they were drawn: the
            // game deletes a dropped chunk's VAO and trackColumn drops emptied parts, so expiry only
            // forgets records outside the full map's area (a leak guard).
            if (!inFootprint(e, C)) { if (far && now - e.seen > 60000) forget(e); continue; }
            if (e.n === 0) continue;
            if (!bound) { O.useProgram.call(gl, P.prog); O.uniformMatrix4fv.call(gl, P.lvp, false, SCRATCH); bound = true; }
            O.uniform3f.call(gl, P.origin, e.wx - c0[0], e.wy - c0[1], e.wz - c0[2]);
            O.bindVertexArray.call(gl, e.vao);
            O.drawElements.call(gl, gl.TRIANGLES, e.n, gl.UNSIGNED_INT, 0);
            n++;
        }
        return n;
    }

    // Called from the frame's first opaque or cutout terrain draw. gfx.js has just set depthFunc(LEQUAL),
    // depthMask(true), CULL_FACE on and blending off for these passes, so those aren't queried (the depth
    // queries are round trips to the GPU process); they are put back to exactly that state afterwards.
    function renderShadow(gl, info) {
        if (!G.shadowOk || !ST.shadowOn || !ST.refresh) return;
        const SH = G.sh, NR = G.nr, size = SH.size, W = Math.max(0, G.nSize) + size;
        // the viewport the frame is drawing with: tracked by the viewport hook, so no getParameter round trip
        // (the game binds no framebuffer of its own, so null is what goes back)
        if (VP.w === 0) { const v = gl.getParameter(gl.VIEWPORT); VP.x = v[0]; VP.y = v[1]; VP.w = v[2]; VP.h = v[3]; }
        const vx = VP.x, vy = VP.y, vw = VP.w, vh = VP.h;
        const wasCull = gl.isEnabled(gl.CULL_FACE), wasDepth = gl.isEnabled(gl.DEPTH_TEST);
        const wasPO = gl.isEnabled(gl.POLYGON_OFFSET_FILL), wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
        const prevVAO = curVAO;
        try {
            if (G.texW !== W || G.texH !== size) {
                try { resizeShadow(gl, W, size); } catch (e) { G.allocFailed = size; throw e; }
            }
            O.bindFramebuffer.call(gl, gl.DRAW_FRAMEBUFFER, G.fbo);
            if (G.checkFbo) {
                G.checkFbo = false;
                const st = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
                if (st !== gl.FRAMEBUFFER_COMPLETE) { G.allocFailed = size; throw new Error('shadow framebuffer incomplete at ' + W + 'x' + size + ': ' + st); }
            }
            // each tile is cleared and drawn inside its own scissor rectangle (the game never uses scissor)
            if (!wasScissor) gl.enable(gl.SCISSOR_TEST);
            if (!wasDepth) gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
            gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 1.0);
            const now = ST.ms;
            if (SH.refresh) drawTile(gl, SH, G.farX, now);
            if (NR.refresh && G.nSize > 0) drawTile(gl, NR, 0, now);
        } finally {
            O.useProgram.call(gl, info.prog);
            O.bindVertexArray.call(gl, prevVAO);
            O.bindFramebuffer.call(gl, gl.DRAW_FRAMEBUFFER, null);
            O.viewport.call(gl, vx, vy, vw, vh);
            gl.polygonOffset(0, 0);
            if (!wasPO) gl.disable(gl.POLYGON_OFFSET_FILL);
            if (wasCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
            if (!wasDepth) gl.disable(gl.DEPTH_TEST);
            if (!wasScissor) gl.disable(gl.SCISSOR_TEST);
            gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        }
    }
    function drawTile(gl, C, x, now) {
        O.viewport.call(gl, x, 0, C.size, C.size);
        gl.scissor(x, 0, C.size, C.size);
        if (C.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
        O.clear.call(gl, gl.DEPTH_BUFFER_BIT);
        lightMat(SCRATCH, C.c0, C);
        // far tile: of the cutout casters only leaves, as solid quads, no alpha test (LAB: ~15% cheaper redraw); the near tile
        // keeps every alpha-tested caster so close leaf shadows keep their holes. Plants and water never cast.
        const cut = C === G.sh && G.nSize > 0 && G.pCutSolid !== null ? G.pCutSolid : G.pCut;
        const n = drawShadowSet(gl, G.pOpaque, 0, now, C) + drawShadowSet(gl, cut, 1, now, C);
        const near = C === G.nr;
        STATS.shadowChunks = n;
        STATS.refreshes++;
        if (near) { STATS.tiles.near++; STATS.tiles.nearChunks = n; } else { STATS.tiles.far++; STATS.tiles.farChunks = n; }
        const w = WHY[C.why]; if (w) STATS.why[w]++;
        C.drawn = true;
    }

    // Opaque (pass 0) and cutout (pass 1) parts of a column are drawn for the same visible chunks, and
    // the game skips a part whose mesh became empty. A sibling drawn without this part means it's empty
    // now: drop its record so it can't cast a ghost shadow.
    function trackColumn(e, mode, prevFrame) {
        const key = Math.round(e.wx / 16) * 65536 + Math.round(e.wz / 16) + 32768;
        let col = e.col;
        if (col === null || col.key !== key) {
            col = cols.get(key);
            if (col === undefined) { col = { key, p0: null, p1: null }; cols.set(key, col); }
            e.col = col;
        }
        if (mode === 0) {
            col.p0 = e;
            const s = col.p1;
            if (s !== null && s !== e && prevFrame >= 0 && s.frame < prevFrame) { markDirty(s); forget(s); }
        } else {
            col.p1 = e;
            const s = col.p0;
            if (s !== null && s !== e && s.frame !== frameId) { markDirty(s); forget(s); }
        }
    }

    function terrainDraw(gl, info, count) {
        let e = rec.get(curVAO);
        const o = lastOrigin;
        if (ST.camFrame !== frameId) {
            const prevCamFrame = ST.camFrame;
            ST.camFrame = frameId;
            updateState();
            const c = ST.cam;
            copy3(c, CAMLAST);
            if (e !== undefined && e.frame === prevCamFrame) { c[0] += e.ox - o[0]; c[1] += e.oy - o[1]; c[2] += e.oz - o[2]; }
            copy3(CAMLAST, c);
            finalizeShadow(gl, info.mode < 2);
            if (info.mode < 2 && ST.refresh && shadowFrame !== frameId) {
                shadowFrame = frameId;
                // renderShadow restores the GL state itself; if it fails, this frame renders without
                // shadows (not with a map that was never drawn) and the next frame starts over
                try { renderShadow(gl, info); } catch (err) {
                    ST.shadowOn = 0; ST.refresh = false; G.sh.valid = false;
                    hookError('renderShadow', err);
                }
            }
            pushCam(gl, info);
        }
        if (info.mode < 2) {
            const c = ST.cam;
            const mode = info.mode;
            let changed = false;
            if (e === undefined) {
                e = { vao: curVAO, n: count, ox: 0, oy: 0, oz: 0, wx: 0, wy: 0, wz: 0, cut: mode, seen: 0, frame: -9, col: null };
                rec.set(curVAO, e);
                changed = true;
            } else if (e.n !== count) changed = true;
            const prevFrame = e.frame;
            e.n = count;
            e.ox = o[0]; e.oy = o[1]; e.oz = o[2];
            e.wx = o[0] + c[0]; e.wy = o[1] + c[1]; e.wz = o[2] + c[2];
            e.cut = mode;
            e.seen = ST.ms; e.frame = frameId;
            if (changed) markDirty(e);
            trackColumn(e, mode, prevFrame);
        }
    }

    proto.drawElements = function (mode, count, type, offset) {
        const info = curInfo;
        if (info !== null && info.terrain && curVAO !== null && haveOrigin && !ERR.off) {
            try { terrainDraw(this, info, count); } catch (e) { hookError('terrainDraw', e); }
        }
        return O.drawElements.call(this, mode, count, type, offset);
    };

    // ---------------------------------------------------------------- frame timing

    // gfx.draw() starts every frame with viewport(0, 0, canvas.width, canvas.height): the game's only viewport call
    // on the main context. That call times the frame and queues a microtask, which runs right after the game's rAF
    // callback returns (after the crack, hands, fire overlay and HUD, before the frame is presented). Every frame
    // renders straight to the canvas at 100%, exactly as in vanilla.
    const VP = { x: 0, y: 0, w: 0, h: 0 }; // the viewport the game's frame currently draws with
    const PF = { pending: false, seq: -1, inRaf: false, prevTs: -1, dt: 0, t0: 0, id: 0 }; // id: game frames started
    const CPU_BOUND_MS = 12;             // rAF callbacks longer than this mean the frame is CPU-bound (perf.cpuBound)

    // GPU time per frame (EXT_disjoint_timer_query_webgl2, TIME_ELAPSED): one query per frame from a ring of
    // TQ_N, read when available (on the UHD 620 / D3D11 that is 0.25-1.5 s later), never blocking; samples are
    // dropped when the GPU reports a disjoint period.
    const TQ_N = 128;
    const TQ = { ext: null, ok: false, q: [], f: new Int32Array(TQ_N), busy: new Uint8Array(TQ_N), head: 0, tail: 0, active: -1 };

    // gpuRing: GPU ms of each timed frame, written at gpuFrame & 255 (gpuFrame = samples so far; NaN = dropped as disjoint)
    // gpuRingFrame: the frame number each sample belongs to; frame: the number of the game frame most recently
    // started (counted at its viewport call; not the same counter as state.frame)
    // scale: always 1 since 1.5.1 (tools/bench.mjs and older Better Options read it); fpsGame: frames in the last window,
    // counted as the game's F3 overlay counts them (see gameFps), 0 until the first window closes
    const PERF = {
        fps: 0, fpsGame: 0, ms: 0, cpuMs: 0, gpuMs: null, scale: 1, cpuBound: false, shadowRefreshPerMin: 0, timer: false,
        gpuRing: new Float32Array(256), gpuRingFrame: new Int32Array(256), gpuFrame: 0, frame: 0
    };
    const PT = { t: 0, n: 0, dt: 0, cpu: 0, cpuN: 0, gpu: 0, gpuN: 0, gf: 0, gT: -1, rt: new Float64Array(20), rc: new Float64Array(20), ri: 0, rn: 0 };
    // bench recorder (Twitterentary.bench): dt keeps the first 16384 intervals (percentiles); m counts every
    // interval, for the means (dtSum). Intervals up to 5 s count, so very slow renderers still get a row.
    const BREC = { on: false, n: 0, m: 0, dt: new Float64Array(16384), dtSum: 0, cpu: 0, cpuN: 0, gpu: 0, gpuN: 0, ref0: 0, t0: 0 };
    const BREC_MAX_MS = 5000;

    function initTimer(gl) {
        try {
            const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
            if (ext) {
                const q = [];
                for (let i = 0; i < TQ_N; i++) { const x = gl.createQuery(); if (!x) throw new Error('createQuery failed'); q.push(x); }
                TQ.q = q; TQ.ext = ext; TQ.ok = true;
            }
        } catch (e) { TQ.ok = false; }
        PERF.timer = TQ.ok;
    }

    // The frame's viewport call: time the frame and queue its end.
    function frameStart(gl) {
        const inRaf = RAF.active > 0 && RAF.seq !== PF.seq; // inside a callback that has not started a frame yet
        PF.seq = RAF.seq; PF.inRaf = inRaf;
        const now = performance.now();
        const ts = inRaf ? RAF.ts : now;
        PF.dt = PF.prevTs >= 0 ? ts - PF.prevTs : 0;
        PF.prevTs = ts;
        PF.t0 = inRaf ? RAF.t0 : now;
        PF.pending = true; PF.id++; PERF.frame = PF.id;
        queueMicrotask(frameEnd);
        if (TQ.ok) timerBegin(gl);
    }

    // Microtask, after the game's whole rAF callback: ends the GPU timer and publishes the frame's timing.
    function frameEnd() {
        PF.pending = false;
        const gl = mainGL;
        try {
            if (TQ.active >= 0) { TQ.active = -1; gl.endQuery(TQ.ext.TIME_ELAPSED_EXT); }
            const t1 = performance.now();
            const cpu = PF.inRaf ? t1 - PF.t0 : -1;
            if (TQ.ok) timerPoll(gl);
            perfFrame(PF.dt, cpu, t1);
        } catch (e) { hookError('frame timing', e); }
    }

    function timerBegin(gl) {
        const i = TQ.head;
        if (TQ.busy[i] || TQ.active >= 0) return; // the whole ring still in flight: skip this frame
        gl.beginQuery(TQ.ext.TIME_ELAPSED_EXT, TQ.q[i]);
        TQ.busy[i] = 1; TQ.f[i] = PF.id; TQ.active = i; TQ.head = (i + 1) % TQ_N;
    }
    function timerPoll(gl) {
        for (let k = 0; k < 32; k++) {
            const i = TQ.tail;
            if (!TQ.busy[i] || i === TQ.active) return;
            const q = TQ.q[i];
            if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) return;
            const ms = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;
            TQ.busy[i] = 0; TQ.tail = (i + 1) % TQ_N;
            if (!(ms >= 0 && ms < 1000)) continue;
            PT.gpu += ms; PT.gpuN++;
            PERF.gpuRingFrame[PERF.gpuFrame & 255] = TQ.f[i]; PERF.gpuRing[PERF.gpuFrame & 255] = ms; PERF.gpuFrame++;
            if (BREC.on) { BREC.gpu += ms; BREC.gpuN++; }
        }
    }
    // The game's own FPS counter (main.js frameBody, what F3 shows): frames per window on the rAF timestamp, the window
    // closing on the first frame past 1000 ms. Its window can't be read, so the two can still be a frame apart.
    function gameFps(ts) {
        const p = PT;
        if (p.gT < 0) { p.gT = ts; return; }
        p.gf++;
        if (ts - p.gT > 1000) { PERF.fpsGame = p.gf; p.gf = 0; p.gT = ts; }
    }

    function perfFrame(dt, cpu, now) {
        const p = PT;
        if (PF.inRaf) gameFps(PF.prevTs);
        if (dt > 0 && dt < 1000) { p.n++; p.dt += dt; }
        if (cpu >= 0) { p.cpu += cpu; p.cpuN++; }
        if (BREC.on && dt > 0 && dt < BREC_MAX_MS) {
            if (BREC.n < BREC.dt.length) BREC.dt[BREC.n++] = dt;
            BREC.m++; BREC.dtSum += dt;
            if (cpu >= 0) { BREC.cpu += cpu; BREC.cpuN++; }
        }
        if (p.t === 0) { p.t = now; return; }
        const el = now - p.t;
        if (el < 250) return;
        if (TQ.ok && p.gpuN && mainGL.getParameter(TQ.ext.GPU_DISJOINT_EXT)) { // 4x/s; Chrome answers this client-side (no GPU sync)
            for (let k = 1; k <= p.gpuN && k <= 256; k++) PERF.gpuRing[(PERF.gpuFrame - k) & 255] = NaN;
            p.gpu = 0; p.gpuN = 0;
        }
        // a window without a usable interval (a hitch > 1 s) keeps the previous values instead of reading 0
        if (p.n) { PERF.fps = 1000 * p.n / p.dt; PERF.ms = p.dt / p.n; }
        if (p.cpuN) PERF.cpuMs = p.cpu / p.cpuN;
        if (p.gpuN) PERF.gpuMs = p.gpu / p.gpuN;
        else if (!TQ.ok) PERF.gpuMs = null;
        PERF.cpuBound = PERF.cpuMs > CPU_BOUND_MS;
        PERF.timer = TQ.ok;
        // shadow refreshes per minute over the last ~5 s
        const j = p.ri;
        p.rt[j] = now; p.rc[j] = STATS.refreshes; p.ri = (j + 1) % 20;
        if (p.rn < 20) p.rn++;
        const o = p.rn < 20 ? 0 : p.ri;
        const span = now - p.rt[o];
        PERF.shadowRefreshPerMin = span > 0 ? (STATS.refreshes - p.rc[o]) * 60000 / span : 0;
        p.t = now; p.n = 0; p.dt = 0; p.cpu = 0; p.cpuN = 0; p.gpu = 0; p.gpuN = 0;
    }

    proto.viewport = function (x, y, w, h) {
        if (this === mainGL) {
            // the first full-canvas viewport since the last frame ended: gfx.draw's frame start
            if (x === 0 && y === 0 && !PF.pending) {
                const c = this.canvas;
                if (w === c.width && h === c.height) {
                    // a failing beginQuery (the only call here that can throw) costs the GPU timer, nothing else
                    try { frameStart(this); } catch (e) { TQ.ok = false; }
                }
            }
            VP.x = x; VP.y = y; VP.w = w; VP.h = h;
        }
        return O.viewport.call(this, x, y, w, h);
    };

    // ---------------------------------------------------------------- benchmark and stress hooks

    const BENCH_DEFAULTS = Object.freeze({ seconds: 6, warmup: 2, scenarios: Object.freeze(['current', 'off', 'low', 'medium', 'high', 'ultra']) });
    const BENCH_SETTLE = 0.5; // s per scenario on top of the warm-up

    function benchOpts(o) {
        o = o || {};
        const sec = Number(o.seconds), wu = Number(o.warmup);
        return {
            seconds: Number.isFinite(sec) && sec > 0 ? Math.min(120, sec) : BENCH_DEFAULTS.seconds,
            warmup: Number.isFinite(wu) && wu >= 0 ? Math.min(60, wu) : BENCH_DEFAULTS.warmup,
            scenarios: Array.isArray(o.scenarios) && o.scenarios.length ? o.scenarios.map(String) : BENCH_DEFAULTS.scenarios.slice()
        };
    }

    // Motion suffixes (as npm run bench) -> stress() options: -moving = creative flying and -sprint = sprint-flying
    // (the emulated drift, so the real redraw rules decide), -stress = a forced redraw every 4 frames (worst case)
    const BENCH_MOTIONS = Object.freeze({
        moving: Object.freeze({ moveSpeed: 11 }), sprint: Object.freeze({ moveSpeed: 22 }), stress: Object.freeze({ shadowRefreshEvery: 4 })
    });
    // `name` grammar (as npm run bench): off | current | <quality preset>[+key=value]...[-moving|-sprint|-stress]
    function parseScenario(name) {
        let s = name.trim(), motion = null;
        const mm = /-(moving|sprint|stress)$/i.exec(s);
        if (mm) { motion = BENCH_MOTIONS[mm[1].toLowerCase()]; s = s.slice(0, -mm[0].length); }
        const parts = s.split('+'), head = parts[0].trim().toLowerCase();
        const vals = {};
        if (head === 'vanilla') return { note: 'vanilla needs the game without userscripts: use npm run bench' };
        if (head === 'off') vals.enabled = false;
        else if (head !== 'current') {
            const p = PRESETS.quality.find(x => x.id === head);
            if (!p) return { note: 'unknown scenario "' + head + '"' };
            for (const k of GROUP_KEYS.quality) vals[k] = k in p.values ? p.values[k] : DEFAULTS[k];
            vals.enabled = true;
        }
        for (let i = 1; i < parts.length; i++) {
            const m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(parts[i]);
            if (!m || !(m[1] in DEFAULTS)) return { note: 'unknown setting "' + parts[i] + '"' };
            vals[m[1]] = coerce(m[1], m[2]);
        }
        return { vals, motion };
    }

    function lsSnapshot() {
        const out = {};
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (k && k.startsWith('tc.shader.')) out[k] = localStorage.getItem(k);
            }
        } catch (e) {}
        return out;
    }
    function lsRestore(snap) {
        try {
            const now = lsSnapshot();
            for (const k in now) if (!(k in snap)) localStorage.removeItem(k);
            for (const k in snap) if (now[k] !== snap[k]) localStorage.setItem(k, snap[k]);
        } catch (e) {}
    }

    const r3 = x => (Number.isFinite(x) ? Math.round(x * 1000) / 1000 : null);
    function naRow(name, note) { return { name, fps: null, ms: null, p95: null, low1: null, cpuMs: null, gpuMs: null, scale: null, refreshPerMin: null, note }; }
    function benchRow(name, wallMs) {
        // n: the stored intervals (percentiles); m: every interval (means), more than n past 16384 frames
        const n = Math.min(BREC.n, BREC.dt.length), m = Math.max(n, BREC.m);
        if (!n) return naRow(name, 'no frames were drawn (hidden tab?)');
        const d = Array.from(BREC.dt.subarray(0, n)).sort((a, b) => a - b);
        const q = f => { const x = (n - 1) * f, lo = Math.floor(x), hi = Math.ceil(x); return d[lo] + (d[hi] - d[lo]) * (x - lo); };
        const worst = d.slice(Math.floor(n * 0.99));
        const ms = BREC.dtSum / m, cpuMs = BREC.cpuN ? BREC.cpu / BREC.cpuN : null;
        const gpuMs = BREC.gpuN >= Math.max(10, m * 0.5) ? BREC.gpu / BREC.gpuN : null;
        const row = {
            name, fps: r3(1000 / ms), ms: r3(ms), p95: r3(q(0.95)), low1: r3(1000 / (worst.reduce((a, b) => a + b, 0) / worst.length)),
            cpuMs: r3(cpuMs), gpuMs: r3(gpuMs), scale: 1,
            refreshPerMin: r3(wallMs > 0 ? (STATS.refreshes - BREC.ref0) * 60000 / wallMs : null)
        };
        if (cpuMs !== null && cpuMs > CPU_BOUND_MS) row.note = 'cpu-bound';
        return row;
    }
    function benchEnv() {
        const gl = mainGL, c = gl && gl.canvas;
        let gpu = null;
        try {
            if (gl) { const dbg = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER)); }
        } catch (e) {}
        return { gpu, w: c ? c.width : null, h: c ? c.height : null, dpr: window.devicePixelRatio || 1, version: VERSION, timer: TQ.ok };
    }

    // The running bench's control object (null when idle): abort() marks it, restores at once and wakes its wait.
    let BCTL = null;
    const benchWait = (ctl, ms) => new Promise(r => { ctl.wake = r; ctl.timer = setTimeout(r, ms); });

    // Measures each scenario where the player stands, then restores every CFG value, every saved tc.shader.* key
    // and the stress() state exactly as they were (also on error or abort). Scenarios are applied in memory,
    // never saved.
    async function bench(opts) {
        if (bench.running) throw new Error('Twitterentary.bench is already running');
        bench.running = true;
        const ctl = { aborted: false, restored: false, wake: null, timer: 0, restore: null };
        BCTL = ctl;
        const rows = [];
        try {
            const o = benchOpts(opts);
            const snapCfg = Object.assign({}, CFG), snapLs = lsSnapshot();
            const snapEvery = STRESS.shadowRefreshEvery, snapSpeed = STRESS.moveSpeed;
            ctl.restore = () => {
                if (ctl.restored) return;
                ctl.restored = true;
                BREC.on = false;
                for (const k in DEFAULTS) CFG[k] = snapCfg[k];
                lsRestore(snapLs);
                stressSet(snapEvery, snapSpeed);
                try { formatSaved = localStorage.getItem(FORMAT_KEY) !== null; } catch (e) {} // lsRestore may have removed the marker
            };
            for (const name of o.scenarios) {
                if (ctl.aborted) break;
                const sc = parseScenario(name);
                if (!sc.vals) { rows.push(naRow(name, sc.note)); continue; }
                for (const k in DEFAULTS) CFG[k] = snapCfg[k];
                Object.assign(CFG, sc.vals);
                stressSet(sc.motion && sc.motion.shadowRefreshEvery, sc.motion && sc.motion.moveSpeed);
                await benchWait(ctl, (o.warmup + BENCH_SETTLE) * 1000);
                if (ctl.aborted) break;
                BREC.n = 0; BREC.m = 0; BREC.dtSum = 0; BREC.cpu = 0; BREC.cpuN = 0; BREC.gpu = 0; BREC.gpuN = 0;
                BREC.ref0 = STATS.refreshes; BREC.t0 = performance.now(); BREC.on = true;
                await benchWait(ctl, o.seconds * 1000);
                // very slow renderers (software GL): extend the window until a few frames were seen, at most 5 s
                const until = performance.now() + 5000;
                while (!ctl.aborted && BREC.n < 3 && performance.now() < until) await benchWait(ctl, 100);
                if (ctl.aborted) break; // the window in progress is discarded
                BREC.on = false;
                rows.push(benchRow(name, performance.now() - BREC.t0));
            }
        } finally {
            clearTimeout(ctl.timer);
            if (ctl.restore) ctl.restore(); // a no-op after abort(), which restored already
            if (BCTL === ctl) { BCTL = null; bench.running = false; }
        }
        const res = { env: benchEnv(), rows };
        if (ctl.aborted) res.aborted = true;
        return res;
    }
    bench.running = false;
    bench.defaults = BENCH_DEFAULTS;
    bench.estimate = o => { const b = benchOpts(o); return Math.ceil(b.scenarios.length * (b.seconds + b.warmup + BENCH_SETTLE)); };
    // Stops a running bench(): restores CFG, the tc.shader.* keys and stress() at once (before it returns),
    // clears bench.running, and makes the bench's promise resolve (within a microtask) with
    // { env, rows: the rows finished so far, aborted: true }; the window being measured is discarded.
    // Returns true if it stopped a bench, false if none was running.
    bench.abort = function abort() {
        const ctl = BCTL;
        if (ctl === null || !bench.running || ctl.restore === null) return false;
        ctl.aborted = true; BCTL = null;
        try { ctl.restore(); } catch (e) { console.warn(TAG, 'bench abort: restore failed', e); }
        bench.running = false;
        clearTimeout(ctl.timer);
        const w = ctl.wake; ctl.wake = null;
        if (w) w();
        return true;
    };

    // stress({ shadowRefreshEvery: n }) forces shadow redraws, bypassing shadowEvery: with two tiles the near tile
    // every n frames and the far tile every max(60, 15n) (its near half the frame after), a single map every n.
    // stress({ moveSpeed: v }) emulates a camera moving v blocks/s (horizontally) for the redraw decision only, so
    // the real rules decide which tile redraws when (near after shadowMove blocks, far after half its spare range,
    // at most one per shadowEvery frames, never both in one frame); the tiles stay centred on the real camera.
    // Each call sets both (an option left out is off); stress({}) turns everything off. In memory only. Returns
    // the state, also in debug().stress: { mode, shadowRefreshEvery, moveSpeed, forced, drifted }.
    function stressSet(every, speed) {
        const n = Math.floor(Number(every)), v = Number(speed);
        STRESS.shadowRefreshEvery = n > 0 ? Math.min(n, 3600) : 0;
        const ms = v > 0 ? Math.min(v, 1000) : 0;
        if (ms === STRESS.moveSpeed) return;
        if (ms === 0) { // back to the real camera: no drift in the tiles' snapshots either
            const D = STRESS.drift, a = G.sh.d0, b = G.nr.d0;
            for (let k = 0; k < 3; k++) { D[k] = 0; a[k] = 0; b[k] = 0; }
        }
        if (STRESS.moveSpeed === 0) STRESS.lastMs = -1;
        STRESS.moveSpeed = ms;
    }
    function stressInfo() {
        const n = STRESS.shadowRefreshEvery, v = STRESS.moveSpeed;
        return {
            mode: n > 0 ? (v > 0 ? 'both' : 'shadowRefreshEvery') : (v > 0 ? 'moveSpeed' : 'off'),
            shadowRefreshEvery: n, moveSpeed: v, forced: STRESS.forced, drifted: Math.round(STRESS.drifted * 100) / 100
        };
    }
    function stress(o) {
        stressSet(o && o.shadowRefreshEvery, o && o.moveSpeed);
        return stressInfo();
    }

    // ---------------------------------------------------------------- settings API

    // Settings take effect on the next frame without help: uniforms are rebuilt from CFG every frame, and
    // the shadow map compares its own settings (size, range, depth, culling) with the snapshot of its
    // last refresh, while shadows/enabled switch it on and off. So apply() does not touch the map: a
    // dragged Look slider (Better Options calls apply() after every write) causes no shadow redraws.
    // G.dirty is reserved for changed casters (chunks, block classes). Kept for API compatibility.
    function apply() {}

    function set(key, value) {
        if (!(key in DEFAULTS)) return false;
        CFG[key] = coerce(key, value);
        persist(key);
        apply();
        return true;
    }

    function applyPreset(group, id) {
        const list = PRESETS[group], keys = GROUP_KEYS[group];
        const p = list && list.find(x => x.id === id);
        if (!p) return false;
        for (const k of keys) {
            CFG[k] = coerce(k, k in p.values ? p.values[k] : DEFAULTS[k]);
            persist(k);
        }
        apply();
        return true;
    }

    function currentPreset(group) {
        const list = PRESETS[group];
        if (!list) return null;
        for (const p of list) {
            let ok = true;
            for (const k in p.values) if (!same(CFG[k], p.values[k])) { ok = false; break; }
            if (ok) return p.id;
        }
        return null;
    }

    // Restores every default and removes every saved shader setting, including keys older versions used.
    function reset() {
        for (const k in DEFAULTS) CFG[k] = DEFAULTS[k];
        toggleKey = TOGGLE_DEFAULT; // its saved value goes with the other tc.shader.* keys below
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tc.shader.')) keys.push(k); }
            for (const k of keys) localStorage.removeItem(k);
        } catch (e) {}
        formatSaved = false;
        apply();
    }

    function debug() {
        const r = a => a && Array.from(a).map(x => +Number(x).toFixed(3));
        const out = {
            version: VERSION, frameId, dim: ST.dim, day: +ST.day.toFixed(3), sun: r(ST.sun), cam: r(ST.cam),
            camSeen: OBS.camOk, sunSeenFrame: OBS.sunFrame, skyFrame: OBS.topFrame, litProgram: OBS.lit,
            ambient: OBS.amb, skyLight: r(OBS.sl), shadowOn: ST.shadowOn, shadowChunks: STATS.shadowChunks,
            refreshes: STATS.refreshes, refreshWhy: Object.assign({}, STATS.why), shadowMap: G.texSize,
            shadowTiles: {
                atlas: [G.texW, G.texH], near: G.nr.valid ? { size: G.nr.size, range: G.nr.E } : null,
                far: G.sh.valid ? { size: G.sh.size, range: G.sh.E } : null, ...STATS.tiles
            },
            records: rec.size, remeshes: remeshCount, errors: ERR.n, paused: ERR.off,
            perf: Object.assign({}, PERF),
            stress: stressInfo(),
            preset: { quality: currentPreset('quality'), look: currentPreset('look') },
            layers: ATL.n, layerBits, layerNames: ATL.names ? ATL.names.slice() : null,
            layerClasses: ATL.stats ? Array.from({ length: ATL.n }, (_, l) => layerClass(l)) : null,
            animated: ATL.anim.size, names: ATL.names ? ATL.names.reduce((a, n, i) => { const c = layerClass(i); if (c) (a[['', 'leaves', 'plants', 'water', 'emissive'][c]] ||= []).push(n); return a; }, {}) : null, classes: { leaves: CLS_COUNTS[1], plants: CLS_COUNTS[2], water: CLS_COUNTS[3], emissive: CLS_COUNTS[4] }
        };
        console.log(out);
        return out;
    }
    window.Twitterentary = {
        cfg: CFG, schema: SCHEMA, defaults: DEFAULTS, presets: PRESETS, version: VERSION,
        state: ST, stats: STATS, shadow: G.sh, obs: OBS, perf: PERF,
        set, apply, applyPreset, currentPreset, reset, debug, bench, stress
    };

    function notify(text) {
        const bus = window.__tcOptions;
        if (bus && typeof bus.toast === 'function') { try { bus.toast(text); return; } catch (e) {} }
        try {
            const n = document.getElementById('note');
            if (!n) return;
            n.textContent = text;
            n.classList.add('show');
            clearTimeout(notify.t);
            notify.t = setTimeout(() => n.classList.remove('show'), 1800);
        } catch (e) {}
    }
    addEventListener('keydown', e => {
        if (e.code !== toggleKey || e.repeat) return;
        // A keydown of AltLeft has altKey set, so the modifier flags only rule out keys that aren't modifiers themselves.
        if (!/^(Control|Alt|Meta)/.test(toggleKey) && (e.ctrlKey || e.metaKey || e.altKey)) return;
        if (e.__tc || e.__tcCaptured || (window.__tcOptions && window.__tcOptions.capturing) || bench.running) return; // __tc: Better Options' own synthetic press
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        // The game's Controls screen takes the next key press, and nothing on the page says it is waiting for one.
        if (document.querySelector('#screen.on .keylist')) return;
        set('enabled', !CFG.enabled);
        console.info(TAG, 'Shaders ' + (CFG.enabled ? 'ON' : 'OFF'));
        notify('Twitterentary shaders: ' + (CFG.enabled ? 'ON' : 'OFF'));
    }, true);

    // Better Options may load after this script, or not at all: the listener above needs no bus, so this only adds
    // the row to its Keybinds tab, and it stops looking after 20 s.
    function registerToggleKey(tries) {
        const bus = window.__tcOptions;
        if (!bus || typeof bus.registerKeybind !== 'function') {
            if (tries > 1) setTimeout(registerToggleKey, 200, tries - 1);
            return;
        }
        try {
            bus.registerKeybind({
                id: 'tc.shaders.toggle',
                label: 'Toggle shaders',
                defaultKey: TOGGLE_DEFAULT,
                get: () => toggleKey,
                set: setToggleKey,
                reset: () => setToggleKey(TOGGLE_DEFAULT)
            });
        } catch (e) { console.warn(TAG, 'keybind registration failed', e); }
    }
    registerToggleKey(100);

    console.info(TAG, 'Twitterentary v' + VERSION + ' loaded. Press ' + toggleKey.replace(/^(?:Key|Digit)/, '') + ' to toggle shaders. Config: Twitterentary.cfg | Presets: Twitterentary.presets | Diagnostics: Twitterentary.debug()');
})();
