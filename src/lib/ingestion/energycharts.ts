import type { MarketPriceInsert } from '@/lib/db/schema'

/**
 * Energy-Charts API fallback for day-ahead MIBEL prices.
 *
 * Source: Fraunhofer ISE (https://api.energy-charts.info)
 * - Free, no authentication required.
 * - Bidding zone ES covers the MIBEL Iberian market.
 * - Portugal and Spain share the same day-ahead price in MIBEL the vast
 *   majority of the time (market splitting only during congestion).
 * - Returns 15-minute interval data; we aggregate to hourly averages to match
 *   the OMIE PBC schema (one row per UTC hour per zone).
 */

const EC_BASE = 'https://api.energy-charts.info'

export class EnergyChartsFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'EnergyChartsFetchError'
  }
}

interface EnergyChartsResponse {
  license_info?: string
  unix_seconds: number[]
  price: (number | null)[]
}

/**
 * Fetch day-ahead prices for `date` (UTC day) from Energy-Charts.
 * Returns `MarketPriceInsert[]` for both PT and ES zones, hourly.
 */
export async function fetchEnergyChartsDay(
  date: Date,
  fetchImpl: typeof fetch = fetch,
): Promise<MarketPriceInsert[]> {
  const yyyy = date.getUTCFullYear()
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(date.getUTCDate()).padStart(2, '0')
  const start = `${yyyy}-${mm}-${dd}T00:00Z`
  const end = `${yyyy}-${mm}-${dd}T23:59Z`

  const url = `${EC_BASE}/price?bzn=ES&start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  const res = await fetchImpl(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Voltwise/0.1 (+https://voltwise.app)',
    },
    cache: 'no-store',
  })

  if (!res.ok) {
    throw new EnergyChartsFetchError(
      `Energy-Charts fetch failed for ${url}: HTTP ${res.status}`,
      res.status,
    )
  }

  const data: EnergyChartsResponse = await res.json()

  if (!data.unix_seconds?.length || !data.price?.length) {
    throw new EnergyChartsFetchError(
      `Energy-Charts returned empty data for ${yyyy}-${mm}-${dd}`,
    )
  }
  if (data.unix_seconds.length !== data.price.length) {
    throw new EnergyChartsFetchError('Energy-Charts data arrays have mismatched lengths')
  }

  // Aggregate 15-min intervals into hourly buckets (simple average).
  const hourlyBuckets = new Map<number, { sum: number; count: number }>()
  for (let i = 0; i < data.unix_seconds.length; i++) {
    const price = data.price[i]
    if (price == null || !Number.isFinite(price)) continue
    const unixSec = data.unix_seconds[i]
    if (unixSec == null) continue
    const hourBucket = Math.floor(unixSec / 3600) * 3600
    const bucket = hourlyBuckets.get(hourBucket) ?? { sum: 0, count: 0 }
    bucket.sum += price
    bucket.count++
    hourlyBuckets.set(hourBucket, bucket)
  }

  if (hourlyBuckets.size === 0) {
    throw new EnergyChartsFetchError(
      `No valid prices after aggregation for ${yyyy}-${mm}-${dd}`,
    )
  }

  const inserts: MarketPriceInsert[] = []
  for (const [hourUnix, { sum, count }] of hourlyBuckets) {
    const ts = new Date(hourUnix * 1000)
    const priceEurMwh = (sum / count).toFixed(4)
    inserts.push({ ts, zone: 'ES', priceEurMwh, source: 'ENERGY_CHARTS' })
    inserts.push({ ts, zone: 'PT', priceEurMwh, source: 'ENERGY_CHARTS' })
  }

  inserts.sort((a, b) => (a.ts as Date).getTime() - (b.ts as Date).getTime())
  return inserts
}
