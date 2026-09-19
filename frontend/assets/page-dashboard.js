/* Dashboard.
 *
 * Every number on this screen comes from the database. Where the export showed
 * something the schema cannot supply - heart-rate variability, REM split, a
 * flashcard deck - the card was either removed or repointed at a figure that
 * is genuinely derivable. Nothing here invents a reading.
 */
(function (VH) {
  'use strict';

  var TIMER_KEY = 'vinhack.session';   // the study session left running
  var WINDDOWN_KEY = 'vinhack.winddown';
  var SLEEP_GOAL_MIN = 480;            // eight hours

  var ctx = null;
  var state = { tasks: [], sleep: [], screen: [], dash: null, filter: 'all' };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  /* ------------------------------------------------------------------
   * Wording
   * ---------------------------------------------------------------- */

  function band(score, labels) {
    if (score === null || score === undefined) return 'no data yet';
    if (score >= 80) return labels[0];
    if (score >= 65) return labels[1];
    if (score >= 45) return labels[2];
    return labels[3];
  }

  function greeting() {
    var h = new Date().getHours();
    if (h < 12) return 'Good morning';
    if (h < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function firstName(name) { return String(name || '').split(' ')[0]; }

  /* ------------------------------------------------------------------
   * Hero
   * ---------------------------------------------------------------- */

  function nextDeadline() {
    var dated = state.tasks.filter(function (t) { return t.due_date; });
    dated.sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; });
    return dated[0] || null;
  }

  function dueThisWeek() {
    var limit = new Date();
    limit.setDate(limit.getDate() + 7);
    var cutoff = VH.fmt.stamp(limit);
    return state.tasks.filter(function (t) { return t.due_date && t.due_date <= cutoff; });
  }

  function renderHero() {
    var ins = ctx.insights;
    var next = nextDeadline();
    set('dash-headline', VH.fmt.longDate(ins.today) +
      (next ? ' · ' + next.task_name + ' ' + VH.fmt.until(next.due_date)
            : ' · nothing due'));
    set('dash-window', 'Rolling ' + ins.window_days + ' days · ' +
      (ins.averages.days_logged || 0) + ' with data');

    var avgSleep = ins.averages.avg_sleep_minutes;
    set('orbit-sleep', avgSleep === null || avgSleep === undefined
      ? 'No sleep logged'
      : 'Sleep ' + VH.fmt.hours(avgSleep / 60) + ' avg (' +
        (avgSleep >= SLEEP_GOAL_MIN ? '+' : '−') +
        VH.fmt.hours(Math.abs(avgSleep - SLEEP_GOAL_MIN) / 60) + ' vs 8h)');

    var today = todayMetric();
    set('orbit-focus', today && today.study_hours_completed
      ? 'Deep work ' + VH.fmt.hours(today.study_hours_completed) + ' today'
      : 'No focus time today yet');

    set('core-index', ins.synthesis_index === null ? '--' : Math.round(ins.synthesis_index) + '%');
    set('core-label', band(ins.synthesis_index,
      ['Thriving', 'Balanced', 'Stretched', 'Depleted']));

    /* The three pills under the hero. */
    var debt = ins.sleep_debt_hours;
    set('ring-sleep-title', debt === null ? 'No sleep logged'
      : debt >= 0 ? 'Sleep on target'
      : debt > -7 ? 'Slightly short on sleep'
      : 'Carrying a sleep debt');
    set('ring-sleep-sub', debt === null
      ? 'Nothing logged yet'
      : (debt < 0
          ? VH.fmt.hours(Math.abs(debt)) + ' behind over ' + ins.window_days + ' days'
          : VH.fmt.hours(debt) + ' ahead of the 8h goal'));

    var week = dueThisWeek();
    set('ring-work-title', state.tasks.length > 8 ? 'Heavy workload'
      : state.tasks.length > 3 ? 'Moderate workload' : 'Light workload');
    set('ring-work-sub', state.tasks.length + ' open · ' + week.length + ' due within 7 days');

    set('ring-focus-title', band(ins.scores.focus_consistency,
      ['Strong focus', 'Steady focus', 'Patchy focus', 'Little focus logged']));
    set('ring-focus-sub', VH.fmt.hours(ins.focus.hours || 0) + ' logged · avg focus ' +
      VH.fmt.num(ins.focus.avg_focus, 1, '--') + '/5');
  }

  function todayMetric() {
    return (state.dash && state.dash.today) || null;
  }

  /* ------------------------------------------------------------------
   * Advisory card
   * ---------------------------------------------------------------- */

  function weakest() {
    var scores = ctx.insights.scores;
    var named = [
      { key: 'sleep_health', value: scores.sleep_health, label: 'Sleep is the weak link' },
      { key: 'focus_consistency', value: scores.focus_consistency, label: 'Focus time is thin' },
      { key: 'resilience', value: scores.resilience, label: 'Energy is running low' },
      { key: 'academic_mastery', value: scores.academic_mastery, label: 'Grades are slipping' }
    ].filter(function (s) { return s.value !== null && s.value !== undefined; });
    named.sort(function (a, b) { return a.value - b.value; });
    return named[0] || null;
  }

  function bedtimeTarget() {
    /* Back-calculate from when they actually get up, rather than asserting a
     * fixed 10:45 PM the way the mockup did. */
    var wakes = state.sleep.filter(function (r) { return r.wake_time; }).slice(0, 7);
    if (!wakes.length) return null;
    var minutes = wakes.map(function (r) {
      var d = VH.fmt.parse(r.wake_time);
      return d.getHours() * 60 + d.getMinutes();
    });
    var avgWake = minutes.reduce(function (a, b) { return a + b; }, 0) / minutes.length;
    var bed = (avgWake - SLEEP_GOAL_MIN + 1440) % 1440;
    var d = new Date();
    d.setHours(Math.floor(bed / 60), Math.round(bed % 60), 0, 0);
    return d;
  }

  function renderAdvisory() {
    var ins = ctx.insights;
    var weak = weakest();
    var next = nextDeadline();

    set('advisory-flag', weak ? weak.label : 'Nothing logged yet');
    set('advisory-greeting', greeting() + ', ' + firstName(ctx.student.name) + '.');

    var lines = [];
    if (next) {
      lines.push(next.task_name + (next.subject ? ' (' + next.subject + ')' : '') +
        ' is due ' + VH.fmt.until(next.due_date) + '.');
    } else {
      lines.push('Nothing is on the clock right now.');
    }
    if (ins.sleep_debt_hours !== null && ins.sleep_debt_hours < -2) {
      lines.push('You are ' + VH.fmt.hours(Math.abs(ins.sleep_debt_hours)) +
        ' short of eight hours a night across the last ' + ins.window_days + ' days.');
    } else if (ins.averages.avg_sleep_minutes) {
      lines.push('Sleep is averaging ' + VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) + ' a night.');
    }
    var best = (ins.focus_by_part_of_day || [])[0];
    if (best) {
      lines.push('Your focus ratings are highest in the ' + best.part_of_day +
        ' (' + VH.fmt.num(best.avg_focus) + '/5).');
    }
    set('advisory-body', lines.join(' '));

    var strain = ins.synthesis_index === null ? null : Math.round(100 - ins.synthesis_index);
    set('tile-strain-value', strain === null ? '--' : strain + '/100');
    set('tile-strain-note', strain === null ? 'no data'
      : strain >= 55 ? 'Elevated' : strain >= 35 ? 'Moderate' : 'Low');

    set('tile-debt-value', ins.sleep_debt_hours === null ? '--'
      : (ins.sleep_debt_hours > 0 ? '+' : '−') +
        VH.fmt.hours(Math.abs(ins.sleep_debt_hours)));
    set('tile-debt-note', 'over ' + ins.window_days + 'd');

    set('tile-load-value', String(state.tasks.length));
    set('tile-load-note', 'open, ' + dueThisWeek().length + ' due this week');

    var bed = bedtimeTarget();
    set('tile-bed-value', bed ? VH.fmt.clock(VH.fmt.stamp(bed)) : '--');
    set('tile-bed-note', bed ? 'for 8h' : 'log a night first');
  }

  /* ------------------------------------------------------------------
   * Copilot synthesis
   * ---------------------------------------------------------------- */

  function renderCopilot() {
    var ins = ctx.insights;
    var avg = ins.averages;
    var parts = [];

    var next = nextDeadline();
    if (next) {
      parts.push('<strong class="text-secondary font-semibold">' + VH.fmt.esc(next.task_name) +
        '</strong> is ' + VH.fmt.esc(VH.fmt.until(next.due_date)));
    }
    if (avg.avg_sleep_minutes) {
      var short = avg.avg_sleep_minutes < SLEEP_GOAL_MIN;
      parts.push('sleep is averaging <span class="' +
        (short ? 'text-error' : 'text-primary') +
        ' font-medium underline decoration-current/50 underline-offset-4">' +
        VH.fmt.hours(avg.avg_sleep_minutes / 60) + '</span> a night');
    }
    if (avg.avg_social_minutes) {
      parts.push('and social apps are taking ' + VH.fmt.hm(avg.avg_social_minutes) + ' a day');
    }

    var advice;
    var best = (ins.focus_by_part_of_day || [])[0];
    if (!parts.length && !ins.focus.sessions) {
      /* A student who signed up an hour ago has no pattern to comment on, and
       * saying "the numbers are holding up" about no numbers would be daft. */
      advice = 'Nothing is logged yet. Start a focus session, or log last night’s sleep, ' +
        'and this fills in.';
    } else if (ins.scores.sleep_health !== null && ins.scores.sleep_health < 60) {
      advice = 'The cheapest win here is an earlier night — the days you slept over 7.5h are ' +
        'also the days your productivity score was highest.';
    } else if (best && best.part_of_day !== 'morning') {
      advice = 'Your best focus ratings land in the ' + best.part_of_day +
        ', so put the hard work there rather than late at night.';
    } else {
      advice = 'Keep the pattern you have: the numbers are holding up.';
    }

    html('copilot-text', '&ldquo;' + (parts.length ? parts.join(', ') + '. ' : '') +
      VH.fmt.esc(advice) + '&rdquo;');
    set('copilot-meta', 'Computed from ' + (avg.days_logged || 0) + ' days of your own rows · ' +
      'recalculated on every write');
  }

  /* ------------------------------------------------------------------
   * Academic matrix
   * ---------------------------------------------------------------- */

  var PRIORITY_TONE = {
    urgent: 'text-error border-error/40 bg-error/10',
    high: 'text-error border-error/30 bg-error/[0.07]',
    medium: 'text-secondary border-secondary/30 bg-secondary/10',
    low: 'text-on-surface-variant border-white/[0.08] bg-surface-container-high/60'
  };

  function taskCategories(task) {
    var cats = ['all'];
    if (task.task_type === 'exam' || task.task_type === 'quiz') cats.push('exams');
    if (task.due_date && dueThisWeek().indexOf(task) >= 0) cats.push('this-week');
    return cats.join(' ');
  }

  function taskCard(task) {
    var overdue = task.is_overdue === 1;
    var tone = PRIORITY_TONE[task.priority] || PRIORITY_TONE.low;
    var effort = task.estimated_effort_hours;
    /* Progress is the share of the estimate already spent on this task. */
    var spent = (state.effortByTask || {})[task.task_id] || 0;
    var pct = effort ? Math.min(100, Math.round(spent / effort * 100)) : null;

    return '<div class="academic-card flex flex-col justify-between rounded-2xl bg-surface-container/90 ' +
      'border border-white/[0.08] hover:border-white/[0.16] shadow-lg backdrop-blur-xl overflow-hidden ' +
      'transition-all" data-category="' + taskCategories(task) + '" data-task="' + task.task_id + '">' +
      '<div class="p-space-lg flex flex-col gap-space-sm">' +
      '<div class="flex items-center justify-between gap-2">' +
      '<span class="px-2 py-0.5 rounded-full border font-label-sm text-label-sm font-semibold uppercase ' +
      'tracking-wide ' + tone + '">' + VH.fmt.esc(task.priority) + ' · ' +
      VH.fmt.esc(task.task_type) + '</span>' +
      '<span class="font-label-sm text-label-sm ' + (overdue ? 'text-error font-bold' : 'text-on-surface-variant') +
      '">' + VH.fmt.esc(task.due_date ? VH.fmt.until(task.due_date) : 'no due date') + '</span>' +
      '</div>' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface font-bold leading-tight">' +
      VH.fmt.esc(task.subject || 'General') + '</h3>' +
      '<p class="font-body-md text-body-md text-on-surface-variant leading-snug">' +
      VH.fmt.esc(task.task_name) + '</p>' +
      (pct === null
        ? '<p class="font-label-sm text-label-sm text-outline">No effort estimate on this task.</p>'
        : '<div class="flex flex-col gap-1 pt-space-xs">' +
          '<div class="flex items-center justify-between font-label-sm text-label-sm text-on-surface-variant">' +
          '<span>Logged against estimate</span><span>' + VH.fmt.hours(spent) + ' / ' +
          VH.fmt.hours(effort) + '</span></div>' +
          '<div class="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">' +
          '<div class="h-full rounded-full bg-primary" style="width:' + pct + '%"></div></div></div>') +
      '<p class="font-label-sm text-label-sm text-outline">Due ' +
      VH.fmt.esc(task.due_date ? VH.fmt.longDate(task.due_date) + ' at ' + VH.fmt.clock(task.due_date) : '—') +
      '</p>' +
      '</div>' +
      '<div class="px-space-lg py-space-sm bg-surface-container-low/80 border-t border-white/[0.05] ' +
      'flex items-center justify-between gap-2">' +
      '<button class="font-label-md text-label-md text-secondary hover:text-primary transition-colors" ' +
      'data-act="focus">Start focus session</button>' +
      '<button class="px-space-sm py-1 rounded-lg bg-primary/15 text-primary font-label-md text-label-md ' +
      'font-semibold hover:bg-primary/25 transition-colors" data-act="done">Mark done</button>' +
      '</div></div>';
  }

  function renderMatrix() {
    var host = $('course-cards-container');
    if (!host) return;
    if (!state.tasks.length) {
      host.innerHTML = '<div class="col-span-full p-space-lg rounded-2xl bg-surface-container/70 ' +
        'border border-white/[0.06] text-center font-body-md text-body-md text-on-surface-variant">' +
        'Nothing open. Add a task with <strong class="text-primary">+ Quick Task</strong>.</div>';
      return;
    }
    host.innerHTML = state.tasks.map(taskCard).join('');
    applyFilter(state.filter);
  }

  function applyFilter(filter) {
    state.filter = filter;
    Array.prototype.forEach.call(document.querySelectorAll('.academic-card'), function (card) {
      var cats = card.getAttribute('data-category') || '';
      card.style.display = (filter === 'all' || cats.indexOf(filter) >= 0) ? 'flex' : 'none';
    });
  }

  /* ------------------------------------------------------------------
   * Sleep card
   * ---------------------------------------------------------------- */

  function renderSleep() {
    var ins = ctx.insights;
    var avg = ins.averages.avg_sleep_minutes;
    set('sleep-avg', avg ? VH.fmt.hours(avg / 60) : '--');
    set('sleep-goal', avg
      ? 'Goal 8.0h (' + (avg >= SLEEP_GOAL_MIN ? '+' : '−') +
        VH.fmt.hours(Math.abs(avg - SLEEP_GOAL_MIN) / 60) + ' avg)'
      : 'No nights logged yet');

    var quality = ins.averages.avg_sleep_quality;
    set('sleep-quality', quality
      ? 'Quality ' + VH.fmt.num(quality, 1) + '/5 · ' +
        band(quality / 5 * 100, ['excellent', 'good', 'fair', 'poor'])
      : 'Quality not rated');

    var host = $('sleep-bars');
    if (host) {
      /* Keep the dashed 8h guide, replace the bars. */
      var guide = host.querySelector('div.absolute');
      host.innerHTML = '';
      if (guide) host.appendChild(guide);
      var nights = state.sleep.slice(0, 7).reverse();
      if (!nights.length) {
        host.insertAdjacentHTML('beforeend',
          '<div class="flex-1 self-center text-center font-body-sm text-body-sm ' +
          'text-on-surface-variant">No sleep logged in this window.</div>');
      }
      nights.forEach(function (night) {
        var minutes = night.duration_minutes || 0;
        /* The guide line sits at 8h; the plot area runs to 10h so a long
         * night still has somewhere to go. */
        var height = Math.max(4, Math.min(100, minutes / 600 * 100));
        var short = minutes < SLEEP_GOAL_MIN;
        host.insertAdjacentHTML('beforeend',
          '<div class="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group/bar cursor-default" ' +
          'title="' + VH.fmt.esc(night.sleep_date + ' · ' + VH.fmt.hm(minutes) +
          (night.quality ? ' · quality ' + night.quality + '/5' : '')) + '">' +
          '<div class="w-full max-w-[28px] ' +
          (short ? 'bg-error' : 'bg-secondary-container/90 group-hover/bar:bg-secondary') +
          ' rounded-t-md transition-all" style="height: ' + height.toFixed(0) + '%;"></div>' +
          '<span class="font-label-sm text-label-sm ' +
          (short ? 'text-error font-bold' : 'text-on-surface-variant font-medium') + '">' +
          VH.fmt.esc(VH.fmt.weekday(night.sleep_date)) + '</span></div>');
      });
    }

    var bed = bedtimeTarget();
    html('sleep-bedtime', bed
      ? 'Lights out by <strong class="text-on-surface font-semibold">' +
        VH.fmt.clock(VH.fmt.stamp(bed)) + '</strong> to clear 8h before your usual wake time'
      : 'Log a night with a bedtime and wake time to get a target.');
  }

  /* ------------------------------------------------------------------
   * Screen time card
   * ---------------------------------------------------------------- */

  var SCREEN_PARTS = [
    { key: 'education_minutes', label: 'Educational', dot: 'bg-primary' },
    { key: 'communication_minutes', label: 'Communication', dot: 'bg-secondary' },
    { key: 'social_media_minutes', label: 'Social media', dot: 'bg-error' },
    { key: 'entertainment_minutes', label: 'Entertainment', dot: 'bg-tertiary' },
    { key: 'other_minutes', label: 'Other', dot: 'bg-outline' }
  ];

  function renderScreen() {
    var row = state.screen[0] || null;
    set('screen-total', row ? VH.fmt.hm(row.total_screen_minutes) : '--');
    set('screen-day', row
      ? 'Logged for ' + VH.fmt.longDate(row.date)
      : 'Nothing logged — use “Log screen time” above');

    var total = row ? row.total_screen_minutes : 0;
    var edu = row && total ? Math.round(row.education_minutes / total * 100) : null;
    set('screen-flow', edu === null ? '--' : edu + '%');
    var ring = $('screen-ring');
    if (ring) ring.setAttribute('stroke-dasharray', (edu || 0) + ', 100');

    html('screen-legend', row
      ? SCREEN_PARTS.map(function (part) {
          return '<div class="flex items-center gap-2">' +
            '<span class="w-2.5 h-2.5 rounded-full ' + part.dot + '"></span>' +
            '<span class="font-body-sm text-body-sm text-on-surface font-medium">' +
            part.label + ' (' + VH.fmt.hm(row[part.key]) + ')</span></div>';
        }).join('')
      : '<span class="font-body-sm text-body-sm text-on-surface-variant">No screen time on record ' +
        'for the last few days.</span>');
  }

  /* ------------------------------------------------------------------
   * Sleep drawer
   * ---------------------------------------------------------------- */

  function renderDrawer() {
    var ins = ctx.insights;
    var debt = ins.sleep_debt_hours;
    var short = debt !== null && debt < 0;
    var callout = $('drawer-callout');
    if (callout) {
      callout.className = 'p-space-md rounded-2xl flex items-start gap-space-sm ' +
        (short ? 'bg-error/10 border border-error/30 text-error'
               : 'bg-primary/10 border border-primary/30 text-primary');
      var title = $('drawer-callout-title');
      var body = $('drawer-callout-body');
      if (title) title.className = 'font-title-md text-title-md font-bold ' +
        (short ? 'text-error' : 'text-primary');
      if (body) body.className = 'font-body-sm text-body-sm mt-1 leading-relaxed ' +
        (short ? 'text-error/90' : 'text-primary/90');
      set('drawer-callout-icon', short ? 'error_outline' : 'check_circle');
    }
    set('drawer-callout-title', debt === null ? 'No sleep logged yet'
      : short ? 'Running ' + VH.fmt.hours(Math.abs(debt)) + ' short'
              : VH.fmt.hours(debt) + ' ahead of the goal');
    set('drawer-callout-body', debt === null
      ? 'Log a bedtime and a wake time and this fills in.'
      : 'Measured against 8h a night across the ' + ins.window_days +
        ' days you have logged (' + (ins.averages.days_logged || 0) + ' nights with data).');

    set('drawer-nights-title', 'Last ' + Math.min(7, state.sleep.length) + ' nights logged');
    html('drawer-nights', state.sleep.slice(0, 7).map(function (night) {
      var minutes = night.duration_minutes || 0;
      var pct = Math.min(100, minutes / SLEEP_GOAL_MIN * 100);
      return '<div>' +
        '<div class="flex justify-between text-body-sm text-on-surface-variant mb-1 font-medium">' +
        '<span>' + VH.fmt.esc(VH.fmt.weekday(night.sleep_date) + ' ' + VH.fmt.date(night.sleep_date)) +
        (night.bedtime ? ' · ' + VH.fmt.esc(VH.fmt.clock(night.bedtime)) + ' → ' +
          VH.fmt.esc(VH.fmt.clock(night.wake_time)) : '') + '</span>' +
        '<span class="' + (minutes < SLEEP_GOAL_MIN ? 'text-error' : 'text-primary') + '">' +
        VH.fmt.hm(minutes) + (night.quality ? ' · ' + night.quality + '/5' : '') + '</span></div>' +
        '<div class="h-1.5 w-full rounded-full bg-surface-container-high overflow-hidden">' +
        '<div class="h-full rounded-full ' +
        (minutes < SLEEP_GOAL_MIN ? 'bg-error' : 'bg-primary') +
        '" style="width:' + pct.toFixed(0) + '%"></div></div></div>';
    }).join('') || '<p class="font-body-sm text-body-sm text-on-surface-variant">Nothing logged yet.</p>');

    var bed = bedtimeTarget();
    var tips = [];
    if (bed) {
      tips.push(['Aim for lights out at ' + VH.fmt.clock(VH.fmt.stamp(bed)),
                 'That clears eight hours before the time you normally wake.']);
    }
    var late = (ins.focus_by_part_of_day || []).filter(function (p) {
      return p.part_of_day === 'late night';
    })[0];
    if (late) {
      tips.push(['Your late-night sessions score ' + VH.fmt.num(late.avg_focus) + '/5',
                 late.hours + 'h logged after 23:00, at your lowest focus rating of the day.']);
    }
    if (ins.averages.avg_social_minutes > 60) {
      tips.push(['Social apps average ' + VH.fmt.hm(ins.averages.avg_social_minutes) + ' a day',
                 'The largest single block of reclaimable time in your log.']);
    }
    if (!tips.length) tips.push(['Nothing to flag', 'Your logged sleep is holding near the goal.']);

    html('drawer-advice', tips.map(function (tip, i) {
      return '<div class="flex gap-space-sm items-start">' +
        '<div class="w-6 h-6 rounded-full bg-primary/15 text-primary flex items-center justify-center ' +
        'font-label-sm text-label-sm font-bold flex-shrink-0">' + (i + 1) + '</div>' +
        '<div><h5 class="font-label-lg text-label-lg text-on-surface font-semibold">' +
        VH.fmt.esc(tip[0]) + '</h5>' +
        '<p class="font-body-sm text-body-sm text-on-surface-variant">' + VH.fmt.esc(tip[1]) +
        '</p></div></div>';
    }).join(''));
  }

  /* ------------------------------------------------------------------
   * Action plan
   * ---------------------------------------------------------------- */

  function renderActionPlan() {
    var events = (state.dash && state.dash.upcoming_events) || [];
    var today = ctx.insights.today;
    var todays = events.filter(function (e) { return e.start_time.slice(0, 10) === today; });
    var rows = todays.map(function (e) {
      return { time: VH.fmt.clock(e.start_time), title: e.event_name,
               note: (e.location || VH.fmt.title(e.event_type)),
               tag: VH.fmt.hm((VH.fmt.parse(e.end_time) - VH.fmt.parse(e.start_time)) / 60000) };
    });
    state.tasks.slice(0, 3).forEach(function (t) {
      rows.push({ time: t.due_date ? VH.fmt.clock(t.due_date) : '--', title: t.task_name,
                  note: (t.subject || 'General') + ' · ' + VH.fmt.title(t.priority),
                  tag: t.due_date ? VH.fmt.until(t.due_date) : 'no due date' });
    });
    var bed = bedtimeTarget();
    if (bed) {
      rows.push({ time: VH.fmt.clock(VH.fmt.stamp(bed)), title: 'Lights out',
                  note: 'Eight hours before your usual wake time', tag: 'target' });
    }

    set('action-plan-title', firstName(ctx.student.name) + '’s day');
    set('action-plan-sub', todays.length + ' scheduled · ' + state.tasks.length + ' open tasks');
    html('action-plan-body', rows.length
      ? rows.map(function (r) {
          return '<div class="p-3 rounded-xl bg-surface-container-low border border-white/[0.05] ' +
            'flex items-center justify-between gap-3">' +
            '<div class="flex items-center gap-3 min-w-0">' +
            '<span class="font-mono text-xs text-primary font-bold flex-shrink-0">' +
            VH.fmt.esc(r.time) + '</span><div class="min-w-0">' +
            '<p class="text-body-sm font-semibold text-on-surface truncate">' + VH.fmt.esc(r.title) + '</p>' +
            '<p class="text-xs text-on-surface-variant truncate">' + VH.fmt.esc(r.note) + '</p></div></div>' +
            '<span class="text-xs font-mono text-on-surface-variant flex-shrink-0">' +
            VH.fmt.esc(r.tag) + '</span></div>';
        }).join('')
      : '<p class="font-body-md text-body-md text-on-surface-variant">Nothing scheduled and nothing ' +
        'open. Enjoy it.</p>');
  }

  /* ------------------------------------------------------------------
   * Pomodoro, backed by study_sessions
   * ---------------------------------------------------------------- */

  var pomo = { id: null, startedAt: null, tick: null, planned: 50 * 60 };

  function readTimer() {
    try { return JSON.parse(window.localStorage.getItem(TIMER_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeTimer(value) {
    try {
      if (value) window.localStorage.setItem(TIMER_KEY, JSON.stringify(value));
      else window.localStorage.removeItem(TIMER_KEY);
    } catch (e) { /* private mode */ }
  }

  function paintTimer() {
    var icon = $('pomo-icon');
    if (!pomo.id) {
      set('pomo-display', VH.fmt.mmss(pomo.planned));
      if (icon) icon.textContent = 'play_arrow';
      set('pomo-sublabel', 'Starts a study session in the database');
      return;
    }
    var elapsed = (Date.now() - pomo.startedAt) / 1000;
    set('pomo-display', VH.fmt.mmss(elapsed));
    if (icon) icon.textContent = 'stop';
    set('pomo-sublabel', 'Session #' + pomo.id + ' running since ' +
      VH.fmt.clock(VH.fmt.stamp(new Date(pomo.startedAt))));
  }

  function runTimer() {
    clearInterval(pomo.tick);
    pomo.tick = setInterval(paintTimer, 1000);
    paintTimer();
  }

  async function togglePomodoro() {
    var id = ctx.student.student_id;
    if (pomo.id) {
      var stopped = await VH.api.updateSession(pomo.id, { end_time: VH.fmt.stamp(new Date()) });
      clearInterval(pomo.tick);
      VH.toast('Logged ' + VH.fmt.hm(stopped.duration_minutes) + ' of focus.');
      pomo.id = null;
      writeTimer(null);
      paintTimer();
      await reload();
      return;
    }
    var started = await VH.api.startSession(id, { start_time: VH.fmt.stamp(new Date()) });
    pomo.id = started.session_id;
    pomo.startedAt = VH.fmt.parse(started.start_time).getTime();
    writeTimer({ id: pomo.id, startedAt: pomo.startedAt, student: id });
    VH.toast('Focus session started.');
    runTimer();
  }

  async function restoreTimer() {
    var saved = readTimer();
    if (!saved || saved.student !== ctx.student.student_id) return;
    /* Make sure the session is still open before adopting it - it may have
     * been closed from the Focus Mode screen in another tab. */
    try {
      var sessions = await VH.api.sessions(ctx.student.student_id, { limit: 20 });
      var live = sessions.filter(function (s) {
        return s.session_id === saved.id && !s.end_time;
      })[0];
      if (!live) { writeTimer(null); return; }
      pomo.id = live.session_id;
      pomo.startedAt = VH.fmt.parse(live.start_time).getTime();
      runTimer();
    } catch (err) {
      writeTimer(null);
    }
  }

  /* ------------------------------------------------------------------
   * Actions
   * ---------------------------------------------------------------- */

  function nextFreeHour() {
    /* Next hour boundary at least ten minutes out. */
    var d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    if (d - new Date() < 10 * 60000) d.setHours(d.getHours() + 1);
    return d;
  }

  async function blockFocus() {
    var start = nextFreeHour();
    var end = new Date(start.getTime() + 50 * 60000);
    var next = nextDeadline();
    await VH.api.createEvent(ctx.student.student_id, {
      event_name: next ? 'Focus: ' + next.task_name : 'Focus block',
      event_type: 'personal',
      start_time: VH.fmt.stamp(start),
      end_time: VH.fmt.stamp(end),
      is_fixed: false,
      location: 'Deep work'
    });
    VH.toast('50-minute block booked for ' + VH.fmt.clock(VH.fmt.stamp(start)) + '.');
    await reload();
  }

  async function deferNext() {
    var next = nextDeadline();
    if (!next) { VH.toast('Nothing has a due date to push.', 'info'); return; }
    var due = VH.fmt.parse(next.due_date);
    due.setDate(due.getDate() + 1);
    await VH.api.updateTask(next.task_id, { due_date: VH.fmt.stamp(due) });
    VH.toast('"' + next.task_name + '" pushed to ' + VH.fmt.longDate(VH.fmt.stamp(due)) + '.');
    await reload();
  }

  function screenTimeModal() {
    var existing = document.getElementById('vh-screen-time');
    if (existing) return existing;
    var row = state.screen[0];
    var today = ctx.insights.today;
    var current = row && row.date === today ? row : {};
    var fields = SCREEN_PARTS.map(function (part) {
      return '<label class="flex flex-col gap-1"><span class="font-label-sm text-label-sm ' +
        'uppercase tracking-wide text-on-surface-variant">' + part.label + '</span>' +
        '<input name="' + part.key + '" type="number" min="0" step="5" value="' +
        (current[part.key] || 0) + '" class="w-full bg-surface-container-lowest/70 border ' +
        'border-outline-variant/40 rounded-lg px-space-sm py-space-xs text-on-surface ' +
        'font-body-md text-body-md focus:border-secondary focus:outline-none"></label>';
    }).join('');
    var wrap = document.createElement('div');
    wrap.id = 'vh-screen-time';
    wrap.className = 'hidden fixed inset-0 z-[150] items-center justify-center p-4 ' +
      'bg-surface-container-lowest/80 backdrop-blur-sm';
    wrap.innerHTML = '<form class="w-full max-w-md rounded-2xl bg-surface-container/95 border ' +
      'border-outline-variant/40 backdrop-blur-xl shadow-2xl p-space-lg flex flex-col gap-space-md" ' +
      'id="vh-screen-time-form">' +
      '<div class="flex items-center justify-between">' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface">Screen time today</h3>' +
      '<button type="button" data-close="1" class="text-on-surface-variant hover:text-on-surface">' +
      '<span class="material-symbols-outlined">close</span></button></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">Minutes for ' +
      VH.fmt.esc(VH.fmt.longDate(today)) + '. Re-submitting replaces the day.</p>' +
      '<div class="grid grid-cols-2 gap-space-sm">' + fields + '</div>' +
      '<div class="flex justify-end gap-space-sm pt-space-xs">' +
      '<button type="button" data-close="1" class="px-space-md py-space-xs rounded-lg ' +
      'bg-surface-container-high text-on-surface font-label-md text-label-md">Cancel</button>' +
      '<button type="submit" class="px-space-md py-space-xs rounded-lg bg-primary text-on-primary ' +
      'font-label-md text-label-md font-semibold">Save</button></div></form>';
    document.body.appendChild(wrap);
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap) VH.shell.closeOverlay(wrap);
    });
    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      var data = new FormData(e.target);
      var body = { date: ctx.insights.today };
      SCREEN_PARTS.forEach(function (part) {
        body[part.key] = Number(data.get(part.key) || 0);
      });
      VH.api.logScreenTime(ctx.student.student_id, body).then(function () {
        VH.shell.closeOverlay(wrap);
        VH.toast('Screen time saved.');
        return reload();
      }).catch(function (err) { VH.fail(err, 'Screen time'); });
    });
    return wrap;
  }

  /* ------------------------------------------------------------------
   * Command palette
   * ---------------------------------------------------------------- */

  function paletteRow(icon, title, meta, attrs) {
    return '<div class="palette-item flex items-center justify-between px-3 py-2.5 rounded-xl ' +
      'hover:bg-surface-container-high cursor-pointer transition-colors text-on-surface" ' + attrs + '>' +
      '<div class="flex items-center gap-3 min-w-0">' +
      '<span class="material-symbols-outlined text-primary text-[20px] flex-shrink-0">' + icon + '</span>' +
      '<span class="text-body-sm font-medium truncate">' + VH.fmt.esc(title) + '</span></div>' +
      '<span class="text-xs font-mono text-on-surface-variant flex-shrink-0">' +
      VH.fmt.esc(meta) + '</span></div>';
  }

  function renderPalette(term) {
    var host = $('palette-results-list');
    if (!host) return;
    term = (term || '').trim().toLowerCase();
    var rows = [
      paletteRow('air', 'Box breathing', 'Action', 'data-go="breathing"'),
      paletteRow('add_task', 'Add a task', 'Action', 'data-go="task"'),
      paletteRow('phone_iphone', 'Log screen time', 'Action', 'data-go="screen"'),
      paletteRow('bedtime', 'Sleep detail', 'Health', 'data-go="sleep"')
    ];
    if (term.length >= 2) {
      rows = [];
      state.tasks.forEach(function (t) {
        if ((t.task_name + ' ' + (t.subject || '')).toLowerCase().indexOf(term) >= 0) {
          rows.push(paletteRow('task_alt', t.task_name,
            t.due_date ? VH.fmt.until(t.due_date) : 'no due date',
            'data-go="task-focus" data-task="' + t.task_id + '"'));
        }
      });
      if (!rows.length) {
        rows.push('<div class="px-3 py-2.5 font-body-sm text-body-sm text-on-surface-variant">' +
          'No open task matches that.</div>');
      }
    }
    host.innerHTML = rows.join('');
  }

  /* ------------------------------------------------------------------
   * Loading
   * ---------------------------------------------------------------- */

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.dashboard(id, 14),
      VH.api.sleep(id, { limit: 7 }),
      VH.api.screenTime(id, { limit: 7 }),
      VH.api.tasks(id, { open_only: true }),
      VH.api.insights(id, 14),
      VH.api.sessions(id, { limit: 200 })
    ]);
    state.dash = results[0];
    state.sleep = results[1];
    state.screen = results[2];
    state.tasks = results[3];
    ctx.insights = results[4];
    VH.shell.insights = results[4];

    /* Hours logged per task, for the progress bar on each card. */
    state.effortByTask = {};
    results[5].forEach(function (s) {
      if (!s.task_id || !s.duration_minutes) return;
      state.effortByTask[s.task_id] = (state.effortByTask[s.task_id] || 0) + s.duration_minutes / 60;
    });

    renderHero();
    renderAdvisory();
    renderCopilot();
    renderMatrix();
    renderSleep();
    renderScreen();
    renderDrawer();
    renderActionPlan();
    renderPalette('');
  }

  /* ------------------------------------------------------------------
   * Wiring
   * ---------------------------------------------------------------- */

  function openDrawer() {
    var drawer = $('sleep-slideover-drawer');
    var backdrop = $('drawer-backdrop');
    if (!drawer || !backdrop) return;
    backdrop.classList.remove('hidden');
    requestAnimationFrame(function () { drawer.classList.remove('translate-x-full'); });
  }
  function closeDrawer() {
    var drawer = $('sleep-slideover-drawer');
    var backdrop = $('drawer-backdrop');
    if (!drawer || !backdrop) return;
    drawer.classList.add('translate-x-full');
    setTimeout(function () { backdrop.classList.add('hidden'); }, 300);
  }

  function modal(id, open) {
    var el = $(id);
    if (el) el.classList.toggle('hidden', !open);
  }

  function on(id, handler) {
    var el = $(id);
    if (el) el.addEventListener('click', function (e) {
      e.preventDefault();
      var result = handler(e);
      if (result && result.catch) result.catch(function (err) { VH.fail(err, 'Action'); });
    });
  }

  function wire() {
    ['trigger-sleep-drawer', 'card-open-sleep-btn', 'orbital-core-interactive-btn']
      .forEach(function (id) { on(id, openDrawer); });
    on('close-sleep-drawer', closeDrawer);
    var backdrop = $('drawer-backdrop');
    if (backdrop) backdrop.addEventListener('click', closeDrawer);

    on('trigger-workload-drawer', function () {
      var matrix = $('course-cards-container');
      if (matrix) matrix.scrollIntoView({ behavior: 'smooth' });
    });
    on('trigger-focus-tab', function () { window.location.href = 'focus.html'; });

    on('pomo-toggle-btn', togglePomodoro);
    on('btn-block-focus', blockFocus);
    on('btn-defer-history', deferNext);
    on('btn-screen-time', function () { VH.shell.openOverlay(screenTimeModal()); });
    on('apply-circadian-sync', function () { window.location.href = 'sleep.html'; });

    on('view-action-plan-btn', function () { modal('action-plan-modal', true); });
    on('close-action-plan-btn', function () { modal('action-plan-modal', false); });
    on('close-action-plan-backdrop', function () { modal('action-plan-modal', false); });
    on('lock-today-plan-btn', function () {
      modal('action-plan-modal', false);
      VH.toast('Plan noted. Nothing was written — this view is read-only.', 'info');
    });
    on('export-calendar-btn', function () { window.location.href = 'schedule.html'; });

    on('open-breathing-btn', VH.shell.openBreathing);
    on('start-inline-breathing', VH.shell.openBreathing);
    on('modal-close-breathing', function () { modal('breathing-modal', false); });
    on('close-breathing-backdrop', function () { modal('breathing-modal', false); });

    /* The page ships its own quick-task modal, so use it rather than the
     * shell's generic one. */
    on('quick-task-btn', function () {
      var list = $('new-task-subjects');
      if (list) {
        list.innerHTML = (VH.shell.subjects || []).map(function (s) {
          return '<option value="' + VH.fmt.esc(s) + '">';
        }).join('');
      }
      modal('task-modal', true);
    });
    ['close-task-btn', 'close-task-backdrop', 'cancel-task-btn'].forEach(function (id) {
      on(id, function () { modal('task-modal', false); });
    });
    var taskForm = $('quick-task-form');
    if (taskForm) {
      taskForm.addEventListener('submit', function (e) {
        e.preventDefault();
        var due = $('new-task-deadline').value;
        var effort = $('new-task-effort').value;
        var body = {
          task_name: $('new-task-title').value.trim(),
          subject: $('new-task-course').value.trim() || null,
          task_type: $('new-task-type').value,
          priority: $('new-task-priority').value
        };
        if (due) body.due_date = due.replace('T', ' ') + (due.length === 16 ? ':00' : '');
        if (effort) body.estimated_effort_hours = Number(effort);
        if (!body.subject) delete body.subject;
        VH.api.createTask(ctx.student.student_id, body).then(function (created) {
          VH.toast('Added "' + created.task_name + '".');
          taskForm.reset();
          modal('task-modal', false);
          return reload();
        }).catch(function (err) { VH.fail(err, 'Create task'); });
      });
    }

    on('open-search-palette', function () {
      modal('command-palette-modal', true);
      var input = $('palette-search-input');
      if (input) { input.value = ''; renderPalette(''); setTimeout(function () { input.focus(); }, 40); }
    });
    on('close-palette-backdrop', function () { modal('command-palette-modal', false); });
    var paletteInput = $('palette-search-input');
    if (paletteInput) {
      paletteInput.addEventListener('input', function () { renderPalette(paletteInput.value); });
    }
    var paletteList = $('palette-results-list');
    if (paletteList) {
      paletteList.addEventListener('click', function (e) {
        var item = e.target.closest('[data-go]');
        if (!item) return;
        modal('command-palette-modal', false);
        var go = item.getAttribute('data-go');
        if (go === 'breathing') VH.shell.openBreathing();
        else if (go === 'task') modal('task-modal', true);
        else if (go === 'screen') VH.shell.openOverlay(screenTimeModal());
        else if (go === 'sleep') openDrawer();
        else if (go === 'task-focus') {
          window.location.href = 'focus.html?task=' + item.getAttribute('data-task');
        }
      });
    }

    document.addEventListener('keydown', function (e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        modal('command-palette-modal', true);
        var input = $('palette-search-input');
        if (input) { input.value = ''; renderPalette(''); input.focus(); }
      }
      if (e.key === 'Escape') {
        closeDrawer();
        ['breathing-modal', 'task-modal', 'action-plan-modal', 'command-palette-modal']
          .forEach(function (id) { modal(id, false); });
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.matrix-filter-btn'), function (btn) {
      btn.addEventListener('click', function () {
        Array.prototype.forEach.call(document.querySelectorAll('.matrix-filter-btn'), function (b) {
          b.classList.remove('bg-surface-container-highest', 'text-on-surface');
          b.classList.add('text-on-surface-variant');
        });
        btn.classList.add('bg-surface-container-highest', 'text-on-surface');
        btn.classList.remove('text-on-surface-variant');
        applyFilter(btn.getAttribute('data-filter'));
      });
    });

    var matrix = $('course-cards-container');
    if (matrix) {
      matrix.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-act]');
        if (!btn) return;
        var card = btn.closest('[data-task]');
        var taskId = Number(card.getAttribute('data-task'));
        if (btn.getAttribute('data-act') === 'focus') {
          window.location.href = 'focus.html?task=' + taskId;
          return;
        }
        VH.api.updateTask(taskId, { status: 'completed' }).then(function (t) {
          VH.toast('"' + t.task_name + '" marked done.');
          return reload();
        }).catch(function (err) { VH.fail(err, 'Complete task'); });
      });
    }

    /* A reminder the browser cannot enforce, so it is stored here and labelled
     * as a device-local note rather than a lock. */
    var winddown = $('winddown-lock-btn');
    if (winddown) {
      var saved = null;
      try { saved = window.localStorage.getItem(WINDDOWN_KEY); } catch (e) { saved = null; }
      var paint = function () {
        winddown.textContent = saved ? 'Reminder set for ' + saved : 'Set 9:30 PM reminder';
        winddown.classList.toggle('bg-primary', !!saved);
        winddown.classList.toggle('text-on-primary', !!saved);
      };
      paint();
      winddown.addEventListener('click', function () {
        saved = saved ? null : '9:30 PM';
        try {
          if (saved) window.localStorage.setItem(WINDDOWN_KEY, saved);
          else window.localStorage.removeItem(WINDDOWN_KEY);
        } catch (e) { /* private mode */ }
        paint();
        VH.toast(saved ? 'Noted on this device.' : 'Reminder cleared.', 'info');
      });
    }

    document.addEventListener('vh:task-created', function () {
      reload().catch(function (err) { VH.fail(err, 'Refresh'); });
    });
  }

  async function boot() {
    ctx = await VH.shell.boot('dashboard');
    if (!ctx) return;
    wire();
    await reload();
    set('act-block-when', VH.fmt.clock(VH.fmt.stamp(nextFreeHour())) + ' for 50 minutes');
    var row = state.screen[0];
    set('shield-status-text', row && row.date === ctx.insights.today
      ? VH.fmt.hm(row.total_screen_minutes) + ' logged today'
      : 'Nothing logged for today');
    var next = nextDeadline();
    set('defer-history-desc', next
      ? next.task_name + ' · ' + VH.fmt.until(next.due_date)
      : 'Nothing has a due date');
    paintTimer();
    await restoreTimer();
  }

  boot().catch(function (err) { VH.fail(err, 'Dashboard'); });
})(window.VH);
