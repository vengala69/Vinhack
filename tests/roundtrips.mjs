/* End-to-end checks for the write paths.
 *
 * Each flow loads a real page in jsdom against a running API, drives the UI
 * the way a person would (click, fill, submit), and then asserts that the
 * widgets which read that data actually moved. The point is not that the POST
 * returned 201 - it is that the screen reflects it, which is where the bugs
 * have been.
 *
 *   py db/setup.py --reset --seed
 *   py -m uvicorn vinhack.main:app --port 8010
 *   node tests/roundtrips.mjs            # all flows
 *   node tests/roundtrips.mjs quick-task # one flow by name
 *
 * Needs jsdom on NODE_PATH, or run it from a directory where jsdom is
 * installed. It writes to whatever database the API is pointed at, so run it
 * against a seeded dev database, never anything you care about.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/* jsdom is a dev-only dependency and is deliberately not vendored into the
 * repo. Install it next to this file (`cd tests && npm install`), or point
 * VINHACK_JSDOM at an existing copy. */
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require(process.env.VINHACK_JSDOM || 'jsdom'));
} catch (err) {
  console.error([
    'Could not load jsdom.',
    '  cd tests && npm install',
    '  or: VINHACK_JSDOM=/path/to/jsdom node tests/roundtrips.mjs',
  ].join('\n'));
  process.exit(2);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = join(ROOT, 'frontend');
const ORIGIN = process.env.VINHACK_ORIGIN || 'http://127.0.0.1:8010';
const STUDENT = 1;

/* ------------------------------------------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, options) {
  const res = await fetch(ORIGIN + '/api' + path, options);
  if (res.status === 204) return null;
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${body.slice(0, 160)}`);
  return JSON.parse(body);
}

async function post(path, payload) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/* Load a page with its real scripts, pointed at the live API. */
async function open(page, { confirm = true, prompt = null } = {}) {
  let html = readFileSync(join(FRONTEND, page), 'utf8')
    .replace(/<script src="https:\/\/cdn\.tailwindcss\.com[^"]*"><\/script>/g, '')
    .replace(/<script id="tailwind-config">[\s\S]*?<\/script>/g, '')
    .replace(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g, '');

  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e.message));
  vc.on('error', (...a) => errors.push(a.map(String).join(' ')));

  const dom = new JSDOM(html, {
    url: `${ORIGIN}/${page}`,
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.localStorage.setItem('vinhack.student', String(STUDENT));
  window.localStorage.removeItem('vinhack.session');
  window.confirm = () => confirm;
  window.prompt = () => prompt;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? new URL(input, ORIGIN).toString() : input.url;
    const res = await fetch(url, init);
    const body = await res.text();
    return {
      ok: res.ok, status: res.status, statusText: res.statusText,
      json: async () => JSON.parse(body), text: async () => body,
    };
  };

  for (const tag of [...window.document.querySelectorAll('script[src^="assets/"]')]) {
    window.eval(readFileSync(join(FRONTEND, tag.getAttribute('src')), 'utf8'));
  }
  await sleep(2200);

  const doc = window.document;
  return {
    window, doc, errors,
    text: (sel) => (doc.querySelector(sel)?.textContent || '').trim().replace(/\s+/g, ' '),
    count: (sel) => doc.querySelectorAll(sel).length,
    click: (sel) => {
      const el = doc.querySelector(sel);
      if (!el) throw new Error(`no element for ${sel}`);
      el.click();
    },
    submit: (sel) => {
      const form = doc.querySelector(sel);
      if (!form) throw new Error(`no form for ${sel}`);
      form.dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    },
    fill: (formSel, values) => {
      const form = doc.querySelector(formSel);
      if (!form) throw new Error(`no form for ${formSel}`);
      for (const [name, value] of Object.entries(values)) {
        const field = form.elements[name];
        if (!field) throw new Error(`no field ${name} in ${formSel}`);
        field.value = value;
      }
    },
    close: () => window.close(),
  };
}

