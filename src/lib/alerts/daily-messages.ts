/**
 * DAILY alert message builder — pure, immutable, no I/O.
 *
 * Turns a `DailyDecision` (raw numbers) into a localized `{ title, body }` pair, ready
 * for push or WhatsApp. EUROS ONLY: every figure is € or €/kWh on the FINAL customer
 * price — never €/MWh (product rule #1). Copy lives in `messages/{pt,es,en}.json` under
 * `alerts.daily.*`; this module only assembles the values into those strings.
 *
 * The builder is injected with a `Translate` function (next-intl's `t` for the user's
 * locale, or a test double backed by the real message JSON) so it stays framework-free
 * and trivially unit-testable across all three locales.
 */

import {
  euros,
  eurPerKwh,
  compactHourLabel,
} from '@/lib/pricing/plan-format'
import type { DailyDecision, AnchorDecision, FreeDecision, SpikeDecision } from './daily-decision'

/** A minimal translator: key (relative to `alerts.daily`) + params → string. */
export type Translate = (key: string, params?: Record<string, string | number>) => string

/** The push/WhatsApp-friendly message a decision renders to. */
export interface DailyMessage {
  /** Short headline (push title / WhatsApp bold line). */
  title: string
  /** One-paragraph body, euros only, no markdown. */
  body: string
}

/** Number-formatting locale for euro/€-per-kWh strings, derived from the app locale. */
export type MessageLocale = 'pt' | 'es' | 'en'

const NUMBER_LOCALE: Record<MessageLocale, string> = {
  pt: 'pt-PT',
  es: 'es-ES',
  en: 'en-GB',
}

/**
 * Build the localized message for a single daily decision.
 *
 * @param decision the raw decision (anchor | free | spike)
 * @param t        translator scoped to `alerts.daily` (so keys are e.g. "anchor.title")
 * @param locale   app locale, drives number formatting (commas vs dots, € placement)
 */
export function buildDailyMessage(
  decision: DailyDecision,
  t: Translate,
  locale: MessageLocale,
): DailyMessage {
  switch (decision.kind) {
    case 'anchor':
      return anchorMessage(decision, t, locale)
    case 'free':
      return freeMessage(decision, t, locale)
    case 'spike':
      return spikeMessage(decision, t, locale)
  }
}

function anchorMessage(d: AnchorDecision, t: Translate, locale: MessageLocale): DailyMessage {
  const numberLocale = NUMBER_LOCALE[locale]
  const window = windowLabel(d.startLocal, d.endLocal)
  return {
    title: t('anchor.title'),
    body: t('anchor.body', {
      appliance: d.applianceLabel,
      window,
      price: eurPerKwh(d.avgEurKwh, numberLocale),
      cost: euros(d.totalEur, numberLocale),
      saved: euros(d.savedEur, numberLocale),
    }),
  }
}

function freeMessage(d: FreeDecision, t: Translate, locale: MessageLocale): DailyMessage {
  const numberLocale = NUMBER_LOCALE[locale]
  const window = windowLabel(d.block.startLocal, d.block.endLocal)
  // A sub-zero hour is the strongest version of the message: the grid pays you.
  if (d.negative) {
    return {
      title: t('negative.title'),
      body: t('negative.body', { window }),
    }
  }
  return {
    title: t('free.title'),
    body: t('free.body', {
      window,
      price: eurPerKwh(Math.max(0, d.block.minEurKwh), numberLocale),
    }),
  }
}

function spikeMessage(d: SpikeDecision, t: Translate, locale: MessageLocale): DailyMessage {
  const numberLocale = NUMBER_LOCALE[locale]
  const window = windowLabel(d.block.startLocal, d.block.endLocal)
  return {
    title: t('spike.title'),
    body: t('spike.body', {
      window,
      price: eurPerKwh(d.block.maxEurKwh, numberLocale),
    }),
  }
}

/** "02h–08h" range label from local HH:MM start/end (reuses the planner's compact style). */
function windowLabel(startLocal: string, endLocal: string): string {
  return `${compactHourLabel(startLocal)}–${compactHourLabel(endLocal)}`
}
