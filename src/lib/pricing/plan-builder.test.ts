import { describe, expect, it } from 'vitest'
import { buildDayPlan, type MarketPriceLike, type PlanAppliance, type PlanTariff } from './plan-builder'

// WINTER day so Europe/Lisbon == UTC (offset 0): local hour == UTC hour, legal time = winter.
// 2026-01-14 is a Wednesday (weekday). Hour N starts at 2026-01-14T0N:00:00Z = local 0N:00.
const DAY = '2026-01-14'

const PT_INDEXED: PlanTariff = {
  id: 'pt-indexed',
  country: 'PT',
  type: 'indexed',
  formula: { markup_eur_mwh: 30 },
}

const PT_FIXED: PlanTariff = {
  id: 'pt-fixed',
  country: 'PT',
  type: 'fixed',
  formula: { fixed_eur_kwh: 0.16 },
}

/** Build 24 hourly market rows (€/MWh) from a price-by-hour map (default fills the rest). */
function marketDay(prices: Partial<Record<number, number>>, fill: number): MarketPriceLike[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ts: new Date(`${DAY}T${String(h).padStart(2, '0')}:00:00Z`),
    priceEurMwh: prices[h] ?? fill,
  }))
}

const washer: PlanAppliance = {
  id: 'w1',
  label: 'Washer',
  type: 'washer',
  energyKwh: 1,
  powerKw: 1,
  interruptible: false,
  earliestHour: 0,
  latestHour: 24,
}

describe('buildDayPlan — FINAL price curve (PT indexed)', () => {
  it('prices each hour as (OMIE+markup)/1000 + TAR + IEC, then ×1.06 (VAZIO night hour)', () => {
    // 03:00 local is VAZIO (00:00–08:00). OMIE = 10 €/MWh.
    // energy = (10+30)/1000 = 0.04 ; preTax = 0.04 + 0.0158 (VAZIO TAR) + 0.001 (IEC) = 0.0568
    // final = 0.0568 × 1.06 = 0.060208
    const plan = buildDayPlan({
      prices: marketDay({ 3: 10 }, 50),
      tariff: PT_INDEXED,
      appliances: [],
      cycle: 'tri',
      counting: 'diario',
      timeZone: 'Europe/Lisbon',
    })
    const at3 = plan.curve.find((c) => c.localHour === 3)!
    expect(at3.wholesaleEurMwh).toBe(10)
    expect(at3.finalEurKwh).toBeCloseTo(0.060208, 6)
  })

  it('keeps wholesale €/MWh separate from final €/kWh (chart vs recommendation)', () => {
    const plan = buildDayPlan({
      prices: marketDay({}, 80),
      tariff: PT_INDEXED,
      appliances: [],
      timeZone: 'Europe/Lisbon',
    })
    const point = plan.curve[0]!
    // Wholesale stays in €/MWh (80), final is a small €/kWh number — never equal.
    expect(point.wholesaleEurMwh).toBe(80)
    expect(point.finalEurKwh).toBeLessThan(1)
    expect(point.finalEurKwh).toBeGreaterThan(0)
  })

  it('PONTA hours are far dearer than VAZIO hours under the same OMIE (TAR drives it)', () => {
    // Same OMIE everywhere; only the hourly TAR differs (VAZIO 0.0158 vs PONTA 0.2452).
    const plan = buildDayPlan({
      prices: marketDay({}, 40),
      tariff: PT_INDEXED,
      appliances: [],
      cycle: 'tri',
      counting: 'diario',
      timeZone: 'Europe/Lisbon',
    })
    // Winter weekday tri PONTA includes 09:00–10:30 and 18:00–20:30.
    const ponta = plan.curve.find((c) => c.localHour === 9)!
    const vazio = plan.curve.find((c) => c.localHour === 3)!
    // Gap = (0.2452 − 0.0158) × 1.06 = 0.243164.
    expect(ponta.finalEurKwh - vazio.finalEurKwh).toBeCloseTo(0.243164, 6)
  })

  it('exposes cheapest and peak FINAL €/kWh across the curve', () => {
    const plan = buildDayPlan({
      prices: marketDay({ 3: 5 }, 200),
      tariff: PT_INDEXED,
      appliances: [],
      cycle: 'simples',
      timeZone: 'Europe/Lisbon',
    })
    const finals = plan.curve.map((c) => c.finalEurKwh)
    expect(plan.cheapestEurKwh).toBeCloseTo(Math.min(...finals), 9)
    expect(plan.peakEurKwh).toBeCloseTo(Math.max(...finals), 9)
    expect(plan.cheapestEurKwh).toBeLessThan(plan.peakEurKwh)
  })
})

