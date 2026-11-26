/**
 * The database refuses a person's money reads (wallet, income, withdrawals) until their Wallet PIN was entered in this sign-in (20270220000100,
 * 20270221000100). Every client library that calls those functions reports it here, so the Wallet's PIN screen takes over.
 */
export const WALLET_LOCKED_EVENT = 'wallet:locked';
export function reportIfWalletLocked(message: string): void {
  if (/^WALLET_LOCKED:/.test(message) && typeof window !== 'undefined') window.dispatchEvent(new Event(WALLET_LOCKED_EVENT));
}
