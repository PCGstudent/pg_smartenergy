/**
 * Re-runs the tariff comparison for the latest invoice using the new
 * tariff catalog (0002_tariff_catalog.sql) and the contractedKva fix,
 * then inserts a fresh audit row so the UI reflects the correct numbers.
 *
 * Uses the same math as tariff-math.ts — kept in sync manually.
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const dbUrl = env.match(/^DATABASE_URL=(.+)$/m)[1].trim()
const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

// ── tariff-math (JS replica of src/lib/pricing/tariff-math.ts) ──────────
const DEFAULT_KVA = 6.9
const PT_IE = 0.001
const IVA = { PT: 0.06, ES: 0.21 }

function approxMonths(start, end) {
  const ms = new Date(end).getTime() - new Date(start).getTime() + 86400_000
  return Math.max(0, ms / (30 * 86400_000))
}

function computePeriodCost({ tariff, totalKwh, contractedKva, periodStart, periodEnd, avgOmieMwh }) {
  const months = approxMonths(periodStart, periodEnd)
  const kva = contractedKva ?? DEFAULT_KVA
  const f = tariff.formula
  const fees = tariff.fees ?? {}

  let energyEur
  if (tariff.type === 'fixed') {
    energyEur = (f.fixed_eur_kwh ?? 0) * totalKwh
  } else {
    // indexed
    energyEur = ((avgOmieMwh + (f.markup_eur_mwh ?? 0)) / 1000) * totalKwh
  }

  const fixedEur = fees.fixed_monthly_eur_per_kva != null
    ? fees.fixed_monthly_eur_per_kva * kva * months
    : (fees.fixed_monthly_eur ?? 0) * months

  const ieEur   = tariff.country === 'PT' ? totalKwh * PT_IE : 0
  const csaEur  = tariff.country === 'ES' ? (energyEur + fixedEur) * 0.0511 : 0
  const ivaEur  = (energyEur + fixedEur + ieEur + csaEur) * (IVA[tariff.country] ?? 0.06)
  const totalEur = energyEur + fixedEur + ieEur + csaEur + ivaEur

  return { energyEur, fixedEur, ieEur, csaEur, ivaEur, totalEur, totalKwh, monthsInPeriod: months }
}
// ────────────────────────────────────────────────────────────────────────

const INVOICE_ID = '21494e60-e7b9-4db5-bbb8-a69f55ff3802'

try {
  // 1. Load existing audit's extraction data
  const [latestAudit] = await sql`
    select a.detail, a.baseline_cost_eur, a.user_id
    from public.audits a
    join public.invoices i on i.id = a.invoice_id
    where a.invoice_id = ${INVOICE_ID}
    order by a.created_at desc limit 1`

  const detail = latestAudit.detail
  const extraction = detail.extraction
  const baselineEur = Number(latestAudit.baseline_cost_eur)
  const userId = latestAudit.user_id
  const contractedKva = extraction.contractedPowerKw ?? DEFAULT_KVA

  // 2. Derive average OMIE price from existing comparison (Coopérnico energy cost / kWh - markup)
  const oldCoop = detail.comparisons.find(c => c.tariff_name === 'Indexada OMIE')
  const avgOmieMwh = oldCoop
    ? (oldCoop.breakdown.energyEur / extraction.totalKwh) * 1000 - 30
    : 61

  console.log(`Extraction: ${extraction.provider} | ${extraction.periodStart}→${extraction.periodEnd}`)
  console.log(`Baseline: ${baselineEur}€ | ${extraction.totalKwh} kWh | kVA: ${contractedKva} | avgOMIE: ${avgOmieMwh.toFixed(1)} €/MWh`)

  // 3. Load all country tariffs
  const tariffs = await sql`
    select * from public.tariffs
    where country = ${extraction.country}
    order by provider`

  console.log(`Tariffs loaded: ${tariffs.length}`)

  // 4. Compute comparisons
  const comparisons = []
  for (const t of tariffs) {
    try {
      const breakdown = computePeriodCost({
        tariff: t,
        totalKwh: extraction.totalKwh,
        contractedKva,
        periodStart: extraction.periodStart,
        periodEnd: extraction.periodEnd,
        avgOmieMwh,
      })
      const savingsEur = baselineEur - breakdown.totalEur
      const savingsPct = (savingsEur / baselineEur) * 100
      comparisons.push({
        tariff_id: t.id,
        tariff_name: t.name,
        tariff_provider: t.provider,
        tariff_type: t.type,
        alternative_total_eur: breakdown.totalEur,
        savings_eur: savingsEur,
        savings_pct: savingsPct,
        breakdown,
      })
    } catch (e) {
      console.warn(`Skipping ${t.provider}: ${e.message}`)
    }
  }

  // Sort highest savings first
  comparisons.sort((a, b) => b.savings_eur - a.savings_eur)

  const best = comparisons[0]
  console.log(`\nBest: ${best.tariff_provider} — ${best.tariff_name}: ${best.alternative_total_eur.toFixed(2)}€ (saves ${best.savings_eur.toFixed(2)}€)`)

  // Print all
  console.log('\nAll comparisons:')
  comparisons.forEach(c =>
    console.log(`  ${c.tariff_provider.padEnd(16)} ${c.tariff_name.padEnd(26)} → ${c.alternative_total_eur.toFixed(2)}€  saves ${c.savings_eur.toFixed(2)}€ (${c.savings_pct.toFixed(1)}%)`)
  )

  // 5. Insert new audit row
  const newDetail = {
    extraction,
    consumption_source: detail.consumption_source,
    best_tariff_id: best.tariff_id,
    comparisons,
  }

  const [newAudit] = await sql`
    insert into public.audits
      (invoice_id, user_id, baseline_cost_eur, projected_cost_eur, savings_eur, savings_pct, alternative_tariff_id, detail)
    values (
      ${INVOICE_ID},
      ${userId},
      ${baselineEur},
      ${best.alternative_total_eur},
      ${best.savings_eur},
      ${best.savings_pct},
      ${best.tariff_id},
      ${JSON.stringify(newDetail)}
    )
    returning id, created_at`

  console.log(`\nNew audit inserted: ${newAudit.id} at ${newAudit.created_at}`)
  console.log('Done. Refresh the auditor page to see updated results.')
} finally {
  await sql.end()
}
