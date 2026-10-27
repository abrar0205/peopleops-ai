import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Evidence } from '../api/context'

// ------------------------------------------------------------------ format

export const fmt = (v: number | null | undefined, digits = 1) => (v == null ? '—' : v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }))
export const fmtInt = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('en-US'))
export const fmtDate = (iso: string, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' })
export const fmtMonth = (iso: string) => fmtDate(iso, { month: 'short', year: '2-digit' })

// ------------------------------------------------------------------ routing

export interface Route {
  page: string
  params: URLSearchParams
}

const parseHash = (): Route => {
  const [path, query] = window.location.hash.replace(/^#\/?/, '').split('?')
  return { page: path || 'overview', params: new URLSearchParams(query ?? '') }
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => {
      setRoute(parseHash())
      window.scrollTo({ top: 0 })
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const href = (page: string, params: Record<string, string | undefined> = {}) => {
  const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null && v !== '') as [string, string][]).toString()
  return `#/${page}${q ? `?${q}` : ''}`
}

/** Update query params of the current page without adding history entries. */
export function setParams(page: string, params: Record<string, string | undefined>) {
  window.history.replaceState(null, '', href(page, params))
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

// ------------------------------------------------------------------ evidence drawer

interface EvidenceRequest {
  title: string
  description?: string
  evidence: Evidence[]
}

const EvidenceCtx = createContext<(r: EvidenceRequest) => void>(() => {})
export const useEvidence = () => useContext(EvidenceCtx)

export function EvidenceProvider({ children, render }: { children: ReactNode; render: (r: EvidenceRequest | null, close: () => void) => ReactNode }) {
  const [req, setReq] = useState<EvidenceRequest | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setReq(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <EvidenceCtx.Provider value={setReq}>
      {children}
      {render(req, () => setReq(null))}
    </EvidenceCtx.Provider>
  )
}

export function EvidenceButton({ title, description, evidence, label = 'SQL' }: EvidenceRequest & { label?: string }) {
  const open = useEvidence()
  return (
    <button className="link-btn" onClick={() => open({ title, description, evidence })} title="Show the query behind this number">
      <Icon name="code" /> {label}
    </button>
  )
}

// ------------------------------------------------------------------ small components

export function Card({ title, subtitle, actions, children, foot, className = '' }: { title?: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; foot?: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h2>{title}</h2>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="filters">{actions}</div>}
        </div>
      )}
      <div className="card-body">{children}</div>
      {foot && <div className="card-foot">{foot}</div>}
    </section>
  )
}

export function PageHead({ eyebrow, title, children, actions }: { eyebrow: string; title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      {actions && <div className="filters">{actions}</div>}
    </header>
  )
}

export function Segmented<T extends string | number>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map(o => (
        <button key={String(o.value)} role="radio" aria-checked={o.value === value} className={o.value === value ? 'active' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Select({ value, options, onChange, label }: { value: string; options: { value: string; label: string }[]; onChange: (v: string) => void; label: string }) {
  return (
    <select className="select" aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {options.map(o => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Skeleton({ height = 120 }: { height?: number }) {
  return <div className="skeleton" style={{ height }} aria-label="Loading" />
}

export function ErrorNote({ error }: { error: unknown }) {
  return <p className="error">{error instanceof Error ? error.message : String(error)}</p>
}

export function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3200)
    return () => clearTimeout(t)
  }, [message, onDone])
  return <div className="toast" role="status">{message}</div>
}

// ------------------------------------------------------------------ icons

const PATHS: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" /><rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" /></>,
  attendance: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M3 9h18M8 2v4M16 2v4" /><path d="m9 15 2 2 4-4" /></>,
  attrition: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M17 11h5" /></>,
  training: <><path d="M22 10 12 5 2 10l10 5 10-5Z" /><path d="M6 12v5c3 2 9 2 12 0v-5" /></>,
  quality: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  ask: <><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /><path d="M8 9h8M8 13h5" /></>,
  sql: <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" /></>,
  method: <><circle cx="12" cy="12" r="9" /><path d="M12 16v-4M12 8h.01" /></>,
  code: <><path d="m16 18 6-6-6-6M8 6l-6 6 6 6" /></>,
  github: <><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3-.3 6-1.5 6-6.5a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12.3 12.3 0 0 0-6.2 0C6.5 1.3 5.4 1.6 5.4 1.6a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 8c0 5 3 6.2 6 6.5a4.8 4.8 0 0 0-1 3.5v4" /><path d="M9 18c-4.5 1.5-5-2.5-7-3" /></>,
  download: <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" /></>,
  refresh: <><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></>,
  arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
  close: <><path d="M18 6 6 18M6 6l12 12" /></>,
  check: <><path d="M20 6 9 17l-5-5" /></>,
  copy: <><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  lock: <><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></>,
  send: <><path d="m22 2-7 20-4-9-9-4Z" /><path d="M22 2 11 13" /></>,
  play: <><path d="m6 4 14 8-14 8Z" /></>,
}

export function Icon({ name, size }: { name: keyof typeof PATHS | string; size?: number }) {
  return (
    <svg className="icon" style={size ? { width: size, height: size } : undefined} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  )
}

// ------------------------------------------------------------------ downloads

export function downloadText(filename: string, text: string, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n')
}
