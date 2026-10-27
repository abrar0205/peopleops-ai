/**
 * Synthetic source-system extracts for one plant.
 *
 * Produces what three upstream systems would deliver: an HR master-data
 * export, a time-and-attendance export and an LMS export. Realistic defects
 * are injected into the extracts on purpose; the pipeline's quality rules have
 * to catch them. `truth` records exactly what was injected so tests can check
 * that every defect is detected and nothing else is.
 */
import { Random, addMonths, isoWeekday, monthStart, toDay, toIso } from './random'
import { AS_OF, ATTENDANCE_START, DEPARTMENTS, HISTORY_START, PROGRAMS, SEED, STORY, type DepartmentSpec, type ShiftCode } from './scenario'

type HrisBody = [badge: string, deptCode: string, jobFamily: string, shift: string, contract: string, hireDate: string, exitDate: string, exitReason: string]
type TimeBody = [badge: string, workDate: string, scheduled: number, worked: number, overtime: number, absence: string]
type LmsBody = [badge: string, programCode: string, assignedOn: string, dueOn: string, completedOn: string, preScore: number | '', postScore: number | '']
export type HrisRow = [rowNo: number, ...HrisBody]
export type TimeRow = [rowNo: number, ...TimeBody]
export type LmsRow = [rowNo: number, ...LmsBody]

export interface Extracts {
  asOf: string
  hris: HrisRow[]
  timeclock: TimeRow[]
  lms: LmsRow[]
  /** Ground truth about injected defects, for tests and the README. */
  truth: {
    duplicateBadges: string[]
    unknownDepartmentBadges: string[]
    missingShiftBadges: string[]
    exitBeforeHireBadges: string[]
    futureDatedRows: number
    impossibleHourRows: number
    duplicateTimeRows: number
    afterExitBadges: string[]
    unknownBadges: string[]
    absenceWithHoursRows: number
    unknownAbsenceCodeRows: number
    partialLoadDay: string
    partialLoadKeptShare: number
    scoreOutOfRangeRows: number
    completedBeforeAssignedRows: number
    unknownProgramRows: number
  }
}

interface SimEmployee {
  badge: string
  dept: DepartmentSpec
  jobFamily: string
  shift: ShiftCode
  contract: 'PERM' | 'FT'
  hire: number
  exit?: number
  exitReason?: 'Resignation' | 'Dismissal' | 'Contract end'
}

const SHIFTS: ShiftCode[] = ['EARLY', 'LATE', 'NIGHT']
const SHIFT_EXPORT: Record<ShiftCode, string> = { EARLY: 'E', LATE: 'L', NIGHT: 'N' }
const WEEKDAY_SICKNESS = [0, 1.4, 1.0, 0.95, 0.95, 1.25, 0, 0]
const MONTH_SICKNESS = [1.1, 1.05, 1.0, 1.0, 0.95, 0.85, 0.8, 0.85, 1.0, 1.2, 1.15, 1.1]

