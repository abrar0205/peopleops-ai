import { useState } from 'react'
import type { Signal } from '../../api/insights'
import { departmentName } from '../../api/queries'
import { LineChart } from '../charts'
import { fmt, fmtDate, href } from '../common'
import { CountUp } from '../motion'

export interface TeamData {
  dept: string
  shift: string
  employees: number
  rate: number | null
  plantRate: number | null
  weeks: { week: string; team: number | null; plant: number | null }[]
  overtime: { team: number | null; plant: number | null } | null
  early: { exits: number | null; hires: number; rate: number | null; plantRate: number | null; suppressed: boolean } | null
  signals: Signal[]
}

/** The selected team as people: one mark per person, red rings for the share lost to unplanned absence. */
function PeopleStrip({ n, absent }: { n: number; absent: number }) {
  const cols = 24
  const rows = Math.ceil(n / cols)
  const marks = new Set(Array.from({ length: absent }, (_, k) => Math.floor(((k + 0.5) * n) / absent)))
  return (
    <svg className="people" viewBox={`0 0 ${cols * 10} ${rows * 13}`} role="img" aria-label={`${n} people, about ${absent} lost to unplanned absence on a typical shift`}>
      {Array.from({ length: n }, (_, i) => {
        const x = (i % cols) * 10 + 5, y = Math.floor(i / cols) * 13 + 4
        const isAbsent = marks.has(i)
        return (
          <g key={i} className={isAbsent ? 'p absent' : 'p'} style={{ ['--i' as string]: i }}>
            <circle cx={x} cy={y} r={2.3} />
            <path d={`M${x - 3.2} ${y + 8} q0 -4.2 3.2 -4.2 q3.2 0 3.2 4.2 z`} />
          </g>
        )
      })}
    </svg>
  )
}

export function Team({ t, onAsk }: { t: TeamData; onAsk: (q: string) => void }) {
  const [copied, setCopied] = useState(false)
  const name = `${departmentName(t.dept)}, ${t.shift.toLowerCase()} shift`
  const absent = t.rate != null ? Math.round((t.employees * t.rate) / 100) : 0
  const gap = t.rate != null && t.plantRate != null ? t.rate - t.plantRate : null
  const flagged = t.signals.some(s => s.severity !== 'info')
  const link = `${location.origin}${location.pathname}${href('overview', { team: `${t.dept}-${t.shift}` })}`
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 1800) } catch { window.prompt('Copy this link', link) }
  }

  return (
    <article id="team-panel" className={`team${flagged ? ' flagged' : ''}`} key={`${t.dept}-${t.shift}`} aria-live="polite">
      <header className="team-head">
        <div>
          <h3>{name}</h3>
          <p>{t.employees} people on the roster{flagged ? <> · <b className="tag-act">Flagged this week</b></> : null}</p>
        </div>
        <div className="team-actions">
          <button className="btn-line small" onClick={copy}>{copied ? 'Link copied' : 'Copy link'}</button>
          <button className="btn-solid small" onClick={() => onAsk(`How has absence on ${departmentName(t.dept)} ${t.shift.toLowerCase()} shift changed?`)}>Ask about this team</button>
        </div>
      </header>

      {t.rate != null ? (
        <>
          <PeopleStrip n={t.employees} absent={absent} />
          <p className="team-lede">
            <b>{fmt(t.rate)}%</b> of scheduled hours were lost to unplanned absence over the last four weeks, roughly <b className="red">{absent} of {t.employees}</b> people on a typical shift
            {gap != null ? <>, {Math.abs(gap) < 0.5 ? 'in line with the plant' : `${fmt(Math.abs(gap))} points ${gap > 0 ? 'above' : 'below'} the plant`}.</> : '.'}
          </p>
        </>
      ) : (
        <p className="team-lede">Fewer than 10 people on this team, so its rates are hidden to protect privacy.</p>
      )}

      <div className="team-stats">
        <div>
          <span>Unplanned absence</span>
          <strong>{t.rate != null ? <CountUp text={`${fmt(t.rate)}%`} /> : '–'}</strong>
          <small>Plant {t.plantRate != null ? `${fmt(t.plantRate)}%` : '–'}</small>
        </div>
        <div>
          <span>Overtime per head</span>
          <strong>{t.overtime?.team != null ? <CountUp text={`${fmt(t.overtime.team, 2)} h`} /> : '–'}</strong>
          <small>Plant {t.overtime?.plant != null ? `${fmt(t.overtime.plant, 2)} h` : '–'} a week</small>
        </div>
        <div>
          <span>New starters gone in 90 days</span>
          <strong>{t.early && !t.early.suppressed && t.early.rate != null ? <CountUp text={`${fmt(t.early.rate)}%`} /> : '–'}</strong>
          <small>{t.early && !t.early.suppressed && t.early.exits != null ? `${t.early.exits} of ${t.early.hires} hires · plant ${t.early.plantRate != null ? fmt(t.early.plantRate) : '–'}%` : 'Too few hires to report'}</small>
        </div>
      </div>

      {t.weeks.length > 3 && (
        <div className="team-chart">
          <span>Weekly unplanned absence, last {t.weeks.length} weeks</span>
          <LineChart
            ariaLabel={`Weekly unplanned absence for ${name} against the plant`}
            labels={t.weeks.map(w => w.week)}
            series={[
              { name, color: 'series-1', values: t.weeks.map(w => w.team) },
              { name: 'Plant', color: 'reference', values: t.weeks.map(w => w.plant) },
            ]}
            unit="%"
            formatX={fmtDate}
            height={190}
          />
        </div>
      )}

      <footer className="team-foot">
        <a href={href('attendance', { dept: t.dept, shift: t.shift })}>Full attendance analysis</a>
        <a href={href('attrition', { dept: t.dept, shift: t.shift })}>Attrition for this team</a>
      </footer>
    </article>
  )
}
