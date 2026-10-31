# Internal chat: end-to-end encryption, "Delete for me / for everyone", emoji

Migration: `supabase/migrations/20261206000300_chat_deletion_and_e2ee.sql` (paste-able bundle:
`supabase/run_these_4_migrations_hierarchy_contact_secure_chat.sql`, which also holds Super Admin protection and the member
contact number). Applies on top of `20261108000100_chat.sql`; safe to run again; nothing is deleted or rewritten.

## What is end-to-end encrypted, and what is not

| Conversation | Encrypted end to end? | Why |
|---|---|---|
| Direct messages between employees | **Yes** | |
| Employee groups | **Yes** (a message is sealed for every member who is in the group when it is sent) | |
| Client chat (client + Team Member + Team Lead, read by the Department Head) | **No** | The Department Head's review screen, the audit trail and the client's own portal need server-readable messages. Changing that is a product decision, not a bug. The screens do not show the "end-to-end encrypted" strip for client chats. |

The database refuses a readable (plaintext) message in a direct or group conversation (trigger
`chat_messages_require_encryption`), so an old browser or a direct API call cannot write one by mistake.
Messages written **before** this migration stay readable and are labelled as older, unencrypted messages.

## Protocol (no custom cryptography)

Everything uses the browser's WebCrypto plus one reviewed library, **hpke-js** (`@hpke/core` 1.9.0, pinned), an implementation of
**HPKE, RFC 9180**.

* **Identity key**: each person has one ECDH **P-256** key pair, generated in their browser (since migration `20261216000100` automatically when they sign in; before that on "Turn on secure messaging", see *Automatic set-up* below). The private
  key is stored in IndexedDB as a **non-extractable** `CryptoKey` (the page can use it, nothing can read it out). The server only ever
  receives the public key.
* **Message**: a random AES-256-GCM key encrypts the message (random 96-bit IV). The message key is sealed separately for each
  recipient and for the sender (so the sender can read their own history on other devices) with HPKE **AUTH mode**
  (DHKEM P-256 / HKDF-SHA256 / AES-256-GCM), which also authenticates the sender's key. Associated data binds the ciphertext to
  `conversation | sender | client message id`, and the HPKE info binds the recipient, so a ciphertext cannot be replayed into another
  conversation or attributed to another sender. Envelope: `{ v, sv, iv, ct, wraps: [{ to, kv, enc, w }] }`.
* **Files**: encrypted in the browser before upload (`AME2` header + IV + AES-256-GCM ciphertext), stored with the type
  `application/x-amuwa-e2ee` and the name `encrypted-file`. The file key travels inside the encrypted message. The server and the
  storage (R2 or Supabase Storage) hold only ciphertext; the real name and type exist only inside the encrypted message.
* **Server's job**: check the envelope has the right shape and covers exactly the current members' current keys
  (`KEYS_MISSING` / `KEYS_CHANGED` otherwise, so a message is never sealed for a stale member list), store it, deliver the viewer only
  *their own* wrap. It never sees plaintext, message keys, private keys or passphrases.
* **Key directory**: public keys, a version number and a SHA-256 fingerprint (computed by the database from the public key).
  Names and roles only; never e-mail or phone.

## Key management

* **Generation / storage**: in the browser, non-extractable (above).
* **Backup / recovery**: an account that chose a **recovery passphrase** (never sent; optional since the automatic set-up, see below) has a backup. The passphrase The key pair is wrapped with
  PBKDF2-SHA256 (600,000 rounds) -> AES-256-GCM and the opaque backup is stored on the server, so a **new device** can unlock with the
  passphrase. A wrong passphrase is refused; the server cannot check or reset it. **If the passphrase is lost the old messages cannot
  be recovered by anyone** (including the Super Admin): the person can only *reset* their key and start again.
* **Verification**: every person pins a colleague's key the first time they see it (trust on first use). Later changes stop sending to
  that colleague until the new key is reviewed ("Review" -> compare the fingerprint/safety number with them -> accept). The security
  dialog shows each person's fingerprint.
