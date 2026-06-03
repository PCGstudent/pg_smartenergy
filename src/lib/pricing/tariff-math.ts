import type { Tariff } from '@/lib/db/schema'
import {
  IEC_EUR_PER_KWH,
  tarEurKwhForDate,
  type CountingCycle,
  type TariffCycle,
} from './tar'

export interface HourlyConsumption {
  ts: Date
  kwh: number
}

export interface HourlyMarketPrice {
  ts: Date
  priceEurMwh: number
}

interface TariffFormula {
  fixed_eur_kwh?: number
  markup_eur_mwh?: number
  taxes?: { iva?: number; ie?: number; csa?: number }
}

interface TariffFees {
  fixed_monthly_eur?: number
  fixed_monthly_eur_per_kva?: number
}

/** Default contracted power when not available from the invoice (most common PT/ES BTN). */
const DEFAULT_CONTRACTED_KVA = 6.9

function getFormula(tariff: Pick<Tariff, 'formula'>): TariffFormula {
  return (tariff.formula as TariffFormula | null | undefined) ?? {}
}

function getFees(tariff: Pick<Tariff, 'fees'>): TariffFees {
  return (tariff.fees as TariffFees | null | undefined) ?? {}
}

/** Apply a tariff formula to one hour. Returns retail energy €/kWh BEFORE TAR and taxes. */
export function applyFormulaPerKwh(
  tariff: Pick<Tariff, 'id' | 'type' | 'formula'>,
  marketEurMwh: number,
): number {
  const f = getFormula(tariff)
  if (tariff.type === 'fixed' && typeof f.fixed_eur_kwh === 'number') {
    return f.fixed_eur_kwh
  }
  if (tariff.type === 'indexed' && typeof f.markup_eur_mwh === 'number') {
    return (marketEurMwh + f.markup_eur_mwh) / 1000
  }
  if (tariff.type === 'dual') {
    // Simplified dual: fall back to fixed if defined, else indexed.
    if (typeof f.fixed_eur_kwh === 'number') return f.fixed_eur_kwh
    if (typeof f.markup_eur_mwh === 'number') return (marketEurMwh + f.markup_eur_mwh) / 1000
  }
  throw new Error(`Tariff ${tariff.id} has incomplete formula`)
}

/** Total energy cost over a period under a given tariff (excl. fixed power term and taxes). */
export function computeEnergyCost(
  tariff: Pick<Tariff, 'id' | 'type' | 'formula'>,
  consumption: HourlyConsumption[],
  prices: HourlyMarketPrice[],
): number {
  const priceMap = new Map<number, number>()
  for (const p of prices) priceMap.set(p.ts.getTime(), p.priceEurMwh)

  let total = 0
  for (const c of consumption) {
    const market = priceMap.get(c.ts.getTime())
    if (market == null) continue // skip hours without a market price
    const eurKwh = applyFormulaPerKwh(tariff, market)
    total += eurKwh * c.kwh
  }
  return total
}

/**
 * Total PT network-access (TAR) cost over a period, summed per consumed hour at that hour's
 * regulated rate. Applies ONLY to indexed PT tariffs: a fixed tariff's headline rate already
 * bundles TAR (see `finalPricePerKwh`), and ES TAR is not encoded yet (`tar.ts` stub). Hours
 * without matching consumption contribute nothing. Mirrors `finalPricePerKwh`'s TAR term so the
 * audit path and the planner path can never silently diverge on the bill's largest component.
 */
function computeTarCost(
  consumption: HourlyConsumption[],
  cycle: TariffCycle,
  counting: CountingCycle,
): number {
  let total = 0
  for (const c of consumption) {
    total += tarEurKwhForDate(c.ts, cycle, counting) * c.kwh
  }
  return total
}

export interface FinalPriceBreakdown {
  /** Energy commodity €/kWh (OMIE+markup for indexed, or fixed) — before TAR & taxes. */
  energyEurKwh: number
  /** Regulated network access (TAR) €/kWh for this hour — incl. CIEG (PT). 0 for ES (TAR not encoded yet). */
  tarEurKwh: number
  /** PT IEC (Imposto Especial de Consumo) flat €/kWh excise. Always 0 for ES. */
  exciseEurKwh: number
  /** ES CSA (cargo por servicios de ajuste) €/kWh = energyEurKwh × 0.0511. Always 0 for PT. */
  csaEurKwh: number
  /** Sum before VAT: energy + TAR + excise + CSA. */
  preTaxEurKwh: number
  /** VAT applied on the pre-VAT base. */
  ivaEurKwh: number
  /** All-in €/kWh the customer pays for this hour. */
  finalEurKwh: number
}

