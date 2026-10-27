/**
 * Ingestion pipeline: land extracts in staging, run quality rules, load the
 * rows that pass into the core tables, record the run, refresh analytics.
 *
 * Everything happens in one transaction, so a failed run leaves the previous
 * data untouched. The same code runs on PGlite in the browser and on
 * PostgreSQL in server mode; only the SqlExecutor differs.
 */
import { RULES, type Source } from './rules'
import { DEPARTMENTS, PROGRAMS } from './scenario'
import type { Extracts } from './generate'

export interface SqlExecutor {
  exec(sql: string): Promise<void>
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>
  /** Bulk-load rows into a table (COPY on PGlite, batched INSERT on node-postgres). */
  load(table: string, columns: string[], rows: readonly (readonly unknown[])[]): Promise<void>
  transaction<T>(fn: (tx: SqlExecutor) => Promise<T>): Promise<T>
}

export interface RuleResult {
  code: string
  source: Source
  rows: number
  ms: number
}

export interface RunSummary {
  runId: number
  asOf: string
  ms: number
  sources: Record<Source, { received: number; loaded: number }>
  rules: RuleResult[]
  steps: { name: string; ms: number }[]
}

/** Called before each step. May return a promise (the browser uses it to repaint). */
export type Progress = (step: string) => void | Promise<void>

/** Apply migration files in order. Each file runs as one script. */
export async function applyMigrations(db: SqlExecutor, migrations: { name: string; sql: string }[]) {
  const sorted = [...migrations].sort((a, b) => a.name.localeCompare(b.name))
  for (const m of sorted) await db.exec(m.sql)
}

