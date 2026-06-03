/**
 * Backfill OMIE day-ahead prices for a date range.
 *
 * Usage:
 *   node scripts/backfill-prices.mjs [start] [end]
 *
 * Defaults: start = 2026-01-01, end = yesterday (UTC).
 * Dates must be in YYYY-MM-DD format.
 *
 * Examples:
 *   node scripts/backfill-prices.mjs              # full 2026 up to yesterday
 *   node scripts/backfill-prices.mjs 2025-01-01   # full 2025+2026
 *   node scripts/backfill-prices.mjs 2026-03-01 2026-03-31
 */

import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
if (!dbUrl) throw new Error('DATABASE_URL not found in .env.local')

const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

// ── date helpers ──────────────────────────────────────────────────────────────

function pad2(n) { return String(n).padStart(2, '0') }

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function yesterday() {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Convert Madrid local hour (0-based, 0..23) to UTC Date.
 * Madrid is UTC+1 (CET, winter) or UTC+2 (CEST, summer).
 * Uses Intl to correctly handle DST transitions.
 */
function madridLocalToUTC(year, month, day, localHour) {
  for (const offset of [2, 1]) {
    const utcHour = localHour - offset
    // Handle hour underflow (e.g. 00:00 Madrid in winter = 23:00 prev day UTC)
    const utc = new Date(Date.UTC(year, month - 1, day, utcHour))
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Madrid',
      hour: 'numeric',
      hour12: false,
    })
    const madridHour = parseInt(fmt.format(utc))
    if (madridHour === localHour || (localHour === 0 && madridHour === 24)) return utc
  }
  // Fallback
  return new Date(Date.UTC(year, month - 1, day, localHour - 1))
}

// ── Energy-Charts fallback (Fraunhofer ISE — free, no auth, full history) ────

async function fetchEnergyCharts(dateStr) {
  const start = `${dateStr}T00:00Z`
  const end   = `${dateStr}T23:59Z`
  const url = `https://api.energy-charts.info/price?bzn=ES&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  let res
  for (let attempt = 0; attempt < 3; attempt++) {
    res = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'Voltwise/0.1 (+https://voltwise.app)' },
    })
    if (res.status !== 429) break
    await new Promise(r => setTimeout(r, 4000 * (attempt + 1))) // 4s, 8s, 12s
  }
  if (!res.ok) throw new Error(`Energy-Charts HTTP ${res.status}`)
  const data = await res.json()
  if (!data.unix_seconds?.length || !data.price?.length) throw new Error('Energy-Charts: empty response')

  // Aggregate 15-min → hourly average
  const buckets = new Map()
  for (let i = 0; i < data.unix_seconds.length; i++) {
    const price = data.price[i]
    if (price == null || !Number.isFinite(price)) continue
    const hourKey = Math.floor(data.unix_seconds[i] / 3600) * 3600
    const b = buckets.get(hourKey) ?? { sum: 0, count: 0 }
    b.sum += price; b.count++
    buckets.set(hourKey, b)
  }
  if (buckets.size === 0) throw new Error('Energy-Charts: no valid prices')

  const rows = []
  for (const [hourUnix, { sum, count }] of buckets) {
    const ts = new Date(hourUnix * 1000)
    const price = sum / count
    rows.push({ ts, zone: 'ES', price })
    rows.push({ ts, zone: 'PT', price }) // MIBEL: PT≈ES price (diverges only on congestion)
  }
  return rows
}

// ── OMIE fetch + parse ────────────────────────────────────────────────────────

// Current OMIE download endpoint (the legacy /sites/default/files/dados/… path 404s now).
function omieUrl(dateStr) {
  const [yyyy, mm, dd] = dateStr.split('-')
  return `https://www.omie.es/es/file-download?parents=marginalpdbc&filename=marginalpdbc_${yyyy}${mm}${dd}.1`
}

