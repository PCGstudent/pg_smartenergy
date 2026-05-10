import { GoogleGenAI } from '@google/genai'
import { INVOICE_EXTRACTION_PROMPT, InvoiceExtractionSchema, InvoiceJsonSchema, type InvoiceExtraction } from './invoice-schema'

/**
 * Gemini client wrapper for Voltwise AI tasks.
 * One file, one tool — keeps the surface area trivial and easy to swap.
 */

let _client: GoogleGenAI | null = null

function getClient(): GoogleGenAI {
  if (_client) return _client
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new Error(
      '[gemini] GEMINI_API_KEY is not set. Get one at https://aistudio.google.com/apikey and add it to .env.local.',
    )
  }
  _client = new GoogleGenAI({ apiKey })
  return _client
}

export class InvoiceExtractionError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message)
    this.name = 'InvoiceExtractionError'
  }
}

export interface ExtractInvoiceOptions {
  /** Override the default model (`gemini-2.5-flash`). Use Pro for tougher invoices. */
  model?: string
  /** Lower = more deterministic. We default to 0.1 because extraction shouldn't improvise. */
  temperature?: number
}

/**
 * Send a PDF to Gemini and parse a typed `InvoiceExtraction` back.
 *
 * @param pdfBuffer raw PDF bytes (≤ 20 MB; typical invoices are < 1 MB).
 * @param opts optional model + temperature overrides.
 */
export async function extractInvoice(
  pdfBuffer: Uint8Array | Buffer,
  opts: ExtractInvoiceOptions = {},
): Promise<InvoiceExtraction> {
  const ai = getClient()
  const model = opts.model ?? process.env.GEMINI_MODEL ?? 'gemini-2.5-flash'
  const temperature = opts.temperature ?? 0.1

  const base64 = Buffer.from(pdfBuffer).toString('base64')

  let raw: string
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [
        {
          role: 'user',
          parts: [
            { inlineData: { mimeType: 'application/pdf', data: base64 } },
            { text: INVOICE_EXTRACTION_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        // The SDK accepts a JSON-schema-shaped object here.
        responseSchema: InvoiceJsonSchema as unknown as Record<string, unknown>,
        temperature,
      },
    })
    raw = response.text ?? ''
  } catch (err) {
    throw new InvoiceExtractionError(
      `Gemini API call failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    )
  }

  if (!raw) {
    throw new InvoiceExtractionError('Gemini returned an empty response (likely safety-blocked or rate-limited).')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    throw new InvoiceExtractionError(
      `Gemini returned non-JSON: ${raw.slice(0, 200)}…`,
      err,
    )
  }

  const result = InvoiceExtractionSchema.safeParse(parsed)
  if (!result.success) {
    throw new InvoiceExtractionError(
      `Gemini response failed schema validation: ${JSON.stringify(result.error.flatten().fieldErrors)}`,
      result.error,
    )
  }

  return result.data
}
