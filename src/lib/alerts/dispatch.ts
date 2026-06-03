import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseService } from '@/lib/supabase/server'
import { getPricesInRange } from '@/lib/db/queries'
import {
  insertAlertEvent,
  listActiveAlertsWithProfile,
  recentAlertEvents,
  setProfilePushSubscription,
  type AlertWithProfile,
  type PushSubscriptionJSON,
} from '@/lib/db/alert-queries'
import {
  evaluateAlert,
  isInQuietHours,
  isWeekdayEnabled,
  pickPrimaryMatch,
  type AlertMatch,
  type EvaluatorAlert,
  type PricePoint,
} from './evaluator'
import { createHourlyTranslator, resolveMessageLocale } from './daily-i18n'
import type { Translate } from './daily-messages'
import type { Locale } from '@/i18n/config'
import { sendWebPush, WebPushExpiredError, WebPushNotConfiguredError } from '@/lib/notifications/web-push'
import { sendWhatsApp } from '@/lib/notifications/whatsapp'

const COOLDOWN_HOURS = 4
const LOOKAHEAD_HOURS = 24

const WHATSAPP_FOOTER = 'Voltwise · voltwise.app'

export interface DispatchSummary {
  evaluated: number
  matched: number
  dispatched: number
  skipped: number
  failed: number
}

/**
 * Cron entry-point: load every active alert, group by country (since prices
 * are country-wide), evaluate, dispatch, record. Idempotent within a 4h cooldown.
 */
export async function evaluateAndDispatchAll(now: Date = new Date()): Promise<DispatchSummary> {
  const supa = createSupabaseService()
  const alerts = await listActiveAlertsWithProfile(supa)

  const summary: DispatchSummary = {
    evaluated: alerts.length,
    matched: 0,
    dispatched: 0,
    skipped: 0,
    failed: 0,
  }

  if (alerts.length === 0) return summary

  // Group by country to amortize the price fetch.
  const byCountry = new Map<'PT' | 'ES', AlertWithProfile[]>()
  for (const a of alerts) {
    const c = a.profile?.country
    if (c !== 'PT' && c !== 'ES') continue
    const bucket = byCountry.get(c) ?? []
    bucket.push(a)
    byCountry.set(c, bucket)
  }

  const end = new Date(now.getTime() + LOOKAHEAD_HOURS * 3600 * 1000)

  // One translator per locale, shared across all alerts in this run (loads each catalog once).
  const translators = new Map<Locale, Translate>()

  for (const [country, alertsForCountry] of byCountry) {
    const priceRows = await getPricesInRange(country, now, end).catch(() => [])
    const prices: PricePoint[] = priceRows.map((p) => ({
      ts: p.ts as Date,
      priceEurMwh: Number(p.priceEurMwh),
    }))

    for (const alert of alertsForCountry) {
      const t = await translatorFor(translators, alert.profile.locale)
      const result = await processOne(supa, alert, prices, now, t)
      summary.matched += result.matched
      summary.dispatched += result.dispatched
      summary.skipped += result.skipped
      summary.failed += result.failed
    }
  }

  return summary
}

/** Resolve (and memoize) the hourly translator for a user's profile locale. */
async function translatorFor(
  cache: Map<Locale, Translate>,
  rawLocale: string | null,
): Promise<Translate> {
  const locale = resolveMessageLocale(rawLocale)
  const cached = cache.get(locale)
  if (cached) return cached
  const t = await createHourlyTranslator(locale)
  cache.set(locale, t)
  return t
}

interface OneResult {
  matched: number
  dispatched: number
  skipped: number
  failed: number
}

