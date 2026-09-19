/* Deep focus.
 *
 * Starting the timer POSTs a study_sessions row with a start_time and no end;
 * stopping PATCHes the end_time in, and the API derives the duration. The
 * running session id is kept in localStorage so a refresh, or hopping to the
 * dashboard and back, picks the same session up rather than orphaning it.
 *
 * The soundscapes are synthesised with the Web Audio API. No audio files ship
 * with this build, so the labels say what they really are.
 */
(function (VH) {
  'use strict';

  var TIMER_KEY = 'vinhack.session';
  var RING_CIRCUMFERENCE = 540;   // 2 * pi * r, with r = 86 in the SVG

  var ctx = null;
  var state = { tasks: [], sessions: [], taskId: null, planned: 25 * 60 };
  var timer = { id: null, startedAt: null, tick: null };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  /* ------------------------------------------------------------------
   * Timer
   * ---------------------------------------------------------------- */

  function readSaved() {
    try { return JSON.parse(window.localStorage.getItem(TIMER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeSaved(value) {
    try {
      if (value) window.localStorage.setItem(TIMER_KEY, JSON.stringify(value));
      else window.localStorage.removeItem(TIMER_KEY);
    } catch (e) { /* private mode */ }
  }

  function paintTimer() {
    var label = $('toggle-flow-text');
    var icon = $('toggle-flow-icon');
    var ring = $('timer-progress-ring');

    if (!timer.id) {
      set('timer-countdown', VH.fmt.mmss(state.planned));
      if (label) label.textContent = 'Start focus session';
      if (icon) icon.textContent = 'play_arrow';
      if (ring) ring.style.strokeDashoffset = 0;
      set('focus-cycle-tag', 'Not running');
      set('focus-state', 'Ready');
      return;
    }

    var elapsed = (Date.now() - timer.startedAt) / 1000;
    var left = state.planned - elapsed;
    /* Past the planned length the timer keeps counting up: the session is
     * still open in the database, and hiding that would be a lie. */
    set('timer-countdown', left >= 0 ? VH.fmt.mmss(left) : '+' + VH.fmt.mmss(-left));
    if (label) label.textContent = 'Stop and save';
    if (icon) icon.textContent = 'stop';
    if (ring) {
      var done = Math.max(0, Math.min(1, elapsed / state.planned));
      ring.style.strokeDashoffset = RING_CIRCUMFERENCE * done;
    }
    set('focus-cycle-tag', 'Session #' + timer.id + ' · ' + VH.fmt.hm(elapsed / 60));
    set('focus-state', left >= 0 ? 'Running' : 'Over the planned length');
  }

  function runClock() {
    clearInterval(timer.tick);
    timer.tick = setInterval(paintTimer, 1000);
    paintTimer();
  }

  async function startSession() {
    var body = { start_time: VH.fmt.stamp(new Date()) };
    if (state.taskId) body.task_id = state.taskId;
    var created = await VH.api.startSession(ctx.student.student_id, body);
    timer.id = created.session_id;
    timer.startedAt = VH.fmt.parse(created.start_time).getTime();
    writeSaved({ id: timer.id, startedAt: timer.startedAt, student: ctx.student.student_id });
    startBreathing();
    runClock();
    VH.toast('Session started. It is open in the database until you stop it.');
  }

  async function stopSession() {
    var elapsedMin = (Date.now() - timer.startedAt) / 60000;
    if (elapsedMin < 1) {
      /* SQLite's CHECK wants end_time strictly after start_time, and a
       * sub-minute session is noise anyway. */
      if (!window.confirm('Less than a minute has passed. Discard this session?')) return;
      await VH.api.deleteSession(timer.id);
      VH.toast('Session discarded.', 'info');
    } else {
      var rating = askFocus();
      var patch = { end_time: VH.fmt.stamp(new Date()) };
      if (rating) patch.focus_rating = rating;
      var saved = await VH.api.updateSession(timer.id, patch);
      VH.toast('Logged ' + VH.fmt.hm(saved.duration_minutes) + '.');
    }
    clearInterval(timer.tick);
    stopBreathing();
    timer.id = null;
    timer.startedAt = null;
    writeSaved(null);
    paintTimer();
    await reload();
  }

  function askFocus() {
    var answer = window.prompt('How focused was that, 1 (scattered) to 5 (locked in)?', '4');
    if (answer === null) return null;
    var n = parseInt(answer, 10);
    return (n >= 1 && n <= 5) ? n : null;
  }

  async function restore() {
    var saved = readSaved();
    if (!saved || saved.student !== ctx.student.student_id) return;
    var open = state.sessions.filter(function (s) {
      return s.session_id === saved.id && !s.end_time;
    })[0];
    if (!open) { writeSaved(null); return; }
    timer.id = open.session_id;
    timer.startedAt = VH.fmt.parse(open.start_time).getTime();
    if (open.task_id) {
      state.taskId = open.task_id;
      var select = $('objective-select');
      if (select) select.value = String(open.task_id);
      paintObjective();
    }
    startBreathing();
    runClock();
  }

  /* ------------------------------------------------------------------
   * Breathing guide (purely visual, unchanged in spirit from the export)
   * ---------------------------------------------------------------- */

  var breath = { tick: null, phase: 0 };
  var PHASES = [
    { text: 'Inhale (4s)', core: 'scale-110', r1: 'scale-125', r2: 'scale-110', r3: 'scale-105' },
    { text: 'Hold (4s)', core: 'scale-110', r1: 'scale-125', r2: 'scale-115', r3: 'scale-105' },
    { text: 'Exhale (4s)', core: 'scale-95', r1: 'scale-95', r2: 'scale-90', r3: 'scale-85' }
  ];

  function paintBreath(phase) {
    var core = $('breathing-core');
    var guide = $('breathing-guide');
    if (guide) guide.textContent = phase.text;
    if (core) {
      core.className = 'relative z-10 flex flex-col items-center justify-center text-center ' +
        'p-space-md rounded-full w-56 h-56 sm:w-64 sm:h-64 bg-surface-container-lowest/90 ' +
        'backdrop-blur-md shadow-2xl transition-transform duration-1000 ' + phase.core;
    }
    var r1 = $('ripple-1');
    var r2 = $('ripple-2');
    var r3 = $('ripple-3');
    if (r1) r1.className = 'w-48 h-48 sm:w-60 sm:h-60 rounded-full bg-tertiary-container/15 blur-xl transition-transform duration-1000 ease-in-out ' + phase.r1;
    if (r2) r2.className = 'w-64 h-64 sm:w-80 sm:h-80 rounded-full bg-primary/10 blur-md transition-transform duration-1000 ease-in-out ' + phase.r2;
    if (r3) r3.className = 'w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-secondary/5 transition-transform duration-1000 ease-in-out ' + phase.r3;
  }

  function startBreathing() {
    stopBreathing();
    breath.phase = 0;
    paintBreath(PHASES[0]);
    breath.tick = setInterval(function () {
      breath.phase = (breath.phase + 1) % PHASES.length;
      paintBreath(PHASES[breath.phase]);
    }, 4000);
  }

  function stopBreathing() {
    if (breath.tick) { clearInterval(breath.tick); breath.tick = null; }
    paintBreath({ text: 'Inhale (4s)', core: '', r1: 'scale-100', r2: 'scale-95', r3: 'scale-90' });
  }

  /* ------------------------------------------------------------------
   * Soundscapes
   *
   * Synthesised by assets/audio.js, which the wellbeing page shares.
   * ---------------------------------------------------------------- */

  /* ------------------------------------------------------------------
   * Objective
   * ---------------------------------------------------------------- */

  function paintObjective() {
    var task = state.tasks.filter(function (t) { return t.task_id === state.taskId; })[0];
    set('objective-text', task
      ? (task.subject ? task.subject + ': ' : '') + task.task_name
      : 'No task selected — the session is still logged, just unattached.');
    set('objective-note', task
      ? (task.due_date ? 'Due ' + VH.fmt.until(task.due_date) : 'No due date') +
        (task.estimated_effort_hours ? ' · ' + VH.fmt.hours(task.estimated_effort_hours) +
          ' estimated' : '')
      : 'Pick one above to attach this session to it.');
    set('objective-count', state.tasks.length + ' open');
  }

  function renderObjective() {
    var select = $('objective-select');
    if (!select) return;
    select.innerHTML = '<option value="">No specific task</option>' +
      state.tasks.map(function (t) {
        return '<option value="' + t.task_id + '">' +
          VH.fmt.esc((t.subject ? t.subject + ' · ' : '') + t.task_name) + '</option>';
      }).join('');
    if (state.taskId) select.value = String(state.taskId);
    paintObjective();
  }

  /* ------------------------------------------------------------------
   * Today
   * ---------------------------------------------------------------- */

  function renderToday() {
    var today = ctx.insights.today;
    var todays = state.sessions.filter(function (s) {
      return s.start_time.slice(0, 10) === today;
    });
    var closed = todays.filter(function (s) { return s.duration_minutes; });
    var minutes = closed.reduce(function (sum, s) { return sum + s.duration_minutes; }, 0);
    var ratings = closed.filter(function (s) { return s.focus_rating; });

    set('stat-hours', minutes ? VH.fmt.hm(minutes) : '0m');
    set('stat-sessions', String(todays.length));
    set('stat-focus', ratings.length
      ? VH.fmt.num(ratings.reduce(function (sum, s) { return sum + s.focus_rating; }, 0) /
                   ratings.length, 1)
      : '--');

    var available = ctx.insights.averages.avg_available_hours;
    var share = available ? minutes / 60 / available * 100 : null;
    set('stat-share', share === null ? 'no estimate yet'
      : Math.round(share) + '% of ' + VH.fmt.hours(available));
    var bar = $('stat-bar');
    if (bar) bar.style.width = VH.clamp01(share || 0) + '%';

    set('session-count', todays.length + ' today');
    html('session-list', todays.length
      ? todays.map(function (s) {
          var task = state.tasks.filter(function (t) { return t.task_id === s.task_id; })[0];
          var open = !s.end_time;
          return '<div class="flex items-center justify-between gap-2 p-space-xs rounded-lg ' +
            'bg-surface-container">' +
            '<div class="flex flex-col min-w-0">' +
            '<span class="font-label-md text-label-md text-on-surface truncate">' +
            VH.fmt.esc(task ? task.task_name : 'Unattached session') + '</span>' +
            '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
            VH.fmt.clock(s.start_time) + (open ? ' · still running' :
              ' – ' + VH.fmt.clock(s.end_time)) + '</span></div>' +
            '<span class="font-label-sm text-label-sm flex-shrink-0 ' +
            (open ? 'text-primary' : 'text-on-surface-variant') + '">' +
            (open ? 'open' : VH.fmt.hm(s.duration_minutes) +
              (s.focus_rating ? ' · ' + s.focus_rating + '/5' : '')) +
            '</span></div>';
        }).join('')
      : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing logged today yet.</p>');

    /* The four figures along the bottom. */
    set('bio-streak', (ctx.insights.streak_days || 0) + ' day' +
      (ctx.insights.streak_days === 1 ? '' : 's'));
    var best = (ctx.insights.focus_by_part_of_day || [])[0];
    set('bio-window', best ? VH.fmt.title(best.part_of_day) + ' · ' +
      VH.fmt.num(best.avg_focus) + '/5' : 'not enough sessions');
    set('bio-energy', ctx.insights.averages.avg_energy
      ? VH.fmt.num(ctx.insights.averages.avg_energy) + '/10' : 'no check-ins');
    var next = state.tasks.filter(function (t) { return t.due_date; })
      .sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })[0];
    set('bio-deadline', next ? VH.fmt.until(next.due_date) : 'nothing due');
  }

  /* ------------------------------------------------------------------
   * Wiring
   * ---------------------------------------------------------------- */

  function setPlanned(minutes, instruction) {
    state.planned = minutes * 60;
    if (instruction) set('rhythm-instruction', instruction);
    if (!timer.id) paintTimer();
  }

  function wire() {
    var toggle = $('toggle-flow-btn');
    if (toggle) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var action = timer.id ? stopSession() : startSession();
        action.catch(function (err) { VH.fail(err, 'Session'); });
      });
    }

    /* The reset button next to it. */
    var reset = toggle && toggle.parentElement
      ? toggle.parentElement.querySelectorAll('button')[1] : null;
    if (reset) {
      reset.addEventListener('click', function (e) {
        e.preventDefault();
        if (timer.id) {
          VH.toast('Stop the session first — it is open in the database.', 'info');
          return;
        }
        paintTimer();
      });
    }

    var PRESETS = [
      { minutes: 25, note: '4-4-4 breathing to settle before a short sprint' },
      { minutes: 50, note: 'A long block with one break at the end' },
      { minutes: 90, note: 'A full ultradian cycle — expect to flag near the end' }
    ];
    Array.prototype.forEach.call(document.querySelectorAll('.mode-pill'), function (pill, index) {
      pill.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.mode-pill'), function (other) {
          other.className = 'mode-pill px-space-md py-1 rounded-full bg-transparent ' +
            'text-on-surface-variant hover:text-on-surface font-label-md text-label-md transition-all';
        });
        pill.className = 'mode-pill px-space-md py-1 rounded-full bg-primary-container ' +
          'text-on-primary font-label-md text-label-md font-semibold transition-all';
        var preset = PRESETS[index] || PRESETS[0];
        setPlanned(preset.minutes, preset.note);
      });
    });

    var DURATIONS = [25, 50, 90, 5];
    Array.prototype.forEach.call(document.querySelectorAll('.timer-duration-btn'),
      function (btn, index) {
        btn.addEventListener('click', function () {
          Array.prototype.forEach.call(document.querySelectorAll('.timer-duration-btn'),
            function (other) {
              other.className = 'timer-duration-btn px-space-sm py-1 rounded-lg ' +
                'bg-surface-container text-on-surface-variant hover:text-on-surface ' +
                'font-label-md text-label-md transition-all';
            });
          btn.className = 'timer-duration-btn px-space-sm py-1 rounded-lg ' +
            'bg-surface-container-high text-primary font-label-md text-label-md font-semibold transition-all';
          setPlanned(DURATIONS[index] || 25);
        });
      });

    var SOUNDS = ['theta', 'library', 'rain', 'mute'];
    Array.prototype.forEach.call(document.querySelectorAll('.sound-tab'), function (tab, index) {
      tab.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.sound-tab'), function (other) {
          other.className = 'sound-tab px-space-sm py-1.5 rounded-lg bg-transparent ' +
            'text-on-surface-variant hover:text-on-surface font-label-md text-label-md ' +
            'flex items-center gap-1.5 transition-all';
        });
        tab.className = 'sound-tab px-space-sm py-1.5 rounded-lg bg-surface-container-high ' +
          'text-primary font-label-md text-label-md flex items-center gap-1.5 transition-all shadow-sm';
        var playing = VH.audio.play(SOUNDS[index] || 'mute');
        if (!playing) {
          /* Toggled off, or muted - drop the active styling back off. */
          tab.className = 'sound-tab px-space-sm py-1.5 rounded-lg bg-transparent ' +
            'text-on-surface-variant hover:text-on-surface font-label-md text-label-md ' +
            'flex items-center gap-1.5 transition-all';
        }
      });
    });

    var select = $('objective-select');
    if (select) {
      select.addEventListener('change', function () {
        state.taskId = select.value ? Number(select.value) : null;
        paintObjective();
        if (timer.id) {
          VH.api.updateSession(timer.id, { task_id: state.taskId })
            .catch(function (err) { VH.fail(err, 'Attach task'); });
        }
      });
    }

    /* Leaving with a session open is fine - it stays open in the database and
     * is picked back up on return - but the audio should not follow you. */
    /* audio.js stops itself on unload. */
  }

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.tasks(id, { open_only: true }),
      VH.api.sessions(id, { limit: 60 }),
      VH.api.insights(id, 14)
    ]);
    state.tasks = results[0];
    state.sessions = results[1];
    ctx.insights = results[2];
    VH.shell.insights = results[2];
    renderObjective();
    renderToday();
  }

  async function boot() {
    ctx = await VH.shell.boot('focus');
    if (!ctx) return;

    /* focus.html?task=12 - how the dashboard and schedule hand a task over. */
    var wanted = new URLSearchParams(window.location.search).get('task');
    if (wanted) state.taskId = Number(wanted);

    wire();
    await reload();
    stopBreathing();
    paintTimer();
    await restore();
  }

  boot().catch(function (err) { VH.fail(err, 'Focus'); });
})(window.VH);
