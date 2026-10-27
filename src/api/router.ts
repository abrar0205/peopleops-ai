import { initTRPC, TRPCError } from '@trpc/server'
import { z } from 'zod'
import type { ApiContext } from './context'
import { normalizeSql } from './context'
import * as q from './queries'
import { answerQuestion, detectSignals, runTool, toolCatalog } from './insights'
import { EXAMPLE_QUERIES, runConsoleQuery } from './console'
import { METRICS, PRIVACY_RULES } from './catalog'
import { RULES } from '../domain/rules'
import { DEPARTMENTS, PROGRAMS } from '../domain/scenario'
import type { RunSummary } from '../domain/pipeline'

// The router also runs inside the browser tab (via localLink), so allow non-server environments.
const t = initTRPC.context<ApiContext>().create({ allowOutsideOfServer: true })
const publicProcedure = t.procedure

const meta = t.router({
  status: publicProcedure.query(async ({ ctx }) => {
    const run = await ctx.prisma.pipelineRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { id: 'desc' } })
    if (!run) throw new TRPCError({ code: 'PRECONDITION_FAILED', message: 'No successful pipeline run yet' })
    const openIssues = await ctx.prisma.qualityIssue.count({ where: { runId: run.id, status: 'OPEN' } })
    const stats = run.stats as unknown as Pick<RunSummary, 'sources' | 'rules' | 'steps'>
    return {
      runId: run.id,
      asOf: run.asOf.toISOString().slice(0, 10),
      startedAt: run.startedAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
      stats,
      openIssues,
    }
  }),
  reference: publicProcedure.query(() => ({
    departments: DEPARTMENTS.map(d => ({ code: d.code, name: d.name, area: d.area })),
    programs: PROGRAMS.map(p => ({ code: p.code, name: p.name, category: p.category, mandatory: p.mandatory })),
    metrics: METRICS,
    privacy: PRIVACY_RULES,
  })),
})

const kpi = t.router({
  summary: publicProcedure.query(({ ctx }) => q.kpiSummary(ctx)),
})

const Weeks = z.number().int().min(1).max(26).default(4)

const attendance = t.router({
  weekly: publicProcedure
    .input(z.object({ department: q.DepartmentCode, shift: q.ShiftCode }))
    .query(({ ctx, input }) => q.attendanceWeekly(ctx, input.department, input.shift)),
  byGroup: publicProcedure
    .input(z.object({ by: q.GroupBy, weeks: Weeks }))
    .query(({ ctx, input }) => q.attendanceByGroup(ctx, input.by, input.weeks)),
  weekday: publicProcedure
    .input(z.object({ department: q.DepartmentCode }))
    .query(({ ctx, input }) => q.absenceByWeekday(ctx, input.department)),
})

const workforce = t.router({
  attritionTrend: publicProcedure
    .input(z.object({ department: q.DepartmentCode, shift: q.ShiftCode }))
    .query(({ ctx, input }) => q.attritionTrend(ctx, input.department, input.shift)),
  attritionByGroup: publicProcedure.input(z.object({ by: q.GroupBy })).query(({ ctx, input }) => q.attritionByGroup(ctx, input.by)),
  exitReasons: publicProcedure.query(({ ctx }) => q.exitComposition(ctx)),
  earlyAttrition: publicProcedure.input(z.object({ by: q.GroupBy })).query(({ ctx, input }) => q.earlyAttrition(ctx, input.by)),
  headcount: publicProcedure.input(z.object({ department: q.DepartmentCode })).query(({ ctx, input }) => q.headcountTrend(ctx, input.department)),
})

const training = t.router({
  programs: publicProcedure.query(({ ctx }) => q.trainingPrograms(ctx)),
  overdueByDepartment: publicProcedure.query(({ ctx }) => q.mandatoryOverdueByDepartment(ctx)),
})

const IssueStatus = z.enum(['OPEN', 'ACKNOWLEDGED', 'OVERRIDDEN'])

