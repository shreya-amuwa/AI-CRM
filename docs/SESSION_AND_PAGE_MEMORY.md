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
* **Attendance, Meeting Request (Meetings) and Bugs** are pages every dashboard shows over its own content area (the "overlay" in
  `src/components/layout/shell.tsx`). They were kept only in memory, so a refresh on Meeting Request returned to the Overview. They are now
  remembered with `useRememberedOverlay` (`src/hooks/useRememberedOverlay.ts`), per signed-in person and per dashboard (the first four parts of
  the address). Choosing one of the dashboard's own pages leaves the overlay. A page asked for by a notification or link (`/?tab=meetings`, a
  tapped reminder) wins over the remembered one. Signing out forgets it too.
* The Super Admin / department view in `App.tsx` remembers the **tab and sub-department per department**; **Back to all departments** clears it,
  so opening a department from the hub still starts at its dashboard.
* **The installed app always opens at `/`.** The last dashboard address is remembered (`amuwa.lastPath`) and the person is returned to it when it
  belongs to their own dashboard (their id is in it, so nobody lands on another person's page).
* What is stored is only a page name or an address, never data. It is per signed-in person (`amuwa.page.<userId>.<dashboard>`); a stored page that
  is not a page of the dashboard any more is ignored and the dashboard opens at its first page.
* To remember a new dashboard's page: replace `useState<Page>('overview')` with `useRememberedPage<Page>('my-dashboard', 'overview', PAGES)` and
  derive the type from the list (`const PAGES = [...] as const; type Page = (typeof PAGES)[number]`). A new department-panel tab is restored after a
  refresh only when it is added to `src/components/layout/restorableTabs.ts`; otherwise a refresh opens the dashboard, as before.

## The page behind a pop-up does not scroll

Turning the wheel over a drawer or dialog used to scroll the page behind it, except for the few pop-ups that asked for the lock. Now
`src/lib/overlayScrollLock.ts` (started once in `src/main.tsx`, so it also covers the customers' dashboard and the booking pages) watches the
page: while an element that covers at least 90% of the window is shown on top of it, the page is locked (`src/lib/scrollLock.ts`); when it
closes or is hidden, scrolling is given back. No pop-up has to ask for the lock, so new ones are covered too.

What counts as a pop-up: `position: fixed`, covering at least 90% of the window in width and height, visible, taking the pointer, and stacked
at z-index 10 or more. A toast layer that lets clicks through, a decorative background behind the page, a fixed header, the desktop sidebar,
and an invisible or transparent layer never lock the page. The pop-up's own content still scrolls. If a new full-screen pop-up should lock the
page, give it `fixed inset-0` with a z-index of 10 or more (the usual `z-50`).

## Tests

`supabase/tests/session_persistence.test.ts` (storage, last address, restorable tabs, transient errors, the department choice) and
`supabase/tests/ui_session_persistence.test.mjs` (a real browser: refresh, reopen, another person, an old stored page, signing out, and the
overlay pages Meeting Request / Attendance / Bugs) and `supabase/tests/ui_scroll.test.mjs` (a real browser: the page behind a drawer is locked and
unlocked, nested pop-ups, and the things that must not lock it).
