import { defineConfig } from 'drizzle-kit'

if (!process.env.DATABASE_URL) {
  // Allow drizzle-kit to be loaded without DB for type generation
  // eslint-disable-next-line no-console
  console.warn('[drizzle] DATABASE_URL not set — push/migrate will fail until configured.')
}

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './src/lib/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://placeholder',
  },
  strict: true,
  verbose: true,
})
