import { describe, expect, it } from 'vitest'
import { estimateMonthlySaving } from './monthly-estimate'
import type { HourlyFinalPrice } from './charge-planner'

/**
 * Hand-checked euro assertions for the onboarding monthly-saving teaser.
 *
 * Prices here are FINAL €/kWh fed DIRECTLY (the estimator consumes the final price; the
 * OMIE→final transform is `tariff-math`'s job and is tested there). WINTER day so
 * Europe/Lisbon == UTC: slot N starts 2026-01-14T0N:00:00Z = local 0N:00.
 */
const DAY = '2026-01-14'

/** 24 hourly FINAL-price slots from a price-by-local-hour map (default fills the rest). */
function day(prices: Partial<Record<number, number>>, fill: number): HourlyFinalPrice[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`),
    finalEurKwh: prices[h] ?? fill,
  }))
}

describe('estimateMonthlySaving — hand-checked euros (washer, anytime)', () => {
  // 3 kWh @ 1 kW = 3 contiguous slots. Cheap valley 02–04 @ 0.05, rest @ 0.30.
  const prices = day({ 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)

  it('smart cost = the 0.05 valley × 3 kWh = 0.15 €/run', () => {
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 4,
    })
    expect(est.feasible).toBe(true)
    expect(est.smartCostPerRunEur).toBeCloseTo(0.15, 2)
  })

  it('naive baseline = mean final across 24 feasible hours = 0.26875 €/kWh', () => {
    // (21 × 0.30 + 3 × 0.05) / 24 = 6.45 / 24 = 0.26875.
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 4,
    })
    expect(est.naiveAvgEurKwh).toBeCloseTo(0.26875, 6)
    // naive cost = 0.26875 × 3 = 0.80625 → rounded to cents.
    expect(est.naiveCostPerRunEur).toBeCloseTo(0.81, 2)
  })

  it('saving per run = 0.80625 − 0.15 = 0.65625 €', () => {
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 4,
    })
    expect(est.savingPerRunEur).toBeCloseTo(0.66, 2)
  })

  it('monthly saving = 0.65625 × 8 runs = 5.25 € (8 avoids a half-cent boundary)', () => {
    // 4 runs would land on 2.625 — a half-cent that floats to 2.62; 8 runs is exact.
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 8,
    })
    expect(est.monthlySavingEur).toBeCloseTo(5.25, 2)
  })
})

describe('estimateMonthlySaving — EV overnight (interruptible, 00–08)', () => {
  // Deep valley 01–05 @ 0.04, shoulders of the night @ 0.12, daytime @ 0.30.
  // EV: 16 kWh @ 4 kW = 4 slots, interruptible, available 00:00–08:00 only.
  const prices = day(
    { 0: 0.12, 1: 0.04, 2: 0.04, 3: 0.04, 4: 0.04, 5: 0.04, 6: 0.12, 7: 0.12 },
    0.3,
  )

  it('smart picks the 4 cheapest night slots (all 0.04) = 16 × 0.04 = 0.64 €', () => {
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 16,
      powerKw: 4,
      interruptible: true,
      earliestHour: 0,
      latestHour: 8,
      runsPerMonth: 20,
    })
    expect(est.feasible).toBe(true)
    // 4 slots × 4 kWh × 0.04 = 0.64.
    expect(est.smartCostPerRunEur).toBeCloseTo(0.64, 2)
  })

  it('naive baseline averages only the 8 feasible night hours, not the whole day', () => {
    // Feasible hours 00..07: (0.12 + 5×0.04 + 0.12 + 0.12) / 8 = (0.12+0.20+0.12+0.12)/8
    //   = 0.56 / 8 = 0.07.  Daytime 0.30 must NOT leak in.
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 16,
      powerKw: 4,
      interruptible: true,
      earliestHour: 0,
      latestHour: 8,
      runsPerMonth: 20,
    })
    expect(est.naiveAvgEurKwh).toBeCloseTo(0.07, 6)
    // naive cost = 0.07 × 16 = 1.12.
    expect(est.naiveCostPerRunEur).toBeCloseTo(1.12, 2)
  })

  it('monthly saving = (1.12 − 0.64) × 20 = 9.60 €', () => {
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 16,
      powerKw: 4,
      interruptible: true,
      earliestHour: 0,
      latestHour: 8,
      runsPerMonth: 20,
    })
    expect(est.savingPerRunEur).toBeCloseTo(0.48, 2)
    expect(est.monthlySavingEur).toBeCloseTo(9.6, 2)
  })
})

describe('estimateMonthlySaving — interruptible window must win when slots are dispersed', () => {
  // Regression guard for the `interruptible` footgun: two cheap hours (02 & 06) with an
  // expensive gap between them. 2 kWh @ 1 kW = 2 slots. No contiguous 2-slot run can grab
  // BOTH cheap hours (its neighbour is always 0.30), but a PAUSABLE load can cherry-pick
  // them. If `interruptible` were falsy the smart window would fall back to the cheapest
  // contiguous pair (0.04 + 0.30 = 0.34) and silently UNDER-estimate the saving.
  const prices = day({ 2: 0.04, 6: 0.04 }, 0.3)

  it('interruptible=true picks the two dispersed 0.04 hours = 0.08 €/run', () => {
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 2,
      powerKw: 1,
      interruptible: true,
      runsPerMonth: 4,
    })
    expect(est.feasible).toBe(true)
    expect(est.smartCostPerRunEur).toBeCloseTo(0.08, 2)
  })

  it('interruptible=false falls back to the cheapest contiguous pair = 0.34 €/run', () => {
    // Same prices, non-pausable: best adjacent pair is one cheap + one 0.30 hour.
    const est = estimateMonthlySaving({
      prices,
      energyKwh: 2,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 4,
    })
    expect(est.feasible).toBe(true)
    expect(est.smartCostPerRunEur).toBeCloseTo(0.34, 2)
  })
})

describe('estimateMonthlySaving — edge cases', () => {
  it('flat prices → zero saving (smart == naive), still feasible', () => {
    const est = estimateMonthlySaving({
      prices: day({}, 0.2),
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 10,
    })
    expect(est.feasible).toBe(true)
    expect(est.savingPerRunEur).toBeCloseTo(0, 2)
    expect(est.monthlySavingEur).toBeCloseTo(0, 2)
  })

  it('never reports a negative monthly saving', () => {
    // Contrived: only one feasible hour means smart == naive == that hour.
    const est = estimateMonthlySaving({
      prices: day({ 10: 0.5 }, 0.1),
      energyKwh: 1,
      powerKw: 1,
      interruptible: false,
      earliestHour: 10,
      latestHour: 11,
      runsPerMonth: 30,
    })
    expect(est.monthlySavingEur).toBeGreaterThanOrEqual(0)
  })

  it('non-feasible load (cannot fit window) → zeroed, feasible=false', () => {
    // 3 slots needed but only a 2h window (10–12) is available.
    const est = estimateMonthlySaving({
      prices: day({}, 0.2),
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      earliestHour: 10,
      latestHour: 12,
      runsPerMonth: 10,
    })
    expect(est.feasible).toBe(false)
    expect(est.monthlySavingEur).toBe(0)
  })

  it('clamps a negative runsPerMonth to 0', () => {
    const est = estimateMonthlySaving({
      prices: day({ 2: 0.05 }, 0.3),
      energyKwh: 1,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: -5,
    })
    expect(est.runsPerMonth).toBe(0)
    expect(est.monthlySavingEur).toBe(0)
  })

  it('empty prices → non-feasible', () => {
    const est = estimateMonthlySaving({
      prices: [],
      energyKwh: 3,
      powerKw: 1,
      interruptible: false,
      runsPerMonth: 10,
    })
    expect(est.feasible).toBe(false)
  })
})
