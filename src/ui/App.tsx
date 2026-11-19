import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { bootBackend, type Backend, type BootStep } from '../browser/boot'
import { makeClient, TRPCProvider, useTRPC } from '../browser/trpc'
import { EvidenceProvider, Icon, Toast, fmtDate, href, useRoute } from './common'
import { EvidenceDrawer } from './Evidence'
import { Brief } from './pages/Brief'
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

const NAV = [
  { page: 'overview', label: 'Brief' },
  { page: 'attendance', label: 'Explore' },
  { page: 'quality', label: 'Data quality' },
  { page: 'ask', label: 'Ask' },
  { page: 'method', label: 'How it works' },
]
const EXPLORE = [
  { page: 'attendance', label: 'Attendance' },
  { page: 'attrition', label: 'Attrition' },
  { page: 'training', label: 'Training' },
]
const SECTION_OF: Record<string, string> = { attendance: 'attendance', attrition: 'attendance', training: 'attendance', sql: 'method' }

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
      default: return <Brief />
    }
  })()

  const known = ['overview', ...Object.keys(SECTION_OF), 'quality', 'ask', 'method']
  const current = known.includes(route.page) ? route.page : 'overview'
  const section = SECTION_OF[current] ?? current
  const exploring = section === 'attendance'

  return (
    <div className="app">
      <a className="skip" href="#content">Skip to content</a>
      <header className="nav">
        <div className="nav-inner">
          <a className="logo" href={href('overview')} aria-label="PeopleOps home">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="2" width="6" height="6" /><rect x="9" y="2" width="6" height="6" /><rect x="16" y="2" width="6" height="6" /><rect x="2" y="9" width="6" height="6" /><rect x="9" y="9" width="6" height="6" className="hot" /><rect x="16" y="9" width="6" height="6" /><rect x="2" y="16" width="6" height="6" /><rect x="9" y="16" width="6" height="6" /><rect x="16" y="16" width="6" height="6" /></svg>
            <span>PeopleOps</span>
          </a>
          <nav aria-label="Primary">
            {NAV.map(i => (
              <a key={i.page} href={href(i.page)} className={section === i.page ? 'on' : ''} aria-current={section === i.page ? 'page' : undefined}>{i.label}</a>
            ))}
          </nav>
          <a className="nav-gh" href={REPO_URL} target="_blank" rel="noreferrer" aria-label="Source on GitHub"><Icon name="github" /><span>GitHub</span></a>
        </div>
      </header>

      {exploring && (
        <div className="subnav">
          <nav className="subnav-inner" aria-label="Explore">
            {EXPLORE.map(i => (
              <a key={i.page} href={href(i.page)} className={current === i.page ? 'on' : ''} aria-current={current === i.page ? 'page' : undefined}>{i.label}</a>
            ))}
          </nav>
        </div>
      )}

      <main id="content" className={current === 'overview' ? 'page page-brief' : 'page'}>{page}</main>

      <footer className="foot">
        <div className="foot-inner">
          <p>
            PeopleOps is a portfolio project by Abrar Assan Mohamed. All data is synthetic{status.data ? `, generated for a snapshot dated ${fmtDate(status.data.asOf, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}.
            Figures are aggregates only, groups under 10 people are hidden, and nothing scores individual employees.
          </p>
          <div className="foot-links">
            <a href={href('method')}>Method and privacy</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>
          </div>
        </div>
      </footer>
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
