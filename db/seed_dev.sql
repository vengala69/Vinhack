-- Development seed data for VinHack.
-- Three students with 14 days of generated history.
-- Safe to re-run: it clears the tables first.
--
-- Note: recursive CTEs are used instead of generate_series(), which is not
-- compiled into the SQLite that ships with Python.

PRAGMA foreign_keys = ON;

DELETE FROM daily_metrics;
DELETE FROM study_sessions;
DELETE FROM mood_energy;
DELETE FROM calendar_events;
DELETE FROM academic_tasks;
DELETE FROM screen_time;
DELETE FROM sleep_logs;
DELETE FROM students;
DELETE FROM sqlite_sequence;

-- ---------------------------------------------------------------------
INSERT INTO students (name, email, semester) VALUES
    ('Aarav Mehta', 'aarav@example.edu', 4),
    ('Priya Nair',  'priya@example.edu', 6),
    ('Rohan Verma', 'rohan@example.edu', 2);

-- The 14-day window the seed covers, ending today.
CREATE TEMP TABLE seed_days AS
WITH RECURSIVE d(n) AS (
    SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < 13
)
SELECT date('now', '-' || (13 - n) || ' days') AS date FROM d;

-- ---------------------------------------------------------------------
-- sleep_logs: bed between 23:00 and 01:30, waking between 07:00 and 08:30.
-- duration_minutes is left NULL so the trigger derives it.
INSERT INTO sleep_logs (student_id, sleep_date, bedtime, wake_time, quality)
SELECT s.student_id,
       d.date,
       datetime(d.date, '-1 day', '+23 hours', '+' || (abs(random()) % 150) || ' minutes'),
       datetime(d.date, '+7 hours', '+' || (abs(random()) % 90) || ' minutes'),
       1 + abs(random()) % 5
FROM   students s CROSS JOIN seed_days d;

-- ---------------------------------------------------------------------
-- screen_time. total_screen_minutes is generated, so it is not inserted.
INSERT INTO screen_time (student_id, date, social_media_minutes,
                         entertainment_minutes, education_minutes,
                         communication_minutes, other_minutes)
SELECT s.student_id,
       d.date,
       30 + abs(random()) % 150,
       20 + abs(random()) % 120,
       15 + abs(random()) % 90,
       10 + abs(random()) % 60,
        5 + abs(random()) % 40
FROM   students s CROSS JOIN seed_days d;

-- ---------------------------------------------------------------------
INSERT INTO mood_energy (student_id, date, mood_score, energy_score)
SELECT s.student_id,
       d.date,
       3 + abs(random()) % 8,
       3 + abs(random()) % 8
FROM   students s CROSS JOIN seed_days d;

-- ---------------------------------------------------------------------
-- academic_tasks: six per student, mixed type, priority and status.
-- completed_at is left NULL; the trigger fills it for the completed row.
INSERT INTO academic_tasks (student_id, task_name, subject, task_type, due_date,
                            estimated_effort_hours, priority, status, created_at)
SELECT s.student_id,
       t.task_name,
       t.subject,
       t.task_type,
       datetime('now', t.due_offset || ' days', 'start of day', '+23 hours', '+59 minutes'),
       t.effort,
       t.priority,
       t.status,
       datetime('now', '-' || (13 - t.created_offset) || ' days')
FROM   students s
CROSS  JOIN (
    SELECT 'Linear Algebra problem set' AS task_name, 'Mathematics'       AS subject, 'assignment' AS task_type,  '+2' AS due_offset,  4.0 AS effort, 'high'   AS priority, 'pending'     AS status, 0 AS created_offset
    UNION ALL SELECT 'DBMS mid-term revision',     'Databases',         'exam',        '+5', 10.0, 'urgent', 'in_progress', 1
    UNION ALL SELECT 'OS lab report',              'Operating Systems', 'lab',         '+1',  2.5, 'medium', 'pending',     3
    UNION ALL SELECT 'Ethics reading - ch. 4-6',   'Humanities',        'reading',     '+7',  1.5, 'low',    'pending',     5
    UNION ALL SELECT 'Capstone proposal draft',    'Capstone',          'project',    '+14', 12.0, 'high',   'in_progress', 6
    UNION ALL SELECT 'Networks quiz prep',         'Networks',          'quiz',        '-2',  3.0, 'medium', 'completed',   2
) t;

-- ---------------------------------------------------------------------
-- calendar_events: a fixed weekday lecture block, plus an optional club night.
INSERT INTO calendar_events (student_id, event_name, event_type, start_time, end_time, is_fixed, location)
SELECT s.student_id, 'Lecture block', 'class',
       datetime(d.date, '+9 hours'),
       datetime(d.date, '+13 hours'),
       1, 'Block B, Room 204'
FROM   students s CROSS JOIN seed_days d
WHERE  CAST(strftime('%w', d.date) AS INTEGER) BETWEEN 1 AND 5;

INSERT INTO calendar_events (student_id, event_name, event_type, start_time, end_time, is_fixed, location)
SELECT s.student_id, 'Coding club', 'meeting',
       datetime(d.date, '+17 hours'),
       datetime(d.date, '+18 hours', '+30 minutes'),
       0, 'Innovation Lab'
FROM   students s CROSS JOIN seed_days d
WHERE  CAST(strftime('%w', d.date) AS INTEGER) = 3;

-- ---------------------------------------------------------------------
-- study_sessions: up to two per student per day, attached to that student's
-- own tasks. duration_minutes is left NULL so the trigger derives it.
INSERT INTO study_sessions (student_id, task_id, start_time, end_time, focus_rating)
SELECT s.student_id,
       (SELECT t.task_id FROM academic_tasks t
         WHERE t.student_id = s.student_id
         ORDER BY random() LIMIT 1),
       datetime(d.date, '+14 hours', '+' || (n * 3) || ' hours'),
       datetime(d.date, '+14 hours', '+' || (n * 3) || ' hours',
                '+' || (45 + abs(random()) % 75) || ' minutes'),
       1 + abs(random()) % 5
FROM   students s
CROSS  JOIN seed_days d
CROSS  JOIN (SELECT 0 AS n UNION ALL SELECT 1) sess
WHERE  abs(random()) % 10 < 7;

DROP TABLE seed_days;
