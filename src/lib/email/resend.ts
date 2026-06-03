import { serverEnv } from '@/lib/env'

export interface SendEmailOptions {
  to: string
  subject: string
  html: string
}

/**
 * Send a transactional email via Resend REST API (no SDK dependency).
 * Throws if RESEND_API_KEY is not configured or the API returns an error.
 */
export async function sendEmail(opts: SendEmailOptions): Promise<void> {
  const key = serverEnv.RESEND_API_KEY
  if (!key) throw new Error('RESEND_API_KEY not configured')

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: serverEnv.RESEND_FROM_EMAIL,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText)
    throw new Error(`Resend API error ${res.status}: ${body}`)
  }
}

/**
 * Returns true if Resend is configured and should be used.
 */
export function isResendConfigured(): boolean {
  return Boolean(serverEnv.RESEND_API_KEY)
}

/**
 * HTML template for a DAILY-ANCHOR alert email (tomorrow's window / free / spike).
 *
 * The decision engine already renders a localized, euros-only `{ title, body }` pair
 * (product rule #1: no €/MWh ever). This template only wraps that copy in the Voltwise
 * shell and links back to the plan — it does NOT format any price itself, so euros-only
 * is guaranteed by the caller. `ctaLabel`/`ctaUrl`/`footnote` are passed in localized.
 */
export function dailyAlertHtml(opts: {
  title: string
  body: string
  ctaLabel: string
  ctaUrl: string
  footnote: string
  locale?: string
}): string {
  return `<!DOCTYPE html>
<html lang="${opts.locale ?? 'pt'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(opts.title)}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #262626;border-radius:12px;overflow:hidden;max-width:520px;width:100%;">
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1f1f1f;">
              <span style="font-size:22px;font-weight:700;background:linear-gradient(135deg,#22d3ee,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">⚡ Voltwise</span>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#f5f5f5;">${escapeHtml(opts.title)}</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a3a3a3;">${escapeHtml(opts.body)}</p>
              <a href="${opts.ctaUrl}"
                 style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#22d3ee,#a78bfa);border-radius:8px;font-size:15px;font-weight:600;color:#000;text-decoration:none;">
                ${escapeHtml(opts.ctaLabel)} →
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #1f1f1f;">
              <p style="margin:0;font-size:12px;color:#525252;">${escapeHtml(opts.footnote)}</p>
              <p style="margin:8px 0 0;font-size:12px;color:#404040;">Voltwise · voltwise.app</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

/** Minimal HTML-escape for values interpolated into the email body (defense in depth). */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** HTML template for the magic-link sign-in email. */
export function magicLinkHtml(opts: { link: string; email: string; locale?: string }): string {
  const locale = opts.locale ?? 'pt'
  const isEs = locale === 'es'
  const isEn = locale === 'en'
  const title = isEs
    ? 'Inicia sesión en Voltwise'
    : isEn
      ? 'Sign in to Voltwise'
      : 'Inicia sessão no Voltwise'
  const body = isEs
    ? 'Haz clic en el enlace de abajo para iniciar sesión. El enlace caduca en 60 minutos y sólo puede usarse una vez.'
    : isEn
      ? 'Click the link below to sign in. The link expires in 60 minutes and can only be used once.'
      : 'Clica no link abaixo para iniciares sessão. O link expira em 60 minutos e só pode ser usado uma vez.'
  const cta = isEs ? 'Iniciar sesión' : isEn ? 'Sign in' : 'Iniciar sessão'
  const ignore = isEs
    ? 'Si no solicitaste este correo, puedes ignorarlo con seguridad.'
    : isEn
      ? "If you didn't request this email, you can safely ignore it."
      : 'Se não pediste este email, podes ignorá-lo com segurança.'

  return `<!DOCTYPE html>
<html lang="${opts.locale ?? 'pt'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e5e5e5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a;padding:40px 0;">
    <tr>
      <td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#111111;border:1px solid #262626;border-radius:12px;overflow:hidden;max-width:520px;width:100%;">
          <!-- header -->
          <tr>
            <td style="padding:32px 40px 24px;border-bottom:1px solid #1f1f1f;">
              <span style="font-size:22px;font-weight:700;background:linear-gradient(135deg,#22d3ee,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">⚡ Voltwise</span>
            </td>
          </tr>
          <!-- body -->
          <tr>
            <td style="padding:32px 40px;">
              <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#f5f5f5;">${title}</h1>
              <p style="margin:0 0 28px;font-size:15px;line-height:1.6;color:#a3a3a3;">${body}</p>
              <a href="${opts.link}"
                 style="display:inline-block;padding:14px 28px;background:linear-gradient(135deg,#22d3ee,#a78bfa);border-radius:8px;font-size:15px;font-weight:600;color:#000;text-decoration:none;">
                ${cta} →
              </a>
            </td>
          </tr>
          <!-- footer -->
          <tr>
            <td style="padding:20px 40px 28px;border-top:1px solid #1f1f1f;">
              <p style="margin:0;font-size:12px;color:#525252;">${ignore}</p>
              <p style="margin:8px 0 0;font-size:12px;color:#404040;">Voltwise · voltwise.app</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}
