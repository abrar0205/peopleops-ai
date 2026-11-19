import { useEffect, useMemo, useRef, useState } from 'react'
import { fmt, fmtInt } from '../common'
import { reducedMotion, whenIntroDone } from '../motion'

/**
 * The plant floor: one dot per person on the roster, placed in their
 * department's zone. Switching shift moves people in and out; the share of
 * unplanned absence shows as red rings; the flagged team pulses. People are a
 * unit chart of aggregate counts, never individual records.
 */

export type ShiftKey = 'EARLY' | 'LATE' | 'NIGHT' | 'ALL'
export interface FloorTeam { dept: string; shift: string; employees: number; rate: number | null; suppressed: boolean }
export interface FloorDept { code: string; name: string }

// Zones in floor units (100 x 58), laid out like a vehicle plant: battery cells
// and body shop feed paint, paint feeds general assembly, logistics docks on the left.
const ZONES: Record<string, { x: number; y: number; w: number; h: number }> = {
  CEL: { x: 0, y: 0, w: 20, h: 15 },
  BIW: { x: 22, y: 0, w: 27, h: 18 },
  PNT: { x: 51, y: 0, w: 21, h: 18 },
  QLT: { x: 74, y: 0, w: 26, h: 13 },
  LOG: { x: 0, y: 17, w: 20, h: 25 },
  GA: { x: 22, y: 20, w: 50, h: 22 },
  MNT: { x: 74, y: 15, w: 26, h: 27 },
}
const FLOWS = ['M49 9 L51 9', 'M10 15 L10 17', 'M20 31 L22 31', 'M61.5 18 L61.5 20', 'M35.5 18 L35.5 20', 'M72 31 L74 31']
const U_W = 100, U_H = 42

interface P { x: number; y: number; tx: number; ty: number; a: number; ta: number; delay: number; absent: boolean; dept: string; shift: string }

function hash(n: number) { let x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x) }

