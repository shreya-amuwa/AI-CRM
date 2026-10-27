# Writing guide for the Amuwa AI CRM documentation

Read this before adding or changing an article. The build (`node docs-site/build.mjs`) enforces the mechanical rules
(links, images, alt text, secrets). The rest is about accuracy, which only a person can check.

## 1. Where things go

```
docs-site/
  content/index.md                  Welcome page (employees)
  content/<section>/<article>.md    one article per task or topic
  sections.json                     the sections and their order in the sidebar
```

The URL of `content/sales/create-a-lead.md` is `/sales/create-a-lead/`. Sections are listed in `sections.json`;
inside a section, articles are ordered by `order` (then title).

## 2. Front matter (top of every article)

```
---
title: How to record a part payment          # task wording, specific (required)
description: One sentence saying what the reader will achieve.   # required, shown under the title and in search
order: 20                                    # position in the section (10, 20, 30 ...)
group: Payments                              # optional: small heading in the sidebar above the article
roles: [Accounts Team Member, Accounts Department Head]   # who can do this (shown as badges)
audience: internal                           # internal (default) | client | both
status: verified                             # verified (default) | needs-confirmation (shows a notice)
sources: [src/components/accounts/PaymentQueue.tsx, supabase/migrations/20261011000200_payments_accounts_workflow.sql]
related: [accounts/invoices-overview, shared/notifications]
updated: 2026-10-19
---
```

- `sources` lists the code you checked the article against. A reviewer uses it to re-verify after a change.
- `audience: client` articles are the only ones published in the client-only site (`--audience=client`). They must
  never link to internal articles and must never describe internal procedures.
- Use `status: needs-confirmation` when part of an article could not be verified. Never guess instead.

## 3. Article shape

Use the same order everywhere (skip a part only when it would be empty):

```
## Before you start          (a :::prereq callout: role, access, record state)
## Steps                     (a numbered list - each step is one action the user performs)
## What you should see       (a :::result callout: the visible outcome, the new status)
## Good to know              (rules, limits, validation messages - :::note / :::warning / :::tip)
## If something goes wrong   (link to the troubleshooting article; the exact message and what it means)
```

Do not write a "# H1": the title comes from the front matter. Start with a one- or two-sentence introduction, then `##` sections.

## 4. Markdown supported

| You write | You get |
| --- | --- |
| `1. Step` (numbered list) | numbered step circles; nested lists and images inside a step work (indent 3 spaces) |
| `- [ ] item` | a checklist |
| `:::tip` ... `:::` | callouts: `tip`, `note`, `warning`, `important`, `prereq`, `result`, `gap` (add a title after the name: `:::warning Check the amount`) |
| `` ```flow `` | a vertical flow diagram (see below) |
| `![What the screenshot shows](shot:payment-queue.png)` | a figure with a caption (alt text is mandatory, at least 5 characters) |
| `[text](/accounts/record-a-payment)` | link to another article; add `#heading-id` to link to a heading |
| tables, `**bold**`, `*italic*`, `` `code` `` | as usual |
| `kbd:Esc` | a keyboard key |

Button, menu and field names go in **bold** exactly as the screen shows them (same capitals, same spelling):
click **Send to Accounts**. Navigation is written as: **Sales dashboard > My Leads > Potential**.

### Flow diagrams

```flow
Create the lead | Sales Team Member | My Leads > Add Lead
Move to Potential | Sales Team Member | needs a deal amount
-> Deal amount missing | the move is refused
Send to Accounts | Sales Team Member | status: waiting for payment confirmation
```

Each line is `Step | Who does it | Where / what changes`. A line starting with `->` is the "if it fails" branch of the step above.
Only draw transitions that exist in the code.

## 5. Accuracy rules (non-negotiable)

1. Every button, menu, field, status and message must be copied from the application (search the source for the string).
2. Every step must be possible for the role named in `roles`. Do not tell a user to do something their role cannot see.
3. Never document a feature that is not implemented. Put gaps in `docs-site/KNOWN_GAPS.md` and, where the reader might
   expect the feature, add a `:::gap` callout ("Not available yet") instead of inventing steps.
4. Say what is verified. If you could not verify a step in the running app, set `status: needs-confirmation`.
5. Do not invent contact details, e-mail addresses, phone numbers or response times. Use only contacts that exist
   in the product (the company support number and e-mail shown in customer e-mails), and only where useful.
6. Never include a real password, token, API key or real customer data. Use obvious test values:
   `Test Traders (TEST)`, `9000000101`, `name@example.com`.
7. Do not tell people to edit URLs, bypass a permission or change data in the database.
8. Use a plain hyphen "-" in text, never the long dash. Write in short, direct sentences ("Click **Save**.").
9. Link to a shared article instead of repeating a procedure (for example tickets, notifications, import).

## 6. Screenshots

The manual has no screenshots of the application: describe the screen in words (page name, button names, what each field means). Do not add images (`shot:` images are no longer part of the content).

## 7. Client documentation

The client guide is separate (`content/client/`, `audience: client`). It uses the words the client sees on their
dashboard, never the names of internal roles, queues or tools, and never explains how staff work.
`node docs-site/build.mjs --audience=client` builds a site that contains only these pages.

## 8. When the application changes

1. Search `docs-site/content` for the old label (for example `grep -rn "Send to Accounts" docs-site/content`).
2. Update the article, its screenshots and the `sources` list; set `updated`.
3. Add a line to `content/changelog/` only for changes users will notice.
4. Run `node docs-site/build.mjs`; fix everything it reports.
