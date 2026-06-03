'use server'

import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import {
  getInvoiceById,
  getLatestAuditForInvoice,
  insertAudit,
  listTariffsByCountry,
  type TariffRow,
} from '@/lib/db/invoice-queries'
import { getPricesInRange } from '@/lib/db/queries'
import { parseEredesCSV, EredesParseError } from '@/lib/ingestion/eredes'
import {
  computeSavingsAgainstActual,
  type computePeriodCost,
  type ComputePeriodCostInput,
} from '@/lib/pricing/tariff-math'

/**
 * Upload E-Redes hourly CSV for an existing invoice and immediately re-run
 * the tariff comparison with real hourly data.
 *
 * Flow:
 *   1. Authenticate + verify invoice ownership.
 *   2. Parse the CSV text on the server (never trust client-parsed data).
 *   3. Filter to the billing period already extracted by Gemini.
 *   4. Update `invoices.hourly_consumption` with the real data.
 *   5. Re-run `compareAgainstAll` using the actual OMIE prices + real kwh.
 *   6. Insert a new `audits` row tagged `consumption_source: 'eredes_csv'`.
 *   7. Return the new audit's invoice_id so the client can reload.
 */
export async function importEredesConsumption(
  invoiceId: string,
  csvText: string,
): Promise<{ error: string } | { invoiceId: string }> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated. Please sign in.' }

  const supa = await createSupabaseServer()

  const invoice = await getInvoiceById(supa, invoiceId)
  if (!invoice || invoice.user_id !== session.user.id) {
    return { error: 'Invoice not found.' }
  }

  const audit = await getLatestAuditForInvoice(supa, invoiceId)
  if (!audit) {
    return {
      error:
        'No audit found for this invoice. Please wait for the initial PDF audit to complete first.',
    }
  }

  const detail = audit.detail as {
    extraction: {
      provider: string
      country: 'PT' | 'ES'
      periodStart: string
      periodEnd: string
      totalKwh: number
      totalAmountEur: number
      contractedPowerKw: number | null
      tariffName: string | null
      tariffType: string
      confidence: number
    }
    consumption_source: string
    comparisons: unknown[]
  }
  const extraction = detail.extraction

  // ── Parse CSV ─────────────────────────────────────────────────────────────
  let rawHours: { ts: string; kwh: number }[]
  try {
    rawHours = parseEredesCSV(csvText)
  } catch (err) {
    const msg = err instanceof EredesParseError ? err.message : String(err)
    return { error: `CSV inválido: ${msg}` }
  }

  // Filter to the billing period
  const periodStart = new Date(`${extraction.periodStart}T00:00:00Z`)
  const periodEnd = new Date(`${extraction.periodEnd}T23:59:59Z`)
  const filtered = rawHours.filter((h) => {
    const ts = new Date(h.ts)
    return ts >= periodStart && ts <= periodEnd
  })

  if (filtered.length < 24) {
    return {
      error:
        `Nenhum dado encontrado para o período de faturação (${extraction.periodStart} → ${extraction.periodEnd}). ` +
        `Certifica-te de que o CSV cobre este período. Horas encontradas: ${rawHours.length}.`,
    }
  }

  // ── Persist real consumption ───────────────────────────────────────────────
  const service = createSupabaseService()
  const { error: updateErr } = await service
    .from('invoices')
    .update({ hourly_consumption: filtered })
    .eq('id', invoiceId)
  if (updateErr) return { error: `Erro ao guardar consumo: ${updateErr.message}` }

  // ── Load prices + tariffs ────────────────────────────────────────────────
  const priceRows = await getPricesInRange(extraction.country, periodStart, periodEnd)
  const prices = priceRows.map((p) => ({
    ts: p.ts as Date,
    priceEurMwh: Number(p.priceEurMwh),
  }))

  if (prices.length === 0) {
    return {
      error:
        'Não há preços OMIE no período desta fatura. Aguarda que o OMIE seja importado.',
    }
  }

  const tariffs = await listTariffsByCountry(service, extraction.country)

  // ── Re-run comparisons with real hourly data ──────────────────────────────
  const consumption = filtered.map((h) => ({ ts: new Date(h.ts), kwh: h.kwh }))
  const baselineEur = Number(audit.baseline_cost_eur)
  const contractedKva = extraction.contractedPowerKw ?? undefined

  const comparisons: {
    tariff: TariffRow
    savings: ReturnType<typeof computeSavingsAgainstActual>
  }[] = []

  for (const tariff of tariffs) {
    try {
      const altInput: ComputePeriodCostInput = {
        tariff: tariff as unknown as Parameters<typeof computePeriodCost>[0]['tariff'],
        consumption,
        prices,
        periodStart: extraction.periodStart,
        periodEnd: extraction.periodEnd,
        contractedKva,
      }
      comparisons.push({ tariff, savings: computeSavingsAgainstActual(baselineEur, altInput) })
    } catch {
      continue
    }
  }

  comparisons.sort((a, b) => b.savings.savingsEur - a.savings.savingsEur)
  if (comparisons.length === 0) {
    return { error: 'Nenhuma tarifa calculada com sucesso.' }
  }

  const best = comparisons[0]!

  const newAudit = await insertAudit(service, {
    invoice_id: invoiceId,
    user_id: session.user.id,
    baseline_cost_eur: baselineEur,
    projected_cost_eur: best.savings.alternativeTotalEur,
    savings_eur: best.savings.savingsEur,
    savings_pct: best.savings.savingsPct,
    alternative_tariff_id: best.tariff.id,
    detail: {
      extraction,
      consumption_source: 'eredes_csv',
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
  })

  void newAudit // suppress unused-warning — we return invoiceId so the page reloads the latest audit

  return { invoiceId }
}

