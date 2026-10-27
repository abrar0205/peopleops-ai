/**
 * Runs the ingestion pipeline against PostgreSQL.
 *   DATABASE_URL=... npm run pipeline
 * Apply migrations first with `npm run db:migrate` (prisma migrate deploy).
 */
import pg from 'pg'
import { generateExtracts } from '../src/domain/generate'
import { runPipeline } from '../src/domain/pipeline'
import { databaseUrl, pgExecutor } from './db'

const pool = new pg.Pool({ connectionString: databaseUrl() })
const summary = await runPipeline(pgExecutor(pool, pool), generateExtracts(), step => console.log(`• ${step}`))
console.log(`\nRun #${summary.runId} finished in ${(summary.ms / 1000).toFixed(1)} s`)
for (const [source, s] of Object.entries(summary.sources)) console.log(`  ${source.padEnd(10)} received ${String(s.received).padStart(7)}  loaded ${String(s.loaded).padStart(7)}`)
await pool.end()
