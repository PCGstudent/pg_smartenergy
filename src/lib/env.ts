import { z } from 'zod'

/**
 * Server-side environment validation.
 * Throws at boot if required vars are missing.
 * Client code must NOT import this — only `NEXT_PUBLIC_*` vars are safe in browsers.
 */
const serverSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
  INNGEST_EVENT_KEY: z.string().optional(),
  INNGEST_SIGNING_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  ESIOS_TOKEN: z.string().optional(),
  ENTSOE_TOKEN: z.string().optional(),
  INGEST_SECRET: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:hello@voltwise.app'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().default('Voltwise <no-reply@voltwise.app>'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
})

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url().optional(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional(),
})

function parse<T extends z.ZodTypeAny>(schema: T, source: Record<string, string | undefined>): z.infer<T> {
  const result = schema.safeParse(source)
  if (!result.success) {
    // eslint-disable-next-line no-console
    console.error('[env] Invalid environment variables:', result.error.flatten().fieldErrors)
    throw new Error('Invalid environment configuration. See logs.')
  }
  return result.data
}

export const serverEnv = parse(serverSchema, {
  DATABASE_URL: process.env.DATABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  INNGEST_EVENT_KEY: process.env.INNGEST_EVENT_KEY,
  INNGEST_SIGNING_KEY: process.env.INNGEST_SIGNING_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  ESIOS_TOKEN: process.env.ESIOS_TOKEN,
  ENTSOE_TOKEN: process.env.ENTSOE_TOKEN,
  INGEST_SECRET: process.env.INGEST_SECRET,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY,
  VAPID_SUBJECT: process.env.VAPID_SUBJECT,
  WHATSAPP_PHONE_NUMBER_ID: process.env.WHATSAPP_PHONE_NUMBER_ID,
  WHATSAPP_ACCESS_TOKEN: process.env.WHATSAPP_ACCESS_TOKEN,
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  RESEND_FROM_EMAIL: process.env.RESEND_FROM_EMAIL,
  NODE_ENV: process.env.NODE_ENV,
})

export const clientEnv = parse(clientSchema, {
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
})
