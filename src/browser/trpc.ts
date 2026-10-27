import { createTRPCClient, httpBatchLink, unstable_localLink } from '@trpc/client'
import { createTRPCContext } from '@trpc/tanstack-react-query'
import { appRouter, type AppRouter } from '../api/router'
import type { ApiContext } from '../api/context'

export const { TRPCProvider, useTRPC, useTRPCClient } = createTRPCContext<AppRouter>()

/**
 * With VITE_API_URL set, the UI talks to the Node server over HTTP.
 * Otherwise the same router runs in-process against the in-browser database.
 */
export function makeClient(ctx: ApiContext | null) {
  const url = import.meta.env.VITE_API_URL as string | undefined
  return createTRPCClient<AppRouter>({
    links: [url || !ctx ? httpBatchLink({ url: url ?? '/trpc' }) : unstable_localLink({ router: appRouter, createContext: async () => ctx })],
  })
}

export type ApiClient = ReturnType<typeof makeClient>
