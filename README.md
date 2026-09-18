# VinHack

Student wellness & productivity tracker. Tracks sleep, screen time, mood,
coursework and study sessions, and rolls them into a daily productivity score.

```
VinHack/
├── db/             SQLite schema, rollup, seed data
├── vinhack/        REST API (FastAPI)
└── requirements.txt
```

## Running it locally

```
py -m pip install -r requirements.txt
py db/setup.py --reset --seed
py -m uvicorn vinhack.main:app --reload --port 8010
```

Then open **http://127.0.0.1:8010/docs** — interactive API documentation where
every endpoint can be tried in the browser, no frontend needed.

Port 8000 is occupied on some machines, which is why the examples use 8010.
Any free port works.

## Connecting a frontend

CORS is open to all origins, so a dev server on any port can call the API
directly:

```js
const API = "http://127.0.0.1:8010/api";

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

`GET /api/students/{id}/dashboard` returns everything a dashboard screen needs
in one round trip: the student, today's metrics, a trend series to plot, open
tasks, upcoming events, and period averages.

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
| GET | `/api/students/{id}/metrics` | The `daily_metrics` rollup, ready to plot |
| GET | `/api/students/{id}/dashboard` | Everything above, one call |
| POST | `/api/rollup` | Recompute `daily_metrics` |

List endpoints accept `?from=` and `?to=` dates and a `?limit=`.

### Conventions the frontend must follow

- **Timestamps are normalised for you.** Send whatever your date library
  produces — `Date.toISOString()` output, a `T` separator, a `+05:30` offset —
  and the API converts it to the stored format (`"YYYY-MM-DD HH:MM:SS"`, UTC).
  Offset-aware values are converted to UTC, so send the offset rather than
  stripping it. Date-only fields accept a full timestamp and keep the date part.
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
- **`daily_metrics` lags.** Writes do not refresh it; call `POST /api/rollup`
  after a batch of changes, or before rendering metrics.

### Status codes

`422` failed validation before reaching the database, `409` a database
constraint rejected it (duplicate email, a day that already exists, an event
ending before it starts), `404` no such row.

## Database

See [`db/README.md`](db/README.md) for the schema, the eight tables, and the
two tunable formulas behind `available_study_hours` and `productivity_score`.
