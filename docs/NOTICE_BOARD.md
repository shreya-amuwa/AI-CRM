# Notice Board

Migration `supabase/migrations/20270131000200_company_notice_board.sql`. Run it after `20270131000100`. It is additive and safe to run twice.

**Notice Board** is in the side panel of every dashboard: the shared dashboard shell, the Team Member layout and the department sidebar. A badge shows the number of unread notices.

## Who does what

| | Read notices addressed to them | Send notices | Audience allowed |
| --- | --- | --- | --- |
| Super Admin | yes | yes, and manages every notice | anyone |
| HR (HR department, not recruiters) | yes | yes | anyone |
| Developers team | yes | yes | anyone |
| Operations Head | yes | yes | only the departments they own: no "entire company"; departments, designations and employees of those departments |
| Department Head, Team Lead, Team Member | yes | **no** | – |

- The database enforces every rule (`private.notice_publisher_role`, `private.notice_check_scope`). Hiding Send Notice in the screen is only a convenience.
- Anyone else is refused (`FORBIDDEN`), whether through the screen, the API or a direct database call.
- Nobody writes the tables directly.

## View Notices

- **The cards.** Each card shows:
  - title, start of the description, publisher (name and right), date and time, category, priority (Normal / Important / Urgent), attachments;
  - New when unread; Expired; Archived.
- **Opening a notice.** The whole card opens it. The full text and the files appear, and the notice is recorded as read (`company_notice_recipients.read_at`): the read receipt.
- **Filters.** Category, priority, date range, unread only, and search. All filtering happens in the database.
- **Publishers.** They also choose **All company notices**. A notice for selected employees is never shown to other publishers; only its publisher, its recipients and the Super Admin can read it.

## Send Notice (publishers)

- **Fields:**
  - title, description, category, priority;
  - target audience: entire company, specific departments, specific designations or roles (optionally within departments), or selected employees;
  - attachments (the existing private upload; at most 5 files of 5 MB);
  - publish date (empty: now), expiry date (optional).
- **On publishing:**
  - The audience becomes the list of recipients (active employees, without the publisher).
  - Each recipient gets a bell notification, "New Company Notice: *title*", and a push to each device: "A new notice has been published by *publisher*. Please check your Notice Board."
  - Nobody outside the audience is notified, and nobody outside it can read the notice.
- **Scheduled notices.** A notice with a later publish date waits. The Worker's 5-minute run releases it (`notice_release_due`), once.
- **Duplicates.** The same form sent twice returns the first notice (`clientRequestId`).

## Managing notices (publishers)

- **My published notices.** The Super Admin sees every notice here. Each one shows how many recipients read it; opening it shows:
  - targeted, read and not read counts, and each person with their read time;
  - the push delivery status (accepted, pending, failed).
- **Edit.** The publisher edits their own notices; the Super Admin edits any.
  - Title, text, category, priority and expiry can change. The audience stays fixed, so the read receipts keep their meaning.
  - An edit made from an out-of-date copy is refused.
  - Every version is kept in `company_notice_revisions`, which nobody can change.
- **Archive.** An archived notice leaves the Notice Board, and pushes still waiting are cancelled. Nothing is deleted.
- **Audit.** Publishing, editing, archiving and opening a notice's files are written to the audit log.

## API

| Route | Who / what |
| --- | --- |
| `GET /notices?scope=INBOX\|ALL\|MINE&category&priority&from&to&unread&search` | the lists |
| `GET /notices/unread-count` | the badge |
| `GET /notices/audience` | what the caller may publish to |
| `POST /notices` | publish |
| `GET /notices/:id` | open it (marks it read) |
| `GET /notices/:id/receipts` | the read receipts and delivery status |
| `POST /notices/:id/update` | edit |
| `POST /notices/:id/archive` | archive |

## Tests

- `supabase/tests/notice_board_test.sql`
- the "notice board API" checks of `supabase/tests/api_integration.test.ts`
- `supabase/tests/notice_board.test.ts` (the shared schemas)
- `supabase/tests/ui_notice_board.test.mjs` (the browser)
