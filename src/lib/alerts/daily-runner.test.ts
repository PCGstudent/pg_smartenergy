import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AlertWithProfile, AlertEventRecord, PushSubscriptionJSON } from '@/lib/db/alert-queries'
import type { Appliance } from '@/lib/db/appliance-queries'
import type { PlanTariff } from '@/lib/pricing/plan-builder'
import type * as AlertQueries from '@/lib/db/alert-queries'
import type * as DbQueries from '@/lib/db/queries'
import type * as ApplianceQueries from '@/lib/db/appliance-queries'
import type { DailyAlertDelivery, DeliveryResult, DeliveryTarget } from './daily-delivery'
import type { DailyMessage } from './daily-messages'

/**
 * Orchestration coverage for the DAILY anchor runner. We mock the DB-layer module
 * boundaries (alerts, prices, tariff, appliances, events) and inject a FAKE delivery —
 * so the test exercises the real decision + message pipeline (`buildDayPlan` →
 * `decideDaily` → `buildDailyMessage`) against hand-built prices, WITHOUT touching push,
 * WhatsApp, or a database. Asserts: the right message kind is chosen, it routes to the
 * right channels, `alert_events` rows are recorded, and a re-run is idempotent.
 */

// --- mocked data layer -------------------------------------------------------

const listActiveAlertsWithProfileMock = vi.fn<() => Promise<AlertWithProfile[]>>()
const getPricesInRangeMock = vi.fn<(...a: unknown[]) => Promise<unknown>>()
const resolvePlanTariffMock = vi.fn<() => Promise<PlanTariff | null>>()
const listActiveAppliancesForUserMock = vi.fn<() => Promise<Appliance[]>>()
const insertAlertEventMock = vi.fn(async (..._a: unknown[]) => {})
const recentAlertEventsMock = vi.fn<() => Promise<AlertEventRecord[]>>(async () => [])
const setProfilePushSubscriptionMock = vi.fn(async (..._a: unknown[]) => {})

vi.mock('@/lib/db/alert-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof AlertQueries>()
  return {
    ...actual,
    listActiveAlertsWithProfile: () => listActiveAlertsWithProfileMock(),
    insertAlertEvent: (...a: unknown[]) => insertAlertEventMock(...a),
    recentAlertEvents: () => recentAlertEventsMock(),
    setProfilePushSubscription: (...a: unknown[]) => setProfilePushSubscriptionMock(...a),
  }
})

vi.mock('@/lib/db/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof DbQueries>()
  return { ...actual, getPricesInRange: (...a: unknown[]) => getPricesInRangeMock(...a) }
})

vi.mock('@/lib/pricing/plan-tariff', () => ({
  resolvePlanTariff: () => resolvePlanTariffMock(),
}))

vi.mock('@/lib/db/appliance-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof ApplianceQueries>()
  return { ...actual, listActiveAppliancesForUser: () => listActiveAppliancesForUserMock() }
})

// The savings ledger is a side-benefit of the run; stub its upsert so the orchestration
// test never touches a DB and we can assert the runner persisted the right day's saving.
const upsertDailySavingMock = vi.fn(async (..._a: unknown[]) => {})
vi.mock('@/lib/db/savings-queries', () => ({
  upsertDailySaving: (...a: unknown[]) => upsertDailySavingMock(...a),
}))

// Imported AFTER mocks are registered.
import { runDailyAnchors } from './daily-runner'

// --- fixtures ----------------------------------------------------------------

/** Reference "now": 2026-05-31 afternoon (Lisbon) → plans tomorrow 2026-06-01. */
const NOW = new Date('2026-05-31T15:00:00Z')

/** An indexed PT tariff: markup 5 €/MWh → FINAL ≈ (OMIE+5)/1000 + TAR + IEC, ×1.06. */
const INDEXED_PT: PlanTariff = {
  id: 'tariff-pt',
  country: 'PT',
  type: 'indexed',
  formula: { markup_eur_mwh: 5, taxes: { iva: 0.06, ie: 0.001 } },
}

