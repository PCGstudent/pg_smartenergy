import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const env = readFileSync(join(__dirname, '../.env.local'), 'utf-8')
const db = env.match(/^DATABASE_URL=(.+)$/m)[1].trim()
const sql = postgres(db, { ssl: 'require', prepare: false })

const rows = await sql`
  select id, created_at, savings_eur, savings_pct,
         jsonb_array_length(detail->'comparisons') as n_comparisons
  from public.audits
  where invoice_id = '21494e60-e7b9-4db5-bbb8-a69f55ff3802'
  order by created_at desc
`
console.log(`Audits total: ${rows.length}`)
rows.forEach(r => console.log(`  ${r.created_at}  savings=${r.savings_eur}€  comparisons=${r.n_comparisons}`))
await sql.end()
