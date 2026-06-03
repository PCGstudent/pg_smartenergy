import { describe, expect, it } from 'vitest'
import { OmieParseError, omieUrl, parseOmie } from './omie'

const SAMPLE = `MARGINALPDBC;14/05/2024;
;
;
2024;05;14;01;76,87;76,87;
2024;05;14;02;71,69;71,69;
2024;05;14;03;65,46;65,46;
2024;05;14;04;62,11;62,11;
2024;05;14;05;61,55;61,55;
2024;05;14;06;65,33;65,33;
2024;05;14;07;72,40;72,40;
2024;05;14;08;82,15;82,15;
2024;05;14;09;78,90;78,90;
2024;05;14;10;55,20;55,20;
2024;05;14;11;30,10;30,10;
2024;05;14;12;15,55;15,55;
2024;05;14;13;5,00;5,00;
2024;05;14;14;0,00;0,00;
2024;05;14;15;-2,50;-2,50;
2024;05;14;16;3,00;3,00;
2024;05;14;17;25,40;25,40;
2024;05;14;18;55,00;55,00;
2024;05;14;19;88,30;88,30;
2024;05;14;20;110,15;110,15;
2024;05;14;21;145,00;145,00;
2024;05;14;22;130,50;130,50;
2024;05;14;23;105,33;105,33;
2024;05;14;24;88,33;88,33;
*`

describe('omieUrl', () => {
  it('builds the file-download URL with zero-padded month/day', () => {
    const d = new Date(Date.UTC(2024, 4, 14)) // 2024-05-14
    expect(omieUrl(d)).toBe(
      'https://www.omie.es/es/file-download?parents=marginalpdbc&filename=marginalpdbc_20240514.1',
    )
  })

  it('handles January (single-digit month)', () => {
    const d = new Date(Date.UTC(2024, 0, 1)) // 2024-01-01
    expect(omieUrl(d)).toBe(
      'https://www.omie.es/es/file-download?parents=marginalpdbc&filename=marginalpdbc_20240101.1',
    )
  })
})

describe('parseOmie', () => {
  it('parses 24 hourly rows × 2 zones = 48 rows', () => {
    const rows = parseOmie(SAMPLE)
    expect(rows).toHaveLength(48)
  })

  it('emits both PT and ES for each hour', () => {
    const rows = parseOmie(SAMPLE)
    const zones = new Set(rows.map((r) => r.zone))
    expect(zones).toEqual(new Set(['PT', 'ES']))
  })

  it('parses comma decimals correctly', () => {
    const rows = parseOmie(SAMPLE)
    // Spot-check: expect at least one row with 76.87 (comma-decimal source).
    const has76 = rows.some((r) => r.priceEurMwh === 76.87)
    expect(has76).toBe(true)
  })

  it('handles negative prices (key Voltwise feature)', () => {
    const rows = parseOmie(SAMPLE)
    const negative = rows.find((r) => r.priceEurMwh < 0)
    expect(negative).toBeDefined()
    expect(negative?.priceEurMwh).toBe(-2.5)
  })

  it('handles zero prices (free energy hours)', () => {
    const rows = parseOmie(SAMPLE)
    const zero = rows.filter((r) => r.priceEurMwh === 0)
    expect(zero.length).toBeGreaterThanOrEqual(2) // hour 14 PT + ES
  })

  it('converts hour 1 Madrid local → corresponding UTC', () => {
    const rows = parseOmie(SAMPLE)
    // 14 May 2024 is in CEST (UTC+2). Hour 1 = 00:00–01:00 Madrid = 22:00 UTC the previous day.
    const hour1 = rows.find((r) => r.zone === 'ES' && r.priceEurMwh === 76.87)
    expect(hour1?.ts.toISOString()).toBe('2024-05-13T22:00:00.000Z')
  })

  it('converts hour 24 Madrid local → 22:00 UTC same day in CEST', () => {
    const rows = parseOmie(SAMPLE)
    const hour24 = rows.find((r) => r.zone === 'ES' && r.priceEurMwh === 88.33)
    expect(hour24?.ts.toISOString()).toBe('2024-05-14T21:00:00.000Z')
  })

  it('rejects file without MARGINALPDBC header', () => {
    expect(() => parseOmie('FOO;bar;\n2024;05;14;01;1,0;1,0;\n*')).toThrow(OmieParseError)
  })

  it('rejects when expectedDate does not match the file date', () => {
    const expected = new Date(Date.UTC(2024, 4, 15))
    // Header no longer carries a date; the check now runs against the first data row.
    expect(() => parseOmie(SAMPLE, expected)).toThrow(/does not match expected/)
  })

  it('accepts expectedDate when it matches', () => {
    const expected = new Date(Date.UTC(2024, 4, 14))
    expect(() => parseOmie(SAMPLE, expected)).not.toThrow()
  })

  it('tolerates trailing * end marker and blank lines', () => {
    const rows = parseOmie(SAMPLE)
    expect(rows.every((r) => Number.isFinite(r.priceEurMwh))).toBe(true)
  })
})

// ── Current OMIE format (2026): no header date, 96 quarter-hourly periods. ──────────
// We build it programmatically so the per-hour means are easy to reason about: each hour H
// (0-based) has its four quarters set to [H, H, H, H]+offsets averaging exactly H+0.5.
function quarterHourlySample(): string {
  const lines = ['MARGINALPDBC;']
  for (let p = 1; p <= 96; p++) {
    const hour = Math.floor((p - 1) / 4) // 0..23
    const q = (p - 1) % 4 // 0..3
    // Quarter values hour-1, hour, hour+1, hour+2 → mean = hour + 0.5 exactly.
    const price = hour - 1 + q
    lines.push(`2026;05;15;${p};${price.toFixed(2)};${price.toFixed(2)};`)
  }
  lines.push('*')
  return lines.join('\n')
}

describe('parseOmie — quarter-hourly (current OMIE format)', () => {
  const QH = quarterHourlySample()

  it('aggregates 96 periods into 24 hourly rows × 2 zones = 48 rows', () => {
    expect(parseOmie(QH)).toHaveLength(48)
  })

  it('hourly price is the mean of that hour’s four quarters', () => {
    const rows = parseOmie(QH)
    // Hour 10 quarters = [9,10,11,12] → mean 10.5. Find the PT row at Madrid-local hour 10.
    // 15 May 2026 is CEST (UTC+2), so local 10:00 = 08:00 UTC.
    const h10 = rows.find((r) => r.zone === 'PT' && r.ts.toISOString() === '2026-05-15T08:00:00.000Z')
    expect(h10?.priceEurMwh).toBeCloseTo(10.5, 6)
  })

  it('still works with a header that has no date', () => {
    expect(() => parseOmie(QH)).not.toThrow()
  })

  it('validates expectedDate against the data rows in the dateless format', () => {
    expect(() => parseOmie(QH, new Date(Date.UTC(2026, 4, 15)))).not.toThrow()
    expect(() => parseOmie(QH, new Date(Date.UTC(2026, 4, 16)))).toThrow(/does not match expected/)
  })

  it('accepts dot decimals (the new endpoint emits them)', () => {
    const rows = parseOmie(QH)
    expect(rows.every((r) => Number.isFinite(r.priceEurMwh))).toBe(true)
  })
})
