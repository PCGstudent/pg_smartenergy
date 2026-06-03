import { describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  APPLIANCE_NOT_FOUND,
  deleteAppliance,
  updateAppliance,
} from './appliance-queries'

/**
 * These tests pin the deceptive-success guard: an update/delete that affects ZERO rows
 * (id already gone, or RLS-filtered as another user's row) must THROW, not resolve.
 * Supabase returns no `error` in that case, so the only signal is the empty/null payload
 * surfaced by `.select('id')`. We assert both the throw and that the correct builder
 * chain (`.select('id')` + `.single()` for update) is used.
 */

type PostgrestResult = { data: unknown; error: unknown }

/** Records the builder calls so a test can assert the chain that was issued. */
interface CallLog {
  table?: string
  op?: 'update' | 'delete'
  selected?: string
  single: boolean
  eqArgs: Array<[string, unknown]>
}

/**
 * Minimal Supabase query-builder double. Each terminal (`.single()` for update,
 * the awaited `.select('id')` for delete) resolves to `result`. The builder is
 * thenable so `await client.from(...).delete().eq(...).select('id')` works.
 */
function mockClient(result: PostgrestResult): { client: SupabaseClient; log: CallLog } {
  const log: CallLog = { single: false, eqArgs: [] }

  const builder: Record<string, unknown> = {
    update(_row: unknown) {
      log.op = 'update'
      return builder
    },
    delete() {
      log.op = 'delete'
      return builder
    },
    eq(col: string, val: unknown) {
      log.eqArgs.push([col, val])
      return builder
    },
    select(cols: string) {
      log.selected = cols
      return builder
    },
    single() {
      log.single = true
      return Promise.resolve(result)
    },
    // Make the builder awaitable for the delete path (no `.single()`).
    then(onFulfilled: (value: PostgrestResult) => unknown, onRejected?: (reason: unknown) => unknown) {
      return Promise.resolve(result).then(onFulfilled, onRejected)
    },
  }

  const client = {
    from(table: string) {
      log.table = table
      return builder
    },
  } as unknown as SupabaseClient

  return { client, log }
}

describe('updateAppliance — affected-row guard', () => {
  it('throws APPLIANCE_NOT_FOUND when no row was updated (RLS-filtered or already gone)', async () => {
    const { client } = mockClient({ data: null, error: null })
    await expect(updateAppliance(client, 'missing-id', { label: 'X' })).rejects.toThrow(
      APPLIANCE_NOT_FOUND,
    )
  })

  it('resolves when the updated row is returned', async () => {
    const { client } = mockClient({ data: { id: 'a1' }, error: null })
    await expect(updateAppliance(client, 'a1', { label: 'X' })).resolves.toBeUndefined()
  })

  it('issues .select("id").single() so 0 rows is observable', async () => {
    const { client, log } = mockClient({ data: { id: 'a1' }, error: null })
    await updateAppliance(client, 'a1', { active: false })
    expect(log.table).toBe('user_appliances')
    expect(log.op).toBe('update')
    expect(log.selected).toBe('id')
    expect(log.single).toBe(true)
    expect(log.eqArgs).toContainEqual(['id', 'a1'])
  })

  it('propagates a Supabase error', async () => {
    const { client } = mockClient({ data: null, error: { message: 'boom' } })
    await expect(updateAppliance(client, 'a1', { label: 'X' })).rejects.toThrow()
  })
})

describe('deleteAppliance — affected-row guard', () => {
  it('throws APPLIANCE_NOT_FOUND when the delete matched no rows', async () => {
    const { client } = mockClient({ data: [], error: null })
    await expect(deleteAppliance(client, 'missing-id')).rejects.toThrow(APPLIANCE_NOT_FOUND)
  })

  it('resolves when at least one row was deleted', async () => {
    const { client } = mockClient({ data: [{ id: 'a1' }], error: null })
    await expect(deleteAppliance(client, 'a1')).resolves.toBeUndefined()
  })

  it('issues .delete().eq("id", id).select("id")', async () => {
    const { client, log } = mockClient({ data: [{ id: 'a1' }], error: null })
    await deleteAppliance(client, 'a1')
    expect(log.table).toBe('user_appliances')
    expect(log.op).toBe('delete')
    expect(log.selected).toBe('id')
    expect(log.eqArgs).toContainEqual(['id', 'a1'])
  })

  it('propagates a Supabase error instead of swallowing it', async () => {
    const { client } = mockClient({ data: null, error: { message: 'boom' } })
    await expect(deleteAppliance(client, 'a1')).rejects.toThrow()
  })
})
