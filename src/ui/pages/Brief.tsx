import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRuntime } from '../App'
import { CountUp } from '../motion'
import type { InjectInfo } from '../../browser/protocol'
import { useTRPC, useTRPCClient } from '../../browser/trpc'
import { askClaude, MODELS } from '../../browser/llm'
import type { Evidence } from '../../api/context'
import { Floor, type FloorTeam, type ShiftKey } from '../brief/Floor'
import { Team, type TeamData } from '../brief/Team'
import { AnswerBody } from './Ask'
import type { KpiTile } from '../../api/queries'
import type { Signal } from '../../api/insights'
import { departmentName, shiftName } from '../../api/queries'
import { EvidenceButton, ErrorNote, Icon, Skeleton, downloadText, fmt, fmtDate, fmtInt, href } from '../common'

/* ------------------------------------------------------------------ helpers */

function formatTile(tile: KpiTile) {
  if (tile.value == null) return '–'
  if (tile.unit === 'people') return fmtInt(tile.value)
  if (tile.unit === '%') return `${fmt(tile.value, 1)}%`
  if (tile.unit === 'h') return `${fmt(tile.value, 1)} h`
  return fmt(tile.value, 1)
}

function signalLink(s: Pick<Signal, 'area' | 'department' | 'shift'>) {
  const params = { dept: s.department, shift: s.shift && s.shift !== 'ALL' ? s.shift : undefined }
  switch (s.area) {
    case 'attendance': return href('attendance', params)
    case 'attrition': return href('attrition', params)
    case 'training': return href('training')
    default: return href('quality')
  }
}

const AREA_LABEL: Record<Signal['area'], string> = {
  attendance: 'Open attendance',
  attrition: 'Open attrition',
  training: 'Open training',
  data: 'Open data quality',
}

/** Pick "the number now" and "what to compare it with" from a signal's stats. */
function comparison(s: Signal) {
  const isRef = (l: string) => /plant|rest of|prior/i.test(l)
  const now = s.stats.find(x => !isRef(x.label) && /%|h\/week/.test(x.value)) ?? s.stats[0]
  const ref = s.stats.find(x => /plant now|rest of plant|^plant$/i.test(x.label)) ?? s.stats.find(x => isRef(x.label))
  return { now, ref }
}

const num = (v?: string) => (v ? parseFloat(v.replace(/[^0-9.\-]/g, '')) : NaN)

/** Group label as a plain phrase: "Logistics night shift". */
function groupPhrase(dept?: string, shift?: string) {
  if (!dept || dept === 'ALL') return 'The plant'
  return shift && shift !== 'ALL' ? `${departmentName(dept)} ${shiftName(shift)}` : departmentName(dept)
}

function headlineFrom(signals: Signal[]) {
  const top = signals.find(s => s.severity !== 'info' && s.department)
  if (!top) return { title: 'No team stands out this week.', lead: 'Every department and shift is within its usual range. The trends below are still worth a look.', group: null as null | { dept: string; shift?: string } }
  const same = signals.filter(s => s.severity !== 'info' && s.department === top.department && (s.shift ?? 'ALL') === (top.shift ?? 'ALL'))
  const others = same.length - 1
  const lead = top.detail.split('. ')[0].replace(/\.$/, '') + '.'
  const words = ['One', 'Two', 'Three', 'Four', 'Five']
  const tail = others > 0 ? ` ${others === 1 ? 'One more change points' : `${words[others - 1] ?? others} more changes point`} to the same shift.` : ''
  return { title: `${groupPhrase(top.department, top.shift)} needs attention this week.`, lead: lead + tail, group: { dept: top.department!, shift: top.shift } }
}

