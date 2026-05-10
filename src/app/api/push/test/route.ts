import { NextResponse } from 'next/server'
import { createSupabaseServer, createSupabaseService } from '@/lib/supabase/server'
import { sendWebPush, WebPushExpiredError } from '@/lib/notifications/web-push'
import { setProfilePushSubscription, type PushSubscriptionJSON } from '@/lib/db/alert-queries'

export const runtime = 'nodejs'

/**
 * POST /api/push/test — fire a test push to the current user.
 * Useful right after they enable notifications so they confirm it works.
 */
export async function POST() {
  const supa = await createSupabaseServer()
  const {
    data: { user },
  } = await supa.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read profile via the user-bound client so RLS applies.
  const { data: profile, error } = await supa
    .from('profiles')
    .select('push_subscription')
    .eq('id', user.id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sub = profile?.push_subscription as PushSubscriptionJSON | null
  if (!sub) {
    return NextResponse.json(
      { error: 'No push subscription on file. Enable notifications first.' },
      { status: 400 },
    )
  }

  try {
    await sendWebPush(sub, {
      title: '⚡ Voltwise test',
      body: 'Notifications are working. We\u2019ll only ping you on golden hours and spikes.',
      url: '/alerts',
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof WebPushExpiredError) {
      // Stale sub — clear it via service-role so we don't keep retrying.
      const service = createSupabaseService()
      await setProfilePushSubscription(service, user.id, null).catch(() => {})
      return NextResponse.json(
        { error: 'Subscription expired. Re-enable notifications and try again.' },
        { status: 410 },
      )
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Push failed' },
      { status: 500 },
    )
  }
}
