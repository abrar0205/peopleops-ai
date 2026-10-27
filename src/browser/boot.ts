/**
 * Boots the whole backend inside the browser tab:
 * PostgreSQL (PGlite, WASM) -> migrations -> synthetic extracts -> pipeline
 * -> Prisma Client -> tRPC router. Nothing leaves the browser.
 */
import type { PGlite } from '@electric-sql/pglite'
import type { PrismaClient } from '../generated/prisma/client'
import { pgliteAnalyticsRunner, pgliteExecutor } from '../db/pglite'
import { applyMigrations, runPipeline, type RunSummary } from '../domain/pipeline'
import { generateExtracts, type Extracts } from '../domain/generate'
import { createContext, type ApiContext } from '../api/context'

export interface BootStep {
  label: string
  ms?: number
  detail?: string
}

export interface Backend {
  pg: PGlite
  prisma: PrismaClient
  ctx: ApiContext
  extracts: Extracts
  run: RunSummary
  bootMs: number
  rerun(onStep?: (s: string) => void): Promise<RunSummary>
}

const migrations = import.meta.glob('/prisma/migrations/*/migration.sql', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

const repaint = () => new Promise<void>(r => requestAnimationFrame(() => setTimeout(r, 0)))

export async function bootBackend(onStep: (steps: BootStep[]) => void): Promise<Backend> {
  const steps: BootStep[] = []
  const t0 = performance.now()
  let last = performance.now()
  const mark = async (label: string, detail?: string) => {
    const now = performance.now()
    if (steps.length) steps[steps.length - 1].ms = Math.round(now - last)
    last = now
    steps.push({ label, detail })
    onStep([...steps])
    await repaint()
  }

  // Fetch Prisma's client and query compiler while the database boots.
  const prismaModules = Promise.all([import('../generated/prisma-browser/client'), import('pglite-prisma-adapter')])
  await mark('Starting PostgreSQL in the browser', 'PGlite: Postgres compiled to WebAssembly')
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = await PGlite.create()
  const db = pgliteExecutor(pg, pg)

  await mark('Applying schema migrations', `${Object.keys(migrations).length} migrations from prisma/migrations`)
  await applyMigrations(db, Object.entries(migrations).map(([path, sql]) => ({ name: path, sql })))

  await mark('Generating source-system extracts', 'HR master data, time clock, LMS — synthetic, with injected defects')
  const extracts = generateExtracts()

  const run = await runPipeline(db, extracts, step => mark(step))

  await mark('Starting Prisma Client and tRPC API')
  const [{ PrismaClient }, { PrismaPGlite }] = await prismaModules
  const prisma = new PrismaClient({ adapter: new PrismaPGlite(pg) }) as unknown as PrismaClient
  await prisma.pipelineRun.count()
  await mark('Ready')

  return {
    pg,
    prisma,
    ctx: createContext(prisma, pgliteAnalyticsRunner(pg)),
    extracts,
    run,
    bootMs: Math.round(performance.now() - t0),
    rerun: async onStepRerun => runPipeline(db, extracts, async s => { onStepRerun?.(s); await repaint() }),
  }
}
