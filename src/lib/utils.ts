import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Format EUR with locale awareness (PT/ES use same format). */
export function formatEur(value: number, opts: { decimals?: number } = {}): string {
  const { decimals = 2 } = opts
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value)
}

/** Convert €/MWh (wholesale) to €/kWh (retail). */
export function mwhToKwh(eurMwh: number): number {
  return eurMwh / 1000
}

/**
 * Convert a wholesale €/MWh figure to ¢/kWh — the unit users actually read on
 * their bill. 1 €/MWh = 0.1 ¢/kWh, so the factor is /10 (e.g. 50 €/MWh → 5 ¢/kWh).
 * Alert thresholds are stored in €/MWh but entered/shown in ¢/kWh (product rule #1).
 */
export function eurMwhToCentsKwh(eurMwh: number): number {
  return eurMwh / 10
}

/** Inverse of {@link eurMwhToCentsKwh}: ¢/kWh → €/MWh (×10) for storage. */
export function centsKwhToEurMwh(centsKwh: number): number {
  return centsKwh * 10
}

/** Format €/kWh as cents/kWh string. */
export function formatCentsKwh(eurKwh: number): string {
  return `${(eurKwh * 100).toFixed(2)}¢/kWh`
}

/** Compute appliance cost given €/kWh and kWh consumed. */
export function applianceCost(eurKwh: number, kwh: number): number {
  return eurKwh * kwh
}

/** Pad date components for OMIE filename. */
export function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

/** YYYYMMDD string for a Date in UTC. */
export function yyyymmddUtc(d: Date): string {
  return `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}`
}