* **Rotation / reset**: "Reset secure messaging" retires the old key (kept only so the history can be marked) and publishes a new one
  after an explicit confirmation. Messages sealed for the old key are shown as "unreadable on this device" on a device that only has the
  new key; a device that still holds the old key keeps reading them. Colleagues get the key-changed warning.
* **Super Admin is not special**: there is no escrow, no master key and no admin decryption. The Super Admin's access to the database
  gives ciphertext only.

## Automatic set-up (no button, no passphrase)

Migration `supabase/migrations/20261216000100_chat_automatic_keys.sql` (run it before deploying the app version that uses it; until then the
app falls back to the passphrase set-up, so nothing breaks). Safe to run again; nothing is deleted.

**What happens.** When an employee signs in, the app (one `SecureChatProvider` for the signed-in employee) asks the server for their key status.
If the account has no key and the browser can keep one (IndexedDB), the browser makes the P-256 key pair, stores the private key as a
**non-extractable** `CryptoKey`, and sends **only the public key** to `POST /chat/keys/register` (`chat_key_register`). Nothing else changed:
messages are still sealed in the browser for each member's public key with HPKE, the server stores ciphertext only, key fingerprints and the
trust-on-first-use / key-changed warnings work as before. No plaintext is ever sent: with a locked, missing or changed key the send is refused.

**Safe to repeat.** The key is first stored as *pending* (created only if none exists: an atomic IndexedDB `add`), then published, then it
becomes the key of the version the server gave it. `chat_key_register` accepts the same public key twice (a retry, a second tab) and refuses a
different one (`CONFLICT`), so a login on another browser **never replaces** an existing key. Tabs of one browser take turns (Web Locks) and,
where those do not exist, the atomic *pending* key and the idempotent registration give the same result. A page closed half way is completed
on the next start with the same key. A failed registration (network, or the migration not run yet) shows "could not be set up automatically"
with *Try again* and the older *Use a recovery passphrase* option.

**What a person sees.** Normally only a quiet "End-to-end encrypted" line in a conversation. A bar with a button appears only when something is
needed: *Setting up secure messaging...* (a moment), a locked device, a browser that cannot keep keys, a colleague's changed key. The shield
button next to *New* in the chat list opens the person's own settings (fingerprint, optional recovery passphrase, take keys off this device).

**Recovery model (the important change).** There is no passphrase to recover an automatic key, and a non-extractable key cannot be copied
out of a browser. So:

| Situation | What happens |
|---|---|
| Same browser, later | Reuses the key. No second key. |
| Older account with a recovery passphrase | The device is *locked*; **Unlock** with the passphrase, as before. |
| Automatic account, another browser / cleared site data / keys removed | The device is *locked* and says so. **Set up this device** makes a **new** key (`POST /chat/keys/rotate`) only after the person ticks that earlier messages will not be readable there. The old key is retired; colleagues are asked to accept the new fingerprint. The old key's messages stay readable on the device that still holds it. Never automatic. |
| Private window / IndexedDB blocked | Nothing is registered by itself (a key that is lost with the tab would orphan the account). The passphrase set-up is offered; its backup is what makes it recoverable. |
| A person wants other devices to read their history | *Make a new key with a recovery passphrase* (settings): a new key whose backup another device can unlock. |

`chat_key_status` now also returns `backupVersion`: a backup that belongs to an older key than the current one is **not** offered as a way in.
The rotate call is no new power: `chat_key_reset` already let a signed-in account publish a new key (with a backup of its own choosing).

