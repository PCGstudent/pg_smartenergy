/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { defaultCache } from '@serwist/next/worker'
import type { PrecacheEntry, SerwistGlobalConfig } from 'serwist'
import { CacheFirst, ExpirationPlugin, NetworkFirst, Serwist, StaleWhileRevalidate } from 'serwist'

/**
 * Voltwise service worker (Serwist 9, Workbox-style).
 *
 * Source of truth for what gets cached and how. Compiled by `withSerwistInit`
 * in `next.config.ts` to `public/sw.js` on every production build.
 *
 * Strategy:
 *  - PRECACHE: Next-built JS chunks, fonts, CSS, static images. Generated at
 *    build time and slammed into the cache on first install.
 *  - RUNTIME: STALE-WHILE-REVALIDATE for price reads (instant repeat loads,
 *    background refresh), NETWORK-FIRST for HTML pages (real-time data wins,
 *    fallback to cache when offline), CACHE-FIRST for fonts and static assets.
 *  - PUSH: Same handler we had in `public/sw.js`, ported as TypeScript.
 *
 * Important: this file runs in a ServiceWorkerGlobalScope, NOT in Node or the
 * browser window. Some types are widened with `declare global` so TS is happy.
 */

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    // Build-time injected by Serwist with the precache manifest.
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined
  }
}

declare const self: ServiceWorkerGlobalScope

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    /**
     * Voltwise price API — the dashboard hits this on every load.
     * Stale-while-revalidate: instant from cache, fresh data fetched in
     * the background, UI updates next render. Best of both.
     */
    {
      matcher: /^https?:\/\/[^/]+\/api\/prices\/today/,
      handler: new StaleWhileRevalidate({
        cacheName: 'voltwise-prices-today',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 8,
            // Keep up to 6 hours so the dashboard still renders something
            // useful when a user opens the app on the metro.
            maxAgeSeconds: 6 * 60 * 60,
          }),
        ],
      }),
    },
    /**
     * Audit detail JSON. Tiny and immutable once processed — cache hard.
     */
    {
      matcher: /^https?:\/\/[^/]+\/api\/audits\/.+/,
      handler: new CacheFirst({
        cacheName: 'voltwise-audits',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60,
          }),
        ],
      }),
    },
    /**
     * Fonts — versioned filenames, safe to cache for a year. Matches Geist
     * shipped by Next, Google Fonts, or any same-origin .woff2.
     */
    {
      matcher: ({ url }: { url: URL }) =>
        url.origin === 'https://fonts.googleapis.com' ||
        url.origin === 'https://fonts.gstatic.com' ||
        /\.(woff2?|ttf|otf|eot)$/i.test(url.pathname),
      handler: new CacheFirst({
        cacheName: 'voltwise-fonts',
        plugins: [
          new ExpirationPlugin({
            maxEntries: 16,
            maxAgeSeconds: 365 * 24 * 60 * 60,
          }),
        ],
      }),
    },
    /**
     * HTML navigations — try the network first (real-time price data), fall
     * back to cache when offline. Combined with `cacheOnNavigation: true` in
     * next.config.ts this gives us a true offline shell.
     */
    {
      matcher: ({ request }: { request: Request }) => request.mode === 'navigate',
      handler: new NetworkFirst({
        cacheName: 'voltwise-pages',
        networkTimeoutSeconds: 4,
        plugins: [
          new ExpirationPlugin({
            maxEntries: 32,
            maxAgeSeconds: 24 * 60 * 60,
          }),
        ],
      }),
    },
    // Inherit Serwist's defaults for everything we didn't match (Next image
    // optimization, _next/static, etc).
    ...defaultCache,
  ],
  fallbacks: {
    // When the network fails AND the cache misses, navigations get this page.
    entries: [
      {
        url: '/offline',
        matcher: ({ request }: { request: Request }) =>
          request.destination === 'document',
      },
    ],
  },
})

serwist.addEventListeners()

/**
 * Voltwise push handler — ported from the v1 `public/sw.js`.
 * Serwist doesn't provide a push primitive (intentionally — push semantics
 * vary by app), so we add it ourselves.
 */
self.addEventListener('push', (event) => {
  let payload: { title?: string; body?: string; url?: string; tag?: string } = {}
  try {
    payload = event.data ? (event.data.json() as typeof payload) : {}
  } catch {
    payload = { title: 'Voltwise', body: event.data ? event.data.text() : '' }
  }

  const title = payload.title ?? 'Voltwise'
  const options: NotificationOptions = {
    body: payload.body ?? '',
    icon: '/apple-icon',
    badge: '/icons/icon-maskable.svg',
    tag: payload.tag ?? 'voltwise',
    data: { url: payload.url ?? '/dashboard' },
    requireInteraction: false,
    silent: false,
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target =
    ((event.notification.data as { url?: string } | null)?.url ?? '/').toString()

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Reuse an existing tab if one is open.
      for (const client of clientList) {
        if ('focus' in client && client.url.includes(self.location.origin)) {
          ;(client as WindowClient).focus()
          return (client as WindowClient).navigate?.(target)
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
