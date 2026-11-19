import type { Extracts, LmsRow, TimeRow } from './generate'

export interface BrokenBatch {
  extracts: Extracts
  added: { futureDated: number; unknownBadges: number; badScores: number }
}

/**
 * A copy of the extracts with one bad delivery appended: time-clock rows dated
 * after the snapshot, rows for badges HR has never heard of, and assessment
 * scores outside 0-100. Used by the "send a broken extract" demo: the quality
 * gate should hold back exactly these rows and leave every KPI unchanged.
 */
export function withBrokenBatch(base: Extracts, size = 12): BrokenBatch {
  const timeclock = base.timeclock.slice()
  const lms = base.lms.slice()
  let tcRow = timeclock.reduce((m, r) => Math.max(m, r[0]), 0)
  let lmsRow = lms.reduce((m, r) => Math.max(m, r[0]), 0)
  const day = (offset: number) => {
    const d = new Date(base.asOf + 'T00:00:00Z')
    d.setUTCDate(d.getUTCDate() + offset)
    return d.toISOString().slice(0, 10)
  }
  const sample = (i: number) => base.timeclock[(i * 7919) % base.timeclock.length]

  for (let i = 0; i < size; i++) {
    const s = sample(i)
    timeclock.push([++tcRow, s[1], day(3 + (i % 5)), s[3], s[4], s[5], s[6]] as TimeRow)
  }
  for (let i = 0; i < size; i++) {
    const s = sample(i + size)
    timeclock.push([++tcRow, `X${String(90000 + i)}`, s[2], s[3], s[4], s[5], s[6]] as TimeRow)
  }
  const half = Math.ceil(size / 2)
  for (let i = 0; i < half; i++) {
    const s = base.lms[(i * 104729) % base.lms.length]
    lms.push([++lmsRow, s[1], s[2], s[3], s[4], s[5], s[6], 140] as LmsRow)
  }
  return {
    extracts: { ...base, timeclock, lms },
    added: { futureDated: size, unknownBadges: size, badScores: half },
  }
}
