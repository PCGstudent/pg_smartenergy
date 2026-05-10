# Voltwise

> The Iberian energy co-pilot. Real-time OMIE prices, AI invoice audits, smart alerts — for Portugal and Spain.

Voltwise turns raw MIBEL day-ahead data into actionable, euro-denominated guidance: when to charge the EV, when to skip the dryer, and how much you'd save by switching off a fixed tariff.

This repo is the MVP. The current scope:

- ✅ Real OMIE day-ahead ingestion (PT + ES) with archival, idempotent upserts, and DST-aware parsing
- ✅ Drizzle + Supabase schema with full RLS for users, invoices, alerts, devices
- ✅ Inngest cron (`14:30 Europe/Madrid`) plus a manual `POST /api/ingest/omie` for backfills
- ✅ "Fintech luxury" landing + dashboard: live ticker, Next Best Action, Golden/Red hours, 36h chart
- ✅ Magic-link auth (Supabase email OTP) with country-picker onboarding and middleware-protected routes
- ✅ **The Auditor** — drop a PDF, Gemini 2.5 extracts every line item, we replay against OMIE + every alternative tariff, headline you the savings
- ✅ **Smart Guard** — user-defined alerts (cheap/free/negative/spike) × hourly Inngest evaluator × Web Push (VAPID) + WhatsApp Cloud API dispatch with cooldowns and quiet hours
- ✅ **PWA** — installable on iOS/Android, generated icon + apple-touch-icon, install prompt, full-screen standalone launch (also unlocks iOS 16.4+ Web Push)
- ✅ **Offline shell** — Serwist 9 service worker with stale-while-revalidate price cache, network-first pages, cache-first fonts, dark themed `/offline` fallback
- ✅ **Internationalization** — next-intl with `pt-PT` and `es-ES` translations across landing, dashboard, nav, offline, install prompt; cookie + profile + Accept-Language locale resolution; in-app language switcher
- ✅ Public price API (`GET /api/prices/today`)
- ✅ Vercel deploy config (`fra1` region for low-latency Iberian users)
- 🔜 Datadis/E-Redes consumption, LightGBM forecasting, IoT plugs, multi-bill audits, full i18n coverage on Auditor + Alerts surfaces

---

## Stack

| Layer | Tech |
|---|---|
| Framework | Next.js 15 (App Router, RSC) + React 19 + TypeScript |
| UI | Tailwind v3 · shadcn-style primitives · Recharts · Framer Motion · Geist |
| DB / Auth / Storage | Supabase Postgres 16 (RLS + Storage + Auth) |
| ORM | Drizzle (`postgres-js`) |
| Background | Inngest (cron + event-driven) |
| AI | **Google Gemini 2.5 Flash** (invoice extraction, structured JSON output via responseSchema) |
| Hosting | Vercel + Supabase + Upstash + Inngest cloud |

See `next.config.ts` for security headers and `tailwind.config.ts` for brand tokens.

---

## Getting started

### 1. Install

```bash
pnpm install        # or npm install / yarn
```

### 2. Provision Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. From `Project Settings → API` copy the **URL** and the **anon** + **service_role** keys.
3. From `Project Settings → Database → Connection string → URI` copy the **transaction pooler** URL (port `6543`). It looks like:
   `postgres://postgres.<ref>:<password>@aws-0-eu-west-1.pooler.supabase.com:6543/postgres`
4. Copy `.env.local.example` → `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL`
   - `INGEST_SECRET` (any long random string)

### 3. Push the schema

```bash
pnpm db:push        # creates all tables from src/lib/db/schema.ts
```

Then open the Supabase **SQL editor** and paste the contents of `supabase/migrations/0001_init.sql` to apply RLS policies, storage buckets, the auth trigger, and seed tariffs. (Re-runnable.)

Verify with:

```bash
pnpm db:studio
```

### 4. Run the dev server

```bash
pnpm dev
```

Visit http://localhost:3000 — you'll see the empty-state dashboard with curl instructions.

