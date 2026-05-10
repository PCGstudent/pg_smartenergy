import { addDays } from 'date-fns'
import { and, between, sql } from 'drizzle-orm'
import { getDb } from '@/lib/db/client'
import { marketPrices } from '@/lib/db/schema'
import { upsertMarketPrices } from '@/lib/db/queries'
import { fetchOmieFile, parseOmie, toMarketPriceInserts } from './omie'

export interface BackfillResult {
  attempted: number
  fetched: number
  skipped: number
  failed: { date: string; error: string }[]
}

/**
 * Ensure OMIE day-ahead prices exist for every date in [startIso, endIso] (inclusive).
 * Idempotent: dates already in `market_prices` are skipped (we count rows per day).
 *
 * Used by the Auditor before computing savings — invoices may span periods we
 * haven't ingested yet (e.g. the user uploads a 90-day-old bill).
 */
export async function backfillOmieRange(
  startIso: string,
  endIso: string,
): Promise<BackfillResult> {
  const start = new Date(`${startIso}T00:00:00Z`)
  const end = new Date(`${endIso}T00:00:00Z`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error(`backfillOmieRange: bad dates ${startIso} → ${endIso}`)
  }
  if (end.getTime() < start.getTime()) {
    throw new Error(`backfillOmieRange: end before start`)
  }

  const result: BackfillResult = { attempted: 0, fetched: 0, skipped: 0, failed: [] }

  const existingDays = await getCoveredDays(start, addDays(end, 1))

  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    result.attempted++
    const key = d.toISOString().slice(0, 10)
    if (existingDays.has(key)) {
      result.skipped++
      continue
    }
    try {
      const text = await fetchOmieFile(d)
      const rows = parseOmie(text, d)
      await upsertMarketPrices(toMarketPriceInserts(rows))
      result.fetched++
    } catch (err) {
      result.failed.push({
        date: key,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }
  return result
}

/**
 * Set of YYYY-MM-DD strings (UTC) that already have ≥1 hourly row in market_prices.
 * Cheap heuristic: if a day has any rows we assume it's complete. Re-running the
 * fetch is harmless (idempotent upsert) so this just saves OMIE traffic.
 */
async function getCoveredDays(from: Date, to: Date): Promise<Set<string>> {
  const db = getDb()
  // Distinct YYYY-MM-DD across both zones in the window.
  const rows = await db
    .select({
      day: sql<string>`to_char(${marketPrices.ts} at time zone 'utc', 'YYYY-MM-DD')`.as('day'),
    })
    .from(marketPrices)
    .where(and(between(marketPrices.ts, from, to)))
    .groupBy(sql`to_char(${marketPrices.ts} at time zone 'utc', 'YYYY-MM-DD')`)

  return new Set(rows.map((r) => r.day))
}
