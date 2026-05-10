/**
 * One-shot OMIE ingest from the CLI.
 *
 *   pnpm ingest:omie                  # ingest D+1 (Madrid time)
 *   pnpm ingest:omie 2024-05-14       # ingest a specific date
 *   pnpm ingest:omie 2024-05-14 2024-05-20   # range (inclusive)
 *
 * Reads DATABASE_URL from .env.local. No Inngest required.
 */
import 'dotenv/config'
import { addDays, formatISO } from 'date-fns'
import { upsertMarketPrices } from '@/lib/db/queries'
import { fetchOmieFile, parseOmie, toMarketPriceInserts } from '@/lib/ingestion/omie'

async function ingest(date: Date) {
  const iso = formatISO(date, { representation: 'date' })
  process.stdout.write(`→ ${iso} ... `)
  try {
    const text = await fetchOmieFile(date)
    const rows = parseOmie(text, date)
    const result = await upsertMarketPrices(toMarketPriceInserts(rows))
    process.stdout.write(`OK (${rows.length} rows, ${result.count} upserted)\n`)
  } catch (err) {
    process.stdout.write(`FAIL — ${err instanceof Error ? err.message : String(err)}\n`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  let start: Date
  let end: Date

  if (args.length === 0) {
    start = end = addDays(new Date(), 1)
  } else if (args.length === 1) {
    start = end = new Date(`${args[0]}T00:00:00Z`)
  } else if (args.length === 2) {
    start = new Date(`${args[0]}T00:00:00Z`)
    end = new Date(`${args[1]}T00:00:00Z`)
  } else {
    console.error('Usage: pnpm ingest:omie [YYYY-MM-DD] [YYYY-MM-DD]')
    process.exit(1)
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    console.error('Invalid date(s).')
    process.exit(1)
  }

  for (let d = start; d.getTime() <= end.getTime(); d = addDays(d, 1)) {
    await ingest(d)
  }
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
