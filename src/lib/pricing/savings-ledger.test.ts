import { describe, expect, it } from 'vitest'
import { computeDailySaving } from './savings-ledger'
import type { DayPlan, CurvePoint } from './plan-builder'
import type { Appliance } from '@/lib/db/appliance-queries'

/**
 * Hand-checked euro assertions for the per-day savings ledger.
 *
 * `computeDailySaving` reuses `estimateMonthlySaving` with runsPerMonth = 1, so the day's
 * saving for one load == that load's single-run (naive − smart) delta. Prices here are
 * FINAL €/kWh fed directly via the plan curve (the OMIE→final transform is tariff-math's
 * job, tested there). WINTER day so Europe/Lisbon == UTC: slot N starts at local 0N:00.
 */
const DAY = '2026-01-14'
const TZ = 'Europe/Lisbon'

/** Build a FINAL-price plan curve from a price-by-local-hour map (default fills the rest). */
function curve(prices: Partial<Record<number, number>>, fill: number): CurvePoint[] {
  return Array.from({ length: 24 }, (_, h) => {
    const finalEurKwh = prices[h] ?? fill
    return {
      ts: `${DAY}T${String(h).padStart(2, '0')}:00:00.000Z`,
      localTime: `${String(h).padStart(2, '0')}:00`,
      localHour: h,
      wholesaleEurMwh: 0, // chart-only, irrelevant to the saving math
      finalEurKwh,
    }
  })
}

/** A DayPlan carrying only the curve (computeDailySaving derives its series from it). */
function planFrom(c: CurvePoint[]): DayPlan {
  const finals = c.map((p) => p.finalEurKwh)
  return {
    curve: c,
    cheapestEurKwh: Math.min(...finals),
    peakEurKwh: Math.max(...finals),
    appliances: [],
  }
}

/** A decoded appliance fixture with overridable fields. */
function appliance(over: Partial<Appliance> & Pick<Appliance, 'id' | 'label'>): Appliance {
  return {
    id: over.id,
    userId: 'user-1',
    label: over.label,
    type: over.type ?? 'washer',
    energyKwh: over.energyKwh ?? 3,
    powerKw: over.powerKw ?? 1,
    typicalDurationMin: over.typicalDurationMin ?? null,
    interruptible: over.interruptible ?? false,
    earliestHour: over.earliestHour ?? 0,
    latestHour: over.latestHour ?? 24,
    active: over.active ?? true,
    createdAt: `${DAY}T00:00:00.000Z`,
    updatedAt: `${DAY}T00:00:00.000Z`,
  }
}

describe('computeDailySaving — single washer (hand-checked euros)', () => {
  // 3 kWh @ 1 kW = 3 contiguous slots. Cheap valley 02–04 @ 0.05 €/kWh, rest @ 0.30.
  const c = curve({ 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)
  const plan = planFrom(c)
  const washer = appliance({ id: 'w1', label: 'Washer', energyKwh: 3, powerKw: 1 })

  it('day saving = naive (0.80625) − smart (0.15) = 0.66 € (rounded)', () => {
    // smart = 0.05 × 3 = 0.15. naive = mean final (0.26875) × 3 = 0.80625. delta ≈ 0.65625.
    const result = computeDailySaving(plan, [washer], TZ)
    expect(result.totalEur).toBeCloseTo(0.66, 2)
  })

  it('records a single breakdown entry for the load that saved', () => {
    const result = computeDailySaving(plan, [washer], TZ)
    expect(result.breakdown).toHaveLength(1)
    expect(result.breakdown[0]!.appliance_id).toBe('w1')
    expect(result.breakdown[0]!.label).toBe('Washer')
    expect(result.breakdown[0]!.saving_eur).toBeCloseTo(0.66, 2)
  })
})

describe('computeDailySaving — sums across multiple loads', () => {
  const c = curve({ 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)
  const plan = planFrom(c)

  it('totals each load saving and lists each in the breakdown', () => {
    // Two identical 3 kWh washers. Each per-run saving is rounded to cents (0.66) by the
    // estimator BEFORE we sum, so the day total is 0.66 + 0.66 = 1.32 (not 2×0.65625).
    const a = appliance({ id: 'w1', label: 'Washer A', energyKwh: 3, powerKw: 1 })
    const b = appliance({ id: 'w2', label: 'Washer B', energyKwh: 3, powerKw: 1 })
    const result = computeDailySaving(plan, [a, b], TZ)
    expect(result.breakdown).toHaveLength(2)
    expect(result.breakdown[0]!.saving_eur).toBeCloseTo(0.66, 2)
    expect(result.totalEur).toBeCloseTo(1.32, 2)
  })
})

describe('computeDailySaving — zero / guard cases', () => {
  it('returns zero with an empty breakdown on a perfectly flat day', () => {
    const flat = planFrom(curve({}, 0.2)) // every hour identical → no timing gain
    const washer = appliance({ id: 'w1', label: 'Washer' })
    const result = computeDailySaving(flat, [washer], TZ)
    expect(result.totalEur).toBe(0)
    expect(result.breakdown).toEqual([])
  })

  it('omits loads that save nothing but keeps those that do', () => {
    const c = curve({ 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)
    const plan = planFrom(c)
    // A load that can only run in the expensive 12–13 window saves nothing vs that window's
    // own mean; the valley washer still does. Only the saver appears in the breakdown.
    const saver = appliance({ id: 'w1', label: 'Saver', energyKwh: 3, powerKw: 1 })
    const stuck = appliance({
      id: 'w2',
      label: 'Stuck',
      energyKwh: 1,
      powerKw: 1,
      earliestHour: 12,
      latestHour: 13,
    })
    const result = computeDailySaving(plan, [saver, stuck], TZ)
    const ids = result.breakdown.map((b) => b.appliance_id)
    expect(ids).toContain('w1')
    expect(ids).not.toContain('w2')
  })

  it('returns zero when there is no plan or no appliances', () => {
    expect(computeDailySaving(null, [appliance({ id: 'w1', label: 'W' })], TZ)).toEqual({
      totalEur: 0,
      breakdown: [],
    })
    expect(computeDailySaving(planFrom(curve({}, 0.2)), [], TZ)).toEqual({
      totalEur: 0,
      breakdown: [],
    })
  })
})
