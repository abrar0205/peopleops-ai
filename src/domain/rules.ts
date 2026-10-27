/**
 * Data-quality rules. Each rule is a single SQL statement that writes the rows
 * it rejects into staging.reject. Rules run in order inside the pipeline
 * transaction, so later rules can see what earlier ones held back (e.g. time
 * rows of an employee whose HR record was quarantined).
 *
 * Blocking rules keep rows out of the core tables. Non-blocking rules load the
 * row and record an issue; TC_MISSING_PUNCHES is special: its rows load, but the
 * analytics layer excludes the whole day until a reviewer overrides the issue.
 */
export type Source = 'hris' | 'timeclock' | 'lms'

export interface QualityRule {
  code: string
  source: Source
  severity: 'ERROR' | 'WARNING'
  blocking: boolean
  title: string
  why: string
  /** What happens to affected rows, in plain words. */
  action: string
  sql: string
}

const AS_OF = `current_setting('peopleops.as_of')::date`
const notBlocked = (alias: string, source: Source) =>
  `NOT EXISTS (SELECT 1 FROM staging.reject r WHERE r.source = '${source}' AND r.row_no = ${alias}.row_no AND r.blocking)`

/** HR rows that will become employees. Used by the cascade rules. */
const LOADABLE_HRIS = `(SELECT h.* FROM staging.hris_employee h WHERE ${notBlocked('h', 'hris')})`

