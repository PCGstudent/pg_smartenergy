import type { NextConfig } from 'next'
import withSerwistInit from '@serwist/next'
import createNextIntlPlugin from 'next-intl/plugin'

// next-intl: load `src/i18n/request.ts` on every request to resolve the active
// locale and matching messages. No URL routing — paths stay clean.
const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts')

/**
 * Serwist (modern Workbox fork, successor of `next-pwa`).
 * - swSrc: TypeScript source we author at `src/app/sw.ts`.
 * - swDest: Compiled output Next serves at `/sw.js` (gitignored).
 * - cacheOnNavigation: precache the entry HTML so first navigation works offline.
 * - reloadOnOnline: auto-refresh tabs once the device comes back online.
 * - disable in dev: dev mode would otherwise constantly trash the cache and
 *   make hot-reload feel weird.
 */
const withSerwist = withSerwistInit({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  cacheOnNavigation: true,
  reloadOnOnline: true,
  disable: process.env.NODE_ENV === 'development',
  exclude: [
    // Keep the icon `ImageResponse` routes dynamic — caching them as a static
    // asset would defeat the (cheap) edge-cached generation.
    /^\/icon$/,
    /^\/apple-icon$/,
  ],
})

const config: NextConfig = {
  reactStrictMode: true,
  experimental: {
    typedRoutes: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'www.omie.es' },
    ],
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
      {
        // Service worker must be served fresh — no caching at the CDN edge.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
    ]
  },
}

export default withNextIntl(withSerwist(config))
