-- Analytics layer: the only surface dashboards, the insight assistant and the
-- SQL console can read.
--
-- Rules every view follows
--   1. Aggregates only. No view returns one row per employee.
--   2. Minimum group size: any row describing fewer than 10 people has its
--      measures set to NULL and suppressed = true. Small teams cannot be
--      singled out by slicing (e.g. "the 4 people on Quality night shift").
--   3. Data held back by an open quality issue never reaches a measure.
--
-- Read access is granted to the peopleops_analyst role only on this schema.
-- The API runs every dashboard query as that role inside a READ ONLY
-- transaction, so the same guarantees hold for the app and for the console.

CREATE SCHEMA IF NOT EXISTS analytics;
CREATE SCHEMA IF NOT EXISTS analytics_internal;

-- ---------------------------------------------------------------- helpers

CREATE FUNCTION analytics.min_group_size() RETURNS integer
    LANGUAGE sql IMMUTABLE AS 'SELECT 10';

CREATE FUNCTION analytics.latest_run_id() RETURNS integer
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT id FROM pipeline_run WHERE status = 'SUCCEEDED' ORDER BY id DESC LIMIT 1
$$;

-- The "today" of the dataset. Fixed per pipeline run so results are reproducible.
CREATE FUNCTION analytics.as_of() RETURNS date
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT as_of FROM pipeline_run WHERE id = analytics.latest_run_id()
$$;

-- Days whose punch data arrived incomplete, unless a reviewer overrode the issue.
CREATE VIEW analytics.excluded_day AS
SELECT qi.source_key::date AS work_date,
       qi.status::text     AS issue_status,
       qi.id               AS issue_id
FROM public.quality_issue qi
WHERE qi.run_id = analytics.latest_run_id()
  AND qi.rule_code = 'TC_MISSING_PUNCHES'
  AND qi.status <> 'OVERRIDDEN';

-- ------------------------------------------------------------- attendance

-- Overtime per head is normalised to a five-day week (overtime / scheduled
-- person-days x 5), so weeks with an excluded day stay comparable.
-- Weekly absence and overtime at four grains: department x shift,
-- department, shift and plant ('ALL'). Materialized because it scans every
-- attendance row; refreshed by analytics.refresh() after each pipeline run
-- and after every quality-issue review.
CREATE MATERIALIZED VIEW analytics.attendance_weekly AS
WITH base AS (
    SELECT date_trunc('week', a.work_date)::date AS week_start,
           d.code                                AS department_code,
           COALESCE(e.shift::text, 'UNASSIGNED') AS shift,
           a.employee_id,
           a.scheduled_hours,
           a.overtime_hours,
           a.absence_code
    FROM public.attendance_day a
    JOIN public.employee   e ON e.id = a.employee_id
    JOIN public.department d ON d.id = e.department_id
    WHERE a.work_date NOT IN (SELECT work_date FROM analytics.excluded_day)
), agg AS (
    SELECT week_start,
           CASE WHEN GROUPING(department_code) = 1 THEN 'ALL' ELSE department_code END AS department_code,
           CASE WHEN GROUPING(shift) = 1 THEN 'ALL' ELSE shift END                     AS shift,
           COUNT(DISTINCT employee_id)                                                 AS employees,
           COUNT(*)                                                                    AS person_days,
           SUM(scheduled_hours)                                                        AS scheduled_hours,
           COALESCE(SUM(scheduled_hours) FILTER (WHERE absence_code = 'VACATION'), 0)  AS planned_absence_hours,
           COALESCE(SUM(scheduled_hours) FILTER (WHERE absence_code IN ('SICK', 'UNEXCUSED')), 0) AS unplanned_absence_hours,
           SUM(overtime_hours)                                                         AS overtime_hours
    FROM base
    GROUP BY GROUPING SETS ((week_start, department_code, shift), (week_start, department_code), (week_start, shift), (week_start))
)
SELECT week_start,
       department_code,
       shift,
       employees::int                                   AS employees,
       employees < analytics.min_group_size()           AS suppressed,
       CASE WHEN employees >= analytics.min_group_size() THEN scheduled_hours::float8 END         AS scheduled_hours,
       CASE WHEN employees >= analytics.min_group_size() THEN planned_absence_hours::float8 END   AS planned_absence_hours,
       CASE WHEN employees >= analytics.min_group_size() THEN unplanned_absence_hours::float8 END AS unplanned_absence_hours,
       CASE WHEN employees >= analytics.min_group_size() THEN overtime_hours::float8 END          AS overtime_hours,
       CASE WHEN employees >= analytics.min_group_size() THEN person_days::int END                AS person_days,
       CASE WHEN employees >= analytics.min_group_size()
            THEN ROUND(100 * unplanned_absence_hours / NULLIF(scheduled_hours - planned_absence_hours, 0), 2)::float8
       END AS unplanned_absence_rate,
       CASE WHEN employees >= analytics.min_group_size()
            THEN ROUND(5 * overtime_hours / NULLIF(person_days, 0), 2)::float8
       END AS overtime_hours_per_head
