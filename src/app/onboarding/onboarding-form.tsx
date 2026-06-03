'use client'

import { useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { useTranslations } from 'next-intl'
import { ArrowLeft, ArrowRight, Check, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { completeOnboarding, type OnboardingInput } from './actions'
import { LoadStep, type LoadDraft } from './load-step'

type Country = 'PT' | 'ES'
type Step = 'country' | 'load'

const COUNTRIES: Array<{ code: Country; flag: string; name: string }> = [
  { code: 'PT', flag: '🇵🇹', name: 'Portugal' },
  { code: 'ES', flag: '🇪🇸', name: 'España' },
]

const EMPTY_LOAD: LoadDraft = {
  profile: null,
  energyKwh: null,
  availability: 'overnight',
  daysPerWeek: 5,
}

/**
 * Two-step frictionless onboarding:
 *   1. Country (sets OMIE zone, tariff catalog, grid operator).
 *   2. Describe ONE primary load (optional) — a few taps, no invoice/CSV. When provided,
 *      the action sets a default indexed tariff + saves the load, then routes to /plan so
 *      the user immediately sees a real cheapest-window recommendation and a MONTHLY € saving.
 *
 * "Skip" finishes with just the country and honours `next`. Invoice upload is an optional
 * accuracy upgrade offered later — never required here.
 */
export function OnboardingForm({ next }: { next: string }) {
  const t = useTranslations('onboarding')
  const [step, setStep] = useState<Step>('country')
  const [country, setCountry] = useState<Country | null>(null)
  const [load, setLoad] = useState<LoadDraft>(EMPTY_LOAD)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const goToLoad = () => {
    if (!country) {
      setError(t('pickError'))
      return
    }
    setError(null)
    setStep('load')
  }

  const submit = (withLoad: boolean) => {
    if (!country) {
      setError(t('pickError'))
      setStep('country')
      return
    }
    setError(null)
    const input: OnboardingInput = {
      country,
      next,
      load:
        withLoad && load.profile
          ? {
              profile: load.profile,
              energyKwh: load.energyKwh ?? undefined,
              availability: load.availability,
              daysPerWeek: load.daysPerWeek,
            }
          : undefined,
    }
    startTransition(async () => {
      const result = await completeOnboarding(input)
      if (result?.error) setError(result.error)
    })
  }

  if (step === 'country') {
    return (
      <div className="space-y-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {COUNTRIES.map((c) => {
            const active = country === c.code
            return (
              <motion.button
                key={c.code}
                type="button"
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => setCountry(c.code)}
                className={`relative overflow-hidden rounded-xl border p-5 text-left transition ${
                  active
                    ? 'border-primary/60 bg-primary/5 ring-2 ring-primary/40'
                    : 'border-border/60 bg-card/40 hover:border-border'
                }`}
                disabled={isPending}
              >
                {active ? (
                  <span className="absolute right-3 top-3 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                ) : null}
                <div className="text-3xl leading-none">{c.flag}</div>
                <div className="mt-3 text-lg font-semibold">{c.name}</div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">
                  {t(`countries.${c.code}.subtitle`)}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t(`countries.${c.code}.blurb`)}
                </p>
              </motion.button>
            )
          })}
        </div>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        <Button onClick={goToLoad} disabled={!country} className="w-full" size="lg">
          {t('continue')}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  // step === 'load'
  return (
    <div className="space-y-6">
      <LoadStep draft={load} onChange={setLoad} disabled={isPending} />

      {error ? <p className="text-sm text-destructive">{error}</p> : null}

      <div className="space-y-3">
        <Button
          onClick={() => submit(true)}
          disabled={isPending || !load.profile}
          className="w-full"
          size="lg"
        >
          {isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {isPending ? t('settingUp') : t('load.cta')}
          {!isPending ? <ArrowRight className="h-4 w-4" /> : null}
        </Button>

        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => {
              setError(null)
              setStep('country')
            }}
            disabled={isPending}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground disabled:opacity-50"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t('back')}
          </button>
          <button
            type="button"
            onClick={() => submit(false)}
            disabled={isPending}
            className="text-sm text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline disabled:opacity-50"
          >
            {t('load.skip')}
          </button>
        </div>
      </div>
    </div>
  )
}
