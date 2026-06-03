import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { AuthHashHandler } from '@/components/auth/auth-hash-handler'
import { ArrowRight, Bell, FileText, LineChart, Sparkles, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { LiveTicker } from '@/components/marketing/live-ticker'
import { HowItWorks } from '@/components/marketing/how-it-works'
import { HeroReveal } from '@/components/marketing/hero-reveal'

/**
 * Server component — pulls translations on the server, ships zero JS for the
 * copy. Locale resolved by the next-intl request config (cookie → profile →
 * Accept-Language → 'pt').
 */
export default async function LandingPage() {
  const t = await getTranslations('landing')

  return (
    <div className="relative">
      <AuthHashHandler />
      <section className="container relative pt-20 pb-20 md:pt-28 md:pb-28">
        <HeroReveal>
          <div className="mx-auto max-w-3xl text-center">
            <Badge variant="default">
              <Sparkles className="h-3 w-3" />
              {t('badge')}
            </Badge>
            <h1 className="mt-6 text-balance text-5xl font-semibold tracking-tight md:text-7xl">
              {t('headline.before')}{' '}
              <span className="gradient-text-electric">{t('headline.highlight')}</span>
              {t('headline.after')}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-balance text-lg text-muted-foreground md:text-xl">
              {t('subheadline')}
            </p>
            <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  {t('ctas.livePrices')}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/signin?next=/auditor">{t('ctas.auditBill')}</Link>
              </Button>
            </div>
            <p className="mt-6 text-xs text-muted-foreground">{t('tagline')}</p>
          </div>

          <div className="mt-12 flex justify-center">
            <LiveTicker />
          </div>
        </HeroReveal>
      </section>

      <section className="container pb-12">
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCard
            icon={<LineChart className="h-5 w-5" />}
            title={t('features.oracle.title')}
            body={t('features.oracle.body')}
          />
          <FeatureCard
            icon={<FileText className="h-5 w-5" />}
            title={t('features.auditor.title')}
            body={t('features.auditor.body')}
          />
          <FeatureCard
            icon={<Bell className="h-5 w-5" />}
            title={t('features.smartGuard.title')}
            body={t('features.smartGuard.body')}
          />
          <FeatureCard
            icon={<Zap className="h-5 w-5" />}
            title={t('features.autoPilot.title')}
            body={t('features.autoPilot.body')}
          />
        </div>
      </section>

      <HowItWorks />

      <section className="container pb-24">
        <div className="mx-auto max-w-3xl rounded-3xl border border-border/60 bg-gradient-to-br from-card/80 to-card/30 p-10 text-center md:p-14">
          <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
            {t('closer.headline')}
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">{t('closer.body')}</p>
          <div className="mt-8 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Button asChild size="lg">
              <Link href="/signin?next=/auditor">
                {t('closer.ctas.audit')}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/dashboard">{t('closer.ctas.prices')}</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  )
}

function FeatureCard({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-6 transition hover:border-border hover:bg-card/60">
      <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
        {icon}
      </div>
      <h3 className="text-lg font-medium">{title}</h3>
      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
    </div>
  )
}
