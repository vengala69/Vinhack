/* Academic schedule.
 *
 * The weekly grid is drawn from calendar_events and the deadline rail from
 * academic_tasks. The export positioned its cards absolutely inside a 740px
 * column covering 08:00-18:00, which is 74px an hour; that scale is kept, and
 * the hour labels are now laid out on the same one so a 13:40 event actually
 * sits against the 1 PM mark.
 */
(function (VH) {
  'use strict';

  var DAY_START = 8;          // first hour drawn
  var DAY_END = 18;           // last hour drawn
  var PX_PER_HOUR = 74;
  var COLUMN_PX = (DAY_END - DAY_START) * PX_PER_HOUR;

  var ctx = null;
  var state = { events: [], tasks: [], weekStart: null, filter: 'all' };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  /* Monday of the week containing `date`. */
  function mondayOf(date) {
    var d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    var shift = (d.getDay() + 6) % 7;      // Sunday counts as the 7th day
    d.setDate(d.getDate() - shift);
    return d;
  }

  function addDays(date, n) {
    var d = new Date(date.getTime());
    d.setDate(d.getDate() + n);
    return d;
  }

  /* ------------------------------------------------------------------
   * Event styling
   * ---------------------------------------------------------------- */

  var TYPE_STYLE = {
    class: { chip: 'bg-secondary/15 text-secondary', card: 'bg-surface-container-high/90' },
    exam: { chip: 'bg-error/20 text-error', card: 'bg-error/15 border border-error/40' },
    lab: { chip: 'bg-primary/20 text-primary', card: 'bg-surface-container-high/90' },
    meeting: { chip: 'bg-tertiary/20 text-tertiary', card: 'bg-surface-container-high/90' },
    personal: { chip: 'bg-primary/15 text-primary', card: 'bg-surface-container-lowest/80' },
    commute: { chip: 'bg-outline/20 text-on-surface-variant', card: 'bg-surface-container/80' },
    other: { chip: 'bg-surface-container-highest text-on-surface-variant', card: 'bg-surface-container-high/90' }
  };

  function styleFor(type) { return TYPE_STYLE[type] || TYPE_STYLE.other; }

  function hoursInto(date) {
    return date.getHours() + date.getMinutes() / 60;
  }

  function eventCard(event) {
    var start = VH.fmt.parse(event.start_time);
    var end = VH.fmt.parse(event.end_time);
    var from = Math.max(DAY_START, hoursInto(start));
    var to = Math.min(DAY_END, hoursInto(end));
    if (to <= DAY_START || from >= DAY_END) return '';     // entirely outside the drawn day
    var top = (from - DAY_START) * PX_PER_HOUR;
    var height = Math.max(28, (to - from) * PX_PER_HOUR);
    var style = styleFor(event.event_type);
    var compact = height < 60;

    return '<div class="schedule-card absolute left-1 right-1 p-2 rounded-xl ' + style.card +
      ' hover:brightness-110 transition-all shadow-sm cursor-pointer group flex flex-col ' +
      'justify-between overflow-hidden" data-type="' + VH.fmt.esc(event.event_type) +
      '" data-event="' + event.event_id + '" style="top:' + top.toFixed(0) + 'px;height:' +
      height.toFixed(0) + 'px" title="' +
      VH.fmt.esc(event.event_name + ' · ' + VH.fmt.clock(event.start_time) + '–' +
                 VH.fmt.clock(event.end_time) + (event.location ? ' · ' + event.location : '')) + '">' +
      '<div class="min-w-0">' +
      '<div class="flex items-center justify-between gap-1">' +
      '<span class="px-1.5 py-0.5 rounded text-[10px] font-semibold font-label-sm ' + style.chip +
      '">' + VH.fmt.esc(event.event_type.toUpperCase()) + '</span>' +
      (event.is_fixed ? '' : '<span class="material-symbols-outlined text-[13px] text-primary">' +
        'edit_calendar</span>') +
      '</div>' +
      (compact ? '' : '<p class="font-title-md text-label-md text-on-surface mt-1 leading-tight ' +
        'line-clamp-2">' + VH.fmt.esc(event.event_name) + '</p>') +
      '</div>' +
      '<div class="flex items-center justify-between text-on-surface-variant font-label-sm text-[11px] gap-1">' +
      '<span class="truncate">' + VH.fmt.esc(VH.fmt.clock(event.start_time)) +
      (compact ? ' · ' + VH.fmt.esc(event.event_name) : '') + '</span>' +
      (event.location && !compact
        ? '<span class="truncate max-w-[70px]">' + VH.fmt.esc(event.location) + '</span>' : '') +
      '</div></div>';
  }

  /* ------------------------------------------------------------------
   * Grid
   * ---------------------------------------------------------------- */

  function renderGrid() {
    var today = VH.fmt.day(new Date());
    var head = ['<div class="text-left font-label-sm text-label-sm text-on-surface-variant pt-2 pl-2">Time</div>'];
    var columns = [];

    for (var i = 0; i < 5; i += 1) {
      var day = addDays(state.weekStart, i);
      var key = VH.fmt.day(day);
      var isToday = key === today;
      head.push('<div class="p-space-xs rounded-xl ' +
        (isToday ? 'bg-surface-container-highest/60 text-primary' : 'bg-surface-container-high/40') + '">' +
        '<span class="block font-label-sm text-label-sm uppercase ' +
        (isToday ? 'font-semibold' : 'text-on-surface-variant') + '">' +
        VH.fmt.weekday(key) + (isToday ? ' (today)' : '') + '</span>' +
        '<span class="font-title-md text-title-md text-on-surface' + (isToday ? ' font-bold' : '') +
        '">' + VH.fmt.date(key) + '</span></div>');

      var dayEvents = state.events.filter(function (e) {
        return e.start_time.slice(0, 10) === key;
      });
      var cursor = isToday ? nowMarker() : '';
      columns.push('<div class="relative flex flex-col rounded-xl bg-surface-container-lowest/40 p-1" ' +
        'style="height:' + COLUMN_PX + 'px" data-day="' + key + '">' + cursor +
        dayEvents.map(eventCard).join('') + '</div>');
    }

    html('sched-head', head.join(''));

    var labels = [];
    for (var h = DAY_START; h < DAY_END; h += 1) {
      var suffix = h >= 12 ? 'PM' : 'AM';
      var display = h % 12 === 0 ? 12 : h % 12;
      labels.push('<div class="flex items-start" style="height:' + PX_PER_HOUR + 'px">' +
        '<span class="' + (h === new Date().getHours() ? 'text-primary font-semibold' : '') + '">' +
        (display < 10 ? '0' : '') + display + ':00 ' + suffix + '</span></div>');
    }

    var grid = $('sched-grid');
    if (grid) {
      grid.innerHTML = '<div class="relative flex flex-col text-left font-label-sm text-label-sm ' +
        'text-on-surface-variant pl-2 pr-2" id="sched-times" style="height:' + COLUMN_PX + 'px">' +
        labels.join('') + '</div>' + columns.join('');
    }

    var outside = state.events.filter(function (e) {
      var start = VH.fmt.parse(e.start_time);
      return hoursInto(start) < DAY_START || hoursInto(start) >= DAY_END;
    });
    var weekend = state.events.filter(function (e) {
      var d = VH.fmt.parse(e.start_time).getDay();
      return d === 0 || d === 6;
    });
    var notes = [];
    if (outside.length) notes.push(outside.length + ' outside 08:00–18:00');
    if (weekend.length) notes.push(weekend.length + ' at the weekend');
    set('sched-note', notes.length
      ? 'Grid shows Mon–Fri, 08:00–18:00. Not shown: ' + notes.join(', ') + '.'
      : 'Grid shows Mon–Fri, 08:00–18:00.');

    applyFilter(state.filter);
  }

  function nowMarker() {
    var now = new Date();
    var at = hoursInto(now);
    if (at < DAY_START || at > DAY_END) return '';
    var top = (at - DAY_START) * PX_PER_HOUR;
    return '<div class="absolute left-0 right-0 z-20 flex items-center pointer-events-none" ' +
      'style="top:' + top.toFixed(0) + 'px">' +
      '<span class="w-2 h-2 rounded-full bg-primary -ml-1"></span>' +
      '<div class="flex-1 h-px bg-primary/70"></div></div>';
  }

  /* ------------------------------------------------------------------
   * Filters
   * ---------------------------------------------------------------- */

  function renderFilters() {
    var counts = {};
    state.events.forEach(function (e) {
      counts[e.event_type] = (counts[e.event_type] || 0) + 1;
    });
    var types = Object.keys(counts).sort();
    var pills = [{ key: 'all', label: 'All (' + state.events.length + ')' }].concat(
      types.map(function (t) {
        return { key: t, label: VH.fmt.title(t) + ' (' + counts[t] + ')' };
      }));
    html('sched-filters', pills.map(function (pill) {
      var active = pill.key === state.filter;
      return '<button class="filter-pill px-space-sm py-1 rounded-full text-label-sm font-label-sm ' +
        'transition-all ' + (active
          ? 'bg-primary text-on-primary font-semibold shadow-sm'
          : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface') +
        '" data-filter="' + VH.fmt.esc(pill.key) + '">' + VH.fmt.esc(pill.label) + '</button>';
    }).join(''));
  }

  function applyFilter(filter) {
    state.filter = filter;
    Array.prototype.forEach.call(document.querySelectorAll('.schedule-card'), function (card) {
      var match = filter === 'all' || card.getAttribute('data-type') === filter;
      card.style.opacity = match ? '1' : '0.2';
      card.style.filter = match ? 'none' : 'grayscale(80%)';
    });
    renderFilters();
  }

  /* ------------------------------------------------------------------
   * Banner, deadlines, insight cards
   * ---------------------------------------------------------------- */

  function nextExamish() {
    /* An exam beats a nearer non-exam: it is the thing worth a red banner. */
    var open = state.tasks.filter(function (t) { return t.due_date; });
    var exams = open.filter(function (t) {
      return t.task_type === 'exam' || t.task_type === 'quiz';
    });
    var pool = exams.length ? exams : open;
    pool.sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; });
    return pool[0] || null;
  }

  function renderBanner() {
    var task = nextExamish();
    var banner = $('sched-banner');
    if (!task) {
      set('sched-banner-title', 'Nothing on the clock');
      set('sched-banner-tag', 'clear');
      set('sched-banner-body', 'No open task carries a due date right now.');
      set('sched-banner-countdown', '—');
      if (banner) $('sched-banner-bar').className = 'absolute left-0 top-0 bottom-0 w-1.5 bg-primary';
      return;
    }
    var urgent = task.hours_until_due !== undefined && task.hours_until_due !== null
      ? task.hours_until_due < 72 : false;
    var tone = task.is_overdue ? 'error' : urgent ? 'error' : 'secondary';
    $('sched-banner-bar').className = 'absolute left-0 top-0 bottom-0 w-1.5 bg-' + tone;
    $('sched-banner-icon-wrap').className = 'p-space-xs rounded-xl bg-' + tone +
      '-container text-' + tone + ' flex items-center justify-center';
    set('sched-banner-icon', task.is_overdue ? 'error' : urgent ? 'crisis_alert' : 'event_upcoming');
    set('sched-banner-title', task.task_name);
    var tag = $('sched-banner-tag');
    tag.className = 'px-space-xs py-0.5 rounded-md bg-' + tone + '/20 text-' + tone +
      ' font-label-sm text-label-sm font-semibold tracking-wide';
    tag.textContent = VH.fmt.title(task.task_type);
    set('sched-banner-body', (task.subject || 'General') + ' · due ' +
      VH.fmt.longDate(task.due_date) + ' at ' + VH.fmt.clock(task.due_date) +
      (task.estimated_effort_hours ? ' · ' + VH.fmt.hours(task.estimated_effort_hours) +
        ' estimated' : ''));
    set('sched-banner-countdown', VH.fmt.until(task.due_date));
    var action = $('sched-banner-action');
    if (action) action.setAttribute('data-task', task.task_id);
  }

  function renderDeadlines() {
    var open = state.tasks.slice();
    set('sched-pending', open.length + ' open');
    html('sched-deadlines', open.length
      ? open.slice(0, 12).map(function (task) {
          var late = task.is_overdue === 1;
          return '<div class="p-space-sm rounded-xl bg-surface-container hover:bg-surface-container-high ' +
            'transition-colors flex flex-col gap-space-xs" data-task="' + task.task_id + '">' +
            '<div class="flex items-center justify-between gap-2">' +
            '<span class="px-2 py-0.5 rounded text-[11px] font-bold font-label-sm ' +
            'bg-primary/20 text-primary truncate max-w-[60%]">' +
            VH.fmt.esc(task.subject || 'General') + '</span>' +
            '<span class="px-2 py-0.5 rounded-full font-label-sm text-label-sm font-semibold ' +
            'flex items-center gap-1 flex-shrink-0 ' +
            (late ? 'bg-error/15 text-error' : 'bg-surface-container-high text-on-surface-variant') + '">' +
            '<span class="material-symbols-outlined text-[13px]">timer</span>' +
            VH.fmt.esc(task.due_date ? VH.fmt.until(task.due_date) : 'no date') + '</span></div>' +
            '<h3 class="font-title-md text-label-lg text-on-surface">' +
            VH.fmt.esc(task.task_name) + '</h3>' +
            '<div class="flex items-center justify-between gap-2 pt-space-xs">' +
            '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
            VH.fmt.esc(VH.fmt.title(task.task_type)) + ' · ' + VH.fmt.esc(VH.fmt.title(task.priority)) +
            (task.estimated_effort_hours ? ' · ' + VH.fmt.hours(task.estimated_effort_hours) : '') +
            '</span>' +
            '<button class="px-2 py-0.5 rounded-lg bg-surface-container-highest hover:bg-surface-bright ' +
            'text-on-surface font-label-sm text-label-sm transition-colors" data-book="' +
            task.task_id + '">Book time</button></div></div>';
        }).join('')
      : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing open. Add a task ' +
        'with <strong class="text-primary">+ Quick Task</strong>.</p>');
  }

  function renderInsights() {
    /* Hours of fixed commitments inside the displayed week. */
    var fixedHours = 0;
    var examEvents = 0;
    state.events.forEach(function (e) {
      var hours = (VH.fmt.parse(e.end_time) - VH.fmt.parse(e.start_time)) / 3600000;
      if (e.is_fixed) fixedHours += hours;
      if (e.event_type === 'exam') examEvents += 1;
    });
    set('sched-load', VH.fmt.num(fixedHours, 1));
    var bar = $('sched-load-bar');
    /* 40h of fixed commitments in a week is taken as a full bar. */
    if (bar) bar.style.width = VH.clamp01(fixedHours / 40 * 100) + '%';

    var examTasks = state.tasks.filter(function (t) {
      return t.task_type === 'exam' || t.task_type === 'quiz';
    });
    var total = examEvents + examTasks.length;
    set('sched-exams', total ? String(total) : 'None');
    set('sched-exams-note', total
      ? examTasks.length + ' on the task list, ' + examEvents + ' on the calendar'
      : 'No exams or quizzes outstanding');
    var soonest = examTasks.slice().sort(function (a, b) {
      return (a.due_date || '9') < (b.due_date || '9') ? -1 : 1;
    })[0];
    set('sched-exams-sub', soonest
      ? 'Next: ' + soonest.task_name + ' ' + VH.fmt.until(soonest.due_date)
      : 'Nothing scheduled');

    var free = ctx.insights.averages.avg_available_hours;
    set('sched-free', VH.fmt.num(free, 1));
    set('sched-free-note', free === null || free === undefined
      ? 'Log a night of sleep and a lecture to get this.'
      : 'Waking hours left per day once sleep, fixed events and 3h of meals ' +
        'and travel come out. You are using ' +
        VH.fmt.num(ctx.insights.averages.avg_study_hours, 1) + 'h of it.');

    var best = (ctx.insights.focus_by_part_of_day || [])[0];
    set('sched-window-title', best ? VH.fmt.title(best.part_of_day) : 'Not enough sessions yet');
    set('sched-window-note', best
      ? VH.fmt.num(best.avg_focus) + '/5 average focus across ' + best.sessions + ' sessions'
      : 'Log a few focus sessions and this fills in.');

    set('sched-planner-note', 'Blocks you add here are written to calendar_events and ' +
      'immediately count against your available study hours.');
  }

  /* ------------------------------------------------------------------
   * Writing
   * ---------------------------------------------------------------- */

  function toLocalInput(date) {
    function pad(n) { return String(n).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  function nextHour() {
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  }

  function openAddBlock(task) {
    var modal = $('study-modal');
    if (!modal) return;
    var form = $('sched-form');
    form.reset();
    form.elements.start_time.value = toLocalInput(nextHour());
    var select = $('sched-form-task');
    select.innerHTML = '<option value="">No specific task</option>' +
      state.tasks.map(function (t) {
        return '<option value="' + t.task_id + '"' +
          (task && task.task_id === t.task_id ? ' selected' : '') + '>' +
          VH.fmt.esc((t.subject ? t.subject + ' · ' : '') + t.task_name) + '</option>';
      }).join('');
    if (task) form.elements.event_name.value = 'Study: ' + task.task_name;
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    form.elements.event_name.focus();
  }

  function closeAddBlock() {
    var modal = $('study-modal');
    if (!modal) return;
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }

  async function submitBlock(form) {
    var data = new FormData(form);
    var startRaw = data.get('start_time');
    if (!startRaw) return;
    var start = VH.fmt.parse(startRaw.replace('T', ' '));
    var end = new Date(start.getTime() + Number(data.get('minutes') || 60) * 60000);
    await VH.api.createEvent(ctx.student.student_id, {
      event_name: (data.get('event_name') || 'Study block').trim(),
      event_type: 'personal',
      start_time: VH.fmt.stamp(start),
      end_time: VH.fmt.stamp(end),
      is_fixed: false,
      location: (data.get('location') || '').trim() || null
    });
    closeAddBlock();
    VH.toast('Block added on ' + VH.fmt.longDate(VH.fmt.stamp(start)) + '.');
    await reload();
  }

  /* Fill the gaps on the calendar with focus blocks for whatever is due next. */
  async function autoSchedule(button) {
    var open = state.tasks.filter(function (t) { return t.due_date; })
      .sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })
      .slice(0, 3);
    if (!open.length) {
      VH.toast('Nothing with a due date to schedule around.', 'info');
      return;
    }
    var original = button.innerHTML;
    button.disabled = true;
    button.innerHTML = '<span class="material-symbols-outlined text-[18px]">sync</span>' +
      '<span>Finding gaps…</span>';
    try {
      var placed = 0;
      for (var i = 0; i < open.length; i += 1) {
        var slot = findSlot(i);
        if (!slot) continue;
        await VH.api.createEvent(ctx.student.student_id, {
          event_name: 'Focus: ' + open[i].task_name,
          event_type: 'personal',
          start_time: VH.fmt.stamp(slot),
          end_time: VH.fmt.stamp(new Date(slot.getTime() + 50 * 60000)),
          is_fixed: false,
          location: 'Deep work'
        });
        placed += 1;
      }
      VH.toast(placed ? placed + ' focus block' + (placed === 1 ? '' : 's') + ' added.'
                      : 'No free hours left in the next few days.', placed ? 'ok' : 'info');
      await reload();
    } finally {
      button.disabled = false;
      button.innerHTML = original;
    }
  }

  /* Walk forward from the next hour looking for an hour with nothing in it. */
  function findSlot(skip) {
    var cursor = nextHour();
    var found = 0;
    for (var step = 0; step < 24 * 5; step += 1) {
      var hour = cursor.getHours();
      if (hour >= DAY_START && hour < DAY_END) {
        var start = cursor.getTime();
        var end = start + 50 * 60000;
        var clash = state.events.some(function (e) {
          var s = VH.fmt.parse(e.start_time).getTime();
          var f = VH.fmt.parse(e.end_time).getTime();
          return s < end && f > start;
        });
        if (!clash) {
          if (found === skip) return new Date(start);
          found += 1;
        }
      }
      cursor = new Date(cursor.getTime() + 3600000);
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * Loading
   * ---------------------------------------------------------------- */

  async function reload() {
    var id = ctx.student.student_id;
    var from = VH.fmt.day(state.weekStart);
    var to = VH.fmt.day(addDays(state.weekStart, 7));
    var results = await Promise.all([
      VH.api.events(id, { from: from + ' 00:00:00', to: to + ' 00:00:00' }),
      VH.api.tasks(id, { open_only: true }),
      VH.api.insights(id, 14),
      VH.api.health()
    ]);
    state.events = results[0];
    state.tasks = results[1];
    ctx.insights = results[2];

    set('sched-range', VH.fmt.date(from) + ' – ' +
      VH.fmt.date(VH.fmt.day(addDays(state.weekStart, 6))));
    set('sched-sync', 'Read live from the database');
    set('sched-db', results[3].students + ' students · ' + results[3].database);
    set('sched-db-events', state.events.length + ' events in this week');

    renderGrid();
    renderBanner();
    renderDeadlines();
    renderInsights();
  }

  function wire() {
    var filters = $('sched-filters');
    if (filters) {
      filters.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-filter]');
        if (btn) applyFilter(btn.getAttribute('data-filter'));
      });
    }

    var views = { 'view-weekly': 0, 'view-day': 0, 'view-exams': 0 };
    Object.keys(views).forEach(function (id) {
      var btn = $(id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        Object.keys(views).forEach(function (other) {
          var el = $(other);
          if (el) {
            el.className = 'px-space-sm py-1.5 rounded-lg font-label-md text-label-md ' +
              'text-on-surface-variant hover:text-on-surface transition-all';
          }
        });
        btn.className = 'px-space-sm py-1.5 rounded-lg font-label-md text-label-md ' +
          'bg-primary-container text-on-primary shadow-sm transition-all';
        if (id === 'view-exams') applyFilter('exam');
        else if (id === 'view-day') {
          state.weekStart = mondayOf(new Date());
          applyFilter('all');
          reload().catch(function (err) { VH.fail(err, 'Schedule'); });
        } else {
          applyFilter('all');
        }
      });
    });

    function shiftWeek(days) {
      state.weekStart = addDays(state.weekStart, days);
      reload().catch(function (err) { VH.fail(err, 'Schedule'); });
    }
    var prev = $('sched-prev');
    if (prev) prev.addEventListener('click', function () { shiftWeek(-7); });
    var next = $('sched-next');
    if (next) next.addEventListener('click', function () { shiftWeek(7); });
    var thisWeek = $('sched-today');
    if (thisWeek) {
      thisWeek.addEventListener('click', function () {
        state.weekStart = mondayOf(new Date());
        reload().catch(function (err) { VH.fail(err, 'Schedule'); });
      });
    }

    /* "View Settings" had no handler. The settings it implies are the
     * interface preferences, so it goes there. */
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (btn) {
      if (/View Settings/i.test(btn.textContent)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          window.location.href = 'settings.html';
        });
      }
    });

    var add = $('sched-add');
    if (add) add.addEventListener('click', function (e) { e.preventDefault(); openAddBlock(null); });

    var auto = $('sched-auto');
    if (auto) {
      auto.addEventListener('click', function (e) {
        e.preventDefault();
        autoSchedule(auto).catch(function (err) { VH.fail(err, 'Auto-schedule'); });
      });
    }

    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-close-modal]')) { closeAddBlock(); return; }
      var book = e.target.closest('[data-book]');
      if (book) {
        var id = Number(book.getAttribute('data-book'));
        openAddBlock(state.tasks.filter(function (t) { return t.task_id === id; })[0]);
        return;
      }
      var action = e.target.closest('#sched-banner-action');
      if (action) {
        var taskId = action.getAttribute('data-task');
        window.location.href = taskId ? 'focus.html?task=' + taskId : 'focus.html';
      }
    });

    var modal = $('study-modal');
    if (modal) {
      modal.addEventListener('click', function (e) { if (e.target === modal) closeAddBlock(); });
    }
    var form = $('sched-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        submitBlock(form).catch(function (err) { VH.fail(err, 'Add block'); });
      });
    }

    [$('sched-refresh'), $('sched-refresh-all')].forEach(function (btn) {
      if (!btn) return;
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        reload().then(function () { VH.toast('Reloaded from the database.'); })
          .catch(function (err) { VH.fail(err, 'Reload'); });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') closeAddBlock();
    });
    document.addEventListener('vh:task-created', function () {
      reload().catch(function (err) { VH.fail(err, 'Reload'); });
    });

    /* Click an event card to remove a block you added. Fixed events (lectures)
     * are left alone - deleting a lecture from a timetable view would be a
     * surprising thing for a click to do. */
    var grid = $('sched-grid');
    if (grid) {
      grid.addEventListener('click', function (e) {
        var card = e.target.closest('[data-event]');
        if (!card) return;
        var id = Number(card.getAttribute('data-event'));
        var event = state.events.filter(function (ev) { return ev.event_id === id; })[0];
        if (!event || event.is_fixed) return;
        if (!window.confirm('Remove "' + event.event_name + '" from the calendar?')) return;
        VH.api.deleteEvent(id).then(function () {
          VH.toast('Block removed.');
          return reload();
        }).catch(function (err) { VH.fail(err, 'Remove block'); });
      });
    }
  }

  async function boot() {
    ctx = await VH.shell.boot('schedule');
    if (!ctx) return;
    state.weekStart = mondayOf(new Date());
    wire();
    await reload();
  }

  boot().catch(function (err) { VH.fail(err, 'Schedule'); });
})(window.VH);
