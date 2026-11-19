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
]

export interface Snapshot {
  asOf: string
  sources: Record<Source, { received: number; loaded: number }>
  rules: number
  entries: { path: string; input?: unknown; data: unknown }[]
}