### 5. First OMIE ingest

You have three options:

**(a) CLI script** (simplest):

```bash
pnpm ingest:omie                       # tomorrow (D+1 Madrid)
pnpm ingest:omie 2024-05-14            # one specific date
pnpm ingest:omie 2024-05-01 2024-05-31 # backfill a month
```

**(b) HTTP** (works against deployed instance):

```bash
curl -X POST $NEXT_PUBLIC_APP_URL/api/ingest/omie \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date":"2024-05-14"}'
```

**(c) Inngest dev server** (recommended for testing the cron pipeline locally):

```bash
# In one shell, with the app running:
npx inngest-cli@latest dev -u http://localhost:3000/api/inngest
# Open http://localhost:8288, find `ingest-omie-manual`, fire it.
```

After ingest, refresh the dashboard — Golden Hours, Next Best Action, and the 36h chart light up.

### 6. Tests

```bash
pnpm test           # vitest run
pnpm test:watch
pnpm typecheck
```

The OMIE parser has a comprehensive unit-test suite covering CET/CEST conversion, negative prices, free hours, and bad-input handling.

---

## Authentication flow

Voltwise uses Supabase email magic links — no passwords. The flow:

1. User submits email at `/signin`. Browser calls `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: '<origin>/auth/callback?next=…' }})`.
2. Supabase emails a one-time link.
3. Click → `/auth/callback?code=…` exchanges the code for a session cookie.
4. The callback inspects `profiles.onboarded_at`:
   - **null** → redirect to `/onboarding` (PT/ES picker → server action sets country + onboarded_at)
   - **set**  → redirect to `?next=` or `/dashboard`
5. `src/middleware.ts` refreshes the session on every request and guards `/auditor`, `/alerts`, `/settings`, `/onboarding` (the dashboard stays public — OMIE data is free).

Key files:
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/middleware.ts` — Next.js middleware entry.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/supabase/middleware.ts` — session refresh + route guard.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/supabase/auth.ts` — `getSession()` helper for Server Components.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/signin/page.tsx` + `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/auth/sign-in-form.tsx`.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auth/callback/route.ts` — code exchange + onboarding routing.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auth/signout/route.ts` — POST + 303 to `/`.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/onboarding/` — country picker (`page.tsx`, `onboarding-form.tsx`, `actions.ts`).

### Supabase configuration checklist

In the Supabase dashboard:

1. **Auth → URL Configuration**
   - Site URL: `http://localhost:3000` (dev) and your Vercel domain (prod).
   - Redirect URLs: add `http://localhost:3000/auth/callback`, `https://YOUR-DOMAIN.vercel.app/auth/callback`.
2. **Auth → Email Templates → Magic Link**: optional rebrand. Default works.
3. **Auth → Providers → Email**: enable, disable signups confirmation if you want one-tap dev.
4. SQL: paste `supabase/migrations/0001_init.sql` (creates the `handle_new_user` trigger that auto-creates a profile row).

## The Auditor

Upload an Iberian electricity invoice (PDF) at `/auditor` → within ~30 seconds you get a euro-denominated comparison against every indexed tariff in the catalog.

### Pipeline

1. **Direct upload** → client streams the PDF to Supabase Storage at `invoices/<userId>/<uuid>.pdf` (RLS-enforced; users can only write to their own folder).
2. **Server action** `createAudit` → verifies the object exists, inserts an `invoices` row with `status='pending'`, fires Inngest event `voltwise/invoice.uploaded`.
3. **Inngest worker** `process-invoice` runs `runAudit(invoiceId)`:
   - Downloads the PDF.
   - Calls Gemini 2.5 Flash with `responseSchema` for typed JSON extraction (provider, period, totals, optional hourly consumption, tariff type, confidence).
   - **Backfills OMIE** for any missing dates in the billing period via `backfillOmieRange`.
   - Builds a consumption series — real if the invoice has hourly data, otherwise a synthetic residential profile scaled to the total kWh.
   - For each catalog tariff in the user's country, computes full-period cost (energy + fixed power term + PT IE / ES CSA + IVA) and savings against the actual amount paid.
   - Inserts an `audits` row with the full breakdown, flips the invoice to `processed`.
