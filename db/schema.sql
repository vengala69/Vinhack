-- VinHack: student wellness & productivity tracker
-- SQLite schema.
--
-- Conventions:
--   * Timestamps are ISO-8601 TEXT ('YYYY-MM-DD HH:MM:SS'), which SQLite's
--     date functions understand and which sorts correctly as text.
--   * Dates are ISO-8601 TEXT ('YYYY-MM-DD').
--   * Every stored time is LOCAL wall-clock time, never UTC. A 09:00 lecture
--     reads 09:00 to the student who has to be in it, and 'today' has to mean
--     their today - east of UTC, date('now') is still yesterday until mid
--     morning. Hence 'localtime' on every clock reading in here.
--   * Enums are TEXT with a CHECK constraint.
--   * Foreign keys need `PRAGMA foreign_keys = ON` on every connection.

PRAGMA foreign_keys = ON;

-- 1. students -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
    student_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    email      TEXT    NOT NULL UNIQUE,
    semester   INTEGER CHECK (semester BETWEEN 1 AND 12),
    created_at TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);

-- 2. sleep_logs ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS sleep_logs (
    sleep_id         INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    sleep_date       TEXT    NOT NULL,
    bedtime          TEXT,
    wake_time        TEXT,
    duration_minutes INTEGER CHECK (duration_minutes BETWEEN 0 AND 1440),
    quality          INTEGER CHECK (quality BETWEEN 1 AND 5),
    created_at       TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    UNIQUE (student_id, sleep_date),
    CHECK (wake_time IS NULL OR bedtime IS NULL OR wake_time > bedtime)
);
CREATE INDEX IF NOT EXISTS sleep_logs_student_date_idx ON sleep_logs (student_id, sleep_date DESC);

