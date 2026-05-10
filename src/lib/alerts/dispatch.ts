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
import { sendWebPush, WebPushExpiredError, WebPushNotConfiguredError } from '@/lib/notifications/web-push'
import { sendWhatsApp } from '@/lib/notifications/whatsapp'

const COOLDOWN_HOURS = 4
const LOOKAHEAD_HOURS = 24

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

  for (const [country, alertsForCountry] of byCountry) {
    const priceRows = await getPricesInRange(country, now, end).catch(() => [])
    const prices: PricePoint[] = priceRows.map((p) => ({
      ts: p.ts as Date,
      priceEurMwh: Number(p.priceEurMwh),
    }))

    for (const alert of alertsForCountry) {
      const result = await processOne(alert, prices, now)
      summary.matched += result.matched
      summary.dispatched += result.dispatched
      summary.skipped += result.skipped
      summary.failed += result.failed
    }
  }

  return summary
}

interface OneResult {
  matched: number
  dispatched: number
  skipped: number
  failed: number
}

async function processOne(
  alert: AlertWithProfile,
  prices: PricePoint[],
  now: Date,
): Promise<OneResult> {
  const supa = createSupabaseService()
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

  // Dispatch on each requested channel.
  const title = titleFor(alert.type)
  const body = primary.reason
  const channels = alert.channels.length > 0 ? alert.channels : ['push']

  for (const channel of channels) {
    try {
      if (channel === 'push') {
        await dispatchPush(alert, primary, title, body)
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
          price_eur_mwh: primary.priceEurMwh,
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

async function dispatchPush(
  alert: AlertWithProfile,
  primary: AlertMatch,
  title: string,
  body: string,
): Promise<void> {
  const sub = alert.profile.push_subscription
  if (!sub) {
    throw new Error('User has no push subscription. Ask them to enable notifications.')
  }
  try {
    await sendWebPush(sub as unknown as PushSubscriptionJSON, {
      title,
      body,
      url: '/dashboard',
      tag: `${alert.id}-${primary.ts.toISOString()}`,
    })
  } catch (err) {
    if (err instanceof WebPushExpiredError) {
      // Clean the dead subscription so we stop trying.
      const supa = createSupabaseService()
      await setProfilePushSubscription(supa, alert.user_id, null).catch(() => {})
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
  await sendWhatsApp({ to: number, body: `*${title}*\n${body}\n\nVoltwise · voltwise.app` })
}

function titleFor(type: 'cheap_hour' | 'free_energy' | 'spike' | 'negative'): string {
  switch (type) {
    case 'free_energy':
      return '⚡ Free energy ahead'
    case 'negative':
      return '💸 Negative price ahead'
    case 'cheap_hour':
      return '🟢 Cheap hour ahead'
    case 'spike':
      return '🔴 Price spike ahead'
  }
}