/**
 * Tomorrow's wholesale OMIE day (€/MWh) with a DEEPLY negative night.
 *
 * Crucial FINAL-price reality (product rule #2): PT adds a flat 'simples' TAR of
 * 0.0607 €/kWh + IEC 0.001, then ×1.06 IVA. So a merely-slightly-negative wholesale hour
 * is NOT a near-free CUSTOMER hour. To make the FINAL price dip at/below zero (so the
 * free/negative message honestly fires) the night must be deeply negative:
 *   final = ((w+5)/1000 + 0.0607 + 0.001) × 1.06
 *   w = -80 → ((-0.075)+0.0617)×1.06 = -0.0141  (negative)
 *   w = -60 → (( -0.055)+0.0617)×1.06 =  0.0071  (≤ 0.02 → near-free)
 * The 06–08 valley (also within the EV's 0–8h window) is where the cheapest CHARGE slots
 * land for the anchor.
 */
const VALLEY_WHOLESALE_EUR_MWH = [
  -80, -90, -70, -60, -55, -50, // 00–05 → FINAL near/below zero (00–03 negative)
  -40, -30, 120, 130, 140, 150, // 06–07 still cheap (inside EV window), 08+ daytime
  140, 130, 120, 120, 130, 140,
  150, 160, 150, 130, 90, 50,
]

/** Build tomorrow's UTC hourly price rows from a €/MWh array (index = UTC hour). */
function tomorrowPriceRows(finals: number[]) {
  return finals.map((priceEurMwh, hour) => ({
    ts: new Date(`2026-06-01T${String(hour).padStart(2, '0')}:00:00Z`),
    priceEurMwh,
  }))
}

const PUSH_SUB: PushSubscriptionJSON = {
  endpoint: 'https://push.example/abc',
  keys: { p256dh: 'p', auth: 'a' },
}

function alertRow(over: Partial<AlertWithProfile> & Pick<AlertWithProfile, 'type'>): AlertWithProfile {
  return {
    id: over.id ?? `alert-${over.type}`,
    user_id: over.user_id ?? 'user-1',
    type: over.type,
    threshold_eur_mwh: null,
    channels: over.channels ?? ['push'],
    active: true,
    schedule: null,
    created_at: NOW.toISOString(),
    profile: over.profile ?? {
      country: 'PT',
      push_subscription: PUSH_SUB,
      whatsapp_e164: null,
      locale: 'pt',
    },
  }
}

function evApplianceRow(): Appliance {
  return {
    id: 'ev-1',
    userId: 'user-1',
    label: 'Carro elétrico',
    type: 'ev',
    energyKwh: 8,
    powerKw: 4,
    typicalDurationMin: 120,
    interruptible: true,
    earliestHour: 0,
    latestHour: 8, // overnight valley
    active: true,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  }
}

/** A delivery double that records every call and returns a configurable result. */
function recordingDelivery(result: DeliveryResult = { delivered: true }) {
  const pushCalls: Array<{ message: DailyMessage; target: DeliveryTarget }> = []
  const whatsappCalls: Array<{ message: DailyMessage; target: DeliveryTarget }> = []
  const emailCalls: Array<{ message: DailyMessage; target: DeliveryTarget }> = []
  const delivery: DailyAlertDelivery = {
    async sendPush(message, target) {
      pushCalls.push({ message, target })
      return result
    },
    async sendWhatsApp(message, target) {
      whatsappCalls.push({ message, target })
      return result
    },
    async sendEmail(message, target) {
      emailCalls.push({ message, target })
      return result
    },
  }
  return { delivery, pushCalls, whatsappCalls, emailCalls }
}

const STUB_CLIENT = {} as unknown as SupabaseClient

