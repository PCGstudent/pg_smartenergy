import type { MarketPrice } from '@/lib/db/schema'

export type HourCategory =
  | 'golden'
  | 'cheap'
  | 'normal'
  | 'expensive'
  | 'spike'
  | 'free'
  | 'negative'

export interface ScoredHour {
  ts: Date
  priceEurMwh: number
  priceEurKwh: number
  rank: number // 1 = cheapest of the window
  category: HourCategory
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
 *
 * NOTE: this ranks on WHOLESALE OMIE €/MWh. The output is correct for the wholesale
 * price chart and the public oracle, but it is NOT the customer's final price ordering.
 * For honest behavioural recommendations (which hour to run an appliance), rank on the
 * final customer price instead — see `scoreFinalHours` (PRODUCT RULE #2).
 */
export function scoreHours(prices: MarketPrice[]): ScoredHour[] {
  if (prices.length === 0) return []

  const valueByTs = new Map<number, number>()
  const rows: ValueRow[] = prices.map((p) => {
    const ts = p.ts instanceof Date ? p.ts : new Date(p.ts as unknown as string)
    const priceEurMwh = Number(p.priceEurMwh)
    valueByTs.set(ts.getTime(), priceEurMwh)
    return { ts, value: priceEurMwh }
  })

  return categorizeByValue(rows).map((scored) => {
    const priceEurMwh = valueByTs.get(scored.ts.getTime()) ?? 0
    return {
      ts: scored.ts,
      priceEurMwh,
      priceEurKwh: priceEurMwh / 1000,
      rank: scored.rank,
      category: scored.category,
    }
  })
}

/** A single hour scored on the FINAL customer price (€/kWh incl. TAR + taxes). */
export interface FinalScoredHour {
  ts: Date
  /** All-in customer price for the hour, €/kWh (from `finalPricePerKwh`). */
  finalEurKwh: number
  rank: number // 1 = cheapest of the window, by FINAL price
  category: HourCategory
}

export interface HourlyFinalPrice {
  ts: Date
  finalEurKwh: number
}

/**
 * Categorize a window of hourly prices by the FINAL customer price (€/kWh), the number a
 * recommendation must be honest about (OMIE + tariff markup + hourly TAR + taxes).
 *
 * Same bucketing strategy as `scoreHours`, but the free/negative absolute thresholds are
 * applied in €/kWh (1 €/MWh == 0.001 €/kWh). A final price is never negative once TAR and
 * the per-kWh excise are added, so in practice the `negative`/`free` buckets only fire for
 * the rare near-zero final hour; the relative buckets carry the ordering.
 *
 * PRODUCT RULE #2: behavioural recommendations ("run your washer at HH:MM") MUST be built
 * from this output, never from `scoreHours` (wholesale).
 */
export function scoreFinalHours(prices: HourlyFinalPrice[]): FinalScoredHour[] {
  if (prices.length === 0) return []

  const valueByTs = new Map<number, number>()
  const rows: ValueRow[] = prices.map((p) => {
    const ts = p.ts instanceof Date ? p.ts : new Date(p.ts as unknown as string)
    const finalEurKwh = Number(p.finalEurKwh)
    valueByTs.set(ts.getTime(), finalEurKwh)
    return { ts, value: finalEurKwh }
  })

  return categorizeByValue(rows, {
    free: FREE_THRESHOLD_EUR_MWH / 1000,
    negative: NEGATIVE_THRESHOLD_EUR_MWH / 1000,
  }).map((scored) => ({
    ts: scored.ts,
    finalEurKwh: valueByTs.get(scored.ts.getTime()) ?? 0,
    rank: scored.rank,
    category: scored.category,
  }))
}

// ---------------------------------------------------------------------------
// Next best action — structured, STRING-FREE. Copy lives in the component layer
// (PRODUCT RULE #3: all user-facing strings must be i18n'd in pt/es/en).
// ---------------------------------------------------------------------------

/**
 * The basis a recommendation was ranked on:
 *   - 'final'     → ranked on the customer's all-in €/kWh. Safe to give behavioural advice.
 *   - 'wholesale' → ranked on raw OMIE only (no tariff/cycle known, e.g. the public oracle).
 *                   The component MUST present this as informational, NOT as "run your
 *                   washer now", because the final-price ordering can differ (PRODUCT RULE #2).
 */
export type ActionBasis = 'final' | 'wholesale'

export type ActionKind = 'free' | 'cheap' | 'avoid'

/** Params the component needs to render localized copy. No pre-rendered strings here. */
export interface ActionParams {
  /** True when `kind === 'free'` and the price is actually negative (grid pays you). */
  negative?: boolean
  /** For 'cheap': how much cheaper the cheapest hour is vs the current/first upcoming hour (%). */
  savingsPct?: number
  /** For 'avoid': the cheaper alternative window to wait for. */
  alternativeTs?: Date
  alternativeEurKwh?: number
}

export interface NextBestAction {
  kind: ActionKind
  /** The hour the action points at (UTC instant). */
  ts: Date
  /** The €/kWh at that hour. For 'final' basis this is the all-in price; for 'wholesale', OMIE/1000. */
  priceEurKwh: number
  /** What the ranking was computed on — drives whether the component may give behavioural advice. */
  basis: ActionBasis
  params: ActionParams
}

/**
 * Next best action from WHOLESALE-scored hours (the public oracle / dashboard without a
 * known tariff). Ranks on OMIE. The component renders this informationally — it must NOT
 * tell the user to run appliances, because wholesale ordering ≠ final-price ordering.
 */
export function nextBestAction(scored: ScoredHour[], now: Date = new Date()): NextBestAction | null {
  return pickAction(
    scored.map((h) => ({ ts: h.ts, eurKwh: h.priceEurKwh, category: h.category })),
    now,
    'wholesale',
  )
}

/**
 * Next best action from FINAL-price-scored hours. Ranks on the all-in customer €/kWh, so
 * the component may safely give behavioural advice ("run your washer at HH:MM").
 */
export function nextBestActionFinal(
  scored: FinalScoredHour[],
  now: Date = new Date(),
): NextBestAction | null {
  return pickAction(
    scored.map((h) => ({ ts: h.ts, eurKwh: h.finalEurKwh, category: h.category })),
    now,
    'final',
  )
}

interface ActionCandidate {
  ts: Date
  eurKwh: number
  category: HourCategory
}

/** Shared selection logic for both bases. Returns structured data only — no strings. */
function pickAction(
  hours: ActionCandidate[],
  now: Date,
  basis: ActionBasis,
): NextBestAction | null {
  const upcoming = hours.filter((h) => h.ts.getTime() > now.getTime())
  if (upcoming.length === 0) return null

  const free = upcoming.find((h) => h.category === 'free' || h.category === 'negative')
  if (free) {
    return {
      kind: 'free',
      ts: free.ts,
      priceEurKwh: free.eurKwh,
      basis,
      params: { negative: free.category === 'negative' },
    }
  }

  const cheapest = [...upcoming].sort((a, b) => a.eurKwh - b.eurKwh)[0]!
  const spike = upcoming.find((h) => h.category === 'spike')

  if (spike && spike.ts.getTime() < cheapest.ts.getTime() + 6 * 3600 * 1000) {
    // A spike comes before the next cheap window — warn the user.
    return {
      kind: 'avoid',
      ts: spike.ts,
      priceEurKwh: spike.eurKwh,
      basis,
      params: { alternativeTs: cheapest.ts, alternativeEurKwh: cheapest.eurKwh },
    }
  }

  const first = upcoming[0]!
  const savingsPct = Math.round(
    ((first.eurKwh - cheapest.eurKwh) / Math.max(first.eurKwh, 0.01)) * 100,
  )
  return {
    kind: 'cheap',
    ts: cheapest.ts,
    priceEurKwh: cheapest.eurKwh,
    basis,
    params: { savingsPct },
  }
}

// ---------------------------------------------------------------------------
// Shared bucketing — value-agnostic so wholesale (€/MWh) and final (€/kWh) reuse it.
// ---------------------------------------------------------------------------

interface ValueRow {
  ts: Date
  value: number
}

interface CategorizedRow {
  ts: Date
  rank: number
  category: HourCategory
}

interface AbsoluteThresholds {
  free: number
  negative: number
}

/**
 * Categorize hourly values into buckets, returned in chronological order with a
 * cheapest-first rank. `thresholds` are the absolute free/negative cut-points in the SAME
 * unit as `value` (wholesale uses €/MWh, final uses €/kWh).
 */
function categorizeByValue(
  rows: ValueRow[],
  thresholds: AbsoluteThresholds = { free: FREE_THRESHOLD_EUR_MWH, negative: NEGATIVE_THRESHOLD_EUR_MWH },
): CategorizedRow[] {
  const sorted = [...rows].sort((a, b) => a.value - b.value)
  const rankByTs = new Map<number, number>()
  sorted.forEach((row, idx) => rankByTs.set(row.ts.getTime(), idx + 1))

  const n = sorted.length
  const goldenCutoff = sorted[Math.max(0, Math.floor(n * 0.15) - 1)]?.value ?? Infinity
  const cheapCutoff = sorted[Math.max(0, Math.floor(n * 0.4) - 1)]?.value ?? Infinity
  const spikeCutoff = sorted[Math.max(0, Math.ceil(n * 0.85) - 1)]?.value ?? -Infinity
  const expensiveCutoff = sorted[Math.max(0, Math.ceil(n * 0.6) - 1)]?.value ?? -Infinity

  return [...rows]
    .sort((a, b) => a.ts.getTime() - b.ts.getTime())
    .map((row) => ({
      ts: row.ts,
      rank: rankByTs.get(row.ts.getTime()) ?? 0,
      category: categoryFor(row.value, {
        goldenCutoff,
        cheapCutoff,
        spikeCutoff,
        expensiveCutoff,
        thresholds,
      }),
    }))
}

interface CategoryCutoffs {
  goldenCutoff: number
  cheapCutoff: number
  spikeCutoff: number
  expensiveCutoff: number
  thresholds: AbsoluteThresholds
}

function categoryFor(value: number, c: CategoryCutoffs): HourCategory {
  if (value < c.thresholds.negative) return 'negative'
  if (value < c.thresholds.free) return 'free'
  if (value <= c.goldenCutoff) return 'golden'
  if (value <= c.cheapCutoff) return 'cheap'
  if (value >= c.spikeCutoff) return 'spike'
  if (value >= c.expensiveCutoff) return 'expensive'
  return 'normal'
}
