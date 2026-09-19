/* Load every page the way a browser would and report what breaks.
 *
 * A dead button is visible; a page that throws halfway through rendering is
 * not - it just leaves widgets showing their placeholder text, which reads
 * as "the data didn't load" rather than as a bug. This loads each page
 * against the live API and reports three things that cause that: uncaught
 * errors, requests that came back non-2xx, and widgets still sitting on
 * their placeholder after boot has finished.
 *
 *   py -m uvicorn vinhack.main:app --port 8010
 *   node tests/pagehealth.mjs
 */
import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require(process.env.VINHACK_JSDOM || 'jsdom'));
} catch {
  console.error('Could not load jsdom. cd tests && npm install');
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const ORIGIN = process.env.VINHACK_ORIGIN || 'http://127.0.0.1:8010';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Text the pages ship with, meaning "nothing has replaced me yet". */
const PLACEHOLDER = /^(--|-|0|0%|0h|\.\.\.|loading)$/i;

async function check(page) {
  const html = readFileSync(join(FRONTEND, page), 'utf8')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>/g, '')
    .replace(/<script id="tailwind-config">[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '');

  const errors = [];
  const bad = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const first = e.message.split('\n')[0];
    if (!/Not implemented/.test(first)) errors.push(first);
  });
  vc.on('error', (...a) => errors.push(a.map(String).join(' ').slice(0, 160)));

  const dom = new JSDOM(html, {
    url: ORIGIN + '/' + page,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('vinhack.student', '1');
  window.Element.prototype.scrollIntoView = function () {};

  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).toString() : input.url;
    const res = await fetch(url, init);
    const body = await res.text();
    if (!res.ok) bad.push(res.status + ' ' + new URL(url).pathname);
    return {
      ok: res.ok, status: res.status, statusText: res.statusText,
      json: async () => JSON.parse(body), text: async () => body,
    };
  };

  for (const tag of [...window.document.querySelectorAll('script[src^="assets/"]')]) {
    window.eval(readFileSync(join(FRONTEND, tag.getAttribute('src')), 'utf8'));
  }
  await sleep(2600);

  /* Anything given an id or a data-vh hook is meant to be filled in from the
   * API. One still showing its placeholder never got there. */
  const stuck = [];
  for (const el of window.document.querySelectorAll('[data-vh], [id]')) {
    if (el.children.length) continue;
    const text = (el.textContent || '').trim();
    if (text && PLACEHOLDER.test(text)) {
      stuck.push(el.getAttribute('data-vh') || el.id);
    }
  }

  window.close();
  return { errors, bad: [...new Set(bad)], stuck };
}

const pages = readdirSync(FRONTEND).filter((f) => f.endsWith('.html')).sort();
let total = 0;

for (const page of pages) {
  const { errors, bad, stuck } = await check(page);
  const n = errors.length + bad.length;
  total += n;
  console.log('\n' + page + '  - ' + (n ? n + ' problem(s)' : 'clean'));
  for (const e of errors) console.log('    error   ' + e);
  for (const b of bad) console.log('    http    ' + b);
  if (stuck.length) {
    const head = stuck.slice(0, 12).join(', ');
    const more = stuck.length > 12 ? ' (+' + (stuck.length - 12) + ')' : '';
    console.log('    unfilled  ' + head + more);
  }
}

console.log('\n' + total + ' error(s) across ' + pages.length + ' pages');
