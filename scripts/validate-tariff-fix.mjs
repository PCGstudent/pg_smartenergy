/**
 * Offline validation of the tariff-math fix.
 * Reads the existing audit's extraction data + DB tariffs,
 * then re-runs comparisons locally with the new contractedKva logic.
 */
import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const db = env.match(/^DATABASE_URL=(.+)$/m)[1].trim()
const sql = postgres(db, { ssl: 'require', prepare: false })

// ── helpers (replicate tariff-math.ts logic) ──────────────────────────────
const DEFAULT_KVA = 6.9
const PT_IE = 0.001
const IVA = { PT: 0.06, ES: 0.21 }

function approxMonths(start, end) {
  const ms = new Date(end).getTime() - new Date(start).getTime() + 86400000
  return Math.max(0, ms / (30 * 86400000))
}

function computeCost({ tariff, baselineKwh, contractedKva, periodStart, periodEnd, avgOmieMwh }) {
  const months = approxMonths(periodStart, periodEnd)
  const kva = contractedKva ?? DEFAULT_KVA
  const formula = tariff.formula
  const fees = tariff.fees ?? {}

  let energyEur
  if (tariff.type === 'fixed') {
    energyEur = formula.fixed_eur_kwh * baselineKwh
  } else if (tariff.type === 'indexed') {
    energyEur = ((avgOmieMwh + formula.markup_eur_mwh) / 1000) * baselineKwh
  }

  const fixedEur = fees.fixed_monthly_eur_per_kva != null
    ? fees.fixed_monthly_eur_per_kva * kva * months
    : (fees.fixed_monthly_eur ?? 0) * months

  const ie = tariff.country === 'PT' ? baselineKwh * PT_IE : 0
  const iva = (energyEur + fixedEur + ie) * (IVA[tariff.country] ?? 0.06)
  const total = energyEur + fixedEur + ie + iva

  return { energyEur, fixedEur, ie, iva, total }
}

try {
  // Load extraction from latest audit
  const [audit] = await sql`
    select a.detail, a.baseline_cost_eur
    from public.audits a
    where a.invoice_id = '21494e60-e7b9-4db5-bbb8-a69f55ff3802'
    order by a.created_at desc limit 1`

  const detail = audit.detail
  const extraction = detail.extraction
  const baseline = Number(audit.baseline_cost_eur)

  console.log(`Invoice: ${extraction.provider} | ${extraction.periodStart} → ${extraction.periodEnd}`)
  console.log(`Baseline: ${baseline} € | ${extraction.totalKwh} kWh | contractedPowerKw: ${extraction.contractedPowerKw ?? 'null'}`)

  // Average OMIE price from existing comparisons (Coopérnico energy / kWh - markup)
  const coop = detail.comparisons.find(c => c.tariff_name === 'Indexada OMIE')
  const avgOmieMwh = coop
    ? (coop.breakdown.energyEur / extraction.totalKwh) * 1000 - 30
    : 61

  console.log(`Avg OMIE for period: ${avgOmieMwh.toFixed(1)} €/MWh\n`)

  const contractedKva = extraction.contractedPowerKw ?? DEFAULT_KVA

  // Load all PT tariffs
  const tariffs = await sql`select * from public.tariffs where country='PT' order by provider`

  console.log('Re-computed comparisons with new tariff data + kVA fix:')
  console.log('─'.repeat(72))

  const results = tariffs.map(t => {
    const cost = computeCost({
      tariff: t,
      baselineKwh: extraction.totalKwh,
      contractedKva,
      periodStart: extraction.periodStart,
      periodEnd: extraction.periodEnd,
      avgOmieMwh,
    })
    return { tariff: t, cost }
  }).sort((a, b) => a.cost.total - b.cost.total)

  for (const { tariff, cost } of results) {
    const savings = baseline - cost.total
    const pct = ((savings / baseline) * 100).toFixed(1)
    const kvaNote = tariff.fees?.fixed_monthly_eur_per_kva != null ? `(${contractedKva}kVA×${tariff.fees.fixed_monthly_eur_per_kva}€)` : ''
    console.log(
      `${tariff.provider.padEnd(18)} ${tariff.name.padEnd(28)} [${tariff.type.padEnd(7)}]` +
      `  Total: ${cost.total.toFixed(2)}€  Saves: ${savings.toFixed(2)}€ (${pct}%)  Fixed: ${cost.fixedEur.toFixed(2)}€${kvaNote}`
    )
  }
  console.log('─'.repeat(72))
  console.log(`Baseline (EDP actual bill): ${baseline}€`)
} finally {
  await sql.end()
}
