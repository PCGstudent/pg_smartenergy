'use client'

import { useEffect } from 'react'

/**
 * Bootstraps the Serwist-generated service worker.
 *
 * Lives separately from the push subscription flow so we can register the
 * worker on every page (caching benefits all routes), not just `/alerts`.
 * Push subscription is still gated behind explicit user consent in
 * `@/components/alerts/push-toggle.tsx`.
 */
export function RegisterSW() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return
    // In dev we disable Serwist (see next.config.ts), so /sw.js wouldn't exist
    // and registration would 404 in the console. Skip cleanly.
    if (process.env.NODE_ENV !== 'production') return

    const onLoad = () => {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/', updateViaCache: 'none' })
        .catch((err) => {
          // Non-fatal — the app still works without a SW, just no offline
          // shell or push.
          console.warn('[Voltwise] SW registration failed:', err)
        })
    }

    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad, { once: true })
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
