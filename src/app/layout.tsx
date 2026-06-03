import type { Metadata, Viewport } from 'next'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages } from 'next-intl/server'
import { GeistMono } from 'geist/font/mono'
import { GeistSans } from 'geist/font/sans'
import { SiteNav } from '@/components/layout/site-nav'
import { InstallPrompt } from '@/components/pwa/install-prompt'
import { RegisterSW } from '@/components/pwa/register-sw'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Voltwise — your Iberian energy co-pilot',
    template: '%s · Voltwise',
  },
  description:
    'Stop being a victim of your electricity bill. Real-time OMIE prices, AI invoice audits, and proactive alerts for PT and ES.',
  applicationName: 'Voltwise',
  keywords: ['OMIE', 'energy prices', 'Iberia', 'Portugal', 'Spain', 'MIBEL', 'indexed tariff'],
  authors: [{ name: 'Voltwise' }],
  openGraph: {
    title: 'Voltwise — your Iberian energy co-pilot',
    description:
      'Turn real-time MIBEL data into bank-account savings. Built for Portugal and Spain.',
    locale: 'pt_PT',
    type: 'website',
  },
  // PWA / iOS hints — the manifest itself is at /manifest.webmanifest (Next 15
  // auto-routes app/manifest.ts), but `appleWebApp` injects the legacy meta
  // tags iOS Safari still reads to enable full-screen launch.
  appleWebApp: {
    capable: true,
    title: 'Voltwise',
    statusBarStyle: 'black-translucent',
  },
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
}

export const viewport: Viewport = {
  themeColor: '#0a0a0c',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  // viewport-fit=cover lets the dark background extend behind iPhone safe areas.
  viewportFit: 'cover',
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Resolve locale + messages once per request and pass them down.
  // Both `<html lang>` and the client provider stay in lock-step.
  const locale = await getLocale()
  const messages = await getMessages()

  return (
    <html
      lang={locale}
      className={`${GeistSans.variable} ${GeistMono.variable} dark`}
      suppressHydrationWarning
    >
      <body className="min-h-screen overflow-x-hidden font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Madrid">
          <RegisterSW />
          <SiteNav />
          <main className="relative">{children}</main>
          <InstallPrompt />
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