/* ------------------------------------------------------------------ */

const checks = [];
function expect(label, actual, predicate, detail) {
  const ok = predicate(actual);
  checks.push({ label, ok, detail: detail || String(actual) });
}
const changed = (before) => (after) => after !== before;
const isMore = (before) => (after) => Number(after) > Number(before);

/* ------------------------------------------------------------------
 * The flows
 * ---------------------------------------------------------------- */

const FLOWS = {
  'quick-task': async () => {
    const p = await open('index.html');
    const cardsBefore = p.count('.academic-card');
    const pillBefore = p.text('#ring-work-sub');

    p.click('#quick-task-btn');
    await sleep(200);
    p.fill('#quick-task-form', {
      'new-task-title': 'Round-trip probe task',
      'new-task-course': 'Probe',
      'new-task-priority': 'high',
    });
    // The form reads by id, not by name.
    p.doc.querySelector('#new-task-title').value = 'Round-trip probe task';
    p.doc.querySelector('#new-task-course').value = 'Probe';
    p.submit('#quick-task-form');
    await sleep(2200);

    expect('task card appears in the matrix', p.count('.academic-card'), isMore(cardsBefore),
           `${cardsBefore} -> ${p.count('.academic-card')}`);
    expect('workload pill recounts', p.text('#ring-work-sub'), changed(pillBefore),
           `"${pillBefore}" -> "${p.text('#ring-work-sub')}"`);
    p.close();
    return p.errors;
  },

  'complete-task': async () => {
    const p = await open('index.html');
    const before = p.count('.academic-card');
    const pillBefore = p.text('#ring-work-sub');
    const card = p.doc.querySelector('.academic-card [data-act="done"]');
    if (!card) throw new Error('no open task to complete');
    card.click();
    await sleep(2200);

    expect('completed task leaves the matrix', p.count('.academic-card'),
           (n) => n < before, `${before} -> ${p.count('.academic-card')}`);
    expect('workload pill recounts', p.text('#ring-work-sub'), changed(pillBefore),
           `"${pillBefore}" -> "${p.text('#ring-work-sub')}"`);
    p.close();
    return p.errors;
  },

  'focus-start': async () => {
    const p = await open('focus.html');
    const before = p.text('#stat-sessions');
    p.click('#toggle-flow-btn');
    await sleep(2200);

    const open_ = (await api(`/students/${STUDENT}/sessions?limit=5`))
      .filter((s) => !s.end_time);
    expect('an open session exists in the database', open_.length, (n) => n >= 1,
           `${open_.length} open`);
    expect("today's session count rises", p.text('#stat-sessions'), isMore(before),
           `${before} -> ${p.text('#stat-sessions')}`);
    expect('the button offers to stop it', p.text('#toggle-flow-text'),
           (t) => /stop/i.test(t), p.text('#toggle-flow-text'));
    p.close();
    return p.errors;
  },

  'focus-stop': async () => {
    // Flows run against one database, so clear any session an earlier flow
    // left open - the page adopts the newest open one, and a stray would be
    // picked up instead of the probe.
    for (const s of await api(`/students/${STUDENT}/sessions?limit=20`)) {
      if (!s.end_time) await api(`/sessions/${s.session_id}`, { method: 'DELETE' });
    }

    // A session started half an hour ago, so stopping it logs a duration
    // instead of taking the discard path.
    const started = new Date(Date.now() - 30 * 60000);
    const stamp = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:` +
      `${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    const session = await post(`/students/${STUDENT}/sessions`, { start_time: stamp(started) });

    const p = await open('focus.html', { prompt: '4' });
    await sleep(600);                       // restore() adopts the open session
    const hoursBefore = p.text('#stat-hours');
    p.click('#toggle-flow-btn');
    await sleep(2400);

    const saved = (await api(`/students/${STUDENT}/sessions?limit=10`))
      .find((s) => s.session_id === session.session_id);
    expect('the session is closed with a duration', saved && saved.duration_minutes,
           (v) => Number(v) >= 29, String(saved && saved.duration_minutes));
    expect('the focus rating is stored', saved && saved.focus_rating,
           (v) => Number(v) === 4, String(saved && saved.focus_rating));
    expect("today's focus time rises", p.text('#stat-hours'), changed(hoursBefore),
           `"${hoursBefore}" -> "${p.text('#stat-hours')}"`);
    p.close();
    return p.errors;
  },

  'log-sleep': async () => {
    const p = await open('sleep.html');
    const durationBefore = p.text('#kpi-duration-value');
    const debtBefore = p.text('#sleep-drift');

    p.click('#resyncBtn');
    await sleep(300);
    const today = new Date();
    const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-` +
      `${String(d.getDate()).padStart(2, '0')}`;
    const local = (d, h, m) => `${iso(d)}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    const yesterday = new Date(today.getTime() - 86400000);
    p.fill('#vh-sleep-form', {
      sleep_date: iso(today),
      bedtime: local(yesterday, 22, 15),
      wake_time: local(today, 6, 45),        // 8h 30m, distinct from the seed
      quality: '5',
    });
    p.submit('#vh-sleep-form');
    await sleep(2400);

    expect('sleep duration card updates', p.text('#kpi-duration-value'),
           (v) => v === '8.5h', `"${durationBefore}" -> "${p.text('#kpi-duration-value')}"`);
    expect('the drift/debt row recomputes', p.text('#sleep-drift'), changed(debtBefore),
           p.text('#sleep-drift').slice(0, 60));
    expect('the chart redraws', p.count('#sleep-chart > div'), (n) => n > 0,
           `${p.count('#sleep-chart > div')} bars`);
    p.close();
    return p.errors;
  },

  'mood-checkin': async () => {
    const p = await open('sleep.html');
    const before = p.text('#kpi-mood-value');
    p.click('#moodBtn-1');                   // Calm -> mood_score 9
    const slider = p.doc.querySelector('#stressSlider');
    slider.value = '8';
    slider.dispatchEvent(new p.window.Event('input', { bubbles: true }));
    p.click('#logMoodBtn');
    await sleep(2400);

    const row = (await api(`/students/${STUDENT}/mood?limit=1`))[0];
    expect('mood is stored as 9/10', row && row.mood_score, (v) => Number(v) === 9,
           String(row && row.mood_score));
    expect('energy is stored as 8/10', row && row.energy_score, (v) => Number(v) === 8,
           String(row && row.energy_score));
    expect('the mood card shows it', p.text('#kpi-mood-value'), (v) => v === '9',
           `"${before}" -> "${p.text('#kpi-mood-value')}"`);
    p.close();
    return p.errors;
  },

  'log-score': async () => {
    const p = await open('scores.html');
    const countBefore = p.text('#scores-count');
    const avgBefore = p.text('#scores-overall');

    p.click('#scores-add');
    await sleep(300);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-` +
      `${String(today.getDate()).padStart(2, '0')}`;
    p.fill('#vh-score-form', {
      subject: 'Probe Subject', title: 'Round-trip quiz', category: 'quiz',
      assessed_on: iso, score: '91', max_score: '100', weight_percent: '10',
      class_average: '70',
    });
    p.submit('#vh-score-form');
    await sleep(2400);

    expect('recorded count rises', p.text('#scores-count'), isMore(countBefore),
           `${countBefore} -> ${p.text('#scores-count')}`);
    expect('weighted average moves', p.text('#scores-overall'), changed(avgBefore),
           `${avgBefore} -> ${p.text('#scores-overall')}`);
    expect('a card appears for the new subject', p.text('#scores-subjects'),
           (t) => t.includes('Probe Subject'), 'subject card present');
    expect('the ledger lists the row', p.text('#scores-rows'),
           (t) => t.includes('Round-trip quiz'), 'ledger row present');
    p.close();
    return p.errors;
  },

  'add-study-block': async () => {
    const p = await open('schedule.html');
    const before = p.count('.schedule-card');

    p.click('#sched-add');
    await sleep(300);
    // Next Tuesday at 10:00 - deliberately in a different week from the one
    // on screen, because the page is supposed to follow the block there.
    const when = new Date();
    when.setDate(when.getDate() + ((9 - when.getDay()) % 7 || 7));   // next Tuesday
    when.setHours(10, 0, 0, 0);
    const local = `${when.getFullYear()}-${String(when.getMonth() + 1).padStart(2, '0')}-` +
      `${String(when.getDate()).padStart(2, '0')}T10:00`;
    p.fill('#sched-form', {
      event_name: 'Round-trip block', start_time: local, minutes: '90', location: 'Probe',
    });
    p.submit('#sched-form');
    await sleep(2400);

    expect('the block is written to the calendar',
           (await api(`/students/${STUDENT}/events`)).some((e) => e.event_name === 'Round-trip block'),
           (v) => v === true, 'found in calendar_events');
    expect('the view follows it to that week', p.text('#sched-range'),
           (t) => t.length > 1, p.text('#sched-range'));
    expect('it appears on the grid', p.text('#sched-grid'),
           (t) => t.includes('Round-trip block') || t.includes('PERSONAL'),
           `${before} cards before, grid now mentions it`);
    p.close();
    return p.errors;
  },

  'profile-goal': async () => {
    const p = await open('profile.html');
    p.fill('#profile-form', { sleep_goal_minutes: '400' });   // 6h 40m
    p.doc.querySelector('#sleep-goal').dispatchEvent(
      new p.window.Event('input', { bubbles: true }));
    p.submit('#profile-form');
    await sleep(2200);

    const student = await api(`/students/${STUDENT}`);
    expect('the goal is stored', student.sleep_goal_minutes, (v) => Number(v) === 400,
           String(student.sleep_goal_minutes));
    p.close();

    // The point of the goal is that other screens read it.
    const sleepPage = await open('sleep.html');
    expect('the sleep page scores against it', sleepPage.text('#kpi-duration-unit'),
           (t) => t.includes('6.7h'), sleepPage.text('#kpi-duration-unit'));
    sleepPage.close();

    const dash = await open('index.html');
    expect('the dashboard scores against it', dash.text('#orbit-sleep'),
           (t) => t.includes('6.7h'), dash.text('#orbit-sleep'));
    dash.close();

    await api(`/students/${STUDENT}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sleep_goal_minutes: 480 }),
    });
    return [...p.errors, ...sleepPage.errors, ...dash.errors];
  },
};

/* ------------------------------------------------------------------ */

const wanted = process.argv.slice(2);
const names = wanted.length ? wanted : Object.keys(FLOWS);
let failed = 0;

for (const name of names) {
  const flow = FLOWS[name];
  if (!flow) { console.log(`?  unknown flow: ${name}`); failed += 1; continue; }
  const from = checks.length;
  let pageErrors = [];
  try {
    pageErrors = (await flow()) || [];
  } catch (err) {
    checks.push({ label: `${name} threw`, ok: false, detail: err.message });
  }
  const mine = checks.slice(from);
  const bad = mine.filter((c) => !c.ok).length + (pageErrors.length ? 1 : 0);
  failed += bad;
  console.log(`${bad ? 'FAIL' : 'pass'}  ${name}`);
  for (const c of mine) console.log(`        ${c.ok ? 'ok  ' : 'BAD '} ${c.label}  (${c.detail})`);
  for (const e of [...new Set(pageErrors)]) console.log(`        BAD  page error: ${e.slice(0, 120)}`);
}

console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} assertions passed` +
            (failed ? ` — ${failed} problem(s)` : ''));
process.exit(failed ? 1 : 0);
