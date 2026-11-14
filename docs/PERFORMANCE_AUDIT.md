# Performance audit (November 2026)

This is what was measured, what was changed and what is still slow. Every number here was measured on a development machine (a scratch PostgreSQL 16
built from `supabase/migrations`, one connection; Node 22 for the start-up test). **None of it was measured on the live deployment**:
the live site, the live Supabase project and their network latency were not reachable. Treat the figures as ratios, not as what users will see.

Correction to the brief: the CRM is **not a Next.js app**. It is a Vite + React single-page app (`src/`), one Hono API served by a single Vercel
function (`api/crm.ts` → `server/app.ts`, also buildable for Cloudflare Workers) and Supabase (Postgres, Auth, Realtime) with Cloudflare R2 for files.

## 1. Main reasons it was slow

| # | Where | Why | Evidence |
| - | ----- | --- | -------- |
| 1 | Database row security on `customers` | Six overlapping rules; four of them called a helper function **for every row of the table**. A Department Head, Team Head or Team Member paid for every customer in the company, not only theirs. Every list, count, search and dashboard counter on customers goes through it. | Table 3 |
| 2 | `customer_pipeline_counts()` (the Leads / pipeline tab counters) | Called `private.can_access_customer(id)` once per customer row. | Table 3 |
| 3 | Staff app JavaScript | `App.tsx` imported the Super Admin dashboard, the whole HR area, reports, etc. statically, so **every** staff user downloaded and parsed ~800 KB (200 KB gzip) for screens most roles never open. | Table 1 |
| 4 | API cold start | `nodemailer` and `pdf-lib` were loaded at start-up although only needed to send an e-mail / draw a PDF. | Table 2 |

Things that were checked and found **already fine** (no change made): one database round trip authenticates and rate-limits each API request
(`api_session`); realtime channels are shared and cleaned up (`src/lib/realtimeShared.ts`); there is no notification polling; list endpoints are
paginated in the database; the hot tables (`customers`, `profiles`) already have the composite indexes their queries need; hashed assets are
cached for a year (`vercel.json`); the browser API client de-duplicates identical GETs.

## 2. What was changed

* **Database** (migration `20270102000100_customers_rls_set_based.sql`, safe to run twice, no data touched): the rewritten rules look the caller up once
  and test the row against a set computed once. **Nothing about who may see what changed**: `supabase/tests/customers_rls_equivalence_test.sql`
  proves, for every user the test suite creates (297 in the full run), that the new rules show exactly the same customers and the same pipeline counts as the
  old logic. It fails if a rule is widened or narrowed (checked with deliberately wrong rules, including a one-customer difference) and stays in the suite.
* **Frontend**: the Super Admin dashboard, the HR screens (recruitment, training, probation, paid leave, issues, meetings, letters, employee requests),
  business reports and staff management are loaded when opened (`React.lazy`), each with its own loading area so the page frame never blanks.
* **API**: `nodemailer` and `pdf-lib` (invoices, business-associate PDFs, HR letters) are loaded on first use instead of at every start.
* `scripts/perf-cold-start.mjs`, `scripts/perf/seed-customers.sql`, `scripts/perf/bench-customers.sh` reproduce the measurements below.

## 3. Measurements

**Table 1 - JavaScript a staff member downloads after signing in** (production build, gzip level 6):

| | before | after |
| --- | --- | --- |
| `App` chunk (the staff shell) | 801 KB | 210 KB |
| Everything needed after sign-in (entry + shell + vendors) | 1,240 KB raw / 329 KB gzip | 639 KB raw / 182 KB gzip |

The removed code is still downloaded when a screen that needs it is opened (all JS together is 4,220 → 4,253 KB, in 136 → 184 files).
Role dashboards (`TeamMemberDashboard`, ...) were already separate chunks and are unchanged.

**Table 2 - API start-up** (`node scripts/perf-cold-start.mjs 11`: the function bundled with lazy imports kept lazy, `import()` in a fresh process):

| | before | after |
| --- | --- | --- |
| median / best | 228 ms / 208 ms | 186 ms / 173 ms |

A real cold start on Vercel also pays for fetching the function files, so the saving there is expected to be larger; this was not measured.

**Table 3 - customer queries as the API runs them, with row security on, 101,222 customers (32,207 leads)** - milliseconds:

| user | query | before | after |
| --- | --- | ---: | ---: |
| Department Head | leads count (exact) | 27,343 | 39 |
| Department Head | leads page 1 of 25 | 29,005 | 37 |
| Department Head | search (`ilike`) | 95,263 | 459 |
| Department Head | `customer_pipeline_counts()` | 62,945 | 69 |
| Department Head | `customer_summary()` | 81,531 | 482 |
| Team Member | `customer_pipeline_counts()` | 20,098 | 50 |
| Telecaller | `customer_pipeline_counts()` | 21,429 | 24 |
| Team Head | leads count (exact) | 5,301 | 28 |
| Team Head | `customer_pipeline_counts()` | 31,171 | 56 |
| Super Admin | `customer_pipeline_counts()` | 4,187 | 85 |
| Super Admin | search (`ilike`) | 2,184 | 331 |
| Team Member | leads count / page 1 | 110 / 110 | 23 / 27 |

Caveats: the test data copies the 22 customers of the test organization, so it has few onboarding / delivery rows (the old per-row helpers did even
more work on real data). Times are one run, single user, warm cache; concurrency and the network to Supabase are not included.

## 4. What is still slow or unverified

1. **Search**: `ilike '%text%'` on customers cannot use the trigram index while row security is on (PostgreSQL does not allow a non-leakproof
   operator to run before the security rules), so a search is a scan of the rows the user may see: 0.2-0.5 s on 100,000 customers. A fix needs a
   search function that applies the access rule itself (a design change, not made here).
2. **Where the API runs.** Every request makes at least one round trip to Supabase. If the Vercel function region and the Supabase region are far apart
   (the default Vercel region is Washington, Iowa/US-East; check your Supabase project's region), each trip adds 100-250 ms and a page that makes several
   calls feels slow whatever the code does. **Check this first**: Vercel project → Settings → Functions → Function Region, and Supabase → Project settings →
   General → Region; set the function region (`regions` in `vercel.json`) to the one nearest the database. Not changed here because it depends on your setup.
3. **Global lead store**: every staff sign-in loads the latest 100 `crm_leads` and opens a realtime channel for them, although only some departments' screens
   use them (`src/context/LeadStoreContext.tsx`). Left alone: it would need each consumer checked.
4. Other policies with a per-row helper (`support_tickets` team-lead scope, `lead_conversations`, `chat_messages`) were read but not measured or changed.
5. `customer_summary()` still reads every visible customer five times (140-480 ms at 100,000 customers).
6. Not measured at all: TTFB, LCP, real API timings, realtime behaviour under load, R2 upload / download speed (the R2 code was read: previews and downloads
   use short-lived signed links and nothing is proxied through the API, so no change was made).
7. The remaining ~186 ms of API start-up is spread over Node's module loading, `zod` and `@supabase/supabase-js`; no single item is left to remove.

## 5. Rolling out

1. Run `supabase/migrations/20270102000100_customers_rls_set_based.sql` in the Supabase SQL editor **after reviewing it** (it changes three row-security rules
   and one function; the file explains each and how to roll back). It is the change that makes lists and counters fast for non-administrators.
2. Deploy the code (frontend lazy loading + API lazy loading). Neither depends on the migration, and the migration does not depend on the code.
