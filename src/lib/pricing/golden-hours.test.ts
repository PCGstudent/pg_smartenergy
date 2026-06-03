import { describe, expect, it } from 'vitest'
import type { MarketPrice } from '@/lib/db/schema'
import type { Tariff } from '@/lib/db/schema'
import {
  nextBestAction,
  nextBestActionFinal,
  scoreFinalHours,
  scoreHours,
  type HourlyFinalPrice,
} from './golden-hours'
import { finalPricePerKwh } from './tariff-math'

// Winter weekday so Europe/Lisbon == UTC. Slot N starts 2026-01-14T0N:00:00Z = local 0N:00.
const DAY = '2026-01-14'
function at(hour: number): Date {
  return new Date(`${DAY}T${String(hour).padStart(2, '0')}:00:00Z`)
}

/** Build MarketPrice rows from a price-by-hour map (the shape scoreHours consumes). */
function marketDay(prices: Partial<Record<number, number>>, fill: number): MarketPrice[] {
  return Array.from({ length: 24 }, (_, h) => ({
    ts: at(h),
    zone: 'PT',
    priceEurMwh: String(prices[h] ?? fill),
    source: 'OMIE_PBC',
    fetchedAt: at(0),
  })) as unknown as MarketPrice[]
}

function indexedTariff(country: 'PT' | 'ES' = 'PT'): Tariff {
  return {
    id: 't-1',
    country,
    provider: 'Test',
    name: 'Indexed',
    type: 'indexed',
    formula: { markup_eur_mwh: 0 },
    fees: null,
    activeFrom: null,
    activeTo: null,
    createdAt: at(0),
  } as Tariff
}

describe('scoreHours — wholesale (€/MWh) bucketing', () => {
  it('returns [] for empty input', () => {
    expect(scoreHours([])).toEqual([])
  })

  it('keeps chronological order and ranks cheapest-first', () => {
    const scored = scoreHours(marketDay({ 0: 90, 1: 10, 2: 50 }, 70))
    expect(scored.map((s) => s.ts.getTime())).toEqual(
      [...scored].map((s) => s.ts.getTime()).sort((a, b) => a - b),
    )
    const byTs = new Map(scored.map((s) => [s.ts.getTime(), s]))
    // Hour 1 (10 €/MWh) is the global minimum → rank 1.
    expect(byTs.get(at(1).getTime())!.rank).toBe(1)
  })

  it('flags free (<1 €/MWh) and negative (<0) by absolute threshold', () => {
    const scored = scoreHours(marketDay({ 3: 0.5, 4: -5 }, 60))
    const byTs = new Map(scored.map((s) => [s.ts.getTime(), s]))
    expect(byTs.get(at(3).getTime())!.category).toBe('free')
    expect(byTs.get(at(4).getTime())!.category).toBe('negative')
  })

  it('exposes priceEurKwh = priceEurMwh / 1000', () => {
    const scored = scoreHours(marketDay({ 0: 80 }, 80))
    expect(scored[0]!.priceEurKwh).toBeCloseTo(0.08, 9)
  })
})

describe('scoreFinalHours — final (€/kWh) bucketing', () => {
  it('returns [] for empty input', () => {
    expect(scoreFinalHours([])).toEqual([])
  })

  it('ranks by final €/kWh, cheapest-first, in chronological order', () => {
    const prices: HourlyFinalPrice[] = [
      { ts: at(0), finalEurKwh: 0.30 },
      { ts: at(1), finalEurKwh: 0.07 },
      { ts: at(2), finalEurKwh: 0.15 },
    ]
    const scored = scoreFinalHours(prices)
    expect(scored.map((s) => s.ts.getTime())).toEqual([at(0), at(1), at(2)].map((d) => d.getTime()))
    const byTs = new Map(scored.map((s) => [s.ts.getTime(), s]))
    expect(byTs.get(at(1).getTime())!.rank).toBe(1)
  })

  it('applies free/negative thresholds in €/kWh (1 €/MWh = 0.001 €/kWh)', () => {
    const prices: HourlyFinalPrice[] = Array.from({ length: 24 }, (_, h) => ({
      ts: at(h),
      finalEurKwh: h === 5 ? 0.0005 : h === 6 ? -0.01 : 0.2,
    }))
    const byTs = new Map(scoreFinalHours(prices).map((s) => [s.ts.getTime(), s]))
    expect(byTs.get(at(5).getTime())!.category).toBe('free') // 0.0005 €/kWh = 0.5 €/MWh < 1
    expect(byTs.get(at(6).getTime())!.category).toBe('negative')
  })
})

