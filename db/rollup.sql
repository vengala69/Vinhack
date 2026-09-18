-- Rebuild daily_metrics from the raw tables.
--
-- SQLite has no stored procedures, so this is a script rather than a function.
-- It is idempotent: re-running it overwrites the affected rows instead of
-- duplicating them. Run it nightly, or after any bulk import.
--
-- It covers every student × day for which any raw data exists.

INSERT INTO daily_metrics (
    student_id, date,
    sleep_duration, sleep_quality,
    social_media_minutes, total_screen_minutes,
    pending_tasks, high_priority_tasks, hours_until_nearest_deadline,
    available_study_hours, study_hours_completed,
    energy_score, productivity_score
)
WITH
-- Every student × day that shows up anywhere in the raw tables.
days AS (
    SELECT student_id, sleep_date AS date FROM sleep_logs
    UNION
    SELECT student_id, date             FROM screen_time
    UNION
    SELECT student_id, date             FROM mood_energy
    UNION
    SELECT student_id, date(start_time) FROM study_sessions
    UNION
    SELECT student_id, date(start_time) FROM calendar_events
),
base AS (
    SELECT
        d.student_id,
        d.date,
        sl.duration_minutes                AS sleep_duration,
        sl.quality                         AS sleep_quality,
        st.social_media_minutes,
        st.total_screen_minutes,
        me.energy_score,
        COALESCE(sd.study_hours, 0.0)      AS study_hours,
        COALESCE(sd.avg_focus, 3.0)        AS avg_focus,
        COALESCE(cd.committed_hours, 0.0)  AS committed_hours,

        -- Task backlog as it stood at the end of that day, not as it stands now.
        (SELECT COUNT(*) FROM academic_tasks t
          WHERE t.student_id = d.student_id
            AND t.status <> 'cancelled'
            AND t.created_at < datetime(d.date, '+1 day')
            AND (t.completed_at IS NULL OR t.completed_at >= datetime(d.date, '+1 day'))
        ) AS pending_tasks,

        (SELECT COUNT(*) FROM academic_tasks t
          WHERE t.student_id = d.student_id
            AND t.status <> 'cancelled'
            AND t.priority IN ('high', 'urgent')
            AND t.created_at < datetime(d.date, '+1 day')
            AND (t.completed_at IS NULL OR t.completed_at >= datetime(d.date, '+1 day'))
        ) AS high_priority_tasks,

        (SELECT ROUND(MIN((julianday(t.due_date) - julianday(d.date, '+1 day')) * 24.0), 2)
           FROM academic_tasks t
          WHERE t.student_id = d.student_id
            AND t.status <> 'cancelled'
            AND t.due_date IS NOT NULL
            AND t.created_at < datetime(d.date, '+1 day')
            AND (t.completed_at IS NULL OR t.completed_at >= datetime(d.date, '+1 day'))
        ) AS hours_until_nearest_deadline

    FROM   days d
    LEFT   JOIN sleep_logs      sl ON sl.student_id = d.student_id AND sl.sleep_date = d.date
    LEFT   JOIN screen_time     st ON st.student_id = d.student_id AND st.date       = d.date
    LEFT   JOIN mood_energy     me ON me.student_id = d.student_id AND me.date       = d.date
    LEFT   JOIN v_study_by_day  sd ON sd.student_id = d.student_id AND sd.date       = d.date
    LEFT   JOIN v_committed_by_day cd ON cd.student_id = d.student_id AND cd.date    = d.date
),
scored AS (
    SELECT b.*,
           -- Waking hours left once sleep, fixed commitments, and a 3h
           -- allowance for meals/commute/downtime are removed. An unlogged
           -- night assumes 8 hours.
           MAX(0.0, ROUND(24.0
                          - COALESCE(b.sleep_duration, 480) / 60.0
                          - b.committed_hours
                          - 3.0, 2)) AS available_study_hours
    FROM base b
)
SELECT
    student_id, date,
    sleep_duration, sleep_quality,
    social_media_minutes, total_screen_minutes,
    pending_tasks, high_priority_tasks, hours_until_nearest_deadline,
    available_study_hours,
    ROUND(study_hours, 2),
    energy_score,
    -- Productivity, 0-100: the share of available study time actually used,
    -- scaled by how focused those sessions were.
    CASE WHEN available_study_hours <= 0 THEN 0.0
         ELSE ROUND(100.0
                    * MIN(1.0, study_hours / available_study_hours)
                    * (avg_focus / 5.0), 2)
    END
FROM scored
-- SQLite cannot tell this ON CONFLICT from a join constraint unless the
-- SELECT has a WHERE clause, hence the no-op predicate.
WHERE true

ON CONFLICT (student_id, date) DO UPDATE SET
    sleep_duration               = excluded.sleep_duration,
    sleep_quality                = excluded.sleep_quality,
    social_media_minutes         = excluded.social_media_minutes,
    total_screen_minutes         = excluded.total_screen_minutes,
    pending_tasks                = excluded.pending_tasks,
    high_priority_tasks          = excluded.high_priority_tasks,
    hours_until_nearest_deadline = excluded.hours_until_nearest_deadline,
    available_study_hours        = excluded.available_study_hours,
    study_hours_completed        = excluded.study_hours_completed,
    energy_score                 = excluded.energy_score,
    productivity_score           = excluded.productivity_score;
