import type { Source } from '../domain/rules'

/**
 * Queries precomputed at build time (server/snapshot.ts) so the first screen
 * renders before the in-browser database has finished booting.
 */
export const SNAPSHOT_QUERIES: { path: string; input?: unknown }[] = [
  { path: 'meta.status' },
  { path: 'meta.reference' },
  { path: 'kpi.summary' },
  { path: 'insights.signals' },
  { path: 'attendance.byGroup', input: { by: 'department_shift', weeks: 4 } },
  { path: 'quality.overview' },
  { path: 'attendance.boardTrends' },
  // Default views of the Explore and Data quality pages, so they open instantly too.
  { path: 'attendance.weekly', input: { department: 'ALL', shift: 'ALL' } },
  { path: 'attendance.weekday', input: { department: 'ALL' } },
  { path: 'workforce.attritionTrend', input: { department: 'ALL', shift: 'ALL' } },
  { path: 'workforce.attritionByGroup', input: { by: 'department' } },
  { path: 'workforce.exitReasons' },
  { path: 'workforce.earlyAttrition', input: { by: 'department_shift' } },
  { path: 'training.programs' },
  { path: 'training.overdueByDepartment' },
  { path: 'quality.issues', input: { ruleCode: 'TC_MISSING_PUNCHES', take: 1 } },
]

export interface Snapshot {
  asOf: string
  sources: Record<Source, { received: number; loaded: number }>
  rules: number
  entries: { path: string; input?: unknown; data: unknown }[]
}
