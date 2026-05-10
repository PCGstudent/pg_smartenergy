import webpush, { type PushSubscription } from 'web-push'

let _configured = false

function configure(): void {
  if (_configured) return
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT ?? 'mailto:hello@voltwise.app'
  if (!publicKey || !privateKey) {
    throw new WebPushNotConfiguredError(
      'VAPID keys missing. Run `npx web-push generate-vapid-keys` and set NEXT_PUBLIC_VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY in .env.local.',
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
  _configured = true
}

export class WebPushNotConfiguredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebPushNotConfiguredError'
  }
}

export class WebPushExpiredError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WebPushExpiredError'
  }
}

export interface PushPayload {
  title: string
  body: string
  /** URL to open when the user clicks the notification. */
  url?: string
  /** Tag for de-duplication on the browser side. */
  tag?: string
}

/**
 * Send a single Web Push notification.
 * Throws WebPushExpiredError on 410/404 — caller should clear the subscription.
 */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: PushPayload,
): Promise<void> {
  configure()
  try {
    await webpush.sendNotification(
      subscription,
      JSON.stringify({
        title: payload.title,
        body: payload.body,
        url: payload.url ?? '/dashboard',
        tag: payload.tag ?? 'voltwise',
      }),
      { TTL: 3600 }, // 1h: alerts are time-sensitive, no point delivering hours late
    )
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) {
      throw new WebPushExpiredError(
        `Subscription ${maskEndpoint(subscription.endpoint)} is no longer valid (HTTP ${status}).`,
      )
    }
    throw err
  }
}

function maskEndpoint(endpoint: string): string {
  return endpoint.length > 40 ? `${endpoint.slice(0, 24)}…${endpoint.slice(-12)}` : endpoint
}
