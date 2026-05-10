import { and, asc, between, desc, eq, gte } from 'drizzle-orm'
import { getDb } from './client'
import { marketPrices, priceForecasts, type MarketPrice } from './schema'

export type Zone = 'PT' | 'ES'

/**
 * Fetch hourly prices for a zone within [start, end).
 * Always ordered ascending by `ts`.
 */
export async function getPricesInRange(zone: Zone, start: Date, end: Date): Promise<MarketPrice[]> {
  const db = getDb()
  return db
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), between(marketPrices.ts, start, end)))
    .orderBy(asc(marketPrices.ts))
}

/**
 * Last-known prices for the next 48h window starting from `from`.
 * Falls back to forecasts where actuals don't yet exist.
 */
export async function getNext48h(zone: Zone, from: Date = new Date()) {
  const end = new Date(from.getTime() + 48 * 3600 * 1000)
  const actuals = await getPricesInRange(zone, from, end)
  return actuals
}

/** Latest hourly price (the "now" cell). */
export async function getCurrentPrice(zone: Zone): Promise<MarketPrice | null> {
  const db = getDb()
  const now = new Date()
  // round down to current hour boundary
  now.setUTCMinutes(0, 0, 0)
  const row = await db
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), eq(marketPrices.ts, now)))
    .limit(1)
  return row[0] ?? null
}

/** Bulk upsert. Used by the OMIE ingest job. */
export async function upsertMarketPrices(rows: (typeof marketPrices.$inferInsert)[]) {
  if (rows.length === 0) return { count: 0 }
  const db = getDb()
  await db
    .insert(marketPrices)
    .values(rows)
    .onConflictDoUpdate({
      target: [marketPrices.zone, marketPrices.ts],
      set: {
        priceEurMwh: marketPrices.priceEurMwh,
        source: marketPrices.source,
        fetchedAt: new Date(),
      },
    })
  return { count: rows.length }
}

/** Latest forecast for the next 24h (best model only). */
export async function getLatestForecast(zone: Zone, from: Date = new Date()) {
  const db = getDb()
  return db
    .select()
    .from(priceForecasts)
    .where(and(eq(priceForecasts.zone, zone), gte(priceForecasts.ts, from)))
    .orderBy(desc(priceForecasts.generatedAt), asc(priceForecasts.ts))
    .limit(48)
}
