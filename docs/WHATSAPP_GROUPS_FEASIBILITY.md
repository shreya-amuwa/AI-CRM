# WhatsApp groups and the CRM: feasibility (PR 5)

**Status:** research and design only. Nothing in this document is built, and nothing should be built for Phase B until the checks in
section 4 are done on Amuwa's own Meta account. The native CRM client groups (PR 3, `docs/CHAT.md`) work without any of this.

**Date of research:** November 2026.

**How it was checked:** web search of Meta's developer documentation (the WhatsApp Groups API page, its reference page and the Cloud API
changelog) and of integrator write-ups. Meta's pages could not be opened directly from the build environment (its network does not reach
developers.facebook.com), so the Meta facts below come from search-result extracts of those pages. Each finding is marked:
- **Meta** — stated on a Meta page, as returned by the search;
- **Vendor** — only in third-party (integrator / vendor) write-ups;
- **Unconfirmed** — not found anywhere.

Confirm every **Vendor** and **Unconfirmed** point on Meta's pages (section 4) before relying on it.

## 1. Short answer

| Question | Answer | Source |
| --- | --- | --- |
| Is there an official Groups API? | Yes, as part of the WhatsApp Cloud API. A business can create, manage and message group conversations. | Meta |
| Who can use it? | Only businesses with an **Official Business Account (OBA, the "verified" business)**. It is not available for WhatsApp **Business app** numbers or for numbers onboarded to **Multi-solution Conversations**. | Meta |
| Can a number used in the WhatsApp Business **app** use it? | No (see above). One vendor also says Groups API does not work with **Coexistence** (the same number in the app and the API). | Meta / Vendor |
| Group size | At most **8 participants, including the business number** (so 7 others). | Meta |
| Groups per number | 10,000. Only **one Cloud API business per group**. | Meta |
| How people join | Only through an **invite link** the business sends. The business **cannot add people directly**; joining can require approval. | Meta |
| What can be sent | Text, media and template messages. **Not:** calls, disappearing / view-once, interactive, commerce or authentication messages; no editing or deleting messages. | Meta |
| Are new messages delivered to us? | Group events come by **webhooks**. Vendors name four separate subscriptions: `group_lifecycle_update`, `group_participants_update`, `group_settings_update`, `group_status_update`. Whether every incoming group **message** arrives on the normal messages webhook needs confirming. | Vendor |
| Can our **existing** WhatsApp groups (made in the app on employees' phones) be connected? | **No supported way was found.** The API works on groups the business creates through the API. | Unconfirmed: no source says it is possible |
| Can **past** messages be retrieved? | **No.** No endpoint to read a group's history was found; the API only receives messages from now on, through webhooks. | Vendor / Unconfirmed |
| Price | Vendors say group messages follow Cloud API per-message pricing, charged per delivered recipient, and that replies inside the 24-hour service window are free (`free_group_customer_service`). | Vendor: check Meta's pricing page |

### What this means for Amuwa
1. **The existing WhatsApp groups and their history cannot be synchronised automatically.** They live on employees' phones (the WhatsApp or
   WhatsApp Business app). No official API reads them or connects them. Doing it anyway (WhatsApp Web scraping, QR-session tools, unofficial
   clients) breaks WhatsApp's terms, can get the numbers banned, and collects other people's messages without a proper basis. **Not an option.**
2. **New groups through the official API are possible only if Amuwa's Cloud API number has OBA status** and is not shared with the
   WhatsApp Business app. Even then:
   - **Size:** a group holds at most 8 people including the business number. That is enough for a client, a Relationship Manager, a Team Lead
     and a few colleagues, but **not** for larger client teams.
   - **Joining:** people join only by invite link. Nobody can be put into a group.
3. **The way that works today** is the native CRM client group (PR 3). History from existing WhatsApp groups can be brought in
   **by hand, with consent** (Phase A below).

## 2. Phase A — bring in the history of an existing WhatsApp group (no Meta API needed)

The only legitimate way to get history that already exists is WhatsApp's own **Export chat**. A member of the group does it on their phone:
group name → Export chat → "Without media" (a `.txt`) or "Attach media" (a `.zip` with `_chat.txt` and the files).

Things to know about exports (vendor guides; check on a real export):
- An export contains only messages from the date the exporting person joined.
- Unsaved participants appear as phone numbers.
- Large media sets may be cut short.
- A group can switch on "Advanced Chat Privacy", which disables Export for everyone.

### Proposed design (to build only after the privacy review below)
1. **Who:** a Support Team Lead (or Department Head / Super Admin) who can manage the customer's CRM support group. That person must also have
   been a participant of the WhatsApp group, so the file is theirs to share.
2. **Consent first:** the screen requires confirming that the client and the group's members were told, and agreed, that the history is being
   copied into the CRM for support records. The confirmation (who, when, which customer, which file) is audited.
3. **Upload:** `.txt` or `.zip`. It is stored through the existing private file storage (the same as chat attachments: no public link) with a
   size limit. It is parsed on the server, never in the browser of someone else.
4. **Preview:** the parsed messages are shown (date, time, sender, text, attachment names) before anything is saved. Each sender is matched
   to the client, a known employee or "Unknown participant (phone ending ...)". Lines the parser cannot read are listed, not dropped silently.
