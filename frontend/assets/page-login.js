/* Login.
 *
 * There is nothing to authenticate against: the API identifies a student by id
 * and has no accounts, passwords or sessions. So this screen picks which
 * student's data to open, matching on email, and remembers the choice. The
 * passcode field is kept because it is part of the design, but it is not
 * checked and the page says so rather than pretending.
 */
(function (VH) {
  'use strict';

  var form = document.getElementById('loginForm');
  var emailInput = document.getElementById('loginEmailInput');
  var submitBtn = document.getElementById('submitBtn');
  var btnLabel = document.getElementById('btnLabel');
  var btnArrow = document.getElementById('btnArrow');
  var btnSpinner = document.getElementById('btnSpinner');
  var toast = document.getElementById('loginToast');
  var toastMessage = document.getElementById('toastMessage');

  var students = [];

  /* The eye icon next to the passcode calls this from an inline onclick. */
  window.togglePasswordVisibility = function () {
    var input = document.getElementById('passwordInput');
    var icon = document.getElementById('eyeIcon');
    if (!input) return;
    var hidden = input.type === 'password';
    input.type = hidden ? 'text' : 'password';
    if (icon) icon.textContent = hidden ? 'visibility_off' : 'visibility';
  };

  function banner(message, kind) {
    if (!toast || !toastMessage) return;
    toastMessage.textContent = message;
    toast.classList.remove('hidden');
    toast.classList.toggle('text-error', kind === 'error');
  }

  function busy(on, label) {
    if (btnLabel) btnLabel.textContent = label;
    if (btnArrow) btnArrow.classList.toggle('hidden', on);
    if (btnSpinner) btnSpinner.classList.toggle('hidden', !on);
    if (submitBtn) submitBtn.disabled = on;
  }

  function enter(student) {
    VH.session.set(student.student_id);
    busy(true, 'Opening ' + student.name.split(' ')[0] + '’s data…');
    banner('Signed in as ' + student.name + ' (student #' + student.student_id + ')');
    setTimeout(function () { window.location.href = 'index.html'; }, 350);
  }

  function renderProfiles() {
    var host = document.getElementById('vh-profiles');
    var count = document.getElementById('vh-profile-count');
    var emails = document.getElementById('vh-student-emails');
    if (!host) return;

    if (count) {
      count.textContent = students.length + (students.length === 1 ? ' profile' : ' profiles');
    }
    if (emails) {
      emails.innerHTML = students.map(function (s) {
        return '<option value="' + VH.fmt.esc(s.email) + '">';
      }).join('');
    }
    if (!students.length) {
      host.innerHTML = '<div class="px-3 py-2.5 rounded-xl bg-surface-container/60 ' +
        'font-label-sm text-label-sm text-on-surface-variant">No students in the database yet. ' +
        'Seed it with <code class="text-primary">py db/setup.py --reset --seed</code>.</div>';
      return;
    }
    host.innerHTML = students.map(function (s) {
      return '<button type="button" data-student="' + s.student_id + '" ' +
        'class="w-full px-3 py-2.5 rounded-xl bg-surface-container/60 hover:bg-surface-container-high ' +
        'transition-colors flex items-center justify-between gap-3 text-left group">' +
        '<span class="flex items-center gap-2.5">' +
        '<span class="w-8 h-8 rounded-full bg-primary-container/20 flex items-center justify-center ' +
        'text-primary font-label-md text-label-md font-bold">' + VH.fmt.esc(VH.fmt.initials(s.name)) + '</span>' +
        '<span class="flex flex-col">' +
        '<span class="font-label-md text-label-md font-medium text-on-surface">' + VH.fmt.esc(s.name) + '</span>' +
        '<span class="font-label-sm text-label-sm text-on-surface-variant">' +
        VH.fmt.esc(s.email) + (s.semester ? ' · semester ' + s.semester : '') + '</span>' +
        '</span></span>' +
        '<span class="material-symbols-outlined text-on-surface-variant group-hover:text-primary">' +
        'arrow_forward</span></button>';
    }).join('');

  }

  async function checkHealth() {
    var dot = document.getElementById('vh-api-dot');
    var state = document.getElementById('vh-api-state');
    var latencyEl = document.getElementById('vh-api-latency');
    var studentsEl = document.getElementById('vh-api-students');
    var title = document.getElementById('vh-db-title');
    var pathEl = document.getElementById('vh-db-path');
    var dbLatency = document.getElementById('vh-db-latency');
    var icon = document.getElementById('vh-db-icon');

    var started = performance.now();
    try {
      var health = await VH.api.health();
      var ms = Math.round(performance.now() - started);
      if (state) { state.textContent = 'online'; state.className = 'text-primary font-medium'; }
      if (latencyEl) latencyEl.textContent = ms + 'ms';
      if (studentsEl) studentsEl.textContent = health.students;
      if (title) {
        title.textContent = health.students +
          (health.students === 1 ? ' student' : ' students') + ' in the local database';
      }
      if (pathEl) pathEl.textContent = health.database;
      if (dbLatency) dbLatency.textContent = ms + 'ms';
      if (icon) icon.textContent = 'database';
    } catch (err) {
      if (dot) dot.className = 'h-2 w-2 rounded-full bg-error';
      if (state) { state.textContent = 'unreachable'; state.className = 'text-error font-medium'; }
      if (title) title.textContent = 'Cannot reach the API';
      if (pathEl) pathEl.textContent = 'Start it with:  py -m vinhack';
      if (icon) { icon.textContent = 'error_outline'; icon.className = 'material-symbols-outlined text-error text-lg'; }
      if (dbLatency) dbLatency.textContent = '';
      throw err;
    }
  }

  function handleSubmit(event) {
    event.preventDefault();
    var typed = (emailInput ? emailInput.value : '').trim().toLowerCase();
    if (!typed) return;
    var match = students.filter(function (s) {
      return s.email.toLowerCase() === typed;
    })[0];
    if (!match) {
      banner('No student in this database uses ' + typed + '. Pick one of the profiles below.',
             'error');
      busy(false, 'Launch StudySync Portal');
      if (emailInput) emailInput.focus();
      return;
    }
    enter(match);
  }

  async function boot() {
    await VH.shell.boot('login');
    busy(false, 'Launch StudySync Portal');

    var host = document.getElementById('vh-profiles');
    if (host) {
      host.addEventListener('click', function (e) {
        var btn = e.target.closest('[data-student]');
        if (!btn) return;
        var id = Number(btn.getAttribute('data-student'));
        var picked = students.filter(function (s) { return s.student_id === id; })[0];
        if (picked) {
          if (emailInput) emailInput.value = picked.email;
          enter(picked);
        }
      });
    }
    if (form) form.addEventListener('submit', handleSubmit);

    var existing = VH.session.id();

    try {
      await checkHealth();
      students = await VH.api.students();
    } catch (err) {
      renderProfiles();
      VH.shell.offline();
      return;
    }
    renderProfiles();

    /* Landing here while already signed in means the student came to switch
     * profiles, so preselect who they are rather than bouncing them back. */
    var current = students.filter(function (s) { return s.student_id === existing; })[0];
    if (emailInput && !emailInput.value) {
      emailInput.value = (current || students[0] || {}).email || '';
    }
    if (current) banner('Currently signed in as ' + current.name + '. Pick another to switch.');
  }

  boot().catch(function (err) { VH.fail(err, 'Login'); });
})(window.VH);
