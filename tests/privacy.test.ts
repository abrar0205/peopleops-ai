import { beforeAll, describe, expect, it } from 'vitest'
import { createStack, type Stack } from './setup'
import { MIN_GROUP_SIZE } from '../src/domain/scenario'

let s: Stack
beforeAll(async () => {
  s = await createStack()
})

describe('analyst role', () => {
  it.each(['public.employee', 'public.attendance_day', 'staging.hris_employee', 'staging.reject', 'public.quality_issue'])('cannot read %s', async table => {
    await expect(s.ctx.analytics(`SELECT * FROM ${table} LIMIT 1`)).rejects.toThrow(/permission denied/)
  })

  it('cannot write, even to its own schema', async () => {
    await expect(s.ctx.analytics(`DELETE FROM analytics.attendance_weekly`)).rejects.toThrow()
    await expect(s.ctx.analytics(`CREATE TABLE analytics.x (a int)`)).rejects.toThrow()
  })
})

describe('minimum group size', () => {
  const views: [string, string, string[]][] = [
    ['attendance_weekly', 'employees', ['unplanned_absence_rate', 'overtime_hours_per_head', 'scheduled_hours']],
    ['absence_by_weekday', 'employees', ['unplanned_absence_rate']],
    ['early_attrition', 'hires', ['early_exits', 'early_attrition_rate']],
    ['training_program_stats', 'assignments_due', ['overdue', 'on_time_completion_rate']],
  ]
  it.each(views)('%s nulls every measure for groups under 10', async (view, n, measures) => {
    const r = await s.ctx.analytics<Record<string, unknown>>(`SELECT * FROM ${view} WHERE ${n} < ${MIN_GROUP_SIZE}`)
    for (const row of r.rows) {
      expect(row.suppressed).toBe(true)
      for (const m of measures) expect(row[m], `${view}.${m}`).toBeNull()
    }
  })

  it('suppresses the small Quality night shift', async () => {
    const r = await s.api.attendance.byGroup({ by: 'department_shift', weeks: 4 })
    const cell = r.rows.find(x => x.department_code === 'QLT' && x.shift === 'NIGHT')!
    expect(cell.suppressed).toBe(true)
    expect(cell.unplanned_absence_rate).toBeNull()
  })

  it('workforce and attrition views suppress small groups too', async () => {
    const w = await s.ctx.analytics<{ headcount: number | null; suppressed: boolean }>(`SELECT headcount, suppressed FROM workforce_monthly WHERE suppressed`)
    expect(w.rows.length).toBeGreaterThan(0)
    expect(w.rows.every(r => r.headcount === null)).toBe(true)
  })
})

describe('SQL console', () => {
  it('runs read-only queries over analytics', async () => {
    const r = await s.api.sql.run({ sql: 'SELECT count(*) AS n FROM attendance_weekly' })
    expect(r.ok).toBe(true)
  })
  it('explains the permission boundary', async () => {
    const r = await s.api.sql.run({ sql: 'SELECT * FROM public.employee' })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/permission denied/)
  })
  it('rejects writes and multiple statements', async () => {
    expect((await s.api.sql.run({ sql: 'DROP VIEW analytics.data_health' })).ok).toBe(false)
    expect((await s.api.sql.run({ sql: 'SELECT 1; SELECT 2' })).ok).toBe(false)
  })
})

describe('assistant', () => {
  it.each(['Which employees are likely to quit?', 'Who was absent most on night shift?', 'List the people in Logistics with the most sick days', 'Give me the badge IDs of new hires who left'])(
    'declines individual-level question: %s',
    async question => {
      const a = await s.api.insights.ask({ question })
      expect(a.kind).toBe('refusal')
      expect(a.tools).toHaveLength(0)
    },
  )
})
