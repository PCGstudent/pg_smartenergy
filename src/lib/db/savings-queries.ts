import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase-side access for `savings_ledger` (the per-day realized "€ saved" figure).
 *
 * Mirrors `alert-queries.ts`: every function takes a `SupabaseClient` so the caller
 * picks the security context — the daily-anchor runner upserts with a SERVICE-ROLE
 * client (bypasses RLS), while the /plan and /dashboard pages read with the user's
 * RLS-enforced client (a user only ever sees their own rows). Euros only, FINAL price.
 */

/** One entry in a day's per-appliance saving breakdown. */
export interface SavingBreakdownEntry {
  appliance_id: string
  label: string
  saving_eur: number
}

/** A ledger row as stored in Postgres (numeric arrives as a string via PostgREST). */
export interface SavingsLedgerRecord {
  id: string
  user_id: string
  date: string
  estimated_saving_eur: string | number
  breakdown: SavingBreakdownEntry[] | null
  created_at: string
  updated_at: string
}

/** What the runner writes for one (user, day). */
export interface SavingsLedgerUpsert {
  user_id: string
  date: string
  estimated_saving_eur: number
  breakdown: SavingBreakdownEntry[]
}

/** A cumulative total over a date range, in euros. */
export interface SavingsTotal {
  /** Sum of estimated_saving_eur across the matched rows, euros (2 dp). */
  totalEur: number
  /** Number of ledger days that contributed (for "X days saving" copy). */
  days: number
}

/**
 * Idempotent upsert of a day's saving for one user. Keyed on (user_id, date) so a
 * re-run (Inngest retry / manual replay) overwrites rather than duplicates — never
 * double-counting the cumulative total. Bumps `updated_at` on conflict.
 */
export async function upsertDailySaving(
  client: SupabaseClient,
  row: SavingsLedgerUpsert,
): Promise<void> {
  const { error } = await client
    .from('savings_ledger')
    .upsert(
      {
        user_id: row.user_id,
        date: row.date,
        estimated_saving_eur: row.estimated_saving_eur,
        breakdown: row.breakdown,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,date' },
    )
  if (error) throw error
}

/**
 * Cumulative € saved for a user since `sinceDate` (inclusive, a YYYY-MM-DD string).
 * Sums all ledger rows on/after that date. Returns a zeroed total when there are no
 * rows yet. The caller passes the start of the month / year in the user's local zone.
 */
export async function getCumulativeSaving(
  client: SupabaseClient,
  userId: string,
  sinceDate: string,
): Promise<SavingsTotal> {
  const { data, error } = await client
    .from('savings_ledger')
    .select('estimated_saving_eur')
    .eq('user_id', userId)
    .gte('date', sinceDate)
  if (error) throw error
  return sumRows(data as Pick<SavingsLedgerRecord, 'estimated_saving_eur'>[] | null)
}

/** Sum a set of ledger rows' euro amounts into a `SavingsTotal` (2 dp). */
function sumRows(rows: Pick<SavingsLedgerRecord, 'estimated_saving_eur'>[] | null): SavingsTotal {
  const list = rows ?? []
  const sum = list.reduce((acc, r) => acc + Number(r.estimated_saving_eur), 0)
  return { totalEur: Math.round(sum * 100) / 100, days: list.length }
}
