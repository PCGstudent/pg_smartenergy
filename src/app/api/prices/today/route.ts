import { NextResponse } from 'next/server'
import { addHours } from 'date-fns'
import { getPricesInRange, type Zone } from '@/lib/db/queries'
import { scoreHours } from '@/lib/pricing/golden-hours'

/**
 * GET /api/prices/today?zone=PT|ES
 * Returns the next ~36h of hourly prices, scored.
 * Cache: 60s on the edge.
 */
export const revalidate = 60
export const runtime = 'nodejs'

export async function GET(req: Request) {
  const url = new URL(req.url)
  const zoneParam = url.searchParams.get('zone')?.toUpperCase()
  const zone: Zone = zoneParam === 'ES' ? 'ES' : 'PT'

  const now = new Date()
  const start = addHours(now, -6)
  const end = addHours(now, 30)

  try {
    const prices = await getPricesInRange(zone, start, end)
    const scored = scoreHours(prices)
    return NextResponse.json(
      {
        zone,
        generatedAt: now.toISOString(),
        count: scored.length,
        hours: scored.map((s) => ({
          ts: s.ts.toISOString(),
          priceEurMwh: s.priceEurMwh,
          priceEurKwh: s.priceEurKwh,
          rank: s.rank,
          category: s.category,
        })),
      },
      {
        headers: {
          'Cache-Control': 's-maxage=60, stale-while-revalidate=120',
        },
      },
    )
  } catch (err) {
    return NextResponse.json(
      {
        error: 'Failed to fetch prices',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    )
  }
}
