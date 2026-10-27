import type { PGlite, Transaction } from '@electric-sql/pglite'
import type { SqlExecutor } from '../domain/pipeline'
import { ANALYST_PREAMBLE, type AnalyticsRunner } from '../api/context'

type Conn = Pick<PGlite, 'query' | 'exec'> | Transaction

const csvCell = (v: unknown): string => {
  if (v === null || v === undefined || v === '') return ''
  const s = String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: readonly (readonly unknown[])[]): string {
  let out = ''
  for (const r of rows) out += r.map(csvCell).join(',') + '\n'
  return out
}

/** SqlExecutor over PGlite. Bulk loads use COPY from an in-memory blob. */
export function pgliteExecutor(conn: Conn, root?: PGlite): SqlExecutor {
  return {
    async exec(sql) {
      await conn.exec(sql)
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await conn.query<T>(sql, params)).rows
    },
    async load(table, columns, rows) {
      if (rows.length === 0) return
      const blob = new Blob([toCsv(rows)])
      await conn.query(`COPY ${table} (${columns.join(', ')}) FROM '/dev/blob' WITH (FORMAT csv)`, [], { blob })
    },
    async transaction(fn) {
      const db = root ?? (conn as PGlite)
      if (!('transaction' in db)) return fn(this)
      return db.transaction(tx => fn(pgliteExecutor(tx)))
    },
  }
}

/**
 * Analytics runner directly on PGlite: same role and read-only transaction as
 * the Prisma runner, minus the interactive-transaction round trips, which
 * matter on a single in-browser connection.
 */
export function pgliteAnalyticsRunner(pg: PGlite): AnalyticsRunner {
  return <T>(sql: string, params: unknown[]) =>
    pg.transaction(async tx => {
      const started = performance.now()
      await tx.exec(ANALYST_PREAMBLE.join(';\n'))
      const rows = (await tx.query<T>(sql, params)).rows
      return { rows, ms: performance.now() - started }
    })
}
