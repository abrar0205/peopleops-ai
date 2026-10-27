import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import type { KpiTile } from '../../api/queries'
import type { Signal } from '../../api/insights'
import { Card, ErrorNote, Icon, Skeleton, downloadText, fmt, fmtDate, fmtInt, href } from '../common'
import { LineChart } from '../charts'

function formatTile(tile: KpiTile) {
  if (tile.value == null) return '—'
  if (tile.unit === 'people') return fmtInt(tile.value)
  if (tile.unit === '%') return `${fmt(tile.value, 1)}%`
  if (tile.unit === 'h') return `${fmt(tile.value, 1)}h`
  return fmt(tile.value, 1)
}

function PrimaryKpi({ tile }: { tile: KpiTile }) {
  const delta = tile.value != null && tile.previous != null ? tile.value - tile.previous : null
  const improving = delta == null || tile.goodDirection === 'none' ? null : (delta > 0) === (tile.goodDirection === 'up')
  return (
    <article className="simple-kpi">
      <span className="simple-kpi-label">{tile.label}</span>
      <strong>{formatTile(tile)}</strong>
      <div className="simple-kpi-foot">
        {delta != null && (
          <span className={improving ? 'trend-good' : 'trend-watch'}>
            {delta > 0 ? '↑' : delta < 0 ? '↓' : ''} {tile.unit === 'people' ? fmtInt(Math.abs(delta)) : fmt(Math.abs(delta), 1)}{tile.unit === '%' ? ' pts' : tile.unit === 'h' ? 'h' : ''}
          </span>
        )}
        <span>{tile.comparison}</span>
      </div>
    </article>
  )
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

function PrioritySignal({ signal, index }: { signal: Signal; index: number }) {
  return (
    <a className="priority-signal" href={signalLink(signal)}>
      <span className="priority-number">0{index + 1}</span>
      <div className="priority-copy">
        <div className="priority-title-row">
          <strong>{signal.title}</strong>
          <span className={`priority-badge ${signal.severity}`}>{signal.severity === 'high' ? 'Act' : signal.severity === 'medium' ? 'Watch' : 'Note'}</span>
        </div>
        <p>{signal.detail}</p>
        {signal.stats.length > 0 && <span className="priority-stat">{signal.stats.slice(0, 2).map(x => `${x.label}: ${x.value}`).join(' · ')}</span>}
      </div>
      <Icon name="arrow" />
    </a>
  )
}

function briefMarkdown(asOf: string, tiles: KpiTile[], signals: Signal[]) {
  return [
    `# Weekly people brief — week ending ${asOf}`,
    '',
    '_Synthetic demo data. Aggregates only; groups under 10 people are suppressed._',
    '',
    '## Headline KPIs',
    ...tiles.map(x => `- **${x.label}:** ${formatTile(x)} — ${x.comparison}`),
    '',
    '## What needs attention',
    ...signals.filter(s => s.severity !== 'info').slice(0, 3).map((s, i) => `${i + 1}. **${s.title}.** ${s.detail}`),
  ].join('\n')
}

export function Overview() {
  const trpc = useTRPC()
  const status = useQuery(trpc.meta.status.queryOptions())
  const kpis = useQuery(trpc.kpi.summary.queryOptions())
  const signals = useQuery(trpc.insights.signals.queryOptions())
  const weekly = useQuery(trpc.attendance.weekly.queryOptions({ department: 'ALL', shift: 'ALL' }))

  const primaryIds = ['headcount', 'unplanned_absence', 'attrition', 'training_on_time']
  const primary = primaryIds.map(id => kpis.data?.find(x => x.id === id)).filter(Boolean) as KpiTile[]
  const dataHealth = kpis.data?.find(x => x.id === 'data_health')
  const overtime = kpis.data?.find(x => x.id === 'overtime')
  const actionable = signals.data?.filter(s => s.severity !== 'info').slice(0, 3) ?? []

  return (
    <>
      <section className="overview-hero">
        <div>
          <span className="overview-kicker">PEOPLE ANALYTICS · INTERACTIVE DEMO</span>
          <h1>Understand the workforce.<br/><span>Act on what matters.</span></h1>
          <p>A focused manufacturing people-analytics demo for spotting workforce changes, validating the underlying data and turning metrics into clear actions.</p>
        </div>
        <div className="hero-actions-clean">
          <a className="btn primary" href={href('ask')}><Icon name="ask" /> Ask the data</a>
          {kpis.data && signals.data && status.data && (
            <button className="btn" onClick={() => downloadText(`people-brief-${status.data.asOf}.md`, briefMarkdown(status.data.asOf, kpis.data, signals.data), 'text/markdown')}>
              <Icon name="download" /> Weekly brief
            </button>
          )}
        </div>
      </section>

      <section className="simple-kpi-grid" aria-label="Headline workforce metrics">
        {primary.length === 4 ? primary.map(tile => <PrimaryKpi key={tile.id} tile={tile} />) : Array.from({ length: 4 }, (_, i) => <Skeleton key={i} height={126} />)}
      </section>
      {kpis.error && <ErrorNote error={kpis.error} />}

      <section className="overview-clean-grid">
        <Card title="What needs attention" subtitle="The three most important changes in the current data snapshot.">
          <div className="priority-list">
            {signals.isLoading && <Skeleton height={260} />}
            {signals.error && <ErrorNote error={signals.error} />}
            {actionable.map((signal, index) => <PrioritySignal key={signal.id} signal={signal} index={index} />)}
            {signals.data && actionable.length === 0 && <p className="empty">No notable changes in the current snapshot.</p>}
          </div>
        </Card>

        <Card title="Unplanned absence" subtitle="Plant-wide weekly trend">
          {weekly.data ? (
            <LineChart
              ariaLabel="Weekly unplanned absence rate for the plant"
              labels={weekly.data.rows.map(r => r.week_start)}
              series={[{ name: 'Plant', color: 'series-1', values: weekly.data.rows.map(r => r.unplanned_absence_rate) }]}
              unit="%"
              formatX={fmtDate}
              height={220}
            />
          ) : <Skeleton height={220} />}
          <div className="chart-foot-clean">
            <a href={href('attendance')} className="clean-link">Explore attendance <Icon name="arrow" /></a>
          </div>
        </Card>
      </section>

      <section className="trust-strip">
        <div className="trust-block">
          <span>DATA TRUST</span>
          <strong>{dataHealth ? formatTile(dataHealth) : '—'}</strong>
          <p>{dataHealth?.comparison ?? 'Checking source quality…'}</p>
          <a href={href('quality')}>Review data quality →</a>
        </div>
        <div className="trust-divider" />
        <div className="trust-block">
          <span>WORKLOAD</span>
          <strong>{overtime ? formatTile(overtime) : '—'}</strong>
          <p>{overtime?.comparison ?? 'Loading workload metric…'}</p>
          <a href={href('attendance')}>Explore workload →</a>
        </div>
        <div className="trust-divider" />
        <div className="trust-block trust-wide">
          <span>METRIC-GROUNDED INSIGHTS</span>
          <strong>Ask a business question, not a database.</strong>
          <p>The assistant answers from approved aggregate metrics and keeps the underlying evidence traceable.</p>
          <a href={href('ask')}>Open insights →</a>
        </div>
      </section>
    </>
  )
}
