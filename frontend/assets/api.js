/* VinHack API client and formatters.
 *
 * The pages are served by the same FastAPI process that serves /api, so every
 * call here is same-origin and CORS never enters into it.
 *
 * TIME. The database stores local wall-clock time with no zone attached (see
 * db/schema.sql). So nothing in this file may use toISOString(): that emits
 * UTC with a Z, which the API would faithfully convert back to local and land
 * hours away from what the student typed. Times are built and read through
 * VH.fmt.stamp / VH.fmt.parse, which only ever touch local date parts.
 */
window.VH = window.VH || {};

(function (VH) {
  'use strict';

  var BASE = '/api';

  function ApiError(status, detail, path) {
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.path = path;
    this.message = status ? status + ' ' + detail : detail;
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function request(method, path, body) {
    var opts = { method: method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    var res;
    try {
      res = await fetch(BASE + path, opts);
    } catch (err) {
      // The server is not running, or the browser blocked the request.
      throw new ApiError(0, 'Cannot reach the VinHack API. Is the server running?', path);
    }
    if (res.status === 204) return null;
    var payload = null;
    try {
      payload = await res.json();
    } catch (err) {
      payload = null;
    }
    if (!res.ok) {
      var detail = payload && payload.detail ? payload.detail : res.statusText;
      if (Array.isArray(detail)) {
        // FastAPI validation errors arrive as a list of field problems.
        detail = detail.map(function (d) {
          return (d.loc || []).slice(1).join('.') + ': ' + d.msg;
        }).join('; ');
      }
      throw new ApiError(res.status, String(detail), path);
    }
    return payload;
  }

  function qs(params) {
    var parts = [];
    Object.keys(params || {}).forEach(function (k) {
      var v = params[k];
      if (v !== undefined && v !== null && v !== '') {
        parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
      }
    });
    return parts.length ? '?' + parts.join('&') : '';
  }

  var S = function (id) { return '/students/' + encodeURIComponent(id); };

  VH.ApiError = ApiError;

  VH.api = {
    health: function () { return request('GET', '/health'); },

    students: function () { return request('GET', '/students'); },
    student: function (id) { return request('GET', S(id)); },
    createStudent: function (body) { return request('POST', '/students', body); },
    updateStudent: function (id, body) { return request('PATCH', S(id), body); },

    sleep: function (id, p) { return request('GET', S(id) + '/sleep' + qs(p)); },
    logSleep: function (id, body) { return request('POST', S(id) + '/sleep', body); },

    screenTime: function (id, p) { return request('GET', S(id) + '/screen-time' + qs(p)); },
    logScreenTime: function (id, body) { return request('POST', S(id) + '/screen-time', body); },

    mood: function (id, p) { return request('GET', S(id) + '/mood' + qs(p)); },
    logMood: function (id, body) { return request('POST', S(id) + '/mood', body); },

    tasks: function (id, p) { return request('GET', S(id) + '/tasks' + qs(p)); },
    createTask: function (id, body) { return request('POST', S(id) + '/tasks', body); },
    updateTask: function (taskId, body) { return request('PATCH', '/tasks/' + taskId, body); },
    deleteTask: function (taskId) { return request('DELETE', '/tasks/' + taskId); },

    events: function (id, p) { return request('GET', S(id) + '/events' + qs(p)); },
    createEvent: function (id, body) { return request('POST', S(id) + '/events', body); },
    updateEvent: function (eventId, body) { return request('PATCH', '/events/' + eventId, body); },
    deleteEvent: function (eventId) { return request('DELETE', '/events/' + eventId); },

    sessions: function (id, p) { return request('GET', S(id) + '/sessions' + qs(p)); },
    startSession: function (id, body) { return request('POST', S(id) + '/sessions', body); },
    updateSession: function (sid, body) { return request('PATCH', '/sessions/' + sid, body); },
    deleteSession: function (sid) { return request('DELETE', '/sessions/' + sid); },

    assessments: function (id, p) { return request('GET', S(id) + '/assessments' + qs(p)); },
    createAssessment: function (id, body) { return request('POST', S(id) + '/assessments', body); },
    deleteAssessment: function (aid) { return request('DELETE', '/assessments/' + aid); },
    grades: function (id) { return request('GET', S(id) + '/grades'); },

    metrics: function (id, p) { return request('GET', S(id) + '/metrics' + qs(p)); },
    dashboard: function (id, days) { return request('GET', S(id) + '/dashboard' + qs({ days: days })); },
    insights: function (id, days) { return request('GET', S(id) + '/insights' + qs({ days: days })); },
    rollup: function () { return request('POST', '/rollup'); }
  };

  /* ------------------------------------------------------------------
   * Formatting
   * ---------------------------------------------------------------- */

  function pad(n) { return String(n).padStart(2, '0'); }

  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  VH.fmt = {
    /* 'YYYY-MM-DD HH:MM:SS' from a Date, using its local parts only. */
    stamp: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
        ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    },

    /* 'YYYY-MM-DD' from a Date, local. */
    day: function (d) {
      d = d || new Date();
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
    },

    /* Read a stored timestamp back as local wall-clock.
     * Built by hand rather than via new Date(str): engines disagree on whether
     * a space-separated stamp is local or UTC, and a five-hour drift in a
     * timetable is not the kind of bug that announces itself. */
    parse: function (value) {
      if (!value) return null;
      if (value instanceof Date) return value;
      var m = String(value).match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/);
      if (!m) return null;
      return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
    },

    /* Minutes as '6h 12m'. */
    hm: function (minutes) {
      if (minutes === null || minutes === undefined || isNaN(minutes)) return '--';
      var sign = minutes < 0 ? '-' : '';
      var abs = Math.round(Math.abs(minutes));
      var h = Math.floor(abs / 60);
      var m = abs % 60;
      return sign + (h ? h + 'h ' + pad(m) + 'm' : m + 'm');
    },

    /* Hours as '6.1h'. */
    hours: function (h, places) {
      if (h === null || h === undefined || isNaN(h)) return '--';
      return Number(h).toFixed(places === undefined ? 1 : places) + 'h';
    },

    /* 'MM:SS' from a count of seconds, for the timers. */
    mmss: function (seconds) {
      seconds = Math.max(0, Math.round(seconds));
      return pad(Math.floor(seconds / 60)) + ':' + pad(seconds % 60);
    },

    /* '10:45 PM' */
    clock: function (value) {
      var d = VH.fmt.parse(value);
      if (!d) return '--';
      var h = d.getHours();
      var suffix = h >= 12 ? 'PM' : 'AM';
      var display = h % 12 === 0 ? 12 : h % 12;
      return display + ':' + pad(d.getMinutes()) + ' ' + suffix;
    },

    /* 'Thu' */
    weekday: function (value) {
      var d = VH.fmt.parse(value);
      return d ? DAYS[d.getDay()] : '--';
    },

    /* 'Sep 19' */
    date: function (value) {
      var d = VH.fmt.parse(value);
      return d ? MONTHS[d.getMonth()] + ' ' + d.getDate() : '--';
    },

    /* 'Thursday, Sep 19' */
    longDate: function (value) {
      var d = VH.fmt.parse(value);
      if (!d) return '--';
      var full = ['Sunday', 'Monday', 'Tuesday', 'Wednesday',
                  'Thursday', 'Friday', 'Saturday'][d.getDay()];
      return full + ', ' + MONTHS[d.getMonth()] + ' ' + d.getDate();
    },

    /* 'in 2d 14h', 'in 40m', 'overdue 3h' - how a deadline actually reads. */
    until: function (value, now) {
      var d = VH.fmt.parse(value);
      if (!d) return 'no due date';
      var ms = d - (now || new Date());
      var overdue = ms < 0;
      var mins = Math.round(Math.abs(ms) / 60000);
      var text;
      if (mins < 60) text = mins + 'm';
      else if (mins < 1440) text = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
      else text = Math.floor(mins / 1440) + 'd ' + Math.floor((mins % 1440) / 60) + 'h';
      return overdue ? 'overdue ' + text : 'in ' + text;
    },

    /* Whole percent, with a fallback for the rows the database has no data for. */
    pct: function (value, fallback) {
      if (value === null || value === undefined || isNaN(value)) {
        return fallback === undefined ? '--' : fallback;
      }
      return Math.round(value) + '%';
    },

    num: function (value, places, fallback) {
      if (value === null || value === undefined || isNaN(value)) {
        return fallback === undefined ? '--' : fallback;
      }
      return Number(value).toFixed(places === undefined ? 1 : places);
    },

    /* Title Case from a slug or an enum value: 'in_progress' -> 'In Progress'. */
    title: function (value) {
      if (!value) return '';
      return String(value).replace(/[_-]+/g, ' ').replace(/\b\w/g, function (c) {
        return c.toUpperCase();
      });
    },

    initials: function (name) {
      if (!name) return '??';
      var parts = String(name).trim().split(/\s+/);
      return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
    },

    /* Everything rendered through innerHTML goes through here first. */
    esc: function (value) {
      return String(value === null || value === undefined ? '' : value)
        .replace(/[&<>"']/g, function (c) {
          return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
  };

  /* Clamp to 0-100 for progress bars, tolerating nulls. */
  VH.clamp01 = function (value, fallback) {
    if (value === null || value === undefined || isNaN(value)) return fallback || 0;
    return Math.max(0, Math.min(100, Number(value)));
  };
})(window.VH);
