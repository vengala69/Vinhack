-- Development seed data for VinHack.
-- Three students with 14 days of generated history.
-- Safe to re-run: it clears the tables first.
--
-- Note: recursive CTEs are used instead of generate_series(), which is not
-- compiled into the SQLite that ships with Python.

PRAGMA foreign_keys = ON;

DELETE FROM assessments;
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
-- Three targets rather than one, so the sleep goal is visibly a setting and
-- not a constant: Priya is scored against 7h and Rohan against 8h30.
INSERT INTO students (name, email, semester, programme, registration_no,
                      sleep_goal_minutes, daily_study_goal_hours) VALUES
    ('Aarav Mehta', 'aarav@example.edu', 4, 'B.Tech Computer Science',  '22BCE1041', 480, 4.0),
    ('Priya Nair',  'priya@example.edu', 6, 'B.Tech Information Tech.', '21BIT2270', 420, 5.0),
    ('Rohan Verma', 'rohan@example.edu', 2, 'B.Tech Electronics',       '24BEC0915', 510, 3.0);

-- The 14-day window the seed covers, ending today.
CREATE TEMP TABLE seed_days AS
WITH RECURSIVE d(n) AS (
    SELECT 0 UNION ALL SELECT n + 1 FROM d WHERE n < 13
)
SELECT date('now', 'localtime', '-' || (13 - n) || ' days') AS date FROM d;

-- ---------------------------------------------------------------------
-- sleep_logs: bed between 22:30 and 02:00, waking between 06:15 and 08:30,
-- which spans every band the analytics screen buckets sleep into.
-- duration_minutes is left NULL so the trigger derives it.
INSERT INTO sleep_logs (student_id, sleep_date, bedtime, wake_time, quality)
SELECT s.student_id,
       d.date,
       datetime(d.date, '-1 day', '+22 hours', '+30 minutes',
                '+' || (abs(random()) % 210) || ' minutes'),
       datetime(d.date, '+6 hours', '+15 minutes',
                '+' || (abs(random()) % 135) || ' minutes'),
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
       datetime('now', 'localtime', t.due_offset || ' days', 'start of day', '+23 hours', '+59 minutes'),
       t.effort,
       t.priority,
       t.status,
       datetime('now', 'localtime', '-' || (13 - t.created_offset) || ' days')
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
-- study_sessions: up to three per student per day, spread across morning,
-- afternoon and evening so the time-of-day focus breakdown has more than one
-- bar in it. Focus ratings taper through the day, which is the pattern the
-- analytics screen is meant to surface rather than assert.
-- duration_minutes is left NULL so the trigger derives it.
--
-- MATERIALIZED matters here: random() is re-evaluated on every reference, so
-- without it the start-time jitter would be drawn twice and end_time could
-- land before start_time, tripping the table's own CHECK.
INSERT INTO study_sessions (student_id, task_id, start_time, end_time, focus_rating)
WITH planned AS MATERIALIZED (
    SELECT s.student_id                                   AS student_id,
           (SELECT t.task_id FROM academic_tasks t
             WHERE t.student_id = s.student_id
             ORDER BY random() LIMIT 1)                   AS task_id,
           datetime(d.date, '+' || slot.hour || ' hours',
                    '+' || (abs(random()) % slot.jitter) || ' minutes')
                                                          AS start_time,
           40 + abs(random()) % 80                        AS minutes,
           MAX(1, MIN(5, slot.focus_base + abs(random()) % 2))
                                                          AS focus_rating
    FROM   students s
    CROSS  JOIN seed_days d
    CROSS  JOIN (
        SELECT  8 AS hour, 120 AS jitter, 4 AS focus_base, 8 AS odds  -- morning
        UNION ALL SELECT 14, 180, 3, 7                                -- afternoon
        UNION ALL SELECT 20, 150, 2, 5                                -- evening
    ) slot
    WHERE  abs(random()) % 10 < slot.odds
)
SELECT student_id, task_id, start_time,
       datetime(start_time, '+' || minutes || ' minutes'),
       focus_rating
FROM   planned;

-- ---------------------------------------------------------------------
-- assessments: graded work already returned, spread over the last 5 weeks.
-- Subjects match the academic_tasks above so the two screens line up.
INSERT INTO assessments (student_id, subject, title, category, assessed_on,
                         score, max_score, weight_percent, class_average)
SELECT s.student_id,
       a.subject,
       a.title,
       a.category,
       date('now', 'localtime', a.day_offset || ' days'),
       -- a per-student spread so the three seeded students do not look identical
       MIN(a.max_score, ROUND(a.score + (s.student_id - 2) * 3.0, 1)),
       a.max_score,
       a.weight_percent,
       a.class_average
FROM   students s
CROSS  JOIN (
    SELECT 'Mathematics'       AS subject, 'Quiz 1: Vector spaces'          AS title, 'quiz'       AS category, '-33' AS day_offset, 88.0 AS score, 100.0 AS max_score,  5.0 AS weight_percent, 79.0 AS class_average
    UNION ALL SELECT 'Databases',         'Quiz 1: Relational algebra',     'quiz',       '-30', 91.0, 100.0,  5.0, 82.5
    UNION ALL SELECT 'Operating Systems', 'Lab 2: Process scheduling',      'lab',        '-26', 94.0, 100.0, 10.0, 85.0
    UNION ALL SELECT 'Mathematics',       'Problem set 4',                  'assignment', '-21', 82.0, 100.0,  8.0, 78.0
    UNION ALL SELECT 'Networks',          'Quiz 2: TCP congestion control', 'quiz',       '-17', 76.0, 100.0,  5.0, 74.5
    UNION ALL SELECT 'Humanities',        'Response essay: ethics of AI',   'assignment', '-14', 85.0, 100.0, 10.0, 80.0
    UNION ALL SELECT 'Databases',         'Mid-term 1: Normalisation',      'exam',       '-11', 87.0, 100.0, 20.0, 76.0
    UNION ALL SELECT 'Operating Systems', 'Lab 3: Virtual memory',          'lab',         '-8', 96.0, 100.0, 10.0, 88.0
    UNION ALL SELECT 'Capstone',          'Proposal checkpoint review',     'project',     '-5', 90.0, 100.0, 15.0, 84.0
    UNION ALL SELECT 'Networks',          'Seminar participation',          'participation','-3', 92.0, 100.0,  5.0, 87.0
) a;

-- Attach the marks to the seeded task of the same subject where one exists,
-- so the grade ledger can link back to the coursework it came from.
UPDATE assessments
   SET task_id = (SELECT t.task_id FROM academic_tasks t
                   WHERE t.student_id = assessments.student_id
                     AND t.subject    = assessments.subject
                   ORDER BY t.task_id LIMIT 1);

DROP TABLE seed_days;
