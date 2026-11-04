# Internal chat encryption: assessment and decision needed

> **Update (migration `20261224000200_chat_company_readable.sql`): option B was chosen by the product owner and is implemented.** New direct and
> group messages are stored readable by the company (TLS in transit, encryption at rest, the same membership checks); no key, passphrase or
> set-up is needed. Existing encrypted messages are kept as they are and stay readable on a device that holds the key. The Super Admin can
> switch back (`POST /chat/settings {"mode":"E2EE"}`, audited). See the "Company-readable internal chat" section of `CHAT.md`.

**Status at the time of writing (superseded by the update above): no code change in this PR.** The request was to remove the internal-chat E2EE "requirement". The assessment below shows that the routine barrier is already gone, and that removing the encryption itself
would be an irreversible security downgrade for existing messages that needs an explicit human decision. Nothing is removed, converted or hidden.

## 1. Does the existing automatic-key system already remove the barrier?

Yes, for the normal case. Since `20261216000100_chat_automatic_keys.sql` (and `SecureChatProvider`, mounted for every signed-in employee in `App.tsx`):

| Question | Today |
| --- | --- |
| "Turn on secure messaging" button before first use? | **No.** The browser generates the person's key at sign-in (a non-extractable key in IndexedDB) and publishes only the public half. |
| Recovery passphrase form / repeated passphrase entry? | **Not for a new account.** A passphrase exists only if the person chose to set one (optional) or had set one before the automatic set-up. |
| Manual "initialise encryption" step? | **No**; `chat_key_register` is automatic and repeat-safe. |
| Can an employee open a chat, pick a colleague, send and receive, create groups, share files, reply, use emoji, get notifications, delete for me / for everyone? | **Yes**, immediately after sign-in (the DB refuses plaintext in direct/group chats, so everything sent is sealed in the browser). |
| Client chats | Already **not** end-to-end encrypted (they must be readable by the client portal, the Department Head review and the audit trail). Unchanged by this work. |

## 2. When an employee can still see an encryption prompt (all inherent to E2EE)

1. **A browser that cannot keep keys** (a private window, blocked site data): "open Chat in a normal window".
2. **An older account that chose a recovery passphrase, on a new device**: it must be unlocked with that passphrase to read the old messages.
3. **A new device with no backup**: the person continues with a *new* key; messages sealed for the old key stay "unreadable on this device" (a device that still holds the old key keeps reading them). Colleagues are asked to accept the new key.

These are not bugs: without the private key nobody - including the server and the Super Admin - can read the old messages. That is the property E2EE provides.

## 3. What removing E2EE would mean (why it is a human decision)

* **Historical ciphertext cannot be converted by the server.** The server holds only ciphertext and public keys. Any plan that makes old messages readable needs each person's device to decrypt and re-publish them, or the old messages stay readable only on devices that hold the key.
* **Privacy / access change:** the server, database administrators and (with the right tooling) the Super Admin could read employees' internal messages. That must be a stated policy, not a side effect.
* **Claims to change:** every "end-to-end encrypted" statement (in-app notices, `docs/CHAT_ENCRYPTION.md`, the documentation site) would have to be corrected in the same release.

### Options (pick one; each needs approval before any code)

| Option | What changes | Risk |
| --- | --- | --- |
| **A. Keep E2EE (current)** | Nothing. Optionally make prompts 2 and 3 even gentler (wording only). | none |
| **B. Phased "readable by the company" for NEW messages** | Add a conversation/message mode that stores server-readable messages (TLS in transit, encrypted at rest, RLS-protected), keep the legacy reader for existing ciphertext, switch new direct/group messages after a notice, never convert or delete the old ones. The `chat_messages_require_encryption` trigger is replaced by a rule that allows both. | Old messages stay readable only where keys exist; mixed history; policy and claims must change. |
| **C. Per-conversation choice** | Company groups readable, direct messages encrypted (or the reverse). | Two behaviours to explain and support. |

If you choose B or C: ship a migration that **adds** a `mode` column (default `E2EE`), a legacy reader, a clear in-app notice and an admin-access policy statement; then change the default for new conversations in a later release.
No migration or app change has been made here, so the current encrypted history cannot be affected by this PR.