export function generateExtracts(seed = SEED): Extracts {
  const rnd = new Random(seed)
  const asOf = toDay(AS_OF)
  const historyStart = toDay(HISTORY_START)
  const storyFrom = toDay(STORY.logisticsNight.from)
  const attritionStoryFrom = toDay('2026-02-01')

  // Progress of the Logistics night-shift story at a given day: 0 before, 1 at as-of.
  const storyProgress = (day: number, from: number) => Math.min(1, Math.max(0, (day - from) / (asOf - from)))
  const isStoryGroup = (e: SimEmployee) => e.dept.code === STORY.logisticsNight.department && e.shift === STORY.logisticsNight.shift

  // ------------------------------------------------------------ workforce
  let badgeSeq = 100_231
  const nextBadge = () => `T${(badgeSeq += rnd.int(1, 3))}`
  const employees: SimEmployee[] = []

  const newEmployee = (dept: DepartmentSpec, hire: number, contract?: 'PERM' | 'FT', forcedShift?: ShiftCode): SimEmployee => {
    const shift = forcedShift ?? rnd.weighted(SHIFTS.map((s, i) => [s, dept.shiftMix[i]] as const))
    const e: SimEmployee = {
      badge: nextBadge(),
      dept,
      jobFamily: rnd.weighted(dept.jobFamilies),
      shift,
      contract: contract ?? (rnd.chance(dept.fixedTermShare) ? 'FT' : 'PERM'),
      hire,
    }
    employees.push(e)
    return e
  }

  for (const dept of DEPARTMENTS) {
    const earliest = dept.code === 'CEL' ? toDay('2024-03-01') : toDay('2022-03-01')
    for (let i = 0; i < dept.startHeadcount; i++) {
      const hire = rnd.int(earliest, historyStart - 1)
      newEmployee(dept, hire, historyStart - hire < 365 && rnd.chance(dept.fixedTermShare) ? 'FT' : 'PERM')
    }
  }

  const growthCarry = new Map<string, number>()
  for (let m = monthStart(historyStart); m <= asOf; m = addMonths(m, 1)) {
    const mEnd = Math.min(addMonths(m, 1) - 1, asOf)
    const exitsByDept = new Map<string, number>()
    for (const e of employees) {
      if (e.exit !== undefined || e.hire > mEnd) continue
      const tenureMonths = (m - e.hire) / 30.4
      // Fixed-term contracts end or convert at 12 months.
      const contractEnd = addMonths(e.hire, 12)
      if (e.contract === 'FT' && contractEnd >= m && contractEnd <= mEnd) {
        if (rnd.chance(0.35)) {
          e.exit = contractEnd
          e.exitReason = 'Contract end'
        } else e.contract = 'PERM'
      }
      if (e.exit !== undefined) {
        exitsByDept.set(e.dept.code, (exitsByDept.get(e.dept.code) ?? 0) + 1)
        continue
      }
      let voluntary = 0.0055 * e.dept.voluntaryHazard * (tenureMonths < 3 ? 2.6 : tenureMonths < 12 ? 1.25 : 1) * (e.shift === 'NIGHT' ? 1.2 : 1)
      if (isStoryGroup(e)) {
        const p = storyProgress(m, attritionStoryFrom)
        // New starters on Logistics nights leave much faster as the shift gets harder.
        voluntary *= tenureMonths < 3 ? 1 + 6 * p : 1 + 1.3 * p
      }
      const involuntary = 0.0012 * (tenureMonths < 6 ? 2.5 : 1)
      const r = rnd.next()
      if (r < voluntary + involuntary) {
        const exit = rnd.int(Math.max(m, e.hire + 1), mEnd)
        if (exit > asOf) continue
        e.exit = exit
        e.exitReason = r < voluntary ? 'Resignation' : 'Dismissal'
        exitsByDept.set(e.dept.code, (exitsByDept.get(e.dept.code) ?? 0) + 1)
      }
    }
    // Replace leavers and add planned growth.
    for (const dept of DEPARTMENTS) {
      const carry = (growthCarry.get(dept.code) ?? 0) + dept.monthlyGrowth
      const growth = Math.floor(carry)
      growthCarry.set(dept.code, carry - growth)
      const hires = (exitsByDept.get(dept.code) ?? 0) + growth
      for (let i = 0; i < hires; i++) {
        const hire = rnd.int(m, mEnd)
        if (hire <= asOf) newEmployee(dept, hire)
      }
      // Logistics backfills its night shift with extra hires during the story period.
      if (dept.code === STORY.logisticsNight.department && m >= attritionStoryFrom) {
        for (let i = 0; i < 3; i++) {
          const hire = rnd.int(m, mEnd)
          if (hire <= asOf) newEmployee(dept, hire, undefined, STORY.logisticsNight.shift)
        }
      }
    }
  }

  // ----------------------------------------------------------- attendance
  const attStart = toDay(ATTENDANCE_START)
  const timeRows: TimeBody[] = []
  const summerFrom = toDay('2026-07-06')
  const summerTo = toDay('2026-08-21')

  for (const e of employees) {
    const first = Math.max(attStart, e.hire)
    const last = Math.min(asOf, (e.exit ?? asOf + 1) - 1)
    if (first > last) continue
    const vacation = new Set<number>()
    if (rnd.chance(0.85)) {
      let d = rnd.int(summerFrom, summerTo)
      for (let n = rnd.int(5, 10); n > 0; d++) if (isoWeekday(d) <= 5) { vacation.add(d); n-- }
    }
    let sickYesterday = false
    for (let d = first; d <= last; d++) {
      const wd = isoWeekday(d)
      if (wd > 5) continue
      const month = new Date(d * 86_400_000).getUTCMonth()
      const story = isStoryGroup(e) ? storyProgress(d, storyFrom) : 0
      let absence = ''
      if (vacation.has(d) || rnd.chance(0.012)) absence = 'VACATION'
      else {
        const start = 0.019 * e.dept.sickness * WEEKDAY_SICKNESS[wd] * (e.shift === 'NIGHT' ? 1.15 : e.shift === 'EARLY' ? 0.95 : 1) * MONTH_SICKNESS[month] * (1 + 0.7 * story)
        if (sickYesterday ? rnd.chance(0.62) : rnd.chance(start)) absence = 'SICK'
        else if (rnd.chance(0.0025)) absence = 'UNEXCUSED'
      }
      sickYesterday = absence === 'SICK'
      let overtime = 0
      if (!absence) {
        const p = e.dept.overtimeChance * (1 + 1.0 * story) * (month === 9 ? 1.1 : 1)
        if (rnd.chance(p)) overtime = rnd.pick([1, 1.5, 2, 2, 2.5, 3])
      }
      timeRows.push([e.badge, toIso(d), 8, absence ? 0 : 8, overtime, absence])
    }
  }

  // ------------------------------------------------------------- training
  const lmsRows: LmsBody[] = []
  const windowStart = asOf - 365
  const clampScore = (x: number) => Math.max(0, Math.min(100, Math.round(x)))
  for (const e of employees) {
    for (const p of PROGRAMS) {
      const applies = p.audience === '*' || (p.audience === 'TEAM_LEAD' ? e.jobFamily === 'Team Lead' : p.audience.includes(e.dept.code))
      if (!applies) continue
      const earliest = Math.max(windowStart, e.hire + 7)
      const latest = Math.min(asOf - 3, (e.exit ?? Infinity) - 31)
      if (earliest > latest) continue
      const assigned = e.hire + 7 >= windowStart ? e.hire + 7 : rnd.int(earliest, latest)
      if (assigned > latest) continue
      const due = assigned + 30
      const onTime = p.onTime * (e.dept.code === STORY.maintenanceOverload.department ? STORY.maintenanceOverload.onTimeFactor : 1)
      let completed: number | undefined
      if (rnd.chance(onTime)) completed = assigned + rnd.int(1, 30)
      else if (rnd.chance(0.55)) completed = due + rnd.int(1, 40)
      if (completed !== undefined && completed > asOf) completed = undefined
      let pre: number | '' = ''
      let post: number | '' = ''
      if (completed !== undefined) {
        pre = clampScore(rnd.normal(p.preMean, 10))
        post = clampScore(pre + rnd.normal(p.upliftMean, p.upliftSd))
      }
      lmsRows.push([e.badge, p.code, toIso(assigned), toIso(due), completed === undefined ? '' : toIso(completed), pre, post])
    }
  }

  // -------------------------------------------------------- inject defects
  const exportable = employees.filter(e => e.exit === undefined || e.exit >= historyStart)
  const active = exportable.filter(e => e.exit === undefined)
  const takeDistinct = (pool: SimEmployee[], n: number, used: Set<string>) => {
    const out: SimEmployee[] = []
    while (out.length < n) {
      const e = rnd.pick(pool)
      if (!used.has(e.badge)) { used.add(e.badge); out.push(e) }
    }
    return out
  }
  const used = new Set<string>()
  const dupes = takeDistinct(active, 4, used)
  const unknownDept = takeDistinct(active, 6, used)
  const missingShift = takeDistinct(active, 18, used)
  const exitedInWindow = exportable.filter(e => e.exit !== undefined && e.exit > attStart + 14 && e.exit < asOf - 10)
  const exitBeforeHire = takeDistinct(exitedInWindow, 3, used)
  const afterExit = takeDistinct(exitedInWindow, 5, used)

  const unknownDeptSet = new Set(unknownDept.map(e => e.badge))
  const missingShiftSet = new Set(missingShift.map(e => e.badge))
  const exitBeforeHireSet = new Set(exitBeforeHire.map(e => e.badge))

  const hrisBody: HrisBody[] = []
  // Stale duplicate records (an old transfer that was never closed) come first in the export.
  for (const e of dupes) {
    const other = DEPARTMENTS.find(d => d.code !== e.dept.code)!
    hrisBody.push([e.badge, other.code, e.jobFamily, SHIFT_EXPORT[e.shift], 'PERM', toIso(e.hire - rnd.int(200, 400)), '', ''])
  }
  for (const e of exportable) {
    const exit = e.exit === undefined ? '' : exitBeforeHireSet.has(e.badge) ? toIso(e.hire - rnd.int(20, 200)) : toIso(e.exit)
    hrisBody.push([
      e.badge,
      unknownDeptSet.has(e.badge) ? 'GA1' : e.dept.code,
      e.jobFamily,
      missingShiftSet.has(e.badge) ? '' : SHIFT_EXPORT[e.shift],
      e.contract,
      toIso(e.hire),
      exit,
      e.exitReason ?? '',
    ])
  }

  // Time-clock defects
  const partial = STORY.partialLoadDay
  // Punch data for most of this day never arrived: the shift plan was exported
  // (scheduled hours present) but worked hours are 0 and no absence is coded.
  const keepShare = 0.41
  const tc = timeRows.map(r => (r[1] === partial && !r[5] && !rnd.chance(keepShare) ? ([r[0], r[1], 8, 0, 0, ''] as TimeBody) : r))
  const extra: TimeBody[] = []
  let future = 0
  for (const e of takeDistinct(active, 37, new Set())) {
    let d = asOf + rnd.int(1, 12)
    while (isoWeekday(d) > 5) d++
    extra.push([e.badge, toIso(d), 8, 0, 0, ''])
    future++
  }
  const impossible = [24, 48, 80, -8, 16.5, 24, 48, 13, -8, 24, 32, 80]
  const impossibleIdx = new Set<number>()
  while (impossibleIdx.size < impossible.length) {
    const i = rnd.int(0, tc.length - 1)
    if (!tc[i][5]) impossibleIdx.add(i)
  }
  ;[...impossibleIdx].forEach((i, k) => (tc[i] = [tc[i][0], tc[i][1], 8, impossible[k], tc[i][4], '']))
  const absenceWithHours = new Set<number>()
  while (absenceWithHours.size < 8) {
    const i = rnd.int(0, tc.length - 1)
    if (!tc[i][5] && !impossibleIdx.has(i)) absenceWithHours.add(i)
  }
  for (const i of absenceWithHours) tc[i] = [tc[i][0], tc[i][1], 8, 8, 0, 'SICK']
  const unknownCode = new Set<number>()
  while (unknownCode.size < 6) {
    const i = rnd.int(0, tc.length - 1)
    if (tc[i][5] === 'SICK' && !absenceWithHours.has(i)) unknownCode.add(i)
  }
  for (const i of unknownCode) tc[i] = [tc[i][0], tc[i][1], 8, 0, 0, 'K']
  // The same day exported twice (re-sent batch).
  const touched = new Set([...impossibleIdx, ...absenceWithHours, ...unknownCode])
  const duplicated = new Set<number>()
  while (duplicated.size < 15) {
    const i = rnd.int(0, tc.length - 1)
    if (!touched.has(i) && tc[i][1] !== partial) duplicated.add(i)
  }
  for (const i of duplicated) extra.push([...tc[i]] as TimeBody)
  for (const e of afterExit) {
    let d = e.exit!
    for (let n = 0; n < 5; d++) if (isoWeekday(d) <= 5) { extra.push([e.badge, toIso(d), 8, 8, 0, '']); n++ }
  }
  const contractors: string[] = []
  for (let c = 0; c < 4; c++) {
    const badge = `C9${rnd.int(1000, 9999)}`
    contractors.push(badge)
    let d = asOf - rnd.int(20, 60)
    for (let n = rnd.int(8, 12); n > 0; d++) if (isoWeekday(d) <= 5 && d <= asOf) { extra.push([badge, toIso(d), 8, 8, rnd.pick([0, 0, 1]), '']); n-- }
  }

  // LMS defects
  const lms = lmsRows.map(r => [...r] as LmsBody)
  const scored = lms.map((r, i) => (r[6] !== '' ? i : -1)).filter(i => i >= 0)
  const outOfRange = new Set<number>()
  while (outOfRange.size < 9) outOfRange.add(rnd.pick(scored))
  for (const i of outOfRange) lms[i][6] = rnd.int(104, 118)
  const completedBefore = new Set<number>()
  while (completedBefore.size < 5) {
    const i = rnd.pick(scored)
    if (!outOfRange.has(i)) completedBefore.add(i)
  }
  for (const i of completedBefore) lms[i][4] = toIso(toDay(lms[i][2]) - rnd.int(3, 20))
  for (let i = 0; i < 4; i++) {
    const e = rnd.pick(active)
    lms.push([e.badge, 'HVS-2024', toIso(asOf - rnd.int(40, 90)), toIso(asOf - rnd.int(10, 39)), '', '', ''])
  }

  const number = <T extends unknown[]>(rows: T[]) => rows.map((r, i) => [i + 1, ...r]) as unknown as [number, ...T][]

  return {
    asOf: AS_OF,
    hris: number(hrisBody) as HrisRow[],
    timeclock: number([...tc, ...extra]) as TimeRow[],
    lms: number(lms) as LmsRow[],
    truth: {
      duplicateBadges: dupes.map(e => e.badge),
      unknownDepartmentBadges: unknownDept.map(e => e.badge),
      missingShiftBadges: missingShift.map(e => e.badge),
      exitBeforeHireBadges: exitBeforeHire.map(e => e.badge),
      futureDatedRows: future,
      impossibleHourRows: impossible.length,
      duplicateTimeRows: 15,
      afterExitBadges: afterExit.map(e => e.badge),
      unknownBadges: contractors,
      absenceWithHoursRows: absenceWithHours.size,
      unknownAbsenceCodeRows: unknownCode.size,
      partialLoadDay: partial,
      partialLoadKeptShare: keepShare,
      scoreOutOfRangeRows: outOfRange.size,
      completedBeforeAssignedRows: completedBefore.size,
      unknownProgramRows: 4,
    },
  }
}
