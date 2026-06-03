/**
 * Bridge the day plan → a MONTHLY saving teaser for the planner page. Pure, no I/O.
 *
 * The planner already computes each appliance's cheapest FINAL-price window for tomorrow.
 * This takes the PRIMARY appliance + the day's FINAL curve and projects a monthly € saving
 * (cheap-window timing vs charging at a typical hour) using a default cadence per appliance
 * type — because the appliance row stores no runs/week yet. Euros only, FINAL price only.
 */

import type { Appliance } from '@/lib/db/appliance-queries'
import { defaultDaysPerWeekForType, WEEKS_PER_MONTH } from '@/lib/onboarding/load-presets'
import type { CurvePoint, DayPlan } from './plan-builder'
import { primaryAppliance } from './plan-format'
import { estimateMonthlySaving } from './monthly-estimate'
import type { HourlyFinalPrice } from './charge-planner'

export interface MonthlySavingSummary {
  applianceLabel: string
  monthlySavingEur: number
  savingPerRunEur: number
  runsPerMonth: number
}

/** FINAL-price points → the hourly series the estimator consumes. */
function toFinalSeries(curve: CurvePoint[]): HourlyFinalPrice[] {
  return curve.map((c) => ({ ts: new Date(c.ts), finalEurKwh: c.finalEurKwh }))
}

/**
 * Compute the monthly-saving summary for a plan's primary load, or null when there is no
 * plan / no appliance / no feasible window. The caller decides whether the figure clears a
 * display floor.
 *
 * @param plan       the built day plan (FINAL curve + per-appliance windows)
 * @param appliances the user's ACTIVE appliances (decoded), to resolve cadence + window
 * @param timeZone   IANA zone for the availability hours (Europe/Lisbon PT, Europe/Madrid ES)
 */
export function buildMonthlySavingSummary(
  plan: DayPlan | null,
  appliances: Appliance[],
  timeZone: string,
): MonthlySavingSummary | null {
  if (!plan || plan.appliances.length === 0) return null

  const primary = primaryAppliance(plan.appliances)
  if (!primary) return null

  // Find the decoded appliance behind the primary window (for type cadence + availability).
  const source = appliances.find((a) => a.id === primary.applianceId)
  if (!source) return null

  const runsPerMonth = defaultDaysPerWeekForType(source.type) * WEEKS_PER_MONTH

  const estimate = estimateMonthlySaving({
    prices: toFinalSeries(plan.curve),
    energyKwh: source.energyKwh,
    powerKw: source.powerKw,
    interruptible: source.interruptible,
    earliestHour: source.earliestHour,
    latestHour: source.latestHour,
    timeZone,
    runsPerMonth,
  })

  if (!estimate.feasible) return null

  return {
    applianceLabel: source.label,
    monthlySavingEur: estimate.monthlySavingEur,
    savingPerRunEur: estimate.savingPerRunEur,
    runsPerMonth: estimate.runsPerMonth,
  }
}
