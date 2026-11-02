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
  'js/survival/chesticons.js', 'js/survival/crack.js', 'js/survival/enchantfx.js', 'js/survival/grace.js'];
// Texture units 6 and up are never used: no TEXTURE6+ constant, no TEXTURE0 + computed unit (only + 0-5),
// no sampler set to 6+ by uniform1i or a { uName: n } sampler map.
const FREE_UNITS = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\bTEXTURE0\s*\+(?!\s*[0-5]\b))(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})/;
// entities/index.js computes its unit in one helper, texture(gl, unit, ...): allowed there, if every call passes 0-5.
const FREE_UNITS_ENTITIES = /^(?![\s\S]*\bTEXTURE(?:[6-9]|[1-9]\d)\b)(?![\s\S]*\.uniform1i\([^,()]+,\s*(?:[6-9]|[1-9]\d)\s*\))(?![\s\S]*\{\s*u\w+\s*:\s*(?:[6-9]|[1-9]\d)\s*\})(?=[\s\S]*\bfunction\s+(\w+)\(\s*(\w+)\s*,\s*(\w+)\s*,[^)]*\)\s*\{[^}]*?\.activeTexture\(\s*\2\.TEXTURE0\s*\+\s*\3\s*\))(?![\s\S]*\bTEXTURE0\s*\+(?!\s*(?:\3|[0-5])\b))(?![\s\S]*(?<!function\s+)\b\1\(\s*\2\s*,(?!\s*[0-5]\s*,))/;
// No enable(POLYGON_OFFSET_FILL) reaches a draw call without its own polygonOffset() (right before or after the enable).
const OWN_POLYGON_OFFSET = /^(?![\s\S]*?\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\)(?<!\.polygonOffset\([^)]*\)\s*;\s*\w+\.enable\(\s*\w+\.POLYGON_OFFSET_FILL\s*\))(?:(?!\.polygonOffset\(|\.draw(?:Elements|Arrays)\w*\()[\s\S])*?\.draw(?:Elements|Arrays)\w*\()/;
// No render-to-texture and no colour clear (gfx.js, which owns the frame's clear, has its own entry).
const NO_FBO_NO_CLEAR = /^(?![\s\S]*\.bindFramebuffer\()(?![\s\S]*\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/;

export const source = [
  // --- Twitterentary shaders: GLSL anchors used by patchSource() and the patch* functions
  { script: SHADERS, file: 'shaders:vs', test: /aPos\s*&\s*uvec3/, why: 'terrain vertex shader is recognised by "aPos & uvec3"' },
  { script: SHADERS, file: 'shaders:vs', test: 'uniform vec3 uOrigin;', why: 'terrain VS: extra uniforms are inserted after uOrigin' },
  { script: SHADERS, file: 'shaders:vs', test: 'out vec2 vLight;', why: 'terrain VS: vRel/vCls varyings are added after vLight' },
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
  { script: SHADERS, file: 'js/gfx.js', test: /\bpass\(\s*\w+\s*,\s*(\w+)\s*,\s*(\w+)\s*,[^)]*\)\s*\{[\s\S]{0,800}?for\s*\(\s*const\s+(\w+)\s+of\s+\1\s*\)\s*\{\s*const\s+(\w+)\s*=\s*\3\.parts\[\s*\2\s*\]\s*;\s*if\s*\(\s*!\4\s*\|\|\s*!\4\.n\s*\)\s*continue\s*;[^}]*?\.bindVertexArray\(\s*\4\.vao\s*\)\s*;\s*\w+\.drawElements\(\s*\w+\.TRIANGLES\s*,\s*\4\.n\s*\*\s*6\b/, why: 'pass() skips a chunk part whose mesh is empty (!q.n) and otherwise draws q.n*6 indices from q.vao: an empty part is simply not drawn, which is how the shadow records notice it' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.pass\(\s*(\w+)\[\s*0\s*\]\s*,\s*(\w+)\s*,\s*0\s*,[^;]*;\s*this\.pass\(\s*\1\[\s*1\s*\]\s*,\s*\2\s*,\s*1\s*,/, why: 'pass 0 (opaque) and pass 1 (cutout) draw the same visible-chunk list back to back: a column drawn in pass 0 whose pass-1 part is not drawn has an empty part, so its shadow record is dropped' },
  { script: SHADERS, file: 'js/gfx.js', test: /\bdropChunk\(\s*\w+\s*\)\s*\{[\s\S]{0,200}?for\s*\(\s*const\s+(\w+)\s+of\s+\w+\.parts\s*\)\s*if\s*\(\s*\1\s*\)\s*\{\s*this\.gl\.deleteVertexArray\(\s*\1\.vao\s*\)/, why: 'unloading a chunk (dropChunk) deletes its part VAOs: the deleteVertexArray hook drops their shadow records and marks the map dirty' },
  { script: SHADERS, file: 'js/gfx.js', test: /\banimateLayer\(\s*\w+(?:\s*,\s*\w+)*\s*\)\s*\{[\s\S]{0,800}?\.activeTexture\(\s*\w+\.TEXTURE0\s*\)\s*;\s*\w+\.bindTexture\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*this\.tArr\s*\)\s*;(?:(?!\.(?:activeTexture|bindTexture)\()[\s\S]){0,200}?\.texSubImage3D\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*\w+\s*,\s*0\s*,\s*0\s*,\s*\w+\s*,/, why: 'atlas animation (water, lava, fire, portals) is texSubImage3D(TEXTURE_2D_ARRAY, level, 0, 0, layer) on the atlas on unit 0, never units 6/7: once block names are known the hook ignores it (no reclassify, no shadow refresh)' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.clear\([^)]*\bCOLOR_BUFFER_BIT\b/, why: 'a frame is counted on clear(COLOR_BUFFER_BIT)' },
  // Main-context invariants, checked in every module that uses it (MAIN_GL above)
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: file === 'js/entities/index.js' ? FREE_UNITS_ENTITIES : FREE_UNITS, why: 'texture units 6 and 7 stay free: the shadow map and class lookup stay bound there for the whole session' })),
  ...MAIN_GL.map(file => ({ script: SHADERS, file, test: OWN_POLYGON_OFFSET, why: 'renderShadow() resets polygonOffset(0, 0) without querying it: every enable(POLYGON_OFFSET_FILL) sets its own offset before drawing (today only survival/chesticons.js)' })),
  ...MAIN_GL.filter(file => file !== 'js/gfx.js').map(file => ({ script: SHADERS, file, test: NO_FBO_NO_CLEAR, why: 'no render-to-texture and no colour clear outside gfx.js: frames are counted on the one colour clear, and the shadow pass restores the default framebuffer state it found' })),
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\.bindFramebuffer\()(?=(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){2})(?!(?:[\s\S]*?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b){3})(?=[\s\S]*\bif\s*\(\s*\w+\.wall\s*\)\s*\{\s*this\.drawWall\([^)]*\)\s*;\s*return\s*;?\s*\}(?:(?!\.clear\()[\s\S]){0,1500}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)(?=[\s\S]*\bdrawWall\([^)]*\)\s*\{[^}]{0,300}?\.clear\([^)]*\bCOLOR_BUFFER_BIT\b)/, why: 'one colour clear per frame on the main context, no render-to-texture: draw() clears once, or hands the frame to drawWall() (which clears) and returns. frameId, the camFrame gate and the blind LEQUAL/depthMask(true) restore all assume this' },
  { script: SHADERS, file: 'js/dragonview.js', test: /\bfunction dragonView\(\s*(\w+)[^)]*\)\s*\{\s*const\s+\w+\s*=\s*\1\.getContext\(\s*["']webgl2["']/, why: 'the dragon view renders on its own canvas and WebGL2 context, so its colour clear is not counted as a frame (only the context that first uses a patched program is)' },
  { script: SHADERS, file: 'js/main.js', test: /loadTiles\(\s*\w+\.texNames\s*\)[\s\S]{0,200}?\.texNames\.indexOf\(\s*["']oak_planks["']\s*\)[\s\S]{0,200}?\.setTiles\(/, why: 'the list searched for "oak_planks" is texNames, the same list that orders the atlas layers passed to setTiles' },
  { script: SHADERS, file: 'engine.wasm', test: /^(?=[\s\S]*oak_leaves)(?=[\s\S]*water_still)(?=[\s\S]*short_grass)(?=[\s\S]*glowstone)/, why: 'layers are classified by texture name (*leaves*, water*, the plant list, the emissive list)' },
  { script: SHADERS, file: 'js/main.js', test: /^(?![\s\S]*["']KeyK["'])/, why: 'K (the shader toggle) is not a game key' },

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
  { script: OPTIONS, file: 'index.html', test: 'id="inv"', why: 'invClosed() looks for #inv' },
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
  // "Reset all options" turns the HUD back on only if it is really off (our saved flag can be stale): it reads #hudtop
  { script: OPTIONS, file: 'index.html', test: 'id="hudtop"', why: 'the in-world HUD bar is #hudtop' },
  { script: OPTIONS, file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*[\w$.]+\(\s*["']#hudtop["']\s*\))(?=[\s\S]*\bfunction updateTop\(\)\s*\{\s*const\s+(\w+)\s*=[^;]*\w+\.started\b[^;]*!\w+\.menu\b[^;]*;\s*\1\.hidden\s*=\s*!\(\s*\2\s*&&\s*\w+\.showHud\s*\))/, why: 'updateTop() sets #hudtop.hidden = !(in a world with no menu open && S.showHud): with no menu open, a hidden #hudtop means the HUD is off' },
  { script: OPTIONS, file: 'js/menus.js', test: /\bfunction closeMenu\(\)\s*\{(?:(?!\bfunction\b)[\s\S]){0,400}?\.menu\s*=\s*null(?:(?!\bfunction\b)[\s\S]){0,300}?\b\w+\.updateTop\(\)/, why: 'closeMenu() clears S.menu and then runs updateTop(), so #hudtop.hidden is current right after it' },

  // --- Chat history
  { script: CHAT, file: 'index.html', test: 'id="chatbox"', why: 'history attaches to the #chatbox input' },
  { script: CHAT, file: 'index.html', test: /<input\b(?=[^>]*\sid=["']chatbox["'])(?=[^>]*\shidden[\s=/>])[^>]*>/, why: '#chatbox is an <input> (value, setSelectionRange), hidden while chat is closed' },
  { script: CHAT, file: 'js/main.js', test: /^(?=[\s\S]*\b(\w+)\s*=\s*[\w$.]+\(\s*["']#chatbox["']\s*\))(?=[\s\S]*\.chatOpen\s*=\s*true\s*;[^}]*?\b\1\.hidden\s*=\s*false)(?=[\s\S]*\.chatOpen\s*=\s*false\s*;[^}]*?\b\1\.hidden\s*=\s*true)/, why: 'chat opens by setting S.chatOpen = true and then #chatbox.hidden = false, and closes with chatOpen = false and, after resetting its IME and opacity state, hidden = true: chatOpen() reads #chatbox.hidden' },
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
      // fixed, so nothing but chunks entering the view (dirty) and the 2 s safety net (age) may refresh it.
      const w0 = Object.assign({}, S.why), f0 = st.frame, r0 = S.refreshes, t0 = performance.now();
      await new Promise(r => setTimeout(r, 4000));
      // software GL (SwiftShader) renders only a few frames a second (about 4.5 locally), so wait for 48 frames, up to 30 s
      while (st.frame - f0 < 48 && performance.now() - t0 < 30000) await new Promise(r => setTimeout(r, 250));
      const ms = performance.now() - t0, frames = st.frame - f0, n = S.refreshes - r0, d = {};
      for (const k of Object.keys(S.why)) d[k] = (S.why[k] || 0) - (w0[k] || 0);
      const every = Math.max(1, Math.round(Number(T.cfg.shadowEvery)) || 1);
      const info = `${n} refreshes in ${(ms / 1000).toFixed(1)} s / ${frames} frames, by reason ${JSON.stringify(d)}`;
      if (frames < 48) return `can't verify: only ${frames} frames rendered in ${(ms / 1000).toFixed(1)} s (${info})`;
      if (d.move !== 0) return `refreshed for camera movement, but the title camera only turns: ${info}`;
      if (d.sun !== 0) return `refreshed for sun movement, but the title world's sun is fixed: ${info}`;
      if (!(d.age <= Math.floor(ms / 2000) + 1)) return `more safety-net (age) refreshes than one per 2 s: ${info}`;
      return n <= frames / every + 2 || `more refreshes than the limit of one per ${every} frames (shadowEvery): ${info}`;
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
      const SEED = { 'ui.scale': 1.5, 'input.sens': 2, 'zoom.level': 8, 'zoom.key': 'KeyX' };
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
  // script's 2 shadow-map programs; the depth-only one has no uClsTex, so 8 of the 9 carry the VS marker.
  { script: SHADERS, name: 'terrain vertex shaders patched', kind: 'terrain', stage: 'vs', marker: 'uniform highp sampler2D uClsTex;', min: 8 },
  { script: SHADERS, name: 'terrain fragment shaders patched', kind: 'terrain', stage: 'fs', marker: 'dFdx(vRel)', min: 6 },
  { script: SHADERS, name: 'terrain fragment shaders get the shadow parameters as a uniform (live resolution/range)', kind: 'terrain', stage: 'fs', marker: 'uniform vec4 uShadowP;', min: 6 },
  { script: SHADERS, name: 'sky shaders patched', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkySun;', min: 2 },
  { script: SHADERS, name: 'cloud shader patched', kind: 'cloud', stage: 'fs', marker: 'uniform vec3 uCloudTint;', min: 1,
    known: 'patchCloud() regexes are double-escaped ("\\\\s" instead of "\\s"), so they never match and clouds are never patched' },
];
