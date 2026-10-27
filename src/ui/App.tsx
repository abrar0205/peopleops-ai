import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useIsFetching, useIsMutating, useQuery, useQueryClient } from '@tanstack/react-query'
import { bootBackend, type Backend, type BootStep } from '../browser/boot'
import { makeClient, TRPCProvider, useTRPC } from '../browser/trpc'
import { EvidenceProvider, Icon, Toast, fmtDate, href, useRoute } from './common'
import { EvidenceDrawer } from './Evidence'
import { Overview } from './pages/Overview'
import { Attendance } from './pages/Attendance'
import { Attrition } from './pages/Attrition'
import { Training } from './pages/Training'
import { Quality } from './pages/Quality'
import { Ask } from './pages/Ask'
import { SqlLab } from './pages/SqlLab'
import { Method } from './pages/Method'

export const REPO_URL = 'https://github.com/abrar0205/peopleops-ai'
const EXPECTED_STEPS = 11
const MOBILE_LABEL: Record<string, string> = { overview: 'Home', attendance: 'Absence', quality: 'Data', method: 'Method', sql: 'SQL' }

// ------------------------------------------------------------------ backend context

interface Runtime {
  backend: Backend | null
  rerun: () => Promise<void>
  rerunning: boolean
  notify: (msg: string) => void
}
const RuntimeCtx = createContext<Runtime>({ backend: null, rerun: async () => {}, rerunning: false, notify: () => {} })
export const useRuntime = () => useContext(RuntimeCtx)

// ------------------------------------------------------------------ boot

function BootScreen({ steps, error }: { steps: BootStep[]; error?: unknown }) {
  const done = steps.filter(s => s.ms != null).length
  return (
    <main className="boot">
      <div className="boot-card">
        <div className="brand-mark">P</div>
        <h1>Starting a people-analytics backend in this tab</h1>
        <p className="lead">
          PostgreSQL runs here as WebAssembly. The pipeline lands three synthetic source extracts, runs 18 data-quality rules, loads what passes and builds the
          analytics views. Prisma and a tRPC API sit on top, exactly as they would on a server. No data leaves your browser.
        </p>
        <div className="progress" aria-hidden="true">
          <div style={{ width: `${Math.min(100, (done / EXPECTED_STEPS) * 100)}%` }} />
        </div>
        <ol className="boot-steps" aria-live="polite">
          {steps.map((s, i) => {
            const current = s.ms == null && !error
            return (
              <li key={i} className={current ? 'current' : 'done'}>
                {current ? <span className="spinner" /> : <span className="check"><Icon name="check" /></span>}
                <span>
                  {s.label}
                  {s.detail && <small>{s.detail}</small>}
                </span>
                <span className="ms">{s.ms != null ? `${s.ms} ms` : ''}</span>
              </li>
            )
          })}
        </ol>
        {error != null && (
          <div className="callout warn" style={{ marginTop: 16 }}>
            <strong>Could not start the in-browser database.</strong> {error instanceof Error ? error.message : String(error)}. A recent Chrome, Edge, Firefox or Safari is
            required (WebAssembly).
          </div>
        )}
        <div className="boot-foot">
          <span>Synthetic data · about 2,600 employees, 330k attendance rows</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer">Source on GitHub</a>
        </div>
      </div>
    </main>
  )
}

// ------------------------------------------------------------------ shell

const NAV = [
  { group: 'Analytics', items: [
    { page: 'overview', label: 'Overview', icon: 'overview' },
    { page: 'attendance', label: 'Attendance', icon: 'attendance' },
    { page: 'attrition', label: 'Attrition', icon: 'attrition' },
    { page: 'training', label: 'Training', icon: 'training' },
  ] },
  { group: 'Trust', items: [
    { page: 'quality', label: 'Data quality', icon: 'quality' },
    { page: 'method', label: 'Method & privacy', icon: 'method' },
  ] },
  { group: 'Explore', items: [
    { page: 'ask', label: 'Ask', icon: 'ask' },
    { page: 'sql', label: 'SQL console', icon: 'sql' },
  ] },
]

