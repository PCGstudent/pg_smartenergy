'use client'

import { useEffect, useState, useTransition } from 'react'
import { Bell, BellOff, Check, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'

type State = 'unknown' | 'unsupported' | 'denied' | 'enabled' | 'disabled'

/**
 * Toggle the browser's PushSubscription on/off and persist it server-side.
 * Handles permission flow, service-worker registration, and graceful degrade
 * when the browser doesn't support push (Safari < 16.4, Firefox private mode).
 */
export function PushToggle({ initiallyEnabled }: { initiallyEnabled: boolean }) {
  const t = useTranslations('alerts.push')
  const [state, setState] = useState<State>(initiallyEnabled ? 'enabled' : 'unknown')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Detect browser support + current permission on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    if (!initiallyEnabled) setState('disabled')
  }, [initiallyEnabled])

  const enable = () => {
    setError(null)
    startTransition(async () => {
      try {
        const vapidKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
        if (!vapidKey) {
          throw new Error(t('errors.vapidMissing'))
        }

        const permission = await Notification.requestPermission()
        if (permission !== 'granted') {
          setState('denied')
          throw new Error(t('errors.permissionDenied'))
        }

        // The SW is registered globally by `<RegisterSW />` in the root
        // layout. We just wait for it to be ready and reuse the same
        // registration here.
        const registration =
          (await navigator.serviceWorker.getRegistration('/')) ??
          (await navigator.serviceWorker.register('/sw.js', { scope: '/' }))
        await navigator.serviceWorker.ready

        // If a subscription already exists, reuse it; otherwise create one.
        let subscription = await registration.pushManager.getSubscription()
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            // Cast to BufferSource: TS 5.7+ types Uint8Array as Uint8Array<ArrayBufferLike>,
            // but the DOM lib expects Uint8Array<ArrayBuffer>. Runtime is identical.
            applicationServerKey: urlBase64ToUint8Array(vapidKey) as unknown as BufferSource,
          })
        }

        const res = await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'subscribe', subscription: subscription.toJSON() }),
        })
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? t('errors.subscribeFailed', { status: res.status }))
        }

        setState('enabled')

        // Fire a test push so the user immediately sees it works.
        await fetch('/api/push/test', { method: 'POST' }).catch(() => {})
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.enableFailed'))
      }
    })
  }

  const disable = () => {
    setError(null)
    startTransition(async () => {
      try {
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.getRegistration('/sw.js')
          const sub = await registration?.pushManager.getSubscription()
          await sub?.unsubscribe().catch(() => {})
        }
        await fetch('/api/push/subscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'unsubscribe' }),
        })
        setState('disabled')
      } catch (err) {
        setError(err instanceof Error ? err.message : t('errors.disableFailed'))
      }
    })
  }

  if (state === 'unsupported') {
    return (
      <div className="rounded-lg border border-border/40 bg-background/40 p-4 text-sm text-muted-foreground">
        {t('unsupported')}
      </div>
    )
  }

  if (state === 'denied') {
    return (
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
        <div className="font-medium text-destructive">{t('deniedTitle')}</div>
        <p className="mt-1 text-muted-foreground">{t('deniedBody')}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-background/40 p-4">
        <div className="flex items-center gap-3">
          <span
            className={`grid h-9 w-9 place-items-center rounded-lg ring-1 ${
              state === 'enabled'
                ? 'bg-primary/10 text-primary ring-primary/30'
                : 'bg-secondary text-muted-foreground ring-border/60'
            }`}
          >
            {state === 'enabled' ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
          </span>
          <div>
            <div className="font-medium">
              {state === 'enabled' ? t('onTitle') : t('offTitle')}
            </div>
            <div className="text-xs text-muted-foreground">
              {state === 'enabled' ? t('onBody') : t('offBody')}
            </div>
          </div>
        </div>
        {state === 'enabled' ? (
          <Button variant="outline" size="sm" onClick={disable} disabled={isPending}>
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <BellOff className="h-3 w-3" />}
            {t('disable')}
          </Button>
        ) : (
          <Button size="sm" onClick={enable} disabled={isPending}>
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            {t('enable')}
          </Button>
        )}
      </div>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  )
}

/** Convert VAPID base64-url public key to Uint8Array for PushManager.subscribe. */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}
