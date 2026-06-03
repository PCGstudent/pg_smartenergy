import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertWithProfile, AlertEventRecord, PushSubscriptionJSON } from '@/lib/db/alert-queries'
import type * as AlertQueries from '@/lib/db/alert-queries'
import type * as DbQueries from '@/lib/db/queries'
import type * as WebPush from '@/lib/notifications/web-push'
import type * as WhatsApp from '@/lib/notifications/whatsapp'
import type { PushPayload } from '@/lib/notifications/web-push'
import type { WhatsAppMessage } from '@/lib/notifications/whatsapp'

/**
 * Coverage for the HOURLY Smart Guard dispatcher. We mock the DB-layer boundaries
 * (alerts, prices, events, subscription clear) and the real notification senders
 * (web-push, whatsapp), but use the REAL hourly translator so the test proves the
 * `alerts.hourly.*` copy exists and renders per-locale. Asserts the four adversarial
 * fixes: (1) localized title/body per profile locale, (2) hour label in the user's
 * own timezone, (3) an expired push subscription records `skipped` (not `failed`) and
 * is cleared, and (4) a single Supabase client is reused for the whole run.
 */

// --- a single sentinel client to prove reuse (no per-alert client creation) -------------
const SENTINEL_CLIENT = { __id: 'service-client' } as unknown as SupabaseClient
const createSupabaseServiceMock = vi.fn(() => SENTINEL_CLIENT)

vi.mock('@/lib/supabase/server', () => ({
  createSupabaseService: () => createSupabaseServiceMock(),
}))

// --- mocked data layer ------------------------------------------------------------------
const listActiveAlertsWithProfileMock = vi.fn<() => Promise<AlertWithProfile[]>>()
const getPricesInRangeMock = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const insertAlertEventMock = vi.fn(async (..._a: unknown[]) => {})
const recentAlertEventsMock = vi.fn<() => Promise<AlertEventRecord[]>>(async () => [])
const setProfilePushSubscriptionMock = vi.fn(async (..._a: unknown[]) => {})

vi.mock('@/lib/db/alert-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof AlertQueries>()
  return {
    ...actual,
    listActiveAlertsWithProfile: (...a: unknown[]) => listActiveAlertsWithProfileMock(...(a as [])),
    insertAlertEvent: (...a: unknown[]) => insertAlertEventMock(...a),
    recentAlertEvents: (...a: unknown[]) => recentAlertEventsMock(...(a as [])),
    setProfilePushSubscription: (...a: unknown[]) => setProfilePushSubscriptionMock(...a),
  }
})

vi.mock('@/lib/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof DbQueries>()
  return { ...actual, getPricesInRange: (...a: unknown[]) => getPricesInRangeMock(...a) }
})

// --- mocked notification senders --------------------------------------------------------
// We re-export the real error classes so dispatch's `instanceof` checks still work.
const sendWebPushMock = vi.fn(async (_sub: unknown, _payload: PushPayload) => {})
const sendWhatsAppMock = vi.fn(async (_msg: WhatsAppMessage) => ({ stubbed: true }))

vi.mock('@/lib/notifications/web-push', async (importOriginal) => {
  const actual = await importOriginal<typeof WebPush>()
  return {
    ...actual,
    sendWebPush: (sub: unknown, payload: PushPayload) => sendWebPushMock(sub, payload),
  }
})

vi.mock('@/lib/notifications/whatsapp', async (importOriginal) => {
  const actual = await importOriginal<typeof WhatsApp>()
  return { ...actual, sendWhatsApp: (msg: WhatsAppMessage) => sendWhatsAppMock(msg) }
})

// Imported AFTER mocks are registered.
import { evaluateAndDispatchAll } from './dispatch'
import { WebPushExpiredError } from '@/lib/notifications/web-push'

// --- fixtures ---------------------------------------------------------------------------
/** Reference "now": 2026-06-01 12:00 UTC (summer → Lisbon UTC+1, Madrid UTC+2). */
const NOW = new Date('2026-06-01T12:00:00Z')

const PUSH_SUB: PushSubscriptionJSON = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p', auth: 'a' },
}

