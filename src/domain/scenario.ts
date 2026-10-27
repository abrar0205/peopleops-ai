/**
 * Everything that shapes the synthetic plant lives here, so the "story" in the
 * data is explicit and reviewable. The pipeline, dashboards and insight engine
 * never read these constants for their answers: they have to find the
 * patterns in the generated rows, exactly as they would with real extracts.
 */

/** The dataset's "today". Fixed so every run is reproducible. A Sunday. */
export const AS_OF = '2026-10-25'

/** Daily time-clock data covers 26 full weeks, Monday to Friday. */
export const ATTENDANCE_START = '2026-04-27'

/** Workforce history (hires/exits) is simulated from this month. */
export const HISTORY_START = '2024-10-01'

export const SEED = 20261027

export type ShiftCode = 'EARLY' | 'LATE' | 'NIGHT'

export interface DepartmentSpec {
  id: number
  code: string
  name: string
  area: string
  /** Active headcount at the start of the simulated history. */
  startHeadcount: number
  /** Net headcount change per month (hiring above replacement). */
  monthlyGrowth: number
  /** Share of early / late / night shift. */
  shiftMix: [number, number, number]
  /** Share of fixed-term contracts among new hires. */
  fixedTermShare: number
  voluntaryHazard: number
  sickness: number
  overtimeChance: number
  jobFamilies: [string, number][]
}

const production: [string, number][] = [
  ['Production Associate', 82],
  ['Team Lead', 8],
  ['Technician', 7],
  ['Engineer', 3],
]

export const DEPARTMENTS: DepartmentSpec[] = [
  { id: 1, code: 'GA', name: 'General Assembly', area: 'Vehicle', startHeadcount: 740, monthlyGrowth: 1, shiftMix: [0.36, 0.34, 0.3], fixedTermShare: 0.12, voluntaryHazard: 1.1, sickness: 1.1, overtimeChance: 0.18, jobFamilies: production },
  { id: 2, code: 'BIW', name: 'Body in White', area: 'Vehicle', startHeadcount: 370, monthlyGrowth: 0.5, shiftMix: [0.36, 0.34, 0.3], fixedTermShare: 0.1, voluntaryHazard: 1, sickness: 1, overtimeChance: 0.15, jobFamilies: production },
  { id: 3, code: 'PNT', name: 'Paint Shop', area: 'Vehicle', startHeadcount: 225, monthlyGrowth: 0, shiftMix: [0.36, 0.34, 0.3], fixedTermShare: 0.1, voluntaryHazard: 0.95, sickness: 1.05, overtimeChance: 0.12, jobFamilies: production },
  { id: 4, code: 'LOG', name: 'Logistics', area: 'Supply Chain', startHeadcount: 420, monthlyGrowth: 1, shiftMix: [0.36, 0.33, 0.31], fixedTermShare: 0.15, voluntaryHazard: 1.3, sickness: 1.08, overtimeChance: 0.18, jobFamilies: [['Logistics Associate', 60], ['Forklift Operator', 24], ['Team Lead', 8], ['Planner', 8]] },
  // Quality night shift is deliberately tiny (a handful of people): the analytics
  // layer must suppress it instead of publishing rates for a handful of people.
  { id: 5, code: 'QLT', name: 'Quality', area: 'Quality', startHeadcount: 205, monthlyGrowth: 0.2, shiftMix: [0.575, 0.41, 0.015], fixedTermShare: 0.05, voluntaryHazard: 0.7, sickness: 0.85, overtimeChance: 0.08, jobFamilies: [['Quality Inspector', 78], ['Team Lead', 8], ['Quality Engineer', 14]] },
  { id: 6, code: 'MNT', name: 'Maintenance', area: 'Technical Services', startHeadcount: 215, monthlyGrowth: 0.2, shiftMix: [0.4, 0.33, 0.27], fixedTermShare: 0.05, voluntaryHazard: 0.8, sickness: 0.95, overtimeChance: 0.32, jobFamilies: [['Maintenance Technician', 76], ['Team Lead', 8], ['Reliability Engineer', 16]] },
  // Battery cell manufacturing is ramping up: mostly recent, often fixed-term hires.
  { id: 7, code: 'CEL', name: 'Cell Manufacturing', area: 'Battery', startHeadcount: 60, monthlyGrowth: 10, shiftMix: [0.36, 0.34, 0.3], fixedTermShare: 0.55, voluntaryHazard: 1, sickness: 0.9, overtimeChance: 0.22, jobFamilies: production },
]

export interface ProgramSpec {
  id: number
  code: string
  name: string
  category: 'Safety' | 'Quality' | 'Leadership'
  mandatory: boolean
  /** Departments that must take it ('*' = everyone). Leadership goes to Team Leads. */
  audience: string[] | '*' | 'TEAM_LEAD'
  preMean: number
  upliftMean: number
  upliftSd: number
  /** Probability of completing by the due date. */
  onTime: number
}

export const PROGRAMS: ProgramSpec[] = [
  { id: 1, code: 'HVS', name: 'High-Voltage Safety', category: 'Safety', mandatory: true, audience: ['CEL', 'MNT', 'GA'], preMean: 64, upliftMean: 19, upliftSd: 7, onTime: 0.9 },
  // High completion, almost no learning: a click-through e-learning.
  { id: 2, code: 'FLR', name: 'Forklift Safety Refresher', category: 'Safety', mandatory: true, audience: ['LOG'], preMean: 79, upliftMean: 1.5, upliftSd: 4, onTime: 0.97 },
  { id: 3, code: 'LOTO', name: 'Lockout / Tagout', category: 'Safety', mandatory: true, audience: ['MNT', 'PNT'], preMean: 70, upliftMean: 13, upliftSd: 6, onTime: 0.88 },
  { id: 4, code: 'ERG', name: 'Ergonomics at the Line', category: 'Safety', mandatory: true, audience: ['GA', 'BIW', 'PNT', 'CEL'], preMean: 76, upliftMean: 6, upliftSd: 5, onTime: 0.9 },
  { id: 5, code: 'FIRE', name: 'Fire Safety & Evacuation', category: 'Safety', mandatory: true, audience: '*', preMean: 79, upliftMean: 4, upliftSd: 4, onTime: 0.92 },
  { id: 6, code: '8D', name: '8D Problem Solving', category: 'Quality', mandatory: false, audience: ['QLT'], preMean: 70, upliftMean: 11, upliftSd: 6, onTime: 0.85 },
  { id: 7, code: 'TLF', name: 'Team Lead Foundations', category: 'Leadership', mandatory: false, audience: 'TEAM_LEAD', preMean: 68, upliftMean: 14, upliftSd: 6, onTime: 0.8 },
]

/**
 * Patterns planted in the data. Documented here and in the README; the
 * insight engine is tested on whether it rediscovers them.
 */
export const STORY = {
  /** Logistics night shift: unplanned absence, overtime and early exits climb from August. */
  logisticsNight: { department: 'LOG', shift: 'NIGHT' as ShiftCode, from: '2026-08-01' },
  /** Maintenance runs heavy overtime and falls behind on mandatory training. */
  maintenanceOverload: { department: 'MNT', onTimeFactor: 0.72 },
  /** The time-clock delivery for this day arrived only partially. */
  partialLoadDay: '2026-10-14',
} as const

export const MIN_GROUP_SIZE = 10