export interface FinalPriceInput {
  tariff: Pick<Tariff, 'id' | 'country' | 'type' | 'formula'>
  /** OMIE wholesale price for the hour (€/MWh). */
  marketEurMwh: number
  /** The absolute instant of the hour (UTC `Date`) — drives the hourly TAR lookup. */
  at: Date
  /** Customer's tariff cycle for TAR (simples | bi | tri). */
  cycle: TariffCycle
  /** Ciclo de contagem for TAR (default 'diario'). */
  counting?: CountingCycle
}

/**
 * The all-in €/kWh a customer pays for a SINGLE hour, on the FINAL customer price.
 *
 * TWO PRICING SHAPES, by tariff type:
 *
 *   INDEXED (and indexed-side dual) — the tariff quotes a MARKUP over OMIE, so the regulated
 *   stack is added on top:
 *     final = ( (OMIE+markup) + hourly TAR + IEC ) × (1 + IVA)                     // PT
 *     final = ( (OMIE+markup) ) × (1 + CSA) × (1 + IVA)                            // ES (TAR TODO)
 *
 *   FIXED — the tariff quotes a single all-in €/kWh (the headline price PT/ES retailers
 *   advertise) that ALREADY bundles TAR, IEC/CSA and IVA. Adding the regulated stack again
 *   would double-count it (a PT PONTA hour came out ~2.5× too high). So for a fixed tariff
 *   the hour's final price IS the quoted rate, flat across the day — and a flat day is exactly
 *   right: a fixed customer has no hourly price signal to optimise against.
 *     final = fixed_eur_kwh                                                        // PT & ES
 *
 * PRODUCT RULE: recommendations must be computed on this number, never on raw OMIE.
 *
 * PT: hourly TAR (incl. CIEG) comes from `tar.ts`; IEC = 0.001 €/kWh added pre-VAT (indexed only).
 * ES: the regulated peajes/cargos TAR is not yet encoded (see TODO in tar.ts), so the ES
 *     indexed branch keeps the existing CSA-on-energy approximation and adds NO per-hour TAR. The
 *     magnitude is still bill-shaped; revisit once ES TAR lands.
 *
 * ES CSA base — ACKNOWLEDGED PER-HOUR APPROXIMATION:
 *   The Spanish "cargo por servicios de ajuste" is, in statute, levied on the energy term
 *   PLUS the fixed power term. The authoritative ES path is `computePeriodCost`, which uses
 *   `csaEur = (energyEur + fixedEur) × CSA`. Here, on a single hour, the fixed power term is
 *   not available (it is a monthly €/kVA charge, not a per-kWh quantity), so this function
 *   applies CSA to energy ONLY: the breakdown's `csaEurKwh = energyEurKwh × CSA` (and
 *   `exciseEurKwh = 0`, since IEC is PT-only). Consequence: the planner's
 *   ES totals UNDERESTIMATE the real bill by ~(fixedEur × CSA) over a period — a small,
 *   bounded gap that the audit (`computePeriodCost`) corrects. PT is unaffected (no CSA).
 *
 * IVA uses this module's simplified rate (PT 0.06 / ES 0.10), matching `computePeriodCost`
 * so audit and planner agree. (PT's statutory rate is tiered up to 23%; out of scope here.)
 */
