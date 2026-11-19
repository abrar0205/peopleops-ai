import { useEffect, useState } from 'react'
import type { BootStep } from '../browser/boot'
import type { Snapshot } from '../api/snapshot'
import { fmtInt } from './common'

/**
 * Loading screen as a live pipeline: records flow from three source systems
 * through the quality gate onto the shift board, a few get held back. The
 * motion is illustrative and CSS-only (transform/opacity), so it keeps running
 * while PostgreSQL boots on the main thread. The phase tracker underneath is
 * driven by the real boot steps.
 */

export const PHASES = [
  { label: 'Start PostgreSQL in this tab', match: /PostgreSQL|migrations/ },
  { label: 'Land the source extracts', match: /extracts|staging|reference/i },
  { label: 'Run the data-quality checks', match: /quality|issues/i },
  { label: 'Load clean rows and build the views', match: /core tables|analytics|Prisma|Ready/ },
]

export function phaseOf(steps: BootStep[]) {
  let idx = -1
  for (const s of steps) PHASES.forEach((p, i) => { if (p.match.test(s.label)) idx = Math.max(idx, i) })
  const ready = steps.some(s => s.label === 'Ready')
  const ms = steps.reduce((t, s) => t + (s.ms ?? 0), 0)
  return { idx, ready, ms }
}

const SOURCES = [
  { key: 'hris', label: 'HR records', held: [3] },
  { key: 'timeclock', label: 'Time clock', held: [1, 4] },
  { key: 'lms', label: 'Training', held: [] as number[] },
] as const

const DOTS = 6
const BOARD = [
  [0.55, 0.35, 0.6], [0.05, 0.45, 0.7], [0.55, 0.4, 0.6], [0.3, 0.42, 1],
  [0.25, 0.2, -1], [0.18, 0.18, 0.1], [0.38, 0.28, 0.72],
]

// If the static HTML splash was on screen, don't replay the entrance: the copy is already there.
const hadSplash = typeof document !== 'undefined' && Boolean(document.getElementById('splash'))

export function Intro({ steps, snapshot, auto, leaving, onSkip, onDone, error, replay = false }: {
  /** Replaying from the page: the phases play through on a timer instead of following the boot. */
  replay?: boolean
  steps: BootStep[]
  snapshot: Snapshot | null
  /** Fade out on the CSS --intro timer (the brief is ready behind it). */
  auto: boolean
  leaving: boolean
  onSkip: () => void
  onDone: () => void
  error?: unknown
}) {
  const live = phaseOf(steps)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    if (!replay) return
    const t = setInterval(() => setTick(v => Math.min(v + 1, PHASES.length)), 1100)
    return () => clearInterval(t)
  }, [replay])
  const idx = replay ? Math.min(tick, PHASES.length - 1) : live.idx
  const ready = replay ? tick >= PHASES.length : live.ready
  // Same figure as the brief's data-quality section: rows held back across all sources.
  const health = snapshot?.entries.find(e => e.path === 'quality.overview')?.data as { health: { rows: { held_back: number }[] } } | undefined
  const held = health ? health.health.rows.reduce((s, r) => s + r.held_back, 0) : null

  return (
    <div style={replay ? ({ '--intro': '5.2s' } as React.CSSProperties) : undefined} className={`intro${auto ? ' auto' : ''}${leaving ? ' leaving' : ''}${hadSplash && !replay ? ' from-splash' : ''}`} role="dialog" aria-label="PeopleOps is starting" onAnimationEnd={e => { if (e.target === e.currentTarget) onDone() }}>
      <div className="intro-inner">
        <header className="intro-top">
          <span className="logo">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="6" height="6" /><rect x="9" y="2" width="6" height="6" /><rect x="16" y="2" width="6" height="6" /><rect x="2" y="9" width="6" height="6" /><rect x="9" y="9" width="6" height="6" className="hot" /><rect x="16" y="9" width="6" height="6" /><rect x="2" y="16" width="6" height="6" /><rect x="9" y="16" width="6" height="6" /><rect x="16" y="16" width="6" height="6" /></svg>
            <span>PeopleOps</span>
          </span>
          {(snapshot || replay) && <button className="intro-skip" onClick={onSkip}>{replay ? 'Close' : 'Open the brief'}</button>}
        </header>

        <div className="intro-copy">
          <h1>Raw workforce data in. A brief a plant manager can trust out.</h1>
          <p>PeopleOps checks every HR, time-clock and training record, holds back the bad ones, and turns the rest into a weekly brief. The whole pipeline is starting in your browser right now, on synthetic data.</p>
        </div>

        <div className="stage" aria-hidden="true">
          <div className="stage-sources">
            {SOURCES.map(s => (
              <div className="src" key={s.key}>
                <strong>{s.label}</strong>
                <span>{snapshot ? `${fmtInt(snapshot.sources[s.key].received)} rows` : 'rows'}</span>
              </div>
            ))}
          </div>

          <div className="stage-tracks">
            {SOURCES.map((s, row) => (
              <div className="track" key={s.key}>
                {Array.from({ length: DOTS }, (_, i) => {
                  const held = (s.held as readonly number[]).includes(i)
                  return (
                    <span
                      key={i}
                      className={`run${held ? ' held' : ''}`}
                      style={{ animationDelay: `${-(i / DOTS) * 2.6 - row * 0.37}s` }}
                    >
                      <i style={{ animationDelay: `${-(i / DOTS) * 2.6 - row * 0.37}s` }} />
                    </span>
                  )
                })}
              </div>
            ))}
            <div className="gate">
              <span className="gate-scan" />
              <strong>{snapshot?.rules ?? 18} checks</strong>
            </div>
            <div className="tray">
              <strong>{held != null ? fmtInt(held) : '…'}</strong>
              <span>held back for review</span>
            </div>
          </div>

          <div className="stage-board">
            <span className="stage-board-cap">Shift board</span>
            <div className="mini">
              {BOARD.flatMap((row, r) => row.map((t, c) => (
                <i
                  key={`${r}-${c}`}
                  className={t === 1 ? 'hot' : t < 0 ? 'off' : ''}
                  style={{ ['--t' as string]: Math.max(0, t), animationDelay: `${0.9 + r * 0.12 + c * 0.05}s` }}
                />
              )))}
            </div>
          </div>
        </div>

        <ol className="phases">
          {PHASES.map((p, i) => {
            const state = ready || i < idx ? 'done' : i === idx ? 'now' : 'todo'
            return (
              <li key={p.label} className={state}>
                <span className="ph-dot" />
                <span>{p.label}</span>
              </li>
            )
          })}
        </ol>
        {error != null && <p className="intro-error">The in-browser database could not start: {error instanceof Error ? error.message : String(error)}</p>}
      </div>
    </div>
  )
}
