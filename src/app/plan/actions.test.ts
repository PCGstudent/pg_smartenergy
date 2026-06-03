import { beforeEach, describe, expect, it, vi } from 'vitest'
import { APPLIANCE_NOT_FOUND } from '@/lib/db/appliance-queries'
import type * as ApplianceQueries from '@/lib/db/appliance-queries'

/**
 * Regression coverage for the "raw sentinel leak" fix: when the DB layer throws
 * `new Error(APPLIANCE_NOT_FOUND)` (RLS-filtered row, race-condition delete), the
 * action MUST surface the translated message, never the snake_case sentinel that
 * would otherwise be rendered verbatim in the destructive-text <p> in plan-view.
 *
 * The Next.js runtime modules are mocked to the thinnest shims that let the pure
 * mapping logic run in the `node` test environment (no jsdom, no real Supabase).
 */

// next-intl: `t(key)` echoes the key so we can assert the translated branch fired.
vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => `t:${key}`),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// Supabase: always an authenticated user; the query layer is what we drive per-test.
vi.mock('@/lib/supabase/server', () => ({
  createSupabaseServer: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  })),
}))

const deleteApplianceRow = vi.fn()
const updateApplianceRow = vi.fn()
const insertApplianceRow = vi.fn()

vi.mock('@/lib/db/appliance-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof ApplianceQueries>()
  return {
    ...actual, // keep APPLIANCE_TYPES, APPLIANCE_NOT_FOUND, decode helpers
    deleteAppliance: (...args: unknown[]) => deleteApplianceRow(...args),
    updateAppliance: (...args: unknown[]) => updateApplianceRow(...args),
    insertAppliance: (...args: unknown[]) => insertApplianceRow(...args),
  }
})

// Imported AFTER the mocks above are registered.
import { deleteAppliance, updateAppliance } from './actions'

const VALID_UPDATE = { label: 'Renamed' } as const

beforeEach(() => {
  vi.clearAllMocks()
})

describe('deleteAppliance — sentinel mapping', () => {
  it('maps APPLIANCE_NOT_FOUND to the translated message, not the raw sentinel', async () => {
    deleteApplianceRow.mockRejectedValueOnce(new Error(APPLIANCE_NOT_FOUND))

    const result = await deleteAppliance('missing-id')

    expect(result.error).toBe('t:couldNotDelete')
    expect(result.error).not.toContain(APPLIANCE_NOT_FOUND)
  })

  it('passes through an unrelated error message unchanged', async () => {
    deleteApplianceRow.mockRejectedValueOnce(new Error('network down'))

    const result = await deleteAppliance('some-id')

    expect(result.error).toBe('network down')
  })
})

describe('updateAppliance — sentinel mapping', () => {
  it('maps APPLIANCE_NOT_FOUND to the translated message, not the raw sentinel', async () => {
    updateApplianceRow.mockRejectedValueOnce(new Error(APPLIANCE_NOT_FOUND))

    const result = await updateAppliance('missing-id', VALID_UPDATE)

    expect(result.error).toBe('t:couldNotUpdate')
    expect(result.error).not.toContain(APPLIANCE_NOT_FOUND)
  })

  it('passes through an unrelated error message unchanged', async () => {
    updateApplianceRow.mockRejectedValueOnce(new Error('constraint violation'))

    const result = await updateAppliance('some-id', VALID_UPDATE)

    expect(result.error).toBe('constraint violation')
  })
})
