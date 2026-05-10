import { NextResponse } from 'next/server'
import { addDays } from 'date-fns'
import { upsertMarketPrices } from '@/lib/db/queries'
import { fetchOmieFile, parseOmie, toMarketPriceInserts } from '@/lib/ingestion/omie'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Manual OMIE ingest trigger.
 *
 *   POST /api/ingest/omie
 *   Authorization: Bearer $INGEST_SECRET
 *   Content-Type: application/json
 *   { "date": "2024-05-14" }   // optional, defaults to D+1
 *
 * Runs synchronously — no Inngest dependency. Returns the count of upserted rows.
 * In production the daily cron (`ingestOmieDaily`) handles routine ingest.
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  const expected = process.env.INGEST_SECRET
  if (!expected) {
    return NextResponse.json(
      { error: 'INGEST_SECRET is not configured on the server' },
      { status: 500 },
    )
  }
  if (!auth || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let date: Date
  try {
    const body = (await req.json().catch(() => ({}))) as { date?: string }
    date = body.date ? new Date(`${body.date}T00:00:00Z`) : addDays(new Date(), 1)
    if (Number.isNaN(date.getTime())) {
      return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  try {
    const text = await fetchOmieFile(date)
    const rows = parseOmie(text, date)
    const inserts = toMarketPriceInserts(rows)
    const result = await upsertMarketPrices(inserts)
    return NextResponse.json({
      ok: true,
      date: date.toISOString().slice(0, 10),
      parsed: rows.length,
      upserted: result.count,
    })
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    )
  }
}

export async function GET() {
  return NextResponse.json(
    { error: 'Use POST with Authorization: Bearer $INGEST_SECRET' },
    { status: 405 },
  )
}
