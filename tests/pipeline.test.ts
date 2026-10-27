import { beforeAll, describe, expect, it } from 'vitest'
import { createStack, type Stack } from './setup'
import { generateExtracts } from '../src/domain/generate'
import { RULES } from '../src/domain/rules'
import { pgliteExecutor } from '../src/db/pglite'
import { runPipeline } from '../src/domain/pipeline'

let s: Stack
beforeAll(async () => {
  s = await createStack()
})

const rowsFor = async (rule: string) =>
  (await s.pg.query<{ issues: number; rows: number }>(`SELECT count(*)::int AS issues, coalesce(sum(row_count), 0)::int AS rows FROM quality_issue WHERE rule_code = $1 AND run_id = $2`, [rule, s.run.runId])).rows[0]

describe('synthetic extracts', () => {
  it('are deterministic', () => {
    const a = generateExtracts()
    const b = generateExtracts()
    expect(a.timeclock.length).toBe(b.timeclock.length)
    expect(JSON.stringify(a.hris)).toBe(JSON.stringify(b.hris))
    expect(JSON.stringify(a.timeclock.slice(-500))).toBe(JSON.stringify(b.timeclock.slice(-500)))
  })
})

describe('data-quality rules catch every injected defect', () => {
  it('HR master data', async () => {
    const t = s.extracts.truth
    expect((await rowsFor('HR_DUPLICATE_BADGE')).rows).toBe(t.duplicateBadges.length)
    expect((await rowsFor('HR_UNKNOWN_DEPARTMENT')).rows).toBe(t.unknownDepartmentBadges.length)
    expect((await rowsFor('HR_EXIT_BEFORE_HIRE')).rows).toBe(t.exitBeforeHireBadges.length)
    expect((await rowsFor('HR_SHIFT_MISSING')).rows).toBe(t.missingShiftBadges.length)
  })

  it('time & attendance', async () => {
    const t = s.extracts.truth
    expect((await rowsFor('TC_FUTURE_DATE')).rows).toBe(t.futureDatedRows)
    expect((await rowsFor('TC_HOURS_OUT_OF_RANGE')).rows).toBe(t.impossibleHourRows)
    expect((await rowsFor('TC_DUPLICATE_ROW')).rows).toBe(t.duplicateTimeRows)
    expect((await rowsFor('TC_ABSENCE_WITH_HOURS')).rows).toBe(t.absenceWithHoursRows)
    expect((await rowsFor('TC_UNKNOWN_ABSENCE_CODE')).rows).toBe(t.unknownAbsenceCodeRows)
    expect((await rowsFor('TC_UNKNOWN_BADGE')).issues).toBe(t.unknownBadges.length)
    expect((await rowsFor('TC_AFTER_EXIT')).issues).toBe(t.afterExitBadges.length)
    expect((await rowsFor('TC_AFTER_EXIT')).rows).toBe(t.afterExitBadges.length * 5)
    expect((await rowsFor('TC_FRESHNESS')).issues).toBe(0)
  })

  it('flags exactly the partially delivered day', async () => {
    const days = (await s.pg.query<{ source_key: string }>(`SELECT source_key FROM quality_issue WHERE rule_code = 'TC_MISSING_PUNCHES'`)).rows
    expect(days.map(d => d.source_key)).toEqual([s.extracts.truth.partialLoadDay])
  })

  it('learning records', async () => {
    const t = s.extracts.truth
    expect((await rowsFor('LMS_SCORE_OUT_OF_RANGE')).rows).toBe(t.scoreOutOfRangeRows)
    expect((await rowsFor('LMS_COMPLETED_BEFORE_ASSIGNED')).rows).toBe(t.completedBeforeAssignedRows)
    expect((await rowsFor('LMS_UNKNOWN_PROGRAM')).rows).toBe(t.unknownProgramRows)
  })

  it('cascades held-back HR records to their time and training rows', async () => {
    const held = [...s.extracts.truth.unknownDepartmentBadges, ...s.extracts.truth.exitBeforeHireBadges]
    const r = await s.pg.query<{ source_key: string }>(`SELECT source_key FROM quality_issue WHERE rule_code = 'TC_EMPLOYEE_HELD_BACK'`)
    expect(new Set(r.rows.map(x => x.source_key))).toEqual(new Set(held))
  })

  it('every rule in the catalog ran', () => {
    expect(s.run.rules.map(r => r.code)).toEqual(RULES.map(r => r.code))
  })
})

describe('loading', () => {
  it('loads exactly the rows that no blocking rule rejected', async () => {
    for (const [source, table] of [['hris', 'employee'], ['timeclock', 'attendance_day'], ['lms', 'training_assignment']] as const) {
      const [{ blocked }] = (await s.pg.query<{ blocked: number }>(`SELECT count(DISTINCT row_no)::int AS blocked FROM staging.reject WHERE source = $1 AND blocking`, [source])).rows
      const [{ n }] = (await s.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`)).rows
      expect(n, table).toBe(s.run.sources[source].received - blocked)
    }
  })

  it('maps scheduled shifts without punches to no-shows', async () => {
    const [{ n }] = (await s.pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM attendance_day WHERE absence_code IS NULL AND worked_hours = 0 AND scheduled_hours > 0`)).rows
    expect(n).toBe(0)
  })

  it('is repeatable: a second run yields identical KPIs', async () => {
    const before = await s.api.kpi.summary()
    await runPipeline(pgliteExecutor(s.pg, s.pg), s.extracts)
    const after = await s.api.kpi.summary()
    expect(after.map(t => [t.id, t.value])).toEqual(before.map(t => [t.id, t.value]))
  })
})
