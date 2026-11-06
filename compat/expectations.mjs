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
// Every game module that handles keys (keydown/keyup listeners, e.code tests, key(e) handlers or an import of js/keys.js). A key
// our scripts bind by default must not appear in any of them. js/keys.js is where the game's default keys live since build
// f6b38f505d, so main.js alone proves nothing any more: its entries below only pass honestly with keys.js beside them.
const KEY_MODULES = ['js/keys.js', 'js/controls.js', 'js/main.js', 'js/menus.js', 'js/ui.js', 'js/inventory.js', 'js/chat-suggest.js', 'js/chat-toggle.js',
  'js/country-mark.js', 'js/i18n.js', 'js/lang-select.js', 'js/music.js', 'js/net.js', 'js/signs.js', 'js/skin-editor.js',
  'js/skin-preview.js', 'js/sojo-identity.js', 'js/sound.js', 'js/voice.js', 'js/wardrobe.js', 'js/wl-suggest.js',
  'js/survival/anvil.js', 'js/survival/book.js', 'js/survival/chestlabels.js', 'js/survival/end.js',
  'js/survival/onboarding.js', 'js/survival/screens.js', 'js/survival/creative.js', 'js/survival/player.js', 'js/survival/horse.js',
  'js/survival/recipe-book.js'];
