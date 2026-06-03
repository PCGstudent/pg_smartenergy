import { describe, expect, it } from 'vitest'
import { fetchOmieFile, parseOmie } from './omie'

/**
 * LIVE integration test — hits the real OMIE endpoint. Excluded from the default run
 * (see the filename guard below); run explicitly with:
 *   npx vitest run src/lib/ingestion/omie.live.test.ts
 * Proves the current download URL + quarter-hourly parsing work against real data.
 */
describe('OMIE live fetch+parse (network)', () => {
  it('fetches a real past date and aggregates to 24 hourly rows × 2 zones', async () => {
    const date = new Date(Date.UTC(2026, 4, 15)) // 2026-05-15
    const text = await fetchOmieFile(date)
    expect(text.startsWith('MARGINALPDBC')).toBe(true)

    const rows = parseOmie(text, date)
    expect(rows).toHaveLength(48) // 24 hours × {PT, ES}

    const pt = rows.filter((r) => r.zone === 'PT')
    expect(pt).toHaveLength(24)
    expect(pt.every((r) => Number.isFinite(r.priceEurMwh))).toBe(true)
  }, 30_000)
})
