import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRuntime } from '../App'
import { CountUp } from '../motion'
import type { InjectInfo } from '../../browser/protocol'
import { useTRPC } from '../../browser/trpc'
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

const hoverCapable = () => typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches

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

function ShiftBoard({ flagged, focus, mode = 'brief' }: { flagged: Set<string>; focus: Focus | null; mode?: BoardMode }) {
  const trpc = useTRPC()
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks: 4 }))
  const ref = useQuery(trpc.meta.reference.queryOptions())
  const trends = useQuery(trpc.attendance.boardTrends.queryOptions())
  const [hover, setHover] = useState<Focus | null>(null)
  const [picked, setPicked] = useState<Focus | null>(null)
  if (!grid.data || !ref.data) return <Skeleton height={420} />

  const plant = grid.data.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')?.unplanned_absence_rate ?? null
  const values = grid.data.rows.filter(r => r.department_code !== 'ALL' && r.shift !== 'ALL' && !r.suppressed && r.unplanned_absence_rate != null).map(r => r.unplanned_absence_rate!)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const cellOf = (d: string, sh: string) => grid.data.rows.find(r => r.department_code === d && r.shift === sh)

  // Detail strip: hovered cell, else the one tapped, else the story focus.
  const shown = (mode === 'cell' ? focus : hover ?? picked ?? focus) ?? null
  const shownCell = shown ? cellOf(shown.dept, shown.shift) : undefined
  const deptName = (code: string) => ref.data.departments.find(d => d.code === code)?.name ?? code
  const series = (d: string, sh: string) => (trends.data?.rows ?? []).filter(r => r.department_code === d && r.shift === sh)
  const plantSeries = series('ALL', 'ALL')
  const shownSeries = shown ? series(shown.dept, shown.shift) : []
  const weekIdx = new Map(plantSeries.map((r, i) => [r.week_start, i]))
  const aligned = plantSeries.map(() => null as number | null)
  for (const r of shownSeries) { const i = weekIdx.get(r.week_start); if (i != null) aligned[i] = r.unplanned_absence_rate }
  const gap = shownCell?.unplanned_absence_rate != null && plant != null ? shownCell.unplanned_absence_rate - plant : null
  const isFlag = shown ? flagged.has(`${shown.dept}|${shown.shift}`) : false

  return (
    <figure className="board" data-mode={mode} aria-label="Unplanned absence by department and shift, last 4 weeks" onMouseLeave={() => setHover(null)}>
      <figcaption className="board-cap">
        <span>Unplanned absence by shift, last 4 weeks</span>
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
                shown && shown.dept === d.code && shown.shift === sh.key ? 'shown' : '',
              ].filter(Boolean).join(' ')
              return (
                <span key={sh.key} role="cell" className="board-slot">
                <a
                  className={cls}
                  href={href('attendance', { dept: d.code, shift: sh.key })}
                  style={{ ['--t' as string]: t.toFixed(3), ['--c' as string]: ci }}
                  aria-label={`${d.name}, ${sh.label.toLowerCase()} shift: ${fmt(v)}% unplanned absence, ${c.employees} people. Open attendance.`}
                  onMouseEnter={() => setHover({ dept: d.code, shift: sh.key })}
                  onFocus={() => setHover({ dept: d.code, shift: sh.key })}
                  onClick={e => {
                    // Touch: the first tap shows the details, the link in the strip opens the page.
                    if (!hoverCapable() && !(picked?.dept === d.code && picked?.shift === sh.key)) {
                      e.preventDefault()
                      setPicked({ dept: d.code, shift: sh.key })
                      return
                    }
                    ;(e.currentTarget as HTMLElement).style.viewTransitionName = 'focus-cell'
                  }}
                >
                  <span className="board-bar" aria-hidden="true" />
                  <span className="board-val">{fmt(v)}</span>
                </a>
                </span>
              )
            })}
          </div>
        ))}
      </div>

      <div className={`board-detail${isFlag ? ' flag' : ''}`} aria-live="polite">
        {shown && shownCell?.unplanned_absence_rate != null ? (
          <>
            <div className="bd-head">
              <strong>{deptName(shown.dept)}, {shown.shift.toLowerCase()} shift</strong>
              <span>{shownCell.employees} people</span>
            </div>
            <div className="bd-body">
              <div className="bd-num">
                <b>{fmt(shownCell.unplanned_absence_rate)}%</b>
                {gap != null && <span className={gap > 1 ? 'up' : gap < -1 ? 'down' : ''}>{gap >= 0 ? '+' : '−'}{fmt(Math.abs(gap))} pts vs plant</span>}
              </div>
              <Trend key={`${shown.dept}|${shown.shift}`} values={aligned} plant={plantSeries.map(r => r.unplanned_absence_rate)} flag={isFlag} />
            </div>
            <div className="bd-links">
              <a href={href('attendance', { dept: shown.dept, shift: shown.shift })}>Open attendance</a>
              <a href={href('ask', { q: `How has absence on ${deptName(shown.dept)} ${shown.shift.toLowerCase()} shift changed?` })}>Ask about it</a>
              <span className="bd-legend"><i /> plant</span>
            </div>
          </>
        ) : (
          <p className="bd-empty">Point at a cell to see that team’s last 26 weeks.</p>
        )}
      </div>

      <div className="board-foot">
        <span>Plant average {plant != null ? `${fmt(plant)}%` : '–'}</span>
        <span><i className="key-flag" /> Flagged this week</span>
        <span><i className="key-hidden" /> Hidden, under 10 people</span>
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

