'use server'

import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { insertInvoice } from '@/lib/db/invoice-queries'
import { inngest } from '@/lib/inngest/client'

const STORAGE_PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]+\.pdf$/i

const schema = z.object({
  storagePath: z
    .string()
    .min(1)
    .max(200)
    .regex(STORAGE_PATH_RE, 'storagePath must be `<userId>/<filename>.pdf`'),
})

/**
 * Server Action invoked AFTER the client successfully uploaded a PDF directly to
 * Supabase Storage at `<userId>/<filename>.pdf`. We:
 *
 *   1. Verify the path prefix matches the authenticated user (defense-in-depth on
 *      top of the storage RLS that already enforces this at the bucket level).
 *   2. Verify the object actually exists (rejects clients lying about the upload).
 *   3. Insert the `invoices` row with status='pending'.
 *   4. Fire Inngest event so the worker runs Gemini + savings computation.
 *   5. Redirect to /auditor/{id} where the user sees a processing screen.
 */
export async function createAudit(input: { storagePath: string }) {
  const t = await getTranslations('auditor.errors')
  const parsed = schema.safeParse(input)
  if (!parsed.success) return { error: t('invalidPath') }

  const userServerClient = await createSupabaseServer()
  const {
    data: { user },
  } = await userServerClient.auth.getUser()
  if (!user) return { error: t('signInRequired') }

  const userPrefix = parsed.data.storagePath.split('/')[0]
  if (userPrefix !== user.id) {
    return { error: t('wrongFolder') }
  }

  // Verify the object exists. Use service-role to avoid RLS edge-cases on stat.
  const service = createSupabaseService()
  const { data: list, error: listErr } = await service.storage
    .from('invoices')
    .list(user.id, { limit: 1000, search: parsed.data.storagePath.split('/')[1] })
  if (listErr) return { error: t('storageCheckFailed', { error: listErr.message }) }
  if (!list || list.length === 0) {
    return { error: t('uploadNotFound') }
  }

  // Insert row + fire event using service role (RLS doesn't apply here).
  let invoiceId: string
  try {
    const inserted = await insertInvoice(service, {
      user_id: user.id,
      storage_path: parsed.data.storagePath,
    })
    invoiceId = inserted.id
  } catch (err) {
    return {
      error: t('couldNotCreate', { error: err instanceof Error ? err.message : String(err) }),
    }
  }

  try {
    await inngest.send({
      name: 'voltwise/invoice.uploaded',
      data: { invoiceId, userId: user.id },
    })
  } catch (err) {
    // Don't block the redirect — UI will show "stuck in processing" if the worker never picks up.
    // eslint-disable-next-line no-console
    console.warn('[auditor] inngest.send failed:', err)
  }

  redirect(`/auditor/${invoiceId}`)
}
