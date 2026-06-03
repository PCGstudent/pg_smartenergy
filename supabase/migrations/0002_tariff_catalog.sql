-- =====================================================================
-- Voltwise — tariff catalog v2
-- * Corrects EDP energy rate and switches all PT tariffs to per-kVA
--   fixed pricing (fixes ~7 € gap vs real bills).
-- * Adds G9, Ibelectra, Galp, Goldenergy, Plenitude for PT.
-- * Adds Holaluz, Plenitude for ES.
-- Idempotent: deletes by (country, provider, name) before re-inserting.
-- =====================================================================

-- Remove stale rows (safe on first run too — nothing matches).
delete from public.tariffs
where (country, provider, name) in (
  ('PT', 'EDP Comercial',  'Tarifa Estável Simples'),
  ('PT', 'Coopérnico',     'Indexada OMIE'),
  ('PT', 'G9',             'Vantagem+'),
  ('PT', 'Ibelectra',      'Solução Conforto'),
  ('PT', 'Galp',           'Energia Simples'),
  ('PT', 'Goldenergy',     'Click Simples'),
  ('PT', 'Plenitude',      'Simples'),
  ('ES', 'Endesa',         'One Luz'),
  ('ES', 'Octopus Energy', 'Octopus Indexada'),
  ('ES', 'Holaluz',        'Plan Estable'),
  ('ES', 'Plenitude',      'Singular')
);

-- PT tariffs -----------------------------------------------------------
-- fixed_monthly_eur_per_kva replaces the old flat fixed_monthly_eur.
-- PT regulated network access for BTN ≤ 10.35 kVA ≈ 1.85 €/kVA/month;
-- adding retailer commercialisation margin gives:
--   EDP / mainstream:   2.513 €/kVA/month  (verified from real bill: 17.34 € ÷ 6.9 kVA)
--   Coopérnico:         2.15  €/kVA/month  (cooperative, lower margin)
--   Goldenergy:         2.25  €/kVA/month  (challenger, lower margin)

insert into public.tariffs (country, provider, name, type, formula, fees)
values
  -- EDP Comercial — corrected energy price + per-kVA term
  ('PT', 'EDP Comercial', 'Tarifa Estável Simples', 'fixed',
   '{"fixed_eur_kwh": 0.167, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

  -- Coopérnico — OMIE-indexed, per-kVA term
  ('PT', 'Coopérnico', 'Indexada OMIE', 'indexed',
   '{"markup_eur_mwh": 30, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.15}'::jsonb),

  -- G9 Vantagem+ — rate back-calculated from Manie comparison (49.95 € / 206 kWh / 6.9 kVA)
  ('PT', 'G9', 'Vantagem+', 'fixed',
   '{"fixed_eur_kwh": 0.1435, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

  -- Ibelectra Solução Conforto — rate back-calculated from Manie (51.87 €)
  ('PT', 'Ibelectra', 'Solução Conforto', 'fixed',
   '{"fixed_eur_kwh": 0.1523, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

  -- Galp Energia Simples
  ('PT', 'Galp', 'Energia Simples', 'fixed',
   '{"fixed_eur_kwh": 0.159, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

  -- Goldenergy Click Simples
  ('PT', 'Goldenergy', 'Click Simples', 'fixed',
   '{"fixed_eur_kwh": 0.147, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.25}'::jsonb),

  -- Plenitude Simples
  ('PT', 'Plenitude', 'Simples', 'fixed',
   '{"fixed_eur_kwh": 0.151, "taxes": {"iva": 0.06}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.513}'::jsonb),

-- ES tariffs -----------------------------------------------------------
-- Spain uses kW (not kVA) for contracted power; fixed_monthly_eur_per_kva
-- still works — pass the kW value as contractedKva from the extraction.
-- Per-kW rates for ES BTN residential 2025: ~3.1–3.5 €/kW/month.

  -- Endesa One Luz
  ('ES', 'Endesa', 'One Luz', 'fixed',
   '{"fixed_eur_kwh": 0.142, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.1}'::jsonb),

  -- Octopus Energy Indexada
  ('ES', 'Octopus Energy', 'Octopus Indexada', 'indexed',
   '{"markup_eur_mwh": 25, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 2.8}'::jsonb),

  -- Holaluz Plan Estable
  ('ES', 'Holaluz', 'Plan Estable', 'fixed',
   '{"fixed_eur_kwh": 0.149, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.1}'::jsonb),

  -- Plenitude Singular
  ('ES', 'Plenitude', 'Singular', 'fixed',
   '{"fixed_eur_kwh": 0.145, "taxes": {"iva": 0.10}}'::jsonb,
   '{"fixed_monthly_eur_per_kva": 3.1}'::jsonb);
