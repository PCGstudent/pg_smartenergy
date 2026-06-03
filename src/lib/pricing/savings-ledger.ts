/**
 * Per-day savings-ledger compute — pure, immutable, no I/O.
 *
 * Turns a built `DayPlan` + the user's active appliances into the EUROS that day's
 * smart-charging plan saves vs charging each load at a TYPICAL hour, summed across all
 * loads. This is the realized analogue of the monthly teaser: it reuses the exact same
 * naive-vs-smart per-run delta (`estimateMonthlySaving`) but for ONE run of each
 * appliance on the planned day (runsPerMonth = 1, so monthly == per-run == per-day).
 *
 * PRODUCT RULE: every figure is € on the FINAL customer price (OMIE + tariff markup +
 * hourly TAR + taxes), never raw €/MWh. The day's total is floored at 0 — we never
 * record a negative "saving".
 *
 * The runner persists the result via `upsertDailySaving`; the /plan and /dashboard
 * pages read the cumulative month/year total back. Kept framework-free + unit-tested
 * with hand-checked euros.
 */

import type { Appliance } from '@/lib/db/appliance-queries'
import type { SavingBreakdownEntry } from '@/lib/db/savings-queries'
import type { CurvePoint, DayPlan } from './plan-builder'
import { estimateMonthlySaving } from './monthly-estimate'
import type { HourlyFinalPrice } from './charge-planner'

/** The day's realized saving: a euro total + the per-appliance breakdown. */
export interface DailySavingResult {
  /** € saved that day across all active loads (FINAL price, floored at 0, 2 dp). */
  totalEur: number
  /** Per-appliance contributions (only loads that actually saved > 0 appear). */
  breakdown: SavingBreakdownEntry[]
}

/** Round to cents (2 dp) for euro amounts surfaced to / persisted for users. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** FINAL-price curve points → the hourly series the estimator consumes. */
function toFinalSeries(curve: CurvePoint[]): HourlyFinalPrice[] {
  return curve.map((c) => ({ ts: new Date(c.ts), finalEurKwh: c.finalEurKwh }))
}

/**
 * Compute one day's saving for a built plan, summed across the user's ACTIVE loads.
 *
 * Returns a zeroed result (empty breakdown) when there is no plan, no active appliance,
 * or no load saves anything (a flat day where timing buys nothing). The caller decides
 * whether to persist a zero day (we DO persist zeros so the ledger has one row/day and
 * the "since X" day-count stays honest).
 *
 * @param plan       the built day plan (FINAL curve + per-appliance windows)
 * @param appliances the user's ACTIVE appliances (decoded), for per-run timing + window
 * @param timeZone   IANA zone for the availability hours (Europe/Lisbon PT, Europe/Madrid ES)
 */
export function computeDailySaving(
  plan: DayPlan | null,
  appliances: Appliance[],
  timeZone: string,
): DailySavingResult {
  if (!plan || appliances.length === 0) {
    return { totalEur: 0, breakdown: [] }
  }

  const series = toFinalSeries(plan.curve)
  const breakdown: SavingBreakdownEntry[] = []
  let total = 0

  for (const appliance of appliances) {
    // One run of this appliance on the planned day: runsPerMonth = 1 makes the monthly
    // projection collapse to a single realized run's saving (naive − smart, ≥ 0).
    const estimate = estimateMonthlySaving({
      prices: series,
      energyKwh: appliance.energyKwh,
      powerKw: appliance.powerKw,
      interruptible: appliance.interruptible,
      earliestHour: appliance.earliestHour,
      latestHour: appliance.latestHour,
      timeZone,
      runsPerMonth: 1,
    })

    if (!estimate.feasible || estimate.savingPerRunEur <= 0) continue

    total += estimate.savingPerRunEur
    breakdown.push({
      appliance_id: appliance.id,
      label: appliance.label,
      saving_eur: estimate.savingPerRunEur,
    })
  }

  return { totalEur: round2(Math.max(0, total)), breakdown }
}
