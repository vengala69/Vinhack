/* Wellbeing.
 *
 * The protocol cards are reference reading and are left as written. The four
 * tiles at the top now show mood, sleep, energy and workload from the
 * student's own rows rather than a sympathetic-tone score and an HRV reading
 * that nothing in this stack measures.
 *
 * The chat is a small rule-based prompt box. It is not a clinician, it is not
 * an LLM, and nothing typed into it is stored or sent anywhere - the page says
 * so, and the opening message is built from the student's actual numbers so it
 * at least starts from something true.
 */
(function (VH) {
  'use strict';

  var ctx = null;
  var state = { mood: [], sleep: [], tasks: [], history: [], model: null, sending: false };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function width(id, pct) { var el = $(id); if (el) el.style.width = VH.clamp01(pct) + '%'; }

  function band(score, labels) {
    if (score === null || score === undefined) return 'no data yet';
    if (score >= 80) return labels[0];
    if (score >= 65) return labels[1];
    if (score >= 45) return labels[2];
    return labels[3];
  }

  /* ------------------------------------------------------------------
   * Tiles
   * ---------------------------------------------------------------- */

  function renderTiles() {
    var ins = ctx.insights;
    var latest = state.mood[0] || null;

    var mood = latest && latest.mood_score !== null ? latest.mood_score : null;
    set('th-mood-value', mood === null ? '--' : String(mood));
    set('th-mood-unit', '/ 10');
    width('th-mood-bar', mood ? mood * 10 : 0);
    set('th-mood-tag', mood === null ? 'no check-in'
      : band(mood * 10, ['good', 'steady', 'low', 'rough']));
    set('th-mood-note', latest
      ? 'Last checked in on ' + VH.fmt.longDate(latest.date) + '. 14-day average ' +
        VH.fmt.num(ins.mood.avg_mood, 1, '--') + '.'
      : 'Check in from the Sleep & wellbeing page and this fills in.');

    var sleepMin = ins.averages.avg_sleep_minutes;
    set('th-sleep-value', sleepMin ? VH.fmt.num(sleepMin / 60, 1) : '--');
    set('th-sleep-unit', 'hrs a night');
    width('th-sleep-bar', sleepMin ? sleepMin / 480 * 100 : 0);
    set('th-sleep-tag', ins.sleep_debt_hours === null ? 'no data'
      : ins.sleep_debt_hours < 0 ? VH.fmt.hours(Math.abs(ins.sleep_debt_hours)) + ' behind'
                                 : 'on target');
    set('th-sleep-note', sleepMin
      ? 'Across ' + (ins.averages.days_logged || 0) + ' nights, against an 8-hour goal.'
      : 'No nights logged yet.');

    var energy = ins.averages.avg_energy;
    set('th-energy-value', energy ? VH.fmt.num(energy, 1) : '--');
    set('th-energy-unit', '/ 10');
    width('th-energy-bar', energy ? energy * 10 : 0);
    set('th-energy-tag', energy === null ? 'no data'
      : band(energy * 10, ['strong', 'steady', 'low', 'flat']));
    set('th-energy-note', energy
      ? 'Self-reported, averaged over the last ' + ins.window_days + ' days.'
      : 'Nothing reported yet.');

    var open = state.tasks.length;
    var urgent = state.tasks.filter(function (t) {
      return t.priority === 'urgent' || t.priority === 'high';
    }).length;
    set('th-load-value', String(open));
    set('th-load-unit', open === 1 ? 'open task' : 'open tasks');
    /* Ten open items is taken as a full bar. */
    width('th-load-bar', open / 10 * 100);
    set('th-load-tag', urgent ? urgent + ' high or urgent' : 'nothing urgent');
    var next = state.tasks.filter(function (t) { return t.due_date; })
      .sort(function (a, b) { return a.due_date < b.due_date ? -1 : 1; })[0];
    set('th-load-note', next
      ? 'Next up: ' + next.task_name + ', ' + VH.fmt.until(next.due_date) + '.'
      : 'Nothing has a due date on it.');

    /* The two pills in the top bar. */
    var best = (ins.focus_by_part_of_day || [])[0];
    set('th-rhythm', best
      ? 'You focus best in the ' + best.part_of_day
      : 'Not enough sessions to say');
    var strain = ins.synthesis_index === null ? null : 100 - ins.synthesis_index;
    set('th-load', strain === null ? 'Nothing logged yet'
      : 'Strain: ' + band(100 - strain, ['low', 'moderate', 'high', 'high']));
    set('th-status', 'Reading your own logs');
  }

  /* ------------------------------------------------------------------
   * The prompt box
   * ---------------------------------------------------------------- */

  function opener() {
    var ins = ctx.insights;
    var bits = [];
    if (ins.averages.avg_sleep_minutes) {
      bits.push('you have been sleeping about ' +
        VH.fmt.hours(ins.averages.avg_sleep_minutes / 60) + ' a night');
    }
    if (state.tasks.length) {
      bits.push('there are ' + state.tasks.length + ' things open on your list');
    }
    var latest = state.mood[0];
    if (latest && latest.mood_score !== null) {
      bits.push('your last check-in put your mood at ' + latest.mood_score + '/10');
    }
    var lead = bits.length
      ? 'Going on what you have logged: ' + bits.join(', ') + '.'
      : 'There is not much logged yet, so this is starting from scratch.';

    var caveat = state.model
      ? 'This is an AI, not a person and not a counsellor. Nothing you type is stored &mdash; ' +
        'it is sent to the model for one reply and then forgotten. For anything serious, ' +
        'talk to someone real.'
      : 'No model is configured on the server yet, so this chat cannot answer. Add your ' +
        'API key to .env and restart. For anything serious, talk to someone real.';
    return lead + '<br><br>' + caveat;
  }

  function bubble(who, text, mine) {
    var wrap = document.createElement('div');
    wrap.className = mine
      ? 'flex flex-col gap-1 max-w-[85%] self-end items-end'
      : 'flex flex-col gap-1 max-w-[90%] self-start';
    wrap.innerHTML = '<div class="flex items-center gap-space-xs font-label-sm text-label-sm ' +
      'text-on-surface-variant"><span>' + VH.fmt.esc(who) + '</span><span>&bull;</span>' +
      '<span>' + VH.fmt.esc(VH.fmt.clock(VH.fmt.stamp(new Date()))) + '</span></div>' +
      '<div class="px-space-md py-space-sm rounded-2xl font-body-md text-body-md ' +
      (mine ? 'bg-primary/15 text-on-surface rounded-br-sm'
            : 'bg-surface-container-high text-on-surface rounded-bl-sm') + '">' + text + '</div>';
    return wrap;
  }

  function say(who, text, mine) {
    var transcript = $('chatTranscript');
    if (!transcript) return;
    transcript.appendChild(bubble(who, text, mine));
    transcript.scrollTop = transcript.scrollHeight;
  }

  function thinking() {
    var transcript = $('chatTranscript');
    if (!transcript) return null;
    var wrap = document.createElement('div');
    wrap.className = 'flex flex-col gap-1 max-w-[90%] self-start';
    wrap.innerHTML = '<div class="px-space-md py-space-sm rounded-2xl rounded-bl-sm ' +
      'bg-surface-container-high text-on-surface-variant font-body-md text-body-md ' +
      'flex items-center gap-2"><span class="w-1.5 h-1.5 rounded-full bg-primary ' +
      'animate-pulse"></span>thinking&hellip;</div>';
    transcript.appendChild(wrap);
    transcript.scrollTop = transcript.scrollHeight;
    return wrap;
  }

  async function send(text) {
    text = (text || '').trim();
    if (!text || state.sending) return;
    state.sending = true;
    say(ctx.student.name, VH.fmt.esc(text), true);

    var pending = thinking();
    try {
      /* Whatever they typed goes to the model exactly as typed. Nothing here
       * looks at the content to decide what to do with it. */
      var answer = await VH.api.wellbeingChat(ctx.student.student_id, {
        message: text,
        history: state.history.slice(-12)
      });
      if (pending) pending.remove();
      /* The model writes prose, not markup - escape it, then honour blank
       * lines as paragraph breaks. */
      say('Dr. Sync', VH.fmt.esc(answer.reply).replace(/\n\n+/g, '<br><br>')
                                              .replace(/\n/g, '<br>'), false);
      state.history.push({ role: 'user', content: text });
      state.history.push({ role: 'assistant', content: answer.reply });
      if (answer.model && answer.model !== state.model) {
        state.model = answer.model;
        paintMode();
      }
    } catch (err) {
      if (pending) pending.remove();
      /* A failed call is reported as a failure. Nothing canned stands in for
       * the model, because a fake answer here would be worse than none. */
      var detail = (err && err.status === 503)
        ? 'No model is configured on the server, so I cannot answer. Add ANTHROPIC_API_KEY ' +
          'to .env and restart.'
        : 'I am having trouble responding right now. Please try again.';
      say('Dr. Sync', '<span class="text-error">' + VH.fmt.esc(detail) + '</span>', false);
      if (window.console && console.error) console.error('[wellbeing chat]', err);
    } finally {
      state.sending = false;
    }
  }

  /* A rest block is something this app can actually do: write it to the
   * calendar, where it counts against available study hours like anything
   * else that takes up the day. */
  async function bookRest() {
    var start = new Date();
    start.setMinutes(start.getMinutes() + 5, 0, 0);
    await VH.api.createEvent(ctx.student.student_id, {
      event_name: 'Rest',
      event_type: 'personal',
      start_time: VH.fmt.stamp(start),
      end_time: VH.fmt.stamp(new Date(start.getTime() + 15 * 60000)),
      is_fixed: false,
      location: 'Away from the desk'
    });
    VH.toast('15 minutes blocked from ' + VH.fmt.clock(VH.fmt.stamp(start)) + '.');
  }

  function wire() {
    /* The protocol tabs and their panels. */
    var keys = ['burnout', 'anxiety', 'imposter', 'depression'];
    keys.forEach(function (key) {
      var tab = $('tab-' + key);
      if (!tab) return;
      tab.addEventListener('click', function () {
        keys.forEach(function (other) {
          var otherTab = $('tab-' + other);
          var panel = $('content-' + other);
          if (otherTab) {
            otherTab.classList.remove('bg-surface-container-high', 'text-primary', 'active-protocol');
            otherTab.classList.add('text-on-surface-variant');
          }
          if (panel) { panel.classList.add('hidden'); panel.classList.remove('flex'); }
        });
        tab.classList.remove('text-on-surface-variant');
        tab.classList.add('bg-surface-container-high', 'text-primary', 'active-protocol');
        var panel = $('content-' + key);
        if (panel) { panel.classList.remove('hidden'); panel.classList.add('flex'); }
      });
    });

    Array.prototype.forEach.call(document.querySelectorAll('.protocol-content input[type="checkbox"]'),
      function (box) {
        box.addEventListener('change', function () {
          if (box.checked) VH.toast('Step done.');
        });
      });

    var form = document.querySelector('#chatInput') &&
      document.querySelector('#chatInput').closest('form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = $('chatInput');
        var text = input.value;
        input.value = '';
        send(text).catch(function (err) { VH.fail(err, 'Chat'); });
      });
    }

    /* The suggestion pills and the two protocol buttons that used to call
     * promptTherapist() inline. */
    Array.prototype.forEach.call(document.querySelectorAll('button'), function (btn) {
      var label = btn.textContent.trim();
      if (/Stop exam spiral/i.test(label)) {
        btn.addEventListener('click', function () { send('I keep spiralling about failing.'); });
      } else if (/racing thoughts/i.test(label)) {
        btn.addEventListener('click', function () { send('Exhausted but I cannot sleep.'); });
      } else if (/Extension request/i.test(label)) {
        btn.addEventListener('click', function () { send('I need to ask for an extension.'); });
      } else if (/Draft Advisor Script/i.test(label)) {
        btn.addEventListener('click', function () {
          send('I want to email my lecturer about struggling, without sounding incompetent.');
        });
      } else if (/Gentle Guidance Talk/i.test(label)) {
        btn.addEventListener('click', function () { send('I feel stuck and isolated.'); });
      } else if (/5-Min Reset|Open Guided Sigh Machine|Begin Session/i.test(label)) {
        btn.addEventListener('click', function (e) { e.preventDefault(); VH.shell.openBreathing(); });
      } else if (/Self-help prompts/i.test(label)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var panel = $('therapistPanel');
          if (panel) panel.scrollIntoView({ behavior: 'smooth' });
        });
      } else if (/Find real support|In a crisis/i.test(label)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          var support = document.querySelector('.text-error .material-symbols-outlined');
          var card = support ? support.closest('.rounded-xl') : null;
          if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      } else if (/Read clinical brief/i.test(label)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          VH.toast('These are summaries, not linked articles in this build.', 'info');
        });
      } else if (/Set a 15-minute rest block/i.test(label)) {
        btn.addEventListener('click', function (e) {
          e.preventDefault();
          bookRest().catch(function (err) { VH.fail(err, 'Rest block'); });
        });
      }
    });

  }

  function paintMode() {
    var label = document.querySelector('[data-vh-chat-mode]');
    if (label) {
      label.textContent = state.model
        ? 'Answers from ' + state.model
        : 'No model configured';
    }
  }

  async function reload() {
    var id = ctx.student.student_id;
    var results = await Promise.all([
      VH.api.mood(id, { limit: 14 }),
      VH.api.sleep(id, { limit: 14 }),
      VH.api.tasks(id, { open_only: true }),
      VH.api.insights(id, 14)
    ]);
    state.mood = results[0];
    state.sleep = results[1];
    state.tasks = results[2];
    ctx.insights = results[3];
    VH.shell.insights = results[3];
    renderTiles();
  }

  async function boot() {
    ctx = await VH.shell.boot('therapist');
    if (!ctx) return;
    wire();
    await reload();

    var subtitle = document.querySelector('#therapistPanel p');
    if (subtitle) subtitle.setAttribute('data-vh-chat-mode', '');
    try {
      var status = await VH.api.wellbeingStatus();
      state.model = status.model_available ? status.model : null;
    } catch (err) {
      state.model = null;
    }
    paintMode();

    say(state.model ? 'Dr. Sync' : 'Prompt', opener(), false);
  }

  boot().catch(function (err) { VH.fail(err, 'Wellbeing'); });
})(window.VH);