**Not done here (needs its own design).** Seamless history on a second device without a passphrase needs a cryptographic transfer: either a
trusted-device approval (the old device wraps the key for the new device's public key, shown with a code both screens confirm) or a WebAuthn
PRF-protected backup on devices that support it. Both are bigger than this change; until then the table above is the honest behaviour.

## Delete for me / Delete for everyone

* **Delete for me**: stored per person (`chat_message_hidden`), so it survives a refresh and applies on every device. Others keep the
  message. Available on any message in a direct or group chat.
* **Delete for everyone**: only the **sender**, only internal chats, after a confirmation. The database wipes the body, the ciphertext,
  the key wraps and the attachment list of the row (it becomes a tombstone: "This message was deleted"), marks the files `DELETED`,
  and the API removes the stored objects (`storage_removed_at` records it; a repeat delete retries a failed removal). It is not a
  front-end hiding trick: the normal message API returns only a tombstone. Open screens update live. Delete for everyone is audited
  (`CHAT_MESSAGE_DELETED_FOR_ALL`, ids and counts only, never content); Delete for me is a private per-person setting and is not audited.
  Turning secure messaging on and resetting a key are audited too (`CHAT_KEY_REGISTERED`, `CHAT_KEYS_RESET`: version and fingerprint only).
* **What deletion cannot do**: take back a screenshot, a photo of the screen, a copy someone made, a file they already downloaded, or
  a notification preview already shown. The confirmation dialog says so.
* Client chats keep their history (the Department Head's review and the audit trail depend on it).

## Emoji

An emoji picker beside the message box (groups, search, recently used kept in the browser). Emojis can be mixed with text, sent alone,
and several can be added in a row; the picker fits phones.

## Limitations (written down, not hidden)

* No forward secrecy / ratcheting (a stolen private key plus stored ciphertext reads that person's history). Keys are non-extractable
  but live as long as the browser profile; "Remove keys from this device" is offered.
* The server and database administrators still see **metadata**: who talks to whom, when, message sizes, sender names, file sizes.
* A malicious database administrator could substitute a public key. That is why keys are pinned and fingerprints can be compared; the
  residual risk is accepted until people have verified fingerprints.
* Conversation-list previews show "Encrypted message" (the server has no text to preview). Search by message text is not possible on
  the server.
* A recipient needs a key before they can be messaged; it is made when they sign in (see *Automatic set-up*), so this only affects somebody who has not signed in since.
* Browser-side crypto trusts the web app code served to the browser (the usual limit of web-based E2EE).
* R2 needs a CORS rule allowing `GET` from the app's origin so the browser can fetch an encrypted file to decrypt it.

## Tests

* `supabase/tests/chat_e2ee.test.ts` / `chat_secure_client.test.ts` (`run-unit.sh`): real HPKE/AES round trips, tamper / wrong
  recipient / wrong conversation / wrong sender failures, backup wrap/unwrap, wrong passphrase, key-change detection, 65 checks.
* `supabase/tests/chat_automatic_keys_test.sql` (`run.sh`): `chat_key_register` / `chat_key_rotate` rules (idempotent, CONFLICT, audit, no backup, signed-out refused).
* `supabase/tests/chat_e2ee_test.sql` and `chat_test.sql` (`run.sh`): ciphertext-only storage, plaintext refused, key coverage,
  key reset, tombstones, per-user hidden state, file status.
* `supabase/tests/api_integration.test.ts`: the same through HTTP, and the one-time clean-up script.
* `supabase/tests/e2e/run-chat.sh`: real browsers (124 checks): turning secure messaging on, ciphertext in the database and in
  requests (no typed word, passphrase or private key), emoji (mixed, emoji-only, phone fit), Delete for me / for everyone (live,
  after reload, other device, file removed from storage), wrong passphrase, new device locked, key reset + key-changed warning.

## One-time clean-up of one conversation

`scripts/delete-team-lead-sales-head-chat.mjs` deletes the direct chat between **one named Team Lead and one named Sales Department
Head** (you give both e-mails or ids; roles and Sales side are verified, members must be exactly those two). Without `--apply` it only
prints the conversation id, message and file counts. With `--apply --confirm <that conversation id>` it removes the stored files
(Supabase Storage / R2), then the conversation (messages, files, read marks, hidden marks and members cascade) and writes one audit
entry with ids and counts. It is not a migration, not scheduled and not an API route. Other conversations are never touched. It has
only been run against the local test database, never production.

```
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... [R2_*=...] node scripts/delete-team-lead-sales-head-chat.mjs --team-lead <email|id> --sales-head <email|id>
... same command plus  --apply --confirm <conversation id>
```
