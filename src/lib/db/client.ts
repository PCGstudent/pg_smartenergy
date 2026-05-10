import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'

declare global {
  // eslint-disable-next-line no-var
  var __voltwise_pg__: ReturnType<typeof postgres> | undefined
}

function createClient() {
  const url = process.env.DATABASE_URL
  if (!url) {
    throw new Error(
      '[db] DATABASE_URL is not set. Add it to .env.local (Supabase → Project Settings → Database → Connection string).',
    )
  }
  // Single connection per pid in dev to avoid HMR connection leaks.
  // In production (Vercel serverless), each isolate gets its own.
  const client =
    global.__voltwise_pg__ ??
    postgres(url, {
      prepare: false, // recommended for transaction-pooler endpoints (Supabase)
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  if (process.env.NODE_ENV !== 'production') {
    global.__voltwise_pg__ = client
  }
  return client
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (!_db) {
    _db = drizzle(createClient(), { schema })
  }
  return _db
}

export { schema }
