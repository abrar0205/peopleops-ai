/**
 * Build-time snapshot of the queries behind the first screen.
 *
 *   npm run snapshot   (runs automatically before `vite build`)
 *
 * The data is seeded and the as-of date is fixed, so these results are exactly
 * what the in-browser database computes. Shipping them lets the brief render
 * immediately while PostgreSQL boots in the tab; everything else (drill-downs,
 * Ask, SQL console) waits for the live database.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PrismaPGlite } from 'pglite-prisma-adapter'
import { PrismaClient } from '../src/generated/prisma/client'
import { pgliteAnalyticsRunner, pgliteExecutor } from '../src/db/pglite'
import { applyMigrations, runPipeline } from '../src/domain/pipeline'
import { generateExtracts } from '../src/domain/generate'
import { createContext } from '../src/api/context'
import { createCaller } from '../src/api/router'
import { SNAPSHOT_QUERIES, type Snapshot } from '../src/api/snapshot'

const root = join(import.meta.dirname, '..')
const migrationsDir = join(root, 'prisma', 'migrations')
const migrations = readdirSync(migrationsDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => ({ name: d.name, sql: readFileSync(join(migrationsDir, d.name, 'migration.sql'), 'utf8') }))

const t0 = performance.now()
const pg = new PGlite()
const db = pgliteExecutor(pg, pg)
await applyMigrations(db, migrations)
const extracts = generateExtracts()
const run = await runPipeline(db, extracts)
const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) })
const api = createCaller(createContext(prisma, pgliteAnalyticsRunner(pg)))

const entries: Snapshot['entries'] = []
for (const q of SNAPSHOT_QUERIES) {
  // Walk the caller by path, e.g. "attendance.byGroup".
  const fn = q.path.split('.').reduce<any>((o, k) => o[k], api) // eslint-disable-line @typescript-eslint/no-explicit-any
  entries.push({ path: q.path, input: q.input, data: await fn(q.input) })
}

// The what-if toggle on the brief needs the impact of the day the quality gate excluded.
const overview = entries.find(e => e.path === 'quality.overview')!.data as { excluded: { rows: { work_date: string }[] } }
const day = overview.excluded.rows[0]?.work_date
if (day) entries.push({ path: 'quality.exclusionImpact', input: { day }, data: await api.quality.exclusionImpact({ day }) })

const snapshot: Snapshot = {
  asOf: extracts.asOf,
  sources: run.sources,
  rules: run.rules.length,
  entries,
}
mkdirSync(join(root, 'public'), { recursive: true })
const out = join(root, 'public', 'snapshot.json')
writeFileSync(out, JSON.stringify(snapshot))
console.log(`snapshot: ${entries.length} queries, ${(JSON.stringify(snapshot).length / 1024).toFixed(0)} KB, ${((performance.now() - t0) / 1000).toFixed(1)} s → public/snapshot.json`)
await prisma.$disconnect()
await pg.close()