describe('buildDayPlan — appliance → window mapping', () => {
  it('maps a 1kWh washer to the single cheapest FINAL hour', () => {
    // Make 02:00 the OMIE valley; simples cycle → TAR flat, so final tracks OMIE.
    const plan = buildDayPlan({
      prices: marketDay({ 2: 1 }, 100),
      tariff: PT_INDEXED,
      appliances: [washer],
      cycle: 'simples',
      timeZone: 'Europe/Lisbon',
    })
    const w = plan.appliances[0]!
    expect(w.applianceId).toBe('w1')
    expect(w.plan.contiguous!.startLocal).toBe('02:00')
    expect(w.plan.contiguous!.slots).toBe(1)
    // The recommended window saves vs the priciest hour.
    expect(w.plan.savedVsWorstEur).toBeGreaterThan(0)
  })

  it('honours an appliance availability window (excludes the global valley)', () => {
    // Valley at 02:00 but appliance only available 08:00–20:00 → must pick a daytime hour.
    const plan = buildDayPlan({
      prices: marketDay({ 2: 1, 14: 5 }, 100),
      tariff: PT_INDEXED,
      appliances: [{ ...washer, earliestHour: 8, latestHour: 20 }],
      cycle: 'simples',
      timeZone: 'Europe/Lisbon',
    })
    const w = plan.appliances[0]!
    expect(w.plan.contiguous!.startLocal).toBe('14:00') // not 02:00
  })

  it('an interruptible load can cherry-pick scattered cheap hours', () => {
    // Two separated cheap OMIE hours (03:00 and 14:00); a 2-slot interruptible load
    // should pick BOTH rather than a contiguous pricey pair.
    const plan = buildDayPlan({
      prices: marketDay({ 3: 1, 14: 1 }, 100),
      tariff: PT_INDEXED,
      appliances: [
        { ...washer, id: 'ev', energyKwh: 2, powerKw: 1, interruptible: true },
      ],
      cycle: 'simples',
      timeZone: 'Europe/Lisbon',
    })
    const ev = plan.appliances[0]!
    expect(ev.plan.interruptible!.detail.map((d) => d.localTime)).toEqual(['03:00', '14:00'])
    expect(ev.plan.interruptibleSavingEur).toBeGreaterThan(0)
  })

  it('returns a null window when the load cannot fit its availability', () => {
    const plan = buildDayPlan({
      prices: marketDay({}, 50),
      tariff: PT_INDEXED,
      appliances: [
        { ...washer, energyKwh: 3, powerKw: 1, earliestHour: 10, latestHour: 12 },
      ],
      timeZone: 'Europe/Lisbon',
    })
    expect(plan.appliances[0]!.plan.contiguous).toBeNull()
  })
})

describe('buildDayPlan — degenerate inputs', () => {
  it('empty prices → empty curve, zeroed extremes, appliances still echoed', () => {
    const plan = buildDayPlan({
      prices: [],
      tariff: PT_INDEXED,
      appliances: [washer],
      timeZone: 'Europe/Lisbon',
    })
    expect(plan.curve).toHaveLength(0)
    expect(plan.cheapestEurKwh).toBe(0)
    expect(plan.peakEurKwh).toBe(0)
    expect(plan.appliances).toHaveLength(1)
    expect(plan.appliances[0]!.plan.contiguous).toBeNull()
  })

  it('skips rows with a non-finite wholesale price', () => {
    const prices: MarketPriceLike[] = [
      { ts: new Date(`${DAY}T00:00:00Z`), priceEurMwh: Number.NaN },
      { ts: new Date(`${DAY}T01:00:00Z`), priceEurMwh: 50 },
    ]
    const plan = buildDayPlan({ prices, tariff: PT_INDEXED, appliances: [], timeZone: 'Europe/Lisbon' })
    expect(plan.curve).toHaveLength(1)
    expect(plan.curve[0]!.localHour).toBe(1)
  })

  it('accepts string wholesale prices (numeric columns arrive as strings)', () => {
    const prices: MarketPriceLike[] = [{ ts: new Date(`${DAY}T03:00:00Z`), priceEurMwh: '10' }]
    const plan = buildDayPlan({
      prices,
      tariff: PT_INDEXED,
      appliances: [],
      cycle: 'tri',
      timeZone: 'Europe/Lisbon',
    })
    // Same as the numeric-10 VAZIO case above: 0.060208.
    expect(plan.curve[0]!.finalEurKwh).toBeCloseTo(0.060208, 6)
  })

  it('a FIXED tariff flattens the curve to a single final value (TAR aside)', () => {
    // Fixed energy 0.16 €/kWh; simples TAR flat → every hour identical regardless of OMIE.
    const plan = buildDayPlan({
      prices: marketDay({ 2: -10, 18: 300 }, 100),
      tariff: PT_FIXED,
      appliances: [],
      cycle: 'simples',
      timeZone: 'Europe/Lisbon',
    })
    const finals = new Set(plan.curve.map((c) => c.finalEurKwh.toFixed(6)))
    expect(finals.size).toBe(1) // perfectly flat
    expect(plan.cheapestEurKwh).toBeCloseTo(plan.peakEurKwh, 9)
  })
})
