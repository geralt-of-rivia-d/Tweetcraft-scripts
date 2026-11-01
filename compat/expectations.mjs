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
  { script: SHADERS, file: 'js/gfx.js', test: /\.activeTexture\(\s*\w+\.TEXTURE0\s*\)\s*;\s*\w+\.bindTexture\(\s*\w+\.TEXTURE_2D_ARRAY\s*,\s*this\.tArr\s*\)/, why: 'the atlas is on texture unit 0 during terrain passes; the shadow FS samples uTex = 0' },
  { script: SHADERS, file: 'js/gfx.js', test: /\.clear\([^)]*\bCOLOR_BUFFER_BIT\b/, why: 'a frame is counted on clear(COLOR_BUFFER_BIT)' },
  { script: SHADERS, file: 'js/gfx.js', test: /^(?![\s\S]*\bTEXTURE[67]\b)(?![\s\S]*\{\s*u\w+\s*:\s*[67]\s*\})/, why: 'texture units 6 and 7 stay free: the shadow map and class lookup stay bound there' },
  { script: SHADERS, file: 'js/entities/index.js', test: /^(?![\s\S]*\bTEXTURE[67]\b)(?![\s\S]*\btexture\(\s*\w+\s*,\s*[67]\s*,)(?![\s\S]*\.uniform1i\([^,()]+,\s*[67]\s*\))/, why: 'texture units 6 and 7 stay free: the shadow map and class lookup stay bound there' },
  { script: SHADERS, file: 'js/main.js', test: /loadTiles\(\s*\w+\.texNames\s*\)[\s\S]{0,200}?\.texNames\.indexOf\(\s*["']oak_planks["']\s*\)[\s\S]{0,200}?\.setTiles\(/, why: 'the list searched for "oak_planks" is texNames, the same list that orders the atlas layers passed to setTiles' },
  { script: SHADERS, file: 'engine.wasm', test: /^(?=[\s\S]*oak_leaves)(?=[\s\S]*water_still)(?=[\s\S]*short_grass)(?=[\s\S]*glowstone)/, why: 'layers are classified by texture name (*leaves*, water*, the plant list, the emissive list)' },
  { script: SHADERS, file: 'js/main.js', test: /^(?![\s\S]*["']KeyK["'])/, why: 'K (the shader toggle) is not a game key' },

  // --- Better Options (and Zoom, which reuses its FOV plumbing)
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', exports: ['openOptions', 'closeMenu'], why: 'opens the Options screen to reach the FOV slider' },
  { script: OPTIONS, file: 'js/menus.js', exports: ['openPause', 'showScreen', 'back', 'refresh'], why: 'shows its own screen and drives the pause menu' },
  { script: OPTIONS, file: 'js/ui.js', exports: ['Hud'], why: 'HUD scaling wraps Hud.prototype.draw/suggestions/tab/hint' },
  { script: OPTIONS, file: 'js/survival/client.js', exports: ['SurvivalClient'], why: 'HUD scaling wraps SurvivalClient.prototype.drawHud' },
  { script: [OPTIONS, ZOOM], file: 'js/menus.js', test: /["']data-k["']\s*:\s*["']fov["']/, why: 'the FOV slider is found as input[type=range][data-k="fov"]' },
  { script: OPTIONS, file: 'js/menus.js', test: 'Options…', why: 'clicks on the "Options…" button are redirected to the custom menu' },
  { script: OPTIONS, file: 'js/menus.js', test: 'Distance:', why: 'render distance is set by clicking button[aria-label^="Distance:"] in the pause menu' },
  { script: OPTIONS, file: 'js/main.js', test: /["']F1["']/, why: 'the HUD toggle sends an F1 key press' },
  { script: [OPTIONS, ZOOM], file: 'js/main.js', test: 'mc.fov', why: 'FOV is read from localStorage "mc.fov"' },
  { script: OPTIONS, file: 'js/main.js', test: 'mc.rd', why: 'render distance is read from localStorage "mc.rd"' },
  { script: OPTIONS, file: 'style.css', test: 'var(--u)', why: 'UI scale works by overriding the --u CSS variable' },
  { script: OPTIONS, file: 'style.css', test: 'var(--d)', why: 'UI scale works by overriding the --d CSS variable' },
  { script: OPTIONS, file: 'js/ui.js', test: 'mcb', why: 'button labels are rescaled via button.mcb' },
  { script: [OPTIONS, ZOOM], file: 'index.html', test: 'id="gl"', why: 'the game canvas is #gl' },
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
  { script: OPTIONS, file: 'js/menus.js', test: /fullscreenElement\s*\?\s*["']Exit Fullscreen["']\s*:\s*["']Fullscreen["']/, why: 'the pause menu\'s button[aria-label="Fullscreen" / "Exit Fullscreen"] is hidden (now in our menu)' },
  { script: OPTIONS, file: 'js/menus.js', test: /`Distance: \$\{\s*\w+\.rd\s*\}`\s*,\s*\w+\.cycleRd\b/, why: 'the Distance button\'s label holds the current render distance and a click cycles it: setRenderDistance() clicks until it matches' },
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

  // --- Chat history
  { script: CHAT, file: 'index.html', test: 'id="chatbox"', why: 'history attaches to the #chatbox input' },
  { script: CHAT, file: 'index.html', test: /<input id="chatbox"[^>]*\shidden[\s>]/, why: '#chatbox is an <input> (value, setSelectionRange), hidden while chat is closed' },
  { script: CHAT, file: 'js/main.js', test: /^(?=[\s\S]*\.chatOpen\s*=\s*true\s*;[^}]*?\.hidden\s*=\s*false)(?=[\s\S]*\.chatOpen\s*=\s*false\s*;\s*\w+\.hidden\s*=\s*true)/, why: 'chat opens and closes by toggling #chatbox.hidden (chatOpen() reads it)' },
  { script: CHAT, file: 'js/main.js', test: /\.chatOpen\s*\)\s*\{\s*if\s*\(\s*\w+\.key\(\s*\w+\s*\)\s*\)\s*\w+\.preventDefault\(\)\s*;\s*else\s+if\s*\(\s*\w+\.key\s*===\s*["']Enter["']\s*\)/, why: 'chat is sent on keydown Enter (recorded first in our capture listener); the suggestion list claims keys with preventDefault' },
  { script: CHAT, file: 'js/chat-suggest.js', test: /\.key\s*===\s*["']ArrowUp["']\s*\|\|\s*\w+\.key\s*===\s*["']ArrowDown["']/, why: 'the suggestion list uses Up/Down while shown; history steps aside when the event is defaultPrevented' },

  // --- The smoke test itself: runtime checks below wait for this flag before testing a loaded world
  { script: [SHADERS, OPTIONS, ZOOM], file: 'js/main.js', test: /window\.__ready\s*=\s*(?:true|!0)/, why: 'the game sets window.__ready = true once the world has loaded; runtime checks wait for it' },
];

// Runtime checks that need a loaded world wait for the game's own flag first, and say so if it never comes.
// (run() executes inside the page, so it cannot use constants from this module.)

export const runtime = [
  { script: OPTIONS, name: 'settings bus window.__tcOptions is available',
    run: () => (window.__tcOptions && typeof window.__tcOptions.register === 'function') || 'window.__tcOptions.register missing' },
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
];

export const shaders = [
  // Counts include the shader script's own shadow-map program (built from the terrain shader).
  { script: SHADERS, name: 'terrain vertex shaders patched', kind: 'terrain', stage: 'vs', marker: 'uniform highp sampler2D uClsTex;', min: 8 },
  { script: SHADERS, name: 'terrain fragment shaders patched', kind: 'terrain', stage: 'fs', marker: 'dFdx(vRel)', min: 6 },
  { script: SHADERS, name: 'sky shaders patched', kind: 'sky', stage: 'fs', marker: 'uniform vec3 uSkySun;', min: 2 },
  { script: SHADERS, name: 'cloud shader patched', kind: 'cloud', stage: 'fs', marker: 'uniform vec3 uCloudTint;', min: 1,
    known: 'patchCloud() regexes are double-escaped ("\\\\s" instead of "\\s"), so they never match and clouds are never patched' },
];