export async function runPipeline(db: SqlExecutor, extracts: Extracts, progress: Progress = () => {}): Promise<RunSummary> {
  const t0 = performance.now()
  const steps: RunSummary['steps'] = []
  const step = async <T>(name: string, fn: () => Promise<T>) => {
    await progress(name)
    const s = performance.now()
    const out = await fn()
    steps.push({ name, ms: Math.round(performance.now() - s) })
    return out
  }

  return db.transaction(async tx => {
    await tx.query(`SELECT set_config('peopleops.as_of', $1, true)`, [extracts.asOf])
    const [{ id: runId }] = await tx.query<{ id: number }>(
      `INSERT INTO pipeline_run (as_of, status) VALUES ($1::date, 'RUNNING') RETURNING id`,
      [extracts.asOf],
    )

    await step('Landing source extracts in staging', async () => {
      await tx.exec(`TRUNCATE staging.hris_employee, staging.timeclock_day, staging.lms_assignment, staging.reject`)
      await tx.load('staging.hris_employee', ['row_no', 'badge_id', 'dept_code', 'job_family', 'shift', 'contract', 'hire_date', 'exit_date', 'exit_reason'], extracts.hris)
      await tx.load('staging.timeclock_day', ['row_no', 'badge_id', 'work_date', 'scheduled_hours', 'worked_hours', 'overtime_hours', 'absence_code'], extracts.timeclock)
      await tx.load('staging.lms_assignment', ['row_no', 'badge_id', 'program_code', 'assigned_on', 'due_on', 'completed_on', 'pre_score', 'post_score'], extracts.lms)
      await tx.exec(`ANALYZE staging.hris_employee; ANALYZE staging.timeclock_day; ANALYZE staging.lms_assignment;`)
    })

    await step('Syncing reference data', async () => {
      for (const d of DEPARTMENTS) {
        await tx.query(
          `INSERT INTO department (id, code, name, area) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, area = EXCLUDED.area`,
          [d.id, d.code, d.name, d.area],
        )
      }
      for (const p of PROGRAMS) {
        await tx.query(
          `INSERT INTO training_program (id, code, name, category, mandatory) VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (id) DO UPDATE SET code = EXCLUDED.code, name = EXCLUDED.name, category = EXCLUDED.category, mandatory = EXCLUDED.mandatory`,
          [p.id, p.code, p.name, p.category, p.mandatory],
        )
      }
    })

    const rules: RuleResult[] = []
    await step(`Running ${RULES.length} data-quality rules`, async () => {
      for (const rule of RULES) {
        const s = performance.now()
        await tx.exec(rule.sql)
        const [{ n }] = await tx.query<{ n: number }>(`SELECT count(*)::int AS n FROM staging.reject WHERE rule_code = $1`, [rule.code])
        rules.push({ code: rule.code, source: rule.source, rows: n, ms: Math.round(performance.now() - s) })
      }
    })

    await step('Recording quality issues', async () => {
      const severities = RULES.map(r => `('${r.code}', '${r.severity}')`).join(', ')
      await tx.query(
        `INSERT INTO quality_issue (run_id, rule_code, source, source_key, row_count, detail, severity)
         SELECT $1, r.rule_code, r.source, r.source_key, count(*)::int,
                (array_agg(r.detail ORDER BY r.row_no))[1], s.severity::"Severity"
         FROM staging.reject r
         JOIN (VALUES ${severities}) AS s(code, severity) ON s.code = r.rule_code
         GROUP BY r.rule_code, r.source, r.source_key, s.severity`,
        [runId],
      )
    })

    const loaded = await step('Loading validated rows into core tables', async () => {
      // Full refresh: the extracts are complete snapshots.
      await tx.exec(`TRUNCATE attendance_day, training_assignment, employee RESTART IDENTITY`)
      const blocked = (alias: string, source: Source) =>
        `NOT EXISTS (SELECT 1 FROM staging.reject r WHERE r.source = '${source}' AND r.row_no = ${alias}.row_no AND r.blocking)`
      const [emp] = await tx.query<{ n: number }>(`
        WITH ins AS (
          INSERT INTO employee (badge_id, department_id, job_family, shift, contract_type, hire_date, exit_date, exit_type)
          SELECT h.badge_id, d.id, h.job_family,
                 (CASE h.shift WHEN 'E' THEN 'EARLY' WHEN 'L' THEN 'LATE' WHEN 'N' THEN 'NIGHT' END)::"Shift",
                 (CASE h.contract WHEN 'FT' THEN 'FIXED_TERM' ELSE 'PERMANENT' END)::"ContractType",
                 h.hire_date, h.exit_date,
                 (CASE h.exit_reason WHEN 'Resignation' THEN 'VOLUNTARY' WHEN 'Dismissal' THEN 'INVOLUNTARY'
                                     WHEN 'Contract end' THEN 'END_OF_CONTRACT' END)::"ExitType"
          FROM staging.hris_employee h
          JOIN department d ON d.code = h.dept_code
          WHERE ${blocked('h', 'hris')}
          RETURNING 1
        ) SELECT count(*)::int AS n FROM ins`)
      // Bulk-load pattern: drop the FK and secondary index on the largest
      // table, load, then re-create them. Postgres validates the FK for all
      // rows in one pass, which is several times faster than per-row checks.
      await tx.exec(`ALTER TABLE attendance_day DROP CONSTRAINT attendance_day_employee_id_fkey;
                     DROP INDEX attendance_day_work_date_idx;`)
      const [att] = await tx.query<{ n: number }>(`
        WITH ins AS (
          INSERT INTO attendance_day (employee_id, work_date, scheduled_hours, worked_hours, overtime_hours, absence_code)
          SELECT e.id, t.work_date, t.scheduled_hours, t.worked_hours, t.overtime_hours,
                 -- Business rule: a scheduled shift with no punches and no absence code is a no-show.
                 (CASE WHEN t.absence_code IS NULL AND t.scheduled_hours > 0 AND t.worked_hours = 0
                       THEN 'UNEXCUSED' ELSE t.absence_code END)::"AbsenceCode"
          FROM staging.timeclock_day t
          JOIN employee e ON e.badge_id = t.badge_id
          WHERE ${blocked('t', 'timeclock')}
          RETURNING 1
        ) SELECT count(*)::int AS n FROM ins`)
      await tx.exec(`ALTER TABLE attendance_day ADD CONSTRAINT attendance_day_employee_id_fkey
                       FOREIGN KEY (employee_id) REFERENCES employee(id) ON DELETE RESTRICT ON UPDATE CASCADE;
                     CREATE INDEX attendance_day_work_date_idx ON attendance_day(work_date);`)
      const [trn] = await tx.query<{ n: number }>(`
        WITH ins AS (
          INSERT INTO training_assignment (employee_id, program_id, assigned_on, due_on, completed_on, pre_score, post_score)
          SELECT e.id, p.id, l.assigned_on, l.due_on, l.completed_on, l.pre_score, l.post_score
          FROM staging.lms_assignment l
          JOIN employee e ON e.badge_id = l.badge_id
          JOIN training_program p ON p.code = l.program_code
          WHERE ${blocked('l', 'lms')}
          RETURNING 1
        ) SELECT count(*)::int AS n FROM ins`)
      await tx.exec(`ANALYZE employee; ANALYZE attendance_day; ANALYZE training_assignment;`)
      return { hris: emp.n, timeclock: att.n, lms: trn.n }
    })

    const sources = {
      hris: { received: extracts.hris.length, loaded: loaded.hris },
      timeclock: { received: extracts.timeclock.length, loaded: loaded.timeclock },
      lms: { received: extracts.lms.length, loaded: loaded.lms },
    }

    await tx.query(
      `UPDATE pipeline_run SET status = 'SUCCEEDED', finished_at = now(), stats = $2::jsonb WHERE id = $1`,
      [runId, JSON.stringify({ sources, rules, steps })],
    )

    await step('Refreshing analytics views', () => tx.exec(`SELECT analytics.refresh()`))

    return { runId, asOf: extracts.asOf, ms: Math.round(performance.now() - t0), sources, rules, steps }
  })
}