/**
 * Re-run tariff comparisons for an existing processed invoice using
 * the consumption already stored in the DB (from PDF extraction or E-Redes CSV).
 * Useful after the tariff catalog is updated or new OMIE prices arrive.
 */
export async function retriggerAudit(
  invoiceId: string,
): Promise<{ error: string } | { invoiceId: string }> {
  const session = await getSession()
  if (!session) return { error: 'Not authenticated. Please sign in.' }

  const supa = await createSupabaseServer()
  const invoice = await getInvoiceById(supa, invoiceId)
  if (!invoice || invoice.user_id !== session.user.id) return { error: 'Invoice not found.' }
  if (invoice.status !== 'processed') return { error: 'Invoice not yet processed.' }

  const audit = await getLatestAuditForInvoice(supa, invoiceId)
  if (!audit) return { error: 'No previous audit found. Please wait for the initial audit.' }

  const detail = audit.detail as {
    extraction: {
      provider: string
      country: 'PT' | 'ES'
      periodStart: string
      periodEnd: string
      totalKwh: number
      totalAmountEur: number
      contractedPowerKw: number | null
      tariffName: string | null
      tariffType: string
      confidence: number
    }
    consumption_source: string
  }
  const extraction = detail.extraction

  const periodStart = new Date(`${extraction.periodStart}T00:00:00Z`)
  const periodEnd = new Date(`${extraction.periodEnd}T23:59:59Z`)

  const service = createSupabaseService()

  const [priceRows, tariffs] = await Promise.all([
    getPricesInRange(extraction.country, periodStart, periodEnd),
    listTariffsByCountry(service, extraction.country),
  ])

  if (priceRows.length === 0) {
    return { error: 'Sem preços OMIE neste período. Aguarda que o OMIE seja importado.' }
  }

  const prices = priceRows.map((p) => ({ ts: p.ts as Date, priceEurMwh: Number(p.priceEurMwh) }))

  const stored = invoice.hourly_consumption
  const consumption = stored && stored.length > 0
    ? stored.map((h) => ({ ts: new Date(h.ts), kwh: h.kwh }))
    : buildSyntheticConsumption(extraction.totalKwh, periodStart, periodEnd)

  const baselineEur = Number(audit.baseline_cost_eur)
  const contractedKva =
    session.profile?.contractedKva ?? extraction.contractedPowerKw ?? undefined

  const comparisons: { tariff: TariffRow; savings: ReturnType<typeof computeSavingsAgainstActual> }[] = []
  for (const tariff of tariffs) {
    try {
      const altInput: ComputePeriodCostInput = {
        tariff: tariff as unknown as Parameters<typeof computePeriodCost>[0]['tariff'],
        consumption,
        prices,
        periodStart: extraction.periodStart,
        periodEnd: extraction.periodEnd,
        contractedKva,
      }
      comparisons.push({ tariff, savings: computeSavingsAgainstActual(baselineEur, altInput) })
    } catch {
      continue
    }
  }

  comparisons.sort((a, b) => b.savings.savingsEur - a.savings.savingsEur)
  if (comparisons.length === 0) return { error: 'Nenhuma tarifa calculada com sucesso.' }

  const best = comparisons[0]!
  const consumptionSource = stored && stored.length > 0 ? detail.consumption_source : 'synthetic'

  await insertAudit(service, {
    invoice_id: invoiceId,
    user_id: session.user.id,
    baseline_cost_eur: baselineEur,
    projected_cost_eur: best.savings.alternativeTotalEur,
    savings_eur: best.savings.savingsEur,
    savings_pct: best.savings.savingsPct,
    alternative_tariff_id: best.tariff.id,
    detail: {
      extraction,
      consumption_source: consumptionSource,
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
  })

  return { invoiceId }
}

function buildSyntheticConsumption(
  totalKwh: number,
  start: Date,
  end: Date,
): { ts: Date; kwh: number }[] {
  const hours: { ts: Date; kwh: number }[] = []
  const cur = new Date(start)
  const kwhPerHour = totalKwh / Math.max(1, Math.round((end.getTime() - start.getTime()) / 3600000))
  while (cur <= end) {
    hours.push({ ts: new Date(cur), kwh: kwhPerHour })
    cur.setHours(cur.getHours() + 1)
  }
  return hours
}
