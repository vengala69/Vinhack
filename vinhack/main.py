"""VinHack REST API.

Run it with:  py -m vinhack     (or: uvicorn vinhack.main:app --reload)

Interactive docs live at http://127.0.0.1:8000/docs - the fastest way to see
every endpoint and try it without writing a line of frontend code.
"""
import sqlite3
from typing import Any, Optional

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import models as m
from .db import DB_PATH, connect, get_conn, insert, one, rows, run_script, schema_exists, update

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
    """Create the schema on first run so the API never starts against an empty file."""
    conn = connect()
    try:
        if not schema_exists(conn):
            run_script(conn, "schema.sql")
            print(f"created schema in {DB_PATH}")
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
    return insert(conn, "sleep_logs", {"student_id": student_id, **body.model_dump()}, "sleep_id")


@app.get("/api/students/{student_id}/screen-time", tags=["screen time"])
def list_screen_time(student_id: int, frm: Optional[str] = Query(None, alias="from"),
                     to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM screen_time", conn, student_id, frm, to, "date", limit)


@app.post("/api/students/{student_id}/screen-time", status_code=201, tags=["screen time"])
def log_screen_time(student_id: int, body: m.ScreenTimeIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    conn.execute("DELETE FROM screen_time WHERE student_id = ? AND date = ?",
                 (student_id, body.date))
    return insert(conn, "screen_time", {"student_id": student_id, **body.model_dump()}, "screen_id")


@app.get("/api/students/{student_id}/mood", tags=["mood & energy"])
def list_mood(student_id: int, frm: Optional[str] = Query(None, alias="from"),
              to: Optional[str] = None, limit: int = 100, conn=Depends(get_conn)):
    return _date_range("SELECT * FROM mood_energy", conn, student_id, frm, to, "date", limit)


@app.post("/api/students/{student_id}/mood", status_code=201, tags=["mood & energy"])
def log_mood(student_id: int, body: m.MoodEnergyIn, conn=Depends(get_conn)):
    require_student(conn, student_id)
    conn.execute("DELETE FROM mood_energy WHERE student_id = ? AND date = ?",
                 (student_id, body.date))
    return insert(conn, "mood_energy", {"student_id": student_id, **body.model_dump()}, "mood_id")


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
    return insert(conn, "academic_tasks", {"student_id": student_id, **body.model_dump()}, "task_id")


@app.get("/api/tasks/{task_id}", tags=["tasks"])
def get_task(task_id: int, conn=Depends(get_conn)):
    return found(one(conn.execute(
        "SELECT * FROM academic_tasks WHERE task_id = ?", (task_id,))), "task", task_id)


@app.patch("/api/tasks/{task_id}", tags=["tasks"])
def update_task(task_id: int, body: m.TaskUpdate, conn=Depends(get_conn)):
    """Patch a task. Setting status to 'completed' stamps completed_at
    automatically; moving it back off 'completed' clears it."""
    get_task(task_id, conn)
    return update(conn, "academic_tasks", body.model_dump(exclude_unset=True), "task_id", task_id)


@app.delete("/api/tasks/{task_id}", status_code=204, tags=["tasks"])
def delete_task(task_id: int, conn=Depends(get_conn)):
    """Study sessions logged against this task are kept, with task_id nulled."""
    get_task(task_id, conn)
    conn.execute("DELETE FROM academic_tasks WHERE task_id = ?", (task_id,))
    conn.commit()


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
    return insert(conn, "calendar_events", {"student_id": student_id, **data}, "event_id")


@app.patch("/api/events/{event_id}", tags=["calendar"])
def update_event(event_id: int, body: m.EventUpdate, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM calendar_events WHERE event_id = ?", (event_id,))),
          "event", event_id)
    data = body.model_dump(exclude_unset=True)
    if "is_fixed" in data:
        data["is_fixed"] = int(data["is_fixed"])
    return update(conn, "calendar_events", data, "event_id", event_id)


@app.delete("/api/events/{event_id}", status_code=204, tags=["calendar"])
def delete_event(event_id: int, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM calendar_events WHERE event_id = ?", (event_id,))),
          "event", event_id)
    conn.execute("DELETE FROM calendar_events WHERE event_id = ?", (event_id,))
    conn.commit()


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
    return insert(conn, "study_sessions", {"student_id": student_id, **body.model_dump()}, "session_id")


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
    return result


def _julian(conn: sqlite3.Connection, ts: str) -> float:
    return conn.execute("SELECT julianday(?)", (ts,)).fetchone()[0]


@app.delete("/api/sessions/{session_id}", status_code=204, tags=["study"])
def delete_session(session_id: int, conn=Depends(get_conn)):
    found(one(conn.execute("SELECT * FROM study_sessions WHERE session_id = ?", (session_id,))),
          "session", session_id)
    conn.execute("DELETE FROM study_sessions WHERE session_id = ?", (session_id,))
    conn.commit()


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
            "SELECT * FROM daily_metrics WHERE student_id = ? AND date = date('now')",
            (student_id,))),
        "trend": rows(conn.execute(
            "SELECT * FROM daily_metrics WHERE student_id = ? "
            "AND date >= date('now', ?) ORDER BY date", (student_id, f"-{days} days"))),
        "open_tasks": rows(conn.execute(
            "SELECT * FROM v_open_tasks WHERE student_id = ? "
            "ORDER BY due_date IS NULL, due_date LIMIT 10", (student_id,))),
        "upcoming_events": rows(conn.execute(
            "SELECT * FROM calendar_events WHERE student_id = ? AND start_time >= datetime('now') "
            "ORDER BY start_time LIMIT 10", (student_id,))),
        "averages": one(conn.execute(
            "SELECT round(avg(sleep_duration), 1) AS avg_sleep_minutes, "
            "       round(avg(total_screen_minutes), 1) AS avg_screen_minutes, "
            "       round(avg(study_hours_completed), 2) AS avg_study_hours, "
            "       round(avg(productivity_score), 1) AS avg_productivity, "
            "       round(avg(energy_score), 1) AS avg_energy "
            "FROM daily_metrics WHERE student_id = ? AND date >= date('now', ?)",
            (student_id, f"-{days} days"))),
    }
