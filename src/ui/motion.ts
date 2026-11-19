import { createElement, useEffect, useRef, useState } from 'react'

/**
 * Small motion helpers. Everything here respects prefers-reduced-motion and
 * runs on requestAnimationFrame, which is cheap now that the database lives
 * in a worker.
 */

export const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

// Count-ups behind the intro overlay would finish before anyone sees them, so
// they wait for the intro to leave.
let markDone!: () => void
const introDone = new Promise<void>(r => { markDone = r })
export const markIntroDone = () => markDone()
export const whenIntroDone = () => introDone

const ease = (t: number) => 1 - Math.pow(1 - t, 3)

/**
 * Renders a formatted figure ("2,578", "6.6%", "+0.8 pts") and counts it up
 * from zero the first time it scrolls into view. Keeps the original format:
 * thousands separators, decimals, prefix and suffix.
 */
export function CountUp({ text, ms = 1100, className }: { text: string; ms?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const m = text.match(/^(.*?)(-?\d[\d,]*(?:\.(\d+))?)(.*)$/)
  const last = useRef<number | null>(null)
  const [shown, setShown] = useState(() => (m && !reducedMotion() ? `${m[1]}${zero(m[2], m[3])}${m[4]}` : text))

  useEffect(() => {
    if (!m || reducedMotion()) { setShown(text); return }
    const el = ref.current
    if (!el) return
    const target = parseFloat(m[2].replace(/,/g, ''))
    const decimals = m[3]?.length ?? 0
    const grouped = m[2].includes(',')
    let raf = 0
    let cancelled = false
    const run = () => {
      const start = last.current ?? 0
      last.current = target
      const t0 = performance.now()
      const tick = (now: number) => {
        if (cancelled) return
        const p = Math.min(1, (now - t0) / ms)
        const v = start + (target - start) * ease(p)
        const s = v.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped })
        setShown(`${m[1]}${s}${m[4]}`)
        if (p < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }
    const io = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) { io.disconnect(); introDone.then(run) }
    }, { threshold: 0.4 })
    io.observe(el)
    return () => { cancelled = true; io.disconnect(); cancelAnimationFrame(raf) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text])

  return createElement('span', { ref, className },
    createElement('span', { className: 'sr-only' }, text),
    createElement('span', { 'aria-hidden': true }, shown))
}

function zero(_num: string, dec?: string) {
  return dec ? `0.${'0'.repeat(dec.length)}` : '0'
}

/**
 * Tween a set of number arrays toward new values whenever they change, so a
 * chart glides from one selection to the next instead of jumping. Arrays of
 * different lengths (a different time range) snap.
 */
export function useTweened(target: (number | null)[][], ms = 520): (number | null)[][] {
  const [value, setValue] = useState(target)
  const from = useRef(target)
  const key = JSON.stringify(target)
  useEffect(() => {
    const start = from.current
    const sameShape = start.length === target.length && start.every((a, i) => a.length === target[i].length)
    if (!sameShape || reducedMotion()) { from.current = target; setValue(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = ease(Math.min(1, (now - t0) / ms))
      const next = target.map((arr, i) => arr.map((v, j) => {
        const a = start[i][j]
        return v == null || a == null ? v : a + (v - a) * p
      }))
      from.current = next
      setValue(next)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return value
}
