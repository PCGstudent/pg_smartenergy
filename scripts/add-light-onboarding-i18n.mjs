/**
 * One-shot i18n injector for the frictionless onboarding light path.
 *
 * Adds:
 *   - onboarding.back, onboarding.load.*  (load picker step)
 *   - plan.monthly.*                      (monthly-saving teaser card)
 *
 * Idempotent: re-running overwrites only these subtrees, leaving everything else intact.
 * Run with:  node scripts/add-light-onboarding-i18n.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const messagesDir = join(here, '..', 'messages')

/** Per-locale copy. Default/primary locale = pt. */
const COPY = {
  pt: {
    onboardingDescription:
      'Uma pergunta e estás dentro. Escolhe o país do teu contador — depois, em poucos toques, dizemos-te quanto poupas por mês a carregar nas horas certas. Sem fatura, sem CSV.',
    back: 'Voltar',
    load: {
      prompt: 'O que queres pôr a poupar primeiro?',
      promptHint:
        'Escolhe a tua carga principal. Calculamos já a janela mais barata de amanhã — em euros sobre o teu preço final.',
      profiles: {
        ev: 'Carro elétrico',
        water_heater: 'Termoacumulador',
        washer: 'Máquina de lavar',
        dishwasher: 'Máquina de loiça',
      },
      energyLabel: 'Energia por carga (kWh)',
      daysLabel: 'Dias por semana',
      availabilityLabel: 'Quando pode ligar?',
      availability: {
        overnight: 'De noite',
        daytime: 'De dia',
        anytime: 'A qualquer hora',
      },
      availabilityHint: {
        overnight: 'Otimizamos no vale da madrugada (00h–08h), quando a energia é mais barata.',
        daytime: 'Procuramos a hora mais barata entre as 9h e as 18h.',
        anytime: 'Sem restrições — escolhemos a hora mais barata do dia inteiro.',
      },
      cta: 'Ver a minha poupança',
      skip: 'Salto isto por agora',
    },
    monthly: {
      kicker: 'Poupança estimada',
      perMonth: '/mês',
      body: 'É o que poupas a carregar {appliance} nas horas mais baratas em vez de a qualquer hora — cerca de {perRun} por carga, ~{runs} cargas por mês. Sobre o teu preço final, em euros.',
    },
  },
  es: {
    onboardingDescription:
      'Una pregunta y listo. Elige el país de tu contador — luego, en unos toques, te decimos cuánto ahorras al mes cargando a las horas correctas. Sin factura, sin CSV.',
    back: 'Volver',
    load: {
      prompt: '¿Qué quieres poner a ahorrar primero?',
      promptHint:
        'Elige tu carga principal. Calculamos ya la franja más barata de mañana — en euros sobre tu precio final.',
      profiles: {
        ev: 'Coche eléctrico',
        water_heater: 'Termo eléctrico',
        washer: 'Lavadora',
        dishwasher: 'Lavavajillas',
      },
      energyLabel: 'Energía por carga (kWh)',
      daysLabel: 'Días por semana',
      availabilityLabel: '¿Cuándo puede encenderse?',
      availability: {
        overnight: 'De noche',
        daytime: 'De día',
        anytime: 'A cualquier hora',
      },
      availabilityHint: {
        overnight: 'Optimizamos en el valle de la madrugada (00h–08h), cuando la energía es más barata.',
        daytime: 'Buscamos la hora más barata entre las 9h y las 18h.',
        anytime: 'Sin restricciones — elegimos la hora más barata de todo el día.',
      },
      cta: 'Ver mi ahorro',
      skip: 'Me lo salto por ahora',
    },
    monthly: {
      kicker: 'Ahorro estimado',
      perMonth: '/mes',
      body: 'Es lo que ahorras cargando {appliance} en las horas más baratas en vez de a cualquier hora — unos {perRun} por carga, ~{runs} cargas al mes. Sobre tu precio final, en euros.',
    },
  },
  en: {
    onboardingDescription:
      "One question and you're in. Pick the country your meter is in — then, in a few taps, we'll show you how much you save each month by charging at the right hours. No invoice, no CSV.",
    back: 'Back',
    load: {
      prompt: 'What should we start saving on?',
      promptHint:
        "Pick your main load. We'll compute tomorrow's cheapest window right away — in euros on your final price.",
      profiles: {
        ev: 'Electric car',
        water_heater: 'Water heater',
        washer: 'Washing machine',
        dishwasher: 'Dishwasher',
      },
      energyLabel: 'Energy per charge (kWh)',
      daysLabel: 'Days per week',
      availabilityLabel: 'When can it run?',
      availability: {
        overnight: 'Overnight',
        daytime: 'Daytime',
        anytime: 'Anytime',
      },
      availabilityHint: {
        overnight: 'We optimise in the early-morning valley (00:00–08:00), when power is cheapest.',
        daytime: 'We find the cheapest hour between 9:00 and 18:00.',
        anytime: "No constraints — we pick the cheapest hour of the whole day.",
      },
      cta: 'See my saving',
      skip: 'Skip this for now',
    },
    monthly: {
      kicker: 'Estimated saving',
      perMonth: '/month',
      body: 'That is what you save charging {appliance} in the cheapest hours instead of any hour — about {perRun} per charge, ~{runs} charges a month. On your final price, in euros.',
    },
  },
}

for (const [locale, copy] of Object.entries(COPY)) {
  const path = join(messagesDir, `${locale}.json`)
  const json = JSON.parse(readFileSync(path, 'utf8'))

  json.onboarding = json.onboarding ?? {}
  json.onboarding.description = copy.onboardingDescription
  json.onboarding.back = copy.back
  json.onboarding.load = copy.load

  json.plan = json.plan ?? {}
  json.plan.monthly = copy.monthly

  writeFileSync(path, JSON.stringify(json, null, 2) + '\n', 'utf8')
  console.log(`updated ${locale}.json`)
}
