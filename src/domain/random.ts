/** Small seeded PRNG (mulberry32) so the synthetic dataset is identical on every run. */
export class Random {
  private state: number
  constructor(seed: number) {
    this.state = seed >>> 0
  }
  next(): number {
    let t = (this.state += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  chance(p: number): boolean {
    return this.next() < p
  }
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1))
  }
  normal(mean: number, sd: number): number {
    const u = 1 - this.next()
    const v = this.next()
    return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
  }
  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)]
  }
  weighted<T>(items: readonly (readonly [T, number])[]): T {
    const total = items.reduce((s, [, w]) => s + w, 0)
    let r = this.next() * total
    for (const [item, w] of items) {
      r -= w
      if (r < 0) return item
    }
    return items[items.length - 1][0]
  }
}

/** Dates are handled as UTC day numbers internally; strings only at the edges. */
const DAY = 86_400_000
export const toDay = (iso: string): number => Math.floor(Date.parse(iso + 'T00:00:00Z') / DAY)
export const toIso = (day: number): string => new Date(day * DAY).toISOString().slice(0, 10)
/** 1 = Monday ... 7 = Sunday */
export const isoWeekday = (day: number): number => ((new Date(day * DAY).getUTCDay() + 6) % 7) + 1
export const monthStart = (day: number): number => {
  const d = new Date(day * DAY)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY)
}
export const addMonths = (day: number, months: number): number => {
  const d = new Date(day * DAY)
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()) / DAY)
}
