/**
 * Insight layer: signal detection, a tool catalog over approved aggregate
 * queries, and a rule-based question router that answers with evidence.
 *
 * Nothing here reads raw records. Tools only call functions in queries.ts,
 * which only read the analytics schema as the analyst role. The optional LLM
 * mode (browser/llm.ts) gets exactly the same tools, so it cannot see more
 * than the dashboards can.
 */
import { z } from 'zod'
import type { ApiContext, Evidence } from './context'
import * as q from './queries'
import { departmentName, groupLabel, shiftName } from './queries'
import { DEPARTMENTS } from '../domain/scenario'

// ------------------------------------------------------------------ signals

export interface Signal {
  id: string
  area: 'attendance' | 'attrition' | 'training' | 'data'
  severity: 'high' | 'medium' | 'info'
  title: string
  detail: string
  stats: { label: string; value: string }[]
  method: string
  department?: string
  shift?: string
  question: string
  evidence: Evidence[]
}

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
const sd = (xs: number[]) => {
  const m = mean(xs)
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, xs.length - 1))
}
const fmt = (x: number, d = 1) => x.toFixed(d)
const RECENT_WEEKS = 6
const BASELINE_WEEKS = 12

/**
 * Week-over-week shifts are judged against the rest of the plant, so plant-wide
 * seasonality (summer holidays, flu season) does not trigger signals. For each
 * department x shift we take the weekly gap to the plant rate, then compare the
 * mean gap of the last 6 weeks with the 12 weeks before, in units of the
 * baseline's own week-to-week noise.
 */
async function attendanceSignals(ctx: ApiContext): Promise<Signal[]> {
  const weekly = await ctx.analytics<{ department_code: string; shift: string; week_start: string; unplanned_absence_rate: number; overtime_hours_per_head: number; employees: number }>(`
    SELECT department_code, shift, week_start::text, unplanned_absence_rate, overtime_hours_per_head, employees
    FROM attendance_weekly
    WHERE NOT suppressed
      AND shift <> 'UNASSIGNED'
      AND ((department_code <> 'ALL' AND shift <> 'ALL') OR (department_code = 'ALL' AND shift = 'ALL'))
      AND week_start > (SELECT max(week_start) FROM attendance_weekly) - 7 * ${RECENT_WEEKS + BASELINE_WEEKS}
    ORDER BY department_code, shift, week_start`)
  const plant = new Map(weekly.rows.filter(r => r.department_code === 'ALL').map(r => [r.week_start, r]))
  const groups = new Map<string, typeof weekly.rows>()
  for (const r of weekly.rows) {
    if (r.department_code === 'ALL') continue
    const k = `${r.department_code}|${r.shift}`
    groups.set(k, [...(groups.get(k) ?? []), r])
  }
  const metrics = [
    { key: 'unplanned_absence_rate' as const, label: 'Unplanned absence', unit: '%', minDelta: 1.0, digits: 1 },
    { key: 'overtime_hours_per_head' as const, label: 'Overtime', unit: ' h/week', minDelta: 0.4, digits: 2 },
  ]
  const out: Signal[] = []
  for (const [k, rows] of groups) {
    if (rows.length < RECENT_WEEKS + BASELINE_WEEKS) continue
    const [dept, shift] = k.split('|')
    for (const m of metrics) {
      const gaps = rows.map(r => r[m.key] - plant.get(r.week_start)![m.key])
      const base = gaps.slice(0, BASELINE_WEEKS)
      const recent = gaps.slice(BASELINE_WEEKS)
      const delta = mean(recent) - mean(base)
      const z = delta / (sd(base) * Math.sqrt(1 / RECENT_WEEKS + 1 / BASELINE_WEEKS))
      if (z < 3 || delta < m.minDelta) continue
      const groupRecent = mean(rows.slice(BASELINE_WEEKS).map(r => r[m.key]))
      const groupBase = mean(rows.slice(0, BASELINE_WEEKS).map(r => r[m.key]))
      const plantRecent = mean(rows.slice(BASELINE_WEEKS).map(r => plant.get(r.week_start)![m.key]))
      out.push({
        id: `${m.key}:${k}`,
        area: 'attendance',
        severity: z >= 4.5 ? 'high' : 'medium',
        title: `${m.label} rising on ${departmentName(dept)} ${shiftName(shift)}`,
        detail: `${m.label} averaged ${fmt(groupRecent, m.digits)}${m.unit} over the last ${RECENT_WEEKS} weeks, up from ${fmt(groupBase, m.digits)}${m.unit} in the ${BASELINE_WEEKS} weeks before. The plant averaged ${fmt(plantRecent, m.digits)}${m.unit}, so the gap to the plant widened by ${fmt(delta, m.digits)}${m.unit.trim() === '%' ? ' pts' : m.unit}.`,
        stats: [
          { label: `Last ${RECENT_WEEKS} wks`, value: `${fmt(groupRecent, m.digits)}${m.unit}` },
          { label: `Prior ${BASELINE_WEEKS} wks`, value: `${fmt(groupBase, m.digits)}${m.unit}` },
          { label: 'Plant now', value: `${fmt(plantRecent, m.digits)}${m.unit}` },
          { label: 'z', value: fmt(z, 1) },
          { label: 'People', value: String(rows.at(-1)!.employees) },
        ],
        method: 'Gap to plant, last 6 weeks vs. previous 12, in standard errors of the weekly gap (flagged at z ≥ 3).',
        department: dept,
        shift,
        question: `How has ${m.key === 'overtime_hours_per_head' ? 'overtime' : 'absence'} on ${departmentName(dept)} ${shiftName(shift)} changed?`,
        evidence: [weekly],
      })
    }
  }
  return out
}

