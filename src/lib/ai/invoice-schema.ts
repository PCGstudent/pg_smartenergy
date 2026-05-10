import { z } from 'zod'

/**
 * Zod schema for what we expect Gemini to return after reading an Iberian
 * electricity invoice (PT or ES). Drives both the JSON-schema sent to the
 * model and the runtime validation of its response.
 *
 * All money fields are euros, all energy fields are kWh, all dates ISO
 * `YYYY-MM-DD`. Hourly consumption is optional — most paper bills don't
 * include it; we fall back to a synthetic profile when missing.
 */
export const InvoiceExtractionSchema = z.object({
  provider: z
    .string()
    .describe(
      "Energy provider as printed on the invoice (e.g. 'EDP Comercial', 'Endesa Energía', 'Iberdrola Clientes', 'Galp Power', 'Coopérnico'). Use the exact retailer name, not the distributor.",
    ),
  country: z.enum(['PT', 'ES']).describe('Country of the invoice. PT for Portugal, ES for Spain.'),
  periodStart: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date YYYY-MM-DD')
    .describe('First day of the billing period.'),
  periodEnd: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be ISO date YYYY-MM-DD')
    .describe('Last day of the billing period (inclusive).'),
  totalAmountEur: z.number().describe('Final amount paid by the customer, including all taxes.'),
  totalKwh: z.number().describe('Total energy consumed in kWh during the period.'),
  energyCostEur: z
    .number()
    .nullable()
    .describe('Energy term subtotal before taxes, if separately shown. Null if only the grand total is visible.'),
  fixedTermEur: z
    .number()
    .nullable()
    .describe('Fixed power term (potência contratada / término fijo) for the whole period. Null if not visible.'),
  contractedPowerKw: z
    .number()
    .nullable()
    .describe('Contracted power in kW (e.g. 4.6, 6.9). Null if not visible.'),
  taxesEur: z
    .number()
    .nullable()
    .describe('Sum of all tax line items (IE, IVA, CSA, audiovisual, etc.). Null if not separately shown.'),
  tariffName: z.string().nullable().describe("Name of the customer's current tariff plan, e.g. 'Tarifa Estável Simples'."),
  tariffType: z
    .enum(['fixed', 'indexed', 'dual', 'unknown'])
    .describe(
      "'fixed' = single flat €/kWh rate. 'indexed' = OMIE-linked. 'dual' = peak/off-peak rates. 'unknown' if you can't tell.",
    ),
  hourlyConsumption: z
    .array(
      z.object({
        ts: z
          .string()
          .describe('ISO datetime of the period START in local time, e.g. 2024-05-14T03:00:00.'),
        kwh: z.number(),
      }),
    )
    .nullable()
    .describe(
      'Hourly consumption only if explicitly tabulated in the invoice. Most invoices omit this — return null when in doubt.',
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Your overall confidence in this extraction (0=guessing, 1=certain).'),
  notes: z
    .string()
    .nullable()
    .describe('Free-text notes about anything unusual (illegible numbers, multiple invoices in one PDF, etc.).'),
})

export type InvoiceExtraction = z.infer<typeof InvoiceExtractionSchema>

/**
 * JSON-Schema-style description for Gemini's `responseSchema`.
 * Kept manually in lockstep with the Zod schema above so we don't pull in
 * `zod-to-json-schema` for one type. If you change one, change the other.
 */
export const InvoiceJsonSchema = {
  type: 'object',
  properties: {
    provider: { type: 'string' },
    country: { type: 'string', enum: ['PT', 'ES'] },
    periodStart: { type: 'string', description: 'YYYY-MM-DD' },
    periodEnd: { type: 'string', description: 'YYYY-MM-DD' },
    totalAmountEur: { type: 'number' },
    totalKwh: { type: 'number' },
    energyCostEur: { type: 'number', nullable: true },
    fixedTermEur: { type: 'number', nullable: true },
    contractedPowerKw: { type: 'number', nullable: true },
    taxesEur: { type: 'number', nullable: true },
    tariffName: { type: 'string', nullable: true },
    tariffType: { type: 'string', enum: ['fixed', 'indexed', 'dual', 'unknown'] },
    hourlyConsumption: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          ts: { type: 'string' },
          kwh: { type: 'number' },
        },
        required: ['ts', 'kwh'],
      },
    },
    confidence: { type: 'number' },
    notes: { type: 'string', nullable: true },
  },
  required: [
    'provider',
    'country',
    'periodStart',
    'periodEnd',
    'totalAmountEur',
    'totalKwh',
    'tariffType',
    'confidence',
  ],
} as const

/**
 * The system prompt Gemini receives along with the PDF. Keep concise — the
 * model already knows the field names from the schema, this is the *intent*.
 */
export const INVOICE_EXTRACTION_PROMPT = `You are a precise data-extraction system reading an Iberian (Portuguese or Spanish) household electricity invoice provided as a PDF.

Extract structured fields per the response schema. Rules:

1. **Currency & numbers**: All amounts in euros. The invoice may use comma decimals (e.g. "82,40 €") — convert to dot decimals (82.40).
2. **Dates**: Output ISO YYYY-MM-DD. Iberian invoices typically show DD/MM/YYYY or DD-MM-YYYY.
3. **Country**: 'PT' if invoice is in Portuguese or shows EDP/Galp/Endesa-PT/Coopérnico/Goldenergy etc., 'ES' if Spanish or shows Endesa-ES/Iberdrola/Naturgy/Octopus/Holaluz etc.
4. **Total**: \`totalAmountEur\` is the FINAL amount the customer pays, taxes included. Do NOT subtract previous balance, late fees, or refunds — capture the headline payable.
5. **Energy / Fixed split**: Many bills break out energy (term de energia / término de energía) and contracted power (potência contratada / término fijo). Capture both subtotals when shown.
6. **Hourly consumption**: Only include this if the PDF has an explicit hourly table. Daily/monthly summaries do NOT count — return null instead.
7. **Tariff type**:
   - 'fixed' if a single €/kWh rate is shown.
   - 'indexed' if the price is described as variable, OMIE-linked, indexada, or shows hourly rate variation.
   - 'dual' for peak/off-peak (luz, fora de vazio / valle, llano, punta).
   - 'unknown' if you can't tell.
8. **Confidence**: Be honest. If the PDF is low-quality or you're guessing, drop confidence below 0.7.
9. **Don't invent**: When a field is unreadable or not present, return null (do NOT hallucinate plausible defaults).

Return ONLY valid JSON matching the schema — no prose, no code fences.`
