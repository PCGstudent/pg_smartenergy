/**
 * One-shot DAILY ANCHOR run from the CLI.
 *
 *   pnpm anchor:daily                       # plan tomorrow from real "now"
 *   pnpm anchor:daily 2026-06-01T15:00:00Z  # plan tomorrow relative to a fixed instant
 *
 * Loads every active-alert user, builds tomorrow's FINAL-price plan, and delivers the
 * anchor / free / spike message on each user's channels (real push + WhatsApp — the same
 * dispatchers the Inngest cron uses). Reads DATABASE_URL + Supabase + VAPID / WhatsApp
 * secrets from .env.local. No Inngest required.
 *
 * Tip: leave WHATSAPP_* / VAPID_* unset to dry-run — both senders log a stub line instead
 * of contacting a provider, so you can inspect the DECISION + message content safely.
 */
import 'dotenv/config'
import { runDailyAnchors } from '@/lib/alerts/daily-runner'

async function main() {
  const arg = process.argv[2]
  const now = arg ? new Date(arg) : new Date()
  if (Number.isNaN(now.getTime())) {
    console.error('Invalid reference instant. Pass an ISO date-time, e.g. 2026-06-01T15:00:00Z')
    process.exit(1)
  }

  process.stdout.write(`→ running daily anchor (now=${now.toISOString()}) ...\n`)
  const summary = await runDailyAnchors({ now })
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
