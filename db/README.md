# VinHack database

SQLite schema for the student wellness & productivity tracker.

```
db/
├── setup.py        builds the database (this is the entry point)
├── schema.sql      the 8 tables, constraints, indexes, triggers, views
├── rollup.sql      recomputes daily_metrics from the raw tables
├── seed_dev.sql    3 students × 14 days of generated history
└── vinhack.db      the database itself (gitignored)
```

## Getting started

Nothing to install — Python ships with SQLite built in.

```
cd db
py setup.py --reset --seed
```

| Command | What it does |
|---|---|
| `py setup.py` | Create the schema if it isn't there yet |
| `py setup.py --seed` | Schema + seed data + rollup |
| `py setup.py --reset` | Delete the database file first, then rebuild |
| `py setup.py --rollup` | Just recompute `daily_metrics` |

Set `$VINHACK_DB` to put the file somewhere other than `db/vinhack.db`.

## Connecting from app code

Import the helper rather than calling `sqlite3.connect` directly:

```python
from db.setup import connect

conn = connect()
rows = conn.execute("SELECT * FROM v_open_tasks WHERE student_id = ?", (1,)).fetchall()
```

**Foreign keys are off by default in SQLite and the setting is per-connection.**
`connect()` turns them on (along with WAL mode and `Row` results). A connection
that skips this will silently ignore every cascade in the schema.

## The tables

| Table | Grain | Notes |
|---|---|---|
| `students` | one row per student | `email` is unique |
| `sleep_logs` | student × night | `duration_minutes` auto-derived from bedtime/wake_time |
| `screen_time` | student × day | `total_screen_minutes` is a generated column — never insert it |
| `academic_tasks` | one row per task | `completed_at` follows `status` automatically |
| `calendar_events` | one row per event | `is_fixed` (0/1) marks immovable commitments |
| `mood_energy` | student × day | both scores 1–10 |
| `study_sessions` | one row per session | optional `task_id`; duration auto-derived |
| `daily_metrics` | student × day | **derived** — rebuilt by `rollup.sql`, never written by hand |

Everything cascades from `students`: deleting a student removes all their data.
Deleting a task leaves its study sessions in place with `task_id` set to NULL,
so logged effort is never lost.

### Conventions

- Timestamps are ISO-8601 text, `'YYYY-MM-DD HH:MM:SS'`; dates are `'YYYY-MM-DD'`.
  SQLite has no date type, but this format sorts correctly and works with
  `date()`, `datetime()`, `julianday()` and `strftime()`.
- Enums are `TEXT` with a `CHECK` constraint listing the allowed values.
- Booleans are `INTEGER` 0/1.

## Derived data

`daily_metrics` is a denormalized rollup for the dashboard and any modelling
work. It is rebuilt, not incrementally updated:

```
py setup.py --rollup
```

It is idempotent — re-running overwrites rows rather than duplicating them. It
covers every student × day that appears anywhere in the raw tables, and it
reconstructs the task backlog **as it stood on that day**, not as it stands now.

Two columns are computed with assumptions you may want to tune, both near the
bottom of `rollup.sql`:

- **`available_study_hours`** = 24h − sleep − fixed calendar events − 3h for
  meals, commute and downtime. An unlogged night assumes 8h.
- **`productivity_score`** (0–100) = the share of available study hours actually
  used, scaled by average focus rating. Unlogged focus assumes 3/5.

## Views

- `v_open_tasks` — outstanding tasks with `hours_until_due` and `is_overdue`
- `v_study_by_day` — study hours, average focus, session count per student per day
- `v_committed_by_day` — hours locked up by fixed calendar events

## Status

Verified on Python 3.12 / SQLite 3.45. `py setup.py --reset --seed` builds
clean and the derived logic was checked against the seed data: triggers fill
every duration, the generated column matches its inputs, `completed_at` is set
only for completed tasks, and no `daily_metrics` column comes out null.
