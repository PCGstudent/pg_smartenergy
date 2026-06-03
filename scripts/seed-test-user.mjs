/**
 * Seed (or refresh) the PT UX test user used by the dev-login bypass.
 *
 *   node scripts/seed-test-user.mjs
 *
 * Creates the auth user `ux-test@voltwise.local` (idempotent), marks the profile as a
 * fully-onboarded PT user, and upserts two demo loads so /plan renders a real plan:
 *
 *   • EV  — 40 kWh @ 7.4 kW, INTERRUPTIBLE, available overnight (00:00–08:00).
 *   • Washer — 1.0 kWh @ 1.0 kW, NOT interruptible, available anytime (00:00–24:00).
 *
 * EV availability window — IMPORTANT
 * ----------------------------------
 * The charge-window optimizer (`charge-planner.ts`) and the DB constraint
 * `earliest_hour < latest_hour` model availability as a SINGLE CONTIGUOUS local-hour
 * window. They cannot store a wrap-around like 21→07. A 40 kWh top-up at 7.4 kW needs
 * ceil(40 / 7.4) = 6 hourly slots, so the window MUST be ≥ 6h or the planner returns no
 * contiguous window. We therefore seed the deep-night VAZIO valley 00:00–08:00 (8h) —
 * the larger, cheaper half of a typical "after dinner until morning" availability and the
 * exact window the `overnight` onboarding preset produces (see load-presets.ts). This
 * guarantees the seeded demo shows a real cheapest-window recommendation, not the
 * availability-constrained fallback. Widen/shift it in the planner to demo the fallback.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and DATABASE_URL from
 * .env.local (same convention as scripts/backfill-prices.mjs).
 */

import postgres from 'postgres'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// ── env ─────────────────────────────────────────────────────────────────────
const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(join(__dirname, '../.env.local'), 'utf-8')

function env(key) {
  const m = envContent.match(new RegExp(`^${key}=(.+)$`, 'm'))
  return m?.[1]?.trim()
}

const supabaseUrl = env('NEXT_PUBLIC_SUPABASE_URL')
const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')
const dbUrl = env('DATABASE_URL')
if (!supabaseUrl) throw new Error('NEXT_PUBLIC_SUPABASE_URL not found in .env.local')
if (!serviceRoleKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY not found in .env.local')
if (!dbUrl) throw new Error('DATABASE_URL not found in .env.local')

const TEST_EMAIL = 'ux-test@voltwise.local'

// ── demo loads ────────────────────────────────────────────────────────────────
// EV window is 00:00–08:00 (8h ≥ the 6 slots a 40 kWh@7.4 kW top-up needs). See header.
const APPLIANCES = [
  {
    label: 'Carro elétrico',
    type: 'ev',
    energy_kwh: 40,
    power_kw: 7.4,
    typical_duration_min: 330,
    interruptible: true,
    earliest_hour: 0,
    latest_hour: 8,
  },
  {
    label: 'Máquina de lavar roupa',
    type: 'washer',
    energy_kwh: 1.0,
    power_kw: 1.0,
    typical_duration_min: 120,
    interruptible: false,
    earliest_hour: 0,
    latest_hour: 24,
  },
]

// ── resolve / create the auth user ────────────────────────────────────────────
const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

/** Find the test user by email, paging through the admin user list. */
async function findUserId(email) {
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase())
    if (hit) return hit.id
    if (data.users.length < 200) break // last page
  }
  return null
}

async function ensureUser(email) {
  const existing = await findUserId(email)
  if (existing) return { id: existing, created: false }

  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { seeded: true, purpose: 'ux-test' },
  })
  if (error) throw error
  return { id: data.user.id, created: true }
}

// ── main ──────────────────────────────────────────────────────────────────────
const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

try {
  console.log(`\n⚡ Seeding UX test user ${TEST_EMAIL}\n`)

  const { id: userId, created } = await ensureUser(TEST_EMAIL)
  console.log(`   auth user: ${userId} (${created ? 'created' : 'existing'})`)

  // Profile: fully-onboarded PT user. Upsert so re-runs stay idempotent.
  await sql`
    insert into public.profiles (id, country, display_name, locale, onboarded_at, created_at, updated_at)
    values (${userId}, 'PT', 'Voltwise UX Test', 'pt', now(), now(), now())
    on conflict (id) do update set
      country      = 'PT',
      display_name = 'Voltwise UX Test',
      locale       = 'pt',
      onboarded_at = coalesce(public.profiles.onboarded_at, now()),
      updated_at   = now()
  `
  console.log('   profile: PT, onboarded ✓')

  // Replace the seeded loads wholesale so the window edits below always take effect.
  await sql`delete from public.user_appliances where user_id = ${userId}`
  for (const a of APPLIANCES) {
    await sql`
      insert into public.user_appliances
        (user_id, label, type, energy_kwh, power_kw, typical_duration_min,
         interruptible, earliest_hour, latest_hour, active)
      values
        (${userId}, ${a.label}, ${a.type}, ${a.energy_kwh}, ${a.power_kw}, ${a.typical_duration_min},
         ${a.interruptible}, ${a.earliest_hour}, ${a.latest_hour}, true)
    `
    console.log(
      `   load: ${a.label} — ${a.energy_kwh}kWh @ ${a.power_kw}kW, window ${a.earliest_hour}h–${a.latest_hour}h ✓`,
    )
  }

  console.log('\n✅ Seed complete. Visit /api/dev-login?email=' + TEST_EMAIL + '&next=/plan\n')
} finally {
  await sql.end()
}
