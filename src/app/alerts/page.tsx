import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AlertTriangle, Bell, Settings2, Sparkles } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { listAlertEventsForUser, listAlertsForUser } from '@/lib/db/alert-queries'
import { assessChannelHealth } from '@/lib/alerts/health'
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

  // Profile push_subscription drives the toggle's initial state; whatsapp_e164 + the
  // signed-in email feed the channel health-check below.
  const { data: profile } = await supa
    .from('profiles')
    .select('push_subscription, whatsapp_e164')
    .eq('id', session.user.id)
    .maybeSingle()
  const hasPush = Boolean(profile?.push_subscription)
  const hasWhatsapp = Boolean(profile?.whatsapp_e164)
  // A signed-in user always has an email on auth.users → email is always a usable channel.
  const hasEmail = Boolean(session.user.email)
  const dateLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'
  const tz = locale === 'es' ? 'Europe/Madrid' : 'Europe/Lisbon'

  // Health-check: warn when active alerts exist but none of their channels is configured.
  const health = assessChannelHealth(alerts, {
    push: hasPush,
    whatsapp: hasWhatsapp,
    email: hasEmail,
  })
  const showChannelWarning = health.hasActiveAlerts && !health.hasUsableChannel

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

      {showChannelWarning ? (
        <div className="mb-8 flex items-start gap-3 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-300">{t('healthCheck.title')}</p>
            <p className="mt-1 text-muted-foreground">{t('healthCheck.body')}</p>
            <Link
              href="/settings"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-300 underline-offset-4 hover:underline"
            >
              <Settings2 className="h-3.5 w-3.5" />
              {t('healthCheck.cta')}
            </Link>
          </div>
        </div>
      ) : null}

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
        <CreateAlertCard
          country={session.profile?.country ?? 'PT'}
          hasWhatsapp={hasWhatsapp}
        />
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
