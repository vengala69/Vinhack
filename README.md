# VinHack

Student wellness & productivity tracker. Tracks sleep, screen time, mood,
coursework, study sessions and grades, and rolls them into a daily productivity
score.

```
VinHack/
├── db/             SQLite schema, rollup, seed data
├── vinhack/        REST API (FastAPI), which also serves the frontend
├── frontend/       the nine StudySync screens
│   ├── assets/     shared API client, app shell, one module per page
│   └── design/     the original Stitch exports and the design system
└── requirements.txt
```

## Running it locally

```
py -m pip install -r requirements.txt
py db/setup.py --reset --seed
py -m uvicorn vinhack.main:app --reload --port 8010
```

Then open **http://127.0.0.1:8010** — the app. The API's own interactive
documentation is at **/docs**.

One process serves both the pages and the API, so they are same-origin and CORS
never comes into it. Port 8000 is occupied on some machines, which is why the
examples use 8010; any free port works.

There are no accounts and no sign-in: this runs on one machine for one person,
so the app opens straight on the first student in the database. Settings lists
everyone and switches between them, and `?student=2` on any page links directly
to one. `py db/setup.py --reset --seed` gives you three students with a
fortnight of history each.

## The screens

| Page | What it reads | What it writes |
|---|---|---|
| `index.html` — dashboard | `/dashboard`, `/insights`, sleep, screen time, tasks | tasks, screen time, focus sessions, calendar blocks, task deferrals |
| `schedule.html` | `/events`, `/tasks`, `/insights` | calendar events |
| `sleep.html` | sleep, mood, screen time, `/insights` | sleep logs, mood check-ins, wind-down blocks |
| `focus.html` | `/sessions`, `/tasks`, `/insights` | study sessions |
| `scores.html` | `/grades`, `/assessments` | assessments |
| `analytics.html` | `/insights`, `/grades` | — |
| `therapist.html` | mood, sleep, tasks, `/insights`, `/wellbeing/status` | — (the chat is not stored) |
| `settings.html` | `/students/{id}`, `/students`, `/health` | the student record; which student is being viewed (browser only) |

Two conventions worth knowing before editing a page:

- **Every page loads `assets/prefs.js`, `assets/api.js`, `assets/shell.js`, then
  its own `assets/page-*.js`.** `shell.boot(page)` handles the profile guard,
  the sidebar, the header chrome and the shared top-bar actions, and hands back
  `{ student, insights }`.
- **The pages started life as standalone Stitch mockups**, so each carries its
  own copy of the shell markup. The shell binds to it through `data-vh="…"`
  hooks rather than by class, and per-page values through `id`s.

### What was removed rather than wired up

A few things in the mockups had no data behind them and no way to get any. They
were cut or repointed rather than left looking real — a dashboard that invents
a heart rate is worse than one that admits it has not got one:

- **Heart-rate variability, resting pulse, deep/REM sleep split, room sound
  level.** Nothing in this stack reads a sensor. The cards now show bedtime
  consistency, reported mood and energy, and a recovery index blended from
  sleep and energy — all from `sleep_logs` and `mood_energy`.
- **"Sleep vs test score" and "late-night commits vs bug rate".** Neither
  relationship is visible to this database. Analytics plots sleep against the
  rollup's own productivity score, and focus rating against time of day, both of
  which it can actually measure.
- **Canvas / VTOP / Google Calendar / Apple HealthKit integrations.** None
  exist. Those panels now report the local SQLite file.
- **The clinician roster and the bookable appointments.** No table, no
  endpoint, and confirming an appointment nobody made is worse than saying so.
  That panel points at real support instead.
- **The flashcard deck.** No table, no endpoint, no way to add a card.
- **The "Official Rest Clearance" PDF**, which generated a medical document
  complete with an issuing health centre and a diagnosis. It is now a plain
  summary of self-reported figures, with no authority attached to it.
- **Notification toggles.** There is no scheduler and no push channel behind
  this build, so the switches would have done nothing. The reminders that do
  work write calendar events.

### The wellbeing chat

The chat on the Therapist screen talks to Claude, grounded in the student's own
figures &mdash; it is handed their sleep average, energy, streak and open
deadlines, so it answers about their week rather than in the abstract. The
prompt is explicit that it is a study-habits companion and not a counsellor,
and that anything touching self-harm gets a short reply pointing at real help
rather than a coaching conversation.

It is optional. Without a key the screen falls back to built-in scripted
replies and says so on the page; nothing else changes.

```
py -m pip install anthropic
set ANTHROPIC_API_KEY=sk-ant-...     # PowerShell: $env:ANTHROPIC_API_KEY="sk-ant-..."
py -m uvicorn vinhack.main:app --reload --port 8010
```

