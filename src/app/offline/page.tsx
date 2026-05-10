import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { CloudOff, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Offline fallback. Served by the service worker when both the network and
 * the page cache fail. Stays in the same dark Voltwise theme so it doesn't
 * feel like a browser error page.
 *
 * NOT force-static — copy varies by locale, so we let it render dynamically
 * (it's still tiny and the SW caches the rendered HTML on first visit).
 */

export default async function OfflinePage() {
  const t = await getTranslations('offline')
  return (
    <div className="container flex min-h-[80vh] max-w-lg flex-col items-center justify-center py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary/60 ring-1 ring-border/60">
        <CloudOff className="h-6 w-6 text-muted-foreground" />
      </span>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight md:text-4xl">{t('title')}</h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">{t('body')}</p>
      <div className="mt-8 flex flex-wrap items-center justify-center gap-2">
        <Button asChild>
          <Link href="/dashboard">
            <RefreshCcw className="h-3 w-3" />
            {t('ctas.tryAgain')}
          </Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/auditor">{t('ctas.viewAudits')}</Link>
        </Button>
      </div>
      <p className="mt-10 text-xs text-muted-foreground/70">{t('tip')}</p>
    </div>
  )
}
