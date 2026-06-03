/**
 * One-shot i18n injector for the DAILY alert engine (the once-a-day anchor).
 *
 * Adds `alerts.daily.*` to every locale file:
 *   - anchor.{title,body}    charging-window anchor   params: {appliance, window, price, cost, saved}
 *   - free.{title,body}      free / near-free energy  params: {window, price}
 *   - negative.{title,body}  negative price (grid pays you)  params: {window}
 *   - spike.{title,body}     price spike to avoid     params: {window, price}
 *
 * All copy is EUROS ONLY (€ / €/kWh, never €/MWh) and push/WhatsApp friendly (no markdown).
 * Idempotent: re-running overwrites only the `alerts.daily` subtree. Default locale = pt.
 *   node scripts/add-daily-alert-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const messagesDir = join(here, '..', 'messages')

/** Per-locale copy for `alerts.daily`. Primary locale = pt. */
const DAILY = {
  pt: {
    anchor: {
      title: '🔋 A tua janela de amanhã',
      body: 'Liga {appliance} entre {window} amanhã — preço final ~{price}, cerca de {cost} pela carga completa. Poupas {saved} face à pior hora.',
    },
    free: {
      title: '⚡ Energia quase grátis amanhã',
      body: 'Amanhã entre {window} a energia cai para ~{price}. Aproveita para pôr a lavar, carregar o carro ou aquecer água.',
    },
    negative: {
      title: '💸 Preço negativo amanhã',
      body: 'Amanhã entre {window} a rede chega a pagar-te para consumires. É a melhor altura para usar tudo o que puderes.',
    },
    spike: {
      title: '🔴 Pico de preço amanhã',
      body: 'Amanhã entre {window} a energia dispara até ~{price}. Evita cargas pesadas nessas horas e poupa.',
    },
  },
  es: {
    anchor: {
      title: '🔋 Tu franja de mañana',
      body: 'Pon {appliance} entre {window} mañana — precio final ~{price}, unos {cost} por la carga completa. Ahorras {saved} frente a la peor hora.',
    },
    free: {
      title: '⚡ Energía casi gratis mañana',
      body: 'Mañana entre {window} la energía baja a ~{price}. Aprovecha para lavar, cargar el coche o calentar agua.',
    },
    negative: {
      title: '💸 Precio negativo mañana',
      body: 'Mañana entre {window} la red llega a pagarte por consumir. Es el mejor momento para usar todo lo que puedas.',
    },
    spike: {
      title: '🔴 Pico de precio mañana',
      body: 'Mañana entre {window} la energía se dispara hasta ~{price}. Evita cargas pesadas a esas horas y ahorra.',
    },
  },
  en: {
    anchor: {
      title: '🔋 Your window for tomorrow',
      body: 'Run {appliance} between {window} tomorrow — final price ~{price}, about {cost} for the full charge. You save {saved} vs the worst hour.',
    },
    free: {
      title: '⚡ Near-free energy tomorrow',
      body: 'Tomorrow between {window} energy drops to ~{price}. Great time to run a wash, charge the car or heat water.',
    },
    negative: {
      title: '💸 Negative price tomorrow',
      body: 'Tomorrow between {window} the grid will even pay you to consume. The best moment to use everything you can.',
    },
    spike: {
      title: '🔴 Price spike tomorrow',
      body: 'Tomorrow between {window} energy jumps to ~{price}. Avoid heavy loads in those hours and save.',
    },
  },
}

for (const [locale, daily] of Object.entries(DAILY)) {
  const path = join(messagesDir, `${locale}.json`)
  const json = JSON.parse(readFileSync(path, 'utf8'))

  json.alerts = json.alerts ?? {}
  json.alerts.daily = daily

  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`updated ${locale}.json`)
}