FROM agg;

CREATE INDEX attendance_weekly_lookup ON analytics.attendance_weekly (department_code, shift, week_start);

-- Unplanned absence by weekday over the full attendance window.
CREATE VIEW analytics.absence_by_weekday AS
WITH base AS (
    SELECT EXTRACT(isodow FROM a.work_date)::int AS iso_weekday,
           d.code AS department_code,
           a.employee_id, a.scheduled_hours, a.absence_code
    FROM public.attendance_day a
    JOIN public.employee   e ON e.id = a.employee_id
    JOIN public.department d ON d.id = e.department_id
    WHERE a.work_date NOT IN (SELECT work_date FROM analytics.excluded_day)
), agg AS (
    SELECT iso_weekday,
           CASE WHEN GROUPING(department_code) = 1 THEN 'ALL' ELSE department_code END AS department_code,
           COUNT(DISTINCT employee_id) AS employees,
           SUM(scheduled_hours) AS scheduled,
           COALESCE(SUM(scheduled_hours) FILTER (WHERE absence_code = 'VACATION'), 0) AS planned,
           COALESCE(SUM(scheduled_hours) FILTER (WHERE absence_code IN ('SICK', 'UNEXCUSED')), 0) AS unplanned
    FROM base
    GROUP BY GROUPING SETS ((iso_weekday, department_code), (iso_weekday))
)
SELECT iso_weekday,
       department_code,
       employees::int AS employees,
       employees < analytics.min_group_size() AS suppressed,
       CASE WHEN employees >= analytics.min_group_size()
            THEN ROUND(100 * unplanned / NULLIF(scheduled - planned, 0), 2)::float8
       END AS unplanned_absence_rate
FROM agg;

-- -------------------------------------------------------------- workforce

-- One row per employee per month they were employed in (internal only).
CREATE VIEW analytics_internal.employee_month AS
WITH months AS (
    SELECT m::date AS month_start,
           LEAST((m + interval '1 month - 1 day')::date, analytics.as_of()) AS month_end
    FROM generate_series(date_trunc('month', analytics.as_of()) - interval '23 months',
                         date_trunc('month', analytics.as_of()),
                         interval '1 month') AS m
)
SELECT mo.month_start,
       mo.month_end,
       d.code AS department_code,
       COALESCE(e.shift::text, 'UNASSIGNED') AS shift,
       e.hire_date < mo.month_start AND (e.exit_date IS NULL OR e.exit_date >= mo.month_start) AS active_start,
       e.hire_date <= mo.month_end AND (e.exit_date IS NULL OR e.exit_date > mo.month_end)     AS active_end,
       e.hire_date BETWEEN mo.month_start AND mo.month_end                                     AS hired,
       COALESCE(e.exit_date BETWEEN mo.month_start AND mo.month_end, false)                    AS exited,
       e.exit_type
FROM months mo
JOIN public.employee   e ON e.hire_date <= mo.month_end AND (e.exit_date IS NULL OR e.exit_date >= mo.month_start)
JOIN public.department d ON d.id = e.department_id;

CREATE VIEW analytics_internal.workforce_monthly AS
SELECT month_start,
       CASE WHEN GROUPING(department_code) = 1 THEN 'ALL' ELSE department_code END AS department_code,
       CASE WHEN GROUPING(shift) = 1 THEN 'ALL' ELSE shift END                     AS shift,
       COUNT(*) FILTER (WHERE active_start)                              AS headcount_start,
       COUNT(*) FILTER (WHERE active_end)                                AS headcount_end,
       COUNT(*) FILTER (WHERE hired)                                     AS hires,
       COUNT(*) FILTER (WHERE exited)                                    AS exits,
       COUNT(*) FILTER (WHERE exited AND exit_type = 'VOLUNTARY')        AS voluntary_exits,
       COUNT(*) FILTER (WHERE exited AND exit_type = 'INVOLUNTARY')      AS involuntary_exits,
       COUNT(*) FILTER (WHERE exited AND exit_type = 'END_OF_CONTRACT')  AS contract_end_exits
FROM analytics_internal.employee_month
GROUP BY GROUPING SETS ((month_start, department_code, shift), (month_start, department_code), (month_start, shift), (month_start));

CREATE VIEW analytics.workforce_monthly AS
SELECT month_start,
       department_code,
       shift,
       headcount_end < analytics.min_group_size() AS suppressed,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN headcount_end::int END      AS headcount,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN hires::int END              AS hires,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN exits::int END              AS exits,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN voluntary_exits::int END    AS voluntary_exits,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN involuntary_exits::int END  AS involuntary_exits,
       CASE WHEN headcount_end >= analytics.min_group_size() THEN contract_end_exits::int END AS contract_end_exits
