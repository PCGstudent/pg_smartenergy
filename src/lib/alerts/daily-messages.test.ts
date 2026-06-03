import { describe, expect, it } from 'vitest'
import { buildDailyMessage, type MessageLocale } from './daily-messages'
import { createDailyTranslator } from './daily-i18n'
import type {
  AnchorDecision,
  FreeDecision,
  SpikeDecision,
} from './daily-decision'

const LOCALES: MessageLocale[] = ['pt', 'es', 'en']

const anchor: AnchorDecision = {
  kind: 'anchor',
  applianceLabel: 'EV',
  applianceType: 'ev',
  startLocal: '02:00',
  endLocal: '04:00',
  startTs: '2026-06-01T02:00:00.000Z',
  endTs: '2026-06-01T04:00:00.000Z',
  avgEurKwh: 0.083,
  totalEur: 0.64,
  savedEur: 0.42,
}

const free: FreeDecision = {
  kind: 'free',
  negative: false,
  block: {
    startTs: '2026-06-01T00:00:00.000Z',
    endTs: '2026-06-01T06:00:00.000Z',
    startLocal: '00:00',
    endLocal: '06:00',
    hours: 6,
    minEurKwh: 0.005,
    maxEurKwh: 0.02,
    avgEurKwh: 0.012,
  },
}

const negative: FreeDecision = {
  ...free,
  negative: true,
  block: { ...free.block, minEurKwh: -0.03 },
}

const spike: SpikeDecision = {
  kind: 'spike',
  block: {
    startTs: '2026-06-01T18:00:00.000Z',
    endTs: '2026-06-01T21:00:00.000Z',
    startLocal: '18:00',
    endLocal: '21:00',
    hours: 3,
    minEurKwh: 0.28,
    maxEurKwh: 0.32,
    avgEurKwh: 0.3,
  },
}

/** No user-facing daily string may quote wholesale €/MWh (product rule #1). */
function assertEurosOnly(text: string) {
  expect(text).not.toMatch(/€\s*\/\s*MWh/i)
  expect(text).not.toMatch(/MWh/i)
}

describe('buildDailyMessage — all locales', () => {
  for (const locale of LOCALES) {
    describe(locale, () => {
      it('anchor: non-empty title/body, euros only, contains the window + appliance', async () => {
        const t = await createDailyTranslator(locale)
        const msg = buildDailyMessage(anchor, t, locale)
        expect(msg.title.length).toBeGreaterThan(0)
        expect(msg.body.length).toBeGreaterThan(0)
        // Window label uses the planner's compact style (leading zero dropped): "2h–4h".
        expect(msg.body).toContain('2h–4h')
        expect(msg.body).toContain('EV')
        // The euro saving figure is present (locale-formatted euro symbol).
        expect(msg.body).toMatch(/€/)
        assertEurosOnly(msg.title)
        assertEurosOnly(msg.body)
        // No leftover {placeholders}.
        expect(msg.body).not.toMatch(/\{[a-z]+\}/i)
      })

      it('free: contains the window and a €/kWh price, euros only', async () => {
        const t = await createDailyTranslator(locale)
        const msg = buildDailyMessage(free, t, locale)
        expect(msg.body).toContain('0h–6h')
        expect(msg.body).toMatch(/€\/kWh/)
        assertEurosOnly(msg.body)
        expect(msg.body).not.toMatch(/\{[a-z]+\}/i)
      })

      it('negative: uses the negative copy (distinct from free)', async () => {
        const t = await createDailyTranslator(locale)
        const freeMsg = buildDailyMessage(free, t, locale)
        const negMsg = buildDailyMessage(negative, t, locale)
        expect(negMsg.title).not.toBe(freeMsg.title)
        expect(negMsg.body).toContain('0h–6h')
        assertEurosOnly(negMsg.body)
        expect(negMsg.body).not.toMatch(/\{[a-z]+\}/i)
      })

      it('spike: contains the expensive window and peak price, euros only', async () => {
        const t = await createDailyTranslator(locale)
        const msg = buildDailyMessage(spike, t, locale)
        expect(msg.body).toContain('18h–21h')
        expect(msg.body).toMatch(/€\/kWh/)
        // 18:00 keeps its non-zero leading hour, so this stays "18h–21h".
        assertEurosOnly(msg.body)
        expect(msg.body).not.toMatch(/\{[a-z]+\}/i)
      })
    })
  }
})

describe('buildDailyMessage — number formatting', () => {
  it('formats euros with the PT decimal comma', async () => {
    const t = await createDailyTranslator('pt')
    const msg = buildDailyMessage(anchor, t, 'pt')
    // 0,42 € (saving) in pt-PT formatting.
    expect(msg.body).toContain('0,42')
  })

  it('formats euros with the EN decimal point', async () => {
    const t = await createDailyTranslator('en')
    const msg = buildDailyMessage(anchor, t, 'en')
    expect(msg.body).toContain('0.42')
  })

  it('clamps a tiny-negative free min to 0 €/kWh in the free (non-negative) body', async () => {
    const t = await createDailyTranslator('en')
    const almostZero: FreeDecision = { ...free, block: { ...free.block, minEurKwh: -0.0001 } }
    // negative flag is false here, so it renders the free body with a clamped price ≥ 0.
    const msg = buildDailyMessage({ ...almostZero, negative: false }, t, 'en')
    expect(msg.body).not.toContain('-0.000')
  })
})