const quality = t.router({
  overview: publicProcedure.query(async ({ ctx }) => {
    const [health, summary, excluded] = await Promise.all([q.dataHealth(ctx), q.qualityRuleSummary(ctx), q.excludedDays(ctx)])
    const run = await ctx.prisma.pipelineRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { id: 'desc' } })
    const stats = run?.stats as unknown as RunSummary | undefined
    const rules = RULES.map(r => {
      const rows = summary.rows.filter(s => s.rule_code === r.code)
      const timing = stats?.rules.find(s => s.code === r.code)
      return {
        code: r.code, source: r.source, severity: r.severity, blocking: r.blocking, title: r.title, why: r.why, action: r.action,
        sql: normalizeSql(r.sql),
        issues: rows.reduce((s, x) => s + x.issues, 0),
        openIssues: rows.filter(x => x.status === 'OPEN').reduce((s, x) => s + x.issues, 0),
        affectedRows: rows.reduce((s, x) => s + x.affected_rows, 0),
        ms: timing?.ms ?? null,
      }
    })
    return { health, rules, excluded, steps: stats?.steps ?? [] }
  }),

  issues: publicProcedure
    .input(z.object({ ruleCode: z.string().optional(), status: IssueStatus.optional(), take: z.number().int().min(1).max(200).default(50) }))
    .query(async ({ ctx, input }) => {
      const run = await ctx.prisma.pipelineRun.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { id: 'desc' }, select: { id: true } })
      const where = { runId: run?.id ?? -1, ruleCode: input.ruleCode, status: input.status }
      const [items, total] = await Promise.all([
        ctx.prisma.qualityIssue.findMany({ where, orderBy: [{ status: 'asc' }, { rowCount: 'desc' }, { id: 'asc' }], take: input.take }),
        ctx.prisma.qualityIssue.count({ where }),
      ])
      return {
        total,
        items: items.map(i => ({ ...i, reviewedAt: i.reviewedAt?.toISOString() ?? null })),
      }
    }),

  /** Review an issue. Overriding a day exclusion changes KPIs immediately. */
  review: publicProcedure
    .input(z.object({ id: z.number().int(), status: IssueStatus, note: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const issue = await ctx.prisma.qualityIssue.findUnique({ where: { id: input.id } })
      if (!issue) throw new TRPCError({ code: 'NOT_FOUND' })
      if (input.status === 'OVERRIDDEN' && issue.ruleCode !== 'TC_MISSING_PUNCHES') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only day exclusions can be overridden; held-back rows need a corrected source delivery.' })
      }
      const updated = await ctx.prisma.qualityIssue.update({
        where: { id: input.id },
        data: {
          status: input.status,
          reviewNote: input.note || null,
          reviewedAt: input.status === 'OPEN' ? null : new Date(),
        },
      })
      if (issue.ruleCode === 'TC_MISSING_PUNCHES') await ctx.prisma.$executeRawUnsafe('SELECT analytics.refresh()')
      return { ...updated, reviewedAt: updated.reviewedAt?.toISOString() ?? null }
    }),

  /** What an excluded day would do to the weekly plant absence rate (plant-level aggregates only). */
  exclusionImpact: publicProcedure.input(z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).query(async ({ ctx, input }) => {
    const e = await ctx.analytics<{ included: boolean; unplanned_absence_rate: number }>(
      `SELECT included, unplanned_absence_rate FROM analytics.exclusion_impact($1::date)`,
      [input.day],
    )
    return {
      withDay: e.rows.find(r => r.included)?.unplanned_absence_rate ?? null,
      withoutDay: e.rows.find(r => !r.included)?.unplanned_absence_rate ?? null,
      evidence: e,
    }
  }),
})

const insights = t.router({
  signals: publicProcedure.query(({ ctx }) => detectSignals(ctx)),
  ask: publicProcedure.input(z.object({ question: z.string().trim().min(2).max(500) })).mutation(({ ctx, input }) => answerQuestion(ctx, input.question)),
  tools: publicProcedure.query(() => toolCatalog()),
  runTool: publicProcedure
    .input(z.object({ name: z.string(), input: z.unknown() }))
    .mutation(({ ctx, input }) => runTool(ctx, input.name, input.input)),
})

const sql = t.router({
  run: publicProcedure.input(z.object({ sql: z.string().max(10_000) })).mutation(({ ctx, input }) => runConsoleQuery(ctx, input.sql)),
  examples: publicProcedure.query(() => EXAMPLE_QUERIES),
  /** Views and columns the analyst role can read. */
  schema: publicProcedure.query(async ({ ctx }) => {
    const r = await ctx.analytics<{ view: string; column_name: string; data_type: string }>(`
      SELECT c.relname AS view, a.attname AS column_name, format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
      WHERE n.nspname = 'analytics' AND c.relkind IN ('v', 'm')
      ORDER BY c.relname, a.attnum`)
    const views = new Map<string, { name: string; type: string }[]>()
    for (const row of r.rows) views.set(row.view, [...(views.get(row.view) ?? []), { name: row.column_name, type: row.data_type }])
    return [...views].map(([name, columns]) => ({ name, columns }))
  }),
})

export const appRouter = t.router({ meta, kpi, attendance, workforce, training, quality, insights, sql })
export type AppRouter = typeof appRouter
export const createCaller = t.createCallerFactory(appRouter)