function alertRow(
  over: Partial<AlertWithProfile> & Pick<AlertWithProfile, 'type'> & {
    country?: 'PT' | 'ES'
    locale?: string | null
    whatsapp?: string | null
    pushSub?: PushSubscriptionJSON | null
  },
): AlertWithProfile {
  return {
    id: over.id ?? `alert-${over.type}`,
    user_id: over.user_id ?? 'user-1',
    type: over.type,
    threshold_eur_mwh: over.threshold_eur_mwh ?? null,
    channels: over.channels ?? ['push'],
    active: true,
    schedule: over.schedule ?? null,
    created_at: NOW.toISOString(),
    profile: over.profile ?? {
      country: over.country ?? 'PT',
      push_subscription: over.pushSub === undefined ? PUSH_SUB : over.pushSub,
      whatsapp_e164: over.whatsapp ?? null,
      locale: over.locale ?? 'pt',
    },
  }
}

/** Hourly price rows for `country`; one clearly-cheap upcoming hour at 13:00 UTC. */
function cheapAt13Utc(priceEurMwh = 20) {
  return [
    { ts: new Date('2026-06-01T13:00:00Z'), priceEurMwh },
    { ts: new Date('2026-06-01T14:00:00Z'), priceEurMwh: 120 },
  ]
}

/** The payload of the FIRST web-push call. */
function firstPushPayload(): PushPayload {
  expect(sendWebPushMock).toHaveBeenCalled()
  return sendWebPushMock.mock.calls[0]![1]
}

beforeEach(() => {
  vi.clearAllMocks()
  recentAlertEventsMock.mockResolvedValue([])
  getPricesInRangeMock.mockResolvedValue(cheapAt13Utc())
  sendWebPushMock.mockResolvedValue(undefined)
  sendWhatsAppMock.mockResolvedValue({ stubbed: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('evaluateAndDispatchAll — localized copy', () => {
  it('renders the PT cheap_hour copy (no English) for a PT/pt user', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'pt', country: 'PT' }),
    ])

    const summary = await evaluateAndDispatchAll(NOW)

    expect(summary.dispatched).toBe(1)
    expect(summary.failed).toBe(0)
    const payload = firstPushPayload()
    expect(payload.title).toBe('🟢 Hora barata a chegar')
    // PT body mentions "energia"/"barata", never the English "energy".
    expect(payload.body).toMatch(/energia/i)
    expect(payload.body).not.toMatch(/\benergy\b/i)
  })

  it('renders the ES copy for a ES/es user', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'es', country: 'ES' }),
    ])

    await evaluateAndDispatchAll(NOW)

    const payload = firstPushPayload()
    expect(payload.title).toBe('🟢 Hora barata en camino')
    expect(payload.body).toMatch(/energía/i)
  })

  it('carries NO price figure in the body (product rule #2)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'en', country: 'PT' }),
    ])

    await evaluateAndDispatchAll(NOW)

    const { body } = firstPushPayload()
    // Neither a € figure nor the old raw-wholesale ¢/kWh leak (20 €/MWh → "2.00").
    expect(body).not.toMatch(/¢|€\s*\d|\d+[.,]\d+\s*(¢|€)/)
    expect(body).not.toContain('2.00')
  })
})

describe('evaluateAndDispatchAll — timezone of the hour label', () => {
  it('labels the 13:00 UTC slot as 14:00 for PT (Lisbon, UTC+1 in summer)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'pt', country: 'PT' }),
    ])

    await evaluateAndDispatchAll(NOW)

    expect(firstPushPayload().body).toContain('14:00')
  })

  it('labels the SAME 13:00 UTC slot as 15:00 for ES (Madrid, UTC+2 in summer)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'es', country: 'ES' }),
    ])

    await evaluateAndDispatchAll(NOW)

    const body = firstPushPayload().body
    expect(body).toContain('15:00')
    expect(body).not.toContain('14:00')
  })
})

describe('evaluateAndDispatchAll — expired push subscription', () => {
  it('records SKIPPED (not failed) and clears the dead subscription', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'pt', country: 'PT' }),
    ])
    sendWebPushMock.mockRejectedValue(new WebPushExpiredError('410 gone'))

    const summary = await evaluateAndDispatchAll(NOW)

    expect(summary.failed).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(summary.dispatched).toBe(0)

    // Subscription cleared via the threaded client.
    expect(setProfilePushSubscriptionMock).toHaveBeenCalledWith(SENTINEL_CLIENT, 'user-1', null)

    // The recorded event is a 'skipped' with the expiry reason — never a 'failed'.
    const statuses = insertAlertEventMock.mock.calls.map((c) => (c[1] as { status: string }).status)
    expect(statuses).toContain('skipped')
    expect(statuses).not.toContain('failed')
    const skipRow = insertAlertEventMock.mock.calls
      .map((c) => c[1] as { status: string; payload: Record<string, unknown> })
      .find((r) => r.status === 'skipped')
    expect(skipRow?.payload.reason).toBe('subscription_expired')
  })
})

