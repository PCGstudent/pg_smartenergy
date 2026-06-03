import postgres from 'postgres'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const envContent = readFileSync(join(__dirname, '../.env.local'), 'utf-8')

const dbUrl = envContent.match(/^DATABASE_URL=(.+)$/m)?.[1]?.trim()
const inngestEventKey = envContent.match(/^INNGEST_EVENT_KEY=(.+)$/m)?.[1]?.trim()

if (!dbUrl || !inngestEventKey) throw new Error('Missing env vars')

const sql = postgres(dbUrl, { ssl: 'require', prepare: false })

try {
  // Find the latest processed invoice
  const [invoice] = await sql`
    select id, user_id, storage_path, status
    from public.invoices
    order by created_at desc
    limit 1
  `
  if (!invoice) { console.log('No invoices found'); process.exit(0) }
  console.log(`Found invoice: ${invoice.id} (status: ${invoice.status})`)

  // Send Inngest event to re-process
  const payload = {
    name: 'invoice/uploaded',
    data: { invoiceId: invoice.id, userId: invoice.user_id },
  }
  const res = await fetch('https://inn.gs/e/' + inngestEventKey, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.text()
  console.log(`Inngest response [${res.status}]: ${body}`)
} finally {
  await sql.end()
}
