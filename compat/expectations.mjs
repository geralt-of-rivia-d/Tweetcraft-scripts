// What each userscript depends on in the game.
//
//   source   - checked by `npm run check` against the latest snapshot (offline, fast).
//              { file, test: 'substring' | /regex/ } or { file, exports: [...] }
//              file 'shaders:vs' / 'shaders:fs' = all vertex / fragment shaders the game linked at
//              startup (captured by the snapshot). Use these for GLSL: gfx.js builds some lines from
//              template pieces, so the final GLSL only exists at runtime.
//   runtime  - checked by `npm run smoke` inside the live game, after the scripts load.
//              run() executes in the page; return true, or a string explaining the failure.
//              `__tcwait(fn, ms)` is available there: polls fn until truthy (returns true) or times out (false).
//   shaders  - checked by `npm run smoke`: how many linked programs of a kind contain a marker
//              in their final (patched) source. `min` is the count observed when it last worked.
//
// `script` is a file name or an array of file names; entries only run when that script is loaded.
// `known: 'reason'` marks a known bug: reported, but it does not fail the run. Remove it once fixed.
//
// When you add or change a hook in a script, add or update its entries here.

const SHADERS = 'twitterentary-shaders.user.js';
const OPTIONS = 'tweetcraft-better-options.js';
const ZOOM = 'tweetcraft-zoom.user.js';
const CHAT = 'tweetcraft-chat-history.js';

// Every game module that uses the main WebGL2 context (gfx.gl). The shaders script's shadow pass and uniforms
// share that context's state with all of them. dragonview.js is not listed: it renders on its own canvas and
// context. When the game adds a module that draws, add it here.
const MAIN_GL = ['js/gfx.js', 'js/entities/index.js', 'js/entities/debug.js', 'js/signs.js', 'js/fireflies.js',
  'js/survival/chesticons.js', 'js/survival/chestlabels.js', 'js/survival/crack.js', 'js/survival/enchantfx.js', 'js/survival/grace.js'];
// Every game module that handles keys (keydown/keyup listeners, e.code tests or key(e) handlers). A key our scripts
// bind by default must not appear in any of them.
const KEY_MODULES = ['js/main.js', 'js/menus.js', 'js/ui.js', 'js/inventory.js', 'js/chat-suggest.js', 'js/chat-toggle.js',
  'js/country-mark.js', 'js/i18n.js', 'js/lang-select.js', 'js/music.js', 'js/net.js', 'js/signs.js', 'js/skin-editor.js',
  'js/skin-preview.js', 'js/sojo-identity.js', 'js/sound.js', 'js/voice.js', 'js/wardrobe.js', 'js/wl-suggest.js',
  'js/survival/anvil.js', 'js/survival/book.js', 'js/survival/chestlabels.js', 'js/survival/end.js',
  'js/survival/onboarding.js', 'js/survival/screens.js'];