async function fetchOmie(dateStr) {
  const url = omieUrl(dateStr)
  // fetch follows the endpoint's 302 redirect to the file automatically.
  const res = await fetch(url, {
    headers: { Accept: 'text/plain', 'User-Agent': 'Voltwise/0.1 (+https://voltwise.app)' },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const text = await res.text()
  if (!text || text.length < 50) throw new Error('Response too short')
  return text
}

// OMIE moved from 24 hourly periods to 96 quarter-hourly periods in 2026, and dropped the
// header date. Detect granularity from the max period index and average quarters into the hour.
function parseOmie(text, dateStr) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
  if (!lines[0]?.startsWith('MARGINALPDBC')) throw new Error('Missing MARGINALPDBC header')

  const raw = []
  let maxPeriod = 0
  for (const line of lines.slice(1)) {
    if (line.startsWith('*')) break
    const parts = line.split(';').map(p => p.trim()).filter(p => p !== '')
    if (parts.length < 6) continue
    const [yStr, mStr, dStr, pStr, esStr, ptStr] = parts
    if (!/^\d{4}$/.test(yStr)) continue

    const year = Number(yStr), month = Number(mStr), day = Number(dStr)
    const period = Number(pStr) // 1..24 hourly, or 1..96 quarter-hourly (±DST)
    if (Number.isNaN(period) || period < 1 || period > 100) continue

    const esPrice = parseFloat(esStr.replace(',', '.'))
    const ptPrice = parseFloat(ptStr.replace(',', '.'))
    if (!Number.isFinite(esPrice) || !Number.isFinite(ptPrice)) continue

    raw.push({ year, month, day, period, esPrice, ptPrice })
    if (period > maxPeriod) maxPeriod = period
  }
  if (raw.length === 0) throw new Error('No data rows parsed')

  const periodsPerHour = maxPeriod > 48 ? 4 : 1 // >48 ⇒ quarter-hourly
  const byHour = new Map()
  for (const r of raw) {
    const hour = Math.floor((r.period - 1) / periodsPerHour)
    const b = byHour.get(hour) ?? { y: r.year, m: r.month, d: r.day, hour, esSum: 0, ptSum: 0, n: 0 }
    b.esSum += r.esPrice; b.ptSum += r.ptPrice; b.n++
    byHour.set(hour, b)
  }

  const rows = []
  for (const h of [...byHour.values()].sort((a, b) => a.hour - b.hour)) {
    const ts = madridLocalToUTC(h.y, h.m, h.d, h.hour)
    rows.push({ ts, zone: 'ES', price: h.esSum / h.n })
    rows.push({ ts, zone: 'PT', price: h.ptSum / h.n })
  }
  return rows
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function getCoveredDays(startStr, endStr) {
  const rows = await sql`
    select distinct to_char(ts at time zone 'utc', 'YYYY-MM-DD') as day
    from public.market_prices
    where ts >= ${startStr + 'T00:00:00Z'}::timestamptz
      and ts <  ${addDays(endStr, 1) + 'T00:00:00Z'}::timestamptz
  `
  return new Set(rows.map(r => r.day))
}

async function upsertPrices(rows) {
  // postgres.js native multi-row: sql(array-of-arrays) → ($1,$2,...),($3,$4,...)
  const values = rows.map(r => [
    r.ts,                   // timestamptz — Date object
    r.zone,                 // text
    r.price.toFixed(4),     // numeric as string
    'OMIE_PBC',             // text
    new Date(),             // fetched_at
  ])
  await sql`
    insert into public.market_prices (ts, zone, price_eur_mwh, source, fetched_at)
    values ${sql(values)}
    on conflict (zone, ts) do update set
      price_eur_mwh = excluded.price_eur_mwh,
      source        = excluded.source,
      fetched_at    = now()
  `
}

// ── main ──────────────────────────────────────────────────────────────────────

const startArg = process.argv[2] ?? '2026-01-01'
const endArg   = process.argv[3] ?? yesterday()

console.log(`\n⚡ Voltwise price backfill: ${startArg} → ${endArg}\n`)

const covered = await getCoveredDays(startArg, endArg)
console.log(`   Already have data for ${covered.size} days in this range.\n`)

let fetched = 0, skipped = 0, failed = 0
let cur = startArg
while (cur <= endArg) {
  if (covered.has(cur)) {
    skipped++
  } else {
    process.stdout.write(`   ${cur} … `)
    try {
      let rows
      let source
      try {
        const text = await fetchOmie(cur)
        rows = parseOmie(text, cur)
        source = 'OMIE'
      } catch {
        rows = await fetchEnergyCharts(cur)
        source = 'EC'
      }
      await upsertPrices(rows)
      process.stdout.write(`✓ ${source} (${rows.length / 2} h)\n`)
      fetched++
    } catch (err) {
      process.stdout.write(`✗ ${err.message}\n`)
      failed++
    }
    // 600ms — Energy-Charts rate-limits at ~100 req/min
    await new Promise(r => setTimeout(r, 600))
  }
  cur = addDays(cur, 1)
}

await sql.end()
console.log(`\n✅ Done — fetched: ${fetched}, skipped: ${skipped}, failed: ${failed}`)
if (failed > 0) console.log('   Failed days are likely too old or not yet published by OMIE.')
