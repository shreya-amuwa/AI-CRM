# Wallet PIN (PR 1 of the Incentive & Wallet work) - design

Approved in conversation on 2026-11-26 ("go").

## Intent
Income and incentives are personal: every employee's Wallet must be locked behind a PIN of their own, on every dashboard, before anything in it is shown.
The Super Admin needs no PIN. Later PRs move My Income (with Withdraw) into the Wallet (PR 2) and add Support incentives and the new Incentive screen (PR 3).

## Goals
- First open: **Set Wallet PIN** (6 digits, entered twice). Afterwards: **Enter Wallet PIN** before anything is shown.
- One PIN per person, whatever dashboard; one unlock lasts for that sign-in session, 15 minutes (renewed while the wallet is used).
- 5 wrong PINs lock the wallet for 15 minutes. Change PIN (old PIN + new). **Forgot PIN**: a one-time reset link e-mailed to the person, valid 30 minutes,
  usable only by that person while signed in.
- The PIN is stored hashed (bcrypt via pgcrypto); the **database** refuses the wallet's own data (`wallet_summary`, `wallet_transactions`,
  `wallet_monthly`) until the PIN was entered in this sign-in session - the browser cannot skip it.

## Non-goals (this PR)
- My Income / payouts / withdrawals pages are not gated yet (they move into the Wallet in PR 2, then share the same lock).
- No change to how anything is earned, credited or paid.

## Approach (chosen)
Everything in the database, like the rest of the Wallet: `wallet_pins` (hash, wrong-try count, lock-until), `wallet_unlocks` (profile + the JWT's
`session_id`, expiry), `wallet_pin_resets` (token hash, expiry, used). Functions `wallet_pin_status / set / unlock / change / lock`, and for Forgot PIN a
service-role-only `wallet_pin_reset_begin(profile)` that returns a raw token to the API (which e-mails it) plus the person's own
`wallet_pin_reset_finish(token, pin)`. The three own-wallet functions get `private.wallet_me()` = the existing `private.payout_me()` plus the unlock check.
Rejected: hashing in the API (the wallet is read from the browser through PostgREST, so the database still has to know about the unlock); a token
the browser carries (more moving parts than the sign-in session the database already sees).

## Builder's calls
- 6 digits only; refuse obvious ones (all the same digit, 123456 / 654321).
- The reset e-mail goes through the existing client/staff e-mail sender; in test mode the link is not sent and the screen says so.
- A session without a `session_id` claim (older tokens) never counts as unlocked: the person enters the PIN again after signing in.
