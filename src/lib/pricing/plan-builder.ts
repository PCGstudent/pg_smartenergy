/**
 * Day-ahead PLAN builder — pure, immutable, no I/O.
 *
 * Turns raw OMIE day-ahead prices for "tomorrow" into:
 *   1. a FINAL customer €/kWh curve (OMIE + tariff markup + hourly TAR + taxes), and
 *   2. one optimal charge window per appliance (via `charge-planner.ts`).
 *
 * PRODUCT RULE: every recommendation here is computed on the FINAL price, never on
 * raw OMIE. The wholesale €/MWh number is kept ONLY to colour the chart bars in the
 * existing market visual language — it is never shown as a recommendation figure.
 *
 * The page layer (server component) fetches prices/tariff/appliances and serializes
 * the result for the client. This module does the math and stays framework-free.
 */

import type { Tariff } from '@/lib/db/schema'
import type { TariffCycle, CountingCycle } from './tar'
import { finalPricePerKwh } from './tariff-math'
import { planChargeWindow, type ChargePlanResult, type HourlyFinalPrice } from './charge-planner'

/** A raw market price row (what `getNext48h` / `getPricesInRange` return, narrowed). */
export interface MarketPriceLike {
  ts: Date
  /** Wholesale day-ahead price, €/MWh (string from numeric columns is accepted). */
  priceEurMwh: number | string
}

/** Minimal tariff shape `finalPricePerKwh` needs — what we read from the catalog/profile. */
export type PlanTariff = Pick<Tariff, 'id' | 'country' | 'type' | 'formula'>

/** One hour of the resolved curve: wholesale (chart only) + FINAL (recommendations). */
export interface CurvePoint {
  /** Hour start, UTC ISO. */
  ts: string
  /** Local HH:MM (Europe/Lisbon for PT, Europe/Madrid for ES). */
  localTime: string
  /** Local hour-of-day 0–23 (for axis ticks / window matching). */
  localHour: number
  /** Wholesale price €/MWh — CHART COLOUR ONLY, never a recommendation figure. */
  wholesaleEurMwh: number
  /** All-in customer price €/kWh (the honest number every recommendation uses). */
  finalEurKwh: number
}

/** A single appliance resolved to its best window (or null when nothing fits). */
export interface ApplianceWindow {
  applianceId: string
  label: string
  type: string
  energyKwh: number
  powerKw: number
  interruptible: boolean
  /** Full optimizer result (contiguous + interruptible + savings) for this load. */
  plan: ChargePlanResult
}

export interface DayPlan {
  /** The resolved FINAL price curve for the planned day. */
  curve: CurvePoint[]
  /** Cheapest FINAL €/kWh across the curve (headline "valley"). */
  cheapestEurKwh: number
  /** Most expensive FINAL €/kWh across the curve. */
  peakEurKwh: number
  /** Per-appliance optimal windows, in the input order. */
  appliances: ApplianceWindow[]
}

/** Appliance the builder maps to a window. Decoded numeric shape. */
export interface PlanAppliance {
  id: string
  label: string
  type: string
  energyKwh: number
  powerKw: number
  interruptible: boolean
  earliestHour: number
  latestHour: number
}

export interface BuildDayPlanInput {
  prices: MarketPriceLike[]
  tariff: PlanTariff
  appliances: PlanAppliance[]
  /** TAR cycle for the FINAL price (simples | bi | tri). Default 'simples'. */
  cycle?: TariffCycle
  /** Ciclo de contagem for TAR. Default 'diario'. */
  counting?: CountingCycle
  /** IANA zone for local labels. Default Europe/Lisbon. */
  timeZone?: string
}

const DEFAULT_TZ = 'Europe/Lisbon'

/**
 * Build the FINAL price curve and map every appliance to its cheapest window.
 * Pure — does not mutate inputs. Returns an empty-but-valid plan when `prices` is empty.
 */
export function buildDayPlan(input: BuildDayPlanInput): DayPlan {
  const cycle = input.cycle ?? 'simples'
  const counting = input.counting ?? 'diario'
  const timeZone = input.timeZone ?? DEFAULT_TZ

  const curve = buildCurve(input.prices, input.tariff, cycle, counting, timeZone)

  const finals = curve.map((c) => c.finalEurKwh)
  const cheapestEurKwh = finals.length > 0 ? Math.min(...finals) : 0
  const peakEurKwh = finals.length > 0 ? Math.max(...finals) : 0

  // The optimizer consumes the FINAL-price series (UTC ts + final €/kWh).
  const finalSeries: HourlyFinalPrice[] = curve.map((c) => ({
    ts: new Date(c.ts),
    finalEurKwh: c.finalEurKwh,
  }))

  const appliances = input.appliances.map((a) =>
    resolveApplianceWindow(a, finalSeries, timeZone),
  )

  return { curve, cheapestEurKwh, peakEurKwh, appliances }
}

/** Resolve one appliance against the FINAL series via the window optimizer. */
function resolveApplianceWindow(
  appliance: PlanAppliance,
  finalSeries: HourlyFinalPrice[],
  timeZone: string,
): ApplianceWindow {
  const plan = planChargeWindow({
    prices: finalSeries,
    energyKwh: appliance.energyKwh,
    powerKw: appliance.powerKw,
    earliestHour: appliance.earliestHour,
    latestHour: appliance.latestHour,
    timeZone,
  })
  return {
    applianceId: appliance.id,
    label: appliance.label,
    type: appliance.type,
    energyKwh: appliance.energyKwh,
    powerKw: appliance.powerKw,
    interruptible: appliance.interruptible,
    plan,
  }
}

/**
 * Build the resolved per-hour curve. Skips rows with a non-finite wholesale price.
 *
 * DST note: on a spring-forward day the local day is only 23h, so `prices` carries 23 rows
 * (one local hour does not exist); on a fall-back day it is 25h. Local labels are derived per
 * row via `Intl.DateTimeFormat` at the row's UTC instant, so they stay DST-correct regardless,
 * and the optimizer simply sees fewer/more feasible slots — no special-casing needed.
 */
function buildCurve(
  prices: MarketPriceLike[],
  tariff: PlanTariff,
  cycle: TariffCycle,
  counting: CountingCycle,
  timeZone: string,
): CurvePoint[] {
  const sorted = [...prices].sort((a, b) => a.ts.getTime() - b.ts.getTime())
  const out: CurvePoint[] = []
  for (const row of sorted) {
    const wholesaleEurMwh = Number(row.priceEurMwh)
    if (!Number.isFinite(wholesaleEurMwh)) continue
    const breakdown = finalPricePerKwh({
      tariff,
      marketEurMwh: wholesaleEurMwh,
      at: row.ts,
      cycle,
      counting,
    })
    out.push({
      ts: row.ts.toISOString(),
      localTime: localHhmm(row.ts, timeZone),
      localHour: localHour(row.ts, timeZone),
      wholesaleEurMwh,
      finalEurKwh: breakdown.finalEurKwh,
    })
  }
  return out
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

/** Local HH:MM for an instant in a given IANA zone. */
function localHhmm(ts: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone,
  }).format(ts)
}