export function finalPricePerKwh(input: FinalPriceInput): FinalPriceBreakdown {
  const { tariff, marketEurMwh, at, cycle } = input
  const counting = input.counting ?? 'diario'

  const energyEurKwh = applyFormulaPerKwh(tariff, marketEurMwh)
  const ivaRate = ivaRateFor(tariff.country)

  if (tariff.type === 'fixed') {
    // A fixed tariff's `fixed_eur_kwh` is the ALL-IN headline price (TAR + IEC/CSA + IVA already
    // baked in by the retailer). Returning it verbatim — flat across the day — avoids
    // double-counting the regulated stack. The breakdown reports it as the final figure with the
    // components zeroed, because we cannot honestly decompose a bundled rate back into parts.
    return {
      energyEurKwh,
      tarEurKwh: 0,
      exciseEurKwh: 0,
      csaEurKwh: 0,
      preTaxEurKwh: energyEurKwh,
      ivaEurKwh: 0,
      finalEurKwh: energyEurKwh,
    }
  }

  if (tariff.country === 'ES') {
    // ES: no per-hour TAR yet. CSA applies on energy ONLY here (per-hour approximation —
    // the fixed power term is monthly, not per-kWh). The authoritative ES base is
    // computePeriodCost's (energy + fixed). See the JSDoc above for the bounded gap.
    const csaEurKwh = energyEurKwh * ES_CSA_RATE
    const preTaxEurKwh = energyEurKwh + csaEurKwh
    const ivaEurKwh = preTaxEurKwh * ivaRate
    return {
      energyEurKwh,
      tarEurKwh: 0,
      exciseEurKwh: 0,
      csaEurKwh,
      preTaxEurKwh,
      ivaEurKwh,
      finalEurKwh: preTaxEurKwh + ivaEurKwh,
    }
  }

  // PT (default): energy + hourly TAR (incl. CIEG) + IEC, then IVA.
  const tarEurKwh = tarEurKwhForDate(at, cycle, counting)
  const exciseEurKwh = IEC_EUR_PER_KWH
  const preTaxEurKwh = energyEurKwh + tarEurKwh + exciseEurKwh
  const ivaEurKwh = preTaxEurKwh * ivaRate
  return {
    energyEurKwh,
    tarEurKwh,
    exciseEurKwh,
    csaEurKwh: 0,
    preTaxEurKwh,
    ivaEurKwh,
    finalEurKwh: preTaxEurKwh + ivaEurKwh,
  }
}

export interface PeriodCostBreakdown {
  energyEur: number
  fixedEur: number
  tarEur: number /** PT network access (TAR) over the period; 0 for ES and for fixed tariffs */
  ieEur: number /** PT special electricity tax */
  csaEur: number /** ES special electricity tax */
  ivaEur: number
  totalEur: number
  totalKwh: number
  monthsInPeriod: number
}

export interface ComputePeriodCostInput {
  tariff: Pick<Tariff, 'id' | 'country' | 'type' | 'formula' | 'fees'>
  consumption: HourlyConsumption[]
  prices: HourlyMarketPrice[]
  /** YYYY-MM-DD or Date — period start (inclusive). */
  periodStart: Date | string
  /** YYYY-MM-DD or Date — period end (inclusive). */
  periodEnd: Date | string
  /** Contracted power in kVA from the invoice. Used when tariff has fixed_monthly_eur_per_kva. */
  contractedKva?: number
  /** Customer's TAR cycle (PT indexed only). Defaults to 'simples'. */
  cycle?: TariffCycle
  /** TAR counting cycle (PT indexed only). Defaults to 'diario'. */
  counting?: CountingCycle
}

// PT IEC (Imposto Especial de Consumo de Eletricidade) per-kWh excise is the single
// canonical constant `IEC_EUR_PER_KWH`, imported from `tar.ts`. Both the audit path
// (computePeriodCost) and the planner path (finalPricePerKwh) reference it, so an ERSE
// rate change in one place can never silently diverge the two.
const ES_CSA_RATE = 0.0511 // 5.11% — see computePeriodCost / finalPricePerKwh for the base each uses
const IVA_RATE = { PT: 0.06, ES: 0.10 } as const

/**
 * Resolve the IVA rate for a country, failing loudly on an unknown one.
 * Explicit guard (no silent PT fallback) so adding a third country surfaces the
 * missing rate immediately instead of mispricing its bills at PT's 6%.
 */
function ivaRateFor(country: string): number {
  const rate = IVA_RATE[country as keyof typeof IVA_RATE]
  if (rate == null) throw new Error(`Unknown country for IVA rate: ${country}`)
  return rate
}

/**
 * Total bill amount under a tariff, including the fixed power term and Iberian taxes.
 *
 * Mirrors `finalPricePerKwh`'s two pricing shapes so the audit (which ranks alternative
 * tariffs) and the planner (which times loads) agree on the bill:
 *
 *  - INDEXED: energy(OMIE+markup) + PT hourly TAR (the largest line on a real indexed bill —
 *    formerly omitted here, which overstated savings ~1.6×) + IEC, plus the monthly power term,
 *    then IVA. ES adds CSA on (energy + power) instead of per-hour TAR (TAR not encoded yet).
 *  - FIXED: `fixed_eur_kwh` is the all-in headline rate; the regulated stack is already inside it,
 *    so we add ONLY the monthly power term and apply NO further TAR/IEC/IVA on energy.
 *
 * AUTHORITATIVE ES PATH: for Spain, CSA is levied on (energy + fixed power term), the
 * base closest to statute. `finalPricePerKwh` cannot see the monthly fixed term per-hour,
 * so its ES total is a deliberate underestimate; this function is the one that reconciles.
 */
