import { describe, expect, it } from 'vitest'
import { dailyAlertHtml } from './resend'

/**
 * Content coverage for the daily-anchor email template — NO real email is sent. We assert
 * the localized, euros-only message body is embedded, the CTA links to the plan, and that
 * interpolated values are HTML-escaped (defense in depth). Euros-only is the caller's job
 * (the decision engine renders the copy); here we prove the template doesn't reintroduce a
 * wholesale €/MWh unit of its own.
 */

const base = {
  title: '🔋 A tua janela de amanhã',
  body: 'Liga o carro entre 2h–4h amanhã — preço final ~0,08 €/kWh, cerca de 0,64 € pela carga.',
  ctaLabel: 'Ver o meu plano',
  ctaUrl: 'https://voltwise.app/plan',
  footnote: 'Recebes este email porque ativaste avisos diários.',
  locale: 'pt',
}

describe('dailyAlertHtml', () => {
  it('embeds the localized title, body, CTA label and link', () => {
    const html = dailyAlertHtml(base)
    expect(html).toContain('A tua janela de amanhã')
    expect(html).toContain('preço final ~0,08 €/kWh')
    expect(html).toContain('Ver o meu plano')
    expect(html).toContain('href="https://voltwise.app/plan"')
    expect(html).toContain(base.footnote)
    expect(html).toContain('lang="pt"')
  })

  it('contains no wholesale €/MWh unit of its own (product rule #1)', () => {
    const html = dailyAlertHtml(base)
    expect(html).not.toMatch(/MWh/i)
  })

  it('HTML-escapes interpolated values to prevent markup injection', () => {
    const html = dailyAlertHtml({
      ...base,
      title: 'Spike <script>alert(1)</script> & "quotes"',
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;')
  })

  it('defaults the lang attribute to pt when no locale is given', () => {
    const html = dailyAlertHtml({ ...base, locale: undefined })
    expect(html).toContain('lang="pt"')
  })
})
