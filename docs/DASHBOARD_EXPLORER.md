# Dashboard Explorer

The Managing Director (internally `SUPER_ADMIN`) opens **Management → Dashboard Explorer** and sees the CRM exactly as each position sees it:
the real dashboard, sidebar, pages, forms and responsive layout, filled with **demonstration data**. It exists so the Managing Director can
understand every workspace and send improvement requests to the CRM Development Team.

It is **not** "log in as". No employee account, session, token or record is used, created or changed. The Managing Director's own session stays
exactly as it was, and nothing a preview does can reach the live CRM.

Migration: `20270301000100_dashboard_explorer.sql` (audit and improvement requests only).

## What the Managing Director sees

* **Explorer home**:
  * search by position or module, and filters for department, business function and dashboard category;
  * **Recently viewed** previews;
  * **Improvement requests** with their Developer Team status;
  * a card per position with its description, main modules, a department choice and **Open Dashboard Preview**.
* **The preview**, full screen above the Managing Director's own dashboard, which stays underneath with its filters. The permanent toolbar shows
  **PREVIEW MODE — position**, the department and **Data: Demonstration only**. Its controls:
  * **Back to Managing Director**;
  * switch position, switch department, and scenario;
  * **Desktop / Tablet / Mobile**: the frame really is 820 or 390 pixels wide, so the CSS media queries apply;
  * **Full screen**;
  * **Reset demo data**;
  * **Suggest improvement**;
  * a list of what the demonstration data does not cover yet.
* **Leaving the preview:** Browser Back closes it. A refresh returns to the Explorer home.

## Architecture: an isolated preview runtime

```
Managing Director's page (CRM origin, normal session)          Sandboxed frame /dashboard-preview/ (opaque origin)
  Dashboard Explorer + toolbar  ── launch {dashboard, dept,  ─▶  preview bundle: the production App, pages and role mapping
                                   scenario, epoch} only         + demo Supabase client / demo API client / preview identity
  ◀── page, demo-action, unavailable, exit (schema-checked) ──   + demonstration data in memory (reset on every launch)
  /api/v1/dashboard-explorer/* (audit, improvement requests)     no network at all (CSP connect-src 'none')
```

* **A separate bundle** (`vite.preview.config.ts`, built by `npm run build` into `dist/dashboard-preview/`). It is the production `App`. The
  production role mapping (`toAuthUser`) and routing choose the dashboard, so a page or menu added to production appears in the preview too.
  At build time four modules are replaced:

  | Production module | Replaced by |
  | --- | --- |
  | `src/services/supabaseClient.ts` | `runtime/demoSupabase.ts`: table queries, simulated writes and RPCs against in-memory demonstration rows; Realtime never connects; Storage refuses |
  | `src/lib/api/client.ts` | `runtime/demoApi.ts`: answers from the demonstration data; has no `fetch` |
  | `src/context/AuthContext.tsx` | `runtime/PreviewAuthContext.tsx`: the synthetic identity, typed as the production `AuthContextType` |
  | `src/lib/push/registerServiceWorker.ts` | nothing |

  So the Supabase client library is **not in the preview bundle at all**; the unit test checks this.
* **Synthetic identity** (`runtime/previewIdentity.ts`): the position's role, department, team, sub-role, the CEO flag and, for a CEO with several
  departments, their scopes.
  * The ids are fixed demonstration ids and the e-mail uses the reserved `example.invalid` domain.
  * It never matches a real employee, even when someone holds that position.
  * The production API would never accept it: the frame has no network.
* **Defence in depth.** The Worker serves `/dashboard-preview/*` itself (`wrangler.jsonc` `run_worker_first`) with `PREVIEW_HEADERS`
  (`worker/securityHeaders.ts`), replacing the site-wide policy:

  | Header | Effect |
  | --- | --- |
  | `sandbox allow-scripts allow-forms` (no `allow-same-origin`) | The frame runs in an opaque origin: it cannot read the Managing Director's stored session, cookies or IndexedDB, and cannot register a service worker. This also applies when the address is opened directly. |
  | `connect-src 'none'` | No `fetch`, XHR, WebSocket or EventSource to the API, Supabase or anywhere else. `worker-src`, `frame-src` and `form-action` are `'none'`. |
  | `frame-ancestors 'self'` | Only the CRM itself may show the frame. |
  | Access-Control-Allow-Origin | Allows the opaque-origin page to load its own static files. |

  A missing preview path is a 404, never the CRM app.
* **Boot guards** (`runtime/guards.ts`): in-memory `localStorage`, no service worker, no push, no IndexedDB, and `fetch`, XHR, WebSocket,
  EventSource and `sendBeacon` fail at once. Each blocked attempt is reported to the toolbar instead of crashing a page.
* **Messages.** The Managing Director's page accepts only the frame's own window, from an opaque origin, in the known shapes (Zod,
  `shared/dashboardExplorer.ts`). The frame accepts launch messages only from its parent, from the CRM origin.

## The registry

`shared/dashboardExplorer.ts` lists every position. Each entry has its id, position, category, function, departments, description, modules, the
synthetic profile, the dashboard role production must give it (`expectedRole`), its datasets and its availability.

* **Who uses it:** the Explorer lists from it, the preview builds the identity from it, and the server and database accept only its ids.
* **What keeps it honest:**
  * `supabase/tests/dashboard_explorer.test.ts` checks that every entry opens `expectedRole` through the production `toAuthUser` in every
    department it lists;
  * the same test checks that the migration's allowlist is the registry.
* **Positions with no dashboard yet.** Visit Sales, Influencer and Business Partner show the production "dashboard not set up yet" page;
  nothing is invented.

