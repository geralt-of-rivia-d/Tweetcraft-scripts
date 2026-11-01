// Fetch the game's client code (HTML, CSS and the full ES module graph) and analyse modules.
import * as acorn from 'acorn';
import * as walk from 'acorn-walk';

const UA = 'Mozilla/5.0 (compatible; tweetcraft-scripts-snapshot)';

/**
 * Bump when the crawler starts collecting a different set of files. The build id hashes every collected
 * file, so a crawler change alone would look like a game update; snapshot.mjs uses this to tell them apart.
 */
export const CRAWLER_VERSION = 2; // 2: + JSON data files fetched by literal path

/** Fetch with retries. A 404 is final (err.status = 404); network errors and other statuses are retried. */
async function fetchBody(url, as = 'text', tries = 4) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA }, redirect: 'follow' });
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status} for ${url}`), { status: res.status });
      return as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      lastErr = e;
      if (e.status === 404) break;
      await new Promise(r => setTimeout(r, 750 * (i + 1)));
    }
  }
  throw lastErr;
}
const fetchText = url => fetchBody(url, 'text');

const nameOf = n => (n.type === 'Identifier' ? n.name : String(n.value));

function patternNames(p, out) {
  if (!p) return;
  if (p.type === 'Identifier') out.add(p.name);
  else if (p.type === 'ObjectPattern') p.properties.forEach(q => patternNames(q.type === 'RestElement' ? q.argument : q.value, out));
  else if (p.type === 'ArrayPattern') p.elements.forEach(q => patternNames(q, out));
  else if (p.type === 'RestElement') patternNames(p.argument, out);
  else if (p.type === 'AssignmentPattern') patternNames(p.left, out);
}

const staticString = n =>
  n?.type === 'Literal' && typeof n.value === 'string' ? n.value
  : n?.type === 'TemplateLiteral' && n.expressions.length === 0 ? n.quasis[0].value.cooked
  : null;

/** Imports (static, dynamic, new URL(..., import.meta.url), workers) and export names of an ES module. */
export function analyzeModule(src) {
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true });
  } catch (e) {
    // Fall back to a regex scan so one odd file can't stop the crawl.
    const imports = [...src.matchAll(/\b(?:from|import)\s*\(?\s*(["'`])([^"'`$]+?\.m?js)\1/g)].map(m => m[2]);
    return { imports: [...new Set(imports)], dynamic: [], exports: [], parseError: e.message };
  }
  const imports = new Set();
  const dynamic = new Set(); // subset of imports loaded lazily via import()
  const exports = new Set();
  for (const node of ast.body) {
    if (node.type === 'ImportDeclaration') imports.add(node.source.value);
    else if (node.type === 'ExportAllDeclaration') {
      imports.add(node.source.value);
      exports.add(node.exported ? nameOf(node.exported) : `* from ${node.source.value}`);
    } else if (node.type === 'ExportNamedDeclaration') {
      if (node.source) imports.add(node.source.value);
      const d = node.declaration;
      if (d?.id) exports.add(d.id.name);
      else if (d?.declarations) d.declarations.forEach(v => patternNames(v.id, exports));
      for (const s of node.specifiers) exports.add(nameOf(s.exported));
    } else if (node.type === 'ExportDefaultDeclaration') exports.add('default');
  }
  walk.simple(ast, {
    ImportExpression(n) {
      const s = staticString(n.source);
      if (s) { imports.add(s); dynamic.add(s); }
    },
    NewExpression(n) {
      const callee = n.callee.type === 'Identifier' ? n.callee.name : null;
      const first = staticString(n.arguments[0]);
      if (!first) return;
      const second = n.arguments[1];
      const isMetaUrl = second?.type === 'MemberExpression' && second.object.type === 'MetaProperty' && second.property.name === 'url';
      if ((callee === 'URL' && isMetaUrl && /\.m?js$/.test(first)) || callee === 'Worker' || callee === 'SharedWorker') imports.add(first);
    },
  });
  return { imports: [...imports], dynamic: [...dynamic], exports: [...exports].sort() };
}

/** Local path used inside a snapshot for a URL on the game's origin. */
export function pathFor(url) {
  const p = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, '');
  return p === '' || p.endsWith('/') ? p + 'index.html' : p;
}

/**
 * Download index.html, its stylesheets and every JS module reachable from its module scripts.
 * Returns { files: Map<path, text>, modules: Map<path, {imports, exports, parseError?}> }.
 */