function Shell() {
  const route = useRoute()
  const trpc = useTRPC()
  const { backend, rerun, rerunning } = useRuntime()
  const status = useQuery(trpc.meta.status.queryOptions())
  const busy = useIsFetching() + useIsMutating() > 0
  const signals = useQuery(trpc.insights.signals.queryOptions())
  const counts: Record<string, number | undefined> = {
    overview: signals.data?.filter(s => s.severity !== 'info').length,
    quality: status.data?.openIssues,
  }
  const page = (() => {
    switch (route.page) {
      case 'attendance': return <Attendance params={route.params} />
      case 'attrition': return <Attrition params={route.params} />
      case 'training': return <Training />
      case 'quality': return <Quality params={route.params} />
      case 'ask': return <Ask params={route.params} />
      case 'sql': return <SqlLab />
      case 'method': return <Method />
      default: return <Overview />
    }
  })()
  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href={href('overview')}>
          <span className="brand-mark">P</span>
          <span className="brand-text">
            <strong>PeopleOps</strong>
            <span>Plant workforce analytics</span>
          </span>
        </a>
        {NAV.map(g => (
          <nav key={g.group} aria-label={g.group}>
            <div className="nav-group">{g.group}</div>
            {g.items.map(i => (
              <a key={i.page} href={href(i.page)} className={`nav-link ${route.page === i.page ? 'active' : ''}`} aria-current={route.page === i.page ? 'page' : undefined}>
                <Icon name={i.icon} />
                {i.label}
                {counts[i.page] ? <span className="count">{counts[i.page]}</span> : null}
              </a>
            ))}
          </nav>
        ))}
        <div className="sidebar-foot">
          <span>Synthetic data. Aggregates only, groups under 10 suppressed.</span>
          <a href={REPO_URL} target="_blank" rel="noreferrer"><Icon name="github" /> Source code</a>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <span className="pill"><span className="live-dot" /><span>PostgreSQL 18<span className="hide-xs"> · running in this tab</span></span></span>
          {status.data && <span className="pill">As of {fmtDate(status.data.asOf, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
          {status.data && <span className="pill hide-sm">Pipeline run #{status.data.runId}</span>}
          {backend && <span className="hide-sm muted">Booted in {(backend.bootMs / 1000).toFixed(1)} s</span>}
          {busy && <span className="pill" role="status"><span className="spinner" style={{ width: 10, height: 10, margin: 0 }} /> Updating…</span>}
          <span className="spacer" />
          {backend && (
            <button className="btn small hide-sm" onClick={() => void rerun()} disabled={rerunning} title="Re-run the ingestion pipeline on the same extracts">
              <Icon name="refresh" /> {rerunning ? 'Running pipeline…' : 'Re-run pipeline'}
            </button>
          )}
          <a className="btn small ghost" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub"><Icon name="github" /></a>
        </header>
        <main className="content">{page}</main>
      </div>
      <nav className="mobile-nav" aria-label="Pages">
        {NAV.flatMap(g => g.items).map(i => (
          <a key={i.page} href={href(i.page)} className={route.page === i.page ? 'active' : ''}>
            <Icon name={i.icon} />
            {MOBILE_LABEL[i.page] ?? i.label}
          </a>
        ))}
      </nav>
    </div>
  )
}

// ------------------------------------------------------------------ app

function Providers({ backend, children }: { backend: Backend | null; children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }), [])
  const client = useMemo(() => makeClient(backend?.ctx ?? null), [backend])
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>
        {children}
      </TRPCProvider>
    </QueryClientProvider>
  )
}

function RuntimeProvider({ backend, children }: { backend: Backend | null; children: ReactNode }) {
  const queryClient = useQueryClient()
  const [rerunning, setRerunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const notify = useCallback((m: string) => setToast(m), [])
  const rerun = useCallback(async () => {
    if (!backend) return
    setRerunning(true)
    try {
      const r = await backend.rerun()
      await queryClient.invalidateQueries()
      setToast(`Pipeline run #${r.runId} finished in ${(r.ms / 1000).toFixed(1)} s`)
    } finally {
      setRerunning(false)
    }
  }, [backend, queryClient])
  return (
    <RuntimeCtx.Provider value={{ backend, rerun, rerunning, notify }}>
      {children}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </RuntimeCtx.Provider>
  )
}

export default function App() {
  const remote = Boolean(import.meta.env.VITE_API_URL)
  const [steps, setSteps] = useState<BootStep[]>([])
  const [backend, setBackend] = useState<Backend | null>(null)
  const [error, setError] = useState<unknown>(null)
  const started = useRef(false)
  useEffect(() => {
    if (remote || started.current) return
    started.current = true
    bootBackend(setSteps).then(setBackend, setError)
  }, [remote])

  if (!remote && !backend) return <BootScreen steps={steps} error={error} />
  return (
    <Providers backend={backend}>
      <RuntimeProvider backend={backend}>
        <EvidenceProvider render={(req, close) => (req ? <EvidenceDrawer {...req} onClose={close} /> : null)}>
          <Shell />
        </EvidenceProvider>
      </RuntimeProvider>
    </Providers>
  )
}
