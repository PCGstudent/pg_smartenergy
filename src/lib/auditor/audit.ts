import { createSupabaseService } from '@/lib/supabase/server'
import {
  getInvoiceById,
  insertAudit,
  listTariffsByCountry,
  setInvoiceStatus,
  updateInvoiceFromExtraction,
  type TariffRow,
} from '@/lib/db/invoice-queries'
import { getPricesInRange } from '@/lib/db/queries'
import { extractInvoice } from '@/lib/ai/gemini'
import { backfillOmieRange } from '@/lib/ingestion/backfill'
import {
  computeSavingsAgainstActual,
  type computePeriodCost,
  type ComputePeriodCostInput,
  type SavingsResult,
} from '@/lib/pricing/tariff-math'
import { syntheticProfile } from './profile'

export interface AuditOutcome {
  auditId: string
  invoiceId: string
  baselineEur: number
  bestAlternativeEur: number
  savingsEur: number
  savingsPct: number
  bestTariffName: string
  comparisonsCount: number
}

export class AuditError extends Error {
  constructor(message: string, readonly stage: AuditStage, readonly cause?: unknown) {
    super(message)
    this.name = 'AuditError'
  }
}

type AuditStage =
  | 'fetch-invoice'
  | 'download-pdf'
  | 'extract'
  | 'persist-extraction'
  | 'backfill-prices'
  | 'load-prices'
  | 'load-tariffs'
  | 'compute-savings'
  | 'persist-audit'

/**
 * End-to-end auditor pipeline. Idempotent at the boundaries: re-running on the same
 * invoice will overwrite the extraction and create a new `audits` row.
 *
 * Designed to run inside an Inngest step. Uses the service-role Supabase client
 * everywhere because we need to bypass RLS while operating on behalf of the user
 * (the upload was already authenticated; from here on the user is offline).
 */
export async function runAudit(invoiceId: string): Promise<AuditOutcome> {
  const supa = createSupabaseService()

  // 1. Fetch invoice row.
  const invoice = await wrap('fetch-invoice', () => getInvoiceById(supa, invoiceId))
  if (!invoice) throw new AuditError(`Invoice ${invoiceId} not found`, 'fetch-invoice')

  try {
    // 2. Download the PDF.
    const pdfBuffer = await wrap('download-pdf', async () => {
      const { data, error } = await supa.storage.from('invoices').download(invoice.storage_path)
      if (error || !data) throw new Error(error?.message ?? 'No PDF body')
      return Buffer.from(await data.arrayBuffer())
    })

    // 3. Gemini extraction.
    const extraction = await wrap('extract', () => extractInvoice(pdfBuffer))

    // 4. Persist extraction onto the invoice row.
    await wrap('persist-extraction', () =>
      updateInvoiceFromExtraction(supa, invoiceId, {
        provider: extraction.provider,
        period_start: extraction.periodStart,
        period_end: extraction.periodEnd,
        total_amount_eur: extraction.totalAmountEur,
        total_kwh: extraction.totalKwh,
        hourly_consumption: extraction.hourlyConsumption,
        ai_extraction: extraction as unknown as Record<string, unknown>,
      }),
    )

    // 5. Backfill OMIE for the billing period if needed.
    await wrap('backfill-prices', () =>
      backfillOmieRange(extraction.periodStart, extraction.periodEnd),
    )

    // 6. Load prices + build consumption series.
    const periodStartDate = new Date(`${extraction.periodStart}T00:00:00Z`)
    const periodEndDate = new Date(`${extraction.periodEnd}T23:59:59Z`)
    const prices = await wrap('load-prices', async () => {
      const rows = await getPricesInRange(extraction.country, periodStartDate, periodEndDate)
      return rows.map((p) => ({
        ts: p.ts as Date,
        priceEurMwh: Number(p.priceEurMwh),
      }))
    })
    if (prices.length === 0) {
      throw new AuditError(
        `No OMIE prices available for ${extraction.country} ${extraction.periodStart}…${extraction.periodEnd}. Backfill may have failed.`,
        'load-prices',
      )
    }

    const consumption = buildConsumption(extraction)

    // 7. Load alternative tariffs and run comparisons.
    const tariffs = await wrap('load-tariffs', () =>
      listTariffsByCountry(supa, extraction.country),
    )
    if (tariffs.length === 0) {
      throw new AuditError(
        `No tariffs in catalog for ${extraction.country}. Seed via supabase/migrations/0001_init.sql.`,
        'load-tariffs',
      )
    }

    const comparisons = compareAgainstAll({
      baselineEur: extraction.totalAmountEur,
      tariffs,
      consumption,
      prices,
      periodStart: extraction.periodStart,
      periodEnd: extraction.periodEnd,
    })
    if (comparisons.length === 0) {
      throw new AuditError('No tariff yielded a valid comparison.', 'compute-savings')
    }

    const best = comparisons[0]!

    // 8. Persist audit row + flip invoice → processed.
    const audit = await wrap('persist-audit', () =>
      insertAudit(supa, {
        invoice_id: invoiceId,
        user_id: invoice.user_id,
        baseline_cost_eur: extraction.totalAmountEur,
        projected_cost_eur: best.savings.alternativeTotalEur,
        savings_eur: best.savings.savingsEur,
        savings_pct: best.savings.savingsPct,
        alternative_tariff_id: best.tariff.id,
        detail: {
          extraction,
          consumption_source: extraction.hourlyConsumption?.length ? 'invoice' : 'synthetic',
          best_tariff_id: best.tariff.id,
          comparisons: comparisons.map((c) => ({
            tariff_id: c.tariff.id,
            tariff_name: c.tariff.name,
            tariff_provider: c.tariff.provider,
            tariff_type: c.tariff.type,
            alternative_total_eur: c.savings.alternativeTotalEur,
            savings_eur: c.savings.savingsEur,
            savings_pct: c.savings.savingsPct,
            breakdown: c.savings.alternative,
          })),
        },
      }),
    )

    await setInvoiceStatus(supa, invoiceId, 'processed')

    return {
      auditId: audit.id,
      invoiceId,
      baselineEur: extraction.totalAmountEur,
      bestAlternativeEur: best.savings.alternativeTotalEur,
      savingsEur: best.savings.savingsEur,
      savingsPct: best.savings.savingsPct,
      bestTariffName: `${best.tariff.provider} · ${best.tariff.name}`,
      comparisonsCount: comparisons.length,
    }
  } catch (err) {
    // Mark the invoice errored so the UI can surface a useful message.
    const message = err instanceof Error ? err.message : String(err)
    const stage = err instanceof AuditError ? err.stage : 'unknown'
    try {
      await setInvoiceStatus(supa, invoiceId, 'error', {
        ai_extraction: { error: message, stage },
      })
    } catch {
      // swallow — original error is more important
    }
    throw err
  }
}

