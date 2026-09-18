/* Analytics.
 *
 * Everything here is grouped from rows the student logged. The export promised
 * three correlations the schema cannot see - sleep against exam marks, commit
 * time against bug density, and a predicted exam pass rate. Two of the three
 * have honest equivalents the database does support:
 *
 *   - sleep band against the rollup's own productivity score, and
 *   - focus rating against time of day.
 *
 * The third is a projection, and it states its arithmetic rather than
 * presenting itself as a prediction.
 */
(function (VH) {
  'use strict';

  var ctx = null;
  var state = { grades: null };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  function band(score, labels) {
    if (score === null || score === undefined) return 'no data yet';
    if (score >= 80) return labels[0];
    if (score >= 65) return labels[1];
    if (score >= 45) return labels[2];
    return labels[3];
  }

  function toneFor(score) {
    if (score === null || score === undefined) return 'on-surface-variant';
    if (score >= 80) return 'primary';
    if (score >= 65) return 'primary-fixed-dim';
    if (score >= 45) return 'secondary';
    return 'error';
  }

  /* ------------------------------------------------------------------
   * Index and sub-scores
   * ---------------------------------------------------------------- */

  function renderIndex() {
    var ins = ctx.insights;
    var index = ins.synthesis_index;

    set('an-index', index === null ? '--' : String(Math.round(index)));
    set('an-window', '· last ' + ins.window_days + ' days, ' +
      (ins.averages.days_logged || 0) + ' with data');
    set('an-engine', 'Computed from your rows');

    /* Outer ring is the index, inner ring is sleep - the one that most often
     * drags the index down. */
    var outer = $('an-ring-outer');
    if (outer) outer.setAttribute('stroke-dashoffset',
      (314.159 * (1 - VH.clamp01(index) / 100)).toFixed(1));
    var inner = $('an-ring-inner');
    if (inner) inner.setAttribute('stroke-dashoffset',
      (251.32 * (1 - VH.clamp01(ins.scores.sleep_health) / 100)).toFixed(1));

    set('an-tier', band(index, ['Holding up well', 'Steady', 'Under strain', 'Struggling']));
    var lowest = lowestScore();
    var alert = $('an-alert');
    if (alert) {
      var tone = lowest && lowest.value < 55 ? 'error' : 'primary';
      alert.parentElement.className = 'mt-space-xs flex items-center gap-space-xs px-space-sm ' +
        'py-1 rounded-full bg-' + tone + '-container/30 text-' + tone +
        ' font-label-sm text-label-sm';
      alert.textContent = lowest
        ? (lowest.value < 55 ? lowest.label + ' is the weak link' : lowest.label + ' is the lowest')
        : 'Not enough logged yet';
    }

    var parts = [];
    if (ins.averages.avg_sleep_minutes) {
      parts.push('sleeping ' + VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) + ' a night');
    }
    if (ins.focus.hours) {
      parts.push(VH.fmt.hours(ins.focus.hours) + ' of focus logged across ' +
        ins.focus.sessions + ' sessions');
    }
    if (state.grades && state.grades.overall && state.grades.overall.items) {
      parts.push(VH.fmt.num(state.grades.overall.mean_percent, 1) + '% average across ' +
        state.grades.overall.items + ' graded items');
    }
    set('an-summary', parts.length
      ? 'Over the last ' + ins.window_days + ' days: ' + parts.join(', ') + '.'
      : 'Not enough logged to say anything yet.');
  }

  function scoreRows() {
    var ins = ctx.insights;
    return [
      {
        key: 'academic_mastery', label: 'Academic standing',
        value: ins.scores.academic_mastery,
        note: state.grades && state.grades.overall && state.grades.overall.items
          ? state.grades.overall.items + ' graded items across ' +
            state.grades.subjects.length + ' subjects'
          : 'No scores recorded'
      },
      {
        key: 'sleep_health', label: 'Sleep',
        value: ins.scores.sleep_health,
        note: ins.averages.avg_sleep_minutes
          ? VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) + ' a night against an 8h goal'
          : 'Nothing logged'
      },
      {
        key: 'resilience', label: 'Mood and energy',
        value: ins.scores.resilience,
        note: ins.averages.avg_energy
          ? 'energy ' + VH.fmt.num(ins.averages.avg_energy) + '/10, mood ' +
            VH.fmt.num(ins.mood.avg_mood, 1, '--') + '/10'
          : 'No check-ins'
      },
      {
        key: 'focus_consistency', label: 'Focus consistency',
        value: ins.scores.focus_consistency,
        note: ins.focus.avg_focus
          ? 'avg rating ' + VH.fmt.num(ins.focus.avg_focus) + '/5 over ' +
            ins.focus.sessions + ' sessions'
          : 'No sessions logged'
      }
    ];
  }

  function lowestScore() {
    var rows = scoreRows().filter(function (r) {
      return r.value !== null && r.value !== undefined;
    });
    rows.sort(function (a, b) { return a.value - b.value; });
    return rows[0] || null;
  }

  function renderScores() {
    html('an-scores', scoreRows().map(function (row) {
      var tone = toneFor(row.value);
      return '<div class="p-space-md rounded-xl bg-surface-container-high flex flex-col ' +
        'justify-between gap-space-xs">' +
        '<div class="flex items-center justify-between gap-2">' +
        '<span class="font-label-md text-label-md text-on-surface-variant truncate">' +
        VH.fmt.esc(row.label) + '</span>' +
        '<span class="font-title-md text-title-md text-' + tone + ' flex-shrink-0">' +
        (row.value === null || row.value === undefined ? '--'
          : Math.round(row.value) + '/100') + '</span></div>' +
        '<div class="w-full h-1.5 rounded-full bg-surface-container">' +
        '<div class="h-1.5 rounded-full bg-' + tone + '" style="width:' +
        VH.clamp01(row.value) + '%"></div></div>' +
        '<div class="flex items-center justify-between gap-2">' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant truncate">' +
        VH.fmt.esc(row.note) + '</span>' +
        '<span class="font-label-sm text-label-sm text-' + tone +
        ' font-semibold flex-shrink-0">' +
        VH.fmt.esc(band(row.value, ['Strong', 'Fine', 'Low', 'Weak'])) + '</span></div></div>';
    }).join(''));
  }

  /* ------------------------------------------------------------------
   * The three groupings
   * ---------------------------------------------------------------- */

  function card(icon, tone, title, tag, blurb, body, footLabel, footValue) {
    return '<div class="rounded-2xl bg-surface-container-low p-space-lg flex flex-col ' +
      'justify-between shadow-lg relative gap-space-md">' +
      '<div><div class="flex items-center justify-between gap-space-sm mb-space-sm">' +
      '<div class="flex items-center gap-space-xs min-w-0">' +
      '<span class="material-symbols-outlined text-[20px] text-' + tone + ' flex-shrink-0">' +
      icon + '</span>' +
      '<h3 class="font-title-md text-title-md text-on-surface truncate">' +
      VH.fmt.esc(title) + '</h3></div>' +
      '<span class="font-label-sm text-label-sm px-space-xs py-0.5 rounded bg-surface-container ' +
      'text-' + tone + ' flex-shrink-0">' + VH.fmt.esc(tag) + '</span></div>' +
      '<p class="font-body-sm text-body-sm text-on-surface-variant">' + VH.fmt.esc(blurb) +
      '</p></div>' + body +
      '<div class="flex items-center justify-between gap-2 pt-space-xs border-t ' +
      'border-outline-variant/20 font-label-sm text-label-sm">' +
      '<span class="text-on-surface-variant truncate">' + VH.fmt.esc(footLabel) + '</span>' +
      '<span class="text-' + tone + ' font-semibold flex-shrink-0">' +
      VH.fmt.esc(footValue) + '</span></div></div>';
  }

  function sleepCard() {
    var bands = ctx.insights.sleep_vs_productivity.filter(function (b) {
      return b.band !== 'unknown';
    });
    if (bands.length < 2) {
      return card('bedtime', 'secondary', 'Sleep against productivity', 'thin data',
        'Not enough nights logged across different lengths to compare yet.',
        '<p class="font-body-sm text-body-sm text-outline">Log a week or two and the bands fill in.</p>',
        'Nights logged', String(ctx.insights.averages.days_logged || 0));
    }
    var max = Math.max.apply(null, bands.map(function (b) {
      return b.avg_productivity || 0;
    })) || 1;
    var body = '<div class="flex items-end justify-between gap-2 h-32">' +
      bands.map(function (b) {
        var height = (b.avg_productivity || 0) / max * 100;
        return '<div class="flex-1 flex flex-col items-center gap-1 h-full justify-end" title="' +
          VH.fmt.esc(b.days + ' night' + (b.days === 1 ? '' : 's')) + '">' +
          '<span class="font-label-sm text-label-sm text-on-surface">' +
          VH.fmt.num(b.avg_productivity, 0, '--') + '</span>' +
          '<div class="w-full max-w-[36px] rounded-t-md bg-primary" style="height:' +
          Math.max(4, height).toFixed(0) + '%"></div>' +
          '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
          VH.fmt.esc(b.band) + '</span>' +
          '<span class="font-label-sm text-[10px] text-outline">n=' + b.days + '</span></div>';
      }).join('') + '</div>';

    var best = bands.slice().sort(function (a, b) {
      return (b.avg_productivity || 0) - (a.avg_productivity || 0);
    })[0];
    return card('bedtime', 'primary', 'Sleep against productivity', 'your rows',
      'Productivity is the rollup’s own 0-100 score: the share of your available study ' +
      'hours you actually used, scaled by how focused those sessions were.',
      body, 'Best band', best.band + ' · ' + VH.fmt.num(best.avg_productivity, 0));
  }

  function focusCard() {
    var parts = ctx.insights.focus_by_part_of_day;
    if (!parts.length) {
      return card('schedule', 'secondary', 'Focus by time of day', 'no sessions',
        'Log a few focus sessions and this shows when your ratings hold up.',
        '<p class="font-body-sm text-body-sm text-outline">Nothing recorded.</p>',
        'Sessions', '0');
    }
    var body = '<div class="flex flex-col gap-space-sm">' + parts.map(function (p) {
      var pct = p.avg_focus / 5 * 100;
      var tone = p.avg_focus >= 4 ? 'primary' : p.avg_focus >= 3 ? 'secondary' : 'error';
      return '<div class="flex flex-col gap-1">' +
        '<div class="flex items-center justify-between gap-2 font-label-sm text-label-sm">' +
        '<span class="text-on-surface truncate">' + VH.fmt.esc(VH.fmt.title(p.part_of_day)) +
        ' <span class="text-outline">(' + VH.fmt.hours(p.hours) + ', ' + p.sessions +
        ' sessions)</span></span>' +
        '<span class="text-' + tone + ' font-semibold flex-shrink-0">' +
        VH.fmt.num(p.avg_focus) + '/5</span></div>' +
        '<div class="w-full h-1.5 rounded-full bg-surface-container overflow-hidden">' +
        '<div class="h-full rounded-full bg-' + tone + '" style="width:' +
        VH.clamp01(pct) + '%"></div></div></div>';
    }).join('') + '</div>';

    var best = parts[0];
    var worst = parts[parts.length - 1];
    return card('schedule', 'primary', 'Focus by time of day', 'your ratings',
      'The focus rating you give each session, grouped by when the session started.',
      body, parts.length > 1 ? best.part_of_day + ' beats ' + worst.part_of_day + ' by'
                             : 'Best window',
      parts.length > 1 ? VH.fmt.num(best.avg_focus - worst.avg_focus, 1) + ' points'
                       : VH.fmt.num(best.avg_focus) + '/5');
  }

  function projectionCard() {
    var ins = ctx.insights;
    var bands = ins.sleep_vs_productivity.filter(function (b) {
      return b.band !== 'unknown' && b.avg_productivity !== null;
    });
    if (bands.length < 2) {
      return card('trending_up', 'secondary', 'If the sleep changed', 'thin data',
        'Needs nights logged at more than one length before a comparison means anything.',
        '<p class="font-body-sm text-body-sm text-outline">Not enough data.</p>',
        'Bands with data', String(bands.length));
    }
    var sorted = bands.slice().sort(function (a, b) {
      return (b.avg_productivity || 0) - (a.avg_productivity || 0);
    });
    var best = sorted[0];
    var current = ins.averages.avg_productivity;
    var delta = best.avg_productivity - current;

    var body = '<div class="grid grid-cols-2 gap-space-sm">' +
      '<div class="p-space-sm rounded-xl bg-surface-container flex flex-col gap-0.5">' +
      '<span class="font-headline-sm text-headline-sm text-on-surface">' +
      VH.fmt.num(current, 0, '--') + '</span>' +
      '<span class="font-label-sm text-label-sm text-on-surface-variant">Your average now</span>' +
      '<span class="font-label-sm text-[10px] text-outline">across ' +
      (ins.averages.days_logged || 0) + ' days</span></div>' +
      '<div class="p-space-sm rounded-xl bg-primary/10 flex flex-col gap-0.5">' +
      '<span class="font-headline-sm text-headline-sm text-primary">' +
      VH.fmt.num(best.avg_productivity, 0) + '</span>' +
      '<span class="font-label-sm text-label-sm text-on-surface-variant">On ' +
      VH.fmt.esc(best.band) + ' nights</span>' +
      '<span class="font-label-sm text-[10px] text-outline">n=' + best.days + '</span></div></div>';

    return card('trending_up', delta > 0 ? 'primary' : 'secondary', 'If the sleep changed',
      'arithmetic, not a forecast',
      'This is simply your own average productivity on your best-slept days, set beside your ' +
      'overall average. It is a comparison of two groups you already have, not a prediction.',
      body, 'Gap between the two',
      (delta >= 0 ? '+' : '') + VH.fmt.num(delta, 1) + ' points');
  }

  function renderCards() {
    html('an-cards', sleepCard() + focusCard() + projectionCard());
    set('an-source', 'Recomputed on every write');
  }

  /* ------------------------------------------------------------------
   * Recommendations
   * ---------------------------------------------------------------- */

  function recommendations() {
    var ins = ctx.insights;
    var out = [];

    if (ins.scores.sleep_health !== null && ins.scores.sleep_health < 75 &&
        ins.averages.avg_sleep_minutes) {
      var shortBy = (480 - ins.averages.avg_sleep_minutes) / 60;
      out.push({
        gap: 100 - ins.scores.sleep_health,
        icon: 'nightlight_round', tone: 'secondary',
        title: 'Move bedtime ' + VH.fmt.hm(Math.max(15, shortBy * 60)) + ' earlier',
        tag: VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) + ' now',
        body: 'Your own numbers: the nights you cleared 7.5 hours carry the highest ' +
          'productivity score of any band.',
        action: 'sleep.html', label: 'Open sleep'
      });
    }

    var best = (ins.focus_by_part_of_day || [])[0];
    var worst = (ins.focus_by_part_of_day || [])[ins.focus_by_part_of_day.length - 1];
    if (best && worst && best.part_of_day !== worst.part_of_day &&
        best.avg_focus - worst.avg_focus >= 0.5) {
      out.push({
        gap: (best.avg_focus - worst.avg_focus) * 20,
        icon: 'wb_sunny', tone: 'primary',
        title: 'Move the hard work into the ' + best.part_of_day,
        tag: VH.fmt.num(best.avg_focus) + '/5 vs ' + VH.fmt.num(worst.avg_focus) + '/5',
        body: 'You rate ' + best.part_of_day + ' sessions ' +
          VH.fmt.num(best.avg_focus - worst.avg_focus, 1) + ' points higher than ' +
          worst.part_of_day + ' ones, across ' + (best.sessions + worst.sessions) + ' sessions.',
        action: 'schedule.html', label: 'Open schedule'
      });
    }

    if (ins.averages.avg_social_minutes > 60) {
      out.push({
        gap: Math.min(100, ins.averages.avg_social_minutes / 3),
        icon: 'phone_iphone', tone: 'error',
        title: 'Social apps are taking ' + VH.fmt.hm(ins.averages.avg_social_minutes) + ' a day',
        tag: 'reclaimable',
        body: 'That is ' + VH.fmt.hours(ins.averages.avg_social_minutes * 7 / 60) +
          ' a week, against ' + VH.fmt.hours(ins.averages.avg_study_hours) + ' of study a day.',
        action: 'index.html', label: 'Log screen time'
      });
    }

    if (ins.scores.focus_consistency !== null && ins.scores.focus_consistency < 60) {
      out.push({
        gap: 100 - ins.scores.focus_consistency,
        icon: 'timer', tone: 'secondary',
        title: 'Sessions are sporadic',
        tag: ins.focus.sessions + ' in ' + ins.window_days + ' days',
        body: 'A short session every day scores better here than one long one a week.',
        action: 'focus.html', label: 'Start one'
      });
    }

    out.sort(function (a, b) { return b.gap - a.gap; });
    return out.slice(0, 3);
  }

  function renderActions() {
    var items = recommendations();
    html('an-actions', items.length
      ? items.map(function (item) {
          return '<div class="p-space-md rounded-xl bg-surface-container-high flex flex-col ' +
            'sm:flex-row items-start sm:items-center justify-between gap-space-md ' +
            'hover:bg-surface-bright transition-all">' +
            '<div class="flex items-start gap-space-md min-w-0">' +
            '<div class="w-10 h-10 rounded-xl bg-' + item.tone + '-container/20 flex items-center ' +
            'justify-center text-' + item.tone + ' flex-shrink-0 mt-0.5">' +
            '<span class="material-symbols-outlined">' + item.icon + '</span></div>' +
            '<div class="min-w-0"><div class="flex flex-wrap items-center gap-space-xs">' +
            '<span class="font-title-md text-title-md text-on-surface">' +
            VH.fmt.esc(item.title) + '</span>' +
            '<span class="px-2 py-0.5 rounded bg-' + item.tone + '/15 text-' + item.tone +
            ' font-label-sm text-label-sm">' + VH.fmt.esc(item.tag) + '</span></div>' +
            '<p class="font-body-sm text-body-sm text-on-surface-variant mt-1">' +
            VH.fmt.esc(item.body) + '</p></div></div>' +
            '<a href="' + item.action + '" class="px-space-md py-space-xs rounded-lg ' +
            'bg-surface-container text-on-surface hover:bg-surface-variant font-label-md ' +
            'text-label-md flex-shrink-0 transition-colors">' + VH.fmt.esc(item.label) +
            '</a></div>';
        }).join('')
      : '<p class="font-body-md text-body-md text-on-surface-variant">Nothing stands out. ' +
        'The numbers you have logged are holding up.</p>');
    set('an-basis', 'From ' + (ctx.insights.averages.days_logged || 0) + ' days of rows');
    set('an-plan-tag', items.length
      ? items.length + (items.length === 1 ? ' suggestion' : ' suggestions')
      : 'nothing flagged');
  }

  /* ------------------------------------------------------------------
   * Summary capsule
   * ---------------------------------------------------------------- */

  function summaryPairs() {
    var ins = ctx.insights;
    var lowest = lowestScore();
    var top = recommendations()[0];
    return [
      ['Where you are', ins.synthesis_index === null ? 'Not enough logged yet'
        : Math.round(ins.synthesis_index) + '/100 overall, ' +
          band(ins.synthesis_index, ['holding up well', 'steady', 'under strain', 'struggling'])],
      ['Weakest area', lowest ? lowest.label + ' at ' + Math.round(lowest.value) + '/100'
        : 'Nothing measured'],
      ['Biggest single change', top ? top.title : 'Nothing stands out'],
      ['Based on', (ins.averages.days_logged || 0) + ' days of logs, ' +
        ins.focus.sessions + ' focus sessions' +
        (state.grades && state.grades.overall ? ', ' + (state.grades.overall.items || 0) +
          ' graded items' : '')]
    ];
  }

  function renderCapsule() {
    html('an-capsule', summaryPairs().map(function (pair, index) {
      return '<div class="p-space-sm rounded-lg bg-surface-container-high/80">' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant block">' +
        VH.fmt.esc(pair[0]) + '</span>' +
        '<span class="font-body-md text-body-md ' +
        (index === 2 ? 'text-primary' : 'text-on-surface') + ' font-medium">' +
        VH.fmt.esc(pair[1]) + '</span></div>';
    }).join(''));
  }

  function summaryText() {
    return ['Analytics summary for ' + ctx.student.name,
            'Generated ' + VH.fmt.longDate(ctx.insights.today) + ' from VinHack logs.', '']
      .concat(summaryPairs().map(function (p) { return p[0] + ': ' + p[1]; }))
      .concat(['', 'All figures are self-reported and computed locally.'])
      .join('\n');
  }

  function copySummary() {
    if (!navigator.clipboard) {
      VH.toast('Clipboard is not available in this browser.', 'error');
      return;
    }
    navigator.clipboard.writeText(summaryText()).then(function () {
      VH.toast('Summary copied.');
    }, function () { VH.toast('Could not reach the clipboard.', 'error'); });
  }

  function exportCsv() {
    var rows = [['date', 'sleep_minutes', 'sleep_quality', 'screen_minutes',
                 'social_minutes', 'study_hours', 'available_hours', 'energy',
                 'productivity_score'].join(',')];
    ctx.insights.trend.forEach(function (day) {
      rows.push([day.date, day.sleep_duration, day.sleep_quality, day.total_screen_minutes,
                 day.social_media_minutes, day.study_hours_completed, day.available_study_hours,
                 day.energy_score, day.productivity_score]
        .map(function (v) { return v === null || v === undefined ? '' : v; }).join(','));
    });
    var blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'vinhack-daily-metrics.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    VH.toast(ctx.insights.trend.length + ' days exported.');
  }

  /* ------------------------------------------------------------------
   * Wiring
   * ---------------------------------------------------------------- */

  function wire() {
    var share = $('advisorShareBtn');
    if (share) share.addEventListener('click', function (e) { e.preventDefault(); copySummary(); });
    var transmit = $('sendDirectAdvisorBtn');
    if (transmit) transmit.addEventListener('click', function (e) { e.preventDefault(); copySummary(); });
    var csv = $('pdfExportBtn');
    if (csv) csv.addEventListener('click', function (e) { e.preventDefault(); exportCsv(); });
  }

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.insights(id, 14),
      VH.api.grades(id)
    ]);
    ctx.insights = results[0];
    VH.shell.insights = results[0];
    state.grades = results[1];

    renderIndex();
    renderScores();
    renderCards();
    renderActions();
    renderCapsule();
  }

  async function boot() {
    ctx = await VH.shell.boot('analytics');
    if (!ctx) return;
    wire();
    await reload();
  }

  boot().catch(function (err) { VH.fail(err, 'Analytics'); });
})(window.VH);
