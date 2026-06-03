'use server'

import { createSupabaseService } from '@/lib/supabase/server'
import { sendEmail, isResendConfigured, magicLinkHtml } from '@/lib/email/resend'

/**
 * Send a magic-link sign-in email.
 *
 * When RESEND_API_KEY is configured:
 *   1. Uses the Supabase Admin API to generate a PKCE magic link (no email sent by Supabase).
 *   2. Sends a branded HTML email via Resend.
 *   Returns { sent: true }.
 *
 * When RESEND_API_KEY is NOT configured:
 *   Returns { sent: false } so the client falls back to supabase.auth.signInWithOtp()
 *   (Supabase's built-in mailer, rate-limited to ~4/hour but functional).
 */
export async function sendMagicLink(opts: {
  email: string
  redirectTo: string
  locale?: string
}): Promise<{ sent: true } | { sent: false } | { error: string }> {
  if (!isResendConfigured()) {
    return { sent: false }
  }

  const service = createSupabaseService()

  const { data, error } = await service.auth.admin.generateLink({
    type: 'magiclink',
    email: opts.email,
    options: {
      redirectTo: opts.redirectTo,
    },
  })

  if (error || !data.properties?.action_link) {
    return {
      error: `Could not generate sign-in link: ${error?.message ?? 'unknown error'}`,
    }
  }

  const link = data.properties.action_link

  try {
    await sendEmail({
      to: opts.email,
      subject: opts.locale === 'es'
        ? 'Tu enlace de acceso a Voltwise'
        : opts.locale === 'en'
          ? 'Your Voltwise sign-in link'
          : 'O teu link de acesso ao Voltwise',
      html: magicLinkHtml({ link, email: opts.email, locale: opts.locale }),
    })
    return { sent: true }
  } catch (err) {
    // Resend configured but send failed (e.g. domain not yet verified).
    // Fall back silently so the client uses the Supabase built-in mailer.
    // eslint-disable-next-line no-console
    console.warn('[resend] send failed, falling back to Supabase mailer:', err)
    return { sent: false }
  }
}
