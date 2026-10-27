import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import type { KpiTile } from '../../api/queries'
import type { Signal } from '../../api/insights'
import { Card, ErrorNote, EvidenceButton, Icon, PageHead, Skeleton, downloadText, fmt, fmtDate, fmtInt, href } from '../common'
import { LineChart, Sparkline } from '../charts'

const SEVERITY_LABEL = { high: 'Act', medium: 'Watch', info: 'Note' } as const

function KpiCard({ tile }: { tile: KpiTile }) {
  const delta = tile.value != null && tile.previous != null ? tile.value - tile.previous : null
  const tone = delta == null || tile.goodDirection === 'none' || Math.abs(delta) < 1e-9 ? 'none' : (delta > 0) === (tile.goodDirection === 'up') ? 'good' : 'bad'
  const digits = tile.unit === 'people' ? 0 : tile.unit === 'h' ? 2 : 1
  return (
    <article className="card kpi">
      <div className="kpi-label">
        <span>{tile.label}</span>
        <EvidenceButton title={tile.label} description={tile.comparison} evidence={[tile.evidence]} label="" />
      </div>
      <div className="kpi-value">
        {tile.unit === 'people' ? fmtInt(tile.value) : fmt(tile.value, digits)}
        {tile.unit === '%' && <small>%</small>}
        {tile.unit === 'h' && <small>h</small>}
      </div>
      <div className="kpi-meta">
        {delta != null && (
          <span className={`delta ${tone}`}>
            {delta > 0 ? '▲' : delta < 0 ? '▼' : ''} {tile.unit === 'people' ? fmtInt(Math.abs(delta)) : fmt(Math.abs(delta), digits)}
            {tile.unit === '%' ? ' pts' : tile.unit === 'h' ? ' h' : ''}
          </span>
        )}
        <span>{tile.comparison}</span>
      </div>
      {tile.spark.length > 1 && <Sparkline values={tile.spark} />}
    </article>
  )
}

export function signalLink(s: Pick<Signal, 'area' | 'department' | 'shift'>) {
  const params = { dept: s.department, shift: s.shift && s.shift !== 'ALL' ? s.shift : undefined }
  switch (s.area) {
    case 'attendance': return { href: href('attendance', params), label: 'Open in Attendance' }
    case 'attrition': return { href: href('attrition', params), label: 'Open in Attrition' }
    case 'training': return { href: href('training'), label: 'Open in Training' }
    default: return { href: href('quality'), label: 'Open in Data quality' }
  }
}

export function SignalItem({ s }: { s: Signal }) {
  const link = signalLink(s)
  return (
    <div className="signal">
      <div className={`signal-bar ${s.severity}`} />
      <div>
        <h3>
          <span className={`badge ${s.severity}`}>{SEVERITY_LABEL[s.severity]}</span>
          {s.title}
        </h3>
        <p>{s.detail}</p>
        <div className="chips">
          {s.stats.map(x => (
            <span className="chip" key={x.label}>
              <span>{x.label}</span>
              <strong>{x.value}</strong>
            </span>
          ))}
        </div>
        <div className="signal-actions">
          <a className="link-btn" href={link.href}>{link.label} →</a>
          <a className="link-btn" href={href('ask', { q: s.question })}>Ask a follow-up</a>
          <EvidenceButton title={s.title} description={s.method} evidence={s.evidence} label="Evidence" />
        </div>
        <p className="method" style={{ marginTop: 8 }}>Method: {s.method}</p>
      </div>
    </div>
  )
}

function briefMarkdown(asOf: string, tiles: KpiTile[], signals: Signal[]) {
  const t = (id: string) => tiles.find(x => x.id === id)
  const lines = [
    `# Weekly people brief — week ending ${asOf}`,
    '',
    '_Synthetic demo data. Aggregates only; groups under 10 people are suppressed._',
    '',
    '## Headline KPIs',
    ...tiles.map(x => `- **${x.label}:** ${x.unit === 'people' ? fmtInt(x.value) : fmt(x.value, x.unit === 'h' ? 2 : 1)}${x.unit === '%' ? '%' : x.unit === 'h' ? ' h' : ''} (${x.comparison}${x.previous != null ? `; previous ${fmt(x.previous, x.unit === 'people' ? 0 : x.unit === 'h' ? 2 : 1)}` : ''})`),
    '',
    '## What needs attention',
    ...signals.filter(s => s.severity !== 'info').flatMap((s, i) => [`${i + 1}. **${s.title}.** ${s.detail}`, `   - ${s.stats.map(x => `${x.label}: ${x.value}`).join(' · ')}`, `   - Method: ${s.method}`]),
    '',
    '## Notes',
    ...signals.filter(s => s.severity === 'info').map(s => `- ${s.title}. ${s.detail}`),
    '',
    `Unplanned absence for the plant: ${fmt(t('unplanned_absence')?.value)}% over the last 4 weeks.`,
  ]
  return lines.join('\n')
}

