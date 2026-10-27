import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { useRuntime } from '../App'
import { Card, EvidenceButton, Icon, PageHead, Segmented, Skeleton, fmt, fmtDate, fmtInt, setParams, useEvidence } from '../common'

const SOURCE_LABEL: Record<string, string> = { hris: 'HR master data', timeclock: 'Time & attendance', lms: 'Learning (LMS)' }
type Status = 'OPEN' | 'ACKNOWLEDGED' | 'OVERRIDDEN'
const STATUS_BADGE: Record<Status, string> = { OPEN: 'warn', ACKNOWLEDGED: 'neutral', OVERRIDDEN: 'info' }

export function Quality({ params }: { params: URLSearchParams }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const { notify } = useRuntime()
  const openEvidence = useEvidence()
  const rule = params.get('rule') ?? undefined
  const [status, setStatus] = useState<Status | 'ALL'>('ALL')
  const [take, setTake] = useState(20)
  const overview = useQuery(trpc.quality.overview.queryOptions())
  const issues = useQuery(trpc.quality.issues.queryOptions({ ruleCode: rule, status: status === 'ALL' ? undefined : status, take }))
  const punchIssue = useQuery(trpc.quality.issues.queryOptions({ ruleCode: 'TC_MISSING_PUNCHES', take: 5 }))
  const day = punchIssue.data?.items[0]?.sourceKey
  const impact = useQuery({ ...trpc.quality.exclusionImpact.queryOptions({ day: day ?? '2000-01-01' }), enabled: Boolean(day) })
  const review = useMutation(
    trpc.quality.review.mutationOptions({
      onSuccess: async (r, vars) => {
        await queryClient.invalidateQueries()
        notify(vars.status === 'OVERRIDDEN' ? `Day included. KPIs recomputed from the analytics views.` : vars.status === 'OPEN' ? 'Issue reopened.' : `Issue #${r.id} acknowledged.`)
      },
      onError: e => notify(e.message),
    }),
  )
  const reviewWithNote = (id: number, next: Status, prompt: string) => {
    const note = next === 'OPEN' ? '' : window.prompt(prompt, '')
    if (note === null) return
    review.mutate({ id, status: next, note: note || undefined })
  }
  const punch = punchIssue.data?.items[0]
  const totalMs = overview.data?.steps.reduce((s, x) => s + x.ms, 0) ?? 0

  return (
    <>
      <PageHead eyebrow="Data quality" title="Trust the number before acting on it">
        Every source row passes 18 rules before it can reach a KPI. Failures are held back and logged as issues with an owner, never silently dropped or silently fixed.
      </PageHead>

      <section className="grid-3">
        {overview.data
          ? overview.data.health.rows.map(h => (
              <Card key={h.source} title={SOURCE_LABEL[h.source] ?? h.source} subtitle={`${fmtInt(h.received)} rows received in the latest run`}>
                <div className="kpi-value">
                  {fmt(h.health_pct)}
                  <small>% usable</small>
                </div>
                <p className="note" style={{ marginTop: 6 }}>
                  {fmtInt(h.held_back)} rows held back from KPIs
                </p>
              </Card>
            ))
          : Array.from({ length: 3 }, (_, i) => <Skeleton key={i} height={110} />)}
      </section>

      {punch && (
        <div className="callout warn">
          <div className="filters" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div style={{ maxWidth: '72ch' }}>
              <strong>{fmtDate(punch.sourceKey, { weekday: 'long', day: 'numeric', month: 'long' })}: punch data missing.</strong> {punch.detail}.{' '}
              {impact.data && (
                <>
                  Counted as no-shows, that week&apos;s plant unplanned absence would read <strong>{fmt(impact.data.withDay)}%</strong> instead of{' '}
                  <strong>{fmt(impact.data.withoutDay)}%</strong>. {punch.status === 'OVERRIDDEN' ? <>A reviewer overrode the check, so the day <strong>is included</strong> in KPIs.</> : <>The day is <strong>excluded</strong> from KPIs until reviewed.</>}
                </>
              )}
              {punch.reviewNote && <span className="note"> Note: “{punch.reviewNote}”</span>}
            </div>
            <div className="filters">
              {punch.status !== 'OVERRIDDEN' && (
                <button className="btn small" disabled={review.isPending} onClick={() => reviewWithNote(punch.id, 'OVERRIDDEN', 'Why is this day usable? (recorded in the audit trail)')}>
                  Include the day anyway
                </button>
              )}
              {punch.status === 'OPEN' && (
                <button className="btn small" disabled={review.isPending} onClick={() => reviewWithNote(punch.id, 'ACKNOWLEDGED', 'Note for the audit trail (e.g. ticket raised with the time-system owner)')}>
                  Acknowledge
                </button>
              )}
              {punch.status !== 'OPEN' && (
                <button className="btn small" disabled={review.isPending} onClick={() => reviewWithNote(punch.id, 'OPEN', '')}>
                  Reopen
                </button>
              )}
              {impact.data && <EvidenceButton title="Impact of the excluded day" evidence={[impact.data.evidence]} />}
            </div>
          </div>
        </div>
      )}

      <div className="grid-main">
        <Card title="Rules" subtitle="Latest pipeline run. Click a rule to see its issues." className="rules-card">
          {overview.data ? (
            <div className="table-wrap" style={{ margin: '0 -18px' }}>
              <table>
                <thead>
                  <tr>
                    <th>Rule</th>
                    <th>Source</th>
                    <th>Effect</th>
                    <th className="num">Issues</th>
                    <th className="num">Rows</th>
                    <th className="num">ms</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {overview.data.rules.map(r => (
                    <tr key={r.code} className={`clickable ${rule === r.code ? 'selected' : ''}`} onClick={() => setParams('quality', { rule: rule === r.code ? undefined : r.code })}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{r.title}</div>
                        <div className="code muted" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{r.code}</div>
                      </td>
                      <td className="text-2">{SOURCE_LABEL[r.source]}</td>
                      <td>
                        <span className={`badge ${r.issues === 0 ? 'good' : r.severity === 'ERROR' ? 'bad' : 'warn'}`}>{r.issues === 0 ? 'passed' : r.severity.toLowerCase()}</span>
                        <div className="note" style={{ marginTop: 4, fontSize: 11.5 }}>{r.action}</div>
                      </td>
                      <td className="num">{r.issues}</td>
                      <td className="num">{fmtInt(r.affectedRows)}</td>
                      <td className="num muted">{r.ms ?? '—'}</td>
                      <td>
                        <button
                          className="link-btn"
                          onClick={e => {
                            e.stopPropagation()
                            openEvidence({ title: r.title, description: r.why, evidence: [{ sql: r.sql, params: [], rows: [], ms: r.ms ?? 0 }] })
                          }}
                        >
                          <Icon name="code" /> SQL
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Skeleton height={400} />
          )}
        </Card>

        <div className="stack">
          <Card title="Pipeline run" subtitle={`${(totalMs / 1000).toFixed(1)} s in this browser tab`}>
            {overview.data ? (
              <ol className="boot-steps" style={{ margin: 0 }}>
                {overview.data.steps.map(s => (
                  <li key={s.name} className="done">
                    <span className="check"><Icon name="check" /></span>
                    <span>{s.name}</span>
                    <span className="ms">{s.ms} ms</span>
                  </li>
                ))}
              </ol>
            ) : (
              <Skeleton height={160} />
            )}
          </Card>
          <Card title="Why this matters" subtitle="">
            <ul className="list-plain">
              <li><strong>Held back, not dropped.</strong> Rejected rows stay in staging with the rule that caught them.</li>
              <li><strong>Cascades are explicit.</strong> Time and training rows of a quarantined HR record wait for it instead of becoming orphans.</li>
              <li><strong>Constraints as a backstop.</strong> CHECK and foreign-key constraints on the core tables reject anything a rule misses.</li>
              <li><strong>Reviews are audited.</strong> Overrides need a reason and recompute every KPI.</li>
            </ul>
          </Card>
        </div>
      </div>

      <Card
        title={rule ? `Issues · ${rule}` : 'All issues'}
        subtitle={issues.data ? `${issues.data.total} issues${issues.data.total > issues.data.items.length ? `, showing ${issues.data.items.length}` : ''}` : ''}
        actions={
          <>
            <Segmented label="Status" value={status} onChange={setStatus} options={[{ value: 'ALL', label: 'All' }, { value: 'OPEN', label: 'Open' }, { value: 'ACKNOWLEDGED', label: 'Acknowledged' }, { value: 'OVERRIDDEN', label: 'Overridden' }]} />
            {rule && <button className="btn small ghost" onClick={() => setParams('quality', {})}>Clear rule filter</button>}
          </>
        }
      >
        {issues.data ? (
          <div className="table-wrap" style={{ margin: '0 -18px' }}>
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Detail</th>
                  <th className="num">Rows</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {issues.data.items.map(i => (
                  <tr key={i.id}>
                    <td className="code">
                      {i.sourceKey}
                      <div className="muted" style={{ fontSize: 11 }}>{i.ruleCode}</div>
                    </td>
                    <td className="text-2" style={{ minWidth: 260 }}>
                      {i.detail}
                      {i.reviewNote && <div className="note">Note: {i.reviewNote}</div>}
                    </td>
                    <td className="num">{fmtInt(i.rowCount)}</td>
                    <td><span className={`badge ${STATUS_BADGE[i.status as Status]}`}>{i.status.toLowerCase()}</span></td>
                    <td>
                      {i.status === 'OPEN' ? (
                        <button className="btn small" disabled={review.isPending} onClick={() => reviewWithNote(i.id, 'ACKNOWLEDGED', 'Note for the audit trail (owner, ticket, next step)')}>
                          Acknowledge
                        </button>
                      ) : (
                        <button className="btn small ghost" disabled={review.isPending} onClick={() => reviewWithNote(i.id, 'OPEN', '')}>
                          Reopen
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Skeleton height={240} />
        )}
        {issues.data && issues.data.total > issues.data.items.length && (
          <button className="btn small" style={{ marginTop: 12 }} onClick={() => setTake(t => t + 40)}>
            Show more
          </button>
        )}
      </Card>
    </>
  )
}
