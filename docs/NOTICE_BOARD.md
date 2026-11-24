# Notice Board

Migration `supabase/migrations/20270131000200_company_notice_board.sql`. Run it after `20270131000100`. It is additive and safe to run twice.

**Notice Board** is in the side panel of every dashboard: the shared dashboard shell, the Team Member layout and the department sidebar. A badge shows the number of unread notices.

## Who does what

Migration `20270202000100_notice_board_restricted_popup.sql` (after `20270131000200`; additive, safe to run twice) narrows who manages the board and adds the popup and the acknowledgement.

| | Read notices addressed to them, acknowledge | Send, edit, archive notices, see the receipts | Audience |
| --- | --- | --- | --- |
| Super Admin | yes | yes, and manages every notice and who the CRM team is | anyone |
| HR (HR department, not recruiters) | yes | yes | anyone |
| CRM team: Ashish, Shreya, Siddhesh | yes | yes | anyone |
| Everybody else (Department Heads, Operations Heads, Team Leads, Team Members, Business Associates, Technical Consultants, Accounts, ...) | yes | **no** | – |

- **The CRM team is a list of named accounts**: `notice_board_managers`, one row per profile id. It is filled when the migration runs from the Developers team members whose name (Shreya Mande, Ashish Sinha, Siddhesh Shinde, spelled as the team was seeded) or sign-in email (`siddhesh.amuwa@gmail.com`) match, so a same-named stranger who is not in the team gets nothing. A later approval of one of them is picked up by a trigger. The Super Admin adds or removes a person in **Notice Board > Managers** (audited). Membership of the Developers team, a role, or an "Admin" label grants nothing by itself.
- If one of the three has no active account when the migration is run, it says so in a `NOTICE`; the Super Admin adds them in Managers once the account exists.
- The database enforces every rule (`private.notice_publisher_role`). Hiding Send Notice in the screen is only a convenience. Anyone else is refused with `42501` (the API turns it into **HTTP 403**), whether through the screen, the API or a direct database call. Nobody writes the tables directly.
- Notices already published by an Operations Head or a developer stay as they were (history, receipts); those people can no longer edit or archive them.

## View Notices

- **The cards.** Each card shows:
  - title, start of the description, publisher (name and right), date and time, category, priority (Normal / Important / Urgent), attachments;
  - New when unread; Expired; Archived.
- **Opening a notice.** The whole card opens it. The full text and the files appear, and the notice is recorded as read (`company_notice_recipients.read_at`): the read receipt.
- **Filters.** Category, priority, date range, unread only, and search. All filtering happens in the database.
- **Publishers.** They also choose **All company notices**. A notice for selected employees is never shown to other publishers; only its publisher, its recipients and the Super Admin can read it.

## Send Notice (publishers)

- **Fields:**
  - title, description, category, priority (Normal, Important, Urgent);
  - target audience: entire company (the default: all employees), specific departments, specific designations or roles (optionally within departments), or selected employees;
  - attachments (the existing private upload; at most 5 files of 5 MB);
  - publish date (empty: now), expiry date (optional).
- **On publishing:**
  - The audience becomes the list of recipients (active employees, without the publisher).
  - Each recipient gets a bell notification, "New Company Notice: *title*", and a push to each device: "A new notice has been published by *publisher*. Please check your Notice Board."
  - Nobody outside the audience is notified, and nobody outside it can read the notice.
- **Scheduled notices.** A notice with a later publish date waits. The Worker's 5-minute run releases it (`notice_release_due`), once.
- **Duplicates.** The same form sent twice returns the first notice (`clientRequestId`).

## The company popup and the acknowledgement

