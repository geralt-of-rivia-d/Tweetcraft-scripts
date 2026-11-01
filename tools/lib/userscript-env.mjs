// Run userscripts in a Playwright page the way Tampermonkey would. Used by smoke.mjs and probe.mjs.
import { TARGETS } from './common.mjs';

/**
 * Run a userscript roughly the way Tampermonkey does:
 *  - only in frames whose URL fits its @match / @exclude (and not in iframes with @noframes);
 *    on staging, URLs are compared as if they were on the production host
 *  - at document-start once <html> exists (Playwright init scripts run slightly earlier)
 *  - inside its own function scope, with GM_info and whichever common GM_* APIs it @grants
 * Everything before the source sits on line 1, so error line numbers match the file.
 */
export function wrapUserscript(s, { pageOrigin, matchOrigin = new URL(TARGETS.prod).origin } = {}) {
  const glob = p => '^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
  const match = JSON.stringify(s.meta.all('match').map(glob));
  const exclude = JSON.stringify(s.meta.all('exclude').map(glob));
  const noframes = s.meta.all('noframes').length > 0;
  const href = pageOrigin && pageOrigin !== matchOrigin
    ? `location.href.replace(${JSON.stringify(pageOrigin)}, ${JSON.stringify(matchOrigin)})`
    : 'location.href';
  const guard = `const __h = ${href}; if (!${match}.some(r => new RegExp(r).test(__h)) || ${exclude}.some(r => new RegExp(r).test(__h))${noframes ? ' || window.top !== window' : ''}) return;`;
  const body = wrapScope(s);
  return `(function () { ${guard} const __run = () => { ${body.head} ${s.source}\n${body.tail} }; if (document.documentElement) __run(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); __run(); } }).observe(document, { childList: true }); })();`;
}

function wrapScope(s) {
  const grants = new Set(s.meta.all('grant'));
  const info = JSON.stringify({ script: { name: s.meta.get('name'), version: s.meta.get('version'), namespace: s.meta.get('namespace') }, scriptHandler: 'tweetcraft-scripts test harness', version: '0' });
  const key = `__gm:${s.meta.get('namespace')}/${s.meta.get('name')}:`;
  const shims = [`const GM_info = ${info};`];
  if (grants.has('unsafeWindow')) shims.push('const unsafeWindow = window;');
  if (grants.has('GM_addStyle')) shims.push('const GM_addStyle = css => { const st = document.createElement("style"); st.textContent = css; (document.head || document.documentElement).appendChild(st); return st; };');
  if (grants.has('GM_getValue')) shims.push(`const GM_getValue = (k, d) => { const v = localStorage.getItem(${JSON.stringify(key)} + k); return v === null ? d : JSON.parse(v); };`);
  if (grants.has('GM_setValue')) shims.push(`const GM_setValue = (k, v) => localStorage.setItem(${JSON.stringify(key)} + k, JSON.stringify(v));`);
  if (grants.has('GM_deleteValue')) shims.push(`const GM_deleteValue = k => localStorage.removeItem(${JSON.stringify(key)} + k);`);
  if (grants.has('GM_listValues')) shims.push(`const GM_listValues = () => Object.keys(localStorage).filter(k => k.startsWith(${JSON.stringify(key)})).map(k => k.slice(${key.length}));`);
  return { head: `(function () { ${shims.join(' ')}`, tail: '}).call(window);' };
}
