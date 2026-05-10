import type { MarketPrice } from '@/lib/db/schema'

export interface ScoredHour {
  ts: Date
  priceEurMwh: number
  priceEurKwh: number
  rank: number // 1 = cheapest of the window
  category: 'golden' | 'cheap' | 'normal' | 'expensive' | 'spike' | 'free' | 'negative'
}

const FREE_THRESHOLD_EUR_MWH = 1
const NEGATIVE_THRESHOLD_EUR_MWH = 0

/**
 * Categorize a window of hourly prices into actionable buckets.
 *
 * Strategy:
 *  1. Absolute thresholds for free/negative (those override everything — they're our headline moments).
 *  2. Relative percentiles for the rest:
 *     - bottom 15% → golden (the 3-4 cheapest hours)
 *     - bottom 40% → cheap
 *     - top 15%    → spike
 *     - top 40%    → expensive
 *     - middle     → normal
 */
export function scoreHours(prices: MarketPrice[]): ScoredHour[] {
  if (prices.length === 0) return []

  const numeric = prices.map((p) => ({
    ts: p.ts instanceof Date ? p.ts : new Date(p.ts as unknown as string),
    priceEurMwh: Number(p.priceEurMwh),
  }))

  const sorted = [...numeric].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  const rankByTs = new Map<number, number>()
  sorted.forEach((row, idx) => rankByTs.set(row.ts.getTime(), idx + 1))

  const n = sorted.length
  const goldenCutoff = sorted[Math.max(0, Math.floor(n * 0.15) - 1)]?.priceEurMwh ?? Infinity
  const cheapCutoff = sorted[Math.max(0, Math.floor(n * 0.4) - 1)]?.priceEurMwh ?? Infinity
  const spikeCutoff = sorted[Math.max(0, Math.ceil(n * 0.85) - 1)]?.priceEurMwh ?? -Infinity
  const expensiveCutoff = sorted[Math.max(0, Math.ceil(n * 0.6) - 1)]?.priceEurMwh ?? -Infinity

  return numeric
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((row) => {
      const rank = rankByTs.get(row.ts.getTime()) ?? 0
      let category: ScoredHour['category'] = 'normal'
      if (row.priceEurMwh < NEGATIVE_THRESHOLD_EUR_MWH) category = 'negative'
      else if (row.priceEurMwh < FREE_THRESHOLD_EUR_MWH) category = 'free'
      else if (row.priceEurMwh <= goldenCutoff) category = 'golden'
      else if (row.priceEurMwh <= cheapCutoff) category = 'cheap'
      else if (row.priceEurMwh >= spikeCutoff) category = 'spike'
      else if (row.priceEurMwh >= expensiveCutoff) category = 'expensive'

      return {
        ts: row.ts,
        priceEurMwh: row.priceEurMwh,
        priceEurKwh: row.priceEurMwh / 1000,
        rank,
        category,
      }
    })
}

/**
 * Determine the single Next Best Action from a scored window:
 *   - if a free/negative hour is upcoming → "Charge everything at HH:MM"
 *   - else cheapest upcoming hour → "Cheapest in the next 24h is HH:MM at €0.04/kWh"
 */
export interface NextBestAction {
  kind: 'free' | 'cheap' | 'avoid'
  ts: Date
  priceEurKwh: number
  headline: string
  detail: string
}

export function nextBestAction(scored: ScoredHour[], now: Date = new Date()): NextBestAction | null {
  const upcoming = scored.filter((h) => h.ts.getTime() > now.getTime())
  if (upcoming.length === 0) return null

  const free = upcoming.find((h) => h.category === 'free' || h.category === 'negative')
  if (free) {
    return {
      kind: 'free',
      ts: free.ts,
      priceEurKwh: free.priceEurKwh,
      headline:
        free.category === 'negative'
          ? 'Energy will be NEGATIVE soon'
          : 'Energy will be FREE soon',
      detail: `At ${formatHourLocal(free.ts)} the wholesale price is ${centsKwh(free.priceEurKwh)}. Run your washer, dryer, and EV charge.`,
    }
  }

  const cheapest = [...upcoming].sort((a, b) => a.priceEurMwh - b.priceEurMwh)[0]!
  const spike = upcoming.find((h) => h.category === 'spike')

  if (spike && spike.ts.getTime() < cheapest.ts.getTime() + 6 * 3600 * 1000) {
    // A spike comes before the next cheap window — warn the user.
    return {
      kind: 'avoid',
      ts: spike.ts,
      priceEurKwh: spike.priceEurKwh,
      headline: 'Avoid heavy use at ' + formatHourLocal(spike.ts),
      detail: `Price will jump to ${centsKwh(spike.priceEurKwh)}. Wait until ${formatHourLocal(cheapest.ts)} (${centsKwh(cheapest.priceEurKwh)}).`,
    }
  }

  return {
    kind: 'cheap',
    ts: cheapest.ts,
    priceEurKwh: cheapest.priceEurKwh,
    headline: `Cheapest hour: ${formatHourLocal(cheapest.ts)}`,
    detail: `At ${centsKwh(cheapest.priceEurKwh)} you'll pay ${Math.round(((upcoming[0]!.priceEurKwh - cheapest.priceEurKwh) / Math.max(upcoming[0]!.priceEurKwh, 0.01)) * 100)}% less than right now.`,
  }
}

function centsKwh(eurKwh: number): string {
  return `${(eurKwh * 100).toFixed(2)}¢/kWh`
}

function formatHourLocal(ts: Date): string {
  return ts.toLocaleTimeString('pt-PT', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Europe/Lisbon',
  })
}