async function attritionSignals(ctx: ApiContext): Promise<Signal[]> {
  const [early, reasons] = await Promise.all([q.earlyAttrition(ctx, 'department_shift'), q.exitComposition(ctx)])
  const out: Signal[] = []
  const plant = early.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')
  if (plant?.early_exits != null) {
    for (const g of early.rows) {
      if (g.department_code === 'ALL' || g.suppressed || g.early_exits == null || g.early_exits < 3) continue
      const restHires = plant.hires - g.hires
      const restExits = plant.early_exits - g.early_exits
      const pG = g.early_exits / g.hires
      const pRest = restExits / restHires
      const pool = plant.early_exits / plant.hires
      const z = (pG - pRest) / Math.sqrt(pool * (1 - pool) * (1 / g.hires + 1 / restHires))
      if (z < 2 || pG < 2 * pRest) continue
      out.push({
        id: `early:${g.department_code}|${g.shift}`,
        area: 'attrition',
        severity: z >= 3 ? 'high' : 'medium',
        title: `New starters leaving early on ${groupLabel(g.department_code, g.shift)}`,
        detail: `${g.early_exits} of ${g.hires} people hired 3–12 months ago left within their first 90 days (${fmt(100 * pG)}%), against ${fmt(100 * pRest)}% for the rest of the plant. Small numbers: treat as a prompt to talk to the team and review onboarding, not as a conclusion.`,
        stats: [
          { label: '90-day attrition', value: `${fmt(100 * pG)}%` },
          { label: 'Rest of plant', value: `${fmt(100 * pRest)}%` },
          { label: 'Hires', value: String(g.hires) },
          { label: 'z', value: fmt(z, 1) },
        ],
        method: 'Two-proportion z-test against the rest of the plant (flagged at z ≥ 2, at least 3 early exits and twice the plant rate).',
        department: g.department_code,
        shift: g.shift,
        question: `Where are new hires leaving within 90 days?`,
        evidence: [early],
      })
    }
  }
  for (const r of reasons.rows) {
    if (r.department_code === 'ALL' || r.exits < 10) continue
    const share = r.contract_end / r.exits
    if (share < 0.4) continue
    out.push({
      id: `contract-end:${r.department_code}`,
      area: 'attrition',
      severity: 'info',
      title: `${departmentName(r.department_code)} attrition is mostly contract ends`,
      detail: `${r.contract_end} of ${r.exits} exits in the last 12 months were fixed-term contracts that ended (${fmt(100 * share, 0)}%); ${r.voluntary} were resignations. The headline attrition rate overstates a retention problem here; conversion policy is the lever, not engagement.`,
      stats: [
        { label: 'Exits, 12m', value: String(r.exits) },
        { label: 'Contract ends', value: String(r.contract_end) },
        { label: 'Resignations', value: String(r.voluntary) },
      ],
      method: 'Exit reasons over the last 12 months; flagged when contract ends are at least 40% of 10+ exits.',
      department: r.department_code,
      shift: 'ALL',
      question: `Why are people leaving ${departmentName(r.department_code)}?`,
      evidence: [reasons],
    })
  }
  return out
}

