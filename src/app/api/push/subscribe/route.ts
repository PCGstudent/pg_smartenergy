import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createSupabaseServer } from '@/lib/supabase/server'
import { setProfilePushSubscription } from '@/lib/db/alert-queries'

export const runtime = 'nodejs'

const subSchema = z.object({
  endpoint: z.string().url(),
  expirationTime: z.number().nullable().optional(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1),
  }),
})

const bodySchema = z.union([
  subSchema.transform((s) => ({ action: 'subscribe' as const, subscription: s })),
  z.object({ action: z.literal('subscribe'), subscription: subSchema }),
  z.object({ action: z.literal('unsubscribe') }),
])

/**
 * POST /api/push/subscribe
 *  - subscribe: persist the browser's PushSubscription to profiles.push_subscription
 *  - unsubscribe: clear it
 *
 * Auth: requires a Supabase session (RLS enforces ownership downstream).
 */
export async function POST(req: Request) {
  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body', detail: parsed.error.flatten() }, { status: 400 })
  }

  try {
    if (parsed.data.action === 'unsubscribe') {
      await setProfilePushSubscription(supa, user.id, null)
      return NextResponse.json({ ok: true, subscribed: false })
    }
    await setProfilePushSubscription(supa, user.id, parsed.data.subscription)
    return NextResponse.json({ ok: true, subscribed: true })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to update subscription' },
      { status: 500 },
    )
  }
}
