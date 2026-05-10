import { unstable_noStore as noStore } from 'next/cache'
import { addHours } from 'date-fns'
import { getPricesInRange } from '@/lib/db/queries'
import type { Zone } from '@/lib/db/queries'
import type { MarketPrice } from '@/lib/db/schema'
import { nextBestAction, scoreHours } from '@/lib/pricing/golden-hours'
import { DashboardView } from '@/components/dashboard/dashboard-view'

export const dynamic = 'force-dynamic'
export const revalidate = 60

interface SearchParams {
  zone?: string
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  noStore()
  const { zone: zoneParam } = await searchParams
  const zone: Zone = zoneParam === 'ES' ? 'ES' : 'PT'

  // Window: 6h ago → +30h ahead, so the chart always shows context.
  const now = new Date()
  const start = addHours(now, -6)
  const end = addHours(now, 30)

  const prices = await safeFetchPrices(zone, start, end)
  const scored = scoreHours(prices)
  const action = nextBestAction(scored, now)

  // Serialize for client component (Date → ISO).
  const serialized = scored.map((s) => ({
    ts: s.ts.toISOString(),
    priceEurMwh: s.priceEurMwh,
    priceEurKwh: s.priceEurKwh,
    rank: s.rank,
    category: s.category,
  }))
  const serializedAction = action
    ? { ...action, ts: action.ts.toISOString() }
    : null

  return (
    <DashboardView
      zone={zone}
      hours={serialized}
      action={serializedAction}
      hasData={prices.length > 0}
    />
  )
}

/**
 * Fetch prices, but never throw out of the page render.
 * Empty array → the dashboard shows its empty-state CTA explaining how to ingest OMIE.
 */
async function safeFetchPrices(zone: Zone, start: Date, end: Date): Promise<MarketPrice[]> {
  try {
    return await getPricesInRange(zone, start, end)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[dashboard] price fetch failed (DB not configured?):', err)
    return []
  }
}
