import { fromZonedTime } from 'date-fns-tz'
import type { MarketPriceInsert } from '@/lib/db/schema'
import { pad2 } from '@/lib/utils'

/**
 * OMIE Public Marginal Price Day-Ahead (PBC) ingestion.
 *
 * File: `marginalpdbc_YYYYMMDD.1`
 * Hosted at: https://www.omie.es/sites/default/files/dados/AGNO_YYYY/MES_MM/TXT/marginalpdbc_YYYYMMDD.1
 *
 * Format (semicolon-delimited, comma decimal separator, latin1):
 *
 *   MARGINALPDBC;DD/MM/YYYY;
 *   ;
 *   ;
 *   YYYY;MM;DD;HH;PRICE_ES_EUR_MWH;PRICE_PT_EUR_MWH;
 *   ...
 *   *
 *
 * `HH` = 1..24 in Europe/Madrid local time. `HH=1` means 00:00–01:00 local.
 * On DST transitions OMIE files may have 23 or 25 rows.
 */

const OMIE_BASE = 'https://www.omie.es/sites/default/files/dados'
const MADRID_TZ = 'Europe/Madrid'

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

/** Build the canonical OMIE PBC URL for a given target date. */
export function omieUrl(date: Date): string {
  const yyyy = date.getUTCFullYear()
  const mm = pad2(date.getUTCMonth() + 1)
  const dd = pad2(date.getUTCDate())
  return `${OMIE_BASE}/AGNO_${yyyy}/MES_${mm}/TXT/marginalpdbc_${yyyy}${mm}${dd}.1`
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
export function parseOmie(text: string, expectedDate?: Date): OmiePriceRow[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) throw new OmieParseError('Empty file')

  // Header: MARGINALPDBC;DD/MM/YYYY;
  const header = lines[0]
  if (!header || !header.startsWith('MARGINALPDBC')) {
    throw new OmieParseError('Missing MARGINALPDBC header', header)
  }
  const headerParts = header.split(';')
  const headerDate = headerParts[1]
  if (!headerDate || !/^\d{2}\/\d{2}\/\d{4}$/.test(headerDate)) {
    throw new OmieParseError(`Bad header date: ${headerDate}`, header)
  }
  if (expectedDate) {
    const [hd, hm, hy] = headerDate.split('/').map(Number) as [number, number, number]
    const ey = expectedDate.getUTCFullYear()
    const em = expectedDate.getUTCMonth() + 1
    const ed = expectedDate.getUTCDate()
    if (hy !== ey || hm !== em || hd !== ed) {
      throw new OmieParseError(
        `Header date ${headerDate} does not match expected ${ey}-${em}-${ed}`,
        header,
      )
    }
  }

  const rows: OmiePriceRow[] = []
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || line.startsWith('*')) continue
    // Data row pattern: YYYY;MM;DD;HH;PRICE_ES;PRICE_PT;
    const parts = line.split(';').map((p) => p.trim()).filter((p) => p !== '')
    if (parts.length < 6) continue
    const [yStr, mStr, dStr, hStr, esStr, ptStr] = parts as [
      string, string, string, string, string, string,
    ]
    if (!/^\d{4}$/.test(yStr)) continue // skip non-data rows

    const year = Number(yStr)
    const month = Number(mStr)
    const day = Number(dStr)
    const hour = Number(hStr) // 1..24 (or 1..23 on spring fwd, 1..25 on fall back)
    if (
      Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day) || Number.isNaN(hour) ||
      hour < 1 || hour > 25
    ) {
      throw new OmieParseError(`Invalid row ints: ${line}`, line)
    }

    const esPrice = parseDecimal(esStr)
    const ptPrice = parseDecimal(ptStr)
    if (esPrice == null || ptPrice == null) {
      throw new OmieParseError(`Invalid prices in row: ${line}`, line)
    }

    // Convert (date, hour-1) Madrid local → UTC. date-fns-tz handles DST.
    const localStr = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour - 1)}:00:00`
    const ts = fromZonedTime(localStr, MADRID_TZ)

    rows.push({ ts, zone: 'ES', priceEurMwh: esPrice })
    rows.push({ ts, zone: 'PT', priceEurMwh: ptPrice })
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