beforeEach(() => {
  vi.clearAllMocks()
  recentAlertEventsMock.mockResolvedValue([])
  getPricesInRangeMock.mockResolvedValue(tomorrowPriceRows(VALLEY_WHOLESALE_EUR_MWH))
  resolvePlanTariffMock.mockResolvedValue(INDEXED_PT)
  listActiveAppliancesForUserMock.mockResolvedValue([evApplianceRow()])
  upsertDailySavingMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runDailyAnchors — happy path', () => {
  it('sends the anchor + free message on a valley day and records events', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({ type: 'cheap_hour', id: 'a-cheap' }),
      alertRow({ type: 'free_energy', id: 'a-free' }),
    ])
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(summary.users).toBe(1)
    // Valley day → anchor (cheap_hour) + free (free_energy/negative). Negative hours present.
    expect(summary.decisions).toBe(2)
    expect(summary.delivered).toBe(2)
    expect(summary.failed).toBe(0)

    // Two push messages: one anchor, one negative/free.
    expect(pushCalls).toHaveLength(2)
    const titles = pushCalls.map((c) => c.message.title)
    // The free decision sees sub-zero hours → it renders the NEGATIVE copy.
    expect(titles.some((t) => t.includes('🔋'))).toBe(true) // anchor
    expect(titles.some((t) => t.includes('💸'))).toBe(true) // negative

    // One alert_events row per delivered message (status 'sent').
    const sentEvents = insertAlertEventMock.mock.calls
      .map((c) => c[1] as { status: string; payload: Record<string, unknown> })
      .filter((row) => row.status === 'sent')
    expect(sentEvents).toHaveLength(2)
    expect(sentEvents.every((e) => e.payload.target_date === '2026-06-01')).toBe(true)
  })

  it('routes to BOTH push and whatsapp when the alert lists both channels', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({
        type: 'cheap_hour',
        id: 'a-cheap',
        channels: ['push', 'whatsapp'],
        profile: { country: 'PT', push_subscription: PUSH_SUB, whatsapp_e164: '+351912345678', locale: 'pt' },
      }),
    ])
    const { delivery, pushCalls, whatsappCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(summary.delivered).toBe(2) // same anchor on two channels
    expect(pushCalls).toHaveLength(1)
    expect(whatsappCalls).toHaveLength(1)
    expect(pushCalls[0]!.message.title).toBe(whatsappCalls[0]!.message.title)
  })

  it('routes to EMAIL with the resolved address + localized CTA when the alert lists email', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([
      alertRow({
        type: 'cheap_hour',
        id: 'a-cheap',
        channels: ['email'],
        profile: { country: 'PT', push_subscription: null, whatsapp_e164: null, locale: 'pt' },
      }),
    ])
    // Client whose admin API resolves the user's email (email lives on auth.users).
    const client = {
      auth: { admin: { getUserById: vi.fn(async () => ({ data: { user: { email: 'ev@voltwise.local' } }, error: null })) } },
    } as unknown as SupabaseClient
    const { delivery, emailCalls, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client })

    expect(summary.delivered).toBe(1)
    expect(pushCalls).toHaveLength(0)
    expect(emailCalls).toHaveLength(1)
    expect(emailCalls[0]!.target.email).toBe('ev@voltwise.local')
    // Localized email extras are threaded through (pt CTA from alerts.daily.emailCta).
    expect(emailCalls[0]!.target.emailCtaLabel).toBe('Ver o meu plano')
    expect((emailCalls[0]!.target.emailFootnote ?? '').length).toBeGreaterThan(0)
  })

  it('persists the planned day saving to the ledger (idempotent per user+date)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour', id: 'a-cheap' })])
    const { delivery } = recordingDelivery()

    await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(upsertDailySavingMock).toHaveBeenCalledTimes(1)
    const row = upsertDailySavingMock.mock.calls[0]![1] as {
      user_id: string
      date: string
      estimated_saving_eur: number
    }
    expect(row.user_id).toBe('user-1')
    expect(row.date).toBe('2026-06-01') // tomorrow's local date
    // The valley day saves real euros for the EV (8 kWh in a deep-negative window).
    expect(row.estimated_saving_eur).toBeGreaterThan(0)
  })
})