interface CompareInput {
  baselineEur: number
  tariffs: TariffRow[]
  consumption: { ts: Date; kwh: number }[]
  prices: { ts: Date; priceEurMwh: number }[]
  periodStart: string
  periodEnd: string
}

interface Comparison {
  tariff: TariffRow
  savings: SavingsResult
}

function compareAgainstAll(input: CompareInput): Comparison[] {
  const out: Comparison[] = []
  for (const tariff of input.tariffs) {
    try {
      const altInput: ComputePeriodCostInput = {
        tariff: tariff as unknown as Parameters<typeof computePeriodCost>[0]['tariff'],
        consumption: input.consumption,
        prices: input.prices,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
      }
      const savings = computeSavingsAgainstActual(input.baselineEur, altInput)
      out.push({ tariff, savings })
    } catch {
      // Tariff with incomplete formula — skip it rather than fail the whole audit.
      continue
    }
  }
  // Highest savings first.
  out.sort((a, b) => b.savings.savingsEur - a.savings.savingsEur)
  return out
}

/** Real hourly consumption from the invoice if present, otherwise a synthetic profile. */
function buildConsumption(extraction: {
  hourlyConsumption: { ts: string; kwh: number }[] | null
  periodStart: string
  periodEnd: string
  totalKwh: number
  country: 'PT' | 'ES'
}): { ts: Date; kwh: number }[] {
  if (extraction.hourlyConsumption && extraction.hourlyConsumption.length > 0) {
    return extraction.hourlyConsumption
      .map((h) => ({ ts: new Date(h.ts), kwh: h.kwh }))
      .filter((h) => !Number.isNaN(h.ts.getTime()))
  }
  const tz = extraction.country === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'
  return syntheticProfile(extraction.periodStart, extraction.periodEnd, extraction.totalKwh, tz)
}

async function wrap<T>(stage: AuditStage, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AuditError) throw err
    throw new AuditError(
      `${stage} failed: ${err instanceof Error ? err.message : String(err)}`,
      stage,
      err,
    )
  }
}