function briefMarkdown(asOf: string, tiles: KpiTile[], signals: Signal[]) {
  return [
    `# Weekly people brief, week ending ${asOf}`,
    '',
    '_Synthetic demo data. Aggregates only; groups under 10 people are hidden._',
    '',
    '## Headline numbers',
    ...tiles.map(x => `- **${x.label}:** ${formatTile(x)} (${x.comparison})`),
    '',
    '## What changed',
    ...signals.filter(s => s.severity !== 'info').slice(0, 3).map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`),
  ].join('\n')
}

/* ------------------------------------------------------------------ shift board (hero + guided story) */

const SHIFTS = [
  { key: 'EARLY', label: 'Early' },
  { key: 'LATE', label: 'Late' },
  { key: 'NIGHT', label: 'Night' },
]

/** What the guided story asks the board to show. */
export type BoardMode = 'brief' | 'all' | 'outliers' | 'row' | 'cell'

interface Focus { dept: string; shift: string }


/** 26-week line for one team against the plant. */
function Trend({ values, plant, flag }: { values: (number | null)[]; plant: (number | null)[]; flag: boolean }) {
  const W = 220, H = 54, P = 3
  const all = [...values, ...plant].filter((v): v is number => v != null)
  if (all.length < 2) return null
  const lo = Math.min(...all), hi = Math.max(...all)
  const x = (i: number) => P + (i / Math.max(1, values.length - 1)) * (W - 2 * P)
  const y = (v: number) => H - P - ((v - lo) / (hi - lo || 1)) * (H - 2 * P)
  const path = (vs: (number | null)[]) => vs.map((v, i) => (v == null ? '' : `${i === 0 || vs[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('')
  const last = values.length - 1
  return (
    <svg className={`trend${flag ? ' flag' : ''}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Weekly unplanned absence, last 26 weeks, against the plant">
      <path className="trend-plant" d={path(plant)} />
      <path className="trend-line" d={path(values)} pathLength={1} />
      {values[last] != null && <circle cx={x(last)} cy={y(values[last]!)} r={3.2} />}
    </svg>
  )
}

function ShiftBoard({ flagged, focus, mode = 'brief', selected, onSelect }: {
  flagged: Set<string>
  focus: Focus | null
  mode?: BoardMode
  selected: Focus | null
  onSelect: (f: Focus) => void
}) {
  const trpc = useTRPC()
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks: 4 }))
  const ref = useQuery(trpc.meta.reference.queryOptions())
  if (!grid.data || !ref.data) return <Skeleton height={360} />
  const plant = grid.data.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')?.unplanned_absence_rate ?? null
  const values = grid.data.rows.filter(r => r.department_code !== 'ALL' && r.shift !== 'ALL' && !r.suppressed && r.unplanned_absence_rate != null).map(r => r.unplanned_absence_rate!)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const cellOf = (d: string, sh: string) => grid.data.rows.find(r => r.department_code === d && r.shift === sh)

  return (
    <figure className="board" data-mode={mode} aria-label="Unplanned absence by department and shift, last 4 weeks">
      <figcaption className="board-cap">
        <span>Unplanned absence, last 4 weeks</span>
        <EvidenceButton title="Shift board: department × shift absence" evidence={[grid.data]} label="Query" />
      </figcaption>
      <div className="board-grid" role="table">
        <div className="board-row board-head" role="row">
          <span role="columnheader" />
          {SHIFTS.map(sh => <span key={sh.key} role="columnheader">{sh.label}</span>)}
        </div>
        {ref.data.departments.map((d, r) => (
          <div className={`board-row${focus?.dept === d.code ? ' focus-row' : ''}`} role="row" key={d.code} style={{ ['--r' as string]: r }}>
            <span className="board-dept" role="rowheader">{d.name}</span>
            {SHIFTS.map((sh, ci) => {
              const c = cellOf(d.code, sh.key)
              if (!c || c.suppressed || c.unplanned_absence_rate == null)
                return <span key={sh.key} role="cell" className="board-cell hidden" title="Fewer than 10 people, hidden">&lt;10</span>
              const v = c.unplanned_absence_rate
              const t = (v - lo) / (hi - lo || 1)
              const key = `${d.code}|${sh.key}`
              const cls = [
                'board-cell',
                flagged.has(key) ? 'flag' : '',
                focus && focus.dept === d.code && focus.shift === sh.key ? 'focus' : '',
                plant != null && Math.abs(v - plant) < 1 ? 'near' : '',
                selected && selected.dept === d.code && selected.shift === sh.key ? 'shown' : '',
              ].filter(Boolean).join(' ')
              return (
                <span key={sh.key} role="cell" className="board-slot">
                  <button
                    className={cls}
                    style={{ ['--t' as string]: t.toFixed(3), ['--c' as string]: ci }}
                    aria-label={`${d.name}, ${sh.label.toLowerCase()} shift: ${fmt(v)}% unplanned absence, ${c.employees} people. Show this team.`}
                    aria-pressed={Boolean(selected && selected.dept === d.code && selected.shift === sh.key)}
                    onClick={() => onSelect({ dept: d.code, shift: sh.key })}
                  >
                    <span className="board-bar" aria-hidden="true" />
                    <span className="board-val">{fmt(v)}</span>
                  </button>
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <div className="board-foot">
        <span>Plant {plant != null ? `${fmt(plant)}%` : '–'}</span>
        <span><i className="key-flag" /> Flagged</span>
        <span><i className="key-hidden" /> Under 10 people</span>
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ guided story */

interface Step { mode: BoardMode; title: string; body: string }

type RowVals = { shift: string; value: number | null }[]

function storySteps(signals: Signal[], plant: number | null, teams: number, focus: Focus | null, row: RowVals): Step[] {
  const plantTxt = plant != null ? `${fmt(plant)}%` : 'the plant average'
  const top = signals.find(s => s.severity !== 'info' && s.department === focus?.dept && s.shift === focus?.shift)
  const same = signals.filter(s => s.severity !== 'info' && s.department === focus?.dept && (s.shift ?? 'ALL') === (focus?.shift ?? 'ALL'))
  const group = focus ? `${departmentName(focus.dept)} ${shiftName(focus.shift)}` : 'one team'
  const steps: Step[] = [
    { mode: 'all', title: 'Every cell is one team', body: `Seven departments times three shifts gives ${teams} teams. Each cell is that team’s unplanned absence over the last four weeks, and the bar shows how big it is.` },
    { mode: 'outliers', title: 'Most teams sit near the plant average', body: `The plant averages ${plantTxt}. Teams within one point of it fade back, so only the teams that differ stay visible.` },
  ]
  if (focus) {
    const others = row.filter(r => r.shift !== focus.shift && r.value != null)
    const mine = row.find(r => r.shift === focus.shift)?.value ?? null
    const othersTxt = others.map(r => `${fmt(r.value!)}% on the ${r.shift.toLowerCase()} shift`).join(' and ')
    const near = plant != null && others.every(r => Math.abs(r.value! - plant) < 1.5)
    steps.push({
      mode: 'row',
      title: `Look along the ${departmentName(focus.dept)} row`,
      body: `${departmentName(focus.dept)} runs ${othersTxt}${near ? ', close to the plant' : ''}. The ${shiftName(focus.shift)} is the exception.`,
    })
    const stat = (re: RegExp) => top?.stats.find(x => re.test(x.label))?.value
    const recent = stat(/^Last/), prior = stat(/^Prior/)
    steps.push({
      mode: 'cell',
      title: `The ${shiftName(focus.shift)} is the outlier`,
      body: mine != null && plant != null
        ? `${fmt(mine)}% over the last four weeks, ${fmt(mine - plant)} points above the plant.${recent && prior ? ` It has climbed from ${prior} to ${recent} when you compare the last six weeks with the twelve before.` : ''}`
        : `${group} is furthest from the plant average.`,
    })
    if (same.length > 1) steps.push({ mode: 'cell', title: `${same.length === 2 ? 'Two signals' : 'Three signals'}, one shift`, body: `${same.map(s => s.title.replace(/ on .*$/, '').toLowerCase()).join(', ').replace(/^./, c => c.toUpperCase())}. When several measures move together on one team, that is the conversation to have first.` })
  }
  return steps
}

const STEP_MS = 5200

/** The walkthrough plays in place: one card, Back / Next, and an autoplay bar. No scrolling. */
function Walkthrough({ steps, idx, setIdx, playing, setPlaying }: {
  steps: Step[]
  idx: number
  setIdx: (i: number) => void
  playing: boolean
  setPlaying: (p: boolean) => void
}) {
  const cur = idx >= 0 ? steps[idx] : null
  const next = () => (idx < steps.length - 1 ? setIdx(idx + 1) : (setPlaying(false), setIdx(-1)))
  return (
    <div className={`walk${cur ? ' on' : ''}`}>
      <div className="walk-dots" aria-label="Walkthrough steps">
        {steps.map((st, i) => (
          <button key={i} className={i === idx ? 'cur' : i < idx ? 'past' : ''} aria-label={`Step ${i + 1}: ${st.title}`} aria-current={i === idx ? 'step' : undefined} onClick={() => { setIdx(i); setPlaying(false) }}>
            {i === idx && playing && <i key={idx} style={{ animationDuration: `${STEP_MS}ms` }} onAnimationEnd={next} />}
          </button>
        ))}
      </div>
      {cur ? (
        <div className="walk-card" key={idx}>
          <span className="walk-n">Step {idx + 1} of {steps.length}</span>
          <h3>{cur.title}</h3>
          <p>{cur.body}</p>
        </div>
      ) : (
        <div className="walk-card idle">
          <h3>How the brief found this team</h3>
          <p>Five steps, about 25 seconds: from all 21 teams to the one that needs a conversation.</p>
        </div>
      )}
      <div className="walk-ctrl">
        {cur && <button className="btn-line small" onClick={() => { setPlaying(false); setIdx(Math.max(-1, idx - 1)) }}>Back</button>}
        <button className="btn-solid small" onClick={() => { if (!cur) { setIdx(0); setPlaying(true) } else setPlaying(!playing) }}>
          {!cur ? 'Play the walkthrough' : playing ? 'Pause' : 'Play'}
        </button>
        {cur && <button className="btn-line small" onClick={() => { setPlaying(false); next() }}>{idx === steps.length - 1 ? 'Done' : 'Next'}</button>}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ sections */

/** Weekly series for an attendance signal's team and the plant, from the signal's own evidence. */
function signalTrend(s: Signal) {
  if (s.area !== 'attendance' || !s.department || !s.shift) return null
  const key = s.id.startsWith('overtime') ? 'overtime_hours_per_head' : 'unplanned_absence_rate'
  const rows = (s.evidence[0]?.rows ?? []) as Record<string, unknown>[]
  const pick = (d: string, sh: string) => rows.filter(r => r.department_code === d && r.shift === sh).map(r => (r[key] as number | null) ?? null)
  const values = pick(s.department, s.shift)
  const plant = pick('ALL', 'ALL')
  return values.length > 3 && plant.length === values.length ? { values, plant } : null
}

function Change({ signal, onTeam, onAsk }: { signal: Signal; onTeam: (f: Focus) => void; onAsk: (q: string) => void }) {
  const { now, ref } = comparison(signal)
  const a = num(now?.value)
  const b = num(ref?.value)
  const max = Math.max(a, b) || 1
  const level = signal.severity === 'high' ? 'act' : 'watch'
  const trend = signalTrend(signal)
  return (
    <li className={`change ${level}`} data-reveal>
      <span className="change-level">{level === 'act' ? 'Act' : 'Watch'}</span>
      <div className="change-body">
        <h3>{signal.title.replace(' · ', ' ')}</h3>
        <p>{signal.detail}</p>
        <div className="change-links">
          {signal.department && signal.shift && signal.shift !== 'ALL'
            ? <button className="link-like" onClick={() => onTeam({ dept: signal.department!, shift: signal.shift! })}>See the team</button>
            : <a href={signalLink(signal)}>{AREA_LABEL[signal.area]}</a>}
          <button className="link-like" onClick={() => onAsk(signal.question)}>Ask about it</button>
          <EvidenceButton title={signal.title} description={signal.method} evidence={signal.evidence} label="Query" />
        </div>
      </div>
      {!Number.isNaN(a) && !Number.isNaN(b) && (
        <div className="change-side">
        {trend && (
          <div className="change-trend">
            <Trend values={trend.values} plant={trend.plant} flag={level === 'act'} />
            <span>Last {trend.values.length} weeks, dashed line is the plant</span>
          </div>
        )}
        <dl className="change-compare">
          <div>
            <dt>{now!.label}</dt>
            <dd><strong>{now!.value}</strong><span className="cbar now" style={{ width: `${(a / max) * 100}%` }} /></dd>
          </div>
          <div>
            <dt>{ref!.label}</dt>
            <dd><strong>{ref!.value}</strong><span className="cbar ref" style={{ width: `${(b / max) * 100}%` }} /></dd>
          </div>
        </dl>
        </div>
      )}
    </li>
  )
}

const PRIMARY_KPIS = ['headcount', 'unplanned_absence', 'attrition', 'training_on_time']

/** Append a bad delivery, rerun the pipeline in the worker, and show what the gate did with it. */
function BrokenExtract({ onRunning }: { onRunning: (r: boolean) => void }) {
  const trpc = useTRPC()
  const qc = useQueryClient()
  const { backend } = useRuntime()
  const [state, setState] = useState<'idle' | 'running' | 'broken' | 'restoring'>('idle')
  const [result, setResult] = useState<{ info: InjectInfo; changed: string[] } | null>(null)
  const kpis = () => qc.fetchQuery(trpc.kpi.summary.queryOptions())

  const send = async () => {
    if (!backend) return
    setState('running'); onRunning(true)
    try {
      const before = await kpis()
      const info = await backend.injectBrokenExtract()
      await qc.invalidateQueries()
      const after = await kpis()
      const changed = PRIMARY_KPIS.filter(id => before.find(k => k.id === id)?.value !== after.find(k => k.id === id)?.value)
        .map(id => after.find(k => k.id === id)?.label ?? id)
      setResult({ info, changed })
      setState('broken')
    } finally { onRunning(false) }
  }
  const restore = async () => {
    if (!backend) return
    setState('restoring'); onRunning(true)
    try { await backend.restore(); await qc.invalidateQueries(); setResult(null); setState('idle') } finally { onRunning(false) }
  }

  const a = result?.info.added
  const total = a ? a.futureDated + a.unknownBadges + a.badScores : 0
  return (
    <div className={`broken is-${state}`} aria-live="polite">
      {state === 'broken' && a ? (
        <>
          <p>
            <strong>The gate held back all {total} bad rows</strong>: {a.futureDated} dated after the snapshot, {a.unknownBadges} for badges HR has never seen and {a.badScores} assessment scores above 100.{' '}
            {result!.changed.length === 0 ? 'Headcount, absence, attrition and training on time did not move.' : `${result!.changed.join(', ')} changed.`}
          </p>
          <button className="btn-line small" onClick={restore}>Restore the clean data</button>
        </>
      ) : (
        <>
          <p>{state === 'running' ? 'A broken delivery is going through all 18 checks…' : state === 'restoring' ? 'Restoring the original extracts…' : backend ? 'See it happen: send a delivery with bad rows mixed in and watch the counts above.' : 'The demo unlocks when the live database is ready (see the badge at the top).'}</p>
          <button className="btn-solid small" onClick={send} disabled={!backend || state !== 'idle'}>{state === 'running' || state === 'restoring' ? 'Running the pipeline…' : 'Send a broken extract'}</button>
        </>
      )}
    </div>
  )
}

function Trust() {
  const trpc = useTRPC()
  const q = useQuery(trpc.quality.overview.queryOptions())
  const [running, setRunning] = useState(false)
  if (!q.data) return <Skeleton height={180} />
  const received = q.data.health.rows.reduce((s, h) => s + h.received, 0)
  const held = q.data.health.rows.reduce((s, h) => s + h.held_back, 0)
  const usable = received - held
  const pct = received ? (100 * usable) / received : 0
  const steps = [
    { n: fmtInt(received), label: 'source rows land in staging', sub: 'HR records, time clock, training' },
    { n: String(q.data.rules.length), label: 'SQL checks run on every row', sub: 'Structure, ranges, references' },
    { n: fmtInt(held), label: 'rows held back for review', sub: 'Traceable, never silently dropped' },
    { n: fmtInt(usable), label: 'rows reach the numbers', sub: 'Aggregate views only' },
  ]
  return (
    <div className={`trust${running ? ' running' : ''}`}>
      <div className="trust-score">
        <strong><CountUp text={`${fmt(pct)}%`} /></strong>
        <p>of source rows pass every check and reach the figures on this page.</p>
        <EvidenceButton title="Data health by source" evidence={[q.data.health]} label="Query" />
      </div>
      <div>
        <Conveyor className="conveyor" held={[2]} />
        <ol className="trust-steps">
          {steps.map(s => (
            <li key={s.label}>
              <strong><CountUp text={s.n} /></strong>
              <span>{s.label}</span>
              <small>{s.sub}</small>
            </li>
          ))}
        </ol>
      </div>
      <BrokenExtract onRunning={setRunning} />
    </div>
  )
}

/** One switch that shows why the gate matters: count the incomplete day as absence and watch the KPI jump. */
function WhatIf() {
  const trpc = useTRPC()
  const q = useQuery(trpc.quality.overview.queryOptions())
  const day = q.data?.excluded.rows[0]?.work_date
  const impact = useQuery({ ...trpc.quality.exclusionImpact.queryOptions({ day: day ?? '1970-01-01' }), enabled: Boolean(day) })
  const [on, setOn] = useState(false)
  if (!day || !impact.data || impact.data.withDay == null || impact.data.withoutDay == null) return null
  const clean = impact.data.withoutDay, dirty = impact.data.withDay
  const value = on ? dirty : clean
  const max = Math.max(clean, dirty) * 1.1
  const label = fmtDate(day, { weekday: 'long', day: 'numeric', month: 'long' })
  return (
    <div className={`whatif${on ? ' on' : ''}`}>
      <div className="whatif-copy">
        <h3>Try it: let the bad day through</h3>
        <p>On {label} most shifts arrived with no punches at all. The gate keeps that day out of the numbers. Switch it back in and see what the plant would have reported for that week.</p>
        <label className="switch">
          <input type="checkbox" checked={on} onChange={e => setOn(e.target.checked)} />
          <span className="switch-track"><span className="switch-thumb" /></span>
          <span>Count {fmtDate(day, { day: 'numeric', month: 'short' })} as absence</span>
        </label>
      </div>
      <div className="whatif-viz" aria-live="polite">
        <span className="whatif-label">Plant unplanned absence, that week</span>
        <strong key={String(on)}>{fmt(value)}%</strong>
        <div className="whatif-bars">
          <div><span>Gate on</span><i style={{ width: `${(clean / max) * 100}%` }} /></div>
          <div className="dirty"><span>Gate off</span><i style={{ width: `${(on ? dirty / max : 0) * 100}%` }} /></div>
        </div>
        <small>{on ? `${fmt(dirty - clean)} points of “absence” that never happened. A manager would have chased a problem that was really a missing file.` : 'What the brief reports, with the incomplete day held back.'}</small>
      </div>
    </div>
  )
}

const STARTERS = [
  'What should I look at this week?',
  'Where are new hires leaving within 90 days?',
  'Which training programs are effective?',
  'Can I trust the data?',
]

interface AskTurn { q: string; pending: boolean; text?: string; kind?: string; evidence?: Evidence[]; error?: string; model?: string }

/** Ask right here: the answer appears under the box, with its evidence. Optional Claude mode with your own key. */
function AskInline({ question, onAsked }: { question: { q: string; n: number } | null; onAsked: () => void }) {
  const client = useTRPCClient()
  const { backend } = useRuntime()
  const status = useQuery(useTRPC().meta.status.queryOptions())
  const [draft, setDraft] = useState('')
  const [turn, setTurn] = useState<AskTurn | null>(null)
  const [claude, setClaude] = useState(false)
  const [key, setKey] = useState('')
  const [model, setModel] = useState<string>(MODELS[0].id)
  const lastN = useRef(-1)

  const ask = async (q: string) => {
    const text = q.trim()
    if (!text) return
    setDraft(text)
    setTurn({ q: text, pending: true })
    try {
      if (claude && key) {
        const a = await askClaude({ client, apiKey: key, model, question: text, asOf: status.data?.asOf ?? '' })
        setTurn({ q: text, pending: false, text: a.text, kind: 'answer', evidence: a.evidence, model })
      } else {
        const a = await client.insights.ask.mutate({ question: text })
        setTurn({ q: text, pending: false, text: a.text, kind: a.kind, evidence: a.evidence })
      }
    } catch (e) {
      setTurn({ q: text, pending: false, error: e instanceof Error ? e.message : String(e) })
    }
  }
  useEffect(() => {
    if (question && question.n !== lastN.current) { lastN.current = question.n; void ask(question.q); onAsked() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question])

  return (
    <div className="askbox">
      <form onSubmit={e => { e.preventDefault(); void ask(draft) }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Which shift has the most overtime?" aria-label="Ask a question about the workforce" />
        <button type="submit" disabled={!draft.trim() || turn?.pending}>{turn?.pending ? 'Asking…' : 'Ask'}</button>
      </form>
      <div className="askbox-starters">
        {STARTERS.map(s => <button key={s} type="button" onClick={() => void ask(s)}>{s}</button>)}
      </div>
      <div className="ask-mode">
        <label className="switch">
          <input type="checkbox" checked={claude} onChange={e => setClaude(e.target.checked)} />
          <span className="switch-track"><span className="switch-thumb" /></span>
          <span>Answer with Claude, using your own API key</span>
        </label>
        {claude && (
          <div className="ask-key">
            <input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder="sk-ant-…" aria-label="Anthropic API key" autoComplete="off" />
            <select className="select" value={model} onChange={e => setModel(e.target.value)} aria-label="Model">
              {MODELS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
            <small>The key stays in this tab and goes only to api.anthropic.com. Claude sees tool results (aggregates), never tables.</small>
          </div>
        )}
      </div>
      {turn && (
        <div className="ask-answer" aria-live="polite">
          <p className="ask-q">{turn.q}</p>
          {turn.pending && <p className="muted"><span className="spinner" /> {backend ? 'Checking approved metrics…' : 'Waiting for the live database to finish starting…'}</p>}
          {turn.error && <p className="error">{turn.error}</p>}
          {turn.text && <AnswerBody text={turn.text} evidence={turn.evidence} refusal={turn.kind === 'refusal'} />}
          {!turn.pending && !turn.error && (
            <div className="insight-meta">
              <span className={`badge ${turn.kind === 'refusal' ? 'warn' : 'good'}`}>{turn.kind === 'refusal' ? 'Privacy guardrail' : turn.model ? 'Claude, tools only' : 'Metric-grounded'}</span>
              {turn.evidence && turn.evidence.length > 0 && <EvidenceButton title={turn.q} evidence={turn.evidence} label="View evidence" />}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const FLOW = [
  { t: 'Source extracts', d: 'HR records, time clock and training data, all synthetic' },
  { t: 'PostgreSQL', d: 'Staging, 18 SQL checks, quarantine' },
  { t: 'Analytics views', d: 'CTEs and window functions, groups of 10 or more' },
  { t: 'tRPC + Zod', d: 'Typed API over Prisma' },
  { t: 'React', d: 'This page' },
]

/** Records moving along a line; the ones in `held` drop out, as in the loading screen. */
function Conveyor({ className, held = [] }: { className: string; held?: number[] }) {
  const n = 5
  return (
    <div className={className} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`run${held.includes(i) ? ' held' : ''}`} style={{ animationDelay: `${-(i / n) * 2.6}s` }}>
          <i style={{ animationDelay: `${-(i / n) * 2.6}s` }} />
        </span>
      ))}
    </div>
  )
}

/** Adds `in` to [data-reveal] elements once they scroll into view. */
function useReveal(root: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) }
    }, { threshold: 0.35 })
    const observe = () => el.querySelectorAll('[data-reveal]:not(.in)').forEach(n => io.observe(n))
    observe()
    const mo = new MutationObserver(observe)
    mo.observe(el, { childList: true, subtree: true })
    return () => { io.disconnect(); mo.disconnect() }
  }, [root])
}

/* ------------------------------------------------------------------ page */

const SECTIONS = ['floor', 'changes', 'teams', 'trust', 'ask'] as const

export function Brief({ params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const { replayIntro } = useRuntime()
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  const status = useQuery(trpc.meta.status.queryOptions())
  const kpis = useQuery(trpc.kpi.summary.queryOptions())
  const signals = useQuery(trpc.insights.signals.queryOptions())
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks: 4 }))
  const ref = useQuery(trpc.meta.reference.queryOptions())
  const trends = useQuery(trpc.attendance.boardTrends.queryOptions())
  const early = useQuery(trpc.workforce.earlyAttrition.queryOptions({ by: 'department_shift' }))

  const primaryIds = ['headcount', 'unplanned_absence', 'attrition', 'training_on_time']
  const primary = primaryIds.map(id => kpis.data?.find(x => x.id === id)).filter(Boolean) as KpiTile[]
  const changes = signals.data?.filter(s => s.severity !== 'info').slice(0, 3) ?? []
  const head = signals.data ? headlineFrom(signals.data) : null
  const flagged = new Set(changes.filter(s => s.department && s.shift && s.shift !== 'ALL').map(s => `${s.department}|${s.shift}`))
  const plant = grid.data?.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')?.unplanned_absence_rate ?? null
  const teamsCount = grid.data?.rows.filter(r => r.department_code !== 'ALL' && r.shift !== 'ALL' && r.shift !== 'UNASSIGNED').length ?? 21
  const focus: Focus | null = head?.group?.shift && head.group.shift !== 'ALL' ? { dept: head.group.dept, shift: head.group.shift } : null
  const row: RowVals = focus ? ['EARLY', 'LATE', 'NIGHT'].map(sh => ({ shift: sh, value: grid.data?.rows.find(r => r.department_code === focus.dept && r.shift === sh && !r.suppressed)?.unplanned_absence_rate ?? null })) : []
  const steps = signals.data ? storySteps(signals.data, plant, teamsCount, focus, row) : []

  // Selected team: from a shared link (?team=LOG-NIGHT), else the flagged team.
  const fromLink = (() => { const t = params.get('team'); if (!t) return null; const [dept, shift] = t.split('-'); return dept && shift ? { dept, shift } : null })()
  const [picked, setPicked] = useState<Focus | null>(null)
  const selected = picked ?? fromLink ?? focus
  // A shared link opened while the page is up replaces whatever was picked before.
  const linkKey = params.get('team')
  useEffect(() => { if (linkKey) setPicked(null) }, [linkKey])
  const [floorShift, setFloorShift] = useState<ShiftKey>('NIGHT')
  useEffect(() => { if (focus?.shift && ['EARLY', 'LATE', 'NIGHT'].includes(focus.shift)) setFloorShift(focus.shift as ShiftKey) }, [focus?.shift])

  const [walkIdx, setWalkIdx] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const walkMode: BoardMode = walkIdx >= 0 ? steps[walkIdx]?.mode ?? 'brief' : 'brief'
  const [askQ, setAskQ] = useState<{ q: string; n: number } | null>(null)

  const goTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  // On one-column layouts the team view sits under the board, so go straight to it.
  const showTeam = (f: Focus) => { setPicked(f); setTimeout(() => goTo(window.innerWidth < 1080 ? 'team-panel' : 'teams'), 30) }
  const askAbout = (q: string) => { setAskQ(a => ({ q, n: (a?.n ?? 0) + 1 })); goTo('ask') }

  // Scroll to a section asked for in the URL (?s=trust) or to a shared team.
  useEffect(() => {
    const target = params.get('s') ?? (params.get('team') ? 'teams' : null)
    if (target && (SECTIONS as readonly string[]).includes(target)) setTimeout(() => goTo(target), 80)
  }, [params])

  const team = (() => {
    if (!selected || !grid.data) return null
    const cell = grid.data.rows.find(r => r.department_code === selected.dept && r.shift === selected.shift)
    if (!cell) return null
    const series = (d: string, sh: string) => (trends.data?.rows ?? []).filter(r => r.department_code === d && r.shift === sh)
    const plantSeries = series('ALL', 'ALL')
    const mine = new Map(series(selected.dept, selected.shift).map(r => [r.week_start, r.unplanned_absence_rate]))
    const ev = signals.data?.find(s => s.area === 'attendance')?.evidence[0]?.rows as Record<string, unknown>[] | undefined
    const ot = (d: string, sh: string) => {
      const v = (ev ?? []).filter(r => r.department_code === d && r.shift === sh).slice(-4).map(r => r.overtime_hours_per_head as number | null).filter((x): x is number => x != null)
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
    }
    const e = early.data?.rows.find(r => r.department_code === selected.dept && r.shift === selected.shift)
    const ep = early.data?.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')
    const data: TeamData = {
      dept: selected.dept, shift: selected.shift, employees: cell.employees,
      rate: cell.suppressed ? null : cell.unplanned_absence_rate, plantRate: plant,
      weeks: plantSeries.map(p => ({ week: p.week_start, team: mine.get(p.week_start) ?? null, plant: p.unplanned_absence_rate })),
      overtime: ev ? { team: ot(selected.dept, selected.shift), plant: ot('ALL', 'ALL') } : null,
      early: e ? { exits: e.early_exits, hires: e.hires, rate: e.early_exits != null && e.hires ? (100 * e.early_exits) / e.hires : null, plantRate: ep?.early_exits != null && ep.hires ? (100 * ep.early_exits) / ep.hires : null, suppressed: Boolean(e.suppressed) } : null,
      signals: (signals.data ?? []).filter(s => s.department === selected.dept && s.shift === selected.shift),
    }
    return data
  })()
  // During the walkthrough's last steps, show the team it is talking about.
  useEffect(() => { if (walkMode === 'cell' && focus) setPicked(focus) }, [walkMode]) // eslint-disable-line react-hooks/exhaustive-deps

  // Memoised: a new array on every render would rebuild the 2,600-person floor each time.
  const floorTeams: FloorTeam[] = useMemo(() => (grid.data?.rows ?? []).map(r => ({ dept: r.department_code, shift: r.shift, employees: r.employees, rate: r.unplanned_absence_rate, suppressed: r.suppressed })), [grid.data])
  const flaggedKey = [...flagged].join(',')
  const flaggedSet = useMemo(() => new Set(flaggedKey ? flaggedKey.split(',') : []), [flaggedKey])

  return (
    <div className="brief" ref={root}>
      <div className="reading-progress" aria-hidden="true" />

      <section className="hero-dark" id="floor">
        <div className="hero-inner">
          <div className="hero-copy">
            <p className="hero-date">Weekly people brief · synthetic vehicle plant{status.data ? ` · week ending ${fmtDate(status.data.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
            <h1>{head ? head.title : <span className="ghost-line" />}</h1>
            <p className="hero-lead">{head?.lead ?? ''}</p>
            <div className="hero-actions">
              <button className="btn-solid on-dark" onClick={() => { goTo('teams'); setWalkIdx(0); setPlaying(true) }}>Play the walkthrough</button>
              {kpis.data && signals.data && status.data && (
                <button className="btn-line on-dark" onClick={() => downloadText(`people-brief-${status.data.asOf}.md`, briefMarkdown(status.data.asOf, kpis.data, signals.data), 'text/markdown')}>
                  <Icon name="download" /> Download the brief
                </button>
              )}
            </div>
          </div>
          {grid.data && ref.data ? (
            <Floor
              teams={floorTeams}
              depts={ref.data.departments}
              shift={floorShift}
              onShift={setFloorShift}
              flagged={flaggedSet}
              selectedDept={selected?.dept ?? null}
              onSelect={(dept, sh) => {
                const shiftPick = sh !== 'ALL' ? sh : (['EARLY', 'LATE', 'NIGHT'].map(k => grid.data!.rows.find(r => r.department_code === dept && r.shift === k)).filter(r => r && !r.suppressed).sort((a, b) => (b!.unplanned_absence_rate ?? 0) - (a!.unplanned_absence_rate ?? 0))[0]?.shift ?? 'EARLY')
                showTeam({ dept, shift: shiftPick })
              }}
            />
          ) : <Skeleton height={520} />}
          <div className="hud" aria-label="Headline numbers">
            {primary.length === 4
              ? primary.map((t, i) => {
                  const delta = t.value != null && t.previous != null ? t.value - t.previous : null
                  const good = delta == null || t.goodDirection === 'none' ? null : (delta > 0) === (t.goodDirection === 'up')
                  return (
                    <div className="vital" key={t.id} style={{ ['--i' as string]: i }}>
                      <span className="vital-label">{t.label}</span>
                      <strong><CountUp text={formatTile(t)} /></strong>
                      <span className={`vital-delta ${good == null ? '' : good ? 'good' : 'bad'}`}>
                        {delta != null && delta !== 0 && <>{delta > 0 ? '+' : '−'}{t.unit === 'people' ? fmtInt(Math.abs(delta)) : fmt(Math.abs(delta), 1)}{t.unit === '%' ? ' pts' : ''} </>}
                        {t.comparison}
                      </span>
                    </div>
                  )
                })
              : null}
          </div>
          {kpis.error && <ErrorNote error={kpis.error} />}
        </div>
      </section>

      <section className="block" id="changes">
        <header className="block-head">
          <h2>{changes.length === 1 ? 'One change is worth a conversation' : `${['Two', 'Three'][changes.length - 2] ?? 'Three'} changes are worth a conversation`}</h2>
          <p>Each is a team compared with the rest of the plant over six weeks, flagged only when the gap is statistically clear. They point to where to look, never to individuals.</p>
        </header>
        {signals.isLoading && <Skeleton height={320} />}
        {signals.error && <ErrorNote error={signals.error} />}
        <ol className="changes">{changes.map(s => <Change key={s.id} signal={s} onTeam={showTeam} onAsk={askAbout} />)}</ol>
        {signals.data && changes.length === 0 && <p className="empty">Nothing stands out in this snapshot.</p>}
      </section>

      <section className="block" id="teams">
        <header className="block-head">
          <h2>Every team, one board</h2>
          <p>Twenty-one teams, seven departments by three shifts. Pick a cell to see that team, or play the walkthrough to see how the brief got to its headline.</p>
        </header>
        <Walkthrough steps={steps} idx={walkIdx} setIdx={setWalkIdx} playing={playing} setPlaying={setPlaying} />
        <div className="teams-grid">
          <ShiftBoard flagged={flagged} focus={focus} mode={walkMode} selected={selected} onSelect={f => { setPicked(f); setPlaying(false) }} />
          {team ? <Team t={team} onAsk={askAbout} /> : <Skeleton height={420} />}
        </div>
      </section>

      <section className="block" id="trust">
        <header className="block-head">
          <h2>Bad data is stopped before it reaches a chart</h2>
          <p>A missing punch can look like an absence. Every source row is checked first; anything that fails is held back where a reviewer can see it. Try both switches below.</p>
        </header>
        <Trust />
        <WhatIf />
      </section>

      <section className="block block-split" id="ask">
        <header className="block-head">
          <h2>Ask in plain words</h2>
          <p>Answers come from approved aggregate queries and show the SQL behind them. Questions about individual employees are declined.</p>
        </header>
        <AskInline question={askQ} onAsked={() => {}} />
      </section>

      <section className="block block-build">
        <header className="block-head">
          <h2>How it’s built</h2>
          <p>The whole stack runs in this tab: PostgreSQL in WebAssembly inside a Web Worker, Prisma, a typed tRPC API and React. The same code runs on Node against real PostgreSQL, and GitHub Actions tests both.</p>
        </header>
        <Conveyor className="track flow-track" />
        <ol className="flow">
          {FLOW.map(f => (
            <li key={f.t}><strong>{f.t}</strong><span>{f.d}</span></li>
          ))}
        </ol>
        <div className="build-links">
          <button className="link-like" onClick={replayIntro}>Replay the pipeline</button>
          <a href={href('method')}>Metric definitions and privacy</a>
          <a href={href('sql')}>Query the data yourself</a>
          <a href="https://github.com/abrar0205/peopleops-ai" target="_blank" rel="noreferrer"><Icon name="github" /> Source on GitHub</a>
        </div>
      </section>
    </div>
  )
}
