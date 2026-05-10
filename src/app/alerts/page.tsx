import { redirect } from 'next/navigation'
import { Bell, Sparkles } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { listAlertEventsForUser, listAlertsForUser } from '@/lib/db/alert-queries'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AlertList } from '@/components/alerts/alert-list'
import { CreateAlertCard } from '@/components/alerts/create-alert-card'
import { PushToggle } from '@/components/alerts/push-toggle'

export const dynamic = 'force-dynamic'

export default async function AlertsPage() {
  const session = await getSession()
  if (!session) redirect('/signin?next=/alerts')
  if (!session.profile?.onboardedAt) redirect('/onboarding?next=/alerts')

  const [supa, t, locale] = await Promise.all([
    createSupabaseServer(),
    getTranslations('alerts'),
    getLocale(),
  ])
  const [alerts, events] = await Promise.all([
    listAlertsForUser(supa, session.user.id).catch(() => []),
    listAlertEventsForUser(supa, session.user.id, 10).catch(() => []),
  ])

  // Profile push_subscription drives the toggle's initial state.
  const { data: profile } = await supa
    .from('profiles')
    .select('push_subscription')
    .eq('id', session.user.id)
    .maybeSingle()
  const hasPush = Boolean(profile?.push_subscription)
  const dateLocale = locale === 'es' ? 'es-ES' : 'pt-PT'
  const tz = locale === 'es' ? 'Europe/Madrid' : 'Europe/Lisbon'

  return (
    <div className="container max-w-4xl py-12">
      <header className="mb-8">
        <p className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('kicker')}
        </p>
        <h1 className="mt-1 text-4xl font-semibold tracking-tight md:text-5xl">
          {t('title')}
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          {t('subtitle')}
        </p>
      </header>

      <Card className={hasPush ? '' : 'glow-electric'}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-3 w-3" />
            {t('push.cardTitle')}
          </CardTitle>
          <CardDescription>{t('push.cardDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          <PushToggle initiallyEnabled={hasPush} />
        </CardContent>
      </Card>

      <div className="mt-8">
        <CreateAlertCard country={session.profile?.country ?? 'PT'} />
      </div>

      <section className="mt-10">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('list.title')}
        </h2>
        {alerts.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              <Sparkles className="mx-auto mb-2 h-4 w-4 text-primary" />
              {t('list.empty')}
            </CardContent>
          </Card>
        ) : (
          <AlertList alerts={alerts} />
        )}
      </section>

      {events.length > 0 ? (
        <section className="mt-10">
          <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            {t('events.title')}
          </h2>
          <ul className="space-y-2">
            {events.map((e) => {
              const payload = e.payload as { title?: string; body?: string } | null
              return (
                <li
                  key={e.id}
                  className="flex items-start justify-between rounded-lg border border-border/40 bg-card/40 px-4 py-3 text-sm"
                >
                  <div>
                    <div className="font-medium">{payload?.title ?? t('events.fallback')}</div>
                    <div className="text-xs text-muted-foreground">{payload?.body ?? '—'}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>{e.channel}</div>
                    <div>
                      {new Date(e.sent_at).toLocaleString(dateLocale, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                        timeZone: tz,
                      })}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ) : null}
    </div>
  )
}
