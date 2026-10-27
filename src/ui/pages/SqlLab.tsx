import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTRPC } from '../../browser/trpc'
import { Card, Icon, PageHead, downloadText, toCsv } from '../common'
import { RowsTable, takeConsoleDraft } from '../Evidence'

export function SqlLab() {
  const trpc = useTRPC()
  const examples = useQuery(trpc.sql.examples.queryOptions())
  const schema = useQuery(trpc.sql.schema.queryOptions())
  const run = useMutation(trpc.sql.run.mutationOptions())
  const [sql, setSql] = useState(() => takeConsoleDraft() ?? '')

  const execute = (text = sql) => run.mutate({ sql: text })

  // Show a result straight away: run the draft (or the first example) once.
  const ranInitial = useRef(false)
  useEffect(() => {
    if (ranInitial.current || !examples.data) return
    ranInitial.current = true
    const initial = sql || examples.data[0].sql
    setSql(initial)
    run.mutate({ sql: initial })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [examples.data])
  const result = run.data

  return (
    <>
      <PageHead eyebrow="SQL console" title="Query the analytics layer yourself">
        Real PostgreSQL in your browser. Queries run as the read-only <code>peopleops_analyst</code> role, which can read the aggregate views in <code>analytics</code> and nothing else.
      </PageHead>

      <div className="grid-main">
        <Card
          title="Query"
          actions={
            <select
              className="select"
              aria-label="Example queries"
              value=""
              onChange={e => {
                const ex = examples.data?.[Number(e.target.value)]
                if (ex) {
                  setSql(ex.sql)
                  execute(ex.sql)
                }
              }}
            >
              <option value="">Examples…</option>
              {examples.data?.map((x, i) => <option key={x.title} value={i}>{x.title}</option>)}
            </select>
          }
          foot={
            <>
              <button className="btn primary small" onClick={() => execute()} disabled={run.isPending}>
                <Icon name="play" /> Run
              </button>
              <span><span className="kbd">Ctrl</span> + <span className="kbd">Enter</span></span>
              {result?.ok && (
                <>
                  <span>{result.rows.length}{result.truncated ? '+' : ''} rows · {result.ms} ms</span>
                  <button className="btn small" onClick={() => downloadText('query.csv', toCsv(result.rows), 'text/csv')}>
                    <Icon name="download" /> CSV for Power BI / Tableau
                  </button>
                </>
              )}
            </>
          }
        >
          <textarea
            className="textarea"
            rows={11}
            spellCheck={false}
            value={sql}
            onChange={e => setSql(e.target.value)}
            onKeyDown={e => {
              if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                e.preventDefault()
                execute()
              }
            }}
            aria-label="SQL query"
          />
        </Card>
        <Card title="Readable views" subtitle="Schema analytics">
          <div style={{ display: 'grid', gap: 10, maxHeight: 330, overflow: 'auto' }}>
            {schema.data?.map(v => (
              <details key={v.name}>
                <summary style={{ cursor: 'pointer', fontFamily: 'var(--mono)', fontSize: 12.5 }}>{v.name}</summary>
                <ul className="list-plain" style={{ marginTop: 6, fontSize: 12 }}>
                  {v.columns.map(c => (
                    <li key={c.name}>
                      <button className="link-btn" style={{ fontFamily: 'var(--mono)', fontSize: 12 }} onClick={() => setSql(s => `${s}${s.endsWith(' ') || !s ? '' : ' '}${c.name}`)}>
                        {c.name}
                      </button>{' '}
                      <span className="muted">{c.type}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </div>
        </Card>
      </div>

      <Card title="Result">
        {run.isPending && <p className="muted">Running…</p>}
        {result && !result.ok && <p className="error">{result.error}</p>}
        {result?.ok && <RowsTable rows={result.rows} max={500} />}
        {!result && !run.isPending && <p className="muted">Run a query to see results. Try the last example to see the permission boundary.</p>}
        {result?.truncated && <p className="note" style={{ marginTop: 8 }}>Results are capped at 500 rows.</p>}
      </Card>
    </>
  )
}
