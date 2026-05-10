# Voltwise — Deploy runbook

End-to-end checklist to take this repo from `npm install` to a live production URL on Vercel with a working Auditor, Smart Guard, PWA, Offline shell, and bilingual UI.

Estimated time: **45–60 minutes** if you have nothing set up yet.

---

## 0. Pre-flight (already done locally)

These were verified during this session:

| Step | Status |
|---|---|
| `npm install` (757 packages) | ✅ |
| `npm run typecheck` | ✅ |
| `npm run build` (19 routes, Serwist SW compiled in 77 s) | ✅ |
| `npm test` (35/35: evaluator + OMIE + profile) | ✅ |

If you change machines, redo these three in order.

---

## 1. Supabase project

Voltwise needs Postgres, Auth (magic-link), and Storage.

1. **Create the project** at <https://supabase.com/dashboard/new>. Pick the closest region to `fra1` (i.e. `eu-central-1` Frankfurt). Free tier is fine for MVP.

2. **Run the migration**. Open the SQL editor → New query → paste the contents of:
   - `supabase/migrations/0001_init.sql`
   This creates **10 tables**, RLS policies, storage buckets (`invoices`, `avatars`), the auth trigger that auto-creates a `profiles` row on signup, and seeds the catalog tariffs.

3. **Configure Auth redirects**. Authentication → URL Configuration:
   - Site URL: `http://localhost:3000` (swap to prod URL after Vercel deploy)
   - Redirect URLs: add both `http://localhost:3000/auth/callback` and `https://YOUR-PROD-DOMAIN/auth/callback`

4. **Grab the keys**. Settings → API:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY` *(server-only — bypasses RLS)*

5. **Grab the Postgres URL**. Settings → Database → Connection string → URI → **use the `pooler` mode** (`6543`, not `5432`) for serverless:
   ```
   postgres://postgres.PROJECT:PASSWORD@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
   ```
   → `DATABASE_URL`

---

## 2. Required external services

### 2.1 Google Gemini (Auditor)
- Get key: <https://aistudio.google.com/apikey>
- Free tier covers MVP volume.
- → `GEMINI_API_KEY`. Leave `GEMINI_MODEL=gemini-2.5-flash` unless you need Pro.

### 2.2 Inngest (cron + queue)
- Sign up: <https://app.inngest.com>
- Create a new app named `voltwise`.
- Settings → Event keys → copy → `INNGEST_EVENT_KEY`.
- Settings → Signing key → copy → `INNGEST_SIGNING_KEY`.

### 2.3 VAPID keys (Web Push)
Run once on your machine, then keep these forever:
```powershell
npx web-push generate-vapid-keys --json
```
- `publicKey` → `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `privateKey` → `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT=mailto:you@yourdomain.com`

### 2.4 Ingest secret
```powershell
# Generate a long random hex string for the manual OMIE endpoint.
[Convert]::ToHexString([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLower()
```
→ `INGEST_SECRET`

### 2.5 WhatsApp (optional)
Skip for MVP — Smart Guard will use the stdout stub for WhatsApp messages until you set:
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_ACCESS_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
You can wire Meta Cloud API later without redeploying client code.

---

## 3. Final local smoke test

Copy the example, fill in the values from steps 1–2, and confirm the dev server boots:

```powershell
Copy-Item .env.local.example .env.local
# edit .env.local with the values above
npm run db:push       # syncs Drizzle schema (idempotent against 0001_init.sql)
npm run dev
```

Walk through this once before pushing to Vercel:

- [ ] `http://localhost:3000` — landing page renders in Portuguese
- [ ] User menu (top right when signed out) → language switcher flips PT ↔ ES
- [ ] `/signin` → enter email → check inbox → magic link → `/onboarding`
- [ ] Pick PT or ES → lands on `/dashboard` with OMIE prices for today
- [ ] `/auditor` → upload any PT/ES electricity PDF → polling page → audit result
- [ ] `/alerts` → create a "cheap hour ≤ 0.05 €/kWh" alert → flip push toggle ON → accept browser permission → wait for the test push

If `npm run build && npm start` works locally and the SW caches `/`, the PWA install prompt appears on Android Chrome and **Share → Add to Home Screen** works on iOS Safari.

---

## 4. Push to GitHub

**Already done.** Repo is live at <https://github.com/PCGstudent/pg_smartenergy> (private).

Initial commit `26cf93b` — 106 files, 23 590 insertions. To push future changes:

```powershell
git add .
git commit -m "your message"
git push
```

`.gitignore` excludes `.env.local`, `node_modules`, `.next`, Serwist artifacts (`public/sw.js*`, `public/workbox-*.js`), `drizzle/`, and `.vercel`.

---

## 5. Vercel deploy

1. **Import** the repo at <https://vercel.com/new>. Framework auto-detects as Next.js. Build command stays `npm run build`.

