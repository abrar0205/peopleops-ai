import type { ApiContext } from './context'

export const ROW_LIMIT = 500

export interface ConsoleResult {
  ok: boolean
  columns: string[]
  rows: Record<string, unknown>[]
  truncated: boolean
  ms: number
  error?: string
}

/**
 * Read-only SQL console over the analytics schema.
 *
 * Safety does not depend on parsing the SQL: queries run as the analyst role
 * (SELECT on analytics views only) inside a READ ONLY transaction. The checks
 * here only give friendlier errors and cap the result size.
 */
export async function runConsoleQuery(ctx: ApiContext, input: string): Promise<ConsoleResult> {
  const sql = input.trim().replace(/;\s*$/, '')
  const fail = (error: string): ConsoleResult => ({ ok: false, columns: [], rows: [], truncated: false, ms: 0, error })
  if (!sql) return fail('Write a query first.')
  if (sql.includes(';')) return fail('One statement at a time, please.')
  if (!/^(select|with|table|values)\b/i.test(sql)) return fail('The console is read-only: start with SELECT or WITH.')
  try {
    const r = await ctx.analytics(`SELECT * FROM (\n${sql}\n) AS console_query LIMIT ${ROW_LIMIT + 1}`)
    const truncated = r.rows.length > ROW_LIMIT
    const rows = r.rows.slice(0, ROW_LIMIT)
    return { ok: true, columns: rows[0] ? Object.keys(rows[0]) : [], rows, truncated, ms: r.ms }
  } catch (e) {
    return fail(cleanDbError(e))
  }
}

/** Prisma wraps database errors in a long message; keep the Postgres part. */
export function cleanDbError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = msg.match(/Message: `([\s\S]*?)`/)
  const text = (m ? m[1] : msg).replace(/\s+/g, ' ').trim()
  if (/permission denied/i.test(text)) return `${text}. The console can only read views in the analytics schema.`
  return text
}

export const EXAMPLE_QUERIES = [
  {
    title: 'Unplanned absence by shift, last 4 weeks',
    sql: `SELECT shift,
       round((100 * sum(unplanned_absence_hours)
              / sum(scheduled_hours - planned_absence_hours))::numeric, 2) AS unplanned_absence_pct
FROM attendance_weekly
WHERE department_code = 'ALL' AND shift <> 'ALL'
  AND week_start > (SELECT max(week_start) FROM attendance_weekly) - 28
GROUP BY shift
ORDER BY unplanned_absence_pct DESC`,
  },
  {
    title: 'Training: completion vs. learning',
    sql: `SELECT program_name, on_time_completion_rate, avg_score_uplift, pass_rate
FROM training_program_stats
WHERE department_code = 'ALL'
ORDER BY avg_score_uplift`,
  },
  {
    title: 'Attrition by department (trailing 12 months)',
    sql: `SELECT department_code, attrition_rate, voluntary_attrition_rate, exits_12m
FROM attrition_12m
WHERE shift = 'ALL'
  AND month_start = (SELECT max(month_start) FROM attrition_12m)
ORDER BY attrition_rate DESC`,
  },
  {
    title: 'Which cells are suppressed (< 10 people)?',
    sql: `SELECT DISTINCT department_code, shift, employees
FROM attendance_weekly
WHERE suppressed
ORDER BY employees`,
  },
  {
    title: 'Try to read raw employee rows (blocked)',
    sql: `SELECT * FROM public.employee LIMIT 5`,
  },
]
