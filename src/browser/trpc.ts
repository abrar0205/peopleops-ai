import { createTRPCClient, httpBatchLink } from '@trpc/client'
import { createTRPCContext } from '@trpc/tanstack-react-query'
import type { AppRouter } from '../api/router'
import { workerLink, type WorkerBackend } from './workerClient'

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>()

/**
 * With VITE_API_URL set, the UI talks to the Node server over HTTP.
 * Otherwise the same router runs in a Web Worker against the in-browser
 * database; calls made before it has booted simply wait for it.
 */
export function makeClient(backend: WorkerBackend | null) {
  const url = import.meta.env.VITE_API_URL as string | undefined
  return createTRPCClient<AppRouter>({
    links: [url || !backend ? httpBatchLink({ url: url ?? '/trpc' }) : workerLink(backend)],
  })
}

export type ApiClient = ReturnType<typeof makeClient>