export async function crawlGame(baseUrl, { log = () => {} } = {}) {
  const origin = new URL(baseUrl).origin;
  const files = new Map();
  const modules = new Map();

  const html = await fetchText(origin + '/');
  files.set('index.html', html);

  const entries = [];
  for (const [tag] of html.matchAll(/<(?:script|link)\b[^>]*>/gi)) {
    const attr = name => tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
    const src = attr('src') || attr('href');
    if (!src) continue;
    const url = new URL(src, origin + '/');
    if (url.origin !== origin) continue;
    const rel = (attr('rel') || '').toLowerCase();
    if (/^link/i.test(tag.slice(1)) && rel === 'stylesheet') entries.push({ url, kind: 'css' });
    else if (rel === 'modulepreload' || /type\s*=\s*["']module["']/i.test(tag)) entries.push({ url, kind: 'module' });
  }

  for (const e of entries.filter(e => e.kind === 'css')) {
    files.set(pathFor(e.url.href), await fetchText(e.url.href));
  }

  const queue = entries.filter(e => e.kind === 'module').map(e => e.url.href);
  const seen = new Set();
  while (queue.length) {
    const batch = queue.splice(0, 8).filter(u => !seen.has(u));
    batch.forEach(u => seen.add(u));
    await Promise.all(batch.map(async href => {
      const path = pathFor(href);
      const src = await fetchText(href);
      files.set(path, src);
      const info = analyzeModule(src);
      if (info.parseError) log(`  could not parse ${path} (${info.parseError}); used a regex scan for its imports`);
      modules.set(path, info);
      for (const spec of info.imports) {
        if (!/^[./]/.test(spec)) continue; // bare specifiers can't be fetched by a browser either
        const next = new URL(spec, href);
        if (next.origin === origin && !seen.has(next.href)) queue.push(next.href);
      }
    }));
  }
  // Data the game fetches by literal path: JSON (atlas layouts, sound events: so a script that reads
  // their format can anchor on it) and WebAssembly (the world engine: "/engine.wasm"). Wasm is stored
  // as a Buffer; its export names go into `modules` so export changes show up in the change report.
  const wasmRefs = new Set(), jsonRefs = new Set();
  for (const [path, src] of files) {
    if (!path.endsWith('.js')) continue;
    for (const m of src.matchAll(/["'`]((?:\.{0,2}\/)?[\w./-]+\.(wasm|json))["'`]/g)) {
      const u = new URL(m[1], m[1].startsWith('.') ? `${origin}/${path}` : origin + '/');
      if (u.origin !== origin || u.pathname.startsWith('/api/')) continue;
      if (m[2] === 'wasm') wasmRefs.add(u.href);
      else if (m[1].includes('/')) jsonRefs.add(u.href); // bare "x.json" names are keys or relative to a runtime base

    }
  }
  // A file the server doesn't have (404) is skipped. Any other failure aborts the snapshot: silently
  // dropping a file after a network blip would change the build id and look like a game update.
  for (const href of [...jsonRefs].sort()) {
    let text;
    try {
      text = await fetchText(href);
    } catch (e) {
      if (e.status === 404) { log(`  skipped ${href}: 404`); continue; }
      throw new Error(`could not fetch ${href}: ${e.message}`);
    }
    try {
      JSON.parse(text); // only keep real JSON (a 200 HTML fallback page would be noise)
      files.set(pathFor(href), text);
    } catch {
      log(`  skipped ${href}: not JSON`);
    }
  }
  for (const href of [...wasmRefs].sort()) {
    let buf;
    try {
      buf = await fetchBody(href, 'buffer');
    } catch (e) {
      if (e.status === 404) { log(`  skipped ${href}: 404`); continue; }
      throw new Error(`could not fetch ${href}: ${e.message}`);
    }
    const path = pathFor(href);
    files.set(path, buf);
    try {
      const mod = new WebAssembly.Module(buf);
      modules.set(path, {
        imports: [],
        dynamic: [],
        exports: WebAssembly.Module.exports(mod).map(e => (e.kind === 'function' ? e.name : `${e.name} (${e.kind})`)).sort(),
        wasm: true,
      });
    } catch (e) {
      log(`  could not parse ${href} as WebAssembly: ${e.message}`);
    }
  }
  return { files, modules };
}