/** Sets the index of the step nearest the middle of the viewport (or -1 above the story). */
function useActiveStep(list: React.RefObject<HTMLElement | null>, count: number) {
  const [active, setActive] = useState(-1)
  useEffect(() => {
    const el = list.current
    if (!el || !('IntersectionObserver' in window)) return
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const i = Number((e.target as HTMLElement).dataset.step)
        if (e.isIntersecting) setActive(i)
        else if (i === 0 && e.boundingClientRect.top > 0) setActive(-1)
      }
    // On narrow screens the pinned board covers the top of the viewport, so a step counts once its card is below it.
    }, { rootMargin: window.innerWidth < 1080 ? '-62% 0px -22% 0px' : '-45% 0px -45% 0px' })
    el.querySelectorAll('[data-step]').forEach(n => io.observe(n))
    return () => io.disconnect()
  }, [list, count])
  return active
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

function Change({ signal }: { signal: Signal }) {
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
          <a href={signalLink(signal)}>{AREA_LABEL[signal.area]}</a>
          <a href={href('ask', { q: signal.question })}>Ask about it</a>
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
  'Can I trust the data?',
]

function AskBox() {
  const [draft, setDraft] = useState('')
  const go = (q: string) => { if (q.trim()) window.location.hash = href('ask', { q: q.trim() }) }
  return (
    <div className="askbox">
      <form onSubmit={e => { e.preventDefault(); go(draft) }}>
        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Which shift has the most overtime?" aria-label="Ask a question about the workforce" />
        <button type="submit" disabled={!draft.trim()}>Ask</button>
      </form>
      <div className="askbox-starters">
        {STARTERS.map(s => <button key={s} type="button" onClick={() => go(s)}>{s}</button>)}
      </div>
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

export function Brief() {
  const trpc = useTRPC()
  const { replayIntro } = useRuntime()
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)
  const status = useQuery(trpc.meta.status.queryOptions())
  const kpis = useQuery(trpc.kpi.summary.queryOptions())
  const signals = useQuery(trpc.insights.signals.queryOptions())

  const primaryIds = ['headcount', 'unplanned_absence', 'attrition', 'training_on_time']
  const primary = primaryIds.map(id => kpis.data?.find(x => x.id === id)).filter(Boolean) as KpiTile[]
  const changes = signals.data?.filter(s => s.severity !== 'info').slice(0, 3) ?? []
  const head = signals.data ? headlineFrom(signals.data) : null
  const flagged = new Set(changes.filter(s => s.department && s.shift && s.shift !== 'ALL').map(s => `${s.department}|${s.shift}`))
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks: 4 }))
  const plant = grid.data?.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')?.unplanned_absence_rate ?? null
  const teams = grid.data?.rows.filter(r => r.department_code !== 'ALL' && r.shift !== 'ALL' && r.shift !== 'UNASSIGNED').length ?? 21
  const focus: Focus | null = head?.group?.shift && head.group.shift !== 'ALL' ? { dept: head.group.dept, shift: head.group.shift } : null
  const row: RowVals = focus ? ['EARLY', 'LATE', 'NIGHT'].map(sh => ({ shift: sh, value: grid.data?.rows.find(r => r.department_code === focus.dept && r.shift === sh && !r.suppressed)?.unplanned_absence_rate ?? null })) : []
  const steps = signals.data ? storySteps(signals.data, plant, teams, focus, row) : []
  const stepList = useRef<HTMLOListElement>(null)
  const active = useActiveStep(stepList, steps.length)

  return (
    <div className="brief" ref={root}>
      <div className="reading-progress" aria-hidden="true" />
      <section className="story">
        <div className="hero-copy">
          <p className="hero-date">Weekly people brief for a synthetic plant of about 2,600 people{status.data ? `, week ending ${fmtDate(status.data.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}</p>
          <h1>{head ? head.title : <span className="ghost-line" />}</h1>
          <p className="hero-lead">{head?.lead ?? ''}</p>
          <div className="hero-actions">
            <button className="btn-solid" onClick={() => document.querySelector('[data-step="0"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Show me how it found this</button>
            {kpis.data && signals.data && status.data && (
              <button className="btn-line" onClick={() => downloadText(`people-brief-${status.data.asOf}.md`, briefMarkdown(status.data.asOf, kpis.data, signals.data), 'text/markdown')}>
                <Icon name="download" /> Download the brief
              </button>
            )}
          </div>
        </div>
        <div className="story-visual">
          <div className="story-sticky">
            {steps.length > 0 && (
              <nav className={`step-rail${active >= 0 ? ' on' : ''}`} aria-label="Story steps">
                {steps.map((st, i) => (
                  <button key={i} className={i === active ? 'cur' : i < active ? 'past' : ''} aria-label={`Step ${i + 1}: ${st.title}`} aria-current={i === active ? 'step' : undefined}
                    onClick={() => document.querySelector(`[data-step="${i}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })} />
                ))}
                <span>{active >= 0 ? `Step ${active + 1} of ${steps.length}: ${steps[active].title}` : `${steps.length} steps: how the brief found this`}</span>
              </nav>
            )}
            <ShiftBoard flagged={flagged} focus={focus} mode={active >= 0 ? steps[active]?.mode ?? 'brief' : 'brief'} />
          </div>
        </div>
        <ol className="story-steps" ref={stepList}>
          {steps.map((st, i) => (
            <li key={i} data-step={i} className={active === i ? 'on' : ''}>
              <div className="step-card">
                <span className="step-n">Step {i + 1} of {steps.length}</span>
                <h2>{st.title}</h2>
                <p>{st.body}</p>
                {i === steps.length - 1 && <button className="step-next" onClick={() => document.getElementById('changes')?.scrollIntoView({ behavior: 'smooth' })}>See the changes in detail</button>}
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="vitals" aria-label="Headline numbers">
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
          : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={92} />)}
      </section>
      {kpis.error && <ErrorNote error={kpis.error} />}

      <section className="block" id="changes">
        <header className="block-head">
          <h2>{changes.length === 1 ? 'One change is worth a conversation' : `${['Two', 'Three'][changes.length - 2] ?? 'Three'} changes are worth a conversation`}</h2>
          <p>Each one is a team compared with the rest of the plant over the last six weeks, flagged only when the gap is statistically clear. They point to where a manager should look, never to individuals.</p>
        </header>
        {signals.isLoading && <Skeleton height={320} />}
        {signals.error && <ErrorNote error={signals.error} />}
        <ol className="changes">{changes.map(s => <Change key={s.id} signal={s} />)}</ol>
        {signals.data && changes.length === 0 && <p className="empty">Nothing stands out in this snapshot.</p>}
      </section>

      <section className="block">
        <header className="block-head">
          <h2>Bad data is stopped before it reaches a chart</h2>
          <p>A missing punch can look like an absence. Every source row is checked first, and anything that fails is held back where a reviewer can see it.</p>
        </header>
        <Trust />
        <WhatIf />
        <a className="more" href={href('quality')}>Review the checks that found something</a>
      </section>

      <section className="block block-split">
        <header className="block-head">
          <h2>Ask in plain words</h2>
          <p>Answers come only from approved aggregate queries, and each one shows the SQL behind it. Questions about individual employees are declined.</p>
        </header>
        <AskBox />
      </section>

      <section className="block block-build">
        <header className="block-head">
          <h2>How it’s built</h2>
          <p>The whole stack runs in this browser tab: PostgreSQL compiled to WebAssembly, Prisma, a tRPC router and React. The same code runs on a Node server against real PostgreSQL, and GitHub Actions tests both.</p>
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
