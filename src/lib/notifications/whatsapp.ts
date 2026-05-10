/**
 * WhatsApp Cloud API (Meta) dispatcher.
 *
 * If `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_ACCESS_TOKEN` are set, posts a
 * real text message. Otherwise logs to stdout so dev/CI stays frictionless.
 *
 * Cost note: the first 1000 service-initiated conversations / month are free
 * on the WhatsApp Business platform. Voltwise alerts qualify as "utility"
 * conversations, which fall under the free tier.
 */

export class WhatsAppDispatchError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'WhatsAppDispatchError'
  }
}

export interface WhatsAppMessage {
  /** E.164 number, e.g. +351912345678. */
  to: string
  body: string
}

export async function sendWhatsApp(msg: WhatsAppMessage): Promise<{ stubbed: boolean; id?: string }> {
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID
  const token = process.env.WHATSAPP_ACCESS_TOKEN

  if (!phoneId || !token) {
    // eslint-disable-next-line no-console
    console.info(
      `[whatsapp:stub] would send to ${maskNumber(msg.to)}: ${msg.body.slice(0, 80)}…`,
    )
    return { stubbed: true }
  }

  const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: msg.to.replace(/^\+/, ''),
      type: 'text',
      text: { body: msg.body, preview_url: false },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new WhatsAppDispatchError(
      `WhatsApp API ${res.status}: ${text.slice(0, 200)}`,
      res.status,
    )
  }

  const data = (await res.json().catch(() => ({}))) as {
    messages?: { id: string }[]
  }
  return { stubbed: false, id: data.messages?.[0]?.id }
}

function maskNumber(e164: string): string {
  if (e164.length < 6) return '***'
  return `${e164.slice(0, 4)}***${e164.slice(-3)}`
}
