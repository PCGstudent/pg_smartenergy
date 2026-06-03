import { describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { and, eq, gte, sql } from 'drizzle-orm'
import { marketPrices } from './schema'

/**
 * Regression guard for the getMarketHourlyProfile GROUP BY bug.
 *
 * Drizzle re-serializes a reused `sql` fragment into a NEW bind parameter every
 * time it's embedded. The original query passed one `extract(... at time zone $tz)`
 * fragment object into the SELECT, GROUP BY and ORDER BY, which emitted the
 * timezone as THREE separate placeholders. Postgres then saw the GROUP BY/ORDER BY
 * expressions as distinct from the SELECT and rejected `ts`:
 *   "column market_prices.ts must appear in the GROUP BY clause".
 *
 * The fix groups/orders by the SELECT ordinal (1) so the bucket expression — and
 * its timezone param — appears exactly once. We assert the generated SQL here so
 * the regression can't silently come back (the live page swallowed the error and
 * showed an empty chart).
 *
 * `postgres()` does not open a connection until a query runs, and `.toSQL()`
 * never queries — so this test needs no database.
 */

function buildHourlyProfileSql(timeZone: string) {
  const client = postgres('postgres://user:pass@localhost:5432/db', { prepare: false })
  const db = drizzle(client, { schema: { marketPrices } })
  const since = new Date('2026-05-01T00:00:00Z')
  const localHour = sql<number>`extract(hour from ${marketPrices.ts} at time zone ${timeZone})::int`
  const query = db
    .select({
      hour: localHour.as('hour'),
      avgEurMwh: sql<number>`round(avg(${marketPrices.priceEurMwh})::numeric, 2)`.as('avg'),
    })
    .from(marketPrices)
    .where(and(eq(marketPrices.zone, 'PT'), gte(marketPrices.ts, since)))
    .groupBy(sql`1`)
    .orderBy(sql`1`)
  return query.toSQL()
}

describe('getMarketHourlyProfile SQL shape', () => {
  it('groups and orders by the SELECT ordinal, not a duplicated expression', () => {
    const { sql: text } = buildHourlyProfileSql('Europe/Lisbon')
    expect(text).toMatch(/group by 1/i)
    expect(text).toMatch(/order by 1/i)
    // The fragile, duplicated form must NOT reappear in GROUP BY / ORDER BY.
    expect(text).not.toMatch(/group by extract/i)
    expect(text).not.toMatch(/order by extract/i)
  })

  it('binds the timezone exactly once (the root cause of the GROUP BY error)', () => {
    const { sql: text, params } = buildHourlyProfileSql('Europe/Madrid')
    // Exactly one occurrence of the timezone literal among the bound params.
    const tzCount = params.filter((p) => p === 'Europe/Madrid').length
    expect(tzCount).toBe(1)
    // And the SELECT still buckets by the local wall-clock hour (the tz is $1).
    expect(text).toMatch(/extract\(hour from "?ts"? at time zone \$1\)/i)
  })
})
