/**
 * Pure volatility helpers for the dashboard "Volatility" card. No React, no I/O —
 * fully unit-testable.
 *
 * We report the ABSOLUTE spread between the cheapest and peak hour in ¢/kWh,
 * which stays meaningful even when the cheapest hour is free or negative. The old
 * card used a max/min ratio that collapsed to a useless "0.0×" on exactly the
 * negative-price days the product cares most about (and could print >100% spread).
 */

export interface VolatilityStats {
  /** Cheapest hour, ¢/kWh (can be ≤ 0 on free/negative days). */
  minCents: number
  /** Most expensive hour, ¢/kWh. */
  maxCents: number
  /** peak − cheapest, ¢/kWh. Always ≥ 0; well-defined for negative prices. */
  spreadCents: number
}

/** Within ±this many ¢/kWh of zero (or below) is treated as "free". */
export const FREE_CENTS_EPSILON = 0.05

/**
 * Derive volatility stats from a list of hourly final prices (€/kWh).
 * Returns all-zero stats for an empty input.
 */
export function deriveVolatility(pricesEurKwh: number[]): VolatilityStats {
  if (pricesEurKwh.length === 0) {
    return { minCents: 0, maxCents: 0, spreadCents: 0 }
  }
  const cents = pricesEurKwh.map((p) => p * 100)
  const minCents = Math.min(...cents)
  const maxCents = Math.max(...cents)
  return { minCents, maxCents, spreadCents: maxCents - minCents }
}

/**
 * Render a ¢/kWh figure, collapsing near-zero and negative values to `freeLabel`
 * so the card never shows an ugly "-0.00¢". Anything ≤ FREE_CENTS_EPSILON counts
 * as free, since the grid is effectively giving energy away at that point.
 */
export function formatCentsOrFree(cents: number, freeLabel: string): string {
  if (cents <= FREE_CENTS_EPSILON) return freeLabel
  return `${cents.toFixed(2)}¢`
}
