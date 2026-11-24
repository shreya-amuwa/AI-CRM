# Notification coverage: meetings, tasks and client chat

Migration: `supabase/migrations/20270202000200_notification_coverage.sql` (safe to run twice; nothing is deleted).
Tests: `supabase/tests/notification_coverage_test.sql` (database), `notification_category.test.ts`, `notification_open.test.ts` (screens).
Related: `docs/NOTIFICATION_RELIABILITY.md` (delivery, push, sound, health), `docs/CHAT.md`, `docs/CEO_MEETING_APPROVAL.md`.

## What already existed (reused, not rebuilt)

There is one notification system: rows in `public.notifications` (one per recipient, only the recipient can read them), written by `private.notify` /
`private.notify_once` (once-only by a dedupe key), delivered live by Supabase Realtime, shown in the **bell** (a side panel) and the **Notification
Center** page, with unread count, mark one / mark all read, history, a sound, and the push outbox for attendance reminders. A read notification stays in the list.
This work adds only what was missing.

## Notification Center

* Every notification shows its **category** (Meetings, Tasks, Chat, Tickets, Customers, Sales, HR, Attendance, Leave, Accounts, Onboarding, Reports, Issues,
  Announcements, System), worked out from its type (`src/lib/notifications/notificationCategory.ts`; a test checks that all ~200 types written by the migrations have one).
* The **exact time** is the tooltip (bell) and the machine-readable `<time>` of every row; the page shows date and time.
* **Opening** a notification goes to its record from the bell *and* from the Notification Center page (`openNotificationTarget`: client chat, @mention, meeting, task,
  report, attendance, issue...). Before, only the bell navigated.

## Meetings (all five events already notified; the text now says what the brief asks)

| Event | Who is told | What the message says |
| --- | --- | --- |
| Request | the CEO (and delegates) | subject, employee, department, purpose, requested date and time, the day it was asked |
| Approved | the requester | status, date and time, the CEO's message |
| Rejected | the requester | status, the reason |
| Rescheduled / another time proposed | the requester | previous and new date and time, the reason, the status |
| Cancelled | everyone on the meeting | status, who cancelled, the old time, the reason |

The person who acts is never notified of their own action.

## Tasks

Already notified: assigned, delegated, update requested / follow-up / answered, progress, blocked, completed, reassigned from the queue. Now:

* every task notification carries `taskId`, `taskTitle`, `priority` and `dueDate` in its data (one trigger on `notifications`, so all task functions benefit), and a new-task
  notice also says the **priority**;
* new, from a deferred trigger on `work_tasks` (so it holds for every path that changes a task): **priority changed**, **deadline changed**, **reopened**, **moved to another person**
  (the new person is told unless a function already told them; the previous person is told it moved).
* There is no screen today that edits an existing task's priority or deadline, and no manager-comment feature; the notices above fire whenever those fields change, from any path.
  A "manager comment" notification needs that feature first.

## Client chat

| Event | Who is told |
| --- | --- |
| First message of a conversation | the Relationship Manager and the Team Lead: "New conversation from ..." (same type as a client message, with `data.newConversation`) |
| Later client messages | the RM, the Team Lead and the colleague actively handling it (one bell per unread run) |
| A colleague replies | the RM and the Team Lead, once each per colleague per day |
| Relationship Manager / Team Lead changed | the new one: "assigned to you" (urgent); the previous one: "reassigned, now with X" |
| A message nobody answered | after 30 minutes the RM and whoever is handling it (the Team Lead when there is no RM); after 2 hours the Team Lead too (urgent) |
| A message shared with the team (existing) | the person chosen |

The reminder (`public.chat_unanswered_remind`, service role only) runs on the 5-minute scheduled run that already sends the attendance reminders
(`POST /internal/attendance/reminders`; the result is returned as `chatWaiting`). One bell per person per unanswered message and level; only 08:00-21:00 India time;
nothing for a message older than 3 days; none once an employee answered. Before the migration is run the call does nothing. It is a bell notification (and the bell's sound),
not a device push.

## Not covered by this change

The introduction also names Tickets, Customers, HR, Attendance, Leave, Sales, Accounts and Onboarding; their numbered sections were not part of the request and those modules are
unchanged (they already have notifications, listed in the bell with their category).