4. **`/auditor/[id]` page** auto-refreshes every 3s via `router.refresh()` while pending, then renders the headline result.

### Required env

```
GEMINI_API_KEY=AIza...      # https://aistudio.google.com/apikey
GEMINI_MODEL=gemini-2.5-flash   # optional override
```

### Tax model

We approximate Iberian taxes inside `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/pricing/tariff-math.ts`:

- **PT**: IE (Imposto Especial) at 1 €/MWh on energy, IVA 6% on (energy + fixed + IE).
- **ES**: CSA (Impuesto Especial) at 5.11% on (energy + fixed), IVA 21% on (energy + fixed + CSA).

Real bills can differ ~5% due to social bonuses, time-of-use surcharges, and provider-specific fees — the audit page surfaces a disclaimer.

### Files

- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/ai/invoice-schema.ts` — Zod + Gemini JSON schema, extraction prompt.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/ai/gemini.ts` — `extractInvoice(pdfBuffer)` wrapper.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/auditor/profile.ts` — synthetic 24h residential profile + tests.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/auditor/audit.ts` — `runAudit(invoiceId)` orchestrator.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/ingestion/backfill.ts` — idempotent OMIE date-range backfill.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/db/invoice-queries.ts` — typed Supabase query layer.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auditor/page.tsx`, `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auditor/upload-form.tsx`, `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auditor/actions.ts`.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auditor/[id]/page.tsx`, `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/auditor/[id]/processing.tsx`.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/auditor/audit-result.tsx` — the brutal "€80 vs €45" hero + comparison table.

## The Smart Guard

Users create alert rules at `/alerts`. Every hour at :15 Europe/Madrid, an Inngest cron loads every active alert, groups them by country (prices are country-wide), evaluates the next 24h window, and dispatches matches — idempotent within a 4-hour cooldown.

### Alert types

| Type | Trigger | Threshold |
|---|---|---|
| `free_energy` | Hour < 1 €/MWh | none |
| `negative` | Hour < 0 €/MWh | none |
| `cheap_hour` | Hour < threshold | user-set, default 50 €/MWh |
| `spike` | Hour > threshold | user-set, default 200 €/MWh |

Each alert has channels (`push`, `whatsapp`) and an optional schedule with `quietStartHour`, `quietEndHour` (24h local time, wraps midnight if end < start) and `weekdays` (ISO 1–7).

### Web Push setup

```powershell
npx web-push generate-vapid-keys
```

Paste the keys into `.env.local`:

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BL...
VAPID_PRIVATE_KEY=...
VAPID_SUBJECT=mailto:hello@voltwise.app
```

The service worker lives at `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/public/sw.js` and is registered when the user clicks **Enable** on `/alerts`. A test push fires immediately so they see it works.

### WhatsApp

Optional. Without `WHATSAPP_PHONE_NUMBER_ID` + `WHATSAPP_ACCESS_TOKEN` the dispatcher logs to stdout (dev stub). For production, register a Meta WhatsApp Business app and put the credentials in env. The first 1000 utility conversations / month are free.

### Files

- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/alerts/evaluator.ts` — pure matching logic with quiet-hour + weekday helpers (12 unit tests).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/alerts/dispatch.ts` — orchestrator: load + group + evaluate + cooldown + dispatch + record.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/notifications/web-push.ts` — VAPID-aware wrapper with expired-subscription handling.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/notifications/whatsapp.ts` — Meta Cloud API dispatcher with stdout stub.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/db/alert-queries.ts` — typed Supabase queries for alerts, events, and push subscription.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/alerts/page.tsx` — dashboard with toggle, create card, list, recent fires.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/alerts/push-toggle.tsx` — browser permission flow + PushManager subscription.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/api/push/{subscribe,test}/route.ts` — persist subscription + fire test push.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/public/sw.js` — service worker (push + notificationclick).

## Progressive Web App

Voltwise is installable on Android (Chrome/Edge/Samsung) via the `beforeinstallprompt` event, and on iOS Safari via Share → Add to Home Screen. Once installed it launches full-screen as a standalone app with its own icon.

### Why it matters

- **iOS Web Push only works on installed PWAs.** Smart Guard alerts are silently dropped on iPhone Safari unless the user adds Voltwise to their home screen. The install prompt handles this gracefully.
- **Lighthouse 90+** — the manifest, theme color, and apple-touch-icon are required for a perfect PWA score.
- **Habit formation** — a tile on the home screen turns Voltwise from "a website I sometimes visit" into "the energy weather app".

### Files

- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/manifest.ts` — Next 15 routes this to `/manifest.webmanifest`. Sets standalone display, theme color, shortcuts to Dashboard / Auditor / Alerts.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/icon.tsx` — generated 512×512 PNG favicon via `ImageResponse` (the same JSX used for the Apple icon — zero binary assets).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/apple-icon.tsx` — generated 180×180 PNG. Next auto-injects `<link rel="apple-touch-icon">`.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/public/icons/icon.svg` — master SVG for the manifest.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/public/icons/icon-maskable.svg` — maskable variant (full-bleed background, content within 80% safe zone).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/pwa/install-prompt.tsx` — dismissible banner: `beforeinstallprompt` for Chromium, manual instruction for iOS, hidden if already standalone or recently dismissed.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/public/sw.js` — service worker for Web Push (also serves as the foundation for offline caching when Serwist is added).

### Test it locally

1. `pnpm build && pnpm start` (PWA features need a production build to score correctly).
2. Open Chrome DevTools → Application → Manifest — verify icons and start_url.
3. DevTools → Lighthouse → Progressive Web App audit. Target: green across the board.
4. On Android: tap the install banner. On iOS Safari: Share → Add to Home Screen.

### Known limitations

- The icons are generated at request time on the edge (~10ms) — cached aggressively by Vercel/CDN, so this only affects cold starts.

## Offline shell (Serwist)

