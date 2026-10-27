/**
 * Analytics queries. Each function returns data plus the evidence (exact SQL
 * and rows) that produced it, so every number in the UI can be traced.
 *
 * Inputs are validated with zod at the router and passed as bind parameters;
 * the only interpolated fragments are grain filters chosen from fixed strings.
 */
import { z } from 'zod'
import type { ApiContext, Evidence } from './context'
import { DEPARTMENTS } from '../domain/scenario'

export const DepartmentCode = z.enum(['ALL', ...DEPARTMENTS.map(d => d.code)] as [string, ...string[]])
export const ShiftCode = z.enum(['ALL', 'EARLY', 'LATE', 'NIGHT', 'UNASSIGNED'])
export const GroupBy = z.enum(['department', 'shift', 'department_shift'])
export type GroupBy = z.infer<typeof GroupBy>

export const departmentName = (code: string) => (code === 'ALL' ? 'Plant' : DEPARTMENTS.find(d => d.code === code)?.name ?? code)
export const shiftName = (code: string) => (code === 'ALL' ? 'all shifts' : code === 'UNASSIGNED' ? 'unassigned shift' : `${code.toLowerCase()} shift`)
export const groupLabel = (dept: string, shift: string) =>
  shift === 'ALL' ? departmentName(dept) : dept === 'ALL' ? shiftName(shift)[0].toUpperCase() + shiftName(shift).slice(1) : `${departmentName(dept)} · ${shiftName(shift)}`

const grain = (by: GroupBy) =>
  by === 'department' ? `department_code <> 'ALL' AND shift = 'ALL'`
  : by === 'shift' ? `department_code = 'ALL' AND shift <> 'ALL'`
  : `department_code <> 'ALL' AND shift <> 'ALL'`

// ------------------------------------------------------------------ KPI tiles

export interface KpiTile {
  id: string
  label: string
  value: number | null
  previous: number | null
  unit: '%' | 'h' | 'people' | 'pts'
  /** Whether an increase is good, bad or neutral. */
  goodDirection: 'up' | 'down' | 'none'
  comparison: string
  spark: number[]
  evidence: Evidence
}

export async function kpiSummary(ctx: ApiContext): Promise<KpiTile[]> {
  const [weekly, absence, workforce, attrition, training, health] = await Promise.all([
    ctx.analytics<{ week_start: string; unplanned_absence_rate: number; overtime_hours_per_head: number }>(`
      SELECT week_start::text, unplanned_absence_rate, overtime_hours_per_head
      FROM attendance_weekly
      WHERE department_code = 'ALL' AND shift = 'ALL'
      ORDER BY week_start`),
    ctx.analytics<{ period: string; unplanned_absence_rate: number; overtime_hours_per_head: number }>(`
      -- Last 4 complete weeks vs. the 4 weeks before
      WITH w AS (
        SELECT *, dense_rank() OVER (ORDER BY week_start DESC) AS recency
        FROM attendance_weekly
        WHERE department_code = 'ALL' AND shift = 'ALL'
      )
      SELECT CASE WHEN recency <= 4 THEN 'current' ELSE 'previous' END AS period,
             round((100 * sum(unplanned_absence_hours)
                    / sum(scheduled_hours - planned_absence_hours))::numeric, 2)::float8 AS unplanned_absence_rate,
             round((5 * sum(overtime_hours) / sum(person_days))::numeric, 2)::float8 AS overtime_hours_per_head
      FROM w
      WHERE recency <= 8
      GROUP BY 1`),
    ctx.analytics<{ month_start: string; headcount: number }>(`
      SELECT month_start::text, headcount
      FROM workforce_monthly
      WHERE department_code = 'ALL' AND shift = 'ALL'
      ORDER BY month_start DESC
      LIMIT 12`),
    ctx.analytics<{ month_start: string; attrition_rate: number }>(`
      SELECT month_start::text, attrition_rate
      FROM attrition_12m
      WHERE department_code = 'ALL' AND shift = 'ALL'
      ORDER BY month_start`),
    ctx.analytics<{ on_time_rate: number; overdue: number }>(`
      SELECT round(100.0 * sum(completed_on_time) / sum(assignments_due), 2)::float8 AS on_time_rate,
             sum(overdue)::int AS overdue
      FROM training_program_stats
      WHERE department_code = 'ALL' AND mandatory`),
    ctx.analytics<{ health_pct: number; held_back: number }>(`
      SELECT round(100.0 * sum(usable) / sum(received), 2)::float8 AS health_pct,
             sum(held_back)::int AS held_back
      FROM data_health`),
  ])
  const cur = absence.rows.find(r => r.period === 'current')
  const prev = absence.rows.find(r => r.period === 'previous')
  const hc = [...workforce.rows].reverse()
  const att = attrition.rows
  return [
    {
      id: 'headcount', label: 'Headcount', unit: 'people', goodDirection: 'none',
      value: hc.at(-1)?.headcount ?? null, previous: hc.at(-2)?.headcount ?? null,
      comparison: 'vs. previous month end', spark: hc.map(r => r.headcount), evidence: workforce,
    },
    {
      id: 'unplanned_absence', label: 'Unplanned absence', unit: '%', goodDirection: 'down',
      value: cur?.unplanned_absence_rate ?? null, previous: prev?.unplanned_absence_rate ?? null,
      comparison: 'last 4 weeks vs. 4 weeks before', spark: weekly.rows.map(r => r.unplanned_absence_rate), evidence: absence,
    },
    {
      id: 'overtime', label: 'Overtime per head', unit: 'h', goodDirection: 'down',
      value: cur?.overtime_hours_per_head ?? null, previous: prev?.overtime_hours_per_head ?? null,
      comparison: 'hours per week, last 4 weeks', spark: weekly.rows.map(r => r.overtime_hours_per_head), evidence: absence,
    },
    {
      id: 'attrition', label: 'Attrition, trailing 12m', unit: '%', goodDirection: 'down',
      value: att.at(-1)?.attrition_rate ?? null, previous: att.at(-4)?.attrition_rate ?? null,
      comparison: 'vs. three months ago', spark: att.map(r => r.attrition_rate), evidence: attrition,
    },
    {
      id: 'training_on_time', label: 'Mandatory training on time', unit: '%', goodDirection: 'up',
      value: training.rows[0]?.on_time_rate ?? null, previous: null,
      comparison: `${training.rows[0]?.overdue ?? 0} assignments overdue`, spark: [], evidence: training,
    },
    {
      id: 'data_health', label: 'Data reaching KPIs', unit: '%', goodDirection: 'up',
      value: health.rows[0]?.health_pct ?? null, previous: null,
      comparison: `${(health.rows[0]?.held_back ?? 0).toLocaleString('en-US')} source rows held back`, spark: [], evidence: health,
    },
  ]
}

