/**
 * Monthly-saving estimator — pure, immutable, no I/O.
 *
 * Answers the onboarding question a new user actually cares about: "if I let Voltwise
 * time this load for me, how many EUROS do I save per MONTH?" — computed on the FINAL
 * customer price (OMIE + tariff markup + hourly TAR + taxes), never on raw OMIE.
 *
 * The comparison, per single run:
 *   - SMART cost  = charging in the cheapest feasible window for the day
 *                   (the `charge-planner` contiguous/interruptible optimum).
 *   - NAIVE cost  = charging at a TYPICAL/average hour within the same availability
 *                   window — i.e. the energy priced at the AVERAGE final €/kWh of the
 *                   feasible hours. This is the honest "I don't think about timing"
 *                   baseline: it is NOT the single worst hour (which would overstate the
 *                   gain), it is what charging "whenever I happen to plug in" costs on
 *                   average.
 *
 * Monthly saving = (naive − smart) per run × runs/month, floored at 0 (we never promise
 * a negative saving). We expose the per-run figures too so the UI can be transparent.
 *
 * PRODUCT RULE: every figure is € or €/kWh on the FINAL price.
 */

import { planChargeWindow, type HourlyFinalPrice } from './charge-planner'

export interface MonthlyEstimateInput {
  /** Hourly FINAL customer prices for a representative day (from `finalPricePerKwh`). */
  prices: HourlyFinalPrice[]
  /** Energy delivered per run, kWh. */
  energyKwh: number
  /** Appliance power draw, kW. */
  powerKw: number
  /**
   * Can the load be paused/resumed (cherry-pick scattered cheap slots)?
   * REQUIRED (not optional) on purpose: when omitted it would silently fall back to the
   * contiguous window and UNDERESTIMATE the smart saving for an interruptible load whose
   * cheapest run is dispersed. Callers must state it explicitly (false for washer/dryer,
   * the appliance's real flag for an EV).
   */
  interruptible: boolean
  /** Earliest allowed local start hour (0–24, inclusive). Default 0. */
  earliestHour?: number
  /** Latest local hour by which charging must finish (0–24, exclusive). Default 24. */
  latestHour?: number
  /** IANA zone for the availability hours (Europe/Lisbon PT, Europe/Madrid ES). */
  timeZone?: string
  /** Average number of runs per month (e.g. days/week × 52/12). */
  runsPerMonth: number
}

export interface MonthlyEstimate {
  /** Cost of ONE smart-timed run, € (FINAL price). */
  smartCostPerRunEur: number
  /** Cost of ONE naive (typical-hour) run, € (FINAL price). */
  naiveCostPerRunEur: number
  /** € saved on a SINGLE run by timing it (naive − smart, ≥ 0). */
  savingPerRunEur: number
  /** Average final €/kWh of the smart window. */
  smartAvgEurKwh: number
  /** Average final €/kWh across the feasible hours (the naive baseline rate). */
  naiveAvgEurKwh: number
  /** Projected MONTHLY € saving = savingPerRun × runsPerMonth (≥ 0). */
  monthlySavingEur: number
  /** Runs per month echoed back (clamped to ≥ 0). */
  runsPerMonth: number
  /** True when a feasible window exists and a real recommendation was produced. */
  feasible: boolean
}

/**
 * Default availability zone (PT). Callers MUST pass `timeZone: 'Europe/Madrid'` for ES
 * loads — an ES user's availability hours are Madrid wall-clock, and defaulting to Lisbon
 * would shift feasibility by the PT↔ES offset (1h in winter). The production caller
 * (`plan-monthly.ts`) always passes the zone explicitly; this default is a PT-only safety net.
 */
const DEFAULT_TZ = 'Europe/Lisbon'

/** Round to cents (2 dp) for euro amounts surfaced to users. */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** Round to 6 dp to kill FP dust on per-kWh rates without losing sub-cent honesty. */
function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

