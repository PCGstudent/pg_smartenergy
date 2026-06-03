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

/**
 * Vercel Cron entry point. Vercel calls cron paths with GET and injects
 * `Authorization: Bearer $CRON_SECRET`. Scheduled in vercel.json to run daily
 * after the OMIE day-ahead auction publishes (~13:00 CET), so tomorrow's prices
 * land without depending on an external scheduler. Ingests D+1 (and re-ingests
 * today as a cheap safety net). This is the robust path; Inngest's ingestOmieDaily
 * is a redundant backup that only fires if the Inngest app is synced.
 */
export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  // Vercel cron is authenticated by CRON_SECRET. Fall back to INGEST_SECRET so a
  // manual GET with the ingest bearer also works. Reject anything else.
  const ok =
    (cronSecret && auth === `Bearer ${cronSecret}`) ||
    (process.env.INGEST_SECRET && auth === `Bearer ${process.env.INGEST_SECRET}`)
  if (!ok) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Ingest tomorrow (D+1) and today, so the planner always has the prospective day
  // and a fresh fallback. Each is independent; one failing doesn't block the other.
  const targets = [addDays(new Date(), 1), new Date()]
  const results: Array<{ date: string; ok: boolean; upserted?: number; error?: string }> = []
  for (const date of targets) {
    const iso = date.toISOString().slice(0, 10)
    try {
      const text = await fetchOmieFile(date)
      const rows = parseOmie(text, date)
      const result = await upsertMarketPrices(toMarketPriceInserts(rows))
      results.push({ date: iso, ok: true, upserted: result.count })
    } catch (err) {
      results.push({ date: iso, ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  }
  const anyOk = results.some((r) => r.ok)
  return NextResponse.json({ ok: anyOk, results }, { status: anyOk ? 200 : 502 })
}
