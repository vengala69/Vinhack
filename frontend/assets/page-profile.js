/* Profile.
 *
 * The student's own record, the targets the app scores them against, and a
 * count of everything they have logged.
 *
 * The targets are the reason this page exists. Eight hours a night was
 * hard-coded in six places and in the sleep score; here it becomes a number
 * the student sets, and every screen reads it back.
 */
(function (VH) {
  'use strict';

  var ctx = null;
  var state = { profile: null, dirty: false };

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }
  function html(id, markup) { var el = $(id); if (el) el.innerHTML = markup; }

  /* ------------------------------------------------------------------
   * The form
   * ---------------------------------------------------------------- */

  var FIELDS = ['name', 'email', 'semester', 'programme', 'registration_no',
                'sleep_goal_minutes', 'daily_study_goal_hours'];

  function fill() {
    var form = $('profile-form');
    var student = state.profile.student;
    if (!form) return;
    FIELDS.forEach(function (key) {
      var input = form.elements[key];
      if (!input) return;
      var value = student[key];
      input.value = (value === null || value === undefined) ? '' : value;
    });
    paintGoals();
    markClean();

    set('profile-sub', [student.email,
                        student.programme,
                        student.semester ? 'semester ' + student.semester : null,
                        student.registration_no]
      .filter(Boolean).join(' · '));
    set('profile-eyebrow', 'Student #' + student.student_id);
    document.title = 'StudySync — ' + student.name;
  }

  function paintGoals() {
    var form = $('profile-form');
    if (!form) return;
    var sleep = Number(form.elements.sleep_goal_minutes.value || 480);
    var study = Number(form.elements.daily_study_goal_hours.value || 0);
    set('sleep-goal-value', VH.fmt.hm(sleep) + ' a night');
    set('study-goal-value', study ? VH.fmt.hours(study) + ' a day' : 'no target');
  }

  function markDirty() {
    state.dirty = true;
    set('profile-status', 'Unsaved changes');
    var save = $('profile-save');
    if (save) save.classList.add('animate-pulse');
  }

  function markClean() {
    state.dirty = false;
    set('profile-status', 'Saved to the database');
    var save = $('profile-save');
    if (save) save.classList.remove('animate-pulse');
  }

  async function save(form) {
    var data = new FormData(form);
    var body = {
      name: (data.get('name') || '').trim(),
      email: (data.get('email') || '').trim(),
      programme: (data.get('programme') || '').trim() || null,
      registration_no: (data.get('registration_no') || '').trim() || null,
      sleep_goal_minutes: Number(data.get('sleep_goal_minutes')),
      daily_study_goal_hours: Number(data.get('daily_study_goal_hours'))
    };
    var semester = (data.get('semester') || '').trim();
    body.semester = semester ? Number(semester) : null;

    if (body.semester !== null && (body.semester < 1 || body.semester > 12)) {
      VH.toast('Semester has to be between 1 and 12.', 'error');
      return;
    }

    var updated = await VH.api.updateStudent(ctx.student.student_id, body);
    state.profile.student = updated;
    ctx.student = updated;
    VH.shell.student = updated;

    /* The shell painted the old name into the sidebar on the way in. */
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="name"]'), function (el) {
      el.textContent = updated.name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="avatar"]'), function (el) {
      el.textContent = VH.fmt.initials(updated.name);
    });
    fill();
    VH.toast('Profile saved. Every screen now scores against ' +
      VH.fmt.hm(updated.sleep_goal_minutes) + ' a night.');
  }

  /* ------------------------------------------------------------------
   * What is on record
   * ---------------------------------------------------------------- */

  var COUNTS = [
    { key: 'nights', label: 'Nights of sleep', icon: 'bedtime', tone: 'secondary' },
    { key: 'sessions', label: 'Focus sessions', icon: 'timer', tone: 'primary' },
    { key: 'tasks', label: 'Tasks', icon: 'task_alt', tone: 'primary' },
    { key: 'assessments', label: 'Scores', icon: 'grade', tone: 'tertiary' },
    { key: 'check_ins', label: 'Mood check-ins', icon: 'mood', tone: 'tertiary' },
    { key: 'events', label: 'Calendar events', icon: 'event', tone: 'secondary' }
  ];

  function renderCounts() {
    var counts = state.profile.counts || {};
    html('profile-counts', COUNTS.map(function (row) {
      var value = counts[row.key] || 0;
      return '<div class="flex flex-col gap-0.5 p-space-sm rounded-xl bg-surface-container">' +
        '<div class="flex items-center gap-1 text-' + row.tone + '">' +
        '<span class="material-symbols-outlined text-[15px]">' + row.icon + '</span>' +
        '<span class="font-headline-sm text-headline-sm text-on-surface">' + value + '</span>' +
        '</div>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
        row.label + '</span></div>';
    }).join(''));

    var totals = state.profile.totals || {};
    var student = state.profile.student;
    var bits = [];
    if (totals.study_hours) bits.push(VH.fmt.hours(totals.study_hours) + ' of focus logged');
    if (state.profile.open_tasks) bits.push(state.profile.open_tasks + ' tasks still open');
    set('profile-since', 'Profile created ' + VH.fmt.longDate(student.created_at) +
      (bits.length ? ' · ' + bits.join(' · ') : '') + '.');

    var total = Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0);
    set('clear-blurb', total
      ? 'This removes all ' + total + ' rows you have logged — sleep, sessions, tasks, ' +
        'events, check-ins, screen time and scores — and leaves the profile itself in place.'
      : 'There is nothing logged yet, so there is nothing to clear.');
    var button = $('clear-data');
    if (button) button.disabled = !total;
    if (button && !total) button.classList.add('opacity-40', 'cursor-not-allowed');
  }

  async function clearData() {
    var counts = state.profile.counts || {};
    var total = Object.keys(counts).reduce(function (sum, k) { return sum + counts[k]; }, 0);
    if (!total) return;
    /* Typing the name is deliberate friction: this cannot be undone, and a
     * single OK is too easy to hit by reflex. */
    var typed = window.prompt(
      'This deletes all ' + total + ' logged rows and cannot be undone.\n\n' +
      'Type the profile name to confirm: ' + ctx.student.name);
    if (typed === null) return;
    if (typed.trim() !== ctx.student.name) {
      VH.toast('That did not match — nothing was deleted.', 'info');
      return;
    }
    await VH.api.clearStudentData(ctx.student.student_id);
    VH.toast('Logged data cleared.');
    await reload();
  }

  /* ------------------------------------------------------------------
   * Loading
   * ---------------------------------------------------------------- */

  async function reload() {
    state.profile = await VH.api.profile(ctx.student.student_id);
    fill();
    renderCounts();
  }

  function wire() {
    var form = $('profile-form');
    if (!form) return;

    form.addEventListener('input', function (e) {
      if (e.target.type === 'range') paintGoals();
      markDirty();
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      save(form).catch(function (err) { VH.fail(err, 'Save profile'); });
    });

    var reset = $('profile-reset');
    if (reset) {
      reset.addEventListener('click', function () {
        fill();
        VH.toast('Reverted to what is saved.', 'info');
      });
    }

    var clear = $('clear-data');
    if (clear) {
      clear.addEventListener('click', function () {
        clearData().catch(function (err) { VH.fail(err, 'Clear data'); });
      });
    }

    /* Leaving with unsaved edits is almost always an accident. */
    window.addEventListener('beforeunload', function (e) {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = '';
    });
  }

  async function boot() {
    ctx = await VH.shell.boot('profile');
    if (!ctx) return;
    wire();
    await reload();
  }

  boot().catch(function (err) { VH.fail(err, 'Profile'); });
})(window.VH);
