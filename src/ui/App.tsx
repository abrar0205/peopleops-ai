import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
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

interface Runtime {
  backend: Backend | null
  rerun: () => Promise<void>
  rerunning: boolean
  notify: (msg: string) => void
}
const RuntimeCtx = createContext<Runtime>({ backend: null, rerun: async () => {}, rerunning: false, notify: () => {} })
export const useRuntime = () => useContext(RuntimeCtx)

function BootScreen({ steps, error }: { steps: BootStep[]; error?: unknown }) {
  const done = steps.filter(s => s.ms != null).length
  const current = [...steps].reverse().find(s => s.ms == null)?.label ?? 'Preparing analytics workspace'
  return (
    <main className="boot boot-simple">
      <div className="boot-simple-card">
        <div className="brand-mark">P</div>
        <span className="boot-eyebrow">PEOPLEOPS · INTERACTIVE DEMO</span>
        <h1>Preparing the workforce dashboard</h1>
        <p>Loading synthetic workforce data and the local analytics engine. Everything runs in this browser tab.</p>
        <div className="progress" aria-hidden="true"><div style={{ width: `${Math.min(100, (done / EXPECTED_STEPS) * 100)}%` }} /></div>
        {!error && <div className="boot-current"><span className="spinner" /> {current}</div>}
        {error != null && <div className="callout warn"><strong>Could not start the demo.</strong> {error instanceof Error ? error.message : String(error)}</div>}
        <div className="boot-tech">PostgreSQL · Prisma · tRPC · React · synthetic data only</div>
      </div>
    </main>
  )
}

const PRIMARY_NAV = [
  { page: 'overview', label: 'Dashboard', icon: 'overview' },
  { page: 'quality', label: 'Data quality', icon: 'quality' },
  { page: 'ask', label: 'Insights', icon: 'ask' },
  { page: 'method', label: 'Technical', icon: 'method' },
]

function Shell() {
  const route = useRoute()
  const trpc = useTRPC()
  const status = useQuery(trpc.meta.status.queryOptions())
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

  const primaryPage = ['overview', 'quality', 'ask', 'method'].includes(route.page) ? route.page : 'overview'

  return (
    <div className="shell shell-simple">
      <aside className="sidebar sidebar-simple">
        <a className="brand" href={href('overview')}>
          <span className="brand-mark">P</span>
          <span className="brand-text"><strong>PeopleOps</strong><span>workforce intelligence</span></span>
        </a>
        <nav aria-label="Primary navigation">
          {PRIMARY_NAV.map(i => (
            <a key={i.page} href={href(i.page)} className={`nav-link ${primaryPage === i.page ? 'active' : ''}`} aria-current={primaryPage === i.page ? 'page' : undefined}>
              <Icon name={i.icon} />
              {i.label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot sidebar-foot-simple">
          <div className="synthetic-note"><span className="live-dot" /><span>Synthetic manufacturing data</span></div>
          <a href={REPO_URL} target="_blank" rel="noreferrer"><Icon name="github" /> Source code</a>
        </div>
      </aside>

      <div className="main">
        <header className="topbar topbar-simple">
          <div className="topbar-context">
            <strong>People Analytics</strong>
            {status.data && <span>Snapshot · {fmtDate(status.data.asOf, { month: 'short', year: 'numeric' })}</span>}
          </div>
          <span className="spacer" />
          <span className="demo-status"><span className="live-dot" /> Interactive demo</span>
          <a className="btn small ghost" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub"><Icon name="github" /></a>
        </header>
        <main className="content content-simple">{page}</main>
      </div>

      <nav className="mobile-nav mobile-nav-simple" aria-label="Pages">
        {PRIMARY_NAV.map(i => (
          <a key={i.page} href={href(i.page)} className={primaryPage === i.page ? 'active' : ''}>
            <Icon name={i.icon} />
            {i.label === 'Data quality' ? 'Quality' : i.label}
          </a>
        ))}
      </nav>
    </div>
  )
}

function Providers({ backend, children }: { backend: Backend | null; children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }), [])
  const client = useMemo(() => makeClient(backend?.ctx ?? null), [backend])
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>{children}</TRPCProvider>
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
