import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()

const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

try {
  const [inv] = await sql`select id, status from public.invoices order by created_at desc limit 1`
  console.log(`Invoice ${inv.id}: status=${inv.status}`)

  const audits = await sql`
    select
      a.id,
      a.created_at,
      a.baseline_cost_eur,
      a.projected_cost_eur,
      a.savings_eur,
      a.savings_pct,
      (a.detail->'comparisons') as comparisons
    from public.audits a
    where a.invoice_id = ${inv.id}
    order by a.created_at desc
    limit 1
  `
  if (!audits.length) { console.log('No audit yet'); process.exit(0) }

  const audit = audits[0]
  console.log(`\nLatest audit created: ${audit.created_at}`)
  console.log(`Baseline: ${audit.baseline_cost_eur} €`)
  console.log(`Projected (best): ${audit.projected_cost_eur} €`)
  console.log(`Savings: ${audit.savings_eur} € (${audit.savings_pct}%)`)

  const comps = audit.comparisons
  if (comps) {
    console.log(`\nAll comparisons (${comps.length}):`)
    comps.forEach(c => {
      console.log(`  ${c.tariff_provider} — ${c.tariff_name} [${c.tariff_type}]: ${c.alternative_total_eur?.toFixed(2)} € (saves ${c.savings_eur?.toFixed(2)} €)`)
    })
  }
} finally {
  await sql.end()
}
