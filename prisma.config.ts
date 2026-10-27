import { defineConfig } from 'prisma/config'

// DATABASE_URL is only needed for `prisma migrate deploy` (server mode).
// The browser demo and the tests apply the same migration files to PGlite.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://peopleops:peopleops@localhost:5432/peopleops' },
})
