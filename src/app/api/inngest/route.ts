import { serve } from 'inngest/next'
import { inngest } from '@/lib/inngest/client'
import { functions } from '@/lib/inngest/functions'

/**
 * Inngest webhook endpoint.
 * Inngest cloud calls this URL to dispatch cron + event-driven functions.
 * Locally: run `npx inngest-cli dev` and it will auto-discover this endpoint.
 */
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
})
