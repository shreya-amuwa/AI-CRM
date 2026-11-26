# Wallet PIN Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every employee's Wallet is locked behind their own 6-digit PIN (set on first open, entered each sign-in, reset by an e-mailed code); the Super Admin needs none.

**Architecture:** The PIN lives in the database (pgcrypto bcrypt). An unlock is recorded per person and JWT `session_id` for 15 minutes; the three own-wallet functions refuse with `WALLET_LOCKED` until then. Forgot PIN: the API asks a service-role-only function for a one-time code and e-mails it; the person types it with a new PIN.

**Tech Stack:** PostgreSQL/Supabase (plpgsql, pgcrypto), Hono API, React + Tailwind, Playwright browser tests.

**Spec:** `docs/superpowers/specs/2026-11-26-wallet-pin-design.md`

## Global Constraints
- PIN: exactly 6 digits; refuse all-same digits, `123456`, `654321`. Stored only as `extensions.crypt(pin, extensions.gen_salt('bf', 10))`.
- Unlock: per (profile, JWT `session_id`), 15 minutes, renewed by each own-wallet read. No `session_id` = never unlocked.
- 5 wrong PINs -> locked 15 minutes. Reset code: 8 characters from `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, 30 minutes, 5 tries, one use; asking again replaces it.
- Super Admin: no PIN (the wallet is not shown on that dashboard; wallet admin screens are not gated).
- Errors: `VALIDATION_ERROR:`, `FORBIDDEN:`, `CONFLICT:`, `WALLET_LOCKED:` prefixes; functions `security definer`, `set search_path = ''`, `revoke ... from public, anon`.
- Migration `20270219000100_wallet_pin.sql`, safe to run twice, no data changed.

## Review Focus
- Two browser tabs of the same sign-in: unlocking one unlocks the other (same session_id) - expected, test it.
- A reset code typed by a different signed-in person must fail (`FORBIDDEN`/not found), even with the right code.
- Wrong-PIN counting must survive concurrent attempts (row lock) - test 5 wrong then right = still locked.
- Signing out and in again (new session_id) must require the PIN again - test with two session ids.
- The API forgot-PIN route must answer the same whether or not e-mail is switched off, and never return the code.

---

### Task 1: Database - PIN, unlock, reset, and the gate
**Files:** Create `supabase/migrations/20270219000100_wallet_pin.sql`, `supabase/tests/wallet_pin_test.sql`; modify `supabase/tests/run.sh` (one line, after `wallet_test.sql`'s neighbours at the end).
**Interfaces (Produces):**
- tables `wallet_pins(profile_id pk, pin_hash, failed_count, locked_until, updated_at)`, `wallet_unlocks(profile_id, session_id, expires_at, pk(profile_id, session_id))`, `wallet_pin_resets(profile_id pk, code_hash, expires_at, tries, created_at)`; RLS on, no grants.
- `public.wallet_pin_status() -> jsonb {hasPin, unlocked, lockedUntil, unlockExpiresAt}`
- `public.wallet_pin_set(p_pin text, p_confirm text) -> jsonb` (only when no PIN yet; unlocks)
- `public.wallet_pin_unlock(p_pin text) -> jsonb` (counts wrong tries; returns `{unlocked, triesLeft, lockedUntil}`; raises nothing on a wrong PIN so the count commits)
- `public.wallet_pin_change(p_old text, p_new text, p_confirm text) -> jsonb`
- `public.wallet_pin_lock() -> void` (ends this session's unlock)
- `public.wallet_pin_reset_begin(p_profile uuid) -> jsonb {code, email, name}` - service_role only
- `public.wallet_pin_reset_finish(p_code text, p_pin text, p_confirm text) -> jsonb` (the signed-in person's own code)
- `private.wallet_me() -> public.profiles` = `private.payout_me()` + raises `WALLET_LOCKED: Enter your Wallet PIN.` unless unlocked; renews the unlock.
- `wallet_summary`, `wallet_transactions`, `wallet_monthly` re-created from 20270207000100 with `private.payout_me()` -> `private.wallet_me()` only.
- [ ] Write `wallet_pin_test.sql`: status before/after set; weak and mismatched PINs refused; summary refused with `WALLET_LOCKED` before unlock and allowed after; another session id locked; 5 wrong -> locked even with the right PIN; change needs the old PIN; reset code: wrong person refused, wrong code counts, right code + new PIN works once; `pin_hash` is not the PIN; no table grants to authenticated; reset_begin not executable by authenticated.
- [ ] Run it (fails: functions missing) -> implement the migration -> run `run.sh` -> commit.

### Task 2: API - Forgot PIN e-mail
**Files:** `server/services/WalletPinService.ts` (new), `server/controllers/index.ts`, `server/routes.ts`, `supabase/tests/api_integration.test.ts` (one block).
**Interfaces:** `POST /api/v1/wallet/pin/forgot` (no body) -> `{ sent: boolean, detail?: string }`; calls `wallet_pin_reset_begin(actor.id)` with the service client and e-mails `renderWalletPinResetEmail({name, code})` through `sendEmail` with category `CREDENTIALS` (copy of `sendClientMail`'s mode checks).
- [ ] API block: 200 for an employee, the code never in the response; in live e-mail mode the outbox mail holds an 8-character code that `wallet_pin_reset_finish` accepts; Super Admin -> 409 "no wallet PIN"; unauthenticated -> 401.
- [ ] Implement -> `npm run typecheck` -> run-api.sh -> commit.

### Task 3: UI - the lock screen on every dashboard's Wallet
**Files:** `src/lib/wallet.ts` (pin functions + `forgotPin()` via `api.post('/wallet/pin/forgot')`), new `src/components/wallet/WalletPinGate.tsx`, `src/components/wallet/WalletPage.tsx` (wrap content in the gate; on a `WALLET_LOCKED` error return to the gate), `supabase/tests/ui/wallet_stubs.ts`, `supabase/tests/ui_wallet.test.mjs`.
**Interfaces:** `<WalletPinGate>{children}</WalletPinGate>` renders Set PIN (two masked 6-digit fields, `inputMode="numeric"`), Enter PIN (tries left, locked-until), Forgot PIN (Send code -> code + new PIN + confirm), and a "Change PIN" / "Lock" control above the unlocked wallet.
- [ ] Browser checks: first open shows Set PIN and nothing of the wallet; mismatch message; after set the wallet shows; reload -> Enter PIN; wrong PIN shows tries left; Forgot PIN flow; phone width 390 px.
- [ ] Implement -> `npm run build` -> `node supabase/tests/ui_wallet.test.mjs` -> commit.

### Task 4: Docs and whole-branch checks
- [ ] `docs/EMPLOYEE_WALLET.md` section "Wallet PIN"; typecheck, build, test:unit (wallet + notice board), test:db, test:api; PR listing the migration.