describe('evaluateAndDispatchAll — missing push subscription', () => {
  it('records SKIPPED with reason no_push_subscription (never failed) and does not throw', async () => {
    // A push-channel alert for a user who never enabled push (push_subscription null).
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({
        type: 'cheap_hour',
        threshold_eur_mwh: 50,
        locale: 'pt',
        country: 'PT',
        channels: ['push'],
        pushSub: null,
      }),
    ])

    const summary = await evaluateAndDispatchAll(NOW)

    // A missing subscription is a normal config state — a skip, not a failure.
    expect(summary.failed).toBe(0)
    expect(summary.skipped).toBe(1)
    expect(summary.dispatched).toBe(0)

    // We never even attempt the send when there's no subscription.
    expect(sendWebPushMock).not.toHaveBeenCalled()

    const statuses = insertAlertEventMock.mock.calls.map((c) => (c[1] as { status: string }).status)
    expect(statuses).toContain('skipped')
    expect(statuses).not.toContain('failed')
    const skipRow = insertAlertEventMock.mock.calls
      .map((c) => c[1] as { status: string; payload: Record<string, unknown> })
      .find((r) => r.status === 'skipped')
    expect(skipRow?.payload.reason).toBe('no_push_subscription')
  })
})

describe('evaluateAndDispatchAll — stored event payload', () => {
  it('records the wholesale price under an unambiguous wholesale_eur_mwh key (never per-kWh)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', threshold_eur_mwh: 50, locale: 'pt', country: 'PT' }),
    ])
    getPricesInRangeMock.mockResolvedValue([
      { ts: new Date('2026-06-01T13:00:00Z'), priceEurMwh: 20 },
      { ts: new Date('2026-06-01T14:00:00Z'), priceEurMwh: 120 },
    ])

    await evaluateAndDispatchAll(NOW)

    const sentRow = insertAlertEventMock.mock.calls
      .map((c) => c[1] as { status: string; payload: Record<string, unknown> })
      .find((r) => r.status === 'sent')
    expect(sentRow).toBeTruthy()
    // The wholesale €/MWh figure is stored under the new, unambiguous name…
    expect(sentRow!.payload.wholesale_eur_mwh).toBe(20)
    // …and the old ambiguous `price_eur_mwh` name is gone.
    expect(sentRow!.payload).not.toHaveProperty('price_eur_mwh')
  })
})

describe('evaluateAndDispatchAll — single client reuse', () => {
  it('creates the Supabase service client exactly once for the whole run', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', id: 'a1', user_id: 'u1', threshold_eur_mwh: 50, country: 'PT' }),
      alertRow({ type: 'spike', id: 'a2', user_id: 'u2', threshold_eur_mwh: 100, country: 'PT' }),
    ])
    // Make the spike fire too (price 120 < 13:00? no — give a high upcoming hour).
    getPricesInRangeMock.mockResolvedValue([
      { ts: new Date('2026-06-01T13:00:00Z'), priceEurMwh: 20 }, // cheap for a1
      { ts: new Date('2026-06-01T14:00:00Z'), priceEurMwh: 250 }, // spike for a2
    ])

    await evaluateAndDispatchAll(NOW)

    // Exactly one client construction — no per-alert / per-error client churn.
    expect(createSupabaseServiceMock).toHaveBeenCalledTimes(1)
    // And every DB-layer call received that same sentinel client.
    for (const call of insertAlertEventMock.mock.calls) {
      expect(call[0]).toBe(SENTINEL_CLIENT)
    }
  })
})

describe('evaluateAndDispatchAll — whatsapp localization', () => {
  it('sends a localized PT body on the whatsapp channel', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({
        type: 'cheap_hour',
        threshold_eur_mwh: 50,
        channels: ['whatsapp'],
        country: 'PT',
        locale: 'pt',
        whatsapp: '+351912345678',
        pushSub: null,
      }),
    ])

    const summary = await evaluateAndDispatchAll(NOW)

    expect(summary.dispatched).toBe(1)
    expect(sendWhatsAppMock).toHaveBeenCalledTimes(1)
    const msg = sendWhatsAppMock.mock.calls[0]![0]
    expect(msg.to).toBe('+351912345678')
    expect(msg.body).toContain('🟢 Hora barata a chegar')
    expect(msg.body).toContain('14:00') // Lisbon label
  })
})
