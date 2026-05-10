'use client'

import { motion } from 'framer-motion'
import { FileText, LineChart, Zap } from 'lucide-react'

const STEPS = [
  {
    n: '01',
    icon: LineChart,
    title: 'See the day-ahead market',
    body: "We pull MIBEL prices for Portugal and Spain hour by hour. The Oracle shows you the cheapest and most expensive windows — in cents per kWh, not jargon.",
  },
  {
    n: '02',
    icon: FileText,
    title: 'Audit your last bill',
    body: "Drag in your EDP, Endesa, Iberdrola or Galp PDF. Our AI reads it, matches your consumption against an indexed tariff, and tells you — to the euro — what you would have paid instead.",
  },
  {
    n: '03',
    icon: Zap,
    title: 'Save automatically',
    body: "Get push or WhatsApp alerts before energy goes free. Connect a smart plug and Voltwise schedules your dishwasher, EV charger, and water heater on golden hours.",
  },
] as const

export function HowItWorks() {
  return (
    <section className="container py-24">
      <div className="mb-12 max-w-2xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-wider text-primary">
          Three minutes from skeptic to saver
        </p>
        <h2 className="text-balance text-3xl font-semibold tracking-tight md:text-4xl">
          The energy market isn&apos;t broken. It&apos;s just hidden.
        </h2>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <motion.div
            key={step.n}
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: '-80px' }}
            transition={{ duration: 0.4, delay: i * 0.08 }}
            className="group relative overflow-hidden rounded-2xl border border-border/60 bg-card/40 p-6"
          >
            <div className="num mb-6 text-xs font-semibold tracking-wider text-muted-foreground">
              {step.n}
            </div>
            <div className="mb-4 grid h-10 w-10 place-items-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/30">
              <step.icon className="h-4 w-4" />
            </div>
            <h3 className="text-lg font-medium">{step.title}</h3>
            <p className="mt-2 text-sm text-muted-foreground">{step.body}</p>
          </motion.div>
        ))}
      </div>
    </section>
  )
}
