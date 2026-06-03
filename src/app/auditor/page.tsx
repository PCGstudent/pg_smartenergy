import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowRight, FileText, Sparkles } from 'lucide-react'
import { getLocale, getTranslations } from 'next-intl/server'
import { getSession } from '@/lib/supabase/auth'
import { createSupabaseServer } from '@/lib/supabase/server'
import { listInvoicesForUser, getLatestAuditSavingsByInvoiceIds } from '@/lib/db/invoice-queries'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { UploadForm } from './upload-form'

export const dynamic = 'force-dynamic'

export default async function AuditorIndexPage() {
  const session = await getSession()
  if (!session) redirect('/signin?next=/auditor')
  if (!session.profile?.onboardedAt) redirect('/onboarding?next=/auditor')

  const [supa, t, locale] = await Promise.all([
    createSupabaseServer(),
    getTranslations('auditor'),
    getLocale(),
  ])
  const invoices = await listInvoicesForUser(supa, session.user.id, 20).catch(() => [])
  const processedIds = invoices.filter(i => i.status === 'processed').map(i => i.id)
  const savingsMap = await getLatestAuditSavingsByInvoiceIds(supa, processedIds).catch(() => new Map())
  const dateLocale = locale === 'es' ? 'es-ES' : locale === 'en' ? 'en-GB' : 'pt-PT'
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

      <Card className="glow-electric">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-3 w-3" />
            {t('newAudit.title')}
          </CardTitle>
          <CardDescription>
            {t('newAudit.description')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <UploadForm userId={session.user.id} />
        </CardContent>
      </Card>

      <section className="mt-12">
        <h2 className="mb-4 text-sm font-medium uppercase tracking-wider text-muted-foreground">
          {t('pastAudits')}
        </h2>
        {invoices.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center text-sm text-muted-foreground">
              {t('noAudits')}
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-2">
            {invoices.map((inv) => (
              <li key={inv.id}>
                <Link
                  href={`/auditor/${inv.id}`}
                  className="flex items-center justify-between rounded-xl border border-border/60 bg-card/40 p-4 transition hover:border-border hover:bg-card/60"
                >
                  <div className="flex items-center gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-muted-foreground">
                      <FileText className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="font-medium">
                        {inv.provider ?? t('pendingExtraction')}{' '}
                        <span className="text-muted-foreground">
                          {inv.period_start && inv.period_end
                            ? `· ${inv.period_start} → ${inv.period_end}`
                            : ''}
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(inv.created_at).toLocaleString(dateLocale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: tz,
                        })}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <StatusBadge status={inv.status} t={t} savings={savingsMap.get(inv.id)} />
                    <ArrowRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

type AuditorTranslator = Awaited<ReturnType<typeof getTranslations<'auditor'>>>

function StatusBadge({
  status,
  t,
  savings,
}: {
  status: 'pending' | 'processed' | 'error'
  t: AuditorTranslator
  savings?: { savingsEur: number; savingsPct: number }
}) {
  if (status === 'processed') {
    if (savings && savings.savingsEur >= 1) {
      return (
        <Badge variant="default" className="tabular-nums">
          ↓ {savings.savingsEur.toFixed(2)}€
        </Badge>
      )
    }
    return <Badge variant="default">{t('status.done')}</Badge>
  }
  if (status === 'error') return <Badge variant="spike">{t('status.failed')}</Badge>
  return <Badge variant="muted">{t('status.processing')}</Badge>
}
