import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { fmt } from './common'

function useWidth<T extends HTMLElement>(fallback = 640) {
  const ref = useRef<T>(null)
  const [width, setWidth] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, width] as const
}

function niceTicks(min: number, max: number, count = 4) {
  const span = max - min || 1
  const raw = span / count
  const pow = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map(m => m * pow).find(s => span / s <= count) ?? raw
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Number(v.toFixed(6)))
  return ticks
}

const COLORS = { 'series-1': 'var(--series-1)', 'series-2': 'var(--series-2)', reference: 'var(--reference)' }

export interface LineSeries {
  name: string
  values: (number | null)[]
  color: keyof typeof COLORS
}

/** Line chart with a crosshair tooltip. One y-axis, end labels on each series. */
export function LineChart({ labels, series, unit = '', digits = 1, height = 220, formatX = (s: string) => s, zeroBased = false, band, ariaLabel }: {
  labels: string[]
  series: LineSeries[]
  unit?: string
  digits?: number
  height?: number
  formatX?: (label: string) => string
  zeroBased?: boolean
  /** Highlight one x position (e.g. a week containing an excluded day). */
  band?: { index: number; label: string }
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const pad = { l: 40, r: 56, t: 12, b: 26 }
  const all = series.flatMap(s => s.values).filter((v): v is number => v != null)
  if (all.length === 0) return <div className="empty">No data for this selection (groups under 10 people are suppressed).</div>
  let lo = Math.min(...all)
  let hi = Math.max(...all)
  if (zeroBased) lo = 0
  const span = hi - lo || 1
  if (!zeroBased) lo -= span * 0.12
  hi += span * 0.12
  const ticks = niceTicks(lo, hi)
  lo = ticks[0]
  hi = ticks[ticks.length - 1]
  const n = labels.length
  const x = (i: number) => pad.l + (n === 1 ? 0 : (i * (width - pad.l - pad.r)) / (n - 1))
  const y = (v: number) => pad.t + ((hi - v) / (hi - lo)) * (height - pad.t - pad.b)
  const path = (vals: (number | null)[]) => {
    let d = ''
    let pen = false
    vals.forEach((v, i) => {
      if (v == null) return void (pen = false)
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`
      pen = true
    })
    return d
  }
  const xEvery = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((width - pad.l - pad.r) / 64))))
  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect()
    const px = ((e.clientX - box.left) / box.width) * width
    const i = Math.round(((px - pad.l) / (width - pad.l - pad.r)) * (n - 1))
    setHover(Math.max(0, Math.min(n - 1, i)))
  }
  // Keep end labels from colliding.
  const ends = series
    .map(s => {
      const idx = s.values.map((v, i) => (v == null ? -1 : i)).filter(i => i >= 0).at(-1)
      return idx == null ? null : { s, v: s.values[idx] as number, yy: y(s.values[idx] as number) }
    })
    .filter((e): e is NonNullable<typeof e> => e != null)
    .sort((a, b) => a.yy - b.yy)
  for (let i = 1; i < ends.length; i++) if (ends[i].yy - ends[i - 1].yy < 14) ends[i].yy = ends[i - 1].yy + 14

  return (
    <div className="chart" ref={ref}>
      {series.length > 1 && (
        <div className="legend">
          {series.map(s => (
            <span key={s.name}>
              <i className="swatch" style={{ background: COLORS[s.color] }} /> {s.name}
            </span>
          ))}
        </div>
      )}
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {band && band.index >= 0 && (
          <g>
            <rect className="excluded-band" x={x(band.index) - 8} y={pad.t} width={16} height={height - pad.t - pad.b} rx={3} />
          </g>
        )}
        {ticks.map(t => (
          <g key={t}>
            <line className="gridline" x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} />
            <text className="axis-label" x={pad.l - 8} y={y(t) + 4} textAnchor="end">
              {fmt(t, Number.isInteger(t) ? 0 : digits)}
            </text>
          </g>
        ))}
        {labels.map((l, i) =>
          (i % xEvery === 0 && (n - 1 - i >= xEvery * 0.75 || i === 0)) || i === n - 1 ? (
            <text key={l + i} className="axis-label" x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}>
              {formatX(l)}
            </text>
          ) : null,
        )}
        {series.map(s => (
          <path key={s.name} d={path(s.values)} className="series-line" stroke={COLORS[s.color]} strokeWidth={s.color === 'reference' ? 1.5 : 2} />
        ))}
        {ends.map(e => (
          <text key={e.s.name} className="end-label" x={width - pad.r + 6} y={e.yy + 4}>
            {fmt(e.v, digits)}
            {unit === '%' ? '%' : ''}
          </text>
        ))}
        {hover != null && (
          <g>
            <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} />
            {series.map(s =>
              s.values[hover] == null ? null : <circle key={s.name} className="marker" cx={x(hover)} cy={y(s.values[hover] as number)} r={4.5} fill={COLORS[s.color]} />,
            )}
          </g>
        )}
        <rect x={pad.l} y={0} width={Math.max(0, width - pad.l - pad.r)} height={height} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} />
      </svg>
      {hover != null && (
        <div className="tooltip" style={{ left: `${(x(hover) / width) * 100}%`, top: Math.min(...series.map(s => (s.values[hover] == null ? height : y(s.values[hover] as number)))) }}>
          <div className="tt-title">{formatX(labels[hover])}{band?.index === hover ? ` · ${band.label}` : ''}</div>
          {series.map(s => (
            <div className="tt-row" key={s.name}>
              <span>
                <i className="swatch" style={{ background: COLORS[s.color] }} /> {s.name}
              </span>
              <strong className="num">{s.values[hover] == null ? 'suppressed' : `${fmt(s.values[hover], digits)}${unit}`}</strong>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Sparkline({ values, height = 30 }: { values: (number | null)[]; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(160)
  const vals = values.filter((v): v is number => v != null)
  if (vals.length < 2) return <div ref={ref} style={{ height }} />
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const x = (i: number) => 2 + (i * (width - 6)) / (values.length - 1)
  const y = (v: number) => 3 + ((hi - v) / (hi - lo || 1)) * (height - 6)
  const d = values.map((v, i) => (v == null ? '' : `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`)).join('')
  return (
    <div className="spark" ref={ref} aria-hidden="true">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
        <path d={d} fill="none" stroke="var(--series-1)" strokeWidth="1.5" strokeLinejoin="round" />
        <circle cx={x(values.length - 1)} cy={y(vals[vals.length - 1])} r="2.5" fill="var(--series-1)" />
      </svg>
    </div>
  )
}

export interface BarItem {
  key: string
  label: string
  value: number | null
  focus?: boolean
  note?: string
}

/** Horizontal bars, one color, focus bar highlighted, plant reference as a tick. */
export function BarList({ items, reference, unit = '', digits = 1, onSelect, ariaLabel }: { items: BarItem[]; reference?: { value: number; label: string }; unit?: string; digits?: number; onSelect?: (key: string) => void; ariaLabel: string }) {
  const max = Math.max(...items.map(i => i.value ?? 0), reference?.value ?? 0) * 1.08 || 1
  return (
    <div className="bars" role="list" aria-label={ariaLabel}>
      {reference && (
        <div className="legend" style={{ marginBottom: 2 }}>
          <span>
            <i className="swatch" style={{ width: 2, height: 12, background: 'var(--text-2)' }} /> {reference.label}: {fmt(reference.value, digits)}
            {unit}
          </span>
        </div>
      )}
      {items.map(it => (
        <div
          key={it.key}
          role="listitem"
          className={`bar-row ${it.value == null ? 'suppressed' : ''}`}
          onClick={onSelect ? () => onSelect(it.key) : undefined}
          style={onSelect ? { cursor: 'pointer' } : undefined}
          title={it.note}
        >
          <span className="bar-label">{it.label}</span>
          <span className="bar-track">
            {it.value != null && <span className={`bar-fill ${it.focus ? 'focus' : ''}`} style={{ width: `${(it.value / max) * 100}%` }} />}
            {reference && <span className="bar-ref" style={{ left: `${(reference.value / max) * 100}%` }} />}
          </span>
          <span className="bar-value">{it.value == null ? '<10' : `${fmt(it.value, digits)}${unit}`}</span>
        </div>
      ))}
    </div>
  )
}

export interface HeatCell {
  value: number | null
  suppressed: boolean
  n?: number
}

const STEPS = 7
/** Sequential one-hue heat table. Suppressed cells are hatched and say "<10". */
export function Heatmap({ rows, cols, cell, unit = '', digits = 1, selected, onSelect, caption }: {
  rows: { key: string; label: string }[]
  cols: { key: string; label: string }[]
  cell: (row: string, col: string) => HeatCell | undefined
  unit?: string
  digits?: number
  selected?: { row: string; col: string }
  onSelect?: (row: string, col: string) => void
  caption: string
}) {
  const vals = rows.flatMap(r => cols.map(c => cell(r.key, c.key)?.value)).filter((v): v is number => v != null)
  const lo = Math.min(...vals)
  const hi = Math.max(...vals)
  const step = (v: number) => Math.min(STEPS, 1 + Math.floor(((v - lo) / (hi - lo || 1)) * STEPS))
  const template = `minmax(96px, 1.3fr) repeat(${cols.length}, minmax(52px, 1fr))`
  return (
    <div>
      <div className="heat" role="table" aria-label={caption}>
        <div className="heat-row" role="row" style={{ gridTemplateColumns: template }}>
          <span />
          {cols.map(c => (
            <span key={c.key} className="heat-head" role="columnheader">
              {c.label}
            </span>
          ))}
        </div>
        {rows.map(r => (
          <div key={r.key} className="heat-row" role="row" style={{ gridTemplateColumns: template }}>
            <span className="heat-label" role="rowheader">{r.label}</span>
            {cols.map(c => {
              const v = cell(r.key, c.key)
              if (!v) return <span key={c.key} className="heat-cell empty" role="cell" />
              const isSel = selected?.row === r.key && selected?.col === c.key
              if (v.suppressed || v.value == null)
                return (
                  <span key={c.key} role="cell" className="heat-cell suppressed" title={`${r.label} · ${c.label}: fewer than 10 people, suppressed`}>
                    &lt;10
                  </span>
                )
              const s = step(v.value)
              return (
                <button
                  key={c.key}
                  role="cell"
                  className={`heat-cell ${isSel ? 'selected' : ''}`}
                  style={{ background: `var(--seq-${s})`, color: s >= 4 ? '#fff' : 'var(--text)' }}
                  onClick={onSelect ? () => onSelect(r.key, c.key) : undefined}
                  title={`${r.label} · ${c.label}: ${fmt(v.value, digits)}${unit}${v.n != null ? ` (${v.n} people)` : ''}`}
                >
                  {fmt(v.value, digits)}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="heat-scale">
        <span>{fmt(lo, digits)}{unit}</span>
        <span className="ramp">{Array.from({ length: STEPS }, (_, i) => <i key={i} style={{ background: `var(--seq-${i + 1})` }} />)}</span>
        <span>{fmt(hi, digits)}{unit}</span>
        <span style={{ marginLeft: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <i className="hatch" /> fewer than 10 people
        </span>
      </div>
    </div>
  )
}

export interface ScatterPoint {
  key: string
  label: string
  x: number
  y: number
  focus?: boolean
}

/** Single-series scatter with direct labels. */
export function Scatter({ points, xLabel, yLabel, xUnit = '', yUnit = '', height = 280, guides, ariaLabel }: {
  points: ScatterPoint[]
  xLabel: string
  yLabel: string
  xUnit?: string
  yUnit?: string
  height?: number
  guides?: { x?: number; y?: number; note?: ReactNode }
  ariaLabel: string
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<string | null>(null)
  const pad = { l: 44, r: 20, t: 14, b: 40 }
  const xs = points.map(p => p.x)
  const ys = points.map(p => p.y)
  const xt = niceTicks(Math.min(...xs, guides?.x ?? Infinity) - 2, Math.max(...xs) + 1)
  const yt = niceTicks(Math.min(0, ...ys), Math.max(...ys) + 2)
  const X = (v: number) => pad.l + ((v - xt[0]) / (xt.at(-1)! - xt[0])) * (width - pad.l - pad.r)
  const Y = (v: number) => pad.t + ((yt.at(-1)! - v) / (yt.at(-1)! - yt[0])) * (height - pad.t - pad.b)
  const hp = points.find(p => p.key === hover)
  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
        {yt.map(t => (
          <g key={`y${t}`}>
            <line className="gridline" x1={pad.l} x2={width - pad.r} y1={Y(t)} y2={Y(t)} />
            <text className="axis-label" x={pad.l - 8} y={Y(t) + 4} textAnchor="end">{t}</text>
          </g>
        ))}
        {xt.map(t => (
          <text key={`x${t}`} className="axis-label" x={X(t)} y={height - pad.b + 16} textAnchor="middle">{t}{xUnit}</text>
        ))}
        <text className="axis-label" x={(pad.l + width - pad.r) / 2} y={height - 4} textAnchor="middle">{xLabel}</text>
        <text className="axis-label" x={12} y={pad.t + (height - pad.t - pad.b) / 2} transform={`rotate(-90 12 ${pad.t + (height - pad.t - pad.b) / 2})`} textAnchor="middle">{yLabel}</text>
        {guides?.y != null && <line x1={pad.l} x2={width - pad.r} y1={Y(guides.y)} y2={Y(guides.y)} stroke="var(--text-3)" strokeWidth="1" />}
        {guides?.x != null && <line x1={X(guides.x)} x2={X(guides.x)} y1={pad.t} y2={height - pad.b} stroke="var(--text-3)" strokeWidth="1" />}
        {points.map(p => {
          const right = X(p.x) > width - 150
          return (
            <g key={p.key} onPointerEnter={() => setHover(p.key)} onPointerLeave={() => setHover(null)}>
              <circle cx={X(p.x)} cy={Y(p.y)} r={14} fill="transparent" />
              <circle cx={X(p.x)} cy={Y(p.y)} r={p.focus ? 6 : 5} fill={p.focus ? 'var(--series-2)' : 'var(--series-1)'} stroke="var(--surface)" strokeWidth={2} />
              <text x={X(p.x) + (right ? -10 : 10)} y={Y(p.y) + 4} textAnchor={right ? 'end' : 'start'} className="axis-label" style={{ fill: 'var(--text-2)', fontWeight: p.focus ? 600 : 400 }}>
                {p.label}
              </text>
            </g>
          )
        })}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${(X(hp.x) / width) * 100}%`, top: Y(hp.y) }}>
          <div className="tt-title">{hp.label}</div>
          <div className="tt-row"><span>{xLabel}</span><strong className="num">{fmt(hp.x)}{xUnit}</strong></div>
          <div className="tt-row"><span>{yLabel}</span><strong className="num">{fmt(hp.y)}{yUnit}</strong></div>
        </div>
      )}
      {guides?.note && <p className="note" style={{ marginTop: 6 }}>{guides.note}</p>}
    </div>
  )
}
