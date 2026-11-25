# Testing checklist

What is tested automatically, what must be tested by hand, and how. Use it before every release (`RELEASE_PLAN.md`) and after every
deployment (`DEPLOYMENT_AND_ROLLBACK.md`).

## 1. Automated (every pull request, and on `main`)

Run locally before pushing (`AGENTS.md` §6). The same checks run in CI (`.github/workflows/ci.yml`).

```bash
npm ci
npm run typecheck      # frontend, server and Worker
npm run build          # also needed before the browser tests (they read dist/assets)
npm run test:unit      # unit tests and the Playwright browser tests (supabase/tests/run-unit.sh)
npm run test:db        # SQL tests against a local PostgreSQL (supabase/tests/run.sh)
npm run test:api       # HTTP → PostgREST → PostgreSQL (supabase/tests/run-api.sh)
node scripts/mobile-audit/run.mjs   # optional: no sideways scrolling at 9 widths (MOBILE_UI_GUIDELINES.md)
```

Tests added or changed for 1.1.0:

| Feature | Database | API / unit | Browser |
| --- | --- | --- | --- |
| Role names | - | `role_names.test.ts` | Many `ui_*` tests updated to the new labels |
| Team attendance, punch dialogs, corrections, Punch Out without a reason | `team_attendance_test.sql` (59 checks) | - | `ui_team_attendance` (22), `ui_attendance` (49) |
| Meeting push for participants | `meeting_push_test.sql` | `meeting_push_open.test.ts`, `api_integration` "meeting push" | - |
| The Managing Director's meeting awareness | `meeting_oversight_test.sql` (29) | `meeting_oversight.test.ts` | `ui_reminders` |
| Notice popup | - | - | `ui_notice_popup` (61) |
| Mobile overflow fixes | - | - | `ui_client_journey`, `ui_bugs`, `ui_crocodial_activity`, `ui_unified_existing_departments` + the mobile audit |
| The "Something went wrong" flash | - | - | `ui_app_update` (8) |

Last full run, on the branches before merge:

- typecheck and build pass;
- `test:db` passes;
- `test:api`: 4,603 checks;
- `test:unit`: about 4,860 checks.

`ui_hr_awards` sometimes fails with a Playwright "strict mode violation" race. It passes on a rerun and is not related to these tasks.

## 2. Smoke test after a deployment (about 15 minutes, test accounts)

| # | Who | Steps | Expected |
| --- | --- | --- | --- |
| 1 | Team member | Attendance → Punch In → **Confirm Punch In** | "Punched in at …". One Punch In, even after a double click |
| 2 | Team member | Punch Out before the shift end → **Confirm Punch Out** | No reason asked, no warning. "Punched out at …" |
| 3 | Department Head | Attendance → **Team** | Only their department. The cards filter the list. The search works |
| 4 | CEO (Operations Head) | Attendance → **Team** | Only the departments in their scope |
| 5 | Team member | Attendance → Corrections → ask for a missed Punch Out | The request appears. The approver is notified |
| 6 | Department Head | Approve that correction | The day changes. The employee is notified. The audit log has the change |
| 7 | HR | Publish a Normal notice to one test employee | On the employee's phone: a bottom sheet, "View full notice", Acknowledge |
| 8 | Two colleagues | Book a team meeting without the Managing Director | Managing Director: "Team meeting scheduled" in the bell and on the phone, with no title on the lock screen |
| 9 | Anyone | Any screen | "Super Admin" reads **Managing Director** and "Operations Head" reads **CEO** |
| 10 | Client | Client Portal on a phone → Client Manual | One column, no sideways scrolling |

## 3. Real devices (owner, before tagging the release)

Use an Android phone with Chrome and an iPhone with the CRM added to the Home Screen (iOS 16.4 or later). Test each with the CRM open,
in the background, and closed.

- [ ] Attendance → Reminders → turn on notifications → **Send test notification**: it arrives.
- [ ] Meeting invitation: one notification with the title and time. Tapping it opens that meeting.
- [ ] The meeting is moved, then cancelled: one notification each. "Cancelled" is never replaced by an older reminder.
- [ ] A meeting you are in starts in about 20 minutes: "In 15 minutes: …", then "Starting now: …".
- [ ] As the Managing Director, not invited: "Team meeting scheduled". The lock screen has no title. A tap opens the report view.
- [ ] As the Managing Director: Meeting notifications → phone alerts off → a new meeting gives the bell only.
- [ ] A company notice on a phone: the sheet fits, the text scrolls inside it, Acknowledge is reachable with one thumb.
- [ ] Punch In / Punch Out dialogs on a phone: the bottom sheet, the buttons above the home indicator.
- [ ] After a deployment, with an old tab open: no dark "Something went wrong". At most "Loading the latest version…".

## 4. Mobile widths

At 320, 360, 375, 390, 414, 430, 768, 1024 and 1440 px, nothing scrolls sideways. The automated audit covers every screen with a
browser test. Check by hand the screens it cannot reach (`MOBILE_UI_GUIDELINES.md`, "Not covered").

## 5. Permissions (spot checks, also covered by `test:db`)

- [ ] A team member cannot open Team attendance (the API answers FORBIDDEN).
- [ ] A Department Head sees no other department's people.
- [ ] Nobody can approve their own correction.
- [ ] Only the Managing Director can read or change the Meeting notifications settings.
- [ ] A client sees only their own customer's data in the Client Portal.
