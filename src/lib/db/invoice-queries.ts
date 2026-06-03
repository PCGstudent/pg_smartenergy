import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-side query helpers for the auditor pipeline.
 *
 * All functions take a `SupabaseClient` so callers decide which security context:
 *   - `createSupabaseServer()` — RLS-enforced, for user-facing reads.
 *   - `createSupabaseService()` — bypasses RLS, for Inngest workers.
 */

export interface InvoiceRow {
  id: string
  user_id: string
  storage_path: string
  provider: string | null
  period_start: string | null
  period_end: string | null
  total_amount_eur: string | number | null
  total_kwh: string | number | null
  hourly_consumption: { ts: string; kwh: number }[] | null
  ai_extraction: Record<string, unknown> | null
  status: 'pending' | 'processed' | 'error'
  created_at: string
}

export interface AuditRow {
  id: string
  invoice_id: string
  user_id: string
  baseline_cost_eur: string | number
  projected_cost_eur: string | number
  savings_eur: string | number
  savings_pct: string | number
  alternative_tariff_id: string | null
  detail: Record<string, unknown> | null
  created_at: string
}

export interface TariffRow {
  id: string
  country: 'PT' | 'ES'
  provider: string
  name: string
  type: 'fixed' | 'indexed' | 'dual'
  formula: Record<string, unknown>
  fees: Record<string, unknown> | null
  active_from: string | null
  active_to: string | null
}

export async function getInvoiceById(
  client: SupabaseClient,
  id: string,
): Promise<InvoiceRow | null> {
  const { data, error } = await client.from('invoices').select('*').eq('id', id).maybeSingle()
  if (error) throw error
  return data as InvoiceRow | null
}

export async function listInvoicesForUser(
  client: SupabaseClient,
  userId: string,
  limit = 20,
): Promise<InvoiceRow[]> {
  const { data, error } = await client
    .from('invoices')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as InvoiceRow[]
}

export async function getLatestAuditForInvoice(
  client: SupabaseClient,
  invoiceId: string,
): Promise<AuditRow | null> {
  const { data, error } = await client
    .from('audits')
    .select('*')
    .eq('invoice_id', invoiceId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  return data as AuditRow | null
}

export async function listTariffsByCountry(
  client: SupabaseClient,
  country: 'PT' | 'ES',
): Promise<TariffRow[]> {
  const { data, error } = await client
    .from('tariffs')
    .select('*')
    .eq('country', country)
    .or('active_to.is.null,active_to.gte.' + new Date().toISOString().slice(0, 10))
  if (error) throw error
  return (data ?? []) as TariffRow[]
}

export async function insertInvoice(
  client: SupabaseClient,
  row: { user_id: string; storage_path: string },
): Promise<{ id: string }> {
  const { data, error } = await client
    .from('invoices')
    .insert({ user_id: row.user_id, storage_path: row.storage_path, status: 'pending' })
    .select('id')
    .single()
  if (error) throw error
  return data as { id: string }
}

export async function updateInvoiceFromExtraction(
  client: SupabaseClient,
  id: string,
  patch: {
    provider?: string | null
    period_start?: string | null
    period_end?: string | null
    total_amount_eur?: number | null
    total_kwh?: number | null
    hourly_consumption?: { ts: string; kwh: number }[] | null
    ai_extraction?: Record<string, unknown>
  },
): Promise<void> {
  const { error } = await client.from('invoices').update(patch).eq('id', id)
  if (error) throw error
}

export async function setInvoiceStatus(
  client: SupabaseClient,
  id: string,
  status: 'pending' | 'processed' | 'error',
  extra?: { ai_extraction?: Record<string, unknown> },
): Promise<void> {
  const patch: Record<string, unknown> = { status }
  if (extra?.ai_extraction) patch.ai_extraction = extra.ai_extraction
  const { error } = await client.from('invoices').update(patch).eq('id', id)
  if (error) throw error
}

export interface InvoiceSavingsSummary {
  invoiceId: string
  savingsEur: number
  savingsPct: number
}

/**
 * For a list of invoice IDs, returns the latest audit's savings summary for each.
 * Results are deduplicated client-side (one entry per invoice, most recent audit wins).
 */
export async function getLatestAuditSavingsByInvoiceIds(
  client: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, InvoiceSavingsSummary>> {
  if (invoiceIds.length === 0) return new Map()

  const { data, error } = await client
    .from('audits')
    .select('invoice_id, savings_eur, savings_pct, created_at')
    .in('invoice_id', invoiceIds)
    .order('created_at', { ascending: false })

  if (error) throw error

  const map = new Map<string, InvoiceSavingsSummary>()
  for (const row of data ?? []) {
    if (!map.has(row.invoice_id)) {
      map.set(row.invoice_id, {
        invoiceId: row.invoice_id,
        savingsEur: Number(row.savings_eur),
        savingsPct: Number(row.savings_pct),
      })
    }
  }
  return map
}

export interface LatestUserAudit {
  auditId: string
  invoiceId: string
  provider: string | null
  periodStart: string | null
  periodEnd: string | null
  baselineCostEur: number
  projectedCostEur: number
  savingsEur: number
  savingsPct: number
  alternativeTariffProvider: string | null
  alternativeTariffName: string | null
  createdAt: string
}

/**
 * Returns the single most recent audit row for the user, joined with the
 * invoice's provider/period and the alternative tariff's provider+name.
 * Uses RLS-enforced client — never returns data for other users.
 */
export async function getLatestAuditForUser(
  client: SupabaseClient,
  userId: string,
): Promise<LatestUserAudit | null> {
  const { data, error } = await client
    .from('audits')
    .select(`
      id,
      invoice_id,
      baseline_cost_eur,
      projected_cost_eur,
      savings_eur,
      savings_pct,
      created_at,
      invoices!inner ( provider, period_start, period_end ),
      tariffs ( provider, name )
    `)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw error
  if (!data) return null

  const inv = Array.isArray(data.invoices) ? data.invoices[0] : data.invoices
  const tar = Array.isArray(data.tariffs) ? data.tariffs[0] : data.tariffs

  return {
    auditId: data.id,
    invoiceId: data.invoice_id,
    provider: inv?.provider ?? null,
    periodStart: inv?.period_start ?? null,
    periodEnd: inv?.period_end ?? null,
    baselineCostEur: Number(data.baseline_cost_eur),
    projectedCostEur: Number(data.projected_cost_eur),
    savingsEur: Number(data.savings_eur),
    savingsPct: Number(data.savings_pct),
    alternativeTariffProvider: tar?.provider ?? null,
    alternativeTariffName: tar?.name ?? null,
    createdAt: data.created_at,
  }
}

export async function insertAudit(
  client: SupabaseClient,
  row: {
    invoice_id: string
    user_id: string
    baseline_cost_eur: number
    projected_cost_eur: number
    savings_eur: number
    savings_pct: number
    alternative_tariff_id: string | null
    detail: Record<string, unknown>
  },
): Promise<{ id: string }> {
  const { data, error } = await client.from('audits').insert(row).select('id').single()
  if (error) throw error
  return data as { id: string }
}
