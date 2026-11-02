// ==UserScript==
// @name         Twitterentary shaders
// @namespace    tweetcraft.twitterentary
// @version      1.4.0
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
            { id: 'high', name: 'High', desc: '4096 shadows, 72-block range, quicker updates.', values: { shadows: true, shadowSize: 4096, shadowExtent: 72, shadowFilter: 1, shadowEvery: 4, shadowMove: 4 } },
            { id: 'ultra', name: 'Ultra', desc: '4096 shadows, 96-block range, softest edges.', values: { shadows: true, shadowSize: 4096, shadowExtent: 96, shadowFilter: 2, shadowEvery: 2, shadowMove: 2 } }
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

    function persist(key) {
        try {
            if (same(CFG[key], DEFAULTS[key])) localStorage.removeItem(SKEY(key));
            else localStorage.setItem(SKEY(key), String(CFG[key]));
        } catch (e) {}
    }

    const proto = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
    if (!proto) return;

    const O = {};
    for (const k of ['shaderSource', 'compileShader', 'attachShader', 'linkProgram', 'useProgram',
        'bindVertexArray', 'deleteVertexArray', 'getUniformLocation', 'uniform1f', 'uniform1i', 'uniform3f', 'uniform3fv',
        'uniform4f', 'uniformMatrix4fv', 'drawElements', 'clear', 'texImage3D', 'texSubImage3D']) {
        O[k] = proto[k];
    }

    const clamp01 = x => Math.min(1, Math.max(0, x));
    const sstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
    const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    function normInto(o, x, y, z) { const l = Math.hypot(x, y, z) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; return o; }
    function mixInto(o, a, b, t) { o[0] = a[0] + (b[0] - a[0]) * t; o[1] = a[1] + (b[1] - a[1]) * t; o[2] = a[2] + (b[2] - a[2]) * t; return o; }
    function copy3(o, a) { o[0] = a[0]; o[1] = a[1]; o[2] = a[2]; return o; }

    // ---------------------------------------------------------------- GLSL

    function patchTerrainVS(src) {
        const re = /vec3\s+p\s*=\s*vec3\(\s*aPos\s*&\s*uvec3\(\s*0x1FFu\s*,\s*0xFFFu\s*,\s*0x1FFu\s*\)\s*\)\s*\*\s*0\.0625\s*\+\s*uOrigin\s*;/;
        if (!/aPos\s*&\s*uvec3/.test(src) || !src.includes('uniform vec3 uOrigin;') ||
            !re.test(src) || !src.includes('out vec2 vLight;')) return null;

        let s = src.replace('uniform vec3 uOrigin;', () =>
            'uniform vec3 uOrigin;\nuniform highp sampler2D uClsTex;\nuniform vec3 uCam;\nuniform float uTime;\nuniform float uFx;' +
            '\nuniform float uWaveOn;\nuniform float uLeafSway;\nuniform float uPlantSway;');
        s = s.replace('out vec2 vLight;', () => 'out vec2 vLight;\nout vec3 vRel;\nflat out float vCls;');

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
  vRel = p;
  float tcC = floor(texelFetch(uClsTex, ivec2(int(aInfo.x), 0), 0).r * 255.0 + 0.5);
  vCls = tcC;${wave}`);
    }

    // Shadow constants are uniforms (uShadowP = size, 1/size, world texel, depth range), so every
    // setting applies live. The tent filters are Castaño's: 4 (3x3) or 9 (5x5) hardware-PCF taps.
    // textureLod (not texture) keeps the taps free of gradients, so ANGLE can really skip them in branches.
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
uniform float uAmbStr;
uniform float uBlockStr;
uniform float uSunStr;
uniform float uEmissive;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform mat4 uLVP;
uniform highp sampler2DShadow uShadowMap;
in vec3 vRel;
flat in float vCls;

// Highlight roll-off above 0.7. Mostly applied to the brightest channel, so sunlit sand, wood and
// terracotta keep their hue instead of bleaching toward white; 30% per channel keeps a soft white-out.
vec3 tcTone(vec3 x) {
  vec3 k = max(x - 0.7, 0.0);
  vec3 pc = min(x, vec3(0.7)) + 0.3 * (1.0 - exp(-k / 0.3));
  float m = max(max(x.r, x.g), max(x.b, 1e-4));
  float t = m > 0.7 ? 0.7 + 0.3 * (1.0 - exp((0.7 - m) / 0.3)) : m;
  return mix(x * (t / m), pc, 0.3);
}
float tcTap(vec2 p, float z) {
  return textureLod(uShadowMap, vec3(p, z), 0.0);
}
float tcShadow(vec3 rel, vec3 n, float ndl, bool cheap) {
  vec3 sc = (uLVP * vec4(rel + n * (uShadowP.z * 1.6 + 0.015), 1.0)).xyz * 0.5 + 0.5;
  float edge = max(abs(sc.x - 0.5), abs(sc.y - 0.5)) * 2.0;
  if (edge >= 1.0 || sc.z >= 1.0 || sc.z <= 0.0) return 1.0;
  float z = sc.z - (0.03 + 0.06 * (1.0 - ndl)) / (2.0 * uShadowP.w);
  float fade = 1.0 - smoothstep(0.82, 1.0, edge);
  if (cheap || uShadowQ < 0.5) return mix(1.0, tcTap(sc.xy, z), fade);
  float inv = uShadowP.y;
  vec2 uv = sc.xy * uShadowP.x;
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
    vec3 ox = vec3((3.0 - 2.0 * st.x) / wx.x - 2.0, (3.0 + st.x) / 7.0, st.x / wx.z + 2.0) * inv;
    vec3 oy = vec3((3.0 - 2.0 * st.y) / wy.x - 2.0, (3.0 + st.y) / 7.0, st.y / wy.z + 2.0) * inv;
    s = 0.0;
    for (int j = 0; j < 3; j++)
      for (int i = 0; i < 3; i++)
        s += wx[i] * wy[j] * tcTap(b + vec2(ox[i], oy[j]), z);
    s *= 1.0 / 144.0;
  }
  return mix(1.0, s, fade);
}
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
            ? '+ max(lightmap(vec2(0.0, vLight.y)) - lightmap(vec2(0.0)), 0.0) * 0.35'
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

  // ambient occlusion: separated from the engine's per-face shading
  float tcExp = abs(tcN.y) > 0.5 ? (tcN.y > 0.0 ? 1.0 : 0.5) : (abs(tcN.x) > abs(tcN.z) ? 0.6 : 0.8);
  float tcAO = pow(clamp(vShade / tcExp, 0.0, 1.0), uAoPow);

  float tcSky = ${lit ? 'clamp(vLight.x * (1.0 / 15.0), 0.0, 1.0)' : '1.0'};
  float tcBl = ${lit ? 'clamp(vLight.y * (1.0 / 15.0), 0.0, 1.0)' : '0.0'};
  float tcDay = uDay;
  float tcHemi = tcNs.y * 0.5 + 0.5;

  // hemispheric ambient light: soft blue sky above, warm bounce from the sunlit ground below
  vec3 tcAmbDay = mix(vec3(0.48, 0.45, 0.40), vec3(0.48, 0.53, 0.60), tcHemi);
  float tcTw = tcDay * (1.0 - tcDay) * 4.0;
  tcAmbDay = mix(tcAmbDay, tcAmbDay * vec3(1.25, 0.95, 0.80), tcTw * 0.35);
  vec3 tcAmbNight = mix(vec3(0.11, 0.12, 0.16), vec3(0.17, 0.21, 0.31), tcHemi);
  vec3 tcAmb = mix(tcAmbNight, tcAmbDay, tcDay);
  float tcSkyK = pow(tcSky, 1.7);
  if (uDim > 1.5) { tcAmb = mix(vec3(0.10, 0.08, 0.13), vec3(0.16, 0.13, 0.19), tcHemi); tcSkyK = 1.0; }
  else if (uDim > 0.5) { tcAmb = mix(vec3(0.24, 0.10, 0.07), vec3(0.34, 0.16, 0.10), tcHemi); tcSkyK = 1.0; }
  vec3 tcAmbient = tcAmb * uAmbStr * (0.14 + 0.86 * tcSkyK) ${ambFloor};

  // block light (torches, lava...)
  vec3 tcBlock = (vec3(1.0, 0.74, 0.48) * (tcBl * tcBl * (0.8 + 0.2 * tcBl)) * 1.3 ${blockEngine}) * uBlockStr;

  // sun + shadows (the shadow is only sampled where the sun can actually reach)
  float tcNdl = clamp(dot(tcNs, uSunDir) * 1.1 + 0.06, 0.0, 1.0);
  float tcSunMask = tcDay * smoothstep(0.0, 0.15, uSkySun.y) * smoothstep(0.5, 0.95, tcSky);
  if (uDim > 0.5) tcSunMask = 0.0;
  float tcVis = 1.0;
  if (uShadowOn > 0.5 && tcNdl > 0.001 && tcSunMask > 0.001)
    tcVis = tcShadow(vRel, tcN, tcNdl, vDist > 32.0 || tcLeaf || tcPlant || tcWater);
  vec3 tcSunL = uSunCol * (tcNdl * tcVis * tcSunMask * uSunStr);
  if (tcLeaf) {
    float tcBk = clamp(dot(tcV, uSunDir), 0.0, 1.0);
    tcSunL += uSunCol * (tcBk * tcBk * tcBk * tcVis * tcSunMask * uSunStr * 0.2);
  }

  vec3 tcLight = tcAmbient * tcAO + tcBlock * (0.6 + 0.4 * tcAO) + tcSunL * (0.55 + 0.45 * tcAO);
  vec3 tcCol = c.rgb * tcLight;
  if (tcEmit) tcCol = max(tcCol, c.rgb * uEmissive);
  float tcAlpha = ${alpha};
${mode === 2 ? WATER_CODE : ''}

  // colour grading; saturation above 1 works like vibrance (saturated colours are boosted less)
  tcCol *= uExposure;
  tcCol = tcTone(tcCol);
  float tcLum = dot(tcCol, vec3(0.299, 0.587, 0.114));
  float tcMx = max(tcCol.r, max(tcCol.g, tcCol.b)), tcMn = min(tcCol.r, min(tcCol.g, tcCol.b));
  float tcSat = uSaturation > 1.0 ? 1.0 + (uSaturation - 1.0) * (1.0 - (tcMx - tcMn) / max(tcMx, 1e-3)) : uSaturation;
  tcCol = mix(vec3(tcLum), tcCol, tcSat);
  tcCol = clamp((tcCol - 0.5) * uContrast + 0.5, 0.0, 1.0);

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

        let s = src.replace(mainRe, mm => fsDecls(mode) + '\n' + mm);
        s = s.replace(cRe, mm => `${mm}\n  vec3 tcDx = dFdx(vRel), tcDy = dFdy(vRel);`);
        s = s.replace(outRe, () => shadeCode(lit, alpha, mode, /uniform\s+vec2\s+uFogR\s*;/.test(src)));
        return { src: s, info: { terrainFS: true, mode, lit } };
    }

    function skyCode() {
        return `
  if (uFx < 0.5 || uSkyOn < 0.5) { o = vec4(tcBase, 1.0); return; }
  vec3 tcd = normalize(vDir);
  float tcH = clamp(tcd.y, 0.0, 1.0);
  float tcSD = uSkyDay;
  float tcSunY = uSkySun.y;
  vec3 tcC = tcBase;
  float tcLum = dot(tcC, vec3(0.299, 0.587, 0.114));
  tcC = mix(vec3(tcLum), tcC, 1.0 + 0.08 * tcSD);
  tcC *= 1.0 - 0.08 * tcSD * smoothstep(0.15, 1.0, tcH);
  float tcHz = 1.0 - tcH; tcHz *= tcHz;
  tcC += vec3(0.07, 0.085, 0.10) * (tcHz * tcHz * tcSD);
  vec3 tcSc = mix(vec3(1.0, 0.50, 0.22), vec3(1.0, 0.90, 0.72), smoothstep(0.0, 0.4, tcSunY));
  float tcVis = smoothstep(-0.25, 0.08, tcSunY);
  float tcDs = dot(tcd, uSkySun);
  if (tcVis > 0.0 && tcDs > 0.4) {
    float tcL = log2(tcDs);
    tcC += tcSc * ((exp2(tcL * 5.0) * 0.16 + exp2(tcL * 40.0) * 0.30 + exp2(tcL * 700.0) * 0.6) * tcVis);
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
        let s = src.replace(/out\s+vec4\s+o\s*;/, mm => mm + '\nuniform vec3 uSkySun;\nuniform float uSkyDay;\nuniform float uFx;\nuniform float uSkyOn;');
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
    const RE_EMIT = /lava|magma|lumen|glowstone|torch|lantern|fire|beacon|shroomlight|sea_lantern|jack_o|redstone_lamp_on|campfire/i;
    const RE_PLANT = /^(short_grass|grass|tall_grass.*|fern|large_fern.*|.*sapling|.*_tulip|poppy|dandelion|blue_orchid|allium|azure_bluet|oxeye_daisy|cornflower|lily_of_the_valley|rose_bush.*|peony.*|lilac.*|sunflower.*|dead_bush|sugar_cane|.*seagrass.*|kelp.*|wheat_stage.*|carrots_stage.*|potatoes_stage.*|beetroots_stage.*|vine|sweet_berry_bush.*|torchflower.*|pitcher.*|.*_roots|.*_sprouts|bush|flower.*)$/i;
    function nameClass(nm) {
        if (RE_EMIT.test(nm) && !/torch_top|lantern_top/.test(nm)) return 4;
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
        G.dirty = true;
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
    const U1 = ['uFx', 'uTime', 'uDay', 'uSkyDay', 'uDim', 'uWaveOn', 'uLeafSway', 'uPlantSway', 'uWaveStr',
        'uAoPow', 'uAmbStr', 'uBlockStr', 'uSunStr', 'uEmissive', 'uExposure', 'uSaturation', 'uContrast',
        'uShadowQ', 'uWaterOn', 'uSkyOn'];
    const U3 = ['uSunDir', 'uSunCol', 'uZenith', 'uSkySun', 'uCloudTint'];
    const V1 = new Float64Array(U1.length), V3 = new Float64Array(U3.length * 3);

    proto.shaderSource = function (shader, source) {
        if (typeof source !== 'string') return O.shaderSource.call(this, shader, source);
        let out = source, info = null;
        try {
            const r = patchSource(source);
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
            const info = { prog: p, loc: null, mode: 0, lit: false };
            for (const s of list) { const d = shaderSrc.get(s); if (d && d.patched && d.info) Object.assign(info, d.info); }
            info.terrain = !!(info.terrainVS && info.terrainFS);
            progInfo.set(p, info);
            PROGS.push(info);
            const kind = info.terrain ? 'terrain (mode ' + info.mode + (info.lit ? ', lit' : '') + ')' : info.sky ? 'sky' : info.cloud ? 'clouds' : 'partial';
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

    proto.uniform3fv = function (loc, v) {
        const k = locKind.get(loc);
        if (k !== undefined && v && v.length >= 3) {
            if (k === 2) setCam(v[0], v[1], v[2]);
            else if (k === 3) { copy3(OBS.top, v); OBS.topFrame = frameId; OBS.sunSeen = false; }
            else if (k === 4) onSprite(v[0], v[1], v[2]);
            else if (k === 6) copy3(OBS.sl, v);
        }
        return O.uniform3fv.apply(this, arguments);
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

    proto.bindVertexArray = function (v) { curVAO = v; return O.bindVertexArray.call(this, v); };
    proto.deleteVertexArray = function (v) {
        const e = rec.get(v);
        if (e !== undefined) { if (inFootprint(e)) G.dirty = true; forget(e); }
        return O.deleteVertexArray.call(this, v);
    };
    // A frame starts with the colour clear. Only the main canvas counts (the dragon view has its own context).
    proto.clear = function (mask) {
        if ((mask & 0x4000) && (mainGL === null || this === mainGL)) frameId++;
        return O.clear.call(this, mask);
    };

    const G = {
        init: false, clsTex: null, clsData: null, clsW: 0, maxTex: 0,
        shadowOk: false, fbo: null, depthTex: null, texSize: 0, checkFbo: false, allocFailed: 0,
        pOpaque: null, pCut: null, dirty: true,
        sh: {
            valid: false, drawn: true, frame: -999, ms: 0, c0: [0, 0, 0], L: [0, 1, 0], R: [1, 0, 0], U: [0, 0, 1],
            dx: 0, dy: 0, hx: 0, hy: 0, E: DEFAULTS.shadowExtent, Z: DEFAULTS.shadowDepth, size: DEFAULTS.shadowSize, cull: true
        }
    };

    const LM_D = [0, 0, 0];
    // Light-space matrix relative to `at`, built from the basis and extent snapshotted at the last refresh.
    function lightMat(m, at) {
        const SH = G.sh, E = SH.E, Zd = SH.Z, R = SH.R, U = SH.U, L = SH.L, d = LM_D;
        d[0] = at[0] - SH.c0[0]; d[1] = at[1] - SH.c0[1]; d[2] = at[2] - SH.c0[2];
        m[0] = R[0] / E; m[1] = U[0] / E; m[2] = -L[0] / Zd; m[3] = 0;
        m[4] = R[1] / E; m[5] = U[1] / E; m[6] = -L[1] / Zd; m[7] = 0;
        m[8] = R[2] / E; m[9] = U[2] / E; m[10] = -L[2] / Zd; m[11] = 0;
        m[12] = (dot(d, R) + SH.dx) / E; m[13] = (dot(d, U) + SH.dy) / E; m[14] = -dot(d, L) / Zd; m[15] = 1;
        return m;
    }

    const SUN_LOW = [1.0, 0.60, 0.36], SUN_NOON = [1.0, 0.97, 0.92];
    const WHITE = [1, 1, 1], CLOUD_TW = [1.0, 0.68, 0.50];
    const ST = {
        frame: -1, camFrame: -1, ms: 0, time: 0, cam: [0, 0, 0], sun: FIXED_SUN, sunL: FIXED_SUN.slice(), sunCol: [1, 1, 1],
        zenith: OBS.top, cloud: [1, 1, 1], day: 1, dim: 0, shadowOn: 0, refresh: false, why: 0,
        lvp: new Float32Array(16)
    };
    const WHY = ['', 'init', 'dirty', 'move', 'sun', 'age'];
    const STATS = { shadowChunks: 0, refreshes: 0, why: { init: 0, dirty: 0, move: 0, sun: 0, age: 0 }, errors: 0 };
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
        v[9] = num(CFG.aoPower); v[10] = num(CFG.ambientStrength); v[11] = num(CFG.blockLight); v[12] = num(CFG.sunStrength);
        v[13] = num(CFG.emissive); v[14] = num(CFG.exposure); v[15] = num(CFG.saturation); v[16] = num(CFG.contrast);
        v[17] = num(CFG.shadowFilter); v[18] = CFG.waterEffects ? 1 : 0; v[19] = CFG.skyEffects ? 1 : 0;
        put3(0, ST.sunL); put3(1, ST.sunCol); put3(2, ST.zenith); put3(3, ST.sun); put3(4, ST.cloud);
    }
    function put3(i, a) { V3[i * 3] = a[0]; V3[i * 3 + 1] = a[1]; V3[i * 3 + 2] = a[2]; }

    function shadowTargetSize() {
        return Math.min(G.maxTex || 4096, Math.round(cfgNum('shadowSize')));
    }

    // Decides whether the shadow map is redrawn this frame. It is redrawn only when something changed:
    // chunks in range (dirty), the camera moved, the sun turned, a shadow setting changed (size, range,
    // depth, culling: compared with the snapshot of the last refresh), or as a 2 s safety net.
    // `canDraw` is false when the frame's first terrain draw is translucent (no opaque or cutout parts in
    // view): the map can't be redrawn then, so the old one is kept, or shadows skip this frame.
    function finalizeShadow(gl, canDraw) {
        const SH = G.sh, cam = ST.cam, size = shadowTargetSize();
        const on = CFG.enabled && CFG.shadows && G.shadowOk && G.allocFailed !== size &&
            ST.dim === 0 && ST.sun[1] > 0.06 && ST.day > 0.1;
        ST.shadowOn = on ? 1 : 0;
        ST.refresh = false;
        if (!on) {
            SH.valid = false;
            // switched off (Quality: Low, or K): give the full-size map's memory back, once. Night and the
            // Nether/End keep it, so the map isn't reallocated every dusk.
            if ((!CFG.enabled || !CFG.shadows) && G.texSize > 1 && G.depthTex) {
                try { resizeShadow(gl, 1); } catch (e) { G.texSize = 1; }
            }
            return;
        }
        if (SH.valid && !SH.drawn) SH.valid = false;
        if (!canDraw && !SH.valid) { ST.shadowOn = 0; return; }
        const L = ST.sunL, E = cfgNum('shadowExtent'), Zd = cfgNum('shadowDepth'), cull = CFG.shadowCull !== false;
        let why = 0;
        if (!canDraw) why = 0;
        else if (!SH.valid) why = 1;
        else if (frameId - SH.frame >= cfgNum('shadowEvery')) {
            if (G.dirty || SH.size !== size || SH.E !== E || SH.Z !== Zd || SH.cull !== cull) why = 2;
            else if (Math.hypot(cam[0] - SH.c0[0], cam[1] - SH.c0[1], cam[2] - SH.c0[2]) > cfgNum('shadowMove')) why = 3;
            else if (dot(L, SH.L) < 0.9999955) why = 4;
            else if (ST.ms - SH.ms > 2000) why = 5;
        }
        if (why) {
            ST.refresh = true; ST.why = why;
            copy3(SH.L, L);
            const R = normInto(SH.R, L[1], -L[0], 0), U = SH.U; // R = L x +Z, U = L x R
            U[0] = L[1] * R[2] - L[2] * R[1]; U[1] = L[2] * R[0] - L[0] * R[2]; U[2] = L[0] * R[1] - L[1] * R[0];
            copy3(SH.c0, cam);
            SH.E = E; SH.Z = Zd; SH.size = size; SH.cull = cull;
            const texel = 2 * SH.E / size, cr = dot(cam, R), cu = dot(cam, U);
            SH.dx = cr - Math.floor(cr / texel) * texel;
            SH.dy = cu - Math.floor(cu / texel) * texel;
            SH.hx = 8 * Math.abs(R[0]) + 64 * Math.abs(R[1]) + 8 * Math.abs(R[2]);
            SH.hy = 8 * Math.abs(U[0]) + 64 * Math.abs(U[1]) + 8 * Math.abs(U[2]);
            SH.frame = frameId; SH.ms = ST.ms; SH.valid = true; SH.drawn = false;
            G.dirty = false;
        }
        lightMat(ST.lvp, cam);
    }

    // Is this chunk part inside the area the current shadow map covers?
    function inFootprint(e) {
        const SH = G.sh;
        if (!SH.valid) return true;
        const cx = e.wx + 8 - SH.c0[0], cy = e.wy + 64 - SH.c0[1], cz = e.wz + 8 - SH.c0[2];
        const R = SH.R, U = SH.U;
        const sx = R[0] * cx + R[1] * cy + R[2] * cz + SH.dx;
        const sy = U[0] * cx + U[1] * cy + U[2] * cz + SH.dy;
        return Math.abs(sx) <= SH.E + SH.hx && Math.abs(sy) <= SH.E + SH.hy;
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
    // Cutout parts: alpha-tested against the atlas; plants (class 2) don't cast shadows.
    const SHADOW_VS = `#version 300 es
precision highp float;
precision highp int;
layout(location=0) in uvec3 aPos;
layout(location=1) in uvec2 aInfo;
uniform mat4 uLVP;
uniform vec3 uOrigin;
uniform highp sampler2D uClsTex;
out vec3 vUV;
void main() {
  float c = floor(texelFetch(uClsTex, ivec2(int(aInfo.x), 0), 0).r * 255.0 + 0.5);
  vUV = vec3(float(aInfo.y & 1u), float((aInfo.y >> 1u) & 1u), float(aInfo.x));
  if (c > 1.5 && c < 3.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
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
            G.pCut = shadowProg(gl, SHADOW_VS, SHADOW_FS);
            G.shadowOk = true;
        } catch (e) {
            console.error(TAG, 'Could not initialize shadows:', e);
            G.shadowOk = false;
        } finally {
            O.useProgram.call(gl, prevProg);
            gl.activeTexture(prevActive);
        }
    }

    function resolveLocs(gl, info) {
        const g = n => O.getUniformLocation.call(gl, info.prog, n);
        const L = { l1: U1.map(g), l3: U3.map(g), cam: g('uCam'), lvp: g('uLVP'), shp: g('uShadowP'), son: g('uShadowOn') };
        const sm = g('uShadowMap'), ct = g('uClsTex');
        if (sm) O.uniform1i.call(gl, sm, 6);
        if (ct) O.uniform1i.call(gl, ct, 7);
        info.c1 = new Float64Array(U1.length).fill(NaN);
        info.c3 = new Float64Array(U3.length * 3).fill(NaN);
        info.cc = new Float64Array(3).fill(NaN);
        info.cshp = new Float64Array(4).fill(NaN);
        info.clvp = new Float32Array(16).fill(NaN);
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
        if (L.lvp !== null) {
            const m = ST.lvp, k = info.clvp;
            let diff = false;
            for (let i = 0; i < 16; i++) if (k[i] !== m[i]) { diff = true; break; }
            if (diff) { k.set(m); O.uniformMatrix4fv.call(gl, L.lvp, false, m); }
        }
        if (L.shp !== null) {
            const SH = G.sh, s = info.cshp, sz = SH.size, tx = 2 * SH.E / sz;
            if (s[0] !== sz || s[2] !== tx || s[3] !== SH.Z) {
                s[0] = sz; s[1] = 1 / sz; s[2] = tx; s[3] = SH.Z;
                O.uniform4f.call(gl, L.shp, sz, 1 / sz, tx, SH.Z);
            }
        }
    }

    // Effects paused: vanilla output (uFx = 0), with our samplers still on their own units so a program
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
        if (ERR.off) { offProgram(gl, info); return; }
        if (info.terrain) OBS.lit = !!info.lit;
        try { applyUniforms(gl, info); } catch (e) { hookError('applyUniforms', e); }
    };

    function resizeShadow(gl, size) {
        const prev = gl.getParameter(gl.ACTIVE_TEXTURE);
        try {
            gl.activeTexture(gl.TEXTURE6);
            gl.bindTexture(gl.TEXTURE_2D, G.depthTex);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT16, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);
        } finally {
            gl.activeTexture(prev);
        }
        G.texSize = size; G.checkFbo = true;
    }

    function drawShadowSet(gl, P, cut, now) {
        const SH = G.sh, c0 = SH.c0;
        let n = 0, bound = false;
        for (const e of rec.values()) {
            if (e.cut !== cut) continue;
            // Casters out of view (behind the camera) still cast, however long ago they were drawn: the
            // game deletes a dropped chunk's VAO and trackColumn drops emptied parts, so expiry only
            // forgets records outside the map's area (a leak guard).
            if (!inFootprint(e)) { if (now - e.seen > 60000) forget(e); continue; }
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
        const SH = G.sh, size = SH.size;
        const prevFB = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
        const vp = gl.getParameter(gl.VIEWPORT);
        const wasCull = gl.isEnabled(gl.CULL_FACE), wasDepth = gl.isEnabled(gl.DEPTH_TEST);
        const wasPO = gl.isEnabled(gl.POLYGON_OFFSET_FILL), wasScissor = gl.isEnabled(gl.SCISSOR_TEST);
        const prevVAO = curVAO;
        try {
            if (G.texSize !== size) {
                try { resizeShadow(gl, size); } catch (e) { G.allocFailed = size; throw e; }
            }
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, G.fbo);
            if (G.checkFbo) {
                G.checkFbo = false;
                const st = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);
                if (st !== gl.FRAMEBUFFER_COMPLETE) { G.allocFailed = size; throw new Error('shadow framebuffer incomplete at ' + size + ': ' + st); }
            }
            gl.viewport(0, 0, size, size);
            if (SH.cull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
            if (wasScissor) gl.disable(gl.SCISSOR_TEST);
            if (!wasDepth) gl.enable(gl.DEPTH_TEST);
            gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
            gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(2.0, 1.0);
            O.clear.call(gl, gl.DEPTH_BUFFER_BIT);

            lightMat(SCRATCH, SH.c0);
            const now = ST.ms;
            const n = drawShadowSet(gl, G.pOpaque, 0, now) + drawShadowSet(gl, G.pCut, 1, now);
            STATS.shadowChunks = n;
            STATS.refreshes++;
            const w = WHY[ST.why]; if (w) STATS.why[w]++;
            SH.drawn = true;
        } finally {
            O.useProgram.call(gl, info.prog);
            O.bindVertexArray.call(gl, prevVAO);
            gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, prevFB);
            gl.viewport(vp[0], vp[1], vp[2], vp[3]);
            gl.polygonOffset(0, 0);
            if (!wasPO) gl.disable(gl.POLYGON_OFFSET_FILL);
            if (wasCull) gl.enable(gl.CULL_FACE); else gl.disable(gl.CULL_FACE);
            if (!wasDepth) gl.disable(gl.DEPTH_TEST);
            if (wasScissor) gl.enable(gl.SCISSOR_TEST);
            gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
        }
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
            if (s !== null && s !== e && prevFrame >= 0 && s.frame < prevFrame) { if (inFootprint(s)) G.dirty = true; forget(s); }
        } else {
            col.p1 = e;
            const s = col.p0;
            if (s !== null && s !== e && s.frame !== frameId) { if (inFootprint(s)) G.dirty = true; forget(s); }
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
            if (changed && !G.dirty && inFootprint(e)) G.dirty = true;
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
        try {
            const keys = [];
            for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tc.shader.')) keys.push(k); }
            for (const k of keys) localStorage.removeItem(k);
        } catch (e) {}
        apply();
    }

    function debug() {
        const r = a => a && Array.from(a).map(x => +Number(x).toFixed(3));
        const out = {
            version: VERSION, frameId, dim: ST.dim, day: +ST.day.toFixed(3), sun: r(ST.sun), cam: r(ST.cam),
            camSeen: OBS.camOk, sunSeenFrame: OBS.sunFrame, skyFrame: OBS.topFrame, litProgram: OBS.lit,
            ambient: OBS.amb, skyLight: r(OBS.sl), shadowOn: ST.shadowOn, shadowChunks: STATS.shadowChunks,
            refreshes: STATS.refreshes, refreshWhy: Object.assign({}, STATS.why), shadowMap: G.texSize,
            records: rec.size, errors: ERR.n, paused: ERR.off,
            preset: { quality: currentPreset('quality'), look: currentPreset('look') },
            layers: ATL.n, animated: ATL.anim.size, names: ATL.names ? ATL.names.reduce((a, n, i) => { const c = layerClass(i); if (c) (a[['', 'leaves', 'plants', 'water', 'emissive'][c]] ||= []).push(n); return a; }, {}) : null, classes: { leaves: CLS_COUNTS[1], plants: CLS_COUNTS[2], water: CLS_COUNTS[3], emissive: CLS_COUNTS[4] }
        };
        console.log(out);
        return out;
    }
    window.Twitterentary = {
        cfg: CFG, schema: SCHEMA, defaults: DEFAULTS, presets: PRESETS, version: VERSION,
        state: ST, stats: STATS, shadow: G.sh, obs: OBS,
        set, apply, applyPreset, currentPreset, reset, debug
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
        if (e.code !== 'KeyK' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.__tcCaptured || (window.__tcOptions && window.__tcOptions.capturing)) return;
        const t = e.target;
        if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
        set('enabled', !CFG.enabled);
        console.info(TAG, 'Shaders ' + (CFG.enabled ? 'ON' : 'OFF'));
        notify('Twitterentary shaders: ' + (CFG.enabled ? 'ON' : 'OFF'));
    }, true);

    console.info(TAG, 'Twitterentary v' + VERSION + ' loaded. Press K to toggle shaders. Config: Twitterentary.cfg | Presets: Twitterentary.presets | Diagnostics: Twitterentary.debug()');
})();