// ------------------------------------------------------------- attendance

export function attendanceWeekly(ctx: ApiContext, department: string, shift: string) {
  return ctx.analytics<{ week_start: string; unplanned_absence_rate: number | null; overtime_hours_per_head: number | null; employees: number; suppressed: boolean }>(`
    SELECT week_start::text, unplanned_absence_rate, overtime_hours_per_head, employees, suppressed
    FROM attendance_weekly
    WHERE department_code = $1 AND shift = $2
    ORDER BY week_start`, [department, shift])
}

export type AttendanceMetric = 'unplanned_absence' | 'overtime'

/** Absence or overtime per group over the last N complete weeks. */
export function attendanceByGroup(ctx: ApiContext, by: GroupBy, weeks: number) {
  return ctx.analytics<{ department_code: string; shift: string; employees: number; suppressed: boolean; unplanned_absence_rate: number | null; overtime_hours_per_head: number | null }>(`
    SELECT department_code,
           shift,
           max(employees) AS employees,
           bool_or(suppressed) AS suppressed,
           -- A group suppressed in any week stays suppressed for the whole window.
           CASE WHEN NOT bool_or(suppressed) THEN
             round((100 * sum(unplanned_absence_hours)
                    / sum(scheduled_hours - planned_absence_hours))::numeric, 2)::float8
           END AS unplanned_absence_rate,
           CASE WHEN NOT bool_or(suppressed) THEN
             round((5 * sum(overtime_hours) / sum(person_days))::numeric, 2)::float8
           END AS overtime_hours_per_head
    FROM attendance_weekly
    WHERE week_start > (SELECT max(week_start) FROM attendance_weekly) - 7 * $1::int
      AND ((${grain(by)}) OR (department_code = 'ALL' AND shift = 'ALL'))
    GROUP BY department_code, shift
    ORDER BY department_code, shift`, [weeks])
}

export function absenceByWeekday(ctx: ApiContext, department: string) {
  return ctx.analytics<{ iso_weekday: number; unplanned_absence_rate: number | null; suppressed: boolean }>(`
    SELECT iso_weekday, unplanned_absence_rate, suppressed
    FROM absence_by_weekday
    WHERE department_code = $1
    ORDER BY iso_weekday`, [department])
}

// -------------------------------------------------------------- workforce

export function attritionTrend(ctx: ApiContext, department: string, shift: string) {
  return ctx.analytics<{ month_start: string; attrition_rate: number | null; voluntary_attrition_rate: number | null; exits_12m: number | null; avg_headcount_12m: number | null; suppressed: boolean }>(`
    SELECT month_start::text, attrition_rate, voluntary_attrition_rate, exits_12m, avg_headcount_12m, suppressed
    FROM attrition_12m
    WHERE department_code = $1 AND shift = $2
    ORDER BY month_start`, [department, shift])
}