FROM analytics_internal.workforce_monthly;

-- Trailing-12-month attrition = exits in the window / average headcount in the window.
-- Average headcount per month is (start + end) / 2. Only months with a full
-- 12-month window are returned. The current month is month-to-date.
CREATE VIEW analytics.attrition_12m AS
WITH w AS (
    SELECT month_start, department_code, shift,
           SUM(exits)           OVER win AS exits_12m,
           SUM(voluntary_exits) OVER win AS voluntary_exits_12m,
           AVG((headcount_start + headcount_end) / 2.0) OVER win AS avg_headcount_12m,
           COUNT(*) OVER win AS months_in_window
    FROM analytics_internal.workforce_monthly
    WINDOW win AS (PARTITION BY department_code, shift ORDER BY month_start ROWS BETWEEN 11 PRECEDING AND CURRENT ROW)
)
SELECT month_start,
       department_code,
       shift,
       avg_headcount_12m < analytics.min_group_size() AS suppressed,
       CASE WHEN avg_headcount_12m >= analytics.min_group_size() THEN ROUND(avg_headcount_12m, 1)::float8 END AS avg_headcount_12m,
       CASE WHEN avg_headcount_12m >= analytics.min_group_size() THEN exits_12m::int END AS exits_12m,
       CASE WHEN avg_headcount_12m >= analytics.min_group_size()
            THEN ROUND(100 * exits_12m / NULLIF(avg_headcount_12m, 0), 2)::float8 END AS attrition_rate,
       CASE WHEN avg_headcount_12m >= analytics.min_group_size()
            THEN ROUND(100 * voluntary_exits_12m / NULLIF(avg_headcount_12m, 0), 2)::float8 END AS voluntary_attrition_rate
FROM w
WHERE months_in_window = 12;

-- 90-day attrition of new hires: share of people hired 90-365 days before
-- as-of who left within their first 90 days. Leading indicator for onboarding.
CREATE VIEW analytics.early_attrition AS
WITH cohort AS (
    SELECT d.code AS department_code,
           COALESCE(e.shift::text, 'UNASSIGNED') AS shift,
           (e.exit_date IS NOT NULL AND e.exit_date < e.hire_date + 90) AS left_early
    FROM public.employee e
    JOIN public.department d ON d.id = e.department_id
    WHERE e.hire_date BETWEEN analytics.as_of() - 365 AND analytics.as_of() - 90
), agg AS (
    SELECT CASE WHEN GROUPING(department_code) = 1 THEN 'ALL' ELSE department_code END AS department_code,
           CASE WHEN GROUPING(shift) = 1 THEN 'ALL' ELSE shift END                     AS shift,
           COUNT(*) AS hires,
           COUNT(*) FILTER (WHERE left_early) AS early_exits
    FROM cohort
    GROUP BY GROUPING SETS ((department_code, shift), (department_code), (shift), ())
)
SELECT department_code,
       shift,
       hires::int AS hires,
       hires < analytics.min_group_size() AS suppressed,
       CASE WHEN hires >= analytics.min_group_size() THEN early_exits::int END AS early_exits,
       CASE WHEN hires >= analytics.min_group_size()
            THEN ROUND(100.0 * early_exits / hires, 2)::float8 END AS early_attrition_rate
FROM agg;

-- --------------------------------------------------------------- training

