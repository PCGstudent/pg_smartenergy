'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { Loader2, Mail } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { sendMagicLink } from '@/app/signin/actions'

export function SignInForm() {
  const t = useTranslations('signin')
  const search = useSearchParams()
  const next = search.get('next') ?? '/dashboard'
  const locale = useLocale()

  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)
  const [isPending, startTransition] = useTransition()

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)
    if (!email.includes('@')) {
      setError(t('invalidEmail'))
      return
    }
    startTransition(async () => {
      try {
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const callback = new URL('/auth/callback', origin)
        callback.searchParams.set('next', next)

        // Try Resend first. If not configured the action returns { sent: false }
        // and we fall through to the built-in Supabase mailer.
        const result = await sendMagicLink({
          email,
          redirectTo: callback.toString(),
          locale,
        })

        if ('error' in result) throw new Error(result.error)

        if (!result.sent) {
          // Resend not configured — use Supabase built-in mailer (rate-limited fallback)
          const supabase = createSupabaseBrowser()
          const { error: err } = await supabase.auth.signInWithOtp({
            email,
            options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
          })
          if (err) throw err
        }

        setSuccess(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : t('genericError'))
      }
    })
  }

  if (success) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-primary">
          <Mail className="h-4 w-4" />
          {t('checkInbox')}
        </div>
        <p className="mt-1 text-muted-foreground">
          {t.rich('linkSent', {
            email,
            mail: (chunks) => <span className="text-foreground">{chunks}</span>,
          })}
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          {t('emailLabel')}
        </span>
        <Input
          type="email"
          autoComplete="email"
          required
          inputMode="email"
          placeholder={t('emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isPending}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {isPending ? t('sending') : t('submit')}
      </Button>
    </form>
  )
}
