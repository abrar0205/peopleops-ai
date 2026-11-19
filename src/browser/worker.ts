/// <reference lib="webworker" />
/**
 * The whole backend runs here, off the main thread: PGlite (PostgreSQL in
 * WebAssembly), migrations, the ingestion pipeline, Prisma Client and the tRPC
 * router. The page talks to it with postMessage (see workerClient.ts), so a
 * multi-second SQL statement never blocks a click, a scroll or an animation.
 */
import { bootBackend, type Backend } from './boot'
import { createCaller } from '../api/router'
import { withBrokenBatch } from '../domain/defects'
import type { RunSummary } from '../domain/pipeline'
import type { ToMain, ToWorker } from './protocol'

const post = (m: ToMain) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m)

const ready: Promise<Backend> = bootBackend(steps => post({ type: 'steps', steps })).then(
  b => { post({ type: 'ready', bootMs: b.bootMs }); return b },
  e => { post({ type: 'error', message: e instanceof Error ? e.message : String(e) }); throw e },
)
ready.catch(() => {})

const summary = (r: RunSummary) => ({ runId: r.runId, ms: r.ms })

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data
  try {
    const b = await ready
    if (m.type === 'call') {
      const caller = createCaller(b.ctx)
      const fn = m.path.split('.').reduce<any>((o, k) => o?.[k], caller) // eslint-disable-line @typescript-eslint/no-explicit-any
      if (typeof fn !== 'function') throw new Error(`No procedure ${m.path}`)
      post({ type: 'result', id: m.id, data: await fn(m.input) })
    } else if (m.type === 'rerun') {
      post({ type: 'result', id: m.id, data: summary(await b.rerun()) })
    } else if (m.type === 'inject') {
      const batch = withBrokenBatch(b.extracts)
      const run = await b.rerunWith(batch.extracts)
      post({ type: 'result', id: m.id, data: { ...summary(run), added: batch.added } })
    } else if (m.type === 'restore') {
      post({ type: 'result', id: m.id, data: summary(await b.rerun()) })
    }
  } catch (e) {
    const err = e as { message?: string; code?: string }
    post({ type: 'result', id: m.id, error: { message: err?.message ?? String(e), code: err?.code } })
  }
}
