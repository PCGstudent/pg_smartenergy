/**
 * One-shot setup to run AFTER you put a live Supabase into .env.local.
 *
 *   node scripts/setup-after-supabase.mjs
 *
 * It is idempotent — safe to re-run. Steps:
 *   1. Read DATABASE_URL from .env.local and connect (fails clearly if the project is down).
 *   2. Apply every migration 0001→0005 in order (each is `if not exists`, so re-runs are safe).
 *   3. Report the tariff catalog and make sure each country has an indexed default for /plan.
 *   4. Ingest OMIE day-ahead prices for today + tomorrow (Energy-Charts fallback) so /plan
 *      has a curve to show.
 *   5. Print exactly what to do next.
 *
 * No secrets are printed. Read-only on your data except the migrations + price upserts.
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { execFileSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// ── 0. Read DATABASE_URL ────────────────────────────────────────────────────────
const envPath = join(ROOT, '.env.local')
let dbUrl
try {
  const env = readFileSync(envPath, 'utf-8')
  dbUrl = env.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
} catch {
  fail(`Could not read ${envPath}. Is the file there?`)
}
if (!dbUrl || dbUrl.includes('PROJECT') || dbUrl.includes('PASSWORD')) {
  fail(
    'DATABASE_URL in .env.local is missing or still a placeholder.\n' +
    '   → Restore/create your Supabase project, then paste the real connection string\n' +
    '     (Project Settings → Database → Connection string → "Transaction pooler", port 6543).',
  )
}

const sql = postgres(dbUrl, { ssl: 'require', prepare: false, connect_timeout: 15 })

function fail(msg) {
  console.error(`\n❌ ${msg}\n`)
  process.exit(1)
}
function step(n, label) {
  console.log(`\n── ${n}. ${label} ${'─'.repeat(Math.max(0, 48 - label.length))}`)
}

const MIGRATIONS = [
  '0001_init.sql',
  '0002_tariff_catalog.sql',
  '0003_tariff_updates_q2_2026.sql',
  '0004_profile_contracted_kva.sql',
  '0005_user_appliances.sql',
]

async function main() {
  // ── 1. Connectivity ───────────────────────────────────────────────────────────
  step(1, 'Checking Supabase connection')
  try {
    const [{ now }] = await sql`select now() as now`
    console.log(`   ✓ Connected. Server time: ${now.toISOString()}`)
  } catch (err) {
    fail(
      `Could not connect to the database: ${err.message}\n` +
      '   → If the host does not resolve, the Supabase project is paused/deleted.\n' +
      '     Go to supabase.com → Restore the project (or create a new one) and update .env.local.',
    )
  }

  // ── 2. Migrations ─────────────────────────────────────────────────────────────
  step(2, 'Applying migrations (idempotent)')
  for (const m of MIGRATIONS) {
    const path = join(ROOT, 'supabase', 'migrations', m)
    process.stdout.write(`   ${m} … `)
    try {
      const ddl = readFileSync(path, 'utf-8')
      await sql.unsafe(ddl)
      console.log('✓')
    } catch (err) {
      console.log('✗')
      fail(`Migration ${m} failed: ${err.message}\n   → Fix the cause, then re-run this script (it resumes safely).`)
    }
  }

  // ── 3. Tariff catalog + indexed default per country ───────────────────────────
  step(3, 'Verifying tariff catalog')
  const tariffs = await sql`select country, type, count(*)::int as n from public.tariffs group by country, type order by country, type`
  if (tariffs.length === 0) {
    console.log('   ⚠ No tariffs found — the seeds in 0002/0003 may not have applied. Check above.')
  } else {
    for (const t of tariffs) console.log(`   [${t.country}] ${t.type}: ${t.n}`)
  }
  for (const country of ['PT', 'ES']) {
    const [{ n }] = await sql`select count(*)::int as n from public.tariffs where country=${country} and type='indexed'`
    if (n > 0) console.log(`   ✓ ${country} has ${n} indexed tariff(s) — /plan + onboarding can pick a default.`)
    else console.log(`   ⚠ ${country} has NO indexed tariff — onboarding will route to /settings instead of /plan.`)
  }

  // ── 4. Ingest today + tomorrow prices ─────────────────────────────────────────
  step(4, 'Ingesting OMIE prices (today + tomorrow)')
  const today = new Date()
  const t0 = today.toISOString().slice(0, 10)
  const t1 = new Date(today.getTime() + 86400_000).toISOString().slice(0, 10)
  try {
    // Reuse the corrected backfill script (OMIE new endpoint + Energy-Charts fallback).
    execFileSync('node', ['scripts/backfill-prices.mjs', t0, t1], { cwd: ROOT, stdio: 'inherit' })
  } catch {
    console.log('   ⚠ Price ingest reported issues (see above). Tomorrow may not be published yet —')
    console.log('     the day-ahead auction posts ~13:00 Madrid. /plan shows an empty state until then.')
  }
  const [{ n: priceCount }] = await sql`
    select count(*)::int as n from public.market_prices
    where ts >= ${t0 + 'T00:00:00Z'}::timestamptz
  `
  console.log(`   market_prices rows from ${t0} onward: ${priceCount}`)

  // ── 5. Next steps ─────────────────────────────────────────────────────────────
  step(5, 'Done — next steps')
  console.log(`
   1. Start the app (from this folder, OUTSIDE OneDrive):
        npm run dev
   2. Open http://localhost:3000 → sign in (magic link to your email).
   3. Complete onboarding: pick country → describe an EV load (e.g. 40 kWh, 22h–07h).
   4. You'll land on /plan with tomorrow's cheapest charging window in euros.

   If /plan shows "prices pending", tomorrow's day-ahead isn't published yet
   (posts ~13:00 Madrid). Re-run this script later, or: node scripts/backfill-prices.mjs ${t1} ${t1}
`)

  await sql.end()
}

main().catch(async (err) => {
  console.error(`\n❌ Unexpected error: ${err.message}`)
  try { await sql.end() } catch {}
  process.exit(1)
})
