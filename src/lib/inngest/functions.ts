import { addDays, formatISO } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { upsertMarketPrices } from '@/lib/db/queries'
import { fetchOmieFile, parseOmie, toMarketPriceInserts } from '@/lib/ingestion/omie'
import { createSupabaseService } from '@/lib/supabase/server'
import { runAudit } from '@/lib/auditor/audit'
import { evaluateAndDispatchAll } from '@/lib/alerts/dispatch'
import { inngest } from './client'

/**
 * Daily OMIE ingest.
 * Cron fires at 14:30 Europe/Madrid — the day-ahead auction publishes ~13:00 CET.
 * Always targets D+1 in Madrid time (the next "operation day").
 */
export const ingestOmieDaily = inngest.createFunction(
  { id: 'ingest-omie-daily', retries: 3 },
  { cron: 'TZ=Europe/Madrid 30 14 * * *' },
  async ({ step }) => {
    const targetDate = await step.run('compute-target-date', () => {
      const nowMadrid = toZonedTime(new Date(), 'Europe/Madrid')
      const tomorrowMadrid = addDays(nowMadrid, 1)
      // Use UTC midnight of the Madrid date as the canonical target day.
      return fromZonedTime(
        `${tomorrowMadrid.getFullYear()}-${pad(tomorrowMadrid.getMonth() + 1)}-${pad(tomorrowMadrid.getDate())}T00:00:00`,
        'Europe/Madrid',
      ).toISOString()
    })

    const text = await step.run('fetch-omie', async () => {
      return fetchOmieFile(new Date(targetDate))
    })

    await step.run('archive-raw', async () => {
      const supa = createSupabaseService()
      const path = `omie/marginalpdbc_${(targetDate as string).slice(0, 10)}.1`
      const { error } = await supa.storage
        .from('raw')
        .upload(path, new Blob([text], { type: 'text/plain' }), {
          upsert: true,
          contentType: 'text/plain',
        })
      if (error && !/already exists/i.test(error.message)) {
        // Don't fail the whole job — archival is best-effort.
        // eslint-disable-next-line no-console
        console.warn('[ingest-omie] archive failed:', error.message)
      }
    })

    const inserted = await step.run('parse-and-upsert', async () => {
      const rows = parseOmie(text, new Date(targetDate))
      const inserts = toMarketPriceInserts(rows)
      const result = await upsertMarketPrices(inserts)
      return result.count
    })

    return { targetDate, inserted }
  },
)

/**
 * Manual / backfill trigger.
 * Fire with:
 *   await inngest.send({ name: 'voltwise/ingest.omie.requested', data: { date: '2024-05-14' } })
 */
export const ingestOmieManual = inngest.createFunction(
  { id: 'ingest-omie-manual', retries: 3 },
  { event: 'voltwise/ingest.omie.requested' },
  async ({ event, step }) => {
    const date = event.data.date
      ? new Date(`${event.data.date}T00:00:00Z`)
      : new Date()

    const text = await step.run('fetch', () => fetchOmieFile(date))
    const inserted = await step.run('parse-upsert', async () => {
      const rows = parseOmie(text, date)
      return (await upsertMarketPrices(toMarketPriceInserts(rows))).count
    })
    return { date: formatISO(date, { representation: 'date' }), inserted }
  },
)

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Triggered when a user finishes uploading an invoice PDF.
 * Runs the full Auditor pipeline: Gemini extraction → OMIE backfill →
 * tariff comparison → audit row → invoice status flip.
 *
 * Long-running (LLM call + possibly multi-day OMIE fetch). We bump
 * `maxDuration` in `vercel.json` to 60s for `/api/inngest`.
 */
export const processInvoice = inngest.createFunction(
  { id: 'process-invoice', retries: 2 },
  { event: 'voltwise/invoice.uploaded' },
  async ({ event, step }) => {
    const { invoiceId } = event.data
    const result = await step.run('run-audit', () => runAudit(invoiceId))
    return result
  },
)

/**
 * Smart Guard hourly evaluator.
 * Fires at :15 of every hour to give 15-minute slack after the OMIE 14:30 ingest
 * (so tomorrow's prices are loaded when we evaluate at 15:15).
 *
 * Strategy: load all active alerts, group by country (prices are country-wide),
 * evaluate the next 24h window per alert, dispatch matches respecting cooldown
 * and quiet hours. Fully idempotent within a 4h window.
 */
export const evaluateAlerts = inngest.createFunction(
  { id: 'evaluate-alerts', retries: 1 },
  { cron: 'TZ=Europe/Madrid 15 * * * *' },
  async ({ step }) => {
    const summary = await step.run('evaluate-and-dispatch', () =>
      evaluateAndDispatchAll(new Date()),
    )
    return summary
  },
)

/** Manual / replay trigger for the same evaluator. */
export const evaluateAlertsManual = inngest.createFunction(
  { id: 'evaluate-alerts-manual', retries: 1 },
  { event: 'voltwise/alerts.evaluate' },
  async ({ event, step }) => {
    const now = event.data.now ? new Date(event.data.now) : new Date()
    return step.run('evaluate-and-dispatch', () => evaluateAndDispatchAll(now))
  },
)

export const functions = [
  ingestOmieDaily,
  ingestOmieManual,
  processInvoice,
  evaluateAlerts,
  evaluateAlertsManual,
]