// These key modules aren't on staging yet, so their entries stay red there until they arrive, like js/texpages.js: a
// deliberate decision rather than an optional-file flag in tools/.
const NOT_ON_STAGING = new Set(['js/keys.js', 'js/controls.js', 'js/survival/horse.js', 'js/survival/recipe-book.js']);
const STAGING_RED = file => NOT_ON_STAGING.has(file) ? ' Deliberately red on staging until this file arrives there.' : '';
const R = String.raw;
// Where a class method's body ends: "}" followed by the next method header "name(args) {".
const METHOD_END = R`\}\s*(?!(?:if|for|while|switch|catch|else)\b)\w+\([\w,\s=]*\)\s*\{`;
// Texture units 6 and 7 are never used, and the game's extra atlas pages start at unit 8: no TEXTURE6+ constant, no
// TEXTURE0 + computed unit (only + 0-5, or a page's + PAGE_UNIT + k - 1 with k >= 1), no sampler set to 6+ by
// uniform1i or a { uName: n } sampler map.
const FREE_UNITS = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\bTEXTURE0\s*\+(?!\s*(?:[0-5]\b|PAGE_UNIT\s*\+\s*\w+\s*-\s*1\b)))(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})/;
// entities/index.js computes its unit in one helper, texture(gl, unit, ...): allowed there, if every call passes 0-5.
const FREE_UNITS_ENTITIES = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})(?=[\s\S]*\bfunction\s+(\w+)\(\s*(\w+)\s*,\s*(\w+)\s*,[^)]*\)\s*\{[^}]*?\.activeTexture\(\s*\2\.TEXTURE0\s*\+\s*\3\s*\))(?![\s\S]*\bTEXTURE0\s*\+(?!\s*(?:\3|[0-5])\b))(?![\s\S]*(?<!function\s+)\b\1\(\s*\2\s*,(?!\s*[0-5]\s*,))/;
// No enable(POLYGON_OFFSET_FILL) reaches a draw call without its own polygonOffset() (right before or after the enable).
const OWN_POLYGON_OFFSET = /^(?![\s\S]*?\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\)(?<!\.polygonOffset\([^)]*\)\s*;\s*\w+\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\))(?:(?!\.polygonOffset\(|\.draw(?:Elements|Arrays)\w*\()[\s\S])*?\.draw(?:Elements|Arrays)\w*\()/;
// No render-to-texture and no colour clear (gfx.js, which owns the frame's clear, has its own entry).
const NO_FBO_NO_CLEAR = /^(?![\s\S]*\.bindFramebuffer\()(?![\s\S]*\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/;
// The shadow tiles set a scissor box and a viewport without querying them first, and restore the framebuffer they found
// (the game never uses scissor, and the frame's viewport is remembered by the viewport hook). So no main-context module
// may use a render target or a scissor test of its own, and none outside gfx.js may set a viewport.
const RTT_CALLS = ['bindFramebuffer', 'createFramebuffer', 'bindRenderbuffer', 'createRenderbuffer', 'framebufferTexture2D',
  'framebufferTextureLayer', 'framebufferRenderbuffer', 'blitFramebuffer', 'drawBuffers', 'readBuffer', 'invalidateFramebuffer', 'scissor'];
const SHADOW_STATE_SAFE = file => new RegExp('^' +
  R`(?![\s\S]*\.(?:${[...RTT_CALLS, ...(file === 'js/gfx.js' ? [] : ['viewport'])].join('|')})\()` +
  R`(?![\s\S]*\bSCISSOR_TEST\b)`);
// The performance overlay key (Better Options' tc.perfOverlay keybind): no "F2" string, .F2 property or keyCode 113.
const NOT_F2 = /^(?![\s\S]*["'`]F2["'`])(?![\s\S]*\.F2\b)(?![\s\S]*\b(?:keyCode|which)\s*===?\s*113\b)/;
// Zoom's default key Z, by code, key or key code. js/skin-editor.js is the one exception, with its own entry.
const NOT_Z = /^(?![\s\S]*["'`]KeyZ["'`])(?![\s\S]*\.KeyZ\b)(?![\s\S]*\.key\s*===?\s*["'`][zZ]["'`])(?![\s\S]*\b(?:keyCode|which)\s*===?\s*90\b)/;
// Every letter Better Options knows as a game key on a build without js/keys.js (GAME_ACTIONS plus GAME_ONLY_KEYS), and the codes it doesn't list.
// A game key outside the letters, or any of the other codes, means that list has fallen behind the game. Quote is not
// one of them: main.js only preventDefaults it (PREVENT), with no action behind it.
const GAME_LETTERS = 'ACDEFKMOPQRSTVWX';
const UNLISTED_CODES = R`Key(?![${GAME_LETTERS}]["'\x60])[A-Z]|Digit[1-9]|F(?![135]["'\x60])\d{1,2}|Comma|Period|Minus|Equal|Semicolon|Backquote|Backslash|BracketLeft|BracketRight|Backspace|Delete|Insert|Home|End|PageUp|PageDown|CapsLock|Numpad\w+|ControlRight|AltLeft|AltRight|MetaLeft|MetaRight|ContextMenu|IntlBackslash`;
const NO_NEW_GAME_KEY = R`^(?![\s\S]*["'\x60](?:${UNLISTED_CODES})["'\x60])(?![\s\S]*\.Key(?![${GAME_LETTERS}]\b)[A-Z]\b)(?![\s\S]*\.(?:ControlRight|AltLeft|AltRight|MetaLeft|MetaRight)\b)`;
// Build f6b38f505d moved every game key into js/keys.js: BINDS holds { id, def, alt, cat, scope }, and main.js and the
// survival modules ask by bind id. Staging has neither that file nor the import, which is how an entry tells the builds apart.
const KEYS_IMPORT = R`\bfrom\s*["']\.\/keys\.js["']`;
const CONTROLS_IMPORT = R`\bfrom\s*["']\.\/controls\.js["']`;
// One entry of BINDS, on the default the entry names.
const BIND = (id, def) => R`\{\s*id\s*:\s*["']${id}["']\s*,\s*def\s*:\s*["']${def}["']`;
const HAS_BINDS = R`(?=[\s\S]*\bexport\s+const\s+BINDS\s*=\s*\[[\s\S]*?\bdef\s*:)`;
// keys.js still holds BINDS, and no bind has this code as its default or alternative.
const NOT_DEFAULT_BIND = code => new RegExp('^' + HAS_BINDS + R`(?![\s\S]*\b(?:def|alt)\s*:\s*["'\x60]${code}["'\x60])`);
// Every literal default and alternative in BINDS. "Digit" is the prefix of the nine hotbar binds ("Digit" + (i + 1)). The
// runtime check 'every code in the game's BINDS warns' walks the same binds in the live game, so a bind added here that
// Better Options doesn't know about fails there too.
const BIND_CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight',
  'ControlLeft', 'Mouse0', 'Mouse1', 'Mouse2', 'KeyQ', 'Digit', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'KeyE', 'KeyF', 'KeyR', 'KeyC',
  'KeyX', 'KeyT', 'Enter', 'Slash', 'Tab', 'KeyP', 'KeyV', 'KeyO', 'KeyM', 'F3', 'F1', 'F5', 'F11', 'KeyL', 'KeyK'];
const ONLY_BIND_CODES = new RegExp('^' + HAS_BINDS +
  R`(?![\s\S]*\b(?:def|alt)\s*:\s*(?!["'\x60](?:${BIND_CODES.join('|')})["'\x60]))` +
  BIND_CODES.map(code => R`(?=[\s\S]*\b(?:def|alt)\s*:\s*["'\x60]${code}["'\x60])`).join('') +
  R`(?=[\s\S]*\{\s*length\s*:\s*9\s*\}[^;]*?\bdef\s*:\s*["']Digit["']\s*\+\s*\(\s*\w+\s*\+\s*1\s*\))`);
// No key code or poll of its own: a module that passes this reads keys only through js/keys.js.
const NO_RAW_KEYS = R`(?![\s\S]*["'\x60](?:Key[A-Z]|Digit\d|F\d{1,2}|Arrow[A-Z]\w*|Shift[LR]\w*|Control[LR]\w*)["'\x60])(?![\s\S]*\.(?:Key[A-Z]|Digit\d|F\d{1,2}|Arrow[A-Z]\w*|Shift[LR]\w*|Control[LR]\w*)\b)`;
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
  { script: SHADERS, file: 'shaders:vs', test: /uint\s+(\w+)\s*=\s*aInfo\.y\s*;[^#]*?(?:uint\s+(\w+)\s*=\s*aInfo\.x\s*\|\s*\(\s*\(\s*aPos\.z\s*>>\s*9u\s*\)\s*&\s*1u\s*\)\s*<<\s*8u\s*;\s*)?vUV\s*=\s*vec3\(\s*float\(\s*\1\s*&\s*1u\s*\)\s*,\s*float\(\s*\(\s*\1\s*>>\s*1u\s*\)\s*&\s*1u\s*\)\s*,\s*float\(\s*(?:aInfo\.x|\2)\s*\)\s*\)|vUV\s*=\s*vec3\(\s*float\(\s*aInfo\.y\s*&\s*1u\s*\)\s*,\s*float\(\s*\(\s*aInfo\.y\s*>>\s*1u\s*\)\s*&\s*1u\s*\)\s*,\s*float\(\s*aInfo\.x\s*\)\s*\)/, why: 'vUV.z is the atlas layer (class lookup), read from aInfo.x alone or, from 6b3963e444, through a 9-bit local, and bits 0/1 of aInfo.y are the tile UV: waving pins the plant base (v=1), the shadow VS copies this decode' },
  // Build 6b3963e444 widened the layer to 9 bits. Staging is still on the 8-bit form, so both are accepted, but never a mix.
  { script: SHADERS, file: 'shaders:vs', test: /^(?:(?=[\s\S]*\buint\s+\w+\s*=\s*aInfo\.x\s*\|\s*\(\s*\(\s*aPos\.z\s*>>\s*9u\s*\)\s*&\s*1u\s*\)\s*<<\s*8u\s*;)(?![\s\S]*\bfloat\(\s*aInfo\.x\s*\))|(?![\s\S]*\baPos\.z\s*>>)(?=[\s\S]*\bfloat\(\s*aInfo\.x\s*\)))/, why: 'layer = aInfo.x | ((aPos.z >> 9u) & 1u) << 8u in every terrain VS (or plain aInfo.x in all of them, on a build without bit 8): the script applies bit 8 only when it finds "aPos.z >> 9u" in the game\'s VS, and its tcLayer copies this decode in the terrain and shadow VS. The game\'s own local comes after the line where we insert code, so we can\'t reuse it' },
  // The strip: every flat vGlass varying is rewritten to a plain one, in the VS and every FS (the two stages must agree).
  { script: SHADERS, file: 'shaders:vs', test: /\bflat\s+out\s+float\s+vGlass\s*;|^(?![\s\S]*\bvGlass\b)/, why: 'the game declares "flat out float vGlass;" and we strip the flat qualifier, because by rule no terrain program keeps a flat varying (the smoke markers forbid one) and the two stages must agree. The strip has no measured benefit: on the title screen vanilla read 5.15 ms and off 5.00, inside the noise floor. If the declaration changes, the strip regex no longer matches and those markers fail. A build with no vGlass at all (staging) has nothing to strip' },
  { script: SHADERS, file: 'shaders:fs', test: /\bflat\s+in\s+float\s+vGlass\s*;|^(?![\s\S]*\bvGlass\b)/, why: 'every terrain FS and FS_STAINED_DEPTH declare "flat in float vGlass;": we strip these too, including in sources patchSource() returns null for, because ESSL 3.00 needs the VS and FS to agree or the program fails to link' },
  { script: SHADERS, file: 'shaders:vs', test: /^(?![\s\S]*\bflat\s+(?!out\s+float\s+vGlass\s*;))/, why: 'vGlass is the only flat varying in the game\'s vertex shaders: a new one would not be stripped (smoke would then fail on the "flat " markers)' },
  { script: SHADERS, file: 'shaders:fs', test: /^(?![\s\S]*\bflat\s+(?!in\s+float\s+vGlass\s*;))/, why: 'vGlass is the only flat varying in the game\'s fragment shaders' },
  { script: SHADERS, file: 'shaders:vs', test: /\bvGlass\s*=\s*float\(\s*\(\s*uGlass\[\s*(\w+)\s*>>\s*5u\s*\]\s*>>\s*\(\s*\1\s*&\s*31u\s*\)\s*\)\s*&\s*1u\s*\)\s*;|^(?![\s\S]*\bvGlass\b)/, why: 'stripping flat is safe because vGlass is exactly 0 or 1 and depends only on the layer, so it is constant over a quad and interpolation keeps it. If the game computes it from anything per-vertex, stripping changes what the 0.5 test sees' },
  { script: SHADERS, file: 'shaders:fs', test: /^(?![\s\S]*\bvGlass\b(?!\s*;)(?!\s*[<>]\s*0\.5\b))/, why: 'the FS only compares vGlass with 0.5 (vGlass > 0.5 in mode 2, vGlass < 0.5 in FS_STAINED_DEPTH): any other use could see the interpolated value differently from a flat one' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.uniform1uiv\(\s*\w+\.u\[\s*["']uGlass\[0\]["']\s*\]\s*,|^(?![\s\S]*\buGlass\b)/, why: 'the game uploads uGlass only to programs where it is active, found by name: our VS patches must leave the "vGlass = ..." line and uGlass in place, or stained glass loses its near-face rule' },
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
  { script: SHADERS, file: 'js/gfx.js', test: /\.texImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*0\s*,\s*\w+\.RGBA8\s*,\s*16\s*,\s*16\s*,\s*\w+\s*,\s*0\s*,\s*\w+\.RGBA\s*,\s*\w+\.UNSIGNED_BYTE\s*,\s*(?!null\b)\w+(?:\.subarray\([^;]*?\))?\s*\)\s*;/, why: 'the atlas is read from texImage3D(TEXTURE_2D_ARRAY, 0, RGBA8, 16, 16, n, ..., pixels at argument 9): one call for the whole atlas, or (6b3963e444) once per page with data.subarray(...), so readAtlas must honour the view\'s byteOffset. Null pixels (allocate now, upload later) would leave us nothing to read' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bpages\s*=\s*Math\.ceil\(\s*\w+\s*\/\s*\w+\s*\)|^(?![\s\S]*\btexPages\b)/, why: 'a second atlas page exists only when the layer count outgrows the array size (pages = ceil(n / size), size = MAX_ARRAY_TEXTURE_LAYERS outside localhost tests): every normal GPU stays on one page, the path our terrain patches need' },
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
  // (?<!\.): from f6b38f505d main.js has a frame-timer phase, ft.to(PH.remesh), before updateChunks(). That is a property name, not a call.
  { script: SHADERS, file: 'js/main.js', test: /^(?=(?:(?!(?<!\.)\bremesh\b(?!-))[\s\S])*?\bfunction\s+updateChunks\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\}\s*function\s+remesh\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\bgfx\.setChunk\([^;]*;[^}]*\}(?![\s\S]*(?<!\.)\bremesh\b(?!-)))(?![\s\S]*\.setChunk\([\s\S]*\.setChunk\()(?![\s\S]*\bupdateChunks\((?:[\s\S]*\bupdateChunks\(){2})(?=[\s\S]*\bfunction\s+frameBody\(\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bupdateChunks\([^;]*;(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\brender\()(?=[\s\S]*\bfunction\s+render\([^)]*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bgfx\.draw\(\s*\{)/, why: 'gfx.setChunk() is called only from remesh(), remesh only inside updateChunks() (directly or through remeshSched), and updateChunks() only from frameBody(), before render() calls gfx.draw(): every remesh runs between frames, with the VAO the previous frame left bound (null, checked at runtime), never inside a draw' },
  { script: SHADERS, file: 'js/remesh-sched.js', test: /^(?![\s\S]*\b(?:setTimeout|setInterval|requestIdleCallback|requestAnimationFrame|queueMicrotask|await|then)\b)[\s\S]*\btimed\(\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{[^}]*?\b\1\(\s*\2\s*\)/, why: 'the remesh scheduler calls remesh(ci) synchronously from timed() and defers nothing (no timers, idle callbacks, rAF or await): remeshes happen only inside updateChunks(), at the start of a frame' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.pass\(\s*(\w+)\[\s*0\s*\]\s*,\s*(\w+)\s*,\s*0\s*,[^;]*;\s*this\.pass\(\s*\1\[\s*1\s*\]\s*,\s*\2\s*,\s*1\s*,/, why: 'pass 0 (opaque) and pass 1 (cutout) draw the same visible-chunk list back to back: a column drawn in pass 0 whose pass-1 part is not drawn has an empty part, so its shadow record is dropped' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bdropChunk\(\s*\w+\s*\)\s*\{[\s\S]{0,200}?for\s*\(\s*const\s+(\w+)\s+of\s+\w+\.parts\s*\)\s*if\s*\(\s*\1\s*\)\s*\{\s*this\.gl\.deleteVertexArray\(\s*\1\.vao\s*\)/, why: 'unloading a chunk (dropChunk) deletes its part VAOs: the deleteVertexArray hook drops their shadow records and marks the map dirty' },
  { script: SHADERS, file: 'js/gfx.js', test: /\banimateLayer\(\s*\w+(?:\s*,\s*\w+)*\s*\)\s*\{[\s\S]{0,800}?\.activeTexture\(\s*(?:\w+\s*\?\s*\w+\.TEXTURE0\s*\+\s*PAGE_UNIT\s*\+\s*\w+\s*-\s*1\s*:\s*)?\w+\.TEXTURE0\s*\)\s*;\s*\w+\.bindTexture\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*(?:this\.tPages\?\.\[\s*\w+\s*\]\s*\|\|\s*)?this\.tArr\s*\)\s*;(?:(?!\.(?:activeTexture|bindTexture)\()[\s\S]){0,200}?\.texSubImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*\w+\s*,\s*0\s*,\s*0\s*,\s*\w+\s*,/, why: 'atlas animation (water, lava, fire, portals) is texSubImage3D(TEXTURE_2D_ARRAY, level, 0, 0, layer) on the atlas, on unit 0 or a page on PAGE_UNIT + page - 1, never units 6/7. The layer argument is the in-page layer, the same number on a one-page atlas: once block names are known the hook ignores it (no reclassify, no shadow refresh)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.clear\([^)]*\bCOLOR_BUFFER_BIT\b/, why: 'a frame is counted on clear(COLOR_BUFFER_BIT)' },
  { script: SHADERS, file: 'js/gfx.js', exports: ['Gfx'], why: 'the smoke check of the stained-glass depth program catches the Gfx instance through Gfx.prototype.draw: the game exposes it nowhere else outside its dev builds' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?=[\s\S]*\bthis\.pStainedDepth\s*=\s*this\.prog\(\s*VS_TERRAIN\s*,\s*FS_STAINED_DEPTH\s*\))(?=[\s\S]*\bthis\.pTerrain\s*=\s*\[\s*0\s*,\s*1\s*,\s*2\s*\]\.map\()/, why: 'the stained-glass depth pass pairs the terrain VS (which we patch) with a FS we leave alone: that program must stay on uFx = 0, or plants wave with no lighting to match. The smoke check reads this.pStainedDepth, with this.pTerrain as its control' },
  // Main-context invariants, checked in every module that uses it (MAIN_GL above)
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: file === 'js/entities/index.js' ? FREE_UNITS_ENTITIES : FREE_UNITS, why: 'texture units 6 and 7 stay free: the shadow map and the class lookup stay bound there for the whole session. The game\'s extra atlas pages begin at PAGE_UNIT = 8, the only computed unit allowed here' })),
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: OWN_POLYGON_OFFSET, why: 'renderShadow() resets polygonOffset(0, 0) without querying it: every enable(POLYGON_OFFSET_FILL) sets its own offset before drawing (today only survival/chesticons.js)' })),
  ...MAIN_GL.filter(file => file !== 'js/gfx.js').map(file => ({ script: SHADERS, file, test: NO_FBO_NO_CLEAR, why: 'no render-to-texture and no colour clear outside gfx.js: frames are counted on the one colour clear, and the shadow pass restores the default framebuffer state it found' })),
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.bindFramebuffer\()(?=(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){2})(?!(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){3})(?=[\s\S]*\bif\s*\(\s*\w+\.wall\s*\)\s*\{\s*this\.drawWall\([^)]*\)\s*;\s*return\s*;?\s*\}(?:(?!\.clear\()[\s\S]){0,1500}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)(?=[\s\S]*\bdrawWall\([^)]*\)\s*\{[^}]{0,300}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/, why: 'one colour clear per frame on the main context, no render-to-texture: draw() clears once, or hands the frame to drawWall() (which clears) and returns. frameId, the camFrame gate and the blind LEQUAL/depthMask(true) restore all assume this' },
  { script: SHADERS, file: 'js/dragonview.js', test: /\bfunction dragonView\(\s*(\w+)[^)]*\)\s*\{\s*const\s+\w+\s*=\s*\1\.getContext\(\s*["']webgl2["']/, why: 'the dragon view renders on its own canvas and WebGL2 context, so its colour clear is not counted as a frame (only the context that first uses a patched program is)' },
  { script: SHADERS, file: 'js/main.js', test: /loadTiles\(\s*\w+\.texNames\s*\)[\s\S]{0,200}?\.texNames\.indexOf\(\s*["']oak_planks["']\s*\)[\s\S]{0,200}?\.setTiles\(/, why: 'the list searched for "oak_planks" is texNames, the same list that orders the atlas layers passed to setTiles' },
  { script: SHADERS, file: 'engine.wasm', test: /^(?=[\s\S]*oak_leaves)(?=[\s\S]*water_still)(?=[\s\S]*short_grass)(?=[\s\S]*glowstone)/, why: 'layers are classified by texture name (*leaves*, water*, the plant list, the emissive list)' },
  // K (the shader toggle, rebindable since 1.5.2). Main.js has no key codes of its own any more, so the facts are one bind in
  // keys.js and the gate in main.js. The toggle's own guard against the game's Controls screen is the controls.js entry below.
  { script: SHADERS, file: 'js/keys.js', test: new RegExp(R`^(?![\s\S]*["'\x60]KeyK["'\x60][\s\S]*["'\x60]KeyK["'\x60])[\s\S]*${BIND('bpKeep', 'KeyK')}[^{}]*?\bscope\s*:\s*["']place["']`), why: 'K is a game key in one place only: bpKeep, the one bind on KeyK, in scope "place". Any wider use of K must be caught and judged again. Deliberately red on staging until this file arrives there.' },
  { script: SHADERS, file: 'js/main.js', test: new RegExp(R`^(?![\s\S]*["'\x60]KeyK["'\x60])(?![\s\S]*\.KeyK\b)(?![\s\S]*\b(?:keyCode|which)\s*===?\s*75\b)(?:(?=[\s\S]*\b(?<place>\w+)\s*=\s*(?<ev>\w+)\.code\s*===\s*["']Escape["']\s*\?\s*["']Escape["']\s*:\s*\w+\.action\(\s*\k<ev>\.code\s*,\s*["']place["']\s*\)\s*;\s*if\s*\(\s*\w+\.active\(\)\s*&&\s*!\w+\.menu\s*&&\s*!\w+\.chatOpen\s*&&\s*\k<place>\s*\)\s*\{[^{}]*?\.key\(\s*\k<place>\s*\))|(?![\s\S]*\bblueprint-ui\.js\b))`), why: 'scope "place" binds act only with a blueprint ghost held and no menu or chat: BP.active() && !S.menu && !S.chatOpen && place, then BP.key(place). That is when K also flips the ghost\'s "keep", an overlap the user accepted: both fire. (In an undo preview the game also swallows place keys, but only bpPaste and Escape do anything there.) A build with no blueprints (staging) has nothing to gate, and main.js itself reads K in no form on any build' },
  // --- Twitterentary shaders: how a frame is drawn. The viewport hook detects the frame and starts its timing on the
  // frame's one viewport call, and the shadow pass restores what it found. These are the game facts that relies on.
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.viewport\([\s\S]*\.viewport\()[\s\S]*(?<!\basync\s+)\bdraw\(\s*(\w+)\s*\)\s*\{(?:(?!\.\w+\()[^{}]){0,200}?\.viewport\(\s*0\s*,\s*0\s*,\s*\1\.w\s*,\s*\1\.h\s*\)/, why: 'Gfx.draw(v) (not async) calls viewport(0, 0, v.w, v.h) before any other method call, and it is gfx.js\'s only viewport: the viewport hook detects the frame on that call and remembers it as the viewport the shadow pass restores' },
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: SHADOW_STATE_SAFE(file), why: file === 'js/gfx.js'
    ? 'no render target and no scissor: the shadow tiles leave their scissor box set without restoring it, and put back the framebuffer they found'
    : 'no viewport (gfx.js draw() sets the frame\'s only one), render target or scissor: the shadow tiles leave their scissor box set, and restore only the frame viewport and framebuffer they found' })),
  { script: SHADERS, file: 'js/main.js', test: /^(?![\s\S]*\.(?:viewport|scissor|bindFramebuffer|createFramebuffer|bindRenderbuffer|createRenderbuffer|framebufferTexture2D|blitFramebuffer)\()(?![\s\S]*\bSCISSOR_TEST\b)/, why: 'main.js reaches gfx.gl directly (textures, isContextLost, the GPU name) but sets no viewport, render target or scissor: the shadow pass sees only gfx.js\'s frame state' },
  { script: SHADERS, file: 'js/main.js', test: /\b(\w+)\s*=\s*[\w$.]+\(\s*["']#gl["']\s*\)[\s\S]*?\bconst\s+(\w+)\s*=\s*\1\.width\s*,\s*(\w+)\s*=\s*\1\.height\b[\s\S]{0,4000}?\.draw\(\s*\{[^}]*?\bw\s*:\s*\2\s*,\s*h\s*:\s*\3\b/, why: 'the frame is drawn at the #gl canvas size, gfx.draw({w: glCanvas.width, h: glCanvas.height}): the frame viewport is the whole canvas, read fresh each frame, so nothing of ours caches the canvas size (resize, .pix menus)' },
  { script: SHADERS, file: 'js/main.js', test: /\.draw\(\s*\{[^}]*?\bw\s*:\s*\w+\s*,\s*h\s*:(?:(?!\bawait\b)[\s\S]){0,800}?\}\s*\)\s*;\s*if\s*\(\s*(\w+)\s*&&\s*!\w+\s*\)\s*\{\s*\1\.drawCrack\([^;]*;(?:(?!\bawait\b)[\s\S]){0,300}?\.drawHeld\((?:(?!\bawait\b)[\s\S]){0,200}?\.drawFireOverlay\(/, why: 'after gfx.draw() returns, main.js draws the survival crack, hands and fire overlay with no await in between: they run in the same rAF task as the frame viewport, so they fall inside the frame\'s timed span (perf.cpuMs, the GPU timer query)' },
  { script: SHADERS, file: 'js/frameloop.js', test: /\bfunction\s+createFrameLoop\(\s*(\w+)\s*,\s*(\w+)\s*=\s*(\w+)\s*=>\s*requestAnimationFrame\(\s*\3\s*\)\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,300}?\bconst\s+(\w+)\s*=\s*(\w+)\s*=>\s*\{[^{}]*?=\s*\2\(\s*\4\s*\)[^{};]*;\s*\1\(\s*\5\s*\)\s*;?\s*\}/, why: 'createFrameLoop(frame, raf = fn => requestAnimationFrame(fn)) re-arms with the same step function before calling frame(now), and looks up the global requestAnimationFrame at each call: our rAF wrapper (installed at document-start) sees every frame, and its one cached wrapper per callback is reused' },
  { script: SHADERS, file: 'js/main.js', test: /\bcreateFrameLoop\(\s*\w+\s*\)/, why: 'main.js creates its frame loop with the default raf (the global requestAnimationFrame), so our wrapper times the game\'s callback' },
  // perf.fpsGame copies the game's F3 counter. S isn't exported and F3 is drawn on the HUD canvas, so a change to the
  // game's window can only be caught here.
  { script: SHADERS, file: 'js/main.js', test: /\bfunction\s+frame(?:Body)?\(\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\b(\w+)\+\+\s*;\s*if\s*\(\s*\1\s*-\s*(\w+)\s*>\s*1e3\s*\)\s*\{\s*\w+\.fps\s*=\s*\2\s*;\s*\2\s*=\s*0\s*;\s*\3\s*=\s*\1\b/, why: 'the game\'s FPS is a frame count, not a mean: frames++, and when now - fpsT > 1e3 (on the rAF timestamp) S.fps = frames; frames = 0; fpsT = now. perf.fpsGame repeats exactly this, so F2 and F3 agree: if the game changes its window, change perfFrame()' },
  { script: SHADERS, file: 'js/main.js', test: /\$\{\s*\w+\.fps\s*\}\s*fps,\s*\$\{\s*\w+\.chunks\.size\s*\}\s*chunks/, why: 'F3\'s first line is `${S.fps} fps, ${gfx.chunks.size} chunks`: the number the F2 overlay has to match is that S.fps, shown unrounded' },
  // The atlas outgrowing one array texture (js/texpages.js). Staging lacks this file until it gets build 6b3963e444, so
  // these two entries stay red there until then: a deliberate decision, rather than an optional-file flag in tools/.
  { script: SHADERS, file: 'js/texpages.js', test: /^(?=[\s\S]*\bPAGE_UNIT\s*=\s*8\b)(?=[\s\S]*=\s*PAGE_UNIT\s*\+\s*\w+\s*-\s*1\b)/, why: 'the game\'s extra atlas pages start at texture unit PAGE_UNIT = 8 (page k on PAGE_UNIT + k - 1): our units 6 and 7 stay free, and anything we add must stay below 8. (Staging lacks this file until it gets build 6b3963e444, so this is red there.)' },
  { script: SHADERS, file: 'js/texpages.js', test: /\\\\btexture\\\\\(\\\\s\*\$\{(\w+)\}\\\\s\*,`\s*,\s*["']g["']\s*\)\s*,\s*`\$\{\1\}_t\(`/, why: 'on a paged atlas pagedFS() rewrites texture(uTex, to uTex_t(, so our "vec4 c = texture(uTex, vUV);" anchor no longer matches: patchTerrainFS() returns null and that player gets the vanilla look, by design. (Staging lacks this file until it gets build 6b3963e444, so this is red there.)' },

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
  { script: OPTIONS, file: 'js/menus.js', test: /\bbtn\(\s*\w+\(\s*["']pause\.options["']\s*\)\s*,\s*openOptions\s*\)/, why: 'the Options button of the pause menu (and of the title, on a build that has it there) is btn(t("pause.options"), openOptions): clicks on button[aria-label=t("pause.options")] open our menu on either screen' },
  { script: OPTIONS, file: 'js/keys.js', test: new RegExp(BIND('hideHud', 'F1') + R`[^{}]*?\bscope\s*:\s*["']game["']`), why: 'the HUD toggle sends a press of the hideHud key: F1 by default, in scope "game" (sendF1 asks codeOf("hideHud") and falls back to F1). Deliberately red on staging until this file arrives there.' },
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
  { script: [OPTIONS, ZOOM], file: 'index.html', test: 'id="cross"', why: 'the crosshair is #cross' },
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
  { script: OPTIONS, file: 'js/main.js', test: new RegExp(R`^(?:(?=[\s\S]*delete\s+\w+\.keys\[\s*\w+\.code\s*\])(?=[\s\S]*\.keys\[\s*\w+\s*\]\s*=\s*true)|(?=[\s\S]*${KEYS_IMPORT})(?=[\s\S]*\bfunction\s+onKeyUp\(\s*(?<up>\w+)\s*\)\s*\{\s*(?<rel>\w+)\(\s*\k<up>\.code\s*\)\s*;?\s*\})(?=[\s\S]*\bfunction\s+\k<rel>\(\s*(?<c>\w+)\s*\)\s*\{\s*delete\s+\w+\.keys\[\s*\k<c>\s*\])(?=[\s\S]*\bconst\s+(?<dn>\w+)\s*=\s*\w+\.code\s*;[\s\S]*?\b(?<press>\w+)\(\s*\k<dn>\s*,\s*\w+\s*\)\s*;?\s*\}\s*function\s+\k<press>\(\s*(?<p>\w+)\s*,\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\.keys\[\s*\k<p>\s*\]\s*=\s*true))`), why: 'held keys are tracked by e.code: what our remap rewrites on a build without js/keys.js. With that file our remap is retired, but sendF1\'s synthetic keydown still reaches the game the same way: onKeyDown passes e.code to worldPress, which sets S.keys[c], and onKeyUp hands e.code to worldRelease, which deletes it' },
  { script: OPTIONS, file: 'js/main.js', test: new RegExp(R`^(?:(?=[\s\S]*${KEYS_IMPORT})|(?=[\s\S]*\.KeyW\b)(?=[\s\S]*\.KeyS\b)(?=[\s\S]*\.KeyA\b)(?=[\s\S]*\.KeyD\b)(?=[\s\S]*["']Space["'])(?=[\s\S]*\.ShiftLeft\b)(?=[\s\S]*\.ControlLeft\b)(?=[\s\S]*["']KeyQ["'])(?=[\s\S]*["']KeyE["'])(?=[\s\S]*["']KeyT["'])(?=[\s\S]*["']F5["'])(?=[\s\S]*["']F3["'])(?=[\s\S]*["']F1["']))`), why: 'on a build without js/keys.js the Keybinds tab lists these game codes (GAME_ACTIONS): W A S D, Space, ShiftLeft, ControlLeft, Q, E, T, F5, F3, F1. With that file the game rebinds them itself, the rows are gone, and the keys.js entries below hold what the game uses' },
  { script: OPTIONS, file: 'js/main.js', test: /===\s*["'](?:F1|hideHud)["']\s*\)\s*\{?\s*\w+\.showHud\s*=\s*!\s*\w+\.showHud/, why: 'a keydown of the HUD key toggles S.showHud: by e.code === "F1", or from f6b38f505d by the action a === "hideHud". The HUD toggle sends one' },
  // The performance overlay keybind (tc.perfOverlay) defaults to F2, so no game module may handle F2
  ...KEY_MODULES.map(file => ({ script: OPTIONS, file, test: NOT_F2, why: 'F2 (default key of the performance overlay, tc.perfOverlay) is not a game key here: no "F2" code or key, .F2 or keyCode 113.' + STAGING_RED(file) })),
  { script: OPTIONS, file: 'js/keys.js', test: NOT_DEFAULT_BIND('F2'), why: 'F2 is no bind\'s default or alternative, so a fresh profile leaves it to the overlay. A player can still bind it on the game\'s Controls screen: then both act. Deliberately red on staging until this file arrives there.' },
  { script: OPTIONS, file: 'js/keys.js', test: /\bprevent\s*=\s*(\w+)\s*=>\s*!\(\s*\1\.ctrlKey\s*\|\|\s*\1\.metaKey\s*\|\|\s*\1\.altKey\s*\)\s*&&\s*\(\s*\1\.code\s*===\s*["']Quote["']\s*\|\|\s*bound\(\s*\1\.code\s*\)\s*\)/, why: 'the game preventDefaults only a bound key (or Quote) with no Ctrl, Cmd or Alt held. F2 is no default bind, so it isn\'t prevented unless a player binds it: our F2 handler calls preventDefault itself. Deliberately red on staging until this file arrives there.' },
  { script: OPTIONS, file: 'js/main.js', test: /\bPREVENT\s*=\s*new\s+Set\(\s*\[(?![^\]]*["']F2["'])[^\]]*["']F1["'][^\]]*["']F3["'][^\]]*\]\s*\)|\bif\s*\(\s*\w+\.prevent\(\s*(\w+)\s*\)\s*\)\s*\1\.preventDefault\(\)/, why: 'the game\'s only blanket preventDefault in play is its PREVENT set (F1/F3/F5, no F2), or from f6b38f505d KB.prevent(e): our F2 handler calls preventDefault itself' },
  // Zoom holds Z by default (it moved off C in 1.1.2), so no game module may handle Z but the skin editor's Ctrl+Z
  ...KEY_MODULES.filter(file => file !== 'js/skin-editor.js').map(file => ({ script: ZOOM, file, test: NOT_Z, why: 'Z (default key of Zoom) is not a game key here: no "KeyZ" code, .KeyZ, "z" key or keyCode 90.' + STAGING_RED(file) })),
  { script: ZOOM, file: 'js/keys.js', test: NOT_DEFAULT_BIND('KeyZ'), why: 'Z is no bind\'s default or alternative, so a fresh profile leaves it to Zoom. A player can still bind it on the game\'s Controls screen: then both act. Deliberately red on staging until this file arrives there.' },
  { script: ZOOM, file: 'js/skin-editor.js', test: /^(?![\s\S]*KeyZ[\s\S]*KeyZ)(?![\s\S]*\b(?:keyCode|which)\s*===?\s*90\b)[\s\S]*\(\s*\w+\.ctrlKey\s*\|\|\s*\w+\.metaKey\s*\)\s*&&\s*\w+\.code\s*===\s*["']KeyZ["']/, why: 'the game\'s only use of Z is undo and redo in the skin editor, on Ctrl/Cmd+Z. Zoom ignores modifiers since 1.1.2, so what keeps that shortcut from starting a zoom is canZoom(), which refuses while .se exists or #screen is on' },
  // Better Options warns when a mod key lands on a game key. These entries keep what it knows honest. With js/keys.js the list
  // of game keys is BINDS: the first entry fails on any literal code it doesn't name and on any it names that the game drops.
  { script: OPTIONS, file: 'js/keys.js', test: ONLY_BIND_CODES, why: 'BINDS holds exactly these defaults and alternatives (BIND_CODES), plus the nine hotbar digits. A code outside the list fails here, and the runtime check that walks K.BINDS proves Better Options warns for every one. Deliberately red on staging until this file arrives there.' },
  { script: [OPTIONS, ZOOM], file: 'js/keys.js', test: new RegExp('^' + ['loadout:KeyR', 'saveToolbar:KeyC', 'loadToolbar:KeyX', 'bpTurn:KeyR', 'bpKeep:KeyK', 'bpPaste:KeyC'].map(b => R`(?=[\s\S]*${BIND(...b.split(':'))})`).join('')), why: 'survival/hotbars.js and blueprint-ui.js ask by bind id: loadout R, saveToolbar C and loadToolbar X, and bpTurn R, bpKeep K and bpPaste C, each default a mod key would collide with. Deliberately red on staging until this file arrives there.' },
  { script: OPTIONS, file: 'js/main.js', test: new RegExp(NO_NEW_GAME_KEY + R`(?:(?=[\s\S]*${KEYS_IMPORT})${NO_RAW_KEYS}|(?![\s\S]*${KEYS_IMPORT})(?=[\s\S]*["']KeyC["'])(?=[\s\S]*["']KeyM["'])(?=[\s\S]*["']KeyO["'])(?=[\s\S]*["']KeyP["'])(?=[\s\S]*["']KeyV["'])(?=[\s\S]*["']Enter["'])(?=[\s\S]*["']Slash["'])(?=[\s\S]*["']Tab["'])(?=[\s\S]*["']ArrowUp["'])(?=[\s\S]*["']ArrowDown["'])(?=[\s\S]*["']ArrowLeft["'])(?=[\s\S]*["']ArrowRight["'])(?=[\s\S]*\.ShiftRight\b)(?=[\s\S]*\.startsWith\(\s*["']Digit["']\s*\)\s*&&\s*\w+\s*!==\s*["']Digit0["'])(?:(?=[\s\S]*["']KeyF["'])(?=[\s\S]*["']KeyK["'])(?=[\s\S]*["']KeyR["'])|(?![\s\S]*["']Key[FKR]["'])))`), why: 'with js/keys.js, main.js holds no key code or poll of its own, so everything it handles is in BINDS. Without it (staging), GAME_ONLY_KEYS lists what onKeyDown handles beyond the GAME_ACTIONS rows: C, M, O, P, V, Enter, Slash, Tab, the four arrows, ShiftRight and Digit1-9, plus F, K and R (all three or none). There, a code outside those fails here if it is a quoted string or a .Key, .Control, .Alt or .Meta poll; a code main.js builds at runtime would not be seen' },
  // Staging has neither of the next two files yet: as with js/texpages.js, these entries stay red there until it gets
  // them, a deliberate decision rather than an optional-file flag in tools/.
  { script: [OPTIONS, ZOOM], file: 'js/survival/hotbars.js', test: new RegExp('^' + NO_RAW_KEYS + R`(?=[\s\S]*\.is\(\s*\w+\s*,\s*["']loadout["']\s*\))(?=[\s\S]*\.held\(\s*["']saveToolbar["'])(?=[\s\S]*\.held\(\s*["']loadToolbar["'])`), why: 'survival/hotbars.js reads the loadout key, and saveToolbar and loadToolbar held with a digit, by bind id. It holds no key code of its own, so neither Zoom\'s Z nor the overlay\'s F2. Deliberately red on staging until this file arrives there.' },
  { script: [OPTIONS, ZOOM], file: 'js/blueprint-ui.js', test: new RegExp('^' + NO_RAW_KEYS + R`(?=[\s\S]*\bexport\s+function\s+key\(\s*(?<a>\w+)\s*\)\s*\{(?=[\s\S]*\k<a>\s*===\s*["']bpTurn["'])(?=[\s\S]*\k<a>\s*===\s*["']bpKeep["'])(?=[\s\S]*\k<a>\s*===\s*["']bpPaste["']))`), why: 'blueprint-ui.js key() takes the place actions bpTurn, bpKeep and bpPaste (and Escape) from main.js. It holds no key code of its own, so neither Zoom\'s Z nor the overlay\'s F2. Deliberately red on staging until this file arrives there.' },
  // Why Zoom left C. These record a reason, not a dependency, so they use `known`: each asserts the old state ("C is free
  // here"), which is false today. That reports as known and never fails, here or on a build without the file. If the
  // game ever frees C the check says "now passes", which is the moment to reconsider.
  { script: ZOOM, file: 'js/keys.js', test: new RegExp(R`^(?![\s\S]*${BIND('saveToolbar', 'KeyC')})`), why: 'C would be free for Zoom here',
    known: 'in creative, holding C (saveToolbar) with a digit saves the hotbar row, so Zoom\'s old default C could overwrite a saved hotbar: Zoom moved to Z' },
  { script: ZOOM, file: 'js/keys.js', test: new RegExp(R`^(?![\s\S]*${BIND('bpPaste', 'KeyC')})`), why: 'C would be free for Zoom here',
    known: 'with a blueprint ghost held, C (bpPaste) pastes it (net.send bpPaste), so Zoom\'s old default C could paste a blueprint: Zoom moved to Z' },
  // The game's own Controls screen (js/controls.js, opened from Options). Our key listeners run on window in the capture
  // phase and were registered at document-start, so they run before the game's recorder and it can't protect them.
  { script: OPTIONS, file: 'js/keys.js', exports: ['BINDS', 'codeOf', 'action', 'bound', 'set'], why: 'what Better Options uses from the game\'s keys module: BINDS for the migration plan, codeOf and action to find and verify the HUD key, bound for the game-key warning, set to move a saved remap into the game. Deliberately red on staging until this file arrives there.' },
  // Better Options imports /js/keys.js itself. A module's state belongs to its URL, so a query string on the game's import would
  // give the game a second copy of the binds, and ours would change nothing. The runtime check of recording on the Controls
  // screen proves it live: it reads through our import what the game's recorder just wrote.
  ...['js/main.js', 'js/controls.js'].map(file => ({ script: OPTIONS, file, test: new RegExp(KEYS_IMPORT + R`|^(?![\s\S]*\bkeys\.js\b)`), why: 'the game imports "./keys.js" with no query string, so import("/js/keys.js") is the instance it uses. A build with no such module has nothing to share.' + STAGING_RED(file) })),
  { script: OPTIONS, file: 'index.html', test: /^(?![\s\S]*<base\b)[\s\S]*<script\b[^>]*\bsrc=["']\/js\/main\.js(?:\?[^"']*)?["']/, why: 'main.js loads from /js/ with no <base>, so its "./keys.js" resolves to /js/keys.js, the path Better Options imports. A query on main.js itself would not carry over to that import' },
  { script: [OPTIONS, SHADERS, ZOOM], file: 'js/controls.js', exports: ['openControls'], why: 'the game\'s own rebinding screen: Better Options\' Keybinds tab sends the player there for game keys. Deliberately red on staging until this file arrives there.' },
  { script: [OPTIONS, SHADERS], file: 'js/controls.js', test: /\bclass\s*:\s*["']keylist["']/, why: 'the Controls screen\'s list is div.keylist: "#screen.on .keylist" is how the shader toggle and the overlay key know to stand aside. Deliberately red on staging until this file arrives there.' },
  { script: [OPTIONS, SHADERS, ZOOM], file: 'js/controls.js', test: new RegExp(R`\bfunction\s+(?<take>\w+)\(\s*(?<e>\w+)\s*,\s*\w+\s*\)\s*\{\s*\k<e>\.preventDefault\(\)\s*;\s*\k<e>\.stopImmediatePropagation\(\)[\s\S]*?\baddEventListener\(\s*["']keydown["']\s*,\s*\w+\s*=>\s*\{[^{}]*?\k<take>\(\s*\w+\s*,\s*\w+\.code\s*\)[^{}]*?\}\s*,\s*true\s*\)`), why: 'a new key is recorded by a capture-phase window keydown that stops every later listener, but ours run first: a mod key pressed to record a bind would still fire its action unless it stands aside on this screen. Deliberately red on staging until this file arrives there.' },
  { script: ZOOM, file: 'js/controls.js', test: /\.showScreen\(\s*["']controls["']\s*,[\s\S]*["']dim["']\s*\)/, why: 'the Controls screen goes through showScreen(), so #screen is on and canZoom() refuses there: Zoom needs no .keylist test of its own. Deliberately red on staging until this file arrives there.' },
  { script: OPTIONS, file: 'js/menus.js', test: new RegExp(R`\.menuName\s*===\s*["']controls["']\s*\)\s*openOptions\(\)|^(?![\s\S]*${CONTROLS_IMPORT})`), why: 'back() from "controls" goes to the game\'s Options, not our menu: Done or Escape there does not return to the Keybinds tab. A build without js/controls.js has no such screen' },
  { script: OPTIONS, file: 'js/menus.js', test: new RegExp(R`\bbtn\(\s*\w+\(\s*["']options\.controls["']\s*\)\s*,\s*openControls\s*\)|^(?![\s\S]*${CONTROLS_IMPORT})`), why: 'the game opens the screen from a Controls button on its Options screen, with openControls as the handler. A build without js/controls.js has no such button' },
  // "Run benchmark" shows a see-through screen (menus.showScreen("tcbench", build, ""), #screen class "on") while it runs
  { script: OPTIONS, file: 'js/main.js', test: /\bfunction\s+\w+\(\s*\w+\s*\)\s*\{\s*const\s+(\w+)\s*=[^;]*?!\s*\w+\.menu\b[^;]*;\s*const\s+(\w+)\s*=\s*\w+\.sample\([^,]*,\s*\1\s*,[^)]*\)\s*;\s*if\s*\(\s*\2\s*===\s*["']regain["']\s*\)\s*regainCanvases\(\)/, why: 'the slow-frame watch counts only frames with no menu open (steady = ... && !S.menu): while our benchmark screen is shown, the bench\'s slow frames do not count towards it, so regainCanvases() (the HUD canvas and font atlas) cannot fire mid-run' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction showScreen\(\s*\w+\s*,\s*(\w+)\s*,\s*\w+\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,600}?\.menu\s*=\s*\1\s*;(?:(?!\bfunction\b)[\s\S]){0,300}?\.releaseInput\(\)/, why: 'showScreen() sets S.menu and calls releaseInput() (held keys, look and pointer lock dropped): the player cannot move or look while the benchmark screen is up, and it is why prime() must never open a menu during play (it would drop pointer lock)' },
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
  { script: [OPTIONS, ZOOM], file: 'js/skin-editor.js', test: /\bconst\s+(\w+)\s*=\s*\w+\(\s*["']div["']\s*,\s*\{\s*class\s*:\s*["']se["']\s*,\s*role\s*:\s*["']dialog["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b\1\.remove\(\))/, why: 'the skin editor is a div.se dialog appended to <body> while open and removed on close: a .se element means it is open. Better Options ignores F2 then, and Zoom\'s canZoom() refuses, because Ctrl+Z is the editor\'s undo and #screen can be off behind it (wardrobe.js opens it after awaiting image loads)' },
  { script: OPTIONS, file: 'js/skin-preview.js', test: /\bconst\s+(\w+)\s*=\s*\w+\(\s*["']div["']\s*,\s*\{\s*class\s*:\s*["']sp["']\s*,\s*role\s*:\s*["']dialog["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b\1\.remove\(\))/, why: 'the skin import preview is a div.sp dialog appended to <body> while open and removed on close: a .sp element means it is open' },
  { script: OPTIONS, file: 'js/signs.js', test: /^(?=[\s\S]*\b(\w+)\.id\s*=\s*["']sign-editor["'][\s\S]*?\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\b(\w+)\s*=\s*this\.editor\s*;[\s\S]{0,80}?\b\2\.el\.remove\(\))/, why: 'the sign editor is a div#sign-editor appended to <body> while open and removed when done: #sign-editor means it is open' },
  { script: OPTIONS, file: 'js/survival/book.js', test: /\b(\w+)\.id\s*=\s*["']book-screen["'](?=[\s\S]*\bdocument\.body\.append\(\s*\1\s*\))(?=[\s\S]*\.ui\.el\.remove\(\))/, why: 'the book screen is a div#book-screen appended to <body> while open and removed on close: #book-screen means it is open' },
  { script: OPTIONS, file: 'index.html', test: /^(?![\s\S]*\bclass=["'](?:[^"']*\s)?(?:se|sp)(?:\s[^"']*)?["'])(?![\s\S]*\bid=["'](?:sign-editor|book-screen)["'])/, why: 'the page has no permanent .se, .sp, #sign-editor or #book-screen element (it would make Better Options think an editor is always open: F2 would be ignored, and a benchmark would never reopen our menu)' },
  // Better Options 1.2: the benchmark screen is watched (MutationObserver) and stops the run when the game replaces it
  { script: OPTIONS, file: 'js/menus.js', test: /\bconst\s+(\w+)\s*=\s*document\.querySelector\(\s*["']#screen["']\s*\)\s*,\s*(\w+)\s*=\s*document\.querySelector\(\s*["']#screen \.inner["']\s*\)(?![\s\S]*(?<![.\w])\2\s*=(?!=))(?![\s\S]*(?<![.\w])(?:\1|\2)\.(?:remove|replaceWith|outerHTML)\b)(?=[\s\S]*\bfunction\s+showScreen\(\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,600}?\b\2\.replaceChildren\(\s*\.\.\.\3\(\)\.filter\(\s*Boolean\s*\)\s*\)\s*;\s*\1\.className\s*=\s*["']on["']\s*\+\s*\(\s*\4\s*\?)(?=[\s\S]*\bfunction\s+closeMenu\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\b\1\.className\s*=\s*["']["']\s*;\s*\2\.replaceChildren\(\s*\))/, why: 'menus.js looks #screen and #screen .inner up once and never replaces them; showScreen() replaces .inner\'s children and sets #screen\'s class, closeMenu() sets class "" and empties .inner: an observer on #screen[class] and .inner\'s child list sees every screen change, so the benchmark stops as soon as the game takes its screen away' },
  { script: OPTIONS, file: 'js/main.js', test: /\bfunction\s+(\w+)\(\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bif\s*\(\s*(\w+)\.menu\s*\)\s*\{(?:(?!\bfunction\b)[^{}])*?\bif\s*\(\s*\2\.code\s*===\s*["']Escape["'][^{}]*?\)\s*\{\s*\2\.preventDefault\(\)\s*;\s*if\s*\(\s*\3\.menuName\s*===\s*["']pause["']\s*\)\s*\w+\(\)\s*;?\s*else\s+\w+\.back\(\)\s*;?\s*\}\s*return\s*;?\s*\}[\s\S]*[{;]\s*addEventListener\(\s*["']keydown["']\s*,\s*\1\s*\)/, why: 'with a menu open, the game handles Escape only in its window keydown listener (bubble phase, no capture): it calls M.back() (which would open the pause menu over the benchmark) and returns. Our capture-phase window listener runs first, so on the benchmark screen it consumes Escape (stopImmediatePropagation) and stops the run instead' },
  // Better Options 1.3: "Copy all settings" reads these named keys, never all of mc.* (see the settingsText() check)
  { script: OPTIONS, file: 'js/main.js', test: /\bheldLight\s*:\s*\w+\.get\(\s*["']mc\.heldLight["']\s*\)\s*!==\s*["']0["']/, why: 'mc.heldLight is on unless it is "0": Copy settings reports it as a boolean the same way' },
  { script: OPTIONS, file: 'js/fireflies.js', test: /\bKEY\s*=\s*["']mc\.fireflies["']/, why: 'the fireflies setting is stored in mc.fireflies, which Copy settings reports' },
  { script: OPTIONS, file: 'js/i18n.js', test: /\bLANG_KEY\s*=\s*["']mc\.lang["']/, why: 'the language is stored in mc.lang, which Copy settings reports' },
  // Better Options 1.3 and Zoom 1.1.1: priming the FOV input (bus.fov.prime) only when it can't disturb the player
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /\b(\w+)\s*=\s*[\w$.]+\(\s*["']#cross["']\s*\)[\s\S]*?\b\1\.classList\.toggle\(\s*["']off["']\s*,\s*!\(\s*\w+\s*&&\s*!\w+\.menu\b/, why: '#cross has class "off" whenever a menu is open or the in-world HUD is not drawn, so a #cross without "off" means the world is on screen with no menu: our only DOM proof that S.menu is empty, which prime()\'s idle test needs' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /\bfunction\s+releaseInput\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,300}?\bdocument\.exitPointerLock\(\)/, why: 'releaseInput() drops pointer lock with a dynamic document.exitPointerLock() call: we shadow that method for one synchronous task so a priming pass keeps pointer lock. If the game cached the function, the shadow would silently stop working' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: /\bfunction\s+onLockChange\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,500}?\bif\s*\(\s*\w+\.started\s*&&\s*\w+\.input\s*===\s*["']lock["']\s*&&\s*!\w+\.menu\b(?:(?!\bfunction\b)[\s\S]){0,200}?\bopenPause\(\)/, why: 'losing pointer lock while a world runs with no menu open opens the pause menu (onLockChange): why a lock lost during the old first-press FOV steal looked like a broken zoom, and why both scripts shadow exitPointerLock while they rebuild a menu' },
  { script: ZOOM, file: 'js/main.js', test: /\bROOM\s*=\s*\(\s*location\.pathname\.match\(\s*\/\^\\\/\(\?:r\|play\)\\\//, why: 'a world\'s path starts /r/ or /play/: inWorld() tests the same prefix before priming' },
  // Better Options 1.3.1: noWorld() copies the game's whole ROOM regex, because with no world the HUD toggle and the
  // render-distance slider can't act on the game
  { script: OPTIONS, file: 'js/main.js', test: /\bROOM\s*=\s*\(\s*location\.pathname\.match\(\s*\/\^\\\/\(\?:r\|play\)\\\/\(\[a-z0-9\]\{16\}\)\\\/\?\$\/\s*\)\s*\|\|\s*\[\s*\]\s*\)\s*\[\s*1\s*\]\s*\|\|\s*null\s*;\s*const\s+TITLE\s*=\s*!\s*ROOM\b/, why: 'a world\'s path is /r/ or /play/ plus a 16-character id, and TITLE = !ROOM: noWorld() tests the same regex, so it is true exactly on the title path' },
  { script: OPTIONS, file: 'js/menus.js', test: /\blocation\.href\s*=\s*\w+\(\s*\(\s*\w+\.FRAMED\s*\?\s*["']\/play\/["']\s*:\s*["']\/r\/["']\s*\)\s*\+\s*\w+\s*\)/, why: 'joining a world is a full page load (location.href), so noWorld() can\'t go stale: the path never changes under a running script' },
  ...['js/main.js', 'js/menus.js'].map(file => ({ script: OPTIONS, file, test: /^(?![\s\S]*\bhistory\.pushState\b)(?![\s\S]*\bhistory\.replaceState\(\s*\w+\s*,\s*["']["']\s*,\s*(?!location\.pathname\b))/, why: 'the game never pushes history, and its replaceState calls keep the same pathname: the other way noWorld() could go stale' })),
  { script: OPTIONS, file: 'js/main.js', test: /\bfunction onKeyDown\(\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\bif\s*\(\s*!\s*\w+\.started\s*\|\|(?:(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?===\s*["']F1["']\s*\)\s*\{?\s*\w+\.showHud\s*=\s*!|(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?\b(\w+)\(\s*\w+\s*,\s*\1\s*\)\s*;?\s*\}\s*function\s+\2\(\s*\w+\s*,\s*\w+\s*\)\s*\{(?:(?!\bfunction\s+\w+\s*\()[\s\S])*?===\s*["']hideHud["']\s*\)\s*\{?\s*\w+\.showHud\s*=\s*!)/, why: 'onKeyDown returns on !S.started before it reaches the HUD key (inline on "F1", or from f6b38f505d in worldPress on "hideHud"): with no world our key press does nothing, so toggleHud() must not save a flip that would leave hud.on inverted once in a world' },
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /\bfunction\s+showScreen\(\s*(\w+)\s*,[^)]*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,300}?\bif\s*\(\s*\1\s*!==\s*["']inv["']\s*\)\s*\w+\.closeInv\(\)/, why: 'showScreen() closes the inventory for any screen but "inv": why priming is refused while the inventory is open' },
  { script: ZOOM, file: 'js/menus.js', test: /^(?=[\s\S]*\binner\s*=\s*document\.querySelector\(\s*["']#screen \.inner["']\s*\))(?=[\s\S]*\bfunction\s+showScreen\((?:(?!\bfunction\b)[\s\S]){0,500}?\binner\.replaceChildren\(\s*\.\.\.)(?=[\s\S]*\bfunction\s+closeMenu\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,300}?\binner\.replaceChildren\(\s*\))/, why: 'showScreen() and closeMenu() both go through inner.replaceChildren on the one #screen .inner element: the smoke check of localStealFov spies on that call, the only sign of them from outside the module' },
  // pauseUp() tells the pause menu from the title by look: the same Options button is on both, so it requires class "dim"
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction showScreen\(\s*\w+\s*,\s*\w+\s*,\s*(\w+)\s*\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,700}?\.className\s*=\s*["']on["']\s*\+\s*\(\s*\1\s*\?\s*["'] ["']\s*\+\s*\1\s*:\s*["']["']\s*\)/, why: 'showScreen(name, build, look) sets #screen\'s class to "on" plus the look: pauseUp() reads that look' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction openPause\(\)\s*\{(?:(?!\bfunction\b)[\s\S])*?\bshowScreen\(\s*["']pause["']\s*,(?:(?!\bfunction\b)[\s\S])*?\bbtn\(\s*\w+\(\s*["']pause\.options["']\s*\)\s*,\s*openOptions\s*\)(?:(?!\bfunction\b)[\s\S])*?\}\s*,\s*["']dim["']\s*\)\s*;?\s*\}/, why: 'openPause() has the pause.options button and passes the look "dim": what pauseUp() requires' },
  { script: OPTIONS, file: 'js/menus.js', test: /^(?![\s\S]*["']pause\.options["'][\s\S]*["']pause\.options["'][\s\S]*["']pause\.options["'])(?=[\s\S]*\bfunction showTitle\([^)]*\)\s*\{(?:(?!\bfunction\b)[\s\S])*?\bshowScreen\(\s*["']title["']\s*,(?:(?!\bfunction\b)[\s\S])*?\}\s*,\s*["']title["']\s*\)\s*;?\s*\})(?:(?=[\s\S]*\bfunction showTitle\((?:(?!\bfunction\b)[\s\S])*?\bbtn\(\s*\w+\(\s*["']pause\.options["']\s*\)\s*,\s*openOptions\s*\)(?:(?!\bfunction\b)[\s\S])*?\}\s*,\s*["']title["']\s*\)\s*;?\s*\})|(?![\s\S]*["']pause\.options["'][\s\S]*["']pause\.options["']))/, why: 'showTitle() passes the look "title" and has the pause.options button too (staging still lacks that button), and no third screen has it: only openPause() has the button with "dim", so prime() can never take the title for the pause menu and destroy it' },

  // --- Chat history
  { script: [CHAT, OPTIONS, ZOOM], file: 'index.html', test: 'id="chatbox"', why: 'history attaches to the #chatbox input; Better Options reads #chatbox.hidden to tell whether chat is open (F2 is ignored, the benchmark refuses to start, our menu never opens over chat)' },
  { script: [CHAT, OPTIONS], file: 'index.html', test: /<input\b(?=[^>]*\sid=["']chatbox["'])(?=[^>]*\shidden[\s=/>])[^>]*>/, why: '#chatbox is an <input> (value, setSelectionRange), hidden while chat is closed: a visible #chatbox means chat is open (history, and Better Options\' chatOpen())' },
  { script: [CHAT, OPTIONS, ZOOM], file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*[\w$.]+\(\s*["']#chatbox["']\s*\))(?=[\s\S]*\.chatOpen\s*=\s*true\s*;[^}]*?\b\1\.hidden\s*=\s*false)(?=[\s\S]*\.chatOpen\s*=\s*false\s*;[^}]*?\b\1\.hidden\s*=\s*true)/, why: 'chat opens by setting S.chatOpen = true and then #chatbox.hidden = false, and closes with chatOpen = false and, after resetting its IME and opacity state, hidden = true: chatOpen() reads #chatbox.hidden' },
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
  { script: SHADERS, name: 'layers >= 256 get their own class: by name, in the class row the GPU reads, and through tcLayer in the terrain and shadow vertex shaders',
    run: async () => {
      const T = window.Twitterentary, W = window.__tcwatch;
      if (!T || typeof T.debug !== 'function') return 'window.Twitterentary.debug missing';
      if (!W) return 'window.__tcwatch missing: this check reads the sources the smoke recorder kept';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      await __tcwait(() => T.state.frame > 2);
      const d = T.debug(), names = d.layerNames, cls = d.layerClasses, bad = [];
      if (!Array.isArray(names) || !Array.isArray(cls)) return `debug().layerNames/layerClasses are ${JSON.stringify([typeof names, typeof cls])}, expected arrays (one entry per atlas layer)`;
      if (cls.length !== d.layers) bad.push(`debug().layerClasses has ${cls.length} entries for ${d.layers} atlas layers`);
      // The GLSL. A 9-bit game has "uint layer = aInfo.x | ..." in its terrain VS; staging is still on plain aInfo.x.
      const terrain = [...W.programs.values()].filter(p => p.linked && p.vs && /aPos\s*&\s*uvec3/.test(p.vs.source));
      const game9 = terrain.some(p => /\buint\s+\w+\s*=\s*aInfo\.x\s*\|/.test(p.vs.source));
      if (d.layerBits !== (game9 ? 9 : 8)) bad.push(`debug().layerBits is ${JSON.stringify(d.layerBits)}, but the game's VS has ${game9 ? 'the 9-bit' : 'the 8-bit'} layer`);
      const lookups = terrain.filter(p => p.vs.source.includes('uClsTex'));
      const decl = game9 ? 'int tcLayer = int(aInfo.x | (((aPos.z >> 9u) & 1u) << 8u));' : 'int tcLayer = int(aInfo.x);';
      const without = lookups.filter(p => !p.vs.source.includes(decl)).length;
      if (lookups.length < 9) bad.push(`${lookups.length} terrain programs look up uClsTex, expected at least 9 (7 terrain + 2 cutout shadow)`);
      if (without) bad.push(`${without} of ${lookups.length} programs that read uClsTex lack "${decl}" (the shadow programs read the detection in initGL: if only those lack it, the game no longer links a terrain program first)`);
      const raw = lookups.filter(p => /texelFetch\(\s*uClsTex\s*,\s*ivec2\(\s*int\(\s*aInfo\.x/.test(p.vs.source)).length;
      if (raw) bad.push(`${raw} programs still look up the class with int(aInfo.x), the 8-bit layer`);
      const shadow = lookups.filter(p => p.vs.source.includes('uLVP'));
      if (shadow.length < 2) bad.push(`${shadow.length} cutout shadow programs, expected 2`);
      const atlas = shadow.filter(p => !/vUV\s*=\s*vec3\([^;]*float\(\s*tcLayer\s*\)\s*\)\s*;/.test(p.vs.source)).length;
      if (atlas) bad.push(`${atlas} cutout shadow VS don't take vUV.z from tcLayer: they would sample the wrong atlas layer`);
      // The class row the VS really reads, read back from unit 7 (between frames; the framebuffer binding is put back).
      const gl = document.getElementById('gl').getContext('webgl2');
      const row = () => {
        const unit = gl.getParameter(gl.ACTIVE_TEXTURE);
        gl.activeTexture(gl.TEXTURE7);
        const tex = gl.getParameter(gl.TEXTURE_BINDING_2D);
        gl.activeTexture(unit);
        if (!tex) return null;
        const fb0 = gl.getParameter(gl.FRAMEBUFFER_BINDING), fb = gl.createFramebuffer(), px = new Uint8Array(cls.length * 4);
        try {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
          gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
          if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
          gl.readPixels(0, 0, cls.length, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        } finally {
          gl.bindFramebuffer(gl.FRAMEBUFFER, fb0);
          gl.deleteFramebuffer(fb);
        }
        return px;
      };
      const off = px => cls.map((c, l) => (px[l * 4] === c ? -1 : l)).filter(l => l >= 0);
      const matches = () => { const px = row(); return !!px && !off(px).length; };
      if (!(await __tcwait(matches, 10000))) {
        const px = row(), wrong = px ? off(px) : [];
        bad.push(px ? `the class row on unit 7 differs from debug().layerClasses at ${wrong.length} layers, first ${wrong.slice(0, 6).map(l => `${l} ${JSON.stringify(names[l])}: ${px[l * 4]} vs ${cls[l]}`).join(', ')}` : 'could not read the class row back from unit 7');
      }
      if (game9) {
        // Names, not numbers: if the game reorders its atlas this keeps asking the right question. 4 is emissive.
        const want = { spark_torch: 4, spark_lamp_on: 4, spark_torch_off: 0, spark_lamp: 0 };
        for (const [n, c] of Object.entries(want)) {
          const l = names.indexOf(n);
          if (l < 256) bad.push(`can't verify: "${n}" is on layer ${l}, not on a layer >= 256`);
          else if (cls[l] !== c) bad.push(`"${n}" (layer ${l}) has class ${cls[l]}, expected ${c}`);
        }
        const rails = names.map((n, l) => [n, l]).filter(([n, l]) => l >= 256 && /rail/.test(n));
        if (!rails.length) bad.push('can\'t verify: no rail on a layer >= 256');
        for (const [n, l] of rails) if (cls[l] !== 0) bad.push(`"${n}" (layer ${l}) has class ${cls[l]}, expected 0`);
      }
      return !bad.length || bad.slice(0, 8).join('; ');
    } },
  { script: SHADERS, name: 'a terrain FS for a paged atlas (the game\'s own pagedFS() rewrite) passes through unpatched except for the flat strip, and compiles; the same FS on one page is patched',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.debug !== 'function') return 'window.Twitterentary.debug missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      let P;
      try { P = await import('/js/texpages.js'); } catch (e) { return true; } // a build without texture pages (staging): nothing to fall back from
      if (typeof P.pagedFS !== 'function') return 'js/texpages.js no longer exports pagedFS';
      const gl = document.getElementById('gl').getContext('webgl2');
      // Only the lines our recogniser and patchTerrainFS() look for. Never linked, so the smoke recorder doesn't see it.
      const FS = ['#version 300 es', 'precision highp float;', 'precision highp sampler2DArray;', 'uniform sampler2DArray uTex;', 'uniform vec3 uFog;',
        'in vec3 vUV;', 'flat in float vGlass;', 'in float vShade;', 'in float vDist;', 'in vec2 vLight;', 'out vec4 o;', 'void main() {',
        '  vec4 c = texture(uTex, vUV);', '  float f = clamp(vDist / 100.0, 0.0, 1.0);', '  o = vec4(mix(c.rgb * vShade, uFog, f), c.a);', '}'].join('\n');
      const paged = P.pagedFS(FS, 'uTex', { pages: 2, size: 256 });
      if (paged === FS || !/uTex_t\(\s*vUV\s*\)/.test(paged)) return `pagedFS() no longer rewrites texture(uTex, ...) to uTex_t(...): ${JSON.stringify(paged.slice(0, 200))}`;
      const through = src => {
        const s = gl.createShader(gl.FRAGMENT_SHADER);
        try {
          gl.shaderSource(s, src);
          gl.compileShader(s);
          return { src: gl.getShaderSource(s), ok: gl.getShaderParameter(s, gl.COMPILE_STATUS), log: gl.getShaderInfoLog(s) };
        } finally { gl.deleteShader(s); }
      };
      const err0 = T.debug().errors, plain = through(FS), pg = through(paged), bad = [];
      const stripped = paged.replace(/\bflat\s+in\s+float\s+vGlass\s*;/, 'in float vGlass;');
      if (!plain.src.includes('dFdx(vRel)')) return `control failed: the one-page FS was not patched, so this check proves nothing (compiled ${plain.ok}: ${String(plain.log).slice(0, 160)})`;
      if (plain.src.includes('flat ')) bad.push('the patched one-page FS kept its flat varying');
      if (pg.src !== stripped) bad.push(`the paged FS should reach the GPU as it came, with only flat removed: ${pg.src.includes('dFdx(vRel)') ? 'it was patched' : `it changed: ${JSON.stringify(pg.src.slice(0, 160))}`}`);
      if (!pg.ok) bad.push(`the paged FS did not compile: ${String(pg.log).slice(0, 200)}`);
      const err1 = T.debug().errors;
      if (err1 !== err0) bad.push(`debug().errors went from ${err0} to ${err1}`);
      return !bad.length || bad.join('; ');
    } },
  { script: SHADERS, name: 'the stained-glass depth program (our terrain VS, the game FS) reads uFx = 0 through getUniform, while a patched terrain program reads 1',
    run: async () => {
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const T = window.Twitterentary;
      if (!T || !T.cfg) return 'window.Twitterentary.cfg missing';
      if (!T.cfg.enabled) return `can't verify: shaders are off (cfg.enabled ${T.cfg.enabled}), so no program would read 1`;
      const { Gfx } = await import('/js/gfx.js');
      if (!Gfx || typeof Gfx.prototype.draw !== 'function') return 'js/gfx.js has no Gfx.prototype.draw';
      // The instance isn't exposed, so catch it on the next frame. The wrapper can't throw on its own account.
      const draw = Gfx.prototype.draw;
      let gfx = null;
      Gfx.prototype.draw = function (v) { gfx = this; return draw.call(this, v); };
      try { await __tcwait(() => gfx, 10000); } finally { Gfx.prototype.draw = draw; }
      if (!gfx) return 'Gfx.prototype.draw did not run within 10 s';
      const gl = gfx.gl, stained = gfx.pStainedDepth, plain = gfx.pTerrain && gfx.pTerrain[0];
      if (!gl || !stained || !stained.p || !plain || !plain.p) return 'gfx.gl, gfx.pStainedDepth.p or gfx.pTerrain[0].p missing';
      const read = p => { const loc = gl.getUniformLocation(p, 'uFx'); return loc ? gl.getUniform(p, loc) : null; };
      // Each program is used through the hook first: the title world may have no stained glass in view, and a program
      // never used reads 0 whatever the hook would do with it.
      const prev = gl.getParameter(gl.CURRENT_PROGRAM);
      let fxPlain, fxStained;
      try {
        gl.useProgram(plain.p);
        fxPlain = read(plain.p);
        gl.useProgram(stained.p);
        fxStained = read(stained.p);
      } finally {
        gl.useProgram(prev);
      }
      if (fxPlain !== 1) return `can't verify: a patched terrain program reads uFx ${JSON.stringify(fxPlain)}, expected 1`;
      if (fxStained === null) return 'the stained-glass depth program has no active uFx: its VS is no longer our terrain VS';
      return fxStained === 0 || `the stained-glass depth program reads uFx ${JSON.stringify(fxStained)}: it would wave with no lighting to match`;
    } },
  // Shaders 1.5.2: "campfire" in RE_EMIT also matched the unlit log. Names missing from the atlas are skipped, but on a build
  // with js/keys.js at least one must be there, or this would pass with no check at all after a rename. Staging has no campfire
  // in its atlas, so it passes on nothing until it gets them.
  { script: SHADERS, name: 'the unlit campfire_log is class 0, and campfire_log_lit and campfire_fire are emissive (class 4)',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.debug !== 'function') return 'window.Twitterentary.debug missing';
      const ready = () => { const d = T.debug(); return Array.isArray(d.layerNames) && Array.isArray(d.layerClasses) && d.layerClasses.length > 0; };
      if (!(await __tcwait(ready, 30000))) return 'debug().layerNames/layerClasses never filled in within 30 s';
      const d = T.debug(), bad = [];
      let found = 0;
      for (const [name, want] of [['campfire_log', 0], ['campfire_log_lit', 4], ['campfire_fire', 4]]) {
        const l = d.layerNames.indexOf(name);
        if (l >= 0) found++;
        if (l >= 0 && d.layerClasses[l] !== want) bad.push(`${name} (layer ${l}) is class ${d.layerClasses[l]}, expected ${want}`);
      }
      if (!found && (await import('/js/keys.js').then(() => true, () => false))) bad.push(`none of campfire_log, campfire_log_lit and campfire_fire is in the atlas (${d.layerNames.filter(n => /camp|fire/.test(n)).join(', ') || 'nothing like them'}): were they renamed?`);
      return !bad.length || bad.join('; ');
    } },
  { script: SHADERS, name: 'a flat/smooth vGlass pair that fails to link falls back: both stages end on their pristine source and the program links',
    run: () => {
      const gl = document.getElementById('gl') && document.getElementById('gl').getContext('webgl2');
      if (!gl) return 'no WebGL2 context on #gl';
      const VS = ['#version 300 es', 'flat out float vGlass;', 'void main() { vGlass = 1.0; gl_Position = vec4(0.0, 0.0, 0.0, 1.0); }'].join(String.fromCharCode(10));
      // "highp" keeps the real declaration out of the strip's reach, so the stages disagree once the VS is stripped. The
      // comment does match, which counts this stage as patched too, so both stages have a pristine source to go back to.
      const FS = ['#version 300 es', 'precision highp float;', '// flat in float vGlass;', 'flat in highp float vGlass;', 'out vec4 o;', 'void main() { o = vec4(vGlass); }'].join(String.fromCharCode(10));
      const vs = gl.createShader(gl.VERTEX_SHADER), fs = gl.createShader(gl.FRAGMENT_SHADER), p = gl.createProgram();
      const err = console.error, logged = [], bad = [];
      try {
        gl.shaderSource(vs, VS);
        gl.shaderSource(fs, FS);
        if (gl.getShaderSource(vs) === VS) return 'the shaderSource hook did not strip "flat out float vGlass;" from the VS';
        if (gl.getShaderSource(fs) === FS) return 'the shaderSource hook did not touch the FS fixture, so its stage is not patched';
        gl.compileShader(vs);
        gl.compileShader(fs);
        if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS) || !gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return `the fixture did not compile: ${gl.getShaderInfoLog(vs)} ${gl.getShaderInfoLog(fs)}`;
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        // The expected console.error, held back from the smoke's console watch for this one synchronous call.
        console.error = (...a) => { logged.push(a.map(String).join(' ')); };
        gl.linkProgram(p);
        console.error = err;
        if (!logged.some(l => l.includes('failed to link'))) bad.push(`can't verify: the first link did not fail (logged ${JSON.stringify(logged)}), so the fallback never ran`);
        if (gl.getShaderSource(vs) !== VS) bad.push(`the VS did not go back to its pristine source: ${JSON.stringify(gl.getShaderSource(vs))}`);
        if (gl.getShaderSource(fs) !== FS) bad.push(`the FS did not go back to its pristine source: ${JSON.stringify(gl.getShaderSource(fs))}`);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) bad.push(`the program did not link after the fallback: ${gl.getProgramInfoLog(p)}`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        console.error = err;
        gl.deleteProgram(p);
        gl.deleteShader(vs);
        gl.deleteShader(fs);
      }
      return !bad.length || bad.join('; ');
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
  // --- Shaders 1.5.1: perf, stress and bench. Settings changes here are made in memory (T.cfg.x = v, never saved) and
  // put back in `finally`, except bench(), which must restore them itself.
  { script: SHADERS, name: 'renderScale, renderScaleMin and sharpen are gone (schema, defaults, cfg, presets, the Performance section); stale saved values do nothing and a saved 70% profile still reads its preset, not Custom',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || !Array.isArray(T.schema) || !T.defaults || !T.presets || ['currentPreset', 'applyPreset', 'set', 'reset', 'bench'].some(k => typeof T[k] !== 'function')) return 'window.Twitterentary.schema/defaults/presets/currentPreset/applyPreset/set/reset/bench missing';
      const GONE = ['renderScale', 'renderScaleMin', 'sharpen'], PFX = 'tc.shader.', bad = [];
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return o; };
      const cfgNow = () => JSON.stringify(Object.keys(T.cfg).sort().map(k => [k, T.cfg[k]]));
      for (const k of GONE) {
        if (T.schema.some(f => f && f.key === k)) bad.push(`${k} still has a SCHEMA row`);
        if (k in T.defaults) bad.push(`${k} still has a default`);
        if (k in T.cfg) bad.push(`${k} is still in cfg`);
        for (const g of ['quality', 'look']) for (const p of T.presets[g] || []) if (p && p.values && k in p.values) bad.push(`${g}.${p.id} still sets ${k}`);
      }
      if (T.schema.some(f => f && f.section === 'Performance')) bad.push('the Performance section still has rows');
      if (bad.length) return bad.join('; ');
      const ls0 = saved(), cfg0 = Object.assign({}, T.cfg), q0 = T.currentPreset('quality'), l0 = T.currentPreset('look');
      let out = true, left = [];
      try {
        // What a 1.5.0 player's profile holds after choosing a fixed 70%. All synchronous up to the bench, which restores.
        localStorage.setItem(PFX + 'renderScale', '0.7');
        localStorage.setItem(PFX + 'renderScaleMin', '0.5');
        localStorage.setItem(PFX + 'sharpen', '1');
        const c0 = cfgNow(), r = T.set('renderScale', 0.5);
        if (r !== false) out = `set('renderScale', 0.5) returned ${JSON.stringify(r)}, expected false (no such setting)`;
        else if (localStorage.getItem(PFX + 'renderScale') !== '0.7') out = `set('renderScale', 0.5) touched the stale key: ${localStorage.getItem(PFX + 'renderScale')}`;
        else if (cfgNow() !== c0) out = 'set(\'renderScale\', 0.5) changed cfg';
        else if (T.currentPreset('quality') !== q0 || T.currentPreset('look') !== l0) out = `with stale render-scale keys saved the pickers read ${T.currentPreset('quality')} / ${T.currentPreset('look')}, expected ${q0} / ${l0}`;
        else {
          T.applyPreset('quality', 'high');
          if (T.currentPreset('quality') !== 'high') out = `a saved 70% profile on High reads ${JSON.stringify(T.currentPreset('quality'))}, expected "high", not Custom`;
        }
        if (out === true) {
          // a row naming a removed setting is an n/a row, not a measurement of nothing (it never waits for frames)
          const res = await T.bench({ seconds: 0.2, warmup: 0, scenarios: ['low+renderScale=0.7'] }), row = res && res.rows && res.rows[0];
          if (!row || row.fps !== null || !/unknown setting/.test(row.note || '')) out = `the bench scenario low+renderScale=0.7 gave ${JSON.stringify(row)}, expected an n/a row saying "unknown setting"`;
        }
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        try {
          T.reset();
          left = Object.keys(saved());
          for (const k of Object.keys(cfg0)) if (T.cfg[k] !== cfg0[k]) T.cfg[k] = cfg0[k];
          for (const k of left) localStorage.removeItem(k);
          for (const [k, v] of Object.entries(ls0)) localStorage.setItem(k, v);
        } catch (e) {}
      }
      if (out !== true) return out;
      return !left.length || `reset() left ${left.join(', ')} in localStorage`;
    } },
  { script: SHADERS, name: 'Twitterentary.perf has the 1.5.1 shape (scale is always 1), is updated in place, and publishes about 4 times a second',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || !T.perf || typeof T.perf !== 'object') return 'window.Twitterentary.perf missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const P = T.perf, num = v => typeof v === 'number' && Number.isFinite(v);
      const shape = () => {
        const bad = [];
        for (const k of ['fps', 'ms', 'cpuMs', 'scale', 'shadowRefreshPerMin']) if (!num(P[k])) bad.push(`${k} ${JSON.stringify(P[k])} is not a number`);
        // tools/bench.mjs needs a numeric perf.scale for its shadow-redraw tail analysis, and an older Better Options shows it
        if (P.scale !== 1) bad.push(`scale is ${JSON.stringify(P.scale)}, expected exactly 1 (there is no render scale any more)`);
        if (!(P.gpuMs === null || num(P.gpuMs))) bad.push(`gpuMs ${JSON.stringify(P.gpuMs)} is neither a number nor null`);
        for (const k of ['cpuBound', 'timer']) if (typeof P[k] !== 'boolean') bad.push(`${k} ${JSON.stringify(P[k])} is not a boolean`);
        if (P.timer === false && P.gpuMs !== null) bad.push(`gpuMs is ${P.gpuMs} although timer is false (no GPU timer query)`);
        return bad;
      };
      if (!(await __tcwait(() => num(P.fps) && P.fps > 0 && num(P.ms) && P.ms > 0, 15000))) return `perf.fps/ms never became positive numbers: ${JSON.stringify(P)}`;
      let bad = shape();
      if (bad.length) return bad.join('; ');
      // at least 3 s and 8 frames (software GL can be very slow). The published means (fps, ms, cpuMs) are rewritten
      // together at most once per 250 ms, at a frame: so they change at least every other frame (on a 1-2 FPS runner every
      // frame publishes, and cpuMs still moves when no interval is under 1 s), and never more than ~4 times a second.
      // (perf.frame and the GPU ring change every frame, and fpsGame once a second, so they are not compared.) Up to 30 s
      // for 8 frames: a slow CI runner (SwiftShader at ~1 FPS) still gets there, inside the harness's 90 s per check.
      const t0 = performance.now(), f0 = T.state.frame;
      const pub = () => `${P.fps}|${P.ms}|${P.cpuMs}`;
      let changes = 0, last = pub();
      while (performance.now() - t0 < 3000 || (T.state.frame - f0 < 8 && performance.now() - t0 < 30000)) {
        await new Promise(r => setTimeout(r, 100));
        if (T.perf !== P) return 'Twitterentary.perf was replaced by a new object: it must be mutated in place (the overlay and bench keep a reference)';
        const s = pub();
        if (s !== last) { changes++; last = s; }
      }
      bad = shape();
      if (bad.length) return bad.join('; ');
      const frames = T.state.frame - f0, secs = ((performance.now() - t0) / 1000).toFixed(1);
      const brief = () => JSON.stringify(Object.fromEntries(Object.entries(P).filter(([, v]) => !ArrayBuffer.isView(v))));
      if (frames < 4) return `can't verify: only ${frames} frames in ${secs} s (perf ${brief()})`;
      if (changes < Math.min(3, Math.floor(frames / 2))) return `perf.fps/ms/cpuMs changed only ${changes} times in ${secs} s / ${frames} frames (they should update about 4 times a second): ${brief()}`;
      const most = Math.floor((performance.now() - t0) / 250) + 1;
      return changes <= most || `perf.fps/ms/cpuMs changed ${changes} times in ${secs} s / ${frames} frames, more than once per 250 ms (at most ${most}): they should be published about 4 times a second, not every frame: ${brief()}`;
    } },
  { script: SHADERS, name: 'perf.fpsGame is the game\'s F3 number: an integer frame count per window over 1000 ms, updated once a second, with shaders on or off',
    run: async () => {
      const T = window.Twitterentary, P = T && T.perf;
      if (!P) return 'window.Twitterentary.perf missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const ok = () => Number.isInteger(P.fpsGame) && P.fpsGame > 0;
      if (!(await __tcwait(ok, 15000))) return `perf.fpsGame never became a positive integer: ${JSON.stringify(P.fpsGame)} (perf.fps ${P.fps})`;
      // Our own copy of the game's counter, as main.js frameBody() has it, for three windows.
      let gf = 0, gT = 0, stop = false, changes = 0, last = P.fpsGame;
      const mine = [], theirs = [];
      const tick = ts => {
        if (stop) return;
        gf++;
        if (ts - gT > 1000) { if (gT) { mine.push(gf); theirs.push(P.fpsGame); } gf = 0; gT = ts; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const t0 = performance.now();
      try {
        while (mine.length < 3 && performance.now() - t0 < 30000) {
          await sleep(50);
          if (P.fpsGame !== last) {
            changes++; last = P.fpsGame;
            if (!Number.isInteger(last)) return `perf.fpsGame became ${JSON.stringify(last)}: it counts frames, so it is an integer (perf.fps is the mean)`;
          }
        }
      } finally { stop = true; }
      const secs = (performance.now() - t0) / 1000;
      if (mine.length < 3) return `can't verify: ${mine.length} one-second windows in ${secs.toFixed(1)} s`;
      if (changes > Math.ceil(secs) + 1) return `perf.fpsGame changed ${changes} times in ${secs.toFixed(1)} s, more than once a second: the game's number changes only when its window closes`;
      // Acceptance is 1 FPS apart at a steady rate, which only a real GPU has. Software GL frames are uneven and the two
      // windows are out of phase, so here the median gap may be 2 frames or a fifth: enough to catch a different window.
      const gaps = mine.map((m, i) => Math.abs(m - theirs[i])).sort((a, b) => a - b), most = Math.max(2, Math.ceil(Math.max(...mine) / 5));
      if (gaps[1] > most) return `perf.fpsGame read ${theirs.join(', ')} while the game's formula gave ${mine.join(', ')}: more than ${most} apart`;
      // F2 must still count with the shaders off (K), when the game's own number certainly does
      const was = T.cfg.enabled;
      try {
        T.cfg.enabled = false; // in memory only
        P.fpsGame = 0;
        return (await __tcwait(ok, 15000)) || `with shaders off perf.fpsGame stayed ${JSON.stringify(P.fpsGame)} for 15 s`;
      } finally {
        T.cfg.enabled = was;
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
        // Each row must be measured on its own frames. A render scale can no longer tell rows apart, so the first row gets
        // something the second must not show: one stall (its worst interval) and forced shadow redraws, against `off`, which
        // redraws nothing. A recorder field not reset between scenarios carries them over: a stale dt list keeps the stall in
        // row 2's low1, a stale dtSum lifts its mean above its worst interval, a stale ref0 gives it redraws, a stale scale
        // sum reads above 1. On a slow runner bench() itself extends each window until 3 frames (at most 5 s more), so rows
        // have numbers down to ~0.2 FPS.
        const SC = ['medium-stress', 'off'], STALL = 1500, SECONDS = 4;
        const p1 = T.bench({ seconds: SECONDS, warmup: 0.2, scenarios: SC });
        const running = T.bench.running;
        // A rAF callback that blocks, just after the first window opens (warm-up + the 0.5 s settle), so the interval
        // that holds it is measured even at ~1 FPS. BREC_MAX_MS drops intervals of 5 s and over.
        setTimeout(() => requestAnimationFrame(() => { const t = performance.now(); while (performance.now() - t < STALL); }), 800);
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
            for (const k of ['p95', 'low1', 'cpuMs', 'gpuMs']) if (!(r[k] === null || num(r[k]))) bad.push(`row ${r.name}: ${k} ${JSON.stringify(r[k])} is neither a number nor null`);
            if (r.scale !== 1) bad.push(`row ${r.name}: scale ${JSON.stringify(r.scale)}, expected exactly 1 (more means the scale sum was not reset between scenarios)`);
            if (num(r.ms) && num(r.low1) && r.ms > 1000 / r.low1 + 0.01) bad.push(`row ${r.name}: mean ${r.ms} ms is above its worst interval ${(1000 / r.low1).toFixed(3)} ms (low1 ${r.low1}): the mean holds frames of another row`);
          }
          if ('aborted' in res) bad.push(`a bench that ran to the end has aborted: ${JSON.stringify(res.aborted)} (only an aborted one should)`);
          const [a, b] = rows, worst = Math.max(1, Math.ceil(SECONDS * 1000 / a.ms / 100)); // low1 is the mean of the worst 1% of a row's intervals
          if (!(a.low1 <= worst * 1000 / STALL * 1.02)) bad.push(`can't verify: the ${STALL} ms stall is not in row ${a.name}: low1 ${a.low1} at ${a.ms} ms a frame`);
          else if (!(b.low1 > a.low1 * 1.2)) bad.push(`row ${b.name}: low1 ${b.low1} against ${a.low1} in row ${a.name}: its worst interval looks like the stall from the row before, so the intervals were not reset`);
          if (b.refreshPerMin !== 0) bad.push(`row ${b.name}: refreshPerMin ${JSON.stringify(b.refreshPerMin)}, expected 0 with shaders off (row ${a.name} read ${a.refreshPerMin})`);
        }
        if (T.debug().stress.mode !== 'off') bad.push(`debug().stress is ${JSON.stringify(T.debug().stress)} after the bench, expected mode "off"`);
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
      const PFX = 'tc.shader.';
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
        // Abort during the second scenario, which differs visibly (shaders on, Low's shadows off, the -moving
        // drift), so abort() must undo in-memory CFG and stress() too. 3 s windows leave time to land inside it.
        const SC = ['off', 'low-moving'];
        const tr = track(T.bench({ seconds: 3, warmup: 0.2, scenarios: SC }));
        const inSecond = () => T.cfg.enabled === true && T.cfg.shadows === false && T.debug().stress.moveSpeed > 0;
        const t0 = performance.now();
        while (!tr.done && !inSecond() && performance.now() - t0 < 40000) await sleep(50);
        if (tr.done || !inSecond()) bad.push(`can't verify: the second scenario never started (bench ${tr.done ? 'already settled' : 'still running'}, cfg.enabled ${T.cfg.enabled}, shadows ${T.cfg.shadows}, stress ${JSON.stringify(T.debug().stress)})`);
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
  { script: SHADERS, name: 'debug() counts remeshes (a non-negative integer that never goes down) and has no post or governor data, and no VAO is left bound after a frame (remeshes run between frames under the VAO the last frame left)',
    run: async () => {
      const T = window.Twitterentary;
      if (!T || typeof T.debug !== 'function') return 'window.Twitterentary.debug missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const c = document.getElementById('gl'), gl = c && c.getContext('webgl2');
      if (!gl) return 'no webgl2 context on #gl';
      const bad = [];
      const d0 = T.debug(), r0 = d0.remeshes;
      if (!Number.isInteger(r0) || r0 < 0) return `debug().remeshes is ${JSON.stringify(r0)}, expected a non-negative integer`;
      for (const k of ['post', 'governor']) if (k in d0) bad.push(`debug().${k} is still there: the render-scale code it reports is gone`);
      // A rAF callback queued now runs after the game's frame, before the next frame's updateChunks() remeshes. The
      // bindBuffer hook pairs a VBO with the VAO bound at its first bind, so a VAO left bound here would be the one a
      // newly created VBO gets paired with, if the game ever bound it first.
      const afterFrame = () => new Promise(res => requestAnimationFrame(() => { try { res(gl.getParameter(gl.VERTEX_ARRAY_BINDING)); } catch (e) { res(e); } }));
      await afterFrame();
      const v = [await afterFrame(), await afterFrame()];
      if (v.some(x => x instanceof Error)) bad.push(`reading VERTEX_ARRAY_BINDING threw: ${v.find(x => x instanceof Error).message}`);
      else if (v.some(x => x !== null)) bad.push('a VAO is still bound after a frame');
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
          // 1.5.1: there is no render scale, so no Scale line
          if (el().querySelector('[data-l="scale"]')) bad.push('the overlay still has a Scale line');
          if (!/^Shadows (\d+\/min|off)$/.test(line('shadow') || '')) bad.push(`shadow line "${line('shadow')}"`);
          // The FPS line shows perf.fpsGame when it is finite and > 0, else perf.fps. Written until the 250 ms poll shows it,
          // because the shader script rewrites the field each time its one-second window closes.
          const P = T.perf, shown = () => parseFloat(line('fps') || '');
          const hold = async (v, test) => { const t0 = performance.now(); while (performance.now() - t0 < 4000) { P.fpsGame = v; await new Promise(r => setTimeout(r, 50)); if (test()) return true; } return false; };
          if (!(await hold(98765, () => shown() === 98765))) bad.push(`fps line "${line('fps')}" never showed perf.fpsGame = 98765: F2 would not match F3`);
          else if (!(await hold(0, () => shown() !== 98765 && Math.abs(shown() - P.fps) <= Math.max(1, P.fps / 5)))) bad.push(`with perf.fpsGame = 0 the fps line "${line('fps')}" did not fall back to perf.fps ${P.fps}`);
          if (bad.length) out = `the overlay text does not match its format: ${bad.join('; ')}`;
        } else if (!/No performance data/.test(line('fps') || '')) out = `without Twitterentary.perf the overlay should say "No performance data", it says "${line('fps')}"`;
        press();
        if (out === true && !(await __tcwait(() => !shown() && bus.get('perf.overlay') === false, 2000))) out = `a second F2 did not hide #tc-perf (perf.overlay ${JSON.stringify(bus.get('perf.overlay'))})`;
      } finally {
        if (bus.get('perf.overlay')) bus.set('perf.overlay', false);
      }
      return out;
    } },
  // --- Better Options 1.3: "Copy all settings". Secrets are planted by name, never read: this check only writes and
  // removes them, in one synchronous block, so no game code can run while a fake value exists. The names are built by
  // concatenation so they appear nowhere in this repo as text.
  { script: OPTIONS, name: 'bus.settingsText() is the agreed JSON and holds none of the forbidden keys (planted fake values), nothing else from localStorage, and no stale zoomed FOV',
    run: async () => {
      const bus = window.__tcOptions, T = window.Twitterentary, Z = window.__tcZoom;
      if (!bus || typeof bus.settingsText !== 'function') return 'window.__tcOptions.settingsText missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const FAKE = 'tcfake' + Math.random().toString(36).slice(2, 10), PFX = 'tc.shader.', OPT = 'tc.options';
      const has = k => { for (let i = 0; i < localStorage.length; i++) if (localStorage.key(i) === k) return true; return false; };
      const SECRET = ['mc.' + 'tok', 'mc.' + 'adm' + 'in', 'mc.' + 'key.' + 'tcfake' + 'room'];
      const IDENTITY = ['sid', 'nonce', 'bridged', 'wardrobe', 'cos', 'hotbar', 'recent'].map(k => 'mc.' + k);
      const OTHER = ['mc.tcplanted', 'tcplanted', 'tc.chat.tcplanted']; // nothing iterates mc.* or localStorage
      // A secret the game really holds stays untouched and unread: only its absence from the text can be judged.
      const planted = SECRET.filter(k => !has(k));
      const keep = {};
      for (const k of [...IDENTITY, ...OTHER, 'mc.fov', OPT]) keep[k] = localStorage.getItem(k);
      const cfg = bus.config && typeof bus.config === 'object' ? bus.config : null, EXTRA = 'tcplanted.identity';
      let text, staleFov, threw = null;
      try {
        for (const k of [...planted, ...IDENTITY, ...OTHER]) localStorage.setItem(k, FAKE);
        localStorage.setItem(PFX + 'tcprobe', '1.5');
        // a key some other mod saved in tc.options: only the allow-listed names may come through
        if (cfg) cfg[EXTRA] = FAKE;
        let o = {};
        try { o = JSON.parse(keep[OPT] || '{}') || {}; } catch (e) {}
        o[EXTRA] = FAKE;
        localStorage.setItem(OPT, JSON.stringify(o));
        text = bus.settingsText();
        localStorage.setItem('mc.fov', '17.5'); // a reload while zoomed could leave this: the game itself ignores it
        if (!(Z && Z.zooming)) staleFov = JSON.parse(bus.settingsText()).game.fov;
      } catch (e) {
        threw = e;
      } finally {
        for (const k of planted) localStorage.removeItem(k);
        localStorage.removeItem(PFX + 'tcprobe');
        if (cfg) delete cfg[EXTRA];
        for (const [k, v] of Object.entries(keep)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); }
      }
      const stillThere = planted.filter(has);
      if (stillThere.length) return `the planted keys were not cleaned up: ${stillThere.length}`;
      if (threw) return `settingsText() threw: ${threw.message}`;
      if (typeof text !== 'string') return `settingsText() returned ${text && typeof text.then === 'function' ? 'a Promise: it must be synchronous' : typeof text}`;
      const bad = [];
      if (text.includes(FAKE)) bad.push('a planted fake value is in the output');
      const named = SECRET.filter(k => text.includes(k)).length, others = [...IDENTITY, ...OTHER].filter(k => text.includes(k));
      if (named) bad.push(`${named} secret key name(s) are in the output`);
      if (others.length) bad.push(`these key names are in the output: ${others.join(', ')}`);
      if (text.includes(EXTRA)) bad.push('a key outside the tc.options allow-list came through');
      let d;
      try { d = JSON.parse(text); } catch (e) { return `settingsText() is not JSON: ${e.message}`; }
      if (!text.includes('\n')) bad.push('settingsText() is not pretty-printed');
      const keysAre = (o, want, what) => { const got = o && typeof o === 'object' ? Object.keys(o).sort().join() : String(o); if (got !== [...want].sort().join()) bad.push(`${what} has keys ${got}, expected ${[...want].sort().join()}`); };
      keysAre(d, ['tweetcraftSettings', 'scripts', 'gpu', 'screen', 'game', 'shaders', 'options'], 'the output');
      if (d.tweetcraftSettings !== 1) bad.push(`tweetcraftSettings is ${JSON.stringify(d.tweetcraftSettings)}, expected 1`);
      keysAre(d.scripts, ['shaders', 'betterOptions', 'zoom', 'chatHistory'], 'scripts');
      keysAre(d.game, ['rd', 'fov', 'heldLight', 'fireflies', 'lang'], 'game');
      keysAre(d.screen, ['w', 'h', 'dpr'], 'screen');
      const S = d.scripts || {};
      if (S.shaders !== (T ? String(T.version) : null)) bad.push(`scripts.shaders is ${JSON.stringify(S.shaders)}, expected ${JSON.stringify(T ? String(T.version) : null)} (null when not loaded)`);
      if (S.zoom !== (Z ? String(Z.version) : null)) bad.push(`scripts.zoom is ${JSON.stringify(S.zoom)}, expected ${JSON.stringify(Z ? String(Z.version) : null)} (null when not loaded)`);
      if (typeof S.betterOptions !== 'string' || !S.betterOptions) bad.push(`scripts.betterOptions is ${JSON.stringify(S.betterOptions)}`);
      if ((S.chatHistory === null) !== !window.__mcChatHistory) bad.push(`scripts.chatHistory is ${JSON.stringify(S.chatHistory)} with __mcChatHistory ${window.__mcChatHistory ? 'loaded' : 'absent'}`);
      if (!(d.gpu === null || typeof d.gpu === 'string')) bad.push(`gpu is ${JSON.stringify(d.gpu)}`);
      const G = d.game || {};
      if (typeof G.rd !== 'number' || typeof G.fov !== 'number' || typeof G.heldLight !== 'boolean') bad.push(`game is ${JSON.stringify(G)}: rd and fov should be numbers, heldLight a boolean`);
      if (!(G.fov >= 30 && G.fov <= 110)) bad.push(`game.fov is ${JSON.stringify(G.fov)}, outside the game's 30-110`);
      if (!Z || !Z.zooming) { if (!(staleFov >= 30 && staleFov <= 110)) bad.push(`with mc.fov = 17.5 stored game.fov reads ${JSON.stringify(staleFov)}: a zoomed FOV must never be reported`); }
      if (!d.shaders || d.shaders.tcprobe !== 1.5) bad.push(`shaders.tcprobe is ${JSON.stringify(d.shaders && d.shaders.tcprobe)}: every tc.shader.* key should be there with its prefix stripped`);
      if (T) for (const f of T.schema) if (f && f.key && !(d.shaders && f.key in d.shaders)) { bad.push(`shaders has no ${f.key}`); break; }
      const ALLOW = ['ui.scale', 'hud.on', 'input.sens', 'keys.map', 'keys.mute', 'perf.overlay', 'perf.key', 'zoom.key', 'zoom.level', 'zoom.look'];
      const extra = Object.keys(d.options || {}).filter(k => !ALLOW.includes(k));
      if (!d.options || extra.length) bad.push(`options has keys outside the allow-list: ${extra.join(', ') || String(d.options)}`);
      return !bad.length || bad.slice(0, 8).join('; ');
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
  // The real title has the pause menu's Options button (not on staging yet). Before pauseUp() required "dim", prime() took
  // it for the pause menu, opened Options, and openPause() refused, which left the player on no screen at all.
  { script: OPTIONS, name: 'pauseUp() does not take the real title for the pause menu: its children survive prime() and the pause watcher',
    run: async () => {
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || !bus.fov || typeof bus.fov.prime !== 'function' || typeof bus.fov._forget !== 'function') return 'window.__tcOptions.fov.prime/_forget missing';
      const scr = document.getElementById('screen'), inner = scr && scr.querySelector('.inner');
      if (!inner) return '#screen .inner missing';
      if (!scr.classList.contains('title')) return `can't verify: the title is not up (#screen class "${scr.className}")`;
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // prime() refuses while typing
      const kids = [...inner.children], cls = scr.className, bad = [];
      if (!kids.length) return `can't verify: the title has no children`;
      const same = () => inner.children.length === kids.length && kids.every((k, i) => inner.children[i] === k) && scr.className === cls;
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      bus.fov._forget();
      const r = await bus.fov.prime();
      if (r !== false) bad.push(`prime() resolved ${JSON.stringify(r)}, expected false`);
      if (!same()) bad.push(`prime() replaced the title: ${inner.children.length} children (${kids.length} before), #screen class "${scr.className}"`);
      // prime() armed the pause watcher, which runs on any change to #screen .inner, so give it one
      const probe = document.createElement('div');
      inner.append(probe);
      await sleep(50);
      probe.remove();
      await sleep(50);
      if (!same()) bad.push(`the pause watcher replaced the title: ${inner.children.length} children (${kids.length} before), #screen class "${scr.className}"`);
      return !bad.length || bad.join('; ');
    } },
  { script: OPTIONS, name: 'bus.fov.setNow() writes at once when the input is cached and otherwise does nothing, and neither it nor prime() touches the title screen',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || !bus.fov || ['get', 'set', 'setNow', 'prime', '_forget'].some(k => typeof bus.fov[k] !== 'function')) return 'window.__tcOptions.fov.get/set/setNow/prime/_forget missing';
      const scr = document.getElementById('screen'), before = scr.className, prev = localStorage.getItem('mc.fov');
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const look = () => `${scr.className}|${[...document.querySelectorAll('#screen .inner button')].map(b => b.getAttribute('aria-label')).join('|')}`;
      const bad = [], look0 = look();
      let opened = false;
      try {
        bus.fov._forget();
        const r0 = bus.fov.setNow(83);
        if (r0 !== false) bad.push(`with no cached input setNow() returned ${JSON.stringify(r0)}, expected false`);
        if (localStorage.getItem('mc.fov') !== prev) bad.push(`with no cached input setNow() wrote mc.fov = ${localStorage.getItem('mc.fov')}`);
        if (look() !== look0) bad.push('setNow() changed the screen');
        const p = await bus.fov.prime();
        if (p !== false) bad.push(`prime() over the title resolved ${JSON.stringify(p)}, expected false: the title is never primed`);
        if (look() !== look0) bad.push(`prime() changed the title screen: ${look()}`);
        // our own menu fills the cache through the old path
        await bus.open();
        opened = true;
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await new Promise(r => setTimeout(r, 300));
        const look1 = look(), r1 = bus.fov.setNow(83), now = localStorage.getItem('mc.fov');
        if (r1 !== true) bad.push(`with a cached input setNow() returned ${JSON.stringify(r1)}, expected true`);
        if (now !== '83') bad.push(`setNow(83) left mc.fov = ${JSON.stringify(now)} in the same tick: the game's slider handler should have saved it`);
        if (bus.fov.get() !== 83) bad.push(`after setNow(83) bus.fov.get() is ${bus.fov.get()}`);
        if (look() !== look1) bad.push('setNow() rebuilt the screen');
        if ((await bus.fov.prime()) !== true) bad.push('prime() with a cached input should resolve true');
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        try { bus.fov.setNow(prev === null ? 70 : Number(prev)); } catch (e) {}
        if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev);
        if (opened) { if (before) M.back(); else M.closeMenu(); }
      }
      if (look() !== look0) bad.push(`the screen was not restored: ${look()}`);
      return !bad.length || bad.join('; ');
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
              // cells: name (shown capitalised, the raw name in its title), FPS, p95 ms
              const cells = [...rows[0].children].filter(x => x.tagName === 'SPAN'), first = cells[0];
              const raw = first ? (first.getAttribute('title') || '').split(':')[0].trim() : '';
              if (cells.length !== 3 || raw !== 'off' || first.textContent.trim().toLowerCase() !== 'off') issues.push(`the first .tc-bench-row has cells ${JSON.stringify(cells.map(x => x.textContent.trim()))} (title ${JSON.stringify(first && first.getAttribute('title'))}), expected 3 spans starting with the scenario "off"`);
            }
            if (!button('Copy results')) issues.push('Shaders tab: no "Copy results" button under the stored result');
            // Render scale is gone from the tab, and the benchmark sits right after the Quality section
            const subs = all('#screen .inner .tc-sub'), heads = subs.map(x => x.textContent.trim()), qi = heads.indexOf('Quality'), run = button('Run benchmark');
            if (heads.includes('Performance')) issues.push('Shaders tab: the Performance section is still there');
            if (qi < 0 || heads[qi + 1] !== 'Benchmark') issues.push(`Shaders tab: sections read ${JSON.stringify(heads)}, expected "Benchmark" right after "Quality"`);
            else if (run && !(subs[qi + 1].compareDocumentPosition(run) & Node.DOCUMENT_POSITION_FOLLOWING && (!subs[qi + 2] || run.compareDocumentPosition(subs[qi + 2]) & Node.DOCUMENT_POSITION_FOLLOWING))) issues.push('Shaders tab: "Run benchmark" is not inside the Benchmark section');
            const scaleRows = all('#screen .inner .tc-slider .tc-cap, #screen .inner button.mcb, #screen .inner .tc-bench-head').map(x => x.getAttribute('aria-label') || x.textContent.trim()).filter(t => /render scale|sharpen|\bscale\b/i.test(t));
            if (scaleRows.length) issues.push(`Shaders tab: render-scale rows are still shown: ${JSON.stringify(scaleRows)}`);
            if (typeof bus._benchText === 'function') {
              const t = String(bus._benchText());
              if (!/^\| Scenario \| FPS \| Mean ms \| p95 ms \|/m.test(t) || !/^\| off \|/m.test(t)) issues.push(`_benchText() is not the Markdown results table: ${JSON.stringify(t.slice(0, 160))}`);
              if (/^\| Scenario \|.*\bScale\b/m.test(t)) issues.push(`_benchText() still has a Scale column: ${JSON.stringify(t.slice(0, 160))}`);
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
  { script: OPTIONS, name: 'the About tab\'s "Copy all settings" button (data-tc="copy-settings") copies exactly bus.settingsText()',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || typeof bus.settingsText !== 'function') return 'window.__tcOptions.settingsText missing';
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const clip = navigator.clipboard;
      if (!clip) return 'can\'t verify: no navigator.clipboard in the test browser';
      const got = [];
      let start = null, out = true;
      try {
        Object.defineProperty(clip, 'writeText', { value: async t => { got.push(t); }, configurable: true });
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('About'))) return 'no About tab';
        const b = document.querySelector('#screen .inner [data-tc="copy-settings"]');
        if (!b) return `no [data-tc="copy-settings"] on the About tab (buttons: ${all('#screen .inner button.mcb').map(x => x.getAttribute('aria-label')).join(' | ')})`;
        if (b.getAttribute('aria-label') !== 'Copy all settings') out = `the button is labelled ${JSON.stringify(b.getAttribute('aria-label'))}, expected "Copy all settings"`;
        b.click();
        if (!(await __tcwait(() => got.length > 0, 3000))) out = 'clicking the button wrote nothing to the clipboard';
        else if (got[0] !== bus.settingsText()) out = `the clipboard text is not bus.settingsText(): ${JSON.stringify(String(got[0]).slice(0, 120))}`;
      } catch (e) {
        out = `threw: ${e.message}`;
      } finally {
        delete clip.writeText; // the instance property we added: the prototype's method is back
        try { if (marker() && start && start !== 'About') await show(start); } catch (e) {}
        if (before) M.back(); else M.closeMenu(); // restore
      }
      return out;
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
      // Better Options alone: there is nothing to stop. Escape goes to the game as before, and the "Run benchmark"
      // check covers the refusal. With the shader script loaded, a missing bench.abort() is a real regression.
      if (!T) return true;
      if (typeof T.bench !== 'function' || typeof T.bench.abort !== 'function') return 'Twitterentary.bench.abort() missing';
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
          const tag = '(a) Escape', run = await start(['off', 'low'], tag);
          if (run) {
            const inSecond = () => T.cfg.enabled === true && T.cfg.shadows === false;
            const t0 = performance.now();
            while (!run.t.done && !inSecond() && performance.now() - t0 < 40000) await sleep(50);
            if (run.t.done || !inSecond()) issues.push(`${tag}: can't verify: the second scenario never started (${run.t.done ? `the run ended: ${brief(run.t.value)}` : `cfg.enabled ${T.cfg.enabled}, shadows ${T.cfg.shadows}`})`);
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
  // Zoom 1.1.1: closes the title screen to press the key, so it runs with the checks that open menus.
  { script: ZOOM, name: 'zoom: a hold tweens to FOV / level and back, quick taps and blur always end on the real FOV, the wheel coalesces its writes, and __tcZoom and Copy settings never report a zoomed FOV',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const Z = window.__tcZoom, bus = window.__tcOptions;
      if (!Z || typeof Z.zooming !== 'boolean' || typeof Z.realFov !== 'number' || !('version' in Z)) return `window.__tcZoom should be { zooming, realFov, version }: ${JSON.stringify(Z)}`;
      const kb = bus && bus._keybinds ? (bus._keybinds() || []).find(k => k && k.id === 'zoom') : null;
      if (kb && kb.key !== 'KeyZ') return `the zoom keybind is on ${JSON.stringify(kb.key)} on a fresh profile, expected KeyZ (the key compat proves the game does not use, apart from Ctrl+Z in the skin editor)`;
      const scr = document.getElementById('screen'), before = scr.className, prev = localStorage.getItem('mc.fov');
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const fire = (t, mods) => window.dispatchEvent(new KeyboardEvent(t, { code: 'KeyZ', key: 'z', bubbles: true, cancelable: true, ...mods }));
      const wheel = (dy, n) => { for (let i = 0; i < n; i++) window.dispatchEvent(new WheelEvent('wheel', { deltaY: dy, bubbles: true, cancelable: true })); };
      const stored = () => Number(localStorage.getItem('mc.fov'));
      const near = (a, b) => Math.abs(a - b) < 1e-6;
      const Set_ = Storage.prototype.setItem, writes = []; // every value written to mc.fov, and nothing about any other key
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // it refuses while typing
      const level = Math.max(1.5, Math.min(20, Number(bus && bus.get ? bus.get('zoom.level', 4) : 4) || 4));
      const bad = [];
      const monotonic = (list, sign) => list.every((v, i) => !i || (v - list[i - 1]) * sign >= -1e-6);
      // Ends a press and waits until the view is back; true when it ends exactly on `fov`, with zooming false
      const settled = async fov => __tcwait(() => !Z.zooming && near(stored(), fov), 6000);
      try {
        if (before) { // a press with a screen on is refused
          fire('keydown');
          if (Z.zooming) bad.push('a press with a screen on started a zoom');
          fire('keyup');
          M.closeMenu();
        }
        if (/(^|\s)on(\s|$)/.test(scr.className)) return `can't verify: #screen class is still "${scr.className}" after closeMenu()`;
        Storage.prototype.setItem = function (k, v) { if (this === localStorage && k === 'mc.fov') writes.push(Number(v)); return Set_.call(this, k, v); };
        const orig = Z.realFov, target = orig / level;
        if (!(orig >= 30 && orig <= 110)) return `can't verify: __tcZoom.realFov is ${orig} before any zoom`;
        // Hold, and let go: one even tween each way, and the real FOV stays reported throughout
        fire('keydown');
        if (Z.zooming !== true) bad.push('the first press did not start a zoom at once');
        if (!(await __tcwait(() => near(stored(), target), 6000))) bad.push(`a hold ended on mc.fov ${stored()}, expected ${target}`);
        if (Z.realFov !== orig) bad.push(`__tcZoom.realFov is ${Z.realFov} mid-zoom, expected ${orig}`);
        if (bus && typeof bus.settingsText === 'function') { const f = JSON.parse(bus.settingsText()).game.fov; if (f !== orig) bad.push(`Copy settings reports FOV ${f} while zoomed, expected ${orig}`); }
        if (!monotonic(writes, -1)) bad.push(`the tween in did not move steadily down: ${writes.slice(0, 12).join(', ')}`);
        writes.length = 0;
        fire('keyup');
        if (Z.zooming !== true) bad.push('zooming went false at key-up: it should stay true until the tween back has finished');
        if (Z.realFov !== orig) bad.push(`__tcZoom.realFov is ${Z.realFov} on the way back, expected ${orig}`);
        if (!(await settled(orig))) bad.push(`after a release mc.fov is ${stored()}, zooming ${Z.zooming}, expected ${orig}, false`);
        if (!monotonic(writes, 1)) bad.push(`the tween back did not move steadily up: ${writes.slice(0, 12).join(', ')}`);
        // A quick tap in one tick, then five rapid ones: only the end state is promised
        fire('keydown'); fire('keyup');
        if (!(await settled(orig))) bad.push(`after a one-tick tap mc.fov is ${stored()}, zooming ${Z.zooming}, expected ${orig}, false`);
        for (let i = 0; i < 5; i++) { fire('keydown'); await sleep(30); fire('keyup'); await sleep(30); }
        if (!(await settled(orig))) bad.push(`after five quick taps mc.fov is ${stored()}, zooming ${Z.zooming}, expected ${orig}, false`);
        await sleep(400);
        if (Z.zooming || !near(stored(), orig)) bad.push(`after the taps settled mc.fov moved to ${stored()} (zooming ${Z.zooming})`);
        // The wheel: nothing written in its tick, at most one write a frame after it, and back down to the same level
        fire('keydown');
        if (!(await __tcwait(() => near(stored(), target), 6000))) bad.push(`a second hold ended on mc.fov ${stored()}, expected ${target}`);
        writes.length = 0;
        let frames = 0, counting = true;
        const count = () => { if (counting) { frames++; requestAnimationFrame(count); } };
        requestAnimationFrame(count);
        wheel(-100, 6);
        if (writes.length) bad.push(`six wheel events wrote mc.fov ${writes.length} times in their own tick, expected 0 (one write a frame)`);
        const zoomedIn = await __tcwait(() => stored() < target - 1e-6 && writes.length && near(stored(), writes[writes.length - 1]), 6000);
        await sleep(500);
        counting = false;
        if (!zoomedIn) bad.push(`the wheel did not zoom further in: mc.fov ${stored()}, hold target ${target}`);
        if (writes.length > frames + 1) bad.push(`the wheel wrote mc.fov ${writes.length} times over ${frames} frames, more than one a frame`);
        wheel(100, 6); // undoes the level, which stays in memory for the session
        if (!(await __tcwait(() => near(stored(), target), 6000))) bad.push(`wheeling back ended on mc.fov ${stored()}, expected ${target}`);
        fire('keyup');
        if (!(await settled(orig))) bad.push(`after the wheel and a release mc.fov is ${stored()}, zooming ${Z.zooming}, expected ${orig}, false`);
        // Losing the window restores at once: rAF stops in a hidden tab, so a tween could not finish
        fire('keydown');
        await __tcwait(() => stored() < orig - 1e-6, 6000);
        window.dispatchEvent(new Event('blur'));
        if (Z.zooming !== false || !near(stored(), orig)) bad.push(`blur left mc.fov ${stored()}, zooming ${Z.zooming}, expected ${orig}, false in the same tick`);
        fire('keyup');
        // A stale zoomed value in storage is not the real FOV
        Set_.call(localStorage, 'mc.fov', '17.5');
        if (!(Z.realFov >= 30 && Z.realFov <= 110)) bad.push(`with mc.fov = 17.5 stored __tcZoom.realFov is ${Z.realFov}: only the game's 30-110 counts`);
        Set_.call(localStorage, 'mc.fov', String(orig));
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        Storage.prototype.setItem = Set_;
        try { fire('keyup'); window.dispatchEvent(new Event('blur')); } catch (e) {}
        if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev);
        if (before && !/(^|\s)on(\s|$)/.test(scr.className)) M.back(); // back to the title screen
      }
      return !bad.length || bad.slice(0, 8).join('; ');
    } },
  // Zoom 1.1.2 ignores modifiers, so Ctrl+Z is held off by the screen being on, or by .se when wardrobe.js opened the skin
  // editor with #screen off. This runs after the check above, which has already primed the FOV input.
  { script: ZOOM, name: 'zoom: Z and Ctrl+Z are refused with a screen on or the skin editor open, a held modifier otherwise changes nothing, and a modifier can be the zoom key itself',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const Z = window.__tcZoom, bus = window.__tcOptions;
      if (!Z || typeof Z.zooming !== 'boolean') return `window.__tcZoom should be { zooming, realFov, version }: ${JSON.stringify(Z)}`;
      const scr = document.getElementById('screen'), before = scr.className, prev = localStorage.getItem('mc.fov');
      const sleep = ms => new Promise(r => setTimeout(r, ms)), on = () => /(^|\s)on(\s|$)/.test(scr.className);
      const fire = (t, mods, code = 'KeyZ') => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true, cancelable: true, ...mods }));
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // it refuses while typing
      const MODS = [{}, { ctrlKey: true }, { metaKey: true }, { altKey: true }], label = m => Object.keys(m)[0] || 'plain';
      const near = (x, y) => Math.abs(x - y) < 1e-6;
      const bad = [];
      const refused = async (where, mods) => {
        const fov0 = localStorage.getItem('mc.fov');
        fire('keydown', mods);
        await sleep(150);
        const z = Z.zooming, fov = localStorage.getItem('mc.fov');
        fire('keyup', mods);
        if (z || fov !== fov0) bad.push(`${label(mods)}+Z started a zoom ${where} (zooming ${z}, mc.fov ${fov0} -> ${fov})`);
        await __tcwait(() => !Z.zooming, 6000);
      };
      const zooms = async (what, mods, code) => {
        const fov0 = Z.realFov;
        fire('keydown', mods, code);
        if (!(await __tcwait(() => Z.zooming, 2000))) bad.push(`${what} did not start a zoom`);
        fire('keyup', mods, code);
        if (!(await __tcwait(() => !Z.zooming && near(Z.realFov, fov0), 6000))) bad.push(`after ${what} the view never settled on FOV ${fov0}`);
      };
      const se = document.createElement('div');
      se.className = 'se'; // what the game's skin editor appends to <body> while it is open
      const keyHad = bus && 'zoom.key' in bus.config, key0 = bus && bus.config['zoom.key'];
      try {
        if (!on()) { M.openOptions(); await __tcwait(on, 3000); }
        if (!on()) return `can't verify: no screen came on (#screen class "${scr.className}")`;
        for (const mods of MODS) await refused('with a screen on', mods);
        M.closeMenu();
        if (on()) return `can't verify: #screen class is still "${scr.className}" after closeMenu()`;
        document.body.append(se);
        for (const mods of MODS) await refused('with the skin editor open and #screen off', mods);
        se.remove();
        for (const mods of MODS) await zooms(`${label(mods)}+Z with nothing open`, mods);
        if (bus) { // a modifier's own keydown has its flag set: that must not count against it
          for (const [code, mods] of [['ControlRight', { ctrlKey: true }], ['AltLeft', { altKey: true }], ['MetaLeft', { metaKey: true }]]) {
            bus.set('zoom.key', code);
            await zooms(`${code} as the zoom key`, mods, code);
          }
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        se.remove();
        try { fire('keyup'); window.dispatchEvent(new Event('blur')); } catch (e) {}
        if (bus) bus.set('zoom.key', keyHad ? key0 : undefined);
        if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev);
        if (before && !on()) M.back(); // back to the title screen
        else if (!before && on()) M.closeMenu();
      }
      return !bad.length || bad.slice(0, 8).join('; ');
    } },
  // Better Options 1.3.1: the smoke page has no world, so noWorld() is true here. The game ignores F1 there, so a saved
  // flip would leave hud.on inverted once the player joins one.
  { script: OPTIONS, name: 'with no world the HUD row leaves hud.on alone and sends no F1, and the render-distance row says it applies when you join',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || typeof bus.get !== 'function' || typeof bus.open !== 'function') return 'window.__tcOptions.get/open missing';
      if (/^\/(?:r|play)\/[a-z0-9]{16}\/?$/.test(location.pathname)) return `can't verify: the test page ${location.pathname} is a world`;
      const scr = document.getElementById('screen'), note = document.getElementById('note'), before = scr.className;
      if (!note) return '#note missing';
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const hud = () => all('#screen .inner button.tc-tg').find(b => /^HUD: /.test(b.getAttribute('aria-label') || ''));
      const stored = () => JSON.stringify(bus.get('hud.on')), stored0 = stored(), want = `HUD: ${bus.get('hud.on', true) ? 'ON' : 'OFF'}`;
      const f1 = [], spy = e => { if (e.code === 'F1') f1.push(e.type); };
      const bad = [];
      let start = null;
      try {
        addEventListener('keydown', spy, true);
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('Graphics'))) return 'no Graphics tab';
        const rd = document.querySelector('#screen .inner input[aria-label="Render distance"]');
        const text = all('#screen .inner p.desc.small').find(p => p.textContent === 'Applies when you join a world.');
        if (!rd) bad.push('no Render distance slider');
        else if (!text) bad.push('the render-distance row has no "Applies when you join a world." text');
        else if (!text.previousElementSibling || !text.previousElementSibling.contains(rd)) bad.push('"Applies when you join a world." is not right under the render-distance slider');
        const b = hud();
        if (!b) bad.push(`no HUD row (buttons: ${all('#screen .inner button.mcb').map(x => x.getAttribute('aria-label')).join(' | ')})`);
        else {
          note.textContent = '';
          b.click();
          await sleep(300); // toggleHud is async
          if (stored() !== stored0) bad.push(`clicking the HUD row changed hud.on from ${stored0} to ${stored()}`);
          if (f1.length) bad.push(`clicking the HUD row sent F1 (${f1.join(', ')})`);
          const now = hud(), label = now && now.getAttribute('aria-label');
          if (label !== want) bad.push(`the HUD row reads ${JSON.stringify(label)} after the click, expected ${JSON.stringify(want)}: it must keep showing the saved value`);
          if (!/only be changed in a world/.test(note.textContent)) bad.push(`no toast explained why: #note says ${JSON.stringify(note.textContent)}`);
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        removeEventListener('keydown', spy, true);
        try { if (marker() && start) await show(start); } catch (e) {}
        if (before) M.back(); else M.closeMenu(); // restore
      }
      return !bad.length || bad.join('; ');
    } },
  // Shaders 1.5.2: the toggle moved from a hard-wired K to a keybind. T.reset() also clears every other tc.shader.* key, so
  // this puts back what it found.
  { script: [SHADERS, OPTIONS], name: 'the shader toggle is keybind tc.shaders.toggle: default K, a rebind moves it, a modifier can be the key, Ctrl, Cmd or Alt held with another key does nothing, and Twitterentary.reset() brings K back',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions, T = window.Twitterentary;
      if (!bus || !T) return true; // the row lives in Better Options' Keybinds tab: alone, there is nothing to rebind
      if (typeof bus._keybinds !== 'function' || typeof T.reset !== 'function') return 'window.__tcOptions._keybinds or Twitterentary.reset missing';
      const scr = document.getElementById('screen'), note = document.getElementById('note'), before = scr.className;
      if (!note) return '#note missing';
      const PFX = 'tc.shader.', STORE = PFX + 'toggleKey';
      const saved = () => { const o = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(PFX)) o[k] = localStorage.getItem(k); } return o; };
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const key = () => ((bus._keybinds() || []).find(k => k && k.id === 'tc.shaders.toggle') || {}).key;
      const bind = code => {
        const r = all('#screen .inner .tc-item').find(x => { const c = x.querySelector('.tc-cap'); return c && c.textContent === 'Toggle shaders'; }), b = r && r.querySelector('button');
        if (!b) throw new Error('no "Toggle shaders" row on the Keybinds tab');
        b.click();
        note.textContent = '';
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
        return note.textContent;
      };
      // true when a press of `code` flips the shaders; a second press flips them back
      const press = (code, mods) => document.body.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...mods }));
      const flips = (code, mods) => { const was = T.cfg.enabled; press(code, mods); const did = T.cfg.enabled !== was; if (did) press(code, mods); return did; };
      if (key() !== 'KeyK') return `tc.shaders.toggle is on ${JSON.stringify(key())} on a fresh profile, expected KeyK (registered: ${(bus._keybinds() || []).map(k => k && k.id).join(', ')})`;
      if (localStorage.getItem(STORE) !== null) return `can't verify: ${STORE} is saved (${localStorage.getItem(STORE)}) before the test`;
      const ls0 = saved(), cfg0 = Object.assign({}, T.cfg), bad = [];
      let start = null;
      try {
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('Keybinds'))) return 'no Keybinds tab';
        if (!flips('KeyK')) bad.push('K did not toggle the shaders before any rebind');
        const free = bind('KeyJ');
        if (/game key/.test(free)) bad.push(`binding J warned (#note ${JSON.stringify(free)}), and J is free`);
        if (key() !== 'KeyJ' || localStorage.getItem(STORE) !== 'KeyJ') bad.push(`after a rebind to J the key is ${key()} and ${STORE} is ${JSON.stringify(localStorage.getItem(STORE))}`);
        if (flips('KeyK')) bad.push('after a rebind to J, K still toggles the shaders');
        if (!flips('KeyJ')) bad.push('after a rebind to J, J does not toggle the shaders');
        T.reset();
        if (key() !== 'KeyK' || localStorage.getItem(STORE) !== null) bad.push(`after reset() the key is ${key()} and ${STORE} is ${JSON.stringify(localStorage.getItem(STORE))}, expected KeyK and nothing saved`);
        if (!flips('KeyK')) bad.push('after reset(), K does not toggle the shaders');
        if (flips('KeyJ')) bad.push('after reset(), J still toggles the shaders');
        // A modifier's own keydown has its flag set, so the flag can't count against it when it is the bound key
        for (const [code, mods] of [['AltLeft', { altKey: true }], ['ControlRight', { ctrlKey: true }], ['MetaLeft', { metaKey: true }]]) {
          bind(code);
          if (key() !== code) bad.push(`${code} did not bind, the key is on ${key()}`);
          else if (!flips(code, mods)) bad.push(`bound to ${code}, its press does not toggle the shaders`);
        }
        bind('KeyJ');
        if (!flips('KeyJ')) bad.push('bound to J, J does not toggle the shaders');
        for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) if (flips('KeyJ', mods)) bad.push(`${Object.keys(mods)[0]}+J toggled the shaders`);
        const back = bind('KeyK'); // K is a game key too (blueprints), so this warns; the default is stored as nothing
        if (!/also a game key/.test(back)) bad.push(`binding K did not warn (#note ${JSON.stringify(back)})`);
        if (key() !== 'KeyK' || localStorage.getItem(STORE) !== null) bad.push(`bound back to K the key is ${key()} and ${STORE} is ${JSON.stringify(localStorage.getItem(STORE))}`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        try {
          T.reset();
          for (const k of Object.keys(cfg0)) if (T.cfg[k] !== cfg0[k]) T.set(k, cfg0[k]);
          for (const k of Object.keys(saved())) if (!(k in ls0)) localStorage.removeItem(k);
          for (const k of Object.keys(ls0)) localStorage.setItem(k, ls0[k]);
        } catch (e) { bad.push(`restoring the settings threw: ${e.message}`); }
        try { if (marker() && start) await show(start); } catch (e) {}
        if (before) M.back(); else M.closeMenu(); // restore
      }
      return !bad.length || bad.join('; ');
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
  // Better Options 1.3.1: driven through the Keybinds tab as a player would, on the overlay's keybind, which is always
  // registered. It leaves F2 saved as perf.key, so it runs after "Reset all options", which needs a fresh profile.
  { script: OPTIONS, name: 'binding a mod key to a key the game uses warns and still binds, a free key does not warn, a key another mod holds names it, and the overlay takes a modifier as its key',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || typeof bus._keybinds !== 'function' || typeof bus.open !== 'function') return 'window.__tcOptions._keybinds/open missing';
      const scr = document.getElementById('screen'), note = document.getElementById('note'), before = scr.className;
      if (!note) return '#note missing';
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const key = () => ((bus._keybinds() || []).find(k => k && k.id === 'tc.perfOverlay') || {}).key;
      const bind = code => {
        const r = all('#screen .inner .tc-item').find(x => { const c = x.querySelector('.tc-cap'); return c && c.textContent === 'Performance overlay'; }), b = r && r.querySelector('button');
        if (!b) throw new Error('no "Performance overlay" row on the Keybinds tab');
        b.click();
        note.textContent = '';
        window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
        return note.textContent;
      };
      // GAME_ONLY_KEYS in full, and one GAME_ACTIONS row. The source entries prove these against the game.
      const GAME = ['KeyR', 'KeyC', 'KeyX', 'KeyK', 'KeyF', 'KeyV', 'KeyM', 'KeyO', 'KeyP', 'KeyL', 'Enter', 'Slash', 'Tab', 'F11', 'ShiftRight',
        'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'KeyW'];
      const K = await import('/js/keys.js').catch(() => null);
      const perfHad = 'perf.key' in bus.config, perf0 = bus.config['perf.key'];
      const bad = [];
      let start = null;
      try {
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        start = (all('#screen .inner .tc-tabs button.on')[0] || { getAttribute: () => null }).getAttribute('aria-label');
        if (!(await show('Keybinds'))) return 'no Keybinds tab';
        for (const code of GAME) {
          const said = bind(code);
          if (!/also a game key/.test(said)) bad.push(`${code}: no warning (#note ${JSON.stringify(said)})`);
          if (key() !== code) bad.push(`${code}: not bound, the keybind is on ${key()}`);
        }
        // Every default and alternative in the live game: a bind compat has never heard of still has to warn
        if (K) for (const b of K.BINDS) for (const code of [b.def, b.alt]) {
          if (!code || code.startsWith('Mouse')) continue; // the capture only takes keys
          const said = bind(code);
          if (!/also a game key/.test(said)) bad.push(`every code in the game's BINDS warns: ${b.id} on ${code} did not (#note ${JSON.stringify(said)})`);
        }
        for (const code of ['KeyZ', 'KeyJ', 'F2']) {
          const said = bind(code);
          if (/game key/.test(said)) bad.push(`${code}: warned on a free key (#note ${JSON.stringify(said)})`);
          if (key() !== code) bad.push(`${code}: not bound, the keybind is on ${key()}`);
        }
        const free = bind('KeyJ');
        if (free) bad.push(`J is free, but #note says ${JSON.stringify(free)}`);
        // A key another mod already holds names that mod, and says so too if the game uses it
        const others = (bus._keybinds() || []).filter(k => k && k.key && k.id !== 'tc.perfOverlay');
        if ((window.Twitterentary || window.__tcZoom) && !others.length) bad.push('no other mod keybind to clash with');
        for (const o of others) {
          const name = o.key.replace(/^Key/, ''), want = GAME.includes(o.key) ? `${name} is also a game key and ${o.label}` : `${name} is also ${o.label}`;
          const said = bind(o.key);
          if (said !== want) bad.push(`${o.id} on ${o.key}: #note says ${JSON.stringify(said)}, expected ${JSON.stringify(want)}`);
        }
        // A modifier's own keydown has its flag set, so the flag can't count against it when it is the overlay's key
        const flips = (code, mods) => {
          const was = bus.get('perf.overlay', false), hit = () => window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true, ...mods }));
          hit();
          const did = bus.get('perf.overlay', false) !== was;
          if (did) hit();
          return did;
        };
        for (const [code, mods] of [['AltLeft', { altKey: true }], ['ControlRight', { ctrlKey: true }], ['MetaLeft', { metaKey: true }]]) {
          bind(code);
          if (key() !== code) bad.push(`${code} did not bind, the overlay key is on ${key()}`);
          else if (!flips(code, mods)) bad.push(`bound to ${code}, its press does not toggle the overlay`);
        }
        bind('KeyJ');
        if (!flips('KeyJ')) bad.push('bound to J, J does not toggle the overlay');
        for (const mods of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) if (flips('KeyJ', mods)) bad.push(`${Object.keys(mods)[0]}+J toggled the overlay`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        bus.set('perf.key', perfHad ? perf0 : undefined); // undefined: back to not saved at all, so a later reset check sees a clean profile
        try { if (marker() && start) await show(start); } catch (e) {}
        if (before) M.back(); else M.closeMenu(); // restore
      }
      return !bad.length || bad.join('; ');
    } },
  // Better Options 1.4.0: with js/keys.js our saved remaps move into the game once and our remap retires. Each check below
  // puts back what it touched, native binds included, because later checks and a re-run need a clean profile.
  { script: OPTIONS, name: 'a saved keys.map moves once into the game\'s binds: an existing native bind, a taken key, a mod\'s key and a malformed key are respected, the old data is cleared, a failed move changes nothing, and a second run does nothing',
    run: async () => {
      const bus = window.__tcOptions;
      if (!bus || typeof bus._migrateKeys !== 'function' || typeof bus._injectKeys !== 'function' || typeof bus._nativeKeys !== 'function') return 'window.__tcOptions._migrateKeys, _injectKeys or _nativeKeys missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const K = await import('/js/keys.js').catch(() => null), note = document.getElementById('note');
      if (!note) return '#note missing';
      const map0 = bus.get('keys.map', {}), mute0 = bus.get('keys.mute', []), done0 = bus.get('keys.migrated', false);
      const json = JSON.stringify, bad = [];
      const plant = (map, mute) => { bus.set('keys.map', map); bus.set('keys.mute', mute); bus.set('keys.migrated', false); };
      if (!K) { // a build with no keys module: nothing moves and the saved remap stays in use
        try {
          plant({ KeyJ: 'KeyW' }, ['KeyW']);
          const r = await bus._migrateKeys();
          if (r !== null) bad.push(`with no js/keys.js _migrateKeys() gave ${json(r)}, expected null`);
          if (bus._nativeKeys()) bad.push('native mode is on with no js/keys.js');
          if (json(bus.get('keys.map')) !== '{"KeyJ":"KeyW"}' || bus.get('keys.migrated', false) === true) bad.push(`with no js/keys.js the saved data changed: keys.map ${json(bus.get('keys.map'))}, keys.migrated ${json(bus.get('keys.migrated'))}`);
        } finally {
          bus.set('keys.map', map0); bus.set('keys.mute', mute0); bus.set('keys.migrated', done0);
        }
        return !bad.length || bad.join('; ');
      }
      if (!(await __tcwait(() => bus._nativeKeys(), 5000))) return 'native key mode never came on with js/keys.js present';
      if (bus.get('keys.migrated', false) !== true) return `the startup migration did not set keys.migrated (${json(bus.get('keys.migrated'))})`;
      const binds0 = K.BINDS.map(b => [b.id, K.codeOf(b.id)]);
      const zoomHad = 'zoom.key' in bus.config, zoom0 = bus.config['zoom.key'], perfHad = 'perf.key' in bus.config, perf0 = bus.config['perf.key'];
      const TOGGLE = 'tc.shader.toggleKey', toggle0 = localStorage.getItem(TOGGLE);
      if (K.BINDS.some(b => K.codeOf(b.id) !== b.def)) return `can't verify: a fresh profile has moved binds (${binds0.filter(([id, c]) => c !== K.BINDS.find(b => b.id === id).def).join(' ')})`;
      const want = (what, got, ran, moved, skipped) => { if (json(got) !== json({ ran, moved, skipped })) bad.push(`${what}: _migrateKeys() gave ${json(got)}, expected ${json({ ran, moved, skipped })}`); };
      const on = (id, code) => { if (K.codeOf(id) !== code) bad.push(`${id} is on ${K.codeOf(id)}, expected ${code}`); };
      const cleared = what => { if (json(bus.get('keys.map')) !== '{}' || json(bus.get('keys.mute')) !== '[]' || bus.get('keys.migrated', false) !== true) bad.push(`${what}: keys.map ${json(bus.get('keys.map'))}, keys.mute ${json(bus.get('keys.mute'))}, keys.migrated ${json(bus.get('keys.migrated'))}: the old data should be gone and the flag set`); };
      try {
        // One of each: moves; a bind the player already moved natively; a key another bind owns; a default no bind has; a lone mute
        K.set('inventory', 'KeyI');
        plant({ KeyJ: 'KeyW', KeyU: 'KeyE', KeyQ: 'KeyT', KeyG: 'KeyZ' }, ['KeyW', 'KeyE', 'KeyT', 'F5']);
        note.textContent = '';
        want('one of each', await bus._migrateKeys(), true, 1, 4);
        on('forward', 'KeyJ'); on('inventory', 'KeyI'); on('chat', 'KeyT'); on('drop', 'KeyQ');
        cleared('one of each');
        if (!/Keys moved to the game's Controls: 1, skipped: 4/.test(note.textContent)) bad.push(`no toast with the counts: #note says ${json(note.textContent)}`);
        // A swap moves whole, and an alternative key is free for the taking: the game gives it up by itself
        K.resetAll();
        plant({ KeyW: 'KeyS', KeyS: 'KeyW', ArrowLeft: 'KeyQ' }, ['KeyS', 'KeyW', 'KeyQ']);
        want('a swap and an alternative key', await bus._migrateKeys(), true, 3, 0);
        on('forward', 'KeyS'); on('back', 'KeyW'); on('drop', 'ArrowLeft');
        cleared('a swap and an alternative key');
        // The plan above counts on this: the game itself gives up an alternative key that a bind took as its own
        if (K.action('ArrowLeft') !== 'drop' || K.is('ArrowLeft', 'left')) bad.push(`the game kept its alternative key: action("ArrowLeft") is ${json(K.action('ArrowLeft'))}, is(ArrowLeft, left) is ${K.is('ArrowLeft', 'left')}, expected "drop" and false`);
        // A remap from a key a mod answers to stays behind: with our capture listener gone, each press would run both
        K.resetAll();
        plant({ KeyK: 'KeyW', KeyZ: 'KeyQ', F2: 'KeyQ' }, ['KeyW', 'KeyQ']);
        note.textContent = '';
        want('a mod\'s default keys', await bus._migrateKeys(), true, 0, 3);
        on('forward', 'KeyW'); on('drop', 'KeyQ');
        cleared('a mod\'s default keys');
        if (!/skipped: 3 \(K, Z, F2 used by a mod\)/.test(note.textContent)) bad.push(`the toast does not name the mod keys: #note says ${json(note.textContent)}`);
        // Saved keys count even with no script registered to report them, and a key a mod has left is free again
        bus.set('zoom.key', 'KeyB');
        bus.set('perf.key', 'KeyN');
        localStorage.setItem(TOGGLE, 'KeyG');
        plant({ KeyB: 'KeyE', KeyN: 'KeyT', KeyG: 'KeyF', KeyZ: 'KeyQ' }, []);
        want('saved mod keys elsewhere', await bus._migrateKeys(), true, 1, 3);
        on('inventory', 'KeyE'); on('chat', 'KeyT'); on('swapHands', 'KeyF'); on('drop', 'KeyZ');
        cleared('saved mod keys elsewhere');
        bus.set('zoom.key', zoomHad ? zoom0 : undefined);
        bus.set('perf.key', perfHad ? perf0 : undefined);
        if (toggle0 === null) localStorage.removeItem(TOGGLE); else localStorage.setItem(TOGGLE, toggle0);
        // A key the game would throw away on reload is skipped alone: it must not fail the whole move
        K.resetAll();
        plant({ '': 'KeyW', 'bad key': 'KeyQ', KeyI: 'KeyE' }, []);
        want('malformed keys', await bus._migrateKeys(), true, 1, 2);
        on('forward', 'KeyW'); on('drop', 'KeyQ'); on('inventory', 'KeyI');
        cleared('malformed keys');
        // Done once: new data is left alone
        K.resetAll();
        bus.set('keys.map', { KeyH: 'KeyQ' });
        want('a second run', await bus._migrateKeys(), false, 0, 0);
        on('drop', 'KeyQ');
        if (json(bus.get('keys.map')) !== '{"KeyH":"KeyQ"}') bad.push(`a second run touched keys.map: ${json(bus.get('keys.map'))}`);
        // A failed move puts back what it set, keeps the old data and leaves our own remap on
        plant({ KeyJ: 'KeyW', KeyH: 'KeyQ' }, ['KeyW', 'KeyQ']);
        const fake = { ...K, set: (id, code) => { if (id === 'drop') throw new Error('stand-in failure'); K.set(id, code); } };
        const warn = console.warn;
        console.warn = () => {}; // the script's own warning about this planted failure is expected here
        const native = await bus._injectKeys(fake).finally(() => { console.warn = warn; });
        if (native !== false || bus._nativeKeys()) bad.push(`a failed migration left native mode on (${json(native)})`);
        on('forward', 'KeyW'); on('drop', 'KeyQ');
        if (json(bus.get('keys.map')) !== '{"KeyJ":"KeyW","KeyH":"KeyQ"}' || bus.get('keys.migrated', false) === true) bad.push(`a failed migration changed the saved data: keys.map ${json(bus.get('keys.map'))}, keys.migrated ${json(bus.get('keys.migrated'))}`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        K.resetAll();
        for (const [id, code] of binds0) if (K.codeOf(id) !== code) K.set(id, code);
        bus.set('zoom.key', zoomHad ? zoom0 : undefined);
        bus.set('perf.key', perfHad ? perf0 : undefined);
        if (toggle0 === null) localStorage.removeItem(TOGGLE); else localStorage.setItem(TOGGLE, toggle0);
        bus.set('keys.map', map0); bus.set('keys.mute', mute0); bus.set('keys.migrated', done0);
        await bus._injectKeys(K);
      }
      return !bad.length || bad.join('; ');
    } },
  { script: OPTIONS, name: 'with js/keys.js the Keybinds tab lists mod keys only and has the Game controls button; with no module the game rows are back and that button is gone',
    run: async () => {
      const M = await import('/js/menus.js');
      const bus = window.__tcOptions;
      if (!bus || typeof bus._injectKeys !== 'function' || typeof bus._keybinds !== 'function') return 'window.__tcOptions._injectKeys or _keybinds missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const K = await import('/js/keys.js').catch(() => null);
      const scr = document.getElementById('screen'), before = scr.className;
      const all = s => [...document.querySelectorAll(s)], sleep = ms => new Promise(r => setTimeout(r, ms));
      const marker = () => !!document.querySelector('#screen .inner .tc-marker');
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const caps = () => all('#screen .inner .tc-item .tc-cap').map(c => c.textContent);
      const button = () => all('#screen .inner button.mcb').find(b => b.getAttribute('aria-label') === 'Game controls…');
      const GAME = ['Forward', 'Back', 'Left', 'Right', 'Jump', 'Sneak', 'Sprint (Mac)', 'Drop item', 'Inventory', 'Chat', 'View', 'Debug (F3)', 'HUD (F1)'];
      const mods = () => (bus._keybinds() || []).map(k => k.label);
      const open = async () => { await bus.open(); if (!(await __tcwait(marker, 5000))) throw new Error(`menu not shown (#screen class "${scr.className}")`); await sleep(300); if (!(await show('Keybinds'))) throw new Error('no Keybinds tab'); };
      const noModule = () => {
        const have = caps(), gone = GAME.filter(g => !have.includes(g));
        if (gone.length) bad.push(`with no keys module these game rows are missing: ${gone.join(', ')}`);
        if (button()) bad.push('with no keys module the Game controls button is shown');
      };
      const bad = [];
      try {
        await open();
        const missing = mods().filter(m => !caps().includes(m));
        if (missing.length) bad.push(`mod rows missing: ${missing.join(', ')}`);
        if (!K) noModule();
        else {
          const left = GAME.filter(g => caps().includes(g));
          if (left.length) bad.push(`with js/keys.js these game rows are still listed: ${left.join(', ')}`);
          if (caps().length !== mods().length) bad.push(`the tab lists ${caps().length} rows (${caps().join(' | ')}) for ${mods().length} mod keys`);
          const b = button();
          if (!b) bad.push(`no Game controls button (buttons: ${all('#screen .inner button.mcb').map(x => x.getAttribute('aria-label')).join(' | ')})`);
          else {
            b.click();
            if (!(await __tcwait(() => document.querySelector('#screen.on .keylist'), 3000))) bad.push('the Game controls button did not open the game\'s Controls screen');
            else { M.back(); await sleep(100); M.back(); await sleep(100); await open(); }
          }
          await bus._injectKeys(null);
          await sleep(200);
          if (!marker()) await open();
          else await show('Keybinds');
          noModule();
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        if (K) await bus._injectKeys(K);
        if (marker()) { if (before) M.back(); else M.closeMenu(); } // restore
      }
      return !bad.length || bad.join('; ');
    } },
  // A synthetic press must never run another action: a place-scope bind such as bpPaste would make the game send a network
  // message. Smoke runs on the title, where the HUD row stops at noWorld() (its own check above), so _sendF1 covers the press,
  // and the row is clicked with a world's path borrowed for a moment: noWorld() reads location.pathname on each call, and
  // the game doesn't read it again after boot.
  { script: OPTIONS, name: 'the HUD press follows a rebound hideHud; bound to a mouse button, or sharing its key with any bind in any scope, nothing is sent, and the HUD row saves hud.on only when a press went out',
    run: async () => {
      const M = await import('/js/menus.js');
      const bus = window.__tcOptions;
      if (!bus || typeof bus._sendF1 !== 'function') return 'window.__tcOptions._sendF1 missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const K = await import('/js/keys.js').catch(() => null);
      const scr = document.getElementById('screen'), before = scr.className, note = document.getElementById('note');
      if (!note) return '#note missing';
      const marker = () => !!document.querySelector('#screen .inner .tc-marker'), sleep = ms => new Promise(r => setTimeout(r, ms));
      const all = s => [...document.querySelectorAll(s)];
      const tab = n => all('#screen .inner .tc-tabs button').find(b => b.getAttribute('aria-label') === n);
      const show = async n => { const b = tab(n); if (!b) return false; b.click(); await __tcwait(() => { const x = tab(n); return x && x.classList.contains('on'); }, 1500); await sleep(100); return true; };
      const row = () => all('#screen .inner button.tc-tg').find(b => /^HUD: /.test(b.getAttribute('aria-label') || ''));
      const click = async () => { const b = row(); if (!b) throw new Error('no HUD row on the Graphics tab'); b.click(); await sleep(300); }; // toggleHud is async
      const hud = () => JSON.stringify(bus.get('hud.on')), hud0 = hud(), hudHad = 'hud.on' in bus.config, hudVal = bus.config['hud.on'];
      const path = location.pathname + location.search + location.hash;
      const sent = [], spy = e => { if (e.__tc) sent.push(`${e.type}:${e.code}`); };
      const bad = [];
      const sends = async code => {
        sent.length = 0;
        const r = await bus._sendF1();
        if (r !== true) bad.push(`with the HUD key on ${code} _sendF1() gave ${JSON.stringify(r)}, expected true`);
        if (sent.join(' ') !== `keydown:${code} keyup:${code}`) bad.push(`with the HUD key on ${code} it sent [${sent.join(' ')}]`);
        if (!(await __tcwait(marker, 1500))) bad.push(`our menu did not come back after a press of ${code}`);
      };
      const refuses = async (code, onlyIfHidden) => {
        sent.length = 0;
        note.textContent = '';
        const r = await bus._sendF1(onlyIfHidden);
        if (r !== false) bad.push(`with the HUD key on ${code} _sendF1(${onlyIfHidden || ''}) gave ${JSON.stringify(r)}, expected false`);
        if (sent.length) bad.push(`with the HUD key on ${code} it sent [${sent.join(' ')}]`);
        if (!/Can't reach the HUD key/.test(note.textContent)) bad.push(`with the HUD key on ${code} #note says ${JSON.stringify(note.textContent)}`);
        if (!(await __tcwait(marker, 1500))) bad.push(`our menu was not left up with the HUD key on ${code}`);
      };
      try {
        addEventListener('keydown', spy, true);
        addEventListener('keyup', spy, true);
        await bus.open();
        if (!(await __tcwait(marker, 5000))) return `menu not shown (#screen class "${scr.className}")`;
        await sleep(300);
        await sends('F1');
        if (K) {
          K.set('hideHud', 'KeyJ');
          await sends('KeyJ');
          K.set('hideHud', 'Mouse3');
          await refuses('Mouse3');
          await refuses('Mouse3', true); // the reset path: #hudtop is hidden on the title
          K.set('hideHud', 'KeyQ'); // action("KeyQ") is drop: a press would drop an item, not hide the HUD
          await refuses('KeyQ');
          // action() answers hideHud on these two, because it only looks at scope "game". The press would still run the other bind.
          K.set('bpPaste', 'KeyJ');
          K.set('hideHud', 'KeyJ');
          if (K.action('KeyJ') !== 'hideHud') bad.push(`can't verify: action("KeyJ") is ${K.action('KeyJ')}`);
          await refuses('KeyJ, shared with bpPaste in scope place');
          K.reset('bpPaste');
          K.set('copySlow', 'KeyU');
          K.set('hideHud', 'KeyU');
          await refuses('KeyU, shared with copySlow in scope debug');
          K.reset('copySlow');
          K.reset('hideHud');
          await sends('F1');
        }
        if (!(await show('Graphics'))) return 'no Graphics tab';
        history.replaceState(history.state, '', '/r/0123456789abcdef');
        await click(); // the control: a press that went out flips and saves hud.on
        if (hud() === hud0) bad.push(`the HUD row in a world did not change hud.on (${hud()}): the refusal below would prove nothing`);
        await click();
        if (hud() !== hud0) bad.push(`a second click left hud.on on ${hud()}, expected ${hud0}`);
        if (K) {
          K.set('hideHud', 'Mouse3');
          sent.length = 0;
          note.textContent = '';
          await click();
          if (hud() !== hud0) bad.push(`with the HUD key on Mouse3 the row changed hud.on from ${hud0} to ${hud()}`);
          if (sent.length) bad.push(`with the HUD key on Mouse3 the row sent [${sent.join(' ')}]`);
          if (!/Can't reach the HUD key/.test(note.textContent)) bad.push(`with the HUD key on Mouse3 the row left #note ${JSON.stringify(note.textContent)}`);
          const b = row(), label = b && b.getAttribute('aria-label'), shown = `HUD: ${bus.get('hud.on', true) ? 'ON' : 'OFF'}`;
          if (label !== shown) bad.push(`the row reads ${JSON.stringify(label)} after a refused press, expected ${JSON.stringify(shown)}`);
          K.reset('hideHud');
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        history.replaceState(history.state, '', path);
        bus.set('hud.on', hudHad ? hudVal : undefined);
        removeEventListener('keydown', spy, true);
        removeEventListener('keyup', spy, true);
        if (K) { K.reset('hideHud'); K.reset('bpPaste'); K.reset('copySlow'); }
        if (marker()) { if (before) M.back(); else M.closeMenu(); } else if (before && !/(^|\s)on(\s|$)/.test(scr.className)) M.back(); // restore
      }
      return !bad.length || bad.join('; ');
    } },
  { script: OPTIONS, name: 'with no js/keys.js a saved remap rewrites the key and wins over a mod key; with it, a leftover keys.map does nothing',
    run: async () => {
      const M = await import('/js/menus.js');
      const bus = window.__tcOptions;
      if (!bus || typeof bus._injectKeys !== 'function' || typeof bus._nativeKeys !== 'function') return 'window.__tcOptions._injectKeys or _nativeKeys missing';
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const K = await import('/js/keys.js').catch(() => null);
      const scr = document.getElementById('screen'), before = scr.className;
      const map0 = bus.get('keys.map', {}), perf0 = bus.get('perf.overlay', false);
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // remapping is off while typing
      const perf = () => bus.get('perf.overlay', false);
      const seen = [], spy = e => { if (e.__tc) seen.push(`${e.type}:${e.code}`); };
      const press = code => { seen.length = 0; for (const t of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true, cancelable: true })); return seen.join(' '); };
      const bad = [];
      try {
        addEventListener('keydown', spy, true);
        addEventListener('keyup', spy, true);
        if (K) await bus._injectKeys(null);
        if (bus._nativeKeys()) return 'native key mode is on with no keys module';
        M.closeMenu();
        if (/(^|\s)on(\s|$)/.test(scr.className)) return `can't verify: #screen class is still "${scr.className}" after closeMenu()`;
        bus.set('keys.map', { KeyJ: 'KeyQ', F2: 'KeyQ' });
        const plain = press('KeyJ');
        if (plain !== 'keydown:KeyQ keyup:KeyQ') bad.push(`a saved remap of J to Q sent [${plain}]`);
        const mod = press('F2');
        if (mod !== 'keydown:KeyQ keyup:KeyQ') bad.push(`a saved remap on the overlay's F2 sent [${mod}]: it should win over the mod key`);
        if (perf() !== perf0) bad.push('a saved remap on F2 also flipped the overlay');
        bus.set('keys.map', {});
        const free = press('F2');
        if (free) bad.push(`with nothing saved F2 was rewritten to [${free}]`);
        if (perf() === perf0) bad.push('with nothing saved F2 did not flip the overlay');
        else press('F2');
        if (K) {
          await bus._injectKeys(K);
          if (!bus._nativeKeys()) bad.push('native key mode did not come back');
          bus.set('keys.map', { KeyJ: 'KeyQ', F2: 'KeyQ' });
          const retired = press('KeyJ') + press('F2');
          if (retired) bad.push(`with js/keys.js a leftover keys.map still rewrote keys: [${retired}]`);
          if (perf() === perf0) bad.push('with js/keys.js a leftover remap on F2 still blocked the overlay');
          else press('F2');
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        removeEventListener('keydown', spy, true);
        removeEventListener('keyup', spy, true);
        bus.set('keys.map', map0);
        if (perf() !== perf0) bus.set('perf.overlay', perf0);
        if (K) await bus._injectKeys(K);
        if (before && !/(^|\s)on(\s|$)/.test(scr.className)) M.back(); // back to the title screen
      }
      return !bad.length || bad.join('; ');
    } },
  // Better Options' own synthetic presses carry __tc. When the HUD key shares a code with a mod key, or a remap rewrites to one,
  // that press is for the game alone: the shader toggle and Zoom must not answer it.
  { script: [SHADERS, ZOOM], name: 'a synthetic __tc press does nothing to the shader toggle or Zoom, and a __tc keyup does not end a held zoom',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const T = window.Twitterentary, Z = window.__tcZoom;
      const scr = document.getElementById('screen'), before = scr.className, prev = localStorage.getItem('mc.fov');
      const sleep = ms => new Promise(r => setTimeout(r, ms)), on = () => /(^|\s)on(\s|$)/.test(scr.className);
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur();
      const fire = (t, code, tc) => { const e = new KeyboardEvent(t, { code, bubbles: true, cancelable: true }); if (tc) e.__tc = true; window.dispatchEvent(e); };
      const bad = [];
      try {
        if (T) {
          const was = T.cfg.enabled;
          fire('keydown', 'KeyK', true);
          if (T.cfg.enabled !== was) { bad.push('a __tc press of K toggled the shaders'); fire('keydown', 'KeyK', true); }
          fire('keydown', 'KeyK'); // the control: the same key with no __tc does toggle
          if (T.cfg.enabled === was) bad.push('can\'t verify: a plain K did not toggle the shaders');
          else fire('keydown', 'KeyK');
        }
        if (Z) {
          M.closeMenu();
          if (on()) return `can't verify: #screen class is still "${scr.className}" after closeMenu()`;
          fire('keydown', 'KeyZ', true);
          await sleep(300);
          if (Z.zooming) bad.push('a __tc press of Z started a zoom');
          fire('keyup', 'KeyZ');
          await __tcwait(() => !Z.zooming, 6000);
          fire('keydown', 'KeyZ'); // the control, and a held zoom for the keyup below
          if (!(await __tcwait(() => Z.zooming, 2000))) bad.push('can\'t verify: a plain Z did not start a zoom');
          const fov = Z.realFov;
          fire('keyup', 'KeyZ', true);
          await sleep(1000); // longer than the tween back, which is what a keyup would start
          const cur = Number(localStorage.getItem('mc.fov'));
          if (!Z.zooming || cur >= fov) bad.push(`a __tc keyup ended a held zoom (zooming ${Z.zooming}, mc.fov ${cur}, real FOV ${fov})`);
          fire('keyup', 'KeyZ');
          if (!(await __tcwait(() => !Z.zooming, 6000))) bad.push('the real keyup did not end the zoom');
        }
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        try { fire('keyup', 'KeyZ'); window.dispatchEvent(new Event('blur')); } catch (e) {}
        if (Z) { if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev); }
        if (before && !on()) M.back(); // back to the title screen
      }
      return !bad.length || bad.join('; ');
    } },
  // keys.migrated is a record of something done, not a setting. If reset wiped it, the next run would move a planted or
  // re-saved map a second time. The control proves a reset really happened.
  { script: OPTIONS, name: 'bus.reset() keeps keys.migrated and still resets the settings',
    run: async () => {
      const bus = window.__tcOptions;
      if (!bus || typeof bus.reset !== 'function') return 'window.__tcOptions.reset missing';
      const saved = () => { try { return JSON.parse(localStorage.getItem('tc.options') || '{}'); } catch (e) { return {}; } };
      const cfg0 = JSON.parse(JSON.stringify(bus.config)), bad = [];
      try {
        bus.set('keys.migrated', true);
        bus.set('input.sens', 2.5);
        bus.reset();
        if (bus.get('input.sens', 1) === 2.5) bad.push('can\'t verify: bus.reset() left input.sens on 2.5');
        if (bus.get('keys.migrated', false) !== true) bad.push(`bus.reset() wiped keys.migrated (${JSON.stringify(bus.get('keys.migrated'))})`);
        if (saved()['keys.migrated'] !== true) bad.push(`after bus.reset() tc.options holds keys.migrated ${JSON.stringify(saved()['keys.migrated'])}`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        for (const k of Object.keys(bus.config)) if (!(k in cfg0)) bus.set(k, undefined);
        for (const k of Object.keys(cfg0)) bus.set(k, cfg0[k]);
      }
      return !bad.length || bad.join('; ');
    } },
  // Our listeners run before the game's recorder, so without their guards the key a player presses to record a bind would
  // also fire our action. Staging has no such screen. A build with only one of the two files is a change to look at.
  { script: [SHADERS, OPTIONS, ZOOM], name: 'on the game\'s Controls screen K, F2 and Z do nothing, recording a bind on those keys still works, and back() returns to the game\'s Options',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const K = await import('/js/keys.js').catch(() => null), C = await import('/js/controls.js').catch(() => null);
      if (!K && !C) return true;
      if (!K || !C || typeof C.openControls !== 'function') return `js/keys.js (${!!K}) and js/controls.js with openControls (${!!C}) should come together`;
      const T = window.Twitterentary, bus = window.__tcOptions, Z = window.__tcZoom;
      const scr = document.getElementById('screen'), before = scr.className, sleep = ms => new Promise(r => setTimeout(r, ms));
      const prev = localStorage.getItem('mc.fov');
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur();
      const up = () => !!document.querySelector('#screen.on .keylist');
      const options = () => !!document.querySelector('#screen .inner input[type="range"][data-k="fov"]');
      const fire = (t, code) => window.dispatchEvent(new KeyboardEvent(t, { code, bubbles: true, cancelable: true }));
      const state = () => JSON.stringify({ shaders: T ? T.cfg.enabled : null, overlay: bus ? bus.get('perf.overlay', false) : null, zoom: Z ? Z.zooming : null });
      const bad = [];
      try {
        // The control: with no Controls screen up the same presses do act, so a silent pass below means something
        const s00 = state();
        if (T) { fire('keydown', 'KeyK'); if (state() === s00) return 'can\'t verify: K did not toggle the shaders before the Controls screen opened'; fire('keydown', 'KeyK'); }
        if (bus) { fire('keydown', 'F2'); if (state() === s00) return 'can\'t verify: F2 did not toggle the overlay before the Controls screen opened'; fire('keydown', 'F2'); }
        if (Z) { // the title has #screen on too, so Z needs the world in view to show it can act at all
          M.closeMenu();
          fire('keydown', 'KeyZ');
          const zoomed = await __tcwait(() => Z.zooming, 2000);
          fire('keyup', 'KeyZ');
          await __tcwait(() => !Z.zooming, 6000);
          if (!zoomed) return 'can\'t verify: Z did not zoom with no screen up, before the Controls screen opened';
        }
        C.openControls();
        if (!(await __tcwait(up, 3000))) return `the Controls screen did not open (#screen class "${scr.className}")`;
        const s0 = state();
        for (const code of ['KeyK', 'F2', 'KeyZ']) {
          fire('keydown', code);
          await sleep(100);
          if (state() !== s0) bad.push(`${code} acted on the Controls screen: ${s0} became ${state()}`);
          fire('keyup', code);
        }
        for (const code of ['KeyK', 'F2', 'KeyZ']) {
          const b = document.querySelector('#screen .inner [data-k="key-hideHud"]');
          if (!b) { bad.push('no hideHud row on the Controls screen'); break; }
          b.click();
          fire('keydown', code);
          await sleep(100);
          if (K.codeOf('hideHud') !== code) bad.push(`pressing ${code} to record it left hideHud on ${K.codeOf('hideHud')}`);
          if (state() !== s0) bad.push(`recording ${code} also fired it: ${s0} became ${state()}`);
          fire('keyup', code);
          K.reset('hideHud');
        }
        M.back();
        if (!(await __tcwait(() => !up() && options(), 3000))) bad.push(`back() from the Controls screen did not reach the game's Options (#screen class "${scr.className}")`);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        K.reset('hideHud');
        if (up()) M.back();
        if (options()) { if (before) M.back(); else M.closeMenu(); } // restore
        else if (before && !/(^|\s)on(\s|$)/.test(scr.className)) M.back();
        if (Z) { if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev); }
      }
      return !bad.length || bad.join('; ');
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
  // Both of these rebuild a screen, so they stay last. Better Options is driven with a fake menus module, on planted
  // nodes only: the title's own children are never moved. No macrotask runs between setting a scene up and tearing it
  // down, so the game never sees one. The fake pause screen is class "on dim" (pauseUp() requires dim) plus a planted
  // Options button. The real title has that button too (prod), and the fake openOptions can't replace it as the real one
  // would, so its label is lifted for the run: otherwise a refused openPause still looks like a pause menu.
  { script: OPTIONS, name: 'grabFovInput opens the game Options, then restores the pause menu or no menu, with document.exitPointerLock an own property for exactly that span',
    run: async () => {
      const real = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const bus = window.__tcOptions;
      if (!bus || typeof bus._injectMenus !== 'function' || typeof bus._labels !== 'function' || !bus.fov || typeof bus.fov.prime !== 'function' || typeof bus.fov._forget !== 'function') return 'window.__tcOptions._injectMenus/_labels/fov.prime/fov._forget missing';
      const scr = document.getElementById('screen'), inner = scr && scr.querySelector('.inner'), cross = document.getElementById('cross');
      if (!inner || !cross) return '#screen .inner or #cross missing';
      const label = (bus._labels().options || [])[0];
      if (!label) return 'no pause Options label';
      const own = () => Object.prototype.hasOwnProperty.call(document, 'exitPointerLock');
      if (own()) return "can't verify: document.exitPointerLock is an own property before the test";
      const a = document.activeElement;
      if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // prime() refuses while typing
      const before = scr.className, crossOff = cross.classList.contains('off'), planted = [], lifted = [], bad = [];
      const labels = new Set(bus._labels().options || []);
      for (const b of inner.querySelectorAll('button[aria-label]')) if (labels.has(b.getAttribute('aria-label'))) { lifted.push([b, b.getAttribute('aria-label')]); b.removeAttribute('aria-label'); }
      const clear = () => { for (const n of planted.splice(0)) n.remove(); };
      const plant = (tag, attrs) => { const n = document.createElement(tag); for (const k of Object.keys(attrs)) n.setAttribute(k, attrs[k]); inner.append(n); planted.push(n); return n; };
      const pauseUp = () => plant('button', { 'aria-label': label });
      const scene = {
        pause: () => { scr.className = 'on dim'; pauseUp(); },
        idle: () => { scr.className = ''; cross.classList.remove('off'); },
      };
      const run = async (tag, spot, want, refuse) => {
        const log = [], shadow = [];
        let input = null;
        const note = n => { log.push(n); shadow.push(own()); };
        const fake = {
          openOptions() { note('openOptions'); clear(); input = plant('input', { type: 'range', 'data-k': 'fov' }); },
          openPause() { note('openPause'); if (refuse) return; clear(); pauseUp(); },
          closeMenu() { note('closeMenu'); clear(); scr.className = ''; },
          showScreen() { note('showScreen'); },
        };
        bus.fov._forget();
        bus._injectMenus(fake);
        clear();
        scene[spot]();
        const got = await bus.fov.prime();
        if (got !== true) bad.push(`${tag}: prime() resolved ${JSON.stringify(got)}, expected true`);
        if (log.join() !== want.join()) bad.push(`${tag}: the calls were [${log.join(', ')}], expected [${want.join(', ')}]`);
        if (shadow.includes(false)) bad.push(`${tag}: document.exitPointerLock was not an own property during [${log.filter((n, i) => !shadow[i]).join(', ')}]`);
        if (own()) bad.push(`${tag}: document.exitPointerLock is still an own property afterwards`);
        if (input && (input.min !== '2' || input.step !== 'any')) bad.push(`${tag}: the FOV input was not widened (min ${input.min}, step ${input.step})`);
      };
      try {
        await run('pause menu up', 'pause', ['openOptions', 'openPause']);
        await run('pause menu refused', 'pause', ['openOptions', 'openPause', 'closeMenu'], true);
        await run('no menu, no lock', 'idle', ['openOptions', 'closeMenu']);
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        if (own()) delete document.exitPointerLock;
        clear();
        for (const [b, l] of lifted) b.setAttribute('aria-label', l);
        scr.className = before;
        if (crossOff) cross.classList.add('off');
        bus._injectMenus(real);
        bus.fov._forget();
      }
      return !bad.length || bad.join('; ');
    } },
  // localStealFov is private and imports the real module, so this drives the real path: a first press with setNow hidden.
  // It leaves Zoom's own input cached for the rest of the page, which is why it runs after the "zoom:" check above.
  { script: ZOOM, name: 'localStealFov (a first press with no setNow) opens and closes the game Options with document.exitPointerLock an own property for exactly that span',
    run: async () => {
      const M = await import('/js/menus.js');
      if (!(await __tcwait(() => window.__ready === true, 30000))) return 'window.__ready never became true within 30 s: the world did not load in the test browser, or the game renamed the flag';
      const Z = window.__tcZoom, bus = window.__tcOptions;
      if (!Z) return 'window.__tcZoom missing';
      // Alone, Zoom already took this path in the "zoom:" check and has the input cached: nothing is left to observe.
      if (!bus || !bus.fov) return true;
      const scr = document.getElementById('screen'), inner = scr && scr.querySelector('.inner');
      if (!inner) return '#screen .inner missing';
      const own = () => Object.prototype.hasOwnProperty.call(document, 'exitPointerLock');
      if (own()) return "can't verify: document.exitPointerLock is an own property before the test";
      const before = scr.className, prev = localStorage.getItem('mc.fov'), fov = bus.fov, key = bus.get('zoom.key', 'KeyZ');
      const fire = t => window.dispatchEvent(new KeyboardEvent(t, { code: key, bubbles: true, cancelable: true }));
      const calls = [], bad = [];
      try {
        if (before) M.closeMenu();
        if (scr.classList.contains('on')) return `can't verify: #screen class is still "${scr.className}" after closeMenu()`;
        const a = document.activeElement;
        if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) a.blur(); // it refuses while typing
        bus.fov = { get: fov.get, set: fov.set };
        inner.replaceChildren = function (...kids) {
          Element.prototype.replaceChildren.apply(this, kids);
          calls.push(`${this.querySelector('input[type="range"][data-k="fov"]') ? 'open' : 'close'}:${own()}`);
        };
        fire('keydown');
        fire('keyup');
        if (!(await __tcwait(() => !Z.zooming, 5000))) bad.push('the first press never settled');
        const got = calls.join();
        if (got !== 'open:true,close:true') bad.push(`showScreen/closeMenu ran as [${got}] (name:shadowed), expected [open:true,close:true]`);
        if (own()) bad.push('document.exitPointerLock is still an own property afterwards');
      } catch (e) {
        bad.push(`threw: ${e.message}`);
      } finally {
        delete inner.replaceChildren;
        bus.fov = fov;
        try { fire('keyup'); window.dispatchEvent(new Event('blur')); } catch (e) {}
        if (own()) delete document.exitPointerLock;
        if (prev === null) localStorage.removeItem('mc.fov'); else localStorage.setItem('mc.fov', prev);
        if (scr.className !== before) { if (before) M.back(); else M.closeMenu(); } // also when Options stayed open
      }
      if (scr.className !== before) bad.push(`#screen class is "${scr.className}" afterwards, it was "${before}"`);
      return !bad.length || bad.join('; ');
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
  // lightmap() in the lit FS. No flat varyings: on ANGLE/D3D11 our old flat vCls, which every terrain pixel read, cost
  // ~2.3 GPU ms per frame at rd 12 (LAB2, UHD 620), likely the geometry shader ANGLE adds for flat's provoking vertex.
  // The game's own flat vGlass (build 6b3963e444) is stripped by the same rule, not for that cost: measured on the title
  // screen, the strip gains nothing. These markers stay at 0 and are the proof of the strip.
  { script: SHADERS, name: 'terrain fragment shaders get the hoisted ambient and sun uniforms', kind: 'terrain', stage: 'fs', marker: 'uniform vec3 uAmb0;', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the shadow tile bounds (near/far cascades)', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowB;', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the near shadow tile as a transform of the far tile\'s light space', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowN;', min: 6 },
  { script: SHADERS, name: 'terrain vertex shaders pass position and layer class to the FS in one varying (vTcP)', kind: 'terrain', stage: 'vs', marker: 'out vec4 vTcP;', min: 7 },
  { script: SHADERS, name: 'terrain fragment shaders read the one vTcP varying', kind: 'terrain', stage: 'fs', marker: 'in vec4 vTcP;', min: 6 },
  { script: SHADERS, name: 'lit terrain fragment shaders take block light from the game\'s own lightmap()', kind: 'terrain', stage: 'fs', marker: 'lightmap(vec2(0.0, vLight.y)) - uTcLm0', min: 3 },
  { script: SHADERS, name: 'no terrain vertex shader has a flat varying (our old flat vCls cost ~2.3 ms per frame at rd 12 on ANGLE/D3D11)', kind: 'terrain', stage: 'vs', marker: 'flat ', max: 0 },
  { script: SHADERS, name: 'no terrain fragment shader has a flat varying', kind: 'terrain', stage: 'fs', marker: 'flat ', max: 0 },
  // 1.5.1: the layer is 9 bits from build 6b3963e444 (the layers >= 256 runtime check proves which decode a build got).
  // tcLayer exists on both forms. 7 game terrain VS + the 2 cutout shadow VS; the depth-only shadow VS has no layer.
  { script: SHADERS, name: 'terrain and cutout shadow vertex shaders read the layer through tcLayer', kind: 'terrain', stage: 'vs', marker: 'int tcLayer = int(aInfo.x', min: 9 },
  { script: SHADERS, name: 'sky shaders patched', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkySun;', min: 2 },
  { script: SHADERS, name: 'sky shaders get the hoisted sun-glow colour', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkyGlow;', min: 2 },
  { script: SHADERS, name: 'cloud shader patched', kind: 'cloud', stage: 'fs', marker: 'uniform vec3 uCloudTint;', min: 1,
    known: 'patchCloud() regexes are double-escaped ("\\\\s" instead of "\\s"), so they never match and clouds are never patched' },
];
