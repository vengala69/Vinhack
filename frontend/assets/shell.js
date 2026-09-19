/* The app shell every page shares: who is signed in, the sidebar, the header
 * chrome, toasts, and the two global actions in the top bar.
 *
 * The pages came out of Stitch as nine standalone mockups, so each one carries
 * its own copy of the shell markup with the same placeholder values baked in.
 * Rather than hand-edit nine copies, the shell binds by the data-vh hooks that
 * were added to those spans and fills them from one /insights call.
 */
window.VH = window.VH || {};

(function (VH) {
  'use strict';

  var STORE_KEY = 'vinhack.student';

  /* ------------------------------------------------------------------
   * Session
   *
   * The API has no accounts or auth - it identifies a student by id and
   * nothing more. So "signing in" here is picking which student's rows to
   * look at, and it is kept in localStorage. Do not mistake this for a
   * security boundary: anyone who can reach the API can read every student.
   * ---------------------------------------------------------------- */

  VH.session = {
    id: function () {
      var raw = null;
      try { raw = window.localStorage.getItem(STORE_KEY); } catch (e) { raw = null; }
      var n = parseInt(raw, 10);
      return isNaN(n) ? null : n;
    },
    set: function (id) {
      try { window.localStorage.setItem(STORE_KEY, String(id)); } catch (e) { /* private mode */ }
    },
    clear: function () {
      try { window.localStorage.removeItem(STORE_KEY); } catch (e) { /* private mode */ }
    }
  };

  /* ------------------------------------------------------------------
   * Toast
   * ---------------------------------------------------------------- */

  var TOAST_STYLE = {
    ok: { border: 'border-primary/40', text: 'text-primary', icon: 'check_circle' },
    info: { border: 'border-secondary/40', text: 'text-secondary', icon: 'info' },
    error: { border: 'border-error/50', text: 'text-error', icon: 'error_outline' }
  };

  function toastHost() {
    var host = document.getElementById('vh-toasts');
    if (!host) {
      host = document.createElement('div');
      host.id = 'vh-toasts';
      host.className = 'fixed bottom-6 right-6 z-[200] flex flex-col gap-2 ' +
        'items-end pointer-events-none';
      document.body.appendChild(host);
    }
    return host;
  }

  VH.toast = function (message, kind) {
    var style = TOAST_STYLE[kind] || TOAST_STYLE.ok;
    var el = document.createElement('div');
    el.className = 'pointer-events-auto flex items-center gap-3 px-4 py-3 rounded-2xl ' +
      'bg-surface-container-highest/95 border backdrop-blur-xl shadow-2xl ' +
      'font-body-md text-body-md transition-all duration-300 translate-y-3 opacity-0 ' +
      style.border + ' ' + style.text;
    el.innerHTML = '<span class="material-symbols-outlined text-[18px]">' +
      style.icon + '</span><span>' + VH.fmt.esc(message) + '</span>';
    toastHost().appendChild(el);
    requestAnimationFrame(function () {
      el.classList.remove('translate-y-3', 'opacity-0');
    });
    setTimeout(function () {
      el.classList.add('opacity-0', 'translate-x-4');
      setTimeout(function () { el.remove(); }, 300);
    }, 3600);
    return el;
  };

  /* A failure the user needs to see, rather than a silent blank card. */
  VH.fail = function (err, what) {
    var msg = err && err.message ? err.message : String(err);
    /* eslint-disable-next-line no-console */
    console.error(what || 'VinHack', err);
    VH.toast((what ? what + ': ' : '') + msg, 'error');
    if (err instanceof VH.ApiError && err.status === 0) VH.shell.offline();
  };

  /* ------------------------------------------------------------------
   * Navigation
   * ---------------------------------------------------------------- */

  var ROUTES = {
    'dashboard': { href: 'index.html', label: 'Dashboard' },
    'academic-schedule': { href: 'schedule.html', label: 'Academic Schedule' },
    'health-sleep': { href: 'sleep.html', label: 'Health & Sleep' },
    'focus-mode': { href: 'focus.html', label: 'Focus Mode' },
    'test-scores': { href: 'scores.html', label: 'Test Scores' },
    'analytics': { href: 'analytics.html', label: 'Analytics' },
    'therapist': { href: 'therapist.html', label: 'Therapist' },
    'settings': { href: 'settings.html', label: 'Settings' }
  };

  function wireNav() {
    var links = document.querySelectorAll('a[data-path], a[data-view]');
    Array.prototype.forEach.call(links, function (link) {
      var key = link.getAttribute('data-path') || link.getAttribute('data-view');
      var route = ROUTES[key];
      if (!route) return;
      link.setAttribute('href', route.href);
      link.classList.add('cursor-pointer');
      /* The exports left every nav item pointing at '#', and one of them
       * (scores.html) came out of Stitch with every label overwritten by a
       * stray find-and-replace. Restoring the label from the route table fixes
       * that everywhere at once instead of nine times by hand. */
      var spans = Array.prototype.filter.call(link.children, function (c) {
        return c.tagName === 'SPAN' && !c.classList.contains('material-symbols-outlined');
      });
      if (spans.length) spans[spans.length - 1].textContent = route.label;
    });
  }

  /* ------------------------------------------------------------------
   * Shared top-bar actions
   *
   * Six of the pages carry a "Box Breathing" and "+ Quick Task" button that
   * the export wired to nothing. Both get a real implementation here so they
   * behave the same wherever they appear.
   * ---------------------------------------------------------------- */

  function overlay(id, innerHTML) {
    var existing = document.getElementById(id);
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = id;
    wrap.className = 'hidden fixed inset-0 z-[150] items-center justify-center p-4 ' +
      'bg-surface-container-lowest/80 backdrop-blur-sm';
    wrap.innerHTML = innerHTML;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) VH.shell.closeOverlay(wrap);
    });
    return wrap;
  }

  VH.shell = VH.shell || {};

  VH.shell.openOverlay = function (el) {
    el.classList.remove('hidden');
    el.classList.add('flex');
  };
  VH.shell.closeOverlay = function (el) {
    el.classList.add('hidden');
    el.classList.remove('flex');
    if (el.dataset.onclose === 'breathing') stopBreathing();
  };

  var CARD = 'w-full max-w-md rounded-2xl bg-surface-container/95 border border-outline-variant/40 ' +
    'backdrop-blur-xl shadow-2xl p-space-lg flex flex-col gap-space-md';
  var LABEL = 'font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant';
  var INPUT = 'w-full bg-surface-container-lowest/70 border border-outline-variant/40 rounded-lg ' +
    'px-space-sm py-space-xs text-on-surface font-body-md text-body-md ' +
    'focus:border-secondary focus:outline-none';

  /* ---- Quick task -------------------------------------------------- */

  function quickTaskModal() {
    return overlay('vh-quick-task',
      '<form class="' + CARD + '" id="vh-quick-task-form">' +
      '  <div class="flex items-center justify-between">' +
      '    <h3 class="font-headline-sm text-headline-sm text-on-surface">Add a task</h3>' +
      '    <button type="button" class="text-on-surface-variant hover:text-on-surface" ' +
      '            data-close="1"><span class="material-symbols-outlined">close</span></button>' +
      '  </div>' +
      '  <label class="flex flex-col gap-1"><span class="' + LABEL + '">Task</span>' +
      '    <input required name="task_name" class="' + INPUT + '" ' +
      '           placeholder="e.g. Linear algebra problem set"></label>' +
      '  <div class="grid grid-cols-2 gap-space-sm">' +
      '    <label class="flex flex-col gap-1"><span class="' + LABEL + '">Subject</span>' +
      '      <input name="subject" list="vh-subjects" class="' + INPUT + '"></label>' +
      '    <label class="flex flex-col gap-1"><span class="' + LABEL + '">Type</span>' +
      '      <select name="task_type" class="' + INPUT + '">' +
      ['assignment', 'exam', 'quiz', 'project', 'reading', 'lab', 'other'].map(function (t) {
        return '<option value="' + t + '">' + VH.fmt.title(t) + '</option>';
      }).join('') +
      '      </select></label>' +
      '  </div>' +
      '  <div class="grid grid-cols-2 gap-space-sm">' +
      '    <label class="flex flex-col gap-1"><span class="' + LABEL + '">Due</span>' +
      '      <input name="due_date" type="datetime-local" class="' + INPUT + '"></label>' +
      '    <label class="flex flex-col gap-1"><span class="' + LABEL + '">Priority</span>' +
      '      <select name="priority" class="' + INPUT + '">' +
      ['low', 'medium', 'high', 'urgent'].map(function (p) {
        return '<option value="' + p + '"' + (p === 'medium' ? ' selected' : '') + '>' +
          VH.fmt.title(p) + '</option>';
      }).join('') +
      '      </select></label>' +
      '  </div>' +
      '  <label class="flex flex-col gap-1"><span class="' + LABEL + '">Estimated effort (hours)</span>' +
      '    <input name="estimated_effort_hours" type="number" min="0" step="0.5" class="' + INPUT + '"></label>' +
      '  <datalist id="vh-subjects"></datalist>' +
      '  <div class="flex justify-end gap-space-sm pt-space-xs">' +
      '    <button type="button" data-close="1" class="px-space-md py-space-xs rounded-lg ' +
      '            bg-surface-container-high text-on-surface font-label-md text-label-md">Cancel</button>' +
      '    <button type="submit" class="px-space-md py-space-xs rounded-lg bg-primary ' +
      '            text-on-primary font-label-md text-label-md font-semibold">Create task</button>' +
      '  </div>' +
      '</form>');
  }

  /* datetime-local gives 'YYYY-MM-DDTHH:MM' in local time already, which is
   * exactly the frame the database stores. Only the separator needs changing. */
  function fromLocalInput(value) {
    if (!value) return null;
    return value.replace('T', ' ') + (value.length === 16 ? ':00' : '');
  }

  VH.shell.openQuickTask = function () {
    var modal = quickTaskModal();
    VH.shell.openOverlay(modal);
    var list = modal.querySelector('#vh-subjects');
    if (list && !list.childElementCount && VH.shell.subjects) {
      list.innerHTML = VH.shell.subjects.map(function (s) {
        return '<option value="' + VH.fmt.esc(s) + '">';
      }).join('');
    }
    var field = modal.querySelector('input[name="task_name"]');
    if (field) field.focus();
  };

  async function submitQuickTask(form) {
    var data = new FormData(form);
    var body = {
      task_name: (data.get('task_name') || '').trim(),
      subject: (data.get('subject') || '').trim() || null,
      task_type: data.get('task_type') || 'other',
      priority: data.get('priority') || 'medium',
      due_date: fromLocalInput(data.get('due_date')),
      estimated_effort_hours: data.get('estimated_effort_hours')
        ? Number(data.get('estimated_effort_hours')) : null
    };
    Object.keys(body).forEach(function (k) { if (body[k] === null) delete body[k]; });
    var created = await VH.api.createTask(VH.session.id(), body);
    VH.toast('Added "' + created.task_name + '"');
    form.reset();
    VH.shell.closeOverlay(document.getElementById('vh-quick-task'));
    document.dispatchEvent(new CustomEvent('vh:task-created', { detail: created }));
  }

  /* ---- Box breathing ----------------------------------------------- */

  var breathTimer = null;

  function breathingModal() {
    var el = overlay('vh-breathing',
      '<div class="' + CARD + ' items-center text-center max-w-sm">' +
      '  <div class="flex items-center gap-2 text-secondary">' +
      '    <span class="material-symbols-outlined text-[18px]">air</span>' +
      '    <span class="' + LABEL + '">Box breathing</span></div>' +
      '  <p class="font-body-sm text-body-sm text-on-surface-variant">' +
      '    Inhale 4 &middot; hold 4 &middot; exhale 4 &middot; hold 4.</p>' +
      '  <div class="relative flex items-center justify-center h-52 w-52 my-space-sm">' +
      '    <div class="absolute inset-0 rounded-full bg-primary/10 blur-xl"></div>' +
      '    <div id="vh-breath-orb" class="relative flex flex-col items-center justify-center ' +
      '         h-40 w-40 rounded-full bg-surface-container-highest/80 border border-primary/30 ' +
      '         transition-transform duration-1000 ease-in-out">' +
      '      <span id="vh-breath-phase" class="font-title-md text-title-md text-on-surface">Inhale</span>' +
      '      <span id="vh-breath-count" class="font-metric-display text-metric-display text-primary">4</span>' +
      '    </div></div>' +
      '  <div class="font-body-sm text-body-sm text-on-surface-variant">Cycle ' +
      '    <span id="vh-breath-cycle">1</span> of 4</div>' +
      '  <button type="button" data-close="1" class="mt-space-xs px-space-md py-space-xs rounded-lg ' +
      '          bg-surface-container-high text-on-surface font-label-md text-label-md">Done</button>' +
      '</div>');
    el.dataset.onclose = 'breathing';
    return el;
  }

  function stopBreathing() {
    if (breathTimer) { clearInterval(breathTimer); breathTimer = null; }
  }

  VH.shell.openBreathing = function () {
    var modal = breathingModal();
    VH.shell.openOverlay(modal);
    var phases = ['Inhale', 'Hold', 'Exhale', 'Hold'];
    var scales = [1.18, 1.18, 0.86, 0.86];
    var phase = 0, left = 4, cycles = 1;
    var orb = modal.querySelector('#vh-breath-orb');
    var phaseEl = modal.querySelector('#vh-breath-phase');
    var countEl = modal.querySelector('#vh-breath-count');
    var cycleEl = modal.querySelector('#vh-breath-cycle');

    function paint() {
      phaseEl.textContent = phases[phase];
      countEl.textContent = left;
      orb.style.transform = 'scale(' + scales[phase] + ')';
      cycleEl.textContent = cycles;
    }
    stopBreathing();
    paint();
    breathTimer = setInterval(function () {
      left -= 1;
      if (left <= 0) {
        left = 4;
        phase = (phase + 1) % 4;
        if (phase === 0) {
          cycles += 1;
          if (cycles > 4) { stopBreathing(); VH.toast('Four cycles done. Nervous system reset.'); return; }
        }
      }
      paint();
    }, 1000);
  };

  /* ---- Search ------------------------------------------------------ */

  function searchPanel(input) {
    var panel = document.createElement('div');
    panel.className = 'hidden absolute left-0 right-0 top-full mt-2 z-[120] rounded-xl ' +
      'bg-surface-container-high/97 border border-outline-variant/40 backdrop-blur-xl ' +
      'shadow-2xl overflow-hidden max-h-80 overflow-y-auto';
    var host = input.parentElement;
    if (host && getComputedStyle(host).position === 'static') host.classList.add('relative');
    host.appendChild(panel);
    return panel;
  }

  function wireSearch() {
    var input = document.querySelector('input[data-vh="search"]');
    if (!input) return;
    input.placeholder = 'Search tasks, grades and events…';
    var panel = searchPanel(input);
    var timer = null;

    function hide() { panel.classList.add('hidden'); }

    async function run() {
      var term = input.value.trim().toLowerCase();
      if (term.length < 2) { hide(); return; }
      var id = VH.session.id();
      if (!id) return;
      try {
        var results = await Promise.all([
          VH.api.tasks(id),
          VH.api.assessments(id, { limit: 100 }),
          VH.api.events(id)
        ]);
        var hits = [];
        results[0].forEach(function (t) {
          if ((t.task_name + ' ' + (t.subject || '')).toLowerCase().indexOf(term) >= 0) {
            hits.push({ icon: 'task_alt', title: t.task_name,
                        meta: (t.subject || 'No subject') + ' · ' + VH.fmt.title(t.status),
                        href: 'schedule.html' });
          }
        });
        results[1].forEach(function (a) {
          if ((a.title + ' ' + a.subject).toLowerCase().indexOf(term) >= 0) {
            hits.push({ icon: 'grade', title: a.title,
                        meta: a.subject + ' · ' + VH.fmt.num(a.percent) + '%',
                        href: 'scores.html' });
          }
        });
        results[2].forEach(function (e) {
          if ((e.event_name + ' ' + (e.location || '')).toLowerCase().indexOf(term) >= 0) {
            hits.push({ icon: 'calendar_month', title: e.event_name,
                        meta: VH.fmt.date(e.start_time) + ' · ' + VH.fmt.clock(e.start_time),
                        href: 'schedule.html' });
          }
        });
        if (!hits.length) {
          panel.innerHTML = '<div class="px-space-md py-space-sm font-body-sm text-body-sm ' +
            'text-on-surface-variant">Nothing matches &ldquo;' + VH.fmt.esc(input.value) + '&rdquo;.</div>';
        } else {
          panel.innerHTML = hits.slice(0, 12).map(function (h) {
            return '<a href="' + h.href + '" class="flex items-center gap-space-sm px-space-md ' +
              'py-space-xs hover:bg-surface-container-highest transition-colors">' +
              '<span class="material-symbols-outlined text-[18px] text-primary">' + h.icon + '</span>' +
              '<span class="flex flex-col"><span class="font-label-md text-label-md text-on-surface">' +
              VH.fmt.esc(h.title) + '</span><span class="font-label-sm text-label-sm ' +
              'text-on-surface-variant">' + VH.fmt.esc(h.meta) + '</span></span></a>';
          }).join('');
        }
        panel.classList.remove('hidden');
      } catch (err) {
        VH.fail(err, 'Search');
      }
    }

    input.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(run, 180);
    });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') hide(); });
    document.addEventListener('click', function (e) {
      if (e.target !== input && !panel.contains(e.target)) hide();
    });
  }

  /* ------------------------------------------------------------------
   * Hydration
   * ---------------------------------------------------------------- */

  function setAll(hook, value) {
    var nodes = document.querySelectorAll('[data-vh="' + hook + '"]');
    Array.prototype.forEach.call(nodes, function (n) { n.textContent = value; });
    return nodes.length;
  }

  VH.shell.offline = function () {
    if (document.getElementById('vh-offline')) return;
    var bar = document.createElement('div');
    bar.id = 'vh-offline';
    bar.className = 'fixed top-0 inset-x-0 z-[300] px-4 py-2 bg-error-container ' +
      'text-on-error-container font-label-md text-label-md text-center';
    bar.textContent = 'Cannot reach the VinHack API. Start it with:  py -m vinhack';
    document.body.appendChild(bar);
  };

  function hydrate(student, insights, latencyMs) {
    setAll('name', student.name);
    setAll('role', 'Semester ' + (student.semester || '–'));
    setAll('email', student.email);
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="avatar"]'), function (n) {
      n.textContent = VH.fmt.initials(student.name);
    });

    setAll('campus', 'Semester ' + (student.semester || '–') + ' · ' +
      VH.fmt.longDate(insights.today));

    var streak = insights.streak_days || 0;
    setAll('streak', streak
      ? streak + (streak === 1 ? ' day' : ' days') + ' in flow 🔥'
      : 'No streak yet — log a session');

    /* "Recovery" is the sleep-and-energy half of the synthesis index: what the
     * body has left, as opposed to what the coursework demands. */
    var recovery = VH.fmt.num(insights.scores && insights.scores.sleep_health, 0, null);
    setAll('recovery', recovery === null
      ? 'No sleep logged yet'
      : recovery + '% recovery score');

    setAll('engine', 'Database online · ' + Math.round(latencyMs) + 'ms');
  }

  /* ------------------------------------------------------------------
   * Boot
   * ---------------------------------------------------------------- */

  VH.shell.student = null;
  VH.shell.insights = null;
  VH.shell.subjects = [];

  /* Pages call this and get back the two things nearly all of them need. */
  /* There is no login screen. With nothing stored, open on whoever is first
   * in the database - the API has no accounts, so this is only a default pick. */
  VH.shell.defaultStudentId = async function () {
    var list;
    try {
      list = await VH.api.students();
    } catch (err) {
      VH.fail(err, 'Loading your data');
      return null;
    }
    if (!list || !list.length) {
      VH.toast('No students in the database - seed it with: py db/setup.py --reset --seed', 'error');
      return null;
    }
    return list[0].student_id;
  };

  VH.shell.boot = async function (page) {
    wireNav();

    document.addEventListener('click', function (e) {
      var closer = e.target.closest ? e.target.closest('[data-close="1"]') : null;
      if (closer) {
        var host = closer.closest('[id^="vh-"]');
        if (host) { VH.shell.closeOverlay(host); return; }
      }
      var quick = e.target.closest ? e.target.closest('[data-vh="quicktask"]') : null;
      if (quick) { e.preventDefault(); VH.shell.openQuickTask(); return; }
      var breathe = e.target.closest ? e.target.closest('[data-vh="breathe"]') : null;
      if (breathe) { e.preventDefault(); VH.shell.openBreathing(); }
    });

    document.addEventListener('submit', function (e) {
      if (e.target.id === 'vh-quick-task-form') {
        e.preventDefault();
        submitQuickTask(e.target).catch(function (err) { VH.fail(err, 'Create task'); });
      }
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      Array.prototype.forEach.call(document.querySelectorAll('[id^="vh-"]'), function (el) {
        if (el.classList.contains('flex')) VH.shell.closeOverlay(el);
      });
    });

    var id = VH.session.id();
    if (!id) {
      id = await VH.shell.defaultStudentId();
      if (!id) return null;
      VH.session.set(id);
    }

    var started = performance.now();
    var student, insights;
    try {
      student = await VH.api.student(id);
      insights = await VH.api.insights(id, 14);
    } catch (err) {
      if (err instanceof VH.ApiError && err.status === 404) {
        /* The stored id points at a student who has since been deleted:
         * fall back to whoever is first in the database. */
        VH.session.clear();
        var fallback = await VH.shell.defaultStudentId();
        if (!fallback || fallback === id) return null;
        VH.session.set(fallback);
        id = fallback;
        try {
          student = await VH.api.student(id);
          insights = await VH.api.insights(id, 14);
        } catch (retryErr) {
          VH.fail(retryErr, 'Loading your data');
          return null;
        }
      } else {
        VH.fail(err, 'Loading your data');
        return null;
      }
    }
    var latency = performance.now() - started;

    VH.shell.student = student;
    VH.shell.insights = insights;
    VH.shell.subjects = (insights.subject_effort || [])
      .map(function (s) { return s.subject; })
      .filter(function (s) { return s && s !== 'Unassigned'; });

    hydrate(student, insights, latency);
    wireSearch();
    document.title = 'StudySync — ' + student.name;
    return { student: student, insights: insights };
  };
})(window.VH);
