import { EventSchemas, Inngest } from 'inngest'

type Events = {
  'voltwise/ingest.omie.requested': {
    data: {
      /** ISO date string (YYYY-MM-DD). Defaults to D+1 in Madrid time. */
      date?: string
    }
  }
  'voltwise/invoice.uploaded': {
    data: { invoiceId: string; userId: string }
  }
  'voltwise/alerts.evaluate': {
    data: {
      /** Optional reference time (ISO). Defaults to now. Used by tests/replay. */
      now?: string
    }
  }
  'voltwise/alerts.daily': {
    data: {
      /** Optional reference time (ISO). "Tomorrow" is the next local day from here. */
      now?: string
    }
  }
}

export const inngest = new Inngest({
  id: 'voltwise',
  schemas: new EventSchemas().fromRecord<Events>(),
})
