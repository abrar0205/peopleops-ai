import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { PrismaPGlite } from 'pglite-prisma-adapter'
import { PrismaClient } from '../src/generated/prisma/client'
import { pgliteAnalyticsRunner, pgliteExecutor } from '../src/db/pglite'
import { applyMigrations, runPipeline, type RunSummary } from '../src/domain/pipeline'
import { generateExtracts, type Extracts } from '../src/domain/generate'
import { createContext, type ApiContext } from '../src/api/context'
import { createCaller } from '../src/api/router'

export const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'prisma', 'migrations')

export function loadMigrations() {
  return readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => ({ name: d.name, sql: readFileSync(join(MIGRATIONS_DIR, d.name, 'migration.sql'), 'utf8') }))
}

export interface Stack {
  pg: PGlite
  prisma: PrismaClient
  ctx: ApiContext
  api: ReturnType<typeof createCaller>
  extracts: Extracts
  run: RunSummary
}

/** Full stack in-process: PGlite + migrations + pipeline + Prisma + tRPC caller. */
export async function createStack(extracts: Extracts = generateExtracts()): Promise<Stack> {
  const pg = new PGlite()
  const db = pgliteExecutor(pg, pg)
  await applyMigrations(db, loadMigrations())
  const run = await runPipeline(db, extracts)
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) })
  const ctx = createContext(prisma, pgliteAnalyticsRunner(pg))
  return { pg, prisma, ctx, api: createCaller(ctx), extracts, run }
}
