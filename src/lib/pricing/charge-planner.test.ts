import { describe, expect, it } from 'vitest'
import { planChargeWindow, type HourlyFinalPrice } from './charge-planner'

// Use a WINTER day so Europe/Lisbon == UTC (offset 0): local hour == UTC hour.
// 2026-01-14 is a Wednesday. Slot N starts at 2026-01-14T0N:00:00Z = local 0N:00.
const DAY = '2026-01-14'

/** Build 24 hourly final-price slots from a price-by-local-hour map (default fills the rest). */
function day(prices: Partial<Record<number, number>>, fill: number): HourlyFinalPrice[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`),
    finalEurKwh: prices[h] ?? fill,
  }))
}

describe('planChargeWindow — flat prices', () => {
  it('every window costs the same; no savings, picks the earliest', () => {
    const res = planChargeWindow({ prices: day({}, 0.2), energyKwh: 3, powerKw: 1 })
    expect(res.slotsNeeded).toBe(3)
    expect(res.contiguous).not.toBeNull()
    expect(res.contiguous!.totalEur).toBeCloseTo(0.6, 6) // 3 × 1kWh × 0.20
    expect(res.contiguous!.avgEurKwh).toBeCloseTo(0.2, 6)
    expect(res.contiguous!.startLocal).toBe('00:00') // earliest tie-break
    expect(res.contiguous!.endLocal).toBe('03:00')
    expect(res.savedVsWorstEur).toBeCloseTo(0, 6)
    expect(res.interruptibleSavingEur).toBeCloseTo(0, 6)
  })
})

describe('planChargeWindow — one obvious cheap valley', () => {
  const prices = day({ 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)

  it('finds the valley as the cheapest contiguous window', () => {
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    expect(res.contiguous!.startLocal).toBe('02:00')
    expect(res.contiguous!.endLocal).toBe('05:00')
    expect(res.contiguous!.totalEur).toBeCloseTo(0.15, 6) // 3 × 0.05
    expect(res.contiguous!.avgEurKwh).toBeCloseTo(0.05, 6)
  })

  it('saves vs the most expensive feasible window', () => {
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    // Worst 3-consecutive run is all-0.30 → 0.90. Saved = 0.90 − 0.15 = 0.75.
    expect(res.worstContiguous!.totalEur).toBeCloseTo(0.9, 6)
    expect(res.savedVsWorstEur).toBeCloseTo(0.75, 6)
  })

  it('interruptible matches contiguous when the cheapest slots are already adjacent', () => {
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    expect(res.interruptible!.totalEur).toBeCloseTo(0.15, 6)
    expect(res.interruptibleSavingEur).toBeCloseTo(0, 6)
  })
})

describe('planChargeWindow — availability constraint excludes the global minimum', () => {
  it('ignores the 02:00 valley and charges in the allowed window', () => {
    // Global min is 0.01 at 02:00, but the user is only available 08:00–20:00.
    const prices = day({ 2: 0.01, 3: 0.01, 10: 0.1, 11: 0.1 }, 0.25)
    const res = planChargeWindow({
      prices,
      energyKwh: 2,
      powerKw: 1,
      earliestHour: 8,
      latestHour: 20,
    })
    expect(res.contiguous!.startLocal).toBe('10:00')
    expect(res.contiguous!.endLocal).toBe('12:00')
    expect(res.contiguous!.totalEur).toBeCloseTo(0.2, 6) // 2 × 0.10, NOT the 0.01 valley
    // The cheap valley must not leak in via the interruptible plan either.
    expect(res.interruptible!.totalEur).toBeCloseTo(0.2, 6)
  })

  it('a slot whose hour finishes after `latest` is excluded', () => {
    // latest=12 means the last usable slot starts at 11:00 (finishes 12:00). 12:00 is out.
    const prices = day({ 11: 0.05, 12: 0.01 }, 0.4)
    const res = planChargeWindow({
      prices,
      energyKwh: 1,
      powerKw: 1,
      earliestHour: 8,
      latestHour: 12,
    })
    expect(res.contiguous!.startLocal).toBe('11:00') // 0.05, not the cheaper 12:00 (excluded)
    expect(res.contiguous!.totalEur).toBeCloseTo(0.05, 6)
  })
})

describe('planChargeWindow — duration longer than the cheap valley', () => {
  // Valley is only 2h cheap (03:00, 04:00 @ 0.05). Need 3 slots → the 3rd spills out.
  // Make 02:00 and 05:00 both 0.30 so any contiguous 3 covering the valley costs 0.40.
  // Put a lone cheap-ish slot at 14:00 (0.08) so interruptible can beat contiguous.
  const prices = day({ 3: 0.05, 4: 0.05, 14: 0.08 }, 0.3)

  it('cheapest contiguous must include a pricey neighbour', () => {
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    // Best contiguous: [03,04,05] or [02,03,04] → 0.05+0.05+0.30 = 0.40.
    expect(res.contiguous!.totalEur).toBeCloseTo(0.4, 6)
    expect(res.contiguous!.slots).toBe(3)
  })

  it('interruptible cherry-picks the two valley hours + the lone cheap hour', () => {
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    // 0.05 + 0.05 + 0.08 = 0.18, strictly cheaper than the 0.40 contiguous run.
    expect(res.interruptible!.totalEur).toBeCloseTo(0.18, 6)
    expect(res.interruptibleSavingEur).toBeCloseTo(0.22, 6) // 0.40 − 0.18
    // Slots are reported in clock order: 03:00, 04:00, 14:00.
    expect(res.interruptible!.detail.map((d) => d.localTime)).toEqual(['03:00', '04:00', '14:00'])
  })
})

describe('planChargeWindow — partial last slot (energy not a multiple of power)', () => {
  it('the final slot draws only the remainder; avg is energy-weighted', () => {
    // 2.5 kWh @ 1 kW → 3 slots: 1, 1, 0.5 kWh. Flat 0.20.
    const res = planChargeWindow({ prices: day({}, 0.2), energyKwh: 2.5, powerKw: 1 })
    expect(res.slotsNeeded).toBe(3)
    const detail = res.contiguous!.detail
    expect(detail.map((d) => d.kwh)).toEqual([1, 1, 0.5])
    expect(res.contiguous!.totalEur).toBeCloseTo(0.5, 6) // (1+1+0.5) × 0.20
    expect(res.contiguous!.avgEurKwh).toBeCloseTo(0.2, 6) // 0.50 / 2.5 kWh
  })

  it('higher power packs the energy into fewer slots', () => {
    // 6 kWh @ 3 kW → 2 slots of 3 kWh each. Cheap valley at 03,04.
    const res = planChargeWindow({
      prices: day({ 3: 0.05, 4: 0.05 }, 0.3),
      energyKwh: 6,
      powerKw: 3,
    })
    expect(res.slotsNeeded).toBe(2)
    expect(res.contiguous!.startLocal).toBe('03:00')
    expect(res.contiguous!.totalEur).toBeCloseTo(0.3, 6) // (3 + 3) kWh × 0.05
  })
})

describe('planChargeWindow — degenerate inputs', () => {
  it('empty price array → all nulls', () => {
    const res = planChargeWindow({ prices: [], energyKwh: 3, powerKw: 1 })
    expect(res.contiguous).toBeNull()
    expect(res.interruptible).toBeNull()
    expect(res.worstContiguous).toBeNull()
    expect(res.savedVsWorstEur).toBe(0)
  })

  it('too few feasible slots for the required duration → nulls', () => {
    // Need 3 slots but only 2 prices exist.
    const prices: HourlyFinalPrice[] = [
      { ts: new Date(`${DAY}T01:00:00Z`), finalEurKwh: 0.1 },
      { ts: new Date(`${DAY}T02:00:00Z`), finalEurKwh: 0.1 },
    ]
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1 })
    expect(res.slotsNeeded).toBe(3)
    expect(res.contiguous).toBeNull()
    expect(res.interruptible).toBeNull()
  })

  it('constraint window too narrow to fit the duration → nulls', () => {
    // 3 slots needed but only 10:00 & 11:00 are inside [10, 12).
    const res = planChargeWindow({
      prices: day({}, 0.2),
      energyKwh: 3,
      powerKw: 1,
      earliestHour: 10,
      latestHour: 12,
    })
    expect(res.contiguous).toBeNull()
  })

  it('zero / negative energy or power → nulls (no crash)', () => {
    expect(planChargeWindow({ prices: day({}, 0.2), energyKwh: 0, powerKw: 1 }).contiguous).toBeNull()
    expect(planChargeWindow({ prices: day({}, 0.2), energyKwh: 3, powerKw: 0 }).contiguous).toBeNull()
  })
})

describe('planChargeWindow — interruptible respects a gap in feasibility', () => {
  it('contiguous skips a window broken by an excluded hour', () => {
    // Cheap at 09:00 & 11:00 (0.05) but 10:00 is pricey (0.50). With a 2-slot need,
    // the cheapest CONTIGUOUS pair cannot be [09,11] (not adjacent); interruptible can.
    const prices = day({ 9: 0.05, 10: 0.5, 11: 0.05 }, 0.3)
    const res = planChargeWindow({ prices, energyKwh: 2, powerKw: 1, earliestHour: 8, latestHour: 20 })
    // Best contiguous pair: [08(0.30),09(0.05)] or [09,10] etc. The cheapest adjacent pair
    // is 09+10? = 0.55, or 08+09 = 0.35, or 11+12 = 0.35. So contiguous = 0.35.
    expect(res.contiguous!.totalEur).toBeCloseTo(0.35, 6)
    // Interruptible takes the two 0.05 slots → 0.10, much cheaper.
    expect(res.interruptible!.totalEur).toBeCloseTo(0.1, 6)
    expect(res.interruptible!.detail.map((d) => d.localTime)).toEqual(['09:00', '11:00'])
    expect(res.interruptibleSavingEur).toBeCloseTo(0.25, 6)
  })
})

describe('planChargeWindow — availability window too narrow → cheapest-N-of-day fallback', () => {
  // The anchor EV/TVDE case: a 40 kWh top-up at an 11 kW charger needs ceil(40/11)=4 slots,
  // but the user is only plugged in 22:00–24:00 (2 slots). Instead of a dead "no window",
  // we surface the 4 cheapest hours of the WHOLE day, with a best-effort euro cost.
  it('EV 40kWh@11kW, window 22–24h: falls back to the day\'s 4 cheapest hours', () => {
    // 4 clearly-cheapest hours at 02–05 (0.05); everything else 0.30. None are in 22–24h.
    const prices = day({ 2: 0.05, 3: 0.05, 4: 0.05, 5: 0.05 }, 0.3)
    const res = planChargeWindow({
      prices,
      energyKwh: 40,
      powerKw: 11,
      earliestHour: 22,
      latestHour: 24,
    })

    // The real windows can't fit → null, but the day-wide fallback is populated.
    expect(res.slotsNeeded).toBe(4)
    expect(res.contiguous).toBeNull()
    expect(res.interruptible).toBeNull()
    expect(res.availabilityConstrained).toBe(true)
    expect(res.fallbackCheapest).not.toBeNull()

    const fb = res.fallbackCheapest!
    expect(fb.slots).toBe(4)
    // 40 kWh across the four 0.05 hours → 40 × 0.05 = 2.00 €, regardless of chunk split.
    expect(fb.totalEur).toBeCloseTo(2.0, 6)
    expect(fb.avgEurKwh).toBeCloseTo(0.05, 6)
    // The four cheapest hours, reported in clock order.
    expect(fb.detail.map((d) => d.localTime)).toEqual(['02:00', '03:00', '04:00', '05:00'])
    // Energy adds up to the full 40 kWh (chunks 11+11+11+7).
    expect(fb.detail.reduce((s, d) => s + d.kwh, 0)).toBeCloseTo(40, 6)
  })

  it('picks the strictly cheapest hours even when scattered across the day', () => {
    // Cheapest four are 03(0.02), 04(0.03), 13(0.04), 14(0.05); fill 0.40. Window 22–23h.
    const prices = day({ 3: 0.02, 4: 0.03, 13: 0.04, 14: 0.05 }, 0.4)
    const res = planChargeWindow({
      prices,
      energyKwh: 4,
      powerKw: 1, // 4 slots of 1 kWh
      earliestHour: 22,
      latestHour: 23,
    })
    expect(res.availabilityConstrained).toBe(true)
    const fb = res.fallbackCheapest!
    expect(fb.detail.map((d) => d.localTime)).toEqual(['03:00', '04:00', '13:00', '14:00'])
    // 1 kWh each → 0.02 + 0.03 + 0.04 + 0.05 = 0.14 €.
    expect(fb.totalEur).toBeCloseTo(0.14, 6)
  })

  it('does NOT populate the fallback when a real feasible window exists', () => {
    // Wide-open window: the load fits, so the fallback stays null (normal path untouched).
    const res = planChargeWindow({
      prices: day({ 3: 0.05, 4: 0.05, 5: 0.05, 6: 0.05 }, 0.3),
      energyKwh: 4,
      powerKw: 1,
    })
    expect(res.contiguous).not.toBeNull()
    expect(res.fallbackCheapest).toBeNull()
    expect(res.availabilityConstrained).toBe(false)
  })

  it('does NOT claim availabilityConstrained when the whole day lacks enough hours', () => {
    // Only two priced hours exist at all → even ignoring availability we can\'t cover 3 slots.
    const prices: HourlyFinalPrice[] = [
      { ts: new Date(`${DAY}T22:00:00Z`), finalEurKwh: 0.1 },
      { ts: new Date(`${DAY}T23:00:00Z`), finalEurKwh: 0.1 },
    ]
    const res = planChargeWindow({ prices, energyKwh: 3, powerKw: 1, earliestHour: 22, latestHour: 24 })
    expect(res.contiguous).toBeNull()
    expect(res.fallbackCheapest).toBeNull()
    expect(res.availabilityConstrained).toBe(false)
  })

  it('respects the timeZone when deciding feasibility before falling back (ES/Madrid)', () => {
    // Madrid window 22–24h. Cheapest hours are UTC 01–04 (= Madrid 02–05), none in 22–24h.
    const prices = day({ 1: 0.05, 2: 0.05, 3: 0.05, 4: 0.05 }, 0.3)
    const res = planChargeWindow({
      prices,
      energyKwh: 40,
      powerKw: 11,
      earliestHour: 22,
      latestHour: 24,
      timeZone: 'Europe/Madrid',
    })
    expect(res.availabilityConstrained).toBe(true)
    const fb = res.fallbackCheapest!
    // Labels rendered in Madrid local time (UTC+1 in winter): 02:00–05:00.
    expect(fb.detail.map((d) => d.localTime)).toEqual(['02:00', '03:00', '04:00', '05:00'])
    expect(fb.totalEur).toBeCloseTo(2.0, 6)
  })
})

describe('planChargeWindow — output shape', () => {
  it('reports UTC ISO + Lisbon local labels and per-slot detail', () => {
    const res = planChargeWindow({ prices: day({ 3: 0.05, 4: 0.05, 5: 0.05 }, 0.3), energyKwh: 3, powerKw: 1 })
    const w = res.contiguous!
    expect(w.startTs).toBe('2026-01-14T03:00:00.000Z')
    expect(w.endTs).toBe('2026-01-14T06:00:00.000Z')
    expect(w.startLocal).toBe('03:00')
    expect(w.endLocal).toBe('06:00')
    expect(w.detail).toHaveLength(3)
    expect(w.detail[0]!.eurCost).toBeCloseTo(0.05, 6)
  })
})

describe('planChargeWindow — timeZone parameter (ES / Madrid)', () => {
  // Winter day: Madrid is UTC+1, so a UTC hour H renders as Madrid hour H+1.
  it('labels windows in the given zone (Madrid = Lisbon + 1h in winter)', () => {
    // Cheap UTC 02:00 → Madrid 03:00. Default-Lisbon would label it 02:00.
    const res = planChargeWindow({
      prices: day({ 2: 0.05 }, 0.3),
      energyKwh: 1,
      powerKw: 1,
      timeZone: 'Europe/Madrid',
    })
    expect(res.contiguous!.startLocal).toBe('03:00')
    expect(res.contiguous!.endLocal).toBe('04:00')
  })

  it('interprets availability hours in the given zone', () => {
    // Valley at UTC 06:00 (= Madrid 07:00). Available 08:00–20:00 MADRID excludes it,
    // forcing the next cheap Madrid-daytime hour (UTC 09:00 = Madrid 10:00 @ 0.10).
    const res = planChargeWindow({
      prices: day({ 6: 0.01, 9: 0.1 }, 0.3),
      energyKwh: 1,
      powerKw: 1,
      earliestHour: 8,
      latestHour: 20,
      timeZone: 'Europe/Madrid',
    })
    expect(res.contiguous!.startLocal).toBe('10:00') // Madrid, not the 07:00 valley
    expect(res.contiguous!.totalEur).toBeCloseTo(0.1, 6)
  })

  it('defaults to Lisbon when no zone is passed (back-compat)', () => {
    const res = planChargeWindow({ prices: day({ 2: 0.05 }, 0.3), energyKwh: 1, powerKw: 1 })
    expect(res.contiguous!.startLocal).toBe('02:00') // Lisbon == UTC in winter
  })
})
