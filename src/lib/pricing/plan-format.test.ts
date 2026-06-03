import { describe, expect, it } from 'vitest'
import { planChargeWindow, type HourlyFinalPrice } from './charge-planner'
import type { ApplianceWindow } from './plan-builder'
import {
  bestSaving,
  compactHourLabel,
  euros,
  eurPerKwh,
  finalBarColor,
  isOutsideAvailability,
  primaryAppliance,
  recommendedWindow,
  windowRangeLabel,
} from './plan-format'

const DAY = '2026-01-14' // winter Wednesday → Lisbon == UTC.

function day(prices: Partial<Record<number, number>>, fill: number): HourlyFinalPrice[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`),
    finalEurKwh: prices[h] ?? fill,
  }))
}

/** Build a realistic ApplianceWindow by running the real optimizer. */
function applianceWindow(
  overrides: Partial<ApplianceWindow> & {
    prices: HourlyFinalPrice[]
    energyKwh: number
    powerKw: number
    interruptible: boolean
    earliestHour?: number
    latestHour?: number
  },
): ApplianceWindow {
  const plan = planChargeWindow({
    prices: overrides.prices,
    energyKwh: overrides.energyKwh,
    powerKw: overrides.powerKw,
    earliestHour: overrides.earliestHour,
    latestHour: overrides.latestHour,
  })
  return {
    applianceId: overrides.applianceId ?? 'a1',
    label: overrides.label ?? 'Appliance',
    type: overrides.type ?? 'washer',
    energyKwh: overrides.energyKwh,
    powerKw: overrides.powerKw,
    interruptible: overrides.interruptible,
    plan,
  }
}

describe('compactHourLabel', () => {
  it('drops the leading zero and the :00 minutes', () => {
    expect(compactHourLabel('02:00')).toBe('2h')
    expect(compactHourLabel('14:00')).toBe('14h')
  })
  it('keeps non-zero minutes', () => {
    expect(compactHourLabel('09:30')).toBe('9h30')
    expect(compactHourLabel('00:15')).toBe('0h15')
  })
})

describe('windowRangeLabel', () => {
  it('renders "Hh–Hh" from the window local bounds', () => {
    const a = applianceWindow({ prices: day({ 2: 0.05, 3: 0.05 }, 0.3), energyKwh: 2, powerKw: 1, interruptible: false })
    expect(windowRangeLabel(a.plan.contiguous!)).toBe('2h–4h')
  })
})

describe('finalBarColor — €/kWh thresholds', () => {
  it('cyan when free/negative, green cheap, amber normal, red dear', () => {
    expect(finalBarColor(-0.01)).toBe('#22d3ee')
    expect(finalBarColor(0)).toBe('#22d3ee')
    expect(finalBarColor(0.05)).toBe('#4ade80')
    expect(finalBarColor(0.12)).toBe('#facc15')
    expect(finalBarColor(0.25)).toBe('#f87171')
  })
})

describe('recommendedWindow', () => {
  it('uses the contiguous window for a non-interruptible load', () => {
    // Scattered cheap hours, but the load runs in one go → contiguous.
    const a = applianceWindow({
      prices: day({ 3: 0.05, 14: 0.05 }, 0.3),
      energyKwh: 2,
      powerKw: 1,
      interruptible: false,
    })
    expect(recommendedWindow(a)).toBe(a.plan.contiguous)
  })

  it('prefers the interruptible set when the load is interruptible AND it saves', () => {
    const a = applianceWindow({
      prices: day({ 3: 0.05, 14: 0.05 }, 0.3),
      energyKwh: 2,
      powerKw: 1,
      interruptible: true,
    })
    expect(a.plan.interruptibleSavingEur).toBeGreaterThan(0)
    expect(recommendedWindow(a)).toBe(a.plan.interruptible)
  })

  it('falls back to contiguous when interruptible saves nothing (already adjacent)', () => {
    const a = applianceWindow({
      prices: day({ 3: 0.05, 4: 0.05 }, 0.3),
      energyKwh: 2,
      powerKw: 1,
      interruptible: true,
    })
    expect(a.plan.interruptibleSavingEur).toBeCloseTo(0, 6)
    expect(recommendedWindow(a)).toBe(a.plan.contiguous)
  })

  it('falls back to the whole-day cheapest set when the availability window is too narrow', () => {
    // EV-shaped: needs 4 slots but only 22:00–24:00 (2 slots) is available.
    const a = applianceWindow({
      type: 'ev',
      prices: day({ 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.05 }, 0.3),
      energyKwh: 40,
      powerKw: 11,
      earliestHour: 22,
      latestHour: 24,
      interruptible: true,
    })
    expect(a.plan.contiguous).toBeNull()
    expect(a.plan.interruptible).toBeNull()
    expect(a.plan.fallbackCheapest).not.toBeNull()
    // recommendedWindow surfaces the fallback instead of returning null.
    expect(recommendedWindow(a)).toBe(a.plan.fallbackCheapest)
  })
})

describe('isOutsideAvailability', () => {
  it('is true when the only window is the availability-constrained fallback', () => {
    const a = applianceWindow({
      type: 'ev',
      prices: day({ 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.05 }, 0.3),
      energyKwh: 40,
      powerKw: 11,
      earliestHour: 22,
      latestHour: 24,
      interruptible: true,
    })
    expect(isOutsideAvailability(a)).toBe(true)
  })

  it('is false for a normal appliance with a real feasible window', () => {
    const a = applianceWindow({
      prices: day({ 2: 0.05, 3: 0.05 }, 0.3),
      energyKwh: 2,
      powerKw: 1,
      interruptible: false,
    })
    expect(a.plan.contiguous).not.toBeNull()
    expect(isOutsideAvailability(a)).toBe(false)
  })
})

describe('bestSaving', () => {
  it('is the contiguous saving for a one-go load', () => {
    const a = applianceWindow({ prices: day({ 2: 0.05, 3: 0.05 }, 0.3), energyKwh: 2, powerKw: 1, interruptible: false })
    // worst 2-run = 0.60, best = 0.10 → saved 0.50.
    expect(bestSaving(a)).toBeCloseTo(0.5, 6)
  })

  it('adds the interruptible bonus for a pausable load', () => {
    const a = applianceWindow({ prices: day({ 3: 0.05, 14: 0.05 }, 0.3), energyKwh: 2, powerKw: 1, interruptible: true })
    // savedVsWorst (contiguous) + interruptible extra.
    const expected = a.plan.savedVsWorstEur + a.plan.interruptibleSavingEur
    expect(bestSaving(a)).toBeCloseTo(expected, 6)
    expect(bestSaving(a)).toBeGreaterThan(a.plan.savedVsWorstEur)
  })
})

describe('primaryAppliance', () => {
  it('returns null for an empty list', () => {
    expect(primaryAppliance([])).toBeNull()
  })

  it('picks the appliance with the largest € saving', () => {
    const small = applianceWindow({
      applianceId: 'small',
      prices: day({ 2: 0.2, 3: 0.2 }, 0.3),
      energyKwh: 2,
      powerKw: 1,
      interruptible: false,
    })
    const big = applianceWindow({
      applianceId: 'big',
      prices: day({ 2: 0.01, 3: 0.01 }, 0.9),
      energyKwh: 2,
      powerKw: 1,
      interruptible: false,
    })
    expect(primaryAppliance([small, big])!.applianceId).toBe('big')
    expect(primaryAppliance([big, small])!.applianceId).toBe('big')
  })

  it('prefers an appliance that has a feasible window over one that does not', () => {
    const noWindow = applianceWindow({
      applianceId: 'nofit',
      prices: day({}, 0.3),
      energyKwh: 3,
      powerKw: 1,
      earliestHour: 10,
      latestHour: 12, // only 2 slots available, needs 3 → null
      interruptible: false,
    })
    const fits = applianceWindow({
      applianceId: 'fits',
      prices: day({ 2: 0.05 }, 0.3),
      energyKwh: 1,
      powerKw: 1,
      interruptible: false,
    })
    expect(noWindow.plan.contiguous).toBeNull()
    expect(primaryAppliance([noWindow, fits])!.applianceId).toBe('fits')
  })
})

describe('euro formatting (Portuguese locale)', () => {
  it('euros() renders 2-dp currency', () => {
    // pt-PT formats with a comma decimal and a non-breaking space before the symbol.
    const s = euros(1.5, 'pt-PT')
    expect(s).toMatch(/1,50/)
    expect(s).toContain('€')
  })

  it('eurPerKwh() renders 3-dp €/kWh', () => {
    const s = eurPerKwh(0.0761, 'pt-PT')
    expect(s).toMatch(/0,076/)
    expect(s).toContain('€/kWh')
  })
})