## Demonstration data

The data lives in `src/dashboard-preview/fixtures/` (deterministic, synthetic, consistent between pages):
* **People:** names are invented and e-mails use `example.invalid`.
* **Companies:** marked "(Demo)".
* **Amounts:** demonstration figures, never Amuwa's results.
* **Dates:** relative to today.

Scenarios: normal day, new account, empty, pending approvals, overdue tasks, high-volume pipeline, Support escalations, employee on leave,
monthly target achieved, no assigned team.

**Simulated actions** change only the in-memory demonstration data and show *"Demo action completed. No live CRM data has been changed."*
In this first version:
* assign a lead, create a Sales task;
* add a customer (with the duplicate check), assign a task;
* decide a leave request;
* punch in / out, lunch;
* mark notifications read.

**Reset demo data**, another position or closing the preview throws the state away.

### Coverage in this first version (honest)

| Dashboards | State |
| --- | --- |
| Every listed position (34) | The real dashboard shell, sidebar and routing render. The shell-wide data is filled: bell, notices, chat badges, leave, attendance, reports context. |
| CEO – Sales, CEO – Support, Sales / Support Department Head, Sales / Support Team Lead, Support Team Member | Their overview pages have full demonstration data. |
| Sales Team Member, Telecaller, Business Associate | Home and counts are filled; the pipeline lists show their real empty state. |
| HR, Accounts, AI Studio, AI Design Studio, Meta Verifier, Technical Consultant, unified departments, general teams | The shell and shared data are filled. Department-specific pages show *"This page has no demonstration data yet. Nothing was read from the live CRM."* and appear in the toolbar's list. |
| Chat | Not part of the demonstration (end-to-end encrypted per person). |
| Crocodial | Shows its "not enabled" state. |
| File uploads | Refused with a clear message. |

Later pull requests add the remaining datasets. A page without data is always an explicit message, never live data.

## Improvement requests

**Suggest improvement** opens a short form: title, description, expected behaviour and priority. The position, department, page, module,
screen size and build are captured automatically.

* **Where it goes:** the Managing Director's page sends it through the API, never the frame. It becomes a **Developer Team issue** (`dev_bugs`,
  category Feature request, source `DASHBOARD_EXPLORER`) with:
  * the context in `dev_bugs.context`;
  * the dashboard, page and viewport also written into the issue's steps, so developers see them in the existing issue screen.
* **Notifications:** the Developer Team is notified, and the Managing Director gets the existing `DEV_BUG_STATUS` notification on every status
  change.
* **Tracking:** the Explorer lists the requests with their status (Submitted, Under review, Needs information, In progress, Completed,
  Not planned, Closed).
* **Duplicates:** one request id per form, so a double click or a retry files it once.
* **Not in this version:** screenshot attachments. The existing upload route is for employees; it can be added later.

## Authorization and audit

* `/api/v1/dashboard-explorer/*` goes route → controller → service (Zod, registry allowlist) → repository → database function.
* **The functions:** `dashboard_explorer_session_start`, `_session_end`, `_recent`, `_suggest` and `_requests` accept only an **active
  `SUPER_ADMIN`**.
  * A CEO (`is_operations_head`), a Department Head, a Team Lead, a Team Member or a signed-out caller gets `FORBIDDEN` (401 when signed out).
  * Internal role names are unchanged.
* **Audit** (`audit_logs`, the real Managing Director as actor):
  * `DASHBOARD_PREVIEW_STARTED` and `DASHBOARD_PREVIEW_ENDED`, with dashboard, department, scenario and duration;
  * `DASHBOARD_IMPROVEMENT_REQUESTED`.
  * No employee sign-in or presence event is ever written.
* **Recently viewed** is read from those audit rows, so there is no extra table.
* **The Explorer page itself:** loaded only when opened. The preview bundle is loaded only when a preview starts, and dashboards and fixtures
  load lazily inside it.

## Tests

* `supabase/tests/dashboard_explorer.test.ts` (unit):
  * the registry against the production role mapping;
  * payloads;
  * the allowlist against the migration;
  * the preview headers;
  * Worker routing;
  * the preview bundle has no Supabase client or key.
* `supabase/tests/ui_dashboard_explorer.test.mjs` (Chromium, the real preview bundle with the production headers):
  * the list and filters;
  * the toolbar;
  * isolation: opaque origin, no access to the parent's storage, `fetch` / WebSocket / XHR / beacon refused, the server sees no API or database
    request even after a simulated action;
  * mobile and tablet widths;
  * switching position, a simulated Add Customer, Reset;
  * Suggest Improvement (validation, double click, metadata);
  * exit and Browser Back;
  * a refused start;
  * direct visit;
  * every one of the 34 positions renders without a page error.
* `supabase/tests/dashboard_explorer_test.sql` (database):
  * Managing Director only (CEO, Department Head, Team Member, signed-out and suspended refused);
  * audit start / end, once;
  * no profile, role or CEO flag changes, and no sign-in event;
  * request filed with context, duplicate-safe;
  * the Development Team is notified;
  * the status change notifies the Managing Director.
* `api_integration.test.ts`: the same over HTTP, including 422 for ids outside the registry.

## Rollout

1. Run `supabase/migrations/20270301000100_dashboard_explorer.sql` in the Supabase SQL editor. It is safe to run twice.
2. Deploy. `npm run build` builds the preview bundle, and `wrangler.jsonc` sends `/dashboard-preview/*` to the Worker for its headers.

Before the migration runs, the Explorer list opens but starting a preview shows the server's error, and no frame opens.
