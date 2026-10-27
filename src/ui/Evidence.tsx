import { Fragment, useState, type ReactNode } from 'react'
import type { Evidence } from '../api/context'
import { Icon, fmt, href, toCsv, downloadText } from './common'

/** Inline bind parameters so the SQL can be pasted into the console as-is. */
export function inlineParams(sql: string, params: unknown[]): string {
  return sql.replace(/\$(\d+)/g, (m, i) => {
    const v = params[Number(i) - 1]
    if (v === undefined) return m
    return typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`
  })
}

const KEYWORDS = /\b(SELECT|FROM|WHERE|AND|OR|NOT|GROUP BY|ORDER BY|BY|WITH|AS|CASE|WHEN|THEN|ELSE|END|JOIN|LEFT|ON|IN|IS|NULL|LIMIT|DESC|ASC|OVER|PARTITION|WINDOW|ROWS|BETWEEN|PRECEDING|UNBOUNDED|FOLLOWING|CURRENT|ROW|DISTINCT|FILTER|UNION|ALL|INSERT|INTO|VALUES|EXISTS|true|false|interval|GROUPING SETS|WITHIN GROUP)\b/g
const FUNCS = /\b(count|sum|avg|max|min|round|coalesce|nullif|format|date_trunc|dense_rank|percentile_cont|bool_or|last_value|current_setting|to_char|trim|string_agg|array_agg|least|greatest|extract)\b(?=\()/gi

/** Tiny SQL highlighter: comments, strings, numbers, keywords, functions. */
export function highlightSql(sql: string): ReactNode[] {
  const out: ReactNode[] = []
  const re = /(--[^\n]*)|('(?:[^']|'')*')|(\b\d+(?:\.\d+)?\b)/g
  let last = 0
  let m: RegExpExecArray | null
  let k = 0
  const plain = (s: string) => {
    const parts: ReactNode[] = []
    let p = 0
    const combined = new RegExp(`${KEYWORDS.source}|${FUNCS.source}`, 'gi')
    let mm: RegExpExecArray | null
    while ((mm = combined.exec(s))) {
      if (mm.index > p) parts.push(s.slice(p, mm.index))
      const isKw = new RegExp(`^${KEYWORDS.source}$`).test(mm[0])
      parts.push(<span key={k++} className={isKw ? 'kw' : 'fn'}>{mm[0]}</span>)
      p = mm.index + mm[0].length
    }
    if (p < s.length) parts.push(s.slice(p))
    return parts
  }
  while ((m = re.exec(sql))) {
    if (m.index > last) out.push(<Fragment key={k++}>{plain(sql.slice(last, m.index))}</Fragment>)
    const cls = m[1] ? 'cm' : m[2] ? 'str' : 'num'
    out.push(<span key={k++} className={cls}>{m[0]}</span>)
    last = m.index + m[0].length
  }
  if (last < sql.length) out.push(<Fragment key={k++}>{plain(sql.slice(last))}</Fragment>)
  return out
}

export function SqlBlock({ sql }: { sql: string }) {
  return <pre className="sql">{highlightSql(sql)}</pre>
}

let pendingConsoleSql: string | null = null
export const takeConsoleDraft = () => {
  const s = pendingConsoleSql
  pendingConsoleSql = null
  return s
}
export function openInConsole(sql: string) {
  pendingConsoleSql = sql
  window.location.hash = href('sql')
}

export function RowsTable({ rows, max = 50 }: { rows: Record<string, unknown>[]; max?: number }) {
  if (!rows.length) return <p className="note">No rows.</p>
  const cols = Object.keys(rows[0])
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>{cols.map(c => <th key={c} className={typeof rows[0][c] === 'number' ? 'num' : ''}>{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, max).map((r, i) => (
            <tr key={i}>
              {cols.map(c => {
                const v = r[c]
                return (
                  <td key={c} className={typeof v === 'number' ? 'num' : ''}>
                    {v == null ? <span className="muted">null</span> : typeof v === 'number' ? (Number.isInteger(v) ? v.toLocaleString('en-US') : fmt(v, 2)) : typeof v === 'boolean' ? String(v) : typeof v === 'object' ? JSON.stringify(v) : String(v)}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > max && <p className="note" style={{ marginTop: 8 }}>Showing {max} of {rows.length} rows.</p>}
    </div>
  )
}

export function EvidenceDrawer({ title, description, evidence, onClose }: { title: string; description?: string; evidence: Evidence[]; onClose: () => void }) {
  const unique = evidence.filter((e, i) => evidence.findIndex(x => x.sql === e.sql && JSON.stringify(x.params) === JSON.stringify(e.params)) === i)
  const [copied, setCopied] = useState<number | null>(null)
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label={`Evidence: ${title}`}>
        <div className="drawer-head">
          <div>
            <div className="eyebrow">Evidence</div>
            <h2>{title}</h2>
            {description && <p className="note" style={{ marginTop: 4 }}>{description}</p>}
          </div>
          <button className="btn ghost" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="drawer-body">
          <p className="note">
            Ran as role <code>peopleops_analyst</code> in a read-only transaction against the <code>analytics</code> schema.
          </p>
          {unique.map((e, i) => {
            const sql = inlineParams(e.sql, e.params)
            return (
              <div key={i} className="stack" style={{ gap: 10 }}>
                <div className="filters" style={{ justifyContent: 'space-between' }}>
                  <span className="note">
                    Query {i + 1} of {unique.length} · {e.rows.length} rows · {e.ms} ms
                  </span>
                  <div className="filters">
                    <button
                      className="btn small"
                      onClick={() => {
                        void navigator.clipboard?.writeText(sql)
                        setCopied(i)
                      }}
                    >
                      <Icon name={copied === i ? 'check' : 'copy'} /> {copied === i ? 'Copied' : 'Copy'}
                    </button>
                    <button className="btn small" onClick={() => downloadText(`evidence-${i + 1}.csv`, toCsv(e.rows), 'text/csv')}>
                      <Icon name="download" /> CSV
                    </button>
                    <button
                      className="btn small"
                      onClick={() => {
                        onClose()
                        openInConsole(sql)
                      }}
                    >
                      <Icon name="sql" /> Open in console
                    </button>
                  </div>
                </div>
                <SqlBlock sql={sql} />
                <RowsTable rows={e.rows} />
              </div>
            )
          })}
        </div>
      </aside>
    </>
  )
}
