/**
 * Alert channel health-check — pure, immutable, no I/O.
 *
 * Kills the "silent success" failure mode: a user can have ACTIVE alerts whose every
 * channel is unusable (push alert but no subscription, WhatsApp alert but no number,
 * email alert but no address) — so nothing ever actually reaches them. This computes,
 * from the user's alerts + which channels are configured, whether they have at least one
 * usable channel, so the /alerts UI can nudge them and the runner can WARN-log it.
 *
 * A channel is "usable" when it is BOTH configured (push subscription present / WhatsApp
 * number present / email present) AND selected on at least one active alert.
 */

/** Which delivery channels the user has actually configured. */
export interface ConfiguredChannels {
  /** A live Web Push subscription is on the profile. */
  push: boolean
  /** An E.164 WhatsApp number is on the profile. */
  whatsapp: boolean
  /** An email address is resolvable (auth.users always has one for a signed-in user). */
  email: boolean
}

/** The minimal alert shape the health-check needs (channels + active flag). */
export interface HealthAlert {
  channels: string[]
  active: boolean
}

export interface ChannelHealth {
  /** True when the user has ≥1 active alert. */
  hasActiveAlerts: boolean
  /** True when ≥1 active alert routes to a channel the user has configured. */
  hasUsableChannel: boolean
  /** The distinct channels requested across active alerts but NOT configured. */
  missingChannels: string[]
}

/**
 * Assess whether a user's active alerts can actually be delivered.
 *
 * `hasUsableChannel` is false (and `missingChannels` non-empty) exactly when the user has
 * active alerts but every channel those alerts request is unconfigured — the case the UI
 * should warn about. With no active alerts, `hasUsableChannel` is true (nothing to warn).
 */
export function assessChannelHealth(
  alerts: HealthAlert[],
  configured: ConfiguredChannels,
): ChannelHealth {
  const active = alerts.filter((a) => a.active)
  if (active.length === 0) {
    return { hasActiveAlerts: false, hasUsableChannel: true, missingChannels: [] }
  }

  const requested = new Set<string>()
  for (const a of active) {
    // Mirror the runner's default: an alert with no explicit channels falls back to push.
    const channels = a.channels.length > 0 ? a.channels : ['push']
    for (const c of channels) requested.add(c)
  }

  const usable = [...requested].filter((c) => isConfigured(c, configured))
  const missing = [...requested].filter((c) => !isConfigured(c, configured))

  return {
    hasActiveAlerts: true,
    hasUsableChannel: usable.length > 0,
    missingChannels: missing,
  }
}

/** Is a given channel string configured for the user? Unknown channels are not usable. */
function isConfigured(channel: string, configured: ConfiguredChannels): boolean {
  switch (channel) {
    case 'push':
      return configured.push
    case 'whatsapp':
      return configured.whatsapp
    case 'email':
      return configured.email
    default:
      return false
  }
}