export function Floor({ teams, depts, shift, onShift, flagged, selectedDept, onSelect }: {
  teams: FloorTeam[]
  depts: FloorDept[]
  shift: ShiftKey
  onShift: (s: ShiftKey) => void
  flagged: Set<string>
  selectedDept: string | null
  onSelect: (dept: string, shift: ShiftKey) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const people = useRef<P[]>([])
  const raf = useRef(0)
  const started = useRef(false)
  const [size, setSize] = useState({ w: 1100, h: 640 })
  const [hover, setHover] = useState<string | null>(null)

  // One particle per person on the roster, stable across shift changes.
  const roster = useMemo(() => {
    const out: { dept: string; shift: string; absent: boolean }[] = []
    for (const t of teams) {
      if (t.shift === 'ALL' || t.dept === 'ALL' || t.shift === 'UNASSIGNED' || t.suppressed) continue
      const absent = t.rate == null || t.suppressed ? 0 : Math.round((t.employees * t.rate) / 100)
      for (let i = 0; i < t.employees; i++) out.push({ dept: t.dept, shift: t.shift, absent: false })
      // Spread the absent marks through the team so they don't cluster in one corner.
      const team = out.filter(p => p.dept === t.dept && p.shift === t.shift)
      for (let k = 0; k < absent; k++) team[Math.floor(((k + 0.5) * team.length) / absent)].absent = true
    }
    return out
  }, [teams])

  // Target layout for the current shift: uniform spacing so zone fill reflects headcount.
  const layout = useMemo(() => {
    const show = (p: { shift: string }) => shift === 'ALL' || p.shift === shift
    const counts = new Map<string, number>()
    for (const p of roster) if (show(p)) counts.set(p.dept, (counts.get(p.dept) ?? 0) + 1)
    const label = 38 / (size.w / U_W) // room for the zone name, in floor units
    let spacing = Infinity
    for (const [d, n] of counts) {
      const z = ZONES[d]
      if (!z || n === 0) continue
      spacing = Math.min(spacing, Math.sqrt(((z.w - 1.6) * (z.h - label - 0.8)) / n))
    }
    spacing = Math.min(spacing * 0.95, 1.9)
    const idx = new Map<string, number>()
    const targets = roster.map(p => {
      const z = ZONES[p.dept]
      if (!z || !show(p)) return null
      const i = idx.get(p.dept) ?? 0
      idx.set(p.dept, i + 1)
      const cols = Math.max(1, Math.floor((z.w - 1.6) / spacing))
      return { x: z.x + 0.8 + (i % cols) * spacing + spacing / 2, y: z.y + label + Math.floor(i / cols) * spacing + spacing / 2 }
    })
    return { targets, spacing, counts }
  }, [roster, shift, size.w])

  // Resize to the container.
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width)
      setSize({ w, h: Math.round((w * U_H) / U_W) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Retarget particles when the layout changes; start the animation loop.
  useEffect(() => {
    const cur = people.current
    const fresh = cur.length !== roster.length
    people.current = roster.map((r, i) => {
      const t = layout.targets[i]
      const prev = fresh ? null : cur[i]
      const dock = { x: -6 - hash(i) * 10, y: 17 + hash(i + 7) * 25 }
      return {
        x: prev?.x ?? dock.x, y: prev?.y ?? dock.y,
        tx: t?.x ?? dock.x, ty: t?.y ?? dock.y,
        a: prev?.a ?? 0, ta: t ? 1 : 0,
        delay: fresh ? hash(i * 3.1) * 900 + (ZONES[r.dept]?.x ?? 0) * 9 : hash(i * 5.7) * 260,
        absent: r.absent, dept: r.dept, shift: r.shift,
      }
    })
    const go = () => { started.current = true; animate(performance.now()) }
    if (reducedMotion()) {
      for (const p of people.current) { p.x = p.tx; p.y = p.ty; p.a = p.ta }
      draw()
    } else if (fresh && !started.current) {
      // Stream in once the intro is gone and the floor is on screen.
      const el = wrap.current
      const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); whenIntroDone().then(go) } }, { threshold: 0.2 })
      if (el) io.observe(el)
      return () => io.disconnect()
    } else go()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, roster])

  useEffect(() => { draw() }, [size]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  function animate(t0: number) {
    cancelAnimationFrame(raf.current)
    const step = (now: number) => {
      let moving = false
      for (const p of people.current) {
        if (now - t0 < p.delay) { moving = true; continue }
        const k = 0.085
        p.x += (p.tx - p.x) * k
        p.y += (p.ty - p.y) * k
        p.a += (p.ta - p.a) * 0.12
        if (Math.abs(p.tx - p.x) > 0.02 || Math.abs(p.ty - p.y) > 0.02 || Math.abs(p.ta - p.a) > 0.01) moving = true
        else { p.x = p.tx; p.y = p.ty; p.a = p.ta }
      }
      draw()
      if (moving) raf.current = requestAnimationFrame(step)
    }
    raf.current = requestAnimationFrame(step)
  }

  function draw() {
    const c = canvas.current
    if (!c) return
    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    if (c.width !== size.w * dpr) { c.width = size.w * dpr; c.height = size.h * dpr }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, size.w, size.h)
    const sx = size.w / U_W, sy = size.h / U_H
    const r = Math.max(0.9, Math.min(3.1, layout.spacing * sx * 0.36))
    // Batch by colour and a few opacity levels: a handful of fill calls per frame instead of thousands.
    const LEVELS = 4
    const fills: Path2D[] = Array.from({ length: LEVELS }, () => new Path2D())
    const dims: Path2D[] = Array.from({ length: LEVELS }, () => new Path2D())
    const rings: Path2D[] = Array.from({ length: LEVELS }, () => new Path2D())
    const tiny = r < 1.6
    for (const p of people.current) {
      if (p.a < 0.04) continue
      const lv = Math.min(LEVELS - 1, Math.floor(p.a * LEVELS))
      const x = p.x * sx, y = p.y * sy
      const target = p.absent ? rings[lv] : hover && p.dept !== hover ? dims[lv] : fills[lv]
      if (tiny) target.rect(x - r, y - r, r * 2, r * 2)
      else { target.moveTo(x + r, y); target.arc(x, y, r, 0, Math.PI * 2) }
    }
    for (let lv = 0; lv < LEVELS; lv++) {
      ctx.globalAlpha = (lv + 1) / LEVELS
      ctx.fillStyle = '#e8ece9'; ctx.fill(fills[lv])
      ctx.fillStyle = 'rgba(232,236,233,0.35)'; ctx.fill(dims[lv])
      ctx.strokeStyle = '#ff5b4f'; ctx.lineWidth = Math.max(1, r * 0.55)
      if (tiny) { ctx.fillStyle = '#ff5b4f'; ctx.fill(rings[lv]) } else ctx.stroke(rings[lv])
    }
    ctx.globalAlpha = 1
  }
  useEffect(() => { draw() }, [hover]) // eslint-disable-line react-hooks/exhaustive-deps

  const teamOf = (d: string) => (shift === 'ALL' ? null : teams.find(t => t.dept === d && t.shift === shift))
  const zoneStats = (d: string) => {
    const on = layout.counts.get(d) ?? 0
    const tm = teamOf(d)
    if (tm?.suppressed) return { on: null as number | null, rate: null }
    const allRows = teams.filter(t => t.dept === d && t.shift !== 'ALL' && t.shift !== 'UNASSIGNED' && !t.suppressed && t.rate != null)
    const rate = tm ? (tm.suppressed ? null : tm.rate) : allRows.length ? allRows.reduce((s, t) => s + t.rate! * t.employees, 0) / allRows.reduce((s, t) => s + t.employees, 0) : null
    return { on, rate }
  }
  const onMove = (e: React.PointerEvent) => {
    const b = wrap.current!.getBoundingClientRect()
    const ux = ((e.clientX - b.left) / b.width) * U_W, uy = ((e.clientY - b.top) / b.height) * U_H
    const hit = Object.entries(ZONES).find(([, z]) => ux >= z.x && ux <= z.x + z.w && uy >= z.y && uy <= z.y + z.h)
    setHover(hit ? hit[0] : null)
  }
  const nameOf = (code: string) => depts.find(d => d.code === code)?.name ?? code
  const total = [...layout.counts.values()].reduce((a, b) => a + b, 0)
  const absentNow = people.current.length ? roster.filter((p, i) => p.absent && layout.targets[i]).length : 0

  return (
    <div className="floor">
      <div className="floor-bar">
        <div className="floor-shifts" role="radiogroup" aria-label="Shift">
          {(['EARLY', 'LATE', 'NIGHT', 'ALL'] as ShiftKey[]).map(s => (
            <button key={s} role="radio" aria-checked={shift === s} className={shift === s ? 'on' : ''} onClick={() => onShift(s)}>
              {s === 'ALL' ? 'All shifts' : s[0] + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
        <p className="floor-count"><b>{fmtInt(total)}</b> people on {shift === 'ALL' ? 'the roster' : `the ${shift.toLowerCase()} shift`} · <b className="red">{fmtInt(absentNow)}</b> lost to unplanned absence on a typical day</p>
      </div>
      <div
        className="floor-stage"
        ref={wrap}
        style={{ height: size.h }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onClick={() => { if (hover) onSelect(hover, shift) }}
        role="img"
        aria-label={`Plant floor: ${fmtInt(total)} people by department${shift === 'ALL' ? '' : ` on the ${shift.toLowerCase()} shift`}. Select a department to open its team.`}
      >
        <svg className="floor-lines" viewBox={`0 0 ${U_W} ${U_H}`} preserveAspectRatio="none" aria-hidden="true">
          {FLOWS.map((d, i) => <path key={i} d={d} />)}
        </svg>
        {Object.entries(ZONES).map(([code, z]) => {
          const st = zoneStats(code)
          const isFlag = shift !== 'ALL' && flagged.has(`${code}|${shift}`)
          return (
            <button
              key={code}
              className={`zone${isFlag ? ' flag' : ''}${hover === code ? ' hover' : ''}${selectedDept === code ? ' sel' : ''}`}
              style={{ left: `${z.x}%`, top: `${(z.y / U_H) * 100}%`, width: `${z.w}%`, height: `${(z.h / U_H) * 100}%` }}
              onFocus={() => setHover(code)}
              onBlur={() => setHover(null)}
              onClick={e => { e.stopPropagation(); onSelect(code, shift) }}
            >
              <span className="zone-name">{nameOf(code)}</span>
              <span className="zone-meta">{st.on == null ? 'Under 10 people, hidden' : <>{st.on}{st.rate != null ? <> · <em>{fmt(st.rate)}%</em></> : null}</>}</span>
              <span className="sr-only">{st.on == null ? '' : ` people${st.rate != null ? ', unplanned absence' : ''}. Open the team.`}</span>
            </button>
          )
        })}
        <span className="floor-scan" aria-hidden="true" />
        <canvas ref={canvas} style={{ width: size.w, height: size.h }} aria-hidden="true" />
      </div>
      <div className="floor-legend">
        <span><i className="lg-dot" /> One person on the roster</span>
        <span><i className="lg-ring" /> Share lost to unplanned absence</span>
        <span><i className="lg-flag" /> Team flagged this week</span>
        <span className="floor-hint">Select a department to open the team</span>
      </div>
    </div>
  )
}
