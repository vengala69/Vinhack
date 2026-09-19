/* Test scores.
 *
 * Reads v_assessment_pct (each item with its percentage and distance from the
 * class average) and v_subject_grades (the weight-averaged standing per
 * subject). The export showed a 4.0-scale GPA and a cohort median; neither
 * exists in this database, so the headline figure is the weighted percentage
 * the ledger genuinely supports, and the comparison line is the class average
 * you typed in on each item - drawn only where you actually entered one.
 */
(function (VH) {
  'use strict';

  var ctx = null;
  var state = { grades: null, items: [], subject: 'all', whatIf: {} };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  /* A display band, not an institutional grade - the database stores
   * percentages and nothing else. */
  function bandFor(percent) {
    if (percent === null || percent === undefined) return { letter: '--', tone: 'on-surface-variant' };
    if (percent >= 90) return { letter: 'A', tone: 'primary' };
    if (percent >= 80) return { letter: 'B', tone: 'primary' };
    if (percent >= 70) return { letter: 'C', tone: 'secondary' };
    if (percent >= 60) return { letter: 'D', tone: 'tertiary' };
    return { letter: 'E', tone: 'error' };
  }

  var CATEGORY_ICON = {
    exam: 'assignment', quiz: 'quiz', lab: 'science', project: 'account_tree',
    assignment: 'edit_note', participation: 'forum', other: 'description'
  };

  /* ------------------------------------------------------------------
   * Header
   * ---------------------------------------------------------------- */

  function renderHeader() {
    var overall = state.grades.overall || {};
    var weighted = state.grades.subjects.length
      ? state.grades.subjects.reduce(function (sum, s) {
          return sum + s.weighted_percent * (s.weight_recorded || 1);
        }, 0) / state.grades.subjects.reduce(function (sum, s) {
          return sum + (s.weight_recorded || 1);
        }, 0)
      : null;

    set('scores-overall', weighted === null ? '--' : VH.fmt.num(weighted, 1));
    set('scores-overall-note', overall.avg_class_delta === null ||
      overall.avg_class_delta === undefined
      ? 'No class averages recorded'
      : (overall.avg_class_delta >= 0 ? '+' : '') + VH.fmt.num(overall.avg_class_delta, 1) +
        ' vs class average');
    set('scores-count', String(overall.items || 0));
    set('scores-count-note', state.grades.subjects.length + ' subject' +
      (state.grades.subjects.length === 1 ? '' : 's'));
    set('scores-updated', state.items.length
      ? 'newest ' + VH.fmt.date(state.items[0].assessed_on)
      : 'nothing recorded yet');
  }

  /* ------------------------------------------------------------------
   * Subject cards
   * ---------------------------------------------------------------- */

  function renderSubjects() {
    if (!state.grades.subjects.length) {
      html('scores-subjects', '<div class="lg:col-span-3 p-space-lg rounded-2xl ' +
        'bg-surface-container-low text-center font-body-md text-body-md text-on-surface-variant">' +
        'No scores recorded yet. Use <strong class="text-primary">+ Log a score</strong> to add one.' +
        '</div>');
      return;
    }
    html('scores-subjects', state.grades.subjects.map(function (subject) {
      var band = bandFor(subject.weighted_percent);
      var items = state.items.filter(function (item) {
        return item.subject === subject.subject;
      }).slice(0, 4);
      return '<div class="flex flex-col h-full rounded-2xl bg-surface-container-low/90 ' +
        'backdrop-blur-xl shadow-xl overflow-hidden">' +
        '<div class="p-space-lg flex flex-col gap-space-sm">' +
        '<div class="flex items-start justify-between gap-space-sm">' +
        '<div class="flex flex-col min-w-0">' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant uppercase tracking-wide">' +
        subject.items + ' item' + (subject.items === 1 ? '' : 's') + ' · ' +
        VH.fmt.num(subject.weight_recorded, 0) + '% of grade recorded</span>' +
        '<h2 class="font-headline-sm text-headline-sm text-on-surface truncate">' +
        VH.fmt.esc(subject.subject) + '</h2>' +
        '<span class="font-label-md text-label-md text-on-surface-variant">Last: ' +
        VH.fmt.esc(VH.fmt.date(subject.last_assessed_on)) + '</span></div>' +
        '<div class="flex flex-col items-end flex-shrink-0">' +
        '<span class="font-metric-display text-metric-display text-' + band.tone + '">' +
        band.letter + '</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
        VH.fmt.num(subject.weighted_percent, 1) + '%</span></div></div>' +
        '<div class="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">' +
        '<div class="h-full rounded-full bg-' + band.tone + '" style="width:' +
        VH.clamp01(subject.weighted_percent) + '%"></div></div>' +
        '<div class="flex flex-col gap-space-xs pt-space-xs">' +
        items.map(function (item) {
          return '<div class="flex items-center justify-between gap-2 py-1">' +
            '<div class="flex items-center gap-space-xs min-w-0">' +
            '<span class="material-symbols-outlined text-[16px] text-on-surface-variant ' +
            'flex-shrink-0">' + (CATEGORY_ICON[item.category] || 'description') + '</span>' +
            '<span class="font-body-sm text-body-sm text-on-surface truncate">' +
            VH.fmt.esc(item.title) + '</span></div>' +
            '<span class="font-label-md text-label-md text-on-surface flex-shrink-0">' +
            VH.fmt.num(item.score, 0) + '<span class="text-on-surface-variant font-normal">/' +
            VH.fmt.num(item.max_score, 0) + '</span></span></div>';
        }).join('') +
        '</div></div>' +
        '<div class="mt-auto px-space-lg py-space-sm bg-surface-container-lowest/60 flex ' +
        'items-center justify-between gap-2">' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant truncate">' +
        (subject.avg_class_delta === null
          ? 'No class average recorded'
          : (subject.avg_class_delta >= 0 ? '+' : '') + VH.fmt.num(subject.avg_class_delta, 1) +
            ' vs class') + '</span>' +
        '<button class="px-space-sm py-1 rounded-lg bg-surface-container-high hover:bg-surface-bright ' +
        'text-on-surface font-label-sm text-label-sm transition-colors flex-shrink-0" ' +
        'data-subject="' + VH.fmt.esc(subject.subject) + '">View trend</button>' +
        '</div></div>';
    }).join(''));
  }

  /* ------------------------------------------------------------------
   * Trajectory chart
   * ---------------------------------------------------------------- */

  function renderTabs() {
    var tabs = [{ key: 'all', label: 'All subjects' }].concat(
      state.grades.subjects.map(function (s) {
        return { key: s.subject, label: s.subject };
      }));
    html('scores-tabs', tabs.map(function (tab) {
      var active = tab.key === state.subject;
      return '<button class="px-space-sm py-1 rounded font-label-sm text-label-sm transition-colors ' +
        (active ? 'bg-primary text-on-primary font-semibold'
                : 'text-on-surface-variant hover:text-on-surface') +
        '" data-tab="' + VH.fmt.esc(tab.key) + '">' + VH.fmt.esc(tab.label) + '</button>';
    }).join(''));
  }

  function renderChart() {
    var items = state.items.filter(function (item) {
      return state.subject === 'all' || item.subject === state.subject;
    }).slice().reverse();     // oldest first, left to right

    var setPath = function (id, d) {
      var el = $(id);
      if (el) el.setAttribute('d', d);
    };

    if (items.length < 2) {
      ['chart-line-user', 'chart-area-user', 'chart-line-median'].forEach(function (id) {
        setPath(id, '');
      });
      html('chart-nodes', '');
      html('chart-labels', '<span class="text-outline">Two or more items in a subject are ' +
        'needed to draw a line.</span>');
      set('chart-stat-callout', items.length === 1
        ? VH.fmt.num(items[0].percent, 1) + '% on the one recorded item' : 'Nothing recorded');
      return;
    }

    /* The viewBox is 700x180. Percentages run 50-100 up the y axis, which is
     * where marks realistically sit and keeps the line off the floor. */
    var LEFT = 40, RIGHT = 660, TOP = 20, BOTTOM = 160;
    var step = (RIGHT - LEFT) / (items.length - 1);
    var y = function (percent) {
      var clamped = Math.max(50, Math.min(100, percent));
      return BOTTOM - (clamped - 50) / 50 * (BOTTOM - TOP);
    };

    var points = items.map(function (item, index) {
      return { x: LEFT + step * index, y: y(item.percent), item: item };
    });
    var line = points.map(function (p, i) {
      return (i ? 'L ' : 'M ') + p.x.toFixed(0) + ',' + p.y.toFixed(0);
    }).join(' ');
    setPath('chart-line-user', line);
    setPath('chart-area-user', line + ' L ' + RIGHT.toFixed(0) + ',170 L ' + LEFT + ',170 Z');

    /* The class-average line is only drawn across the items that carry one. */
    var withAverage = points.filter(function (p) { return p.item.class_average !== null; });
    setPath('chart-line-median', withAverage.length > 1
      ? withAverage.map(function (p, i) {
          return (i ? 'L ' : 'M ') + p.x.toFixed(0) + ',' + y(p.item.class_average).toFixed(0);
        }).join(' ')
      : '');

    html('chart-nodes', points.map(function (p) {
      return '<circle cx="' + p.x.toFixed(0) + '" cy="' + p.y.toFixed(0) + '" r="5" ' +
        'fill="#10b981"><title>' + VH.fmt.esc(p.item.title + ' · ' +
        VH.fmt.num(p.item.percent, 1) + '% · ' + p.item.assessed_on) + '</title></circle>';
    }).join(''));

    html('chart-labels', points.map(function (p) {
      return '<span class="truncate flex-1 text-center">' +
        VH.fmt.esc(VH.fmt.date(p.item.assessed_on)) + '</span>';
    }).join(''));

    var deltas = items.filter(function (i) { return i.class_delta !== null; });
    set('chart-stat-callout', deltas.length
      ? 'Average ' + (deltas.reduce(function (sum, i) { return sum + i.class_delta; }, 0) /
          deltas.length >= 0 ? '+' : '') +
        VH.fmt.num(deltas.reduce(function (sum, i) { return sum + i.class_delta; }, 0) /
          deltas.length, 1) + ' vs class, over ' + deltas.length + ' items'
      : 'No class averages recorded for these items');
  }

  /* ------------------------------------------------------------------
   * Categories
   * ---------------------------------------------------------------- */

  function renderCategories() {
    var categories = state.grades.by_category || [];
    html('scores-categories', categories.length
      ? categories.map(function (row) {
          var band = bandFor(row.mean_percent);
          return '<div class="flex flex-col gap-space-xs p-space-sm rounded-xl bg-surface-container">' +
            '<div class="flex items-center justify-between gap-2">' +
            '<span class="font-label-md text-label-md text-on-surface truncate">' +
            VH.fmt.esc(VH.fmt.title(row.category)) + '</span>' +
            '<span class="font-label-sm text-label-sm text-on-surface-variant flex-shrink-0">' +
            row.items + '</span></div>' +
            '<span class="font-title-md text-title-md text-' + band.tone + '">' +
            VH.fmt.num(row.mean_percent, 1) + '%</span>' +
            '<div class="w-full h-1.5 rounded-full bg-surface-container-highest overflow-hidden">' +
            '<div class="h-full rounded-full bg-' + band.tone + '" style="width:' +
            VH.clamp01(row.mean_percent) + '%"></div></div>' +
            '<span class="font-label-sm text-label-sm text-outline">' +
            VH.fmt.num(row.weight_recorded, 0) + '% of grade</span></div>';
        }).join('')
      : '<p class="col-span-4 font-body-sm text-body-sm text-on-surface-variant">' +
        'Nothing recorded yet.</p>');
  }

  /* ------------------------------------------------------------------
   * What-if
   * ---------------------------------------------------------------- */

  function baselineOverall() {
    var subjects = state.grades.subjects;
    if (!subjects.length) return null;
    var weight = subjects.reduce(function (sum, s) { return sum + (s.weight_recorded || 1); }, 0);
    return subjects.reduce(function (sum, s) {
      return sum + s.weighted_percent * (s.weight_recorded || 1);
    }, 0) / weight;
  }

  function renderWhatIf() {
    var subjects = state.grades.subjects;
    if (!subjects.length) {
      html('scores-sliders', '<p class="font-body-sm text-body-sm text-on-surface-variant">' +
        'Record a score first.</p>');
      return;
    }
    html('scores-sliders', subjects.map(function (subject) {
      var value = state.whatIf[subject.subject];
      return '<div class="flex flex-col gap-space-xs">' +
        '<div class="flex justify-between font-label-sm text-label-sm gap-2">' +
        '<span class="text-on-surface truncate">' + VH.fmt.esc(subject.subject) + '</span>' +
        '<span class="text-primary font-semibold flex-shrink-0" data-value="' +
        VH.fmt.esc(subject.subject) + '">' + Math.round(value) + '%</span></div>' +
        '<input type="range" min="40" max="100" step="1" value="' + Math.round(value) +
        '" class="w-full accent-primary" data-slider="' + VH.fmt.esc(subject.subject) + '">' +
        '<div class="flex justify-between font-label-sm text-label-sm text-outline">' +
        '<span>40%</span><span>now ' + VH.fmt.num(subject.weighted_percent, 0) +
        '%</span><span>100%</span></div></div>';
    }).join(''));
    paintWhatIf();
  }

  function paintWhatIf() {
    var subjects = state.grades.subjects;
    var weight = subjects.reduce(function (sum, s) { return sum + (s.weight_recorded || 1); }, 0);
    var projected = subjects.reduce(function (sum, s) {
      return sum + state.whatIf[s.subject] * (s.weight_recorded || 1);
    }, 0) / weight;
    var baseline = baselineOverall();
    var delta = projected - baseline;

    set('predicted-gpa', VH.fmt.num(projected, 1));
    var deltaEl = $('gpa-delta');
    if (deltaEl) {
      deltaEl.textContent = (delta >= 0 ? '+' : '') + VH.fmt.num(delta, 1);
      deltaEl.className = 'font-label-md text-label-md font-semibold ' +
        (delta >= 0 ? 'text-secondary' : 'text-error');
    }
    set('gpa-status-note', Math.abs(delta) < 0.05
      ? 'Same as where you are now'
      : delta > 0 ? 'Up ' + VH.fmt.num(delta, 1) + ' points on today'
                  : 'Down ' + VH.fmt.num(Math.abs(delta), 1) + ' points on today');
    var ring = $('gpa-ring');
    if (ring) ring.setAttribute('stroke-dasharray', Math.round(VH.clamp01(projected)) + ', 100');
    var ringLabel = ring && ring.closest('div')
      ? ring.closest('div').querySelector('span') : null;
    if (ringLabel) ringLabel.textContent = Math.round(projected) + '%';
  }

  function resetWhatIf() {
    state.whatIf = {};
    state.grades.subjects.forEach(function (s) {
      state.whatIf[s.subject] = s.weighted_percent;
    });
  }

  /* ------------------------------------------------------------------
   * Ledger
   * ---------------------------------------------------------------- */

  function renderLedger() {
    var items = state.items.filter(function (item) {
      return state.subject === 'all' || item.subject === state.subject;
    });
    html('scores-rows', items.length
      ? items.map(function (item) {
          var delta = item.class_delta;
          return '<tr class="hover:bg-surface-container/60 transition-colors" data-item="' +
            item.assessment_id + '">' +
            '<td class="py-space-sm px-space-md font-semibold text-primary">' +
            VH.fmt.esc(item.subject) + '</td>' +
            '<td class="py-space-sm px-space-sm font-medium">' + VH.fmt.esc(item.title) + '</td>' +
            '<td class="py-space-sm px-space-sm"><span class="px-space-xs py-0.5 rounded ' +
            'bg-surface-container-high text-on-surface font-label-sm text-label-sm">' +
            VH.fmt.esc(VH.fmt.title(item.category)) + '</span></td>' +
            '<td class="py-space-sm px-space-sm text-on-surface-variant">' +
            VH.fmt.esc(VH.fmt.date(item.assessed_on)) + '</td>' +
            '<td class="py-space-sm px-space-sm font-bold text-on-surface">' +
            VH.fmt.num(item.score, 1) + ' <span class="text-on-surface-variant font-normal">/ ' +
            VH.fmt.num(item.max_score, 0) + '</span></td>' +
            '<td class="py-space-sm px-space-sm text-on-surface-variant">' +
            (item.weight_percent === null ? '—' : VH.fmt.num(item.weight_percent, 0) + '%') + '</td>' +
            '<td class="py-space-sm px-space-md ' +
            (delta === null ? 'text-on-surface-variant'
              : delta >= 0 ? 'text-primary' : 'text-error') + '">' +
            (delta === null ? '—'
              : (delta >= 0 ? '+' : '') + VH.fmt.num(delta, 1) + '% (class ' +
                VH.fmt.num(item.class_average, 1) + ')') +
            ' <button class="ml-2 text-on-surface-variant hover:text-error" data-delete="' +
            item.assessment_id + '" title="Delete this row">' +
            '<span class="material-symbols-outlined text-[15px] align-middle">delete</span>' +
            '</button></td></tr>';
        }).join('')
      : '<tr><td class="py-space-md px-space-md text-on-surface-variant" colspan="7">' +
        'Nothing recorded' + (state.subject === 'all' ? '' : ' for ' + VH.fmt.esc(state.subject)) +
        '.</td></tr>');
  }

  function exportCsv() {
    var header = ['subject', 'title', 'category', 'assessed_on', 'score', 'max_score',
                  'percent', 'weight_percent', 'class_average', 'class_delta'];
    var quote = function (value) {
      if (value === null || value === undefined) return '';
      var text = String(value);
      return /[",\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
    };
    var csv = [header.join(',')].concat(state.items.map(function (item) {
      return header.map(function (key) { return quote(item[key]); }).join(',');
    })).join('\n');

    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'vinhack-scores-' + ctx.student.name.replace(/\s+/g, '-').toLowerCase() + '.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    VH.toast(state.items.length + ' rows exported.');
  }

  /* ------------------------------------------------------------------
   * Adding a score
   * ---------------------------------------------------------------- */

  var FIELD = 'w-full bg-surface-container-lowest/70 border border-outline-variant/40 rounded-lg ' +
    'px-space-sm py-space-xs text-on-surface font-body-md text-body-md ' +
    'focus:border-secondary focus:outline-none';
  var CAPTION = 'font-label-sm text-label-sm uppercase tracking-wide text-on-surface-variant';

  function scoreModal() {
    var existing = $('vh-score');
    if (existing) return existing;
    var wrap = document.createElement('div');
    wrap.id = 'vh-score';
    wrap.className = 'hidden fixed inset-0 z-[150] items-center justify-center p-4 ' +
      'bg-surface-container-lowest/80 backdrop-blur-sm';
    wrap.innerHTML = '<form class="w-full max-w-md rounded-2xl bg-surface-container/95 border ' +
      'border-outline-variant/40 shadow-2xl p-space-lg flex flex-col gap-space-md max-h-[90vh] ' +
      'overflow-y-auto" id="vh-score-form">' +
      '<div class="flex items-center justify-between">' +
      '<h3 class="font-headline-sm text-headline-sm text-on-surface">Log a score</h3>' +
      '<button type="button" data-close class="text-on-surface-variant hover:text-on-surface">' +
      '<span class="material-symbols-outlined">close</span></button></div>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Subject</span>' +
      '<input name="subject" required list="vh-score-subjects" class="' + FIELD + '">' +
      '<datalist id="vh-score-subjects"></datalist></label>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">What was it</span>' +
      '<input name="title" required class="' + FIELD + '" placeholder="e.g. Mid-term 1"></label>' +
      '<div class="grid grid-cols-2 gap-space-sm">' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Category</span>' +
      '<select name="category" class="' + FIELD + '">' +
      ['exam', 'quiz', 'lab', 'project', 'assignment', 'participation', 'other'].map(function (c) {
        return '<option value="' + c + '">' + VH.fmt.title(c) + '</option>';
      }).join('') + '</select></label>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Date</span>' +
      '<input name="assessed_on" type="date" required class="' + FIELD + '"></label></div>' +
      '<div class="grid grid-cols-2 gap-space-sm">' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Score</span>' +
      '<input name="score" type="number" min="0" step="0.5" required class="' + FIELD + '"></label>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Out of</span>' +
      '<input name="max_score" type="number" min="1" step="0.5" value="100" required class="' +
      FIELD + '"></label></div>' +
      '<div class="grid grid-cols-2 gap-space-sm">' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Weight (%)</span>' +
      '<input name="weight_percent" type="number" min="0" max="100" step="0.5" class="' +
      FIELD + '" placeholder="optional"></label>' +
      '<label class="flex flex-col gap-1"><span class="' + CAPTION + '">Class average</span>' +
      '<input name="class_average" type="number" min="0" step="0.5" class="' + FIELD +
      '" placeholder="optional"></label></div>' +
      '<p class="font-label-sm text-label-sm text-outline">Weight is the share of the final ' +
      'subject grade this carries; leave it blank and the item is averaged evenly.</p>' +
      '<div class="flex justify-end gap-space-sm pt-space-xs">' +
      '<button type="button" data-close class="px-space-md py-space-xs rounded-lg ' +
      'bg-surface-container-high text-on-surface font-label-md text-label-md">Cancel</button>' +
      '<button type="submit" class="px-space-md py-space-xs rounded-lg bg-primary text-on-primary ' +
      'font-label-md text-label-md font-semibold">Save score</button></div></form>';
    document.body.appendChild(wrap);

    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || e.target.closest('[data-close]')) {
        wrap.classList.add('hidden');
        wrap.classList.remove('flex');
      }
    });
    wrap.addEventListener('submit', function (e) {
      e.preventDefault();
      submitScore(e.target, wrap).catch(function (err) { VH.fail(err, 'Log score'); });
    });
    return wrap;
  }

  function openScoreModal() {
    var wrap = scoreModal();
    var form = $('vh-score-form');
    form.reset();
    form.elements.max_score.value = 100;
    form.elements.assessed_on.value = ctx.insights.today;
    var list = $('vh-score-subjects');
    if (list) {
      list.innerHTML = state.grades.subjects.map(function (s) {
        return '<option value="' + VH.fmt.esc(s.subject) + '">';
      }).join('');
    }
    wrap.classList.remove('hidden');
    wrap.classList.add('flex');
    form.elements.subject.focus();
  }

  async function submitScore(form, wrap) {
    var data = new FormData(form);
    var body = {
      subject: data.get('subject').trim(),
      title: data.get('title').trim(),
      category: data.get('category'),
      assessed_on: data.get('assessed_on'),
      score: Number(data.get('score')),
      max_score: Number(data.get('max_score'))
    };
    if (data.get('weight_percent')) body.weight_percent = Number(data.get('weight_percent'));
    if (data.get('class_average')) body.class_average = Number(data.get('class_average'));
    if (body.score > body.max_score) {
      VH.toast('The score cannot be higher than the maximum.', 'error');
      return;
    }
    await VH.api.createAssessment(ctx.student.student_id, body);
    wrap.classList.add('hidden');
    wrap.classList.remove('flex');
    VH.toast('Score recorded.');
    await reload();
  }

  /* ------------------------------------------------------------------
   * Loading
   * ---------------------------------------------------------------- */

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.grades(id),
      VH.api.assessments(id, { limit: 200 })
    ]);
    state.grades = results[0];
    state.items = results[1];
    if (state.subject !== 'all' && !state.grades.subjects.some(function (s) {
      return s.subject === state.subject;
    })) {
      state.subject = 'all';
    }
    resetWhatIf();
    renderHeader();
    renderSubjects();
    renderTabs();
    renderChart();
    renderCategories();
    renderWhatIf();
    renderLedger();
  }

  function selectSubject(key) {
    state.subject = key;
    renderTabs();
    renderChart();
    renderLedger();
  }

  function wire() {
    document.addEventListener('click', function (e) {
      var tab = e.target.closest('[data-tab]');
      if (tab) { selectSubject(tab.getAttribute('data-tab')); return; }

      var view = e.target.closest('[data-subject]');
      if (view) {
        selectSubject(view.getAttribute('data-subject'));
        var chart = $('scores-chart');
        if (chart) chart.scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
      }

      var del = e.target.closest('[data-delete]');
      if (del) {
        var id = Number(del.getAttribute('data-delete'));
        var item = state.items.filter(function (i) { return i.assessment_id === id; })[0];
        if (!item || !window.confirm('Delete "' + item.title + '"?')) return;
        VH.api.deleteAssessment(id).then(function () {
          VH.toast('Row deleted.');
          return reload();
        }).catch(function (err) { VH.fail(err, 'Delete'); });
        return;
      }

      if (e.target.closest('#scores-add')) { e.preventDefault(); openScoreModal(); return; }
      if (e.target.closest('#scores-export') || e.target.closest('#scores-export-2')) {
        e.preventDefault();
        exportCsv();
        return;
      }
      if (e.target.closest('#scores-filter')) {
        e.preventDefault();
        selectSubject('all');
        VH.toast('Showing every subject.', 'info');
      }
    });

    document.addEventListener('input', function (e) {
      var slider = e.target.closest('[data-slider]');
      if (!slider) return;
      var subject = slider.getAttribute('data-slider');
      state.whatIf[subject] = Number(slider.value);
      var label = document.querySelector('[data-value="' + CSS.escape(subject) + '"]');
      if (label) label.textContent = Math.round(state.whatIf[subject]) + '%';
      paintWhatIf();
    });

    var reset = document.querySelector('button .material-symbols-outlined');
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (btn) {
      if (/Reset Defaults/i.test(btn.textContent)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          resetWhatIf();
          renderWhatIf();
        });
      }
    });
    if (reset) { /* referenced to keep the lookup meaningful */ }

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      var wrap = $('vh-score');
      if (wrap) { wrap.classList.add('hidden'); wrap.classList.remove('flex'); }
    });
  }

  async function boot() {
    ctx = await VH.shell.boot('scores');
    if (!ctx) return;
    wire();
    await reload();
  }

  boot().catch(function (err) { VH.fail(err, 'Scores'); });
})(window.VH);