export function computePeriodCost(input: ComputePeriodCostInput): PeriodCostBreakdown {
  const { tariff, consumption, prices, periodStart, periodEnd } = input
  const fees = getFees(tariff)
  const isFixed = tariff.type === 'fixed'

  const start = toDate(periodStart)
  const end = toDate(periodEnd)
  const monthsInPeriod = approxMonths(start, end)

  const energyEur = computeEnergyCost(tariff, consumption, prices)
  const kva = input.contractedKva ?? DEFAULT_CONTRACTED_KVA
  const fixedEur = fees.fixed_monthly_eur_per_kva != null
    ? fees.fixed_monthly_eur_per_kva * kva * monthsInPeriod
    : (fees.fixed_monthly_eur ?? 0) * monthsInPeriod
  const totalKwh = consumption.reduce((s, c) => s + c.kwh, 0)

  // FIXED tariffs already bundle TAR/IEC/CSA/IVA into the energy rate — only the monthly power
  // term is added on top. Returning early keeps that case unambiguous and avoids double-counting.
  if (isFixed) {
    return {
      energyEur,
      fixedEur,
      tarEur: 0,
      ieEur: 0,
      csaEur: 0,
      ivaEur: 0,
      totalEur: energyEur + fixedEur,
      totalKwh,
      monthsInPeriod,
    }
  }

  let tarEur = 0
  let ieEur = 0
  let csaEur = 0
  if (tariff.country === 'PT') {
    tarEur = computeTarCost(consumption, input.cycle ?? 'simples', input.counting ?? 'diario')
    ieEur = totalKwh * IEC_EUR_PER_KWH
  } else if (tariff.country === 'ES') {
    csaEur = (energyEur + fixedEur) * ES_CSA_RATE
  }

  const ivaRate = ivaRateFor(tariff.country)
  const taxableBase = energyEur + fixedEur + tarEur + ieEur + csaEur
  const ivaEur = taxableBase * ivaRate
  const totalEur = taxableBase + ivaEur

  return { energyEur, fixedEur, tarEur, ieEur, csaEur, ivaEur, totalEur, totalKwh, monthsInPeriod }
}

export interface SavingsResult {
  baselineTotalEur: number
  alternativeTotalEur: number
  savingsEur: number
  savingsPct: number
  baselineAvgEurKwh: number
  alternativeAvgEurKwh: number
  totalKwh: number
  alternative: PeriodCostBreakdown
}

/**
 * Compare a baseline (the user's actual paid amount, from the invoice) against
 * a candidate alternative tariff for the same period and consumption.
 *
 * Why pass a number for baseline? The most honest baseline is what the customer
 * literally paid — extracted directly from their PDF. We don't try to re-derive it
 * from a tariff formula because that introduces error. The alternative *is* derived
 * from a formula because we need to project hour-by-hour what they would have paid.
 */
export function computeSavingsAgainstActual(
  baselineTotalEur: number,
  alternativeInput: ComputePeriodCostInput,
): SavingsResult {
  const alternative = computePeriodCost(alternativeInput)
  const totalKwh = alternative.totalKwh
  const savingsEur = baselineTotalEur - alternative.totalEur
  const savingsPct = baselineTotalEur > 0 ? (savingsEur / baselineTotalEur) * 100 : 0
  return {
    baselineTotalEur,
    alternativeTotalEur: alternative.totalEur,
    savingsEur,
    savingsPct,
    baselineAvgEurKwh: totalKwh > 0 ? baselineTotalEur / totalKwh : 0,
    alternativeAvgEurKwh: totalKwh > 0 ? alternative.totalEur / totalKwh : 0,
    totalKwh,
    alternative,
  }
}

function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(`${d}T00:00:00Z`) : d
}

/**
 * Approximate the number of months a billing period spans, as (inclusive days) / 30.
 * Used only to scale the monthly fixed power term.
 *
 * ERROR BOUND: ±3.3% for billing periods of 28–31 days (a 31-day period returns 1.0333).
 * On a typical 6.9 kVA contract at ~0.30 €/kW/month, the worst-case error is ~0.07 €
 * per billing cycle. If higher fidelity is ever required, switch to calendar-month
 * counting: whole calendar months between start and end, plus the fractional-day remainder.
 */
function approxMonths(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime() + 24 * 3600 * 1000
  return Math.max(0, ms / (30 * 24 * 3600 * 1000))
}
