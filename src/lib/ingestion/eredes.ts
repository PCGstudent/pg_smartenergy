import { fromZonedTime } from 'date-fns-tz'

export interface EredesHour {
  ts: string // ISO 8601 UTC period-start
  kwh: number
}

export class EredesParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EredesParseError'
  }
}

/**
 * Parse an E-Redes hourly consumption CSV export (e-redes.pt customer portal).
 *
 * Handles the main variants seen in practice:
 *   A) "Data";"Hora";"Energia Activa Consumida (kWh)";…  (semicolon, quoted, comma decimals)
 *   B) Data;Hora;Consumo (kWh)                          (semicolon, unquoted, dot or comma)
 *   C) Data Inicio;Data Fim;Consumo Activo (kWh)        (two timestamp columns)
 *
 * Dates: YYYY-MM-DD or DD-MM-YYYY.
 * Hours: "HH:MM - HH:MM" or "HH:MM" or "HH" (local Lisbon time).
 * Output is sorted ascending by ts.
 */
export function parseEredesCSV(text: string): EredesHour[] {
  const lines = text.split(/\r?\n/)

  // ── 1. Locate the header row ─────────────────────────────────────────────
  let headerIdx = -1
  let dateCol = -1
  let hourCol = -1
  let kwhCol = -1
  let endDateCol = -1 // for format C

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i] ?? '')
    if (cells.length < 2) continue

    const norm = cells.map(normStr)

    // Try to identify columns
    const d = norm.findIndex((c) => c === 'data' || c === 'date' || c === 'data inicio')
    const h = norm.findIndex((c) => c === 'hora' || c === 'hour')
    const ef = norm.findIndex((c) => c === 'data fim')
    const k = norm.findIndex(
      (c) =>
        c.includes('consumid') ||
        c.includes('consumo') ||
        c.includes('activ') ||
        (c.includes('kwh') && !c.includes('kvarh')),
    )

    if (d >= 0 && k >= 0) {
      headerIdx = i
      dateCol = d
      hourCol = h // may be -1 for format C
      endDateCol = ef // may be -1 for formats A/B
      kwhCol = k
      break
    }
  }

  if (headerIdx === -1) {
    throw new EredesParseError(
      'Header row not found. Expected columns: Data, Hora, Energia Activa Consumida / Consumo (kWh). ' +
        'Make sure you are uploading an E-Redes hourly CSV (not monthly summary).',
    )
  }

  // ── 2. Parse data rows ───────────────────────────────────────────────────
  const out: EredesHour[] = []

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = (lines[i] ?? '').trim()
    if (!line) continue

    const cells = splitCsvLine(line)
    const maxCol = Math.max(dateCol, hourCol, kwhCol, endDateCol)
    if (cells.length <= maxCol) continue

    const rawDate = cells[dateCol]?.trim() ?? ''
    const rawKwh = cells[kwhCol]?.trim().replace(',', '.') ?? ''

    if (!rawDate || !rawKwh) continue

    const kwh = parseFloat(rawKwh)
    if (isNaN(kwh) || kwh < 0) continue

    let ts: string | null = null

    if (endDateCol >= 0) {
      // Format C: "Data Inicio" column contains full datetime "YYYY-MM-DD HH:MM"
      ts = parseDatetimeLocal(rawDate)
    } else if (hourCol >= 0) {
      // Formats A/B: separate date + hour columns
      const rawHour = cells[hourCol]?.trim() ?? ''
      const date = parseIsoDate(rawDate)
      const hour = parseHourInt(rawHour)
      if (date && hour !== null) {
        ts = localToUtc(`${date}T${pad(hour)}:00:00`)
      }
    }

    if (!ts) continue
    out.push({ ts, kwh })
  }

  if (out.length === 0) {
    throw new EredesParseError(
      'No data rows parsed. The CSV may be a monthly summary rather than hourly data. ' +
        'In the E-Redes portal, select "Hora" as the time granularity before downloading.',
    )
  }

  out.sort((a, b) => a.ts.localeCompare(b.ts))
  return out
}

// ── helpers ─────────────────────────────────────────────────────────────────

function normStr(s: string | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/^["'\s]+|["'\s]+$/g, '') // strip quotes + whitespace
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .trim()
}

/**
 * Minimal CSV line splitter for semicolon-delimited files, handles double-quoted fields.
 */
function splitCsvLine(line: string): string[] {
  const sep = line.includes(';') ? ';' : ','
  const out: string[] = []
  let field = ''
  let inQ = false
  for (const ch of (line ?? '')) {
    if (ch === '"') {
      inQ = !inQ
    } else if (ch === sep && !inQ) {
      out.push(field.trim().replace(/^"|"$/g, ''))
      field = ''
    } else {
      field += ch
    }
  }
  out.push(field.trim().replace(/^"|"$/g, ''))
  return out
}

/**
 * Parse "YYYY-MM-DD" or "DD-MM-YYYY" → "YYYY-MM-DD". Returns null on failure.
 */
function parseIsoDate(s: string): string | null {
  s = s.replace(/^"|"$/g, '').trim()
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  // DD-MM-YYYY or DD/MM/YYYY
  const m = s.match(/^(\d{2})[-/](\d{2})[-/](\d{4})/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return null
}

/**
 * Parse "HH:MM - HH:MM" or "HH:MM" or "HH" → start hour as int 0-23.
 */
function parseHourInt(s: string): number | null {
  const cleaned = s.replace(/^"|"$/g, '').trim()
  // "HH:MM - HH:MM" → take first HH
  const rangeMatch = cleaned.match(/^(\d{1,2})[:h](\d{2})/)
  if (rangeMatch) {
    const h = parseInt(rangeMatch[1] ?? '0', 10)
    return h >= 0 && h <= 23 ? h : null
  }
  // Plain "HH"
  const plain = parseInt(cleaned, 10)
  if (!isNaN(plain) && plain >= 0 && plain <= 23) return plain
  return null
}

/**
 * Parse "YYYY-MM-DD HH:MM" or "YYYY-MM-DDTHH:MM" → UTC ISO string (Lisbon TZ).
 */
function parseDatetimeLocal(s: string): string | null {
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  if (!m) return null
  return localToUtc(`${m[1]}T${m[2]}:00`)
}

function localToUtc(localIso: string): string {
  return fromZonedTime(localIso, 'Europe/Lisbon').toISOString()
}

function pad(n: number): string {
  return n.toString().padStart(2, '0')
}
