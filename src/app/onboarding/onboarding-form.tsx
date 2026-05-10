'use client'

import { useState, useTransition } from 'react'
import { motion } from 'framer-motion'
import { ArrowRight, Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { completeOnboarding } from './actions'

type Country = 'PT' | 'ES'

const COUNTRIES: Array<{
  code: Country
  flag: string
  name: string
  subtitle: string
  blurb: string
}> = [
  {
    code: 'PT',
    flag: '🇵🇹',
    name: 'Portugal',
    subtitle: 'MIBEL — zona PT',
    blurb: 'OMIE PT prices, EDP / Galp / Coopérnico tariffs, E-Redes consumption import.',
  },
  {
    code: 'ES',
    flag: '🇪🇸',
    name: 'España',
    subtitle: 'MIBEL — zona ES',
    blurb: 'OMIE ES prices, Endesa / Iberdrola / Octopus tariffs, Datadis consumption import.',
  },
]

export function OnboardingForm({ next }: { next: string }) {
  const [country, setCountry] = useState<Country | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const onSubmit = () => {
    if (!country) {
      setError('Pick one to continue.')
      return
    }
    setError(null)
    startTransition(async () => {
      const result = await completeOnboarding({ country, next })
      if (result?.error) setError(result.error)
    })
  }

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
                {c.subtitle}
              </div>
              <p className="mt-3 text-sm text-muted-foreground">{c.blurb}</p>
            </motion.button>
          )
        })}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button onClick={onSubmit} disabled={isPending || !country} className="w-full" size="lg">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isPending ? 'Setting up…' : 'Continue'}
        {!isPending ? <ArrowRight className="h-4 w-4" /> : null}
      </Button>
    </div>
  )
}
