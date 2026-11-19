import type { BootStep } from './boot'

/** Messages between the page and the backend worker. */
export type ToWorker =
  | { type: 'call'; id: number; path: string; input: unknown }
  | { type: 'rerun'; id: number }
  | { type: 'inject'; id: number }
  | { type: 'restore'; id: number }

export type ToMain =
  | { type: 'steps'; steps: BootStep[] }
  | { type: 'ready'; bootMs: number }
  | { type: 'error'; message: string }
  | { type: 'result'; id: number; data?: unknown; error?: { message: string; code?: string } }

export interface RunInfo {
  runId: number
  ms: number
}

export interface InjectInfo extends RunInfo {
  added: { futureDated: number; unknownBadges: number; badScores: number }
}
