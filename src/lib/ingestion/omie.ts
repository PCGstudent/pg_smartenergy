import { fromZonedTime } from 'date-fns-tz'
import type { MarketPriceInsert } from '@/lib/db/schema'
import { pad2 } from '@/lib/utils'

/**
 * OMIE Public Marginal Price Day-Ahead (PBC) ingestion.
 *
 * File: `marginalpdbc_YYYYMMDD.1`
 * Hosted at (current, 2026): the OMIE file-download endpoint —
 *   https://www.omie.es/es/file-download?parents=marginalpdbc&filename=marginalpdbc_YYYYMMDD.1
 * (The legacy /sites/default/files/dados/AGNO_YYYY/MES_MM/TXT/… path now 404s for every date.)
 *
 * Format (semicolon-delimited, comma OR dot decimal, latin1):
 *
 *   MARGINALPDBC;                       ← header (the trailing DD/MM/YYYY is no longer emitted)
 *   YYYY;MM;DD;P;PRICE_ES_EUR_MWH;PRICE_PT_EUR_MWH;
 *   ...
 *   *
 *
 * `P` is the intra-day PERIOD index in Europe/Madrid local time. OMIE moved from HOURLY (24
 * periods, P=1 → 00:00–01:00) to QUARTER-HOURLY (96 periods, P=1 → 00:00–00:15) in 2026.
 * On DST days a quarter-hourly file has 92 or 100 rows (hourly: 23 or 25).
 *
 * `market_prices` is hourly, so `parseOmie` AGGREGATES quarter-hourly files to the hourly mean
 * per zone (period P→ hour floor((P-1)/4)). Hourly files pass through unchanged. The granularity
 * is auto-detected from the max period index, so both formats keep working.
 */

const OMIE_DOWNLOAD_BASE = 'https://www.omie.es/es/file-download'
const MADRID_TZ = 'Europe/Madrid'
/** A day has >48 periods only in the quarter-hourly format (96, or 92/100 on DST days). */
const QUARTER_HOURLY_THRESHOLD = 48

export interface OmiePriceRow {
  ts: Date // period start, UTC
  zone: 'PT' | 'ES'
  priceEurMwh: number
}

export class OmieFetchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'OmieFetchError'
  }
}

export class OmieParseError extends Error {
  constructor(message: string, readonly line?: string) {
    super(message)
    this.name = 'OmieParseError'
  }
}

/** Build the current OMIE PBC download URL for a given target date. */
export function omieUrl(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = pad2(date.getUTCMonth() + 1)
  const dd = pad2(date.getUTCDate())
  const filename = `marginalpdbc_${yyyy}${mm}${dd}.1`
  return `${OMIE_DOWNLOAD_BASE}?parents=marginalpdbc&filename=${filename}`
}

/**
 * Download the OMIE PBC file for `date` and return its raw text body.
 * Throws OmieFetchError on non-2xx or empty body.
 */
export async function fetchOmieFile(date: Date, fetchImpl: typeof fetch = fetch): Promise<string> {
  const url = omieUrl(date)
  const res = await fetchImpl(url, {
    headers: { Accept: 'text/plain', 'User-Agent': 'Voltwise/0.1 (+https://voltwise.app)' },
    cache: 'no-store',
  })
  if (!res.ok) {
    throw new OmieFetchError(`OMIE fetch failed for ${url}: HTTP ${res.status}`, res.status)
  }
  const text = await res.text()
  if (!text || text.length < 50) {
    throw new OmieFetchError(`OMIE response too short for ${url} (${text.length} bytes)`)
  }
  return text
}

/**
 * Parse OMIE PBC text content into hourly price rows for both PT and ES.
 * Resilient to leading metadata lines, blank lines, comma decimals, and trailing `*`.
 *
 * @param text raw file content
 * @param expectedDate optional sanity check; throws if header date ≠ expected
 */
/** One raw period read from the file, before hourly aggregation. */
interface RawPeriod {
  year: number
  month: number
  day: number
  period: number // 1-based intra-day index (1..24 hourly, 1..96 quarter-hourly)
  esPrice: number
  ptPrice: number
}

