import { createContext, startTransition, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import type { BootStep } from '../browser/boot'
import { startWorker, type WorkerBackend } from '../browser/workerClient'
import type { Snapshot } from '../api/snapshot'
import { Intro, PHASES, phaseOf } from './Intro'
import { markIntroDone } from './motion'
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
interface Runtime {
  /** Set once the worker's database is live. */
  backend: WorkerBackend | null
  steps: BootStep[]
  rerun: () => Promise<void>
  rerunning: boolean
  notify: (msg: string) => void
  /** Show the pipeline intro again. */
  replayIntro: () => void
}
const RuntimeCtx = createContext<Runtime>({ backend: null, steps: [], rerun: async () => {}, rerunning: false, notify: () => {}, replayIntro: () => {} })
export const useRuntime = () => useContext(RuntimeCtx)

/** Nav badge: the real database boot, step by step, then "Live". */
function EngineBadge() {
  const { steps, backend } = useRuntime()
  if (import.meta.env.VITE_API_URL) return null
  const { idx, ready, ms } = phaseOf(steps)
  const label = ready || backend ? 'Live database' : idx >= 0 ? `${PHASES[idx].label}…` : 'Starting the database…'
  const detail = steps.filter(x => x.ms != null).map(x => `${x.label}: ${x.ms} ms`).join('\n')
  return (
    <a className={`engine${ready || backend ? ' ready' : ''}`} href={href('method')} title={ready ? `PostgreSQL is running in this tab. Booted in ${(ms / 1000).toFixed(1)} s.\n\n${detail}` : 'PostgreSQL is booting in this tab. The brief is already up to date; drill-downs, Ask and SQL unlock when it is ready.'}>
      <span className="engine-dot" />
      <span className="engine-text">{label}</span>
      {(ready || backend) && <span className="engine-ms">{(ms / 1000).toFixed(1)} s</span>}
    </a>
  )
}

const NAV = [
  { page: 'overview', label: 'Brief', short: 'Brief' },
  { page: 'attendance', label: 'Explore', short: 'Explore' },
  { page: 'ask', label: 'Ask', short: 'Ask' },
]
const EXPLORE = [
  { page: 'attendance', label: 'Attendance' },
  { page: 'attrition', label: 'Attrition' },
  { page: 'training', label: 'Training' },
  { page: 'quality', label: 'Data quality' },
]
// How it works and the SQL console live in the brief's last section and the footer, not the nav.
const SECTION_OF: Record<string, string> = { attendance: 'attendance', attrition: 'attendance', training: 'attendance', quality: 'attendance', sql: 'method' }

type ViewTransitionDoc = Document & { startViewTransition?: (cb: () => void) => unknown }
const THEME_KEY = 'peopleops-theme'

/** Light/dark switch. Starts from the device setting; a choice is remembered. */
function ThemeToggle() {
  const sys = () => (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.theme as 'light' | 'dark' | undefined) ?? sys())
  const flip = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    const apply = () => { document.documentElement.dataset.theme = next; setTheme(next) }
    try { localStorage.setItem(THEME_KEY, next) } catch { /* storage unavailable */ }
    const doc = document as ViewTransitionDoc
    if (doc.startViewTransition && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) doc.startViewTransition(apply)
    else apply()
  }
  return (
    <button className="theme-toggle" onClick={flip} aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} title={theme === 'dark' ? 'Light theme' : 'Dark theme'}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {theme === 'dark'
          ? <><circle cx="12" cy="12" r="4.2" /><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6" /></>
          : <path d="M20.5 14.2A8.5 8.5 0 0 1 9.8 3.5a8.5 8.5 0 1 0 10.7 10.7Z" />}
      </svg>
    </button>
  )
}

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
              <a key={i.page} href={href(i.page)} className={section === i.page ? 'on' : ''} aria-current={section === i.page ? 'page' : undefined}><span className="l-full">{i.label}</span><span className="l-short">{i.short}</span></a>
            ))}
          </nav>
          <EngineBadge />
          <ThemeToggle />
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
            <a href={href('method')}>How it works</a>
            <a href={href('sql')}>SQL console</a>
            <a href={REPO_URL} target="_blank" rel="noreferrer">Source code</a>
          </div>
        </div>
      </footer>
    </div>
  )
}

function Providers({ worker, children }: { worker: WorkerBackend | null; children: ReactNode }) {
  const queryClient = useMemo(() => new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false, refetchOnWindowFocus: false } } }), [])
  const client = useMemo(() => makeClient(worker), [worker])
  return (
    <QueryClientProvider client={queryClient}>
      <TRPCProvider trpcClient={client} queryClient={queryClient}>{children}</TRPCProvider>
    </QueryClientProvider>
  )
}

