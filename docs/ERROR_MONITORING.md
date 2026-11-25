# Error monitoring (Sentry)

Errors from the website and the API are sent to Sentry (organization `amuwa-corporation`), so a crash or an outage is seen with its stack
trace and the release that caused it, without anyone having to read the Vercel logs.

| Part | Sentry project | Reports | Switched on by |
| --- | --- | --- | --- |
| Website (React, runs in the browser) | `ai-crm-frontend` | uncaught errors, unhandled promise rejections, a screen that crashed (the error boundary), 10% of page loads and API calls as performance data | `VITE_SENTRY_DSN` at **build** time |
| API (Hono on Vercel: `api/crm.ts`, `api/webhook.ts`) | `ai-crm-server` | every 500 / 503 the API answers (a defect, a busy database, a missing setting) and unexpected exceptions | `SENTRY_DSN` at **run** time |

With no DSN set nothing is sent: local development and tests are not affected. The Cloudflare Worker does load `server/sentry.ts` (through `api/webhook.ts`) but never starts the client, even when `SENTRY_DSN` is among its variables (`CRM_PLATFORM=cloudflare`): Sentry's start-up timer is refused by Workers (error 10021) and fails the deploy. `supabase/tests/worker_e2e.test.ts` starts the Worker in the real Workers runtime with a DSN set, so this cannot return unnoticed.

## What is NOT reported
* The caller's own mistakes: a wrong password (401), a missing field (422), a refused permission (403), a rate limit (429), a 404. They are the
  API working as designed and would bury the real errors (`server/monitoring.ts`, `shouldReportError`).
* Browser noise: ResizeObserver warnings, browser extensions, a tab that is offline ("Failed to fetch"), a new deployment while a tab is open
  (the page reloads by itself, `src/lib/chunkReload.ts`) (`shared/sentryScrub.ts`, `IGNORED_ERRORS`).

## Privacy: strict
The CRM holds employee punch locations, customer contacts and login links. A report carries the error, its stack trace, the route pattern
(`/customers/:id`, never the address with ids), the request id (the same id as in the Vercel log line) and the caller's **role**, and nothing
about a person:
* **Off in the SDK:** user information, cookies, request and response headers, request bodies, query strings. **No session replay** (screen
  recordings) and no user-feedback widget.
* **Masked before sending** (`shared/sentryScrub.ts`, unit-tested): e-mail addresses, Indian mobile numbers, login tokens (JWT, Bearer,
  `token_hash=`, `access_token=`) wherever they appear: in an error message, a URL, a breadcrumb. URLs lose their query string and fragment.
  Console output is not attached to a report.
* **Sentry project settings** (set once): "Prevent Storing of IP Addresses", data scrubbing and the default scrubbing rules are on for both projects.
* Trace headers go only to the CRM's own `/api/` calls, never to Supabase or other sites.

## Settings
| Variable | Where | Meaning |
| --- | --- | --- |
| `VITE_SENTRY_DSN` | Vercel → Environment Variables (needed at **build**) | DSN of `ai-crm-frontend`. Not a secret (it is in the browser bundle). |
| `SENTRY_DSN` | Vercel → Environment Variables | DSN of `ai-crm-server`. |
| `SENTRY_ENVIRONMENT` / `VITE_SENTRY_ENVIRONMENT` | optional | Defaults to Vercel's environment (`production`, `preview`) for the API and `production` for the website. |
| `SENTRY_TRACES_SAMPLE_RATE` | optional, API | **Off when empty.** Vercel starts the function without Sentry's loader, so automatic spans are limited and the extra start-up work is not worth it while the API is under load. Set e.g. `0.1` to try it. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | optional, website | Default `0.1` in production. |
| `SENTRY_AUTH_TOKEN` | Vercel → Environment Variables (**build only, secret**) | Lets the build upload its source maps so production stack traces show the real files and lines. Create it in Sentry → Settings → Developer Settings → Organization Tokens (permission: Releases / source maps). **Never commit it.** Without it the build still works; stack traces are just minified. |
| `SENTRY_ORG`, `SENTRY_PROJECT` | optional, build | Default `amuwa-corporation` / `ai-crm-frontend`. |

The release is the Git commit (`VERCEL_GIT_COMMIT_SHA`), so an issue shows which deployment introduced it. The source maps are uploaded to
Sentry and then **deleted from the build**: visitors never get them.

## How it works
* `src/instrument.ts` is imported first in `src/main.tsx`; `src/components/common/ErrorBoundary.tsx` reports a crashed screen.
* `server/monitoring.ts` is the hook the API calls where it already turns a failure into a 500 (`app.onError` in `server/app.ts`). It
  imports no SDK. `server/sentry.ts` (loaded first by `api/crm.ts` and `api/webhook.ts`) registers the Sentry reporter; a Vercel function can be
  frozen as soon as it has answered, so the request waits up to 2 seconds for the report, **only** when it produced one.
* Whole transactions (not streamed spans) are used, so the same masking applies to performance data.

## Using it
* Sentry → Issues: one row per kind of error, with how many times, how many releases, the stack trace and the tags `request_id`, `route`, `role`.
  The `request_id` finds the same request in the Vercel logs.
* Suggested alert: Alerts → Create → "A new issue is created" → notify the team by e-mail (Sentry does this by default for new issues).
* The free Sentry plan has a monthly event quota: a database outage that makes every request fail would use it quickly (Sentry groups the
  repeats into one issue but each event counts). Raise the plan, or rate-limit in Sentry (Project → Client Keys → Rate limit), if that happens.

Tests: `supabase/tests/sentry_scrub.test.ts` (masking, what is reported). The first reports of both projects were sent from the real handler
and the real built website and checked in Sentry (e-mail masked, no user, no cookies, page address without query or tokens).

## The "Something went wrong" flash after a deployment (2026-11-25)

**Symptom:** for 2 to 4 seconds a dark "Something went wrong" page appeared, then the CRM came back by itself.

**Cause:** a tab opened before a deployment asks for a screen of the previous build, whose files no longer exist.
1. `installChunkReload` cancelled Vite's `vite:preloadError` (`preventDefault`) and reloaded the page.
2. Because the error was cancelled, Vite gave `React.lazy` an empty module instead of the screen.
3. React then failed with "Cannot read properties of undefined (reading 'default')" (in Safari, "evaluating 'x.default'"). The error
   page did not recognise that message as a new version, so it showed its dark error page until the reload finished.

**Fix** (`src/lib/chunkReload.ts`, `src/components/common/ErrorBoundary.tsx`):
- The preload error is no longer cancelled. The screen receives the real "failed to fetch module" error.
- The empty-module messages also count as a new version.
- While the reload runs, the error page shows a quiet "Loading the latest version…" on a light background instead. The reload
  starts the moment the error is caught, still at most once per 30 seconds.
- A real crash still shows "Something went wrong" (now light, with **Reload page** and **Go to home page**). It no longer prints the
  raw error text on screen; the error goes to error reporting (Sentry) as before.

**Test:** `supabase/tests/ui_app_update.test.mjs` (browser). A missing module and an empty module each reload the page without ever
showing "Something went wrong", a failed preload is not cancelled, and a real crash shows the light error page without internal details.
