import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Read DATABASE_URL from .env.local
const envContent = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!dbUrl) throw new Error('DATABASE_URL not found in .env.local')

const migrationArg = process.argv[2] ?? 'supabase/migrations/0002_tariff_catalog.sql'
const sqlContent = readFileSync(join(__dirname, '..', migrationArg), 'utf-8')

const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

try {
  await sql.unsafe(sqlContent)
  console.log(`${migrationArg} applied successfully.`)
  const tariffs = await sql`select country, provider, name, type from public.tariffs order by country, provider`
  console.log(`Tariffs in DB (${tariffs.length} total):`)
  tariffs.forEach(t => console.log(`  [${t.country}] ${t.provider} — ${t.name} (${t.type})`))
} finally {
  await sql.end()
}