export const RULES: QualityRule[] = [
  // ------------------------------------------------------------- HR master data
  {
    code: 'HR_DUPLICATE_BADGE',
    source: 'hris',
    severity: 'WARNING',
    blocking: true,
    title: 'Duplicate badge ID',
    why: 'Two employment records for one badge double-count headcount and attach absences to the wrong department.',
    action: 'Latest export row kept, older rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'hris', h.row_no, 'HR_DUPLICATE_BADGE', h.badge_id,
       format('Badge %s appears %s times in the HR export; kept row %s (%s), held back row %s (%s)',
              h.badge_id, h.copies, h.keep_row, h.keep_dept, h.row_no, h.dept_code),
       true
FROM (
  SELECT h.*,
         count(*)  OVER (PARTITION BY badge_id) AS copies,
         max(row_no) OVER (PARTITION BY badge_id) AS keep_row,
         last_value(dept_code) OVER (PARTITION BY badge_id ORDER BY row_no
                                     ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS keep_dept
  FROM staging.hris_employee h
) h
WHERE h.copies > 1 AND h.row_no < h.keep_row`,
  },
  {
    code: 'HR_UNKNOWN_DEPARTMENT',
    source: 'hris',
    severity: 'ERROR',
    blocking: true,
    title: 'Unknown department code',
    why: 'Without a valid department the person cannot be counted in any department KPI.',
    action: 'Employee and dependent time/LMS rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'hris', h.row_no, 'HR_UNKNOWN_DEPARTMENT', h.badge_id,
       format('Department code "%s" for badge %s is not in the department master', h.dept_code, h.badge_id),
       true
FROM staging.hris_employee h
WHERE NOT EXISTS (SELECT 1 FROM public.department d WHERE d.code = h.dept_code)`,
  },
  {
    code: 'HR_EXIT_BEFORE_HIRE',
    source: 'hris',
    severity: 'ERROR',
    blocking: true,
    title: 'Exit date before hire date',
    why: 'Usually a typo in the year; it would create negative tenure and a phantom exit.',
    action: 'Employee and dependent time/LMS rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'hris', h.row_no, 'HR_EXIT_BEFORE_HIRE', h.badge_id,
       format('Badge %s: exit %s is before hire %s', h.badge_id, h.exit_date, h.hire_date),
       true
FROM staging.hris_employee h
WHERE h.exit_date < h.hire_date`,
  },
  {
    code: 'HR_SHIFT_MISSING',
    source: 'hris',
    severity: 'WARNING',
    blocking: false,
    title: 'No shift assignment',
    why: 'Shift-level KPIs would silently miss these people.',
    action: 'Loaded, reported under shift "Unassigned"',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'hris', h.row_no, 'HR_SHIFT_MISSING', h.badge_id,
       format('Badge %s has no shift assignment in the HR export', h.badge_id),
       false
FROM staging.hris_employee h
WHERE coalesce(h.shift, '') NOT IN ('E', 'L', 'N')
  AND ${notBlocked('h', 'hris')}`,
  },

  // ------------------------------------------------------------- time & attendance
  {
    code: 'TC_FUTURE_DATE',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Future-dated attendance',
    why: 'Planned shifts exported as if worked would inflate scheduled hours.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_FUTURE_DATE', t.work_date::text,
       format('%s rows dated %s, after the as-of date %s', count(*) OVER (PARTITION BY t.work_date), t.work_date, ${AS_OF}),
       true
FROM staging.timeclock_day t
WHERE t.work_date > ${AS_OF}`,
  },
  {
    code: 'TC_HOURS_OUT_OF_RANGE',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Implausible hours',
    why: 'Minutes exported as hours or sign errors distort overtime and absence rates.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_HOURS_OUT_OF_RANGE', t.badge_id || ' ' || t.work_date,
       format('Badge %s on %s: scheduled %s h, worked %s h, overtime %s h', t.badge_id, t.work_date, t.scheduled_hours, t.worked_hours, t.overtime_hours),
       true
FROM staging.timeclock_day t
WHERE t.scheduled_hours NOT BETWEEN 0 AND 12
   OR t.worked_hours NOT BETWEEN 0 AND 12
   OR t.overtime_hours NOT BETWEEN 0 AND 6`,
  },
  {
    code: 'TC_UNKNOWN_ABSENCE_CODE',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Unknown absence code',
    why: 'An unmapped code cannot be classified as planned or unplanned absence.',
    action: 'Rows held back until the code is mapped',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_UNKNOWN_ABSENCE_CODE', t.absence_code,
       format('%s rows use absence code "%s", which has no mapping', count(*) OVER (PARTITION BY t.absence_code), t.absence_code),
       true
FROM staging.timeclock_day t
WHERE t.absence_code IS NOT NULL
  AND t.absence_code NOT IN ('SICK', 'UNEXCUSED', 'VACATION')`,
  },
  {
    code: 'TC_ABSENCE_WITH_HOURS',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Absent and worked on the same day',
    why: 'Contradictory rows would count the day both as absence and as worked time.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_ABSENCE_WITH_HOURS', t.badge_id || ' ' || t.work_date,
       format('Badge %s on %s is coded %s but has %s worked hours', t.badge_id, t.work_date, t.absence_code, t.worked_hours),
       true
FROM staging.timeclock_day t
WHERE t.absence_code IN ('SICK', 'UNEXCUSED', 'VACATION')
  AND t.worked_hours > 0
  AND ${notBlocked('t', 'timeclock')}`,
  },
  {
    code: 'TC_UNKNOWN_BADGE',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Badge not in HR system',
    why: 'Usually contractors or visitor badges; they are not part of the employee population.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_UNKNOWN_BADGE', t.badge_id,
       format('%s time-clock rows for badge %s, which does not exist in the HR export', count(*) OVER (PARTITION BY t.badge_id), t.badge_id),
       true
FROM staging.timeclock_day t
WHERE NOT EXISTS (SELECT 1 FROM staging.hris_employee h WHERE h.badge_id = t.badge_id)`,
  },
  {
    code: 'TC_EMPLOYEE_HELD_BACK',
    source: 'timeclock',
    severity: 'WARNING',
    blocking: true,
    title: 'Employee record held back',
    why: 'Time rows wait until the HR record they belong to passes its own checks.',
    action: 'Rows wait for the HR record',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_EMPLOYEE_HELD_BACK', t.badge_id,
       format('%s time-clock rows for badge %s wait for its HR record, which failed an HR rule', count(*) OVER (PARTITION BY t.badge_id), t.badge_id),
       true
FROM staging.timeclock_day t
WHERE EXISTS (SELECT 1 FROM staging.hris_employee h WHERE h.badge_id = t.badge_id)
  AND NOT EXISTS (SELECT 1 FROM ${LOADABLE_HRIS} k WHERE k.badge_id = t.badge_id)`,
  },
  {
    code: 'TC_AFTER_EXIT',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: true,
    title: 'Attendance after exit date',
    why: 'Either the exit date or the badge assignment is wrong; both need HR follow-up.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_AFTER_EXIT', t.badge_id,
       format('%s rows for badge %s on or after its exit date %s', count(*) OVER (PARTITION BY t.badge_id), t.badge_id, k.exit_date),
       true
FROM staging.timeclock_day t
JOIN ${LOADABLE_HRIS} k ON k.badge_id = t.badge_id
WHERE k.exit_date IS NOT NULL AND t.work_date >= k.exit_date`,
  },
  {
    code: 'TC_DUPLICATE_ROW',
    source: 'timeclock',
    severity: 'WARNING',
    blocking: true,
    title: 'Same badge and day delivered twice',
    why: 'Re-sent batches would double-count hours.',
    action: 'Latest row kept, earlier copy held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_DUPLICATE_ROW', t.badge_id || ' ' || t.work_date,
       format('Badge %s on %s delivered %s times; kept row %s', t.badge_id, t.work_date, t.copies, t.keep_row),
       true
FROM (
  SELECT t.*, count(*) OVER w AS copies, max(row_no) OVER w AS keep_row
  FROM staging.timeclock_day t
  WINDOW w AS (PARTITION BY badge_id, work_date)
) t
WHERE t.copies > 1 AND t.row_no < t.keep_row
  AND ${notBlocked('t', 'timeclock')}`,
  },
  {
    code: 'TC_MISSING_PUNCHES',
    source: 'timeclock',
    severity: 'WARNING',
    blocking: false,
    title: 'Punch data missing for a whole day',
    why: 'A shift with no punches and no absence code counts as a no-show. When a delivery is incomplete, that turns into a fake plant-wide absence spike. Each day is compared with the same weekday over the previous four weeks.',
    action: 'Rows loaded, day excluded from KPIs until a reviewer overrides',
    sql: `WITH daily AS (
  SELECT t.work_date,
         count(*) AS n,
         count(*) FILTER (WHERE t.scheduled_hours > 0 AND t.worked_hours = 0 AND t.absence_code IS NULL) AS no_punch
  FROM staging.timeclock_day t
  WHERE t.work_date <= ${AS_OF}
    AND ${notBlocked('t', 'timeclock')}
  GROUP BY t.work_date
), checked AS (
  SELECT d.work_date, d.n, d.no_punch,
         (SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY p.no_punch::float8 / p.n)
          FROM daily p
          WHERE p.work_date IN (d.work_date - 7, d.work_date - 14, d.work_date - 21, d.work_date - 28)) AS usual_share
  FROM daily d
)
INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', t.row_no, 'TC_MISSING_PUNCHES', c.work_date::text,
       format('%s of %s scheduled shifts on %s have no punches and no absence code (%s%%); usually %s%% on a %s',
              c.no_punch, c.n, c.work_date, round(100.0 * c.no_punch / c.n),
              round((100 * coalesce(c.usual_share, 0))::numeric, 1), trim(to_char(c.work_date, 'Day'))),
       false
FROM checked c
JOIN staging.timeclock_day t ON t.work_date = c.work_date
WHERE c.no_punch::float8 / c.n > 0.05
  AND c.no_punch::float8 / c.n > 5 * coalesce(c.usual_share, 0)
  AND ${notBlocked('t', 'timeclock')}`,
  },
  {
    code: 'TC_FRESHNESS',
    source: 'timeclock',
    severity: 'ERROR',
    blocking: false,
    title: 'Stale time-clock delivery',
    why: 'Dashboards must say when they are showing old data instead of looking current.',
    action: 'Raises an issue if the latest day is more than 3 days old',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'timeclock', 0, 'TC_FRESHNESS', 'dataset',
       format('Latest time-clock day is %s, %s days before the as-of date', m.latest, ${AS_OF} - m.latest),
       false
FROM (SELECT max(work_date) AS latest FROM staging.timeclock_day WHERE work_date <= ${AS_OF}) m
WHERE m.latest IS NULL OR m.latest < ${AS_OF} - 3`,
  },

  // ------------------------------------------------------------- learning (LMS)
  {
    code: 'LMS_SCORE_OUT_OF_RANGE',
    source: 'lms',
    severity: 'ERROR',
    blocking: true,
    title: 'Assessment score outside 0-100',
    why: 'Mixed scoring scales would inflate training effectiveness.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'lms', l.row_no, 'LMS_SCORE_OUT_OF_RANGE', l.badge_id || ' ' || l.program_code,
       format('Badge %s, %s: pre %s / post %s', l.badge_id, l.program_code, coalesce(l.pre_score::text, '-'), coalesce(l.post_score::text, '-')),
       true
FROM staging.lms_assignment l
WHERE l.pre_score NOT BETWEEN 0 AND 100 OR l.post_score NOT BETWEEN 0 AND 100`,
  },
  {
    code: 'LMS_COMPLETED_BEFORE_ASSIGNED',
    source: 'lms',
    severity: 'ERROR',
    blocking: true,
    title: 'Completed before assigned',
    why: 'Breaks on-time completion and time-to-complete metrics.',
    action: 'Rows held back',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'lms', l.row_no, 'LMS_COMPLETED_BEFORE_ASSIGNED', l.badge_id || ' ' || l.program_code,
       format('Badge %s, %s: completed %s, assigned %s', l.badge_id, l.program_code, l.completed_on, l.assigned_on),
       true
FROM staging.lms_assignment l
WHERE l.completed_on < l.assigned_on
  AND ${notBlocked('l', 'lms')}`,
  },
  {
    code: 'LMS_UNKNOWN_PROGRAM',
    source: 'lms',
    severity: 'ERROR',
    blocking: true,
    title: 'Unknown training program',
    why: 'Retired or renamed programs need mapping before they count toward compliance.',
    action: 'Rows held back until the program is mapped',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'lms', l.row_no, 'LMS_UNKNOWN_PROGRAM', l.program_code,
       format('%s assignments reference program "%s", which is not in the program catalog', count(*) OVER (PARTITION BY l.program_code), l.program_code),
       true
FROM staging.lms_assignment l
WHERE NOT EXISTS (SELECT 1 FROM public.training_program p WHERE p.code = l.program_code)
  AND ${notBlocked('l', 'lms')}`,
  },
  {
    code: 'LMS_EMPLOYEE_HELD_BACK',
    source: 'lms',
    severity: 'WARNING',
    blocking: true,
    title: 'Employee record held back',
    why: 'Training rows wait until the HR record they belong to is loaded.',
    action: 'Rows wait for the HR record',
    sql: `INSERT INTO staging.reject (source, row_no, rule_code, source_key, detail, blocking)
SELECT 'lms', l.row_no, 'LMS_EMPLOYEE_HELD_BACK', l.badge_id,
       format('%s training rows for badge %s wait for its HR record', count(*) OVER (PARTITION BY l.badge_id), l.badge_id),
       true
FROM staging.lms_assignment l
WHERE NOT EXISTS (SELECT 1 FROM ${LOADABLE_HRIS} k WHERE k.badge_id = l.badge_id)
  AND ${notBlocked('l', 'lms')}`,
  },
]