describe('runDailyAnchors — idempotency', () => {
  it('does not re-send a kind already sent today (cooldown via recorded events)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour', id: 'a-cheap' })])
    // Pretend the anchor already went out for tomorrow.
    recentAlertEventsMock.mockResolvedValue([
      {
        id: 'e1',
        alert_id: 'a-cheap',
        user_id: 'user-1',
        sent_at: NOW.toISOString(),
        channel: 'push',
        payload: { kind: 'anchor', target_date: '2026-06-01' },
        status: 'sent',
      },
    ])
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls).toHaveLength(0)
    expect(summary.delivered).toBe(0)
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
  })

  it('stops retrying after 3 failed/skipped attempts for the same kind+date (attempt cap)', async () => {
    // A user whose channel keeps failing: three prior FAILED attempts for tomorrow's anchor.
    // The cap must treat this kind+date as handled and make no further delivery attempt.
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour', id: 'a-cheap' })])
    const failed = (id: string): AlertEventRecord => ({
      id,
      alert_id: 'a-cheap',
      user_id: 'user-1',
      sent_at: NOW.toISOString(),
      channel: 'push',
      payload: { kind: 'anchor', target_date: '2026-06-01' },
      status: 'failed',
    })
    recentAlertEventsMock.mockResolvedValue([failed('e1'), failed('e2'), failed('e3')])
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls).toHaveLength(0)
    expect(summary.delivered).toBe(0)
    expect(summary.skipped).toBeGreaterThanOrEqual(1)
  })

  it('still retries after only 2 prior failed attempts (below the cap)', async () => {
    // Two prior failures is under DAILY_MAX_ATTEMPTS (3) → a fresh attempt is allowed.
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour', id: 'a-cheap' })])
    const failed = (id: string): AlertEventRecord => ({
      id,
      alert_id: 'a-cheap',
      user_id: 'user-1',
      sent_at: NOW.toISOString(),
      channel: 'push',
      payload: { kind: 'anchor', target_date: '2026-06-01' },
      status: 'failed',
    })
    recentAlertEventsMock.mockResolvedValue([failed('e1'), failed('e2')])
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls.length).toBeGreaterThanOrEqual(1)
    expect(summary.delivered).toBeGreaterThanOrEqual(1)
  })
})

describe('runDailyAnchors — guards', () => {
  it('sends nothing when tomorrow has no prices yet', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour' })])
    getPricesInRangeMock.mockResolvedValue([])
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls).toHaveLength(0)
    expect(summary.delivered).toBe(0)
  })

  it('sends nothing when the user has only a FIXED tariff (flat curve)', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour' })])
    resolvePlanTariffMock.mockResolvedValue({
      id: 'fixed-pt',
      country: 'PT',
      type: 'fixed',
      formula: { fixed_eur_kwh: 0.15, taxes: { iva: 0.06, ie: 0.001 } },
    })
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls).toHaveLength(0)
    expect(summary.delivered).toBe(0)
  })

  it('ADVISES a DUAL tariff that carries an indexed markup (OMIE-tracking curve)', async () => {
    // A dual tariff with markup_eur_mwh is evaluated by applyFormulaPerKwh as an indexed
    // curve, so its FINAL price tracks OMIE hour-to-hour → the anchor should fire honestly.
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour', id: 'a-cheap' })])
    resolvePlanTariffMock.mockResolvedValue({
      id: 'dual-pt',
      country: 'PT',
      type: 'dual',
      formula: { markup_eur_mwh: 5, taxes: { iva: 0.06, ie: 0.001 } },
    })
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(summary.delivered).toBeGreaterThanOrEqual(1)
    expect(pushCalls.length).toBeGreaterThanOrEqual(1)
  })

  it('sends nothing for a DUAL tariff with only a FIXED sub-formula (flat curve)', async () => {
    // No markup_eur_mwh → applyFormulaPerKwh returns the same fixed €/kWh every hour → flat.
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour' })])
    resolvePlanTariffMock.mockResolvedValue({
      id: 'dual-fixed-pt',
      country: 'PT',
      type: 'dual',
      formula: { fixed_eur_kwh: 0.15, taxes: { iva: 0.06, ie: 0.001 } },
    })
    const { delivery, pushCalls } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(pushCalls).toHaveLength(0)
    expect(summary.delivered).toBe(0)
  })

  it('records a failed event and clears a dead push subscription on 410', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([alertRow({ type: 'cheap_hour' })])
    const { delivery } = recordingDelivery({
      delivered: false,
      subscriptionExpired: true,
      error: 'subscription_expired',
    })

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(summary.failed).toBe(1)
    expect(setProfilePushSubscriptionMock).toHaveBeenCalledWith(expect.anything(), 'user-1', null)
    const failedEvents = insertAlertEventMock.mock.calls
      .map((c) => c[1] as { status: string })
      .filter((row) => row.status === 'failed')
    expect(failedEvents).toHaveLength(1)
  })

  it('returns an empty summary when there are no active alerts', async () => {
    listActiveAlertsWithProfileMock.mockResolvedValue([])
    const { delivery } = recordingDelivery()

    const summary = await runDailyAnchors({ now: NOW, delivery, client: STUB_CLIENT })

    expect(summary).toMatchObject({ alerts: 0, users: 0, decisions: 0, delivered: 0 })
  })
})