/** Put the build-time results into the query cache before the first render. */
function SnapshotSeed({ snapshot, children }: { snapshot: Snapshot | null; children: ReactNode }) {
  const trpc = useTRPC()
  const queryClient = useQueryClient()
  const [seeded] = useState(() => {
    if (!snapshot) return false
    for (const e of snapshot.entries) {
      const proc = e.path.split('.').reduce<any>((o, k) => o[k], trpc) // eslint-disable-line @typescript-eslint/no-explicit-any
      queryClient.setQueryData(proc.queryKey(e.input), e.data)
    }
    return true
  })
  void seeded
  return <>{children}</>
}

function RuntimeProvider({ backend, steps, replayIntro, children }: { backend: WorkerBackend | null; steps: BootStep[]; replayIntro: () => void; children: ReactNode }) {
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
    <RuntimeCtx.Provider value={{ backend, steps, rerun, rerunning, notify, replayIntro }}>
      {children}
      {toast && <Toast message={toast} onDone={() => setToast(null)} />}
    </RuntimeCtx.Provider>
  )
}

const INTRO_KEY = 'peopleops-intro-seen'
const seenIntro = () => { try { return localStorage.getItem(INTRO_KEY) === '1' } catch { return false } }

/*
 * The database runs in a Web Worker, so it never blocks the page. The brief
 * renders straight from the build-time snapshot while the worker boots; the
 * intro fades out on a CSS timer (--intro).
 */
export default function App() {
  const remote = Boolean(import.meta.env.VITE_API_URL)
  const [steps, setSteps] = useState<BootStep[]>([])
  const [backend, setBackend] = useState<WorkerBackend | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [snapshotDone, setSnapshotDone] = useState(remote)
  const [intro, setIntro] = useState<'show' | 'leaving' | 'gone'>(remote ? 'gone' : 'show')
  const [replay, setReplay] = useState(0)
  const worker = useMemo(() => (remote ? null : startWorker(setSteps)), [remote])

  useEffect(() => { if (intro === 'gone') markIntroDone() }, [intro])
  // Safety net in case the intro's animationend never arrives.
  useEffect(() => { const t = setTimeout(markIntroDone, 6500); return () => clearTimeout(t) }, [])
  useEffect(() => {
    document.documentElement.style.setProperty('--intro', remote ? '0s' : seenIntro() ? '0.9s' : '4.6s')
    try { localStorage.setItem(INTRO_KEY, '1') } catch { /* storage unavailable */ }
  }, [remote])

  useEffect(() => {
    if (!worker) return
    worker.ready.then(() => setBackend(worker), setError)
    fetch(`${import.meta.env.BASE_URL}snapshot.json`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      // Render the brief behind the intro as interruptible work, so it never freezes the page.
      .then((s: Snapshot) => startTransition(() => setSnapshot(s)), () => {})
      .finally(() => startTransition(() => setSnapshotDone(true)))
  }, [worker])

  const fromSnapshot = snapshotDone && Boolean(snapshot)
  const canOpen = remote || Boolean(backend) || fromSnapshot
  const close = useCallback(() => {
    setIntro(i => (i === 'show' ? 'leaving' : i))
    setTimeout(() => setIntro('gone'), 500)
  }, [])
  // Without a snapshot the intro waits for the live database instead of its timer.
  useEffect(() => { if (intro === 'show' && backend && !fromSnapshot) close() }, [intro, backend, fromSnapshot, close])

  return (
    <Providers worker={worker}>
      <RuntimeProvider backend={backend} steps={steps} replayIntro={() => { setReplay(r => r + 1); setIntro('show') }}>
        {canOpen && (
          <SnapshotSeed snapshot={snapshot}>
            <EvidenceProvider render={(req, close) => (req ? <EvidenceDrawer {...req} onClose={close} /> : null)}>
              <Shell />
            </EvidenceProvider>
          </SnapshotSeed>
        )}
        {intro !== 'gone' && (
          <Intro
            key={replay}
            replay={replay > 0}
            steps={steps}
            snapshot={snapshot}
            auto={fromSnapshot || replay > 0}
            leaving={intro === 'leaving'}
            error={error}
            onSkip={() => { if (canOpen || replay > 0) close() }}
            onDone={() => setIntro('gone')}
          />
        )}
      </RuntimeProvider>
    </Providers>
  )
}
