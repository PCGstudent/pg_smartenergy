/**
 * Cumulative savings summary for the /plan + /dashboard pages.
 *
 * Reads the per-day `savings_ledger` and rolls it up into the month-to-date and
 * year-to-date "já poupaste X€" figures, in EUROS on the FINAL price. The date
 * boundaries are computed in the USER's local zone (so "this month" starts on the 1st
 * of their wall-clock month, not the server's), then the rows on/after that date are
 * summed by `getCumulativeSaving`.
 *
 * Returns null when there is nothing to show (no ledger rows in either window) so the
 * page can skip the card entirely on a brand-new account.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { toZonedTime } from 'date-fns-tz'
import { getCumulativeSaving } from '@/lib/db/savings-queries'

export interface SavingsSummary {
  /** € saved month-to-date (from the 1st of the user's local month). */
  monthEur: number
  /** € saved year-to-date (from Jan 1 of the user's local year). */
  yearEur: number
  /** Ledger days that contributed to the month figure (for "over N days" copy). */
  monthDays: number
}

/** Local YYYY-MM-DD of the 1st of `at`'s month, in `timeZone`. */
function startOfLocalMonth(at: Date, timeZone: string): string {
  const local = toZonedTime(at, timeZone)
  return `${local.getFullYear()}-${pad2(local.getMonth() + 1)}-01`
}

/** Local YYYY-MM-DD of Jan 1 of `at`'s year, in `timeZone`. */
function startOfLocalYear(at: Date, timeZone: string): string {
  const local = toZonedTime(at, timeZone)
  return `${local.getFullYear()}-01-01`
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/**
 * Load the cumulative month/year saving for a user. `client` should be the RLS-enforced
 * server client (the user only sees their own ledger). Returns null when both windows are
 * empty so the caller can omit the card. Best-effort euros: any read error bubbles up to
 * the caller, which already wraps page data loads in `.catch`.
 */
export async function loadSavingsSummary(
  client: SupabaseClient,
  userId: string,
  timeZone: string,
  now: Date = new Date(),
): Promise<SavingsSummary | null> {
  const monthStart = startOfLocalMonth(now, timeZone)
  const yearStart = startOfLocalYear(now, timeZone)

  const [month, year] = await Promise.all([
    getCumulativeSaving(client, userId, monthStart),
    getCumulativeSaving(client, userId, yearStart),
  ])

  // Nothing recorded yet in either window → no card.
  if (month.days === 0 && year.days === 0) return null

  return {
    monthEur: month.totalEur,
    yearEur: year.totalEur,
    monthDays: month.days,
  }
}
