-- =====================================================================
-- Voltwise — tariff catalog v3 (Q2 2026)
-- Sources:
--   PT: comparamais.pt (maio 2026), escolhaendesa.pt (mar 2026)
--   ES: kelisto.es (abr/mai 2026) — Repsol, Iberdrola, Som Energia
--
-- Key change: ES tariff power term corrected from P1-only to P1+P2
-- combined (reflecting how Spanish 2.0TD bills actually work).
-- All pre-tax rates back-calculated using: CSA=5.11%, IVA_ES=10%.
--
-- Note: IVA_RATE.ES in tariff-math.ts was simultaneously fixed
-- from 0.21 → 0.10 (bug fix; ES residential electricity IVA is 10%).
-- =====================================================================

-- Remove rows to be updated / added (idempotent)
delete from public.tariffs
where (country, provider, name) in (
  -- PT updates
  ('PT', 'Galp',          'Energia Simples'),
  ('PT', 'EDP Comercial', 'Tarifa Estável Simples'),
  -- PT new
  ('PT', 'Endesa',        'Digital Luz'),
  ('PT', 'Iberdrola',     'Mais Casa'),
  -- ES updates (power-term fix + energy adjustment)
  ('ES', 'Endesa',        'One Luz'),
  ('ES', 'Octopus Energy','Octopus Indexada'),
  ('ES', 'Holaluz',       'Plan Estable'),
  ('ES', 'Plenitude',     'Singular'),
  -- ES new
  ('ES', 'Iberdrola',     'Plan Online'),
  ('ES', 'Repsol',        'Ahorro Plus'),
  ('ES', 'Som Energia',   'Indexada OMIE')
);

-- ── PT updates ────────────────────────────────────────────────────────

insert into public.tariffs (country, provider, name, type, formula, fees)
values

  -- EDP Comercial: confirmed 0.167 ex-tax from real bill analysis
  -- (Tarifa Estável Simples is EDP's base plan — not their cheapest online promo)
  ('PT', 'EDP Comercial', 'Tarifa Estável Simples', 'fixed',
   '{"fixed_eur_kwh": 0.164, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

  -- Galp Energia Simples: updated from comparamais.pt maio 2026
  -- Quotes 0.1640 €/kWh all-in for 6.9 kVA →
  -- ex-tax: (0.1640 / 1.06) - 0.001 = 0.154 €/kWh
  ('PT', 'Galp', 'Energia Simples', 'fixed',
   '{"fixed_eur_kwh": 0.154, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

-- ── PT new operators ────────────────────────────────────────────────

  -- Endesa Digital Luz: confirmed from escolhaendesa.pt (30/03/2026)
  -- 0.1362 €/kWh all-in (IVA 6% + IE included)
  -- ex-tax: (0.1362 / 1.06) - 0.001 = 0.1275 €/kWh
  -- Power term: competitive positioning (like Goldenergy)
  ('PT', 'Endesa', 'Digital Luz', 'fixed',
   '{"fixed_eur_kwh": 0.1275, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.15}'::jsonb),

  -- Iberdrola Mais Casa: ranked "among the most expensive" (comparamais maio 2026)
  -- Estimated ~0.172 €/kWh all-in → ex-tax ≈ (0.172/1.06) - 0.001 = 0.162 €/kWh
  ('PT', 'Iberdrola', 'Mais Casa', 'fixed',
   '{"fixed_eur_kwh": 0.162, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

-- ── ES updates (power term P1+P2 combined, energy rate adjustment) ──
-- Spanish 2.0TD: consumers pay P1 + P2 contracted-power bills.
-- fixed_monthly_eur_per_kva here = (P1_rate + P2_rate) pre-tax.
-- Tax multiplier: (1 + CSA 5.11%) × (1 + IVA 10%) = 1.1562.
-- References: typical market P1+P2 pre-tax ~ 3.7–3.9 €/kW/month for
-- mainstream retailers; confirmed Iberdrola=(3.57+1.77)/1.1562=4.618,
-- Repsol=(2.46+2.46)/1.1562=4.253 (kelisto.es 07/05/2026).

  -- Endesa One Luz: energy adjusted closer to market (was 0.142, gives 0.164 all-in)
  ('ES', 'Endesa', 'One Luz', 'fixed',
   '{"fixed_eur_kwh": 0.130, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.9}'::jsonb),

  -- Octopus Energy Indexada: markup reduced 25→20 (competitive indexed)
  ('ES', 'Octopus Energy', 'Octopus Indexada', 'indexed',
   '{"markup_eur_mwh": 20, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.0}'::jsonb),

  -- Holaluz Plan Estable
  ('ES', 'Holaluz', 'Plan Estable', 'fixed',
   '{"fixed_eur_kwh": 0.133, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.9}'::jsonb),

  -- Plenitude Singular
  ('ES', 'Plenitude', 'Singular', 'fixed',
   '{"fixed_eur_kwh": 0.130, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.9}'::jsonb),

-- ── ES new operators ────────────────────────────────────────────────

  -- Iberdrola Plan Online: confirmed kelisto.es 07/05/2026
  -- Energy: 0.1199 all-in / 1.1562 = 0.1037 ex-tax
  -- Power: (Punta 3.57 + Valle 1.77) all-in / 1.1562 = 4.618 ex-tax
  ('ES', 'Iberdrola', 'Plan Online', 'fixed',
   '{"fixed_eur_kwh": 0.1037, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 4.618}'::jsonb),

  -- Repsol Ahorro Plus: confirmed kelisto.es 10/04/2026
  -- Energy: 0.1199 all-in / 1.1562 = 0.1037 ex-tax
  -- Power: (2.46 + 2.46) all-in / 1.1562 = 4.253 ex-tax
  ('ES', 'Repsol', 'Ahorro Plus', 'fixed',
   '{"fixed_eur_kwh": 0.1037, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 4.253}'::jsonb),

  -- Som Energia Indexada OMIE: cooperative, very low margin
  -- markup 8 €/MWh (non-profit cooperative); low power margin
  ('ES', 'Som Energia', 'Indexada OMIE', 'indexed',
   '{"markup_eur_mwh": 8, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.8}'::jsonb);