export function attritionByGroup(ctx: ApiContext, by: GroupBy) {
  return ctx.analytics<{ department_code: string; shift: string; attrition_rate: number | null; voluntary_attrition_rate: number | null; exits_12m: number | null; avg_headcount_12m: number | null; suppressed: boolean }>(`
    SELECT department_code, shift, attrition_rate, voluntary_attrition_rate, exits_12m, avg_headcount_12m, suppressed
    FROM attrition_12m
    WHERE month_start = (SELECT max(month_start) FROM attrition_12m)
      AND ((${grain(by)}) OR (department_code = 'ALL' AND shift = 'ALL'))
    ORDER BY department_code, shift`)
}

/** Why people left over the last 12 months, by department. */
export function exitComposition(ctx: ApiContext) {
  return ctx.analytics<{ department_code: string; exits: number; voluntary: number; involuntary: number; contract_end: number }>(`
    SELECT department_code,
           sum(exits)::int              AS exits,
           sum(voluntary_exits)::int    AS voluntary,
           sum(involuntary_exits)::int  AS involuntary,
           sum(contract_end_exits)::int AS contract_end
    FROM workforce_monthly
    WHERE shift = 'ALL' AND department_code <> 'ALL'
      AND month_start > (SELECT max(month_start) FROM workforce_monthly) - interval '12 months'
    GROUP BY department_code
    ORDER BY department_code`)
}

export function earlyAttrition(ctx: ApiContext, by: GroupBy) {
  return ctx.analytics<{ department_code: string; shift: string; hires: number; early_exits: number | null; early_attrition_rate: number | null; suppressed: boolean }>(`
    SELECT department_code, shift, hires, early_exits, early_attrition_rate, suppressed
    FROM early_attrition
    WHERE (${grain(by)}) OR (department_code = 'ALL' AND shift = 'ALL')
    ORDER BY department_code, shift`)
}

export function headcountTrend(ctx: ApiContext, department: string) {
  return ctx.analytics<{ month_start: string; headcount: number | null; hires: number | null; exits: number | null }>(`
    SELECT month_start::text, headcount, hires, exits
    FROM workforce_monthly
    WHERE department_code = $1 AND shift = 'ALL'
    ORDER BY month_start`, [department])
}

// --------------------------------------------------------------- training

export function trainingPrograms(ctx: ApiContext) {
  return ctx.analytics<{ program_code: string; program_name: string; category: string; mandatory: boolean; assignments_due: number; on_time_completion_rate: number | null; overdue: number | null; overdue_rate: number | null; avg_score_uplift: number | null; pass_rate: number | null; scored_assignments: number }>(`
    SELECT program_code, program_name, category, mandatory, assignments_due,
           on_time_completion_rate, overdue, overdue_rate, avg_score_uplift, pass_rate, scored_assignments
    FROM training_program_stats
    WHERE department_code = 'ALL'
    ORDER BY program_code`)
}

export function mandatoryOverdueByDepartment(ctx: ApiContext) {
  return ctx.analytics<{ department_code: string; assignments_due: number; overdue: number; overdue_rate: number; on_time_rate: number }>(`
    SELECT department_code,
           sum(assignments_due)::int AS assignments_due,
           sum(overdue)::int AS overdue,
           round(100.0 * sum(overdue) / sum(assignments_due), 2)::float8 AS overdue_rate,
           round(100.0 * sum(completed_on_time) / sum(assignments_due), 2)::float8 AS on_time_rate
    FROM training_program_stats
    WHERE mandatory AND NOT suppressed AND department_code <> 'ALL'
    GROUP BY department_code
    ORDER BY overdue_rate DESC`)
}

// ----------------------------------------------------------- data quality

export function dataHealth(ctx: ApiContext) {
  return ctx.analytics<{ source: string; received: number; usable: number; held_back: number; health_pct: number }>(`
    SELECT source, received, usable, held_back, health_pct
    FROM data_health
    ORDER BY source`)
}

export function qualityRuleSummary(ctx: ApiContext) {
  return ctx.analytics<{ rule_code: string; source: string; severity: string; status: string; issues: number; affected_rows: number }>(`
    SELECT rule_code, source, severity, status, issues, affected_rows
    FROM quality_rule_summary
    ORDER BY rule_code, status`)
}

export function excludedDays(ctx: ApiContext) {
  return ctx.analytics<{ work_date: string; issue_status: string; issue_id: number }>(`
    SELECT work_date::text, issue_status, issue_id FROM excluded_day ORDER BY work_date`)
}
