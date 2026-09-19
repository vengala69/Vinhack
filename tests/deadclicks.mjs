/* Find controls that do nothing when you click them.
 *
 * A button that looks clickable and isn't is the most obvious bug in a demo,
 * and no assertion-based suite catches it: tests only exercise paths they
 * already know about. Grepping for handlers does not work either, because
 * most of this app delegates from `document`, which makes every button look
 * wired.
 *
 * So this clicks them. For each control it snapshots the page - markup size,
 * element count, open overlays, requests made, location - clicks, waits, and
 * compares. A control that moves none of those did nothing, which is the
 * thing a reviewer will notice first.
 *
 *   py -m uvicorn vinhack.main:app --port 8010
 *   node tests/deadclicks.mjs            # all pages
 *   node tests/deadclicks.mjs sleep      # one page
 *
 * It clicks real buttons against the live API, so point it at a seeded dev
 * database and reseed afterwards. confirm() answers no, so deletes behind a
 * confirmation are declined rather than carried out.
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
const SKIP = new Set(['therapist.html']);      // being worked on elsewhere
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function label(el) {
  const icon = el.querySelector?.('.material-symbols-outlined')?.textContent?.trim() || '';
  let text = (el.textContent || '').replace(/\s+/g, ' ').trim();
  if (icon && text.startsWith(icon)) text = text.slice(icon.length).trim();
  return (text || el.getAttribute('aria-label') || icon || '(unlabelled)').slice(0, 44);
}

async function sweep(page) {
  const html = readFileSync(join(FRONTEND, page), 'utf8')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>/g, '')
    .replace(/<script id="tailwind-config">[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '');

  const errors = [];
  let navigations = 0;
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => {
    const first = e.message.split('\n')[0];
    /* jsdom refuses to navigate and reports it as an error. A button that
     * sets window.location is working perfectly well - count the attempt
     * instead of discarding it, or every link-shaped button reads dead. */
    if (/Not implemented: navigation/.test(first)) navigations += 1;
    else errors.push(first);
  });

  const dom = new JSDOM(html, {
    url: `${ORIGIN}/${page}`, runScripts: 'dangerously',
    pretendToBeVisual: true, virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('vinhack.student', '1');
  window.confirm = () => false;             // decline anything destructive
  window.prompt = () => null;
  window.alert = () => {};
  // jsdom has no layout, so these exist in a browser but not here; without
  // them a page that scrolls to a section throws and looks like a bug.
  window.Element.prototype.scrollIntoView = function () {};
  window.Element.prototype.scrollTo = function () {};
  let objectUrls = 0;
  window.URL.createObjectURL = () => { objectUrls += 1; return 'blob:stub'; };
  window.URL.revokeObjectURL = () => {};

  let calls = 0;
  window.fetch = async (input, init) => {
    calls += 1;
    const url = typeof input === 'string' ? new URL(input, ORIGIN).toString() : input.url;
    const res = await fetch(url, init);
    const body = await res.text();
    return { ok: res.ok, status: res.status, statusText: res.statusText,
             json: async () => JSON.parse(body), text: async () => body };
  };

  for (const tag of [...window.document.querySelectorAll('script[src^="assets/"]')]) {
    window.eval(readFileSync(join(FRONTEND, tag.getAttribute('src')), 'utf8'));
  }
  await sleep(2400);

  const doc = window.document;
  /* Hash the markup rather than measure it. Moving an "active" class from
   * one button to its neighbour leaves the total length identical, so a
   * length-based signature reports working toggles as dead. localStorage is
   * in here because preferences are written there and nowhere else. */
  const digest = (str) => {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h * 33) ^ str.charCodeAt(i)) >>> 0;
    return h;
  };
  const store = () => JSON.stringify(Object.entries(window.localStorage));
  const snap = () => [digest(doc.body.innerHTML), doc.querySelectorAll('*').length,
                      digest(store()), calls, objectUrls, navigations,
                      window.location.hash].join('|');

  /* Only things a person can actually reach. A control inside a closed
   * modal is not dead, it is off-screen, and counting it buries the real
   * findings. jsdom does no layout, so hidden-ness is read off the markup. */
  const visible = (el) => {
    for (let n = el; n && n.nodeType === 1; n = n.parentNode) {
      if (n.hasAttribute('hidden')) return false;
      if (/(^|\s)hidden(\s|$)/.test(n.getAttribute('class') || '')) return false;
      if (/display:\s*none/.test(n.getAttribute('style') || '')) return false;
    }
    return true;
  };
  const controls = [...doc.querySelectorAll('button, a[href="#"], a:not([href])')]
    .filter((el) => !el.closest('template') && visible(el));

  const dead = [];
  for (const el of controls) {
    if (!el.isConnected) continue;                // a previous click replaced it
    const opened = new Set([...doc.querySelectorAll('[id^="vh-"]')]);
    const before = snap();
    try { el.click(); } catch { /* navigation etc. counts as doing something */ }
    await sleep(160);
    if (snap() === before) dead.push(label(el));
    // close only what this click opened, so modal-internal controls still work
    for (const o of doc.querySelectorAll('[id^="vh-"]')) if (!opened.has(o)) o.remove();
    await sleep(15);
  }

  window.close();
  return { dead, errors, tried: controls.length };
}

const only = process.argv[2];
const pages = readdirSync(FRONTEND).filter((f) => f.endsWith('.html'))
  .filter((f) => !only || f.startsWith(only)).sort();

let total = 0, tried = 0;
for (const page of pages) {
  if (SKIP.has(page)) { console.log(`\n${page}  - skipped, in use elsewhere`); continue; }
  const r = await sweep(page);
  total += r.dead.length; tried += r.tried;
  console.log(`\n${page}  - ${r.dead.length} of ${r.tried} do nothing`);
  for (const d of r.dead) console.log(`    x  ${d}`);
  for (const e of r.errors) console.log(`    !  ${e}`);
}
console.log(`\n${total} inert of ${tried} controls clicked`);