export function Overview() {
  const trpc = useTRPC()
  const status = useQuery(trpc.meta.status.queryOptions())
  const kpis = useQuery(trpc.kpi.summary.queryOptions())
  const signals = useQuery(trpc.insights.signals.queryOptions())
  const weekly = useQuery(trpc.attendance.weekly.queryOptions({ department: 'ALL', shift: 'ALL' }))
  const quality = useQuery(trpc.quality.overview.queryOptions())

  const actionable = signals.data?.filter(s => s.severity !== 'info') ?? []
  const notes = signals.data?.filter(s => s.severity === 'info') ?? []
  const excludedWeek = (() => {
    const day = quality.data?.excluded.rows[0]?.work_date
    if (!day || !weekly.data) return undefined
    const idx = weekly.data.rows.findIndex(r => r.week_start <= day && day < new Date(Date.parse(r.week_start) + 7 * 864e5).toISOString().slice(0, 10))
    return idx >= 0 ? { index: idx, label: `${fmtDate(day)} excluded` } : undefined
  })()

  return (
    <>
      <PageHead
        eyebrow={status.data ? `Overview · week ending ${fmtDate(status.data.asOf, { day: 'numeric', month: 'long', year: 'numeric' })}` : 'Overview'}
        title="Plant people pulse"
        actions={
          kpis.data && signals.data && status.data ? (
            <button className="btn" onClick={() => downloadText(`people-brief-${status.data.asOf}.md`, briefMarkdown(status.data.asOf, kpis.data, signals.data), 'text/markdown')}>
              <Icon name="download" /> Export weekly brief
            </button>
          ) : null
        }
      >
        {signals.data
          ? actionable.length
            ? `${actionable.length} changes stand out this week. Each one was detected statistically from the analytics views and links to the query behind it.`
            : 'No statistically notable changes this week.'
          : 'Loading signals…'}
      </PageHead>

      <section className="kpis" aria-label="Headline KPIs">
        {kpis.data ? kpis.data.map(t => <KpiCard key={t.id} tile={t} />) : Array.from({ length: 6 }, (_, i) => <Skeleton key={i} height={132} />)}
      </section>
      {kpis.error && <ErrorNote error={kpis.error} />}

      <div className="grid-main">
        <Card title="What needs attention" subtitle="Detected changes, ranked by severity. Every number links to its evidence.">
          <div style={{ margin: '-14px -18px -18px' }}>
            {signals.isLoading && <div style={{ padding: 18 }}><Skeleton height={240} /></div>}
            {signals.error && <div style={{ padding: 18 }}><ErrorNote error={signals.error} /></div>}
            {actionable.map(s => <SignalItem key={s.id} s={s} />)}
          </div>
        </Card>
        <div className="stack">
          <Card
            title="Unplanned absence, plant"
            subtitle="Weekly, last 26 weeks"
            actions={weekly.data ? <EvidenceButton title="Unplanned absence, plant" evidence={[weekly.data]} /> : null}
            foot={excludedWeek ? <span>The shaded week contains a day excluded for missing punch data. <a className="link-btn" href={href('quality')}>Review</a></span> : undefined}
          >
            {weekly.data ? (
              <LineChart
                ariaLabel="Weekly unplanned absence rate for the plant"
                labels={weekly.data.rows.map(r => r.week_start)}
                series={[{ name: 'Plant', color: 'series-1', values: weekly.data.rows.map(r => r.unplanned_absence_rate) }]}
                unit="%"
                formatX={fmtDate}
                band={excludedWeek}
                height={200}
              />
            ) : (
              <Skeleton height={200} />
            )}
          </Card>
          <Card title="Also noted" subtitle="Context, not alarms">
            <div style={{ margin: '-14px -18px -18px' }}>
              {notes.map(s => <SignalItem key={s.id} s={s} />)}
              {signals.data && notes.length === 0 && <p className="empty">Nothing else.</p>}
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