async function trainingSignals(ctx: ApiContext): Promise<Signal[]> {
  const [programs, overdue, overtime] = await Promise.all([
    q.trainingPrograms(ctx),
    q.mandatoryOverdueByDepartment(ctx),
    q.attendanceByGroup(ctx, 'department', 4),
  ])
  const out: Signal[] = []
  for (const p of programs.rows) {
    if (p.on_time_completion_rate == null || p.avg_score_uplift == null) continue
    if (p.on_time_completion_rate >= 90 && p.avg_score_uplift < 3) {
      out.push({
        id: `effectiveness:${p.program_code}`,
        area: 'training',
        severity: 'medium',
        title: `${p.program_name}: completed, but little is learned`,
        detail: `${fmt(p.on_time_completion_rate)}% complete on time, yet assessment scores improve by only ${fmt(p.avg_score_uplift)} points between pre- and post-test. Completion compliance looks perfect while the course adds little; review the content or test difficulty before reporting it as a safety win.`,
        stats: [
          { label: 'On time', value: `${fmt(p.on_time_completion_rate)}%` },
          { label: 'Score uplift', value: `+${fmt(p.avg_score_uplift)} pts` },
          { label: 'Pass rate', value: `${fmt(p.pass_rate ?? 0)}%` },
          { label: 'Scored', value: String(p.scored_assignments) },
        ],
        method: 'Flagged when on-time completion is at least 90% and mean pre/post score uplift is below 3 points.',
        question: 'Which training programs are effective?',
        evidence: [programs],
      })
    }
  }
  const total = overdue.rows.reduce((s, r) => ({ due: s.due + r.assignments_due, over: s.over + r.overdue }), { due: 0, over: 0 })
  const plantRate = (100 * total.over) / total.due
  const otRank = [...overtime.rows].filter(r => r.department_code !== 'ALL').sort((a, b) => (b.overtime_hours_per_head ?? 0) - (a.overtime_hours_per_head ?? 0))
  const plantOt = overtime.rows.find(r => r.department_code === 'ALL')?.overtime_hours_per_head ?? 0
  for (const r of overdue.rows) {
    if (r.overdue_rate < 8 || r.overdue_rate < 2 * plantRate) continue
    const ot = otRank.find(o => o.department_code === r.department_code)
    const rank = otRank.indexOf(ot!) + 1
    out.push({
      id: `overdue:${r.department_code}`,
      area: 'training',
      severity: 'high',
      title: `${departmentName(r.department_code)} is behind on mandatory safety training`,
      detail: `${r.overdue} mandatory assignments are overdue (${fmt(r.overdue_rate)}% vs. ${fmt(plantRate)}% plant-wide).${rank === 1 && ot ? ` The department also has the highest overtime in the plant (${fmt(ot.overtime_hours_per_head ?? 0, 2)} h per head per week vs. ${fmt(plantOt, 2)} h), so capacity is the likely constraint rather than willingness.` : ''}`,
      stats: [
        { label: 'Overdue', value: String(r.overdue) },
        { label: 'Overdue rate', value: `${fmt(r.overdue_rate)}%` },
        { label: 'Plant', value: `${fmt(plantRate)}%` },
        ...(ot ? [{ label: 'Overtime rank', value: `#${rank} of ${otRank.length}` }] : []),
      ],
      method: 'Flagged when the overdue rate is at least 8% and twice the plant rate; cross-checked against overtime per head.',
      department: r.department_code,
      shift: 'ALL',
      question: 'Which departments are behind on mandatory training?',
      evidence: [overdue, overtime],
    })
  }
  return out
}

async function dataSignals(ctx: ApiContext): Promise<Signal[]> {
  const [excluded, rules] = await Promise.all([q.excludedDays(ctx), q.qualityRuleSummary(ctx)])
  const out: Signal[] = []
  for (const d of excluded.rows) {
    out.push({
      id: `excluded:${d.work_date}`,
      area: 'data',
      severity: 'info',
      title: `${d.work_date} is excluded from attendance KPIs`,
      detail: 'Punch data for most shifts on this day never arrived. Counted as no-shows, it would read as a plant-wide absence spike. Review the issue in Data quality to keep or override the exclusion.',
      stats: [{ label: 'Status', value: d.issue_status.toLowerCase() }],
      method: 'Rule TC_MISSING_PUNCHES: share of scheduled shifts with no punches and no absence code above 5% and five times the usual share for that weekday.',
      question: 'Can I trust the data?',
      evidence: [excluded],
    })
  }
  const openErrors = rules.rows.filter(r => r.status === 'OPEN' && r.severity === 'ERROR')
  const issues = openErrors.reduce((s, r) => s + r.issues, 0)
  if (issues > 0) {
    out.push({
      id: 'open-errors',
      area: 'data',
      severity: 'info',
      title: `${issues} open data errors need an owner`,
      detail: `Rows behind these issues are held back from KPIs. Largest: ${openErrors.sort((a, b) => b.affected_rows - a.affected_rows).slice(0, 2).map(r => `${r.rule_code} (${r.affected_rows} rows)`).join(', ')}.`,
      stats: [{ label: 'Open errors', value: String(issues) }],
      method: 'Open issues with severity ERROR from the latest pipeline run.',
      question: 'Can I trust the data?',
      evidence: [rules],
    })
  }
  return out
}