-- Completion tells you people clicked through; uplift tells you they learned.
CREATE VIEW analytics.training_program_stats AS
WITH a AS (
    SELECT p.code, p.name, p.category, p.mandatory, p.pass_score,
           t.due_on, t.completed_on, t.pre_score, t.post_score,
           d.code AS department_code
    FROM public.training_assignment t
    JOIN public.training_program p ON p.id = t.program_id
    JOIN public.employee e ON e.id = t.employee_id
    JOIN public.department d ON d.id = e.department_id
    WHERE t.due_on <= analytics.as_of()
), agg AS (
    SELECT code, name, category, mandatory,
           CASE WHEN GROUPING(department_code) = 1 THEN 'ALL' ELSE department_code END AS department_code,
           COUNT(*) AS assignments_due,
           COUNT(*) FILTER (WHERE completed_on IS NOT NULL AND completed_on <= due_on) AS completed_on_time,
           COUNT(*) FILTER (WHERE completed_on IS NULL) AS overdue,
           COUNT(*) FILTER (WHERE pre_score IS NOT NULL AND post_score IS NOT NULL) AS scored,
           AVG(post_score - pre_score) FILTER (WHERE pre_score IS NOT NULL AND post_score IS NOT NULL) AS avg_uplift,
           AVG((post_score >= pass_score)::int) FILTER (WHERE post_score IS NOT NULL) AS pass_share
    FROM a
    GROUP BY GROUPING SETS ((code, name, category, mandatory, department_code), (code, name, category, mandatory))
)
SELECT code AS program_code,
       name AS program_name,
       category,
       mandatory,
       department_code,
       assignments_due::int AS assignments_due,
       assignments_due < analytics.min_group_size() AS suppressed,
       CASE WHEN assignments_due >= analytics.min_group_size() THEN completed_on_time::int END AS completed_on_time,
       CASE WHEN assignments_due >= analytics.min_group_size() THEN overdue::int END AS overdue,
       CASE WHEN assignments_due >= analytics.min_group_size()
            THEN ROUND(100.0 * completed_on_time / assignments_due, 2)::float8 END AS on_time_completion_rate,
       CASE WHEN assignments_due >= analytics.min_group_size()
            THEN ROUND(100.0 * overdue / assignments_due, 2)::float8 END AS overdue_rate,
       CASE WHEN scored >= analytics.min_group_size() THEN ROUND(avg_uplift, 2)::float8 END AS avg_score_uplift,
       CASE WHEN scored >= analytics.min_group_size() THEN ROUND(100 * pass_share, 2)::float8 END AS pass_rate,
       scored::int AS scored_assignments
FROM agg;

-- ---------------------------------------------------------- data quality

CREATE VIEW analytics.quality_rule_summary AS
SELECT qi.rule_code,
       qi.source,
       qi.severity::text AS severity,
       qi.status::text   AS status,
       COUNT(*)::int     AS issues,
       SUM(qi.row_count)::int AS affected_rows
FROM public.quality_issue qi
WHERE qi.run_id = analytics.latest_run_id()
GROUP BY 1, 2, 3, 4;

-- Share of delivered rows per source that currently reach KPIs.
CREATE VIEW analytics.data_health AS
WITH src AS (
    SELECT s.key AS source,
           (s.value ->> 'received')::int AS received,
           (s.value ->> 'loaded')::int   AS loaded
    FROM public.pipeline_run r, jsonb_each(r.stats -> 'sources') s
    WHERE r.id = analytics.latest_run_id()
), excluded AS (
    SELECT COUNT(*)::int AS n
    FROM public.attendance_day
    WHERE work_date IN (SELECT work_date FROM analytics.excluded_day)
)
SELECT src.source,
       src.received,
       src.loaded - CASE WHEN src.source = 'timeclock' THEN excluded.n ELSE 0 END AS usable,
       src.received - src.loaded + CASE WHEN src.source = 'timeclock' THEN excluded.n ELSE 0 END AS held_back,
       ROUND(100.0 * (src.loaded - CASE WHEN src.source = 'timeclock' THEN excluded.n ELSE 0 END) / NULLIF(src.received, 0), 2)::float8 AS health_pct
FROM src, excluded;

-- What an excluded day would do to that week's plant-level unplanned absence.
-- Reads core rows with the owner's rights but returns two plant-wide numbers only.
CREATE FUNCTION analytics.exclusion_impact(day date)
    RETURNS TABLE (included boolean, unplanned_absence_rate float8)
    LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    WITH week AS (
        SELECT a.work_date, a.scheduled_hours, a.absence_code
        FROM attendance_day a
        WHERE a.work_date >= date_trunc('week', day)::date
          AND a.work_date <  date_trunc('week', day)::date + 7
    )
    SELECT w.included,
           round((100 * sum(w.scheduled_hours) FILTER (WHERE w.absence_code IN ('SICK', 'UNEXCUSED'))
                  / sum(w.scheduled_hours) FILTER (WHERE w.absence_code IS DISTINCT FROM 'VACATION'))::numeric, 2)::float8
    FROM (SELECT week.*, true AS included FROM week
          UNION ALL
          SELECT week.*, false FROM week WHERE week.work_date <> day) w
    GROUP BY w.included
$$;

-- ------------------------------------------------------------- refresh

CREATE FUNCTION analytics.refresh() RETURNS void
    LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
    REFRESH MATERIALIZED VIEW analytics.attendance_weekly;
$$;

-- --------------------------------------------------------------- access

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'peopleops_analyst') THEN
        CREATE ROLE peopleops_analyst NOLOGIN;
    END IF;
END
$$;

GRANT USAGE ON SCHEMA analytics TO peopleops_analyst;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO peopleops_analyst;
GRANT EXECUTE ON FUNCTION analytics.as_of(), analytics.latest_run_id(), analytics.min_group_size(), analytics.exclusion_impact(date) TO peopleops_analyst;
REVOKE EXECUTE ON FUNCTION analytics.refresh() FROM PUBLIC;
