'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2, Sparkles } from 'lucide-react'
import { useTranslations } from 'next-intl'

const STEP_KEYS = ['1', '2', '3', '4'] as const

/**
 * Polls the route every 3s by invalidating the server cache. The parent page
 * re-renders, picks up the new invoice status, and either shows the result or
 * remains here. No client-side data fetching needed.
 */
export function ProcessingPoll({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const t = useTranslations('auditor.processing')

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 3000)
    return () => clearInterval(id)
  }, [router])

  return (
    <div className="container flex min-h-[calc(100vh-4rem)] max-w-xl items-center py-12">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full rounded-3xl border border-border/60 bg-card/40 p-10 text-center backdrop-blur-sm"
      >
        <span className="mx-auto mb-6 grid h-12 w-12 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/30">
          <Sparkles className="h-5 w-5 animate-pulse-glow" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{t('title')}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t('subtitle')}</p>
        <ul className="mt-8 space-y-2 text-left text-sm">
          {STEP_KEYS.map((key, i) => (
            <motion.li
              key={key}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.15 }}
              className="flex items-center gap-3 rounded-lg border border-border/40 bg-background/40 px-3 py-2"
            >
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span>{t(`steps.${key}`)}</span>
            </motion.li>
          ))}
        </ul>
        <p className="mt-6 text-xs text-muted-foreground">
          {t('invoiceId')} <span className="font-mono">{invoiceId.slice(0, 8)}…</span>
        </p>
      </motion.div>
    </div>
  )
}