const SEVERITY_ORDER = { high: 0, medium: 1, info: 2 }

export async function detectSignals(ctx: ApiContext): Promise<Signal[]> {
  const all = (await Promise.all([attendanceSignals(ctx), attritionSignals(ctx), trainingSignals(ctx), dataSignals(ctx)])).flat()
  return all.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

// -------------------------------------------------------------------- tools

const Metric = z.enum(['unplanned_absence', 'overtime', 'attrition', 'voluntary_attrition', 'early_attrition'])

export interface ToolResult {
  data: unknown
  evidence: Evidence[]
}

interface Tool<I extends z.ZodType> {
  name: string
  description: string
  input: I
  run(ctx: ApiContext, input: z.infer<I>): Promise<ToolResult>
}

const tool = <I extends z.ZodType>(t: Tool<I>) => t

export const TOOLS = [
  tool({
    name: 'kpi_summary',
    description: 'Plant-level headline KPIs: headcount, unplanned absence, overtime per head, trailing-12-month attrition, mandatory training on time, share of data reaching KPIs.',
    input: z.object({}),
    async run(ctx) {
      const tiles = await q.kpiSummary(ctx)
      return { data: tiles.map(({ evidence: _e, spark: _s, ...t }) => t), evidence: tiles.map(t => t.evidence) }
    },
  }),
  tool({
    name: 'attendance_trend',
    description: 'Weekly unplanned absence rate (%) and overtime hours per head for one department and/or shift over the last 26 weeks. Use department "ALL" and/or shift "ALL" for totals.',
    input: z.object({ department: q.DepartmentCode.default('ALL'), shift: q.ShiftCode.default('ALL') }),
    async run(ctx, i) {
      const e = await q.attendanceWeekly(ctx, i.department, i.shift)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'compare_groups',
    description: 'Compare a metric across departments, shifts, or department x shift. Absence and overtime use the last `weeks` weeks; attrition uses the trailing 12 months; early_attrition is the share of hires leaving within 90 days. Rows for groups under 10 people are suppressed.',
    input: z.object({ metric: Metric, by: q.GroupBy.default('department'), weeks: z.number().int().min(1).max(26).default(4) }),
    async run(ctx, i) {
      if (i.metric === 'unplanned_absence' || i.metric === 'overtime') {
        const e = await q.attendanceByGroup(ctx, i.by, i.weeks)
        return { data: e.rows, evidence: [e] }
      }
      if (i.metric === 'early_attrition') {
        const e = await q.earlyAttrition(ctx, i.by)
        return { data: e.rows, evidence: [e] }
      }
      const e = await q.attritionByGroup(ctx, i.by)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'attrition_trend',
    description: 'Monthly trailing-12-month attrition and voluntary attrition (%) for a department and/or shift.',
    input: z.object({ department: q.DepartmentCode.default('ALL'), shift: q.ShiftCode.default('ALL') }),
    async run(ctx, i) {
      const e = await q.attritionTrend(ctx, i.department, i.shift)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'exit_reasons',
    description: 'Exits in the last 12 months by department, split into resignations (voluntary), dismissals (involuntary) and fixed-term contract ends.',
    input: z.object({}),
    async run(ctx) {
      const e = await q.exitComposition(ctx)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'training_programs',
    description: 'Per training program: on-time completion rate, overdue count, mean pre/post assessment score uplift (effectiveness) and pass rate.',
    input: z.object({}),
    async run(ctx) {
      const e = await q.trainingPrograms(ctx)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'training_overdue_by_department',
    description: 'Mandatory training compliance per department: assignments due, overdue, overdue rate and on-time rate.',
    input: z.object({}),
    async run(ctx) {
      const e = await q.mandatoryOverdueByDepartment(ctx)
      return { data: e.rows, evidence: [e] }
    },
  }),
  tool({
    name: 'data_quality',
    description: 'Data health per source system (rows received, usable, held back) and quality issues by rule and status from the latest pipeline run. Use before trusting a surprising number.',
    input: z.object({}),
    async run(ctx) {
      const [h, r, x] = await Promise.all([q.dataHealth(ctx), q.qualityRuleSummary(ctx), q.excludedDays(ctx)])
      return { data: { health: h.rows, issues: r.rows, excludedDays: x.rows }, evidence: [h, r, x] }
    },
  }),
  tool({
    name: 'signals',
    description: 'Automatically detected changes worth investigating, each with the statistical method used and supporting numbers.',
    input: z.object({}),
    async run(ctx) {
      const s = await detectSignals(ctx)
      return { data: s.map(({ evidence: _e, ...rest }) => rest), evidence: s.flatMap(x => x.evidence) }
    },
  }),
] as const

export type ToolName = (typeof TOOLS)[number]['name']

export function toolCatalog() {
  return TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: z.toJSONSchema(t.input, { io: 'input' }) as Record<string, unknown> }))
}

export async function runTool(ctx: ApiContext, name: string, input: unknown): Promise<ToolResult> {
  const t = TOOLS.find(x => x.name === name)
  if (!t) throw new Error(`Unknown tool ${name}`)
  // Each tool validates its own input; the cast only bridges the union type.
  return (t as unknown as Tool<z.ZodType>).run(ctx, t.input.parse(input ?? {}))
}

// --------------------------------------------------------- rule-based answers

export interface Answer {
  text: string
  kind: 'answer' | 'refusal' | 'help'
  tools: { name: string; input: unknown }[]
  evidence: Evidence[]
  followUps: string[]
}

const DEPT_ALIASES: [RegExp, string][] = [
  [/\b(general assembly|assembly|\bga\b)/i, 'GA'],
  [/\b(body in white|body-in-white|biw|body shop)\b/i, 'BIW'],
  [/\b(paint)/i, 'PNT'],
  [/\b(logistic|warehouse|forklift|\blog\b)/i, 'LOG'],
  [/\b(quality\s+(dept|department|team|inspectors?)|\bqlt\b|inspection)/i, 'QLT'],
  [/\b(maintenance|\bmnt\b|technicians?)\b/i, 'MNT'],
  [/\b(cell|battery|\bcel\b)/i, 'CEL'],
]
const SHIFT_ALIASES: [RegExp, string][] = [
  [/\bnight/i, 'NIGHT'],
  [/\blate\b|\bafternoon/i, 'LATE'],
  [/\bearly\s+shift|\bmorning/i, 'EARLY'],
]

/** Questions about individuals are out of scope by design. */
const INDIVIDUAL = /\b(who\b|whom|which (employee|person|people|worker|individual)s?|names?\b|badge|employee id|list (of )?(the )?(employees|people|workers)|individual|specific (person|employee)|predict .*(leave|quit|resign)|(likely|going) to (leave|quit|resign)|flight risk|rank (the )?(employees|people|workers)|score (the )?(employees|people))/i

const has = (s: string, re: RegExp) => re.test(s)

export function parseQuestion(question: string) {
  const s = question.toLowerCase()
  const department = DEPT_ALIASES.find(([re]) => re.test(s))?.[1]
  const shift = SHIFT_ALIASES.find(([re]) => re.test(s))?.[1]
  const trend = has(s, /\b(trend|over time|chang|since|rising|rise|increas|decreas|falling|develop|month|week)/)
  const rank = has(s, /\b(which|where|highest|lowest|worst|best|most|least|rank|compare|top|biggest)\b/)
  let topic: string | undefined
  if (has(s, INDIVIDUAL)) topic = 'individual'
  else if (has(s, /\b(brief|summary|summar|overview|anything unusual|what should|look at|signals?|headline|going on|status)\b/)) topic = 'signals'
  else if (has(s, /\b(trust|data quality|quality of (the )?data|missing data|issues?|pipeline|reliable|wrong numbers?)\b/)) topic = 'quality'
  else if (has(s, /\b(effective|learn|uplift|score|assessment|pass rate)/)) topic = 'training_effectiveness'
  else if (has(s, /\b(training|course|overdue|complian|certif|e-?learning)/)) topic = 'training_overdue'
  else if (has(s, /\b(new hires?|new starters?|newcomers?|onboarding|90.?day|first (three|3) months|early attrition|early exits?)/)) topic = 'early_attrition'
  else if (has(s, /\b(why|reason|contract end|resign|dismiss)/) && has(s, /\b(leav|left|exit|quit|attrition|turnover)/)) topic = 'exit_reasons'
  else if (has(s, /\b(attrition|turnover|leav|left|quit|exits?|retention|churn)/)) topic = 'attrition'
  else if (has(s, /\b(overtime|workload|extra hours|\bot\b)/)) topic = 'overtime'
  else if (has(s, /\b(absen|sick|attendance|no.?show|krank)/)) topic = 'absence'
  else if (has(s, /\b(headcount|how many (people|employees)|workforce size|staff)/)) topic = 'headcount'
  return { topic, department, shift, trend, rank }
}

export async function answerQuestion(ctx: ApiContext, question: string): Promise<Answer> {
  const p = parseQuestion(question)
  const run = async (name: ToolName, input: Record<string, unknown> = {}) => {
    const r = await runTool(ctx, name, input)
    used.push({ name, input })
    evidence.push(...r.evidence)
    return r.data
  }
  const used: Answer['tools'] = []
  const evidence: Evidence[] = []
  const reply = (text: string, followUps: string[], kind: Answer['kind'] = 'answer'): Answer => ({ text, kind, tools: used, evidence, followUps })
  const dept = p.department ?? 'ALL'
  const shift = p.shift ?? 'ALL'
  const label = groupLabel(dept, shift)

  switch (p.topic) {
    case 'individual':
      return reply(
        'I only work with aggregates of at least 10 people, so I can’t name, list, score or predict individual employees. That keeps the tool usable under GDPR and works-council agreements, and it keeps decisions about people with people. I can show you where a pattern is concentrated (department, shift, tenure band) so a manager can follow up in person.',
        ['Where are new hires leaving within 90 days?', 'Which department has the highest unplanned absence?'],
        'refusal',
      )

    case 'signals': {
      const signals = (await run('signals')) as Omit<Signal, 'evidence'>[]
      const top = signals.filter(s => s.severity !== 'info').slice(0, 4)
      if (top.length === 0) return reply('No statistically notable changes this week. All KPIs are within their usual range.', ['Can I trust the data?'])
      return reply(
        `${top.length} things stand out:\n${top.map((s, i) => `${i + 1}. ${s.title}. ${s.detail}`).join('\n')}`,
        top.map(s => s.question).filter((x, i, a) => a.indexOf(x) === i).slice(0, 3),
      )
    }

    case 'quality': {
      const d = (await run('data_quality')) as { health: { source: string; received: number; usable: number; health_pct: number }[]; issues: { rule_code: string; status: string; severity: string; issues: number; affected_rows: number }[]; excludedDays: { work_date: string }[] }
      const open = d.issues.filter(i => i.status === 'OPEN')
      const worst = [...open].sort((a, b) => b.affected_rows - a.affected_rows)[0]
      return reply(
        `Mostly, with known exceptions. ${d.health.map(h => `${h.source}: ${h.health_pct}% of ${h.received.toLocaleString('en-US')} rows usable`).join('; ')}. ${open.reduce((s, i) => s + i.issues, 0)} issues are open across ${new Set(open.map(i => i.rule_code)).size} rules; the largest is ${worst?.rule_code} (${worst?.affected_rows} rows). ${d.excludedDays.length ? `${d.excludedDays.map(x => x.work_date).join(', ')} is excluded from attendance KPIs because the delivery was incomplete.` : ''} Held-back rows never reach a KPI, so the numbers are conservative rather than wrong.`,
        ['What should I look at this week?'],
      )
    }

    case 'training_effectiveness': {
      const rows = (await run('training_programs')) as { program_name: string; on_time_completion_rate: number; avg_score_uplift: number; pass_rate: number }[]
      const sorted = [...rows].sort((a, b) => a.avg_score_uplift - b.avg_score_uplift)
      const weak = sorted[0]
      const strong = sorted.at(-1)!
      return reply(
        `Completion and learning tell different stories. ${strong.program_name} moves assessment scores the most (+${fmt(strong.avg_score_uplift)} points, ${fmt(strong.on_time_completion_rate)}% on time). ${weak.program_name} has ${fmt(weak.on_time_completion_rate)}% on-time completion but improves scores by only ${fmt(weak.avg_score_uplift)} points, so its compliance figure overstates its impact.`,
        ['Which departments are behind on mandatory training?'],
      )
    }

    case 'training_overdue': {
      const rows = (await run('training_overdue_by_department')) as { department_code: string; overdue: number; overdue_rate: number }[]
      const total = rows.reduce((s, r) => s + r.overdue, 0)
      const top = rows[0]
      return reply(
        `${total} mandatory assignments are overdue plant-wide. ${departmentName(top.department_code)} has the highest overdue rate at ${fmt(top.overdue_rate)}% (${top.overdue} assignments), followed by ${rows.slice(1, 3).map(r => `${departmentName(r.department_code)} (${fmt(r.overdue_rate)}%)`).join(' and ')}.`,
        ['Which department has the most overtime?', 'Which training programs are effective?'],
      )
    }

    case 'early_attrition': {
      const rows = (await run('compare_groups', { metric: 'early_attrition', by: 'department_shift' })) as { department_code: string; shift: string; hires: number; early_exits: number | null; early_attrition_rate: number | null; suppressed: boolean }[]
      const plant = rows.find(r => r.department_code === 'ALL')!
      const ranked = rows.filter(r => r.department_code !== 'ALL' && r.early_attrition_rate != null).sort((a, b) => b.early_attrition_rate! - a.early_attrition_rate!)
      const hidden = rows.filter(r => r.suppressed).length
      return reply(
        `Across the plant, ${fmt(plant.early_attrition_rate ?? 0)}% of people hired 3–12 months ago left within 90 days. Highest: ${ranked.slice(0, 3).map(r => `${groupLabel(r.department_code, r.shift)} ${fmt(r.early_attrition_rate!)}% (${r.early_exits} of ${r.hires})`).join('; ')}. ${hidden} groups with fewer than 10 hires are not shown. Counts are small, so use this to decide where to ask questions, not to draw conclusions.`,
        ['How has absence on Logistics night shift changed?'],
      )
    }

    case 'exit_reasons': {
      const rows = (await run('exit_reasons')) as { department_code: string; exits: number; voluntary: number; involuntary: number; contract_end: number }[]
      const d = rows.filter(r => (p.department ? r.department_code === p.department : true))
      const total = d.reduce((s, r) => ({ exits: s.exits + r.exits, v: s.v + r.voluntary, i: s.i + r.involuntary, c: s.c + r.contract_end }), { exits: 0, v: 0, i: 0, c: 0 })
      return reply(
        `In the last 12 months ${p.department ? departmentName(p.department) : 'the plant'} had ${total.exits} exits: ${total.v} resignations, ${total.c} fixed-term contract ends and ${total.i} dismissals.${p.department ? '' : ` Contract ends are concentrated in ${departmentName([...rows].sort((a, b) => b.contract_end - a.contract_end)[0].department_code)}.`} The data says how people left, not why; exit interviews are the source for that.`,
        ['Where are new hires leaving within 90 days?'],
      )
    }

    case 'attrition': {
      if (p.trend || (p.department && !p.rank)) {
        const rows = (await run('attrition_trend', { department: dept, shift })) as { month_start: string; attrition_rate: number | null; voluntary_attrition_rate: number | null; suppressed: boolean }[]
        const valid = rows.filter(r => r.attrition_rate != null)
        if (valid.length === 0) return reply(`${label} is under 10 people, so attrition is suppressed.`, [])
        const first = valid[0]
        const last = valid.at(-1)!
        return reply(
          `Trailing-12-month attrition for ${label} is ${fmt(last.attrition_rate!)}% (voluntary ${fmt(last.voluntary_attrition_rate!)}%), ${last.attrition_rate! > first.attrition_rate! ? 'up' : 'down'} from ${fmt(first.attrition_rate!)}% twelve months earlier.`,
          ['Why are people leaving?', 'Where are new hires leaving within 90 days?'],
        )
      }
      const rows = (await run('compare_groups', { metric: 'attrition', by: p.shift ? 'department_shift' : 'department' })) as { department_code: string; shift: string; attrition_rate: number | null; voluntary_attrition_rate: number | null }[]
      const plant = rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')!
      const ranked = rows.filter(r => !(r.department_code === 'ALL' && r.shift === 'ALL') && r.attrition_rate != null && (!p.shift || r.shift === p.shift)).sort((a, b) => b.attrition_rate! - a.attrition_rate!)
      return reply(
        `Plant attrition over the last 12 months is ${fmt(plant.attrition_rate!)}% (voluntary ${fmt(plant.voluntary_attrition_rate!)}%). Highest: ${ranked.slice(0, 3).map(r => `${groupLabel(r.department_code, r.shift)} ${fmt(r.attrition_rate!)}% (voluntary ${fmt(r.voluntary_attrition_rate!)}%)`).join('; ')}. Lowest: ${groupLabel(ranked.at(-1)!.department_code, ranked.at(-1)!.shift)} ${fmt(ranked.at(-1)!.attrition_rate!)}%.`,
        ['Why are people leaving?', 'Where are new hires leaving within 90 days?'],
      )
    }

    case 'absence':
    case 'overtime': {
      const metricKey = p.topic === 'absence' ? 'unplanned_absence_rate' : 'overtime_hours_per_head'
      const unit = p.topic === 'absence' ? '%' : ' h/week'
      const name = p.topic === 'absence' ? 'Unplanned absence' : 'Overtime per head'
      if (p.trend || ((p.department || p.shift) && !p.rank)) {
        const rows = (await run('attendance_trend', { department: dept, shift })) as Record<string, number | null | boolean | string>[]
        const vals = rows.map(r => r[metricKey] as number | null).filter((v): v is number => v != null)
        if (vals.length < 8) return reply(`${label} has fewer than 10 people, so the figures are suppressed.`, [])
        const first = mean(vals.slice(0, 4))
        const last = mean(vals.slice(-4))
        const plant = (await run('attendance_trend', { department: 'ALL', shift: 'ALL' })) as Record<string, number | null>[]
        const plantLast = mean(plant.map(r => r[metricKey] as number).slice(-4))
        const digits = p.topic === 'absence' ? 1 : 2
        return reply(
          `${name} for ${label} averaged ${fmt(last, digits)}${unit} over the last 4 weeks, ${last > first ? 'up' : 'down'} from ${fmt(first, digits)}${unit} in the first 4 weeks of the period (late April–May). The plant is at ${fmt(plantLast, digits)}${unit}.${p.topic === 'absence' ? ' Unplanned absence counts sickness and unexcused absence; vacation is excluded from both numerator and denominator.' : ''}`,
          [p.topic === 'absence' ? `How has overtime on ${label} changed?` : `How has absence on ${label} changed?`, 'What should I look at this week?'],
        )
      }
      const byShiftOnly = !p.shift && !p.department && /\b(by|which|each|per|across)\s+shifts?\b/i.test(question)
      const by = byShiftOnly ? 'shift' : p.shift || /\bshifts?\b/i.test(question) ? 'department_shift' : 'department'
      const rows = (await run('compare_groups', { metric: p.topic === 'absence' ? 'unplanned_absence' : 'overtime', by, weeks: 4 })) as Record<string, number | null | boolean | string>[]
      const plant = rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')!
      const ranked = rows
        .filter(r => !(r.department_code === 'ALL' && r.shift === 'ALL') && r[metricKey] != null && (!p.shift || r.shift === p.shift))
        .sort((a, b) => (b[metricKey] as number) - (a[metricKey] as number))
      const digits = p.topic === 'absence' ? 1 : 2
      const show = (r: (typeof rows)[number]) => `${groupLabel(r.department_code as string, r.shift as string)} ${fmt(r[metricKey] as number, digits)}${unit}`
      return reply(
        `${name} over the last 4 weeks: plant ${fmt(plant[metricKey] as number, digits)}${unit}. Highest: ${ranked.slice(0, 3).map(show).join('; ')}. Lowest: ${show(ranked.at(-1)!)}.${rows.some(r => r.suppressed) ? ' Groups under 10 people are suppressed.' : ''}`,
        [`How has ${p.topic === 'absence' ? 'absence' : 'overtime'} on ${groupLabel(ranked[0].department_code as string, ranked[0].shift as string)} changed?`],
      )
    }

    case 'headcount': {
      const tiles = (await run('kpi_summary')) as { id: string; value: number; previous: number }[]
      const hc = tiles.find(t => t.id === 'headcount')!
      return reply(`Headcount is ${hc.value.toLocaleString('en-US')} at the latest month end (${hc.value - hc.previous >= 0 ? '+' : ''}${hc.value - hc.previous} vs. the month before).`, ['Where is attrition highest?'])
    }

    default:
      return reply(
        `I answer from approved aggregate metrics: unplanned absence, overtime, attrition (including why people left and 90-day attrition of new hires), training completion and effectiveness, headcount, and data quality. Try naming a metric and, optionally, a department (${DEPARTMENTS.map(d => d.name).join(', ')}) or a shift.`,
        ['What should I look at this week?', 'Which department has the highest unplanned absence?', 'Which training programs are effective?'],
        'help',
      )
  }
}
