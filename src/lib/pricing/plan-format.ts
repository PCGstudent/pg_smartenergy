/**
 * Presentation helpers for the planner — euros only, never €/MWh.
 *
 * Pure formatting/derivation used by the plan UI. Kept framework-free and tested:
 * window labels ("14h–15h"), euro/cent strings, FINAL-price bar colour thresholds,
 * and primary-load selection. All amounts are € or €/kWh per the product rule.
 */

import type { ChargeWindow } from './charge-planner'
import type { ApplianceWindow } from './plan-builder'

/** FINAL-price colour buckets in €/kWh, mirroring market-charts' wholesale palette intent. */
export const FINAL_PRICE_THRESHOLDS = {
  cheap: 0.1, // < 0.10 €/kWh → green
  normal: 0.18, // < 0.18 €/kWh → amber; ≥ → red
} as const

/** Bar colour for a FINAL €/kWh value (cyan free, green cheap, amber normal, red dear). */
export function finalBarColor(finalEurKwh: number): string {
  if (finalEurKwh <= 0) return '#22d3ee'
  if (finalEurKwh < FINAL_PRICE_THRESHOLDS.cheap) return '#4ade80'
  if (finalEurKwh < FINAL_PRICE_THRESHOLDS.normal) return '#facc15'
  return '#f87171'
}

/** "14h" from "14:00" / "14:30" → "14h30". Compact local-hour label for windows. */
export function compactHourLabel(localHhmm: string): string {
  const [h, m] = localHhmm.split(':')
  const hour = (h ?? '0').replace(/^0/, '') || '0'
  return m && m !== '00' ? `${hour}h${m}` : `${hour}h`
}

/** "14h–16h" window range label from a ChargeWindow's local start/end. */
export function windowRangeLabel(window: ChargeWindow): string {
  return `${compactHourLabel(window.startLocal)}–${compactHourLabel(window.endLocal)}`
}

/** Format a euro amount with 2 decimals + symbol, e.g. 1.5 → "1,50 €" style left to locale. */
export function euros(amount: number, locale = 'pt-PT'): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

/** €/kWh with cents precision, e.g. 0.0761 → "0,076 €/kWh" (3 dp keeps sub-cent honesty). */
export function eurPerKwh(value: number, locale = 'pt-PT'): string {
  const n = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(value)
  return `${n} €/kWh`
}

/**
 * Pick the "primary" load for the header card: the active appliance whose plan saves
 * the most euros vs its worst feasible window. Ties / no-savings fall back to the first
 * appliance that has a feasible window, then the first appliance overall.
 */
export function primaryAppliance(appliances: ApplianceWindow[]): ApplianceWindow | null {
  if (appliances.length === 0) return null
  const withWindow = appliances.filter((a) => a.plan.contiguous !== null)
  if (withWindow.length === 0) return appliances[0] ?? null

  return withWindow.reduce((best, cur) =>
    bestSaving(cur) > bestSaving(best) ? cur : best,
  )
}

/** The headline € saving for an appliance = max(savedVsWorst, interruptible bonus). */
export function bestSaving(a: ApplianceWindow): number {
  const contiguousSaving = a.plan.savedVsWorstEur
  const interruptibleTotalSaving = a.plan.interruptible
    ? a.plan.savedVsWorstEur + a.plan.interruptibleSavingEur
    : 0
  return Math.max(contiguousSaving, interruptibleTotalSaving)
}

/**
 * The window we recommend for an appliance: the interruptible slot-set when it's
 * meaningfully cheaper AND the load is interruptible; otherwise the contiguous window.
 * When neither fits the availability window, falls back to the N cheapest hours of the
 * whole day (`fallbackCheapest`) so the user always gets an actionable window — use
 * `isOutsideAvailability(a)` to badge that case and offer a "widen hours" affordance.
 */
export function recommendedWindow(a: ApplianceWindow): ChargeWindow | null {
  if (
    a.interruptible &&
    a.plan.interruptible &&
    a.plan.interruptibleSavingEur > 0
  ) {
    return a.plan.interruptible
  }
  return a.plan.contiguous ?? a.plan.fallbackCheapest
}

/**
 * True when the recommended window is the whole-day fallback because the appliance's
 * availability window was too narrow to fit the load. The UI uses this to label the
 * window as "outside your hours" and surface a widen-hours affordance.
 */
export function isOutsideAvailability(a: ApplianceWindow): boolean {
  return a.plan.availabilityConstrained && a.plan.contiguous === null
}
