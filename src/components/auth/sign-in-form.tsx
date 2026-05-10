'use client'

import { useState, useTransition } from 'react'
import { useSearchParams } from 'next/navigation'
import { Loader2, Mail } from 'lucide-react'
import { createSupabaseBrowser } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function SignInForm() {
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
      setError('Please enter a valid email address.')
      return
    }
    startTransition(async () => {
      try {
        const supabase = createSupabaseBrowser()
        const origin = typeof window !== 'undefined' ? window.location.origin : ''
        const callback = new URL('/auth/callback', origin)
        callback.searchParams.set('next', next)
        const { error: err } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: callback.toString(),
            shouldCreateUser: true,
          },
        })
        if (err) throw err
        setSuccess(true)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Something went wrong. Try again?')
      }
    })
  }

  if (success) {
    return (
      <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
        <div className="flex items-center gap-2 font-medium text-primary">
          <Mail className="h-4 w-4" />
          Check your inbox
        </div>
        <p className="mt-1 text-muted-foreground">
          We sent a sign-in link to <span className="text-foreground">{email}</span>. The link is
          valid for 60 minutes.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <label className="block">
        <span className="mb-2 block text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Email
        </span>
        <Input
          type="email"
          autoComplete="email"
          required
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={isPending}
        />
      </label>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
        {isPending ? 'Sending link…' : 'Send magic link'}
      </Button>
    </form>
  )
}