const R = String.raw;
const TRUE = '(?:true|!0)', FALSE = '(?:false|!1)', BOOL = '(?:true|false|!0|!1)'; // literal booleans, minified or not
// Where a class method's body ends: "}" followed by the next method header "name(args) {".
const METHOD_END = R`\}\s*(?!(?:if|for|while|switch|catch|else)\b)\w+\([\w,\s=]*\)\s*\{`;
// Texture units 6 and up are never used: no TEXTURE6+ constant, no TEXTURE0 + computed unit (only + 0-5),
// no sampler set to 6+ by uniform1i or a { uName: n } sampler map.
const FREE_UNITS = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\bTEXTURE0\s*\+(?!\s*[0-5]\b))(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})/;
// entities/index.js computes its unit in one helper, texture(gl, unit, ...): allowed there, if every call passes 0-5.
const FREE_UNITS_ENTITIES = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})(?=[\s\S]*\bfunction\s+(\w+)\(\s*(\w+)\s*,\s*(\w+)\s*,[^)]*\)\s*\{[^}]*?\.activeTexture\(\s*\2\.TEXTURE0\s*\+\s*\3\s*\))(?![\s\S]*\bTEXTURE0\s*\+(?!\s*(?:\3|[0-5])\b))(?![\s\S]*(?<!function\s+)\b\1\(\s*\2\s*,(?!\s*[0-5]\s*,))/;
// No enable(POLYGON_OFFSET_FILL) reaches a draw call without its own polygonOffset() (right before or after the enable).
const OWN_POLYGON_OFFSET = /^(?![\s\S]*?\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\)(?<!\.polygonOffset\([^)]*\)\s*;\s*\w+\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\))(?:(?!\.polygonOffset\(|\.draw(?:Elements|Arrays)\w*\()[\s\S])*?\.draw(?:Elements|Arrays)\w*\()/;
// No render-to-texture and no colour clear (gfx.js, which owns the frame's clear, has its own entry).
const NO_FBO_NO_CLEAR = /^(?![\s\S]*\.bindFramebuffer\()(?![\s\S]*\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/;
// Shaders 1.5 scene FBO: what every main-context module must leave alone for the frame to render into our FBO and be
// composited. No render targets of its own and no scissor or stencil test (the FBO has colour + depth only). No
// viewport outside gfx.js (whose one call is the frame's, anchored separately), no depth-only clear outside gfx.js
// (drawHeld's is the only one), and no readPixels. entities/debug.js, a draw benchmark main.js imports only in TEST
// mode and runs outside the frame, may readPixels and clear depth. Every colorMask() takes literal booleans, and each
// one with a false is put back to (true, true, true, true) before the next colorMask, so colour writes are on when
// the composite draws.
const RTT_CALLS = ['bindFramebuffer', 'createFramebuffer', 'bindRenderbuffer', 'createRenderbuffer', 'framebufferTexture2D',
  'framebufferTextureLayer', 'framebufferRenderbuffer', 'blitFramebuffer', 'drawBuffers', 'readBuffer', 'invalidateFramebuffer', 'scissor'];
const SCENE_FBO_SAFE = file => new RegExp('^' +
  R`(?![\s\S]*\.(?:${[...RTT_CALLS, ...(file === 'js/gfx.js' ? [] : ['viewport']), ...(file === 'js/entities/debug.js' ? [] : ['readPixels'])].join('|')})\()` +
  R`(?![\s\S]*\b(?:SCISSOR|STENCIL)_TEST\b)` +
  (file === 'js/gfx.js' || file === 'js/entities/debug.js' ? '' : R`(?![\s\S]*\.clear\([^)]*\bDEPTH_BUFFER_BIT\b)`) +
  R`(?![\s\S]*\.colorMask\((?!\s*${BOOL}\s*,\s*${BOOL}\s*,\s*${BOOL}\s*,\s*${BOOL}\s*\)))` +
  R`(?![\s\S]*?\.colorMask\([^)]*\b${FALSE}[^)]*\)(?!(?:(?!\.colorMask\()[\s\S]){0,1500}?\.colorMask\(\s*${TRUE}\s*,\s*${TRUE}\s*,\s*${TRUE}\s*,\s*${TRUE}\s*\)))`);
// No blend factor reads destination alpha. The scene FBO is RGBA8 with a real alpha channel, the canvas is alpha:false
// (alpha reads as 1), so DST_ALPHA blending would look different through the FBO. (BLEND_DST_ALPHA, the getParameter
// name crack/grace save and restore, is not matched: no word boundary before DST.)
const NO_DST_ALPHA = /^(?![\s\S]*\b(?:DST_ALPHA|ONE_MINUS_DST_ALPHA|SRC_ALPHA_SATURATE)\b)/;
// The performance overlay key (Better Options' tc.perfOverlay keybind): no "F2" string, .F2 property or keyCode 113.
const NOT_F2 = /^(?![\s\S]*["'`]F2["'`])(?![\s\S]*\.F2\b)(?![\s\S]*\b(?:keyCode|which)\s*===?\s*113\b)/;
// A GLSL float literal with the value x in any spelling: FL('0.50') matches 0.5, 0.50, .5; FL('1.0') matches 1.0, 1.
const FL = x => { const [i, f = ''] = x.split('.'); return (i === '0' ? '0?' : i) + R`\.` + f.replace(/0+$/, '') + '0*(?![0-9])'; };
// The game's whole lightmap() curve (lit terrain FS), statement by statement. `k` makes the group names unique.
const LIGHTMAP_PARTS = k => [
  R`float\s+bright\s*\(\s*float\s+(?<l${k}>\w+)\s*\)\s*\{\s*return\s+mix\(\s*\k<l${k}>\s*\/\s*\(\s*${FL('60.0')}\s*-\s*${FL('3.0')}\s*\*\s*\k<l${k}>\s*\)\s*,\s*${FL('1.0')}\s*,\s*uAmbient\s*\)\s*;\s*\}\s*`,
  R`vec3\s+lightmap\s*\(\s*vec2\s+(?<v${k}>\w+)\s*\)\s*\{\s*`,
  R`float\s+(?<b${k}>\w+)\s*=\s*bright\(\s*\k<v${k}>\.y\s*\)\s*\*\s*${FL('1.5')}\s*;\s*`,
  R`vec3\s+(?<c${k}>\w+)\s*=\s*clamp\(\s*mix\(\s*vec3\(\s*\k<b${k}>\s*,\s*\k<b${k}>\s*\*\s*\(\s*\(\s*\k<b${k}>\s*\*\s*${FL('0.6')}\s*\+\s*${FL('0.4')}\s*\)\s*\*\s*${FL('0.6')}\s*\+\s*${FL('0.4')}\s*\)\s*,\s*\k<b${k}>\s*\*\s*\(\s*\k<b${k}>\s*\*\s*\k<b${k}>\s*\*\s*${FL('0.6')}\s*\+\s*${FL('0.4')}\s*\)\s*\)\s*\+\s*uSkyLight\s*\*\s*bright\(\s*\k<v${k}>\.x\s*\)\s*,\s*vec3\(\s*${FL('0.75')}\s*\)\s*,\s*${FL('0.04')}\s*\)\s*,\s*${FL('0.0')}\s*,\s*${FL('1.0')}\s*\)\s*;\s*`,
  R`vec3\s+(?<e${k}>\w+)\s*=\s*${FL('1.0')}\s*-\s*\k<c${k}>\s*;\s*`,
  R`return\s+clamp\(\s*mix\(\s*mix\(\s*\k<c${k}>\s*,\s*${FL('1.0')}\s*-\s*\k<e${k}>\s*\*\s*\k<e${k}>\s*\*\s*\k<e${k}>\s*\*\s*\k<e${k}>\s*,\s*${FL('0.50')}\s*\)\s*,\s*vec3\(\s*${FL('0.75')}\s*\)\s*,\s*${FL('0.04')}\s*\)\s*,\s*${FL('0.0')}\s*,\s*${FL('1.0')}\s*\)\s*;\s*\}`,
];
// At least one shader has bright() + lightmap() exactly so, and no shader defines either one any other way.
const LIGHTMAP = new RegExp('^' + R`(?=[\s\S]*?${LIGHTMAP_PARTS('a').join('')})` +
  R`(?![\s\S]*?\bvec3\s+lightmap\s*\(\s*vec2\s+(?<vz>\w+)\s*\)\s*\{(?!\s*${LIGHTMAP_PARTS('z').slice(2).join('')}))` +
  R`(?![\s\S]*?\bfloat\s+bright\s*\((?!${LIGHTMAP_PARTS('y')[0].slice('float\\s+bright\\s*\\('.length)}))`);

export const source = [
  // --- Twitterentary shaders: GLSL anchors used by patchSource() and the patch* functions
  { script: SHADERS, file: 'shaders:vs', test: /aPos\s*&\s*uvec3/, why: 'terrain vertex shader is recognised by "aPos & uvec3"' },
  { script: SHADERS, file: 'shaders:vs', test: 'uniform vec3 uOrigin;', why: 'terrain VS: extra uniforms are inserted after uOrigin' },
  { script: SHADERS, file: 'shaders:vs', test: 'out vec2 vLight;', why: 'terrain VS: our single vTcP varying (position + layer class) is added after vLight' },
  { script: SHADERS, file: 'shaders:vs', test: /vec3\s+p\s*=\s*vec3\(\s*aPos\s*&\s*uvec3\(\s*0x1FFu\s*,\s*0xFFFu\s*,\s*0x1FFu\s*\)\s*\)\s*\*\s*0\.0625\s*\+\s*uOrigin\s*;/, why: 'terrain VS: waving code is injected after the vertex position decode' },
  { script: SHADERS, file: 'shaders:fs', test: /o\s*=\s*vec4\(\s*mix\(\s*c\.rgb\s*\*\s*vShade(\s*\*\s*lightmap\(\s*vLight\s*\))?\s*,\s*uFog\s*,\s*f\s*\)\s*,\s*([^;]*?)\s*\)\s*;/, why: 'terrain FS: the final colour line is replaced by the shaded version' },
  { script: SHADERS, file: 'shaders:fs', test: /vec4\s+c\s*=\s*texture\(\s*uTex\s*,\s*vUV\s*\)\s*;/, why: 'terrain FS: derivatives are taken right after the texture fetch' },
  { script: SHADERS, file: 'shaders:fs', test: /uniform\s+vec3\s+uTop\s*,\s*uHor\s*;/, why: 'sky shader is recognised by "uniform vec3 uTop, uHor;"' },
  { script: SHADERS, file: 'shaders:fs', test: /o\s*=\s*vec4\(\s*c\s*,\s*1\.0\s*\)\s*;|o\s*=\s*vec4\(\s*mix\(\s*uHor\s*,\s*uTop\s*,\s*sqrt\(\s*t\s*\)\s*\)\s*,\s*1\.0\s*\)\s*;/, why: 'sky FS: the output line that gets replaced' },
  { script: SHADERS, file: 'shaders:fs', test: 'uniform vec4 uTint, uHole;', why: 'cloud shader is recognised by "uniform vec4 uTint, uHole;"' },
  { script: SHADERS, file: 'shaders:fs', test: /if\s*\(\s*c\.a\s*<\s*0\.02\s*\)\s*discard\s*;/, why: 'cloud FS: the tint goes after the alpha discard' },
  { script: SHADERS, file: 'js/main.js', test: /\.indexOf\(\s*["']oak_planks["']\s*\)/, why: 'the texture-name list (atlas layer order) is captured by hooking Array.prototype.indexOf("oak_planks") in boot()' },
  // GLSL: what patchSource() and the patch* functions need, beyond the replaced lines above.
  // `#version 300 es(?=[^#]*A)(?=[^#]*B)` = A and B occur in the same shader (each one starts with #version).
  { script: SHADERS, file: 'shaders:fs', test: /#version 300 es(?=[^#]*sampler2DArray)(?=[^#]*vShade)(?=[^#]*uFog)(?=[^#]*vDist)/, why: 'terrain FS is recognised by #version 300 es + sampler2DArray + vShade + uFog + vDist in one shader' },
  { script: SHADERS, file: 'shaders:vs', test: /#version 300 es(?=[^#]*layout\s*\(\s*location\s*=\s*0\s*\)\s*in\s+uvec3\s+aPos\s*;)(?=[^#]*layout\s*\(\s*location\s*=\s*1\s*\)\s*in\s+uvec2\s+aInfo\s*;)/, why: 'the shadow-map program draws the terrain VAOs, so it needs aPos at location 0 and aInfo at location 1' },
  { script: SHADERS, file: 'shaders:vs', test: /uint\s+(\w+)\s*=\s*aInfo\.y\s*;[^#]*?vUV\s*=\s*vec3\(\s*float\(\s*\1\s*&\s*1u\s*\)\s*,\s*float\(\s*\(\s*\1\s*>>\s*1u\s*\)\s*&\s*1u\s*\)\s*,\s*float\(\s*aInfo\.x\s*\)\s*\)|vUV\s*=\s*vec3\(\s*float\(\s*aInfo\.y\s*&\s*1u\s*\)\s*,\s*float\(\s*\(\s*aInfo\.y\s*>>\s*1u\s*\)\s*&\s*1u\s*\)\s*,\s*float\(\s*aInfo\.x\s*\)\s*\)/, why: 'aInfo.x is the atlas layer (class lookup) and bits 0/1 of aInfo.y the tile UV: waving pins the plant base (v=1), the shadow VS copies this decode' },
  { script: SHADERS, file: 'shaders:fs', test: /#version 300 es(?=[^#]*uniform\s+float\s+uAmbient\s*;)(?=[^#]*uniform\s+vec3\s+uSkyLight\s*;)(?=[^#]*vec3\s+lightmap\s*\(\s*vec2\s+\w+\s*\))/, why: 'lit terrain FS: the shaded code calls lightmap(vec2) and uses uAmbient; uAmbient/uSkyLight uploads are watched for Nether/End' },
  { script: SHADERS, file: 'shaders:fs', test: /#version 300 es(?=[^#]*\/\s*\(\s*60\.0\s*-\s*3\.0\s*\*\s*\w+\s*\))(?=[^#]*bright\(\s*\w+\.y\s*\)\s*\*\s*1\.5)(?=[^#]*uSkyLight\s*\*\s*bright\(\s*\w+\.x\s*\))/, why: 'lit terrain FS: vLight.x is sky light and vLight.y block light, both 0-15 (l/(60-3l) curve); the shaded code divides them by 15' },
  { script: SHADERS, file: 'shaders:fs', test: LIGHTMAP, why: 'the game\'s whole light curve, bright(l) = mix(l / (60 - 3l), 1, uAmbient) and lightmap(l) (block light b = bright(l.y) * 1.5 with its warm polynomial tint, + uSkyLight * bright(l.x), the vec3(0.75)/0.04 mixes, the 0.50 gamma mix): the 1.5 lit terrain FS calls the game\'s own lightmap() for its block-light term (lightmap(vec2(0, vLight.y)) - uTcLm0), and the script computes uTcLm0 = lightmap(vec2(0)) on the CPU from the observed uAmbient/uSkyLight with the same curve, so any change to the game\'s curve, in any lit shader, must be copied into that CPU term' },
  { script: SHADERS, file: 'shaders:fs', test: /#version 300 es(?=[^#]*uniform\s+vec3\s+uTop\s*,\s*uHor\s*;)(?=[^#]*vDir)(?=[^#]*out\s+vec4\s+o\s*;)/, why: 'sky FS: patchSky needs vDir and inserts its uniforms after "out vec4 o;"' },
  { script: SHADERS, file: 'shaders:fs', test: /#version 300 es(?=[^#]*uniform vec4 uTint, uHole;)(?=[^#]*uniform\s+int\s+uKind\s*;)(?=[^#]*uKind\s*==\s*1\b)/, why: 'cloud FS: patchCloud declares its uniforms after "uniform int uKind;" and tints only uKind == 1 (the cloud layer)' },
  { script: SHADERS, file: 'shaders:vs', test: /#version 300 es(?=[^#]*uniform\s+vec3\s+uCam\s*;)(?=[^#]*\buSize\b)/, why: 'the camera position is read from uCam of the program that also has uSize (the cloud/water plane)' },
  { script: SHADERS, file: 'shaders:vs', test: /uniform\s+vec3\s+uC\s*[,;]/, why: 'the sun direction is read from the sprite shader\'s uC' },
  // JS side of the GL hooks (gfx.js)
  { script: SHADERS, file: 'js/gfx.js', test: /\.getActiveUniform\(\s*\w+\s*,\s*\w+\s*\)\.name\s*;\s*\w+\[\s*\w+\s*\]\s*=\s*\w+\.getUniformLocation\(/, why: 'every active uniform is looked up by name with getUniformLocation, where uOrigin/uCam/uTop/uC/uAmbient/uSkyLight are tagged' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.uniform3f\(\s*\w+\.u\.uOrigin\s*,\s*\w+\.cx\s*\*\s*16\s*-\s*\w+\[0\]\s*,\s*-\s*\w+\[1\]\s*,\s*\w+\.cz\s*\*\s*16\s*-\s*\w+\[2\]\s*\)/, why: 'chunks get a camera-relative uOrigin (chunk*16 - cam) via uniform3f: the camera fix-up and shadow pass place chunks with it' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.bindVertexArray\(\s*\w+\.vao\s*\)\s*;\s*\w+\.drawElements\(\s*\w+\.TRIANGLES\s*,[^,]+,\s*\w+\.UNSIGNED_INT\s*,\s*0\s*\)/, why: 'one bindVertexArray + drawElements(TRIANGLES, n, UNSIGNED_INT, 0) per chunk: the shadow pass replays exactly that' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.uniform3fv\(\s*[\w.]+\.uTop\s*,/, why: 'the sky colour (day factor, sun detection) is read from uTop, which only the uniform3fv hook watches' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.uniform3fv\(\s*[\w.]+\.uTop\s*,(?:(?!\.uC\b)[\s\S]){0,1500}?\.uniform3fv?\(\s*\w+\.uC\s*,(?:(?!\.uC\b)[\s\S]){0,400}?this\.tSun\b/, why: 'unlit sky: the first uC uploaded after uTop is the sun sprite\'s' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.uniform3fv\(\s*[\w.]+\.uTop\s*,(?:(?!\.uC\b)[\s\S]){0,1500}?this\.sprite\(\s*this\.tSun\b/, why: 'lit sky: the sun sprite is drawn after the sky before any other uC upload' },
  { script: SHADERS, file: 'js/gfx.js', test: /\b(\w+)\s*=\s*this\.pPlane\.u\b[\s\S]{0,300}?\.uniform3fv?\(\s*\1\.uCam\s*,/, why: 'the cloud/water plane uploads the world camera position to uCam' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?=[\s\S]*\.uniform3fv\(\s*\w+\.u\.uSkyLight\s*,)(?=[\s\S]*\.uniform1f\(\s*\w+\.u\.uAmbient\s*,)/, why: 'uSkyLight is uploaded with uniform3fv and uAmbient with uniform1f, the only hooks that read them' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bend\s*:\s*\{[^}]*skyLight\s*:\s*\[\s*0?\.055\s*,\s*0?\.07\s*,\s*0?\.0625\s*\]/, why: 'isEnd() recognises the End by uSkyLight = (0.055, 0.07, 0.0625)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.ambient\s*=\s*\w+\s*===\s*["']nether["']\s*\?\s*0?\.1\s*:\s*0\b/, why: 'the Nether is recognised by uAmbient > 0.05 (the game uses 0.1 there, 0 elsewhere)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.texImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*0\s*,\s*\w+\.RGBA8\s*,\s*16\s*,\s*16\s*,\s*\w+\s*,\s*0\s*,\s*\w+\.RGBA\s*,\s*\w+\.UNSIGNED_BYTE\s*,\s*\w+\s*\)/, why: 'the atlas is read from texImage3D(TEXTURE_2D_ARRAY, 0, RGBA8, 16, 16, n, ..., pixels at argument 9)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.texSubImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*\w+\s*,\s*0\s*,\s*0\s*,\s*\w+\s*,/, why: 'animated layers are detected by texSubImage3D(TEXTURE_2D_ARRAY, level, 0, 0, layer, ...)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.activeTexture\(\s*\w+\.TEXTURE0\s*\)\s*;\s*\w+\.bindTexture\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*this\.tArr\s*\)\s*;(?:(?!\.(?:activeTexture|bindTexture)\()[\s\S]){0,300}?\.pass\(\s*\w+\[\s*0\s*\]/, why: 'the atlas is bound on texture unit 0 (TEXTURE0 active) right before the first terrain pass, where the shadow pass runs: the cutout shadow FS samples uTex = 0' },
  // GL state at the frame's first terrain draw. renderShadow() runs inside it and restores this state without
  // querying it (queries are GPU round trips), so the game must really have set exactly this.
  { script: SHADERS, file: 'js/gfx.js', test: /\.depthFunc\(\s*\w+\.LEQUAL\s*\)\s*;\s*\w+\.enable\(\s*\w+\.CULL_FACE\s*\)\s*;\s*\w+\.disable\(\s*\w+\.BLEND\s*\)(?:(?!\.(?:depthFunc|depthMask|enable|disable|blendFunc|cullFace|frontFace|colorMask)\()[\s\S]){0,1500}?\.pass\(\s*\w+\[\s*0\s*\]/, why: 'render() sets depthFunc(LEQUAL), CULL_FACE on and BLEND off, then changes no state before pass(pt[0]): the shadow pass restores LEQUAL and culling without querying and leaves BLEND alone' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?=[\s\S]*\.depthMask\(\s*true\s*\)(?:(?!\.depthMask\(\s*false\b)[\s\S]){0,3000}?\.depthFunc\(\s*\w+\.LEQUAL\s*\)\s*;\s*\w+\.enable\(\s*\w+\.CULL_FACE\s*\))(?=[\s\S]*\bdrawSky\(\s*\w+\s*\)\s*\{(?:(?!\}\s*(?!(?:if|for|while|switch|catch)\b)\w+\([\w,\s]*\)\s*\{)[\s\S])*?\.depthMask\(\s*true\s*\)\s*;?\s*\}\s*\w+\s*\()(?=[\s\S]*\bdrawSkyLit\(\s*\w+\s*,\s*\w+\s*\)\s*\{(?:(?!\}\s*(?!(?:if|for|while|switch|catch)\b)\w+\([\w,\s]*\)\s*\{)[\s\S])*?\.depthMask\(\s*true\s*\)\s*;?\s*\}\s*\w+\s*\()/, why: 'depthMask is true at the first terrain draw: render() sets it before the sky, and drawSky()/drawSkyLit() end with depthMask(true); the shadow pass restores true without querying' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.frontFace\()(?![\s\S]*\.cullFace\(\s*\w+\.FRONT(?:_AND_BACK)?\s*\)(?![\s\S]{0,2000}?\.cullFace\(\s*\w+\.BACK\s*\)))/, why: 'the shadow pass culls back faces with the default cullFace(BACK) / frontFace(CCW): the game never calls frontFace, and its one cullFace(FRONT) (the glow draw) is put back to BACK' },
  // How the game draws and drops chunk parts (the shadow records follow these)
  { script: SHADERS, file: 'js/gfx.js', test: /\bpass\(\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*,[^)]*\)\s*\{[\s\S]{0,800}?for\s*\(\s*const\s+(\w+)\s+of\s+\1\s*\)\s*\{\s*const\s+(\w+)\s*=\s*\3\.parts\[\s*\2\s*\]\s*;\s*if\s*\(\s*!\4\s*\|\|\s*!\4\.n\s*\)\s*continue\s*;[^}]*?\.bindVertexArray\(\s*\4\.vao\s*\)\s*;\s*\w+\.drawElements\(\s*\w+\.TRIANGLES\s*,\s*\4\.n\s*\*\s*6\s*,\s*\w+\.UNSIGNED_INT\s*,\s*0\s*\)\s*;?\s*\}\s*\w+\.bindVertexArray\(\s*null\s*\)/, why: 'pass() skips a chunk part whose mesh is empty (!q.n) and otherwise draws drawElements(TRIANGLES, q.n * 6, UNSIGNED_INT, 0) from q.vao, then unbinds the VAO: an empty part is simply not drawn, which is how the shadow records notice it, and the remesh hook\'s q.n * 6 index count (from bufferData) is exactly what pass() would draw' },
  // Exact remesh tracking (1.5, codemap #51): the bindBuffer/bufferData hooks map a part's VBO to its VAO and give
  // its shadow record the new index count on every upload, drawn or not
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`\bsetChunk\([^)]*\)\s*\{(?:(?!${METHOD_END})[\s\S])*?\bif\s*\(\s*!(\w+)\s*\)\s*\{\s*\1\s*=\s*\w+\.parts\[\s*\w+\s*\]\s*=\s*\{\s*vao\s*:\s*(\w+)\.createVertexArray\(\)\s*,\s*vbo\s*:\s*\2\.createBuffer\(\)\s*,\s*n\s*:\s*0\s*\}\s*;\s*\2\.bindVertexArray\(\s*\1\.vao\s*\)\s*;\s*\2\.bindBuffer\(\s*\2\.ARRAY_BUFFER\s*,\s*\1\.vbo\s*\)\s*;(?:(?!\.bindVertexArray\(|\.bindBuffer\(\s*\w+\.ARRAY_BUFFER\b|\.bufferData\()[^{}])*?\.bindBuffer\(\s*\2\.ELEMENT_ARRAY_BUFFER\s*,\s*this\.ibo\s*\)\s*;\s*\2\.bindVertexArray\(\s*null\s*\)\s*;?\s*\}`), why: 'setChunk() creates a part as { vao, vbo: createBuffer(), n: 0 } and binds its new VBO first while its own VAO is bound (bindVertexArray(p.vao); bindBuffer(ARRAY_BUFFER, p.vbo)), with the shared this.ibo, then unbinds the VAO: the bindBuffer hook maps that VBO to that VAO on this first bind (first bind wins), so later uploads find the part\'s shadow record' },
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`\bsetChunk\([^)]*\)\s*\{(?:(?!${METHOD_END})[\s\S])*?\bconst\s+(\w+)\s*=\s*\w+\[\s*(\w+)\s*\]\s*;\s*let\s+(\w+)\s*=\s*\w+\.parts\[\s*\2\s*\]\s*;[\s\S]*?\}\s*(\w+)\.bindBuffer\(\s*\4\.ARRAY_BUFFER\s*,\s*\3\.vbo\s*\)\s*;\s*\4\.bufferData\(\s*\4\.ARRAY_BUFFER\s*,\s*\1\s*,\s*\4\.\w+\s*\)\s*;\s*\3\.n\s*=\s*Math\.min\(\s*MAXQ\s*,\s*\1\.byteLength\s*\/\s*32\s*\)\s*;`), why: 'every remesh of a non-empty part is bindBuffer(ARRAY_BUFFER, p.vbo); bufferData(ARRAY_BUFFER, data, ...); p.n = Math.min(MAXQ, data.byteLength / 32): the bufferData hook computes the same quad count (bytes / 32, capped by the index buffer) for the part\'s record, whether or not the part is on screen' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bconst\s+MAXQ\s*=\s*65536\s*;[\s\S]*?\bconst\s+(\w+)\s*=\s*new\s+Uint32Array\(\s*MAXQ\s*\*\s*6\s*\)\s*;[\s\S]{0,400}?\bthis\.ibo\s*=\s*(\w+)\.createBuffer\(\)\s*;\s*\2\.bindBuffer\(\s*\2\.ELEMENT_ARRAY_BUFFER\s*,\s*this\.ibo\s*\)\s*;\s*\2\.bufferData\(\s*\2\.ELEMENT_ARRAY_BUFFER\s*,\s*\1\s*,/, why: 'the shared chunk index buffer is new Uint32Array(MAXQ * 6), MAXQ = 65536, uploaded with bufferData(ELEMENT_ARRAY_BUFFER): the largest index buffer on the main context (the others are small Uint16 ones), so the hook\'s cap (largest ELEMENT_ARRAY_BUFFER upload / 4 bytes) equals the game\'s Math.min(MAXQ, ...) * 6' },
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`\bsetChunk\([^)]*\)\s*\{(?:(?!${METHOD_END})[\s\S])*?\bconst\s+(\w+)\s*=\s*\w+\[\s*(\w+)\s*\]\s*;\s*let\s+(\w+)\s*=\s*\w+\.parts\[\s*\2\s*\]\s*;\s*if\s*\(\s*!\1\s*\)\s*\{\s*if\s*\(\s*\3\s*\)\s*\3\.n\s*=\s*0\s*;\s*continue\s*;?\s*\}`), why: 'KNOWN LIMITATION: a part whose new mesh is empty only gets p.n = 0, with no bufferData, so the remesh hook never sees it and its shadow record keeps the old count. On screen, pass() skips it and the column pairing drops the record; an emptied part that is off screen (e.g. the last blocks of a chunk section mined or exploded behind the player) keeps casting its old shadow until it is seen again or its chunk is dropped. If the game ever uploads empty meshes or deletes the part instead, revisit the hook' },
  { script: SHADERS, file: 'js/main.js', test: /^(?=(?:(?!\bremesh\b(?!-))[\s\S])*?\bfunction\s+updateChunks\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\}\s*function\s+remesh\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\bgfx\.setChunk\([^;]*;[^}]*\}(?![\s\S]*\bremesh\b(?!-)))(?![\s\S]*\.setChunk\([\s\S]*\.setChunk\()(?![\s\S]*\bupdateChunks\((?:[\s\S]*\bupdateChunks\(){2})(?=[\s\S]*\bfunction\s+frameBody\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bupdateChunks\([^;]*;(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\brender\()(?=[\s\S]*\bfunction\s+render\([^)]*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bgfx\.draw\(\s*\{)/, why: 'gfx.setChunk() is called only from remesh(), remesh only inside updateChunks() (directly or through remeshSched), and updateChunks() only from frameBody(), before render() calls gfx.draw(): every remesh runs between frames, with the VAO the previous frame left bound (null, checked at runtime), never inside a draw' },
  { script: SHADERS, file: 'js/remesh-sched.js', test: /^(?![\s\S]*\b(?:setTimeout|setInterval|requestIdleCallback|requestAnimationFrame|queueMicrotask|await|then)\b)[\s\S]*\btimed\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{[^}]*?\b\1\(\s*\2\s*\)/, why: 'the remesh scheduler calls remesh(ci) synchronously from timed() and defers nothing (no timers, idle callbacks, rAF or await): remeshes happen only inside updateChunks(), at the start of a frame' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.pass\(\s*(\w+)\[\s*0\s*\]\s*,\s*(\w+)\s*,\s*0\s*,[^;]*;\s*this\.pass\(\s*\1\[\s*1\s*\]\s*,\s*\2\s*,\s*1\s*,/, why: 'pass 0 (opaque) and pass 1 (cutout) draw the same visible-chunk list back to back: a column drawn in pass 0 whose pass-1 part is not drawn has an empty part, so its shadow record is dropped' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bdropChunk\(\s*\w+\s*\)\s*\{[\s\S]{0,200}?for\s*\(\s*const\s+(\w+)\s+of\s+\w+\.parts\s*\)\s*if\s*\(\s*\1\s*\)\s*\{\s*this\.gl\.deleteVertexArray\(\s*\1\.vao\s*\)/, why: 'unloading a chunk (dropChunk) deletes its part VAOs: the deleteVertexArray hook drops their shadow records and marks the map dirty' },
  { script: SHADERS, file: 'js/gfx.js', test: /\banimateLayer\(\s*\w+(?:\s*,\s*\w+)*\s*\)\s*\{[\s\S]{0,800}?\.activeTexture\(\s*\w+\.TEXTURE0\s*\)\s*;\s*\w+\.bindTexture\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*this\.tArr\s*\)\s*;(?:(?!\.(?:activeTexture|bindTexture)\()[\s\S]){0,200}?\.texSubImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*\w+\s*,\s*0\s*,\s*0\s*,\s*\w+\s*,/, why: 'atlas animation (water, lava, fire, portals) is texSubImage3D(TEXTURE_2D_ARRAY, level, 0, 0, layer) on the atlas on unit 0, never units 6/7: once block names are known the hook ignores it (no reclassify, no shadow refresh)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.clear\([^)]*\bCOLOR_BUFFER_BIT\b/, why: 'a frame is counted on clear(COLOR_BUFFER_BIT)' },
  // Main-context invariants, checked in every module that uses it (MAIN_GL above)
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: file === 'js/entities/index.js' ? FREE_UNITS_ENTITIES : FREE_UNITS, why: 'texture units 6, 7 and 8 stay free: the shadow map, the class lookup and (1.5) the scene colour texture stay bound there for the whole session' })),
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: OWN_POLYGON_OFFSET, why: 'renderShadow() resets polygonOffset(0, 0) without querying it: every enable(POLYGON_OFFSET_FILL) sets its own offset before drawing (today only survival/chesticons.js)' })),
  ...MAIN_GL.filter(file => file !== 'js/gfx.js').map(file => ({ script: SHADERS, file, test: NO_FBO_NO_CLEAR, why: 'no render-to-texture and no colour clear outside gfx.js: frames are counted on the one colour clear, and the shadow pass restores the default framebuffer state it found' })),
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.bindFramebuffer\()(?=(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){2})(?!(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){3})(?=[\s\S]*\bif\s*\(\s*\w+\.wall\s*\)\s*\{\s*this\.drawWall\([^)]*\)\s*;\s*return\s*;?\s*\}(?:(?!\.clear\()[\s\S]){0,1500}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)(?=[\s\S]*\bdrawWall\([^)]*\)\s*\{[^}]{0,300}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/, why: 'one colour clear per frame on the main context, no render-to-texture: draw() clears once, or hands the frame to drawWall() (which clears) and returns. frameId, the camFrame gate and the blind LEQUAL/depthMask(true) restore all assume this' },
  { script: SHADERS, file: 'js/dragonview.js', test: /\bfunction dragonView\(\s*(\w+)[^)]*\)\s*\{\s*const\s+\w+\s*=\s*\1\.getContext\(\s*["']webgl2["']/, why: 'the dragon view renders on its own canvas and WebGL2 context, so its colour clear is not counted as a frame (only the context that first uses a patched program is)' },
  { script: SHADERS, file: 'js/main.js', test: /loadTiles\(\s*\w+\.texNames\s*\)[\s\S]{0,200}?\.texNames\.indexOf\(\s*["']oak_planks["']\s*\)[\s\S]{0,200}?\.setTiles\(/, why: 'the list searched for "oak_planks" is texNames, the same list that orders the atlas layers passed to setTiles' },
  { script: SHADERS, file: 'engine.wasm', test: /^(?=[\s\S]*oak_leaves)(?=[\s\S]*water_still)(?=[\s\S]*short_grass)(?=[\s\S]*glowstone)/, why: 'layers are classified by texture name (*leaves*, water*, the plant list, the emissive list)' },
  { script: SHADERS, file: 'js/main.js', test: /^(?![\s\S]*["']KeyK["'])/, why: 'K (the shader toggle) is not a game key' },
  // --- Twitterentary shaders 1.5: scene FBO (render scale) and composite. The viewport hook binds our FBO on the
  // frame's one viewport call and forwards a scaled viewport; a microtask queued there draws the FBO to the canvas
  // after the game's rAF callback returns. These are the game facts that pipeline relies on.
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.viewport\([\s\S]*\.viewport\()[\s\S]*(?<!\basync\s+)\bdraw\(\s*(\w+)\s*\)\s*\{(?:(?!\.\w+\()[^{}]){0,200}?\.viewport\(\s*0\s*,\s*0\s*,\s*\1\.w\s*,\s*\1\.h\s*\)/, why: 'Gfx.draw(v) (not async) calls viewport(0, 0, v.w, v.h) before any other method call, and it is gfx.js\'s only viewport: the scene FBO is bound on that call, and every later pass of the frame inherits the scaled viewport we forward' },
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: SCENE_FBO_SAFE(file), why: file === 'js/gfx.js'
    ? 'no render target, scissor or stencil test, readPixels or colorMask left off: the frame renders into our colour + depth scene FBO unchanged, and colour writes are on when the composite draws'
    : file === 'js/entities/debug.js'
      ? 'no viewport, render target, scissor or stencil test, or colorMask left off (this TEST-mode draw benchmark may readPixels and clear depth, outside the frame): what it draws lands in our scene FBO at the scaled viewport'
      : 'no viewport (gfx.js draw() sets the frame\'s only one), render target, scissor or stencil test, depth-only clear, readPixels or colorMask left off: everything this module draws lands in our scene FBO at the scaled viewport' })),
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: NO_DST_ALPHA, why: 'no blend factor reads destination alpha: the scene FBO is RGBA8 with real alpha, the canvas is alpha:false, so DST_ALPHA blending would differ through the FBO' })),
  { script: SHADERS, file: 'js/main.js', test: /^(?![\s\S]*\.(?:viewport|scissor|bindFramebuffer|createFramebuffer|bindRenderbuffer|createRenderbuffer|framebufferTexture2D|blitFramebuffer|readPixels|colorMask)\()(?![\s\S]*\b(?:SCISSOR|STENCIL)_TEST\b)/, why: 'main.js reaches gfx.gl directly (textures, isContextLost, the GPU name) but sets no viewport, render target, scissor/stencil test, readPixels or colorMask: the scene FBO and composite see only gfx.js\'s frame state' },
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`\bclass Gfx\s*\{\s*constructor\(\s*(\w+)\s*\)\s*\{\s*const\s+\w+\s*=\s*\1\.getContext\(\s*["']webgl2["']\s*,\s*\{(?=[^}]*\bantialias\s*:\s*${FALSE}\s*[,}])(?=[^}]*\balpha\s*:\s*${FALSE}\s*[,}])(?=[^}]*\bdepth\s*:\s*${TRUE}\s*[,}])(?![^}]*\b(?:preserveDrawingBuffer|stencil)\s*:\s*(?!${FALSE}\s*[,}]))[^}]*\}\s*\)`), why: 'the main context is created in the Gfx constructor with antialias:false, alpha:false, depth:true and no preserveDrawingBuffer or stencil: an FBO + upscale matches the unscaled image (no MSAA lost), alpha is ignored, our depth texture replaces the default depth buffer, and the composite must land in the same rAF task' },
  { script: SHADERS, file: 'js/main.js', test: /\b(\w+)\s*=\s*[\w$.]+\(\s*["']#gl["']\s*\)[\s\S]*?\bconst\s+(\w+)\s*=\s*\1\.width\s*,\s*(\w+)\s*=\s*\1\.height\b[\s\S]{0,4000}?\.draw\(\s*\{[^}]*?\bw\s*:\s*\2\s*,\s*h\s*:\s*\3\b/, why: 'the frame is drawn at the #gl canvas size, gfx.draw({w: glCanvas.width, h: glCanvas.height}): the frame viewport is the whole canvas, and the scene FBO follows canvas.width/height read at that viewport (resize, .pix menus, regainCanvases)' },
  { script: SHADERS, file: 'js/main.js', test: /\.draw\(\s*\{[^}]*?\bw\s*:\s*\w+\s*,\s*h\s*:(?:(?!\bawait\b)[\s\S]){0,800}?\}\s*\)\s*;\s*if\s*\(\s*(\w+)\s*&&\s*!\w+\s*\)\s*\{\s*\1\.drawCrack\([^;]*;(?:(?!\bawait\b)[\s\S]){0,300}?\.drawHeld\((?:(?!\bawait\b)[\s\S]){0,200}?\.drawFireOverlay\(/, why: 'after gfx.draw() returns, main.js draws the survival crack, hands and fire overlay with no await in between: they run in the same rAF task as the frame viewport, so they land in the scene FBO before the composite microtask runs' },
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`(?<!\basync\s+)\bdraw\(\s*(\w+)\s*\)\s*\{(?:(?!${METHOD_END})[\s\S])*?\b(\w+)\.depthMask\(\s*${TRUE}\s*\)\s*;\s*\2\.disable\(\s*\2\.BLEND\s*\)\s*;\s*\2\.enable\(\s*\2\.CULL_FACE\s*\)\s*;\s*if\s*\(\s*\1\.held\s*\)\s*this\.drawHeld\(\s*\1\.held\s*,\s*\1\.w\s*\/\s*\1\.h\s*\)\s*;?\s*\}`), why: 'draw() ends with depthMask(true), disable(BLEND), enable(CULL_FACE) and then (creative) drawHeld(v.held, v.w / v.h): the end-of-frame state the composite finds and puts back' },
  { script: SHADERS, file: 'js/gfx.js', test: new RegExp(R`\bdrawWall\([^)]*\)\s*\{(?:(?!${METHOD_END})[\s\S])*?\.disable\(\s*\w+\.BLEND\s*\)(?:(?!\.enable\(\s*\w+\.BLEND\b|\.depthMask\(|${METHOD_END})[\s\S])*?\.enable\(\s*\w+\.DEPTH_TEST\s*\)\s*;\s*\w+\.enable\(\s*\w+\.CULL_FACE\s*\)\s*;?\s*\}`), why: 'a frame with the camera inside a block (drawWall, after the frame viewport) ends in the same state as a normal one: BLEND off, then DEPTH_TEST and CULL_FACE back on (draw() set depthMask(true) before it)' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?=[\s\S]*\bdrawHeld\(\s*\w+\s*,\s*\w+\s*\)\s*\{\s*const\s+(\w+)\s*=\s*this\.gl\s*;\s*\1\.clear\(\s*\1\.DEPTH_BUFFER_BIT\s*\))(?![\s\S]*\.clear\(\s*[\w$.]*\bDEPTH_BUFFER_BIT\s*\)[\s\S]*\.clear\(\s*[\w$.]*\bDEPTH_BUFFER_BIT\s*\))/, why: 'drawHeld() starts with clear(DEPTH_BUFFER_BIT), gfx.js\'s only depth-only clear: the hands clear the scene FBO\'s depth texture (it needs one), so scene depth is gone after the hand pass (in survival, main.js calls drawHeld after draw())' },
  { script: SHADERS, file: 'js/frameloop.js', test: /\bfunction\s+createFrameLoop\(\s*(\w+)\s*,\s*(\w+)\s*=\s*(\w+)\s*=>\s*requestAnimationFrame\(\s*\3\s*\)\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,300}?\bconst\s+(\w+)\s*=\s*(\w+)\s*=>\s*\{[^{}]*?=\s*\2\(\s*\4\s*\)[^{};]*;\s*\1\(\s*\5\s*\)\s*;?\s*\}/, why: 'createFrameLoop(frame, raf = fn => requestAnimationFrame(fn)) re-arms with the same step function before calling frame(now), and looks up the global requestAnimationFrame at each call: our rAF wrapper (installed at document-start) sees every frame, and its one cached wrapper per callback is reused' },
  { script: SHADERS, file: 'js/main.js', test: /\bcreateFrameLoop\(\s*\w+\s*\)/, why: 'main.js creates its frame loop with the default raf (the global requestAnimationFrame), so our wrapper times the game\'s callback' },
  { script: SHADERS, file: 'js/main.js', test: /\b(\w+)\s*=\s*[\w$.]+\(\s*["']#gl["']\s*\)[\s\S]*?\bfunction\s+regainCanvases\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,200}?\bfor\s*\(\s*const\s+(\w+)\s+of\s*\[[^\]]*\b\1\b[^\]]*\]\s*\)\s*\{\s*const\s+(\w+)\s*=\s*\2\.width\s*;\s*\2\.width\s*=[^;]+;\s*\2\.width\s*=\s*\3\s*;?\s*\}/, why: 'gpuwatch (new in 325afb04b5): when FPS stays low, regainCanvases() sets #gl.width to 1 or 2 and straight back, reallocating the drawing buffer at the same size. The scene FBO tolerates that because it follows canvas.width/height at each frame viewport; nothing caches the canvas size' },

  // --- Better Options (and Zoom, which reuses its FOV plumbing)
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', exports: ['openOptions', 'closeMenu'], why: 'opens the Options screen to reach the FOV slider; Better Options\' "Game options…" button opens it for the player' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction openOptions\(\)\s*\{(?:(?!\bexport\s+function\b)[\s\S]){0,12000}?\bbtn\(\s*\w+\(\s*["']menu\.done["']\s*\)\s*,\s*back\s*\)\s*,?\s*\]/, why: 'the game\'s Options screen ends with Done = back(): after "Game options…" it returns to the title or pause screen (not to our menu), which is expected' },
  { script: OPTIONS, file: 'js/menus.js', test: /oninput\s*:\s*\(\)\s*=>\s*\{\s*(\w+)\.S\.baseFov\s*=\s*Number\(\s*\w+\.value\s*\)\s*;\s*\1\.store\.set\(\s*["']mc\.fov["']\s*,\s*\1\.S\.baseFov\s*\)/, why: 'the game\'s FOV slider saves every change to mc.fov: our FOV row re-reads mc.fov (syncFov) to show changes made on the game\'s Options screen' },
  { script: OPTIONS, file: 'js/main.js', test: /\bstore\s*=\s*\{\s*get\(\s*\w+\s*\)\s*\{[\s\S]{0,120}?localStorage\.getItem\(\s*\w+\s*\)[\s\S]{0,120}?\bset\(\s*\w+\s*,\s*\w+\s*\)\s*\{[\s\S]{0,200}?localStorage\.setItem\(/, why: 'the game\'s store is plain localStorage (mc.fov, mc.rd), which we read and write directly' },
  { script: OPTIONS, file: 'js/menus.js', exports: ['openPause', 'showScreen', 'back', 'refresh'], why: 'shows its own screen and drives the pause menu' },
  { script: OPTIONS, file: 'js/ui.js', exports: ['Hud'], why: 'HUD scaling wraps Hud.prototype.draw/suggestions/tab/hint' },
  { script: OPTIONS, file: 'js/survival/client.js', exports: ['SurvivalClient'], why: 'HUD scaling wraps SurvivalClient.prototype.drawHud' },
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /["']data-k["']\s*:\s*["']fov["']/, why: 'the FOV slider is found as input[type=range][data-k="fov"]' },
  { script: OPTIONS, file: 'js/menus.js', exports: ['showMessage'], why: '"Reset all options" asks for confirmation in the game\'s own showMessage() dialog' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction showMessage\(\s*\w+\s*,\s*\w+\s*,\s*(\w+)\s*=\s*\[\s*\[[^\]]*\]\s*\]\s*\)\s*\{[\s\S]{0,400}?\.\.\.\1\.map\(\s*\(\s*\[\s*\w+\s*,\s*\w+\s*\]\s*\)\s*=>/, why: 'showMessage(title, text, buttons) renders each [label, fn] pair of buttons as a button that calls fn' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction openPause\(\s*\)\s*\{\s*const\s+(\w+)\s*=\s*\w+\.S\s*;\s*if\s*\(\s*!\1\.started\b[^)]*\)\s*return\b/, why: 'openPause() does nothing before the world starts (the title screen): setRenderDistance() then finds no Distance button and only writes mc.rd' },
  // Pause-menu labels come from the game's i18n (js/i18n.js t(key, params)), so we match them in the player's language
  { script: OPTIONS, file: 'js/menus.js', test: /\bimport\s*\{[^}]*\bt\b(?:\s+as\s+\w+)?[^}]*\}\s*from\s*["']\.\/i18n\.js["']/, why: 'the pause menu labels its buttons with i18n\'s t(), so our t(key, params) gives the same aria-label text' },
  { script: OPTIONS, file: 'js/i18n.js', exports: ['t', 'onLocaleChange'], why: 'pause-menu labels are matched via t(key, params) in the current language, and onLocaleChange fires when the player switches language' },
  { script: OPTIONS, file: 'js/lang/en.js', test: /^(?=[\s\S]*["']pause\.options["']\s*:\s*["'])(?=[\s\S]*["']pause\.distance["']\s*:\s*["'][^"'\n]*\{n\}[^"'\n]*["'])(?=[\s\S]*["']pause\.full["']\s*:\s*["'])(?=[\s\S]*["']pause\.exitFull["']\s*:\s*["'])/, why: 'the English catalogue (the fallback for every language) has pause.options, pause.distance with an {n} placeholder for the distance, pause.full and pause.exitFull' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bbtn\(\s*\w+\(\s*["']pause\.options["']\s*\)\s*,\s*openOptions\s*\)/, why: 'the pause menu\'s Options button is btn(t("pause.options"), openOptions): clicks on button[aria-label=t("pause.options")] are redirected to our menu' },
  { script: OPTIONS, file: 'js/main.js', test: /["']F1["']/, why: 'the HUD toggle sends an F1 key press' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: 'mc.fov', why: 'FOV is read from localStorage "mc.fov"' },
  { script: OPTIONS, file: 'js/main.js', test: 'mc.rd', why: 'render distance is read from localStorage "mc.rd"' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*new\s+URLSearchParams\(\s*location\.search\s*\))(?=[\s\S]*=\s*matchMedia\(\s*["']\(pointer: coarse\)["']\s*\)\.matches\s*\|\|\s*\1\.has\(\s*["']touch["']\s*\))/, why: 'the game counts a coarse pointer or a ?touch URL parameter as touch: our isTouch() copies both (touch UI scale, default render distance)' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*matchMedia\(\s*["']\(pointer: coarse\)["']\s*\)\.matches\b)(?=[\s\S]*\brd\s*:\s*\w+\.includes\([^)]*["']mc\.rd["'][^?]*\?[^:]*:\s*\1\s*\?\s*6\s*:\s*8\b)/, why: 'without a valid mc.rd the game starts at render distance 6 on touch and 8 otherwise: "Reset all options" restores exactly that' },
  { script: OPTIONS, file: 'style.css', test: 'var(--u)', why: 'UI scale works by overriding the --u CSS variable' },
  { script: OPTIONS, file: 'style.css', test: 'var(--d)', why: 'UI scale works by overriding the --d CSS variable' },
  { script: OPTIONS, file: 'js/ui.js', test: 'mcb', why: 'button labels are rescaled via button.mcb' },
  { script: [OPTIONS, ZOOM, SHADERS], file: 'index.html', test: 'id="gl"', why: 'the game canvas is #gl (the main GL context; the shaders\' frame counter counts only the context that first uses a patched program, which is this one, not the dragon view\'s)' },
  { script: [OPTIONS, ZOOM], file: 'index.html', test: 'id="screen"', why: 'menu screens render into #screen .inner' },
  { script: [OPTIONS, SHADERS], file: 'index.html', test: 'id="note"', why: 'toasts are shown in #note' },
  { script: [OPTIONS, SHADERS], file: 'js/ui.js', test: /getElementById\(\s*["']note["']\s*\)[\s\S]{0,80}?\.textContent\s*=[\s\S]{0,40}?\.classList\.add\(\s*["']show["']\s*\)/, why: 'toasts copy the game\'s note(): set #note.textContent, add class "show"' },
  { script: [OPTIONS, SHADERS], file: 'style.css', test: '#note.show', why: 'class "show" is what makes #note visible' },
  // Menu screen plumbing (Zoom's fallback FOV path uses the same)
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /["']#screen \.inner["']/, why: 'menus render into "#screen .inner", where the FOV slider and our marker are looked up' },
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /^(?=[\s\S]*\.className\s*=\s*["']on["']\s*\+\s*\(\s*\w+\s*\?\s*["'] ["']\s*\+\s*\w+\s*:\s*["']["']\s*\))(?=[\s\S]*\.className\s*=\s*["']["']\s*;)/, why: '#screen gets class "on" (+ the look) while a menu is shown and "" when closed: screenIsOn() and the zoom gate test it' },
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /oninput\s*:\s*\(\)\s*=>\s*\{\s*\w+\.S\.baseFov\s*=\s*Number\(\s*\w+\.value\s*\)/, why: 'the FOV slider\'s input handler sets S.baseFov from its value: setFov() writes the value and fires "input"' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /\w+\.fov\s*\+=\s*\(\s*\w+\.baseFov\b/, why: 'the view FOV follows S.baseFov every frame, so the slider applies live' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /baseFov\s*:[^,]*["']mc\.fov["'][^,]*>=\s*30[^,]*<=\s*110/, why: 'the game accepts a stored mc.fov of 30-110 (the scripts\' FOV cache uses the same range)' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /\b(\w+)\s*=\s*[\w$.]+\(\s*["']#gl["']\s*\)[\s\S]*?\b\1\.requestPointerLock\(/, why: 'the game pointer-locks #gl, which gates the sensitivity and zoom-look scaling' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /[{;]\s*addEventListener\(\s*["']mousemove["'][\s\S]{0,120}?["']lock["']\s*\)\s*\{[^}]*?\(\s*\w+\.movementX\s*,\s*\w+\.movementY\b/, why: 'pointer-locked mouse look reads movementX/Y from window mousemove, which our capture listeners rescale first' },
  // Better Options: its own screen
  { script: OPTIONS, file: 'js/menus.js', test: /\.replaceChildren\(\s*\.\.\.\w+\(\)\.filter\(\s*Boolean\s*\)\s*\)/, why: 'showScreen(name, build, look) renders the array build() returns (buildScreen returns one)' },
  { script: OPTIONS, file: 'js/menus.js', test: /\.replaceChildren\(\s*\.\.\.\w+\.menu\(\)\.filter\(\s*Boolean\s*\)\s*\)/, why: 'menus.refresh() rebuilds the current screen by calling its builder again' },
  { script: OPTIONS, file: 'style.css', test: '#screen.dim', why: 'our screen uses the "dim" look' },
  { script: OPTIONS, file: 'js/main.js', test: /\.menuName\s*===\s*["']pause["']\s*\)\s*\w+\(\)\s*;?\s*else\s+\w+\.back\(\)/, why: 'Escape on a non-pause screen (ours) calls menus.back()' },
  // Better Options: pause-menu buttons it hides, clicks or redirects
  { script: OPTIONS, file: 'js/menus.js', test: /\bbtn\(\s*document\.fullscreenElement\s*\?\s*\w+\(\s*["']pause\.exitFull["']\s*\)\s*:\s*\w+\(\s*["']pause\.full["']\s*\)\s*,\s*\w+\.toggleFullscreen\b/, why: 'the pause menu\'s Fullscreen button is labelled t("pause.full") / t("pause.exitFull"): it is hidden by that label (now in our menu)' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bbtn\(\s*\w+\(\s*["']pause\.distance["']\s*,\s*\{\s*n\s*:\s*\w+\.rd\s*\}\s*\)\s*,\s*\w+\.cycleRd\b/, why: 'the Distance button is labelled t("pause.distance", {n: S.rd}) and a click cycles it (G.cycleRd): setRenderDistance() finds it by that label and clicks until it shows the target' },
  { script: OPTIONS, file: 'js/view.js', test: /\bRDS\s*=\s*Object\.freeze\(\s*\[\s*4\s*,\s*6\s*,\s*8\s*,\s*10\s*,\s*12\s*\]\s*\)/, why: 'our render-distance slider offers the game\'s distances 4-12 (step 2)' },
  // Better Options: key remapping is off while the inventory (or a survival screen) is open
  { script: OPTIONS, file: 'index.html', test: 'id="inv"', why: 'invClosed() looks for #inv (key remapping and, in 1.2, the F2 overlay key are ignored while it is open, and a finished or stopped benchmark does not reopen our menu over it)' },
  { script: OPTIONS, file: 'js/inventory.js', test: /^(?=[\s\S]*\bshow\(\)\s*\{[^}]*?\.classList\.remove\(\s*["']off["']\s*\))(?=[\s\S]*\bhide\(\)\s*\{[^}]*?\.classList\.add\(\s*["']off["']\s*\))/, why: 'the inventory drops class "off" from #inv when shown and adds it back when hidden' },
  { script: OPTIONS, file: 'js/survival/screens.js', test: /^(?=[\s\S]*this\.c\.classList\.remove\(\s*["']off["']\s*\))(?=[\s\S]*this\.c\.classList\.add\(\s*["']off["']\s*\))/, why: 'survival screens (chests, crafting...) toggle "off" on the same canvas' },
  { script: OPTIONS, file: 'js/main.js', test: /screens\s*:\s*\{\s*canvas\s*:\s*(\w+)[\s\S]*?\b\1\s*=\s*[\w$.]+\(\s*["']#inv["']\s*\)|\b(\w+)\s*=\s*[\w$.]+\(\s*["']#inv["']\s*\)[\s\S]*?screens\s*:\s*\{\s*canvas\s*:\s*\2\b/, why: 'that canvas is #inv' },
  // Better Options: UI scale and button labels
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*Math\.min\(\s*innerWidth\s*\/\s*280\s*,\s*innerHeight\s*\/\s*190\s*\))(?=[\s\S]*\?\s*1\.75\s*:\s*1\.25\b)(?=[\s\S]*setProperty\(\s*["']--d["']\s*,\s*Math\.max\(\s*1\s*,\s*Math\.round\(\s*\w+\s*\*\s*\w+\s*\)\s*-\s*1\s*\)\s*\/\s*\w+)(?=[\s\S]*documentElement\.style\s*;\s*\w+\.setProperty\(\s*["']--u["'])(?=[\s\S]*matchMedia\(\s*["']\(pointer: coarse\)["']\s*\))/, why: 'uiBase() copies the game\'s --u/--d formula and touch test; the game sets them inline on <html>, so we reassert' },
  { script: OPTIONS, file: 'style.css', test: /#cross\s*\{[^}]*transform:\s*translate\(\s*-50%\s*,\s*-50%\s*\)/, why: 'our CSS replaces #cross\'s transform with translate(-50%, -50%) scale(--tc-s)' },
  { script: OPTIONS, file: 'index.html', test: 'id="cross"', why: 'the crosshair is #cross' },
  { script: OPTIONS, file: 'style.css', test: /font-family:\s*["']Tweetcraft["']/, why: 'our screen uses the game\'s "Tweetcraft" font' },
  { script: OPTIONS, file: 'style.css', test: /\.mcb:hover[^{]*\{[^}]*border-image-source:\s*url\(\s*\/assets\/gui\/button_highlighted\.png\s*\)/, why: 'the active tab copies the hover look (border-image /assets/gui/button_highlighted.png)' },
  { script: OPTIONS, file: 'style.css', test: /^(?=[\s\S]*\.mcb\s*\{[^}]*border-image:\s*url\(\s*\/assets\/gui\/button\.png\s*\)\s*3\s+fill\b)(?=[\s\S]*\.fov-control\s+input::-webkit-slider-thumb\s*\{[^}]*border-image:\s*url\(\s*\/assets\/gui\/button\.png\s*\)\s*3\s+fill\b)/, why: 'our slider thumb copies the game\'s FOV-slider thumb: border-image url(/assets/gui/button.png) 3 fill, the same image as .mcb buttons' },
  { script: OPTIONS, file: 'js/ui.js', test: /class\s*:\s*["']mcb["']\s*\+[^,]*,\s*type\s*:\s*["']button["']\s*,\s*["']aria-label["']\s*:\s*\w+\s*,/, why: 'game buttons are button.mcb with aria-label = their text: found by label, and the label text is redrawn' },
  { script: OPTIONS, file: 'js/ui.js', test: /^(?=[\s\S]*textCanvas\([^)]*\?\s*["']#a0a0a0["']\s*:\s*["']#ffffff["']\s*\))(?=[\s\S]*textCanvas\([^)]*["']#ffffa0["']\s*\))(?=[\s\S]*\.className\s*=\s*["']hi["'])/, why: 'button labels are canvases: white (#a0a0a0 disabled) plus a #ffffa0 one with class "hi"' },
  { script: OPTIONS, file: 'js/ui.js', test: /function textCanvas\(\s*(\w+)\s*,\s*(\w+)\s*,\s*(\w+)[^)]*\)\s*\{\s*const\s+\w+\s*=\s*\w+\(\s*Math\.max\(\s*1\s*,\s*\(\s*\1\.width\(\s*\2\s*\)\s*\+\s*1\s*\)\s*\*\s*\3\s*\)\s*,\s*9\s*\*\s*\3\s*\)/, why: 'a label canvas is (font.width(text) + 1) * px by 9 * px: redrawButtonLabels() finds px from that' },
  { script: OPTIONS, file: 'js/ui.js', test: /["']mcb hb["']/, why: 'HUD buttons are "mcb hb" (other canvases), and are skipped' },
  // Better Options: HUD scaling (argument positions and option names the wrappers rescale)
  { script: OPTIONS, file: 'js/ui.js', test: /class Hud\b[\s\S]*?constructor\([^)]*\)\s*\{[^}]*this\.font\s*=/, why: 'the bitmap font is taken from hud.font' },
  { script: OPTIONS, file: 'js/ui.js', test: /class Font\b[\s\S]*?\bwidth\(\s*\w+\s*\)\s*\{[\s\S]*?\bdraw\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*,\s*\w+\s*=\s*["']#ffffff["']\s*,\s*\w+\s*=\s*true\s*\)/, why: 'labels are redrawn with font.width(text) and font.draw(ctx, text, x, y, px, color, shadow)' },
  { script: OPTIONS, file: 'js/ui.js', test: /\bdraw\(\s*(\w+)\s*\)\s*\{\s*const\s[^;]*?=\s*\1\.gs\b/, why: 'Hud.draw(o) takes its scale from o.gs' },
  { script: OPTIONS, file: 'js/main.js', test: /\.draw\(\s*\{\s*gs\s*:/, why: 'the game calls hud.draw({gs, ...})' },
  { script: OPTIONS, file: 'js/ui.js', test: /\bsuggestions\(\s*\w+\s*\)\s*\{/, why: 'Hud.suggestions(scale): scale is argument 0' },
  { script: OPTIONS, file: 'js/main.js', test: /\.suggestions\(\s*\w+\.gs\s*\)/, why: 'the game calls hud.suggestions(UI.gs)' },
  { script: OPTIONS, file: 'js/ui.js', test: /^(?=[\s\S]*this\.hint\(\s*\w+\.hint\s*,\s*\w+\s*[,)])(?=[\s\S]*this\.tab\(\s*\w+\.tab\s*,\s*\w+\s*\))/, why: 'Hud.hint(text, scale, ...) and Hud.tab(t, scale): scale is argument 1 (both are called from Hud.draw)' },
  { script: OPTIONS, file: 'js/survival/client.js', test: /\bdrawHud\(\s*\w+\s*,\s*\w+\s*,\s*\w+\s*\)\s*\{/, why: 'SurvivalClient.drawHud(hud, font, gs)' },
  { script: OPTIONS, file: 'js/main.js', test: /\.drawHud\(\s*\w+\s*,\s*\w+\s*,\s*\w+\.gs\s*\)/, why: 'the game calls survival.drawHud(hud, font, UI.gs)' },
  // Better Options: keys it synthesizes or remaps (it dispatches KeyboardEvents on window)
  { script: OPTIONS, file: 'js/main.js', test: /[{;]\s*addEventListener\(\s*["']keydown["']\s*,\s*\w+\s*\)\s*;\s*addEventListener\(\s*["']keyup["']\s*,\s*\w+\s*\)/, why: 'game keys are window keydown/keyup listeners, which our re-dispatched events reach' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*delete\s+\w+\.keys\[\s*\w+\.code\s*\])(?=[\s\S]*\.keys\[\s*\w+\s*\]\s*=\s*true)/, why: 'held keys are tracked by e.code, which is what remapping rewrites' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*\.KeyW\b)(?=[\s\S]*\.KeyS\b)(?=[\s\S]*\.KeyA\b)(?=[\s\S]*\.KeyD\b)(?=[\s\S]*["']Space["'])(?=[\s\S]*\.ShiftLeft\b)(?=[\s\S]*\.ControlLeft\b)(?=[\s\S]*["']KeyQ["'])(?=[\s\S]*["']KeyE["'])(?=[\s\S]*["']KeyT["'])(?=[\s\S]*["']F5["'])(?=[\s\S]*["']F3["'])(?=[\s\S]*["']F1["'])/, why: 'the Keybinds tab lists these game codes (GAME_ACTIONS): W A S D, Space, ShiftLeft, ControlLeft, Q, E, T, F5, F3, F1' },
  { script: OPTIONS, file: 'js/main.js', test: /===\s*["']F1["']\s*\)\s*\{?\s*\w+\.showHud\s*=\s*!\s*\w+\.showHud/, why: 'an F1 keydown (by e.code) toggles S.showHud: the HUD toggle sends one' },
  // The performance overlay keybind (tc.perfOverlay) defaults to F2, so no game module may handle F2
  ...KEY_MODULES.map(file => ({ script: OPTIONS, file, test: NOT_F2, why: 'F2 (default key of the performance overlay, tc.perfOverlay) is not a game key here: no "F2" code or key, .F2 or keyCode 113' })),
  { script: OPTIONS, file: 'js/main.js', test: /\bPREVENT\s*=\s*new\s+Set\(\s*\[(?![^\]]*["']F2["'])[^\]]*["']F1["'][^\]]*["']F3["'][^\]]*\]\s*\)/, why: 'the game preventDefaults F1/F3/F5 but not F2: our F2 handler calls preventDefault itself' },
  // "Run benchmark" shows a see-through screen (menus.showScreen("tcbench", build, ""), #screen class "on") while it runs
  { script: OPTIONS, file: 'js/main.js', test: /\bfunction\s+\w+\(\s*\w+\s*\)\s*\{\s*const\s+(\w+)\s*=[^;]*?!\s*\w+\.menu\b[^;]*;\s*const\s+(\w+)\s*=\s*\w+\.sample\([^,]*,\s*\1\s*,[^)]*\)\s*;\s*if\s*\(\s*\2\s*===\s*["']regain["']\s*\)\s*regainCanvases\(\)/, why: 'the slow-frame watch counts only frames with no menu open (steady = ... && !S.menu): while our benchmark screen is shown, regainCanvases() cannot reallocate the canvas mid-run, and the bench\'s slow frames do not count towards it' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction showScreen\(\s*\w+\s*,\s*(\w+)\s*,\s*\w+\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,600}?\.menu\s*=\s*\1\s*;(?:(?!\bfunction\b)[\s\S]){0,300}?\.releaseInput\(\)/, why: 'showScreen() sets S.menu and calls releaseInput() (held keys, look and pointer lock dropped): the player cannot move or look while the benchmark screen is up' },
  { script: OPTIONS, file: 'js/main.js', test: /\bshow\s*=\s*(\w+)\.started\s*&&\s*\1\.showHud\s*&&\s*!\w+\s*[,;]/, why: 'the in-world HUD, hand and selection follow show = S.started && S.showHud && !CARD, with no S.menu term: behind the see-through benchmark screen the world draws as in play' },
  // "Reset all options" turns the HUD back on only if it is really off (our saved flag can be stale): it reads #hudtop
  { script: OPTIONS, file: 'index.html', test: 'id="hudtop"', why: 'the in-world HUD bar is #hudtop' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*[\w$.]+\(\s*["']#hudtop["']\s*\))(?=[\s\S]*\bfunction updateTop\(\)\s*\{\s*const\s+(\w+)\s*=[^;]*\w+\.started\b[^;]*!\w+\.menu\b[^;]*;\s*\1\.hidden\s*=\s*!\(\s*\2\s*&&\s*\w+\.showHud\s*\))/, why: 'updateTop() sets #hudtop.hidden = !(in a world with no menu open && S.showHud): with no menu open, a hidden #hudtop means the HUD is off' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction closeMenu\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\.menu\s*=\s*null(?:(?!\bfunction\b)[\s\S]){0,300}?\b\w+\.updateTop\(\)/, why: 'closeMenu() clears S.menu and then runs updateTop(), so #hudtop.hidden is current right after it' },
  // Better Options 1.2: the performance overlay (#tc-perf) sits below the game's top-right HUD buttons (#hudright)
  { script: OPTIONS, file: 'index.html', test: /<div\b(?=[^>]*\bid=["']hudtop["'])(?=[^>]*\shidden[\s=>])[^>]*>\s*(?:<div\b[^>]*>\s*<\/div>\s*)*<div\b(?=[^>]*\bid=["']hudright["'])[^>]*>/, why: 'the top-right HUD buttons are #hudright, a child of #hudtop (hidden at load): placePerf() puts #tc-perf below #hudright while #hudtop is shown, else in the corner' },
  { script: OPTIONS, file: 'js/main.js', test: /[\w$.]+\(\s*["']#hudright["']\s*\)\.replaceChildren\(/, why: 'buildTop() rebuilds #hudright with replaceChildren (new buttons on a --hp or language change): placePerf() re-measures when #hudright\'s first child or child count, #hudtop.hidden or the inline --hp / --tc-s change, and after a resize or when the overlay is turned on' },
  { script: OPTIONS, file: 'style.css', test: /^(?=[\s\S]*#hudtop\s*\{[^}]*\bposition:\s*fixed\b)(?=[\s\S]*#hudright\s*\{(?=[^}]*\bposition:\s*absolute\b)(?=[^}]*\btop:\s*max\(\s*calc\(\s*4\s*\*\s*var\(--hp\)\s*\))(?=[^}]*\bflex-direction:\s*column\b)(?=[^}]*\bgap:\s*calc\(\s*2\s*\*\s*var\(--hp\)\s*\)))(?=[\s\S]*#hudright\s*\{[^}]*\bright:\s*max\(\s*calc\(\s*4\s*\*\s*var\(--hp\)\s*\))(?=[\s\S]*\.mcb\.hb\s*\{[^}]*\bheight:\s*calc\(\s*18\s*\*\s*var\(--hp\)\s*\))/, why: '#hudright is a column at top/right max(4 * --hp, safe area) inside the fixed #hudtop, gap 2 * --hp, of .mcb.hb buttons 18 * --hp tall: its box depends only on its buttons, --hp and the window, which is what placePerf() watches, and #tc-perf (position: fixed) uses the same 4 * --hp corner offsets' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?![\s\S]*["'`]--hp["'`][\s\S]*["'`]--hp["'`])[\s\S]*?\b(\w+)\s*=\s*document\.documentElement\.style\s*;(?:(?!\bfunction\b)[\s\S]){0,400}?\b\1\.setProperty\(\s*["']--hp["']\s*,/, why: 'resize() sets --hp inline on <html> (with --u and --d): placePerf() reads documentElement.style --hp as a cheap change signal (if it moved elsewhere, the overlay offset would only go stale until the next resize). It is main.js\'s only "--hp" string: a second setter (on <body>, say, which #hudright would inherit instead) would move the buttons without that signal' },
  // Better Options 1.2: F2 and "Run benchmark" are ignored while one of the game's editors is open, found by
  // document.querySelector('.se, .sp, #sign-editor, #book-screen'), where presence means open
  { script: OPTIONS, file: 'js/skin-editor.js', test: /\bconst\s+(\w+)\s*=\s*\w+\(\s*["']div["']\s*,\s*\{\s*class\s*:\s*["']se["']\s*,\s*role\s*:\s*["']dialog["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b\1\.remove\(\))/, why: 'the skin editor is a div.se dialog appended to <body> while open and removed on close: a .se element means it is open' },
  { script: OPTIONS, file: 'js/skin-preview.js', test: /\bconst\s+(\w+)\s*=\s*\w+\(\s*["']div["']\s*,\s*\{\s*class\s*:\s*["']sp["']\s*,\s*role\s*:\s*["']dialog["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b\1\.remove\(\))/, why: 'the skin import preview is a div.sp dialog appended to <body> while open and removed on close: a .sp element means it is open' },
  { script: OPTIONS, file: 'js/signs.js', test: /^(?=[\s\S]*\b(\w+)\.id\s*=\s*["']sign-editor["'][\s\S]*?\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b(\w+)\s*=\s*this\.editor\s*;[\s\S]{0,80}?\b\2\.el\.remove\(\))/, why: 'the sign editor is a div#sign-editor appended to <body> while open and removed when done: #sign-editor means it is open' },
  { script: OPTIONS, file: 'js/survival/book.js', test: /\b(\w+)\.id\s*=\s*["']book-screen["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\.ui\.el\.remove\(\))/, why: 'the book screen is a div#book-screen appended to <body> while open and removed on close: #book-screen means it is open' },
  { script: OPTIONS, file: 'index.html', test: /^(?![\s\S]*\bclass=["'](?:[^"']*\s)?(?:se|sp)(?:\s[^"']*)?["'])(?![\s\S]*\bid=["'](?:sign-editor|book-screen)["'])/, why: 'the page has no permanent .se, .sp, #sign-editor or #book-screen element (it would make Better Options think an editor is always open: F2 would be ignored, and a benchmark would never reopen our menu)' },
  // Better Options 1.2: the benchmark screen is watched (MutationObserver) and stops the run when the game replaces it
  { script: OPTIONS, file: 'js/menus.js', test: /\bconst\s+(\w+)\s*=\s*document\.querySelector\(\s*["']#screen["']\s*\)\s*,\s*(\w+)\s*=\s*document\.querySelector\(\s*["']#screen \.inner["']\s*\)(?![\s\S]*(?<![.\w])\2\s*=(?!=))(?![\s\S]*(?<![.\w])(?:\1|\2)\.(?:remove|replaceWith|outerHTML)\b)(?=[\s\S]*\bfunction\s+showScreen\(\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,600}?\b\2\.replaceChildren\(\s*\.\.\.\3\(\)\.filter\(\s*Boolean\s*\)\s*\)\s*;\s*\1\.className\s*=\s*["']on["']\s*\+\s*\(\s*\4\s*\?)(?=[\s\S]*\bfunction\s+closeMenu\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\b\1\.className\s*=\s*["']["']\s*;\s*\2\.replaceChildren\(\s*\))/, why: 'menus.js looks #screen and #screen .inner up once and never replaces them; showScreen() replaces .inner\'s children and sets #screen\'s class, closeMenu() sets class "" and empties .inner: an observer on #screen[class] and .inner\'s child list sees every screen change, so the benchmark stops as soon as the game takes its screen away' },
  { script: OPTIONS, file: 'js/main.js', test: /\bfunction\s+(\w+)\(\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bif\s*\(\s*(\w+)\.menu\s*\)\s*\{(?:(?!\bfunction\b)[^{}])*?\bif\s*\(\s*\2\.code\s*===\s*["']Escape["'][^{}]*?\)\s*\{\s*\2\.preventDefault\(\)\s*;\s*if\s*\(\s*\3\.menuName\s*===\s*["']pause["']\s*\)\s*\w+\(\)\s*;?\s*else\s+\w+\.back\(\)\s*;?\s*\}\s*return\s*;?\s*\}[\s\S]*[{;]\s*addEventListener\(\s*["']keydown["']\s*,\s*\1\s*\)/, why: 'with a menu open, the game handles Escape only in its window keydown listener (bubble phase, no capture): it calls M.back() (which would open the pause menu over the benchmark) and returns. Our capture-phase window listener runs first, so on the benchmark screen it consumes Escape (stopImmediatePropagation) and stops the run instead' },

  // --- Chat history
  { script: [CHAT, OPTIONS], file: 'index.html', test: 'id="chatbox"', why: 'history attaches to the #chatbox input; Better Options reads #chatbox.hidden to tell whether chat is open (F2 is ignored, the benchmark refuses to start, our menu never opens over chat)' },
  { script: [CHAT, OPTIONS], file: 'index.html', test: /<input\b(?=[^>]*\sid=["']chatbox["'])(?=[^>]*\shidden[\s=/>])[^>]*>/, why: '#chatbox is an <input> (value, setSelectionRange), hidden while chat is closed: a visible #chatbox means chat is open (history, and Better Options\' chatOpen())' },
  { script: [CHAT, OPTIONS], file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*[\w$.]+\(\s*["']#chatbox["']\s*\))(?=[\s\S]*\.chatOpen\s*=\s*true\s*;[^}]*?\b\1\.hidden\s*=\s*false)(?=[\s\S]*\.chatOpen\s*=\s*false\s*;[^}]*?\b\1\.hidden\s*=\s*true)/, why: 'chat opens by setting S.chatOpen = true and then #chatbox.hidden = false, and closes with chatOpen = false and, after resetting its IME and opacity state, hidden = true: chatOpen() reads #chatbox.hidden' },
  { script: CHAT, file: 'js/main.js', test: /\.chatOpen\s*\)\s*\{\s*(?:if\s*\(\s*\w+\(\s*\w+\s*\)\s*\)\s*return\s*;\s*)?if\s*\(\s*\w+\.key\(\s*\w+\s*\)\s*\)\s*\w+\.preventDefault\(\)\s*;\s*else\s+if\s*\(\s*\w+\.key\s*===\s*["']Enter["']\s*\)/, why: 'chat is sent on keydown Enter (recorded first in our capture listener, which skips e.isComposing keys; the game\'s composing() guard also skips keyCode 229); the suggestion list claims keys with preventDefault' },
  { script: CHAT, file: 'js/chat-suggest.js', test: /\.key\s*===\s*["']ArrowUp["']\s*\|\|\s*\w+\.key\s*===\s*["']ArrowDown["']/, why: 'the suggestion list uses Up/Down while shown; history steps aside when the event is defaultPrevented' },

  // --- The smoke test itself: runtime checks below wait for this flag before testing a loaded world
  { script: [SHADERS, OPTIONS, ZOOM], file: 'js/main.js', test: /window\.__ready\s*=\s*(?:true|!0)/, why: 'the game sets window.__ready = true once the world has loaded; runtime checks wait for it' },
];

// Runtime checks that need a loaded world wait for the game's own flag first, and say so if it never comes.
// (run() executes inside the page, so it cannot use constants from this module.)

export const runtime = [
  { script: OPTIONS, name: 'settings bus window.__tcOptions is available (apiVersion 2, with reset)',
    run: () => {
      const b = window.__tcOptions;
      if (!b || typeof b.register !== 'function') return 'window.__tcOptions.register missing';
      if (b.apiVersion !== 2) return `window.__tcOptions.apiVersion is ${JSON.stringify(b.apiVersion)}, expected 2 (scripts feature-check it)`;
      return typeof b.reset === 'function' || 'window.__tcOptions.reset missing ("Reset all options" needs it)';
    } },
  { script: OPTIONS, name: 'HUD scaling wrapped Hud.prototype methods',
    run: async () => {
      const names = ['draw', 'suggestions', 'tab', 'hint'];
      const missing = async () => { const ui = await import('/js/ui.js'); const P = ui.Hud && ui.Hud.prototype; return names.filter(k => !(P && P[k] && P[k].__tcScaled)); };
      return (await __tcwait(async () => (await missing()).length === 0)) || `not wrapped: ${(await missing()).join(', ')}`;
    } },
  { script: OPTIONS, name: 'HUD scaling wrapped SurvivalClient.prototype.drawHud',
    run: async () => (await __tcwait(async () => {
      const m = await import('/js/survival/client.js');
      return m.SurvivalClient && m.SurvivalClient.prototype.drawHud && m.SurvivalClient.prototype.drawHud.__tcScaled;
    })) || 'SurvivalClient.prototype.drawHud was not wrapped' },
  { script: SHADERS, name: 'window.Twitterentary is available',
    run: () => !!(window.Twitterentary && window.Twitterentary.cfg) || 'window.Twitterentary missing (script did not finish loading)' },
  { script: SHADERS, name: 'camera, sky colour and sun are observed through the game\'s uniform uploads',
    run: async () => {
      const T = window.Twitterentary, o = T && T.obs, st = T && T.state;
      if (!o || !st) return 'window.Twitterentary.obs/state missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag'; // world loaded (tiles, chunks, clouds)
      if (!(await __tcwait(() => o.camOk && o.topFrame >= 0 && o.sunFrame >= 0 && st.frame > 0))) {
        return `not observed: camera ${o.camOk} (uCam of the uSize program), sky frame ${o.topFrame} (uniform3fv uTop), sun frame ${o.sunFrame} (first uC after uTop), frame ${st.frame} (clear)`;
      }
      // the test page is the title world: overworld, creative noon
      if (st.dim !== 0) return `overworld detected as dim ${st.dim} (uAmbient ${o.amb}, uSkyLight ${JSON.stringify(o.sl)})`;
      if (st.day > 0.8 && !(o.sun[1] > 0)) return `daytime sky but the observed sun ${JSON.stringify(o.sun)} is below the horizon: the first uC after uTop is no longer the sun`;
      return true;
    } },
  { script: SHADERS, name: 'atlas layers are read and classified by texture name',
    run: async () => {
      const T = window.Twitterentary;
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag'; // the atlas is uploaded before the world is ready
      await __tcwait(() => T.state.frame > 2);
      const d = T.debug();
      if (!d.layers) return 'atlas never read: no texImage3D(TEXTURE_2D_ARRAY, 0, RGBA8, 16, 16, n, ..., pixels)';
      if (!d.names) return 'texture-name list not captured (Array.prototype.indexOf("oak_planks") hook)';
      const none = Object.keys(d.classes).filter(k => !(d.classes[k] > 0));
      return none.length === 0 || `no layers classified as ${none.join(', ')}: ${JSON.stringify(d.classes)}`;
    } },
  { script: SHADERS, name: 'the shadow pass replays the recorded terrain chunks',
    run: async () => {
      const T = window.Twitterentary, st = T.state;
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      if (!T.cfg.enabled || !T.cfg.shadows) return `can't verify: shaders or shadows are off by default (enabled ${T.cfg.enabled}, shadows ${T.cfg.shadows})`;
      // The title world is the overworld at noon. If that ever changes, this check can't prove anything, so it says so.
      if (st.dim !== 0 || !(st.day > 0.1 && st.sun[1] > 0.06)) return `can't verify: no sun in the test world (dim ${st.dim}, day ${st.day}, sun ${JSON.stringify(st.sun)})`;
      return (await __tcwait(() => T.stats.refreshes > 0 && T.stats.shadowChunks > 0))
        || `shadow map never drawn in daylight: ${JSON.stringify(T.stats)} (needs uniform3f(uOrigin), bindVertexArray and drawElements per chunk)`;
    } },
  { script: SHADERS, name: 'the Quality and Look presets hold valid settings, and the defaults are Medium + Natural',
    run: () => {
      const T = window.Twitterentary;
      if (!T || !T.presets || !Array.isArray(T.schema) || !T.defaults || typeof T.currentPreset !== 'function') return 'window.Twitterentary.presets/schema/defaults/currentPreset missing';
      const E = 1e-6, bad = [], F = {};
      for (const f of T.schema) F[f.key] = f;
      // A value is valid when the Better Options row for its key could show it (type, range, step, options).
      const check = (where, k, v, group) => {
        const f = F[k], d = T.defaults[k];
        if (!f) {
          if (!(k in T.defaults)) bad.push(`${where}: ${k} is not a setting`);
          else if (typeof v !== typeof d) bad.push(`${where}: ${k} = ${JSON.stringify(v)}, but its default is a ${typeof d}`);
          return;
        }
        if (group && f.group !== undefined && f.group !== group) bad.push(`${where}: ${k} belongs to the ${f.group} picker`);
        if (f.type === 'bool') { if (typeof v !== 'boolean') bad.push(`${where}: ${k} = ${JSON.stringify(v)} is not a boolean`); }
        else if (f.type === 'num') {
          if (typeof v !== 'number' || !Number.isFinite(v)) bad.push(`${where}: ${k} = ${JSON.stringify(v)} is not a number`);
          else if (v < f.min - E || v > f.max + E) bad.push(`${where}: ${k} = ${v} is outside ${f.min}..${f.max}`);
          else if (f.step > 0 && Math.abs(v - (f.min + Math.round((v - f.min) / f.step) * f.step)) > E) bad.push(`${where}: ${k} = ${v} is off the slider's ${f.step} steps from ${f.min}`);
        } else if (f.type === 'choice') {
          if (!(f.options || []).some(o => o[0] === v)) bad.push(`${where}: ${k} = ${JSON.stringify(v)} is not one of ${JSON.stringify((f.options || []).map(o => o[0]))}`);
        } else bad.push(`schema: ${k} has unknown type ${JSON.stringify(f.type)}`);
      };
      for (const f of T.schema) {
        if (f.type === 'num' && !(f.min < f.max && f.step > 0)) bad.push(`schema: ${f.key} has min ${f.min}, max ${f.max}, step ${f.step}`);
        if (f.type === 'choice' && !(Array.isArray(f.options) && f.options.length)) bad.push(`schema: ${f.key} has no options`);
        if (!(f.key in T.defaults)) bad.push(`schema: ${f.key} has no default`);
        else check('defaults', f.key, T.defaults[f.key]);
      }
      for (const g of ['quality', 'look']) {
        const list = T.presets[g];
        if (!Array.isArray(list) || !list.length) { bad.push(`presets.${g} is empty`); continue; }
        const ids = new Set();
        for (const p of list) {
          if (!p || typeof p.id !== 'string' || !p.name || !p.values || !Object.keys(p.values).length) { bad.push(`presets.${g}: malformed entry ${JSON.stringify(p)}`); continue; }
          if (ids.has(p.id)) bad.push(`presets.${g}: duplicate id "${p.id}"`);
          ids.add(p.id);
          for (const k of Object.keys(p.values)) check(`${g}.${p.id}`, k, p.values[k], g);
        }
      }
      // 1.5: every Quality preset sets the render-scale rows (Auto), so switching presets never leaves a stale scale.
      // (Missing rows are reported by the Performance-settings check.)
      for (const p of F.renderScale ? T.presets.quality || [] : []) {
        if (!p || !p.values) continue;
        for (const k of ['renderScale', 'renderScaleMin', 'sharpen']) if (F[k] && !(k in p.values)) bad.push(`quality.${p.id}: does not set ${k}`);
        if ('renderScale' in p.values && p.values.renderScale !== 0) bad.push(`quality.${p.id}: renderScale = ${JSON.stringify(p.values.renderScale)}, expected 0 (Auto: every preset adapts the resolution)`);
      }
      if (bad.length) return bad.slice(0, 8).join('; ') + (bad.length > 8 ? ` (+${bad.length - 8} more)` : '');
      // The smoke profile is fresh (no tc.shader.* keys), so the live settings are the defaults.
      for (const [g, want] of [['quality', 'medium'], ['look', 'natural']]) {
        const cur = T.currentPreset(g);
        if (cur === want) continue;
        const p = T.presets[g].find(x => x.id === want);
        const off = p ? Object.keys(p.values).filter(k => typeof p.values[k] === 'number' ? !(Math.abs(T.cfg[k] - p.values[k]) < E) : T.cfg[k] !== p.values[k]).map(k => `${k} ${JSON.stringify(T.cfg[k])} vs ${JSON.stringify(p.values[k])}`) : [`no "${want}" preset`];
        return `currentPreset('${g}') is ${JSON.stringify(cur)} on a fresh profile, expected "${want}": ${off.join(', ')}`;
      }
      return true;
    } },
  { script: SHADERS, name: 'Array.prototype.indexOf is native again once the block names are captured',
    run: async () => {
      const T = window.Twitterentary;
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      // a bound wrapper would also print "[native code]", but not under the name "indexOf"
      const native = () => Function.prototype.toString.call([].indexOf).includes('[native code]') && [].indexOf.name === 'indexOf';
      if (await __tcwait(native, 10000)) return true;
      const names = T && typeof T.debug === 'function' ? !!T.debug().names : null;
      return `[].indexOf is still wrapped 10 s after the world loaded (block names ${names ? 'were' : 'were not'} captured): the hook should remove itself once it has them`;
    } },
  { script: SHADERS, name: 'the shadow map is redrawn only when something changed (camera, sun, chunks), not on a timer',
    run: async () => {
      const T = window.Twitterentary, st = T && T.state, S = T && T.stats;
      if (!S || !S.why || !st) return 'window.Twitterentary.stats.why or state missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      if (!T.cfg.enabled || !T.cfg.shadows) return `can't verify: shaders or shadows are off by default (enabled ${T.cfg.enabled}, shadows ${T.cfg.shadows})`;
      if (st.dim !== 0 || !(st.day > 0.1 && st.sun[1] > 0.06)) return `can't verify: no sun in the test world (dim ${st.dim}, day ${st.day}, sun ${JSON.stringify(st.sun)})`;
      if (!(await __tcwait(() => S.refreshes > 0, 20000))) return `shadow map never drawn: ${JSON.stringify(S)}`;
      // The title camera only turns (main.js: S.yaw -= dt * 0.03 until the world starts) and the title sun is
      // fixed, so nothing but chunks entering the view (dirty) and the 10 s safety net (age, SHADOW_AGE_MS) may
      // refresh it. An age refresh redraws the far tile and then the near one, so it counts 2 tile redraws.
      const w0 = Object.assign({}, S.why), f0 = st.frame, r0 = S.refreshes, t0 = performance.now();
      const tl0 = S.tiles ? { near: S.tiles.near, far: S.tiles.far } : null;
      await new Promise(r => setTimeout(r, 4000));
      // software GL (SwiftShader) renders only a few frames a second (about 4.5 locally, half that when other software
      // browsers run at the same time), so wait for 48 frames, up to 60 s, and judge from 24 frames up
      while (st.frame - f0 < 48 && performance.now() - t0 < 60000) await new Promise(r => setTimeout(r, 250));
      const ms = performance.now() - t0, frames = st.frame - f0, n = S.refreshes - r0, d = {};
      for (const k of Object.keys(S.why)) d[k] = (S.why[k] || 0) - (w0[k] || 0);
      const every = Math.max(1, Math.round(Number(T.cfg.shadowEvery)) || 1);
      // 1.5 has a near and a far shadow tile, and `refreshes` counts tile redraws. A far redraw is followed by its near
      // half on the next frame (that one skips the wait), so redraw events = max(near, far) tile redraws.
      const dn = tl0 ? S.tiles.near - tl0.near : 0, df = tl0 ? S.tiles.far - tl0.far : n, events = Math.max(dn, df);
      const info = `${n} refreshes (${tl0 ? `${dn} near + ${df} far tiles` : 'one map'}) in ${(ms / 1000).toFixed(1)} s / ${frames} frames, by reason ${JSON.stringify(d)}`;
      if (frames < 24) return `can't verify: only ${frames} frames rendered in ${(ms / 1000).toFixed(1)} s (${info})`;
      if (d.move !== 0) return `refreshed for camera movement, but the title camera only turns: ${info}`;
      if (d.sun !== 0) return `refreshed for sun movement, but the title world's sun is fixed: ${info}`;
      if (!(d.age <= 2 * (Math.floor(ms / 10000) + 1))) return `more safety-net (age) refreshes than one per 10 s (far + near tile each): ${info}`;
      return events <= frames / every + 2 || `more redraws than the limit of one per ${every} frames (shadowEvery): ${events} redraw events, ${info}`;
    } },
  { script: SHADERS, name: 'presets apply and are saved, set() clamps, and reset() restores the defaults and clears every tc.shader.* key',
    run: () => {
      const T = window.Twitterentary;
      if (!T || ['applyPreset', 'currentPreset', 'set', 'reset'].some(k => typeof T[k] !== 'function')) return 'window.Twitterentary.applyPreset/currentPreset/set/reset missing';
      const E = 1e-6, P = 'tc.shader.';
      const same = (a, b) => typeof b === 'number' ? Math.abs(Number(a) - b) < E : a === b;
      const saved = () => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(P)) out.push(k); } return out; };
      // All of this is synchronous, so no frame is ever drawn with the test values; reset() runs last regardless.
      let out = true;
      try {
        for (const g of ['quality', 'look']) for (const p of T.presets[g] || []) {
          T.applyPreset(g, p.id);
          const cur = T.currentPreset(g);
          if (cur !== p.id && out === true) out = `after applyPreset('${g}', '${p.id}') the picker reads ${JSON.stringify(cur)}`;
        }
        if (out === true) {
          T.applyPreset('quality', 'low');
          const v = localStorage.getItem(P + 'shadows');
          if (T.cfg.shadows !== false) out = `applyPreset('quality', 'low') left cfg.shadows = ${T.cfg.shadows}`;
          else if (v !== 'false') out = `applyPreset('quality', 'low') saved tc.shader.shadows = ${JSON.stringify(v)}, expected "false"`;
        }
        if (out === true) {
          const max = (T.schema.find(f => f.key === 'saturation') || {}).max;
          T.set('saturation', 99);
          if (!same(T.cfg.saturation, max)) out = `set('saturation', 99) gave ${T.cfg.saturation}, expected the slider max ${max}`;
          else if (T.currentPreset('look') !== null) out = `a custom saturation still reads as Look "${T.currentPreset('look')}", expected null (Custom)`;
        }
        localStorage.setItem(P + 'shadowTaps', '8'); // a key only older versions used
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try { T.reset(); } catch (e) { return `reset() threw: ${e.message}`; }
      }
      if (out !== true) return out;
      const left = saved();
      if (left.length) return `reset() left ${left.join(', ')} in localStorage`;
      const diff = Object.keys(T.defaults).filter(k => !same(T.cfg[k], T.defaults[k]));
      if (diff.length) return `after reset() cfg differs from the defaults: ${diff.map(k => `${k} ${JSON.stringify(T.cfg[k])} vs ${JSON.stringify(T.defaults[k])}`).join(', ')}`;
      const q = T.currentPreset('quality'), l = T.currentPreset('look');
      return (q === 'medium' && l === 'natural') || `after reset() the pickers read ${q} / ${l}, expected medium / natural`;
    } },
  // --- Shaders 1.5: render scale, scene FBO + composite, perf, stress and bench. Settings changes here are made in
  // memory (T.cfg.x = v, never saved) and put back in `finally`, except bench(), which must restore them itself.
  { script: SHADERS, name: 'the Performance settings renderScale, renderScaleMin and sharpen have their SCHEMA rows and defaults (Auto, 0.6, 0.5)',
    run: () => {
      const T = window.Twitterentary;
      if (!T || !Array.isArray(T.schema) || !T.defaults) return 'window.Twitterentary.schema/defaults missing';
      const E = 1e-6, bad = [];
      const want = {
        renderScale: { type: 'choice', def: 0, options: [[0, 'Auto'], [1, '100%'], [0.9, '90%'], [0.8, '80%'], [0.7, '70%'], [0.6, '60%'], [0.5, '50%']] },
        renderScaleMin: { type: 'num', def: 0.6, min: 0.5, max: 1, step: 0.05 },
        sharpen: { type: 'num', def: 0.5, min: 0, max: 1, step: 0.05 },
      };
      for (const [k, w] of Object.entries(want)) {
        const f = T.schema.find(x => x && x.key === k);
        if (!f) { bad.push(`no SCHEMA row for ${k}`); continue; }
        if (f.type !== w.type) bad.push(`${k}: type ${JSON.stringify(f.type)}, expected "${w.type}"`);
        if (f.group !== 'quality') bad.push(`${k}: group ${JSON.stringify(f.group)}, expected "quality" (the Quality presets set it)`);
        if (f.section !== 'Performance') bad.push(`${k}: section ${JSON.stringify(f.section)}, expected "Performance"`);
        if (w.options && JSON.stringify(f.options) !== JSON.stringify(w.options)) bad.push(`${k}: options ${JSON.stringify(f.options)}, expected ${JSON.stringify(w.options)}`);
        for (const p of ['min', 'max', 'step']) if (p in w && !(Math.abs(f[p] - w[p]) < E)) bad.push(`${k}: ${p} ${f[p]}, expected ${w[p]}`);
        if (typeof T.defaults[k] !== 'number' || !(Math.abs(T.defaults[k] - w.def) < E)) bad.push(`${k}: default ${JSON.stringify(T.defaults[k])}, expected ${w.def}`);
      }
      return !bad.length || bad.join('; ');
    } },
  { script: SHADERS, name: 'Twitterentary.perf has the 1.5 shape, is updated in place, and Auto keeps the scale within [renderScaleMin, 1]',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || !T.perf || typeof T.perf !== 'object') return 'window.Twitterentary.perf missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const P = T.perf, num = v => typeof v === 'number' && Number.isFinite(v);
      const shape = () => {
        const bad = [];
        for (const k of ['fps', 'ms', 'cpuMs', 'scale', 'shadowRefreshPerMin']) if (!num(P[k])) bad.push(`${k} ${JSON.stringify(P[k])} is not a number`);
        if (!(P.gpuMs === null || num(P.gpuMs))) bad.push(`gpuMs ${JSON.stringify(P.gpuMs)} is neither a number nor null`);
        for (const k of ['cpuBound', 'timer']) if (typeof P[k] !== 'boolean') bad.push(`${k} ${JSON.stringify(P[k])} is not a boolean`);
        if (P.timer === false && P.gpuMs !== null) bad.push(`gpuMs is ${P.gpuMs} although timer is false (no GPU timer query)`);
        return bad;
      };
      if (!(await __tcwait(() => num(P.fps) && P.fps > 0 && num(P.ms) && P.ms > 0, 15000))) return `perf.fps/ms never became positive numbers: ${JSON.stringify(P)}`;
      let bad = shape();
      if (bad.length) return bad.join('; ');
      if (T.cfg.renderScale !== 0) return `can't verify Auto: cfg.renderScale is ${JSON.stringify(T.cfg.renderScale)} on a fresh profile, expected 0 (Auto)`;
      // at least 3 s and 8 frames on Auto (the default; software GL can be very slow): the governor may move the
      // scale, but only inside its range. The published means (fps, ms, cpuMs, scale) are rewritten together at most
      // once per 250 ms, at a frame: so they change at least every other frame (on a 1-2 FPS runner every frame
      // publishes, and cpuMs still moves when no interval is under 1 s), and never more than ~4 times a second.
      // (perf.frame and the GPU ring change every frame, so they are not compared.) Up to 30 s for 8 frames: a
      // slow CI runner (SwiftShader at ~1 FPS) still gets there, inside the harness's 90 s per check.
      const lo = Number(T.cfg.renderScaleMin), t0 = performance.now(), f0 = T.state.frame;
      const pub = () => `${P.fps}|${P.ms}|${P.cpuMs}|${P.scale}`;
      let changes = 0, last = pub();
      while (performance.now() - t0 < 3000 || (T.state.frame - f0 < 8 && performance.now() - t0 < 30000)) {
        await new Promise(r => setTimeout(r, 100));
        if (T.perf !== P) return 'Twitterentary.perf was replaced by a new object: it must be mutated in place (the overlay and bench keep a reference)';
        const s = pub();
        if (s !== last) { changes++; last = s; }
        if (!(P.scale >= lo - 1e-6 && P.scale <= 1 + 1e-6)) return `on Auto perf.scale is ${P.scale}, outside [renderScaleMin ${lo}, 1]`;
      }
      bad = shape();
      if (bad.length) return bad.join('; ');
      const frames = T.state.frame - f0, secs = ((performance.now() - t0) / 1000).toFixed(1);
      const brief = () => JSON.stringify(Object.fromEntries(Object.entries(P).filter(([, v]) => !ArrayBuffer.isView(v))));
      if (frames < 4) return `can't verify: only ${frames} frames in ${secs} s (perf ${brief()})`;
      if (changes < Math.min(3, Math.floor(frames / 2))) return `perf.fps/ms/cpuMs/scale changed only ${changes} times in ${secs} s / ${frames} frames (they should update about 4 times a second): ${brief()}`;
      const most = Math.floor((performance.now() - t0) / 250) + 1;
      return changes <= most || `perf.fps/ms/cpuMs/scale changed ${changes} times in ${secs} s / ${frames} frames, more than once per 250 ms (at most ${most}): they should be published about 4 times a second, not every frame: ${brief()}`;
    } },
  { script: SHADERS, name: 'at a fixed 70% render scale every frame renders into the scene FBO at ceil(canvas × 0.7) and is composited, following canvas resizes and a regainCanvases()-style reallocation',
    run: async () => {
      const T = window.Twitterentary, c = document.getElementById('gl');
      if (!T || !T.stats || !T.stats.post || !T.perf || !T.state) return 'window.Twitterentary.stats.post/perf/state missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      if (!T.cfg.enabled) return 'can\'t verify: shaders are off by default';
      const post = T.stats.post, st = T.state, S = 0.7, prev = T.cfg.renderScale, W = c.width, H = c.height;
      const near = (a, b) => Math.abs(a - b) <= 1;
      const info = () => `stats.post ${JSON.stringify(post)}, perf.scale ${T.perf.scale}, canvas ${c.width}x${c.height}`;
      // n more composites, with the scene at the current canvas size × S
      const follows = async (n, ms) => {
        const c0 = post.composites;
        return __tcwait(() => post.ok === true && post.active === true && post.composites >= c0 + n && near(post.w, Math.ceil(c.width * S)) && near(post.h, Math.ceil(c.height * S)), ms);
      };
      if (post.ok !== true) return `stats.post.ok is ${JSON.stringify(post.ok)} before the test: the FBO path was turned off after an error`;
      if (W < 704 || H < 396) return `can't verify: the canvas is ${W}x${H}, too small to test (the FBO is bypassed below 640x360)`;
      try {
        T.cfg.renderScale = S; // in memory only: applies from the next frame, never saved
        if (!(await follows(3, 20000))) return `with cfg.renderScale = 0.7 the frames were not composited from a ceil(canvas × 0.7) scene: ${info()}`;
        // (waits below: up to 10-20 s, so a ~1 FPS CI runner gets its frames; each condition holds right after a frame)
        if (!(await __tcwait(() => post.frame === st.frame, 10000))) return `the last composite was frame ${post.frame}, but the last frame drawn is ${st.frame}: not every frame is composited`;
        if (!(await __tcwait(() => Math.abs(T.perf.scale - S) < 1e-6, 10000))) return `perf.scale is ${T.perf.scale} at a fixed render scale of 0.7`;
        // a canvas resize: the FBO must follow canvas.width/height at the next frame viewport
        c.width = W - 64; c.height = H - 36;
        if (!(await follows(2, 20000))) return `after resizing the canvas to ${W - 64}x${H - 36} the scene did not follow: ${info()}`;
        c.width = W; c.height = H;
        // what gpuwatch's regainCanvases() does when FPS stays low: width to 1 (or 2) and straight back
        for (let i = 0; i < 2; i++) { const w = c.width; c.width = w > 1 ? 1 : 2; c.width = w; }
        if (!(await follows(2, 20000))) return `after a regainCanvases()-style reallocation the composite did not recover: ${info()}`;
        return true;
      } finally {
        if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
        T.cfg.renderScale = prev;
      }
    } },
  { script: SHADERS, name: 'after a composited frame the canvas framebuffer is bound with a full viewport, the GL state is what a direct frame leaves, and the canvas shows the scene',
    run: async () => {
      const T = window.Twitterentary, c = document.getElementById('gl');
      if (!T || !T.stats || !T.stats.post || !T.state) return 'window.Twitterentary.stats.post/state missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      if (!T.cfg.enabled) return 'can\'t verify: shaders are off by default';
      const gl = c.getContext('webgl2'), post = T.stats.post, prev = T.cfg.renderScale;
      if (!gl) return 'no webgl2 context on #gl';
      // A rAF callback queued now runs after the game's (the game re-arms at the start of its callback), so after the
      // game's frame and the composite microtask, and before the frame is presented (the drawing buffer is intact).
      const afterFrame = fn => new Promise(res => requestAnimationFrame(() => { try { res(fn()); } catch (e) { res({ error: e.message }); } }));
      const read = () => ({
        fb: gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING), readFb: gl.getParameter(gl.READ_FRAMEBUFFER_BINDING),
        viewport: [...gl.getParameter(gl.VIEWPORT)].join(','), program: gl.getParameter(gl.CURRENT_PROGRAM),
        vao: gl.getParameter(gl.VERTEX_ARRAY_BINDING), arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
        unit: gl.getParameter(gl.ACTIVE_TEXTURE) - gl.TEXTURE0, tex2d: gl.getParameter(gl.TEXTURE_BINDING_2D), texArray: gl.getParameter(gl.TEXTURE_BINDING_2D_ARRAY),
        depthTest: gl.isEnabled(gl.DEPTH_TEST), cull: gl.isEnabled(gl.CULL_FACE), blend: gl.isEnabled(gl.BLEND), scissor: gl.isEnabled(gl.SCISSOR_TEST),
        depthMask: gl.getParameter(gl.DEPTH_WRITEMASK), colorMask: [...gl.getParameter(gl.COLOR_WRITEMASK)].join(','), depthFunc: gl.getParameter(gl.DEPTH_FUNC),
        blendFunc: [gl.BLEND_SRC_RGB, gl.BLEND_DST_RGB, gl.BLEND_SRC_ALPHA, gl.BLEND_DST_ALPHA].map(k => gl.getParameter(k)).join(','),
        _composited: post.active === true && post.frame === T.state.frame, _w: c.width, _h: c.height,
      });
      // mean colour of the lower and upper half of the centre quarter (readPixels rows go bottom-up)
      const image = () => {
        const rw = c.width >> 1, rh = c.height >> 1, px = new Uint8Array(rw * rh * 4);
        gl.readPixels((c.width - rw) >> 1, (c.height - rh) >> 1, rw, rh, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const mean = (y0, y1) => { const s = [0, 0, 0]; let n = 0; for (let y = y0; y < y1; y += 2) for (let x = 0; x < rw; x += 2) { const i = (y * rw + x) * 4; s[0] += px[i]; s[1] += px[i + 1]; s[2] += px[i + 2]; n++; } return s.map(v => Math.round(v / n)); };
        return { low: mean(0, rh >> 1), high: mean(rh >> 1, rh) };
      };
      const ids = [], name = v => v === null ? 'null' : typeof v === 'object' ? `${v.constructor.name}#${(ids.indexOf(v) + 1) || ids.push(v)}` : JSON.stringify(v);
      try {
        T.cfg.renderScale = 1; // direct: no FBO
        // one frame each: 20 s covers a ~1 FPS CI runner (the waits end as soon as the frame is drawn)
        if (!(await __tcwait(() => post.active === false, 20000))) return `can't verify: at cfg.renderScale = 1 stats.post.active stays ${post.active} (expected a direct frame)`;
        await afterFrame(() => 0);
        const d = [await afterFrame(() => ({ s: read(), img: image() })), await afterFrame(() => ({ s: read() }))];
        T.cfg.renderScale = 0.7;
        if (!(await __tcwait(() => post.active === true && post.ok === true, 20000))) return `with cfg.renderScale = 0.7 the FBO path never became active: ${JSON.stringify(post)}`;
        await afterFrame(() => 0);
        const p = [await afterFrame(() => ({ s: read(), img: image() })), await afterFrame(() => ({ s: read() }))];
        const err = [...d, ...p].find(x => x.error);
        if (err) return `reading the GL state threw: ${err.error}`;
        const bad = [];
        for (const [i, x] of p.entries()) {
          if (!x.s._composited) bad.push(`frame ${i + 1} was not composited (stats.post ${JSON.stringify(post)})`);
          if (x.s.fb !== null || x.s.readFb !== null) bad.push(`frame ${i + 1}: framebuffer ${name(x.s.fb)} / read ${name(x.s.readFb)} is bound after the composite, expected the canvas (null)`);
          if (x.s.viewport !== `0,0,${x.s._w},${x.s._h}`) bad.push(`frame ${i + 1}: viewport ${x.s.viewport} after the composite, expected 0,0,${x.s._w},${x.s._h}`);
        }
        // compare only what is stable between the two direct frames (the title camera turns, but the draw order is fixed)
        const keys = Object.keys(d[0].s).filter(k => !k.startsWith('_'));
        const unstable = keys.filter(k => d[0].s[k] !== d[1].s[k]);
        for (const k of keys) if (!unstable.includes(k)) for (const [i, x] of p.entries()) if (x.s[k] !== d[0].s[k]) bad.push(`frame ${i + 1}: ${k} is ${name(x.s[k])} after the composite, ${name(d[0].s[k])} after a direct frame`);
        if (bad.length) return [...new Set(bad)].slice(0, 8).join('; ') + (unstable.length ? ` (not compared, unstable between direct frames: ${unstable.join(', ')})` : '');
        const a = d[0].img, b = p[0].img, dark = v => v[0] + v[1] + v[2] < 24;
        if (dark(b.low) && dark(b.high)) return `the composited canvas is black (centre means ${JSON.stringify(b)}; direct frame ${JSON.stringify(a)})`;
        const off = ['low', 'high'].filter(h => a[h].some((v, i) => Math.abs(v - b[h][i]) > 40));
        return !off.length || `the composited canvas does not look like the direct frame (centre-quarter means, lower/upper half): direct ${JSON.stringify(a)}, composited ${JSON.stringify(b)}`;
      } finally {
        T.cfg.renderScale = prev;
      }
    } },
  { script: SHADERS, name: 'stress({ shadowRefreshEvery }) forces shadow refreshes in memory only, and stress({}) turns it off',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.stress !== 'function' || typeof T.debug !== 'function' || !T.stats) return 'window.Twitterentary.stress/debug/stats missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const S = T.stats, st = T.state, PFX = 'tc.shader.';
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); };
      const every = () => { const s = T.debug().stress; return s && s.shadowRefreshEvery; };
      const forced = () => (S.why && S.why.stress) || 0;
      if (every() !== 0) return `debug().stress is ${JSON.stringify(T.debug().stress)} before any stress() call, expected { shadowRefreshEvery: 0 } (off)`;
      const ls0 = saved();
      let out = true;
      try {
        T.stress({ shadowRefreshEvery: 2 });
        if (every() !== 2) out = `after stress({ shadowRefreshEvery: 2 }) debug().stress is ${JSON.stringify(T.debug().stress)}`;
        else if (T.cfg.enabled && T.cfg.shadows && st.dim === 0 && st.day > 0.1 && st.sun[1] > 0.06) { // a sun to cast shadows (the title world at noon)
          const w0 = forced(), r0 = S.refreshes;
          // two forced near-tile redraws take ~4-5 frames: up to 30 s for a ~1 FPS CI runner
          if (!(await __tcwait(() => forced() >= w0 + 2 && S.refreshes >= r0 + 2, 30000))) out = `stress({ shadowRefreshEvery: 2 }) forced no shadow refreshes: stats.why ${JSON.stringify(S.why)}, debug().stress ${JSON.stringify(T.debug().stress)}`;
        }
        if (out === true && saved() !== ls0) out = `stress() wrote tc.shader.* localStorage (it must stay in memory): ${saved()}`;
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try { T.stress({}); } catch (e) { return `stress({}) threw: ${e.message}`; }
      }
      if (out !== true) return out;
      if (every() !== 0) return `after stress({}) debug().stress is ${JSON.stringify(T.debug().stress)}, expected shadowRefreshEvery 0 (off)`;
      const w1 = forced(), f1 = st.frame;
      await __tcwait(() => st.frame >= f1 + 6, 20000); // 6 frames with stress off (up to 20 s on a slow runner)
      return forced() === w1 || `forced refreshes continued after stress({}): stats.why.stress ${w1} -> ${forced()}`;
    } },
  { script: SHADERS, name: 'bench() runs where the player is, resolves with one row per scenario (each measured on its own frames), rejects a concurrent call, and restores every setting and tc.shader.* value',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.bench !== 'function' || typeof T.set !== 'function' || typeof T.reset !== 'function') return 'window.Twitterentary.bench/set/reset missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const PFX = 'tc.shader.', num = v => typeof v === 'number' && Number.isFinite(v);
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return o; };
      const cfgNow = () => JSON.stringify(Object.keys(T.cfg).sort().map(k => [k, T.cfg[k]]));
      const ls0 = saved(), cfg0 = Object.assign({}, T.cfg);
      let out = true;
      try {
        if (T.bench.running !== false) return `bench.running is ${JSON.stringify(T.bench.running)} before any bench, expected false`;
        // a saved non-default value, so "restored" covers an existing key as well as the keys a preset would add
        T.set('saturation', 1.1);
        const lsB = JSON.stringify(saved()), cfgB = cfgNow();
        // The second scenario has a fixed scale, so its row must read exactly 0.7: a row averaged over the frames of
        // earlier rows too (a recorder field not reset between scenarios) reads less. On a slow runner bench() itself
        // extends each window until 3 frames (at most 5 s more), so rows have numbers down to ~0.2 FPS.
        const SC = ['off', 'low+renderScale=0.7'], fixedOk = !!(T.stats && T.stats.post && T.stats.post.ok === true);
        const p1 = T.bench({ seconds: 0.5, warmup: 0.2, scenarios: SC });
        const running = T.bench.running;
        const p2 = T.bench({ seconds: 0.5, warmup: 0.2, scenarios: ['off'] });
        const second = p2 && typeof p2.then === 'function' ? await p2.then(() => 'resolved', e => `rejected (${e && e.message})`) : `returned ${typeof p2}, not a Promise`;
        let res;
        try { res = await Promise.race([p1, new Promise((_, no) => setTimeout(() => no(new Error('did not settle within 60 s')), 60000))]); } catch (e) { return `bench() rejected: ${e && e.message}`; }
        const bad = [];
        if (running !== true) bad.push(`bench.running was ${JSON.stringify(running)} right after the call, expected true`);
        if (!second.startsWith('rejected')) bad.push(`a second bench() while one runs ${second}, expected a rejection`);
        if (T.bench.running !== false) bad.push(`bench.running is ${JSON.stringify(T.bench.running)} after the bench resolved`);
        const env = res && res.env;
        if (!env || typeof env.gpu !== 'string' || !(env.w > 0) || !(env.h > 0) || !num(env.dpr) || typeof env.timer !== 'boolean' || env.version !== T.version) bad.push(`env ${JSON.stringify(env)} should be { gpu, w, h, dpr, version: "${T.version}", timer }`);
        const rows = res && Array.isArray(res.rows) ? res.rows : null;
        if (!rows || rows.map(r => r && r.name).join() !== SC.join()) bad.push(`rows are ${JSON.stringify(rows && rows.map(r => r && r.name))}, expected one per scenario: ${SC.join(', ')}`);
        else {
          for (const r of rows) {
            if (!(num(r.fps) && r.fps > 0 && num(r.ms) && r.ms > 0)) bad.push(`row ${r.name}: fps ${r.fps}, ms ${r.ms} should be positive numbers`);
            else if (Math.abs(r.fps * r.ms - 1000) > 10) bad.push(`row ${r.name}: fps ${r.fps} x ms ${r.ms} is not 1000 (fps should be 1000 / the mean frame ms)`);
            for (const k of ['p95', 'low1', 'cpuMs', 'gpuMs', 'scale']) if (!(r[k] === null || num(r[k]))) bad.push(`row ${r.name}: ${k} ${JSON.stringify(r[k])} is neither a number nor null`);
          }
          if ('aborted' in res) bad.push(`a bench that ran to the end has aborted: ${JSON.stringify(res.aborted)} (only an aborted one should)`);
          if (rows[0].scale !== 1) bad.push(`row off: scale ${JSON.stringify(rows[0].scale)}, expected 1 (shaders off render directly)`);
          if (fixedOk && !(Math.abs(rows[1].scale - 0.7) < 0.005)) bad.push(`row ${SC[1]}: scale ${JSON.stringify(rows[1].scale)}, expected 0.7 (a fixed render scale; less means the row was averaged over the frames of other rows too)`);
        }
        if (JSON.stringify(saved()) !== lsB) bad.push(`tc.shader.* localStorage changed: before ${lsB}, after ${JSON.stringify(saved())}`);
        if (cfgNow() !== cfgB) { const b = JSON.parse(cfgB); bad.push(`cfg not restored: ${b.filter(([k, v]) => T.cfg[k] !== v).map(([k, v]) => `${k} ${JSON.stringify(T.cfg[k])} (was ${JSON.stringify(v)})`).join(', ')}`); }
        if (bad.length) out = bad.slice(0, 8).join('; ');
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        // back to exactly what the check found (normally a fresh profile: the defaults, no tc.shader.* keys)
        try {
          T.reset();
          for (const k of Object.keys(cfg0)) if (T.cfg[k] !== cfg0[k]) T.cfg[k] = cfg0[k];
          for (const k of Object.keys(saved())) localStorage.removeItem(k);
          for (const [k, v] of Object.entries(ls0)) localStorage.setItem(k, v);
        } catch (e) {}
      }
      return out;
    } },
  { script: SHADERS, name: 'bench.abort() stops a run at once: settings and tc.shader.* restored and running false before it returns, the promise resolves within a microtask with the finished rows and aborted: true, a new bench can start right after, and K (the shader toggle) is ignored while one runs',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.bench !== 'function' || typeof T.set !== 'function' || typeof T.reset !== 'function' || typeof T.stress !== 'function') return 'window.Twitterentary.bench/set/reset/stress missing';
      if (typeof T.bench.abort !== 'function') return 'Twitterentary.bench.abort missing (Better Options stops a run on Escape with it)';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const PFX = 'tc.shader.', E = 1e-6;
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return o; };
      const cfgNow = () => JSON.stringify(Object.keys(T.cfg).sort().map(k => [k, T.cfg[k]]));
      const stressNow = () => { const s = T.debug().stress || {}; return `${s.shadowRefreshEvery}|${s.moveSpeed}`; };
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      // settles p within 60 s, and records whether it settled before the first timer after now (= within the
      // current microtask checkpoint)
      const track = p => { const t = { done: false, value: undefined, error: null }; p.then(v => { t.done = true; t.value = v; }, e => { t.done = true; t.error = e || new Error('rejected'); }); return t; };
      const settle = async (t, ms = 60000) => { const t0 = performance.now(); while (!t.done && performance.now() - t0 < ms) await sleep(50); return t.done; };
      // a K keydown on the page; returns what tc.shader.enabled reads right after
      const key = () => { document.body.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyK', key: 'k', bubbles: true, cancelable: true })); return { saved: localStorage.getItem(PFX + 'enabled') }; };
      const ls0 = saved(), cfg0 = Object.assign({}, T.cfg), bad = [];
      let out = true;
      try {
        if (T.bench.running !== false) return `can't verify: bench.running is ${JSON.stringify(T.bench.running)} before the test`;
        if (localStorage.getItem(PFX + 'enabled') !== null) return `can't verify: tc.shader.enabled is saved (${localStorage.getItem(PFX + 'enabled')}) before the test`;
        const idle = T.bench.abort();
        if (idle !== false) bad.push(`abort() with no bench running returned ${JSON.stringify(idle)}, expected false`);
        T.set('saturation', 1.1); // a saved non-default value, so "restored" also covers an existing key
        const lsB = JSON.stringify(saved()), cfgB = cfgNow(), stB = stressNow();
        // Abort during the second scenario, which differs visibly (shaders on, a fixed 70% scale, the -moving
        // drift), so abort() must undo in-memory CFG and stress() too. 3 s windows leave time to land inside it.
        const SC = ['off', 'low+renderScale=0.7-moving'];
        const tr = track(T.bench({ seconds: 3, warmup: 0.2, scenarios: SC }));
        const inSecond = () => T.cfg.enabled === true && Math.abs(T.cfg.renderScale - 0.7) < E && T.debug().stress.moveSpeed > 0;
        const t0 = performance.now();
        while (!tr.done && !inSecond() && performance.now() - t0 < 40000) await sleep(50);
        if (tr.done || !inSecond()) bad.push(`can't verify: the second scenario never started (bench ${tr.done ? 'already settled' : 'still running'}, cfg.enabled ${T.cfg.enabled}, renderScale ${T.cfg.renderScale}, stress ${JSON.stringify(T.debug().stress)})`);
        else {
          // K (the shader toggle) is ignored while a bench runs: it would save enabled and skew the row
          const k = key();
          if (T.cfg.enabled !== true || k.saved !== null) bad.push(`K during a bench toggled the shaders (cfg.enabled ${T.cfg.enabled}, tc.shader.enabled ${JSON.stringify(k.saved)}): it must be ignored while bench.running`);
          const ret = T.bench.abort();
          // all of this must already hold when abort() returns (Better Options reopens its menu right away)
          const now = { running: T.bench.running, cfg: cfgNow(), ls: JSON.stringify(saved()), st: stressNow(), done: tr.done };
          const again = T.bench.abort();
          await sleep(0); // one timer later: every microtask queued by abort() has run
          const inMicrotask = tr.done;
          if (ret !== true) bad.push(`abort() during a run returned ${JSON.stringify(ret)}, expected true`);
          if (again !== false) bad.push(`a second abort() returned ${JSON.stringify(again)}, expected false (nothing left to stop)`);
          if (now.running !== false) bad.push(`bench.running was ${JSON.stringify(now.running)} when abort() returned, expected false`);
          if (now.cfg !== cfgB) { const b = JSON.parse(cfgB), a = JSON.parse(now.cfg); bad.push(`cfg not restored when abort() returned: ${b.filter(([k, v], i) => a[i][1] !== v).map(([k, v], i) => `${k} ${JSON.stringify(a[i][1])} (was ${JSON.stringify(v)})`).join(', ')}`); }
          if (now.ls !== lsB) bad.push(`tc.shader.* not restored when abort() returned: before ${lsB}, then ${now.ls}`);
          if (now.st !== stB) bad.push(`stress() state not restored when abort() returned: ${now.st}, was ${stB} (shadowRefreshEvery|moveSpeed)`);
          if (!inMicrotask) bad.push('the bench promise had not settled one timer after abort() (it should resolve within a microtask)');
          if (!(await settle(tr))) bad.push('the aborted bench never settled');
          else if (tr.error) bad.push(`the aborted bench rejected (${tr.error.message}), expected it to resolve`);
          else {
            const res = tr.value, rows = res && Array.isArray(res.rows) ? res.rows : null, env = res && res.env;
            if (!res || res.aborted !== true) bad.push(`the aborted bench resolved without aborted: true (${JSON.stringify(res && res.aborted)})`);
            if (!env || typeof env.gpu !== 'string' || env.version !== T.version) bad.push(`the aborted bench's env is ${JSON.stringify(env)}`);
            if (!rows || rows.map(r => r && r.name).join() !== SC[0]) bad.push(`the aborted bench's rows are ${JSON.stringify(rows && rows.map(r => r && r.name))}, expected only the finished "${SC[0]}" (the window in progress is discarded)`);
            else if (!(rows[0].fps > 0)) bad.push(`the finished row has fps ${rows[0].fps}`);
          }
        }
        // a new bench right after, aborted at once: no finished rows
        const t2 = track(T.bench({ seconds: 0.3, warmup: 0, scenarios: ['off'] }));
        if (T.bench.running !== true) bad.push(`a bench() right after an abort did not start (running ${JSON.stringify(T.bench.running)})`);
        const ret2 = T.bench.abort();
        if (ret2 !== true || !(await settle(t2))) bad.push(`aborting a bench at once returned ${JSON.stringify(ret2)}${t2.done ? '' : ' and it never settled'}`);
        else if (t2.error || !t2.value || t2.value.aborted !== true || !Array.isArray(t2.value.rows) || t2.value.rows.length) bad.push(`a bench aborted before any row finished gave ${t2.error ? `a rejection (${t2.error.message})` : JSON.stringify(t2.value && { aborted: t2.value.aborted, rows: t2.value.rows })}, expected { rows: [], aborted: true }`);
        // and one more, run to the end: the old shape, no aborted key
        const t3 = track(T.bench({ seconds: 0.3, warmup: 0, scenarios: ['off'] }));
        if (!(await settle(t3))) bad.push('a bench after two aborts never settled');
        else if (t3.error) bad.push(`a bench after two aborts rejected (${t3.error.message})`);
        else if ('aborted' in t3.value || !Array.isArray(t3.value.rows) || t3.value.rows.map(r => r && r.name).join() !== 'off') bad.push(`a bench after two aborts gave ${JSON.stringify({ aborted: t3.value.aborted, rows: t3.value.rows && t3.value.rows.map(r => r && r.name) })}, expected the "off" row and no aborted key`);
        if (T.bench.running !== false) bad.push(`bench.running is ${JSON.stringify(T.bench.running)} at the end`);
        if (JSON.stringify(saved()) !== lsB || cfgNow() !== cfgB) bad.push('settings or tc.shader.* differ from before the benches at the end');
        // control: with no bench running K does toggle (twice: back where it was; `finally` restores the saved keys)
        const e0 = T.cfg.enabled; key(); const e1 = T.cfg.enabled; key(); const e2 = T.cfg.enabled;
        if (e1 === e0 || e2 !== e0) bad.push(`K with no bench running gave cfg.enabled ${e0} -> ${e1} -> ${e2}, expected a toggle per press (without it the "K is ignored during a bench" test proves nothing)`);
        if (bad.length) out = bad.slice(0, 8).join('; ');
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try {
          if (T.bench.running) T.bench.abort();
          T.reset();
          for (const k of Object.keys(cfg0)) if (T.cfg[k] !== cfg0[k]) T.cfg[k] = cfg0[k];
          for (const k of Object.keys(saved())) localStorage.removeItem(k);
          for (const [k, v] of Object.entries(ls0)) localStorage.setItem(k, v);
          T.stress({});
        } catch (e) {}
      }
      return out;
    } },
  { script: SHADERS, name: 'debug() counts remeshes (a non-negative integer that never goes down) and the governor\'s refresh estimate, and no VAO is left bound after a frame (remeshes run between frames under the VAO the last frame left)',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.debug !== 'function') return 'window.Twitterentary.debug missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const c = document.getElementById('gl'), gl = c && c.getContext('webgl2');
      if (!gl) return 'no webgl2 context on #gl';
      const bad = [], prev = T.cfg.renderScale;
      const d0 = T.debug(), r0 = d0.remeshes;
      if (!Number.isInteger(r0) || r0 < 0) return `debug().remeshes is ${JSON.stringify(r0)}, expected a non-negative integer`;
      const g = d0.governor;
      if (!g || typeof g.refreshMs !== 'number' || !Number.isFinite(g.refreshMs) || !(g.refreshMs > 0)) bad.push(`debug().governor.refreshMs is ${JSON.stringify(g && g.refreshMs)}, expected a positive number of ms (the display refresh estimate)`);
      // A rAF callback queued now runs after the game's frame (and our composite), before the next frame's
      // updateChunks() remeshes. The bindBuffer hook pairs a VBO with the VAO bound at its first bind, so a VAO
      // left bound here would be the one a newly created VBO gets paired with, if the game ever bound it first.
      const afterFrame = () => new Promise(res => requestAnimationFrame(() => { try { res(gl.getParameter(gl.VERTEX_ARRAY_BINDING)); } catch (e) { res(e); } }));
      try {
        for (const [s, what] of [[1, 'a direct frame (renderScale 1)'], [0.7, 'a composited frame (renderScale 0.7)']]) {
          T.cfg.renderScale = s; // in memory only
          await afterFrame();
          const v = [await afterFrame(), await afterFrame()];
          if (v.some(x => x instanceof Error)) bad.push(`reading VERTEX_ARRAY_BINDING threw: ${v.find(x => x instanceof Error).message}`);
          else if (v.some(x => x !== null)) bad.push(`a VAO is still bound after ${what}`);
        }
      } finally {
        T.cfg.renderScale = prev;
      }
      const r1 = T.debug().remeshes;
      if (!Number.isInteger(r1) || r1 < r0) bad.push(`debug().remeshes went from ${r0} to ${JSON.stringify(r1)}`);
      return !bad.length || bad.join('; ');
    } },
  { script: SHADERS, name: 'stress({ moveSpeed }) emulates a walking camera for the shadow redraw decision (counted as why.move, not why.stress), in memory only, and stress({}) stops it',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.stress !== 'function' || typeof T.debug !== 'function' || !T.stats || !T.stats.why) return 'window.Twitterentary.stress/debug/stats.why missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const S = T.stats, st = T.state, PFX = 'tc.shader.';
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); };
      const info = () => T.debug().stress || {};
      const why = k => (S.why && S.why[k]) || 0;
      if (info().mode !== 'off') return `debug().stress is ${JSON.stringify(info())} before the test, expected mode "off"`;
      if (!T.cfg.enabled || !T.cfg.shadows) return `can't verify: shaders or shadows are off by default (enabled ${T.cfg.enabled}, shadows ${T.cfg.shadows})`;
      if (st.dim !== 0 || !(st.day > 0.1 && st.sun[1] > 0.06)) return `can't verify: no sun in the test world (dim ${st.dim}, day ${st.day}, sun ${JSON.stringify(st.sun)})`;
      const ls0 = saved();
      let out = true;
      try {
        const echo = T.stress({ moveSpeed: 22 });
        const i1 = info();
        if (!echo || echo.mode !== 'moveSpeed' || echo.moveSpeed !== 22 || echo.shadowRefreshEvery !== 0) out = `stress({ moveSpeed: 22 }) returned ${JSON.stringify(echo)}, expected { mode: "moveSpeed", moveSpeed: 22, shadowRefreshEvery: 0, ... }`;
        else if (i1.mode !== 'moveSpeed' || i1.moveSpeed !== 22) out = `after stress({ moveSpeed: 22 }) debug().stress is ${JSON.stringify(i1)}`;
        else {
          // The title camera only turns, so every why.move redraw from here on is the emulated walk. At 22 blocks/s
          // the near tile passes shadowMove blocks within a second (up to 30 s for a ~1 FPS CI runner).
          const m0 = why('move'), s0 = why('stress'), d0 = Number(i1.drifted) || 0;
          if (!(await __tcwait(() => why('move') >= m0 + 2 && info().drifted > d0, 30000))) out = `stress({ moveSpeed: 22 }) caused no camera-movement redraws: stats.why ${JSON.stringify(S.why)}, debug().stress ${JSON.stringify(info())}`;
          else if (why('stress') !== s0) out = `stress({ moveSpeed }) counted forced (why.stress) redraws ${s0} -> ${why('stress')}: the emulated walk should go through the real redraw rules (why.move)`;
        }
        if (out === true && saved() !== ls0) out = `stress() wrote tc.shader.* localStorage (it must stay in memory): ${saved()}`;
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try { T.stress({}); } catch (e) { return `stress({}) threw: ${e.message}`; }
      }
      if (out !== true) return out;
      const i2 = info();
      if (i2.mode !== 'off' || i2.moveSpeed !== 0) return `after stress({}) debug().stress is ${JSON.stringify(i2)}, expected mode "off", moveSpeed 0`;
      // a move redraw may still be due from the last drift; after that settles, none may follow
      const f1 = st.frame;
      await __tcwait(() => st.frame >= f1 + 2, 10000);
      const m1 = why('move'), f2 = st.frame;
      await __tcwait(() => st.frame >= f2 + 6, 20000); // 6 frames with it off (up to 20 s on a slow runner)
      return why('move') === m1 || `camera-movement redraws continued after stress({}) although the title camera only turns: stats.why.move ${m1} -> ${why('move')}`;
    } },
  // --- Better Options 1.2: performance overlay (#tc-perf) and its keybind
  { script: OPTIONS, name: 'the performance overlay keybind (tc.perfOverlay) defaults to F2, a key no game module handles, and no other mod keybind uses it',
    run: () => {
      const bus = window.__tcOptions;
      if (!bus || typeof bus._keybinds !== 'function') return 'window.__tcOptions._keybinds missing';
      const list = bus._keybinds() || [], kb = list.find(k => k && k.id === 'tc.perfOverlay');
      if (!kb) return `no tc.perfOverlay keybind registered (registered: ${list.map(k => k && k.id).join(', ') || 'none'})`;
      if (kb.key !== 'F2') return `tc.perfOverlay is on ${JSON.stringify(kb.key)} on a fresh profile, expected F2 (the key compat proves the game does not use)`;
      const clash = list.filter(k => k && k !== kb && k.key === kb.key);
      return !clash.length || `F2 is also the key of ${clash.map(k => k.id).join(', ')}`;
    } },
  { script: OPTIONS, name: 'F2 toggles the performance overlay (#tc-perf, saved as perf.overlay), which shows the live Twitterentary.perf numbers',
    run: async () => {
      const bus = window.__tcOptions;
      if (!bus || typeof bus.get !== 'function' || typeof bus.set !== 'function') return 'window.__tcOptions.get/set missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const el = () => document.getElementById('tc-perf');
      const shown = () => !!el() && !el().hidden && getComputedStyle(el()).display !== 'none';
      const line = k => { const x = el() && el().querySelector(`[data-l="${k}"]`); return x && !x.hidden ? x.textContent.trim() : null; };
      const press = () => window.dispatchEvent(new KeyboardEvent('keydown', { code: 'F2', key: 'F2', bubbles: true, cancelable: true }));
      if (bus.get('perf.overlay')) return `can't verify: perf.overlay is ${JSON.stringify(bus.get('perf.overlay'))} on a fresh profile, expected off`;
      if (shown()) return '#tc-perf is shown while perf.overlay is off';
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // keys are ignored while typing
      let out = true;
      try {
        press();
        if (!(await __tcwait(() => shown() && bus.get('perf.overlay') === true, 2000))) return `F2 did not show #tc-perf (perf.overlay ${JSON.stringify(bus.get('perf.overlay'))}, element ${el() ? 'hidden' : 'missing'})`;
        const T = window.Twitterentary;
        if (T && T.perf) {
          await new Promise(r => setTimeout(r, 600)); // past the first 250 ms refresh
          const n = '(?:\\d+(?:\\.\\d+)?|--)', bad = [];
          if (!new RegExp(`^${n} FPS · ${n} ms$`).test(line('fps') || '')) bad.push(`fps line "${line('fps')}"`);
          if (!new RegExp(`^CPU ${n} ms · GPU (?:${n} ms|n/a)$`).test(line('cpu') || '')) bad.push(`cpu line "${line('cpu')}"`);
          const sc = /^Scale (\d+|--)% \((Auto|Fixed|Off)\)$/.exec(line('scale') || '');
          const want = T.cfg.enabled === false ? 'Off' : T.cfg.renderScale === 0 ? 'Auto' : 'Fixed';
          if (!sc) bad.push(`scale line "${line('scale')}"`);
          else if (sc[2] !== want) bad.push(`scale line says (${sc[2]}), expected (${want})`);
          else if (sc[1] !== '--' && Math.abs(Number(sc[1]) - T.perf.scale * 100) > 5) bad.push(`scale line says ${sc[1]}% but perf.scale is ${T.perf.scale}`);
          if (!/^Shadows (\d+\/min|off)$/.test(line('shadow') || '')) bad.push(`shadow line "${line('shadow')}"`);
          if (bad.length) out = `the overlay text does not match its format: ${bad.join('; ')}`;
        } else if (!/No performance data/.test(line('fps') || '')) out = `without Twitterentary.perf the overlay should say "No performance data", it says "${line('fps')}"`;
        press();
        if (out === true && !(await __tcwait(() => !shown() && bus.get('perf.overlay') === false, 2000))) out = `a second F2 did not hide #tc-perf (perf.overlay ${JSON.stringify(bus.get('perf.overlay'))})`;
      } finally {
        if (bus.get('perf.overlay')) bus.set('perf.overlay', false);
      }
      return out;
    } },
  { script: CHAT, name: 'window.__mcChatHistory is available',
    run: () => !!window.__mcChatHistory || 'window.__mcChatHistory missing' },
  // Checks that open menus go last so they can't disturb the others.
  { script: [OPTIONS, ZOOM], name: 'Options screen has the FOV slider',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag'; // act on the settled title screen
      M.openOptions();
      const found = !!document.querySelector('#screen .inner input[type="range"][data-k="fov"]');
      M.back(); // return to whatever screen was open before
      return found || 'no input[type=range][data-k="fov"] after menus.openOptions()';
    } },
  { script: OPTIONS, name: 'the Better Options menu opens in #screen ("on dim") through menus.showScreen',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag'; // the game opens its title screen when the world is ready
      const scr = document.getElementById('screen'), before = scr.className;
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      await window.__tcOptions.open();
      const shown = await __tcwait(marker, 5000);
      await new Promise(r => setTimeout(r, 300)); // opening also steals the FOV slider, which reopens our screen
      const cls = scr.className, still = marker(), buttons = document.querySelectorAll('#screen .inner button.mcb').length;
      if (before) M.back(); else M.closeMenu(); // restore
      const cleared = before ? !marker() : !/(^|\s)on(\s|$)/.test(scr.className); // our screen is gone again
      if (!shown || !still) return `menu not shown (#screen class "${cls}")`;
      if (!/(^|\s)on(\s|$)/.test(cls) || !/(^|\s)dim(\s|$)/.test(cls)) return `#screen class is "${cls}", expected "on dim" (screenIsOn() and the zoom gate test "on")`;
      if (!buttons) return 'no button.mcb rendered from the array buildScreen() returned';
      return cleared || `our screen is still open after ${before ? 'back()' : 'closeMenu()'} (#screen class "${scr.className}")`;
    } },
  { script: OPTIONS, name: 'every Better Options tab fits its button and slider text on one line, and has its preset, reset and game-options rows',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      try { await document.fonts.load('24px Tweetcraft'); } catch (e) {} // font-display: block, so measure only once it is in
      if (!document.fonts.check('24px Tweetcraft')) return 'can\'t verify: the game\'s Tweetcraft font did not load, so text widths would be wrong';
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)];
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const TABS = '#screen .inner .tc-tabs button';
      const tab = name => all(TABS).find(b => b.getAttribute('aria-label') === name);
      const name = el => el.getAttribute('aria-label') || el.textContent.trim() || el.className;
      // The text (measured with a Range: scrollWidth misses text that flexbox centres and spills on both sides)
      // must make one line inside the element's content box; a slider caption must also stay on its slider.
      const problem = (el, outer) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return null; // not shown
        const cs = getComputedStyle(el), px = p => parseFloat(cs[p]) || 0;
        let L = r.left + px('borderLeftWidth') + px('paddingLeft'), R = r.right - px('borderRightWidth') - px('paddingRight');
        let Tp = r.top + px('borderTopWidth') + px('paddingTop'), B = r.bottom - px('borderBottomWidth') - px('paddingBottom');
        if (outer) { const o = outer.getBoundingClientRect(); L = Math.max(L, o.left); R = Math.min(R, o.right); Tp = o.top; B = o.bottom; }
        const rg = document.createRange();
        rg.selectNodeContents(el);
        const rects = [...rg.getClientRects()].filter(x => x.width > 0 && x.height > 0);
        if (!rects.length) return null; // no text
        const lines = [];
        for (const x of rects) { const mid = (x.top + x.bottom) / 2; if (!lines.some(([a, b]) => mid > a && mid < b)) lines.push([x.top, x.bottom]); }
        const t = rg.getBoundingClientRect(), tol = 1;
        if (lines.length > 1) return `"${name(el)}" wraps onto ${lines.length} lines`;
        if (t.left < L - tol || t.right > R + tol) return `"${name(el)}" is ${Math.round(t.width)} px wide in a ${Math.round(R - L)} px box`;
        if (t.top < Tp - tol || t.bottom > B + tol) return `"${name(el)}" is ${Math.round(t.height)} px tall in a ${Math.round(B - Tp)} px box`;
        return null;
      };
      const issues = [], labels = {};
      let out = true, start = null;
      try {
        await window.__tcOptions.open();
        const shown = await __tcwait(marker, 5000);
        await sleep(300); // opening also steals the FOV slider, which reopens our screen
        const names = all(TABS).map(b => b.getAttribute('aria-label')).filter(Boolean);
        start = (all(TABS).find(b => b.classList.contains('on')) || { getAttribute: () => null }).getAttribute('aria-label');
        if (!shown || !marker()) out = `menu not shown (#screen class "${scr.className}")`;
        else if (!names.length) out = 'no tabs (.tc-tabs button[aria-label])';
        for (const n of out === true ? names : []) {
          const b = tab(n);
          if (!b) { issues.push(`tab "${n}" disappeared`); continue; }
          b.click();
          await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500);
          await sleep(100);
          for (const el of all('#screen .inner .mcb')) { const p = problem(el); if (p) issues.push(`${n}: ${p}`); }
          for (const s of all('#screen .inner .tc-slider')) {
            const cap = s.querySelector(':scope > .tc-cap');
            if (!s.querySelector(':scope > input.tc-range[type="range"]') || !cap) { issues.push(`${n}: a .tc-slider without its input.tc-range and .tc-cap`); continue; }
            const p = problem(cap, s);
            if (p) issues.push(`${n}: slider ${p}`);
          }
          for (const el of all('#screen .inner button.mcb.tc-full')) {
            const a = el.getAttribute('aria-label') || '';
            if (a !== el.textContent.trim() || !/^.+: .+$/.test(a)) issues.push(`${n}: toggle/cycle "${a}" should read "<Label>: <Value>" in its text and aria-label`);
          }
          labels[n] = { buttons: all('#screen .inner button.mcb').map(x => x.getAttribute('aria-label') || ''), sliders: all('#screen .inner .tc-slider').length };
        }
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try {
          const b = start && tab(start);
          if (b && !b.classList.contains('on')) { b.click(); await sleep(50); } // leave our menu on the tab it opened with
        } catch (e) {}
        if (before) M.back(); else M.closeMenu(); // restore
      }
      if (out !== true) return out;
      const has = (t, test, what) => { if (!labels[t]) issues.push(`no "${t}" tab`); else if (!labels[t].buttons.some(test)) issues.push(`${t} tab: no ${what} button`); };
      has('Graphics', a => a === 'Game options…', '"Game options…"');
      if (labels.Graphics && !labels.Graphics.sliders) issues.push('Graphics tab: no .tc-slider rows (FOV and render distance are sliders)');
      has('About', a => a.startsWith('Reset all options'), '"Reset all options"');
      if (window.Twitterentary && window.Twitterentary.presets) { // fresh profile: the shader defaults are Medium + Natural
        has('Shaders', a => a === 'Quality: Medium', '"Quality: Medium"');
        has('Shaders', a => a === 'Look: Natural', '"Look: Natural"');
        has('Shaders', a => a.startsWith('Reset shaders'), '"Reset shaders"');
      }
      const cleared = before ? !marker() : !/(^|\s)on(\s|$)/.test(scr.className);
      if (!cleared) issues.push(`our screen is still open after ${before ? 'back()' : 'closeMenu()'} (#screen class "${scr.className}")`);
      return !issues.length || issues.slice(0, 12).join('; ') + (issues.length > 12 ? ` (+${issues.length - 12} more)` : '');
    } },
  { script: OPTIONS, name: 'a stored FOV outside the game\'s 30-110 is not picked up by our FOV row',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || !bus.fov || typeof bus.fov.get !== 'function') return 'window.__tcOptions.fov missing';
      const scr = document.getElementById('screen'), before = scr.className, prev = localStorage.getItem('mc.fov');
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      let out = true, start = null;
      try {
        localStorage.setItem('mc.fov', '17.5'); // e.g. left by an old zoom build; the game itself ignores it (30-110)
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('Graphics'))) out = 'no Graphics tab';
        else {
          const v = bus.fov.get(), cap = (document.querySelector('#screen .inner .tc-slider .tc-cap') || {}).textContent;
          if (!(v >= 30 && v <= 110)) out = `with mc.fov = 17.5 stored, our FOV reads ${v} (FOV row "${cap}"): only the game's 30-110 should be picked up`;
        }
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev);
        try { if (marker()) { await show('Graphics'); if (start && start !== 'Graphics') await show(start); } } catch (e) {} // re-read the restored value
        if (before) M.back(); else M.closeMenu(); // restore
      }
      return out;
    } },
  { script: OPTIONS, name: 'the Graphics tab toggles the performance overlay, and the Shaders tab offers "Run benchmark" and shows the last result with "Copy results"',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions, T = window.Twitterentary;
      if (!bus || typeof bus.get !== 'function' || typeof bus.set !== 'function') return 'window.__tcOptions.get/set missing';
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const button = l => all('#screen .inner button').find(b => b.getAttribute('aria-label') === l);
      const labels = () => all('#screen .inner button.mcb').map(b => b.getAttribute('aria-label')).join(' | ');
      const overlay = () => { const e = document.getElementById('tc-perf'); return !!e && !e.hidden; };
      const last = bus.get('bench.last');
      const issues = [];
      let start = null;
      try {
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300); // opening also steals the FOV slider, which reopens our screen
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('Graphics'))) issues.push('no Graphics tab');
        else if (!button('Performance overlay: OFF')) issues.push(`Graphics tab: no "Performance overlay: OFF" toggle (buttons: ${labels()})`);
        else {
          button('Performance overlay: OFF').click();
          if (!(await __tcwait(() => button('Performance overlay: ON') && overlay() && bus.get('perf.overlay') === true, 2000))) issues.push(`clicking "Performance overlay: OFF" did not turn the overlay on (overlay shown ${overlay()}, perf.overlay ${JSON.stringify(bus.get('perf.overlay'))})`);
          else {
            button('Performance overlay: ON').click();
            if (!(await __tcwait(() => button('Performance overlay: OFF') && !overlay() && bus.get('perf.overlay') === false, 2000))) issues.push('clicking "Performance overlay: ON" did not turn the overlay off');
          }
        }
        if (T && typeof T.bench === 'function') {
          // a stored result, as "Run benchmark" leaves one, so the results block renders without running a bench
          bus.set('bench.last', { at: Date.now(), bo: 'smoke', env: { gpu: 'Smoke GPU', w: 1280, h: 720, dpr: 1, version: String(T.version), timer: false },
            rows: [{ name: 'off', fps: 61.2, ms: 16.3, p95: 18.1, low1: 52.4, cpuMs: 4.1, gpuMs: null, scale: 1 }, { name: 'low', fps: 58, ms: 17.2, p95: 20.5, low1: 47, cpuMs: 4.3, gpuMs: null, scale: 0.8 }] });
          if (!(await show('Shaders'))) issues.push('no Shaders tab');
          else {
            await __tcwait(() => document.querySelector('#screen .inner .tc-bench'), 1500);
            if (!button('Run benchmark')) issues.push(`Shaders tab: no "Run benchmark" button although Twitterentary.bench exists (buttons: ${labels()})`);
            const rows = all('#screen .inner .tc-bench .tc-bench-row');
            if (!document.querySelector('#screen .inner .tc-bench .tc-bench-head')) issues.push('Shaders tab: no .tc-bench-head in the stored result');
            if (rows.length !== 2) issues.push(`Shaders tab: ${rows.length} .tc-bench-row for a stored result with 2 rows`);
            else {
              // cells: name (shown capitalised, the raw name in its title), FPS, p95 ms, scale
              const cells = [...rows[0].children].filter(x => x.tagName === 'SPAN'), first = cells[0];
              const raw = first ? (first.getAttribute('title') || '').split(':')[0].trim() : '';
              if (cells.length !== 4 || raw !== 'off' || first.textContent.trim().toLowerCase() !== 'off') issues.push(`the first .tc-bench-row has cells ${JSON.stringify(cells.map(x => x.textContent.trim()))} (title ${JSON.stringify(first && first.getAttribute('title'))}), expected 4 spans starting with the scenario "off"`);
            }
            if (!button('Copy results')) issues.push('Shaders tab: no "Copy results" button under the stored result');
            if (typeof bus._benchText === 'function') {
              const t = String(bus._benchText());
              if (!/^\| Scenario \| FPS \| Mean ms \| p95 ms \|/m.test(t) || !/^\| off \|/m.test(t)) issues.push(`_benchText() is not the Markdown results table: ${JSON.stringify(t.slice(0, 160))}`);
            }
          }
        }
      } catch (e) {
        issues.push(`threw: ${e.message}`);
      } finally {
        try { bus.set('bench.last', last === undefined ? null : last); } catch (e) {}
        if (bus.get('perf.overlay')) bus.set('perf.overlay', false);
        try { if (marker() && start) await show(start); } catch (e) {} // leave our menu on the tab it opened with
        if (before) M.back(); else M.closeMenu(); // restore
      }
      const cleared = before ? !marker() : !/(^|\s)on(\s|$)/.test(scr.className);
      if (!cleared) issues.push(`our screen is still open after ${before ? 'back()' : 'closeMenu()'} (#screen class "${scr.className}")`);
      return !issues.length || issues.join('; ');
    } },
  { script: OPTIONS, name: '"Run benchmark" (bus._runBench) runs behind a see-through screen, then reopens our menu on the Shaders tab with the stored result, and leaves the shader settings as they were',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions, T = window.Twitterentary;
      if (!bus || typeof bus._runBench !== 'function') return 'window.__tcOptions._runBench missing';
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], q = s => document.querySelector(s);
      const marker = () => !!q('#screen .inner .tc-marker'), benchScreen = () => !!q('#screen .inner .tc-bench-screen');
      const onTab = () => (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
      const restore = () => { if (scr.className !== before || marker() || benchScreen()) { if (before) M.back(); else M.closeMenu(); } };
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // it refuses while typing
      if (!T || typeof T.bench !== 'function') { // Better Options alone: it must refuse, not throw
        let r;
        try { r = await bus._runBench({ seconds: 0.5, warmup: 0, scenarios: ['current'] }); } catch (e) { r = `threw: ${e.message}`; } finally { restore(); }
        return (r && r.ok === false) || `without Twitterentary.bench, _runBench() gave ${JSON.stringify(r)}, expected { ok: false, error }`;
      }
      const PFX = 'tc.shader.';
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); };
      const cfgNow = () => JSON.stringify(Object.keys(T.cfg).sort().map(k => [k, T.cfg[k]]));
      const last = bus.get('bench.last'), ls0 = saved(), cfg0 = cfgNow(), issues = [];
      try {
        const p = bus._runBench({ seconds: 0.5, warmup: 0.2, scenarios: ['off', 'current'] });
        await __tcwait(benchScreen, 3000);
        const during = { cls: scr.className, screen: benchScreen(), marker: marker(), status: ((q('#screen .inner .tc-bench-status') || {}).textContent || '').trim(), running: T.bench.running };
        const r = await Promise.race([p, new Promise(res => setTimeout(() => res({ ok: false, error: 'did not finish within 60 s' }), 60000))]);
        if (!r || r.ok !== true) issues.push(`_runBench() gave ${JSON.stringify(r && { ok: r.ok, error: r.error })}`);
        if (during.cls !== 'on' || !during.screen || during.marker) issues.push(`while running: #screen class "${during.cls}", .tc-bench-screen ${during.screen}, our menu ${during.marker ? 'shown' : 'hidden'}; expected the see-through "on" screen without our menu`);
        // BO 1.2 adds " Escape stops it." whenever the shader script can stop a run (Twitterentary.bench.abort), and
        // only then: without abort() Escape goes to the game, so the hint would be a lie.
        else {
          const sm = /^Benchmark (?:running, about \d+ s left|finishing)\. Don['’]t move\.( Escape stops it\.)?$/.exec(during.status);
          const abortable = typeof T.bench.abort === 'function';
          if (!sm) issues.push(`while running the status line reads "${during.status}"`);
          else if (abortable !== !!sm[1]) issues.push(`while running the status line reads "${during.status}": with${abortable ? '' : 'out'} Twitterentary.bench.abort it should ${abortable ? '' : 'not '}end with " Escape stops it."`);
        }
        if (during.running !== true) issues.push(`Twitterentary.bench.running was ${JSON.stringify(during.running)} while the benchmark screen was up`);
        if (r && r.ok === true) {
          await __tcwait(() => marker() && onTab() === 'Shaders' && q('#screen .inner .tc-bench'), 5000);
          if (!marker() || !/(^|\s)dim(\s|$)/.test(scr.className)) issues.push(`after the run our menu is not back (#screen class "${scr.className}")`);
          else if (onTab() !== 'Shaders') issues.push(`after the run our menu is on the ${onTab()} tab, expected Shaders`);
          const got = bus.get('bench.last'), names = got && Array.isArray(got.rows) ? got.rows.map(x => x && x.name).join() : null;
          if (names !== 'off,current') issues.push(`bench.last rows are ${JSON.stringify(names)}, expected "off,current"`);
          const shown = all('#screen .inner .tc-bench .tc-bench-row').length;
          if (shown !== 2) issues.push(`${shown} result rows shown, expected 2`);
        }
        if (saved() !== ls0) issues.push(`tc.shader.* localStorage changed across the benchmark: ${ls0} -> ${saved()}`);
        if (cfgNow() !== cfg0) issues.push('Twitterentary.cfg changed across the benchmark');
      } catch (e) {
        issues.push(`threw: ${e.message}`);
      } finally {
        try { bus.set('bench.last', last === undefined ? null : last); } catch (e) {}
        restore();
      }
      const cleared = before ? !marker() && !benchScreen() : !/(^|\s)on(\s|$)/.test(scr.className);
      if (!cleared) issues.push(`a screen of ours is still open after ${before ? 'back()' : 'closeMenu()'} (#screen class "${scr.className}")`);
      return !issues.length || issues.join('; ');
    } },
  { script: OPTIONS, name: 'a running "Run benchmark" stops early: Escape on the bench screen (reason escape, our menu back on Shaders with the finished rows marked stopped), the game taking the screen (reason closed, its screen left alone), a window resize (reason resized) and a direct Twitterentary.bench.abort() (reason bench); a second _runBench() in the same tick is refused',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions, T = window.Twitterentary;
      if (!bus || typeof bus._runBench !== 'function' || typeof bus.get !== 'function' || typeof bus.set !== 'function') return 'window.__tcOptions._runBench/get/set missing';
      // Without the shader script's bench.abort() (Better Options alone, or an older shader version) there is
      // nothing to stop: Escape goes to the game as before, and the "Run benchmark" check covers the refusal.
      if (!T || typeof T.bench !== 'function' || typeof T.bench.abort !== 'function') return true;
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], q = s => document.querySelector(s), sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!q('#screen .inner .tc-marker'), benchScreen = () => !!q('#screen .inner .tc-bench-screen');
      const onTab = () => (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
      const status = () => ((q('#screen .inner .tc-bench-status') || {}).textContent || '').trim();
      const restore = () => { if (scr.className !== before || marker() || benchScreen()) { if (before) M.back(); else M.closeMenu(); } };
      const PFX = 'tc.shader.';
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return JSON.stringify(o); };
      const cfgNow = () => JSON.stringify(Object.keys(T.cfg).sort().map(k => [k, T.cfg[k]]));
      const track = p => { const t = { done: false, value: undefined }; Promise.resolve(p).then(v => { t.done = true; t.value = v; }, e => { t.done = true; t.value = { threw: String(e && e.message) }; }); return t; };
      const settle = async (t, ms) => { const t0 = performance.now(); while (!t.done && performance.now() - t0 < ms) await sleep(50); return t.done; };
      const names = r => (r && r.result && Array.isArray(r.result.rows) ? r.result.rows.map(x => x && x.name).join() : null);
      const brief = r => JSON.stringify(r && { ok: r.ok, error: r.error, stopped: r.stopped, reason: r.reason, saved: r.saved, rows: names(r), aborted: r.result && r.result.aborted });
      // A stored result, so "bench.last is unchanged" is visible when no row finished.
      const SENTINEL = { at: 1, bo: 'smoke', env: { gpu: 'Sentinel GPU', w: 1280, h: 720, dpr: 1, version: String(T.version), timer: false }, rows: [{ name: 'sentinel', fps: 1, ms: 1000, p95: null, low1: null, cpuMs: null, gpuMs: null, scale: 1 }] };
      const last = bus.get('bench.last'), ls0 = saved(), cfg0 = cfgNow(), issues = [];
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // it refuses while typing
      // Starts a run with 3 s windows and waits until bench() is measuring behind the bench screen.
      // twin: a second _runBench() in the same tick, tracked in twin.t
      const start = async (scenarios, tag, twin) => {
        bus.set('bench.last', SENTINEL);
        const lastB = JSON.stringify(bus.get('bench.last'));
        const t = track(bus._runBench({ seconds: 3, warmup: 0.2, scenarios }));
        if (twin) twin.t = track(bus._runBench({ seconds: 3, warmup: 0.2, scenarios }));
        if (!(await __tcwait(() => t.done || (benchScreen() && T.bench.running === true), 5000)) || t.done) { issues.push(`${tag}: the run never got going (${t.done ? `it ended: ${brief(t.value)}` : `bench screen ${benchScreen()}, bench.running ${T.bench.running}`})`); return null; }
        return { t, lastB };
      };
      const after = async (tag, run, r) => {
        if (T.bench.running !== false) issues.push(`${tag}: bench.running is still ${JSON.stringify(T.bench.running)}`);
        if (saved() !== ls0) issues.push(`${tag}: tc.shader.* localStorage changed: ${ls0} -> ${saved()}`);
        if (cfgNow() !== cfg0) issues.push(`${tag}: Twitterentary.cfg is not what it was before the run`);
        if (r && r.saved === false && JSON.stringify(bus.get('bench.last')) !== run.lastB) issues.push(`${tag}: bench.last changed although no row finished (saved: false): ${JSON.stringify(bus.get('bench.last')).slice(0, 160)}`);
      };
      try {
        // (a) Escape during the second scenario: the first row has finished, so it is saved, marked stopped.
        {
          const tag = '(a) Escape', run = await start(['off', 'low+renderScale=0.7'], tag);
          if (run) {
            const inSecond = () => T.cfg.enabled === true && Math.abs(T.cfg.renderScale - 0.7) < 1e-6;
            const t0 = performance.now();
            while (!run.t.done && !inSecond() && performance.now() - t0 < 40000) await sleep(50);
            if (run.t.done || !inSecond()) issues.push(`${tag}: can't verify: the second scenario never started (${run.t.done ? `the run ended: ${brief(run.t.value)}` : `cfg.enabled ${T.cfg.enabled}, renderScale ${T.cfg.renderScale}`})`);
            else {
              // The game handles Escape in a window bubble-phase listener (and preventDefaults it itself), so a listener
              // of ours in the same phase, and the bench screen still being up, show whether it got through.
              const ev = new KeyboardEvent('keydown', { code: 'Escape', key: 'Escape', bubbles: true, cancelable: true });
              let reached = false;
              const spy = e => { if (e === ev) reached = true; };
              addEventListener('keydown', spy);
              try { document.body.dispatchEvent(ev); } finally { removeEventListener('keydown', spy); }
              const now = { prevented: ev.defaultPrevented, running: T.bench.running, status: status(), screen: benchScreen() };
              if (!now.prevented) issues.push(`${tag}: Escape on the bench screen was not taken (defaultPrevented false)`);
              if (reached || !now.screen) issues.push(`${tag}: Escape reached the game's keydown listeners (${reached ? 'a window bubble-phase listener saw it' : ''}${reached && !now.screen ? ', and ' : ''}${!now.screen ? `the bench screen was replaced: #screen class "${scr.className}"` : ''}): the game's back() would take the screen instead of stopping the run`);
              if (now.running !== false) issues.push(`${tag}: bench.running was ${JSON.stringify(now.running)} right after Escape (it should call bench.abort() at once)`);
              if (now.screen && now.status !== 'Stopping the benchmark.') issues.push(`${tag}: right after Escape the status line reads "${now.status}", expected "Stopping the benchmark."`);
              if (!(await settle(run.t, 15000))) issues.push(`${tag}: _runBench() did not settle within 15 s of Escape`);
              else {
                const r = run.t.value;
                if (!r || r.ok !== false || r.error !== 'stopped' || r.stopped !== true || r.reason !== 'escape' || r.saved !== true || names(r) !== 'off' || r.result.aborted !== true) issues.push(`${tag}: _runBench() gave ${brief(r)}, expected { ok: false, error: "stopped", stopped: true, reason: "escape", saved: true, rows: "off", aborted: true }`);
                await __tcwait(() => marker() && onTab() === 'Shaders' && q('#screen .inner .tc-bench'), 5000);
                if (!marker() || !/(^|\s)dim(\s|$)/.test(scr.className)) issues.push(`${tag}: our menu is not back after the stop (#screen class "${scr.className}")`);
                else if (onTab() !== 'Shaders') issues.push(`${tag}: our menu came back on the ${onTab()} tab, expected Shaders`);
                else {
                  if (!q('#screen .inner .tc-bench-partial')) issues.push(`${tag}: no .tc-bench-partial note under a stopped result`);
                  const shown = all('#screen .inner .tc-bench .tc-bench-row').length;
                  if (shown !== 1) issues.push(`${tag}: ${shown} result rows shown, expected the 1 that finished`);
                }
                const got = bus.get('bench.last') || {};
                if (got.partial !== 'stopped' || !Array.isArray(got.rows) || got.rows.map(x => x && x.name).join() !== 'off') issues.push(`${tag}: bench.last is ${JSON.stringify({ partial: got.partial, rows: Array.isArray(got.rows) ? got.rows.map(x => x && x.name) : got.rows })}, expected { partial: "stopped", rows: ["off"] }`);
                await after(tag, run, r);
              }
            }
            restore();
          }
        }
        // (b) The game takes the screen (its back(), as Escape would without us): stop, and leave its screen alone.
        {
          const tag = '(b) closed', run = await start(['off', 'current'], tag);
          if (run) {
            M.back();
            const cls = scr.className;
            if (!(await settle(run.t, 15000))) issues.push(`${tag}: _runBench() did not settle within 15 s of menus.back()`);
            else {
              const r = run.t.value;
              if (!r || r.ok !== false || r.error !== 'stopped' || r.stopped !== true || r.reason !== 'closed' || r.saved !== false || names(r) !== '' || r.result.aborted !== true) issues.push(`${tag}: _runBench() gave ${brief(r)}, expected { ok: false, error: "stopped", stopped: true, reason: "closed", saved: false, rows: "", aborted: true }`);
              await sleep(500); // nothing may reopen our menu over the game's screen
              if (marker() || benchScreen()) issues.push(`${tag}: our ${marker() ? 'menu' : 'bench screen'} is shown after the game took the screen`);
              else if (scr.className !== cls) issues.push(`${tag}: #screen changed from "${cls}" (the game's screen after back()) to "${scr.className}"`);
              await after(tag, run, r);
            }
            restore();
          }
        }
        // (c) A window resize (or leaving fullscreen, whose Escape Chrome keeps from the page) mid-run changes the pixel
        // count, so it stops the run: reason resized (escape if the run started in fullscreen), our menu back.
        {
          const tag = '(c) resize', run = await start(['off', 'current'], tag);
          if (run) {
            window.dispatchEvent(new Event('resize'));
            if (T.bench.running !== false) issues.push(`${tag}: bench.running was ${JSON.stringify(T.bench.running)} right after the resize event (it should call bench.abort() at once)`);
            if (!(await settle(run.t, 15000))) issues.push(`${tag}: _runBench() did not settle within 15 s of the resize`);
            else {
              const r = run.t.value, want = document.fullscreenElement ? 'escape' : 'resized';
              if (!r || r.ok !== false || r.error !== 'stopped' || r.stopped !== true || r.reason !== want || r.saved !== false || names(r) !== '' || r.result.aborted !== true) issues.push(`${tag}: _runBench() gave ${brief(r)}, expected { ok: false, error: "stopped", stopped: true, reason: "${want}", saved: false, rows: "", aborted: true }`);
              await __tcwait(() => marker() && onTab() === 'Shaders', 5000);
              if (!marker() || onTab() !== 'Shaders') issues.push(`${tag}: our menu is not back on the Shaders tab (#screen class "${scr.className}", tab ${onTab()})`);
              await after(tag, run, r);
            }
            restore();
          }
        }
        // (d) Someone else calls Twitterentary.bench.abort(): stopped, reason bench, our menu back on Shaders. The run
        // is started by two _runBench() calls in the same tick: the second must be refused, not start a second run.
        {
          const tag = '(d) bench.abort()', twin = { t: null };
          const run = await start(['off', 'current'], tag, twin);
          if (twin.t) {
            await settle(twin.t, 5000);
            const r2 = twin.t.value;
            if (!r2 || r2.ok !== false || r2.error !== 'already running') issues.push(`${tag}: a second _runBench() in the same tick gave ${twin.t.done ? JSON.stringify(r2) : 'nothing within 5 s'}, expected { ok: false, error: "already running" }`);
          }
          if (run) {
            const ret = T.bench.abort();
            if (ret !== true) issues.push(`${tag}: Twitterentary.bench.abort() returned ${JSON.stringify(ret)} during the run, expected true`);
            if (!(await settle(run.t, 15000))) issues.push(`${tag}: _runBench() did not settle within 15 s of bench.abort()`);
            else {
              const r = run.t.value;
              if (!r || r.ok !== false || r.error !== 'stopped' || r.stopped !== true || r.reason !== 'bench' || r.saved !== false || names(r) !== '' || r.result.aborted !== true) issues.push(`${tag}: _runBench() gave ${brief(r)}, expected { ok: false, error: "stopped", stopped: true, reason: "bench", saved: false, rows: "", aborted: true }`);
              await __tcwait(() => marker() && onTab() === 'Shaders', 5000);
              if (!marker() || onTab() !== 'Shaders') issues.push(`${tag}: our menu is not back on the Shaders tab (#screen class "${scr.className}", tab ${onTab()})`);
              else if (q('#screen .inner .tc-bench-partial')) issues.push(`${tag}: a .tc-bench-partial note is shown, but bench.last should be the untouched stored result`);
              await after(tag, run, r);
            }
            restore();
          }
        }
      } catch (e) {
        issues.push(`threw: ${e.message}`);
      } finally {
        try { if (T.bench.running) T.bench.abort(); } catch (e) {}
        try { bus.set('bench.last', last === undefined ? null : last); } catch (e) {}
        restore();
      }
      const cleared = before ? !marker() && !benchScreen() : !/(^|\s)on(\s|$)/.test(scr.className);
      if (!cleared) issues.push(`a screen of ours is still open after ${before ? 'back()' : 'closeMenu()'} (#screen class "${scr.className}")`);
      return !issues.length || issues.join('; ');
    } },
  // Changes settings (all back to their defaults), so it runs after the checks that read them.
  { script: OPTIONS, name: '"Reset all options" (About tab, confirmed in the game\'s dialog) restores our options, the shader defaults, FOV 70 and the default render distance',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions, TE = window.Twitterentary;
      if (!bus || typeof bus.reset !== 'function' || !bus.fov) return 'window.__tcOptions.reset/fov missing';
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const button = test => all('#screen .inner button').find(b => test(b.getAttribute('aria-label') || ''));
      const shaderKeys = () => { const out = []; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('tc.shader.')) out.push(k); } return out; };
      const eff = k => JSON.stringify(bus.get(k) === undefined ? null : bus.get(k));
      // the game's own touch test (main.js TOUCH) decides the default render distance
      const wantRd = String((matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).has('touch')) ? 6 : 8);
      const SEED = { 'ui.scale': 1.5, 'input.sens': 2, 'zoom.level': 8, 'zoom.key': 'KeyX', ...(bus._keybinds ? { 'perf.overlay': true } : {}) };
      const perfKey = () => { const k = bus._keybinds ? (bus._keybinds() || []).find(x => x && x.id === 'tc.perfOverlay') : null; return k ? k.key : null; };
      // The smoke profile is fresh, so what every option reads now is its default.
      const keys = [...new Set([...Object.keys(SEED), 'hud.on', ...Object.keys(bus.config || {})])];
      const fresh = {};
      for (const k of keys) fresh[k] = eff(k);
      const issues = [];
      let start = null, confirmed = false;
      try {
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        for (const [k, v] of Object.entries(SEED)) bus.set(k, v);
        if (perfKey()) bus.set('perf.key', 'F4'); // the overlay keybind, rebound (its reset puts back F2)
        if (TE && typeof TE.set === 'function') { TE.set('saturation', 1.4); TE.applyPreset('quality', 'low'); }
        await bus.fov.set(90);
        localStorage.setItem('mc.rd', '12');
        if (localStorage.getItem('mc.fov') !== '90' || eff('ui.scale') !== '1.5' || (TE && TE.set && !shaderKeys().length)) return `can't verify: seeding non-default values failed (mc.fov ${localStorage.getItem('mc.fov')}, ui.scale ${eff('ui.scale')}, shader keys ${shaderKeys().join(',')})`;
        if (!(await show('About'))) return 'no About tab';
        const r = button(l => l === 'Reset all options');
        if (!r) return 'no "Reset all options" button on the About tab';
        r.click();
        // the game's showMessage() dialog replaces our screen: [Reset] [Cancel]
        if (!(await __tcwait(() => !marker() && button(l => l === 'Reset'), 3000))) {
          return `clicking "Reset all options" did not open the game's confirmation dialog with a "Reset" button (buttons: ${all('#screen .inner button').map(b => b.getAttribute('aria-label')).join(' | ')})`;
        }
        button(l => l === 'Reset').click();
        confirmed = true;
        await __tcwait(() => marker() && localStorage.getItem('mc.fov') === '70' && localStorage.getItem('mc.rd') === wantRd && !shaderKeys().length, 10000);
        await sleep(300); // let the last step (refresh) finish
        const saved = localStorage.getItem('tc.options');
        if (saved !== JSON.stringify(bus.config)) issues.push(`saved tc.options ${saved} is not the live config ${JSON.stringify(bus.config)}`);
        const off = keys.filter(k => eff(k) !== fresh[k]);
        if (off.length) issues.push(`not back to the default: ${off.map(k => `${k} ${eff(k)} (default ${fresh[k]})`).join(', ')}`);
        if (shaderKeys().length) issues.push(`tc.shader.* keys left: ${shaderKeys().join(', ')}`);
        if (TE && typeof TE.currentPreset === 'function' && (TE.currentPreset('quality') !== 'medium' || TE.currentPreset('look') !== 'natural')) issues.push(`shader pickers read ${TE.currentPreset('quality')} / ${TE.currentPreset('look')}, expected medium / natural`);
        if (localStorage.getItem('mc.fov') !== '70' || bus.fov.get() !== 70) issues.push(`FOV is mc.fov ${localStorage.getItem('mc.fov')} / ${bus.fov.get()}, expected 70`);
        if (localStorage.getItem('mc.rd') !== wantRd) issues.push(`mc.rd is ${localStorage.getItem('mc.rd')}, expected ${wantRd}`);
        if (perfKey() && perfKey() !== 'F2') issues.push(`the performance overlay keybind is ${perfKey()} after the reset, expected F2`);
        const po = document.getElementById('tc-perf');
        if (po && !po.hidden) issues.push('the performance overlay (#tc-perf) is still shown after the reset');
        if (!marker() || !/(^|\s)on(\s|$)/.test(scr.className) || !/(^|\s)dim(\s|$)/.test(scr.className)) issues.push(`our screen is not back after the reset (#screen class "${scr.className}")`);
      } catch (e) {
        issues.push(`threw: ${e.message}`);
      } finally {
        if (!confirmed) { // never got to the reset: undo the seeding ourselves
          try { bus.reset(); if (TE && typeof TE.reset === 'function') TE.reset(); await bus.fov.set(70); localStorage.setItem('mc.rd', wantRd); } catch (e) {}
        }
        try { if (marker() && start && start !== 'About') await show(start); } catch (e) {} // leave our menu on the tab it opened with
        if (before) M.back(); else M.closeMenu(); // restore (every setting changed here is back at its default)
      }
      return !issues.length || issues.join('; ');
    } },
  // Switches the game's language (the title screen re-renders), so it runs after everything else.
  { script: OPTIONS, name: 'the pause-menu labels we click and hide follow the game\'s language (i18n t() + onLocaleChange)',
    run: async () => {
      const bus = window.__tcOptions;
      if (!bus || typeof bus._labels !== 'function') return 'window.__tcOptions._labels missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const I = await import('/js/i18n.js');
      // Our label sets must hold what t() gives, and our CSS must hide a pause button labelled that way.
      const verify = () => {
        const L = bus._labels(), t = I.t, miss = [];
        if (!(L.options || []).includes(t('pause.options'))) miss.push(`no Options label "${t('pause.options')}"`);
        for (const k of ['pause.full', 'pause.exitFull']) if (!(L.full || []).includes(t(k))) miss.push(`no Fullscreen label "${t(k)}"`);
        for (const n of [4, 6, 8, 10, 12]) if (!(L.dist || []).some(([l, v]) => l === t('pause.distance', { n }) && v === n)) miss.push(`no Distance label "${t('pause.distance', { n })}" = ${n}`);
        const inner = document.querySelector('#screen .inner');
        if (inner) {
          for (const label of [t('pause.full'), t('pause.distance', { n: 8 })]) {
            const b = document.createElement('button');
            b.className = 'mcb'; b.setAttribute('aria-label', label);
            inner.append(b);
            const shown = getComputedStyle(b).display !== 'none';
            b.remove();
            if (shown) miss.push(`a pause button labelled "${label}" is not hidden`);
          }
        }
        return miss;
      };
      let miss = verify();
      const was = I.locale();
      if (miss.length) return `in "${was}": ${miss.join('; ')}`;
      try {
        // On the title page the game also follows the sojo identity's language (lang-select.js followSojo), which
        // can supersede or undo our switch, so retry, and judge only while German is really active.
        let judged = false;
        for (let i = 0; i < 3 && !judged; i++) {
          await I.setLocale('de');
          if (I.locale() !== 'de') { await new Promise(r => setTimeout(r, 500)); continue; }
          await __tcwait(() => I.locale() !== 'de' || !verify().length, 3000);
          miss = verify();
          judged = I.locale() === 'de';
        }
        if (!judged) return `can't verify: the game would not stay in German (locale "${I.locale()}"; its catalogue may not have loaded)`;
        return !miss.length || `after switching the game to German, onLocaleChange did not update us: ${miss.join('; ')}`;
      } finally {
        await I.setLocale(was); // back to the language the test started in
      }
    } },
];

export const shaders = [
  // The terrain pool is the game's 7 terrain programs (6 passes + the stained-glass depth prepass) plus the shader
  // script's 3 shadow-map programs (1.5: depth-only, alpha-tested cutout, and the far tile's leaves-only cutout); the
  // depth-only one has no uClsTex, so 9 of the 10 carry the VS marker.
  { script: SHADERS, name: 'terrain vertex shaders patched', kind: 'terrain', stage: 'vs', marker: 'uniform highp sampler2D uClsTex;', min: 9 },
  { script: SHADERS, name: 'terrain fragment shaders patched', kind: 'terrain', stage: 'fs', marker: 'dFdx(vRel)', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the shadow parameters as a uniform (tile sizes, atlas texel)', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowP;', min: 6 },
  // 1.5: per-frame values hoisted to the CPU (hemisphere ambient, sun colour), the shadow tiles' bounds, and the
  // one smooth VS->FS varying (vTcP) instead of vRel + flat vCls + vTcBlk, and block light from the game's own
  // lightmap() in the lit FS. No flat varyings: on ANGLE/D3D11 a program with a flat varying costs ~2.3 GPU ms per
  // frame at rd 12 (LAB2, UHD 620), likely the geometry shader ANGLE adds for flat's provoking vertex.
  { script: SHADERS, name: 'terrain fragment shaders get the hoisted ambient and sun uniforms', kind: 'terrain', stage: 'fs', marker: 'uniform vec3 uAmb0;', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the shadow tile bounds (near/far cascades)', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowB;', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the near shadow tile as a transform of the far tile\'s light space', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowN;', min: 6 },
  { script: SHADERS, name: 'terrain vertex shaders pass position and layer class to the FS in one varying (vTcP)', kind: 'terrain', stage: 'vs', marker: 'out vec4 vTcP;', min: 7 },
  { script: SHADERS, name: 'terrain fragment shaders read the one vTcP varying', kind: 'terrain', stage: 'fs', marker: 'in vec4 vTcP;', min: 6 },
  { script: SHADERS, name: 'lit terrain fragment shaders take block light from the game\'s own lightmap()', kind: 'terrain', stage: 'fs', marker: 'lightmap(vec2(0.0, vLight.y)) - uTcLm0', min: 3 },
  { script: SHADERS, name: 'no terrain vertex shader has a flat varying (ANGLE/D3D11 makes flat cost ~2.3 ms per frame at rd 12)', kind: 'terrain', stage: 'vs', marker: 'flat ', max: 0 },
  { script: SHADERS, name: 'no terrain fragment shader has a flat varying', kind: 'terrain', stage: 'fs', marker: 'flat ', max: 0 },
  { script: SHADERS, name: 'sky shaders patched', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkySun;', min: 2 },
  { script: SHADERS, name: 'sky shaders get the hoisted sun-glow colour', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkyGlow;', min: 2 },
  // 1.5: our composite program (scene FBO -> canvas: bilinear upscale + sharpen), linked on the first frame. labelProgram()
  // names it by its first two uniforms (VS uTcScale, FS uTcScene).
  { script: SHADERS, name: 'the scene composite program (render-scale upscale + sharpen) is linked', kind: 'tcscale-tcscene', stage: 'fs', marker: 'uniform highp sampler2D uTcScene;', min: 1 },
  { script: SHADERS, name: 'cloud shader patched', kind: 'cloud', stage: 'fs', marker: 'uniform vec3 uCloudTint;', min: 1,
    known: 'patchCloud() regexes are double-escaped ("\\\\s" instead of "\\s"), so they never match and clouds are never patched' },
];
