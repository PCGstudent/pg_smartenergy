import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { getDb } from './client'
import { marketPrices, priceForecasts, type MarketPrice } from './schema'

export type Zone = 'PT' | 'ES'

export interface DailyAvg { day: string; avgEurMwh: number }
export interface HourlyAvg { hour: number; avgEurMwh: number }
export interface PeriodStats {
  avgEurMwh: number
  minEurMwh: number
  maxEurMwh: number
  negativePct: number  // % of hours with price < 0
  freePct: number      // % of hours with price <= 0
  cheapPct: number     // % of hours below 50 €/MWh
  totalHours: number
}

/** Daily average price for a zone over the last `days` days. */
export async function getMarketDailyAverages(zone: Zone, days = 90): Promise<DailyAvg[]> {
  const db = getDb()
  const since = new Date(Date.now() - days * 86400_000)
  const rows = await db
    .select({
      day: sql<string>`to_char(${marketPrices.ts} at time zone 'utc', 'YYYY-MM-DD')`.as('day'),
      avgEurMwh: sql<number>`round(avg(${marketPrices.priceEurMwh})::numeric, 2)`.as('avg'),
    })
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), gte(marketPrices.ts, since)))
    .groupBy(sql`to_char(${marketPrices.ts} at time zone 'utc', 'YYYY-MM-DD')`)
    .orderBy(sql`to_char(${marketPrices.ts} at time zone 'utc', 'YYYY-MM-DD')`)
  return rows.map(r => ({ day: r.day, avgEurMwh: Number(r.avgEurMwh) }))
}

/**
 * Average price by hour-of-day for a zone over the last `days` days, bucketed by the
 * LOCAL wall-clock hour of `timeZone`. PT and ES must pass their own zone — Lisbon and
 * Madrid differ by one hour, so sharing a timezone shifts every PT bar by an hour.
 */
export async function getMarketHourlyProfile(
  zone: Zone,
  days = 30,
  timeZone = 'Europe/Madrid',
): Promise<HourlyAvg[]> {
  const db = getDb()
  const since = new Date(Date.now() - days * 86400_000)
  // Drizzle re-serializes a reused `sql` fragment into a SEPARATE bind param each
  // time it's embedded, so passing the same `extract(... at time zone $tz)` object
  // into both the SELECT and GROUP BY emits `$tz` as two different placeholders.
  // Postgres then treats them as distinct expressions and rejects `ts` as not
  // grouped ("column market_prices.ts must appear in the GROUP BY clause").
  // Group/order by the SELECT ordinal (1) instead so the bucket expression appears
  // exactly once and the timezone is bound exactly once.
  const localHour = sql<number>`extract(hour from ${marketPrices.ts} at time zone ${timeZone})::int`
  const rows = await db
    .select({
      hour: localHour.as('hour'),
      avgEurMwh: sql<number>`round(avg(${marketPrices.priceEurMwh})::numeric, 2)`.as('avg'),
    })
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), gte(marketPrices.ts, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)
  return rows.map(r => ({ hour: Number(r.hour), avgEurMwh: Number(r.avgEurMwh) }))
}

/** Summary stats for a zone over the last `days` days. */
export async function getMarketPeriodStats(zone: Zone, days = 30): Promise<PeriodStats | null> {
  const db = getDb()
  const since = new Date(Date.now() - days * 86400_000)
  const [row] = await db
    .select({
      avg: sql<number>`round(avg(${marketPrices.priceEurMwh})::numeric, 2)`,
      min: sql<number>`round(min(${marketPrices.priceEurMwh})::numeric, 2)`,
      max: sql<number>`round(max(${marketPrices.priceEurMwh})::numeric, 2)`,
      negativePct: sql<number>`round(100.0 * sum(case when ${marketPrices.priceEurMwh} < 0 then 1 else 0 end)::numeric / count(*), 1)`,
      freePct: sql<number>`round(100.0 * sum(case when ${marketPrices.priceEurMwh} <= 0 then 1 else 0 end)::numeric / count(*), 1)`,
      cheapPct: sql<number>`round(100.0 * sum(case when ${marketPrices.priceEurMwh} < 50 then 1 else 0 end)::numeric / count(*), 1)`,
      total: sql<number>`count(*)`,
    })
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), gte(marketPrices.ts, since)))
  if (!row || !row.total) return null
  return {
    avgEurMwh: Number(row.avg),
    minEurMwh: Number(row.min),
    maxEurMwh: Number(row.max),
    negativePct: Number(row.negativePct),
    freePct: Number(row.freePct),
    cheapPct: Number(row.cheapPct),
    totalHours: Number(row.total),
  }
}

/**
 * Fetch hourly prices for a zone within [start, end) — `start` inclusive, `end` EXCLUSIVE.
 * A row whose `ts` equals exactly `end` is NOT returned. Always ordered ascending by `ts`.
 */
export async function getPricesInRange(zone: Zone, start: Date, end: Date): Promise<MarketPrice[]> {
  const db = getDb()
  return db
    .select()
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, zone), gte(marketPrices.ts, start), lt(marketPrices.ts, end)))
    .orderBy(asc(marketPrices.ts))
}

/**
 * Last-known prices for the next 48h window [from, from + 48h) — upper bound exclusive,
 * so the slot starting exactly 48h out is not included. Always ordered ascending by `ts`.
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
