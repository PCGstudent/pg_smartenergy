import { addDays, formatISO } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import { upsertMarketPrices } from '@/lib/db/queries'
import { fetchOmieFile, parseOmie, toMarketPriceInserts, OmieFetchError } from '@/lib/ingestion/omie'
import { fetchEnergyChartsDay } from '@/lib/ingestion/energycharts'
import { createSupabaseService } from '@/lib/supabase/server'
import { runAudit } from '@/lib/auditor/audit'
import { evaluateAndDispatchAll } from '@/lib/alerts/dispatch'
import { runDailyAnchors } from '@/lib/alerts/daily-runner'
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

    const { inserted, source } = await step.run('fetch-parse-upsert', async () => {
      const date = new Date(targetDate as string)
      try {
        const text = await fetchOmieFile(date)
        // Archive raw file (best-effort).
        try {
          const supa = createSupabaseService()
          const path = `omie/marginalpdbc_${(targetDate as string).slice(0, 10)}.1`
          await supa.storage
            .from('raw')
            .upload(path, new Blob([text], { type: 'text/plain' }), {
              upsert: true,
              contentType: 'text/plain',
            })
        } catch {
          // eslint-disable-next-line no-console
          console.warn('[ingest-omie] archive failed')
        }
        const rows = parseOmie(text, date)
        const count = (await upsertMarketPrices(toMarketPriceInserts(rows))).count
        return { inserted: count, source: 'OMIE' }
      } catch (omieErr) {
        if (!(omieErr instanceof OmieFetchError)) throw omieErr
        // eslint-disable-next-line no-console
        console.warn('[ingest-omie] OMIE unavailable, falling back to Energy-Charts:', (omieErr as Error).message)
        const inserts = await fetchEnergyChartsDay(date)
        const count = (await upsertMarketPrices(inserts)).count
        return { inserted: count, source: 'ENERGY_CHARTS' }
      }
    })

    return { targetDate, inserted, source }
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

    const { inserted, source } = await step.run('fetch-parse-upsert', async () => {
      try {
        const text = await fetchOmieFile(date)
        const rows = parseOmie(text, date)
        const count = (await upsertMarketPrices(toMarketPriceInserts(rows))).count
        return { inserted: count, source: 'OMIE' }
      } catch (omieErr) {
        if (!(omieErr instanceof OmieFetchError)) throw omieErr
        // eslint-disable-next-line no-console
        console.warn('[ingest-omie-manual] OMIE unavailable, falling back to Energy-Charts:', (omieErr as Error).message)
        const inserts = await fetchEnergyChartsDay(date)
        const count = (await upsertMarketPrices(inserts)).count
        return { inserted: count, source: 'ENERGY_CHARTS' }
      }
    })
    return { date: formatISO(date, { representation: 'date' }), inserted, source }
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

/**
 * Daily ANCHOR engine.
 * Fires once a day, AFTER tomorrow's day-ahead prices are loaded. OMIE publishes the
 * auction ~13:00 CET; our own `ingestOmieDaily` lands them at 14:30 Madrid. We run at
 * 15:00 Madrid so tomorrow's full FINAL curve is guaranteed present in `market_prices`
 * before we build anyone's anchor (vs the ~12:45 publish-time the planner UI quotes —
 * we deliberately wait for the ingest, not just the publish, to avoid an empty curve).
 *
 * Per active-alert user it builds tomorrow's FINAL curve and sends, in their locale and
 * euros only, the right message: the charging-window anchor, free/near-free energy, or a
 * price spike to avoid. Idempotent within a 12h window (one run/day).
 */
export const sendDailyAnchor = inngest.createFunction(
  { id: 'send-daily-anchor', retries: 1 },
  { cron: 'TZ=Europe/Madrid 0 15 * * *' },
  async ({ step }) => {
    return step.run('run-daily-anchors', () => runDailyAnchors({ now: new Date() }))
  },
)

/** Manual / replay trigger for the daily anchor (tests, ops backfill). */
export const sendDailyAnchorManual = inngest.createFunction(
  { id: 'send-daily-anchor-manual', retries: 1 },
  { event: 'voltwise/alerts.daily' },
  async ({ event, step }) => {
    const now = event.data.now ? new Date(event.data.now) : new Date()
    return step.run('run-daily-anchors', () => runDailyAnchors({ now }))
  },
)

export const functions = [
  ingestOmieDaily,
  ingestOmieManual,
  processInvoice,
  evaluateAlerts,
  evaluateAlertsManual,
  sendDailyAnchor,
  sendDailyAnchorManual,
]
