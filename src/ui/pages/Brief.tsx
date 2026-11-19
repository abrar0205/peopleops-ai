import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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

/* ------------------------------------------------------------------ shift board (hero) */

const SHIFTS = [
  { key: 'EARLY', label: 'Early' },
  { key: 'LATE', label: 'Late' },
  { key: 'NIGHT', label: 'Night' },
]

function ShiftBoard({ flagged }: { flagged: Set<string> }) {
  const trpc = useTRPC()
  const grid = useQuery(trpc.attendance.byGroup.queryOptions({ by: 'department_shift', weeks: 4 }))
  const ref = useQuery(trpc.meta.reference.queryOptions())
  if (!grid.data || !ref.data) return <Skeleton height={340} />
  const plant = grid.data.rows.find(r => r.department_code === 'ALL' && r.shift === 'ALL')?.unplanned_absence_rate ?? null
  const values = grid.data.rows.filter(r => r.department_code !== 'ALL' && r.shift !== 'ALL' && !r.suppressed && r.unplanned_absence_rate != null).map(r => r.unplanned_absence_rate!)
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  return (
    <figure className="board" aria-label="Unplanned absence by department and shift, last 4 weeks">
      <figcaption className="board-cap">
        <span>Unplanned absence by shift, last 4 weeks</span>
        <EvidenceButton title="Shift board: department × shift absence" evidence={[grid.data]} label="Query" />
      </figcaption>
      <div className="board-grid" role="table">
        <div className="board-row board-head" role="row">
          <span role="columnheader" />
          {SHIFTS.map(s => <span key={s.key} role="columnheader">{s.label}</span>)}
        </div>
        {ref.data.departments.map(d => (
          <div className="board-row" role="row" key={d.code}>
            <span className="board-dept" role="rowheader">{d.name}</span>
            {SHIFTS.map(s => {
              const c = grid.data.rows.find(r => r.department_code === d.code && r.shift === s.key)
              if (!c || c.suppressed || c.unplanned_absence_rate == null)
                return <span key={s.key} role="cell" className="board-cell hidden" title="Fewer than 10 people, hidden">&lt;10</span>
              const v = c.unplanned_absence_rate
              const t = (v - lo) / (hi - lo || 1)
              const isFlag = flagged.has(`${d.code}|${s.key}`)
              return (
                <a
                  key={s.key}
                  role="cell"
                  href={href('attendance', { dept: d.code, shift: s.key })}
                  className={`board-cell${isFlag ? ' flag' : ''}`}
                  style={{ ['--t' as string]: t.toFixed(3) }}
                  title={`${d.name}, ${s.label.toLowerCase()} shift: ${fmt(v)}% (${c.employees} people)`}
                >
                  <span className="board-bar" aria-hidden="true" />
                  <span className="board-val">{fmt(v)}</span>
                </a>
              )
            })}
          </div>
        ))}
      </div>
      <div className="board-foot">
        <span>Plant average {plant != null ? `${fmt(plant)}%` : '–'}</span>
        <span><i className="key-flag" /> Flagged this week</span>
        <span><i className="key-hidden" /> Hidden, under 10 people</span>
      </div>
    </figure>
  )
}

/* ------------------------------------------------------------------ sections */

function Change({ signal }: { signal: Signal }) {
  const { now, ref } = comparison(signal)
  const a = num(now?.value)
  const b = num(ref?.value)
  const max = Math.max(a, b) || 1
  const level = signal.severity === 'high' ? 'act' : 'watch'
  return (
    <li className={`change ${level}`}>
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
      )}
    </li>
  )
}

function Trust() {
  const trpc = useTRPC()
  const q = useQuery(trpc.quality.overview.queryOptions())
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
    <div className="trust">
      <div className="trust-score">
        <strong>{fmt(pct)}%</strong>
        <p>of source rows pass every check and reach the figures on this page.</p>
        <EvidenceButton title="Data health by source" evidence={[q.data.health]} label="Query" />
      </div>
      <ol className="trust-steps">
        {steps.map(s => (
          <li key={s.label}>
            <strong>{s.n}</strong>
            <span>{s.label}</span>
            <small>{s.sub}</small>
          </li>
        ))}
      </ol>
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

/* ------------------------------------------------------------------ page */

export function Brief() {
  const trpc = useTRPC()
  const status = useQuery(trpc.meta.status.queryOptions())
  const kpis = useQuery(trpc.kpi.summary.queryOptions())
  const signals = useQuery(trpc.insights.signals.queryOptions())

  const primaryIds = ['headcount', 'unplanned_absence', 'attrition', 'training_on_time']
  const primary = primaryIds.map(id => kpis.data?.find(x => x.id === id)).filter(Boolean) as KpiTile[]
  const changes = signals.data?.filter(s => s.severity !== 'info').slice(0, 3) ?? []
  const head = signals.data ? headlineFrom(signals.data) : null
  const flagged = new Set(changes.filter(s => s.department && s.shift && s.shift !== 'ALL').map(s => `${s.department}|${s.shift}`))

  return (
    <div className="brief">
      <section className="hero">
        <div className="hero-copy">
          <p className="hero-date">{status.data ? `Week ending ${fmtDate(status.data.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Loading this week'}, synthetic plant of about 2,600 people</p>
          <h1>{head ? head.title : <span className="ghost-line" />}</h1>
          <p className="hero-lead">{head?.lead ?? ''}</p>
          <div className="hero-actions">
            <button className="btn-solid" onClick={() => document.getElementById('changes')?.scrollIntoView({ behavior: 'smooth' })}>See what changed</button>
            {kpis.data && signals.data && status.data && (
              <button className="btn-line" onClick={() => downloadText(`people-brief-${status.data.asOf}.md`, briefMarkdown(status.data.asOf, kpis.data, signals.data), 'text/markdown')}>
                <Icon name="download" /> Download the brief
              </button>
            )}
          </div>
        </div>
        <ShiftBoard flagged={flagged} />
      </section>

      <section className="vitals" aria-label="Headline numbers">
        {primary.length === 4
          ? primary.map(t => {
              const delta = t.value != null && t.previous != null ? t.value - t.previous : null
              const good = delta == null || t.goodDirection === 'none' ? null : (delta > 0) === (t.goodDirection === 'up')
              return (
                <div className="vital" key={t.id}>
                  <span className="vital-label">{t.label}</span>
                  <strong>{formatTile(t)}</strong>
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
        <a className="more" href={href('quality')}>Review the checks that found something</a>
      </section>

      <section className="block block-split">
        <header className="block-head">
          <h2>Ask in plain words</h2>
          <p>Answers come only from approved aggregate queries, and each one shows the SQL behind it. Questions about individual employees are declined.</p>
        </header>
        <AskBox />
      </section>

      <section className="block">
        <header className="block-head">
          <h2>How it’s built</h2>
          <p>The whole stack runs in this browser tab: PostgreSQL compiled to WebAssembly, Prisma, a tRPC router and React. The same code runs on a Node server against real PostgreSQL, and GitHub Actions tests both.</p>
        </header>
        <ol className="flow">
          {FLOW.map(f => (
            <li key={f.t}><strong>{f.t}</strong><span>{f.d}</span></li>
          ))}
        </ol>
        <div className="build-links">
          <a href={href('method')}>Metric definitions and privacy</a>
          <a href={href('sql')}>Query the data yourself</a>
          <a href="https://github.com/abrar0205/peopleops-ai" target="_blank" rel="noreferrer"><Icon name="github" /> Source on GitHub</a>
        </div>
      </section>
    </div>
  )
}
