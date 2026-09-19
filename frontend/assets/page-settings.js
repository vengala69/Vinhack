/* Settings.
 *
 * Two different things live on this page. The student's record is a row in the
 * database and is PATCHed. Interface preferences have no column anywhere and
 * are per-device by nature, so they go in localStorage - and the page says as
 * much rather than implying they sync.
 *
 * The text-size and accent preferences are applied by writing CSS custom
 * properties on <html>, which prefs.js (loaded on every page) reads back.
 */
(function (VH) {
  'use strict';

  var PREFS_KEY = 'vinhack.prefs';

  var ctx = null;

  function $(id) { return document.getElementById(id); }
  function set(id, text) { var el = $(id); if (el) el.textContent = text; }

  /* ------------------------------------------------------------------
   * Preferences
   * ---------------------------------------------------------------- */

  var SCALES = [
    { label: 'Small (85%)', value: 0.85 },
    { label: 'Default (100%)', value: 1 },
    { label: 'Large (115%)', value: 1.15 },
    { label: 'Extra large (130%)', value: 1.3 }
  ];
  var DENSITY = { compact: 0.85, standard: 1, spacious: 1.2 };
  var ACCENTS = {
    emerald: { primary: '#4edea3', container: '#10b981', label: 'Emerald' },
    cyan: { primary: '#4fdbc8', container: '#04b4a2', label: 'Electric cyan' },
    sapphire: { primary: '#7fb0ff', container: '#3b6fd4', label: 'Royal sapphire' },
    violet: { primary: '#d0bcff', container: '#b090ff', label: 'Violet glow' }
  };

  function readPrefs() {
    return VH.prefs.read();
  }

  function writePrefs(prefs) {
    VH.prefs.write(prefs);
    VH.prefs.apply(prefs);
  }

  function paintPrefs() {
    var prefs = readPrefs();

    var slider = $('fontScaleSlider');
    if (slider) slider.value = prefs.scale;
    set('currentScaleLabel', SCALES[prefs.scale].label);

    Array.prototype.forEach.call(document.querySelectorAll('.scale-step-btn'),
      function (btn, index) {
        var active = index === prefs.scale;
        btn.className = 'scale-step-btn px-space-xs py-space-xs rounded text-left transition-all ' +
          (active ? 'bg-primary/15 text-primary' : 'bg-surface-container-low hover:bg-surface-container-high');
        if (btn.children[0]) {
          btn.children[0].className = 'font-label-sm text-label-sm ' +
            (active ? 'text-primary' : 'text-on-surface-variant');
        }
        if (btn.children[1]) {
          btn.children[1].className = 'font-label-md text-label-md font-semibold ' +
            (active ? 'text-primary' : 'text-on-surface');
        }
      });

    Array.prototype.forEach.call(document.querySelectorAll('.density-btn'), function (btn) {
      var active = btn.getAttribute('data-density') === prefs.density;
      btn.className = 'density-btn flex flex-col gap-space-xs p-space-sm rounded-lg text-left ' +
        'transition-all ' + (active ? 'bg-surface-container-high shadow-sm'
                                    : 'bg-surface-container hover:bg-surface-container-high');
      var spans = btn.querySelectorAll('span');
      if (spans[0]) {
        spans[0].className = 'font-title-md text-title-md ' +
          (active ? 'text-primary' : 'text-on-surface');
      }
      if (spans[1]) {
        spans[1].className = 'material-symbols-outlined text-[16px] ' +
          (active ? 'text-primary' : 'text-on-surface-variant');
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.theme-card'), function (card) {
      /* The design system this was built from is dark-only. Rather than ship a
       * half-inverted light mode nobody designed, the card says so and stops
       * being selectable. */
      if (card.getAttribute('data-theme') === 'light' && !VH.prefs.lightAvailable) {
        card.classList.add('opacity-40', 'cursor-not-allowed');
        card.setAttribute('disabled', 'disabled');
        var blurb = card.querySelector('p');
        if (blurb) {
          blurb.textContent = 'Not built: the StudySync palette is dark-only, so there is no ' +
            'light set of tokens to switch to.';
        }
        return;
      }
      var active = card.getAttribute('data-theme') === prefs.theme;
      card.className = 'theme-card relative flex flex-col gap-space-sm p-space-md rounded-xl ' +
        'text-left transition-all ' + (active ? 'bg-surface-container-high shadow-md'
                                              : 'bg-surface-container hover:bg-surface-container-high');
      var spans = card.querySelectorAll('span');
      if (spans[0]) {
        spans[0].className = 'font-title-md text-title-md ' +
          (active ? 'text-primary' : 'text-on-surface');
      }
      if (spans[1]) {
        spans[1].className = active ? 'w-3 h-3 rounded-full bg-primary ring-2 ring-primary/30'
                                    : 'w-3 h-3 rounded-full bg-surface-variant';
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll('.accent-btn'), function (btn) {
      var key = btn.getAttribute('data-accent');
      var active = key === prefs.accent;
      btn.className = 'accent-btn flex items-center gap-space-sm p-space-sm rounded-lg text-left ' +
        'transition-all ' + (active ? 'bg-surface-container-high'
                                    : 'bg-surface-container hover:bg-surface-container-high');
      var circle = btn.querySelector('span');
      if (circle) {
        circle.innerHTML = active
          ? '<span class="material-symbols-outlined text-[14px]">check</span>' : '';
      }
    });
    set('activePaletteLabel', (ACCENTS[prefs.accent] || ACCENTS.emerald).label +
      (prefs.accent === 'emerald' ? ' (default)' : ''));
  }

  function paintSound() {
    var btn = $('sound-toggle');
    var icon = $('sound-icon');
    if (!btn) return;
    var off = VH.audio.muted();
    btn.textContent = off ? 'Turn on' : 'Turn off';
    btn.className = 'px-space-md py-space-xs rounded-lg font-label-md text-label-md ' +
      'font-semibold transition-colors flex-shrink-0 ' +
      (off ? 'bg-primary text-on-primary' : 'bg-surface-container-high text-on-surface');
    if (icon) {
      icon.textContent = off ? 'volume_off' : 'volume_up';
      icon.className = 'material-symbols-outlined text-[20px] flex-shrink-0 ' +
        (off ? 'text-on-surface-variant' : 'text-primary');
    }
  }

  function wireSound() {
    var btn = $('sound-toggle');
    if (!btn) return;
    paintSound();
    btn.addEventListener('click', function () {
      var nowMuted = VH.audio.setMuted(!VH.audio.muted());
      paintSound();
      if (!nowMuted) VH.audio.cue('start');   /* prove it is back on */
      VH.toast(nowMuted ? 'Sound off.' : 'Sound on.', 'info');
    });
  }

  function wirePrefs() {
    var slider = $('fontScaleSlider');
    if (slider) {
      slider.addEventListener('input', function () {
        var prefs = readPrefs();
        prefs.scale = Number(slider.value);
        writePrefs(prefs);
        paintPrefs();
      });
    }
    var down = $('fontScaleDown');
    var up = $('fontScaleUp');
    if (down) {
      down.addEventListener('click', function () {
        var prefs = readPrefs();
        prefs.scale = Math.max(0, prefs.scale - 1);
        writePrefs(prefs);
        paintPrefs();
      });
    }
    if (up) {
      up.addEventListener('click', function () {
        var prefs = readPrefs();
        prefs.scale = Math.min(SCALES.length - 1, prefs.scale + 1);
        writePrefs(prefs);
        paintPrefs();
      });
    }

    document.addEventListener('click', function (e) {
      var step = e.target.closest('.scale-step-btn');
      if (step) {
        var prefs = readPrefs();
        prefs.scale = Number(step.getAttribute('data-scale'));
        writePrefs(prefs);
        paintPrefs();
        return;
      }
      var density = e.target.closest('.density-btn');
      if (density) {
        var p2 = readPrefs();
        p2.density = density.getAttribute('data-density');
        writePrefs(p2);
        paintPrefs();
        return;
      }
      var theme = e.target.closest('.theme-card');
      if (theme) {
        if (theme.hasAttribute('disabled')) return;
        var p3 = readPrefs();
        p3.theme = theme.getAttribute('data-theme');
        writePrefs(p3);
        paintPrefs();
        return;
      }
      var accent = e.target.closest('.accent-btn');
      if (accent) {
        var p4 = readPrefs();
        p4.accent = accent.getAttribute('data-accent');
        writePrefs(p4);
        paintPrefs();
      }
    });

    var save = $('savePreferencesBtn');
    if (save) {
      save.addEventListener('click', function (e) {
        e.preventDefault();
        writePrefs(readPrefs());
        set('syncStatus', 'Preferences saved in this browser');
        VH.toast('Saved on this device.');
      });
    }

    var clear = $('clear-prefs');
    if (clear) {
      clear.addEventListener('click', function () {
        if (!window.confirm('Reset interface preferences and reopen as the first student?')) return;
        try {
          window.localStorage.removeItem(PREFS_KEY);
        } catch (err) { /* private mode */ }
        VH.session.clear();
        window.location.reload();
      });
    }
  }

  /* ------------------------------------------------------------------
   * The student record
   * ---------------------------------------------------------------- */

  function fillProfile() {
    var form = $('profile-form');
    if (!form) return;
    form.elements.name.value = ctx.student.name;
    form.elements.email.value = ctx.student.email;
    form.elements.semester.value = ctx.student.semester || '';
    set('profile-meta', 'Student #' + ctx.student.student_id + ' · added ' +
      VH.fmt.longDate(ctx.student.created_at));
    set('profile-status', 'Saved to the students table');
    set('set-revision', 'Student #' + ctx.student.student_id);
  }

  async function saveProfile(form) {
    var body = {
      name: form.elements.name.value.trim(),
      email: form.elements.email.value.trim()
    };
    var semester = form.elements.semester.value;
    body.semester = semester ? Number(semester) : null;
    if (body.semester !== null && (body.semester < 1 || body.semester > 12)) {
      VH.toast('Semester has to be between 1 and 12.', 'error');
      return;
    }
    var updated = await VH.api.updateStudent(ctx.student.student_id, body);
    ctx.student = updated;
    VH.shell.student = updated;
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="name"]'), function (el) {
      el.textContent = updated.name;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="email"]'), function (el) {
      el.textContent = updated.email;
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-vh="avatar"]'), function (el) {
      el.textContent = VH.fmt.initials(updated.name);
    });
    fillProfile();
    VH.toast('Record updated.');
  }

  async function health() {
    try {
      var info = await VH.api.health();
      set('set-db-path', info.database);
      set('syncStatus', info.students + ' student' + (info.students === 1 ? '' : 's') +
        ' in the database');
    } catch (err) {
      set('set-db-path', 'Unreachable — start the API with: py -m vinhack');
      var icon = $('set-db-icon');
      if (icon) {
        icon.textContent = 'error_outline';
        icon.className = 'material-symbols-outlined text-error text-[18px] flex-shrink-0';
      }
    }
  }

  async function boot() {
    ctx = await VH.shell.boot('settings');
    if (!ctx) return;
    paintPrefs();
    wirePrefs();
    wireSound();
    fillProfile();

    var form = $('profile-form');
    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        saveProfile(form).catch(function (err) { VH.fail(err, 'Save record'); });
      });
    }
    await health();
  }

  boot().catch(function (err) { VH.fail(err, 'Settings'); });
})(window.VH);