-- 3. screen_time --------------------------------------------------------
CREATE TABLE IF NOT EXISTS screen_time (
    screen_id             INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id            INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    date                  TEXT    NOT NULL,
    social_media_minutes  INTEGER NOT NULL DEFAULT 0 CHECK (social_media_minutes  >= 0),
    entertainment_minutes INTEGER NOT NULL DEFAULT 0 CHECK (entertainment_minutes >= 0),
    education_minutes     INTEGER NOT NULL DEFAULT 0 CHECK (education_minutes     >= 0),
    communication_minutes INTEGER NOT NULL DEFAULT 0 CHECK (communication_minutes >= 0),
    other_minutes         INTEGER NOT NULL DEFAULT 0 CHECK (other_minutes         >= 0),
    -- derived: always the sum of the five category columns, never inserted
    total_screen_minutes  INTEGER GENERATED ALWAYS AS (
        social_media_minutes + entertainment_minutes + education_minutes
        + communication_minutes + other_minutes
    ) STORED,
    UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS screen_time_student_date_idx ON screen_time (student_id, date DESC);

-- 4. academic_tasks -----------------------------------------------------
CREATE TABLE IF NOT EXISTS academic_tasks (
    task_id                INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id             INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    task_name              TEXT    NOT NULL,
    subject                TEXT,
    task_type              TEXT    NOT NULL DEFAULT 'other'
                           CHECK (task_type IN ('assignment','exam','quiz','project','reading','lab','other')),
    due_date               TEXT,
    estimated_effort_hours REAL    CHECK (estimated_effort_hours >= 0),
    priority               TEXT    NOT NULL DEFAULT 'medium'
                           CHECK (priority IN ('low','medium','high','urgent')),
    status                 TEXT    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','in_progress','completed','cancelled')),
    completed_at           TEXT,
    created_at             TEXT    NOT NULL DEFAULT (datetime('now', 'localtime'))
);
CREATE INDEX IF NOT EXISTS academic_tasks_student_status_idx ON academic_tasks (student_id, status);
CREATE INDEX IF NOT EXISTS academic_tasks_student_due_idx    ON academic_tasks (student_id, due_date);

-- 5. calendar_events ----------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_events (
    event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    event_name TEXT    NOT NULL,
    event_type TEXT    NOT NULL DEFAULT 'other'
               CHECK (event_type IN ('class','exam','lab','meeting','personal','commute','other')),
    start_time TEXT    NOT NULL,
    end_time   TEXT    NOT NULL,
    is_fixed   INTEGER NOT NULL DEFAULT 1 CHECK (is_fixed IN (0, 1)),
    location   TEXT,
    CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS calendar_events_student_start_idx ON calendar_events (student_id, start_time);

-- 6. mood_energy --------------------------------------------------------
CREATE TABLE IF NOT EXISTS mood_energy (
    mood_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id   INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    date         TEXT    NOT NULL,
    mood_score   INTEGER CHECK (mood_score   BETWEEN 1 AND 10),
    energy_score INTEGER CHECK (energy_score BETWEEN 1 AND 10),
    UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS mood_energy_student_date_idx ON mood_energy (student_id, date DESC);

-- 7. study_sessions -----------------------------------------------------
CREATE TABLE IF NOT EXISTS study_sessions (
    session_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id       INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    -- a deleted task must not erase the logged effort, so this goes NULL
    task_id          INTEGER REFERENCES academic_tasks(task_id) ON DELETE SET NULL,
    start_time       TEXT    NOT NULL,
    end_time         TEXT,
    duration_minutes INTEGER CHECK (duration_minutes >= 0),
    focus_rating     INTEGER CHECK (focus_rating BETWEEN 1 AND 5),
    CHECK (end_time IS NULL OR end_time > start_time)
);
CREATE INDEX IF NOT EXISTS study_sessions_student_start_idx ON study_sessions (student_id, start_time DESC);
CREATE INDEX IF NOT EXISTS study_sessions_task_idx          ON study_sessions (task_id);

-- 8. daily_metrics ------------------------------------------------------
-- A derived rollup, one row per student per day. Rebuilt by rollup.sql;
-- nothing should write to it by hand.
CREATE TABLE IF NOT EXISTS daily_metrics (
    metric_id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id                   INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    date                         TEXT    NOT NULL,
    sleep_duration               INTEGER CHECK (sleep_duration BETWEEN 0 AND 1440),
    sleep_quality                INTEGER CHECK (sleep_quality BETWEEN 1 AND 5),
    social_media_minutes         INTEGER CHECK (social_media_minutes >= 0),
    total_screen_minutes         INTEGER CHECK (total_screen_minutes >= 0),
    pending_tasks                INTEGER CHECK (pending_tasks >= 0),
    high_priority_tasks          INTEGER CHECK (high_priority_tasks >= 0),
    hours_until_nearest_deadline REAL,
    available_study_hours        REAL    CHECK (available_study_hours >= 0),
    study_hours_completed        REAL    CHECK (study_hours_completed >= 0),
    energy_score                 INTEGER CHECK (energy_score BETWEEN 1 AND 10),
    productivity_score           REAL    CHECK (productivity_score BETWEEN 0 AND 100),
    UNIQUE (student_id, date)
);
CREATE INDEX IF NOT EXISTS daily_metrics_student_date_idx ON daily_metrics (student_id, date DESC);

-- ---------------------------------------------------------------------
-- Triggers
--
-- SQLite BEFORE triggers cannot modify the row being written, so these run
-- AFTER and issue an UPDATE. Recursive triggers are off by default, and each
-- WHEN clause is false after the correction anyway, so they do not loop.
-- ---------------------------------------------------------------------

CREATE TRIGGER IF NOT EXISTS sleep_logs_duration_ins AFTER INSERT ON sleep_logs
WHEN NEW.duration_minutes IS NULL AND NEW.bedtime IS NOT NULL AND NEW.wake_time IS NOT NULL
BEGIN
    UPDATE sleep_logs
       SET duration_minutes = CAST(ROUND((julianday(NEW.wake_time) - julianday(NEW.bedtime)) * 1440) AS INTEGER)
     WHERE sleep_id = NEW.sleep_id;
END;

CREATE TRIGGER IF NOT EXISTS study_sessions_duration_ins AFTER INSERT ON study_sessions
WHEN NEW.duration_minutes IS NULL AND NEW.end_time IS NOT NULL
BEGIN
    UPDATE study_sessions
       SET duration_minutes = CAST(ROUND((julianday(NEW.end_time) - julianday(NEW.start_time)) * 1440) AS INTEGER)
     WHERE session_id = NEW.session_id;
END;

-- completed_at follows status, so callers can just flip the status field.
CREATE TRIGGER IF NOT EXISTS academic_tasks_completed_ins AFTER INSERT ON academic_tasks
WHEN NEW.status = 'completed' AND NEW.completed_at IS NULL
BEGIN
    UPDATE academic_tasks SET completed_at = datetime('now', 'localtime') WHERE task_id = NEW.task_id;
END;

CREATE TRIGGER IF NOT EXISTS academic_tasks_completed_upd AFTER UPDATE OF status ON academic_tasks
WHEN (NEW.status = 'completed' AND NEW.completed_at IS NULL)
  OR (NEW.status <> 'completed' AND NEW.completed_at IS NOT NULL)
BEGIN
    UPDATE academic_tasks
       SET completed_at = CASE WHEN NEW.status = 'completed' THEN datetime('now', 'localtime') ELSE NULL END
     WHERE task_id = NEW.task_id;
END;

-- ---------------------------------------------------------------------
-- Views
-- ---------------------------------------------------------------------

-- Every outstanding task, with how long is left on the clock.
CREATE VIEW IF NOT EXISTS v_open_tasks AS
SELECT t.*,
       (julianday(t.due_date) - julianday('now', 'localtime')) * 24.0 AS hours_until_due,
       CASE WHEN t.due_date IS NOT NULL AND t.due_date < datetime('now', 'localtime')
            THEN 1 ELSE 0 END                            AS is_overdue
FROM   academic_tasks t
WHERE  t.status IN ('pending', 'in_progress');

-- Study effort logged per student per day.
CREATE VIEW IF NOT EXISTS v_study_by_day AS
SELECT student_id,
       date(start_time)             AS date,
       SUM(duration_minutes) / 60.0 AS study_hours,
       AVG(focus_rating)            AS avg_focus,
       COUNT(*)                     AS session_count
FROM   study_sessions
WHERE  duration_minutes IS NOT NULL
GROUP  BY student_id, date(start_time);

-- Hours already locked up by immovable calendar events.
CREATE VIEW IF NOT EXISTS v_committed_by_day AS
SELECT student_id,
       date(start_time)                                          AS date,
       SUM((julianday(end_time) - julianday(start_time)) * 24.0) AS committed_hours
FROM   calendar_events
WHERE  is_fixed = 1
GROUP  BY student_id, date(start_time);

-- 9. assessments --------------------------------------------------------
-- Graded work that came back with a mark on it. academic_tasks tracks what
-- is *due*; this tracks what was *scored*, which is a different lifecycle:
-- a task is deleted once it stops being relevant, a grade is permanent.
-- task_id is the optional link back to the task the mark came from.
CREATE TABLE IF NOT EXISTS assessments (
    assessment_id  INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id     INTEGER NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    -- a deleted task must not erase the grade, so this goes NULL
    task_id        INTEGER REFERENCES academic_tasks(task_id) ON DELETE SET NULL,
    subject        TEXT    NOT NULL,
    title          TEXT    NOT NULL,
    category       TEXT    NOT NULL DEFAULT 'other'
                   CHECK (category IN ('exam','quiz','lab','project','assignment','participation','other')),
    assessed_on    TEXT    NOT NULL,
    score          REAL    NOT NULL CHECK (score >= 0),
    max_score      REAL    NOT NULL DEFAULT 100 CHECK (max_score > 0),
    weight_percent REAL    CHECK (weight_percent BETWEEN 0 AND 100),
    class_average  REAL    CHECK (class_average >= 0),
    created_at     TEXT    NOT NULL DEFAULT (datetime('now', 'localtime')),
    CHECK (score <= max_score)
);
CREATE INDEX IF NOT EXISTS assessments_student_date_idx ON assessments (student_id, assessed_on DESC);
CREATE INDEX IF NOT EXISTS assessments_student_subject_idx ON assessments (student_id, subject);

-- Every graded item as a percentage, with how far above the class it sat.
CREATE VIEW IF NOT EXISTS v_assessment_pct AS
SELECT a.*,
       ROUND(a.score * 100.0 / a.max_score, 2)      AS percent,
       CASE WHEN a.class_average IS NULL THEN NULL
            ELSE ROUND(a.score * 100.0 / a.max_score - a.class_average, 2)
       END                                          AS class_delta
FROM   assessments a;

-- One row per subject: the weight-averaged standing used for the grade cards.
-- Items without a weight fall back to 1 so an unweighted subject still averages.
CREATE VIEW IF NOT EXISTS v_subject_grades AS
SELECT student_id,
       subject,
       COUNT(*)                                                   AS items,
       ROUND(SUM(percent * COALESCE(weight_percent, 1))
             / SUM(COALESCE(weight_percent, 1)), 2)               AS weighted_percent,
       ROUND(AVG(percent), 2)                                     AS mean_percent,
       ROUND(SUM(COALESCE(weight_percent, 0)), 2)                 AS weight_recorded,
       ROUND(AVG(class_delta), 2)                                 AS avg_class_delta,
       MAX(assessed_on)                                           AS last_assessed_on
FROM   v_assessment_pct
GROUP  BY student_id, subject;