describe('nextBestAction — structured, string-free, wholesale basis', () => {
  it('returns null when nothing is upcoming', () => {
    const scored = scoreHours(marketDay({}, 50))
    // now is after the last hour → no upcoming.
    expect(nextBestAction(scored, at(23))).toBeNull()
  })

  it('emits a structured cheap action with basis=wholesale and no pre-rendered strings', () => {
    const scored = scoreHours(marketDay({ 10: 5 }, 60))
    const action = nextBestAction(scored, at(0))
    expect(action).not.toBeNull()
    expect(action!.kind).toBe('cheap')
    expect(action!.basis).toBe('wholesale')
    expect(action!.ts.getTime()).toBe(at(10).getTime())
    // No headline/detail strings leak out of the lib — only structured fields.
    expect(action).not.toHaveProperty('headline')
    expect(action).not.toHaveProperty('detail')
    expect(typeof action!.params.savingsPct).toBe('number')
  })

  it('surfaces a free/negative hour as a free action with negative flag', () => {
    const scored = scoreHours(marketDay({ 8: -3 }, 70))
    const action = nextBestAction(scored, at(0))
    expect(action!.kind).toBe('free')
    expect(action!.params.negative).toBe(true)
  })

  it('warns to avoid a spike that precedes the next cheap window', () => {
    // A big spike at hour 2; cheapest upcoming is hour 1 — spike is within 6h of it.
    const scored = scoreHours(marketDay({ 1: 5, 2: 500 }, 60))
    const action = nextBestAction(scored, at(0))
    expect(action!.kind).toBe('avoid')
    expect(action!.ts.getTime()).toBe(at(2).getTime())
    expect(action!.params.alternativeTs).toBeInstanceOf(Date)
    expect(action!.params.alternativeEurKwh).toBeGreaterThan(0)
  })
})

describe('nextBestActionFinal — basis=final', () => {
  it('tags the action as final-basis so the UI may give behavioural advice', () => {
    const scored = scoreFinalHours([
      { ts: at(0), finalEurKwh: 0.25 },
      { ts: at(10), finalEurKwh: 0.07 },
    ])
    const action = nextBestActionFinal(scored, at(0))
    expect(action!.basis).toBe('final')
    expect(action!.kind).toBe('cheap')
    expect(action!.ts.getTime()).toBe(at(10).getTime())
    expect(action!.priceEurKwh).toBeCloseTo(0.07, 9)
  })
})

/**
 * Regression for the adversarial finding: ranking on raw OMIE recommends a cheap-wholesale
 * PONTA hour whose FINAL price is far higher than a pricier-wholesale VAZIO hour (because PT
 * TAR adds 0.2452 €/kWh in PONTA vs 0.0158 in VAZIO). The final-price path must pick VAZIO.
 */
describe('PRODUCT RULE #2 — final-price ranking is honest where wholesale is not', () => {
  // 2026-01-14: winter weekday. tri PONTA = 09:00–10:30 & 18:00–20:30; VAZIO = 00:00–08:00.
  // Make a PONTA hour CHEAP on OMIE (10 €/MWh) and a VAZIO hour EXPENSIVE on OMIE (60 €/MWh).
  const PONTA_HOUR = 9 // 09:00 local → PONTA
  const VAZIO_HOUR = 3 // 03:00 local → VAZIO
  const market = marketDay({ [PONTA_HOUR]: 10, [VAZIO_HOUR]: 60 }, 200)

  const tariff = indexedTariff('PT')
  const finals: HourlyFinalPrice[] = market.map((p) => ({
    ts: p.ts,
    finalEurKwh: finalPricePerKwh({
      tariff,
      marketEurMwh: Number(p.priceEurMwh),
      at: p.ts,
      cycle: 'tri',
    }).finalEurKwh,
  }))

  it('confirms the trap: the PONTA hour is cheaper on OMIE but dearer on the final bill', () => {
    const byTs = new Map(finals.map((f) => [f.ts.getTime(), f.finalEurKwh]))
    const pontaFinal = byTs.get(at(PONTA_HOUR).getTime())!
    const vazioFinal = byTs.get(at(VAZIO_HOUR).getTime())!
    // Cheaper wholesale...
    expect(10).toBeLessThan(60)
    // ...but more expensive final price (TAR gap dominates the 50 €/MWh OMIE gap).
    expect(pontaFinal).toBeGreaterThan(vazioFinal)
  })

  it('wholesale "cheapest" (rank 1) is the PONTA hour — the dishonest pick', () => {
    const byTs = new Map(scoreHours(market).map((s) => [s.ts.getTime(), s]))
    expect(byTs.get(at(PONTA_HOUR).getTime())!.rank).toBe(1) // wholesale calls PONTA cheapest
    expect(byTs.get(at(VAZIO_HOUR).getTime())!.rank).toBeGreaterThan(1)
  })

  it('final-price "cheapest" (rank 1) is the VAZIO hour — the honest pick', () => {
    const byTs = new Map(scoreFinalHours(finals).map((s) => [s.ts.getTime(), s]))
    // The honest cheapest of these two is VAZIO; assert it outranks PONTA on the final bill.
    expect(byTs.get(at(VAZIO_HOUR).getTime())!.rank).toBeLessThan(
      byTs.get(at(PONTA_HOUR).getTime())!.rank,
    )
  })

  it('nextBestActionFinal points its recommendation at the VAZIO hour, never PONTA', () => {
    const twoHours = finals.filter(
      (f) => f.ts.getTime() === at(PONTA_HOUR).getTime() || f.ts.getTime() === at(VAZIO_HOUR).getTime(),
    )
    const action = nextBestActionFinal(scoreFinalHours(twoHours), at(0))
    expect(action!.basis).toBe('final')
    // Whether 'cheap' or 'avoid', the actionable target/alternative must be the VAZIO hour.
    const recommendedTs =
      action!.kind === 'avoid' ? action!.params.alternativeTs!.getTime() : action!.ts.getTime()
    expect(recommendedTs).toBe(at(VAZIO_HOUR).getTime())
    expect(recommendedTs).not.toBe(at(PONTA_HOUR).getTime())
  })
})
