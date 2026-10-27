import pg from 'pg'
import type { SqlExecutor } from '../src/domain/pipeline'

type Queryable = pg.Pool | pg.PoolClient

const BATCH = 5_000

/** SqlExecutor over node-postgres. Bulk loads go through json_populate_recordset in batches. */
export function pgExecutor(db: Queryable, pool?: pg.Pool): SqlExecutor {
  return {
    async exec(sql) {
      await db.query(sql)
    },
    async query<T>(sql: string, params: unknown[] = []) {
      return (await db.query(sql, params)).rows as T[]
    },
    async load(table, columns, rows) {
      for (let i = 0; i < rows.length; i += BATCH) {
        const json = JSON.stringify(rows.slice(i, i + BATCH).map(r => Object.fromEntries(columns.map((c, j) => [c, r[j] === '' ? null : r[j]]))))
        await db.query(`INSERT INTO ${table} (${columns.join(', ')}) SELECT ${columns.join(', ')} FROM json_populate_recordset(NULL::${table}, $1::json)`, [json])
      }
    },
    async transaction(fn) {
      if (!pool) return fn(this)
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const out = await fn(pgExecutor(client))
        await client.query('COMMIT')
        return out
      } catch (e) {
        await client.query('ROLLBACK')
        throw e
      } finally {
        client.release()
      }
    },
  }
}

export function databaseUrl() {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('Set DATABASE_URL, e.g. postgresql://peopleops:peopleops@localhost:5432/peopleops')
  return url
}