The service worker is built with [Serwist 9](https://serwist.pages.dev) (the modern Workbox fork that succeeded the deprecated `next-pwa`). It compiles from a single TypeScript source on every production build.

### Caching strategy

| Resource | Strategy | Why |
|---|---|---|
| `/api/prices/today` | Stale-while-revalidate (6h) | Instant repeat loads, fresh data fetched in the background. Critical for the dashboard. |
| `/api/audits/*` | Cache-first (24h) | Audit results are immutable once processed. |
| Fonts (`woff2`, Google Fonts) | Cache-first (1y) | Versioned filenames, never invalidate manually. |
| HTML navigations | Network-first (4s timeout) | Real-time price changes win, fallback to cache if offline. |
| Static assets, `_next/static`, images | Serwist defaults | Standard Workbox precaching. |

When network + cache both miss, the user lands on `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/offline/page.tsx` — a dark-themed fallback that stays in the Voltwise look.

### Files

- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/sw.ts` — single source of truth for the SW. Combines Serwist runtime caching + Voltwise push + notification-click handler.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/next.config.ts` — wraps the Next config with `withSerwistInit`. Disables Serwist in dev so hot-reload feels normal; production builds emit `public/sw.js` (gitignored).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/pwa/register-sw.tsx` — client component mounted in the root layout. Registers the SW once per page load (no-op in dev).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/offline/page.tsx` — force-static fallback page.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/.gitignore` — ignores `public/sw.js`, `public/swe-worker-*.js`, `public/workbox-*.js` (all build artifacts).

### Test it

```powershell
pnpm build
pnpm start
```

1. Chrome DevTools → **Application** → **Service Workers** — verify it registered, status "activated and is running".
2. **Application** → **Cache Storage** — should see `voltwise-prices-today`, `voltwise-pages`, `voltwise-fonts`, etc.
3. DevTools **Network** tab → throttle to **Offline** → reload `/dashboard`. Cached prices render instantly. Navigate to a page never visited → lands on `/offline`.
4. Re-enable network → the auto-reload-on-online plugin refreshes the tab.

### Updating the SW

On each deploy Serwist generates a new `/sw.js` with a hashed precache manifest. Browsers detect the change, install the new worker in the background, and `skipWaiting` + `clientsClaim` activate it on the next navigation. No user action needed.

## Internationalization

Voltwise ships in **Portuguese (pt-PT)** and **Spanish (es-ES)** — the two languages of the Iberian market it serves. Translations live in `messages/pt.json` and `messages/es.json` and are loaded server-side per request via [next-intl](https://next-intl-docs.vercel.app).

### Locale resolution priority

1. **`NEXT_LOCALE` cookie** — set by the in-app language switcher in the user menu.
2. **`profiles.country`** — `PT` → `pt`, `ES` → `es`. A returning user who picked Spain at onboarding sees Spanish without doing anything.
3. **`Accept-Language` header** — first matching locale we support.
4. **`'pt'`** as the hardcoded fallback (Portuguese is the project's primary language).

Logic in `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/i18n/locale.ts`. The active locale becomes `<html lang="...">` automatically.

### Files

- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/i18n/config.ts` — single source of truth for the supported `locales`, default, names, flags.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/i18n/request.ts` — `getRequestConfig` that resolves locale and lazy-loads matching messages.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/messages/pt.json` and `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/messages/es.json` — translation bundles, namespaced by surface (`landing`, `dashboard`, `nav`, `offline`, `install`, `userMenu`, `common`).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/i18n/locale.ts` — server resolver (cookie + profile + header).
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/lib/i18n/actions.ts` — `setLocale` server action: writes the cookie, calls `revalidatePath('/', 'layout')` so the new locale takes effect on the next paint.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/components/layout/language-switcher.tsx` — dropdown menu items rendered inside the `UserMenu`. Uses `useTransition` so the UI stays responsive while the layout re-renders.
- `@/Users/paulo.granja/OneDrive/PROJECTS/pg_smartenergy/src/app/layout.tsx` — wraps the tree in `NextIntlClientProvider` and binds `<html lang>` to the resolved locale.

### Adding a new key

1. Add the key to `pt.json` AND `es.json` (the build fails fast if either is missing).
2. In server components: `const t = await getTranslations('namespace'); t('key')`.
3. In client components: `const t = useTranslations('namespace'); t('key')`.
4. ICU-style interpolation: `t('key', { country: 'PT' })` → `"... · {country}"`.

### What's translated today

- Landing page (hero, features, closer)
- Dashboard view (kicker, volatility, chart, footnote, empty state)
- Site nav (links, sign-in CTA)
- User menu (labels, sign-out, dashboard/auditor/alerts entries)
- Language switcher (own labels)
- Offline fallback page
- Install prompt (Android + iOS variants)

### Not yet translated (English copy still ships)

- Auditor flow (`/auditor` upload form, results card)
- Smart Guard (`/alerts` create form, alert list copy, push toggle)
- Sign-in / onboarding forms
- Server-side notification bodies (push payloads, WhatsApp templates)

These surfaces still render correctly under the new locale provider — they just keep their English source until copy is migrated. Picking up `getTranslations` in each file is a mechanical change.

## Daily ingest in production

`src/lib/inngest/functions.ts` schedules `ingestOmieDaily` at **14:30 Europe/Madrid**, after the OMIE day-ahead auction publishes (~13:00 CET). It:

1. Fetches `marginalpdbc_YYYYMMDD.1` from `omie.es`.
2. Archives the raw text to Supabase Storage (`raw/omie/...`).
3. Parses → upserts into `market_prices` (idempotent on `(zone, ts)`).
4. Retries up to 3× with exponential backoff (Inngest defaults).

To deploy:

1. Create an Inngest app at [inngest.com](https://inngest.com), grab `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY`, set them in Vercel.
2. Deploy to Vercel — Inngest auto-discovers `/api/inngest`.
3. The cron runs immediately in Inngest's UI; trigger a manual run for today first.

---

## Architecture at a glance

```
   PWA (Next.js / RSC)
         │
         ▼
   Vercel Edge ── middleware: auth, rate-limit, geo (PT/ES)
         │
   ┌─────┼──────────────────────────────────┐
   ▼     ▼                                  ▼
 Supabase   Upstash Redis              Inngest (cron + queue)
 Postgres   cache + pub/sub                   │
 Auth/RLS                                     ▼
 Storage                            ┌─────────────────────┐
 Realtime                           │ OMIE · ESIOS · REN  │
                                    │ Datadis · Meteo     │
                                    └─────────────────────┘
                                              │
                                              ▼
                                    Modal (Python LGBM forecast)

 Anthropic Claude — invoice vision → audits
 Meta WhatsApp + Web Push + Resend — Smart Guard
```

---

## File map

```
src/
├─ app/
│  ├─ page.tsx                  Landing (hero + live ticker + how-it-works)
│  ├─ dashboard/page.tsx        The Oracle (RSC, server-side data fetch)
│  ├─ signin/page.tsx           Magic-link form
│  ├─ onboarding/               PT/ES picker (page + form + server action)
│  ├─ globals.css               Brand tokens (HSL design tokens)
│  ├─ auth/
│  │  ├─ callback/route.ts      OTP code → session + onboarding routing
│  │  └─ signout/route.ts       POST sign-out
│  └─ api/
│     ├─ inngest/route.ts       Cron + event endpoint
│     ├─ prices/today/route.ts  Public JSON API for prices
│     └─ ingest/omie/route.ts   Auth'd manual trigger
├─ middleware.ts                Session refresh + route guard
├─ components/
│  ├─ ui/                       Card, Button, Badge, Input, DropdownMenu, Skeleton
│  ├─ layout/site-nav.tsx       Server component, auth-aware
│  ├─ auth/                     SignInForm, UserMenu
│  ├─ marketing/                LiveTicker, HowItWorks, HeroReveal
│  └─ dashboard/                Chart, Now, Next Best Action, Golden Hours
├─ lib/
│  ├─ db/
│  │  ├─ schema.ts              Drizzle tables (single source of truth)
│  │  ├─ client.ts              postgres-js connection (HMR-safe singleton)
│  │  └─ queries.ts             Typed query helpers
│  ├─ ingestion/
│  │  ├─ omie.ts                Fetcher + parser (DST-aware)
│  │  └─ omie.test.ts
│  ├─ pricing/
│  │  ├─ golden-hours.ts        Categorize hours, derive Next Best Action
│  │  └─ tariff-math.ts         Compare baseline vs alternative tariff
│  ├─ inngest/
│  │  ├─ client.ts              Typed event registry
│  │  └─ functions.ts           Daily cron + manual handler
│  ├─ supabase/
│  │  ├─ client.ts              Browser client
│  │  └─ server.ts              SSR + service-role clients
│  ├─ env.ts                    Zod-validated env
│  └─ utils.ts
├─ scripts/
│  └─ run-omie-ingest.ts        CLI ingest (Drizzle, no Inngest)
└─ supabase/
   └─ migrations/0001_init.sql  RLS, storage, triggers, seed tariffs
```

---

## Deploy to Vercel

The app is shaped for Vercel + Supabase + Inngest cloud. Estimated 15-min cold-start to live.

### 1. Push to GitHub (recommended)

```bash
git init
git add .
git commit -m "Initial commit"
gh repo create voltwise --private --source=. --push
# or: git remote add origin git@github.com:you/voltwise.git && git push -u origin main
```

### 2. Import to Vercel

- vercel.com → New Project → import the repo.
- Framework: Next.js (auto-detected). Region: **Frankfurt (fra1)** is hard-coded in `vercel.json` for closest hop to PT/ES.
- **Environment variables** — paste these (production scope):

  | Var | Source |
  |---|---|
  | `NEXT_PUBLIC_SUPABASE_URL` | Supabase → API |
  | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → API |
  | `SUPABASE_SERVICE_ROLE_KEY` | Supabase → API (keep server-only) |
  | `DATABASE_URL` | Supabase → Database → Connection string (pooler 6543) |
  | `INGEST_SECRET` | Generate: `openssl rand -hex 32` |
  | `INNGEST_EVENT_KEY` | Inngest dashboard → Keys |
  | `INNGEST_SIGNING_KEY` | Inngest dashboard → Keys |
  | `GEMINI_API_KEY` | aistudio.google.com/apikey |
  | `GEMINI_MODEL` | `gemini-2.5-flash` (default) or `gemini-2.5-pro` |
  | `NEXT_PUBLIC_VAPID_PUBLIC_KEY` | `npx web-push generate-vapid-keys` |
  | `VAPID_PRIVATE_KEY` | same command |
  | `VAPID_SUBJECT` | `mailto:you@your-domain` |
  | `WHATSAPP_PHONE_NUMBER_ID` | optional — Meta WhatsApp Business |
  | `WHATSAPP_ACCESS_TOKEN` | optional — same |
  | `NEXT_PUBLIC_APP_URL` | `https://YOUR-DOMAIN.vercel.app` |

- Deploy.

### 3. Wire Inngest production

1. Sign up at [inngest.com](https://inngest.com), create an app named `voltwise`.
2. Apps → New → URL: `https://YOUR-DOMAIN.vercel.app/api/inngest`. Inngest will introspect the endpoint and discover both functions (`ingest-omie-daily`, `ingest-omie-manual`).
3. The cron starts running on its next 14:30 Europe/Madrid window. Trigger a manual run from Inngest UI to backfill today.

### 4. Update Supabase auth redirect URLs

In Supabase → Auth → URL Configuration, add `https://YOUR-DOMAIN.vercel.app/auth/callback` to the redirect allowlist. Without this, magic-link emails will silently bounce on production.

### 5. Smoke test

```bash
curl -X POST https://YOUR-DOMAIN.vercel.app/api/ingest/omie \
  -H "Authorization: Bearer $INGEST_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"date":"2024-05-14"}'
# → { "ok": true, "date": "2024-05-14", "parsed": 48, "upserted": 48 }

open https://YOUR-DOMAIN.vercel.app/dashboard?zone=PT
```

If the live ticker on the landing page lights up with a price, you're shipping.

### Alternative: Vercel CLI deploy (no GitHub)

```powershell
npm i -g vercel
vercel link
vercel env pull .env.production    # syncs env from Vercel after first manual setup
vercel --prod
```

## Roadmap (after MVP)

1. **Datadis (ES)** — OAuth-style flow → fetch user hourly consumption → personalize Next Best Action.
2. **E-Redes (PT)** — CSV uploader from Balcão Digital exports.
3. **Forecast** — LightGBM service on Modal trained on `market_prices` × Open-Meteo wind/solar features.
4. **IoT** — Shelly + Tuya rules: "auto-run dishwasher on the next golden hour ≥ 3h long".
5. **PWA** — `@serwist/next` for installable mobile + offline price cache.
6. **Multi-bill audits** — upload 12 months at once, generate annual savings projection.

---

## Contributing / next steps

- Open issues for tariff seed data (real PT/ES catalog) — currently stub values.
- The DST fall-back hour (the duplicate 02:00 in late October) is naively handled — only the first occurrence is kept. Real fix tracked in `lib/ingestion/omie.ts`.
- All UI strings are currently English placeholder; pt-PT / es-ES localization is Phase 2.

License: TBD.