/**
 * Estimate the monthly € saving of letting the planner time a single load.
 *
 * Pure — does not mutate `input`. Returns a non-feasible, zeroed estimate when the load
 * cannot fit its availability window (so the UI can fall back gracefully).
 */
export function estimateMonthlySaving(input: MonthlyEstimateInput): MonthlyEstimate {
  const runsPerMonth = Math.max(0, input.runsPerMonth)
  const timeZone = input.timeZone ?? DEFAULT_TZ

  const plan = planChargeWindow({
    prices: input.prices,
    energyKwh: input.energyKwh,
    powerKw: input.powerKw,
    earliestHour: input.earliestHour,
    latestHour: input.latestHour,
    timeZone,
  })

  // The smart window: prefer interruptible when the load allows it AND it is cheaper.
  // `plan.contiguous?.totalEur ?? Infinity` makes a present interruptible window win when
  // NO contiguous window fits (dispersed slots only) — Infinity is the right "no contiguous
  // baseline to beat" sentinel. `interruptible` is required on the input, so a non-pausable
  // load deterministically takes the contiguous branch (no silent under-estimate).
  const smartWindow =
    input.interruptible && plan.interruptible && plan.interruptible.totalEur < (plan.contiguous?.totalEur ?? Infinity)
      ? plan.interruptible
      : plan.contiguous

  // The naive baseline rate = average FINAL €/kWh across the FEASIBLE hours (the set the
  // planner itself considered). Mirrors the optimizer's feasibility test exactly so we
  // compare like-for-like (same hours, smart vs typical).
  const naiveAvgEurKwh = averageFeasibleFinalEurKwh(
    input.prices,
    input.earliestHour ?? 0,
    input.latestHour ?? 24,
    timeZone,
  )

  if (smartWindow === null || naiveAvgEurKwh === null) {
    return {
      smartCostPerRunEur: 0,
      naiveCostPerRunEur: 0,
      savingPerRunEur: 0,
      smartAvgEurKwh: 0,
      naiveAvgEurKwh: 0,
      monthlySavingEur: 0,
      runsPerMonth,
      feasible: false,
    }
  }

  const smartCostPerRunEur = smartWindow.totalEur
  const naiveCostPerRunEur = naiveAvgEurKwh * input.energyKwh
  const savingPerRunEur = Math.max(0, naiveCostPerRunEur - smartCostPerRunEur)
  const monthlySavingEur = savingPerRunEur * runsPerMonth

  return {
    smartCostPerRunEur: round2(smartCostPerRunEur),
    naiveCostPerRunEur: round2(naiveCostPerRunEur),
    savingPerRunEur: round2(savingPerRunEur),
    smartAvgEurKwh: round6(smartWindow.avgEurKwh),
    naiveAvgEurKwh: round6(naiveAvgEurKwh),
    monthlySavingEur: round2(monthlySavingEur),
    runsPerMonth,
    feasible: true,
  }
}

/**
 * The simple arithmetic mean of FINAL €/kWh across the hours whose LOCAL start hour is in
 * [earliest, latest) and whose whole hour finishes by `latest` — the same feasibility rule
 * `charge-planner` applies. Returns null when no hour is feasible.
 *
 * A plain mean (not energy-weighted) is the right baseline here: "charge at a typical hour"
 * means each feasible hour is an equally likely plug-in time.
 */
function averageFeasibleFinalEurKwh(
  prices: HourlyFinalPrice[],
  earliest: number,
  latest: number,
  timeZone: string,
): number | null {
  const feasible = prices.filter((p) => {
    const h = localHour(p.ts, timeZone)
    return h >= earliest && h + 1 <= latest
  })
  if (feasible.length === 0) return null
  const sum = feasible.reduce((acc, p) => acc + p.finalEurKwh, 0)
  return sum / feasible.length
}

/** Local hour-of-day (0–23) for an instant in a given IANA zone. */
function localHour(ts: Date, timeZone: string): number {
  return Number(
    new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      timeZone,
    }).format(ts),
  )
}
