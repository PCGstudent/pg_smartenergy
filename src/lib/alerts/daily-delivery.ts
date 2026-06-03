/**
 * DAILY alert delivery — the seam between the pure decision/runner logic and the real
 * push / WhatsApp side-effects.
 *
 * The runner depends only on the `DailyAlertDelivery` interface, so tests inject a fake
 * recorder and assert the DECISION + message content WITHOUT sending anything. The real
 * implementation (`createDefaultDelivery`) wraps the existing `web-push` / `whatsapp`
 * dispatchers and surfaces a dead-subscription signal so the runner can clean it up —
 * exactly as the hourly `dispatch.ts` does.
 */

import {
  sendWebPush,
  WebPushExpiredError,
  WebPushNotConfiguredError,
} from '@/lib/notifications/web-push'
import { sendWhatsApp } from '@/lib/notifications/whatsapp'
import { sendEmail, isResendConfigured, dailyAlertHtml } from '@/lib/email/resend'
import { clientEnv } from '@/lib/env'
import type { PushSubscriptionJSON } from '@/lib/db/alert-queries'
import type { DailyMessage } from './daily-messages'

/** Per-attempt outcome the runner records into `alert_events`. */
export interface DeliveryResult {
  /** True when the message was handed off to the channel successfully. */
  delivered: boolean
  /**
   * Set when a push subscription is dead (HTTP 404/410) — the runner clears it so we
   * stop trying. Only ever set for the `push` channel.
   */
  subscriptionExpired?: boolean
  /** Human-readable failure reason when `delivered` is false. */
  error?: string
}

/** What a channel needs to actually deliver one message to one user. */
export interface DeliveryTarget {
  /** Where a push notification click should land (also the email CTA target). */
  url?: string
  /** De-dup tag for the browser (push only). */
  tag?: string
  /** The user's push subscription JSON (push only; null when not subscribed). */
  pushSubscription?: PushSubscriptionJSON | null
  /** The user's E.164 WhatsApp number (whatsapp only; null when not set). */
  whatsappE164?: string | null
  /** The user's email address (email only; null when not resolvable). */
  email?: string | null
  /** Localized "open my plan" CTA label for the email button (email only). */
  emailCtaLabel?: string
  /** Localized footnote for the email footer (email only). */
  emailFootnote?: string
}

/** The delivery seam. Real impl sends; the test impl records. */
export interface DailyAlertDelivery {
  sendPush(message: DailyMessage, target: DeliveryTarget): Promise<DeliveryResult>
  sendWhatsApp(message: DailyMessage, target: DeliveryTarget): Promise<DeliveryResult>
  sendEmail(message: DailyMessage, target: DeliveryTarget): Promise<DeliveryResult>
}

/** Sign-off appended to WhatsApp bodies (push uses title/body only). */
const WHATSAPP_FOOTER = 'Voltwise · voltwise.app'

/**
 * Production delivery: wraps the real web-push + WhatsApp Cloud API senders.
 * Failures are returned as `DeliveryResult`s (never thrown) so one bad channel can't
 * abort a batch of users — the runner records each outcome independently.
 */
export function createDefaultDelivery(): DailyAlertDelivery {
  return {
    async sendPush(message, target) {
      const sub = target.pushSubscription
      if (!sub) {
        return { delivered: false, error: 'no_push_subscription' }
      }
      try {
        await sendWebPush(sub, {
          title: message.title,
          body: message.body,
          url: target.url ?? '/plan',
          tag: target.tag ?? 'voltwise-daily',
        })
        return { delivered: true }
      } catch (err) {
        if (err instanceof WebPushExpiredError) {
          return { delivered: false, subscriptionExpired: true, error: 'subscription_expired' }
        }
        if (err instanceof WebPushNotConfiguredError) {
          return { delivered: false, error: 'web_push_not_configured' }
        }
        return { delivered: false, error: messageOf(err) }
      }
    },

    async sendWhatsApp(message, target) {
      const number = target.whatsappE164
      if (!number) {
        return { delivered: false, error: 'no_whatsapp_number' }
      }
      try {
        await sendWhatsApp({
          to: number,
          body: `*${message.title}*\n${message.body}\n\n${WHATSAPP_FOOTER}`,
        })
        return { delivered: true }
      } catch (err) {
        return { delivered: false, error: messageOf(err) }
      }
    },

    async sendEmail(message, target) {
      const to = target.email
      if (!to) {
        return { delivered: false, error: 'no_email' }
      }
      if (!isResendConfigured()) {
        return { delivered: false, error: 'email_not_configured' }
      }
      try {
        const ctaUrl = absoluteUrl(target.url ?? '/plan')
        await sendEmail({
          to,
          subject: message.title,
          html: dailyAlertHtml({
            title: message.title,
            body: message.body,
            ctaLabel: target.emailCtaLabel ?? 'Voltwise',
            ctaUrl,
            footnote: target.emailFootnote ?? WHATSAPP_FOOTER,
          }),
        })
        return { delivered: true }
      } catch (err) {
        return { delivered: false, error: messageOf(err) }
      }
    },
  }
}

/** Resolve a relative path to an absolute URL using the configured app origin. */
function absoluteUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path
  const base = clientEnv.NEXT_PUBLIC_APP_URL.replace(/\/$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
