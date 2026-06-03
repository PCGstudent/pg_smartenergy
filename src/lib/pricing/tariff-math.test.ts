import { describe, expect, it } from 'vitest'
import type { Tariff } from '@/lib/db/schema'
import { applyFormulaPerKwh, computePeriodCost, finalPricePerKwh } from './tariff-math'

// Minimal tariff factory — only the fields the pricing math reads.
function tariff(partial: Partial<Tariff>): Tariff {
  return {
    id: 't-1',
    country: 'PT',
    provider: 'Test',
    name: 'Test Plan',
    type: 'indexed',
    formula: {},
    fees: null,
    activeFrom: null,
    activeTo: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...partial,
  } as Tariff
}

describe('applyFormulaPerKwh — energy €/kWh before TAR & taxes', () => {
  it('indexed: (OMIE + markup) / 1000', () => {
    const t = tariff({ type: 'indexed', formula: { markup_eur_mwh: 5 } })
    expect(applyFormulaPerKwh(t, 50)).toBeCloseTo(0.055, 6)
  })

  it('fixed: flat €/kWh ignoring OMIE', () => {
    const t = tariff({ type: 'fixed', formula: { fixed_eur_kwh: 0.15 } })
    expect(applyFormulaPerKwh(t, 999)).toBe(0.15)
  })

  it('throws on an incomplete formula', () => {
    const t = tariff({ type: 'indexed', formula: {} })
    expect(() => applyFormulaPerKwh(t, 50)).toThrow(/incomplete formula/)
  })
})

describe('finalPricePerKwh — PT (energy + hourly TAR + IEC, then IVA 6%)', () => {
  it('indexed, VAZIO hour: hand-computed all-in price', () => {
    // 2026-01-14T03:00Z = winter weekday 03:00 Lisbon → tri VAZIO (0.0158).
    // energy=(50+5)/1000=0.055; +TAR 0.0158 +IEC 0.001 = 0.0718; ×1.06 = 0.076108.
    const fp = finalPricePerKwh({
      tariff: tariff({ type: 'indexed', formula: { markup_eur_mwh: 5 } }),
      marketEurMwh: 50,
      at: new Date('2026-01-14T03:00:00Z'),
      cycle: 'tri',
    })
    expect(fp.energyEurKwh).toBeCloseTo(0.055, 6)
    expect(fp.tarEurKwh).toBe(0.0158)
    expect(fp.exciseEurKwh).toBe(0.001) // PT IEC flat rate
    expect(fp.csaEurKwh).toBe(0) // CSA is ES-only
    expect(fp.preTaxEurKwh).toBeCloseTo(0.0718, 6)
    expect(fp.ivaEurKwh).toBeCloseTo(0.004308, 6)
    expect(fp.finalEurKwh).toBeCloseTo(0.076108, 6)
  })

  it('indexed, PONTA hour: TAR jumps to 0.2452', () => {
    // 2026-01-14T09:30Z = winter weekday 09:30 Lisbon → tri PONTA (0.2452).
    // energy=(100+10)/1000=0.11; +0.2452 +0.001 = 0.3562; ×1.06 = 0.377572.
    const fp = finalPricePerKwh({
      tariff: tariff({ type: 'indexed', formula: { markup_eur_mwh: 10 } }),
      marketEurMwh: 100,
      at: new Date('2026-01-14T09:30:00Z'),
      cycle: 'tri',
    })
    expect(fp.tarEurKwh).toBe(0.2452)
    expect(fp.preTaxEurKwh).toBeCloseTo(0.3562, 6)
    expect(fp.finalEurKwh).toBeCloseTo(0.377572, 6)
  })

  it('fixed tariff: all-in rate is returned verbatim (no TAR/IEC/IVA double-count)', () => {
    // A fixed tariff's fixed_eur_kwh is the ALL-IN headline price retailers advertise — it
    // already bundles TAR + IEC + IVA. The final price IS that rate, flat across every hour;
    // adding the regulated stack again would inflate it (a PONTA hour came out ~2.5× too high).
    const at03 = finalPricePerKwh({
      tariff: tariff({ type: 'fixed', formula: { fixed_eur_kwh: 0.15 } }),
      marketEurMwh: 50,
      at: new Date('2026-01-14T03:00:00Z'), // VAZIO
      cycle: 'tri',
    })
    expect(at03.energyEurKwh).toBe(0.15)
    expect(at03.tarEurKwh).toBe(0)
    expect(at03.exciseEurKwh).toBe(0)
    expect(at03.ivaEurKwh).toBe(0)
    expect(at03.finalEurKwh).toBe(0.15)

    // Flat: the same fixed rate at a PONTA hour (TAR would otherwise differ a lot).
    const at0930 = finalPricePerKwh({
      tariff: tariff({ type: 'fixed', formula: { fixed_eur_kwh: 0.15 } }),
      marketEurMwh: 50,
      at: new Date('2026-01-14T09:30:00Z'), // PONTA
      cycle: 'tri',
    })
    expect(at0930.finalEurKwh).toBe(0.15)
  })

  it('PONTA is meaningfully more expensive than VAZIO for the same OMIE', () => {
    const common = {
      tariff: tariff({ type: 'indexed', formula: { markup_eur_mwh: 0 } }),
      marketEurMwh: 50,
      cycle: 'tri' as const,
    }
    const vazio = finalPricePerKwh({ ...common, at: new Date('2026-01-14T03:00:00Z') })
    const ponta = finalPricePerKwh({ ...common, at: new Date('2026-01-14T09:30:00Z') })
    expect(ponta.finalEurKwh).toBeGreaterThan(vazio.finalEurKwh)
    // Difference is exactly the TAR gap × (1 + IVA): (0.2452 − 0.0158) × 1.06.
    expect(ponta.finalEurKwh - vazio.finalEurKwh).toBeCloseTo((0.2452 - 0.0158) * 1.06, 6)
  })
})

