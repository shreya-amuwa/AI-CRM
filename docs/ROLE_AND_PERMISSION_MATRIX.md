# Roles, designations and permissions

## Designations (Task 06)

The two top designations were renamed. **Only the names people see changed.** The internal role keys, the database enum values, the
JWT claims, the API parameters and every permission check are unchanged, so renaming a role grants nothing and takes nothing away.

| Internal key (unchanged) | Old designation | New designation |
| --- | --- | --- |
| `SUPER_ADMIN` | Super Admin (also called "the CEO" in the meeting-approval features) | **Managing Director** |
| `DEPARTMENT_HEAD` with `profiles.is_operations_head = true` | Operations Head | **CEO** |
| `DEPARTMENT_HEAD` | Department Head | Department Head |
| `TEAM_HEAD` | Team Lead | Team Lead |
| `TEAM_MEMBER` | Team Member | Team Member |

**Hierarchy:** Managing Director → CEO → Department Head → Team Lead → Team Member. Parallel departments, Sales / Support functions,
Technical Consultants, Meta Verifiers, HR roles and every reporting line stay as they were.

A CEO still sees only the departments and functions assigned to them (`operations_head_departments`, `private.scopes_of`): a Support CEO
does not see Sales.

### Where the names come from

**`shared/roleNames.ts`** is the single source:

- `ROLE_DISPLAY_NAMES`: the designation of each role. `src/lib/auth/roleMapping.ts` (`ROLE_LABELS`, `OPERATIONS_HEAD_LABEL`) reads it.
- `relabelRoles(text)`: converts **system text** written in the internal wording to the new designations, in one pass:
  - "Super Admin" → "Managing Director";
  - "Operations Head" → "CEO";
  - the internal "CEO", which means the Super Admin, → "Managing Director".
- `designationLabel(value)`: shows a stored designation value (e.g. "Operations Head" saved on an employee record) with the new
  name. Exact matches only; a designation someone typed is shown as written.

**Rule for developers:** text written by the **database** and the **server** keeps the internal wording ("Super Admin", "Operations
Head", and "CEO" for the Super Admin). It is converted exactly once, where it reaches a person:

| Where | How |
| --- | --- |
| API errors (server and database messages, validation messages) | `AppError.toBody()` in `server/http/errors.ts` |
| Errors from direct Supabase calls in the browser | `errorMessage()` in `src/lib/api/client.ts` |
| Notifications in the app (bell, Notification Center) | `toAppNotification()` in `src/context/NotificationContext.tsx`: the title always; the body unless someone wrote it (chat, announcements) |
| Database labels shown on screens | `relabelRoles(m.kindLabel)` for meeting kinds; `relabelRoles(x.roleLabel)` in meeting summaries; `designationLabel()` for designation lists and the HR directory |

**Never** run `relabelRoles` on:

- text that already uses the new names: it would read the new "CEO" as the old one;
- what a person wrote: chat, notes, notices, customer data.

Screens' own text (`src/`) is written with the new names directly. It was converted once with a TypeScript syntax-tree script that
changed only string literals, template text and JSX text, never identifiers, keys or comments.

**What was deliberately not renamed:**

- role keys and values: `SUPER_ADMIN`, `is_operations_head`, `OPERATIONS_HEAD`, `CEO_MEETING`, routes, component and function names;
- the stored designation value "Operations Head", which is data and is shown through `designationLabel`;
- comments and the database's own messages: about 720 SQL strings, converted at display instead of being rewritten in hundreds of
  functions;
- historical records.

**A real rename of the keys** would need a separate, backward-compatible migration: new enum values alongside the old ones, a
dual-read period, then a cut-over. It is not needed for this change.

## Who may do what (summary)

The database enforces every rule (`security definer` functions and RLS); the API checks again; the screens only follow.

| Capability | Managing Director (`SUPER_ADMIN`) | CEO (Operations Head) | Department Head | Team Lead | Team Member | HR staff |
| --- | --- | --- | --- | --- | --- | --- |
| Company-wide dashboards, reports, audit log | yes | — | — | — | — | HR views only |
| Departments and functions | all | assigned ones only | own (and any extra function given) | own team | self | all (HR modules) |
| Attendance register and locations of others | yes | no (lunch durations in scope only) | no | no | no | yes |
| Team attendance status (see `docs/ATTENDANCE_MANAGEMENT.md`) | all | departments in scope | own departments in scope | — | — | all |
| Approve attendance corrections | yes | in scope | in scope | — | — | yes |
| Approve the Managing Director's meeting requests | only the Managing Director | — | — | — | — | — |
| Meeting Decisions (meeting summary reports) | yes | own scope's summaries | own scope's summaries | own team | attended | — |
| Create Department Heads / CEOs | yes | no | no | no | no | request only |

Details live with each feature:

- `docs/OPERATIONS_HEAD.md` and `docs/FUNCTION_SCOPES.md` (CEO scopes);
- `docs/CEO_MEETING_APPROVAL.md` (the Managing Director's time);
- `docs/MEETING_SUMMARIES.md`;
- `docs/ATTENDANCE_PUNCH.md` and `docs/ATTENDANCE_MANAGEMENT.md`.

Those documents were written before the rename and may still say "Super Admin" or "Operations Head": read them as "Managing Director"
and "CEO".

## Dashboard Explorer (docs/DASHBOARD_EXPLORER.md)

| Who | Dashboard Explorer | Improvement requests |
| --- | --- | --- |
| Managing Director (`SUPER_ADMIN`, active) | Previews every position's dashboard with demonstration data in an isolated frame (no employee account, session or record) | Sends and follows them |
| CEO (`DEPARTMENT_HEAD` + `is_operations_head`) | No | No |
| Department Head, Team Lead, Team Member | No | No |

The database functions check the caller (`private.dashboard_explorer_actor`); the CEO flag grants nothing here.
