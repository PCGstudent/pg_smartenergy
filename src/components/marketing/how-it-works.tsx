'use client'

import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { FileText, LineChart, Zap } from 'lucide-react'

/** Step visuals only — titles and bodies come from the i18n catalog. */
const STEPS = [
  { n: '01', key: 'market', icon: LineChart },
  { n: '02', key: 'audit', icon: FileText },
  { n: '03', key: 'save', icon: Zap },
] as const

export function HowItWorks() {
  const t = useTranslations('landing.howItWorks')

  return (
    <section className="container py-24">
      <div className="mb-12 max-w-2xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
          {t('kicker')}
        </p>
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          {t('heading')}
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-6"
          >
            <div className="num mb-6 text-xs font-semibold tracking-wider text-muted-foreground">
              {step.n}
            </div>
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
              <step.icon className="h-4 w-4" />
            </div>
            <h3 className="text-lg font-medium">{t(`steps.${step.key}.title`)}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{t(`steps.${step.key}.body`)}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
