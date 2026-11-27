-- =============================================================================
-- Wallet: "cannot execute UPDATE in a read-only transaction" (the Wallet page showed this error instead of the balance)
-- =============================================================================
-- ROOT CAUSE. 20270222000100_wallet_pin.sql made the Wallet's three reads (wallet_summary, wallet_transactions, wallet_monthly) call private.wallet_me(), which RENEWS the
-- PIN unlock with an UPDATE (public.wallet_unlocks.expires_at). The three reads were declared STABLE. PostgreSQL itself accepts a volatile callee inside a stable function,
-- but PostgREST (Supabase's API) runs a call to a STABLE function in a READ ONLY transaction, so the UPDATE inside it is refused. The tests did not see it because they call the
-- functions in an ordinary read-write transaction.
-- FIX. These three functions write (they renew the unlock), so they are VOLATILE, which is what they are. Only the volatility changes: bodies, grants and results are the same.
-- wallet_pin_status writes nothing and stays STABLE. Additive and safe to run twice; no data is touched.
-- =============================================================================
alter function public.wallet_summary() volatile;
alter function public.wallet_transactions(date, date, text, integer, integer) volatile;
alter function public.wallet_monthly(integer) volatile;
notify pgrst, 'reload schema';