`GET /api/wellbeing/status` reports which mode it is in. Conversations are not
stored: the page holds the transcript and sends it back with each message, and
it is gone when the tab closes.

### Sound

The soundscapes on Focus Mode and the Therapist screen are synthesised in the
browser with the Web Audio API &mdash; binaural beats from paired oscillators,
rain and room tone from filtered noise. Nothing is downloaded and nothing is
licensed. The binaural tracks only work on headphones, which the player says.

## API

`GET /api/students/{id}/dashboard` returns everything a dashboard screen needs
in one round trip. `GET /api/students/{id}/insights` returns the derived scores
and groupings the analytics screens are built on.

```js
const API = "/api";
const dashboard = await fetch(`${API}/students/1/dashboard?days=14`).then(r => r.json());

await fetch(`${API}/students/1/sleep`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    sleep_date: "2026-09-18",
    bedtime:   "2026-09-17 23:30:00",
    wake_time: "2026-09-18 07:15:00",
    quality: 4,
  }),
});
```

### Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Liveness, and proof the database is readable |
| GET POST | `/api/students` | List, create |
| GET PATCH DELETE | `/api/students/{id}` | Fetch, partial update, delete (cascades) |
| GET POST | `/api/students/{id}/sleep` | Sleep logs |
| GET POST | `/api/students/{id}/screen-time` | Screen time |
| GET POST | `/api/students/{id}/mood` | Mood & energy |
| GET POST | `/api/students/{id}/tasks` | Coursework (`?open_only=true`, `?status=`) |
| GET PATCH DELETE | `/api/tasks/{id}` | One task |
| GET POST | `/api/students/{id}/events` | Calendar |
| PATCH DELETE | `/api/events/{id}` | One event |
| GET POST | `/api/students/{id}/sessions` | Study sessions |
| PATCH DELETE | `/api/sessions/{id}` | One session |
| GET POST | `/api/students/{id}/assessments` | Graded work (`?subject=`) |
| PATCH DELETE | `/api/assessments/{id}` | One assessment |
| GET | `/api/students/{id}/grades` | Standing per subject and per category |
| GET | `/api/students/{id}/metrics` | The `daily_metrics` rollup, ready to plot |
| GET | `/api/students/{id}/dashboard` | Everything a dashboard needs, one call |
| GET | `/api/students/{id}/insights` | Derived scores, streak, correlations |
| GET | `/api/wellbeing/status` | Whether the chat has a model behind it |
| POST | `/api/students/{id}/wellbeing/chat` | One grounded reply; 503 with no key |
| POST | `/api/rollup` | Recompute `daily_metrics` |

List endpoints accept `?from=` and `?to=` dates and a `?limit=`.

### Conventions the frontend must follow

- **Times are local wall-clock, not UTC.** The database stores
  `"YYYY-MM-DD HH:MM:SS"` with no zone, so a 09:00 lecture is 09:00 to the
  person who has to be there. Send local values — `assets/api.js` has
  `VH.fmt.stamp()` for exactly this — and never `Date.toISOString()`, which
  emits UTC and will land the entry hours away from what was typed. Offset-aware
  input is accepted and converted to local. Date-only fields take a full
  timestamp and keep the date part.
- **Sleep and study durations are derived.** Post `bedtime`/`wake_time` (or
  `start_time`/`end_time`) and leave `duration_minutes` out; the database fills
  it in. A study session posted without `end_time` is a running timer — PATCH
  the `end_time` when it stops.
- **`total_screen_minutes` is a generated column.** Post the five categories;
  it is computed and rejected if sent.
- **`completed_at` is automatic.** PATCH a task's `status` to `"completed"` and
  it stamps itself; move the status back and it clears.
- **Sleep, screen time and mood upsert.** Re-posting a day replaces it, since
  re-submitting is a correction rather than an error.
- **`daily_metrics` refreshes itself.** Any write that feeds the rollup triggers
  it before responding, so the dashboard is never a step behind. `POST
  /api/rollup` is still there for bulk imports.

### Status codes

`422` failed validation before reaching the database, `409` a database
constraint rejected it (duplicate email, a day that already exists, an event
ending before it starts), `404` no such row.

## Database

See [`db/README.md`](db/README.md) for the schema, the nine tables, and the two
tunable formulas behind `available_study_hours` and `productivity_score`.
[`docs/VinHack-schema.pdf`](docs/VinHack-schema.pdf) is a generated reference;
re-run `py docs/gen_schema_pdf.py docs/schema.html` after any schema change.
