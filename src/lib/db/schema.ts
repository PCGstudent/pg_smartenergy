import { sql } from 'drizzle-orm'
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * profiles
 * Extends auth.users (Supabase) with app-specific fields.
 * RLS: user can only read/write own row (enforced in SQL migration).
 */
export const profiles = pgTable('profiles', {
  id: uuid('id').primaryKey(), // FK to auth.users(id)
  country: text('country'), // 'PT' | 'ES' — null until onboarding picks one
  displayName: text('display_name'),
  locale: text('locale').default('pt'),
  currentProvider: text('current_provider'),
  currentTariffId: uuid('current_tariff_id'),
  whatsappE164: text('whatsapp_e164'),
  pushSubscription: jsonb('push_subscription'),
  notificationPrefs: jsonb('notification_prefs').default({}),
  /** kW of contracted power — used for fixed-term calculation; NULL = use DEFAULT_CONTRACTED_KVA (6.9). */
  contractedKva: numeric('contracted_kva', { precision: 5, scale: 2 }),
  /** Set when the user completes the country picker. Null = first-time, send to /onboarding. */
  onboardedAt: timestamp('onboarded_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * market_prices
 * Hourly day-ahead prices from OMIE (and other sources later).
 * `ts` = period START in UTC.
 * Public-readable, service-role-only writes.
 */
export const marketPrices = pgTable(
  'market_prices',
  {
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    zone: text('zone').notNull(), // 'PT' | 'ES'
    priceEurMwh: numeric('price_eur_mwh', { precision: 10, scale: 4 }).notNull(),
    source: text('source').notNull().default('OMIE_PBC'),
    fetchedAt: timestamp('fetched_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.zone, t.ts] }),
    zoneTsIdx: index('idx_market_prices_zone_ts').on(t.zone, t.ts),
  }),
)

/**
 * price_forecasts
 * Model-generated predictions; multiple model_versions can coexist.
 */
export const priceForecasts = pgTable(
  'price_forecasts',
  {
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    zone: text('zone').notNull(),
    predictedEurMwh: numeric('predicted_eur_mwh', { precision: 10, scale: 4 }).notNull(),
    lowerBound: numeric('lower_bound', { precision: 10, scale: 4 }),
    upperBound: numeric('upper_bound', { precision: 10, scale: 4 }),
    modelVersion: text('model_version').notNull(),
    features: jsonb('features'),
    generatedAt: timestamp('generated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.zone, t.ts, t.modelVersion] }),
  }),
)

/**
 * tariffs
 * Catalog of retail tariffs we benchmark against (fixed/indexed plans).
 * `formula` shape:
 *   {
 *     markup_eur_mwh?: number,        // for indexed: markup over OMIE
 *     fixed_eur_kwh?: number,         // for fixed: flat rate
 *     fixed_monthly_eur?: number,     // power term
 *     taxes: { iva: number, ie?: number, csa?: number }
 *   }
 */
export const tariffs = pgTable('tariffs', {
  id: uuid('id').primaryKey().defaultRandom(),
  country: text('country').notNull(),
  provider: text('provider').notNull(),
  name: text('name').notNull(),
  type: text('type').notNull(), // 'fixed' | 'indexed' | 'dual'
  formula: jsonb('formula').notNull(),
  fees: jsonb('fees'),
  activeFrom: date('active_from'),
  activeTo: date('active_to'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * invoices
 * User-uploaded PDFs; raw + AI-extracted fields.
 */
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  storagePath: text('storage_path').notNull(),
  provider: text('provider'),
  periodStart: date('period_start'),
  periodEnd: date('period_end'),
  totalAmountEur: numeric('total_amount_eur', { precision: 10, scale: 2 }),
  totalKwh: numeric('total_kwh', { precision: 10, scale: 2 }),
  hourlyConsumption: jsonb('hourly_consumption'),
  aiExtraction: jsonb('ai_extraction'),
  status: text('status').notNull().default('pending'), // 'pending' | 'processed' | 'error'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * audits
 * Result of comparing an invoice against alternative tariffs.
 */
export const audits = pgTable('audits', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').notNull(),
  userId: uuid('user_id').notNull(),
  baselineCostEur: numeric('baseline_cost_eur', { precision: 10, scale: 2 }).notNull(),
  projectedCostEur: numeric('projected_cost_eur', { precision: 10, scale: 2 }).notNull(),
  savingsEur: numeric('savings_eur', { precision: 10, scale: 2 }).notNull(),
  savingsPct: numeric('savings_pct', { precision: 5, scale: 2 }).notNull(),
  alternativeTariffId: uuid('alternative_tariff_id'),
  detail: jsonb('detail'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * consumption_readings
 * Hourly user consumption from Datadis (ES) / E-Redes (PT).
 */
export const consumptionReadings = pgTable(
  'consumption_readings',
  {
    userId: uuid('user_id').notNull(),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    kwh: numeric('kwh', { precision: 10, scale: 4 }).notNull(),
    source: text('source').notNull(), // 'datadis' | 'eredes_csv' | 'manual'
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userId, t.ts] }),
  }),
)

/**
 * alerts — user-defined alert rules.
 */
export const alerts = pgTable('alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(), // 'cheap_hour' | 'free_energy' | 'spike' | 'negative'
  thresholdEurMwh: numeric('threshold_eur_mwh', { precision: 10, scale: 4 }),
  channels: text('channels').array().notNull().default(sql`ARRAY['push']::text[]`),
  active: boolean('active').notNull().default(true),
  schedule: jsonb('schedule'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

/**
 * alert_events — audit trail of fired alerts.
 */
export const alertEvents = pgTable('alert_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  alertId: uuid('alert_id').notNull(),
  userId: uuid('user_id').notNull(),
  sentAt: timestamp('sent_at', { withTimezone: true }).defaultNow().notNull(),
  channel: text('channel').notNull(),
  payload: jsonb('payload'),
  status: text('status').notNull().default('sent'),
})

/**
 * user_appliances — a user's controllable/shiftable loads.
 *
 * Drives the "Hoje & Amanhã" planner: each active appliance is mapped to its
 * cheapest FINAL-price charging window for tomorrow. `energy_kwh` + `power_kw`
 * feed the window optimizer (slots = ceil(energy/power)); `typical_duration_min`
 * is informational UX only. `earliest_hour`/`latest_hour` are LOCAL-hour
 * availability constraints (Europe/Lisbon for PT). RLS: owner-only.
 */
export const userAppliances = pgTable(
  'user_appliances',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    label: text('label').notNull(),
    // 'ev' | 'washer' | 'dishwasher' | 'water_heater' | 'home_battery' | 'dryer' | 'pool_pump' | 'other'
    type: text('type').notNull().default('other'),
    energyKwh: numeric('energy_kwh', { precision: 8, scale: 3 }).notNull(),
    powerKw: numeric('power_kw', { precision: 6, scale: 3 }).notNull(),
    typicalDurationMin: integer('typical_duration_min'),
    interruptible: boolean('interruptible').notNull().default(false),
    /** Earliest allowed local start hour (0–24, inclusive). 0 = no constraint. */
    earliestHour: integer('earliest_hour').notNull().default(0),
    /** Latest local hour by which it must finish (0–24, exclusive). 24 = no constraint. */
    latestHour: integer('latest_hour').notNull().default(24),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index('idx_user_appliances_user').on(t.userId, t.active),
  }),
)

/**
 * savings_ledger — per-(user, day) realized € saving (the "já poupaste X€" figure).
 *
 * One row per user per local day, carrying the EUROS that day's smart-charging plan
 * saved vs charging at a typical hour, summed across the user's active loads (FINAL
 * price, euros only). Written idempotently by the daily-anchor runner; read back as a
 * cumulative month/year total on /plan and /dashboard. RLS: owner-only read.
 */
export const savingsLedger = pgTable(
  'savings_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull(),
    /** The LOCAL day this saving is for (the planned day). */
    date: date('date').notNull(),
    /** € saved that day by timing loads vs a typical hour. Always >= 0. FINAL price. */
    estimatedSavingEur: numeric('estimated_saving_eur', { precision: 10, scale: 2 })
      .notNull()
      .default('0'),
    /** Per-appliance breakdown: [{ appliance_id, label, saving_eur }]. */
    breakdown: jsonb('breakdown').notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userDateUnique: uniqueIndex('savings_ledger_user_date_unique').on(t.userId, t.date),
    userDateIdx: index('idx_savings_ledger_user_date').on(t.userId, t.date),
  }),
)

/**
 * devices — IoT integrations (Phase 2).
 */
export const devices = pgTable('devices', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull(),
  type: text('type').notNull(), // 'shelly' | 'tuya'
  label: text('label'),
  credentialsEncrypted: text('credentials_encrypted'), // base64 ciphertext
  rules: jsonb('rules'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
})

export type Profile = typeof profiles.$inferSelect
export type MarketPrice = typeof marketPrices.$inferSelect
export type MarketPriceInsert = typeof marketPrices.$inferInsert
export type Tariff = typeof tariffs.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type Audit = typeof audits.$inferSelect
export type Alert = typeof alerts.$inferSelect
export type ConsumptionReading = typeof consumptionReadings.$inferSelect
export type UserAppliance = typeof userAppliances.$inferSelect
export type UserApplianceInsert = typeof userAppliances.$inferInsert
export type SavingsLedgerRow = typeof savingsLedger.$inferSelect
export type SavingsLedgerInsert = typeof savingsLedger.$inferInsert
