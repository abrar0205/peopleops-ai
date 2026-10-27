import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pgliteExecutor } from '../src/db/pglite'
import { applyMigrations } from '../src/domain/pipeline'
import { loadMigrations } from './setup'

/**
 * Prisma's schema engine is not used to generate the migration SQL, so this
 * test guarantees the hand-written migrations and schema.prisma describe the
 * same tables, columns and enums.
 */
const root = join(import.meta.dirname, '..')
const classTs = readFileSync(join(root, 'src/generated/prisma/internal/class.ts'), 'utf8')
const model = JSON.parse(JSON.parse('"' + classTs.match(/config\.runtimeDataModel = JSON\.parse\("(.*)"\)/)![1] + '"')) as {
  models: Record<string, { dbName: string | null; fields: { name: string; kind: string; dbName?: string }[] }>
}
const schemaPrisma = readFileSync(join(root, 'prisma/schema.prisma'), 'utf8')

describe('schema drift', async () => {
  const pg = new PGlite()
  await applyMigrations(pgliteExecutor(pg, pg), loadMigrations())
  const cols = (await pg.query<{ table_name: string; column_name: string }>(`SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'`)).rows

  it.each(Object.entries(model.models))('%s matches its table', (name, m) => {
    const table = m.dbName ?? name
    const expected = m.fields.filter(f => f.kind !== 'object').map(f => f.dbName ?? f.name).sort()
    const actual = cols.filter(c => c.table_name === table).map(c => c.column_name).sort()
    expect(actual).toEqual(expected)
  })

  it('has no tables Prisma does not know about', () => {
    const tables = new Set(cols.map(c => c.table_name))
    expect([...tables].sort()).toEqual(Object.entries(model.models).map(([n, m]) => m.dbName ?? n).sort())
  })

  it('enums match', async () => {
    const enums = [...schemaPrisma.matchAll(/enum (\w+) \{([^}]*)\}/g)].map(([, n, body]) => [n, body.split(/\s+/).filter(Boolean)] as const)
    const pgEnums = (await pg.query<{ typname: string; labels: string[] }>(`SELECT t.typname, array_agg(e.enumlabel ORDER BY e.enumsortorder) AS labels FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid GROUP BY t.typname`)).rows
    for (const [n, labels] of enums) expect(pgEnums.find(e => e.typname === n)?.labels, n).toEqual(labels)
    expect(pgEnums.length).toBe(enums.length)
  })
})
