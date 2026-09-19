"""VinHack REST API.

Run it with:  py -m vinhack     (or: uvicorn vinhack.main:app --reload)

Interactive docs live at http://127.0.0.1:8000/docs - the fastest way to see
every endpoint and try it without writing a line of frontend code.
"""
import sqlite3
from datetime import date, timedelta
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from . import models as m
from . import wellbeing
from .db import (DB_PATH, ROOT, add_missing_columns, connect, get_conn, insert, one,
                 rows, run_script, schema_exists, update)

app = FastAPI(
    title="VinHack API",
    description="Student wellness & productivity tracker.",
    version="1.0.0",
)

# The frontend runs on its own dev-server port, so the browser treats calls to
# this API as cross-origin. Wide open is fine for local development; lock the
# origins down before this is ever exposed beyond localhost.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def ensure_schema() -> None:
    """Bring the database up to the current schema before serving a request.

    Every CREATE in schema.sql is IF NOT EXISTS, so running it unconditionally
    creates the file on first boot *and* adds anything a newer schema
    introduced to a database that already exists - no migration step to forget.
    """
    conn = connect()
    try:
        fresh = not schema_exists(conn)
        run_script(conn, "schema.sql")
        if fresh:
            print(f"created schema in {DB_PATH}")
        added = add_missing_columns(conn)
        if added:
            print("added columns: " + ", ".join(added))
    finally:
        conn.close()


# ---------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------

@app.exception_handler(sqlite3.IntegrityError)
def integrity_error(request, exc: sqlite3.IntegrityError):
    """Turn constraint violations into 409s instead of 500s.

    This is what a frontend sees when it posts a duplicate day for a student,
    references a missing student, or breaks one of the CHECK constraints.
    """
    from fastapi.responses import JSONResponse
    return JSONResponse(status_code=409, content={"detail": str(exc)})


def require_student(conn: sqlite3.Connection, student_id: int) -> None:
    if not conn.execute("SELECT 1 FROM students WHERE student_id = ?", (student_id,)).fetchone():
        raise HTTPException(404, f"student {student_id} not found")


def found(row: Optional[dict], what: str, ident: Any) -> dict:
    if row is None:
        raise HTTPException(404, f"{what} {ident} not found")
    return row


def refresh(conn: sqlite3.Connection, result: Any = None) -> Any:
    """Rebuild daily_metrics, then hand back whatever was just written.

    daily_metrics is derived, so every write to a raw table leaves it stale and
    the dashboard goes on showing yesterday's numbers. One student-year is a
    few hundred rows, so rebuilding inline is cheaper than explaining to the
    frontend when it needs to call /api/rollup itself.
    """
    run_script(conn, "rollup.sql")
    return result


# ---------------------------------------------------------------------
# Meta
# ---------------------------------------------------------------------

@app.get("/api/health", tags=["meta"])
def health(conn=Depends(get_conn)):
    """Liveness check that also proves the database is readable."""
    n = conn.execute("SELECT count(*) FROM students").fetchone()[0]
    return {"status": "ok", "database": str(DB_PATH), "students": n}


# ---------------------------------------------------------------------
# Students
# ---------------------------------------------------------------------

@app.get("/api/students", tags=["students"])
def list_students(conn=Depends(get_conn)):
    return rows(conn.execute("SELECT * FROM students ORDER BY name"))


@app.post("/api/students", status_code=201, tags=["students"])
def create_student(body: m.StudentIn, conn=Depends(get_conn)):
    return insert(conn, "students", body.model_dump(), "student_id")


@app.get("/api/students/{student_id}", tags=["students"])
def get_student(student_id: int, conn=Depends(get_conn)):
    return found(one(conn.execute(
        "SELECT * FROM students WHERE student_id = ?", (student_id,))), "student", student_id)


@app.patch("/api/students/{student_id}", tags=["students"])
def update_student(student_id: int, body: m.StudentUpdate, conn=Depends(get_conn)):
    require_student(conn, student_id)
    return update(conn, "students", body.model_dump(exclude_unset=True), "student_id", student_id)


