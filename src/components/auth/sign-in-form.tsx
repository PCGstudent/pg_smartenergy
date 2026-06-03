'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Loader2, Mail } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SignInForm() {
  const t = useTranslations('signin')
  const search = useSearchParams()
  const next = search.get('next') ?? '/dashboard'

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

        // Use Supabase's built-in mailer via signInWithOtp (client-side). This runs the
        // PKCE flow end-to-end: the code verifier is stored in THIS browser, so the
        // /auth/callback exchangeCodeForSession succeeds. (A previous server-side
        // admin.generateLink path produced a link whose verifier the browser never had,
        // which bounced the user back to /signin in a loop.) Works for any email without
        // a verified sending domain.
        const supabase = createSupabaseBrowser()
        const { error: err } = await supabase.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: callback.toString(), shouldCreateUser: true },
        })
        if (err) throw err

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