- **Persistent, not realtime-only.** `notice_pending()` lists the notices this employee must still acknowledge: published, not expired, not archived. It is a read of the database, so an employee who was **offline** when the notice was published finds it the next time they open the CRM. Opening the CRM (sign-in or reload), the tab coming back, the network returning, and a new company-notice notification reaching the bell (Realtime) all read it again.
- **The popup** (`NoticePopupHost`, mounted once for every signed-in employee), a plain, normal-sized modal (about 32 rem wide, never more than 85% of the screen height; the text scrolls inside it; centred on tablets and phones too): a header with "Company notice", "Notice 2 of 5" and a close button in the top-right corner; the title (a normal heading size, not oversized); a quiet priority marker (a coloured dot and the word Normal / Important / Urgent), the category, the publisher and the date and time; the whole text; the files, each with **View** and **Download** (a short-lived link of its own kind); and a footer with Previous / Next, the number unread and **Acknowledge**. No animation, no gradient, nothing decorative. Several notices are one queue, never overlapping windows.
- **Order.** Urgent first, then Important, then Normal; the oldest first inside a priority.
- **Urgent** has no close button, no Escape and no "Remind me later": it stays until it is acknowledged (the footer says so). **Normal and Important** can be put off with the close button, "Remind me later" or Escape: they do not interrupt again in that session and return the next time the CRM opens.
- **Acknowledge** (`notice_acknowledge`, the employee's own row only, once) records the read and the acknowledgement time (and the version acknowledged) on the same `company_notice_recipients` row as the read receipt: there is no second record. It also marks the bell notification read. It can be done from the popup or from the notice in the Notice Board. An acknowledged notice never comes back (until a manager asks for a new acknowledgement).
- **Notice published while the CRM is open.** The bell receives it in real time and the popup opens by itself; if one is already being read, the new notice joins the queue and the reader stays on theirs.
- **The bell.** One notification per employee and notice, "New Company Notice: *title*", with the priority, the publisher and the time; clicking it opens the notice. The publish and its notifications happen in one database transaction; a retry of the same form returns the first notice and a repeated release notifies nobody again (`dedupeKey`).
- **Expiry and archive.** An expired notice stops opening as a popup and leaves the default list but stays in the history (list with expired notices) with every acknowledgement; an archived one leaves the popup queue too. Nothing is deleted.
- **Existing notices.** When the migration adds the acknowledgement columns, a notice an employee had already opened counts as acknowledged (at its read time): nobody is shown an old notice they read. This happens once.

## Managing notices (publishers)

- **My published notices.** The Super Admin sees every notice here. Each one shows how many recipients read it; opening it shows (to any manager, for every company-wide notice):
  - targeted, read, not read, acknowledged and not acknowledged counts with the percentages, and each person with their read and acknowledgement time;
  - the push delivery status (accepted, pending, failed).
- **Edit.** The publisher edits their own notices; the Super Admin edits any.
  - Title, text, category, priority and expiry can change. The audience stays fixed, so the read receipts keep their meaning.
  - **Acknowledge again.** A tick box, off by default: "Employees must acknowledge this change again". Ticked, every acknowledgement of that notice is cleared, everyone is notified once more (one bell per version: "Updated Company Notice") and the notice comes up in their popup. A minor edit (a typo, an expiry) leaves every acknowledgement as it was.
  - An edit made from an out-of-date copy is refused.
  - Every version is kept in `company_notice_revisions`, which nobody can change.
- **Archive.** An archived notice leaves the Notice Board, and pushes still waiting are cancelled. Nothing is deleted.
- **Audit.** Publishing, editing, archiving, deleting and opening a notice's files are written to the audit log.

## Deleting a notice (migration `20270205000100_notice_board_delete.sql`)

- **Who.** Exactly who may already archive: the publisher of the notice (while they still manage notices) and the Super Admin. HR and the CRM team delete their own notices only, like editing. Everybody else gets "not found" (HTTP 404; the API never confirms the notice exists) and a person who no longer manages notices gets 403. No permission was added; the button is hidden for people who cannot use it, and the database refuses them whatever the screen shows.
- **Where.** *Send Notice > My published notices*: a **Delete** button on each notice the person may delete; and **Delete** next to Edit / Archive inside an opened notice. It asks **Delete Notice?** with "Are you sure you want to delete this notice? This action cannot be undone." and **Cancel** / **Delete**. Cancel sends nothing. While the request runs both buttons are off, so a double click sends one request. Success shows "Notice deleted." and the notice leaves the list at once; a failure is shown in the dialog and the notice stays.
- **A safe (soft) delete: nothing is physically removed.** The notice gets `status = DELETED` with who and when (`deleted_by`, `deleted_at`). Its recipients (read and acknowledgement receipts), every revision (a `DELETED` revision records what it was), the audit entry (`COMPANY_NOTICE_DELETED`, with the counts) and the bell notifications stay in the database: the bell notifications are marked read so nobody is left pointing at a notice that is gone, and pushes still waiting are cancelled. The notice's files are untouched. No cascade touches any other record.
- **Where it disappears.** `DELETED` is a fourth status, so every list that reads "published" already leaves it out: View Notices, the unread badge, the popup queue and the acknowledgement counts. The few places that did not look at the status were changed: `notice_visible` (opening it and its files say "not found"), the "my published notices" list, `notice_receipts` and `notice_acknowledge`. A notice deleted while an employee has it open in the popup just leaves their queue (Acknowledge answers 404 and the popup moves on). A scheduled notice that is deleted before it goes out is never released.
- **Final.** A deleted notice cannot come back: a trigger refuses any later change, so edit, archive and a release of a scheduled notice cannot revive it. There is no undo in the screen; the record stays in the database, so a deletion made by mistake can be restored by a database administrator by hand (the guard trigger `company_notices_deleted_final` has to be switched off for that update).
- **Repeat.** Deleting again answers `alreadyDeleted: true` (a double click or a retry is not an error).

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
| `DELETE /notices/:id` | delete (soft; the publisher or the Super Admin; 404 for everybody else, 403 when the person no longer manages notices) |
| `GET /notices/pending` | the popup queue (what this employee has not acknowledged) |
| `POST /notices/:id/acknowledge` | acknowledge (own row; 404 when not a recipient) |
| `GET /notices/managers`, `POST /notices/managers/:profileId` | the CRM team list and adding / removing a person (Super Admin only; 403 for everybody else) |

## Tests

- `supabase/tests/notice_board_test.sql` and `supabase/tests/notice_board_restricted_test.sql` (who manages: Ashish, Shreya, Siddhesh, HR, Super Admin; ten kinds of employee refused with 42501; publishing, one bell per employee, retries, the popup queue and its order, acknowledgement, receipts, edits with and without re-acknowledgement, expiry and archive, anonymous callers)
- `supabase/tests/notice_board_delete_test.sql` (who may and may not delete, what disappears for whom, what is kept, the scheduled notice, the rest of the board still working) and the "notice delete API" checks of `api_integration.test.ts`
- `supabase/tests/notice_queue.test.ts` (the queue rules), `supabase/tests/ui_notice_popup.test.mjs` (the popup in a browser: size, position of the close button, files, phone and tablet, a long text, a notice deleted while open)
- the "notice board API" checks of `supabase/tests/api_integration.test.ts`
- `supabase/tests/notice_board.test.ts` (the shared schemas)
- `supabase/tests/ui_notice_board.test.mjs` (the browser, including the delete confirmation, Cancel, a failed delete, a double click, and an employee who has no Delete)
