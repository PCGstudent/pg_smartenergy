'use client'

import { useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { motion, AnimatePresence } from 'framer-motion'
import { Download, Share2, Smartphone, X } from 'lucide-react'

/**
 * Beforeinstallprompt event (Chromium / Edge / Samsung Internet).
 * Not yet a web standard so the type is hand-rolled.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

const DISMISS_KEY = 'voltwise:install-prompt-dismissed'
const DISMISS_DAYS = 7

type Variant = 'android' | 'ios' | 'none'

/**
 * Tiny dismissible banner that nudges users to install Voltwise as a PWA.
 *
 * - Android / Chromium: hooks the `beforeinstallprompt` event and shows a one-tap install button.
 * - iOS Safari: shows the manual "Tap Share → Add to Home Screen" instructions.
 * - Already-installed (display-mode: standalone) or recently dismissed: renders nothing.
 */
export function InstallPrompt() {
  const t = useTranslations('install')
  const tCommon = useTranslations('common.actions')
  const [variant, setVariant] = useState<Variant>('none')
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isStandalone()) return
    if (recentlyDismissed()) return

    const ua = navigator.userAgent || ''
    const isIos = /iPhone|iPad|iPod/i.test(ua) && !/CriOS|FxiOS/i.test(ua)
    const isChromium = 'BeforeInstallPromptEvent' in window || /Chrome|Edg|Samsung/i.test(ua)

    if (isIos) {
      setVariant('ios')
      setOpen(true)
      return
    }

    if (isChromium) {
      const handler = (e: Event) => {
        e.preventDefault()
        setDeferred(e as BeforeInstallPromptEvent)
        setVariant('android')
        setOpen(true)
      }
      window.addEventListener('beforeinstallprompt', handler)
      return () => window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const onInstall = async () => {
    if (!deferred) return
    try {
      await deferred.prompt()
      const choice = await deferred.userChoice
      if (choice.outcome === 'accepted') setOpen(false)
    } catch {
      /* user dismissed */
    } finally {
      setDeferred(null)
    }
  }

  const onDismiss = () => {
    try {
      window.localStorage.setItem(DISMISS_KEY, String(Date.now()))
    } catch {
      /* private mode */
    }
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && variant !== 'none' ? (
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.3, ease: 'easeOut' }}
          className="pointer-events-auto fixed bottom-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2"
        >
          <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-card/95 p-4 shadow-2xl backdrop-blur-xl">
            <button
              type="button"
              onClick={onDismiss}
              className="absolute right-3 top-3 rounded-md p-1 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
              aria-label="Dismiss install prompt"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
                {variant === 'ios' ? <Smartphone className="h-4 w-4" /> : <Download className="h-4 w-4" />}
              </span>
              <div className="flex-1 pr-6">
                {variant === 'android' ? (
                  <>
                    <div className="text-sm font-medium">{t('android.title')}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{t('android.body')}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={onInstall}
                        className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-sm transition hover:opacity-90"
                      >
                        {t('android.cta')}
                      </button>
                      <button
                        type="button"
                        onClick={onDismiss}
                        className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                      >
                        {tCommon('notNow')}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm font-medium">{t('ios.title')}</div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {t('ios.before')}{' '}
                      <span className="inline-flex items-center gap-1 rounded bg-secondary px-1 py-0.5">
                        <Share2 className="h-2.5 w-2.5" />
                        {t('ios.share')}
                      </span>
                      {t('ios.and')}{' '}
                      <span className="rounded bg-secondary px-1 py-0.5">{t('ios.addToHome')}</span>
                      {t('ios.after')}
                    </p>
                  </>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari proprietary flag
  if ((navigator as unknown as { standalone?: boolean }).standalone) return true
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

function recentlyDismissed(): boolean {
  try {
    const v = window.localStorage.getItem(DISMISS_KEY)
    if (!v) return false
    const ageDays = (Date.now() - Number(v)) / (1000 * 60 * 60 * 24)
    return ageDays < DISMISS_DAYS
  } catch {
    return false
  }
}