async function processOne(
  supa: SupabaseClient,
  alert: AlertWithProfile,
  prices: PricePoint[],
  now: Date,
  t: Translate,
): Promise<OneResult> {
  const out: OneResult = { matched: 0, dispatched: 0, skipped: 0, failed: 0 }

  // Skip during quiet hours / off-day.
  if (isInQuietHours(alert.schedule, now, alert.profile.country)) {
    return out
  }
  if (!isWeekdayEnabled(alert.schedule, now, alert.profile.country)) {
    return out
  }

  // Evaluate.
  const evalAlert: EvaluatorAlert = {
    id: alert.id,
    userId: alert.user_id,
    type: alert.type,
    thresholdEurMwh: alert.threshold_eur_mwh == null ? null : Number(alert.threshold_eur_mwh),
    channels: alert.channels,
    schedule: alert.schedule,
  }
  const matches = evaluateAlert(evalAlert, prices, now)
  out.matched = matches.length
  const primary = pickPrimaryMatch(matches)
  if (!primary) return out

  // Cooldown: skip if any event for this alert in the last COOLDOWN_HOURS.
  const since = new Date(now.getTime() - COOLDOWN_HOURS * 3600 * 1000)
  const recent = await recentAlertEvents(supa, alert.id, since.toISOString())
  if (recent.some((e) => e.status === 'sent')) {
    out.skipped++
    return out
  }

  // Build the user-facing copy in their locale, with the hour label in THEIR timezone.
  // No price figure: the hourly guard has no FINAL-price context (the daily anchor delivers
  // the properly-computed € figure). Product rules #1/#2.
  const time = hourLabel(primary.ts, alert.profile.country)
  const title = t(`${alert.type}.title`)
  const body = t(`${alert.type}.body`, { time })
  const channels = alert.channels.length > 0 ? alert.channels : ['push']

  for (const channel of channels) {
    try {
      if (channel === 'push') {
        const sent = await dispatchPush(supa, alert, primary, title, body)
        if (!sent.delivered) {
          // No subscription, or a dead one we just cleared — both are a skip, not a failure.
          await insertAlertEvent(supa, {
            alert_id: alert.id,
            user_id: alert.user_id,
            channel,
            payload: {
              reason: sent.reason ?? 'subscription_expired',
              target_ts: primary.ts.toISOString(),
            },
            status: 'skipped',
          })
          out.skipped++
          continue
        }
      } else if (channel === 'whatsapp') {
        await dispatchWhatsApp(alert, title, body)
      } else {
        // Unknown channel — record as skipped.
        await insertAlertEvent(supa, {
          alert_id: alert.id,
          user_id: alert.user_id,
          channel,
          payload: { reason: 'unknown_channel' },
          status: 'skipped',
        })
        out.skipped++
        continue
      }
      await insertAlertEvent(supa, {
        alert_id: alert.id,
        user_id: alert.user_id,
        channel,
        payload: {
          target_ts: primary.ts.toISOString(),
          // Stored as WHOLESALE €/MWh (product rule #1: internal/chart-only, never user-facing).
          // The name is unambiguous so future analytics/UI never misread it as a per-kWh figure.
          wholesale_eur_mwh: primary.priceEurMwh,
          title,
          body,
        },
        status: 'sent',
      })
      out.dispatched++
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await insertAlertEvent(supa, {
        alert_id: alert.id,
        user_id: alert.user_id,
        channel,
        payload: { error: message, target_ts: primary.ts.toISOString() },
        status: 'failed',
      }).catch(() => {})
      out.failed++
    }
  }

  return out
}

/**
 * Outcome of a push attempt. When `delivered` is false the `reason` explains why so the
 * caller records the right `skipped` reason: a never-subscribed user (`no_push_subscription`)
 * vs a subscription that went dead and was cleared (`subscription_expired`).
 */
interface PushResult {
  delivered: boolean
  reason?: 'no_push_subscription' | 'subscription_expired'
}

/**
 * Send one push. Neither a missing subscription (user never enabled push) nor a dead one
 * (HTTP 404/410) is an error: both return `{ delivered: false, reason }` so the caller
 * records a `skipped` (not a false `failed`) — matching the daily delivery contract.
 * Genuine failures (network, misconfig) still throw and surface as `failed`.
 */
async function dispatchPush(
  supa: SupabaseClient,
  alert: AlertWithProfile,
  primary: AlertMatch,
  title: string,
  body: string,
): Promise<PushResult> {
  const sub = alert.profile.push_subscription
  if (!sub) {
    // Not a failure — the user simply hasn't enabled push. Record a skip, like the daily runner.
    return { delivered: false, reason: 'no_push_subscription' }
  }
  try {
    await sendWebPush(sub as unknown as PushSubscriptionJSON, {
      title,
      body,
      url: '/dashboard',
      tag: `${alert.id}-${primary.ts.toISOString()}`,
    })
    return { delivered: true }
  } catch (err) {
    if (err instanceof WebPushExpiredError) {
      // Clean the dead subscription so we stop trying — and DON'T re-throw (no false failure).
      await setProfilePushSubscription(supa, alert.user_id, null).catch(() => {})
      return { delivered: false, reason: 'subscription_expired' }
    }
    if (err instanceof WebPushNotConfiguredError) {
      throw new Error('Web Push is not configured on the server. Set VAPID keys.')
    }
    throw err
  }
}

async function dispatchWhatsApp(
  alert: AlertWithProfile,
  title: string,
  body: string,
): Promise<void> {
  const number = alert.profile.whatsapp_e164
  if (!number) {
    throw new Error('User has no WhatsApp number on their profile.')
  }
  await sendWhatsApp({ to: number, body: `*${title}*\n${body}\n\n${WHATSAPP_FOOTER}` })
}

/** Hour:minute label for the target slot, in the user's own timezone (PT=Lisbon, ES=Madrid). */
function hourLabel(ts: Date, country: 'PT' | 'ES'): string {
  const timeZone = country === 'ES' ? 'Europe/Madrid' : 'Europe/Lisbon'
  const numberLocale = country === 'ES' ? 'es-ES' : 'pt-PT'
  return ts.toLocaleTimeString(numberLocale, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  })
}
