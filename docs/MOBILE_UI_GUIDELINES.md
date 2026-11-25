# Mobile UI guidelines

How CRM screens (staff dashboards, the Client Portal at `/client/`) must behave on phones and tablets, and how to check them. Written
for Task 04 (mobile-first audit) and Task 03 (the notice popup). Related: `ATTENDANCE_MANAGEMENT.md` (the punch dialogs) and
`NOTICE_BOARD.md` (the notice popup's behaviour).

## Widths every screen must handle

| Width | Typical device |
| --- | --- |
| 320 | Small Android, iPhone SE (1st gen) |
| 360 | Most Android phones |
| 375 | iPhone SE / mini |
| 390 | iPhone 12–15 |
| 414 | iPhone Plus / Max (older) |
| 430 | iPhone Pro Max |
| 768 | iPad portrait |
| 1024 | iPad landscape, small laptops |
| 1440 | Desktop |

## Rules

### Layout

* **No sideways scrolling at any width.** The page's `scrollWidth` never exceeds the window. Wide content (tables, code, long IDs)
  scrolls *inside its own box* (`overflow-x-auto`), never the page.
* **Grid and flex children shrink.** A child of a grid or flex row needs `min-w-0` (Tailwind) / `min-width: 0` (CSS). Without it, a date
  input, a long word or a `whitespace-nowrap` label pushes the row wider than the screen. Grid columns use `minmax(0, 1fr)`, not `1fr`.
* **Multi-column layouts collapse.** Two or more columns become one below 860 px (or below `md` / `lg` in Tailwind). Never write a fixed
  `gridTemplateColumns` inline style without a media query. Put it in a class.
* **Long text wraps.** E-mail addresses, references and URLs use `break-all` / `overflow-wrap: anywhere`. Truncate (`truncate`) only
  where the full value is available elsewhere (a tooltip, a detail view).
* **Dates and status labels** may use `whitespace-nowrap`, but their row must be allowed to wrap (`flex-wrap`).
* **Side gutters:** 16 px on phones (`px-4`), more from `sm` up.

### Dialogs, sheets and popups

* **Phones get a bottom sheet, tablets and desktops a centred dialog.** Use `src/components/common/BottomSheet.tsx` for new dialogs.
* **Compact by default.** An ordinary notice or confirmation takes at most about 55% of the screen height on a phone. Longer content
  scrolls inside the sheet. A "View full notice" style control opens it to nearly the full height (about 92%).
* **The primary button is always on screen** (above the home indicator: `pb-[env(safe-area-inset-bottom)]`).
* **One dialog at a time.** A popup that opens by itself (the company notice) waits while another modal dialog is open, and appears when that
  one closes.
* **Keyboard and focus:**
  * Focus moves into the dialog, to its main button.
  * Tab and Shift+Tab stay inside it.
  * Escape closes it only if it can be dismissed. An Urgent notice and a required acknowledgement cannot be.
  * Focus returns to whatever opened it.
  * The page behind does not scroll (`lockScroll`).
* **Labels:** every dialog has `role="dialog"` (or `alertdialog`), `aria-modal="true"`, and `aria-labelledby` pointing at its title.

### Touch

* Touch targets are at least 40 × 40 px on phones (`h-10` buttons, `h-9 w-9` icon buttons). They may shrink from `sm` up.
* Do not rely on hover for anything essential.

### Visual style (enterprise)

* Solid colours: no gradients, no glass (`backdrop-blur`), no decorative animation.
* Moderate rounding: `rounded-lg` / `rounded-xl` for cards and dialogs, `rounded-t-xl` for a bottom sheet. Avoid `rounded-3xl` and larger.
* Quiet status markers: a dot plus a word (as the notice priority), not large coloured banners.
* Sentence case for labels and headings, no all-caps for content that screen readers read (a category name, a title).

## How to check a screen

### Automated: the mobile audit

`scripts/mobile-audit/` re-uses the browser tests (`supabase/tests/ui_*.test.mjs`, real React screens with stand-in data). Each page a test
opens is measured at all 9 widths just before it closes, and the element that makes the page scroll sideways is reported. Where a test
shows a dashboard with a side menu, every menu item is also opened and measured.

```bash
npm run build                                          # the tests read the built stylesheet
node scripts/mobile-audit/run.mjs                      # every browser test (slow: about 25 minutes)
node scripts/mobile-audit/run.mjs ui_client_journey    # one or more by name
```

It prints each overflow source with the widths where it happens, and exits 1 if there is any. It never changes a test's result.

### By hand

Chrome DevTools → device toolbar. Check 320, 390 and 768 in portrait, with the longest realistic data (a long name, a long e-mail
address, 10+ table rows), and with the on-screen keyboard open for forms.

## Task 04 audit results (2026-11-24)

The audit ran over all 49 browser tests, the Client Portal's 11 screens (every side-menu item), and the staff dashboards' side menus.

| Screen | Width(s) | Cause | Fix |
| --- | --- | --- | --- |
| Client Portal → Client Manual (`src/client/Docs.tsx`) | 320–430 | Inline two-column grid `minmax(240px, 300px) 1fr` that never collapsed; 32 px padding; search box `min-width: 260px` | Classes `cd-manual-*` in `client.css`: one column below 860 px, 16 px padding and a full-width search on phones, tables scroll inside the article. The banner gradient became a solid colour. |
| HR → Employee issues / Meeting requests, date filters (`EmployeeIssuesManagement.tsx`, `MeetingRequestsManagement.tsx`) | 320 | A date input cannot shrink below its built-in width inside a flex label | `min-w-0` on the label and the input |
| Staff added confirmation (`StaffManagementPanel.tsx`) | 320–360 | Long login e-mail in a monospace span | `break-all` |
| Crocodial activity → Open follow-ups (`CrocodialActivity.tsx`) | 320 | Name and an unbreakable date on one row; card not allowed to shrink in its grid | `min-w-0` on the card, the row wraps |
| Company notice popup (`NoticePopupViewer.tsx`) | all phones | A centred modal up to the full screen height | Redesigned as a compact bottom sheet (Task 03) |

Every other measured screen had no sideways scrolling at any of the 9 widths.

### Not covered by the automated audit (to check by hand)

* **Candidate Portal:** no longer part of this repository. `/candidate` and `/careers` redirect to the CRM home (`src/main.tsx`), and the
  careers site is served separately. Audit it in its own repository.
* **Screens without a browser test:** most of the older department panels (the `Sidebar.tsx` side menu: WABA Store, WhatsBox, AIQR and
  others) and the finance screens. Check them by hand at 320 / 390 / 768 until a browser test exists.
* **Visual style debt:** about 112 gradients, 83 glass (`backdrop-blur`) effects and 198 `rounded-3xl` uses remain. They are mostly in
  `src/components/departments/*`. Changing them all in one pull request would conflict with every open branch, so they are cleaned up
  area by area, each in its own small pull request (see `RELEASE_PLAN.md`).