export function parseOmie(text: string, expectedDate?: Date): OmiePriceRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) throw new OmieParseError('Empty file')

  // Header: "MARGINALPDBC;" — the legacy "DD/MM/YYYY" suffix is no longer emitted, so we no
  // longer parse a header date. The expectedDate check now runs against the data rows instead.
  const header = lines[0]
  if (!header || !header.startsWith('MARGINALPDBC')) {
    throw new OmieParseError('Missing MARGINALPDBC header', header)
  }

  // ── 1. Collect raw periods ────────────────────────────────────────────────
  const raw: RawPeriod[] = []
  let maxPeriod = 0
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.startsWith('*')) continue
    // Data row: YYYY;MM;DD;P;PRICE_ES;PRICE_PT;
    const parts = line.split(';').map((p) => p.trim()).filter((p) => p !== '')
    if (parts.length < 6) continue
    const [yStr, mStr, dStr, pStr, esStr, ptStr] = parts as [
      string, string, string, string, string, string,
    ]
    if (!/^\d{4}$/.test(yStr)) continue // skip non-data rows

    const year = Number(yStr)
    const month = Number(mStr)
    const day = Number(dStr)
    const period = Number(pStr) // 1..24 hourly, or 1..96 quarter-hourly (±DST)
    if (
      Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(period) ||
      period < 1 || period > 100
    ) {
      throw new OmieParseError(`Invalid row ints: ${line}`, line)
    }

    const esPrice = parseDecimal(esStr)
    const ptPrice = parseDecimal(ptStr)
    if (esPrice == null || ptPrice == null) {
      throw new OmieParseError(`Invalid prices in row: ${line}`, line)
    }

    raw.push({ year, month, day, period, esPrice, ptPrice })
    if (period > maxPeriod) maxPeriod = period
  }

  if (raw.length === 0) throw new OmieParseError('No data rows parsed')

  if (expectedDate) {
    const { year, month, day } = raw[0]!
    const ey = expectedDate.getUTCFullYear()
    const em = expectedDate.getUTCMonth() + 1
    const ed = expectedDate.getUTCDate()
    if (year !== ey || month !== em || day !== ed) {
      throw new OmieParseError(
        `File date ${year}-${pad2(month)}-${pad2(day)} does not match expected ${ey}-${pad2(em)}-${pad2(ed)}`,
      )
    }
  }

  // ── 2. Map each period to its START hour, averaging quarter-hours into the hour ──
  // Quarter-hourly: 4 periods per hour → hour = floor((P-1)/4). Hourly: hour = P-1.
  const isQuarterHourly = maxPeriod > QUARTER_HOURLY_THRESHOLD
  const periodsPerHour = isQuarterHourly ? 4 : 1

  // Accumulate ES/PT sums per START hour so the result is always hourly.
  const byHour = new Map<number, { y: number; m: number; d: number; hour: number; esSum: number; ptSum: number; n: number }>()
  for (const r of raw) {
    const hour = Math.floor((r.period - 1) / periodsPerHour)
    const existing = byHour.get(hour)
    if (existing) {
      existing.esSum += r.esPrice
      existing.ptSum += r.ptPrice
      existing.n += 1
    } else {
      byHour.set(hour, { y: r.year, m: r.month, d: r.day, hour, esSum: r.esPrice, ptSum: r.ptPrice, n: 1 })
    }
  }

  const rows: OmiePriceRow[] = []
  for (const h of [...byHour.values()].sort((a, b) => a.hour - b.hour)) {
    // Convert (date, hour) Madrid local → UTC. date-fns-tz handles DST.
    const localStr = `${h.y}-${pad2(h.m)}-${pad2(h.d)}T${pad2(h.hour)}:00:00`
    const ts = fromZonedTime(localStr, MADRID_TZ)
    rows.push({ ts, zone: 'ES', priceEurMwh: h.esSum / h.n })
    rows.push({ ts, zone: 'PT', priceEurMwh: h.ptSum / h.n })
  }

  if (rows.length === 0) throw new OmieParseError('No data rows parsed')
  return rows
}

/** Parse "76,87" → 76.87. Returns null on bad input. */
function parseDecimal(s: string): number | null {
  if (typeof s !== 'string') return null
  const normalized = s.replace(',', '.')
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/** Convert OMIE rows to Drizzle insert rows. */
export function toMarketPriceInserts(rows: OmiePriceRow[]): MarketPriceInsert[] {
  return rows.map((r) => ({
    ts: r.ts,
    zone: r.zone,
    priceEurMwh: r.priceEurMwh.toString(),
    source: 'OMIE_PBC',
  }))
}
