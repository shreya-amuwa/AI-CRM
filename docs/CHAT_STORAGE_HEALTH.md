# Chat storage, Realtime and plan health

Read-only report: `supabase/maintenance/chat_storage_report.sql` (sizes and counts only - never a message, a file name, a key or a name). The
general database report is `supabase/maintenance/usage_report.sql`; the earlier cost audit is `DATABASE_COST_AUDIT.md`.

**What could not be measured here:** this work had no access to the production database, the Supabase dashboard (plan, quotas, backups,
Realtime usage) or Cloudflare R2. Every number below that is not marked VERIFIED is an estimate; run the report in the Supabase SQL editor and
read the plan under *Organization > Billing* to replace them.

## Where chat data lives (VERIFIED from the schema)

| Data | Where | Notes |
| --- | --- | --- |
| Message text (new internal messages, all client messages) | `chat_messages.body` (max 4,000 characters) | readable by the server since `20261224000200` |
| Older end-to-end encrypted messages | `chat_messages.e2ee` (JSON envelope, max 256 KB, typically ~0.4-1 KB) | kept as they are, never converted or deleted |
| Conversations / members | `chat_conversations`, `chat_members` | one row per conversation / person |
| Read receipts | `chat_read_state` | ONE row per person per conversation (an upsert of the last read number, not a row per message) |
| Delete for me | `chat_message_hidden` | one row per hidden message per person |
| Delete for everyone | the message row stays as a tombstone (text, envelope and file list wiped) | a few hundred bytes |
| Files | Cloudflare R2 (Supabase Storage as fallback); only metadata in `chat_attachments` | 5 MB per file, private, signed links; the API removes the stored object of a deleted message |
| Keys | `chat_user_keys` (public keys), `chat_key_backups` (optional passphrase backups) | small; kept for the legacy encrypted history |

## Measured on the test database (VERIFIED, synthetic data)

184 messages = 200 kB with indexes (about 450 bytes per row stored, envelope rows ~400 bytes larger). Chat is 1.6 % of a 40 MB test database.

## Estimate for production (ESTIMATE - replace with block 6 of the report)

Assumption: 60 employees, 40 messages each per working day = 2,400 messages/day, ~600 bytes per message with indexes.

| Horizon | Chat growth |
| --- | --- |
| 30 days | ~45 MB |
| 90 days | ~130 MB |
| 180 days | ~260 MB |

On the **Free plan's 500 MB database** that is the main risk: chat alone would reach the limit in under a year at that rate, together with the
audit log and notifications sooner. On **Pro (8 GB included)** it is years away. Files do not count against the database (they are in R2).

## Realtime

* Chat subscribes to `chat_messages`, `chat_conversations`, `chat_members` (RLS-filtered per subscriber); a change triggers a small
  "what is new after seq N" request, not a full reload (`useChatThread`: cursor pagination by `seq`, 30 per page, `after` catch-up of at most
  200, no polling timer; catch-up on tab focus / reconnect).
* One message = one Realtime event per connected member who may read it. At the assumption above that is well under 2 million events a month
  for chat; the unfiltered task / ticket screens described in `DATABASE_COST_AUDIT.md` are the larger Realtime and egress consumers.
* Read receipts are one upsert per conversation open / new message read (not per message).

## What was changed / not changed

* Unchanged on purpose: no history is deleted and no retention rule was added (that needs an approved retention policy).
* Already in place and checked: cursor pagination, private storage with short-lived signed links, 5 MB / type limits, content sniffing on
  upload, removal of a deleted message's files.
* Recommended thresholds to watch (block 1 / 7 of the report, monthly): database at 70 % of the plan, chat > 25 % of the database, deleted
  files not removed > 0 for more than a day.

## Is the plan enough?

Not verifiable from here. If the project is on the **Free plan**: it has no automatic backups and pauses when idle - for a production CRM with
customers and money that alone justifies **Pro**, independent of chat. If it is already on Pro, chat growth is not a reason to upgrade further.
