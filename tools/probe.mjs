#!/usr/bin/env node
// Evaluate a JavaScript expression inside the live game (headless Chrome) and print the result.
// The expression may use `await`. It runs after the game has booted and linked its shaders.
//
//   npm run probe -- "Object.keys(await import('/js/menus.js'))"
//   npm run probe -- --scripts "window.Twitterentary.debug()"       # with every userscript loaded
//   npm run probe -- --only shaders "window.Twitterentary.cfg"      # with matching userscripts only
//   npm run probe -- --target staging --wait 5000 "document.title"  # extra wait before evaluating (ms)
//   npm run probe -- --programs                                     # list the linked shader programs
//   npm run probe -- --headed ...                                   # watch it in a visible window
import { parseArgs } from 'node:util';
import { listUserscripts, targetUrl, c } from './lib/common.mjs';
import { launchBrowser, openGame, readPrograms, labelProgram } from './lib/browser.mjs';
import { wrapUserscript } from './lib/userscript-env.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    target: { type: 'string', default: 'prod' },
    scripts: { type: 'boolean', default: false },
    only: { type: 'string', multiple: true },
    headed: { type: 'boolean', default: false },
    wait: { type: 'string', default: '0' },
    programs: { type: 'boolean', default: false },
  },
});
const expr = positionals.join(' ').trim();
if (!expr && !opts.programs) {
  console.log('Usage: npm run probe -- [--scripts | --only <name>] [--target staging] [--wait ms] [--programs] "<expression>"');
  process.exit(1);
}

const url = targetUrl(opts.target);
let scripts = [];
if (opts.scripts || opts.only?.length) {
  const all = await listUserscripts();
  scripts = opts.only?.length ? all.filter(s => opts.only.some(o => s.file.includes(o))) : all;
}
console.error(c.dim(`Opening ${url}${scripts.length ? ` with ${scripts.map(s => s.file).join(', ')}` : ' (no userscripts)'} ...`));

const browser = await launchBrowser({ headed: opts.headed });
let exitCode = 0;
try {
  const { page, consoleMsgs } = await openGame(browser, url, {
    userscripts: scripts.map(s => ({ file: s.file, source: wrapUserscript(s, { pageOrigin: new URL(url).origin }) })),
  });
  if (Number(opts.wait) > 0) await page.waitForTimeout(Number(opts.wait));

  if (opts.programs) {
    for (const p of await readPrograms(page)) {
      console.log(`#${String(p.id).padStart(2)} ${labelProgram(p).padEnd(12)} linked=${p.linked}  vs ${p.vs?.source.length ?? 0}B  fs ${p.fs?.source.length ?? 0}B`);
    }
  }
  if (expr) {
    const json = await page.evaluate(`(async () => {
      const seen = new WeakSet();
      const v = await (${expr});
      return JSON.stringify(v, (k, x) => {
        if (typeof x === 'function') return '[function ' + (x.name || 'anonymous') + ']';
        if (typeof x === 'bigint') return x.toString();
        if (ArrayBuffer.isView(x)) return Array.from(x);
        if (x instanceof Map) return Object.fromEntries(x);
        if (x instanceof Set) return [...x];
        if (x instanceof Element) return '<' + x.tagName.toLowerCase() + (x.id ? '#' + x.id : '') + '>';
        if (x && typeof x === 'object') { if (seen.has(x)) return '[circular]'; seen.add(x); }
        return x;
      }, 2);
    })()`);
    console.log(json === undefined ? 'undefined' : json);
  }
  const errors = consoleMsgs.filter(m => m.type === 'error' && m.url.startsWith('userscript:///'));
  for (const m of errors) console.error(c.yellow(`[${m.url.slice(14)}] ${m.text.split('\n')[0]}`));
} catch (e) {
  console.error(c.red(e.message.split('\n')[0]));
  exitCode = 1;
} finally {
  await browser.close();
}
process.exit(exitCode);