2. **Set environment variables** in Settings → Environment Variables. Scope all to `Production`, `Preview`, `Development`:

   **Public (browser-safe):**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_APP_URL` → `https://YOUR-DOMAIN.vercel.app` (or custom domain)
   - `NEXT_PUBLIC_VAPID_PUBLIC_KEY`

   **Server-only:**
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL`
   - `GEMINI_API_KEY`
   - `GEMINI_MODEL` *(optional, defaults to `gemini-2.5-flash`)*
   - `INGEST_SECRET`
   - `INNGEST_EVENT_KEY`
   - `INNGEST_SIGNING_KEY`
   - `VAPID_PRIVATE_KEY`
   - `VAPID_SUBJECT`
   - `WHATSAPP_*` *(optional)*

3. **Deploy.** First build runs `npm install` + `next build` with `@serwist/next` + `next-intl` plugins. Expect 2–3 minutes.

4. **Update Supabase auth redirects.** Add `https://YOUR-PROD-DOMAIN/auth/callback` to the redirect URL allowlist (Authentication → URL Configuration).

5. **Update `NEXT_PUBLIC_APP_URL`** to match the real prod URL, then redeploy (or trigger a rebuild — env-var changes need a redeploy).

---

## 6. Wire Inngest to production

1. In the Inngest dashboard → Apps → Sync new app.
2. Endpoint: `https://YOUR-PROD-DOMAIN/api/inngest`
3. Sync. The 5 functions auto-discover:
   - `ingestOmieDaily` (cron 14:30 Europe/Madrid)
   - `ingestOmieManual` (event-driven)
   - `processInvoice` (event: `voltwise/invoice.uploaded`)
   - `evaluateAlerts` (cron `:15` of every hour Europe/Madrid)
   - `evaluateAlertsManual` (event-driven)
4. Trigger `ingestOmieManual` once from the Inngest UI to backfill **today's** prices so `/dashboard` isn't empty.

---

## 7. Production smoke test

From a phone (real one, not simulator) on the deployed URL:

- [ ] **Landing** renders, language switcher toggles PT ↔ ES, cookie persists
- [ ] **Magic-link sign-in** → email arrives → callback lands on `/onboarding` or `/dashboard`
- [ ] **Dashboard** shows today's OMIE prices for your country
- [ ] **Auditor** → upload a real PT/ES electricity invoice PDF → result page in ~10–20 s with savings comparisons
- [ ] **Smart Guard** → create alert → enable push → tap test → notification arrives on lock screen
- [ ] **PWA install** → Android Chrome shows install banner *or* iOS Safari → Share → Add to Home Screen → app opens fullscreen
- [ ] **Offline** → turn on airplane mode → navigate the app → `/offline` fallback or cached pages render

---

## 8. Optional polish

- **Custom domain** in Vercel → Settings → Domains. Update Supabase redirects + `NEXT_PUBLIC_APP_URL` to match.
- **Analytics**: Vercel Analytics is one toggle and free for hobby.
- **Error tracking**: Sentry (`@sentry/nextjs`) — wire later, not blocking launch.
- **iOS Web Push**: only works on installed PWAs running iOS 16.4+. Document this in onboarding.

---

## 9. Known limitations to document for users

These are intentional MVP trade-offs, all listed in `README.md`:

- **DST fall-back hour** (duplicate 02:00 in late October) is naively handled.
- **Tax model** is approximate (~95% accurate vs. final bill).
- **Quiet hours** suppress alerts entirely rather than queuing for after.
- **Cooldown** is per-alert (4 h), not per-(alert, target_ts).
- In **dev**, the SW is the legacy `public/sw.js` (push only, no offline shell). Production builds replace it with the Serwist-compiled version.
- **Auditor + Alerts UI** still ships English copy under the new locale provider — works under both locales, just not translated yet.
- **Spanish translations** were written by an AI — a native Iberian-Spanish reviewer should pass over `messages/es.json` before launch.

---

## 10. Troubleshooting

| Symptom | Fix |
|---|---|
| `Invalid environment configuration` at boot | Compare your env vars against `.env.local.example`. Zod schema is in `src/lib/env.ts`. |
| Magic link redirects to localhost in prod | Add prod URL to Supabase **Authentication → URL Configuration → Redirect URLs**. |
| Inngest functions don't appear | Re-sync the app from the Inngest dashboard. Endpoint must be `/api/inngest` exactly. |
| Auditor stuck on "Processing" forever | Check Inngest dashboard for `processInvoice` errors. Usually `GEMINI_API_KEY` missing or invalid. |
| Push notifications don't fire | Confirm `NEXT_PUBLIC_VAPID_PUBLIC_KEY` matches `VAPID_PRIVATE_KEY` (same pair from one `npx web-push generate-vapid-keys` call). |
| PWA install banner missing on Android | First visit doesn't qualify — Chrome requires engagement heuristics. Visit twice with 30 s gap. |
| `/offline` never shows | Serwist only registers on production builds. Run `npm run build && npm start`, not `npm run dev`. |
| iOS push doesn't work | Must be installed PWA on iOS 16.4+. Standard Safari tab cannot receive push. |