describe('finalPricePerKwh — ES (CSA on energy, IVA 10%, no per-hour TAR yet)', () => {
  it('indexed: hand-computed all-in price with CSA', () => {
    // energy 0.055; CSA 5.11% → 0.0028105; pre 0.0578105; ×1.10 → 0.06359155.
    const fp = finalPricePerKwh({
      tariff: tariff({ country: 'ES', type: 'indexed', formula: { markup_eur_mwh: 5 } }),
      marketEurMwh: 50,
      at: new Date('2026-01-14T03:00:00Z'),
      cycle: 'simples',
    })
    expect(fp.tarEurKwh).toBe(0)
    expect(fp.exciseEurKwh).toBe(0) // IEC is PT-only; ES carries its excise in csaEurKwh
    expect(fp.csaEurKwh).toBeCloseTo(0.0028105, 7) // ES CSA = energy × 5.11%
    expect(fp.preTaxEurKwh).toBeCloseTo(0.0578105, 7)
    expect(fp.finalEurKwh).toBeCloseTo(0.06359155, 7)
  })

  it('ES price is flat across hours (no TAR time-of-use)', () => {
    const base = {
      tariff: tariff({ country: 'ES', type: 'indexed', formula: { markup_eur_mwh: 5 } }),
      marketEurMwh: 50,
      cycle: 'tri' as const,
    }
    const a = finalPricePerKwh({ ...base, at: new Date('2026-01-14T03:00:00Z') })
    const b = finalPricePerKwh({ ...base, at: new Date('2026-01-14T09:30:00Z') })
    expect(a.finalEurKwh).toBeCloseTo(b.finalEurKwh, 9)
  })
})

describe('computePeriodCost — PT TAR enters the audit base (regression: it was omitted)', () => {
  // Two consumed hours, both winter-weekday VAZIO (tri TAR 0.0158), 10 kWh each.
  const consumption = [
    { ts: new Date('2026-01-14T03:00:00Z'), kwh: 10 },
    { ts: new Date('2026-01-14T04:00:00Z'), kwh: 10 },
  ]
  const prices = [
    { ts: new Date('2026-01-14T03:00:00Z'), priceEurMwh: 50 },
    { ts: new Date('2026-01-14T04:00:00Z'), priceEurMwh: 50 },
  ]

  it('indexed PT: TAR is summed per hour into the taxable base', () => {
    // energy=(50+10)/1000=0.06 ×20 = 1.20; TAR 0.0158 ×20 = 0.316; IEC 0.001 ×20 = 0.02.
    // base = 1.20 + 0.316 + 0.02 = 1.536; IVA 6% = 0.09216; total = 1.62816.
    const bd = computePeriodCost({
      tariff: tariff({ type: 'indexed', formula: { markup_eur_mwh: 10 } }),
      consumption,
      prices,
      periodStart: '2026-01-14',
      periodEnd: '2026-01-14',
      cycle: 'tri',
    })
    expect(bd.energyEur).toBeCloseTo(1.2, 6)
    expect(bd.tarEur).toBeCloseTo(0.316, 6) // <- the formerly-missing component
    expect(bd.ieEur).toBeCloseTo(0.02, 6)
    expect(bd.totalEur).toBeCloseTo(1.62816, 6)
  })

  it('fixed PT: all-in rate is not double-taxed (no TAR/IEC/IVA on top of energy)', () => {
    // fixed 0.15 ×20 = 3.00; no power fee → total is exactly 3.00, flat.
    const bd = computePeriodCost({
      tariff: tariff({ type: 'fixed', formula: { fixed_eur_kwh: 0.15 } }),
      consumption,
      prices,
      periodStart: '2026-01-14',
      periodEnd: '2026-01-14',
      cycle: 'tri',
    })
    expect(bd.energyEur).toBeCloseTo(3.0, 6)
    expect(bd.tarEur).toBe(0)
    expect(bd.ieEur).toBe(0)
    expect(bd.ivaEur).toBe(0)
    expect(bd.totalEur).toBeCloseTo(3.0, 6)
  })
})

describe('finalPricePerKwh — unknown country fails loudly (no silent PT fallback)', () => {
  it('throws instead of mispricing a third country at PT 6% IVA', () => {
    // A reseller in an unencoded country (e.g. FR) must surface the missing IVA rate,
    // not be silently billed at Portugal's 6%.
    const fr = tariff({ country: 'FR' as Tariff['country'], type: 'indexed', formula: { markup_eur_mwh: 5 } })
    expect(() =>
      finalPricePerKwh({
        tariff: fr,
        marketEurMwh: 50,
        at: new Date('2026-01-14T03:00:00Z'),
        cycle: 'simples',
      }),
    ).toThrow(/Unknown country for IVA rate: FR/)
  })
})
