# Crocodial integration (read-only connector)

Crocodial (`app.crocodial.app`) is the calling CRM the Sales staff use to call and follow up leads. This integration reads its Outbound API into the
AI-CRM, so each employee and their managers can see that work next to their CRM work.

- **Design:** `docs/superpowers/specs/2026-11-19-crocodial-integration-design.md`
- **API guide:** Crocodial's *Outbound API* guide (Setup → Outbound API)

It is delivered in parts:

| Part | What | Status |
| --- | --- | --- |
| 1 | Configuration and identity (rollout, connections, department links, approved employee mappings, Super Admin page, connection test) | this pull request |
| 2 | Read-only sync of leads, call logs, follow-ups and remarks (rate-limited, paged, checkpointed, reconciled) | next |
| 3 | "My Crocodial Activity" on the employee's own dashboard | next |
| 4 | Team Lead / Department Head / Operations Head pilot views | next |

## Pilot: M Pillar Sales, two people

- **Rollout.** The migration allows exactly one department and function: **M Pillar · Sales**. No other department can be linked until the Super Admin allows it (rollout).
- **Accounts.** The live check on 2026-11-19 found **one** Crocodial account, "M pillar corporation", with branch 121 and 5 users. One connection (one token) serves the pilot. Its users are:
  - Supriya Mpillar (Crocodial id 371);
  - sachin (4138);
  - Vanshika (4193);
  - snehal (4194);
  - prachii (4195).
- **Only approved people are switched on.** Only the people the Super Admin maps and approves count. The pilot is Sachin and Supriya. The other three are never shown or counted unless they are approved later.

## Who does what

| Step | Who | Where |
| --- | --- | --- |
| Allow a department + function (rollout) | Super Admin | Crocodial Integration > 1. Rollout |
| Add a connection (one Crocodial account) | Super Admin | > 2. Connections |
| Put the token on the server | Whoever deploys | the server's environment (see below) |
| Test the connection (reads the user and branch lists only) | Super Admin | > Test connection |
| Link the connection to M Pillar Sales; switch it on | Super Admin | > 3. Departments |
| Map a Crocodial user to one CRM employee, check, approve or revoke | Super Admin | > 4. People |

The database enforces each step (`croc_*` functions in `20270115000100_crocodial_integration.sql`). Department Heads and everyone else get `FORBIDDEN`.

**When a person's activity counts.** All of these must hold at the time of the activity:
1. the connection is on;
2. its link to the person's department + Sales is on;
3. the rollout allows that department;
4. the person's mapping is approved and in effect;
5. the person is active.

**Mapping rules.**
- Switching a department on switches nobody on.
- A mapping is only possible for an active member of that department's Sales (team division SALES, or that department's Sales head).
- One Crocodial user maps to one person, and one person to one Crocodial user, per account.
- Revoking ends the mapping: activity before the end stays the person's, nothing after it does. The CRM profile, role and team are never changed.

## Who sees a person's Crocodial activity

| Viewer | Sees |
| --- | --- |
| The person | Their own only. |
| Team Lead | Only the people they lead (`private.led_by`), not another Team Lead's people in the same team. |
| Department Head / Operations Head | People in departments + Sales their scope covers (`private.scopes_of`). Support-only heads and other departments see nothing. |
| Super Admin | Everything, plus configuration. |
| Anyone else / no login | Nothing. |

This is `private.croc_can_view(profile, department, division)`. The screens in parts 3 and 4 read only through functions that call it.

## The token (environment secret)

1. **Create the token.** In Crocodial, go to **Setup → Outbound API**, create a token, and keep **Allow changes OFF**. The CRM only reads.
2. **Put it on the server.** Add it to the server's environment under a name starting with `CROCODIAL_TOKEN_`, for example `CROCODIAL_TOKEN_MPILLAR`. Use Vercel → Settings → Environment Variables, and the Worker secrets if the API runs there. Redeploy.
3. **Name it in the CRM.** In the CRM, add the connection with **that name**. The CRM stores only the name, and shows whether the server has it ("set on the server"). The value never reaches the browser, the database, the logs or the repository.
4. **If the token is ever exposed** (pasted into a chat, an e-mail or a ticket): regenerate it in Crocodial, which ends the old one immediately, and update the server setting.

## How the client talks to Crocodial (`server/crocodial/client.ts`)

- **Requests.** GET only, to `https://app.crocodial.app/api/datalake/outbound`. The token goes in the `Authorization: Bearer` header only.
- **Rate.** At most one request every 1.2 s per client (50 a minute, under Crocodial's 60).
  - On `429` it waits 60 s, at most twice, then stops with "rate limited".
  - Network errors and 5xx are retried twice with back-off.
  - Timeout: 30 s.
- **Paging.** Pages of 500 rows. `next_page_url` is followed only when all of these hold:
  - same origin and path;
  - https;
  - the next page number;
  - no `token` in the address.
- **Validation.** Every row is checked. A row that does not match is skipped and counted.
- **Errors become health states:**
  - `401`: token refused;
  - `403`: token turned off in Crocodial;
  - missing setting: "token setting missing on the server".
- **What the connection test keeps.** It reads `/employees` and `/branches` only, and keeps names, active flags and branch ids. Phone numbers and e-mails are dropped.

## Migration to run (Supabase SQL editor)

- `supabase/migrations/20270115000100_crocodial_integration.sql`
  - Run it after every earlier migration.
  - It is additive and safe to run twice.
  - It adds the tables (RLS on, no grants), the `croc_*` functions, and the M Pillar Sales rollout row.
  - Before it runs, nothing changes. After it, nothing is switched on until the Super Admin does the steps above.

## Rollout steps (pilot)

1. Run the migration.
2. Add `CROCODIAL_TOKEN_MPILLAR` to the server environment, with a token whose "Allow changes" is off. Redeploy.
3. Open Super Admin > Crocodial Integration and add the connection:
   - name "M Pillar";
   - account "M pillar corporation";
   - setting `CROCODIAL_TOKEN_MPILLAR`.
4. Click **Test connection**. Expect "Connected. 5 employees and 1 branches read".
5. Click **Link (stays off)** for M Pillar · Sales.
6. Under People, map and approve each person:
   1. pick "sachin (id 4138)" and the CRM account of Sachin;
   2. check the department, team and role shown;
   3. confirm in Crocodial that this user really is that person;
   4. propose, then approve;
   5. do the same for "Supriya Mpillar (id 371)".
7. Switch the connection **on** and the M Pillar Sales link **on**. Parts 2 to 4 then sync and show the activity.

## Rollback

- **Pause.** Rollout → **Pause**. This switches the department link off. Nobody's data is shown or synced, and nothing is deleted.
- **Stop calling Crocodial.** Switch the connection off, or remove the server setting. The connection then reports "token setting missing".
- **Database.** The migration only adds tables and functions. No existing table, function or data is changed.
