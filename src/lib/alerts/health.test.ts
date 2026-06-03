import { describe, expect, it } from 'vitest'
import { assessChannelHealth, type ConfiguredChannels, type HealthAlert } from './health'

/**
 * Coverage for the alert channel health-check — the "silent success" killer. We assert
 * the exact case the UI warns about: active alerts whose every requested channel is
 * unconfigured → `hasUsableChannel` false + non-empty `missingChannels`.
 */

const NONE: ConfiguredChannels = { push: false, whatsapp: false, email: false }
const PUSH_ONLY: ConfiguredChannels = { push: true, whatsapp: false, email: false }
const ALL: ConfiguredChannels = { push: true, whatsapp: true, email: true }

function alert(channels: string[], active = true): HealthAlert {
  return { channels, active }
}

describe('assessChannelHealth', () => {
  it('no active alerts → usable (nothing to warn about)', () => {
    const h = assessChannelHealth([alert(['push'], false)], NONE)
    expect(h.hasActiveAlerts).toBe(false)
    expect(h.hasUsableChannel).toBe(true)
    expect(h.missingChannels).toEqual([])
  })

  it('active push alert with NO push subscription → not usable, push missing', () => {
    const h = assessChannelHealth([alert(['push'])], NONE)
    expect(h.hasActiveAlerts).toBe(true)
    expect(h.hasUsableChannel).toBe(false)
    expect(h.missingChannels).toEqual(['push'])
  })

  it('active push alert WITH a push subscription → usable', () => {
    const h = assessChannelHealth([alert(['push'])], PUSH_ONLY)
    expect(h.hasUsableChannel).toBe(true)
    expect(h.missingChannels).toEqual([])
  })

  it('whatsapp alert without a number but push configured AND selected → usable', () => {
    const h = assessChannelHealth([alert(['push', 'whatsapp'])], PUSH_ONLY)
    expect(h.hasUsableChannel).toBe(true)
    // whatsapp is still reported missing even though the alert overall is deliverable.
    expect(h.missingChannels).toEqual(['whatsapp'])
  })

  it('email-only alert with email available → usable', () => {
    const h = assessChannelHealth([alert(['email'])], { ...NONE, email: true })
    expect(h.hasUsableChannel).toBe(true)
  })

  it('multiple alerts, none deliverable → not usable, all requested channels missing', () => {
    const h = assessChannelHealth([alert(['push']), alert(['whatsapp'])], NONE)
    expect(h.hasUsableChannel).toBe(false)
    expect(h.missingChannels.sort()).toEqual(['push', 'whatsapp'])
  })

  it('an alert with no explicit channels defaults to push (mirrors the runner)', () => {
    const h = assessChannelHealth([alert([])], NONE)
    expect(h.missingChannels).toEqual(['push'])
    expect(h.hasUsableChannel).toBe(false)
  })

  it('an unknown channel is never considered usable', () => {
    const h = assessChannelHealth([alert(['carrier_pigeon'])], ALL)
    expect(h.hasUsableChannel).toBe(false)
    expect(h.missingChannels).toEqual(['carrier_pigeon'])
  })

  it('inactive alerts are ignored when assessing usable channels', () => {
    // An active deliverable email alert + an inactive push alert with no sub → still usable.
    const h = assessChannelHealth(
      [alert(['email']), alert(['push'], false)],
      { ...NONE, email: true },
    )
    expect(h.hasUsableChannel).toBe(true)
    expect(h.missingChannels).toEqual([])
  })
})
