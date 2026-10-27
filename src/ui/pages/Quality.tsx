import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { Card, EvidenceButton, Icon, PageHead, Skeleton, fmt, fmtDate, fmtInt } from '../common'

const SOURCE_LABEL: Record<string, string> = {
  hris: 'HR master data',
  timeclock: 'Time & attendance',
  lms: 'Learning',
}

export function Quality({ params: _params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const overview = useQuery(trpc.quality.overview.queryOptions())
  const punchIssue = useQuery(trpc.quality.issues.queryOptions({ ruleCode: 'TC_MISSING_PUNCHES', take: 1 }))
  const punch = punchIssue.data?.items[0]
  const failing = overview.data?.rules.filter(r => r.issues > 0).sort((a,b) => b.affectedRows - a.affectedRows) ?? []
  const totalReceived = overview.data?.health.rows.reduce((s,h)=>s+h.received,0) ?? 0
  const totalHeld = overview.data?.health.rows.reduce((s,h)=>s+h.held_back,0) ?? 0
  const usablePct = totalReceived ? ((totalReceived-totalHeld)/totalReceived)*100 : 0

  return (
    <>
      <PageHead eyebrow="Data quality" title="Know what you can trust">
        A concise view of the checks that protect the workforce KPIs. Invalid source records are held back before they can influence a dashboard metric.
      </PageHead>

      <section className="quality-summary-clean">
        <article className="quality-score-clean">
          <span>DATA REACHING KPIs</span>
          <strong>{overview.data ? `${fmt(usablePct)}%` : '—'}</strong>
          <p>{overview.data ? `${fmtInt(totalHeld)} of ${fmtInt(totalReceived)} source rows held back` : 'Checking source health…'}</p>
        </article>
        {overview.data ? overview.data.health.rows.map(h => (
          <article className="quality-source-clean" key={h.source}>
            <div><span>{SOURCE_LABEL[h.source] ?? h.source}</span><strong>{fmt(h.health_pct)}%</strong></div>
            <div className="quality-meter"><span style={{width:`${Math.max(0,Math.min(100,h.health_pct))}%`}} /></div>
            <p>{fmtInt(h.held_back)} held back · {fmtInt(h.usable)} usable</p>
          </article>
        )) : Array.from({length:3},(_,i)=><Skeleton key={i} height={118}/>)}
      </section>

      {punch && (
        <section className="quality-story-clean">
          <div className="quality-story-icon"><Icon name="quality" /></div>
          <div>
            <span className="section-kicker-clean">EXAMPLE · WHY QUALITY CHANGES THE ANSWER</span>
            <h2>{fmtDate(punch.sourceKey, { weekday: 'long', day: 'numeric', month: 'long' })}: attendance data was incomplete.</h2>
            <p>{punch.detail} The affected day is excluded from KPI calculations instead of being silently interpreted as employee absence.</p>
          </div>
        </section>
      )}

      <section className="quality-main-clean">
        <Card title="Checks that found something" subtitle="Only rules with affected records are shown here. The full rule set remains in the technical documentation.">
          <div className="quality-rule-list">
            {overview.isLoading && <Skeleton height={250} />}
            {overview.data && failing.length === 0 && <p className="empty">All checks passed in the current snapshot.</p>}
            {failing.slice(0,6).map(r => (
              <div className="quality-rule-clean" key={r.code}>
                <span className={`quality-severity-clean ${r.severity === 'ERROR' ? 'high' : 'medium'}`} />
                <div>
                  <strong>{r.title}</strong>
                  <p>{r.action}</p>
                </div>
                <div className="quality-rule-number"><strong>{fmtInt(r.affectedRows)}</strong><span>rows</span></div>
                <EvidenceButton title={r.title} description={r.why} evidence={[{ sql:r.sql, params:[], rows:[], ms:r.ms ?? 0 }]} label="SQL" />
              </div>
            ))}
          </div>
        </Card>

        <aside className="quality-process-clean">
          <span className="section-kicker-clean">QUALITY GATE</span>
          <h2>Four steps before a metric is trusted.</h2>
          <div className="quality-steps-clean">
            <div><span>01</span><strong>Land</strong><p>Source extracts arrive in staging unchanged.</p></div>
            <div><span>02</span><strong>Validate</strong><p>18 rules check structure, ranges and relationships.</p></div>
            <div><span>03</span><strong>Hold back</strong><p>Failed rows stay traceable instead of contaminating KPIs.</p></div>
            <div><span>04</span><strong>Publish</strong><p>Only validated aggregate views reach the dashboard.</p></div>
          </div>
          <a className="clean-link" href="#/method">See technical design <Icon name="arrow" /></a>
        </aside>
      </section>
    </>
  )
}