@app.delete("/api/students/{student_id}", status_code=204, tags=["students"])
def delete_student(student_id: int, conn=Depends(get_conn)):
    """Deletes the student and, by cascade, every row they own."""
    require_student(conn, student_id)
    conn.execute("DELETE FROM students WHERE student_id = ?", (student_id,))
    conn.commit()


# ---------------------------------------------------------------------
# Daily logs: sleep, screen time, mood/energy
#
# All three are one-row-per-student-per-day, so POST upserts rather than
# failing on a duplicate - re-submitting a day is a correction, not an error.
# ---------------------------------------------------------------------

def _date_range(sql: str, conn, student_id: int, frm: Optional[str], to: Optional[str],
                col: str, limit: int):
    require_student(conn, student_id)
    clauses, params = [f"student_id = ?"], [student_id]
    if frm:
        clauses.append(f"{col} >= ?"); params.append(frm)
    if to:
        clauses.append(f"{col} <= ?"); params.append(to)
    params.append(limit)
    return rows(conn.execute(
        f"{sql} WHERE {' AND '.join(clauses)} ORDER BY {col} DESC LIMIT ?", params))


@app.get("/api/students/{student_id}/sleep", tags=["sleep"])
def list_sleep(student_id: int, frm: Optional[str] = Query(None, alias="from"),
               to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM sleep_logs", conn, student_id, frm, to, "sleep_date", limit)


@app.post("/api/students/{student_id}/sleep", status_code=201, tags=["sleep"])
def log_sleep(student_id: int, body: m.SleepLogIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    conn.execute("DELETE FROM sleep_logs WHERE student_id = ? AND sleep_date = ?",
                 (student_id, body.sleep_date))
    return refresh(conn, insert(
        conn, "sleep_logs", {"student_id": student_id, **body.model_dump()}, "sleep_id"))


@app.get("/api/students/{student_id}/screen-time", tags=["screen time"])
def list_screen_time(student_id: int, frm: Optional[str] = Query(None, alias="from"),
                     to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM screen_time", conn, student_id, frm, to, "date", limit)


@app.post("/api/students/{student_id}/screen-time", status_code=201, tags=["screen time"])
def log_screen_time(student_id: int, body: m.ScreenTimeIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    conn.execute("DELETE FROM screen_time WHERE student_id = ? AND date = ?",
                 (student_id, body.date))
    return refresh(conn, insert(
        conn, "screen_time", {"student_id": student_id, **body.model_dump()}, "screen_id"))


@app.get("/api/students/{student_id}/mood", tags=["mood & energy"])
def list_mood(student_id: int, frm: Optional[str] = Query(None, alias="from"),
              to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM mood_energy", conn, student_id, frm, to, "date", limit)


@app.post("/api/students/{student_id}/mood", status_code=201, tags=["mood & energy"])
def log_mood(student_id: int, body: m.MoodEnergyIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    conn.execute("DELETE FROM mood_energy WHERE student_id = ? AND date = ?",
                 (student_id, body.date))
    return refresh(conn, insert(
        conn, "mood_energy", {"student_id": student_id, **body.model_dump()}, "mood_id"))


# ---------------------------------------------------------------------
# Academic tasks
# ---------------------------------------------------------------------

@app.get("/api/students/{student_id}/tasks", tags=["tasks"])
def list_tasks(student_id: int, status: Optional[m.Status] = None,
               open_only: bool = False, conn=Depends(get_conn)):
    """List tasks. open_only uses the v_open_tasks view, which adds
    hours_until_due and is_overdue - what a task list actually wants to show."""
    require_student(conn, student_id)
    if open_only:
        return rows(conn.execute(
            "SELECT * FROM v_open_tasks WHERE student_id = ? "
            "ORDER BY due_date IS NULL, due_date", (student_id,)))
    sql = "SELECT * FROM academic_tasks WHERE student_id = ?"
    params: list[Any] = [student_id]
    if status:
        sql += " AND status = ?"
        params.append(status)
    return rows(conn.execute(sql + " ORDER BY due_date IS NULL, due_date", params))


@app.post("/api/students/{student_id}/tasks", status_code=201, tags=["tasks"])
def create_task(student_id: int, body: m.TaskIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    return refresh(conn, insert(
        conn, "academic_tasks", {"student_id": student_id, **body.model_dump()}, "task_id"))


@app.get("/api/tasks/{task_id}", tags=["tasks"])
def get_task(task_id: int, conn=Depends(get_conn)):
    return found(one(conn.execute(
        "SELECT * FROM academic_tasks WHERE task_id = ?", (task_id,))), "task", task_id)


@app.patch("/api/tasks/{task_id}", tags=["tasks"])
def update_task(task_id: int, body: m.TaskUpdate, conn=Depends(get_conn)):
    """Patch a task. Setting status to 'completed' stamps completed_at
    automatically; moving it back off 'completed' clears it."""
    get_task(task_id, conn)
    return refresh(conn, update(
        conn, "academic_tasks", body.model_dump(exclude_unset=True), "task_id", task_id))


@app.delete("/api/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: int, conn=Depends(get_conn)):
    """Study sessions logged against this task are kept, with task_id nulled."""
    get_task(task_id, conn)
    conn.execute("DELETE FROM academic_tasks WHERE task_id = ?", (task_id,))
    conn.commit()
    refresh(conn)


# ---------------------------------------------------------------------
# Calendar
# ---------------------------------------------------------------------

@app.get("/api/students/{student_id}/events", tags=["calendar"])
def list_events(student_id: int, frm: Optional[str] = Query(None, alias="from"),
                to: Optional[str] = None, conn=Depends(get_conn)):
    require_student(conn, student_id)
    clauses, params = ["student_id = ?"], [student_id]
    if frm:
        clauses.append("start_time >= ?"); params.append(frm)
    if to:
        clauses.append("start_time <= ?"); params.append(to)
    return rows(conn.execute(
        f"SELECT * FROM calendar_events WHERE {' AND '.join(clauses)} ORDER BY start_time", params))


@app.post("/api/students/{student_id}/events", status_code=201, tags=["calendar"])
def create_event(student_id: int, body: m.EventIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    data = body.model_dump()
    data["is_fixed"] = int(data["is_fixed"])
    return refresh(conn, insert(
        conn, "calendar_events", {"student_id": student_id, **data}, "event_id"))


@app.patch("/api/events/{event_id}", tags=["calendar"])
def update_event(event_id: int, body: m.EventUpdate, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM calendar_events WHERE event_id = ?", (event_id,))),
          "event", event_id)
    data = body.model_dump(exclude_unset=True)
    if "is_fixed" in data:
        data["is_fixed"] = int(data["is_fixed"])
    return refresh(conn, update(conn, "calendar_events", data, "event_id", event_id))


@app.delete("/api/events/{event_id}", status_code=204, tags=["calendar"])
def delete_event(event_id: int, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM calendar_events WHERE event_id = ?", (event_id,))),
          "event", event_id)
    conn.execute("DELETE FROM calendar_events WHERE event_id = ?", (event_id,))
    conn.commit()
    refresh(conn)


# ---------------------------------------------------------------------
# Study sessions
# ---------------------------------------------------------------------

@app.get("/api/students/{student_id}/sessions", tags=["study"])
def list_sessions(student_id: int, frm: Optional[str] = Query(None, alias="from"),
                  to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM study_sessions", conn, student_id, frm, to, "start_time", limit)


@app.post("/api/students/{student_id}/sessions", status_code=201, tags=["study"])
def start_session(student_id: int, body: m.SessionIn, conn=Depends(get_conn)):
    """Log a study session. Post it without end_time to open a running timer,
    then PATCH the end_time when the student stops; duration fills itself in."""
    require_student(conn, student_id)
    return refresh(conn, insert(
        conn, "study_sessions", {"student_id": student_id, **body.model_dump()}, "session_id"))


@app.patch("/api/sessions/{session_id}", tags=["study"])
def update_session(session_id: int, body: m.SessionUpdate, conn=Depends(get_conn)):
    row = found(one(conn.execute(
        "SELECT * FROM study_sessions WHERE session_id = ?", (session_id,))), "session", session_id)
    data = body.model_dump(exclude_unset=True)
    result = update(conn, "study_sessions", data, "session_id", session_id)
    # The duration trigger only fires on INSERT, so closing a session via PATCH
    # has to derive the duration here.
    if result and data.get("end_time") and result["duration_minutes"] is None:
        result = update(conn, "study_sessions", {"duration_minutes": round(
            (_julian(conn, result["end_time"]) - _julian(conn, result["start_time"])) * 1440)},
            "session_id", session_id)
    return refresh(conn, result)


def _julian(conn: sqlite3.Connection, ts: str) -> float:
    return conn.execute("SELECT julianday(?)", (ts,)).fetchone()[0]


@app.delete("/api/sessions/{session_id}", status_code=204, tags=["study"])
def delete_session(session_id: int, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM study_sessions WHERE session_id = ?", (session_id,))),
          "session", session_id)
    conn.execute("DELETE FROM study_sessions WHERE session_id = ?", (session_id,))
    conn.commit()
    refresh(conn)


# ---------------------------------------------------------------------
# Metrics & dashboard
# ---------------------------------------------------------------------

@app.get("/api/students/{student_id}/metrics", tags=["metrics"])
def list_metrics(student_id: int, frm: Optional[str] = Query(None, alias="from"),
                 to: Optional[str] = None, limit: int = 60, conn=Depends(get_conn)):
    """The daily_metrics rollup - one row per day, ready to plot."""
    return _date_range("SELECT * FROM daily_metrics", conn, student_id, frm, to, "date", limit)


@app.post("/api/rollup", tags=["metrics"])
def run_rollup(conn=Depends(get_conn)):
    """Recompute daily_metrics from the raw tables. Idempotent.

    Call this after a bulk import, or nightly. The write endpoints above do
    not trigger it, so metrics lag until this runs.
    """
    run_script(conn, "rollup.sql")
    n = conn.execute("SELECT count(*) FROM daily_metrics").fetchone()[0]
    return {"status": "ok", "rows": n}


@app.get("/api/students/{student_id}/dashboard", tags=["metrics"])
def dashboard(student_id: int, days: int = 14, conn=Depends(get_conn)):
    """Everything a dashboard screen needs, in one round trip."""
    require_student(conn, student_id)
    return {
        "student": one(conn.execute(
            "SELECT * FROM students WHERE student_id = ?", (student_id,))),
        "today": one(conn.execute(
            "SELECT * FROM daily_metrics WHERE student_id = ? AND date = date('now', 'localtime')",
            (student_id,))),
        "trend": rows(conn.execute(
            "SELECT * FROM daily_metrics WHERE student_id = ? "
            "AND date >= date('now', 'localtime', ?) ORDER BY date", (student_id, f"-{days} days"))),
        "open_tasks": rows(conn.execute(
            "SELECT * FROM v_open_tasks WHERE student_id = ? "
            "ORDER BY due_date IS NULL, due_date LIMIT 10", (student_id,))),
        "upcoming_events": rows(conn.execute(
            "SELECT * FROM calendar_events WHERE student_id = ? AND start_time >= datetime('now', 'localtime') "
            "ORDER BY start_time LIMIT 10", (student_id,))),
        "averages": one(conn.execute(
            "SELECT round(avg(sleep_duration), 1) AS avg_sleep_minutes, "
            "       round(avg(total_screen_minutes), 1) AS avg_screen_minutes, "
            "       round(avg(study_hours_completed), 2) AS avg_study_hours, "
            "       round(avg(productivity_score), 1) AS avg_productivity, "
            "       round(avg(energy_score), 1) AS avg_energy "
            "FROM daily_metrics WHERE student_id = ? AND date >= date('now', 'localtime', ?)",
            (student_id, f"-{days} days"))),
    }


# ---------------------------------------------------------------------
# Assessments (graded work)
#
# academic_tasks tracks what is due; this tracks what came back with a mark
# on it. Kept separate because they have different lifetimes - a task gets
# deleted once it stops mattering, a grade stays part of the record.
# ---------------------------------------------------------------------

@app.get("/api/students/{student_id}/assessments", tags=["grades"])
def list_assessments(student_id: int, subject: Optional[str] = None,
                     frm: Optional[str] = Query(None, alias="from"),
                     to: Optional[str] = None, limit: int = 200,
                     conn=Depends(get_conn)):
    """Graded items, newest first, read through v_assessment_pct so every row
    already carries its percentage and how far above the class it sat."""
    require_student(conn, student_id)
    clauses, params = ["student_id = ?"], [student_id]
    if subject:
        clauses.append("subject = ?"); params.append(subject)
    if frm:
        clauses.append("assessed_on >= ?"); params.append(frm)
    if to:
        clauses.append("assessed_on <= ?"); params.append(to)
    params.append(limit)
    return rows(conn.execute(
        f"SELECT * FROM v_assessment_pct WHERE {' AND '.join(clauses)} "
        f"ORDER BY assessed_on DESC, assessment_id DESC LIMIT ?", params))


@app.post("/api/students/{student_id}/assessments", status_code=201, tags=["grades"])
def create_assessment(student_id: int, body: m.AssessmentIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    return insert(conn, "assessments",
                  {"student_id": student_id, **body.model_dump()}, "assessment_id")


@app.patch("/api/assessments/{assessment_id}", tags=["grades"])
def update_assessment(assessment_id: int, body: m.AssessmentUpdate, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM assessments WHERE assessment_id = ?",
                           (assessment_id,))), "assessment", assessment_id)
    return update(conn, "assessments", body.model_dump(exclude_unset=True),
                  "assessment_id", assessment_id)


@app.delete("/api/assessments/{assessment_id}", status_code=204, tags=["grades"])
def delete_assessment(assessment_id: int, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM assessments WHERE assessment_id = ?",
                           (assessment_id,))), "assessment", assessment_id)
    conn.execute("DELETE FROM assessments WHERE assessment_id = ?", (assessment_id,))
    conn.commit()


@app.get("/api/students/{student_id}/grades", tags=["grades"])
def grades(student_id: int, conn=Depends(get_conn)):
    """A card's worth of standing per subject, plus the category rollup the
    grade screen breaks scores down by."""
    require_student(conn, student_id)
    return {
        "subjects": rows(conn.execute(
            "SELECT * FROM v_subject_grades WHERE student_id = ? "
            "ORDER BY weighted_percent DESC", (student_id,))),
        "by_category": rows(conn.execute(
            "SELECT category, COUNT(*) AS items, ROUND(AVG(percent), 2) AS mean_percent, "
            "       ROUND(SUM(COALESCE(weight_percent, 0)), 2) AS weight_recorded "
            "FROM v_assessment_pct WHERE student_id = ? GROUP BY category "
            "ORDER BY mean_percent DESC", (student_id,))),
        "overall": one(conn.execute(
            "SELECT COUNT(*) AS items, ROUND(AVG(percent), 2) AS mean_percent, "
            "       ROUND(AVG(class_delta), 2) AS avg_class_delta "
            "FROM v_assessment_pct WHERE student_id = ?", (student_id,))),
    }


# ---------------------------------------------------------------------
# Derived insight
#
# Everything below is computed from rows the student logged. There is no
# wearable behind this API, so what a sensor would have supplied - heart rate,
# HRV, sleep stages - is absent by design rather than invented.
# ---------------------------------------------------------------------

SLEEP_BANDS = ("<5.5h", "5.5-6.5h", "6.5-7.5h", ">=7.5h", "unknown")


def _band(hours: Optional[float]) -> str:
    """The sleep bands the analytics screen plots productivity against."""
    if hours is None:
        return "unknown"
    if hours < 5.5:
        return "<5.5h"
    if hours < 6.5:
        return "5.5-6.5h"
    if hours < 7.5:
        return "6.5-7.5h"
    return ">=7.5h"


def _streak(day_list: list[str], today: str) -> int:
    """Consecutive days ending today that carry a study session.

    Yesterday still keeps the streak alive: it should not read as broken at
    09:00 purely because the student has not sat down yet today.
    """
    have = set(day_list)
    cursor = date.fromisoformat(today)
    if cursor.isoformat() not in have:
        cursor -= timedelta(days=1)
    total = 0
    while cursor.isoformat() in have:
        total += 1
        cursor -= timedelta(days=1)
    return total


def _pct(value: Optional[float], ceiling: float) -> Optional[float]:
    """Scale a raw value onto 0-100, against the value that counts as full marks."""
    if value is None:
        return None
    return round(max(0.0, min(100.0, value / ceiling * 100.0)), 1)


def _blend(parts: list[tuple[Optional[float], float]]) -> Optional[float]:
    """Weighted mean that drops, rather than zeroes, components with no data."""
    live = [(v, w) for v, w in parts if v is not None]
    if not live:
        return None
    return round(sum(v * w for v, w in live) / sum(w for _, w in live), 1)


def _mean(values: list[float], places: int = 1) -> Optional[float]:
    return round(sum(values) / len(values), places) if values else None


@app.get("/api/students/{student_id}/insights", tags=["metrics"])
def insights(student_id: int, days: int = 14, conn=Depends(get_conn)):
    """The scores, streak and correlations the analytics screens are built on."""
    student = found(one(conn.execute(
        "SELECT * FROM students WHERE student_id = ?", (student_id,))), "student", student_id)
    # Score against this student's own target, not a fixed eight hours.
    goal_minutes = student["sleep_goal_minutes"] or 480
    window = f"-{days} days"
    today, since = conn.execute(
        "SELECT date('now', 'localtime'), date('now', 'localtime', ?)", (window,)).fetchone()

    trend = rows(conn.execute(
        "SELECT * FROM daily_metrics WHERE student_id = ? AND date >= ? "
        "ORDER BY date", (student_id, since)))

    averages = one(conn.execute(
        "SELECT round(avg(sleep_duration), 1)       AS avg_sleep_minutes, "
        "       round(avg(sleep_quality), 2)        AS avg_sleep_quality, "
        "       round(avg(total_screen_minutes), 1) AS avg_screen_minutes, "
        "       round(avg(social_media_minutes), 1) AS avg_social_minutes, "
        "       round(avg(study_hours_completed),2) AS avg_study_hours, "
        "       round(avg(available_study_hours),2) AS avg_available_hours, "
        "       round(avg(productivity_score), 1)   AS avg_productivity, "
        "       round(avg(energy_score), 1)         AS avg_energy, "
        "       count(*)                            AS days_logged "
        "FROM daily_metrics WHERE student_id = ? AND date >= ?",
        (student_id, since))) or {}

    mood = one(conn.execute(
        "SELECT round(avg(mood_score), 1) AS avg_mood, count(*) AS days_logged "
        "FROM mood_energy WHERE student_id = ? AND date >= ?",
        (student_id, since))) or {}

    focus = one(conn.execute(
        "SELECT round(avg(focus_rating), 2) AS avg_focus, count(*) AS sessions, "
        "       round(sum(duration_minutes) / 60.0, 2) AS hours "
        "FROM study_sessions WHERE student_id = ? AND date(start_time) >= ?",
        (student_id, since))) or {}

    # Sleep against the productivity score the rollup already computes. This is
    # the correlation the database can genuinely support - nothing here knows
    # what a given night's sleep did to an exam mark.
    buckets: dict[str, dict[str, Any]] = {}
    for row in trend:
        minutes = row["sleep_duration"]
        key = _band(minutes / 60.0 if minutes else None)
        bucket = buckets.setdefault(key, {"band": key, "days": 0, "prod": [], "study": []})
        bucket["days"] += 1
        if row["productivity_score"] is not None:
            bucket["prod"].append(row["productivity_score"])
        if row["study_hours_completed"] is not None:
            bucket["study"].append(row["study_hours_completed"])
    sleep_vs_productivity = [
        {"band": b["band"], "days": b["days"],
         "avg_productivity": _mean(b["prod"]),
         "avg_study_hours": _mean(b["study"], 2)}
        for b in (buckets[k] for k in SLEEP_BANDS if k in buckets)
    ]

    # When the student actually focuses well, by time of day.
    focus_by_part = rows(conn.execute(
        "SELECT CASE "
        "         WHEN CAST(strftime('%H', start_time) AS INTEGER) < 6  THEN 'late night' "
        "         WHEN CAST(strftime('%H', start_time) AS INTEGER) < 12 THEN 'morning' "
        "         WHEN CAST(strftime('%H', start_time) AS INTEGER) < 18 THEN 'afternoon' "
        "         WHEN CAST(strftime('%H', start_time) AS INTEGER) < 23 THEN 'evening' "
        "         ELSE 'late night' END                  AS part_of_day, "
        "       COUNT(*)                                 AS sessions, "
        "       ROUND(AVG(focus_rating), 2)              AS avg_focus, "
        "       ROUND(SUM(duration_minutes) / 60.0, 2)   AS hours "
        "FROM study_sessions "
        "WHERE student_id = ? AND duration_minutes IS NOT NULL AND date(start_time) >= ? "
        "GROUP BY part_of_day ORDER BY avg_focus DESC", (student_id, since)))

    # Where the hours went, by the subject of the task each session was against.
    subject_effort = rows(conn.execute(
        "SELECT COALESCE(t.subject, 'Unassigned')        AS subject, "
        "       ROUND(SUM(s.duration_minutes) / 60.0, 2) AS hours, "
        "       ROUND(AVG(s.focus_rating), 2)            AS avg_focus, "
        "       COUNT(*)                                 AS sessions "
        "FROM study_sessions s LEFT JOIN academic_tasks t ON t.task_id = s.task_id "
        "WHERE s.student_id = ? AND s.duration_minutes IS NOT NULL AND date(s.start_time) >= ? "
        "GROUP BY subject ORDER BY hours DESC", (student_id, since)))

    session_days = [r["d"] for r in rows(conn.execute(
        "SELECT DISTINCT date(start_time) AS d FROM study_sessions "
        "WHERE student_id = ? ORDER BY d DESC LIMIT 400", (student_id,)))]

    mastery = one(conn.execute(
        "SELECT ROUND(AVG(weighted_percent), 1) AS pct "
        "FROM v_subject_grades WHERE student_id = ?", (student_id,))) or {}

    # Four sub-scores on one 0-100 axis, so rings and bars can be read together.
    #
    # "Nothing logged" has to stay distinguishable from "logged, and it was
    # bad": a student who has just signed up is not at zero, they are unknown.
    # So the study-days component only has a denominator once there is at least
    # one day of data to divide by.
    logged_days = averages.get("days_logged") or 0
    days_with_study = (
        _pct(len([d for d in session_days if d >= since]), max(1, min(days, logged_days)))
        if logged_days else None
    )
    scores = {
        "academic_mastery": mastery.get("pct"),
        "sleep_health": _blend([
            (_pct(averages.get("avg_sleep_minutes"), float(goal_minutes)), 0.7),
            (_pct(averages.get("avg_sleep_quality"), 5.0), 0.3),
        ]),
        "resilience": _blend([
            (_pct(averages.get("avg_energy"), 10.0), 0.6),
            (_pct(mood.get("avg_mood"), 10.0), 0.4),
        ]),
        "focus_consistency": _blend([
            (days_with_study, 0.5),
            (_pct(focus.get("avg_focus"), 5.0), 0.5),
        ]),
        "productivity": averages.get("avg_productivity"),
    }

    sleep_debt = None
    if averages.get("avg_sleep_minutes") is not None and averages.get("days_logged"):
        sleep_debt = round(
            (averages["avg_sleep_minutes"] - goal_minutes) / 60.0 * averages["days_logged"], 1)

    return {
        "window_days": days,
        "today": today,
        "since": since,
        "goals": {
            "sleep_goal_minutes": goal_minutes,
            "daily_study_goal_hours": student["daily_study_goal_hours"],
        },
        "averages": averages,
        "mood": mood,
        "focus": focus,
        "scores": scores,
        "synthesis_index": _blend([
            (scores["academic_mastery"], 0.30),
            (scores["sleep_health"], 0.25),
            (scores["resilience"], 0.20),
            (scores["focus_consistency"], 0.25),
        ]),
        "sleep_debt_hours": sleep_debt,
        "streak_days": _streak(session_days, today),
        "sleep_vs_productivity": sleep_vs_productivity,
        "focus_by_part_of_day": focus_by_part,
        "subject_effort": subject_effort,
        "trend": trend,
    }


@app.get("/api/students/{student_id}/profile", tags=["students"])
def profile(student_id: int, conn=Depends(get_conn)):
    """The student's record plus how much of each thing they have logged.

    The counts are what make a profile page worth opening: they answer "how
    much of this have I actually used" in one screen, and they are the figures
    the delete button is really asking you about.
    """
    student = found(one(conn.execute(
        "SELECT * FROM students WHERE student_id = ?", (student_id,))), "student", student_id)

    counts = {}
    for table, label in (("sleep_logs", "nights"), ("screen_time", "screen_days"),
                         ("mood_energy", "check_ins"), ("academic_tasks", "tasks"),
                         ("calendar_events", "events"), ("study_sessions", "sessions"),
                         ("assessments", "assessments")):
        counts[label] = conn.execute(
            f"SELECT count(*) FROM {table} WHERE student_id = ?", (student_id,)).fetchone()[0]

    totals = one(conn.execute(
        "SELECT ROUND(SUM(duration_minutes) / 60.0, 1) AS study_hours, "
        "       MIN(date(start_time)) AS first_session "
        "FROM study_sessions WHERE student_id = ? AND duration_minutes IS NOT NULL",
        (student_id,))) or {}

    return {
        "student": student,
        "counts": counts,
        "totals": totals,
        "open_tasks": conn.execute(
            "SELECT count(*) FROM v_open_tasks WHERE student_id = ?",
            (student_id,)).fetchone()[0],
    }


@app.delete("/api/students/{student_id}/data", status_code=204, tags=["students"])
def clear_student_data(student_id: int, conn=Depends(get_conn)):
    """Wipe everything this student logged, keeping the student themselves.

    Separate from DELETE /students/{id}: "start again" and "I am not a user of
    this any more" are different intentions, and only one of them should take
    the account with it.
    """
    require_student(conn, student_id)
    for table in ("assessments", "study_sessions", "mood_energy", "calendar_events",
                  "academic_tasks", "screen_time", "sleep_logs", "daily_metrics"):
        conn.execute(f"DELETE FROM {table} WHERE student_id = ?", (student_id,))
    conn.commit()
    refresh(conn)


# ---------------------------------------------------------------------
# Wellbeing chat
# ---------------------------------------------------------------------

@app.get("/api/wellbeing/status", tags=["wellbeing"])
def wellbeing_status():
    """Whether the chat has a model behind it, so the page can say which mode
    it is in rather than silently degrading."""
    return {
        "model_available": wellbeing.configured(),
        "model": wellbeing.MODEL if wellbeing.configured() else None,
        "detail": None if wellbeing.configured() else
                  "No ANTHROPIC_API_KEY is set, so the chat is using its built-in "
                  "scripted replies. Set the key and restart to enable the model.",
    }


@app.post("/api/students/{student_id}/wellbeing/chat", tags=["wellbeing"])
def wellbeing_chat(student_id: int, body: m.ChatIn, conn=Depends(get_conn)):
    """One reply, grounded in this student's own logged figures.

    Returns 503 when no key is configured - the frontend treats that as
    "fall back to the scripted replies" rather than an error worth showing.
    """
    require_student(conn, student_id)
    if not wellbeing.configured():
        raise HTTPException(503, "No ANTHROPIC_API_KEY is set on the server.")

    student = one(conn.execute(
        "SELECT * FROM students WHERE student_id = ?", (student_id,)))
    context = wellbeing.context_block(
        insights(student_id, 14, conn),
        list_tasks(student_id, None, True, conn),
        student,
    )
    try:
        return wellbeing.reply(body.message, [t.model_dump() for t in body.history], context)
    except RuntimeError as exc:
        raise HTTPException(502, str(exc))


# ---------------------------------------------------------------------
# The frontend
#
# Serving the pages from the API process is what keeps this a one-command app:
# same origin, so CORS never comes into it, and no second server to start.
# Mounted last, because a mount at "/" swallows every path that the API routes
# above did not already claim.
# ---------------------------------------------------------------------

FRONTEND_DIR = ROOT / "frontend"

if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
