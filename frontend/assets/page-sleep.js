/* Sleep & wellbeing.
 *
 * sleep_logs stores four things: the date, when you went to bed, when you got
 * up, and a 1-5 quality rating. That is the whole basis of this screen. Where
 * the export showed a sensor reading - HRV, a deep/REM split, a resting pulse -
 * the card now shows something the log can actually answer: how consistent the
 * bedtimes are, and what mood and energy were reported alongside them.
 */
(function (VH) {
  'use strict';

  /* The student's own target, read from /insights on every load. Eight hours
   * is only the default; the profile page can move it. */
  var GOAL_MIN = 480;
  var PLOT_MAX_MIN = 600;      // the chart tops out 25% above the target

  function applyGoal(insights) {
    GOAL_MIN = (insights.goals && insights.goals.sleep_goal_minutes) || 480;
    PLOT_MAX_MIN = Math.round(GOAL_MIN * 1.25);
    var label = VH.fmt.hours(GOAL_MIN / 60);
    set('sleep-goal-label', label + ' target');
    set('sleep-goal-legend', label);
  }

  var ctx = null;
  var state = { sleep: [], mood: [], screen: [], events: [], tasks: [], draft: {} };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }
  function width(id, pct) { var el = $(id); if (el) el.style.width = VH.clamp01(pct) + '%'; }

  function band(score, labels) {
    if (score === null || score === undefined) return 'no data yet';
    if (score >= 80) return labels[0];
    if (score >= 65) return labels[1];
    if (score >= 45) return labels[2];
    return labels[3];
  }

  /* Bedtimes straddle midnight, so they are measured from 18:00: 22:30 becomes
   * 270 and 01:30 becomes 450, which keeps the arithmetic monotonic. */
  function bedtimeOffset(stamp) {
    var d = VH.fmt.parse(stamp);
    if (!d) return null;
    var minutes = d.getHours() * 60 + d.getMinutes();
    return (minutes - 18 * 60 + 1440) % 1440;
  }

  function offsetToClock(offset) {
    var minutes = Math.round((offset + 18 * 60) % 1440);
    var d = new Date();
    d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
    return VH.fmt.clock(VH.fmt.stamp(d));
  }

  function mean(values) {
    return values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : null;
  }

  /* ------------------------------------------------------------------
   * KPI row
   * ---------------------------------------------------------------- */

  function renderKpis() {
    var last = state.sleep[0] || null;
    var minutes = last ? last.duration_minutes : null;

    set('kpi-duration-value', minutes ? VH.fmt.hours(minutes / 60) : '--');
    set('kpi-duration-unit', '/ ' + VH.fmt.hours(GOAL_MIN / 60) + ' goal');
    width('kpi-duration-bar', minutes ? minutes / GOAL_MIN * 100 : 0);
    set('kpi-duration-tag', minutes
      ? (minutes >= GOAL_MIN ? '+' : '−') + VH.fmt.hours(Math.abs(minutes - GOAL_MIN) / 60)
      : 'no log');
    set('kpi-duration-foot', last && last.bedtime
      ? 'Bed ' + VH.fmt.clock(last.bedtime) + ' · up ' + VH.fmt.clock(last.wake_time)
      : 'Nothing logged yet');
    set('kpi-duration-note', last ? VH.fmt.longDate(last.sleep_date) : '');

    /* Consistency: the spread of bedtimes across the logged week. */
    var offsets = state.sleep.slice(0, 7)
      .map(function (r) { return bedtimeOffset(r.bedtime); })
      .filter(function (v) { return v !== null; });
    var spread = null;
    if (offsets.length > 1) {
      var avg = mean(offsets);
      spread = Math.sqrt(mean(offsets.map(function (v) { return (v - avg) * (v - avg); })));
    }
    set('kpi-consistency-value', spread === null ? '--' : '±' + Math.round(spread));
    set('kpi-consistency-unit', spread === null ? '' : 'min');
    /* A 90-minute spread is treated as the point where consistency is gone. */
    var consistencyScore = spread === null ? null : Math.max(0, 100 - spread / 90 * 100);
    width('kpi-consistency-bar', consistencyScore || 0);
    set('kpi-consistency-tag', band(consistencyScore, ['steady', 'fair', 'drifting', 'erratic']));
    set('kpi-consistency-foot', offsets.length > 1
      ? 'Bed between ' + offsetToClock(Math.min.apply(null, offsets)) + ' and ' +
        offsetToClock(Math.max.apply(null, offsets))
      : 'Needs two nights with a bedtime');
    set('kpi-consistency-note', offsets.length + ' night' + (offsets.length === 1 ? '' : 's'));

    var latestMood = state.mood[0] || null;
    set('kpi-mood-value', latestMood && latestMood.mood_score !== null
      ? VH.fmt.num(latestMood.mood_score, 0) : '--');
    set('kpi-mood-unit', '/ 10 mood');
    width('kpi-mood-bar', latestMood && latestMood.mood_score ? latestMood.mood_score * 10 : 0);
    set('kpi-mood-tag', latestMood && latestMood.energy_score
      ? 'energy ' + latestMood.energy_score + '/10' : 'no check-in');
    set('kpi-mood-foot', latestMood
      ? 'Checked in ' + VH.fmt.longDate(latestMood.date)
      : 'Use the check-in below');
    set('kpi-mood-note', ctx.insights.mood.avg_mood
      ? 'avg ' + VH.fmt.num(ctx.insights.mood.avg_mood) : '');

    /* Recovery blends how much sleep was had with how much energy it produced -
     * both are self-reported, and the card says so. */
    var sleepScore = ctx.insights.scores.sleep_health;
    var energyScore = ctx.insights.scores.resilience;
    var recovery = null;
    if (sleepScore !== null || energyScore !== null) {
      recovery = sleepScore === null ? energyScore
        : energyScore === null ? sleepScore
        : Math.round(sleepScore * 0.6 + energyScore * 0.4);
    }
    set('kpi-recovery-value', recovery === null ? '--' : String(Math.round(recovery)));
    set('kpi-recovery-unit', '/ 100');
    width('kpi-recovery-bar', recovery || 0);
    set('kpi-recovery-tag', band(recovery, ['strong', 'steady', 'low', 'depleted']));
    set('kpi-recovery-foot', '60% sleep, 40% reported energy');
    set('kpi-recovery-note', 'self-reported');
  }

  /* ------------------------------------------------------------------
   * Chart and drift
   * ---------------------------------------------------------------- */

  function renderChart() {
    var nights = state.sleep.slice(0, 7).reverse();
    set('sleep-chart-sub', nights.length
      ? 'Time in bed each night against your ' + VH.fmt.hours(GOAL_MIN / 60) + ' target'
      : 'No nights logged yet — use “Log last night”.');
    html('sleep-chart', nights.length
      ? nights.map(function (night) {
          var minutes = night.duration_minutes || 0;
          var height = Math.max(3, Math.min(100, minutes / PLOT_MAX_MIN * 100));
          var short = minutes < GOAL_MIN;
          return '<div class="flex flex-col items-center gap-2 group h-full justify-end" title="' +
            VH.fmt.esc(night.sleep_date + (night.quality ? ' · quality ' + night.quality + '/5' : '')) +
            '">' +
            '<span class="font-label-sm text-label-sm text-on-surface-variant group-hover:text-on-surface ' +
            'transition-colors">' + VH.fmt.hours(minutes / 60) + '</span>' +
            '<div class="w-full max-w-[42px] rounded-t-lg transition-all group-hover:scale-105 ' +
            (short ? 'bg-error' : 'bg-primary') + '" style="height: ' + height.toFixed(0) + '%;"></div>' +
            '<span class="font-label-sm text-label-sm ' +
            (short ? 'text-error font-semibold' : 'text-on-surface-variant') + '">' +
            VH.fmt.weekday(night.sleep_date) + '</span></div>';
        }).join('')
      : '<div class="col-span-7 self-center text-center font-body-sm text-body-sm ' +
        'text-on-surface-variant">Nothing to plot yet.</div>');
  }

  function driftCard(icon, tone, title, body) {
    return '<div class="flex items-center gap-space-sm p-space-sm rounded-xl bg-surface-container">' +
      '<span class="material-symbols-outlined text-' + tone + ' text-[24px] flex-shrink-0">' +
      icon + '</span><div class="flex flex-col min-w-0">' +
      '<span class="font-title-md text-title-md text-on-surface">' + VH.fmt.esc(title) + '</span>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">' + VH.fmt.esc(body) +
      '</span></div></div>';
  }

  function targetBedtime() {
    var wakes = state.sleep.filter(function (r) { return r.wake_time; }).slice(0, 7);
    if (!wakes.length) return null;
    var minutes = wakes.map(function (r) {
      var d = VH.fmt.parse(r.wake_time);
      return d.getHours() * 60 + d.getMinutes();
    });
    var bed = (mean(minutes) - GOAL_MIN + 1440) % 1440;
    var d = new Date();
    d.setHours(Math.floor(bed / 60), Math.round(bed % 60), 0, 0);
    return d;
  }

  function renderDrift() {
    var offsets = state.sleep.slice(0, 7)
      .map(function (r) { return bedtimeOffset(r.bedtime); })
      .filter(function (v) { return v !== null; });
    var cards = [];

    if (offsets.length > 1) {
      var lo = Math.min.apply(null, offsets);
      var hi = Math.max.apply(null, offsets);
      cards.push(driftCard('timelapse', 'secondary',
        'Bedtime spread: ' + VH.fmt.hm(hi - lo),
        'Earliest ' + offsetToClock(lo) + ', latest ' + offsetToClock(hi) + ' across ' +
        offsets.length + ' nights.'));
    } else {
      cards.push(driftCard('timelapse', 'secondary', 'Bedtime spread: not enough data',
        'Log a bedtime on at least two nights.'));
    }

    var debt = ctx.insights.sleep_debt_hours;
    cards.push(driftCard(debt !== null && debt < 0 ? 'warning' : 'check_circle',
      debt !== null && debt < 0 ? 'error' : 'primary',
      debt === null ? 'Sleep balance: no data'
        : debt < 0 ? 'Sleep debt: ' + VH.fmt.hours(Math.abs(debt))
        : 'Sleep surplus: ' + VH.fmt.hours(debt),
      debt === null ? 'Nothing logged in the window.'
        : 'Against ' + VH.fmt.hours(GOAL_MIN / 60) + ' a night over the ' +
          (ctx.insights.averages.days_logged || 0) + ' days you logged.'));

    var target = targetBedtime();
    cards.push(driftCard('wb_twilight', 'primary',
      target ? 'Target bedtime: ' + VH.fmt.clock(VH.fmt.stamp(target)) : 'Target bedtime: --',
      target ? VH.fmt.hours(GOAL_MIN / 60) + ' before your average wake time this week.'
             : 'Log a wake time and this fills in.'));

    html('sleep-drift', cards.join(''));
  }

  /* ------------------------------------------------------------------
   * Cognitive load
   * ---------------------------------------------------------------- */

  function loadRow(icon, title, value, pct, tone, note) {
    return '<div class="flex flex-col gap-1.5 p-space-sm rounded-xl bg-surface-container">' +
      '<div class="flex items-center justify-between gap-2">' +
      '<div class="flex items-center gap-space-xs min-w-0">' +
      '<span class="material-symbols-outlined text-[18px] text-' + tone + ' flex-shrink-0">' +
      icon + '</span>' +
      '<span class="font-label-md text-label-md text-on-surface truncate">' +
      VH.fmt.esc(title) + '</span></div>' +
      '<span class="font-label-sm text-label-sm text-' + tone + ' font-semibold flex-shrink-0">' +
      VH.fmt.esc(value) + '</span></div>' +
      '<div class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden">' +
      '<div class="bg-' + tone + ' h-full rounded-full" style="width:' +
      VH.clamp01(pct) + '%"></div></div>' +
      '<span class="font-body-sm text-body-sm text-on-surface-variant">' + VH.fmt.esc(note) +
      '</span></div>';
  }

  function renderLoad() {
    var rows = [];
    var factors = [];

    var next = state.tasks.filter(function (t) { return t.due_date; })
      .sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })[0];
    if (next) {
      var hours = next.hours_until_due;
      /* Inside 72 hours counts as full pressure. */
      var pressure = hours === null || hours === undefined ? 50
        : Math.max(0, Math.min(100, (72 - hours) / 72 * 100));
      factors.push({ pct: pressure, row: loadRow('menu_book',
        next.task_name, Math.round(pressure) + '/100',
        pressure, pressure > 60 ? 'error' : 'secondary',
        (next.subject || 'General') + ' · due ' + VH.fmt.until(next.due_date) +
        (next.estimated_effort_hours ? ' · ' + VH.fmt.hours(next.estimated_effort_hours) +
          ' of work estimated' : '')) });
    }

    var today = state.screen[0];
    if (today) {
      var distract = today.social_media_minutes + today.entertainment_minutes;
      var share = today.total_screen_minutes
        ? distract / today.total_screen_minutes * 100 : 0;
      factors.push({ pct: share, row: loadRow('devices', 'Social and entertainment screen time',
        VH.fmt.hm(distract), share, share > 50 ? 'error' : 'secondary',
        Math.round(share) + '% of ' + VH.fmt.hm(today.total_screen_minutes) +
        ' logged on ' + VH.fmt.longDate(today.date) + '.') });
    }

    var debt = ctx.insights.sleep_debt_hours;
    if (debt !== null) {
      /* 20 hours behind over the window is taken as the top of the scale. */
      var debtPct = debt >= 0 ? 0 : Math.min(100, Math.abs(debt) / 20 * 100);
      factors.push({ pct: debtPct, row: loadRow('battery_charging_20', 'Accumulated sleep debt',
        debt >= 0 ? 'none' : VH.fmt.hours(Math.abs(debt)), debtPct,
        debtPct > 50 ? 'error' : 'primary',
        debt >= 0 ? 'You are at or above your ' + VH.fmt.hours(GOAL_MIN / 60) + ' target on average.'
          : 'Averaging ' + VH.fmt.hours(ctx.insights.averages.avg_sleep_minutes / 60) +
            ' against a ' + VH.fmt.hours(GOAL_MIN / 60) + ' goal.') });
    }

    factors.sort(function (a, b) { return b.pct - a.pct; });
    rows = factors.map(function (f) { return f.row; });

    html('load-factors', rows.length ? rows.join('')
      : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing logged to rank yet.</p>');
    set('load-sub', 'Ranked by how far each one is from where it should be');

    var worst = factors[0] ? factors[0].pct : 0;
    var badge = $('load-badge');
    if (badge) {
      var label = worst > 66 ? 'High' : worst > 33 ? 'Moderate' : 'Low';
      var tone = worst > 66 ? 'error' : worst > 33 ? 'secondary' : 'primary';
      badge.className = 'px-space-sm py-1 rounded-full bg-' + tone + '/15 text-' + tone +
        ' font-label-sm text-label-sm font-semibold';
      badge.textContent = label + ' strain';
    }
  }

  /* ------------------------------------------------------------------
   * Verdict and today's items
   * ---------------------------------------------------------------- */

  function renderVerdict() {
    var last = state.sleep[0];
    var minutes = last ? last.duration_minutes : null;
    var short = minutes !== null && minutes < GOAL_MIN - 60;
    var tone = minutes === null ? 'secondary' : short ? 'error' : 'primary';

    var wrap = $('verdict');
    if (wrap) {
      wrap.className = 'flex flex-col md:flex-row md:items-center justify-between gap-space-sm ' +
        'p-space-md rounded-xl bg-' + tone + '/10 border border-' + tone + '/30';
    }
    var icon = $('verdict-icon');
    if (icon) {
      icon.className = 'material-symbols-outlined text-[24px] text-' + tone;
      icon.textContent = minutes === null ? 'info' : short ? 'warning' : 'check_circle';
    }
    var title = $('verdict-title');
    if (title) title.className = 'font-title-md text-title-md text-' + tone;
    set('verdict-title', minutes === null
      ? 'No sleep logged for last night'
      : short ? 'Short night: ' + VH.fmt.hm(minutes)
              : 'Rested: ' + VH.fmt.hm(minutes));
    set('verdict-body', minutes === null
      ? 'Log last night and this page fills in.'
      : VH.fmt.longDate(last.sleep_date) + (last.quality ? ' · you rated it ' + last.quality + '/5' : '') +
        ' · 14-day average ' + VH.fmt.hours(ctx.insights.averages.avg_sleep_minutes / 60) + '.');
    var tag = $('verdict-tag');
    if (tag) {
      tag.className = 'px-space-sm py-1 rounded-full bg-' + tone + '/20 text-' + tone +
        ' font-label-sm text-label-sm font-semibold flex-shrink-0';
      tag.textContent = minutes === null ? 'no data' : short ? 'below goal' : 'on target';
    }
  }

  function renderClearance() {
    var today = ctx.insights.today;
    var todays = state.events.filter(function (e) {
      return e.start_time.slice(0, 10) === today;
    });
    var minutes = state.sleep[0] ? state.sleep[0].duration_minutes : null;
    var short = minutes !== null && minutes < GOAL_MIN - 60;

    var items = todays.map(function (e) {
      var demanding = e.event_type === 'exam' || e.event_type === 'lab';
      return {
        icon: e.event_type === 'exam' ? 'assignment_late'
          : e.event_type === 'lab' ? 'terminal' : 'school',
        title: e.event_name + ' (' + VH.fmt.clock(e.start_time) + ')',
        tone: demanding && short ? 'error' : 'primary',
        tag: demanding && short ? 'demanding on little sleep' : VH.fmt.title(e.event_type),
        body: (e.location ? e.location + ' · ' : '') +
          VH.fmt.clock(e.start_time) + '–' + VH.fmt.clock(e.end_time) +
          (demanding && short
            ? '. You logged ' + VH.fmt.hm(minutes) + ' last night; plan a break before this one.'
            : '.')
      };
    });

    var nextExam = state.tasks.filter(function (t) {
      return (t.task_type === 'exam' || t.task_type === 'quiz') && t.due_date;
    }).sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })[0];
    if (nextExam) {
      items.push({
        icon: 'event_upcoming',
        title: nextExam.task_name,
        tone: short ? 'error' : 'secondary',
        tag: VH.fmt.until(nextExam.due_date),
        body: (nextExam.subject || 'General') + ' · due ' + VH.fmt.longDate(nextExam.due_date) +
          (short ? '. At your current average of ' +
            VH.fmt.hours(ctx.insights.averages.avg_sleep_minutes / 60) +
            ' a night, the nights before this one are worth protecting.' : '.')
      });
    }

    html('clearance-items', items.length
      ? items.map(function (item) {
          return '<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-space-sm ' +
            'p-space-md rounded-xl bg-surface-container">' +
            '<div class="flex items-start gap-space-sm min-w-0">' +
            '<div class="p-space-xs rounded-lg bg-' + item.tone + '/15 text-' + item.tone +
            ' flex items-center justify-center flex-shrink-0">' +
            '<span class="material-symbols-outlined text-[20px]">' + item.icon + '</span></div>' +
            '<div class="flex flex-col min-w-0">' +
            '<span class="font-title-md text-title-md text-on-surface">' +
            VH.fmt.esc(item.title) + '</span>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
            VH.fmt.esc(item.body) + '</p></div></div>' +
            '<span class="px-space-sm py-1 rounded-full bg-' + item.tone + '/15 text-' + item.tone +
            ' font-label-sm text-label-sm font-semibold flex-shrink-0 self-start sm:self-auto">' +
            VH.fmt.esc(item.tag) + '</span></div>';
        }).join('')
      : '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing on the calendar ' +
        'today and no exam outstanding.</p>');
  }

  /* ------------------------------------------------------------------
   * Mood check-in
   * ---------------------------------------------------------------- */

  /* The four buttons are a coarse scale; these are the mood_score values they
   * stand for, so a check-in lands on the same 1-10 column the API expects. */
  var MOODS = [
    { id: 'moodBtn-1', label: 'Calm', score: 9, tone: 'text-primary' },
    { id: 'moodBtn-2', label: 'Focused', score: 7, tone: 'text-secondary' },
    { id: 'moodBtn-3', label: 'Strained', score: 4, tone: 'text-error' },
    { id: 'moodBtn-4', label: 'Exhausted', score: 2, tone: 'text-tertiary' }
  ];

  function paintMood() {
    MOODS.forEach(function (mood) {
      var btn = $(mood.id);
      if (!btn) return;
      var active = state.draft.mood === mood.score;
      btn.classList.toggle('bg-surface-container-high', active);
      btn.classList.toggle('font-semibold', active);
      btn.classList.toggle('shadow', active);
      btn.classList.toggle('text-on-surface-variant', !active);
      MOODS.forEach(function (m) { btn.classList.remove(m.tone); });
      if (active) btn.classList.add(mood.tone);
    });
    var picked = MOODS.filter(function (m) { return m.score === state.draft.mood; })[0];
    var label = $('moodLabel');
    if (label) {
      label.textContent = picked ? picked.label : 'Not set';
      label.className = 'font-headline-sm text-headline-sm font-bold ' +
        (picked ? picked.tone : 'text-on-surface-variant');
    }
    var slider = $('stressSlider');
    if (slider) {
      var value = $('sliderValue');
      if (value) {
        value.textContent = state.draft.energy + '/10';
        value.className = 'font-title-md text-title-md font-bold ' +
          (state.draft.energy >= 7 ? 'text-primary'
            : state.draft.energy >= 4 ? 'text-secondary' : 'text-error');
      }
    }
  }

  async function saveMood() {
    if (!state.draft.mood) {
      VH.toast('Pick how you are feeling first.', 'info');
      return;
    }
    await VH.api.logMood(ctx.student.student_id, {
      date: ctx.insights.today,
      mood_score: state.draft.mood,
      energy_score: state.draft.energy
    });
    VH.toast('Check-in saved for today.');
    await reload();
  }

  /* ------------------------------------------------------------------
   * Logging a night
   * ---------------------------------------------------------------- */

  function toLocalInput(date) {
    function pad(n) { return String(n).padStart(2, '0'); }
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate()) +
      'T' + pad(date.getHours()) + ':' + pad(date.getMinutes());
  }

  var FIELD = 'w-full bg-surface-container-lowest/70 border border-outline-variant/40 rounded-lg ' +
    'px-space-sm py-space-xs text-on-surface font-body-md text-body-md ' +
    'focus:border-secondary focus:outline-none';
  var CAPTION = 'font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant';

  function sleepModal() {
    var existing = $('vh-sleep-log');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'vh-sleep-log';
    wrap.className = 'hidden fixed inset-0 z-[150] items-center justify-center p-4 ' +
      'bg-surface-container-lowest/80 backdrop-blur-sm';
    wrap.innerHTML = '<form class="w-full max-w-md rounded-2xl bg-surface-container/95 border ' +
      'border-outline-variant/40 shadow-2xl p-space-lg flex flex-col gap-space-md" id="vh-sleep-form">' +
      '<div class="flex items-center justify-between">' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface">Log a night</h3>' +
      '<button type="button" data-close class="text-on-surface-variant hover:text-on-surface">' +
      '<span class="material-symbols-outlined">close</span></button></div>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Night of</span>' +
      '<input name="sleep_date" type="date" required class="' + FIELD + '"></label>' +
      '<div class="grid grid-cols-2 gap-space-sm">' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Went to bed</span>' +
      '<input name="bedtime" type="datetime-local" class="' + FIELD + '"></label>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Got up</span>' +
      '<input name="wake_time" type="datetime-local" class="' + FIELD + '"></label></div>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">How was it (1-5)</span>' +
      '<select name="quality" class="' + FIELD + '">' +
      '<option value="">Not rated</option>' +
      [1, 2, 3, 4, 5].map(function (n) {
        return '<option value="' + n + '"' + (n === 3 ? ' selected' : '') + '>' + n + '</option>';
      }).join('') + '</select></label>' +
      '<p class="font-label-sm text-label-sm text-outline">Duration is worked out from the two ' +
      'times. One row per night — logging the same night again replaces it.</p>' +
      '<div class="flex justify-end gap-space-sm pt-space-xs">' +
      '<button type="button" data-close class="px-space-md py-space-xs rounded-lg ' +
      'bg-surface-container-high text-on-surface font-label-md text-label-md">Cancel</button>' +
      '<button type="submit" class="px-space-md py-space-xs rounded-lg bg-primary text-on-primary ' +
      'font-label-md text-label-md font-semibold">Save night</button></div></form>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-close]')) close();
    });
    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      submitSleep(e.target).catch(function (err) { VH.fail(err, 'Log sleep'); });
    });
    function close() {
      wrap.classList.add('hidden');
      wrap.classList.remove('flex');
    }
    return wrap;
  }

  function openSleepModal() {
    var wrap = sleepModal();
    var form = $('vh-sleep-form');
    var lastNight = new Date();
    var wake = new Date();
    wake.setHours(7, 30, 0, 0);
    var bed = new Date(wake.getTime() - 8 * 3600000);
    form.elements.sleep_date.value = VH.fmt.day(lastNight);
    form.elements.bedtime.value = toLocalInput(bed);
    form.elements.wake_time.value = toLocalInput(wake);
    wrap.classList.remove('hidden');
    wrap.classList.add('flex');
  }

  async function submitSleep(form) {
    var data = new FormData(form);
    var body = { sleep_date: data.get('sleep_date') };
    ['bedtime', 'wake_time'].forEach(function (key) {
      var raw = data.get(key);
      if (raw) body[key] = raw.replace('T', ' ') + (raw.length === 16 ? ':00' : '');
    });
    if (data.get('quality')) body.quality = Number(data.get('quality'));
    if (body.bedtime && body.wake_time && body.wake_time <= body.bedtime) {
      VH.toast('Wake time has to be after bedtime.', 'error');
      return;
    }
    await VH.api.logSleep(ctx.student.student_id, body);
    var wrap = $('vh-sleep-log');
    wrap.classList.add('hidden');
    wrap.classList.remove('flex');
    VH.toast('Night saved.');
    await reload();
  }

  /* ------------------------------------------------------------------
   * Summary
   * ---------------------------------------------------------------- */

  function summaryLines() {
    var ins = ctx.insights;
    var last = state.sleep[0];
    return [
      'Sleep summary for ' + ctx.student.name,
      'Generated ' + VH.fmt.longDate(ins.today) + ' from self-reported logs in VinHack.',
      '',
      'Nights logged in the last ' + ins.window_days + ' days: ' + (ins.averages.days_logged || 0),
      'Average time in bed: ' + (ins.averages.avg_sleep_minutes
        ? VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) : 'no data') +
        ' (target ' + VH.fmt.hours(GOAL_MIN / 60) + ')',
      'Average self-rated quality: ' + VH.fmt.num(ins.averages.avg_sleep_quality, 1, 'not rated') + '/5',
      'Running balance against the goal: ' + (ins.sleep_debt_hours === null ? 'no data'
        : (ins.sleep_debt_hours >= 0 ? '+' : '−') + VH.fmt.hours(Math.abs(ins.sleep_debt_hours))),
      'Most recent night: ' + (last
        ? last.sleep_date + ', ' + VH.fmt.hm(last.duration_minutes) : 'none logged'),
      'Average reported energy: ' + VH.fmt.num(ins.averages.avg_energy, 1, 'no data') + '/10',
      '',
      'These are figures the student entered themselves. They are not a clinical ' +
      'measurement and this is not a medical document.'
    ];
  }

  function renderSummary() {
    html('excuse-body', summaryLines().map(function (line) {
      if (!line) return '<div class="h-1"></div>';
      return '<p class="' + (line.indexOf('Sleep summary') === 0 ? 'font-semibold text-on-surface' : '') +
        '">' + VH.fmt.esc(line) + '</p>';
    }).join(''));
  }

  function statusToast(message) {
    var toast = $('statusToast');
    var text = $('toastMessage');
    if (!toast || !text) { VH.toast(message); return; }
    text.textContent = message;
    toast.classList.remove('hidden');
    setTimeout(function () { toast.classList.add('hidden'); }, 5000);
  }

  /* ------------------------------------------------------------------
   * Loading
   * ---------------------------------------------------------------- */

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.sleep(id, { limit: 14 }),
      VH.api.mood(id, { limit: 14 }),
      VH.api.screenTime(id, { limit: 7 }),
      VH.api.events(id, { from: ctx.insights.today + ' 00:00:00' }),
      VH.api.tasks(id, { open_only: true }),
      VH.api.insights(id, 14)
    ]);
    state.sleep = results[0];
    state.mood = results[1];
    state.screen = results[2];
    state.events = results[3];
    state.tasks = results[4];
    ctx.insights = results[5];
    VH.shell.insights = results[5];
    applyGoal(ctx.insights);

    var todaysMood = state.mood.filter(function (m) { return m.date === ctx.insights.today; })[0];
    state.draft = {
      mood: todaysMood ? todaysMood.mood_score : null,
      energy: todaysMood && todaysMood.energy_score ? todaysMood.energy_score : 5
    };
    var slider = $('stressSlider');
    if (slider) {
      slider.min = 1;
      slider.max = 10;
      slider.step = 1;
      slider.value = state.draft.energy;
    }

    set('sleep-synced', '· read from the database just now');
    set('mood-sub', todaysMood
      ? 'You already checked in today — saving again replaces it.'
      : 'One row per day, stored in mood_energy.');

    renderKpis();
    renderChart();
    renderDrift();
    renderLoad();
    renderVerdict();
    renderClearance();
    renderSummary();
    paintMood();
  }

  function wire() {
    var log = $('resyncBtn');
    if (log) log.addEventListener('click', function (e) { e.preventDefault(); openSleepModal(); });

    /* The second pill in the tray is now box breathing. */
    var tray = log && log.parentElement;
    if (tray) {
      var buttons = tray.querySelectorAll('button');
      if (buttons.length > 1) {
        buttons[1].addEventListener('click', function (e) {
          e.preventDefault();
          VH.shell.openBreathing();
        });
      }
    }

    MOODS.forEach(function (mood) {
      var btn = $(mood.id);
      if (!btn) return;
      btn.addEventListener('click', function () {
        state.draft.mood = mood.score;
        paintMood();
      });
    });
    var slider = $('stressSlider');
    if (slider) {
      slider.addEventListener('input', function () {
        state.draft.energy = Number(slider.value);
        paintMood();
      });
    }
    var logMood = $('logMoodBtn');
    if (logMood) {
      logMood.addEventListener('click', function (e) {
        e.preventDefault();
        saveMood().catch(function (err) { VH.fail(err, 'Check-in'); });
      });
    }

    var protocol = $('applyProtocolBtn');
    if (protocol) {
      protocol.addEventListener('click', function (e) {
        e.preventDefault();
        var target = targetBedtime();
        if (!target) { VH.toast('Log a night first so there is a target to aim at.', 'info'); return; }
        var start = new Date(target.getTime() - 45 * 60000);
        if (start < new Date()) start.setDate(start.getDate() + 1);
        VH.api.createEvent(ctx.student.student_id, {
          event_name: 'Wind-down',
          event_type: 'personal',
          start_time: VH.fmt.stamp(start),
          end_time: VH.fmt.stamp(new Date(start.getTime() + 45 * 60000)),
          is_fixed: false,
          location: 'Off screens'
        }).then(function () {
          statusToast('Wind-down block added at ' + VH.fmt.clock(VH.fmt.stamp(start)) +
            ', 45 minutes before your ' + VH.fmt.clock(VH.fmt.stamp(target)) + ' target.');
          return reload();
        }).catch(function (err) { VH.fail(err, 'Wind-down'); });
      });
    }

    var report = $('generateReportBtn');
    if (report) {
      report.addEventListener('click', function (e) {
        e.preventDefault();
        renderSummary();
        var modal = $('excuseModal');
        if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
      });
    }

    var modal = $('excuseModal');
    if (modal) {
      modal.addEventListener('click', function (e) {
        var button = e.target.closest('button');
        if (e.target === modal || (button && /close|cancel/i.test(button.textContent))) {
          modal.classList.add('hidden');
          modal.classList.remove('flex');
          return;
        }
        if (button && /copy/i.test(button.textContent)) {
          var text = summaryLines().join('\n');
          if (navigator.clipboard) {
            navigator.clipboard.writeText(text).then(function () {
              VH.toast('Summary copied.');
            }, function () { VH.toast('Could not reach the clipboard.', 'error'); });
          } else {
            VH.toast('Clipboard is not available in this browser.', 'error');
          }
          modal.classList.add('hidden');
          modal.classList.remove('flex');
        }
      });
    }

    /* The export's inline handler was stripped with its script; find the
     * button by where it sits rather than by an attribute that is gone. */
    var toastEl = $('statusToast');
    var dismiss = toastEl ? toastEl.querySelector('button') : null;
    if (dismiss) {
      dismiss.addEventListener('click', function () { toastEl.classList.add('hidden'); });
    }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      ['excuseModal', 'vh-sleep-log'].forEach(function (id) {
        var el = $(id);
        if (el) { el.classList.add('hidden'); el.classList.remove('flex'); }
      });
    });
  }

  async function boot() {
    ctx = await VH.shell.boot('sleep');
    if (!ctx) return;
    wire();
    await reload();
  }

  boot().catch(function (err) { VH.fail(err, 'Sleep'); });
})(window.VH);