5. **Save** into the customer's support group as **imported records**, kept apart from live messages:
   - a separate table (or `chat_messages` rows with `source = 'IMPORTED_WHATSAPP_HISTORY'`), shown under a clear
     "Imported from WhatsApp on <date> by <name>" divider, greyed;
   - the original sender name / number and the original timestamp exactly as in the export (the export has no time zone: stored as
     Asia/Kolkata, labelled as such);
   - **no ticks, no "delivered / seen", no unread counts, no notifications, not repliable** — they are records, not CRM messages;
   - a fingerprint of each line (date + time + sender + text) so the same export uploaded twice, or two overlapping exports, does not
     duplicate anything.
6. **Access:** exactly the people who can read the CRM support group. The import can be removed by the Super Admin. The removal is audited
   and the file is deleted from storage.
7. **Retention:** the owner to decide, as for attendance locations (e.g. keep as long as the customer relationship + N months).

**Privacy review before building:** the export also contains messages of people who are not Amuwa staff (the client's employees). Amuwa's
privacy notice and the client agreement should say that support conversations may be kept in the CRM. Under India's Digital Personal Data
Protection Act, 2023 the purpose and consent should be clear. This is for Amuwa's legal adviser to confirm: it is not a technical question.

## 3. Phase B — official WhatsApp groups linked to the CRM (only if section 4 says yes)

If Amuwa's number qualifies:
1. **Create** a group per client from the CRM through the Groups API (`POST /<PHONE_NUMBER_ID>/groups`). The API returns an invite link.
2. **Invite:** the CRM sends that link to the client and the assigned staff, through the existing WhatsApp / e-mail senders. People join
   themselves, and joining can require approval.
3. **Receive:** subscribe to the group webhooks (`group_lifecycle_update`, `group_participants_update`, `group_settings_update`,
   `group_status_update`) and to messages. Verify the `X-Hub-Signature-256` of every call (the existing webhook route pattern). Store each
   message once, keyed by WhatsApp's message id, in the customer's CRM support group, marked `source = 'WHATSAPP_GROUP'`.
4. **Send** from the CRM into the group as the business number (text, media, templates only).
5. **Membership:** joins and leaves from the webhooks update the CRM's list. Someone who leaves the WhatsApp group stops receiving, but CRM
   access still follows CRM rules (PR 3), never the WhatsApp list.
6. **Status:** WhatsApp's sent / delivered / read statuses for group messages are kept **separately** from the CRM ticks of PR 3 and labelled
   "WhatsApp", never mixed.
7. **Limits** shown in the screen: 8 people including the business number; no calls, edits or deletes.

Rough size: one migration (group ↔ customer mapping, imported/WhatsApp message source, webhook dedupe), one server webhook handler and
sender, and a small screen. It is comparable to the invoice WhatsApp work.

## 4. What has to be confirmed before deciding (owner / whoever manages the Meta account)

1. In **Meta Business Manager → WhatsApp Manager**: is Amuwa's Cloud API phone number an **Official Business Account** (green badge)? If
   not, Phase B is not available. OBA is applied for separately, and approval is at Meta's discretion.
2. Is that number **only** on the Cloud API? If it is also used in the WhatsApp Business app (**Coexistence**), or onboarded to
   **Multi-solution Conversations**, groups are not available on it.
3. Does the BSP / provider Amuwa uses (if any) expose the Groups API and its webhooks?
4. On Meta's **Groups API** pages (open them from a normal browser):
   - the current participant limit;
   - whether incoming group **messages** arrive on the messages webhook;
   - that there is no history endpoint;
   - that app-created groups cannot be linked.
5. On Meta's **pricing** page: how group messages are charged in India.
6. Legal: the consent wording for Phase A and B (section 2).

## 5. Recommendation
- **Now:** use the native CRM client support groups (PR 3) for new work with clients.
- **Phase A** (export import with consent) can be built when the owner wants old WhatsApp history in the CRM and the privacy wording is
  agreed. It needs no Meta approval.
- **Phase B** only after items 1–5 of section 4 come back positive. If the number has no OBA status, or client groups regularly need more
  than 7 people besides the business number, Phase B does not fit, and the CRM support group stays the place for group work.
- **Never** scraping, QR-session or unofficial WhatsApp clients.

## Sources
- Meta: [Groups API](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups),
  [Group management reference](https://developers.facebook.com/documentation/business-messaging/whatsapp/groups/reference),
  [WhatsApp changelog](https://developers.facebook.com/documentation/business-messaging/whatsapp/changelog),
  [Cloud API get started](https://developers.facebook.com/documentation/business-messaging/whatsapp/get-started)
- Integrators (secondary): [Kapso: state of the Groups API 2026](https://kapso.com/blog/whatsapp-groups-api-state-2026),
  [Periskope: requirements and limits](https://periskope.app/blog/whatsapp-groups-api-requirements-eligibility-limits),
  [Unipile: limits and endpoints](https://www.unipile.com/whatsapp-group-api/), [WOZTELL guide](https://support.woztell.com/portal/en/kb/articles/the-first-guide),
  [Ominiflow](https://ominiflow.com/blog/whatsapp-groups-api)
- Chat export (secondary): [chat export guide](https://dev.to/chattopdf/whatsapp-chat-export-complete-guide-iphone-android-zip-pdf-2026-10lo),
  [Periskope: export chat](https://periskope.app/content/whatsapp-export-chat)
