/**
 * Server mode: the same tRPC router the browser demo runs in-process, served
 * over HTTP with Prisma Client on node-postgres.
 *   DATABASE_URL=... npm run server   ->  http://localhost:3001/trpc
 */
import { createHTTPServer } from '@trpc/server/adapters/standalone'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client'
import { appRouter } from '../src/api/router'
import { createContext } from '../src/api/context'
import { databaseUrl } from './db'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl() }) })
const ctx = createContext(prisma)
const port = Number(process.env.PORT ?? 3001)
const origin = process.env.CORS_ORIGIN ?? 'http://localhost:5173'

createHTTPServer({
  router: appRouter,
  basePath: '/trpc/',
  createContext: async () => ctx,
  middleware: (req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Access-Control-Allow-Headers', 'content-type, trpc-accept')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') {
      res.statusCode = 204
      res.end()
      return
    }
    next()
  },
}).listen(port)

console.log(`tRPC API on http://localhost:${port}/trpc (CORS origin ${origin})`)
