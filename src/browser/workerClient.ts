import { TRPCClientError, type TRPCLink } from '@trpc/client'
import { observable } from '@trpc/server/observable'
import type { AppRouter } from '../api/router'
import type { BootStep } from './boot'
import type { InjectInfo, RunInfo, ToMain, ToWorker } from './protocol'

type Pending = { resolve: (v: unknown) => void; reject: (e: unknown) => void }
type Request = { type: 'call'; path: string; input: unknown } | { type: 'rerun' | 'inject' | 'restore' }

/** Page-side handle to the backend worker. */
export interface WorkerBackend {
  ready: Promise<{ bootMs: number }>
  call(path: string, input: unknown): Promise<unknown>
  rerun(): Promise<RunInfo>
  injectBrokenExtract(): Promise<InjectInfo>
  restore(): Promise<RunInfo>
}

export function startWorker(onSteps: (s: BootStep[]) => void): WorkerBackend {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'peopleops-db' })
  const pending = new Map<number, Pending>()
  let nextId = 1
  let resolveReady!: (v: { bootMs: number }) => void
  let rejectReady!: (e: unknown) => void
  const ready = new Promise<{ bootMs: number }>((res, rej) => { resolveReady = res; rejectReady = rej })
  ready.catch(() => {})

  worker.onmessage = (ev: MessageEvent<ToMain>) => {
    const m = ev.data
    if (m.type === 'steps') onSteps(m.steps)
    else if (m.type === 'ready') resolveReady({ bootMs: m.bootMs })
    else if (m.type === 'error') rejectReady(new Error(m.message))
    else if (m.type === 'result') {
      const p = pending.get(m.id)
      if (!p) return
      pending.delete(m.id)
      if (m.error) p.reject(Object.assign(new Error(m.error.message), { code: m.error.code }))
      else p.resolve(m.data)
    }
  }
  worker.onerror = e => rejectReady(new Error(e.message || 'The database worker failed to start'))

  const send = <T>(msg: Request): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      worker.postMessage({ ...msg, id } as ToWorker)
    })

  return {
    ready,
    call: (path, input) => send({ type: 'call', path, input }),
    rerun: () => send<RunInfo>({ type: 'rerun' }),
    injectBrokenExtract: () => send<InjectInfo>({ type: 'inject' }),
    restore: () => send<RunInfo>({ type: 'restore' }),
  }
}

/** tRPC link that runs every procedure in the backend worker. */
export function workerLink(backend: WorkerBackend): TRPCLink<AppRouter> {
  return () => ({ op }) =>
    observable(observer => {
      let cancelled = false
      backend.call(op.path, op.input).then(
        data => { if (!cancelled) { observer.next({ result: { type: 'data', data } }); observer.complete() } },
        err => { if (!cancelled) observer.error(TRPCClientError.from(err instanceof Error ? err : new Error(String(err)))) },
      )
      return () => { cancelled = true }
    })
}
