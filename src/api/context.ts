import type { PrismaClient } from '../generated/prisma/client'

/** Result of an analytics query, kept together with the exact SQL that produced it. */
export interface Evidence<T = Record<string, unknown>> {
  sql: string
  params: unknown[]
  rows: T[]
  ms: number
}

export interface ApiContext {
  prisma: PrismaClient
  /**
   * Run a query as the least-privileged analyst role inside a READ ONLY
   * transaction. Every dashboard, insight and console query goes through here,
   * so none of them can see staging data, core tables or anything that is not
   * an aggregate in the analytics schema.
   */
  analytics<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<Evidence<T>>
}

export const ANALYST_ROLE = 'peopleops_analyst'

/**
 * Runs one SQL statement as the analyst role in a read-only transaction.
 * May report its own execution time (excluding time spent queued).
 */
export type AnalyticsRunner = <T>(sql: string, params: unknown[]) => Promise<T[] | { rows: T[]; ms: number }>

export const ANALYST_PREAMBLE = [`SET TRANSACTION READ ONLY`, `SET LOCAL ROLE ${ANALYST_ROLE}`, `SET LOCAL search_path = analytics`]

/** Analytics runner over Prisma's interactive transactions (server mode, pooled connections). */
export function prismaAnalyticsRunner(prisma: PrismaClient): AnalyticsRunner {
  return <T>(sql: string, params: unknown[]) =>
    prisma.$transaction(
      async tx => {
        for (const stmt of ANALYST_PREAMBLE) await tx.$executeRawUnsafe(stmt)
        return tx.$queryRawUnsafe<T[]>(sql, ...params)
      },
      { maxWait: 30_000, timeout: 30_000 },
    )
}

/**
 * Builds the API context. Typed application queries (pipeline runs, quality
 * issues, reviews) go through Prisma; aggregate analytics go through `runner`,
 * which must enforce the analyst role and a read-only transaction.
 */
export function createContext(prisma: PrismaClient, runner: AnalyticsRunner = prismaAnalyticsRunner(prisma)): ApiContext {
  return {
    prisma,
    async analytics<T>(sql: string, params: unknown[] = []) {
      const started = performance.now()
      const out = await runner<T>(sql, params)
      const rows = Array.isArray(out) ? out : out.rows
      const ms = Array.isArray(out) ? performance.now() - started : out.ms
      return { sql: normalizeSql(sql), params, rows: rows.map(normalizeRow) as T[], ms: Math.round(ms) }
    },
  }
}

/** Strip common indentation so SQL shown in the UI reads like it was written. */
export function normalizeSql(sql: string): string {
  const lines = sql.replace(/^\n+|\s+$/g, '').split('\n')
  const indent = Math.min(...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length))
  return lines.map(l => l.slice(indent)).join('\n')
}

/** Make driver values JSON-safe and consistent across PGlite and node-postgres. */
function normalizeRow(row: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (typeof v === 'bigint') out[k] = Number(v)
    else if (v instanceof Date) out[k] = v.toISOString().slice(0, 10)
    else if (v !== null && typeof v === 'object' && 'toNumber' in v && typeof (v as { toNumber: unknown }).toNumber === 'function') out[k] = (v as { toNumber(): number }).toNumber()
    else out[k] = v
  }
  return out
}
