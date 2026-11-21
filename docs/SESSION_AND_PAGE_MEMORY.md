# Staying signed in and staying on the same page

What people asked for: after a **refresh**, or after **closing the browser or the installed app and opening it again**, they must still be
signed in and on the page they were on, and only **Log out** signs them out.

## Staying signed in

* The sign-in is Supabase Auth's own session, kept in the browser's storage (`persistSession`) and renewed by the browser (`autoRefreshToken`).
  The project sets **no** session time limit: `auth.sessions.not_after` is empty and sessions idle for two weeks are still valid.
* **A busy server is not a sign-out.** When `/api/v1/me` cannot be loaded because the server did not answer or answered 5xx
  (`src/lib/auth/transientError.ts`), the session is **kept**: the screen stays on "Loading" while the load is tried again (1.5 s, 4 s, 9 s), and then
  shows "The CRM is not answering right now. You are still signed in" with a **Try again** button. Before this change the same failure showed the
  sign-in page, so it looked like being logged out. A refused token (401), a closed account (403) or a bad request are real answers and still end up
  at the sign-in page.
* **A stale token is renewed before signing out.** When the API answers 401, the app asks Supabase for a fresh token first (at most once a minute).
  The person is signed out only if the sign-in service itself says the session is over; if the sign-in service is busy the session is kept.
* The app asks the browser to treat its storage as persistent (`navigator.storage.persist()`) so that a low-disk device does not drop the sign-in.
* A Department Head who works in several departments chooses a department once **per sign-in** (the choice was kept for one browser tab only,
  so closing the browser asked again). Signing out asks again.
* **Log out** (the explicit button) signs out, and forgets the remembered pages and the last address below.

## Staying on the same page

* Dashboards whose pages are in the address (`/ai-studio/dashboard/<id>/projects`, Support, Telecaller, Business Associate, Sales Head, Recruiter,
  AI Design Studio) already stayed on the page after a refresh.
* Dashboards that kept the page only in memory returned to the Overview. They now use `useRememberedPage(name, fallback, validPages)`
  (`src/hooks/useRememberedPage.ts`): Team Member, Team Lead, Accounts, Super Admin, AI Studio workspace, Department Head (every kind), Technical
  Support and Meta Verifier.
* The Super Admin / department view in `App.tsx` remembers the **tab and sub-department per department**; **Back to all departments** clears it,
  so opening a department from the hub still starts at its dashboard.
* **The installed app always opens at `/`.** The last dashboard address is remembered (`amuwa.lastPath`) and the person is returned to it when it
  belongs to their own dashboard (their id is in it, so nobody lands on another person's page).
* What is stored is only a page name or an address, never data. It is per signed-in person (`amuwa.page.<userId>.<dashboard>`); a stored page that
  is not a page of the dashboard any more is ignored and the dashboard opens at its first page.
* To remember a new dashboard's page: replace `useState<Page>('overview')` with `useRememberedPage<Page>('my-dashboard', 'overview', PAGES)` and
  derive the type from the list (`const PAGES = [...] as const; type Page = (typeof PAGES)[number]`). A new department-panel tab is restored after a
  refresh only when it is added to `src/components/layout/restorableTabs.ts`; otherwise a refresh opens the dashboard, as before.

## Tests

`supabase/tests/session_persistence.test.ts` (storage, last address, restorable tabs, transient errors, the department choice) and
`supabase/tests/ui_session_persistence.test.mjs` (a real browser: refresh, reopen, another person, an old stored page, signing out).
