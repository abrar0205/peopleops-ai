import { beforeAll, describe, expect, it } from 'vitest'
import { createStack, type Stack } from './setup'

let s: Stack
beforeAll(async () => {
  s = await createStack()
})

describe('signal detection', () => {
  it('finds the planted patterns and nothing else', async () => {
    const signals = await s.api.insights.signals()
    const actionable = signals.filter(x => x.severity !== 'info').map(x => x.id).sort()
    expect(actionable).toEqual(
      [
        'unplanned_absence_rate:LOG|NIGHT',
        'overtime_hours_per_head:LOG|NIGHT',
        'early:LOG|NIGHT',
        'overdue:MNT',
        'effectiveness:FLR',
      ].sort(),
    )
    const info = signals.filter(x => x.severity === 'info').map(x => x.id)
    expect(info).toContain('contract-end:CEL')
    expect(info).toContain('excluded:2026-10-14')
  })

  it('attaches evidence to every signal', async () => {
    for (const sig of await s.api.insights.signals()) {
      expect(sig.evidence.length).toBeGreaterThan(0)
      expect(sig.evidence[0].sql).toMatch(/SELECT/i)
    }
  })
})

describe('metric correctness (recomputed from core tables)', () => {
  it('weekly unplanned absence matches a direct calculation', async () => {
    const view = await s.api.attendance.weekly({ department: 'LOG', shift: 'NIGHT' })
    const week = view.rows.at(-1)!
    const [{ rate }] = (
      await s.pg.query<{ rate: number }>(
        `SELECT round((100 * sum(a.scheduled_hours) FILTER (WHERE absence_code IN ('SICK','UNEXCUSED'))
                / sum(a.scheduled_hours) FILTER (WHERE absence_code IS DISTINCT FROM 'VACATION'))::numeric, 2)::float8 AS rate
         FROM attendance_day a JOIN employee e ON e.id = a.employee_id JOIN department d ON d.id = e.department_id
         WHERE d.code = 'LOG' AND e.shift = 'NIGHT' AND a.work_date >= $1::date AND a.work_date < $1::date + 7
           AND a.work_date NOT IN (SELECT work_date FROM analytics.excluded_day)`,
        [week.week_start],
      )
    ).rows
    expect(week.unplanned_absence_rate).toBe(rate)
  })

  it('trailing-12-month attrition matches a direct calculation', async () => {
    const view = await s.api.workforce.attritionTrend({ department: 'ALL', shift: 'ALL' })
    const last = view.rows.at(-1)!
    const emp = (await s.pg.query<{ hire_date: string; exit_date: string | null }>(`SELECT hire_date::text, exit_date::text FROM employee`)).rows
    const asOf = '2026-10-25'
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(2026, 9 - i, 1))
      months.push(d.toISOString().slice(0, 10))
    }
    let exits = 0
    let hcSum = 0
    for (const m of months) {
      const start = m
      const endD = new Date(Date.parse(m) + 0)
      endD.setUTCMonth(endD.getUTCMonth() + 1)
      endD.setUTCDate(0)
      const end = endD.toISOString().slice(0, 10) < asOf ? endD.toISOString().slice(0, 10) : asOf
      const atStart = emp.filter(e => e.hire_date < start && (!e.exit_date || e.exit_date >= start)).length
      const atEnd = emp.filter(e => e.hire_date <= end && (!e.exit_date || e.exit_date > end)).length
      exits += emp.filter(e => e.exit_date && e.exit_date >= start && e.exit_date <= end).length
      hcSum += (atStart + atEnd) / 2
    }
    expect(last.attrition_rate).toBeCloseTo((100 * exits) / (hcSum / 12), 1)
  })
})

describe('quality review', () => {
  it('overriding the excluded day changes KPIs, and reopening restores them', async () => {
    const issue = (await s.api.quality.issues({ ruleCode: 'TC_MISSING_PUNCHES', take: 1 })).items[0]
    const before = (await s.api.attendance.weekly({ department: 'ALL', shift: 'ALL' })).rows.find(r => r.week_start === '2026-10-12')!
    await s.api.quality.review({ id: issue.id, status: 'OVERRIDDEN', note: 'test' })
    const during = (await s.api.attendance.weekly({ department: 'ALL', shift: 'ALL' })).rows.find(r => r.week_start === '2026-10-12')!
    expect(during.unplanned_absence_rate!).toBeGreaterThan(before.unplanned_absence_rate! + 5)
    await s.api.quality.review({ id: issue.id, status: 'OPEN' })
    const after = (await s.api.attendance.weekly({ department: 'ALL', shift: 'ALL' })).rows.find(r => r.week_start === '2026-10-12')!
    expect(after.unplanned_absence_rate).toBe(before.unplanned_absence_rate)
  })

  it('refuses to override row-level rejects', async () => {
    const issue = (await s.api.quality.issues({ ruleCode: 'TC_UNKNOWN_BADGE', take: 1 })).items[0]
    await expect(s.api.quality.review({ id: issue.id, status: 'OVERRIDDEN' })).rejects.toThrow(/Only day exclusions/)
  })
})

describe('question routing', () => {
  it.each([
    ['What should I look at this week?', 'signals'],
    ['Which department has the highest unplanned absence?', 'compare_groups'],
    ['How has absence on logistics night shift changed?', 'attendance_trend'],
    ['Where is attrition highest?', 'compare_groups'],
    ['Why are people leaving cell manufacturing?', 'exit_reasons'],
    ['Are new hires leaving early?', 'compare_groups'],
    ['Which training programs are effective?', 'training_programs'],
    ['Which departments are behind on mandatory training?', 'training_overdue_by_department'],
    ['Can I trust the data?', 'data_quality'],
  ])('%s -> %s', async (question, tool) => {
    const a = await s.api.insights.ask({ question })
    expect(a.kind).toBe('answer')
    expect(a.tools[0].name).toBe(tool)
    expect(a.evidence.length).toBeGreaterThan(0)
    expect(a.text).not.toMatch(/undefined|NaN/)
  })

  it('exposes the same tools for the LLM, with JSON schemas', async () => {
    const tools = await s.api.insights.tools()
    expect(tools.map(t => t.name)).toContain('compare_groups')
    for (const t of tools) expect(t.input_schema.type).toBe('object')
  })
})
