import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApplianceInput } from '@/lib/db/appliance-queries'
import type * as ApplianceQueries from '@/lib/db/appliance-queries'

/**
 * Action-level coverage for the frictionless onboarding light path: the
 * onboarding → appliance PERSISTENCE MAPPING and tariff defaulting.
 *
 * We assert that a described EV load is turned into the right `ApplianceInput` AND
 * persisted, that a default tariff is ensured, and that the user is routed to /plan.
 * The pure preset math is covered separately in `lib/onboarding/load-presets.test.ts`;
 * here we verify the action wires it to the DB layer correctly.
 *
 * Next.js runtime modules are mocked to thin shims so the action runs in `node`.
 */

// `redirect` throws a sentinel, exactly like Next.js' real NEXT_REDIRECT control flow.
const REDIRECT = 'NEXT_REDIRECT'
const redirectMock = vi.fn((url: string) => {
  throw new Error(`${REDIRECT}:${url}`)
})
vi.mock('next/navigation', () => ({
  redirect: (url: string) => redirectMock(url),
}))

// next-intl: `t(key)` echoes a readable label so the persisted appliance has a label.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => `label:${key}`),
}))

// Capture the profile update payload + expose an authenticated user.
const profileUpdate = vi.fn((_payload: Record<string, unknown>) => ({
  eq: vi.fn(async () => ({ error: null })),
}))
const supabaseFrom = vi.fn((_table: string) => ({ update: profileUpdate }))
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
    from: (table: string) => supabaseFrom(table),
  })),
}))

// DB layer: capture what gets persisted / defaulted.
const insertApplianceMock = vi.fn(async (..._a: unknown[]) => ({ id: 'appliance-1' }))
vi.mock('@/lib/db/appliance-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof ApplianceQueries>()
  return { ...actual, insertAppliance: (...a: unknown[]) => insertApplianceMock(...a) }
})

const ensureDefaultTariffMock = vi.fn(
  async (..._a: unknown[]): Promise<{ applied: boolean; tariffId: string | null }> => ({
    applied: true,
    tariffId: 'tariff-1',
  }),
)
vi.mock('@/lib/db/onboarding-queries', () => ({
  ensureDefaultTariff: (...a: unknown[]) => ensureDefaultTariffMock(...a),
}))

// Imported AFTER mocks are registered.
import { completeOnboarding } from './actions'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** Run the action and capture the redirect target the sentinel carries (or null). */
async function runAndCaptureRedirect(input: Parameters<typeof completeOnboarding>[0]) {
  try {
    const res = await completeOnboarding(input)
    return { redirectedTo: null as string | null, result: res }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.startsWith(REDIRECT)) {
      return { redirectedTo: message.slice(REDIRECT.length + 1), result: undefined }
    }
    throw err
  }
}

describe('completeOnboarding — light path (EV) persistence mapping', () => {
  const evInput = {
    country: 'PT' as const,
    next: '/dashboard',
    load: {
      profile: 'ev' as const,
      energyKwh: 40,
      availability: 'overnight' as const,
      daysPerWeek: 5,
    },
  }

  it('persists the EV as a planner-ready appliance with mapped fields', async () => {
    await runAndCaptureRedirect(evInput)

    expect(insertApplianceMock).toHaveBeenCalledTimes(1)
    const [, userId, appliance] = insertApplianceMock.mock.calls[0] as unknown as [
      unknown,
      string,
      ApplianceInput,
    ]
    expect(userId).toBe('user-1')
    expect(appliance.type).toBe('ev')
    expect(appliance.energyKwh).toBe(40)
    expect(appliance.powerKw).toBe(7.4)
    expect(appliance.interruptible).toBe(true)
    // Overnight → the 00:00–08:00 valley window the planner can optimise.
    expect(appliance.earliestHour).toBe(0)
    expect(appliance.latestHour).toBe(8)
    // Label comes from the localised appliance-type namespace.
    expect(appliance.label).toBe('label:types.ev')
  })

  it('ensures a default indexed tariff for the country', async () => {
    await runAndCaptureRedirect(evInput)
    expect(ensureDefaultTariffMock).toHaveBeenCalledTimes(1)
    const [, userId, country] = ensureDefaultTariffMock.mock.calls[0] as unknown as [
      unknown,
      string,
      string,
    ]
    expect(userId).toBe('user-1')
    expect(country).toBe('PT')
  })

  it('routes the user to /plan after adding a load', async () => {
    const { redirectedTo } = await runAndCaptureRedirect(evInput)
    expect(redirectedTo).toBe('/plan')
  })

  it('routes to /settings (not /plan) when the catalog has no tariff to default', async () => {
    // Empty catalog: ensureDefaultTariff sets nothing → land on the actionable settings
    // screen instead of a /plan that would only show a "configure your tariff" prompt.
    ensureDefaultTariffMock.mockResolvedValueOnce({ applied: false, tariffId: null })
    const { redirectedTo } = await runAndCaptureRedirect(evInput)
    expect(redirectedTo).toBe('/settings')
    // The load is still persisted — only the destination changes.
    expect(insertApplianceMock).toHaveBeenCalledTimes(1)
  })

  it('saves country + onboarded_at + locale on the profile', async () => {
    await runAndCaptureRedirect(evInput)
    expect(profileUpdate).toHaveBeenCalledTimes(1)
    const payload = (profileUpdate.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(payload.country).toBe('PT')
    expect(payload.locale).toBe('pt')
    expect(typeof payload.onboarded_at).toBe('string')
  })
})

describe('completeOnboarding — country-only (skip) path', () => {
  it('does not persist any appliance and honours `next`', async () => {
    const { redirectedTo } = await runAndCaptureRedirect({
      country: 'ES',
      next: '/dashboard',
    })
    expect(insertApplianceMock).not.toHaveBeenCalled()
    expect(ensureDefaultTariffMock).not.toHaveBeenCalled()
    expect(redirectedTo).toBe('/dashboard')
  })

  it('maps ES to the es locale', async () => {
    await runAndCaptureRedirect({ country: 'ES', next: '/dashboard' })
    const payload = (profileUpdate.mock.calls[0] as unknown as unknown[])[0] as Record<string, unknown>
    expect(payload.locale).toBe('es')
  })
})

describe('completeOnboarding — failure handling', () => {
  it('surfaces a load-provisioning error instead of stranding the user', async () => {
    insertApplianceMock.mockRejectedValueOnce(new Error('insert failed'))
    const { result, redirectedTo } = await runAndCaptureRedirect({
      country: 'PT',
      next: '/dashboard',
      load: { profile: 'ev' as const },
    })
    expect(redirectedTo).toBeNull()
    expect(result?.error).toBe('insert failed')
  })

  it('rejects an invalid country at the boundary', async () => {
    const { result } = await runAndCaptureRedirect({
      // @ts-expect-error — deliberately invalid to exercise the Zod guard.
      country: 'FR',
      next: '/dashboard',
    })
    expect(result?.error).toBe('Invalid input.')
  })
})
